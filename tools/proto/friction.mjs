/* friction.mjs — PROTOTYPE of a "friction" synthesis engine for CrunchySFX: stick-slip on a resonant body.
 *
 *   node tools/proto/friction.mjs            renders the listening round into soundtests/proto-friction/
 *   node tools/proto/friction.mjs probe      prints slip rate and pitch against the speed knob, per body
 *
 * A creak is a surface CATCHING and RELEASING. A contact point is dragged along a surface at a slowly varying speed
 * under a normal pressure. While it grips (static friction), the contact spring loads; when the load passes
 * pressure x static friction it slips, the friction drops (the Stribeck curve: kinetic friction falls with sliding
 * speed), the stored load snaps into the body, and the contact re-grips. Slow and heavy: a train of separate ticks
 * whose RATE follows the speed (a door's "crk-crk-crk"). Faster: the ticks run together into a buzz whose rate is the
 * pitch (the groan). On a stiff, ringing body the slips LOCK to a body mode, as a bow's slips lock to a string, and it
 * squeals at that mode whatever the speed. The BODY (wood panel, iron, a rubber cavity) is a modal bank the contact
 * is coupled to TWO WAYS: the body's own motion at the contact enters the friction law, which is what lets it lock.
 *
 * The same physics as dsp.js's bowed string (makeBowed / bowFriction): a velocity-dependent friction curve whose
 * negative slope is the energy source. There the string is a waveguide; here the "string" is a modal bank plus a
 * compliant contact spring, solved as an exact stick/slip switch (the sticking force is the one that keeps the
 * contact moving with the surface, capped by pressure x static friction).
 *
 * PORTABLE SHAPE, as dsp.js writes makeBowed: makeFriction(sr, cfg, seed) -> { tick(speed, pressure) -> one sample }.
 * Pure: no DOM, no Math.random (a seeded LCG), anti-aliased by running the contact at 4x and decimating through a
 * windowed-sinc FIR (the stick/slip switch is a discontinuity in force), and every body mode past 0.45 SR dropped.
 * frictionCfg(st) maps the proposed PARAMS rows to a cfg. renderFriction(sr, cfg, push, seed) is the offline shape.
 */

// ---------- the bodies: what the slips ring (index = the proposed `fricBody` knob, append-only) ----------
// Each entry builds a mode list from the body's base frequency `f0` (the size knob). Per mode: frequency, T60
// (seconds to -60 dB), `g` (how compliant the body is AT THE CONTACT relative to the contact spring — what decides
// whether the slips lock to it), `rad` (how much of its motion is heard).
export const FRICTION_BODIES = [
  // WOOD: a panel. Dense, low-Q, highs die fast; slips lock to nothing, so the rate follows the speed. A door, a floor.
  { name: "wood", contact: { zeta: 0.06, rad: 0.05 }, modes(f0, rnd) {
    const m = [];
    for (let k = 0; k < 16; k++) {
      const f = f0 * (1 + 0.85 * Math.pow(k, 1.25)) * (1 + 0.07 * (rnd() * 2 - 1));
      m.push({ f, t60: 0.11 * Math.pow(f0 / f, 0.55) * Math.pow(220 / f0, 0.3), g: 0.04 * Math.pow(f0 / f, 0.5), rad: Math.pow(f0 / f, 0.25) * (0.6 + 0.4 * rnd()) * (k & 1 ? -1 : 1) });
    }
    return m;
  } },
  // IRON: a hinge, a bar, a gate. Sparse inharmonic free-bar modes, long ring. The first modes are compliant at the
  // contact, so a fast push LOCKS onto one and squeals.
  { name: "iron", contact: { zeta: 0.05, rad: 0.02 }, modes(f0, rnd) {
    const R = [1, 2.756, 5.404, 8.933, 13.34, 18.64, 24.8, 31.9];
    return R.map((r, k) => {
      const f = f0 * r * (1 + 0.01 * (rnd() * 2 - 1));
      return { f, t60: 0.9 * Math.pow(400 / f0, 0.35) * Math.pow(1 / r, 0.45), g: 0.9 * Math.pow(1 / r, 1.2), rad: Math.pow(1 / r, 0.15) * (k & 1 ? -1 : 1) };
    });
  } },
  // RUBBER: a hollow squeeze toy. Soft contact that radiates itself (the squeak), one air-cavity mode and two broad
  // formants. The cavity is the most compliant thing at the contact, so the squeak sits on it and glides with it.
  { name: "rubber", contact: { zeta: 0.04, rad: 0.5 }, modes(f0) {
    return [
      { f: f0, t60: 0.06, g: 1.4, rad: 1 },
      { f: f0 * 2.03, t60: 0.035, g: 0.25, rad: 0.6 },
      { f: f0 * 3.4, t60: 0.02, g: 0.08, rad: 0.45 },
      { f: f0 * 5.6, t60: 0.012, g: 0.03, rad: 0.3 },
    ];
  } },
  // HINGED WOOD: a wooden door on an iron pin. The pin's few high modes (where it squeaks) under the panel's dense low
  // ones (what makes it sound like a door rather than a hinge on a bench).
  { name: "hinged wood", contact: { zeta: 0.06, rad: 0.04 }, modes(f0, rnd) {
    const m = FRICTION_BODIES[0].modes(f0, rnd).slice(0, 12);
    for (const [r, t, g] of [[7.1, 0.35, 0.35], [11.3, 0.25, 0.12], [17.9, 0.18, 0.05]]) m.push({ f: f0 * r, t60: t, g, rad: 0.45 });
    return m;
  } },
];

