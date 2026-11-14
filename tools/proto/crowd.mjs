/* crowd.mjs — PROTOTYPE of a "crowd" synthesis engine for CrunchySFX (chatter, cheering, applause, an audience's
 * gasp, a chanting stadium), and the CLI that renders its blind listening rounds.
 *
 *   node tools/proto/crowd.mjs            ROUND 2: the winners' guard, then every round into soundtests/proto-crowd-2/<sound>/
 *   node tools/proto/crowd.mjs audience-ooh     one round (the guard still runs first)
 *   node tools/proto/crowd.mjs --measure  the same, and print every take's measurements in full
 *   node tools/proto/crowd.mjs --guard    only the guard: round 1's six winners re-rendered and measured against the files AJ heard
 *                                         (CROWD_GUARD_GROUP=0 renders them with cwGroup 0, round 1's talk density)
 *   node tools/proto/crowd.mjs --round1 --out=<dir>   round 1 again, into <dir> (never over soundtests/proto-crowd)
 *   node tools/proto/crowd.mjs --cpu      only the cost probe: render time per second of audio, small to largest crowd
 *
 * ROUND 2 (2026-11-13, after AJ's round 1: cheers, applause and chants WON; chatter "everyone is making the same syllable
 * noise", the gasp "odd in general"):
 *   TALK is planned in PHONES (closures, bursts, aspiration, fricatives s/sh/f/v/z, nasals m/n, glides l/r/w/j, flaps,
 *     glottal dips, vowels and diphthongs) joined phone to phone, in syllables of drawn structure (onset clusters, codas;
 *     stressed long and full-voweled, unstressed short and reduced), with a PHRASE contour (declination, accents, a fall /
 *     continuation rise / question rise) and people in CONVERSATIONS (cwGroup: 1-8 per group; one speaks, the others
 *     listen and back-channel, with interruptions and gaps). Measured per voice against round 1 (8 voices x 3 efforts):
 *     syllables with a rise-fall "hat" 51-60% -> 23-28%; successive syllables' contour correlation 0.22-0.53 -> about 0;
 *     duration CV 0.33 -> 0.44; boundaries under 6 dB 3-5% -> 9-11%; voices sounding at once in the busy tavern 19 -> 12.
 *     The level reference (calibration) still reads round 1's syllable reader (`cal.ref`), so no call, chant or clap moved.
 *   REACTIONS: gasp (cwCall 5) is VOICED ("HUH!" with a creaky onset and a catch / "OH!" / a voiced inhale; 40% breathe
 *     out after); ooh and aww redrawn to read alone; "aww (sweet)" appended (cwCall 7); the bed's reactions follow the
 *     joins convolved with the reactions' own power envelope, and its upper band is set per call (an "oo" has none).
 *
 * WHY. A crowd in the app today is one voice or one texture standing in for many: Crowd Cheer is ONE formant voice
 * holding a vowel with a little noise, Crowd Applause is the particle engine's uniform crackle, Chant Loop is one formant
 * voice repeated, and there is no chatter at all (Goblin Chatter / the Murmurs are one or three creatures). A crowd is
 * MANY people, each doing their own thing, and what the ear reads as "a crowd" is the statistics of that: a babble is
 * syllables at ~4-6 Hz in many voices at once, never in step, nearer ones distinct and the rest a thick bed; a cheer is
 * many sustained shouts ("aah", "yeah", "woo") at many pitches swelling together; applause is impulses at each person's
 * own rate whose density rises as people join and thins as they stop; a chant is the same crowd pulled onto one beat,
 * smeared by how far apart the people are; a gasp is one collective inhale whose onsets bunch into a tenth of a second.
 *
 * SIGNAL FLOW (people, nearest first; the listener stands among them, or `distance` puts the crowd off in front):
 *   GEOMETRY  person k stands at r_k = sqrt(R0^2 + k / (pi rho) + D^2) (a standing crowd of rho = 0.9 per m^2 around
 *             the listener, R0 = 1.1 m of personal space, D the distance to the crowd): gain 1/r, arrival delay r/343
 *             (relative to the nearest), a random azimuth (pan narrowed by atan(crowd radius / D) when far). So a near
 *             voice's level depends on the density, not the crowd size, and a bigger crowd is only logarithmically
 *             louder but much THICKER. In a stadium the delays (up to ~0.15 s) are what smear a chant.
 *   VOICES    the nearest CW_VOICES (28) people are each a cheap voice: a polyBLEP saw (period jitter + shimmer that grow
 *             with effort), a one-pole source tilt (soft voice dark, shout bright), aspiration noise, a 5-formant Klatt
 *             cascade (coefficients every 32 samples, ramped per sample: creature's lesson), a parallel fricative
 *             bandpass. Each person has a register (man / woman / child: f0 and tract scale), a participation
 *             threshold, and a planner that says what they are doing:
 *               TALK  phrases of 4-16 syllables (4.2 + 1.6 effort per second, log-normal lengths), each a random
 *                     vowel (or a diphthong) behind a random onset (none / stop / fricative / nasal) and sometimes a
 *                     fricative coda, a declining pitch over the phrase with stressed syllables raised; pauses between
 *                     phrases. No words: the vowels and consonants are drawn, never spelled, so nothing is intelligible.
 *               CALL  sustained shouts with a pitch contour and a vowel glide: aah, yeah (i -> ae), woo (rising
 *                     falsetto u), hey; or the reactions: ooh (o -> u, rise-fall), aww (ae -> aw, falling), boo
 *                     (low, b-onset, wobbling), gasp (an INHALE: aspiration through an open tract, no voicing, now and
 *                     then an ingressive squeak), laugh (bouts of "ha" pulses at 4.6-5.6 Hz, breathy, falling, then an
 *                     inhale). Reactions (ooh, aww, gasp) fire ONCE per person each time they join.
 *               CHANT a shared pattern on a beat clock (hey / da-DUM / da-da-DUM / clap-clap-hey), every syllable's
 *                     onset jittered by 12 ms + (1 - together) * 80 ms, plus the person's arrival delay.
 *   THE BED   everyone beyond the 28 is statistical: up to 6 groups by distance (log-spaced, equal energy each), every
 *             group a pair of decorrelated noise channels and 4 "chorus" pulse trains (pseudo-voices with their own syllabic,
 *             call or chant envelopes and pitch contours) through a 2-formant chain normalized by its true (integrated) noise
 *             power gain, at the power those members would make (sum of their 1/r^2, the share talking / calling /
 *             chanting, the participation, the duty of each behavior). Its modulation depth falls as 1/sqrt(members),
 *             which is what makes 30 people a babble and 3000 a roar; its chant envelope is the pattern convolved with
 *             a Gaussian of the group's jitter and delay spread; its reactions follow the running maximum of the swell.
 *   CLAPS     the nearest 32 clappers are individual (a hand type: flat palm-to-palm ~1.8-2.6 kHz or cupped ~0.8-1.3 kHz
 *             with a low pop; each clap a noise burst through a bandpass, 0.4 ms attack, 2.5-7 ms decay; each person
 *             their own rate, log-normal about `clap rate`, 4% interval jitter); the rest are a Poisson stream of the
 *             same claps drawn at the far people's gains and delays, up to 1500 a second, and the excess energy a
 *             band of noise. With `together` they lock onto the beat (or the chant's clap beats).
 *   WHISTLES  two-finger whistles (2.2-3.6 kHz, a slur up, a hold or a fall, breath around the tone) at random people.
 *   LEVELS ARE MEASURED, NOT ASSUMED (found by disbelieving the first balance check, which had the bed 8-13 dB hot):
 *     - the voice is calibrated ONCE on a man talking at effort 0 over the WHOLE vowel mix (in a unity-DC cascade an
 *       open vowel comes out ~7 dB over a schwa, as real vowels differ in intrinsic loudness); aspiration (an "h", a
 *       laugh's breath, the gasp) on its own reference (-10 dB under the voice at asp 1; a gasp -5 dB), since noise
 *       through the cascade sits ~41 dB under voicing at the same gain; fricatives through a true BANDPASS (the Klatt
 *       resonator is a resonant LOW-pass: an "s" through it lands under 3 kHz) at -9 dB;
 *     - the bed's per-person power is MEASURED from the near voices of the same crowd (topped up by unheard stand-in
 *       voices when too few near ones do a behavior), because a voice's level depends on its vowel and envelope (an "oo"
 *       ~10 dB under an "ah"); the bed's 2-formant chain is normalized by its TRUE white-noise power gain (|H|^2 on a log
 *       grid: the product of the two resonators' own gains is 6-8 dB short), its chorus is a band-limited PULSE train
 *       (flat, so that normalization holds for it), and its power is split across the two channels like a panned voice.
 *     Checked: near voices against bed, per person, within +-0.9 dB of the 1/r^2 geometry for talk at three efforts, every
 *     call, laughter and both chants; near claps against far claps within 1-2 dB.
 *   then the excitement envelope (start / 1 at `peak at` / end, raised-cosine: who has joined, and how hard they push),
 *   air absorption (two one-poles at 16 kHz * 2^(-3.5 distance)), a DC blocker. Stereo.
 *
 * PORT SHAPE. `makeCrowd(sr, cfg, seed)` is a pure factory like flow's makeFlow / blast's makeBlast: no DOM, no
 * Math.random (seeded LCGs; every person's draws come from hash(seed, k), so moving a slider adds people rather than
 * reshuffling the ones already there), SR in. It renders BUFFERED (voice-major: each person's whole timeline, which lets
 * a pause be skipped outright) and returns { L, R, info, tick(drive, out) }; synth.js would build it up front like
 * the weather / flow buffers, the AMP ENVELOPE STAYING THE GAIN (the excitement curve is the engine's own rows, like
 * motor's rpm curve). `crowdCfg(st)` maps the proposed rows (CROWD_PARAMS) to cfg; it reads the patch's `duration`
 * (the swell is laid out over it) and `width`. `crowdLevel` brings a buffer to RMS 0.12, peak capped 0.9, as
 * flowLevel / weatherLevel do. The voice and clap levels are calibrated ONCE (a reference schwa, a reference clap) and
 * cached, so cfg changes never move the calibration.
 *
 * WHAT THE PORT WILL NEED (the exporter's known traps, from the worklog): cfg keys are QUOTED (`"people":` etc.);
 * SCREAMING_CASE constants one per line (`const CW_CTL = 32;` never `const A, B`); no `Math.SQRT2` (none here);
 * Duration must stretch past 2 s for this wave (crowd beds are 3-5 s, like chirp/flow); width is the patch's own.
 *
 * THE ROUND. Each sound gets the CURRENT preset (or, for a gap, the best build from today's engines, layered) as the
 * control, rendered by the exported engine exactly as tools/make-ab.mjs does, and three model takes that differ in
 * INTERPRETATION. As in weather.mjs / flow.mjs the model's STEREO buffer gets the app's own Freeverb (dsp.js
 * reverbProcess) at the take's stated room (a `wave: 9` sample is mono and would collapse the crowd onto a point), then
 * the 4 ms / 60 ms edge guards. Loudness matched to -18 LUFS (the app's Limiter at the smallest 0.1 step when peaks
 * hold a take more than 0.5 dB under), shuffled with a fixed seed (the HIGH bits of the LCG, avalanched name hash, as
 * flow.mjs). Writes take-*.wav, LISTEN.md (no hints), KEY.md (read after), README.md (the rounds in listening order).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

export const CROWD_CALLS = ["cheer", "aah", "ooh", "aww", "boo", "gasp", "laugh", "aww (sweet)"];   // round 2: gasp is VOICED now; "aww (sweet)" appended
export const CROWD_CHANTS = ["hey", "da-DUM", "da-da-DUM", "clap-clap-hey"];
// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Only wave "crowd" reads the
// group, so no existing preset moves; the defaults are a small room of people talking quietly with no swell.
export const CROWD_PARAMS = [
  ["cwSize",     "Crowd size",    0, 1,   0.01, 0.4,  "",    "Crowd"],   // log: people = 3000^size (0.4 = 25, 0.58 = 100, 1 = 3000)
  ["cwVoices",   "Voices",        0, 1,   0.01, 1,    "",    "Crowd"],   // share of people using their voice (0 = a silent, clapping hall)
  ["cwMood",     "Excitement",    0, 1,   0.01, 0.3,  "",    "Crowd"],   // vocal effort: hushed .. shouting (pitch, brightness, level, pace)
  ["cwCalls",    "Calling",       0, 1,   0.01, 0,    "",    "Crowd"],   // share calling out (the Call below) instead of talking
  ["cwCall",     "Call",          0, 7,   1,    0,    "",    "Crowd", "enum", CROWD_CALLS],
  ["cwGroup",    "Group size",    0, 1,   0.01, 0.4,  "",    "Crowd"],   // round 2: talkers per conversation, 1 + 7 g^1.5 (0 = each on their own, 0.4 = ~3, 1 = one table of 8)
  ["cwFemale",   "Women",         0, 1,   0.01, 0.5,  "",    "Crowd"],   // share of adults who are women
  ["cwChildren", "Children",      0, 1,   0.01, 0,    "",    "Crowd"],
  ["cwSync",     "Together",      0, 1,   0.01, 0,    "",    "Crowd"],   // independent .. chanting / clapping on one beat
  ["cwTempo",    "Chant tempo",   50, 200, 1,   120,  "BPM", "Crowd"],
  ["cwChant",    "Chant",         0, 3,   1,    0,    "",    "Crowd", "enum", CROWD_CHANTS],
  ["cwClap",     "Clapping",      0, 1,   0.01, 0,    "",    "Crowd"],   // share of people clapping
  ["cwClapRate", "Clap rate",     1, 7,   0.1,  4,    "Hz",  "Crowd"],   // each person's own rate, log-normal about this
  ["cwWhistle",  "Whistles",      0, 1,   0.01, 0,    "",    "Crowd"],
  ["cwStart",    "Swell start",   0, 1,   0.01, 1,    "",    "Crowd"],   // the excitement envelope: who has joined
  ["cwPeakAt",   "Swell peak at", 0, 1,   0.01, 0.3,  "",    "Crowd"],   // ... reaching everyone (1) here
  ["cwEnd",      "Swell end",     0, 1,   0.01, 1,    "",    "Crowd"],
  ["cwDistance", "Distance",      0, 1,   0.01, 0,    "",    "Crowd"],   // among them .. 150 m off (air, detail, width)
  ["cwSeed",     "Variation",     0, 999, 1,    0,    "",    "Crowd"],
];
export const CROWD_DEFAULTS = Object.fromEntries(CROWD_PARAMS.map((p) => [p[0], p[5]]));

const CW_MAX_PEOPLE = 3000;
const CW_VOICES = 28;          // people rendered as individual voices (the nearest)
const CW_CLAPPERS = 32;        // clappers rendered individually (the nearest who clap)
const CW_GROUPS = 6;           // bed groups at most
const CW_CHORUS = 4;           // pseudo-voices per bed group
const CW_CTL = 32;             // samples between coefficient targets (ramped per sample)
const CW_RHO = 0.9;            // people per m^2
const CW_R0 = 1.1;             // m of personal space around the listener
const CW_FAR = 150;            // m at distance 1 (D = 150 * distance^2)
const CW_VOICE_RMS = 0.05;     // a talking voice at effort 0, while sounding (x 10^(0.9 effort): +18 dB at a shout)
const CW_CLAP_POWER = 0.1;     // a near clapper's mean power at 4 claps/s (a voice at effort ~0.9)
const CW_FAR_CLAPS = 1500;     // far claps drawn as events per second at most; the rest is a band of noise
const CW_WHISTLE_RMS = 2.5;
const CW_FRIC = 0.35;          // a fricative's RMS against the voice (-9 dB): the "s", "sh", "f" of chatter
const CW_ASP = 0.3;            // aspiration at asp = 1 against the voice (-10 dB): an "h", a breathy laugh
const CW_GASP = 0.55;          // an inhaled gasp's RMS against a voice at the same effort (-5 dB)
const CW_TALK = 1.2;           // round 2: a talker's phone level against the calibration reference: the phone talker came out 1.2-2.1 dB
                               // under round 1's (gated loudness, 8 voices x efforts 0 / 0.5 / 0.9), so this +1.6 dB keeps talk against calls
const CW_RMS = 0.12;           // crowdLevel: the buffer's RMS ...
const CW_PEAK = 0.9;           // ... unless the peak would pass this

// male vowel formants F1 F2 F3 (Peterson & Barney 1952 means); scaled per person by tract size
const CW_VOWELS = [
  [270, 2290, 3010],  // 0 i
  [390, 1990, 2550],  // 1 I
  [530, 1840, 2480],  // 2 E
  [660, 1720, 2410],  // 3 ae
  [730, 1090, 2440],  // 4 a (father)
  [570, 840, 2410],   // 5 aw
  [440, 1020, 2240],  // 6 U
  [300, 870, 2240],   // 7 u
  [640, 1190, 2390],  // 8 uh
  [490, 1350, 1690],  // 9 er
  [500, 1500, 2500],  // 10 schwa
  [400, 2100, 2700],  // 11 e (hey)
  [450, 800, 2400],   // 12 o
];
const CW_TALK_V = [10, 10, 10, 1, 1, 2, 2, 3, 4, 4, 8, 8, 5, 6, 7, 0, 0, 9, 11, 12];   // weighted draw for talk

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));
const rc = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * x));
function shape3(u, a, p, b, pos) {   // start -> peak (at pos) -> end, raised-cosine segments (creature's)
  pos = clamp(pos, 0.02, 0.98);
  return u < pos ? a + (p - a) * ease(u / pos) : p + (b - p) * ease((u - pos) / (1 - pos));
}
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function cwRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function cwHash(a, b) {
  let h = (Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) >>> 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return (h >>> 0) || 1;
}
function cwGauss(rnd) { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// value noise, cosine-interpolated: a smooth random curve in -1..1 at `perStep` cycles per call
function cwSmooth(perStep, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = rnd();
  return () => { ph += perStep; while (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * ph)); };
}
const CW_SMOOTH_MS = 0.27;     // mean square of cwSmooth (measured: uniform endpoints, cosine interpolation)
function cwErf(x) {            // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
// Klatt resonator y = A x + B y1 + C y2 (unity gain at DC); writes A, B, C at a[i..i+2]
function cwCoef(a, i, F, BW, sr) {
  const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * Math.min(F, 0.45 * sr) / sr);
  a[i] = 1 - B - C; a[i + 1] = B; a[i + 2] = C;
}
// a true BANDPASS (RBJ, unit peak) for noise bands: the Klatt resonator above is a resonant LOW-pass (unity at DC), so a
// fricative through it puts most of its energy below 3 kHz. Writes b0, a1, a2 (y = b0 (x - x2) - a1 y1 - a2 y2); with
// cwBpMk, uniform white noise in comes out at unit RMS whatever the centre
function cwBp(a, i, fc, Q, sr) {
  const w0 = 2 * Math.PI * Math.min(fc, 0.45 * sr) / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
  a[i] = al / a0; a[i + 1] = -2 * Math.cos(w0) / a0; a[i + 2] = (1 - al) / a0;
}
const cwBpMk = (fc, Q, sr) => Math.sqrt(3 * Q * sr / (Math.PI * Math.max(20, fc)));
// its power gain on white noise (an AR(2) with phi1 = B, phi2 = C, times A^2)
const cwResPow = (A, B, C) => A * A * (1 - C) / ((1 + C) * ((1 - C) * (1 - C) - B * B));
// the white-noise power gain of a CASCADE of Klatt resonators (coefficients at a[i], a[i + 3], ...), integrated over a
// fixed log grid 20 Hz-12 kHz: the product of each one's own gain understates two formants by 6-8 dB (each unity-DC
// resonator passes the other's peak at a gain above 1)
const CW_GRID = {};
function cwChainPow(a, offs, sr) {
  let g = CW_GRID[sr];
  if (!g) {
    const K = 128, c1 = new Float64Array(K), s1 = new Float64Array(K), c2 = new Float64Array(K), s2 = new Float64Array(K), dw = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const f = 20 * Math.pow(600, k / (K - 1)), fl = 20 * Math.pow(600, (k - 0.5) / (K - 1)), fh = 20 * Math.pow(600, (k + 0.5) / (K - 1));
      const w = 2 * Math.PI * f / sr; c1[k] = Math.cos(w); s1[k] = Math.sin(w); c2[k] = Math.cos(2 * w); s2[k] = Math.sin(2 * w); dw[k] = 2 * Math.PI * (fh - fl) / sr;
    }
    g = CW_GRID[sr] = { K, c1, s1, c2, s2, dw };
  }
  let P = 2 * Math.PI * 20 / sr;   // below the grid the cascade passes at unity
  for (let k = 0; k < g.K; k++) {
    let h = 1;
    for (const i of offs) {
      const A = a[i], B = a[i + 1], C = a[i + 2], re = 1 - B * g.c1[k] - C * g.c2[k], im = B * g.s1[k] + C * g.s2[k];
      h *= A * A / (re * re + im * im);
    }
    P += h * g.dw[k];
  }
  return P / Math.PI;
}
const cwPan = (x) => [Math.cos((clamp(x, -1, 1) + 1) * Math.PI / 4), Math.sin((clamp(x, -1, 1) + 1) * Math.PI / 4)];

// ---- the chants: syllables in a 4-beat bar { b: beat, d: beats long, v0 -> v1, st: semitones, acc: level, on: onset }
// onsets: 0 none, 1 stop, 2 fricative, 3 nasal, 4 h, 5 voiced closure (b/d)
const CW_PATTERNS = [
  { syl: [0, 1, 2, 3].map((b) => ({ b, d: 0.42, v0: 11, v1: 1, st: b === 0 ? 1 : 0, acc: b === 0 ? 1.1 : 1, on: 4 })), claps: [] },          // HEY HEY HEY HEY
  { syl: [{ b: 0, d: 0.42, v0: 1, v1: 1, st: -2, acc: 0.75, on: 5 }, { b: 1, d: 1.25, v0: 2, v1: 2, st: 2, acc: 1.1, on: 2, coda: 1 }], claps: [] },  // de-FENSE
  { syl: [{ b: 0, d: 0.4, v0: 2, v1: 2, st: 0, acc: 0.85, on: 3 }, { b: 1, d: 0.4, v0: 12, v1: 6, st: 0, acc: 0.85, on: 1 }, { b: 2, d: 1.35, v0: 4, v1: 4, st: 3, acc: 1.15, on: 4 }], claps: [] },   // da-da-DAAH
  { syl: [{ b: 2, d: 0.6, v0: 11, v1: 1, st: 2, acc: 1.1, on: 4 }], claps: [0, 1] },                                                         // clap clap HEY
];
// ---- the calls: a segment template per type (seconds, semitones, vowel glide, onset, breath, effort added)
function cwCallShape(type, rnd) {
  const r = () => rnd();
  switch (type) {
    case 1: return { kind: "aah", dur: 0.7 + 0.8 * r(), v0: 4, v1: r() < 0.5 ? 4 : 8, vPos: 0.8, pS: -3, pP: 1, pE: -4 - 2 * r(), pPos: 0.25, atk: 0.1, rel: 0.25, on: r() < 0.3 ? 4 : 0, onLen: 0.06, asp: 0.06, voiced: 1, wob: 0.25, f0mul: 1.12, eAdd: 0.35 };
    case 2: return { kind: "yeah", dur: 0.45 + 0.45 * r(), v0: 0, v1: 3, vPos: 0.45, pS: 2, pP: 4, pE: -5 - 2 * r(), pPos: 0.15, atk: 0.08, rel: 0.3, on: 0, onLen: 0, asp: 0.05, voiced: 1, wob: 0.15, f0mul: 1.15, eAdd: 0.4 };
    case 3: return { kind: "woo", dur: 0.6 + 0.7 * r(), v0: 7, v1: 6, vPos: 1, pS: -3, pP: 6 + 2 * r(), pE: 4, pPos: 0.7, atk: 0.12, rel: 0.2, on: 0, onLen: 0, asp: 0.06, voiced: 1, wob: 0.3, f0mul: 1.5, eAdd: 0.4 };
    case 4: return { kind: "hey", dur: 0.22 + 0.16 * r(), v0: 11, v1: 1, vPos: 0.9, pS: 2, pP: 3, pE: -3, pPos: 0.2, atk: 0.08, rel: 0.35, on: 4, onLen: 0.18, asp: 0.05, voiced: 1, wob: 0, f0mul: 1.12, eAdd: 0.4 };
    // round 2: the reactions are made to read ON THEIR OWN. OOH (impressed): a long "oh-ooh" whose pitch climbs 3-5
    // semitones and then slides 7-10 down, held out loud (effort +0.3), a waver as it is held, an "h" or a "w" before it
    // now and then. AWW (let down: the near miss): an "ae-aw" that starts at its top and FALLS 7-9 semitones over most of
    // a second, ending in a sigh of breath. Each person draws their own length, glide and contour.
    case 5: { const u = r(); return { kind: "ooh", dur: 0.85 + 0.75 * r(), v0: u < 0.5 ? 12 : 6, v1: 7, vPos: 0.75, pS: -2, pP: 3 + 2 * r(), pE: -7 - 3 * r(), pPos: 0.25 + 0.15 * r(), atk: 0.12, rel: 0.4, on: u > 0.8 ? 4 : 0, onLen: 0.06, asp: 0.1, voiced: 1, wob: 0.15, f0mul: 1.12, eAdd: 0.3, once: true }; }
    case 6: return { kind: "aww", dur: 0.8 + 0.6 * r(), v0: 3, v1: 5, vPos: 0.55, pS: 2, pP: 3, pE: -7 - 2 * r(), pPos: 0.1, atk: 0.1, rel: 0.45, on: 0, onLen: 0, asp: 0.14, voiced: 1, wob: 0.1, f0mul: 1.1, eAdd: 0.2, once: true, then: r() < 0.5 ? 13 : 0 };
    case 7: return { kind: "boo", dur: 1.0 + 1.2 * r(), v0: 7, v1: 7, vPos: 1, pS: 0, pP: 1, pE: -3, pPos: 0.15, atk: 0.12, rel: 0.2, on: 5, onLen: 0.05, asp: 0.05, voiced: 1, wob: 0.4, f0mul: 0.85, eAdd: 0.3 };
    case 8: { const sq = r() < 0.3;   // the inhale; now and then an ingressive squeak at its end
      return { kind: "gasp", dur: 0.16 + 0.16 * r(), v0: 8, v1: 5, vPos: 1, pS: 0, pP: 2, pE: 3, pPos: 0.6, atk: 0.12, rel: 0.5, on: 0, onLen: 0, asp: CW_GASP / CW_ASP, voiced: 0, squeak: sq, wob: 0, f0mul: 2.3, eAdd: 0, once: true }; }
    // round 2: the VOICED gasp. Round 1's gasp was template 8, a silent aspirated inhale: hundreds of them sum to a hiss.
    // A startled audience says "HUH!": a glottal onset (the first 30 ms creaky: big period jitter), a short breathy
    // voiced "uh/ah" sliding to "aw", high (x1.7, the voice jumps up) and falling 3-5 semitones, cut off by a catch (a
    // release a tenth of its length). A quarter say a short "OH!" instead, a sixth a breathy voiced inhale with a squeak
    // at the end; 40% let the air back out (an unvoiced "hhh", template 12) a moment later.
    case 10: { const u = r();
      if (u < 0.58) return { kind: "gasp", dur: 0.12 + 0.12 * r(), v0: r() < 0.6 ? 8 : 4, v1: 5, vPos: 1, pS: 0.5, pP: 1, pE: -3 - 2 * r(), pPos: 0.2, atk: 0.04, rel: 0.12, on: 0, onLen: 0, asp: 0.55, voiced: 0.75, creak: 0.03, wob: 0, f0mul: 1.7, eAdd: 0.25, once: true, then: r() < 0.4 ? 12 : 0 };
      if (u < 0.83) return { kind: "gasp", dur: 0.16 + 0.14 * r(), v0: 12, v1: 7, vPos: 0.9, pS: 1, pP: 2, pE: -5, pPos: 0.15, atk: 0.05, rel: 0.25, on: 0, onLen: 0, asp: 0.15, voiced: 1, creak: 0.025, wob: 0, f0mul: 1.35, eAdd: 0.3, once: true, then: 0 };
      return { kind: "gasp", dur: 0.2 + 0.12 * r(), v0: 8, v1: 5, vPos: 1, pS: 0, pP: 2, pE: 3, pPos: 0.6, atk: 0.08, rel: 0.3, on: 0, onLen: 0, asp: 1.2, voiced: 0.35, squeak: true, wob: 0, f0mul: 1.9, eAdd: 0.15, once: true, then: 0 }; }
    // AWW (sweet): the "aww" at something cute: a breathy "ae-aw" that RISES 4-6 semitones and comes back down, soft
    case 11: return { kind: "aww", dur: 0.7 + 0.5 * r(), v0: 3, v1: 5, vPos: 0.7, pS: -1, pP: 4 + 2 * r(), pE: -3, pPos: 0.4, atk: 0.2, rel: 0.4, on: 0, onLen: 0, asp: 0.3, voiced: 1, wob: 0.08, f0mul: 1.3, eAdd: 0, once: true };
    // the breath let back out after a gasp, and the sigh after a let-down "aww": unvoiced, soft (x0.45, set by the caller)
    case 12: return { kind: "exhale", dur: 0.18 + 0.2 * r(), v0: 8, v1: 10, vPos: 1, pS: 0, pP: 0, pE: 0, pPos: 0.5, atk: 0.15, rel: 0.6, on: 0, onLen: 0, asp: 1, voiced: 0, wob: 0, f0mul: 1, eAdd: 0, gap: 0.05 + 0.25 * r() };
    case 13: return { kind: "exhale", dur: 0.3 + 0.3 * r(), v0: 5, v1: 10, vPos: 1, pS: 0, pP: 0, pE: 0, pPos: 0.5, atk: 0.2, rel: 0.6, on: 0, onLen: 0, asp: 1, voiced: 0.12, wob: 0, f0mul: 0.9, eAdd: 0, gap: 0 };
  }
  return null;
}
const CW_CALL_TYPES = { 0: null, 1: 1, 2: 5, 3: 6, 4: 7, 5: 10, 6: 9, 7: 11 };   // row value -> template (cheer draws; 9 = laugh; 8 = the silent inhale, now only inside a laugh)
// the bed's upper band per call: a shout's presence (8% of its power, ~2.7 kHz); round 2: an "oo" has next to none,
// an "aw" a little, a breathy gasp some
const CW_PRESENCE = { 0: 0.08, 1: 0.08, 2: 0.005, 3: 0.03, 4: 0.03, 5: 0.05, 6: 0.08, 7: 0.03 };
const cwOnce = (c) => c === 2 || c === 3 || c === 5 || c === 7;   // reactions: each person once per joining
const cwCheerDraw = (rnd) => { const u = rnd(); return u < 0.35 ? 1 : u < 0.65 ? 2 : u < 0.9 ? 3 : 4; };
const CW_CALL_VOWEL = { 0: [680, 1350], 1: [720, 1120], 2: [420, 880], 3: [640, 1050], 4: [320, 880], 5: [620, 1150], 6: [650, 1200], 7: [650, 1200] };

// =====================================================================================================================
// TALK, round 2. Round 1's planner made every syllable the same event: an onset, a vowel, an amplitude bump that fell
// back to (near) silence (median dip between syllables 18-20 dB, NONE under 6 dB), its own rise-fall pitch hat (the
// commonest syllable contour; never a rise), durations bunched (CV 0.23-0.40), and everyone talking at once (one person
// alone sounds 55-64% of the time, so 28 people put ~15 voices on top of each other). Heard: "MINE MINE MINE".
// Now: a syllable is a sequence of PHONES (closures, bursts, aspiration, fricatives, nasals, glides, vowels) whose
// levels, voicing and formants are joined phone to phone, so a phrase is one continuous breath group that dips only at
// its consonants; the pitch is the PHRASE's (declination, stress accents, a fall, a continuation rise or a question
// rise at the end) and runs across syllables; stressed syllables are long and full-voweled, unstressed ones short and
// reduced; and people talk in CONVERSATIONS (groups of 1-8): one speaks while the others listen and say "mm" / "yeah",
// with interruptions and gaps. No words: every phone is drawn, never spelled.
// =====================================================================================================================
// consonants: c 1 stop / 2 fricative / 3 nasal / 4 approximant / 5 h. pl: place (0 labial, 1 alveolar, 2 palatal,
// 3 velar) for the formant locus; vd voiced; bf/bq/bl the release burst (centre, Q, level); ff/fq/fl the frication
// band; F the nasal / approximant formant targets (male)
const CW_CONS = {
  p: { c: 1, pl: 0, vd: 0, bf: 1100, bq: 0.7, bl: 0.7 }, t: { c: 1, pl: 1, vd: 0, bf: 4200, bq: 1.6, bl: 1.4 }, k: { c: 1, pl: 3, vd: 0, bf: 2300, bq: 3, bl: 1.2 },
  b: { c: 1, pl: 0, vd: 1, bf: 1100, bq: 0.7, bl: 0.35 }, d: { c: 1, pl: 1, vd: 1, bf: 4200, bq: 1.6, bl: 0.7 }, g: { c: 1, pl: 3, vd: 1, bf: 2300, bq: 3, bl: 0.6 },
  f: { c: 2, pl: 0, vd: 0, ff: 5000, fq: 0.6, fl: 0.45 }, v: { c: 2, pl: 0, vd: 1, ff: 5000, fq: 0.6, fl: 0.25 },
  s: { c: 2, pl: 1, vd: 0, ff: 6200, fq: 2.5, fl: 1.1 }, z: { c: 2, pl: 1, vd: 1, ff: 6200, fq: 2.5, fl: 0.6 }, S: { c: 2, pl: 2, vd: 0, ff: 3000, fq: 2, fl: 1.0 },
  m: { c: 3, pl: 0, vd: 1, F: [250, 950, 2300] }, n: { c: 3, pl: 1, vd: 1, F: [250, 1500, 2500] },
  l: { c: 4, pl: 1, vd: 1, F: [360, 1050, 2850] }, r: { c: 4, pl: 2, vd: 1, F: [380, 1150, 1650] }, w: { c: 4, pl: 0, vd: 1, F: [300, 720, 2250] }, j: { c: 4, pl: 2, vd: 1, F: [280, 2250, 3000] },
  h: { c: 5, pl: 1, vd: 0 },
};
// draws [item, weight]: onsets and codas roughly as often as conversational English uses them (clusters included)
const CW_ONSETS = [["", 20], ["t", 9], ["d", 8], ["k", 8], ["s", 9], ["m", 8], ["n", 8], ["l", 8], ["r", 7], ["w", 6], ["h", 6], ["b", 7], ["p", 6], ["f", 5], ["g", 4], ["j", 3], ["S", 3], ["v", 2], ["z", 1],
  ["pl", 1.2], ["pr", 1.2], ["tr", 1.5], ["kl", 1], ["kr", 1], ["bl", 0.8], ["br", 1], ["gr", 0.8], ["fl", 0.8], ["fr", 1], ["st", 1.5], ["sp", 1], ["sk", 0.8], ["sl", 0.5], ["sm", 0.5], ["sn", 0.4], ["kw", 0.7], ["Sr", 0.3]];
const CW_CODAS = [["", 75], ["n", 14], ["t", 11], ["d", 8], ["s", 9], ["z", 7], ["m", 5], ["l", 7], ["r", 6], ["k", 7], ["p", 3], ["f", 2], ["v", 2], ["S", 2],
  ["nt", 2], ["nd", 2], ["st", 2], ["ks", 1.5], ["ts", 1.5], ["lt", 1], ["nz", 1.2], ["mp", 0.6], ["rt", 0.8], ["ld", 0.8], ["rs", 0.6]];
// vowels: a CW_VOWELS index, or [from, to] for a diphthong. Stressed syllables draw FULL vowels, unstressed REDUCED ones
const CW_FULLV = [[0, 6], [1, 8], [2, 8], [3, 7], [4, 7], [5, 4], [6, 3], [7, 4], [8, 7], [9, 3], [12, 4], [[4, 1], 5], [[4, 6], 2], [[11, 1], 4], [[12, 7], 3], [[5, 1], 1]];
const CW_REDV = [[10, 10], [1, 5], [8, 3], [9, 2], [0, 1.5], [6, 1.2]];
const cwPick = (list, u) => { let tot = 0; for (const it of list) tot += it[1]; let x = u * tot; for (const it of list) { x -= it[1]; if (x <= 0) return it[0]; } return list[list.length - 1][0]; };
// back-channels (a listener's "mm" / "mhm" / "yeah" / "uh-huh" / "oh" / a little "heh"): [syllables, final contour (x range), level, weight]
const CW_BC = [
  [[{ v: "m", d: 0.32 }], -0.5, 0.55, 25], [[{ v: "m", d: 0.15 }, { on: "h", v: "m", d: 0.26 }], 0.7, 0.55, 20], [[{ on: "j", v: [2, 3], d: 0.26, st: 1 }], -0.6, 0.75, 25],
  [[{ v: 10, d: 0.13 }, { on: "h", v: 8, d: 0.22 }], 0.7, 0.65, 12], [[{ v: [12, 7], d: 0.24, st: 1 }], -0.4, 0.7, 10], [[{ on: "h", v: 2, d: 0.09 }, { on: "h", v: 2, d: 0.1 }], -0.4, 0.6, 8],
];

// the conversations: group the near talkers (neighbours by distance), then lay out each group's turns. Writes P.utt:
// [{ t0, t1, bc (back-channel index + 1 or 0), q (question), cont (more to come in this turn), cut (interrupted) }]
function cwTurns(rnd, M, C, dur) {
  const n = M.length, e = C.mood, gauss = () => cwGauss(rnd), T = dur + 0.5;
  for (const P of M) P.utt = [];
  let t = -2.5 * rnd(), sp = Math.floor(rnd() * n);
  for (let guard = 0; guard < 400 && t < T; guard++) {
    const nPh = 1 + Math.floor(-Math.log(Math.max(1e-9, rnd())) * (n > 1 ? 1.4 : 2.2));   // phrases this turn
    for (let i = 0; i < nPh && t < T; i++) {
      const last = i === nPh - 1, L = clamp(1.7 * Math.exp(0.45 * gauss()) * (1.12 - 0.25 * e), 0.5, 4.2);
      M[sp].utt.push({ t0: t, t1: t + L, bc: 0, q: last && rnd() < 0.3, cont: !last, cut: false });
      // the listeners: now and then an "mm" / "yeah" round the end of a phrase
      for (let j = 0; j < n; j++) if (j !== sp && rnd() < 0.2 + 0.12 * e) {
        const b0 = t + L - 0.15 + 0.4 * rnd(), k = cwPick(CW_BC.map((b, ix) => [ix, b[3]]), rnd());
        M[j].utt.push({ t0: b0, t1: b0 + 0.45, bc: k + 1, q: false, cont: false, cut: false });
      }
      t += L;
      if (!last) t += clamp(0.42 * Math.exp(0.5 * gauss()), 0.15, 1.3);   // a breath / a thought, holding the floor
    }
    if (n === 1) { t += clamp(1.1 * Math.exp(0.6 * gauss()), 0.35, 3.5); continue; }   // alone: the other end of the line
    const nx = (sp + 1 + Math.floor(rnd() * (n - 1))) % n;
    if (rnd() < 0.12 + 0.25 * e) {   // an interruption: the next voice comes in early and the speaker gives up a moment later
      const st0 = t - (0.15 + 0.5 * rnd()), u = M[sp].utt[M[sp].utt.length - 1];
      u.t1 = Math.max(u.t0 + 0.35, Math.min(u.t1, st0 + 0.12 + 0.35 * rnd())); u.cut = true; t = st0;
    } else t += clamp(0.28 * Math.exp(0.6 * gauss()), 0.06, 1.5);
    sp = nx;
  }
  for (const P of M) P.utt.sort((a, b) => a.t0 - b.t0);
}

// talkers per conversation: 1 + 7 g^1.5 on average (0 -> each alone, 0.4 -> ~2.8, 1 -> 8), each group drawn round it
const cwGroupSize = (g, rnd) => { const m = 1 + 7 * Math.pow(g, 1.5); return m < 1.15 ? 1 : clamp(Math.round(m * Math.exp(0.3 * cwGauss(rnd))), m >= 1.6 ? 2 : 1, 8); };

// the pitch of an utterance at t (semitones re the speaker's f0): declination, accents (raised-cosine bumps), the end
function cwPc(U, t) {
  let v = U.decl * (0.5 - t / U.L);
  for (const a of U.acc) { const x = (t - a[0]) / a[1]; if (x > -1 && x < 1) v += a[2] * (0.5 + 0.5 * Math.cos(Math.PI * x)); }
  if (t > U.tf) v += U.fin * ease((t - U.tf) / Math.max(0.05, U.L - U.tf));
  return v;
}

// one utterance of a speaker (spk: f0, range, level, rate; u: the schedule entry; L: seconds it may take) -> phones
function cwUtterance(sr, rnd, spk, u, L, e) {
  const gauss = () => cwGauss(rnd), sc = (1.15 - 0.3 * e) * spk.rate;
  // 1. syllables
  const syl = [];
  if (u.bc) {
    for (const b of CW_BC[u.bc - 1][0]) syl.push({ on: b.on || "", co: "", v: b.v, d: b.d * (0.85 + 0.3 * rnd()), st: b.st || 0 });
  } else {
    let tot = 0, prevSt = false;
    for (let i = 0; i < 40 && tot < L * 0.95; i++) {
      const st = i === 0 ? rnd() < 0.45 : prevSt ? rnd() < 0.12 : rnd() < 0.42;
      const d = (st ? 0.23 * Math.exp(0.22 * gauss()) : 0.115 * Math.exp(0.25 * gauss())) * sc;
      if (tot + d > L && tot > 0.3 && tot + d - L > d / 2) break;
      syl.push({ on: cwPick(CW_ONSETS, rnd()), co: !st && rnd() < 0.35 ? "" : cwPick(CW_CODAS, rnd()), v: st ? cwPick(CW_FULLV, rnd()) : cwPick(CW_REDV, rnd()), d, st: st ? 1 : 0 });
      tot += d; prevSt = st;
    }
    if (!syl.some((s) => s.st)) { const s = syl[syl.length - 1]; s.st = 1; s.d *= 1.6; s.v = cwPick(CW_FULLV, rnd()); }
    const last = syl[syl.length - 1]; last.d *= u.cut ? 1 : 1.4;   // phrase-final lengthening
  }
  // 2. phones, with times; the contour's accents land late in each stressed vowel
  const P = [], U = { L: 0, decl: 0, acc: [], tf: 0, fin: 0 }, VF = (v) => (typeof v === "number" ? CW_VOWELS[v] : v === "m" ? CW_CONS.m.F : CW_VOWELS[v[0]]);
  const locus = (c, Fv) => {   // where the formants point at a consonant (a locus equation per place), from its vowel
    const pl = c.pl;
    if (pl === 0) return [250, 0.6 * Fv[1] + 250, 0.9 * Fv[2]];
    if (pl === 1) return [250, 0.45 * Fv[1] + 950, 2700];
    if (pl === 2) return [270, 0.4 * Fv[1] + 1250, 2500];
    const f2 = Math.min(2500, 1.05 * Fv[1] + 100); return [250, f2, Math.max(Fv[2], f2 + 400)];
  };
  let t = 0, prevC = 0, prevVoiceless = false;
  const push = (ph, d) => { ph.d = Math.max(0.006, d); ph.t0 = t; t += ph.d; P.push(ph); prevC = ph.c; return ph; };
  const consPh = (ch, Fv, where, cl, sylLv, nextIsAppr) => {   // where: 0 onset, 1 coda; cl: in a cluster
    const c = CW_CONS[ch], j = () => 0.8 + 0.4 * rnd();
    if (c.c === 1) {
      const loc = locus(c, Fv);
      if (c.vd) push({ c: 1, lv: 0.12 * sylLv, vv: 0.8, as: 0, fr: 0, F: [200, loc[1], loc[2]], bwm: 3, tr: 0.02, aIn: 0.015 }, 0.045 * j() * sc);
      else push({ c: 1, lv: 0, vv: 0, as: 0, fr: 0, F: loc, tr: 0.02, aIn: 0.012 }, (where ? 0.055 : 0.05) * j() * sc);
      if (where === 1 && rnd() < 0.4) { prevVoiceless = !c.vd; return; }   // an unreleased final stop
      const bf = c.pl === 3 ? (Fv[1] > 1600 ? 3000 : 1800) : c.bf;
      push({ c: 2, lv: sylLv, vv: 0, as: 0, fr: c.bl * (where ? 0.6 : 1), ffc: bf, fq: c.bq, F: loc, tr: 0.005, aIn: 0.0005, burst: 0.004 }, 0.011);
      if (!c.vd && where === 0 && !cl) push({ c: 3, lv: 0.6 * sylLv, vv: 0, as: 1, fr: 0, F: [Fv[0] * 0.75, Fv[1], Fv[2]], tr: 0.02, aIn: 0.003 }, (nextIsAppr ? 0.018 : 0.03 + 0.02 * rnd()) * sc);
      prevVoiceless = !c.vd; return;
    }
    if (c.c === 2) { const loc = locus(c, Fv);
      push({ c: 4, lv: sylLv, vv: c.vd ? 0.25 : 0, as: 0.03, fr: c.fl, ffc: c.ff, fq: c.fq, F: loc, tr: 0.02, aIn: 0.02 }, (cl ? 0.065 : where ? 0.1 : 0.085) * j() * sc); prevVoiceless = !c.vd; return; }
    if (c.c === 3) { push({ c: 5, lv: 0.35 * sylLv, vv: 1, as: 0, fr: 0, F: c.F, bwm: 3, bw1: 110, tr: 0.012, aIn: 0.012 }, (where ? 0.075 : 0.06) * j() * sc); prevVoiceless = false; return; }
    if (c.c === 4) { push({ c: 6, lv: 0.7 * sylLv, vv: 1, as: 0.02, fr: 0, F: c.F, bwm: 1.3, tr: 0.035, aIn: 0.03 }, 0.055 * j() * sc); prevVoiceless = false; return; }
    push({ c: 3, lv: 0.55 * sylLv, vv: 0, as: 1, fr: 0, F: [Fv[0] * 0.9, Fv[1], Fv[2]], tr: 0.015, aIn: 0.01 }, 0.06 * j() * sc); prevVoiceless = true;
  };
  syl.forEach((s, i) => {
    const Fv = VF(s.v), tMid = t + s.d / 2;
    const lv = (s.st ? 1.35 : 0.85) * Math.exp(0.1 * gauss()) * (u.bc ? CW_BC[u.bc - 1][2] : 1 - 0.3 * Math.min(1, tMid / Math.max(0.3, L)));
    const t0 = t;
    // a vowel straight after a vowel: half the time a glottal dip between them (uh-oh), else they glide
    if (!s.on && i > 0 && prevC === 0 && rnd() < 0.5) push({ c: 7, lv: 0.3 * lv, vv: 0.6, as: 0.1, fr: 0, F: Fv, tr: 0.03, aIn: 0.015, creak: 0.06 }, 0.035);
    prevVoiceless = false;
    // casual speech FLAPS an unstressed t / d between vowels ("butter", "go to"): a 25 ms voiced tap, not a silent closure
    if (!s.st && (s.on === "t" || s.on === "d") && i > 0 && prevC === 0 && rnd() < 0.65) {
      push({ c: 6, lv: 0.45 * lv, vv: 1, as: 0.02, fr: 0, F: [300, 0.45 * Fv[1] + 950, 2700], bwm: 1.5, tr: 0.01, aIn: 0.008 }, 0.025);
      s.on = "";
    }
    for (let k = 0; k < s.on.length; k++) consPh(s.on[k], Fv, 0, s.on.length > 1, lv, k < s.on.length - 1 && CW_CONS[s.on[k + 1]].c === 4);
    const cons = t - t0, coda = s.co ? s.co.length * 0.07 * sc : 0;
    const vd = Math.max(s.st ? 0.09 : 0.045, s.d - cons - coda);
    const after = prevC;
    const nas = s.v === "m";
    const V = push({ c: 0, lv: (nas ? 0.55 : 1) * lv, vv: 1, as: (u.bc === 6 ? 0.3 : 0) + 0.04 + 0.1 * (1 - e), fr: 0, F: Fv, F2t: Array.isArray(s.v) ? CW_VOWELS[s.v[1]] : null,
      tr: after === 0 ? 0.07 : after === 6 ? 0.06 : 0.045, aIn: after === 1 || after === 2 || after === 3 ? 0.008 : after === 5 ? 0.01 : 0.025, mp: prevVoiceless ? 0.7 : 0, bwm: nas ? 3 : 1, bw1: nas ? 110 : 0, st: s.st }, vd);
    if (s.st && !u.bc) U.acc.push([V.t0 + 0.6 * vd, 0.6 * s.d + 0.05, 0]);
    if (s.co) { const nf = CW_CONS[s.co[0]]; V.Fn = nf.c === 3 || nf.c === 4 ? nf.F : locus(nf, Fv); }
    for (let k = 0; k < s.co.length; k++) consPh(s.co[k], Fv, 1, s.co.length > 1, lv * 0.9, false);
    s.tEnd = t;
  });
  // the end: a sonorant dies away, a hiss stops; an interrupted phrase stops short
  push({ c: 8, lv: 0, vv: 0, as: 0, fr: 0, F: P.length ? P[P.length - 1].F : CW_VOWELS[10], tr: 0.03, aIn: u.cut ? 0.03 : prevC === 4 || prevC === 3 ? 0.02 : 0.07 }, u.cut ? 0.04 : 0.09);
  // 3. the contour: a phrase declines over its length; the stressed syllables get accents, the last (nuclear) one the
  // biggest; after it, a fall (a statement), a small rise (more to come), a big rise (a question), or level (cut off)
  U.L = t; const R = spk.range;
  if (u.bc) { U.decl = 0; U.tf = 0.25 * t; U.fin = CW_BC[u.bc - 1][1] * R; }
  else {
    U.decl = R * Math.min(1.2, 0.4 + 0.15 * L);
    U.acc.forEach((a, i) => { a[2] = R * (i === U.acc.length - 1 ? 0.6 + 0.4 * rnd() : 0.25 + 0.35 * rnd()); });
    const nuc = U.acc.length ? U.acc[U.acc.length - 1][0] : 0.6 * t;
    U.tf = Math.min(t - 0.1, nuc + 0.05); U.fin = u.cut ? 0 : u.q ? 0.9 * R : u.cont ? 0.25 * R : -0.35 * R;
  }
  for (const ph of P) ph.U = U;
  return P;
}

// knobs -> physics
export function crowdCfg(st) {
  const g = (k) => (st[k] == null ? CROWD_DEFAULTS[k] : +st[k]);
  return {
    "people": Math.max(1, Math.round(Math.pow(CW_MAX_PEOPLE, clamp(g("cwSize"), 0, 1)))),
    "voices": clamp(g("cwVoices"), 0, 1), "mood": clamp(g("cwMood"), 0, 1), "calls": clamp(g("cwCalls"), 0, 1),
    "call": clamp(Math.round(g("cwCall")), 0, CROWD_CALLS.length - 1), "group": clamp(g("cwGroup"), 0, 1),
    "female": clamp(g("cwFemale"), 0, 1), "children": clamp(g("cwChildren"), 0, 1),
    "sync": clamp(g("cwSync"), 0, 1), "tempo": clamp(g("cwTempo"), 30, 240), "chant": clamp(Math.round(g("cwChant")), 0, CW_PATTERNS.length - 1),
    "clap": clamp(g("cwClap"), 0, 1), "clapRate": clamp(g("cwClapRate"), 0.5, 10), "whistle": clamp(g("cwWhistle"), 0, 1),
    "start": clamp(g("cwStart"), 0, 1), "peakAt": clamp(g("cwPeakAt"), 0, 1), "end": clamp(g("cwEnd"), 0, 1),
    "distance": clamp(g("cwDistance"), 0, 1), "seed": Math.round(g("cwSeed")) >>> 0,
    "dur": Math.max(0.05, st.duration || 2), "width": st.width == null ? 0.8 : clamp(st.width, 0, 1),
  };
}

// one person: every draw from hash(seed, k), in a fixed order, so a slider moves a few people and never reshuffles
function cwPerson(C, seed, k, D, rMin, crowdR) {
  const rnd = cwRng(cwHash(seed, k + 1));
  const uReg = rnd(), uSex = rnd(), f0g = cwGauss(rnd), fsg = cwGauss(rnd);
  const p = { k, theta: rnd(), thCall: rnd(), thSync: rnd(), thClap: rnd(), thClapSync: rnd(), thVoice: rnd(), az: rnd(),
    rateMul: Math.exp(0.15 * cwGauss(rnd)), clapMul: Math.exp(0.13 * cwGauss(rnd)), hand: rnd(), handF: rnd(), chantDet: cwGauss(rnd), vseed: cwHash(seed ^ 0x51ced, k + 7) };
  p.reg = uReg < C.children ? 2 : uSex < C.female ? 1 : 0;
  p.f0 = [115, 205, 285][p.reg] * Math.pow(2, f0g * 2 / 12);
  p.fs = [1, 1.16, 1.3][p.reg] * (1 + 0.04 * fsg);
  p.chantF0 = [140, 262, 330][p.reg] * Math.pow(2, p.chantDet * 0.8 / 12);
  const r = Math.sqrt(CW_R0 * CW_R0 + k / (Math.PI * CW_RHO) + D * D);
  p.r = r; p.g = rMin / r; p.delay = (r - rMin) / 343;
  const wD = crowdR / Math.sqrt(crowdR * crowdR + D * D);
  [p.pl, p.pr] = cwPan(Math.sin(2 * Math.PI * p.az) * wD * C.width);
  p.wD = wD;
  return p;
}

// ---------------------------------------------------------------- one voice: a person's whole timeline into L, R
function cwVoice(sr, C, P, X, L, R, vnorm, cal) {
  const TV = (cal && cal.talkV) || CW_TALK_V, anorm = (cal && cal.anorm) || 1, fricK = (cal && cal.fricK) || 0;
  const rnd = cwRng(P.vseed), gauss = () => cwGauss(rnd);
  const N = L.length, d0 = Math.round(P.delay * sr);
  const sigJ = 0.012 + (1 - C.sync) * 0.08;
  const st = { reacts: 0, reactLen: 0, onNow: false, phraseLeft: 0, phraseLen: 0, paused: true, callPause: false, spent: false, wasOn: false, laughLeft: 0, laughF: 0, chantIdx: 0, jit: gauss() * sigJ, lastV: 10, decl0: 2, question: false };
  const isChanter = P.thSync < C.sync, isCaller = P.thCall < C.calls, onceType = cwOnce(C.call);
  st.paused = rnd() < 0.4; st.callPause = !onceType && rnd() < 0.6;   // staggered: not everyone opens their mouth at t = 0
  // round 2: a TALKER's plan and voice come from their own stream (so a caller's or chanter's draws never move), and a
  // talker with no conversation (a stand-in, or one person alone) gets one with partners nobody hears
  const ref = !!(cal && cal.ref), isTalker = !isChanter && !isCaller && !ref;
  st.q = []; st.ui = 0; st.spans = [];
  let prnd = null, spk = null;
  if (isTalker) {
    prnd = cwRng(cwHash(P.vseed, 0x7a1c));
    spk = { range: [3.2, 4.2, 4.8][P.reg || 0] * Math.exp(0.25 * cwGauss(prnd)) * (1 + 0.5 * C.mood), lvl: Math.exp(0.15 * cwGauss(prnd)), rate: (P.rateMul || 1) * Math.exp(0.08 * cwGauss(prnd)) };
    if (!P.utt) { const M = [P]; for (let i = cwGroupSize(C.group, prnd); i > 1; i--) M.push({}); cwTurns(prnd, M, C, N / sr); }
  }
  const pat = CW_PATTERNS[C.chant], beat = 60 / C.tempo;
  const mk = (lenS) => ({ len: Math.max(CW_CTL, Math.round(lenS * sr)), gain: 0, f0: P.f0, pS: 0, pP: 0, pE: 0, pPos: 0.5, v0: st.lastV, v1: st.lastV, vPrev: st.lastV, vPos: 1,
    atk: 0.1, rel: 0.2, on: 0, onLen: 0, coda: 0, codaLen: 0, voiced: 1, asp: 0.04, fricFc: 4500, wob: 0, tiltFc: 1500, jit: 0.01, kind: "sil" });
  const effortAt = (ts) => C.mood * (0.65 + 0.35 * X.act(ts));
  const talkSyl = (ts) => {
    const e = effortAt(ts);
    if (st.phraseLeft <= 0) {
      if (!st.paused) { st.paused = true; return mk((0.25 + 1.2 * rnd()) * (1.35 - 0.85 * e)); }
      st.paused = false; st.phraseLen = st.phraseLeft = 4 + Math.floor(rnd() * 10 * (0.7 + 0.5 * e)); st.question = rnd() < 0.2; st.decl0 = 1.5 + 2 * rnd();
    }
    const idx = st.phraseLen - st.phraseLeft--, pos = idx / Math.max(1, st.phraseLen - 1), last = st.phraseLeft === 0;
    const s = mk((1 / (4.2 + 1.6 * e)) * Math.exp(0.28 * gauss()) * P.rateMul);
    const stress = rnd() < 0.33, base = st.decl0 - (st.decl0 + 2) * pos + (stress ? 2 + 2 * e : 0);
    s.kind = "talk"; s.f0 = P.f0 * Math.pow(2, 5 * e / 12);
    s.pS = base; s.pP = base + (stress ? 1.5 : 0.5); s.pE = base - 0.8 + (last ? (st.question ? 4 : -2.5) : 0); s.pPos = 0.35;
    const u = rnd(); s.on = u < 0.28 ? 0 : u < 0.52 ? 1 : u < 0.75 ? 2 : 3;
    const sec = s.len / sr;
    s.onLen = s.on === 1 ? Math.min(0.45, (0.045 + 0.03 * rnd()) / sec) : s.on === 2 ? Math.min(0.45, (0.05 + 0.04 * rnd()) / sec) : s.on === 3 ? Math.min(0.4, 0.05 / sec) : 0;
    s.onVoiced = rnd() < 0.35 ? 0.5 : 0; s.fricFc = 2600 + 3400 * rnd();
    if (rnd() < 0.25) { s.coda = 2; s.codaLen = Math.min(0.35, 0.06 / sec); }
    s.v0 = TV[Math.floor(rnd() * TV.length)]; s.v1 = rnd() < 0.4 ? TV[Math.floor(rnd() * TV.length)] : s.v0; s.vPos = 0.85;
    s.gain = vnorm * Math.pow(10, 0.9 * e) * (stress ? 1.35 : 1) * Math.exp(0.15 * gauss());
    s.atk = 0.12; s.rel = 0.25; s.asp = 0.04 + 0.1 * (1 - e); s.tiltFc = 800 + 4200 * Math.pow(e, 1.5); s.jit = 0.006 + 0.02 * e;
    if (cal && cal.aspOnly) { s.voiced = 0; s.asp = 1; s.on = 0; s.coda = 0; }
    return s;
  };
  // round 2: the talker follows their conversation (P.utt): listening is silence, a turn or a back-channel is an
  // utterance of phones, queued and played in order
  const talkPh = (tau) => {
    if (st.q.length) return st.q.shift();
    const ts = tau / sr, U = P.utt;
    while (st.ui < U.length && U[st.ui].t1 <= ts + 0.25) st.ui++;
    if (st.ui >= U.length) return mk((N - tau) / sr + 0.01);
    const u = U[st.ui];
    if (u.t0 > ts + 0.002) return mk(u.t0 - ts);
    st.ui++;
    const e = effortAt(ts), phs = cwUtterance(sr, prnd, spk, u, u.t1 - Math.max(ts, u.t0), e);
    const f0 = P.f0 * Math.pow(2, 5 * e / 12), G = vnorm * CW_TALK * Math.pow(10, 0.9 * e) * spk.lvl, tilt = 800 + 4200 * Math.pow(e, 1.5), jit = 0.006 + 0.02 * e;
    let len = 0;
    st.q = phs.map((ph) => { const s = mk(ph.d); len += s.len; s.kind = u.bc ? "bc" : "talk"; s.ph = ph; s.gain = ph.lv * G; s.f0 = f0; s.tiltFc = tilt + (ph.st ? 400 : 0); s.jit = jit; return s; });
    st.spans.push([tau, tau + len, u.bc ? 1 : 0]);
    return st.q.shift();
  };
  const callSeg = (ts) => {
    const e = effortAt(ts);
    if (C.call === 6) {   // LAUGH: bouts of "ha" pulses, then an inhale, then a pause
      if (st.laughLeft <= 0) {
        if (st.callPause) { st.callPause = false; if (rnd() < 0.6) { const g = cwCallShape(8, rnd); return fromShape(g, e, 0.35); } return mk(0.3 + 0.7 * rnd()); }
        st.laughLeft = 3 + Math.floor(rnd() * 6); st.laughF = 4.6 + rnd(); st.laughSt = 4 + 2 * rnd();
      }
      const s = mk((1 / st.laughF) * Math.exp(0.06 * gauss()));
      s.kind = "laugh"; s.f0 = P.f0 * 1.35 * Math.pow(2, 4 * e / 12); s.pS = st.laughSt; s.pP = st.laughSt + 0.5; s.pE = st.laughSt - 1.5; s.pPos = 0.4; st.laughSt -= 0.8;
      s.on = 4; s.onLen = 0.35; s.v0 = rnd() < 0.6 ? 4 : 8; s.v1 = s.v0; s.asp = 0.35; s.atk = 0.1; s.rel = 0.4;
      s.gain = vnorm * Math.pow(10, 0.9 * Math.min(1, e + 0.25)); s.tiltFc = 1200 + 3000 * e; s.jit = 0.02;
      if (--st.laughLeft <= 0) st.callPause = true;
      return s;
    }
    if (st.callPause) { st.callPause = false; return mk((0.12 + 0.6 * rnd()) * (1.25 - 0.6 * e)); }
    const t = C.call === 0 ? cwCheerDraw(rnd) : CW_CALL_TYPES[C.call];
    const g = cwCallShape(t, rnd);
    if (g.once) { st.spent = true; st.reacts++; st.reactLen += g.dur; }
    st.callPause = true;
    const s = fromShape(g, e, 1);
    if (g.then) {   // round 2: a gasp's breath let out, a let-down "aww"'s sigh
      const h = cwCallShape(g.then, rnd);
      if (h.gap) st.q.push(mk(h.gap));
      st.q.push(fromShape(h, e, 0.45));
    }
    return s;
  };
  function fromShape(g, e, lvl) {
    const s = mk(g.dur);
    const ee = Math.min(1, e + g.eAdd);
    Object.assign(s, { kind: g.kind, pS: g.pS, pP: g.pP, pE: g.pE, pPos: g.pPos, v0: g.v0, v1: g.v1, vPos: g.vPos, atk: g.atk, rel: g.rel, on: g.on, onLen: g.onLen, asp: g.asp, voiced: g.voiced, wob: g.wob, squeak: g.squeak, creak: g.creak });
    s.f0 = P.f0 * g.f0mul * Math.pow(2, 5 * ee / 12); s.wobRate = 4.5 + 1.5 * rnd();
    s.gain = vnorm * Math.pow(10, 0.9 * ee) * lvl * Math.exp(0.12 * gauss());
    s.tiltFc = 800 + 4600 * Math.pow(ee, 1.5); s.jit = 0.008 + 0.025 * ee;
    return s;
  }
  const chantSeg = (tau) => {
    const n = pat.syl.length;
    let tn = 0;
    for (;;) {
      const ci = st.chantIdx, sy = pat.syl[ci % n], bar = Math.floor(ci / n);
      tn = ((bar * 4 + sy.b) * beat + st.jit) * sr;
      if (tn >= tau - 1) break;
      st.chantIdx++; st.jit = gauss() * sigJ;
    }
    if (tn > tau + 1) return mk((tn - tau) / sr);
    const sy = pat.syl[st.chantIdx % n], e = Math.max(0.75, C.mood);
    const s = mk(sy.d * beat * Math.exp(0.06 * gauss()));
    s.kind = "chant"; s.f0 = P.chantF0 * Math.pow(2, (sy.st + 3 * (e - 0.75)) / 12); s.pS = -0.5; s.pP = 0.5; s.pE = -1.5; s.pPos = 0.3;
    s.v0 = sy.v0; s.v1 = sy.v1; s.vPos = 0.7; s.on = sy.on; s.onLen = Math.min(0.3, 0.05 / (s.len / sr)); s.fricFc = 4200;
    if (sy.coda) { s.coda = 2; s.codaLen = Math.min(0.3, 0.09 / (s.len / sr)); s.fricFc = 5200; }
    s.atk = 0.06; s.rel = 0.3; s.asp = 0.05; s.gain = vnorm * Math.pow(10, 0.9 * Math.min(1, e + 0.15)) * sy.acc;
    s.tiltFc = 1000 + 4400 * e; s.jit = 0.025; s.wob = 0.1; s.wobRate = 5;
    st.chantIdx++; st.jit = gauss() * sigJ;
    return s;
  };
  const plan = (tau) => {
    const ts = tau / sr, on = X.act(ts) > P.theta; st.onNow = on;
    let s;
    if (!on) { st.spent = false; st.wasOn = false; st.phraseLeft = 0; st.paused = true; st.q.length = 0; s = mk(0.04); }
    else if (isChanter) s = chantSeg(tau);
    else if (isCaller) s = st.q.length ? st.q.shift() : st.spent ? mk(0.05) : callSeg(ts);
    else s = ref ? talkSyl(ts) : talkPh(tau);
    st.wasOn = on;
    s.vPrev = st.lastV; if (s.gain > 0) st.lastV = s.v1;
    return s;
  };

  // ---- synthesis state
  const cur = new Float64Array(18), tgt = new Float64Array(18), dl = new Float64Array(18);
  const y1 = new Float64Array(6), y2 = new Float64Array(6);
  let seg = null, pos = 0, ctl = 0, first = true;
  let amp = 0, dAmp = 0, voi = 0, dVoi = 0, asp = 0, dAsp = 0, fr = 0, dFr = 0, inc = 0, dInc = 0;
  let ph = rnd(), per = 1, shim = 1, tilt = 0, tiltK = 0.1, nPrev = 0, dcx = 0, dcy = 0, fx1 = 0, fx2 = 0, frMk = 1;
  const pl = (P.tpl == null ? P.pl : P.tpl) * P.g, pr = (P.tpr == null ? P.pr : P.tpr) * P.g, fs = P.fs, bwS = Math.sqrt(fs), aspK = 0.35 * anorm * (cal && cal.anorm ? CW_ASP : 1);
  let sounding = 0, E = 0, Ton = 0, cj = 0;
  const ps = { a: 0, vv: 0, as: 0, fr: 0, F1: 500, F2: 1500, F3: 2500, ffc: 4500, fq: 1.4 };   // round 2: where the last control step left off
  for (let n = d0; n < N; n++) {
    const tau = n - d0;
    if (!seg || pos >= seg.len) { seg = plan(tau); pos = 0; ctl = 0; }
    if (ctl <= 0) {
      ctl = CW_CTL;
      // fast path: a pause with the voice rung out is skipped whole
      if (seg.gain === 0 && Math.abs(amp) < 1e-7) {
        const skip = seg.len - pos; if (st.onNow) Ton += skip; n += skip - 1; pos = seg.len; ctl = 0;
        y1.fill(0); y2.fill(0); dcx = dcy = 0; amp = dAmp = 0; ps.a = 0; ps.fr = 0; continue;
      }
      const s = seg, p = Math.min(1, (pos + CW_CTL) / s.len), sec = pos / sr;
      let a, vv, as, ff, ffc, F1, F2, F3, semis, fq = 1.4, bwm = 1, bw1 = 0;
      cj = 0;
      if (s.ph) {
        // round 2: a PHONE. Every control value moves from where the last phone left it (ps) to this phone's target,
        // each over its own time: the level over aIn, voicing / breath over 8 ms, frication over 12 ms (a burst is
        // instant and decays), the formants over tr; a diphthong then glides to its second vowel, and a vowel bends
        // toward a following consonant's locus in its last 35 ms. The pitch is the utterance's contour, not the phone's.
        const ph = s.ph, tE = (pos + CW_CTL) / sr;
        if (!s.i0) { s.i0 = 1; s.a0 = ps.a; s.vv0 = ps.vv; s.as0 = ps.as; s.fr0 = ps.fr; s.Fa = [ps.F1, ps.F2, ps.F3]; }
        a = s.a0 + (s.gain - s.a0) * ease(tE / ph.aIn);
        const qv = Math.min(1, tE / 0.008);
        vv = s.vv0 + (ph.vv - s.vv0) * qv; as = s.as0 + (ph.as - s.as0) * qv;
        ff = ph.burst ? ph.fr * Math.exp(-sec / ph.burst) : s.fr0 + (ph.fr - s.fr0) * Math.min(1, tE / 0.012);
        ffc = ph.ffc || ps.ffc; fq = ph.fq || ps.fq;
        const qf = ease(tE / ph.tr), FA = s.Fa;
        F1 = FA[0] + (ph.F[0] - FA[0]) * qf; F2 = FA[1] + (ph.F[1] - FA[1]) * qf; F3 = FA[2] + (ph.F[2] - FA[2]) * qf;
        if (ph.F2t) { const w2 = ease((tE / ph.d - 0.45) / 0.5); F1 += (ph.F2t[0] - ph.F[0]) * w2; F2 += (ph.F2t[1] - ph.F[1]) * w2; F3 += (ph.F2t[2] - ph.F[2]) * w2; }
        if (ph.Fn) { const w3 = 0.45 * ease((tE - (ph.d - 0.035)) / 0.035); F1 += (ph.Fn[0] - F1) * w3; F2 += (ph.Fn[1] - F2) * w3; F3 += (ph.Fn[2] - F3) * w3; }
        semis = cwPc(ph.U, ph.t0 + tE) + (ph.mp ? ph.mp * (1 - Math.min(1, tE / 0.05)) : 0);
        bwm = ph.bwm || 1; bw1 = ph.bw1 || 0; if (ph.creak) cj = 0.15;
      } else {
        // the vowel's own clock starts after the onset consonant, which has its own envelope (inside the vowel's attack
        // ramp an "s" or an "h" was faded to nothing)
        const pv = s.on && s.onLen > 0 ? Math.max(0, (p - s.onLen) / (1 - s.onLen)) : p;
        a = s.gain * rc(pv / s.atk) * rc((1 - p) / s.rel); vv = s.voiced; as = s.asp; ff = 0; ffc = s.fricFc;
        const w = ease(p / s.vPos), V0 = CW_VOWELS[s.v0], V1 = CW_VOWELS[s.v1];
        F1 = V0[0] + (V1[0] - V0[0]) * w; F2 = V0[1] + (V1[1] - V0[1]) * w; F3 = V0[2] + (V1[2] - V0[2]) * w;
        if (s.on === 0 && s.gain > 0 && p < 0.2) {   // coarticulation: glide in from the last vowel
          const q = ease(p / 0.2), VP = CW_VOWELS[s.vPrev];
          F1 = VP[0] + (F1 - VP[0]) * q; F2 = VP[1] + (F2 - VP[1]) * q; F3 = VP[2] + (F3 - VP[2]) * q;
        }
        if (s.on && p < s.onLen) {
          const q = p / s.onLen;
          const ce = s.gain * rc(q / 0.3) * rc((1 - q) / 0.15 + 0.3);
          if (s.on === 1) { if (q < 0.75) a = s.gain * 0.02; else { a = s.gain; vv = 0; ff = 1.3; ffc = 1800 + 2200 * (s.fricFc - 2600) / 3400; } F1 *= 0.6; }
          else if (s.on === 2) { a = ce; vv = s.onVoiced || 0; ff = 1; }
          else if (s.on === 3) { a = 0.4 * ce; F1 = 260; F2 = 1150 + 200 * q; F3 = 2300; }
          else if (s.on === 4) { a = ce; vv = 0; as = Math.max(as, 0.9); }
          else if (s.on === 5) { a = s.gain * (0.15 + 0.85 * q * q); F1 = 260 + (F1 - 260) * q; }
        } else if ((s.on === 1 || s.on === 3 || s.on === 5) && p < s.onLen + 0.12) {
          const q = ease((p - s.onLen) / 0.12); F1 = 300 + (F1 - 300) * q;
        }
        if (s.coda && p > 1 - s.codaLen) { const q = (p - (1 - s.codaLen)) / s.codaLen; vv *= 1 - q; ff = Math.max(ff, q * 1.1); a = Math.max(a, s.gain * 0.5 * rc((1 - p) / 0.05)); }
        if (s.squeak && p > 0.55) { vv = 0.12 * rc((p - 0.55) / 0.1); }
        semis = shape3(p, s.pS, s.pP, s.pE, s.pPos);
        if (s.wob) semis += s.wob * Math.sin(2 * Math.PI * (s.wobRate || 5) * sec);
        if (s.creak && sec < s.creak) cj = 0.2;   // round 2: a glottal (creaky) onset
      }
      ps.a = a; ps.vv = vv; ps.as = as; ps.fr = ff; ps.F1 = F1; ps.F2 = F2; ps.F3 = F3; ps.ffc = ffc; ps.fq = fq;
      const f0 = Math.max(40, s.f0 * Math.pow(2, semis / 12));
      // the tract: F1-F3 move, F4 the neutral 3.5 kHz; size scales all; breath widens F1
      const bfl = 0.1 * f0;
      cwCoef(tgt, 0, F1 * fs, bw1 || Math.max(70 * bwS + 120 * as, bfl), sr);
      cwCoef(tgt, 3, F2 * fs, Math.max(90 * bwS, bfl) * bwm, sr);
      cwCoef(tgt, 6, F3 * fs, Math.max(150 * bwS, bfl) * bwm, sr);
      cwCoef(tgt, 9, 3500 * fs, 250 * bwS * bwm, sr);
      cwCoef(tgt, 12, 4500 * fs, 300 * bwS * bwm, sr);
      cwBp(tgt, 15, ffc * fs, fq, sr); frMk = cwBpMk(ffc * fs, fq, sr);
      tiltK = 1 - Math.exp(-2 * Math.PI * s.tiltFc / sr);
      if (first) { cur.set(tgt); dl.fill(0); first = false; }
      else for (let j = 0; j < 18; j++) dl[j] = (tgt[j] - cur[j]) / CW_CTL;
      dAmp = (a - amp) / CW_CTL; dVoi = (vv - voi) / CW_CTL; dAsp = (as - asp) / CW_CTL; dFr = (ff - fr) / CW_CTL;
      const tInc = f0 / sr; if (inc === 0) inc = tInc; dInc = (tInc - inc) / CW_CTL;
    }
    ctl--; pos++;
    amp += dAmp; voi += dVoi; asp += dAsp; fr += dFr; inc += dInc;
    for (let j = 0; j < 18; j++) cur[j] += dl[j];
    // source: a saw with per-period jitter / shimmer, a tilt, and aspiration
    const di = inc * per;
    ph += di;
    if (ph >= 1) { ph -= 1; const jj = seg.jit + cj; per = 1 + jj * gauss(); shim = 1 + jj * 6 * gauss(); }
    const saw = 2 * ph - 1 - polyBlep(ph, di);
    tilt += (saw - tilt) * tiltK;
    const nz = rnd() * 2 - 1, nd = nz - nPrev; nPrev = nz;
    let x = tilt * voi * shim * 2.5 + nd * asp * aspK;
    // the cascade (5 formants), the fricative (a bandpass on white noise) in parallel
    let y = cur[0] * x + cur[1] * y1[0] + cur[2] * y2[0]; y2[0] = y1[0]; y1[0] = y;
    y = cur[3] * y + cur[4] * y1[1] + cur[5] * y2[1]; y2[1] = y1[1]; y1[1] = y;
    y = cur[6] * y + cur[7] * y1[2] + cur[8] * y2[2]; y2[2] = y1[2]; y1[2] = y;
    y = cur[9] * y + cur[10] * y1[3] + cur[11] * y2[3]; y2[3] = y1[3]; y1[3] = y;
    y = cur[12] * y + cur[13] * y1[4] + cur[14] * y2[4]; y2[4] = y1[4]; y1[4] = y;
    const f = cur[15] * (nz - fx2) - cur[16] * y1[5] - cur[17] * y2[5]; y2[5] = y1[5]; y1[5] = f; fx2 = fx1; fx1 = nz;
    const out = (y + f * fr * fricK * frMk) * amp;
    const dc = out - dcx + 0.995 * dcy; dcx = out; dcy = dc;
    L[n] += dc * pl; R[n] += dc * pr;
    if (amp > 0) sounding++;
    if (st.onNow) Ton++;
    E += dc * dc;
  }
  return { sounding, E, Ton, reacts: st.reacts, reactLen: st.reactLen, mode: isChanter ? "H" : isCaller ? "C" : "T", spans: st.spans, d0 };
}

// ---------------------------------------------------------------- the bed: a group of far people, statistically
function cwGroup(sr, C, G, X, L, R) {
  const rnd = cwRng(G.seed), gauss = () => cwGauss(rnd);
  const N = L.length, d0 = Math.round(G.delay * sr), stepS = CW_CTL / sr;
  const shCh = C.sync, shCa = (1 - C.sync) * C.calls, shT = (1 - C.sync) * (1 - C.calls);
  const pat = CW_PATTERNS[C.chant], beat = 60 / C.tempo, sig = Math.sqrt(Math.pow(0.012 + (1 - C.sync) * 0.08, 2) + G.delaySd * G.delaySd);
  const callT = C.call, laugh = callT === 6, once = cwOnce(callT);
  const cv = CW_CALL_VOWEL[callT];
  const nT = Math.max(1, G.n * shT), nC = Math.max(1, G.n * shCa);
  const dT = Math.min(0.85, 1.4 / Math.sqrt(nT)), dC = Math.min(0.7, 1 / Math.sqrt(nC)), dL = Math.min(0.85, 1.4 / Math.sqrt(nC));
  const mT = cwSmooth(4.5 * stepS, rnd), mC = cwSmooth(0.8 * stepS, rnd), mL = cwSmooth(5 * stepS, rnd), wF1 = cwSmooth(5 * stepS, rnd), wF2 = cwSmooth(4 * stepS, rnd);
  const fsM = G.fsMean, vsh = (b) => b * (0.35 + 0.65 * Math.sqrt(Math.min(1, CW_CHORUS / G.n)));
  // the chorus: pseudo-voices, each with a behavior, a register, a threshold, and its own envelope
  const osc = [];
  for (let o = 0; o < CW_CHORUS; o++) {
    const u = rnd(), reg = u < C.children ? 2 : rnd() < C.female ? 1 : 0;
    const mode = rnd() < shCh ? 2 : rnd() < C.calls ? 1 : 0;
    osc.push({ reg, mode, f0: [115, 205, 285][reg] * Math.pow(2, gauss() * 2 / 12), cf0: [140, 262, 330][reg] * Math.pow(2, gauss() * 0.8 / 12), th: rnd(),
      ph: rnd(), prev: 0, am: 0, dAm: 0, inc: 0, dInc: 0, syl: cwSmooth(4.5 * stepS, rnd), pit: cwSmooth(3 * stepS, rnd), phr: cwSmooth(0.35 * stepS, rnd),
      t0: -1, shape: null, gap: rnd() * 0.5, ci: 0, jit: gauss() * sig, side: o & 1, spent: false });
  }
  // chains: [noise L, noise R, chorus A, chorus B] x [F1, F2]
  const cA = new Float64Array(9), y1 = new Float64Array(10), y2 = new Float64Array(10);
  let lvlN = 0, dLvlN = 0, lvlC = 0, dLvlC = 0, kN = 1, hiss = 0, dHiss = 0, ctl = 0, ux1 = 0, ux2 = 0, vx1 = 0, vx2 = 0;
  const w = G.width, PM = G.P;
  // the chant envelope: the pattern's syllables, each a box smeared by a Gaussian of sigma = jitter + delay spread
  const chantEnv = (ts) => {
    const bar = Math.floor(ts / (4 * beat)); let best = 0, bv = 4, sum = 0;
    for (let b = bar - 1; b <= bar + 1; b++) for (const sy of pat.syl) {
      const T = (b * 4 + sy.b) * beat, D = sy.d * beat;
      const v = 0.5 * (cwErf((ts - T) / (1.4142135623730951 * sig)) - cwErf((ts - T - D) / (1.4142135623730951 * sig))) * sy.acc;
      sum += v * v; if (v > best) { best = v; bv = (ts - T) / D < 0.5 ? sy.v0 : sy.v1; }
    }
    return [sum, bv];
  };
  // the reactions' power profile k(tau) on a 10 ms grid (64 draws of the call, never heard), normalized to integrate
  // to the measured mean reaction length, then the expected share reacting at t: sum of joins(t - tau) k(tau)
  let oaT = null;
  if (once) {
    const kr = cwRng(cwHash(G.seed, 77)), K = new Float64Array(400);
    for (let i = 0; i < 64; i++) { const sh = cwCallShape(CW_CALL_TYPES[callT], kr); for (let j = 0; j < K.length && j * 0.01 < sh.dur; j++) { const p = (j + 0.5) * 0.01 / sh.dur; const a2 = rc(p / sh.atk) * rc((1 - p) / sh.rel); K[j] += a2 * a2; } }
    let kS = 0; for (const v of K) kS += v * 0.01; for (let j = 0; j < K.length; j++) K[j] *= PM.onceD / Math.max(1e-9, kS);
    const F = Math.ceil(N / sr * 100) + 2; oaT = new Float64Array(F);
    for (let f = 0; f < F; f++) { let v = 0; for (let j = 0; j < K.length && j <= f; j++) if (K[j] > 0) v += Math.max(0, X.amax((f - j) * 0.01) - X.amax((f - j - 1) * 0.01)) * K[j]; oaT[f] = v; }
  }
  let chantMS = 0; for (let i = 0; i < 200; i++) chantMS += chantEnv(4 * beat * (5 + i / 200))[0] / 200;   // the bar's mean square
  chantMS = Math.max(1e-6, chantMS);
  for (let n = d0; n < N; n++) {
    if (ctl <= 0) {
      ctl = CW_CTL;
      const ts = (n - d0) / sr, a = X.act(ts), e = C.mood * (0.65 + 0.35 * a);
      // reactions: who has joined in the last call-length (the running maximum of the swell)
      // round 2: the joins convolved with the reactions' own mean POWER envelope (oaT, below), not a box of the mean
      // length: people's reactions differ in length and each fades, and the box made the far crowd stop dead
      const oa = once ? oaT[Math.min(oaT.length - 1, Math.floor(ts * 100))] : 0;
      // the noise: each behavior's power, its vowel, and its share left after the chorus
      // per-person power is MEASURED (PM, from the near voices of this crowd, or unheard stand-ins): a voice's level
      // depends on its vowel and envelope (an "oo" is ~10 dB under an "ah"), so a nominal level made the bed up to 13 dB hot
      const pT = shT * a * PM.T * Math.pow(1 + dT * mT(), 2) / (1 + dT * dT * CW_SMOOTH_MS);
      const pCo = once ? shCa * oa * PM.onceP : shCa * a * PM.C;   // time-averaged
      const pC = once ? pCo : laugh ? pCo * Math.pow(1 + dL * mL(), 2) / (1 + dL * dL * CW_SMOOTH_MS) : pCo * Math.pow(1 + dC * mC(), 2) / (1 + dC * dC * CW_SMOOTH_MS);
      const ce = shCh > 0 ? chantEnv(ts) : [0, 4];
      const pH = shCh * a * PM.H * ce[0] / chantMS;
      const vT = vsh(0.45), vC = vsh(callT === 5 ? 0.35 : laugh ? 0.35 : 0.6), vH = vsh(0.65);
      const pNoise = G.E * (pT * (1 - vT) + pC * (1 - vC) + pH * (1 - vH));
      // the formants are the power-weighted mix of each behavior's vowel; before anyone has joined, a neutral babble
      const qT = pT + 1e-12 * (1 + shT), pTot = qT + pC + pH;
      const VH = CW_VOWELS[ce[1]];
      const F1 = (qT * 520 * (1 + 0.15 * wF1() * dT) + pC * cv[0] + pH * VH[0]) / pTot, F2 = (qT * 1450 * (1 + 0.12 * wF2() * dT) + pC * cv[1] + pH * VH[1]) / pTot;
      const bw1 = (qT * 260 + pC * 110 + pH * 100) / pTot, bw2 = (qT * 480 + pC * 160 + pH * 140) / pTot;
      cwCoef(cA, 0, F1 * fsM, bw1, sr); cwCoef(cA, 3, F2 * fsM, bw2, sr);
      kN = 1 / Math.sqrt(cwChainPow(cA, [0, 3], sr));
      dLvlN = (Math.sqrt(pNoise) * kN - lvlN) / CW_CTL;
      // the upper band: talk's sibilance (~4.5 kHz, 4% of its power), a shout's presence (~2.7 kHz, 8%)
      const pU = G.E * (pT * 0.04 + (pC * CW_PRESENCE[callT] + pH * 0.08)), fU = ((qT * 4500 + (pC + pH) * 2700) / pTot) * fsM, qU = (qT * 1.4 + (pC + pH) * 2.5) / pTot;
      cwBp(cA, 6, fU, qU, sr);
      dHiss = (Math.sqrt(pU) * cwBpMk(fU, qU, sr) - hiss) / CW_CTL;
      // the chorus' overall level: its share of each behavior's TIME-AVERAGED power (its own envelopes carry the shape)
      const pCh = G.E * (shT * a * PM.T * vT + pCo * vC + shCh * a * PM.H * vH);
      dLvlC = (Math.sqrt(pCh / 0.45) * kN - lvlC) / CW_CTL;
      for (const o of osc) {
        let am = 0, f0 = o.f0;
        const on = a > o.th;
        if (!on) o.spent = false;
        if (o.mode === 0 && on) { am = clamp(0.55 + 0.9 * o.syl(), 0, 1) * (o.phr() > -0.45 ? 1 : 0); f0 = o.f0 * Math.pow(2, (5 * e + 3 * o.pit()) / 12); }
        else if (o.mode === 1 && on) {
          if (laugh) { const q = (ts * 5.1 + o.th * 3) % 1; const bout = o.phr() > -0.2; am = bout ? Math.max(0, Math.sin(Math.PI * q)) * (q < 0.3 ? 0.4 : 1) : 0; f0 = o.f0 * 1.35 * Math.pow(2, (6 - 6 * (ts % 1.2)) / 12); }
          else {
            if (o.t0 < 0 || ts > o.t0 + (o.shape ? o.shape.dur : 0) + o.gap) {
              if (!(once && o.spent)) { o.shape = cwCallShape(callT === 0 ? cwCheerDraw(rnd) : CW_CALL_TYPES[callT], rnd); o.t0 = ts; o.gap = 0.15 + 0.5 * rnd(); if (o.shape.once) o.spent = true; }
            }
            const sh = o.shape;
            if (sh && ts >= o.t0 && ts < o.t0 + sh.dur) {
              const p = (ts - o.t0) / sh.dur; am = rc(p / sh.atk) * rc((1 - p) / sh.rel) * (sh.voiced ? 1 : 0.15);
              f0 = o.f0 * sh.f0mul * Math.pow(2, (5 * Math.min(1, e + sh.eAdd) + shape3(p, sh.pS, sh.pP, sh.pE, sh.pPos)) / 12);
            }
          }
        } else if (o.mode === 2 && on) {
          const nS = pat.syl.length;
          for (;;) { const sy = pat.syl[o.ci % nS], T = ((Math.floor(o.ci / nS) * 4 + sy.b) * beat + o.jit); if (T + sy.d * beat >= ts) break; o.ci++; o.jit = gauss() * sig; }
          const sy = pat.syl[o.ci % nS], T = (Math.floor(o.ci / nS) * 4 + sy.b) * beat + o.jit, D = sy.d * beat;
          if (ts >= T) { const p = (ts - T) / D; am = rc(p / 0.08) * rc((1 - p) / 0.3) * sy.acc; f0 = o.cf0 * Math.pow(2, sy.st / 12); }
        }
        o.dAm = (am - o.am) / CW_CTL; const ti = f0 / sr; if (o.inc === 0) o.inc = ti; o.dInc = (ti - o.inc) / CW_CTL;
      }
    }
    ctl--;
    lvlN += dLvlN; lvlC += dLvlC; hiss += dHiss;
    // noise, two decorrelated channels
    const zl = (rnd() * 2 - 1) * 1.7320508075688772, zr = (rnd() * 2 - 1) * 1.7320508075688772;   // unit variance
    let a1 = cA[0] * zl + cA[1] * y1[0] + cA[2] * y2[0]; y2[0] = y1[0]; y1[0] = a1;
    a1 = cA[3] * a1 + cA[4] * y1[1] + cA[5] * y2[1]; y2[1] = y1[1]; y1[1] = a1;
    let b1 = cA[0] * zr + cA[1] * y1[2] + cA[2] * y2[2]; y2[2] = y1[2]; y1[2] = b1;
    b1 = cA[3] * b1 + cA[4] * y1[3] + cA[5] * y2[3]; y2[3] = y1[3]; y1[3] = b1;
    // the chorus, two chains (odd / even pseudo-voices)
    let sa = 0, sb = 0;
    for (let i = 0; i < CW_CHORUS; i++) {
      const o = osc[i]; o.am += o.dAm; o.inc += o.dInc;
      if (o.am <= 1e-6) continue;
      o.ph += o.inc; if (o.ph >= 1) o.ph -= 1;
      // a band-limited PULSE train (the differenced polyBLEP saw): a flat spectrum at unit power, so the chain's noise
      // normalization holds for it too (a saw's energy sits in its low harmonics, one of which can land on a narrow peak)
      const sw = 2 * o.ph - 1 - polyBlep(o.ph, o.inc), v = (o.prev - sw) * o.am / Math.sqrt(2 * o.inc + 1e-9); o.prev = sw;
      if (o.side) sb += v; else sa += v;
    }
    const cn = Math.sqrt(2 / CW_CHORUS);
    let c1 = cA[0] * sa * cn + cA[1] * y1[4] + cA[2] * y2[4]; y2[4] = y1[4]; y1[4] = c1;
    c1 = cA[3] * c1 + cA[4] * y1[5] + cA[5] * y2[5]; y2[5] = y1[5]; y1[5] = c1;
    let c2 = cA[0] * sb * cn + cA[1] * y1[6] + cA[2] * y2[6]; y2[6] = y1[6]; y1[6] = c2;
    c2 = cA[3] * c2 + cA[4] * y1[7] + cA[5] * y2[7]; y2[7] = y1[7]; y1[7] = c2;
    const ul = rnd() * 2 - 1, ur = rnd() * 2 - 1;
    let hl = cA[6] * (ul - ux2) - cA[7] * y1[8] - cA[8] * y2[8]; y2[8] = y1[8]; y1[8] = hl; hl *= hiss;
    let hr = cA[6] * (ur - vx2) - cA[7] * y1[9] - cA[8] * y2[9]; y2[9] = y1[9]; y1[9] = hr; hr *= hiss;
    ux2 = ux1; ux1 = ul; vx2 = vx1; vx1 = ur;
    const l = a1 * lvlN + c1 * lvlC * 0.75 + c2 * lvlC * 0.35 + hl, r = b1 * lvlN + c2 * lvlC * 0.75 + c1 * lvlC * 0.35 + hr;
    const m = 0.3535533905932738 * (l + r), s = 0.3535533905932738 * (l - r) * w;   // power p across BOTH channels, like a panned voice
    L[n] += m + s; R[n] += m - s;
  }
}

// ---------------------------------------------------------------- claps
function cwClapVoice(sr) {   // one clap: noise -> bandpass (unit peak) * flMk-style unit-RMS makeup * (attack, exp decay)
  return function (ev, out, n0, rnd) {
    const w0 = 2 * Math.PI * ev.fc / sr, al = Math.sin(w0) / (2 * ev.Q), a0 = 1 + al;
    const b0 = al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0, mk = Math.sqrt(3 * ev.Q * sr / (Math.PI * ev.fc));
    const wp = 2 * Math.PI * 330 / sr, alp = Math.sin(wp) / (2 * 3), a0p = 1 + alp;
    const pb0 = alp / a0p, pa1 = -2 * Math.cos(wp) / a0p, pa2 = (1 - alp) / a0p, mkp = Math.sqrt(3 * 3 * sr / (Math.PI * 330));
    const att = Math.max(1, Math.round(0.0004 * sr)), dec = Math.exp(-1 / (ev.tau * sr)), life = Math.min(out[0].length - n0, Math.round((7 * ev.tau + 0.02) * sr));
    let x1 = 0, x2 = 0, z1 = 0, z2 = 0, p1 = 0, p2 = 0, q1 = 0, q2 = 0, env = 1, e2 = 0;
    for (let i = 0; i < life; i++) {
      const x = rnd() * 2 - 1;
      const y = b0 * (x - x2) - a1 * z1 - a2 * z2; x2 = x1; x1 = x; z2 = z1; z1 = y;
      let v = y * mk;
      if (ev.pop > 0) { const yp = pb0 * (x - q2) - pa1 * p1 - pa2 * p2; q2 = q1; q1 = x; p2 = p1; p1 = yp; v += yp * mkp * ev.pop; }
      const g = (i < att ? (i + 1) / att : (env *= dec)) * ev.amp;
      const s = v * g; e2 += s * s;
      out[0][n0 + i] += s * ev.pl; out[1][n0 + i] += s * ev.pr;
    }
    return e2;
  };
}
// the people's hands: flat (palm to palm, bright) .. cupped (dark, with a low pop) — Repp 1987's configurations, spread
const cwHand = (P) => ({ fc: P.hand < 0.55 ? 1800 + 800 * P.handF : 800 + 500 * P.handF, Q: P.hand < 0.55 ? 1.6 + P.handF : 3 + 1.5 * P.handF, pop: P.hand < 0.55 ? 0.15 : 0.55, tau: P.hand < 0.55 ? 0.0025 + 0.002 * P.handF : 0.004 + 0.003 * P.handF });

// ---------------------------------------------------------------- whistles
function cwWhistle(sr, ev, out, n0, rnd) {
  const n = Math.min(out[0].length - n0, Math.round(ev.dur * sr)), lp = 1 - Math.exp(-2 * Math.PI * 250 / sr);
  let ph = 0, nb = 0, vib = rnd() * 6;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const semis = ev.type === 0 ? -3 + 3 * ease(p / 0.2) - (p > 0.85 ? 2 * (p - 0.85) / 0.15 : 0) : ev.type === 1 ? (p < 0.5 ? 0 : 4 * ease((p - 0.5) / 0.1)) : 2 - 7 * ease(p);
    const f = ev.f * Math.pow(2, (semis + 0.25 * Math.sin(vib)) / 12);
    vib += 2 * Math.PI * 6 / sr;
    ph += f / sr; if (ph >= 1) ph -= 1;
    nb += ((rnd() * 2 - 1) - nb) * lp;
    const s = Math.sin(2 * Math.PI * ph);
    const v = (s * 0.9 + nb * 4 * s) * rc(p / 0.06) * rc((1 - p) / 0.15) * ev.amp;
    out[0][n0 + i] += v * ev.pl; out[1][n0 + i] += v * ev.pr;
  }
}

// calibration, ONCE (cfg never moves it): the RMS of a reference voice (a man's schwa at effort 0, 115 Hz) and the energy
// of a reference clap (unit amp), so CW_VOICE_RMS and CW_CLAP_POWER are what they say
const CW_CAL = {};
function cwCalibrate(sr) {
  if (CW_CAL[sr]) return CW_CAL[sr];
  const n = Math.round(3 * sr), L = new Float32Array(n), R = new Float32Array(n);
  const C = crowdCfg({ cwMood: 0, duration: 3 }); C.mood = 0;
  const P = { f0: 115, fs: 1, chantF0: 140, theta: -1, thCall: 1, thSync: 1, pl: 1, pr: 1, g: 1, delay: 0, rateMul: 1, vseed: 12345 };
  const X = { act: () => 1, amax: () => 1 };
  // a man talking at effort 0 (the whole talk vowel mix: open vowels come out of a unity-DC cascade ~7 dB over a schwa,
  // as real vowels differ in intrinsic loudness, so the reference is the mix, not one vowel), voiced then aspirated
  const rmsOf = (aspOnly) => {
    L.fill(0); R.fill(0); cwVoice(sr, C, P, X, L, R, 1, aspOnly ? { ref: true, aspOnly, talkV: [8, 5] } : { ref: true });   // aspiration: the gasp's own vowels
    let e = 0, m = 0; for (let i = 0; i < n; i++) { const v = L[i]; if (v !== 0) { e += v * v; m++; } }
    return Math.sqrt(e / Math.max(1, m));
  };
  const vrms = rmsOf(false), arms = rmsOf(true);

  const clap = cwClapVoice(sr), out = [new Float32Array(sr >> 2), new Float32Array(sr >> 2)], rnd = cwRng(777);
  let ce = 0;
  for (let i = 0; i < 16; i++) { out[0].fill(0); out[1].fill(0); ce += clap(Object.assign(cwHand({ hand: i / 16, handF: (i * 7 % 16) / 16 }), { amp: 1, pl: 1, pr: 0 }), out, 0, rnd); }
  CW_CAL[sr] = { vnorm: CW_VOICE_RMS / vrms, anorm: vrms / arms, fricK: CW_FRIC * vrms, clapE: ce / 16 / sr };   // clapE: energy of a unit clap, in s
  return CW_CAL[sr];
}

export function makeCrowd(sr, cfg, seed) {
  const C = Object.assign(crowdCfg({}), cfg);
  const cal = cwCalibrate(sr);
  const n = Math.max(1, Math.round(C.dur * sr)), L = new Float32Array(n), R = new Float32Array(n);
  const S = (seed ^ Math.imul(C.seed + 1, 0x9e3779b1)) >>> 0;
  const rnd = cwRng(cwHash(S, 0xc0de));
  const info = { people: C.people, voices: 0, voicesSounding: 0, groups: 0, bedPeople: 0, clappers: 0, clapsNear: 0, clapsFar: 0, clapBed: 0, whistles: 0, ms: {} };
  const D = CW_FAR * C.distance * C.distance;
  const crowdR = Math.sqrt(C.people / (Math.PI * CW_RHO)) + CW_R0, rMin = Math.sqrt(CW_R0 * CW_R0 + D * D);
  // the swell (excitement envelope) and its running maximum, tabulated at 10 ms
  const tabN = Math.ceil(C.dur * 100) + 2, aT = new Float64Array(tabN), mT = new Float64Array(tabN);
  for (let i = 0; i < tabN; i++) { aT[i] = shape3(clamp(i / 100 / C.dur, 0, 1), C.start, 1, C.end, C.peakAt); mT[i] = Math.max(aT[i], i ? mT[i - 1] : 0); }
  const look = (T, ts) => { if (ts <= 0) return ts < 0 && T === mT ? 0 : T[0]; const x = ts * 100, i = Math.floor(x); if (i >= tabN - 1) return T[tabN - 1]; return T[i] + (T[i + 1] - T[i]) * (x - i); };
  const X = { act: (ts) => look(aT, ts), amax: (ts) => look(mT, ts) };
  const t0 = Date.now();
  // measurement only (no draws, no audio): the energy each part adds
  let eAcc = 0; const part = (name) => { let e = 0; for (let i = 0; i < n; i++) e += L[i] * L[i] + R[i] * R[i]; info.e[name] = e - eAcc; eAcc = e; };
  info.e = {};
  // ---- the nearest people, as voices
  const people = [];
  const nv = Math.min(C.people, CW_VOICES);
  for (let k = 0; k < nv; k++) people.push(cwPerson(C, S, k, D, rMin, crowdR));
  // round 2: the near TALKERS in conversations, neighbours by distance; a group stands together, so its voices come
  // from round the first one's direction (a talk-only pan: the same people's claps stay where they were)
  if (C.voices > 0) {
    const tk = people.filter((P) => P.thVoice < C.voices && !(P.thSync < C.sync) && !(P.thCall < C.calls)), grnd = cwRng(cwHash(S, 0x9a7e));
    info.convos = [];
    for (let i = 0; i < tk.length;) {
      let m = cwGroupSize(C.group, grnd);
      if (m > 2 && tk.length - i - m === 1) m--;   // never leave the last one talking to nobody: they join the next table
      const M = tk.slice(i, i + m); i += M.length;
      for (let j = 0; j < M.length; j++) { const az = M[0].az + (j ? 0.05 * cwGauss(grnd) : 0); [M[j].tpl, M[j].tpr] = cwPan(Math.sin(2 * Math.PI * az) * M[j].wD * C.width); }
      cwTurns(grnd, M, C, C.dur); info.convos.push(M.length);
    }
  }
  const acc = { T: [0, 0], C: [0, 0], H: [0, 0], re: [0, 0, 0] };   // [energy, samples on]; reactions [energy, count, seconds]
  const spans = [];
  const take = (r) => { if (r.spans) for (const sp of r.spans) spans.push([sp[0] + r.d0, sp[1] + r.d0, sp[2]]); acc[r.mode][0] += r.E; acc[r.mode][1] += r.Ton; if (r.reacts) { acc.re[0] += r.E; acc.re[1] += r.reacts; acc.re[2] += r.reactLen; } };
  if (C.voices > 0) for (const P of people) if (P.thVoice < C.voices) { info.voices++; const r = cwVoice(sr, C, P, X, L, R, cal.vnorm, cal); info.voicesSounding += r.sounding / sr; take(r); }
  info.ms.voices = Date.now() - t0; part("voices"); info.eMode = { T: +acc.T[0].toPrecision(3), C: +acc.C[0].toPrecision(3), H: +acc.H[0].toPrecision(3) };
  // measurement only: how many near talkers are mid-utterance at once (10 ms frames), turns and back-channels apart
  if (spans.length) {
    const F = Math.ceil(n / (sr / 100)), cT = new Uint8Array(F), cB = new Uint8Array(F);
    for (const [a, b, bc] of spans) for (let f = Math.floor(a / (sr / 100)); f < Math.min(F, b / (sr / 100)); f++) (bc ? cB : cT)[f]++;
    const st = (c) => { const v = Array.from(c).sort((x, y) => x - y); return { mean: +(v.reduce((s2, x) => s2 + x, 0) / F).toFixed(2), p90: v[Math.floor(0.9 * F)], max: v[F - 1] }; };
    info.talking = { turns: st(cT), backch: st(cB) };
  }
  // ---- the bed: everyone else who uses their voice, in log-spaced groups
  const t1 = Date.now();
  if (C.people > nv && C.voices > 0) {
    // the bed's per-person power, measured: from the near voices, topped up by unheard stand-ins (rendered into a scratch
    // buffer, never heard) for any behavior the near voices did too little of
    const shares = { T: (1 - C.sync) * (1 - C.calls), C: (1 - C.sync) * C.calls, H: C.sync }, once = cwOnce(C.call);
    let sL = null, sR = null, extra = 0;
    for (const m of ["T", "C", "H"]) {
      if (shares[m] <= 0) continue;
      for (let i = 0; i < 6 && (once && m === "C" ? acc.re[1] < 4 : acc[m][1] < 1.5 * sr); i++) {
        if (!sL) { sL = new Float32Array(n); sR = new Float32Array(n); }
        const P = cwPerson(C, S ^ 0x5ca1e, 100000 + extra++, D, rMin, crowdR);
        P.thSync = m === "H" ? -1 : 2; P.thCall = m === "C" ? -1 : 2; P.delay = 0; P.theta = Math.min(P.theta, 0.5) * 0.5;
        take(cwVoice(sr, C, P, X, sL, sR, cal.vnorm, cal));
      }
    }
    info.standIns = extra;
    const pw = (m) => acc[m][0] / Math.max(1, acc[m][1]);
    const PM = { T: pw("T"), C: pw("C"), H: pw("H"), onceD: acc.re[1] ? acc.re[2] / acc.re[1] : 0.5, onceP: 0 };
    PM.onceP = acc.re[1] ? acc.re[0] / acc.re[1] / (PM.onceD * sr) : 0;
    info.PM = Object.fromEntries(Object.entries(PM).map(([k2, v]) => [k2, +v.toPrecision(3)]));
    const K = Math.min(CW_GROUPS, Math.ceil((C.people - nv) / 6));
    for (let j = 0; j < K; j++) {
      const ka = Math.round(nv * Math.pow(C.people / nv, j / K)), kb = j === K - 1 ? C.people : Math.round(nv * Math.pow(C.people / nv, (j + 1) / K));
      if (kb <= ka) continue;
      let E = 0, dS = 0, dS2 = 0, cnt = 0;
      for (let k = ka; k < kb; k++) { const r = Math.sqrt(CW_R0 * CW_R0 + k / (Math.PI * CW_RHO) + D * D), g = rMin / r, d = (r - rMin) / 343; E += g * g; dS += d; dS2 += d * d; cnt++; }
      const dm = dS / cnt, ra = Math.sqrt(ka / (Math.PI * CW_RHO)) + CW_R0;
      const G = { n: cnt * C.voices, E: E * C.voices, delay: dm, delaySd: Math.sqrt(Math.max(0, dS2 / cnt - dm * dm)), seed: cwHash(S ^ 0xbedbed, j),
        P: PM, fsMean: (1 - C.children) * (1 + 0.16 * C.female) + C.children * 1.3, width: C.width * Math.min(1, ra / Math.sqrt(ra * ra + D * D) + 0.3) };
      cwGroup(sr, C, G, X, L, R); info.groups++; info.bedPeople += Math.round(G.n);
    }
  }
  info.ms.bed = Date.now() - t1; part("bed");
  // ---- claps
  const t2 = Date.now();
  if (C.clap > 0) {
    const clap = cwClapVoice(sr), out = [L, R], crnd = cwRng(cwHash(S, 0xc1a9));
    const pat = CW_PATTERNS[C.chant], beat = 60 / C.tempo;
    const clapBeats = C.sync > 0 && pat.claps.length ? pat.claps : [0, 1, 2, 3];
    const unitE = cal.clapE;                                   // energy of a unit clap (s)
    const ampFor = (rate) => Math.sqrt(CW_CLAP_POWER / (4 * unitE)) * Math.pow(4 / rate, 0.15);   // a slower clapper claps harder
    // the nearest clappers, one by one
    let k = 0, near = 0; const clappers = [];
    while (near < CW_CLAPPERS && k < C.people) { const P = k < people.length ? people[k] : cwPerson(C, S, k, D, rMin, crowdR); if (P.thClap < C.clap) { clappers.push(P); near++; } k++; }
    const kFar = k;
    info.clappers = clappers.length;
    for (const P of clappers) {
      const h = cwHand(P), rate = C.clapRate * P.clapMul, synced = P.thClapSync < C.sync, prnd = cwRng(cwHash(P.vseed, 99));
      const sigC = 0.008 + (1 - C.sync) * 0.06, d0 = P.delay;
      let t = synced ? 0 : prnd() / rate, bi = 0;
      for (let guard = 0; guard < 4000; guard++) {
        if (synced) { const bar = Math.floor(bi / clapBeats.length); t = (bar * 4 + clapBeats[bi % clapBeats.length]) * beat + cwGauss(prnd) * sigC; bi++; }
        const ts = t + d0; if (ts >= C.dur) break;
        if (ts >= 0 && X.act(t) > P.theta) {
          const e = clap({ fc: h.fc * (1 + 0.05 * cwGauss(prnd)), Q: h.Q, pop: h.pop, tau: h.tau * (1 + 0.15 * cwGauss(prnd)), amp: ampFor(rate) * P.g * Math.exp(0.2 * cwGauss(prnd)), pl: P.pl, pr: P.pr }, out, Math.round(ts * sr), crnd);
          info.clapsNear++;
        }
        if (!synced) t += (1 / rate) * (1 + 0.04 * cwGauss(prnd));
      }
    }
    part("clapsNear");
    // the far clappers: a stream of the same claps (Poisson when free, gathered round the beat when together), capped,
    // the excess energy a band of noise with the same envelope
    const nFar = Math.max(0, Math.round((C.people - kFar) * C.clap));
    if (nFar > 0) {
      let Eg = 0, cnt = 0; for (let kk = kFar; kk < C.people; kk++) { const r = Math.sqrt(CW_R0 * CW_R0 + kk / (Math.PI * CW_RHO) + D * D); Eg += (rMin / r) ** 2; cnt++; }
      const g2 = Eg / cnt, nSync = nFar * C.sync, nFree = nFar - nSync, rate = C.clapRate;
      const farPerson = () => { const kk = kFar + Math.floor(crnd() * (C.people - kFar)); const r = Math.sqrt(CW_R0 * CW_R0 + kk / (Math.PI * CW_RHO) + D * D); return { g: rMin / r, d: (r - rMin) / 343, pan: cwPan((crnd() * 2 - 1) * C.width * crowdR / Math.sqrt(crowdR * crowdR + D * D)) }; };
      const drawClap = (ts, fp) => {
        const h = cwHand({ hand: crnd(), handF: crnd() }), amp = ampFor(rate) * fp.g * Math.exp(0.2 * cwGauss(crnd));
        if (ts >= 0 && ts < C.dur) { clap({ fc: h.fc, Q: h.Q, pop: h.pop, tau: h.tau, amp, pl: fp.pan[0], pr: fp.pan[1] }, out, Math.round(ts * sr), crnd); info.clapsFar++; }
      };
      const bedEnv = new Float64Array(Math.ceil(C.dur * 200) + 1);   // excess power, 5 ms steps
      const capFree = Math.min(1, CW_FAR_CLAPS * (nFree / Math.max(1, nFar)) / Math.max(1e-9, nFree * rate));
      // free: Poisson at nFree * rate * a(t), thinned to the cap
      if (nFree > 0) for (let t = 0; t < C.dur;) {
        t += -Math.log(Math.max(1e-12, crnd())) / (nFree * rate * capFree);
        if (t >= C.dur) break; if (crnd() > X.act(t)) continue;
        const fp = farPerson(); drawClap(t + fp.d, fp);
      }
      if (nFree > 0 && capFree < 1) for (let i = 0; i < bedEnv.length; i++) bedEnv[i] += nFree * rate * X.act(i / 200) * (1 - capFree) * g2;
      // together: per clap beat, a cluster of claps around it (jitter + delay spread), capped per beat
      if (nSync > 0) {
        const sigC = 0.008 + (1 - C.sync) * 0.06, perBeatCap = CW_FAR_CLAPS * beat;
        let dS = 0, dS2 = 0; for (let i = 0; i < 64; i++) { const fp = farPerson(); dS += fp.d; dS2 += fp.d * fp.d; }
        const dm = dS / 64, sigT = Math.sqrt(sigC * sigC + Math.max(0, dS2 / 64 - dm * dm));
        for (let bi = 0; ; bi++) {
          const bar = Math.floor(bi / clapBeats.length), T = (bar * 4 + clapBeats[bi % clapBeats.length]) * beat;
          if (T > C.dur) break;
          const want = nSync * X.act(T), draw = Math.min(want, perBeatCap), m = Math.floor(draw) + (crnd() < draw % 1 ? 1 : 0);
          for (let i = 0; i < m; i++) { const fp = farPerson(); drawClap(T + cwGauss(crnd) * sigC + fp.d, fp); }
          if (want > draw) for (let i = 0; i < bedEnv.length; i++) { const ts = i / 200, z = (ts - T - dm) / sigT; if (Math.abs(z) < 4) bedEnv[i] += (want - draw) * g2 * Math.exp(-0.5 * z * z) / (sigT * Math.sqrt(2 * Math.PI)); }
        }
      }
      // the noise band: power = claps per second * energy per clap at the mean far gain
      let any = false; for (const v of bedEnv) if (v > 0) { any = true; break; }
      if (any) {
        info.clapBed = 1;
        const amp0 = ampFor(rate), Q = 0.9, fc = 1500, w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
        const b0 = al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0, mk = Math.sqrt(3 * Q * sr / (Math.PI * fc));
        let xl1 = 0, xl2 = 0, yl1 = 0, yl2 = 0, xr1 = 0, xr2 = 0, yr1 = 0, yr2 = 0;
        for (let i = 0; i < n; i++) {
          const x = i / sr * 200, j = Math.min(bedEnv.length - 2, Math.floor(x)), pw = bedEnv[j] + (bedEnv[j + 1] - bedEnv[j]) * (x - j);
          const lv = Math.sqrt(Math.max(0, pw) * unitE * 0.5) * amp0 * mk;   // half the power in each channel
          const zl = crnd() * 2 - 1, zr = crnd() * 2 - 1;
          const yl = b0 * (zl - xl2) - a1 * yl1 - a2 * yl2; xl2 = xl1; xl1 = zl; yl2 = yl1; yl1 = yl;
          const yr = b0 * (zr - xr2) - a1 * yr1 - a2 * yr2; xr2 = xr1; xr1 = zr; yr2 = yr1; yr1 = yr;
          L[i] += yl * lv; R[i] += yr * lv;
        }
      }
    }
  }
  info.ms.claps = Date.now() - t2; part("clapsFar");
  // ---- whistles
  if (C.whistle > 0) {
    const wrnd = cwRng(cwHash(S, 0x3157)), out = [L, R];
    const lam = Math.min(5, C.whistle * 0.35 * Math.sqrt(C.people));
    for (let t = wrnd() / lam; t < C.dur; t += -Math.log(Math.max(1e-12, wrnd())) / lam) {
      if (wrnd() > X.act(t)) continue;
      const kk = Math.floor(wrnd() * C.people), r = Math.sqrt(CW_R0 * CW_R0 + kk / (Math.PI * CW_RHO) + D * D);
      const ev = { f: 2200 + 1400 * wrnd(), type: Math.floor(wrnd() * 3), dur: 0.35 + 0.75 * wrnd(), amp: CW_WHISTLE_RMS * 1.4142135623730951 * (rMin / r), pl: 0, pr: 0 };
      [ev.pl, ev.pr] = cwPan((wrnd() * 2 - 1) * C.width * crowdR / Math.sqrt(crowdR * crowdR + D * D));
      const ts = t + (r - rMin) / 343; if (ts < C.dur) { cwWhistle(sr, ev, out, Math.round(ts * sr), wrnd); info.whistles++; }
    }
  }
  part("whistles");
  { const tot = Object.values(info.e).reduce((a, b) => a + b, 0) || 1; for (const k in info.e) info.e[k] = Math.round(1000 * info.e[k] / tot) / 10; }
  // ---- air absorption and the distance's dark, then a DC blocker
  const fc = 16000 * Math.pow(2, -3.5 * C.distance), al = 1 - Math.exp(-2 * Math.PI * fc / sr);
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0, dlx = 0, dly = 0, drx = 0, dry = 0;
  for (let i = 0; i < n; i++) {
    l1 += (L[i] - l1) * al; l2 += (l1 - l2) * al; r1 += (R[i] - r1) * al; r2 += (r1 - r2) * al;
    const a = l2 - dlx + 0.999 * dly; dlx = l2; dly = a; const b = r2 - drx + 0.999 * dry; drx = r2; dry = b;
    L[i] = a; R[i] = b;
  }
  info.ms.total = Date.now() - t0;
  let t = 0;
  return { L, R, info, tick(drive, o) { o[0] = (L[t] || 0) * drive; o[1] = (R[t] || 0) * drive; t++; } };
}

// crowdLevel: RMS CW_RMS, peak capped at CW_PEAK (Normalize off reads this level), in place
export function crowdLevel(L, R) {
  let s = 0, pk = 0;
  for (let i = 0; i < L.length; i++) { s += L[i] * L[i] + R[i] * R[i]; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const rms = Math.sqrt(s / (2 * L.length));
  if (rms < 1e-9) return 0;
  const g = Math.min(CW_RMS / rms, CW_PEAK / pk);
  for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
  return g;
}
// the synth.js loop written out: the cfg from the rows, the buffer, the amp envelope as a plain gain (drive(i))
export function renderCrowd(sr, st, seed, drive) {
  const c = makeCrowd(sr, crowdCfg(st), seed);
  crowdLevel(c.L, c.R);
  if (drive) for (let i = 0; i < c.L.length; i++) { const d = drive(i); c.L[i] *= d; c.R[i] *= d; }
  return c;
}

// =====================================================================================================================
// THE CLI: the listening rounds
// =====================================================================================================================
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli();

function runCli() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SR = 44100, TARGET_LUFS = -18, VERBOSE = process.argv.includes("--measure");
  const G = { console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  const ctx = createContext(Object.assign({}, G)); ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx);
  const dctx = createContext(Object.assign({}, G));
  runInContext(readFileSync(join(ROOT, "dsp.js"), "utf8"), dctx, { filename: "dsp.js" });
  const reverbProcess = dctx.reverbProcess;
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  const PRESETS = pctx.window.PRESETS;
  const preset = (n) => { const o = Object.assign({}, PRESETS[n]); delete o._vary; delete o._alts; return o; };
  const people = (n) => Math.round(Math.log(n) / Math.log(CW_MAX_PEOPLE) * 1000) / 1000;   // the cwSize that gives n people

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, gated), with its 0.95 peak cap
  function biquad(x, b0, b1, b2, a0, a1, a2) {
    const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  function kweight(x) {
    const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, c = Math.cos(w), al = Math.sin(w) / (2 / Math.sqrt(2)), sa = 2 * Math.sqrt(A) * al;
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
  // as weather.mjs / flow.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js
  // limiterProcess), the smallest amount in steps of 0.1 that brings it within 0.5 dB
  function matchWithLimiter(L, R) {
    const L0 = Float32Array.from(L), R0 = Float32Array.from(R);
    matchLoudness(L, R);
    if (lufs(L, R) > TARGET_LUFS - 0.5) return 0;
    let pk = 0; for (let i = 0; i < L0.length; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, amt);
      matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5 || amt > 0.95) { L.set(l); R.set(r); return Math.round(amt * 10) / 10; }
    }
    return 0;
  }

  // ---- a model take: each layer through the engine (crowdLevel, the amp envelope as its gain), summed at its delay;
  // then the take's room through the app's Freeverb, then the edge guards
  function renderModel(t, dur) {
    const room = t.room || { reverb: 0 }, pad = room.reverb > 0 ? 0.9 : 0.1, n = Math.round((dur + pad) * SR);
    const L = new Float32Array(n), R = new Float32Array(n), infos = [];
    const layers = t.layers || [{ st: t.st, delay: 0, gain: 1, env: t.env }];
    const t0 = Date.now();
    layers.forEach((ly, i) => {
      const d = ly.dur || dur - (ly.delay || 0), env = Object.assign({ a: 0.02, r: 0.3 }, ly.env || t.env || {});
      const c = makeCrowd(SR, crowdCfg(Object.assign({ duration: d, width: 0.85 }, ly.st)), (t.seed || 1) + 7919 * i);
      crowdLevel(c.L, c.R);
      const m = c.L.length, off = Math.round((ly.delay || 0) * SR), g = ly.gain == null ? 1 : ly.gain;
      for (let j = 0; j < m && off + j < n; j++) {
        const ts = j / SR, e = rc(ts / env.a) * rc((d - ts) / env.r);
        L[off + j] += c.L[j] * e * g; R[off + j] += c.R[j] * e * g;
      }
      infos.push(c.info);
    });
    const ms = Date.now() - t0;
    if (room.reverb > 0) reverbProcess(L, R, room.reverbSize ?? 0.5, room.reverbTone ?? 0.5, room.reverb);
    const fi = Math.floor(0.004 * SR), fo = Math.floor(0.06 * SR);
    for (let i = 0; i < fi; i++) { const g = i / fi; L[i] *= g; R[i] *= g; }
    for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
    return { L, R, infos, ms, audioSec: layers.reduce((s, ly) => s + (ly.dur || dur - (ly.delay || 0)), 0) };
  }
  function renderControl(patch) {
    const r = CS.render(Object.assign({}, CS.DEFAULTS, patch), { normalize: true });
    return { L: Float32Array.from(r.L), R: Float32Array.from(r.R), infos: null };
  }

  // ---- measurement (we cannot listen)
  function fft(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  const N_FFT = 2048, binHz = SR / N_FFT;
  function frames(L, R, hop) {
    const N = N_FFT, out = [];
    for (let a = 0; a + N <= L.length; a += hop) {
      const re = new Float64Array(N), im = new Float64Array(N); let e = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), x = (L[a + i] + R[a + i]) / 2; re[i] = x * w; e += x * x; }
      fft(re, im);
      const mag = new Float64Array(N / 2); let num = 0, den = 0;
      for (let k = 1; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); num += k * mag[k] * mag[k]; den += mag[k] * mag[k]; }
      out.push({ t: (a + N / 2) / SR, db: 10 * Math.log10(e / N + 1e-20), cent: den > 0 ? num / den * SR / N : 0, mag });
    }
    return out;
  }
  function envDb(L, R, hopS, winS) {
    const hop = Math.floor(hopS * SR), w = Math.floor(winS * SR), env = [];
    for (let a = 0; a + w <= L.length; a += hop) { let s = 0; for (let i = a; i < a + w; i++) s += L[i] * L[i] + R[i] * R[i]; env.push(10 * Math.log10(s / w + 1e-20)); }
    return env;
  }
  // events HEARD (weather.mjs's detector): 1 ms frames of the high-passed signal 6 dB over the median of the 40 ms round them
  function eventsHeard(L, R) {
    const n = L.length, h = Math.floor(0.001 * SR), E = [];
    for (let a = 1; a + h <= n; a += h) { let s = 0; for (let i = a; i < a + h; i++) { const x = L[i] - L[i - 1], y = R[i] - R[i - 1]; s += x * x + y * y; } E.push(s); }
    let on = 0;
    for (let i = 20; i < E.length - 20; i++) {
      if (!(E[i] > E[i - 1] && E[i] >= E[i + 1])) continue;
      const nb = E.slice(i - 20, i + 21).sort((x, y) => x - y)[20];
      if (E[i] > nb * 4) on++;
    }
    return on / Math.max(1e-6, (E.length - 40) / 1000);
  }
  // THE MODULATION SPECTRUM of the 300 Hz-4 kHz band: a 5 ms dB envelope over the live stretch, minus its 0.6 s moving
  // mean, then the energy per modulation band (Hann-windowed DFT 0.5-20 Hz). Speech babble from a few talkers puts its
  // weight at 3-8 Hz (syllables); a roar of thousands flattens it; a chant peaks at the beat; applause sits high.
  function modSpectrum(L, R) {
    const n = L.length, hop = Math.round(0.005 * SR), w0h = 2 * Math.PI * 300 / SR, w0l = 2 * Math.PI * 4000 / SR;
    let hp = 0, xp = 0, lp = 0; const env = []; let acc = 0, k = 0;
    const ah = Math.exp(-w0h), al = 1 - Math.exp(-w0l);
    for (let i = 0; i < n; i++) {
      const x = (L[i] + R[i]) / 2; hp = ah * (hp + x - xp); xp = x; lp += (hp - lp) * al;
      acc += lp * lp; if (++k === hop) { env.push(10 * Math.log10(acc / hop + 1e-12)); acc = 0; k = 0; }
    }
    const top = Math.max(...env), live = []; for (let i = 0; i < env.length; i++) if (env[i] > top - 35) live.push(i);
    if (live.length < 80) return null;
    const a = live[0], b = live[live.length - 1], seg = env.slice(a, b + 1).map((v) => Math.max(v, top - 35));
    const W = Math.round(0.6 / 0.005), dt = seg.map((v, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - W / 2); j < Math.min(seg.length, i + W / 2); j++) { s += seg[j]; c++; } return v - s / c; });
    const fr = 1 / 0.005, M = dt.length, bands = { "0.5-2": 0, "2-8": 0, "8-20": 0 }; let best = 0, bestF = 0, tot = 0;
    for (let f = 0.5; f <= 20; f += 0.25) {
      let re = 0, im = 0; for (let i = 0; i < M; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (M - 1)); re += dt[i] * h * Math.cos(2 * Math.PI * f * i / fr); im += dt[i] * h * Math.sin(2 * Math.PI * f * i / fr); }
      const p = re * re + im * im; tot += p; if (p > best) { best = p; bestF = f; }
      bands[f < 2 ? "0.5-2" : f < 8 ? "2-8" : "8-20"] += p;
    }
    let sd = 0; for (const v of dt) sd += v * v; sd = Math.sqrt(sd / M);
    return { peakHz: bestF, depthDb: sd, shares: Object.fromEntries(Object.entries(bands).map(([k2, v]) => [k2, v / (tot || 1)])) };
  }
  // beat: the autocorrelation of the detrended envelope at a lag (the chant's beat or bar)
  function beatCorr(L, R, lagS) {
    const env = envDb(L, R, 0.01, 0.02), m = env.reduce((s, x) => s + x, 0) / env.length, x = env.map((v) => v - m), lag = Math.round(lagS / 0.01);
    let s = 0, a = 0, b = 0; for (let i = 0; i + lag < x.length; i++) { s += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag]; }
    return s / Math.sqrt(a * b + 1e-20);
  }
  function measure(L, R, S, t) {
    const n = L.length; let pk = 0, nan = 0, sl = 0, sr2 = 0, slr = 0;
    for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); sl += L[i] * L[i]; sr2 += R[i] * R[i]; slr += L[i] * R[i]; }
    const e = Math.floor(0.002 * SR); let sMax = 0, eMax = 0;
    for (let i = 0; i < e; i++) { sMax = Math.max(sMax, Math.abs(L[i]), Math.abs(R[i])); eMax = Math.max(eMax, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeStart: sMax / (pk || 1), edgeEnd: eMax / (pk || 1), lrCorr: slr / Math.sqrt(sl * sr2 + 1e-20) };
    const F = frames(L, R, 1024), top = Math.max(...F.map((f) => f.db)), live = F.filter((f) => f.db > top - 30);
    m.centroid = live.reduce((s, f) => s + f.cent, 0) / (live.length || 1);
    const edges = [0, 300, 1000, 3000, SR / 2], share = [0, 0, 0, 0];
    for (const f of live) for (let k = 1; k < N_FFT / 2; k++) { const p = f.mag[k] * f.mag[k], hz = k * binHz; for (let b = 0; b < 4; b++) if (hz >= edges[b] && hz < edges[b + 1]) share[b] += p; }
    const tot = share.reduce((s, x) => s + x, 0) || 1; m.bands = share.map((x) => x / tot);
    m.events = eventsHeard(L, R);
    m.mod = modSpectrum(L, R);
    m.curve = envDb(L, R, 0.25, 0.25).map((v) => Math.round(v - Math.max(...envDb(L, R, 0.25, 0.25))));
    if (S.beat || t.beat) { const st = t.layers ? t.layers[0].st : t.st || {}; const bt = 60 / (st.cwTempo || S.beat || 120); m.beat = { beat: beatCorr(L, R, bt), bar: beatCorr(L, R, 4 * bt), half: beatCorr(L, R, bt / 2) }; }
    return m;
  }
  const pct = (x) => (x * 100).toFixed(0) + "%";
  const fmt = (m, k) => {
    const p = [m.sec.toFixed(2) + " s", m.lufs.toFixed(1) + " LUFS", "peak " + m.peak.toFixed(3), "centroid " + Math.round(m.centroid) + " Hz",
      "bands <300/300-1k/1-3k/>3k " + m.bands.map(pct).join("/"), "L/R correlation " + m.lrCorr.toFixed(2), "onsets heard " + m.events.toFixed(1) + "/s"];
    if (m.mod) p.push("modulation peak " + m.mod.peakHz + " Hz (depth " + m.mod.depthDb.toFixed(1) + " dB; 0.5-2 / 2-8 / 8-20 Hz " + Object.values(m.mod.shares).map(pct).join(" / ") + ")");
    if (m.beat) p.push("envelope autocorrelation at the beat " + m.beat.beat.toFixed(2) + ", the bar " + m.beat.bar.toFixed(2) + ", half a beat " + m.beat.half.toFixed(2));
    p.push("loudness every 250 ms (dB from the top) " + m.curve.join(" "));
    if (k && k.infos) p.push("engine: " + k.infos.map((i) => i.people + " people (" + i.voices + " voices, " + i.groups + " bed groups of " + i.bedPeople + ", " + i.clappers + " near clappers, claps " + i.clapsNear + " near + " + i.clapsFar + " far" + (i.clapBed ? " + a clap bed" : "") + ", " + i.whistles + " whistles" + (i.talking ? "; near talkers mid-utterance at once: turns " + i.talking.turns.mean + " (p90 " + i.talking.turns.p90 + "), back-channels " + i.talking.backch.mean + "; conversations of " + (i.convos || []).join(", ") : "") + "; energy " + Object.entries(i.e).map(([a, b]) => a + " " + b + "%").join(", ") + ")").join(" + ") + ", rendered in " + k.ms + " ms (" + Math.round(k.ms / k.audioSec) + " ms per second of crowd)");
    if (m.limiter) p.push("LIMITER " + m.limiter);
    return p.join(", ");
  };

  // ---- the controls for the gaps: the best builds from TODAY's engines, layered (a layer's `s` is a diff on the
  // defaults, `d` its delay, `g` its gain, `p` semitones)
  const talkL = (o) => Object.assign({ wave: 28, crSize: 1, crPitchStart: 2, crPitchEnd: -3, crPeak: 0.3, crOpenStart: 0.25, crOpenPeak: 0.75, crOpenEnd: 0.3, crVowelStart: 0.35, crVowelEnd: 0.6,
    crNasal: 0.3, crTension: 0.5, crJitter: 0.3, crShimmer: 0.25, crRough: 0.05, crBreath: 0.15, attack: 0.01, hold: 0.06, decay: 0.08, sustain: 0, release: 0.03, drive: 0, cutoff: 18000, reso: 0, width: 0.7, gain: 0.7 }, o);
  const TAVERN_CONTROL = Object.assign(talkL({ freq: 118, repeat: 9, rate: 5.2, duration: 1.8, reverb: 0.3, reverbSize: 0.55, reverbTone: 0.45 }), {
    layers: JSON.stringify([
      { s: talkL({ freq: 205, crSize: 0.86, repeat: 10, rate: 5.8, crVowelStart: 0.15, crVowelEnd: 0.45, duration: 1.8 }), d: 0.35, g: 0.85, p: 0 },
      { s: talkL({ freq: 140, crSize: 1.05, repeat: 7, rate: 4.4, crVowelStart: 0.55, crVowelEnd: 0.8, duration: 1.7 }), d: 0.8, g: 0.8, p: 0 },
      { s: talkL({ freq: 228, crSize: 0.84, repeat: 9, rate: 6.2, crVowelStart: 0.2, crVowelEnd: 0.5, duration: 1.6 }), d: 1.3, g: 0.7, p: 0 },
    ]) });
  const gaspL = (o) => Object.assign({ wave: 13, freq: 240, formantVowel: 0.15, formantSize: 1, formantQ: 0.3, formantBreath: 0.95, formantTilt: 0.3, sweep: 0.05, attack: 0.03, hold: 0.05, decay: 0.25, sustain: 0, release: 0.1,
    cutoff: 9000, reso: 0.1, width: 0.7, gain: 0.7, duration: 0.6 }, o);
  const GASP_CONTROL = Object.assign(gaspL({ reverb: 0.35, reverbSize: 0.7 }), {
    layers: JSON.stringify([
      { s: gaspL({ formantSize: 0.9 }), d: 0.03, g: 0.8, p: 4 },
      { s: gaspL({ formantSize: 1.1, formantVowel: 0.2 }), d: 0.06, g: 0.8, p: -5 },
      { s: gaspL({ formantSize: 0.8, formantVowel: 0.1 }), d: 0.1, g: 0.6, p: 9 },
    ]) });

  // ---- THE ROUNDS, in listening order
  const ROOM_STADIUM = { reverb: 0.35, reverbSize: 0.92, reverbTone: 0.4 };
  const ROUNDS = [
    { slug: "tavern-chatter", name: "Tavern Chatter", dur: 4.5, controlName: "a layered build (no preset exists)", control: TAVERN_CONTROL,
      controlWhy: "NO PRESET does chatter. The control is the best build from today's engines: FOUR creature-engine (wave 28) talkers, human-sized tracts (two men at 118 / 140 Hz, two women at 205 / 228 Hz), each a burst of 7-10 syllable \"calls\" at 4.4-6.2 a second (each burst falls a little per call, like a phrase), entering 0, 0.35, 0.8 and 1.3 s, in the app's reverb (0.3, size 0.55). About 2.9 s.",
      listen: "A busy tavern or inn: people talking all around you, a loop under a scene. Which one is a ROOM FULL OF PEOPLE TALKING? Listen for many separate voices (near ones you could almost follow, the rest a bed), syllables that never line up, and NO real words. Then: does it sit still as a loop, or does something stick out? The takes are NOT the same length (one is shorter).",
      takes: [
        { id: "busy-tavern", why: "MODEL, 28 people around you (all individual voices, the nearest at 1.1 m, the farthest at 3.3 m), excitement 0.5 (raised voices, quicker syllables), two thirds men; 10% of them LAUGHING (bouts of breathy \"ha\" pulses at ~5 a second, then an inhale) instead of talking. A small warm room (reverb 0.22, size 0.5).",
          st: { cwSize: people(28), cwMood: 0.5, cwCalls: 0.1, cwCall: 6, cwFemale: 0.35 }, room: { reverb: 0.22, reverbSize: 0.5, reverbTone: 0.4 }, seed: 11, env: { a: 0.35, r: 0.4 } },
        { id: "hushed-room", why: "MODEL, 14 people talking QUIETLY (excitement 0.05: soft, darker, breathier voices, slower syllables, longer pauses), half women: a hushed inn at night, a library, a waiting room. Reverb 0.25, size 0.6.",
          st: { cwSize: people(14), cwMood: 0.05, cwFemale: 0.5 }, room: { reverb: 0.25, reverbSize: 0.6, reverbTone: 0.5 }, seed: 23, env: { a: 0.35, r: 0.4 } },
        { id: "great-hall", why: "MODEL, 220 people in a big hall or market: the nearest 28 are voices, the other ~190 a statistical bed (6 groups by distance whose syllabic flicker fades with their number), 10% children, a few laughing (6%), standing a little back (distance 0.15). A large room (reverb 0.35, size 0.85).",
          st: { cwSize: people(220), cwMood: 0.45, cwCalls: 0.06, cwCall: 6, cwFemale: 0.5, cwChildren: 0.1, cwDistance: 0.15 }, room: { reverb: 0.35, reverbSize: 0.85, reverbTone: 0.4 }, seed: 37, env: { a: 0.35, r: 0.4 } },
      ] },
    { slug: "crowd-cheer", name: "Crowd Cheer", dur: 3.5, controlName: "Crowd Cheer",
      controlWhy: "the CURRENT preset \"Crowd Cheer\" (one formant voice at 415 Hz holding an \"ah\" with a sweep, a vowel LFO, vibrato and noise; 1.6 s), rendered by the exported engine.",
      listen: "A crowd cheering (a goal, a win, a hero arriving). Which one is MANY PEOPLE cheering? Listen for many separate shouts at many pitches (\"aah\", \"yeah\", \"woo\"), a swell as people join, and whether it sounds like a crowd or like one voice with noise. The takes are NOT the same length (one is shorter).",
      takes: [
        { id: "stadium-in-the-stands", why: "MODEL, 2500 people, you in the stands: everyone calls (90%), the cheer mix (35% \"aah\", 30% \"yeah\", 25% rising falsetto \"woo\", 10% \"hey\"), shouting (excitement 0.85), some clapping (25%) and two-finger whistles; the swell starts at 35% of the crowd, peaks at 1.2 s and settles to 65%. Near shouters are distinct, the rest a roar (6 bed groups). Stadium room (reverb 0.35, size 0.92).",
          st: { cwSize: people(2500), cwMood: 0.85, cwCalls: 0.9, cwCall: 0, cwFemale: 0.4, cwChildren: 0.05, cwClap: 0.25, cwWhistle: 0.35, cwStart: 0.35, cwPeakAt: 0.35, cwEnd: 0.65, cwDistance: 0.05 }, room: ROOM_STADIUM, seed: 101 },
        { id: "party-cheer", why: "MODEL, 35 people in a room (a party, a tavern brawl won, a small audience): every voice individual, everyone cheering (85% calling, the cheer mix), lively clapping (50%, ~5 a second) and a few whistles; an eruption (from 10% to everyone at 0.7 s) settling to half. Small room (reverb 0.18, size 0.45).",
          st: { cwSize: people(35), cwMood: 0.9, cwCalls: 0.85, cwCall: 0, cwFemale: 0.5, cwClap: 0.5, cwClapRate: 5, cwWhistle: 0.25, cwStart: 0.1, cwPeakAt: 0.2, cwEnd: 0.5 }, room: { reverb: 0.18, reverbSize: 0.45, reverbTone: 0.5 }, seed: 113 },
        { id: "distant-stadium", why: "MODEL, 3000 people heard from OUTSIDE the stadium (distance 0.7: ~74 m, the air taking the top, the crowd's width narrowing, no near voices): a long \"AAAH\" roar (95% calling \"aah\") with some clapping and whistles, swelling from 40% to everyone at 1.75 s. Big, dark room (reverb 0.45, size 0.95, tone 0.3).",
          st: { cwSize: 1, cwMood: 0.9, cwCalls: 0.95, cwCall: 1, cwFemale: 0.4, cwClap: 0.3, cwWhistle: 0.2, cwStart: 0.4, cwPeakAt: 0.5, cwEnd: 0.6, cwDistance: 0.7 }, room: { reverb: 0.45, reverbSize: 0.95, reverbTone: 0.3 }, seed: 127 },
      ] },
    { slug: "crowd-applause", name: "Crowd Applause", dur: 4.0, controlName: "Crowd Applause",
      controlWhy: "the CURRENT preset \"Crowd Applause\" (the particle engine at 150 crackles a second, mid tone, wide; 2.0 s), rendered by the exported engine.",
      listen: "An audience applauding (after a performance, a level cleared, a speech). Which one is PEOPLE CLAPPING? Listen for hands (each clap a slap with a body to it, some bright, some hollow), each person at their own pace, and whether the applause rises and dies away like a real one. The takes are NOT the same length (one is shorter).",
      takes: [
        { id: "theatre-applause", why: "MODEL, 400 people (theatre): 95% clapping at ~4.2 a second each (each person their own rate and hands: flat palm-to-palm ~2 kHz or cupped ~1 kHz with a low pop), the nearest 32 individual, the rest a stream of the same claps (~1500/s) plus a band for the excess; a few \"woo\"s and whistles (3% of people use their voice). Everyone joins in 0.5 s, then they drop out one by one to 10% by the end. Theatre room (reverb 0.3, size 0.8).",
          st: { cwSize: people(400), cwVoices: 0.03, cwMood: 0.65, cwCalls: 1, cwCall: 0, cwClap: 0.95, cwClapRate: 4.2, cwWhistle: 0.1, cwStart: 0.15, cwPeakAt: 0.12, cwEnd: 0.1, cwDistance: 0.05 }, room: { reverb: 0.3, reverbSize: 0.8, reverbTone: 0.45 }, seed: 211 },
        { id: "small-group", why: "MODEL, 14 people clapping (a few friends, a small room): every clapper individual, so you can hear separate hands at separate rates (~4.5 a second); two or three cheer. Starts at 30%, everyone by 0.4 s, dies to 5%. Small room (reverb 0.15, size 0.4).",
          st: { cwSize: people(14), cwVoices: 0.2, cwMood: 0.6, cwCalls: 1, cwCall: 0, cwClap: 1, cwClapRate: 4.5, cwStart: 0.3, cwPeakAt: 0.1, cwEnd: 0.05 }, room: { reverb: 0.15, reverbSize: 0.4, reverbTone: 0.5 }, seed: 223 },
        { id: "rhythmic-encore", why: "MODEL, 600 people clapping TOGETHER (85% locked to one beat at 132 BPM, 2.2 claps a second: the \"encore\" applause, half the rate of free clapping, as real audiences do when they synchronize), the far half smeared by their distance; no voices; building from 60% to everyone at 2 s. Theatre room.",
          st: { cwSize: people(600), cwVoices: 0, cwClap: 1, cwSync: 0.85, cwTempo: 132, cwStart: 0.6, cwPeakAt: 0.5, cwEnd: 1 }, room: { reverb: 0.3, reverbSize: 0.8, reverbTone: 0.45 }, seed: 227, beat: true },
      ] },
    { slug: "audience-gasp", name: "Audience Gasp", dur: 3.0, controlName: "a layered build (no preset exists)", control: GASP_CONTROL,
      controlWhy: "NO PRESET does an audience reaction. The control is the best build from today's engines: FOUR formant-engine (wave 13) breathy \"hah\"s (breath 0.95, an open vowel, 0.6 s, no sustain) at 240 Hz, +4, -5 and +9 semitones, entering over 0.1 s, in the app's reverb (0.35, size 0.7).",
      listen: "An audience REACTING to something shocking or amazing (a near miss, a magic trick, a twist): a collective gasp. Which one is a ROOM OF PEOPLE gasping? Listen for many separate breaths bunched together (not one breath), and what happens right after. The takes are NOT the same length (one is shorter).",
      takes: [
        { id: "shocked-gasp", why: "MODEL, 250 people inhaling sharply: everyone gasps ONCE as they react (the swell reaches everyone in 0.18 s, so the onsets bunch into a fifth of a second), each gasp an inhale through an open mouth (\"hhah\": aspiration through the tract, no voice), 0.16-0.32 s, a third ending in a tiny ingressive squeak; then the room rings out. Reverb 0.35, size 0.8.",
          st: { cwSize: people(250), cwMood: 0.4, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.06, cwEnd: 0 }, room: { reverb: 0.35, reverbSize: 0.8, reverbTone: 0.45 }, seed: 307 },
        { id: "gasp-into-ooh", why: "MODEL, two layers: the same gasp, then 0.22 s later the impressed \"OOOooh\" (each person once: an \"o\" closing to \"oo\", rising 3 semitones and falling 5-7, 0.9-1.7 s), the crowd joining in a quarter second. Reverb 0.35, size 0.8.",
          layers: [{ st: { cwSize: people(250), cwMood: 0.4, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.06, cwEnd: 0 }, delay: 0, gain: 1 },
            { st: { cwSize: people(250), cwMood: 0.4, cwCalls: 1, cwCall: 2, cwStart: 0, cwPeakAt: 0.09, cwEnd: 0, cwSeed: 1 }, delay: 0.22, gain: 0.9, env: { a: 0.02, r: 0.5 } }],
          room: { reverb: 0.35, reverbSize: 0.8, reverbTone: 0.45 }, seed: 311 },
        { id: "gasp-then-whispers", why: "MODEL, two layers, a smaller audience (120): the gasp, then the room breaking into hushed talk (excitement 0.15) that builds from nothing to most people over the next second and a half. Reverb 0.3, size 0.7.",
          layers: [{ st: { cwSize: people(120), cwMood: 0.4, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.06, cwEnd: 0 }, delay: 0, gain: 1 },
            { st: { cwSize: people(120), cwMood: 0.15, cwStart: 0, cwPeakAt: 0.6, cwEnd: 0.85, cwSeed: 2 }, delay: 0.3, gain: 0.6 }],
          room: { reverb: 0.3, reverbSize: 0.7, reverbTone: 0.45 }, seed: 313 },
      ] },
    { slug: "stadium-chant", name: "Stadium Chant", dur: 5.0, controlName: "Chant Loop", beat: 120,
      controlWhy: "the CURRENT preset \"Chant Loop\" (Voice / Vocal: ONE formant voice at 130 Hz, an \"oo\", four 0.5 s shots, in reverb; 2.0 s), the only chant in the app, rendered by the exported engine.",
      listen: "A stadium crowd CHANTING together (a sports game, an arena, a rally): thousands on one rhythm. Which one is a CROWD chanting? Listen for many voices landing together but never quite together (the far side of the stadium late), the rhythm, and whether it is a crowd or a voice. The takes are NOT the same length (one is shorter).",
      takes: [
        { id: "hey-hey-hey", why: "MODEL, 2500 people shouting \"HEY!\" on every beat (118 BPM, the first of each bar a touch louder and higher), 90% together (each voice within ~20 ms, plus up to ~0.1 s from where they stand), clapping (30%) on the beats. Men an octave under the women. Stadium room (reverb 0.35, size 0.92).",
          st: { cwSize: people(2500), cwMood: 0.9, cwSync: 0.9, cwTempo: 118, cwChant: 0, cwClap: 0.3, cwFemale: 0.3, cwDistance: 0.05 }, room: ROOM_STADIUM, seed: 401, env: { a: 0.12, r: 0.4 } },
        { id: "de-FENSE", why: "MODEL, 3000 people on a two-syllable chant, short-LONG (\"de-FENSE\": a short \"di\" then a held \"EH\" with an \"s\" tail, the second higher) at 100 BPM, then two beats of rest filled by claps on every beat (60% clapping); 85% together. Stadium room.",
          st: { cwSize: 1, cwMood: 0.85, cwSync: 0.85, cwTempo: 100, cwChant: 1, cwClap: 0.6, cwFemale: 0.35, cwDistance: 0.05 }, room: ROOM_STADIUM, seed: 409, env: { a: 0.12, r: 0.4 } },
        { id: "clap-clap-hey", why: "MODEL, 1800 people: CLAP, CLAP, \"HEY!\", rest (112 BPM): everyone who claps (85%) claps on beats 1 and 2 only, the shout lands on 3; 90% together. Stadium room.",
          st: { cwSize: people(1800), cwMood: 0.85, cwSync: 0.9, cwTempo: 112, cwChant: 3, cwClap: 0.85, cwFemale: 0.35, cwDistance: 0.05 }, room: ROOM_STADIUM, seed: 419, env: { a: 0.12, r: 0.4 } },
      ] },
  ];

  // =================================================================================================================
  // ROUND 2 (soundtests/proto-crowd-2/): the talk and the reactions rebuilt; round 1's picks for chatter and the gasp
  // come back as the reference takes, the very files AJ heard
  // =================================================================================================================
  const R1 = join(ROOT, "soundtests", "proto-crowd");
  // a 16-bit stereo WAV in, and the same samples back out as fmt + data only (round 1's title chunk named its old slot)
  function readWav(path) {
    const b = readFileSync(path), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let off = 12, data = null, fmtC = null;
    while (off + 8 <= b.length) {
      const id = b.toString("ascii", off, off + 4), sz = dv.getUint32(off + 4, true);
      if (id === "fmt ") fmtC = b.subarray(off, off + 8 + sz);
      if (id === "data") data = b.subarray(off + 8, off + 8 + sz);
      off += 8 + sz + (sz & 1);
    }
    const n = data.length / 4, L = new Float32Array(n), R = new Float32Array(n), d2 = new DataView(data.buffer, data.byteOffset, data.length);
    for (let i = 0; i < n; i++) { const a = d2.getInt16(4 * i, true), c = d2.getInt16(4 * i + 2, true); L[i] = a < 0 ? a / 0x8000 : a / 0x7fff; R[i] = c < 0 ? c / 0x8000 : c / 0x7fff; }
    const out = Buffer.alloc(20 + fmtC.length + data.length);
    out.write("RIFF", 0, "ascii"); out.writeUInt32LE(out.length - 8, 4); out.write("WAVE", 8, "ascii");
    fmtC.copy(out, 12); out.write("data", 12 + fmtC.length, "ascii"); out.writeUInt32LE(data.length, 16 + fmtC.length); data.copy(out, 20 + fmtC.length);
    return { L, R, bytes: out };
  }
  // the controls for the new reactions: the best builds from TODAY's engines. The formant engine (wave 13) speaking only
  // vowels glides between them over the note ("ou" = oh -> oo, "ao" = ah -> aw); a falling sweep, a little vibrato;
  // five voices (two men, three women) entering over ~0.2 s, in the app's reverb
  const vowL = (o) => Object.assign({ wave: 13, freq: 230, speechText: "ou", formantSize: 1.12, formantQ: 0.35, formantBreath: 0.3, formantTilt: 0.3, sweep: -0.07, vibDepth: 0.025, vibRate: 5,
    attack: 0.15, hold: 0.2, decay: 0.6, sustain: 0.35, release: 0.35, cutoff: 8000, reso: 0.1, width: 0.7, gain: 0.7, duration: 1.4 }, o);
  const vowControl = (o) => Object.assign(vowL(Object.assign({ reverb: 0.35, reverbSize: 0.8 }, o)), { layers: JSON.stringify([
    { s: vowL(Object.assign({}, o, { formantSize: 1, duration: 1.5 })), d: 0.05, g: 0.85, p: -8 }, { s: vowL(Object.assign({}, o, { formantSize: 0.95, duration: 1.3 })), d: 0.12, g: 0.8, p: -11 },
    { s: vowL(Object.assign({}, o, { formantSize: 1.15, duration: 1.35 })), d: 0.09, g: 0.75, p: 3 }, { s: vowL(Object.assign({}, o, { formantSize: 1.2, duration: 1.2 })), d: 0.18, g: 0.6, p: 6 }]) });
  const OOH_CONTROL = vowControl({ speechText: "ou", sweep: -0.07 }), AWW_CONTROL = vowControl({ speechText: "ao", freq: 250, sweep: -0.11, formantBreath: 0.35 });
  const ROOM_THEATRE = { reverb: 0.33, reverbSize: 0.8, reverbTone: 0.45 };
  const TAVERN1 = ROUNDS[0].takes.find((t) => t.id === "busy-tavern");
  const ROUNDS2 = [
    { slug: "tavern-chatter-2", name: "Tavern Chatter 2", dur: 4.5, hint: "One of them is round 1's pick, exactly as you heard it.",
      listen: "People talking all around you (a tavern, a market, a dinner): a loop under a scene. Which one is PEOPLE TALKING? Listen for DIFFERENT voices saying DIFFERENT things (not one syllable said over and over), sentences that rise and fall, people taking turns and answering \"mm\" / \"yeah\", and NO real words you could make out. Then: does it sit still as a loop, or does something stick out? The takes are not the same room or the same crowd: judge each on whether it sounds like people talking.",
      takes: [
        { id: "round1-busy-tavern", ref: "tavern-chatter/take-C.wav", why: "ROUND 1's busy-tavern, the file you picked (\"the least odd\"), unchanged: 28 people each talking on their own, every syllable its own bump of level and its own rise-fall of pitch, everyone talking at once (measured: 19 of the 28 voices sounding at any moment, against 12 in round 2's busy tavern). The reference." },
        { id: "busy-tavern", why: "MODEL round 2, round 1's busy tavern re-planned (same people, room and seed): 28 people in CONVERSATIONS (group size 0.4: groups of 2-4, here " + "{convos}" + "), one talking while the others listen, answer \"mm\" / \"yeah\" / \"uh-huh\", interrupt; phrases of connected syllables (onsets, clusters, codas; stressed syllables long and full-voweled, unstressed short and reduced), each phrase's pitch falling across it with stress accents and a fall, a rise or a question at the end. 10% still laughing. Small warm room (reverb 0.22, size 0.5).",
          st: Object.assign({}, TAVERN1.st, { cwGroup: 0.4 }), room: TAVERN1.room, seed: 11, env: { a: 0.35, r: 0.4 } },
        { id: "market", why: "MODEL round 2, 200 people at a market (distance 0.1): the nearest 28 voices in PAIRS and threes (group size 0.2, mostly pairs: haggling, quick turns, more interruptions at excitement 0.6), the rest the statistical bed; 10% children, a few laughs (4%). Open air between buildings (reverb 0.15, size 0.9).",
          st: { cwSize: people(200), cwMood: 0.6, cwCalls: 0.04, cwCall: 6, cwFemale: 0.5, cwChildren: 0.1, cwGroup: 0.2, cwDistance: 0.1 }, room: { reverb: 0.15, reverbSize: 0.9, reverbTone: 0.5 }, seed: 37, env: { a: 0.35, r: 0.4 } },
        { id: "quiet-dinner", why: "MODEL round 2, 9 people at a quiet dinner: two tables (group size 0.75: here {convos}), so one or two voices at a time, soft (excitement 0.15: slower, darker, breathier), long listening, back-channels; no laughing. A dining room (reverb 0.2, size 0.45).",
          st: { cwSize: people(9), cwMood: 0.15, cwFemale: 0.5, cwGroup: 0.75 }, room: { reverb: 0.2, reverbSize: 0.45, reverbTone: 0.5 }, seed: 23, env: { a: 0.35, r: 0.4 } },
      ] },
    { slug: "audience-gasp-2", name: "Audience Gasp 2", dur: 3.0, hint: "One of them is round 1's pick, exactly as you heard it.",
      listen: "An audience REACTING to something shocking or amazing (a near miss, a magic trick, a twist): a collective gasp. Which one is a ROOM OF PEOPLE gasping? Listen for MANY separate people catching their breath at once (a short, sharp \"huh!\", not a long hiss), and what happens right after. The takes are NOT the same length.",
      takes: [
        { id: "round1-gasp-into-ooh", ref: "audience-gasp/take-C.wav", why: "ROUND 1's gasp-into-ooh, the file you picked if forced, unchanged: 250 SILENT aspirated inhales (no voice), then 0.22 s later round 1's \"ooh\". The reference." },
        { id: "voiced-gasp", why: "MODEL round 2, 250 people, the VOICED gasp alone: everyone reacts once within ~0.2 s; ~58% a breathy \"HUH!\" (a creaky glottal onset, high, falling, cut off by a catch), ~25% a short \"OH!\", ~17% a voiced inhale with a squeak; 40% of the huhs let the breath back out (\"hhh\") a moment later. The far ~220 are the bed, voiced too. Theatre room (reverb 0.35, size 0.8).",
          st: { cwSize: people(250), cwMood: 0.4, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.06, cwEnd: 0 }, room: { reverb: 0.35, reverbSize: 0.8, reverbTone: 0.45 }, seed: 307 },
        { id: "gasp-into-ooh-2", why: "MODEL round 2, two layers: the voiced gasp (as the voiced-gasp take), then 0.3 s later the NEW \"ooh\" (each person once: \"oh-ooh\" climbing 3-5 semitones and sliding 7-10 down, held out loud with a waver). Theatre room.",
          layers: [{ st: { cwSize: people(250), cwMood: 0.4, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.06, cwEnd: 0 }, delay: 0, gain: 1 },
            { st: { cwSize: people(250), cwMood: 0.4, cwCalls: 1, cwCall: 2, cwStart: 0, cwPeakAt: 0.09, cwEnd: 0, cwSeed: 1 }, delay: 0.3, gain: 0.85, env: { a: 0.02, r: 0.5 } }],
          room: { reverb: 0.35, reverbSize: 0.8, reverbTone: 0.45 }, seed: 311 },
        { id: "big-audience-gasp", why: "MODEL round 2, the voiced gasp from 2000 people (an arena; distance 0.05), a touch more startled (excitement 0.5), everyone within ~0.15 s: the nearest 28 distinct, the rest the bed. Big room (reverb 0.4, size 0.9).",
          st: { cwSize: people(2000), cwMood: 0.5, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.05, cwEnd: 0, cwDistance: 0.05 }, room: { reverb: 0.4, reverbSize: 0.9, reverbTone: 0.4 }, seed: 331 },
      ] },
    { slug: "audience-ooh", name: "Audience Ooh", dur: 3.0, controlName: "a layered build (no preset exists)", control: OOH_CONTROL,
      controlWhy: "NO PRESET does this. The control is the best build from today's engines: FIVE formant-engine (wave 13) voices speaking only the vowels \"ou\" (so each glides oh -> oo over its note), two men and three women (230 Hz -11, -8, 0, +3, +6 semitones; tract sizes 0.95-1.2), a falling sweep (-0.07: about 3 semitones), a little vibrato, breathy (0.3), entering over 0.18 s, in the app's reverb (0.35, size 0.8). About 1.6 s.",
      hint: "One of them is the best build from today's engines (no preset exists).",
      listen: "An audience going \"OOOH\": impressed (a great trick, a big hit, a rare find), ON ITS OWN with nothing before it. Which one is a CROWD saying \"ooh\"? Listen for many separate voices at many pitches, the climb and the slide down, and whether it reads as \"ooh\" without a picture. The takes are NOT the same length.",
      takes: [
        { id: "theatre-ooh", why: "MODEL round 2, 300 people (a theatre): each once, within ~0.25 s, the NEW \"ooh\": \"oh -> ooh\" (half start on the \"oo\" of \"book\"), climbing 3-5 semitones by a quarter to two fifths of the way and sliding 7-10 down, 0.85-1.6 s, held out loud (effort +0.3) with a waver, a fifth with an \"h\" in front. Theatre room (reverb 0.33, size 0.8).",
          st: { cwSize: people(300), cwMood: 0.45, cwCalls: 1, cwCall: 2, cwStart: 0, cwPeakAt: 0.08, cwEnd: 0 }, room: ROOM_THEATRE, seed: 501 },
        { id: "small-room-ooh", why: "MODEL round 2, 30 people in a room (every voice individual; 15% children, half women): the same \"ooh\", a little quieter (excitement 0.4). Small room (reverb 0.2, size 0.5).",
          st: { cwSize: people(30), cwMood: 0.4, cwCalls: 1, cwCall: 2, cwFemale: 0.5, cwChildren: 0.15, cwStart: 0, cwPeakAt: 0.1, cwEnd: 0 }, room: { reverb: 0.2, reverbSize: 0.5, reverbTone: 0.5 }, seed: 503 },
        { id: "stadium-ooh", why: "MODEL round 2, 2500 people in a stadium (the shot that hits the post): the same \"ooh\" shouted (excitement 0.7), two thirds men, the far ones the bed. Stadium room (reverb 0.35, size 0.92).",
          st: { cwSize: people(2500), cwMood: 0.7, cwCalls: 1, cwCall: 2, cwFemale: 0.35, cwStart: 0, cwPeakAt: 0.1, cwEnd: 0, cwDistance: 0.05 }, room: ROOM_STADIUM, seed: 509 },
      ] },
    { slug: "audience-aww", name: "Audience Aww", dur: 3.0, controlName: "a layered build (no preset exists)", control: AWW_CONTROL,
      controlWhy: "NO PRESET does this. The control is the best build from today's engines: the same five formant-engine voices as the ooh control, speaking \"ao\" (ah -> aw), from 250 Hz, a longer falling sweep (-0.11: about 5 semitones), breathier (0.35), in the app's reverb (0.35, size 0.8). About 1.6 s.",
      hint: "One of them is the best build from today's engines (no preset exists).",
      listen: "An audience going \"AWWW\": let down (a near miss, a loss) or touched (something sweet), ON ITS OWN. Which one is a CROWD saying \"aww\"? Listen for many separate voices, the fall of a let-down \"awww\" or the rise and fall of a sweet one, and whether it reads as \"aww\" without a picture. Say which KIND of aww each one is to you. The takes are NOT the same length.",
      takes: [
        { id: "stadium-aww", why: "MODEL round 2, 2500 people let down (the near miss): each once, \"ae -> aw\" starting at its top and FALLING 7-9 semitones over 0.8-1.4 s, half ending in a sigh of breath; shouted (excitement 0.7), two thirds men. Stadium room (reverb 0.35, size 0.92).",
          st: { cwSize: people(2500), cwMood: 0.7, cwCalls: 1, cwCall: 3, cwFemale: 0.35, cwStart: 0, cwPeakAt: 0.08, cwEnd: 0, cwDistance: 0.05 }, room: ROOM_STADIUM, seed: 601 },
        { id: "theatre-aww", why: "MODEL round 2, 300 people let down (a theatre audience at a sad turn): the same falling \"aww\" with its sigh, at excitement 0.45. Theatre room (reverb 0.33, size 0.8).",
          st: { cwSize: people(300), cwMood: 0.45, cwCalls: 1, cwCall: 3, cwStart: 0, cwPeakAt: 0.08, cwEnd: 0 }, room: ROOM_THEATRE, seed: 603 },
        { id: "sweet-aww", why: "MODEL round 2, 120 people TOUCHED (something sweet on stage): the new \"aww (sweet)\" call: a soft, breathy \"ae -> aw\" that RISES 4-6 semitones and comes back down, 0.7-1.2 s; 60% women, 10% children, quiet (excitement 0.3). Room (reverb 0.28, size 0.7).",
          st: { cwSize: people(120), cwMood: 0.3, cwCalls: 1, cwCall: 7, cwFemale: 0.6, cwChildren: 0.1, cwStart: 0, cwPeakAt: 0.1, cwEnd: 0 }, room: { reverb: 0.28, reverbSize: 0.7, reverbTone: 0.5 }, seed: 607 },
      ] },
  ];

  // ---- one blind set: shuffled (the avalanched name hash, then the HIGH bits of the LCG, as flow.mjs / make-ab.mjs)
  function renderSet(rounds, OUT, only) {
    mkdirSync(OUT, { recursive: true });
    const readme = [];
    for (const S of rounds) {
      const takes = (S.control || S.controlName ? [{ id: "current", control: true, why: S.controlWhy, patch: S.control || preset(S.controlName) }] : []).concat(S.takes);
      if (!only || only === S.slug) {
        let seed = 0x5f3759df;
        for (const ch of S.name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
        seed ^= seed >>> 16; seed = Math.imul(seed, 0x85ebca6b) >>> 0; seed ^= seed >>> 13; seed = Math.imul(seed, 0xc2b2ae35) >>> 0; seed = (seed ^ (seed >>> 16)) >>> 0;
        const order = takes.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
        const dir = join(OUT, S.slug), key = [];
        mkdirSync(dir, { recursive: true });
        console.log(S.name + (S.controlName ? "  (control: " + S.controlName + ")" : ""));
        order.forEach((ti, slot) => {
          const t = takes[ti], file = "take-" + "ABCD"[slot] + ".wav";
          let r, lim = 0;
          if (t.ref) { const w = readWav(join(R1, t.ref)); r = { L: w.L, R: w.R, infos: null }; writeFileSync(join(dir, file), w.bytes); }
          else {
            r = t.control ? renderControl(t.patch) : renderModel(t, S.dur);
            lim = matchWithLimiter(r.L, r.R);
            writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: S.name + " " + file })));
          }
          const m = measure(r.L, r.R, S, t); m.limiter = lim;
          key.push({ file, t, m, r });
          console.log("  " + file + "  " + t.id.padEnd(22) + " " + (VERBOSE ? fmt(m, r) : m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + (r.ms != null ? ", " + r.ms + " ms" : "") + (lim ? ", LIMITER " + lim : "") + (r.infos && r.infos[0].talking ? ", talking at once " + r.infos[0].talking.turns.mean + " (+" + r.infos[0].talking.backch.mean + " back-ch.), groups " + (r.infos[0].convos || []).join(",") : "")));
          const bad = [];
          if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < -40) bad.push("silent");
          if (!t.control && !t.ref && (m.edgeStart > 0.05 || m.edgeEnd > 0.05)) bad.push("edge click?");
          if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target");
          if (bad.length) console.log("    !! " + bad.join(", "));
        });
        writeFileSync(join(dir, "LISTEN.md"), "# " + S.name + " (crowd engine prototype)\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
          ".wav`, each matched to " + TARGET_LUFS + " LUFS (or capped below full scale), in a shuffled order. " + (S.hint || ("One of them is " + (S.control ? "the best build from today's engines (no preset exists)" : "today's preset") + ".")) + "\n\n" + S.listen +
          "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. Say too if any take has WORDS in it you could make out (none should). `KEY.md` says what each one is: **read it after listening.**\n");
        writeFileSync(join(dir, "KEY.md"), "# " + S.name + ": the key\n\n" + key.map((k) => {
          const conv = k.r.infos && k.r.infos[0].convos ? k.r.infos[0].convos.join(", ") : "";
          return "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why.replace("{convos}", conv) + "\n\n" +
          "Measured: " + fmt(k.m, k.r) + "\n\n" +
          (k.t.control && (k.m.edgeStart > 0.05 || k.m.edgeEnd > 0.05) ? "Note: the control itself starts or ends abruptly (edge " + k.m.edgeStart.toFixed(3) + " / " + k.m.edgeEnd.toFixed(3) + " of its peak in the first / last 2 ms): a click that is in today's sound, not added here.\n\n" : "") +
          (k.m.limiter ? "Note: this take's peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.m.limiter + " before matching (see README).\n\n" : "") +
          (k.t.ref ? "Source: `soundtests/proto-crowd/" + k.t.ref + "` (samples identical; only round 1's title chunk dropped).\n" :
          "```json\n" + JSON.stringify(k.t.control ? k.t.patch : (k.t.layers ? { layers: k.t.layers, room: k.t.room, seed: k.t.seed } : { st: k.t.st, room: k.t.room, seed: k.t.seed })) + "\n```\n"); }).join("\n"));
      }
      readme.push("- `" + S.slug + "/`: **" + S.name + "** (" + takes.length + " takes" + (S.controlName ? "; control: " + S.controlName : "") + "; model takes " + S.dur + " s)");
    }
    return readme;
  }

  // ---- THE GUARD: round 1's winners re-rendered with this engine, against the files AJ heard
  const WINNERS = [["crowd-cheer", "stadium-in-the-stands", "A"], ["crowd-cheer", "distant-stadium", "B"], ["crowd-cheer", "party-cheer", "D"],
    ["crowd-applause", "theatre-applause", "A"], ["stadium-chant", "de-FENSE", "C"], ["stadium-chant", "hey-hey-hey", "D"]];
  function bandsDb(L, R) {   // 1/3-octave levels (100 Hz - 12.5 kHz) per 2048-frame, frames within 30 dB of the loudest
    const F = frames(L, R, 1024), top = Math.max(...F.map((f) => f.db));
    return F.map((f) => f.db > top - 30 ? Array.from({ length: 22 }, (_, b) => { const lo = 100 * Math.pow(2, b / 3), hi = lo * Math.pow(2, 1 / 3); let e = 0; for (let k = Math.max(1, Math.floor(lo / binHz)); k < Math.min(N_FFT / 2, Math.ceil(hi / binHz)); k++) e += f.mag[k] * f.mag[k]; return 10 * Math.log10(e + 1e-12); }) : null);
  }
  function guard() {
    const OUTG = join(ROOT, "soundtests", "proto-crowd-2", "winners-check");
    const rows = [];
    for (const [slug, id, letter] of WINNERS) {
      const S = ROUNDS.find((r) => r.slug === slug), t = S.takes.find((x) => x.id === id);
      // CROWD_GUARD_GROUP=<g> re-renders them with that cwGroup (0 = every talker on their own, round 1's talk density)
      const tg = process.env.CROWD_GUARD_GROUP != null ? Object.assign({}, t, { st: Object.assign({}, t.st, { cwGroup: +process.env.CROWD_GUARD_GROUP }) }) : t;
      const r = renderModel(tg, S.dur); matchWithLimiter(r.L, r.R);
      const o = readWav(join(R1, slug, "take-" + letter + ".wav"));
      const n = Math.min(o.L.length, r.L.length);
      let ee = 0, eo = 0, en = 0, x = 0;
      for (let i = 0; i < n; i++) { const a = o.L[i], b = r.L[i], c = o.R[i], d = r.R[i]; ee += (a - b) ** 2 + (c - d) ** 2; eo += a * a + c * c; en += b * b + d * d; x += a * b + c * d; }
      const mo = measure(o.L, o.R, S, t), mn = measure(r.L, r.R, S, t);
      const bo = bandsDb(o.L, o.R), bn = bandsDb(r.L, r.R); let lsd = 0, cnt = 0, lt = new Float64Array(22), ct = 0;
      const eo2 = new Float64Array(22), en2 = new Float64Array(22);
      for (let f = 0; f < Math.min(bo.length, bn.length); f++) if (bo[f] && bn[f]) { let s2 = 0, nb = 0; const tf = Math.max(...bo[f]); for (let b = 0; b < 22; b++) { if (bo[f][b] > tf - 30) { s2 += (bo[f][b] - bn[f][b]) ** 2; nb++; } eo2[b] += Math.pow(10, bo[f][b] / 10); en2[b] += Math.pow(10, bn[f][b] / 10); } lsd += Math.sqrt(s2 / Math.max(1, nb)); cnt++; }
      // the long-term spectrum, third-octave by third-octave, over the bands within 30 dB of the loudest
      const lo2 = Array.from(eo2, (v) => 10 * Math.log10(v + 1e-20)), topB = Math.max(...lo2);
      let longMax = 0; for (let b = 0; b < 22; b++) if (lo2[b] > topB - 30) longMax = Math.max(longMax, Math.abs(10 * Math.log10((en2[b] + 1e-20) / (eo2[b] + 1e-20))));
      const row = { slug, id, letter, same: ee === 0 || 10 * Math.log10(ee / eo) < -60,   // under -60 dB: the 16-bit rounding of the file, nothing else
 diffDb: ee ? 10 * Math.log10(ee / eo) : -Infinity, corr: x / Math.sqrt(eo * en), lufs: [mo.lufs, mn.lufs], cent: [mo.centroid, mn.centroid], lsd: lsd / Math.max(1, cnt), longMax, info: r.infos[0] };
      rows.push(row);
      const tk = row.info.talking;
      console.log("  " + (slug + "/" + id).padEnd(36) + (row.same ? " IDENTICAL" : " difference " + row.diffDb.toFixed(1) + " dB re the signal, correlation " + row.corr.toFixed(4) + ", LUFS " + row.lufs.map((v) => v.toFixed(2)).join(" -> ") + ", centroid " + row.cent.map((v) => Math.round(v)).join(" -> ") + " Hz, frame spectral distance " + row.lsd.toFixed(2) + " dB, long-term 1/3-oct max " + row.longMax.toFixed(2) + " dB") + (tk ? ", near talkers talking at once " + tk.turns.mean + " (+" + tk.backch.mean + ")" : ""));
      if (!row.same && process.env.CROWD_GUARD_GROUP == null) {
        mkdirSync(OUTG, { recursive: true });
        writeFileSync(join(OUTG, slug + "--" + id + "--round1.wav"), o.bytes);
        writeFileSync(join(OUTG, slug + "--" + id + "--round2.wav"), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2 })));
      }
    }
    return rows;
  }

  const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (process.argv.includes("--cpu")) { cpuProbe(); return; }
  if (process.argv.includes("--round1")) {   // round 1 again, to a folder of your choosing (never over the files AJ heard)
    const o = process.argv.find((a) => a.startsWith("--out="));
    if (!o) { console.log("--round1 needs --out=<dir> (soundtests/proto-crowd holds the files AJ heard)"); return; }
    renderSet(ROUNDS, o.slice(6), only); console.log("-> " + o.slice(6)); return;
  }
  const OUT = join(ROOT, "soundtests", "proto-crowd-2");
  console.log("THE WINNERS (round 1), re-rendered with this engine:");
  const g = guard();
  if (process.argv.includes("--guard")) return;
  const readme = renderSet(ROUNDS2, OUT, only);
  const changed = g.filter((r) => !r.same);
  writeFileSync(join(OUT, "README.md"), "# Crowd engine prototype, round 2: listening rounds\n\n" +
    "Round 2 of the crowd engine (`tools/proto/crowd.mjs`, regenerate with `node tools/proto/crowd.mjs`). Round 1 settled cheers, applause and chants; what it did NOT " +
    "settle was TALK (\"everyone is making the same syllable noise\") and the GASP (\"odd in general\"; the silent inhale the weak part). Round 2 rebuilds both and adds " +
    "a standalone OOH and AWW.\n\n" +
    "**Listening order:**\n\n" + readme.join("\n") + "\n\n" +
    "Same format as round 1: in each folder `take-A.wav` ... `take-D.wav`, loudness-matched to " + TARGET_LUFS + " LUFS (peaks capped at 0.95), shuffled with a fixed seed " +
    "(the high bits of the LCG). Read `LISTEN.md`, listen, then read `KEY.md`. In the two rounds that continue round 1 (chatter, gasp) one take is **round 1's own file**, " +
    "the one you picked there, so you can hear whether round 2 moved past it; in the two new ones (ooh, aww) one take is the best build from today's engines. Every model " +
    "take carries its room (the app's own Freeverb); the limiter rule is round 1's.\n\n" +
    "**Round 1's winners:** the talk and gasp work touches the engine those six takes come from, so they were re-rendered with the same settings and seeds and measured " +
    "against the files you heard. " + (changed.length ? changed.length + " of 6 moved (the cheers and chants have a few near people TALKING among the callers and chanters, and the talk is new). " +
    "In round 1 those talkers (10-15% of the near voices in the chants) shouted without stopping and made 19-29% of the near voices' energy; in conversations " +
    "they take turns and make 6-14%, so the chants carry less talk between the beats and read a little brighter. Setting `cwGroup: 0` (everyone talking on their " +
    "own, round 1's density) brings the long-term spectrum back (de-FENSE centroid 1113 Hz against round 1's 1076, hey-hey-hey 899 against 901), so a preset " +
    "can keep the old texture if you prefer it. " +
    "`winners-check/` has each as `--round1.wav` (what you heard) and `--round2.wav` (this engine). Not a blind round: listen only if you want to check that nothing you liked went away." :
    "all 6 are sample-identical to what you heard.") + "\n\n" +
    g.map((r) => "- " + r.slug + " `" + r.id + "` (round 1 take " + r.letter + "): " + (r.same ? "identical" : "difference " + r.diffDb.toFixed(1) + " dB under the signal, correlation " + r.corr.toFixed(3) + ", loudness " + r.lufs.map((v) => v.toFixed(1)).join(" -> ") + " LUFS, centroid " + r.cent.map((v) => Math.round(v)).join(" -> ") + " Hz, spectral distance " + r.lsd.toFixed(2) + " dB per frame (" + r.longMax.toFixed(2) + " dB at most in any long-term third-octave)")).join("\n") + "\n");
  console.log("-> " + OUT);

  // ---- the cost: render time per second of crowd, from a handful of talkers to the largest crowd with everything on
  function cpuProbe() {
    const cases = [
      ["talk, 28 people", { cwSize: people(28), cwMood: 0.5 }],
      ["talk, 220 people", { cwSize: people(220), cwMood: 0.45 }],
      ["talk, 28 people, each on their own (group 0: round 1's density)", { cwSize: people(28), cwMood: 0.5, cwGroup: 0 }],
      ["voiced gasp, 2000 people", { cwSize: people(2000), cwMood: 0.5, cwCalls: 1, cwCall: 5, cwStart: 0, cwPeakAt: 0.05, cwEnd: 0 }],
      ["ooh, 2500 people", { cwSize: people(2500), cwMood: 0.7, cwCalls: 1, cwCall: 2, cwStart: 0, cwPeakAt: 0.1, cwEnd: 0 }],
      ["cheer, 3000 people + claps + whistles", { cwSize: 1, cwMood: 0.9, cwCalls: 0.9, cwClap: 0.3, cwWhistle: 0.3 }],
      ["applause, 3000 people, all clapping", { cwSize: 1, cwVoices: 0.05, cwCalls: 1, cwClap: 1 }],
      ["chant, 3000 people, together + claps", { cwSize: 1, cwMood: 0.9, cwSync: 0.9, cwClap: 0.6, cwChant: 1, cwTempo: 100 }],
      ["EVERYTHING, 3000 people (talk + calls + chant + every clap + whistles)", { cwSize: 1, cwMood: 0.8, cwCalls: 0.5, cwSync: 0.4, cwClap: 1, cwWhistle: 1 }],
    ];
    makeCrowd(SR, crowdCfg({ duration: 0.2 }), 1);   // warm the JIT and the calibration
    for (const [name, st] of cases) {
      const d = 5, runs = [];
      for (let k = 0; k < 3; k++) { const t0 = process.hrtime.bigint(); makeCrowd(SR, crowdCfg(Object.assign({ duration: d }, st)), 99 + k); runs.push(Number(process.hrtime.bigint() - t0) / 1e6); }
      runs.sort((a, b) => a - b);
      console.log(name.padEnd(72) + " " + (runs[1] / d).toFixed(0).padStart(4) + " ms per second of audio (median of 3, 5 s renders)");
    }
  }
}
