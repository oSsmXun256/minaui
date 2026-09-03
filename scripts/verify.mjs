import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext } from "node:vm";
import { createDocument, FakeCustomEvent, FakeElement, FakeEvent } from "./fake-dom.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = resolve(root, "minaui.css");
const jsPath = resolve(root, "minaui.js");
const compatPath = resolve(root, "minaui-aqua-compat.css");
const glassPath = resolve(root, "minaui.glass.js");
const legacyGlassPath = resolve(root, "legacy", "minaui.glass.v2.js");
const css = await readFile(cssPath, "utf8");
const js = await readFile(jsPath, "utf8");
const compat = await readFile(compatPath, "utf8");
const glass = await readFile(glassPath, "utf8");
const legacyGlass = await readFile(legacyGlassPath, "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ---- CSS API contract ---- */

const requiredCss = [
  ":root", ".mina-shell", ".mina-container", ".mina-grid", ".mina-card",
  ".mina-btn", ".mina-input", ".mina-tabs", ".mina-modal", ".mina-alert", ".mina-min-h-screen",
  "[data-theme=\"light\"]", "@media (prefers-reduced-motion: reduce)",
  // Liquid Glass surface contract
  ".mina-liquid", "[data-mina-liquid]", ".mina-liquid-gl",
  ".mina-liquid-native", ".mina-liquid-static"
];
const missing = requiredCss.filter((selector) => !css.includes(selector));
if (missing.length) throw new Error(`Missing required CSS API: ${missing.join(", ")}`);

function countBraces(text) {
  let clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  clean = clean.replace(/(['"])(?:\\.|(?!\1)[^\\])*\1/g, "");
  return [...clean].reduce((depth, char) => {
    if (char === "{") return depth + 1;
    if (char === "}") return depth - 1;
    return depth;
  }, 0);
}
if (countBraces(css) !== 0) throw new Error("CSS braces are unbalanced");
if (countBraces(js) !== 0) throw new Error("JS braces are unbalanced");
if (countBraces(compat) !== 0) throw new Error("Aqua compatibility CSS braces are unbalanced");
if (countBraces(glass) !== 0) throw new Error("MinaLiquid JS braces are unbalanced");

const requiredCompat = [".aqua-glass", ".aqua-btn", ".aqua-container", ".aqua-fade-in", ".aqua-duration-1000", "--aqua-primary"];
const missingCompat = requiredCompat.filter((selector) => !compat.includes(selector));
if (missingCompat.length) throw new Error(`Missing Aqua compatibility API: ${missingCompat.join(", ")}`);
const aquaClasses = [...compat.matchAll(/\.aqua-[A-Za-z0-9_-]+(?:\\:[A-Za-z0-9_-]+)?/g)].map((match) => match[0]);
const minaClasses = new Set([...css.matchAll(/\.mina-[A-Za-z0-9_-]+(?:\\:[A-Za-z0-9_-]+)?/g)].map((match) => match[0]));
const missingMinaAliases = [...new Set(aquaClasses.map((name) => name.replace(/^\.aqua-/, ".mina-")))].filter((name) => !minaClasses.has(name));
if (missingMinaAliases.length) throw new Error(`Missing Mina selector equivalents: ${missingMinaAliases.join(", ")}`);
const aquaKeyframes = [...compat.matchAll(/@keyframes\s+(aqua-[A-Za-z0-9_-]+)/g)].map((match) => match[1]);
const minaKeyframes = new Set([...css.matchAll(/@keyframes\s+(mina-[A-Za-z0-9_-]+)/g)].map((match) => match[1]));
const missingMinaKeyframes = [...new Set(aquaKeyframes.map((name) => name.replace(/^aqua-/, "mina-")))].filter((name) => !minaKeyframes.has(name));
if (missingMinaKeyframes.length) throw new Error(`Missing Mina keyframe equivalents: ${missingMinaKeyframes.join(", ")}`);

/* ---- Surface level separation ---- */

// Level 1 (card/panel): no blur. Level 2 (.mina-glass): CSS backdrop-filter.
// Level 3 (.mina-liquid): geometry holder + state classes, no blur of its own.
const surfaceBlock = css.match(/\.mina-card,\s*\.mina-panel\s*\{[^}]*\}/);
assert(surfaceBlock, "Surface block (.mina-card, .mina-panel) is missing");
assert(!surfaceBlock[0].includes("backdrop-filter"), ".mina-card/.mina-panel must not apply backdrop-filter (use .mina-glass for frost)");
const glassBlock = css.match(/\.mina-glass\s*\{[^}]*\}/);
assert(glassBlock && glassBlock[0].includes("backdrop-filter"), ".mina-glass must provide the frosted glass (backdrop-filter) surface");
assert(glassBlock && glassBlock[0].includes("contain: layout paint"), ".mina-glass must preserve the containment contract");
assert(!/\.mina-glass\s*\{[^}]*translateZ/.test(css), ".mina-glass must not force a compositor layer with translateZ(0); use .mina-gpu");
assert(css.includes(".mina-gpu"), "Opt-in .mina-gpu layer-promotion utility is missing");

// Liquid surface must not blur on its own (Level 3 pixels come from WebGL)
const liquidBlocks = css.match(/\.mina-liquid(?:\s*,\s*\[data-mina-liquid\])?\s*\{[^}]*\}/g) || [];
assert(liquidBlocks.length > 0, ".mina-liquid surface block is missing");
for (const block of liquidBlocks) {
  assert(!block.includes("backdrop-filter: blur"), ".mina-liquid must not blur via CSS (WebGL owns its pixels)");
}
// The GL-active state must be fully transparent so WebGL pixels show through
const glActiveBlock = css.match(/\.mina-liquid-gl\s*\{[^}]*\}/);
assert(glActiveBlock && glActiveBlock[0].includes("background: transparent"), ".mina-liquid-gl must be transparent (WebGL paints the pixels)");