// ---------- cfg: the proposed PARAMS rows -> the model's numbers ----------
// fricBody   0..3  enum (wood, iron, rubber, hinged wood)
// fricSize   20..4000 Hz — not a row: the patch's `freq` is the body's base mode (bigger body = lower), as `freq` is a
//                          bar's pitch. Here passed as cfg.bodyHz.
// fricSpeed  0..1   how fast it is dragged: separate ticks (0) -> a run-together groan (~0.6) -> a squeal (1).
//                    The amp envelope is the PUSH (its shape over the sound), as it is the bow speed on "bowed".
// fricPress  0..1   pressure: heavier = slower, bigger slips (louder, lower, "heavier" creak) and a stiffer contact
// fricGrip   0..1   stick contrast (static over kinetic friction): dry wood/rubber high, greased low
// fricRough  0..1   irregularity: grain along the surface (the catch varies with POSITION, so a re-push repeats it)
//                    and an unsteady hand (speed and pressure wobble in time)
// fricLock   0..1   how compliant the body is at the contact: 0 = the contact spring decides the rate (creak),
//                    1 = the body's first modes do (squeal locks to the body)
// fricTone   0..1   contact stiffness (the contact spring's frequency, 150 Hz..3 kHz): the top of the groan
export function frictionCfg(st) {
  return {
    body: Math.max(0, Math.min(FRICTION_BODIES.length - 1, Math.round(st.fricBody))),
    bodyHz: st.freq,
    contactHz: 150 * Math.pow(20, st.fricTone),
    grip: 0.15 + 0.7 * st.fricGrip,
    rough: st.fricRough,
    lock: st.fricLock,
    speed: st.fricSpeed,
    press: st.fricPress,
  };
}

const OS = 4;               // the contact runs at 4x: the stick/slip switch is a force discontinuity, and a locked
                            // iron squeal's top octave read 6.2 dB off an 8x reference at 2x, 3.2 at 4x (offline: cheap)
const TAPS_PER_OS = 24;     // decimator FIR length per oversampling step (windowed sinc, cutoff 0.45 of the output rate)
const PATCH_HZ = 4000;      // the contact patch's size, as the body mode it stops coupling to (see makeFriction)
const MU_S = 1;             // static friction (the scale; only the contrast matters)
const FRIC_NOISE = 0.015;   // fine grit on the friction (low-passed noise), what keeps a steady push from being a clock
const RATE_MIN = 3;         // slip rate at speed 0 (per second, at pressure 0.5 and a plain surface)

// value noise: smooth, seeded, deterministic
function valueNoise(seed) {
  const h = (i) => { let x = (Math.imul(i | 0, 0x27d4eb2d) ^ seed) >>> 0; x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
  return (t) => { const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f); return h(i) * (1 - s) + h(i + 1) * s; };
}

