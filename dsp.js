// CrunchySFX — DSP engines & helpers (pure functions + shared constants), extracted from
// index.html for organization. Loaded via <script src="dsp.js"> BEFORE the main <script>
// (classic scripts share one global scope, like presets.js). No app state / DOM here.
"use strict";

// Vowel formant frequencies [F1, F2, F3] (Hz, neutral voice) for the "formant" waveform.
// formantVowel morphs across these A→E→I→O→U; formantSize scales them (tract length).
const VOWELS = [[700, 1220, 2600], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];

const FORMANT_GAIN = [1.0, 0.6, 0.35];   // relative loudness of F1/F2/F3
// 4-operator FM routing (wave "FM 4op"). Ops 0..3; mods[i] = op-indices that modulate op i;
// carriers[] = ops summed to the output. All routings only let a HIGHER op modulate a LOWER one,
// so evaluating in order 3→2→1→0 resolves every dependency in one pass. Op3 also self-feeds-back.
const FM_ALGOS = [
  { mods: [[1], [2], [3], []], carriers: [0] },        // 0 Chain      3→2→1→0
  { mods: [[1], [2, 3], [], []], carriers: [0] },       // 1 Y-Mod      (2,3)→1→0
  { mods: [[1], [], [3], []], carriers: [0, 2] },        // 2 Twin       (1→0)+(3→2)
  { mods: [[1, 2, 3], [], [], []], carriers: [0] },       // 3 3→Carrier  (1,2,3)→0
  { mods: [[1, 2], [], [3], []], carriers: [0] },         // 4 Y+Carrier  1→0, 3→2→0
  { mods: [[], [], [], []], carriers: [0, 1, 2, 3] },      // 5 Additive   sines summed (organ/bell)
];

const SR = 44100;

// ---------- Custom drawn waveform ----------
// The user draws one cycle at CUSTOM_N points (−1..1). At render time we band-limit it to the
// note being played (FFT the drawing, drop harmonics that would alias, resynthesize a smooth
// table) — matching the "keep oscillators band-limited" rule. Stored in the patch as base64 int8.
const CUSTOM_N = 256;          // drawn resolution (stored)

const CUSTOM_TABLE_N = 2048;   // playback table resolution (read by waveform())

// The default drawn cycle (a plain sine) used whenever a patch has no custom wave stored.
const CUSTOM_DEFAULT_DRAWN = new Float32Array(CUSTOM_N);
for (let i = 0; i < CUSTOM_N; i++) CUSTOM_DEFAULT_DRAWN[i] = Math.sin(2 * Math.PI * i / CUSTOM_N);

function customWaveToB64(buf) {
  const b = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) b[i] = (Math.round(Math.max(-1, Math.min(1, buf[i])) * 127)) & 0xff;
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function b64ToCustomWave(str) {
  try {
    const bin = atob(str), buf = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) { let v = bin.charCodeAt(i); if (v > 127) v -= 256; buf[i] = v / 127; }
    return buf.length ? buf : null;
  } catch (e) { return null; }
}

// FFT the drawn cycle, keep harmonics 1..maxH (drop DC + everything above → no aliasing), then
// inverse-FFT and resample to a smooth CUSTOM_TABLE_N cycle, normalized to ±1.
function buildCustomTable(drawn, maxH) {
  const D = drawn.length, re = new Float64Array(D), im = new Float64Array(D);
  for (let i = 0; i < D; i++) re[i] = drawn[i];
  fftInPlace(re, im, -1);
  const keep = Math.max(1, Math.min((D >> 1) - 1, maxH | 0));
  re[0] = im[0] = 0;                                        // drop DC (center the wave)
  for (let k = keep + 1; k < D - keep; k++) { re[k] = 0; im[k] = 0; }   // kill harmonics above `keep`
  fftInPlace(re, im, 1);                                    // back to time domain (scaled by D)
  const N = CUSTOM_TABLE_N, out = new Float32Array(N);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const x = i / N * D, i0 = Math.floor(x) % D, i1 = (i0 + 1) % D, fr = x - Math.floor(x);
    const v = (re[i0] * (1 - fr) + re[i1] * fr) / D;
    out[i] = v; const a = Math.abs(v); if (a > peak) peak = a;
  }
  if (peak > 1e-6) for (let i = 0; i < N; i++) out[i] /= peak;
  return out;
}

// ---------- DSP helpers ----------
// PolyBLEP: a small correction added at each discontinuity to band-limit the
// waveform, removing the harsh aliasing that makes naive saw/square sound "8-bit".
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// waveform: phase in [0,1), dt = freq/SR (needed for band-limiting).
// duty is the pulse-wave width (0.05..0.95); ignored by the other shapes.
// ct = custom wavetable (case 12). ctB + mb = Wave-Morph: a second table and the A→B blend
// factor 0..1 at this sample (mb 0 / ctB null → pure A, so old callers are unaffected).
function waveform(type, phase, dt, duty, ct, ctB, mb) {
  switch (type) {
    case 0: return Math.sin(2 * Math.PI * phase);            // sine (inherently band-limited)
    case 1: {                                                // square (band-limited)
      let v = phase < 0.5 ? 1 : -1;
      v += polyBlep(phase, dt);
      v -= polyBlep((phase + 0.5) % 1, dt);
      return v;
    }
    case 2: {                                                // saw (band-limited)
      return (2 * phase - 1) - polyBlep(phase, dt);
    }
    case 3: return 4 * Math.abs(phase - 0.5) - 1;            // triangle (negligible aliasing)
    case 4: {                                                // pulse — variable duty (PWM), band-limited, DC-centered
      const D = duty;
      let v = phase < D ? 1 : -1;
      v += polyBlep(phase, dt);
      v -= polyBlep((phase + (1 - D)) % 1, dt);
      return v - (2 * D - 1);                                // remove the pulse's DC offset
    }
    case 5: {                                                // FM — metallic / electric-piano character
      const ratio = 2;                                       // integer keeps it periodic (no wrap click)
      const index = 2.2 * Math.max(0.15, 1 - dt * 1.8);      // taper modulation up high to limit aliasing
      return Math.sin(2 * Math.PI * phase + index * Math.sin(2 * Math.PI * ratio * phase));
    }
    case 6: {                                                // organ — additive harmonics, truly band-limited
      const amps = [1, 0.6, 0.35, 0.5, 0.12, 0.3, 0.1, 0.22];
      let v = 0, norm = 0;
      for (let k = 0; k < amps.length; k++) {
        const h = k + 1;
        if (h * dt >= 0.5) break;                            // stop before Nyquist -> no aliasing
        v += amps[k] * Math.sin(2 * Math.PI * h * phase);
        norm += amps[k];
      }
      return norm > 0 ? v / norm : 0;
    }
    case 7: {                                                // half-sine — rectified, hollow/reedy
      const s = Math.max(0, Math.sin(2 * Math.PI * phase));
      return (s - 0.3183) * 1.4;                             // subtract mean (1/pi) to remove DC
    }
    case 12: {                                               // custom drawn wave (band-limited table)
      const T = ct; if (!T) return 0;
      const N = T.length, x = phase * N, i0 = Math.floor(x) % N, i1 = (i0 + 1) % N, fr = x - Math.floor(x);
      const a = T[i0] * (1 - fr) + T[i1] * fr;
      if (!ctB || !mb) return a;                             // no Wave-Morph → pure A
      const b = ctB[i0] * (1 - fr) + ctB[i1] * fr;           // (A and B tables share length)
      return a + (b - a) * mb;                               // blend A→B by mb
    }
    default: return 0;
  }
}

// ---------- Convolution reverb (synthesized IRs) ----------
const CONV_MAKEUP = 3.0;   // wet gain: unit-energy IR spreads energy over time, so boost to taste
// Offline rendering has no latency deadline, but direct convolution of a ~2 s signal with a
// ~2 s IR is ~10^10 ops — too slow. So we convolve via FFT (overlap NOT needed: one shot).
// In-place iterative radix-2 FFT; re/im length must be a power of two. sign=-1 fwd, +1 inverse.
function fftInPlace(re, im, sign) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {          // bit-reversal permutation
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = sign * 2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + half], bi = im[i + k + half];
        const tr = cr * br - ci * bi, ti = cr * bi + ci * br;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + half] = ar - tr; im[i + k + half] = ai - ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// Linear convolution of x with ir; returns first x.length samples (tail truncated at the
// render length, matching how the delay/Freeverb stages already cut off at n).
function convolveFFT(x, ir) {
  let N = 1; while (N < x.length + ir.length - 1) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x); hr.set(ir);
  fftInPlace(xr, xi, -1); fftInPlace(hr, hi, -1);
  for (let i = 0; i < N; i++) {                 // complex pointwise multiply
    const rr = xr[i] * hr[i] - xi[i] * hi[i], ii = xr[i] * hi[i] + xi[i] * hr[i];
    xr[i] = rr; xi[i] = ii;
  }
  fftInPlace(xr, xi, 1);
  const out = new Float32Array(x.length), inv = 1 / N;
  for (let i = 0; i < x.length; i++) out[i] = xr[i] * inv;
  return out;
}

// Procedural impulse response — no files, so it works over file:// and stays deterministic
// (own seeded LCG, independent of render's rnd). type 0 Room / 1 Hall / 2 Plate / 3 Spring;
// size seconds; tone 0..1 dark→bright. Normalized to unit energy so wet level is stable
// across size/type. Two decorrelated seeds (L/R) give the reverb stereo width.
function makeIR(type, size, tone, seed) {
  size = Math.min(3, Math.max(0.05, size));
  const len = Math.max(4, Math.floor(size * SR));
  const ir = new Float32Array(len);
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
  const decayRate = 6.9 / (size * (type === 0 ? 0.5 : type === 3 ? 0.6 : 1));   // room/spring shorter
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let env = Math.exp(-t * decayRate);
    if (type === 1) env *= Math.min(1, t / 0.02);        // hall: 20 ms build-up
    ir[i] = rnd() * env;
  }
  if (type === 0) {                                       // room: discrete early reflections
    for (const [dt, g] of [[0.007, 0.5], [0.011, 0.4], [0.017, 0.32], [0.023, 0.25], [0.031, 0.2]]) {
      const idx = Math.floor(dt * SR); if (idx < len) ir[idx] += g;
    }
  }
  if (type === 3) {                                       // spring: dispersive metallic resonance
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      ir[i] += 0.5 * Math.exp(-t * decayRate * 1.2) * Math.sin(2 * Math.PI * (2200 + 400 * Math.sin(t * 30)) * t);
    }
  }
  const cutoff = 200 + tone * 12000;                      // tone: blend a one-pole LP toward raw
  const a = Math.exp(-2 * Math.PI * cutoff / SR);
  let lp = 0;
  for (let i = 0; i < len; i++) { lp = a * lp + (1 - a) * ir[i]; ir[i] = lp + (ir[i] - lp) * tone; }
  let e = 0; for (let i = 0; i < len; i++) e += ir[i] * ir[i];
  const norm = e > 0 ? 1 / Math.sqrt(e) : 1;
  for (let i = 0; i < len; i++) ir[i] *= norm;
  return ir;
}

// Prepare a user-loaded impulse response for the convolution engine's "Custom IR" space: trim to
// maxSec (with a short declick fade only if we actually cut the tail), then normalize to unit
// AVERAGE-channel energy with ONE factor for both channels — so a stereo IR keeps its natural L/R
// balance/width while a mono IR matches makeIR's per-channel loudness (wet level stays comparable to
// the built-in synthesized spaces, so convMix behaves the same across all of them). Returns {L,R} at SR.
function prepareIR(inL, inR, maxSec) {
  const maxLen = Math.max(4, Math.floor((maxSec || 4) * SR));
  const trimmed = inL.length > maxLen;
  const len = Math.min(inL.length, maxLen);
  const L = new Float32Array(len), R = new Float32Array(len);
  let e = 0;
  for (let i = 0; i < len; i++) { L[i] = inL[i] || 0; R[i] = inR[i] || 0; e += L[i] * L[i] + R[i] * R[i]; }
  e /= 2;                                                          // average per-channel energy
  const norm = e > 0 ? 1 / Math.sqrt(e) : 1;
  const fade = trimmed ? Math.min(len, Math.floor(0.02 * SR)) : 0; // 20 ms fade only when we cut the tail
  for (let i = 0; i < len; i++) {
    let g = norm;
    if (fade && i >= len - fade) g *= (len - i) / fade;
    L[i] *= g; R[i] *= g;
  }
  return { L, R };
}

