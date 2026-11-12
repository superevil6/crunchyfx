/* servo.mjs — PROTOTYPE of a "servo" synthesis engine for CrunchySFX: electric motors, gearboxes and clockwork, built
 * from ONE SHAFT whose rotation every sound is locked to, rather than from an oscillator with a pitch sweep.
 *
 *   node tools/proto/servo.mjs              renders the round into soundtests/proto-servo/ (blind takes + the controls)
 *   node tools/proto/servo.mjs <round>      one round (--list names them)
 *   node tools/proto/servo.mjs alias        the aliasing probe: guarded model against an UNGUARDED control group
 *
 * The sibling of motor.mjs (combustion: a train of FIRING EVENTS through an exhaust pipe). Nothing here fires or has a
 * pipe: an electric motor turns smoothly, and what you hear is the rotation itself, at frequencies that are integer
 * multiples of the shaft speed.
 *
 * THE MODEL (makeServo, pure, portable the way dsp.js writes makeBrass / makeBubbles: no DOM, no Math.random, SR in):
 *
 *   target rps(t), load(t) ──> SHAFT: first-order inertia (spin-up tau; braked or COASTING spin-down tau), load sags
 *        │                     the speed; CURRENT = load + the torque the acceleration asks for (a kick on spin-up)
 *        │                     φ = unwrapped shaft revolutions (float64): everything below reads it
 *        ├─> MAGNETIC WHINE   Σ_k a_k sin(2π k·slots·φ), level ∝ current (a coasting motor's whine dies, its whir does not)
 *        ├─> COMMUTATOR       bars·φ crossings -> a smooth pulse (x² e^-x, sub-sample onset) + a SPARK noise burst
 *        │                    (bandpass), level ∝ current, per-bar level spread ∝ wear (the same pattern every rev)
 *        ├─> GEAR MESH        per stage: teeth × that stage's input-shaft rps, 3 harmonics, level ∝ 0.3 + load;
 *        │                    WEAR = AM + PM by the input shaft's rotation -> sidebands at mesh ± shaft rps
 *        ├─> KNOCKS           perRev × a chosen shaft (slats, a chipped tooth, a belt splice) -> gear-click modes
 *        ├─> ESCAPEMENT       (clockwork) 2 × escape-wheel teeth per rev: UNLOCK click, then the DROP a few ms later,
 *        │                    alternating pallets (tick / tock: two mode sets), into small-steel pawl modes
 *        ├─> RATCHET          a winding pawl over ratchet teeth (a time window, its own rate)
 *        ├─> STOP CLICK       when a powered move ends and the shaft settles: backlash taken up (gear-click modes),
 *        │                    level ∝ the move's speed; HOLD BUZZ: a holding servo's corrective kicks at its frame rate
 *        ├─> SUPPLY HUM       mains-locked 2f (magnetostriction) + f, 4f, 6f, gated by power;  PWM carrier ∝ current
 *        └─> BEARINGS         band noise ∝ speed; wear adds a low rumble
 *   everything mechanical ──> BODY: 5 normalized bandpass modes at a size-set frequency (the housing), mixed with dry
 *                         ──> DC block -> out
 *
 *   TYPES  0 brushless  whine + PWM; no commutator         2 geared     brushed + gear stages, stop click
 *          1 brushed    commutator buzz + spark + whine    3 clockwork  escapement + train whir, nothing electric
 *   A type only picks DEFAULTS for which parts are on; every part's level is a cfg field and can be set on any type.
 *
 * ANTI-ALIASING. Every sine term passes through guard(f): 1 below 0.30 SR, a raised-cosine fade to 0 at 0.42 SR, 0
 * above — so a whine harmonic fades out as the shaft speeds it toward Nyquist instead of folding back down. The
 * commutator pulse has a floor on its width (0.1 ms: its spectrum is 1/(1+jωτ)³, about -69 dB at Nyquist), and its
 * onset is placed at the sub-sample crossing. Clicks EXCITE resonators (digital 2-pole filters, every mode < 0.45 SR),
 * so a click's spectrum is the modes'. `node tools/proto/servo.mjs alias` measures it against cfg.noGuard.
 *
 * In the round, each take's model output runs through the REAL SFX chain as an imported sample (wave 9 at freq 440 =
 * native speed) with the CONTROL preset's own reverb: all five controls are dry, so every take here is dry too.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const SERVO_TYPES = ["brushless", "brushed", "geared", "clockwork"];

function lcg(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// TPT state-variable filter; bpn is the UNITY-PEAK bandpass (k·v1)
function svf(sr) {
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0, k = 1;
  const f = {
    lp: 0, bpn: 0, hp: 0,
    set(fc, q) {
      const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), sr * 0.45) / sr);
      k = 1 / q; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    },
    run(x) {
      const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
      f.lp = v2; f.bpn = k * v1; f.hp = x - k * v1 - v2;
      return f.bpn;
    },
  };
  return f;
}
// a bank of 2-pole resonators, impulse response ≈ level · e^-t/τ · sin(ωt) per unit-AREA input (input scaled by sinθ)
function modeBank(sr, list) {
  const m = list.filter(([f]) => f < sr * 0.45).map(([f, t60, lvl]) => {
    const r = Math.exp(-6.9 / (t60 * sr)), th = 2 * Math.PI * f / sr;
    return { c1: 2 * r * Math.cos(th), c2: -r * r, g: Math.sin(th) * lvl, y1: 0, y2: 0 };
  });
  return (x) => { let s = 0; for (const q of m) { const v = q.c1 * q.y1 + q.c2 * q.y2 + q.g * x; q.y2 = q.y1; q.y1 = v; s += v; } return s; };
}
// the pulse shape: x² e^-x, peak 1 at x = 2, AREA = 3.695 τ (so an excitation divides by it)
const G_NORM = 1 / (4 * Math.exp(-2)), AREA = 2 * G_NORM;
const shape = (x) => (x <= 0 ? 0 : x * x * Math.exp(-x) * G_NORM);

/* cfg (physical units; the PARAMS proposal in the report maps 0..1 knobs onto these). Every level is optional.
 *   type 0..3
 *   inertia (s: spin-up tau), decel (s: powered / braked spin-down tau, default = inertia), coast (s: unpowered,
 *     unbraked spin-down tau, default 4 × inertia), brake 0/1, sag 0..1 (speed lost at full load), ref (rps the levels
 *     are judged against, default the curve's top), wander 0..1, cog 0..1 (speed ripple, cogN per rev)
 *   slots, whine, whineK (harmonics), whineRoll (1/k^roll)
 *   bars (commutations per rev), comm, spark, sparkHz, commMs (pulse width; floored at minTauMs = 0.1)
 *   stages [{ teeth, ratio, amp }], mesh, wear 0..1
 *   knock { stage (-1 = motor shaft), perRev, amp, hz }  (hz: the gear-click modes' base)
 *   esc { teeth, amp, dropMs, tock (level of the second pallet), first (0..1: how soon the first tick) }
 *   ratchet { t0, t1, hz, amp },  stopClick, startClick, holdBuzz, frameHz, clickHz (gear-click base)
 *   hum, humHz, pwm, pwmHz, bearing, bearingHz, rumble
 *   size 0..1 (body: small plastic 2.6 kHz .. big frame 230 Hz), body (mix), pawlHz
 *   noGuard / minTauMs: the alias probe's control group only.
 * tick(targetRps, load) -> one sample. For clockwork, rps is the ESCAPE WHEEL's. */