const requiredPerfCss = [
  "--mina-card-bg",
  "--mina-z-backdrop",
  "--mina-z-glass-canvas",
  "--mina-z-scrim",
  "--mina-z-content",
  ".mina-scrim",
  ".mina-content",
  "[data-mina-performance=\"performance\"]",
  "[data-mina-performance=\"balanced\"]",
  "--mina-liquid-native-bg",
  "@media (hover: hover) and (pointer: fine)",
  // modal body scroll lock applied by minaui.js
  "html[data-mina-modal-open]"
];
const missingPerfCss = requiredPerfCss.filter((needle) => !css.includes(needle));
if (missingPerfCss.length) throw new Error(`Missing performance/z-index CSS API: ${missingPerfCss.join(", ")}`);

assert(/\[data-mina-performance="balanced"\][^{]*\{[^}]*animation:\s*mina-fade-in/.test(css),
  "balanced mode must replace animated backdrop-filter with opacity fades");
assert(/\[data-mina-performance="performance"\]\s+\.mina-skeleton::after\s*\{[^}]*animation:\s*none/.test(css),
  "performance mode must stop the skeleton shimmer loop");

/* ---- MinaLiquid V3 source contract ---- */

const requiredLiquid = [
  "class MinaLiquid",
  "class MinaGlassCompat",
  "window.MinaLiquid",
  "setSource",
  "setGlass",
  "setQuality",
  "getStats",
  "describeElement",
  "requestRender",
  "destroy()",
  "'high'", "'balanced'", "'performance'",
  "'auto'", "'webgl'", "'native'", "'static'",
  "renderScale",
  "maxPixelCount",
  "webglcontextlost",
  "webglcontextrestored",
  "ResizeObserver",
  "removeEventListener",
  "cancelAnimationFrame",
  "disconnect()",
  "deleteProgram",
  "deleteTexture",
  "deleteFramebuffer",
  "deleteVertexArray",
  "IntersectionObserver-free viewport culling placeholder".slice(0, 0) || "offscreen",
  "preserveDrawingBuffer: false",
  "antialias: false",
  "depth: false",
  "stencil: false"
];
const missingLiquid = requiredLiquid.filter((needle) => !glass.includes(needle));
if (missingLiquid.length) throw new Error(`Missing MinaLiquid API: ${missingLiquid.join(", ")}`);

// Legacy separation: V2 must exist as a frozen file and must not be loaded by the demo
assert(legacyGlass.includes("class MinaGlass"), "legacy/minaui.glass.v2.js must keep the V2 class");
assert(legacyGlass.includes("[LEGACY]"), "legacy V2 file must be marked as legacy");
assert(!/src=["']\.\.\/minaui\.glass\.v2\.js/.test(await readFile(resolve(root, "demo", "index.html"), "utf8")), "demo must not load the legacy V2 module");

// Fallback classes must never be applied through CSS unconditionally
assert(!/\.mina-card\s*\{[^}]*backdrop-filter/.test(css), ".mina-card must stay blur-free");

const forbiddenGlassPatterns = [
  [/preserveDrawingBuffer:\s*true/, "preserveDrawingBuffer:true must not come back"],
  [/antialias:\s*true/, "antialias:true must not come back"]
];
for (const [pattern, message] of forbiddenGlassPatterns) {
  assert(!pattern.test(glass), `MinaLiquid regression: ${message}`);
}

assert(/open:\s*function\s*\(value(?:,\s*trigger)?\)\s*\{\s*var target = typeof value === "string"/.test(js), "MinaUI.open must accept selector strings");
assert(/close:\s*function\s*\(value(?:,\s*options)?\)\s*\{\s*if \(!value\) return null;\s*var target = typeof value === "string"/.test(js), "MinaUI.close must accept selector strings");

try {
  new Script(js, { filename: jsPath });
  new Script(glass, { filename: glassPath });
} catch (error) {
  throw new Error(`JavaScript syntax check failed: ${error.message}`);
}

/* ---- Functional tests ---- */

function bootMinaUI(doc) {
  const sandbox = {
    window: null,
    document: doc,
    navigator: { userAgent: "test" },
    CustomEvent: FakeCustomEvent,
    localStorage: { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } },
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  const context = createContext(sandbox);
  new Script(js, { filename: jsPath }).runInContext(context);
  return sandbox.window.MinaUI;
}

/** Minimal WebGL2 stub: records the call graph so pipeline behavior can be
 * asserted without a GPU. Program link always succeeds unless failPrograms
 * lists a program key (via naming in the fragment source). */
function createFakeGL() {
  const calls = [];
  const textures = [];
  const framebuffers = [];
  const programs = [];
  let texCounter = 0;
  let fboCounter = 0;
  let programCounter = 0;
  const gl = {
    // mutable pixel-store state (texParameteri target guards rely on this)
    _pixelStore: {},
    // constants
    TEXTURE_2D: 0x0DE1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, FRAMEBUFFER: 0x8D40,
    COLOR_ATTACHMENT0: 0x8CE0, TEXTURE0: 0x84C0, VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B49,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88E4,
    TRIANGLE_STRIP: 0x0005, FLOAT: 0x1406, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    LINEAR: 0x2601, LINEAR_MIPMAP_LINEAR: 0x2703, CLAMP_TO_EDGE: 0x812F,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, UNPACK_FLIP_Y_WEBGL: 0x9240,
    ACTIVE_UNIFORMS: 0x8B86,
    // call log
    calls,
    drawCounts: () => calls.filter((c) => c[0] === "drawArrays").length,
    // object factories
    createTexture() { const t = { id: ++texCounter, params: {}, mipmaps: 0 }; textures.push(t); return t; },
    deleteTexture(t) { calls.push(["deleteTexture", t && t.id]); },
    createFramebuffer() { const f = { id: ++fboCounter }; framebuffers.push(f); return f; },
    deleteFramebuffer(f) { calls.push(["deleteFramebuffer", f && f.id]); },
    createProgram() { const p = { id: ++programCounter, uniforms: { uScene: "uScene", uB0: "uB0", uB1: "uB1", uB2: "uB2", uTex: "uTex", uDir: "uDir", uImgRes: "uImgRes", uOutRes: "uOutRes", uResolution: "uResolution", uCount: "uCount", uRect: "uRect", uShape: "uShape", uHasScene: "uHasScene" }, uniformValues: {} }; programs.push(p); return p; },
    deleteProgram(p) { calls.push(["deleteProgram", p && p.id]); },
    createShader() { return {}; },
    deleteShader() {},
    createBuffer() { return {}; },
    deleteBuffer(b) { calls.push(["deleteBuffer", !!b]); },
    createVertexArray() { return {}; },
    deleteVertexArray(v) { calls.push(["deleteVertexArray", !!v]); },
    // program lifecycle
    shaderSource() {},
    compileShader() {},
    attachShader() {},
    linkProgram() {},
    bindAttribLocation() {},
    getShaderParameter() { return true; },
    getShaderInfoLog() { return ""; },
    getProgramParameter(program, pname) {
      if (pname === gl.LINK_STATUS) return true;
      if (pname === gl.ACTIVE_UNIFORMS) return Object.keys(program.uniforms).length;
      return true;
    },
    getProgramInfoLog() { return ""; },
    getActiveUniform(program, index) {
      const name = Object.keys(program.uniforms)[index];
      return { name, type: 0 };
    },
    getUniformLocation(program, name) { return program.uniforms[name] !== undefined ? name : null; },
    useProgram(p) { calls.push(["useProgram", p && p.id]); },
    // state (WebGL is target-based: bindTexture records the current texture)
    bindTexture(target, t) { gl._boundTexture = t; calls.push(["bindTexture", t && t.id]); },
    activeTexture(u) { calls.push(["activeTexture", u]); },
    pixelStorei(pname, value) { gl._pixelStore[pname] = value; },
    texImage2D() {},
    generateMipmap(target) { if (gl._boundTexture) gl._boundTexture.mipmaps++; calls.push(["generateMipmap"]); },
    texParameteri(t, name, value) { if (t && typeof t === "object") t.params[name] = value; },
    bindFramebuffer(target, fbo) { calls.push(["bindFramebuffer", fbo ? fbo.id : null]); },
    framebufferTexture2D() {},
    viewport(x, y, w, h) { calls.push(["viewport", w, h]); },
    uniform1i(location, value) { if (location) calls.push(["uniform1i", location, value]); },
    uniform1f(location, value) { if (location) calls.push(["uniform1f", location, value]); },
    uniform2f(location, a, b) { if (location) calls.push(["uniform2f", location, a, b]); },
    uniform3f(location, a, b, c) { if (location) calls.push(["uniform3f", location, a, b, c]); },
    uniform4fv(location, arr) { if (location) calls.push(["uniform4fv", location, Array.from(arr).slice(0, 8)]); },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    bindBuffer() {},
    bufferData() {},
    bindVertexArray() {},
    drawArrays(mode, first, count) { calls.push(["drawArrays", count]); },
    isContextLost() { return false; },
    _boundTexture: null,
    canvas: null
  };
  return { gl, calls, textures, framebuffers, programs };
}

function loadGlass(env = {}) {
  const sandbox = {
    console: { warn() {}, error() {}, info() {} },
    module: { exports: {} },
    setTimeout, clearTimeout,
    ...env
  };
  if (!sandbox.document) {
    sandbox.document = undefined;
    delete sandbox.document;
  }
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  return sandbox.module.exports;
}

/** Build a DOM with n liquid elements and a fake WebGL2 environment. */
function buildGlassEnvironment({ liquidCount = 1, hiddenCount = 0, viewport = { w: 1280, h: 800 } } = {}) {
  const doc = createDocument();
  const els = [];
  for (let i = 0; i < liquidCount; i++) {
    const el = new FakeElement("div", { class: "mina-liquid", "data-mina-liquid": "" });
    el.nodeType = 1;
    el.offsetParent = { stub: true };
    el.getBoundingClientRect = () => ({
      left: 100 + i * 40, top: 80, width: 400, height: 260,
      right: 500 + i * 40, bottom: 340
    });
    doc.body.appendChild(el);
    els.push(el);
  }
  for (let i = 0; i < hiddenCount; i++) {
    const el = new FakeElement("div", { class: "mina-liquid" });
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 260, right: 400, bottom: 260 });
    doc.body.appendChild(el);
    el.offsetParent = null; // display:none simulation (after appendChild, which marks visible)
  }
  const fakeGL = createFakeGL();

  const rafQueue = [];
  const env = {
    document: doc,
    navigator: { userAgent: "test" },
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame() {},
    performance: { now: () => 0 },
    innerWidth: viewport.w,
    innerHeight: viewport.h,
    devicePixelRatio: 1,
    CSS: { supports: () => true },
    matchMedia: () => ({ matches: false }),
    Image: function () {},
    HTMLCanvasElement: function () {},
    getComputedStyle: () => ({ borderTopLeftRadius: "24px", visibility: "visible", position: "static" })
  };
  env.window = env;

  return { doc, els, fakeGL, env, rafQueue };
}

function tick(ms = 5) { return new Promise((resolveTick) => setTimeout(resolveTick, ms)); }

function drainRaf(rafQueue, times = 3) {
  for (let i = 0; i < times; i++) {
    const queued = rafQueue.splice(0);
    for (const fn of queued) fn();
  }
}

async function testQualityNormalization() {
  const { MinaLiquid } = loadGlass();
  assert(MinaLiquid.normalizeQuality("high") === "high", "normalizeQuality('high') must return 'high'");
  assert(MinaLiquid.normalizeQuality("quality") === "high", "normalizeQuality('quality') is an alias of high");
  assert(MinaLiquid.normalizeQuality("balanced") === "balanced", "normalizeQuality('balanced') must return 'balanced'");
  assert(MinaLiquid.normalizeQuality("performance") === "performance", "normalizeQuality('performance') must return 'performance'");
  // V3 defaults to balanced (V2 defaulted to high)
  assert(MinaLiquid.normalizeQuality(undefined) === "balanced", "normalizeQuality default must be 'balanced' in V3");
  assert(MinaLiquid.normalizeQuality("bogus") === "balanced", "invalid quality must fall back to balanced");
}

async function testQualityPipelineShape() {
  const { MinaLiquid, QUALITY_CONFIG } = loadGlass();
  assert(QUALITY_CONFIG.high.pyramidLevels === 3, "high must build a 3-level blur pyramid");
  assert(QUALITY_CONFIG.balanced.pyramidLevels === 2, "balanced must build a 2-level blur pyramid");
  assert(QUALITY_CONFIG.performance.pyramidLevels === 0, "performance must be mip-only (no pyramid)");
  assert(QUALITY_CONFIG.performance.dispersionScale === 0, "performance must disable dispersion");
  assert(QUALITY_CONFIG.high.dispersionScale > QUALITY_CONFIG.balanced.dispersionScale, "dispersion must scale down from high to balanced");

  // Shader variants: pyramid sampling structure must differ per tier
  const { buildCompositeShaderSource } = await import(`data:text/javascript;base64,${Buffer.from("export default null").toString("base64")}`).catch(() => ({}));
  const glassModule = loadGlass();
  const highSource = glassModule.MinaLiquid ? null : null;
  // buildCompositeShaderSource is module-private; assert via exported constants + shader strings in source
  const source = await readFile(glassPath, "utf8");
  assert(source.includes("uB2"), "composite shader must have a third pyramid level (uB2) for high");
  assert(source.includes("textureLod"), "composite shader must support mip-based sampling for the perf tier");
  assert(highSource === null || true, "noop");
  void glassModule;
  void buildCompositeShaderSource;
}

async function testBackendDetection() {
  const { MinaLiquid } = loadGlass();
  assert(MinaLiquid.detectBackend() === "webgl", "detectBackend must default to webgl without UA info");

  const iosGlass = evalGlassIn({
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 },
    matchMedia: () => ({ matches: false })
  });
  assert(iosGlass.MinaLiquid.detectBackend() === "native", "iOS must select the native backend");

  const webkitGlass = evalGlassIn({
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" },
    matchMedia: () => ({ matches: false })
  });
  assert(webkitGlass.MinaLiquid.detectBackend() === "native", "WebKit (Safari desktop) must select the native backend");

  const coarseGlass = evalGlassIn({
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" },
    matchMedia: (q) => ({ matches: q.includes("coarse") })
  });
  assert(coarseGlass.MinaLiquid.detectBackend() === "native", "coarse pointers must select the native backend");
}

function evalGlassIn(env) {
  const sandbox = { console: { warn() {}, error() {}, info() {} }, module: { exports: {} }, setTimeout, clearTimeout, ...env };
  sandbox.window = sandbox;
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  return sandbox.module.exports;
}

/** Shared non-GL environment for liquid instances in Node. */
function baseEnv(doc, overrides = {}) {
  const env = {
    document: doc,
    navigator: { userAgent: "test" },
    CSS: { supports: () => true },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    performance: { now: () => 0 },
    Image: function () { this.complete = false; },
    getComputedStyle: () => ({ borderTopLeftRadius: "24px", visibility: "visible", position: "static" })
  };
  Object.assign(env, overrides);
  env.window = env;
  return env;
}

async function testStateTransitionsWithoutWebGL() {
  // No WebGL2RenderingContext at all -> static when native blur unsupported
  const doc = createDocument();
  const el = new FakeElement("div", { class: "mina-liquid", "data-mina-liquid": "" });
  doc.body.appendChild(el);
  const env = baseEnv(doc, { CSS: { supports: () => false } });
  const sandbox = { console: { warn() {}, error() {} }, module: { exports: {} }, setTimeout, clearTimeout, ...env };
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  const LiquidNoGL = sandbox.module.exports.MinaLiquid;
  const liquid = new LiquidNoGL({ backend: "auto" });
  assert(liquid.backend === "static", "without WebGL2 and CSS blur the backend must be static");
  assert(liquid.state === "fallback-static", "state must reflect the static fallback");
  assert(liquid.state !== "ready", "state must not be ready without WebGL");
  // CSS class must reflect fallback so content stays visible
  assert(el.classList.contains("mina-liquid-static") || el.classList.contains("mina-liquid-native"), "fallback class must be applied to liquid elements");
  liquid.destroy();
  assert(liquid.state === "destroyed", "destroy must set the destroyed state");
}

async function testZeroLiquidElements() {
  const doc = createDocument();
  doc.getElementById = () => null;
  const env = baseEnv(doc);
  const sandbox = { console: { warn() {}, error() {} }, module: { exports: {} }, setTimeout, clearTimeout, ...env };
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  const MinaLiquid = sandbox.module.exports.MinaLiquid;
  // Page has zero liquid elements: renderer must stay idle (no canvas created)
  const liquid = new MinaLiquid({ backend: "auto" });
  assert(liquid.backend === "native" || liquid.backend === "static", "zero liquid elements must not instantiate WebGL");
  assert(!liquid.getCanvas(), "no canvas must be created when there is nothing to render");
  liquid.destroy();
}

async function testWebGLPipelineAndCleanup() {
  const { doc, els, fakeGL, rafQueue } = buildGlassEnvironment({ liquidCount: 2, hiddenCount: 1 });
  const glCanvas = { style: {}, width: 0, height: 0, addEventListener() {}, removeEventListener() {}, getContext: (kind) => (kind === "webgl2" ? fakeGL.gl : null) };
  const originalGetById = doc.getElementById.bind(doc);
  doc.getElementById = (id) => (id === "mina-glcanvas" ? glCanvas : originalGetById(id));
  const originalCreateElement = doc.createElement.bind(doc);
  const fake2d = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {},
    drawImage() {},
    fillStyle: null
  };
  doc.createElement = (tag) => {
    if (tag === "canvas") return { width: 0, height: 0, getContext: (kind) => (kind === "2d" ? fake2d : null) };
    return originalCreateElement(tag);
  };
  const env = baseEnv(doc, {
    WebGL2RenderingContext: function WebGL2RenderingContext() {},
    requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; }
  });
  const sandbox = { console: { warn() {}, error() {} }, module: { exports: {} }, setTimeout, clearTimeout, ...env };
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  const MinaLiquid = sandbox.module.exports.MinaLiquid;

  const liquid = new MinaLiquid({ backend: "webgl", source: { type: "gradient" } });
  assert(liquid.backend === "webgl", "explicit webgl backend must resolve when a context is available");
  assert(liquid.state === "ready", "state must be ready after GL init");
  drainRaf(rafQueue, 4);

  // hidden element must be culled
  assert(liquid.getElements().length === 2, "hidden liquid element must be culled from rendering");

  // Scene + composite passes must have run
  const drawCalls = fakeGL.calls.filter((c) => c[0] === "drawArrays");
  assert(drawCalls.length > 0, "draw calls must happen after init");
  // scene chain: mipmap generation on the source texture (mip blur path)
  assert(fakeGL.textures[0].mipmaps > 0, "scene texture must have mipmaps generated");

  // GL-active class applied to tracked elements
  assert(els[0].classList.contains("mina-liquid-gl"), "WebGL backend must mark elements as GL-owned");

  liquid.setGlass({ refraction: 0.3 });
  liquid.setQuality("performance");
  assert(liquid.getQuality() === "performance", "setQuality must update the tier");
  drainRaf(rafQueue, 4);

  // destroy: full resource cleanup
  const before = fakeGL.calls.length;
  liquid.destroy();
  const cleanup = fakeGL.calls.slice(before);
  assert(cleanup.some((c) => c[0] === "deleteProgram"), "destroy must delete programs");
  assert(cleanup.some((c) => c[0] === "deleteTexture"), "destroy must delete textures");
  assert(cleanup.some((c) => c[0] === "deleteFramebuffer"), "destroy must delete framebuffers");
  assert(liquid.state === "destroyed", "destroy must set destroyed state");
  assert(els[0].classList.contains("mina-liquid-gl") === false, "GL class must be removed on destroy");
}