// Apply the convolution "tone" control to a loaded IR — the SAME dark→bright one-pole-LP blend makeIR
// uses on the synthesized spaces: tone=1 = verbatim/brightest, tone→0 = progressively lowpassed/darker.
// Both channels are filtered then renormalized to unit AVERAGE-channel energy by ONE factor, so tone
// changes timbre (not level) and keeps stereo balance — matching the built-in spaces. Fresh {L,R};
// cheap enough to call per render (offline). Callers skip this when tone≈1 (verbatim → use the IR as-is).
function toneIR(inL, inR, tone) {
  const len = inL.length;
  const L = new Float32Array(len), R = new Float32Array(len);
  const cutoff = 200 + tone * 12000;
  const a = Math.exp(-2 * Math.PI * cutoff / SR);
  let lpL = 0, lpR = 0, e = 0;
  for (let i = 0; i < len; i++) {
    lpL = a * lpL + (1 - a) * inL[i]; const vL = lpL + (inL[i] - lpL) * tone;
    lpR = a * lpR + (1 - a) * inR[i]; const vR = lpR + (inR[i] - lpR) * tone;
    L[i] = vL; R[i] = vR; e += vL * vL + vR * vR;
  }
  e /= 2;
  const norm = e > 0 ? 1 / Math.sqrt(e) : 1;
  for (let i = 0; i < len; i++) { L[i] *= norm; R[i] *= norm; }
  return { L, R };
}

// ---------- Granular synthesis ----------
// A cloud of short Hann-windowed grains overlap-added from a source buffer. Grains need random
// access, so we build the whole stereo output up front (before render's per-sample chain), then
// the osc block just reads it. Deterministic via a seeded LCG (independent of render's rnd).
// scan = source read speed (0 freeze .. 1 natural .. 2 fast), DECOUPLED from pitch (rate=freq/440)
// so you can time-stretch without repitching. spray jitters grain start; spread randomizes each
// grain's pitch (±octave·spread) and pan → shimmer/width. Source read position wraps (freeze/loop).
function makeGranular(source, n, freq, sizeMs, density, spray, scan, spread, seed) {
  const outL = new Float32Array(n), outR = new Float32Array(n);
  if (!source || source.length < 2) return { L: outL, R: outR };
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };   // 0..1
  const srcLen = source.length;
  const grainLen = Math.max(4, Math.floor(sizeMs / 1000 * SR));
  const spawnEvery = Math.max(1, Math.floor(SR / Math.max(0.1, density)));
  const baseRate = Math.max(0.001, freq / 440);
  for (let onset = 0; onset < n; onset += spawnEvery) {
    let srcStart = onset * scan + (spray > 0 ? (rnd() * 2 - 1) * spray * srcLen : 0);
    const rate = baseRate * (spread > 0 ? Math.pow(2, (rnd() * 2 - 1) * spread) : 1);
    const pan = spread > 0 ? (rnd() * 2 - 1) * spread : 0;
    const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    for (let g = 0; g < grainLen; g++) {
      const o = onset + g; if (o >= n) break;
      let rp = (srcStart + g * rate) % srcLen; if (rp < 0) rp += srcLen;   // wrap = freeze/loop
      const ip = Math.floor(rp), fr = rp - ip, i1 = ip + 1 >= srcLen ? 0 : ip + 1;
      const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * g / grainLen);        // Hann window
      const y = (source[ip] * (1 - fr) + source[i1] * fr) * win;
      outL[o] += y * pl; outR[o] += y * pr;
    }
  }
  const gnorm = 1 / Math.max(1, Math.sqrt(grainLen / spawnEvery));   // keep level ~constant vs overlap
  for (let i = 0; i < n; i++) { outL[i] *= gnorm; outR[i] *= gnorm; }
  return { L: outL, R: outR };
}

// Fallback source when no WAV is imported. Deliberately EVOLVING (a pitch glide + harmonics that
// fade in across the buffer) so `grainScan` is expressive standalone — a stationary tone would
// sound identical whether you scan it or freeze it. Grains read it at rate freq/440 for pitch.
function granSynthSource() {
  const len = Math.floor(0.5 * SR), src = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;                          // 0..1 across the buffer
    ph += 2 * Math.PI * (330 * Math.pow(2, u)) / SR;   // glide up an octave 330→660
    src[i] = (Math.sin(ph) + (0.4 + 0.4 * u) * Math.sin(2 * ph) + (0.2 * u) * Math.sin(3 * ph)) / 1.8;
  }
  return src;
}

// ---------- Bubble / water synthesis ----------
// The Minnaert bubble model: a single bubble is a short decaying sine whose pitch RISES over its
// brief life (the "bloop"). A stream/boil is many of them scattered in time. Built into a stereo
// buffer before render's loop (bubbles overlap / need random access), then read per-sample.
// Deterministic (own seeded LCG). Bigger bubbles (lower f0) ring a little longer. Always fires one
// bubble at t=0 so a low rate still gives a reliable single drop.
function makeBubbles(n, freq, rate, rise, spread, decay, seed) {
  const outL = new Float32Array(n), outR = new Float32Array(n);
  if (n < 4) return { L: outL, R: outR };
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const baseTau = 0.03 + decay * 0.22;                           // 30..250 ms ring
  const spawnEvery = Math.max(1, Math.floor(SR / Math.max(0.5, rate)));
  for (let onset = 0; onset < n; onset += spawnEvery) {
    let start = onset + (spread > 0 ? Math.floor((rnd() * 2 - 1) * spread * spawnEvery * 0.8) : 0);
    if (start < 0) start = 0;
    if (start >= n) continue;
    const f0 = freq * Math.pow(2, (rnd() * 2 - 1) * spread * 1.5);          // bubble size → pitch
    const tau = baseTau * Math.min(3, Math.max(0.3, Math.sqrt(freq / Math.max(1, f0))));
    const life = Math.min(n - start, Math.floor(tau * 5 * SR));             // ~5 time constants
    if (life < 4) continue;
    const pan = spread > 0 ? (rnd() * 2 - 1) * spread : 0;
    const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    let ph = 0;
    for (let g = 0; g < life; g++) {
      ph += 2 * Math.PI * (f0 * (1 + rise * 0.7 * (g / life))) / SR;        // rising-pitch chirp
      const y = Math.sin(ph) * Math.exp(-g / SR / tau);
      outL[start + g] += y * pl; outR[start + g] += y * pr;
    }
  }
  const gnorm = 1 / Math.max(1, Math.sqrt(baseTau * 5 * SR / spawnEvery));  // level ~constant vs overlap
  for (let i = 0; i < n; i++) { outL[i] *= gnorm; outR[i] *= gnorm; }
  return { L: outL, R: outR };
}

// ---------- Particle / crackle synthesis ----------
// Granular's event-based cousin: scatter short resonant NOISE bursts → fire, rain, sparks, geiger,
// footsteps, sizzle, applause. Each event = a bandpass (colored by `tone`) excited by a decaying
// noise burst. `spread` skews amplitudes (occasional loud pops among quiet hiss) + jitters pitch /
// timing / pan. Built into a stereo buffer before render's loop, read per-sample. Deterministic.
function makeParticles(n, tone, rate, decay, spread, seed) {
  const outL = new Float32Array(n), outR = new Float32Array(n);
  if (n < 4) return { L: outL, R: outR };
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const spawnEvery = Math.max(1, Math.floor(SR / Math.max(1, rate)));
  const baseTau = 0.002 + decay * 0.05;                                     // 2..52 ms event ring
  const baseFc = 200 * Math.pow(40, Math.max(0, Math.min(1, tone)));        // 200..8000 Hz color
  const Q = 1.5;
  for (let onset = 0; onset < n; onset += spawnEvery) {
    let start = onset + (spread > 0 ? Math.floor((rnd() * 2 - 1) * spread * spawnEvery) : 0);
    if (start < 0) start = 0;
    if (start >= n) continue;
    const amp = Math.pow(rnd(), 1 + spread * 4);                            // skew → occasional loud pops
    const fc = Math.max(80, Math.min(0.45 * SR, baseFc * Math.pow(2, (rnd() * 2 - 1) * spread * 2)));
    const tau = baseTau * (1 + (rnd() * 2 - 1) * spread * 0.5);
    const life = Math.min(n - start, Math.floor(tau * 6 * SR));
    if (life < 3) continue;
    const w0 = 2 * Math.PI * fc / SR, alpha = Math.sin(w0) / (2 * Q), a0 = 1 + alpha;
    const b0 = alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;   // RBJ bandpass
    const pan = spread > 0 ? (rnd() * 2 - 1) * spread : 0;
    const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let g = 0; g < life; g++) {
      const drive = (rnd() * 2 - 1) * Math.exp(-g / SR / tau);              // decaying noise burst
      const o = b0 * (drive - x2) - a1 * y1 - a2 * y2;                      // bandpass: b1=0, b2=−b0
      x2 = x1; x1 = drive; y2 = y1; y1 = o;                                // shift filter states
      const val = o * amp;
      outL[start + g] += val * pl; outR[start + g] += val * pr;
    }
  }
  const gnorm = 2.2 / Math.max(1, Math.sqrt(baseTau * 6 * SR / spawnEvery));   // makeup + overlap-norm
  for (let i = 0; i < n; i++) { outL[i] *= gnorm; outR[i] *= gnorm; }
  return { L: outL, R: outR };
}

// ---------- Impact / blast (gunshots, explosions, punches, slams) ----------
// A parametric percussive transient. Real impacts = a near-instantaneous broadband CRACK
// (the shockwave — energy in the first ~1 ms, sharper than a filtered-noise envelope can
// make) over a decaying BODY, optionally driven nonlinear (loud/violent). Builds ONE
// transient front-loaded at index 0 into a mono buffer; render() reads it at `lt` (time since
// the current burst shot) so it RETRIGGERS per shot → full-auto for free. Caliber/chest-thump
// come from the shared boom layer, the environment (crack-BOOM-echo) from convolution reverb /
// delay — so this engine only owns the crack+body and stays lean. Ignores freq/unison.
// Deterministic (own seeded LCG). tone: dark cannon(0)→bright rifle crack(1). decay:
// snap(0)→long blast(1). punch: transient sharpness/click. grit: nonlinear shockwave (violence).
function makeImpact(n, tone, decay, punch, grit, seed) {
  const out = new Float32Array(n);
  if (n < 2) return out;
  let s = (seed >>> 0) || 0x1a2b3c4d;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };  // -1..1
  const tauBody = 0.006 + decay * 0.35;                              // 6..356 ms body decay
  const tauCrack = 0.0006 + (1 - punch) * 0.003;                     // 0.6..3.6 ms crack (sharper w/ punch)
  const fc = Math.min(0.45 * SR, 180 * Math.pow(70, tone));          // ~180 Hz(dark)..~12.6 kHz(bright) LP
  const lpA = Math.exp(-2 * Math.PI * fc / SR);
  const clickLen = Math.max(1, Math.round(SR * (0.0004 + (1 - punch) * 0.0016)));   // 0.4..2 ms initial click
  const bodyHi = 0.1 + 0.9 * tone;                                  // bright noise mixed into the body
  const crackAmt = (0.5 + punch * 1.6) * (0.2 + 0.8 * tone);         // ultra-fast crack, scales with tone
  const clickAmt = (0.6 + punch) * (0.3 + 0.7 * tone);              // initial snap, scales with tone
  let lp = 0;                                                        // → tone 0 = deep thud (cannon), 1 = crack (rifle)
  for (let i = 0; i < n; i++) {
    const t = i / SR, nz = rnd();
    lp = lpA * lp + (1 - lpA) * nz;                                  // lowpassed (body / dark)
    const hi = nz - lp;                                              // highpassed (crack / bright)
    let x = (lp * (1 - 0.4 * tone) + hi * bodyHi) * Math.exp(-t / tauBody)         // decaying body
          + hi * Math.exp(-t / tauCrack) * crackAmt;                 // bright crack
    if (i < clickLen) x += rnd() * (1 - i / clickLen) * clickAmt;    // sample-sharp snap
    out[i] = x;
  }
  if (grit > 0) {                                                    // nonlinear shockwave (violence)
    const k = 1 + grit * 9, norm = Math.tanh(k);
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * k) / norm;
  }
  let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 1e-6) { const g = 0.92 / pk; for (let i = 0; i < n; i++) out[i] *= g; }
  return out;
}

