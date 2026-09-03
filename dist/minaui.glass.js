/*!
 * minaui.glass.js — MinaLiquid V3
 * MinaUI optional Liquid Glass renderer (WebGL2).
 *
 * MinaLiquid is a dedicated renderer for the "Liquid Glass" surface level.
 * It is NOT a generic backdrop-filter replacement: it cannot read arbitrary
 * DOM behind the glass. Instead it owns a Scene (image / video / gradient /
 * canvas), turns it into GPU textures, builds a blur pyramid from it and
 * refracts that scene through rounded-rect glass elements tracked from the
 * DOM. DOM elements only contribute geometry (position / size / radius);
 * all pixels are produced here.
 *
 * Pipeline:
 *   Scene source
 *     -> Pass 1  Scene Texture  (sceneRT, cover-fit to viewport)
 *     -> Pass 2  Blur Pyramid   (L0 = 1/2, L1 = 1/4, L2 = 1/8, separable
 *                                Gaussian; count depends on quality)
 *     -> Pass 3  Composite      (per-element rounded-rect SDF -> height
 *                                field -> surface normal -> refraction,
 *                                dispersion, fresnel, specular, tint)
 *
 * Glass model: the surface is a rounded box with a circular-cap bevel on the
 * rim. The interior is optically flat (no distortion); curvature, refraction,
 * fresnel and specular grow toward the edge only.
 *
 * Fallback chain: WebGL2 -> CSS frosted (backdrop-filter) -> static surface.
 * Content is never hidden and the page background never turns black.
 *
 * Copyright (c) 2026 oSsmXun
 */

const LIQUID_SELECTOR = '.mina-liquid, [data-mina-liquid]';
const LEGACY_LIQUID_SELECTOR = '.mina-glass--liquid, .mina-glass-liquid, .aqua-glass-liquid';
const FALLBACK_CLASS_NATIVE = 'mina-liquid-native';
const FALLBACK_CLASS_STATIC = 'mina-liquid-static';
const GL_ACTIVE_CLASS = 'mina-liquid-gl';

const MAX_GLASS_ELEMENTS = 16;
const MAX_TEXTURE_EDGE = 2048;
const DEFAULT_MAX_PIXEL_COUNT = 1920 * 1080;

/* Global glass appearance. "blur" is expressed in design px and mapped to a
 * blur-pyramid LOD; refraction is a fraction of the edge width; dispersion
 * offsets are relative to the refraction offset (kept tiny on purpose). */
const DEFAULT_GLASS = {
    refraction: 0.22,
    blur: 12,
    fresnel: 0.22,
    specular: 0.22,
    dispersion: 0.045,
    edgeBlur: 0.45,
    edgeShadow: 0.24,
    edgeWidth: 0.2,
    tint: 0.05,
    tintColor: [1.0, 1.0, 1.0],
    saturation: 1.08,
    brightness: 1.0
};

/* Pipeline shape per quality tier. quality stays a WebGL tier; environment
 * problems (no WebGL2 / WebKit / touch-first) fall back to CSS frost. */
const QUALITY_CONFIG = {
    high:        { pyramidLevels: 3, dispersionScale: 1.0,  renderScaleCap: 3,   maxPixelCount: DEFAULT_MAX_PIXEL_COUNT * 1.5, shaderMode: 'full' },
    balanced:    { pyramidLevels: 2, dispersionScale: 0.6,  renderScaleCap: 1.5, maxPixelCount: DEFAULT_MAX_PIXEL_COUNT,       shaderMode: 'lite' },
    performance: { pyramidLevels: 0, dispersionScale: 0.0,  renderScaleCap: 1.0, maxPixelCount: 1280 * 720,                    shaderMode: 'perf' }
};