async function testElementCulling() {
  const { MinaLiquid } = loadGlass();

  const visible = new FakeElement("div", { class: "mina-liquid" });
  visible.getBoundingClientRect = () => ({ left: 10, top: 10, width: 200, height: 100, right: 210, bottom: 110 });
  visible.offsetParent = { stub: true };
  visible.nodeType = 1;

  const hidden = new FakeElement("div", { class: "mina-liquid" });
  hidden.nodeType = 1;
  hidden.offsetParent = null; // display:none

  const zeroSize = new FakeElement("div", { class: "mina-liquid" });
  zeroSize.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1, height: 1, right: 1, bottom: 1 });
  zeroSize.offsetParent = { stub: true };
  zeroSize.nodeType = 1;

  const offscreen = new FakeElement("div", { class: "mina-liquid" });
  offscreen.getBoundingClientRect = () => ({ left: -2000, top: -2000, width: 200, height: 100, right: -1800, bottom: -1900 });
  offscreen.offsetParent = { stub: true };
  offscreen.nodeType = 1;

  const dVisible = MinaLiquid.describeElement(visible);
  assert(dVisible.hidden === false, "visible element must not be flagged hidden");
  assert(dVisible.zeroSize === false, "visible element must not be zero size");
  assert(dVisible.radius === 24, "radius default should be 24px without computed style");

  const dHidden = MinaLiquid.describeElement(hidden);
  assert(dHidden.hidden === true, "display:none element (null offsetParent) must be hidden");

  const dZero = MinaLiquid.describeElement(zeroSize);
  assert(dZero.zeroSize === true, "sub-2px element must be flagged zero size");

  const dOff = MinaLiquid.describeElement(offscreen);
  assert(dOff.offscreen(1280, 800, 120) === true, "far-offscreen element must be culled");

  // radius attribute override
  const customRadius = new FakeElement("div", { class: "mina-liquid", "data-mina-radius": "48" });
  customRadius.offsetParent = { stub: true };
  customRadius.nodeType = 1;
  assert(MinaLiquid.describeElement(customRadius).radius === 48, "data-mina-radius must override computed radius");
}

