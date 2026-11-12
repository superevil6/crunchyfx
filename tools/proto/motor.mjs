/* motor.mjs — PROTOTYPE of a "motor" synthesis engine for CrunchySFX: combustion engines, rotors and steam, built from
 * the thing they are — a train of FIRING EVENTS — rather than from an oscillator.
 *
 *   node tools/proto/motor.mjs            renders the round into soundtests/proto-motor/ (blind takes + the controls)
 *   node tools/proto/motor.mjs --list     lists the rounds
 *
 * THE MODEL (makeMotor, pure, portable the way dsp.js writes makeBrass / makeBowed: no DOM, no Math.random, SR in):
 *
 *   rpm(t), load(t) ──> CYCLE PHASE ──> firing events (per cylinder / blade / chuff: fixed timing + level offsets,
 *        │                │              per-event jitter, misfires, overrun pops)
 *        │                │                 │ each event = a smooth PULSE (x² e^-x, sub-sample onset: band-limited)
 *        │                │                 │            + a NOISE BURST envelope (combustion / slap / chuff)
 *        │                │                 v
 *        │                │       EXHAUST PIPE: a quarter-wave waveguide (closed port, open end: -refl, lossy) — odd
 *        │                │       harmonics at c/4L, the drone an exhaust has; mixed with the direct pulse (pipeMix)
 *        │                │                 v
 *        │                │       MUFFLER: 2-pole low-pass at toneHz (opens with load) + a load-driven RASP band
 *        │                ├──> second stream (tail rotor buzz)              ─┐
 *        │                └──> rail CLACKS in pairs -> 3-mode metal bank   ─┤ summed after the muffler
 *        └──> whine (gear / turbine / blower: a tone locked to the crank)  ─┤
 *             air (intake / rotor wash / steam hiss: band noise ∝ load)    ─┘ -> DC block -> out
 *
 *   TYPES  0 piston4: events = cylinders per 2 crank revs   (rpm × cyl / 120 per second)
 *          1 piston2: events = cylinders per crank rev       (rpm × cyl / 60)
 *          2 rotor:   events = blades per rotor rev          (rpm × blades / 60), no pipe: a blade SLAP + swish
 *          3 steam:   events = chuffs per driving-wheel rev  (rpm × 4 / 60 for a two-cylinder double-acting engine)
 *
 * The amplitude of a firing, its sharpness, the muffler's opening and the intake noise all follow LOAD, so a rev up
 * (throttle open) barks and a rev down (closed throttle) goes soft and may pop: the character change comes from the
 * mechanism, not from a separate envelope.
 *
 * In the round, each take's model output is run through the REAL SFX chain as an imported sample
 * (CrunchySynth.render(patch, { sample }) with wave 9 at freq 440 = native speed), with the CONTROL preset's reverb,
 * so the takes and the control share one room, one master stage and one normalizer.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const MOTOR_TYPES = ["piston4", "piston2", "rotor", "steam"];
const C_AIR = 343;

function lcg(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// TPT state-variable filter (the shape dsp.js uses); coefficients only recomputed when fc/q move
function svf(sr) {
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0, k = 1, lf = -1, lq = -1;
  const f = {
    lp: 0, bp: 0, hp: 0,
    set(fc, q) {
      if (fc === lf && q === lq) return;
      lf = fc; lq = q;
      const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), sr * 0.45) / sr);
      k = 1 / q; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    },
    run(x) {
      const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      f.lp = v2; f.bp = v1; f.hp = x - k * v1 - v2;
      return v2;
    },
  };
  return f;
}
// the event shape: x² e^-x, peak 1 at x = 2. C1 at the onset, so with tau >= 0.15 ms its images sit ~90 dB down.
const G_NORM = 1 / (4 * Math.exp(-2));
const shape = (x) => (x <= 0 ? 0 : x * x * Math.exp(-x) * G_NORM);

/* cfg (physical units; the PARAMS proposal in the report maps 0..1 knobs onto these):
 *   type 0..3, cyl (cylinders / blades / chuffs per rev), firing [fractions of a cycle], cylAmp [levels],
 *   imbalance 0..1 (hashed per-cylinder level spread when cylAmp absent), rough 0..1 (jitter, misfires), wander 0..1,
 *   pulseMs, pulseAmp, burstMs, burstAmp, burstHz, burstQ, pipeLen (m), pipeRefl 0..0.9, pipeDamp 0..0.9, pipeMix 0..1,
 *   toneHz, rasp, raspHz, air, airHz, whine, whineMul (× crank rev/s), pops 0..1,
 *   tail { mul (× main rev rate), blades, amp, pulseMs },  clack { amp, perRev | hz, gapSec }
 * tick(rpm, load) -> one sample. rpm is crank (rotor / wheel) revolutions per minute; load 0..1 is the throttle. */