// ---------- Whoosh / air (sword swings, whips, arrows, thrown things, cloth) ----------
// The "pass-by" gesture: turbulent noise through a bandpass whose CENTER FREQUENCY and AMPLITUDE
// both swell up and fall together (that coupling is what makes a swing read as a swing — hard to
// fake with a plain envelope + filter sweep). Builds ONE gesture over `n` samples; render() reads
// it at `lt` so it retriggers per burst shot (combos), with `n` set to one shot's slot. Deterministic
// (own seeded LCG). tone: dull air(0)→sharp swish(1). sweep: how far the pitch rises (the movement).
// body: airy/broad(0)→whistly/resonant(1) (cloth vs whip). peak: early flick(0)→late heavy swing(1).
function makeWhoosh(n, tone, sweep, body, peak, seed) {
  const out = new Float32Array(n);
  if (n < 2) return out;
  let s = (seed >>> 0) || 0x51ce5ab1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const fcBase = 300 * Math.pow(13, tone);          // ~300 Hz (dull) .. ~3.9 kHz (sharp) band center
  const sweepOct = 0.5 + sweep * 2.5;               // octaves the band rises at mid-swing
  const Q = 0.7 + body * 6;                          // broad/airy .. narrow/whistly
  const pk = 0.15 + peak * 0.6;                      // where amplitude + pitch peak (early flick .. late swing)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;                // bandpass state (continuous across the fc sweep)
  for (let i = 0; i < n; i++) {
    const u = i / n;                                                        // 0..1 across the swing
    const amp = u < pk ? Math.pow(u / pk, 1.5) : Math.pow((1 - u) / (1 - pk), 1.8);   // swell up then fade
    const fShape = u < pk ? u / pk : 1 - (u - pk) / (1 - pk);               // 0→1 at pk →0 (pitch rise/fall)
    const fc = Math.min(0.45 * SR, fcBase * Math.pow(2, sweepOct * fShape));
    const w0 = 2 * Math.PI * fc / SR, alpha = Math.sin(w0) / (2 * Q), a0 = 1 + alpha;
    const b0 = alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;  // RBJ bandpass (b1=0, b2=−b0)
    const nz = rnd();
    const o = b0 * (nz - x2) - a1 * y1 - a2 * y2;
    x2 = x1; x1 = nz; y2 = y1; y1 = o;
    out[i] = o * amp;
  }
  let pkv = 0; for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pkv) pkv = a; }
  if (pkv > 1e-6) { const g = 0.85 / pkv; for (let i = 0; i < n; i++) out[i] *= g; }
  return out;
}

