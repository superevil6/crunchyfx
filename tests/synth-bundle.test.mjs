// CrunchySFX — the EXPORTED synth bundle, run where its consumers run it: outside the app, in a bare
// sandbox (node vm) with nothing but the bundle loaded. No index.html globals exist here, so any read of an
// app global (`customIR`, `sampleBuf`, `state` …) is a ReferenceError, exactly as in CrunchyVFX or CrunchyBGM.
//
//   python3 tools/export-synth.py && node tests/synth-bundle.test.mjs
//
// SFX 1.3 bug 3 (SFX-1.3-PLAN.md): renderPatch read the app global `customIR`, so a link with
// `convType: 4, convMix > 0` threw inside the bundle. This file proved it, then guards the fix.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = path.join(ROOT, "synth-export", "crunchysfx-synth.js");

let fails = 0, passes = 0;
const ok = (cond, what) => { if (cond) { passes++; console.log("ok   " + what); } else { fails++; console.log("FAIL " + what); } };

function load() {
  const sandbox = { TextEncoder, atob, btoa, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(BUNDLE, "utf8"), sandbox, { filename: "crunchysfx-synth.js" });
  return sandbox.CrunchySynth;
}
const S = load();
const patch = (over) => Object.assign({}, S.DEFAULTS, over);
const peak = (r) => { let m = 0; for (let i = 0; i < r.L.length; i++) m = Math.max(m, Math.abs(r.L[i]), Math.abs(r.R[i])); return m; };
const same = (a, b) => a.L.length === b.L.length && a.L.every((v, i) => Object.is(v, b.L[i])) && a.R.every((v, i) => Object.is(v, b.R[i]));

// 1. Custom IR selected and mixed in, no IR given: renders dry (the app's "none loaded → stays dry"), never throws.
let threw = null, r1 = null;
try { r1 = S.render(patch({ convType: 4, convMix: 0.5 })); } catch (e) { threw = e; }
ok(!threw, "convType 4 + convMix > 0 renders in the bare bundle" + (threw ? " (threw " + threw + ")" : ""));
if (r1) ok(same(r1, S.render(patch({ convType: 4, convMix: 0 }))), "…with no IR given it is dry (equal to convMix 0)");

// 2. An IR passed through opts is used: the wet sound differs from the dry one.
const irL = new Float32Array(4410), irR = new Float32Array(4410);
for (let i = 0; i < irL.length; i++) { const e = Math.exp(-i / 900); irL[i] = Math.sin(i * 0.37) * e; irR[i] = Math.cos(i * 0.41) * e; }
let r2 = null; threw = null;
try { r2 = S.render(patch({ convType: 4, convMix: 0.5 }), { customIR: { L: irL, R: irR } }); } catch (e) { threw = e; }
ok(!threw && r2 && !same(r2, r1), "opts.customIR is convolved in (differs from dry)");
// NEGATIVE: an IR handed over but convMix 0 changes nothing.
ok(same(S.render(patch({ convType: 4, convMix: 0 }), { customIR: { L: irL, R: irR } }), S.render(patch({ convType: 4, convMix: 0 }))),
   "negative: convMix 0 ignores opts.customIR");

// 3. Every engine renders in the bare bundle (a wider net for any other app global).
const WAVE_MAX = S.PARAMS.find((p) => p[0] === "wave")[3];
ok(WAVE_MAX >= 18, "the wave row spans every engine (" + (WAVE_MAX + 1) + ")");
for (let w = 0; w <= WAVE_MAX; w++) {
  threw = null;
  try { S.render(patch({ wave: w, duration: 0.2, convType: 1, convMix: 0.3, reverb: 0.2 })); } catch (e) { threw = e; }
  ok(!threw, "wave " + w + " renders in the bare bundle" + (threw ? " (threw " + threw + ")" : ""));
}
ok(peak(S.render(patch({ wave: 17, speechText: "hello", duration: 0.6 }))) > 0.01, "speech with text speaks in the bundle");

// 4. opts.raw (SFX 1.3, layers): the raw render differs from the normal one ONLY by the master stage. Running the
// exported masterStage over a raw render gives the normal render's exact samples, for every engine, normalize on and
// off, with the limiter and reverse in play; and raw is not secretly the same thing (negative).
const RAW_CASES = [];
for (let w = 0; w <= WAVE_MAX; w++) RAW_CASES.push(patch({ wave: w, duration: 0.25, speechText: "hi" }));
RAW_CASES.push(patch({ wave: 3, duration: 0.3, limiter: 0.6, reverse: 1, gain: 0.7, reverb: 0.3 }));
RAW_CASES.push(patch({ wave: 0, duration: 0.3, gain: 0.05, cutoff: 400 }));
let rawSame = 0, rawDiffer = 0;
for (const pt of RAW_CASES) for (const normalize of [true, false]) {
  const normal = S.render(pt, { normalize }), raw = S.render(pt, { normalize, raw: true });
  if (raw.rawPeak === normal.rawPeak) rawSame++;
  const L = Float32Array.from(raw.L), R = Float32Array.from(raw.R);
  if (!same({ L, R }, normal)) rawDiffer++;
  S.masterStage(L, R, pt, raw.rawPeak, normalize);
  if (!same({ L, R }, normal)) { fails++; console.log("FAIL raw + masterStage != normal: wave " + pt.wave + " normalize " + normalize); }
}
ok(rawSame === RAW_CASES.length * 2, "raw reports the same rawPeak as the normal render (" + rawSame + "/" + RAW_CASES.length * 2 + ")");
ok(rawDiffer >= RAW_CASES.length, "negative: raw is not the normal render (" + rawDiffer + " of " + RAW_CASES.length * 2 + " differ before the master stage)");
passes++; console.log("ok   masterStage(raw) equals the normal render in all " + RAW_CASES.length * 2 + " cases (or a FAIL line above)");

