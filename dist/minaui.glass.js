/*!
 * minaui.glass.js V2.2
 * MinaUI optional liquid-glass module with pluggable backends.
 *
 * Backends:
 *   webgl  - full-screen WebGL2 canvas with refraction + blur (default on
 *            desktop Chromium/Firefox when WebGL2 is available)
 *   native - per-element CSS backdrop-filter (Safari / iOS / no-WebGL2)
 *   static - translucent surface without any blur (last resort)
 *
 * Performance features: quality tiers (high/balanced/performance), render
 * scale + pixel budget, RAF-coalesced scroll handling, ResizeObserver-based
 * resize ownership, context-loss fallback and full destroy() cleanup.
 *
 * Copyright (c) 2026 oSsmXun
 */

const LIQUID_SELECTOR = '.mina-glass--liquid, .mina-glass-liquid, .aqua-glass-liquid';
const FALLBACK_CLASS_NATIVE = 'mina-liquid-native';
const FALLBACK_CLASS_STATIC = 'mina-liquid-static';
// Default pixel budget (~1920x1080). Retina phones/laptops downscale the
// internal back buffer only; the CSS size always matches the viewport.
const DEFAULT_MAX_PIXEL_COUNT = 1920 * 1080;
const MAX_TEXTURE_EDGE = 2048;
function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

class MinaGlass {
    constructor(options = {}) {
        this.destroyed = false;
        this.canvas = options.canvas || document.getElementById('mina-glcanvas') || document.getElementById('aqua-glcanvas') || null;

        const config = Object.assign({}, options);
        if (config.saturate === undefined) config.saturate = 1.2;
        this.config = config;

        // Quality tier: 'high' | 'balanced' | 'performance'. Defaults to
        // high to preserve MinaUI's original liquid-glass look; inherits
        // <html data-mina-performance="..."> when not given explicitly.
        const attrQuality = document.documentElement ? document.documentElement.getAttribute('data-mina-performance') : null;
        this.quality = MinaGlass.normalizeQuality(options.quality !== undefined ? options.quality : attrQuality);

        // Render scale / pixel budget. The back buffer never exceeds
        // maxPixelCount regardless of devicePixelRatio.
        this.renderScale = clampValue(typeof options.renderScale === 'number' && isFinite(options.renderScale) ? options.renderScale : 1, 0.25, 4);
        this.maxPixelCount = typeof options.maxPixelCount === 'number' && options.maxPixelCount > 0 ? Math.floor(options.maxPixelCount) : DEFAULT_MAX_PIXEL_COUNT;

        this.whiteness = options.whiteLevel || 0;
        this.maxCards = clampValue(Math.floor(options.maxCards || 4), 1, 8);

        // Backend: 'auto' | 'webgl' | 'native' | 'static'.
        this.backendPreference = MinaGlass.normalizeBackend(options.backend);
        this.backend = 'static';

        // GL state
        this.gl = null;
        this.program = null;
        this.texture = null;
        this.vao = null;
        this.vbo = null;
        this.uniforms = {};
        this.imgW = 1;
        this.imgH = 1;
        this.scale = 1;
        this.lastImage = null;
        this.contextLost = false;
        this._emptyDrawn = false;

        // Frame scheduling state
        this._cards = [];
        this._cardsDirty = true;
        this._rafPending = false;
        this._rafId = 0;
        this._loopId = 0;
        this._listeners = [];
        this._resizeObserver = null;
        this._observedElements = new Set();
        this._trackedElements = [];

        const self = this;
        this.requestRender = function () { self._requestRender(); };

        if (this._resolveBackend()) {
            this.initialize();
            this._setupContextLossHandlers();
            this.setCanvasSize();
        } else {
            if (this.canvas) this.canvas.style.display = 'none';
            // Fallback surfaces work without autoInit too.
            this._applyFallbackStyles();
        }
    }

    /* ------------------------------------------------------------------
     * Static helpers
     * ------------------------------------------------------------------ */

    static normalizeQuality(value) {
        if (value === 'high' || value === 'quality') return 'high';
        // 'balanced' keeps the liquid-glass look at a lower shader cost
        // (9-tap + mip LOD instead of the 25-tap loop).
        if (value === 'balanced' || value === 'medium' || value === 'balance') return 'balanced';
        if (value === 'performance' || value === 'low' || value === 'fast') return 'performance';
        // Preserve MinaUI's original 25-tap liquid-glass look unless a page
        // explicitly opts into a lower-cost performance tier.
        return 'high';
    }