export function makeMotor(sr, cfg, seed) {
  const rnd = lcg(seed);
  const type = cfg.type | 0, stroke4 = type === 0;
  const n = Math.max(1, cfg.cyl | 0);
  const firing = cfg.firing || Array.from({ length: n }, (_, i) => i / n);
  const cylAmp = cfg.cylAmp || Array.from({ length: n }, () => 1 + (cfg.imbalance || 0) * (rnd() * 2 - 1) * 0.5);
  const rough = cfg.rough || 0, pops = cfg.pops || 0;
  const pulseAmp = cfg.pulseAmp ?? 1, burstAmp = cfg.burstAmp ?? 0;
  const misBase = type <= 1 ? rough * 0.05 : 0;
  // ---- exhaust pipe: quarter-wave waveguide, D = round trip
  const PIPE = 4096, pipe = new Float32Array(PIPE);
  const pipeD = Math.min(PIPE - 4, Math.max(2, (2 * (cfg.pipeLen || 1) / C_AIR) * sr));
  const pipeRefl = cfg.pipeRefl || 0, pipeDamp = cfg.pipeDamp ?? 0.3, pipeMix = cfg.pipeMix ?? (type === 2 ? 0 : 1);
  let pw = 0, plp = 0;
  // ---- filters
  const burstF = svf(sr); burstF.set(cfg.burstHz || 1500, cfg.burstQ || 0.9);
  const toneF = svf(sr), raspF = svf(sr); raspF.set(cfg.raspHz || 1500, 2.5);
  const airF = svf(sr); airF.set(cfg.airHz || 1200, 0.8);
  // ---- clack metal: three damped modes
  const modes = [[640, 0.045], [1710, 0.028], [3150, 0.016]].map(([f, t60]) => {
    const r = Math.exp(-6.9 / (t60 * sr)), th = 2 * Math.PI * f / sr;
    return { c1: 2 * r * Math.cos(th), c2: -r * r, g: (1 - r * r), y1: 0, y2: 0 };
  });
  // ---- streams: main firings, tail rotor, rail clacks. Each plans its next cycle at the wrap.
  const pulses = [];   // active events: { t0, tp, ap, tb, ab, v } (v: 0 main, 1 direct, 2 clack)
  const mkStream = (plan) => ({ ph: 0, fr: [], amp: [], idx: 0, plan });
  const main = mkStream((s, load) => {
    s.fr = []; s.amp = [];
    for (let i = 0; i < n; i++) {
      const sp = 1 / n, j = rough * 0.08 * sp * (rnd() * 2 - 1);
      let a = cylAmp[i % cylAmp.length] * (1 + rough * 0.35 * (rnd() * 2 - 1));
      const mis = misBase + (type === 1 ? rough * 0.3 * (1 - load) : 0);   // a 2-stroke "four-strokes" when unloaded
      if (rnd() < mis) a *= 0.08;
      s.fr.push(Math.min(0.999, Math.max(0, firing[i] + j))); s.amp.push(a);
    }
  });
  const tail = cfg.tail ? mkStream((s) => { s.fr = []; s.amp = []; for (let i = 0; i < cfg.tail.blades; i++) { s.fr.push(i / cfg.tail.blades); s.amp.push(1 + 0.1 * (rnd() - 0.5)); } }) : null;
  const clack = cfg.clack ? mkStream((s, load, hz) => {
    const g = Math.min(0.45, cfg.clack.gapSec * hz);   // the pair's spacing is a DISTANCE (axle to axle), so a fraction of a shrinking period
    s.fr = [0.02, 0.02 + g]; s.amp = [1, 0.75 + 0.15 * rnd()];
  }) : null;
  let wn = 0, wTarget = 0, wCount = 0, whPh = 0, loadS = cfg.load0 ?? 0.3, dcx = 0, dcy = 0, i = 0;
  const kLoad = 1 - Math.exp(-1 / (0.03 * sr)), kWn = 1 - Math.exp(-2 * Math.PI * 2.5 / sr);
  const dcK = Math.exp(-2 * Math.PI * 18 / sr);
  const events = [];   // diagnostics: [time s, stream]
  function advance(s, dph, load, hz, fire) {
    let p0 = s.ph; s.ph += dph;
    const take = () => { while (s.idx < s.fr.length && s.fr[s.idx] <= s.ph) { fire((s.fr[s.idx] - p0) / dph, s.amp[s.idx]); s.idx++; } };
    take();
    while (s.ph >= 1) { s.ph -= 1; p0 -= 1; s.plan(s, load, hz); s.idx = 0; take(); }
  }
  function spawn(off, tp, ap, tb, ab, v) {
    const t0 = i - 1 + Math.max(0, off);   // off may run past this sample: a delayed pop
    if (pulses.length < 96) pulses.push({ t0, tp: Math.max(0.15e-3 * sr, tp), ap, tb: Math.max(0.15e-3 * sr, tb), ab, v });
  }
  main.plan(main, loadS, 1); main.ph = 0.999; main.idx = n;   // first cycle starts at once
  if (tail) { tail.plan(tail); tail.ph = 0.999; tail.idx = 99; }
  if (clack) { clack.plan(clack, 0, 1); clack.ph = 0.5; clack.idx = 2; }
  return {
    events,
    tick(rpm, load) {
      i++;
      loadS += (load - loadS) * kLoad;
      if (--wCount <= 0) { wTarget = rnd() * 2 - 1; wCount = (0.12 * sr) | 0; }
      wn += (wTarget - wn) * kWn;
      const r = Math.max(0, rpm * (1 + (cfg.wander || 0) * 0.035 * wn));
      const crankHz = r / 60, cycleHz = stroke4 ? crankHz / 2 : crankHz, evHz = cycleHz * n;
      // sharpness: the blowdown is a CRANK-ANGLE event, so it shortens as rpm rises, and sharper under load
      const tauP = (cfg.pulseMs || 1) * 1e-3 * sr * Math.min(2.5, Math.sqrt(40 / Math.max(5, evHz))) * (1.25 - 0.45 * loadS);
      const tauB = (cfg.burstMs || 2) * 1e-3 * sr * Math.min(2, Math.sqrt(40 / Math.max(5, evHz)));
      const lvl = type >= 2 ? 0.55 + 0.45 * loadS : 0.22 + 0.78 * loadS;
      if (cycleHz > 0) advance(main, cycleHz / sr, loadS, cycleHz, (off, a) => {
        events.push([i / sr, 0]);
        spawn(off, tauP, a * lvl * pulseAmp, tauB, a * lvl * burstAmp, 0);
        // overrun: a closed throttle lets unburnt mixture reach the hot pipe — the pop and crackle on a rev down
        if (pops > 0 && loadS < 0.15 && type <= 1 && rnd() < pops * 0.3) {
          const lag = (0.2 + 0.6 * rnd()) * sr / Math.max(1, evHz);
          spawn(off + lag, tauP * 0.3, 1.1 * (0.5 + rnd()), tauB * 0.6, 1.8 * burstAmp + 0.4, 0);
        }
      });
      if (tail && cycleHz > 0) advance(tail, crankHz * cfg.tail.mul / sr, loadS, 0, (off, a) => {
        spawn(off, (cfg.tail.pulseMs || 1) * 1e-3 * sr, a * cfg.tail.amp * lvl, 1, 0, 1);
      });
      if (clack) {
        const hz = cfg.clack.perRev ? crankHz * cfg.clack.perRev : cfg.clack.hz;
        if (hz > 0) advance(clack, hz / sr, loadS, hz, (off, a) => { events.push([i / sr, 2]); spawn(off, 0.22e-3 * sr, a * cfg.clack.amp, 1, 0, 2); });
      }
      // sum the live events
      let pm = 0, bm = 0, pd = 0, pc = 0;
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k], d = i - p.t0, xp = d / p.tp, xb = d / p.tb;
        if (xp > 30 && xb > 30) { pulses[k] = pulses[pulses.length - 1]; pulses.pop(); continue; }
        const vp = p.ap * shape(xp);
        if (p.v === 0) { pm += vp; bm += p.ab * shape(xb); } else if (p.v === 1) pd += vp; else pc += vp;
      }
      const noise = rnd() * 2 - 1;
      const burst = bm ? burstF.run(noise * bm) * 2 : burstF.run(0) * 2;
      const src = pm + burst;
      // exhaust pipe (closed at the port, open at the tail: -refl per round trip, lossy)
      let rp = pw - pipeD; if (rp < 0) rp += PIPE;
      const i0 = rp | 0, fr = rp - i0, back = pipe[i0] * (1 - fr) + pipe[(i0 + 1) % PIPE] * fr;
      plp = (1 - pipeDamp) * back + pipeDamp * plp;
      const y = src - pipeRefl * plp;
      pipe[pw] = y; pw = (pw + 1) % PIPE;
      let body = pipeMix * y + (1 - pipeMix) * src + pd;
      // muffler: opens with load; rasp is the load-driven bark band
      if ((i & 15) === 1) toneF.set((cfg.toneHz || 1200) * (0.65 + 0.7 * loadS), 0.75);
      let out = toneF.run(body) + (cfg.rasp || 0) * loadS * raspF.run(body) * 1.5;
      // metal clacks
      let cl = 0;
      for (const m of modes) { const v = m.c1 * m.y1 + m.c2 * m.y2 + m.g * pc; m.y2 = m.y1; m.y1 = v; cl += v; }
      out += cl * 3;
      // whine: a tone locked to the crank (blower, gear, turbine), band-limited by refusing anything near Nyquist
      if (cfg.whine) {
        const wf = crankHz * (cfg.whineMul || 3);
        whPh += wf / sr; if (whPh >= 1) whPh -= 1;
        if (wf < sr * 0.4) out += cfg.whine * Math.min(1, crankHz / 8) * (Math.sin(2 * Math.PI * whPh) + (2 * wf < sr * 0.4 ? 0.3 * Math.sin(4 * Math.PI * whPh) : 0));
      }
      if (cfg.air) out += cfg.air * (0.35 + 0.65 * loadS) * Math.min(1.5, crankHz / 40 + 0.4) * airF.run(rnd() * 2 - 1);
      const dc = out - dcx + dcK * dcy; dcx = out; dcy = dc;
      return dc;
    },
  };
}

