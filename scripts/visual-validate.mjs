/* Headless visual validation: runs the probe page in Chrome, parses the
 * PROBE_JSON payload and asserts the glass-quality contract numerically. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function assert(condition, message) {
  if (!condition) throw new Error("VISUAL FAIL: " + message);
}

const { stdout } = await execFileAsync(CHROME, [
  "--headless=new",
  "--window-size=1500,1000",
  "--virtual-time-budget=8000",
  "--dump-dom",
  "http://127.0.0.1:4173/scripts/visual-probe.html"
], { maxBuffer: 64 * 1024 * 1024, timeout: 90000 });

const m = stdout.match(/PROBE_JSON (\{.*?\})<\/pre>/s);
if (!m) {
  const err = stdout.match(/PROBE_ERROR ([^<]*)/);
  throw new Error("no probe payload: " + (err ? err[1] : "unknown"));
}
const p = JSON.parse(m[1]);
console.log(JSON.stringify(p, null, 1));

if (p.error) throw new Error("probe page error: " + p.error);

/* Contract checks */
const d = p.deviation;
// Bands shift with y, so the whole rect differs from the row reference by a
// baseline; what matters is edge > center (refraction concentrates at rim).
assert(Math.max(d.edgeLeft, d.edgeRight) > d.center,
  `edge refraction must dominate the center (edge=${Math.max(d.edgeLeft, d.edgeRight)}, center=${d.center})`);
assert(d.center < 40, `center deviation must stay bounded (got ${d.center})`);
assert(p.white.center < 0.01, `center must not blow out to white (got ${p.white.center})`);
assert(p.white.edge < 0.35, `edge highlight must not be a white blob (got ${p.white.edge})`);
assert(p.domSync.oldRegionCenterDev < d.center,
  `region vacated by the glass must be calmer than inside the glass (got ${p.domSync.oldRegionCenterDev} vs center ${d.center})`);
assert(p.domSync.movedEdgeLeft > 2, `glass at the new position must still refract (got ${p.domSync.movedEdgeLeft})`);
assert(p.contextLost.backend === "native" && p.contextLost.glassClass.includes("mina-liquid-native"),
  "context loss must degrade to the CSS frost fallback with the right class");
assert(p.destroyed === "destroyed", "destroy must complete");

console.log("VISUAL VALIDATION PASSED");
