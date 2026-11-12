/* creature-redo-named.mjs — FOUR NAMED MONSTERS rebuilt off the formant engine (wave 13) onto the creature voice
 * (wave 28): Goblin Chatter, Troll Grunt, Beast Roar, Monster Growl 2. AJ (2026-11-12): every Animal / Monster preset
 * on formant sounds bad and is redone; these four are the NAMED creatures (the farm/wild animals and the adjective x
 * noun monster family are other agents' rounds), so each is given a character rather than a size or a mood.
 *
 *   node tools/proto/creature-redo-named.mjs            renders every sound (now + new + alts), measures, writes WAVs + JSON
 *   node tools/proto/creature-redo-named.mjs ref        measures only the existing creature presets (the level bar)
 *   node tools/proto/creature-redo-named.mjs sep        the separation table only (new sounds against each other and the
 *                                                       shipped Monster Growl (+ alts), Wolf Howl and Dog Bark)
 *   node tools/proto/creature-redo-named.mjs <slug>     one sound (and its alts), measured, written
 *   node tools/proto/creature-redo-named.mjs try '<patch json>' [fmin fmax]   one patch measured, nothing written
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, exactly as tools/make-ab.mjs does,
 * with Normalize ON (the app's default) and NOT loudness-matched: the WAV is what the app's button plays. `render` is the
 * bundle's renderSound, so a patch's `layers` (a JSON string of up to three more layers) render as the app mixes them.
 * Writes soundtests/creature-redo/named/<slug>-1-now.wav (today's formant preset), <slug>-2-new.wav (+ <slug>-2-new-alt<N>.wav) and
 * tools/new-presets/creature-redo-named.json.
 *
 * Self-checks per sound: peak (and whether it clips), DC per channel, duration and the audible span (to -60 dB), BS.1770
 * integrated loudness against the MEDIAN of the existing creature presets (Cat Meow, Cow Moo, Dog Bark, Wolf Howl,
 * Monster Growl, alts included), a YIN pitch track (start / middle / end, median), and for the separation table four
 * features: median pitch, audible duration, mean spectral centroid over the loud frames, and aperiodicity (YIN's
 * normalized-difference minimum averaged over the loud frames: 0 = a clean periodic voice, toward 1 = rough / noisy).
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


// ---- the reference: every creature patch (base or alt) shipped today, as the app plays it
const REF_NAMES = ["Cat Meow", "Cow Moo", "Dog Bark", "Wolf Howl", "Monster Growl"];
function refPatches(names) {
  const out = [];
  for (const name of names) {
    const p = PRESETS[name]; if (!p) continue;
    const base = Object.assign({}, p); delete base._vary; delete base._alts;
    out.push([name, base]);
    (p._alts || []).forEach((a, k) => out.push([name + " alt" + (k + 1), a]));
  }
  return out;
}
function reference(quiet) {
  const rows = refPatches(REF_NAMES).map(([n, p]) => { const m = measure(render(p)); return { n, lufs: m.lufs, peak: m.peak }; });
  const med = median(rows.map((r) => r.lufs));
  if (!quiet) { for (const r of rows) console.log("   " + r.n.padEnd(24) + r.lufs.toFixed(1).padStart(7) + " LUFS  peak " + r.peak.toFixed(3)); console.log("   MEDIAN " + med.toFixed(1) + " LUFS (" + rows.length + " patches)"); }
  return { med, rows };
}

// ---- separation features: median pitch, audible duration, loud-frame centroid, aperiodicity
function features(r) {
  const { L, R } = r, n = L.length, mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  const m = measure(r, { pitch: [35, 1600] });
  let pk = 0; for (const v of mono) pk = Math.max(pk, Math.abs(v));
  // centroid every 25 ms over 2048-sample windows, weighted by the window's energy (the loud part speaks)
  let num = 0, den = 0;
  for (let a = 0; a + 2048 < n; a += Math.round(0.025 * SR)) {
    let e = 0; for (let i = a; i < a + 2048; i++) e += mono[i] * mono[i];
    if (Math.sqrt(e / 2048) < pk * 0.05) continue;
    num += centroid(mono, a, a + 2048) * e; den += e;
  }
  // aperiodicity: YIN's dip over the loud frames (every frame whose RMS is within 20 dB of the loudest)
  const tr = yinTrack(mono, 35, 1600, 0.02, 0.04);
  const loud = tr.filter((p) => p.f > 0);
  const ap = loud.length ? loud.reduce((s, p) => s + Math.min(1, p.ap), 0) / loud.length : 1;
  const e = m.env, pkT = (e.indexOf(Math.max(...e)) * 0.05 + 0.025 - m.onset) / Math.max(0.05, m.audible - m.onset);
  return { f0: m.f0.median, dur: m.audible - m.onset, cent: den ? num / den : 0, ap, pkT: Math.min(1, Math.max(0, pkT)), lufs: m.lufs };
}
function sepTable(rows) {
  const F = rows.map(([n, p]) => [n, features(render(p))]);
  console.log("\nFEATURES (pitch Hz / audible s / centroid Hz / aperiodicity)");
  for (const [n, f] of F) console.log("   " + n.padEnd(26) + f.f0.toFixed(0).padStart(6) + " Hz " + f.dur.toFixed(2).padStart(6) + " s " + f.cent.toFixed(0).padStart(6) + " Hz   ap " + f.ap.toFixed(2) + "   level peak at " + (100 * f.pkT).toFixed(0) + "%");
  // distance: pitch, duration and centroid in OCTAVES (a doubling = 1), aperiodicity in steps of 0.2
  const pairs = [];
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) {
    const a = F[i][1], b = F[j][1];
    if (!(F[i][0].startsWith("NEW") || F[j][0].startsWith("NEW"))) continue;   // only pairs involving a new sound
    if (F[i][0].replace(/ alt\d+$/, "") === F[j][0].replace(/ alt\d+$/, "")) continue;   // a sound and its own alt
    const dp = Math.log2(a.f0 / b.f0), dd = Math.log2(a.dur / b.dur), dc = Math.log2(a.cent / b.cent), da = (a.ap - b.ap) / 0.2, dt = (a.pkT - b.pkT) / 0.25;
    pairs.push({ a: F[i][0], b: F[j][0], d: Math.hypot(dp, dd, dc, da), d5: Math.hypot(dp, dd, dc, da, dt), dp, dd, dc, da, dt });
  }
  pairs.sort((p, q) => p.d - q.d);
  console.log("\nCLOSEST PAIRS (distance over four features: pitch / duration / centroid in octaves, aperiodicity /0.2; then with the\n   level peak's place in the call, /0.25, as a fifth)");
  for (const p of pairs.slice(0, 12)) console.log("   " + p.d.toFixed(2) + "  " + p.a.padEnd(26) + " ~ " + p.b.padEnd(26) + " dp " + p.dp.toFixed(2) + " dd " + p.dd.toFixed(2) + " dc " + p.dc.toFixed(2) + " da " + p.da.toFixed(2) + "  | +peak-time " + p.dt.toFixed(2) + " -> " + p.d5.toFixed(2));
  return pairs;
}

// ============================================================================================================
// THE SOUNDS. The chassis is the shipped creature presets' (a flat amp envelope unless the call is a bark, the filter
// open, drive 0). `gain` is each sound's own trim to the creature median with Normalize on. A layer is a FULL patch
// (renderSound overlays it on the defaults, so stating every field keeps it independent of a default moving).
const CR = { wave: 28, hold: 0, decay: 0, sustain: 1, drive: 0, cutoff: 18000, reso: 0 };
const cr = (o) => Object.assign({}, CR, o);
const layers = (a) => JSON.stringify(a);

// GOBLIN CHATTER: two little nasal voices taking turns ("gib-ber-jab-ber"), then a high three-note snicker. The turns are
// two creature layers whose syllables INTERLEAVE (one front-vowel "nyih", one back-vowel "gawb", the second 2 st up and
// half a syllable late), so the vowel changes on every syllable as jabber does; a burst alone repeats one vowel.
const GOB_A = cr({ freq: 400, crPitchStart: -3, crPitchEnd: -5, crPeak: 0.3, crOpenStart: 0.1, crOpenPeak: 0.8, crOpenEnd: 0.25,
  crVowelStart: 0.05, crVowelEnd: 0.35, crNasal: 0.75, crSize: 0.55, crTension: 0.75, crJitter: 0.35, crShimmer: 0.3, crRough: 0.12,
  crBreath: 0.2, attack: 0.006, hold: 0.035, decay: 0.035, sustain: 0, release: 0.02, repeat: 4, rate: 8.5, duration: 0.47 });
const GOB_B = cr({ freq: 400, crPitchStart: 2, crPitchEnd: -4, crPeak: 0.25, crOpenStart: 0.3, crOpenPeak: 0.9, crOpenEnd: 0.2,
  crVowelStart: 0.75, crVowelEnd: 0.95, crNasal: 0.6, crSize: 0.6, crTension: 0.7, crJitter: 0.35, crShimmer: 0.3, crRough: 0.15,
  crBreath: 0.2, attack: 0.006, hold: 0.03, decay: 0.035, sustain: 0, release: 0.02, repeat: 3, rate: 8.5, duration: 0.35 });
const GOB_SNICKER = cr({ freq: 620, crPitchStart: 3, crPitchEnd: -3, crPeak: 0.2, crOpenStart: 0.05, crOpenPeak: 0.55, crOpenEnd: 0.1,
  crVowelStart: 0, crVowelEnd: 0.15, crNasal: 0.85, crSize: 0.5, crTension: 0.85, crJitter: 0.3, crShimmer: 0.3, crRough: 0.05,
  crBreath: 0.45, attack: 0.004, hold: 0.025, decay: 0.04, sustain: 0, release: 0.02, repeat: 3, rate: 11, duration: 0.3 });

// TROLL GRUNT: one heavy, dull "HUH" from a big chest: a half-lax larynx period-doubled (the octave-down weight), the
// mouth opening on a neutral "uh" (not the "oo" a bigger tract would default to: that read as a muffled hum) and held
// for a beat before it slumps shut, the pitch sagging seven semitones. A bark envelope times it (sustain 0).
const TROLL = cr({ freq: 78, crPitchStart: 2, crPitchEnd: -7, crPeak: 0.35, crOpenStart: 0.3, crOpenPeak: 0.85, crOpenEnd: 0.3,
  crVowelStart: 0.45, crVowelEnd: 0.65, crNasal: 0.35, crSize: 1.8, crTension: 0.55, crJitter: 0.3, crShimmer: 0.35, crRough: 0.45,
  crBreath: 0.4, attack: 0.015, hold: 0.2, decay: 0.12, sustain: 0, release: 0.06, duration: 0.42 });
// the alt: the dim "uh-HUH" (two grunts, the second the stronger), a different rhythm rather than a different voice
const TROLL_UHHUH = Object.assign({}, TROLL, { crPitchStart: -1, crPitchEnd: -5, crPeak: 0.3, crOpenPeak: 0.75, hold: 0.1,
  decay: 0.1, repeat: 2, rate: 3.6, duration: 0.56, crTension: 0.45,
  layers: JSON.stringify([{ s: Object.assign({}, TROLL, { hold: 0.12, decay: 0.12, crPitchStart: 3, duration: 0.3 }), d: 0.28, g: 1.25, p: 0 }]) });
delete TROLL_UHHUH.repeat; delete TROLL_UHHUH.rate;
// BEAST ROAR: a big cat-like roar, higher and longer than Monster Growl's: it SWELLS in (slow attack) with the jaw
// dropping wide, climbs to its top a third of the way in, then falls almost an octave as the mouth rounds "aaaa-oor".
// Roughness under the chaos threshold keeps it a voice with an octave-down shadow rather than noise.
const BEAST = cr({ freq: 165, vibDepth: 0.02, vibRate: 6, crPitchStart: -6, crPitchEnd: -11, crPeak: 0.32, crOpenStart: 0.15,
  crOpenPeak: 1, crOpenEnd: 0.3, crVowelStart: 0.4, crVowelEnd: 0.9, crSize: 1.9, crTension: 0.75, crJitter: 0.45, crShimmer: 0.45,
  crRough: 0.55, crBreath: 0.55, crFlutter: 0.15, crFlutterRate: 13, attack: 0.28, release: 0.45, duration: 1.75 });

// MONSTER GROWL 2: the one that LURKS, then strikes: "grrrrrr... RAH!". Monster Growl is one call that opens early
// into its roar; this is two events. A low, half-open, nasal rumble with a fast wet rattle (a gurgle at ~34 Hz, twice
// the rate of Monster Growl's rattle alt, roughness under the period-doubling knee so the rattle is the texture, not
// chaos) simmers for a second; then a separate, sharper call a fifth higher snaps the mouth wide on "RAH" and falls
// away. Its loudest moment is at the END, where every other growl's is early or in the middle.
const LURK = cr({ freq: 64, crPitchStart: -2, crPitchEnd: -1, crPeak: 0.6, crOpenStart: 0.12, crOpenPeak: 0.5, crOpenEnd: 0.3,
  crVowelStart: 0.9, crVowelEnd: 0.8, crNasal: 0.7, crSize: 2, crTension: 0.6, crJitter: 0.35, crShimmer: 0.35, crRough: 0.3,
  crBreath: 0.4, crFlutter: 0.6, crFlutterRate: 34, attack: 0.25, release: 0.12, duration: 1.15 });
const LURK_STRIKE = cr({ freq: 64, crPitchStart: 2, crPitchEnd: -6, crPeak: 0.2, crOpenStart: 0.4, crOpenPeak: 1, crOpenEnd: 0.3,
  crVowelStart: 0.35, crVowelEnd: 0.6, crNasal: 0.1, crSize: 1.7, crTension: 0.8, crJitter: 0.4, crShimmer: 0.4, crRough: 0.5,
  crBreath: 0.5, attack: 0.01, hold: 0.12, decay: 0.2, sustain: 0, release: 0.08, duration: 0.45 });

const SOUNDS = [
  { slug: "goblin-chatter", name: "Goblin Chatter", pitch: [150, 1500],
    patch: Object.assign({}, GOB_A, { gain: 0.7, layers: layers([{ s: GOB_B, d: 0.06, g: 0.95, p: 2 }, { s: GOB_SNICKER, d: 0.5, g: 0.8, p: 0 }]) }),
    vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.05 } },
  { slug: "troll-grunt", name: "Troll Grunt", pitch: [35, 400],
    patch: Object.assign({}, TROLL, { gain: 0.85 }),
    alts: [Object.assign({}, TROLL_UHHUH, { gain: 0.78 })],
    vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.05 } },
  { slug: "beast-roar", name: "Beast Roar", pitch: [50, 600],
    patch: Object.assign({}, BEAST, { gain: 0.78 }),
    vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.08, crPitchEnd: 0.05 } },
  { slug: "monster-growl-2", name: "Monster Growl 2", pitch: [35, 400],
    patch: Object.assign({}, LURK, { gain: 1, layers: layers([{ s: LURK_STRIKE, d: 1.0, g: 1.5, p: 7 }]) }),
    vary: { freq: 0.1, crSize: 0.08, crOpenPeak: 0.1, crFlutterRate: 0.1 } },
];

// ============================================================================================================
const only = process.argv[2];
if (only === "try") {
  const p = JSON.parse(process.argv[3]), lo = parseFloat(process.argv[4]), hi = parseFloat(process.argv[5]);
  console.log(fmt(measure(render(p), { pitch: lo > 0 ? [lo, hi] : null, centroid: 0.1 })));
  process.exit(0);
}
if (only === "ref") { console.log("CREATURE (wave 28) presets as shipped"); reference(); process.exit(0); }
const SEP_ROWS = () => {
  const rows = [];
  for (const s of SOUNDS) { rows.push(["NEW " + s.name, s.patch]); (s.alts || []).forEach((a, k) => rows.push(["NEW " + s.name + " alt" + (k + 1), a])); }
  return rows.concat(refPatches(["Monster Growl", "Wolf Howl", "Dog Bark"]));
};
if (only === "sep") { sepTable(SEP_ROWS()); process.exit(0); }

const REF = reference(true).med;
console.log("creature reference median " + REF.toFixed(1) + " LUFS");
const wavDir = join(ROOT, "soundtests", "creature-redo", "named"), jsonDir = join(ROOT, "tools", "new-presets");
mkdirSync(wavDir, { recursive: true }); mkdirSync(jsonDir, { recursive: true });
const json = {};
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
for (const s of SOUNDS) {
  if (only && only !== "json" && s.slug !== only) continue;
  // today's preset (the formant one), as the app plays it
  { const p = Object.assign({}, PRESETS[s.name]); delete p._vary; delete p._alts;
    const r = render(p), m = measure(r, { pitch: s.pitch }); wav(s.slug + "-1-now.wav", r, s.name + " (now)");
    console.log((s.slug + "-1-now.wav").padEnd(30) + fmt(m)); }
  const versions = [s.patch].concat(s.alts || []);
  versions.forEach((p, k) => {
    const r = render(p), m = measure(r, { pitch: s.pitch, centroid: 0.1 });
    const file = s.slug + "-2-new" + (k ? "-alt" + k : "") + ".wav";
    wav(file, r, s.name + (k ? " alt " + k : " (new)"));
    console.log(file.padEnd(30) + fmt(m) + "\n      vs creature median " + (m.lufs - REF >= 0 ? "+" : "") + (m.lufs - REF).toFixed(1) + " dB");
  });
  const entry = Object.assign({}, s.patch, { _vary: s.vary });
  if (s.alts && s.alts.length) entry._alts = s.alts;
  json[s.name] = entry;
}
if (!only || only === "json") { writeFileSync(join(jsonDir, "creature-redo-named.json"), JSON.stringify(json, null, 2) + "\n"); sepTable(SEP_ROWS()); }