    static normalizeBackend(value) {
        return value === 'webgl' || value === 'native' || value === 'static' ? value : 'auto';
    }

    /**
     * Pick a backend from capability + environment. UA sniffing is limited to
     * known engine-level issues (WebKit async scrolling); everything else is
     * feature detection.
     */
    static detectBackend(quality) {
        if (quality === 'performance') return 'native';
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'webgl';
        if (!('WebGL2RenderingContext' in window)) return 'native';

        const ua = navigator.userAgent || '';
        const isIOS = /iP(hone|od|ad)/i.test(ua) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isWebKit = /AppleWebKit/i.test(ua) && !/Chrom(e|ium)|Edg\//i.test(ua);
        if (isIOS || isWebKit) return 'native';

        // Touch-first devices: per-element blur is cheaper than a full-screen
        // render path on weak GPUs.
        if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'native';

        return 'webgl';
    }

    static supportsNativeBlur() {
        if (typeof CSS === 'undefined' || !CSS.supports) return true;
        return CSS.supports('backdrop-filter: blur(1px)') || CSS.supports('-webkit-backdrop-filter: blur(1px)');
    }

    /**
     * Bind MinaGlass to all .mina-glass-liquid elements on the page and start
     * on-demand rendering (draw only when something actually changed). Up to
     * maxCards elements are tracked simultaneously (4 by default).
     *
     * @param {Object} options - passed through to the MinaGlass constructor
     * @param {string} [options.background] - image URL used as the lens source
     * @param {string} [options.quality] - 'high' | 'balanced' | 'performance'
     * @param {string} [options.backend] - 'auto' | 'webgl' | 'native' | 'static'
     * @param {number} [options.renderScale] - multiplier on devicePixelRatio
     * @param {number} [options.maxPixelCount] - hard cap on back-buffer pixels
     * @returns {MinaGlass}
     */
    static autoInit(options = {}) {
        const opts = Object.assign({}, options);

        if (!opts.canvas && typeof document !== 'undefined') {
            const existing = document.getElementById('mina-glcanvas') || document.getElementById('aqua-glcanvas');
            if (existing) {
                opts.canvas = existing;
            } else {
                const quality = MinaGlass.normalizeQuality(opts.quality !== undefined ? opts.quality : document.documentElement.getAttribute('data-mina-performance'));
                const preference = MinaGlass.normalizeBackend(opts.backend);
                const backend = preference === 'auto' ? MinaGlass.detectBackend(quality) : preference;
                // Only materialize a canvas when the page actually uses liquid
                // glass; otherwise behave like before (no-op with a warning).
                const hasLiquid = !!(document.querySelector && document.querySelector(LIQUID_SELECTOR));
                if (backend === 'webgl' && hasLiquid) {
                    const canvas = document.createElement('canvas');
                    canvas.id = 'mina-glcanvas';
                    canvas.setAttribute('aria-hidden', 'true');
                    // The z-index contract (--mina-z-glass-canvas) keeps it below content.
                    (document.body || document.documentElement).appendChild(canvas);
                    opts.canvas = canvas;
                }
            }
        }

        const instance = new MinaGlass(opts);
        instance.attachAutoTracking(opts);
        return instance;
    }

    /* ------------------------------------------------------------------
     * Backend selection / switching
     * ------------------------------------------------------------------ */

    _resolveBackend() {
        let choice = this.backendPreference;
        if (choice === 'auto') choice = MinaGlass.detectBackend(this.quality);

        if (choice === 'webgl') {
            if (!this.canvas) {
                console.warn('MinaGlass: Canvas element not found');
                choice = 'native';
            } else {
                this.gl = this.canvas.getContext('webgl2', {
                    antialias: false,
                    depth: false,
                    stencil: false,
                    // Alpha stays on: until the first draw lands (or if shader
                    // setup fails) the canvas must stay transparent instead of
                    // compositing as an opaque black layer.
                    alpha: true,
                    premultipliedAlpha: true,
                    preserveDrawingBuffer: false,
                    powerPreference: 'low-power'
                });
                if (!this.gl) {
                    console.error('MinaGlass: WebGL2 not supported');
                    choice = 'native';
                } else if (this.gl.isContextLost && this.gl.isContextLost()) {
                    choice = 'native';
                }
            }
        }

        if (choice === 'native' && !MinaGlass.supportsNativeBlur()) choice = 'static';
        this.backend = choice;
        return choice === 'webgl';
    }

