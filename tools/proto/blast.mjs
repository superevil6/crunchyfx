/* blast.mjs — PROTOTYPE of a "blast" synthesis engine for CrunchySFX (explosions and gunshots), and the CLI that renders
 * its blind listening round.
 *
 *   node tools/proto/blast.mjs            render the round into soundtests/proto-blast/
 *   node tools/proto/blast.mjs --measure  the same, plus the physics checks (size sweep, echo probes) in full
 *
 * WHY. 18 of 26 Explosions are a sine + noise + the `boom` stage and the Guns sit on the `impact` engine: neither has a
 * model of what a blast IS. This one builds it from the physics, then lets the place and the distance do their work:
 *
 *   SOURCE (near field, what 1 m from the event would hear)
 *     PRESSURE WAVE  a Friedlander waveform p(t) = (1 - t/T)·exp(-b·t/T) after a short rise: near-instant rise, decay
 *                    through zero, a long shallow NEGATIVE phase. T (positive-phase length) follows Hopkinson-Cranz
 *                    cube-root scaling, T = 3 ms · W^(1/3), W the charge in kg TNT-equivalent (size 0 = a pistol's
 *                    ~0.3 g of propellant, 1 = a 100 kg bomb). So size sets the duration and the low end. `pulse`
 *                    stretches T beyond physics (cinematic weight); `shape` is b (fat 0.5 .. spiky 3).
 *     ROAR           the fireball / muzzle gas: turbulent noise whose band falls as the gas cools, length ~ W^(1/3).
 *     RUMBLE         sub-bass (35-75 Hz) ground/air rumble with slow swells, length ~ W^(1/3).
 *     DEBRIS         chunks thrown up and falling back: arrival times are FLIGHT TIMES (2·v·sinθ/g for random launch
 *                    speed and angle, compressed to a game-length window), landing spots scattered around the blast so
 *                    some land near the listener (loud, bright) and most far; each lands as dirt, stone, metal or glass
 *                    (modal ringing), plus a patter of grit.
 *     CRACK          a supersonic bullet's N-wave (Whitham: T_N = 1.82·M·b^¼·d / (c·(M²-1)^⅜·l^¼), ~150-250 µs).
 *                    At the shooter it lands with the report; DOWNRANGE it arrives FIRST, the report d·(1/c - 1/v) later.
 *     ACTION         the gun's mechanism, modal metal: a striker/hammer click before the shot; semi-auto = the slide
 *                    cycling just after it; bolt = a bolt worked by hand half a second later; plus the ejected casing
 *                    bouncing on the floor (restitution-timed bounces, brass modes).
 *   PROPAGATION (to the listener at `distance` m)
 *     air absorption (4.7 dB/km · (f/1 kHz)^1.3, the ISO 9613 curve's shape near 20 °C / 70 %RH, as a 4-pole low-pass
 *     whose corner is where the loss reaches 3 dB), weak-shock lengthening of the pulse (T grows ~sqrt(ln r)), a rise
 *     that slows with distance, and the ENVIRONMENT as an impulse response built from geometry:
 *       0 open field  ground reflection (image source, path difference from the heights) + 2 far terrain echoes +
 *                     a dark rolling tail; echoes relatively stronger as the listener moves away
 *       1 street      two parallel facades 16 m apart (2-D image sources: flutter at ~47 ms), far facades, a mid tail
 *       2 indoors     a 9 x 7 x 3.2 m room (3-D image sources to 80 ms) handing over to a Sabine tail (RT60 ~0.95 s)
 *       3 canyon      rock walls 70-200 m off: discrete echoes 0.4-1.2 s, each smeared by the rough face and darker
 *                     per bounce, over a long low tail
 *       4 forest      no discrete echoes: trunks scatter the HIGHS out of the direct path into a dense bright tail
 *     Image-source taps are gained by spherical spreading relative to the direct path (r0/r), so a far listener hears
 *     the echoes relatively louder, which is what distance does.
 *
 * PORTABLE SHAPE. `makeBlast(sr, cfg, seed)` is a pure factory like dsp.js makeBubbles / makeBrass: no DOM, no
 * Math.random (own seeded LCG), SR in. It renders BUFFERED (convolution with the environment IR is the honest way to do
 * a geometry room offline, and CrunchySFX renders offline anyway) and returns { tick(drive, out), L, R, info }: tick
 * writes one stereo sample, drive = the amp envelope (a plain gain, the blast is one event), exactly the shape
 * weather.mjs's thunder uses. In synth.js it would be a wave branch reading tick per sample, ahead of the filter / drive.
 * Pulses and the N-wave are BOX-INTEGRATED over each sample at 16 sub-samples (a first-order anti-alias on the only
 * discontinuities the model makes); modes are capped below 0.45·SR.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

export const BLAST_ENVS = ["open field", "street", "indoors", "canyon", "forest"];
export const BLAST_ACTIONS = ["none", "semi-auto", "bolt"];
export const BLAST_DEBRIS = ["earth", "rubble", "urban"];
export const BL_DEFAULTS = {
  size: 0.6,        // 0 pistol .. 1 large bomb: W = 10^(-3.5 + 5.5·size) kg TNT-eq
  distance: 20,     // m, listener to the blast (shooter perspective = 1)
  env: 0,           // BLAST_ENVS
  pulse: 1,         // positive-phase stretch: 1 = physical scaling, >1 = cinematic weight
  shape: 1,         // Friedlander decay b
  roar: 0.5,        // fireball / muzzle gas
  rumble: 0.5,      // sub rumble
  debris: 0,        // falling debris
  debrisType: 0,    // BLAST_DEBRIS
  crack: 0,         // supersonic N-wave
  downrange: 0,     // 1 = listener downrange of the shot
  speed: 850,       // bullet speed, m/s
  action: 0,        // mechanism level
  actionType: 1,    // BLAST_ACTIONS
  casing: 0,        // casing bouncing on the floor
  room: 1,          // environment level
  tail: 1,          // environment tail length
  width: 0.6,       // stereo spread
  dur: 1.5,         // seconds rendered
  probe: 0,         // measurement: the source is one unit impulse (no other components) -> the propagation's response
};
const C_AIR = 343, G = 9.81;

function blRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const blPan = (p) => [Math.cos((p + 1) * Math.PI / 4) * Math.SQRT2, Math.sin((p + 1) * Math.PI / 4) * Math.SQRT2];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// add a continuous waveform f(t) (t in s from its onset at t0 s, nonzero on [0, len)), box-integrated per sample
function addCont(buf, sr, t0, len, f, gain) {
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
// air absorption: corner where 4.7 dB/km·(f/1k)^1.3 reaches 3 dB over d metres (Infinity = transparent)
export function absorbCorner(d) { const f = 1000 * Math.pow(3 / (4.7e-3 * Math.max(d, 1e-3)), 1 / 1.3); return f > 19000 ? Infinity : f; }
function lowpass4(x, sr, fc) {          // 4 cascaded one-poles, each at fc/0.435 so the cascade is -3 dB at fc
  if (!isFinite(fc)) return;
  const a = Math.exp(-2 * Math.PI * Math.min(fc / 0.435, 0.45 * sr) / sr);
  for (let st = 0; st < 4; st++) { let y = 0; for (let i = 0; i < x.length; i++) { y = x[i] + (y - x[i]) * a; x[i] = y; } }
}
function onePoleKernel(sr, fc) {        // unit-DC one-pole impulse response (a tap darkened to fc)
  if (fc >= 0.45 * sr) return [1];
  const a = Math.exp(-2 * Math.PI * Math.max(fc, 40) / sr), out = [];
  for (let v = 1 - a; v > (1 - a) * 1e-4 && out.length < 4000; v *= a) out.push(v);
  return out;
}
// TPT SVF low-pass, tick returns lp
function svfLP() { return { ic1: 0, ic2: 0 }; }
function svfTick(f, x, g, k) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.ic2, v1 = a1 * f.ic1 + a2 * v3, v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
  f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2; return v2;
}
const svfG = (fc, sr) => Math.tan(Math.PI * clamp(fc, 5, sr * 0.45) / sr);
function smoothNoise(sr, hz, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = 0; const inc = hz / sr;
  return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * ph)); };
}
// a struck metal / glass / stone part: a click of noise and a few decaying modes
function addModal(L, R, sr, t0, modes, amp, pan, rnd, clickTau = 0.0003, clickFc = 5000) {
  const [pl, pr] = blPan(pan), i0 = Math.floor(t0 * sr);
  if (i0 >= L.length) return;
  const ca = Math.exp(-2 * Math.PI * Math.min(clickFc, 0.45 * sr) / sr), cn = Math.ceil(clickTau * 8 * sr);
  let lp = 0;
  for (let k = 0; k < cn && i0 + k < L.length; k++) {
    const x = (rnd() * 2 - 1) * Math.exp(-k / (clickTau * sr)); lp = x + (lp - x) * ca;
    const v = amp * 0.6 * (x - lp * 0.5); L[i0 + k] += v * pl; R[i0 + k] += v * pr;
  }
  for (const m of modes) {
    if (m.f >= 0.45 * sr) continue;
    const w = 2 * Math.PI * m.f / sr, dec = Math.exp(-1 / (m.tau * sr)), len = Math.min(L.length - i0, Math.ceil(m.tau * 7 * sr));
    let e = amp * m.a, ph = rnd() * 0.3;
    for (let k = 0; k < len; k++) { const v = e * Math.sin(ph); L[i0 + k] += v * pl; R[i0 + k] += v * pr; ph += w; e *= dec; }
  }
}
// a sliding contact (a bolt drawn back): band noise with friction grains
function addScrape(L, R, sr, t0, len, fc, amp, pan, rnd) {
  const [pl, pr] = blPan(pan), i0 = Math.floor(t0 * sr), n = Math.floor(len * sr), f = svfLP(), g = svfG(fc, sr), hp = svfLP(), gh = svfG(fc * 0.5, sr);
  for (let k = 0; k < n && i0 + k < L.length; k++) {
    const u = k / n, env = Math.sin(Math.PI * u) * (0.6 + 0.4 * (rnd() < 0.02 ? 1.8 : 1));
    const x = rnd() * 2 - 1, lp = svfTick(f, x, g, 1 / 3), h = lp - svfTick(hp, lp, gh, 0.7);
    const v = amp * env * h * 3; L[i0 + k] += v * pl; R[i0 + k] += v * pr;
  }
}

// ------------------------------------------------------------------ the environment's impulse response (direct path excluded)
function envIR(sr, c, W13, rnd, hs, hl) {
  const d = c.distance, room = c.room, tailMul = c.tail, width = c.width;
  const n = Math.floor(Math.min(c.dur, 4) * sr), L = new Float64Array(n), R = new Float64Array(n), taps = [];
  const tap = (t, g, fc, pan, rec = true) => {
    g *= room; const i = Math.round(t * sr); if (i < 0 || i >= n || g === 0) return;
    const k = onePoleKernel(sr, fc), [pl, pr] = blPan(clamp(pan, -1, 1));
    for (let j = 0; j < k.length && i + j < n; j++) { L[i + j] += g * k[j] * pl; R[i + j] += g * k[j] * pr; }
    if (rec) { const o = taps.find((q) => Math.abs(q.t - t) < 0.001); if (o) o.g += g; else taps.push({ t, g }); }
  };
  // a diffuse tail: decorrelated noise, raised-cosine onset, exponential decay, low-pass falling from fc0 to fc1;
  // scaled to the energy `E` (an impulse's direct path has energy 1), or to a power `P0` at time `tRef`
  const tail = (t0, rise, rt60, fc0, fc1, E, P0, tRef) => {
    const i0 = Math.floor(t0 * sr), tl = new Float64Array(n), tr = new Float64Array(n);
    let yl = 0, yr = 0;
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr, on = t < rise ? 0.5 - 0.5 * Math.cos(Math.PI * t / rise) : 1, env = on * Math.exp(-6.91 * t / rt60);
      const fc = fc0 * Math.pow(fc1 / fc0, Math.min(1, t / rt60)), a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr);
      const xl = (rnd() * 2 - 1) * env, xr = (rnd() * 2 - 1) * env;
      yl = xl + (yl - xl) * a; yr = xr + (yr - xr) * a; tl[i] = yl; tr[i] = yr;
    }
    let g;
    if (P0 !== undefined) {
      const a = Math.floor(tRef * sr), b = Math.min(n, a + Math.floor(0.025 * sr)); let p = 0;
      for (let i = a; i < b; i++) p += (tl[i] * tl[i] + tr[i] * tr[i]) / 2;
      g = Math.sqrt(P0 / Math.max(1e-30, p / Math.max(1, b - a)));
    } else {
      let e = 0; for (let i = 0; i < n; i++) e += (tl[i] * tl[i] + tr[i] * tr[i]) / 2;
      g = Math.sqrt(E / Math.max(1e-30, e));
    }
    const lw = 0.5 + 0.5 * width;   // stereo width of the tail: blend toward mono when narrow
    for (let i = 0; i < n; i++) { const m = (tl[i] + tr[i]) / 2; L[i] += g * (m + (tl[i] - m) * lw); R[i] += g * (m + (tr[i] - m) * lw); }
  };
  const groundTap = (refl, fc) => {
    const r0 = Math.hypot(d, hs - hl), r1 = Math.hypot(d, hs + hl);
    tap((r1 - r0) / C_AIR, refl * r0 / r1, fc, 0);
  };
  const env = Math.round(c.env);
  let rt60 = 0;
  if (env === 0) {                    // OPEN FIELD
    groundTap(0.7, 6000);
    for (let e = 0; e < 2; e++) {      // terrain far off (a treeline, a hill): an echo path of 2·Dr
      const Dr = 90 + 260 * rnd(), path = d + 2 * Dr, dt = (path - d) / C_AIR;
      tap(dt * (0.55 + 0.25 * e), 0.45 * d / path, Math.min(absorbCorner(path), 2200) * 0.7, (rnd() * 2 - 1) * 0.8 * width);
    }
    rt60 = 2.0 * tailMul;
    tail(0.04, 0.22, rt60, 600, 180, room * 0.12 * (1 + d / 150), undefined, 0);
  } else if (env === 1) {             // STREET: facades at y = 0 and y = W
    const W = 16, ys = 4.5, yl = 10.5;
    const r0 = Math.hypot(d, ys - yl);
    for (let q = -10; q <= 10; q++) for (let p = 0; p <= 1; p++) {
      const ord = Math.abs(2 * q - p); if (ord === 0) continue;
      const y = 2 * q * W + (p ? -ys : ys), r = Math.hypot(d, y - yl), dt = (r - r0) / C_AIR;
      if (dt > 0.6) continue;
      tap(dt, Math.pow(0.82, ord) * r0 / r, Math.min(9000 * Math.pow(0.8, ord), absorbCorner(r)), clamp((y - yl) / (Math.abs(y - yl) + 6), -1, 1) * width);
    }
    groundTap(0.9, 9000);
    for (let e = 0; e < 3; e++) {      // facades at the far ends and the cross streets
      const path = d + 2 * (25 + 70 * rnd());
      tap((path - r0) / C_AIR, 0.35 * r0 / path, Math.min(absorbCorner(path), 3500), (rnd() * 2 - 1) * width);
    }
    rt60 = 1.4 * tailMul;
    tail(0.015, 0.06, rt60, 3200, 700, room * 0.45 * (1 + d / 30), undefined, 0);
  } else if (env === 2) {             // INDOORS: a 9 x 7 x 3.2 m room, image sources
    const Lx = 9, Ly = 7, Lz = 3.2, dd = Math.min(d, 6.5);
    const S = [1.5, 3.2, Math.min(hs, 2.5)], Lp = [1.5 + dd * 0.95, 3.2 + dd * 0.3, hl];
    const r0 = Math.hypot(S[0] - Lp[0], S[1] - Lp[1], S[2] - Lp[2]), N = 8, tMax = 0.08;
    const img = (q, p, s, Lw) => 2 * q * Lw + (p ? -s : s);
    for (let qx = -N; qx <= N; qx++) for (let px = 0; px <= 1; px++)
      for (let qy = -N; qy <= N; qy++) for (let py = 0; py <= 1; py++)
        for (let qz = -N; qz <= N; qz++) for (let pz = 0; pz <= 1; pz++) {
          const ord = Math.abs(2 * qx - px) + Math.abs(2 * qy - py) + Math.abs(2 * qz - pz); if (ord === 0) continue;
          const x = img(qx, px, S[0], Lx), y = img(qy, py, S[1], Ly), z = img(qz, pz, S[2], Lz);
          const r = Math.hypot(x - Lp[0], y - Lp[1], z - Lp[2]), dt = (r - r0) / C_AIR;
          if (dt > tMax) continue;
          const taper = dt < 0.055 ? 1 : 1 - (dt - 0.055) / (tMax - 0.055);
          tap(dt, Math.pow(0.84, ord) * r0 / r * taper, Math.max(300, 12000 * Math.pow(0.78, ord)), clamp((y - Lp[1]) / (r + 1e-9) * 1.5, -1, 1) * width, ord <= 2);
        }
    // hand over to a statistical tail at the image response's own level (Sabine: V 202 m3, S 228 m2, alpha ~0.15 -> 0.95 s)
    const a = Math.floor(0.04 * sr), b = Math.floor(0.055 * sr); let p = 0;
    for (let i = a; i < b; i++) p += (L[i] * L[i] + R[i] * R[i]) / 2;
    rt60 = 0.95 * tailMul;
    tail(0.03, 0.03, rt60, 5000, 1100, 0, room * p / (b - a), 0.04);
  } else if (env === 3) {             // CANYON: rock walls either side, far apart; echoes smeared by the rough face
    const Dl = 70 + 60 * rnd(), Dr = 120 + 80 * rnd(), ys = 0, r0 = Math.max(1, d);
    for (let q = -3; q <= 3; q++) for (let p = 0; p <= 1; p++) {   // walls at y = -Dl and y = +Dr, listener at 0
      const ord = Math.abs(2 * q - p); if (ord === 0) continue;
      // image across the canyon: 2q·(Dl+Dr) + (p ? mirror in the left wall, -2Dl - ys : ys)
      const yy = 2 * q * (Dl + Dr) + (p ? (-2 * Dl - ys) : ys);
      const r = Math.hypot(d, yy), dt = (r - r0) / C_AIR; if (dt > 2.5) continue;
      const g = Math.pow(0.72, ord) * r0 / r, fc = Math.min(2600 * Math.pow(0.72, ord - 1), absorbCorner(r)), pan = clamp(Math.sign(yy) * 0.7, -1, 1) * width;
      { const o = taps.find((q) => Math.abs(q.t - dt) < 0.001); if (o) o.g += g * room; else taps.push({ t: dt, g: g * room }); }
      const nSub = 24, spread = 0.012 + 0.012 * ord;                 // the rough face: a cluster, not a point
      for (let s = 0; s < nSub; s++) {
        const u = rnd() + rnd() + rnd() - 1.5;                        // ~gaussian over the cluster
        tap(dt + u * spread, g * (0.5 + rnd()) / Math.sqrt(nSub) * 1.6, fc * (0.7 + 0.6 * rnd()), pan + (rnd() - 0.5) * 0.4 * width, false);
      }
    }
    groundTap(0.6, 3500);
    rt60 = 3.0 * tailMul;
    tail(0.06, 0.3, rt60, 900, 220, room * 0.35 * (1 + d / 200), undefined, 0);
  } else {                            // FOREST: scattering, no discrete echoes
    groundTap(0.5, 2500);
    rt60 = 1.6 * tailMul;
    tail(0.004, 0.02, rt60, 6500, 900, room * 0.55 * (1 + d / 60), undefined, 0);
  }
  taps.sort((a, b) => b.g - a.g);
  return { L, R, taps, rt60 };
}

// ------------------------------------------------------------------ FFT convolution of a mono signal with a stereo IR
function fft(re, im, inv) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= N; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a), h = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const p = i + k, q = p + h, vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
}
function convolveStereo(x, irL, irR, n) {
  let N = 1; while (N < n + irL.length) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x.subarray(0, n)); hr.set(irL); hi.set(irR);          // pack IR L + i·IR R: one complex FFT for both
  fft(xr, xi, false); fft(hr, hi, false);
  for (let k = 0; k < N; k++) { const a = xr[k], b = xi[k], c = hr[k], d = hi[k]; hr[k] = a * c - b * d; hi[k] = a * d + b * c; }
  fft(hr, hi, true);
  return { L: hr.subarray(0, n), R: hi.subarray(0, n) };       // x real: real part = x*irL, imaginary = x*irR
}

// ------------------------------------------------------------------ the factory
export function makeBlast(sr, cfg, seed) {
  const c = Object.assign({}, BL_DEFAULTS, cfg);
  const rnd = blRng(seed);
  const n = Math.max(16, Math.floor(c.dur * sr));
  const W = Math.pow(10, -3.5 + 5.5 * clamp(c.size, 0, 1)), W13 = Math.cbrt(W);
  const d = Math.max(0.5, c.distance), isGun = c.action > 0 || c.crack > 0 || c.size < 0.3;
  const hs = isGun ? 1.4 : 0.3, hl = 1.7;
  const width = c.width;

  // TIMING: a pre-roll for the action's pre-click (guns), the crack's lead (downrange)
  const crackLead = c.crack > 0 && c.downrange ? d * (1 / C_AIR - 1 / Math.max(C_AIR * 1.05, c.speed)) : 0;
  const tB = (c.action > 0 ? 0.035 : 0.004) + crackLead;           // the report's arrival (s)

  // PRESSURE WAVE: Hopkinson-Cranz T+, stretched by weak-shock propagation and `pulse`
  const T = 0.003 * W13 * c.pulse * Math.sqrt(1 + 0.4 * Math.log(1 + d / 5));
  const b = Math.max(0.3, c.shape), rise = 10e-6 + d * 2e-6;
  const fried = (t) => { if (t < rise) return 0.5 - 0.5 * Math.cos(Math.PI * t / rise); const u = (t - rise) / T; return (1 - u) * Math.exp(-b * u); };
  const blastLen = rise + T * (1 + 14 / b);

  // buses: S = the source (mono, panned later), Dl/Dr = the debris field (stereo, already placed), K = the crack
  const S = new Float64Array(n), Dl = new Float64Array(n), Dr = new Float64Array(n), K = new Float64Array(n);
  const P = new Float64Array(n);  // the pressure wave alone, for measurement / energy reference
  addCont(P, sr, tB, blastLen, fried, 1);
  let Eb = 0; for (let i = 0; i < n; i++) Eb += P[i] * P[i];
  const info = { W, W13, Tplus: T, rise, b, blastAt: Math.floor(tB * sr), crackAt: null, crackLead, absorbFc: absorbCorner(d),
    env: BLAST_ENVS[Math.round(c.env)], debrisEvents: 0, energies: {} };

  if (c.probe) {
    S[Math.floor(tB * sr)] = 1;
  } else {
    for (let i = 0; i < n; i++) S[i] = P[i];
    const scaleTo = (buf, ratio) => {   // scale a component so its energy is `ratio` x the pressure wave's
      let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i];
      return e > 0 ? Math.sqrt(ratio * Eb / e) : 0;
    };
    // ROAR: the fireball / muzzle gas
    if (c.roar > 0) {
      const tau = 0.003 + 0.12 * Math.pow(W13, 1.3), fc0 = 7000 / (1 + 2 * W13), fc1 = fc0 / 5;
      const buf = new Float64Array(n), f1 = svfLP(), f2 = svfLP(), i0 = Math.floor(tB * sr), len = Math.min(n - i0, Math.ceil(tau * 9 * sr));
      const flick = smoothNoise(sr, 25, rnd);
      for (let k = 0; k < len; k++) {
        const t = k / sr, env = (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / tau) * (1 + 0.35 * flick());
        const fc = fc0 * Math.pow(fc1 / fc0, Math.min(1, t / (tau * 3))), g = svfG(fc, sr);
        buf[i0 + k] = svfTick(f2, svfTick(f1, (rnd() * 2 - 1) * env, g, 0.9), g, 0.9);
      }
      // level: the gas's RMS over its loudest 5 ms is roar x 0.45 x the pressure wave's peak. Peak-relative, not
      // energy-relative: a 0.3 ms muzzle shock carries almost no energy, but the gas jet behind it is what a mic hears
      let pkP = 0; for (let i = 0; i < n; i++) pkP = Math.max(pkP, Math.abs(P[i]));
      const w5 = Math.floor(0.005 * sr); let best = 0, acc = 0;
      for (let i = 0; i < n; i++) { acc += buf[i] * buf[i]; if (i >= w5) acc -= buf[i - w5] * buf[i - w5]; if (acc > best) best = acc; }
      const gn = best > 0 ? c.roar * 0.45 * pkP / Math.sqrt(best / w5) : 0;
      { let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i]; info.energies.roar = +(e * gn * gn / Eb).toFixed(2); }
      for (let i = 0; i < n; i++) S[i] += buf[i] * gn;
    }
    // RUMBLE: sub, slow swells
    if (c.rumble > 0) {
      const fc = 30 + 45 / (1 + W13), tau = 0.12 + 0.55 * W13, ta = 0.02 + 0.03 * W13;
      const buf = new Float64Array(n), f1 = svfLP(), f2 = svfLP(), g = svfG(fc, sr), sw = smoothNoise(sr, 2.5, rnd), i0 = Math.floor(tB * sr);
      for (let i = i0; i < n; i++) {
        const t = (i - i0) / sr, env = (1 - Math.exp(-t / ta)) * Math.exp(-t / tau) * (1 + 0.5 * sw());
        buf[i] = svfTick(f2, svfTick(f1, (rnd() * 2 - 1) * env, g, 0.8), g, 0.8);
      }
      const gn = scaleTo(buf, 2.5 * c.rumble * c.rumble); info.energies.rumble = 2.5 * c.rumble * c.rumble;
      for (let i = 0; i < n; i++) S[i] += buf[i] * gn;
    }
    // DEBRIS: flight-timed landings scattered around the blast
    if (c.debris > 0) {
      const vmax = 8 + 30 * c.size, win = 0.3 + 1.5 * c.size, tFlightMax = 2 * vmax / G;
      const nEv = Math.round(c.debris * (8 + 50 * c.size)), mats = [[0.55, 0.4, 0.05, 0], [0.25, 0.5, 0.25, 0], [0.15, 0.3, 0.3, 0.25]][Math.round(c.debrisType)] || [1, 0, 0, 0];
      for (let e = 0; e < nEv; e++) {
        const v = vmax * Math.pow(rnd(), 0.6), th = (10 + 70 * rnd()) * Math.PI / 180, fl = 2 * v * Math.sin(th) / G;
        const t = tB + 0.05 + win * fl / tFlightMax, range = v * v * Math.sin(2 * th) / G, ph = rnd() * 2 * Math.PI;
        const lx = range * Math.cos(ph) - d, ly = range * Math.sin(ph), dist = Math.hypot(lx, ly) + 1;
        const near = Math.min(3, d / dist), pan = clamp(ly / (dist + 3), -1, 1) * width;
        const sz = -Math.log(Math.max(1e-6, rnd())), amp = near * (0.3 + sz) * 0.5;
        let r = rnd(), m = 0; while (m < 3 && r > mats[m]) { r -= mats[m]; m++; }
        if (m === 0) {           // dirt: a dull thud
          const tau = 0.003 + 0.008 * rnd(), fc = 500 + 2000 * rnd() / (1 + sz);
          addModal(Dl, Dr, sr, t, [], amp * 1.6, pan, rnd, tau, fc);
        } else if (m === 1) {    // stone: a click and two short modes
          const f = 1200 + 2500 * rnd();
          addModal(Dl, Dr, sr, t, [{ f, a: 0.5, tau: 0.006 + 0.01 * rnd() }, { f: f * (1.6 + 0.8 * rnd()), a: 0.3, tau: 0.004 + 0.006 * rnd() }], amp, pan, rnd, 0.0006, 4000);
        } else if (m === 2) {    // metal: a ringing part
          const f = 900 + 2400 * rnd() / (0.5 + sz * 0.5), tau = 0.04 + 0.12 * rnd();
          addModal(Dl, Dr, sr, t, [1, 2.32, 3.86, 5.1].map((q, k) => ({ f: f * q * (1 + 0.02 * (rnd() - 0.5)), a: 0.45 / (k + 1), tau: tau / (1 + k * 0.6) })), amp * 0.7, pan, rnd, 0.0003, 6000);
        } else {                 // glass: a few shards, high and tinkly
          for (let s = 0; s < 3; s++) {
            const f = 2500 + 3500 * rnd();
            addModal(Dl, Dr, sr, t + s * 0.012 * rnd(), [1, 1.73, 2.9].map((q, k) => ({ f: f * q, a: 0.35 / (k + 1), tau: 0.02 + 0.06 * rnd() })), amp * 0.4, pan + (rnd() - 0.5) * 0.3, rnd, 0.0002, 9000);
          }
        }
        info.debrisEvents++;
      }
      // grit patter: many tiny grains early
      const nG = Math.round(c.debris * 140 * (0.3 + c.size));
      for (let e = 0; e < nG; e++) {
        const t = tB + 0.03 + 0.5 * win * Math.pow(rnd(), 1.4), pan = (rnd() * 2 - 1) * width;
        addModal(Dl, Dr, sr, t, [], 0.12 * rnd(), pan, rnd, 0.0004, 2500 + 4000 * rnd());
      }
      let e = 0; for (let i = 0; i < n; i++) e += (Dl[i] * Dl[i] + Dr[i] * Dr[i]) / 2;
      const gn = e > 0 ? Math.sqrt(0.5 * c.debris * c.debris * Eb / e) : 0; info.energies.debris = 0.5 * c.debris * c.debris;
      for (let i = 0; i < n; i++) { Dl[i] *= gn; Dr[i] *= gn; }
    }
    // ACTION + CASING: modal metal at the shooter
    if (c.action > 0 || c.casing > 0) {
      const mL = new Float64Array(n), mR = new Float64Array(n), at = Math.round(c.actionType), aPan = 0.15 * width;
      const steel = (f, tau) => [1, 2.76, 5.4, 8.93].map((q, k) => ({ f: f * q * (1 + 0.01 * (rnd() - 0.5)), a: 0.6 / (k + 1), tau: tau / (1 + 0.5 * k) }));
      let casingAt = null;
      if (c.action > 0 && at > 0) {
        addModal(mL, mR, sr, tB - 0.028, steel(2600, 0.01), 0.25, aPan, rnd, 0.0002, 7000);   // trigger break
        addModal(mL, mR, sr, tB - 0.005, steel(3300, 0.014), 0.6, aPan, rnd, 0.0002, 8000);   // striker / hammer fall
        if (at === 1) {        // semi-auto: the slide cycles inside the report
          addModal(mL, mR, sr, tB + 0.004, steel(1700, 0.03), 0.9, aPan, rnd, 0.0006, 5000);
          addModal(mL, mR, sr, tB + 0.026, steel(1500, 0.045), 1.3, aPan, rnd, 0.0008, 4500);  // back into battery: the clack
          casingAt = tB + 0.42 + 0.08 * rnd();
        } else if (at === 2) { // bolt worked by hand
          const tb = tB + 0.5;
          addModal(mL, mR, sr, tb, steel(2200, 0.02), 0.7, aPan, rnd, 0.0003, 6000);           // lift
          addScrape(mL, mR, sr, tb + 0.03, 0.11, 2600, 0.35, aPan, rnd);                      // draw back
          addModal(mL, mR, sr, tb + 0.14, steel(1600, 0.05), 1.1, aPan, rnd, 0.0007, 5000);    // end stop
          addScrape(mL, mR, sr, tb + 0.27, 0.1, 2300, 0.3, aPan, rnd);                        // push home
          addModal(mL, mR, sr, tb + 0.37, steel(1500, 0.05), 1.0, aPan, rnd, 0.0007, 5000);    // chamber
          addModal(mL, mR, sr, tb + 0.45, steel(2400, 0.025), 0.8, aPan, rnd, 0.0003, 6000);   // lock down
          casingAt = tb + 0.14 + 0.38;
        }
        info.casingAt = casingAt;
      }
      if (c.casing > 0) {      // brass tube on a hard floor: restitution-timed bounces
        let t = casingAt ?? tB + 0.45, dt = 0.11, a = 1;
        const f = 5200 + 1500 * rnd(), cp = (rnd() * 2 - 1) * 0.5 * width;
        for (let k = 0; k < 5 && a > 0.05; k++) {
          addModal(mL, mR, sr, t, [1, 1.47, 2.31, 2.88].map((q, j) => ({ f: f * q * (1 + 0.01 * j * (rnd() - 0.5)), a: 0.5 / (j + 1), tau: 0.06 + 0.06 * rnd() })), a * c.casing * 0.5, cp, rnd, 0.0002, 9000);
          t += dt; dt *= 0.62; a *= 0.55;
        }
      }
      // level: the mechanism as a share of the pressure wave's energy (0.06 at action 1; a game-compressed -12 dB)
      let e = 0; for (let i = 0; i < n; i++) e += (mL[i] * mL[i] + mR[i] * mR[i]) / 2;
      const lvl = Math.max(c.action, c.casing * 0.6), gn = e > 0 ? Math.sqrt(0.06 * lvl * lvl * Eb / e) : 0; info.energies.action = 0.06 * lvl * lvl;
      for (let i = 0; i < n; i++) { Dl[i] += mL[i] * gn; Dr[i] += mR[i] * gn; }
    }
    // CRACK: the bullet's N-wave
    if (c.crack > 0) {
      const M = Math.max(1.05, c.speed / C_AIR), bm = c.downrange ? 5 : 2, dia = 0.0078, len = 0.03;
      const TN = 1.82 * M * Math.pow(bm, 0.25) * dia / (C_AIR * Math.pow(M * M - 1, 0.375) * Math.pow(len, 0.25));
      const tC = c.downrange ? 0.004 : tB + 0.0002;
      const nwave = (t) => 1 - 2 * t / TN;
      addCont(K, sr, tC, TN, nwave, 1);
      lowpass4(K, sr, absorbCorner(c.downrange ? bm : 1));
      let pkB = 0; for (let i = 0; i < n; i++) pkB = Math.max(pkB, Math.abs(P[i]));
      let pkK = 0; for (let i = 0; i < n; i++) pkK = Math.max(pkK, Math.abs(K[i]));
      // at the shooter the crack sits level with the report's peak (crack 1); downrange its peak stands far over the
      // DISTANT report's (x the 1/d the report has lost against the crack's ~b^-3/4, game-compressed to x2..x8)
      // not downrange (at / beside / behind the shooter): the cone points away, so beyond a few tens of metres it is gone
      const rel = c.downrange ? Math.min(8, 2 + Math.pow(d / bm, 0.75) / 10) : 1 / (1 + Math.pow(d / 15, 2));
      const gnK = pkK > 0 ? c.crack * rel * pkB / pkK : 0;
      for (let i = 0; i < n; i++) K[i] *= gnK;
      info.crackAt = Math.floor(tC * sr); info.crackTN = TN; info.crackRel = rel;
    }
  }

  // PROPAGATION: air absorption on the source (the debris field has its own, shorter paths: absorbed at 0.8 d),
  // forest scattering pulls the highs out of the direct path
  const fcS = absorbCorner(d);
  lowpass4(S, sr, fcS);
  lowpass4(Dl, sr, absorbCorner(d * 0.8)); lowpass4(Dr, sr, absorbCorner(d * 0.8));
  if (Math.round(c.env) === 4) { const fcF = 4000 * Math.sqrt(50 / Math.max(d, 50)) * 2.2; lowpass4(S, sr, fcF); lowpass4(Dl, sr, fcF); lowpass4(Dr, sr, fcF); info.forestFc = fcF; }

  // ENVIRONMENT
  // the place has its own random stream, so the same seed builds the same room whatever the source contains
  const ir = envIR(sr, Object.assign({}, c, { distance: d }), W13, blRng((seed ^ 0x9e3779b9) >>> 0), hs, hl);
  info.taps = ir.taps.slice(0, 12).map((t) => ({ t: +t.t.toFixed(4), g: +t.g.toFixed(4) })); info.rt60 = ir.rt60;
  const M = new Float64Array(n), down = c.crack > 0 && c.downrange && !c.probe;
  for (let i = 0; i < n; i++) M[i] = S[i] + (down ? 0 : K[i]) + (Dl[i] + Dr[i]) * 0.5;
  const wet = convolveStereo(M, ir.L, ir.R, n);
  if (down) {   // downrange the crack is born ~5 m from the listener: the same terrain, but its own (short) direct path
    const irK = envIR(sr, Object.assign({}, c, { distance: 5 }), W13, blRng((seed ^ 0x9e3779b9) >>> 0), 1.5, hl);
    const wk = convolveStereo(K, irK.L, irK.R, n);
    for (let i = 0; i < n; i++) { wet.L[i] += wk.L[i]; wet.R[i] += wk.R[i]; }
  }
  const [pl, pr] = blPan((rnd() - 0.5) * 0.3 * width);
  const L = new Float32Array(n), R = new Float32Array(n);
  // DC: a Friedlander with b != 1 has net area, the rumble sits low: 2-pole high-pass at 18 Hz (a microphone's own)
  const hpA = Math.exp(-2 * Math.PI * 18 / sr);
  let h1l = 0, h1r = 0, x1l = 0, x1r = 0, h2l = 0, h2r = 0, y1l = 0, y1r = 0;
  for (let i = 0; i < n; i++) {
    const xl = (S[i] + K[i]) * pl + Dl[i] + wet.L[i], xr = (S[i] + K[i]) * pr + Dr[i] + wet.R[i];
    h1l = hpA * (h1l + xl - x1l); x1l = xl; h2l = hpA * (h2l + h1l - y1l); y1l = h1l;
    h1r = hpA * (h1r + xr - x1r); x1r = xr; h2r = hpA * (h2r + h1r - y1r); y1r = h1r;
    L[i] = h2l; R[i] = h2r;
  }
  let i = 0;
  return { L, R, info, n, tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// =====================================================================================================================
// THE CLI: the listening round
// =====================================================================================================================
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SR = 44100, TARGET_LUFS = -18, VERBOSE = process.argv.includes("--measure");
  const GL = { console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  const ctx = createContext(Object.assign({}, GL)); ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx);
  const dctx = createContext(Object.assign({}, GL));
  runInContext(readFileSync(join(ROOT, "dsp.js"), "utf8"), dctx, { filename: "dsp.js" });
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  const PRESETS = pctx.window.PRESETS;
  const preset = (nm) => { const o = Object.assign({}, PRESETS[nm]); delete o._vary; return o; };

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, 400 ms blocks, gated) + its 0.95 peak cap
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
  // as weather.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js
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
    // still short at the slider's top: a SECOND pass of the same limiter (beyond what one preset's Limiter can reach;
    // reported as "1+x" so it is never mistaken for a setting the app has)
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

  function renderTake(t) {
    if (t.control) {
      const r = CS.render(Object.assign({}, CS.DEFAULTS, t.control), { normalize: true });
      return { L: Float32Array.from(r.L), R: Float32Array.from(r.R), info: null };
    }
    const r = makeBlast(SR, t.cfg, t.seed);
    const n = r.n, fo = Math.floor(0.06 * SR);                          // guard: no click at the end
    for (let i = 0; i < fo; i++) { const g = i / fo; r.L[n - 1 - i] *= g; r.R[n - 1 - i] *= g; }
    return { L: r.L, R: r.R, info: r.info };
  }

  // ---- measurement
  function spectrumShares(L, R) {   // whole-file energy below 150 Hz, and the spectral centroid
    let N = 1; while (N < L.length) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < L.length; i++) re[i] = (L[i] + R[i]) / 2;
    fft(re, im, false);
    let lo = 0, all = 0, num = 0;
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k], f = k * SR / N; all += p; num += f * p; if (f < 150) lo += p; }
    return { low: lo / (all || 1), centroid: num / (all || 1) };
  }
  function envDb(x, win) {          // |x| peak-hold envelope per 1 ms, dB
    const h = Math.floor(0.001 * SR), out = [];
    for (let a = 0; a < x.length; a += h) { let m = 0; for (let i = Math.max(0, a - win); i < Math.min(x.length, a + h + win); i++) m = Math.max(m, Math.abs(x[i])); out.push(20 * Math.log10(m + 1e-12)); }
    return out;
  }
  function riseOf(x, at, span) {    // 10-90 % rise of the FIRST positive peak after `at` (samples) reaching half the span's max, in us
    let top = 0; for (let i = at; i < Math.min(x.length, at + span); i++) top = Math.max(top, x[i]);
    let pk = 0, pi = at;
    for (let i = at; i < Math.min(x.length - 1, at + span); i++) if (x[i] >= 0.5 * top && x[i] >= x[i + 1]) { pk = x[i]; pi = i; break; }
    let i10 = pi, i90 = pi; for (let i = pi; i >= at; i--) { if (x[i] >= 0.9 * pk) i90 = i; if (x[i] >= 0.1 * pk) i10 = i; else break; }
    // sub-sample: linear interpolation at both crossings
    const frac = (i, lvl) => (i > 0 && x[i] !== x[i - 1] ? (x[i] - lvl) / (x[i] - x[i - 1]) : 0);
    return Math.max(0, ((i90 - frac(i90, 0.9 * pk)) - (i10 - frac(i10, 0.1 * pk))) / SR * 1e6);
  }
  function measure(L, R, info) {
    const n = L.length; let pk = 0, nan = 0;
    for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e = Math.floor(0.002 * SR); let sMax = 0, eMax = 0;
    for (let i = 0; i < e; i++) { sMax = Math.max(sMax, Math.abs(L[i]), Math.abs(R[i])); eMax = Math.max(eMax, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeStart: sMax / (pk || 1), edgeEnd: eMax / (pk || 1) };
    Object.assign(m, spectrumShares(L, R));
    // crest: peak over the RMS of the loudest 400 ms
    const B = Math.min(n, Math.floor(0.4 * SR)); let best = 0;
    for (let a = 0; a + B <= n; a += Math.floor(0.05 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / B); }
    m.crestDb = 20 * Math.log10(pk / Math.sqrt(best || 1e-20));
    if (info) {
      const mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
      m.rise = riseOf(mono, info.blastAt, Math.floor((info.Tplus * 3 + 0.002) * SR));
      if (info.crackLead > 0) m.crackRise = riseOf(mono, Math.max(0, info.crackAt - 2), Math.floor(0.002 * SR));
      if (info.crackLead > 0) {    // measured gap: crack peak to the report's onset (first ms where the envelope comes within 12 dB of its post-crack max)
        const env = envDb(mono, 0), c0 = Math.floor(info.crackAt / (0.001 * SR));
        const after = env.slice(c0 + 60), mx = Math.max(...after), on = after.findIndex((v) => v > mx - 12);
        m.crackGapMeasured = (60 + on) / 1000 + (c0 * 0.001 - info.crackAt / SR);
        m.crackOverReportDb = Math.max(...env.slice(c0, c0 + 4)) - mx;
      }
    }
    return m;
  }
  // the propagation alone: the model with a unit-impulse source; strongest intended echoes found in the output
  function probe(cfg, seed) {
    const r = makeBlast(SR, Object.assign({}, cfg, { probe: 1 }), seed), mono = Float64Array.from(r.L, (x, i) => (x + r.R[i]) / 2);
    const at = r.info.blastAt, out = { taps: [], rt60: null };
    // echoes: the strongest intended taps (> 3 ms, at least 4 ms apart, top 4); for each, the envelope max within a window
    // of +-min(6 ms, 0.3 t), and its level over the median envelope of the 30 ms before the window (after the direct)
    const env = new Float64Array(mono.length); { const a = Math.exp(-1 / (0.0007 * SR)); let e = 0; for (let i = 0; i < mono.length; i++) { e = Math.max(Math.abs(mono[i]), e * a); env[i] = e; } }
    const pick = [];
    for (const t of r.info.taps) { if (at + (t.t + 0.01) * SR < mono.length && t.t > 0.003 && pick.every((q) => Math.abs(q.t - t.t) > 0.004)) pick.push(t); if (pick.length === 4) break; }
    pick.sort((p, q) => p.t - q.t);
    for (const t of pick) {
      const c = at + Math.round(t.t * SR), w = Math.max(Math.round(0.001 * SR), Math.round(Math.min(0.006, 0.3 * t.t) * SR));
      let mx = 0, mi = c; for (let i = Math.max(0, c - w); i < Math.min(mono.length, c + w); i++) if (env[i] > mx) { mx = env[i]; mi = i; }
      const f0 = Math.max(at + Math.round(0.0015 * SR), c - w - Math.round(0.03 * SR));
      const fl = Array.from(env.subarray(f0, Math.max(f0 + 1, c - w))).sort((p, q) => p - q);
      out.taps.push({ want: t.t, got: (mi - at) / SR, overFloorDb: 20 * Math.log10(mx / (fl[fl.length >> 1] || 1e-12)) });
    }
    // RT60 by Schroeder backward integration of the probe after the direct (T20: -5 to -25 dB, x3)
    const s0 = at + Math.round(0.002 * SR), E = new Float64Array(mono.length - s0); let acc = 0;
    for (let i = mono.length - 1; i >= s0; i--) { acc += mono[i] * mono[i]; E[i - s0] = acc; }
    const db = (i) => 10 * Math.log10(E[i] / E[0] + 1e-30);
    let a5 = -1, a25 = -1; for (let i = 0; i < E.length; i++) { if (a5 < 0 && db(i) < -5) a5 = i; if (a25 < 0 && db(i) < -25) { a25 = i; break; } }
    if (a5 >= 0 && a25 > a5) out.rt60 = 3 * (a25 - a5) / SR;
    out.dr = (() => { let dE = 0, rE = 0; const w = Math.round(0.0025 * SR); for (let i = 0; i < mono.length; i++) { const v = mono[i] * mono[i]; if (i >= at && i < at + w) dE += v; else if (i >= at + w) rE += v; } return 10 * Math.log10(dE / (rE || 1e-30)); })();
    return out;
  }

  // ---- THE ROUND
  const SOUNDS = [
    { name: "Explosion", listen: "A general-purpose explosion (a barrel, a car, a building charge). Which one is an EXPLOSION, a real blast in a real place, rather than a filtered noise burst? Listen to the first instant (is there a hit with weight), what follows (fire, falling debris, the place answering back) and whether it ends like a sound in the world or like an envelope closing.",
      takes: [
        { id: "open-ground-25m", why: "MODEL, a ~0.8 kg charge on open ground, heard from 25 m: the pressure wave (Friedlander, positive phase stretched 2x for weight), a fireball roar, sub rumble, dirt and stones falling back over ~1.3 s (flight-timed), the ground reflection and a faint far treeline echo with a dark rolling tail.",
          cfg: { size: 0.62, distance: 25, env: 0, pulse: 2, shape: 1, roar: 0.6, rumble: 0.6, debris: 0.6, debrisType: 0, width: 0.7, dur: 2.0 }, seed: 101 },
        { id: "city-street-45m", why: "MODEL, a bigger charge (~3 kg) in a city street, 45 m away, cinematic weight (positive phase x3): facades 16 m apart return a flutter of reflections (~47 ms apart), the far ends of the street a couple of later slaps; urban debris (glass, metal, masonry) raining down.",
          cfg: { size: 0.72, distance: 45, env: 1, pulse: 3, shape: 0.8, roar: 0.7, rumble: 0.8, debris: 0.7, debrisType: 2, width: 0.8, dur: 2.2 }, seed: 113 },
        { id: "canyon-80m", why: "MODEL, the same kind of charge in a rocky canyon, 80 m away: rock and stone debris, then the walls answer: discrete echoes 0.3-1.2 s later, each smeared by the rough face and darker than the last, over a long low tail.",
          cfg: { size: 0.7, distance: 80, env: 3, pulse: 2.5, shape: 1, roar: 0.5, rumble: 0.7, debris: 0.35, debrisType: 1, width: 0.8, dur: 2.6 }, seed: 127 },
      ] },
    { name: "Grenade Blast", listen: "A hand grenade going off nearby. Which one is a GRENADE: a small, violent, sharp blast (not a big movie boom)? Which one tells you where it went off?",
      takes: [
        { id: "open-15m-physical", why: "MODEL, ~0.2 kg of explosive 15 m away in the open, the pressure wave at its PHYSICAL length (positive phase ~2 ms: a hard crack-thump, little sub), a short fireball, dirt and grit patter falling back, the ground reflection, a faint far echo.",
          cfg: { size: 0.5, distance: 15, env: 0, pulse: 1, shape: 1.2, roar: 0.35, rumble: 0.3, debris: 0.6, debrisType: 0, width: 0.7, dur: 1.6 }, seed: 211 },
        { id: "inside-a-room", why: "MODEL, the same grenade inside a 9 x 7 m room, 4 m away: the image-source early reflections pile into one dense boom within ~30 ms, then a ~1 s room tail; rubble and glass falling.",
          cfg: { size: 0.5, distance: 4, env: 2, pulse: 1.5, shape: 1.1, roar: 0.4, rumble: 0.4, debris: 0.5, debrisType: 2, width: 0.7, dur: 1.6 }, seed: 223 },
        { id: "street-30m-weighted", why: "MODEL, the grenade in a street 30 m off, WEIGHTED for a game (positive phase x3, more rumble): the facades' flutter and slaps, urban debris.",
          cfg: { size: 0.52, distance: 30, env: 1, pulse: 3, shape: 1, roar: 0.5, rumble: 0.6, debris: 0.5, debrisType: 2, width: 0.75, dur: 1.8 }, seed: 239 },
      ] },
    { name: "Distant Boom", listen: "An explosion far away (artillery over the hills, a demolition across the city). Which one is FAR: a dull thump that the landscape carries, rather than a near boom made quiet and muffled? Use speakers or headphones with some bass.",
      takes: [
        { id: "artillery-1.5km-open", why: "MODEL, a heavy bomb (~30 kg) 1.5 km away over open country: the air has taken everything above ~0.5 kHz (absorption 4.7 dB/km x (f/1k)^1.3), the pulse has lengthened in flight, no debris to hear; two terrain echoes 0.3-1 s later (relatively strong now: at this range the direct path has spread as much as they have) and a long rolling low tail.",
          cfg: { size: 0.9, distance: 1500, env: 0, pulse: 2, shape: 1, roar: 0.6, rumble: 0.9, debris: 0, width: 0.8, tail: 1.2, room: 1.2, dur: 3.0 }, seed: 307 },
        { id: "across-a-valley-800m", why: "MODEL, a ~8 kg blast across a rocky valley 800 m away: the canyon walls return it in a train of dark, smeared echoes over ~1.2 s: the classic rolling 'boom ... boom' of a demolition in the mountains.",
          cfg: { size: 0.8, distance: 800, env: 3, pulse: 2, shape: 1, roar: 0.5, rumble: 0.8, debris: 0, width: 0.85, dur: 3.0 }, seed: 311 },
        { id: "through-the-woods-600m", why: "MODEL, the same blast 600 m away through forest: the trees scatter the highs OUT of the direct path (so the thump is even duller) and INTO a dense diffuse tail; no discrete echoes at all.",
          cfg: { size: 0.8, distance: 600, env: 4, pulse: 2, shape: 1, roar: 0.5, rumble: 0.8, debris: 0, width: 0.85, dur: 3.0 }, seed: 331 },
      ] },
    { name: "Pistol Shot", listen: "A pistol fired once. Which one is a GUNSHOT from a handgun: a sharp report with a gun around it, rather than a generic hit or click? Notice whether you can hear the GUN (its mechanism) as well as the bang, and where it was fired.",
      takes: [
        { id: "shooter-outdoors", why: "MODEL, at the shooter, outdoors: the striker click a few ms before, the muzzle blast (~0.3 ms positive phase, stretched 1.5x) with its gas jet, the slide cycling into battery 26 ms later (a metal clack), the ground reflection 5 ms behind the direct, a faint far echo.",
          cfg: { size: 0.03, distance: 1, env: 0, pulse: 1.5, shape: 1.5, roar: 0.6, rumble: 0, action: 0.5, actionType: 1, width: 0.6, dur: 0.6 }, seed: 401 },
        { id: "indoor-range", why: "MODEL, the same pistol fired indoors (a 9 x 7 m room): dense early reflections make the report a BOOM, a ~1 s room tail; the slide, and the brass casing bouncing on a hard floor ~0.45 s later.",
          cfg: { size: 0.03, distance: 1, env: 2, pulse: 2, shape: 1.5, roar: 0.6, rumble: 0, action: 0.5, actionType: 1, casing: 0.7, width: 0.6, dur: 1.1 }, seed: 409 },
        { id: "street-20m", why: "MODEL, the pistol fired 20 m down a street: no mechanism (too far), a slightly duller report, and the facades' flutter echo, the sound of a shot in a town.",
          cfg: { size: 0.03, distance: 20, env: 1, pulse: 2.5, shape: 1.3, roar: 0.5, rumble: 0, width: 0.7, dur: 0.9 }, seed: 419 },
      ] },
    { name: "Sniper Rifle", listen: "A single high-powered rifle shot (a sniper). Which one is a powerful RIFLE: a crack with weight, carrying across a distance? Notice the order of events and whether it tells you WHERE you are relative to the shot.",
      takes: [
        { id: "shooter-open-bolt", why: "MODEL, at the shooter, in the open: the bullet's supersonic crack (N-wave ~0.2 ms, Mach 2.5) on top of the muzzle blast, a little sub, a far echo; then the bolt worked by hand (lift, draw back, push, lock) and the casing landing on the ground.",
          cfg: { size: 0.2, distance: 1, env: 0, pulse: 2.5, shape: 1.3, roar: 0.6, rumble: 0.15, crack: 0.7, action: 0.5, actionType: 2, casing: 0.4, width: 0.7, dur: 1.6 }, seed: 503 },
        { id: "downrange-400m", why: "MODEL, DOWNRANGE, 400 m from the shooter, the round passing ~5 m away: the CRACK arrives first, sharp and bright, and the report follows ~0.7 s later (400 m x (1/343 - 1/850) s/m), dull from the air, with its terrain echoes behind it. What the target hears.",
          cfg: { size: 0.2, distance: 400, env: 0, pulse: 2.5, shape: 1.3, roar: 0.5, rumble: 0.25, crack: 1, downrange: 1, speed: 850, width: 0.7, room: 1.1, dur: 2.0 }, seed: 509 },
        { id: "canyon-shooter", why: "MODEL, at the shooter in a canyon: the crack and the report, then the rock walls throw it back in smeared echoes 0.4-1.2 s later. No mechanism.",
          cfg: { size: 0.2, distance: 1, env: 3, pulse: 2.5, shape: 1.3, roar: 0.6, rumble: 0.2, crack: 0.6, width: 0.8, dur: 2.4 }, seed: 521 },
      ] },
  ];

  const OUT = join(ROOT, "soundtests", "proto-blast");
  mkdirSync(OUT, { recursive: true });
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const f1 = (x, d = 1) => (x == null ? "n/a" : x.toFixed(d));
  const fmt = (m) => {
    const p = [m.sec.toFixed(2) + " s", m.lufs.toFixed(1) + " LUFS", "peak " + m.peak.toFixed(3), "NaN " + m.nan, "edge " + m.edgeStart.toFixed(4) + "/" + m.edgeEnd.toFixed(4),
      "<150 Hz " + (m.low * 100).toFixed(1) + "%", "centroid " + Math.round(m.centroid) + " Hz", "crest " + m.crestDb.toFixed(1) + " dB"];
    if (m.rise !== undefined) p.push("blast rise " + Math.round(m.rise) + " us");
    if (m.crackRise !== undefined) p.push("crack rise " + Math.round(m.crackRise) + " us");
    if (m.crackGapMeasured !== undefined) p.push("crack->report " + m.crackGapMeasured.toFixed(3) + " s", "crack peak over report " + m.crackOverReportDb.toFixed(1) + " dB");
    if (m.limiter) p.push("LIMITER " + m.limiter);
    return p.join(", ");
  };
  const fmtInfo = (i) => "W " + (i.W >= 1 ? i.W.toFixed(1) + " kg" : (i.W * 1000).toFixed(1) + " g") + ", T+ " + (i.Tplus * 1000).toFixed(2) + " ms, air corner " +
    (isFinite(i.absorbFc) ? Math.round(i.absorbFc) + " Hz" : "none") + ", env " + i.env + " RT60 " + i.rt60.toFixed(2) + " s" +
    (i.debrisEvents ? ", " + i.debrisEvents + " debris" : "") + (i.crackTN ? ", N-wave " + Math.round(i.crackTN * 1e6) + " us" : "") +
    (i.crackLead ? ", crack lead (model) " + i.crackLead.toFixed(3) + " s" : "");
  const readme = [], allLimits = [];

  // ---- physics checks
  const phys = [];
  phys.push("### Size -> pressure wave (dry, open field, 10 m, pulse 1, no other components)\n\n| size | W | T+ | <150 Hz | centroid |\n|---|---|---|---|---|");
  for (const s of [0.02, 0.2, 0.5, 0.7, 0.9, 1]) {
    const r = makeBlast(SR, { size: s, distance: 10, env: 0, room: 0, roar: 0, rumble: 0, dur: 0.5 }, 7);
    const sh = spectrumShares(r.L, r.R);
    phys.push("| " + s + " | " + (r.info.W >= 1 ? r.info.W.toFixed(1) + " kg" : (r.info.W * 1000).toFixed(2) + " g") + " | " + (r.info.Tplus * 1000).toFixed(2) + " ms | " + (sh.low * 100).toFixed(1) + "% | " + Math.round(sh.centroid) + " Hz |");
  }
  phys.push("\n### Distance -> the same blast (size 0.7, open field, pulse 1, no roar/rumble/room)\n\n| distance | air corner | T+ | rise (10-90%) | centroid |\n|---|---|---|---|---|");
  for (const d of [5, 50, 300, 1500]) {
    const r = makeBlast(SR, { size: 0.7, distance: d, env: 0, room: 0, roar: 0, rumble: 0, dur: 0.6 }, 7);
    const mono = Float64Array.from(r.L, (x, i) => (x + r.R[i]) / 2), sh = spectrumShares(r.L, r.R);
    phys.push("| " + d + " m | " + (isFinite(r.info.absorbFc) ? Math.round(r.info.absorbFc) + " Hz" : "none") + " | " + (r.info.Tplus * 1000).toFixed(2) + " ms | " + Math.round(riseOf(mono, r.info.blastAt, Math.floor(0.05 * SR))) + " us | " + Math.round(sh.centroid) + " Hz |");
  }
  phys.push("\n### Environment -> echoes (the model with a unit-impulse source: intended tap vs the envelope peak found in the output)\n\n| environment | distance | strongest echoes, intended -> measured (dB over the floor before it) | RT60 (Schroeder T20) | direct/reverb |\n|---|---|---|---|---|");
  for (const [env, d] of [[0, 25], [0, 1500], [1, 40], [2, 4], [3, 80], [4, 600]]) {
    const pr = probe({ size: 0.5, distance: d, env, dur: 3.0 }, 99);
    phys.push("| " + BLAST_ENVS[env] + " | " + d + " m | " + (pr.taps.length ? pr.taps.map((t) => (t.want * 1000).toFixed(1) + "->" + (t.got * 1000).toFixed(1) + " ms (" + t.overFloorDb.toFixed(0) + ")").join(", ") : "none past 3 ms (diffuse by design)") + " | " + f1(pr.rt60, 2) + " s | " + pr.dr.toFixed(1) + " dB |");
  }
  console.log(phys.join("\n"));

  for (const S of SOUNDS) {
    const ctrlPatch = preset(S.name);
    if (!PRESETS[S.name]) throw new Error("no preset " + S.name);
    const takes = [{ id: "current", why: "the CURRENT preset \"" + S.name + "\", rendered by the exported engine (the control).", control: ctrlPatch }].concat(S.takes);
    // shuffle: a fixed-seed LCG, index from its HIGH bits (the low bits of an LCG mod 2^32 cycle with short periods)
    let seed = 0x5f3759df;
    for (const ch of S.name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = Math.floor((seed / 4294967296) * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, slug(S.name)), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + S.name);
    order.forEach((ti, slot) => {
      const t = takes[ti];
      const r = renderTake(t);
      const lim = matchWithLimiter(r.L, r.R);
      const m = measure(r.L, r.R, r.info); m.limiter = lim; allLimits.push({ s: S.name, id: t.id, lim });
      const file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: S.name + " " + file })));
      const pr = t.control ? null : probe(t.cfg, t.seed);
      key.push({ file, t, m, info: r.info, pr });
      console.log("  " + file + "  " + t.id.padEnd(22) + " " + fmt(m) + (r.info ? "\n" + " ".repeat(34) + fmtInfo(r.info) : ""));
      const bad = [];
      if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < -40) bad.push("silent");
      if (!t.control && m.edgeStart > 0.05) bad.push("start edge?"); if (!t.control && m.edgeEnd > 0.02) bad.push("end edge?");
      if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target");
      if (bad.length) console.log("    !! " + bad.join(", "));
      if (VERBOSE && r.info) console.log("    taps " + JSON.stringify(r.info.taps.slice(0, 6)) + " energies " + JSON.stringify(r.info.energies));
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + S.name + " (blast engine prototype)\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS (or capped below full scale), in a shuffled order. One of them is today's preset.\n\n" + S.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + S.name + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
      "Measured: " + fmt(k.m) + "\n\n" + (k.info ? "Model: " + fmtInfo(k.info) + "\n\n" : "") +
      (k.pr ? "The place, measured with a unit impulse through this take's own room: strongest echoes intended -> found " + (k.pr.taps.length ? k.pr.taps.map((q) => (q.want * 1000).toFixed(1) + " -> " + (q.got * 1000).toFixed(1) + " ms (+" + q.overFloorDb.toFixed(0) + " dB)").join(", ") : "(none past 3 ms)") +
        "; RT60 " + f1(k.pr.rt60, 2) + " s; direct/reverb " + k.pr.dr.toFixed(1) + " dB.\n\n" : "") +
      (k.t.control && (k.m.edgeStart > 0.05 || k.m.edgeEnd > 0.05) ? "Note: the control itself starts or ends abruptly (edge " + k.m.edgeStart.toFixed(3) + " / " + k.m.edgeEnd.toFixed(3) + " of its peak in the first / last 2 ms): that is in today's preset, not added here.\n\n" : "") +
      (!k.t.control && k.m.edgeStart > 0.05 ? "Note: the start edge is the blast's own onset (deliberate: a pressure wave has a near-instant rise), not a click.\n\n" : "") +
      (k.m.limiter ? "Note: this take's peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.m.limiter +
        (typeof k.m.limiter === "string" ? " (one pass at the slider's maximum, then a second pass: more than a preset's Limiter can do today)" : "") + " before matching (see README).\n\n" : "") +
      "```json\n" + JSON.stringify(k.t.control ? k.t.control : { cfg: k.t.cfg, seed: k.t.seed }) + "\n```\n").join("\n"));
    readme.push("- `" + slug(S.name) + "/`: " + S.name + " (" + takes.length + " takes)");
  }
  const limited = allLimits.filter((x) => x.lim);
  writeFileSync(join(OUT, "README.md"), "# Blast engine prototype: listening round\n\n" +
    "A prototype synthesis engine for explosions and gunshots (`tools/proto/blast.mjs`, `makeBlast`; regenerate with `node tools/proto/blast.mjs`). " +
    "It builds a blast from what one is: a PRESSURE WAVE (Friedlander: near-instant rise, decay, a long negative phase; its length set by the charge's " +
    "size through cube-root scaling), the fireball or muzzle gas, sub rumble, DEBRIS landing at flight times, a bullet's supersonic CRACK and the gun's " +
    "MECHANISM; then carries it to the listener: air absorption and pulse lengthening with distance, and the PLACE as an impulse response built from " +
    "geometry (ground reflection, street facades, a room's image sources, canyon walls, forest scattering). The question is not \"which settings\" but " +
    "**is a model of the blast and the place clearly better than today's presets**, sound by sound.\n\n" + readme.join("\n") + "\n\n" +
    "In each folder: `take-A.wav` ... `take-D.wav`, one of them the CURRENT preset (rendered by the exported engine, `synth-export/crunchysfx-synth.js`), " +
    "the others three INTERPRETATIONS from the model (different places, distances and weights, not settings nudges). All loudness-matched to " + TARGET_LUFS +
    " LUFS (peaks capped at 0.95) and shuffled with a fixed seed (high bits of an LCG). Read `LISTEN.md` first, listen, then read `KEY.md`.\n\n" +
    "**The room (a deliberate departure from the earlier prototypes):** weather and motor gave every model take the control preset's own Freeverb. " +
    "Here the model's ENVIRONMENT is its room: the echoes, their delays and their balance against the direct sound are the model's output (they move " +
    "with distance and place), so adding the control's Freeverb on top would put a second room around the first. Model takes therefore get NO Freeverb " +
    "and no delay; the controls keep their own reverb and delay (Grenade Blast, Distant Boom and Sniper Rifle have one; Explosion and Pistol Shot are " +
    "nearly dry). This means the round is partly \"place vs no place\" for Explosion and Pistol Shot: the open-field takes are the closest to dry " +
    "(ground reflection and a faint far echo) and are the fair comparison there.\n\n" +
    "**The limiter:** blasts are peaky. A take whose peaks kept it more than 0.5 dB under the target after the 0.95 peak cap was run through the app's own " +
    "Limiter (dsp.js `limiterProcess`, the Limiter control any preset can set) at the smallest amount, in steps of 0.1, that brings it within 0.5 dB. " +
    (limited.length ? "This round: " + limited.map((x) => x.s + " / " + x.id + " (" + x.lim + ")").join(", ") + "." : "No take needed it.") +
    " A value written `1+x` means one pass at the slider's maximum was NOT enough and a second pass at x followed: gunshots keep nearly all their " +
    "energy in ~10 ms, so their crest against a 400 ms loudness block is 20-27 dB (true of real recordings too), more than one Limiter can take " +
    "out. That double pass is mastering a preset alone cannot do today; an engine that shipped would want its own report-body control or a " +
    "stronger limiter range." +
    " KEY.md says per take.\n\n" +
    "**Onsets:** a blast's first sample of pressure is a near-instant rise ON PURPOSE (10-1000 microseconds, measured per take in KEY.md); the gun takes " +
    "open on the mechanism's click 35 ms earlier. Every model take fades out over its last 60 ms.\n\n" +
    "**Lengths:** the model takes run longer than the controls (0.6-3.0 s against 0.35-1.9 s) because the place's echoes and the debris need the time. " +
    "That is a cue in a blind round: judge the first half second as well as the whole.\n\n" +
    "**Playback:** Distant Boom's model takes sit mostly below 200 Hz, as a far blast does; laptop speakers will undersell them.\n\n" +
    "## Physics checks (printed by the CLI)\n\n" + phys.join("\n") + "\n\n" +
    "**What to report per sound:** the letter you prefer, and whether it is clearly better, a little better, or no better than the others.\n");
  console.log("\n-> " + OUT);
}