// One contact on one body. tick(speed 0..1+, pressure 0..1) -> one sample at `sr`. `slips` counts slip onsets.
export function makeFriction(sr, cfg, seedIn) {
  let seed = (seedIn >>> 0) || 0x5f1c7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const OSn = cfg.os || OS;                                     // (cfg.os: a test hook, for the aliasing check)
  const isr = sr * OSn, dt = 1 / isr;
  const B = FRICTION_BODIES[cfg.body];
  // the contact spring is mode 0 (g = 1, so every body mode's g is "compliance relative to the contact")
  const raw = [{ f: cfg.contactHz, t60: 0, zeta: B.contact.zeta, g: 1, rad: B.contact.rad }];
  // a mode past 0.45 SR is dropped (it would fold).
  // And the contact is a PATCH, not a point: it averages out any body mode whose wavelength is shorter than itself, so
  // coupling rolls off past PATCH_HZ (second order). Without it the stiff top modes rippled the gripping force across the
  // threshold and the contact rattled at the integrator's rate (a locked moan turned into continuous chatter at 8x).
  for (const m of B.modes(cfg.bodyHz, rnd)) if (m.f < sr * 0.45) raw.push({ f: m.f, t60: m.t60, g: m.g * (0.15 + 1.7 * cfg.lock) / (1 + Math.pow(m.f / PATCH_HZ, 2)), rad: m.rad });
  const n = raw.length, w2 = new Float64Array(n), dmp = new Float64Array(n), gk = new Float64Array(n), rad = new Float64Array(n);
  const x = new Float64Array(n), v = new Float64Array(n);
  let G = 0;
  for (let k = 0; k < n; k++) {
    const m = raw[k];
    const w = 2 * isr * Math.sin(Math.PI * m.f / isr);           // pre-warped: symplectic Euler then rings at m.f exactly
    w2[k] = w * w;
    // a T60 is a decay rate; the contact gives its damping ratio directly
    const sigma = m.t60 > 0 ? 6.9078 / m.t60 : m.zeta * 2 * Math.PI * m.f;
    dmp[k] = 2 * sigma;
    gk[k] = m.g; rad[k] = m.rad; G += m.g * dt;
  }
  // scale: a slip's force swing is ~2*N*(muS-muD); its velocity in the contact mode ~ that / w0. Speed knob -> the
  // RELAXATION rate (slips a second) at pressure 0.5: log from RATE_MIN up to the contact frequency.
  // The load builds in the contact spring AND every body mode in series, so the static stiffness the slider sees is
  // k = 1 / (1/w0^2 + sum g_k/w_k^2). The speed knob is mapped through THAT, so it means the same slip rate on every
  // body and lock: a compliant body no longer silently slows the creak to a crawl (it did, 10x, on a big iron gate).
  const w0 = 2 * Math.PI * cfg.contactHz, dmu = MU_S * cfg.grip, muD = MU_S - dmu;
  let comp = 0; for (let k = 0; k < n; k++) comp += gk[k] / w2[k];
  const kEff = 1 / comp;
  const vSlip = 2 * 0.5 * dmu / w0;                              // typical slip velocity at pressure 0.5
  const vStrib = 0.12 * vSlip;                                   // Stribeck velocity: friction falls over this. At 0.35 the
  // friction never fell far inside a slip, each slip released a fraction of its load, and the slip rate stopped following
  // the speed (97 ticks/s at speed 0.1, 90 at 0.3). At 0.12 the measured rate sits on the formula (5/15/39/107/295 asked,
  // 7/17/47/120/264 got, wood at tone 0.4); at 0.05 iron stops locking.
  const speedToV = (s) => {
    if (!(s > 0)) return 0;                                      // stopped
    const rate = RATE_MIN * Math.pow(cfg.contactHz / RATE_MIN, s);
    return rate * 2 * 0.5 * dmu / kEff;                          // relaxation: rate = V*k / (2*N*dmu)
  };
  const grain = valueNoise(((seedIn >>> 0) ^ 0x9e3779b9) >>> 0), handV = valueNoise(((seedIn >>> 0) ^ 0x7f4a7c15) >>> 0), handN = valueNoise(((seedIn >>> 0) ^ 0x2545f491) >>> 0);
  // grain spacing: the catch varies over ~1/40 of the travel a slip covers at speed 0.5, so it is felt as texture
  const grainLen = speedToV(0.35) / 25;
  // `slips` counts every stick->slip switch (including the body's rattle re-catching inside one slip); `ticks` only
  // those after a grip of 1 ms or more — the catch-and-release you HEAR as a separate tick.
  let travel = 0, t = 0, stuck = true, slips = 0, ticks = 0, held = 0;
  const tickHeld = Math.round(0.001 * isr);
  let grit = 0; const gritA = 1 - Math.exp(-2 * Math.PI * 1500 / isr);
  // decimator: windowed sinc at 0.45 of the output rate, evaluated once per output sample
  const TAPS = TAPS_PER_OS * OSn, fir = new Float64Array(TAPS), hist = new Float64Array(TAPS * 2);
  { let s = 0; for (let i = 0; i < TAPS; i++) { const c = i - (TAPS - 1) / 2, a = 2 * 0.45 / OSn, sinc = c === 0 ? a : Math.sin(Math.PI * a * c) / (Math.PI * c), win = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (TAPS - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (TAPS - 1)); fir[i] = sinc * win; s += fir[i]; } for (let i = 0; i < TAPS; i++) fir[i] /= s; }
  let hp = 0, hw = 0, dcx = 0, dcy = 0;
  const hpA = Math.exp(-2 * Math.PI * 25 / sr);
  const vf = new Float64Array(n);
  function step(speed, press) {
    const rough = cfg.rough;
    const hv = 1 + rough * 0.45 * handV(t * 3.1) + rough * 0.2 * handV(t * 11.7 + 50);
    const N = Math.max(0.02, press) * (1 + rough * 0.25 * handN(t * 2.3));
    const V = speedToV(speed) * Math.max(0, hv);
    travel += V * dt; t += dt;
    // the catch along the surface: static friction varies with POSITION (grain, rust, a knot), plus a fine grit.
    // The grit is LOW-PASSED noise on the friction, never white noise on the speed: the gripping force is
    // (speed error) / G and G scales with the time step, so a 1.5% white jitter on the speed was a ±30% jitter on the
    // grip at 4x and worse at 8x — the contact rattled at the integrator's rate (the first version's chatter).
    grit += gritA * ((rnd() * 2 - 1) - grit);
    const muS = MU_S * (1 + rough * 0.6 * grain(travel / grainLen) + FRIC_NOISE * 4 * grit);
    // stiffer contact under more pressure (Hertz: k ~ N^(1/3)) — heavier squeals sit a little higher
    const kc = Math.pow(N / 0.5, 1 / 3);
    // free prediction
    let vc = 0;
    for (let k = 0; k < n; k++) {
      const a = -(k === 0 ? w2[0] * kc : w2[k]) * x[k] - dmp[k] * v[k];
      vf[k] = v[k] + dt * a; vc += vf[k];                       // contact velocity = sum of mode velocities (b = 1)
    }
    // The friction law solved CONSISTENTLY with the step (McIntyre-Schumacher-Woodhouse's graphical solution, as a
    // bowed string is): the contact's sliding speed after the step is u = |vr| - G*F, and F = N*mu(u). Gripping is
    // the u = 0 solution, which holds while the force it needs stays under N*muS. Evaluating mu at the PREDICTED speed
    // instead (the first version) made the contact chatter between stick and slip every sample near the threshold —
    // a count that grew 30x from 2x to 16x oversampling, i.e. the integrator's, not the physics'.
    const vr = V - vc, Fst = vr / G;                             // the force that would keep it gripping
    let F;
    if (Math.abs(Fst) <= N * muS) {
      if (!stuck) stuck = true;
      F = Fst; held++;
    } else {
      if (stuck) { stuck = false; slips++; if (held >= tickHeld) ticks++; held = 0; }
      const a = Math.abs(vr), c = G * N;
      let u = Math.max(0, a - c * muS);
      for (let it = 0; it < 4; it++) {                           // Newton: h(u) = u - a + c*mu(u), monotonic here
        const e = Math.exp(-u / vStrib), h = u - a + c * (muD + (muS - muD) * e), dh = 1 - c * (muS - muD) / vStrib * e;
        u = Math.max(0, u - h / dh);
      }
      F = N * mu(u, muS) * Math.sign(vr);
    }
    let o = 0;
    for (let k = 0; k < n; k++) {
      v[k] = vf[k] + dt * gk[k] * F;
      x[k] += dt * v[k];
      o += rad[k] * v[k];
    }
    return o;
  }
  // Stribeck: kinetic friction falls from static toward muD with sliding speed (the negative slope is the motor)
  function mu(sv, muS) { return muD + (muS - muD) * Math.exp(-sv / vStrib); }
  return {
    get slips() { return slips; },
    get ticks() { return ticks; },
    get stuck() { return stuck; },
    tick(speed, press) {
      for (let j = 0; j < OSn; j++) { hist[hw] = hist[hw + TAPS] = step(speed, press); hw = hw + 1 === TAPS ? 0 : hw + 1; }
      let y = 0; for (let i = 0; i < TAPS; i++) y += fir[i] * hist[hw + i];
      // a gentle DC/subsonic blocker: the contact spring's slow load is not sound
      const h = hpA * (dcy + y - dcx); dcx = y; dcy = h;
      return h / vSlip;
    },
  };
}