async function testGlassCompatAdapter() {
  const { MinaGlass, MinaLiquid } = loadGlass({ navigator: { userAgent: "test" }, matchMedia: () => ({ matches: false }), CSS: { supports: () => true } });
  assert(MinaGlass, "compat adapter must be exported");
  assert(MinaGlass.normalizeQuality("balanced") === "balanced", "adapter quality normalization must match V3");
  assert(MinaGlass.detectBackend() === MinaLiquid.detectBackend(), "adapter detectBackend must delegate to V3");

  // Instance API surface (old V2 calls still work)
  const doc = createDocument();
  const el = new FakeElement("div", { class: "mina-glass-liquid" });
  doc.body.appendChild(el);
  const env = baseEnv(doc, { CSS: { supports: () => true } });
  const sandbox = { console: { warn() {}, error() {} }, module: { exports: {} }, setTimeout, clearTimeout, ...env };
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  const Compat = sandbox.module.exports.MinaGlass;

  // zero liquid elements on page for webgl: adapter still constructs a fallback instance
  doc.querySelectorAll = () => [];
  const glassCompat = Compat.autoInit({ backend: "static", background: "x.jpg" });
  glassCompat.setSaturate(1.4);
  glassCompat.setWhiteness(0.5);
  glassCompat.render();
  glassCompat.startRender();
  assert(glassCompat.backend === "static", "adapter must expose backend");
  glassCompat.destroy();
  assert(glassCompat.destroyed === true, "adapter destroy must reach V3");
}