// ---------- Blown brass (wave "brass", #21): a lip-reed waveguide ----------
// A brass note's identity is ONE coupling — brightness follows loudness, because the lips buzz harder
// as the breath rises — and no other engine here has it: they set level and colour with separate
// envelopes, so a horn had the coupling drawn on, and CrunchyBGM's maintainer refused every drawing
// (BGM §694, §788). Here it falls out of the physics, after Cook's published lip-reed model:
//
//   breath -> mouth pressure --+-> dp -> LIP (a band-pass resonance at f0) -> opening = gap + motion,
//   bore pressure <------------+                                               clipped shut/fully open
//        ^                      out = open·mouth + (1-open)·bore   (scattering at the lips)
//        +-- loss (one-pole LP) <-- BORE (a delay line) <-- DC block
//                                        +--> BELL (a fixed-frequency high-pass) --> the note
//
// What comes out for free: the note starts dark and BLOOMS as the lips start to slap, harder breath
// is brighter, and the bell is a FIXED filter, so brightness counted in harmonics falls as the note
// climbs. Prototyped and picked by ear in CrunchyBGM (tools/_brass.mjs, §789-§791) on its Trombone,
// Trumpet and Tuba before it came here; the constants below are those picks.
//
// THREE THINGS MAKE IT A WORKING INSTRUMENT RATHER THAN A MODEL, each found by it failing:
//   - the lip is BAND-PASS (zeros at DC): with DC gain, steady breath pins the lips open and nothing
//     buzzes; the opening is a rest gap PLUS the motion, because squaring a zero-mean motion (the
//     cook-book mapping) sounds an octave up;
//   - the TUBE LENGTH IS CALIBRATED per pitch and breath (brassTune): uncalibrated, the lips and the
//     tube disagree and most notes do not speak at all. The search is held on one BRANCH (0.8 of the
//     nominal two periods): the tube has another length that also sounds in tune (1.27), it is a
//     different mode and so a different timbre, and an unheld search lands on either;
//   - breath is stated ABOVE THE SPEAKING THRESHOLD (brassThreshold), which rises below ~147 Hz, so
//     every note speaks at every breath level and the breath carries only the timbre.
// The calibration also measures the steady level, so every note comes out at the same level and the
// amp envelope's job (the breath) is the player's, not a gain's.
// One constant per line: tools/export-synth.py's declaration scan reads only the first name of a `const A, B`.
const BRASS_LIP = 11;          // lip response at its resonance: just over the speaking threshold, so breath carries the timbre
const BRASS_LIPQ = 0.997;      // the lip's pole radius, the broadest it may be (sharper below ~147 Hz, see makeBrass)
const BRASS_REFL = 0.85;       // the bore's reflection
const BRASS_BRANCH = 0.8;      // the tube length the tuning holds to (of two periods): the mode that speaks best when soft
const BRASS_RMS = 0.25;        // the steady level every note is brought to
function brassThreshold(f) { return 0.7 * Math.pow(Math.max(1, 147 / Math.max(1, f)), 0.28); }
// knob 0..1 -> physical: lips = the rest gap, bell = 100..3000 Hz (log), tube = the in-loop loss
function brassCfg(st) {
  return { gap: 0.05 + 0.5 * st.brassLips, bellHz: 100 * Math.pow(30, st.brassBell), loss: 0.7 * st.brassTube };
}
// A playing voice. tick(pressure, f) -> one sample. `scale` stretches the tube (the calibration).
function makeBrass(sr, cfg, fLow, scale) {
  const size = Math.ceil((sr / Math.max(10, fLow)) * 2 * scale) + 8, line = new Float32Array(size);
  const hpA = 1 / (1 + 2 * Math.PI * cfg.bellHz / sr), lossK = cfg.loss, gap = cfg.gap;
  let w = 0, y1 = 0, y2 = 0, x1 = 0, x2 = 0, lp = 0, dcx = 0, dcy = 0, hx = 0, hy = 0;
  let lastF = -1, a1 = 0, a2 = 0, b0 = 0;
  return {
    tick(p, f) {
      if (f !== lastF) {                                // the lip follows the pitch (vibrato, sweeps)
        lastF = f;
        const r = Math.max(BRASS_LIPQ, 1 - 0.9 * f / sr), th = 2 * Math.PI * f / sr;   // never broader than 0.997; sharper below ~147 Hz
        a1 = -2 * r * Math.cos(th); a2 = r * r; b0 = (1 - r * r) / 2 * BRASS_LIP;
      }
      const D = Math.min(size - 4, Math.max(4, (sr / Math.max(10, f)) * 2 * scale));
      let rp = w - D; if (rp < 0) rp += size;         // D < size, so one wrap is enough
      const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 === size ? 0 : i0 + 1;
      const dOut = line[i0] * (1 - fr) + line[i1] * fr;
      lp = (1 - lossK) * dOut + lossK * lp;
      const bore = BRASS_REFL * lp, mouth = 0.3 * p, dp = mouth - bore;
      const y = b0 * (dp - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = dp; y2 = y1; y1 = y;
      let open = gap + y; if (open < 0) open = 0; else if (open > 1) open = 1;
      const sc = open * mouth + (1 - open) * bore;
      const dc = sc - dcx + 0.995 * dcy; dcx = sc; dcy = dc;
      line[w] = dc; w = w + 1 === size ? 0 : w + 1;
      const h = hpA * (hy + dOut - hx); hx = dOut; hy = h;  // the bell radiates the highs
      return h;
    },
  };
}
// Sounding pitch by autocorrelation (parabolic refinement), searched within ±span of f0. The window
// is at least three periods, so a low E (41 Hz) is measured as well as a trumpet's C6.
function brassPitch(x, sr, f0, at, span) {
  const lo = Math.max(2, Math.floor(sr / (f0 * (1 + span)))), hi = Math.ceil(sr * (1 + span) / f0);
  const N = Math.min(Math.max(2048, Math.ceil(3 * sr / f0)), x.length - at - hi - 2);
  const ac = (L) => { let s = 0, e = 0; for (let i = 0; i < N; i++) { s += x[at + i] * x[at + i + L]; e += x[at + i] * x[at + i]; } return s / (e || 1); };
  let best = -1, bl = lo;
  for (let L = lo; L <= hi; L++) { const v = ac(L); if (v > best) { best = v; bl = L; } }
  const a = ac(bl - 1), b = ac(bl), c = ac(bl + 1), den = a - 2 * b + c;
  const d = den ? (a - c) / (2 * den) : 0;
  return sr / (bl + Math.max(-1, Math.min(1, d)));
}
// The tube length and the makeup gain for one (pitch, breath, knobs), found by playing a held note
// and listening to it at ~0.57 s (past the onset scoop, where a note lips up into tune). The first
// pass searches ±30%; after it the pitch is close, so later passes search ±4% (about 7x cheaper).
// Cached for the session: a render of the same sound costs nothing the second time.
const BRASS_TUNE = new Map();
function brassTune(sr, f0, cfg, p) {
  const key = f0.toFixed(4) + "|" + p.toFixed(4) + "|" + cfg.gap + "|" + cfg.bellHz + "|" + cfg.loss;
  const hit = BRASS_TUNE.get(key); if (hit) return hit;
  const at = Math.round(sr * 0.57), win = Math.max(2048, Math.ceil(3 * sr / f0));
  const n = at + win + Math.ceil(sr * 1.3 / f0) + 8, atN = Math.round(sr * 0.05), x = new Float32Array(n);
  const lo = BRASS_BRANCH * 0.88, hi = BRASS_BRANCH * 1.12;
  // SECANT, not a ratio step: the loop's filters add a fixed delay, so pitch is not proportional to
  // the tube's length and `s *= f/f0` overshoots and walks in (1-8 passes, measured). The first step
  // is the ratio; after it, a line through the last two (length, cents) points lands in 2-3.
  let s = BRASS_BRANCH, rms = 0, sPrev = 0, cPrev = 0;
  for (let it = 0; it < 8; it++) {
    const v = makeBrass(sr, cfg, f0, s);
    for (let i = 0; i < n; i++) x[i] = v.tick(p * (i < atN ? 0.5 - 0.5 * Math.cos(Math.PI * i / atN) : 1), f0);
    let e = 0; for (let i = at; i < at + win; i++) e += x[i] * x[i];
    rms = Math.sqrt(e / win);
    if (!(rms > 1e-6)) break;                          // silent: keep the branch's nominal length
    const f = brassPitch(x, sr, f0, at, it ? 0.04 : 0.3);
    if (!(f > 0)) break;
    const cents = 1200 * Math.log2(f / f0);
    if (Math.abs(cents) < 2) break;                   // the meter itself is good to about a cent; chasing under it only costs passes
    const ratio = s * f / f0;                          // sharp -> lengthen, flat -> shorten
    const sec = it && cents !== cPrev ? s - cents * (s - sPrev) / (cents - cPrev) : ratio;
    sPrev = s; cPrev = cents;
    s = Math.max(lo, Math.min(hi, isFinite(sec) ? sec : ratio));
  }
  const out = { scale: s, gain: rms > 1e-6 ? BRASS_RMS / rms : 0 };
  if (BRASS_TUNE.size > 4096) BRASS_TUNE.clear();
  BRASS_TUNE.set(key, out);
  return out;
}

// ---------- Bowed string (wave "bowed", #22): a bowed waveguide ----------
// The other half of the family question CrunchyBGM asked of brass (BGM §792): a bowed note's identity is what the
// bow DOES — it grips and slips, so a note starts with a scratch while the string locks into its motion, and the
// pressure and speed of the bow set how dense that motion is. A saw through a filter draws all of it on. Here:
//
//   nut  -1 <── NECK delay ──┬── bow: dv = v_bow - v_string, new = dv · friction(dv) into both ──┬── BRIDGE delay ──> -loss LP
//                            (each delay is the ROUND TRIP on its side, so the two make one period)  └─> out -> TONE tilt
//
// After the standard published bowed waveguide (Smith's digital waveguide string as Cook builds it), written from the
// description. Prototyped and picked by ear in CrunchyBGM (tools/_bowed.mjs) on its Violin and on a whole string
// orchestra; the constants below are those picks. Things the prototype found, each by failing:
//   - each delay line is a ROUND TRIP: halved, the string sounds an octave up with only even harmonics, and a pitch
//     tracker cannot see it (a signal that repeats every half period repeats every period too);
//   - bow SPEED against PRESSURE decides the motion: too fast for the pressure and the bow double-slips (the
//     fundamental 16-18 dB under the 2nd harmonic). 0.1 at pressure 0.75 is a clean Helmholtz motion;
//   - the string emits a nearly flat pulse train at the bridge, so the heard tone needs a FIXED-frequency tilt (the
//     bridge and body), which is also what sizes the instrument: violin ~2500 Hz, cello ~300, contrabass ~200;
//   - the tuning search stays NARROW: a bowed string speaks within a few percent of its natural length, and a wide
//     search finds false peaks (a note tuned 386 cents sharp).
// The amp envelope is the BOW SPEED's shape (as the brass breath is), and each note is levelled by its measured RMS.
const BOWED_SPEED = 0.2;       // bow speed at knob 1 (0.5 = 0.1, the clean motion the picks used)
const BOWED_NOISE = 0.02;      // rosin: a little hashed noise on the bow speed, what keeps a held note alive
const BOWED_RMS = 0.25;        // the steady level every note is brought to
function bowedCfg(st) {
  return { speed: BOWED_SPEED * st.bowSpeed, pressure: st.bowPressure, pos: 0.05 + 0.2 * st.bowPos,
           tiltHz: 100 * Math.pow(50, st.bowTone), loss: 0.6 * st.bowString };
}
// TREMOLO AS BOW STROKES (BGM §803): the bow REVERSES `bowTrem` times a second. Each reversal takes the bow speed
// through zero, so the string slips free and is re-caught — a scratch per stroke, from the friction law, where an
// amplitude wobble only moves the level. A soft square (tanh of a sine, sharpness 3) is the stroke's shape;
// `bowTremPhase` is where in the stroke the note starts, which is what lets a SECTION's players be out of step with
// each other (CrunchyBGM sets it per player). Picked by ear on a bowed string section at 10 strokes a second.
const BOWED_TREM_SHARP = 3;
function bowStroke(t, hz, phase) {
  return Math.tanh(BOWED_TREM_SHARP * Math.sin(Math.PI * (hz * t + phase))) / Math.tanh(BOWED_TREM_SHARP);
}
function bowFriction(dv, slope) {   // stick-slip: near-total reflection while the bow grips, collapsing as it slips
  const r = Math.pow(Math.abs((dv + 0.001) * slope) + 0.75, -4);
  return r < 0.01 ? 0.01 : r > 0.98 ? 0.98 : r;
}
// A playing string. tick(bowSpeed, f) -> one sample. `scale` stretches the string (the calibration).
function makeBowed(sr, cfg, fLow, scale, seedIn) {
  const size = Math.ceil((sr / Math.max(10, fLow)) * scale * 1.05) + 8;
  const neck = new Float32Array(size), brid = new Float32Array(size);
  const slope = 5 - 4 * Math.max(0, Math.min(1, cfg.pressure)), pos = cfg.pos, loss = cfg.loss;
  const tK = cfg.tiltHz > 0 ? Math.exp(-2 * Math.PI * cfg.tiltHz / sr) : 0;
  let wn = 0, wb = 0, lp = 0, tz = 0, seed = (seedIn >>> 0) || 0x2545f491;
  const read = (buf, w, D) => { let rp = w - D; if (rp < 0) rp += size; const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 === size ? 0 : i0 + 1; return buf[i0] * (1 - fr) + buf[i1] * fr; };
  return {
    tick(speed, f) {
      const N = Math.min(size - 4, (sr / Math.max(10, f)) * scale);
      const Dn = Math.max(2, N * (1 - pos)), Db = Math.max(2, N * pos);
      const bOut = read(brid, wb, Db), nOut = read(neck, wn, Dn);
      lp = (1 - loss) * bOut + loss * lp;
      const bridgeRefl = -0.95 * lp, nutRefl = -nOut, vs = bridgeRefl + nutRefl;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const vb = speed * (1 + BOWED_NOISE * (seed / 4294967296 * 2 - 1));
      const dv = vb - vs, nv = dv * bowFriction(dv, slope);
      neck[wn] = bridgeRefl + nv; wn = wn + 1 === size ? 0 : wn + 1;
      brid[wb] = nutRefl + nv; wb = wb + 1 === size ? 0 : wb + 1;
      if (tK) { tz = (1 - tK) * bOut + tK * tz; return tz; }
      return bOut;
    },
  };
}
// The string length and the makeup gain for one (pitch, bow speed, knobs): a held note without vibrato, measured at
// ~0.5 s, past the bow's capture. Narrow search (±6%, then ±3%), held within ±10%, secant steps. Cached per session.
const BOWED_TUNE = new Map();
function bowedTune(sr, f0, cfg) {
  const key = f0.toFixed(4) + "|" + cfg.speed.toFixed(4) + "|" + cfg.pressure + "|" + cfg.pos + "|" + cfg.tiltHz + "|" + cfg.loss;
  const hit = BOWED_TUNE.get(key); if (hit) return hit;
  const at = Math.round(sr * 0.5), win = Math.max(2048, Math.ceil(3 * sr / f0));
  const n = at + win + Math.ceil(sr * 1.1 / f0) + 8, atN = Math.round(sr * 0.08), x = new Float32Array(n);
  const seed = 0x2545f491 ^ Math.round(f0 * 100);
  let s = 1, rms = 0, sPrev = 0, cPrev = 0;
  for (let it = 0; it < 8; it++) {
    const v = makeBowed(sr, cfg, f0, s, seed);
    for (let i = 0; i < n; i++) x[i] = v.tick(cfg.speed * (i < atN ? 0.5 - 0.5 * Math.cos(Math.PI * i / atN) : 1), f0);
    let e = 0; for (let i = at; i < at + win; i++) e += x[i] * x[i];
    rms = Math.sqrt(e / win);
    if (!(rms > 1e-6)) break;
    const f = brassPitch(x, sr, f0, at, it ? 0.03 : 0.06);
    if (!(f > 0)) break;
    const cents = 1200 * Math.log2(f / f0);
    if (Math.abs(cents) < 2) break;
    const ratio = s * f / f0, sec = it && cents !== cPrev ? s - cents * (s - sPrev) / (cents - cPrev) : ratio;
    sPrev = s; cPrev = cents;
    s = Math.max(0.9, Math.min(1.1, isFinite(sec) ? sec : ratio));
  }
  const out = { scale: s, gain: rms > 1e-6 ? BOWED_RMS / rms : 0 };
  if (BOWED_TUNE.size > 4096) BOWED_TUNE.clear();
  BOWED_TUNE.set(key, out);
  return out;
}

// ---------- Reed (wave "reed", #23): a single reed on a bore, cylindrical or conical ----------
// Woodwinds were the most drawn-on family in CrunchyBGM (BGM §794): its Flute a near-sine, its Clarinet's 3rd harmonic
// 25 dB down where a real one's sits 3, nothing brightening with breath. A reed on a bore gets all of it from the
// mechanism: breath against the bore's return sets the reed's opening, which beats shut — dark when blown gently, a
// bright beating buzz when pushed, choked silent past the top of its window. After Cook's published single-reed and
// saxophone waveguides, written from the description. Two bores:
//   CYLINDER (clarinet): a closed-open tube, a quarter-wave resonator — odd harmonics only, the delay half a period.
//   CONE (sax, low reeds): NOT a long cylinder (that is a clarinet an octave down, 99% of its energy off the note):
//     two delay lines with one rigid and one lossy end, BLOWN partway along like a string, the reed at 0.4 of the
//     bore. Earlier along it, the fundamental collapses (-19 dB at 0.2); 0.4 puts it on top.
// Picked by ear in BGM on its Clarinet, Saxophone and Low Reed. Found building it, each by failing:
//   - breath is stated OVER THE THRESHOLD (~0.65 for both bores, swept), as brass's is, and its window is narrow:
//     the cylinder chokes past ~0.55 over, the cone past ~0.45;
//   - the reed has HYSTERESIS: the onset picks the regime (a sharp start lands in the darker one), so the tuning pass
//     plays each test note with the note's own attack and tongue, or it tunes the reed in the other regime;
//   - a TONGUE (a breath spike) chokes the reed and SLOWS the attack; the bite is a KICK, one half-period pressure
//     pulse into the bore, which starts the oscillation at once;
//   - so brightness after a sharp attack comes from the BELL, a fixed high-pass after the bore (flared bell, open
//     tone holes), and the sax's "flangy wobble" from a fixed FORMANT the vibrato sweeps the harmonics across.
const REED_THR = 0.65;         // the breath at which the reed starts to speak (both bores, swept)
const REED_NOISE = 0.03;       // breath noise
const REED_RMS = 0.25;         // the steady level every note is brought to
const REED_POS = 0.4;          // where the cone is blown, of its length
function reedCfg(st) {
  return { cone: Math.round(st.reedBore) === 1, over: 0.5 * st.reedBreath, kick: 2 * st.reedTongue,
           bellHz: st.reedBell > 0 ? 100 * Math.pow(50, st.reedBell) : 0, formDb: 12 * st.reedWobble, loss: 0.7 * st.reedTone };
}
// A playing reed. tick(breath, f) -> one sample. `scale` stretches the bore (the calibration); `f0` sizes the kick.
function makeReed(sr, cfg, fLow, f0, scale, seedIn) {
  const per = cfg.cone ? 1 : 0.5, size = Math.ceil((sr / Math.max(10, fLow)) * per * scale * 1.05) + 8;
  const d0 = new Float32Array(size), d1 = new Float32Array(size);
  const N0 = (sr / f0) * per * scale, kickN = N0 * 0.5;
  const bA = cfg.bellHz > 0 ? 1 / (1 + 2 * Math.PI * cfg.bellHz / sr) : 1;
  let fB = null;
  if (cfg.formDb > 0) {                                  // RBJ peaking EQ at 1.8 kHz, Q 6
    const A = Math.pow(10, cfg.formDb / 40), w = 2 * Math.PI * 1800 / sr, al = Math.sin(w) / 12, a0 = 1 + al / A;
    fB = [(1 + al * A) / a0, -2 * Math.cos(w) / a0, (1 - al * A) / a0, -2 * Math.cos(w) / a0, (1 - al / A) / a0];
  }
  let w0 = 0, w1 = 0, lp = 0, n = 0, bx = 0, by = 0, fx1 = 0, fx2 = 0, fy1 = 0, fy2 = 0, seed = (seedIn >>> 0) || 0x5eed;
  const read = (buf, w, D) => { let rp = w - D; if (rp < 0) rp += size; const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 === size ? 0 : i0 + 1; return buf[i0] * (1 - fr) + buf[i1] * fr; };
  return {
    tick(p, f) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const breath = p * (1 + REED_NOISE * (seed / 4294967296 * 2 - 1));
      const N = Math.min(size - 4, (sr / Math.max(10, f)) * per * scale);
      const kk = cfg.kick && n < kickN ? cfg.kick * p * Math.sin(Math.PI * n / kickN) : 0;
      n++;
      let o;
      if (!cfg.cone) {                                   // clarinet: the open end reflects inverted through a low-pass
        const bOut = read(d0, w0, Math.max(2, N));
        lp = (1 - cfg.loss) * bOut + cfg.loss * lp;
        const dp = -0.95 * lp - breath;
        let r = 0.7 - 0.3 * dp; if (r > 1) r = 1; else if (r < -1) r = -1;
        d0[w0] = breath + dp * r + kk; w0 = w0 + 1 === size ? 0 : w0 + 1;
        o = bOut;
      } else {                                           // cone: blown at REED_POS, one rigid and one lossy end
        const o0 = read(d0, w0, Math.max(2, N * (1 - REED_POS))), o1 = read(d1, w1, Math.max(2, N * REED_POS));
        lp = (1 - cfg.loss) * o0 + cfg.loss * lp;
        const temp = -0.95 * lp, ov = temp - o1, pd = breath - ov;
        let r = 0.7 + 0.3 * pd; if (r > 1) r = 1; else if (r < -1) r = -1;
        d1[w1] = temp; w1 = w1 + 1 === size ? 0 : w1 + 1;
        d0[w0] = breath - pd * r - temp + kk; w0 = w0 + 1 === size ? 0 : w0 + 1;
        o = ov;
      }
      if (bA < 1) { const h = bA * (by + o - bx); bx = o; by = h; o = h; }   // the bell radiates the highs
      if (fB) { const y = fB[0] * o + fB[1] * fx1 + fB[2] * fx2 - fB[3] * fy1 - fB[4] * fy2; fx2 = fx1; fx1 = o; fy2 = fy1; fy1 = y; o = y; }
      return o;
    },
  };
}
// The bore length and makeup gain for one (pitch, breath, attack, knobs): a held note played with the note's OWN attack
// and kick (the reed's regime depends on the onset), measured at ~0.5 s. Narrow search, secant steps. Cached per session.
const REED_TUNE = new Map();
function reedTune(sr, f0, cfg, p, atk) {
  const key = f0.toFixed(4) + "|" + p.toFixed(4) + "|" + (+atk).toFixed(4) + "|" + cfg.cone + "|" + cfg.kick + "|" + cfg.bellHz + "|" + cfg.formDb + "|" + cfg.loss;
  const hit = REED_TUNE.get(key); if (hit) return hit;
  const at = Math.round(sr * 0.5), win = Math.max(2048, Math.ceil(3 * sr / f0));
  const n = at + win + Math.ceil(sr * 1.1 / f0) + 8, atN = Math.max(1, Math.round(sr * atk)), x = new Float32Array(n);
  const seed = 0x5eed ^ Math.round(f0 * 100);
  let s = 1, rms = 0, sPrev = 0, cPrev = 0;
  for (let it = 0; it < 8; it++) {
    const v = makeReed(sr, cfg, f0, f0, s, seed);
    for (let i = 0; i < n; i++) x[i] = v.tick(p * (i < atN ? 0.5 - 0.5 * Math.cos(Math.PI * i / atN) : 1), f0);   // synth.js's raised-cosine breath
    let e = 0; for (let i = at; i < at + win; i++) e += x[i] * x[i];
    rms = Math.sqrt(e / win);
    if (!(rms > 1e-6)) break;
    const f = brassPitch(x, sr, f0, at, it ? 0.03 : 0.08);
    if (!(f > 0)) break;
    const cents = 1200 * Math.log2(f / f0);
    if (Math.abs(cents) < 2) break;
    const ratio = s * f / f0, sec = it && cents !== cPrev ? s - cents * (s - sPrev) / (cents - cPrev) : ratio;
    sPrev = s; cPrev = cents;
    s = Math.max(0.85, Math.min(1.15, isFinite(sec) ? sec : ratio));
  }
  const out = { scale: s, gain: rms > 1e-6 ? REED_RMS / rms : 0 };
  if (REED_TUNE.size > 4096) REED_TUNE.clear();
  REED_TUNE.set(key, out);
  return out;
}