// ---------- the offline shape: a push over time ----------
// push: { dur, speed: [[t, s], …], press: [[t, p], …] } — breakpoints in seconds, linear between (smoothstep'd).
// Returns { y: Float32Array (peak 0.5, faded), slipTimes: [...] }.
export function curve(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) if (t <= points[i][0]) {
      const [t0, a] = points[i - 1], [t1, b] = points[i], u = (t - t0) / Math.max(1e-9, t1 - t0), s = u * u * (3 - 2 * u);
      return a + (b - a) * s;
    }
    return points[points.length - 1][1];
  };
}
export function renderFriction(sr, cfg, push, seed) {
  const n = Math.round(push.dur * sr), y = new Float32Array(n), sp = curve(push.speed), pr = curve(push.press);
  const f = makeFriction(sr, cfg, seed), slipTimes = [], tickTimes = [];
  let last = 0, lastT = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = sp(t) * (t < 0.015 ? 0.5 - 0.5 * Math.cos(Math.PI * t / 0.015) : 1);
    y[i] = f.tick(s, pr(t));
    if (f.slips !== last) { last = f.slips; slipTimes.push(t); }
    if (f.ticks !== lastT) { lastT = f.ticks; tickTimes.push(t); }
  }
  let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(y[i])) { y[i] = 0; nan++; } pk = Math.max(pk, Math.abs(y[i])); }
  const fadeIn = Math.round(0.005 * sr), fadeOut = Math.round(0.03 * sr);
  for (let i = 0; i < n; i++) { let g = pk > 0 ? 0.5 / pk : 0; if (i < fadeIn) g *= i / fadeIn; if (i > n - fadeOut) g *= (n - i) / fadeOut; y[i] *= g; }
  return { y, slipTimes, tickTimes, nan };
}

// =====================================================================================================================
// CLI: the listening round. Everything below is tooling, not the model.
// =====================================================================================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGET_LUFS = -18;
const SR_ = 44100;

function loadSynth() {
  const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
    Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
  ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  return { CS: runInContext("CrunchySynth", ctx), PRESETS: pctx.window.PRESETS };
}

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
  const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR_, c = Math.cos(w), al = Math.sin(w) / (2 / Math.SQRT2), sa = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
    (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
  const w2 = 2 * Math.PI * 38 / SR_, c2 = Math.cos(w2), al2 = Math.sin(w2) / (2 * 0.5);
  return biquad(s, (1 + c2) / 2, -(1 + c2), (1 + c2) / 2, 1 + al2, -2 * c2, 1 - al2);
}
function lufs(L, R) {
  const kl = kweight(L), kr = kweight(R), B = Math.round(0.4 * SR_), H = Math.round(0.1 * SR_), ms = [];
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
function match(L, R) {   // make-ab.mjs's take(): to TARGET_LUFS, then capped at 0.95 peak
  let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
  if (pk > 0.95) gn *= 0.95 / pk;
  for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  return lufs(L, R);
}

// ---- measurement
function acPitch(y, a, b) {   // normalized autocorrelation, 40 Hz .. 4 kHz; returns [Hz, clarity]
  let e0 = 0; for (let i = a; i < b; i++) e0 += y[i] * y[i];
  if (!(e0 > 0)) return [0, 0];
  let best = 0, bl = 0, prev = 1, rising = false;
  for (let l = 11; l < Math.min(1100, (b - a) >> 1); l++) {
    let s = 0; for (let i = a; i < b - l; i++) s += y[i] * y[i + l];
    s /= e0;
    if (s > prev) rising = true;
    if (rising && s > best) { best = s; bl = l; }
    prev = s;
  }
  return bl ? [SR_ / bl, best] : [0, 0];
}
function measure(L, R, slipTimes, dur) {
  let pk = 0, nan = 0;
  for (let i = 0; i < L.length; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; else pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const edge = (a, b) => { let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i])); return m; };
  const n2 = Math.round(0.002 * SR_), start = edge(0, n2), end = edge(L.length - n2, L.length);
  // slip rate per 100 ms window, and pitch at the loudest window (mono)
  const rates = [];
  if (slipTimes) for (let t = 0; t < dur - 1e-9; t += 0.1) rates.push(slipTimes.filter((s) => s >= t && s < t + 0.1).length * 10);
  const W = Math.round(0.08 * SR_), mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  let bw = 0, be = -1;
  for (let a = 0; a + W <= mono.length; a += W >> 1) { let e = 0; for (let i = a; i < a + W; i++) e += mono[i] * mono[i]; if (e > be) { be = e; bw = a; } }
  const [hz, cl] = acPitch(mono, bw, bw + W);
  // pitch per 100 ms window where it is clearly periodic (clarity >= 0.8), "-" where it is not (ticks, noise, silence)
  const track = [];
  if (slipTimes) for (let a = 0; a + 4410 <= Math.round(dur * SR_); a += 4410) { const [h, c] = acPitch(mono, a, a + 4410); track.push(c >= 0.8 ? Math.round(h) : "-"); }
  return { pk, nan, start, end, rates, track, hz, cl, loudAt: bw / SR_ };
}

