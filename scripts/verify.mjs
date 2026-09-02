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

/* ---- Surface & performance contract ---- */

// Surface separation: card/panel are translucent (no blur), .mina-glass is
// the explicit frosted-glass opt-in, liquid glass stays WebGL-only.
const surfaceBlock = css.match(/\.mina-card,\s*\.mina-panel\s*\{[^}]*\}/);
assert(surfaceBlock, "Surface block (.mina-card, .mina-panel) is missing");
assert(!surfaceBlock[0].includes("backdrop-filter"), ".mina-card/.mina-panel must not apply backdrop-filter (use .mina-glass for frost)");
const glassBlock = css.match(/\.mina-glass\s*\{[^}]*\}/);
assert(glassBlock && glassBlock[0].includes("backdrop-filter"), ".mina-glass must provide the frosted glass (backdrop-filter) surface");
assert(glassBlock && glassBlock[0].includes("contain: layout paint"), ".mina-glass must preserve the containment contract");
assert(!/\.mina-glass\s*\{[^}]*translateZ/.test(css), ".mina-glass must not force a compositor layer with translateZ(0); use .mina-gpu");
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
  "[data-mina-performance=\"balanced\"]",
  "--mina-liquid-native-bg",
  "@media (hover: hover) and (pointer: fine)",
  ".mina-liquid-native",
  ".mina-liquid-static",
  // modal body scroll lock applied by minaui.js
  "html[data-mina-modal-open]"
];
const missingPerfCss = requiredPerfCss.filter((needle) => !css.includes(needle));
if (missingPerfCss.length) throw new Error(`Missing performance/z-index CSS API: ${missingPerfCss.join(", ")}`);

// balanced mode must actually replace animated blur, not just be documented
assert(/\[data-mina-performance="balanced"\][^{]*\{[^}]*animation:\s*mina-fade-in/.test(css),
  "balanced mode must replace animated backdrop-filter with opacity fades");
assert(/\[data-mina-performance="performance"\]\s+\.mina-skeleton::after\s*\{[^}]*animation:\s*none/.test(css),
  "performance mode must stop the skeleton shimmer loop");

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

function loadGlass() {
  const sandbox = { console, module: { exports: {} }, setTimeout, clearTimeout };
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  return sandbox.module.exports;
}

function tick(ms = 5) { return new Promise((resolveTick) => setTimeout(resolveTick, ms)); }

async function testGlassQualityTiers() {
  const MinaGlass = loadGlass();
  // Regression: 'balanced' used to normalize to 'high' and silently ran the
  // 25-tap shader. It must survive normalization and change the shader.
  assert(MinaGlass.normalizeQuality("balanced") === "balanced", "normalizeQuality('balanced') must return 'balanced'");
  assert(MinaGlass.normalizeQuality("high") === "high", "normalizeQuality('high') must return 'high'");
  assert(MinaGlass.normalizeQuality("performance") === "performance", "normalizeQuality('performance') must return 'performance'");
  assert(MinaGlass.normalizeQuality(undefined) === "high", "normalizeQuality default must stay 'high'");

  const balancedShader = MinaGlass.prototype._buildFragmentShader.call({ quality: "balanced" });
  const highShader = MinaGlass.prototype._buildFragmentShader.call({ quality: "high" });
  const perfShader = MinaGlass.prototype._buildFragmentShader.call({ quality: "performance" });
  assert(balancedShader.includes("acc /= 9.0"), "balanced shader must use the 9-tap loop");
  assert(highShader.includes("acc /= 25.0"), "high shader must keep the 25-tap loop");
  assert(perfShader.includes("textureLod(uTexture, coverUv(lens), 2.5)"), "performance shader must use a single mip tap");
}

async function testGlassBackendDetection() {
  const MinaGlass = loadGlass();
  // No environment info at all -> capability default
  assert(MinaGlass.detectBackend("high") === "webgl", "detectBackend must default to webgl without UA info");
  assert(MinaGlass.detectBackend("performance") === "native", "performance quality must select the native backend");

  const iosContext = { WebGL2RenderingContext: function WebGL2RenderingContext() {}, navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 }, matchMedia: () => ({ matches: false }) };
  iosContext.window = iosContext;
  const iosGlass = evalGlassIn(iosContext);
  assert(iosGlass.detectBackend("high") === "native", "iOS must select the native backend");

  const webkitContext = { WebGL2RenderingContext: function WebGL2RenderingContext() {}, navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" }, matchMedia: () => ({ matches: false }) };
  webkitContext.window = webkitContext;
  assert(evalGlassIn(webkitContext).detectBackend("high") === "native", "WebKit (Safari desktop) must select the native backend");

  const coarseContext = { WebGL2RenderingContext: function WebGL2RenderingContext() {}, navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" }, matchMedia: (q) => ({ matches: q.includes("coarse") }) };
  coarseContext.window = coarseContext;
  assert(evalGlassIn(coarseContext).detectBackend("high") === "native", "coarse pointers must select the native backend");

  const desktopContext = { WebGL2RenderingContext: function WebGL2RenderingContext() {}, navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }, matchMedia: () => ({ matches: false }) };
  desktopContext.window = desktopContext;
  assert(evalGlassIn(desktopContext).detectBackend("high") === "webgl", "desktop Chromium/Firefox must select webgl");
}

function evalGlassIn(env) {
  const sandbox = { console, module: { exports: {} }, setTimeout, clearTimeout, ...env };
  const context = createContext(sandbox);
  new Script(glass, { filename: glassPath }).runInContext(context);
  return sandbox.module.exports;
}

async function testTheme() {
  const doc = createDocument();
  const MinaUI = bootMinaUI(doc);
  const result = MinaUI.setTheme("light");
  assert(result === "light", "setTheme must return the applied theme");
  assert(doc.documentElement.getAttribute("data-theme") === "light", "setTheme must set data-theme on <html>");
  // invalid values fall back to light rather than leaking raw input
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

  // Tab on the last element wraps to the first (focus trap)
  doc.activeElement = lastBtn; // simulate the user having tabbed to the last control
  doc.dispatchEvent(new FakeEvent("keydown", { key: "Tab", target: lastBtn }));
  assert(doc.activeElement === firstBtn, "Tab must wrap inside the modal dialog");
  // Escape closes and restores focus + scroll
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
  // keyboard: ArrowRight from tab1 selects tab2 (delegated keydown handler)
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
  ["Glass quality tiers (balanced regression)", testGlassQualityTiers],
  ["Glass backend detection", testGlassBackendDetection],
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
console.log(`MinaUI verification passed (${css.length} CSS chars, ${js.length} JS chars, ${compat.length} compatibility CSS chars, ${glass.length} MinaGlass JS chars; surface separation/balanced/context-loss checks + ${tests.length} functional tests OK).`);