export function makeServo(sr, cfg, seed) {
  const rnd = lcg(seed);
  const type = cfg.type | 0, electric = type !== 3;
  const guard = cfg.noGuard ? () => 1 : (f) => (f < 0.3 * sr ? 1 : f >= 0.42 * sr ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (f - 0.3 * sr) / (0.12 * sr)));
  const TWO_PI = 2 * Math.PI;
  // ---- parts and their defaults by type
  const slots = cfg.slots ?? (type === 0 ? 12 : 3);
  const whine = cfg.whine ?? (type === 0 ? 1 : electric ? 0.3 : 0);
  const whineK = cfg.whineK ?? 8, whineRoll = cfg.whineRoll ?? 1.3;
  const wA = Array.from({ length: whineK }, (_, k) => Math.pow(k + 1, -whineRoll));
  const bars = cfg.bars ?? (type === 1 || type === 2 ? 6 : 0);
  const comm = bars ? (cfg.comm ?? 1) : 0, spark = cfg.spark ?? 0.5;
  const wear = cfg.wear || 0;
  const barAmp = Array.from({ length: Math.max(1, bars) }, () => 1 + wear * 0.7 * (rnd() * 2 - 1));
  const stages = cfg.stages || [];
  const rIn = [], rOut = []; let rr = 1;
  for (const s of stages) { rIn.push(rr); rr *= s.ratio; rOut.push(rr); }
  const mesh = cfg.mesh ?? (type === 2 ? 0.8 : 0.5), meshH = [1, 0.45, 0.2];
  const hum = cfg.hum || 0, humHz = cfg.humHz || 60, pwm = cfg.pwm ?? 0, pwmHz = cfg.pwmHz || 9000;
  const bearing = cfg.bearing ?? 0.12, rumble = cfg.rumble ?? wear * 0.6;
  const minTau = (cfg.minTauMs ?? 0.1) * 1e-3 * sr;
  const stopClick = cfg.stopClick ?? (type === 2 ? 1 : 0), startClick = cfg.startClick ?? stopClick * 0.35;
  const holdBuzz = cfg.holdBuzz || 0, frameHz = cfg.frameHz || 50;
  const tauUp = cfg.inertia ?? 0.08, tauDec = cfg.decel ?? tauUp, tauCoast = cfg.coast ?? tauUp * 4;
  const sag = cfg.sag ?? 0.15, ref = cfg.ref || 100;
  // ---- the body (housing): 5 unity-peak bandpass modes at a size-set frequency
  const size = cfg.size ?? 0.4, bodyMix = cfg.body ?? 0.5, bodyHz = 2600 * Math.pow(2, -size * 3.5);
  const bodyModes = [1, 1.71, 2.62, 3.93, 5.4].map((r, k) => {
    const f = bodyHz * r * (1 + 0.02 * (rnd() * 2 - 1)), t60 = (0.03 + 0.2 * size) / Math.sqrt(r), F = svf(sr);
    F.set(f, Math.max(1.5, Math.PI * f * t60 / 6.91)); return { F, g: Math.pow(r, -0.4) * (k & 1 ? -1 : 1) };
  });
  // ---- click banks: gear clicks (stop, knocks, hold), two pallets (tick, tock), the ratchet
  const ch = cfg.clickHz || (1500 / (0.45 + size));
  const gearBank = modeBank(sr, [[ch, 0.05, 1], [ch * 1.62, 0.035, 0.8], [ch * 2.71, 0.022, 0.6], [ch * 3.9, 0.015, 0.45], [ch * 0.41, 0.06, 0.7]]);
  const knockHz = (cfg.knock && cfg.knock.hz) || ch * 0.7;
  const knockBank = modeBank(sr, [[knockHz, 0.08, 1], [knockHz * 1.83, 0.05, 0.7], [knockHz * 2.9, 0.03, 0.5], [knockHz * 0.47, 0.09, 0.8]]);
  const ph = cfg.pawlHz || 3400, pawlR = [[1, 0.05, 1], [1.48, 0.035, 0.8], [2.21, 0.025, 0.6], [2.93, 0.018, 0.45], [3.87, 0.012, 0.35]];
  const pawlA = modeBank(sr, pawlR.map(([r, t, l]) => [ph * r, t, l]));
  const pawlB = modeBank(sr, pawlR.map(([r, t, l]) => [ph * 0.93 * r * (1 + 0.015 * r), t * 0.9, l]));
  const rh = (cfg.ratchet && cfg.ratchet.hz2) || 4300;
  const ratchetBank = modeBank(sr, [[rh, 0.02, 1], [rh * 1.53, 0.014, 0.7], [rh * 2.4, 0.009, 0.5], [rh * 0.36, 0.03, 0.5]]);
  // ---- filters
  const sparkF = svf(sr); sparkF.set(cfg.sparkHz || 4200, 1.1);
  const bearF = svf(sr); bearF.set(cfg.bearingHz || 7000, 0.9);
  const rumF = svf(sr); rumF.set(180, 0.7);
  // ---- state
  let w = cfg.w0 || 0, phi = cfg.phi0 || 0, loadS = cfg.load0 ?? 0, I = 0, pow = 0, i = 0, t = 0;
  let peakW = 0, wasPowered = false, holding = false, holdPos = 0, ratchetPos = 0, tickN = 0;
  let wn = 0, wTarget = 0, wCount = 0, dcx = 0, dcy = 0;
  const kLoad = 1 - Math.exp(-1 / (0.03 * sr)), kI = 1 - Math.exp(-1 / (0.002 * sr)), kPow = 1 - Math.exp(-1 / (0.01 * sr));
  const kWn = 1 - Math.exp(-TWO_PI * 3 / sr), dcK = Math.exp(-TWO_PI * 15 / sr);
  const esc = cfg.esc, knock = cfg.knock, ratchet = cfg.ratchet;
  let pCommPos = bars * phi, pKnockPos = 0, pEscPos = esc ? 2 * esc.teeth * phi + (esc.first ?? 0.85) : 0;
  const pulses = [];   // { t0, tau, a, v }: v 0 comm tonal, 1 spark envelope, 2 gear clicks, 3 knock, 4 pawl A, 5 pawl B, 6 ratchet
  const events = [];   // diagnostics: [time s, kind]
  const trace = [];    // [time s, rps] every 32 samples
  function spawn(at, tau, a, v) { if (pulses.length < 128) pulses.push({ t0: at, tau: Math.max(v <= 1 ? minTau : 0.03e-3 * sr, tau), a, v }); }
  // a unit-area excitation (for a resonator): the pulse's amplitude divided by its area
  function strike(at, tauS, a, v) { const tau = Math.max(0.03e-3 * sr, tauS); spawn(at, tau, a / (AREA * tau), v); }
  // integer crossings of a position between two samples: calls fn(t0) at each sub-sample instant
  function crossings(p0, p1, fn) { if (!(p1 > p0)) return; for (let n = Math.floor(p0) + 1; n <= p1; n++) fn(i - 1 + (n - p0) / (p1 - p0)); }
  const acc = new Float64Array(7);
  return {
    events, trace,
    get rps() { return w; },
    tick(target, load) {
      i++; t = i / sr;
      loadS += (load - loadS) * kLoad;
      const powered = target > 0.01;
      pow += ((powered ? 1 : 0) - pow) * kPow;
      // ---- shaft
      const tgt = target * (1 - sag * loadS);
      const tau = tgt >= w ? tauUp : (powered || cfg.brake ? tauDec : tauCoast);
      const dw = (tgt - w) / (tau * sr);
      w = Math.max(0, w + dw);
      const accel = Math.abs(dw) * sr * tau / Math.max(1, ref);          // 1 at a full-scale step
      const Iwant = powered ? 0.12 + 0.6 * loadS + Math.min(1.2, accel) : (cfg.brake && w > 0.5 ? Math.min(1, accel) * 0.7 : 0);
      I += (Iwant - I) * kI;
      if (--wCount <= 0) { wTarget = rnd() * 2 - 1; wCount = (0.09 * sr) | 0; }
      wn += (wTarget - wn) * kWn;
      const wEff = w * (1 + (cfg.wander || 0) * 0.025 * wn + (cfg.cog || 0) * 0.02 * Math.sin(TWO_PI * (cfg.cogN || 4) * phi));
      phi += wEff / sr;
      if ((i & 31) === 0) trace.push([t, w]);
      const sg = w / (w + 2);   // nothing audible from a shaft that is barely turning
      let tonal = 0;
      // ---- magnetic whine
      if (whine && slots) {
        const f1 = slots * wEff, amp = whine * (0.08 + I) * sg;
        for (let k = 0; k < whineK; k++) { const g = guard(f1 * (k + 1)); if (g <= 0) break; tonal += amp * wA[k] * g * Math.sin(TWO_PI * ((k + 1) * slots * phi % 1)); }
      }
      // ---- commutator: a pulse + a spark burst per commutation
      if (comm) {
        const p1 = bars * phi;
        crossings(pCommPos, p1, (at) => {
          const bar = Math.floor(p1) % bars, a = barAmp[bar] * (0.15 + I) * sg * (1 + (cfg.commJitter ?? 0.15) * (rnd() * 2 - 1));
          const period = sr / Math.max(1, bars * wEff);
          spawn(at, Math.min(1.5e-3 * sr, Math.max(minTau, (cfg.commMs ? cfg.commMs * 1e-3 * sr : 0.12 * period))), comm * a, 0);
          spawn(at, Math.min(2e-3 * sr, 0.25 * period), comm * spark * a * (0.6 + 0.8 * rnd()), 1);
        });
        pCommPos = p1;
      }
      // ---- gear mesh, per stage; wear = AM + PM by the stage's input shaft
      for (let s = 0; s < stages.length; s++) {
        const st = stages[s], phIn = phi * rIn[s], fm = st.teeth * wEff * rIn[s];
        const mod = 1 + wear * (0.6 * Math.cos(TWO_PI * phIn) + 0.3 * Math.cos(2 * TWO_PI * phIn));
        const pm = wear * 0.5 * Math.sin(TWO_PI * phIn);
        const amp = mesh * (st.amp ?? 1) * (0.3 + 0.5 * loadS + 0.4 * Math.min(1, I)) * sg * mod;
        const base = st.teeth * phIn;
        for (let h = 0; h < 3; h++) { const g = guard(fm * (h + 1)); if (g <= 0) break; tonal += amp * meshH[h] * g * Math.sin(TWO_PI * ((h + 1) * base % 1) + (h + 1) * pm); }
      }
      // ---- knocks on a chosen shaft
      if (knock) {
        const p1 = knock.perRev * phi * (knock.stage >= 0 ? rOut[knock.stage] : 1);
        crossings(pKnockPos, p1, (at) => { events.push([at / sr, "knock"]); strike(at, 0.08e-3 * sr, knock.amp * (1 + (0.25 + wear * 0.5) * (rnd() * 2 - 1)) * Math.min(1, sg * 1.5), 3); });
        pKnockPos = p1;
      }
      // ---- escapement: unlock, then the drop; tick / tock alternate pallets
      if (esc) {
        const p1 = 2 * esc.teeth * phi + (esc.first ?? 0.85);
        crossings(pEscPos, p1, (at) => {
          const v = (tickN++ & 1) ? 5 : 4, lvl = esc.amp * ((v === 5) ? (esc.tock ?? 0.75) : 1) * (1 + 0.12 * (rnd() * 2 - 1));
          events.push([at / sr, "tick"]);
          strike(at, 0.05e-3 * sr, lvl * 0.35, v);
          strike(at + (esc.dropMs ?? 4) * 1e-3 * sr * (1 + 0.2 * (rnd() * 2 - 1)), 0.04e-3 * sr, lvl, v);
        });
        pEscPos = p1;
      }
      // ---- ratchet (winding)
      if (ratchet && t >= ratchet.t0 && t < ratchet.t1) {
        const p1 = ratchetPos + ratchet.hz * (1 + 0.25 * wn) / sr;
        crossings(ratchetPos, p1, (at) => { events.push([at / sr, "ratchet"]); strike(at, 0.04e-3 * sr, ratchet.amp * (0.8 + 0.4 * rnd()), 6); });
        ratchetPos = p1;
      }
      // ---- start / stop clicks and the holding buzz
      if (powered) {
        if (!wasPowered && startClick) { events.push([t, "start"]); strike(i, 0.06e-3 * sr, startClick * 0.5, 2); }
        peakW = Math.max(peakW, w); holding = false;
      } else if (peakW > 0 && w < 0.1 * peakW) {
        if (stopClick) { events.push([t, "stop"]); strike(i, 0.07e-3 * sr, stopClick * Math.sqrt(Math.min(1, peakW / ref)), 2); }
        peakW = 0; holding = true; holdPos = 0;
      }
      wasPowered = powered;
      if (holding && holdBuzz) {
        const p1 = holdPos + frameHz * (1 + 0.04 * wn) / sr;
        crossings(holdPos, p1, (at) => { events.push([at / sr, "hold"]); strike(at, 0.1e-3 * sr, holdBuzz * (0.3 + 0.7 * rnd()), 2); });
        holdPos = p1;
      }
      // ---- sum the live pulses
      acc.fill(0);
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k], x = (i - p.t0) / p.tau;
        if (x > 30) { pulses[k] = pulses[pulses.length - 1]; pulses.pop(); continue; }
        acc[p.v] += p.a * shape(x);
      }
      const n1 = rnd() * 2 - 1, n2 = rnd() * 2 - 1;
      const sparkOut = acc[1] ? sparkF.run(n1 * acc[1]) * 1.6 : sparkF.run(0) * 1.6;
      const clicks = gearBank(acc[2]) * 1.8, knocks = knockBank(acc[3]) * 1.2;
      const ticks = pawlA(acc[4]) + pawlB(acc[5]) + ratchetBank(acc[6]) * 0.8;
      // ---- electrical
      let elec = 0;
      if (hum) { const p = TWO_PI * humHz * t; elec += hum * pow * (0.35 * Math.sin(p) + Math.sin(2 * p) + 0.25 * Math.sin(4 * p) + 0.12 * Math.sin(6 * p)); }
      if (pwm) elec += pwm * Math.min(1, I) * guard(pwmHz) * Math.sin(TWO_PI * pwmHz * t);
      // ---- the structure, through the housing
      const struct = tonal + acc[0] * 0.6 + sparkOut + clicks + knocks + ticks * 0.35;
      let body = 0; for (const m of bodyModes) body += m.g * m.F.run(struct);
      // bearings and rumble ride on the speed
      const sp = Math.min(1.5, w / Math.max(1, ref));
      const air = bearing * sp * (1 + wear) * bearF.run(n2) + rumble * sp * rumF.run(n1) * 2.5;
      const out = struct + bodyMix * body * 1.5 + ticks * 0.65 + air + elec;
      const dc = out - dcx + dcK * dcy; dcx = out; dcy = dc;
      return dc;
    },
  };
}