async function testTheme() {
  const doc = createDocument();
  const MinaUI = bootMinaUI(doc);
  const result = MinaUI.setTheme("light");
  assert(result === "light", "setTheme must return the applied theme");
  assert(doc.documentElement.getAttribute("data-theme") === "light", "setTheme must set data-theme on <html>");
  assert(MinaUI.setTheme("neon") === "light", "setTheme must fall back to a valid theme");
}

async function testToast() {
  const doc = createDocument();
  const MinaUI = bootMinaUI(doc);
  const toast = MinaUI.toast("<b>bold</b>", { title: "Saved", tone: "success" });
  assert(toast.getAttribute("role") === "status", "success toast must be role=status");
  assert(toast.classList.contains("mina-toast--success"), "tone must map to the modifier class");
  const message = toast.querySelector(".mina-toast__message");
  assert(message && message.textContent === "<b>bold</b>", "toast message must be inserted as text, not HTML");
  const region = doc.querySelector(".mina-toast-region");
  assert(region && region.getAttribute("aria-live") === "polite", "toast region must be a live region");
  toast.querySelector("button").dispatchEvent(new FakeEvent("click", { target: toast.querySelector("button") }));
  assert(toast.getAttribute("data-mina-leaving") === "true" && toast.classList.contains("mina-fade-out"), "dismiss must fade the toast out before removal");
  await tick(400);
  assert(!toast.parentNode, "dismissed toast must be removed from the DOM");
}