/* An rpm/load curve from keyframes [[t, rpm, load], ...]. rpm eases OUT on every segment (an engine gets most of a
 * rev change early, then creeps), load is linear (the model smooths it as a throttle). */
export function curveAt(kf, t) {
  if (t <= kf[0][0]) return { rpm: kf[0][1], load: kf[0][2] };
  for (let k = 1; k < kf.length; k++) {
    if (t <= kf[k][0]) {
      const a = kf[k - 1], b = kf[k], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]), e = 1 - Math.pow(1 - u, 2.2);
      return { rpm: a[1] + (b[1] - a[1]) * e, load: a[2] + (b[2] - a[2]) * u };
    }
  }
  const z = kf[kf.length - 1]; return { rpm: z[1], load: z[2] };
}
/* What the PARAMS rows would build: idle -> (at) rev to peak over `rise` -> hold -> let off to `end` over `fall`. */
export function motorCurve(p) {
  const t1 = p.at, t2 = t1 + p.rise, t3 = t2 + p.hold, t4 = t3 + p.fall;
  return [[0, p.idle, p.idleLoad ?? 0.25], [t1, p.idle, p.idleLoad ?? 0.25], [t2, p.peak, 1], [t3, p.peak, p.holdLoad ?? 0.8],
    [t3 + 0.03, p.peak * 0.985, 0.04], [t4, p.end, 0.06], [t4 + 0.15, p.end, p.idleLoad ?? 0.25]];
}
/* Render a mono buffer (peak 0.7). */
export function renderMotor(sr, cfg, dur, seed) {
  const N = Math.round(dur * sr), x = new Float32Array(N), m = makeMotor(sr, cfg, seed);
  for (let k = 0; k < N; k++) { const c = curveAt(cfg.curve, k / sr); x[k] = m.tick(c.rpm, c.load); }
  let pk = 0; for (let k = 0; k < N; k++) pk = Math.max(pk, Math.abs(x[k]));
  if (pk > 0) for (let k = 0; k < N; k++) x[k] *= 0.7 / pk;
  return { x, events: m.events };
}
/* The intended event rate at time t (events / s), for the verification. */
export function eventRate(cfg, t) {
  const r = curveAt(cfg.curve, t).rpm / 60;
  return (cfg.type === 0 ? r / 2 : r) * cfg.cyl;
}

