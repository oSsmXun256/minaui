import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = resolve(root, "minaui.css");
const jsPath = resolve(root, "minaui.js");
const compatPath = resolve(root, "minaui-aqua-compat.css");
const glassPath = resolve(root, "minaui.glass.js");
const css = await readFile(cssPath, "utf8");
const js = await readFile(jsPath, "utf8");
const compat = await readFile(compatPath, "utf8");
const glass = await readFile(glassPath, "utf8");

const requiredCss = [
  ":root", ".mina-shell", ".mina-container", ".mina-grid", ".mina-card",
  ".mina-btn", ".mina-input", ".mina-tabs", ".mina-modal", ".mina-alert", ".mina-min-h-screen",
  "[data-theme=\"light\"]", "@media (prefers-reduced-motion: reduce)"
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
if (countBraces(glass) !== 0) throw new Error("MinaGlass JS braces are unbalanced");
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
const requiredGlass = ["class MinaGlass", "static autoInit", "uploadTexture", "setSaturate", "setWhiteness", "maxCards", "aqua-glass-liquid"];
const missingGlass = requiredGlass.filter((selector) => !glass.includes(selector));
if (missingGlass.length) throw new Error(`Missing MinaGlass API: ${missingGlass.join(", ")}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ---- Performance & rendering contract (V2.1) ---- */

const surfaceBlock = css.match(/\.mina-glass,\s*\.mina-card,\s*\.mina-panel\s*\{[^}]*\}/);
assert(surfaceBlock, "Surface block (.mina-glass, .mina-card, .mina-panel) is missing");
assert(surfaceBlock[0].includes("backdrop-filter"), "MinaUI default surfaces must preserve the original frosted glass");

const glassBlock = css.match(/\.mina-glass\s*\{[^}]*\}/);
assert(glassBlock && glassBlock[0].includes("contain: layout paint"), ".mina-glass must preserve the original glass containment contract");
assert(glassBlock && glassBlock[0].includes("translateZ(0)"), ".mina-glass must preserve the original compositor layer");
assert(css.includes(".mina-gpu"), "Opt-in .mina-gpu layer-promotion utility is missing");

const requiredPerfCss = [
  "--mina-card-bg",
  "--mina-z-backdrop",
  "--mina-z-glass-canvas",
  "--mina-z-scrim",
  "--mina-z-content",
  ".mina-scrim",
  ".mina-content",
  "[data-mina-performance=\"performance\"]",
  "--mina-liquid-native-bg",
  "@media (hover: hover) and (pointer: fine)",
  ".mina-liquid-native",
  ".mina-liquid-static"
];
const missingPerfCss = requiredPerfCss.filter((needle) => !css.includes(needle));
if (missingPerfCss.length) throw new Error(`Missing performance/z-index CSS API: ${missingPerfCss.join(", ")}`);

const forbiddenGlassPatterns = [
  [/preserveDrawingBuffer:\s*true/, "preserveDrawingBuffer:true must not come back"],
  [/antialias:\s*true/, "antialias:true must not come back"]
];
for (const [pattern, message] of forbiddenGlassPatterns) {
  assert(!pattern.test(glass), `MinaGlass regression: ${message}`);
}

const requiredGlassPerf = [
  "preserveDrawingBuffer: false",
  "antialias: false",
  "depth: false",
  "stencil: false",
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
  "deleteVertexArray",
  "_requestRender",
  "window.AquaGlass"
];
const missingGlassPerf = requiredGlassPerf.filter((needle) => !glass.includes(needle));
if (missingGlassPerf.length) throw new Error(`Missing MinaGlass performance/fallback API: ${missingGlassPerf.join(", ")}`);

assert(/open:\s*function\s*\(value(?:,\s*trigger)?\)\s*\{\s*var target = typeof value === "string"/.test(js), "MinaUI.open must accept selector strings");
assert(/close:\s*function\s*\(value(?:,\s*options)?\)\s*\{\s*if \(!value\) return null;\s*var target = typeof value === "string"/.test(js), "MinaUI.close must accept selector strings");

try {
  new Script(js, { filename: jsPath });
  new Script(glass, { filename: glassPath });
} catch (error) {
  throw new Error(`JavaScript syntax check failed: ${error.message}`);
}
console.log(`MinaUI verification passed (${css.length} CSS chars, ${js.length} JS chars, ${compat.length} compatibility CSS chars, ${glass.length} MinaGlass JS chars; performance/z-index/context-loss checks OK).`);