// ---- the takes. A friction take is { st: the proposed fric* rows + freq (body size), push: speed/pressure over time }
// and is run through the REAL SFX chain as an imported sample (wave 9, freq 440 = native speed), with the control
// preset's own Space settings (reverb, size, tone, width), filter wide open and no drive — so the room is the app's.
const space = (p) => ({ reverb: p.reverb || 0, reverbSize: p.reverbSize == null ? 0.6 : p.reverbSize, reverbTone: p.reverbTone == null ? 0.5 : p.reverbTone, width: p.width == null ? 0.4 : p.width });
const fr = (body, freq, o) => Object.assign({ fricBody: body, freq, fricTone: 0.4, fricGrip: 0.5, fricRough: 0.3, fricLock: 0.3, fricSpeed: 1, fricPress: 1 }, o);
const WOOD = 0, IRON = 1, RUBBER = 2, HINGED = 3;
const WAVE_NAMES = ["sine", "square", "saw", "triangle", "pulse", "FM"];   // index.html's WAVES, the ones the controls use

const ROUNDS = {
  "creaking-door": { title: "Creaking Door", control: "Creaking Door", seed: 11,
    listen: "A door in a horror game swinging slowly open on old hinges, about a second and a half. Which one is a DOOR CREAKING (wood, a hinge, a hand pushing it), rather than a tone with a wobble on it? Listen for whether you can hear the catch-and-release (separate ticks that run together as it speeds up) and whether it sounds like it is coming FROM a heavy wooden thing.",
    takes: [
      { id: "panel-creak", why: "FRICTION, wood panel, the RELAXATION reading: nothing locks, so the tick rate follows the push. Starts as separate ticks (~10 a second), speeds into a run-together groan (~110 a second) as the door swings, slows back into ticks as it stops.",
        st: fr(WOOD, 170, { fricTone: 0.35, fricGrip: 0.6, fricRough: 0.5, fricLock: 0.2 }),
        push: { dur: 1.3, speed: [[0, 0.2], [0.15, 0.3], [0.7, 0.72], [1.05, 0.45], [1.25, 0]], press: [[0, 0.5], [1.3, 0.55]] } },
      { id: "hinge-groan", why: "FRICTION, hinged wood: an iron pin squeaking inside a wooden door. Mid lock, so the fast middle runs up to ~380 slips a second, ringing the pin's modes over the panel, and briefly catches into a pitched ~520 Hz groan; the slow ends stay ticks.",
        st: fr(HINGED, 140, { fricTone: 0.45, fricGrip: 0.55, fricRough: 0.35, fricLock: 0.6 }),
        push: { dur: 1.3, speed: [[0, 0.25], [0.2, 0.45], [0.75, 0.78], [1.1, 0.45], [1.28, 0]], press: [[0, 0.45], [0.7, 0.6], [1.3, 0.5]] } },
      { id: "stutter", why: "FRICTION, wood panel, the UNSTEADY-HAND reading: the push comes in three shoves, so the creak stops and starts (crk... crrrk... crk-crk), very rough grain.",
        st: fr(WOOD, 150, { fricTone: 0.3, fricGrip: 0.7, fricRough: 0.9, fricLock: 0.25 }),
        push: { dur: 1.3, speed: [[0, 0.15], [0.12, 0.5], [0.3, 0.1], [0.42, 0], [0.5, 0.25], [0.7, 0.58], [0.88, 0.2], [0.98, 0.05], [1.05, 0.35], [1.2, 0.2], [1.28, 0]], press: [[0, 0.6], [1.3, 0.6]] } },
    ] },
  "trapdoor-creak": { title: "Trapdoor Creak", control: "Trapdoor Creak", seed: 23,
    listen: "A trapdoor in the floor being lifted open, under a second. Which one sounds like a wooden hatch on its hinges creaking as it LIFTS? Listen for the creak rising as it opens, and for wood rather than a buzzer.",
    takes: [
      { id: "lift", why: "FRICTION, hinged wood: a quick rising creak, the ticks speeding up (10 to ~170 a second) into a short groan as the hatch lifts, then falling away as it settles.",
        st: fr(HINGED, 200, { fricTone: 0.4, fricGrip: 0.55, fricRough: 0.4, fricLock: 0.3 }),
        push: { dur: 0.75, speed: [[0, 0.25], [0.45, 0.8], [0.62, 0.55], [0.73, 0]], press: [[0, 0.5], [0.75, 0.55]] } },
      { id: "iron-eek", why: "FRICTION, a rusty iron hinge alone, fully locked: a short pitched 'eeek' that bends as the pressure comes on. The hinge, not the hatch.",
        st: fr(IRON, 520, { fricTone: 0.55, fricGrip: 0.6, fricRough: 0.3, fricLock: 0.85 }),
        push: { dur: 0.7, speed: [[0, 0.5], [0.12, 0.85], [0.5, 0.9], [0.66, 0]], press: [[0, 0.35], [0.4, 0.75], [0.7, 0.6]] } },
      { id: "heavy-lid", why: "FRICTION, a big wooden lid, heavy pressure: slow, few, big ticks that never quite run together. The weight, not the squeak.",
        st: fr(WOOD, 105, { fricTone: 0.25, fricGrip: 0.75, fricRough: 0.55, fricLock: 0.2 }),
        push: { dur: 0.75, speed: [[0, 0.2], [0.35, 0.45], [0.6, 0.3], [0.72, 0]], press: [[0, 0.9], [0.75, 0.9]] } },
    ] },
  "squeaky-toy": { title: "Squeaky Toy", control: "Squeaky Toy", seed: 37,
    listen: "A rubber squeaky toy being squeezed, under half a second. Which one sounds like RUBBER squeaking (a dog toy, a rubber duck) rather than a whistle or a synth beep?",
    takes: [
      { id: "squeeze", why: "FRICTION, rubber with an air cavity: one squeeze. It starts unsettled (~600 Hz) and JUMPS onto the cavity (~940 Hz) as the squeeze speeds up, the bloom of a squeak catching.",
        st: fr(RUBBER, 1000, { fricTone: 0.85, fricGrip: 0.85, fricRough: 0.15, fricLock: 0.9 }),
        push: { dur: 0.36, speed: [[0, 0.7], [0.04, 0.8], [0.22, 1], [0.3, 1], [0.35, 0]], press: [[0, 0.3], [0.36, 0.35]] } },
      { id: "squee-gee", why: "FRICTION, rubber: squeeze AND release, two squeaks with a gap (the in-and-out of a squeeze toy). Both lock on the same cavity, so the second is the same note, a touch flatter as the grip tightens: a real toy's cavity changes size as it is squeezed, which this body cannot do yet.",
        st: fr(RUBBER, 1000, { fricTone: 0.85, fricGrip: 0.85, fricRough: 0.15, fricLock: 0.9 }),
        push: { dur: 0.4, speed: [[0, 0.7], [0.03, 0.85], [0.13, 1], [0.16, 0], [0.21, 0], [0.23, 1], [0.37, 1], [0.39, 0]], press: [[0, 0.3], [0.2, 0.3], [0.23, 0.3], [0.39, 0.55]] } },
      { id: "rub", why: "FRICTION, rubber but RUBBED, not squeezed: a finger dragged across a wet rubber duck, a fast irregular chirping that never settles on one note.",
        st: fr(RUBBER, 1300, { fricTone: 0.8, fricGrip: 0.8, fricRough: 0.75, fricLock: 0.5 }),
        push: { dur: 0.38, speed: [[0, 0.5], [0.06, 0.82], [0.2, 0.7], [0.3, 0.85], [0.37, 0]], press: [[0, 0.6], [0.38, 0.7]] } },
    ] },
  "heavy-gate": { title: "Heavy Gate", control: "Heavy Gate", seed: 41,
    listen: "A heavy iron or timber gate swinging open, two seconds, in a big space. Which one sounds HEAVY and like a gate (the weight on the hinge, the metal or wood ringing), rather than a low drone?",
    takes: [
      { id: "iron-hinge", why: "FRICTION, iron gate, heavy pressure, relaxation: slow, big, uneven ticks on a rusty hinge (10 to ~60 a second, never running together) with the iron ringing under each one.",
        st: fr(IRON, 150, { fricTone: 0.25, fricGrip: 0.6, fricRough: 0.5, fricLock: 0.3 }),
        push: { dur: 1.75, speed: [[0, 0.15], [0.3, 0.3], [0.9, 0.55], [1.4, 0.35], [1.7, 0]], press: [[0, 0.85], [1.75, 0.9]] } },
      { id: "moan", why: "FRICTION, iron gate, fully locked: pushed hard enough that the slips lock near the gate's lowest mode and the hinge MOANS on one low note (~96 Hz) through the middle of the swing, ticking at either end. The horror-movie gate.",
        st: fr(IRON, 105, { fricTone: 0.3, fricGrip: 0.55, fricRough: 0.35, fricLock: 0.9 }),
        push: { dur: 1.75, speed: [[0, 0.45], [0.25, 0.85], [0.9, 1], [1.4, 0.85], [1.7, 0]], press: [[0, 0.6], [0.8, 0.9], [1.75, 0.7]] } },
      { id: "timber-drag", why: "FRICTION, a big timber gate dragging: low wood body, rough grain, a slow uneven creak that stays as ticks the whole way. Wood, not iron.",
        st: fr(WOOD, 85, { fricTone: 0.2, fricGrip: 0.7, fricRough: 0.8, fricLock: 0.25 }),
        push: { dur: 1.75, speed: [[0, 0.2], [0.4, 0.4], [1.0, 0.48], [1.45, 0.3], [1.7, 0]], press: [[0, 0.8], [1.75, 0.85]] } },
    ] },
  "brake-squeal": { title: "Brake Squeal (a GAP: no preset owns it)", control: "Nails on Chalkboard", seed: 53,
    gapNote: "No brake preset exists; this is the nearest one (a metal-on-something friction squeal made from a saw, noise and a resonant filter).",
    listen: "A brake squealing as something heavy stops: a mine cart, a train, a car. About a second. Which one sounds like METAL rubbing on metal and squealing, rather than a high tone? Listen to the very end: does the squeal break up as it comes to a stop?",
    takes: [
      { id: "disc", why: "FRICTION, iron, fully locked, high: a disc brake. The pads come on and press harder as it slows; the squeal locks on one mode, HOPS up to a higher one (~3.1 kHz) as the pressure builds, drops back, and as the speed dies it UNLOCKS into juddering ticks at the stop.",
        st: fr(IRON, 1150, { fricTone: 0.7, fricGrip: 0.55, fricRough: 0.25, fricLock: 1 }),
        push: { dur: 1.1, speed: [[0, 0.95], [0.6, 0.85], [0.9, 0.45], [1.05, 0]], press: [[0, 0.05], [0.06, 0.3], [0.5, 0.85], [1.1, 0.95]] } },
      { id: "cart", why: "FRICTION, iron, lower and rougher: a mine cart's block brake on the wheel. It squeals at ~430 Hz, breaks into a grinding 250-300 slips a second as the grip changes, then grinds to a halt with the wheel ringing.",
        st: fr(IRON, 480, { fricTone: 0.55, fricGrip: 0.6, fricRough: 0.55, fricLock: 0.8 }),
        push: { dur: 1.1, speed: [[0, 0.92], [0.5, 0.8], [0.85, 0.5], [1.05, 0]], press: [[0, 0.05], [0.06, 0.5], [0.4, 0.9], [1.1, 0.8]] } },
      { id: "short-chirp", why: "FRICTION, iron, a quick stop: a short bright squeal that slides down (1.4 kHz to 0.8 kHz) and jumps up to 2 kHz as the pads bite, then a few ticks. A bike or a small cart; the brake as a one-shot.",
        st: fr(IRON, 1500, { fricTone: 0.75, fricGrip: 0.65, fricRough: 0.3, fricLock: 0.9 }),
        push: { dur: 0.6, speed: [[0, 1], [0.3, 0.95], [0.48, 0.4], [0.58, 0]], press: [[0, 0.05], [0.05, 0.45], [0.32, 0.5], [0.45, 0.9], [0.6, 0.9]] } },
    ] },
};