    _switchBackend(next) {
        if (this.destroyed || next === this.backend) return;
        if (this.backend === 'native' || this.backend === 'static') this._clearFallbackStyles();

        this.backend = next;
        if (next === 'webgl') {
            if (this.canvas) this.canvas.style.display = '';
            this.contextLost = false;
            this._emptyDrawn = false;
            this.initialize();
            this.setCanvasSize();
            if (this.lastImage) this.uploadTexture(this.lastImage);
            else this.requestRender();
        } else {
            if (this.canvas) this.canvas.style.display = 'none';
            this._teardownGlObjects();
            this._applyFallbackStyles();
        }
    }

    _applyFallbackStyles() {
        if (typeof document === 'undefined') return;
        const cls = this.backend === 'static' ? FALLBACK_CLASS_STATIC : FALLBACK_CLASS_NATIVE;
        this._trackedElements = this._collectElements();
        for (let i = 0; i < this._trackedElements.length; i++) {
            const el = this._trackedElements[i];
            el.classList.remove(FALLBACK_CLASS_NATIVE, FALLBACK_CLASS_STATIC);
            el.classList.add(cls);
        }
    }

    _clearFallbackStyles() {
        const els = this._trackedElements.length ? this._trackedElements : this._collectElements();
        for (let i = 0; i < els.length; i++) {
            els[i].classList.remove(FALLBACK_CLASS_NATIVE, FALLBACK_CLASS_STATIC);
        }
        this._trackedElements = [];
    }

    /* ------------------------------------------------------------------
     * WebGL pipeline
     * ------------------------------------------------------------------ */

    initialize() {
        const gl = this.gl;
        if (!gl) return;

        const vsSource = `#version 300 es
            precision highp float;

            in vec2 position;
            out vec2 fragCoord;

            void main() {
                gl_Position = vec4(position, 0.0, 1.0);
                fragCoord = position * 0.5 + 0.5;
            }
        `;

        const fsSource = this._buildFragmentShader();
        const vs = this.compileShader(vsSource, gl.VERTEX_SHADER);
        const fs = this.compileShader(fsSource, gl.FRAGMENT_SHADER);

        if (!vs || !fs) return;

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('MinaGlass: Program linking failed:', gl.getProgramInfoLog(this.program));
            gl.deleteProgram(this.program);
            this.program = null;
            return;
        }

        gl.useProgram(this.program);

