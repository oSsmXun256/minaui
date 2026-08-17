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

try {
  new Script(js, { filename: jsPath });
  new Script(glass, { filename: glassPath });
} catch (error) {
  throw new Error(`JavaScript syntax check failed: ${error.message}`);
}
console.log(`MinaUI verification passed (${css.length} CSS chars, ${js.length} JS chars, ${compat.length} compatibility CSS chars, ${glass.length} MinaGlass JS chars).`);