// =====================================================================================================================
// THE ROUND
// =====================================================================================================================
const V8_BANKS = [1, 0.62, 0.62, 1, 0.62, 1, 1, 0.62];   // a cross-plane firing order heard from one side: L R R L R L L R
export const ROUNDS = {
  "car-engine": {
    title: "Car Engine", control: "Car Engine", dur: 1.6,
    listen: "A car engine. Listen for: does it sound like PISTONS firing (a pulse you can almost count at idle) rather than a buzzing tone? Does the character change when it revs, and does a rev down sound like the throttle closing (softer, burbling) rather than a pitch sweep reversed?",
    takes: [
      { id: "muscle-idle-blip", why: "A cross-plane V8 at a lumpy idle (~700 rpm, ~47 firings/s, the banks at different levels give the lope), one throttle blip to 2600 and back, overrun burble, a long 2.2 m exhaust and a hint of blower whine.",
        cfg: { type: 0, cyl: 8, cylAmp: V8_BANKS, rough: 0.3, wander: 0.5, pulseMs: 1.6, pulseAmp: 1, burstMs: 1.5, burstAmp: 0.3, burstHz: 1800,
          pipeLen: 2.2, pipeRefl: 0.62, pipeDamp: 0.35, toneHz: 900, rasp: 0.35, raspHz: 1100, air: 0.04, airHz: 900, whine: 0.025, whineMul: 2.6, pops: 0.35,
          curve: [[0, 680, 0.3], [0.55, 700, 0.3], [0.72, 2600, 1], [0.8, 2550, 0.6], [0.83, 2500, 0.04], [1.25, 760, 0.06], [1.6, 700, 0.3]] } },
      { id: "four-cyl-rev", why: "A small inline-four: idle ~900 rpm, a full rev to 5800 and back down (motorCurve: the shape the PARAMS rows would build), shorter brighter pipe, more rasp at the top.",
        cfg: { type: 0, cyl: 4, imbalance: 0.15, rough: 0.2, wander: 0.3, pulseMs: 0.9, burstMs: 1, burstAmp: 0.35, burstHz: 2500,
          pipeLen: 1.4, pipeRefl: 0.55, pipeDamp: 0.3, toneHz: 1600, rasp: 0.55, raspHz: 1700, air: 0.08, airHz: 1500, pops: 0.15,
          curve: motorCurve({ idle: 900, peak: 5800, end: 950, at: 0.2, rise: 0.45, hold: 0.1, fall: 0.6 }) } },
      { id: "pull-away", why: "An inline-six PULLING AWAY under load: no idle, no rev-down; rpm climbs steadily 1500 -> 4800 at full throttle, intake roar and a drivetrain whine rising with it, then a lift at the end.",
        cfg: { type: 0, cyl: 6, imbalance: 0.08, rough: 0.12, wander: 0.2, pulseMs: 1.1, burstMs: 1.2, burstAmp: 0.25, burstHz: 2000,
          pipeLen: 1.8, pipeRefl: 0.58, pipeDamp: 0.35, toneHz: 1300, rasp: 0.4, raspHz: 1400, air: 0.2, airHz: 1100, whine: 0.03, whineMul: 3.3, pops: 0.1,
          curve: [[0, 1500, 0.9], [1.4, 4800, 0.95], [1.47, 4750, 0.1], [1.6, 4300, 0.08]] } },
    ],
  },
  chainsaw: {
    title: "Chainsaw", control: "Chainsaw", dur: 1.6,
    listen: "A chainsaw. Listen for: the RASP of a small two-stroke (a fast, papery buzz with grit in it), whether the idle is irregular the way a small engine's is, and whether pulling the trigger makes it scream up.",
    takes: [
      { id: "idle-then-trigger", why: "Single-cylinder two-stroke: ragged idle at ~2800 rpm (misfiring, 'four-stroking'), the trigger pulled at 0.35 s, up to ~10000 rpm (~165 firings/s) and held. Tiny muffler, lots of rasp.",
        cfg: { type: 1, cyl: 1, rough: 0.55, wander: 0.5, pulseMs: 0.55, burstMs: 0.8, burstAmp: 0.7, burstHz: 3000, pipeLen: 0.35, pipeRefl: 0.5, pipeDamp: 0.25,
          toneHz: 3200, rasp: 0.85, raspHz: 2400, air: 0.08, airHz: 2500,
          curve: [[0, 2800, 0.2], [0.35, 2900, 0.2], [0.55, 9800, 1], [1.6, 10200, 0.9]] } },
      { id: "cutting-bog", why: "Already screaming at ~10000 rpm, then it BITES into wood: rpm sags to ~7700 under heavy load (louder, darker, more chip noise), and frees up again at 1.25 s.",
        cfg: { type: 1, cyl: 1, rough: 0.35, wander: 0.4, pulseMs: 0.55, burstMs: 0.9, burstAmp: 0.8, burstHz: 2600, pipeLen: 0.35, pipeRefl: 0.5, pipeDamp: 0.25,
          toneHz: 3000, rasp: 0.85, raspHz: 2200, air: 0.3, airHz: 3200,
          curve: [[0, 9600, 0.6], [0.3, 10000, 0.65], [0.45, 7700, 1], [1.1, 7900, 1], [1.28, 10200, 0.6], [1.6, 10000, 0.6]] } },
      { id: "pull-start", why: "The pull start: the starter cranks it (~500 rpm, mostly misfires), it catches at 0.45 s, flares to ~3500 and settles into a lumpy idle.",
        cfg: { type: 1, cyl: 1, rough: 0.75, wander: 0.6, pulseMs: 0.6, burstMs: 0.9, burstAmp: 0.7, burstHz: 2800, pipeLen: 0.35, pipeRefl: 0.5, pipeDamp: 0.25,
          toneHz: 2900, rasp: 0.8, raspHz: 2300, air: 0.06, airHz: 2500,
          curve: [[0, 420, 0.4], [0.2, 650, 0.4], [0.35, 520, 0.35], [0.5, 3500, 0.5], [0.7, 2900, 0.2], [1.6, 2800, 0.2]] } },
    ],
  },
  helicopter: {
    title: "Helicopter", control: "Helicopter", dur: 1.5,
    listen: "A helicopter. Listen for: the WHOP of the main rotor (a pulse around 10-25 times a second that is a slap, not a drum hit), the turbine whine above it, the tail rotor's faster buzz, and whether it sounds like air being chopped.",
    takes: [
      { id: "four-blade-hover", why: "A modern four-blade rotor hovering: 330 rpm × 4 = 22 slaps/s, rotor-wash swish on each, a two-blade tail rotor buzz (~57/s) and a turbine whine near 3 kHz.",
        cfg: { type: 2, cyl: 4, imbalance: 0.12, rough: 0.06, wander: 0.25, pulseMs: 2.6, pulseAmp: 1, burstMs: 7, burstAmp: 0.9, burstHz: 700, burstQ: 0.8,
          toneHz: 2600, whine: 0.05, whineMul: 560, air: 0.25, airHz: 1300, tail: { mul: 5.2, blades: 2, amp: 0.3, pulseMs: 1 },
          curve: [[0, 330, 0.7], [1.5, 330, 0.7]] } },
      { id: "two-blade-whop", why: "A big two-blade utility rotor: 320 rpm × 2 = ~11 deep WHOPs/s with a hard blade slap on each (the low, chopping sound), little whine, the tail quieter.",
        cfg: { type: 2, cyl: 2, imbalance: 0.08, rough: 0.05, wander: 0.2, pulseMs: 4.5, pulseAmp: 1.3, burstMs: 4, burstAmp: 1.4, burstHz: 450, burstQ: 1,
          toneHz: 1500, whine: 0.02, whineMul: 600, air: 0.18, airHz: 900, tail: { mul: 5.5, blades: 2, amp: 0.15, pulseMs: 1.2 },
          curve: [[0, 320, 0.8], [1.5, 325, 0.85]] } },
      { id: "spin-up", why: "Starting up: the rotor spins up from ~30 to ~310 rpm (a slow whoosh-whoosh becoming a chop), the turbine whine climbing with it.",
        cfg: { type: 2, cyl: 4, imbalance: 0.1, rough: 0.05, wander: 0.15, pulseMs: 2.8, burstMs: 9, burstAmp: 1, burstHz: 650, burstQ: 0.8,
          toneHz: 2400, whine: 0.09, whineMul: 560, air: 0.2, airHz: 1200, tail: { mul: 5.2, blades: 2, amp: 0.25, pulseMs: 1 },
          curve: [[0, 30, 0.6], [0.6, 120, 0.7], [1.5, 310, 0.8]] } },
    ],
  },
  train: {
    title: "Train", control: "Train", dur: 2.2,
    listen: "A train. Listen for: CHUFFS (steam puffs you can count, with the uneven chuff-a-chuff of a locomotive) or a diesel's drone, and RAIL CLACKS arriving in pairs. Does it sound like a heavy thing moving?",
    takes: [
      { id: "steam-departure", why: "A steam locomotive leaving the station: 4 chuffs per wheel turn, accelerating from ~1.7 to ~6 chuffs/s, uneven (one beat in four stronger), steam hiss under it, through a short chimney.",
        cfg: { type: 3, cyl: 4, cylAmp: [1, 0.68, 0.88, 0.62], rough: 0.15, wander: 0.2, pulseMs: 6, pulseAmp: 0.35, burstMs: 28, burstAmp: 1.2, burstHz: 750, burstQ: 0.7,
          pipeLen: 1.1, pipeRefl: 0.4, pipeDamp: 0.5, toneHz: 3500, air: 0.12, airHz: 5000,
          curve: [[0, 25, 0.9], [2.2, 90, 0.9]] } },
      { id: "steam-at-speed", why: "Steam at speed: ~10 chuffs/s blurring into a rhythm, with clickety-clack RAIL CLACKS in pairs (one rail joint, two axles of a bogie ~0.19 s apart) tied to the wheel speed.",
        cfg: { type: 3, cyl: 4, cylAmp: [1, 0.72, 0.9, 0.66], rough: 0.12, wander: 0.15, pulseMs: 4, pulseAmp: 0.3, burstMs: 14, burstAmp: 1.1, burstHz: 800, burstQ: 0.7,
          pipeLen: 1.1, pipeRefl: 0.4, pipeDamp: 0.5, toneHz: 3500, air: 0.15, airHz: 4500, clack: { amp: 0.5, perRev: 0.42, gapSec: 0.19 },
          curve: [[0, 148, 0.85], [2.2, 152, 0.85]] } },
      { id: "diesel-drone", why: "A diesel locomotive: a twelve-cylinder two-stroke at ~900 rpm (180 firings/s, a low drone with clatter), a long stack, the wheels' rumble, and rail clacks in pairs (~1.2 pairs/s).",
        cfg: { type: 1, cyl: 12, imbalance: 0.15, rough: 0.15, wander: 0.3, pulseMs: 1.4, burstMs: 1.2, burstAmp: 0.4, burstHz: 2600,
          pipeLen: 3, pipeRefl: 0.6, pipeDamp: 0.4, toneHz: 700, rasp: 0.2, raspHz: 500, air: 0.25, airHz: 260, clack: { amp: 0.45, hz: 1.2, gapSec: 0.17 },
          curve: [[0, 880, 0.8], [2.2, 920, 0.8]] } },
    ],
  },
  motorcycle: {
    title: "Motorcycle Rev (a GAP: no preset yet)", control: "Car Engine", dur: 1.8,
    listen: "A motorcycle, revved. Listen for: the uneven POTATO-POTATO of a twin at idle, a rev that barks, and the pops and crackle when the throttle snaps shut. (One take is the nearest existing preset, which is a car.)",
    takes: [
      { id: "v-twin-blip", why: "A 45-degree V-twin four-stroke: uneven firing (315 then 405 degrees) at a ~900 rpm idle, one blip to 4200, throttle snapped shut with overrun pops, back to idle.",
        cfg: { type: 0, cyl: 2, firing: [0, 315 / 720], cylAmp: [1, 0.85], rough: 0.3, wander: 0.5, pulseMs: 1.4, burstMs: 1.3, burstAmp: 0.35, burstHz: 1600,
          pipeLen: 1.1, pipeRefl: 0.65, pipeDamp: 0.3, toneHz: 1100, rasp: 0.45, raspHz: 900, air: 0.05, airHz: 900, pops: 0.8,
          curve: [[0, 880, 0.3], [0.55, 900, 0.3], [0.75, 4200, 1], [0.82, 4150, 0.7], [0.85, 4100, 0.03], [1.4, 1000, 0.05], [1.8, 900, 0.3]] } },
      { id: "sport-four-scream", why: "A sport inline-four four-stroke revving high: 4000 -> 13000 rpm (433 firings/s at the top), a bright short pipe, intake howl.",
        cfg: { type: 0, cyl: 4, imbalance: 0.06, rough: 0.12, wander: 0.2, pulseMs: 0.6, burstMs: 0.6, burstAmp: 0.3, burstHz: 3000,
          pipeLen: 0.9, pipeRefl: 0.5, pipeDamp: 0.25, toneHz: 3500, rasp: 0.6, raspHz: 2200, air: 0.22, airHz: 1800, pops: 0.3,
          curve: [[0, 4000, 0.4], [0.2, 4100, 0.6], [1.25, 13000, 1], [1.4, 12900, 0.6], [1.43, 12800, 0.04], [1.8, 8000, 0.05]] } },
      { id: "two-stroke-dirt", why: "A single-cylinder two-stroke dirt bike: ragged idle at 2000, two quick revs ('ring-ding') through a resonant expansion chamber, crackling on the way down.",
        cfg: { type: 1, cyl: 1, rough: 0.55, wander: 0.5, pulseMs: 0.7, burstMs: 0.8, burstAmp: 0.5, burstHz: 2600, pipeLen: 0.9, pipeRefl: 0.75, pipeDamp: 0.2,
          toneHz: 2600, rasp: 0.6, raspHz: 1800, air: 0.08, airHz: 2000, pops: 0.45,
          curve: [[0, 2000, 0.2], [0.3, 2100, 0.2], [0.55, 9000, 1], [0.6, 8900, 0.04], [0.9, 4200, 0.05], [1.1, 8600, 1], [1.15, 8500, 0.04], [1.6, 2300, 0.05], [1.8, 2100, 0.2]] } },
    ],
  },
};