function clampValue(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function parsePixel(value) {
    const n = parseFloat(value);
    return isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------------
 * Shaders
 * --------------------------------------------------------------------- */

const QUAD_VERTEX_SOURCE = `#version 300 es
precision highp float;
in vec2 position;
out vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

/* Pass 1: cover-fit the scene source into a viewport-sized RT. */
const SCENE_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uImgRes;
uniform vec2 uOutRes;
in vec2 vUv;
out vec4 outColor;
void main() {
    float ca = uOutRes.x / uOutRes.y;
    float ia = uImgRes.x / uImgRes.y;
    vec2 s = ca > ia ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);
    outColor = vec4(texture(uTex, (vUv - 0.5) * s + 0.5).rgb, 1.0);
}`;

/* Pass 2 helper: separable 9-tap Gaussian. uDir = (1/w,0) or (0,1/h) of the
 * source; uDir = (0,0) turns it into a plain copy (used for downsampling). */
const BLUR_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;
in vec2 vUv;
out vec4 outColor;
void main() {
    vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
    c += texture(uTex, vUv + uDir * 1.0).rgb * 0.1945945946;
    c += texture(uTex, vUv - uDir * 1.0).rgb * 0.1945945946;
    c += texture(uTex, vUv + uDir * 2.0).rgb * 0.1216216216;
    c += texture(uTex, vUv - uDir * 2.0).rgb * 0.1216216216;
    c += texture(uTex, vUv + uDir * 3.0).rgb * 0.0540540541;
    c += texture(uTex, vUv - uDir * 3.0).rgb * 0.0540540541;
    c += texture(uTex, vUv + uDir * 4.0).rgb * 0.0162162162;
    c += texture(uTex, vUv - uDir * 4.0).rgb * 0.0162162162;
    outColor = vec4(c, 1.0);
}`;

/**
 * Pass 3: composite. Exposed for tests: build per quality shaderMode
 * ('full' = 3 pyramid levels, 'lite' = 2 levels, 'perf' = mip-only).
 *
 * Geometry: for each tracked element a rounded-box SDF selects the owning
 * glass and provides an analytic outward gradient. A circular-cap bevel
 * h(t) = 1 - sqrt(1 - t^2) (t = 0 center -> 1 rim) gives the surface slope;
 * refraction offsets grow with the slope, so the center stays flat.
 */
function buildCompositeShaderSource(mode) {
    const perf = mode === 'perf';
    const full = mode === 'full';
    return `#version 300 es
precision highp float;

#define MAX_ELEMENTS ${MAX_GLASS_ELEMENTS}
${perf ? '' : `uniform sampler2D uScene;   // sharp scene (sceneRT)
uniform sampler2D uB0;
uniform sampler2D uB1;`}
${full ? 'uniform sampler2D uB2;' : ''}
${perf ? `uniform sampler2D uScene;      // mip-mapped source
uniform vec2 uImgRes;` : ''}
uniform vec2 uResolution;
uniform int uCount;
uniform vec4 uRect[MAX_ELEMENTS];   // cx, cy (GL px), halfW, halfH
uniform vec4 uShape[MAX_ELEMENTS];  // radiusPx, blurLod, refractionScale, tintStrength
uniform vec3 uTintColor;
uniform float uRefraction;
uniform float uEdgeWidth;
uniform float uFresnel;
uniform float uSpecular;
uniform float uDispersion;
uniform float uEdgeBlur;
uniform float uEdgeShadow;
uniform float uSaturation;
uniform float uBrightness;
uniform float uTint;
uniform float uHasScene;

in vec2 vUv;
out vec4 outColor;

${perf ? `
vec2 coverUv(vec2 uv) {
    float ca = uResolution.x / uResolution.y;
    float ia = uImgRes.x / uImgRes.y;
    vec2 s = ca > ia ? vec2(1.0, ia / ca) : vec2(ca / ia, 1.0);
    return (uv - 0.5) * s + 0.5;
}
vec3 sampleScene(vec2 uvPx, float lod) {
    vec2 uv = uvPx / uResolution;
    return textureLod(uScene, coverUv(uv), lod).rgb;
}` : `
vec3 sampleScene(vec2 uvPx, float lod) {
    vec2 uv = uvPx / uResolution;
    lod = clamp(lod, 0.0, ${full ? '2.5' : '1.5'});
    if (lod < 0.5) {
        vec3 sharp = texture(uScene, uv).rgb;
        return lod <= 0.0 ? sharp : mix(sharp, texture(uB0, uv).rgb, lod * 2.0);
    }
    if (lod < 1.5) {
        return mix(texture(uB0, uv).rgb, texture(uB1, uv).rgb, lod - 0.5);
    }
    ${full ? 'return mix(texture(uB1, uv).rgb, texture(uB2, uv).rgb, lod - 1.5);' : 'return texture(uB1, uv).rgb;'}
}`}

float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - (b - r);
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/* Analytic outward gradient of the rounded-box SDF (unit length). */
vec2 sdRoundBoxGrad(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - (b - r);
    vec2 s = sign(p) + vec2(1e-6);
    if (q.x > 0.0 && q.y > 0.0) return normalize(s * q);
    return q.x > q.y ? vec2(s.x, 0.0) : vec2(0.0, s.y);
}

void main() {
    vec2 fragPx = vUv * uResolution;
    ${perf
        ? 'vec3 color = uHasScene > 0.5 ? sampleScene(fragPx, clamp(uEdgeBlur, 1.0, 4.0)) : vec3(0.0);'
        : 'vec3 color = texture(uScene, vUv).rgb;'}

    int owner = -1;
    float bestSdf = 1e9;
    for (int i = 0; i < MAX_ELEMENTS; i++) {
        if (i >= uCount) break;
        vec4 rect = uRect[i];
        float sd = sdRoundBox(fragPx - rect.xy, rect.zw, uShape[i].x);
        if (sd < bestSdf) { bestSdf = sd; owner = i; }
    }

    if (owner >= 0 && bestSdf < 12.0) {
        vec4 rect = uRect[owner];
        vec4 shape = uShape[owner];
        vec2 half_ = rect.zw;
        vec2 p = fragPx - rect.xy;

        float d = -bestSdf;                                  // >0 inside
        float w = clamp(uEdgeWidth * min(half_.x, half_.y), 8.0, 56.0);
        float t = 1.0 - clamp(d / w, 0.0, 1.0);              // 0 center -> 1 rim

        vec2 gdir = sdRoundBoxGrad(p, half_, shape.x);
        float tc = min(t, 0.985);
        float slope = tc / sqrt(max(1.0 - tc * tc, 1e-4));   // circular-cap bevel
        vec2 n2 = gdir * slope;

        float lod = shape.y + t * uEdgeBlur;
        vec2 refractPx = n2 * uRefraction * w * shape.z;
        vec2 ruv = fragPx + refractPx;

        vec3 col;
        ${perf
            ? 'col = sampleScene(ruv, lod);'
            : `
        if (uDispersion > 0.0001) {
            vec2 dispPx = refractPx * uDispersion * t;
            col.r = sampleScene(ruv + dispPx, lod).r;
            col.g = sampleScene(ruv, lod).g;
            col.b = sampleScene(ruv - dispPx, lod).b;
        } else {
            col = sampleScene(ruv, lod);
        }`}

        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(luma), col, uSaturation);
        col = mix(col, col * uTintColor, uTint * shape.w);
        col *= uBrightness;

        // inner contact shadow on the side away from the key light
        float shade = smoothstep(0.45, 1.0, t) * clamp(-gdir.y, 0.0, 1.0);
        col *= 1.0 - uEdgeShadow * shade;

        // lighting: fresnel rim + directional specular, both edge-weighted
        vec3 N = normalize(vec3(n2, 1.0));
        float fres = pow(1.0 - clamp(N.z, 0.0, 1.0), 3.0);
        vec3 L = normalize(vec3(-0.32, 0.5, 0.8));
        vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
        float spec = pow(max(dot(N, H), 0.0), 42.0);
        float topLight = 0.55 + 0.45 * clamp(gdir.y, 0.0, 1.0);
        col += uFresnel * fres * topLight;
        col += uSpecular * spec * topLight;

        float cov = clamp(0.5 - bestSdf, 0.0, 1.0);
        color = mix(color, col, cov);

        // soft outer contact shadow grounds the glass
        float outer = 1.0 - clamp(bestSdf / 10.0, 0.0, 1.0);
        color = mix(color, color * (1.0 - uEdgeShadow * 0.4), outer * (1.0 - cov));
    }

    float alpha = uHasScene > 0.5 ? 1.0 : 0.0;
    outColor = vec4(color * alpha, alpha);
}`;
}

/* ---------------------------------------------------------------------
 * MinaLiquid
 * --------------------------------------------------------------------- */

class MinaLiquid {
    constructor(options = {}) {
        this.destroyed = false;
        this.options = Object.assign({}, options);

        this.quality = MinaLiquid.normalizeQuality(
            options.quality !== undefined
                ? options.quality
                : (typeof document !== 'undefined' && document.documentElement
                    ? document.documentElement.getAttribute('data-mina-performance')
                    : null)
        );

        this.renderScale = clampValue(
            typeof options.renderScale === 'number' && isFinite(options.renderScale) ? options.renderScale : 1, 0.25, 4);
        this.maxPixelCount = typeof options.maxPixelCount === 'number' && options.maxPixelCount > 0
            ? Math.floor(options.maxPixelCount)
            : QUALITY_CONFIG[this.quality].maxPixelCount;
        this.maxElements = clampValue(Math.floor(options.maxElements || 8), 1, MAX_GLASS_ELEMENTS);
        this.selector = typeof options.selector === 'string' ? options.selector : LIQUID_SELECTOR;

        this.glass = Object.assign({}, DEFAULT_GLASS, options.glass || {});
        this.glass.tintColor = (options.glass && options.glass.tintColor) || DEFAULT_GLASS.tintColor.slice();

        this.backendPreference = MinaLiquid.normalizeBackend(options.backend);
        this.backend = 'static';
        this.state = 'idle';   // idle | ready | fallback-frost | fallback-static | destroyed

        this.canvas = options.canvas
            || (typeof document !== 'undefined' ? document.getElementById('mina-glcanvas') : null)
            || null;
        this._ownsCanvas = false;

        this.gl = null;
        this.contextLost = false;
        this._programs = {};
        this._uniforms = {};
        this._quad = null;
        this._sceneTex = null;
        this._imgW = 1;
        this._imgH = 1;
        this._hasScene = false;
        this._targets = null;
        this._targetW = 0;
        this._targetH = 0;
        this._bufferW = 1;
        this._bufferH = 1;
        this._drawScale = 1;
        this._emptyDrawn = false;

        this._sourceSpec = null;
        this._sourceEl = null;
        this._videoActive = false;

        this._elements = [];
        this._geometryDirty = true;
        this._sceneDirty = true;
        this._rafPending = false;
        this._rafId = 0;
        this._listeners = [];
        this._resizeObserver = null;
        this._observedElements = new Set();
        this._rectArray = new Float32Array(MAX_GLASS_ELEMENTS * 4);
        this._shapeArray = new Float32Array(MAX_GLASS_ELEMENTS * 4);
        this._stats = { draws: 0, lastDrawMs: 0 };

        if (this._resolveBackend()) {
            this._initGl();
            this._setupContextLossHandlers();
            this._applyCanvasSize();
            this._attachAutoTracking();
        } else {
            if (this.canvas) this.canvas.style.display = 'none';
            this._syncElementClasses();
            this._attachAutoTracking();
        }

        if (options.source) this.setSource(options.source);
    }

    /* ---------------- static helpers ---------------- */

    static normalizeQuality(value) {
        if (value === 'high' || value === 'quality') return 'high';
        if (value === 'balanced' || value === 'medium' || value === 'balance') return 'balanced';
        if (value === 'performance' || value === 'low' || value === 'fast') return 'performance';
        return 'balanced';
    }

    static normalizeBackend(value) {
        return value === 'webgl' || value === 'native' || value === 'static' ? value : 'auto';
    }

    static supportsNativeBlur() {
        if (typeof CSS === 'undefined' || !CSS.supports) return true;
        return CSS.supports('backdrop-filter: blur(1px)') || CSS.supports('-webkit-backdrop-filter: blur(1px)');
    }

    static detectBackend() {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'webgl';
        if (!('WebGL2RenderingContext' in window)) return 'native';

        const ua = navigator.userAgent || '';
        const isIOS = /iP(hone|od|ad)/i.test(ua) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isWebKit = /AppleWebKit/i.test(ua) && !/Chrom(e|ium)|Edg\//i.test(ua);
        if (isIOS || isWebKit) return 'native';
        if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return 'native';
        return 'webgl';
    }

    static isSupported() {
        if (typeof window === 'undefined' || !('WebGL2RenderingContext' in window)) return false;
        try {
            const canvas = document.createElement('canvas');
            return !!(canvas.getContext && canvas.getContext('webgl2'));
        } catch (error) {
            return false;
        }
    }

    static autoInit(options = {}) {
        return new MinaLiquid(options);
    }

    /* ---------------- backend resolution ---------------- */

    _resolveBackend() {
        let choice = this.backendPreference;
        if (choice === 'auto') choice = MinaLiquid.detectBackend();

        if (choice === 'webgl') {
            if (!this.canvas && typeof document !== 'undefined') {
                const hasLiquid = typeof document.querySelector === 'function' &&
                    !!(document.querySelector(this.selector + ', ' + LEGACY_LIQUID_SELECTOR));
                if (hasLiquid) {
                    this.canvas = document.createElement('canvas');
                    this.canvas.id = 'mina-glcanvas';
                    this.canvas.setAttribute('aria-hidden', 'true');
                    (document.body || document.documentElement).appendChild(this.canvas);
                    this._ownsCanvas = true;
                } else {
                    console.warn('MinaLiquid: no liquid elements found, staying idle.');
                    choice = 'native';
                }
            }
            if (choice === 'webgl') {
                if (!this.canvas) {
                    console.warn('MinaLiquid: canvas element not found');
                    choice = 'native';
                } else {
                    this.gl = this.canvas.getContext('webgl2', {
                        antialias: false,
                        depth: false,
                        stencil: false,
                        // Alpha stays on so the canvas is transparent until the
                        // first frame (never an opaque black layer).
                        alpha: true,
                        premultipliedAlpha: true,
                        preserveDrawingBuffer: false,
                        powerPreference: 'low-power'
                    });
                    if (!this.gl) {
                        console.error('MinaLiquid: WebGL2 not supported');
                        choice = 'native';
                    } else if (this.gl.isContextLost && this.gl.isContextLost()) {
                        choice = 'native';
                    }
                }
            }
        }

        if (choice === 'native' && !MinaLiquid.supportsNativeBlur()) choice = 'static';
        this.backend = choice;
        this.state = choice === 'webgl' ? 'ready' : (choice === 'native' ? 'fallback-frost' : 'fallback-static');
        return choice === 'webgl';
    }

    _initGl() {
        const gl = this.gl;
        if (!gl) return;

        this._quad = this._createQuad();
        const programs = {
            scene: this._createProgram(SCENE_SHADER_SOURCE),
            blur: this._createProgram(BLUR_SHADER_SOURCE),
            composite: this._createProgram(buildCompositeShaderSource(QUALITY_CONFIG[this.quality].shaderMode))
        };
        if (!programs.composite) {
            // Shader setup failed: degrade to CSS frost instead of a black page.
            console.error('MinaLiquid: composite program failed, falling back to CSS frost');
            this._switchBackend(MinaLiquid.supportsNativeBlur() ? 'native' : 'static');
            return;
        }
        this._programs = programs;
        this._cacheUniforms();

        this._sceneTex = this._createTexture(true);
        this._ensureTargets();
    }

    _createQuad() {
        const gl = this.gl;
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        return { vbo, vao };
    }

    _compileShader(source, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('MinaLiquid: shader compile failed:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    _createProgram(fragmentSource) {
        const gl = this.gl;
        const vs = this._compileShader(QUAD_VERTEX_SOURCE, gl.VERTEX_SHADER);
        const fs = this._compileShader(fragmentSource, gl.FRAGMENT_SHADER);
        if (!vs || !fs) return null;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.bindAttribLocation(program, 0, 'position');
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('MinaLiquid: program link failed:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        return program;
    }

    _cacheUniforms() {
        const gl = this.gl;
        const names = {};
        for (const key of Object.keys(this._programs)) {
            const program = this._programs[key];
            if (!program) continue;
            names[key] = {};
            const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < count; i++) {
                const info = gl.getActiveUniform(program, i);
                const name = info.name.replace(/\[0\]$/, '');
                names[key][name] = gl.getUniformLocation(program, name);
            }
        }
        this._uniforms = names;
    }

    _createTexture(mipmap) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    _createRT(width, height) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { fbo, tex, width, height };
    }

    _destroyRT(rt) {
        if (!rt || !this.gl) return;
        if (rt.fbo) this.gl.deleteFramebuffer(rt.fbo);
        if (rt.tex) this.gl.deleteTexture(rt.tex);
    }

    _ensureTargets() {
        const gl = this.gl;
        if (!gl) return;
        const w = this._bufferW;
        const h = this._bufferH;
        if (this._targets && this._targetW === w && this._targetH === h) return;
        this._destroyTargets();

        const levels = QUALITY_CONFIG[this.quality].pyramidLevels;
        const targets = { sceneRT: this._createRT(w, h) };
        if (levels >= 1) {
            targets.L0 = this._createRT(Math.max(1, w >> 1), Math.max(1, h >> 1));
            targets.T0 = this._createRT(Math.max(1, w >> 1), Math.max(1, h >> 1));
        }
        if (levels >= 2) {
            targets.L1 = this._createRT(Math.max(1, w >> 2), Math.max(1, h >> 2));
            targets.T1 = this._createRT(Math.max(1, w >> 2), Math.max(1, h >> 2));
        }
        if (levels >= 3) {
            targets.L2 = this._createRT(Math.max(1, w >> 3), Math.max(1, h >> 3));
            targets.T2 = this._createRT(Math.max(1, w >> 3), Math.max(1, h >> 3));
        }
        this._targets = targets;
        this._targetW = w;
        this._targetH = h;
    }

    _destroyTargets() {
        if (!this._targets) return;
        for (const key of Object.keys(this._targets)) this._destroyRT(this._targets[key]);
        this._targets = null;
        this._targetW = 0;
        this._targetH = 0;
    }

    /* ---------------- scene sources ---------------- */

    /**
     * Set the scene the glass refracts. Accepted specs:
     *   { type: 'image',    src: '/bg.jpg' }          (or { el: HTMLImageElement })
     *   { type: 'video',    src: '/bg.mp4' }          (or { el: HTMLVideoElement })
     *   { type: 'canvas',   el: HTMLCanvasElement }
     *   { type: 'gradient', stops: [[0,'#a'],[1,'#b']], angle?: 135 }
     * A source is always renderer-owned; DOM is never captured.
     */
    setSource(spec) {
        if (this.destroyed || !spec) return;
        const type = spec.type || (spec.el ? 'element' : 'image');
        this._sourceSpec = Object.assign({ type }, spec);
        this._videoActive = false;

        if (type === 'image') {
            if (spec.el && spec.el.complete !== false) {
                this._adoptSourceElement(spec.el);
                return;
            }
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const self = this;
            img.onload = function () { if (!self.destroyed) self._adoptSourceElement(img); };
            img.onerror = function () {
                console.error('MinaLiquid: scene image failed to load:', spec.src);
                if (!self.destroyed) self._clearScene();
            };
            img.src = spec.src;
        } else if (type === 'video') {
            let video = spec.el;
            if (!video && typeof document !== 'undefined') {
                video = document.createElement('video');
                video.muted = true;
                video.loop = true;
                video.playsInline = true;
                video.setAttribute('playsinline', '');
                const self = this;
                video.addEventListener('playing', function () { self._videoActive = true; });
                video.addEventListener('pause', function () { self._videoActive = false; });
                video.src = spec.src;
                video.play().catch(function () { /* autoplay blocked: first frame still usable */ });
            }
            this._sourceEl = video;
            this._sceneDirty = true;
            this.requestRender();
        } else if (type === 'gradient') {
            this._adoptSourceElement(this._buildGradientCanvas(spec));
        } else if (type === 'canvas' || type === 'element') {
            this._adoptSourceElement(spec.el);
        } else {
            console.warn('MinaLiquid: unknown source type:', type);
        }
    }

    _adoptSourceElement(el) {
        if (!el) { this._clearScene(); return; }
        this._sourceEl = el;
        this._sceneDirty = true;
        this._emptyDrawn = false;
        this.requestRender();
    }

    _clearScene() {
        this._sourceEl = null;
        this._hasScene = false;
        this._sceneDirty = true;
        this.requestRender();
    }

    _buildGradientCanvas(spec) {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        const stops = Array.isArray(spec.stops) && spec.stops.length >= 2
            ? spec.stops
            : [[0, '#0b0716'], [0.5, '#ec4899'], [1, '#8b5cf6']];
        const angle = typeof spec.angle === 'number' ? spec.angle : 135;
        const rad = angle * Math.PI / 180;
        const grad = ctx.createLinearGradient(0, 0, 1024 * Math.cos(rad), 1024 * Math.sin(rad));
        for (const [offset, color] of stops) grad.addColorStop(clampValue(offset, 0, 1), color);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1024, 1024);
        return canvas;
    }

    /* ---------------- appearance / quality ---------------- */

    setGlass(partial) {
        if (!partial) return;
        for (const key of Object.keys(DEFAULT_GLASS)) {
            if (partial[key] === undefined) continue;
            if (key === 'tintColor') {
                this.glass.tintColor = partial.tintColor.slice();
            } else {
                this.glass[key] = partial[key];
            }
        }
        this.requestRender();
    }

    setQuality(quality) {
        const next = MinaLiquid.normalizeQuality(quality);
        if (next === this.quality || this.destroyed) return;
        this.quality = next;
        this.maxPixelCount = this.options.maxPixelCount || QUALITY_CONFIG[next].maxPixelCount;
        if (this.backend !== 'webgl') return;
        this._rebuildPipeline();
    }

    _rebuildPipeline() {
        const gl = this.gl;
        if (!gl) return;
        if (this._programs.composite) gl.deleteProgram(this._programs.composite);
        this._programs.composite = this._createProgram(buildCompositeShaderSource(QUALITY_CONFIG[this.quality].shaderMode));
        if (!this._programs.composite) {
            this._switchBackend(MinaLiquid.supportsNativeBlur() ? 'native' : 'static');
            return;
        }
        this._cacheUniforms();
        this._destroyTargets();
        this._applyCanvasSize();
        this._sceneDirty = true;
        this._geometryDirty = true;
        this.requestRender();
    }

    /* ---------------- sizing ---------------- */

    _applyCanvasSize() {
        if (!this.gl || !this.canvas || typeof window === 'undefined') return;

        const cssW = Math.max(1, window.innerWidth);
        const cssH = Math.max(1, window.innerHeight);
        const dpr = clampValue(window.devicePixelRatio || 1, 0.5, 3);
        const cfg = QUALITY_CONFIG[this.quality];

        let scale = Math.min(dpr, cfg.renderScaleCap) * this.renderScale;
        const pixels = cssW * cssH * scale * scale;
        if (pixels > this.maxPixelCount) scale *= Math.sqrt(this.maxPixelCount / pixels);
        scale = clampValue(scale, 0.5, 4);

        const bw = Math.max(1, Math.round(cssW * scale));
        const bh = Math.max(1, Math.round(cssH * scale));
        const changed = this.canvas.width !== bw || this.canvas.height !== bh;
        if (changed) {
            this.canvas.width = bw;
            this.canvas.height = bh;
        }
        this.canvas.style.width = cssW + 'px';
        this.canvas.style.height = cssH + 'px';
        this._bufferW = bw;
        this._bufferH = bh;
        this._drawScale = bw / cssW;
        if (changed) {
            this._ensureTargets();
            this._sceneDirty = true;
        }
        this._geometryDirty = true;
    }

    /* ---------------- scene passes ---------------- */

    _uploadScene() {
        const gl = this.gl;
        const el = this._sourceEl;
        if (!gl || !el) { this._hasScene = false; return; }

        const w = el.naturalWidth || el.videoWidth || el.width || 0;
        const h = el.naturalHeight || el.videoHeight || el.height || 0;
        if (!w || !h) { this._hasScene = false; return; }

        let source = el;
        if (w > MAX_TEXTURE_EDGE || h > MAX_TEXTURE_EDGE) {
            const ratio = Math.min(MAX_TEXTURE_EDGE / w, MAX_TEXTURE_EDGE / h);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * ratio));
            canvas.height = Math.max(1, Math.round(h * ratio));
            canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
            source = canvas;
        }

        gl.bindTexture(gl.TEXTURE_2D, this._sceneTex);
        try {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.generateMipmap(gl.TEXTURE_2D);
            this._imgW = source.naturalWidth || source.width;
            this._imgH = source.naturalHeight || source.height;
            this._hasScene = true;
        } catch (error) {
            // Tainted canvas / CORS failure: keep the page usable via fallback.
            console.error('MinaLiquid: scene upload failed:', error && error.message);
            this._hasScene = false;
        }
    }

    _drawPass(program, uniforms, target, textures) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        const w = target ? target.width : this._bufferW;
        const h = target ? target.height : this._bufferH;
        gl.viewport(0, 0, w, h);
        gl.useProgram(program);
        let unit = 0;
        for (const name of Object.keys(textures)) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, textures[name]);
            if (uniforms[name]) gl.uniform1i(uniforms[name], unit);
            unit++;
        }
        gl.bindVertexArray(this._quad.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    _renderSceneChain() {
        const gl = this.gl;
        if (!gl) return;
        const cfg = QUALITY_CONFIG[this.quality];
        this._ensureTargets();
        if (cfg.pyramidLevels === 0) { this._uploadScene(); return; }

        this._uploadScene();
        if (!this._hasScene) return;

        const targets = this._targets;
        const su = this._uniforms.scene;
        const bu = this._uniforms.blur;

        // Pass 1: cover-fit scene into sceneRT (program in use before uniforms)
        gl.useProgram(this._programs.scene);
        if (su.uImgRes) gl.uniform2f(su.uImgRes, this._imgW, this._imgH);
        if (su.uOutRes) gl.uniform2f(su.uOutRes, this._bufferW, this._bufferH);
        this._drawPass(this._programs.scene, su, targets.sceneRT, { uTex: this._sceneTex });

        // Pass 2: pyramid (copy-down + separable blur per level)
        gl.useProgram(this._programs.blur);
        let prev = targets.sceneRT;
        const level = (L, T) => {
            if (bu.uDir) gl.uniform2f(bu.uDir, 0, 0);
            this._drawPass(this._programs.blur, bu, L, { uTex: prev.tex });
            if (bu.uDir) gl.uniform2f(bu.uDir, 1 / L.width, 0);
            this._drawPass(this._programs.blur, bu, T, { uTex: L.tex });
            if (bu.uDir) gl.uniform2f(bu.uDir, 0, 1 / L.height);
            this._drawPass(this._programs.blur, bu, L, { uTex: T.tex });
            prev = L;
        };
        if (targets.L0) level(targets.L0, targets.T0);
        if (targets.L1) level(targets.L1, targets.T1);
        if (targets.L2) level(targets.L2, targets.T2);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* ---------------- composite ---------------- */

    _drawComposite() {
        const gl = this.gl;
        const program = this._programs.composite;
        if (!gl || !program) return;

        const u = this._uniforms.composite;
        const g = this.glass;
        const cfg = QUALITY_CONFIG[this.quality];

        const count = Math.min(this._elements.length, this.maxElements);
        for (let i = 0; i < count; i++) {
            const el = this._elements[i];
            const rect = el.getBoundingClientRect();
            const scale = this._drawScale;
            const halfW = Math.max(1, rect.width * 0.5 * scale);
            const halfH = Math.max(1, rect.height * 0.5 * scale);
            const cx = (rect.left + rect.width * 0.5) * scale;
            const cy = this._bufferH - (rect.top + rect.height * 0.5) * scale;

            const radiusCss = MinaLiquid.describeElement(el).radius;
            const radius = clampValue(radiusCss * scale, 1, Math.min(halfW, halfH));
            const blurPx = parsePixel(el.getAttribute('data-mina-blur'));
            const blurLod = clampValue((blurPx !== null ? blurPx : g.blur) / 10, 0, 2.5);
            const refraction = parsePixel(el.getAttribute('data-mina-refraction'));
            const tint = parsePixel(el.getAttribute('data-mina-tint'));

            this._rectArray[i * 4] = cx;
            this._rectArray[i * 4 + 1] = cy;
            this._rectArray[i * 4 + 2] = halfW;
            this._rectArray[i * 4 + 3] = halfH;
            this._shapeArray[i * 4] = radius;
            this._shapeArray[i * 4 + 1] = blurLod;
            this._shapeArray[i * 4 + 2] = refraction !== null ? refraction : 1;
            this._shapeArray[i * 4 + 3] = tint !== null ? tint : 1;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this._bufferW, this._bufferH);
        gl.useProgram(program);

        if (u.uResolution) gl.uniform2f(u.uResolution, this._bufferW, this._bufferH);
        if (u.uImgRes) gl.uniform2f(u.uImgRes, this._imgW, this._imgH);
        if (u.uCount) gl.uniform1i(u.uCount, count);
        if (u.uRect) gl.uniform4fv(u.uRect, this._rectArray);
        if (u.uShape) gl.uniform4fv(u.uShape, this._shapeArray);
        if (u.uTintColor) gl.uniform3f(u.uTintColor, g.tintColor[0], g.tintColor[1], g.tintColor[2]);
        if (u.uRefraction) gl.uniform1f(u.uRefraction, g.refraction);
        if (u.uEdgeWidth) gl.uniform1f(u.uEdgeWidth, g.edgeWidth);
        if (u.uFresnel) gl.uniform1f(u.uFresnel, g.fresnel);
        if (u.uSpecular) gl.uniform1f(u.uSpecular, g.specular);
        if (u.uDispersion) gl.uniform1f(u.uDispersion, g.dispersion * cfg.dispersionScale);
        if (u.uEdgeBlur) gl.uniform1f(u.uEdgeBlur, cfg.pyramidLevels === 0 ? clampValue(g.blur / 8, 1, 4) : g.edgeBlur);
        if (u.uEdgeShadow) gl.uniform1f(u.uEdgeShadow, g.edgeShadow);
        if (u.uSaturation) gl.uniform1f(u.uSaturation, g.saturation);
        if (u.uBrightness) gl.uniform1f(u.uBrightness, g.brightness);
        if (u.uTint) gl.uniform1f(u.uTint, g.tint);
        if (u.uHasScene) gl.uniform1f(u.uHasScene, this._hasScene ? 1 : 0);

        const textures = {};
        if (cfg.pyramidLevels === 0) {
            textures.uScene = this._sceneTex;
        } else {
            if (!this._targets) return;
            textures.uScene = this._targets.sceneRT.tex;
            if (this._targets.L0) textures.uB0 = this._targets.L0.tex;
            if (this._targets.L1) textures.uB1 = this._targets.L1.tex;
            if (this._targets.L2) textures.uB2 = this._targets.L2.tex;
        }
        let unit = 0;
        for (const name of Object.keys(textures)) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, textures[name]);
            if (u[name]) gl.uniform1i(u[name], unit);
            unit++;
        }

        gl.bindVertexArray(this._quad.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        this._stats.draws++;
    }

    /* ---------------- DOM tracking ---------------- */

    _attachAutoTracking() {
        if (this._tracking) return;
        this._tracking = true;
        const self = this;

        const markGeometry = function () {
            self._geometryDirty = true;
            self.requestRender();
        };

        if (typeof document !== 'undefined') {
            this._addEventListener(document, 'scroll', markGeometry, { passive: true, capture: true });
        }

        const onResize = function () {
            if (self.backend === 'webgl') self._applyCanvasSize();
            markGeometry();
        };

        if (typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(onResize);
            if (typeof document !== 'undefined' && document.documentElement) {
                this._resizeObserver.observe(document.documentElement);
            }
        } else if (typeof window !== 'undefined') {
            this._addEventListener(window, 'resize', onResize);
        }

        if (typeof document !== 'undefined' && document.addEventListener) {
            this._addEventListener(document, 'visibilitychange', function () {
                if (document.hidden) {
                    self._cancelFrame();
                } else {
                    self._sceneDirty = true;
                    self._geometryDirty = true;
                    self.requestRender();
                }
            });
        }

        this._syncElementClasses();
        this.requestRender();
    }

    _addEventListener(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        this._listeners.push({ target, type, fn, opts });
    }

    /**
     * Collect visible liquid elements. Culls: display:none subtrees
     * (offsetParent), visibility:hidden, zero-size and off-viewport rects.
     */
    _collectElements() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return [];
        const nodes = document.querySelectorAll(this.selector + ', ' + LEGACY_LIQUID_SELECTOR);
        const out = [];
        const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
        const margin = 120;
        for (let i = 0; i < nodes.length && out.length < this.maxElements; i++) {
            const desc = MinaLiquid.describeElement(nodes[i]);
            if (desc.hidden || desc.zeroSize || desc.offscreen(vw, vh, margin)) continue;
            out.push(nodes[i]);
        }
        return out;
    }

    /**
     * Pure geometry probe for one element (unit-testable without GL).
     */
    static describeElement(el) {
        let hidden = false;
        if (!el || el.nodeType !== 1) hidden = true;
        if (!hidden && el.offsetParent === null) {
            let position = null;
            if (typeof getComputedStyle === 'function') {
                try { position = getComputedStyle(el).position; } catch (error) { position = null; }
            }
            if (position !== 'fixed') hidden = true;
        }
        if (!hidden && typeof getComputedStyle === 'function') {
            try { if (getComputedStyle(el).visibility === 'hidden') hidden = true; } catch (error) { /* keep */ }
        }

        let rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
        if (!hidden && typeof el.getBoundingClientRect === 'function') {
            rect = el.getBoundingClientRect();
        }
        const zeroSize = rect.width < 2 || rect.height < 2;

        let radius = 24;
        if (typeof getComputedStyle === 'function') {
            try {
                const cs = getComputedStyle(el);
                const parsed = parsePixel(cs.borderTopLeftRadius);
                if (parsed !== null) radius = parsed;
            } catch (error) { /* keep default */ }
        }
        const radiusAttr = el && typeof el.getAttribute === 'function'
            ? parsePixel(el.getAttribute('data-mina-radius'))
            : null;
        if (radiusAttr !== null) radius = radiusAttr;

        return {
            hidden,
            zeroSize,
            rect,
            radius: clampValue(radius, 0, 4096),
            offscreen(vw, vh, margin) {
                return rect.right < -margin || rect.bottom < -margin ||
                    rect.left > vw + margin || rect.top > vh + margin;
            }
        };
    }

    _syncElementClasses() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        const nodes = document.querySelectorAll(this.selector + ', ' + LEGACY_LIQUID_SELECTOR);
        const add = this.destroyed ? null
            : (this.backend === 'webgl' ? GL_ACTIVE_CLASS
                : (this.backend === 'native' ? FALLBACK_CLASS_NATIVE : FALLBACK_CLASS_STATIC));
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            el.classList.remove(GL_ACTIVE_CLASS, FALLBACK_CLASS_NATIVE, FALLBACK_CLASS_STATIC);
            if (add) el.classList.add(add);
        }
    }

    /* ---------------- frame scheduling ---------------- */

    requestRender() {
        if (this.destroyed || this._rafPending) return;
        if (typeof requestAnimationFrame !== 'function') return;
        this._rafPending = true;
        const self = this;
        this._rafId = requestAnimationFrame(function () {
            self._rafPending = false;
            self._frame();
        });
    }

    _cancelFrame() {
        if (this._rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafId);
        this._rafPending = false;
    }

    _frame() {
        if (this.destroyed) return;

        if (this.backend !== 'webgl') {
            if (this._geometryDirty) {
                this._geometryDirty = false;
                this._syncElementClasses();
            }
            return;
        }

        if (this.contextLost) return;

        const videoActive = this._videoActive && this._sourceEl && this._sourceEl.paused === false;
        if (videoActive) this._sceneDirty = true;

        if (this._sceneDirty) {
            this._sceneDirty = false;
            this._renderSceneChain();
            this._emptyDrawn = false;
        }

        if (this._geometryDirty || !this._emptyDrawn) {
            this._geometryDirty = false;
            this._elements = this._collectElements();
            this._observeElements();
            if (this._elements.length === 0 && this._emptyDrawn) return;
            const start = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
            this._drawComposite();
            this._stats.lastDrawMs = start ? (performance.now() - start) : 0;
            this._emptyDrawn = this._elements.length === 0;
        }

        if (videoActive) this.requestRender();
    }

    _observeElements() {
        if (!this._resizeObserver) return;
        for (const el of this._elements) {
            if (this._observedElements.has(el)) continue;
            this._observedElements.add(el);
            this._resizeObserver.observe(el);
        }
    }

    /* ---------------- context loss ---------------- */

    _setupContextLossHandlers() {
        const self = this;
        const canvas = this.canvas;
        if (!canvas) return;

        this._addEventListener(canvas, 'webglcontextlost', function (event) {
            event.preventDefault();
            self.contextLost = true;
            self._teardownGlObjects();
            self._switchBackend(MinaLiquid.supportsNativeBlur() ? 'native' : 'static');
            console.warn('MinaLiquid: WebGL context lost, switched to', self.backend);
        }, false);

        this._addEventListener(canvas, 'webglcontextrestored', function () {
            const wantWebGL = self.backendPreference === 'webgl' || self.backendPreference === 'auto';
            if (wantWebGL && self.gl && !self.gl.isContextLost()) {
                self.contextLost = false;
                self._switchBackend('webgl');
                console.info('MinaLiquid: WebGL context restored');
            }
        }, false);
    }

    _switchBackend(next) {
        if (this.destroyed || next === this.backend) return;
        this.backend = next;
        this.state = next === 'webgl' ? 'ready' : (next === 'native' ? 'fallback-frost' : 'fallback-static');
        if (next === 'webgl') {
            if (this.canvas) this.canvas.style.display = '';
            this.contextLost = false;
            this._emptyDrawn = false;
            this._initGl();
            this._applyCanvasSize();
            this._sceneDirty = true;
            this._geometryDirty = true;
            this._syncElementClasses();
            this.requestRender();
        } else {
            if (this.canvas) this.canvas.style.display = 'none';
            this._teardownGlObjects();
            this._syncElementClasses();
        }
    }

    /* ---------------- cleanup ---------------- */

    _teardownGlObjects() {
        const gl = this.gl;
        if (!gl) return;
        for (const key of Object.keys(this._programs)) {
            if (this._programs[key]) gl.deleteProgram(this._programs[key]);
        }
        this._programs = {};
        this._uniforms = {};
        this._destroyTargets();
        if (this._sceneTex) { gl.deleteTexture(this._sceneTex); this._sceneTex = null; }
        if (this._quad) {
            if (this._quad.vbo) gl.deleteBuffer(this._quad.vbo);
            if (this._quad.vao) gl.deleteVertexArray(this._quad.vao);
            this._quad = null;
        }
        this._hasScene = false;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = 'destroyed';

        this._cancelFrame();
        for (const entry of this._listeners) {
            entry.target.removeEventListener(entry.type, entry.fn, entry.opts);
        }
        this._listeners.length = 0;

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        this._observedElements.clear();

        this._teardownGlObjects();
        this._syncElementClasses();
        this._elements = [];
        this._sourceEl = null;
        this._sourceSpec = null;
        if (this._ownsCanvas && this.canvas && this.canvas.parentNode) {
            this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
    }

    /* ---------------- introspection ---------------- */

    getCanvas() { return this.canvas; }
    getContext() { return this.gl; }
    getBackend() { return this.backend; }
    getQuality() { return this.quality; }
    getElements() { return this._elements.slice(); }
    getStats() { return Object.assign({}, this._stats, { scale: this._drawScale, elements: this._elements.length, state: this.state }); }

    refresh() {
        this._geometryDirty = true;
        this._sceneDirty = true;
        this.requestRender();
    }
}

/* ---------------------------------------------------------------------
 * Deprecated MinaGlass compatibility adapter (V2 API -> MinaLiquid V3)
 * --------------------------------------------------------------------- */

let compatWarned = false;

class MinaGlassCompat {
    constructor(options = {}) {
        if (!compatWarned && typeof console !== 'undefined' && console.warn) {
            compatWarned = true;
            console.warn('[MinaUI] MinaGlass (V2) is deprecated since v0.3.0 — use MinaLiquid (minaui.glass.js V3). ' +
                'This adapter maps the old API onto the new renderer; see LIQUID-GLASS.md for migration.');
        }
        this.maxCards = clampValue(Math.floor(options.maxCards || 4), 1, MAX_GLASS_ELEMENTS);
        this._liquid = new MinaLiquid(Object.assign({}, options, {
            maxElements: this.maxCards,
            // V2 tracked only the legacy liquid classes
            selector: options.selector || (LIQUID_SELECTOR + ', ' + LEGACY_LIQUID_SELECTOR)
        }));
        if (options.background) this.uploadTexture(options.background);
    }

    static normalizeQuality(value) { return MinaLiquid.normalizeQuality(value); }
    static detectBackend(quality) { return MinaLiquid.detectBackend(quality); }
    static supportsNativeBlur() { return MinaLiquid.supportsNativeBlur(); }

    static autoInit(options = {}) {
        return new MinaGlassCompat(options);
    }

    uploadTexture(image) {
        if (typeof image === 'string') this._liquid.setSource({ type: 'image', src: image });
        else this._liquid.setSource({ type: 'element', el: image });
    }

    setSaturate(value) { this._liquid.setGlass({ saturation: clampValue(value, 0, 2) }); }

    setWhiteness(value) {
        const w = clampValue(value, 0, 1);
        this._liquid.setGlass({ brightness: 1 - 0.65 * w, tint: 0.05 + 0.2 * w });
    }

    render() { this._liquid.requestRender(); }
    startRender() { this._liquid.requestRender(); }   // V3 renders on demand

    getCanvas() { return this._liquid.getCanvas(); }
    getContext() { return this._liquid.getContext(); }

    get backend() { return this._liquid.backend; }
    get quality() { return this._liquid.quality; }
    get destroyed() { return this._liquid.destroyed; }

    destroy() { this._liquid.destroy(); }
}

// Exports
if (typeof window !== 'undefined') {
    window.MinaLiquid = MinaLiquid;
    window.MinaGlass = MinaGlassCompat;
    if (!window.AquaGlass) window.AquaGlass = MinaGlassCompat;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MinaLiquid;
    module.exports.MinaLiquid = MinaLiquid;
    module.exports.MinaGlass = MinaGlassCompat;
    module.exports.QUALITY_CONFIG = QUALITY_CONFIG;
    module.exports.DEFAULT_GLASS = DEFAULT_GLASS;
}
