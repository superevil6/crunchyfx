/* new-wings-coil.mjs — NEW PRESETS on two modes no preset used: the chirp engine's "Buzz (wings)" (wave 27, chirpMode 2)
 * plus a cricket pushed to a cicada drone, and the spring engine's "Coil" (wave 32, springType 0).
 *
 *   node tools/proto/new-wings-coil.mjs            renders every sound, measures it, writes the WAVs and the JSON
 *   node tools/proto/new-wings-coil.mjs ref        measures only the existing presets on the two engines (the level bar)
 *   node tools/proto/new-wings-coil.mjs <slug>     one sound (and its alts), measured, written
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, exactly as tools/make-ab.mjs does,
 * with Normalize ON (the app's default) and NOT loudness-matched: the WAV is what the app's button plays.
 * Writes soundtests/new-presets/<slug>.wav (+ <slug>-alt<N>.wav) and tools/new-presets/wings-coil.json.
 *
 * Self-checks per sound: peak (and whether it clips), DC per channel, duration and the audible span (to -60 dB), BS.1770
 * integrated loudness against the MEDIAN of the existing presets on the same engine (every base and alt whose wave is that
 * engine), and for pitched sounds a YIN pitch track (start / middle / end, median).
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

// ---- YIN (de Cheveigne & Kawahara 2002): difference function, cumulative-mean normalization, absolute threshold,
// parabolic interpolation. One estimate per hop over the mono mix; frames under -40 dB of the peak are unvoiced.
function yinTrack(x, fmin, fmax, hop = 0.02, win = 0.04, thr = 0.15) {
  const W = Math.round(win * SR), tauMax = Math.min(W - 2, Math.ceil(SR / fmin)), tauMin = Math.floor(SR / fmax), H = Math.round(hop * SR);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const out = [], d = new Float64Array(tauMax + 1);
  for (let a = 0; a + W + tauMax < x.length; a += H) {
    let e = 0; for (let i = 0; i < W; i++) e += x[a + i] * x[a + i];
    const rms = Math.sqrt(e / W);
    if (rms < pk * 0.01) { out.push({ t: a / SR, f: 0, ap: 1 }); continue; }
    d[0] = 0;
    for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[a + i] - x[a + i + tau]; s += q * q; } d[tau] = s; }
    let run = 0, best = -1;
    const cm = new Float64Array(tauMax + 1); cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = d[tau] * tau / (run || 1e-12); }
    for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) {
      if (cm[tau] < thr) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    }
    if (best < 0) { let m = 1e9; for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; } }
    const a0 = cm[best - 1], b0 = cm[best], c0 = cm[best + 1] ?? b0, den = a0 - 2 * b0 + c0;
    const t = den !== 0 ? best + 0.5 * (a0 - c0) / den : best;
    out.push({ t: a / SR, f: SR / t, ap: b0 });
  }
  return out;
}
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };

function render(patch) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, patch), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
// spectral centroid of a span (Hann, one FFT-free DFT on a decimated grid: 64 bins up to 11 kHz is plenty for a trend)
function centroid(x, a, b) {
  const N = Math.min(2048, b - a); if (N < 256) return 0;
  let num = 0, den = 0;
  for (let k = 1; k < 128; k++) {
    const f = k * 11025 / 128, w = 2 * Math.PI * f / SR; let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)), v = x[a + i] * h; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
    const m = re * re + im * im; num += f * m; den += m;
  }
  return den > 0 ? num / den : 0;
}
function measure(r, o = {}) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.999 || b >= 0.999) clip++; }
  const mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  // the audible span: the last 10 ms block above -60 dB of the peak
  const B = Math.round(0.01 * SR); let last = 0, first = -1;
  for (let a = 0; a < n; a += B) { let m = 0; for (let i = a; i < Math.min(n, a + B); i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); if (m > pk * 0.001) { last = a + B; if (first < 0) first = a; } }
  // 50 ms level envelope (dBFS RMS): where the level peaks, how it swells and fades
  const E = Math.round(0.05 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += L[i] * L[i] + R[i] * R[i]; env.push(10 * Math.log10(s / (2 * E) + 1e-12)); }
  const out = { sec: n / SR, audible: Math.min(n, last) / SR, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R), env };
  if (o.pitch) {
    const tr = yinTrack(mono, o.pitch[0], o.pitch[1]), v = tr.filter((p) => p.f > 0 && p.ap < 0.2);
    out.f0 = { median: median(v.map((p) => p.f)), voiced: v.length / Math.max(1, tr.filter((p) => p.f > 0).length), n: v.length,
      start: median(v.slice(0, Math.max(1, Math.floor(v.length / 6))).map((p) => p.f)), mid: median(v.slice(Math.floor(v.length * 0.42), Math.ceil(v.length * 0.58)).map((p) => p.f)),
      end: median(v.slice(Math.floor(v.length * 5 / 6)).map((p) => p.f)), track: v };
  }
  // where it sits left to right (L minus R, dB, over five equal spans): a pass crosses from one side to the other
  { const P = 5, row = []; for (let k = 0; k < P; k++) { let a = 0, b = 0; for (let i = Math.floor(k * n / P); i < Math.floor((k + 1) * n / P); i++) { a += L[i] * L[i]; b += R[i] * R[i]; } row.push(10 * Math.log10((a + 1e-12) / (b + 1e-12))); } out.pan = row; }
  if (o.centroid) {
    const step = Math.round(o.centroid * SR), cs = [];
    for (let a = 0; a + 2048 < n && cs.length < 40; a += step) cs.push([a / SR, centroid(mono, a, a + 2048)]);
    out.cent = cs;
  }
  return out;
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  let s = m.sec.toFixed(2) + " s (audible " + m.onset.toFixed(2) + "-" + m.audible.toFixed(2) + ")  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + " dBFS)" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + m.dcL.toExponential(1) + "/" + m.dcR.toExponential(1);
  if (m.f0) s += "\n      YIN f0 median " + m.f0.median.toFixed(1) + " Hz (start " + m.f0.start.toFixed(1) + ", mid " + m.f0.mid.toFixed(1) + ", end " + m.f0.end.toFixed(1) + "; " + m.f0.n + " voiced frames)";
  const e = m.env, mx = Math.max(...e), im = e.indexOf(mx);
  s += "\n      level (50 ms RMS, dB rel. max): " + e.filter((_, i) => i % Math.max(1, Math.round(e.length / 16)) === 0).map((v) => (v - mx).toFixed(0)).join(" ") + "  (max at " + (im * 0.05).toFixed(2) + " s)";
  if (m.pan && m.pan.some((v) => Math.abs(v) > 0.5)) s += "\n      L-R balance (dB, fifths): " + m.pan.map((v) => v.toFixed(1)).join(" ");
  if (m.cent) s += "\n      centroid: " + m.cent.map(([t, c]) => t.toFixed(2) + ":" + (c / 1000).toFixed(1) + "k").join(" ");
  return s;
}

// ---- the reference: every patch (base or alt) on the engine, as the app plays it
function refPatches(wave) {
  const out = [];
  for (const [name, p] of Object.entries(PRESETS)) {
    const base = Object.assign({}, p); delete base._vary; delete base._alts;
    if (Math.round(base.wave) === wave) out.push([name, base]);
    (p._alts || []).forEach((a, k) => { if (Math.round(a.wave) === wave) out.push([name + " alt" + (k + 1), a]); });
  }
  return out;
}
function reference(wave, quiet) {
  const rows = refPatches(wave).map(([n, p]) => { const m = measure(render(p)); return { n, lufs: m.lufs, peak: m.peak }; });
  const med = median(rows.map((r) => r.lufs));
  if (!quiet) { for (const r of rows) console.log("   " + r.n.padEnd(24) + r.lufs.toFixed(1).padStart(7) + " LUFS  peak " + r.peak.toFixed(3)); console.log("   MEDIAN " + med.toFixed(1) + " LUFS (" + rows.length + " patches)"); }
  return { med, rows };
}

// ============================================================================================================
// THE SOUNDS. Every patch is a whole app patch (the shared post-chain fields as the existing chirp / spring presets
// write them: a flat amp envelope, a 40 Hz high-pass as the filter, drive 0). `_vary` jitters only what keeps identity.
const CHIRP_BASE = { wave: 27, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.005, filterMode: 1, cutoff: 40, reso: 0, drive: 0 };
const SPRING_BASE = { wave: 32, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.015, filterMode: 1, cutoff: 40, reso: 0, drive: 0, gain: 1 };
const chirp = (o) => Object.assign({}, CHIRP_BASE, o);
const spring = (o) => Object.assign({}, SPRING_BASE, o);

const HUM_CHIPS = chirp({ chirpMode: 0, chirpPitch: 5000, chirpGesture: 6, chirpSpan: 0.7, chirpRate: 11, chirpDuty: 0.3, chirpCount: 3, chirpGroups: 2, chirpGroupGap: 0.3, chirpRand: 0.3, chirpHarm: 0.1, chirpSeed: 45, duration: 1.1 });
const SOUNDS = [
  // ---- BUZZ (wings). chirpBuzz draws its flight direction from the seed; only a seed whose pass runs left to right
  // (dir +1) gets the Doppler the right way round (high while it comes, low as it goes), so each seed below is one of
  // those at the patch's own duration (see the report: the other direction rises through the pass).
  { slug: "mosquito", name: "Mosquito", category: "Animal / Monster", engine: 27, pitch: [300, 1400],
    patch: chirp({ chirpMode: 2, chirpPitch: 600, chirpSpan: 0.18, chirpHarm: 0.75, chirpRand: 0.35, chirpSeed: 44, gain: 1, duration: 2.2 }),
    vary: { chirpSeed: 1, chirpPitch: 0.06, chirpSpan: 0.15 } },
  { slug: "housefly", name: "Housefly", category: "Animal / Monster", engine: 27, pitch: [90, 600],
    patch: chirp({ chirpMode: 2, chirpPitch: 190, chirpSpan: 0.12, chirpHarm: 0.7, chirpRand: 1, chirpSeed: 12, drive: 0.03, driveOS: 4, gain: 0.9, duration: 2.6 }),
    vary: { chirpSeed: 1, chirpSpan: 0.15 } },
  { slug: "hummingbird", name: "Hummingbird", category: "Animal / Monster", engine: 27, pitch: [30, 400],
    patch: chirp({ chirpMode: 2, chirpPitch: 62, chirpSpan: 0.08, chirpHarm: 0.4, chirpRand: 0.5, chirpSeed: 4, drive: 0.05, driveOS: 4, gain: 1, duration: 1.8,
      layers: JSON.stringify([{ s: HUM_CHIPS, d: 0.45, g: 0.5, p: 0 }]) }),
    vary: { chirpSeed: 1 } },
  { slug: "cicada-drone", name: "Cicada Drone", category: "Animal / Monster", engine: 27, pitch: null,
    patch: chirp({ chirpMode: 1, chirpPitch: 4800, chirpSpan: 0.03, chirpRasp: 0.55, chirpRate: 60, chirpDuty: 0.85, chirpCount: 30, chirpGroups: 0, chirpGroupGap: 0.12, chirpRand: 0.2, chirpHarm: 0.2, chirpChorus: 6, chirpSeed: 71, attack: 0.2, release: 0.5, gain: 0.95, duration: 3 }),
    vary: { chirpSeed: 1, chirpPitch: 0.04 } },
  // ---- SPRING coil
  { slug: "spring-tank-crash", name: "Spring Tank Crash", category: "Cartoon / Misc", engine: 32, pitch: null, centroid: 0.05,
    patch: spring({ springType: 0, freq: 800, springLength: 37, springDisp: 1, springDamp: 0.1, springPluck: 0.9, springSway: 0.4, springSwayRate: 5, springSeed: 81, release: 0.4, gain: 0.55, duration: 2 }),
    vary: { springSeed: 1, freq: 0.06, springLength: 0.12 } },
  { slug: "slinky", name: "Slinky", category: "Sci-Fi & Hazard", engine: 32, pitch: null, centroid: 0.02,
    patch: spring({ springType: 0, freq: 1000, springLength: 170, springDisp: 1, springDamp: 0.2, springPluck: 0.45, springSway: 0.15, springSwayRate: 2, springSeed: 91, release: 0.2, gain: 0.75, duration: 1.5 }),
    vary: { springSeed: 1, freq: 0.08, springLength: 0.12 } },
];

// ============================================================================================================
const only = process.argv[2];
if (only === "try") {   // node tools/proto/new-wings-coil.mjs try '<patch json>' [fmin fmax]: measure one patch, nothing written
  const p = JSON.parse(process.argv[3]), lo = parseFloat(process.argv[4]), hi = parseFloat(process.argv[5]);
  const r = render(p);
  console.log(fmt(measure(r, { pitch: lo > 0 ? [lo, hi] : null, centroid: Math.round(p.wave) === 32 ? 0.1 : 0 })));
  if (process.argv[6] === "k") {   // the K-weighted 30 ms loudness, every 30 ms (what stands out to the ear, not the meter's RMS)
    const kl = kweight(r.L), kr = kweight(r.R), B = Math.round(0.03 * SR), row = [];
    for (let a = 0; a + B <= kl.length; a += B) { let q = 0; for (let i = a; i < a + B; i++) q += kl[i] * kl[i] + kr[i] * kr[i]; row.push((-0.691 + 10 * Math.log10(q / B + 1e-12)).toFixed(0)); }
    console.log("      K-weighted 30 ms: " + row.join(" "));
  }
  process.exit(0);
}
if (only === "ref") {
  console.log("CHIRP (wave 27)"); reference(27);
  console.log("SPRING (wave 32)"); reference(32);
  process.exit(0);
}
const REF = { 27: reference(27, true).med, 32: reference(32, true).med };
console.log("reference medians: chirp " + REF[27].toFixed(1) + " LUFS, spring " + REF[32].toFixed(1) + " LUFS");
const wavDir = join(ROOT, "soundtests", "new-presets"), jsonDir = join(ROOT, "tools", "new-presets");
mkdirSync(wavDir, { recursive: true }); mkdirSync(jsonDir, { recursive: true });
const json = {};
for (const s of SOUNDS) {
  if (only && only !== "json" && s.slug !== only) continue;
  const versions = [s.patch].concat(s.alts || []);
  versions.forEach((p, k) => {
    const r = render(p), m = measure(r, { pitch: s.pitch, centroid: s.centroid });
    const file = s.slug + (k ? "-alt" + k : "") + ".wav";
    writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: s.name + (k ? " alt " + k : "") })));
    console.log(file.padEnd(28) + fmt(m) + "\n      vs engine median " + (m.lufs - REF[s.engine] >= 0 ? "+" : "") + (m.lufs - REF[s.engine]).toFixed(1) + " dB");
  });
  const entry = Object.assign({}, s.patch, { _vary: s.vary });
  if (s.alts && s.alts.length) entry._alts = s.alts;
  entry.category = s.category;
  json[s.name] = entry;
}
if (!only || only === "json") writeFileSync(join(jsonDir, "wings-coil.json"), JSON.stringify(json, null, 2) + "\n");