function renderTake(CS, take, sp) {
  const cfg = frictionCfg(take.st);
  const r = renderFriction(SR_, cfg, take.push, 0x51ce ^ Math.round(take.st.freq * 7) ^ (take.seed || 0));
  // room for the body's ring and the reverb after the push stops (iron rings longest), within the app's 2 s
  const tail = Math.min(0.4, 2.0 - take.push.dur, (take.st.fricBody === IRON ? 0.35 : 0.1) + 0.5 * (sp.reverb || 0) * sp.reverbSize);
  const sample = new Float32Array(Math.round((take.push.dur + tail) * SR_)); sample.set(r.y);
  const patch = Object.assign({}, CS.DEFAULTS, { wave: 9, freq: 440, attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 0.01,
    drive: 0, filterMode: 0, cutoff: 12000, reso: 0, gain: 1, duration: +(take.push.dur + tail).toFixed(3) }, sp);
  const o = CS.render(patch, { sample, normalize: true });
  const fo = Math.round(0.04 * SR_), N = o.L.length;   // the room's tail meets the buffer end: a 40 ms fade, after the chain
  for (let i = N - fo; i < N; i++) { const g = (N - i) / fo; o.L[i] *= g; o.R[i] *= g; }
  return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), slipTimes: r.tickTimes, nanModel: r.nan, patch };
}

