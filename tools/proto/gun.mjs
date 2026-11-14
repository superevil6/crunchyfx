/* gun.mjs — PROTOTYPE of a "gun" synthesis engine for CrunchySFX (gunshots built for GAME sound), and the CLI that renders
 * its blind listening round.
 *
 *   node tools/proto/gun.mjs                render every round into soundtests/proto-gun/<sound>/
 *   node tools/proto/gun.mjs full-auto      one round
 *   node tools/proto/gun.mjs --cost         only the CPU cost: each gun take rendered 5x, ms per second of audio
 *
 * WHY. The blast engine (wave 31) is a PHYSICAL model and it won its rounds, but on a gun it gives what a microphone 20 m
 * away hears: "a dull report and the facades' flutter". That is realistic, not crunchy. 26 of the 33 Guns still sit on
 * the impact engine, and a burst (Repeat > 1) re-gates ONE shot's envelope, so Full Auto, 3-Round Burst and Machine Gun
 * are the same click retriggered on a grid. A great action-game gun is not a recording either: it is DESIGNED, built
 * from layers that each do one job, pushed through saturation and a bus compressor. This engine builds that.
 *
 * THE LAYERS (one SHOT; every round of a burst is a whole new shot):
 *   SNAP       the first millisecond: a box-integrated pressure step 60-150 us wide with a negative lobe, plus a 0.35 ms
 *              noise spit, HARD CLIPPED, so it lands as a square-edged click (what makes a shot feel instant).
 *   BODY       the punch: a sine whose pitch DROPS (a kick drum's sweep, fStart -> fEnd with time constant tp) under a
 *              Friedlander muzzle pop (the pressure wave's positive phase, 0.25-1.9 ms, a hard "pop", box-integrated).
 *              Caliber sets the size: 260 -> 75 Hz and 25 ms at the small end, 110 -> 40 Hz and 135 ms at the big end.
 *   GAS        the report's roar: noise through a low-pass that FALLS as the gas cools (6-7 kHz to ~350-750 Hz), its
 *              length by caliber; the bigger the round, the more "pshhh" under the bang.
 *   CRACK      bright, mid-high, SATURATED: band-passed noise (1.4 kHz for a short barrel, 5 kHz for a long one) run
 *              through tanh at drive 4, a supersonic N-wave (120-320 us) for a long barrel, and a high sizzle (> 5 kHz)
 *              that rings a little longer. A SHORT barrel adds the BARK: three damped modes at 550-900 Hz (the boxy
 *              "pop" of a pistol or carbine), fading as the barrel lengthens.
 *   MECHANISM  the action, built from one metal-clack generator (an inharmonic modal set, ratios 1 : 1.62 : 2.31 : 2.93 :
 *              3.87, plus a noise tick) and a slide-friction noise:
 *                none        nothing
 *                slide       a semi-auto pistol: the slide unlocking under the shot and slamming home ~22 ms later
 *                revolver    the hammer falling 4 ms before, the frame ringing after (no cycling)
 *                pump        after the shot, the pump racked back ("chk") and forward ("chk"), the hull landing
 *                bolt        after the shot, the bolt lifted, drawn, pushed and locked by hand
 *                rifle auto  a closed bolt: per round, the carrier hitting its stop and returning into battery, a faint
 *                            buffer-spring twang; on the last round, an optional BOLT LOCK (the carrier caught back, empty)
 *                belt-fed    an open bolt: per round, the bolt slamming forward to fire, driven back, belt links ticking;
 *                            after the last round, the bolt caught on the sear (a heavy "chunk")
 *              plus the CASING (brass, a free tube's modes 1 : 2.76 : 5.40 : 8.93, smaller rounds higher) thrown out,
 *              landing ~0.4 s later and bouncing with the gaps shrinking (restitution 0.35-0.5); a pump's plastic hull
 *              lands dull. In a burst the casings RAIN, which is half of what makes automatic fire read.
 *   SUPPRESSOR the crack and snap go (subsonic), the gas is low-passed and shortened, the body softened, a "pfft" of
 *              band-passed gas (~750 Hz) and a baffle ring (~1.1 kHz) take their place; the mechanism stays (it is now
 *              the loudest thing after the shot).
 *   TAIL       the place, an impulse response built from geometry (as blast's): dry, outdoors (ground reflection, a
 *              slap-back off a building or treeline at 110-160 ms, a second at ~370 ms, a dark ROLLING tail), street
 *              (facade flutter every ~47 ms), room (dense early reflections, RT60 0.55 s), warehouse (early hits at
 *              10-70 ms, a 2 s metallic tail), canyon (smeared echoes at 0.45 / 0.8 / 1.15 s). The shots are convolved
 *              as ONE stream, so in a burst the tails OVERLAP and BUILD.
 * THE BALANCE. Each layer renders to its own bus and is set to a target ENERGY over the first shot's 250 ms (as glass.mjs
 * levels its components), so Snap / Punch / Crack are ratios and caliber moves the weights, not the loudness; the gains
 * then hold for every round, so the shot-to-shot variation survives. The mechanism is levelled against the shot's
 * ENERGY over its first 150 ms (never its peak, which the snap owns), so a crushed or suppressed shot cannot leave its
 * pump or slide louder than itself.
 * THE CRUNCH STAGE (gun-tuned, after the layers, in this order):
 *   SATURATION the high layers (snap + gas + crack + pfft), peak-normalized, through an asymmetric tanh (drive 1-21, a
 *              small bias for even harmonics); the BODY on its own, gentler (drive 1-6: harmonics that carry on small
 *              speakers, without squaring the thump into a held boom); both 4x oversampled the way synth.js's driveOS is,
 *              each brought back to its own energy, so Crunch changes the TEXTURE and the layers keep their balance.
 *   COMPRESSOR on the shot bus alone: threshold 6-30 dB under the peak, ratio 1.5-8, ATTACK 2.5 ms (the snap gets
 *              through, the body comes up behind it: the "hits hard" shape), release 60-120 ms. The mechanism and the
 *              casings join after it (a compressor before them lifted the casings ~13 dB), then the place.
 *   CLIP       a final soft clip whose hardness follows Crunch (the transient's top shaved, the way game guns get loud).
 *   BITS/RATE  optional retro end: 16 -> 4 bits, and a sample-and-hold rate cut 1x -> 8x (5.5 kHz), deliberately
 *              without anti-aliasing (that grit IS the point there).
 * AUTOMATIC FIRE. A rate (RPM) and a round count; each round is re-fired from scratch: its own noise, a pitch jitter
 * (+-4 % sd at Variation 1), a level jitter (+-1.2 dB sd), the crack's band moved (+-6 %), the gas and body lengths moved
 * (+-10 %), the cycle time itself varied (+-3.5 % sd, cumulative, so the rhythm breathes like a real cyclic rate), the
 * mechanism cycling on every round, the casings raining, the gas thickening a little as the barrel heats (+15 % by round
 * 20). A burst ENDS naturally: the last round's mechanism, its casing, the tail ringing out, and an optional bolt lock.
 *
 * PORTABLE SHAPE. `makeGun(sr, cfg, seed)` is a pure factory like dsp.js makeBlast / makeGlass: no DOM, no Math.random
 * (own seeded LCGs, one per shot and component, so a level knob never reshuffles anything), SR in. It renders BUFFERED
 * (the place is an FFT convolution, the same one-FFT-for-a-stereo-IR trick as dsp.js blastConvolve; `gunFFT` here is
 * dsp.js's fftInPlace verbatim, so the port calls that instead) and returns { L, R, n, info, tick(drive, out) }, blast's
 * shape. `gunCfg(st)` maps the proposed rows (GUN_PARAMS) to physics; `gunLevel(L, R)` levels a buffer (RMS 0.12 over its
 * loudest 300 ms, peak capped 0.9) like glassLevel. Anti-aliasing: the snap, the pop and the N-wave are box-integrated at
 * 16 sub-samples, every mode at or past 0.45 SR is dropped, the saturation is 4x oversampled.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

export const GUN_ACTIONS = ["none", "slide", "revolver", "pump", "bolt", "rifle auto", "belt-fed"];   // append-only
export const GUN_PLACES = ["dry", "outdoors", "street", "room", "warehouse", "canyon"];                // append-only
// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Only wave "gun" reads the
// group. Defaults: a 9 mm pistol fired once outdoors, lightly crunched.
export const GUN_PARAMS = [
  ["gunCaliber",  "Caliber",      0,  1,    0.01, 0.32, "",    "Gun"],   // .22 .. 9 mm (0.3) .. rifle (0.5) .. magnum / 12 ga (0.75-0.85) .. .50 (1)
  ["gunBarrel",   "Barrel",       0,  1,    0.01, 0.3,  "",    "Gun"],   // short and boxy (bark) .. long and cracking (N-wave, high crack)
  ["gunAction",   "Action",       0,  6,    1,    1,    "",    "Gun", "enum", GUN_ACTIONS],
  ["gunSnap",     "Snap",         0,  1,    0.01, 0.6,  "",    "Gun"],   // the clipped click of the first ms
  ["gunPunch",    "Punch",        0,  1,    0.01, 0.7,  "",    "Gun"],   // the pitch-dropping thump and the muzzle pop
  ["gunCrack",    "Crack",        0,  1,    0.01, 0.5,  "",    "Gun"],   // the bright saturated crack (+ gas roar ~ caliber)
  ["gunMech",     "Mechanism",    0,  1,    0.01, 0.4,  "",    "Gun"],
  ["gunCasing",   "Casings",      0,  1,    0.01, 0,    "",    "Gun"],
  ["gunPlace",    "Place",        0,  5,    1,    1,    "",    "Gun", "enum", GUN_PLACES],
  ["gunTail",     "Tail",         0,  1,    0.01, 0.5,  "",    "Gun"],   // the place's level and length (0.5 nominal)
  ["gunSuppress", "Suppressor",   0,  1,    0.01, 0,    "",    "Gun"],
  ["gunCrunch",   "Crunch",       0,  1,    0.01, 0.3,  "",    "Gun"],   // saturation of the shot + the final clip
  ["gunComp",     "Compression",  0,  1,    0.01, 0.5,  "",    "Gun"],
  ["gunBits",     "Bits",         0,  1,    0.01, 0,    "",    "Gun"],   // 0 clean .. 1 = 4-bit
  ["gunRateCut",  "Rate cut",     0,  1,    0.01, 0,    "",    "Gun"],   // 0 full rate .. 1 = sample-and-hold x8
  ["gunRPM",      "Fire rate",    60, 1500, 1,    700,  "rpm", "Gun"],
  ["gunRounds",   "Rounds",       1,  60,   1,    1,    "",    "Gun"],
  ["gunJitter",   "Variation",    0,  1,    0.01, 0.4,  "",    "Gun"],   // shot-to-shot pitch / level / timing spread
  ["gunBoltLock", "Empty click",  0,  1,    0.01, 0,    "",    "Gun"],   // the bolt locking back after the last round
  ["gunSeed",     "Variation seed", 0, 999, 1,    0,    "",    "Gun"],
];
export const GUN_DEFAULTS = Object.fromEntries(GUN_PARAMS.map((p) => [p[0], p[5]]));

const GUN_MECH_LEVEL = 0.9;   // the mechanism bus against a shot bus of energy GUN_E_REF over its first 150 ms
const GUN_E_REF = 0.008;      // amplitude^2 s: a typical peak-normalized, compressed shot
const GUN_PRE = 0.012;      // s before the first shot (the revolver's hammer and the open bolt's slam land in it)
const gnClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function gnRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gnGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
const gnPan = (p) => { const a = (gnClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };
// a stream's seed from (seed, shot, component): mixes so neighbouring shots are unrelated
const gnSeed = (seed, k, salt) => (Math.imul((seed + 1) >>> 0, 2654435761) ^ Math.imul(k + 7, 40503) ^ Math.imul(salt + 13, 9973)) >>> 0;

// knobs -> physics
export function gunCfg(st) {
  const g = (k) => (st[k] == null ? GUN_DEFAULTS[k] : st[k]);
  const c = gnClamp(g("gunCaliber"), 0, 1), b = gnClamp(g("gunBarrel"), 0, 1), s = gnClamp(g("gunSuppress"), 0, 1);
  return {
    "dur": st.duration || 0, "width": st.width == null ? 0.6 : st.width,
    "cal": c, "barrel": b, "action": gnClamp(Math.round(g("gunAction")), 0, GUN_ACTIONS.length - 1),
    "snap": g("gunSnap"), "punch": g("gunPunch"), "crack": g("gunCrack"), "mech": g("gunMech"), "casing": g("gunCasing"),
    "place": gnClamp(Math.round(g("gunPlace")), 0, GUN_PLACES.length - 1), "tail": g("gunTail"), "sup": s,
    "crunch": g("gunCrunch"), "comp": g("gunComp"), "bits": g("gunBits"), "rateCut": g("gunRateCut"),
    "interval": 60 / gnClamp(g("gunRPM"), 30, 3000), "rounds": Math.max(1, Math.round(g("gunRounds"))),
    "jitter": g("gunJitter"), "boltLock": g("gunBoltLock"),
    // the body (kick) and the pop
    "fStart": 260 - 150 * c, "fEnd": 75 - 35 * c, "tp": 0.006 + 0.014 * c, "tauBody": 0.025 + 0.11 * c,
    "popT": 0.00025 + 0.00165 * c,
    // the gas
    "tauGas": 0.015 + 0.06 * c, "gasHi": 6000 + 1500 * b, "gasLo": 500 + 500 * (1 - c),
    // the crack
    "crackHz": 1400 + 3600 * b, "tauCrack": 0.004 + 0.012 * b, "nwave": b > 0.45 ? (b - 0.45) / 0.55 : 0, "nT": 0.00012 + 0.0002 * c,
    "bark": Math.pow(1 - b, 1.5), "barkHz": 900 - 350 * c,
  };
}

// ---- small DSP pieces
// add a continuous waveform f(t) (t from its onset at t0 s, nonzero on [0, len)), box-integrated per sample (16 sub-samples)
function gnAddCont(buf, sr, t0, len, f, gain) {
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
// TPT state-variable filter: returns [lp, bp (unity peak), hp]
function gnSvf() { return { a: 0, b: 0 }; }
function gnSvfTick(f, x, g, k, out) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.b, v1 = a1 * f.a + a2 * v3, v2 = f.b + a2 * f.a + a3 * v3;
  f.a = 2 * v1 - f.a; f.b = 2 * v2 - f.b; out[0] = v2; out[1] = k * v1; out[2] = x - k * v1 - v2;
}
const gnG = (fc, sr) => Math.tan(Math.PI * gnClamp(fc, 5, sr * 0.45) / sr);
// damped modes into a mono buffer (or a stereo pair through pan gains): sum a_m e^{-t/tau_m} sin(2 pi f_m t)
function gnModes(L, R, pg, sr, t0, fs, amps, taus, gain, attack) {
  const i0 = Math.max(0, Math.round(t0 * sr)), n = L.length;
  for (let m = 0; m < fs.length; m++) {
    const f = fs[m]; if (!(f > 0) || f >= 0.45 * sr) continue;
    const tau = taus[m], a = amps[m] * gain, len = Math.min(n - i0, Math.ceil(7 * tau * sr)), w = 2 * Math.PI * f / sr, dk = Math.exp(-1 / (tau * sr));
    const at = Math.max(1, Math.round((attack || 0.0001) * sr));
    let e = a;
    for (let j = 0; j < len; j++) {
      const v = e * Math.sin(w * j) * (j < at ? j / at : 1); e *= dk;
      if (R) { L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1]; } else L[i0 + j] += v;
    }
  }
}
// a metal CLACK (bolt, slide, hammer): an inharmonic modal set + a noise tick, stereo-placed
const GN_CLACK_R = [1, 1.62, 2.31, 2.93, 3.87], GN_CLACK_A = [1, 0.7, 0.55, 0.4, 0.3], GN_CLACK_T = [1, 0.8, 0.6, 0.5, 0.4];
function gnClack(L, R, sr, t0, f0, tau, gain, pan, rnd) {
  if (gain <= 0 || t0 < 0) return;
  const pg = gnPan(pan);
  const fs = GN_CLACK_R.map((r) => f0 * r * (1 + 0.04 * gnGauss(rnd))), taus = GN_CLACK_T.map((x) => x * tau);
  gnModes(L, R, pg, sr, t0, fs, GN_CLACK_A, taus, gain * 0.5, 0.00008);
  // the contact tick: noise band-passed around 3 f0 (a white tick would be the brightest thing in a quiet shot)
  const i0 = Math.round(t0 * sr), len = Math.min(L.length - i0, Math.round(0.004 * sr)), dk = Math.exp(-1 / (0.0004 * sr));
  const f = gnSvf(), o = [0, 0, 0], g = gnG(Math.min(8000, 3 * f0), sr);
  let e = gain * 0.9;
  for (let j = 0; j < len; j++) { gnSvfTick(f, rnd() * 2 - 1, g, 1.2, o); const v = o[1] * e; e *= dk; L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1]; }
}
// friction of a slide / bolt travelling: band-passed noise, a raised-cosine swell over len s
function gnSlide(L, R, sr, t0, len, fc, gain, pan, rnd) {
  if (gain <= 0) return;
  const pg = gnPan(pan), i0 = Math.round(t0 * sr), N = Math.min(L.length - i0, Math.round(len * sr)), f = gnSvf(), o = [0, 0, 0], g = gnG(fc, sr);
  for (let j = 0; j < N; j++) {
    gnSvfTick(f, rnd() * 2 - 1, g, 0.9, o);
    const e = Math.sin(Math.PI * j / N), v = o[1] * e * e * gain * (0.6 + 0.4 * rnd());
    L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1];
  }
}
// a CASING thrown out and bouncing: a free tube's modes, restitution-timed bounces. hull = a shotgun's plastic hull.
function gnCasing(L, R, sr, tLand, f0, gain, pan, rnd, hull) {
  const pg = gnPan(pan);
  let v = 4.2 + 1.2 * rnd(), t = tLand, lv = gain;
  const e = 0.35 + 0.15 * rnd();
  for (let b = 0; b < 5 && t < L.length / sr - 0.01 && lv > gain * 0.03; b++) {
    if (hull) {
      gnModes(L, R, pg, sr, t, [f0, f0 * 2.3], [1, 0.4], [0.012, 0.006], lv * 0.6, 0.0002);
    } else {
      const fs = [1, 2.756, 5.404, 8.933].map((r) => f0 * r * (1 + 0.01 * gnGauss(rnd)));
      const which = rnd();   // a tumbling casing lands on its end or its side: which modes it reaches moves
      gnModes(L, R, pg, sr, t, fs, [0.6 + 0.4 * which, 1 - 0.5 * which, 0.5, 0.25], [0.06, 0.04, 0.025, 0.015], lv * 0.5, 0.00005);
    }
    gnClack(L, R, sr, t, hull ? 900 : 2600, 0.002, lv * 0.25, pan, rnd);   // the contact tick
    v *= e * (0.85 + 0.3 * rnd()); t += 2 * v / 9.81; lv *= 0.45 + 0.2 * rnd();
  }
}

// ---- the place: an impulse response from geometry (stereo), built like dsp.js blastPlaceIR
function gunPlaceIR(sr, place, tailMul, rnd) {
  if (place === 0) return null;
  const lenS = [0, 2.2, 1.6, 0.9, 2.8, 2.8][place] * tailMul, n = Math.round(lenS * sr);
  const L = new Float64Array(n), R = new Float64Array(n);
  // a darkened tap: a one-pole kernel at fc, unit DC, gain g
  const tap = (t, g, fc, ch) => {
    const i0 = Math.round(t * sr); if (i0 >= n) return;
    const a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr);
    let v = (1 - a) * g;
    for (let j = i0; j < n && Math.abs(v) > 1e-7 * Math.abs(g); j++) { if (ch !== 1) L[j] += v; if (ch !== 0) R[j] += v; v *= a; }
  };
  // a smeared echo: a cluster of taps around t
  const cluster = (t, g, fc, spread, k) => { for (let q = 0; q < k; q++) { const ch = q & 1; tap(t + (rnd() - 0.5) * spread, g * (0.5 + rnd()) / Math.sqrt(k) * 1.4, fc, ch); } };
  // a diffuse tail: noise, rising over `rise`, decaying at rt60, low-passed from fcA to fcB, scaled to ENERGY e (wet/dry)
  const tail = (t0, rise, rt60, fcA, fcB, e) => {
    const i0 = Math.round(t0 * sr), dk = Math.exp(-6.9078 / (rt60 * sr)), ri = Math.max(1, Math.round(rise * sr));
    const bl = new Float64Array(n), br = new Float64Array(n);
    let env = 1, yl = 0, yr = 0, ss = 0;
    for (let j = i0; j < n; j++) {
      const u = (j - i0) / (rt60 * sr), fc = fcB + (fcA - fcB) * Math.exp(-3 * u), a = Math.exp(-2 * Math.PI * fc / sr);
      const r = j - i0 < ri ? 0.5 - 0.5 * Math.cos(Math.PI * (j - i0) / ri) : 1;
      yl = (rnd() * 2 - 1) * (1 - a) + yl * a; yr = (rnd() * 2 - 1) * (1 - a) + yr * a;
      bl[j] = yl * env * r; br[j] = yr * env * r; ss += (bl[j] * bl[j] + br[j] * br[j]) / 2; env *= dk;
    }
    const g = Math.sqrt(e / (ss || 1));
    for (let j = i0; j < n; j++) { L[j] += bl[j] * g; R[j] += br[j] * g; }
  };
  if (place === 1) {                 // OUTDOORS: ground, a slap-back off a building / treeline, a second, a rolling tail
    tap(0.0035, 0.42, 7000, 2);
    const s1 = 0.11 + 0.05 * rnd();
    cluster(s1, 0.22, 2600, 0.012, 6); cluster(s1 + 0.004 + 0.02 * rnd(), 0.12, 2200, 0.012, 4);
    cluster(0.33 + 0.08 * rnd(), 0.10, 1400, 0.03, 8);
    tail(0.03, 0.15, 1.6 * tailMul, 2500, 450, 0.35);
  } else if (place === 2) {          // STREET: facades ~16 m apart, a flutter every ~47 ms, darker per bounce
    tap(0.0035, 0.4, 7000, 2);
    const P = 0.047 + 0.006 * rnd();
    for (let m = 1; m <= 12; m++) tap(m * P + 0.002 * (rnd() - 0.5), 0.5 * Math.pow(0.72, m), 6000 * Math.pow(0.8, m), m & 1);
    tail(0.02, 0.06, 1.2 * tailMul, 3200, 700, 0.45);
  } else if (place === 3) {          // ROOM: a dozen image sources in 2-30 ms, then a 0.55 s tail
    for (let q = 0; q < 16; q++) tap(0.002 + 0.028 * rnd(), (0.07 + 0.1 * rnd()), 4000 + 6000 * rnd(), q & 1);
    tail(0.005, 0.02, 0.55 * tailMul, 6000, 2000, 0.8);
  } else if (place === 4) {          // WAREHOUSE: early hits 10-70 ms off walls and racks, a 2 s metallic tail
    for (let q = 0; q < 12; q++) tap(0.01 + 0.06 * rnd(), 0.08 + 0.12 * rnd(), 3000 + 4000 * rnd(), q & 1);
    tail(0.02, 0.08, 2.0 * tailMul, 4000, 900, 1.2);
    const pg = [1, 1];   // sheet metal ringing under it
    gnModes(L, R, pg, sr, 0.02, [182, 263, 411, 587], [1, 0.8, 0.6, 0.4], [0.5, 0.42, 0.35, 0.25], 0.0035, 0.03);
  } else {                           // CANYON: rock walls, smeared echoes, darker per bounce, a long low tail
    tap(0.0035, 0.42, 7000, 2);
    cluster(0.45 + 0.05 * rnd(), 0.25, 2000, 0.03, 10);
    cluster(0.80 + 0.06 * rnd(), 0.15, 1300, 0.045, 10);
    cluster(1.15 + 0.08 * rnd(), 0.09, 900, 0.06, 10);
    tail(0.06, 0.4, 2.5 * tailMul, 1000, 300, 0.25);
  }
  return { L, R };
}

// dsp.js fftInPlace, verbatim (the port calls that instead)
function gunFFT(re, im, sign) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; } }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = sign * 2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + half], bi = im[i + k + half];
        const tr = cr * br - ci * bi, ti = cr * bi + ci * br;
        re[i + k] = ar + tr; im[i + k] = ai + ti; re[i + k + half] = ar - tr; im[i + k + half] = ai - ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
// mono x convolved with a stereo IR, first n samples (dsp.js blastConvolve's one-FFT trick)
function gunConvolve(x, irL, irR, n) {
  let N = 1; while (N < n + irL.length) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x.subarray(0, n)); hr.set(irL); hi.set(irR);
  gunFFT(xr, xi, -1); gunFFT(hr, hi, -1);
  for (let k = 0; k < N; k++) { const a = xr[k], b = xi[k], c = hr[k], e = hi[k]; hr[k] = a * c - b * e; hi[k] = a * e + b * c; }
  gunFFT(hr, hi, 1);
  const L = new Float64Array(n), R = new Float64Array(n), inv = 1 / N;
  for (let i = 0; i < n; i++) { L[i] = hr[i] * inv; R[i] = hi[i] * inv; }
  return { L, R };
}

// ---- ONE SHOT into the shot bus S (mono) and the mechanism bus (stereo ML/MR). k = the round's index.
function gunShot(B, ML, MR, sr, c, t0, k, last, seed) {
  const J = c.jitter, rs = gnRng(gnSeed(seed, k, 1)), sup = c.sup;
  const lvl = Math.pow(10, (J * 1.2 * gnGauss(rs) + (k === 0 ? 0.6 : 0)) / 20);
  const pm = 1 + 0.04 * J * gnGauss(rs), cm = 1 + 0.06 * J * gnGauss(rs), tm = 1 + 0.10 * J * gnGauss(rs), heat = 1 + 0.15 * Math.min(1, k / 20);
  const i0 = Math.round(t0 * sr), n = ML.length, SN = B.sn, BO = B.bo, GA = B.ga, CR = B.cr, SU = B.su;
  // SNAP: a square-edged pressure step and a noise spit, hard clipped
  const snapG = c.snap * (1 - 0.85 * sup) * lvl;
  if (snapG > 0) {
    const w = (0.00006 + 0.00009 * c.cal) * (1 + 0.1 * J * gnGauss(rs)), tmp = new Float64Array(Math.round(0.004 * sr));
    gnAddCont(tmp, sr, 0, w + 0.00025, (t) => (t < w ? 1 : -0.3), 1);
    const rn = gnRng(gnSeed(seed, k, 2)), dk = Math.exp(-1 / (0.00035 * sr));
    let e = 0.9;
    for (let j = 0; j < tmp.length; j++) { tmp[j] += (rn() * 2 - 1) * e; e *= dk; }
    for (let j = 0; j < tmp.length && i0 + j < n; j++) SN[i0 + j] += gnClamp(tmp[j] * 1.6, -0.75, 0.75) * snapG;
  }
  // BODY: a pitch-dropping sine and the muzzle pop
  const bodyG = c.punch * (1 - 0.55 * sup) * lvl * 1.1;
  if (bodyG > 0) {
    const fS = c.fStart * pm * (1 - 0.15 * sup), fE = c.fEnd * pm, tau = c.tauBody * tm * (1 - 0.4 * sup), at = Math.round(0.0004 * sr);
    const len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr));
    let ph = 0, e = bodyG;
    for (let j = 0; j < len; j++) {
      const t = j / sr, f = fE + (fS - fE) * Math.exp(-t / c.tp);
      ph += 2 * Math.PI * f / sr;
      BO[i0 + j] += Math.sin(ph) * e * (j < at ? 0.5 - 0.5 * Math.cos(Math.PI * j / at) : 1); e *= dk;
    }
    const T = c.popT * tm, bF = 1.3;
    gnAddCont(BO, sr, t0, T * 8, (t) => { const u = t / T; return (1 - u) * Math.exp(-bF * u); }, bodyG * 0.9 * (1 - 0.5 * sup));
  }
  // GAS: noise, its low-pass falling as it cools
  const gasG = (0.35 + 0.5 * c.crack) * (0.4 + 0.6 * c.cal) * (1 - 0.5 * sup) * lvl * heat;
  {
    const tau = c.tauGas * tm * (1 - 0.5 * sup), hi = c.gasHi * (1 - 0.82 * sup), lo = c.gasLo * (1 - 0.3 * sup);
    const len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr)), f = gnSvf(), o = [0, 0, 0], rn = gnRng(gnSeed(seed, k, 3));
    let e = gasG;
    for (let j = 0; j < len; j++) {
      const fc = lo + (hi - lo) * Math.exp(-j / (0.8 * tau * sr));
      gnSvfTick(f, rn() * 2 - 1, gnG(fc, sr), 1.2, o);
      GA[i0 + j] += o[0] * e * (j < 20 ? j / 20 : 1); e *= dk;
    }
  }
  // CRACK: band-passed noise through tanh, the supersonic N-wave, the sizzle; the BARK of a short barrel
  const crackG = c.crack * Math.pow(1 - sup, 3) * lvl;
  if (crackG > 0.001) {
    const fc = c.crackHz * cm, tau = c.tauCrack * tm, len = Math.min(n - i0, Math.ceil(7 * Math.max(tau, 0.04) * sr));
    const f = gnSvf(), f2 = gnSvf(), o = [0, 0, 0], o2 = [0, 0, 0], rn = gnRng(gnSeed(seed, k, 4)), g1 = gnG(fc, sr), g2 = gnG(5200, sr);
    const dk = Math.exp(-1 / (tau * sr)), tauS = 0.02 + 0.03 * c.barrel, dkS = Math.exp(-1 / (tauS * sr)), th = Math.tanh(4);
    let e = 1, eS = 0.22;
    for (let j = 0; j < len; j++) {
      const x = rn() * 2 - 1;
      gnSvfTick(f, x, g1, 0.85, o); gnSvfTick(f2, x, g2, 1.0, o2);
      CR[i0 + j] += (Math.tanh(4 * o[1] * e * 1.4) / th) * crackG * 0.9 + o2[2] * eS * crackG;
      e *= dk; eS *= dkS;
    }
    if (c.nwave > 0) { const T = c.nT; gnAddCont(CR, sr, t0, T, (t) => 1 - 2 * t / T, crackG * c.nwave * 0.9); }
  }
  const barkG = c.bark * (0.3 + 0.7 * c.crack) * (1 - 0.7 * sup) * lvl * 0.55;
  if (barkG > 0.001) { const f0 = c.barkHz * cm; gnModes(CR, null, null, sr, t0, [f0, f0 * 1.47, f0 * 2.09], [1, 0.7, 0.45], [0.011 * tm, 0.008, 0.006], barkG, 0.0002); }
  // SUPPRESSOR: the "pfft" and the baffle ring
  if (sup > 0) {
    const tau = 0.012 + 0.01 * c.cal, len = Math.min(n - i0, Math.ceil(6 * tau * sr)), f = gnSvf(), o = [0, 0, 0], rn = gnRng(gnSeed(seed, k, 5)), gg = gnG(750 * cm, sr), dk = Math.exp(-1 / (tau * sr));
    let e = sup * 0.9 * lvl;
    for (let j = 0; j < len; j++) { gnSvfTick(f, rn() * 2 - 1, gg, 1.1, o); SU[i0 + j] += o[1] * e * (j < 30 ? j / 30 : 1); e *= dk; }
    gnModes(SU, null, null, sr, t0 + 0.0005, [1100 * cm, 2650 * cm], [1, 0.35], [0.006, 0.004], sup * 0.3 * lvl, 0.0003);
  }
  // MECHANISM, per action (into the stereo mechanism bus, placed a little right of the shot)
  const rm = gnRng(gnSeed(seed, k, 6)), M = c.mech, cl = c.cal, I = c.interval, act = c.action;
  const jt = () => 1 + 0.03 * J * gnGauss(rm);
  if (M > 0) {
    if (act === 1) {                  // SLIDE
      gnClack(ML, MR, sr, t0 + 0.0012, 1900 * (1 - 0.25 * cl), 0.008, M * 0.25, 0.2, rm);
      gnSlide(ML, MR, sr, t0 + 0.003, 0.018 * jt(), 3200, M * 0.08, 0.2, rm);
      gnClack(ML, MR, sr, t0 + 0.022 * jt(), 1650 * (1 - 0.25 * cl), 0.022, M * 0.7, 0.25, rm);
    } else if (act === 2) {           // REVOLVER
      gnClack(ML, MR, sr, t0 - 0.004, 2800, 0.006, M * 0.45, 0.15, rm);
      gnModes(ML, MR, gnPan(0.1), sr, t0 + 0.001, [2350, 3720, 5100], [1, 0.6, 0.3], [0.09, 0.06, 0.04], M * 0.06, 0.0005);
    } else if (act === 3) {           // PUMP: racked after the shot (if the next round leaves time)
      const tb = t0 + 0.40 * jt();
      if (last || I > 0.8) {
        gnSlide(ML, MR, sr, tb, 0.08, 1800, M * 0.22, 0.3, rm);
        gnClack(ML, MR, sr, tb + 0.08, 640, 0.03, M * 0.65, 0.3, rm);
        gnSlide(ML, MR, sr, tb + 0.16, 0.06, 2200, M * 0.18, 0.3, rm);
        gnClack(ML, MR, sr, tb + 0.22, 820, 0.026, M * 0.7, 0.3, rm);
      }
    } else if (act === 4) {           // BOLT, worked by hand
      if (last || I > 0.9) {
        const tb = t0 + 0.42 * jt();
        gnClack(ML, MR, sr, tb, 2200, 0.01, M * 0.45, 0.3, rm);
        gnSlide(ML, MR, sr, tb + 0.03, 0.08, 2600, M * 0.2, 0.3, rm);
        gnClack(ML, MR, sr, tb + 0.11, 1100, 0.025, M * 0.75, 0.3, rm);
        gnSlide(ML, MR, sr, tb + 0.2, 0.06, 2800, M * 0.16, 0.3, rm);
        gnClack(ML, MR, sr, tb + 0.26, 1300, 0.02, M * 0.7, 0.3, rm);
        gnClack(ML, MR, sr, tb + 0.33, 1900, 0.012, M * 0.6, 0.3, rm);
      }
    } else if (act === 5) {           // RIFLE AUTO (closed bolt, carrier)
      const cyc = Math.min(I, 0.09);
      gnClack(ML, MR, sr, t0 + 0.35 * cyc * jt(), 950 * (1 - 0.25 * cl), 0.012, M * 0.4, 0.25, rm);
      gnModes(ML, MR, gnPan(0.25), sr, t0 + 0.3 * cyc, [470 * jt(), 940], [1, 0.3], [0.04, 0.02], M * 0.035, 0.004);   // buffer spring
      if (last && c.boltLock > 0) {
        gnClack(ML, MR, sr, t0 + 0.45 * cyc * jt(), 1500, 0.014, c.boltLock * M * 1.1, 0.25, rm);
        gnClack(ML, MR, sr, t0 + 0.45 * cyc + 0.012, 2600, 0.006, c.boltLock * M * 0.5, 0.25, rm);
      } else gnClack(ML, MR, sr, t0 + 0.75 * cyc * jt(), 1300 * (1 - 0.25 * cl), 0.02, M * 0.7, 0.25, rm);
    } else if (act === 6) {           // BELT-FED (open bolt)
      const cyc = Math.min(I, 0.12);
      gnClack(ML, MR, sr, t0 - 0.003, 700 * (1 - 0.25 * cl), 0.03, M * 0.6, 0.2, rm);       // slam forward (fires it)
      gnClack(ML, MR, sr, t0 + 0.4 * cyc * jt(), 620 * (1 - 0.2 * cl), 0.025, M * 0.45, 0.2, rm);   // driven back
      for (let q = 0; q < 3; q++) gnClack(ML, MR, sr, t0 + (0.5 + 0.08 * q + 0.03 * rm()) * cyc, 3400 * jt(), 0.004, M * 0.14, 0.45 + 0.1 * q, rm);   // links
      if (last) gnClack(ML, MR, sr, t0 + 0.45 * cyc + 0.01, 650 * (1 - 0.2 * cl), 0.04, M * (0.8 + 0.4 * c.boltLock), 0.2, rm);   // caught on the sear
    }
  }
  // CASING
  if (c.casing > 0 && act !== 2 && act !== 0) {
    const hull = act === 3, rc = gnRng(gnSeed(seed, k, 7));
    const tl = (hull ? t0 + 0.62 + 0.15 * rc() : t0 + 0.36 + 0.14 * rc());
    const f0 = hull ? 650 : (6800 - 3800 * cl) * (1 + 0.04 * gnGauss(rc));
    gnCasing(ML, MR, sr, tl, f0, c.casing * (hull ? 0.3 : 0.12) * (0.7 + 0.6 * rc()), 0.3 + 0.6 * (rc() - 0.3), rc, hull);
  }
}

// asymmetric tanh, 4x oversampled (synth.js driveOS's method), on a peak-normalized copy, then back to the energy the
// buffer had over [w0, w1)
function gunSaturate(x, d, bias, w0, w1) {
  const n = x.length; let pk = 0, e0 = 0, e1 = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (!(pk > 0)) return;
  for (let i = w0; i < w1; i++) e0 += x[i] * x[i];
  const tb = Math.tanh(d * bias), tn = Math.tanh(d * (1 + bias)) - tb, OS = 4;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v0 = x[i] / pk; let acc = 0;
    for (let s = 1; s <= OS; s++) { const v = prev + (v0 - prev) * s / OS; acc += Math.tanh(d * (v + bias)) - tb; }
    prev = v0; x[i] = acc / OS / tn;
  }
  for (let i = w0; i < w1; i++) e1 += x[i] * x[i];
  const g = e1 > 0 ? Math.sqrt(e0 / e1) : 0;
  for (let i = 0; i < n; i++) x[i] *= g;
}

// ---- the whole gun: n samples of stereo, seeded. Returns { L, R, n, info, tick }.
export function makeGun(sr, cfg, seed) {
  const c = cfg, J = c.jitter, rt = gnRng(gnSeed(seed, 9999, 0));
  // the shots' times: a cyclic rate that breathes (cumulative jitter)
  const times = [];
  let t = GUN_PRE + (c.action === 6 ? 0.008 : 0);
  for (let k = 0; k < c.rounds; k++) { times.push(t); t += c.interval * (1 + 0.035 * J * gnGauss(rt)); }
  const lastT = times[times.length - 1];
  const mechTail = c.action === 3 ? 1.1 : c.action === 4 ? 0.95 : 0.15;
  const tailLen = [0.15, 1.4, 1.0, 0.6, 1.8, 1.9][c.place] * (0.5 + c.tail);
  const dur = c.dur > 0 ? c.dur : lastT + Math.max(mechTail + (c.casing > 0 ? 0.9 : 0), tailLen) + 0.1;
  const n = Math.max(64, Math.round(dur * sr));
  const ML = new Float64Array(n), MR = new Float64Array(n);
  const B = { sn: new Float64Array(n), bo: new Float64Array(n), ga: new Float64Array(n), cr: new Float64Array(n), su: new Float64Array(n) };
  times.forEach((tk, k) => gunShot(B, ML, MR, sr, c, tk, k, k === times.length - 1, seed));
  // THE BALANCE: each layer's bus is set to a target ENERGY over the first shot's 250 ms (the gains then hold for every
  // round, so the shot-to-shot variation survives), so Punch / Crack / Snap are ratios and caliber moves the weights
  const sup = c.sup, cal = c.cal;
  const want = { sn: 0.10 * c.snap * c.snap * (1 - 0.85 * sup),
    bo: 1.1 * c.punch * c.punch * (0.6 + 0.8 * cal) * (1 - 0.5 * sup),
    ga: (0.5 + 0.7 * cal) * Math.pow(1 - 0.6 * sup, 2),
    cr: 1.0 * c.crack * c.crack * (1 - 0.1 * cal) * Math.pow(1 - sup, 4),
    su: 0.6 * sup * sup };
  const w0 = Math.round(times[0] * sr), w1 = Math.min(n, w0 + Math.round(0.25 * sr)), gains = {};
  const SLo = new Float64Array(n), SHi = new Float64Array(n);
  for (const k in B) {
    let e = 0; const x = B[k], dst = k === "bo" ? SLo : SHi; for (let i = w0; i < w1; i++) e += x[i] * x[i];
    gains[k] = e > 1e-20 && want[k] > 0 ? Math.sqrt(want[k] / (e / sr)) : 0;
    if (gains[k]) for (let i = 0; i < n; i++) dst[i] += x[i] * gains[k];
  }
  // SATURATION: the high bus (snap, gas, crack, pfft) at the full drive, the low body gentler (harmonics that carry on
  // small speakers, without squaring the thump into a held boom); each back to its own energy, so Crunch changes the
  // TEXTURE and the layers keep their balance
  const d = 1 + 20 * Math.pow(c.crunch, 1.5), bias = 0.15 * c.crunch;
  gunSaturate(SHi, d, bias, w0, w1);
  gunSaturate(SLo, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  const S = new Float64Array(n); for (let i = 0; i < n; i++) S[i] = SLo[i] + SHi[i];
  // COMPRESSOR on the shot bus (log domain): threshold under the peak, attack 2.5 ms, release 60-120 ms. The mechanism
  // and casings join AFTER it, so it never lifts them.
  let grMax = 0;
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(S[i]));
    for (let i = 0; i < n; i++) S[i] /= p || 1;
    if (c.comp > 0) {
      const thrDb = -(6 + 24 * c.comp), ratio = 1.5 + 6.5 * c.comp;
      const aA = Math.exp(-1 / (0.0025 * sr)), aR = Math.exp(-1 / ((0.06 + 0.06 * c.comp) * sr));
      let env = -120;
      for (let i = 0; i < n; i++) {
        const m = Math.abs(S[i]), lv = m > 1e-9 ? 20 * Math.log10(m) : -180;
        env = lv > env ? lv + (env - lv) * aA : lv + (env - lv) * aR;
        const over = env - thrDb, gr = over > 0 ? over * (1 - 1 / ratio) : 0;
        if (gr > grMax) grMax = gr;
        S[i] *= Math.pow(10, -gr / 20);
      }
      p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(S[i]));
      for (let i = 0; i < n; i++) S[i] /= p || 1;
    } }
  // the DRY gun: the shot bus + the mechanism, levelled against the shot's ENERGY over its first 150 ms (not its peak,
  // which the snap owns), so a crushed or a suppressed shot does not leave its pump or slide louder than itself
  let Es = 0; for (let i = w0; i < Math.min(n, w0 + Math.round(0.15 * sr)); i++) Es += S[i] * S[i];
  Es /= sr;
  const mg = GUN_MECH_LEVEL * Math.sqrt(Es / GUN_E_REF);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) { L[i] = S[i] + ML[i] * mg; R[i] = S[i] + MR[i] * mg; }
  // TAIL: the compressed dry gun through the place; in a burst the tails overlap and build
  const tailMul = 0.5 + c.tail, wetG = 1.2 * c.tail * (1 - 0.6 * sup);
  const ir = gunPlaceIR(sr, c.place, tailMul, gnRng(gnSeed(seed, 8888, 0)));
  if (ir && wetG > 0) {
    const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = S[i] + 0.35 * (L[i] + R[i] - 2 * S[i]) / 2;
    const wet = gunConvolve(x, ir.L, ir.R, n);
    for (let i = 0; i < n; i++) { L[i] += wet.L[i] * wetG; R[i] += wet.R[i] * wetG; }
  }
  // CLIP: peak to 1, a soft clip whose hardness follows Crunch
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    const dc = 0.5 + 3 * c.crunch, tc = Math.tanh(dc), g = p > 0 ? 1 / p : 0;
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * g * dc) / tc; R[i] = Math.tanh(R[i] * g * dc) / tc; } }
  // BITS / RATE (the retro end; aliasing on purpose)
  const ds = 1 + Math.round(7 * c.rateCut);
  if (ds > 1) { let hl = 0, hr = 0; for (let i = 0; i < n; i++) { if (i % ds === 0) { hl = L[i]; hr = R[i]; } L[i] = hl; R[i] = hr; } }
  if (c.bits > 0) { const lv = Math.pow(2, 16 - 12 * c.bits - 1); for (let i = 0; i < n; i++) { L[i] = Math.round(L[i] * lv) / lv; R[i] = Math.round(R[i] * lv) / lv; } }
  // DC (the asymmetric clip and the pop have area): 2-pole high-pass at 22 Hz; then the stereo width; a 60 ms end fade
  const hpA = Math.exp(-2 * Math.PI * 22 / sr);
  for (const B of [L, R]) { let h1 = 0, x1 = 0, h2 = 0, y1 = 0; for (let i = 0; i < n; i++) { h1 = hpA * (h1 + B[i] - x1); x1 = B[i]; h2 = hpA * (h2 + h1 - y1); y1 = h1; B[i] = h2; } }
  const w = gnClamp(c.width, 0, 1) / 0.6;
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2 * w; L[i] = m + s; R[i] = m - s; }
  const fo = Math.min(n, Math.round(0.06 * sr)); for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  const Lf = Float32Array.from(L), Rf = Float32Array.from(R);
  const lv = gunLevel(Lf, Rf, sr); for (let i = 0; i < n; i++) { Lf[i] *= lv; Rf[i] *= lv; }
  const info = { times, interval: c.interval, rounds: c.rounds, ds, grMax, gains, Es, mg, bits: c.bits > 0 ? Math.round(16 - 12 * c.bits) : 16, drive: d };
  let i = 0;
  return { L: Lf, R: Rf, n, info, tick(drive, o) { if (i < n) { o[0] = Lf[i] * drive; o[1] = Rf[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9
export function gunLevel(L, R, sr = 44100) {
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
  const SR = 44100, TARGET_LUFS = -18, OUT = join(ROOT, "soundtests", "proto-gun");
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
  // as glass.mjs / blast.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js
  // limiterProcess), the smallest amount in 0.1 steps that brings it within 0.5 dB; past 1, a second pass ("1+x")
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

  // ---- the takes. kind "control" = a shipped preset; "blast" = a wave-31 patch through the exported engine (the
  // chassis of the shipped blast presets); "gun" = this prototype.
  const blastChassis = { wave: 31, width: 0.7, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06, filterMode: 0, cutoff: 12000, reso: 0.31, drive: 0, reverb: 0, gain: 1 };
  const bl = (o) => Object.assign({}, blastChassis, o);
  const PISTOL = { gunCaliber: 0.32, gunBarrel: 0.25, gunAction: 1 }, RIFLE = { gunCaliber: 0.48, gunBarrel: 0.75, gunAction: 5 };
  const HR = { gunCrunch: 0.3, gunComp: 0.6, gunBits: 0, gunRateCut: 0, gunPlace: 1 };                  // hyper-real action game
  const MID = { gunCrunch: 0.6, gunComp: 0.7, gunBits: 0.25, gunRateCut: 0 };                           // between
  const ARC = { gunCrunch: 0.95, gunComp: 0.85, gunBits: 0.6, gunRateCut: 0.5, gunSnap: 1, gunPlace: 3 }; // crunchy / arcade
  const gun = (...o) => Object.assign({ width: 0.6 }, ...o);
  const HR_WHY = "GUN ENGINE, the HYPER-REAL ACTION-GAME point: every layer present and only lightly crunched (Crunch 0.3: snap / gas / crack driven at ~4.3, the body at ~1.8, a light final clip), the shot compressed at 0.6 (threshold 20 dB under its peak, ratio 5.4, a 2.5 ms attack: the snap gets through, the body comes up behind it), full rate, 16-bit. ";
  const MID_WHY = "GUN ENGINE, a THIRD DESIGN POINT in the middle of the bracket (blast cannot fire a burst: it re-gates one blast): Crunch 0.6 (snap / gas / crack driven at ~10, the body at ~3.3), compression 0.7, a mild bit reduction to 13 bits, full rate. ";
  const ARC_WHY = "GUN ENGINE, the CRUNCHY / ARCADE point: Crunch 0.95 (snap / gas / crack driven at ~19.5 with an asymmetric bias, the body at ~5.6, a hard final clip), compression 0.85, 9-bit, sample-and-hold at 1/5 rate (8.8 kHz, aliasing on purpose), a small room. ";
  const ROUNDS = {
    "gunshot": {
      title: "Gunshot (a pistol)", control: "Gunshot",
      controlWhy: "the CURRENT preset \"Gunshot\" exactly as it ships (the impact engine: a filtered noise hit with the 90 Hz boom layer, drive 0.3, a small reverb).",
      listen: "A pistol fired once (a 9 mm handgun) in an action game. Which one is the most SATISFYING gunshot to fire a hundred times: a shot with snap, weight and crack, that you can feel? Listen for the first instant (is it instant and hard, or soft?), the WEIGHT under it, the gun itself (a slide), and what the shot leaves behind.",
      takes: [
        { id: "blast-pistol-shot", kind: "blast", why: "BLAST ENGINE, the realistic interpretation: the shipped \"Pistol Shot\" preset exactly as it is (AJ's pick from the blast round: fired 20 m down a street, a slightly dull report and the facades' flutter).", patch: preset("Pistol Shot") },
        { id: "hyper-real", kind: "gun", why: HR_WHY + "A 9 mm pistol (Caliber 0.32: a 212 -> 64 Hz thump decaying over ~60 ms, a 0.8 ms pop), short barrel (the bark at ~790 Hz, crack band ~2.3 kHz), the slide slamming home 22 ms after the shot, the casing landing ~0.4 s later and bouncing, outdoors (a slap-back off a building at ~0.13 s, a rolling tail).",
          st: gun(PISTOL, HR, { gunSnap: 0.7, gunPunch: 0.8, gunCrack: 0.55, gunMech: 0.5, gunCasing: 0.4, gunTail: 0.55, duration: 1.3 }), seed: 11 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same pistol (Caliber 0.35), more punch and crack, the slide quieter, no casing, a small room's tail (0.3).",
          st: gun(PISTOL, ARC, { gunCaliber: 0.35, gunBarrel: 0.15, gunPunch: 0.9, gunCrack: 0.7, gunMech: 0.35, gunTail: 0.3, duration: 0.7 }), seed: 13 },
      ] },
    "shotgun": {
      title: "Shotgun", control: "Shotgun",
      controlWhy: "the CURRENT preset \"Shotgun\" exactly as it ships (the impact engine with grit and noise, a 75 Hz boom, drive 0.55, a 65 ms echo).",
      listen: "A pump shotgun fired once, then racked. Which one is the most SATISFYING shotgun: a big, wide BOOM with weight you can feel, and the gun being worked? Listen for the size of the blast, the low end, and the \"chk-chk\" after it (if there is one).",
      takes: [
        { id: "blast-shotgun", kind: "blast", why: "BLAST ENGINE, the realistic interpretation: at the shooter in the open (size 0.15, about 2.4 g of powder; Weight 3; a lot of muzzle gas, a little rumble; the ground reflection and a far echo). Blast has no pump action, so no rack. Peak control 1.1, as the shipped Sniper Rifle.",
          patch: bl({ blastSize: 0.15, blastDist: 1, blastEnv: 0, blastPulse: 3, blastShape: 1, blastRoar: 0.9, blastRumble: 0.3, blastSeed: 701, blastPeak: 1.1, duration: 1.3 }) },
        { id: "hyper-real", kind: "gun", why: HR_WHY + "A 12 gauge (Caliber 0.82: a 137 -> 46 Hz thump over ~115 ms, the biggest gas roar), medium barrel, a softer crack, then the PUMP racked back (\"chk\" at ~0.48 s) and forward (~0.62 s), the plastic hull landing dull at ~0.7 s, outdoors with a slap-back.",
          st: gun({ gunCaliber: 0.82, gunBarrel: 0.5, gunAction: 3 }, HR, { gunSnap: 0.6, gunPunch: 0.95, gunCrack: 0.4, gunMech: 0.6, gunCasing: 0.5, gunTail: 0.65, duration: 1.7 }), seed: 21 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same 12 gauge, a shorter barrel (more bark), full punch, the pump racked after it, no hull.",
          st: gun({ gunCaliber: 0.85, gunBarrel: 0.3, gunAction: 3 }, ARC, { gunPunch: 1, gunCrack: 0.5, gunMech: 0.55, gunTail: 0.35, duration: 1.1 }), seed: 23 },
      ] },
    "rifle-crack": {
      title: "Rifle Crack (an assault rifle, single shot)", control: "Rifle Crack",
      controlWhy: "the CURRENT preset \"Rifle Crack\" exactly as it ships (the impact engine, bright, a 75 Hz boom, drive 0.35, an 80 ms echo).",
      listen: "An assault rifle fired once. Which one is the most SATISFYING rifle shot: a sharp, CRACKING shot with weight, more cutting than a pistol? Listen for the crack (bright, hard), the thump under it, the rifle's own mechanism, and the space around it.",
      takes: [
        { id: "blast-rifle", kind: "blast", why: "BLAST ENGINE, the realistic interpretation: at the shooter in the open (size 0.15, Weight 2), the bullet's supersonic crack on the muzzle blast, the semi-auto mechanism cycling, the casing landing, the ground reflection and a far echo. Peak control 1.1.",
          patch: bl({ blastSize: 0.15, blastDist: 1, blastEnv: 0, blastPulse: 2, blastShape: 1.3, blastRoar: 0.6, blastRumble: 0.1, blastCrack: 0.7, blastAction: 0.4, blastActionType: 1, blastCasing: 0.3, blastSeed: 711, blastPeak: 1.1, duration: 1.4 }) },
        { id: "hyper-real", kind: "gun", why: HR_WHY + "A 5.56 rifle (Caliber 0.48: a 188 -> 58 Hz thump over ~78 ms), a long barrel (crack band ~4.1 kHz, a supersonic N-wave, little bark), the carrier hitting its stop and returning into battery, the buffer spring, the casing bouncing at ~0.45 s, outdoors with a slap-back.",
          st: gun(RIFLE, HR, { gunSnap: 0.65, gunPunch: 0.85, gunCrack: 0.85, gunMech: 0.45, gunCasing: 0.35, gunTail: 0.6, duration: 1.4 }), seed: 31 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same rifle, full crack, slightly shorter barrel, the mechanism quieter, no casing.",
          st: gun(RIFLE, ARC, { gunBarrel: 0.6, gunPunch: 0.85, gunCrack: 1, gunMech: 0.3, gunTail: 0.25, duration: 0.7 }), seed: 33 },
      ] },
    "magnum-shot": {
      title: "Magnum Shot", control: "Magnum Shot",
      controlWhy: "the CURRENT preset \"Magnum Shot\" exactly as it ships (the impact engine with noise, a 66 Hz boom with the deepest drop, drive 0.45).",
      listen: "A big-bore revolver (a magnum hand cannon) fired once. Which one is the most SATISFYING magnum: HUGE for a handgun, a boom with a hard edge, heavy enough to hurt? Listen for the size and the low end, how hard the front edge is, and the gun (a revolver's hammer, not a slide).",
      takes: [
        { id: "blast-magnum", kind: "blast", why: "BLAST ENGINE, the realistic interpretation: at the shooter in the open (size 0.08, Weight 3, a lot of gas, some rumble, a little crack; blast has no revolver action, so no hammer). Peak control 1.1.",
          patch: bl({ blastSize: 0.08, blastDist: 1, blastEnv: 0, blastPulse: 3, blastShape: 1.3, blastRoar: 0.75, blastRumble: 0.2, blastCrack: 0.4, blastSeed: 721, blastPeak: 1.1, duration: 1.3 }) },
        { id: "hyper-real", kind: "gun", why: HR_WHY + "A .44 magnum revolver (Caliber 0.72: a 152 -> 50 Hz thump over ~104 ms, a 1.4 ms pop, a big gas roar), the snap and crack pushed for a hard front edge, a shortish barrel (bark at ~650 Hz), the hammer falling 4 ms before the shot, the frame ringing faintly, outdoors with a slap-back. No casing (a revolver keeps its brass).",
          st: gun({ gunCaliber: 0.72, gunBarrel: 0.35, gunAction: 2 }, HR, { gunSnap: 1, gunPunch: 1, gunCrack: 0.75, gunMech: 0.4, gunTail: 0.7, duration: 1.6 }), seed: 41 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same magnum (Caliber 0.75), a shorter barrel, full punch, a STREET's flutter tail instead of the room (0.35).",
          st: gun({ gunCaliber: 0.75, gunBarrel: 0.25, gunAction: 2 }, ARC, { gunPunch: 1, gunCrack: 0.75, gunMech: 0.4, gunPlace: 2, gunTail: 0.35, gunComp: 0.9, gunBits: 0.7, duration: 0.9 }), seed: 43 },
      ] },
    "suppressed": {
      title: "Suppressed", control: "Suppressed",
      controlWhy: "the CURRENT preset \"Suppressed\" exactly as it ships (the impact engine, soft, low-passed at 3.5 kHz, a 90 Hz boom).",
      listen: "A pistol with a suppressor (a silencer) fired once, in a stealth game. Which one is the most SATISFYING suppressed shot: quiet and tight, but still clearly a GUN with weight, not a cough or a click? Listen for the \"pfft\" of the shot, whether you can hear the gun's mechanism, and whether it still feels like it hits.",
      takes: [
        { id: "blast-filtered", kind: "blast", why: "BLAST ENGINE, the realistic interpretation as far as it reaches: blast has NO suppressor, so this is a tiny charge at the shooter indoors (size 0.02, Weight 1, little gas, the semi-auto mechanism loud, the casing) through the chain's low-pass at 1.8 kHz standing in for the can. Peak control 0.6.",
          patch: bl({ blastSize: 0.02, blastDist: 1, blastEnv: 2, blastRoom: 0.5, blastPulse: 1, blastShape: 1.5, blastRoar: 0.25, blastRumble: 0, blastAction: 0.8, blastActionType: 1, blastCasing: 0.4, blastSeed: 731, blastPeak: 0.6, cutoff: 1800, duration: 0.9 }) },
        { id: "hyper-real", kind: "gun", why: HR_WHY + "The 9 mm pistol with a can (Suppressor 0.9: subsonic, so no crack and almost no snap; the gas low-passed from ~1.7 kHz down to ~600 Hz and shortened, the body softened, a 750 Hz \"pfft\" and a 1.1 kHz baffle ring), the slide now the loudest thing after the shot, the casing bouncing, a small room (0.25).",
          st: gun(PISTOL, HR, { gunSuppress: 0.9, gunSnap: 0.5, gunPunch: 0.7, gunCrack: 0.3, gunMech: 0.85, gunCasing: 0.45, gunPlace: 3, gunTail: 0.25, duration: 0.95 }), seed: 51 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same suppressed pistol (Suppressor 0.75: a touch of snap left), the slide at 0.5, DRY (no place: the spy-game \"thwip\").",
          st: gun(PISTOL, ARC, { gunSuppress: 0.75, gunPunch: 0.8, gunCrack: 0.4, gunMech: 0.5, gunPlace: 0, gunTail: 0, duration: 0.5 }), seed: 53 },
      ] },
    "full-auto": {
      title: "Full Auto (an assault rifle)", control: "Full Auto",
      controlWhy: "the CURRENT preset \"Full Auto\" exactly as it ships (the impact engine, Repeat 12 at 14 a second: ONE shot's envelope re-gated on a fixed grid, 840 rounds a minute).",
      listen: "An assault rifle on full auto, a short burst (about a second of fire). Which one is the most SATISFYING automatic fire: a stream of real, heavy SHOTS (each one its own), the gun cycling, the casings raining, the sound building and then ringing out when the trigger is let go? Listen for whether the shots sound like one sample repeated or like a gun firing, for the rhythm, and for the end.",
      takes: [
        { id: "hyper-real", kind: "gun", why: HR_WHY + "The 5.56 rifle at 780 rounds a minute (77 ms), 14 rounds, Variation 0.5 (each round its own pitch, level, crack band and cycle time), the carrier cycling on every round, the casings raining from ~0.4 s, outdoors: the slap-backs and the rolling tail overlap and build, then ring out.",
          st: gun(RIFLE, HR, { gunRPM: 780, gunRounds: 14, gunJitter: 0.5, gunSnap: 0.6, gunPunch: 0.8, gunCrack: 0.8, gunMech: 0.4, gunCasing: 0.35, gunTail: 0.6 }), seed: 61 },
        { id: "mid-indoors-runs-dry", kind: "gun", why: MID_WHY + "The same rifle at 820 a minute, 18 rounds (the magazine runs dry), Variation 0.6, in a WAREHOUSE (early hits off walls and racks, a 2 s metallic tail building under the burst), ending on the BOLT LOCK (Empty click 0.8: the carrier caught back, a click-clack).",
          st: gun(RIFLE, MID, { gunRPM: 820, gunRounds: 18, gunJitter: 0.6, gunSnap: 0.7, gunPunch: 0.75, gunCrack: 0.8, gunMech: 0.45, gunCasing: 0.3, gunPlace: 4, gunTail: 0.5, gunBoltLock: 0.8 }), seed: 63 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same rifle at 780 a minute, 14 rounds, Variation 0.35, the mechanism quieter, no casings.",
          st: gun(RIFLE, ARC, { gunRPM: 780, gunRounds: 14, gunJitter: 0.35, gunPunch: 0.85, gunCrack: 0.95, gunMech: 0.3, gunTail: 0.3 }), seed: 67 },
      ] },
    "3-round-burst": {
      title: "3-Round Burst", control: "3-Round Burst",
      controlWhy: "the CURRENT preset \"3-Round Burst\" exactly as it ships (the impact engine, Repeat 3 at 16 a second: one shot's envelope re-gated three times, 960 rounds a minute).",
      listen: "A rifle in burst mode: one trigger pull, three fast shots. Which one is the most SATISFYING burst: three real, hard shots (each one its own) in a tight rhythm, with weight, that you want to fire again? Listen for whether the three are the same sound repeated or three shots, and for the end of the burst.",
      takes: [
        { id: "hyper-real", kind: "gun", why: HR_WHY + "The 5.56 rifle at 900 rounds a minute (67 ms), 3 rounds, Variation 0.5, the carrier cycling on each, three casings, outdoors with a slap-back.",
          st: gun(RIFLE, HR, { gunRPM: 900, gunRounds: 3, gunJitter: 0.5, gunSnap: 0.65, gunPunch: 0.85, gunCrack: 0.85, gunMech: 0.45, gunCasing: 0.35, gunTail: 0.6 }), seed: 71 },
        { id: "mid-street", kind: "gun", why: MID_WHY + "The same burst (900 a minute, 3 rounds, Variation 0.5) fired down a STREET (the facades' flutter after each shot, overlapping).",
          st: gun(RIFLE, MID, { gunRPM: 900, gunRounds: 3, gunJitter: 0.5, gunSnap: 0.7, gunPunch: 0.8, gunCrack: 0.85, gunMech: 0.4, gunCasing: 0.3, gunPlace: 2, gunTail: 0.5 }), seed: 73 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same burst (900 a minute, 3 rounds, Variation 0.35), the mechanism quieter, no casings.",
          st: gun(RIFLE, ARC, { gunRPM: 900, gunRounds: 3, gunJitter: 0.35, gunPunch: 0.85, gunCrack: 0.95, gunMech: 0.3, gunTail: 0.3, duration: 0.8 }), seed: 77 },
      ] },
    "machine-gun": {
      title: "Machine Gun (heavy, belt-fed)", control: "Machine Gun",
      controlWhy: "the CURRENT preset \"Machine Gun\" exactly as it ships (the impact engine, Repeat 12 at 12 a second: one shot's envelope re-gated on a fixed grid, 720 rounds a minute).",
      listen: "A heavy belt-fed machine gun: a slower, bigger, more deliberate stream of fire than an assault rifle. Which one is the most SATISFYING machine gun: HEAVY shots, each one its own, a pounding rhythm, the gun working, the burst building and ringing out? Listen for the weight of each round, the rhythm, and the end.",
      takes: [
        { id: "hyper-real", kind: "gun", why: HR_WHY + "A 7.62 belt-fed (Caliber 0.75: a 148 -> 49 Hz thump over ~108 ms), long barrel, 560 rounds a minute (107 ms), 10 rounds, Variation 0.5, the OPEN BOLT slamming forward to fire each round and driven back, belt links ticking, the bolt caught on the sear after the last (a heavy \"chunk\"), casings raining, outdoors.",
          st: gun({ gunCaliber: 0.75, gunBarrel: 0.8, gunAction: 6 }, HR, { gunRPM: 560, gunRounds: 10, gunJitter: 0.5, gunSnap: 0.6, gunPunch: 0.95, gunCrack: 0.8, gunMech: 0.55, gunCasing: 0.45, gunTail: 0.7 }), seed: 81 },
        { id: "mid-fifty-cal", kind: "gun", why: MID_WHY + "The HEAVIEST: a .50 on a mount (Caliber 1: a 110 -> 40 Hz thump over ~135 ms, a 1.9 ms pop, the longest gas), 480 rounds a minute (125 ms), 8 rounds, Variation 0.55, the open bolt and the sear's chunk, outdoors with a long tail (0.75).",
          st: gun({ gunCaliber: 1, gunBarrel: 0.85, gunAction: 6 }, MID, { gunPlace: 1, gunRPM: 480, gunRounds: 8, gunJitter: 0.55, gunSnap: 0.65, gunPunch: 1, gunCrack: 0.75, gunMech: 0.55, gunCasing: 0.35, gunTail: 0.75 }), seed: 83 },
        { id: "crunchy-arcade", kind: "gun", why: ARC_WHY + "The same 7.62 belt-fed at 560 a minute, 10 rounds, Variation 0.35, the mechanism at 0.4, no casings.",
          st: gun({ gunCaliber: 0.75, gunBarrel: 0.8, gunAction: 6 }, ARC, { gunRPM: 560, gunRounds: 10, gunJitter: 0.35, gunPunch: 1, gunCrack: 0.9, gunMech: 0.4, gunTail: 0.3 }), seed: 87 },
      ] },
  };
  const ORDER = ["gunshot", "shotgun", "rifle-crack", "magnum-shot", "suppressed", "full-auto", "3-round-burst", "machine-gun"];

  function renderGun(t) {
    const st = Object.assign({}, GUN_DEFAULTS, t.st), cfg = gunCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeGun(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms };
  }
  function renderTake(t) {
    if (t.kind !== "gun") {
      const o = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
      return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), info: null };
    }
    const { r, cfg, ms } = renderGun(t);
    return { L: r.L, R: r.R, info: r.info, cfg, ms };
  }

  // ---- measurement (we cannot listen)
  function fft(re, im) { gunFFT(re, im, -1); }
  // RECTANGULAR on purpose: these are energy shares (Parseval) of a zero-padded stretch; a Hann window over the whole
  // file would weight its middle and all but drop a shot that sits at its start
  function spectrum(x, a, N, len) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < Math.min(N, len) && a + i < x.length; i++) re[i] = x[a + i];
    fft(re, im); const p = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p;
  }
  function bandShare(x, a, len, f0, f1) {
    let N = 1; while (N < len) N <<= 1;
    const p = spectrum(x, a, N, len); let all = 0, b = 0, num = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; all += p[k]; num += f * p[k]; if (f >= f0 && f < f1) b += p[k]; }
    return { share: b / (all || 1), centroid: num / (all || 1) };
  }
  function measure(L, R, times) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan };
    const whole = bandShare(mono, 0, n, 0, 150); m.centroid = whole.centroid; m.lo150 = whole.share;
    // crest: peak over the RMS of the loudest 400 ms
    const B = Math.min(n, Math.floor(0.4 * SR)); let best = 0;
    for (let a = 0; a + B <= n; a += Math.floor(0.01 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += mono[i] * mono[i]; best = Math.max(best, s / B); }
    m.crest = 20 * Math.log10(pk / Math.sqrt(best || 1e-20));
    // onset and attack: first sample above 10 % of the first shot's peak -> that peak (within 30 ms)
    let mx0 = 0; for (let i = 0; i < Math.min(n, 0.06 * SR); i++) mx0 = Math.max(mx0, Math.abs(mono[i]));
    const i10 = mono.findIndex((v) => Math.abs(v) > 0.1 * mx0);
    let ip = i10, pv = 0; for (let i = i10; i < Math.min(n, i10 + 0.03 * SR); i++) if (Math.abs(mono[i]) > pv) { pv = Math.abs(mono[i]); ip = i; }
    m.attackMs = (ip - i10) / SR * 1000;
    const first = bandShare(mono, Math.max(0, i10), Math.round(0.15 * SR), 0, 150); m.lo150first = first.share;
    // 10 ms of the onset: how much of the first 150 ms' energy lands in the first 5 ms (the "snap share")
    let e5 = 0, e150 = 0; for (let i = i10; i < Math.min(n, i10 + 0.15 * SR); i++) { const v = mono[i] * mono[i]; e150 += v; if (i < i10 + 0.005 * SR) e5 += v; }
    m.snap5 = e5 / (e150 || 1);
    const W = Math.round(0.05 * SR), lv = [];
    for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += mono[i] * mono[i]; lv.push(s / W); }
    const mxl = Math.max(...lv); m.env = lv.map((v) => Math.round(10 * Math.log10(v / mxl + 1e-12))).join(" ");
    // edges: the first and last 2 ms against the peak (a click where the buffer starts or ends)
    const e2 = Math.floor(0.002 * SR); let eS = 0, eE = 0;
    for (let i = 0; i < e2; i++) { eS = Math.max(eS, Math.abs(mono[i])); eE = Math.max(eE, Math.abs(mono[n - 1 - i])); }
    m.edgeS = eS / (pk || 1); m.edgeE = eE / (pk || 1);
    // shots, at their KNOWN times (the model's own, or Repeat's grid for a control): intervals, shot-peak spread,
    // consecutive-shot similarity (20 ms windows from each onset)
    const on = (times || []).map((t) => Math.round(t * SR)); m.shots = on.length;
    if (on.length > 1) {
      const iv = on.slice(1).map((x, i) => (x - on[i]) / SR * 1000), mean = iv.reduce((a, b) => a + b, 0) / iv.length;
      const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) * (b - mean), 0) / iv.length);
      m.ivMean = mean; m.ivSd = sd; m.ivMin = Math.min(...iv); m.ivMax = Math.max(...iv);
      const pks = on.map((o) => { let p = 0; for (let i = o; i < Math.min(n, o + 0.005 * SR); i++) p = Math.max(p, Math.abs(mono[i])); return 20 * Math.log10(p || 1e-9); });
      const pm = pks.reduce((a, b) => a + b, 0) / pks.length; m.pkSd = Math.sqrt(pks.reduce((a, b) => a + (b - pm) * (b - pm), 0) / pks.length);
      const Wn = Math.round(0.02 * SR), cs = [];
      for (let q = 0; q + 1 < on.length; q++) {
        // best normalized correlation within +-1 ms (an onset frame is 1 ms coarse)
        let bestC = -1;
        for (let lag = -44; lag <= 44; lag += 2) {
          let ab = 0, aa = 0, bb = 0;
          for (let i = 0; i < Wn; i++) { const x = mono[on[q] + i] || 0, z = mono[on[q + 1] + i + lag] || 0; ab += x * z; aa += x * x; bb += z * z; }
          bestC = Math.max(bestC, ab / Math.sqrt(aa * bb || 1));
        }
        cs.push(bestC);
      }
      m.sim = cs.reduce((a, b) => a + b, 0) / cs.length;
      // the end: from the last onset to -40 dB of the loudest 50 ms
      const last = on[on.length - 1]; let e = n - 1;
      for (let i = n - 1; i > last; i--) if (Math.abs(mono[i]) > pk * 0.01) { e = i; break; }
      m.ringOut = (e - last) / SR;
    }
    return m;
  }
  // a control's shot times: synth.js fires shot k of a Repeat burst at k / rate
  const controlTimes = (patch) => { const rep = Math.max(1, Math.round(patch.repeat || 1)); const out = []; for (let k = 0; k < rep && rep > 1; k++) out.push(k / patch.rate); return out; };
  const fmt = (m, lim) => m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", NaN " + m.nan +
    ", crest " + m.crest.toFixed(1) + " dB, attack " + m.attackMs.toFixed(2) + " ms, snap share (first 5 ms of 150) " + (100 * m.snap5).toFixed(0) + "%" +
    ", edges " + m.edgeS.toFixed(3) + "/" + m.edgeE.toFixed(4) + ", <150 Hz " + (100 * m.lo150).toFixed(0) + "% (first 150 ms " + (100 * m.lo150first).toFixed(0) + "%), centroid " + Math.round(m.centroid) + " Hz" +
    (lim ? ", Limiter " + lim : "");
  const fmtShots = (m) => m.shots > 1 ? "shots " + m.shots + ", interval " + m.ivMean.toFixed(1) + " ms (sd " + m.ivSd.toFixed(1) + ", " + m.ivMin.toFixed(0) + "-" + m.ivMax.toFixed(0) + "), shot-peak spread sd " + m.pkSd.toFixed(2) + " dB, consecutive-shot similarity " + m.sim.toFixed(3) + " (1 = identical), last shot to -40 dB " + m.ringOut.toFixed(2) + " s" : "single shot";

  function run(name) {
    const round = ROUNDS[name];
    const takes = [{ id: "control", kind: "control", why: round.controlWhy, patch: preset(round.control) }].concat(round.takes);
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(t), tm = r.info ? r.info.times : controlTimes(t.patch), m0 = measure(r.L, r.R, tm), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R, tm), file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const line = fmt(m, lim), raw = "before matching: crest " + m0.crest.toFixed(1) + " dB, peak/LUFS as rendered " + m0.peak.toFixed(3) + " / " + m0.lufs.toFixed(1);
      const detail = "level per 50 ms (dB): " + m.env + "\n" + fmtShots(m) + "\n" + raw +
        (r.info ? "\nmodel: " + r.info.rounds + " round(s), nominal interval " + (r.info.interval * 1000).toFixed(1) + " ms, actual " + (r.info.times.length > 1 ? r.info.times.slice(1).map((x, i) => ((x - r.info.times[i]) * 1000).toFixed(0)).join("/") + " ms" : "-") +
          ", shot drive " + r.info.drive.toFixed(1) + ", compressor max " + r.info.grMax.toFixed(1) + " dB of reduction, " + r.info.bits + "-bit, rate /" + r.info.ds + "\nrender " + r.ms.toFixed(0) + " ms for " + m.sec.toFixed(2) + " s = " + (r.ms / m.sec).toFixed(0) + " ms per second of audio" : "");
      console.log("  " + file + "  " + t.id.padEnd(22) + line + "\n      " + detail.replace(/\n/g, "\n      "));
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target"); if (t.kind === "gun" && (m.edgeS > 0.02 || m.edgeE > 0.02)) bad.push("edge");
      if (bad.length) console.log("    !! " + bad.join(", "));
      key.push({ file, t, line, detail, lim });
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is the sound the app makes today.\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. If one is the right IDEA but too much or too little of something (crunch, weight, tail, mechanism), say that too: those are knobs. `KEY.md` says what each one is: **read it after listening.**\n");
    const blastNote = round.takes.some((t) => t.kind === "blast") ? "" :
      "**No blast take in this round:** the blast engine cannot fire a burst (Repeat > 1 re-gates the one blast instead of firing again, SOUND-REVIEW.md), so the slot that would have held the realistic interpretation holds the gun engine at a THIRD design point, between the other two.\n\n";
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" + blastNote +
      "Gun-engine takes are the prototype's stereo output (its own place, crunch stage and level; no other chain). The control and any blast take are rendered by the exported engine (`synth-export/crunchysfx-synth.js`) exactly as `tools/make-ab.mjs` does, Normalize on.\n\n" +
      "Measurement legend: crest = peak over the loudest 400 ms; attack = first sample over 10 % of the first shot's peak to that peak; snap share = energy in the first 5 ms of the first 150 ms; <150 Hz = the low-end share of the energy; edges = the first / last 2 ms against the peak (a click at the buffer's ends); shots are measured at their KNOWN times (the model's own, or Repeat's k / rate grid for a control): interval mean and spread, the spread of the shot peaks, and the consecutive-shot similarity = the best normalized correlation of 20 ms after each onset with the next, within +-1 ms (1.000 = the same sound re-gated).\n\n" +
      key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\nMeasured: " + k.line + "\n\n```\n" + k.detail + "\n```\n\n" +
        (k.lim ? "Note: its peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.lim + " before matching.\n\n" : "") +
        "```json\n" + JSON.stringify(k.t.kind === "gun" ? { st: k.t.st, seed: k.t.seed } : k.t.patch) + "\n```\n").join("\n"));
  }

  function cost() {
    const per = [];
    for (const name of ORDER) for (const t of ROUNDS[name].takes) {
      if (t.kind !== "gun") continue;
      let best = Infinity, sec = 0;
      for (let k = 0; k < 5; k++) { const { r, ms } = renderGun(t); best = Math.min(best, ms); sec = r.n / SR; }
      per.push(best / sec);
      console.log((name + "/" + t.id).padEnd(40) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    per.sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }

  const README = `# Gun engine prototype: listening round

A PROTOTYPE engine, "gun" (gunshots DESIGNED for game sound: hyper-real, not documentary), against today's presets. Made by
\`node tools/proto/gun.mjs\` (the model, \`makeGun\`, and this round are both in that file). Nothing in the app changed.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one is the most SATISFYING gun, and a runner-up. **One take in each folder
is today's preset.** Then read \`KEY.md\`.

| # | folder | the sound | control (today's preset) | the other three |
|---|---|---|---|---|
| 1 | gunshot | a pistol, one shot | Gunshot (impact) | blast (the shipped Pistol Shot), gun hyper-real, gun crunchy/arcade |
| 2 | shotgun | a pump shotgun, one shot + rack | Shotgun (impact) | blast, gun hyper-real, gun crunchy/arcade |
| 3 | rifle-crack | an assault rifle, one shot | Rifle Crack (impact) | blast, gun hyper-real, gun crunchy/arcade |
| 4 | magnum-shot | a magnum revolver, one shot | Magnum Shot (impact) | blast, gun hyper-real, gun crunchy/arcade |
| 5 | suppressed | a suppressed pistol | Suppressed (impact) | blast (no suppressor: low-passed), gun hyper-real, gun crunchy/arcade |
| 6 | full-auto | an assault rifle, ~1 s of fire | Full Auto (impact, Repeat 12) | gun hyper-real, gun MIDDLE (indoors, runs dry), gun crunchy/arcade |
| 7 | 3-round-burst | a rifle, a 3-round burst | 3-Round Burst (impact, Repeat 3) | gun hyper-real, gun MIDDLE (a street), gun crunchy/arcade |
| 8 | machine-gun | a heavy belt-fed MG | Machine Gun (impact, Repeat 12) | gun hyper-real, gun MIDDLE (a .50 on a mount), gun crunchy/arcade |

Every round BRACKETS the range: realistic (blast) or a middle point -> hyper-real action game -> crunchy / arcade. The
blast engine cannot fire a burst (it re-gates one blast), so rounds 6-8 put the gun engine at a third, middle design
point in that slot instead; their KEY.md says so.

## What the engine is

Each shot is built from the layers a game gun is designed from: a hard, clipped SNAP in the first millisecond; the BODY
(a pitch-dropping thump and the muzzle pop, sized by caliber); the GAS roar (noise whose low-pass falls as it cools); the
CRACK (bright band-passed noise through saturation, a supersonic N-wave on a long barrel, the boxy BARK on a short one);
the MECHANISM per action (slide, revolver hammer, pump, bolt, an assault rifle's carrier, a belt-fed's open bolt and
links); the CASINGS bouncing; and the PLACE (dry, outdoors with slap-back and a rolling tail, street flutter, room,
warehouse, canyon). Then a gun-tuned CRUNCH stage: the shot bus saturated (asymmetric, oversampled), a bus compressor
whose 2.5 ms attack lets the snap through and pulls the body and tail up behind it, a final soft clip, and optional bit
and rate reduction for the retro end. Automatic fire re-fires the WHOLE shot every round: its own noise, pitch, level,
crack band and cycle time, the mechanism cycling, casings raining, tails overlapping and building, a natural end (the
last tail, the bolt caught or locked back).

## Cues that are not the question

- **Lengths:** the gun takes carry their mechanism and tail (a pump racked, a bolt worked, casings landing, an outdoor
  rolling tail): up to ~2.5 s against the controls' 0.3-1.2 s. Judge the shot itself too, not only the whole.
- **Peaks:** a shot is nearly all spike; takes that needed the app's own Limiter to reach -18 LUFS say so in KEY.md
  (the gun engine's own compressor and clip mean its takes mostly do not).
- **Bursts:** the round count differs a little between takes (14 / 18 / 14 in Full Auto: the middle one runs the
  magazine dry on purpose). Judge the KIND of fire, not the count.
`;

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  mkdirSync(OUT, { recursive: true });
  for (const n of want ? [want] : ORDER) { if (!ROUNDS[n]) { console.error("no round " + n + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(n); }
  writeFileSync(join(OUT, "README.md"), README);
  console.log("\n-> " + OUT);
}
