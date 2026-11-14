/* glass.mjs — PROTOTYPE of a "glass" synthesis engine for CrunchySFX (glass and ceramics: breakables, clinks, taps),
 * and the CLI that renders its blind listening round.
 *
 *   node tools/proto/glass.mjs                render every round into soundtests/proto-glass/<sound>/
 *   node tools/proto/glass.mjs glass-clink    one round
 *   node tools/proto/glass.mjs --cost         only the CPU cost: each take's model rendered 5x, ms per second of audio
 *
 * WHY. Glass Shatter is a triangle at 2.4 kHz buried in crushed noise with an echo; Glass Clink and Glass Ping are the
 * modal bank (one resonator set, one strike). In the care pass (SOUND-REVIEW.md, round "glass-shatter") the current
 * preset BEAT three layered builds of the modal / impact / particle engines blind: a modal bank rang like a bell and a
 * repeated modal ping like a machine, while the crushed noise at least read as a CRASH. Nothing in the app models what a
 * breaking object DOES: many pieces, each ringing at its own pitch, landing and bouncing at physical times. This does.
 *
 * THE PHYSICS, in the order it happens (one event = one strike):
 *   STRIKE     something hits the object: a contact force pulse whose length is the striker's hardness (a fingertip or
 *              a fist ~1.5 ms, a spoon or a stone ~40 us). The pulse's spectrum decides which modes it reaches:
 *              W(f) = 1 / sqrt(1 + (1.6 f tau)^4), so a hard strike is bright and a soft one is a dull knock.
 *   THE BODY   the intact object rings at its own modes, `freq` its lowest. Three shapes:
 *                vessel  a glass, a bottle, a vase: shell (n = 2..7) modes at ~1 : 2.6 : 4.8 : 7.4 : 10.6 : 14.4. Each is a
 *                        DEGENERATE PAIR split by the vessel's asymmetry (`glBeat`, 0.3-6 Hz), so a wine glass warbles.
 *                pane    a window, a plate: a plate's modes, f_mn ~ m^2 + a n^2, dense, the lowest a low "whump".
 *                solid   an ice cube, a chunk: sparse, nearly inharmonic (1 : 1.52 : 2.07 : 2.61 ...).
 *              Loss is the MATERIAL's (loss factor eta rising with frequency): T60 = 2.2 / (eta(f) f), times `glRing`.
 *              A second vessel (`glPair`, tuned `glPairTune` semitones away) is the other glass in a toast.
 *   FRACTURE   if it breaks (`glBreak`), the crack runs a few ms after the strike: a train of SNAPS (sharp broadband
 *              clicks, the crack branching; a pane's over ~25 ms), a FIZZ of micro-cracks (thousands of tiny 4.5-15 kHz
 *              rings a second, decaying over 20-60 ms: the "tssh"), and for clay and porcelain a low GRIT. The body's
 *              ring is CHOKED at the break: the object stops existing as one resonator.
 *   PIECES     N fragments (`glPieces`), sizes log-normal around `glShard`. Each is a tiny stiff plate ringing at its own
 *              inharmonic modes, f1 ~ thickness / size^2 (smaller = higher; thicker = higher; the material's wave speed
 *              scales it), and SHORT (high f: eta f is large). Each is BORN ringing (the strain energy the fracture
 *              releases, a very fast excitation), then FLIES: launched up at a random speed (`glThrow`) from a height
 *              (`glHeight`; a pane's pieces from anywhere up its height, dropping out of the frame over ~0.12 s), it
 *              lands at its flight time and BOUNCES as a ball does: v' = e v, the next gap 2 v' / g, so the gaps shrink
 *              (`glBounce` sets e; the material scales it; each bounce jitters e and re-rolls which modes it hits: a
 *              shard tumbles). A landing hits the floor with the FLOOR's contact time (`glFloor`: wood/carpet ~1.2 ms,
 *              tile/stone ~60 us) and knocks the floor itself (250 Hz-1.75 kHz). A big piece landing hard may break
 *              AGAIN into 2-3 smaller ones (the cascade: density highest right after the break). The last landing rings
 *              damped by the contact.
 *   SETTLE     big pieces ROCK to rest (an accelerating run of tiny ticks, as a coin settles) and slide (a short
 *              scrape), `glSettle`.
 *   Every component is set to a target ENERGY (relative to the strike's first 30 ms, as blast.mjs levels its debris),
 *   so `glPieces` changes the DENSITY of the debris and not its loudness, and each level knob is a ratio.
 *
 * PORTABLE SHAPE. `makeGlass(sr, cfg, seed)` is a pure factory like dsp.js makeBlast / makeFlow: no DOM, no Math.random
 * (own seeded LCGs, one per component, so a level knob never reshuffles the pieces), SR in. It renders BUFFERED (an event
 * list of decaying sinusoids added into a stereo buffer, each living to -60 dB, never more than 4 s) and returns
 * { L, R, info, n, tick(drive, out) }: tick writes one stereo sample, drive = the amp envelope (a plain gain: it is one
 * event), exactly blast's shape. In synth.js it would be a wave branch that builds the buffer up front. `glassCfg(st)`
 * maps the proposed rows (GLASS_PARAMS) to physics; `glassLevel(L, R)` levels a buffer (RMS 0.12 over its loudest
 * 300 ms, peak capped 0.9) like frictionLevel / motorLevel, so a preset does not lean on Normalize. Anti-aliasing:
 * every mode at or past 0.45 SR is dropped (a piece whose FIRST mode is past it is heard only as its fizz); every click
 * is a box-integrated pulse at least 1.5 samples long. Cost: CPU per second of audio is measured by `--cost`.
 *
 * THE ROUND. Each sound gets the CURRENT preset (Glass Shatter, Glass Clink) or, for a gap, the best build of today's
 * engines I could make (layered, rendered by the exported engine), as the control, plus three model takes that differ in
 * INTERPRETATION (what broke, how, onto what). Model takes are STEREO (the pieces are scattered across the field, which
 * `wave: 9` sample playback would collapse), so like weather.mjs and flow.mjs they get the control's OWN reverb (dsp.js
 * `reverbProcess`, same size / tone / wet) instead of the whole chain. Loudness matched to -18 LUFS (peak capped at
 * 0.95; a take kept > 0.5 dB short by its peaks gets the app's own Limiter at the smallest 0.1 step that reaches it),
 * shuffled with a fixed seed from the LCG's HIGH bits. Writes take-*.wav, LISTEN.md, KEY.md, README.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Only wave "glass" reads
// the group, so no existing preset moves; the defaults are a plain drinking glass knocked off a table.
export const GLASS_MATERIALS = ["glass", "crystal", "porcelain", "clay", "ice"];   // append-only (stored as an index)
export const GLASS_SHAPES = ["vessel", "pane", "solid"];                           // append-only
export const GLASS_PARAMS = [
  ["glBreak",    "Break",          0,  1,   0.01, 1,    "",   "Glass"],   // 0 rings intact (a tap / clink) .. a crack and chips .. 1 smashed
  ["glMaterial", "Material",       0,  4,   1,    0,    "",   "Glass", "enum", GLASS_MATERIALS],
  ["glShape",    "Shape",          0,  2,   1,    0,    "",   "Glass", "enum", GLASS_SHAPES],
  ["glThick",    "Thickness",      0,  1,   0.01, 0.3,  "",   "Glass"],   // wine glass .. bottle / plate: piece pitch ~ thickness
  ["glStriker",  "Striker",        0,  1,   0.01, 0.6,  "",   "Glass"],   // soft (finger, fist: 1.5 ms) .. hard (spoon, stone: 40 us)
  ["glThump",    "Blow",           0,  1,   0.01, 0.2,  "",   "Glass"],   // the low thud of what hit it (a stone, the floor)
  ["glCrack",    "Crack",          0,  1,   0.01, 0.5,  "",   "Glass"],   // the fracture's snaps and micro-crack fizz
  ["glPieces",   "Pieces",         0,  1,   0.01, 0.5,  "",   "Glass"],   // 3 .. 400 fragments (density, not loudness)
  ["glShard",    "Piece size",     0,  1,   0.01, 0.4,  "",   "Glass"],   // tiny (median piece 12 kHz) .. chunks (1.5 kHz), before thickness
  ["glHeight",   "Fall height",    0,  1,   0.01, 0,    "",   "Glass"],   // pieces fall 0 .. 3 m (a window's: from up its height)
  ["glThrow",    "Throw",          0,  1,   0.01, 0.35, "",   "Glass"],   // pieces thrown up 0 .. 2.5 m/s (flight times)
  ["glBounce",   "Bounce",         0,  1,   0.01, 0.5,  "",   "Glass"],   // restitution: pieces bounce once .. many times
  ["glFloor",    "Floor",          0,  1,   0.01, 0.7,  "",   "Glass"],   // soft (wood, carpet: 1.2 ms, dull) .. hard (tile, stone: 25 us, bright)
  ["glSettle",   "Settle",         0,  1,   0.01, 0.3,  "",   "Glass"],   // big pieces rocking and sliding to rest
  ["glRing",     "Ring",           0,  1,   0.01, 0.5,  "",   "Glass"],   // damped (held, full of drink) .. ringing free
  ["glBeat",     "Warble",         0,  1,   0.01, 0.3,  "",   "Glass"],   // a vessel's mode pairs split: 0.3 .. 6 Hz beating
  ["glPair",     "Second glass",   0,  1,   0.01, 0,    "",   "Glass"],   // the other glass in a toast (level)
  ["glPairTune", "Second tuning",  -4, 4,   0.01, 0,    "st", "Glass"],
  ["glSeed",     "Variation",      0,  999, 1,    0,    "",   "Glass"],
];
export const GLASS_DEFAULTS = Object.fromEntries(GLASS_PARAMS.map((p) => [p[0], p[5]]));

// The materials (index = glMaterial). speed: wave speed relative to soda glass (piece pitch); eta: loss factor at 1 kHz;
// tilt: eta ~ (f/1k)^tilt; fizz: micro-crack density; grit: low crunch in the crack; rest: restitution; slide: how far
// pieces slide; brittle: chance a landing breaks a piece again. Glass from soda-lime (eta ~1e-3, c_L 5.6 km/s); crystal
// rings ~3x longer; porcelain is stiff but lossier (it still rings: porcelain bells exist; at 0.004 with tilt 0.45 a 6 kHz
// shard rang 35 ms and the debris was a train of clicks 25 dB over its loudness); clay slow, lossy and gritty; ice slow,
// lossy, crackly.
export const GLASS_MATS = [
  { "speed": 1,    "eta": 0.0012, "tilt": 0.3,  "fizz": 1,   "grit": 0.15, "rest": 1,    "slide": 1,   "brittle": 0.5 },
  { "speed": 0.9,  "eta": 0.0004, "tilt": 0.2,  "fizz": 0.8, "grit": 0.1,  "rest": 1.05, "slide": 1,   "brittle": 0.6 },
  { "speed": 1.05, "eta": 0.002,  "tilt": 0.3,  "fizz": 0.5, "grit": 0.55, "rest": 0.85, "slide": 0.8, "brittle": 0.35 },
  { "speed": 0.6,  "eta": 0.008,  "tilt": 0.4,  "fizz": 0.3, "grit": 1,    "rest": 0.6,  "slide": 0.6, "brittle": 0.25 },
  { "speed": 0.62, "eta": 0.004,  "tilt": 0.35, "fizz": 1.4, "grit": 0.4,  "rest": 0.7,  "slide": 1.6, "brittle": 0.5 },
];
const GLASS_GRAV = 9.81;
const GLASS_STRIKE_AT = 0.005;     // s of silence before the strike (the onset is never the buffer's first sample)
const GLASS_MAX_T60 = 4;           // s, the longest any ring is rendered
const GLASS_FIZZ_LO = 4500;        // Hz, micro-crack band
const GLASS_FIZZ_HI = 15000;
const GLASS_FRAC_TAU = 0.000025;   // s, the fracture's own excitation (the born ring of each piece)

const glClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function glRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const glGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
const glPanGains = (p) => { const a = (glClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
// the contact pulse's spectrum (a half-sine force of length tau), smoothed
const glW = (f, tau) => 1 / Math.sqrt(1 + Math.pow(1.6 * f * tau, 4));
const glT60 = (m, f, ringMul) => Math.min(GLASS_MAX_T60, 2.2 / (m["eta"] * Math.pow(f / 1000, m["tilt"]) * f) * ringMul);

// knobs -> physics
export function glassCfg(st) {
  const g = (k) => (st[k] == null ? GLASS_DEFAULTS[k] : st[k]);
  return {
    "dur": st.duration || 1, "freq": st.freq || 1000, "width": st.width == null ? 0.6 : st.width,
    "brk": glClamp(g("glBreak"), 0, 1), "mat": glClamp(Math.round(g("glMaterial")), 0, GLASS_MATS.length - 1),
    "shape": glClamp(Math.round(g("glShape")), 0, GLASS_SHAPES.length - 1),
    "hFac": 0.45 + 1.8 * g("glThick"),                                  // thickness relative to a 0.3 glass
    "tauStrike": 0.0015 * Math.pow(0.04 / 1.5, g("glStriker")),        // 1.5 ms .. 40 us
    "thump": g("glThump"), "crack": g("glCrack"),
    "nPieces": Math.round(3 * Math.pow(400 / 3, g("glPieces")) * Math.pow(glClamp(g("glBreak"), 0, 1), 1.2)),
    "shardHz": 12000 * Math.pow(1500 / 12000, g("glShard")),           // median piece's first mode (before thickness / material)
    "height": 3 * g("glHeight") * g("glHeight"),                       // m
    "throwV": 2.5 * Math.pow(g("glThrow"), 1.3),                       // m/s
    "rest": 0.12 + 0.6 * g("glBounce"),
    "tauFloor": 0.0012 * Math.pow(0.000025 / 0.0012, g("glFloor")),   // 1.2 ms .. 25 us
    "floorHz": 250 * Math.pow(7, g("glFloor")),
    "settle": g("glSettle"),
    "ringMul": 0.12 * Math.pow(50, g("glRing")),                       // 0.12 .. 6 (0.85 at 0.5)
    "beatHz": 0.3 * Math.pow(20, g("glBeat")),
    "pair": g("glPair"), "pairRatio": Math.pow(2, g("glPairTune") / 12),
    "seed": Math.round(g("glSeed")),
  };
}

// a decaying sinusoid added into L/R from t0 (s); starts at zero (sine phase), lives to -60 dB or maxLen. Returns samples.
function glRing(L, R, sr, t0, f, amp, t60, pan, maxLen) {
  if (!(f > 20) || f >= 0.45 * sr || !(Math.abs(amp) > 1e-7) || !(t60 > 0)) return 0;
  const i0 = Math.round(t0 * sr); if (i0 < 0 || i0 >= L.length) return 0;
  const life = Math.min(L.length - i0, Math.ceil(Math.min(t60, maxLen == null ? GLASS_MAX_T60 : maxLen) * sr));
  const r = Math.exp(-6.907755 / (t60 * sr)), w = 2 * Math.PI * f / sr, c = Math.cos(w) * r, s = Math.sin(w) * r;
  const [gl, gr] = glPanGains(pan);
  let re = amp, im = 0;
  for (let k = 0; k < life; k++) {
    L[i0 + k] += im * gl; R[i0 + k] += im * gr;
    const nr = re * c - im * s; im = re * s + im * c; re = nr;
  }
  return life;
}
// a contact click: the derivative of a half-sine force of length tau (cos over [0, tau)), box-integrated per sample
function glClick(L, R, sr, t0, amp, tau, pan) {
  tau = Math.max(tau, 1.5 / sr);
  const OS = 8, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(L.length, Math.ceil((t0 + tau) * sr) + 1);
  const [gl, gr] = glPanGains(pan);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < tau) s += Math.cos(Math.PI * t / tau); }
    const v = amp * s / OS; L[i] += v * gl; R[i] += v * gr;
  }
}
// a noise burst: band-passed (one-pole HP at lo, one-pole LP at hi), exponential decay tau, from t0 for len s
function glNoise(L, R, sr, t0, len, tau, amp, lo, hi, pan, rnd) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(L.length - i0, Math.ceil(len * sr));
  if (n <= 0) return;
  const aH = Math.exp(-2 * Math.PI * Math.min(lo, 0.45 * sr) / sr), aL = Math.exp(-2 * Math.PI * Math.min(hi, 0.45 * sr) / sr);
  const [gl, gr] = glPanGains(pan), d = Math.exp(-1 / (tau * sr));
  let lpH = 0, lpL = 0, e = amp;
  for (let k = 0; k < n; k++) {
    const x = rnd() * 2 - 1; lpH = x + (lpH - x) * aH; const hp = x - lpH; lpL = hp + (lpL - hp) * aL;
    const fade = k < 16 ? k / 16 : 1, v = lpL * e * fade; L[i0 + k] += v * gl; R[i0 + k] += v * gr; e *= d;
  }
}
// the body's modes for a shape: [{ f, a }] (a = strike-position amplitude, before the contact weighting)
function glBodyModes(shape, f1, rnd, sr) {
  const out = [];
  if (shape === 0) {              // vessel: shell modes n = 2..7
    [1, 2.62, 4.75, 7.4, 10.6, 14.4].forEach((q, k) => out.push({ f: f1 * q * (1 + 0.02 * (rnd() * 2 - 1)), a: Math.pow(k + 1, -0.8), n: k + 2 }));
  } else if (shape === 1) {       // pane: plate modes m, n = 1..6 (aspect a), struck at (x, y)
    const asp = 0.6 + 0.9 * rnd(), x = 0.2 + 0.6 * rnd(), y = 0.2 + 0.6 * rnd(), list = [];
    for (let m = 1; m <= 6; m++) for (let n = 1; n <= 6; n++) list.push({ f: f1 * (m * m + asp * n * n) / (1 + asp) * (1 + 0.01 * (rnd() * 2 - 1)), a: Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y) / Math.sqrt(m * n) });
    list.sort((p, q) => p.f - q.f);
    for (const m of list.slice(0, 24)) out.push(m);
  } else {                        // solid: sparse
    [1, 1.52, 2.07, 2.61, 3.3, 3.95].forEach((q, k) => out.push({ f: f1 * q * (1 + 0.04 * (rnd() * 2 - 1)), a: Math.pow(k + 1, -0.6) * (0.5 + 0.5 * rnd()) }));
  }
  return out.filter((m) => m.f < 0.45 * sr);
}
const glPieceAmp = (s, hFac, t60) => Math.sqrt(s * s * hFac / Math.max(0.02, t60));
// a piece's modes: f1 then a random, roughly constant spacing (a small irregular plate's modal density is flat in f)
function glPieceModes(f1, rnd) {
  const m = [f1]; let r = 1;
  for (let k = 1; k < 4; k++) { r += 0.35 + 0.8 * rnd(); m.push(f1 * r); }
  return m;
}

// One strike. Returns { L, R, n, info, tick(drive, out) }.
export function makeGlass(sr, cfg, seed) {
  const n = Math.max(1, Math.round(cfg["dur"] * sr)), M = GLASS_MATS[cfg["mat"]], width = cfg["width"];
  const base = ((seed >>> 0) ^ Math.imul(cfg["seed"] + 1, 0x9e3779b1)) >>> 0;
  const rB = glRng(base ^ 0x1b873593), rF = glRng(base ^ 0x85ebca6b), rC = glRng(base ^ 0xc2b2ae35), rS = glRng(base ^ 0x27d4eb2f);
  const buf = () => [new Float64Array(n), new Float64Array(n)];
  const [bL, bR] = buf(), [tL, tR] = buf(), [cL, cR] = buf(), [zL, zR] = buf(), [dL, dR] = buf(), [sL, sR] = buf();
  const t0 = GLASS_STRIKE_AT, brk = cfg["brk"], shape = cfg["shape"], f1 = cfg["freq"];
  const info = { pieces: 0, children: 0, landings: [], fizz: 0, bodyModes: [], beatHz: 0, tBreak: 0, energies: {} };
  // ---- the break time: a pane flexes before it goes
  const tBreak = t0 + [0.002, 0.007, 0.002][shape] * (0.7 + 0.6 * rB());
  info.tBreak = tBreak;
  // ---- BODY (and the second vessel of a toast)
  const choke = brk > 0 ? Math.pow(1 - brk, 2) : 1, chokeDamp = 1 - 0.8 * brk;
  const bodyRing = (L, R, fBase, amp, pan, rnd, isPair) => {
    const modes = glBodyModes(shape, fBase, rnd, sr);
    let e30 = 0;
    for (const md of modes) {
      const a = amp * md.a * glW(md.f, cfg["tauStrike"]) * (rnd() < 0.5 ? -1 : 1);
      const t60 = glT60(M, md.f, cfg["ringMul"]) * (shape === 1 ? 0.5 : 1);   // a pane's frame damps it
      e30 += a * a * 0.015;
      const split = shape === 0 ? cfg["beatHz"] * Math.sqrt(md.n - 1) * (0.7 + 0.6 * rnd()) : 0;
      if (!isPair && md === modes[0]) info.beatHz = split;
      if (!isPair) info.bodyModes.push(Math.round(md.f));
      const parts = split > 0 ? [[md.f - split / 2, 1], [md.f + split / 2, 0.2 + 0.35 * rnd()]] : [[md.f, 1]];
      for (const [f, w] of parts) {
        if (f >= 0.45 * sr) continue;
        if (brk <= 0 || isPair) { glRing(L, R, sr, t0, f, a * w, t60, pan); continue; }
        // choked at the break: full ring until tBreak, then a 3 ms slide to `choke` of it, decaying faster after
        const i0 = Math.round(t0 * sr), ib = Math.round(tBreak * sr), life = Math.min(n - i0, Math.ceil(t60 * sr));
        const w0 = 2 * Math.PI * f / sr, r1 = Math.exp(-6.907755 / (t60 * sr)), r2 = Math.exp(-6.907755 / (Math.max(0.01, t60 * chokeDamp) * sr));
        const [gl, gr] = glPanGains(pan), slide = Math.round(0.003 * sr);
        let re = a * w, im = 0;
        for (let k = 0; k < life; k++) {
          const i = i0 + k, after = i - ib, g = after <= 0 ? 1 : after >= slide ? choke : 1 + (choke - 1) * after / slide;
          L[i] += im * g * gl; R[i] += im * g * gr;
          const r = after > 0 ? r2 : r1, c = Math.cos(w0) * r, s = Math.sin(w0) * r, nr = re * c - im * s; im = re * s + im * c; re = nr;
          if (after > slide && Math.abs(re) + Math.abs(im) < 1e-6 * Math.abs(a)) break;
        }
      }
    }
    return e30;
  };
  const E30 = Math.max(1e-12, bodyRing(bL, bR, f1, 1, (rB() * 2 - 1) * 0.1 * width, rB, false));
  if (cfg["pair"] > 0) bodyRing(bL, bR, f1 * cfg["pairRatio"], cfg["pair"], 0.25 * width, glRng(base ^ 0x5bd1e995), true);
  glClick(bL, bR, sr, t0, 0.35, cfg["tauStrike"], 0);                    // the contact tick of the strike itself
  // ---- BLOW: the low thud of what hit it
  if (cfg["thump"] > 0) {
    const fT = [110, 65, 140][shape] * (0.8 + 0.4 * rB());
    glRing(tL, tR, sr, t0, fT, 1, 0.14, 0);
    glRing(tL, tR, sr, t0, fT * 2.3, 0.35, 0.06, 0);
    glNoise(tL, tR, sr, t0, 0.08, 0.012, 1.2, 30, 450, 0, rB);
  }
  // ---- FRACTURE: snaps, grit (one buffer), fizz (another)
  if (brk > 0 && cfg["crack"] > 0) {
    const nSnap = 1 + Math.round(cfg["crack"] * brk * (shape === 1 ? 8 : 4)), span = shape === 1 ? 0.025 : 0.008;
    for (let k = 0; k < nSnap; k++) {
      const t = tBreak + (k === 0 ? 0 : span * Math.pow(rC(), 0.7)), a = (k === 0 ? 1 : 0.35 + 0.5 * rC()), p = (rC() * 2 - 1) * 0.4 * width;
      glClick(cL, cR, sr, t, a, 1.5 / sr, p);
      glNoise(cL, cR, sr, t, 0.012, 0.0015, a * 0.9, 1800, 16000, p, rC);
    }
    if (M["grit"] > 0) glNoise(cL, cR, sr, tBreak, 0.15, 0.015 + 0.025 * brk, M["grit"] * 1.5, 500, 3500, 0, rC);
    // micro-cracks: Poisson, rate decaying with tau_f
    const tauF = (shape === 1 ? 0.08 : 0.04) * (0.6 + 0.8 * brk), rate0 = M["fizz"] * (1500 + 5000 * cfg["crack"]) * brk;
    let t = tBreak;
    for (let guard = 0; guard < 20000; guard++) {
      const lam = rate0 * Math.exp(-(t - tBreak) / tauF);
      if (lam < 5 || t > cfg["dur"]) break;
      t += -Math.log(Math.max(1e-9, rC())) / lam;
      const f = GLASS_FIZZ_LO * Math.pow(GLASS_FIZZ_HI / GLASS_FIZZ_LO, rC()) * Math.min(1, M["speed"] + 0.2);
      glRing(zL, zR, sr, t, Math.min(f, 0.44 * sr), Math.pow(rC(), 2) * (rC() < 0.5 ? -1 : 1), 0.004 + 0.014 * rC(), (rC() * 2 - 1) * width);
      info.fizz++;
    }
  }
  // ---- PIECES
  const nP = brk > 0 ? Math.max(1, cfg["nPieces"]) : 0, fMed = cfg["shardHz"] * cfg["hFac"] * M["speed"];
  info.fMed = fMed;
  const dur = cfg["dur"];
  const land = (p, tLand, vImp, isChild) => {
    // bounce train from the first landing at tLand with impact speed vImp
    let t = tLand, v = vImp, last = null;
    for (let k = 0; k < 12 && t < dur - 0.02; k++) {
      const amp = p.A * Math.min(1.5, v / 2.5) * (0.6 + 0.4 * rF());
      const e = glClamp(cfg["rest"] * M["rest"] * (0.7 + 0.6 * rF()), 0.03, 0.9), vNext = e * v, gap = 2 * vNext / GLASS_GRAV;
      const resting = vNext < 0.06 || k === 11 || t + gap >= dur - 0.02;
      for (let j = 0; j < p.modes.length; j++) {
        const f = p.modes[j], w = glW(f, cfg["tauFloor"]) * (0.25 + 0.75 * rF()) * Math.pow(j + 1, -0.3) * (rF() < 0.5 ? -1 : 1);
        glRing(dL, dR, sr, t, f, amp * w, glT60(M, f, cfg["ringMul"]) * (resting ? 0.2 : 1), p.pan);
      }
      glClick(dL, dR, sr, t, amp * 0.3, cfg["tauFloor"], p.pan);
      glRing(dL, dR, sr, t, cfg["floorHz"] * (0.85 + 0.3 * rF()), amp * 0.25 * Math.sqrt(p.s), 0.012 + 0.015 * (1 - cfg["floorHz"] / 1750), p.pan);
      info.landings.push(t);
      // the cascade: a big piece landing hard breaks again (first landing only, children do not)
      if (k === 0 && !isChild && p.s > 0.7 && rF() < M["brittle"] * brk * Math.min(1, vImp / 2.5)) {
        const nc = 2 + (rF() < 0.5 ? 1 : 0);
        for (let c = 0; c < nc; c++) {
          const s = p.s * (0.45 + 0.25 * rF()), fc = Math.min(p.f1 * Math.pow(p.s / s, 2), 0.44 * sr);
          const child = { s, f1: fc, A: glPieceAmp(s, cfg["hFac"], glT60(M, fc, cfg["ringMul"])), pan: glClamp(p.pan + (rF() - 0.5) * 0.2, -1, 1), modes: glPieceModes(fc, rF) };
          land(child, t + 0.003 * rF(), v * e * (0.5 + 0.8 * rF()), true);
          info.children++;
        }
        return { t, amp, last: true };
      }
      last = { t, amp };
      if (resting) break;
      v = vNext; t += gap;
    }
    // SETTLE: a big piece rocks to rest (accelerating ticks) and a sliding one scrapes
    if (cfg["settle"] > 0 && last && p.s > 0.6 && rS() < 0.35 + 0.65 * cfg["settle"]) {
      let tr = last.t + 0.02 + 0.03 * rS(), gapR = 0.025 + 0.03 * rS(), a = last.amp * 0.35;
      const nr = 3 + Math.floor(5 * rS());
      for (let k = 0; k < nr && tr < dur - 0.02; k++) {
        for (let j = 0; j < 2; j++) glRing(sL, sR, sr, tr, p.modes[j], a * (0.5 + 0.5 * rS()) * glW(p.modes[j], cfg["tauFloor"]), glT60(M, p.modes[j], cfg["ringMul"]) * 0.25, p.pan);
        tr += gapR; gapR *= 0.72; a *= 0.8;
      }
      if (rS() < 0.5 * M["slide"]) glNoise(sL, sR, sr, last.t + 0.005, 0.03 + 0.09 * rS(), 0.03, last.amp * 0.6 * M["slide"], 2500, 8000, p.pan, rS);
    }
    return last;
  };
  for (let i = 0; i < nP; i++) {
    const s = glClamp(Math.exp(0.45 * glGauss(rF)), 0.35, 2), fp = fMed * Math.pow(s, -2);
    if (fp >= 0.44 * sr) { info.pieces++; continue; }        // too small to ring in band: part of the fizz
    // a piece's ring energy ~ its mass (s^2 h), so its amplitude ~ sqrt(mass / T60): a big piece is louder, but its long
    // ring does not count twice (amplitude ~ s^1.2 with T60 ~ s^2.6 made energy ~ s^5 and three chunks drowned the rest)
    const p = { s, f1: fp, A: glPieceAmp(s, cfg["hFac"], glT60(M, fp, cfg["ringMul"])), pan: glClamp((rF() * 2 - 1) * (0.4 + 0.6 * rF()), -1, 1) * width, modes: glPieceModes(fp, rF) };
    info.pieces++;
    // born ringing: the fracture's release (very fast, so bright), airborne so undamped; then JOSTLED: pieces separating
    // knock each other (and the wall, the frame) within the first tens of ms. That is the CRASH, before anything lands.
    // pieces part over ~6 ms (a pane's drop out of the frame over ~0.12 s): all born within 2 ms rose together into one
    // spike 22-26 dB over the take's loudness, which no limiter setting could bring to -18 LUFS on the lossy materials
    const tRel = tBreak + (shape === 1 ? 0.12 * rF() * rF() : 0.006 * rF() * rF());
    const hits = [[tRel, (0.3 + 0.6 * cfg["crack"]) * (0.5 + 0.5 * rF())]], nJ = Math.floor(rF() * (1 + 3 * cfg["crack"]));
    for (let j = 0; j < nJ; j++) hits.push([tBreak + (shape === 1 ? 0.06 : 0.035) * Math.pow(rF(), 1.5), (0.25 + 0.45 * rF()) * cfg["crack"]]);
    for (const [th, ah] of hits) for (let j = 0; j < p.modes.length; j++) glRing(dL, dR, sr, th, p.modes[j], p.A * ah * glW(p.modes[j], GLASS_FRAC_TAU) * (0.3 + 0.7 * rF()) * Math.pow(j + 1, -0.3) * (rF() < 0.5 ? -1 : 1), glT60(M, p.modes[j], cfg["ringMul"]), p.pan);
    // flight: launched up at vz from height H; lands at its flight time with speed vImp
    const H = cfg["height"] * (shape === 1 ? 0.15 + 0.85 * rF() : 0.7 + 0.6 * rF());
    const vz = cfg["throwV"] * (0.15 + 0.85 * Math.pow(rF(), 0.7));
    const vImp = Math.sqrt(vz * vz + 2 * GLASS_GRAV * H);
    if (vImp < 0.05) continue;                                 // broken in place, nothing to fall
    land(p, tRel + (vz + vImp) / GLASS_GRAV, vImp, false);
  }
  // ---- levels: every component to a target energy relative to the strike's first 30 ms (E30)
  const energy = (L, R) => { let e = 0; for (let i = 0; i < n; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2; return e / sr; };
  const setE = (L, R, target, name) => {
    const e = energy(L, R), g = e > 0 && target > 0 ? Math.sqrt(target / e) : 0;
    for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
    info.energies[name] = target / E30;
  };
  info.energies.body = energy(bL, bR) / E30;
  setE(tL, tR, 3 * cfg["thump"] * cfg["thump"] * E30, "blow");
  setE(cL, cR, 2.5 * cfg["crack"] * cfg["crack"] * brk * E30, "crack");
  setE(zL, zR, 6 * cfg["crack"] * cfg["crack"] * brk * M["fizz"] * E30, "fizz");
  setE(dL, dR, 22 * Math.pow(brk, 1.5) * E30, "pieces");
  setE(sL, sR, 2.5 * cfg["settle"] * cfg["settle"] * brk * E30, "settle");
  // ---- sum, then a 20 Hz two-pole DC / subsonic block (a microphone's own)
  const L = new Float32Array(n), R = new Float32Array(n), hpA = Math.exp(-2 * Math.PI * 20 / sr);
  let h1l = 0, h1r = 0, x1l = 0, x1r = 0, h2l = 0, h2r = 0, y1l = 0, y1r = 0;
  for (let i = 0; i < n; i++) {
    const xl = bL[i] + tL[i] + cL[i] + zL[i] + dL[i] + sL[i], xr = bR[i] + tR[i] + cR[i] + zR[i] + dR[i] + sR[i];
    h1l = hpA * (h1l + xl - x1l); x1l = xl; h2l = hpA * (h2l + h1l - y1l); y1l = h1l;
    h1r = hpA * (h1r + xr - x1r); x1r = xr; h2r = hpA * (h2r + h1r - y1r); y1r = h1r;
    L[i] = h2l; R[i] = h2r;
  }
  const lv = glassLevel(L, R, sr);
  for (let i = 0; i < n; i++) { L[i] *= lv; R[i] *= lv; }
  let i = 0;
  return { L, R, n, info, tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9
export function glassLevel(L, R, sr = 44100) {
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
  const SR = 44100, TARGET_LUFS = -18, OUT = join(ROOT, "soundtests", "proto-glass");
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
  const preset = (nm) => { if (!PRESETS[nm]) throw new Error("no preset " + nm); const o = Object.assign({}, PRESETS[nm]); delete o._vary; return o; };
  const stack = (base, list) => Object.assign({}, base, { layers: JSON.stringify(list.map(([s, d, g]) => ({ s, d, g, p: 0 }))) });

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
  // as flow.mjs / blast.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js
  // limiterProcess, the Limiter control any preset can set), the smallest amount in 0.1 steps that brings it within 0.5 dB
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
    // still short at the slider's top: a SECOND pass, as blast.mjs (reported "1+x", never mistaken for a setting the
    // app has: the port would carry it as a Peak control row, as blastPeak does)
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, 1);
      let p2 = 0; for (let i = 0; i < l.length; i++) p2 = Math.max(p2, Math.abs(l[i]), Math.abs(r[i]));
      for (let i = 0; i < l.length; i++) { l[i] *= 0.9 / p2; r[i] *= 0.9 / p2; }
      dctx.limiterProcess(l, r, amt);
      matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5 || amt > 0.95) { L.set(l); R.set(r); return "1+" + Math.round(amt * 10) / 10; }
    }
    return 0;
  }

  // ---- the takes. A model take: { id, why, st: rows + freq/duration/width, seed }. Its room is the round's `room`.
  const gl = (o) => Object.assign({ duration: 1.2, width: 0.7 }, o);
  const V = 0, P = 1, S = 2, GLASS = 0, CRYSTAL = 1, PORCELAIN = 2, CLAY = 3;
  const GS = preset("Glass Shatter");
  const ROUNDS = {
    "glass-shatter": {
      title: "Glass Shatter", control: "Glass Shatter", controlWhy: "the CURRENT preset \"Glass Shatter\" exactly as it ships (a triangle at 2.4 kHz buried in noise, crushed, with a 50 ms echo): the preset that beat three modal / particle builds blind in the care pass.",
      room: { reverb: 0.35, reverbSize: 0.6, reverbTone: 0.75 },
      listen: "A glass smashing: the everyday one, a drinking glass or a jar. Which one is GLASS BREAKING? Listen for the instant it goes (a sharp crack, a burst), for the pieces (do they ring like little bits of glass, each at its own pitch, or hiss like static?) and for what happens after (do pieces land, bounce and settle, or does it just fade?).",
      takes: [
        { id: "dropped-tumbler", why: "MODEL, a drinking glass dropped on a tiled floor: the hard tick and the glass's own ring (~1.27 kHz, choked ~2 ms later as it breaks), a crack and a fizz of micro-cracks, ~35 pieces (median ~5.6 kHz) knocked about as they part, then thrown up off the floor by the impact, landing and bouncing over ~0.35 s with the gaps shrinking, a few breaking again as they land, the big ones rocking to rest.",
          st: gl({ freq: 1250, duration: 0.9, glMaterial: GLASS, glShape: V, glThick: 0.35, glStriker: 0.9, glThump: 0.15, glCrack: 0.6, glPieces: 0.5, glShard: 0.4, glHeight: 0, glThrow: 0.45, glBounce: 0.5, glFloor: 0.85, glSettle: 0.4, glRing: 0.5 }), seed: 101 },
        { id: "thrown-at-wall", why: "MODEL, a glass thrown hard against a wall: a violent crack (more snaps, a dense fizz), ~150 smaller pieces (median ~7 kHz) crashing as they part, then sprayed off the wall and falling ~0.5 m to a stone floor: a short lull while they are in the air, then a rain from ~0.3 s, densest at ~0.45 s, with ~135 more from pieces breaking again as they land, thinning to ~1.1 s.",
          st: gl({ freq: 1400, duration: 1.3, glMaterial: GLASS, glShape: V, glThick: 0.3, glStriker: 1, glThump: 0.3, glCrack: 0.9, glPieces: 0.8, glShard: 0.25, glHeight: 0.4, glThrow: 0.6, glBounce: 0.45, glFloor: 0.9, glSettle: 0.25, glRing: 0.45 }), seed: 113 },
        { id: "crunch-in-place", why: "MODEL, a glass crushed where it stands (stepped on, a hammer on a table): the blow, the crack and a burst of ~57 chips (median ~6.8 kHz) ringing as they break and knock each other, almost nothing falls (no height, barely thrown): short and crunchy, the game one-shot reading. 0.6 s.",
          st: gl({ freq: 1100, duration: 0.6, glMaterial: GLASS, glShape: V, glThick: 0.4, glStriker: 0.75, glThump: 0.45, glCrack: 0.85, glPieces: 0.6, glShard: 0.35, glHeight: 0, glThrow: 0.08, glBounce: 0.3, glFloor: 0.5, glSettle: 0.1, glRing: 0.35 }), seed: 127 },
      ] },
    "window-smash": {
      title: "Window Smash (a GAP: no preset owns it)", control: "window (today's engines)",
      controlPatch: stack(Object.assign({}, GS, { decay: 0.5, release: 0.6, duration: 1.4 }), [
        [{ wave: 19, impactTone: 0.3, impactDecay: 0.2, impactPunch: 1, impactGrit: 0.4, attack: 0.001, sustain: 0, decay: 0.15, release: 0.15, boom: 0.6, boomFreq: 70, boomDrop: 0.6, boomDecay: 0.15, duration: 0.4, reverb: 0.2 }, 0, 0.6],
        [{ wave: 10, freq: 3200, modalPartials: 6, modalInharm: 0.85, modalBright: 0.9, modalDecay: 0.15, sustain: 1, attack: 0.001, release: 0.1, repeat: 9, rate: 8, arpStep: -1, duration: 1.2, reverb: 0.3, width: 0.8 }, 0.15, 0.45],
      ]),
      controlWhy: "CONTROL, today's engines layered (no window preset exists): the Glass Shatter preset (the care pass's winner) lengthened to 1.4 s, under an impact-engine thud with a 70 Hz boom for the stone, and a modal-engine rain of falling shards (nine pings at 8 a second, stepping down a semitone each) starting 0.15 s in.",
      room: { reverb: 0.35, reverbSize: 0.6, reverbTone: 0.75 },
      listen: "A window being smashed in: a pane of glass in its frame, broken by something thrown or a blow. About a second and a half. Which one is a WINDOW? Listen for the blow and the pane giving way (a thud, a flex, then the crack), and for a RAIN of big and small pieces falling out of the frame and landing.",
      takes: [
        { id: "stone-through", why: "MODEL, a stone through a 4 mm pane: the stone's thud and the pane's low whump (its plate modes from 70 Hz) choked as it cracks ~8 ms later (a train of snaps over 25 ms), ~90 pieces (median ~5.1 kHz) dropping out of the frame over ~0.12 s from up to 1.2 m onto a hard floor, ~100 more from pieces breaking again as they land, a rain from ~0.2 s thinning out by ~1.2 s, big pieces rocking to rest.",
          st: gl({ freq: 70, duration: 1.6, glMaterial: GLASS, glShape: P, glThick: 0.35, glStriker: 0.7, glThump: 0.55, glCrack: 0.75, glPieces: 0.7, glShard: 0.45, glHeight: 0.63, glThrow: 0.2, glBounce: 0.45, glFloor: 0.85, glSettle: 0.5, glRing: 0.55 }), seed: 211 },
        { id: "shop-window", why: "MODEL, a big plate-glass shop window: thicker (6 mm: the pieces ring higher and land heavier), a heavier blow and a 45 Hz whump, the most pieces (~190, median ~5.3 kHz, and ~160 re-breaks) and the longest fall (up to 2.4 m), so the rain arrives later (from ~0.3 s), lands harder and runs to ~1.7 s.",
          st: gl({ freq: 45, duration: 2.0, glMaterial: GLASS, glShape: P, glThick: 0.6, glStriker: 0.6, glThump: 0.75, glCrack: 0.85, glPieces: 0.85, glShard: 0.6, glHeight: 0.9, glThrow: 0.25, glBounce: 0.4, glFloor: 0.95, glSettle: 0.55, glRing: 0.6 }), seed: 223 },
        { id: "small-pane-punched", why: "MODEL, a small pane (a door's window) punched or elbowed: a soft blow (a fist, so the pane's 130 Hz ring is dull), a sharper crack, ~45 pieces (median ~5.2 kHz) falling up to 0.9 m onto a WOODEN floor (softer: duller landings, and the floor knocking under them). The quick, close one. 1.0 s.",
          st: gl({ freq: 130, duration: 1.0, glMaterial: GLASS, glShape: P, glThick: 0.25, glStriker: 0.2, glThump: 0.5, glCrack: 0.7, glPieces: 0.55, glShard: 0.35, glHeight: 0.55, glThrow: 0.3, glBounce: 0.45, glFloor: 0.5, glSettle: 0.3, glRing: 0.5 }), seed: 239 },
      ] },
    "bottle-break": {
      title: "Bottle Break (a GAP: no preset owns it)", control: "bottle (today's engines)",
      controlPatch: stack(Object.assign({}, GS, { duration: 0.9, decay: 0.3 }), [
        [{ wave: 10, freq: 1100, modalPartials: 6, modalInharm: 0.6, modalBright: 0.6, modalDecay: 0.08, sustain: 1, attack: 0.001, release: 0.06, duration: 0.25, width: 0.4 }, 0, 0.7],
        [{ wave: 19, impactTone: 0.5, impactDecay: 0.1, impactPunch: 0.9, impactGrit: 0.5, attack: 0.001, sustain: 0, decay: 0.08, release: 0.08, duration: 0.25 }, 0, 0.5],
      ]),
      controlWhy: "CONTROL, today's engines layered (no bottle preset exists): the Glass Shatter preset (0.9 s) over a modal-engine \"bonk\" of thick glass at 1.1 kHz (short, six partials) and an impact-engine hit.",
      room: { reverb: 0.35, reverbSize: 0.6, reverbTone: 0.75 },
      listen: "A glass bottle breaking (a beer or wine bottle, or a thrown potion). Which one is a BOTTLE: thick glass, a heavier object than a drinking glass? Listen for the bottle's own hollow \"bonk\" as it is hit, the crack, and the chunks: fewer, bigger, heavier pieces than a thin glass makes.",
      takes: [
        { id: "dropped-on-concrete", why: "MODEL, a beer bottle dropped on concrete: thick glass (the pieces ring higher and land heavier), the bottle's hollow body ring (~890 Hz) choked at the break, ~27 chunky pieces (median ~6.5 kHz) thrown a little off the floor, bouncing hard over ~0.3 s, a couple rocking to rest.",
          st: gl({ freq: 900, duration: 0.9, glMaterial: GLASS, glShape: V, glThick: 0.8, glStriker: 0.85, glThump: 0.35, glCrack: 0.55, glPieces: 0.45, glShard: 0.6, glHeight: 0, glThrow: 0.4, glBounce: 0.55, glFloor: 0.9, glSettle: 0.5, glRing: 0.55 }), seed: 307 },
        { id: "over-a-table-edge", why: "MODEL, a bottle smashed on a table's edge (a bar fight): a heavy, dull blow (soft striker: the wood) with a thud, the body's ~810 Hz bonk short, a crack and ~35 thick pieces (median ~6.9 kHz) falling ~0.5 m onto a WOODEN floor at ~0.3 s (dull landings, the floor knocking, ~37 more from re-breaks), little bounce.",
          st: gl({ freq: 800, duration: 0.85, glMaterial: GLASS, glShape: V, glThick: 0.75, glStriker: 0.3, glThump: 0.7, glCrack: 0.6, glPieces: 0.5, glShard: 0.55, glHeight: 0.4, glThrow: 0.2, glBounce: 0.35, glFloor: 0.3, glSettle: 0.35, glRing: 0.45 }), seed: 311 },
        { id: "thrown-potion", why: "MODEL, a small bottle THROWN against stone (the game potion): a hard, bright crack, a dense fizz, ~70 pieces (median ~7.5 kHz) crashing off the wall and falling ~0.6 m onto stone: a short lull, then a quick bright rain from ~0.35 s to ~0.9 s.",
          st: gl({ freq: 1500, duration: 1.0, glMaterial: GLASS, glShape: V, glThick: 0.55, glStriker: 1, glThump: 0.25, glCrack: 0.85, glPieces: 0.65, glShard: 0.4, glHeight: 0.45, glThrow: 0.55, glBounce: 0.45, glFloor: 0.9, glSettle: 0.2, glRing: 0.5 }), seed: 331 },
      ] },
    "glass-clink": {
      title: "Glass Clink", control: "Glass Clink", controlWhy: "the CURRENT preset \"Glass Clink\" exactly as it ships (the modal engine: four partials at 2093 Hz, 0.3 s).",
      room: { reverb: 0.15, reverbSize: 0.4, reverbTone: 0.5 },
      listen: "Two glasses clinking (a toast, \"cheers\"). Which one is GLASSES touching? Listen for the tick of the contact, the RING after it (glass rings on and warbles a little; a bell or a beep does not), and whether you can hear that there are two glasses.",
      takes: [
        { id: "wine-toast", why: "MODEL, two crystal wine glasses touching rims: a bright tick, then both glasses ring (shell modes from ~1.16 kHz and ~1.25 kHz, the next at 2.6x), each mode a pair split by the glass's asymmetry so the ring WARBLES (~1.7 Hz), long (falls 30 dB in ~1.5 s; the take ends at 1.6 s). No break.",
          st: gl({ freq: 1180, duration: 1.6, glBreak: 0, glMaterial: CRYSTAL, glShape: V, glThick: 0.15, glStriker: 0.95, glThump: 0, glCrack: 0, glRing: 0.62, glBeat: 0.5, glPair: 0.85, glPairTune: 1.1, width: 0.5 }), seed: 401 },
        { id: "tumbler-clink", why: "MODEL, two everyday glasses with a drink in them, held in the hand: thick soda glass, damped (the hand and the drink take the ring: it falls 30 dB in ~0.2 s), the two about 2 semitones apart (~1.9 and ~2.1 kHz). The quick casual clink.",
          st: gl({ freq: 1900, duration: 0.6, glBreak: 0, glMaterial: GLASS, glShape: V, glThick: 0.6, glStriker: 0.7, glThump: 0, glCrack: 0, glRing: 0.35, glBeat: 0.25, glPair: 0.8, glPairTune: 1.9, width: 0.5 }), seed: 409 },
        { id: "flute-clink", why: "MODEL, two champagne flutes: thin crystal, higher (~1.62 kHz, the second ~1.65 kHz, a third of a semitone up, so the two nearly fuse into one beating note), a hard bright tick, a medium ring (falls 30 dB in ~0.7 s) with a ~1.8 Hz warble.",
          st: gl({ freq: 1600, duration: 1.1, glBreak: 0, glMaterial: CRYSTAL, glShape: V, glThick: 0.12, glStriker: 1, glThump: 0, glCrack: 0, glRing: 0.48, glBeat: 0.7, glPair: 0.9, glPairTune: 0.6, width: 0.5 }), seed: 419 },
      ] },
    "pot-smash": {
      title: "Pot Smash (a GAP: no preset owns it)", control: "pot (today's engines)",
      controlPatch: stack({ wave: 19, impactTone: 0.4, impactDecay: 0.12, impactPunch: 0.95, impactGrit: 0.8, attack: 0.001, sustain: 0, decay: 0.12, release: 0.12, duration: 0.8, width: 0.6, reverb: 0.2, reverbSize: 0.5, reverbTone: 0.6 }, [
        [{ wave: 10, freq: 700, modalPartials: 4, modalInharm: 0.3, modalBright: 0.45, modalDecay: 0.1, sustain: 1, attack: 0.001, release: 0.08, duration: 0.3, reverb: 0.2 }, 0, 0.5],
        [{ wave: 15, particleRate: 30, particleTone: 0.55, particleDecay: 0.12, particleSpread: 0.9, sustain: 1, attack: 0.005, release: 0.3, duration: 0.7, width: 0.8, reverb: 0.2 }, 0.03, 0.6],
      ]),
      controlWhy: "CONTROL, today's engines layered (no pot preset exists): an impact-engine hit with grit (the clay knock), a modal-engine ceramic ring at 700 Hz like Teacup Ting's, and a particle-engine clatter of pieces 30 a second over 0.7 s.",
      room: { reverb: 0.2, reverbSize: 0.5, reverbTone: 0.6 },
      listen: "A clay pot or ceramic vase breaking (the pot a hero smashes, a vase knocked off a shelf). Which one is a POT? Listen for the hollow knock of the pot itself, the crunch as it breaks, and the pieces: CERAMIC, so chunkier and duller than glass, clattering rather than tinkling.",
      takes: [
        { id: "off-a-shelf", why: "MODEL, a glazed ceramic vase (porcelain) knocked off a shelf, breaking on a stone floor: its hollow body ring (~645 Hz) choked at the break, a crunch with some grit, ~27 chunky pieces (median ~3.6 kHz: ceramic, lower than glass) thrown up off the floor, clattering over ~0.3 s, sliding and rocking to rest.",
          st: gl({ freq: 650, duration: 0.9, glMaterial: PORCELAIN, glShape: V, glThick: 0.5, glStriker: 0.8, glThump: 0.3, glCrack: 0.6, glPieces: 0.45, glShard: 0.75, glHeight: 0, glThrow: 0.45, glBounce: 0.45, glFloor: 0.85, glSettle: 0.55, glRing: 0.5 }), seed: 503 },
        { id: "sword-swing", why: "MODEL, a terracotta (clay) pot smashed where it stands by a blow (the game pot): a dull hollow knock (~375 Hz; clay damps fast), a gritty crunch, ~35 pieces (median ~2.7 kHz) thrown up and out around it, landing on stone from ~0.2 s to ~0.5 s with ~20 more from re-breaks. Dry, gritty, quick.",
          st: gl({ freq: 380, duration: 0.8, glMaterial: CLAY, glShape: V, glThick: 0.55, glStriker: 0.55, glThump: 0.5, glCrack: 0.75, glPieces: 0.5, glShard: 0.65, glHeight: 0.25, glThrow: 0.55, glBounce: 0.35, glFloor: 0.8, glSettle: 0.4, glRing: 0.55 }), seed: 509 },
        { id: "big-urn", why: "MODEL, a big earthenware urn tipping over and smashing: lower (~230 Hz body), thick, a heavy thud, fewer and bigger chunks (~19, median ~2.1 kHz) that clunk rather than ring, with grit and sliding. The heaviest one.",
          st: gl({ freq: 230, duration: 0.9, glMaterial: CLAY, glShape: V, glThick: 0.7, glStriker: 0.4, glThump: 0.8, glCrack: 0.6, glPieces: 0.38, glShard: 0.85, glHeight: 0, glThrow: 0.45, glBounce: 0.45, glFloor: 0.85, glSettle: 0.7, glRing: 0.6 }), seed: 521 },
      ] },
  };
  const ORDER = ["glass-shatter", "window-smash", "bottle-break", "pot-smash", "glass-clink"];

  function renderModel(t) {
    const st = Object.assign({}, GLASS_DEFAULTS, t.st), cfg = glassCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeGlass(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms };
  }
  function renderTake(t, round) {
    if (t.control) {
      const o = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
      return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), info: null };
    }
    const { r, cfg, ms } = renderModel(t);
    const L = r.L, R = r.R, n = L.length, room = round.room;
    if (room && room.reverb > 0) dctx.reverbProcess(L, R, room.reverbSize, room.reverbTone, room.reverb);
    const fo = Math.floor(0.06 * SR);                      // no click where the buffer ends
    for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
    return { L, R, info: r.info, cfg, ms };
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
  function spectrum(x, a, N) {   // Hann-windowed power spectrum of x[a .. a+N)
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N && a + i < x.length; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im); const p = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p;
  }
  function measure(L, R, info) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e2 = Math.floor(0.002 * SR); let eS = 0, eE = 0;
    for (let i = 0; i < e2; i++) { eS = Math.max(eS, Math.abs(L[i]), Math.abs(R[i])); eE = Math.max(eE, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeS: eS / (pk || 1), edgeE: eE / (pk || 1) };
    // whole-file centroid and share above 4 kHz
    let N = 1; while (N < n) N <<= 1;
    const p = spectrum(mono, 0, N); let all = 0, num = 0, hi = 0, lo = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; all += p[k]; num += f * p[k]; if (f > 4000) hi += p[k]; if (f < 500) lo += p[k]; }
    m.centroid = num / (all || 1); m.hi4k = hi / (all || 1); m.lo500 = lo / (all || 1);
    // per 50 ms: level (dB re the loudest window) and centroid
    const W = Math.round(0.05 * SR), lv = [], cen = [];
    for (let a = 0; a + W <= n; a += W) {
      let s = 0; for (let i = a; i < a + W; i++) s += mono[i] * mono[i]; lv.push(s / W);
      const q = spectrum(mono, a, 2048); let t = 0, u = 0; for (let k = 2; k < 1024; k++) { t += q[k]; u += q[k] * k * SR / 2048; } cen.push(t > 1e-12 ? Math.round(u / t / 100) / 10 : "-");
    }
    const mx = Math.max(...lv);
    m.env = lv.map((v) => Math.round(10 * Math.log10(v / mx + 1e-12))).join(" ");
    m.cen = cen.join(" ");
    // crest: peak over the RMS of the loudest 400 ms
    const B = Math.min(n, Math.floor(0.4 * SR)); let best = 0;
    for (let a = 0; a + B <= n; a += Math.floor(0.05 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += mono[i] * mono[i]; best = Math.max(best, s / B); }
    m.crest = 20 * Math.log10(pk / Math.sqrt(best || 1e-20));
    // ring: the strongest spectral peaks over 30-400 ms (the body, if it survives), and the time to fall 30 dB
    const a0 = Math.round(0.03 * SR), q = spectrum(mono, a0, 16384), pks = [];
    for (let k = 20; k < 8000; k++) if (q[k] > q[k - 1] && q[k] >= q[k + 1] && q[k] > q[k - 2] && q[k] >= q[k + 2]) pks.push([k * SR / 16384, q[k]]);
    pks.sort((x, y) => y[1] - x[1]);
    const top = pks[0] ? pks[0][1] : 1;
    m.peaks = pks.slice(0, 5).filter((x) => x[1] > top * 0.01).map((x) => Math.round(x[0]) + " Hz (" + Math.round(10 * Math.log10(x[1] / top)) + ")").join(", ");
    const env = []; for (let a = 0; a + 441 <= n; a += 441) { let s = 0; for (let i = a; i < a + 441; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / 441 + 1e-20)); }
    const emax = Math.max(...env), ipk = env.indexOf(emax), i30 = env.findIndex((v, i) => i > ipk && v < emax - 30);
    m.fall30 = i30 > 0 ? (i30 - ipk) * 0.01 : null;
    if (info) {
      const bins = []; for (let t = 0; t < m.sec; t += 0.1) bins.push(info.landings.filter((x) => x >= t && x < t + 0.1).length);
      m.landings = bins.join(" ");
    }
    return m;
  }

  function run(name) {
    const round = ROUNDS[name];
    const ctrl = round.controlPatch || preset(round.control);
    const takes = [{ id: "control", control: true, why: round.controlWhy, patch: ctrl }].concat(round.takes);
    // shuffle: a fixed-seed LCG, index from its HIGH bits (the low bits of an LCG mod 2^32 cycle; tools/make-ab.mjs's run())
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(t, round), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R, r.info), file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const i = r.info;
      const line = m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", NaN " + m.nan + ", edges " + m.edgeS.toFixed(3) + "/" + m.edgeE.toFixed(4) +
        ", centroid " + Math.round(m.centroid) + " Hz, >4 kHz " + (100 * m.hi4k).toFixed(0) + "%, <500 Hz " + (100 * m.lo500).toFixed(0) + "%, crest " + m.crest.toFixed(1) + " dB" + (lim ? ", Limiter " + lim : "") +
        (m.fall30 != null ? ", falls 30 dB in " + m.fall30.toFixed(2) + " s" : "");
      const detail = "level per 50 ms (dB): " + m.env + "\n      centroid per 50 ms (kHz): " + m.cen + "\n      strongest peaks 30-400 ms: " + m.peaks +
        (i ? "\n      model: " + (i.pieces ? i.pieces + " pieces (median first mode " + Math.round(i.fMed) + " Hz) + " + i.children + " from re-breaks, " + i.landings.length + " landings, " + i.fizz + " micro-cracks, break at " + (i.tBreak * 1000).toFixed(1) + " ms" : "intact (no break)") +
          ", body modes " + i.bodyModes.slice(0, 6).join("/") + " Hz" + (i.beatHz ? ", warble " + i.beatHz.toFixed(2) + " Hz" : "") +
          "\n      landings per 100 ms: " + m.landings + "\n      energy targets (x the strike's first 30 ms): " + Object.entries(i.energies).map(([k, v]) => k + " " + v.toFixed(2)).join(", ") +
          "\n      render " + r.ms.toFixed(0) + " ms for " + m.sec.toFixed(2) + " s = " + (r.ms / m.sec).toFixed(0) + " ms per second of audio" : "");
      console.log("  " + file + "  " + t.id.padEnd(20) + line + "\n      " + detail);
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target"); if (!t.control && m.edgeE > 0.02) bad.push("end edge");
      if (bad.length) console.log("    !! " + bad.join(", "));
      key.push({ file, t, line, detail, lim });
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is " + (round.controlPatch ? "the best build of today's engines" : "the sound the app makes today") + ".\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" +
      "Model takes are the glass engine prototype's stereo output with the round's room (dsp.js `reverbProcess`: " + JSON.stringify(round.room) + "), no other chain; the control is rendered by the exported engine exactly as `tools/make-ab.mjs` does.\n\n" +
      key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\nMeasured: " + k.line + "\n\n```\n" + k.detail.replace(/\n\s+/g, "\n") + "\n```\n\n" +
        (k.lim ? "Note: its peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.lim + " before matching.\n\n" : "") +
        "```json\n" + JSON.stringify(k.t.control ? k.t.patch : { st: k.t.st, seed: k.t.seed }) + "\n```\n").join("\n"));
  }

  function cost() {
    const rows = [];
    for (const name of ORDER) for (const t of ROUNDS[name].takes) {
      let best = Infinity, sec = 0;
      for (let k = 0; k < 5; k++) { const { r, ms } = renderModel(t); best = Math.min(best, ms); sec = r.n / SR; }
      rows.push([name + "/" + t.id, best, sec]);
      console.log((name + "/" + t.id).padEnd(36) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    const per = rows.map((r) => r[1] / r[2]).sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }

  const README = `# Glass engine prototype: listening round

A PROTOTYPE engine, "glass" (glass and ceramics: breakables, clinks), against today's presets. Made by
\`node tools/proto/glass.mjs\` (the model, \`makeGlass\`, and this round are both in that file). Nothing in the app changed.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one sounds most like the thing, and a runner-up. **One take in each folder
is the control**: today's preset where one exists, otherwise the best build of today's engines I could make (layered,
on the Glass Shatter preset where glass is involved, since that preset beat three modal / particle builds blind in the
care pass). Then read \`KEY.md\`.

| # | folder | the sound | control |
|---|---|---|---|
| 1 | glass-shatter | Glass Shatter (a drinking glass) | Glass Shatter, as it ships |
| 2 | window-smash | a window smashed in (a GAP) | Glass Shatter lengthened + a stone's thud + a modal rain of shards |
| 3 | bottle-break | a bottle breaking (a GAP) | Glass Shatter + a modal "bonk" of thick glass + an impact hit |
| 4 | pot-smash | a clay pot / ceramic vase (a GAP) | an impact knock + a modal ceramic ring + a particle clatter |
| 5 | glass-clink | two glasses clinking | Glass Clink, as it ships |

The three model takes in each folder differ in what HAPPENED (dropped, thrown, crushed in place; a stone, a big shop
window, a punched pane; crystal, everyday glasses, flutes), not in one knob.

## What the engine is

One strike, then physics. The STRIKE's contact time (soft fist .. hard stone) sets how bright it is. The intact object
RINGS at its own modes (a vessel's shell modes in warbling pairs, a pane's plate modes, a solid's sparse ones; the
material sets how long). If it BREAKS: a train of crack snaps and a fizz of micro-cracks, the body's ring choked, and N
PIECES, each a tiny plate ringing at its own inharmonic pitch (smaller = higher and shorter), born ringing, then flying:
landing at their flight times and bouncing like balls (the gaps shrinking), the floor's hardness deciding how bright each
landing is, big pieces breaking again as they land, and settling (rocking to rest, sliding). Materials: glass, crystal,
porcelain, clay, ice.

## The room

Model takes are STEREO (pieces land across the field), so like the weather and flow rounds they get the control's own
reverb (dsp.js \`reverbProcess\`, same size, tone and wet) and no other chain; the controls are rendered whole by the
exported engine. Glass Shatter's 50 ms echo (its delay) is the control's own and is NOT added to the model takes.

## Cues that are not the question

- **Lengths:** the model takes run 0.6-2.0 s against the controls' 0.3-1.4 s (pieces need time to fall; a crystal glass
  rings). Judge the first half second too, not only the whole.
- **Glass Clink:** today's preset is 0.3 s; the wine toast rings 1.6 s. If the long ring is the only reason one wins, say so.
- **Peaks:** a break is peaky (the crack), so some takes needed the app's own Limiter to reach -18 LUFS; KEY.md says which.
`;

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  mkdirSync(OUT, { recursive: true });
  for (const n of want ? [want] : ORDER) { if (!ROUNDS[n]) { console.error("no round " + n + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(n); }
  writeFileSync(join(OUT, "README.md"), README);
  console.log("\n-> " + OUT);
}
