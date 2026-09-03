/* Headless visual validation: runs the probe page in Chrome, parses the
 * PROBE_JSON payload and asserts the glass-quality contract numerically.
 *
 * The probe renders the SAME scene + glass geometry twice:
 *   baseline: refraction = dispersion = fresnel = specular = 0
 *   test:    normal glass settings
 * and measures the actual sampling displacement (coordinate-encoded scene)
 * instead of raw color deviation, so blur/tint cannot fake a pass. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function assert(condition, message) {
  if (!condition) throw new Error("VISUAL FAIL: " + message);
}

/* The probe page is timing-sensitive under --virtual-time-budget; retry a
 * couple of times when the payload is simply not there yet. */
async function fetchPayload() {
  let lastErr = "unknown";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { stdout } = await execFileAsync(CHROME, [
      "--headless=new",
      "--window-size=1500,1000",
      "--virtual-time-budget=15000",
      "--dump-dom",
      "http://127.0.0.1:4173/scripts/visual-probe.html"
    ], { maxBuffer: 64 * 1024 * 1024, timeout: 150000 });
    const m = stdout.match(/PROBE_JSON (\{.*?\})<\/pre>/s);
    if (m) return m[1];
    const err = stdout.match(/PROBE_ERROR ([^{]*?)(?:<\/pre>|[\r\n])/);
    if (err) throw new Error("probe error: " + err[1].slice(0, 800));
    lastErr = stdout.match(/<pre id="probe-result">([\s\S]*?)<\/pre>/)?.[1] || "no <pre> content";
  }
  throw new Error("no probe payload after retries; last pre content: " + String(lastErr).slice(0, 200));
}

const payload = await fetchPayload();
const p = JSON.parse(payload);
console.log(JSON.stringify(p, null, 1));

if (p.error) throw new Error("probe page error: " + p.error);

/* ---- displacement profile (actual sampling displacement, px) ---- */
for (const key of ["big", "small", "tiny"]) {
  const d = p.displacement[key];
  assert(d, `displacement profile for ${key} is missing`);
  assert(d.center <= 1.0,
    `${key}: center displacement must be ~0 (got ${d.center}px)`);
  assert(d.edge >= d.mid && d.mid >= d.center - 0.5,
    `${key}: displacement must not invert toward the rim (center=${d.center}, mid=${d.mid}, edge=${d.edge})`);
  assert(d.max <= p.safeLimitPx + 0.5,
    `${key}: maximum displacement must stay within the safe limit ${p.safeLimitPx}px (got ${d.max}px)`);
}
assert(p.displacement.big.edge > 1.0 && p.displacement.big.edge > p.displacement.big.mid,
  `the big glass must show rim-focused refraction (center=${p.displacement.big.center}, mid=${p.displacement.big.mid}, edge=${p.displacement.big.edge})`);
assert(p.displacement.small.edge > 0 || p.displacement.tiny.edge > 0 || p.displacement.small.mid > 0,
  `secondary glasses must refract measurably somewhere (small edge=${p.displacement.small.edge}, tiny edge=${p.displacement.tiny.edge})`);

/* ---- white clipping ---- */
assert(p.white.center < 0.01, `center must not blow out to white (got ${p.white.center})`);
assert(p.white.edge < 0.35, `edge highlight must not be a white blob (got ${p.white.edge})`);

/* ---- RGB dispersion ---- */
assert(p.dispersionSplit.rim >= p.dispersionSplit.center,
  `dispersion split at the rim must not be smaller than the center (rim=${p.dispersionSplit.rim}, center=${p.dispersionSplit.center})`);

/* ---- background restoration after DOM move ---- */
assert(p.domMove.oldRegionRestored <= 1.0,
  `region vacated by the glass must return to the plain scene (displacement=${p.domMove.oldRegionRestored}px)`);
assert(p.domMove.newRegionRefracts > 0.5,
  `glass at the new position must still refract (edge=${p.domMove.newRegionRefracts}px)`);

/* ---- multiple glass overlap ---- */
assert(p.overlap.bigEdge > 1.0,
  `the large glass must refract at its rim (edge=${p.overlap.bigEdge}px)`);
assert(p.overlap.smallEdge > 0 || p.overlap.tinyEdge > 0,
  `at least one secondary glass must show measurable refraction (small=${p.overlap.smallEdge}, tiny=${p.overlap.tinyEdge})`);

/* ---- source failure fallback ---- */
assert(p.sourceFailure.state === "failed", `bad image must fail the scene (got ${p.sourceFailure.state})`);
assert(p.sourceFailure.hasGlClass === false, "source failure must drop the GL class");
assert(p.sourceFailure.glassClass.includes("mina-liquid-native") || p.sourceFailure.glassClass.includes("mina-liquid-static"),
  "source failure must keep a visible CSS surface class");

/* ---- context lost ---- */
assert(p.contextLost.backend === "native" && p.contextLost.glassClass.includes("mina-liquid-native"),
  "context loss must degrade to the CSS frost fallback with the right class");
assert(p.contextLost.hasGlClass === false, "context loss must drop the GL class");
assert(p.contextRestoredImmediate.hasGlClass === false,
  "restore must not re-enable GL before the scene is re-earned");
assert(p.contextRestoredAfterFrames.state === "ready" && p.contextRestoredAfterFrames.hasGlClass === true,
  "restore + fresh scene frame must re-earn GL pixels");

/* ---- destroy ---- */
assert(p.destroyed === "destroyed", "destroy must complete");
assert(!p.destroyedClass.includes("mina-liquid-gl"), "destroy must remove GL classes");

console.log("VISUAL VALIDATION PASSED");