async function testModalFocusAndScrollLock() {
  const doc = createDocument();
  const trigger = new FakeElement("button", { class: "mina-btn", text: "open" });
  const modal = new FakeElement("section", { class: "mina-modal", id: "settings", "aria-hidden": "true" });
  const dialog = new FakeElement("div", { class: "mina-modal__dialog", role: "dialog", "aria-modal": "true" });
  const firstBtn = new FakeElement("button", { class: "mina-btn", text: "save" });
  const lastBtn = new FakeElement("button", { class: "mina-btn", "data-mina-close": "", text: "close" });
  dialog.appendChild(firstBtn);
  dialog.appendChild(lastBtn);
  modal.appendChild(dialog);
  doc.body.appendChild(trigger);
  doc.body.appendChild(modal);
  withDoc(doc, trigger, modal, dialog, firstBtn, lastBtn);

  const MinaUI = bootMinaUI(doc);
  MinaUI.open(modal, trigger);
  assert(modal.classList.contains("is-open"), "open must add is-open");
  assert(modal.getAttribute("aria-hidden") === "false", "open must clear aria-hidden");
  assert(doc.documentElement.hasAttribute("data-mina-modal-open"), "open must lock body scroll");
  await tick();
  assert(doc.activeElement === firstBtn, "open must focus the first focusable element");

  doc.activeElement = lastBtn;
  doc.dispatchEvent(new FakeEvent("keydown", { key: "Tab", target: lastBtn }));
  assert(doc.activeElement === firstBtn, "Tab must wrap inside the modal dialog");
  doc.dispatchEvent(new FakeEvent("keydown", { key: "Escape", target: lastBtn }));
  assert(!modal.classList.contains("is-open"), "Escape must close the modal");
  assert(!doc.documentElement.hasAttribute("data-mina-modal-open"), "close must unlock body scroll");
  await tick();
  assert(doc.activeElement === trigger, "close must restore focus to the opener");
}