function run(CS, PRESETS, name) {
  const round = ROUNDS[name], ctrl = Object.assign({}, PRESETS[round.control]); delete ctrl._vary;
  const sp = space(ctrl);
  const all = [{ id: "current-preset", why: "CONTROL: the current preset `" + round.control + "` exactly as it ships (" + WAVE_NAMES[ctrl.wave == null ? 2 : ctrl.wave] + " oscillator, wave " + (ctrl.wave == null ? 2 : ctrl.wave) + "), rendered by the exported engine." + (round.gapNote ? " " + round.gapNote : ""), control: ctrl }]
    .concat(round.takes.map((t, i) => Object.assign({ seed: i * 101 + round.seed }, t)));
  let seed = 0x5f3759df;
  for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const order = all.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = join(ROOT, "soundtests", "proto-friction", name), key = [];
  mkdirSync(out, { recursive: true });
  console.log(name);
  order.forEach((ti, slot) => {
    const t = all[ti], file = "take-" + "ABCDEFGH"[slot] + ".wav";
    let r;
    if (t.control) { const o = CS.render(Object.assign({}, CS.DEFAULTS, t.control), { normalize: true }); r = { L: Float32Array.from(o.L), R: Float32Array.from(o.R), slipTimes: null, nanModel: 0 }; }
    else r = renderTake(CS, t, sp);
    const lu = match(r.L, r.R), m = measure(r.L, r.R, r.slipTimes, t.push ? t.push.dur : r.L.length / SR_);
    writeFileSync(join(out, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR_, depth: 16, channels: 2, title: name + " " + file })));
    const line = file + "  " + t.id.padEnd(15) + (r.L.length / SR_).toFixed(2) + " s  " + lu.toFixed(1) + " LUFS  peak " + m.pk.toFixed(3) +
      "  NaN " + (m.nan + r.nanModel) + "  edges " + m.start.toFixed(4) + "/" + m.end.toFixed(4) + "  loudest@" + m.loudAt.toFixed(2) + "s pitch " + m.hz.toFixed(0) + " Hz (clarity " + m.cl.toFixed(2) + ")" +
      (m.rates.length ? "\n      ticks/s per 100 ms (a slip after a 1 ms grip): " + m.rates.join(" ") + "\n      pitch per 100 ms (Hz, where clarity >= 0.8):    " + m.track.join(" ") : "");
    console.log("  " + line);
    key.push({ file, t, r, lu, m, line });
  });
  writeFileSync(join(out, "LISTEN.md"), "# " + round.title + "\n\n" + all.length + " takes, `take-A.wav` to `take-" + "ABCDEFGH"[all.length - 1] +
    ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is the current preset.\n\n" + round.listen +
    "\n\nSay the letter (and a runner-up if two are close). `KEY.md` says what each one is: **read it after listening.**\n");
  writeFileSync(join(out, "KEY.md"), "# " + round.title + ": the key\n\nFriction takes run through the real SFX chain as an imported sample (wave 9 at native speed), with the control preset's own Space settings (" +
    JSON.stringify(sp) + "), filter open, no drive. The control is the preset exactly as it ships.\n\n" +
    key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\nMeasured: `" + k.line.replace(/\n\s*/g, " | ") + "`\n\n```json\n" +
      JSON.stringify(k.t.control ? k.t.control : { st: k.t.st, push: k.t.push }) + "\n```\n").join("\n"));
}