// ---- the exported engine, as tools/make-ab.mjs loads it
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
function loadSynth() {
  const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
    Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
  ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx);
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  return { CS, PRESETS: pctx.window.PRESETS };
}

// ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, gated)
const TARGET_LUFS = -18;
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function kweight(x, SR) {
  const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, c = Math.cos(w), al = Math.sin(w) / (2 / Math.SQRT2), sa = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
    (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
  const w2 = 2 * Math.PI * 38 / SR, c2 = Math.cos(w2), al2 = Math.sin(w2) / (2 * 0.5);
  return biquad(s, (1 + c2) / 2, -(1 + c2), (1 + c2) / 2, 1 + al2, -2 * c2, 1 - al2);
}
export function lufs(L, R, SR) {
  const kl = kweight(L, SR), kr = kweight(R, SR), B = Math.round(0.4 * SR), H = Math.round(0.1 * SR), ms = [];
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
function matchLoudness(r, SR) {
  const L = Float32Array.from(r.L), R = Float32Array.from(r.R);
  let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R, SR)) / 20), pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
  if (pk > 0.95) gn *= 0.95 / pk;
  for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  return { L, R, lufs: lufs(L, R, SR), sec: L.length / SR };
}

// ---- verification
function verify(L, SR) {
  let nan = 0, pk = 0, ss = 0;
  for (let i = 0; i < L.length; i++) { const v = L[i]; if (!Number.isFinite(v)) nan++; else { pk = Math.max(pk, Math.abs(v)); ss += v * v; } }
  const rms = Math.sqrt(ss / L.length), w = Math.round(0.002 * SR);
  let sj = 0, ej = 0; for (let i = 1; i < w; i++) sj = Math.max(sj, Math.abs(L[i] - L[i - 1]));
  for (let i = L.length - w; i < L.length; i++) ej = Math.max(ej, Math.abs(L[i]));
  return { nan, pk, rms, first: Math.abs(L[0]), startStep: sj, endTail: ej, last: Math.abs(L[L.length - 1]) };
}
// periodicity of the amplitude envelope in a window, searched within ±35% of the intended rate (so a 4-stroke V8's
// cycle rate, a quarter of its firing rate, cannot be mistaken for it)
function measuredRate(x, SR, t0, win, hz) {
  const a = Math.round(t0 * SR), n = Math.min(Math.round(win * SR), x.length - a);
  if (n < 512 || !(hz > 0)) return null;
  const env = new Float64Array(n), k = 1 - Math.exp(-2 * Math.PI * Math.min(3000, hz * 3) / SR);
  let e = 0, mean = 0;
  for (let i = 0; i < n; i++) { e += (Math.abs(x[a + i]) - e) * k; env[i] = e; mean += e; }
  mean /= n; for (let i = 0; i < n; i++) env[i] -= mean;
  const lo = Math.floor(SR / (hz * 1.35)), hi = Math.ceil(SR / (hz * 0.65));
  if (hi > n / 2) return null;
  const ac = (L) => { let s = 0, p = 0, q = 0; for (let i = 0; i + L < n; i++) { s += env[i] * env[i + L]; p += env[i] * env[i]; q += env[i + L] * env[i + L]; } return s / Math.sqrt(p * q || 1); };
  let best = -2, bl = lo;
  for (let L = lo; L <= hi; L++) { const v = ac(L); if (v > best) { best = v; bl = L; } }
  return { hz: SR / bl, r: best };
}