// ---------- Struck bar (wave "bar", #24): the "-phones" ----------
// CrunchyBGM measured its mallets against real ones (BGM §796, tests/measure-bar.mjs) and found them wrong three ways:
// partials in the wrong places, a ring of 0.1-0.7 s where a marimba's bass rings 4 s, and every partial dying at the
// fundamental's rate where a real bar's upper modes die 5-10x faster (the strike is bright and melts to a near-pure
// ring, which IS a bar's sound). A bar is modal, so this is decaying sines with the physics in a table per CUT, the
// ratios and levels read off VSCO-2 CE's Marimba, Xylo and Glock: a marimba bar is TUNED 1 : 4 : 10, a xylophone's
// 1 : 3, a glockenspiel is a FREE bar 1 : 2.76 : 5.40 : 8.93. The fundamental's ring halves every `half` semitones
// up; mode k rings ring / ratio^alpha; the mallet scales mode k by ratio^(2·dh), dh its hardness from the table's own
// stroke, plus a few ms of click as bright as the mallet. Picked by ear in BGM on its Marimba, Xylophone and
// Glockenspiel. No tuning pass: the modes are exact frequencies.
const BAR_TYPES = [   // index = the `barType` knob (append-only)
  { modes: [1, 3.99, 10.1], db: [0, -10, -8], ring: 4.3, at: 36, half: 9, alpha: 1.3, hard: 0.45, click: 0.04, trem: 0 },        // marimba
  { modes: [1, 3.0, 6.6, 11.0], db: [0, -8, -6, -20], ring: 1.2, at: 55, half: 12, alpha: 1.5, hard: 0.75, click: 0.08, trem: 0 }, // xylophone
  { modes: [1, 2.76, 5.40, 8.93], db: [0, 0, -12, -6], ring: 3.5, at: 67, half: 14, alpha: 1.9, hard: 0.8, click: 0.05, trem: 0 },  // glockenspiel
  { modes: [1, 3.99, 10.1], db: [0, -22, -30], ring: 6, at: 53, half: 12, alpha: 1.2, hard: 0.5, click: 0.02, trem: 0.3 },        // vibraphone
  // a CLAMPED tine (kalimba, music-box comb): a cantilever's modes run 1 : 6.27 : 17.55 (VCSL's kalimbas read the second
  // at 6.29-6.49 on their low tines). Plucked by a thumb or a pin, so the click is a short buzz. BGM §801.
  { modes: [1, 6.27, 17.55], db: [0, -10, -20], ring: 1.2, at: 60, half: 12, alpha: 1.0, hard: 0.6, click: 0.1, trem: 0 },        // tine
];
// One strike. tick(f, i) -> one sample (i counts from the strike). `dh` is the mallet against the table's own stroke.
function makeBar(sr, st, f0, seedIn) {
  const T = BAR_TYPES[Math.max(0, Math.min(BAR_TYPES.length - 1, Math.round(st.barType)))];
  const dh = (st.barMallet - 0.5), ringMul = Math.pow(4, (st.barRing - 0.5) * 2);
  const midi = 69 + 12 * Math.log2(Math.max(1, f0) / 440);
  const T20 = T.ring * ringMul * Math.pow(2, -(midi - T.at) / T.half);
  const n = T.modes.length, ratio = new Float64Array(n), amp = new Float64Array(n), dec = new Float64Array(n), ph = new Float64Array(n), env = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    ratio[k] = T.modes[k];
    amp[k] = Math.pow(10, T.db[k] / 20) * Math.pow(T.modes[k], dh * 2);
    const tau = (T20 / Math.pow(T.modes[k], T.alpha)) / 2.303;
    dec[k] = Math.exp(-1 / Math.max(1e-4, tau * sr)); env[k] = amp[k];
  }
  const hardAbs = Math.max(0, Math.min(1, T.hard + dh)), clickA = 0.15 + 0.8 * hardAbs, clickN = Math.round(0.004 * sr);
  const clickG = T.click * Math.max(0, 1 + 2 * dh), trem = st.barMotor > 0 ? st.barMotor : T.trem;
  let seed = (seedIn >>> 0) || 0x6d0, lp = 0;
  return {
    tick(f, i) {
      let o = 0;
      for (let k = 0; k < n; k++) {
        const fk = ratio[k] * f; if (fk > sr * 0.45) continue;   // a mode past Nyquist is dropped, not folded
        ph[k] += 2 * Math.PI * fk / sr; if (ph[k] > 6.283185307179586) ph[k] -= 6.283185307179586;
        o += env[k] * Math.sin(ph[k]); env[k] *= dec[k];
      }
      if (i < clickN) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; lp += clickA * ((seed / 4294967296 * 2 - 1) - lp); o += clickG * lp * (1 - i / clickN); }
      if (trem) o *= 1 - trem * 0.5 * (1 - Math.cos(2 * Math.PI * 5 * i / sr));   // the vibraphone's motor, 5 Hz
      if (i < sr * 0.001) o *= i / (sr * 0.001);                                  // a 1 ms edge against a click
      return o;
    },
  };
}

// ---------- Piano (wave "piano", #25) ----------
// CrunchyBGM measured its pianos against a real upright (BGM §798, tests/measure-piano.mjs): a piano's identity is four
// couplings, and the modal wave missed all four. STRETCH: a stiff string runs its partials sharp, f_n = n·f0·sqrt(1+B·n²),
// and B grows ~3x an octave up the keyboard (0.8e-4 at C2, 2.7e-4 at C4, 24e-4 at C6). TWO-STAGE DECAY: each note is two
// or three strings a few cents apart, so the sound drops fast (the prompt) and then rings long (the aftersound). The
// BOARD radiates a bass fundamental weakly (C2's sits 36 dB under its 3rd partial). The HAMMER: a harder strike is brighter.
// So each partial is two detuned strings with a fast and a slow decay, the hammer a roll-off (its exponent the Hammer
// knob, lowered by velocity in BGM), the strike point a SHALLOW comb (a felt hammer is a patch: a point notched the 8th
// partial to -115 dB), a steep 4th-order board high-pass at 100 Hz, a 3.5 kHz treble low-pass (without it the top octaves
// read twice as bright as a real one's near-pure ring), and a felt thump. Picked by ear in BGM on its Piano.
const PIANO_PARTIALS = 24;
// One strike. tick(f, i) -> one sample (i counts from the strike); `f` moves every partial with it.
function makePiano(sr, st, f0, seedIn) {
  const midi = 69 + 12 * Math.log2(Math.max(1, f0) / 440), oct = (midi - 60) / 12;
  const B = Math.max(0.8e-4, 2.7e-4 * Math.pow(3, oct)) * Math.pow(4, (st.pianoStretch - 0.5) * 2);
  const ring = Math.pow(4, (st.pianoRing - 0.5) * 2) * Math.pow(1.6, -oct);
  const tp = 0.3 * ring, ta = 2.5 * ring, roll = 1.4 - 1.2 * st.pianoHammer, det = Math.pow(2, 3 * st.pianoStrings / 1200);
  const ratio = [], amp = [], dP = [], dA = [], ph1 = [], ph2 = [], eP = [], eA = [], dt = [];
  let sum = 0;
  for (let k = 1; k <= PIANO_PARTIALS; k++) {
    const r = k * Math.sqrt(1 + B * k * k), fk = r * f0; if (fk > sr * 0.45) break;
    const comb = 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * k * 0.125)) / Math.sin(Math.PI * 0.125);
    const rb = Math.pow(fk / 100, 4), board = rb / Math.sqrt(1 + rb * rb), lp = 1 / Math.sqrt(1 + Math.pow(fk / 3500, 4));
    const a = Math.pow(k, -roll) * comb * board * lp; if (a < 1e-5) continue;
    const pf = 1 + 0.5 * (k - 1);
    ratio.push(r); amp.push(a); dP.push(Math.exp(-pf / (tp * sr))); dA.push(Math.exp(-pf / (ta * sr)));
    ph1.push(0); ph2.push(0); eP.push(a * 0.7); eA.push(a * 0.3); dt.push(k <= 12 ? det : Math.sqrt(det)); sum += a;
  }
  const norm = sum > 0 ? 0.5 / sum : 0, thumpN = Math.round(0.006 * sr), thumpG = 0.15 * (0.5 + st.pianoHammer);
  let seed = (seedIn >>> 0) || 0x9e37, lp = 0;
  return {
    tick(f, i) {
      let o = 0;
      for (let k = 0; k < ratio.length; k++) {
        const w = 2 * Math.PI * ratio[k] * f / sr;
        ph1[k] += w; if (ph1[k] > 6.283185307179586) ph1[k] -= 6.283185307179586;
        ph2[k] += w * dt[k]; if (ph2[k] > 6.283185307179586) ph2[k] -= 6.283185307179586;
        o += (eP[k] + eA[k]) * 0.5 * (Math.sin(ph1[k]) + Math.sin(ph2[k]));
        eP[k] *= dP[k]; eA[k] *= dA[k];
      }
      o *= norm;
      if (i < thumpN) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; lp += 0.08 * ((seed / 4294967296 * 2 - 1) - lp); o += thumpG * lp * (1 - i / thumpN); }
      if (i < sr * 0.0015) o *= i / (sr * 0.0015);
      return o;
    },
  };
}


