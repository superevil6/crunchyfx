/* energy.mjs — PROTOTYPE of an "energy weapon" synthesis engine for CrunchySFX (plasma, rail, pulse and ion guns), and
 * the CLI that renders its blind listening round.
 *
 *   node tools/proto/energy.mjs                 render every round into soundtests/proto-energy/<sound>/
 *   node tools/proto/energy.mjs plasma-rifle    one round
 *   node tools/proto/energy.mjs --cost          only the CPU cost: each take's model rendered 5x, ms per second of audio
 *   node tools/proto/energy.mjs --today         measure today's five sci-fi gun presets (why Plasma Discharge is the round)
 *
 * WHY. AJ built the suite because a retro SFX tool "couldn't make satisfying gunshot sounds": "I wanted something
 * Crunchier." Today's sci-fi guns are a falling saw with a ring mod (Plasma Rifle), a noise-and-boom patch (Plasma Shot),
 * a bred patch with a 75 ms fade-in (Plasma Discharge) and the impact engine with a ring mod (Rail Fire, Rail Round).
 * Nothing models what an energy weapon DOES: store energy, dump it in one violent instant, throw something, kick the
 * shooter, and cool down. This does, as separate stages, so each one can be heard and dialed.
 *
 * THE STAGES, in the order they happen (one trigger = one charge, then `rounds` shots at `rate`, then one afterglow):
 *   CHARGE     (enCharge s, optional) a capacitor whine climbing the charge curve f = lo + (hi - lo)(1 - e^(-3t/T)): fast
 *              at first, slowing as it fills, with a flyback flutter that speeds up; a coil HUM under it (a 100 Hz narrow
 *              pulse, odd harmonics, low-passed). It stops dead at the trigger.
 *   DISCHARGE  the shot itself, one model per TYPE, each with a HARD TRANSIENT (a differentiated spike + 0.3-1.2 ms of
 *              bright noise, longer with power, louder with crunch: the first millisecond is what makes a weapon a weapon and not a UI beep):
 *                plasma  a dense, saturated, pitch-DROPPING FM burst: carrier from `freq` to 0.28-0.4 of it (lower with power), modulators at
 *                        sqrt(2) (an inharmonic burble) and 1/2 (a sub growl), index falling from ~8 to ~1.5, its level
 *                        ROILED by a 70 Hz random drift, a band of noise tracking the carrier at 3x, and a HOT band (3.6 kHz noise, gone in 20-50 ms).
 *                rail    an electromagnetic SLAM: the rails STRUCK (a free-free bar's modes 1 : 2.76 : 5.40 : 8.93 : 13.3
 *                        from `freq`, a hard chunk), a low THUD (110 -> 45 Hz); then ~1.5 ms later the slug leaves at
 *                        hypersonic speed: an N-WAVE (a 0.25-0.5 ms pressure jump, box-integrated so it does not alias)
 *                        with its ground reflection 2.5 ms behind, a hyper-bright noise burst (> 5 kHz, 4 ms) (all three in the air, past the
 *                        crunch), the rails'
 *                        HIGH modes ringing on (~7x `freq`, up to 0.9 s) and an electric ZAP (an arc: partials at
 *                        1 : 1.47 : 2.09 gated by a 120 Hz narrow pulse train, falling 20%). With enStages > 1 it is a
 *                        COILGUN: the coils fire in sequence as the slug accelerates (equal energy per stage, so the gaps
 *                        shrink as 1/sqrt(k)), each a smaller chunk a little higher, the crack after the last.
 *                pulse   a clean, tight packet: a band-limited (polyBLEP) pulse wave, two voices +/- 6 cents across the
 *                        stereo field, chirping in from 1.6x and settling an octave down, a resonant low-pass closing
 *                        9 kHz -> 2.5 kHz, a ring-mod sheen. Little noise. The sleek one.
 *                ion     an ARC: a Poisson storm of crackle grains (3000/s falling, 1.5-5 kHz), a narrow-pulse buzz at freq/4 and a
 *                        falling zap sine. The crackling one.
 *   BOLT       the projectile leaving (enBolt). Plasma, pulse and ion throw a glowing bolt that WHINES: a tone at the
 *              type's ratio of `freq` with a fast tremolo (the bolt pulsing), flying straight out from the gun held 0.6 m
 *              to one side, so the DOPPLER is real geometry: f = f0 * c / (c + v_r), v_r = v x / r, falling from f0 as
 *              the bolt goes from beside the head to straight away; 1/r level, air absorption (a low-pass that closes with
 *              distance) and the pan sliding from the gun's side to center. Speed by type and power (a heavy plasma bolt
 *              ~60 m/s, a pulse ~180). A railgun's slug is hypersonic and has no whine: its bolt is an AIR TEAR (noise in
 *              a band falling 9 kHz -> 2.5 kHz in 0.12 s).
 *   RECOIL     the kick in the shooter's hands (enPunch): a sine falling 160 Hz -> ~50 Hz in ~20 ms (lower with power),
 *              decaying 45-115 ms (shortened at a high rate so full auto does not smear into a drone), plus a 220 Hz
 *              "thock" of the body. Weight.
 *   AFTERGLOW  after the last shot (enTail, scaled by the burst's HEAT): SIZZLE (a thinning Poisson crackle and a faint
 *              7 kHz fizz), a COIL COOLING (a tone gliding down from 1.7 kHz to a third of it with a small warble), a VENT
 *              (enVent: the hiss of a pressure release, opening 60-120 ms after the shot, and a low chuff). The type sets
 *              the mix: plasma sizzles and vents, rail cools its coils, ion crackles, pulse barely glows.
 *   CRUNCH     (enCrunch) the discharge and the recoil (the gun) go through one saturator together, so the kick and
 *              the bolt CLIP INTO EACH OTHER the way a hot mix does: y = tanh(g(x + b)) - tanh(g b), drive g
 *              0.3 .. 12.3, the bias b (up to 0.1) adds even harmonics, 4x OVERSAMPLED (a 64-tap windowed-sinc
 *              interpolator and decimator) so it crunches without folding back as aliasing; above 0.6 a bit reduction
 *              (12 -> 5 bits) for grit. The snap, a railgun's supersonic crack, the charge, the bolt and the afterglow stay
 *              OUTSIDE it: measured, a saturator ahead of them rounded the snap off (the heavy plasma's first 10 ms fell
 *              level with the next 100) and lifted a charge to within 5 dB of its own shot.
 *   AUTO FIRE  rounds at `rate` per second are real RE-TRIGGERS of the whole shot (discharge, transient, recoil, bolt),
 *              each with its own noise and its own small variation (enVary: pitch +/- 4%, level +/- 1.5 dB, timing +/- 3%
 *              of a cycle); HEAT (enHeat) sags the pitch through the burst (up to 7%), thickens the noise, and grows the
 *              afterglow with the rounds fired.
 *
 * PORTABLE SHAPE. `makeEnergy(sr, cfg, seed)` is a pure factory like dsp.js makeBlast / glass.mjs makeGlass: no DOM, no
 * Math.random (own seeded LCGs, one per component and per shot, so a level knob never reshuffles a shot), SR in. It
 * renders BUFFERED and returns { L, R, n, info, tick(drive, out) } (tick: one stereo sample times the amp envelope,
 * blast's shape). `energyCfg(st)` maps the proposed rows (ENERGY_PARAMS) to physics; `energyLevel(L, R)` levels a buffer
 * (RMS 0.12 over its loudest 300 ms, peak capped 0.9) as glassLevel does.
 *
 * THE ROUND. Each sound gets the CURRENT preset (rendered by the exported engine exactly as tools/make-ab.mjs does) or,
 * for the gap, the best build of today's engines, as the control, plus three model takes at clearly different points
 * (heavy military, chunky arcade, sleek clean). Model takes are stereo, so like glass.mjs they get the control's own
 * reverb (dsp.js reverbProcess) and no other chain. Loudness matched to -18 LUFS (peak capped 0.95; a take kept > 0.5 dB
 * short by its peaks gets the app's own Limiter at the smallest 0.1 step that reaches it, which the port would carry as
 * a Peak row as blastPeak does), shuffled with a fixed seed. Writes take-*.wav, LISTEN.md, KEY.md and README.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Only wave "energy" reads
// the group, so no existing preset moves. `freq` is the discharge's starting pitch (rail: the rails' lowest mode).
export const ENERGY_TYPES = ["plasma", "rail", "pulse", "ion"];   // append-only (stored as an index)
export const ENERGY_PARAMS = [
  ["enType",   "Type",            0, 3,   1,    0,   "",   "Energy", "enum", ENERGY_TYPES],
  ["enPower",  "Power",           0, 1,   0.01, 0.5, "",   "Energy"],   // pistol .. cannon: lower, longer, heavier
  ["enCharge", "Charge time",     0, 2.5, 0.01, 0,   "s",  "Energy"],   // 0 = fires at once
  ["enPunch",  "Punch",           0, 1,   0.01, 0.6, "",   "Energy"],   // the recoil's low kick
  ["enCrunch", "Crunch",          0, 1,   0.01, 0.4, "",   "Energy"],   // clean .. driven .. clipped and gritty
  ["enBolt",   "Bolt",            0, 1,   0.01, 0.5, "",   "Energy"],   // the projectile leaving (whine, or a rail's air tear)
  ["enTail",   "Tail",            0, 1,   0.01, 0.4, "",   "Energy"],   // afterglow: sizzle, coils cooling
  ["enVent",   "Vent",            0, 1,   0.01, 0.3, "",   "Energy"],   // the hiss of a pressure release after the shot
  ["enStages", "Coil stages",     1, 8,   1,    1,   "",   "Energy"],   // rail: > 1 = a coilgun, the coils firing in turn
  ["enRate",   "Rate",            1, 25,  0.1,  10,  "/s", "Energy"],   // shots per second (auto fire)
  ["enRounds", "Rounds",          1, 60,  1,    1,   "",   "Energy"],
  ["enVary",   "Shot variation",  0, 1,   0.01, 0.3, "",   "Energy"],   // per-shot pitch, level and timing scatter
  ["enHeat",   "Heat",            0, 1,   0.01, 0.3, "",   "Energy"],   // a burst heats up: pitch sags, the afterglow grows
  ["enSeed",   "Variation",       0, 999, 1,    0,   "",   "Energy"],
];
export const ENERGY_DEFAULTS = Object.fromEntries(ENERGY_PARAMS.map((p) => [p[0], p[5]]));

// Per type: the default `freq`, the bolt's pitch ratio and speed (m/s at power 0 .. 1), and the afterglow mix.
export const ENERGY_KINDS = [
  { "freq": 600,  "boltRatio": 1.6, "v0": 150, "v1": 60,  "sizzle": 1,   "coil": 0.35, "vent": 1,   "cool": 1700 },   // plasma
  { "freq": 380,  "boltRatio": 0,   "v0": 0,   "v1": 0,   "sizzle": 0.6, "coil": 1,    "vent": 0.5, "cool": 1900 },   // rail
  { "freq": 900,  "boltRatio": 1.3, "v0": 220, "v1": 140, "sizzle": 0.3, "coil": 0.45, "vent": 0.3, "cool": 2300 },   // pulse
  { "freq": 560,  "boltRatio": 2.1, "v0": 120, "v1": 70,  "sizzle": 1.5, "coil": 0.2,  "vent": 0.4, "cool": 1500 },   // ion
];
const EN_C = 343;               // speed of sound, m/s
const EN_LEAD = 0.004;          // s of silence before the first event
const EN_BOLT_SIDE = 0.6;       // m, the gun to the side of the listener's head

const enClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function enRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const enPan = (p) => { const a = (enClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };

// a TPT state-variable filter (Zavalishin), one sample at a time; the coefficient is recomputed only when f moves 0.5%
function enSvf(sr) {
  let ic1 = 0, ic2 = 0, fLast = -1, qLast = -1, a1 = 0, a2 = 0, a3 = 0, k = 1;
  const o = { lp: 0, bp: 0, hp: 0 };
  o.step = (x, f, q) => {
    if (Math.abs(f - fLast) > fLast * 0.005 || q !== qLast) {
      const g = Math.tan(Math.PI * enClamp(f, 10, 0.45 * sr) / sr); k = 1 / q;
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; fLast = f; qLast = q;
    }
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    o.lp = v2; o.bp = v1; o.hp = x - k * v1 - v2;
    return v1;
  };
  return o;
}
// polyBLEP residual (band-limits a pulse wave's steps)
function enBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// a smoothed random drift at ~`hz` (linear interpolation between random points), -1..1
function enDrift(rnd, hz, sr) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = 0; const d = hz / sr;
  return () => { ph += d; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } return a + (b - a) * ph; };
}

// ---- the stages. Each adds into stereo buffers (L, R) from sample i0; amplitudes are relative (the core is normalized
// before the crunch). `s` is the shot's own state: { f: pitch, lv: level, pw: power, rnd, nz: noise mult }.

// the HARD TRANSIENT: a differentiated spike and a fraction of a millisecond of bright noise
function enTransient(L, R, sr, i0, amp, tau, rnd) {
  const n = Math.round(tau * 6 * sr), d = Math.exp(-1 / (tau * sr));
  let e = 1, hpL = 0, hpR = 0, pL = 0, pR = 0;
  if (i0 < L.length) { L[i0] += amp; R[i0] += amp; }
  if (i0 + 1 < L.length) { L[i0 + 1] -= amp * 0.7; R[i0 + 1] -= amp * 0.7; }
  for (let j = 0; j < n && i0 + j < L.length; j++) {
    const xl = rnd() * 2 - 1, xr = rnd() * 2 - 1;
    hpL = xl - pL; pL = xl; hpR = xr - pR; pR = xr;          // a first difference: the top of the spectrum
    L[i0 + j] += amp * 0.8 * e * hpL; R[i0 + j] += amp * 0.8 * e * hpR; e *= d;
  }
}

function enPlasma(L, R, sr, i0, s, width) {
  const pw = s.pw, f0 = s.f, fEnd = f0 * (0.28 + 0.12 * (1 - pw)), tauP = 0.03 + 0.05 * pw;
  const tauA = Math.min(0.04 + 0.08 * pw, s.tauCap), hold = Math.min(0.004 + 0.012 * pw, s.tauCap * 0.3), n = Math.round((hold + 7 * tauA) * sr);
  const svH = enSvf(sr), svH2 = enSvf(sr), tauH = Math.min(0.02 + 0.03 * pw, s.tauCap);
  const Imax = 4 + 4 * pw, rnd = s.rnd, roil = enDrift(rnd, 70, sr), roil2 = enDrift(rnd, 23, sr);
  const svL = enSvf(sr), svR = enSvf(sr);
  let pc = 0, pm1 = rnd(), pm2 = rnd();
  for (let j = 0; j < n && i0 + j < L.length; j++) {
    const t = j / sr, env = t < hold ? 1 : Math.exp(-(t - hold) / tauA), att = Math.min(1, j / (0.0003 * sr));
    const fc = fEnd + (f0 - fEnd) * Math.exp(-t / tauP);
    // the index, held under the band edge so the FM's sidebands do not fold
    let I = Imax * Math.exp(-t / 0.05) + 1.5; const fm1 = fc * 1.41421356;
    I = Math.min(I, Math.max(0.5, (0.45 * sr - fc) / fm1 - 1));
    pm1 += fm1 / sr; pm2 += fc * 0.5 / sr; pm1 -= Math.floor(pm1); pm2 -= Math.floor(pm2);
    pc += fc / sr; pc -= Math.floor(pc);
    const mod = I * Math.sin(2 * Math.PI * pm1) + 0.8 * Math.sin(2 * Math.PI * pm2);
    const r = 1 + 0.35 * roil() + 0.2 * roil2();
    const tone = (Math.sin(2 * Math.PI * pc + mod) + 0.3 * Math.sin(Math.PI * pc)) * r;
    const nc = enClamp(fc * 3, 900, 8000), nenv = Math.exp(-t / (tauA * 0.6)) * 0.45 * s.nz;
    const nl = svL.step(rnd() * 2 - 1, nc, 0.9), nr = svR.step(rnd() * 2 - 1, nc, 0.9);
    // the HOT band: 2.5-5 kHz noise, roiled, gone in a few tens of ms (the bolt's own sizzle)
    const hot = 0.5 * s.nz * Math.exp(-t / tauH) * (0.6 + 0.4 * r);
    const hl = svH.step(rnd() * 2 - 1, 3600, 0.7) * hot, hr = svH2.step(rnd() * 2 - 1, 3900, 0.7) * hot;
    const a = s.lv * env * att, ah = s.lv * att;
    L[i0 + j] += a * (tone + nenv * (nl + width * 0.5 * (nr - nl))) + ah * hl;
    R[i0 + j] += a * (tone + nenv * (nr + width * 0.5 * (nl - nr))) + ah * hr;
  }
  return n;
}

// a bank of decaying sines (the rails' modes), phases random, from i0
function enModes(L, R, sr, i0, freqs, amps, t60s, lv, pan, rnd) {
  const [gl, gr] = enPan(pan);
  for (let m = 0; m < freqs.length; m++) {
    const f = freqs[m]; if (f >= 0.45 * sr) continue;
    const n = Math.min(Math.round(t60s[m] * sr), L.length - i0), d = Math.exp(-6.9078 / (t60s[m] * sr));
    const w = 2 * Math.PI * f / sr, ph = rnd() * 2 * Math.PI;
    // a recursive oscillator: y[n] = 2cos(w) y[n-1] - y[n-2]
    const c2 = 2 * Math.cos(w) * d; let y1 = Math.sin(ph - w) * d, y2 = Math.sin(ph - 2 * w) * d * d;
    const a = lv * amps[m];
    for (let j = 0; j < n; j++) { const y = c2 * y1 - d * d * y2; y2 = y1; y1 = y; L[i0 + j] += a * gl * y; R[i0 + j] += a * gr * y; }
  }
}
// a box-integrated N-wave (a supersonic projectile's pressure signature): +1 jumping, falling linearly to -1, back to 0
function enNWave(L, R, sr, t0, dur, amp) {
  const OS = 8, a = Math.floor(t0 * sr), b = Math.ceil((t0 + dur) * sr) + 1;
  for (let i = a; i <= b && i < L.length; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < dur) s += 1 - 2 * t / dur; }
    L[i] += amp * s / OS; R[i] += amp * s / OS;
  }
}

function enRail(L, R, aL, aR, sr, i0, s, cfg) {
  const pw = s.pw, fr = s.f, rnd = s.rnd, st = cfg.stages, len = 0.6 + 0.8 * pw;
  const RATIO = [1, 2.756, 5.404, 8.933, 13.344], AMP = [1, 0.7, 0.5, 0.35, 0.25], T60 = [0.35, 0.22, 0.14, 0.09, 0.06];
  // the coil stages: equal energy per stage, so v_k ~ sqrt(k) and the gap before coil k ~ 1/sqrt(k)
  const span = st > 1 ? 0.012 + 0.02 * pw : 0, gaps = []; let tot = 0;
  for (let k = 1; k <= st; k++) { gaps.push(1 / Math.sqrt(k)); tot += 1 / Math.sqrt(k); }
  let t = 0;
  for (let k = 0; k < st; k++) {
    const g = st > 1 ? 0.55 + 0.45 * (k + 1) / st : 1, fk = fr * (1 + 0.06 * k);
    enModes(L, R, sr, i0 + Math.round(t * sr), RATIO.map((x) => x * fk), AMP, T60.map((x) => x * len), 0.55 * s.lv * g, 0, rnd);
    enTransient(L, R, sr, i0 + Math.round(t * sr), 0.9 * s.lv * g, 0.0003, rnd);
    if (k < st - 1) t += span * gaps[k + 1] / (tot - gaps[0]);
  }
  const tCrack = t + 0.0015, iC = i0 + Math.round(tCrack * sr);
  // the THUD of the slam
  const nT = Math.round(0.4 * sr);
  let ph = 0;
  for (let j = 0; j < nT && i0 + j < L.length; j++) {
    const tt = j / sr, f = 45 + 65 * Math.exp(-tt / 0.012); ph += f / sr;
    const y = 0.75 * s.lv * Math.sin(2 * Math.PI * ph) * Math.exp(-tt / (0.05 + 0.05 * pw));
    L[i0 + j] += y; R[i0 + j] += y;
  }
  // the CRACK: an N-wave, its ground reflection, a hyper-bright burst
  const nd = 0.00025 + 0.00025 * pw;
  enNWave(aL, aR, sr, iC / sr, nd, 1.1 * s.lv);
  enNWave(aL, aR, sr, iC / sr + 0.0025, nd * 1.1, 0.45 * s.lv);
  { const n = Math.round(0.03 * sr); let pl = 0, pr = 0, ql = 0, qr = 0; const c = Math.exp(-2 * Math.PI * 5000 / sr);
    for (let j = 0; j < n && iC + j < L.length; j++) {
      const xl = rnd() * 2 - 1, xr = rnd() * 2 - 1; ql = c * (ql + xl - pl); pl = xl; qr = c * (qr + xr - pr); pr = xr;   // a 5 kHz high-pass
      const e = 0.6 * s.lv * Math.exp(-j / (0.004 * sr)) * s.nz; aL[iC + j] += e * ql; aR[iC + j] += e * qr;
    } }
  // the rails' HIGH modes ringing on (the "shing"), panned a little apart
  const tailK = 0.4 + 1.2 * cfg.tail, fh = fr * 7.3;
  enModes(L, R, sr, iC, [fh, fh * 1.31, fh * 1.73, fh * 2.21], [1, 0.7, 0.55, 0.4], [0.9, 0.7, 0.6, 0.5].map((x) => x * tailK), 0.12 * s.lv, -0.3, rnd);
  enModes(L, R, sr, iC, [fh * 1.005, fh * 1.318, fh * 1.741], [1, 0.7, 0.55], [0.85, 0.65, 0.55].map((x) => x * tailK), 0.1 * s.lv, 0.3, rnd);
  // the ZAP: an arc, partials gated by a narrow 120 Hz pulse train, falling 20%
  { const fz = Math.min(2400, fr * 5.8), tz = 0.05 + 0.25 * cfg.tail, n = Math.round(6 * tz * sr), P = [1, 1.47, 2.09], A = [1, 0.6, 0.4];
    const ph3 = [rnd(), rnd(), rnd()], sv = enSvf(sr); let pg = rnd();
    for (let j = 0; j < n && iC + j < L.length; j++) {
      const tt = j / sr, glide = 0.8 + 0.2 * Math.exp(-tt / (tz * 1.5)); let y = 0;
      for (let k = 0; k < 3; k++) { ph3[k] += fz * P[k] * glide / sr; ph3[k] -= Math.floor(ph3[k]); y += A[k] * Math.sin(2 * Math.PI * ph3[k]); }
      pg += (120 + 8 * Math.sin(2 * Math.PI * 3 * tt)) / sr; pg -= Math.floor(pg);
      const gate = pg < 0.18 ? 1 : 0.15, nz = sv.step(rnd() * 2 - 1, 3500, 0.8);
      const e = 0.35 * s.lv * Math.exp(-tt / tz) * Math.min(1, j / (0.002 * sr));
      const v = e * (0.6 * y + 1.2 * nz) * gate; L[iC + j] += v; R[iC + j] += v;
    } }
  return { n: Math.round((tCrack + 1) * sr), tCrack };
}

function enPulse(L, R, sr, i0, s, width) {
  const pw = s.pw, f0 = s.f, tauA = Math.min(0.035 + 0.06 * pw, s.tauCap), hold = 0.008, n = Math.round((hold + 7 * tauA) * sr), rnd = s.rnd;
  const svL = enSvf(sr), svR = enSvf(sr), det = [Math.pow(2, -6 / 1200), Math.pow(2, 6 / 1200)];
  let pa = rnd(), pb = rnd(), pr = 0;
  for (let j = 0; j < n && i0 + j < L.length; j++) {
    const t = j / sr, env = (t < hold ? 1 : Math.exp(-(t - hold) / tauA)) * Math.min(1, j / (0.0004 * sr));
    const f = f0 * (1 + 0.6 * Math.exp(-t / 0.006)) * (0.5 + 0.5 * Math.exp(-t / (0.04 + 0.04 * pw)));
    const pwid = 0.3 + 0.2 * (1 - Math.exp(-t / 0.03));
    const da = f * det[0] / sr, db = f * det[1] / sr;
    pa += da; pa -= Math.floor(pa); pb += db; pb -= Math.floor(pb);
    const va = (pa < pwid ? 1 : -1) + enBlep(pa, da) - enBlep((pa - pwid + 1) % 1, da);
    const vb = (pb < pwid ? 1 : -1) + enBlep(pb, db) - enBlep((pb - pwid + 1) % 1, db);
    pr += f * 1.5 / sr; pr -= Math.floor(pr);
    const sheen = 0.2 * Math.sin(2 * Math.PI * pr);
    const fc = 2500 + 6500 * Math.exp(-t / 0.05), nz = 0.08 * s.nz * (rnd() * 2 - 1);
    svL.step(va * (1 + sheen) + nz, fc, 1.6); svR.step(vb * (1 + sheen) + nz, fc, 1.6);
    const a = 0.75 * s.lv * env, w = 0.5 + 0.5 * width, l = svL.lp, r = svR.lp;
    L[i0 + j] += a * (l * w + r * (1 - w)); R[i0 + j] += a * (r * w + l * (1 - w));
  }
  return n;
}

function enIon(L, R, sr, i0, s) {
  const pw = s.pw, rnd = s.rnd, tau = Math.min(0.05 + 0.15 * pw, s.tauCap), n = Math.round(6 * tau * sr), fb = s.f / 4;
  const sv = enSvf(sr), svb = enSvf(sr);
  let pb = 0, pz = 0, grain = 0, gEnv = 0, gc = 4000, gpan = 0;
  for (let j = 0; j < n && i0 + j < L.length; j++) {
    const t = j / sr, env = Math.exp(-t / tau);
    // Poisson crackle: a grain starts with probability rate/sr
    if (rnd() < 3000 * Math.exp(-t / (tau * 0.8)) / sr) { gEnv = Math.pow(rnd(), 2); gc = 1500 + 3500 * rnd(); gpan = rnd() * 2 - 1; }
    grain = sv.step(rnd() * 2 - 1, gc, 2) * gEnv; gEnv *= Math.exp(-1 / (0.00015 * sr));
    pb += fb * (1 + 0.03 * Math.sin(2 * Math.PI * 9 * t)) / sr; pb -= Math.floor(pb);
    const buzz = svb.step(pb < 0.08 ? 1 : -0.087, 4000, 0.7);
    pz += s.f * (0.5 + 1.5 * Math.exp(-t / 0.03)) / sr; pz -= Math.floor(pz);
    const zap = 0.5 * Math.sin(2 * Math.PI * pz) * Math.exp(-t / 0.06);
    const base = s.lv * env * Math.min(1, j / (0.0003 * sr)) * (0.9 * buzz + zap);
    const g = 1.5 * s.lv * grain * s.nz, [gl, gr] = enPan(gpan * 0.5);
    L[i0 + j] += base + g * gl; R[i0 + j] += base + g * gr;
  }
  return n;
}

// RECOIL: a falling sine kick and the body's thock
function enRecoil(L, R, sr, i0, amp, pw, rate, rnd) {
  const f1 = 44 + 14 * (1 - pw), tau = Math.min(0.045 + 0.07 * pw, 0.45 / rate), n = Math.round(7 * tau * sr), sv = enSvf(sr);
  let ph = 0;
  for (let j = 0; j < n && i0 + j < L.length; j++) {
    const t = j / sr, f = f1 + (160 - f1) * Math.exp(-t / 0.02); ph += f / sr;
    const k = Math.sin(2 * Math.PI * ph) * Math.exp(-t / tau) * Math.min(1, j / (0.0008 * sr));
    const th = sv.step(rnd() * 2 - 1, 220, 2) * Math.exp(-t / 0.012) * 0.8;
    const y = amp * (k + th); L[i0 + j] += y; R[i0 + j] += y;
  }
}

// BOLT: the doppler whine of a projectile leaving (plasma / pulse / ion), or a rail's air tear
function enBolt(L, R, sr, i0, s, kind, cfg, amp) {
  const rnd = s.rnd;
  if (kind["boltRatio"] === 0) {                       // rail: hypersonic, an air TEAR
    const n = Math.round(0.35 * sr), sv = enSvf(sr), sv2 = enSvf(sr);
    for (let j = 0; j < n && i0 + j < L.length; j++) {
      const t = j / sr, fc = 2500 + 6500 * Math.exp(-t / 0.06), e = amp * Math.min(1, j / (0.002 * sr)) * Math.exp(-t / 0.07);
      const p = 0.3 * Math.exp(-t / 0.05), [gl, gr] = enPan(p);
      const x = sv.step(rnd() * 2 - 1, fc, 2), y = sv2.step(rnd() * 2 - 1, fc * 1.07, 2);
      L[i0 + j] += e * x * gl; R[i0 + j] += e * y * gr;
    }
    return;
  }
  const v = kind["v0"] + (kind["v1"] - kind["v0"]) * s.pw, f0 = s.f * kind["boltRatio"], life = Math.min(0.35 + 0.5 * cfg.bolt, cfg.rounds > 1 ? 3 / cfg.rate : 9);
  const n = Math.round(life * sr), d0 = EN_BOLT_SIDE, r0 = Math.hypot(0.4, d0);
  let ph = 0, ph2 = 0, lpL = 0, lpR = 0; const trem = 28 + 30 * rnd(), wob = enDrift(rnd, 40, sr);
  for (let j = 0; j < n && i0 + j < L.length; j++) {
    const t = j / sr, x = 0.4 + v * t, r = Math.hypot(x, d0), vr = v * x / r;
    const f = f0 * EN_C / (EN_C + vr);
    ph += f * (1 + 0.004 * wob()) / sr; ph -= Math.floor(ph); ph2 += trem / sr; ph2 -= Math.floor(ph2);
    const tone = Math.sin(2 * Math.PI * ph) + 0.35 * Math.sin(4 * Math.PI * ph) + 0.15 * Math.sin(6 * Math.PI * ph);
    const e = amp * (r0 / r) * Math.min(1, j / (0.008 * sr)) * Math.min(1, (n - j) / (0.05 * sr)) * (1 - 0.35 * (0.5 + 0.5 * Math.sin(2 * Math.PI * ph2)));
    const cut = 14000 / (1 + r / 25), c = 1 - Math.exp(-2 * Math.PI * cut / sr);
    const pan = 0.35 * d0 / r, [gl, gr] = enPan(pan);
    lpL += c * (tone * gl - lpL); lpR += c * (tone * gr - lpR);
    L[i0 + j] += e * lpL; R[i0 + j] += e * lpR;
  }
}

// CHARGE: a capacitor whine on its charge curve, a flyback flutter speeding up, the coil hum
function enChargeStage(L, R, sr, T, cfg, rnd) {
  const n = Math.round(T * sr), rail = cfg.type === 1, lo = rail ? 240 : 180, hi = rail ? 2600 : 1400;
  const sv = enSvf(sr), hum = enSvf(sr); let p = rnd(), pf = 0, ph = 0;
  for (let j = 0; j < n && j < L.length; j++) {
    const t = j / sr, u = t / T, f = lo + (hi - lo) * (1 - Math.exp(-3 * u)) / (1 - Math.exp(-3));
    p += f / sr; p -= Math.floor(p);
    pf += (8 + 30 * u * u) / sr; pf -= Math.floor(pf);              // the flutter quickens as it fills
    const whine = (Math.sin(2 * Math.PI * p) + 0.4 * Math.sin(4 * Math.PI * p) + 0.25 * Math.sin(6 * Math.PI * p)) * (1 - 0.25 * (0.5 + 0.5 * Math.sin(2 * Math.PI * pf)));
    ph += 100 / sr; ph -= Math.floor(ph);
    const h = hum.step(ph < 0.06 ? 1 : -0.064, 900, 0.7) * 2.2;
    const nz = sv.step(rnd() * 2 - 1, f * 2, 3) * 0.3;
    const a = 0.15 * Math.pow(u, 1.5) * Math.min(1, (n - j) / (0.002 * sr)), hA = 0.07 * Math.min(1, t / 0.06);
    const y = a * (whine + nz) + hA * h;
    L[j] += y; R[j] += y;
  }
}

// AFTERGLOW: sizzle, a coil cooling, a vent
function enAfterglow(L, R, sr, i0, cfg, kind, heatK, rnd) {
  const tail = cfg.tail, sz = kind["sizzle"] * tail * heatK, co = kind["coil"] * tail * heatK, ve = cfg.vent * kind["vent"] * heatK;
  const tauS = 0.12 + 0.6 * tail, n = Math.min(L.length - i0, Math.round((0.15 + 6 * tauS) * sr));
  const fiz = enSvf(sr), v1 = enSvf(sr), v2 = enSvf(sr), v3 = enSvf(sr);
  const tauC = 0.25 + 0.5 * tail, fCool = kind["cool"], vOpen = 0.06 + 0.06 * cfg.power, tauV = 0.12 + 0.5 * tail;
  let ph = rnd(), clk = 0, clkPan = 0, pl = 0, pr = 0, hl = 0;
  const wob = enDrift(rnd, 6, sr), hp = Math.exp(-2 * Math.PI * 3000 / sr);
  for (let j = 0; j < n; j++) {
    const t = j / sr, i = i0 + j;
    // sizzle: Poisson clicks thinning out, and a faint fizz
    if (rnd() < 350 * Math.exp(-t / tauS) / sr) { clk = 0.6 * (0.3 + 0.7 * rnd()); clkPan = rnd() * 1.6 - 0.8; }
    const xn = rnd() * 2 - 1; hl = hp * (hl + xn - pl); pl = xn;
    const c = clk * hl; clk *= 0.6;
    const fz = fiz.step(rnd() * 2 - 1, 7000, 1.2) * 0.08 * Math.exp(-t / tauS);
    const [cl, cr] = enPan(clkPan);
    const sizL = sz * (c * cl + fz), sizR = sz * (c * cr + fz);
    // coil cooling
    let coil = 0;
    if (co > 0 && t > 0.04) {
      const tc = t - 0.04, f = fCool * (0.35 + 0.65 * Math.exp(-tc / tauC)) * (1 + 0.006 * wob());
      ph += f / sr; ph -= Math.floor(ph);
      coil = co * 0.12 * Math.exp(-tc / (tauC * 1.2)) * Math.min(1, tc / 0.015) * (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(6 * Math.PI * ph));
    }
    // vent: a hiss opening, and a low chuff
    let vl = 0, vr = 0;
    if (ve > 0 && t > vOpen) {
      const tv = t - vOpen, e = ve * 0.14 * Math.min(1, tv / 0.025) * Math.exp(-tv / tauV);
      const a = v1.step(rnd() * 2 - 1, 3800, 0.6), b = v2.step(rnd() * 2 - 1, 4200, 0.6), ch = v3.step(rnd() * 2 - 1, 800, 1.2) * Math.exp(-tv / 0.05);
      vl = e * (a + 0.8 * ch); vr = e * (b + 0.8 * ch); pr = 0;
    }
    L[i] += sizL + coil + vl; R[i] += sizR + coil + vr;
  }
}

// the CRUNCH: a biased tanh, 4x oversampled through a 64-tap windowed-sinc, then (above 0.6) a bit reduction
const EN_OS = 4, EN_TAPS = 64;
const EN_FIR = (() => {
  const h = new Float64Array(EN_TAPS), fc = 0.45 / EN_OS, M = EN_TAPS - 1; let s = 0;
  for (let i = 0; i < EN_TAPS; i++) {
    const x = i - M / 2, sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / M) + 0.08 * Math.cos(4 * Math.PI * i / M);   // Blackman
    h[i] = sinc * w; s += h[i];
  }
  for (let i = 0; i < EN_TAPS; i++) h[i] /= s;
  return h;
})();
function enCrunch(x, amt) {
  const n = x.length, g = 0.3 + 12 * Math.pow(amt, 1.5), b = 0.1 * amt, tb = Math.tanh(g * b), norm = 1 / Math.tanh(g);
  const up = new Float64Array(n * EN_OS + EN_TAPS);
  for (let i = 0; i < n; i++) up[i * EN_OS] = x[i] * EN_OS;
  const y = new Float64Array(n * EN_OS);
  for (let i = 0; i < n * EN_OS; i++) {                // interpolate (only every 4th input is nonzero)
    let s = 0; const r = i % EN_OS;
    for (let k = r; k < EN_TAPS; k += EN_OS) { const j = i - k; if (j >= 0) s += EN_FIR[k] * up[j]; }
    y[i] = (Math.tanh(g * (s + b)) - tb) * norm;
  }
  const out = new Float64Array(n), d = EN_TAPS >> 1;  // decimate, compensating both filters' delay
  for (let o = 0; o < n; o++) {
    const c = o * EN_OS + d * 2; let s = 0;
    for (let k = 0; k < EN_TAPS; k++) { const j = c - k; if (j >= 0 && j < y.length) s += EN_FIR[k] * y[j]; }
    out[o] = s;
  }
  if (amt > 0.6) {                                     // grit: 12 -> 5 bits
    const q = Math.pow(2, 12 - 7 * (amt - 0.6) / 0.4 - 1), mix = Math.min(1, (amt - 0.6) / 0.25);
    for (let o = 0; o < n; o++) out[o] = out[o] * (1 - mix) + mix * Math.round(out[o] * q) / q;
  }
  let hx = 0, hy = 0; const a = Math.exp(-2 * Math.PI * 12 / 44100);   // DC block (the bias)
  for (let o = 0; o < n; o++) { const v = out[o] - hx + a * hy; hx = out[o]; hy = v; out[o] = v; }
  return out;
}

// knobs -> physics
export function energyCfg(st) {
  const g = (k) => (st[k] == null ? ENERGY_DEFAULTS[k] : st[k]);
  const type = enClamp(Math.round(g("enType")), 0, ENERGY_TYPES.length - 1);
  return {
    "type": type, "freq": st.freq || ENERGY_KINDS[type]["freq"], "dur": st.duration || 0, "width": st.width == null ? 0.5 : st.width,
    "power": enClamp(g("enPower"), 0, 1), "charge": enClamp(g("enCharge"), 0, 2.5), "punch": enClamp(g("enPunch"), 0, 1),
    "crunch": enClamp(g("enCrunch"), 0, 1), "bolt": enClamp(g("enBolt"), 0, 1), "tail": enClamp(g("enTail"), 0, 1),
    "vent": enClamp(g("enVent"), 0, 1), "stages": enClamp(Math.round(g("enStages")), 1, 8),
    "rate": enClamp(g("enRate"), 1, 25), "rounds": enClamp(Math.round(g("enRounds")), 1, 60),
    "vary": enClamp(g("enVary"), 0, 1), "heat": enClamp(g("enHeat"), 0, 1), "seed": Math.round(g("enSeed")),
  };
}

export function makeEnergy(sr, cfg, seed) {
  const kind = ENERGY_KINDS[cfg.type], rounds = cfg.rounds, rate = cfg.rate;
  const tShot0 = EN_LEAD + cfg.charge, lastShot = tShot0 + (rounds - 1) / rate;
  const auto = Math.max(0.35, 0.12 + 1.2 * cfg.tail + 0.3 * cfg.power + (cfg.type === 1 ? 0.3 : 0));
  const n = Math.round((cfg.dur > 0 ? cfg.dur : lastShot + auto) * sr);
  const gL = new Float64Array(n), gR = new Float64Array(n), aL = new Float64Array(n), aR = new Float64Array(n);
  const sd = (seed >>> 0) * 7919 + cfg.seed * 104729;
  const info = { shots: [], type: ENERGY_TYPES[cfg.type] };
  if (cfg.charge > 0) enChargeStage(aL, aR, sr, cfg.charge + EN_LEAD, cfg, enRng(sd + 11));   // outside the crunch, or the saturator lifts it level with the shot
  const vr = enRng(sd + 23);
  for (let k = 0; k < rounds; k++) {
    const h = rounds > 1 ? cfg.heat * k / (rounds - 1) : 0;
    const jit = k > 0 ? (vr() * 2 - 1) * 0.03 * cfg.vary / rate : 0;
    const t = tShot0 + k / rate + jit, i0 = Math.round(t * sr);
    const s = { f: cfg.freq * (1 + (vr() * 2 - 1) * 0.04 * cfg.vary) * (1 - 0.07 * h), lv: Math.pow(10, (vr() * 2 - 1) * 1.5 * cfg.vary / 20),
      pw: cfg.power, nz: 1 + 0.6 * h, rnd: enRng(sd + 1000 + k * 31), tauCap: rounds > 1 ? 0.33 / rate : 1 };
    info.shots.push(Math.round(t * 1000) / 1000);
    if (cfg.type === 2) enTransient(aL, aR, sr, i0, 0.9 * s.lv, 0.0003, s.rnd);
    // it clears a CRUNCHED body (flattened to full scale); a clean body keeps its own front, and more snap there is only peak
    else enTransient(aL, aR, sr, i0, (0.6 + 0.9 * cfg.crunch * (0.5 + 0.5 * cfg.power)) * s.lv, 0.0004 + 0.0008 * cfg.power, s.rnd);   // after the crunch: it never rounds off the front
    if (cfg.type === 0) enPlasma(gL, gR, sr, i0, s, cfg.width);
    else if (cfg.type === 1) enRail(gL, gR, aL, aR, sr, i0, s, cfg);
    else if (cfg.type === 2) enPulse(gL, gR, sr, i0, s, cfg.width);
    else enIon(gL, gR, sr, i0, s);
    if (cfg.punch > 0) enRecoil(gL, gR, sr, i0, 0.95 * cfg.punch * s.lv, cfg.power, rounds > 1 ? rate : 1, enRng(sd + 3000 + k));
    if (cfg.bolt > 0) enBolt(aL, aR, sr, i0 + Math.round((cfg.type === 1 ? 0.0015 : 0.005) * sr), s, kind, cfg, (kind["boltRatio"] ? 0.3 : 0.35) * cfg.bolt * s.lv);
  }
  // the gun bus is normalized, THEN crunched, so Crunch means the same thing however many layers or rounds there are
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(gL[i]), Math.abs(gR[i]));
  if (pk > 0) for (let i = 0; i < n; i++) { gL[i] /= pk; gR[i] /= pk; }
  const cL = enCrunch(gL, cfg.crunch), cR = enCrunch(gR, cfg.crunch);
  const heatK = 1 + cfg.heat * Math.min(1, rounds / 10) * 1.5;
  if (cfg.tail > 0 || cfg.vent > 0) enAfterglow(aL, aR, sr, Math.round((lastShot + 0.01) * sr), cfg, kind, heatK, enRng(sd + 5003));
  const L = new Float32Array(n), R = new Float32Array(n), fo = Math.min(n, Math.round(0.03 * sr));
  for (let i = 0; i < n; i++) { L[i] = cL[i] + aL[i]; R[i] = cR[i] + aR[i]; }
  for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  const lv = energyLevel(L, R, sr);
  for (let i = 0; i < n; i++) { L[i] *= lv; R[i] *= lv; }
  let i = 0;
  return { L, R, n, info, tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9
export function energyLevel(L, R, sr = 44100) {
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
  const SR = 44100, TARGET_LUFS = -18, OUT = join(ROOT, "soundtests", "proto-energy");
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
  // as glass.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js limiterProcess)
  // at the smallest 0.1 step that brings it within 0.5 dB; past 1, a second pass ("1+x", a Peak row in the port)
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

  // ---- the takes. A model take: { id, why, st: rows + freq/duration/width, seed }. Its room is the round's `room`.
  const PLASMA = 0, RAIL = 1, PULSE = 2, ION = 3;
  const en = (o) => Object.assign({ width: 0.5 }, o);
  const PR = preset("Plasma Rifle");
  const ROUNDS = {
    "plasma-rifle": {
      title: "Plasma Rifle", control: "Plasma Rifle",
      controlWhy: "the CURRENT preset \"Plasma Rifle\" exactly as it ships (a saw at 500 Hz falling, ring-modulated at 160 Hz, a little noise, driven and crushed to 8 bits, an 80 ms echo).",
      room: { reverb: 0.3, reverbSize: 0.6, reverbTone: 0.55 },
      listen: "One shot from a plasma rifle: a soldier's energy weapon. Which one is a GUN you would want to fire? Listen for the first instant (a hard snap, or a soft start?), for WEIGHT (do you feel a kick under it, or is it all treble?), for the bolt itself (dense and hot, or a thin beep?) and for what it leaves behind (a sizzle, a hiss, nothing).",
      takes: [
        { id: "heavy-military", why: "MODEL, plasma, a heavy service rifle: the bolt starts at 420 Hz and drops to ~130 Hz, dense FM roiling under a hard snap, a deep kick (power 0.8: down to ~47 Hz, ~100 ms), driven (crunch 0.55), the bolt whining away at ~80 m/s (its pitch sliding down as it leaves your side), then a sizzle and the barrel venting.",
          st: en({ freq: 420, enType: PLASMA, enPower: 0.8, enPunch: 0.85, enCrunch: 0.55, enBolt: 0.45, enTail: 0.5, enVent: 0.45, enVary: 0 }), seed: 101 },
        { id: "chunky-arcade", why: "MODEL, plasma, the arcade blaster: higher (700 Hz dropping to ~240 Hz), shorter, CLIPPED HARD (crunch 0.85: the saturator into ~8 bits of grit, the kick and the bolt clipping into each other), a punchy kick, a short whine, a brief sizzle and no vent.",
          st: en({ freq: 700, enType: PLASMA, enPower: 0.45, enPunch: 0.7, enCrunch: 0.85, enBolt: 0.55, enTail: 0.3, enVent: 0.1, enVary: 0 }), seed: 113 },
        { id: "sleek-clean", why: "MODEL, plasma, the clean one: bright (1 kHz dropping to ~360 Hz), short, hardly driven (crunch 0.1), a lighter kick, and the BOLT carrying it: a 1.6 kHz whine flying off at ~120 m/s, its doppler falling and the air taking its top off. A little sizzle.",
          st: en({ freq: 1000, enType: PLASMA, enPower: 0.3, enPunch: 0.45, enCrunch: 0.1, enBolt: 0.85, enTail: 0.25, enVent: 0.05, enVary: 0 }), seed: 127 },
      ] },
    "plasma-shot": {
      title: "Plasma Shot", control: "Plasma Shot",
      controlWhy: "the CURRENT preset \"Plasma Shot\" exactly as it ships (a saw at 170 Hz under 96% noise falling, a sub and an 83 Hz boom, driven 4x oversampled, a 96 ms echo and a big dark reverb, 1.4 s).",
      room: { reverb: 0.4, reverbSize: 0.7, reverbTone: 0.35 },
      listen: "A single plasma shot: a bolt of hot energy fired and flying off. Which one is the most satisfying SHOT? Listen for the snap at the start, the body of the bolt (thick and hot, or noise?), whether you can hear it LEAVE (a whine going away), and the weight under it.",
      takes: [
        { id: "slow-fat-bolt", why: "MODEL, plasma, a slow, heavy bolt: 300 Hz dropping to ~95 Hz, a solid kick, and the BOLT the star: a ~480 Hz glowing whine thrown at ~85 m/s, sliding down as it goes from beside you to straight away, pulsing, darkening with distance over ~0.8 s. Then a sizzle.",
          st: en({ freq: 300, enType: PLASMA, enPower: 0.7, enPunch: 0.7, enCrunch: 0.5, enBolt: 0.95, enTail: 0.4, enVent: 0.25, enVary: 0 }), seed: 201 },
        { id: "snappy-pistol", why: "MODEL, plasma, a sidearm: small and quick (850 Hz dropping to ~320 Hz in ~40 ms), clipped (crunch 0.7), a tight kick, a short whine, almost no tail. The quickest one.",
          st: en({ freq: 850, enType: PLASMA, enPower: 0.2, enPunch: 0.65, enCrunch: 0.7, enBolt: 0.35, enTail: 0.15, enVent: 0, enVary: 0 }), seed: 211 },
        { id: "ion-bolt", why: "MODEL, ion, a crackling shot: an ARC instead of a burst (a storm of crackle grains, a narrow-pulse buzz at ~140 Hz and a falling zap), a kick, a high whine (~1.2 kHz) leaving, a long crackling sizzle after.",
          st: en({ freq: 560, enType: ION, enPower: 0.5, enPunch: 0.6, enCrunch: 0.45, enBolt: 0.6, enTail: 0.5, enVent: 0.15, enVary: 0 }), seed: 223 },
      ] },
    "rail-fire": {
      title: "Rail Fire", control: "Rail Fire",
      controlWhy: "the CURRENT preset \"Rail Fire\" exactly as it ships (the impact engine, bright, ring-modulated at 600 Hz, a 70 Hz boom, a 120 ms echo).",
      room: { reverb: 0.3, reverbSize: 0.7, reverbTone: 0.5 },
      listen: "A railgun firing: a slug thrown by electromagnets at many times the speed of sound. Which one is a RAILGUN? Listen for the slam (metal, heavy), for the CRACK (a hyper-bright snap as the slug breaks the sound barrier), for the ring and the electric zap after, and, if it charges first, whether the charge makes you wait for it or just gets in the way.",
      takes: [
        { id: "heavy-railgun", why: "MODEL, rail, the heavy military railgun: a 0.9 s capacitor whine climbing 240 Hz -> 2.6 kHz over a coil hum, then the SLAM (the rails struck at 260 Hz and their modes, a 110 -> 45 Hz thud, a deep kick), the N-wave crack 1.5 ms later with its ground reflection, the slug tearing the air away, the rails ringing on at ~1.9 kHz, an electric zap, then the coils cooling and a vent.",
          st: en({ freq: 260, enType: RAIL, enCharge: 0.9, enPower: 0.9, enPunch: 1, enCrunch: 0.5, enBolt: 0.6, enTail: 0.7, enVent: 0.5, enVary: 0 }), seed: 301 },
        { id: "chunky-arcade", why: "MODEL, rail, the arcade one: no charge, a higher chunk (420 Hz), CLIPPED HARD (crunch 0.85), the crack, a long ringing zap tail and the rails ringing on, the coils cooling. Short and loud.",
          st: en({ freq: 420, enType: RAIL, enPower: 0.55, enPunch: 0.75, enCrunch: 0.85, enBolt: 0.4, enTail: 0.6, enVent: 0.1, enVary: 0 }), seed: 311 },
        { id: "sleek-coilgun", why: "MODEL, rail as a COILGUN, clean: a short 0.35 s charge whine, then six coils firing in turn as the slug speeds up (six small thunks over ~20 ms, the gaps shrinking, each a little higher), the crack after the last, a light kick, hardly driven (crunch 0.15), a short ring.",
          st: en({ freq: 520, enType: RAIL, enStages: 6, enCharge: 0.35, enPower: 0.4, enPunch: 0.55, enCrunch: 0.15, enBolt: 0.5, enTail: 0.35, enVent: 0.05, enVary: 0 }), seed: 331 },
      ] },
    "plasma-discharge": {
      title: "Plasma Discharge", control: "Plasma Discharge",
      controlWhy: "the CURRENT preset \"Plasma Discharge\" exactly as it ships (a bred patch: a saw at 143 Hz with a 75 ms fade-in, ring-modulated at 154 Hz, sub and boom, crushed to 7 bits, a 73 ms echo). Picked over Rail Round for this round because it is the weaker of the two today: Rail Round is Rail Fire again (the same impact build, ring mod 750 Hz), while Plasma Discharge's 75 ms attack means it has no front at all (`--today` measures it).",
      room: { reverb: 0.35, reverbSize: 0.7, reverbTone: 0.45 },
      listen: "A plasma DISCHARGE: a big stored charge released all at once (the charged shot, the overcharged cannon). Which one feels like a lot of energy let go? Listen for the build (if there is one), the release (instant and violent, or soft?), the weight, and the aftermath (venting, crackling, cooling).",
      takes: [
        { id: "overcharged-cannon", why: "MODEL, plasma, heavy: a 1.2 s charge (a whine climbing 180 Hz -> 1.4 kHz, a flutter quickening as it fills, a coil hum), then the biggest release (300 Hz dropping to ~85 Hz, power 1), the deepest kick, driven (crunch 0.6), the bolt leaving slowly, then a long vent hiss and sizzle.",
          st: en({ freq: 300, enType: PLASMA, enCharge: 1.2, enPower: 1, enPunch: 1, enCrunch: 0.6, enBolt: 0.5, enTail: 0.7, enVent: 0.8, enVary: 0 }), seed: 401 },
        { id: "arc-discharge", why: "MODEL, ion, crunchy: a 0.5 s charge, then an ARC dump (a storm of crackle, a 110 Hz narrow-pulse buzz, a falling zap), clipped (crunch 0.75), a kick, a high whine leaving and a long crackling sizzle.",
          st: en({ freq: 450, enType: ION, enCharge: 0.5, enPower: 0.8, enPunch: 0.75, enCrunch: 0.75, enBolt: 0.5, enTail: 0.8, enVent: 0.2, enVary: 0 }), seed: 411 },
        { id: "clean-vented-blast", why: "MODEL, plasma, clean: no charge, a big release (380 Hz dropping to ~115 Hz) hardly driven (crunch 0.15), a firm kick, then the AFTERMATH carries it: a vent opening ~110 ms later and hissing out over ~1 s, the coils cooling down a third.",
          st: en({ freq: 380, enType: PLASMA, enPower: 0.85, enPunch: 0.8, enCrunch: 0.15, enBolt: 0.3, enTail: 0.9, enVent: 1, enVary: 0 }), seed: 421 },
      ] },
    "pulse-rifle-auto": {
      title: "Pulse Rifle, full auto (a GAP: no preset owns it)", control: "pulse rifle (today's engines)",
      controlPatch: stack(Object.assign({}, PR, { decay: 0.06, release: 0.05, hold: 0.002, repeat: 14, rate: 11, duration: 1.5, delay: 0 }), [
        [Object.assign({}, preset("Full Auto"), { repeat: 14, rate: 11, duration: 1.5 }), 0, 0.5],
      ]),
      controlWhy: "CONTROL, today's engines (no automatic energy weapon exists): the Plasma Rifle preset shortened and re-fired 14 times at 11 a second (the app's Repeat, which re-gates one sound), its echo off so the shots stay apart, over the Full Auto preset's impact layer at the same rate for the kick.",
      room: { reverb: 0.25, reverbSize: 0.6, reverbTone: 0.5 },
      listen: "A pulse rifle on full auto: an energy weapon holding the trigger down for about a second. Which one is the gun you want? Listen for each shot (does every round have a snap and a kick, or does it blur?), for whether it sounds like a machine FIRING or a loop playing, and for the end of the burst (does it just stop, or does the gun cool off?).",
      takes: [
        { id: "military-pulse-rifle", why: "MODEL, pulse, the heavy one: 14 rounds at 10 a second, each a tight packet (520 Hz chirping in and settling an octave down) with a hard snap and a deep kick, driven (crunch 0.5), every round its own (pitch, level and timing scattered a little), the barrel HEATING through the burst (pitch sags ~4%, the noise thickens), then a sizzle, the coils cooling and a vent sized by the heat.",
          st: en({ freq: 520, enType: PULSE, enPower: 0.65, enRate: 10, enRounds: 14, enPunch: 0.85, enCrunch: 0.5, enBolt: 0.3, enTail: 0.5, enVent: 0.4, enHeat: 0.6, enVary: 0.5 }), seed: 501 },
        { id: "chunky-arcade-spray", why: "MODEL, plasma on full auto, the arcade one: 16 rounds at 13 a second, small plasma bursts (800 Hz dropping to ~290 Hz, each gone before the next) clipped hard (crunch 0.85), punchy, a short whine per round, a brief sizzle.",
          st: en({ freq: 800, enType: PLASMA, enPower: 0.3, enRate: 13, enRounds: 16, enPunch: 0.65, enCrunch: 0.85, enBolt: 0.3, enTail: 0.3, enVent: 0.1, enHeat: 0.3, enVary: 0.5 }), seed: 511 },
        { id: "sleek-pulse-smg", why: "MODEL, pulse, the clean fast one: 22 rounds at 17 a second, bright packets (1.1 kHz) hardly driven (crunch 0.1), a light kick, a faint whine, a short cool-down.",
          st: en({ freq: 1100, enType: PULSE, enPower: 0.25, enRate: 17, enRounds: 22, enPunch: 0.5, enCrunch: 0.1, enBolt: 0.15, enTail: 0.25, enVent: 0.05, enHeat: 0.2, enVary: 0.4 }), seed: 521 },
      ] },
  };
  const ORDER = ["plasma-rifle", "plasma-shot", "rail-fire", "plasma-discharge", "pulse-rifle-auto"];

  function renderModel(t) {
    const st = Object.assign({}, ENERGY_DEFAULTS, t.st), cfg = energyCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeEnergy(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms };
  }
  function renderControl(patch) {
    const o = CS.render(Object.assign({}, CS.DEFAULTS, patch), { normalize: true });
    return { L: Float32Array.from(o.L), R: Float32Array.from(o.R) };
  }
  function renderTake(t, round) {
    if (t.control) return Object.assign(renderControl(t.patch), { info: null });
    const { r, cfg, ms } = renderModel(t);
    const L = r.L, R = r.R, n = L.length, room = round.room;
    if (room && room.reverb > 0) dctx.reverbProcess(L, R, room.reverbSize, room.reverbTone, room.reverb);
    const fo = Math.floor(0.06 * SR);
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
  function spectrum(x, a, N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N && a + i < x.length; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im); const p = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p;
  }
  function measure(L, R, shotAt) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e2 = Math.floor(0.002 * SR); let eE = 0;
    for (let i = 0; i < e2; i++) eE = Math.max(eE, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i]));
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeE: eE / (pk || 1) };
    let N = 1; while (N < n) N <<= 1;
    const p = spectrum(mono, 0, N); let all = 0, num = 0, lo150 = 0, lo300 = 0, hi4 = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; all += p[k]; num += f * p[k]; if (f < 150) lo150 += p[k]; if (f < 300) lo300 += p[k]; if (f > 4000) hi4 += p[k]; }
    m.centroid = num / (all || 1); m.lo150 = lo150 / (all || 1); m.lo300 = lo300 / (all || 1); m.hi4k = hi4 / (all || 1);
    // ATTACK: from the first sample 40 dB under the peak until the 1 ms RMS envelope is within 6 dB of its max (first 200 ms)
    const thr = pk * 0.01; let on = Math.max(0, Math.round(((shotAt || 0) - 0.001) * SR)); while (on < n && Math.abs(mono[on]) < thr && Math.abs(L[on]) < thr && Math.abs(R[on]) < thr) on++;
    const w1 = Math.round(0.001 * SR), ev = [];
    for (let a = on; a < Math.min(n - w1, on + Math.round(0.2 * SR)); a += 8) { let s = 0; for (let i = a; i < a + w1; i++) s += mono[i] * mono[i]; ev.push(s); }
    const evm = Math.max(...ev), k6 = ev.findIndex((v) => v >= evm * 0.25);
    m.onset = on / SR; m.attack = k6 * 8 / SR;
    // the first 10 ms against the next 100 ms (the snap): dB
    const rms = (a, b) => { let s = 0; for (let i = a; i < Math.min(n, b); i++) s += mono[i] * mono[i]; return Math.sqrt(s / Math.max(1, Math.min(n, b) - a)); };
    m.snap = 20 * Math.log10((rms(on, on + 0.01 * SR) + 1e-12) / (rms(on + 0.01 * SR, on + 0.11 * SR) + 1e-12));
    // per 50 ms
    const W = Math.round(0.05 * SR), lv = [], cen = [];
    for (let a = 0; a + W <= n; a += W) {
      let s = 0; for (let i = a; i < a + W; i++) s += mono[i] * mono[i]; lv.push(s / W);
      const q = spectrum(mono, a, 2048); let t = 0, u = 0; for (let k = 2; k < 1024; k++) { t += q[k]; u += q[k] * k * SR / 2048; } cen.push(t > 1e-12 ? Math.round(u / t / 100) / 10 : "-");
    }
    const mx = Math.max(...lv);
    m.env = lv.map((v) => Math.round(10 * Math.log10(v / mx + 1e-12))).join(" ");
    m.cen = cen.join(" ");
    const B = Math.min(n, Math.floor(0.4 * SR)); let bb = 0;
    for (let a = 0; a + B <= n; a += Math.floor(0.05 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += mono[i] * mono[i]; bb = Math.max(bb, s / B); }
    if (n < B) { let s = 0; for (let i = 0; i < n; i++) s += mono[i] * mono[i]; bb = s / B; }
    m.crest = 20 * Math.log10(pk / Math.sqrt(bb || 1e-20));
    // shots: onsets of a 2 ms envelope rising 9 dB over its 15 ms past, 40 ms apart
    const w2 = Math.round(0.002 * SR), envs = []; for (let a = 0; a + w2 <= n; a += w2) { let s = 0; for (let i = a; i < a + w2; i++) s += mono[i] * mono[i]; envs.push(s / w2); }
    const emx = Math.max(...envs); let shots = 0, last = -1e9;
    for (let k = 1; k < envs.length; k++) { let past = 0; for (let j = Math.max(0, k - 8); j < k - 1; j++) past = Math.max(past, envs[j]); if (envs[k] > emx * 0.02 && envs[k] > past * 8 && k - last > 20) { shots++; last = k; } }
    m.shots = shots;
    return m;
  }
  const fmt = (m, lim) => m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", crest " + m.crest.toFixed(1) + " dB, attack " +
    (m.attack * 1000).toFixed(1) + " ms, snap " + m.snap.toFixed(1) + " dB, <150 Hz " + (100 * m.lo150).toFixed(0) + "%, <300 Hz " + (100 * m.lo300).toFixed(0) + "%, >4 kHz " +
    (100 * m.hi4k).toFixed(0) + "%, centroid " + Math.round(m.centroid) + " Hz, shots " + m.shots + ", NaN " + m.nan + (lim ? ", Limiter " + lim : "");

  function run(name) {
    const round = ROUNDS[name];
    const ctrl = round.controlPatch || preset(round.control);
    const takes = [{ id: "control", control: true, why: round.controlWhy, patch: ctrl }].concat(round.takes);
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(t, round), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R, r.info ? r.info.shots[0] : 0), file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const line = fmt(m, lim);
      const detail = "level per 50 ms (dB): " + m.env + "\n      centroid per 50 ms (kHz): " + m.cen +
        (r.info ? "\n      model: " + r.info.type + ", " + r.info.shots.length + " shot(s) at " + r.info.shots.slice(0, 4).join(", ") + (r.info.shots.length > 4 ? " ..." : "") + " s" +
          "\n      render " + r.ms.toFixed(0) + " ms for " + m.sec.toFixed(2) + " s = " + (r.ms / m.sec).toFixed(0) + " ms per second of audio" : "");
      console.log("  " + file + "  " + t.id.padEnd(22) + line + "\n      " + detail);
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target"); if (!t.control && m.edgeE > 0.02) bad.push("end edge");
      if (bad.length) console.log("    !! " + bad.join(", "));
      key.push({ file, t, line, detail, lim });
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is " + (round.controlPatch ? "the best build of today's engines" : "the sound the app makes today") + ".\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" +
      "Model takes are the energy engine prototype's stereo output with the round's room (dsp.js `reverbProcess`: " + JSON.stringify(round.room) + "), no other chain; the control is rendered by the exported engine exactly as `tools/make-ab.mjs` does.\n\n" +
      "Attack is from the first sample 40 dB under the peak (at or after the trigger, so a charge is not counted) until a 1 ms window comes within 6 dB of the loudest millisecond (in the first 200 ms); snap is the first 10 ms against the next 100 ms; shots counts onsets.\n\n" +
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
      console.log((name + "/" + t.id).padEnd(42) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    per.sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }
  function today() {
    for (const nm of ["Plasma Rifle", "Plasma Shot", "Plasma Discharge", "Rail Fire", "Rail Round"]) {
      const r = renderControl(preset(nm)); matchLoudness(r.L, r.R);
      console.log(nm.padEnd(18) + fmt(measure(r.L, r.R), 0));
    }
  }

  const README = `# Energy weapon engine prototype: listening round

A PROTOTYPE engine, "energy" (plasma, rail, pulse and ion guns), against today's presets. Made by
\`node tools/proto/energy.mjs\` (the model, \`makeEnergy\`, and this round are both in that file). Nothing in the app changed.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one you would put in the game, and a runner-up. **One take in each folder
is the control**: today's preset, or for the full-auto gap the best build of today's engines. Then read \`KEY.md\`.

| # | folder | the sound | control |
|---|---|---|---|
| 1 | plasma-rifle | Plasma Rifle, one shot | Plasma Rifle, as it ships |
| 2 | plasma-shot | Plasma Shot, one bolt | Plasma Shot, as it ships |
| 3 | rail-fire | Rail Fire, a railgun | Rail Fire, as it ships |
| 4 | plasma-discharge | Plasma Discharge, a big charged release | Plasma Discharge, as it ships |
| 5 | pulse-rifle-auto | a pulse rifle on full auto (a GAP) | Plasma Rifle re-fired 14x at 11/s over Full Auto's impact |

In each folder the three model takes sit at clearly DIFFERENT points, not one knob apart: a HEAVY military weapon (low,
long, a deep kick, venting), a CHUNKY ARCADE one (clipped hard, punchy, short) and a SLEEK CLEAN one (bright, barely
driven, the bolt or the mechanism carrying it). Rail Fire's sleek take is a coilgun (the coils firing in turn); Plasma
Shot and Plasma Discharge each have an ION take (a crackling arc instead of a burst).

## What the engine is

Each part of an energy weapon as its own stage. An optional CHARGE (a capacitor whine climbing its charge curve over a
coil hum). The DISCHARGE, one model per type, always with a hard transient: plasma is a dense, saturated FM burst
dropping in pitch; a railgun is a SLAM (the rails struck, a thud), then a supersonic CRACK (an N-wave and its ground
reflection, a hyper-bright burst), the rails ringing and an electric zap; a pulse is a clean band-limited packet; ion is
an arc of crackle and buzz. The BOLT leaving (a whine whose doppler is real geometry: it falls as the bolt goes from
beside you to straight away; a railgun's slug is supersonic, so it tears the air instead). RECOIL (a low kick: weight).
AFTERGLOW (sizzle, a coil cooling, a vent hissing). CRUNCH: the gun (charge, discharge, kick) goes through one 4x
oversampled saturator together, so the kick and the bolt clip into each other; at the top, bit grit. The snap, the rail's crack, the charge and the
afterglow stay outside the saturator so it never rounds off the front. AUTO FIRE is real
re-triggers, every round with its own noise and a little variation, and HEAT that sags the pitch through a burst and
grows the cool-down.

Not in competition with Laser 2 (the spring "pew", kept this week): nothing here is a struck-wire chirp; these are the
heavy guns beside it.

## The room

Model takes are STEREO (the bolt leaves from the gun's side, the sizzle scatters), so like the glass and weather rounds
they get the control's own kind of reverb (dsp.js \`reverbProcess\`) and no other chain; the controls are rendered whole
by the exported engine, echoes and all. The model takes have NO echo (the controls' 70-120 ms delays are theirs).

## Cues that are not the question

- **Charges:** three takes charge first (0.35-1.2 s). If the wait is the only reason one loses (or wins), say so: charge
  time is one knob, and 0 fires at once.
- **Peaks:** a gun is peaky; KEY.md says which takes needed the app's own Limiter to reach -18 LUFS.
- **Lengths:** the model takes run to their afterglow's end; judge the first half second too.
`;

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  if (want === "--today") { today(); return; }
  mkdirSync(OUT, { recursive: true });
  for (const n of want ? [want] : ORDER) { if (!ROUNDS[n]) { console.error("no round " + n + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(n); }
  writeFileSync(join(OUT, "README.md"), README);
  console.log("\n-> " + OUT);
}