// onsets: peaks of the envelope at least 0.6 of an intended period apart, above a third of the window's top; the
// median interval gives the rate. Reads a slow chuff (or a rate that is changing) where autocorrelation cannot.
function onsetRate(x, SR, t0, win, hz) {
  const a = Math.round(t0 * SR), n = Math.min(Math.round(win * SR), x.length - a), k = 1 - Math.exp(-2 * Math.PI * Math.min(3000, hz * 2.5) / SR);
  const env = new Float64Array(n); let e = 0, top = 0;
  for (let i = 0; i < n; i++) { e += (Math.abs(x[a + i]) - e) * k; env[i] = e; top = Math.max(top, e); }
  const gap = Math.round(0.6 * SR / hz), pk = [];
  for (let i = 1; i < n - 1; i++) {
    if (env[i] < top / 3 || env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    let ok = true; for (let j = Math.max(0, i - gap); j < Math.min(n, i + gap) && ok; j++) if (env[j] > env[i]) ok = false;
    if (ok && (!pk.length || i - pk[pk.length - 1] >= gap)) pk.push(i);
  }
  if (pk.length < 3) return null;
  const d = pk.slice(1).map((v, i) => v - pk[i]).sort((p, q) => p - q);
  return { hz: SR / d[d.length >> 1], n: pk.length };
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function run(name, R, CS, PRESETS) {
  const SR = CS.SR, out = join(ROOT, "soundtests", "proto-motor", name);
  mkdirSync(out, { recursive: true });
  const ctl = Object.assign({}, PRESETS[R.control]); delete ctl._vary;
  const takes = [{ id: "current-preset", why: "The CURRENT \"" + R.control + "\" preset (the control" + (R.control !== R.title ? ", the nearest existing preset" : "") + "), rendered by the exported engine.", patch: ctl }]
    .concat(R.takes);
  let seed = 0x5f3759df;
  for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const order = takes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const key = [], report = [];
  order.forEach((ti, slot) => {
    const t = takes[ti], file = "take-" + "ABCDEFGH"[slot] + ".wav";
    let r, meas = [];
    if (t.patch) r = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
    else {
      const m = renderMotor(SR, t.cfg, R.dur, 0x6d07 ^ (ti * 7919));
      // the room: the control's own reverb, through the real chain (wave 9 = the imported sample, at native speed)
      t.chain = { wave: 9, freq: 440, attack: 0.008, hold: 0, decay: 0, sustain: 1, release: 0.08, filterMode: 0, cutoff: 12000, reso: 0, drive: 0,
        bitcrush: 16, reverb: ctl.reverb || 0, reverbSize: ctl.reverbSize ?? 0.6, reverbTone: ctl.reverbTone ?? 0.5, duration: R.dur };
      r = CS.render(Object.assign({}, CS.DEFAULTS, t.chain), { normalize: true, sample: m.x });
      // rates: intended (curve), the model's own events, and measured on the finished audio
      for (const tq of [0.25, R.dur * 0.4, R.dur * 0.65, R.dur - 0.25]) {
        // the window holds at least four periods, so a 2/s chuff is measured over 2 s
        const W = Math.min(R.dur - 0.02, Math.max(0.3, 4.2 / eventRate(t.cfg, tq))), tc = Math.max(0, Math.min(R.dur - W, tq - W / 2));
        const tm = tc + W / 2, want = eventRate(t.cfg, tm);
        const evs = m.events.filter((e) => e[1] === 0 && e[0] >= tc && e[0] < tc + W).length / W;
        meas.push({ t: tm, want, model: evs, audio: null, tc, W });
      }
      t._meas = meas;
    }
    const f = matchLoudness(r, SR);
    if (t._meas) for (const q of t._meas) { q.audio = measuredRate(f.L, SR, q.tc, q.W, q.want); q.onset = onsetRate(f.L, SR, q.tc, q.W, q.want); }
    writeFileSync(join(out, file), Buffer.from(CS.encodeWav(f.L, f.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
    const v = verify(f.L, SR);
    const line = file + "  " + t.id.padEnd(20) + f.sec.toFixed(2) + " s  " + f.lufs.toFixed(1) + " LUFS  peak " + v.pk.toFixed(3) + "  nan " + v.nan +
      "  start|x0| " + v.first.toExponential(1) + " step2ms " + v.startStep.toFixed(4) + "  end2ms " + v.endTail.toFixed(4) + "  rms " + v.rms.toFixed(3);
    console.log("  " + line);
    const rates = (t._meas || []).map((q) => "      t=" + q.t.toFixed(2) + "s (window " + q.W.toFixed(2) + " s)  intended " + q.want.toFixed(1) + "/s  model " + q.model.toFixed(1) + "/s  audio " +
      (q.audio ? q.audio.hz.toFixed(1) + "/s (r " + q.audio.r.toFixed(2) + ")" : "n/a") + "  onsets " + (q.onset ? q.onset.hz.toFixed(1) + "/s (" + q.onset.n + " peaks)" : "n/a"));
    rates.forEach((l) => console.log(l));
    report.push(line + "\n" + rates.join("\n"));
    key.push({ file, t, f, v, rates });
  });
  writeFileSync(join(out, "LISTEN.md"), "# " + R.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCDEFGH"[takes.length - 1] +
    ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is today's preset.\n\n" + R.listen +
    "\n\nSay the letter (and a runner-up if two are close). If one is right in KIND but wrong in detail (too fast, too clean, too long a pipe), say so: the engine's knobs can move. `KEY.md` says what each one is: **read it after listening.**\n");
  writeFileSync(join(out, "KEY.md"), "# " + R.title + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
    k.f.sec.toFixed(2) + " s, " + k.f.lufs.toFixed(1) + " LUFS, peak " + k.v.pk.toFixed(3) + "\n" +
    (k.rates.length ? "\nFiring / slap / chuff rate (intended by the curve, counted from the model's events, measured on the audio):\n\n```\n" + k.rates.join("\n") + "\n```\n" : "") +
    "\n```json\n" + JSON.stringify(k.t.patch || { motor: k.t.cfg, chain: k.t.chain }) + "\n```\n").join("\n"));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "--list") { console.log(Object.keys(ROUNDS).join(", ")); process.exit(0); }
  const { CS, PRESETS } = loadSynth();
  const want = process.argv[2];
  const names = want ? [want] : Object.keys(ROUNDS);
  for (const n of names) { if (!ROUNDS[n]) { console.error("no round " + n); process.exit(1); } console.log(n); run(n, ROUNDS[n], CS, PRESETS); }
  writeFileSync(join(ROOT, "soundtests", "proto-motor", "README.md"), "# Motor engine prototype: the listening round\n\n" +
    "A prototype engine (`tools/proto/motor.mjs`, `makeMotor`) that builds vehicles and motors from FIRING EVENTS: a pulse per cylinder firing " +
    "(or rotor blade, or steam chuff) at the rate the rpm sets, each slightly irregular, through an exhaust-pipe resonator and a muffler, with " +
    "intake / mechanical noise, rotor tail buzz, turbine whine and rail clacks where the type calls for them. Load (the throttle) shapes the " +
    "firing, so a rev up barks and a rev down goes soft and pops.\n\n" +
    "One folder per sound: " + Object.keys(ROUNDS).map((n) => "`" + n + "/`").join(", ") + ". In each, today's preset is one of the takes " +
    "(for `motorcycle/`, a gap with no preset, it is the nearest one: Car Engine). Every take is matched to -18 LUFS and the order is shuffled.\n\n" +
    "**Room:** each model take is run through the REAL SFX chain as an imported sample (`CrunchySynth.render(patch, { sample })`, wave 9 at " +
    "freq 440 = native speed) with the control preset's own reverb settings, so all takes share one room, one master stage and one normalizer.\n\n" +
    "Read `LISTEN.md`, listen, pick; then read `KEY.md`. The question is whether firing events are the right LEVER for these sounds, " +
    "not which knob value is best.\n");
}