        this.setupVAO();

        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'resolution'),
            texture: gl.getUniformLocation(this.program, 'uTexture'),
            imgRes: gl.getUniformLocation(this.program, 'imgRes'),
            cardPos: gl.getUniformLocation(this.program, 'cardPos'),
            cardHalf: gl.getUniformLocation(this.program, 'cardHalf'),
            cardCount: gl.getUniformLocation(this.program, 'cardCount'),
            white: gl.getUniformLocation(this.program, 'white'),
            saturate: gl.getUniformLocation(this.program, 'saturate')
        };

        this.setupDefaultTexture();
        this.setCanvasSize();
    }

    /**
     * Fragment shader variants by quality tier:
     *   high        - 25 taps (5x5), exact RGB<->HSL saturation (original look)
     *   balanced    - 9 taps (3x3) + mip LOD, cheap luma-mix saturation
     *   performance - single tap blurred entirely via mipmap LOD
     */
    _buildFragmentShader() {
        const high = this.quality === 'high';
        const taps = high ? 25 : (this.quality === 'balanced' ? 9 : 1);

        let sampleBlock;
        if (taps === 25) {
            sampleBlock = `
                    vec4 acc = vec4(0.0);
                    for (int ix = -2; ix <= 2; ix++) {
                        for (int iy = -2; iy <= 2; iy++) {
                            vec2 off = vec2(float(ix), float(iy)) * 2.0 / resolution.xy;
                            acc += textureLod(uTexture, coverUv(lens + off), 0.0);
                        }
                    }
                    acc /= 25.0;`;
        } else if (taps === 9) {
            sampleBlock = `
                    vec4 acc = vec4(0.0);
                    for (int ix = -1; ix <= 1; ix++) {
                        for (int iy = -1; iy <= 1; iy++) {
                            vec2 off = vec2(float(ix), float(iy)) * 4.0 / resolution.xy;
                            acc += textureLod(uTexture, coverUv(lens + off), 1.0);
                        }
                    }
                    acc /= 9.0;`;
        } else {
            sampleBlock = `
                    vec4 acc = textureLod(uTexture, coverUv(lens), 2.5);`;
        }

        return `#version 300 es
            precision highp float;

            uniform vec3 resolution;
            uniform sampler2D uTexture;
            uniform vec2 imgRes;
            uniform vec2 cardPos[8];
            uniform vec2 cardHalf[8];
            uniform int cardCount;
            uniform float white;
            uniform float saturate;

            in vec2 fragCoord;
            out vec4 outColor;

            vec2 coverUv(vec2 uv) {
                float ca = resolution.x / resolution.y;
                float ia = imgRes.x / imgRes.y;
                vec2 s = ca > ia ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);
                return (uv - 0.5) * s + 0.5;
            }

            ${high ? `
            vec3 rgbToHsl(vec3 rgb) {
                float maxC = max(rgb.r, max(rgb.g, rgb.b));
                float minC = min(rgb.r, min(rgb.g, rgb.b));
                float l = (maxC + minC) / 2.0;
                float h = 0.0;
                float s = 0.0;
                if (maxC != minC) {
                    float d = maxC - minC;
                    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
                    if (maxC == rgb.r) {
                        h = mod((rgb.g - rgb.b) / d + (rgb.g < rgb.b ? 6.0 : 0.0), 6.0) / 6.0;
                    } else if (maxC == rgb.g) {
                        h = ((rgb.b - rgb.r) / d + 2.0) / 6.0;
                    } else {
                        h = ((rgb.r - rgb.g) / d + 4.0) / 6.0;
                    }
                }
                return vec3(h, s, l);
            }

            vec3 hslToRgb(vec3 hsl) {
                float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
                float hp = hsl.x * 6.0;
                float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
                vec3 rgb = vec3(0.0);
                if (hp < 1.0) rgb = vec3(c, x, 0.0);
                else if (hp < 2.0) rgb = vec3(x, c, 0.0);
                else if (hp < 3.0) rgb = vec3(0.0, c, x);
                else if (hp < 4.0) rgb = vec3(0.0, x, c);
                else if (hp < 5.0) rgb = vec3(x, 0.0, c);
                else rgb = vec3(c, 0.0, x);
                float m = hsl.z - c / 2.0;
                return rgb + vec3(m);
            }

            vec3 applySaturate(vec3 rgb, float sat) {
                vec3 hsl = rgbToHsl(rgb);
                hsl.y = clamp(hsl.y * sat, 0.0, 1.0);
                return hslToRgb(hsl);
            }` : `
            vec3 applySaturate(vec3 rgb, float sat) {
                float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
                return mix(vec3(luma), rgb, sat);
            }`}

            void main() {
                vec2 fragPx = fragCoord * resolution.xy;
                vec2 uv = fragCoord;

                vec4 bg = texture(uTexture, coverUv(uv));
                vec4 color = bg;

                for (int c = 0; c < 8; c++) {
                    if (c >= cardCount) break;
                    vec2 chalf = cardHalf[c];
                    float radius = max(min(min(chalf.x, chalf.y), 32.0), 1.0);
                    vec2 q = abs(fragPx - cardPos[c]) - (chalf - radius);
                    float sdf = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
                    float roundedBox = 1.0 + sdf / radius;

                    float rb1 = clamp((1.0 - roundedBox) * 8.0, 0.0, 1.0);
                    float rb2 = clamp((0.955 - roundedBox * 0.95) * 16.0, 0.0, 1.0) -
                                clamp((0.91  - roundedBox * 0.95) * 16.0, 0.0, 1.0);
                    float rb3 = clamp((1.5 - roundedBox * 1.1) * 2.0, 0.0, 1.0) -
                                clamp((1.0 - roundedBox * 1.1) * 2.0, 0.0, 1.0);

                    float transition = smoothstep(0.0, 1.0, rb1 + rb2);
                    if (transition <= 0.0) continue;

                    vec2 cuv = cardPos[c] / resolution.xy;
                    vec2 lens = cuv + (uv - cuv) * (1.0 - roundedBox * 0.18);

                    ${sampleBlock}

                    float dy = uv.y - cuv.y;
                    float gradient = clamp((clamp(dy, 0.0, 0.2) + 0.1) / 2.0, 0.0, 1.0) +
                                     clamp((clamp(-dy, -1000.0, 0.2) * rb3 + 0.1) / 2.0, 0.0, 1.0);
                    vec4 lighting = clamp(acc + vec4(rb1) * gradient + vec4(rb2) * 0.3, 0.0, 1.0);

                    lighting.rgb = applySaturate(lighting.rgb, saturate);

                    // Auto-contrast for legible white text: pull bright
                    // backgrounds toward a mid-dark tone, leave dark ones alone.
                    float luma = dot(lighting.rgb, vec3(0.299, 0.587, 0.114));
                    float darken = smoothstep(0.45, 0.85, luma) * 0.55;
                    lighting.rgb = mix(lighting.rgb, lighting.rgb * 0.35, darken);

                    lighting = mix(lighting, vec4(1.0), white * 0.97);

                    color = mix(color, lighting, transition);
                }

                outColor = vec4(color.rgb, 1.0);
            }
        `;
    }

    compileShader(source, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('MinaGlass: Shader compilation failed:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    setupVAO() {
        const gl = this.gl;

        const vertices = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        const posLocation = gl.getAttribLocation(this.program, 'position');
        gl.enableVertexAttribArray(posLocation);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    setupDefaultTexture() {
        const gl = this.gl;

        const width = 512;
        const height = 512;
        const data = new Uint8Array(width * height * 4);

        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const idx = (j * width + i) * 4;
                const dist = Math.sqrt(Math.pow(i - width / 2, 2) + Math.pow(j - height / 2, 2));
                const grad = Math.floor(Math.max(0, 200 - dist / 2));
                data[idx] = grad;
                data[idx + 1] = grad;
                data[idx + 2] = grad;
                data[idx + 3] = 255;
            }
        }

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        this._applyTextureParams(gl);
        gl.generateMipmap(gl.TEXTURE_2D);

        this.imgW = width;
        this.imgH = height;
    }

    _applyTextureParams(gl) {
        // Trilinear min filter + generated mipmaps power the cheap LOD-based
        // blur used by the balanced/performance tiers.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    /**
     * Upload an image/video/canvas as lens source. Very large sources are
     * downscaled once to keep GPU memory and upload time bounded.
     */
    uploadTexture(image) {
        if (this.destroyed) return;
        this.lastImage = image;
        if (!this.gl || this.contextLost || this.backend !== 'webgl') return;

        const source = this._prepareSource(image);
        const gl = this.gl;

        if (!this.texture) this.texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this._applyTextureParams(gl);
        gl.generateMipmap(gl.TEXTURE_2D);

        this.imgW = source.naturalWidth || source.width;
        this.imgH = source.naturalHeight || source.height;
        this._emptyDrawn = false;
        this.requestRender();
    }

    _prepareSource(image) {
        try {
            const w = image.naturalWidth || image.videoWidth || image.width || 0;
            const h = image.naturalHeight || image.videoHeight || image.height || 0;
            if (!w || !h || (w <= MAX_TEXTURE_EDGE && h <= MAX_TEXTURE_EDGE)) return image;

            const ratio = Math.min(MAX_TEXTURE_EDGE / w, MAX_TEXTURE_EDGE / h);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * ratio));
            canvas.height = Math.max(1, Math.round(h * ratio));
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            return canvas;
        } catch (error) {
            return image;
        }
    }

    setSaturate(value) {
        this.config.saturate = Math.max(0, Math.min(2, value));
    }

    setWhiteness(value) {
        this.whiteness = Math.max(0, Math.min(1, value));
    }

    getCanvas() {
        return this.canvas;
    }

    getContext() {
        return this.gl;
    }

    /* ------------------------------------------------------------------
     * Sizing: pixel budget aware
     * ------------------------------------------------------------------ */

    setCanvasSize() {
        if (!this.gl || !this.canvas) return;

        const cssW = Math.max(1, window.innerWidth);
        const cssH = Math.max(1, window.innerHeight);
        const dpr = window.devicePixelRatio || 1;

        let scale = clampValue(dpr, 0.5, 4) * this.renderScale;
        const pixels = cssW * cssH * scale * scale;
        if (pixels > this.maxPixelCount) {
            scale *= Math.sqrt(this.maxPixelCount / pixels);
        }
        scale = clampValue(scale, 0.33, 4);

        const bw = Math.max(1, Math.round(cssW * scale));
        const bh = Math.max(1, Math.round(cssH * scale));

        if (this.canvas.width !== bw) this.canvas.width = bw;
        if (this.canvas.height !== bh) this.canvas.height = bh;
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';

        this.scale = bw / cssW;
        this._emptyDrawn = false;
        this.gl.viewport(0, 0, bw, bh);
    }

    /* ------------------------------------------------------------------
     * Render
     * ------------------------------------------------------------------ */

    render(options = {}) {
        if (this.destroyed || this.contextLost || this.backend !== 'webgl') return;
        const gl = this.gl;
        if (!gl || !this.program || !this.vao) return;

        const scale = this.scale;
        let cards = options.cards;
        if (!cards) {
            const cardPos = options.cardPos || [this.canvas.width / (2 * scale), this.canvas.height / (2 * scale)];
            const cardHalf = options.cardHalf || [300, 200];
            cards = [{ pos: cardPos, half: cardHalf }];
        }

        if (!this._posArr || this._posArr.length !== this.maxCards * 2) {
            this._posArr = new Float32Array(this.maxCards * 2);
            this._halfArr = new Float32Array(this.maxCards * 2);
        }

        const count = Math.min(cards.length, this.maxCards);
        for (let i = 0; i < count; i++) {
            const card = cards[i];
            this._posArr[i * 2] = card.pos[0] * scale;
            this._posArr[i * 2 + 1] = this.canvas.height - card.pos[1] * scale;
            this._halfArr[i * 2] = card.half[0] * scale;
            this._halfArr[i * 2 + 1] = card.half[1] * scale;
        }

        gl.useProgram(this.program);

        gl.uniform3f(this.uniforms.resolution, this.canvas.width, this.canvas.height, 1.0);
        gl.uniform2f(this.uniforms.imgRes, this.imgW, this.imgH);
        gl.uniform2fv(this.uniforms.cardPos, this._posArr);
        gl.uniform2fv(this.uniforms.cardHalf, this._halfArr);
        gl.uniform1i(this.uniforms.cardCount, count);
        gl.uniform1f(this.uniforms.white, this.whiteness);
        gl.uniform1f(this.uniforms.saturate, this.config.saturate);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.uniforms.texture, 0);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    /**
     * Continuous render loop (kept for compatibility). On-demand pages should
     * prefer requestRender()/attachAutoTracking().
     */
    startRender(renderFn) {
        if (this.destroyed) return;
        cancelAnimationFrame(this._loopId);
        const loop = () => {
            if (this.destroyed) return;
            if (renderFn) renderFn();
            else this.render();
            this._loopId = requestAnimationFrame(loop);
        };
        this._loopId = requestAnimationFrame(loop);
    }

    /* ------------------------------------------------------------------
     * Auto tracking: one RAF coalesces layout read -> uniforms -> draw
     * ------------------------------------------------------------------ */

    attachAutoTracking(options = {}) {
        if (this.destroyed || this._tracking) return this;
        this._tracking = true;
        const self = this;

        this.collectCards = function () {
            return self._collectElements().map(function (el) {
                const r = el.getBoundingClientRect();
                return {
                    pos: [r.left + r.width / 2, r.top + r.height / 2],
                    half: [r.width / 2 + 4, r.height / 2 + 4]
                };
            });
        };

        this._cards = this.collectCards();

        const markDirty = function () {
            self._cardsDirty = true;
            self.requestRender();
        };

        this._addEventListener(window, 'scroll', markDirty, { passive: true });

        const onResize = function () {
            if (self.backend === 'webgl') self.setCanvasSize();
            markDirty();
        };

        if (typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(onResize);
            this._resizeObserver.observe(document.documentElement);
            // Tracked liquid elements resize independently of the viewport
            // (layout changes, content growth); observe them too so the lens
            // follows its element. destroy() disconnects the observer.
            this._observedElements = new Set();
            this._collectElements().forEach(function (el) { self._observeElement(el); });
        } else {
            this._addEventListener(window, 'resize', onResize);
        }

        if (this.backend !== 'webgl') this._applyFallbackStyles();

        if (options.background) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () { self.uploadTexture(img); };
            img.src = options.background;
        } else if (this.backend === 'webgl') {
            console.warn('MinaGlass: the WebGL backend paints the full-page background. ' +
                'Pass a "background" option or call uploadTexture(), otherwise the ' +
                'built-in placeholder texture covers the page.');
        }

        this.requestRender();
        return this;
    }

    _observeElement(el) {
        if (!this._resizeObserver || !el || this._observedElements.has(el)) return;
        this._observedElements.add(el);
        this._resizeObserver.observe(el);
    }

    _collectElements() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return [];
        return Array.prototype.slice.call(document.querySelectorAll(LIQUID_SELECTOR)).slice(0, this.maxCards);
    }

    _requestRender() {
        if (this.destroyed || this._rafPending) return;
        this._rafPending = true;
        const self = this;
        this._rafId = requestAnimationFrame(function () {
            self._rafPending = false;
            if (self.destroyed) return;

            if (self.backend !== 'webgl') {
                // Fallback surfaces are CSS-styled; just pick up new elements.
                if (self._cardsDirty) {
                    self._cardsDirty = false;
                    self._applyFallbackStyles();
                }
                return;
            }

            // Single layout read per frame, even when scroll fires many times.
            if (self._cardsDirty && typeof self.collectCards === 'function') {
                self._cardsDirty = false;
                self._cards = self.collectCards();
            }

            const hasCards = self._cards.length > 0;
            if (!hasCards && self._emptyDrawn) return;
            self.render({ cards: self._cards });
            self._emptyDrawn = !hasCards;
        });
    }

    /* ------------------------------------------------------------------
     * Context loss
     * ------------------------------------------------------------------ */

    _setupContextLossHandlers() {
        const self = this;
        const canvas = this.canvas;
        if (!canvas) return;

        this._addEventListener(canvas, 'webglcontextlost', function (event) {
            event.preventDefault();
            self.contextLost = true;
            self._teardownGlObjects();
            // Never leave the page broken: fall back immediately.
            self._switchBackend(MinaGlass.supportsNativeBlur() ? 'native' : 'static');
            console.warn('MinaGlass: WebGL context lost, switched to', self.backend, 'fallback');
        }, false);

        this._addEventListener(canvas, 'webglcontextrestored', function () {
            self.contextLost = false;
            const wantWebGL = self.backendPreference === 'webgl' ||
                (self.backendPreference === 'auto' && MinaGlass.detectBackend(self.quality) === 'webgl');
            if (wantWebGL && self.gl && !self.gl.isContextLost()) {
                self._switchBackend('webgl');
                console.info('MinaGlass: WebGL context restored');
            }
        }, false);
    }

    /* ------------------------------------------------------------------
     * Cleanup
     * ------------------------------------------------------------------ */

    _teardownGlObjects() {
        const gl = this.gl;
        if (!gl) return;
        if (this.program) { gl.deleteProgram(this.program); this.program = null; }
        if (this.texture) { gl.deleteTexture(this.texture); this.texture = null; }
        if (this.vao) { gl.deleteVertexArray(this.vao); this.vao = null; }
        if (this.vbo) { gl.deleteBuffer(this.vbo); this.vbo = null; }
        this.uniforms = {};
    }

    _addEventListener(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        this._listeners.push({ target: target, type: type, fn: fn, opts: opts });
    }

    /**
     * Release every resource: listeners, ResizeObserver, pending animation
     * frames and all WebGL objects.
     */
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;

        cancelAnimationFrame(this._rafId);
        cancelAnimationFrame(this._loopId);
        this._rafPending = false;

        for (let i = 0; i < this._listeners.length; i++) {
            const entry = this._listeners[i];
            entry.target.removeEventListener(entry.type, entry.fn, entry.opts);
        }
        this._listeners.length = 0;

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        this._observedElements.clear();

        this._clearFallbackStyles();
        this._teardownGlObjects();
        this._cards = [];
        this.lastImage = null;
    }
}

// Export for module systems
if (typeof window !== 'undefined') {
    window.MinaGlass = MinaGlass;
    // Temporary runtime alias for pages that still instantiate AquaGlass.
    if (!window.AquaGlass) window.AquaGlass = MinaGlass;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MinaGlass;
}
