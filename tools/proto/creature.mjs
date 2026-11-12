/* creature.mjs — PROTOTYPE of a "creature voice" engine for CrunchySFX, and the CLI that renders its listening round.
 *
 *   node tools/proto/creature.mjs            renders every sound into soundtests/proto-creature/<sound>/
 *   node tools/proto/creature.mjs cat-meow   one sound
 *
 * WHY. 38 of the 51 "Animal / Monster" presets are the `formant` engine (wave 13): a perfectly periodic band-limited
 * saw through three vowel bandpasses holding ONE vowel, with a sine wobble and a one-way pitch sweep. An animal call
 * is a TRAJECTORY instead — a meow is the mouth opening then closing while the pitch rises then falls; a moo is a
 * closed nasal hum opening into "oo" — and its source is a larynx, not an oscillator: the period jitters, the
 * amplitude shimmers, rough calls go subharmonic, period-double and then chaotic, and there is breath in all of it.
 *
 * SIGNAL FLOW (one shot = one call):
 *   call shape u in 0..1  ->  pitch contour (start / peak / end, semitones about `freq`, peak at crPeak)
 *                         ->  mouth openness (start / peak / end) and vowel frontness (start -> end)
 *   GLOTTIS  Rosenberg flow-derivative pulse, the closure step polyBLEP-corrected (band-limited at a cat's 1 kHz),
 *            per-PERIOD jitter + shimmer, roughness (period-2 alternation -> period doubling -> logistic-map chaos),
 *            tension = open quotient + source tilt, aspiration noise gated by the open phase
 *   TRACT    Klatt-style CASCADE: nasal pole/zero pair (cancels exactly when the nose is shut) then 5 formant
 *            resonators whose frequencies follow (openness, frontness) / body size; closing the mouth widens the
 *            upper bandwidths, lowers the level and closes a lip low-pass — so "m" is a muffled nasal hum
 *   then a flutter AM (the rattle of a growl / the "rr" of a trill), a DC blocker. Mono.
 *
 * PORT SHAPE. makeCreature(sr, cfg, seed) returns { tick(u, f, env) } like makeBrass's tick(p, f): synth.js would call
 * it per sample with u = the position in the shot's call, f = its fOsc (so `freq`, `sweep` and vibrato already apply)
 * and env = ampEnvAt(lt). creatureCfg(st) maps the knobs (proposed PARAMS rows in CREATURE_PARAMS) to physics, like
 * brassCfg. renderCreature(sr, st, seed) is that loop written out for the prototype. No DOM, no Math.random.
 *
 * THE ROUND. Each sound gets the CURRENT preset as a control (the exported engine in a node vm, exactly as
 * tools/make-ab.mjs renders) and three model takes that differ in INTERPRETATION. The model's mono output is fed back
 * through the REAL SFX chain as an imported sample (wave 9, freq 440 = native speed, drive 0, filter open, the
 * control's reverb — none for all five), so both sides share the master stage, fade and normalization. Loudness
 * matched to -18 LUFS, shuffled with a fixed seed. Writes take-*.wav, LISTEN.md, KEY.md, and prints measurements.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------------------------------------------
// THE MODEL (portable: pure functions of their arguments)
// ---------------------------------------------------------------------------------------------------------------

// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group]. Every default is the neutral reading
// (no contour, mouth half open, no nose, clean voice), and only wave "creature" reads the group, so no preset moves.
export const CREATURE_PARAMS = [
  ["crSize",       "Body size",       0.3, 3,   0.01, 1,    "x",  "Creature"],   // tract length: 0.4 cat, 1 human, 2 cow
  ["crPitchStart", "Pitch start",     -24, 24,  0.1,  0,    "st", "Creature"],   // about `freq`, which is the peak
  ["crPitchEnd",   "Pitch end",       -24, 24,  0.1,  0,    "st", "Creature"],
  ["crPeak",       "Peak at",         0,   1,   0.01, 0.4,  "",   "Creature"],   // where pitch and mouth peak in the call
  ["crOpenStart",  "Mouth start",     0,   1,   0.01, 0.5,  "",   "Creature"],
  ["crOpenPeak",   "Mouth peak",      0,   1,   0.01, 0.5,  "",   "Creature"],
  ["crOpenEnd",    "Mouth end",       0,   1,   0.01, 0.5,  "",   "Creature"],
  ["crVowelStart", "Vowel start",     0,   1,   0.01, 0.5,  "",   "Creature"],   // 0 front "ee" .. 1 back/rounded "oo"
  ["crVowelEnd",   "Vowel end",       0,   1,   0.01, 0.5,  "",   "Creature"],
  ["crNasal",      "Nasal",           0,   1,   0.01, 0,    "",   "Creature"],   // nose open where the mouth is shut
  ["crTension",    "Tension",         0,   1,   0.01, 0.5,  "",   "Creature"],   // soft/breathy .. pressed/buzzy
  ["crJitter",     "Jitter",          0,   1,   0.01, 0,    "",   "Creature"],   // per-period pitch wander
  ["crShimmer",    "Shimmer",         0,   1,   0.01, 0,    "",   "Creature"],   // per-period level wander
  ["crRough",      "Roughness",       0,   1,   0.01, 0,    "",   "Creature"],   // subharmonic -> doubled -> chaotic
  ["crBreath",     "Breath",          0,   1,   0.01, 0,    "",   "Creature"],
  ["crFlutter",    "Rattle",          0,   1,   0.01, 0,    "",   "Creature"],   // AM depth: growl rattle, trilled "rr"
  ["crFlutterRate","Rattle rate",     2,   60,  0.1,  20,   "Hz", "Creature"],
  ["crGap",        "Gap",             0,   0.9, 0.01, 0,    "",   "Creature"],   // silent share of each shot (barks)
];
export const CREATURE_DEFAULTS = Object.fromEntries(CREATURE_PARAMS.map((p) => [p[0], p[5]]));

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
// start -> peak (at pos) -> end, raised-cosine segments: no corner in pitch or mouth.
function shape3(u, a, p, b, pos) {
  pos = clamp(pos, 0.02, 0.98);
  return u < pos ? a + (p - a) * ease(u / pos) : p + (b - p) * ease((u - pos) / (1 - pos));
}
function polyBlep(t, dt) {   // as dsp.js's
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// knobs -> physics (like brassCfg)
export function creatureCfg(st) {
  const g = (k) => (st[k] == null ? CREATURE_DEFAULTS[k] : st[k]);
  return {
    fScale: 1 / clamp(g("crSize"), 0.2, 4),
    pS: g("crPitchStart"), pE: g("crPitchEnd"), peak: g("crPeak"),
    oS: g("crOpenStart"), oP: g("crOpenPeak"), oE: g("crOpenEnd"),
    vS: g("crVowelStart"), vE: g("crVowelEnd"),
    nasal: g("crNasal"), tension: g("crTension"),
    jitter: g("crJitter"), shimmer: g("crShimmer"), rough: g("crRough"), breath: g("crBreath"),
    flutter: g("crFlutter"), flutterRate: g("crFlutterRate"), gap: g("crGap"),
  };
}

// One voice (one shot). tick(u, f, env): u = position in the call 0..1 (>= 1 is silence), f = base pitch in Hz at
// this sample (fOsc), env = the amp envelope. Returns one mono sample, roughly unit scale before normalization.
export function makeCreature(sr, cfg, seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };   // 0..1
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;                                             // ~N(0, 1)
  const sub = clamp(cfg.rough * 2, 0, 1), chaos = clamp(cfg.rough * 2 - 1, 0, 1);
  const oqBase = 0.8 - 0.45 * cfg.tension;                       // open quotient: soft 0.8 .. pressed 0.35
  const SQ = 2.4;                                                // speed quotient (opening / closing)
  const tiltA = Math.exp(-2 * Math.PI * (1200 + 9000 * cfg.tension * cfg.tension) / sr);   // source tilt one-pole
  // glottal period state
  let ph = 0, k = 0, logi = 0.31 + 0.4 * rnd(), perScale = 1, ampScale = 1, oq = oqBase;
  const newPeriod = () => {
    k++;
    logi = 3.97 * logi * (1 - logi); if (logi <= 0 || logi >= 1) logi = 0.37;
    const m = (k & 1 ? 1 : -1) * (1 - chaos) + (2 * logi - 1) * chaos;      // period-2 alternation -> chaos
    perScale = 1 + m * (0.035 * sub + 0.2 * chaos) + gauss() * cfg.jitter * 0.045;
    perScale = clamp(perScale, 0.6, 1.6);
    ampScale = Math.max(0.05, (1 + m * (0.5 * sub + 0.4 * chaos)) * (1 + gauss() * cfg.shimmer * 0.3));
    oq = clamp(oqBase + gauss() * 0.08 * chaos, 0.25, 0.88);
  };
  newPeriod();
  // source filters
  let tilt = 0, nHp = 0, nPrev = 0;
  // cascade: nasal pole + nasal zero + 5 formants (Klatt 1980 resonator: y = A x + B y1 + C y2, unity DC gain)
  const NF = 24, NR = NF + 2, y1 = new Float64Array(NR), y2 = new Float64Array(NR);
  let zx1 = 0, zx2 = 0, lip = 0, dcx = 0, dcy = 0, flPh = 0;
  const res = (i, x, F, BW) => {
    const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr), A = 1 - B - C;
    const y = A * x + B * y1[i] + C * y2[i]; y2[i] = y1[i]; y1[i] = y; return y;
  };
  const anti = (x, F, BW) => {             // antiresonator: the inverse of a resonator (FIR)
    const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr), A = 1 - B - C;
    const y = (x - B * zx1 - C * zx2) / A; zx2 = zx1; zx1 = x; return y;
  };
  const NYQ = 0.45 * sr, FTOP = 0.95 * NYQ, fs = cfg.fScale, bwS = Math.sqrt(fs);
  let folV = 0; const folA = 1 - Math.exp(-1 / (0.015 * sr));
  return {
    tick(u, f, env) {
      const live = u < 1;
      const uu = clamp(u, 0, 1);
      // ---- the call's trajectories
      const semis = shape3(uu, cfg.pS, 0, cfg.pE, cfg.peak);
      const open = clamp(shape3(uu, cfg.oS, cfg.oP, cfg.oE, cfg.peak), 0, 1);
      const back = clamp(cfg.vS + (cfg.vE - cfg.vS) * ease(uu), 0, 1);
      const f0 = Math.max(20, f * Math.pow(2, semis / 12));
      // ---- glottis
      const dt = Math.min(0.45, f0 / (sr * perScale));
      ph += dt;
      if (ph >= 1) { ph -= 1; newPeriod(); }
      const Tp = oq * SQ / (1 + SQ), Tn = oq / (1 + SQ);
      let g = 0;
      if (ph < Tp) g = (Tn / Tp) * Math.sin(Math.PI * ph / Tp);
      else if (ph < oq) g = -Math.sin(Math.PI * (ph - Tp) / (2 * Tn));
      let tr = ph - oq; if (tr < 0) tr += 1;
      g += 0.5 * polyBlep(tr, dt);                       // the closure: a +1 step, band-limited
      g *= ampScale;
      tilt = (1 - tiltA) * g + tiltA * tilt;
      const voiced = 0.35 * g + 0.65 * tilt * 2.2;       // keep some top, lose some with a soft voice
      const nz = rnd() * 2 - 1;
      nHp = nz - nPrev; nPrev = nz;                       // aspiration: first-difference (bright) noise
      const gate = ph < oq ? 1 : 0.35;                   // turbulence rides the open phase
      const asp = nHp * cfg.breath * (0.25 + 0.6 * gate) * (0.6 + 0.4 * ampScale);
      let x = (voiced + asp) * (live ? 1 : 0);
      // ---- tract targets (Hz, then body size)
      const F1 = (260 + 560 * open - 40 * back) * fs;
      const F2 = ((2250 - 450 * open) * (1 - back) + (780 + 420 * open) * back) * fs;
      const F3 = (2950 - 450 * back - 150 * open) * fs;
      const shut = 1 - open, wide = 1 + 2 * shut * shut;
      const bfl = 0.11 * f0;                              // high f0: a single harmonic must not ring alone
      const nas = clamp(cfg.nasal * Math.pow(shut, 1.3) * 1.4, 0, 1);
      const FNP = 270 * fs;
      x = res(0, x, Math.min(FNP, NYQ), Math.max(100 * bwS, bfl));
      x = anti(x, Math.min(FNP * (1 + 1.6 * nas), NYQ), Math.max(100 * bwS, bfl) * (1 + nas));
      // F1-F3 articulate; above them the tract keeps its neutral resonances every ~1000*fs Hz up to the band edge. A fixed
      // five would leave a cow or a monster with nothing above 2 kHz — a big animal has MORE formants, not fewer.
      let y = x, prevF = 0;
      for (let i = 0; i < NF; i++) {
        let Fi = i === 0 ? F1 : i === 1 ? F2 : i === 2 ? F3 : (3600 + 1000 * (i - 3)) * fs;
        Fi = Math.max(Fi, prevF + 150 * fs); prevF = Fi;
        if (Fi >= FTOP) break;                             // a tiny animal's top formants leave the band
        const Bi = i === 0 ? 70 : (i === 1 ? 90 : i === 2 ? 130 : 200 + 60 * (i - 3)) * wide;
        y = res(1 + i, y, Fi, Math.max(Bi * bwS, bfl));
      }
      // Klatt's PARALLEL branch for turbulence: aspiration also excites the upper tract directly, at a level stated
      // against the voice (a follower on the cascade), so `breath` is a ratio: a hiss on top of a big, dark voice
      // instead of noise filtered down to nothing by low formants that have 40 dB more gain than the top of the tract.
      folV += (Math.abs(y) - folV) * folA;
      if (cfg.breath > 0) { const Fa = Math.min(Math.max(F3, 1800), FTOP); y += res(NF + 1, nHp * (0.35 + 0.65 * gate) * (live ? 1 : 0), Fa, 0.8 * Fa) * cfg.breath * 3.5 * folV; }
      // ---- the lips: level and a low-pass both close with the mouth; the nose keeps a hum alive when it is shut
      const lipFc = Math.min(NYQ, (1000 + 9000 * Math.pow(open, 0.8)) * Math.sqrt(fs));
      const la = Math.exp(-2 * Math.PI * lipFc / sr);
      lip = (1 - la) * y + la * lip;
      const lvl = Math.max(0.1 + 0.9 * Math.pow(open, 0.7), 0.6 * nas);
      let out = lip * lvl * env;
      // ---- rattle (growl flutter / trilled r), with a wandering rate so it is not a tremolo
      if (cfg.flutter > 0) {
        flPh += cfg.flutterRate * (1 + 0.25 * gauss()) / sr; if (flPh >= 1) flPh -= 1;
        out *= 1 - cfg.flutter * (0.5 + 0.5 * Math.sin(2 * Math.PI * flPh));
      }
      const dc = out - dcx + 0.9975 * dcy; dcx = out; dcy = dc;
      return dc;
    },
  };
}

// The synth.js loop, written out: shots (repeat/rate), the ADSR as `env`, freq/sweep/vibrato as `f`, one fresh voice
// per shot (a burst re-calls), a small per-shot variation (a second bark is never the first one again). Mono.
export function renderCreature(sr, st, seed) {
  const n = Math.max(1, Math.floor(st.duration * sr)), out = new Float32Array(n);
  const repeat = Math.max(1, Math.round(st.repeat || 1)), rate = Math.max(0.5, st.rate || 10);
  const slot = repeat > 1 ? 1 / rate : st.duration;
  const base = creatureCfg(st);
  const callLen = slot * (1 - clamp(base.gap, 0, 0.9));
  const atk = st.attack ?? 0.005, rel = st.release ?? 0.1;
  let shot = -1, v = null, vib = 0, shotSemi = 0;
  let s2 = (seed ^ 0x9e3779b9) >>> 0;
  const r2 = () => { s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0; return s2 / 4294967296 - 0.5; };
  for (let i = 0; i < n; i++) {
    const t = i / sr, idx = Math.floor(t / slot), lt = t - idx * slot;
    if (idx !== shot) {
      shot = idx;
      const cfg = Object.assign({}, base);
      if (idx > 0) {                                   // the next call in a burst: a touch lower, a little different
        shotSemi = r2() * 2 * (0.4 + base.jitter) - 0.6 * idx;
        cfg.oP = clamp(base.oP * (1 + r2() * 0.2), 0, 1);
      } else shotSemi = 0;
      v = makeCreature(sr, cfg, (seed + idx * 7919) >>> 0);
    }
    const u = lt / callLen;
    // envelope over the CALL (not the slot): attack, hold at 1, release ending where the call ends
    let env = 0;
    if (lt < callLen) env = Math.min(1, lt / Math.max(1e-4, atk)) * Math.min(1, (callLen - lt) / Math.max(1e-4, rel));
    vib += 2 * Math.PI * (st.vibRate || 0) / sr;
    const prog = Math.min(1, lt / slot);                // synth.js: sweep over the shot, vibrato in half-octaves
    const f = st.freq * Math.pow(2, (st.sweep || 0) * 4 * prog + (st.vibDepth || 0) * Math.sin(vib) * 0.5 + shotSemi / 12);
    out[i] = v.tick(u, f, env);
  }
  return out;
}

// Autocorrelation pitch track (for verification). Returns [{t, f0, clarity}] every `hop` s.
export function pitchTrack(x, sr, fmin, fmax, hop = 0.05, win = 0.04) {
  const W = Math.round(win * sr), lo = Math.floor(sr / fmax), hi = Math.ceil(sr / fmin), res = [];
  for (let a = 0; a + W + hi < x.length; a += Math.round(hop * sr)) {
    let e0 = 0; for (let i = 0; i < W; i++) e0 += x[a + i] * x[a + i];
    if (e0 < 1e-6 * W) { res.push({ t: a / sr, f0: 0, clarity: 0 }); continue; }
    let best = -1, bl = lo; const ac = new Float64Array(hi + 2);
    for (let L = lo; L <= hi + 1; L++) {
      let sxy = 0, e1 = 0; for (let i = 0; i < W; i++) { sxy += x[a + i] * x[a + i + L]; e1 += x[a + i + L] * x[a + i + L]; }
      ac[L] = sxy / Math.sqrt(e0 * e1 + 1e-12);
    }
    for (let L = lo + 1; L <= hi; L++) if (ac[L] > best) { best = ac[L]; bl = L; }
    // prefer the shortest lag within 0.9 of the best (avoid octave-down picks on clean voices)
    for (let L = lo + 1; L <= hi; L++) if (ac[L] > 0.9 * best && ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1]) { bl = L; break; }
    const A = ac[bl - 1], B = ac[bl], C = ac[bl + 1], den = A - 2 * B + C, d = den ? clamp((A - C) / (2 * den), -1, 1) : 0;
    res.push({ t: a / sr, f0: sr / (bl + d), clarity: ac[bl] });
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
// THE ROUND (CLI)
// ---------------------------------------------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) runCli();

function runCli() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const TARGET_LUFS = -18;
  const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
    Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
  ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx), SR = CS.SR;
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  const PRESETS = pctx.window.PRESETS;
  const preset = (n) => { const o = Object.assign({}, PRESETS[n]); delete o._vary; return o; };

  // a model take: the creature patch, rendered mono, then through the real SFX chain as an imported sample
  const cr = (o) => Object.assign({ attack: 0.02, release: 0.12, duration: 1 }, o);
  const ROUNDS = {
    "cat-meow": {
      title: "Cat Meow", control: "Cat Meow", fmin: 250, fmax: 1600,
      listen: "A house cat meowing. Which one is a CAT? Listen for the mouth opening and closing (\"m-YAOW\"), the pitch rising then falling, and whether it sounds like a throat or like an oscillator.",
      takes: [
        { id: "m-yaow", why: "ADULT MEOW: nose-open hum (\"m\") opening wide to \"YA\" at 40% while the pitch climbs 5 semitones to 650 Hz, then closing and rounding to \"ow\" as it falls 7 below. Cat-sized tract (0.45), a little jitter and breath.",
          patch: cr({ freq: 650, crPitchStart: -5, crPitchEnd: -7, crPeak: 0.4, crOpenStart: 0.03, crOpenPeak: 0.95, crOpenEnd: 0.15, crVowelStart: 0.15, crVowelEnd: 0.9, crNasal: 0.8, crSize: 0.45, crTension: 0.6, crJitter: 0.25, crShimmer: 0.2, crRough: 0.04, crBreath: 0.15, attack: 0.03, release: 0.12, duration: 0.85 }) },
        { id: "kitten-mew", why: "KITTEN MEW: high (1 kHz), short (0.4 s), plaintive: the mouth only half opens and stays front (\"mee-ew\"), more breath, a smaller tract.",
          patch: cr({ freq: 1000, crPitchStart: -3, crPitchEnd: -6, crPeak: 0.3, crOpenStart: 0.1, crOpenPeak: 0.6, crOpenEnd: 0.2, crVowelStart: 0.1, crVowelEnd: 0.6, crNasal: 0.5, crSize: 0.33, crTension: 0.7, crJitter: 0.2, crShimmer: 0.15, crBreath: 0.28, attack: 0.02, release: 0.08, duration: 0.42 }) },
        { id: "mrrrow-complaint", why: "DEMANDING \"mrrrROWW\": lower (520 Hz) and longer (1.15 s), the peak late (55%), a rattle at 26 Hz (the trilled \"rr\") and mild subharmonic roughness through it, mouth opening fully and closing to a rounded \"ow\".",
          patch: cr({ freq: 520, crPitchStart: -7, crPitchEnd: -10, crPeak: 0.55, crOpenStart: 0.05, crOpenPeak: 1, crOpenEnd: 0.3, crVowelStart: 0.3, crVowelEnd: 0.95, crNasal: 0.6, crSize: 0.5, crTension: 0.55, crJitter: 0.4, crShimmer: 0.3, crRough: 0.3, crBreath: 0.2, crFlutter: 0.35, crFlutterRate: 26, attack: 0.04, release: 0.15, duration: 1.15 }) },
      ],
    },
    "cow-moo": {
      title: "Cow Moo", control: "Rabid Bellow", controlNote: "no Cow Moo preset exists; the control is \"Rabid Bellow\" (formant, 96 Hz, 0.48 s), the nearest bellow in pitch",
      fmin: 60, fmax: 400,
      listen: "A cow mooing. Which one is a COW? Listen for the closed, humming \"mmm\" at the start opening into \"ooo\", and the pitch dipping as the breath runs out.",
      takes: [
        { id: "mmm-ooo", why: "CLASSIC MOO: a closed nasal hum opening into a rounded \"OOO\" (never fully open), 150 Hz peaking at 35% and sinking 6 semitones, a cow-sized tract (2.0), some roughness and breath. 1.8 s.",
          patch: cr({ freq: 150, crPitchStart: -2, crPitchEnd: -6, crPeak: 0.35, crOpenStart: 0, crOpenPeak: 0.65, crOpenEnd: 0.35, crVowelStart: 0.9, crVowelEnd: 0.95, crNasal: 0.9, crSize: 2.0, crTension: 0.55, crJitter: 0.2, crShimmer: 0.2, crRough: 0.15, crBreath: 0.2, attack: 0.06, release: 0.3, duration: 1.8 }) },
        { id: "bellow", why: "BELLOW: \"mRRAAWWW\": lower (110 Hz), mouth opening WIDE early (25%) from an \"aa\" toward \"oo\", period-doubled roughness (0.45) and more breath, a shorter (brighter) tract than the other two: an angry or calling cow.",
          patch: cr({ freq: 110, crPitchStart: 0, crPitchEnd: -5, crPeak: 0.25, crOpenStart: 0.1, crOpenPeak: 1, crOpenEnd: 0.5, crVowelStart: 0.5, crVowelEnd: 0.9, crNasal: 0.5, crSize: 1.7, crTension: 0.7, crJitter: 0.3, crShimmer: 0.3, crRough: 0.45, crBreath: 0.3, attack: 0.05, release: 0.3, duration: 1.6 }) },
        { id: "lowing-hum", why: "LOWING: mostly HUM: a long nasal \"mmmmm\" that rises 5 semitones and only half-opens late (60%) before falling 9 below, very little roughness, the largest tract (2.4). A distant, contented moo.",
          patch: cr({ freq: 170, crPitchStart: -5, crPitchEnd: -9, crPeak: 0.6, crOpenStart: 0, crOpenPeak: 0.5, crOpenEnd: 0.1, crVowelStart: 0.85, crVowelEnd: 0.95, crNasal: 1, crSize: 2.4, crTension: 0.45, crJitter: 0.15, crShimmer: 0.15, crRough: 0.1, crBreath: 0.15, attack: 0.1, release: 0.35, duration: 2.0 }) },
      ],
    },
    "dog-bark": {
      title: "Dog Bark", control: "Tiny Snarl", controlNote: "no Dog Bark preset exists; the control is \"Tiny Snarl\" (formant, 308 Hz, 0.24 s), the nearest short single call",
      fmin: 120, fmax: 1100,
      listen: "A dog barking. Which one is a DOG? Listen for the abrupt, noisy attack, the short fall of each bark, and whether the noise sounds like a throat (rough, irregular) or like a filtered buzz.",
      takes: [
        { id: "ruff-ruff", why: "MEDIUM DOG \"RUFF RUFF\": two barks (each ~0.17 s, then silence), 420 Hz falling 7 semitones, near-chaotic source (roughness 0.75) with heavy jitter, shimmer and breath, the mouth snapping open on \"a\" and closing toward \"uh\".",
          patch: cr({ freq: 420, crPitchStart: 2, crPitchEnd: -7, crPeak: 0.2, crOpenStart: 0.3, crOpenPeak: 1, crOpenEnd: 0.2, crVowelStart: 0.4, crVowelEnd: 0.7, crSize: 0.85, crTension: 0.8, crJitter: 0.6, crShimmer: 0.5, crRough: 0.75, crBreath: 0.45, crGap: 0.45, repeat: 2, rate: 3.2, attack: 0.004, release: 0.05, duration: 0.62 }) },
        { id: "yap-yap-yap", why: "SMALL DOG \"YAP YAP YAP\": three short barks at 700 Hz, front vowel (\"yap\"), a small tract (0.55), rough but less chaotic (0.45, period-doubled).",
          patch: cr({ freq: 700, crPitchStart: 0, crPitchEnd: -5, crPeak: 0.25, crOpenStart: 0.4, crOpenPeak: 0.9, crOpenEnd: 0.3, crVowelStart: 0.2, crVowelEnd: 0.3, crSize: 0.55, crTension: 0.75, crJitter: 0.4, crShimmer: 0.4, crRough: 0.45, crBreath: 0.3, crGap: 0.5, repeat: 3, rate: 5.5, attack: 0.003, release: 0.04, duration: 0.55 }) },
        { id: "big-woof", why: "BIG DOG \"WOOF\": one deep bark (260 Hz, a large tract 1.3), rounded back vowel (\"woo\"), the most chaotic source (0.85) and the most breath.",
          patch: cr({ freq: 260, crPitchStart: 1, crPitchEnd: -6, crPeak: 0.2, crOpenStart: 0.2, crOpenPeak: 0.85, crOpenEnd: 0.15, crVowelStart: 0.85, crVowelEnd: 0.95, crSize: 1.3, crTension: 0.8, crJitter: 0.6, crShimmer: 0.5, crRough: 0.85, crBreath: 0.55, crGap: 0.3, attack: 0.004, release: 0.06, duration: 0.42 }) },
      ],
    },
    "monster-growl": {
      title: "Monster Growl", control: "Monster Growl", fmin: 25, fmax: 300,
      listen: "A monster growling. Which one is a big creature's THROAT? Listen for the rattle and break-up of the voice (irregular, not a steady buzz) and for the mouth shaping it.",
      takes: [
        { id: "chaotic-rattle", why: "DEEP RATTLE: 55 Hz, roughness 0.9 (chaotic), heavy jitter, shimmer and breath, an 18 Hz rattle, a huge tract (2.5), the mouth only half open. A held, irregular growl.",
          patch: cr({ freq: 55, crPitchStart: 0, crPitchEnd: -3, crPeak: 0.3, crOpenStart: 0.3, crOpenPeak: 0.6, crOpenEnd: 0.4, crVowelStart: 0.6, crVowelEnd: 0.7, crSize: 2.5, crTension: 0.85, crJitter: 0.6, crShimmer: 0.6, crRough: 0.9, crBreath: 0.5, crFlutter: 0.5, crFlutterRate: 18, attack: 0.08, release: 0.25, duration: 1.3 }) },
        { id: "snarl-roar", why: "SNARL INTO ROAR: \"rraAAWR\": the pitch climbs to 90 Hz and falls, the mouth opens wide at 35% from \"a\" toward \"aw\" (a smaller, brighter tract than take one: teeth bared), period-doubled (0.65) rather than fully chaotic. A growl that has a shape.",
          patch: cr({ freq: 90, crPitchStart: -5, crPitchEnd: -9, crPeak: 0.35, crOpenStart: 0.2, crOpenPeak: 1, crOpenEnd: 0.3, crVowelStart: 0.3, crVowelEnd: 0.8, crSize: 1.4, crTension: 0.8, crJitter: 0.4, crShimmer: 0.4, crRough: 0.65, crBreath: 0.4, attack: 0.05, release: 0.25, duration: 1.2 }) },
        { id: "sub-throat", why: "SUBHARMONIC THROAT: tonal, not noisy: 70 Hz held nearly flat with a slow waver, roughness 0.4 (pure period-2: an octave-down shadow, no chaos), a slow 9 Hz rattle, half nasal, a large tract.",
          patch: cr({ freq: 70, vibDepth: 0.04, vibRate: 5, crPitchStart: -1, crPitchEnd: -2, crPeak: 0.4, crOpenStart: 0.35, crOpenPeak: 0.5, crOpenEnd: 0.35, crVowelStart: 0.5, crVowelEnd: 0.55, crNasal: 0.3, crSize: 2.2, crTension: 0.7, crJitter: 0.2, crShimmer: 0.2, crRough: 0.4, crBreath: 0.25, crFlutter: 0.25, crFlutterRate: 9, attack: 0.08, release: 0.25, duration: 1.3 }) },
      ],
    },
    "wolf-howl": {
      title: "Wolf Howl", control: "Wolf Howl", fmin: 150, fmax: 1200,
      listen: "A wolf howling. Which one is a WOLF? Listen for the slow glide of the pitch, the \"hooOOOooo\" of a rounded mouth opening and closing, and a voice that wavers rather than buzzes.",
      takes: [
        { id: "hooo-ooo", why: "CLASSIC HOWL: \"hoooOOOooo\": 2 s, a slow glide up 6 semitones to 480 Hz at 35% then down 9, the rounded mouth opening at the peak, a slight waver (vibrato 5 Hz), little roughness.",
          patch: cr({ freq: 480, vibDepth: 0.02, vibRate: 5, crPitchStart: -6, crPitchEnd: -9, crPeak: 0.35, crOpenStart: 0.15, crOpenPeak: 0.6, crOpenEnd: 0.25, crVowelStart: 0.95, crVowelEnd: 0.9, crNasal: 0.15, crSize: 0.9, crTension: 0.5, crJitter: 0.15, crShimmer: 0.12, crRough: 0.05, crBreath: 0.15, attack: 0.15, release: 0.45, duration: 2.0 }) },
        { id: "yip-into-howl", why: "YIP INTO HOWL: the call STARTS high (+5 semitones, a yip) and drops into a long, slightly falling held note at 420 Hz; the mouth starts open and slowly rounds. The pitch shape is the inverse of take one.",
          patch: cr({ freq: 420, vibDepth: 0.015, vibRate: 5.5, crPitchStart: 5, crPitchEnd: -3, crPeak: 0.12, crOpenStart: 0.55, crOpenPeak: 0.4, crOpenEnd: 0.2, crVowelStart: 0.6, crVowelEnd: 0.95, crNasal: 0.1, crSize: 0.85, crTension: 0.55, crJitter: 0.15, crShimmer: 0.12, crRough: 0.08, crBreath: 0.18, attack: 0.03, release: 0.45, duration: 2.0 }) },
        { id: "mournful-low", why: "MOURNFUL: lower (360 Hz), the peak late (65%), then a long slide down a full octave as it dies; more breath, jitter and a slower, wider waver: a tired, lonely howl.",
          patch: cr({ freq: 360, vibDepth: 0.035, vibRate: 4.5, crPitchStart: -3, crPitchEnd: -12, crPeak: 0.65, crOpenStart: 0.2, crOpenPeak: 0.7, crOpenEnd: 0.1, crVowelStart: 0.85, crVowelEnd: 0.95, crNasal: 0.1, crSize: 0.95, crTension: 0.45, crJitter: 0.25, crShimmer: 0.2, crRough: 0.06, crBreath: 0.25, attack: 0.12, release: 0.5, duration: 2.0 }) },
      ],
    },
  };

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770: K-weighting, 400 ms blocks, gated)
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
  function matched(r) {
    const L = Float32Array.from(r.L), R = Float32Array.from(r.R);
    let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
    for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
    if (pk > 0.95) gn *= 0.95 / pk;
    for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
    return { L, R, lufs: lufs(L, R), sec: L.length / SR };
  }
  // The control: the preset through the exported engine. A model take: the creature's mono buffer as an imported
  // sample (wave 9 at 440 Hz = native speed), drive off, the filter open, no reverb (the controls are all dry).
  const CARRIER = { wave: 9, freq: 440, sweep: 0, vibDepth: 0, attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 0.005, drive: 0, cutoff: 20000, reso: 0, reverb: 0, width: 0.4 };
  function renderTake(t, round, seed) {
    if (t.control) return { r: CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true }), mono: null };
    const mono = renderCreature(SR, t.patch, seed);
    const r = CS.render(Object.assign({}, CS.DEFAULTS, CARRIER, { duration: mono.length / SR }), { sample: mono, normalize: true });
    return { r, mono };
  }

  // ---- measurements (we cannot listen)
  function measure(L, R, mono, round, patch) {
    let pk = 0, bad = 0, ss = 0;
    for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) bad++; pk = Math.max(pk, a, b); ss += L[i] * L[i]; }
    const rms = Math.sqrt(ss / L.length);
    const n5 = Math.round(0.005 * SR);
    const edge = (a, b) => { let m = 0; for (let i = Math.max(1, a); i < b; i++) m = Math.max(m, Math.abs(L[i] - L[i - 1])); return m; };
    const md = edge(1, L.length);
    const src = mono || L;
    // pitch: the round's wide range for the control; for a model take, the range its patch INTENDS (0.75x its lowest
    // contour point .. 1.35x its highest), so the track says whether the contour is where it was aimed. A rough take
    // also gets the wide track, which shows the period-doubled / subharmonic shadow the roughness is meant to add.
    let lo = round.fmin, hi = round.fmax;
    if (patch && !patch.__control) {
      const sh = (s) => patch.freq * Math.pow(2, s / 12), pts = [sh(patch.crPitchStart || 0), sh(0), sh(patch.crPitchEnd || 0)];
      lo = 0.75 * Math.min(...pts); hi = 1.35 * Math.max(...pts);
    }
    const fmt = (tr) => tr.map((p) => (p.clarity > 0.5 ? Math.round(p.f0) : "~" + Math.round(p.f0))).join(" ");
    const tr = pitchTrack(src, SR, lo, hi, 0.05).filter((p) => p.f0 > 0);
    const wide = patch && !patch.__control && (patch.crRough || 0) >= 0.3 ? fmt(pitchTrack(src, SR, round.fmin, round.fmax, 0.05).filter((p) => p.f0 > 0)) : null;
    // the mouth: spectral centroid every 50 ms (a 2048-point Hann DFT, magnitude-weighted, 100 Hz..10 kHz)
    const cen = [], N = 2048, hop = Math.round(0.05 * SR);
    for (let a = 0; a + N <= src.length; a += hop) {
      let e = 0; for (let i = 0; i < N; i++) e += src[a + i] * src[a + i];
      if (e < 1e-6) { cen.push("-"); continue; }
      let num = 0, den = 0;
      for (let b = 5; b < 465; b += 2) {
        let re = 0, im = 0; const w = 2 * Math.PI * b / N;
        for (let i = 0; i < N; i += 2) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), x = src[a + i] * h; re += x * Math.cos(w * i); im -= x * Math.sin(w * i); }
        const m = Math.hypot(re, im); num += m * b * SR / N; den += m;
      }
      cen.push(Math.round(num / den));
    }
    // share of energy above 1 kHz and above 3 kHz (first difference / second difference proxies are too crude: a DFT)
    let eAll = 0, e1k = 0, e3k = 0;
    for (let a = 0; a + N <= src.length; a += N) {
      for (let b = 1; b < 600; b += 3) {
        let re = 0, im = 0; const w = 2 * Math.PI * b / N;
        for (let i = 0; i < N; i += 1) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), x = src[a + i] * h; re += x * Math.cos(w * i); im -= x * Math.sin(w * i); }
        const m2 = re * re + im * im, hz = b * SR / N; eAll += m2; if (hz > 1000) e1k += m2; if (hz > 3000) e3k += m2;
      }
    }
    return { pk, bad, rms, hi1k: e1k / (eAll || 1), hi3k: e3k / (eAll || 1), first: Math.abs(L[0]), last: Math.abs(L[L.length - 1]), startJump: edge(1, n5), endJump: edge(L.length - n5, L.length), maxJump: md,
      contour: fmt(tr), wide, centroid: cen.join(" "), range: Math.round(lo) + "-" + Math.round(hi),
      clarity: tr.length ? tr.reduce((a, p) => a + p.clarity, 0) / tr.length : 0 };
  }

  function run(name) {
    const round = ROUNDS[name];
    const takes = [{ id: "control", control: true, why: "the CURRENT preset \"" + round.control + "\" (" + (round.controlNote || "the existing preset") + "), the CONTROL, rendered by the exported engine exactly as tools/make-ab.mjs does.", patch: preset(round.control) }].concat(round.takes);
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    // the HIGH bits of the LCG: its low bits cycle, which (as make-ab.mjs draws) put the control first in 4 of 5 rounds
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const out = join(ROOT, "soundtests", "proto-creature", name), key = [];
    mkdirSync(out, { recursive: true });
    console.log(name);
    order.forEach((ti, slot) => {
      const t = takes[ti], { r: raw, mono } = renderTake(t, round, 0xc0ffee + ti * 101);
      const r = matched(raw), file = "take-" + "ABCD"[slot] + ".wav", m = measure(r.L, r.R, mono, round, t.control ? { __control: true } : t.patch);
      writeFileSync(join(out, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      key.push({ file, t, r, m });
      console.log("  " + file + " " + t.id.padEnd(17) + r.sec.toFixed(2) + " s " + r.lufs.toFixed(1) + " LUFS  peak " + m.pk.toFixed(3) + "  NaN " + m.bad +
        "  ends " + m.first.toFixed(4) + "/" + m.last.toFixed(4) + "  jump start/end/max " + m.startJump.toFixed(3) + "/" + m.endJump.toFixed(3) + "/" + m.maxJump.toFixed(3) +
        "  clarity " + m.clarity.toFixed(2) + "  >1k " + (100 * m.hi1k).toFixed(0) + "% >3k " + (100 * m.hi3k).toFixed(1) + "%\n      f0 /50ms in " + m.range + " Hz (~ = clarity < 0.5): " + m.contour +
        (m.wide ? "\n      f0 /50ms, wide range (subharmonic shadow): " + m.wide : "") + "\n      centroid /50ms (Hz): " + m.centroid);
    });
    writeFileSync(join(out, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is the sound the app makes today.\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and say if NONE of them is the animal. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(out, "KEY.md"), "# " + round.title + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
      k.r.sec.toFixed(2) + " s, " + k.r.lufs.toFixed(1) + " LUFS, peak " + k.m.pk.toFixed(3) + ". Pitch every 50 ms (Hz, searched " + k.m.range + "; `~` = an unclear period, i.e. a rough or noisy stretch): " + k.m.contour +
      (k.m.wide ? ". Searched wide, the roughness shows as a subharmonic: " + k.m.wide : "") + ". Spectral centroid every 50 ms (the mouth): " + k.m.centroid + "\n\n```json\n" + JSON.stringify(k.t.patch) + "\n```\n").join("\n"));
  }
  const want = process.argv[2];
  for (const n of want ? [want] : Object.keys(ROUNDS)) { if (!ROUNDS[n]) { console.error("no round " + n + " (" + Object.keys(ROUNDS).join(", ") + ")"); process.exit(1); } run(n); }
}
