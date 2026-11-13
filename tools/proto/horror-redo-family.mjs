/* horror-redo-family.mjs — the 31 combinatorial HORROR presets (Ghastly Murmur, Creeping Toll, ... Wretched Murmur)
 * rebuilt from TWO TABLES, composed, onto the engines built since they were made. PROPOSAL / A-B material: nothing here
 * is wired into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better.
 *
 *   node tools/proto/horror-redo-family.mjs            renders every sound (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/horror-redo-family.mjs ref        measures today's Horror section (the level bar and today's spread)
 *   node tools/proto/horror-redo-family.mjs sep        separation only (renders the new ones, prints the pairs, writes nothing)
 *   node tools/proto/horror-redo-family.mjs <slug>     one sound, measured, written (no JSON, no all-new.wav)
 *   node tools/proto/horror-redo-family.mjs try '<patch json>'   measure one patch, nothing written
 *
 * WHY. Today the 31 are plain oscillators (sine / saw / square / triangle, one pluck, one noise) through a filter and a
 * reverb, bred at random in 2026-07: a "Toll" is a square wave, a "Wail" a 1.5 kHz half-sine burst, a "Groan" a 1.9 kHz
 * saw, and many are near-duplicates (the same ring-mod-at-75-Hz bandpass patch under four names). The names are an
 * ADJECTIVE (how the thing is wrong) times a NOUN (what the thing is), so:
 *   NOUN = the EVENT and the ENGINE that makes it:
 *          Toll / Knell   bells (the modal engine, 10): a toll is ONE heavy strike ringing free (clang + hum an octave
 *                         down + the minor-third tierce that makes a bell sound like a bell, three layers); a knell is the
 *                         slow FUNERAL bell: three strikes, half-muffled (each strike damped by its envelope, its hum
 *                         riding the same envelope), so it is repeated and dark where a toll is single and open
 *          Wail / Moan / Groan / Shriek / Murmur   the VOICES of ghosts and the dead: the creature engine (28: a larynx
 *                         and a moving tract). wail = a long falling "ee-oo" with vibrato; moan = low sustained closed
 *                         "mm-oo"; groan = a low rough "uh" that sags; shriek = high, harsh, short "ee"; murmur = three
 *                         voices of short indistinct syllables overlapping (a burst each, three pitches, three vowels)
 *          Pulse          a low throb: ABSTRACT by nature, so it stays an OSCILLATOR (a driven sine throb with a pitch-
 *                         dropping body per beat) over an impact-engine (19) thud per beat
 *          Stinger        a sudden layered hit: an impact (19) with a heavy boom, and a bowed (22) screech near the bridge
 *          Rattle         bones: a particle (15) clatter of dry knocks at random times, a modal (10) bone-knock burst and
 *                         an impact (19) tap burst at other rates, so together they are irregular
 *   ADJ  = the TREATMENT, the same rule on every noun: a pitch and time multiplier, a slow onset (Creeping), the body and
 *          larynx of a voice, a bell's metal, a crawl (a slow rattle / tremolo), a filter (Ghastly thin: high-pass; Hollow
 *          resonant: band-pass; Forsaken / Dreadful distant / huge: low-pass), crunch (Rotting gritty, Wretched cracked), a
 *          ring mod at a tritone (Cursed), a space and an echo, and at most ONE extra layer: air (Ghastly: a thin wind),
 *          hiss (Whispering: breath shaped to the noun's own envelope), wet (Rotting: low gloops), sub (Dreadful: a sub
 *          swell), double (Cursed: the noun's lead voice again at a wrong interval)
 * and compose() is the only place they meet. A collision between two names is a table entry not doing its job.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does, Normalize
 * ON and NOT loudness-matched: each WAV is what the app's button plays. The one per-name number not from the tables is
 * `gain` on layer 1, a trim that lands the integrated loudness on today's Horror-section median plus the adjective's and
 * the noun's stated level offsets (a Limiter only where gain 1 cannot reach it).
 *
 * Writes soundtests/horror-redo/family/<slug>-1-now.wav, <slug>-2-new.wav, all-new.wav + KEY.md, and
 * tools/new-presets/horror-redo-family.json ({ name: patch with _vary and layers }).
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
const PRESETS = pctx.window.PRESETS, CATS = pctx.window.PRESET_CATEGORIES;

const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };
const semis = (st) => Math.pow(2, st / 12);

// ============================================================================================================
// THE SCOPE: the 31 (exact names, presets.js order). The other 29 Horror sounds and the robots are other rounds.
const NAMES = ["Ghastly Murmur", "Creeping Toll", "Creeping Murmur", "Hollow Wail", "Rotting Knell", "Dreadful Knell", "Forsaken Moan",
  "Hollow Shriek", "Cursed Stinger", "Forsaken Groan", "Forsaken Pulse", "Rotting Pulse", "Rotting Shriek", "Whispering Shriek",
  "Forsaken Murmur", "Dreadful Wail", "Ghastly Moan", "Cursed Groan", "Dreadful Moan", "Cursed Wail", "Dreadful Toll", "Hollow Groan",
  "Whispering Pulse", "Forsaken Wail", "Whispering Groan", "Wretched Wail", "Ghastly Groan", "Whispering Murmur", "Hollow Rattle",
  "Rotting Toll", "Wretched Murmur"];
const HORROR = CATS.find((c) => c[0] === "Horror")[1];

// ============================================================================================================
// THE LAYER VOICES. Every layer: drive 0 unless asked (the default 0.1 is a tanh(5x) nobody asked for), the filter open
// (LP at 12 kHz, reso 0: the chain's filter cannot be bypassed), width 0.5.
const CHASSIS = () => ({ filterMode: 0, cutoff: 12000, reso: 0, drive: 0, width: 0.5 });
// the envelope, held inside its rows' ranges (attack 0.5 s, hold 1 s, decay 1 s, release 1.5 s at most): Creeping's onset
// asks for more than 0.5 s on a long call and gets the row's maximum
function env(o) { return { attack: r3(cl(o.atk ?? 0.005, 0, 0.5)), hold: r3(cl(o.hold ?? 0, 0, 1)), decay: r3(cl(o.dec ?? 0, 0, 1)), sustain: r2(o.sus ?? 1),
  release: r3(cl(o.rel ?? 0.2, 0, 1.5)), duration: r2(cl(o.dur, 0.05, 2)) }; }
function burst(p, repeat, rate) { if (repeat > 1) { p.repeat = repeat; p.rate = r2(rate); } return p; }
// a creature voice (wave 28)
function creature(o) {
  const p = Object.assign({ wave: 28, freq: Math.round(cl(o.f, 20, 4000)), crSize: r2(cl(o.size, 0.3, 3)),
    crPitchStart: r2(o.pS), crPitchEnd: r2(o.pE), crPeak: r2(o.peak),
    crOpenStart: r2(cl(o.oS, 0, 1)), crOpenPeak: r2(cl(o.oP, 0, 1)), crOpenEnd: r2(cl(o.oE, 0, 1)),
    crVowelStart: r2(cl(o.vS, 0, 1)), crVowelEnd: r2(cl(o.vE, 0, 1)),
    crTension: r2(cl(o.tension, 0, 1)), crJitter: r2(cl(o.jitter, 0, 1)), crShimmer: r2(cl(o.shimmer, 0, 1)),
    crRough: r2(cl(o.rough, 0, 1)), crBreath: r2(cl(o.breath, 0, 1)) }, CHASSIS(), env(o));
  if (o.nasal > 0) p.crNasal = r2(cl(o.nasal, 0, 1));
  if (o.flutter > 0) { p.crFlutter = r2(cl(o.flutter, 0, 0.9)); p.crFlutterRate = r2(cl(o.flRate, 2, 60)); }
  if (o.vib > 0) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate); }
  return burst(p, o.repeat || 1, o.rate);
}
// a struck bell or bone (the modal engine, wave 10): `inh` 0 harmonic .. 1 free-bar modes, `ring` the fundamental's decay.
// A bell's CLANG keeps the shipped bells' drive 0.12 (every modal bell preset runs the default 0.1): undriven, all its
// partials start in phase, the first milliseconds set the peak, and Normalize leaves it ~10 dB quieter and darker
// (Church Bell measured -5.2 LUFS driven, -14.9 undriven)
function modal(o) {
  const p = Object.assign({ wave: 10, freq: Math.round(cl(o.f, 20, 4000)), modalPartials: o.partials, modalInharm: r2(cl(o.inh, 0, 1)),
    modalDecay: r2(cl(o.ring, 0.05, 3)), modalBright: r2(cl(o.bright, 0, 1)) }, CHASSIS(), env(o));
  if (o.drive) p.drive = r2(o.drive);
  if (o.sub) p.subOsc = r2(o.sub);
  if (o.envCurve) p.envCurve = r2(o.envCurve);
  return burst(p, o.repeat || 1, o.rate);
}
// an oscillator throb (wave 0 sine, driven for harmonics a small speaker can play) with a pitch-dropping body per beat
function throb(o) {
  const p = Object.assign({ wave: o.wave ?? 0, freq: Math.round(o.f), boom: r2(o.boom), boomFreq: Math.round(o.boomF), boomDrop: r2(o.boomDrop ?? 0.6),
    boomDecay: r2(o.boomDecay ?? 0.25) }, CHASSIS(), { drive: r2(o.drive ?? 0.35), driveOS: 2, cutoff: Math.round(o.cut ?? 900) }, env(o));
  return burst(p, o.repeat || 1, o.rate);
}
// an impact transient (wave 19), optionally with the boom stage
function impact(o) {
  const p = Object.assign({ wave: 19, impactTone: r2(o.tone), impactDecay: r2(o.decay), impactPunch: r2(o.punch), impactGrit: r2(o.grit ?? 0) },
    CHASSIS(), env(o));
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(o.boomF), boomDrop: r2(o.boomDrop ?? 0.6), boomDecay: r2(o.boomDecay ?? 0.4) });
  return burst(p, o.repeat || 1, o.rate);
}
// a particle cloud (wave 15): clatter (sparse, driven) or hiss (dense, bright, high-passed)
function particle(o) {
  const p = Object.assign({ wave: 15, particleRate: Math.round(cl(o.rate, 5, 200)), particleTone: r2(cl(o.tone, 0, 1)), particleDecay: r2(cl(o.decay, 0, 1)),
    particleSpread: r2(cl(o.spread ?? 0.6, 0, 1)) }, CHASSIS(), { drive: r2(o.drive ?? 0), width: o.width ?? 0.7 }, env(o));
  if (o.hp) Object.assign(p, { filterMode: 1, cutoff: Math.round(o.hp) });
  return burst(p, o.repeat || 1, o.burstRate);
}
// a bowed string (wave 22)
function bowed(o) {
  const p = Object.assign({ wave: 22, freq: Math.round(o.f), bowSpeed: r2(o.speed), bowPressure: r2(o.pressure), bowPos: r2(o.pos), bowTone: r2(o.tone),
    bowString: r2(o.string ?? 0.17) }, CHASSIS(), env(o));
  if (o.vib) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate); }
  if (o.trem) { p.bowTrem = r2(o.trem); }
  return p;
}
// the weather engine's wind (wave 29): a thin air bed
function wind(o) {
  return Object.assign({ wave: 29, wxType: 0, wxIntensity: r2(o.int), wxGust: r2(o.gust), wxGustRate: r2(o.gustRate), wxTone: r2(o.tone), wxBody: r2(o.body ?? 0.1),
    wxWhistles: 0, wxWhistle: 0, wxSeed: o.seed }, CHASSIS(), { width: 0.8 }, env(o));
}
// the bubble engine (wave 14): low wet gloops
function gloop(o) {
  return Object.assign({ wave: 14, freq: Math.round(o.f), bubbleRate: Math.round(o.rate), bubbleRise: r2(o.rise ?? 0.3), bubbleSpread: r2(o.spread ?? 0.6),
    bubbleDecay: r2(o.decay ?? 0.5) }, CHASSIS(), { drive: 0.25, driveOS: 2, cutoff: Math.round(o.cut ?? 2500) }, env(o));
}
// A sound = layer 1's patch + layers 2-4 as the JSON string the app stores ({ s, d, g, p: 0, m: 0 })
function sound(list) {
  const [first, ...rest] = list;
  if (rest.length > 3) throw new Error("more than 4 layers");
  const p = Object.assign({}, first.s);
  if (rest.length) p.layers = JSON.stringify(rest.map((l) => ({ s: l.s, d: r3(l.d), g: r2(l.g), p: 0, m: 0 })));
  return p;
}
// every key of every layer inside its PARAMS row's range (a value past a slider's end would load clamped in the app)
const PROW = {}; for (const r of CS.PARAMS) PROW[r[0]] = r;
function outOfRange(p) {
  const bad = [], one = (q, tag) => { for (const [k, v] of Object.entries(q)) { const r = PROW[k]; if (r && typeof v === "number" && (v < r[2] - 1e-9 || v > r[3] + 1e-9)) bad.push(tag + k + " " + v + " (" + r[2] + ".." + r[3] + ")"); } };
  one(p, ""); if (p.layers) JSON.parse(p.layers).forEach((l, i) => one(l.s, "L" + (i + 2) + "."));
  return bad;
}
// a stable small seed per name
const seedOf = (s, salt = 0) => { let h = 2166136261 ^ salt; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % 997 + 1; };

// ============================================================================================================
// THE TWO TABLES
//
// ADJ: the treatment, stated once, applied by compose() to whatever the noun built.
//   fMul     every pitch (a voice's, a bell's, a throb's, a screech's) x this
//   tMul     every time (envelopes, call lengths, a burst's period, a bell's ring, the delays between layers) x this
//   onset    a slow onset: every layer's attack is at least this share of its sounding time (Creeping creeps in)
//   size     a voice's body (crSize; 1 = a person)
//   rough / jitter / shimmer / breath   ADDED to a voice's larynx (rough through the noun's roughMul); tension ADDED
//   crawl    [depth, Hz]: a slow rattle on a voice (crFlutter), a tremolo on any other layer
//   waver    vibrato depth added to a voice (vibDepth units; 0.05 ~ +/-30 cents) at wRate Hz
//   metal    a bell's metal: inh added to its inharmonicity, bright added, ringMul on its ring, muffle [decay s, sustain]
//            a damping envelope on every bell layer (a cracked bell rings dead: its drive would otherwise hold the tail up)
//   filter   [mode, Hz, reso] on EVERY layer (1 high-pass: thin; 2 band-pass: a resonant hollow; 0 low-pass: far, huge)
//   drive / crush / down   crunch on every layer: drive (tanh), bit depth, downsample
//   ring     ring-mod mix on every pitched layer, its carrier at the layer's pitch x 1.414 (a tritone: the wrong partner)
//   space    [reverb mix, size, tone] on every layer
//   echo     [delay mix, time s, feedback] on every layer
//   sparse   a burst's count and a murmur's voices x this (rounded, at least 1 / 2)
//   extra    the ONE layer the treatment adds (if the noun leaves room): air / hiss / wet / sub / double; extraG its volume
//   lvl      dB against the section median: Whispering and Forsaken sit under it, Dreadful over it, by design
const ADJ = {
  Ghastly:    { fMul: 1.22, tMul: 1.0,  onset: 0,    size: 0.82, rough: -0.15, jitter: 0.1,  shimmer: 0.35, breath: 0.5,  tension: -0.15,
                waver: 0.02, wRate: 3.2, metal: { inh: 0, bright: 0.15, ringMul: 0.9 },
                filter: [1, 420, 0.1], space: [0.5, 0.9, 0.75], extra: "air", extraG: 0.35, lvl: 0 },
  Creeping:   { fMul: 0.8,  tMul: 1.3,  onset: 0.5,  size: 1.3,  rough: 0.05, jitter: 0.15, shimmer: 0.1,  breath: 0.15, tension: -0.05,
                crawl: [0.42, 5.5], metal: { inh: 0.05, bright: -0.25, ringMul: 1.1 },
                filter: [0, 2600, 0.15], space: [0.3, 0.75, 0.3], lvl: -0.5 },
  Hollow:     { fMul: 1.0,  tMul: 1.1,  onset: 0,    size: 1.05, rough: 0,    jitter: 0.05, shimmer: 0.05, breath: 0.1,  tension: 0,
                metal: { inh: -0.1, bright: 0.05, ringMul: 1.2 },
                filter: [2, 950, 0.58], space: [0.5, 0.9, 0.55], echo: [0.32, 0.11, 0.55], lvl: 0 },
  Rotting:    { fMul: 0.92, tMul: 1.05, onset: 0,    size: 1.15, rough: 0.38, jitter: 0.4,  shimmer: 0.35, breath: 0.2,  tension: 0.1,
                metal: { inh: 0.2, bright: -0.05, ringMul: 0.5, muffle: [0.45, 0.06] },
                filter: [0, 5000, 0.1], drive: 0.38, crush: 9, down: 2, space: [0.28, 0.6, 0.35], extra: "wet", extraG: 0.6, lvl: 0 },
  Dreadful:   { fMul: 0.72, tMul: 1.4,  onset: 0,    size: 1.6,  rough: 0.06, jitter: 0.1,  shimmer: 0.1,  breath: 0.2,  tension: 0.1,
                metal: { inh: 0.05, bright: -0.1, ringMul: 1.4 },
                filter: [0, 3200, 0.1], space: [0.5, 0.96, 0.22], extra: "sub", extraG: 0.4, lvl: 1.5 },
  Forsaken:   { fMul: 0.95, tMul: 1.15, onset: 0,    size: 0.95, rough: -0.05, jitter: 0.1, shimmer: 0.15, breath: 0.2,  tension: -0.1,
                waver: 0.01, wRate: 4.2, metal: { inh: 0, bright: -0.1, ringMul: 1.2 },
                filter: [0, 1250, 0.1], space: [0.8, 0.98, 0.25], echo: [0.3, 0.45, 0.5], sparse: 0.6, lvl: -2.5 },
  Cursed:     { fMul: 0.97, tMul: 1.1,  onset: 0,    size: 1.1,  rough: 0.1,  jitter: 0.1,  shimmer: 0.1,  breath: 0.1,  tension: 0.15,
                waver: 0.03, wRate: 7.3, metal: { inh: 0.1, bright: 0, ringMul: 1 },
                ring: 0.35, space: [0.52, 0.92, 0.35], extra: "double", extraG: 0.6, interval: 6, lvl: 0 },
  Whispering: { fMul: 1.05, tMul: 0.95, onset: 0,    size: 0.9,  rough: -0.5, jitter: 0.05, shimmer: 0.1,  breath: 1.0,  tension: -0.35,
                metal: { inh: 0, bright: 0, ringMul: 1 },
                filter: [1, 160, 0.1], space: [0.16, 0.4, 0.6], extra: "hiss", extraG: 1.6, lvl: -4 },
  Wretched:   { fMul: 1.08, tMul: 0.95, onset: 0,    size: 1.0,  rough: 0.28, jitter: 0.75, shimmer: 0.6,  breath: 0.3,  tension: 0.2,
                crawl: [0.38, 13], waver: 0.05, wRate: 8.5, metal: { inh: 0.1, bright: 0, ringMul: 0.8 },
                drive: 0.45, crush: 10, space: [0.25, 0.55, 0.45], lvl: 0 },
};

// NOUN: the event, for a plain adjective (fMul 1, tMul 1). `kind` picks the builder below; `lvl` dB against the median.
//   voice:  f (Hz, the PEAK of the contour), pS / peak / pE (semitones about it, peak position), oS / oP / oE (mouth),
//           vS / vE (vowel 0 "ee" .. 1 "oo"), nasal, the larynx (tension, jitter, shimmer, rough, breath; roughMul
//           scales the ADJECTIVE's roughness first: a tonal call stays tonal), flutter / flRate, vib / vibRate, the
//           envelope (dur, atk, rel; or a shot: hold, dec with repeat / rate), and `voices`: [{ p semitones, d delay s,
//           g volume, size, vS, vE, rate }] (one entry = one voice)
//   bell:   f, partials, inh, ring (s), bright; strikes / gap (s); hum and tierce volumes (0 = no layer); muffle (the strike's
//           envelope: [decay s, sustain] 0 = rings free) and sub (a hum inside each strike)
//   pulse / stinger / rattle: their own numbers, read by their builders
const NOUN = {
  Wail:    { kind: "voice", f: 560, pS: -2, peak: 0.2, pE: -9, oS: 0.4, oP: 0.85, oE: 0.3, vS: 0.05, vE: 0.95, nasal: 0,
             tension: 0.5, jitter: 0.1, shimmer: 0.1, rough: 0, roughMul: 0.4, breath: 0.15, vib: 0.025, vibRate: 5.3,
             dur: 1.8, atk: 0.12, rel: 0.45, voices: [{ p: 0, d: 0, g: 1 }] },
  Moan:    { kind: "voice", f: 165, pS: -2, peak: 0.45, pE: -4, oS: 0.08, oP: 0.5, oE: 0.12, vS: 0.85, vE: 1.0, nasal: 0.5,
             tension: 0.35, jitter: 0.15, shimmer: 0.15, rough: 0.05, roughMul: 0.5, breath: 0.25, vib: 0.012, vibRate: 4,
             dur: 1.9, atk: 0.3, rel: 0.5, voices: [{ p: 0, d: 0, g: 1 }] },
  Groan:   { kind: "voice", f: 110, pS: 0.5, peak: 0.22, pE: -6, oS: 0.35, oP: 0.58, oE: 0.22, vS: 0.5, vE: 0.6, nasal: 0.1,
             tension: 0.6, jitter: 0.3, shimmer: 0.3, rough: 0.32, roughMul: 1, breath: 0.25, flutter: 0.18, flRate: 17,
             dur: 1.4, atk: 0.07, rel: 0.3, voices: [{ p: 0, d: 0, g: 1 }] },
  Shriek:  { kind: "voice", f: 1150, pS: -3, peak: 0.15, pE: -8, oS: 0.6, oP: 1.0, oE: 0.45, vS: 0.04, vE: 0.12, nasal: 0,
             tension: 0.85, jitter: 0.2, shimmer: 0.2, rough: 0.3, roughMul: 1, breath: 0.25,
             dur: 0.7, atk: 0.012, rel: 0.14, voices: [{ p: 0, d: 0, g: 1 }] },
  Murmur:  { kind: "voice", f: 200, pS: 1, peak: 0.35, pE: -2, oS: 0.1, oP: 0.32, oE: 0.08, vS: 0.5, vE: 0.5, nasal: 0.35,
             tension: 0.4, jitter: 0.2, shimmer: 0.2, rough: 0.05, roughMul: 0.5, breath: 0.3,
             shot: true, atk: 0.025, hold: 0.06, dec: 0.1, rel: 0.05, repeat: 5,
             voices: [{ p: 0, d: 0, g: 1, size: 1, vS: 0.3, vE: 0.55, rate: 5.6 },
                      { p: -4, d: 0.11, g: 0.8, size: 1.15, vS: 0.8, vE: 0.6, rate: 4.7 },
                      { p: 3, d: 0.26, g: 0.7, size: 0.9, vS: 0.15, vE: 0.4, rate: 6.3 }] },
  Toll:    { kind: "bell", f: 262, partials: 12, inh: 0.8, ring: 2.6, bright: 0.86, strikes: 1, hum: 0.55, tierce: 0.5, muffle: null, dur: 2.0 },
  Knell:   { kind: "bell", f: 311, partials: 10, inh: 0.72, ring: 1.6, bright: 0.74, strikes: 3, gap: 0.95, hum: 0, tierce: 0, muffle: [0.6, 0.06], sub: 0.25, dur: 1.4 },
  Pulse:   { kind: "pulse", f: 55, beats: 4, rate: 1.7, atk: 0.07, hold: 0.04, dec: 0.32, rel: 0.1, boom: 0.7, boomF: 62, thud: 0.65, drive: 0.45, cut: 1400 },
  Stinger: { kind: "stinger", lvl: 2, hitTone: 0.35, hitDecay: 0.55, punch: 0.9, grit: 0.45, boom: 0.85, boomF: 48, f: 1245, dur: 1.7 },
  Rattle:  { kind: "rattle", dur: 1.3, clatter: 26, knock: 760, knockRate: 11.5, knockN: 10, tapRate: 15, tapN: 12 },
};

// Per-name overrides: only where composition genuinely fails, each with its reason. (None needed: see the report.)
const OVERRIDES = {};

// ============================================================================================================
// THE COMPOSER. The rules, all of them:
//   pitch      every pitched layer's freq = the noun's x adj.fMul (a murmur's voices at their own offsets)
//   time       every time x adj.tMul (attack, hold, decay, release, a call's length, a burst's period, a bell's ring, the
//              delays between layers); a patch is never longer than 2 s (its release kept), layers stack past it
//   onset      attack = max(the noun's, onset x the layer's sounding time); a bell keeps its STRIKE (a modal ring decays
//              from the strike, so a slow attack would let the clang die unheard) and its hum and tierce creep in
//   voice      size = adj.size x the voice's own; larynx = noun + adj (rough = noun + adj x roughMul), clamped 0..1;
//              flutter = the louder of the noun's and the adjective's crawl; vibrato = noun + adj.waver (the adjective's
//              rate when it brings one)
//   bell       inh += metal.inh, bright += metal.bright, ring x metal.ringMul x tMul (3 s max); a toll is clang + hum
//              (one partial an octave down, ringing 1.15x longer) + tierce (two partials a minor third up, 0.85x the ring);
//              a knell's strikes are `gap` x tMul apart (at most 1 s: the
//              renderer caps a layer's delay at 2 s), each damped by the muffle envelope with its sub-octave hum inside
//   crawl      on a non-voice layer: a tremolo at the crawl's rate and depth; failing a crawl, a roughness over 0.2 is a
//              CRACK'S BUZZ there (a 37 Hz tremolo at that depth: a cracked bell, a rotten throb, a rattle)
//   filter / crunch / ring / space / echo   on every layer, as stated in ADJ (ring only on pitched layers)
//   sparse     a burst's count and a murmur's voice count x sparse (at least 1 shot / 2 voices)
//   extra      if the noun left room (< 4 layers):
//                air    a thin high wind over the sound's span
//                hiss   a particle hiss with LAYER 1's own envelope and burst (a whisper shaped like what it whispers)
//                wet    low gloops over the span, thinning (to 0.3 over half of it)
//                sub    a 36 Hz sine swell with layer 1's envelope and a boom per shot; on a BELL no layer but a Body boom
//                       at 44 Hz inside every strike (a knell's strikes are layers, and a burst cannot space them > 1 s)
//                double the noun's lead VOICE (the first voice layer: a stinger's screech, not its hit) again at
//                       `interval` semitones (the wrong interval), answering 0.1 s (x tMul) late
//   level      gain on layer 1: the trim to the section median + adj.lvl + noun.lvl (see the header)
function compose(name) {
  const [adjName, nounName] = name.split(" ");
  const A = ADJ[adjName], N = NOUN[nounName];
  if (!A || !N) throw new Error("no table entry for " + name);
  const t = A.tMul, layers = [];
  const onsetAtk = (atk, len) => Math.max(atk, (A.onset || 0) * len);
  const fitDur = (o) => { if (o.dur > 2) { o.dur = 2; } return o; };   // one patch is at most 2 s; its release is kept by the envelope
  if (N.kind === "voice") {
    let voices = N.voices;
    if (A.sparse && voices.length > 1) voices = voices.slice(0, Math.max(2, Math.round(voices.length * A.sparse)));
    for (const v of voices) {
      const o = { f: N.f * A.fMul * semis(v.p), size: A.size * (v.size || 1), pS: N.pS, pE: N.pE, peak: N.peak, oS: N.oS, oP: N.oP, oE: N.oE,
        vS: v.vS ?? N.vS, vE: v.vE ?? N.vE, nasal: N.nasal,
        tension: N.tension + A.tension, jitter: N.jitter + A.jitter, shimmer: N.shimmer + A.shimmer,
        rough: N.rough + A.rough * (N.roughMul ?? 1), breath: N.breath + A.breath };
      const nf = N.flutter || 0, af = A.crawl ? A.crawl[0] : 0;
      if (nf + af > 0) { o.flutter = Math.max(nf, af) + 0.3 * Math.min(nf, af); o.flRate = af > nf ? A.crawl[1] : N.flRate; }
      const vib = (N.vib || 0) + (A.waver || 0);
      if (vib > 0) { o.vib = vib; o.vibRate = A.waver ? A.wRate : N.vibRate; }
      if (N.shot) {
        const rep = Math.max(1, Math.round(N.repeat * (A.sparse || 1))), rate = v.rate / t;
        const call = (N.atk + N.hold + N.dec) * t;
        Object.assign(o, { atk: onsetAtk(N.atk * t, call), hold: N.hold * t, dec: N.dec * t, sus: 0, rel: N.rel * t, repeat: rep, rate,
          dur: (rep - 1) / rate + call + N.rel * t + 0.08 });
      } else {
        const len = N.dur * t;
        Object.assign(o, { atk: onsetAtk(N.atk * t, len), hold: 0, dec: 0, sus: 1, rel: N.rel * t, dur: len });
      }
      layers.push({ s: creature(fitDur(o)), d: v.d * t, g: v.g, pitched: true, voice: true });
    }
  } else if (N.kind === "bell") {
    const f = N.f * A.fMul, inh = N.inh + A.metal.inh, bright = N.bright + A.metal.bright, ring = Math.min(3, N.ring * A.metal.ringMul * t);
    if (N.strikes === 1) {
      const dur = N.dur, [mDec, mSus] = A.metal.muffle || [0.1, 1], m = { hold: 0.01, dec: mDec, sus: mSus, rel: 0.6, dur, envCurve: A.metal.muffle ? 0.6 : 0 };
      layers.push({ s: modal(Object.assign({ f, partials: N.partials, inh, ring, bright, drive: 0.12, atk: 0.002 }, m)), d: 0, g: 1, pitched: true, strike: true });
      if (N.hum) layers.push({ s: modal(Object.assign({ f: f / 2, partials: 1, inh: 0, ring: Math.min(3, ring * 1.15), bright: 0.5, atk: onsetAtk(0.004, dur) }, m)), d: 0, g: N.hum, pitched: true });
      if (N.tierce) layers.push({ s: modal(Object.assign({ f: f * semis(3), partials: 2, inh: 0.1, ring: ring * 0.85, bright: 0.4, atk: onsetAtk(0.003, dur) }, m)), d: 0, g: N.tierce, pitched: true });
    } else {
      const gap = Math.min(N.gap * t, 2 / (N.strikes - 1)), dur = Math.min(2, N.dur * t), am = A.metal.muffle, [mDec, mSus] = am && am[0] * am[1] < N.muffle[0] * N.muffle[1] ? am : N.muffle;
      for (let k = 0; k < N.strikes; k++)
        layers.push({ s: modal({ f, partials: N.partials, inh, ring, bright, sub: N.sub, drive: 0.12, atk: 0.002, hold: 0.01, dec: Math.min(1, mDec * t), sus: mSus, rel: 0.35 * t, envCurve: 0.6, dur: k === N.strikes - 1 ? Math.min(2, dur * 1.3) : dur }),
          d: k * gap, g: 1 - 0.12 * k, pitched: true, strike: true });
    }
  } else if (N.kind === "pulse") {
    const beats = Math.max(2, Math.round(N.beats * (A.sparse || 1))), rate = N.rate / t;
    const e = { atk: N.atk * t, hold: N.hold * t, dec: N.dec * t, sus: 0, rel: N.rel * t };
    const dur = Math.min(2, (beats - 1) / rate + e.atk + e.hold + e.dec + e.rel + 0.1);
    e.atk = onsetAtk(e.atk, e.atk + e.hold + e.dec);
    layers.push({ s: throb(Object.assign({ f: N.f * A.fMul, boom: N.boom, boomF: N.boomF * A.fMul, boomDecay: N.dec * t, drive: N.drive, cut: N.cut, repeat: beats, rate, dur }, e)), d: 0, g: 1, pitched: true });
    layers.push({ s: impact(Object.assign({ tone: 0.12, decay: 0.3, punch: 0.25, repeat: beats, rate, dur }, e, { atk: 0.002, hold: 0.01, dec: N.dec * t * 0.8 })), d: 0, g: N.thud, pitched: false });
  } else if (N.kind === "stinger") {
    const dur = N.dur * t;
    layers.push({ s: impact({ tone: N.hitTone, decay: N.hitDecay, punch: N.punch, grit: N.grit, boom: N.boom, boomF: N.boomF * A.fMul, boomDrop: 0.9, boomDecay: 0.7, atk: 0.001, hold: 0.02, dec: 0.6, sus: 0.3, rel: 0.6, dur }), d: 0, g: 1, pitched: false });
    layers.push({ s: bowed({ f: N.f * A.fMul, speed: 0.9, pressure: 0.95, pos: 0.08, tone: 0.9, string: 0.1, vib: 0.02, vibRate: 6.5, atk: 0.004, hold: 0.08, dec: 0.7, sus: 0.3, rel: 0.5, dur }), d: 0.005, g: 0.95, pitched: true, voice: true });
  } else if (N.kind === "rattle") {
    const dur = N.dur * t, e = { atk: 0.01, hold: 0.05, dec: 0.75 * t, sus: 0.15, rel: 0.25 * t, dur };
    layers.push({ s: particle(Object.assign({ rate: N.clatter, tone: 0.6, decay: 0.06, spread: 0.85, drive: 0.35 }, e)), d: 0, g: 1, pitched: false });
    layers.push({ s: modal({ f: N.knock * A.fMul, partials: 4, inh: 0.95, ring: 0.09, bright: 0.55, atk: 0.001, hold: 0.004, dec: 0.05, sus: 0.3, rel: 0.03, repeat: Math.round(N.knockN * (A.sparse || 1)), rate: N.knockRate / t, dur }), d: 0.03, g: 0.85, pitched: true });
    layers.push({ s: impact({ tone: 0.55, decay: 0.05, punch: 0.7, grit: 0.2, atk: 0.001, hold: 0.003, dec: 0.04, sus: 0, rel: 0.02, repeat: Math.round(N.tapN * (A.sparse || 1)), rate: N.tapRate / t, dur: Math.min(2, dur * 0.95) }), d: 0.07, g: 0.6, pitched: false });
  }
  // ---- the treatment, on every layer
  for (const L of layers) {
    const p = L.s;
    if (A.filter) Object.assign(p, { filterMode: A.filter[0], cutoff: A.filter[1], reso: A.filter[2] });
    if (A.drive) { p.drive = r2(A.drive); p.driveOS = 2; }
    if (A.crush) p.bitcrush = A.crush;
    if (A.down) p.downsample = A.down;
    if (A.ring && L.pitched) { p.ringMod = r2(A.ring); p.ringFreq = Math.round(Math.min(2000, p.freq * 1.414)); }
    if (A.crawl && !L.voice) { p.tremDepth = r2(A.crawl[0]); p.tremRate = r2(A.crawl[1]); }
    else if (A.rough > 0.2 && !L.voice) { p.tremDepth = r2(A.rough); p.tremRate = 37; }   // a crack's buzz
    if (A.space) Object.assign(p, { reverb: r2(A.space[0]), reverbSize: r2(A.space[1]), reverbTone: r2(A.space[2]) });
    if (A.echo) Object.assign(p, { delay: r2(A.echo[0]), delayTime: r2(Math.min(0.5, A.echo[1] * t)), delayFb: r2(A.echo[2]) });
  }
  // ---- the one extra layer
  const span = Math.max(...layers.map((L) => L.d + L.s.duration)), first = layers[0].s;
  const shape = { atk: first.attack, hold: first.hold, dec: first.decay, sus: first.sustain, rel: first.release, dur: first.duration, repeat: first.repeat, rate: first.rate };
  if (A.extra === "sub" && N.kind === "bell") {   // a bell's sub is a Body boom inside each strike (a knell's strikes are layers)
    for (const L of layers) if (L.strike) Object.assign(L.s, { boom: 0.55, boomFreq: 44, boomDrop: 0.5, boomDecay: r2(Math.min(1.2, 0.8 * t)) });
  } else if (A.extra && layers.length < 4) {
    let x = null;
    if (A.extra === "air") x = wind({ int: 0.32, gust: 0.55, gustRate: 1.1, tone: 0.82, body: 0.05, seed: seedOf(name), atk: Math.min(0.5, span * 0.25), sus: 1, rel: Math.min(1.2, span * 0.4), dur: Math.min(2, span) });
    if (A.extra === "hiss") x = particle({ rate: 190, tone: 0.82, decay: 0.05, spread: 0.35, hp: 1800, atk: shape.atk, hold: shape.hold, dec: shape.dec, sus: shape.sus,
      rel: shape.rel, dur: shape.dur, repeat: shape.repeat, burstRate: shape.rate });   // field by field: shape.rate is the BURST rate
    if (A.extra === "wet") x = gloop({ f: 140 * A.fMul, rate: 9, atk: 0.1, dec: Math.min(1, 0.5 * span), sus: 0.3, rel: 0.3, dur: Math.min(2, span) });
    if (A.extra === "sub") x = Object.assign(throb({ f: 36, boom: 0.6, boomF: 44, boomDrop: 0.5, boomDecay: 0.8, drive: 0.2, cut: 300, atk: shape.atk, hold: shape.hold, dec: shape.dec, sus: shape.sus, rel: shape.rel, repeat: shape.repeat, rate: shape.rate, dur: shape.dur }));
    if (A.extra === "double") { const lead = (layers.find((L) => L.voice) || layers[0]).s; x = Object.assign({}, lead, { freq: Math.round(lead.freq * semis(A.interval)) }); if (x.ringFreq) x.ringFreq = Math.round(Math.min(2000, x.freq * 1.414)); }
    if (x) {
      if (A.extra !== "double") {   // the treatment's space and filter on the extra layer too (its own filter kept for hiss)
        if (A.space) Object.assign(x, { reverb: r2(A.space[0]), reverbSize: r2(A.space[1]), reverbTone: r2(A.space[2]) });
        if (A.filter && A.extra !== "hiss" && A.extra !== "sub") Object.assign(x, { filterMode: A.filter[0], cutoff: A.filter[1], reso: A.filter[2] });
      }
      layers.push({ s: x, d: A.extra === "double" ? 0.1 * t : 0, g: A.extraG });
    }
  }
  const p = sound(layers);
  Object.assign(p, OVERRIDES[name] || {});
  return p;
}

// _vary: Variations of the PRESET BUTTON jitter layer 1's keys only (varyPreset), so a key that sets a relation between
// layers (a bell's pitch against its hum and tierce, a cursed voice against its double, a pulse's rate against its thud)
// is never varied; layer 1's own colour, length and body are.
function varyFor(p, name) {
  const w = Math.round(p.wave);
  const related = ADJ[name.split(" ")[0]].extra === "double";   // a voice and its double at a fixed (wrong) interval
  if (w === 28) {
    const v = { crSize: 0.06, crOpenPeak: 0.08, crPitchEnd: 0.04 };
    if (!related) v.freq = 0.04;
    if (p.crRough >= 0.3) v.crRough = 0.08;
    if (p.crFlutter) v.crFlutterRate = 0.1;
    return v;
  }
  if (w === 10) return { modalDecay: 0.1, modalBright: 0.1, modalInharm: 0.05 };
  if (w === 0) return { boomFreq: 0.08, boomDecay: 0.1, cutoff: 0.12, drive: 0.15 };
  if (w === 19) return { impactTone: 0.1, impactGrit: 0.15, boomFreq: 0.08, boomDecay: 0.1 };
  if (w === 15) return { particleRate: 0.15, particleTone: 0.08, particleSpread: 0.06 };
  return {};
}

// one line per sound for KEY.md (what to listen for)
const IDEA = {
  "Ghastly Murmur": "pale, thin voices murmuring: three breathy high-passed syllable streams over a faint wind",
  "Creeping Toll": "a low, soft-struck bell: its hum and minor-third tierce CREEP up after the strike, the ring crawling (a slow tremolo), dark",
  "Creeping Murmur": "low murmuring voices creeping in, a slow crawling rattle on each syllable, dark",
  "Hollow Wail": "a ghost's falling 'ee-oo' heard down a pipe: band-passed at 950 Hz, resonant, a short flutter echo",
  "Rotting Knell": "a cracked funeral bell: three muffled strikes that die early and buzz (the crack), gritty and crushed, wet gloops under the first",
  "Dreadful Knell": "a huge, low funeral bell: three muffled strikes a second apart, a sub boom inside each, long ring, a vast dark space",
  "Forsaken Moan": "a lonely closed 'mm-oo' far away: dark, long reverb, a slow echo answering",
  "Hollow Shriek": "a short harsh 'ee' shriek inside an empty space: band-passed, ringing, echoing",
  "Cursed Stinger": "the jump-scare hit: a heavy impact with a boom, a bowed screech near the bridge, a second screech a tritone up answering 0.1 s late",
  "Forsaken Groan": "a low rough 'uh' sagging, distant and dark, its echo coming back",
  "Forsaken Pulse": "a slow low throb far away: three beats in a long dark reverb, an echo between them",
  "Rotting Pulse": "a gritty low throb, crushed, driven and buzzing, wet gloops between the first beats",
  "Rotting Shriek": "a shriek gone rotten: rough, crushed and jittering, a wet gurgle under it",
  "Whispering Shriek": "a shriek HISSED: mostly breath, a hiss shaped like the shriek, close and quiet",
  "Forsaken Murmur": "two voices murmuring far away, few syllables, long reverb and a lonely echo (sits low)",
  "Dreadful Wail": "a huge slow low wail ('ee-oo' from a giant throat), clean, with a sub swell, vast dark space",
  "Ghastly Moan": "a pale, thin, airy 'mm-oo': breathy, wavering, high-passed, a wind behind it",
  "Cursed Groan": "a low rough groan, a second groan a tritone above answering it, ring-modded: wrong",
  "Dreadful Moan": "a giant's slow, clean 'mm-oo' well below a person's, a sub swell, vast dark space",
  "Cursed Wail": "a falling wail, a second wail a tritone up answering it, ring-modded and wobbling: a wrong chord",
  "Dreadful Toll": "a huge low bell: one heavy strike with a sub boom inside it, its hum and minor-third tierce ringing long",
  "Hollow Groan": "a groan down a pipe: band-passed resonance and an echo",
  "Whispering Pulse": "a pulse of breath: four hissed beats over a faint throb, close and quiet",
  "Forsaken Wail": "a lonely wail far away: dark, long reverb, a slow echo (sits low)",
  "Whispering Groan": "a groan breathed rather than voiced: breathy, close, a hiss shaped like it",
  "Wretched Wail": "a cracked, ragged wail: the voice breaking (jitter, rattle, fast wobble), driven and crushed",
  "Ghastly Groan": "a pale, thin groan: higher, breathy, high-passed, airy reverb and wind",
  "Whispering Murmur": "three whispering voices: breath-only syllables and a hiss in their rhythm, close (sits low)",
  "Hollow Rattle": "bones rattling inside something hollow: dry knocks at random over two knock bursts, band-passed, ringing, a flutter echo",
  "Rotting Toll": "a cracked, rotten bell: one strike of out-of-tune metal that dies early and BUZZES, gritty and crushed, wet gloops thinning out",
  "Wretched Murmur": "murmuring voices breaking up: jittery, rattling, cracked syllables",
};

// ============================================================================================================
// MEASUREMENT (loudness as tools/proto/new-wings-coil.mjs; spectrum and envelope as fire-redo.mjs; YIN as
// creature-redo-family.mjs)
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
// SPECTRUM: a 2048-point Hann FFT, EVERY bin (21.5 Hz apart) to 16 kHz. (fire-redo.mjs's measure correlates against
// bins 100 Hz apart, which is right for fire's noise and wrong here: a Hann window's main lobe is +/-43 Hz, so a bell
// partial or a voice harmonic between two of its bins all but vanished, and a tonal sound read as its fundamental alone.)
const SPN = 2048, SPH = new Float64Array(SPN);
for (let i = 0; i < SPN; i++) SPH[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SPN - 1));
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
function spectrum(x, a) {   // centroid, < 250 Hz share, > 4 kHz share, flatness 300 Hz-8 kHz
  const re = new Float64Array(SPN), im = new Float64Array(SPN);
  for (let i = 0; i < SPN; i++) re[i] = x[a + i] * SPH[i];
  fft(re, im);
  let num = 0, den = 0, lo = 0, hi = 0, lg = 0, ar = 0, nb = 0;
  for (let k = 1; k < SPN / 2; k++) {
    const f = k * SR / SPN; if (f > 16000) break;
    const m = re[k] * re[k] + im[k] * im[k]; num += f * m; den += m;
    if (f < 250) lo += m; if (f > 4000) hi += m;
    if (f >= 300 && f <= 8000) { lg += Math.log(m + 1e-20); ar += m; nb++; }
  }
  return { cent: den > 0 ? num / den : 0, lo: den > 0 ? lo / den : 0, hi: den > 0 ? hi / den : 0, flat: ar > 0 ? Math.exp(lg / nb) / (ar / nb) : 0 };
}
// YIN: frames above -40 dB of the peak report a pitch and an aperiodicity (0 clean periodic, toward 1 noise)
function yinTrack(x, fmin, fmax, hop = 0.025, win = 0.04, thr = 0.15) {
  const W = Math.round(win * SR), tauMax = Math.min(W - 2, Math.ceil(SR / fmin)), tauMin = Math.floor(SR / fmax), H = Math.round(hop * SR);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const out = [], d = new Float64Array(tauMax + 1), cm = new Float64Array(tauMax + 1);
  for (let a = 0; a + W + tauMax < x.length; a += H) {
    let e = 0; for (let i = 0; i < W; i++) e += x[a + i] * x[a + i];
    if (Math.sqrt(e / W) < pk * 0.01) continue;
    for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[a + i] - x[a + i + tau]; s += q * q; } d[tau] = s; }
    let run = 0, best = -1; cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = d[tau] * tau / (run || 1e-12); }
    for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < thr) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    if (best < 0) { let m = 1e9; for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; } }
    const a0 = cm[best - 1], b0 = cm[best], c0 = cm[best + 1] ?? b0, den = a0 - 2 * b0 + c0;
    const tt = den !== 0 ? best + 0.5 * (a0 - c0) / den : best;
    out.push({ t: a / SR, f: SR / tt, ap: b0 });
  }
  return out;
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
  const span = Math.max(0.02, (Math.min(n, last) - Math.max(0, first)) / SR);
  // 50 ms level envelope: peak position, attack (to -3 dB of the max), level left at 80% of the span, slow swell
  const E = Math.round(0.05 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / E + 1e-12)); }
  const mx = Math.max(...env), imx = env.indexOf(mx), f0i = Math.max(0, Math.floor(first / E));
  for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], mx - 50);
  let iatk = f0i; while (iatk < imx && env[iatk] < mx - 3) iatk++;
  const atk = Math.max(0.025, (iatk - f0i + 0.5) * 0.05);
  const i80 = Math.min(env.length - 1, Math.floor((first + 0.8 * span * SR) / E)), end80 = env[i80] - mx;
  let ws = 0, wn = 0;
  for (let i = 5; i < env.length - 5; i++) { if (env[i] < mx - 20) continue; let av = 0; for (let j = i - 5; j <= i + 5; j++) av += env[j]; av /= 11; ws += (env[i] - av) ** 2; wn++; }
  const swell = wn ? Math.sqrt(ws / wn) : 0;
  // bursts: 20 ms RMS rises 8 dB over the dip before them, within 20 dB of the max; a burst ends once the level has
  // fallen 10 dB under its own peak, at any speed (a bell's slow decay counts, which a 100 ms fall test missed)
  const E2 = Math.round(0.02 * SR), e20 = [];
  for (let a = 0; a + E2 <= n; a += E2) { let s = 0; for (let i = a; i < a + E2; i++) s += mono[i] * mono[i]; e20.push(10 * Math.log10(s / E2 + 1e-12)); }
  const mx2 = Math.max(...e20); let bursts = 0, dip = -200, up = false, top = -200;
  for (let i = 0; i < e20.length; i++) {
    const v = e20[i];
    if (!up) { dip = Math.min(dip, v); if (v > dip + 8 && v > mx2 - 20) { up = true; bursts++; top = v; } }
    else { top = Math.max(top, v); if (v < top - 10) { up = false; dip = v; } }
  }
  // texture: the 5 ms level against its 100 ms average (rattle, chaos, crackle)
  const E5 = Math.round(0.005 * SR), e5 = [];
  for (let a = 0; a + E5 <= n; a += E5) { let q = 0; for (let i = a; i < a + E5; i++) q += mono[i] * mono[i]; e5.push(10 * Math.log10(q / E5 + 1e-12)); }
  const m5 = Math.max(...e5); let ts = 0, tn = 0;
  for (let i = 0; i < e5.length; i++) e5[i] = Math.max(e5[i], m5 - 40);
  for (let i = 10; i < e5.length - 10; i++) { if (e5[i] < m5 - 30) continue; let av = 0; for (let j = i - 10; j <= i + 10; j++) av += e5[j]; av /= 21; ts += (e5[i] - av) ** 2; tn++; }
  const texture = tn ? Math.sqrt(ts / tn) : 0;
  // spectrum over the loud part (within 20 dB of the max), energy-weighted
  let cn = 0, cd = 0, lo = 0, hi = 0, fl = 0;
  for (let a = 0; a + SPN < n; a += Math.round(0.05 * SR)) {
    let e = 0; for (let i = a; i < a + SPN; i++) e += mono[i] * mono[i];
    if (10 * Math.log10(e / SPN + 1e-12) < mx - 20) continue;
    const s = spectrum(mono, a); cn += s.cent * e; lo += s.lo * e; hi += s.hi * e; fl += s.flat * e; cd += e;
  }
  // pitch: YIN over the part above -40 dB; a frame is VOICED under aperiodicity 0.3. Octave-folded to its neighbours.
  const tr = yinTrack(mono, 40, 2400), v = tr.filter((p) => p.ap < 0.3);
  if (v.length > 2) {
    const md = median(v.map((p) => p.f)); let c = 0, best = 1e9;
    v.forEach((p, i) => { const e = Math.abs(Math.log2(p.f / md)); if (e < best) { best = e; c = i; } });
    const fold = (f, ref) => { while (f / ref > 1.5) f /= 2; while (ref / f > 1.5) f *= 2; return f; };
    for (let i = c + 1; i < v.length; i++) v[i] = Object.assign({}, v[i], { f: fold(v[i].f, v[i - 1].f) });
    for (let i = c - 1; i >= 0; i--) v[i] = Object.assign({}, v[i], { f: fold(v[i].f, v[i + 1].f) });
  }
  const f0 = { median: median(v.map((p) => p.f)), voiced: v.length / Math.max(1, tr.length),
    start: median(v.slice(0, Math.max(1, Math.floor(v.length / 6))).map((p) => p.f)), end: median(v.slice(Math.floor(v.length * 5 / 6)).map((p) => p.f)) };
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R),
    cent: cd ? cn / cd : 0, lo: cd ? lo / cd : 0, hi: cd ? hi / cd : 0, flat: cd ? fl / cd : 0, ap: median(tr.map((p) => p.ap)),
    bursts, texture, swell, atk, maxAt: imx * 0.05 - first / SR, end80, f0 };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1) +
    "\n      centroid " + (m.cent / 1000).toFixed(2) + "k  <250Hz " + (100 * m.lo).toFixed(0) + "%  >4k " + (100 * m.hi).toFixed(0) + "%  flat " + m.flat.toFixed(3) +
    "  aper " + m.ap.toFixed(2) + "  f0 " + (isNaN(m.f0.median) ? "--" : m.f0.median.toFixed(0) + " (" + m.f0.start.toFixed(0) + ">" + m.f0.end.toFixed(0) + ")") +
    " voiced " + (100 * m.f0.voiced).toFixed(0) + "%" +
    "\n      bursts " + m.bursts + "  texture " + m.texture.toFixed(1) + " dB  swell " + m.swell.toFixed(1) + " dB  attack " + m.atk.toFixed(2) + " s  peak at " + m.maxAt.toFixed(2) + " s  at 80% " + m.end80.toFixed(0) + " dB";
}
// The feature vector for separation (units chosen so 1 = a clearly audible step):
//   length log2 of the audible span; bright log2 of the centroid; rumble / hiss the < 250 Hz / > 4 kHz shares x 3;
//   breath log2 of the flatness / 3; rough the aperiodicity x 2; texture dB / 3; swell dB / 2; attack log2(s) / 1.5;
//   peakpos 2 x its share of the span; tail dB at 80% / 12; bursts log2 of the count (1..8)
//   pitch: log2 of YIN's median when BOTH are voiced (>= 35% of their frames), else 0.75 when exactly one is (a pitched
//   sound against an unpitched one is a clear step), 0 when neither is. Distance is Euclidean over all twelve.
function features(m) {
  return { v: [Math.log2(m.span), Math.log2(Math.max(100, m.cent)), 3 * m.lo, 3 * m.hi, Math.log2(Math.max(1e-3, m.flat)) / 3, 2 * cl(m.ap, 0, 1),
    Math.min(m.texture, 9) / 3, Math.min(m.swell, 8) / 2, Math.log2(m.atk) / 1.5, 2 * cl(m.maxAt / m.span, 0, 1), cl(m.end80, -40, 0) / 12,
    Math.log2(cl(m.bursts, 1, 8))], pitch: m.f0.voiced >= 0.35 && !isNaN(m.f0.median) ? Math.log2(m.f0.median) : null };
}
const FEAT = ["length", "bright", "rumble", "hiss", "breath", "rough", "texture", "swell", "attack", "peakpos", "tail", "bursts", "pitch"];
function axes(a, b) {
  const d = a.v.map((x, i) => Math.abs(x - b.v[i]));
  d.push(a.pitch != null && b.pitch != null ? Math.abs(a.pitch - b.pitch) : (a.pitch != null) !== (b.pitch != null) ? 0.75 : 0);
  return d;
}
function dist(a, b) { return Math.sqrt(axes(a, b).reduce((s, x) => s + x * x, 0)); }
function why(a, b) { return axes(a, b).map((v, i) => [FEAT[i], v]).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => k + " " + v.toFixed(2)).join(", "); }

// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in steps
// of 0.05 (the smallest that reaches the target), as fire-redo.mjs
function level(p, target) {
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - m.lufs) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  let lo = 0, hi = 20;
  p.limiter = 1; m = measure(render(p));
  if (m.lufs < target - 0.4) return m;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); const mm = measure(render(p)); if (mm.lufs >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  for (let k = 0; k < 2; k++) { m = measure(render(p)); if (m.lufs > target + 0.3) p.gain = r2(p.gain * Math.pow(10, (target - m.lufs) / 20)); }
  return measure(render(p));
}

// ---- the references: today's Horror section (the level bar), and the creature presets a ghost voice must not copy
function refCreatures() {
  const out = [], am = CATS.find((c) => c[0] === "Animal / Monster")[1];
  for (const nm of am) { const p = PRESETS[nm]; if (!p || Math.round(p.wave) !== 28) continue; const b = Object.assign({}, p); delete b._vary; delete b._alts; out.push([nm, b]); }
  return out;
}

// ============================================================================================================
const arg = process.argv[2];
if (arg === "try") { console.log(fmt(measure(render(JSON.parse(process.argv[3]))))); process.exit(0); }
// layers <slug>: each layer of the composed sound alone (the others muted, the mix's own gain), so a layer that
// swamps the rest shows as the one within a dB of the whole
if (arg === "layers") {
  const name = NAMES.find((n) => slug(n) === process.argv[3]), p = compose(name); p.gain = 0.7;
  const all = measure(render(p)); console.log(name + " ALL  " + fmt(all));
  const ly = p.layers ? JSON.parse(p.layers) : [];
  for (let k = 0; k <= ly.length; k++) {
    const base = Object.assign({}, p); delete base.layers;
    const solo = k === 0 ? Object.assign(base, { gain: 0.7 }) : Object.assign({}, ly[k - 1].s, { gain: Math.min(1, 0.7 * ly[k - 1].g) });
    const m = measure(render(solo));
    console.log("  layer " + (k + 1) + " (wave " + solo.wave + ", g " + (k === 0 ? 1 : ly[k - 1].g) + ", d " + (k === 0 ? 0 : ly[k - 1].d) + ")  " + m.lufs.toFixed(1) + " LUFS, centroid " + (m.cent / 1000).toFixed(2) + "k, <250 " + (100 * m.lo).toFixed(0) + "%, span " + m.span.toFixed(2) + " s, bursts " + m.bursts);
  }
  process.exit(0);
}
// HTARGET=<lufs> skips measuring the 62 for a quick one-sound iteration (the full and sep runs always measure them)
const quick = process.env.HTARGET && arg && arg !== "sep" && arg !== "ref";
const horrorRows = HORROR.filter((name) => !quick || NAMES.includes(name) && slug(name) === arg).map((name) => { const m = measure(render(PRESETS[name])); return { name, m, f: features(m) }; });
const TARGET = quick ? +process.env.HTARGET : median(horrorRows.map((x) => x.m.lufs));
if (arg === "ref") {
  for (const x of horrorRows) console.log(x.name.padEnd(22) + fmt(x.m));
  const all = horrorRows.map((x) => x.m.lufs), fam = horrorRows.filter((x) => NAMES.includes(x.name)).map((x) => x.m.lufs);
  console.log("HORROR SECTION (" + all.length + ") median " + TARGET.toFixed(1) + " LUFS, range " + Math.min(...all).toFixed(1) + " to " + Math.max(...all).toFixed(1) +
    "; the 31: median " + median(fam).toFixed(1) + ", range " + Math.min(...fam).toFixed(1) + " to " + Math.max(...fam).toFixed(1));
  const p = []; const rf = horrorRows.filter((x) => NAMES.includes(x.name));
  for (let i = 0; i < rf.length; i++) for (let j = i + 1; j < rf.length; j++) p.push([rf[i].name, rf[j].name, dist(rf[i].f, rf[j].f), rf[i].f, rf[j].f]);
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY (the 31) closest pairs:"); for (const [a, b, d, fa, fb] of p.slice(0, 12)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2) + ", min " + p[0][2].toFixed(2));
  process.exit(0);
}
console.log("level target: today's Horror-section median " + TARGET.toFixed(1) + " LUFS over " + horrorRows.length + " presets");

const wavDir = join(ROOT, "soundtests", "horror-redo", "family"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
const only = arg && arg !== "sep" ? arg : null;
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {};
for (const name of NAMES) {
  const s = slug(name);
  if (only && only !== s) continue;
  const [adjName, nounName] = name.split(" ");
  const tgt = TARGET + (ADJ[adjName].lvl || 0) + (NOUN[nounName].lvl || 0);
  const p = compose(name), m = level(p, tgt), r = render(p);
  const now = horrorRows.find((x) => x.name === name);
  if (arg !== "sep") { wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)"); wav(s + "-2-new.wav", r, name); }
  json[name] = Object.assign({}, p, { _vary: varyFor(p, name) });
  const bad = outOfRange(p); if (bad.length) console.log("  OUT OF RANGE " + name + ": " + bad.join(", "));
  rows.push({ name, slug: s, p, r, m, f: features(m), now, tgt });
  const nl = p.layers ? JSON.parse(p.layers).length + 1 : 1;
  console.log(name.padEnd(18) + "NEW " + fmt(m) + "\n      " + nl + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
    ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")" +
    "\n  " + "".padEnd(16) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
}
if (only) process.exit(0);

// ---- separation
const pairs = (list) => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i].name, list[j].name, dist(list[i].f, list[j].f), list[i].f, list[j].f]); return out.sort((a, b) => a[2] - b[2]); };
const pn = pairs(rows), po = pairs(rows.map((x) => ({ name: x.name, f: x.now.f })));
console.log("\nSEPARATION (feature distance over 13 axes; 1 = about a doubling of length, an octave of colour or pitch, a clear step)");
console.log("  NEW median pair " + median(pn.map((x) => x[2])).toFixed(2) + ", min " + pn[0][2].toFixed(2) + "; TODAY median " + median(po.map((x) => x[2])).toFixed(2) + ", min " + po[0][2].toFixed(2));
console.log("  closest NEW pairs:"); for (const [a, b, d, fa, fb] of pn.slice(0, 12)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  closest TODAY pairs:"); for (const [a, b, d, fa, fb] of po.slice(0, 8)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  same-noun pairs, closest first:"); for (const [a, b, d, fa, fb] of pn.filter(([a, b]) => a.split(" ")[1] === b.split(" ")[1]).slice(0, 12)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  same-adjective pairs, closest first:"); for (const [a, b, d, fa, fb] of pn.filter(([a, b]) => a.split(" ")[0] === b.split(" ")[0]).slice(0, 8)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
// against the creature presets and today's other Horror sounds
const refs = refCreatures().map(([n, p]) => { const m = measure(render(p)); return { name: n, f: features(m) }; });
const others = horrorRows.filter((x) => !NAMES.includes(x.name));
const nearest = (x, pool) => pool.map((r) => [r.name, dist(x.f, r.f), r.f]).sort((a, b) => a[1] - b[1])[0];
const crossC = rows.map((x) => { const b = nearest(x, refs); return [x.name, b[0], b[1], x.f, b[2]]; }).sort((a, b) => a[2] - b[2]);
console.log("  nearest CREATURE preset (" + refs.length + " on wave 28), closest first:");
for (const [a, b, d, fa, fb] of crossC.slice(0, 10)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
for (const nm of ["Monster Growl", "Angry Wail", "Wailing Screech", "Slithering Wail"]) {
  const r = refs.find((q) => q.name === nm); if (!r) continue; const b = rows.map((x) => [x.name, dist(x.f, r.f), x.f]).sort((p, q) => p[1] - q[1])[0];
  console.log("    " + nm.padEnd(16) + " nearest new: " + b[1].toFixed(2) + "  " + b[0] + "   (" + why(b[2], r.f) + ")");
}
const crossH = rows.map((x) => { const b = nearest(x, others); return [x.name, b[0], b[1], x.f, b[2]]; }).sort((a, b) => a[2] - b[2]);
console.log("  nearest of today's OTHER 31 Horror sounds (being redone elsewhere), closest first:");
for (const [a, b, d, fa, fb] of crossH.slice(0, 6)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
const over2 = rows.filter((x) => x.m.sec > 2.001).map((x) => x.name + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges: audible " + Math.min(...rows.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...rows.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...rows.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...rows.map((x) => x.m.lufs)).toFixed(1) + " (median " + median(rows.map((x) => x.m.lufs)).toFixed(1) +
  "; target " + TARGET.toFixed(1) + "); worst miss " + Math.max(...rows.map((x) => Math.abs(x.m.lufs - x.tgt))).toFixed(1) + " dB; peaks max " + Math.max(...rows.map((x) => x.m.peak)).toFixed(3) +
  ", clipping " + rows.filter((x) => x.m.clip).length + ", |DC| max " + Math.max(...rows.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1));
console.log("  over 2 s: " + (over2.join(", ") || "none"));
console.log("  limiter used: " + (rows.filter((x) => x.p.limiter).map((x) => x.name + " " + x.p.limiter).join(", ") || "none"));
console.log("  before/after loudness (new - now, dB): " + rows.map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (name order)
writeFileSync(join(jsonDir, "horror-redo-family.json"), JSON.stringify(json, null, 2) + "\n");
const sorted = rows.slice().sort((a, b) => a.name.localeCompare(b.name)), gap = Math.round(0.4 * SR);
let total = 0; for (const x of sorted) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
sorted.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(18) + IDEA[x.name]); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Horror family, all new");
writeFileSync(join(wavDir, "KEY.md"), "# Horror family — all-new.wav: the 31 new adjective x noun horror sounds in name order, 0.4 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it, <slug>-2-new.wav the redesign; both Normalize on,\n" +
  "# NOT loudness-matched (each is what its button plays). Tables: tools/proto/horror-redo-family.mjs.\n\n```\n" + key.join("\n") + "\n```\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, horror-redo-family.json");