// 5. opts.seedSalt (SFX 1.3, layers): 0 is today's bytes for every engine; 1 moves every engine with randomness and
// nothing without it (a plain sine has no seed to salt).
const NOISY = { 8: "pluck", 11: "granular", 14: "bubble", 15: "particle", 16: "additive", 17: "speech", 19: "impact", 20: "whoosh" };
for (let w = 0; w <= WAVE_MAX; w++) {
  const pt = patch({ wave: w, duration: 0.25, speechText: "hiss", addDetune: 0.5, convType: 0, convMix: 0.3 });
  const base = S.render(pt), s0 = S.render(pt, { seedSalt: 0 }), s1 = S.render(pt, { seedSalt: 1 });
  if (!same(base, s0)) { fails++; console.log("FAIL seedSalt 0 moved wave " + w); }
  if (w !== 9 && same(base, s1)) { fails++; console.log("FAIL seedSalt 1 left wave " + w + " (with a synth IR) unchanged"); }
}
passes++; console.log("ok   seedSalt 0 equals no salt, and seedSalt 1 differs, on every engine but the sample (silent with none given) (or FAIL lines above)");
for (const w in NOISY) {
  const pt = patch({ wave: +w, duration: 0.25, speechText: "hiss", addDetune: 0.5, grainSpray: 0.3, grainSpread: 0.3 });
  ok(!same(S.render(pt), S.render(pt, { seedSalt: 1 })), "seedSalt 1 changes " + NOISY[w] + "'s own randomness (no reverb)");
}
const sine = patch({ wave: 0, duration: 0.25 });
ok(same(S.render(sine), S.render(sine, { seedSalt: 7 })), "negative: a plain sine (no seed used) is unmoved by a salt");
ok(!same(S.render(patch({ wave: 0, noise: 0.4, duration: 0.25 })), S.render(patch({ wave: 0, noise: 0.4, duration: 0.25 }), { seedSalt: 1 })),
   "seedSalt 1 changes the noise layer (the main LCG)");

// 6b. SFX 1.3 LAYERS through the bare bundle (what CrunchyVFX and BGM call): a link's patch with `layers` renders every
// layer mixed; no layers (absent, "" or unreadable) is exactly the single sound; delays lengthen it; a muted layer is gone.
{
  const base = patch({ wave: 19, duration: 0.3 }), ext = { wave: 0, freq: 220, duration: 0.3 };
  const lay = (list) => Object.assign({}, base, { layers: JSON.stringify(list) });
  ok(same(S.render(Object.assign({}, base, { layers: "" })), S.render(base)) && same(S.render(Object.assign({}, base, { layers: "nonsense{" })), S.render(base)),
     "layers absent, empty or unreadable: exactly the single sound");
  const two = S.render(lay([{ s: ext, d: 0, g: 1, p: 0 }]));
  ok(!same(two, S.render(base)) && two.L.length === S.render(base).L.length, "a second layer is mixed in (same length at no delay)");
  ok(S.render(lay([{ s: ext, d: 0.25, g: 1, p: 0 }])).L.length === Math.floor(0.55 * S.SR) || S.render(lay([{ s: ext, d: 0.25, g: 1, p: 0 }])).L.length === Math.round(0.25 * S.SR) + Math.floor(0.3 * S.SR),
     "a delay lengthens the sound to the latest layer's end");
  const muted = S.render(lay([{ s: ext, d: 0, g: 1, p: 0, m: 1 }]));
  ok(muted.L.length === S.render(base).L.length && !same(muted, two), "a muted layer is not heard");
  ok(!same(S.render(lay([{ s: ext, d: 0, g: 1, p: 12 }])), two), "pitch moves a layer");
  ok(same(S.render(lay([{ s: ext, d: 0.05, g: 0.5, p: -7 }])), S.render(lay([{ s: ext, d: 0.05, g: 0.5, p: -7 }]))), "deterministic");
  const peak = (r) => r.L.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  ok(peak(two) <= 1, "the mix stays within full scale (one master stage over the sum)");
  ok(typeof S.renderLayers === "function", "the bundle publishes renderLayers");
}

// 6. The exporter's guards still catch their negatives (an app-global read, a `state.` read).
import { execFileSync } from "node:child_process";
let selfTest = "";
try { selfTest = execFileSync("python3", [path.join(ROOT, "tools", "export-synth.py"), "--self-test"], { encoding: "utf8" }); } catch (e) { selfTest = String(e.stdout || e); }
ok(/self-test passed/.test(selfTest), "export-synth.py's guards catch their negatives (" + selfTest.trim() + ")");

console.log((fails ? "FAILED " : "PASSED ") + passes + "/" + (passes + fails));
process.exit(fails ? 1 : 0);
