/* new-blast.mjs — NEW blast-engine presets (wave 31) for the controls no preset used yet: the bullet heard from
 * DOWNRANGE (blastDownrange / blastCrack / blastSpeed), the places past "Open field" (Canyon, Indoors) and the
 * mechanism (blastAction / blastActionType / blastCasing), plus a bolt-action reload built from layers.
 *
 *   node tools/proto/new-blast.mjs            render soundtests/new-presets/<slug>.wav (+ -alt<N>.wav), print the checks
 *   node tools/proto/new-blast.mjs --json     the same, and write tools/new-presets/blast.json
 *
 * Renders with the EXPORTED bundle (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does, at the
 * preset's REAL level (the app's default Normalize on, the preset's own gain): NOT loudness-matched. The bundle is read
 * into memory and one line is added there (never on disk) to also expose makeBlast / blastCfg, so the model's own timing
 * (crack lead, place taps) can be printed beside what is measured in the output.
 *
 * Checks per sound: clipping (samples at full scale), DC (per-channel mean), duration and the length to -60 dB, LUFS
 * (ITU BS.1770, make-ab's meter) against the median of the shipped blast presets, peak. Downrange sounds: the
 * crack-to-report gap measured in the OUTPUT (crack = the peak of the >3 kHz band, report = the onset of the <400 Hz band)
 * against the physics, d (1/c - 1/v). Canyon: the echoes found in the output envelope, and the envelope's
 * autocorrelation.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
  Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ctx.window = ctx; ctx.globalThis = ctx;
const src = readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8")
  .replace("root.CrunchySynth = {", "root.__blast = { makeBlast: makeBlast, blastCfg: blastCfg };\nroot.CrunchySynth = {");
runInContext(src, ctx, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR, BL = runInContext("__blast", ctx);
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS;
const C_AIR = 343;

// ---- the meter (make-ab.mjs's BS.1770)
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function kweight(x) {
  const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, c = Math.cos(w), al = Math.sin(w) / (2 / Math.SQRT2), sa = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
    (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
  const w2 = 2 * Math.PI * 38 / SR, c2 = Math.cos(w2), al2 = Math.sin(w2) / (2 * 0.5);
  return biquad(s, (1 + c2) / 2, -(1 + c2), (1 + c2) / 2, 1 + al2, -2 * c2, 1 - al2);
}
function lufs(L, R) {
  const kl = kweight(L), kr = kweight(R), B = Math.round(0.4 * SR), H = Math.round(0.1 * SR), ms = [];
  const block = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += kl[i] * kl[i] + kr[i] * kr[i]; return s / (b - a); };
  if (L.length <= B) ms.push(block(0, L.length)); else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
  const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
  let g = ms.filter((m) => l(m) > -70); if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10;
  g = g.filter((m) => l(m) > rel);
  return l(g.reduce((t, m) => t + m, 0) / g.length);
}
// 2nd-order Butterworth (RBJ) low / high pass, run twice (4th order)
function bw(x, fc, hp) {
  const w = 2 * Math.PI * fc / SR, c = Math.cos(w), al = Math.sin(w) / Math.SQRT2;
  const k = hp ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
  return biquad(biquad(x, k[0], k[1], k[2], 1 + al, -2 * c, 1 - al), k[0], k[1], k[2], 1 + al, -2 * c, 1 - al);
}
// RMS envelope in dB, hop 1 ms, window `win` s
function envDb(x, win) {
  const h = Math.round(0.001 * SR), w = Math.max(1, Math.round(win * SR)), out = [];
  for (let a = 0; a < x.length; a += h) { let s = 0, n = 0; for (let i = a; i < Math.min(x.length, a + w); i++) { s += x[i] * x[i]; n++; } out.push(10 * Math.log10(s / Math.max(1, n) + 1e-20)); }
  return out;
}

const clean = (p) => { const o = Object.assign({}, p); delete o._vary; delete o._alts; delete o.category; delete o._note; return o; };
function render(patch) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, clean(patch)), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
function measure(L, R) {
  const n = L.length; let pk = 0, clip = 0, sl = 0, sr = 0, nan = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (!isFinite(L[i]) || !isFinite(R[i])) nan++;
    if (a > pk) pk = a; if (b > pk) pk = b; if (a >= 0.999 || b >= 0.999) clip++; sl += L[i]; sr += R[i];
  }
  const mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2), env = envDb(mono, 0.01), top = Math.max(...env);
  let last = 0; env.forEach((v, i) => { if (v > top - 60) last = i; });
  // crest against the loudest 400 ms
  const B = Math.min(n, Math.floor(0.4 * SR)); let best = 0;
  for (let a = 0; a + B <= n; a += Math.floor(0.02 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / B); }
  // DC also as a LOW-band check: the mean over every 100 ms window, worst
  let dcWin = 0; const W = Math.floor(0.1 * SR);
  for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += mono[i]; dcWin = Math.max(dcWin, Math.abs(s / W)); }
  const e = Math.floor(0.002 * SR); let eEnd = 0; for (let i = 0; i < e; i++) eEnd = Math.max(eEnd, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i]));
  let eAll = 0, eLo = 0, eHi = 0, eHiLate = 0; const lo = bw(mono, 150, false), hi = bw(mono, 2000, true);
  for (let i = 0; i < n; i++) { eAll += mono[i] * mono[i]; eLo += lo[i] * lo[i]; eHi += hi[i] * hi[i]; if (i > 0.2 * SR) eHiLate += hi[i] * hi[i]; }
  return { low: eLo / eAll, high: eHi / eAll, hiLate: eHiLate / eAll, sec: n / SR, len60: last / 1000, lufs: lufs(L, R), peak: pk, clip, nan, dcL: sl / n, dcR: sr / n, dcWin, crestDb: 20 * Math.log10(pk / Math.sqrt(best || 1e-20)), endEdge: eEnd / (pk || 1) };
}
// DOWNRANGE: the crack's time = the peak of the >3 kHz band in the first 50 ms; the report's arrival = the first ms
// after the crack + 30 ms at which the <400 Hz band's 5 ms envelope comes within 12 dB of its own maximum after that
function gapOf(L, R) {
  const mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2), hi = bw(mono, 3000, true), lo = bw(mono, 400, false);
  let ci = 0, cm = 0; for (let i = 0; i < Math.floor(0.05 * SR); i++) if (Math.abs(hi[i]) > cm) { cm = Math.abs(hi[i]); ci = i; }
  const env = envDb(lo, 0.005), c0 = Math.round(ci / (0.001 * SR)), from = c0 + 30, after = env.slice(from), mx = Math.max(...after);
  const on = after.findIndex((v) => v > mx - 12);
  // the high band's level at the report against the crack's (is the report dull, as the air makes it?)
  const envH = envDb(hi, 0.005), crackHi = Math.max(...envH.slice(c0, c0 + 3)), reportHi = Math.max(...envH.slice(from + on, from + on + 40));
  const crackLo = Math.max(...env.slice(Math.max(0, c0 - 2), c0 + 10));
  // sample peaks in the crack's first 30 ms and the report's first 150 ms; and their 50 ms RMS (a rough short-term loudness)
  const rp = (a, b) => { let m = 0; for (let i = Math.max(0, a); i < Math.min(mono.length, b); i++) m = Math.max(m, Math.abs(mono[i])); return m; };
  const r50 = (a, b) => { const w = Math.round(0.05 * SR); let best = 0; for (let i = Math.max(0, a); i + w <= Math.min(mono.length, b + w); i += 32) { let s = 0; for (let j = i; j < i + w; j++) s += mono[j] * mono[j]; best = Math.max(best, s / w); } return Math.sqrt(best); };
  const rA = Math.round(((from + on) / 1000 - 0.01) * SR);
  const crackPk = 20 * Math.log10(rp(0, Math.round(0.03 * SR))), reportPk = 20 * Math.log10(rp(rA, rA + Math.round(0.15 * SR)));
  const c50 = 20 * Math.log10(r50(0, Math.round(0.06 * SR))), rep50 = 20 * Math.log10(r50(rA, rA + Math.round(0.3 * SR)));
  return { crackAt: ci / SR, reportAt: (from + on) / 1000, gap: (from + on) / 1000 - ci / SR, hiDropDb: reportHi - crackHi, loRiseDb: mx - crackLo, crackOverReport: crackPk - reportPk, crack50: c50 - rep50 };
}
// ECHOES, exactly: makeBlast is linear in the place (wet = the source convolved with the place's IR; Place level 0 makes
// it zero and leaves the source's own random stream untouched), so full - dry IS the place's signal. Probed with the
// PRESSURE WAVE ALONE (no roar, rumble or debris: a near-impulse), the 10 ms envelope's peaks are the echoes the place
// makes. Each is then looked for in the real OUTPUT (<1.5 kHz, 20 ms envelope): its max within +-30 ms against the
// lowest point of the 80 ms before, i.e. whether it stands out of the roar, rumble and debris around it.
function placeEchoes(cfg, seed, n, L, R) {
  const cp = Object.assign({}, cfg, { "roar": 0, "rumble": 0, "debris": 0, "action": 0, "casing": 0, "crack": 0 });
  const A = BL.makeBlast(SR, n, cp, seed), B = BL.makeBlast(SR, n, Object.assign({}, cp, { "room": 0 }), seed), at = A.info.blastAt;
  const wet = new Float64Array(n), dry = new Float64Array(n);
  for (let i = 0; i < n; i++) { dry[i] = (B.L[i] + B.R[i]) / 2; wet[i] = (A.L[i] + A.R[i]) / 2 - dry[i]; }
  let eD = 0, eE = 0, eLt = 0; const i80 = at + Math.round(0.08 * SR);
  for (let i = 0; i < n; i++) { eD += dry[i] * dry[i]; if (i < i80) eE += wet[i] * wet[i]; else eLt += wet[i] * wet[i]; }
  const ew = envDb(wet, 0.01), dPk = Math.max(...envDb(dry, 0.01)), a0 = Math.round(at / (0.001 * SR)), out = [];
  const mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2), eo = envDb(bw(mono, 1500, false), 0.02), oPk = Math.max(...eo);
  for (let i = a0 + 100; i < ew.length - 40; i++) {
    const win = ew.slice(i - 60, i + 61), lo = Math.min(...ew.slice(i - 60, i));
    if (ew[i] === Math.max(...win) && ew[i] - lo >= 6 && ew[i] > dPk - 30) {
      const oMax = Math.max(...eo.slice(i - 30, i + 31)), oLo = Math.min(...eo.slice(i - 110, i - 30));
      out.push({ t: (i - a0) / 1000, db: ew[i] - dPk, outProm: oMax - oLo, outDb: oMax - oPk });
    }
  }
  const lin = eo.slice(a0 + 80).map((v) => Math.pow(10, v / 20)), m = lin.reduce((a, b) => a + b, 0) / lin.length, z = lin.map((v) => v - m);
  const ac = (k) => { let s = 0; for (let i = 0; i + k < z.length; i++) s += z[i] * z[i + k]; return s; }, z0 = ac(0), acp = [];
  for (let k = 150; k < Math.min(1600, z.length - 100); k++) { const v = ac(k) / z0; if (v > 0.1 && v >= ac(k - 1) / z0 && v >= ac(k + 1) / z0) acp.push({ lag: k / 1000, r: v }); }
  acp.sort((p, q) => q.r - p.r);
  return { early: 10 * Math.log10(eE / eD), late: 10 * Math.log10(eLt / eD), taps: A.info.taps, rt60: A.info.rt60, echoes: out, ac: acp.slice(0, 3) };
}
// onsets of discrete events (the reload): 2 ms envelope peaks rising >= 10 dB from the floor before them
function onsetsOf(L, R) {
  const mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2), env = [-200, -200, -200, -200, -200].concat(envDb(mono, 0.002)), top = Math.max(...env), out = [];
  for (let i = 5; i < env.length; i++) {
    const floor = Math.min(...env.slice(Math.max(0, i - 20), i - 1));
    if (env[i] > top - 30 && env[i] - floor >= 10 && env[i] >= env[i - 1] && (!out.length || i / 1000 - out[out.length - 1].t > 0.03)) out.push({ t: (i - 5) / 1000, db: env[i] - top });
  }
  return out;
}

// ---- THE SHIPPED BLAST PRESETS (the level reference)
const REF = ["Explosion", "Grenade Blast", "Distant Boom", "Pistol Shot", "Sniper Rifle"];
const f = (x, d = 1) => x.toFixed(d);
const line = (m) => f(m.sec, 2) + " s (to -60 dB " + f(m.len60, 2) + " s), " + f(m.lufs) + " LUFS, peak " + f(m.peak, 3) + ", clip " + m.clip +
  ", DC " + m.dcL.toExponential(1) + "/" + m.dcR.toExponential(1) + ", crest " + f(m.crestDb) + " dB, <150 Hz " + f(m.low * 100, 0) + "% / >2 kHz " + f(m.high * 100, 0) + "% of energy (>2 kHz after 0.2 s " + f(m.hiLate * 100, 1) + "%), end edge " + f(m.endEdge, 4);
console.log("SHIPPED BLAST PRESETS (normalize on, their own gain)");
const refL = [];
for (const name of REF) {
  const r = render(PRESETS[name]), m = measure(r.L, r.R); refL.push(m.lufs);
  console.log("  " + name.padEnd(16) + line(m));
  (PRESETS[name]._alts || []).forEach((a, i) => { const ra = render(a), ma = measure(ra.L, ra.R); console.log("  " + (name + " alt" + (i + 1)).padEnd(16) + line(ma)); });
}
const sorted = refL.slice().sort((a, b) => a - b), MED = sorted[sorted.length >> 1];
console.log("  median " + f(MED) + " LUFS (of the five base presets)");
for (const name of ["Quick Reload", "Shell Casing"]) { const r = render(PRESETS[name]), m = measure(r.L, r.R); console.log("  " + name.padEnd(16) + line(m)); }

// ---- THE NEW PRESETS
const BASE = { attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06, filterMode: 0, cutoff: 12000, reso: 0.31, drive: 0, reverb: 0, gain: 1 };
// key order as presets.js writes them: the blast's rows, width, the plain envelope, gain, duration, _vary
const blast = (o) => { const { _vary, duration, gain, width, ...rest } = o; return Object.assign({ wave: 31 }, rest, { width }, BASE, { gain: gain != null ? gain : 1, duration, _vary }); };
const COMMON = { width: 0.7 };
const lay = (s, d, g) => ({ s, d, g, p: 0 });
// The bolt-action reload: NOT the blast engine (see the note on it below). Four layers, the most a sound holds.
const CASING = { wave: 10, freq: 2600, modalPartials: 4, modalInharm: 0.6, modalBright: 0.85, modalDecay: 0.15, sustain: 1, attack: 0.001, release: 0.3, reverb: 0.1, duration: 0.75, repeat: 3, rate: 7 };
const NEW = {
  // A rifle round passing ~5 m away (the engine's miss distance downrange), fired 150 m off down a town street: the
  // crack first, the report 0.25 s behind it (150 m x (1/343 - 1/800) s/m), the facades flutter-slapping both. Peak
  // control OFF on purpose: a downrange crack is a ~0.2 ms N-wave, the sample peak with almost no energy, so any Peak
  // control squeezes exactly the crack under the report (measured: at 1.25 the crack sat 1.2 dB UNDER the report's
  // peak). The street's place and a heavy report body carry the loudness instead, the crack staying the peak.
  "Bullet Whiz": { category: "Guns", patch: blast({ blastSize: 0.22, blastDist: 150, blastEnv: 1, blastPulse: 3, blastShape: 1.3, blastRoar: 0.7, blastRumble: 1,
    blastCrack: 1, blastDownrange: 1, blastSpeed: 800, blastRoom: 1.6, blastSeed: 601, width: 0.7, duration: 1.2,
    _vary: { blastSeed: 1, blastDist: 0.15 } }) },
  // A magnum-class rifle 600 m away across open country: the crack ~0.95 s ahead of the report (Bullet speed is the
  // MEAN over the flight: ~900 m/s at the muzzle slowing to ~600 by 600 m), the report dull from the air (corner
  // ~1 kHz), the far terrain answering. A little Peak control: the crack stands ~8 dB over the report without it.
  "Sniper From Afar": { category: "Guns", patch: blast({ blastSize: 0.3, blastDist: 600, blastEnv: 0, blastPulse: 3, blastShape: 1.3, blastRoar: 0.8, blastRumble: 1,
    blastCrack: 1, blastDownrange: 1, blastSpeed: 750, blastRoom: 2, blastSeed: 613, blastPeak: 0.4, width: 0.7, duration: 2.4,
    _vary: { blastSeed: 1, blastDist: 0.1 } }) },
  // ~5 kg in a rocky canyon, 60 m away: the walls answer at ~0.41 / 0.88 / 1.43 / 1.99 s (this seed's canyon), each
  // smeared by the rough face and darker than the last, over a long low tail; stone and rubble debris.
  "Canyon Blast": { category: "Explosions", patch: blast({ blastSize: 0.7, blastDist: 60, blastEnv: 3, blastPulse: 2.5, blastShape: 1, blastRoar: 0.5, blastRumble: 0.7,
    blastDebris: 0.35, blastDebrisType: 1, blastRoom: 1.2, blastTail: 1.2, blastSeed: 706, blastPeak: 0.3, width: 0.85, gain: 0.75, duration: 3.0,
    _vary: { blastSeed: 1, blastSize: 0.04, blastDist: 0.15 } }) },
  // ~0.3 kg in a 9 x 7 x 3.2 m chamber, 5 m away: the early reflections pile into one dense boxy boom, a short room
  // tail (Place length 0.8), rubble (stone and metal) coming down.
  "Mine Charge": { category: "Explosions", patch: blast({ blastSize: 0.45, blastDist: 5, blastEnv: 2, blastPulse: 1.5, blastShape: 1.1, blastRoar: 0.35, blastRumble: 0.6,
    blastDebris: 0.7, blastDebrisType: 1, blastTail: 0.8, blastSeed: 727, blastPeak: 0.5, width: 0.7, duration: 1.8,
    _vary: { blastSeed: 1, blastSize: 0.04, blastDist: 0.15 } }) },
  // A black-powder cannon 20 m away in the open: the pressure wave stretched 3.5x and FAT (Wave shape 0.6: a deep
  // suck-back after the hit), the gas and smoke at full (Fire / gas 1), a sub rumble, no debris.
  "Cannon": { category: "Explosions", patch: blast({ blastSize: 0.55, blastDist: 20, blastEnv: 0, blastPulse: 3.5, blastShape: 0.6, blastRoar: 1, blastRumble: 0.6,
    blastSeed: 743, blastPeak: 0.3, width: 0.75, duration: 2.0,
    _vary: { blastSeed: 1, blastSize: 0.04, blastDist: 0.15 } }) },
  // One stick (~0.2 kg) 20 m away in the open: a SPIKY wave (Wave shape 1.6) at near its physical length (Weight 1.4),
  // little fire, rubble thrown high and raining down for ~1.2 s.
  "Dynamite": { category: "Explosions", patch: blast({ blastSize: 0.51, blastDist: 20, blastEnv: 0, blastPulse: 1.4, blastShape: 1.6, blastRoar: 0.3, blastRumble: 0.35,
    blastDebris: 0.85, blastDebrisType: 1, blastSeed: 761, blastPeak: 0.9, width: 0.7, duration: 1.8,
    _vary: { blastSeed: 1, blastSize: 0.04, blastDist: 0.15 } }) },
  "Bolt-Action Reload": { category: "Guns", ref: -12.3, onsets: true, patch: {
    // bolt UP (0 s) and DOWN (0.45 s): the handle turning, a short bright click
    wave: 19, impactTone: 0.8, impactDecay: 0.04, impactPunch: 1, impactGrit: 0.15, attack: 0.001, decay: 0.02, sustain: 0, release: 0.03, duration: 0.5, repeat: 2, rate: 2.22, gain: 0.56,
    layers: JSON.stringify([
      // the bolt drawn BACK (0.04 s) and pushed FORWARD (0.29 s): steel sliding on steel, band noise
      lay({ wave: 0, freq: 2600, noise: 1, attack: 0.03, hold: 0.03, decay: 0.05, sustain: 0, release: 0.02, filterMode: 2, cutoff: 2600, reso: 0.35, duration: 0.35, repeat: 2, rate: 4 }, 0.04, 0.45),
      // the bolt hitting its STOP (0.16 s) and going HOME (0.39 s): a heavier steel clack
      lay({ wave: 19, impactTone: 0.6, impactDecay: 0.07, impactPunch: 1, impactGrit: 0.3, boom: 0.2, boomFreq: 180, attack: 0.001, decay: 0.02, sustain: 0, release: 0.03, duration: 0.35, repeat: 2, rate: 4.35 }, 0.16, 0.9),
      // the spent casing (thrown out at the stop) landing: Shell Casing itself
      lay(CASING, 0.55, 0.35),
    ]) } },
};

const OUT = join(ROOT, "soundtests", "new-presets");
mkdirSync(OUT, { recursive: true });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const json = {};
console.log("\nNEW PRESETS (median target " + f(MED) + " LUFS, +-2 dB)");
for (const [name, def] of Object.entries(NEW)) {
  const takes = [def.patch].concat(def.patch._alts || []);
  takes.forEach((p, k) => {
    const r = render(p), m = measure(r.L, r.R), file = slug(name) + (k ? "-alt" + k : "") + ".wav";
    writeFileSync(join(OUT, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + (k ? " alt " + k : "") })));
    const ref = def.ref != null ? def.ref : MED, dl = m.lufs - ref, bad = [];
    if (m.clip) bad.push("CLIP"); if (m.nan) bad.push("NaN"); if (Math.abs(dl) > 2) bad.push("LUFS off " + f(dl)); if (Math.max(Math.abs(m.dcL), Math.abs(m.dcR)) > 1e-3) bad.push("DC");
    if (m.sec > 2.0) bad.push("over 2 s"); if (m.endEdge > 0.02) bad.push("end edge");
    console.log("  " + (name + (k ? " alt" + k : "")).padEnd(22) + line(m) + "  [" + (dl >= 0 ? "+" : "") + f(dl) + " vs " + f(ref) + "]" + (bad.length ? "  !! " + bad.join(", ") : ""));
    const pc = clean(p);
    if (pc.wave === 31) {
      const cfg = BL.blastCfg(Object.assign({}, CS.DEFAULTS, pc)), info = BL.makeBlast(SR, Math.round(SR * 0.3), cfg, Math.round(pc.blastSeed || 0)).info;
      if (cfg.downrange && cfg.crack > 0) {
        const g = gapOf(r.L, r.R), phys = cfg.distance * (1 / C_AIR - 1 / cfg.speed);
        console.log("      downrange " + cfg.distance + " m at " + cfg.speed + " m/s: physics d(1/c - 1/v) = " + f(phys, 3) + " s, model lead " + f(info.crackLead, 3) +
          " s; MEASURED crack " + f(g.crackAt * 1000, 1) + " ms -> report " + f(g.reportAt, 3) + " s: gap " + f(g.gap, 3) + " s (" + f((g.gap - phys) * 1000, 0) + " ms off); report's >3 kHz band " + f(g.hiDropDb) + " dB under the crack's; crack over report: sample peak " + f(g.crackOverReport) + " dB, 50 ms RMS " + f(g.crack50) + " dB; <400 Hz rises " + f(g.loRiseDb) + " dB from crack to report");
      }
      if (cfg.env === 3 || cfg.env === 2 || def.echoes) {
        const e = placeEchoes(cfg, Math.round(pc.blastSeed || 0), r.L.length, r.L, r.R);
        console.log("      place taps (model, strongest): " + e.taps.slice(0, 6).map((t) => f(t.t * 1000, 0) + " ms x" + f(t.g, 2)).join(", ") + "; RT60 " + f(e.rt60, 2) + " s; the place's energy against the direct: first 80 ms " + f(e.early) + " dB, after " + f(e.late) + " dB");
        console.log("      ECHOES the place makes (pressure wave alone, Place level 0 subtracted), after the onset: " +
          e.echoes.map((x) => f(x.t, 3) + " s (" + f(x.db) + " dB re the direct; in the output " + f(x.outDb) + " dB re its peak, +" + f(x.outProm) + " dB over the 80 ms before)").join("; "));
        console.log("      output envelope autocorrelation (after the direct): " + (e.ac.length ? e.ac.map((x) => f(x.lag, 3) + " s r=" + f(x.r, 2)).join(", ") : "none"));
      }
    }
    if (def.onsets) console.log("      event onsets: " + onsetsOf(r.L, r.R).map((o) => f(o.t, 3) + " s (" + f(o.db) + ")").join(", "));
  });
  const out = Object.assign({}, def.patch, { category: def.category });
  json[name] = out;
}
if (process.argv.includes("--json")) {
  mkdirSync(join(ROOT, "tools", "new-presets"), { recursive: true });
  writeFileSync(join(ROOT, "tools", "new-presets", "blast.json"), JSON.stringify(json, null, 2) + "\n");
  console.log("-> tools/new-presets/blast.json");
}
console.log("-> " + OUT);
