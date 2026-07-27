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
// The "pass-by" gesture: turbulent noise through a bandpass whose CENTRE FREQUENCY and AMPLITUDE
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
  const fcBase = 300 * Math.pow(13, tone);          // ~300 Hz (dull) .. ~3.9 kHz (sharp) band centre
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

// ---------- Master finishing stage ----------
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