// ---------- Flute (wave "flute", #26): an air jet driving an open pipe ----------
// The woodwind half CrunchyBGM's reed did not cover (BGM §794, §804): a flute's identity is a JET of air flipping in and
// out of a pipe at its edge, and an earlier jet design was refused by ear as "metallic and breathy" for two measured
// reasons, both answered here by construction:
//
//   breath ─(+ a little noise)─ − pressure ─► JET delay ─► jet low-pass ─► tanh(gain·(deflection / breath + aim)) · breath
//                                                                                      │ (the flow into the pipe)
//   pipe: ──► ONE-period delay, both ends open (−1·−1 = +) ─► symmetric low-pass ─► + ─┘ ─► pressure ─► radiation ─► out
//
//   - the pipe is ONE period long and open at both ends, so every resonance it has IS a harmonic of the note: anything
//     it colours (breath noise included) lands on the note's own series. The refused design's 1.5-period bore rang
//     partials at multiples of 2/3 of the note — the metallic;
//   - the loss filter is SYMMETRIC [a, 1-2a, a], a constant one-sample delay taken off the line, so the upper modes are
//     not pulled flat the way a one-pole's phase pulls them;
//   - the jet is deflected by the sound's velocity OVER ITS OWN SPEED (a faster jet bends less), so the threshold is the
//     same at every breath and a soft note speaks; `FLUTE_SAT` puts back half of the breath's say over saturation, so
//     a harder breath is brighter, as a flute is;
//   - what leaves an open end is the RATE OF CHANGE of its flow, a +6 dB/octave tilt: the stage that puts a flute's
//     upper harmonics where a real one's are (measured against VSCO-2's flute: 4-5 dB off on average, h2..h8);
//   - the jet's travel time is the EMBOUCHURE: 0.28 of a period here. Shorter overblows to the octave (the edge is
//     ~0.25, where any breath noise flips it), longer leans to the odd harmonics, a hollower tone.
// Prototyped and picked by ear in CrunchyBGM (tools/_flute.mjs) on its Flute, with almost no breath noise ("the realism
// of the breathiness… is disruptive in a song"). The amp envelope is the BREATH; each note is levelled by its RMS.
const FLUTE_GAIN = 3;          // how hard the jet switches (soft is a sine, hard an edge tone)
const FLUTE_REFL = 0.8;        // both open ends' reflection together: a lossier pipe keeps the jet near linear, so its aim shapes the wave
const FLUTE_LOSS = 0.25;       // the symmetric loss filter, [a, 1-2a, a] with a = loss/2
const FLUTE_MOUTH = 0.3;       // the jet's own flow, radiated at the embouchure hole as well as the foot (stated against the pipe's gain)
const FLUTE_JETLP = 1.5;       // the jet spreads as it crosses the mouth: a one-pole at 1.5 x f0 on its deflection
const FLUTE_SAT = 0.5;         // the breath's share of the jet's saturation (0 = the same spectrum at every breath)
const FLUTE_RMS = 0.25;        // the steady level every note is brought to
function fluteCfg(st) {
  return { blow: Math.max(0.02, Math.min(1, st.fluteBreath)), ratio: 0.2 + 0.16 * st.fluteJet, aim: st.fluteAim,
           // squared, to 0.4 (BGM §807): a linear 0.1 at the top was audible on a bright flute and lost under a dark one's
           // top (a shakuhachi's muraiki at full read 25 dB of residual from half); the squared law keeps the bottom fine
           noise: 0.4 * st.fluteNoise * st.fluteNoise, topHz: 1000 * Math.pow(10, st.fluteTone), buzz: st.fluteBuzz || 0 };
}
// A playing flute. tick(breath, f) -> one sample; `breath` is the blow times the envelope (and any breath vibrato).
function makeFlute(sr, cfg, fLow, f0, scale, seedIn) {
  const N0max = (sr / Math.max(10, fLow)) * scale, size = Math.ceil(N0max * 1.05) + 8, pipe = new Float32Array(size);
  const jsize = Math.ceil(N0max * cfg.ratio * 1.05) + 8, jet = new Float32Array(jsize);
  const a = FLUTE_LOSS / 2, jK = Math.exp(-2 * Math.PI * Math.min(0.45 * sr, FLUTE_JETLP * f0) / sr);
  const tH = cfg.topHz > 0 ? Math.exp(-2 * Math.PI * Math.min(0.45 * sr, cfg.topHz) / sr) : 0, rN = sr / (2 * Math.PI * f0);
  const pmax = cfg.blow, mouthG = FLUTE_MOUTH / (1 - FLUTE_REFL);
  let w = 0, wj = 0, x1 = 0, x2 = 0, dcx = 0, dcy = 0, jz = 0, oPrev = 0, th1 = 0, th2 = 0, seed = (seedIn >>> 0) || 0xf1a7e;
  // `buzz` (BGM §806): a DIZI's membrane, the dimo — paper over a hole in the wall, driven by the pipe's pressure. It
  // RATTLES: what of its excursion exceeds its slack (asymmetric, since it is glued under tension) comes out as sharp
  // spikes, periodic and so still the note's own harmonics, coloured by the membrane's resonance near 3.2 kHz. Read off
  // the pressure normalized by its own envelope, so the rasp is the same at every level; radiated beside the tone and
  // NOT fed back, because anything that perturbs the jet can tip the pipe into its islands (§804).
  const bz = cfg.buzz, mw = 2 * Math.PI * Math.min(0.45 * sr, 3200) / sr, mal = Math.sin(mw) / (2 * 1.2), ma0 = 1 + mal;
  const mb0 = mal / ma0, mb2 = -mal / ma0, ma1 = -2 * Math.cos(mw) / ma0, ma2 = (1 - mal) / ma0;
  let pEnv = 0, mx1 = 0, mx2 = 0, my1 = 0, my2 = 0;
  const read = (buf, wp, D, sz) => { let rp = wp - D; if (rp < 0) rp += sz; const i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 === sz ? 0 : i0 + 1; return buf[i0] * (1 - fr) + buf[i1] * fr; };
  return {
    tick(breath, f) {
      const N = (sr / Math.max(10, f)) * scale, D = Math.min(size - 4, Math.max(2, N - 1)), Dj = Math.min(jsize - 4, Math.max(1, N * cfg.ratio));
      const ret = read(pipe, w, D, size);
      const lp = a * ret + (1 - 2 * a) * x1 + a * x2; x2 = x1; x1 = ret;
      const p = FLUTE_REFL * lp;
      const dc = p - dcx + 0.995 * dcy; dcx = p; dcy = dc;          // the jet sees the pressure without its mean
      // BREATH NOISE IS RADIATED AT THE EMBOUCHURE, NOT BLOWN INTO THE JET (§804): a trace of noise in the jet (0.005)
      // kicked the pipe into a second, louder oscillation at certain lengths — islands where the pitch jumps, M84 and M91
      // landing 16 and 89 cents out — and in the pipe it is tuned into a pitched hiss. The turbulence at the mouth hole is
      // what a listener hears as breath, so it joins the output there and cannot touch the oscillation at all.
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const br = breath, nz = breath * cfg.noise * (seed / 4294967296 * 2 - 1);
      jet[wj] = br - dc; wj = wj + 1 === jsize ? 0 : wj + 1;
      let dfl = read(jet, wj, Dj, jsize) - br; jz = (1 - jK) * dfl + jK * jz; dfl = jz;
      const den = Math.pow(br + 0.05 * pmax + 1e-9, 1 - FLUTE_SAT);   // the full breath is 1, so its power is 1
      const q = Math.tanh(FLUTE_GAIN * (dfl / den + cfg.aim)) * br;
      pipe[w] = p + q; w = w + 1 === size ? 0 : w + 1;
      let o = dc + mouthG * (q + nz);
      const d = (o - oPrev) * rN; oPrev = o; o = d;                     // radiation: the open end radiates the change
      if (bz > 0) {
        pEnv += (Math.abs(dc) - pEnv) * 0.002;
        // the membrane RATTLES on each pressure peak: a burst of noise gated by how far the pressure passes its slack (a
        // kazoo's buzz, pitch-synchronous so it is heard as a rasp ON the note). Noise rather than a periodic slap,
        // because a buzz exactly on the tone's harmonics adds or cancels by phase — measured, a slap made the note
        // DARKER at low settings and wiped out a harmonic at high ones
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const xr = dc / (pEnv * 1.6 + 1e-9), gate = xr > 0.45 ? xr - 0.45 : 0, r = gate * (seed / 4294967296 * 2 - 1) * 4;
        const m = mb0 * r + mb2 * mx2 - ma1 * my1 - ma2 * my2; mx2 = mx1; mx1 = r; my2 = my1; my1 = m;
        o += bz * 12 * m * pEnv;                                        // stated against the pressure's own envelope
      }
      if (tH) { th1 = (1 - tH) * o + tH * th1; th2 = (1 - tH) * th1 + tH * th2; o = th2; }
      return o;
    },
  };
}
// The pipe length and the makeup gain for one (pitch, knobs): a held note without vibrato, measured at ~0.5 s. The FIRST
// search is ±12%: the loop's filters add phase a short pipe feels, so the top octave speaks 70-110 cents sharp of its
// nominal length (M84: +72 at scale 1, in tune at 1.043), near the edge of the ±6% the bowed tuner uses. Then ±3%, held
// within ±10%, secant steps. A pipe whose modes are the harmonics has no false neighbour that close, so the wider first
// look is safe here where it was not for the bow.
const FLUTE_TUNE = new Map();
function fluteTune(sr, f0, cfg) {
  const key = f0.toFixed(4) + "|" + cfg.blow.toFixed(4) + "|" + cfg.ratio + "|" + cfg.aim + "|" + cfg.noise + "|" + cfg.topHz;
  const hit = FLUTE_TUNE.get(key); if (hit) return hit;
  const at = Math.round(sr * 0.5), win = Math.max(2048, Math.ceil(3 * sr / f0));
  const n = at + win + Math.ceil(sr * 1.1 / f0) + 8, atN = Math.round(sr * 0.06), x = new Float32Array(n);
  const seed = 0xf1a7e ^ Math.round(f0 * 100);
  let s = 1, rms = 0, sPrev = 0, cPrev = 0;
  // TUNED WITHOUT THE MEMBRANE: its rattle is radiated beside the tone and does not touch the oscillation, so it cannot
  // move the pitch — but its noise does move the TRACKER, which read the buzz as the pitch and set a dizi 13 cents out on
  // median (100 at worst) before this. The level is the tone's too; the rattle rides on top of it.
  const tcfg = cfg.buzz ? Object.assign({}, cfg, { buzz: 0 }) : cfg;
  for (let it = 0; it < 8; it++) {
    const v = makeFlute(sr, tcfg, f0, f0, s, seed);
    for (let i = 0; i < n; i++) x[i] = v.tick(cfg.blow * (i < atN ? 0.5 - 0.5 * Math.cos(Math.PI * i / atN) : 1), f0);
    let e = 0; for (let i = at; i < at + win; i++) e += x[i] * x[i];
    rms = Math.sqrt(e / win);
    if (!(rms > 1e-6)) break;
    const f = brassPitch(x, sr, f0, at, it ? 0.03 : 0.12);
    if (!(f > 0)) break;
    const cents = 1200 * Math.log2(f / f0);
    if (Math.abs(cents) < 2) break;
    const ratio = s * f / f0, sec = it && cents !== cPrev ? s - cents * (s - sPrev) / (cents - cPrev) : ratio;
    sPrev = s; cPrev = cents;
    s = Math.max(0.9, Math.min(1.1, isFinite(sec) ? sec : ratio));
  }
  const out = { scale: s, gain: rms > 1e-6 ? FLUTE_RMS / rms : 0 };
  if (FLUTE_TUNE.size > 4096) FLUTE_TUNE.clear();
  FLUTE_TUNE.set(key, out);
  return out;
}