/* A target-rps / load curve from keyframes [[t, rps, load], ...], LINEAR (the shaft's inertia does the easing; two
 * keyframes at the same time make a step, the way a controller switches). */
export function curveAt(kf, t) {
  if (t <= kf[0][0]) return { rps: kf[0][1], load: kf[0][2] ?? 0.3 };
  for (let k = 1; k < kf.length; k++) {
    if (t <= kf[k][0]) {
      const a = kf[k - 1], b = kf[k], u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
      return { rps: a[1] + (b[1] - a[1]) * u, load: (a[2] ?? 0.3) + ((b[2] ?? 0.3) - (a[2] ?? 0.3)) * u };
    }
  }
  const z = kf[kf.length - 1]; return { rps: z[1], load: z[2] ?? 0.3 };
}
/* What the PARAMS rows would build: off -> start at `at` (step to the start speed) -> ramp to peak over `rise` -> hold ->
 * ramp to end over `fall` -> power off (the shaft then brakes or coasts on its own tau). */
export function servoCurve(p) {
  const t1 = p.at || 0, t2 = t1 + p.rise, t3 = t2 + p.hold, t4 = t3 + p.fall, L = p.load ?? 0.3;
  return [[0, 0, L], [t1, 0, L], [t1, p.start, L], [t2, p.peak, L], [t3, p.peak, L], [t4, p.end, L], [t4, 0, L]];
}
/* Servo MOVES: short powered bursts [[t0, t1, rps], ...] with the power off between them. */
export function moves(list, load = 0.3) {
  const kf = [[0, 0, load]];
  for (const [a, b, r] of list) kf.push([a, 0, load], [a, r, load], [b, r, load], [b, 0, load]);
  return kf;
}
/* Render a mono buffer (peak 0.7), 3 ms fade in, 8 ms fade out. */
export function renderServo(sr, cfg, dur, seed) {
  const N = Math.round(dur * sr), x = new Float32Array(N), m = makeServo(sr, cfg, seed);
  for (let k = 0; k < N; k++) { const c = curveAt(cfg.curve, k / sr); x[k] = m.tick(c.rps, c.load); }
  const fi = Math.round(0.003 * sr), fo = Math.round(0.008 * sr);
  for (let k = 0; k < fi; k++) x[k] *= k / fi;
  for (let k = 0; k < fo; k++) x[N - 1 - k] *= k / fo;
  let pk = 0; for (let k = 0; k < N; k++) pk = Math.max(pk, Math.abs(x[k]));
  if (pk > 0) for (let k = 0; k < N; k++) x[k] *= 0.7 / pk;
  return { x, events: m.events, trace: m.trace };
}
/* The frequencies a cfg should produce at shaft speed w (rps), for the verification. */
export function lineFreqs(cfg, w) {
  const type = cfg.type | 0, out = [];
  const slots = cfg.slots ?? (type === 0 ? 12 : 3), whine = cfg.whine ?? (type === 0 ? 1 : type !== 3 ? 0.3 : 0);
  if (whine && slots) out.push(["whine (slots " + slots + " x rps)", slots * w]);
  const bars = cfg.bars ?? (type === 1 || type === 2 ? 6 : 0);
  if (bars && (cfg.comm ?? 1)) out.push(["commutator (bars " + bars + " x rps)", bars * w]);
  let r = 1;
  (cfg.stages || []).forEach((s, k) => { out.push(["mesh stage " + (k + 1) + " (" + s.teeth + " teeth x " + (w * r).toFixed(1) + " rps)", s.teeth * w * r]); r *= s.ratio; });
  if (cfg.hum) out.push(["hum 2 x " + (cfg.humHz || 60) + " Hz", 2 * (cfg.humHz || 60)]);
  return out;
}

