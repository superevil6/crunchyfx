/* voice.mjs — PROTOTYPE of a human "voice" (vocal effort) engine for CrunchySFX: grunts, jump and attack cries, battle
 * cries, hurt, death yells, screams, a laugh. And the CLI that renders its blind listening round.
 *
 *   node tools/proto/voice.mjs                render every round into soundtests/proto-voice/<sound>/
 *   node tools/proto/voice.mjs death-yell     one round
 *   node tools/proto/voice.mjs --cost         only the CPU cost: each model take rendered 5x, ms per second of audio
 *
 * WHY. The app has no human character sounds. The creature engine (wave 28) is a larynx and a moving tract at any size,
 * but it holds ONE call shape (start / peak / end) and no consonants; the formant engine (13) holds one vowel; speech (17)
 * speaks words in a level reading voice. A game cry is neither: "hyaaat", "uraaagh", "toriya!", "hup", "oof" are a
 * consonant, a vowel path, a pitch gesture made with EFFORT, and an ending (a glottal stop, a breath out, a creaky "gh").
 * The target is the 16-bit era's voice clip: compressed, crunchy, slightly synthetic. Realism is not the bar; character is.
 *
 * THE MODEL. A cry is a short SCRIPT: an onset, a body (vowels, and consonants between them), a coda; plus a pitch contour,
 * an effort curve, and roughness / breath. A planner turns the script into control tracks (a Klatt-style parameter set,
 * one value per 32 samples); a source-filter loop renders them:
 *   PLANNER   phones with durations (consonants fixed, vowels share the rest by weight: CAPITALS are stressed, ":n" weights),
 *             formant KEYFRAMES (each vowel's targets after a transition, each consonant's locus or its own targets; "h"
 *             takes the next vowel's, which is what an "h" is), amplitude breakpoints per source (voicing AV, aspiration AH,
 *             frication AF) with short ramps, burst events for stops, and the f0 contour over the voiced span with:
 *             effort raising pitch (a shout is ~7 st over speech), vowel intrinsic pitch, the f0 kick after a voiceless stop,
 *             slow drift and effort tremor (two seeded smoothed random walks), an old voice's tremor, and voice BREAKS
 *             (register jumps of 3-7 st for 40-150 ms) when a rough voice pushes hard.
 *   SOURCE    a Rosenberg glottal flow derivative with the closure step polyBLEP-corrected (from creature.mjs), open quotient
 *             0.78 (breathy) .. 0.40 (pressed) by effort, source tilt by effort, per-period jitter and shimmer; ROUGHNESS is
 *             nonlinear: period-2 alternation (a subharmonic an octave down) -> period doubling -> logistic-map chaos, plus
 *             a random (noise-driven, never a sine) amplitude flutter in the 30-150 Hz band that screams occupy; FRY (vocal
 *             creak) pulls the period down to ~45-60 Hz with heavy jitter / shimmer and a short open phase: a hard glottal
 *             attack's first pulses, a "gh" tail, a glottal stop's last one. Aspiration is bright noise riding the open phase.
 *   TRACT     cascade: nasal pole / zero pair, then F1..F5 and the neutral resonances above them up to the band edge (body
 *             scaled), coefficients ramped per sample (creature's lesson: stepped, a cascade turns each step into a click).
 *             Frication and stop bursts go through a PARALLEL true band-pass (a Klatt resonator is a low-pass: an "s" through
 *             it lands under 3 kHz). The lips: a low-pass and a level that close for m / n / b.
 *   AWAY      `voAway`: the voice recedes (a fall: distance ~ t^2): level down 20 dB, the top rolls off, a slight Doppler drop.
 *   CHARACTER `voLofi` 0..1: clean -> a gentle saturation and band limit (a hot, close mic: tanh, high-pass, low-pass)
 *             at 0.5 -> the 16-BIT SAMPLER from 0.5 to 1 (copied from tools/proto/chipgun.mjs, the S-DSP model): mastered hot,
 *             decimated with a 2-tap average only (it aliases) to a storage rate of 16 kHz .. 6.3 kHz, encoded as 4-bit
 *             ADPCM (BRR: 16-sample blocks, shift and one of four predictors per block), played at 32 kHz through the
 *             gaussian interpolator or, from Lo-fi 0.7, drop-sample (stairs), 7-bit voice volume, the hardware echo (`voEcho`:
 *             16 ms steps, an 8-tap FIR on the way back, feedback), held to 44.1 kHz. That is how the era STORED voice clips.
 *
 * CONTROLS (proposed PARAMS rows, VOICE_PARAMS below; only wave "voice" reads them):
 *   Cry type (grunt, hup, battle cry, sword cry, hurt, big hurt, death cry, fall scream, fear scream, laugh, custom),
 *   Voice (man, woman, kid), Age (young .. old), Size, Pitch, Effort, Length, Roughness, Breath, Expression (how far the
 *   pitch gesture goes), Fall away, Lo-fi, Echo, Variation (seed). Effort / Roughness / Breath are centered: 0.5 is the
 *   cry as scripted, 0 none, 1 all the way. "custom" reads the script ingredients: Onset, Body (text: "oo r AH:3",
 *   "y AE", "t oh r EE y AH"), Coda, and a contour (Rise, Fall, Peak at).
 *
 * PORTABLE SHAPE. `makeVoice(sr, cfg, seed)` is a pure factory like dsp.js makeBlast / glass's makeGlass: no DOM, no
 * Math.random (seeded LCGs per concern, so a level knob never reshuffles the drift), SR in. BUFFERED (mono into L and R),
 * returns { L, R, n, info, tick(drive, out) }. `voiceCfg(st)` maps the rows to the planner; `voiceLevel(L, R)` levels a
 * buffer (RMS 0.12 over its loudest 300 ms, peak capped 0.9) like glassLevel. The sampler stage needs a 32 kHz inner rate
 * only; everything else runs at SR.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

export const VOICE_CRIES = ["grunt", "hup", "battle cry", "sword cry", "hurt", "big hurt", "death cry", "fall scream", "fear scream", "laugh", "custom"];   // append-only
export const VOICE_VOICES = ["man", "woman", "kid"];                                                                                                   // append-only
export const VOICE_ONSETS = ["none", "hard (glottal)", "h", "t", "k", "p", "b", "d", "g", "r", "y", "w", "m", "n", "hy", "f", "s"];                    // append-only
export const VOICE_CODAS = ["open", "glottal stop", "breath out (h)", "creak (gh)", "t", "k", "p", "f", "trail off"];                                  // append-only
const VO_ONSET_TOK = ["", "'", "h", "t", "k", "p", "b", "d", "g", "r", "y", "w", "m", "n", "h y", "f", "s"];
const VO_CODA_TOK = ["", "!", "h", "gh", "t", "k", "p", "f", "~"];

// [key, label, min, max, step, default, unit, group, kind?, enumList?]
export const VOICE_PARAMS = [
  ["voCry",     "Cry type",    0,   10,  1,    6,    "",   "Voice", "enum", VOICE_CRIES],
  ["voVoice",   "Voice",       0,   2,   1,    0,    "",   "Voice", "enum", VOICE_VOICES],
  ["voAge",     "Age",         0,   1,   0.01, 0.5,  "",   "Voice"],   // 0 young (teen) .. 0.5 adult .. 1 old (shaky, breathy)
  ["voSize",    "Size",        0.7, 1.5, 0.01, 1,    "x",  "Voice"],   // throat and mouth: >1 bigger (darker, a brute)
  ["voPitch",   "Pitch",       -12, 12,  0.1,  0,    "st", "Voice"],
  ["voEffort",  "Effort",      0,   1,   0.01, 0.5,  "",   "Voice"],   // 0.5 = as scripted; 0 sighed .. 1 pushed to a yell
  ["voLength",  "Length",      0.5, 2,   0.01, 1,    "x",  "Voice"],
  ["voRough",   "Roughness",   0,   1,   0.01, 0.5,  "",   "Voice"],   // 0.5 = as scripted; growl, crack, scream rasp
  ["voBreath",  "Breath",      0,   1,   0.01, 0.5,  "",   "Voice"],   // 0.5 = as scripted
  ["voExpress", "Expression",  0,   2,   0.01, 1,    "x",  "Voice"],   // how far the pitch gesture goes: 2 is cartoonish
  ["voAway",    "Fall away",   0,   1,   0.01, 0,    "",   "Voice"],   // the voice recedes (falling down a pit)
  ["voLofi",    "Lo-fi",       0,   1,   0.01, 0,    "",   "Voice"],   // clean .. warm saturation (0.5) .. 16-bit sampler (1)
  ["voEcho",    "Echo",        0,   1,   0.01, 0,    "",   "Voice"],   // the sampler's hardware echo (Lo-fi > 0.5)
  ["voSeed",    "Variation",   0,   999, 1,    0,    "",   "Voice"],
  ["voStoreFollow", "Store follows pitch", 0, 1, 0.01, 0, "", "Voice"],   // the sampler stores a higher voice at a higher rate (AJ: the 16-bit stage damaged the woman's cry)
  // the script ingredients ("custom" only)
  ["voOnset",   "Onset",       0,   16,  1,    1,    "",   "Voice", "enum", VOICE_ONSETS],
  ["voBody",    "Body",        0,   0,   0,    "AH", "",   "Voice", "text"],   // vowels (CAPS stressed, :n length) and inner consonants
  ["voCoda",    "Coda",        0,   8,   1,    0,    "",   "Voice", "enum", VOICE_CODAS],
  ["voRise",    "Rise",        -12, 24,  0.1,  4,    "st", "Voice"],
  ["voFall",    "Fall",        -24, 12,  0.1,  -4,   "st", "Voice"],
  ["voPeakAt",  "Peak at",     0,   1,   0.01, 0.3,  "",   "Voice"],
];
export const VOICE_DEFAULTS = Object.fromEntries(VOICE_PARAMS.map((p) => [p[0], p[5]]));

// The cries. s: the script; dur: s of the whole cry at Length 1; f0: [u, semitones] over the voiced span (before effort's
// own raise); eff / rough / breath: scalars or [start, peak, end] (peak at the f0 contour's highest point).
export const VOICE_SCRIPTS = [
  { "s": "' UH gh",              "dur": 0.3,  "f0": [[0, 0], [0.18, 2.5], [1, -4]],                         "eff": 0.75,            "rough": 0.3,  "breath": 0.3 },    // grunt (effort, lifting)
  { "s": "h UH p",               "dur": 0.2,  "f0": [[0, -1], [0.5, 3], [1, 4.5]],                          "eff": 0.65,            "rough": 0.05, "breath": 0.3 },    // hup (a jump)
  { "s": "t oh r EE y AH:5 !",   "dur": 0.95, "f0": [[0, 0], [0.18, 1], [0.32, 4], [0.5, 8], [0.85, 9], [1, 6]], "eff": [0.92, 1, 0.95], "rough": 0.2, "breath": 0.15 }, // battle cry
  { "s": "h y AH:4 t",           "dur": 0.42, "f0": [[0, 3], [0.14, 9], [0.65, 7.5], [1, 3.5]],             "eff": [0.85, 1, 0.9],  "rough": 0.12, "breath": 0.25 },   // sword cry
  { "s": "' UH:2 gh",            "dur": 0.32, "f0": [[0, 5], [0.08, 8], [0.45, 3], [1, -3]],                "eff": [1, 0.95, 0.55], "rough": 0.3,  "breath": 0.35 },   // hurt ("ugh")
  { "s": "' AH:4 uh gh",         "dur": 0.62, "f0": [[0, 6], [0.07, 10], [0.45, 6], [1, -4]],               "eff": [1, 1, 0.6],     "rough": 0.42, "breath": 0.3 },    // big hurt ("aaagh")
  { "s": "uu r AH:6 gh",         "dur": 1.0,  "f0": [[0, 0], [0.14, 3], [0.32, 8], [0.62, 5], [1, -7]],     "eff": [0.8, 1, 0.55],  "rough": 0.38, "breath": 0.25 },   // death cry ("uraaagh")
  { "s": "' AH:1 AE:6 ~",        "dur": 1.9,  "f0": [[0, 13], [0.06, 18], [0.3, 16.5], [1, 9]],             "eff": [1, 1, 0.85],    "rough": 0.62, "breath": 0.3, "away": 1 },  // fall scream
  { "s": "' AE:5 h",             "dur": 1.2,  "f0": [[0, 11], [0.08, 18], [0.55, 17], [1, 12]],             "eff": 1,               "rough": 0.72, "breath": 0.3 },    // fear scream
  { "s": "h AH h AH h AH h AH h AH h AH ~", "dur": 1.25, "f0": [[0, 7], [0.2, 6], [1, -1]],                  "eff": [0.7, 0.75, 0.5], "rough": 0.2, "breath": 0.6 },    // laugh
  null,                                                                                                                                                          // custom
];

// adult male vowel targets F1, F2, F3 (Hz), after Hillenbrand et al. 1995; F4 / F5 are neutral.
const VO_VOWELS = {
  "ee": [270, 2290, 3010], "ih": [400, 1990, 2550], "eh": [530, 1840, 2480], "ae": [660, 1720, 2410], "ah": [730, 1090, 2440],
  "aw": [570, 840, 2410], "oh": [500, 910, 2460], "uu": [440, 1020, 2240], "oo": [300, 870, 2240], "uh": [640, 1190, 2390],
  "er": [490, 1350, 1690], "ax": [500, 1450, 2450],
};
const VO_ALIAS = { "a": "ah", "i": "ee", "e": "eh", "o": "oh", "u": "oo" };
// intrinsic pitch: high vowels sit a little higher (semitones)
const VO_IPITCH = { "ee": 0.6, "oo": 0.6, "ih": 0.3, "uu": 0.3, "ah": -0.4, "ae": -0.3, "aw": -0.3 };
// the voices: f0 (Hz, speaking), tract scale, jitter / shimmer / breath bases, the fry rate (Hz)
const VO_KINDS = [
  { "f0": 112, "k": 1.0,  "jit": 0.2,  "shim": 0.2,  "br": 0.15, "fry": 46 },
  { "f0": 205, "k": 1.16, "jit": 0.18, "shim": 0.18, "br": 0.3,  "fry": 62 },
  { "f0": 265, "k": 1.3,  "jit": 0.15, "shim": 0.15, "br": 0.3,  "fry": 75 },
];
const VO_CTL = 32;                 // control rate: targets every 32 samples, coefficients ramped per sample
const VO_NF = 18;                  // formant slots in the cascade (F1..F5 + neutral resonances up to the band edge)
const VO_PRE = 0.012;              // s of silence before the cry
const VO_TAIL = 0.1;               // s after the last phone (the tract rings out)
const VO_ASP = 13;                // aspiration gain into the cascade (calibrated: an "h" at AH 1 ~ -10 dB under an "ah")
const VO_FRIC = 4.4;               // frication gain in the parallel branch (calibrated: an "s" ~ -14 dB under an "ah", an "f" ~ -22)
const VO_SMP_RATE = 32000;         // the sampler's output rate

const voClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const voEase = (x) => 0.5 - 0.5 * Math.cos(Math.PI * voClamp(x, 0, 1));
function voRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const voGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
function voBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// a centered knob: 0 -> none, 0.5 -> the scripted base, 1 -> all the way
const voNudge = (base, knob) => (knob <= 0.5 ? base * knob * 2 : base + (1 - base) * (knob - 0.5) * 2);
// [start, peak, end] or a scalar, at u with the peak at pk
function voShape3(v, u, pk) {
  if (!Array.isArray(v)) return v;
  pk = voClamp(pk, 0.02, 0.98);
  return u < pk ? v[0] + (v[1] - v[0]) * voEase(u / pk) : v[1] + (v[2] - v[1]) * voEase((u - pk) / (1 - pk));
}
// a script value: a scalar, [start, peak, end] (peak at pk), or [[u, v], ...] points (raised-cosine between them)
const voVal = (v, u, pk) => (Array.isArray(v) && Array.isArray(v[0]) ? voCurve(v, u) : voShape3(v, u, pk));
const voMax = (v) => (Array.isArray(v) ? Math.max(...v.map((q) => (Array.isArray(q) ? q[1] : q))) : v);
// piecewise raised-cosine through [u, value] points
function voCurve(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * voEase((u - a[0]) / (b[0] - a[0] || 1)); }
  return pts[pts.length - 1][1];
}

// knobs -> the cry
export function voiceCfg(st) {
  const g = (k) => (st[k] == null ? VOICE_DEFAULTS[k] : st[k]);
  const cry = voClamp(Math.round(g("voCry")), 0, VOICE_CRIES.length - 1);
  // `voScript` (prototype only, not a row): a whole script object, as VOICE_SCRIPTS holds, for a round to try a new cry
  let sc = st["voScript"] || VOICE_SCRIPTS[cry];
  if (!sc) {                       // custom: the ingredients
    const pk = voClamp(g("voPeakAt"), 0.02, 0.98);
    sc = { "s": [VO_ONSET_TOK[voClamp(Math.round(g("voOnset")), 0, 16)], String(g("voBody") || "AH"), VO_CODA_TOK[voClamp(Math.round(g("voCoda")), 0, 8)]].join(" "),
      "dur": 0.5, "f0": [[0, 0], [pk, g("voRise")], [1, g("voRise") + g("voFall")]], "eff": 0.75, "rough": 0.2, "breath": 0.25 };
  }
  return {
    "script": sc, "cry": VOICE_CRIES[cry], "kind": voClamp(Math.round(g("voVoice")), 0, 2), "age": voClamp(g("voAge"), 0, 1),
    "size": voClamp(g("voSize"), 0.6, 1.6), "pitch": g("voPitch"), "effort": voClamp(g("voEffort"), 0, 1), "length": voClamp(g("voLength"), 0.3, 3),
    "rough": voClamp(g("voRough"), 0, 1), "breath": voClamp(g("voBreath"), 0, 1), "express": voClamp(g("voExpress"), 0, 3),
    "away": voClamp(g("voAway") + (sc["away"] || 0), 0, 1),             // a fall scream falls away by itself
    "lofi": voClamp(g("voLofi"), 0, 1), "echo": voClamp(g("voEcho"), 0, 1), "seed": Math.round(g("voSeed")), "storeFollow": voClamp(g("voStoreFollow"), 0, 1),
  };
}

// ---- the planner: script -> phones -> control tracks ---------------------------------------------------------------
function voParse(str) {
  const out = [], toks = String(str).trim().split(/[\s\-]+/).filter(Boolean);
  for (const raw of toks) {
    const m = /^([^:]+)(?::([\d.]+))?$/.exec(raw); if (!m) continue;
    const name = m[1], low = name.toLowerCase(), v = VO_VOWELS[low] ? low : VO_ALIAS[low];
    if (v && !(low === "h" || low === "gh")) {
      const stress = name !== low;
      out.push({ "t": "V", "v": v, "stress": stress, "w": m[2] ? parseFloat(m[2]) : stress ? 2.5 : 1 });
    } else out.push({ "t": "C", "c": low, "w": m[2] ? parseFloat(m[2]) : 1 });   // ":n" on a sonorant holds it n times as long
  }
  // a trailing consonant token is the coda (h, gh, t, k, p, f, s, !, ~); a leading "'" is a hard attack
  let coda = "";
  const last = out[out.length - 1];
  if (last && last["t"] === "C" && ["!", "h", "gh", "t", "k", "p", "f", "s", "~"].includes(last["c"])) { coda = last["c"]; out.pop(); }
  return { "phones": out, "coda": coda };
}

// consonant table: dur (s, at Length 1), AV, AH, AF, fric band, formant targets (male Hz; null = the neighbor vowel's),
// lip (0 closed .. 1 open), nasal, burst {amp, fc, bw} and its aspiration (VOT, s)
const VO_CONS = {
  "h":  { "dur": 0.065, "av": 0, "ah": 1, "F": null, "b1": 2.5 },
  "p":  { "dur": 0.035, "av": 0, "burst": [0.35, 900, 1400], "vot": 0.045, "F": [250, 850, 2200] },
  "t":  { "dur": 0.035, "av": 0, "burst": [0.8, 4600, 3200], "vot": 0.05, "F": [260, 1750, 2650] },
  "k":  { "dur": 0.04,  "av": 0, "burst": [0.75, 0, 1000], "vot": 0.06, "F": null },     // k's burst sits near the vowel's F2
  "b":  { "dur": 0.035, "av": 0.12, "lip": 0.04, "burst": [0.2, 800, 1400], "vot": 0.008, "F": [200, 800, 2200] },
  "d":  { "dur": 0.03,  "av": 0.12, "lip": 0.06, "burst": [0.35, 3800, 2600], "vot": 0.012, "F": [200, 1700, 2600] },
  "g":  { "dur": 0.035, "av": 0.12, "lip": 0.06, "burst": [0.35, 0, 900], "vot": 0.02, "F": null },
  "r":  { "dur": 0.024, "av": 0.35, "F": [330, 1600, 2500], "tap": 1 },
  "rr": { "dur": 0.075, "av": 0.35, "F": [330, 1600, 2500], "tap": 3 },
  "y":  { "dur": 0.05,  "av": 0.85, "F": [260, 2250, 3020] },
  "w":  { "dur": 0.055, "av": 0.8,  "F": [290, 640, 2200], "lip": 0.45 },
  "m":  { "dur": 0.07,  "av": 0.55, "F": [260, 1100, 2250], "lip": 0.05, "nas": 1 },
  "n":  { "dur": 0.065, "av": 0.55, "F": [260, 1600, 2600], "lip": 0.06, "nas": 1 },
  "f":  { "dur": 0.1,   "av": 0, "ah": 0.12, "af": 0.1, "fric": [5200, 7000], "F": null },
  "s":  { "dur": 0.11,  "av": 0, "ah": 0.05, "af": 0.6, "fric": [6300, 2800], "F": null },
  "sh": { "dur": 0.11,  "av": 0, "ah": 0.05, "af": 0.6, "fric": [3300, 2200], "F": null },
};

function voPlan(sr, cfg, seed) {
  const sc = cfg["script"], K = VO_KINDS[cfg["kind"]], age = cfg["age"];
  const rP = voRng(seed ^ 0x68e31da4), rD = voRng(seed ^ 0xb5297a4d), rB = voRng(seed ^ 0x1b56c4e9);
  // ---- the voice
  let f0Base = K["f0"], k = K["k"];
  if (age < 0.5) { const y = (0.5 - age) * 2; f0Base *= 1 + [0.32, 0.08, 0.12][cfg["kind"]] * y; k *= 1 + [0.08, 0.04, 0.08][cfg["kind"]] * y; }
  else { const o = (age - 0.5) * 2; f0Base *= 1 + [0.06, -0.12, 0][cfg["kind"]] * o; }
  const old = Math.max(0, age - 0.5) * 2;
  k /= cfg["size"]; f0Base *= Math.pow(cfg["size"], -0.35);
  f0Base *= Math.pow(2, cfg["pitch"] / 12);
  const vary = (a) => 1 + a * (rP() * 2 - 1);
  // ---- phones and durations
  const { phones, coda } = voParse(sc["s"]);
  const L = cfg["length"], T = sc["dur"] * L * vary(0.07);
  const cdur = (c) => (VO_CONS[c] ? VO_CONS[c]["dur"] + (VO_CONS[c]["vot"] || 0) : 0) * Math.pow(L, 0.4);
  const codaDur = ({ "": 0.07, "!": 0.01, "h": 0.2, "gh": 0.22, "t": 0.11, "k": 0.12, "p": 0.1, "f": 0.13, "s": 0.14, "~": 0.32 }[coda] || 0) * Math.pow(L, 0.6);
  let consT = 0, wsum = 0;
  for (const p of phones) { if (p["t"] === "C") consT += cdur(p["c"]) * (p["w"] || 1); else wsum += p["w"] * vary(0.15); }
  const vowT = Math.max(0.04 * Math.max(1, wsum), T - consT - codaDur * 0.5);
  // ---- tracks at control rate
  // the buffer holds the phones as planned: consonants keep their lengths, so they can outrun the script's own `dur`
  // (a held "n:9"); sized from `T` alone, hurt-3's longer rungs were cut at 0.41 s
  const total = VO_PRE + Math.max(T, consT + vowT) + codaDur + VO_TAIL;
  const n = Math.ceil(total * sr), nc = Math.ceil(n / VO_CTL) + 2, tc = (c) => c * VO_CTL / sr;
  const mk = () => new Float32Array(nc);
  const tr = { "F1": mk(), "F2": mk(), "F3": mk(), "F4": mk(), "F5": mk(), "B1": mk(), "AV": mk(), "AH": mk(), "AF": mk(), "fF": mk(), "fB": mk(),
    "nas": mk(), "lip": mk(), "flut": mk(), "f0": mk(), "oq": mk(), "tilt": mk(), "rough": mk(), "fry": mk(), "eff": mk(), "away": mk(), "jit": mk(), "shim": mk() };
  const kf = [];                          // formant keyframes { t, F:[3], b1, lip, nas }
  const amp = { "AV": [[0, 0]], "AH": [[0, 0]], "AF": [[0, 0]] }, fric = [];   // [t, value] breakpoints; fric bands [t0, t1, fc, bw]
  const bursts = [], fryEv = [];          // { t, amp, fc, bw } ; [t0, t1, depth] creak windows
  const set = (key, t, v, ramp) => { const a = amp[key], prev = a[a.length - 1][1]; a.push([t, prev], [t + ramp, v]); };
  const vF = (v) => VO_VOWELS[v].map((f) => f * vary(0.03));
  let t = VO_PRE, voiceStart = -1, voiceEnd = -1, lastVF = null, firstV = null;
  for (const p of phones) if (p["t"] === "V") { firstV = vF(p["v"]); break; }
  const nextVF = (i) => { for (let j = i + 1; j < phones.length; j++) if (phones[j]["t"] === "V") return VO_VOWELS[phones[j]["v"]]; return lastVF || firstV || VO_VOWELS["ax"]; };
  let hardAttack = false, pendingRamp = 0.012, vIdx = 0;
  const vowels = [];
  phones.forEach((p, i) => {
    if (p["t"] === "V") {
      const d = vowT * p["w"] / wsum, F = vF(p["v"]), tr0 = Math.min(0.04, d / 3);
      if (voiceStart < 0) voiceStart = t;
      // a unity-DC cascade makes a close vowel (low F1) ~9 dB quieter than "ah"; real ones differ by ~5: half made up
      set("AV", t, (p["stress"] ? 1 : 0.82) * voClamp(Math.sqrt(730 / VO_VOWELS[p["v"]][0]), 1, 1.6), hardAttack ? 0.003 : pendingRamp);
      set("AH", t, 0, Math.max(0.01, pendingRamp));
      set("AF", t, 0, 0.01);
      if (hardAttack) { fryEv.push([t, t + 0.035, 0.85]); hardAttack = false; }
      kf.push({ "t": t + tr0, "F": F, "b1": 1, "lip": 1, "nas": 0 }, { "t": t + d - tr0, "F": F, "b1": 1, "lip": 1, "nas": 0 });
      vowels.push({ "t0": t, "t1": t + d, "v": p["v"], "stress": p["stress"] });
      lastVF = F; t += d; voiceEnd = t; vIdx++; pendingRamp = 0.012;
      return;
    }
    const c = p["c"];
    if (c === "'") { if (voiceStart < 0) hardAttack = true; else { set("AV", t - 0.006, 0, 0.006); fryEv.push([t - 0.03, t + 0.03, 0.9]); t += 0.035; hardAttack = true; } return; }
    const C = VO_CONS[c]; if (!C) return;
    const s = Math.pow(L, 0.4), nv = nextVF(i), base = C["F"] || nv;
    const Fl = base.map((f, j) => (C["F"] ? 0.7 * f + 0.3 * nv[j] : f));          // a locus pulls toward the vowel
    if (c === "h") {
      set("AV", t, 0, 0.012); set("AH", t, C["ah"], 0.012);
      // an "h" is the NEXT sound's mouth with breath through it: before a glide that is the glide's ("hy" hisses high)
      const nx = phones[i + 1], nC = nx && nx["t"] === "C" ? VO_CONS[nx["c"]] : null;
      kf.push({ "t": t + 0.01, "F": nC && nC["F"] && !nC["burst"] ? nC["F"] : nv, "b1": C["b1"], "lip": 1, "nas": 0 });
      t += C["dur"] * s * (p["w"] || 1); pendingRamp = 0.022; return;
    }
    if (C["burst"]) {
      const clo = C["dur"] * s * (voiceStart < 0 ? 0.6 : 1);
      set("AV", t, C["av"], 0.008); set("AH", t, 0, 0.006);
      kf.push({ "t": t + 0.005, "F": Fl, "b1": 1.6, "lip": C["lip"] == null ? 1 : C["lip"], "nas": 0 });
      t += clo;
      const fc = C["burst"][1] || Math.max(1300, 1.15 * nv[1]);
      bursts.push({ "t": t, "amp": C["burst"][0], "fc": fc, "bw": C["burst"][2] });
      if (c === "k" || c === "g") bursts.push({ "t": t + 0.009, "amp": C["burst"][0] * 0.45, "fc": fc, "bw": C["burst"][2] });
      const vot = C["vot"] * s;
      if (C["av"] === 0) { set("AV", t, 0, 0.001); set("AH", t + 0.002, 0.75, 0.004); }
      kf.push({ "t": t + 0.002, "F": Fl.map((f, j) => 0.5 * f + 0.5 * nv[j]), "b1": 2, "lip": 1, "nas": 0 });
      t += vot; pendingRamp = C["av"] === 0 ? 0.006 : 0.01;
      if (C["av"] === 0) set("AH", t, 0, 0.008);
      return;
    }
    if (C["fric"]) {
      set("AV", t, 0, 0.015); set("AH", t, C["ah"], 0.015); set("AF", t, C["af"], 0.02);
      fric.push([t, t + C["dur"] * s, C["fric"][0] * (k > 1 ? Math.sqrt(k) : 1), C["fric"][1]]);
      kf.push({ "t": t + C["dur"] * s / 2, "F": nv, "b1": 1.5, "lip": 1, "nas": 0 });
      t += C["dur"] * s; set("AF", t, 0, 0.02); pendingRamp = 0.02; return;
    }
    // sonorants: r (tap / trill), y, w, m, n
    const d = C["dur"] * s * (p["w"] || 1);
    if (C["tap"]) {
      const taps = C["tap"], per = d / taps;
      for (let q = 0; q < taps; q++) {
        const a = t + q * per;
        set("AV", a, C["av"], 0.006); set("AV", a + per * 0.55, 0.85, 0.006);
        kf.push({ "t": a + per * 0.4, "F": C["F"], "b1": 1.3, "lip": 1, "nas": 0 });
      }
    } else {
      set("AV", t, C["av"], 0.015);
      kf.push({ "t": t + d * 0.5, "F": C["F"], "b1": 1, "lip": C["lip"] == null ? 1 : C["lip"], "nas": C["nas"] || 0 });
    }
    if (voiceStart < 0) voiceStart = t;
    t += d; voiceEnd = t; pendingRamp = 0.02;
  });
  if (voiceStart < 0) { voiceStart = VO_PRE; voiceEnd = t; }
  // ---- the coda
  const endF = lastVF || VO_VOWELS["ax"], tEnd = t;
  let fryTail = null, tailFall = 0;
  if (coda === "" ) { set("AV", t - 0.04, 0, 0.07); set("AH", t - 0.04, 0, 0.05); }
  else if (coda === "!") { set("AV", t - 0.006, 0, 0.006); set("AH", t - 0.006, 0, 0.005); fryEv.push([t - 0.03, t, 0.8]); }
  else if (coda === "h") {
    set("AV", t - 0.03, 0, 0.04); set("AH", t - 0.03, 0.55, 0.03); set("AH", t + 0.02, 0.3, codaDur * 0.4); set("AH", t + codaDur * 0.45, 0, codaDur * 0.55);
    kf.push({ "t": t + codaDur * 0.6, "F": endF.map((f, j) => f * [0.75, 0.95, 1][j]), "b1": 2.5, "lip": 0.8, "nas": 0 });
    tailFall = -2;
  } else if (coda === "gh") {
    set("AV", t, 0.75, 0.03); set("AV", t + codaDur * 0.75, 0, codaDur * 0.25);
    fryTail = [t - 0.02, t + codaDur]; tailFall = -5;
    kf.push({ "t": t + codaDur * 0.7, "F": [Math.max(450, endF[0] * 0.8), 1250, 2300], "b1": 1.4, "lip": 0.85, "nas": 0 });
    fric.push([t + 0.02, t + codaDur * 0.85, 1700 * Math.sqrt(k), 1100]); set("AF", t + 0.02, 0.07, 0.04); set("AF", t + codaDur * 0.7, 0, codaDur * 0.2);
  } else if (coda === "t" || coda === "k" || coda === "p") {
    const C = VO_CONS[coda], fc = C["burst"][1] || Math.max(1300, 1.1 * endF[1]);
    set("AV", t - 0.008, 0, 0.008); set("AH", t - 0.008, 0, 0.006);
    kf.push({ "t": t + 0.01, "F": C["F"] || endF, "b1": 1.4, "lip": 1, "nas": 0 });
    const tb = t + 0.045 * Math.pow(L, 0.5);
    bursts.push({ "t": tb, "amp": C["burst"][0] * 0.8, "fc": fc, "bw": C["burst"][2] });
    set("AH", tb + 0.002, 0.45, 0.004); set("AH", tb + 0.01, 0, 0.05);
  } else if (coda === "f" || coda === "s") {
    const C = VO_CONS[coda];
    set("AV", t - 0.01, 0, 0.03); set("AH", t, C["ah"] + 0.08, 0.02); set("AF", t - 0.005, C["af"], 0.025);
    fric.push([t - 0.01, t + codaDur, C["fric"][0] * (k > 1 ? Math.sqrt(k) : 1), C["fric"][1]]);
    set("AF", t + codaDur * 0.5, 0, codaDur * 0.5); set("AH", t + codaDur * 0.5, 0, codaDur * 0.5);
  } else if (coda === "~") {
    set("AV", t - 0.05, 0, codaDur); set("AH", t - 0.05, 0.25, 0.05); set("AH", t + codaDur * 0.3, 0, codaDur * 0.7); tailFall = -4;
  }
  const tLast = coda === "" ? tEnd : tEnd + codaDur;
  // ---- the f0 contour over the voiced span; its peak is where effort peaks too
  const pts = sc["f0"].map((q) => q.slice());
  const mean = pts.reduce((a, q) => a + q[1], 0) / pts.length, ex = cfg["express"];
  for (const q of pts) { q[1] = mean + (q[1] - mean) * ex + (rP() * 2 - 1) * 0.6; q[0] = voClamp(q[0] + (q[0] > 0 && q[0] < 1 ? (rP() * 2 - 1) * 0.03 : 0), 0, 1); }
  let pkU = 0, pkV = -1e9; for (const q of pts) if (q[1] > pkV) { pkV = q[1]; pkU = q[0]; }
  const span = Math.max(0.02, voiceEnd - voiceStart);
  // voice breaks: register jumps when a rough voice pushes hard
  const roughBase = voNudge(voMax(sc["rough"]), cfg["rough"]);
  const breaks = [];
  // random breaks; a script may forbid them ("randomBreaks": false: death-yell-4 must never crack UP past ~300 Hz)
  const nBr = sc["randomBreaks"] === false ? 0 : Math.floor(Math.max(0, roughBase - 0.4) * 5 * span * (0.6 + 0.8 * rB()));
  for (const b of sc["breaks"] || []) breaks.push([voiceStart + span * b[0], voiceStart + span * b[1], b[2]]);   // scripted cracks
  for (let q = 0; q < nBr; q++) {
    const a = voiceStart + span * (0.15 + 0.7 * rB()), len = 0.04 + 0.11 * rB();
    breaks.push([a, a + len, (rB() < 0.6 ? 1 : -1) * (3 + 4 * rB())]);
  }
  // drift: two smoothed random walks (slow wander, effort tremor), one value per control tick
  const driftA = 1 - Math.exp(-2 * Math.PI * 3.5 * VO_CTL / sr), tremA = 1 - Math.exp(-2 * Math.PI * 9 * VO_CTL / sr);
  let dS = 0, dS2 = 0, dT = 0, dT2 = 0;
  // ---- fill the tracks
  const evalAmp = (a, x) => { let i = 1; while (i < a.length && a[i][0] < x) i++; if (i >= a.length) return a[a.length - 1][1]; const p0 = a[i - 1], p1 = a[i]; return p1[0] > p0[0] ? p0[1] + (p1[1] - p0[1]) * (x - p0[0]) / (p1[0] - p0[0]) : p1[1]; };
  for (const key in amp) amp[key].sort((p, q) => p[0] - q[0]);
  kf.sort((p, q) => p["t"] - q["t"]);
  const kfAt = (x) => {
    if (!kf.length) return { "F": VO_VOWELS["ax"], "b1": 1, "lip": 1, "nas": 0 };
    if (x <= kf[0]["t"]) return kf[0];
    for (let i = 1; i < kf.length; i++) if (x <= kf[i]["t"]) {
      const a = kf[i - 1], b = kf[i], u = voEase((x - a["t"]) / (b["t"] - a["t"] || 1));
      return { "F": a["F"].map((f, j) => f + (b["F"][j] - f) * u), "b1": a["b1"] + (b["b1"] - a["b1"]) * u, "lip": a["lip"] + (b["lip"] - a["lip"]) * u, "nas": a["nas"] + (b["nas"] - a["nas"]) * u };
    }
    return kf[kf.length - 1];
  };
  const effMul = cfg["effort"], brMul = cfg["breath"], rgMul = cfg["rough"];
  const steady = voClamp(sc["steady"] || 0, 0, 1), flutMul = sc["flutter"] == null ? 1 : voClamp(sc["flutter"], 0, 2);
  const awayOn = cfg["away"] > 0;
  for (let c = 0; c < nc; c++) {
    const x = tc(c), uV = voClamp((x - voiceStart) / span, 0, 1);
    const eff = voClamp(voNudge(voVal(sc["eff"], uV, pkU), effMul), 0, 1);
    const rough = voClamp(voNudge(voVal(sc["rough"], uV, pkU), rgMul) + 0.25 * Math.max(0, eff - 0.9), 0, 1);
    const breath = voClamp(voNudge(voVal(sc["breath"], uV, pkU), brMul) + K["br"] * 0.5 + 0.35 * old, 0, 1.2);
    // formants: keyframes, then effort opens the jaw (F1 up) and a high f0 drags F1 up with it (an open vowel tunes to it)
    const q = kfAt(x);
    // f0
    dS += (voGauss(rD) - dS) * driftA; dS2 += (dS - dS2) * driftA;
    dT += (voGauss(rD) - dT) * tremA; dT2 += (dT - dT2) * tremA;
    let semi = voCurve(pts, uV) + (9 * eff - 2.5);
    if (x > tEnd && tailFall) semi += tailFall * voEase((x - tEnd) / Math.max(0.02, tLast - tEnd));
    for (const v of vowels) if (x >= v["t0"] && x < v["t1"]) semi += VO_IPITCH[v["v"]] || 0;
    for (const b of bursts) if (x > b["t"] && x < b["t"] + 0.06) semi += 1.2 * (1 - (x - b["t"]) / 0.06);   // the kick after a voiceless stop
    for (const br of breaks) if (x > br[0] - 0.012 && x < br[1] + 0.012) semi += br[2] * Math.min(voClamp((x - br[0] + 0.012) / 0.012, 0, 1), voClamp((br[1] + 0.012 - x) / 0.012, 0, 1));
    // "steady" (a script field, 0..1): a strong, held source (death-yell-4: AJ heard round 3's wobble as a 90-year-old):
    // the effort tremor off, the slow drift halved, jitter and shimmer cut to 30% (below)
    semi += dS2 * (0.9 + 1.2 * rough) * 1.4 * (1 - 0.5 * steady) + dT2 * (0.25 + 0.9 * eff * eff) * 1.4 * (1 - steady) + old * 0.45 * Math.sin(2 * Math.PI * 5.2 * x);
    let away = 0;
    if (awayOn) { const ua = voClamp((x - voiceStart - 0.15 * span) / (tLast - voiceStart - 0.15 * span), 0, 1); away = cfg["away"] * ua * ua; semi -= 1.5 * away; }
    const f0 = f0Base * Math.pow(2, semi / 12);
    const f1Boost = 1 + 0.2 * eff;
    let F1 = q["F"][0] * k * f1Boost;
    if (q["lip"] > 0.5 && F1 < 0.95 * f0 && q["F"][0] > 450) F1 = F1 + (0.95 * f0 - F1) * 0.6 * eff;
    tr["F1"][c] = F1; tr["F2"][c] = q["F"][1] * k; tr["F3"][c] = q["F"][2] * k; tr["F4"][c] = 3350 * k; tr["F5"][c] = 3900 * k;
    tr["B1"][c] = q["b1"] * (1 + 0.6 * breath); tr["lip"][c] = q["lip"]; tr["nas"][c] = q["nas"];
    tr["AV"][c] = evalAmp(amp["AV"], x);
    tr["AH"][c] = evalAmp(amp["AH"], x) + breath * 0.1 * tr["AV"][c];     // breath under the voice (an "h" is AH 1)
    tr["AF"][c] = evalAmp(amp["AF"], x);
    let fc = 4000, bw = 3000; for (const f of fric) if (x >= f[0] - 0.03 && x <= f[1] + 0.03) { fc = f[2]; bw = f[3]; }
    tr["fF"][c] = fc; tr["fB"][c] = bw;
    tr["f0"][c] = f0; tr["eff"][c] = eff; tr["rough"][c] = rough; tr["away"][c] = away;
    tr["oq"][c] = 0.78 - 0.38 * eff + 0.08 * Math.max(0, breath - 0.4);
    tr["tilt"][c] = 900 + 9500 * eff * eff;
    let fry = 0;
    for (const e of fryEv) if (x >= e[0] && x < e[1]) fry = Math.max(fry, e[2] * Math.sin(Math.PI * (x - e[0]) / (e[1] - e[0])));
    if (fryTail && x >= fryTail[0]) fry = Math.max(fry, voClamp((x - fryTail[0]) / 0.05, 0, 1));
    tr["fry"][c] = fry;
    tr["jit"][c] = (K["jit"] + 0.5 * old + 0.3 * rough) * (1 - 0.7 * steady); tr["shim"][c] = (K["shim"] + 0.5 * old + 0.3 * rough) * (1 - 0.7 * steady);
    tr["flut"][c] = flutMul;
  }
  return { presence: sc["presence"] == null ? 13 : sc["presence"], n, nc, tr, bursts, f0Base, k, kind: K, T, tLast, voiceStart, voiceEnd, breaks, vowels, phones, coda };
}

// ---- the render ----------------------------------------------------------------------------------------------------
function voSynth(sr, P, seed) {
  const { n, tr } = P, out = new Float64Array(n);
  const rS = voRng(seed ^ 0x3c6ef372), rN = voRng(seed ^ 0xa54ff53a), rF = voRng(seed ^ 0x510e527f);
  const NYQ = 0.45 * sr, FTOP = 0.95 * NYQ, k = P.k, bwS = Math.sqrt(k);
  // glottis state
  let ph = 0, per = 0, logi = 0.31 + 0.4 * rS(), perScale = 1, ampScale = 1, oq = 0.6, fryOn = 0, fryJit = 0;
  const newPeriod = (c) => {
    per++;
    const rough = tr["rough"][c], sub = voClamp(rough * 2, 0, 1), chaos = voClamp(rough * 2 - 1, 0, 1), fry = tr["fry"][c];
    logi = 3.97 * logi * (1 - logi); if (logi <= 0 || logi >= 1) logi = 0.37;
    const m = (per & 1 ? 1 : -1) * (1 - chaos) + (2 * logi - 1) * chaos;
    const jit = tr["jit"][c] * 0.028 + 0.2 * fry, shim = tr["shim"][c] * 0.22 + 0.45 * fry;
    perScale = voClamp(1 + m * (0.03 * sub + 0.16 * chaos) + voGauss(rS) * jit, 0.55, 1.8);
    ampScale = voClamp((1 + m * (0.45 * sub + 0.35 * chaos)) * (1 + voGauss(rS) * shim), 0.05, 1.7);
    oq = voClamp(tr["oq"][c] - 0.4 * fry + voGauss(rS) * 0.07 * chaos, 0.2, 0.9);
    fryOn = fry; fryJit = voGauss(rS);
  };
  // the cascade: slot 0 nasal pole, 1..NF formants; separate: nasal zero, the parallel frication / burst band-passes
  const NR = VO_NF + 1, y1 = new Float64Array(NR), y2 = new Float64Array(NR), cA = new Float64Array(NR), cB = new Float64Array(NR), cC = new Float64Array(NR);
  const tA = new Float64Array(NR), tB = new Float64Array(NR), tC = new Float64Array(NR), dA = new Float64Array(NR), dB = new Float64Array(NR), dC = new Float64Array(NR);
  const coef = (i, F, BW) => { const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr); tA[i] = 1 - B - C; tB[i] = B; tC[i] = C; };
  let zA = 1, zB = 0, zC = 0, zx1 = 0, zx2 = 0, nForm = 0;
  // F1's bandwidth widens while the glottis is open (the subglottal coupling: Klatt & Klatt 1990's open-phase damping): a
  // second coefficient set for slot 1, blended per sample by a smoothed open-phase gate. Without it F1 rings like a bell.
  let oA = 0, oB = 0, oC = 0, toA = 0, toB = 0, toC = 0, doA = 0, doB = 0, doC = 0, opn = 0;
  // RBJ constant-peak band-pass (0 dB at fc): frication; and the burst's own
  const bp = (fc, bw) => { fc = Math.min(fc, NYQ * 0.98); const w = 2 * Math.PI * fc / sr, Q = Math.max(0.3, fc / Math.max(50, bw)), al = Math.sin(w) / (2 * Q), a0 = 1 + al; return [al / a0, 0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; };
  let fq = bp(4000, 3000), fx1 = 0, fx2 = 0, fy1 = 0, fy2 = 0;
  let bq = bp(4000, 3000), bx1 = 0, bx2 = 0, by1 = 0, by2 = 0;
  const brA = Math.exp(-2 * Math.PI * 2500 / sr);
  let brLp = 0;
  // effort brightens the voice: a pressed voice closes faster, so its top rises faster than its level. An RBJ high shelf at
  // 2 kHz, +13 dB x effort^3, on the output (measured: without it a full-effort "AH" kept its 2-4 kHz band 23 dB under its
  // 0-1 kHz band, a speaking voice's balance, because a lower open quotient and a raised F1 lift the bottom as much as the
  // top; a shelf on the SOURCE did the same thing for the same reason)
  let hs = [1, 0, 0, 0, 0], hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
  const shelf = (dB) => { const A = Math.pow(10, dB / 40), w = 2 * Math.PI * 2000 / sr, c = Math.cos(w), al = Math.sin(w) / 2 * Math.SQRT2, sa = 2 * Math.sqrt(A) * al, a0 = (A + 1) - (A - 1) * c + sa;
    return [A * ((A + 1) + (A - 1) * c + sa) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - sa) / a0, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - sa) / a0]; };
  let tilt = 0, nPrev = 0, lip = 0, la = 0, laT = 0, dla = 0, lvl = 1, lvlT = 1, dlvl = 0, dcx = 0, dcy = 0;
  let av = 0, ah = 0, af = 0, first = true;
  // the roughness flutter: band-passed noise (30-150 Hz), never a sine
  let am1 = 0, am2 = 0, amE = 1e-3, flSS = 0, flN = 0;
  const amW = 2 * Math.PI * 70 / sr, amQ = 0.7, amAl = Math.sin(amW) / (2 * amQ), amA0 = 1 + amAl;
  const amB = [amAl / amA0, -amAl / amA0, -2 * Math.cos(amW) / amA0, (1 - amAl) / amA0];
  let amx1 = 0, amx2 = 0;
  // away: level and a low-pass
  let awLp = 0;
  // bursts: noise envelopes scheduled by sample
  const bs = P.bursts.map((b) => ({ i: Math.round(b["t"] * sr), amp: b["amp"], fc: b["fc"], bw: b["bw"] })).sort((a, b) => a.i - b.i);
  let bi = 0, bEnv = 0, bDec = Math.exp(-1 / (0.004 * sr));
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / VO_CTL), fr = (i - c * VO_CTL) / VO_CTL;
    if (i % VO_CTL === 0) {
      const f0 = tr["f0"][c], open = tr["lip"][c], nas = tr["nas"][c], bfl = 0.1 * f0;
      // nasal: a pole at 270 Hz (scaled) and a zero that matches it (cancels) unless the nose is open
      const FNP = 270 * k, nbw = Math.max(100 * bwS, bfl);
      coef(0, Math.min(FNP, NYQ), nbw);
      { const F = Math.min(FNP * (1 + 2.2 * nas), NYQ), BW = nbw * (1 + nas); const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr); zA = 1 - B - C; zB = B; zC = C; }
      const shut = 1 - open, wide = 1 + 2 * shut * shut;
      const Fs = [tr["F1"][c], tr["F2"][c], tr["F3"][c], tr["F4"][c], tr["F5"][c]];
      let prevF = 0; nForm = 0;
      for (let j = 0; j < VO_NF; j++) {
        let Fi = j < 5 ? Fs[j] : (3900 + 1000 * (j - 4)) * k;
        Fi = Math.max(Fi, prevF + 180 * k); prevF = Fi;
        if (Fi >= FTOP) break;
        let Bi = j === 0 ? 70 * tr["B1"][c] : j === 1 ? 90 : j === 2 ? 130 : 200 + 60 * (j - 3);
        Bi *= j === 0 ? 1 : wide;
        coef(1 + j, Fi, Math.max(Bi * bwS, bfl)); nForm++;
        if (j === 0) { const BW = Math.max(Bi * bwS, bfl) * 2.6 + 60, C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * Fi / sr); toA = 1 - B - C; toB = B; toC = C; }
      }
      fq = bp(tr["fF"][c], tr["fB"][c]);
      hs = shelf(P.presence * Math.pow(tr["eff"][c], 3));
      laT = Math.exp(-2 * Math.PI * Math.min(NYQ, (900 + 10000 * Math.pow(open, 0.8)) * bwS) / sr);
      lvlT = Math.max(0.1 + 0.9 * Math.pow(open, 0.7), 0.5 * nas);
      if (first) { first = false; cA.set(tA); cB.set(tB); cC.set(tC); la = laT; lvl = lvlT; dA.fill(0); dB.fill(0); dC.fill(0); oA = toA; oB = toB; oC = toC; }
      else { const r = 1 / VO_CTL; for (let j = 0; j < NR; j++) { dA[j] = (tA[j] - cA[j]) * r; dB[j] = (tB[j] - cB[j]) * r; dC[j] = (tC[j] - cC[j]) * r; } dla = (laT - la) * r; dlvl = (lvlT - lvl) * r; doA = (toA - oA) * r; doB = (toB - oB) * r; doC = (toC - oC) * r; }
    }
    for (let j = 0; j < NR; j++) { cA[j] += dA[j]; cB[j] += dB[j]; cC[j] += dC[j]; }
    la += dla; lvl += dlvl; oA += doA; oB += doB; oC += doC;
    const lerp = (key) => tr[key][c] + (tr[key][c + 1] - tr[key][c]) * fr;
    const AV = lerp("AV"), AH = lerp("AH"), AF = lerp("AF"), eff = tr["eff"][c], rough = tr["rough"][c];
    av += (AV - av) * 0.2; ah += (AH - ah) * 0.2; af += (AF - af) * 0.2;
    // ---- glottis (fry: the period pulled toward the creak rate)
    let f0 = lerp("f0");
    const fry = tr["fry"][c];
    if (fry > 0) f0 = Math.exp(Math.log(f0) * (1 - fry) + Math.log(P.kind["fry"] * (1 + 0.25 * fryJit)) * fry);
    const dt = Math.min(0.45, f0 / (sr * perScale));
    ph += dt; if (ph >= 1) { ph -= 1; newPeriod(c); }
    const Tp = oq * 2.4 / 3.4, Tn = oq / 3.4;
    let g = 0;
    if (ph < Tp) g = (Tn / Tp) * Math.sin(Math.PI * ph / Tp);
    else if (ph < oq) g = -Math.sin(Math.PI * (ph - Tp) / (2 * Tn));
    let trc = ph - oq; if (trc < 0) trc += 1;
    g += 0.5 * voBlep(trc, dt);
    g *= ampScale;
    const tA1 = Math.exp(-2 * Math.PI * tr["tilt"][c] / sr);
    tilt = (1 - tA1) * g + tA1 * tilt;
    const voiced = (0.15 + 0.45 * eff) * g + (0.85 - 0.45 * eff) * tilt * 2.2;
    const nz = rN() * 2 - 1, nHp = nz - nPrev; nPrev = nz;
    const gate = ph < oq ? 1 : 0.3, voicing = Math.min(1, av * 3);
    const asp = nHp * ah * VO_ASP * ((1 - voicing) + voicing * (0.25 + 0.75 * gate) * (0.6 + 0.4 * ampScale));
    let x = av * voiced + asp * 0.12;
    // ---- tract
    x = cA[0] * x + cB[0] * y1[0] + cC[0] * y2[0]; y2[0] = y1[0]; y1[0] = x;
    { const z = (x - zB * zx1 - zC * zx2) / zA; zx2 = zx1; zx1 = x; x = z; }
    opn += ((ph < oq && av > 0.05 ? 1 : 0) - opn) * 0.25;
    let y = x;
    if (nForm > 0) { const A1 = cA[1] + (oA - cA[1]) * opn, B1 = cB[1] + (oB - cB[1]) * opn, C1 = cC[1] + (oC - cC[1]) * opn; const v = A1 * y + B1 * y1[1] + C1 * y2[1]; y2[1] = y1[1]; y1[1] = v; y = v; }
    for (let j = 2; j <= nForm; j++) { const v = cA[j] * y + cB[j] * y1[j] + cC[j] * y2[j]; y2[j] = y1[j]; y1[j] = v; y = v; }
    lip = (1 - la) * y + la * lip;
    let o = lip * lvl;
    { const v = hs[0] * o + hs[1] * hx1 + hs[2] * hx2 - hs[3] * hy1 - hs[4] * hy2; hx2 = hx1; hx1 = o; hy2 = hy1; hy1 = v; o = v; }
    // ---- parallel: the breath's top (turbulence above the formants, which the cascade would filter out): asp high-passed
    brLp = (1 - brA) * asp + brA * brLp; o += (asp - brLp) * 0.05;
    // ---- parallel: frication and bursts (true band-passes)
    if (af > 1e-4) { const w = (rF() * 2 - 1) * af * VO_FRIC; const v = fq[0] * w + fq[2] * fx2 - fq[3] * fy1 - fq[4] * fy2; fx2 = fx1; fx1 = w; fy2 = fy1; fy1 = v; o += v; }
    while (bi < bs.length && bs[bi].i <= i) { bEnv = bs[bi].amp; bq = bp(bs[bi].fc, bs[bi].bw); bi++; }
    if (bEnv > 1e-4) { const w = (rF() * 2 - 1) * bEnv * 1.6; const v = bq[0] * w + bq[2] * bx2 - bq[3] * by1 - bq[4] * by2; bx2 = bx1; bx1 = w; by2 = by1; by1 = v; o += v; bEnv *= bDec; }
    // ---- roughness flutter (30-150 Hz, random)
    if (rough > 0.3 && tr["flut"][c] > 0) {
      const w = rN() * 2 - 1, v = amB[0] * w + amB[1] * amx2 - amB[2] * am1 - amB[3] * am2; amx2 = amx1; amx1 = w; am2 = am1; am1 = v;
      amE += (v * v - amE) * 0.0005;
      const d = voClamp((rough - 0.3) * 1.1, 0, 0.6) * tr["flut"][c], gm = d * voClamp(v / Math.sqrt(amE + 1e-12), -2.5, 2.5) * 0.4;
      o *= 1 + gm;
      if (av > 0.1) { flSS += gm * gm; }
    }
    if (av > 0.1) flN++;
    // ---- away
    const away = tr["away"][c];
    if (away > 0) { const a = Math.exp(-2 * Math.PI * 14000 * Math.pow(2, -2.6 * away) / sr); awLp = (1 - a) * o + a * awLp; o = awLp / (1 + 9 * away); }
    const dc = o - dcx + 0.9975 * dcy; dcx = o; dcy = dc;
    out[i] = dc;
  }
  P.flutterRms = Math.sqrt(flSS / Math.max(1, flN));     // the applied 30-150 Hz flutter: RMS of the gain's deviation while voiced
  return out;
}

// ---- the character stage -------------------------------------------------------------------------------------------
function voOnePole(x, sr, fc, high) {
  const a = Math.exp(-2 * Math.PI * fc / sr); let s = 0;
  for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; x[i] = high ? x[i] - s : s; }
}
function voPeakTo(x, p) { let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i])); if (pk > 0) for (let i = 0; i < x.length; i++) x[i] *= p / pk; return pk; }
// a hot, close mic: tanh drive, a high-pass and a low-pass (one-pole: gentle)
function voSaturate(x, sr, amt) {
  voPeakTo(x, 0.9);
  const kd = 1 + 3 * amt, nrm = Math.tanh(kd);
  voOnePole(x, sr, 60 + 140 * amt, true);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(kd * x[i]) / nrm;
  voOnePole(x, sr, 16000 - 8500 * amt, false);
}
// BRR: 4-bit ADPCM, 16 samples a block, shift 0..12 and predictor 0..3 per block (copied from chipgun.mjs cgBrr)
function voBrr(x) {
  const n = Math.ceil(x.length / 16) * 16, pcm = new Float64Array(n), out = new Int16Array(n);
  for (let i = 0; i < x.length; i++) pcm[i] = voClamp(Math.round(x[i] * 16383), -16384, 16383);
  const pred = (f, p1, p2) => (f === 0 ? 0 : f === 1 ? p1 * 15 / 16 : f === 2 ? p1 * 61 / 32 - p2 * 15 / 16 : p1 * 115 / 64 - p2 * 13 / 16);
  let p1 = 0, p2 = 0, blocks = 0; const use = [0, 0, 0, 0];
  for (let b = 0; b < n; b += 16) {
    let best = null;
    for (let f = 0; f < 4; f++) for (let sh = 0; sh <= 12; sh++) {
      let a1 = p1, a2 = p2, err = 0; const dec = new Int16Array(16);
      for (let q = 0; q < 16; q++) {
        const pr = pred(f, a1, a2), nib = voClamp(Math.round((pcm[b + q] - pr) * 2 / Math.pow(2, sh)), -8, 7);
        const y = voClamp(Math.round(nib * Math.pow(2, sh) / 2 + pr), -16384, 16383);
        dec[q] = y; err += (y - pcm[b + q]) * (y - pcm[b + q]); a2 = a1; a1 = y;
        if (best && err >= best.err) break;
      }
      if (!best || err < best.err) best = { err, dec, f };
    }
    out.set(best.dec, b); p1 = best.dec[15]; p2 = best.dec[14]; blocks++; use[best.f]++;
  }
  return { pcm: out, blocks, use };
}
// the 16-bit sampler: s = 0..1 (Lo-fi 0.5..1). Returns a new buffer of length n and what it did.
function voSampler(x, sr, s, echo, follow, f0max) {
  const n = x.length;
  // the "recording" at 32 kHz (linear: the clean voice is band-limited)
  const m32 = Math.floor(n * VO_SMP_RATE / sr), src = new Float64Array(m32);
  for (let j = 0; j < m32; j++) { const p = j * sr / VO_SMP_RATE, q = Math.floor(p), f = p - q; src[j] = x[q] + ((x[q + 1] || 0) - x[q]) * f; }
  // the storage rate; with `follow`, a higher voice is stored higher (x sqrt(f0 / 150 Hz), up to 1.8x, never over 16 kHz)
  const store = Math.round(Math.min(16000, 16000 * Math.pow(2, -1.35 * s) * (1 + (follow || 0) * (voClamp(Math.sqrt((f0max || 150) / 150), 1, 1.8) - 1))));
  const ratio = VO_SMP_RATE / store, m = Math.floor(m32 / ratio), dec = new Float64Array(m);
  for (let j = 0; j < m; j++) { const p = j * ratio, q = Math.floor(p); dec[j] = (src[q] + (src[Math.min(m32 - 1, q + 1)] || 0)) / 2; }
  voPeakTo(dec, 0.95);
  const brr = voBrr(dec), smp = brr.pcm, hold = s >= 0.4, SIG = 0.63, step = store / VO_SMP_RATE, vol = 120 / 127;
  const nOut = Math.ceil(n * VO_SMP_RATE / sr) + 2, mix = new Float64Array(nOut);
  let pos = 0;
  for (let j = 0; j < nOut; j++) {
    const i0 = Math.floor(pos), f = pos - i0;
    if (i0 >= smp.length) break;
    let y;
    if (!hold) { let ws = 0, acc = 0; for (let d = -1; d <= 2; d++) { const w = Math.exp(-((d - f) * (d - f)) / (2 * SIG * SIG)), q = i0 + d; ws += w; acc += w * (q >= 0 && q < smp.length ? smp[q] : 0); } y = acc / ws; }
    else y = smp[i0];
    mix[j] = voClamp(Math.trunc(y * vol), -32768, 32767) / 16384;
    pos += step;
  }
  if (echo > 0) {
    const D = (2 + Math.round(3 * echo)) * 512, fbk = 0.2 + 0.3 * echo, wet = 0.18 + 0.32 * echo;
    const fir = [0.35, 0.25, 0.16, 0.1, 0.07, 0.04, 0.02, 0.01], eb = new Float64Array(D), hist = new Float64Array(8);
    let w = 0;
    for (let j = 0; j < nOut; j++) {
      for (let q = 7; q > 0; q--) hist[q] = hist[q - 1]; hist[0] = eb[w];
      let e = 0; for (let q = 0; q < 8; q++) e += fir[q] * hist[q];
      eb[w] = voClamp(mix[j] + e * fbk, -2, 2); w = (w + 1) % D;
      mix[j] += e * wet;
    }
  }
  const out = new Float64Array(n), st = VO_SMP_RATE / sr;
  for (let i = 0; i < n; i++) { const p = i * st, q = Math.floor(p), f = p - q; out[i] = hold ? mix[q] : mix[q] + ((mix[q + 1] || 0) - mix[q]) * f; }
  voOnePole(out, sr, 25, true);
  return { out, store, blocks: brr.blocks, use: brr.use, hold };
}

// One cry. Returns { L, R, n, info, tick(drive, out) }.
export function makeVoice(sr, cfg, seed) {
  const base = ((seed >>> 0) ^ Math.imul(cfg["seed"] + 1, 0x9e3779b1)) >>> 0;
  const P = voPlan(sr, cfg, base);
  // an echo needs room to ring out
  const echoPad = cfg["lofi"] > 0.5 && cfg["echo"] > 0 ? Math.round((0.12 + 0.35 * cfg["echo"]) * sr) : 0;
  let x = voSynth(sr, P, base);
  if (echoPad) { const y = new Float64Array(x.length + echoPad); y.set(x); x = y; }
  const info = { "cry": cfg["cry"], "f0Base": P.f0Base, "k": P.k, "T": P.T, "phones": P.phones.map((p) => p["t"] === "V" ? (p["stress"] ? p["v"].toUpperCase() : p["v"]) : p["c"]).join(" ") + (P.coda ? " |" + P.coda : ""),
    "breaks": P.breaks.length, "plan": P, "lofi": "clean", "flutterPct": 100 * P.flutterRms };
  const lo = cfg["lofi"];
  if (lo > 0) {
    voSaturate(x, sr, Math.min(1, lo / 0.5));
    info["lofi"] = "saturation " + Math.min(1, lo / 0.5).toFixed(2);
    if (lo > 0.5) {
      let f0max = 0; for (let c = 0; c < P.nc; c++) if (P.tr["AV"][c] > 0.25 && P.tr["fry"][c] < 0.5) f0max = Math.max(f0max, P.tr["f0"][c]);
      const r = voSampler(x, sr, (lo - 0.5) / 0.5, cfg["echo"], cfg["storeFollow"], f0max);
      x = r.out;
      info["lofi"] += ", sampler: stored at " + r.store + " Hz in " + r.blocks + " 4-bit ADPCM blocks (predictors " + r.use.join("/") + "), " + (r.hold ? "drop-sample, held to 44.1 kHz" : "gaussian, linear to 44.1 kHz") + (cfg["echo"] > 0 ? ", echo " + cfg["echo"] : "");
    }
  }
  const n = x.length, fo = Math.min(n, Math.floor(0.01 * sr));
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= i / fo;
  const L = Float32Array.from(x), R = Float32Array.from(x);
  let i = 0;
  return { L, R, n, info, tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9 (as glassLevel)
export function voiceLevel(L, R, sr = 44100) {
  const W = Math.min(L.length, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0, pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= L.length; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return 0;
  let g = 0.12 / Math.sqrt(best);
  if (pk * g > 0.9) g = 0.9 / pk;
  return g;
}

// =====================================================================================================================
// THE CLI: the listening round (tooling, not the model)
// =====================================================================================================================
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli();

function runCli() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SR = 44100, TARGET_LUFS = -18, OUT = process.env.VOICE_OUT || join(ROOT, "soundtests", "proto-voice");
  const G = { console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  const ctx = createContext(Object.assign({}, G)); ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx);
  const dctx = createContext(Object.assign({}, G));
  runInContext(readFileSync(join(ROOT, "dsp.js"), "utf8"), dctx, { filename: "dsp.js" });
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  const PRESETS = pctx.window.PRESETS;
  const preset = (nm) => { if (!PRESETS[nm]) throw new Error("no preset " + nm); const o = Object.assign({}, PRESETS[nm]); delete o._vary; delete o._alts; return o; };

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, gated) + its 0.95 peak cap
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
    const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10; g = g.filter((m) => l(m) > rel);
    return l(g.reduce((t, m) => t + m, 0) / g.length);
  }
  function matchLoudness(L, R) {
    let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
    for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
    if (pk > 0.95) gn *= 0.95 / pk;
    for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  }
  // as glass.mjs: a take kept > 0.5 dB short by its peaks gets the app's OWN Limiter at the smallest 0.1 step that reaches
  function matchWithLimiter(L, R) {
    const L0 = Float32Array.from(L), R0 = Float32Array.from(R);
    matchLoudness(L, R);
    if (lufs(L, R) > TARGET_LUFS - 0.5) return 0;
    let pk = 0; for (let i = 0; i < L0.length; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, amt);
      matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5) { L.set(l); R.set(r); return Math.round(amt * 10) / 10; }
    }
    return 0;
  }

  // ---- the takes
  const CRY = (nm) => VOICE_CRIES.indexOf(nm), MAN = 0, WOMAN = 1, KID = 2;
  const cr = (o) => Object.assign({ voPitch: 0 }, o);
  const creature = (o) => Object.assign({ wave: 28, filterMode: 0, cutoff: 18000, reso: 0, drive: 0, width: 0.3, attack: 0.012, hold: 0, decay: 0, sustain: 1, release: 0.08 }, o);
  const ROUNDS = ROUNDS_DEF({ CRY, MAN, WOMAN, KID, cr, creature, preset });
  const ORDER = Object.keys(ROUNDS);

  function renderModel(t) {
    const st = Object.assign({}, VOICE_DEFAULTS, t.st), cfg = voiceCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeVoice(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms };
  }
  function renderTake(t, round) {
    if (t.control) {
      const o = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
      return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), info: null };
    }
    const { r, ms } = renderModel(t);
    let L = r.L, R = r.R;
    if (t.thud && round.thudFrom) {
      // the preset's own thud layer, at its level relative to the preset's voice (both rendered raw by the exported engine),
      // placed at the layer's delay after the cry's onset
      const base = preset(round.thudFrom), lay = JSON.parse(base.layers)[0], b0 = Object.assign({}, base); delete b0.layers;
      const vb = CS.render(Object.assign({}, CS.DEFAULTS, b0), { normalize: false }), th = CS.render(Object.assign({}, CS.DEFAULTS, lay.s), { normalize: false });
      const rms = (x) => { let s2 = 0, n2 = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-4) { s2 += x[i] * x[i]; n2++; } return Math.sqrt(s2 / Math.max(1, n2)); };
      const onset = Math.round(VO_PRE * SR), at = onset + Math.round(lay.d * SR);
      const g = lay.g * rms(L) / Math.max(1e-9, rms(vb.L));
      const n2 = Math.max(L.length, at + th.L.length), l2 = new Float32Array(n2), r2 = new Float32Array(n2);
      l2.set(L); r2.set(R);
      for (let i = 0; i < th.L.length; i++) { l2[at + i] += th.L[i] * g; r2[at + i] += th.R[i] * g; }
      L = l2; R = r2;
      r.info.lofi += ", + the \"" + round.thudFrom + "\" thud at " + lay.d + " s (gain " + g.toFixed(3) + ")";
    }
    const room = t.room || round.room;
    if (room && room.reverb > 0) {
      const pad = Math.round((room.pad || 0.4) * SR), l2 = new Float32Array(L.length + pad), r2 = new Float32Array(L.length + pad);
      l2.set(L); r2.set(R); dctx.reverbProcess(l2, r2, room.reverbSize, room.reverbTone, room.reverb);
      const fo = Math.floor(0.08 * SR); for (let i = 0; i < fo; i++) { const g = i / fo; l2[l2.length - 1 - i] *= g; r2[r2.length - 1 - i] *= g; }
      L = l2; R = r2;
    }
    const g = voiceLevel(L, R, SR); for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
    return { L, R, info: r.info, ms };
  }

  // ---- measurement (we cannot listen)
  function fft(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  // pitch per 25 ms by YIN (de Cheveigne & Kawahara 2002: the cumulative-mean-normalized difference d'), 40-1400 Hz, on a
  // 22.05 kHz copy. Per frame: f0, its aperiodicity d'(T) (0 periodic .. 1 noise) and d'(2T) (under d'(T): a subharmonic,
  // the waveform repeats better over TWO periods). Unguided it takes the shortest dip within 0.06 of the deepest, which
  // still lands on F1's ringing in an open, high-effort vowel (an octave or more UP); with `guide` (the model's own planned
  // f0 per frame) the search is held to 0.6x .. 2.2x of it, so a subharmonic is still found and a formant is not.
  function pitchTrack(x0, guide) {
    const sr = SR / 2, x = new Float64Array(x0.length >> 1); for (let i = 0; i < x.length; i++) x[i] = (x0[2 * i] + x0[2 * i + 1]) / 2;
    const W = Math.round(0.035 * sr), hop = Math.round(0.025 * sr), out = [];
    let emax = 0; for (let i = 0; i < x.length; i++) emax = Math.max(emax, x[i] * x[i]);
    for (let a = 0, fi = 0; a + W + 2 * Math.ceil(sr / 40) + 2 < x.length; a += hop, fi++) {
      let e0 = 0; for (let i = 0; i < W; i++) e0 += x[a + i] * x[a + i];
      const g = guide ? guide(a / sr + 0.0175) : null;
      if (e0 < 1e-5 * emax * W || (guide && !g)) { out.push(null); continue; }
      const lo = g ? Math.max(8, Math.floor(sr / (2.2 * g))) : Math.floor(sr / 1400), hi = g ? Math.ceil(sr / (0.6 * g)) : Math.ceil(sr / 40);
      const d = new Float64Array(2 * hi + 3), dn = new Float64Array(2 * hi + 3); let run = 0; dn[0] = 1;
      for (let L = 1; L <= 2 * hi + 2; L++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[a + i] - x[a + i + L]; s += q * q; } d[L] = s; run += s; dn[L] = s * L / (run || 1e-20); }
      let gmin = 9; for (let L = lo; L <= hi; L++) gmin = Math.min(gmin, dn[L]);
      if (gmin > 0.6) { out.push({ f: null, ap: gmin }); continue; }
      let T = -1; for (let L = lo; L <= hi; L++) if (dn[L] <= gmin + 0.06 && dn[L] <= dn[L - 1] && dn[L] <= dn[L + 1]) { T = L; break; }
      if (T < 0) { out.push({ f: null, ap: gmin }); continue; }
      const a1 = dn[T - 1], b1 = dn[T], c1 = dn[T + 1], den = a1 - 2 * b1 + c1, off = den > 0 ? 0.5 * (a1 - c1) / den : 0;
      let d2 = 9; for (let L = 2 * T - 2; L <= 2 * T + 2; L++) d2 = Math.min(d2, dn[L]);
      out.push({ f: sr / (T + off), ap: b1, ap2: d2 });
    }
    return out;
  }
  // LPC formants (order 12 at 11.025 kHz, envelope peaks) per frame — biased toward harmonics at a high f0: say so
  function lpcFormants(x, a, N) {
    const D = 4, M = Math.floor(N / D), y = new Float64Array(M);
    for (let i = 0; i < M; i++) { let s = 0; for (let q = 0; q < D; q++) s += x[a + i * D + q] || 0; y[i] = s / D; }
    for (let i = M - 1; i > 0; i--) y[i] -= 0.9 * y[i - 1];
    for (let i = 0; i < M; i++) y[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (M - 1));
    const p = 12, R = new Float64Array(p + 1);
    for (let l = 0; l <= p; l++) { let s = 0; for (let i = l; i < M; i++) s += y[i] * y[i - l]; R[l] = s; }
    if (!(R[0] > 0)) return null;
    const A = new Float64Array(p + 1); A[0] = 1; let E = R[0];
    for (let i = 1; i <= p; i++) { let acc = R[i]; for (let j = 1; j < i; j++) acc += A[j] * R[i - j]; const kk = -acc / E; const t = A.slice(); for (let j = 1; j < i; j++) A[j] = t[j] + kk * t[i - j]; A[i] = kk; E *= 1 - kk * kk; }
    const fs = SR / D, env = [];
    for (let b = 0; b < 400; b++) { const f = b * 5000 / 400, w = 2 * Math.PI * f / fs; let re = 0, im = 0; for (let j = 0; j <= p; j++) { re += A[j] * Math.cos(w * j); im -= A[j] * Math.sin(w * j); } env.push([f, 1 / (re * re + im * im)]); }
    const pk = []; for (let b = 2; b < 399; b++) if (env[b][1] > env[b - 1][1] && env[b][1] >= env[b + 1][1] && env[b][0] > 180) pk.push(Math.round(env[b][0]));
    return pk.slice(0, 3);
  }
  // the model's planned f0 at time t (s) while voiced, else null; `delay` = where the cry starts in the take
  function planGuide(info, delay) {
    const P = info.plan;
    return (t) => { const c = Math.round((t - delay) * SR / VO_CTL); if (c < 0 || c >= P.nc || P.tr["AV"][c] < 0.25) return null;
      const fry = P.tr["fry"][c]; return fry > 0.5 ? null : P.tr["f0"][c]; };
  }
  function measure(L, R, info, delay) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan };
    // 5 ms RMS envelope: active span (-40 dB), attack (onset -> -3 dB of max), crest over the active span
    const W5 = Math.round(0.005 * SR), env = [];
    for (let a = 0; a + W5 <= n; a += W5) { let s = 0; for (let i = a; i < a + W5; i++) s += mono[i] * mono[i]; env.push(s / W5); }
    const emax = Math.max(...env), on = env.findIndex((v) => v > emax * 1e-4), top = env.findIndex((v) => v > emax * 0.1);
    let off = env.length - 1; while (off > 0 && env[off] < emax * 1e-4) off--;
    m.attackMs = (top - on) * 5; m.activeS = (off - on) * 0.005;
    let ss = 0; for (let i = on * W5; i < (off + 1) * W5; i++) ss += mono[i] * mono[i];
    m.crest = 20 * Math.log10(pk / Math.sqrt(ss / Math.max(1, (off - on + 1) * W5)));
    // level per 50 ms
    const W = Math.round(0.05 * SR), lv = [];
    for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += mono[i] * mono[i]; lv.push(s / W); }
    const mx = Math.max(...lv); m.env = lv.map((v) => Math.max(-60, Math.round(10 * Math.log10(v / mx + 1e-12)))).join(" ");
    // pitch: f0 per 50 ms (every other 25 ms frame), median periodicity (HNR), period-2 share
    const pt = pitchTrack(mono, info ? planGuide(info, delay || 0) : null), vo = pt.filter((p) => p && p.f);
    m.f0 = pt.filter((_, i) => i % 2 === 0).map((p) => (p && p.f ? Math.round(p.f) : "-")).join(" ");
    const aps = vo.map((p) => p.ap).sort((a, b) => a - b), apm = aps.length ? aps[aps.length >> 1] : 1;
    m.voicedPct = Math.round(100 * vo.length / Math.max(1, pt.filter(Boolean).length));
    m.hnr = aps.length ? 10 * Math.log10(Math.max(1e-3, 1 - apm) / Math.max(1e-3, apm)) : null;
    m.subPct = vo.length ? Math.round(100 * vo.filter((p) => p.ap2 < p.ap - 0.03).length / vo.length) : 0;
    const fs = vo.map((p) => p.f).sort((a, b) => a - b);
    m.f0med = vo.length ? fs[fs.length >> 1] : null;
    m.f0range = vo.length ? Math.round(fs[Math.floor(fs.length * 0.05)]) + "-" + Math.round(fs[Math.floor(fs.length * 0.95)]) + " Hz" : "-";
    // roughness: the envelope's modulation in 30-150 Hz against 2-150 Hz (|x| low-passed at 160 Hz, at 1 kHz, over the
    // active span). Meaningful where f0 is over ~250 Hz (yells, screams): under that the pitch ripple itself lands in the band.
    {
      const w = 2 * Math.PI * 160 / SR, al = Math.sin(w) / (2 * 0.7071), a0 = 1 + al, b0 = (1 - Math.cos(w)) / 2 / a0, b1 = (1 - Math.cos(w)) / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
      const lp = (x) => { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
      const ab = lp(lp(Float64Array.from(mono, Math.abs))), e1 = [];
      for (let a = on * W5; a < (off + 1) * W5; a += Math.round(SR / 1000)) e1.push(ab[a]);
      if (e1.length > 64) {
        let N = 1; while (N < e1.length) N <<= 1;
        const mean = e1.reduce((a, b) => a + b, 0) / e1.length, re = new Float64Array(N), im = new Float64Array(N);
        for (let i = 0; i < e1.length; i++) re[i] = (e1[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (e1.length - 1)));
        fft(re, im); let rough = 0, all = 0;
        for (let kk = 1; kk < N / 2; kk++) { const f = kk * 1000 / N, p = re[kk] * re[kk] + im[kk] * im[kk]; if (f >= 2 && f <= 150) all += p; if (f >= 30 && f <= 150) rough += p; }
        m.roughPct = Math.round(100 * rough / (all || 1));
      }
    }
    // spectrum: centroid, share above 4 kHz
    let N = 1; while (N < n) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N); for (let i = 0; i < n; i++) re[i] = mono[i];
    fft(re, im); let all = 0, num = 0, hi = 0;
    for (let kk = 1; kk < N / 2; kk++) { const f = kk * SR / N, p = re[kk] * re[kk] + im[kk] * im[kk]; all += p; num += f * p; if (f > 4000) hi += p; }
    m.centroid = num / (all || 1); m.hi4k = hi / (all || 1);
    // measured formants (LPC) at 3 points of the loudest stretch
    const fr = []; for (let a = on * W5; a + 1024 < (off + 1) * W5; a += Math.round(0.1 * SR)) { const f = lpcFormants(mono, a, 1024); if (f) fr.push(f.slice(0, 2).join("/")); }
    m.lpc = fr.join("  ");
    return m;
  }
  // the model's own plan, every 50 ms: f0 and F1/F2 while voiced
  function planSummary(info) {
    const P = info.plan, step = Math.round(0.05 * SR / VO_CTL), f0 = [], fm = [];
    for (let c = 0; c < P.nc; c += step) { const v = P.tr["AV"][c] > 0.2; f0.push(v ? Math.round(P.tr["f0"][c]) : "-"); fm.push(v ? Math.round(P.tr["F1"][c]) + "/" + Math.round(P.tr["F2"][c]) : (P.tr["AH"][c] > 0.2 ? "h" : P.tr["AF"][c] > 0.05 ? "fr" : "-")); }
    return "planned f0 per 50 ms (Hz): " + f0.join(" ") + "\n      planned F1/F2 per 50 ms: " + fm.join(" ");
  }

  function run(name) {
    const round = ROUNDS[name];
    const takes = (round.noControl ? [] : [{ id: "control", control: true, why: round.controlWhy, patch: round.controlPatch }]).concat(round.takes);
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    if (round.labeled) order.sort((a, b) => a - b);
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(t, round), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R, r.info), file = round.labeled ? t.file : "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const line = m.sec.toFixed(2) + " s (active " + m.activeS.toFixed(2) + " s), " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", NaN " + m.nan +
        ", attack (to -10 dB) " + m.attackMs + " ms, crest " + m.crest.toFixed(1) + " dB, centroid " + Math.round(m.centroid) + " Hz, >4 kHz " + (100 * m.hi4k).toFixed(0) + "%" +
        ", f0 " + m.f0range + ", voiced " + m.voicedPct + "%, subharmonic frames " + m.subPct + "%, HNR " + (m.hnr == null ? "-" : m.hnr.toFixed(1) + " dB") + ", roughness (30-150 Hz AM) " + m.roughPct + "%" + (m.f0med && m.f0med < 250 ? " (f0 under 250 Hz: the pitch ripple itself is in that band, so read it only against the same voice)" : "") + (lim ? ", Limiter " + lim : "");
      let detail = "level per 50 ms (dB): " + m.env + "\n      measured f0 per 50 ms (Hz): " + m.f0 + "\n      measured F1/F2 (LPC, every 100 ms): " + m.lpc;
      if (r.info) detail += "\n      script: " + r.info.phones + " | voice f0 " + Math.round(r.info.f0Base) + " Hz, tract x" + r.info.k.toFixed(2) + ", " + r.info.breaks + " voice breaks, applied AM flutter " + r.info.flutterPct.toFixed(1) + "% RMS | " + r.info.lofi +
        "\n      " + planSummary(r.info) + "\n      render " + r.ms.toFixed(0) + " ms for " + m.sec.toFixed(2) + " s = " + (r.ms / m.sec).toFixed(0) + " ms per second of audio";
      console.log("  " + file + "  " + t.id.padEnd(22) + line + "\n      " + detail);
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target");
      if (bad.length) console.log("    !! " + bad.join(", "));
      key.push({ file, t, line, detail, lim });
    });
    if (round.labeled) {        // not blind: a ladder AJ chooses along, so a README says which is which
      writeFileSync(join(dir, "README.md"), "# " + round.title + "\n\n" + round.intro + "\n\n" +
        key.map((k) => "## `" + k.file + "`\n" + k.t.why + "\n\nMeasured: " + k.line + "\n\n```\n" + k.detail.replace(/\n\s+/g, "\n") + "\n```\n\n```json\n" + JSON.stringify({ st: k.t.st, seed: k.t.seed }) + "\n```\n").join("\n"));
      return;
    }
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. " + (round.noControl ? "There is no control this time: all " + takes.length + " are the new voice engine." : "One of them is " + (round.controlIsPreset ? "the closest sound the app makes today" : "the best build of today's engines (no preset is close)") + ".") + "\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" +
      "Model takes are the voice engine prototype's mono output (L = R), dry apart from their own hardware echo where stated" + (round.room ? " and the round's room (dsp.js `reverbProcess`: " + JSON.stringify(round.room) + ")" : "") +
      ", leveled, then matched to -18 LUFS; the control is rendered by the exported engine exactly as `tools/make-ab.mjs` does.\n\n" + (round.keyNote ? round.keyNote + "\n\n" : "") +
      key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\nMeasured: " + k.line + "\n\n```\n" + k.detail.replace(/\n\s+/g, "\n") + "\n```\n\n" +
        (k.lim ? "Note: its peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.lim + " before matching.\n\n" : "") +
        "```json\n" + JSON.stringify(k.t.control ? k.t.patch : { st: k.t.st, seed: k.t.seed }) + "\n```\n").join("\n"));
  }

  function cost() {
    const per = [];
    for (const name of ORDER) for (const t of ROUNDS[name].takes) {
      let best = Infinity, sec = 0;
      for (let k = 0; k < 5; k++) { const { r, ms } = renderModel(t); best = Math.min(best, ms); sec = r.n / SR; }
      per.push(best / sec);
      console.log((name + "/" + t.id).padEnd(44) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    per.sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  if (want === "--dump") {      // node voice.mjs --dump <dir>: every cry type, clean and crunched, unmatched (development)
    const dir = process.argv[3]; mkdirSync(dir, { recursive: true });
    VOICE_CRIES.forEach((c, i) => [0, 0.85].forEach((lo) => {
      const { r } = renderModel({ st: { voCry: i, voLofi: lo, voEcho: lo ? 0.25 : 0, voVoice: i === 3 ? 0 : 0, voAge: i === 3 ? 0.15 : 0.5 }, seed: 7 });
      const m = measure(r.L, r.R, r.info);
      writeFileSync(join(dir, c.replace(/ /g, "-") + (lo ? "-lofi" : "") + ".wav"), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2 })));
      console.log(c.padEnd(12) + (lo ? " lofi" : " clean") + "  " + m.sec.toFixed(2) + " s, peak " + m.peak.toFixed(2) + ", f0 " + m.f0range + ", HNR " + (m.hnr == null ? "-" : m.hnr.toFixed(1)) + ", sub " + m.subPct + "%, rough " + m.roughPct + "%, attack " + m.attackMs + " ms, crest " + m.crest.toFixed(1) + ", centroid " + Math.round(m.centroid) + "\n    " + r.info.phones + "\n    f0: " + m.f0 + "\n    lpc: " + m.lpc + "\n    env: " + m.env);
    }));
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const n of want ? [want] : ORDER) { if (!ROUNDS[n]) { console.error("no round " + n + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(n); }
  writeFileSync(join(OUT, "README.md"), README_TEXT(ROUNDS, ORDER));
  console.log("\n-> " + OUT);
}

// ---- the rounds -----------------------------------------------------------------------------------------------------
function ROUNDS_DEF({ CRY, MAN, WOMAN, KID, cr, creature, preset }) {
  const LOFI = { voLofi: 0.85, voEcho: 0.25 };   // the 16-bit sampler: ~8.3 kHz storage, 4-bit ADPCM, drop-sample, a slight echo
  const pair = (id, why, st, seed, whyLo) => [
    { id: "clean-" + id, why: "MODEL, CLEAN (Lo-fi 0): " + why, st: cr(st), seed },
    { id: "16bit-" + id, why: "MODEL, the SAME cry through the 16-BIT SAMPLER (Lo-fi 0.85, Echo 0.25): " + (whyLo || "a hot saturation, then stored at ~8.3 kHz (decimated with no filter, so it aliases) in 4-bit ADPCM blocks, played back drop-sample at 32 kHz and held to 44.1 kHz, with a short hardware echo (48 ms)."), st: cr(Object.assign({}, st, LOFI)), seed },
  ];
  const R = {
    "death-yell": {
      title: "Enemy Death Yell", controlIsPreset: true, controlPatch: preset("Enemy Death"),
      controlWhy: "CONTROL: today's preset \"Enemy Death\" (Retro / Arcade) exactly as it ships: the formant engine at 140 Hz sweeping down, one vowel, with a low thud layered 0.38 s in. (\"Retro Enemy Death\" is a chiptune arpeggio, not a voice, so it was not used.)",
      listen: "A beaten enemy's death yell, the 16-bit brawler kind: \"uraaagh!\" A man's voice, pushed hard, the pitch going up into the yell and falling away as he goes down, ending in a rough, creaky \"gh\". The bar is the game voice clip, not a film recording. Which one is the yell you would put in a game? Listen for whether it sounds like a PERSON yelling (not a synth vowel or a monster), whether the \"u-r\" at the start and the \"gh\" at the end come through, and whether the crunch helps or hurts.",
      takes: [
        ...pair("uraaagh", "an adult man, a little big (Size 1.05), death cry script `uu r AH:6 gh`: an \"oo\" that a tapped r opens into a long \"AH\", the pitch climbing ~8 st into the yell (to ~250 Hz) and falling ~15 st as he goes down, effort full in the middle and sagging at the end, roughness 0.38 (a subharmonic an octave below: period doubling), ending in a creak (vocal fry at ~46 Hz) with a little throat friction: the \"gh\". ~1.1 s.",
          { voCry: CRY("death cry"), voVoice: MAN, voAge: 0.5, voSize: 1.05 }, 11),
        { id: "cartoon-brute", why: "MODEL, a different design point: an exaggerated, cartoonish BRUTE. The same death cry script, but a bigger throat (Size 1.3) and lower (-3 st), the pitch gesture 1.8x as wide (Expression 1.8: up ~14 st, down ~27), 1.3x longer, rougher (0.7: period doubling into chaotic breaks and voice cracks) and breathier; through the WARM middle of the character stage (Lo-fi 0.4: a hot, close-mic saturation, high-passed at ~170 Hz and low-passed at ~9 kHz, no sampler).",
          st: cr({ voCry: CRY("death cry"), voVoice: MAN, voAge: 0.55, voSize: 1.3, voPitch: -3, voExpress: 1.8, voLength: 1.3, voRough: 0.75, voBreath: 0.6, voLofi: 0.4 }), seed: 23 },
      ] },
    "death-yell-2": (() => {
      // AJ, round 1: the model's VOICE beat "Enemy Death", but the control's GESTURE is the death yell: an instant onset onto
      // one open vowel, the pitch only ever falling, short, with a body thud. So: this voice performing that gesture.
      const st = { voCry: CRY("custom"), voVoice: MAN, voAge: 0.5, voSize: 1.05, voOnset: 1, voBody: "AH:5", voCoda: 3, voRise: 0, voFall: -15, voPeakAt: 0.02,
        voPitch: 6, voEffort: 0.85, voRough: 0.6, voLength: 1.1 };
      const perf = "an adult man (Size 1.05), custom script hard glottal attack + `AH:5` + creak (`gh`): the voice lands INSTANTLY on an open \"AH\" (no \"oo\", no rise), the pitch starts high (~220 Hz) and falls the whole way (~15 st, to ~95 Hz) into a creaky \"gh\" tail (vocal fry ~46 Hz with a little throat friction), effort high (0.85), roughness ~0.36 (a subharmonic: period doubling). ~0.8 s";
      const thud = " Plus C's own low body THUD (the \"Enemy Death\" preset's layer, rendered by the exported engine: a 70 Hz tone with a 60 Hz boom, low-passed at 400 Hz) at 0.38 s after the onset, at the same level against the voice as it has in \"Enemy Death\".";
      return {
        title: "Enemy Death Yell, round 2", controlIsPreset: true, controlPatch: preset("Enemy Death"), thudFrom: "Enemy Death",
        controlWhy: "CONTROL: today's preset \"Enemy Death\" exactly as it ships (round 1's C): the formant engine at 140 Hz sweeping down, one vowel, a 5 ms attack, with a low thud layered 0.38 s in. 0.68 s.",
        listen: "Round 2 of the enemy death yell. Round 1's verdict: the new VOICE sounded better, but the old sound's SHAPE was the death yell (it hits at once, only falls, is short, and has a thud). These takes put the new voice into that shape. Which one is the death yell you would put in a game? Listen for whether it lands at once and falls the whole way, whether it sounds like a man going down (not a monster, not a synth vowel), and whether the low thud under it matters: one take has no thud.",
        takes: [
          { id: "clean-falling", why: "MODEL, CLEAN (Lo-fi 0): " + perf + "." + thud, st: cr(st), seed: 211, thud: true },
          { id: "16bit-falling", why: "MODEL, the SAME yell through the 16-BIT SAMPLER (Lo-fi 0.85, Echo 0.25: a hot saturation, stored at ~8.3 kHz with no filter, 4-bit ADPCM, drop-sample, a 48 ms hardware echo)." + thud + " (The thud is mixed after the sampler: a separate sample, as a game would play it.)", st: cr(Object.assign({}, st, { voLofi: 0.85, voEcho: 0.25 })), seed: 211, thud: true },
          { id: "warm-no-thud", why: "MODEL, the SAME yell through the WARM middle of the character stage (Lo-fi 0.4: a hot, close-mic saturation, no sampler) and with NO thud: to learn whether the thud is part of what makes it read as a death.", st: cr(Object.assign({}, st, { voLofi: 0.4 })), seed: 211 },
        ] };
    })(),
    "hurt-2": (() => {
      // AJ, round 1: every hurt take (the control too) was a sung "AH-ha": up ~3 st then down 8-11, a deep rounded vowel
      // held 0.3-0.5 s, a creak tail. A real hurt is a short push of air cut off: no rise, a tense higher pitch, a lot of
      // breath, a glottal stop. Four readings of that, all an adult man, ~0.15-0.3 s of voice.
      const man = { voCry: CRY("custom"), voVoice: MAN, voAge: 0.5, voRise: 0, voPeakAt: 0.02 };
      return {
        title: "Hurt, round 2", noControl: true,
        listen: "Round 2 of the player taking a hit. Round 1's takes were a sung \"AH-ha\" (up, then down, held, with a creak). These are four readings of a REAL hurt sound: short, a push of air cut off, no sung rise, the throat tight. Which one is a person getting hit? Say which one you would put on every hit, and whether any of them is still sing-song.",
        takes: [
          { id: "hh-uh", why: "MODEL, \"hh-UH!\": custom script `h` + `UH:3` + glottal stop. A breath onset, a short pressed \"uh\" that STARTS at its highest pitch (+5 st: ~190 Hz) and drops only ~2.5 st, cut off by a glottal stop (a creaky last pulse and a hard cut). Effort 0.85, breath 0.8 (a lot of air under the voice), roughness ~0.2. About 0.2 s of voice. Lo-fi 0.4 (warm saturation, no sampler): it keeps the breath, which the sampler's 4-bit storage would grind.",
            st: cr(Object.assign({}, man, { voOnset: 2, voBody: "UH:3", voCoda: 1, voFall: -2.5, voPitch: 5, voEffort: 0.85, voBreath: 0.8, voRough: 0.5, voLength: 0.45, voLofi: 0.4 })), seed: 301 },
          { id: "nngh", why: "MODEL, \"NNGH!\": custom script hard glottal attack + a held `n` (closed mouth, nasal, the lips' low-pass closed down: a strained hum through the nose, teeth gritted) + glottal stop. Tense and pitched up (+7 st: ~215 Hz at the start, falling ~2 st), effort full (pressed voice), a little rough (~0.3). About 0.2 s. Lo-fi 0.4 (warm saturation: it gives the muffled hum some edge).",
            st: cr(Object.assign({}, man, { voOnset: 1, voBody: "n:3", voCoda: 1, voFall: -2, voPitch: 7, voEffort: 1, voBreath: 0.6, voRough: 0.62, voLength: 0.6, voLofi: 0.4 })), seed: 307 },
          { id: "agh", why: "MODEL, \"AGH!\": custom script hard glottal attack + `AE:3` + glottal stop. A sharp, open, full-effort yelp, the brightest of the four (an open \"a\" as in \"cat\", effort 1: the shout's high shelf at full), starting high (+8 st, ~280 Hz with effort) and falling ~3 st, clipped by the glottal stop. About 0.15 s. Lo-fi 0.85 with a short echo (0.15): the 16-bit sampler (stored at ~8.3 kHz, 4-bit ADPCM, drop-sample), since a sharp yelp is where that crunch sat best in round 1.",
            st: cr(Object.assign({}, man, { voOnset: 1, voBody: "AE:3", voCoda: 1, voFall: -3, voPitch: 8, voEffort: 1, voBreath: 0.65, voRough: 0.55, voLength: 0.36, voLofi: 0.85, voEcho: 0.15 })), seed: 311 },
          { id: "hhuhh-winded", why: "MODEL, \"hhuhh\": winded, the air knocked out. Custom script: a long breath (`h:3`, ~0.15 s), only ~40 ms of voicing in the middle (an unstressed `uh`, at low effort 0.3: breathy, open glottis, dark, on a slightly raised pitch, +3 st), and a breath-out coda (`h`, ~0.13 s). About 0.3 s, most of it air. Lo-fi 0.5 (the full warm saturation, no sampler): its ~7.5 kHz low-pass takes the top off the breath, which clean measured as a bright hiss (centroid ~6.3 kHz, 38% of the energy over 4 kHz); the sampler's 4-bit storage would turn the breath into grit.",
            st: cr(Object.assign({}, man, { voOnset: 0, voBody: "h:3 uh", voCoda: 2, voFall: -3, voPitch: 3, voEffort: 0.2, voBreath: 1, voRough: 0.3, voLength: 0.5, voLofi: 0.5 })), seed: 317 },
        ] };
    })(),
    "death-yell-3": (() => {
      // AJ, round 2: the gesture is right (instant onset, falling only) but "very calm. Oh no, I died, aaah": it started at a
      // speaking pitch (~200 Hz), effort 0.85, roughness 0.36. A game death yell is a man SHOUTING in agony.
      const base = { voCry: CRY("custom"), voVoice: MAN, voAge: 0.5, voSize: 1.05, voEffort: 0.5, voRough: 0.5, voBreath: 0.5 };
      const strained = { "s": "' AH:5 gh", "dur": 0.62, "f0": [[0, 13.5], [0.15, 13], [0.6, 10.5], [0.72, 7], [1, -5]], "eff": [1, 1, 0.85], "rough": 0.55, "breath": 0.35, "breaks": [[0.17, 0.3, 5]] };
      const uwa = { "s": "' uu:0.5 AH:5 gh", "dur": 0.66, "f0": [[0, 4], [0.08, 14], [0.2, 13], [0.6, 10.5], [0.72, 7], [1, -5]], "eff": [0.9, 1, 0.85], "rough": 0.55, "breath": 0.35, "breaks": [[0.3, 0.4, 4]] };
      const scream = { "s": "' AE:5 !", "dur": 0.55, "f0": [[0, 18.5], [0.1, 18], [0.65, 15.5], [0.88, 11], [1, 8]], "eff": 1, "rough": 0.8, "breath": 0.35 };
      const thud = " With Enemy Death's own low thud at 0.38 s (its level against the voice as in that preset).";
      const hz = (st) => Math.round(161 * Math.pow(2, st / 12));
      return {
        title: "Enemy Death Yell, round 3", noControl: true, thudFrom: "Enemy Death",
        listen: "Round 3 of the enemy death yell. Round 2 had the right shape (it hits at once and only falls) but sounded \"very calm\". These are a man SHOUTING in agony: higher, harder, rougher. Which one would you put in a game? Listen for whether it sounds like real pain (not calm, not a monster, not a siren), and whether the voice cracking or the scream's rasp helps.",
        takes: [
          { id: "aaagh-strained", why: "MODEL, CLEAN (Lo-fi 0), \"AAAGH!\" strained: a hard glottal attack straight onto \"AH\", starting in a shouting register (~" + hz(13.5) + " Hz), maximum effort (pressed voice: open quotient 0.40, the shout's high shelf at full), roughness ~0.6 with the subharmonic, a voice CRACK early (up 5 st for ~45 ms, ~0.11 s in), holding high and sagging to ~" + hz(10.5) + " Hz, then COLLAPSING in the last third (~10 st in ~0.17 s) into the creaky \"gh\" (fry at ~46 Hz)." + thud,
            st: cr(Object.assign({}, base, { voScript: strained })), seed: 401, thud: true },
          { id: "uwaaagh-scoop", why: "MODEL, warm Lo-fi 0.4 (a close-mic saturation, no sampler), \"UWAAAGH!\": a hard attack on a rounded \"u\" that opens to \"AH\" while the pitch SCOOPS up 10 st in ~50 ms (from ~" + hz(4) + " to ~" + hz(14) + " Hz: a gasp turning into the yell), then the same agonized fall: a crack (up 4 st) in the middle, the collapse in the last third into creak. Maximum effort, roughness ~0.6." + thud,
            st: cr(Object.assign({}, base, { voScript: uwa, voLofi: 0.4 })), seed: 409, thud: true },
          { id: "agony-scream", why: "MODEL, CLEAN (Lo-fi 0), an agony SCREAM: the scream source (roughness 0.8: period doubling into chaos, a random 30-150 Hz flutter, voice breaks) on an open \"AE\" at ~" + hz(18.5) + " Hz, falling only ~10 st, short (~0.55 s), CHOKED off by a glottal stop (a hard cut, no creak tail)." + thud,
            st: cr(Object.assign({}, base, { voScript: scream })), seed: 419, thud: true },
          { id: "16bit-aaagh-strained", why: "MODEL, take 1 (the strained \"AAAGH!\", the most like the classic clip and the lowest of the three, which suits the sampler: round 1's woman's cry showed it damages higher voices) through the 16-BIT SAMPLER (Lo-fi 0.85, Echo 0.25), with the storage rate now following the pitch (Store follows pitch 1: ~8.3 kHz x sqrt(peak f0 / 150 Hz), so ~13 kHz here, 4-bit ADPCM, drop-sample). The thud is mixed after the sampler (a separate clip, as a game would play it).",
            st: cr(Object.assign({}, base, { voScript: strained, voLofi: 0.85, voEcho: 0.25, voStoreFollow: 1 })), seed: 401, thud: true },
        ] };
    })(),
    "hurt-3": (() => {
      // AJ, hurt-2: D `nngh` "is alright, I think it should be a little longer. It's uugh, it should be uuuugh!" A LABELED
      // length ladder. Only the held strained middle stretches (the `n`'s weight); the hard attack, its creak and the
      // glottal stop keep their lengths. The pitch sags more across a longer hold (a strain running out of air, not a held
      // note); jitter, shimmer, drift and the effort tremor run all the way through, so a long hold does not become a hum.
      const nngh = { voCry: CRY("custom"), voVoice: MAN, voAge: 0.5, voRise: 0, voPeakAt: 0.02, voOnset: 1, voBody: "n:3", voCoda: 1, voFall: -2, voPitch: 7, voEffort: 1, voBreath: 0.6, voRough: 0.62, voLength: 0.6, voLofi: 0.4 };
      const rung = (x, fall) => ({ id: "nngh-" + x + "x", file: "nngh-" + x + "x.wav", why: (x === 1 ? "TODAY's `nngh` from hurt-2, unchanged (same settings, same seed), for reference: " : "The held middle " + x + "x as long (the `n` held " + x + "x: body `n:" + +(3 * x).toFixed(1) + "`), the pitch sagging " + -fall + " st across it instead of 2: ") +
        "a hard glottal attack into a closed-mouth, nasal, strained hum (the lips' low-pass closed down), tense and pitched up (~215 Hz at the start), full effort, a little rough, cut off by a glottal stop. Warm Lo-fi 0.4.",
        st: cr(Object.assign({}, nngh, { voBody: "n:" + +(3 * x).toFixed(1), voFall: fall })), seed: 307 });
      return { title: "Hurt, round 3: the \"nngh\" length ladder", labeled: true, noControl: true,
        intro: "Not blind: a LADDER of one sound, to choose a length. hurt-2's `nngh` (\"alright, ... it should be uuuugh!\") with its held, strained middle stretched; the attack and the glottal stop are the same length in all four. The longer ones sag a little more in pitch, like a strain running out of air. Each file matched to -18 LUFS. Pick the length (or say between which two).",
        takes: [rung(1, -2), rung(1.6, -3), rung(2.2, -4), rung(3, -5)] };
    })(),
    "death-yell-4": (() => {
      // AJ, round 3: "a 90 year old bird". BIRD: too high for a man (to ~450 Hz, the scream ~770): a male tract squawks
      // there. 90 YEARS OLD: the 30-150 Hz flutter (11.6% RMS applied on the strained take, 23% on the scream) and the
      // tremor read as an elderly quaver. So: a man in CHEST voice, peaking ~220-280 Hz, a bigger throat, loud and desperate
      // through BRIGHTNESS (pressed, the effort shelf at full, an open "AH"), a STEADY source; grit only as period doubling.
      const base = { voCry: CRY("custom"), voVoice: MAN, voAge: 0.45, voSize: 1.15, voEffort: 0.5, voRough: 0.5, voBreath: 0.5 };
      const fall = [[0.15, 8], [0.6, 6.2], [0.72, 3.5], [1, -7]];            // ~250 Hz, held, then the collapse into creak
      // presence 19 (the effort shelf's dB at full effort, 13 elsewhere): measured at 13, the bigger throat left the clean
      // yell's centroid at 776 Hz, darker than round 1's shouts (1.5-1.7 kHz); the brief asks for loudness from brightness
      const chest = { "presence": 19, "s": "' AH:5 gh", "dur": 0.62, "f0": [[0, 8.3]].concat(fall), "eff": 1, "breath": 0.25, "steady": 1, "flutter": 0, "randomBreaks": false,
        "rough": [[0, 0.5], [0.2, 0.5], [0.32, 0.1], [1, 0.1]] };          // period doubling only in the first ~150 ms
      const uwa = Object.assign({}, chest, { "s": "' uu:0.5 AH:5 gh", "dur": 0.66, "f0": [[0, 3.8], [0.07, 8.3]].concat(fall), "rough": [[0, 0.5], [0.24, 0.5], [0.36, 0.1], [1, 0.1]] });
      const raw = Object.assign({}, chest, { "rough": 0.5, "breath": 0.55, "f0": [[0, 7.5], [0.15, 7.3], [0.6, 5.8], [0.72, 3.2], [1, -7]] });
      const thud = " With Enemy Death's own low thud at 0.38 s (its level against the voice as in that preset).";
      const common = "An adult man in CHEST voice with a bigger throat (Size 1.15): a hard glottal attack straight onto an open \"AH\", pressed (open quotient 0.40) at full effort, so the shout's high shelf is at full (raised for this round: +19 dB at 2 kHz) and F1 is raised (~760 Hz); a STEADY source (jitter and shimmer at 30%, the effort tremor off, the slow drift halved), NO amplitude flutter, no upward voice cracks; the pitch held near its peak, then collapsing in the last third into the creaky \"gh\" (fry ~46 Hz). ~0.75 s.";
      return {
        title: "Enemy Death Yell, round 4", noControl: true, thudFrom: "Enemy Death",
        keyNote: "FLUTTER, two numbers per take. \"Applied AM flutter\" (in the script line) is the model's own 30-150 Hz amplitude flutter, the RMS of its gain deviation while voiced: 0.0% on every take here, against 11.6% on round 3's strained takes and 23.3% on its scream. \"Roughness (30-150 Hz AM)\" is measured from the audio and is NOT the flutter alone: under 250 Hz the pitch ripple lands in that band, and period doubling IS an amplitude alternation at f0/2 (~120 Hz here), so it rises with the grit (22% on the take with grit only at the start, 43% on the one with it throughout). F0 RANGE: \"f0\" is the measured 5-95% range (its low end is the creak tail; the uwaaagh take's top is an octave error on the \"u\"); the planned line is the model's own pitch, peaking at ~250-260 Hz with no upward cracks. BRIGHTNESS: the whole-file centroid is pulled down by the thud and the creak; on the held vowel alone (60-245 ms, voice only) chest-aaagh measures a 1279 Hz centroid with its 2-4 kHz band 14.0 dB under 0-1 kHz, raw-doubling 1016 Hz / 11.6 dB, against round 3's strained take at 1005 Hz / 13.2 dB and battle-cry's clean-toriya (picked) at 805 Hz / 11.1 dB.",
        listen: "Round 4 of the enemy death yell. Round 3 was \"a 90 year old bird\": too high, and wobbly. These are a grown man's CHEST-voice yell: lower, steadier, loud through brightness rather than pitch. Which one is the death yell you would put in a game? Listen for whether it sounds like a strong man in agony (not old, not a bird, not calm), and whether the grit in the voice helps.",
        takes: [
          { id: "chest-aaagh", why: "MODEL, CLEAN (Lo-fi 0), chest \"AAAGH!\": " + common + " Peak ~250 Hz. Grit (period doubling: a subharmonic an octave down) only in the first ~150 ms, the strain of the hit, then a clean, strained fall." + thud,
            st: cr(Object.assign({}, base, { voScript: chest })), seed: 501, thud: true },
          { id: "uwaaagh-short-scoop", why: "MODEL, warm Lo-fi 0.4 (a close-mic saturation, no sampler), \"UWAAAGH!\": a rounded \"u\" opening to \"AH\" while the pitch scoops up ~4.5 st in ~45 ms (from ~190 to ~250 Hz), then the same chest yell: " + common + " Period doubling in the first ~200 ms." + thud,
            st: cr(Object.assign({}, base, { voScript: uwa, voLofi: 0.4 })), seed: 509, thud: true },
          { id: "raw-doubling", why: "MODEL, warm Lo-fi 0.4, the RAWEST: " + common + " Peak ~240 Hz. Period doubling THROUGHOUT (full subharmonic, no chaos) and a little more breath noise in the source (0.55), still steady, no flutter." + thud,
            st: cr(Object.assign({}, base, { voScript: raw, voLofi: 0.4 })), seed: 517, thud: true },
          { id: "16bit-chest-aaagh", why: "MODEL, take `chest-aaagh` (the cleanest-voiced of the three, so the sampler's grit has the least to fight; my pick by measurement, not by ear) through the 16-BIT SAMPLER (Lo-fi 0.85, Echo 0.25) with the storage rate following the pitch (~8.3 kHz x sqrt(peak f0 / 150 Hz): ~10.7 kHz here), 4-bit ADPCM, drop-sample. The thud is mixed after the sampler (a separate clip, as a game would play it).",
            st: cr(Object.assign({}, base, { voScript: chest, voLofi: 0.85, voEcho: 0.25, voStoreFollow: 1 })), seed: 501, thud: true },
        ] };
    })(),
    "sword-cry": {
      title: "Hero Sword Cry", controlIsPreset: false,
      controlPatch: creature({ freq: 330, crSize: 0.9, crPitchStart: -6, crPeak: 0.22, crPitchEnd: -5, crOpenStart: 0.2, crOpenPeak: 1, crOpenEnd: 0.45, crVowelStart: 0.05, crVowelEnd: 0.55, crNasal: 0, crTension: 0.9, crJitter: 0.2, crShimmer: 0.2, crRough: 0.1, crBreath: 0.35, attack: 0.008, release: 0.05, duration: 0.42 }),
      controlWhy: "CONTROL, the best build of TODAY's engines (no preset is close): the creature engine (wave 28) as a young human voice: 330 Hz, a 0.9 throat, the pitch jumping up 6 st and falling 5, the mouth opening from a front \"ee\"-like shape into \"ah\", pressed (tension 0.9) with breath. It has no consonants, so no real \"h\" and no \"t\". 0.42 s.",
      listen: "A young hero's sword swing: \"HYAAT!\" Short and sharp, a teenage voice, an attack shout rather than a scream. Which one would you want on every sword swing? Listen for the breathy \"h\" and the \"y\" glide at the start, the sharp \"AH\", and the clipped end, and whether the voice sounds young.",
      takes: [
        ...pair("hyaat", "a teenage boy (Age 0.12: ~145 Hz speaking, a slightly shorter throat), sword cry script `h y AH:4 t`: a breathy \"h\" (aspiration shaped by the vowel to come), a \"y\" glide (F2 from ~2.4 kHz down to ~1.2 kHz), a pressed \"AH\" jumping ~6 st up at the start (to ~330 Hz) and easing down, cut off by a \"t\" (a closure and a 4.6 kHz burst). ~0.45 s.",
          { voCry: CRY("sword cry"), voVoice: MAN, voAge: 0.12 }, 31),
        { id: "hi-yah-exaggerated", why: "MODEL, a different design point: the two-beat \"hi-YAAH!\", exaggerated (Expression 1.5): the same teenage voice, custom script `h` + `ih y AH:4` + glottal stop (a quick \"hi\" low, then the \"YAAH\" ~12 st above it), effort pushed (0.75), through the warm middle of the character stage (Lo-fi 0.45, no sampler).",
          st: cr({ voCry: CRY("custom"), voVoice: MAN, voAge: 0.12, voOnset: 2, voBody: "ih y AH:4", voCoda: 1, voRise: 10, voFall: -3, voPeakAt: 0.4, voEffort: 0.75, voExpress: 1.5, voLength: 1.1, voLofi: 0.45 }), seed: 37 },
      ] },
    "battle-cry": {
      title: "Battle Cry", controlIsPreset: false,
      controlPatch: Object.assign({ wave: 17, speechText: "toe ree", freq: 165, speechRate: 1.25, speechSize: 1, sustain: 1, attack: 0.005, release: 0.05, cutoff: 14000, drive: 0.2, duration: 0.42 },
        { layers: JSON.stringify([{ s: creature({ freq: 250, crSize: 1, crPitchStart: -4, crPeak: 0.55, crPitchEnd: -2, crOpenStart: 0.35, crOpenPeak: 1, crOpenEnd: 0.6, crVowelStart: 0.1, crVowelEnd: 0.55, crTension: 0.9, crJitter: 0.25, crShimmer: 0.25, crRough: 0.2, crBreath: 0.25, attack: 0.01, release: 0.08, duration: 0.6 }), d: 0.3, g: 1.1, p: 0 }]) }),
      controlWhy: "CONTROL, the best build of TODAY's engines (no preset is close): the speech engine (wave 17) saying \"toe ree\" (a flat 165 Hz reading voice), with a creature-engine layer 0.3 s in for the \"YAAA\": a 250 Hz human-sized call opening from \"ee\" into \"ah\", pitch rising then holding, pressed. ~0.9 s.",
      listen: "A fighter's battle cry as they charge or land a big hit: \"to-ri-YAAA!\" Three syllables, the last one held and pushed. Which one is the battle cry? Listen for the syllables (\"to\", a tapped \"r\", \"ri\", the \"y\" into \"YAAA\"), the rise in pitch and effort into the last syllable, and how it stops.",
      takes: [
        ...pair("toriya", "an adult man, battle cry script `t oh r EE y AH:5 !`: a \"t\" burst, \"oh\", a tapped r (a 24 ms dip, F1 down), a stressed \"EE\", a \"y\" glide into a long \"AH\" that rises ~8 st over the cry (to ~270 Hz) with effort building to full, a little rasp (roughness 0.2), stopped by a glottal stop (a creak and a hard cut). ~1.0 s.",
          { voCry: CRY("battle cry"), voVoice: MAN, voAge: 0.45 }, 41),
        { id: "big-barbarian", why: "MODEL, a different design point: a big, rough barbarian shouting the same script: Size 1.25, 4 st lower, roughness 0.75 (period doubling and voice cracks), Expression 1.4, a little longer (1.15x), through the warm middle of the character stage (Lo-fi 0.45, no sampler).",
          st: cr({ voCry: CRY("battle cry"), voVoice: MAN, voAge: 0.55, voSize: 1.25, voPitch: -4, voRough: 0.75, voExpress: 1.4, voLength: 1.15, voLofi: 0.45 }), seed: 43 },
      ] },
    "jump-hup": {
      title: "Jump (\"hup!\")", controlIsPreset: false,
      controlPatch: { wave: 17, speechText: "hup", freq: 175, speechRate: 1.3, speechSize: 1.08, sustain: 1, attack: 0.003, release: 0.04, cutoff: 15000, duration: 0.3 },
      controlWhy: "CONTROL, the best build of TODAY's engines (no preset is close; \"Jump\" in Retro / Arcade is a chiptune blip, not a voice): the speech engine (wave 17) saying \"hup\" at 175 Hz, a slightly small voice (1.08), quick (rate 1.3). 0.3 s.",
      listen: "The little grunt a hero makes on a jump: \"hup!\" Very short, a breath and a clipped vowel, the pitch going UP. Which one would you want on every jump? Listen for the \"h\", the quick rising \"uh\" and the closed \"p\" at the end, and whether it reads as effort (a body jumping) rather than a word.",
      takes: [
        ...pair("hup", "a teenage boy (Age 0.15), hup script `h UH p`: a breathy \"h\", a quick \"UH\" rising ~5 st, closed by the lips (a \"p\": a closure and a weak low burst). ~0.25 s.",
          { voCry: CRY("hup"), voVoice: MAN, voAge: 0.15 }, 51),
        { id: "cartoon-kid-hup", why: "MODEL, a different design point: a kid's cartoon \"hup!\" (Voice: kid, ~300 Hz), the rise exaggerated (Expression 1.8), a touch more effort, through the warm middle of the character stage (Lo-fi 0.4, no sampler).",
          st: cr({ voCry: CRY("hup"), voVoice: KID, voAge: 0.4, voExpress: 1.8, voEffort: 0.65, voLofi: 0.4 }), seed: 53 },
      ] },
    "hurt": {
      title: "Hurt (\"ugh\" / \"oof\")", controlIsPreset: false,
      controlPatch: creature({ freq: 150, crSize: 1, crPitchStart: 3, crPeak: 0.1, crPitchEnd: -6, crOpenStart: 0.4, crOpenPeak: 0.8, crOpenEnd: 0.3, crVowelStart: 0.5, crVowelEnd: 0.55, crTension: 0.8, crJitter: 0.3, crShimmer: 0.3, crRough: 0.35, crBreath: 0.35, attack: 0.005, release: 0.06, duration: 0.32 }),
      controlWhy: "CONTROL, the best build of TODAY's engines (no human hurt preset exists; \"Troll Grunt\" is a monster): the creature engine (wave 28) at human size, 150 Hz, the pitch jumping up 3 st and falling 9, a half-open \"uh\" mouth, pressed, rough 0.35. 0.32 s.",
      listen: "The player taking a hit: \"ugh!\" or \"oof!\" Short, involuntary, the air knocked out. Which one is a PERSON GETTING HIT? Listen for the hard start (the voice catching), the pitch jumping up then falling, and the ending (a creak, a breath, a puff of air).",
      takes: [
        ...pair("ugh", "an adult man, hurt script `' UH:2 gh`: a hard glottal attack (the first pulses creaky), \"UH\" jumping up ~3 st to ~200 Hz and falling ~11 st, effort full then sagging, roughness 0.3, a creaky \"gh\" tail. ~0.35 s.",
          { voCry: CRY("hurt"), voVoice: MAN, voAge: 0.5 }, 61),
        { id: "oof", why: "MODEL, a different design point: \"OOF!\", the air knocked out: custom script hard attack + `UU:2` (as in \"book\") + an \"f\" (a puff of air through the lips: broadband frication), the pitch up 3 st and down 8, a little bigger voice (Size 1.1), more breath (0.7), through the warm middle of the character stage (Lo-fi 0.4).",
          st: cr({ voCry: CRY("custom"), voVoice: MAN, voAge: 0.5, voSize: 1.1, voOnset: 1, voBody: "UU:2", voCoda: 7, voRise: 3, voFall: -8, voPeakAt: 0.12, voEffort: 0.6, voBreath: 0.7, voLength: 0.65, voLofi: 0.4 }), seed: 67 },
      ] },
    "falling-scream": {
      title: "Falling Scream", controlIsPreset: true, controlPatch: preset("Distant Scream"),
      room: { reverb: 0.3, reverbSize: 0.75, reverbTone: 0.45, pad: 0.9 },
      controlWhy: "CONTROL: today's preset \"Distant Scream\" (Horror) exactly as it ships: the creature engine at 1050 Hz, pressed and rough, a long vowel falling 8 st, with a big reverb and a 0.3 s echo. 1.9 s.",
      listen: "Someone falling off a ledge into a pit: a long scream that falls away, getting further, quieter and duller as they drop. Which one is a PERSON SCREAMING AS THEY FALL? Listen for the scream's raw, rasping edge (a real scream is rough, not a clean tone), the pitch sagging as it goes, and the sense of it dropping away.",
      takes: [
        { id: "clean-man-falls", why: "MODEL, CLEAN (Lo-fi 0): an adult man, fall scream script `' AH:1 AE:6 ~`: a hard attack, \"AH\" into \"AE\", the pitch leaping to ~460 Hz and sagging ~9 st over ~2 s, full effort, roughness 0.62 (period doubling into chaos, a random 30-150 Hz flutter, and voice breaks: sudden 3-7 st jumps for 40-150 ms), and Fall away 1: from a fifth of the way in the level drops 20 dB, the top rolls off (14 kHz down to ~2.3 kHz) and the pitch drops 1.5 st (distance ~ t^2, as a fall). The round's room (a pit).",
          st: cr({ voCry: CRY("fall scream"), voVoice: MAN, voAge: 0.5 }), seed: 71 },
        { id: "16bit-man-falls", why: "MODEL, the SAME scream through the 16-BIT SAMPLER (Lo-fi 0.85), with the hardware echo up (0.5: 64 ms, feedback) INSTEAD of the room: stored at ~8.3 kHz in 4-bit ADPCM, drop-sample.",
          st: cr({ voCry: CRY("fall scream"), voVoice: MAN, voAge: 0.5, voLofi: 0.85, voEcho: 0.5 }), seed: 71, room: null },
        { id: "woman-falls", why: "MODEL, a different voice: a woman (~800-950 Hz at the top), the same fall scream, slightly rougher (0.6 knob), through the warm middle of the character stage (Lo-fi 0.4, no sampler), with the round's room.",
          st: cr({ voCry: CRY("fall scream"), voVoice: WOMAN, voAge: 0.45, voRough: 0.6, voLofi: 0.4 }), seed: 73 },
      ] },
    "woman-cry": {
      title: "Woman's Hurt Cry", controlIsPreset: false,
      controlPatch: creature({ freq: 420, crSize: 0.82, crPitchStart: 3, crPeak: 0.12, crPitchEnd: -7, crOpenStart: 0.5, crOpenPeak: 1, crOpenEnd: 0.4, crVowelStart: 0.45, crVowelEnd: 0.5, crTension: 0.9, crJitter: 0.25, crShimmer: 0.25, crRough: 0.3, crBreath: 0.35, attack: 0.006, release: 0.07, duration: 0.5 }),
      controlWhy: "CONTROL, the best build of TODAY's engines (no preset is close; \"Female Vocal\" is a sung note): the creature engine (wave 28) as a woman: 420 Hz, a 0.82 throat, the pitch up 3 st and down 10, an open \"ah\", pressed, rough 0.3. 0.5 s.",
      listen: "A woman fighter taking a hard hit: \"AAH!\" or \"aagh\". To show the engine's range beyond a man's voice. Which one is a WOMAN CRYING OUT IN PAIN? Listen for whether the voice reads as a woman (not a man pitched up, not a child), the hard start, and the rough, falling end. One take is an attack cry instead of a hurt cry: say if that one is the better sound anyway.",
      takes: [
        ...pair("aagh", "an adult woman (~205 Hz speaking, a 1.16x shorter throat), big hurt script `' AH:4 uh gh` at 0.8x length: a hard attack, \"AH\" jumping ~4 st up (to ~460 Hz) and falling, roughness 0.42 (the subharmonic: period doubling), into \"uh\" and a creaky \"gh\" (fry at ~62 Hz). ~0.6 s.",
          { voCry: CRY("big hurt"), voVoice: WOMAN, voAge: 0.45, voLength: 0.8 }, 81),
        { id: "woman-attack-hyah", why: "MODEL, a different design point: the woman's ATTACK cry instead, the sword cry script `h y AH:4 t` (\"HYAAT!\") in her voice, through the warm middle of the character stage (Lo-fi 0.4, no sampler).",
          st: cr({ voCry: CRY("sword cry"), voVoice: WOMAN, voAge: 0.4, voLofi: 0.4 }), seed: 83 },
      ] },
  };
  // AJ, death-yell-4: C `uwaaagh-short-scoop` "is the closest, I think it just needs to be lower pitched perhaps?" A
  // LABELED pitch ladder of that take: same seed, same script, brightness and pressed effort untouched, only Pitch moved;
  // the last rung adds a bigger throat (Size 1.3), its pitch compensated (+0.74 st: Size alone lowers f0 by size^-0.35) so
  // its peak matches the -5 st rung and only the throat differs.
  const c4 = R["death-yell-4"].takes.find((t) => t.id === "uwaaagh-short-scoop");
  const peakHz = (st, seed) => { const P = makeVoice(44100, voiceCfg(Object.assign({}, VOICE_DEFAULTS, st)), seed).info.plan; let pk = 0;
    for (let c = 0; c < P.nc; c++) if (P.tr["AV"][c] > 0.25 && P.tr["fry"][c] < 0.5) pk = Math.max(pk, P.tr["f0"][c]); return Math.round(pk); };
  const rung = (file, pitch, size, what) => { const st = cr(Object.assign({}, c4.st, { voPitch: pitch }, size ? { voSize: size } : {}));
    return { id: file.replace(".wav", ""), file, st, seed: c4.seed, thud: true,
      why: what + " Planned peak **" + peakHz(st, c4.seed) + " Hz** (the scoop's top). Otherwise death-yell-4's C exactly: a \"u\" opening to a pressed, bright \"AH\" (the +19 dB effort shelf), the ~4.5 st scoop, a steady source, the fall into creak, warm Lo-fi 0.4, Enemy Death's thud at 0.38 s." }; };
  R["death-yell-5"] = { title: "Enemy Death Yell, round 5: the \"uwaaagh\" pitch ladder", labeled: true, noControl: true, thudFrom: "Enemy Death",
    intro: "Not blind: a LADDER of one sound, to choose a pitch. death-yell-4's C `uwaaagh-short-scoop` (\"the closest ... just needs to be lower pitched perhaps?\") moved down in pitch, everything else identical (same seed, same brightness and pressed effort, so lower does not turn into a mumble). The last file is the -5 st one with a bigger throat too, in case \"lower\" means BIGGER. Each file matched to -18 LUFS. Pick the rung (or say between which two).",
    takes: [
      rung("uwaaagh-0st.wav", 0, 0, "Death-yell-4's C, unchanged (Pitch 0, Size 1.15)."),
      rung("uwaaagh-minus3st.wav", -3, 0, "Pitch -3 st (Size 1.15)."),
      rung("uwaaagh-minus5st.wav", -5, 0, "Pitch -5 st (Size 1.15)."),
      rung("uwaaagh-minus7st.wav", -7, 0, "Pitch -7 st (Size 1.15)."),
      rung("uwaaagh-minus5st-size1.3.wav", -5 + 4.2 * Math.log2(1.3 / 1.15), 1.3, "Pitch -5 st AND a bigger throat (Size 1.3: every formant ~12% lower, so a darker, bigger man; the Pitch row reads -4.26 because Size alone would lower f0 another 0.74 st)."),
    ] };
  return R;
}

function README_TEXT(ROUNDS, ORDER) {
  const rows = ORDER.map((n, i) => "| " + (i + 1) + " | " + n + " | " + ROUNDS[n].title + " | " + (ROUNDS[n].controlIsPreset ? "today's preset (KEY.md names it)" : "a build of today's engines (no preset is close)") + " |").join("\n");
  return `# Voice engine prototype: listening round

A PROTOTYPE engine, "voice" (human cries: grunts, jump and attack shouts, battle cries, hurt, death yells, screams), against
today's sounds. Made by \`node tools/proto/voice.mjs\` (the model, \`makeVoice\`, and this round are both in that file).
Nothing in the app changed.

The bar is the 16-bit era's game voice clip: compressed, crunchy, a little synthetic. Not a film recording.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one you would put in a game, and a runner-up. **One take in each folder is
the control**: today's preset where one is close (Enemy Death, Distant Scream), otherwise the best build of today's
engines I could make (the creature engine as a human, or the speech engine). Then read \`KEY.md\`.

| # | folder | the sound | control |
|---|---|---|---|
${rows}

Each folder brackets the CHARACTER range with the same performance twice, plus a third design point:

- **clean**: the voice engine with no character stage (Lo-fi 0), dry;
- **16-bit**: the SAME cry (same seed, same script) through the 16-bit sampler stage: a hot saturation, stored at ~8.3 kHz
  (aliasing), 4-bit ADPCM, drop-sample playback, a slight hardware echo. This is how cartridges stored voice clips;
- **a third design point**: exaggerated and cartoonish, a bigger or different voice, or a different reading of the cry,
  through the WARM middle of the character stage (Lo-fi 0.4-0.45: a close-mic saturation, no sampler).

So within a folder you can also answer: does the crunch help? (clean vs 16-bit is the same performance.)

## What the engine is

A cry is a short SCRIPT: an onset consonant (h, t, k, p, b, d, g, a tapped r, y, w, m, n, f, s, or a hard glottal attack),
vowels (with consonants between them), and a coda (a glottal stop, a breath out, a creaky "gh", a t / k / p, an f, or a
trail-off), plus a pitch gesture and an effort curve. A planner turns it into the targets of a source-filter voice: a
glottal pulse whose shape follows the effort (breathy .. pressed), with jitter, shimmer, slow pitch drift and an effort
tremor; ROUGHNESS that period-doubles into chaos (with a random 30-150 Hz flutter and voice breaks), which is what makes a
scream a scream rather than a high note; vocal fry for creaks; breath; a vocal tract that moves through the vowels and
consonant positions; stop bursts and frication. Voices: man, woman, kid, with age (young .. old) and size.

## Cues that are not the question

- **Mono and mostly dry**: the model takes are mono (as game clips were). Only the falling scream has a room (a pit), on
  the clean and woman takes; its 16-bit take uses the sampler's echo instead. The controls keep their own effects (Distant
  Scream has a big reverb and echo).
- **Lengths** differ a little (the 16-bit takes carry ~0.2-0.3 s of echo tail).
- **Words**: nothing is spoken; the syllables are the cry's own sounds.
`;
}
