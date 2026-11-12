/* creature-redo-animals.mjs — the eight Animal / Monster presets that were still on the FORMANT engine (wave 13), rebuilt
 * on the creature voice engine (wave 28). AJ, 2026-11-12: "Rooster Crow sounds horrible on the formant engine"; every
 * Animal / Monster preset using formant is redone. Formant stays for voices and choirs elsewhere.
 *
 *   node tools/proto/creature-redo-animals.mjs            renders every sound (now + new), measures, writes WAVs + JSON
 *   node tools/proto/creature-redo-animals.mjs ref        measures only the existing creature presets (the level bar)
 *   node tools/proto/creature-redo-animals.mjs <slug>     one sound (and its alts), measured, written
 *   node tools/proto/creature-redo-animals.mjs sep        the separation table only (no files written)
 *   node tools/proto/creature-redo-animals.mjs try '<patch json>' [fmin fmax]   measure one patch, nothing written
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, exactly as tools/make-ab.mjs does,
 * with Normalize ON (the app's default) and NOT loudness-matched: the WAV is what the app's button plays. A layered
 * patch goes through CrunchySynth.render, which is renderSound (its `layers` string mixed on the bus).
 * Writes soundtests/creature-redo/animals/<slug>-1-now.wav (the CURRENT preset, formant) and <slug>-2-new.wav (+
 * <slug>-2-new-alt<N>.wav), and tools/new-presets/creature-redo-animals.json (full patches incl. _vary / _alts, keyed by
 * the preset's exact name; no `category`, they replace in place).
 *
 * Self-checks per sound: peak (and whether it clips), DC per channel, duration and the audible span (to -60 dB), BS.1770
 * integrated loudness against the MEDIAN of the existing creature presets (Cat Meow, Cow Moo, Dog Bark, Wolf Howl,
 * Monster Growl, alts included), a YIN pitch track (start / middle / end, median) with its aperiodicity (0 = a pure
 * periodic tone, toward 1 = noise / chaos) and whether the tracker locks an OCTAVE BELOW the written pitch (roughness's
 * period doubling), and the energy-weighted spectral centroid. `sep` places every new sound and the five references on
 * (log2 f0, log2 audible duration, log2 centroid, 3 x aperiodicity, log2 syllable count) and lists the closest pairs.
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

// ---- YIN (de Cheveigne & Kawahara 2002), as in tools/proto/new-wings-coil.mjs; frames under -40 dB of the peak are
// unvoiced. Each frame keeps its aperiodicity (the CMNDF dip at the chosen lag).
function yinTrack(x, fmin, fmax, hop = 0.01, win = 0.03, thr = 0.15) {
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
    out.push({ t: a / SR, f: SR / t, ap: b0, rms });
  }
  return out;
}
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };

// ---- radix-2 FFT (in place) for the centroid
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// energy-weighted spectral centroid over the whole sound (Hann frames of 2048, hop 1024): the bright frames count more
function centroidAll(x) {
  const N = 2048, H = 1024, w = new Float64Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  let num = 0, den = 0;
  for (let a = 0; a + N <= x.length; a += H) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[a + i] * w[i];
    fft(re, im);
    for (let k = 1; k < N / 2; k++) { const m = re[k] * re[k] + im[k] * im[k], f = k * SR / N; num += f * m; den += m; }
  }
  return den > 0 ? num / den : 0;
}

function render(patch) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, patch), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
function measure(r, o = {}) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.999 || b >= 0.999) clip++; }
  const mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  const B = Math.round(0.01 * SR); let last = 0, first = -1;
  for (let a = 0; a < n; a += B) { let m = 0; for (let i = a; i < Math.min(n, a + B); i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); if (m > pk * 0.001) { last = a + B; if (first < 0) first = a; } }
  const E = Math.round(0.05 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += L[i] * L[i] + R[i] * R[i]; env.push(10 * Math.log10(s / (2 * E) + 1e-12)); }
  // syllables: runs of 10 ms blocks within 25 dB of the loudest block, a gap of >= 30 ms below it splitting them
  let syl = 0; { const blk = []; for (let a = 0; a + B <= n; a += B) { let q = 0; for (let i = a; i < a + B; i++) q += L[i] * L[i] + R[i] * R[i]; blk.push(q); }
    const mx = Math.max(...blk), thr = mx * Math.pow(10, -25 / 10); let on = false, quiet = 3;
    for (const q of blk) { if (q > thr) { if (!on && quiet >= 3) syl++; on = true; quiet = 0; } else { quiet++; if (quiet >= 3) on = false; } } }
  const out = { syl, sec: n / SR, audible: Math.min(n, last) / SR, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R), env, cent: centroidAll(mono) };
  if (o.pitch) {
    const tr = yinTrack(mono, o.pitch[0], o.pitch[1]);
    const loud = tr.filter((p) => p.f > 0), rmsMax = Math.max(1e-9, ...loud.map((p) => p.rms));
    const strong = loud.filter((p) => p.rms > rmsMax * 0.1);          // within 20 dB of the loudest frame
    const v = strong.filter((p) => p.ap < 0.25);
    out.ap = median(strong.map((p) => p.ap));
    out.f0 = { median: median(v.map((p) => p.f)), voiced: v.length / Math.max(1, strong.length), n: v.length,
      start: median(v.slice(0, Math.max(1, Math.floor(v.length / 6))).map((p) => p.f)), mid: median(v.slice(Math.floor(v.length * 0.42), Math.ceil(v.length * 0.58)).map((p) => p.f)),
      end: median(v.slice(Math.floor(v.length * 5 / 6)).map((p) => p.f)), lo: Math.min(...v.map((p) => p.f)), hi: Math.max(...v.map((p) => p.f)) };
  }
  return out;
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m, written) {
  let s = m.sec.toFixed(2) + " s (audible " + m.onset.toFixed(2) + "-" + m.audible.toFixed(2) + ")  " + m.lufs.toFixed(1) + " LUFS  " + m.syl + " syllable(s)  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + " dBFS)" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + m.dcL.toExponential(1) + "/" + m.dcR.toExponential(1) + "  centroid " + (m.cent / 1000).toFixed(2) + " kHz";
  if (m.f0) {
    s += "\n      YIN f0 median " + m.f0.median.toFixed(0) + " Hz (start " + m.f0.start.toFixed(0) + ", mid " + m.f0.mid.toFixed(0) + ", end " + m.f0.end.toFixed(0) +
      ", range " + m.f0.lo.toFixed(0) + "-" + m.f0.hi.toFixed(0) + "; voiced " + (100 * m.f0.voiced).toFixed(0) + "% of loud frames)  aperiodicity " + m.ap.toFixed(2);
    if (written && m.f0.median < written * 0.62) s += "  ** reads ~" + (12 * Math.log2(written / m.f0.median)).toFixed(0) + " st BELOW the written " + written + " Hz (subharmonic)";
  }
  const e = m.env, mx = Math.max(...e), im = e.indexOf(mx);
  s += "\n      level (50 ms RMS, dB rel. max): " + e.filter((_, i) => i % Math.max(1, Math.round(e.length / 20)) === 0).map((v) => (v - mx).toFixed(0)).join(" ") + "  (max at " + (im * 0.05).toFixed(2) + " s)";
  return s;
}

// ---- the reference: every creature preset (base and alts), as the app plays it
const REF_NAMES = ["Cat Meow", "Cow Moo", "Dog Bark", "Wolf Howl", "Monster Growl"];
function refPatches() {
  const out = [];
  for (const name of REF_NAMES) {
    const p = PRESETS[name], base = Object.assign({}, p); delete base._vary; delete base._alts;
    out.push([name, base]);
    (p._alts || []).forEach((a, k) => out.push([name + " alt" + (k + 1), a]));
  }
  return out;
}
function reference(quiet) {
  const rows = refPatches().map(([n, p]) => { const m = measure(render(p)); return { n, lufs: m.lufs, peak: m.peak }; });
  const med = median(rows.map((r) => r.lufs));
  if (!quiet) { for (const r of rows) console.log("   " + r.n.padEnd(24) + r.lufs.toFixed(1).padStart(7) + " LUFS  peak " + r.peak.toFixed(3)); console.log("   MEDIAN " + med.toFixed(1) + " LUFS (" + rows.length + " patches)"); }
  return { med, rows };
}

// ============================================================================================================
// THE SOUNDS. The chassis is the existing creature presets' (a flat amp envelope or a bark's hold + decay, the filter
// open at 18 kHz with no resonance, drive 0): the engine is the voice, the post chain stays out of its way.
const CR = { wave: 28, hold: 0, decay: 0, sustain: 1, drive: 0, cutoff: 18000, reso: 0 };
const cr = (o) => Object.assign({}, CR, o);
const layers = (list) => JSON.stringify(list);

// ---- HEN. A hen's cluck is a short (60-120 ms), low, throaty "buk": f0 ~ 300-450 Hz, a closed beak opening and
// closing again (b..k), a dark back vowel, some breath and a little roughness. Uttered in short irregular runs.
const HEN = { crSize: 0.6, crPitchStart: 2, crPitchEnd: -4, crPeak: 0.25, crOpenStart: 0.1, crOpenPeak: 0.7, crOpenEnd: 0.12,
  crVowelStart: 0.7, crVowelEnd: 0.85, crNasal: 0.25, crTension: 0.75, crJitter: 0.35, crShimmer: 0.3, crRough: 0.15, crBreath: 0.3 };
const CLUCK = cr(Object.assign({}, HEN, { freq: 400, attack: 0.005, hold: 0.055, decay: 0.045, sustain: 0, release: 0.03,
  repeat: 2, rate: 5.5, gain: 1, duration: 0.5 }));
// the same bird, farther off: one cluck, the top gone (air absorbs it), a large room, and quieter by design
const DISTANT = cr(Object.assign({}, HEN, { freq: 390, attack: 0.006, hold: 0.06, decay: 0.05, sustain: 0, release: 0.04,
  cutoff: 2200, reso: 0, width: 0.6, reverb: 0.45, reverbSize: 0.85, reverbTone: 0.35, gain: 0.95, duration: 0.8 }));

// ---- ROOSTER. "cock-a-doodle-doo": two short syllables, a medium one climbing, and a long last one that rises, holds
// high and falls; ~1.6-2 s, f0 ~ 450-600 Hz, pressed and harsh (lots of breath and jitter), one call per layer.
function crow({ f, size, rough, jitter, shimmer, tension, breath, t, lift, gain }) {
  const V = { crSize: size, crRough: rough, crJitter: jitter, crShimmer: shimmer, crTension: tension, crBreath: breath, crNasal: 0.15 };
  const s1 = cr(Object.assign({}, V, { freq: f, crPitchStart: -5, crPitchEnd: -3, crPeak: 0.45, crOpenStart: 0.2, crOpenPeak: 0.75, crOpenEnd: 0.35,
    crVowelStart: 0.55, crVowelEnd: 0.6, attack: 0.008, release: 0.03, gain, duration: +(0.11 * t).toFixed(3) }));
  const s2 = cr(Object.assign({}, V, { freq: f, crPitchStart: -3, crPitchEnd: -2, crPeak: 0.5, crOpenStart: 0.3, crOpenPeak: 0.75, crOpenEnd: 0.4,
    crVowelStart: 0.5, crVowelEnd: 0.6, attack: 0.008, release: 0.03, duration: +(0.1 * t).toFixed(3) }));
  const s3 = cr(Object.assign({}, V, { freq: f, crPitchStart: -2, crPitchEnd: lift * 0.5, crPeak: 0.45, crOpenStart: 0.3, crOpenPeak: 0.85, crOpenEnd: 0.6,
    crVowelStart: 0.45, crVowelEnd: 0.55, attack: 0.01, release: 0.035, duration: +(0.25 * t).toFixed(3) }));
  const s4 = cr(Object.assign({}, V, { freq: +(f * Math.pow(2, lift / 12)).toFixed(1), crPitchStart: -lift * 0.5, crPitchEnd: -lift - 4, crPeak: 0.3,
    crOpenStart: 0.55, crOpenPeak: 0.95, crOpenEnd: 0.2, crVowelStart: 0.5, crVowelEnd: 0.9, attack: 0.015, release: 0.18, duration: +(0.95 * t).toFixed(3) }));
  const d2 = 0.15 * t, d3 = d2 + 0.13 * t, d4 = d3 + 0.28 * t;
  return Object.assign({}, s1, { layers: layers([
    { s: s2, d: +d2.toFixed(3), g: 0.8, p: 0 }, { s: s3, d: +d3.toFixed(3), g: 0.9, p: 0 }, { s: s4, d: +d4.toFixed(3), g: 1, p: 0 }]) });
}
const ROOSTER = crow({ f: 500, size: 0.6, rough: 0.18, jitter: 0.35, shimmer: 0.3, tension: 0.9, breath: 0.4, t: 1.05, lift: 3, gain: 0.48 });
// a bantam: a smaller, higher, quicker bird whose last syllable is shorter and thinner
const BANTAM = crow({ f: 700, size: 0.45, rough: 0.12, jitter: 0.3, shimmer: 0.25, tension: 0.9, breath: 0.35, t: 0.8, lift: 4, gain: 0.5 });

// ---- DUCK. A mallard hen's quack: ~0.15-0.25 s, a harsh, NASAL, buzzy "kwaak" with a falling pitch, the beak only
// half open (so the nose stays in it), pressed hard; given in a descending series. creatureShot lowers each later call.
const QUACK = cr({ freq: 340, crSize: 0.6, crPitchStart: 3, crPitchEnd: -5, crPeak: 0.2, crOpenStart: 0.2, crOpenPeak: 0.75, crOpenEnd: 0.25,
  crVowelStart: 0.25, crVowelEnd: 0.45, crNasal: 0.4, crTension: 1, crJitter: 0.3, crShimmer: 0.35, crRough: 0.15, crBreath: 0.2,
  crFlutter: 0.3, crFlutterRate: 45, attack: 0.01, hold: 0.13, decay: 0.07, sustain: 0, release: 0.04, repeat: 3, rate: 4, gain: 0.8, duration: 0.85 });

// ---- HORSE. A whinny: ~1-1.5 s, starts HIGH (f0 near 1 kHz) with a fast, wide quaver, falls, and ends in a lower,
// breathy, fluttering part. Horses whinny with two independent fundamentals at once (biphonation, the second ~2.5x
// the first), which is the shrill edge; layer 3 is that second voice, quieter, over the high part only.
const NEIGH_HI = cr({ freq: 950, vibDepth: 0.22, vibRate: 11, vibOnset: 0.08, crSize: 1.6, crPitchStart: -3, crPitchEnd: -11, crPeak: 0.25,
  crOpenStart: 0.45, crOpenPeak: 0.85, crOpenEnd: 0.6, crVowelStart: 0.3, crVowelEnd: 0.6, crNasal: 0.5, crTension: 0.8, crJitter: 0.35,
  crShimmer: 0.3, crRough: 0.1, crBreath: 0.35, attack: 0.04, release: 0.15, gain: 0.55, duration: 1.05 });
const NEIGH_LO = cr({ freq: 170, crSize: 1.8, crPitchStart: 2, crPitchEnd: -4, crPeak: 0.25, crOpenStart: 0.3, crOpenPeak: 0.45, crOpenEnd: 0.15,
  crVowelStart: 0.6, crVowelEnd: 0.8, crNasal: 0.7, crTension: 0.6, crJitter: 0.4, crShimmer: 0.4, crRough: 0.3, crBreath: 0.6,
  crFlutter: 0.8, crFlutterRate: 9, attack: 0.03, release: 0.2, duration: 0.65 });
const NEIGH_BI = Object.assign({}, NEIGH_HI, { freq: 2300, crSize: 1.6, crBreath: 0.1, duration: 0.7, release: 0.2 });
const NEIGH = Object.assign({}, NEIGH_HI, { layers: layers([{ s: NEIGH_LO, d: 0.82, g: 0.45, p: 0 }, { s: NEIGH_BI, d: 0, g: 0.2, p: 0 }]) });

// ---- OWL. A hoot is made with the beak CLOSED and the throat puffed: nearly a pure tone, soft and round ("hoo"),
// f0 ~ 300-400 Hz, each 0.1-0.45 s, a small rise and fall. The pattern is "hoo — h'HOO — hoo".
function hoo(f, dur, o) {
  return cr(Object.assign({ freq: f, crSize: 0.9, crPitchStart: -1.5, crPitchEnd: -2.5, crPeak: 0.35, crOpenStart: 0.08, crOpenPeak: 0.22, crOpenEnd: 0.08,
    crVowelStart: 1, crVowelEnd: 1, crNasal: 0.5, crTension: 0.15, crJitter: 0.06, crShimmer: 0.05, crRough: 0, crBreath: 0.12,
    attack: 0.04, release: 0.12, duration: dur }, o || {}));
}
const OWL = Object.assign({}, hoo(340, 0.34), { gain: 0.36, layers: layers([
  { s: hoo(345, 0.1, { attack: 0.015, release: 0.04, crPitchStart: -2, crPitchEnd: -1 }), d: 0.55, g: 0.7, p: 0 },
  { s: hoo(350, 0.44), d: 0.68, g: 1, p: 0 },
  { s: hoo(335, 0.42, { crPitchEnd: -3.5 }), d: 1.32, g: 0.85, p: 0 }]) });

// ---- FROG. A croak is a PULSED call: the larynx clicks in trains (tens per second) and the vocal sac rings each
// pulse; mouth shut. A low voice with an octave-down subharmonic (rough) under a rattle at the pulse rate; two croaks.
const CROAK = cr({ freq: 150, crSize: 1.0, crPitchStart: 1, crPitchEnd: -3, crPeak: 0.3, crOpenStart: 0.2, crOpenPeak: 0.7, crOpenEnd: 0.15,
  crVowelStart: 0.5, crVowelEnd: 0.65, crNasal: 0.6, crTension: 0.9, crJitter: 0.3, crShimmer: 0.4, crRough: 0.4, crBreath: 0.15,
  crFlutter: 0.85, crFlutterRate: 28, attack: 0.012, hold: 0.18, decay: 0.07, sustain: 0, release: 0.05, repeat: 2, rate: 3, gain: 1, duration: 0.65 });

// ---- BAT. What we hear of a bat is its social squeaks (the sonar is ultrasonic): very high, short, harsh, falling
// FM screeches, from a larynx too, in a quick chittering run. A tiny, pressed throat, high f0, a little chaos.
const SCREECH = cr({ freq: 3000, crSize: 0.3, crPitchStart: 2, crPitchEnd: -7, crPeak: 0.2, crOpenStart: 0.5, crOpenPeak: 1, crOpenEnd: 0.4,
  crVowelStart: 0.05, crVowelEnd: 0.2, crNasal: 0, crTension: 1, crJitter: 0.2, crShimmer: 0.25, crRough: 0.15, crBreath: 0.2,
  attack: 0.003, hold: 0.045, decay: 0.03, sustain: 0, release: 0.02, repeat: 3, rate: 10, gain: 0.55, duration: 0.32 });

const VARY = { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.03 };   // Cat Meow's own
// a LAYERED sound's _vary reaches layer 1 only (varyPreset jitters top-level keys; the `layers` string is untouched), so
// its freq moves by at most a semitone (0.03 -> round(+-0.72)) or the first syllable would detune from the rest
const VARY_LAYERED = { freq: 0.03, crSize: 0.05, crOpenPeak: 0.1, crPitchEnd: 0.03 };
const SOUNDS = [
  { slug: "distant-cluck", name: "Distant Cluck", patch: DISTANT, pitch: [100, 1200], vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.03 } },
  { slug: "cluck", name: "Cluck", patch: CLUCK, pitch: [100, 1200], vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.03, rate: 0.15 } },
  { slug: "rooster-crow", name: "Rooster Crow", patch: ROOSTER, alts: [BANTAM], pitch: [150, 1500], vary: VARY_LAYERED },
  { slug: "duck-quack", name: "Duck Quack", patch: QUACK, pitch: [80, 1200], vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.03, rate: 0.1 } },
  { slug: "horse-neigh", name: "Horse Neigh", patch: NEIGH, pitch: [80, 2000], vary: VARY },
  { slug: "owl-hoot", name: "Owl Hoot", patch: OWL, pitch: [100, 800], vary: VARY_LAYERED },
  { slug: "frog-croak", name: "Frog Croak", patch: CROAK, pitch: [30, 600], vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.03, rate: 0.1 } },
  { slug: "bat-screech", name: "Bat Screech", patch: SCREECH, pitch: [400, 5000], vary: VARY },
];

// ============================================================================================================
const only = process.argv[2];
const stripMeta = (p) => { const b = Object.assign({}, p); delete b._vary; delete b._alts; return b; };
if (only === "try") {
  const p = JSON.parse(process.argv[3]), lo = parseFloat(process.argv[4]) || 60, hi = parseFloat(process.argv[5]) || 2000;
  console.log(fmt(measure(render(p), { pitch: [lo, hi] }), p.freq));
  process.exit(0);
}
if (only === "ref") { reference(false); process.exit(0); }
if (only === "track") {   // node ... track <slug> [alt index]: the YIN track every 20 ms (f0 Hz / aperiodicity), the level beside it
  const s = SOUNDS.find((x) => x.slug === process.argv[3]), p = [s.patch].concat(s.alts || [])[+process.argv[4] || 0], r = render(p);
  const mono = Float64Array.from(r.L, (v, i) => 0.5 * (v + r.R[i])), tr = yinTrack(mono, s.pitch[0], s.pitch[1], 0.02);
  const pk = Math.max(...tr.map((q) => q.rms || 0));
  console.log(tr.map((q) => q.t.toFixed(2) + ":" + (q.f ? q.f.toFixed(0) + "/" + q.ap.toFixed(2) + "@" + (20 * Math.log10((q.rms || 1e-9) / pk)).toFixed(0) : "-")).join("  "));
  process.exit(0);
}

const REF = reference(true).med;
console.log("creature reference median " + REF.toFixed(1) + " LUFS");
// separation: every new version and the five references (alts included) on four axes
function features(m) {
  return [Math.log2(m.f0 && m.f0.median > 0 ? m.f0.median : 100), Math.log2(Math.max(0.05, m.audible - m.onset)), Math.log2(Math.max(100, m.cent)), 3 * (m.ap ?? 0.5), Math.log2(m.syl || 1)];
}
if (only === "sep" || !only) {
  const pts = [];
  for (const s of SOUNDS) [s.patch].concat(s.alts || []).forEach((p, k) => pts.push({ n: s.name + (k ? " alt" + k : ""), m: measure(render(p), { pitch: s.pitch }) }));
  const refPitch = { "Cat Meow": [150, 2000], "Cow Moo": [40, 600], "Dog Bark": [60, 1000], "Wolf Howl": [100, 1500], "Monster Growl": [25, 600] };
  for (const [n, p] of refPatches()) pts.push({ n: "[ref] " + n, m: measure(render(p), { pitch: refPitch[n.replace(/ alt\d$/, "")] }) });
  console.log("\nSEPARATION (log2 f0 oct, log2 audible dur, log2 centroid, 3 x aperiodicity, log2 syllables)");
  for (const p of pts) { p.v = features(p.m); console.log("  " + p.n.padEnd(26) + p.v.map((x) => x.toFixed(2).padStart(7)).join("") + "   " + p.m.syl + " syl, f0 " + (p.m.f0 ? p.m.f0.median.toFixed(0) : "-") + " Hz, " + (p.m.audible - p.m.onset).toFixed(2) + " s, " + (p.m.cent / 1000).toFixed(2) + " kHz, ap " + (p.m.ap ?? NaN).toFixed(2)); }
  const pairs = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (pts[i].n.startsWith("[ref]") && pts[j].n.startsWith("[ref]")) continue;
    if (pts[i].n.split(" alt")[0] === pts[j].n.split(" alt")[0]) continue;
    pairs.push([Math.hypot(...pts[i].v.map((x, k) => x - pts[j].v[k])), pts[i].n, pts[j].n]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  console.log("closest pairs:"); for (const p of pairs.slice(0, 8)) console.log("  " + p[0].toFixed(2) + "  " + p[1] + "  <->  " + p[2]);
  if (only === "sep") process.exit(0);
}

const wavDir = join(ROOT, "soundtests", "creature-redo", "animals"), jsonDir = join(ROOT, "tools", "new-presets");
mkdirSync(wavDir, { recursive: true }); mkdirSync(jsonDir, { recursive: true });
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
const json = {};
for (const s of SOUNDS) {
  if (only && only !== "json" && s.slug !== only) continue;
  if (only !== "json") {
    const now = render(stripMeta(PRESETS[s.name]));
    wav(s.slug + "-1-now.wav", now, s.name + " (now, formant)");
    console.log("\n" + (s.slug + "-1-now.wav").padEnd(30) + fmt(measure(now, { pitch: s.pitch }), PRESETS[s.name].freq));
    [s.patch].concat(s.alts || []).forEach((p, k) => {
      const r = render(p), m = measure(r, { pitch: s.pitch });
      const file = s.slug + "-2-new" + (k ? "-alt" + k : "") + ".wav";
      wav(file, r, s.name + (k ? " alt " + k : "") + " (new, creature)");
      console.log((file).padEnd(30) + fmt(m, p.freq) + "\n      vs creature median " + (m.lufs - REF >= 0 ? "+" : "") + (m.lufs - REF).toFixed(1) + " dB");
    });
  }
  const entry = Object.assign({}, s.patch, { _vary: s.vary });
  if (s.alts && s.alts.length) entry._alts = s.alts;
  json[s.name] = entry;
}
if (!only || only === "json") writeFileSync(join(jsonDir, "creature-redo-animals.json"), JSON.stringify(json, null, 2) + "\n");