function probe() {
  for (let body = 0; body < FRICTION_BODIES.length; body++) for (const lock of [0.2, 0.8]) {
    const row = [];
    for (const s of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const cfg = frictionCfg(fr(body, [200, 400, 900, 180][body], { fricLock: lock, fricRough: 0 }));
      const f = makeFriction(SR_, cfg, 1234), n = SR_, y = new Float32Array(n);
      let s0 = 0, t0 = 0; for (let i = 0; i < n; i++) { y[i] = f.tick(s, 0.5); if (i === Math.round(SR_ * 0.3)) { s0 = f.slips; t0 = f.ticks; } }
      const [p, c] = acPitch(y, Math.round(SR_ * 0.5), Math.round(SR_ * 0.6));
      row.push("s" + s + " " + ((f.ticks - t0) / 0.7).toFixed(0) + "t " + ((f.slips - s0) / 0.7).toFixed(0) + "sl " + p.toFixed(0) + "Hz(" + c.toFixed(2) + ")");
    }
    console.log(FRICTION_BODIES[body].name.padEnd(12) + "lock " + lock + " | " + row.join(" | "));
  }
}

const README = `# Friction engine prototype: listening round

A PROTOTYPE engine, "friction" (stick-slip), against the presets that fake creaks and squeaks with a plain oscillator.
Made by \`node tools/proto/friction.mjs\` (the model and this round are both in that file). Nothing in the app changed.

## What to do

Each folder is one sound. Open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take matched to -18 LUFS,
order shuffled), and say which one sounds most like the thing, and a runner-up. **One take in each folder is the current
preset**, unchanged. Then read \`KEY.md\`.

| folder | the sound | control (the current preset) |
|---|---|---|
| creaking-door | Creaking Door | Creaking Door |
| trapdoor-creak | Trapdoor Creak | Trapdoor Creak |
| squeaky-toy | Squeaky Toy | Squeaky Toy |
| heavy-gate | Heavy Gate | Heavy Gate |
| brake-squeal | a GAP: a brake squealing to a stop (no preset owns it) | Nails on Chalkboard, the nearest |

The three friction takes in each folder differ in what the sound IS (ticks that follow the push, a hinge that locks into
a squeal, an unsteady hand, a different body), not in one knob.

## What the engine is

A contact dragged along a surface under pressure: it grips, the load builds, it slips, the friction drops, the load snaps
into a resonant body, it grips again. Slow: separate ticks whose rate follows the speed. Faster: they run together into a
groan. On a ringing body the slips LOCK to a body mode and it squeals. Bodies: wood panel, iron, rubber with an air cavity,
and wood on an iron hinge pin.

## The room

Every friction take is run through the REAL SFX chain (the exported engine, as an imported sample, wave 9 at native
speed) with the control preset's own Space settings (reverb, size, tone, width), filter open, no drive, and a 40 ms fade
where the room's tail meets the end of the buffer. So the space is the app's, and matches the control's.
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const want = process.argv[2];
  if (want === "probe") probe();
  else {
    const { CS, PRESETS } = loadSynth();
    for (const n of want ? [want] : Object.keys(ROUNDS)) run(CS, PRESETS, n);
    writeFileSync(join(ROOT, "soundtests", "proto-friction", "README.md"), README);

  }
}
