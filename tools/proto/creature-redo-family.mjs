/* creature-redo-family.mjs — the 23 combinatorial Animal / Monster presets (Giant Growl, Tiny Roar, Feral Howl, ...)
 * rebuilt from the FORMANT engine (wave 13) onto the CREATURE engine (wave 28), from TWO TABLES, composed.
 *
 *   node tools/proto/creature-redo-family.mjs            renders every sound (now + new), measures, writes WAVs + JSON
 *   node tools/proto/creature-redo-family.mjs ref        measures only the existing creature presets (the level bar)
 *   node tools/proto/creature-redo-family.mjs <slug>     one sound, measured, written (no JSON, no all-new.wav)
 *   node tools/proto/creature-redo-family.mjs try '<patch json>'   measure one patch, nothing written
 *
 * WHY. The names are an ADJECTIVE (who is calling: body size and temper) times a CALL NOUN (what the call does over
 * time). The formant takes were near-duplicates of each other: a steady saw through one vowel at a different pitch. Here
 *   ADJ  = the BODY: tract size, a pitch multiplier, a tempo multiplier, the larynx (roughness, jitter, shimmer,
 *          tension, breath), how wide it swings its pitch, how far it opens its mouth, a vowel lean, a throat rattle,
 *          a vibrato (a quaver or a wail)
 *   NOUN = the CALL: a base pitch for a size-1 body, the pitch contour (start / peak-at / end), the mouth and vowel
 *          trajectories, nasality, the envelope (sustained, or a shot for barks) and burst (repeat / rate), and what
 *          the call adds to the larynx (a growl is rough and rattles, a howl is clean, a croak creaks)
 * and compose() is the ONLY place they meet, by rules stated next to it. So "Tiny Roar" is a roar's shape from a
 * small throat and "Giant Howl" a howl's shape from a huge one, and the name always says what the sound is.
 * A collision between two names is a table entry not doing its job: fix the table, not the patch.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does, with
 * Normalize ON (the app's default) and NOT loudness-matched: each WAV is what the app's button plays. The one per-name
 * number not from the tables is `gain`: a level trim computed so the integrated loudness lands on the median of the
 * existing creature presets (Normalize already sets the peak, so gain is the only level lever left).
 *
 * Writes soundtests/creature-redo/family/<slug>-1-now.wav (the current formant preset) and <slug>-2-new.wav,
 * soundtests/creature-redo/family/all-new.wav (+ KEY.md: every new one in name order, 0.4 s apart), and
 * tools/new-presets/creature-redo-family.json ({ name: patch with _vary }).
 *
 * Self-checks per sound: peak (and clipping), DC, duration and audible span, BS.1770 loudness against the creature
 * median, a YIN pitch track (start / mid / end / median), aperiodicity (how rough), spectral centroid, burst count.
 * SEPARATION: every pair in the 23 (and each against the existing creature presets) on those features; the closest
 * pairs are printed.
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

// ============================================================================================================
// THE TWO TABLES
//
// ADJ: the body.
//   size     crSize (the tract: 1 = a person, 0.4 a cat, 2.5 a monster)
//   fMul     multiplies the noun's base pitch (a bigger body is lower; a tense or wailing one sits higher than its size)
//   dMul     multiplies every time in the call (a big body is slow, a small one quick; also slows a burst's rate)
//   rough / jitter / shimmer / tension / breath   the larynx, before the noun adds its own
//   range    multiplies the noun's pitch excursions (an angry voice swings wider, a giant's barely moves)
//   open     multiplies the mouth trajectory (a guttural throat or a hissing serpent barely opens)
//   vowel    added to the vowel trajectory (+ = back "oo", the throat; - = front "ee", bared teeth)
//   nasal    added to the noun's nasality
//   flutter / flRate   a throat rattle the body brings to any call (Hz)
//   flMul    multiplies a NOUN's rattle rate (a small throat rattles faster)
//   vib / vibRate      a vibrato the body brings (vibDepth units: 0.05 = about +/-30 cents)
//   atkMul   multiplies the attack only (anger strikes)
const ADJ = {
  Tiny:       { size: 0.42, fMul: 2.4,  dMul: 0.6,  rough: 0.05, jitter: 0.2,  shimmer: 0.15, tension: 0.7,  breath: 0.25, range: 1.2,  open: 1.0,  vowel: -0.1,  nasal: 0,   flMul: 1.6 },
  Giant:      { size: 2.7,  fMul: 0.38, dMul: 1.4,  rough: 0.25, jitter: 0.25, shimmer: 0.3,  tension: 0.6,  breath: 0.3,  range: 0.85, open: 1.0,  vowel: 0.1,   nasal: 0,   flMul: 0.65 },
  Ancient:    { size: 2.0,  fMul: 0.6,  dMul: 1.25, rough: 0.15, jitter: 0.7,  shimmer: 0.6,  tension: 0.25, breath: 0.45, range: 0.8,  open: 0.85, vowel: 0.15,  nasal: 0,   flMul: 0.8, vib: 0.04, vibRate: 5 },
  Guttural:   { size: 1.7,  fMul: 0.7,  dMul: 1.0,  rough: 0.55, jitter: 0.45, shimmer: 0.45, tension: 0.85, breath: 0.35, range: 0.6,  open: 0.75, vowel: 0.3,   nasal: 0.3, flMul: 1.0, flutter: 0.35, flRate: 26 },
  Feral:      { size: 1.0,  fMul: 1.0,  dMul: 0.9,  rough: 0.42, jitter: 0.4,  shimmer: 0.35, tension: 0.75, breath: 0.4,  range: 1.0,  open: 1.0,  vowel: 0,     nasal: 0,   flMul: 1.0 },
  Rabid:      { size: 1.1,  fMul: 1.15, dMul: 0.85, rough: 0.88, jitter: 0.75, shimmer: 0.6,  tension: 0.95, breath: 0.65, range: 1.3,  open: 1.0,  vowel: -0.1,  nasal: 0,   flMul: 1.2, flutter: 0.2, flRate: 38 },
  Wailing:    { size: 1.05, fMul: 1.3,  dMul: 1.3,  rough: 0.03, jitter: 0.1,  shimmer: 0.1,  tension: 0.5,  breath: 0.15, range: 1.3,  open: 1.05, vowel: 0,     nasal: 0,   flMul: 1.0, vib: 0.07, vibRate: 5.8 },
  Slithering: { size: 1.3,  fMul: 0.85, dMul: 1.25, rough: 0,    jitter: 0.1,  shimmer: 0.25, tension: 0.4,  breath: 1.0,  range: 0.8,  open: 0.9,  vowel: -0.4,  nasal: 0.2, flMul: 1.0, flutter: 0.15, flRate: 9, vib: 0.06, vibRate: 2.2 },
  Angry:      { size: 1.2,  fMul: 1.1,  dMul: 0.85, rough: 0.6,  jitter: 0.35, shimmer: 0.35, tension: 0.92, breath: 0.35, range: 1.4,  open: 1.1,  vowel: -0.05, nasal: 0,   flMul: 1.0, atkMul: 0.5 },
};

// NOUN: the call, for a size-1 body.
//   f              base pitch (Hz) = the PEAK of the contour (crPitchStart/End are semitones about it)
//   pS / peak / pE pitch start, where the peak falls (0..1), pitch end
//   oS / oP / oE   mouth openness start / at the peak / end
//   vS / vE        vowel start -> end (0 front "ee" .. 1 back "oo")
//   nasal          nasality (a closed-mouth hum at the edges of the call)
//   dur            the sound's length (s) for a sustained call; for a burst it is derived from the shots
//   env            "sus" (sustain 1: the call is the whole sound; atk / rel) or "shot" (sustain 0: atk + hold + decay is
//                  one call, a bark), with repeat / rate for a burst
//   rough / jitter / tension / breath   ADDED to the body's
//   roughMul       a TONAL call (howl, wail, squeal) scales the body's roughness down first: a rough body howling is a
//                  rough howl, but still a howl, not the octave-down growl the same roughness makes of a growl
//   flutter / flRate   the call's own rattle (a growl's throat, a croak's creak)
//   vib / vibRate  the call's own vibrato
const NOUN = {
  Growl:   { f: 120,  pS: -2, peak: 0.45, pE: -4,  oS: 0.25, oP: 0.55, oE: 0.3,  vS: 0.55, vE: 0.7,  nasal: 0.1,  dur: 1.1,  env: "sus", atk: 0.08, rel: 0.25,
             rough: 0.25, flutter: 0.3, flRate: 20 },
  Roar:    { f: 220,  pS: -4, peak: 0.25, pE: -10, oS: 0.3,  oP: 1.0,  oE: 0.4,  vS: 0.25, vE: 0.65, nasal: 0,    dur: 1.1,  env: "sus", atk: 0.03, rel: 0.3,
             rough: 0.3, breath: 0.2, flutter: 0.1, flRate: 24 },
  Snarl:   { f: 240,  pS: -1, peak: 0.55, pE: -3,  oS: 0.15, oP: 0.4,  oE: 0.15, vS: 0.1,  vE: 0.2,  nasal: 0,    dur: 0.75, env: "sus", atk: 0.02, rel: 0.12,
             rough: 0.3, jitter: 0.1, tension: 0.1, breath: 0.25, flutter: 0.55, flRate: 30 },
  Howl:    { f: 360,  pS: -10, peak: 0.35, pE: -8,  oS: 0.45, oP: 0.85, oE: 0.25,  vS: 0.55, vE: 0.95, nasal: 0.1,  dur: 1.7,  env: "sus", atk: 0.08, rel: 0.45,
             roughMul: 0.35, vib: 0.015, vibRate: 5 },
  Bellow:  { f: 120,  pS: -1, peak: 0.5,  pE: -3,  oS: 0.05, oP: 0.95, oE: 0.6,  vS: 0.5,  vE: 0.6,  nasal: 0.6,  dur: 1.6,  env: "sus", atk: 0.06, rel: 0.35,
             tension: 0.15 },
  Croak:   { f: 95,   pS: 1,  peak: 0.3,  pE: -3,  oS: 0.3,  oP: 0.65, oE: 0.25, vS: 0.7,  vE: 0.8,  nasal: 0.25,
             env: "shot", atk: 0.01, hold: 0.14, dec: 0.08, rel: 0.06, repeat: 2, rate: 3.2,
             rough: 0.35, flutter: 0.75, flRate: 34 },
  Gnash:   { f: 200,  pS: 1,  peak: 0.15, pE: -5,  oS: 0.15, oP: 0.9,  oE: 0.05, vS: 0.2,  vE: 0.35, nasal: 0,
             env: "shot", atk: 0.003, hold: 0.035, dec: 0.045, rel: 0.03, repeat: 4, rate: 9,
             rough: 0.35, jitter: 0.1, tension: 0.1, breath: 0.3 },
  Squeal:  { f: 800,  pS: -6, peak: 0.65, pE: -2,  oS: 0.3,  oP: 0.75, oE: 0.4,  vS: 0.05, vE: 0.12, nasal: 0,    dur: 0.75, env: "sus", atk: 0.03, rel: 0.12,
             roughMul: 0.5, tension: 0.15 },
  Wail:    { f: 420,  pS: -1, peak: 0.12, pE: -10, oS: 0.5,  oP: 0.75, oE: 0.3,  vS: 0.3,  vE: 0.85, nasal: 0,    dur: 1.7,  env: "sus", atk: 0.06, rel: 0.4,
             roughMul: 0.4, vib: 0.02, vibRate: 5.5 },
  Screech: { f: 1000, pS: -1, peak: 0.2,  pE: -7,  oS: 0.55, oP: 1.0,  oE: 0.5,  vS: 0.08, vE: 0.2,  nasal: 0,    dur: 0.85, env: "sus", atk: 0.01, rel: 0.15,
             rough: 0.3, tension: 0.2, breath: 0.2 },
};

// THE 23 (exact preset names; order = presets.js order)
const NAMES = ["Giant Growl", "Angry Wail", "Feral Gnash", "Tiny Roar", "Slithering Growl", "Ancient Squeal", "Feral Croak",
  "Wailing Gnash", "Angry Growl", "Rabid Snarl", "Ancient Growl", "Rabid Bellow", "Tiny Snarl", "Feral Howl", "Giant Howl",
  "Guttural Bellow", "Ancient Croak", "Tiny Bellow", "Feral Roar", "Tiny Gnash", "Wailing Screech", "Slithering Wail",
  "Guttural Growl"];

// Per-name overrides: only where composition genuinely fails, each with its reason. (None needed: see the report.)
const OVERRIDES = {};

// ============================================================================================================
// THE COMPOSER. The rules, all of them:
//   pitch      freq = noun.f * adj.fMul; contour = the noun's, its excursions times adj.range
//   body       crSize = adj.size (the noun never changes the throat)
//   larynx     jitter / shimmer / tension / breath = adj + noun's addition; rough = adj x noun.roughMul + noun's
//              addition; all clamped to 0..1
//   mouth      open start/peak/end = the noun's times adj.open; vowel = the noun's + adj.vowel; nasal = noun + adj
//   rattle     the louder of the two rattles wins its rate (the noun's rate times adj.flMul, or the body's own rate);
//              depth = the sum, clamped to 0.9
//   vibrato    depth = noun + adj; rate = the body's if it brings one, else the call's
//   time       every time (attack, hold, decay, release, sustained length) times adj.dMul, attack also times atkMul;
//              a burst's rate DIVIDED by dMul (a big body gnashes slower). A sustained length over 2 s (the slider max)
//              is clamped to 2 s with its release kept. A burst's length = its shots plus the last call's tail.
//   level      gain = a trim that lands the integrated loudness on the creature median (see the header)
const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
function compose(name) {
  const [adjName, nounName] = name.split(" ");
  const A = ADJ[adjName], N = NOUN[nounName];
  if (!A || !N) throw new Error("no table entry for " + name);
  const d = A.dMul;
  const p = { wave: 28, drive: 0, cutoff: 18000, reso: 0 };
  p.freq = Math.round(cl(N.f * A.fMul, 20, 4000));
  if ((N.vib || 0) + (A.vib || 0) > 0) { p.vibDepth = r3((N.vib || 0) + (A.vib || 0)); p.vibRate = A.vib ? A.vibRate : N.vibRate; }
  p.crPitchStart = r2(N.pS * A.range); p.crPitchEnd = r2(N.pE * A.range); p.crPeak = N.peak;
  p.crOpenStart = r2(cl(N.oS * A.open, 0, 1)); p.crOpenPeak = r2(cl(N.oP * A.open, 0, 1)); p.crOpenEnd = r2(cl(N.oE * A.open, 0, 1));
  p.crVowelStart = r2(cl(N.vS + A.vowel, 0, 1)); p.crVowelEnd = r2(cl(N.vE + A.vowel, 0, 1));
  const nasal = cl((N.nasal || 0) + (A.nasal || 0), 0, 1); if (nasal > 0) p.crNasal = r2(nasal);
  p.crSize = A.size;
  p.crTension = r2(cl(A.tension + (N.tension || 0), 0, 1));
  p.crJitter = r2(cl(A.jitter + (N.jitter || 0), 0, 1));
  p.crShimmer = r2(cl(A.shimmer + (N.shimmer || 0), 0, 1));
  p.crRough = r2(cl(A.rough * (N.roughMul ?? 1) + (N.rough || 0), 0, 1));
  p.crBreath = r2(cl(A.breath + (N.breath || 0), 0, 1));
  const nf = N.flutter || 0, af = A.flutter || 0;
  if (nf + af > 0) { p.crFlutter = r2(cl(nf + af, 0, 0.9)); p.crFlutterRate = r2(cl(nf >= af ? N.flRate * A.flMul : A.flRate, 2, 60)); }
  const atk = N.atk * d * (A.atkMul || 1);
  if (N.env === "sus") {
    Object.assign(p, { hold: 0, decay: 0, sustain: 1, attack: r3(atk), release: r3(N.rel * d), duration: r2(Math.min(2, N.dur * d)) });
  } else {
    const rate = r2(N.rate / d), hold = N.hold * d, dec = N.dec * d, rel = N.rel * d;
    Object.assign(p, { attack: r3(atk), hold: r3(hold), decay: r3(dec), sustain: 0, release: r3(rel), repeat: N.repeat, rate });
    p.duration = r2(Math.min(2, (N.repeat - 1) / rate + atk + hold + dec + rel + 0.05));
  }
  Object.assign(p, OVERRIDES[name] || {});
  return p;
}
// _vary, the same rule for all 23 (Cat Meow's shape): a little pitch, body, mouth and contour; the rattle's rate and the
// roughness where the call has them, so a take varies the thing that makes it that call.
function varyFor(p) {
  const v = { freq: 0.08, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.03 };
  if (p.crRough >= 0.3) v.crRough = 0.08;
  if (p.crFlutter) v.crFlutterRate = 0.1;
  return v;
}
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");

// ============================================================================================================
// MEASUREMENT (loudness and YIN as tools/proto/new-wings-coil.mjs)
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
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
  if (L.length <= B) ms.push(block(0, L.length));
  else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
  const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
  let g = ms.filter((m) => l(m) > -70);
  if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10;
  g = g.filter((m) => l(m) > rel);
  return l(g.reduce((t, m) => t + m, 0) / g.length);
}
// YIN; every frame above -40 dB of the peak reports its pitch AND its aperiodicity (the dip's depth: 0 a clean
// periodic voice, toward 1 noise or chaos). Pitch statistics use the frames under 0.45 (a rough voice still has one).
function yinTrack(x, fmin, fmax, hop = 0.02, win = 0.04, thr = 0.15) {
  const W = Math.round(win * SR), tauMax = Math.min(W - 2, Math.ceil(SR / fmin)), tauMin = Math.floor(SR / fmax), H = Math.round(hop * SR);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const out = [], d = new Float64Array(tauMax + 1), cm = new Float64Array(tauMax + 1);
  for (let a = 0; a + W + tauMax < x.length; a += H) {
    let e = 0; for (let i = 0; i < W; i++) e += x[a + i] * x[a + i];
    if (Math.sqrt(e / W) < pk * 0.01) { out.push({ t: a / SR, f: 0, ap: 1 }); continue; }
    for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[a + i] - x[a + i + tau]; s += q * q; } d[tau] = s; }
    let run = 0, best = -1; cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = d[tau] * tau / (run || 1e-12); }
    for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < thr) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    if (best < 0) { let m = 1e9; for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; } }
    const a0 = cm[best - 1], b0 = cm[best], c0 = cm[best + 1] ?? b0, den = a0 - 2 * b0 + c0;
    const t = den !== 0 ? best + 0.5 * (a0 - c0) / den : best;
    out.push({ t: a / SR, f: SR / t, ap: b0 });
  }
  return out;
}
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };
// centroid of a span, and its spectral FLATNESS over 300 Hz-8 kHz (geometric / arithmetic mean of the power: ~0.01 a
// clean voice, toward 0.3+ breath and hiss) on the same 128-bin Hann DFT
function centroid(x, a, b, flat) {
  const N = Math.min(2048, b - a); if (N < 256) return 0;
  let num = 0, den = 0, lg = 0, ar = 0, nb = 0;
  for (let k = 1; k < 128; k++) {
    const f = k * 11025 / 128, w = 2 * Math.PI * f / SR; let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)), v = x[a + i] * h; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
    const m = re * re + im * im; num += f * m; den += m;
    if (f >= 300 && f <= 8000) { lg += Math.log(m + 1e-20); ar += m; nb++; }
  }
  if (flat) flat.v = ar > 0 ? Math.exp(lg / nb) / (ar / nb) : 0;
  return den > 0 ? num / den : 0;
}
function render(patch) {
  const p = Object.assign({}, patch); delete p._vary; delete p._alts;
  const r = CS.render(Object.assign({}, CS.DEFAULTS, p), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
function measure(r) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.999 || b >= 0.999) clip++; }
  const mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  const B = Math.round(0.01 * SR); let last = 0, first = -1;
  for (let a = 0; a < n; a += B) { let m = 0; for (let i = a; i < Math.min(n, a + B); i++) m = Math.max(m, Math.abs(mono[i])); if (m > pk * 0.001) { last = a + B; if (first < 0) first = a; } }
  // 20 ms RMS envelope: bursts = peaks at least 8 dB above the dip before them and within 20 dB of the max
  const E = Math.round(0.02 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / E + 1e-12)); }
  const mx = Math.max(...env); let bursts = 0, dip = -200, up = false;
  for (let i = 0; i < env.length; i++) {
    const v = env[i];
    if (!up) { dip = Math.min(dip, v); if (v > dip + 8 && v > mx - 20) { up = true; bursts++; } }
    else if (v < (i > 0 ? Math.max(...env.slice(Math.max(0, i - 5), i)) : v) - 8) { up = false; dip = v; }
  }
  // TEXTURE: the fast level movement a rattle, chaos or shimmer makes (the 5 ms level in dB against its own 100 ms
  // average, the std over the part within 30 dB of the max). A clean held voice reads well under 1 dB, a rattle 3+.
  const E5 = Math.round(0.005 * SR), e5 = [];
  for (let a = 0; a + E5 <= n; a += E5) { let q = 0; for (let i = a; i < a + E5; i++) q += mono[i] * mono[i]; e5.push(10 * Math.log10(q / E5 + 1e-12)); }
  const m5 = Math.max(...e5); let ts = 0, tn = 0;
  for (let i = 10; i < e5.length - 10; i++) {
    if (e5[i] < m5 - 30) continue;
    let av = 0; for (let j = i - 10; j <= i + 10; j++) av += e5[j]; av /= 21;
    ts += (e5[i] - av) ** 2; tn++;
  }
  const texture = tn ? Math.sqrt(ts / tn) : 0;
  const tr = yinTrack(mono, 35, 2600), act = tr.filter((p) => p.f > 0), v = act.filter((p) => p.ap < 0.45);
  // octave continuity: YIN on a period-doubled voice flips between f and f/2 frame to frame. Fold each frame to the
  // octave nearest its neighbor, walking out both ways from the frame nearest the median, so a contour is a contour.
  if (v.length > 2) {
    const md = median(v.map((p) => p.f)); let c = 0, best = 1e9;
    v.forEach((p, i) => { const e = Math.abs(Math.log2(p.f / md)); if (e < best) { best = e; c = i; } });
    const fold = (f, ref) => { while (f / ref > 1.5) f /= 2; while (ref / f > 1.5) f *= 2; return f; };
    for (let i = c + 1; i < v.length; i++) v[i] = Object.assign({}, v[i], { f: fold(v[i].f, v[i - 1].f) });
    for (let i = c - 1; i >= 0; i--) v[i] = Object.assign({}, v[i], { f: fold(v[i].f, v[i + 1].f) });
  }
  const f0 = { median: median(v.map((p) => p.f)), n: v.length, voiced: v.length / Math.max(1, act.length),
    start: median(v.slice(0, Math.max(1, Math.floor(v.length / 6))).map((p) => p.f)),
    mid: median(v.slice(Math.floor(v.length * 0.42), Math.ceil(v.length * 0.58)).map((p) => p.f)),
    end: median(v.slice(Math.floor(v.length * 5 / 6)).map((p) => p.f)) };
  const ap = median(act.map((p) => p.ap));
  // centroid every 50 ms over the loud part (within 20 dB of the max), energy-weighted
  let cn = 0, cd = 0, fl = 0;
  const step = Math.round(0.05 * SR), fo = {};
  for (let a = 0; a + 2048 < n; a += step) {
    let e = 0; for (let i = a; i < a + 2048; i++) e += mono[i] * mono[i];
    const lv = 10 * Math.log10(e / 2048 + 1e-12); if (lv < mx - 20) continue;
    cn += centroid(mono, a, a + 2048, fo) * e; cd += e; fl += fo.v * e;
  }
  return { sec: n / SR, audible: Math.min(n, last) / SR, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n,
    lufs: lufs(L, R), bursts, f0, ap, cent: cd > 0 ? cn / cd : 0, flat: cd > 0 ? fl / cd : 0, texture, maxAt: env.indexOf(mx) * 0.02 };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return (m.audible - m.onset).toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) +
    " (" + db(m.peak) + ")" + (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + m.dcL.toExponential(1) +
    "\n      f0 " + (isNaN(m.f0.median) ? "  --" : m.f0.median.toFixed(0)) + " Hz (" + [m.f0.start, m.f0.mid, m.f0.end].map((x) => isNaN(x) ? "--" : x.toFixed(0)).join(" > ") +
    "; voiced " + (100 * m.f0.voiced).toFixed(0) + "%)  aperiodicity " + m.ap.toFixed(2) + "  centroid " + (m.cent / 1000).toFixed(2) + "k  flatness " + m.flat.toFixed(3) + "  bursts " + m.bursts + "  max at " + m.maxAt.toFixed(2) + " s";
}
// The feature vector for separation (units chosen so 1 = a clearly audible step):
//   pitch: log2 of the SOURCE pitch, the median of the patch's contour (1 = an octave); contour: the patch's start and end
//     about its peak, in units of 6 semitones. From the patch, not YIN: every sound compared here is the creature engine,
//     whose glottis runs exactly that contour, and YIN flips octaves frame to frame on a period-doubled voice (it read a
//     161 Hz Rabid Bellow as 687 and a 360 Hz howl as both 180 and 592 on two runs of the tables). YIN is still printed.
//   length: log2 of the audible span (1 = twice as long); brightness: log2 of the centroid; roughness: aperiodicity x3;
//   breath: log2 of the spectral flatness / 3; bursts: log2 of the count (capped at 8: past that it is a rattle);
//   rattle: the texture (fast level movement, dB) / 3, capped at 6 dB (a burst's gaps read 20+, and bursts has that).
const shape = (u, a, p, b, pos) => { pos = cl(pos, 0.02, 0.98); const e = (x) => 0.5 - 0.5 * Math.cos(Math.PI * cl(x, 0, 1)); return u < pos ? a + (p - a) * e(u / pos) : p + (b - p) * e((u - pos) / (1 - pos)); };
function srcPitch(p) {
  const pS = p.crPitchStart || 0, pE = p.crPitchEnd || 0, pk = p.crPeak ?? 0.4, st = [];
  for (let i = 0; i <= 40; i++) st.push(shape(i / 40, pS, 0, pE, pk));
  return { f: p.freq * Math.pow(2, median(st) / 12), pS, pE };
}
function features(m, p) {
  const sp = srcPitch(p);
  return [Math.log2(sp.f), sp.pS / 6, sp.pE / 6, Math.log2(Math.max(0.05, m.audible - m.onset)), Math.log2(Math.max(100, m.cent)), 3 * m.ap,
    Math.log2(Math.max(1e-3, m.flat)) / 3, Math.log2(cl(m.bursts, 1, 8)), Math.min(m.texture, 6) / 3];
}
const FEAT = ["pitch", "start", "end", "length", "bright", "rough", "breath", "bursts", "rattle"];
// the formant takes have no creature contour: their pitch is freq swept by `sweep` (2^(4 sweep) over the sound)
function nowFeatures(m, p) {
  const sw = (p.sweep || 0) * 48;
  return [Math.log2(p.freq * Math.pow(2, sw / 24)), -Math.max(0, sw) / 6, Math.min(0, sw) / 6, Math.log2(Math.max(0.05, m.audible - m.onset)), Math.log2(Math.max(100, m.cent)), 3 * m.ap,
    Math.log2(Math.max(1e-3, m.flat)) / 3, Math.log2(cl(m.bursts, 1, 8)), Math.min(m.texture, 6) / 3];
}
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); }
function why(a, b) {   // the axes that DO separate a pair, largest first
  return FEAT.map((k, i) => [k, Math.abs(a[i] - b[i])]).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => k + " " + v.toFixed(2)).join(", ");
}

// ---- the reference: every creature patch (base and alts) shipped before this round
function refPatches() {
  const out = [];
  for (const nm of ["Cat Meow", "Cow Moo", "Dog Bark", "Wolf Howl", "Monster Growl"]) {
    const p = PRESETS[nm], base = Object.assign({}, p); delete base._vary; delete base._alts;
    out.push([nm, base]);
    (p._alts || []).forEach((a, k) => out.push([nm + " alt" + (k + 1), a]));
  }
  return out;
}

// ============================================================================================================
const arg = process.argv[2];
if (arg === "try") {
  console.log(fmt(measure(render(JSON.parse(process.argv[3])))));
  process.exit(0);
}
const refs = refPatches().map(([n, p]) => { const m = measure(render(p)); return { n, m, f: features(m, p) }; });
const TARGET = median(refs.map((r) => r.m.lufs));
if (arg === "ref") {
  for (const r of refs) console.log(r.n.padEnd(20) + fmt(r.m));
  console.log("MEDIAN " + TARGET.toFixed(1) + " LUFS (" + refs.length + " patches)");
  process.exit(0);
}
console.log("level target: the creature median " + TARGET.toFixed(1) + " LUFS over " + refs.length + " patches");

const wavDir = join(ROOT, "soundtests", "creature-redo", "family"), jsonDir = join(ROOT, "tools", "new-presets");
mkdirSync(wavDir, { recursive: true }); mkdirSync(jsonDir, { recursive: true });
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));

const rows = [], json = {};
for (const name of NAMES) {
  const s = slug(name);
  if (arg && arg !== s) continue;
  // the current preset, as the app plays it
  const nowR = render(PRESETS[name]), nowM = measure(nowR);
  wav(s + "-1-now.wav", nowR, name + " (now)");
  // the new one: compose, then trim the level to the target (Normalize fixes the peak at 0.9 x gain, so the loudness
  // scales exactly with gain; the trim is capped at gain 1, i.e. peak 0.9)
  const p = compose(name);
  p.gain = 0.7;
  let m = measure(render(p));
  p.gain = r2(cl(0.7 * Math.pow(10, (TARGET - m.lufs) / 20), 0.1, 1));
  const r = render(p); m = measure(r);
  wav(s + "-2-new.wav", r, name);
  const entry = Object.assign({}, p, { _vary: varyFor(p) });
  json[name] = entry;
  rows.push({ name, slug: s, p, r, m, f: features(m, p), nowM, nowF: nowFeatures(nowM, PRESETS[name]) });
  console.log(name.padEnd(17) + "NEW " + fmt(m) + "\n      vs target " + (m.lufs - TARGET >= 0 ? "+" : "") + (m.lufs - TARGET).toFixed(1) + " dB, gain " + p.gain +
    "\n  " + "".padEnd(15) + "NOW " + fmt(nowM).replace(/\n/g, "\n    "));
}
if (arg) process.exit(0);

// ---- separation
const pairs = (list, key) => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i].name, list[j].name, dist(list[i][key], list[j][key]), list[i][key], list[j][key]]); return out.sort((a, b) => a[2] - b[2]); };
const pn = pairs(rows, "f"), po = pairs(rows, "nowF");
console.log("\nSEPARATION (feature distance; 1 = about an octave, a doubling of length, or a clear roughness step)");
console.log("  closest NEW pairs:");
for (const [a, b, d, fa, fb] of pn.slice(0, 10)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  NEW median pair distance " + median(pn.map((x) => x[2])).toFixed(2) + ", min " + pn[0][2].toFixed(2));
console.log("  NOW (formant) median pair distance " + median(po.map((x) => x[2])).toFixed(2) + ", min " + po[0][2].toFixed(2) + "; closest NOW pairs: " +
  po.slice(0, 4).map(([a, b, d]) => a + "/" + b + " " + d.toFixed(2)).join(", "));
console.log("  each existing creature preset's nearest new one:");
for (const rf of refs) {
  const best = rows.map((x) => [x.name, dist(x.f, rf.f), x.f]).sort((a, b) => a[1] - b[1])[0];
  console.log("    " + rf.n.padEnd(20) + best[1].toFixed(2) + "  " + best[0] + "   (" + why(best[2], rf.f) + ")");
}
console.log("\n  name              freq size rough  YIN f0 (start>mid>end)    len  cent   ap  flat  ratl bursts  LUFS  gain");
for (const x of rows) console.log("  " + x.name.padEnd(17) + String(x.p.freq).padStart(5) + String(x.p.crSize).padStart(5) + String(x.p.crRough).padStart(6) +
  (isNaN(x.m.f0.median) ? "     --" : x.m.f0.median.toFixed(0).padStart(7)) + " (" + [x.m.f0.start, x.m.f0.mid, x.m.f0.end].map((q) => isNaN(q) ? "--" : q.toFixed(0)).join(">").padEnd(13) + ")" +
  (x.m.audible - x.m.onset).toFixed(2).padStart(6) + (x.m.cent / 1000).toFixed(2).padStart(6) + x.m.ap.toFixed(2).padStart(6) + x.m.flat.toFixed(2).padStart(6) + x.m.texture.toFixed(1).padStart(6) + String(x.m.bursts).padStart(6) + x.m.lufs.toFixed(1).padStart(7) + String(x.p.gain).padStart(6));
// the pairs the brief names, and each same-noun pair
const all = rows.map((x) => ({ name: x.name, f: x.f })).concat(refs.map((r) => ({ name: r.n, f: r.f })));
const F = (n) => all.find((x) => x.name === n).f;
console.log("\n  named pairs:");
for (const [a, b] of [["Feral Howl", "Giant Howl"], ["Tiny Gnash", "Feral Gnash"], ["Feral Howl", "Wolf Howl"], ["Giant Howl", "Wolf Howl"], ["Giant Howl", "Cow Moo"],
  ["Rabid Snarl", "Dog Bark"], ["Feral Gnash", "Dog Bark"], ["Guttural Growl", "Monster Growl"], ["Guttural Growl", "Monster Growl alt1"], ["Giant Growl", "Monster Growl alt1"],
  ["Angry Growl", "Monster Growl"], ["Tiny Bellow", "Cat Meow"], ["Ancient Squeal", "Cat Meow"]])
  console.log("    " + dist(F(a), F(b)).toFixed(2) + "  " + a + " / " + b + "   (" + why(F(a), F(b)) + ")");
console.log("  same-noun pairs, closest first:");
for (const [a, b, d, fa, fb] of pn.filter(([a, b]) => a.split(" ")[1] === b.split(" ")[1]).slice(0, 8)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  ranges: audible " + Math.min(...rows.map((x) => x.m.audible - x.m.onset)).toFixed(2) + "-" + Math.max(...rows.map((x) => x.m.audible - x.m.onset)).toFixed(2) +
  " s, LUFS " + Math.min(...rows.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...rows.map((x) => x.m.lufs)).toFixed(1) +
  ", f0 " + Math.min(...rows.map((x) => x.m.f0.median || 1e9)).toFixed(0) + "-" + Math.max(...rows.map((x) => x.m.f0.median || 0)).toFixed(0) + " Hz");

// ---- the JSON and the listen-through
writeFileSync(join(jsonDir, "creature-redo-family.json"), JSON.stringify(json, null, 2) + "\n");
const sorted = rows.slice().sort((a, b) => a.name.localeCompare(b.name)), gap = Math.round(0.4 * SR);
let total = 0; for (const x of sorted) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
sorted.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Creature family, all new");
writeFileSync(join(wavDir, "KEY.md"), "# all-new.wav — the 23 new creature-family presets, name order, 0.4 s apart\n\n```\n" + key.join("\n") + "\n```\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, creature-redo-family.json");