// ---------- Formant speech synthesis (retro robot voice) ----------
// A tiny Klatt/SAM-style formant speech synth: text → phonemes → a stream of formant targets +
// voiced/unvoiced source, driven through 3 bandpasses. Intelligible-but-robotic (on purpose).
// Each phoneme: f=[F1,F2,F3] Hz, v=voicing (1 buzz / 0 noise / ~0.35 voiced fricative), d=ms,
// a=amp, to=[…] diphthong glide target, stop=leading-silence burst consonant, nasal=lower level.
const SPEECH_PHON = {
  AA: { f: [700, 1220, 2600], v: 1, d: 150 }, AE: { f: [660, 1720, 2410], v: 1, d: 150 },
  AH: { f: [640, 1190, 2390], v: 1, d: 110, a: 0.9 }, AO: { f: [570, 840, 2410], v: 1, d: 150 },
  EH: { f: [530, 1840, 2480], v: 1, d: 130 }, ER: { f: [490, 1350, 1690], v: 1, d: 150, a: 0.9 },
  IH: { f: [400, 1920, 2560], v: 1, d: 110, a: 0.9 }, IY: { f: [270, 2290, 3010], v: 1, d: 150 },
  UH: { f: [440, 1020, 2240], v: 1, d: 110, a: 0.9 }, UW: { f: [300, 870, 2240], v: 1, d: 150 },
  OW: { f: [570, 840, 2410], v: 1, d: 170, to: [360, 800, 2400] }, EY: { f: [530, 1840, 2480], v: 1, d: 170, to: [340, 2200, 3000] },
  AY: { f: [700, 1220, 2600], v: 1, d: 180, to: [340, 2200, 3000] }, AW: { f: [700, 1220, 2600], v: 1, d: 180, to: [360, 800, 2400] },
  OY: { f: [570, 840, 2410], v: 1, d: 180, to: [340, 2200, 3000] },
  L: { f: [360, 1300, 2600], v: 1, d: 70, a: 0.85 }, R: { f: [420, 1300, 1600], v: 1, d: 70, a: 0.85 },
  W: { f: [300, 800, 2400], v: 1, d: 60, a: 0.8 }, Y: { f: [300, 2200, 3000], v: 1, d: 55, a: 0.8 },
  M: { f: [280, 900, 2200], v: 1, d: 85, a: 0.65, nasal: 1 }, N: { f: [280, 1700, 2600], v: 1, d: 85, a: 0.65, nasal: 1 },
  NG: { f: [280, 2300, 2750], v: 1, d: 85, a: 0.6, nasal: 1 },
  F: { f: [400, 1100, 2000], v: 0, d: 100, a: 0.5 }, V: { f: [400, 1100, 2000], v: 0.35, d: 80, a: 0.5 },
  S: { f: [500, 1400, 5500], v: 0, d: 110, a: 0.55 }, Z: { f: [500, 1400, 5000], v: 0.35, d: 90, a: 0.5 },
  SH: { f: [500, 1800, 2600], v: 0, d: 110, a: 0.55 }, ZH: { f: [500, 1800, 2600], v: 0.35, d: 90, a: 0.5 },
  TH: { f: [400, 1400, 2500], v: 0, d: 90, a: 0.4 }, DH: { f: [400, 1400, 2500], v: 0.35, d: 70, a: 0.4 },
  HH: { f: [500, 1500, 2500], v: 0, d: 70, a: 0.4 },
  P: { f: [600, 1500, 2500], v: 0, d: 70, a: 0.5, stop: 1 }, B: { f: [500, 1200, 2200], v: 0.3, d: 65, a: 0.5, stop: 1 },
  T: { f: [600, 1800, 2800], v: 0, d: 75, a: 0.5, stop: 1 }, D: { f: [500, 1600, 2600], v: 0.3, d: 65, a: 0.5, stop: 1 },
  K: { f: [500, 1500, 2500], v: 0, d: 80, a: 0.5, stop: 1 }, G: { f: [400, 1300, 2300], v: 0.3, d: 65, a: 0.5, stop: 1 },
  CH: { f: [500, 1800, 2600], v: 0, d: 100, a: 0.5, stop: 1 }, JH: { f: [500, 1800, 2600], v: 0.3, d: 90, a: 0.5, stop: 1 },
};

// Grapheme→phoneme for one lowercase word. Rule-based, greedy left-to-right; handles common
// digraphs, vowel teams, r-controlled vowels, and magic-e. Imperfect on irregular spellings.
function word2phon(w) {
  const ph = [], n = w.length, V = "aeiou", isV = (c) => V.indexOf(c) >= 0, at = (j) => w[j] || "";
  let i = 0;
  while (i < n) {
    const c = w[i], c2 = w.substr(i, 2), c3 = w.substr(i, 3);
    if (c3 === "igh") { ph.push("AY"); i += 3; continue; }
    const dg = { th: "TH", sh: "SH", ch: "CH", ph: "F", wh: "W", ck: "K", ng: "NG" };
    if (c2 === "qu") { ph.push("K", "W"); i += 2; continue; }
    if (dg[c2]) { ph.push(dg[c2]); i += 2; continue; }
    if (c2 === "ee" || c2 === "ea") { ph.push("IY"); i += 2; continue; }
    if (c2 === "oo") { ph.push("UW"); i += 2; continue; }
    if (c2 === "ou" || c2 === "ow") { ph.push("AW"); i += 2; continue; }
    if (c2 === "oi" || c2 === "oy") { ph.push("OY"); i += 2; continue; }
    if (c2 === "ai" || c2 === "ay") { ph.push("EY"); i += 2; continue; }
    if (c2 === "oa") { ph.push("OW"); i += 2; continue; }
    if (c2 === "au" || c2 === "aw") { ph.push("AO"); i += 2; continue; }
    if (c2 === "ar") { ph.push("AA", "R"); i += 2; continue; }
    if (c2 === "or") { ph.push("AO", "R"); i += 2; continue; }
    if (c2 === "er" || c2 === "ir" || c2 === "ur") { ph.push("ER"); i += 2; continue; }
    if (isV(c)) {
      const longByE = (i + 2 === n - 1) && !isV(at(i + 1)) && at(n - 1) === "e";   // magic-e: vCe$
      if (longByE) { ph.push({ a: "EY", e: "IY", i: "AY", o: "OW", u: "UW" }[c]); i += 1; continue; }
      ph.push({ a: "AE", e: "EH", i: "IH", o: "AO", u: "AH" }[c]); i += 1; continue;
    }
    if (c === "e" && i === n - 1) { i++; continue; }                                // silent final e
    if (c === "c") { ph.push("eiy".indexOf(at(i + 1)) >= 0 ? "S" : "K"); i++; continue; }
    if (c === "g" && "eiy".indexOf(at(i + 1)) >= 0) { ph.push("JH"); i++; continue; }
    if (c === "x") { ph.push("K", "S"); i++; continue; }
    const map = { b: "B", d: "D", f: "F", g: "G", h: "HH", j: "JH", k: "K", l: "L", m: "M", n: "N", p: "P", q: "K", r: "R", s: "S", t: "T", v: "V", w: "W", y: "Y", z: "Z" };
    if (map[c]) ph.push(map[c]);
    i++;
  }
  const out = [];                                                                   // collapse doubled consonants
  for (const p of ph) { if (out.length && out[out.length - 1] === p && !SPEECH_PHON[p].to) continue; out.push(p); }
  return out;
}

function textToPhonemes(text) {
  const words = String(text).toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) { const p = word2phon(w); if (p.length) { out.push(...p); out.push("_"); } }  // "_" = word gap
  return out;
}

// Render text to a mono speech buffer of length n. freq = pitch, size scales formants (voice size),
// rateScale = speaking speed. Formant/amp/voicing glide smoothly between phonemes (coarticulation).
function makeSpeech(n, text, freq, size, rateScale, seed) {
  const out = new Float32Array(n);
  const phon = textToPhonemes(text);
  if (!phon.length || n < 4) return out;
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  const Q = 9, gl = 0.005, rs = Math.max(0.25, rateScale);
  let ph = 0, curAmp = 0, curVoi = 1, idx = 0;
  const cf = [500, 1500, 2500], x1 = [0, 0, 0], x2 = [0, 0, 0], y1 = [0, 0, 0], y2 = [0, 0, 0];
  for (const key of phon) {
    if (key === "_") { const sil = Math.floor(0.05 * SR / rs); for (let k = 0; k < sil && idx < n; k++) { curAmp += -curAmp * 0.02; out[idx++] = 0; } continue; }
    const spec = SPEECH_PHON[key]; if (!spec) continue;
    if (spec.stop) { const sil = Math.floor(0.045 * SR / rs); for (let k = 0; k < sil && idx < n; k++) { curAmp += -curAmp * 0.05; out[idx++] = 0; } }
    const dur = Math.max(4, Math.floor((spec.d || 120) / 1000 * SR / rs));
    const t0 = spec.f, t1 = spec.to || spec.f, voi = spec.v == null ? 1 : spec.v, amp = spec.a == null ? 1 : spec.a;
    for (let k = 0; k < dur && idx < n; k++, idx++) {
      const fr = k / dur;
      for (let i2 = 0; i2 < 3; i2++) { const tgt = (t0[i2] + (t1[i2] - t0[i2]) * fr) * size; cf[i2] += (tgt - cf[i2]) * gl; }
      curAmp += (amp - curAmp) * 0.01; curVoi += (voi - curVoi) * 0.02;
      ph += freq / SR; if (ph >= 1) ph -= 1;
      const src = curVoi * (2 * ph - 1) + (1 - curVoi) * rnd();
      let y = 0;
      for (let i2 = 0; i2 < 3; i2++) {
        const w0 = 2 * Math.PI * Math.max(60, Math.min(0.45 * SR, cf[i2])) / SR, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
        const b0 = al / a0, A1 = -2 * Math.cos(w0) / a0, A2 = (1 - al) / a0;
        const o = b0 * (src - x2[i2]) - A1 * y1[i2] - A2 * y2[i2];
        x2[i2] = x1[i2]; x1[i2] = src; y2[i2] = y1[i2]; y1[i2] = o;
        y += o * FORMANT_GAIN[i2];
      }
      out[idx] = y * curAmp;
    }
  }
  const fade = Math.floor(0.006 * SR);                                              // declick the ends
  let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
  const g = pk > 0.001 ? 0.75 / pk : 1;
  for (let i = 0; i < n; i++) { let e = 1; if (i < fade) e = i / fade; else if (i > idx - fade && i < idx) e = (idx - i) / fade; out[i] *= g * e; }
  return out;
}

// Natural length (samples) of an utterance at rate 1 — used to fit spoken text to a sound's duration.
function speechLen(text) {
  let nat = 0;
  for (const key of textToPhonemes(text)) {
    if (key === "_") { nat += 0.05 * SR; continue; }
    const sp = SPEECH_PHON[key]; if (!sp) continue;
    if (sp.stop) nat += 0.045 * SR;
    nat += Math.max(4, (sp.d || 120) / 1000 * SR);
  }
  return nat;
}