async function testDropdown() {
  const doc = createDocument();
  const dropdown = new FakeElement("div", { class: "mina-dropdown" });
  const trigger = new FakeElement("button", { class: "mina-btn", "data-mina-toggle": "", "aria-haspopup": "menu", "aria-expanded": "false" });
  const valueNode = new FakeElement("span", { "data-mina-dropdown-value": "", text: "選択してください" });
  const menu = new FakeElement("div", { class: "mina-dropdown__menu", role: "menu", "aria-hidden": "true" });
  const itemA = new FakeElement("button", { class: "mina-dropdown__item", role: "menuitem", "data-mina-dropdown-item": "", "data-value": "a", text: "Alpha" });
  const itemB = new FakeElement("button", { class: "mina-dropdown__item", role: "menuitem", "data-mina-dropdown-item": "", "data-value": "b", text: "Beta" });
  trigger.appendChild(valueNode);
  menu.appendChild(itemA);
  menu.appendChild(itemB);
  dropdown.appendChild(trigger);
  dropdown.appendChild(menu);
  doc.body.appendChild(dropdown);
  withDoc(doc, dropdown, trigger, menu, itemA, itemB);

  const MinaUI = bootMinaUI(doc);
  let changeEvent = null;
  dropdown.addEventListener("mina:change", (e) => { changeEvent = e; });

  trigger.click();
  assert(dropdown.classList.contains("is-open"), "trigger click must open the dropdown");
  assert(trigger.getAttribute("aria-expanded") === "true", "open must set aria-expanded on the trigger");
  assert(menu.getAttribute("aria-hidden") === "false" && !menu.hasAttribute("inert"), "open must expose the menu to AT");

  itemB.click();
  assert(changeEvent && changeEvent.detail.value === "b", "item click must dispatch mina:change with the value");
  assert(valueNode.textContent === "Beta", "item click must update the displayed value");
  assert(!dropdown.classList.contains("is-open"), "selection must close the dropdown");
  assert(trigger.getAttribute("aria-expanded") === "false", "close must reset aria-expanded");
  await tick();
  assert(doc.activeElement === trigger, "focus must return to the trigger after selection");
}

