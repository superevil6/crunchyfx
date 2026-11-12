/* new-friction.mjs — new presets on the friction engine (wave 34), the WOOD body (fricBody 0) that no preset used.
 *
 *   node tools/proto/new-friction.mjs            measure the shipped friction presets, render + measure the new ones,
 *                                                 write soundtests/new-presets/<slug>[-altN].wav and
 *                                                 tools/new-presets/friction.json
 *   node tools/proto/new-friction.mjs seeds      also sweep each new sound's _vary seed range (what a re-click can play)
 *
 * Renders with the EXPORTED engine bundle (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does,
 * at the preset's REAL level (the app's default: Normalize on, then the preset's Gain), NOT loudness-matched.
 * Measures (the agent cannot hear): integrated loudness (ITU BS.1770, copied from make-ab.mjs), peak, DC, clipping,
 * and whether the stick-slip CHATTERS, from a dry render (reverb 0): the 2 ms RMS envelope's modulation (a steady tone
 * or a noise bed sits near 0.2-0.4, separate catches well over 0.6), the tick count (envelope peaks standing over their
 * neighborhood), and autocorrelation pitch + clarity per 100 ms (a locked squeal is one steady pitch at high clarity).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
  Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ctx.window = ctx; ctx.globalThis = ctx;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS;

// ---- loudness: ITU BS.1770 (copied from tools/make-ab.mjs)
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
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
  if (L.length <= B) ms.push(block(0, L.length));
  else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
  const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
  let g = ms.filter((m) => l(m) > -70);
  if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10;
  g = g.filter((m) => l(m) > rel);
  return l(g.reduce((t, m) => t + m, 0) / g.length);
}

// ---- THE CATCHES, counted: an in-memory copy of dsp.js's makeFriction with a counter added (a slip after a grip of
// 1 ms or more, the catch-and-release heard as a tick, as the prototype counted them). dsp.js is READ, never edited; the
// copy's buffer is checked against the bundle's own dry render below so the count is of the shipped model.
const dsrc = readFileSync(join(ROOT, "dsp.js"), "utf8");
const inj = dsrc
  .replace("let travel = 0, t = 0, grit = 0;", "let travel = 0, t = 0, grit = 0; let stuckN = 0; const catches = [];")
  .replace("if (Math.abs(Fst) <= N * muS) F = Fst;\n    else {", "if (Math.abs(Fst) <= N * muS) { F = Fst; stuckN++; }\n    else { if (stuckN) { if (stuckN >= FRICTION_OS * sr / 1000) catches.push(t); stuckN = 0; }")
  .replace("    tick(speed, press) {", "    catches,\n    tick(speed, press) {");
if (inj === dsrc || !inj.includes("catches.push")) throw new Error("dsp.js anchors moved: update the catch counter");
const dctx = createContext({ Math, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView, console });
runInContext(inj + "\n;globalThis.__fr = { makeFriction, frictionCfg, frictionCurveAt, frictionBuffer, FRICTION_RAMP };", dctx);
const FR = dctx.__fr;
function catchesOf(patch) {
  if (!catchesOf.checked) {   // the instrumented copy must BE the shipped model: compare its buffer with the dsp.js original's
    catchesOf.checked = true;
    const octx = createContext({ Math, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView, console });
    runInContext(dsrc + "\n;globalThis.__fr = { frictionBuffer, frictionCfg };", octx);
    const st = Object.assign({}, CS.DEFAULTS, strip(patch)), n = Math.round(0.3 * SR), sd = (0x51ce ^ Math.round(st.freq * 7) ^ Math.round(st.fricSeed || 0)) >>> 0;
    const a = octx.__fr.frictionBuffer(SR, n, octx.__fr.frictionCfg(st), sd), b = FR.frictionBuffer(SR, n, FR.frictionCfg(st), sd);
    let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    if (d !== 0) throw new Error("the instrumented model differs from dsp.js by " + d);
  }
  const st = Object.assign({}, CS.DEFAULTS, strip(patch)), cfg = FR.frictionCfg(st), n = Math.round(st.duration * SR);
  const f = FR.makeFriction(SR, cfg, (0x51ce ^ Math.round(st.freq * 7) ^ Math.round(st.fricSeed || 0)) >>> 0);
  for (let i = 0; i < n; i++) { const t = i / SR; f.tick(FR.frictionCurveAt(cfg.speed, t) * (t < FR.FRICTION_RAMP ? 0.5 - 0.5 * Math.cos(Math.PI * t / FR.FRICTION_RAMP) : 1), FR.frictionCurveAt(cfg.press, t)); }
  return f.catches;
}

// ---- render at the real level (Normalize on, as the app opens)
const strip = (p) => { const o = {}; for (const k in p) if (k[0] !== "_" && k !== "category") o[k] = p[k]; return o; };
function render(patch) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, strip(patch)), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}

// ---- measurement
function acPitch(y, a, b) {   // normalized autocorrelation, 40 Hz .. 2 kHz: [Hz, clarity]
  let e0 = 0; for (let i = a; i < b; i++) e0 += y[i] * y[i];
  if (!(e0 > 1e-9)) return [0, 0];
  let best = 0, bl = 0, prev = 1, rising = false;
  for (let l = 22; l < Math.min(1100, (b - a) >> 1); l++) {
    let s = 0; for (let i = a; i < b - l; i++) s += y[i] * y[i + l];
    s /= e0;
    if (s > prev) rising = true;
    if (rising && s > best) { best = s; bl = l; }
    prev = s;
  }
  return bl ? [SR / bl, best] : [0, 0];
}
function fft(re, im) {   // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai; re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function centroid(L, R) {   // spectral centroid (Hz), 2048-point Hann frames, energy-weighted over the whole sound
  const N = 2048;
  let num = 0, den = 0;
  for (let a = 0; a + N <= L.length; a += N >> 1) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (L[a + i] + R[a + i]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const e = re[k] * re[k] + im[k] * im[k]; num += e * k * SR / N; den += e; }
  }
  return den ? num / den : 0;
}
// share of the energy per band: <150, 150-400, 400-1k, 1-3k, >3k Hz (percent)
function bands(L, R) {
  const N = 2048, edges = [150, 400, 1000, 3000], e = [0, 0, 0, 0, 0];
  for (let a = 0; a + N <= L.length; a += N >> 1) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (L[a + i] + R[a + i]) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; let b = 0; while (b < 4 && f >= edges[b]) b++; e[b] += re[k] * re[k] + im[k] * im[k]; }
  }
  const t = e.reduce((x, y) => x + y, 0) || 1;
  return e.map((x) => Math.round(100 * x / t));
}
function level(L, R) {
  let pk = 0, dc = 0, clip = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > pk) pk = a; if (a >= 0.999) clip++; dc += L[i] + R[i]; }
  return { lufs: lufs(L, R), pk, dc: dc / (2 * L.length), clip, sec: L.length / SR, cen: centroid(L, R), bands: bands(L, R) };
}
// chatter, on a DRY render (reverb 0): what the stick-slip itself does
function chatter(patch) {
  const r = render(Object.assign({}, strip(patch), { reverb: 0 }));
  const n = r.L.length, m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = (r.L[i] + r.R[i]) / 2;
  const H = Math.round(0.002 * SR), env = [];
  for (let a = 0; a + H <= n; a += H) { let s = 0; for (let i = a; i < a + H; i++) s += m[i] * m[i]; env.push(Math.sqrt(s / H)); }
  const top = Math.max(...env), on = env.map((e) => e > top * 0.03);
  // modulation: std/mean of the 2 ms envelope over the sounding frames
  const se = env.filter((_, i) => on[i]), mean = se.reduce((a, b) => a + b, 0) / se.length;
  const cv = Math.sqrt(se.reduce((a, b) => a + (b - mean) * (b - mean), 0) / se.length) / mean;
  // ticks: a 2 ms frame that is the max of +-6 ms and stands 2x over the median of +-20 ms
  const ticks = [];
  for (let i = 3; i < env.length - 3; i++) {
    if (!on[i]) continue;
    let mx = true; for (let k = -3; k <= 3; k++) if (env[i + k] > env[i]) mx = false;
    if (!mx) continue;
    const nb = env.slice(Math.max(0, i - 10), i + 11).sort((a, b) => a - b), med = nb[nb.length >> 1];
    if (env[i] > 2 * med) ticks.push(i * H / SR);
  }
  const cat = catchesOf(patch);
  const W = Math.round(0.1 * SR), rows = [];
  for (let a = 0; a + W <= n; a += W) {
    let s = 0; for (let i = a; i < a + W; i++) s += m[i] * m[i];
    const rms = Math.sqrt(s / W);
    if (rms < top * 0.02) { rows.push({ t: a / SR, db: -99, ca: cat.filter((t) => t >= a / SR && t < (a + W) / SR).length * 10 }); continue; }
    const [hz, cl] = acPitch(m, a, a + W);
    const [er, ec] = envRate(m, a, a + W);
    rows.push({ t: a / SR, db: 20 * Math.log10(rms / top), hz, cl, er, ec, ca: cat.filter((t) => t >= a / SR && t < (a + W) / SR).length * 10, tk: ticks.filter((t) => t >= a / SR && t < (a + W) / SR).length * 10 });
  }
  return { cv, ticks: ticks.length, catches: cat.length, rows };
}
// the CATCH RATE: autocorrelation of the 4 ms RMS envelope (1 ms hop: the body's ring smoothed out) over a 200 ms window
// centered on [a, b), lags 7-90 ms (11-140 catches a second): [rate, clarity]. Ticks and a groan both show here as a rate; noise does not.
function envRate(m, a, b) {
  const h = 44, w = 176, c = (a + b) >> 1, a0 = Math.max(0, c - 4410), b0 = Math.min(m.length, c + 4410), e = [];
  for (let i = a0; i + w <= b0; i += h) { let s = 0; for (let k = i; k < i + w; k++) s += m[k] * m[k]; e.push(Math.sqrt(s / w)); }
  const mu = e.reduce((x, y) => x + y, 0) / e.length, d = e.map((x) => x - mu);
  let e0 = 0; for (const x of d) e0 += x * x;
  if (!(e0 > 0)) return [0, 0];
  let best = 0, bl = 0, prev = 1, rising = false;
  for (let l = 7; l <= Math.min(90, d.length >> 1); l++) {
    let s = 0; for (let i = 0; i < d.length - l; i++) s += d[i] * d[i + l];
    s /= e0;
    if (s > prev) rising = true;
    if (rising && s > best) { best = s; bl = l; }
    prev = s;
  }
  return bl ? [SR / (bl * h), best] : [0, 0];
}
const fmtRows = (rows) => rows.map((r) => r.db < -90 ? "." + (r.ca ? r.ca : "") : (r.ca + (r.cl >= 0.7 ? "|" + Math.round(r.hz) + "Hz" : "") + "(" + Math.round(r.db) + ")")).join(" ");

// ---- the shipped friction presets: the level the new ones sit against
const SHIPPED = [];
for (const name of Object.keys(PRESETS)) {
  const p = PRESETS[name];
  if (p.wave === 34) SHIPPED.push([name, p]);
  if (p._alts) p._alts.forEach((a, k) => { if (a.wave === 34) SHIPPED.push([name + " alt" + (k + 1), a]); });
}

// ---- the new sounds. The push is fricSpeed (+ up to three later points) and fricStop; the pressure the same way.
// The amp envelope is a plain gain held through the push and the body's ring (wood rings ~0.1 s), as the shipped ones.
// Each fricSeed was picked by `seedscan` to sit at the MIDDLE of its own _vary range (fricSeed: 1 plays a seed anywhere
// in 0..2x the base), so a re-click lands within about +-2 dB either side of the preset rather than all to one side.
const env = (holdTo, dur) => ({ attack: 0.001, hold: +(holdTo - 0.001).toFixed(3), decay: 0.03, sustain: 0, release: 0.01, filterMode: 0, cutoff: 12000, reso: 0, drive: 0, duration: dur });
const SOUNDS = {
  // A wooden chair dragged back across a hard floor: the leg catches and judders. A small, stiff wooden frame (a high
  // body), a dry and very uneven contact (high grip, high roughness), dragged fast enough that the catches come 60-200 a
  // second: a stuttering "brrrap" rather than separate ticks or a steady groan. The hand shoves, the leg half-lifts (the
  // pressure drops) and bites again.
  "Chair Scrape": { slug: "chair-scrape", category: "Doors / Containers",
    patch: Object.assign({ wave: 34, fricBody: 0, freq: 360, fricTone: 0.48, fricGrip: 0.8, fricRough: 0.85, fricLock: 0.35,
      fricSpeed: 0.55, fricT1: 0.12, fricSpeed1: 0.78, fricT2: 0.36, fricSpeed2: 0.58, fricT3: 0.58, fricSpeed3: 0.76, fricStop: 0.75,
      fricPress: 0.65, fricPressT1: 0.3, fricPress1: 0.8, fricPressT2: 0.5, fricPress2: 0.45, fricPressT3: 0.7, fricPress3: 0.7, fricSeed: 19 },
      env(0.83, 1.0), { reverb: 0.15, reverbSize: 0.45, reverbTone: 0.5, width: 0.35, gain: 0.6 }),
    vary: { fricSeed: 1 } },
  // The horror floorboard: a board taking a footstep's weight slowly. The pressure comes on as the weight shifts onto
  // it; the board gives, separate ticks running together into a low groan (up to ~180 catches a second) and slowing as it
  // settles under the full weight.
  "Floorboard Creak": { slug: "floorboard-creak", category: "Horror",
    patch: Object.assign({ wave: 34, fricBody: 0, freq: 170, fricTone: 0.42, fricGrip: 0.65, fricRough: 0.45, fricLock: 0.3,
      fricSpeed: 0.3, fricT1: 0.45, fricSpeed1: 0.82, fricT2: 0.85, fricSpeed2: 0.62, fricStop: 1.05,
      fricPress: 0.35, fricPressT1: 0.4, fricPress1: 0.65, fricPressT2: 1.0, fricPress2: 0.8, fricSeed: 14 },
      env(1.12, 1.3), { reverb: 0.25, reverbSize: 0.55, reverbTone: 0.4, width: 0.4, gain: 0.6 }),
    // a quick step: the board catches once, a short "crrk" as the weight lands and passes
    alts: [Object.assign({ wave: 34, fricBody: 0, freq: 185, fricTone: 0.42, fricGrip: 0.65, fricRough: 0.4, fricLock: 0.3,
      fricSpeed: 0.35, fricT1: 0.15, fricSpeed1: 0.75, fricT2: 0.3, fricSpeed2: 0.55, fricStop: 0.42,
      fricPress: 0.45, fricPressT1: 0.15, fricPress1: 0.7, fricSeed: 20 },
      env(0.48, 0.65), { reverb: 0.25, reverbSize: 0.55, reverbTone: 0.4, width: 0.4, gain: 0.6 })],
    vary: { fricSeed: 1 } },
  // A ship's hull working in a swell: big timbers (a low body, a soft contact) rubbing as the ship rolls. Two groans,
  // the pressure rocking with each roll: the push rises from rest into a low grinding groan and dies away, then the ship
  // rolls back and the second one comes heavier. A ship's hold: a big, dark room.
  "Ship's Hull Creak": { slug: "ships-hull-creak", category: "Nature",
    patch: Object.assign({ wave: 34, fricBody: 0, freq: 115, fricTone: 0.28, fricGrip: 0.7, fricRough: 0.6, fricLock: 0.25,
      fricSpeed: 0.05, fricT1: 0.42, fricSpeed1: 0.84, fricT2: 0.92, fricSpeed2: 0.06, fricT3: 1.38, fricSpeed3: 0.88, fricStop: 1.82,
      fricPress: 0.5, fricPressT1: 0.42, fricPress1: 0.8, fricPressT2: 0.92, fricPress2: 0.5, fricPressT3: 1.38, fricPress3: 0.9, fricSeed: 26 },
      env(1.9, 2.0), { reverb: 0.4, reverbSize: 0.75, reverbTone: 0.3, width: 0.5, gain: 0.6 }),
    vary: { fricSeed: 1 } },
  // Rope straining on a wooden spar or post (rigging, a rope bridge): dry fibers gripping hard on a smaller, stiffer piece
  // of wood, so the catches run together into a high, tight "eeerk" (300-400 a second). Two strains as the load comes on
  // and eases, the second tighter.
  "Rope Creak": { slug: "rope-creak", category: "Nature",
    patch: Object.assign({ wave: 34, fricBody: 0, freq: 420, fricTone: 0.7, fricGrip: 0.85, fricRough: 0.35, fricLock: 0.4,
      fricSpeed: 0.45, fricT1: 0.25, fricSpeed1: 0.85, fricT2: 0.5, fricSpeed2: 0.3, fricT3: 0.78, fricSpeed3: 0.88, fricStop: 1.02,
      fricPress: 0.4, fricPressT1: 0.25, fricPress1: 0.7, fricPressT2: 0.5, fricPress2: 0.45, fricPressT3: 0.78, fricPress3: 0.75, fricSeed: 21 },
      env(1.08, 1.25), { reverb: 0.15, reverbSize: 0.5, reverbTone: 0.5, width: 0.35, gain: 0.6 }),
    vary: { fricSeed: 1 } },
};

// set each patch's gain so it lands on the shipped friction presets' loudness (all of them sit at the same value)
function calibrate(patch, target) {
  for (let k = 0; k < 2; k++) { const r = render(patch); patch.gain = Math.min(1, +(patch.gain * Math.pow(10, (target - lufs(r.L, r.R)) / 20)).toFixed(3)); }
}

function slugWav(slug, k) { return join(ROOT, "soundtests", "new-presets", slug + (k ? "-alt" + k : "") + ".wav"); }
function report(label, patch, write) {
  const r = render(patch), lv = level(r.L, r.R), ch = chatter(patch);
  if (write) writeFileSync(write, Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: label })));
  console.log("  " + label.padEnd(24) + lv.sec.toFixed(2) + " s  " + lv.lufs.toFixed(1) + " LUFS  peak " + lv.pk.toFixed(3) + "  DC " + lv.dc.toExponential(1) +
    "  clip " + lv.clip + "  centroid " + Math.round(lv.cen) + " Hz  bands% " + lv.bands.join("/") + "  envCV " + ch.cv.toFixed(2) + "  catches " + ch.catches);
  console.log("      per 100 ms: catches/s | pitch where AC clarity>=0.7 (dB re loudest window): " + fmtRows(ch.rows));
  return { lv, ch };
}

if (process.argv[2] === "try") {   // node tools/proto/new-friction.mjs try <file.json>: { label: patch, ... } at -16 LUFS
  const T = JSON.parse(readFileSync(process.argv[3], "utf8"));
  for (const [k, p] of Object.entries(T)) { if (!p.gain) p.gain = 0.6; calibrate(p, -16); report(k, p); }
  process.exit(0);
}
if (process.argv[2] === "seedscan") {   // which base seed sits at the middle of its own _vary range (fricSeed: 1 -> 0..2b)
  for (const [name, s] of Object.entries(SOUNDS)) {
    [s.patch].concat(s.alts || []).forEach((p0, k) => {
      const p = Object.assign({}, p0); calibrate(p, -16);
      const L = [];
      for (let sd = 0; sd <= 80; sd++) { const r = render(Object.assign({}, p, { fricSeed: sd })); L.push(lufs(r.L, r.R)); }
      const sorted = L.slice().sort((a, b) => a - b);
      const cand = [];
      for (let b = 8; b <= 40; b++) { const rng = L.slice(0, 2 * b + 1).sort((x, y) => x - y), med = rng[rng.length >> 1]; cand.push([b, L[b] - med, rng[0], rng[rng.length - 1]]); }
      cand.sort((x, y) => Math.abs(x[1]) - Math.abs(y[1]));
      console.log(name + (k ? " alt" + k : "") + ": seeds 0-80 LUFS " + sorted[0].toFixed(1) + " .. " + sorted[sorted.length - 1].toFixed(1) + ", median " + sorted[40].toFixed(1) +
        " (at seed " + p0.fricSeed + "'s gain); centered bases: " + cand.slice(0, 6).map((c) => c[0] + " (" + c[1].toFixed(2) + ", range " + c[2].toFixed(1) + ".." + c[3].toFixed(1) + ")").join(", "));
    });
  }
  process.exit(0);
}
console.log("shipped friction presets (real level):");
const shipped = SHIPPED.map(([n, p]) => report(n, p).lv.lufs).sort((a, b) => a - b);
const median = shipped.length & 1 ? shipped[shipped.length >> 1] : (shipped[shipped.length / 2 - 1] + shipped[shipped.length / 2]) / 2;
console.log("  median " + median.toFixed(2) + " LUFS (range " + shipped[0].toFixed(1) + " .. " + shipped[shipped.length - 1].toFixed(1) + ")\n");

const want = process.argv[2], out = {};
console.log("new:");
for (const [name, s] of Object.entries(SOUNDS)) {
  calibrate(s.patch, median); (s.alts || []).forEach((a) => calibrate(a, median));
  report(name, s.patch, slugWav(s.slug, 0));
  (s.alts || []).forEach((a, k) => report(name + " alt" + (k + 1), a, slugWav(s.slug, k + 1)));
  if (want === "seeds") {
    const base = s.patch.fricSeed, amt = s.vary.fricSeed, lo = Math.round(base * (1 - amt)), hi = Math.round(base * (1 + amt));
    const all = [s.patch].concat(s.alts || []);
    all.forEach((p, k) => {
      const b = p.fricSeed, a0 = Math.round(b * (1 - amt)), a1 = Math.round(b * (1 + amt)), res = [];
      for (let i = 0; i < 9; i++) {
        const sd = Math.round(a0 + (a1 - a0) * i / 8), q = Object.assign({}, p, { fricSeed: sd }), r = render(q), lv = level(r.L, r.R), ch = chatter(q);
        const cls = ch.rows.filter((x) => x.db > -90), locked = cls.filter((x) => x.cl >= 0.7).length / Math.max(1, cls.length);
        res.push("s" + sd + ":" + lv.lufs.toFixed(1) + "/" + ch.cv.toFixed(2) + "/" + Math.round(locked * 100) + "%");
      }
      console.log("    seeds " + (k ? "alt" + k : "base") + " (seed: LUFS/envCV/% pitched): " + res.join(" "));
    });
  }
  const entry = Object.assign({}, s.patch, { _vary: s.vary });
  if (s.alts) entry._alts = s.alts;
  entry.category = s.category;
  out[name] = entry;
}
writeFileSync(join(ROOT, "tools", "new-presets", "friction.json"), JSON.stringify(out, null, 2) + "\n");