// =====================================================================================================================
// THE ROUND
// =====================================================================================================================
// A small hobby servo's geartrain: a 10-tooth pinion on a ~10000 rpm motor and three reductions (about 220:1).
const HOBBY = [{ teeth: 10, ratio: 10 / 48, amp: 1 }, { teeth: 10, ratio: 10 / 42, amp: 0.7 }, { teeth: 12, ratio: 12 / 40, amp: 0.45 }];
const ROUNDS = {
  "servo-motor": {
    title: "Servo Motor", control: "Servo Motor", dur: 0.9,
    listen: "A servo motor (a robot arm, a turret turning, a camera panning). Listen for: does it sound like a MOTOR TURNING THROUGH GEARS (a whir whose pitch is the speed, with a gritty buzz in it) rather than a tone sliding up? Does it start and stop like a mechanism, with a click when it stops?",
    takes: [
      { id: "hobby-servo-sweep", why: "A small geared servo making one long move: a brushed motor kicks to ~170 rps (10200 rpm) in ~50 ms, the commutator buzz (6 x rps ~ 1 kHz) and the first gear mesh (10 teeth x rps ~ 1.7 kHz) on top of the slower stages (~350 Hz, ~100 Hz), braked to a stop with the backlash CLICK, then the faint 50 Hz buzz of the servo holding position.",
        cfg: { type: 2, slots: 3, bars: 6, comm: 0.9, spark: 0.6, sparkHz: 4500, stages: HOBBY, mesh: 0.9, wear: 0.12, inertia: 0.045, decel: 0.018, brake: 1, ref: 170,
          stopClick: 1.2, holdBuzz: 0.12, size: 0.15, body: 0.5, bearing: 0.08, wander: 0.4, cog: 0.3, curve: moves([[0.04, 0.68, 170]], 0.35) } },
      { id: "brushless-arm", why: "A larger brushless joint (an industrial arm): a 12-slot motor eased up to ~45 rps and back down (the whine 540 Hz glides up and down, no buzz), one planetary stage (14 teeth ~ 630 Hz), a faint 9 kHz drive carrier, a heavy metal housing, a soft clunk as it settles.",
        cfg: { type: 0, slots: 12, whine: 0.9, whineK: 8, whineRoll: 1.1, stages: [{ teeth: 14, ratio: 0.2, amp: 1 }], mesh: 0.5, pwm: 0.025, pwmHz: 9000, inertia: 0.06, decel: 0.05, brake: 1, ref: 45,
          stopClick: 0.7, clickHz: 900, size: 0.6, body: 0.6, bearing: 0.1, wander: 0.2, cog: 0.5, cogN: 8,
          curve: [[0, 0, 0.4], [0.03, 0, 0.4], [0.03, 6, 0.4], [0.33, 45, 0.5], [0.5, 45, 0.4], [0.78, 5, 0.3], [0.78, 0, 0.3]] } },
      { id: "seek-and-settle", why: "The hobby servo SEEKING a position: one long move, a short correction, a tiny final nudge, each ending in a stop click, then the holding buzz. Slightly worn gears (sidebands, uneven buzz).",
        cfg: { type: 2, slots: 3, bars: 6, comm: 0.9, spark: 0.7, sparkHz: 4200, stages: HOBBY, mesh: 0.9, wear: 0.35, inertia: 0.04, decel: 0.016, brake: 1, ref: 170,
          stopClick: 1.2, holdBuzz: 0.18, size: 0.15, body: 0.5, bearing: 0.08, wander: 0.4, cog: 0.3,
          curve: moves([[0.03, 0.38, 170], [0.47, 0.56, 150], [0.65, 0.69, 120]], 0.35) } },
    ],
  },
  "robot-servo": {
    title: "Robot Servo", control: "Robot Servo", dur: 0.45,
    listen: "A robot's joint moving (a head turning, an arm lifting): very short. Listen for: is it a small MECHANISM moving (a zip of motor and gears, a click at the end) rather than a beep sliding up? Which one would you believe is inside a robot?",
    takes: [
      { id: "quick-zip", why: "One quick move of a tiny geared servo: ~220 rps (commutator ~1.3 kHz, first mesh ~2.2 kHz), 0.23 s of motion, braked, a sharp plastic-gear stop click.",
        cfg: { type: 2, slots: 3, bars: 6, comm: 1, spark: 0.6, sparkHz: 5000, stages: HOBBY, mesh: 1, wear: 0.1, inertia: 0.03, decel: 0.012, brake: 1, ref: 220,
          stopClick: 1.4, size: 0.08, body: 0.45, bearing: 0.08, wander: 0.3, cog: 0.3, curve: moves([[0.03, 0.26, 220]], 0.35) } },
      { id: "two-step", why: "Two short zips (a move, then a smaller correction), each with its stop click, then the holding buzz: the 'zz-tk zz-tk' of a robot's joint.",
        cfg: { type: 2, slots: 3, bars: 6, comm: 1, spark: 0.6, sparkHz: 5000, stages: HOBBY, mesh: 1, wear: 0.15, inertia: 0.028, decel: 0.012, brake: 1, ref: 220,
          stopClick: 1.3, holdBuzz: 0.15, size: 0.08, body: 0.45, bearing: 0.08, wander: 0.3, cog: 0.3, curve: moves([[0.02, 0.16, 220], [0.23, 0.31, 180]], 0.35) } },
      { id: "brushless-glide", why: "A metal-gear brushless joint: a 9-slot whine (~1 kHz at 120 rps) gliding up and back down with a planetary mesh, smooth (no commutator), and a firm clunk at the end.",
        cfg: { type: 0, slots: 9, whine: 1, whineK: 8, whineRoll: 1.0, stages: [{ teeth: 12, ratio: 0.25, amp: 1 }, { teeth: 15, ratio: 0.25, amp: 0.5 }], mesh: 0.6, pwm: 0.03, pwmHz: 12000,
          inertia: 0.04, decel: 0.03, brake: 1, ref: 120, stopClick: 1, clickHz: 1300, size: 0.3, body: 0.55, bearing: 0.1, cog: 0.4, cogN: 6,
          curve: [[0, 0, 0.4], [0.02, 0, 0.4], [0.02, 10, 0.4], [0.17, 120, 0.45], [0.24, 120, 0.4], [0.36, 8, 0.3], [0.36, 0, 0.3]] } },
    ],
  },
  "mechanical-whir": {
    title: "Mechanical Whir", control: "Mechanical Whir", dur: 1.3,
    listen: "A machine whirring up, running and whirring down (a fan, a drill-like motor, a device powering on). Listen for: is the pitch the SPEED of something spinning (it comes up with the spin-up and falls as it slows), and does it sound like a motor (buzz, bearings) rather than a synth note with vibrato?",
    takes: [
      { id: "brushed-spin", why: "A bare brushed DC motor: power on, spins up to ~90 rps in ~0.25 s (the starting current makes the buzz loudest on the way up), runs, and at 0.85 s the power is cut and it COASTS down: the electrical buzz stops at once, the mechanical whir and bearing hiss spin down slowly. Commutator 10 x rps ~ 900 Hz.",
        cfg: { type: 1, slots: 5, bars: 10, comm: 0.9, spark: 0.55, sparkHz: 3800, whine: 0.35, inertia: 0.09, coast: 0.45, ref: 90, size: 0.35, body: 0.45, bearing: 0.25, bearingHz: 6000,
          wander: 0.3, cog: 0.4, cogN: 5, curve: [[0, 0, 0.3], [0.02, 0, 0.3], [0.02, 90, 0.3], [0.85, 90, 0.3], [0.85, 0, 0]] } },
      { id: "worn-gear-train", why: "A gearmotor with two worn stages: the meshes (11 teeth x 60 rps = 660 Hz; ~150 Hz) carry SIDEBANDS from the wear (a rough, warbling grind) and one chipped tooth knocks once per turn of the second shaft. Up, run, down.",
        cfg: { type: 2, slots: 5, bars: 10, comm: 0.6, spark: 0.4, stages: [{ teeth: 11, ratio: 11 / 47, amp: 1 }, { teeth: 10, ratio: 10 / 39, amp: 0.8 }], mesh: 1.1, wear: 0.65,
          knock: { stage: 0, perRev: 1, amp: 0.5 }, inertia: 0.12, decel: 0.15, coast: 0.3, ref: 60, stopClick: 0.4, size: 0.45, body: 0.55, bearing: 0.2, rumble: 0.35, wander: 0.4,
          curve: [[0, 0, 0.5], [0.02, 0, 0.5], [0.02, 60, 0.6], [0.9, 60, 0.6], [0.9, 0, 0]] } },
      { id: "induction-hum", why: "A mains (AC) induction motor: the 120 Hz HUM arrives the instant the power does, the rotor whine (28 bars x ~29 rps ~ 810 Hz) climbs as it spins up, a cooling fan's air, and when switched off the hum stops dead and the whine falls away on a long coast.",
        cfg: { type: 0, slots: 28, whine: 0.5, whineK: 5, whineRoll: 1.6, hum: 0.35, humHz: 60, inertia: 0.18, coast: 0.6, ref: 29.5, size: 0.55, body: 0.4, bearing: 0.35, bearingHz: 2500,
          wander: 0.15, curve: [[0, 0, 0.3], [0.02, 0, 0.3], [0.02, 29.5, 0.3], [0.8, 29.5, 0.3], [0.8, 0, 0]] } },
    ],
  },
  "conveyor-belt": {
    title: "Conveyor Belt", control: "Conveyor Belt", dur: 1.3,
    listen: "A conveyor belt running in a factory. Listen for: a motor-and-gearbox drone UNDER a steady clatter of things passing over rollers, and whether the clatter's speed sounds tied to the machine's speed.",
    takes: [
      { id: "slat-conveyor", why: "Steel slats over a roller: a gearmotor (induction, 120 Hz hum, rotor whine ~700 Hz) through two helical stages (~325 Hz, ~59 Hz) turning the head roller at ~1 rps; 9 slats per turn CLACK ~9 times a second (8.7 once the load sags the motor) on a big sheet-metal frame.",
        cfg: { type: 0, slots: 28, whine: 0.35, whineK: 5, whineRoll: 1.6, hum: 0.25, humHz: 60, stages: [{ teeth: 13, ratio: 13 / 61, amp: 1 }, { teeth: 11, ratio: 11 / 57, amp: 0.8 }], mesh: 0.6,
          knock: { stage: 1, perRev: 9, amp: 1.4, hz: 520 }, w0: 25, inertia: 0.2, ref: 25, size: 0.85, body: 0.55, bearing: 0.15, bearingHz: 3500, rumble: 0.25, wander: 0.3,
          curve: [[0, 25, 0.6], [1.3, 25, 0.6]] } },
      { id: "belt-rumble", why: "A rubber belt: the same gearmotor quieter, the rollers' bearings rumbling (worn), and only a soft thump when the belt's splice passes a roller (~2.3 a second). The drone is the sound; the clatter is not.",
        cfg: { type: 0, slots: 28, whine: 0.3, whineK: 5, whineRoll: 1.6, hum: 0.2, humHz: 60, stages: [{ teeth: 13, ratio: 13 / 61, amp: 1 }, { teeth: 11, ratio: 11 / 57, amp: 0.8 }], mesh: 0.55, wear: 0.4,
          knock: { stage: 1, perRev: 2.2, amp: 0.8, hz: 260 }, w0: 25, inertia: 0.2, ref: 25, size: 0.9, body: 0.5, bearing: 0.25, bearingHz: 1800, rumble: 0.8, wander: 0.3,
          curve: [[0, 25, 0.7], [1.3, 25, 0.7]] } },
      { id: "slat-start-up", why: "The slat conveyor STARTING: the hum arrives with the switch, the motor pulls up to speed over ~0.5 s against the loaded belt, and the clatter accelerates from nothing to ~9 a second with it.",
        cfg: { type: 0, slots: 28, whine: 0.35, whineK: 5, whineRoll: 1.6, hum: 0.25, humHz: 60, stages: [{ teeth: 13, ratio: 13 / 61, amp: 1 }, { teeth: 11, ratio: 11 / 57, amp: 0.8 }], mesh: 0.6,
          knock: { stage: 1, perRev: 9, amp: 1.4, hz: 520 }, inertia: 0.28, sag: 0.08, ref: 25, size: 0.85, body: 0.55, bearing: 0.15, bearingHz: 3500, rumble: 0.25, wander: 0.3,
          curve: [[0, 0, 0.9], [0.02, 0, 0.9], [0.02, 25, 0.9], [1.3, 25, 0.7]] } },
    ],
  },
  "clockwork-whir": {
    title: "Clockwork Whir", control: "Clockwork Whir", dur: 0.85,
    listen: "A wind-up clockwork mechanism running (a toy, a music box's works, a clockwork trap). Listen for: TICKS you can count, each a small hard metal click, and whether it sounds like a spring running down (slowing) inside a little metal mechanism.",
    takes: [
      { id: "escapement-run-down", why: "An escapement: a 15-tooth escape wheel, two ticks per tooth (tick and tock on two pallets, each an UNLOCK click then the DROP 4 ms later), ~11 ticks/s slowing to ~7 as the spring unwinds, a faint train whir under it, in a small brass case.",
        cfg: { type: 3, esc: { teeth: 15, amp: 1, dropMs: 4, tock: 0.7, first: 0.85 }, stages: [{ teeth: 8, ratio: 6, amp: 1 }, { teeth: 8, ratio: 6, amp: 0.6 }], mesh: 0.06,
          w0: 0.37, inertia: 0.05, ref: 1, pawlHz: 3600, size: 0.2, body: 0.35, bearing: 0.01, wander: 0.2,
          curve: [[0, 0.37, 0.3], [0.85, 0.24, 0.3]] } },
      { id: "governor-whir", why: "A wind-up toy with an air-brake governor: the spring drives a fast gear train (the fly at ~60 rps: its 8-tooth pinion meshes at ~490 Hz, the next wheel's at ~80 Hz, a soft buzzing whir) slowing as the spring runs down, plus the walking cam's pawl clicking once per turn of the second wheel, ~10 times a second slowing to ~7.",
        cfg: { type: 3, stages: [{ teeth: 8, ratio: 1 / 6, amp: 1 }, { teeth: 8, ratio: 1 / 6, amp: 0.7 }], mesh: 0.9, wear: 0.25, knock: { stage: 0, perRev: 1, amp: 0.9, hz: 2600 },
          w0: 62, inertia: 0.3, ref: 60, size: 0.12, body: 0.45, bearing: 0.06, bearingHz: 5000, wander: 0.5, cog: 0.6, cogN: 1,
          curve: [[0, 62, 0.4], [0.85, 40, 0.4]] } },
      { id: "wind-then-run", why: "Wound, then let go: a key turns the ratchet (~22 pawl clicks/s for 0.3 s), then the escapement is released and runs fast (~14 ticks/s) and slows (~8/s) as the spring gives up its first rush.",
        cfg: { type: 3, esc: { teeth: 15, amp: 1, dropMs: 3.5, tock: 0.72, first: 0.6 }, ratchet: { t0: 0.0, t1: 0.3, hz: 22, amp: 0.7, hz2: 4800 }, stages: [{ teeth: 8, ratio: 6, amp: 1 }], mesh: 0.05,
          inertia: 0.04, ref: 1, pawlHz: 3300, size: 0.2, body: 0.35, bearing: 0.01, wander: 0.2,
          curve: [[0, 0, 0.3], [0.33, 0, 0.3], [0.33, 0.48, 0.3], [0.85, 0.27, 0.3]] } },
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

// ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, gated) with its 0.95 peak cap
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
function lufs(L, R, SR) {
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
// Hann-windowed DFT magnitude at one frequency (Goertzel), on x[a .. a+n)
function mag(x, a, n, f, SR) {
  const c = 2 * Math.cos(2 * Math.PI * f / SR); let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s0 = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))) + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / (n / 4);
}
// the strongest line within ±span of f0, and its prominence over the median of the scan (dB)
function peakNear(x, SR, t0, win, f0, span0 = 0.07) {
  const span = Math.max(span0, 45 / f0);   // never narrower than ±45 Hz, or the whole scan sits inside one Hann main lobe
  const a = Math.max(0, Math.round(t0 * SR)), n = Math.min(Math.round(win * SR), x.length - a);
  const step = Math.max(0.5, f0 * span / 120), m = [];
  for (let f = f0 * (1 - span); f <= f0 * (1 + span); f += step) m.push([f, mag(x, a, n, f, SR)]);
  let best = m[0]; for (const q of m) if (q[1] > best[1]) best = q;
  const med = m.map((q) => q[1]).sort((p, q) => p - q)[m.length >> 1];
  return { hz: best[0], prom: 20 * Math.log10(best[1] / Math.max(1e-12, med)) };
}
// onsets (from motor.mjs): envelope peaks at least 0.6 of an intended period apart, above a third of the window's top
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
// onsets of the HIGH band only (>2 kHz, a one-pole-pair HP) — reads a click train under a low drone
function hpCopy(x, SR, fc) {
  const y = new Float32Array(x.length), k = Math.exp(-2 * Math.PI * fc / SR); let a = 0, b = 0, px = 0, py = 0;
  for (let i = 0; i < x.length; i++) { a = x[i] - px + k * a; px = x[i]; b = a - py + k * b; py = a; y[i] = b; }
  return y;
}
// the window where the shaft is fastest and steadiest (for the line measurements)
function holdWindow(trace, dur) {
  let best = null;
  for (const W of [0.2, 0.12, 0.08, 0.05]) {
    for (let a = 0; a < trace.length; a++) {
      const t0 = trace[a][0]; if (t0 + W > dur - 0.02) break;
      let lo = Infinity, hi = 0, s = 0, n = 0;
      for (let b = a; b < trace.length && trace[b][0] < t0 + W; b++) { lo = Math.min(lo, trace[b][1]); hi = Math.max(hi, trace[b][1]); s += trace[b][1]; n++; }
      const mean = s / n;
      if (mean > 0 && (hi - lo) / mean < 0.03 && (!best || mean > best.w * 1.001)) best = { t0, W, w: mean };
    }
    if (best) return best;
  }
  // a glide never holds still: take 50 ms around the top speed and say how far it moved inside it
  let top = 0; for (let a = 0; a < trace.length; a++) if (trace[a][1] > trace[top][1]) top = a;
  const t0 = Math.max(0, Math.min(dur - 0.07, trace[top][0] - 0.025)); let lo = Infinity, hi = 0, s = 0, n = 0;
  for (const [tt, ww] of trace) if (tt >= t0 && tt < t0 + 0.05) { lo = Math.min(lo, ww); hi = Math.max(hi, ww); s += ww; n++; }
  return n ? { t0, W: 0.05, w: s / n, glide: (hi - lo) / (s / n) } : null;
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function measureTake(t, m, L, SR, dur) {
  const lines = [];
  const hw = holdWindow(m.trace, dur);
  if (hw && hw.w > 2) {
    lines.push("shaft " + hw.w.toFixed(2) + " rps (" + (hw.w * 60).toFixed(0) + " rpm), " + (hw.glide != null ? "gliding (" + (100 * hw.glide).toFixed(1) + "% inside)" : "steady") + " window " + hw.t0.toFixed(2) + "-" + (hw.t0 + hw.W).toFixed(2) + " s");
    for (const [what, f] of lineFreqs(t.cfg, hw.w)) {
      if (f < 30 || f > SR * 0.42) { lines.push("  " + what + ": intended " + f.toFixed(1) + " Hz (out of measuring range)"); continue; }
      const p = peakNear(L, SR, hw.t0, hw.W, f);
      lines.push("  " + what + ": intended " + f.toFixed(1) + " Hz, measured " + p.hz.toFixed(1) + " Hz (" + (100 * (p.hz / f - 1)).toFixed(2) + "%), prominence " + p.prom.toFixed(1) + " dB");
    }
  } else if (hw) lines.push("shaft " + hw.w.toFixed(3) + " rps at its steadiest (" + hw.t0.toFixed(2) + " s): a clockwork escape wheel; its rate is read from the ticks");
  const kinds = {};
  for (const [tm, k] of m.events) (kinds[k] = kinds[k] || []).push(tm);
  for (const k of Object.keys(kinds)) {
    const ts = kinds[k];
    if (ts.length < 4) { lines.push(k + ": " + ts.length + " at " + ts.map((v) => v.toFixed(3) + " s").join(", ")); continue; }
    // early and late halves, so a slowing escapement shows its slowing
    const mid = ts[ts.length >> 1];
    for (const [a, b] of [[ts[0], mid], [mid, ts[ts.length - 1]]]) {
      const cnt = ts.filter((v) => v >= a && v < b).length, want = cnt / Math.max(1e-6, b - a);
      const hp = hpCopy(L, SR, k === "knock" ? 300 : 1800);
      const o = onsetRate(hp, SR, Math.max(0, a - 0.5 / want), Math.min(dur - a, b - a + 1 / want), want);
      lines.push(k + " " + a.toFixed(2) + "-" + b.toFixed(2) + " s: model " + want.toFixed(1) + "/s, audio onsets " + (o ? o.hz.toFixed(1) + "/s (" + o.n + " peaks)" : "n/a"));
    }
  }
  return lines;
}

function run(name, R, CS, PRESETS) {
  const SR = CS.SR, out = join(ROOT, "soundtests", "proto-servo", name);
  mkdirSync(out, { recursive: true });
  const ctl = Object.assign({}, PRESETS[R.control]); delete ctl._vary;
  const takes = [{ id: "current-preset", why: "The CURRENT \"" + R.control + "\" preset (the control), rendered by the exported engine.", patch: ctl }].concat(R.takes);
  let seed = 0x5f3759df;
  for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const order = takes.map((_, i) => i);
  // the HIGH bits of the LCG (make-ab.mjs, 2026-11-10: the low bits put the control first too often)
  for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const key = [];
  order.forEach((ti, slot) => {
    const t = takes[ti], file = "take-" + "ABCDEFGH"[slot] + ".wav", dur = t.dur || R.dur;
    let r, m = null;
    if (t.patch) r = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
    else {
      m = renderServo(SR, t.cfg, dur, 0x5e70 ^ (ti * 7919));
      // the room: the control's own reverb (none, for all five) through the real chain; wave 9 = the sample at native speed
      t.chain = { wave: 9, freq: 440, attack: 0.004, hold: 0, decay: 0, sustain: 1, release: 0.02, filterMode: 0, cutoff: 16000, reso: 0, drive: 0,
        bitcrush: 16, reverb: ctl.reverb || 0, reverbSize: ctl.reverbSize ?? 0.6, reverbTone: ctl.reverbTone ?? 0.5, duration: dur };
      r = CS.render(Object.assign({}, CS.DEFAULTS, t.chain), { normalize: true, sample: m.x });
    }
    const f = matchLoudness(r, SR), v = verify(f.L, SR);
    writeFileSync(join(out, file), Buffer.from(CS.encodeWav(f.L, f.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
    const meas = m ? measureTake(t, m, f.L, SR, dur) : [];
    const line = file + "  " + t.id.padEnd(20) + f.sec.toFixed(2) + " s  " + f.lufs.toFixed(1) + " LUFS  peak " + v.pk.toFixed(3) + "  nan " + v.nan +
      "  |x0| " + v.first.toExponential(1) + "  step2ms " + v.startStep.toFixed(4) + "  end2ms " + v.endTail.toFixed(4) + "  rms " + v.rms.toFixed(3);
    console.log("  " + line); for (const l of meas) console.log("      " + l);
    key.push({ file, t, f, v, meas });
  });
  writeFileSync(join(out, "LISTEN.md"), "# " + R.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCDEFGH"[takes.length - 1] +
    ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is the current preset.\n\n" + R.listen +
    "\n\nSay the letter (and a runner-up if two are close). If one is right in KIND but wrong in detail (too fast, too clean, too buzzy, the click too loud), say so: the engine's knobs can move. `KEY.md` says what each one is: **read it after listening.**\n");
  writeFileSync(join(out, "KEY.md"), "# " + R.title + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
    k.f.sec.toFixed(2) + " s, " + k.f.lufs.toFixed(1) + " LUFS, peak " + k.v.pk.toFixed(3) + "\n" +
    (k.meas.length ? "\nMeasured on the finished take (intended from the shaft speed and the cfg; rates counted from the model's events and from onsets in the audio):\n\n```\n" + k.meas.join("\n") + "\n```\n" : "") +
    "\n```json\n" + JSON.stringify(k.t.patch || { servo: k.t.cfg, chain: k.t.chain }) + "\n```\n").join("\n"));
}

/* THE ALIAS PROBE. A whine pushed to where its harmonics cross Nyquist, and a commutator pulse train with harmonics far
 * past it. For every harmonic above SR/2 the probe reads the level at the frequency it would FOLD to, relative to the
 * fundamental — on the guarded model and on a control group with the guard off (noGuard / a 0.01 ms pulse), so a meter
 * that cannot see aliasing would read the same twice. */
function aliasProbe(SR) {
  const run1 = (cfg, f1, label) => {
    const N = Math.round(0.6 * SR), m = makeServo(SR, cfg, 7), x = new Float32Array(N);
    for (let k = 0; k < N; k++) x[k] = m.tick(cfg.w0, 0.3);
    const a = Math.round(0.1 * SR), n = N - a, ref = mag(x, a, n, f1, SR);
    let worst = -300, at = 0, cnt = 0;
    for (let k = 2; k * f1 < SR * 3; k++) {
      const f = k * f1; if (f < SR / 2) continue;
      let fo = f % SR; if (fo > SR / 2) fo = SR - fo;
      // skip a fold that lands on a true harmonic, or below 100 Hz
      const nearest = Math.round(fo / f1) * f1;
      if (Math.abs(fo - nearest) < 40 || fo < 100) continue;
      const d = 20 * Math.log10(Math.max(1e-15, mag(x, a, n, fo, SR)) / ref); cnt++;
      if (d > worst) { worst = d; at = fo; }
    }
    console.log("  " + label.padEnd(48) + "fundamental " + f1.toFixed(0) + " Hz; " + cnt + " fold positions; worst alias " + worst.toFixed(1) + " dB at " + at.toFixed(0) + " Hz");
  };
  const quiet = { sag: 0, load0: 0.3, bearing: 0, rumble: 0, hum: 0, pwm: 0, body: 0, wander: 0, cog: 0, stopClick: 0, startClick: 0, inertia: 0.05, ref: 330 };
  const whine = Object.assign({}, quiet, { type: 0, slots: 12, whine: 1, whineK: 12, whineRoll: 0.6, w0: 333 });
  console.log("alias probe (SR " + SR + ")");
  run1(whine, 12 * 333, "whine 12 slots @ 333 rps, guarded");
  run1(Object.assign({}, whine, { noGuard: true }), 12 * 333, "whine 12 slots @ 333 rps, NO guard (control)");
  const commC = Object.assign({}, quiet, { type: 1, slots: 3, whine: 0, bars: 6, comm: 1, spark: 0, commJitter: 0, w0: 290, ref: 290 });
  run1(commC, 6 * 290, "commutator 6/rev @ 290 rps, 0.1 ms floor");
  run1(Object.assign({}, commC, { minTauMs: 0.01, commMs: 0.01 }), 6 * 290, "commutator, 0.01 ms pulse (control)");
  const meshC = Object.assign({}, quiet, { type: 2, slots: 3, whine: 0, bars: 0, stages: [{ teeth: 40, ratio: 1 }], mesh: 1, w0: 200 });
  run1(meshC, 40 * 200, "mesh 40 teeth @ 200 rps, guarded");
  run1(Object.assign({}, meshC, { noGuard: true }), 40 * 200, "mesh 40 teeth @ 200 rps, NO guard (control)");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2];
  if (arg === "--list") { console.log(Object.keys(ROUNDS).join(", ")); process.exit(0); }
  if (arg === "alias") { aliasProbe(44100); process.exit(0); }
  const { CS, PRESETS } = loadSynth();
  const names = arg ? [arg] : Object.keys(ROUNDS);
  for (const n of names) { if (!ROUNDS[n]) { console.error("no round " + n); process.exit(1); } if (!PRESETS[ROUNDS[n].control]) { console.error("no preset " + ROUNDS[n].control); process.exit(1); } console.log(n); run(n, ROUNDS[n], CS, PRESETS); }
  if (!arg) aliasProbe(CS.SR);
  writeFileSync(join(ROOT, "soundtests", "proto-servo", "README.md"), "# Servo engine prototype: the listening round\n\n" +
    "A prototype engine (`tools/proto/servo.mjs`, `makeServo`) for electric motors, gearboxes and clockwork, built from ONE SHAFT whose " +
    "rotation every sound is locked to: a magnetic whine at (rotor slots x revolutions per second) and its harmonics, a brushed motor's " +
    "commutator buzz and sparks, a gear-mesh tone per gear stage (teeth x that shaft's speed, with sidebands when worn), mains hum, " +
    "bearing hiss, knocks once per turn of a chosen shaft, and for clockwork an ESCAPEMENT (a pawl striking a tooth: an unlock click then " +
    "the drop, tick and tock on two pallets) and a winding ratchet. Speed follows the power with inertia (a kick of current on the way up, " +
    "a braked stop or a long coast), and a servo's move ends in a backlash click.\n\n" +
    "One folder per sound: " + Object.keys(ROUNDS).map((n) => "`" + n + "/`").join(", ") + ". In each, today's preset is one of the takes. " +
    "Every take is matched to -18 LUFS and the order is shuffled (the shuffle uses the HIGH bits of its LCG).\n\n" +
    "**Room:** each model take is run through the REAL SFX chain as an imported sample (`CrunchySynth.render(patch, { sample })`, wave 9 at " +
    "freq 440 = native speed) with the control preset's own reverb settings. All five controls are DRY (no reverb), so every take here is dry, " +
    "the same as `proto-motor/` and the others: one room (none), one master stage, one normalizer.\n\n" +
    "Read `LISTEN.md`, listen, pick; then read `KEY.md`. The question is whether a shaft-locked mechanism is the right LEVER for these " +
    "sounds (the pitch IS the speed, the clicks ARE the gears), not which knob value is best.\n");
}