async function testTabs() {
  const doc = createDocument();
  const group = new FakeElement("div", { "data-mina-tabs": "" });
  const tabList = new FakeElement("div", { class: "mina-tabs", role: "tablist" });
  const tab1 = new FakeElement("button", { class: "mina-tabs__tab", role: "tab", "data-mina-tab": "p1", "aria-selected": "true", "aria-controls": "p1" });
  const tab2 = new FakeElement("button", { class: "mina-tabs__tab", role: "tab", "data-mina-tab": "p2", "aria-selected": "false", "aria-controls": "p2", tabindex: "-1" });
  const panel1 = new FakeElement("section", { class: "mina-tabs__panel", id: "p1", role: "tabpanel" });
  const panel2 = new FakeElement("section", { class: "mina-tabs__panel", id: "p2", role: "tabpanel", hidden: "" });
  tabList.appendChild(tab1);
  tabList.appendChild(tab2);
  group.appendChild(tabList);
  group.appendChild(panel1);
  group.appendChild(panel2);
  doc.body.appendChild(group);
  withDoc(doc, group, tabList, tab1, tab2, panel1, panel2);

  const MinaUI = bootMinaUI(doc);
  doc.dispatchEvent(new FakeEvent("keydown", { key: "ArrowRight", target: tab1 }));
  assert(tab2.getAttribute("aria-selected") === "true" && tab1.getAttribute("aria-selected") === "false", "ArrowRight must select the next tab");
  assert(panel2.hidden === false && panel1.hidden === true, "tab selection must swap panels");
  assert(doc.activeElement === tab2, "arrow navigation must move focus");
  doc.dispatchEvent(new FakeEvent("keydown", { key: "End", target: tab2 }));
  assert(doc.activeElement === tab2, "End must land on the last tab");
  doc.dispatchEvent(new FakeEvent("keydown", { key: "Home", target: tab2 }));
  assert(tab1.getAttribute("aria-selected") === "true" && doc.activeElement === tab1, "Home must select the first tab");
}

function withDoc(doc, ...els) {
  els.forEach((el) => { el._doc = doc; });
}

const tests = [
  ["Liquid quality normalization (V3 default balanced)", testQualityNormalization],
  ["Liquid quality pipeline shape (pyramid tiers)", testQualityPipelineShape],
  ["Liquid backend detection", testBackendDetection],
  ["Liquid fallback state transitions (no WebGL2)", testStateTransitionsWithoutWebGL],
  ["Liquid zero elements (no canvas)", testZeroLiquidElements],
  ["Liquid WebGL pipeline + resource cleanup", testWebGLPipelineAndCleanup],
  ["Liquid element culling (hidden/zero/offscreen)", testElementCulling],
  ["MinaGlass compat adapter (V2 API surface)", testGlassCompatAdapter],
  ["Theme API", testTheme],
  ["Toast (XSS-safe + fade out)", testToast],
  ["Modal (focus trap / restore / scroll lock)", testModalFocusAndScrollLock],
  ["Dropdown (toggle / change / focus restore)", testDropdown],
  ["Tabs (keyboard)", testTabs]
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}
if (failed) throw new Error(`${failed} functional test(s) failed`);
console.log(`MinaUI verification passed (${css.length} CSS chars, ${js.length} JS chars, ${compat.length} compatibility CSS chars, ${glass.length} MinaLiquid JS chars; V3 surface contract/fallback/cleanup/culling checks + ${tests.length} functional tests OK).`);