// Parse a word into the sequence of vowel positions (0..1 across A E I O U) the formant engine
// morphs through, so a voice can "say" the vowels you type (raaawr → o-a, wooo → held o, hello →
// e-o). Consonants are ignored — this engine has no consonants; for full words use the Speech
// engine. Consecutive identical vowels collapse to one held target. Returns [] when text has none.
const VOWEL_POS = { a: 0.0, e: 0.25, i: 0.5, o: 0.75, u: 1.0, y: 0.5 };
function formantVowelPath(text) {
  const out = [];
  const s = String(text || "").toLowerCase();
  for (let k = 0; k < s.length; k++) {
    const p = VOWEL_POS[s[k]];
    if (p === undefined) continue;
    if (out.length === 0 || out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

// Fill the 3 formant bandpass coefficient sets for a vowel (0..1 morph A→E→I→O→U), voice size, and
// Q. Shared by the static precompute and the per-sample vowel-LFO path (RBJ bandpass; b1=0, b2=−b0).
function computeFormantCoeffs(vowel, size, Q, b0, a1, a2) {
  const p = Math.max(0, Math.min(1, vowel)) * (VOWELS.length - 1);
  const i0 = Math.floor(p), i1 = Math.min(VOWELS.length - 1, i0 + 1), fr = p - i0;
  for (let fi = 0; fi < 3; fi++) {
    let fc = (VOWELS[i0][fi] * (1 - fr) + VOWELS[i1][fi] * fr) * size;
    fc = Math.max(60, Math.min(0.45 * SR, fc));
    const w0 = 2 * Math.PI * fc / SR, alpha = Math.sin(w0) / (2 * Q), a0 = 1 + alpha;
    b0[fi] = alpha / a0; a1[fi] = -2 * Math.cos(w0) / a0; a2[fi] = (1 - alpha) / a0;
  }
}

// Same, but from EXPLICIT formant freqs (for speaking — consonant/nasal targets aren't on the
// A→U vowel line). size scales them (voice size). RBJ bandpass; b1=0, b2=−b0.
function computeFormantCoeffsF(f1, f2, f3, size, Q, b0, a1, a2) {
  const fv = [f1, f2, f3];
  for (let fi = 0; fi < 3; fi++) {
    const fc = Math.max(60, Math.min(0.45 * SR, fv[fi] * size));
    const w0 = 2 * Math.PI * fc / SR, alpha = Math.sin(w0) / (2 * Q), a0 = 1 + alpha;
    b0[fi] = alpha / a0; a1[fi] = -2 * Math.cos(w0) / a0; a2[fi] = (1 - alpha) / a0;
  }
}

// Per-sample control timeline for the formant engine to SPEAK text: target formant freqs (F1/F2/F3,
// unscaled), voicing (1 buzz / 0 noise / ~0.35 mix), and amplitude — same phoneme durations/stops/
// glides as makeSpeech, but the formant loop supplies its OWN source, so its growl/tilt/breath AND
// pitch tracking carry through (unlike makeSpeech, which is a fixed-pitch prebuilt buffer). rate>1
// speeds a long word to fit; stops insert a closure silence then the burst falls out of the phoneme.
function buildFormantSpeechPlan(n, text, rate) {
  const f1 = new Float32Array(n), f2 = new Float32Array(n), f3 = new Float32Array(n),
        voi = new Float32Array(n), amp = new Float32Array(n);
  const phon = textToPhonemes(text), rs = Math.max(0.25, rate);
  let idx = 0, last = [500, 1500, 2500];
  const hold = (cnt, v) => { for (let k = 0; k < cnt && idx < n; k++, idx++) { f1[idx] = last[0]; f2[idx] = last[1]; f3[idx] = last[2]; voi[idx] = v; amp[idx] = 0; } };
  for (const key of phon) {
    if (key === "_") { hold(Math.floor(0.05 * SR / rs), 1); continue; }              // word gap
    const sp = SPEECH_PHON[key]; if (!sp) continue;
    if (sp.stop) hold(Math.floor(0.045 * SR / rs), 0);                               // stop closure = silence
    const dur = Math.max(4, Math.floor((sp.d || 120) / 1000 * SR / rs));
    const t0 = sp.f, t1 = sp.to || sp.f, v = sp.v == null ? 1 : sp.v, a = sp.a == null ? 1 : sp.a;
    for (let k = 0; k < dur && idx < n; k++, idx++) {
      const fr = k / dur;
      f1[idx] = t0[0] + (t1[0] - t0[0]) * fr; f2[idx] = t0[1] + (t1[1] - t0[1]) * fr; f3[idx] = t0[2] + (t1[2] - t0[2]) * fr;
      voi[idx] = v; amp[idx] = a;
    }
    last = sp.to || sp.f;
  }
  for (; idx < n; idx++) { f1[idx] = last[0]; f2[idx] = last[1]; f3[idx] = last[2]; voi[idx] = 0; amp[idx] = 0; }   // trailing silence
  return { f1, f2, f3, voi, amp };
}

// ---------- Master finishing stage ----------
// DC blocker: a one-pole highpass at ~18 Hz, always on. In place, no gate.
//
// WHY IT IS NEEDED, when the oscillator is already DC-centered: it is, and `drive` undoes it. A
// centered 25%-duty pulse sits at +1.5 for a quarter of the cycle and −0.5 for three quarters — no
// DC, but amplitude-ASYMMETRIC — and tanh squashes the tall positive spike far harder than the
// shallow negative one. The mean goes negative, worse the narrower the duty and the harder the
// drive. Measured on single notes downstream in CrunchyBGM: 50% duty is clean, 25% reads −0.27,
// and a 15% duty at drive 0.25 reads −0.44. Nearly half of full scale, on one voice.
//
// It matters here for two separate reasons:
//
//   1. A one-shot with an offset STEPS the signal on and off, so a sound used repeatedly in a game
//      lays a low-frequency thump under every trigger. In a sequenced context — CrunchyBGM playing
//      one of these as an instrument — it reads as a constant rumble, which is how it was found.
//   2. It corrupts loudness normalization. `rawPeak` in renderPatch is measured across the offset,
//      so a driven narrow-pulse sound looks louder than it is and gets normalized DOWN. Removing
//      the offset first makes NORM_TARGET mean what it says.
//
// Cold-started on purpose, unlike CrunchyBGM's version of this: a sound effect begins at silence,
// so there is nothing to prime from and the settling IS the correct behavior. (BGM's buffer is a
// seamless loop, so it primes on the tail or its own transient lands on the loop point.) The ~9 ms
// time constant is well below the shortest attack here and a highpass passes transients anyway, so
// the click at the front of a percussive sound survives intact.
function dcBlock(L, R) {
  const n = L.length;
  if (!n) return;
  const a = 1 - 2 * Math.PI * 18 / SR;      // ~18 Hz: below anything audible, above the offset
  let xl = 0, yl = 0, xr = 0, yr = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    yl = l - xl + a * yl; xl = l; L[i] = yl;
    yr = r - xr + a * yr; xr = r; R[i] = yr;
  }
}

// Transient shaper: emphasize (+) or soften (−) attacks. A fast and a slow envelope follower
// track the signal; their difference (fast − slow) is positive during an attack, so scaling by
// it punches up (amount>0) or rounds off (amount<0) transients. In place, gated on amount≠0.
function transientShape(L, R, amount) {
  const n = L.length;
  if (!n || amount === 0) return;
  const fAtk = Math.exp(-1 / (0.0005 * SR)), fRel = Math.exp(-1 / (0.020 * SR));   // fast: 0.5ms / 20ms
  const sAtk = Math.exp(-1 / (0.010 * SR)), sRel = Math.exp(-1 / (0.100 * SR));    // slow: 10ms / 100ms
  let ef = 0, es = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]), x = a > b ? a : b;
    ef = x > ef ? x + (ef - x) * fAtk : x + (ef - x) * fRel;
    es = x > es ? x + (es - x) * sAtk : x + (es - x) * sRel;
    const trans = ef > es ? ef - es : 0;            // only the ATTACK region (else leave the tail alone)
    let g = 1 + amount * trans * 4;                  // +punch up / −soften attacks
    if (g < 0.1) g = 0.1; else if (g > 4) g = 4;
    L[i] *= g; R[i] *= g;
  }
}

// Lookahead brickwall limiter: drives the signal (louder/denser as amount rises) into a ceiling
// it can't exceed. The gain is computed from the peak over a short LOOKAHEAD window, so reduction
// begins before a transient arrives — no need to delay the audio (the windowed max already bounds
// every sample to the ceiling). Fast attack, 50 ms release. In place, gated on amount>0.
function limiterProcess(L, R, amount) {
  const n = L.length;
  if (!n || amount <= 0) return;
  const ceiling = 0.98, drive = 1 + amount * 3;
  const look = Math.max(1, Math.floor(0.003 * SR));      // 3 ms lookahead window
  const rel = Math.exp(-1 / (0.05 * SR));                // 50 ms release
  for (let i = 0; i < n; i++) { L[i] *= drive; R[i] *= drive; }
  let g = 1;
  for (let i = 0; i < n; i++) {
    let mx = 0; const end = Math.min(n, i + look);       // peak over [i, i+look)
    for (let j = i; j < end; j++) { const a = Math.abs(L[j]), b = Math.abs(R[j]), m = a > b ? a : b; if (m > mx) mx = m; }
    const target = mx > ceiling ? ceiling / mx : 1;
    g = target < g ? target : target + (g - target) * rel;   // instant attack, smooth release
    L[i] *= g; R[i] *= g;
  }
}

// Phaser: a chain of first-order allpass stages whose coefficient is swept by an LFO, mixed with
// the dry signal → moving notches ("whoosh"). In place; mix 0 = bypass. Stereo via an LFO offset.
function phaserProcess(L, R, mix, rate, depth) {
  const n = L.length; if (!n || mix <= 0) return;
  const STAGES = 4, apL = new Float32Array(STAGES), apR = new Float32Array(STAGES);
  const w = 2 * Math.PI * rate / SR, dry = 1 - mix * 0.5, wet = mix;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += w; if (ph >= 2 * Math.PI) ph -= 2 * Math.PI;
    const gL = 0.2 + depth * 0.7 * (0.5 + 0.5 * Math.sin(ph));
    const gR = 0.2 + depth * 0.7 * (0.5 + 0.5 * Math.sin(ph + 0.6));
    let xl = L[i]; for (let s = 0; s < STAGES; s++) { const y = -gL * xl + apL[s]; apL[s] = xl + gL * y; xl = y; }
    let xr = R[i]; for (let s = 0; s < STAGES; s++) { const y = -gR * xr + apR[s]; apR[s] = xr + gR * y; xr = y; }
    L[i] = L[i] * dry + xl * wet; R[i] = R[i] * dry + xr * wet;
  }
}
// Chorus: a short LFO-modulated delay mixed with the dry signal → thickening/swirl (shorten the
// delay + add feedback and it's a flanger). In place; mix 0 = bypass. Stereo via an LFO offset.
function chorusProcess(L, R, mix, rate, depth) {
  const n = L.length; if (!n || mix <= 0) return;
  const maxD = Math.floor(0.028 * SR), len = maxD + 4;
  const bl = new Float32Array(len), br = new Float32Array(len);
  const w = 2 * Math.PI * rate / SR, dry = 1 - mix * 0.5, wet = mix;
  const rd = (buf, wi, d) => { let rp = wi - d; while (rp < 0) rp += len; const i0 = Math.floor(rp) % len, fr = rp - Math.floor(rp), i1 = (i0 + 1) % len; return buf[i0] * (1 - fr) + buf[i1] * fr; };
  let ph = 0, wi = 0;
  for (let i = 0; i < n; i++) {
    ph += w; if (ph >= 2 * Math.PI) ph -= 2 * Math.PI;
    bl[wi] = L[i]; br[wi] = R[i];
    const dL = 2 + (0.5 + 0.5 * Math.sin(ph)) * depth * (maxD - 4);
    const dR = 2 + (0.5 + 0.5 * Math.sin(ph + 1.2)) * depth * (maxD - 4);
    L[i] = L[i] * dry + rd(bl, wi, dL) * wet; R[i] = R[i] * dry + rd(br, wi, dR) * wet;
    wi = (wi + 1) % len;
  }
}

// Freeverb-style reverb applied in place to stereo buffers. 8 parallel damped
// combs + 4 series allpass per channel; the right channel's delays are stretched
// (stereospread) to decorrelate the two channels -> a wide, deep tail.
function reverbProcess(L, R, size, tone, wet) {
  const n = L.length;
  const fb = 0.7 + size * 0.28;         // room size -> comb feedback (0.7..0.98)
  const damp = (1 - tone) * 0.4;        // tone -> high-freq damping in the tail
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const spread = 23;
  const fixedGain = 0.015;
  const src = [Float32Array.from(L), Float32Array.from(R)];
  const dst = [L, R];
  for (let c = 0; c < 2; c++) {
    const off = c === 1 ? spread : 0;
    const combBuf = combT.map(len => new Float32Array(len + off));
    const combIdx = combT.map(() => 0);
    const combLP = combT.map(() => 0);
    const apBuf = apT.map(len => new Float32Array(len + off));
    const apIdx = apT.map(() => 0);
    const dry = src[c], out = dst[c];
    for (let i = 0; i < n; i++) {
      const input = dry[i] * fixedGain;
      let mono = 0;
      for (let k = 0; k < combBuf.length; k++) {
        const buf = combBuf[k], idx = combIdx[k];
        const y = buf[idx];
        combLP[k] = y * (1 - damp) + combLP[k] * damp;   // lowpass in feedback path
        buf[idx] = input + combLP[k] * fb;
        combIdx[k] = idx + 1 === buf.length ? 0 : idx + 1;
        mono += y;
      }
      for (let k = 0; k < apBuf.length; k++) {
        const buf = apBuf[k], idx = apIdx[k];
        const bufout = buf[idx];
        const y = bufout - mono;
        buf[idx] = mono + bufout * 0.5;
        apIdx[k] = idx + 1 === buf.length ? 0 : idx + 1;
        mono = y;
      }
      out[i] = dry[i] + wet * mono;
    }
  }
}

// ── Share-link codec ─────────────────────────────────────────────────────────────────────────
// decodePatch lives HERE, not in index.html, so the bundle can carry it (see EXPORTS in
// tools/export-synth.py). A consumer that accepts a CrunchySFX share link needs to decode it, and
// hand-copying six lines of codec into a sibling repo is exactly the drift that gave CrunchyVFX an
// SFX_DEFAULTS table with 25 of 106 params. The payload is version-tagged (`v`), so the day this
// grows a v2 branch, every consumer gets it by re-pulling rather than by remembering to.
//
// Returns the raw payload { v, s: <diff against PARAMS defaults>, n?: normalize, t?: title }.
// Its counterpart encodePatch stays in index.html on purpose: it reads the app's `state` and the
// current label, so it is not pure and could never be exported.
function decodePatch(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const obj = JSON.parse(atob(b64));
  if (!obj || typeof obj.s !== "object") throw new Error("unrecognized link");
  return obj;
}
