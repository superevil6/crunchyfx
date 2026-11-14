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

// PEAK CONTROL for the struck keys, the piano's `pianoPeak` and the bar's `barPeak` (0-2; 2026-11-14, AJ: "the peak
// control for the piano and bell engines is a good idea"). Exactly gunLevel's / mlPeakControl's: the note (a MONO
// buffer, the engine's output before the chain, built by synth.js only when the control is on) is brought to a 0.9 peak
// and run through the app's own lookahead limiter (limiterProcess) at min(peak, 1); past 1 it is brought back to 0.9
// and limited again at peak - 1. The limiter is stereo, so the mono note runs as two equal channels and keeps one.
// Then it goes back to the ENGINE'S OWN PEAK: the newer engines end on their own RMS level, but these two never had
// one, so with Normalize off the strike stays where it always was and only the ring under it comes up (and a Peak
// near 0 is the note it always was). In place.
function keyPeakControl(X, peak) {
  const n = X.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(X[i]); if (a > pk) pk = a; }
  if (pk < 1e-9 || !(peak > 0)) return;
  const Y = new Float64Array(n);
  const g0 = 0.9 / pk;
  for (let i = 0; i < n; i++) X[i] *= g0;
  Y.set(X); limiterProcess(X, Y, Math.min(1, peak));
  if (peak > 1) {
    let p2 = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(X[i]); if (a > p2) p2 = a; }
    const g1 = 0.9 / Math.max(1e-9, p2);
    for (let i = 0; i < n; i++) X[i] *= g1;
    Y.set(X); limiterProcess(X, Y, Math.min(1, peak - 1));
  }
  let p3 = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(X[i]); if (a > p3) p3 = a; }
  if (p3 > 1e-12) { const g2 = pk / p3; for (let i = 0; i < n; i++) X[i] *= g2; }
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

// ---------- Chirp (wave "chirp", #27): birdsong and insects ----------
// Birds and insects were plain oscillators (Bird Chirp a sine, Cricket Chirp a square). A bird has no vocal tract like
// a mammal's: a SYRINX makes near-pure whistles with very fast pitch gestures, organized into syllables and phrases,
// sometimes two independent voices at once. A cricket is STRIDULATION: a near-pure carrier gated into wing-stroke
// pulses grouped into chirps. Prototyped in tools/proto/chirp.mjs and picked by ear (AJ, 2026-11-10: "literally every
// chirp is perfect"); this block is that model, renamed into the shared scope (chirp*), with no change to its maths.
//
//   syllable scheduler (count per group, groups, rate, accel, gap, drift, randomness, a chorus of individuals)
//     |-> syrinx        a phase-accumulated sine on a pitch GESTURE (whistle, up, down, arch, dip, warble, chip), weak
//     |                 2nd/3rd harmonic, optional SECOND VOICE on the mirrored gesture
//     |-> stridulation  a carrier gliding a little down through each wing stroke, `rasp` blending in tooth strikes
//     |                 (each an analytic gammatone grain at the carrier): cricket .. katydid
//     '-> buzz          (ignores the scheduler) a wingbeat harmonic buzz flying past: Doppler, 1/r, air absorption
//   each individual: distance -> gain + air absorption (an analog low-pass gain per partial) -> pan; sum; peak to 0.85.
//
// Built up front into a stereo buffer (like makeBubbles) and read per sample. Seeded by the patch's own `chirpSeed`
// (a sound's "which take"), never Math.random. ANTI-ALIASING: every partial is computed from its instantaneous
// frequency and faded out between 0.40 and 0.46 of the rate; each syllable starts at its exact fractional time and its
// phase integrates by the trapezoid rule, so it renders the same signal at any rate (the prototype's alias check, a
// 44.1 vs 176.4 kHz render, reads -54 to -89 dB against -12 for a signal that does alias).
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function chirpCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  return {
    "mode": Math.round(g("chirpMode", 0)), "pitch": g("chirpPitch", 3200), "gesture": Math.round(g("chirpGesture", 1)), "span": g("chirpSpan", 0.6),
    "rate": Math.max(0.5, g("chirpRate", 8)), "duty": g("chirpDuty", 0.6), "count": Math.max(1, Math.round(g("chirpCount", 3))),
    "groups": Math.max(0, Math.round(g("chirpGroups", 1))), "groupGap": g("chirpGroupGap", 0.25), "accel": g("chirpAccel", 0), "drift": g("chirpDrift", 0),
    "rand": g("chirpRand", 0.2), "harm": g("chirpHarm", 0.15), "voice2": g("chirpVoice2", 0), "interval": g("chirpInterval", 5), "rasp": g("chirpRasp", 0),
    "chorus": Math.max(1, Math.round(g("chirpChorus", 1))),
    // the song stops early enough to leave a reverb, convolution or echo 0.7 s to ring out (as the prototype's chain
    // padded every take it was heard through), so a call is never cut off by its own room; at most half the sound, so a
    // short call with a room still sounds
    "ring": (g("reverb", 0) > 0 || g("convMix", 0) > 0 || g("delay", 0) > 0) ? 0.7 : 0,
  };
}
function chirpRng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const chirpMix = (seed, k) => ((seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0) || 1;
const chirpEdge = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * x));   // raised-cosine edge

// a partial's gain by its instantaneous frequency: 1 below 0.40 sr, 0 above 0.46 sr, a cosine between
// `air` (Hz, optional) is distance: the ANALOG one-pole low-pass magnitude at f, applied per partial, so a far animal is
// duller with no discrete filter in the path (a one-pole filter discretizes differently at each rate; this does not)
function chirpTap(f, sr, air) {
  const a = 0.40 * sr, b = 0.46 * sr, t = f <= a ? 1 : f >= b ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (f - a) / (b - a));
  return air ? t / Math.sqrt(1 + (f / air) * (f / air)) : t;
}

// the pitch gesture of one syllable, as octaves from its center, u = 0..1 through the syllable
function chirpTraj(g, u, span, cyc, ph) {
  switch (g) {
    case 0: return u < 0.7 ? 0.02 * span * u : 0.02 * span * 0.7 - span * 0.25 * Math.pow((u - 0.7) / 0.3, 2);   // whistle: held, falls off at the end
    case 1: return span * (0.5 - 0.5 * Math.cos(Math.PI * u) - 0.5);       // up-slur
    case 2: return -span * (0.5 - 0.5 * Math.cos(Math.PI * u) - 0.5);      // down-slur
    case 3: return span * (Math.sin(Math.PI * u) - 0.5);                   // arch: up and over
    case 4: return -span * (Math.sin(Math.PI * u) - 0.5);                  // dip
    case 5: return span * 0.5 * Math.sin(2 * Math.PI * cyc * u + ph);      // warble
    case 6: return span * (0.5 - (1 - Math.pow(1 - u, 3)));                // chip: a steep fall, fastest at the start (finite slope: an infinite one splatters)
    default: return 0;
  }
}
const CHIRP_MIRROR = [1, 2, 1, 4, 3, 5, 6];   // the second voice's gesture: the other side of the syrinx moves the other way
// per-gesture habits, used when the gesture is "Mixed phrase": [rate x, length x, count x, attack frac, release frac]
const CHIRP_HABIT = [[0.3, 0.85, 0.34, 0.2, 0.35], [1, 1, 1, 0.15, 0.3], [1, 1, 1, 0.12, 0.35], [0.8, 1, 0.8, 0.15, 0.3],
  [0.8, 1, 0.8, 0.15, 0.3], [0.45, 0.9, 0.5, 0.15, 0.3], [1.6, 0.45, 1.5, 0.06, 0.6]];

// one individual's syllable plan: [{ t, len, g, c, span, amp, cyc, ph }]
function chirpSchedule(cfg, rnd, durSec, start, pm, rm) {
  const ev = [], R = cfg.rand, mixed = cfg.gesture === 7, end = durSec - Math.min(cfg.ring || 0, durSec / 2) - 0.015;
  const total = cfg.groups > 0 ? cfg.groups * cfg.count : 0;
  let t = start, gi = 0, kg = 0, prevG = -1;
  while (t < end && (cfg.groups === 0 || gi < cfg.groups)) {
    let g = cfg.gesture, rateX = 1, lenX = 1, cnt = cfg.count, oct = (rnd() * 2 - 1) * 0.06 * R, gspan = cfg.span;
    if (mixed) {
      // a song has a GRAMMAR: it opens slow (a whistle or an up-slur), develops, and ends on a flourish (a fall,
      // a warble or chips). Groups 0 ("keep going") read every fourth group as a new song.
      const last = cfg.groups > 0 ? cfg.groups - 1 : 3, pos = cfg.groups > 0 ? gi : gi % 4;
      const pool = pos === 0 ? [0, 1] : pos === last ? [2, 5, 6] : [1, 2, 3, 4, 5, 6];
      do { g = pool[Math.floor(rnd() * pool.length)]; } while (g === prevG && pool.length > 1);
      const h = CHIRP_HABIT[g]; rateX = h[0]; lenX = h[1];
      cnt = Math.max(1, Math.round(cfg.count * h[2] * (0.7 + 0.6 * rnd())));
      oct = (rnd() * 2 - 1) * 0.35 * (0.4 + R); gspan = cfg.span * (0.6 + 0.8 * rnd());
    }
    prevG = g;
    let last = null;
    for (let k = 0; k < cnt; k++) {
      const rk = cfg.rate * rm * rateX * Math.pow(2, cfg.accel * (cnt > 1 ? k / (cnt - 1) : 0)), period = 1 / rk;
      const len = Math.max(0.006, Math.min(period * 0.98, cfg.duty * period * lenX * (1 + (rnd() * 2 - 1) * 0.2 * R)));
      if (t + len > end) break;
      const prog = total > 1 ? kg / (total - 1) : cnt > 1 ? k / (cnt - 1) : 0.5;
      const c = cfg.pitch * pm * Math.pow(2, oct + cfg.drift * (prog - 0.5) + (rnd() * 2 - 1) * 0.06 * R);
      const amp = Math.pow(10, (rnd() * 2 - 1) * R * 3 / 20);
      const cyc = Math.max(1, len * (18 + 14 * rnd())), ph = rnd() * 2 * Math.PI;
      last = { t, len, g, c, span: gspan, amp, cyc, ph, h: CHIRP_HABIT[g] || CHIRP_HABIT[1] };
      ev.push(last);
      t += period * (1 + (rnd() * 2 - 1) * 0.15 * R); kg++;
    }
    if (!last) break;
    t = last.t + last.len + cfg.groupGap * (1 + (rnd() * 2 - 1) * 0.3 * R);
    gi++;
  }
  return ev;
}

// Both syllable voices start at the event's EXACT time (the first sample at or after it, with local time measured from
// the true start), so a syllable is the same continuous signal at any sample rate — what lets the alias check compare
// a 44.1 kHz render to a 176.4 kHz one sample-for-sample-in-spirit rather than through rounding jitter.
function chirpSpanOf(out, sr, e) {
  const i0 = Math.ceil(e.t * sr), i1 = Math.min(out.length, Math.ceil((e.t + e.len) * sr));
  return { i0, i1, N: i1 - i0 };
}

function chirpSyrinx(out, sr, e, cfg, rnd) {
  const { i0, i1, N } = chirpSpanOf(out, sr, e);
  if (N < 8) return;
  const a = Math.max(e.h[3], 0.0015 / e.len), r = Math.max(e.h[4], 0.002 / e.len);
  const h2 = cfg.harm * 0.22, h3 = cfg.harm * 0.09, v2 = cfg.voice2, ratio2 = Math.pow(2, cfg.interval / 12), g2 = CHIRP_MIRROR[e.g] ?? 1;
  const TAU = 6.283185307179586;
  let p1 = rnd() * TAU, p2 = rnd() * TAU, prev = e.t, fp1 = -1, fp2 = -1;   // phases integrate by the trapezoid rule (rate-robust on fast slurs)
  for (let i = i0; i < i1; i++) {
    const tl = i / sr - e.t, u = tl / e.len, dt = i / sr - prev; prev = i / sr;
    const shape = chirpEdge(u / a) * chirpEdge((1 - u) / r);
    const f = e.c * Math.pow(2, chirpTraj(e.g, u, e.span, e.cyc, e.ph));
    p1 += TAU * 0.5 * (f + (fp1 < 0 ? f : fp1)) * dt; fp1 = f; if (p1 > TAU) p1 -= TAU;
    const lv = Math.sqrt(shape);   // harmonics grow with the push (louder = a little richer)
    let y = shape * (chirpTap(f, sr, e.air) * Math.sin(p1) + lv * (h2 * chirpTap(2 * f, sr, e.air) * Math.sin(2 * p1) + h3 * chirpTap(3 * f, sr, e.air) * Math.sin(3 * p1)));
    if (v2 > 0) {   // the other side of the syrinx: its own pitch, mirrored gesture, a little late
      const u2 = (u - 0.12) / 0.88, shape2 = u2 <= 0 ? 0 : chirpEdge(u2 / a) * chirpEdge((1 - u2) / r);
      const f2 = e.c * ratio2 * Math.pow(2, chirpTraj(g2, Math.max(0, u2), e.span * 0.8, e.cyc * 0.8, e.ph + 1.3));
      p2 += TAU * 0.5 * (f2 + (fp2 < 0 ? f2 : fp2)) * dt; fp2 = f2; if (p2 > TAU) p2 -= TAU;
      y += v2 * shape2 * chirpTap(f2, sr, e.air) * (Math.sin(p2) + h2 * 0.5 * chirpTap(2 * f2, sr, e.air) * Math.sin(2 * p2));
    }
    out[i] += e.amp * y / (1 + 0.6 * v2);
  }
}

function chirpStridulate(out, sr, e, cfg, rnd) {
  const { i0, i1, N } = chirpSpanOf(out, sr, e);
  if (N < 8) return;
  const a = Math.max(0.15, 0.001 / e.len), r = Math.max(0.3, 0.002 / e.len), rasp = cfg.rasp, TAU = 6.283185307179586;
  const h2 = cfg.harm * 0.1, h3 = cfg.harm * 0.04;
  // the rasp: tooth strikes, each a GRAIN — a gammatone (order 4: a sinusoid at the carrier under t^3 e^(-t/tau), tau set
  // by the resonance's bandwidth) placed at its exact time and computed analytically. It is the same signal at any
  // sample rate, and its skirt is ~70 dB down by Nyquist, so nothing folds.
  const buf = rasp > 0 ? new Float64Array(N) : null;
  if (buf) {
    const bw = e.c * (0.06 + 0.45 * rasp), tau = 1 / (2 * Math.PI * bw * 0.4), life = 14 * tau, gnorm = 1 / (27 * Math.exp(-3));
    const toothHz = e.c / (5 + 6 * rasp);
    for (let tt = 0; tt < e.len; tt += (1 / toothHz) * (1 + (rnd() * 2 - 1) * 0.25 * (0.3 + cfg.rand))) {
      const fc = Math.min(0.4 * sr, e.c * Math.pow(2, -e.span * tt / e.len)), amp = (0.5 + rnd() * (0.5 + cfg.rand)) * chirpTap(fc, sr, e.air);
      const k0 = Math.max(0, Math.ceil((e.t + tt) * sr) - i0), k1 = Math.min(N, Math.ceil((e.t + tt + life) * sr) - i0);
      for (let k = k0; k < k1; k++) {
        const dt = (i0 + k) / sr - e.t - tt, x = dt / tau;
        if (x > 0) buf[k] += amp * gnorm * x * x * x * Math.exp(-x) * Math.sin(TAU * fc * dt);
      }
    }
    // normalized by RMS to a unit sine's (rate-robust, where a sampled peak is not), at the carrier's own air gain
    let ss = 0; for (let k = 0; k < N; k++) ss += buf[k] * buf[k];
    const rms = Math.sqrt(ss / N), ref = chirpTap(e.c, sr, e.air) * Math.sqrt(0.5);
    if (rms > 0) for (let k = 0; k < N; k++) buf[k] *= ref / rms;
  }
  let p = rnd() * TAU, prev = e.t, fp = -1;
  for (let k = 0; k < N; k++) {
    const i = i0 + k, u = (i / sr - e.t) / e.len, dt = i / sr - prev; prev = i / sr;
    const env = chirpEdge(u / a) * chirpEdge((1 - u) / r) * (0.55 + 0.45 * u) * e.amp;
    const f = e.c * Math.pow(2, -e.span * u);   // the wing closes: the carrier glides a little down
    p += TAU * 0.5 * (f + (fp < 0 ? f : fp)) * dt; fp = f; if (p > TAU) p -= TAU;
    const tone = chirpTap(f, sr, e.air) * Math.sin(p) + h2 * chirpTap(2 * f, sr, e.air) * Math.sin(2 * p) + h3 * chirpTap(3 * f, sr, e.air) * Math.sin(3 * p);
    out[i] += env * (buf ? (1 - rasp) * tone + rasp * buf[k] : tone);
  }
}

// a wingbeat buzz flying past: Doppler (span = octaves of shift at the ends), 1/r level, air absorption, pan
function chirpBuzz(L, R, sr, cfg, seed) {
  const n = L.length, rnd = chirpRng(seed), dur = n / sr, R0 = cfg.rand;
  // a slow random walk (nodes every 1/25 s, so the draws are per SECOND, not per sample)
  const nodes = Math.ceil(dur * 25) + 3, wf = new Float64Array(nodes), wa = new Float64Array(nodes);
  let vf = 0, va = 0;
  for (let k = 0; k < nodes; k++) { vf = 0.85 * vf + (rnd() * 2 - 1) * 0.5; va = 0.8 * va + (rnd() * 2 - 1) * 0.5; wf[k] = vf; wa[k] = va; }
  const W = 1.5 + 2 * rnd(), dir = rnd() < 0.5 ? -1 : 1, tilt = 1.6 - 0.9 * cfg.harm;
  const KMAX = Math.floor(0.46 * sr / (cfg.pitch * Math.pow(2, -Math.abs(cfg.span)) * 0.8)) + 2, wk = new Float64Array(KMAX + 1);
  for (let k = 1; k <= KMAX; k++) wk[k] = Math.pow(k, -tilt);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = dir * (t / dur - 0.5) * 2 * W, rr = Math.sqrt(1 + x * x), xr = x / rr;
    const q = t * 25, k0 = Math.floor(q), fr = q - k0, wob = wf[k0] * (1 - fr) + wf[k0 + 1] * fr, amw = wa[k0] * (1 - fr) + wa[k0 + 1] * fr;
    const f = cfg.pitch * Math.pow(2, -cfg.span * dir * xr * 0.5 + wob * 0.05 * (0.3 + R0));
    ph += 2 * Math.PI * f / sr; if (ph > 6.283185307179586) ph -= 6.283185307179586;
    // the harmonic series by the sine recurrence, k^-tilt, faded below Nyquist
    const K = Math.min(KMAX, Math.floor(0.46 * sr / f)), c2 = 2 * Math.cos(ph);
    let s1 = Math.sin(ph), s0 = 0, y = 0;
    const fcA = 2500 + 9000 / rr;   // closer = brighter (air absorption by distance)
    for (let k = 1; k <= K; k++) { y += s1 * wk[k] * chirpTap(k * f, sr, fcA); const s = c2 * s1 - s0; s0 = s1; s1 = s; }
    const amp = (1 / rr) * (1 + amw * 0.25 * (0.3 + R0)) * chirpEdge(t / 0.03) * chirpEdge((dur - t) / 0.03);
    const lp = y * amp;
    const pan = xr * 0.7, pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    L[i] += lp * pl; R[i] += lp * pr;
  }
}

/* makeChirp(sr, n, cfg, seed) -> { L, R, events }
 *   sr    sample rate (44100 in the app; anything, for the alias check)
 *   n     length in samples (the patch's duration)
 *   cfg   chirpCfg(st)
 *   seed  integer
 * events: the plan (seconds, Hz) of every syllable/pulse, per individual, for measurement. */
function makeChirp(sr, n, cfg, seed) {
  const L = new Float32Array(n), R = new Float32Array(n), events = [];
  if (n < 16) return { L, R, events };
  if (cfg.mode === 2) chirpBuzz(L, R, sr, cfg, seed);
  else {
    const C = cfg.chorus, durSec = n / sr, one = new Float64Array(n);
    // one cycle of the song (a group and its gap), so a chorus can be spread across it (rand) or held together (rand ~ 0)
    const cycle = cfg.count / cfg.rate + cfg.groupGap;
    for (let c = 0; c < C; c++) {
      const rnd = chirpRng(chirpMix(seed, c));
      const pm = c === 0 ? 1 : Math.pow(2, (rnd() * 2 - 1) * 0.12);                  // individuals differ in pitch...
      // ...and in tempo and timing, both by `rand`: near 0 the chorus holds together (tree crickets synchronize), at
      // ~0.3 and up every individual keeps its own time
      const rm = c === 0 ? 1 : 1 + (rnd() * 2 - 1) * 0.15 * cfg.rand;
      const start = 0.005 + (c === 0 ? 0 : rnd() * cycle * Math.pow(Math.min(1, cfg.rand * 3), 2) + rnd() * 0.003);
      const dist = c === 0 ? 0 : 0.25 + 0.75 * rnd(), pan = c === 0 ? 0 : (rnd() * 2 - 1) * 0.9;
      const ev = chirpSchedule(cfg, rnd, durSec, start, pm, rm), air = dist > 0 ? 16000 * Math.pow(0.18, dist) : 0;
      for (const e of ev) e.air = air;
      one.fill(0);
      // each syllable draws from its OWN generator, so a sample-count rounding inside one (a tooth more or less) cannot
      // shift the draws of every syllable after it — the same sound at any sample rate
      ev.forEach((e, k) => (cfg.mode === 1 ? chirpStridulate : chirpSyrinx)(one, sr, e, cfg, chirpRng(chirpMix(chirpMix(seed, c), 1000 + k))));
      const gain = 1 / (1 + 2.5 * dist);
      const pl = Math.cos((pan + 1) * Math.PI / 4) * Math.sqrt(2), pr = Math.sin((pan + 1) * Math.PI / 4) * Math.sqrt(2);
      for (let i = 0; i < n; i++) { const v = one[i] * gain; L[i] += v * pl; R[i] += v * pr; }
      events.push(ev.map((e) => ({ t: e.t, len: e.len, g: cfg.mode === 1 ? -1 : e.g, c: e.c, span: e.span, who: c })));
    }
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk > 1e-9) { const g = 0.85 / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
  return { L, R, events: events.flat() };
}

// ---------- Creature voice (wave "creature", #28): a larynx and a moving vocal tract ----------
// The Animal / Monster presets were the formant engine: a perfectly steady saw through three bandpasses holding ONE
// vowel. An animal call is a TRAJECTORY (a meow is the mouth opening then closing while the pitch rises then falls; a
// moo is a closed nasal hum opening into "oo") and its source is a larynx, not an oscillator. Prototyped in
// tools/proto/creature.mjs and picked by ear in all five rounds (AJ, 2026-11-10); this block is that model, renamed
// into the shared scope (creature*), with two engineering changes and no change to its maths:
//   - the tract's coefficients are recomputed every CREATURE_CTL samples rather than every sample (they follow the
//     call's trajectories, which move over tenths of a second; up to 26 resonators each needed an exp and a cos);
//   - a LEVEL CALIBRATION (creatureLevel): the call is rendered once at the note's pitch and brought to a fixed RMS,
//     capped by its peak, so a creature preset does not depend on Normalize (the prototype's takes did).
//
//   call shape u = 0..1 -> pitch (start / peak / end semitones about the note, the peak at crPeak), mouth openness
//                          (start / peak / end) and vowel (front "ee" .. back "oo", start -> end)
//   GLOTTIS  a Rosenberg flow-derivative pulse, its closure step polyBLEP-corrected (band-limited at a kitten's 1 kHz);
//            per-PERIOD jitter and shimmer; roughness = period-2 alternation -> period doubling -> logistic-map chaos;
//            tension = open quotient + source tilt; aspiration noise riding the open phase
//   TRACT    a Klatt cascade: a nasal pole/zero pair (identical, so it cancels exactly, while the nose is shut), F1-F3
//            following openness and vowel, then the tract's neutral resonances every ~1000 Hz up to the band edge,
//            all scaled by body size; closing the mouth widens the upper bandwidths, lowers the level and closes a lip
//            low-pass, so "m" is a muffled nasal hum. A parallel aspiration branch stated against the voice's level.
//   then the rattle (an AM with a wandering rate) and a DC blocker. Mono.
const CREATURE_CTL = 16;        // samples between tract coefficient updates (0.36 ms)
const CREATURE_RMS = 0.2;       // the level a call is brought to (its RMS over the call, the envelope aside)
const CREATURE_PEAK = 0.85;     // ...unless that would take its peak past this
const CREATURE_NF = 24;         // the most cascade formants a long tract gets (a cow's or a monster's)
const creatureClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const creatureEase = (x) => 0.5 - 0.5 * Math.cos(Math.PI * creatureClamp(x, 0, 1));
// start -> peak (at pos) -> end in raised-cosine segments: no corner in the pitch or the mouth
function creatureShape(u, a, p, b, pos) {
  pos = creatureClamp(pos, 0.02, 0.98);
  return u < pos ? a + (p - a) * creatureEase(u / pos) : p + (b - p) * creatureEase((u - pos) / (1 - pos));
}
// knobs -> the model (keys quoted: the exporter's app-global scan reads a bare key as a name)
function creatureCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  return {
    "fScale": 1 / creatureClamp(g("crSize", 1), 0.2, 4),
    "pS": g("crPitchStart", 0), "pE": g("crPitchEnd", 0), "peak": g("crPeak", 0.4),
    "oS": g("crOpenStart", 0.5), "oP": g("crOpenPeak", 0.5), "oE": g("crOpenEnd", 0.5),
    "vS": g("crVowelStart", 0.5), "vE": g("crVowelEnd", 0.5),
    "nasal": g("crNasal", 0), "tension": g("crTension", 0.5),
    "jitter": g("crJitter", 0), "shimmer": g("crShimmer", 0), "rough": g("crRough", 0), "breath": g("crBreath", 0),
    "flutter": g("crFlutter", 0), "flutterRate": g("crFlutterRate", 20),
  };
}
// The next call in a burst (shot idx > 0): a touch lower each time, a little different, never the first one again.
// Returns { cfg, semi } (semi = the shot's pitch offset, semitones). Shot 0 is the call as written.
function creatureShot(cfg, idx, seed) {
  if (idx <= 0) return { "cfg": cfg, "semi": 0 };
  let s = ((seed ^ Math.imul(idx, 0x9e3779b1)) >>> 0) || 1;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const semi = r() * 2 * (0.4 + cfg.jitter) - 0.6 * idx, c = Object.assign({}, cfg);
  c.oP = creatureClamp(cfg.oP * (1 + r() * 0.2), 0, 1);
  return { "cfg": c, "semi": semi };
}
// One voice (one call). tick(u, f): u = the position in the call (>= 1: the source stops, the tract rings out), f = the
// note's pitch at this sample (fOsc: freq, sweep and vibrato already applied). One mono sample, unscaled.
function makeCreature(sr, cfg, seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };   // 0..1
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;                                             // ~N(0, 1)
  const sub = creatureClamp(cfg.rough * 2, 0, 1), chaos = creatureClamp(cfg.rough * 2 - 1, 0, 1);
  const oqBase = 0.8 - 0.45 * cfg.tension;                       // open quotient: soft 0.8 .. pressed 0.35
  const SQ = 2.4;                                                // speed quotient (opening / closing)
  const tiltA = Math.exp(-2 * Math.PI * (1200 + 9000 * cfg.tension * cfg.tension) / sr);   // source tilt one-pole
  let ph = 0, k = 0, logi = 0.31 + 0.4 * rnd(), perScale = 1, ampScale = 1, oq = oqBase;
  const newPeriod = () => {
    k++;
    logi = 3.97 * logi * (1 - logi); if (logi <= 0 || logi >= 1) logi = 0.37;
    const m = (k & 1 ? 1 : -1) * (1 - chaos) + (2 * logi - 1) * chaos;      // period-2 alternation -> chaos
    perScale = creatureClamp(1 + m * (0.035 * sub + 0.2 * chaos) + gauss() * cfg.jitter * 0.045, 0.6, 1.6);
    ampScale = Math.max(0.05, (1 + m * (0.5 * sub + 0.4 * chaos)) * (1 + gauss() * cfg.shimmer * 0.3));
    oq = creatureClamp(oqBase + gauss() * 0.08 * chaos, 0.25, 0.88);
  };
  newPeriod();
  let tilt = 0, nHp = 0, nPrev = 0;
  // the cascade (Klatt 1980 resonator: y = A x + B y1 + C y2, unity gain at DC): slot 0 the nasal pole, 1..NF the
  // formants, NF + 1 the parallel aspiration branch, NF + 2 the nasal ZERO (an antiresonator, the pole's inverse, kept in
  // the same arrays so it is ramped by exactly the same arithmetic: equal to the pole, it cancels it to the bit).
  // Targets are computed every CREATURE_CTL samples and the coefficients RAMP to them sample by sample: held in steps
  // instead, a 48-pole cascade turned each step into a transient (measured: a 1.2 RMS voice read 5.5 with spikes of 173).
  const NF = CREATURE_NF, NR = NF + 3, ZI = NF + 2;
  const y1 = new Float64Array(NR), y2 = new Float64Array(NR), cA = new Float64Array(NR), cB = new Float64Array(NR), cC = new Float64Array(NR);
  const tA = new Float64Array(NR), tB = new Float64Array(NR), tC = new Float64Array(NR);
  const dA = new Float64Array(NR), dB = new Float64Array(NR), dC = new Float64Array(NR);
  const coef = (i, F, BW) => {
    const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr);
    tA[i] = 1 - B - C; tB[i] = B; tC[i] = C;
  };
  const res = (i, x) => { const y = cA[i] * x + cB[i] * y1[i] + cC[i] * y2[i]; y2[i] = y1[i]; y1[i] = y; return y; };
  let zx1 = 0, zx2 = 0;
  let nForm = 0, la = 0, lvl = 1, laT = 0, lvlT = 1, dla = 0, dlvl = 0, lip = 0, dcx = 0, dcy = 0, flPh = 0, ctl = 0, first = true;
  const NYQ = 0.45 * sr;
  const FTOP = 0.95 * NYQ;   // one per line: the exporter's declaration scan reads only the first name of `const A, B`
  const fs = cfg.fScale, bwS = Math.sqrt(fs);
  let folV = 0; const folA = 1 - Math.exp(-1 / (0.015 * sr));
  return {
    tick(u, f) {
      const live = u < 1, uu = creatureClamp(u, 0, 1);
      // ---- the call's trajectories
      const semis = creatureShape(uu, cfg.pS, 0, cfg.pE, cfg.peak);
      const f0 = Math.max(20, f * Math.pow(2, semis / 12));
      // ---- the tract's targets, at control rate (reached by the ramp below: 0.36 ms late, which nothing can hear)
      if (ctl-- <= 0) {
        ctl = CREATURE_CTL - 1;
        const open = creatureClamp(creatureShape(uu, cfg.oS, cfg.oP, cfg.oE, cfg.peak), 0, 1);
        const back = creatureClamp(cfg.vS + (cfg.vE - cfg.vS) * creatureEase(uu), 0, 1);
        const F1 = (260 + 560 * open - 40 * back) * fs;
        const F2 = ((2250 - 450 * open) * (1 - back) + (780 + 420 * open) * back) * fs;
        const F3 = (2950 - 450 * back - 150 * open) * fs;
        const shut = 1 - open, wide = 1 + 2 * shut * shut;
        const bfl = 0.11 * f0;                              // high f0: a single harmonic must not ring alone
        const nas = creatureClamp(cfg.nasal * Math.pow(shut, 1.3) * 1.4, 0, 1);
        const FNP = 270 * fs, nbw = Math.max(100 * bwS, bfl);
        coef(0, Math.min(FNP, NYQ), nbw);
        coef(ZI, Math.min(FNP * (1 + 1.6 * nas), NYQ), nbw * (1 + nas));
        // F1-F3 articulate; above them the tract's neutral resonances every ~1000 Hz (scaled) up to the band edge: a big
        // animal has MORE formants, not fewer (a fixed five left a cow with nothing above 2 kHz)
        let prevF = 0; nForm = 0;
        for (let i = 0; i < NF; i++) {
          let Fi = i === 0 ? F1 : i === 1 ? F2 : i === 2 ? F3 : (3600 + 1000 * (i - 3)) * fs;
          Fi = Math.max(Fi, prevF + 150 * fs); prevF = Fi;
          if (Fi >= FTOP) break;                             // a small animal's top formants leave the band
          const Bi = i === 0 ? 70 : (i === 1 ? 90 : i === 2 ? 130 : 200 + 60 * (i - 3)) * wide;
          coef(1 + i, Fi, Math.max(Bi * bwS, bfl)); nForm++;
        }
        const Fa = Math.min(Math.max(F3, 1800), FTOP);
        coef(NF + 1, Fa, 0.8 * Fa);
        const lipFc = Math.min(NYQ, (1000 + 9000 * Math.pow(open, 0.8)) * Math.sqrt(fs));
        laT = Math.exp(-2 * Math.PI * lipFc / sr);
        lvlT = Math.max(0.1 + 0.9 * Math.pow(open, 0.7), 0.6 * nas);
        if (first) {
          first = false; cA.set(tA); cB.set(tB); cC.set(tC); la = laT; lvl = lvlT;
          dA.fill(0); dB.fill(0); dC.fill(0); dla = 0; dlvl = 0;
        } else {
          const r = 1 / CREATURE_CTL;
          for (let i = 0; i < NR; i++) { dA[i] = (tA[i] - cA[i]) * r; dB[i] = (tB[i] - cB[i]) * r; dC[i] = (tC[i] - cC[i]) * r; }
          dla = (laT - la) * r; dlvl = (lvlT - lvl) * r;
        }
      }
      for (let i = 0; i < NR; i++) { cA[i] += dA[i]; cB[i] += dB[i]; cC[i] += dC[i]; }
      la += dla; lvl += dlvl;
      // ---- glottis
      const dt = Math.min(0.45, f0 / (sr * perScale));
      ph += dt;
      if (ph >= 1) { ph -= 1; newPeriod(); }
      const Tp = oq * SQ / (1 + SQ), Tn = oq / (1 + SQ);
      let g = 0;
      if (ph < Tp) g = (Tn / Tp) * Math.sin(Math.PI * ph / Tp);
      else if (ph < oq) g = -Math.sin(Math.PI * (ph - Tp) / (2 * Tn));
      let tr = ph - oq; if (tr < 0) tr += 1;
      g += 0.5 * polyBlep(tr, dt);                       // the closure: a +1 step, band-limited
      g *= ampScale;
      tilt = (1 - tiltA) * g + tiltA * tilt;
      const voiced = 0.35 * g + 0.65 * tilt * 2.2;       // keep some top, lose some with a soft voice
      const nz = rnd() * 2 - 1;
      nHp = nz - nPrev; nPrev = nz;                       // aspiration: first-difference (bright) noise
      const gate = ph < oq ? 1 : 0.35;                   // turbulence rides the open phase
      const asp = nHp * cfg.breath * (0.25 + 0.6 * gate) * (0.6 + 0.4 * ampScale);
      let x = (voiced + asp) * (live ? 1 : 0);
      // ---- the tract
      x = res(0, x);
      { const z = (x - cB[ZI] * zx1 - cC[ZI] * zx2) / cA[ZI]; zx2 = zx1; zx1 = x; x = z; }
      let y = x;
      for (let i = 1; i <= nForm; i++) y = res(i, y);
      // Klatt's PARALLEL branch for turbulence, at a level stated against the voice (a follower on the cascade): breath
      // is a ratio, a hiss over a big dark voice rather than noise the low formants filter down to nothing
      folV += (Math.abs(y) - folV) * folA;
      if (cfg.breath > 0) y += res(NF + 1, nHp * (0.35 + 0.65 * gate) * (live ? 1 : 0)) * cfg.breath * 3.5 * folV;
      // ---- the lips: level and a low-pass both close with the mouth; the nose keeps a hum alive when it is shut
      lip = (1 - la) * y + la * lip;
      let out = lip * lvl;
      // ---- the rattle (a growl's flutter, a trilled "rr"), its rate wandering so it is not a tremolo
      if (cfg.flutter > 0) {
        flPh += cfg.flutterRate * (1 + 0.25 * gauss()) / sr; if (flPh >= 1) flPh -= 1;
        out *= 1 - cfg.flutter * (0.5 + 0.5 * Math.sin(2 * Math.PI * flPh));
      }
      const dc = out - dcx + 0.9975 * dcy; dcx = out; dcy = dc;
      return dc;
    },
  };
}
// The gain that brings one call (the cfg as shot 0 plays it, at the note's pitch f0, over callSec) to CREATURE_RMS,
// capped so its peak stays under CREATURE_PEAK. A creature preset then sounds at its own level with Normalize off, as
// brass's tuning does for a note. Cached for the session: a re-render of the same sound costs nothing the second time.
const CREATURE_LEVEL = new Map();
function creatureLevel(sr, cfg, f0, callSec, seed) {
  const key = JSON.stringify(cfg) + "|" + f0.toFixed(4) + "|" + callSec.toFixed(5) + "|" + seed;
  const hit = CREATURE_LEVEL.get(key); if (hit) return hit;
  const N = Math.max(16, Math.round(callSec * sr)), v = makeCreature(sr, cfg, seed);
  let ss = 0, pk = 0;
  for (let i = 0; i < N; i++) { const y = v.tick(i / N, f0); ss += y * y; const a = Math.abs(y); if (a > pk) pk = a; }
  const rms = Math.sqrt(ss / N), g = rms > 1e-9 ? Math.min(CREATURE_RMS / rms, CREATURE_PEAK / pk) : 1;
  if (CREATURE_LEVEL.size > 64) CREATURE_LEVEL.clear();
  CREATURE_LEVEL.set(key, g);
  return g;
}

// ---------- Weather (wave "weather", #29): wind, rain and thunder ----------
// The Nature presets were a sine plus filtered noise. Prototyped in tools/proto/weather.mjs and picked by ear (AJ,
// 2026-11-10: the engine won all five rounds, soundtests/proto-weather/); this block is that model, unchanged in its
// maths, with its knobs mapped from the patch by weatherCfg.
//   WIND    turbulence: noise in a band whose CENTER and LEVEL follow the wind speed (the amp envelope, times a seeded
//           Poisson gust curve and a flutter), low buffeting under it, and up to three WHISTLES: narrow resonators on
//           noise whose pitch is proportional to the speed (an edge tone, f = St v / d), sounding only past a gust
//           threshold. Their base pitch is the patch's Frequency.
//   RAIN    Poisson drops (the envelope scales the rate) with exponential (Marshall-Palmer) sizes, spread over a disc so
//           most are far, quiet and dull; each hits a SURFACE: a hard click (big drops splatter), a leaf's two damped
//           modes, or water's soft slap and a Minnaert bubble a few ms later (f0 = 3.26/r, rising as it rings); a hiss
//           bed and a low roar under them.
//   THUNDER a tortuous, branched channel grown in metres; each 12 m segment's N-wave arrives at distance / 343 m/s,
//           strong when the segment lies broadside to the listener, smeared and weak when it points at them; low-passed
//           by distance (air absorption); metre-scale kinks add the crackle. The arrivals' physical spread is
//           compressed to `roll` seconds (order and clustering kept). The envelope is its gain.
// Built up front into a stereo buffer like the chirps (thunder needs the whole bolt before the first sample), with the
// amp envelope passed in as the DRIVE (so render's gain stage skips it, as for brass). Seeded by the patch's own
// `wxSeed` ("which take"), never Math.random; not salted per layer, like chirpSeed. weatherLevel brings the buffer to
// a fixed loudness so the three types sit together with Normalize off.
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function weatherCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  return {
    "type": Math.round(g("wxType", 0)), "intensity": g("wxIntensity", 0.7), "tone": g("wxTone", 0.5), "width": g("width", 0.4),
    "body": g("wxBody", 0.3), "gustiness": g("wxGust", 0.5), "gustRate": g("wxGustRate", 0.8), "whistle": g("wxWhistle", 0),
    "whistles": Math.round(g("wxWhistles", 2)), "pitch": g("freq", 440), "whistleQ": g("wxWhistleQ", 60),
    "density": g("wxDensity", 300), "drop": g("wxDrop", 1.2), "surface": Math.round(g("wxSurface", 0)), "hiss": g("wxHiss", 0.5),
    "bubbles": g("wxBubbles", 0.7), "ring": g("wxRing", 1), "sheets": g("wxSheets", 0), "sheetRate": 0.8, "spread": g("wxSpread", 12),
    "distance": g("wxDistance", 2), "roll": g("wxRoll", 1.6), "kind": Math.round(g("wxBolt", 0)), "pulseMs": g("wxPulse", 4),
    "crackle": g("wxCrackle", 0.5), "height": g("wxHeight", 2500), "cloudLen": g("wxLength", 2500),
  };
}
const WX_BED = 0.065;           // the rain bed's level against the drops (calibrated: see the round's 'drops' share')
// a ringing surface puts more energy in each drop than a click does, so its bed is scaled to keep the same balance
const WX_BED_SURF = [1, 6, 6];
function wxRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function wxGauss(rnd) { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// value noise with cosine interpolation: a smooth random curve at about `hz` changes a second, range ±1
function wxSmooth(sr, hz, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = rnd();
  const inc = hz / sr;
  return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } const u = 0.5 - 0.5 * Math.cos(Math.PI * ph); return a + (b - a) * u; };
}
// TPT state-variable filter (Simper). tick returns the band output; .lp / .hp hold the others. k = 1/Q.
function wxSvf() { return { ic1: 0, ic2: 0, lp: 0, hp: 0 }; }
function wxSvfTick(f, x, g, k) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const v3 = x - f.ic2, v1 = a1 * f.ic1 + a2 * v3, v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
  f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2; f.lp = v2; f.hp = x - k * v1 - v2;
  return v1;
}
const wxG = (fc, sr) => Math.tan(Math.PI * Math.min(Math.max(fc, 5), sr * 0.45) / sr);
// unit-RMS makeup for uniform white noise (variance 1/3) through a unit-peak band of quality Q at fc
const wxBandMakeup = (fc, Q, sr) => Math.sqrt(3 * Q * sr / (Math.PI * Math.max(fc, 5)));
const wxPan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// ---------------------------------------------------------------- WIND
function wxWind(sr, c, rnd) {
  const inten = c.intensity, gusty = c.gustiness, rate = Math.max(0.05, c.gustRate), tone = c.tone, width = c.width;
  const fLo = 110 * Math.pow(2, tone * 1.6), fHi = 1100 * Math.pow(2, tone * 2.2);   // the band's center, calm -> gale
  const white = () => rnd() * 2 - 1;
  const flutter = wxSmooth(sr, 4 + gusty * 8, rnd), panDrift = wxSmooth(sr, 0.3, rnd);
  const tL = wxSvf(), tR = wxSvf(), bL = wxSvf(), bR = wxSvf();
  const bodyMk = Math.sqrt(3 * sr / (2 * 1.11 * 130));
  const W = [];
  const ratios = [1, 1.37 + 0.1 * rnd(), 1.83 + 0.15 * rnd()];
  for (let i = 0; i < Math.round(c.whistles); i++) {
    W.push({ f0: c.pitch * ratios[i] * (1 + 0.03 * (rnd() - 0.5)), th: 0.42 + 0.12 * i + 0.06 * rnd(), pan: (rnd() * 2 - 1) * 0.6 * width,
      flt: wxSvf(), wob: wxSmooth(sr, 1.5 + rnd() * 2, rnd), lvl: 0 });
  }
  const gusts = [];
  const info = { type: "wind", gusts: 0, samples: 0, whistleOnSamples: 0, speedMax: 0, speedSum: 0, whistleE: 0, allE: 0 };
  let t = 0, next = Math.floor(sr * 0.02);
  const out = {
    info,
    tick(drive, o) {
      while (t >= next) {   // a new gust: Poisson arrivals, never closer than a third of the mean spacing
        const rise = sr * (0.15 + 0.2 * rnd()) / rate, fall = rise * (1.0 + 0.8 * rnd());
        gusts.push({ t0: t, rise, fall, amp: 0.3 + 0.7 * rnd(), pan: rnd() * 2 - 1 });
        info.gusts++;
        next += Math.floor(sr / rate * (0.33 - 0.67 * Math.log(Math.max(1e-6, rnd()))));
      }
      let sum = 0, pAcc = 0;
      for (let i = gusts.length - 1; i >= 0; i--) {
        const g = gusts[i], tau = t - g.t0;
        if (tau > g.rise + g.fall * 8) { gusts.splice(i, 1); continue; }
        const b = g.amp * (tau < g.rise ? 0.5 - 0.5 * Math.cos(Math.PI * tau / g.rise) : Math.exp(-(tau - g.rise) / g.fall));
        sum += b; pAcc += b * g.pan;
      }
      const G = 1 - Math.exp(-2.2 * sum);                                          // gust strength 0..1
      const rel = (1 - gusty) * 0.8 + gusty * (0.1 + 0.9 * G * Math.sqrt(G));                   // gusty air eases off between gusts
      let s = drive * inten * rel * (1 + gusty * 0.16 * flutter());
      if (s < 0) s = 0; else if (s > 1.2) s = 1.2;
      info.samples++; info.speedSum += s; if (s > info.speedMax) info.speedMax = s;
      // turbulence: a wide band whose center climbs with the speed, level ~ speed^1.6, plus edge hiss in the strongest air
      const fc = fLo * Math.pow(fHi / fLo, Math.min(1, s)), g = wxG(fc, sr), k = 1 / 0.9, mk = wxBandMakeup(fc, 0.9, sr);
      const nl = white(), nr = white();
      const yl = wxSvfTick(tL, nl, g, k) * k * mk, yr = wxSvfTick(tR, nr, g, k) * k * mk;
      const air = 0.35 * Math.pow(Math.max(0, s - 0.5), 2) * (0.5 + tone);
      const a = 0.45 * Math.pow(s, 1.6);
      let L = a * yl + air * tL.hp, R = a * yr + air * tR.hp;
      // body: low buffeting, shaken by the flutter
      if (c.body > 0) {
        const gb = wxG(130, sr), kb = Math.sqrt(2), fb = 1 + 0.7 * flutter();
        wxSvfTick(bL, white(), gb, kb); wxSvfTick(bR, white(), gb, kb);
        const ab = c.body * 0.5 * Math.pow(s, 1.3) * fb;
        L += ab * bL.lp * bodyMk; R += ab * bR.lp * bodyMk;
      }
      // whistles: narrow resonators on noise; pitch ~ speed (edge tone), gated by the gust
      let on = false;
      for (const w of W) {
        const f = w.f0 * (0.6 + 0.65 * Math.min(1.1, s)) * (1 + 0.012 * w.wob());
        let gate = (s - w.th) / 0.18; gate = gate <= 0 ? 0 : gate >= 1 ? 1 : gate * gate * (3 - 2 * gate);
        w.lvl += (gate - w.lvl) * (40 / sr);                                       // the edge tone locks in, it doesn't switch
        const y = wxSvfTick(w.flt, white(), wxG(f, sr), 1 / c.whistleQ) / c.whistleQ * wxBandMakeup(f, c.whistleQ, sr);
        const amp = c.whistle * 0.3 * w.lvl * (0.5 + s);
        if (w.lvl > 0.1) on = true;
        const [pl, pr] = wxPan(w.pan);
        L += amp * y * pl; R += amp * y * pr; info.whistleE += amp * amp * y * y / 2;
      }
      info.allE += (L * L + R * R) / 2;
      if (on) info.whistleOnSamples++;
      // the gust's place in the field drifts
      const p = Math.max(-1, Math.min(1, (sum > 1e-6 ? pAcc / sum : 0) * 0.45 * width + 0.3 * width * panDrift()));
      const [pl, pr] = wxPan(p);
      o[0] = L * pl * Math.sqrt(2); o[1] = R * pr * Math.sqrt(2);
      t++;
    },
  };
  return out;
}

// ---------------------------------------------------------------- RAIN
function wxRain(sr, c, rnd) {
  const width = c.width, surf = Math.round(c.surface), white = () => rnd() * 2 - 1;
  const voices = [];
  const hL = wxSvf(), hR = wxSvf(), rL = wxSvf(), rR = wxSvf(), hpL = wxSvf(), hpR = wxSvf();
  const sheet = wxSmooth(sr, c.sheetRate, rnd), shimmer = wxSmooth(sr, 0.7, rnd);
  const hissFc = 2500 * Math.pow(2.6, c.tone), g = wxG(hissFc, sr), gh = wxG(350, sr), gr = wxG(320, sr);
  const info = { type: "rain", drops: 0, bubbles: 0, samples: 0, dropE: 0, bedE: 0, maxVoices: 0 };
  const exp = (x) => Math.exp(x);
  function spawn() {
    let D = -c.drop * Math.log(Math.max(1e-6, 1 - rnd()));                       // Marshall-Palmer: exponential sizes
    D = Math.max(0.25, Math.min(4.5, D));
    const rr = 1.5 + c.spread * Math.sqrt(rnd());                                  // uniform over a disc: most drops are far
    const lpA = 1 - Math.exp(-2 * Math.PI * Math.min(18000, 15000 / Math.pow(rr, 0.55) * (0.6 + 0.8 * c.tone)) / sr);
    const [pl, pr] = wxPan((rnd() * 2 - 1) * width);
    const amp = Math.pow(D, 1.3) / rr;
    const v = { age: 0, amp, pl, pr, lp: 0, lpA, e1: 0, m1: 0, b0: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0,
      e2: 0, m2: 0, modes: null, bub: null };
    const bp = (fc, Q) => { const w0 = 2 * Math.PI * Math.min(fc, 0.45 * sr) / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
      v.b0 = al / a0; v.a1 = -2 * Math.cos(w0) / a0; v.a2 = (1 - al) / a0; };
    if (surf === 0) {            // HARD: a sharp click, brighter the smaller the drop; big drops splatter
      bp(3200 * Math.pow(1.5 / D, 0.6) * (0.7 + 0.6 * rnd()), 1.3);
      v.e1 = 1; v.m1 = exp(-1 / (sr * (0.0004 + 0.00035 * D)));
      if (D > 1.6) { v.e2 = 0.12 * (D - 1.6); v.m2 = exp(-1 / (sr * (0.008 + 0.012 * rnd()))); }
    } else if (surf === 1) {     // LEAF: a soft click into two damped plate modes: a papery tap
      bp(2500, 1); v.e1 = 0.4; v.m1 = exp(-1 / (sr * 0.0003));
      const f1 = 420 * (1 + 3 * rnd()) * Math.pow(1.2 / D, 0.3), tau = 0.004 + 0.008 * rnd();
      const w1 = 2 * Math.PI * f1 / sr, w2 = 2 * Math.PI * f1 * (1.5 + 0.9 * rnd()) / sr;   // each mode a rotating phasor
      v.modes = [{ cs: 1, sn: 0, cw: Math.cos(w1), sw: Math.sin(w1), a: 0.8, e: 1, m: exp(-1 / (sr * tau)) },
                 { cs: 1, sn: 0, cw: Math.cos(w2), sw: Math.sin(w2), a: 0.45, e: 1, m: exp(-1 / (sr * tau * 0.6)) }];
    } else {                     // WATER: a soft slap, and (for some drops) a Minnaert bubble a few ms later
      bp(1400 * (0.7 + 0.6 * rnd()), 0.8); v.e1 = 0.45; v.m1 = exp(-1 / (sr * (0.0005 + 0.0003 * D)));
      const pB = c.bubbles * (D > 0.8 && D < 1.3 ? 1 : 0.45);                     // regular entrainment window ~0.8-1.2 mm
      if (rnd() < pB) {
        const rb = Math.max(0.3, Math.min(3, D * (0.3 + 0.9 * rnd()))) * 1e-3;  // bubble radius (m)
        const f0 = 3.26 / rb, d = (0.13 / rb + 0.0072 * Math.pow(rb, -1.5)) / Math.max(0.2, c.ring);
        v.bub = { at: Math.floor(sr * (0.001 + 0.002 * D * rnd())), f0, d, ph: 0, e: 0.9 * Math.sqrt(rb * 1e3), m: exp(-d / sr), t: 0 };
        info.bubbles++;
      }
    }
    voices.push(v); info.drops++;
  }
  return {
    info,
    tick(drive, o) {
      const sh = c.sheets > 0 ? Math.max(0, 1 + c.sheets * sheet()) : 1;          // wind-driven sheets of rain
      const lam = c.density * drive * sh;
      if (rnd() < lam / sr) spawn();
      if (lam / sr > 1 && rnd() < lam / sr - 1) spawn();
      let L = 0, R = 0;
      // (Ported for speed, the sound unchanged: the noise burst and its band stop being computed once both have died away,
      // a leaf's modes are rotating phasors rather than a sine per sample, and a finished drop is swapped out rather
      // than spliced. Heavy rain on leaves holds ~190 drops at once; this took it from 0.66 s to a fraction of that.)
      for (let i = voices.length - 1; i >= 0; i--) {
        const v = voices[i];
        let y = 0, alive = false;
        const ex = v.e1 + v.e2;
        if (ex > 1e-5 || v.y1 > 1e-7 || v.y1 < -1e-7) {
          const x = ex > 1e-5 ? white() * ex : 0;
          y = v.b0 * (x - v.x2) - v.a1 * v.y1 - v.a2 * v.y2; v.x2 = v.x1; v.x1 = x; v.y2 = v.y1; v.y1 = y;
          if (v.e2 > 1e-5) y += white() * v.e2 * 0.6;                                 // the splash is broadband
          v.e1 *= v.m1; v.e2 *= v.m2;
          alive = v.e1 > 1e-4 || v.e2 > 1e-4;
        }
        if (v.modes) for (const m of v.modes) {
          y += m.a * m.e * m.sn;
          const cs = m.cs * m.cw - m.sn * m.sw; m.sn = m.sn * m.cw + m.cs * m.sw; m.cs = cs;
          m.e *= m.m; if (m.e > 1e-4) alive = true;
        }
        if (v.bub) {
          const b = v.bub;
          if (v.age >= b.at) {
            const tb = b.t / sr;
            b.ph += 2 * Math.PI * b.f0 * (1 + 0.1 * b.d * tb) / sr;                // the rising chirp
            y += b.e * Math.sin(b.ph); b.e *= b.m; b.t++;
          }
          if (b.e > 1e-4) alive = true;
        }
        v.lp += (y - v.lp) * v.lpA;                                                // farther drops are duller
        const s = v.lp * v.amp; L += s * v.pl; R += s * v.pr;
        v.age++;
        if (!alive || v.age > sr) { voices[i] = voices[voices.length - 1]; voices.pop(); }
      }
      if (voices.length > info.maxVoices) info.maxVoices = voices.length;
      info.dropE += L * L + R * R;
      // the bed: the drops too many and too far to hear one by one
      const bedA = c.hiss * WX_BED * WX_BED_SURF[surf] * Math.sqrt(Math.max(0, lam) / 300) * (1 + 0.15 * shimmer());
      wxSvfTick(hL, white(), g, 0.9); wxSvfTick(hR, white(), g, 0.9);
      wxSvfTick(hpL, hL.lp, gh, 1.2); wxSvfTick(hpR, hR.lp, gh, 1.2);
      let bl = bedA * hpL.hp * 2.2, br = bedA * hpR.hp * 2.2;
      if (c.body > 0) {                                                            // the low roar of a downpour
        const ar = c.body * WX_BED * WX_BED_SURF[surf] * Math.sqrt(Math.max(0, lam) / 300) * (1 + 0.3 * shimmer());
        wxSvfTick(rL, white(), gr, Math.sqrt(2)); wxSvfTick(rR, white(), gr, Math.sqrt(2));
        bl += ar * rL.lp * 8; br += ar * rR.lp * 8;
      }
      info.bedE += bl * bl + br * br; info.samples++;
      o[0] = L + bl; o[1] = R + br;
    },
  };
}

// ---------------------------------------------------------------- THUNDER
function wxThunder(sr, c, rnd) {
  const C = 343, ls = 12, tort = 0.2, pull = 0.1;   // ~16 deg kinks per 12 m, a weak pull to the leader's heading
  const segs = [];
  const norm = (v) => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
  function grow(p, dir, len, e, depth, down, zLock) {
    let d = dir.slice();
    const h0 = dir.slice();
    for (let s = 0; s < len / ls; s++) {
      d = norm([d[0] + tort * wxGauss(rnd) + pull * h0[0], d[1] + tort * wxGauss(rnd) + pull * h0[1], d[2] + tort * wxGauss(rnd) * (zLock ? 0.4 : 1) + pull * h0[2] - down]);
      if (zLock) d = norm([d[0], d[1], d[2] + (zLock - p[2]) * 0.0015]);         // in-cloud: wander at its height
      const q = [p[0] + d[0] * ls, p[1] + d[1] * ls, p[2] + d[2] * ls];
      if (q[2] <= 0) { q[2] = 0; }
      segs.push({ m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], u: d, e: e * Math.exp(0.45 * wxGauss(rnd)) });
      p = q;
      if (p[2] <= 0) break;
      if (depth < 2 && rnd() < 0.012) {
        const bd = norm([d[0] + 1.2 * wxGauss(rnd), d[1] + 1.2 * wxGauss(rnd), d[2] + 0.3 * wxGauss(rnd)]);
        grow(p.slice(), bd, len * (0.1 + 0.25 * rnd()), e * 0.35, depth + 1, down * 0.5, zLock);
      }
    }
  }
  const H = c.height;
  if (Math.round(c.kind) === 0) {        // cloud to ground, plus the in-cloud part it came from
    grow([0, 0, H], [0, 0, -1], H * 3, 1, 0, 0.22, 0);
    const a = rnd() * 2 * Math.PI;
    grow([0, 0, H], [Math.cos(a), Math.sin(a), 0], c.cloudLen, 0.55, 1, 0, H);
  } else {                                // in-cloud / cloud to cloud: a long horizontal channel, no ground strike
    const a = rnd() * 2 * Math.PI;
    grow([-Math.cos(a) * c.cloudLen / 2, -Math.sin(a) * c.cloudLen / 2, H], [Math.cos(a), Math.sin(a), 0], c.cloudLen, 1, 0, 0, H);
  }
  const az = (rnd() - 0.5) * 0.6, D = c.distance * 1000, lis = [D * Math.cos(az), D * Math.sin(az), 1.6];
  // arrivals
  const arr = [];
  let dMin = Infinity, dMax = 0;
  for (const s of segs) {
    const v = [lis[0] - s.m[0], lis[1] - s.m[1], lis[2] - s.m[2]], d = Math.hypot(v[0], v[1], v[2]);
    const cos = Math.abs((v[0] * s.u[0] + v[1] * s.u[1] + v[2] * s.u[2]) / d);
    const T = c.pulseMs / 1000 * Math.pow(d / 1000, 0.25) * (0.7 + 0.6 * rnd()) + 0.0004 * d / 1000; // stretch + scatter
    // a segment along the line of sight smears its pulse over ls*cos/c: it arrives weaker (energy spread in time). Only
    // part of that is a LONGER pulse, because sub-segment kinks keep the emission from being one coherent line source.
    const smear = ls * cos / C, tot = 2 * T + 0.3 * smear;
    // the side of the bolt it comes from: listener faces the strike (-x)
    const side = (lis[1] - s.m[1]) / Math.hypot(lis[0] - s.m[0], lis[1] - s.m[1]);
    arr.push({ d, tot, a: s.e * Math.pow(1000 / d, 1.1) * (2 * T / (2 * T + smear)), side, cr: s.e * Math.pow(1000 / d, 1.1) });
    if (d < dMin) dMin = d; if (d > dMax) dMax = d;
  }
  const spread = (dMax - dMin) / C, kT = spread > c.roll ? c.roll / spread : 1;
  const pre = Math.floor(0.03 * sr), maxTot = arr.reduce((m, a) => Math.max(m, a.tot), 0);
  const n = pre + Math.ceil((spread * kT + maxTot) * sr) + Math.floor(0.6 * sr);
  // distance bands, each low-passed for its distance (air absorption)
  const NB = 7, bands = [];
  for (let b = 0; b < NB; b++) bands.push({ L: new Float32Array(n), R: new Float32Array(n) });
  const lnMin = Math.log(dMin), lnSpan = Math.max(1e-6, Math.log(dMax) - lnMin);
  for (const a of arr) {
    const b = Math.min(NB - 1, Math.floor((Math.log(a.d) - lnMin) / lnSpan * NB));
    const at = pre + Math.floor(((a.d - dMin) / C) * kT * sr), N = Math.max(4, Math.round(a.tot * sr));
    const [pl, pr] = wxPan(Math.max(-1, Math.min(1, a.side * c.width)));
    const BL = bands[b].L, BR = bands[b].R;
    for (let k = 0; k < N && at + k < n; k++) {
      let v = 1 - 2 * k / N;                                                       // the N: a jump up, a ramp down, a jump back
      if (k === 0) v *= 0.5;
      BL[at + k] += a.a * v * pl; BR[at + k] += a.a * v * pr;
    }
    // CRACKLE: the channel's fine (metre-scale) kinks inside this segment, each a tiny N-wave of a fraction of a ms,
    // scattered over the segment's arrival window. Their highs are what the air absorbs first, so they only survive
    // from the near part of a close bolt: the crack.
    const nm = Math.round(c.crackle * 6 * rnd());
    for (let q = 0; q < nm; q++) {
      const st = at + Math.floor(rnd() * Math.max(1, N)), M = Math.max(3, Math.round(sr * (0.00015 + 0.0005 * rnd())));
      const am = a.cr * c.crackle * (0.3 + 0.7 * rnd()) * (rnd() < 0.5 ? -1 : 1);
      for (let k = 0; k < M && st + k < n; k++) { const v = am * (1 - 2 * k / M); BL[st + k] += v * pl; BR[st + k] += v * pr; }
    }
  }
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let b = 0; b < NB; b++) {
    const dB = Math.exp(lnMin + (b + 0.5) / NB * lnSpan);
    const fc = Math.min(16000, 3500 * Math.pow(1000 / dB, 0.8) * (0.5 + c.tone));
    const al = 1 - Math.exp(-2 * Math.PI * fc / sr);
    for (const [src, dst] of [[bands[b].L, L], [bands[b].R, R]]) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < n; i++) { s1 += (src[i] - s1) * al; s2 += (s1 - s2) * al; dst[i] += s2; }
    }
  }
  const info = { type: "thunder", segments: segs.length, dMin, dMax, physSpread: spread, roll: spread * kT, compress: kT, bufSec: n / sr };
  let i = 0;
  return {
    info,
    tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } },
  };
}

function makeWeather(sr, cfg, seed) {
  const c = cfg;
  const rnd = wxRng(seed);
  const t = Math.round(c.type);
  return t === 1 ? wxRain(sr, c, rnd) : t === 2 ? wxThunder(sr, c, rnd) : wxWind(sr, c, rnd);
}

// The whole sound: n samples, the drive (the amp envelope) read per sample from driveAt(i).
function weatherBuffer(sr, n, cfg, seed, driveAt) {
  const w = makeWeather(sr, cfg, seed), L = new Float32Array(n), R = new Float32Array(n), o = [0, 0];
  for (let i = 0; i < n; i++) { w.tick(driveAt(i), o); L[i] = o[0]; R[i] = o[1]; }
  return { L, R, info: w.info };
}
// Bring a weather buffer to WX_RMS (over the samples that sound), its peak capped at WX_PEAK: rain is peaky, thunder
// peakier, wind smooth, so one target in RMS keeps the three types near one loudness with Normalize off. In place.
const WX_RMS = 0.12;
const WX_PEAK = 0.9;
function weatherLevel(L, R) {
  const n = L.length; let ss = 0, pk = 0, on = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]), m = a > b ? a : b;
    if (m > pk) pk = m;
    if (m > 1e-5) { ss += L[i] * L[i] + R[i] * R[i]; on++; }
  }
  if (!on || pk < 1e-9) return;
  const rms = Math.sqrt(ss / (2 * on)), g = Math.min(WX_RMS / rms, WX_PEAK / pk);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ---------- Motor (wave "motor", #30): engines, rotors and steam, as trains of firing events ----------
// The Machine presets built vehicles on generic oscillators (Car Engine a saw, Helicopter an impact, Train a sine).
// Prototyped in tools/proto/motor.mjs and picked by ear (AJ, 2026-11-10: the engine won all five rounds,
// soundtests/proto-motor/); this block is that model, unchanged in its maths, with its knobs mapped from the patch by
// motorCfg.
//   rpm(t), load(t) -> a CYCLE PHASE -> firing events: per cylinder (four-stroke: rpm x cyl / 120 a second; two-stroke:
//   rpm x cyl / 60), per rotor blade, or per steam chuff (cyl chuffs per wheel turn). Each cylinder has a fixed level
//   (Lope: a V8's banks, a twin's, a locomotive's chuff-a-chuff) and timing (Uneven: a V-twin's 315/405 degrees), plus
//   jitter, misfires (a two-stroke "four-strokes" when unloaded) and overrun POPS when the throttle shuts. Each event
//   is a smooth x^2 e^-x PULSE with a sub-sample onset (band-limited) and a NOISE BURST (combustion, blade slap, chuff),
//   through a quarter-wave EXHAUST PIPE (a lossy waveguide, -refl at the open end: odd resonances at c/4L) and a
//   MUFFLER low-pass that opens with load plus a load-driven RASP band; then a tail-rotor buzz, rail CLACKS in pairs
//   (three metal modes), a WHINE locked to the crank (blower, gearbox, turbine) and band AIR noise (intake, rotor wash,
//   steam hiss). LOAD (the throttle) sets each firing's level and sharpness, the muffler and the air, so a rev up barks
//   and a let-off goes soft and pops: the character change is the mechanism's, not an envelope's.
// THE RPM CURVE is the engine's own rows (motorCurveKf): idle -> at `motorAt` the throttle opens and the rpm rises to
// `motorPeak` over `motorRise` (eased out: an engine gets most of a rev early), holds `motorHold`, the throttle shuts and
// it falls to `motorEnd` over `motorFall`, then idles. `motorRevs` repeats the rev every `motorRevGap` s, each starting
// from wherever the last one had got to (a dirt bike's ring-ding); 0 revs = a steady engine at `motorIdle`. The amp
// envelope stays the GAIN, as for any oscillator. Built up front into a mono buffer like the chirps, seeded by the
// patch's own `motorSeed` ("which take"), not salted per layer; motorLevel brings it to a fixed loudness.
const MOTOR_C_AIR = 343;        // m/s: the pipe's length -> its round trip
const MOTOR_G_NORM = 1 / (4 * Math.exp(-2));   // x^2 e^-x peaks at 4e^-2 (x = 2): this brings it to 1
// the level pattern a Lope of 1 draws from, per cylinder: a cross-plane V8's banks heard from one side (L R R L R L L R),
// any other engine's alternate cylinders, a two-cylinder locomotive's four chuffs (one beat in four strongest)
const MOTOR_LOPE_V8 = [0, 1, 1, 0, 1, 0, 0, 1];
const MOTOR_LOPE_ALT = [0, 1];
const MOTOR_LOPE_STEAM = [0, 0.84, 0.32, 1];
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function motorCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  const type = Math.round(g("motorType", 0)), n = Math.max(1, Math.round(g("motorCyl", 4)));
  const lope = g("motorLope", 0), unev = g("motorUneven", 0), tail = g("motorTail", 0), clack = g("motorClack", 0);
  let cylAmp = null;   // null: the hashed Imbalance spread (the model draws it)
  if (lope > 0) {
    const pat = type === 3 ? MOTOR_LOPE_STEAM : n === 8 ? MOTOR_LOPE_V8 : MOTOR_LOPE_ALT;
    cylAmp = [];
    for (let i = 0; i < n; i++) cylAmp.push(1 - lope * pat[i % pat.length]);
  }
  const firing = [];
  for (let i = 0; i < n; i++) firing.push(i / n - (i % 2 ? unev * 0.5 / n : 0));
  return {
    "type": type, "cyl": n, "firing": firing, "cylAmp": cylAmp, "imbalance": g("motorImbalance", 0.15),
    "rough": g("motorRough", 0.2), "wander": g("motorWander", 0.3),
    "pulseMs": g("motorPulse", 0.9), "pulseAmp": g("motorThump", 1),
    "burstMs": g("motorBurstMs", 1), "burstAmp": g("motorBurst", 0.35), "burstHz": g("motorBurstHz", 2500),
    "burstQ": type === 2 ? 0.8 : type === 3 ? 0.7 : 0.9,
    "pipeLen": g("motorPipe", 1.4), "pipeRefl": g("motorPipeRing", 0.55), "pipeDamp": g("motorPipeDamp", 0.3), "pipeMix": type === 2 ? 0 : 1,
    "toneHz": g("motorTone", 1600), "rasp": g("motorRasp", 0.55), "raspHz": g("motorRaspHz", 1700),
    "air": g("motorAir", 0.08), "airHz": g("motorAirHz", 1500), "whine": g("motorWhine", 0), "whineMul": g("motorWhineRatio", 3),
    "pops": g("motorPops", 0.15),
    "tail": tail > 0 ? { "mul": g("motorTailRatio", 5.2), "blades": 2, "amp": tail, "pulseMs": 1 } : null,
    "clack": clack > 0 ? { "amp": clack, "perRev": g("motorClackRate", 0.42), "gapSec": 0.19 } : null,
    "curve": {
      "idle": g("motorIdle", 900), "peak": g("motorPeak", 5800), "end": g("motorEnd", 950), "at": g("motorAt", 0.2),
      "rise": g("motorRise", 0.45), "hold": g("motorHold", 0.1), "fall": g("motorFall", 0.6),
      "revs": Math.round(g("motorRevs", 1)), "gap": g("motorRevGap", 0.6),
      "idleLoad": g("motorIdleLoad", 0.25), "revLoad": g("motorRevLoad", 1), "offLoad": g("motorOffLoad", 0.05),
    },
  };
}
// the rpm/load curve as keyframes [t, rpm, load]
function motorCurveKf(c) {
  const kf = [[0, c.idle, c.idleLoad]];
  for (let k = 0; k < c.revs; k++) {
    const ta = c.at + k * c.gap, here = motorCurveAt(kf, ta);
    while (kf.length && kf[kf.length - 1][0] >= ta) kf.pop();   // a rev cuts the last one's fall short, from where it got to
    kf.push([ta, here.rpm, here.load]);
    const t2 = ta + Math.max(0.01, c.rise), t3 = t2 + c.hold, t4 = t3 + Math.max(0.031, c.fall);
    kf.push([t2, c.peak, c.revLoad], [t3, c.peak, c.revLoad], [t3 + 0.03, c.peak * 0.985, c.offLoad], [t4, c.end, c.offLoad], [t4 + 0.15, c.end, c.idleLoad]);
  }
  return kf;
}
// rpm eases OUT on every segment (most of a rev change early, then a creep); load is linear (the model smooths it)
function motorCurveAt(kf, t) {
  if (t <= kf[0][0]) return { rpm: kf[0][1], load: kf[0][2] };
  for (let k = 1; k < kf.length; k++) {
    if (t <= kf[k][0]) {
      const a = kf[k - 1], b = kf[k], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]), e = 1 - Math.pow(1 - u, 2.2);
      return { rpm: a[1] + (b[1] - a[1]) * e, load: a[2] + (b[2] - a[2]) * u };
    }
  }
  const z = kf[kf.length - 1];
  return { rpm: z[1], load: z[2] };
}
function motorRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// TPT state-variable filter; coefficients only recomputed when fc/q move
function motorSvf(sr) {
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0, k = 1, lf = -1, lq = -1;
  const f = {
    lp: 0, bp: 0, hp: 0,
    set(fc, q) {
      if (fc === lf && q === lq) return;
      lf = fc; lq = q;
      const gg = Math.tan(Math.PI * Math.min(Math.max(fc, 10), sr * 0.45) / sr);
      k = 1 / q; a1 = 1 / (1 + gg * (gg + k)); a2 = gg * a1; a3 = gg * a2;
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
// the event shape: x^2 e^-x, peak 1 at x = 2. C1 at the onset, so with tau >= 0.15 ms its images sit ~90 dB down.
function motorShape(x) { return x <= 0 ? 0 : x * x * Math.exp(-x) * MOTOR_G_NORM; }
// A running engine. tick(rpm, load) -> one sample. rpm: crank (rotor, wheel) turns a minute; load 0..1: the throttle.
function makeMotor(sr, cfg, seed) {
  const rnd = motorRng(seed);
  const type = cfg.type | 0, stroke4 = type === 0;
  const n = Math.max(1, cfg.cyl | 0);
  const firing = cfg.firing || Array.from({ length: n }, (_, i) => i / n);
  const cylAmp = cfg.cylAmp || Array.from({ length: n }, () => 1 + (cfg.imbalance || 0) * (rnd() * 2 - 1) * 0.5);
  const rough = cfg.rough || 0, pops = cfg.pops || 0;
  const pulseAmp = cfg.pulseAmp ?? 1, burstAmp = cfg.burstAmp ?? 0;
  const misBase = type <= 1 ? rough * 0.05 : 0;
  // exhaust pipe: quarter-wave waveguide, D = the round trip
  const PIPE = 4096, pipe = new Float32Array(PIPE);
  const pipeD = Math.min(PIPE - 4, Math.max(2, (2 * (cfg.pipeLen || 1) / MOTOR_C_AIR) * sr));
  const pipeRefl = cfg.pipeRefl || 0, pipeDamp = cfg.pipeDamp ?? 0.3, pipeMix = cfg.pipeMix ?? (type === 2 ? 0 : 1);
  let pw = 0, plp = 0;
  const burstF = motorSvf(sr); burstF.set(cfg.burstHz || 1500, cfg.burstQ || 0.9);
  const toneF = motorSvf(sr), raspF = motorSvf(sr); raspF.set(cfg.raspHz || 1500, 2.5);
  const airF = motorSvf(sr); airF.set(cfg.airHz || 1200, 0.8);
  // clack metal: three damped modes
  const modes = [[640, 0.045], [1710, 0.028], [3150, 0.016]].map(([fm, t60]) => {
    const r = Math.exp(-6.9 / (t60 * sr)), th = 2 * Math.PI * fm / sr;
    return { c1: 2 * r * Math.cos(th), c2: -r * r, g: (1 - r * r), y1: 0, y2: 0 };
  });
  // streams: main firings, tail rotor, rail clacks. Each plans its next cycle at the wrap.
  const pulses = [];   // live events: { t0, tp, ap, tb, ab, v } (v: 0 main, 1 direct, 2 clack)
  const mkStream = (plan) => ({ ph: 0, fr: [], amp: [], idx: 0, plan });
  const main = mkStream((s, load) => {
    s.fr = []; s.amp = [];
    for (let i = 0; i < n; i++) {
      const sp = 1 / n, j = rough * 0.08 * sp * (rnd() * 2 - 1);
      let a = cylAmp[i % cylAmp.length] * (1 + rough * 0.35 * (rnd() * 2 - 1));
      const mis = misBase + (type === 1 ? rough * 0.3 * (1 - load) : 0);   // a two-stroke "four-strokes" when unloaded
      if (rnd() < mis) a *= 0.08;
      s.fr.push(Math.min(0.999, Math.max(0, firing[i] + j))); s.amp.push(a);
    }
  });
  const tail = cfg.tail ? mkStream((s) => { s.fr = []; s.amp = []; for (let i = 0; i < cfg.tail.blades; i++) { s.fr.push(i / cfg.tail.blades); s.amp.push(1 + 0.1 * (rnd() - 0.5)); } }) : null;
  const clack = cfg.clack ? mkStream((s, load, hz) => {
    const gp = Math.min(0.45, cfg.clack.gapSec * hz);   // the pair's spacing is a DISTANCE (axle to axle): a fraction of a shrinking period
    s.fr = [0.02, 0.02 + gp]; s.amp = [1, 0.75 + 0.15 * rnd()];
  }) : null;
  let wn = 0, wTarget = 0, wCount = 0, whPh = 0, loadS = cfg.load0 ?? 0.3, dcx = 0, dcy = 0, i = 0;
  const kLoad = 1 - Math.exp(-1 / (0.03 * sr)), kWn = 1 - Math.exp(-2 * Math.PI * 2.5 / sr);
  const dcK = Math.exp(-2 * Math.PI * 18 / sr);
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
  main.plan(main, loadS, 1); main.ph = 0.999; main.idx = n;   // the first cycle starts at once
  if (tail) { tail.plan(tail); tail.ph = 0.999; tail.idx = 99; }
  if (clack) { clack.plan(clack, 0, 1); clack.ph = 0.5; clack.idx = 2; }
  return {
    tick(rpm, load) {
      i++;
      loadS += (load - loadS) * kLoad;
      if (--wCount <= 0) { wTarget = rnd() * 2 - 1; wCount = (0.12 * sr) | 0; }
      wn += (wTarget - wn) * kWn;
      const r = Math.max(0, rpm * (1 + (cfg.wander || 0) * 0.035 * wn));
      const crankHz = r / 60, cycleHz = stroke4 ? crankHz / 2 : crankHz, evHz = cycleHz * n;
      // sharpness: the blowdown is a CRANK-ANGLE event, so it shortens as rpm rises, and sharpens under load
      const tauP = (cfg.pulseMs || 1) * 1e-3 * sr * Math.min(2.5, Math.sqrt(40 / Math.max(5, evHz))) * (1.25 - 0.45 * loadS);
      const tauB = (cfg.burstMs || 2) * 1e-3 * sr * Math.min(2, Math.sqrt(40 / Math.max(5, evHz)));
      const lvl = type >= 2 ? 0.55 + 0.45 * loadS : 0.22 + 0.78 * loadS;
      if (cycleHz > 0) advance(main, cycleHz / sr, loadS, cycleHz, (off, a) => {
        spawn(off, tauP, a * lvl * pulseAmp, tauB, a * lvl * burstAmp, 0);
        // overrun: a shut throttle lets unburnt mixture reach the hot pipe (the pop and crackle on a let-off)
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
        if (hz > 0) advance(clack, hz / sr, loadS, hz, (off, a) => { spawn(off, 0.22e-3 * sr, a * cfg.clack.amp, 1, 0, 2); });
      }
      // sum the live events
      let pm = 0, bm = 0, pd = 0, pc = 0;
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k], d = i - p.t0, xp = d / p.tp, xb = d / p.tb;
        if (xp > 30 && xb > 30) { pulses[k] = pulses[pulses.length - 1]; pulses.pop(); continue; }
        const vp = p.ap * motorShape(xp);
        if (p.v === 0) { pm += vp; bm += p.ab * motorShape(xb); } else if (p.v === 1) pd += vp; else pc += vp;
      }
      const noise = rnd() * 2 - 1;
      const burst = bm ? burstF.run(noise * bm) * 2 : burstF.run(0) * 2;
      const src = pm + burst;
      // the exhaust pipe (closed at the port, open at the tail: -refl a round trip, lossy)
      let rp = pw - pipeD; if (rp < 0) rp += PIPE;
      const i0 = rp | 0, fr = rp - i0, back = pipe[i0] * (1 - fr) + pipe[(i0 + 1) % PIPE] * fr;
      plp = (1 - pipeDamp) * back + pipeDamp * plp;
      const y = src - pipeRefl * plp;
      pipe[pw] = y; pw = (pw + 1) % PIPE;
      const body = pipeMix * y + (1 - pipeMix) * src + pd;
      // the muffler opens with load; the rasp is the load-driven bark band
      if ((i & 15) === 1) toneF.set((cfg.toneHz || 1200) * (0.65 + 0.7 * loadS), 0.75);
      let out = toneF.run(body) + (cfg.rasp || 0) * loadS * raspF.run(body) * 1.5;
      let cl = 0;
      for (const m of modes) { const v = m.c1 * m.y1 + m.c2 * m.y2 + m.g * pc; m.y2 = m.y1; m.y1 = v; cl += v; }
      out += cl * 3;
      // whine: a tone locked to the crank, band-limited by refusing anything near Nyquist
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
// The whole sound: n samples of the engine run along its curve (mono).
function motorBuffer(sr, n, cfg, seed) {
  const x = new Float32Array(n), m = makeMotor(sr, cfg, seed), kf = motorCurveKf(cfg.curve);
  for (let k = 0; k < n; k++) { const c = motorCurveAt(kf, k / sr); x[k] = m.tick(c.rpm, c.load); }
  return x;
}
// Bring a motor buffer to MOTOR_RMS (over the samples that sound), its peak capped at MOTOR_PEAK: a rotor's slaps and
// an engine's pops are peakier than a held drone, so one RMS target keeps the types near one loudness with Normalize
// off. In place.
const MOTOR_RMS = 0.12;
const MOTOR_PEAK = 0.9;
function motorLevel(x) {
  let ss = 0, pk = 0, on = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; if (a > 1e-5) { ss += x[i] * x[i]; on++; } }
  if (!on || pk < 1e-9) return;
  const g = Math.min(MOTOR_RMS / Math.sqrt(ss / on), MOTOR_PEAK / pk);
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

// ---------- Blast (wave "blast", #31): explosions and gunshots, a pressure wave carried through a place ----------
// The Explosions were a sine + noise + the boom stage, the Guns the impact engine; neither modeled what a blast IS.
// Prototyped in tools/proto/blast.mjs and picked by ear (AJ, 2026-11-11: the engine won all five rounds,
// soundtests/proto-blast/); this block is that model, unchanged in its maths, with its knobs mapped from the patch by
// blastCfg.
//   SOURCE (what 1 m from the event hears)
//     PRESSURE WAVE  a Friedlander waveform (1 - t/T) e^(-b t/T) after a short rise: near-instant rise, decay through
//                    zero, a long shallow negative phase. T follows Hopkinson-Cranz cube-root scaling, 3 ms x W^(1/3),
//                    W = 10^(-3.5 + 5.5 size) kg TNT-equivalent (size 0 a pistol's ~0.3 g of propellant, 1 a 100 kg
//                    bomb), so size sets the length and the low end. Weight stretches T past physics; Wave shape is b.
//     ROAR           the fireball / muzzle gas: turbulent noise whose band falls as it cools, length ~ W^(1/3); its
//                    level is set against the pressure wave's PEAK (a 0.3 ms muzzle shock carries almost no energy).
//     RUMBLE         sub (35-75 Hz) with slow swells.
//     DEBRIS         chunks landing at FLIGHT times (2 v sin(theta) / g, compressed to a game-length window) around the
//                    blast, so a few land near the listener: dirt, stone, metal, glass, and a patter of grit.
//     CRACK          a supersonic bullet's N-wave (Whitham, ~160-200 us). At the gun it lands with the report and fades
//                    with distance (the cone points away); DOWNRANGE it arrives first, the report d (1/c - 1/v) later.
//     MECHANISM      modal metal: a striker click before the shot; semi-auto = the slide into battery; bolt = a bolt
//                    worked by hand; the casing bouncing on the floor.
//   PROPAGATION      air absorption (4.7 dB/km x (f/1 kHz)^1.3, a 4-pole low-pass at its -3 dB corner), weak-shock
//                    lengthening, a rise that slows with distance, and the PLACE as an impulse response built from
//                    geometry (blastPlaceIR), FFT-convolved: open field (ground reflection, far terrain echoes, a dark
//                    rolling tail), street (two facades, 2-D image sources), indoors (a 9 x 7 x 3.2 m room's image sources
//                    handing over to a Sabine tail), canyon (rock walls, smeared darker echoes), forest (no echoes: the
//                    trees scatter the highs into a dense bright tail). Image taps are gained by spreading against the
//                    direct path (r0 / r), so a far listener hears the place relatively louder.
// The engine's place IS its room: the blast presets run with Reverb 0. Built up front into a stereo buffer like the
// weather (the convolution needs the whole source), the amp envelope its plain gain. Seeded by the patch's own
// `blastSeed` ("which take"), never Math.random; not salted per layer, like chirpSeed. blastLevel optionally tames the
// peaks first (Peak control: the app's own lookahead limiter on the blast alone, before the chain) and brings the buffer
// to a fixed loudness so Normalize off still sits it with the rest.
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function blastCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  return {
    "size": g("blastSize", 0.6), "distance": g("blastDist", 20), "env": Math.round(g("blastEnv", 0)), "pulse": g("blastPulse", 1),
    "shape": g("blastShape", 1), "roar": g("blastRoar", 0.5), "rumble": g("blastRumble", 0.5), "debris": g("blastDebris", 0),
    "debrisType": Math.round(g("blastDebrisType", 0)), "crack": g("blastCrack", 0), "downrange": Math.round(g("blastDownrange", 0)),
    "speed": g("blastSpeed", 850), "action": g("blastAction", 0), "actionType": Math.round(g("blastActionType", 1)),
    "casing": g("blastCasing", 0), "room": g("blastRoom", 1), "tail": g("blastTail", 1), "width": g("width", 0.4),
  };
}
const BLAST_C = 343;            // m/s
const BLAST_G = 9.81;           // m/s^2: debris flight times
function blastRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const blastPan = (p) => [Math.cos((p + 1) * Math.PI / 4) * Math.sqrt(2), Math.sin((p + 1) * Math.PI / 4) * Math.sqrt(2)];
const blastClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// add a continuous waveform f(t) (t in s from its onset at t0 s, nonzero on [0, len)), box-integrated over each sample
// at 16 points: a first-order anti-alias on the only discontinuities the model makes (the shock front, the N-wave)
function blastAddCont(buf, sr, t0, len, f, gain) {
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
// air absorption: the corner where 4.7 dB/km x (f/1k)^1.3 reaches 3 dB over d metres (Infinity = transparent)
function blastAbsorbFc(d) { const f = 1000 * Math.pow(3 / (4.7e-3 * Math.max(d, 1e-3)), 1 / 1.3); return f > 19000 ? Infinity : f; }
function blastLowpass4(x, sr, fc) {   // 4 cascaded one-poles, each at fc / 0.435 so the cascade is -3 dB at fc
  if (!isFinite(fc)) return;
  const a = Math.exp(-2 * Math.PI * Math.min(fc / 0.435, 0.45 * sr) / sr);
  for (let st = 0; st < 4; st++) { let y = 0; for (let i = 0; i < x.length; i++) { y = x[i] + (y - x[i]) * a; x[i] = y; } }
}
function blastKernel(sr, fc) {        // unit-DC one-pole impulse response: a reflection darkened to fc
  if (fc >= 0.45 * sr) return [1];
  const a = Math.exp(-2 * Math.PI * Math.max(fc, 40) / sr), out = [];
  for (let v = 1 - a; v > (1 - a) * 1e-4 && out.length < 4000; v *= a) out.push(v);
  return out;
}
function blastSvf() { return { ic1: 0, ic2: 0 }; }
function blastSvfTick(f, x, g, k) {   // TPT state-variable low-pass, returns lp
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.ic2, v1 = a1 * f.ic1 + a2 * v3, v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
  f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2; return v2;
}
const blastG = (fc, sr) => Math.tan(Math.PI * blastClamp(fc, 5, sr * 0.45) / sr);
function blastSmooth(sr, hz, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = 0; const inc = hz / sr;
  return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * ph)); };
}
// a struck metal / glass / stone part: a click of noise and a few decaying modes
function blastModal(L, R, sr, t0, modes, amp, pan, rnd, clickTau, clickFc) {
  const [pl, pr] = blastPan(pan), i0 = Math.floor(t0 * sr);
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
function blastScrape(L, R, sr, t0, len, fc, amp, pan, rnd) {
  const [pl, pr] = blastPan(pan), i0 = Math.floor(t0 * sr), n = Math.floor(len * sr), f = blastSvf(), g = blastG(fc, sr), hp = blastSvf(), gh = blastG(fc * 0.5, sr);
  for (let k = 0; k < n && i0 + k < L.length; k++) {
    const u = k / n, env = Math.sin(Math.PI * u) * (0.6 + 0.4 * (rnd() < 0.02 ? 1.8 : 1));
    const x = rnd() * 2 - 1, lp = blastSvfTick(f, x, g, 1 / 3), h = lp - blastSvfTick(hp, lp, gh, 0.7);
    const v = amp * env * h * 3; L[i0 + k] += v * pl; R[i0 + k] += v * pr;
  }
}
// The place's impulse response (the direct path excluded): n samples, stereo, plus its strongest taps
function blastPlaceIR(sr, n, c, rnd, hs, hl) {
  const d = c.distance, room = c.room, tailMul = c.tail, width = c.width;
  const L = new Float64Array(n), R = new Float64Array(n), taps = [];
  const tap = (t, g, fc, pan, rec) => {
    g *= room; const i = Math.round(t * sr); if (i < 0 || i >= n || g === 0) return;
    const k = blastKernel(sr, fc), [pl, pr] = blastPan(blastClamp(pan, -1, 1));
    for (let j = 0; j < k.length && i + j < n; j++) { L[i + j] += g * k[j] * pl; R[i + j] += g * k[j] * pr; }
    if (rec !== false) { const o = taps.find((q) => Math.abs(q.t - t) < 0.001); if (o) o.g += g; else taps.push({ t, g }); }
  };
  // a diffuse tail: decorrelated noise, raised-cosine onset, exponential decay, a low-pass falling from fc0 to fc1;
  // scaled to the energy E (an impulse's direct path has energy 1), or to a power P0 at time tRef
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
    const lw = 0.5 + 0.5 * width;     // the tail's width: toward mono when narrow
    for (let i = 0; i < n; i++) { const m = (tl[i] + tr[i]) / 2; L[i] += g * (m + (tl[i] - m) * lw); R[i] += g * (m + (tr[i] - m) * lw); }
  };
  const groundTap = (refl, fc) => {
    const r0 = Math.hypot(d, hs - hl), r1 = Math.hypot(d, hs + hl);
    tap((r1 - r0) / BLAST_C, refl * r0 / r1, fc, 0);
  };
  const env = Math.round(c.env);
  let rt60 = 0;
  if (env === 0) {                    // OPEN FIELD
    groundTap(0.7, 6000);
    for (let e = 0; e < 2; e++) {      // terrain far off (a treeline, a hill): an echo path of 2 Dr
      const Dr = 90 + 260 * rnd(), path = d + 2 * Dr, dt = (path - d) / BLAST_C;
      tap(dt * (0.55 + 0.25 * e), 0.45 * d / path, Math.min(blastAbsorbFc(path), 2200) * 0.7, (rnd() * 2 - 1) * 0.8 * width);
    }
    rt60 = 2.0 * tailMul;
    tail(0.04, 0.22, rt60, 600, 180, room * 0.12 * (1 + d / 150), undefined, 0);
  } else if (env === 1) {             // STREET: facades at y = 0 and y = W
    const W = 16, ys = 4.5, yl = 10.5;
    const r0 = Math.hypot(d, ys - yl);
    for (let q = -10; q <= 10; q++) for (let p = 0; p <= 1; p++) {
      const ord = Math.abs(2 * q - p); if (ord === 0) continue;
      const y = 2 * q * W + (p ? -ys : ys), r = Math.hypot(d, y - yl), dt = (r - r0) / BLAST_C;
      if (dt > 0.6) continue;
      tap(dt, Math.pow(0.82, ord) * r0 / r, Math.min(9000 * Math.pow(0.8, ord), blastAbsorbFc(r)), blastClamp((y - yl) / (Math.abs(y - yl) + 6), -1, 1) * width);
    }
    groundTap(0.9, 9000);
    for (let e = 0; e < 3; e++) {      // facades at the far ends and the cross streets
      const path = d + 2 * (25 + 70 * rnd());
      tap((path - r0) / BLAST_C, 0.35 * r0 / path, Math.min(blastAbsorbFc(path), 3500), (rnd() * 2 - 1) * width);
    }
    rt60 = 1.4 * tailMul;
    tail(0.015, 0.06, rt60, 3200, 700, room * 0.45 * (1 + d / 30), undefined, 0);
  } else if (env === 2) {             // INDOORS: a 9 x 7 x 3.2 m room, image sources (Allen-Berkley)
    const Lx = 9, Ly = 7, Lz = 3.2, dd = Math.min(d, 6.5);
    const S = [1.5, 3.2, Math.min(hs, 2.5)], Lp = [1.5 + dd * 0.95, 3.2 + dd * 0.3, hl];
    const r0 = Math.hypot(S[0] - Lp[0], S[1] - Lp[1], S[2] - Lp[2]), N = 8, tMax = 0.08;
    const img = (q, p, s, Lw) => 2 * q * Lw + (p ? -s : s);
    for (let qx = -N; qx <= N; qx++) for (let px = 0; px <= 1; px++)
      for (let qy = -N; qy <= N; qy++) for (let py = 0; py <= 1; py++)
        for (let qz = -N; qz <= N; qz++) for (let pz = 0; pz <= 1; pz++) {
          const ord = Math.abs(2 * qx - px) + Math.abs(2 * qy - py) + Math.abs(2 * qz - pz); if (ord === 0) continue;
          const x = img(qx, px, S[0], Lx), y = img(qy, py, S[1], Ly), z = img(qz, pz, S[2], Lz);
          const r = Math.hypot(x - Lp[0], y - Lp[1], z - Lp[2]), dt = (r - r0) / BLAST_C;
          if (dt > tMax) continue;
          const taper = dt < 0.055 ? 1 : 1 - (dt - 0.055) / (tMax - 0.055);
          tap(dt, Math.pow(0.84, ord) * r0 / r * taper, Math.max(300, 12000 * Math.pow(0.78, ord)), blastClamp((y - Lp[1]) / (r + 1e-9) * 1.5, -1, 1) * width, ord <= 2);
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
      // image across the canyon: 2q (Dl + Dr) + (p ? the mirror in the left wall, -2 Dl - ys : ys)
      const yy = 2 * q * (Dl + Dr) + (p ? (-2 * Dl - ys) : ys);
      const r = Math.hypot(d, yy), dt = (r - r0) / BLAST_C; if (dt > 2.5) continue;
      const g = Math.pow(0.72, ord) * r0 / r, fc = Math.min(2600 * Math.pow(0.72, ord - 1), blastAbsorbFc(r)), pan = blastClamp(Math.sign(yy) * 0.7, -1, 1) * width;
      { const o = taps.find((q2) => Math.abs(q2.t - dt) < 0.001); if (o) o.g += g * room; else taps.push({ t: dt, g: g * room }); }
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
  taps.sort((x, y) => y.g - x.g);
  return { L, R, taps, rt60 };
}
// mono x convolved with a stereo IR, first n samples. One complex FFT carries both IR channels (L + iR); x is real, so
// the product's inverse holds x*irL in its real part and x*irR in its imaginary part. dsp.js's fftInPlace, unnormalized.
function blastConvolve(x, irL, irR, n) {
  let N = 1; while (N < n + irL.length) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x.subarray(0, n)); hr.set(irL); hi.set(irR);
  fftInPlace(xr, xi, -1); fftInPlace(hr, hi, -1);
  for (let k = 0; k < N; k++) { const a = xr[k], b = xi[k], c = hr[k], e = hi[k]; hr[k] = a * c - b * e; hi[k] = a * e + b * c; }
  fftInPlace(hr, hi, 1);
  const L = new Float64Array(n), R = new Float64Array(n), inv = 1 / N;
  for (let i = 0; i < n; i++) { L[i] = hr[i] * inv; R[i] = hi[i] * inv; }
  return { L, R };
}

// The whole blast: n samples of stereo, seeded. Returns { L, R, info }.
function makeBlast(sr, n, cfg, seed) {
  const c = cfg, rnd = blastRng(seed);
  n = Math.max(16, n);
  const W = Math.pow(10, -3.5 + 5.5 * blastClamp(c.size, 0, 1)), cubeW = Math.cbrt(W);
  const d = Math.max(0.5, c.distance), isGun = c.action > 0 || c.crack > 0 || c.size < 0.3;
  const hs = isGun ? 1.4 : 0.3, hl = 1.7, width = c.width;
  // TIMING: a pre-roll for the mechanism's pre-click (guns), the crack's lead (downrange)
  const crackLead = c.crack > 0 && c.downrange ? d * (1 / BLAST_C - 1 / Math.max(BLAST_C * 1.05, c.speed)) : 0;
  const tB = (c.action > 0 ? 0.035 : 0.004) + crackLead;          // the report's arrival (s)
  // PRESSURE WAVE: Hopkinson-Cranz T+, stretched by weak-shock propagation and Weight
  const T = 0.003 * cubeW * c.pulse * Math.sqrt(1 + 0.4 * Math.log(1 + d / 5));
  const b = Math.max(0.3, c.shape), rise = 10e-6 + d * 2e-6;
  const fried = (t) => { if (t < rise) return 0.5 - 0.5 * Math.cos(Math.PI * t / rise); const u = (t - rise) / T; return (1 - u) * Math.exp(-b * u); };
  const blastLen = rise + T * (1 + 14 / b);
  // buses: S the source (mono), Dl/Dr the debris field and the mechanism (stereo, placed), K the crack, P the wave alone
  const S = new Float64Array(n), Dl = new Float64Array(n), Dr = new Float64Array(n), K = new Float64Array(n), P = new Float64Array(n);
  blastAddCont(P, sr, tB, blastLen, fried, 1);
  let Eb = 0; for (let i = 0; i < n; i++) Eb += P[i] * P[i];
  let pkP = 0; for (let i = 0; i < n; i++) pkP = Math.max(pkP, Math.abs(P[i]));
  const info = { "W": W, "Tplus": T, "blastAt": Math.floor(tB * sr), "crackLead": crackLead, "absorbFc": blastAbsorbFc(d) };
  for (let i = 0; i < n; i++) S[i] = P[i];
  const scaleTo = (buf, ratio) => {   // the gain that brings a component's energy to `ratio` x the pressure wave's
    let e = 0; for (let i = 0; i < n; i++) e += buf[i] * buf[i];
    return e > 0 ? Math.sqrt(ratio * Eb / e) : 0;
  };
  // ROAR: the fireball / muzzle gas; its RMS over its loudest 5 ms is roar x 0.45 x the wave's peak
  if (c.roar > 0) {
    const tau = 0.003 + 0.12 * Math.pow(cubeW, 1.3), fc0 = 7000 / (1 + 2 * cubeW), fc1 = fc0 / 5;
    const buf = new Float64Array(n), f1 = blastSvf(), f2 = blastSvf(), i0 = Math.floor(tB * sr), len = Math.min(n - i0, Math.ceil(tau * 9 * sr));
    const flick = blastSmooth(sr, 25, rnd);
    for (let k = 0; k < len; k++) {
      const t = k / sr, env = (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / tau) * (1 + 0.35 * flick());
      const fc = fc0 * Math.pow(fc1 / fc0, Math.min(1, t / (tau * 3))), g = blastG(fc, sr);
      buf[i0 + k] = blastSvfTick(f2, blastSvfTick(f1, (rnd() * 2 - 1) * env, g, 0.9), g, 0.9);
    }
    const w5 = Math.floor(0.005 * sr); let best = 0, acc = 0;
    for (let i = 0; i < n; i++) { acc += buf[i] * buf[i]; if (i >= w5) acc -= buf[i - w5] * buf[i - w5]; if (acc > best) best = acc; }
    const gn = best > 0 ? c.roar * 0.45 * pkP / Math.sqrt(best / w5) : 0;
    for (let i = 0; i < n; i++) S[i] += buf[i] * gn;
  }
  // RUMBLE: sub, slow swells
  if (c.rumble > 0) {
    const fc = 30 + 45 / (1 + cubeW), tau = 0.12 + 0.55 * cubeW, ta = 0.02 + 0.03 * cubeW;
    const buf = new Float64Array(n), f1 = blastSvf(), f2 = blastSvf(), g = blastG(fc, sr), sw = blastSmooth(sr, 2.5, rnd), i0 = Math.floor(tB * sr);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr, env = (1 - Math.exp(-t / ta)) * Math.exp(-t / tau) * (1 + 0.5 * sw());
      buf[i] = blastSvfTick(f2, blastSvfTick(f1, (rnd() * 2 - 1) * env, g, 0.8), g, 0.8);
    }
    const gn = scaleTo(buf, 2.5 * c.rumble * c.rumble);
    for (let i = 0; i < n; i++) S[i] += buf[i] * gn;
  }
  // DEBRIS: flight-timed landings scattered around the blast
  if (c.debris > 0) {
    const vmax = 8 + 30 * c.size, win = 0.3 + 1.5 * c.size, tFlightMax = 2 * vmax / BLAST_G;
    const nEv = Math.round(c.debris * (8 + 50 * c.size)), mats = [[0.55, 0.4, 0.05, 0], [0.25, 0.5, 0.25, 0], [0.15, 0.3, 0.3, 0.25]][Math.round(c.debrisType)] || [1, 0, 0, 0];
    for (let e = 0; e < nEv; e++) {
      const v = vmax * Math.pow(rnd(), 0.6), th = (10 + 70 * rnd()) * Math.PI / 180, fl = 2 * v * Math.sin(th) / BLAST_G;
      const t = tB + 0.05 + win * fl / tFlightMax, range = v * v * Math.sin(2 * th) / BLAST_G, ph = rnd() * 2 * Math.PI;
      const lx = range * Math.cos(ph) - d, ly = range * Math.sin(ph), dist = Math.hypot(lx, ly) + 1;
      const near = Math.min(3, d / dist), pan = blastClamp(ly / (dist + 3), -1, 1) * width;
      const sz = -Math.log(Math.max(1e-6, rnd())), amp = near * (0.3 + sz) * 0.5;
      let r = rnd(), m = 0; while (m < 3 && r > mats[m]) { r -= mats[m]; m++; }
      if (m === 0) {           // dirt: a dull thud
        const tau = 0.003 + 0.008 * rnd(), fc = 500 + 2000 * rnd() / (1 + sz);
        blastModal(Dl, Dr, sr, t, [], amp * 1.6, pan, rnd, tau, fc);
      } else if (m === 1) {    // stone: a click and two short modes
        const f = 1200 + 2500 * rnd();
        blastModal(Dl, Dr, sr, t, [{ "f": f, "a": 0.5, "tau": 0.006 + 0.01 * rnd() }, { "f": f * (1.6 + 0.8 * rnd()), "a": 0.3, "tau": 0.004 + 0.006 * rnd() }], amp, pan, rnd, 0.0006, 4000);
      } else if (m === 2) {    // metal: a ringing part
        const f = 900 + 2400 * rnd() / (0.5 + sz * 0.5), tau = 0.04 + 0.12 * rnd();
        blastModal(Dl, Dr, sr, t, [1, 2.32, 3.86, 5.1].map((q, k) => ({ "f": f * q * (1 + 0.02 * (rnd() - 0.5)), "a": 0.45 / (k + 1), "tau": tau / (1 + k * 0.6) })), amp * 0.7, pan, rnd, 0.0003, 6000);
      } else {                 // glass: a few shards, high and tinkly
        for (let s = 0; s < 3; s++) {
          const f = 2500 + 3500 * rnd();
          blastModal(Dl, Dr, sr, t + s * 0.012 * rnd(), [1, 1.73, 2.9].map((q, k) => ({ "f": f * q, "a": 0.35 / (k + 1), "tau": 0.02 + 0.06 * rnd() })), amp * 0.4, pan + (rnd() - 0.5) * 0.3, rnd, 0.0002, 9000);
        }
      }
    }
    const nG = Math.round(c.debris * 140 * (0.3 + c.size));       // grit patter: many tiny grains early
    for (let e = 0; e < nG; e++) {
      const t = tB + 0.03 + 0.5 * win * Math.pow(rnd(), 1.4), pan = (rnd() * 2 - 1) * width;
      blastModal(Dl, Dr, sr, t, [], 0.12 * rnd(), pan, rnd, 0.0004, 2500 + 4000 * rnd());
    }
    let e = 0; for (let i = 0; i < n; i++) e += (Dl[i] * Dl[i] + Dr[i] * Dr[i]) / 2;
    const gn = e > 0 ? Math.sqrt(0.5 * c.debris * c.debris * Eb / e) : 0;
    for (let i = 0; i < n; i++) { Dl[i] *= gn; Dr[i] *= gn; }
  }
  // MECHANISM + CASING: modal metal at the shooter
  if (c.action > 0 || c.casing > 0) {
    const mL = new Float64Array(n), mR = new Float64Array(n), at = Math.round(c.actionType), aPan = 0.15 * width;
    const steel = (f, tau) => [1, 2.76, 5.4, 8.93].map((q, k) => ({ "f": f * q * (1 + 0.01 * (rnd() - 0.5)), "a": 0.6 / (k + 1), "tau": tau / (1 + 0.5 * k) }));
    let casingAt = null;
    if (c.action > 0 && at > 0) {
      blastModal(mL, mR, sr, tB - 0.028, steel(2600, 0.01), 0.25, aPan, rnd, 0.0002, 7000);   // trigger break
      blastModal(mL, mR, sr, tB - 0.005, steel(3300, 0.014), 0.6, aPan, rnd, 0.0002, 8000);   // striker / hammer fall
      if (at === 1) {        // semi-auto: the slide cycles inside the report
        blastModal(mL, mR, sr, tB + 0.004, steel(1700, 0.03), 0.9, aPan, rnd, 0.0006, 5000);
        blastModal(mL, mR, sr, tB + 0.026, steel(1500, 0.045), 1.3, aPan, rnd, 0.0008, 4500);  // back into battery: the clack
        casingAt = tB + 0.42 + 0.08 * rnd();
      } else if (at === 2) { // a bolt worked by hand
        const tb = tB + 0.5;
        blastModal(mL, mR, sr, tb, steel(2200, 0.02), 0.7, aPan, rnd, 0.0003, 6000);           // lift
        blastScrape(mL, mR, sr, tb + 0.03, 0.11, 2600, 0.35, aPan, rnd);                      // draw back
        blastModal(mL, mR, sr, tb + 0.14, steel(1600, 0.05), 1.1, aPan, rnd, 0.0007, 5000);    // end stop
        blastScrape(mL, mR, sr, tb + 0.27, 0.1, 2300, 0.3, aPan, rnd);                        // push home
        blastModal(mL, mR, sr, tb + 0.37, steel(1500, 0.05), 1.0, aPan, rnd, 0.0007, 5000);    // chamber
        blastModal(mL, mR, sr, tb + 0.45, steel(2400, 0.025), 0.8, aPan, rnd, 0.0003, 6000);   // lock down
        casingAt = tb + 0.14 + 0.38;
      }
    }
    if (c.casing > 0) {      // a brass tube on a hard floor: restitution-timed bounces
      let t = casingAt != null ? casingAt : tB + 0.45, dt = 0.11, a = 1;
      const f = 5200 + 1500 * rnd(), cp = (rnd() * 2 - 1) * 0.5 * width;
      for (let k = 0; k < 5 && a > 0.05; k++) {
        blastModal(mL, mR, sr, t, [1, 1.47, 2.31, 2.88].map((q, j) => ({ "f": f * q * (1 + 0.01 * j * (rnd() - 0.5)), "a": 0.5 / (j + 1), "tau": 0.06 + 0.06 * rnd() })), a * c.casing * 0.5, cp, rnd, 0.0002, 9000);
        t += dt; dt *= 0.62; a *= 0.55;
      }
    }
    // level: the mechanism as a share of the pressure wave's energy (0.06 at Mechanism 1: a game-compressed -12 dB)
    let e = 0; for (let i = 0; i < n; i++) e += (mL[i] * mL[i] + mR[i] * mR[i]) / 2;
    const lvl = Math.max(c.action, c.casing * 0.6), gn = e > 0 ? Math.sqrt(0.06 * lvl * lvl * Eb / e) : 0;
    for (let i = 0; i < n; i++) { Dl[i] += mL[i] * gn; Dr[i] += mR[i] * gn; }
  }
  // CRACK: the bullet's N-wave
  if (c.crack > 0) {
    const M = Math.max(1.05, c.speed / BLAST_C), bm = c.downrange ? 5 : 2, dia = 0.0078, blen = 0.03;
    const TN = 1.82 * M * Math.pow(bm, 0.25) * dia / (BLAST_C * Math.pow(M * M - 1, 0.375) * Math.pow(blen, 0.25));
    const tC = c.downrange ? 0.004 : tB + 0.0002;
    blastAddCont(K, sr, tC, TN, (t) => 1 - 2 * t / TN, 1);
    blastLowpass4(K, sr, blastAbsorbFc(c.downrange ? bm : 1));
    let pkK = 0; for (let i = 0; i < n; i++) pkK = Math.max(pkK, Math.abs(K[i]));
    // at the gun the crack sits level with the report's peak and is gone a few tens of metres away (the cone points
    // away); downrange its peak stands over the DISTANT report's (game-compressed to x2 .. x8)
    const rel = c.downrange ? Math.min(8, 2 + Math.pow(d / bm, 0.75) / 10) : 1 / (1 + Math.pow(d / 15, 2));
    const gnK = pkK > 0 ? c.crack * rel * pkP / pkK : 0;
    for (let i = 0; i < n; i++) K[i] *= gnK;
  }
  // PROPAGATION: air absorption on the source; the debris field's paths are shorter (absorbed at 0.8 d); forest
  // scattering pulls the highs out of the direct path
  blastLowpass4(S, sr, blastAbsorbFc(d));
  blastLowpass4(Dl, sr, blastAbsorbFc(d * 0.8)); blastLowpass4(Dr, sr, blastAbsorbFc(d * 0.8));
  if (Math.round(c.env) === 4) { const fcF = 4000 * Math.sqrt(50 / Math.max(d, 50)) * 2.2; blastLowpass4(S, sr, fcF); blastLowpass4(Dl, sr, fcF); blastLowpass4(Dr, sr, fcF); }
  // THE PLACE: its own random stream, so a seed builds the same place whatever the source holds
  const nIR = Math.min(n, Math.floor(4 * sr));
  const ir = blastPlaceIR(sr, nIR, Object.assign({}, c, { "distance": d }), blastRng((seed ^ 0x9e3779b9) >>> 0), hs, hl);
  info.taps = ir.taps.slice(0, 12); info.rt60 = ir.rt60;
  const down = c.crack > 0 && c.downrange;
  const M = new Float64Array(n);
  for (let i = 0; i < n; i++) M[i] = S[i] + (down ? 0 : K[i]) + (Dl[i] + Dr[i]) * 0.5;
  const wet = blastConvolve(M, ir.L, ir.R, n);
  if (down) {   // downrange the crack is born ~5 m from the listener: the same terrain, its own short direct path
    const irK = blastPlaceIR(sr, nIR, Object.assign({}, c, { "distance": 5 }), blastRng((seed ^ 0x9e3779b9) >>> 0), 1.5, hl);
    const wk = blastConvolve(K, irK.L, irK.R, n);
    for (let i = 0; i < n; i++) { wet.L[i] += wk.L[i]; wet.R[i] += wk.R[i]; }
  }
  const [pl, pr] = blastPan((rnd() - 0.5) * 0.3 * width);
  const L = new Float32Array(n), R = new Float32Array(n);
  // DC: a Friedlander with b != 1 has net area and the rumble sits low: a 2-pole high-pass at 18 Hz (a microphone's own)
  const hpA = Math.exp(-2 * Math.PI * 18 / sr);
  let h1l = 0, h1r = 0, x1l = 0, x1r = 0, h2l = 0, h2r = 0, y1l = 0, y1r = 0;
  for (let i = 0; i < n; i++) {
    const xl = (S[i] + K[i]) * pl + Dl[i] + wet.L[i], xr = (S[i] + K[i]) * pr + Dr[i] + wet.R[i];
    h1l = hpA * (h1l + xl - x1l); x1l = xl; h2l = hpA * (h2l + h1l - y1l); y1l = h1l;
    h1r = hpA * (h1r + xr - x1r); x1r = xr; h2r = hpA * (h2r + h1r - y1r); y1r = h1r;
    L[i] = h2l; R[i] = h2r;
  }
  return { L, R, info };
}
// Level a blast buffer, in place. PEAK CONTROL first (`peak` 0..2, the patch's blastPeak): the buffer is brought to a
// 0.9 peak and run through the app's own lookahead limiter (limiterProcess) at min(peak, 1), ON THE BLAST ALONE, before
// the chain; past 1 it is brought back to 0.9 and limited again at peak - 1. A gunshot keeps nearly all its energy in
// ~10 ms, so its crest against a loudness block is 20-27 dB, more than one limiter at full can take out: three of the
// round's gun takes needed that second pass, which a preset's master Limiter could not give. Doing both here, BEFORE the
// chain, also keeps `gain` a plain level after it (a master Limiter after the gain would pin the peak at its ceiling
// whatever the gain, so Variations could not level a pack). Then the buffer is brought to BLAST_RMS over the samples
// that sound, its peak capped at BLAST_PEAK, so Normalize off still sits it with the other engines.
const BLAST_RMS = 0.1;
const BLAST_PEAK = 0.9;
function blastLevel(L, R, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  let ss = 0, on = 0; pk = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]), m = a > b ? a : b;
    if (m > pk) pk = m;
    if (m > 1e-5) { ss += L[i] * L[i] + R[i] * R[i]; on++; }
  }
  if (!on || pk < 1e-9) return;
  const g = Math.min(BLAST_RMS / Math.sqrt(ss / (2 * on)), BLAST_PEAK / pk);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ---------- Spring (wave "spring", #32): boings, doorstops, spring tanks and the jaw harp ----------
// The boings and bounces were pitch sweeps on a sine, a triangle or a pulse. Prototyped in tools/proto/spring.mjs and
// picked by ear (AJ, 2026-11-11: the engine won all five rounds, soundtests/proto-spring/); this block is that model,
// unchanged in its maths, with its knobs mapped from the patch by springCfg.
// A coil spring is a DISPERSIVE medium: below its transition frequency the highs run along the coil faster than the
// lows, so a tap comes back as a falling chirp ("pew"), again on every round trip, more smeared each time; closed into a
// loop one period long it is a pitched ring whose partials are stretched apart (a doorstop's "doinng").
//   COIL / DOORSTOP  two feedback loops, one per channel (two springs, or the tip's two directions of swing). A pass:
//                    excitation + feedback -> soft limit tanh(d x)/d (Pluck) -> DC leak (3 Hz, peak gain 1) -> THE
//                    DISPERSION, a chain of 2nd-order allpasses DESIGNED (springDispersion, after Abel & Smith's
//                    dispersion-filter method) so the group delay is a straight line in log-frequency between flo and
//                    fhi, falling (Dispersion > 0: the lows wait) or rising (< 0) -> 4th-order Butterworth low-pass ->
//                    TAP (DC-blocked outside the loop) -> high-frequency one-pole (Damping: highs die faster) -> x g
//                    -> a delay line read by 4-point Lagrange, its length swung by the SWAY LFO (level too; the two
//                    channels a quarter swing apart). COIL: the round trip is Length; fhi = 6 x freq, flo = fhi / 32.
//                    DOORSTOP: one period, solved so the fundamental lands on freq; fhi = 16 x freq; excited by a
//                    one-period bump sent as its velocity (a bent tip let go) and a seeded finger scrape.
//   TWANG            a jaw harp: a plucked steel reed built additively (so it cannot alias), the reed's own first
//                    overtone (6.27 x, a short ring), through the MOUTH: two resonances, F2 picking out single
//                    harmonics, gliding up or down (Mouth) and wobbling (Sway). The mouth also runs on a coil or a
//                    doorstop when Mouth is not 0 (a "talking" spring).
// STABLE by construction: every block in the loop has |H| <= 1 at every frequency (allpasses exactly 1), the soft
// limit has |f(x)| <= |x|, and g < 1 (tools/proto/spring.mjs `stability`: 54 worst corners, loop gain <= 0.9985).
// A per-sample voice like the creature's, one per shot; seeded by the patch's own `springSeed` ("which take": the
// sway's phase, the scrape, the ring's phase), not salted per layer, like chirpSeed. springLevel levels a shot once.
const SPRING_COIL_GLIDE = 0.08;      // seconds of glide per pass at |Dispersion| 1 (coil)
const SPRING_SWAY_PITCH = [0.06, 0.03];   // delay-length swing at Sway 1 (coil, doorstop): +-6% / +-3%
const SPRING_GLIDE_MAX = 0.35;       // the mouth's glide time (s), shortened on a short-lived pluck
const SPRING_MAX_SECTIONS = 400;     // a ceiling on the allpass count (a 400 ms rising glide over 5 octaves needs ~260)
const SPRING_TAU = 6.283185307179586;
// knobs -> the model (keys quoted: the exporter's app-global scan reads a bare key as a name)
function springCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  return {
    "type": Math.max(0, Math.min(2, Math.round(g("springType", 0)))),
    "lengthS": g("springLength", 60) / 1000, "disp": g("springDisp", 0.6), "damp": g("springDamp", 0.4),
    "sway": g("springSway", 0), "swayRate": g("springSwayRate", 7), "pluck": g("springPluck", 0.5),
    "mouth": g("springMouth", 0), "vowel": g("springVowel", 0.4),
  };
}
// T60 (seconds) of the loop / the reed, from Damping
function springT60(type, damp) { return type === 0 ? 5 * Math.pow(0.04, damp) : type === 1 ? 3 * Math.pow(0.06, damp) : 2.5 * Math.pow(0.1, damp); }
// exact responses (the tuning math evaluates the same filters the loop runs), as [re, im]
function springCabs(r) { return Math.hypot(r[0], r[1]); }
function springMul(p, q) { return [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]]; }
function springBiquadLP(fc, q, sr) {   // RBJ low-pass; Butterworth Qs keep the cascade <= 1 everywhere
  const w = SPRING_TAU * fc / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return { "b0": (1 - c) / 2 / a0, "b1": (1 - c) / a0, "b2": (1 - c) / 2 / a0, "a1": -2 * c / a0, "a2": (1 - al) / a0 };
}
function springBqResp(f, w) {
  const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2, ni = f.b1 * s1 + f.b2 * s2, dr = 1 + f.a1 * c1 + f.a2 * c2, di = f.a1 * s1 + f.a2 * s2, dd = dr * dr + di * di;
  return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
}
function springOpResp(h, w) {   // (1-h) / (1 - h e^-jw)
  const dr = 1 - h * Math.cos(w), di = h * Math.sin(w), dd = dr * dr + di * di;
  return [(1 - h) * dr / dd, -(1 - h) * di / dd];
}
function springDcResp(R, w) {   // (1+R)/2 (1 - e^-jw) / (1 - R e^-jw): peak gain exactly 1 at Nyquist
  const nr = 1 - Math.cos(w), ni = Math.sin(w), dr = 1 - R * Math.cos(w), di = R * Math.sin(w), dd = dr * dr + di * di, k = (1 + R) / 2;
  return [k * (nr * dr + ni * di) / dd, k * (ni * dr - nr * di) / dd];
}
// one 2nd-order allpass, poles r e^{+-j th}: unwrapped phase = -2w - 2 arg D(e^jw), D(z) = (1 - p z^-1)(1 - p* z^-1)
function springAp2Phase(r, th, w) {
  const f = (phi) => Math.atan2(r * Math.sin(w - phi), 1 - r * Math.cos(w - phi));   // arg(1 - r e^{j phi} e^{-jw})
  return -2 * w - 2 * (f(th) + f(-th));
}
// THE DISPERSION DESIGN. Wanted group delay (samples) on (0, pi): falling = S at and below flo, falling linearly in
// log2(f) to 0 at fhi; rising = 0 at and below flo, rising to S at fhi, then easing back to 0 over half an octave (the
// low-pass is there). Sections at the 2 pi crossings of the running integral (one 2nd-order allpass carries exactly
// 2 pi of phase over 0..pi); pole radius 1 - r = the local spacing.
function springDispersion(sr, flo, fhi, S, rising) {
  const wlo = SPRING_TAU * flo / sr, whi = SPRING_TAU * fhi / sr, lnR = Math.log(whi / wlo), wtop = Math.min(Math.PI * 0.98, whi * 1.4142135623730951);
  const want = (w) => {
    if (!rising) return w <= wlo ? S : w >= whi ? 0 : S * (1 - Math.log(w / wlo) / lnR);
    if (w <= wlo) return 0;
    if (w <= whi) return S * Math.log(w / wlo) / lnR;
    return w >= wtop ? 0 : S * (1 - Math.log(w / whi) / Math.log(wtop / whi));
  };
  const G = 8192, cum = new Float64Array(G + 1);
  for (let i = 1; i <= G; i++) { const w0 = Math.PI * (i - 1) / G, w1 = Math.PI * i / G; cum[i] = cum[i - 1] + 0.5 * (want(w0) + want(w1)) * (w1 - w0) / SPRING_TAU; }
  const n = Math.min(SPRING_MAX_SECTIONS, Math.round(cum[G]));
  const scale = n > 0 ? cum[G] / n : 1, th = [];
  for (let k = 0, i = 1; k < n; k++) {
    const target = (k + 0.5) * scale;
    while (i < G && cum[i] < target) i++;
    const fr = (target - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    th.push(Math.PI * (i - 1 + fr) / G);
  }
  return th.map((t, k) => {
    const prev = k > 0 ? th[k - 1] : 0;
    const sp = 0.5 * ((k + 1 < n ? th[k + 1] : t + (t - prev)) - prev);
    const r = Math.max(0.5, Math.min(0.99995, 1 - sp));
    return { "r": r, "th": t, "c1": -2 * r * Math.cos(t), "c2": r * r };   // y = c2 x + c1 x1 + x2 - c1 y1 - c2 y2
  });
}
// The loop's design: band, dispersion chain, delay, losses. Solved so a coil's round trip (at mid-band) is Length and a
// doorstop's fundamental is f0, with the T60 at the reference frequency net of what the filters already take there.
function springDesign(sr, cfg, f0) {
  const type = cfg.type, rising = cfg.disp < 0, amt = Math.abs(cfg.disp);
  const fhi = type === 0 ? Math.min(9000, Math.max(500, 6 * f0)) : Math.min(9000, Math.max(1500, 16 * f0));
  const flo = type === 0 ? Math.max(40, fhi / 32) : f0;
  // the loop's low-pass: at fhi for a coil (a spring is band-limited); 2.5 x fhi for a doorstop, whose loop runs
  // hundreds of passes a second (at fhi it took ~30 dB a second off 0.7 fhi on its own)
  const lpHz = Math.min(0.45 * sr, type === 0 ? fhi : 2.5 * fhi);
  const lp = [springBiquadLP(lpHz, 0.5412, sr), springBiquadLP(lpHz, 1.3066, sr)];
  const R = 1 - SPRING_TAU * 20 / sr, Rin = 1 - SPRING_TAU * 3 / sr;   // the output DC blocker (20 Hz); the in-loop DC leak (3 Hz)
  const t60 = springT60(type, cfg.damp), rho = 0.7 - 0.55 * cfg.damp;  // rho: T60 at the top / T60 at the bottom
  const P = type === 0 ? cfg.lengthS * sr : sr / f0;                    // the round trip, samples
  // the glide per pass (samples); a doorstop's falling glide is capped so the fundamental still fits in one period
  let S = type === 0 ? Math.min(0.9 * P, amt * SPRING_COIL_GLIDE * sr) : amt * (rising ? 2 : 0.85) * P;
  const fixedResp = (w, h) => springMul(springMul(springMul(springBqResp(lp[0], w), springBqResp(lp[1], w)), springOpResp(h, w)), springDcResp(Rin, w));
  const fixedPhase = (w, h) => { const r = fixedResp(w, h); return -Math.atan2(r[1], r[0]) / w; };
  const chainPhase = (sec, w) => { let p = 0; for (const s of sec) p += springAp2Phase(s.r, s.th, w); return -p / w; };
  const wRef = type === 0 ? SPRING_TAU * Math.sqrt(flo * fhi) / sr : SPRING_TAU * f0 / sr;
  let sec = [], h = 0, g = 0.99, D0 = 2;
  for (let it = 0; it < 6; it++) {   // h needs the pass time, the pass time needs h's phase: converges at once
    sec = S > 0.5 ? springDispersion(sr, flo, fhi, S, rising) : [];
    const used = chainPhase(sec, wRef) + fixedPhase(wRef, h);
    if (type === 1 && used > P - 2 && S > 0) { S *= 0.9 * (P - 2 - fixedPhase(wRef, h)) / Math.max(1e-9, chainPhase(sec, wRef)); continue; }
    D0 = Math.max(4, P - used);
    const passS = (D0 + used) / sr;
    g = Math.min(0.9995, Math.pow(10, -3 * passS / t60) / Math.max(0.5, springCabs(fixedResp(wRef, h))));
    const want = Math.pow(10, -3 * passS * (1 / (rho * t60) - 1 / t60)), wh = SPRING_TAU * 0.7 * fhi / sr;
    // (net of what the low-pass already takes there, relative to the reference: if that is already enough, h = 0)
    const lpRel = springCabs(springMul(springBqResp(lp[0], wh), springBqResp(lp[1], wh))) / springCabs(springMul(springBqResp(lp[0], wRef), springBqResp(lp[1], wRef)));
    let lo = 0, hi = 0.99;
    for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (springCabs(springOpResp(m, wh)) * lpRel > want) lo = m; else hi = m; }
    h = 0.5 * (lo + hi);
  }
  return { "sec": sec, "D0": D0, "lp": lp, "R": R, "Rin": Rin, "h": h, "g": g, "P": P };
}
// 4-point (3rd-order) Lagrange interpolation at fraction u in [0,1) between p1 and p2 (|H| <= 1 there)
function springLagrange(p0, p1, p2, p3, u) {
  const um1 = u - 1, um2 = u - 2, up1 = u + 1;
  return -u * um1 * um2 / 6 * p0 + up1 * um1 * um2 / 2 * p1 - up1 * u * um2 / 2 * p2 + up1 * u * um1 / 6 * p3;
}
// One voice (one pluck). tick(f) -> [L, R], unscaled. f (optional) is the note's pitch at this sample: the TWANG's reed
// follows it (a sweep or a vibrato bends it; harmonics past 0.45 SR are skipped as it rises), while a coil's or a
// doorstop's loop is designed for f0 and keeps it.
function makeSpring(sr, cfg, f0, seedIn) {
  let seed = (seedIn >>> 0) || 0x5eed5;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const out = [0, 0];
  const type = cfg.type, pluck = cfg.pluck;
  let t = 0;
  const dt = 1 / sr;
  const life = springT60(type, cfg.damp);
  const swayTau = Math.max(0.4, 4 * life / 6.9);   // the swing's DEPTH (relative to the ring) fades at a quarter of the ring's rate
  const swayPh0 = rnd() * SPRING_TAU;
  // the mouth: two TPT state-variable band-passes, coefficients per sample
  const useMouth = type === 2 || Math.abs(cfg.mouth) > 1e-6;
  const F2base = 500 * Math.pow(5, cfg.vowel);   // 500 .. 2500 Hz
  const glide = Math.min(SPRING_GLIDE_MAX, 0.4 * life);
  const sv = [{ "s1": 0, "s2": 0 }, { "s1": 0, "s2": 0 }, { "s1": 0, "s2": 0 }, { "s1": 0, "s2": 0 }];   // F1 L, F2 L, F1 R, F2 R
  const bp = (q, x, f, Q) => {
    const gg = Math.tan(Math.PI * Math.min(f, 0.45 * sr) / sr), k = 1 / Q;
    const a1 = 1 / (1 + gg * (gg + k)), a2 = gg * a1, a3 = gg * a2;
    const v3 = x - q.s2, v1 = a1 * q.s1 + a2 * v3, v2 = q.s2 + a2 * q.s1 + a3 * v3;
    q.s1 = 2 * v1 - q.s1; q.s2 = 2 * v2 - q.s2;
    return k * v1;   // unity gain at the peak
  };
  const mouthAt = (swayV) => {   // F2 at time t: the glide, then the wobble
    const u = Math.min(1, t / glide), sm = u * u * (3 - 2 * u);
    return F2base * Math.pow(2, 2 * cfg.mouth * sm) * Math.pow(2, 0.6 * swayV);
  };

  if (type === 2) {
    // TWANG: the reed. Additive, so nothing above 0.45 SR is ever made.
    const nH = Math.max(1, Math.min(90, Math.floor(Math.min(0.45 * sr, 10000) / f0)));
    const tilt = 0.9 - 0.5 * pluck;                      // a hard pluck is brighter (a jaw harp's source is very rich)
    const amp = new Float64Array(nH + 1), dec = new Float64Array(nH + 1);
    for (let k = 1; k <= nH; k++) {
      amp[k] = Math.pow(k, -tilt) * (k === 1 ? 1.5 : 1);  // the drone's fundamental is strong in a jaw harp
      const tk = life / 6.9 / (1 + 0.015 * (k - 1) * (0.5 + cfg.damp));   // the upper harmonics fade a little first
      dec[k] = Math.exp(-dt / tk);
    }
    const ting = 6.27 * f0 < 0.45 * sr ? 0.25 * pluck : 0, tingDec = Math.exp(-dt / 0.05), tingPh0 = rnd() * SPRING_TAU;
    const env = Float64Array.from(amp);
    let tingE = ting, ph = 0;
    const atk = 0.002;   // the reed leaves the finger at full swing; a 2 ms ramp keeps the first sample from stepping
    return {
      tick(fIn) {
        const f = fIn > 0 ? fIn : f0;
        const kMax = f > f0 ? Math.min(nH, Math.floor(0.45 * sr / f)) : nH;
        ph += SPRING_TAU * f * dt;
        if (ph > SPRING_TAU * 1e4) ph -= SPRING_TAU * 1e4;
        let s = 0;
        for (let k = 1; k <= nH; k++) { if (k <= kMax) s += env[k] * Math.sin(k * ph); env[k] *= dec[k]; }
        if (6.27 * f < 0.45 * sr) s += tingE * Math.sin(6.27 * ph + tingPh0);
        tingE *= tingDec;
        s *= Math.min(1, t / atk);
        const sw = cfg.sway * Math.sin(SPRING_TAU * cfg.swayRate * t + swayPh0);
        const F2 = mouthAt(sw), F1 = Math.min(800, Math.max(220, 0.42 * F2));
        const y = 0.12 * s + 0.6 * bp(sv[0], s, F1, 5) + 3.2 * bp(sv[1], s, F2, 16);
        out[0] = y; out[1] = y;
        t += dt;
        return out;
      },
    };
  }

  // COIL / DOORSTOP: two dispersive loops
  const d = springDesign(sr, cfg, f0), sec = d.sec, nS = sec.length;
  const ch = [0, 1].map((c) => {
    // the second spring / polarization: coil +-1.7% long, doorstop +-0.08% (a slow beat between the tip's two directions)
    const sp = type === 0 ? (c ? 1.017 : 0.983) : (c ? 1.0008 : 0.9992);
    const D0 = Math.max(4, d.D0 + (sp - 1) * d.P);
    const maxD = Math.ceil(D0 * (1 + SPRING_SWAY_PITCH[type] * 1.05)) + 4;
    let size = 1;
    while (size < maxD + 2) size <<= 1;
    return { "D0": D0, "buf": new Float64Array(size), "mask": size - 1, "w": 0, "st": new Float64Array(4 * nS), "z": [0, 0, 0, 0], "dcx": 0, "dcy": 0, "lx": 0, "ly": 0, "hp": 0 };
  });
  // the excitation. COIL: a zero-mean doublet (one cycle of a sine), a tap on the end of the coil, width from Pluck.
  // DOORSTOP: the bent tip let go, like a plucked string's initial shape, ONE PERIOD long: a smooth bump
  // sin^2(pi w(u)) with its apex at 0.45 .. 0.20 of the period as Pluck rises, sent as its VELOCITY (the per-sample
  // difference: zero-sum, so no DC to ring at 0 Hz, and starting from silence). A short pulse instead put its energy
  // into the top partials, which die in 50 ms, and left the first millisecond ~19 dB over the ring.
  let wN, exc;
  if (type === 0) {
    wN = Math.max(3, Math.round(0.002 * Math.pow(0.15, pluck) * sr)); exc = new Float64Array(wN);
    for (let i = 0; i < wN; i++) exc[i] = Math.sin(SPRING_TAU * i / wN);
  } else {
    wN = Math.max(8, Math.round(sr / f0)); exc = new Float64Array(wN);
    const beta = 0.45 - 0.25 * pluck, wu = (u) => (u < beta ? 0.5 * u / beta : 0.5 + 0.5 * (u - beta) / (1 - beta));
    const bump = (u) => Math.sin(Math.PI * wu(u)) ** 2;
    let pk = 0;
    for (let i = 0; i < wN; i++) { exc[i] = bump((i + 1) / wN) - bump(i / wN); pk = Math.max(pk, Math.abs(exc[i])); }
    for (let i = 0; i < wN; i++) exc[i] /= pk;
  }
  // a doorstop flick: the finger scrapes off the tip, 6 ms of seeded noise, louder with Pluck (each channel its own)
  const scrN = type === 1 ? Math.round(0.006 * sr) : 0, scr = [new Float64Array(scrN), new Float64Array(scrN)];
  for (const s of scr) { let lq = 0; for (let i = 0; i < scrN; i++) { lq += 0.5 * ((rnd() * 2 - 1) - lq); s[i] = lq * 0.35 * pluck * Math.sin(Math.PI * i / scrN); } }
  const drv = 0.2 + 2.5 * pluck * pluck;
  const Rk = (1 + d.R) / 2, Rl = (1 + d.Rin) / 2, lpf = d.lp, hf = d.h, gl = d.g, swP = SPRING_SWAY_PITCH[type];
  let n = 0;
  return {
    tick() {
      const decay = cfg.sway * Math.exp(-t / swayTau);
      for (let c = 0; c < 2; c++) {
        const C = ch[c], z4 = C.st;
        const sw = decay * Math.sin(SPRING_TAU * cfg.swayRate * t + swayPh0 + c * Math.PI / 2);
        // the delay line at the swayed length: 4-point Lagrange (linear interpolation would low-pass every pass)
        const rp = C.w - C.D0 * (1 + swP * sw), i0 = Math.floor(rp), u = rp - i0, m = C.mask, B = C.buf;
        const fb = springLagrange(B[(i0 - 1) & m], B[i0 & m], B[(i0 + 1) & m], B[(i0 + 2) & m], u);
        let x = fb + (n < wN ? exc[n] : 0) + (n < scrN ? scr[c][n] : 0);
        x = Math.tanh(drv * x) / drv;
        { const y = Rl * (x - C.lx) + d.Rin * C.ly; C.lx = x; C.ly = y; x = y; }   // DC leak (3 Hz, peak gain 1)
        // the dispersion: nS second-order allpasses (state x1 x2 y1 y2 per section)
        for (let k = 0, o = 0; k < nS; k++, o += 4) {
          const s = sec[k], y = s.c2 * x + s.c1 * z4[o] + z4[o + 1] - s.c1 * z4[o + 2] - s.c2 * z4[o + 3];
          z4[o + 1] = z4[o]; z4[o] = x; z4[o + 3] = z4[o + 2]; z4[o + 2] = y; x = y;
        }
        // low-pass (two Butterworth biquads, transposed direct form II)
        for (let b = 0; b < 2; b++) {
          const f = lpf[b], z = C.z, y = f.b0 * x + z[2 * b];
          z[2 * b] = f.b1 * x - f.a1 * y + z[2 * b + 1]; z[2 * b + 1] = f.b2 * x - f.a2 * y; x = y;
        }
        // TAP before the loss filter (the first arrival keeps its top), through a DC blocker OUTSIDE the loop (inside,
        // its loss at the fundamental would compound every pass)
        const yd = Rk * (x - C.dcx) + d.R * C.dcy; C.dcx = x; C.dcy = yd;
        out[c] = yd * (1 + 0.5 * sw);
        C.hp = (1 - hf) * x + hf * C.hp;
        C.buf[C.w & C.mask] = gl * C.hp; C.w++;
      }
      // the mouth on a spring (a "talking" boing), mixed with the dry spring
      if (useMouth) {
        const swv = cfg.sway * Math.sin(SPRING_TAU * cfg.swayRate * t + swayPh0);
        const F2 = mouthAt(swv), F1 = Math.min(800, Math.max(220, 0.42 * F2));
        for (let c = 0; c < 2; c++) { const x = out[c]; out[c] = 0.3 * x + 0.5 * bp(sv[2 * c], x, F1, 5) + 2.0 * bp(sv[2 * c + 1], x, F2, 12); }
      }
      n++; t += dt;
      return out;
    },
  };
}
// The gain that brings one pluck (over shotSec, at most 1 s) to SPRING_RMS, capped so its peak stays under SPRING_PEAK.
// The three types differ by ~20 dB at the same settings (a doorstop's ring against a twang's resonant mouth), so a
// spring preset sits with the other engines with Normalize off. Cached for the session, like creatureLevel.
const SPRING_RMS = 0.15;
const SPRING_PEAK = 0.85;
const SPRING_LEVEL = new Map();
function springLevel(sr, cfg, f0, shotSec, seed) {
  const key = JSON.stringify(cfg) + "|" + f0.toFixed(4) + "|" + shotSec.toFixed(5) + "|" + seed;
  const hit = SPRING_LEVEL.get(key);
  if (hit) return hit;
  const N = Math.max(16, Math.round(Math.min(1, shotSec) * sr)), v = makeSpring(sr, cfg, f0, seed);
  let ss = 0, pk = 0;
  for (let i = 0; i < N; i++) {
    const o = v.tick(f0), a = Math.abs(o[0]), b = Math.abs(o[1]);
    ss += o[0] * o[0] + o[1] * o[1];
    if (a > pk) pk = a;
    if (b > pk) pk = b;
  }
  const rms = Math.sqrt(ss / (2 * N)), g = rms > 1e-9 ? Math.min(SPRING_RMS / rms, SPRING_PEAK / pk) : 1;
  if (SPRING_LEVEL.size > 64) SPRING_LEVEL.clear();
  SPRING_LEVEL.set(key, g);
  return g;
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

// ---------- Servo (wave "servo", #33): electric motors, gearboxes and clockwork, locked to one shaft ----------
// The Machine category's electric sounds were square/saw/sine oscillators with a sweep (Servo Motor, Robot Servo,
// Mechanical Whir, Conveyor Belt, Clockwork Whir). Prototyped in tools/proto/servo.mjs and picked by ear (AJ, 2026-11-11:
// the engine won all five rounds, soundtests/proto-servo/); this block is that model, unchanged in its maths, with its
// knobs mapped from the patch by servoCfg. The sibling of the motor engine (#30): nothing here FIRES, an electric
// motor turns smoothly, and what you hear is the rotation itself, at integer multiples of the shaft speed.
//   target speed(t), load(t) -> THE SHAFT: first-order inertia (spin-up tau; a braked or COASTING spin-down tau), load
//   sags the speed, CURRENT = load + the torque the acceleration asks for (a kick on spin-up; a coasting motor's
//   electrical sound dies at once while its whir spins down). phi = the shaft's revolutions; everything reads it:
//     MAGNETIC WHINE  sum_k a_k sin(2 pi k slots phi), level with the current
//     COMMUTATOR      a smooth x^2 e^-x pulse + a bandpassed SPARK burst per commutation (sub-sample onset), level with
//                     the current; Wear gives each bar its own level (the same pattern every turn)
//     GEAR MESH       per stage: teeth x that stage's input-shaft speed, 3 harmonics; Wear = AM + PM by the input shaft
//                     (sidebands at mesh +- shaft speed)
//     KNOCKS          per turn of a chosen shaft (slats, a chipped tooth, a belt splice, a toy's cam) -> gear-click modes
//     ESCAPEMENT      2 x escape-wheel teeth a turn: a light click as the pallet lets go, the DROP a few ms later, tick / tock on two pallets
//     RATCHET         a winding pawl over the ratchet's teeth, from the start for `Wind for`
//     STOP CLICK      a powered move ends and the shaft settles: the backlash taken up, level with the move's speed;
//                     HOLD BUZZ: a holding servo's corrective kicks at its 50 Hz frame rate
//     SUPPLY HUM      mains-locked (2f the strongest), gated by the power; DRIVE WHINE: a PWM carrier, with the current
//     BEARINGS        band noise with the speed; Rumble a low one (worn rollers)
//   everything mechanical -> the HOUSING (five unity-peak bandpass modes at a Size-set frequency), mixed with dry -> DC
//   block. TYPES gate what is physically there: brushless has no commutator, a bare brushed motor no gears to click,
//   clockwork nothing electric.
// ANTI-ALIASED: every sine passes servoGuard (1 below 0.30 SR, a raised-cosine fade to 0 at 0.42 SR), so a harmonic
// fades out as the shaft speeds it toward Nyquist instead of folding back; the commutator pulse is at least 0.1 ms wide
// (-69 dB at Nyquist); clicks only excite resonators below 0.45 SR. THE POWER CURVE is the engine's own rows
// (servoCurveKf): up to three powered MOVES (at, run for, speed; the first may drift to `Speed at end` and ramp its
// load), the power off between them, or one run from a shaft already turning. The amp envelope stays the GAIN, as for
// any oscillator. Built up front into a mono buffer like the motor's, seeded by the patch's own `servoSeed` ("which
// take"), not salted per layer; servoLevel brings it to a fixed loudness.
const SERVO_G_NORM = 1 / (4 * Math.exp(-2));   // x^2 e^-x peaks at 4e^-2 (x = 2): this brings it to 1
const SERVO_AREA = 2 * SERVO_G_NORM;           // the pulse's area in units of tau (an excitation divides by it)
const SERVO_TWO_PI = 2 * Math.PI;
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name).
// Speeds are rpm on the panel, revolutions a second in the model.
function servoCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  const type = Math.round(g("servoType", 0)), electric = type !== 3;
  const nSt = Math.max(0, Math.min(3, Math.round(g("servoStages", 0)))), stages = [];
  for (let k = 1; k <= nSt; k++) {
    const p = Math.max(1, Math.round(g("servoPinion" + k, 10))), q = Math.max(1, Math.round(g("servoGear" + k, 40)));
    stages.push({ "teeth": p, "ratio": p / q, "amp": g("servoMesh" + k, 0.5) });
  }
  const rps = g("servoSpeed", 6000) / 60, moves = [];
  const at1 = g("servoAt", 0.02), start = Math.round(g("servoStart", 0));
  moves.push({ "at": start ? 0 : at1, "run": g("servoRun", 0.5), "rps": rps, "rpsEnd": rps * g("servoDrift", 1) });
  for (const k of [2, 3]) {
    const run = g("servoRun" + k, 0);
    if (run > 0) moves.push({ "at": g("servoAt" + k, 0), "run": run, "rps": g("servoSpeed" + k, 6000) / 60, "rpsEnd": g("servoSpeed" + k, 6000) / 60 });
  }
  let ref = 0;
  for (const m of moves) ref = Math.max(ref, m.rps, m.rpsEnd);
  const knock = g("servoKnock", 0), ticks = g("servoTicks", 0), ratchet = g("servoRatchet", 0);
  const stop = type === 1 ? 0 : g("servoStop", 0);
  return {
    "type": type, "w0": start ? rps : 0, "ref": ref || 100,
    "inertia": g("servoInertia", 0.08), "decel": g("servoDecel", 0.08), "coast": g("servoCoast", 0.32),
    "brake": Math.round(g("servoBrake", 0)), "sag": g("servoSag", 0.15),
    "wander": g("servoWander", 0), "cog": g("servoCog", 0), "cogN": Math.max(1, Math.round(g("servoCogN", 4))),
    "slots": Math.max(1, Math.round(g("servoSlots", 12))), "whine": electric ? g("servoWhine", 1) : 0,
    "whineK": Math.max(1, Math.round(g("servoWhineHarm", 8))), "whineRoll": g("servoWhineRoll", 1.3),
    "bars": Math.max(0, Math.round(g("servoBars", 6))), "comm": type === 0 || !electric ? 0 : g("servoComm", 1),
    "spark": g("servoSpark", 0.5), "sparkHz": g("servoSparkHz", 4200),
    "stages": stages, "wear": g("servoWear", 0),
    "knock": knock > 0 ? { "stage": Math.round(g("servoKnockShaft", 0)) - 1, "perRev": g("servoKnockRate", 1), "amp": knock, "hz": g("servoKnockHz", 1000) } : null,
    "esc": ticks > 0 ? { "teeth": Math.max(1, Math.round(g("servoEscTeeth", 15))), "amp": ticks, "dropMs": g("servoDrop", 4), "tock": g("servoTock", 0.75) } : null,
    "ratchet": ratchet > 0 ? { "t0": 0, "t1": g("servoRatchetEnd", 0.3), "hz": g("servoRatchetRate", 22), "amp": ratchet } : null,
    "stopClick": stop, "startClick": stop * 0.35, "holdBuzz": type === 1 ? 0 : g("servoHold", 0), "clickHz": g("servoClickHz", 2000),
    "hum": electric ? g("servoHum", 0) : 0, "humHz": g("servoHumHz", 60),
    "pwm": electric ? g("servoPwm", 0) : 0, "pwmHz": g("servoPwmHz", 9000),
    "bearing": g("servoBearing", 0.12), "bearingHz": g("servoBearingHz", 7000), "rumble": g("servoRumble", 0),
    "size": g("servoSize", 0.4), "body": g("servoBody", 0.5), "pawlHz": g("servoPawlHz", 3400),
    "curve": { "moves": moves, "load": g("servoLoad", 0.3), "loadEnd": g("servoLoadEnd", 0.3), "off": g("servoOffLoad", 0.3) },
  };
}
// the power curve as keyframes [t, target rps, load]: the power off (0) before, between and after the moves. A move at
// 0 starts at once (no keyframe at rest first, so a shaft already turning is powered from its first sample).
function servoCurveKf(c) {
  const kf = [];
  c.moves.forEach((m, k) => {
    const LE = k === 0 ? c.loadEnd : c.load, before = k === 0 ? c.load : c.off;
    if (m.at > 0) { if (!kf.length) kf.push([0, 0, before]); kf.push([m.at, 0, before]); }
    const end = Math.round((m.at + m.run) * 1e6) / 1e6;   // to the microsecond: 0.03 + 0.35 is 0.38, not 0.37999...
    kf.push([m.at, m.rps, c.load], [end, m.rpsEnd, LE], [end, 0, c.off]);
  });
  return kf;
}
// linear (the shaft's inertia does the easing; two keyframes at one time make a step, as a controller switches)
function servoCurveAt(kf, t) {
  if (t <= kf[0][0]) return { "rps": kf[0][1], "load": kf[0][2] };
  for (let k = 1; k < kf.length; k++) {
    if (t <= kf[k][0]) {
      const a = kf[k - 1], b = kf[k], u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
      return { "rps": a[1] + (b[1] - a[1]) * u, "load": a[2] + (b[2] - a[2]) * u };
    }
  }
  const z = kf[kf.length - 1];
  return { "rps": z[1], "load": z[2] };
}
function servoRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// TPT state-variable filter; bpn is the UNITY-PEAK bandpass (k v1)
function servoSvf(sr) {
  let ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0, k = 1;
  const f = {
    "lp": 0, "bpn": 0, "hp": 0,
    set(fc, q) {
      const gg = Math.tan(Math.PI * Math.min(Math.max(fc, 10), sr * 0.45) / sr);
      k = 1 / q; a1 = 1 / (1 + gg * (gg + k)); a2 = gg * a1; a3 = gg * a2;
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
// a bank of 2-pole resonators [freq, T60, level]: impulse response ~ level e^(-t/tau) sin(wt) per unit-AREA input
function servoModes(sr, list) {
  const m = list.filter((e) => e[0] < sr * 0.45).map((e) => {
    const r = Math.exp(-6.9 / (e[1] * sr)), th = 2 * Math.PI * e[0] / sr;
    return { "c1": 2 * r * Math.cos(th), "c2": -r * r, "g": Math.sin(th) * e[2], "y1": 0, "y2": 0 };
  });
  return (x) => { let s = 0; for (const q of m) { const v = q.c1 * q.y1 + q.c2 * q.y2 + q.g * x; q.y2 = q.y1; q.y1 = v; s += v; } return s; };
}
function servoShape(x) { return x <= 0 ? 0 : x * x * Math.exp(-x) * SERVO_G_NORM; }
// 1 below 0.30 SR, a raised-cosine fade to 0 at 0.42 SR, 0 above: a harmonic fades before it can fold
function servoGuard(f, sr) { return f < 0.3 * sr ? 1 : f >= 0.42 * sr ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (f - 0.3 * sr) / (0.12 * sr)); }
// A running motor (or gear train, or clockwork). tick(target rev/s, load 0..1) -> one sample. cfg: servoCfg's shape.
function makeServo(sr, cfg, seed) {
  const rnd = servoRng(seed);
  const TWO_PI = SERVO_TWO_PI;
  const slots = cfg.slots, whine = cfg.whine, whineK = cfg.whineK, whineRoll = cfg.whineRoll;
  const wA = [];
  for (let k = 0; k < whineK; k++) wA.push(Math.pow(k + 1, -whineRoll));
  const bars = cfg.bars, comm = bars ? cfg.comm : 0, spark = cfg.spark;
  const wear = cfg.wear;
  const barAmp = [];
  for (let k = 0; k < Math.max(1, bars); k++) barAmp.push(1 + wear * 0.7 * (rnd() * 2 - 1));
  const stages = cfg.stages;
  const rIn = [], rOut = [];
  let rr = 1;
  for (const s of stages) { rIn.push(rr); rr *= s.ratio; rOut.push(rr); }
  const meshH = [1, 0.45, 0.2];
  const hum = cfg.hum, humHz = cfg.humHz, pwm = cfg.pwm, pwmHz = cfg.pwmHz;
  const bearing = cfg.bearing, rumble = cfg.rumble;
  const minTau = 0.1e-3 * sr;
  const stopClick = cfg.stopClick, startClick = cfg.startClick;
  const holdBuzz = cfg.holdBuzz, frameHz = 50;
  const tauUp = cfg.inertia, tauDec = cfg.decel, tauCoast = cfg.coast;
  const sag = cfg.sag, ref = cfg.ref;
  // the housing: 5 unity-peak bandpass modes at a size-set frequency
  const size = cfg.size, bodyMix = cfg.body, bodyHz = 2600 * Math.pow(2, -size * 3.5);
  const bodyModes = [1, 1.71, 2.62, 3.93, 5.4].map((r, k) => {
    const f = bodyHz * r * (1 + 0.02 * (rnd() * 2 - 1)), t60 = (0.03 + 0.2 * size) / Math.sqrt(r), F = servoSvf(sr);
    F.set(f, Math.max(1.5, Math.PI * f * t60 / 6.91));
    return { "F": F, "g": Math.pow(r, -0.4) * (k & 1 ? -1 : 1) };
  });
  // click banks: gear clicks (stop, hold), knocks, two pallets (tick, tock), the ratchet
  const ch = cfg.clickHz;
  const gearBank = servoModes(sr, [[ch, 0.05, 1], [ch * 1.62, 0.035, 0.8], [ch * 2.71, 0.022, 0.6], [ch * 3.9, 0.015, 0.45], [ch * 0.41, 0.06, 0.7]]);
  const knockHz = cfg.knock ? cfg.knock.hz : ch * 0.7;
  const knockBank = servoModes(sr, [[knockHz, 0.08, 1], [knockHz * 1.83, 0.05, 0.7], [knockHz * 2.9, 0.03, 0.5], [knockHz * 0.47, 0.09, 0.8]]);
  const ph = cfg.pawlHz, pawlR = [[1, 0.05, 1], [1.48, 0.035, 0.8], [2.21, 0.025, 0.6], [2.93, 0.018, 0.45], [3.87, 0.012, 0.35]];
  const pawlA = servoModes(sr, pawlR.map((e) => [ph * e[0], e[1], e[2]]));
  const pawlB = servoModes(sr, pawlR.map((e) => [ph * 0.93 * e[0] * (1 + 0.015 * e[0]), e[1] * 0.9, e[2]]));
  const rh = 4300;
  const ratchetBank = servoModes(sr, [[rh, 0.02, 1], [rh * 1.53, 0.014, 0.7], [rh * 2.4, 0.009, 0.5], [rh * 0.36, 0.03, 0.5]]);
  const sparkF = servoSvf(sr); sparkF.set(cfg.sparkHz, 1.1);
  const bearF = servoSvf(sr); bearF.set(cfg.bearingHz, 0.9);
  const rumF = servoSvf(sr); rumF.set(180, 0.7);
  let w = cfg.w0, phi = 0, loadS = 0, I = 0, pow = 0, i = 0, t = 0;
  let peakW = 0, wasPowered = false, holding = false, holdPos = 0, ratchetPos = 0, tickN = 0;
  let wn = 0, wTarget = 0, wCount = 0, dcx = 0, dcy = 0;
  const kLoad = 1 - Math.exp(-1 / (0.03 * sr)), kI = 1 - Math.exp(-1 / (0.002 * sr)), kPow = 1 - Math.exp(-1 / (0.01 * sr));
  const kWn = 1 - Math.exp(-TWO_PI * 3 / sr), dcK = Math.exp(-TWO_PI * 15 / sr);
  const esc = cfg.esc, knock = cfg.knock, ratchet = cfg.ratchet;
  let pCommPos = bars * phi, pKnockPos = 0, pEscPos = esc ? 2 * esc.teeth * phi + 0.85 : 0;
  const pulses = [];   // { t0, tau, a, v }: v 0 commutator tone, 1 spark envelope, 2 gear clicks, 3 knock, 4 pawl A, 5 pawl B, 6 ratchet
  function spawn(at, tau, a, v) { if (pulses.length < 128) pulses.push({ "t0": at, "tau": Math.max(v <= 1 ? minTau : 0.03e-3 * sr, tau), "a": a, "v": v }); }
  // a unit-area excitation (for a resonator): the pulse's amplitude divided by its area
  function strike(at, tauS, a, v) { const tau = Math.max(0.03e-3 * sr, tauS); spawn(at, tau, a / (SERVO_AREA * tau), v); }
  // integer crossings of a position between two samples: fn(t0) at each sub-sample instant
  function crossings(p0, p1, fn) { if (!(p1 > p0)) return; for (let m = Math.floor(p0) + 1; m <= p1; m++) fn(i - 1 + (m - p0) / (p1 - p0)); }
  const acc = new Float64Array(7);
  return {
    tick(target, load) {
      i++; t = i / sr;
      loadS += (load - loadS) * kLoad;
      const powered = target > 0.01;
      pow += ((powered ? 1 : 0) - pow) * kPow;
      // the shaft
      const tgt = target * (1 - sag * loadS);
      const tau = tgt >= w ? tauUp : (powered || cfg.brake ? tauDec : tauCoast);
      const dw = (tgt - w) / (tau * sr);
      w = Math.max(0, w + dw);
      const accel = Math.abs(dw) * sr * tau / Math.max(1, ref);   // 1 at a full-scale step
      const Iwant = powered ? 0.12 + 0.6 * loadS + Math.min(1.2, accel) : (cfg.brake && w > 0.5 ? Math.min(1, accel) * 0.7 : 0);
      I += (Iwant - I) * kI;
      if (--wCount <= 0) { wTarget = rnd() * 2 - 1; wCount = (0.09 * sr) | 0; }
      wn += (wTarget - wn) * kWn;
      const wEff = w * (1 + cfg.wander * 0.025 * wn + cfg.cog * 0.02 * Math.sin(TWO_PI * cfg.cogN * phi));
      phi += wEff / sr;
      const sg = w / (w + 2);   // nothing audible from a shaft that is barely turning
      let tonal = 0;
      // magnetic whine
      if (whine && slots) {
        const f1 = slots * wEff, amp = whine * (0.08 + I) * sg;
        for (let k = 0; k < whineK; k++) { const gd = servoGuard(f1 * (k + 1), sr); if (gd <= 0) break; tonal += amp * wA[k] * gd * Math.sin(TWO_PI * ((k + 1) * slots * phi % 1)); }
      }
      // commutator: a pulse + a spark burst per commutation
      if (comm) {
        const p1 = bars * phi;
        crossings(pCommPos, p1, (at) => {
          const bar = Math.floor(p1) % bars, a = barAmp[bar] * (0.15 + I) * sg * (1 + 0.15 * (rnd() * 2 - 1));
          const period = sr / Math.max(1, bars * wEff);
          spawn(at, Math.min(1.5e-3 * sr, Math.max(minTau, 0.12 * period)), comm * a, 0);
          spawn(at, Math.min(2e-3 * sr, 0.25 * period), comm * spark * a * (0.6 + 0.8 * rnd()), 1);
        });
        pCommPos = p1;
      }
      // gear mesh, per stage; wear = AM + PM by the stage's input shaft
      for (let s = 0; s < stages.length; s++) {
        const sti = stages[s], phIn = phi * rIn[s], fm = sti.teeth * wEff * rIn[s];
        const mod = 1 + wear * (0.6 * Math.cos(TWO_PI * phIn) + 0.3 * Math.cos(2 * TWO_PI * phIn));
        const pm = wear * 0.5 * Math.sin(TWO_PI * phIn);
        const amp = sti.amp * (0.3 + 0.5 * loadS + 0.4 * Math.min(1, I)) * sg * mod;
        const base = sti.teeth * phIn;
        for (let h = 0; h < 3; h++) { const gd = servoGuard(fm * (h + 1), sr); if (gd <= 0) break; tonal += amp * meshH[h] * gd * Math.sin(TWO_PI * ((h + 1) * base % 1) + (h + 1) * pm); }
      }
      // knocks on a chosen shaft
      if (knock) {
        const p1 = knock.perRev * phi * (knock.stage >= 0 && knock.stage < rOut.length ? rOut[knock.stage] : 1);
        crossings(pKnockPos, p1, (at) => { strike(at, 0.08e-3 * sr, knock.amp * (1 + (0.25 + wear * 0.5) * (rnd() * 2 - 1)) * Math.min(1, sg * 1.5), 3); });
        pKnockPos = p1;
      }
      // escapement: the pallet lets go, then the drop; tick and tock alternate pallets
      if (esc) {
        const p1 = 2 * esc.teeth * phi + 0.85;
        crossings(pEscPos, p1, (at) => {
          const v = (tickN++ & 1) ? 5 : 4, lvl = esc.amp * ((v === 5) ? esc.tock : 1) * (1 + 0.12 * (rnd() * 2 - 1));
          strike(at, 0.05e-3 * sr, lvl * 0.35, v);
          strike(at + esc.dropMs * 1e-3 * sr * (1 + 0.2 * (rnd() * 2 - 1)), 0.04e-3 * sr, lvl, v);
        });
        pEscPos = p1;
      }
      // ratchet (winding)
      if (ratchet && t >= ratchet.t0 && t < ratchet.t1) {
        const p1 = ratchetPos + ratchet.hz * (1 + 0.25 * wn) / sr;
        crossings(ratchetPos, p1, (at) => { strike(at, 0.04e-3 * sr, ratchet.amp * (0.8 + 0.4 * rnd()), 6); });
        ratchetPos = p1;
      }
      // start / stop clicks and the holding buzz
      if (powered) {
        if (!wasPowered && startClick) strike(i, 0.06e-3 * sr, startClick * 0.5, 2);
        peakW = Math.max(peakW, w); holding = false;
      } else if (peakW > 0 && w < 0.1 * peakW) {
        if (stopClick) strike(i, 0.07e-3 * sr, stopClick * Math.sqrt(Math.min(1, peakW / ref)), 2);
        peakW = 0; holding = true; holdPos = 0;
      }
      wasPowered = powered;
      if (holding && holdBuzz) {
        const p1 = holdPos + frameHz * (1 + 0.04 * wn) / sr;
        crossings(holdPos, p1, (at) => { strike(at, 0.1e-3 * sr, holdBuzz * (0.3 + 0.7 * rnd()), 2); });
        holdPos = p1;
      }
      // sum the live pulses
      acc.fill(0);
      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k], x = (i - p.t0) / p.tau;
        if (x > 30) { pulses[k] = pulses[pulses.length - 1]; pulses.pop(); continue; }
        acc[p.v] += p.a * servoShape(x);
      }
      const n1 = rnd() * 2 - 1, n2 = rnd() * 2 - 1;
      const sparkOut = acc[1] ? sparkF.run(n1 * acc[1]) * 1.6 : sparkF.run(0) * 1.6;
      const clicks = gearBank(acc[2]) * 1.8, knocks = knockBank(acc[3]) * 1.2;
      const ticks = pawlA(acc[4]) + pawlB(acc[5]) + ratchetBank(acc[6]) * 0.8;
      // electrical
      let elec = 0;
      if (hum) { const p = TWO_PI * humHz * t; elec += hum * pow * (0.35 * Math.sin(p) + Math.sin(2 * p) + 0.25 * Math.sin(4 * p) + 0.12 * Math.sin(6 * p)); }
      if (pwm) elec += pwm * Math.min(1, I) * servoGuard(pwmHz, sr) * Math.sin(TWO_PI * pwmHz * t);
      // the structure, through the housing
      const struct = tonal + acc[0] * 0.6 + sparkOut + clicks + knocks + ticks * 0.35;
      let body = 0;
      for (const m of bodyModes) body += m.g * m.F.run(struct);
      // bearings and rumble ride on the speed
      const sp = Math.min(1.5, w / Math.max(1, ref));
      const air = bearing * sp * (1 + wear) * bearF.run(n2) + rumble * sp * rumF.run(n1) * 2.5;
      const out = struct + bodyMix * body * 1.5 + ticks * 0.65 + air + elec;
      const dc = out - dcx + dcK * dcy;
      dcx = out; dcy = dc;
      return dc;
    },
  };
}
// The whole sound: n samples of the motor run along its power curve (mono), with a 3 ms fade in and 8 ms out.
function servoBuffer(sr, n, cfg, seed) {
  const x = new Float32Array(n), m = makeServo(sr, cfg, seed), kf = servoCurveKf(cfg.curve);
  for (let k = 0; k < n; k++) { const c = servoCurveAt(kf, k / sr); x[k] = m.tick(c.rps, c.load); }
  const fi = Math.min(n, Math.round(0.003 * sr)), fo = Math.min(n, Math.round(0.008 * sr));
  for (let k = 0; k < fi; k++) x[k] *= k / fi;
  for (let k = 0; k < fo; k++) x[n - 1 - k] *= k / fo;
  return x;
}
// Bring a servo buffer to SERVO_RMS (over the samples that sound), its peak capped at SERVO_PEAK: a clockwork's ticks
// and a servo's stop click are peakier than a held whir, so one RMS target keeps the types near one loudness with
// Normalize off (the motor engine's rule). In place.
const SERVO_RMS = 0.12;
const SERVO_PEAK = 0.9;
function servoLevel(x) {
  let ss = 0, pk = 0, on = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; if (a > 1e-5) { ss += x[i] * x[i]; on++; } }
  if (!on || pk < 1e-9) return;
  const g = Math.min(SERVO_RMS / Math.sqrt(ss / on), SERVO_PEAK / pk);
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

// ---------- Friction (wave "friction", #34): creaks, squeaks and squeals, stick-slip on a resonant body ----------
// The creaks and squeaks were plain oscillators with vibrato through a resonant filter (Creaking Door, Trapdoor Creak,
// Squeaky Toy, Heavy Gate). Prototyped in tools/proto/friction.mjs and picked by ear (AJ, 2026-11-11: the engine won all
// five rounds, soundtests/proto-friction/); this block is that model, unchanged in its maths, with its knobs mapped from
// the patch by frictionCfg. A creak is a surface CATCHING and RELEASING: a contact dragged along a surface under a
// pressure grips (static friction), the load builds in a contact spring, it slips when the load passes pressure x static
// friction, the friction falls with sliding speed (the Stribeck curve, the same negative slope that drives the bowed
// string above), the stored load snaps into the body, and it grips again.
//   slow and heavy -> separate ticks whose RATE follows the speed (a door's "crk-crk-crk")
//   faster         -> the ticks run together into a groan whose rate is its pitch
//   a ringing body -> the slips LOCK to a body mode, as a bow's lock to a string, and it squeals at that mode
//   contact (mode 0, a compliant spring at the Contact stiffness) + the BODY's modes (frictionModes: wood panel, iron,
//   rubber with an air cavity, wood on an iron pin), every mode coupled to the contact TWO WAYS (the body's motion at the
//   contact enters the friction law: that is what lets it lock), symplectic Euler pre-warped so each rings at its own
//   frequency -> stick/slip solved CONSISTENTLY with the step (McIntyre-Schumacher-Woodhouse: gripping is the zero-slip
//   solution while the force it needs stays under N x static friction; otherwise Newton on u = |vr| - G*N*mu(u)) ->
//   the heard sum -> a 25 Hz DC block.
// Found building it, each by failing: noise on the SPEED made the contact chatter at the integrator's rate (the gripping
// force is speed error / G, and G scales with the time step), so the grit is low-passed noise on the FRICTION; the
// Stribeck velocity sits at 0.12 of a slip's velocity (at 0.35 a slip released a fraction of its load and the rate stopped
// following the speed, at 0.05 iron stops locking); the speed knob maps to the slip rate through the STATIC stiffness of
// the contact and the body in series (a compliant body otherwise slowed a creak 10x); the contact is a patch, so coupling
// rolls off past 4 kHz. ANTI-ALIASED: the contact runs at 4x (the stick/slip switch is a force discontinuity) and is
// decimated through a windowed-sinc FIR; a body mode past 0.45 SR is dropped. THE PUSH is the engine's own rows
// (frictionCfg): the drag speed at the start and at up to three times after it, a time it stops, and the pressure the
// same way, eased between points (smoothstep), the speed eased in over 15 ms. The amp envelope stays the GAIN, as for any
// oscillator. Built up front into a mono buffer like the servo's, seeded by the body's pitch and the patch's own
// `fricSeed` ("which take"), not salted per layer; frictionLevel brings it to a fixed loudness (the bodies differ ~40 dB
// raw). The model is CHAOTIC near a regime boundary: another seed can turn a squeal into ticks, so a preset names its seed.
const FRICTION_OS = 4;            // the contact runs at 4x (a locked iron squeal's top octave read 6.2 dB off an 8x reference at 2x, 3.2 at 4x)
const FRICTION_TAPS_PER_OS = 24;  // decimator FIR length per oversampling step (windowed sinc, cutoff 0.45 of the output rate)
const FRICTION_PATCH_HZ = 4000;   // the contact patch's size, as the body mode it stops coupling to
const FRICTION_MU_S = 1;          // static friction (the scale: only the contrast matters)
const FRICTION_GRIT = 0.015;      // fine grit on the friction (low-passed noise): what keeps a steady push from being a clock
const FRICTION_RATE_MIN = 3;      // slip rate at speed 0+ (per second, at pressure 0.5 on a plain surface)
const FRICTION_RAMP = 0.015;      // the push eases in over 15 ms (a hand or a pad starting)
// The contact spring's damping ratio and how much of it is heard, per body (index = the `fricBody` enum, append-only).
const FRICTION_CONTACT = [[0.06, 0.05], [0.05, 0.02], [0.04, 0.5], [0.06, 0.04]];
// The body's modes for a base frequency f0 (the patch's Frequency): per mode its frequency, T60 (s), `g` (how compliant
// the body is AT THE CONTACT, relative to the contact spring: what decides whether the slips lock to it) and `rad` (how
// much of its motion is heard). `rnd` is the model's own generator, drawn in this order (the takes depend on it).
function frictionModes(body, f0, rnd) {
  const m = [];
  if (body === 0 || body === 3) {
    // WOOD: a panel. Dense, low-Q, the highs die fast; slips lock to nothing, so the rate follows the speed.
    for (let k = 0; k < 16; k++) {
      const f = f0 * (1 + 0.85 * Math.pow(k, 1.25)) * (1 + 0.07 * (rnd() * 2 - 1));
      m.push({ "f": f, "t60": 0.11 * Math.pow(f0 / f, 0.55) * Math.pow(220 / f0, 0.3), "g": 0.04 * Math.pow(f0 / f, 0.5), "rad": Math.pow(f0 / f, 0.25) * (0.6 + 0.4 * rnd()) * (k & 1 ? -1 : 1) });
    }
    if (body === 0) return m;
    // HINGED WOOD: the panel's first 12 under an iron pin's three high modes (where it squeaks)
    m.length = 12;
    const pin = [[7.1, 0.35, 0.35], [11.3, 0.25, 0.12], [17.9, 0.18, 0.05]];
    for (const p of pin) m.push({ "f": f0 * p[0], "t60": p[1], "g": p[2], "rad": 0.45 });
    return m;
  }
  if (body === 1) {
    // IRON: a hinge, a bar, a gate. Sparse inharmonic free-bar modes, a long ring; the first modes are compliant at the
    // contact, so a fast push LOCKS onto one and squeals.
    const r = [1, 2.756, 5.404, 8.933, 13.34, 18.64, 24.8, 31.9];
    for (let k = 0; k < r.length; k++) {
      const f = f0 * r[k] * (1 + 0.01 * (rnd() * 2 - 1));
      m.push({ "f": f, "t60": 0.9 * Math.pow(400 / f0, 0.35) * Math.pow(1 / r[k], 0.45), "g": 0.9 * Math.pow(1 / r[k], 1.2), "rad": Math.pow(1 / r[k], 0.15) * (k & 1 ? -1 : 1) });
    }
    return m;
  }
  // RUBBER: a hollow squeeze toy. One air-cavity mode (the most compliant thing at the contact, so the squeak sits on it)
  // and two broad formants; its soft contact is heard too (the squeak itself).
  m.push({ "f": f0, "t60": 0.06, "g": 1.4, "rad": 1 }, { "f": f0 * 2.03, "t60": 0.035, "g": 0.25, "rad": 0.6 },
    { "f": f0 * 3.4, "t60": 0.02, "g": 0.08, "rad": 0.45 }, { "f": f0 * 5.6, "t60": 0.012, "g": 0.03, "rad": 0.3 });
  return m;
}
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name).
// The push: a start value and up to three (time, value) points after it (a time of 0 = unused), the speed's last a
// stop time (0 = it never stops); a point at or before the one before it is skipped.
function frictionCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  const pts = (k0, kt, kv) => {
    const p = [[0, g(k0, 0.5)]];
    for (let k = 1; k <= 3; k++) { const t = g(kt + k, 0); if (t > p[p.length - 1][0]) p.push([t, g(kv + k, 0.5)]); }
    return p;
  };
  const speed = pts("fricSpeed", "fricT", "fricSpeed"), stop = g("fricStop", 0);
  if (stop > speed[speed.length - 1][0]) speed.push([stop, 0]);
  return {
    "body": Math.max(0, Math.min(FRICTION_CONTACT.length - 1, Math.round(g("fricBody", 0)))),
    "bodyHz": g("freq", 440),
    "contactHz": 150 * Math.pow(20, g("fricTone", 0.4)),
    "grip": 0.15 + 0.7 * g("fricGrip", 0.5),
    "rough": g("fricRough", 0.3),
    "lock": g("fricLock", 0.3),
    "speed": speed,
    "press": pts("fricPress", "fricPressT", "fricPress"),
  };
}
// a breakpoint curve, eased between points (smoothstep), held before the first and after the last
function frictionCurveAt(p, t) {
  if (t <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const t0 = p[i - 1][0], a = p[i - 1][1], b = p[i][1], u = (t - t0) / Math.max(1e-9, p[i][0] - t0), s = u * u * (3 - 2 * u);
      return a + (b - a) * s;
    }
  }
  return p[p.length - 1][1];
}
// smooth, seeded value noise
function frictionNoise(seed) {
  const h = (i) => { let x = (Math.imul(i | 0, 0x27d4eb2d) ^ seed) >>> 0; x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
  return (t) => { const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f); return h(i) * (1 - s) + h(i + 1) * s; };
}
// One contact on one body. tick(speed 0..1, pressure 0..1) -> one sample at `sr`.
function makeFriction(sr, cfg, seedIn) {
  let seed = (seedIn >>> 0) || 0x5f1c7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const isr = sr * FRICTION_OS, dt = 1 / isr;
  const ct = FRICTION_CONTACT[cfg.body];
  // the contact spring is mode 0 (g = 1, so every body mode's g is its compliance relative to the contact); a mode past
  // 0.45 SR is dropped (it would fold); coupling rolls off past the patch's frequency (second order)
  const raw = [{ "f": cfg.contactHz, "t60": 0, "zeta": ct[0], "g": 1, "rad": ct[1] }];
  for (const m of frictionModes(cfg.body, cfg.bodyHz, rnd)) {
    if (m.f < sr * 0.45) raw.push({ "f": m.f, "t60": m.t60, "g": m.g * (0.15 + 1.7 * cfg.lock) / (1 + Math.pow(m.f / FRICTION_PATCH_HZ, 2)), "rad": m.rad });
  }
  const n = raw.length, w2 = new Float64Array(n), dmp = new Float64Array(n), gk = new Float64Array(n), rad = new Float64Array(n);
  const x = new Float64Array(n), v = new Float64Array(n), vf = new Float64Array(n);
  let G = 0;
  for (let k = 0; k < n; k++) {
    const m = raw[k], w = 2 * isr * Math.sin(Math.PI * m.f / isr);   // pre-warped: symplectic Euler then rings at m.f
    w2[k] = w * w;
    dmp[k] = 2 * (m.t60 > 0 ? 6.9078 / m.t60 : m.zeta * 2 * Math.PI * m.f);
    gk[k] = m.g; rad[k] = m.rad; G += m.g * dt;
  }
  // speed knob -> the relaxation slip rate (log from FRICTION_RATE_MIN to the contact frequency, at pressure 0.5),
  // through the static stiffness of the contact and the body in series
  const w0 = 2 * Math.PI * cfg.contactHz, dmu = FRICTION_MU_S * cfg.grip, muD = FRICTION_MU_S - dmu;
  let comp = 0;
  for (let k = 0; k < n; k++) comp += gk[k] / w2[k];
  const kEff = 1 / comp, vSlip = 2 * 0.5 * dmu / w0, vStrib = 0.12 * vSlip;
  const speedToV = (s) => (s > 0 ? FRICTION_RATE_MIN * Math.pow(cfg.contactHz / FRICTION_RATE_MIN, s) * 2 * 0.5 * dmu / kEff : 0);
  const mu = (sv, muS) => muD + (muS - muD) * Math.exp(-sv / vStrib);
  const grain = frictionNoise(((seedIn >>> 0) ^ 0x9e3779b9) >>> 0), handV = frictionNoise(((seedIn >>> 0) ^ 0x7f4a7c15) >>> 0), handN = frictionNoise(((seedIn >>> 0) ^ 0x2545f491) >>> 0);
  const grainLen = speedToV(0.35) / 25;          // the catch varies along the surface on this scale: felt as texture
  const gritA = 1 - Math.exp(-2 * Math.PI * 1500 / isr);
  let travel = 0, t = 0, grit = 0;
  // the decimator: a Blackman-windowed sinc at 0.45 of the output rate, evaluated once per output sample
  const taps = FRICTION_TAPS_PER_OS * FRICTION_OS, fir = new Float64Array(taps), hist = new Float64Array(taps * 2);
  let fs = 0;
  for (let i = 0; i < taps; i++) {
    const c = i - (taps - 1) / 2, a = 2 * 0.45 / FRICTION_OS;
    const sinc = c === 0 ? a : Math.sin(Math.PI * a * c) / (Math.PI * c), win = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (taps - 1));
    fir[i] = sinc * win; fs += fir[i];
  }
  for (let i = 0; i < taps; i++) fir[i] /= fs;
  let hw = 0, dcx = 0, dcy = 0;
  const hpA = Math.exp(-2 * Math.PI * 25 / sr);
  function step(speed, press) {
    const rough = cfg.rough;
    const hv = 1 + rough * 0.45 * handV(t * 3.1) + rough * 0.2 * handV(t * 11.7 + 50);   // an unsteady hand
    const N = Math.max(0.02, press) * (1 + rough * 0.25 * handN(t * 2.3));
    const V = speedToV(speed) * Math.max(0, hv);
    travel += V * dt; t += dt;
    // static friction varies with POSITION along the surface (grain, rust, a knot), plus the fine grit
    grit += gritA * ((rnd() * 2 - 1) - grit);
    const muS = FRICTION_MU_S * (1 + rough * 0.6 * grain(travel / grainLen) + FRICTION_GRIT * 4 * grit);
    const kc = Math.pow(N / 0.5, 1 / 3);           // a stiffer contact under more pressure (Hertz: k ~ N^(1/3))
    let vc = 0;
    for (let k = 0; k < n; k++) {                  // the free step; the contact's velocity is the sum of the modes'
      const a = -(k === 0 ? w2[0] * kc : w2[k]) * x[k] - dmp[k] * v[k];
      vf[k] = v[k] + dt * a; vc += vf[k];
    }
    const vr = V - vc, Fst = vr / G;               // the force that would keep it gripping
    let F;
    if (Math.abs(Fst) <= N * muS) F = Fst;
    else {
      const a = Math.abs(vr), c = G * N;
      let u = Math.max(0, a - c * muS);
      for (let it = 0; it < 4; it++) {             // Newton: h(u) = u - a + c*mu(u), monotonic here
        const e = Math.exp(-u / vStrib), h = u - a + c * (muD + (muS - muD) * e), dh = 1 - c * (muS - muD) / vStrib * e;
        u = Math.max(0, u - h / dh);
      }
      F = N * mu(u, muS) * Math.sign(vr);
    }
    let o = 0;
    for (let k = 0; k < n; k++) { v[k] = vf[k] + dt * gk[k] * F; x[k] += dt * v[k]; o += rad[k] * v[k]; }
    return o;
  }
  return {
    tick(speed, press) {
      for (let j = 0; j < FRICTION_OS; j++) { hist[hw] = hist[hw + taps] = step(speed, press); hw = hw + 1 === taps ? 0 : hw + 1; }
      let y = 0;
      for (let i = 0; i < taps; i++) y += fir[i] * hist[hw + i];
      const h = hpA * (dcy + y - dcx); dcx = y; dcy = h;   // the contact spring's slow load is not sound
      return h / vSlip;
    },
  };
}
// The whole sound: n samples of the contact dragged along its push (mono), with a 5 ms fade in and 10 ms out. The seed
// is the body's pitch and the patch's Variation together (as the round seeded each take).
function frictionBuffer(sr, n, cfg, seed) {
  const x = new Float32Array(n), f = makeFriction(sr, cfg, seed);
  for (let i = 0; i < n; i++) {
    const t = i / sr, s = frictionCurveAt(cfg.speed, t) * (t < FRICTION_RAMP ? 0.5 - 0.5 * Math.cos(Math.PI * t / FRICTION_RAMP) : 1);
    const y = f.tick(s, frictionCurveAt(cfg.press, t));
    x[i] = isFinite(y) ? y : 0;
  }
  const fi = Math.min(n, Math.round(0.005 * sr)), fo = Math.min(n, Math.round(0.01 * sr));
  for (let i = 0; i < fi; i++) x[i] *= i / fi;
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= i / fo;
  return x;
}
// Bring a friction buffer to FRICTION_RMS (over the samples that sound), its peak capped at FRICTION_PEAK: a wood creak's
// ticks are far peakier than a locked squeal, and the bodies differ ~40 dB raw, so one RMS target keeps them near one
// loudness with Normalize off (the motor engine's rule). In place.
const FRICTION_RMS = 0.12;
const FRICTION_PEAK = 0.9;
function frictionLevel(x) {
  let ss = 0, pk = 0, on = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; if (a > 1e-5) { ss += x[i] * x[i]; on++; } }
  if (!on || pk < 1e-9) return;
  const g = Math.min(FRICTION_RMS / Math.sqrt(ss / on), FRICTION_PEAK / pk);
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

// ---------- Flow (wave "flow", #35): moving water (a stream, a waterfall, surf, pouring into a vessel) ----------
// The moving water in "Nature" was a sine plus filtered noise, and "Water / Liquid" the bubble engine (wave 14), which
// does single bubbles but scatters them uniformly: no BODY of water. Prototyped in tools/proto/flow.mjs and picked by ear
// (AJ, 2026-11-11: it won or matched all five rounds, soundtests/proto-flow/); this block is that model, unchanged in its
// maths, with its knobs mapped from the patch by flowCfg.
//   STREAM     POCKETS (a gap behind a stone, an eddy), each with one bubble size, a pan and a FIGURE (how many
//              bubbles, how far apart), firing clusters of Minnaert bubbles (f0 = 3.26/r, van den Doel's damping, pitch
//              rising as it rings) that RECUR: `babble` sets how regularly (0 Poisson .. 1 near-periodic) and how often a
//              pocket repeats its figure. Some pockets are cavities (a hollow noise-excited tonk), others lead with a slap;
//              pockets wash out and re-form every few seconds. Loose fizz (growing with flow squared) and turbulent noise.
//   WATERFALL  the dense limit: 500-6000 bubbles a second at equal ENERGY across a wide size spread, merging into a
//              roar pitched where the commonest size rings, plus impact thunder at the base (a swelling low rumble and
//              thumps of mass landing) and spray hiss (gone with distance).
//   SURF       cyclic, every `period` s with each wave's size and timing jittered: the swell BUILDS, the wave BREAKS (a
//              crash spilling along the front, so it travels across the field, a thump, then a FOAM fizz of tiny
//              bubbles), WASHES up the beach and DRAWS BACK (a receding hiss for sand, stones knocking for pebbles:
//              `drawback` crossfades them). The crash grows with wave size squared, the wash only with it, so a small
//              wave mostly washes. A far bed of other waves under it. `waves` > 0 makes it a one-shot.
//   POUR       a jet into a vessel: its turbulence and entrained bubbles drive the air column over the liquid (a
//              quarter-wave tube closed at the surface, modes 1, 3, 5: f = c / 4 (L_air + 0.6 r_mouth)), which rises
//              hyperbolically as it fills. `vessel` runs from a narrow tall bottle (Q ~30, it rings) to a wide glass
//              (Q ~6); `babble` is GLUGGING (the pouring bottle stutters as air gulps back in). It fills over the
//              patch's duration.
// Built up front into a stereo buffer like the weather's, with the AMP ENVELOPE AS ITS DRIVE: a stream's and a
// waterfall's flow (their event rates and bed, so a release lets entrained bubbles ring out), the surf's gain (the
// cycle runs on its own clock), the pour's jet (excitation and how fast it fills). So render's gain stage skips it.
// Seeded by the patch's own `flowSeed` ("which take"), never Math.random; not salted per layer, like wxSeed. flowLevel
// brings the buffer to a fixed loudness so the four types sit together with Normalize off.
const FLOW_C_AIR = 343;      // the speed of sound (m/s), for the pour's air column
// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function flowCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  return {
    "type": Math.round(g("flowType", 0)), "flow": g("flowAmount", 0.5), "size": g("flowSize", 2), "babble": g("flowBabble", 0.5),
    "body": g("flowBody", 0.3), "rise": g("flowRise", 0.3), "tone": g("flowTone", 0.5), "distance": g("flowDistance", 0.2),
    "width": g("width", 0.4), "period": g("flowPeriod", 8), "waveSize": g("flowWaveSize", 0.6), "drawback": g("flowDrawback", 0.3),
    "phase": g("flowPhase", 0.1), "waves": Math.round(g("flowWaves", 0)), "fill": g("flowFill", 0.85), "fillStart": g("flowFillStart", 0.05),
    "vessel": g("flowVessel", 0.2), "dur": g("duration", 1),
  };
}

function flowRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function flowGauss(rnd) { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const flowClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// value noise with cosine interpolation: a smooth random curve at about `hz` changes a second, range ±1
function flowSmooth(sr, hz, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = rnd();
  const inc = hz / sr;
  return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } const u = 0.5 - 0.5 * Math.cos(Math.PI * ph); return a + (b - a) * u; };
}
// TPT state-variable filter (Simper). tick returns the band output; .lp / .hp hold the others. k = 1/Q.
function flowSvf() { return { ic1: 0, ic2: 0, lp: 0, hp: 0 }; }
function flowSvfTick(f, x, g, k) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const v3 = x - f.ic2, v1 = a1 * f.ic1 + a2 * v3, v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
  f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2; f.lp = v2; f.hp = x - k * v1 - v2;
  return v1;
}
const flowG = (fc, sr) => Math.tan(Math.PI * flowClamp(fc, 5, sr * 0.45) / sr);
// unit-RMS makeup for uniform white noise (variance 1/3) through a unit-peak band of quality Q at fc
const flowMk = (fc, Q, sr) => Math.sqrt(3 * Q * sr / (Math.PI * Math.max(fc, 5)));
const flowPan = (p) => [Math.cos((flowClamp(p, -1, 1) + 1) * Math.PI / 4), Math.sin((flowClamp(p, -1, 1) + 1) * Math.PI / 4)];

// ---------------------------------------------------------------- the event voices every type shares
// BUBBLE: a Minnaert bubble, a decaying sine whose pitch rises as it rings. BURST: a band of noise with an attack and a
// decay (a slap, a crash fragment, a thump, a pebble knock; a high Q makes it a ringing cavity "tonk").
function flowVoices(sr, rnd, info) {
  const vs = [];
  const white = () => rnd() * 2 - 1;
  return {
    count: () => vs.length,
    bubble(rmm, amp, pan, sigma, delay) {
      const r = flowClamp(rmm, 0.15, 25) * 1e-3;
      const f0 = Math.min(3.26 / r, 0.42 * sr), d = 0.13 / r + 0.0072 * Math.pow(r, -1.5);
      const w0 = 2 * Math.PI * f0 / sr, [pl, pr] = flowPan(pan);
      vs.push({ k: 0, ph: 0, w: w0, dw: w0 * sigma * d / sr, e: amp, m: Math.exp(-d / sr), end: amp * 1e-3, pl, pr, delay: delay | 0 });
      info.bubbles++;
    },
    burst(fc, Q, ta, tau, amp, pan, delay) {
      fc = flowClamp(fc, 20, 0.45 * sr);
      const w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al, [pl, pr] = flowPan(pan);
      vs.push({ k: 1, b0: al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0,
        eb: 1, mb: Math.exp(-1 / (sr * tau)), ea: ta > 0 ? 1 : 0, ma: ta > 0 ? Math.exp(-1 / (sr * ta)) : 0,
        mk: Math.min(40, flowMk(fc, Q, sr)) * amp, age: 0, life: Math.ceil(sr * (7 * tau + 7 * Q / (Math.PI * fc) + 3 * ta)), pl, pr, delay: delay | 0 });
      info.bursts++;
    },
    tick(o) {
      let L = 0, R = 0;
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i];
        if (v.delay > 0) { v.delay--; continue; }
        let y, dead;
        if (v.k === 0) {
          y = v.e * Math.sin(v.ph); v.ph += v.w; v.w += v.dw; v.e *= v.m;
          dead = v.e < v.end || v.w > 2.8;
        } else {
          const x = white() * (v.eb - v.ea); v.eb *= v.mb; v.ea *= v.ma;
          const yy = v.b0 * (x - v.x2) - v.a1 * v.y1 - v.a2 * v.y2; v.x2 = v.x1; v.x1 = x; v.y2 = v.y1; v.y1 = yy;
          y = yy * v.mk; dead = ++v.age > v.life;
        }
        L += y * v.pl; R += y * v.pr;
        if (dead) { vs[i] = vs[vs.length - 1]; vs.pop(); }
      }
      if (vs.length > info.maxVoices) info.maxVoices = vs.length;
      o[0] = L; o[1] = R;
    },
  };
}

// ---------------------------------------------------------------- STREAM
function flowStream(sr, c, rnd, V, info) {
  const K = Math.max(2, Math.round(3 + 11 * c.flow)), white = () => rnd() * 2 - 1;
  const dampOf = (rmm) => { const r = rmm * 1e-3; return 0.13 / r + 0.0072 * Math.pow(r, -1.5); };
  const pockets = [];
  info.pockets = K; info.clusters = 0; info.intervals = []; info.ivSec = [];
  function pocket(t, first) {
    const r = flowClamp(c.size * Math.exp(0.55 * flowGauss(rnd)), 0.4, 14);
    const T = (0.1 + 0.45 * rnd()) * (1.35 - 0.6 * c.flow);                       // mean recurrence (s)
    const life = sr * (3 + 6 * rnd());
    const P = { r, T, pan: (rnd() * 2 - 1) * c.width, amp: 0.45 + 0.55 * rnd(), n: 1 + Math.floor(rnd() * (1.5 + 3 * c.flow)),
      fig: null, cav: rnd() < 0.35, cavF: 3.26 / (r * 1e-3) * (0.55 + 0.25 * rnd()), cavQ: 10 + 8 * rnd(), slapF: 1500 * Math.pow(2, 2 * rnd()), next: t + Math.floor((first ? rnd() : 0.3 + 0.7 * rnd()) * T * sr), die: t + Math.floor(first ? rnd() * life : life), last: -1 };
    P.fig = []; for (let b = 0; b < P.n; b++) P.fig.push(0.004 + 0.03 * rnd());
    return P;
  }
  for (let i = 0; i < K; i++) pockets.push(pocket(0, true));
  const turbL = flowSvf(), turbR = flowSvf(), lowL = flowSvf(), lowR = flowSvf();
  const eddy = flowSmooth(sr, 3, rnd), eddy2 = flowSmooth(sr, 0.7, rnd);
  const turbFc = 2000 * Math.pow(2, 1.4 * (c.tone - 0.5)), gT = flowG(turbFc, sr), mkT = flowMk(turbFc, 0.5, sr), gLo = flowG(240, sr);
  const bgRate = c.flow * (8 + 110 * c.flow);                                    // fizz grows faster than the pockets: a trickle is all pockets
  let t = 0;
  return (drive, o) => {
    for (let i = 0; i < pockets.length; i++) {
      let p = pockets[i];
      if (t >= p.die) { p = pockets[i] = pocket(t, false); }
      if (t >= p.next) {
        // a cluster: n bubbles of this pocket's size, a few ms apart, sometimes led by a slap or a cavity tonk
        if (rnd() < drive) {
          // a pocket has a FIGURE (how many bubbles, how far apart): with probability `babble` it repeats it, so what
          // comes back is the same gurgle, not just the same pitch
          const same = rnd() < c.babble;
          const n = same ? p.fig.length : Math.max(1, p.n + Math.round(flowGauss(rnd) * 0.7));
          let d = 0;
          if (p.cav) V.burst(p.cavF, p.cavQ, 0.0004, 0.004 + 0.003 * rnd(), 0.5 * p.amp, p.pan, 0);
          else if (rnd() < 0.7) V.burst(p.slapF, 0.9, 0, 0.002 + 0.003 * rnd(), 0.7 * p.amp, p.pan, 0);
          for (let b = 0; b < n; b++) {
            const r = p.r * Math.exp(0.04 * flowGauss(rnd));            // one pocket, one size: its gurgle comes back at its pitch
            // a big bubble is louder, but less than its longer ring alone would make it (energy ~ r^1.2, not r^2.4)
            V.bubble(r, p.amp * 0.8 * Math.pow(r / 2, 0.35) * Math.sqrt(dampOf(r) / dampOf(2)) * (0.6 + 0.4 * rnd()), p.pan + 0.1 * (rnd() - 0.5), c.rise * (0.6 + 0.8 * rnd()), d);
            d += sr * (same ? p.fig[b] * (1 + 0.05 * flowGauss(rnd)) : 0.004 + 0.03 * rnd());
          }
          info.clusters++;
          if (p.last >= 0 && info.intervals.length < 4000) { info.intervals.push((t - p.last) / sr / p.T); info.ivSec.push((t - p.last) / sr); }
          p.last = t;
        }
        // recurrence: babble 1 -> near-periodic (±12%), 0 -> Poisson with the same mean
        const iv = p.T * (c.babble * (1 + 0.12 * flowGauss(rnd)) + (1 - c.babble) * -Math.log(Math.max(1e-6, rnd())));
        p.next = t + Math.max(Math.floor(0.03 * sr), Math.floor(iv * sr));
      }
    }
    // loose small bubbles: the fizz between the gurgles
    if (rnd() < bgRate * drive / sr) {
      const r = flowClamp(c.size * 0.5 * Math.exp(0.6 * flowGauss(rnd)), 0.3, 6);
      V.bubble(r, 0.22 * Math.pow(r / 2, 0.7), (rnd() * 2 - 1) * c.width, c.rise, 0);
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    // the flow: turbulent noise, swirling with the eddies; a low gurgle for body
    const tb = drive * (0.08 + 0.25 * c.flow) * (1 + 0.35 * eddy()) * (1 + 0.2 * eddy2());
    let L = flowSvfTick(turbL, white(), gT, 2) * 2 * mkT * tb, R = flowSvfTick(turbR, white(), gT, 2) * 2 * mkT * tb;
    if (c.body > 0) {
      flowSvfTick(lowL, white(), gLo, 1.2); flowSvfTick(lowR, white(), gLo, 1.2);
      const ab = drive * c.body * 0.25 * (1 + 0.6 * eddy());
      L += ab * lowL.lp * 7; R += ab * lowR.lp * 7;
    }
    info.eventE += o[0] * o[0] + o[1] * o[1]; info.bedE += L * L + R * R;
    o[0] += L; o[1] += R;
    t++;
  };
}

// ---------------------------------------------------------------- WATERFALL
function flowWaterfall(sr, c, rnd, V, info) {
  const white = () => rnd() * 2 - 1;
  const rate = 500 + 5500 * c.flow, thumpRate = 2 + 9 * c.babble;
  const hump = Math.min(0.4 * sr, 3.26 / (c.size * 1e-3) * 0.85);
  const dampOf = (rmm) => { const r = rmm * 1e-3; return 0.13 / r + 0.0072 * Math.pow(r, -1.5); }, d0 = dampOf(c.size);
  info.hump = hump;
  const rL = flowSvf(), rR = flowSvf(), bL = flowSvf(), bR = flowSvf(), b2L = flowSvf(), b2R = flowSvf(), sL = flowSvf(), sR = flowSvf();
  const gH = flowG(hump * 1.3, sr), mkH = flowMk(hump * 1.3, 0.5, sr), gB = flowG(110, sr), gS = flowG(6500 * Math.pow(2, c.tone - 0.5), sr);
  const swell = flowSmooth(sr, 1.6, rnd), swell2 = flowSmooth(sr, 0.45, rnd), shimmer = flowSmooth(sr, 9, rnd);
  let t = 0;
  return (drive, o) => {
    const lam = rate * drive / sr;
    if (rnd() < lam) {
      // equal ENERGY per bubble across the size spread (a big bubble rings longer, so it gets less amplitude): the
      // cloud's spectrum then sits on the commonest size instead of sliding down to the few biggest
      const r = flowClamp(c.size * Math.exp(0.55 * flowGauss(rnd)), 0.25, 12);
      V.bubble(r, 0.15 * Math.sqrt(dampOf(r) / d0) * (0.4 + 0.6 * rnd()), (rnd() * 2 - 1) * c.width, c.rise * 0.5, 0);
    }
    if (c.body > 0 && rnd() < thumpRate * drive / sr) {                            // mass hitting the pool
      V.burst(45 + 70 * rnd(), 0.8, 0.006, 0.08 + 0.18 * rnd(), c.body * (0.5 + 0.5 * rnd()) * 0.5, (rnd() * 2 - 1) * 0.5 * c.width, 0);
      info.thumps++;
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    info.eventE += o[0] * o[0] + o[1] * o[1];
    // the roar: the bubbles too many to hear one by one, a wide band centred on the hump
    const ra = drive * (0.1 + 0.3 * c.flow) * (1 + 0.12 * shimmer());
    let L = flowSvfTick(rL, white(), gH, 2) * 2 * mkH * ra, R = flowSvfTick(rR, white(), gH, 2) * 2 * mkH * ra;
    // impact thunder at the base: low noise that swells
    if (c.body > 0) {
      const sw = 0.55 + 0.45 * swell() + 0.25 * swell2(), ab = drive * c.body * 0.35 * Math.max(0.1, sw);
      flowSvfTick(bL, white(), gB, 1.1); flowSvfTick(bR, white(), gB, 1.1);
      flowSvfTick(b2L, bL.lp, gB, 1.1); flowSvfTick(b2R, bR.lp, gB, 1.1);
      L += ab * b2L.lp * 9; R += ab * b2R.lp * 9;
    }
    // spray: high hiss, mostly up close
    const sa = drive * c.flow * 0.16 * (1 - c.distance) * (1 + 0.3 * shimmer());
    flowSvfTick(sL, white(), gS, 1.2); flowSvfTick(sR, white(), gS, 1.2);
    L += sa * sL.hp * 2.2; R += sa * sR.hp * 2.2;
    info.bedE += L * L + R * R;
    o[0] += L; o[1] += R;
    t++;
  };
}

// ---------------------------------------------------------------- SURF
function flowSurf(sr, c, rnd, V, info) {
  const white = () => rnd() * 2 - 1;
  const waves = [];
  info.breaks = []; info.waveStarts = [];
  let t = 0, spawned = 0, nextStart = Math.floor(-c.phase * c.period * sr);
  function spawn(t0) {
    const P = c.period * flowClamp(1 + 0.18 * flowGauss(rnd), 0.7, 1.35), A = flowClamp(c.waveSize * (0.75 + 0.5 * rnd()), 0.05, 1.3);
    const tb = 0.3 * P, spill = 0.25 + 0.55 * A;
    const p0 = (rnd() * 2 - 1) * 0.6, dir = rnd() < 0.5 ? -1 : 1;
    waves.push({ t0, P, A, tb, spill, p0, p1: flowClamp(p0 + dir * (0.6 + 0.6 * rnd()), -1, 1), thumped: false, end: t0 + Math.floor(P * 1.6 * sr) });
    info.waveStarts.push(t0 / sr); info.breaks.push((t0 + tb * sr) / sr);
    spawned++;
    return P;
  }
  const swL = flowSvf(), swR = flowSvf(), crL = flowSvf(), crR = flowSvf(), crHL = flowSvf(), crHR = flowSvf(), waL = flowSvf(), waR = flowSvf();
  const saL = flowSvf(), saR = flowSvf(), bedL = flowSvf(), bedR = flowSvf(), lisL = flowSvf(), lisR = flowSvf();
  const grit = flowSmooth(sr, 180, rnd), grit2 = flowSmooth(sr, 35, rnd), bedMod = flowSmooth(sr, 0.25, rnd);
  const gCr = flowG(4200 * Math.pow(2, c.tone - 0.5), sr), gCrH = flowG(140, sr), gWa = flowG(1800 * Math.pow(2, c.tone - 0.5), sr), mkWa = flowMk(1800, 0.5, sr);
  const gBed = flowG(380, sr), gLis = flowG(9000, sr);
  return (drive, o) => {
    while (t >= nextStart && (!c.waves || spawned < c.waves)) nextStart += Math.floor(spawn(nextStart) * sr);
    let sw = 0, swFc = 0, crash = 0, cpan = 0, wash = 0, sand = 0, sandFc = 0, peb = 0, foam = 0, lisp = 0;
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], s = (t - w.t0) / sr, A = w.A, P = w.P;
      if (t > w.end) { waves.splice(i, 1); continue; }
      if (s < 0) continue;
      // BUILD: the swell rises under the next wave, until it breaks; then it collapses fast
      if (s < w.tb) { const u = s / w.tb; sw += A * u * u; swFc += A * u * u * (60 + 260 * Math.pow(u, 1.5)); lisp += A * Math.pow(u, 6); }
      else { const v = Math.exp(-(s - w.tb) / 0.25); sw += A * v; swFc += A * v * 320; }
      const sb = s - w.tb, Ac = 1.65 * A * A;          // the crash grows faster than the wash: a small wave mostly washes
      if (sb >= 0) {
        // BREAK: the crash spills along the front (sub-crashes travelling across the field) over a decaying roar
        if (!w.thumped) { w.thumped = true; V.burst(55 + 30 * rnd(), 0.7, 0.012, 0.25 + 0.2 * A, c.body * Ac * 1.5, w.p0 * 0.5, 0); }
        const u = sb / w.spill;
        if (u < 1 && rnd() < (12 + 70 * A) * drive / sr) {
          const pan = w.p0 + (w.p1 - w.p0) * u;
          V.burst(350 * Math.pow(2, 3.2 * rnd()), 0.6 + 0.6 * rnd(), 0.004 + 0.02 * rnd(), 0.04 + 0.1 * rnd(), 0.45 * Ac * (0.35 + 0.65 * rnd()) * (1 - 0.5 * u), pan, 0);
        }
        const crE = Ac * (1 - Math.exp(-sb / 0.07)) * Math.exp(-sb / (0.5 + 0.7 * A));
        crash += crE; cpan += crE * (w.p0 + (w.p1 - w.p0) * Math.min(1, u));
        foam += A * (1 - Math.exp(-sb / 0.05)) * Math.exp(-sb / (0.5 + 0.7 * A));
        // WASH: the water running up the beach
        const x = (sb - 0.03 * P) / (0.32 * P);
        if (x > 0 && x < 1) wash += A * 0.7 * Math.sin(Math.PI * x) * (1 - 0.4 * x);
        // DRAWBACK: receding over the rest of the cycle, the hiss thinning and darkening as the film of water thins
        const sd = sb - 0.2 * P;
        if (sd > 0) {
          const td = 0.42 * P, g = A * Math.min(1, sd / 0.4) * Math.exp(-sd / td);
          sand += g; sandFc += g * (1300 + 4200 * Math.exp(-sd / td)); peb += g;
        }
      }
    }
    const k = 1 - c.drawback;
    // events: foam bubbles (tiny, high), pebbles knocking (clustered: stones rolling knock several times)
    if (foam > 1e-3 && rnd() < 3800 * foam * c.waveSize * drive / sr) {
      const r = flowClamp(0.55 * Math.exp(0.5 * flowGauss(rnd)), 0.18, 2.5);
      V.bubble(r, 0.05 + 0.08 * rnd(), cpan / (crash || 1) + (rnd() * 2 - 1) * 0.7 * c.width, 0.2, 0);
      info.foamBubbles++;
    }
    if (c.drawback > 0 && peb > 1e-3 && rnd() < 260 * peb * c.drawback * drive / sr) {
      const pan = (rnd() * 2 - 1) * c.width, f = 1600 * Math.pow(2, 2 * rnd()), nk = 1 + Math.floor(rnd() * 3);
      let d = 0;
      for (let q = 0; q < nk; q++) {
        V.burst(f * (0.9 + 0.2 * rnd()), 5 + 6 * rnd(), 0, 0.0015 + 0.0035 * rnd(), 0.5 * c.drawback * Math.min(1, peb * 1.5) * (0.4 + 0.6 * rnd()), pan, d);
        d += sr * (0.008 + 0.03 * rnd());
      }
      info.pebbleKnocks += nk;
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    info.eventE += o[0] * o[0] + o[1] * o[1];
    // the beds
    let L = 0, R = 0;
    const swF = sw > 1e-4 ? swFc / sw : 100, gSw = flowG(swF, sr), as = c.body * 0.55 * sw;
    flowSvfTick(swL, white(), gSw, 1.3); flowSvfTick(swR, white(), gSw, 1.3);
    L += as * swL.lp * 6; R += as * swR.lp * 6;
    // the lip feathering just before it breaks
    if (lisp > 1e-4) { flowSvfTick(lisL, white(), gLis, 1); flowSvfTick(lisR, white(), gLis, 1); L += 0.08 * lisp * lisL.hp; R += 0.08 * lisp * lisR.hp; }
    if (crash > 1e-4) {
      const [pl, pr] = flowPan(cpan / crash * c.width);
      const nl = white(), nr = white();
      flowSvfTick(crL, nl, gCr, 0.8); flowSvfTick(crR, nr, gCr, 0.8); flowSvfTick(crHL, crL.lp, gCrH, 0.8); flowSvfTick(crHR, crR.lp, gCrH, 0.8);
      L += 0.9 * crash * crHL.hp * pl * 1.4; R += 0.9 * crash * crHR.hp * pr * 1.4;
    }
    if (wash > 1e-4) {
      const aw = 0.14 * wash * (1 + 0.25 * grit2());
      L += aw * flowSvfTick(waL, white(), gWa, 2) * 2 * mkWa; R += aw * flowSvfTick(waR, white(), gWa, 2) * 2 * mkWa;
    }
    if (sand > 1e-4 && k > 0) {
      const g = flowG(sandFc / sand, sr), gr = 0.55 + 0.45 * Math.abs(grit()) * 1.6;      // the grain: fast, rough level
      const yl = flowSvfTick(saL, white(), g, 1.4), yr = flowSvfTick(saR, white(), g, 1.4);
      const a = 1.3 * sand * k * gr;
      L += a * yl; R += a * yr;
    }
    // far waves: a low, slowly heaving bed so the gaps are never dead silence
    const ab = (0.012 + 0.03 * c.body) * (1 + 0.5 * bedMod());
    flowSvfTick(bedL, white(), gBed, 1.2); flowSvfTick(bedR, white(), gBed, 1.2);
    L += ab * bedL.lp * 5; R += ab * bedR.lp * 5;
    info.bedE += L * L + R * R;
    o[0] = (o[0] + L) * drive; o[1] = (o[1] + R) * drive;
    t++;
  };
}

// ---------------------------------------------------------------- POUR
function flowPour(sr, c, rnd, V, info) {
  const white = () => rnd() * 2 - 1;
  const vs = flowClamp(c.vessel, 0, 1);
  const H = 0.3 - 0.18 * vs, rMouth = 0.009 + 0.03 * vs, Q1 = 30 - 24 * vs;          // bottle 0.30 m / r 9 mm / Q 30 .. glass 0.12 / 39 / 6
  const fillRate = (c.fill - c.fillStart) / Math.max(0.1, c.dur * 0.92) / sr;
  let fill = c.fillStart;
  const modes = [1, 3, 5].map((m, i) => ({ m, g: [1, 0.45, 0.22][i], Q: Q1 * (1 + 0.6 * i), x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, a1: 0, a2: 0, mk: 1 }));
  const flutter = flowSmooth(sr, 22, rnd), flutter2 = flowSmooth(sr, 4, rnd);
  const spL = flowSvf(), spR = flowSvf(), gSp = flowG(3500 * Math.pow(2, c.tone - 0.5), sr);
  const glugRate = 5.5 + 2 * rnd();
  let glugPh = 0.3, glugHz = glugRate, t = 0, kick = 0;
  info.f1 = []; info.glugs = 0;
  const f1Of = () => FLOW_C_AIR / (4 * (Math.max(0.004, H * (1 - fill)) + 0.6 * rMouth));
  function coeffs() {
    const f1 = f1Of();
    for (const m of modes) {
      const fc = Math.min(0.45 * sr, f1 * m.m), w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * m.Q), a0 = 1 + al;
      m.b0 = al / a0; m.a1 = -2 * Math.cos(w0) / a0; m.a2 = (1 - al) / a0; m.mk = Math.min(60, flowMk(fc, m.Q, sr)) * m.g / Math.sqrt(m.Q / 6);
    }
    return f1;
  }
  coeffs();
  return (drive, o) => {
    // glug: the pouring bottle stutters as air gulps back into it (flow on for ~70% of each glug, then cut off while
    // the air goes in); each restart slaps and entrains a couple of big bubbles
    let jet = drive;
    if (c.babble > 0) {
      glugPh += glugHz / sr;
      if (glugPh >= 1) {
        glugPh -= 1; glugHz = glugRate * (0.85 + 0.3 * rnd()); info.glugs++;
        if (drive > 0.2) {
          kick = 1;
          V.burst(900 + 1200 * rnd(), 0.8, 0.001, 0.01, 0.4 * c.babble * drive, 0, 0);
          for (let b = 0; b < 2; b++) V.bubble(c.size * 2.2 * Math.exp(0.3 * flowGauss(rnd)), 0.25 * c.babble * drive, 0.15 * (rnd() - 0.5), 0.4, sr * 0.01 * b);
        }
      }
      const sm = (x) => x * x * (3 - 2 * x), ph = glugPh;
      const gate = ph < 0.7 ? 0 : ph < 0.78 ? sm((ph - 0.7) / 0.08) : ph < 0.94 ? 1 : 1 - sm((ph - 0.94) / 0.06);
      jet = drive * (1 - c.babble * 0.85 * gate);
    }
    // fill: the column shortens with the water that has gone in (normalized by the mean jet, so `fill` is reached)
    fill = Math.min(0.97, fill + fillRate * jet / (1 - 0.85 * c.babble * 0.23));
    if ((t & 15) === 0) { const f1 = coeffs(); if ((t & 1023) === 0) info.f1.push(f1); }
    // entrained bubbles: small, where the jet plunges; each one also kicks the air column
    if (rnd() < (40 + 220 * c.flow) * jet / sr) {
      const r = flowClamp(c.size * Math.exp(0.5 * flowGauss(rnd)), 0.3, 8);
      V.bubble(r, 0.12 * Math.pow(r / 2, 0.7), 0.25 * (rnd() - 0.5) * c.width, c.rise, 0);
      kick = Math.max(kick, 0.6);
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    info.eventE += o[0] * o[0] + o[1] * o[1];
    // the jet's turbulence (with kicks from bubbles and glugs) drives the vessel's air column
    const ex = white() * jet * (0.5 + 0.6 * c.flow) * (1 + 0.35 * flutter() + 0.2 * flutter2()) + white() * kick * 1.2;
    kick *= 0.996;
    let res = 0;
    for (const m of modes) {
      const y = m.b0 * (ex - m.x2) - m.a1 * m.y1 - m.a2 * m.y2; m.x2 = m.x1; m.x1 = ex; m.y2 = m.y1; m.y1 = y;
      res += y * m.mk;
    }
    res *= 0.25;
    // the splash itself, direct: bright, a little wide
    const sp = jet * 0.035 * (0.5 + c.flow);
    flowSvfTick(spL, white(), gSp, 1.4); flowSvfTick(spR, white(), gSp, 1.4);
    const L = res + sp * spL.lp * 1.6, R = res * 0.97 + sp * spR.lp * 1.6;
    info.resE += res * res * 2; info.bedE += L * L + R * R;
    o[0] += L; o[1] += R;
    t++;
  };
}

function makeFlow(sr, cfg, seed) {
  const c = Object.assign({}, cfg);
  c.evG = 1 - 0.55 * flowClamp(c.distance, 0, 1);         // far away, the single events sink into the bed
  const rnd = flowRng(seed);
  const info = { type: ["stream", "waterfall", "surf", "pour"][Math.round(c.type)] || "stream", bubbles: 0, bursts: 0, maxVoices: 0, eventE: 0, bedE: 0,
    thumps: 0, foamBubbles: 0, pebbleKnocks: 0, resE: 0, samples: 0 };
  const V = flowVoices(sr, rnd, info);
  const T = Math.round(c.type);
  const step = T === 1 ? flowWaterfall(sr, c, rnd, V, info) : T === 2 ? flowSurf(sr, c, rnd, V, info) : T === 3 ? flowPour(sr, c, rnd, V, info) : flowStream(sr, c, rnd, V, info);
  // distance: air absorption (two one-poles); the detail sinking is c.evG, applied by each type to its events
  const fc = 18000 * Math.pow(2, -3.6 * flowClamp(c.distance, 0, 1)), al = 1 - Math.exp(-2 * Math.PI * fc / sr);
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
  return {
    info,
    tick(drive, o) {
      step(drive, o);
      l1 += (o[0] - l1) * al; l2 += (l1 - l2) * al; r1 += (o[1] - r1) * al; r2 += (r1 - r2) * al;
      o[0] = l2; o[1] = r2; info.samples++;
    },
  };
}

// The whole sound: n samples, the drive (the amp envelope) read per sample from driveAt(i).
function flowBuffer(sr, n, cfg, seed, driveAt) {
  const w = makeFlow(sr, cfg, seed), L = new Float32Array(n), R = new Float32Array(n), o = [0, 0];
  for (let i = 0; i < n; i++) { w.tick(driveAt(i), o); L[i] = o[0]; R[i] = o[1]; }
  return { L, R, info: w.info };
}
// Bring a flow buffer to FLOW_RMS (over the samples that sound), its peak capped at FLOW_PEAK: surf is peaky at the
// crash, a trickle is sparse plinks, a waterfall a steady roar, so one RMS target keeps the four types near one loudness
// with Normalize off (the weather engine's rule). In place.
const FLOW_RMS = 0.12;
const FLOW_PEAK = 0.9;
function flowLevel(L, R) {
  const n = L.length; let ss = 0, pk = 0, on = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]), m = a > b ? a : b;
    if (m > pk) pk = m;
    if (m > 1e-5) { ss += L[i] * L[i] + R[i] * R[i]; on++; }
  }
  if (!on || pk < 1e-9) return;
  const rms = Math.sqrt(ss / (2 * on)), g = Math.min(FLOW_RMS / rms, FLOW_PEAK / pk);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ---------- Glass (wave "glass", #36): glass and ceramics breaking, clinking, tapped ----------
// Glass Shatter was a triangle at 2.4 kHz buried in crushed noise with an echo, Glass Clink the modal bank, and nothing
// modeled what a breaking object DOES. Prototyped in tools/proto/glass.mjs and picked by ear (AJ, 2026-11-13: the model
// won Glass Shatter, Window Smash, Bottle Break and Pot Smash and tied Glass Clink, soundtests/proto-glass/); this block
// is that model, unchanged in its maths, with its knobs mapped from the patch by glassCfg. One event = one strike:
//   STRIKE     a contact force pulse whose length is the striker's hardness (a fist ~1.5 ms .. a stone ~40 us); its
//              spectrum W(f) = 1 / sqrt(1 + (1.6 f tau)^4) decides which modes it reaches (hard = bright).
//   THE BODY   the intact object rings at its own modes, `freq` its lowest: a VESSEL's shell modes (~1 : 2.6 : 4.8 : 7.4
//              : 10.6 : 14.4), each a degenerate PAIR split by the vessel's asymmetry so a wine glass warbles; a PANE's
//              plate modes (dense, the lowest a low whump); a SOLID's sparse, nearly inharmonic ones. Loss is the
//              material's (T60 = 2.2 / (eta(f) f), times Ring). A second vessel is the other glass in a toast.
//   FRACTURE   a few ms after the strike: a train of SNAPS (a pane's over ~25 ms), a FIZZ of micro-cracks (thousands of
//              tiny 4.5-15 kHz rings a second, decaying over 20-60 ms), for clay and porcelain a low GRIT; the body's
//              ring is CHOKED at the break.
//   PIECES     N fragments, sizes log-normal around Piece size; each a tiny stiff plate ringing at its own inharmonic
//              modes (smaller = higher and shorter), BORN ringing and jostled as they part, then FLYING: launched up
//              (Throw) from a height (Fall height; a pane's from anywhere up its height), landing at its flight time
//              and BOUNCING as a ball does (the gaps shrink), each landing hitting the floor with the floor's contact
//              time (Floor) and knocking the floor itself; a big piece landing hard may break AGAIN.
//   SETTLE     big pieces rock to rest (an accelerating run of ticks) and slide (a short scrape).
// Every component is set to a target ENERGY relative to the strike's first 30 ms, so Pieces changes the DENSITY of the
// debris and not its loudness. Built up front into a stereo buffer like the blast's (an event list of decaying
// sinusoids, each living to -60 dB, never more than 4 s); the AMP ENVELOPE STAYS THE GAIN. Seeded by the patch's own
// `glSeed` ("which take"), never Math.random; not salted per layer, like flowSeed. glassLevel optionally tames the peaks
// first (Peak control, as blastLevel: the app's own limiter on the glass alone, before the chain) and brings the buffer
// to a fixed loudness so Normalize off still sits it with the rest. Anti-aliasing: every mode at or past 0.45 SR is
// dropped; every click is a box-integrated pulse at least 1.5 samples long.
// The materials (index = glMaterial: glass, crystal, porcelain, clay, ice). speed: wave speed relative to soda glass
// (piece pitch); eta: loss factor at 1 kHz; tilt: eta ~ (f/1k)^tilt; fizz: micro-crack density; grit: low crunch in the
// crack; rest: restitution; slide: how far pieces slide; brittle: chance a landing breaks a piece again.
const GLASS_MATS = [
  { "speed": 1,    "eta": 0.0012, "tilt": 0.3,  "fizz": 1,   "grit": 0.15, "rest": 1,    "slide": 1,   "brittle": 0.5 },
  { "speed": 0.9,  "eta": 0.0004, "tilt": 0.2,  "fizz": 0.8, "grit": 0.1,  "rest": 1.05, "slide": 1,   "brittle": 0.6 },
  { "speed": 1.05, "eta": 0.002,  "tilt": 0.3,  "fizz": 0.5, "grit": 0.55, "rest": 0.85, "slide": 0.8, "brittle": 0.35 },
  { "speed": 0.6,  "eta": 0.008,  "tilt": 0.4,  "fizz": 0.3, "grit": 1,    "rest": 0.6,  "slide": 0.6, "brittle": 0.25 },
  { "speed": 0.62, "eta": 0.004,  "tilt": 0.35, "fizz": 1.4, "grit": 0.4,  "rest": 0.7,  "slide": 1.6, "brittle": 0.5 },
];
const GLASS_GRAV = 9.81;            // m/s^2: flight and bounce times
const GLASS_STRIKE_AT = 0.005;      // s of silence before the strike (the onset is never the buffer's first sample)
const GLASS_MAX_T60 = 4;            // s, the longest any ring is rendered
const GLASS_FIZZ_LO = 4500;         // Hz, micro-crack band
const GLASS_FIZZ_HI = 15000;
const GLASS_FRAC_TAU = 0.000025;    // s, the fracture's own excitation (the born ring of each piece)
const GLASS_SEED_MIX = 0x9e3779b1;  // the prototype's seed mix (its variation 0), so glSeed N renders its take N exactly
const GLASS_RMS = 0.12;             // glassLevel: RMS over the loudest 300 ms ...
const GLASS_PEAK = 0.9;             // ... its peak capped here

const glassClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function glassRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const glassGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
const glassPanGains = (p) => { const a = (glassClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
// the contact pulse's spectrum (a half-sine force of length tau), smoothed
const glassW = (f, tau) => 1 / Math.sqrt(1 + Math.pow(1.6 * f * tau, 4));
const glassT60 = (m, f, ringMul) => Math.min(GLASS_MAX_T60, 2.2 / (m["eta"] * Math.pow(f / 1000, m["tilt"]) * f) * ringMul);

// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function glassCfg(st) {
  const g = (k, d) => (st[k] == null ? d : st[k]);
  const brk = glassClamp(g("glBreak", 1), 0, 1);
  return {
    "dur": st.duration || 1, "freq": st.freq || 1000, "width": st.width == null ? 0.6 : st.width,
    "brk": brk, "mat": glassClamp(Math.round(g("glMaterial", 0)), 0, GLASS_MATS.length - 1),
    "shape": glassClamp(Math.round(g("glShape", 0)), 0, 2),
    "hFac": 0.45 + 1.8 * g("glThick", 0.3),                                  // thickness relative to a 0.3 glass
    "tauStrike": 0.0015 * Math.pow(0.04 / 1.5, g("glStriker", 0.6)),        // 1.5 ms .. 40 us
    "thump": g("glThump", 0.2), "crack": g("glCrack", 0.5),
    "nPieces": Math.round(3 * Math.pow(400 / 3, g("glPieces", 0.5)) * Math.pow(brk, 1.2)),
    "shardHz": 12000 * Math.pow(1500 / 12000, g("glShard", 0.4)),           // median piece's first mode (before thickness / material)
    "height": 3 * g("glHeight", 0) * g("glHeight", 0),                       // m
    "throwV": 2.5 * Math.pow(g("glThrow", 0.35), 1.3),                       // m/s
    "rest": 0.12 + 0.6 * g("glBounce", 0.5),
    "tauFloor": 0.0012 * Math.pow(0.000025 / 0.0012, g("glFloor", 0.7)),    // 1.2 ms .. 25 us
    "floorHz": 250 * Math.pow(7, g("glFloor", 0.7)),
    "settle": g("glSettle", 0.3),
    "ringMul": 0.12 * Math.pow(50, g("glRing", 0.5)),                        // 0.12 .. 6 (0.85 at 0.5)
    "beatHz": 0.3 * Math.pow(20, g("glBeat", 0.3)),
    "pair": g("glPair", 0), "pairRatio": Math.pow(2, g("glPairTune", 0) / 12),
  };
}

// a decaying sinusoid added into L/R from t0 (s); starts at zero (sine phase), lives to -60 dB or maxLen. Returns samples.
function glassRing(L, R, sr, t0, f, amp, t60, pan, maxLen) {
  if (!(f > 20) || f >= 0.45 * sr || !(Math.abs(amp) > 1e-7) || !(t60 > 0)) return 0;
  const i0 = Math.round(t0 * sr); if (i0 < 0 || i0 >= L.length) return 0;
  const life = Math.min(L.length - i0, Math.ceil(Math.min(t60, maxLen == null ? GLASS_MAX_T60 : maxLen) * sr));
  const r = Math.exp(-6.907755 / (t60 * sr)), w = 2 * Math.PI * f / sr, c = Math.cos(w) * r, s = Math.sin(w) * r;
  const [gl, gr] = glassPanGains(pan);
  let re = amp, im = 0;
  for (let k = 0; k < life; k++) {
    L[i0 + k] += im * gl; R[i0 + k] += im * gr;
    const nr = re * c - im * s; im = re * s + im * c; re = nr;
  }
  return life;
}
// a contact click: the derivative of a half-sine force of length tau (cos over [0, tau)), box-integrated per sample
function glassClick(L, R, sr, t0, amp, tau, pan) {
  tau = Math.max(tau, 1.5 / sr);
  const OS = 8, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(L.length, Math.ceil((t0 + tau) * sr) + 1);
  const [gl, gr] = glassPanGains(pan);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < tau) s += Math.cos(Math.PI * t / tau); }
    const v = amp * s / OS; L[i] += v * gl; R[i] += v * gr;
  }
}
// a noise burst: band-passed (one-pole HP at lo, one-pole LP at hi), exponential decay tau, from t0 for len s
function glassNoise(L, R, sr, t0, len, tau, amp, lo, hi, pan, rnd) {
  const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(L.length - i0, Math.ceil(len * sr));
  if (n <= 0) return;
  const aH = Math.exp(-2 * Math.PI * Math.min(lo, 0.45 * sr) / sr), aL = Math.exp(-2 * Math.PI * Math.min(hi, 0.45 * sr) / sr);
  const [gl, gr] = glassPanGains(pan), d = Math.exp(-1 / (tau * sr));
  let lpH = 0, lpL = 0, e = amp;
  for (let k = 0; k < n; k++) {
    const x = rnd() * 2 - 1; lpH = x + (lpH - x) * aH; const hp = x - lpH; lpL = hp + (lpL - hp) * aL;
    const fade = k < 16 ? k / 16 : 1, v = lpL * e * fade; L[i0 + k] += v * gl; R[i0 + k] += v * gr; e *= d;
  }
}
// the body's modes for a shape: [{ f, a, n }] (a = strike-position amplitude, before the contact weighting)
function glassBodyModes(shape, f1, rnd, sr) {
  const out = [];
  if (shape === 0) {              // vessel: shell modes n = 2..7
    [1, 2.62, 4.75, 7.4, 10.6, 14.4].forEach((q, k) => out.push({ "f": f1 * q * (1 + 0.02 * (rnd() * 2 - 1)), "a": Math.pow(k + 1, -0.8), "n": k + 2 }));
  } else if (shape === 1) {       // pane: plate modes m, n = 1..6 (aspect asp), struck at (x, y)
    const asp = 0.6 + 0.9 * rnd(), x = 0.2 + 0.6 * rnd(), y = 0.2 + 0.6 * rnd(), list = [];
    for (let m = 1; m <= 6; m++) for (let j = 1; j <= 6; j++) list.push({ "f": f1 * (m * m + asp * j * j) / (1 + asp) * (1 + 0.01 * (rnd() * 2 - 1)), "a": Math.sin(m * Math.PI * x) * Math.sin(j * Math.PI * y) / Math.sqrt(m * j) });
    list.sort((p, q) => p.f - q.f);
    for (const md of list.slice(0, 24)) out.push(md);
  } else {                        // solid: sparse
    [1, 1.52, 2.07, 2.61, 3.3, 3.95].forEach((q, k) => out.push({ "f": f1 * q * (1 + 0.04 * (rnd() * 2 - 1)), "a": Math.pow(k + 1, -0.6) * (0.5 + 0.5 * rnd()) }));
  }
  return out.filter((md) => md.f < 0.45 * sr);
}
// a piece's ring energy ~ its mass (s^2 h), so its amplitude ~ sqrt(mass / T60)
const glassPieceAmp = (s, hFac, t60) => Math.sqrt(s * s * hFac / Math.max(0.02, t60));
// a piece's modes: f1 then a random, roughly constant spacing (a small irregular plate's modal density is flat in f)
function glassPieceModes(f1, rnd) {
  const m = [f1]; let r = 1;
  for (let k = 1; k < 4; k++) { r += 0.35 + 0.8 * rnd(); m.push(f1 * r); }
  return m;
}

// One strike into n samples. Returns { L, R } (Float32, DC-blocked, not yet levelled: glassLevel does that).
function makeGlass(sr, n, cfg, seed) {
  n = Math.max(1, n);
  const M = GLASS_MATS[cfg["mat"]], width = cfg["width"];
  const base = ((seed >>> 0) ^ GLASS_SEED_MIX) >>> 0;
  const rB = glassRng(base ^ 0x1b873593), rF = glassRng(base ^ 0x85ebca6b), rC = glassRng(base ^ 0xc2b2ae35), rS = glassRng(base ^ 0x27d4eb2f);
  const buf = () => [new Float64Array(n), new Float64Array(n)];
  const [bL, bR] = buf(), [tL, tR] = buf(), [cL, cR] = buf(), [zL, zR] = buf(), [dL, dR] = buf(), [sL, sR] = buf();
  const t0 = GLASS_STRIKE_AT, brk = cfg["brk"], shape = cfg["shape"], f1 = cfg["freq"];
  // ---- the break time: a pane flexes before it goes
  const tBreak = t0 + [0.002, 0.007, 0.002][shape] * (0.7 + 0.6 * rB());
  // ---- BODY (and the second vessel of a toast)
  const choke = brk > 0 ? Math.pow(1 - brk, 2) : 1, chokeDamp = 1 - 0.8 * brk;
  const bodyRing = (L, R, fBase, amp, pan, rnd, isPair) => {
    const modes = glassBodyModes(shape, fBase, rnd, sr);
    let e30 = 0;
    for (const md of modes) {
      const a = amp * md.a * glassW(md.f, cfg["tauStrike"]) * (rnd() < 0.5 ? -1 : 1);
      const t60 = glassT60(M, md.f, cfg["ringMul"]) * (shape === 1 ? 0.5 : 1);   // a pane's frame damps it
      e30 += a * a * 0.015;
      const split = shape === 0 ? cfg["beatHz"] * Math.sqrt(md.n - 1) * (0.7 + 0.6 * rnd()) : 0;
      const parts = split > 0 ? [[md.f - split / 2, 1], [md.f + split / 2, 0.2 + 0.35 * rnd()]] : [[md.f, 1]];
      for (const [f, w] of parts) {
        if (f >= 0.45 * sr) continue;
        if (brk <= 0 || isPair) { glassRing(L, R, sr, t0, f, a * w, t60, pan); continue; }
        // choked at the break: full ring until tBreak, then a 3 ms slide to `choke` of it, decaying faster after
        const i0 = Math.round(t0 * sr), ib = Math.round(tBreak * sr), life = Math.min(n - i0, Math.ceil(t60 * sr));
        const w0 = 2 * Math.PI * f / sr, r1 = Math.exp(-6.907755 / (t60 * sr)), r2 = Math.exp(-6.907755 / (Math.max(0.01, t60 * chokeDamp) * sr));
        const [gl, gr] = glassPanGains(pan), slide = Math.round(0.003 * sr);
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
  if (cfg["pair"] > 0) bodyRing(bL, bR, f1 * cfg["pairRatio"], cfg["pair"], 0.25 * width, glassRng(base ^ 0x5bd1e995), true);
  glassClick(bL, bR, sr, t0, 0.35, cfg["tauStrike"], 0);                  // the contact tick of the strike itself
  // ---- BLOW: the low thud of what hit it
  if (cfg["thump"] > 0) {
    const fT = [110, 65, 140][shape] * (0.8 + 0.4 * rB());
    glassRing(tL, tR, sr, t0, fT, 1, 0.14, 0);
    glassRing(tL, tR, sr, t0, fT * 2.3, 0.35, 0.06, 0);
    glassNoise(tL, tR, sr, t0, 0.08, 0.012, 1.2, 30, 450, 0, rB);
  }
  // ---- FRACTURE: snaps, grit (one buffer), fizz (another)
  if (brk > 0 && cfg["crack"] > 0) {
    const nSnap = 1 + Math.round(cfg["crack"] * brk * (shape === 1 ? 8 : 4)), span = shape === 1 ? 0.025 : 0.008;
    for (let k = 0; k < nSnap; k++) {
      const t = tBreak + (k === 0 ? 0 : span * Math.pow(rC(), 0.7)), a = (k === 0 ? 1 : 0.35 + 0.5 * rC()), p = (rC() * 2 - 1) * 0.4 * width;
      glassClick(cL, cR, sr, t, a, 1.5 / sr, p);
      glassNoise(cL, cR, sr, t, 0.012, 0.0015, a * 0.9, 1800, 16000, p, rC);
    }
    if (M["grit"] > 0) glassNoise(cL, cR, sr, tBreak, 0.15, 0.015 + 0.025 * brk, M["grit"] * 1.5, 500, 3500, 0, rC);
    // micro-cracks: Poisson, rate decaying with tau_f
    const tauF = (shape === 1 ? 0.08 : 0.04) * (0.6 + 0.8 * brk), rate0 = M["fizz"] * (1500 + 5000 * cfg["crack"]) * brk;
    let t = tBreak;
    for (let guard = 0; guard < 20000; guard++) {
      const lam = rate0 * Math.exp(-(t - tBreak) / tauF);
      if (lam < 5 || t > cfg["dur"]) break;
      t += -Math.log(Math.max(1e-9, rC())) / lam;
      const f = GLASS_FIZZ_LO * Math.pow(GLASS_FIZZ_HI / GLASS_FIZZ_LO, rC()) * Math.min(1, M["speed"] + 0.2);
      glassRing(zL, zR, sr, t, Math.min(f, 0.44 * sr), Math.pow(rC(), 2) * (rC() < 0.5 ? -1 : 1), 0.004 + 0.014 * rC(), (rC() * 2 - 1) * width);
    }
  }
  // ---- PIECES
  const nP = brk > 0 ? Math.max(1, cfg["nPieces"]) : 0, fMed = cfg["shardHz"] * cfg["hFac"] * M["speed"];
  const dur = cfg["dur"];
  const land = (p, tLand, vImp, isChild) => {
    // bounce train from the first landing at tLand with impact speed vImp
    let t = tLand, v = vImp, last = null;
    for (let k = 0; k < 12 && t < dur - 0.02; k++) {
      const amp = p.A * Math.min(1.5, v / 2.5) * (0.6 + 0.4 * rF());
      const e = glassClamp(cfg["rest"] * M["rest"] * (0.7 + 0.6 * rF()), 0.03, 0.9), vNext = e * v, gap = 2 * vNext / GLASS_GRAV;
      const resting = vNext < 0.06 || k === 11 || t + gap >= dur - 0.02;
      for (let j = 0; j < p.modes.length; j++) {
        const f = p.modes[j], w = glassW(f, cfg["tauFloor"]) * (0.25 + 0.75 * rF()) * Math.pow(j + 1, -0.3) * (rF() < 0.5 ? -1 : 1);
        glassRing(dL, dR, sr, t, f, amp * w, glassT60(M, f, cfg["ringMul"]) * (resting ? 0.2 : 1), p.pan);
      }
      glassClick(dL, dR, sr, t, amp * 0.3, cfg["tauFloor"], p.pan);
      glassRing(dL, dR, sr, t, cfg["floorHz"] * (0.85 + 0.3 * rF()), amp * 0.25 * Math.sqrt(p.s), 0.012 + 0.015 * (1 - cfg["floorHz"] / 1750), p.pan);
      // the cascade: a big piece landing hard breaks again (first landing only, children do not)
      if (k === 0 && !isChild && p.s > 0.7 && rF() < M["brittle"] * brk * Math.min(1, vImp / 2.5)) {
        const nc = 2 + (rF() < 0.5 ? 1 : 0);
        for (let c = 0; c < nc; c++) {
          const s = p.s * (0.45 + 0.25 * rF()), fc = Math.min(p.f1 * Math.pow(p.s / s, 2), 0.44 * sr);
          const child = { "s": s, "f1": fc, "A": glassPieceAmp(s, cfg["hFac"], glassT60(M, fc, cfg["ringMul"])), "pan": glassClamp(p.pan + (rF() - 0.5) * 0.2, -1, 1), "modes": glassPieceModes(fc, rF) };
          land(child, t + 0.003 * rF(), v * e * (0.5 + 0.8 * rF()), true);
        }
        return { "t": t, "amp": amp };
      }
      last = { "t": t, "amp": amp };
      if (resting) break;
      v = vNext; t += gap;
    }
    // SETTLE: a big piece rocks to rest (accelerating ticks) and a sliding one scrapes
    if (cfg["settle"] > 0 && last && p.s > 0.6 && rS() < 0.35 + 0.65 * cfg["settle"]) {
      let tr = last.t + 0.02 + 0.03 * rS(), gapR = 0.025 + 0.03 * rS(), a = last.amp * 0.35;
      const nr = 3 + Math.floor(5 * rS());
      for (let k = 0; k < nr && tr < dur - 0.02; k++) {
        for (let j = 0; j < 2; j++) glassRing(sL, sR, sr, tr, p.modes[j], a * (0.5 + 0.5 * rS()) * glassW(p.modes[j], cfg["tauFloor"]), glassT60(M, p.modes[j], cfg["ringMul"]) * 0.25, p.pan);
        tr += gapR; gapR *= 0.72; a *= 0.8;
      }
      if (rS() < 0.5 * M["slide"]) glassNoise(sL, sR, sr, last.t + 0.005, 0.03 + 0.09 * rS(), 0.03, last.amp * 0.6 * M["slide"], 2500, 8000, p.pan, rS);
    }
    return last;
  };
  for (let i = 0; i < nP; i++) {
    const s = glassClamp(Math.exp(0.45 * glassGauss(rF)), 0.35, 2), fp = fMed * Math.pow(s, -2);
    if (fp >= 0.44 * sr) continue;                             // too small to ring in band: part of the fizz
    // a big piece is louder, but its long ring does not count twice (amplitude ~ sqrt(mass / T60))
    const p = { "s": s, "f1": fp, "A": glassPieceAmp(s, cfg["hFac"], glassT60(M, fp, cfg["ringMul"])), "pan": glassClamp((rF() * 2 - 1) * (0.4 + 0.6 * rF()), -1, 1) * width, "modes": glassPieceModes(fp, rF) };
    // born ringing: the fracture's release (very fast, so bright), airborne so undamped; then JOSTLED: pieces separating
    // knock each other (and the wall, the frame) within the first tens of ms. That is the CRASH, before anything lands.
    // Pieces part over ~6 ms (a pane's drop out of the frame over ~0.12 s): all born within 2 ms rose together into one
    // spike no limiter setting could bring to a common loudness on the lossy materials.
    const tRel = tBreak + (shape === 1 ? 0.12 * rF() * rF() : 0.006 * rF() * rF());
    const hits = [[tRel, (0.3 + 0.6 * cfg["crack"]) * (0.5 + 0.5 * rF())]], nJ = Math.floor(rF() * (1 + 3 * cfg["crack"]));
    for (let j = 0; j < nJ; j++) hits.push([tBreak + (shape === 1 ? 0.06 : 0.035) * Math.pow(rF(), 1.5), (0.25 + 0.45 * rF()) * cfg["crack"]]);
    for (const [th, ah] of hits) for (let j = 0; j < p.modes.length; j++) glassRing(dL, dR, sr, th, p.modes[j], p.A * ah * glassW(p.modes[j], GLASS_FRAC_TAU) * (0.3 + 0.7 * rF()) * Math.pow(j + 1, -0.3) * (rF() < 0.5 ? -1 : 1), glassT60(M, p.modes[j], cfg["ringMul"]), p.pan);
    // flight: launched up at vz from height H; lands at its flight time with speed vImp
    const H = cfg["height"] * (shape === 1 ? 0.15 + 0.85 * rF() : 0.7 + 0.6 * rF());
    const vz = cfg["throwV"] * (0.15 + 0.85 * Math.pow(rF(), 0.7));
    const vImp = Math.sqrt(vz * vz + 2 * GLASS_GRAV * H);
    if (vImp < 0.05) continue;                                 // broken in place, nothing to fall
    land(p, tRel + (vz + vImp) / GLASS_GRAV, vImp, false);
  }
  // ---- levels: every component to a target energy relative to the strike's first 30 ms (E30)
  const energy = (L, R) => { let e = 0; for (let i = 0; i < n; i++) e += (L[i] * L[i] + R[i] * R[i]) / 2; return e / sr; };
  const setE = (L, R, target) => {
    const e = energy(L, R), g = e > 0 && target > 0 ? Math.sqrt(target / e) : 0;
    for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
  };
  setE(tL, tR, 3 * cfg["thump"] * cfg["thump"] * E30);
  setE(cL, cR, 2.5 * cfg["crack"] * cfg["crack"] * brk * E30);
  setE(zL, zR, 6 * cfg["crack"] * cfg["crack"] * brk * M["fizz"] * E30);
  setE(dL, dR, 22 * Math.pow(brk, 1.5) * E30);
  setE(sL, sR, 2.5 * cfg["settle"] * cfg["settle"] * brk * E30);
  // ---- sum, then a 20 Hz two-pole DC / subsonic block (a microphone's own)
  const L = new Float32Array(n), R = new Float32Array(n), hpA = Math.exp(-2 * Math.PI * 20 / sr);
  let h1l = 0, h1r = 0, x1l = 0, x1r = 0, h2l = 0, h2r = 0, y1l = 0, y1r = 0;
  for (let i = 0; i < n; i++) {
    const xl = bL[i] + tL[i] + cL[i] + zL[i] + dL[i] + sL[i], xr = bR[i] + tR[i] + cR[i] + zR[i] + dR[i] + sR[i];
    h1l = hpA * (h1l + xl - x1l); x1l = xl; h2l = hpA * (h2l + h1l - y1l); y1l = h1l;
    h1r = hpA * (h1r + xr - x1r); x1r = xr; h2r = hpA * (h2r + h1r - y1r); y1r = h1r;
    L[i] = h2l; R[i] = h2r;
  }
  return { L, R };
}
// Level a glass buffer, in place. PEAK CONTROL first (`peak` 0..2, the patch's glPeak), exactly blastLevel's: the buffer
// brought to a 0.9 peak and run through the app's own lookahead limiter (limiterProcess) at min(peak, 1), ON THE GLASS
// ALONE, before the chain; past 1 it is brought back to 0.9 and limited again at peak - 1. A break is peaky (the crack,
// the pieces born together), and a master Limiter after `gain` would pin the peak at its ceiling whatever the gain, so
// Variations could not level a pack (blast's lesson). Then the prototype's own level: RMS GLASS_RMS over the loudest
// 300 ms, the peak capped at GLASS_PEAK, so Normalize off still sits it with the other engines.
function glassLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = GLASS_RMS / Math.sqrt(best);
  if (pk * g > GLASS_PEAK) g = GLASS_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ── Crowd (wave "crowd", #37) ───────────────────────────────────────────────────────────────────────────────────────
// Chatter, cheering, applause, an audience's ooh / aww / gasp, a chanting stadium: MANY people, each doing their own
// thing, prototyped in tools/proto/crowd.mjs and picked by ear over two rounds (soundtests/proto-crowd*/, SOUND-REVIEW.md).
// The people stand round the listener at a density of 0.9 per m^2 (or a `distance` off): the nearest 28 are individual
// voices (a polyBLEP saw through a 5-formant cascade, planned in PHONES and phrases, in conversations, or calling out,
// or chanting on a shared beat), the rest a statistical bed in up to 6 groups by distance whose flicker fades as
// 1/sqrt(members); the nearest 32 clappers are individual hands, the rest a stream of the same claps and a band of
// noise; whistles at random people. Levels are measured, not assumed (a reference voice and clap, calibrated once per
// sample rate and cached). Every person's draws come from hash(seed, k), so a slider adds people rather than reshuffling
// them. Built up front into a stereo buffer (voice-major) and levelled once by crowdLevel; the swell (start / peak at /
// end) is the engine's own rows, laid out over the Duration less `cwTail` (the ring-out, where only the room sounds).
// The maths is the prototype's, unchanged (sample-identical on the round's takes); its measurement-only bookkeeping
// (per-part energies, how many talk at once) is dropped: no random draws, no audio. Keys quoted (the exporter's app-
// global scan reads a bare key as a name). Calls and chants are stored as indices: append-only.
const CROWD_CALLS = ["cheer", "aah", "ooh", "aww", "boo", "gasp", "laugh", "aww (sweet)"];   // round 2: gasp is VOICED now; "aww (sweet)" appended
const CROWD_CHANTS = ["hey", "da-DUM", "da-da-DUM", "clap-clap-hey"];
const CROWD_DEFAULTS = { "cwSize": 0.4, "cwVoices": 1, "cwMood": 0.3, "cwCalls": 0, "cwCall": 0, "cwGroup": 0.4, "cwFemale": 0.5, "cwChildren": 0,
  "cwSync": 0, "cwTempo": 120, "cwChant": 0, "cwClap": 0, "cwClapRate": 4, "cwWhistle": 0, "cwStart": 1, "cwPeakAt": 0.3, "cwEnd": 1, "cwTail": 0,
  "cwDistance": 0, "cwSeed": 0 };   // the PARAMS rows' defaults (index.html), for a patch that leaves one out

const CROWD_MAX_PEOPLE = 3000;
const CROWD_VOICES = 28;          // people rendered as individual voices (the nearest)
const CROWD_CLAPPERS = 32;        // clappers rendered individually (the nearest who clap)
const CROWD_GROUPS = 6;           // bed groups at most
const CROWD_CHORUS = 4;           // pseudo-voices per bed group
const CROWD_CTL = 32;             // samples between coefficient targets (ramped per sample)
const CROWD_RHO = 0.9;            // people per m^2
const CROWD_R0 = 1.1;             // m of personal space around the listener
const CROWD_FAR = 150;            // m at distance 1 (D = 150 * distance^2)
const CROWD_VOICE_RMS = 0.05;     // a talking voice at effort 0, while sounding (x 10^(0.9 effort): +18 dB at a shout)
const CROWD_CLAP_POWER = 0.1;     // a near clapper's mean power at 4 claps/s (a voice at effort ~0.9)
const CROWD_FAR_CLAPS = 1500;     // far claps drawn as events per second at most; the rest is a band of noise
const CROWD_WHISTLE_RMS = 2.5;
const CROWD_FRIC = 0.35;          // a fricative's RMS against the voice (-9 dB): the "s", "sh", "f" of chatter
const CROWD_ASP = 0.3;            // aspiration at asp = 1 against the voice (-10 dB): an "h", a breathy laugh
const CROWD_GASP = 0.55;          // an inhaled gasp's RMS against a voice at the same effort (-5 dB)
const CROWD_TALK = 1.2;           // round 2: a talker's phone level against the calibration reference: the phone talker came out 1.2-2.1 dB
                               // under round 1's (gated loudness, 8 voices x efforts 0 / 0.5 / 0.9), so this +1.6 dB keeps talk against calls
const CROWD_RMS = 0.12;           // crowdLevel: the buffer's RMS ...
const CROWD_PEAK = 0.9;           // ... unless the peak would pass this
const CROWD_SEED_MIX = 0x9e3779b1; // the prototype's seed mix (its variation 0), so cwSeed N renders its take N exactly

// male vowel formants F1 F2 F3 (Peterson & Barney 1952 means); scaled per person by tract size
const CROWD_VOWELS = [
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
const CROWD_TALK_V = [10, 10, 10, 1, 1, 2, 2, 3, 4, 4, 8, 8, 5, 6, 7, 0, 0, 9, 11, 12];   // weighted draw for talk

const crowdClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const crowdEase = (x) => 0.5 - 0.5 * Math.cos(Math.PI * crowdClamp(x, 0, 1));
const crowdRc = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * x));
function crowdShape3(u, a, p, b, pos) {   // start -> peak (at pos) -> end, raised-cosine segments (creature's)
  pos = crowdClamp(pos, 0.02, 0.98);
  return u < pos ? a + (p - a) * crowdEase(u / pos) : p + (b - p) * crowdEase((u - pos) / (1 - pos));
}
function crowdRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function crowdHash(a, b) {
  let h = (Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) >>> 0, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return (h >>> 0) || 1;
}
function crowdGauss(rnd) { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// value noise, cosine-interpolated: a smooth random curve in -1..1 at `perStep` cycles per call
function crowdSmooth(perStep, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = rnd();
  return () => { ph += perStep; while (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } return a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * ph)); };
}
const CROWD_SMOOTH_MS = 0.27;     // mean square of cwSmooth (measured: uniform endpoints, cosine interpolation)
function crowdErf(x) {            // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
// Klatt resonator y = A x + B y1 + C y2 (unity gain at DC); writes A, B, C at a[i..i+2]
function crowdCoef(a, i, F, BW, sr) {
  const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * Math.min(F, 0.45 * sr) / sr);
  a[i] = 1 - B - C; a[i + 1] = B; a[i + 2] = C;
}
// a true BANDPASS (RBJ, unit peak) for noise bands: the Klatt resonator above is a resonant LOW-pass (unity at DC), so a
// fricative through it puts most of its energy below 3 kHz. Writes b0, a1, a2 (y = b0 (x - x2) - a1 y1 - a2 y2); with
// cwBpMk, uniform white noise in comes out at unit RMS whatever the centre
function crowdBp(a, i, fc, Q, sr) {
  const w0 = 2 * Math.PI * Math.min(fc, 0.45 * sr) / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
  a[i] = al / a0; a[i + 1] = -2 * Math.cos(w0) / a0; a[i + 2] = (1 - al) / a0;
}
const crowdBpMk = (fc, Q, sr) => Math.sqrt(3 * Q * sr / (Math.PI * Math.max(20, fc)));
// its power gain on white noise (an AR(2) with phi1 = B, phi2 = C, times A^2)
const crowdResPow = (A, B, C) => A * A * (1 - C) / ((1 + C) * ((1 - C) * (1 - C) - B * B));
// the white-noise power gain of a CASCADE of Klatt resonators (coefficients at a[i], a[i + 3], ...), integrated over a
// fixed log grid 20 Hz-12 kHz: the product of each one's own gain understates two formants by 6-8 dB (each unity-DC
// resonator passes the other's peak at a gain above 1)
const CROWD_GRID = {};
function crowdChainPow(a, offs, sr) {
  let g = CROWD_GRID[sr];
  if (!g) {
    const K = 128, c1 = new Float64Array(K), s1 = new Float64Array(K), c2 = new Float64Array(K), s2 = new Float64Array(K), dw = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const f = 20 * Math.pow(600, k / (K - 1)), fl = 20 * Math.pow(600, (k - 0.5) / (K - 1)), fh = 20 * Math.pow(600, (k + 0.5) / (K - 1));
      const w = 2 * Math.PI * f / sr; c1[k] = Math.cos(w); s1[k] = Math.sin(w); c2[k] = Math.cos(2 * w); s2[k] = Math.sin(2 * w); dw[k] = 2 * Math.PI * (fh - fl) / sr;
    }
    g = CROWD_GRID[sr] = { K, c1, s1, c2, s2, dw };
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
const crowdPan = (x) => [Math.cos((crowdClamp(x, -1, 1) + 1) * Math.PI / 4), Math.sin((crowdClamp(x, -1, 1) + 1) * Math.PI / 4)];

// ---- the chants: syllables in a 4-beat bar { b: beat, d: beats long, v0 -> v1, st: semitones, acc: level, on: onset }
// onsets: 0 none, 1 stop, 2 fricative, 3 nasal, 4 h, 5 voiced closure (b/d)
const CROWD_PATTERNS = [
  { "syl": [0, 1, 2, 3].map((b) => ({ b, "d": 0.42, "v0": 11, "v1": 1, "st": b === 0 ? 1 : 0, "acc": b === 0 ? 1.1 : 1, "on": 4 })), "claps": [] },          // HEY HEY HEY HEY
  { "syl": [{ "b": 0, "d": 0.42, "v0": 1, "v1": 1, "st": -2, "acc": 0.75, "on": 5 }, { "b": 1, "d": 1.25, "v0": 2, "v1": 2, "st": 2, "acc": 1.1, "on": 2, "coda": 1 }], "claps": [] },  // de-FENSE
  { "syl": [{ "b": 0, "d": 0.4, "v0": 2, "v1": 2, "st": 0, "acc": 0.85, "on": 3 }, { "b": 1, "d": 0.4, "v0": 12, "v1": 6, "st": 0, "acc": 0.85, "on": 1 }, { "b": 2, "d": 1.35, "v0": 4, "v1": 4, "st": 3, "acc": 1.15, "on": 4 }], "claps": [] },   // da-da-DAAH
  { "syl": [{ "b": 2, "d": 0.6, "v0": 11, "v1": 1, "st": 2, "acc": 1.1, "on": 4 }], "claps": [0, 1] },                                                         // clap clap HEY
];
// ---- the calls: a segment template per type (seconds, semitones, vowel glide, onset, breath, effort added)
function crowdCallShape(type, rnd) {
  const r = () => rnd();
  switch (type) {
    case 1: return { "kind": "aah", "dur": 0.7 + 0.8 * r(), "v0": 4, "v1": r() < 0.5 ? 4 : 8, "vPos": 0.8, "pS": -3, "pP": 1, "pE": -4 - 2 * r(), "pPos": 0.25, "atk": 0.1, "rel": 0.25, "on": r() < 0.3 ? 4 : 0, "onLen": 0.06, "asp": 0.06, "voiced": 1, "wob": 0.25, "f0mul": 1.12, "eAdd": 0.35 };
    case 2: return { "kind": "yeah", "dur": 0.45 + 0.45 * r(), "v0": 0, "v1": 3, "vPos": 0.45, "pS": 2, "pP": 4, "pE": -5 - 2 * r(), "pPos": 0.15, "atk": 0.08, "rel": 0.3, "on": 0, "onLen": 0, "asp": 0.05, "voiced": 1, "wob": 0.15, "f0mul": 1.15, "eAdd": 0.4 };
    case 3: return { "kind": "woo", "dur": 0.6 + 0.7 * r(), "v0": 7, "v1": 6, "vPos": 1, "pS": -3, "pP": 6 + 2 * r(), "pE": 4, "pPos": 0.7, "atk": 0.12, "rel": 0.2, "on": 0, "onLen": 0, "asp": 0.06, "voiced": 1, "wob": 0.3, "f0mul": 1.5, "eAdd": 0.4 };
    case 4: return { "kind": "hey", "dur": 0.22 + 0.16 * r(), "v0": 11, "v1": 1, "vPos": 0.9, "pS": 2, "pP": 3, "pE": -3, "pPos": 0.2, "atk": 0.08, "rel": 0.35, "on": 4, "onLen": 0.18, "asp": 0.05, "voiced": 1, "wob": 0, "f0mul": 1.12, "eAdd": 0.4 };
    // round 2: the reactions are made to read ON THEIR OWN. OOH (impressed): a long "oh-ooh" whose pitch climbs 3-5
    // semitones and then slides 7-10 down, held out loud (effort +0.3), a waver as it is held, an "h" or a "w" before it
    // now and then. AWW (let down: the near miss): an "ae-aw" that starts at its top and FALLS 7-9 semitones over most of
    // a second, ending in a sigh of breath. Each person draws their own length, glide and contour.
    case 5: { const u = r(); return { "kind": "ooh", "dur": 0.85 + 0.75 * r(), "v0": u < 0.5 ? 12 : 6, "v1": 7, "vPos": 0.75, "pS": -2, "pP": 3 + 2 * r(), "pE": -7 - 3 * r(), "pPos": 0.25 + 0.15 * r(), "atk": 0.12, "rel": 0.4, "on": u > 0.8 ? 4 : 0, "onLen": 0.06, "asp": 0.1, "voiced": 1, "wob": 0.15, "f0mul": 1.12, "eAdd": 0.3, "once": true }; }
    case 6: return { "kind": "aww", "dur": 0.8 + 0.6 * r(), "v0": 3, "v1": 5, "vPos": 0.55, "pS": 2, "pP": 3, "pE": -7 - 2 * r(), "pPos": 0.1, "atk": 0.1, "rel": 0.45, "on": 0, "onLen": 0, "asp": 0.14, "voiced": 1, "wob": 0.1, "f0mul": 1.1, "eAdd": 0.2, "once": true, "then": r() < 0.5 ? 13 : 0 };
    case 7: return { "kind": "boo", "dur": 1.0 + 1.2 * r(), "v0": 7, "v1": 7, "vPos": 1, "pS": 0, "pP": 1, "pE": -3, "pPos": 0.15, "atk": 0.12, "rel": 0.2, "on": 5, "onLen": 0.05, "asp": 0.05, "voiced": 1, "wob": 0.4, "f0mul": 0.85, "eAdd": 0.3 };
    case 8: { const sq = r() < 0.3;   // the inhale; now and then an ingressive squeak at its end
      return { "kind": "gasp", "dur": 0.16 + 0.16 * r(), "v0": 8, "v1": 5, "vPos": 1, "pS": 0, "pP": 2, "pE": 3, "pPos": 0.6, "atk": 0.12, "rel": 0.5, "on": 0, "onLen": 0, "asp": CROWD_GASP / CROWD_ASP, "voiced": 0, "squeak": sq, "wob": 0, "f0mul": 2.3, "eAdd": 0, "once": true }; }
    // round 2: the VOICED gasp. Round 1's gasp was template 8, a silent aspirated inhale: hundreds of them sum to a hiss.
    // A startled audience says "HUH!": a glottal onset (the first 30 ms creaky: big period jitter), a short breathy
    // voiced "uh/ah" sliding to "aw", high (x1.7, the voice jumps up) and falling 3-5 semitones, cut off by a catch (a
    // release a tenth of its length). A quarter say a short "OH!" instead, a sixth a breathy voiced inhale with a squeak
    // at the end; 40% let the air back out (an unvoiced "hhh", template 12) a moment later.
    case 10: { const u = r();
      if (u < 0.58) return { "kind": "gasp", "dur": 0.12 + 0.12 * r(), "v0": r() < 0.6 ? 8 : 4, "v1": 5, "vPos": 1, "pS": 0.5, "pP": 1, "pE": -3 - 2 * r(), "pPos": 0.2, "atk": 0.04, "rel": 0.12, "on": 0, "onLen": 0, "asp": 0.55, "voiced": 0.75, "creak": 0.03, "wob": 0, "f0mul": 1.7, "eAdd": 0.25, "once": true, "then": r() < 0.4 ? 12 : 0 };
      if (u < 0.83) return { "kind": "gasp", "dur": 0.16 + 0.14 * r(), "v0": 12, "v1": 7, "vPos": 0.9, "pS": 1, "pP": 2, "pE": -5, "pPos": 0.15, "atk": 0.05, "rel": 0.25, "on": 0, "onLen": 0, "asp": 0.15, "voiced": 1, "creak": 0.025, "wob": 0, "f0mul": 1.35, "eAdd": 0.3, "once": true, "then": 0 };
      return { "kind": "gasp", "dur": 0.2 + 0.12 * r(), "v0": 8, "v1": 5, "vPos": 1, "pS": 0, "pP": 2, "pE": 3, "pPos": 0.6, "atk": 0.08, "rel": 0.3, "on": 0, "onLen": 0, "asp": 1.2, "voiced": 0.35, "squeak": true, "wob": 0, "f0mul": 1.9, "eAdd": 0.15, "once": true, "then": 0 }; }
    // AWW (sweet): the "aww" at something cute: a breathy "ae-aw" that RISES 4-6 semitones and comes back down, soft
    case 11: return { "kind": "aww", "dur": 0.7 + 0.5 * r(), "v0": 3, "v1": 5, "vPos": 0.7, "pS": -1, "pP": 4 + 2 * r(), "pE": -3, "pPos": 0.4, "atk": 0.2, "rel": 0.4, "on": 0, "onLen": 0, "asp": 0.3, "voiced": 1, "wob": 0.08, "f0mul": 1.3, "eAdd": 0, "once": true };
    // the breath let back out after a gasp, and the sigh after a let-down "aww": unvoiced, soft (x0.45, set by the caller)
    case 12: return { "kind": "exhale", "dur": 0.18 + 0.2 * r(), "v0": 8, "v1": 10, "vPos": 1, "pS": 0, "pP": 0, "pE": 0, "pPos": 0.5, "atk": 0.15, "rel": 0.6, "on": 0, "onLen": 0, "asp": 1, "voiced": 0, "wob": 0, "f0mul": 1, "eAdd": 0, "gap": 0.05 + 0.25 * r() };
    case 13: return { "kind": "exhale", "dur": 0.3 + 0.3 * r(), "v0": 5, "v1": 10, "vPos": 1, "pS": 0, "pP": 0, "pE": 0, "pPos": 0.5, "atk": 0.2, "rel": 0.6, "on": 0, "onLen": 0, "asp": 1, "voiced": 0.12, "wob": 0, "f0mul": 0.9, "eAdd": 0, "gap": 0 };
  }
  return null;
}
const CROWD_CALL_TYPES = { 0: null, 1: 1, 2: 5, 3: 6, 4: 7, 5: 10, 6: 9, 7: 11 };   // row value -> template (cheer draws; 9 = laugh; 8 = the silent inhale, now only inside a laugh)
// the bed's upper band per call: a shout's presence (8% of its power, ~2.7 kHz); round 2: an "oo" has next to none,
// an "aw" a little, a breathy gasp some
const CROWD_PRESENCE = { 0: 0.08, 1: 0.08, 2: 0.005, 3: 0.03, 4: 0.03, 5: 0.05, 6: 0.08, 7: 0.03 };
const crowdOnce = (c) => c === 2 || c === 3 || c === 5 || c === 7;   // reactions: each person once per joining
const crowdCheerDraw = (rnd) => { const u = rnd(); return u < 0.35 ? 1 : u < 0.65 ? 2 : u < 0.9 ? 3 : 4; };
const CROWD_CALL_VOWEL = { 0: [680, 1350], 1: [720, 1120], 2: [420, 880], 3: [640, 1050], 4: [320, 880], 5: [620, 1150], 6: [650, 1200], 7: [650, 1200] };

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
const CROWD_CONS = {
  "p": { "c": 1, "pl": 0, "vd": 0, "bf": 1100, "bq": 0.7, "bl": 0.7 }, "t": { "c": 1, "pl": 1, "vd": 0, "bf": 4200, "bq": 1.6, "bl": 1.4 }, "k": { "c": 1, "pl": 3, "vd": 0, "bf": 2300, "bq": 3, "bl": 1.2 },
  "b": { "c": 1, "pl": 0, "vd": 1, "bf": 1100, "bq": 0.7, "bl": 0.35 }, "d": { "c": 1, "pl": 1, "vd": 1, "bf": 4200, "bq": 1.6, "bl": 0.7 }, "g": { "c": 1, "pl": 3, "vd": 1, "bf": 2300, "bq": 3, "bl": 0.6 },
  "f": { "c": 2, "pl": 0, "vd": 0, "ff": 5000, "fq": 0.6, "fl": 0.45 }, "v": { "c": 2, "pl": 0, "vd": 1, "ff": 5000, "fq": 0.6, "fl": 0.25 },
  "s": { "c": 2, "pl": 1, "vd": 0, "ff": 6200, "fq": 2.5, "fl": 1.1 }, "z": { "c": 2, "pl": 1, "vd": 1, "ff": 6200, "fq": 2.5, "fl": 0.6 }, "S": { "c": 2, "pl": 2, "vd": 0, "ff": 3000, "fq": 2, "fl": 1.0 },
  "m": { "c": 3, "pl": 0, "vd": 1, "F": [250, 950, 2300] }, "n": { "c": 3, "pl": 1, "vd": 1, "F": [250, 1500, 2500] },
  "l": { "c": 4, "pl": 1, "vd": 1, "F": [360, 1050, 2850] }, "r": { "c": 4, "pl": 2, "vd": 1, "F": [380, 1150, 1650] }, "w": { "c": 4, "pl": 0, "vd": 1, "F": [300, 720, 2250] }, "j": { "c": 4, "pl": 2, "vd": 1, "F": [280, 2250, 3000] },
  "h": { "c": 5, "pl": 1, "vd": 0 },
};
// draws [item, weight]: onsets and codas roughly as often as conversational English uses them (clusters included)
const CROWD_ONSETS = [["", 20], ["t", 9], ["d", 8], ["k", 8], ["s", 9], ["m", 8], ["n", 8], ["l", 8], ["r", 7], ["w", 6], ["h", 6], ["b", 7], ["p", 6], ["f", 5], ["g", 4], ["j", 3], ["S", 3], ["v", 2], ["z", 1],
  ["pl", 1.2], ["pr", 1.2], ["tr", 1.5], ["kl", 1], ["kr", 1], ["bl", 0.8], ["br", 1], ["gr", 0.8], ["fl", 0.8], ["fr", 1], ["st", 1.5], ["sp", 1], ["sk", 0.8], ["sl", 0.5], ["sm", 0.5], ["sn", 0.4], ["kw", 0.7], ["Sr", 0.3]];
const CROWD_CODAS = [["", 75], ["n", 14], ["t", 11], ["d", 8], ["s", 9], ["z", 7], ["m", 5], ["l", 7], ["r", 6], ["k", 7], ["p", 3], ["f", 2], ["v", 2], ["S", 2],
  ["nt", 2], ["nd", 2], ["st", 2], ["ks", 1.5], ["ts", 1.5], ["lt", 1], ["nz", 1.2], ["mp", 0.6], ["rt", 0.8], ["ld", 0.8], ["rs", 0.6]];
// vowels: a CW_VOWELS index, or [from, to] for a diphthong. Stressed syllables draw FULL vowels, unstressed REDUCED ones
const CROWD_FULLV = [[0, 6], [1, 8], [2, 8], [3, 7], [4, 7], [5, 4], [6, 3], [7, 4], [8, 7], [9, 3], [12, 4], [[4, 1], 5], [[4, 6], 2], [[11, 1], 4], [[12, 7], 3], [[5, 1], 1]];
const CROWD_REDV = [[10, 10], [1, 5], [8, 3], [9, 2], [0, 1.5], [6, 1.2]];
const crowdPick = (list, u) => { let tot = 0; for (const it of list) tot += it[1]; let x = u * tot; for (const it of list) { x -= it[1]; if (x <= 0) return it[0]; } return list[list.length - 1][0]; };
// back-channels (a listener's "mm" / "mhm" / "yeah" / "uh-huh" / "oh" / a little "heh"): [syllables, final contour (x range), level, weight]
const CROWD_BC = [
  [[{ "v": "m", "d": 0.32 }], -0.5, 0.55, 25], [[{ "v": "m", "d": 0.15 }, { "on": "h", "v": "m", "d": 0.26 }], 0.7, 0.55, 20], [[{ "on": "j", "v": [2, 3], "d": 0.26, "st": 1 }], -0.6, 0.75, 25],
  [[{ "v": 10, "d": 0.13 }, { "on": "h", "v": 8, "d": 0.22 }], 0.7, 0.65, 12], [[{ "v": [12, 7], "d": 0.24, "st": 1 }], -0.4, 0.7, 10], [[{ "on": "h", "v": 2, "d": 0.09 }, { "on": "h", "v": 2, "d": 0.1 }], -0.4, 0.6, 8],
];

// the conversations: group the near talkers (neighbours by distance), then lay out each group's turns. Writes P.utt:
// [{ t0, t1, bc (back-channel index + 1 or 0), q (question), cont (more to come in this turn), cut (interrupted) }]
function crowdTurns(rnd, M, C, dur) {
  const n = M.length, e = C.mood, gauss = () => crowdGauss(rnd), T = dur + 0.5;
  for (const P of M) P.utt = [];
  let t = -2.5 * rnd(), sp = Math.floor(rnd() * n);
  for (let guard = 0; guard < 400 && t < T; guard++) {
    const nPh = 1 + Math.floor(-Math.log(Math.max(1e-9, rnd())) * (n > 1 ? 1.4 : 2.2));   // phrases this turn
    for (let i = 0; i < nPh && t < T; i++) {
      const last = i === nPh - 1, L = crowdClamp(1.7 * Math.exp(0.45 * gauss()) * (1.12 - 0.25 * e), 0.5, 4.2);
      M[sp].utt.push({ "t0": t, "t1": t + L, "bc": 0, "q": last && rnd() < 0.3, "cont": !last, "cut": false });
      // the listeners: now and then an "mm" / "yeah" round the end of a phrase
      for (let j = 0; j < n; j++) if (j !== sp && rnd() < 0.2 + 0.12 * e) {
        const b0 = t + L - 0.15 + 0.4 * rnd(), k = crowdPick(CROWD_BC.map((b, ix) => [ix, b[3]]), rnd());
        M[j].utt.push({ "t0": b0, "t1": b0 + 0.45, "bc": k + 1, "q": false, "cont": false, "cut": false });
      }
      t += L;
      if (!last) t += crowdClamp(0.42 * Math.exp(0.5 * gauss()), 0.15, 1.3);   // a breath / a thought, holding the floor
    }
    if (n === 1) { t += crowdClamp(1.1 * Math.exp(0.6 * gauss()), 0.35, 3.5); continue; }   // alone: the other end of the line
    const nx = (sp + 1 + Math.floor(rnd() * (n - 1))) % n;
    if (rnd() < 0.12 + 0.25 * e) {   // an interruption: the next voice comes in early and the speaker gives up a moment later
      const st0 = t - (0.15 + 0.5 * rnd()), u = M[sp].utt[M[sp].utt.length - 1];
      u.t1 = Math.max(u.t0 + 0.35, Math.min(u.t1, st0 + 0.12 + 0.35 * rnd())); u.cut = true; t = st0;
    } else t += crowdClamp(0.28 * Math.exp(0.6 * gauss()), 0.06, 1.5);
    sp = nx;
  }
  for (const P of M) P.utt.sort((a, b) => a.t0 - b.t0);
}

// talkers per conversation: 1 + 7 g^1.5 on average (0 -> each alone, 0.4 -> ~2.8, 1 -> 8), each group drawn round it
const crowdGroupSize = (g, rnd) => { const m = 1 + 7 * Math.pow(g, 1.5); return m < 1.15 ? 1 : crowdClamp(Math.round(m * Math.exp(0.3 * crowdGauss(rnd))), m >= 1.6 ? 2 : 1, 8); };

// the pitch of an utterance at t (semitones re the speaker's f0): declination, accents (raised-cosine bumps), the end
function crowdPc(U, t) {
  let v = U.decl * (0.5 - t / U.L);
  for (const a of U.acc) { const x = (t - a[0]) / a[1]; if (x > -1 && x < 1) v += a[2] * (0.5 + 0.5 * Math.cos(Math.PI * x)); }
  if (t > U.tf) v += U.fin * crowdEase((t - U.tf) / Math.max(0.05, U.L - U.tf));
  return v;
}

// one utterance of a speaker (spk: f0, range, level, rate; u: the schedule entry; L: seconds it may take) -> phones
function crowdUtterance(sr, rnd, spk, u, L, e) {
  const gauss = () => crowdGauss(rnd), sc = (1.15 - 0.3 * e) * spk.rate;
  // 1. syllables
  const syl = [];
  if (u.bc) {
    for (const b of CROWD_BC[u.bc - 1][0]) syl.push({ "on": b.on || "", "co": "", "v": b.v, "d": b.d * (0.85 + 0.3 * rnd()), "st": b.st || 0 });
  } else {
    let tot = 0, prevSt = false;
    for (let i = 0; i < 40 && tot < L * 0.95; i++) {
      const st = i === 0 ? rnd() < 0.45 : prevSt ? rnd() < 0.12 : rnd() < 0.42;
      const d = (st ? 0.23 * Math.exp(0.22 * gauss()) : 0.115 * Math.exp(0.25 * gauss())) * sc;
      if (tot + d > L && tot > 0.3 && tot + d - L > d / 2) break;
      syl.push({ "on": crowdPick(CROWD_ONSETS, rnd()), "co": !st && rnd() < 0.35 ? "" : crowdPick(CROWD_CODAS, rnd()), "v": st ? crowdPick(CROWD_FULLV, rnd()) : crowdPick(CROWD_REDV, rnd()), d, "st": st ? 1 : 0 });
      tot += d; prevSt = st;
    }
    if (!syl.some((s) => s.st)) { const s = syl[syl.length - 1]; s.st = 1; s.d *= 1.6; s.v = crowdPick(CROWD_FULLV, rnd()); }
    const last = syl[syl.length - 1]; last.d *= u.cut ? 1 : 1.4;   // phrase-final lengthening
  }
  // 2. phones, with times; the contour's accents land late in each stressed vowel
  const P = [], U = { "L": 0, "decl": 0, "acc": [], "tf": 0, "fin": 0 }, VF = (v) => (typeof v === "number" ? CROWD_VOWELS[v] : v === "m" ? CROWD_CONS.m.F : CROWD_VOWELS[v[0]]);
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
    const c = CROWD_CONS[ch], j = () => 0.8 + 0.4 * rnd();
    if (c.c === 1) {
      const loc = locus(c, Fv);
      if (c.vd) push({ "c": 1, "lv": 0.12 * sylLv, "vv": 0.8, "as": 0, "fr": 0, "F": [200, loc[1], loc[2]], "bwm": 3, "tr": 0.02, "aIn": 0.015 }, 0.045 * j() * sc);
      else push({ "c": 1, "lv": 0, "vv": 0, "as": 0, "fr": 0, "F": loc, "tr": 0.02, "aIn": 0.012 }, (where ? 0.055 : 0.05) * j() * sc);
      if (where === 1 && rnd() < 0.4) { prevVoiceless = !c.vd; return; }   // an unreleased final stop
      const bf = c.pl === 3 ? (Fv[1] > 1600 ? 3000 : 1800) : c.bf;
      push({ "c": 2, "lv": sylLv, "vv": 0, "as": 0, "fr": c.bl * (where ? 0.6 : 1), "ffc": bf, "fq": c.bq, "F": loc, "tr": 0.005, "aIn": 0.0005, "burst": 0.004 }, 0.011);
      if (!c.vd && where === 0 && !cl) push({ "c": 3, "lv": 0.6 * sylLv, "vv": 0, "as": 1, "fr": 0, "F": [Fv[0] * 0.75, Fv[1], Fv[2]], "tr": 0.02, "aIn": 0.003 }, (nextIsAppr ? 0.018 : 0.03 + 0.02 * rnd()) * sc);
      prevVoiceless = !c.vd; return;
    }
    if (c.c === 2) { const loc = locus(c, Fv);
      push({ "c": 4, "lv": sylLv, "vv": c.vd ? 0.25 : 0, "as": 0.03, "fr": c.fl, "ffc": c.ff, "fq": c.fq, "F": loc, "tr": 0.02, "aIn": 0.02 }, (cl ? 0.065 : where ? 0.1 : 0.085) * j() * sc); prevVoiceless = !c.vd; return; }
    if (c.c === 3) { push({ "c": 5, "lv": 0.35 * sylLv, "vv": 1, "as": 0, "fr": 0, "F": c.F, "bwm": 3, "bw1": 110, "tr": 0.012, "aIn": 0.012 }, (where ? 0.075 : 0.06) * j() * sc); prevVoiceless = false; return; }
    if (c.c === 4) { push({ "c": 6, "lv": 0.7 * sylLv, "vv": 1, "as": 0.02, "fr": 0, "F": c.F, "bwm": 1.3, "tr": 0.035, "aIn": 0.03 }, 0.055 * j() * sc); prevVoiceless = false; return; }
    push({ "c": 3, "lv": 0.55 * sylLv, "vv": 0, "as": 1, "fr": 0, "F": [Fv[0] * 0.9, Fv[1], Fv[2]], "tr": 0.015, "aIn": 0.01 }, 0.06 * j() * sc); prevVoiceless = true;
  };
  syl.forEach((s, i) => {
    const Fv = VF(s.v), tMid = t + s.d / 2;
    const lv = (s.st ? 1.35 : 0.85) * Math.exp(0.1 * gauss()) * (u.bc ? CROWD_BC[u.bc - 1][2] : 1 - 0.3 * Math.min(1, tMid / Math.max(0.3, L)));
    const t0 = t;
    // a vowel straight after a vowel: half the time a glottal dip between them (uh-oh), else they glide
    if (!s.on && i > 0 && prevC === 0 && rnd() < 0.5) push({ "c": 7, "lv": 0.3 * lv, "vv": 0.6, "as": 0.1, "fr": 0, "F": Fv, "tr": 0.03, "aIn": 0.015, "creak": 0.06 }, 0.035);
    prevVoiceless = false;
    // casual speech FLAPS an unstressed t / d between vowels ("butter", "go to"): a 25 ms voiced tap, not a silent closure
    if (!s.st && (s.on === "t" || s.on === "d") && i > 0 && prevC === 0 && rnd() < 0.65) {
      push({ "c": 6, "lv": 0.45 * lv, "vv": 1, "as": 0.02, "fr": 0, "F": [300, 0.45 * Fv[1] + 950, 2700], "bwm": 1.5, "tr": 0.01, "aIn": 0.008 }, 0.025);
      s.on = "";
    }
    for (let k = 0; k < s.on.length; k++) consPh(s.on[k], Fv, 0, s.on.length > 1, lv, k < s.on.length - 1 && CROWD_CONS[s.on[k + 1]].c === 4);
    const cons = t - t0, coda = s.co ? s.co.length * 0.07 * sc : 0;
    const vd = Math.max(s.st ? 0.09 : 0.045, s.d - cons - coda);
    const after = prevC;
    const nas = s.v === "m";
    const V = push({ "c": 0, "lv": (nas ? 0.55 : 1) * lv, "vv": 1, "as": (u.bc === 6 ? 0.3 : 0) + 0.04 + 0.1 * (1 - e), "fr": 0, "F": Fv, "F2t": Array.isArray(s.v) ? CROWD_VOWELS[s.v[1]] : null,
      "tr": after === 0 ? 0.07 : after === 6 ? 0.06 : 0.045, "aIn": after === 1 || after === 2 || after === 3 ? 0.008 : after === 5 ? 0.01 : 0.025, "mp": prevVoiceless ? 0.7 : 0, "bwm": nas ? 3 : 1, "bw1": nas ? 110 : 0, "st": s.st }, vd);
    if (s.st && !u.bc) U.acc.push([V.t0 + 0.6 * vd, 0.6 * s.d + 0.05, 0]);
    if (s.co) { const nf = CROWD_CONS[s.co[0]]; V.Fn = nf.c === 3 || nf.c === 4 ? nf.F : locus(nf, Fv); }
    for (let k = 0; k < s.co.length; k++) consPh(s.co[k], Fv, 1, s.co.length > 1, lv * 0.9, false);
    s.tEnd = t;
  });
  // the end: a sonorant dies away, a hiss stops; an interrupted phrase stops short
  push({ "c": 8, "lv": 0, "vv": 0, "as": 0, "fr": 0, "F": P.length ? P[P.length - 1].F : CROWD_VOWELS[10], "tr": 0.03, "aIn": u.cut ? 0.03 : prevC === 4 || prevC === 3 ? 0.02 : 0.07 }, u.cut ? 0.04 : 0.09);
  // 3. the contour: a phrase declines over its length; the stressed syllables get accents, the last (nuclear) one the
  // biggest; after it, a fall (a statement), a small rise (more to come), a big rise (a question), or level (cut off)
  U.L = t; const R = spk.range;
  if (u.bc) { U.decl = 0; U.tf = 0.25 * t; U.fin = CROWD_BC[u.bc - 1][1] * R; }
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
function crowdCfg(st) {
  const g = (k) => (st[k] == null ? CROWD_DEFAULTS[k] : +st[k]);
  return {
    "people": Math.max(1, Math.round(Math.pow(CROWD_MAX_PEOPLE, crowdClamp(g("cwSize"), 0, 1)))),
    "voices": crowdClamp(g("cwVoices"), 0, 1), "mood": crowdClamp(g("cwMood"), 0, 1), "calls": crowdClamp(g("cwCalls"), 0, 1),
    "call": crowdClamp(Math.round(g("cwCall")), 0, CROWD_CALLS.length - 1), "group": crowdClamp(g("cwGroup"), 0, 1),
    "female": crowdClamp(g("cwFemale"), 0, 1), "children": crowdClamp(g("cwChildren"), 0, 1),
    "sync": crowdClamp(g("cwSync"), 0, 1), "tempo": crowdClamp(g("cwTempo"), 30, 240), "chant": crowdClamp(Math.round(g("cwChant")), 0, CROWD_PATTERNS.length - 1),
    "clap": crowdClamp(g("cwClap"), 0, 1), "clapRate": crowdClamp(g("cwClapRate"), 0.5, 10), "whistle": crowdClamp(g("cwWhistle"), 0, 1),
    "start": crowdClamp(g("cwStart"), 0, 1), "peakAt": crowdClamp(g("cwPeakAt"), 0, 1), "end": crowdClamp(g("cwEnd"), 0, 1),
    "distance": crowdClamp(g("cwDistance"), 0, 1),
    // the crowd lasts the Duration less its ring-out (to the microsecond, so 4.4 - 0.9 is 3.5 and not 3.5000000000000004)
    "dur": Math.max(0.05, Math.round(((st.duration || 2) - crowdClamp(g("cwTail"), 0, 2)) * 1e6) / 1e6),
    "width": st.width == null ? 0.8 : crowdClamp(st.width, 0, 1),
  };
}

// one person: every draw from hash(seed, k), in a fixed order, so a slider moves a few people and never reshuffles
function crowdPerson(C, seed, k, D, rMin, crowdR) {
  const rnd = crowdRng(crowdHash(seed, k + 1));
  const uReg = rnd(), uSex = rnd(), f0g = crowdGauss(rnd), fsg = crowdGauss(rnd);
  const p = { k, "theta": rnd(), "thCall": rnd(), "thSync": rnd(), "thClap": rnd(), "thClapSync": rnd(), "thVoice": rnd(), "az": rnd(),
    "rateMul": Math.exp(0.15 * crowdGauss(rnd)), "clapMul": Math.exp(0.13 * crowdGauss(rnd)), "hand": rnd(), "handF": rnd(), "chantDet": crowdGauss(rnd), "vseed": crowdHash(seed ^ 0x51ced, k + 7) };
  p.reg = uReg < C.children ? 2 : uSex < C.female ? 1 : 0;
  p.f0 = [115, 205, 285][p.reg] * Math.pow(2, f0g * 2 / 12);
  p.fs = [1, 1.16, 1.3][p.reg] * (1 + 0.04 * fsg);
  p.chantF0 = [140, 262, 330][p.reg] * Math.pow(2, p.chantDet * 0.8 / 12);
  const r = Math.sqrt(CROWD_R0 * CROWD_R0 + k / (Math.PI * CROWD_RHO) + D * D);
  p.r = r; p.g = rMin / r; p.delay = (r - rMin) / 343;
  const wD = crowdR / Math.sqrt(crowdR * crowdR + D * D);
  [p.pl, p.pr] = crowdPan(Math.sin(2 * Math.PI * p.az) * wD * C.width);
  p.wD = wD;
  return p;
}

// ---------------------------------------------------------------- one voice: a person's whole timeline into L, R
function crowdVoice(sr, C, P, X, L, R, vnorm, cal) {
  const TV = (cal && cal.talkV) || CROWD_TALK_V, anorm = (cal && cal.anorm) || 1, fricK = (cal && cal.fricK) || 0;
  const rnd = crowdRng(P.vseed), gauss = () => crowdGauss(rnd);
  const N = L.length, d0 = Math.round(P.delay * sr);
  const sigJ = 0.012 + (1 - C.sync) * 0.08;
  const st = { "reacts": 0, "reactLen": 0, "onNow": false, "phraseLeft": 0, "phraseLen": 0, "paused": true, "callPause": false, "spent": false, "wasOn": false, "laughLeft": 0, "laughF": 0, "chantIdx": 0, "jit": gauss() * sigJ, "lastV": 10, "decl0": 2, "question": false };
  const isChanter = P.thSync < C.sync, isCaller = P.thCall < C.calls, onceType = crowdOnce(C.call);
  st.paused = rnd() < 0.4; st.callPause = !onceType && rnd() < 0.6;   // staggered: not everyone opens their mouth at t = 0
  // round 2: a TALKER's plan and voice come from their own stream (so a caller's or chanter's draws never move), and a
  // talker with no conversation (a stand-in, or one person alone) gets one with partners nobody hears
  const ref = !!(cal && cal.ref), isTalker = !isChanter && !isCaller && !ref;
  st.q = []; st.ui = 0;
  let prnd = null, spk = null;
  if (isTalker) {
    prnd = crowdRng(crowdHash(P.vseed, 0x7a1c));
    spk = { "range": [3.2, 4.2, 4.8][P.reg || 0] * Math.exp(0.25 * crowdGauss(prnd)) * (1 + 0.5 * C.mood), "lvl": Math.exp(0.15 * crowdGauss(prnd)), "rate": (P.rateMul || 1) * Math.exp(0.08 * crowdGauss(prnd)) };
    if (!P.utt) { const M = [P]; for (let i = crowdGroupSize(C.group, prnd); i > 1; i--) M.push({}); crowdTurns(prnd, M, C, N / sr); }
  }
  const pat = CROWD_PATTERNS[C.chant], beat = 60 / C.tempo;
  const mk = (lenS) => ({ "len": Math.max(CROWD_CTL, Math.round(lenS * sr)), "gain": 0, "f0": P.f0, "pS": 0, "pP": 0, "pE": 0, "pPos": 0.5, "v0": st.lastV, "v1": st.lastV, "vPrev": st.lastV, "vPos": 1,
    "atk": 0.1, "rel": 0.2, "on": 0, "onLen": 0, "coda": 0, "codaLen": 0, "voiced": 1, "asp": 0.04, "fricFc": 4500, "wob": 0, "tiltFc": 1500, "jit": 0.01, "kind": "sil" });
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
    const e = effortAt(ts), phs = crowdUtterance(sr, prnd, spk, u, u.t1 - Math.max(ts, u.t0), e);
    const f0 = P.f0 * Math.pow(2, 5 * e / 12), G = vnorm * CROWD_TALK * Math.pow(10, 0.9 * e) * spk.lvl, tilt = 800 + 4200 * Math.pow(e, 1.5), jit = 0.006 + 0.02 * e;
    let len = 0;
    st.q = phs.map((ph) => { const s = mk(ph.d); len += s.len; s.kind = u.bc ? "bc" : "talk"; s.ph = ph; s.gain = ph.lv * G; s.f0 = f0; s.tiltFc = tilt + (ph.st ? 400 : 0); s.jit = jit; return s; });
    return st.q.shift();
  };
  const callSeg = (ts) => {
    const e = effortAt(ts);
    if (C.call === 6) {   // LAUGH: bouts of "ha" pulses, then an inhale, then a pause
      if (st.laughLeft <= 0) {
        if (st.callPause) { st.callPause = false; if (rnd() < 0.6) { const g = crowdCallShape(8, rnd); return fromShape(g, e, 0.35); } return mk(0.3 + 0.7 * rnd()); }
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
    const t = C.call === 0 ? crowdCheerDraw(rnd) : CROWD_CALL_TYPES[C.call];
    const g = crowdCallShape(t, rnd);
    if (g.once) { st.spent = true; st.reacts++; st.reactLen += g.dur; }
    st.callPause = true;
    const s = fromShape(g, e, 1);
    if (g.then) {   // round 2: a gasp's breath let out, a let-down "aww"'s sigh
      const h = crowdCallShape(g.then, rnd);
      if (h.gap) st.q.push(mk(h.gap));
      st.q.push(fromShape(h, e, 0.45));
    }
    return s;
  };
  function fromShape(g, e, lvl) {
    const s = mk(g.dur);
    const ee = Math.min(1, e + g.eAdd);
    Object.assign(s, { "kind": g.kind, "pS": g.pS, "pP": g.pP, "pE": g.pE, "pPos": g.pPos, "v0": g.v0, "v1": g.v1, "vPos": g.vPos, "atk": g.atk, "rel": g.rel, "on": g.on, "onLen": g.onLen, "asp": g.asp, "voiced": g.voiced, "wob": g.wob, "squeak": g.squeak, "creak": g.creak });
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
  const pl = (P.tpl == null ? P.pl : P.tpl) * P.g, pr = (P.tpr == null ? P.pr : P.tpr) * P.g, fs = P.fs, bwS = Math.sqrt(fs), aspK = 0.35 * anorm * (cal && cal.anorm ? CROWD_ASP : 1);
  let E = 0, Ton = 0, cj = 0;
  const ps = { "a": 0, "vv": 0, "as": 0, "fr": 0, "F1": 500, "F2": 1500, "F3": 2500, "ffc": 4500, "fq": 1.4 };   // round 2: where the last control step left off
  for (let n = d0; n < N; n++) {
    const tau = n - d0;
    if (!seg || pos >= seg.len) { seg = plan(tau); pos = 0; ctl = 0; }
    if (ctl <= 0) {
      ctl = CROWD_CTL;
      // fast path: a pause with the voice rung out is skipped whole
      if (seg.gain === 0 && Math.abs(amp) < 1e-7) {
        const skip = seg.len - pos; if (st.onNow) Ton += skip; n += skip - 1; pos = seg.len; ctl = 0;
        y1.fill(0); y2.fill(0); dcx = dcy = 0; amp = dAmp = 0; ps.a = 0; ps.fr = 0; continue;
      }
      const s = seg, p = Math.min(1, (pos + CROWD_CTL) / s.len), sec = pos / sr;
      let a, vv, as, ff, ffc, F1, F2, F3, semis, fq = 1.4, bwm = 1, bw1 = 0;
      cj = 0;
      if (s.ph) {
        // round 2: a PHONE. Every control value moves from where the last phone left it (ps) to this phone's target,
        // each over its own time: the level over aIn, voicing / breath over 8 ms, frication over 12 ms (a burst is
        // instant and decays), the formants over tr; a diphthong then glides to its second vowel, and a vowel bends
        // toward a following consonant's locus in its last 35 ms. The pitch is the utterance's contour, not the phone's.
        const ph = s.ph, tE = (pos + CROWD_CTL) / sr;
        if (!s.i0) { s.i0 = 1; s.a0 = ps.a; s.vv0 = ps.vv; s.as0 = ps.as; s.fr0 = ps.fr; s.Fa = [ps.F1, ps.F2, ps.F3]; }
        a = s.a0 + (s.gain - s.a0) * crowdEase(tE / ph.aIn);
        const qv = Math.min(1, tE / 0.008);
        vv = s.vv0 + (ph.vv - s.vv0) * qv; as = s.as0 + (ph.as - s.as0) * qv;
        ff = ph.burst ? ph.fr * Math.exp(-sec / ph.burst) : s.fr0 + (ph.fr - s.fr0) * Math.min(1, tE / 0.012);
        ffc = ph.ffc || ps.ffc; fq = ph.fq || ps.fq;
        const qf = crowdEase(tE / ph.tr), FA = s.Fa;
        F1 = FA[0] + (ph.F[0] - FA[0]) * qf; F2 = FA[1] + (ph.F[1] - FA[1]) * qf; F3 = FA[2] + (ph.F[2] - FA[2]) * qf;
        if (ph.F2t) { const w2 = crowdEase((tE / ph.d - 0.45) / 0.5); F1 += (ph.F2t[0] - ph.F[0]) * w2; F2 += (ph.F2t[1] - ph.F[1]) * w2; F3 += (ph.F2t[2] - ph.F[2]) * w2; }
        if (ph.Fn) { const w3 = 0.45 * crowdEase((tE - (ph.d - 0.035)) / 0.035); F1 += (ph.Fn[0] - F1) * w3; F2 += (ph.Fn[1] - F2) * w3; F3 += (ph.Fn[2] - F3) * w3; }
        semis = crowdPc(ph.U, ph.t0 + tE) + (ph.mp ? ph.mp * (1 - Math.min(1, tE / 0.05)) : 0);
        bwm = ph.bwm || 1; bw1 = ph.bw1 || 0; if (ph.creak) cj = 0.15;
      } else {
        // the vowel's own clock starts after the onset consonant, which has its own envelope (inside the vowel's attack
        // ramp an "s" or an "h" was faded to nothing)
        const pv = s.on && s.onLen > 0 ? Math.max(0, (p - s.onLen) / (1 - s.onLen)) : p;
        a = s.gain * crowdRc(pv / s.atk) * crowdRc((1 - p) / s.rel); vv = s.voiced; as = s.asp; ff = 0; ffc = s.fricFc;
        const w = crowdEase(p / s.vPos), V0 = CROWD_VOWELS[s.v0], V1 = CROWD_VOWELS[s.v1];
        F1 = V0[0] + (V1[0] - V0[0]) * w; F2 = V0[1] + (V1[1] - V0[1]) * w; F3 = V0[2] + (V1[2] - V0[2]) * w;
        if (s.on === 0 && s.gain > 0 && p < 0.2) {   // coarticulation: glide in from the last vowel
          const q = crowdEase(p / 0.2), VP = CROWD_VOWELS[s.vPrev];
          F1 = VP[0] + (F1 - VP[0]) * q; F2 = VP[1] + (F2 - VP[1]) * q; F3 = VP[2] + (F3 - VP[2]) * q;
        }
        if (s.on && p < s.onLen) {
          const q = p / s.onLen;
          const ce = s.gain * crowdRc(q / 0.3) * crowdRc((1 - q) / 0.15 + 0.3);
          if (s.on === 1) { if (q < 0.75) a = s.gain * 0.02; else { a = s.gain; vv = 0; ff = 1.3; ffc = 1800 + 2200 * (s.fricFc - 2600) / 3400; } F1 *= 0.6; }
          else if (s.on === 2) { a = ce; vv = s.onVoiced || 0; ff = 1; }
          else if (s.on === 3) { a = 0.4 * ce; F1 = 260; F2 = 1150 + 200 * q; F3 = 2300; }
          else if (s.on === 4) { a = ce; vv = 0; as = Math.max(as, 0.9); }
          else if (s.on === 5) { a = s.gain * (0.15 + 0.85 * q * q); F1 = 260 + (F1 - 260) * q; }
        } else if ((s.on === 1 || s.on === 3 || s.on === 5) && p < s.onLen + 0.12) {
          const q = crowdEase((p - s.onLen) / 0.12); F1 = 300 + (F1 - 300) * q;
        }
        if (s.coda && p > 1 - s.codaLen) { const q = (p - (1 - s.codaLen)) / s.codaLen; vv *= 1 - q; ff = Math.max(ff, q * 1.1); a = Math.max(a, s.gain * 0.5 * crowdRc((1 - p) / 0.05)); }
        if (s.squeak && p > 0.55) { vv = 0.12 * crowdRc((p - 0.55) / 0.1); }
        semis = crowdShape3(p, s.pS, s.pP, s.pE, s.pPos);
        if (s.wob) semis += s.wob * Math.sin(2 * Math.PI * (s.wobRate || 5) * sec);
        if (s.creak && sec < s.creak) cj = 0.2;   // round 2: a glottal (creaky) onset
      }
      ps.a = a; ps.vv = vv; ps.as = as; ps.fr = ff; ps.F1 = F1; ps.F2 = F2; ps.F3 = F3; ps.ffc = ffc; ps.fq = fq;
      const f0 = Math.max(40, s.f0 * Math.pow(2, semis / 12));
      // the tract: F1-F3 move, F4 the neutral 3.5 kHz; size scales all; breath widens F1
      const bfl = 0.1 * f0;
      crowdCoef(tgt, 0, F1 * fs, bw1 || Math.max(70 * bwS + 120 * as, bfl), sr);
      crowdCoef(tgt, 3, F2 * fs, Math.max(90 * bwS, bfl) * bwm, sr);
      crowdCoef(tgt, 6, F3 * fs, Math.max(150 * bwS, bfl) * bwm, sr);
      crowdCoef(tgt, 9, 3500 * fs, 250 * bwS * bwm, sr);
      crowdCoef(tgt, 12, 4500 * fs, 300 * bwS * bwm, sr);
      crowdBp(tgt, 15, ffc * fs, fq, sr); frMk = crowdBpMk(ffc * fs, fq, sr);
      tiltK = 1 - Math.exp(-2 * Math.PI * s.tiltFc / sr);
      if (first) { cur.set(tgt); dl.fill(0); first = false; }
      else for (let j = 0; j < 18; j++) dl[j] = (tgt[j] - cur[j]) / CROWD_CTL;
      dAmp = (a - amp) / CROWD_CTL; dVoi = (vv - voi) / CROWD_CTL; dAsp = (as - asp) / CROWD_CTL; dFr = (ff - fr) / CROWD_CTL;
      const tInc = f0 / sr; if (inc === 0) inc = tInc; dInc = (tInc - inc) / CROWD_CTL;
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
    if (st.onNow) Ton++;
    E += dc * dc;
  }
  return { E, Ton, "reacts": st.reacts, "reactLen": st.reactLen, "mode": isChanter ? "H" : isCaller ? "C" : "T" };
}

// ---------------------------------------------------------------- the bed: a group of far people, statistically
function crowdBed(sr, C, G, X, L, R) {
  const rnd = crowdRng(G.seed), gauss = () => crowdGauss(rnd);
  const N = L.length, d0 = Math.round(G.delay * sr), stepS = CROWD_CTL / sr;
  const shCh = C.sync, shCa = (1 - C.sync) * C.calls, shT = (1 - C.sync) * (1 - C.calls);
  const pat = CROWD_PATTERNS[C.chant], beat = 60 / C.tempo, sig = Math.sqrt(Math.pow(0.012 + (1 - C.sync) * 0.08, 2) + G.delaySd * G.delaySd);
  const callT = C.call, laugh = callT === 6, once = crowdOnce(callT);
  const cv = CROWD_CALL_VOWEL[callT];
  const nT = Math.max(1, G.n * shT), nC = Math.max(1, G.n * shCa);
  const dT = Math.min(0.85, 1.4 / Math.sqrt(nT)), dC = Math.min(0.7, 1 / Math.sqrt(nC)), dL = Math.min(0.85, 1.4 / Math.sqrt(nC));
  const mT = crowdSmooth(4.5 * stepS, rnd), mC = crowdSmooth(0.8 * stepS, rnd), mL = crowdSmooth(5 * stepS, rnd), wF1 = crowdSmooth(5 * stepS, rnd), wF2 = crowdSmooth(4 * stepS, rnd);
  const fsM = G.fsMean, vsh = (b) => b * (0.35 + 0.65 * Math.sqrt(Math.min(1, CROWD_CHORUS / G.n)));
  // the chorus: pseudo-voices, each with a behavior, a register, a threshold, and its own envelope
  const osc = [];
  for (let o = 0; o < CROWD_CHORUS; o++) {
    const u = rnd(), reg = u < C.children ? 2 : rnd() < C.female ? 1 : 0;
    const mode = rnd() < shCh ? 2 : rnd() < C.calls ? 1 : 0;
    osc.push({ reg, mode, "f0": [115, 205, 285][reg] * Math.pow(2, gauss() * 2 / 12), "cf0": [140, 262, 330][reg] * Math.pow(2, gauss() * 0.8 / 12), "th": rnd(),
      "ph": rnd(), "prev": 0, "am": 0, "dAm": 0, "inc": 0, "dInc": 0, "syl": crowdSmooth(4.5 * stepS, rnd), "pit": crowdSmooth(3 * stepS, rnd), "phr": crowdSmooth(0.35 * stepS, rnd),
      "t0": -1, "shape": null, "gap": rnd() * 0.5, "ci": 0, "jit": gauss() * sig, "side": o & 1, "spent": false });
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
      const v = 0.5 * (crowdErf((ts - T) / (1.4142135623730951 * sig)) - crowdErf((ts - T - D) / (1.4142135623730951 * sig))) * sy.acc;
      sum += v * v; if (v > best) { best = v; bv = (ts - T) / D < 0.5 ? sy.v0 : sy.v1; }
    }
    return [sum, bv];
  };
  // the reactions' power profile k(tau) on a 10 ms grid (64 draws of the call, never heard), normalized to integrate
  // to the measured mean reaction length, then the expected share reacting at t: sum of joins(t - tau) k(tau)
  let oaT = null;
  if (once) {
    const kr = crowdRng(crowdHash(G.seed, 77)), K = new Float64Array(400);
    for (let i = 0; i < 64; i++) { const sh = crowdCallShape(CROWD_CALL_TYPES[callT], kr); for (let j = 0; j < K.length && j * 0.01 < sh.dur; j++) { const p = (j + 0.5) * 0.01 / sh.dur; const a2 = crowdRc(p / sh.atk) * crowdRc((1 - p) / sh.rel); K[j] += a2 * a2; } }
    let kS = 0; for (const v of K) kS += v * 0.01; for (let j = 0; j < K.length; j++) K[j] *= PM.onceD / Math.max(1e-9, kS);
    const F = Math.ceil(N / sr * 100) + 2; oaT = new Float64Array(F);
    for (let f = 0; f < F; f++) { let v = 0; for (let j = 0; j < K.length && j <= f; j++) if (K[j] > 0) v += Math.max(0, X.amax((f - j) * 0.01) - X.amax((f - j - 1) * 0.01)) * K[j]; oaT[f] = v; }
  }
  let chantMS = 0; for (let i = 0; i < 200; i++) chantMS += chantEnv(4 * beat * (5 + i / 200))[0] / 200;   // the bar's mean square
  chantMS = Math.max(1e-6, chantMS);
  for (let n = d0; n < N; n++) {
    if (ctl <= 0) {
      ctl = CROWD_CTL;
      const ts = (n - d0) / sr, a = X.act(ts), e = C.mood * (0.65 + 0.35 * a);
      // reactions: who has joined in the last call-length (the running maximum of the swell)
      // round 2: the joins convolved with the reactions' own mean POWER envelope (oaT, below), not a box of the mean
      // length: people's reactions differ in length and each fades, and the box made the far crowd stop dead
      const oa = once ? oaT[Math.min(oaT.length - 1, Math.floor(ts * 100))] : 0;
      // the noise: each behavior's power, its vowel, and its share left after the chorus
      // per-person power is MEASURED (PM, from the near voices of this crowd, or unheard stand-ins): a voice's level
      // depends on its vowel and envelope (an "oo" is ~10 dB under an "ah"), so a nominal level made the bed up to 13 dB hot
      const pT = shT * a * PM.T * Math.pow(1 + dT * mT(), 2) / (1 + dT * dT * CROWD_SMOOTH_MS);
      const pCo = once ? shCa * oa * PM.onceP : shCa * a * PM.C;   // time-averaged
      const pC = once ? pCo : laugh ? pCo * Math.pow(1 + dL * mL(), 2) / (1 + dL * dL * CROWD_SMOOTH_MS) : pCo * Math.pow(1 + dC * mC(), 2) / (1 + dC * dC * CROWD_SMOOTH_MS);
      const ce = shCh > 0 ? chantEnv(ts) : [0, 4];
      const pH = shCh * a * PM.H * ce[0] / chantMS;
      const vT = vsh(0.45), vC = vsh(callT === 5 ? 0.35 : laugh ? 0.35 : 0.6), vH = vsh(0.65);
      const pNoise = G.E * (pT * (1 - vT) + pC * (1 - vC) + pH * (1 - vH));
      // the formants are the power-weighted mix of each behavior's vowel; before anyone has joined, a neutral babble
      const qT = pT + 1e-12 * (1 + shT), pTot = qT + pC + pH;
      const VH = CROWD_VOWELS[ce[1]];
      const F1 = (qT * 520 * (1 + 0.15 * wF1() * dT) + pC * cv[0] + pH * VH[0]) / pTot, F2 = (qT * 1450 * (1 + 0.12 * wF2() * dT) + pC * cv[1] + pH * VH[1]) / pTot;
      const bw1 = (qT * 260 + pC * 110 + pH * 100) / pTot, bw2 = (qT * 480 + pC * 160 + pH * 140) / pTot;
      crowdCoef(cA, 0, F1 * fsM, bw1, sr); crowdCoef(cA, 3, F2 * fsM, bw2, sr);
      kN = 1 / Math.sqrt(crowdChainPow(cA, [0, 3], sr));
      dLvlN = (Math.sqrt(pNoise) * kN - lvlN) / CROWD_CTL;
      // the upper band: talk's sibilance (~4.5 kHz, 4% of its power), a shout's presence (~2.7 kHz, 8%)
      const pU = G.E * (pT * 0.04 + (pC * CROWD_PRESENCE[callT] + pH * 0.08)), fU = ((qT * 4500 + (pC + pH) * 2700) / pTot) * fsM, qU = (qT * 1.4 + (pC + pH) * 2.5) / pTot;
      crowdBp(cA, 6, fU, qU, sr);
      dHiss = (Math.sqrt(pU) * crowdBpMk(fU, qU, sr) - hiss) / CROWD_CTL;
      // the chorus' overall level: its share of each behavior's TIME-AVERAGED power (its own envelopes carry the shape)
      const pCh = G.E * (shT * a * PM.T * vT + pCo * vC + shCh * a * PM.H * vH);
      dLvlC = (Math.sqrt(pCh / 0.45) * kN - lvlC) / CROWD_CTL;
      for (const o of osc) {
        let am = 0, f0 = o.f0;
        const on = a > o.th;
        if (!on) o.spent = false;
        if (o.mode === 0 && on) { am = crowdClamp(0.55 + 0.9 * o.syl(), 0, 1) * (o.phr() > -0.45 ? 1 : 0); f0 = o.f0 * Math.pow(2, (5 * e + 3 * o.pit()) / 12); }
        else if (o.mode === 1 && on) {
          if (laugh) { const q = (ts * 5.1 + o.th * 3) % 1; const bout = o.phr() > -0.2; am = bout ? Math.max(0, Math.sin(Math.PI * q)) * (q < 0.3 ? 0.4 : 1) : 0; f0 = o.f0 * 1.35 * Math.pow(2, (6 - 6 * (ts % 1.2)) / 12); }
          else {
            if (o.t0 < 0 || ts > o.t0 + (o.shape ? o.shape.dur : 0) + o.gap) {
              if (!(once && o.spent)) { o.shape = crowdCallShape(callT === 0 ? crowdCheerDraw(rnd) : CROWD_CALL_TYPES[callT], rnd); o.t0 = ts; o.gap = 0.15 + 0.5 * rnd(); if (o.shape.once) o.spent = true; }
            }
            const sh = o.shape;
            if (sh && ts >= o.t0 && ts < o.t0 + sh.dur) {
              const p = (ts - o.t0) / sh.dur; am = crowdRc(p / sh.atk) * crowdRc((1 - p) / sh.rel) * (sh.voiced ? 1 : 0.15);
              f0 = o.f0 * sh.f0mul * Math.pow(2, (5 * Math.min(1, e + sh.eAdd) + crowdShape3(p, sh.pS, sh.pP, sh.pE, sh.pPos)) / 12);
            }
          }
        } else if (o.mode === 2 && on) {
          const nS = pat.syl.length;
          for (;;) { const sy = pat.syl[o.ci % nS], T = ((Math.floor(o.ci / nS) * 4 + sy.b) * beat + o.jit); if (T + sy.d * beat >= ts) break; o.ci++; o.jit = gauss() * sig; }
          const sy = pat.syl[o.ci % nS], T = (Math.floor(o.ci / nS) * 4 + sy.b) * beat + o.jit, D = sy.d * beat;
          if (ts >= T) { const p = (ts - T) / D; am = crowdRc(p / 0.08) * crowdRc((1 - p) / 0.3) * sy.acc; f0 = o.cf0 * Math.pow(2, sy.st / 12); }
        }
        o.dAm = (am - o.am) / CROWD_CTL; const ti = f0 / sr; if (o.inc === 0) o.inc = ti; o.dInc = (ti - o.inc) / CROWD_CTL;
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
    for (let i = 0; i < CROWD_CHORUS; i++) {
      const o = osc[i]; o.am += o.dAm; o.inc += o.dInc;
      if (o.am <= 1e-6) continue;
      o.ph += o.inc; if (o.ph >= 1) o.ph -= 1;
      // a band-limited PULSE train (the differenced polyBLEP saw): a flat spectrum at unit power, so the chain's noise
      // normalization holds for it too (a saw's energy sits in its low harmonics, one of which can land on a narrow peak)
      const sw = 2 * o.ph - 1 - polyBlep(o.ph, o.inc), v = (o.prev - sw) * o.am / Math.sqrt(2 * o.inc + 1e-9); o.prev = sw;
      if (o.side) sb += v; else sa += v;
    }
    const cn = Math.sqrt(2 / CROWD_CHORUS);
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
function crowdClapVoice(sr) {   // one clap: noise -> bandpass (unit peak) * flMk-style unit-RMS makeup * (attack, exp decay)
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
const crowdHand = (P) => ({ "fc": P.hand < 0.55 ? 1800 + 800 * P.handF : 800 + 500 * P.handF, "Q": P.hand < 0.55 ? 1.6 + P.handF : 3 + 1.5 * P.handF, "pop": P.hand < 0.55 ? 0.15 : 0.55, "tau": P.hand < 0.55 ? 0.0025 + 0.002 * P.handF : 0.004 + 0.003 * P.handF });

// ---------------------------------------------------------------- whistles
function crowdWhistle(sr, ev, out, n0, rnd) {
  const n = Math.min(out[0].length - n0, Math.round(ev.dur * sr)), lp = 1 - Math.exp(-2 * Math.PI * 250 / sr);
  let ph = 0, nb = 0, vib = rnd() * 6;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const semis = ev.type === 0 ? -3 + 3 * crowdEase(p / 0.2) - (p > 0.85 ? 2 * (p - 0.85) / 0.15 : 0) : ev.type === 1 ? (p < 0.5 ? 0 : 4 * crowdEase((p - 0.5) / 0.1)) : 2 - 7 * crowdEase(p);
    const f = ev.f * Math.pow(2, (semis + 0.25 * Math.sin(vib)) / 12);
    vib += 2 * Math.PI * 6 / sr;
    ph += f / sr; if (ph >= 1) ph -= 1;
    nb += ((rnd() * 2 - 1) - nb) * lp;
    const s = Math.sin(2 * Math.PI * ph);
    const v = (s * 0.9 + nb * 4 * s) * crowdRc(p / 0.06) * crowdRc((1 - p) / 0.15) * ev.amp;
    out[0][n0 + i] += v * ev.pl; out[1][n0 + i] += v * ev.pr;
  }
}

// calibration, ONCE (cfg never moves it): the RMS of a reference voice (a man's schwa at effort 0, 115 Hz) and the energy
// of a reference clap (unit amp), so CW_VOICE_RMS and CW_CLAP_POWER are what they say
const CROWD_CAL = {};
function crowdCalibrate(sr) {
  if (CROWD_CAL[sr]) return CROWD_CAL[sr];
  const n = Math.round(3 * sr), L = new Float32Array(n), R = new Float32Array(n);
  const C = crowdCfg({ "cwMood": 0, "duration": 3 }); C.mood = 0;
  const P = { "f0": 115, "fs": 1, "chantF0": 140, "theta": -1, "thCall": 1, "thSync": 1, "pl": 1, "pr": 1, "g": 1, "delay": 0, "rateMul": 1, "vseed": 12345 };
  const X = { "act": () => 1, "amax": () => 1 };
  // a man talking at effort 0 (the whole talk vowel mix: open vowels come out of a unity-DC cascade ~7 dB over a schwa,
  // as real vowels differ in intrinsic loudness, so the reference is the mix, not one vowel), voiced then aspirated
  const rmsOf = (aspOnly) => {
    L.fill(0); R.fill(0); crowdVoice(sr, C, P, X, L, R, 1, aspOnly ? { "ref": true, aspOnly, "talkV": [8, 5] } : { "ref": true });   // aspiration: the gasp's own vowels
    let e = 0, m = 0; for (let i = 0; i < n; i++) { const v = L[i]; if (v !== 0) { e += v * v; m++; } }
    return Math.sqrt(e / Math.max(1, m));
  };
  const vrms = rmsOf(false), arms = rmsOf(true);

  const clap = crowdClapVoice(sr), out = [new Float32Array(sr >> 2), new Float32Array(sr >> 2)], rnd = crowdRng(777);
  let ce = 0;
  for (let i = 0; i < 16; i++) { out[0].fill(0); out[1].fill(0); ce += clap(Object.assign(crowdHand({ "hand": i / 16, "handF": (i * 7 % 16) / 16 }), { "amp": 1, "pl": 1, "pr": 0 }), out, 0, rnd); }
  CROWD_CAL[sr] = { "vnorm": CROWD_VOICE_RMS / vrms, "anorm": vrms / arms, "fricK": CROWD_FRIC * vrms, "clapE": ce / 16 / sr };   // clapE: energy of a unit clap, in s
  return CROWD_CAL[sr];
}

function makeCrowd(sr, cfg, seed) {
  const C = cfg;
  const cal = crowdCalibrate(sr);
  const n = Math.max(1, Math.round(C.dur * sr)), L = new Float32Array(n), R = new Float32Array(n);
  const S = ((seed >>> 0) ^ CROWD_SEED_MIX) >>> 0;
  const D = CROWD_FAR * C.distance * C.distance;
  const crowdR = Math.sqrt(C.people / (Math.PI * CROWD_RHO)) + CROWD_R0, rMin = Math.sqrt(CROWD_R0 * CROWD_R0 + D * D);
  // the swell (excitement envelope) and its running maximum, tabulated at 10 ms
  const tabN = Math.ceil(C.dur * 100) + 2, aT = new Float64Array(tabN), mT = new Float64Array(tabN);
  for (let i = 0; i < tabN; i++) { aT[i] = crowdShape3(crowdClamp(i / 100 / C.dur, 0, 1), C.start, 1, C.end, C.peakAt); mT[i] = Math.max(aT[i], i ? mT[i - 1] : 0); }
  const look = (T, ts) => { if (ts <= 0) return ts < 0 && T === mT ? 0 : T[0]; const x = ts * 100, i = Math.floor(x); if (i >= tabN - 1) return T[tabN - 1]; return T[i] + (T[i + 1] - T[i]) * (x - i); };
  const X = { "act": (ts) => look(aT, ts), "amax": (ts) => look(mT, ts) };
  // ---- the nearest people, as voices
  const people = [];
  const nv = Math.min(C.people, CROWD_VOICES);
  for (let k = 0; k < nv; k++) people.push(crowdPerson(C, S, k, D, rMin, crowdR));
  // round 2: the near TALKERS in conversations, neighbours by distance; a group stands together, so its voices come
  // from round the first one's direction (a talk-only pan: the same people's claps stay where they were)
  if (C.voices > 0) {
    const tk = people.filter((P) => P.thVoice < C.voices && !(P.thSync < C.sync) && !(P.thCall < C.calls)), grnd = crowdRng(crowdHash(S, 0x9a7e));
    for (let i = 0; i < tk.length;) {
      let m = crowdGroupSize(C.group, grnd);
      if (m > 2 && tk.length - i - m === 1) m--;   // never leave the last one talking to nobody: they join the next table
      const M = tk.slice(i, i + m); i += M.length;
      for (let j = 0; j < M.length; j++) { const az = M[0].az + (j ? 0.05 * crowdGauss(grnd) : 0); [M[j].tpl, M[j].tpr] = crowdPan(Math.sin(2 * Math.PI * az) * M[j].wD * C.width); }
      crowdTurns(grnd, M, C, C.dur);
    }
  }
  const acc = { "T": [0, 0], "C": [0, 0], "H": [0, 0], "re": [0, 0, 0] };   // [energy, samples on]; reactions [energy, count, seconds]
  const take = (r) => { acc[r.mode][0] += r.E; acc[r.mode][1] += r.Ton; if (r.reacts) { acc.re[0] += r.E; acc.re[1] += r.reacts; acc.re[2] += r.reactLen; } };
  if (C.voices > 0) for (const P of people) if (P.thVoice < C.voices) take(crowdVoice(sr, C, P, X, L, R, cal.vnorm, cal));
  // ---- the bed: everyone else who uses their voice, in log-spaced groups
  if (C.people > nv && C.voices > 0) {
    // the bed's per-person power, measured: from the near voices, topped up by unheard stand-ins (rendered into a scratch
    // buffer, never heard) for any behavior the near voices did too little of
    const shares = { "T": (1 - C.sync) * (1 - C.calls), "C": (1 - C.sync) * C.calls, "H": C.sync }, once = crowdOnce(C.call);
    let sL = null, sR = null, extra = 0;
    for (const m of ["T", "C", "H"]) {
      if (shares[m] <= 0) continue;
      for (let i = 0; i < 6 && (once && m === "C" ? acc.re[1] < 4 : acc[m][1] < 1.5 * sr); i++) {
        if (!sL) { sL = new Float32Array(n); sR = new Float32Array(n); }
        const P = crowdPerson(C, S ^ 0x5ca1e, 100000 + extra++, D, rMin, crowdR);
        P.thSync = m === "H" ? -1 : 2; P.thCall = m === "C" ? -1 : 2; P.delay = 0; P.theta = Math.min(P.theta, 0.5) * 0.5;
        take(crowdVoice(sr, C, P, X, sL, sR, cal.vnorm, cal));
      }
    }
    const pw = (m) => acc[m][0] / Math.max(1, acc[m][1]);
    const PM = { "T": pw("T"), "C": pw("C"), "H": pw("H"), "onceD": acc.re[1] ? acc.re[2] / acc.re[1] : 0.5, "onceP": 0 };
    PM.onceP = acc.re[1] ? acc.re[0] / acc.re[1] / (PM.onceD * sr) : 0;
    const K = Math.min(CROWD_GROUPS, Math.ceil((C.people - nv) / 6));
    for (let j = 0; j < K; j++) {
      const ka = Math.round(nv * Math.pow(C.people / nv, j / K)), kb = j === K - 1 ? C.people : Math.round(nv * Math.pow(C.people / nv, (j + 1) / K));
      if (kb <= ka) continue;
      let E = 0, dS = 0, dS2 = 0, cnt = 0;
      for (let k = ka; k < kb; k++) { const r = Math.sqrt(CROWD_R0 * CROWD_R0 + k / (Math.PI * CROWD_RHO) + D * D), g = rMin / r, d = (r - rMin) / 343; E += g * g; dS += d; dS2 += d * d; cnt++; }
      const dm = dS / cnt, ra = Math.sqrt(ka / (Math.PI * CROWD_RHO)) + CROWD_R0;
      const G = { "n": cnt * C.voices, "E": E * C.voices, "delay": dm, "delaySd": Math.sqrt(Math.max(0, dS2 / cnt - dm * dm)), "seed": crowdHash(S ^ 0xbedbed, j),
        "P": PM, "fsMean": (1 - C.children) * (1 + 0.16 * C.female) + C.children * 1.3, "width": C.width * Math.min(1, ra / Math.sqrt(ra * ra + D * D) + 0.3) };
      crowdBed(sr, C, G, X, L, R);
    }
  }
  // ---- claps
  if (C.clap > 0) {
    const clap = crowdClapVoice(sr), out = [L, R], crnd = crowdRng(crowdHash(S, 0xc1a9));
    const pat = CROWD_PATTERNS[C.chant], beat = 60 / C.tempo;
    const clapBeats = C.sync > 0 && pat.claps.length ? pat.claps : [0, 1, 2, 3];
    const unitE = cal.clapE;                                   // energy of a unit clap (s)
    const ampFor = (rate) => Math.sqrt(CROWD_CLAP_POWER / (4 * unitE)) * Math.pow(4 / rate, 0.15);   // a slower clapper claps harder
    // the nearest clappers, one by one
    let k = 0, near = 0; const clappers = [];
    while (near < CROWD_CLAPPERS && k < C.people) { const P = k < people.length ? people[k] : crowdPerson(C, S, k, D, rMin, crowdR); if (P.thClap < C.clap) { clappers.push(P); near++; } k++; }
    const kFar = k;
    for (const P of clappers) {
      const h = crowdHand(P), rate = C.clapRate * P.clapMul, synced = P.thClapSync < C.sync, prnd = crowdRng(crowdHash(P.vseed, 99));
      const sigC = 0.008 + (1 - C.sync) * 0.06, d0 = P.delay;
      let t = synced ? 0 : prnd() / rate, bi = 0;
      for (let guard = 0; guard < 4000; guard++) {
        if (synced) { const bar = Math.floor(bi / clapBeats.length); t = (bar * 4 + clapBeats[bi % clapBeats.length]) * beat + crowdGauss(prnd) * sigC; bi++; }
        const ts = t + d0; if (ts >= C.dur) break;
        if (ts >= 0 && X.act(t) > P.theta) {
          clap({ "fc": h.fc * (1 + 0.05 * crowdGauss(prnd)), "Q": h.Q, "pop": h.pop, "tau": h.tau * (1 + 0.15 * crowdGauss(prnd)), "amp": ampFor(rate) * P.g * Math.exp(0.2 * crowdGauss(prnd)), "pl": P.pl, "pr": P.pr }, out, Math.round(ts * sr), crnd);
        }
        if (!synced) t += (1 / rate) * (1 + 0.04 * crowdGauss(prnd));
      }
    }
    // the far clappers: a stream of the same claps (Poisson when free, gathered round the beat when together), capped,
    // the excess energy a band of noise with the same envelope
    const nFar = Math.max(0, Math.round((C.people - kFar) * C.clap));
    if (nFar > 0) {
      let Eg = 0, cnt = 0; for (let kk = kFar; kk < C.people; kk++) { const r = Math.sqrt(CROWD_R0 * CROWD_R0 + kk / (Math.PI * CROWD_RHO) + D * D); Eg += (rMin / r) ** 2; cnt++; }
      const g2 = Eg / cnt, nSync = nFar * C.sync, nFree = nFar - nSync, rate = C.clapRate;
      const farPerson = () => { const kk = kFar + Math.floor(crnd() * (C.people - kFar)); const r = Math.sqrt(CROWD_R0 * CROWD_R0 + kk / (Math.PI * CROWD_RHO) + D * D); return { "g": rMin / r, "d": (r - rMin) / 343, "pan": crowdPan((crnd() * 2 - 1) * C.width * crowdR / Math.sqrt(crowdR * crowdR + D * D)) }; };
      const drawClap = (ts, fp) => {
        const h = crowdHand({ "hand": crnd(), "handF": crnd() }), amp = ampFor(rate) * fp.g * Math.exp(0.2 * crowdGauss(crnd));
        if (ts >= 0 && ts < C.dur) { clap({ "fc": h.fc, "Q": h.Q, "pop": h.pop, "tau": h.tau, amp, "pl": fp.pan[0], "pr": fp.pan[1] }, out, Math.round(ts * sr), crnd); }
      };
      const bedEnv = new Float64Array(Math.ceil(C.dur * 200) + 1);   // excess power, 5 ms steps
      const capFree = Math.min(1, CROWD_FAR_CLAPS * (nFree / Math.max(1, nFar)) / Math.max(1e-9, nFree * rate));
      // free: Poisson at nFree * rate * a(t), thinned to the cap
      if (nFree > 0) for (let t = 0; t < C.dur;) {
        t += -Math.log(Math.max(1e-12, crnd())) / (nFree * rate * capFree);
        if (t >= C.dur) break; if (crnd() > X.act(t)) continue;
        const fp = farPerson(); drawClap(t + fp.d, fp);
      }
      if (nFree > 0 && capFree < 1) for (let i = 0; i < bedEnv.length; i++) bedEnv[i] += nFree * rate * X.act(i / 200) * (1 - capFree) * g2;
      // together: per clap beat, a cluster of claps around it (jitter + delay spread), capped per beat
      if (nSync > 0) {
        const sigC = 0.008 + (1 - C.sync) * 0.06, perBeatCap = CROWD_FAR_CLAPS * beat;
        let dS = 0, dS2 = 0; for (let i = 0; i < 64; i++) { const fp = farPerson(); dS += fp.d; dS2 += fp.d * fp.d; }
        const dm = dS / 64, sigT = Math.sqrt(sigC * sigC + Math.max(0, dS2 / 64 - dm * dm));
        for (let bi = 0; ; bi++) {
          const bar = Math.floor(bi / clapBeats.length), T = (bar * 4 + clapBeats[bi % clapBeats.length]) * beat;
          if (T > C.dur) break;
          const want = nSync * X.act(T), draw = Math.min(want, perBeatCap), m = Math.floor(draw) + (crnd() < draw % 1 ? 1 : 0);
          for (let i = 0; i < m; i++) { const fp = farPerson(); drawClap(T + crowdGauss(crnd) * sigC + fp.d, fp); }
          if (want > draw) for (let i = 0; i < bedEnv.length; i++) { const ts = i / 200, z = (ts - T - dm) / sigT; if (Math.abs(z) < 4) bedEnv[i] += (want - draw) * g2 * Math.exp(-0.5 * z * z) / (sigT * Math.sqrt(2 * Math.PI)); }
        }
      }
      // the noise band: power = claps per second * energy per clap at the mean far gain
      let any = false; for (const v of bedEnv) if (v > 0) { any = true; break; }
      if (any) {
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
  // ---- whistles
  if (C.whistle > 0) {
    const wrnd = crowdRng(crowdHash(S, 0x3157)), out = [L, R];
    const lam = Math.min(5, C.whistle * 0.35 * Math.sqrt(C.people));
    for (let t = wrnd() / lam; t < C.dur; t += -Math.log(Math.max(1e-12, wrnd())) / lam) {
      if (wrnd() > X.act(t)) continue;
      const kk = Math.floor(wrnd() * C.people), r = Math.sqrt(CROWD_R0 * CROWD_R0 + kk / (Math.PI * CROWD_RHO) + D * D);
      const ev = { "f": 2200 + 1400 * wrnd(), "type": Math.floor(wrnd() * 3), "dur": 0.35 + 0.75 * wrnd(), "amp": CROWD_WHISTLE_RMS * 1.4142135623730951 * (rMin / r), "pl": 0, "pr": 0 };
      [ev.pl, ev.pr] = crowdPan((wrnd() * 2 - 1) * C.width * crowdR / Math.sqrt(crowdR * crowdR + D * D));
      const ts = t + (r - rMin) / 343; if (ts < C.dur) { crowdWhistle(sr, ev, out, Math.round(ts * sr), wrnd); }
    }
  }
  // ---- air absorption and the distance's dark, then a DC blocker
  const fc = 16000 * Math.pow(2, -3.5 * C.distance), al = 1 - Math.exp(-2 * Math.PI * fc / sr);
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0, dlx = 0, dly = 0, drx = 0, dry = 0;
  for (let i = 0; i < n; i++) {
    l1 += (L[i] - l1) * al; l2 += (l1 - l2) * al; r1 += (R[i] - r1) * al; r2 += (r1 - r2) * al;
    const a = l2 - dlx + 0.999 * dly; dlx = l2; dly = a; const b = r2 - drx + 0.999 * dry; drx = r2; dry = b;
    L[i] = a; R[i] = b;
  }
  return { L, R };
}

// Level a crowd buffer, in place. PEAK CONTROL first (`peak` 0..2, the patch's cwPeak), exactly blastLevel's /
// glassLevel's: the buffer brought to a 0.9 peak and run through the app's own lookahead limiter (limiterProcess) at
// min(peak, 1), ON THE CROWD ALONE, before the chain; past 1 it is brought back to 0.9 and limited again at peak - 1.
// Applause is peaky (each clap a 0.4 ms slap), and a master Limiter after `gain` would pin the peak at its ceiling
// whatever the gain (blast's lesson). Then the prototype's own level: RMS CROWD_RMS over the whole crowd, the peak
// capped at CROWD_PEAK, so Normalize off still sits it with the other engines.
function crowdLevel(L, R, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  let s = 0; pk = 0;
  for (let i = 0; i < n; i++) { s += L[i] * L[i] + R[i] * R[i]; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const rms = Math.sqrt(s / (2 * n));
  if (rms < 1e-9) return;
  const g = Math.min(CROWD_RMS / rms, CROWD_PEAK / pk);
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ── Gun (wave "gun", #38) ───────────────────────────────────────────────────────────────────────────────────────────
// Gunshots DESIGNED for game sound: hyper-real, not documentary. The blast engine (wave 31) is the physical model and
// gives what a microphone down the street hears ("a dull report and the facades' flutter"); the Guns sat on the impact
// engine, and a burst (Repeat > 1) re-gated ONE shot's envelope on a grid. Prototyped in tools/proto/gun.mjs and picked
// by ear (AJ, 2026-11-13: the model won all eight rounds, soundtests/proto-gun/; no pick was today's preset or a blast
// take); this block is that model, unchanged in its maths, with its knobs mapped from the patch by gunCfg. ONE SHOT is
// built from the layers a game gun is designed from:
//   SNAP       the first millisecond: a box-integrated pressure step 60-150 us wide with a negative lobe, plus a 0.35 ms
//              noise spit, HARD CLIPPED, so the shot lands as a square-edged click.
//   BODY       a sine whose pitch DROPS (a kick's sweep) under a Friedlander muzzle pop (0.25-1.9 ms); Caliber sets the
//              size: 260 -> 75 Hz over 25 ms at the small end, 110 -> 40 Hz over 135 ms at the big end.
//   GAS        the report's roar: noise through a low-pass that FALLS as the gas cools, its length by caliber.
//   CRACK      band-passed noise (1.4 kHz for a short barrel, 5 kHz for a long one) through tanh at drive 4, a supersonic
//              N-wave (120-320 us) on a long barrel, a high sizzle; a SHORT barrel adds the BARK (three damped modes at
//              550-900 Hz, the boxy pop of a pistol or carbine).
//   MECHANISM  per Action, from one metal-clack generator (an inharmonic modal set and a band-passed tick) and a
//              slide-friction noise: a pistol's slide unlocking and slamming home with the shot, a revolver's hammer and
//              frame, a pump racked and a bolt worked AFTER the shot, an assault rifle's carrier cycling per round (and
//              its bolt LOCKING back on the last when Empty click is up), a belt-fed's open bolt slamming forward to fire,
//              driven back, the links ticking, caught on the sear after the last; plus the CASINGS thrown out, landing
//              ~0.4 s later and bouncing (a pump's plastic hull dull). Casings default to 0: AJ's rule is that no
//              after-sound is layered on a shot (a mechanism sounding WITH the shot is fine).
//   SUPPRESSOR the crack and snap go (subsonic), the gas is low-passed and shortened, the body softened, a "pfft" of
//              band-passed gas (~750 Hz) and a baffle ring (~1.1 kHz) take their place.
//   PLACE      an impulse response built from geometry (as blast's): dry, outdoors (ground reflection, a slap-back at
//              110-160 ms, a second at ~370 ms, a dark rolling tail), street (facade flutter every ~47 ms), room, warehouse
//              (a 2 s metallic tail), canyon (smeared echoes at 0.45 / 0.8 / 1.15 s). All the shots are convolved as ONE
//              stream, so in a burst the tails overlap and build.
// THE BALANCE: each layer renders to its own bus, set to a target ENERGY over the first shot's 250 ms (the gains then
// hold for every round, so the shot-to-shot variation survives): Snap / Punch / Crack are ratios, caliber moves the
// weights. The mechanism is levelled against the shot's ENERGY over its first 150 ms, never its peak (the snap owns it).
// THE CRUNCH STAGE, after the layers: SATURATION of the high layers (asymmetric tanh, drive 1-21) and of the body on its
// own (gentler, drive 1-6), both 4x oversampled like driveOS and each brought back to its own energy (Crunch changes the
// texture, not the balance); a COMPRESSOR on the shot bus alone (threshold 6-30 dB under its peak, ratio 1.5-8, a 2.5 ms
// attack that lets the snap through and pulls the body up behind it, release 60-120 ms; the mechanism joins after it);
// the place; a final SOFT CLIP whose hardness follows Crunch; optional BITS (16 -> 4) and a sample-and-hold RATE cut
// (1x -> 8x), without anti-aliasing on purpose (the retro end); a 22 Hz DC block; the stereo width; a 60 ms end fade.
// AUTOMATIC FIRE: a rate (RPM) and a round count; each round is re-fired WHOLE: its own noise, pitch (+-4 % sd at
// Variation 1), level (+-1.2 dB sd), crack band (+-6 %), gas and body lengths (+-10 %), its cycle time (+-3.5 % sd,
// cumulative, so the rhythm breathes), the mechanism cycling, the gas thickening as the barrel heats (+15 % by round 20).
// Built up front into a stereo buffer like the blast's; the AMP ENVELOPE STAYS THE GAIN. Seeded by the patch's own
// `gunSeed` ("which take"), never Math.random; not salted per layer, like glSeed. gunLevel optionally tames the peaks
// first (Peak control, as blastLevel) and brings the buffer to a fixed loudness so Normalize off still sits it with the
// rest. Anti-aliasing: the snap, the pop and the N-wave are box-integrated at 16 sub-samples, every mode at or past
// 0.45 SR is dropped, the saturation is 4x oversampled.
const GUN_DEFAULTS = { "gunCaliber": 0.32, "gunBarrel": 0.3, "gunAction": 1, "gunSnap": 0.6, "gunPunch": 0.7, "gunCrack": 0.5,
  "gunMech": 0.4, "gunCasing": 0, "gunPlace": 1, "gunTail": 0.5, "gunSuppress": 0, "gunCrunch": 0.3, "gunComp": 0.5,
  "gunBits": 0, "gunRateCut": 0, "gunRPM": 700, "gunRounds": 1, "gunJitter": 0.4, "gunBoltLock": 0 };   // the PARAMS rows' defaults (index.html)
const GUN_ACTION_MAX = 6;           // none, slide, revolver, pump, bolt, rifle auto, belt-fed
const GUN_PLACE_MAX = 5;            // dry, outdoors, street, room, warehouse, canyon
const GUN_MECH_LEVEL = 0.9;         // the mechanism bus against a shot bus of energy GUN_E_REF over its first 150 ms
const GUN_E_REF = 0.008;            // amplitude^2 s: a typical peak-normalized, compressed shot
const GUN_PRE = 0.012;              // s before the first shot (the revolver's hammer and the open bolt's slam land in it)
const GUN_RMS = 0.12;               // gunLevel: RMS over the loudest 300 ms ...
const GUN_PEAK = 0.9;               // ... its peak capped here
const GUN_CLACK_R = [1, 1.62, 2.31, 2.93, 3.87];   // the clack's modal ratios ...
const GUN_CLACK_A = [1, 0.7, 0.55, 0.4, 0.3];      // ... their levels ...
const GUN_CLACK_T = [1, 0.8, 0.6, 0.5, 0.4];       // ... and their decays against the clack's own

const gunClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function gunRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gunGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
const gunPan = (p) => { const a = (gunClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
// a stream's seed from (seed, shot, component): mixed so neighbouring shots are unrelated
const gunSeedMix = (seed, k, salt) => (Math.imul((seed + 1) >>> 0, 2654435761) ^ Math.imul(k + 7, 40503) ^ Math.imul(salt + 13, 9973)) >>> 0;

// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function gunCfg(st) {
  const g = (k) => (st[k] == null ? GUN_DEFAULTS[k] : st[k]);
  const c = gunClamp(g("gunCaliber"), 0, 1), b = gunClamp(g("gunBarrel"), 0, 1), s = gunClamp(g("gunSuppress"), 0, 1);
  return {
    "dur": st.duration || 0, "width": st.width == null ? 0.6 : st.width,
    "cal": c, "barrel": b, "action": gunClamp(Math.round(g("gunAction")), 0, GUN_ACTION_MAX),
    "snap": g("gunSnap"), "punch": g("gunPunch"), "crack": g("gunCrack"), "mech": g("gunMech"), "casing": g("gunCasing"),
    "place": gunClamp(Math.round(g("gunPlace")), 0, GUN_PLACE_MAX), "tail": g("gunTail"), "sup": s,
    "crunch": g("gunCrunch"), "comp": g("gunComp"), "bits": g("gunBits"), "rateCut": g("gunRateCut"),
    "interval": 60 / gunClamp(g("gunRPM"), 30, 3000), "rounds": Math.max(1, Math.round(g("gunRounds"))),
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

// add a continuous waveform f(t) (t from its onset at t0 s, nonzero on [0, len)), box-integrated per sample (16 sub-samples)
function gunAddCont(buf, sr, t0, len, f, gain) {
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
// TPT state-variable filter: out = [lp, bp (unity peak), hp]
function gunSvf() { return { "a": 0, "b": 0 }; }
function gunSvfTick(f, x, g, k, out) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.b, v1 = a1 * f.a + a2 * v3, v2 = f.b + a2 * f.a + a3 * v3;
  f.a = 2 * v1 - f.a; f.b = 2 * v2 - f.b; out[0] = v2; out[1] = k * v1; out[2] = x - k * v1 - v2;
}
const gunG = (fc, sr) => Math.tan(Math.PI * gunClamp(fc, 5, sr * 0.45) / sr);
// damped modes into a mono buffer (or a stereo pair through pan gains): sum a_m e^{-t/tau_m} sin(2 pi f_m t)
function gunModes(L, R, pg, sr, t0, fs, amps, taus, gain, attack) {
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
// a metal CLACK (bolt, slide, hammer): an inharmonic modal set + a contact tick (noise band-passed around 3 f0)
function gunClack(L, R, sr, t0, f0, tau, gain, pan, rnd) {
  if (gain <= 0 || t0 < 0) return;
  const pg = gunPan(pan);
  const fs = GUN_CLACK_R.map((r) => f0 * r * (1 + 0.04 * gunGauss(rnd))), taus = GUN_CLACK_T.map((x) => x * tau);
  gunModes(L, R, pg, sr, t0, fs, GUN_CLACK_A, taus, gain * 0.5, 0.00008);
  const i0 = Math.round(t0 * sr), len = Math.min(L.length - i0, Math.round(0.004 * sr)), dk = Math.exp(-1 / (0.0004 * sr));
  const f = gunSvf(), o = [0, 0, 0], g = gunG(Math.min(8000, 3 * f0), sr);
  let e = gain * 0.9;
  for (let j = 0; j < len; j++) { gunSvfTick(f, rnd() * 2 - 1, g, 1.2, o); const v = o[1] * e; e *= dk; L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1]; }
}
// friction of a slide / bolt travelling: band-passed noise, a raised-cosine swell over len s
function gunSlide(L, R, sr, t0, len, fc, gain, pan, rnd) {
  if (gain <= 0) return;
  const pg = gunPan(pan), i0 = Math.round(t0 * sr), N = Math.min(L.length - i0, Math.round(len * sr)), f = gunSvf(), o = [0, 0, 0], g = gunG(fc, sr);
  for (let j = 0; j < N; j++) {
    gunSvfTick(f, rnd() * 2 - 1, g, 0.9, o);
    const e = Math.sin(Math.PI * j / N), v = o[1] * e * e * gain * (0.6 + 0.4 * rnd());
    L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1];
  }
}
// a CASING thrown out and bouncing: a free tube's modes, restitution-timed bounces. hull = a shotgun's plastic hull.
function gunCasingDrop(L, R, sr, tLand, f0, gain, pan, rnd, hull) {
  const pg = gunPan(pan);
  let v = 4.2 + 1.2 * rnd(), t = tLand, lv = gain;
  const e = 0.35 + 0.15 * rnd();
  for (let b = 0; b < 5 && t < L.length / sr - 0.01 && lv > gain * 0.03; b++) {
    if (hull) {
      gunModes(L, R, pg, sr, t, [f0, f0 * 2.3], [1, 0.4], [0.012, 0.006], lv * 0.6, 0.0002);
    } else {
      const fs = [1, 2.756, 5.404, 8.933].map((r) => f0 * r * (1 + 0.01 * gunGauss(rnd)));
      const which = rnd();   // a tumbling casing lands on its end or its side: which modes it reaches moves
      gunModes(L, R, pg, sr, t, fs, [0.6 + 0.4 * which, 1 - 0.5 * which, 0.5, 0.25], [0.06, 0.04, 0.025, 0.015], lv * 0.5, 0.00005);
    }
    gunClack(L, R, sr, t, hull ? 900 : 2600, 0.002, lv * 0.25, pan, rnd);   // the contact tick
    v *= e * (0.85 + 0.3 * rnd()); t += 2 * v / 9.81; lv *= 0.45 + 0.2 * rnd();
  }
}

// the place: an impulse response from geometry (stereo), built like blastPlaceIR
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
    gunModes(L, R, pg, sr, 0.02, [182, 263, 411, 587], [1, 0.8, 0.6, 0.4], [0.5, 0.42, 0.35, 0.25], 0.0035, 0.03);
  } else {                           // CANYON: rock walls, smeared echoes, darker per bounce, a long low tail
    tap(0.0035, 0.42, 7000, 2);
    cluster(0.45 + 0.05 * rnd(), 0.25, 2000, 0.03, 10);
    cluster(0.80 + 0.06 * rnd(), 0.15, 1300, 0.045, 10);
    cluster(1.15 + 0.08 * rnd(), 0.09, 900, 0.06, 10);
    tail(0.06, 0.4, 2.5 * tailMul, 1000, 300, 0.25);
  }
  return { "L": L, "R": R };
}
// mono x convolved with a stereo IR, first n samples (blastConvolve's one-FFT trick, dsp.js's fftInPlace)
function gunConvolve(x, irL, irR, n) {
  let N = 1; while (N < n + irL.length) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x.subarray(0, n)); hr.set(irL); hi.set(irR);
  fftInPlace(xr, xi, -1); fftInPlace(hr, hi, -1);
  for (let k = 0; k < N; k++) { const a = xr[k], b = xi[k], c = hr[k], e = hi[k]; hr[k] = a * c - b * e; hi[k] = a * e + b * c; }
  fftInPlace(hr, hi, 1);
  const L = new Float64Array(n), R = new Float64Array(n), inv = 1 / N;
  for (let i = 0; i < n; i++) { L[i] = hr[i] * inv; R[i] = hi[i] * inv; }
  return { "L": L, "R": R };
}

// ONE SHOT into the layer buses B (mono) and the mechanism bus (stereo ML/MR). k = the round's index.
function gunShot(B, ML, MR, sr, c, t0, k, last, seed) {
  const J = c.jitter, rs = gunRng(gunSeedMix(seed, k, 1)), sup = c.sup;
  const lvl = Math.pow(10, (J * 1.2 * gunGauss(rs) + (k === 0 ? 0.6 : 0)) / 20);
  const pm = 1 + 0.04 * J * gunGauss(rs), cm = 1 + 0.06 * J * gunGauss(rs), tm = 1 + 0.10 * J * gunGauss(rs), heat = 1 + 0.15 * Math.min(1, k / 20);
  const i0 = Math.round(t0 * sr), n = ML.length, SN = B.sn, BO = B.bo, GA = B.ga, CR = B.cr, SU = B.su;
  // SNAP: a square-edged pressure step and a noise spit, hard clipped
  const snapG = c.snap * (1 - 0.85 * sup) * lvl;
  if (snapG > 0) {
    const w = (0.00006 + 0.00009 * c.cal) * (1 + 0.1 * J * gunGauss(rs)), tmp = new Float64Array(Math.round(0.004 * sr));
    gunAddCont(tmp, sr, 0, w + 0.00025, (t) => (t < w ? 1 : -0.3), 1);
    const rn = gunRng(gunSeedMix(seed, k, 2)), dk = Math.exp(-1 / (0.00035 * sr));
    let e = 0.9;
    for (let j = 0; j < tmp.length; j++) { tmp[j] += (rn() * 2 - 1) * e; e *= dk; }
    for (let j = 0; j < tmp.length && i0 + j < n; j++) SN[i0 + j] += gunClamp(tmp[j] * 1.6, -0.75, 0.75) * snapG;
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
    gunAddCont(BO, sr, t0, T * 8, (t) => { const u = t / T; return (1 - u) * Math.exp(-bF * u); }, bodyG * 0.9 * (1 - 0.5 * sup));
  }
  // GAS: noise, its low-pass falling as it cools
  const gasG = (0.35 + 0.5 * c.crack) * (0.4 + 0.6 * c.cal) * (1 - 0.5 * sup) * lvl * heat;
  {
    const tau = c.tauGas * tm * (1 - 0.5 * sup), hi = c.gasHi * (1 - 0.82 * sup), lo = c.gasLo * (1 - 0.3 * sup);
    const len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr)), f = gunSvf(), o = [0, 0, 0], rn = gunRng(gunSeedMix(seed, k, 3));
    let e = gasG;
    for (let j = 0; j < len; j++) {
      const fc = lo + (hi - lo) * Math.exp(-j / (0.8 * tau * sr));
      gunSvfTick(f, rn() * 2 - 1, gunG(fc, sr), 1.2, o);
      GA[i0 + j] += o[0] * e * (j < 20 ? j / 20 : 1); e *= dk;
    }
  }
  // CRACK: band-passed noise through tanh, the supersonic N-wave, the sizzle; the BARK of a short barrel
  const crackG = c.crack * Math.pow(1 - sup, 3) * lvl;
  if (crackG > 0.001) {
    const fc = c.crackHz * cm, tau = c.tauCrack * tm, len = Math.min(n - i0, Math.ceil(7 * Math.max(tau, 0.04) * sr));
    const f = gunSvf(), f2 = gunSvf(), o = [0, 0, 0], o2 = [0, 0, 0], rn = gunRng(gunSeedMix(seed, k, 4)), g1 = gunG(fc, sr), g2 = gunG(5200, sr);
    const dk = Math.exp(-1 / (tau * sr)), tauS = 0.02 + 0.03 * c.barrel, dkS = Math.exp(-1 / (tauS * sr)), th = Math.tanh(4);
    let e = 1, eS = 0.22;
    for (let j = 0; j < len; j++) {
      const x = rn() * 2 - 1;
      gunSvfTick(f, x, g1, 0.85, o); gunSvfTick(f2, x, g2, 1.0, o2);
      CR[i0 + j] += (Math.tanh(4 * o[1] * e * 1.4) / th) * crackG * 0.9 + o2[2] * eS * crackG;
      e *= dk; eS *= dkS;
    }
    if (c.nwave > 0) { const T = c.nT; gunAddCont(CR, sr, t0, T, (t) => 1 - 2 * t / T, crackG * c.nwave * 0.9); }
  }
  const barkG = c.bark * (0.3 + 0.7 * c.crack) * (1 - 0.7 * sup) * lvl * 0.55;
  if (barkG > 0.001) { const f0 = c.barkHz * cm; gunModes(CR, null, null, sr, t0, [f0, f0 * 1.47, f0 * 2.09], [1, 0.7, 0.45], [0.011 * tm, 0.008, 0.006], barkG, 0.0002); }
  // SUPPRESSOR: the "pfft" and the baffle ring
  if (sup > 0) {
    const tau = 0.012 + 0.01 * c.cal, len = Math.min(n - i0, Math.ceil(6 * tau * sr)), f = gunSvf(), o = [0, 0, 0], rn = gunRng(gunSeedMix(seed, k, 5)), gg = gunG(750 * cm, sr), dk = Math.exp(-1 / (tau * sr));
    let e = sup * 0.9 * lvl;
    for (let j = 0; j < len; j++) { gunSvfTick(f, rn() * 2 - 1, gg, 1.1, o); SU[i0 + j] += o[1] * e * (j < 30 ? j / 30 : 1); e *= dk; }
    gunModes(SU, null, null, sr, t0 + 0.0005, [1100 * cm, 2650 * cm], [1, 0.35], [0.006, 0.004], sup * 0.3 * lvl, 0.0003);
  }
  // MECHANISM, per action (into the stereo mechanism bus, placed a little right of the shot)
  const rm = gunRng(gunSeedMix(seed, k, 6)), M = c.mech, cl = c.cal, I = c.interval, act = c.action;
  const jt = () => 1 + 0.03 * J * gunGauss(rm);
  if (M > 0) {
    if (act === 1) {                  // SLIDE: unlocking under the shot, slamming home ~22 ms later
      gunClack(ML, MR, sr, t0 + 0.0012, 1900 * (1 - 0.25 * cl), 0.008, M * 0.25, 0.2, rm);
      gunSlide(ML, MR, sr, t0 + 0.003, 0.018 * jt(), 3200, M * 0.08, 0.2, rm);
      gunClack(ML, MR, sr, t0 + 0.022 * jt(), 1650 * (1 - 0.25 * cl), 0.022, M * 0.7, 0.25, rm);
    } else if (act === 2) {           // REVOLVER: the hammer falling 4 ms before, the frame ringing
      gunClack(ML, MR, sr, t0 - 0.004, 2800, 0.006, M * 0.45, 0.15, rm);
      gunModes(ML, MR, gunPan(0.1), sr, t0 + 0.001, [2350, 3720, 5100], [1, 0.6, 0.3], [0.09, 0.06, 0.04], M * 0.06, 0.0005);
    } else if (act === 3) {           // PUMP: racked AFTER the shot (if the next round leaves time)
      const tb = t0 + 0.40 * jt();
      if (last || I > 0.8) {
        gunSlide(ML, MR, sr, tb, 0.08, 1800, M * 0.22, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.08, 640, 0.03, M * 0.65, 0.3, rm);
        gunSlide(ML, MR, sr, tb + 0.16, 0.06, 2200, M * 0.18, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.22, 820, 0.026, M * 0.7, 0.3, rm);
      }
    } else if (act === 4) {           // BOLT, worked by hand AFTER the shot
      if (last || I > 0.9) {
        const tb = t0 + 0.42 * jt();
        gunClack(ML, MR, sr, tb, 2200, 0.01, M * 0.45, 0.3, rm);
        gunSlide(ML, MR, sr, tb + 0.03, 0.08, 2600, M * 0.2, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.11, 1100, 0.025, M * 0.75, 0.3, rm);
        gunSlide(ML, MR, sr, tb + 0.2, 0.06, 2800, M * 0.16, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.26, 1300, 0.02, M * 0.7, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.33, 1900, 0.012, M * 0.6, 0.3, rm);
      }
    } else if (act === 5) {           // RIFLE AUTO (closed bolt): the carrier to its stop and back into battery
      const cyc = Math.min(I, 0.09);
      gunClack(ML, MR, sr, t0 + 0.35 * cyc * jt(), 950 * (1 - 0.25 * cl), 0.012, M * 0.4, 0.25, rm);
      gunModes(ML, MR, gunPan(0.25), sr, t0 + 0.3 * cyc, [470 * jt(), 940], [1, 0.3], [0.04, 0.02], M * 0.035, 0.004);   // buffer spring
      if (last && c.boltLock > 0) {
        gunClack(ML, MR, sr, t0 + 0.45 * cyc * jt(), 1500, 0.014, c.boltLock * M * 1.1, 0.25, rm);
        gunClack(ML, MR, sr, t0 + 0.45 * cyc + 0.012, 2600, 0.006, c.boltLock * M * 0.5, 0.25, rm);
      } else gunClack(ML, MR, sr, t0 + 0.75 * cyc * jt(), 1300 * (1 - 0.25 * cl), 0.02, M * 0.7, 0.25, rm);
    } else if (act === 6) {           // BELT-FED (open bolt)
      const cyc = Math.min(I, 0.12);
      gunClack(ML, MR, sr, t0 - 0.003, 700 * (1 - 0.25 * cl), 0.03, M * 0.6, 0.2, rm);       // slam forward (fires it)
      gunClack(ML, MR, sr, t0 + 0.4 * cyc * jt(), 620 * (1 - 0.2 * cl), 0.025, M * 0.45, 0.2, rm);   // driven back
      for (let q = 0; q < 3; q++) gunClack(ML, MR, sr, t0 + (0.5 + 0.08 * q + 0.03 * rm()) * cyc, 3400 * jt(), 0.004, M * 0.14, 0.45 + 0.1 * q, rm);   // links
      if (last) gunClack(ML, MR, sr, t0 + 0.45 * cyc + 0.01, 650 * (1 - 0.2 * cl), 0.04, M * (0.8 + 0.4 * c.boltLock), 0.2, rm);   // caught on the sear
    }
  }
  // CASING (not for a revolver, which keeps its brass)
  if (c.casing > 0 && act !== 2 && act !== 0) {
    const hull = act === 3, rc = gunRng(gunSeedMix(seed, k, 7));
    const tl = (hull ? t0 + 0.62 + 0.15 * rc() : t0 + 0.36 + 0.14 * rc());
    const f0 = hull ? 650 : (6800 - 3800 * cl) * (1 + 0.04 * gunGauss(rc));
    gunCasingDrop(ML, MR, sr, tl, f0, c.casing * (hull ? 0.3 : 0.12) * (0.7 + 0.6 * rc()), 0.3 + 0.6 * (rc() - 0.3), rc, hull);
  }
}

// asymmetric tanh, 4x oversampled (driveOS's method), on a peak-normalized copy, then back to the energy the buffer had
// over [w0, w1)
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

// The whole gun: n samples of stereo (Float32), seeded, NOT yet levelled (gunLevel does that). Returns { L, R, info }.
function makeGun(sr, n, cfg, seed) {
  const c = cfg, J = c.jitter, rt = gunRng(gunSeedMix(seed, 9999, 0));
  n = Math.max(64, n);
  // the shots' times: a cyclic rate that breathes (cumulative jitter)
  const times = [];
  let t = GUN_PRE + (c.action === 6 ? 0.008 : 0);
  for (let k = 0; k < c.rounds; k++) { times.push(t); t += c.interval * (1 + 0.035 * J * gunGauss(rt)); }
  const ML = new Float64Array(n), MR = new Float64Array(n);
  const B = { "sn": new Float64Array(n), "bo": new Float64Array(n), "ga": new Float64Array(n), "cr": new Float64Array(n), "su": new Float64Array(n) };
  times.forEach((tk, k) => gunShot(B, ML, MR, sr, c, tk, k, k === times.length - 1, seed));
  // THE BALANCE: each layer's bus set to a target ENERGY over the first shot's 250 ms
  const sup = c.sup, cal = c.cal;
  const want = { "sn": 0.10 * c.snap * c.snap * (1 - 0.85 * sup),
    "bo": 1.1 * c.punch * c.punch * (0.6 + 0.8 * cal) * (1 - 0.5 * sup),
    "ga": (0.5 + 0.7 * cal) * Math.pow(1 - 0.6 * sup, 2),
    "cr": 1.0 * c.crack * c.crack * (1 - 0.1 * cal) * Math.pow(1 - sup, 4),
    "su": 0.6 * sup * sup };
  const w0 = Math.round(times[0] * sr), w1 = Math.min(n, w0 + Math.round(0.25 * sr));
  const SLo = new Float64Array(n), SHi = new Float64Array(n);
  for (const k in B) {
    let e = 0; const x = B[k], dst = k === "bo" ? SLo : SHi; for (let i = w0; i < w1; i++) e += x[i] * x[i];
    const gk = e > 1e-20 && want[k] > 0 ? Math.sqrt(want[k] / (e / sr)) : 0;
    if (gk) for (let i = 0; i < n; i++) dst[i] += x[i] * gk;
  }
  // SATURATION: the high layers at the full drive, the body gentler, each back to its own energy
  const d = 1 + 20 * Math.pow(c.crunch, 1.5), bias = 0.15 * c.crunch;
  gunSaturate(SHi, d, bias, w0, w1);
  gunSaturate(SLo, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  const S = new Float64Array(n); for (let i = 0; i < n; i++) S[i] = SLo[i] + SHi[i];
  // COMPRESSOR on the shot bus alone (log domain); the mechanism joins after it, so it never lifts it
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
        S[i] *= Math.pow(10, -gr / 20);
      }
      p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(S[i]));
      for (let i = 0; i < n; i++) S[i] /= p || 1;
    } }
  // the DRY gun: the shot bus + the mechanism, levelled against the shot's ENERGY over its first 150 ms
  let Es = 0; for (let i = w0; i < Math.min(n, w0 + Math.round(0.15 * sr)); i++) Es += S[i] * S[i];
  Es /= sr;
  const mg = GUN_MECH_LEVEL * Math.sqrt(Es / GUN_E_REF);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) { L[i] = S[i] + ML[i] * mg; R[i] = S[i] + MR[i] * mg; }
  // PLACE: the compressed dry gun through it; in a burst the tails overlap and build
  const tailMul = 0.5 + c.tail, wetG = 1.2 * c.tail * (1 - 0.6 * sup);
  const ir = gunPlaceIR(sr, c.place, tailMul, gunRng(gunSeedMix(seed, 8888, 0)));
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
  // DC (the asymmetric clip and the pop have area): 2-pole high-pass at 22 Hz; the stereo width; a 60 ms end fade
  const hpA = Math.exp(-2 * Math.PI * 22 / sr);
  for (const X of [L, R]) { let h1 = 0, x1 = 0, h2 = 0, y1 = 0; for (let i = 0; i < n; i++) { h1 = hpA * (h1 + X[i] - x1); x1 = X[i]; h2 = hpA * (h2 + h1 - y1); y1 = h1; X[i] = h2; } }
  const w = gunClamp(c.width, 0, 1) / 0.6;
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2 * w; L[i] = m + s; R[i] = m - s; }
  const fo = Math.min(n, Math.round(0.06 * sr)); for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  return { "L": Float32Array.from(L), "R": Float32Array.from(R), "info": { "times": times, "interval": c.interval, "rounds": c.rounds } };
}
// Level a gun buffer, in place. PEAK CONTROL first (`peak` 0..2, the patch's gunPeak), exactly blastLevel's / glassLevel's:
// the buffer brought to a 0.9 peak and run through the app's own lookahead limiter (limiterProcess) at min(peak, 1), ON
// THE GUN ALONE, before the chain; past 1 it is brought back to 0.9 and limited again at peak - 1 (a shot is nearly all
// spike, and a master Limiter after `gain` would pin the peak whatever the gain, so Variations could not level a pack).
// Then the prototype's own level: RMS GUN_RMS over the loudest 300 ms, the peak capped at GUN_PEAK, so Normalize off
// still sits it with the other engines.
function gunLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = GUN_RMS / Math.sqrt(best);
  if (pk * g > GUN_PEAK) g = GUN_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}


// ── Energy (wave "energy", #39) ─────────────────────────────────────────────────────────────────────────────────────
// Energy weapons: plasma, rail, pulse and ion guns. The sci-fi guns were a falling saw with a ring mod, a noise-and-boom
// patch, a bred patch with a 75 ms fade-in and the impact engine with a ring mod; nothing modeled what an energy weapon
// DOES: store energy, dump it in one violent instant, throw something, kick the shooter, and cool down. Prototyped in
// tools/proto/energy.mjs and picked by ear (AJ, 2026-11-13: the model won all five rounds, soundtests/proto-energy/; no
// pick was today's preset or the full-auto control); this block is that model, unchanged in its maths, with its knobs
// mapped from the patch by energyCfg. One trigger = one charge, then `rounds` shots at `rate`, then one afterglow:
//   CHARGE     (Charge time, optional) a capacitor whine climbing the charge curve f = lo + (hi - lo)(1 - e^(-3t/T)),
//              a flyback flutter that speeds up as it fills and a coil HUM under it (a 100 Hz narrow pulse). It stops
//              dead at the trigger.
//   DISCHARGE  one model per Type, each with a HARD TRANSIENT (a differentiated spike + 0.3-1.2 ms of bright noise):
//                plasma  a dense, saturated, pitch-DROPPING FM burst (carrier from Frequency to 0.28-0.4 of it, modulators
//                        at sqrt 2 and 1/2, the index falling, its level roiled by a random drift), a noise band tracking
//                        the carrier and a HOT 3.6 kHz band gone in 20-50 ms.
//                rail    an electromagnetic SLAM: the rails STRUCK (a free-free bar's modes from Frequency), a low THUD
//                        (110 -> 45 Hz); ~1.5 ms later the slug's N-WAVE crack with its ground reflection and a hyper-
//                        bright burst, the rails' high modes ringing on and an electric ZAP. Coil stages > 1 make it a
//                        COILGUN: the coils fire in turn as the slug accelerates (gaps shrinking as 1/sqrt(k)).
//                pulse   a clean, tight packet: a polyBLEP pulse, two voices +-6 cents across the stereo field, chirping
//                        in from 1.6x and settling an octave down through a closing resonant low-pass, a ring-mod sheen.
//                ion     an ARC: a Poisson storm of crackle grains, a narrow-pulse buzz at Frequency / 4, a falling zap.
//   BOLT       the projectile leaving: a whine whose DOPPLER is real geometry (the gun 0.6 m to one side, the bolt flying
//              straight out: it falls as the bolt goes from beside you to straight away), 1/r level, air absorption and
//              the pan sliding to center; a railgun's hypersonic slug TEARS the air instead (a band falling 9 -> 2.5 kHz).
//   RECOIL     (Punch) a sine falling 160 Hz -> ~50 Hz and the body's 220 Hz thock: weight.
//   AFTERGLOW  after the last shot (Tail, grown by the burst's Heat): sizzle, a coil cooling, a VENT hissing (Vent).
//   CRUNCH     the discharge and the recoil (the gun) go through ONE biased tanh together, 4x OVERSAMPLED (a 64-tap
//              windowed sinc up and down), so the kick and the bolt clip into each other; above 0.6 a bit reduction for
//              grit. The snap, the rail's crack, the charge, the bolt and the afterglow stay OUTSIDE it, so it never
//              rounds off the front. The cost: ~28-34 ms of CPU per second of audio (measured on the picks), most of it here.
//   AUTO FIRE  Rate and Rounds re-fire the WHOLE shot every round (discharge, transient, recoil, bolt), each with its own
//              noise and its own small variation (Shot variation: pitch +-4 %, level +-1.5 dB, timing +-3 % of a cycle);
//              Heat sags the pitch through the burst (up to 7 %), thickens the noise and grows the afterglow. So an
//              energy preset keeps Repeat at 1.
// Built up front into a stereo buffer like the gun's; the AMP ENVELOPE STAYS THE GAIN. Seeded by the patch's own
// `enSeed` ("which take"), never Math.random (own LCGs per component and per shot, so a level knob never reshuffles a
// shot); not salted per layer, like gunSeed. energyLevel optionally tames the peaks first (Peak control, as gunLevel)
// and brings the buffer to a fixed loudness so Normalize off still sits it with the rest. The prototype's take seed is
// `enSeed` here (its own second seed was 0 in every take, so it is dropped: the streams are identical).
const ENERGY_TYPES = ["plasma", "rail", "pulse", "ion"];   // append-only (stored as an index): the Type row's enum
const ENERGY_DEFAULTS = { "enType": 0, "enPower": 0.5, "enCharge": 0, "enPunch": 0.6, "enCrunch": 0.4, "enBolt": 0.5,
  "enTail": 0.4, "enVent": 0.3, "enStages": 1, "enRate": 10, "enRounds": 1, "enVary": 0.3, "enHeat": 0.3 };   // the PARAMS rows' defaults (index.html)
const EN_RMS = 0.12;                // energyLevel: RMS over the loudest 300 ms ...
const EN_PEAK = 0.9;                // ... its peak capped here
// Per type: the default `freq`, the bolt's pitch ratio and speed (m/s at power 0 .. 1), and the afterglow mix.
const ENERGY_KINDS = [
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
const enPan = (p) => { const a = (enClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };

// a TPT state-variable filter (Zavalishin), one sample at a time; the coefficient is recomputed only when f moves 0.5%
function enSvf(sr) {
  let ic1 = 0, ic2 = 0, fLast = -1, qLast = -1, a1 = 0, a2 = 0, a3 = 0, k = 1;
  const o = { "lp": 0, "bp": 0, "hp": 0 };
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
  const RATIO = [1, 2.756, 5.404, 8.933, 13.344];
  const AMP = [1, 0.7, 0.5, 0.35, 0.25];
  const T60 = [0.35, 0.22, 0.14, 0.09, 0.06];
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
  return { "n": Math.round((tCrack + 1) * sr), "tCrack": tCrack };
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
const EN_OS = 4;
const EN_TAPS = 64;
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

// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name). The
// prototype's "dur" and "seed" are not here: the app hands makeEnergy its buffer length (the Duration) and its seed
// (the patch's own `enSeed`) directly, as makeGun's.
function energyCfg(st) {
  const g = (k) => (st[k] == null ? ENERGY_DEFAULTS[k] : st[k]);
  const type = enClamp(Math.round(g("enType")), 0, ENERGY_TYPES.length - 1);
  return {
    "type": type, "freq": st.freq || ENERGY_KINDS[type]["freq"], "width": st.width == null ? 0.5 : st.width,
    "power": enClamp(g("enPower"), 0, 1), "charge": enClamp(g("enCharge"), 0, 2.5), "punch": enClamp(g("enPunch"), 0, 1),
    "crunch": enClamp(g("enCrunch"), 0, 1), "bolt": enClamp(g("enBolt"), 0, 1), "tail": enClamp(g("enTail"), 0, 1),
    "vent": enClamp(g("enVent"), 0, 1), "stages": enClamp(Math.round(g("enStages")), 1, 8),
    "rate": enClamp(g("enRate"), 1, 25), "rounds": enClamp(Math.round(g("enRounds")), 1, 60),
    "vary": enClamp(g("enVary"), 0, 1), "heat": enClamp(g("enHeat"), 0, 1),
  };
}

// the whole weapon: n samples of stereo (the patch's Duration), seeded by the patch's `enSeed`. Returns { L, R, info }
// UNLEVELLED (energyLevel does that, after its own Peak control); info.shots are the rounds' times in seconds.
function makeEnergy(sr, n, cfg, seed) {
  const kind = ENERGY_KINDS[cfg.type], rounds = cfg.rounds, rate = cfg.rate;
  const tShot0 = EN_LEAD + cfg.charge, lastShot = tShot0 + (rounds - 1) / rate;
  n = Math.max(64, n);
  const gL = new Float64Array(n), gR = new Float64Array(n), aL = new Float64Array(n), aR = new Float64Array(n);
  const sd = (seed >>> 0) * 7919;
  const info = { "shots": [], "type": ENERGY_TYPES[cfg.type] };
  if (cfg.charge > 0) enChargeStage(aL, aR, sr, cfg.charge + EN_LEAD, cfg, enRng(sd + 11));   // outside the crunch, or the saturator lifts it level with the shot
  const vr = enRng(sd + 23);
  for (let k = 0; k < rounds; k++) {
    const h = rounds > 1 ? cfg.heat * k / (rounds - 1) : 0;
    const jit = k > 0 ? (vr() * 2 - 1) * 0.03 * cfg.vary / rate : 0;
    const t = tShot0 + k / rate + jit, i0 = Math.round(t * sr);
    const s = { "f": cfg.freq * (1 + (vr() * 2 - 1) * 0.04 * cfg.vary) * (1 - 0.07 * h), "lv": Math.pow(10, (vr() * 2 - 1) * 1.5 * cfg.vary / 20),
      "pw": cfg.power, "nz": 1 + 0.6 * h, "rnd": enRng(sd + 1000 + k * 31), "tauCap": rounds > 1 ? 0.33 / rate : 1 };
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
  return { "L": L, "R": R, "info": info };
}

// Peak control (0 = off, as the prototype's takes; up to 1 the app's limiter once, past 1 again: gunLevel's), then the
// level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9. In place.
function energyLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = EN_RMS / Math.sqrt(best);
  if (pk * g > EN_PEAK) g = EN_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ── Chip gun (wave "chipgun", #40) ──────────────────────────────────────────────────────────────────────────────────
// The retro console gunshot: pistols, shotguns, full auto and blasters, as the old machines and their sound drivers made
// them. A generic retro generator (and the console presets before this: Woodgrain Shot, Mega Shot, 8-Bit Laser) draws
// white noise and a square and crushes them; what made a console gunshot crunchy was the HARDWARE played once a video
// frame: a shift-register noise channel whose clock the driver steps darker every frame (the "pshhh") at a 4-bit volume
// that stairs down, a triangle kick whose pitch is rewritten per frame, a mixer that ducks one channel under another, FM
// operators fed back on themselves until they turn to grit, compressed 4-bit samples played at the wrong pitch, and ONE
// noise channel, so an automatic weapon cuts its own tail every round. Prototyped in tools/proto/chipgun.mjs and picked
// by ear (AJ, 2026-11-13: the model won all four rounds, soundtests/proto-chipgun/; no pick was today's preset). This
// block is that model, unchanged in its maths, its knobs mapped from the patch by chipgunCfg. Three machines, described
// to the user by their SOUND (the chips they are modelled on are named here only):
//   8-BIT CHIP     two pulse channels, a triangle and a noise channel (modelled on the 2A03, CPU clock 1.789773 MHz).
//                  NOISE: a 15-bit LFSR, long mode (taps 0,1: hiss) or short mode (taps 0,6: a metallic buzz), clocked
//                  from the 16-entry period table, output 0 or the 4-bit volume. TRIANGLE: the 32-step staircase, on or
//                  off only (a halted triangle HOLDS its step: the "thunk"), its linear counter at 240 Hz. PULSE: 12.5 /
//                  25 / 50 % duty, 4-bit volume and the hardware sweep unit (period += period >> shift every P+1
//                  half-frames, muting past 0x7FF). MIXER: the chip's own nonlinear DAC formulas, so a loud noise burst
//                  squashes the triangle under it. OUTPUT: a 40 Hz and a 14 kHz one-pole.
//   FM CHIP        four-operator FM and a square-wave noise chip beside it (modelled on the YM2612 + SN76489). FM at the
//                  chip's own 53 267 Hz: a 10-bit phase into a log-sine and an exponential table (13-bit magnitude,
//                  envelope in 0.094 dB steps), operator 1 fed back on itself (feedback 7: chaotic grit), each channel
//                  through a 9-bit DAC with the crossover step, then to 44.1 kHz by linear interpolation with no
//                  anti-alias filter. NOISE CHIP: a 16-bit LFSR (taps 0,3; white or periodic) clocked at 3.58 MHz / 32N,
//                  N from the third tone channel so a driver can sweep it; volume as 4-bit attenuation in 2 dB steps.
//   16-BIT SAMPLER a sample player (modelled on the S-DSP). The gun is a "recording" made by this engine's own clean
//                  synthesis (crack, a band of noise falling as it decays, a sine boom, a metal ring, a blaster's chirp),
//                  stored the way a cartridge stored it: decimated with no filter, 4-bit ADPCM (BRR: 16 samples a block,
//                  a shift and one of four predictors per block), played back by pitch register (heavier calibers play
//                  the same sample lower), gaussian-interpolated or, at high Crunch, drop-sample, at 32 kHz, 7-bit voice
//                  volume, the hardware echo (16 ms steps, an 8-tap FIR, feedback), held or interpolated to 44.1 kHz.
// THE SOUND DRIVER: a script of register writes once per 60 Hz frame. Rounds are fired ON FRAMES (a rate of 13/s becomes
// "every 5 frames" = 12/s), every round restarts the script on the same channel (the last round's tail and echo are CUT;
// the noise channel is always one), and Channels lets the pulse / FM / sampler parts rotate over 1-4 channels so a tail
// may ring under the next round. Per-shot variation is what drivers did: the start noise period a step up or down, the
// volume a step down, the pitch a few percent. Echo is the driver replaying the shot quieter on the same channel (8-bit,
// FM) or the sampler's hardware echo.
// CRUNCH: the machines' own quantization is always on; Crunch adds the wrong conversion, a sample-and-hold at 44.1 kHz /
// 2^(3 crunch) (a fractional ratio, so content folds: real aliasing) and a bit depth of 16 - 11 crunch, after the output
// is set to peak 0.9. On the sampler it lowers the STORAGE rate (32 kHz / 2^(2.5 crunch)) and, from 0.5, drops the
// interpolator and holds the output.
// MONO, as the machines were: one buffer written to L and R (centered). Built up front like the gun's; the AMP ENVELOPE
// STAYS THE GAIN. Seeded by the patch's own `cgSeed` ("which take"), never Math.random; not salted per layer, like
// enSeed. The prototype's take seed is `cgSeed` here (its own second seed was 0 in every take, so the 0 is written in
// where it hashed: the streams are identical). chipgunLevel optionally tames the peaks first (Peak control, as gunLevel)
// and brings the buffer to a fixed loudness so Normalize off still sits it with the rest.
const CHIPGUN_MACHINES = ["8-bit chip", "FM chip", "16-bit sampler"];   // append-only (stored as an index): the Machine row
const CHIPGUN_DEFAULTS = { "cgConsole": 0, "cgCaliber": 0.35, "cgSnap": 0.6, "cgThump": 0.6, "cgSweep": 0.5, "cgLength": 0.5,
  "cgMetal": 0, "cgZap": 0, "cgEcho": 0, "cgCrunch": 0.25, "cgRate": 12, "cgRounds": 1, "cgVary": 0.3, "cgVoices": 1 };   // the PARAMS rows' defaults (index.html)
const CG_FPS = 60;                  // the driver's frame rate (NTSC vertical blank)
const CG_CPU = 1789773;             // 8-bit chip clock (2A03, NTSC)
const CG_NOISE_PER = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];   // CPU cycles per LFSR clock
const CG_DUTY = [[0, 1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0, 0]];
const CG_TRI = Array.from({ "length": 32 }, (_, i) => (i < 16 ? 15 - i : i - 16));
const CG_FM_RATE = 7670453 / 144;   // FM chip sample rate (YM2612, NTSC): 53 267 Hz
const CG_PSG_CLK = 3579545;         // noise chip clock (SN76489, NTSC)
const CG_SMP_RATE = 32000;          // sampler output rate (S-DSP)
const CG_LEAD = 0.004;              // s of silence before the first round
const CG_FM_RELEASE = 400;          // dB/s after an FM key-off
const CG_GAUSS_SIGMA = 0.63;        // the sampler's 4-tap gaussian interpolator (approximated)
const CG_RMS = 0.12;                // chipgunLevel: RMS over the loudest 300 ms ...
const CG_PEAK = 0.9;                // ... its peak capped here
const CG_LOGSIN = Array.from({ "length": 256 }, (_, i) => Math.round(-Math.log2(Math.sin((i + 0.5) * Math.PI / 512)) * 256));
const CG_EXP = Array.from({ "length": 256 }, (_, i) => Math.round((Math.pow(2, i / 256) - 1) * 1024));

const cgClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// one seeded decision: hash of the integers given, in [0, 1)
function cgHash(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) { h = Math.imul(h ^ (x | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function cgRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// one-pole filters in place
function cgHP(x, sr, fc) {
  const a = Math.exp(-2 * Math.PI * fc / sr); let px = x[0], py = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; py = a * (py + v - px); px = v; x[i] = py; }
}
function cgLP(x, sr, fc) {
  const a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr); let y = x[0];
  for (let i = 0; i < x.length; i++) { y = x[i] + (y - x[i]) * a; x[i] = y; }
}

// knob values -> the drivers (keys quoted: the exporter's app-global scan reads a bare key as a name). The prototype's
// "dur" and "seed" are not here: the app hands makeChipgun its buffer length (the Duration) and its seed (the patch's
// own `cgSeed`) directly, as makeEnergy's.
function chipgunCfg(st) {
  const g = (k) => (st[k] == null ? CHIPGUN_DEFAULTS[k] : st[k]);
  const fpr = cgClamp(Math.round(CG_FPS / cgClamp(g("cgRate"), 2, 30)), 2, 30);   // frames per round
  return {
    "console": cgClamp(Math.round(g("cgConsole")), 0, CHIPGUN_MACHINES.length - 1),
    "cal": cgClamp(g("cgCaliber"), 0, 1), "snap": cgClamp(g("cgSnap"), 0, 1), "thump": cgClamp(g("cgThump"), 0, 1),
    "sweep": cgClamp(g("cgSweep"), 0, 1), "lenMul": Math.pow(2, 2 * cgClamp(g("cgLength"), 0, 1) - 1),
    "metal": cgClamp(g("cgMetal"), 0, 1), "zap": cgClamp(g("cgZap"), 0, 1), "echo": cgClamp(g("cgEcho"), 0, 1),
    "crunch": cgClamp(g("cgCrunch"), 0, 1), "fpr": fpr, "rate": CG_FPS / fpr,
    "rounds": cgClamp(Math.round(g("cgRounds")), 1, 40), "vary": cgClamp(g("cgVary"), 0, 1),
    "voices": cgClamp(Math.round(g("cgVoices")), 1, 4),
  };
}

// the rounds: frame, index, and the per-shot variation draws (what a driver randomized). The 0 is the prototype's
// second seed (its Variation row), 0 in every take; the take's seed is `seed`.
function cgShots(cfg, seed, F) {
  const out = [], lead = Math.round(CG_LEAD * CG_FPS);
  for (let k = 0; k < cfg["rounds"]; k++) {
    const frame = lead + k * cfg["fpr"]; if (frame >= F) break;
    const v = cfg["vary"], h = (s) => cgHash(seed, 0, k, s);
    const u0 = h(1);
    out.push({ "k": k, "frame": frame,
      "dIdx": k === 0 ? 0 : (u0 < v * 0.4 ? -1 : u0 > 1 - v * 0.4 ? 1 : 0),       // noise start period a step up / down
      "vScale": k === 0 ? 1 : 1 - v * 0.2 * h(2),                                 // volume a step or two down
      "dPitch": k === 0 ? 0 : (h(3) * 2 - 1) * 0.06 * v,                          // pitch +-6 % at full variation
    });
  }
  return out;
}

// 8-BIT CHIP. The sweep unit's (shift, period) nearest to a wanted per-half-frame pitch ratio (the hardware can only do these)
function cg8SweepFor(ratio) {
  let best = [3, 0], be = Infinity;
  for (let s = 2; s <= 7; s++) for (let p = 0; p <= 2; p++) {
    const r = Math.pow(1 + Math.pow(2, -s), 1 / (p + 1)), e = Math.abs(Math.log(r / ratio));
    if (e < be) { be = e; best = [s, p]; }
  }
  return best;
}
// the driver: per-frame (noise), per-quarter-frame (triangle) and per-half-frame (pulse) register timelines
function cg8Timeline(cfg, shots, F) {
  const T = {
    "nVol": new Uint8Array(F), "nIdx": new Uint8Array(F), "nMode": new Uint8Array(F),
    "tri": new Int32Array(F * 4).fill(-1),
    "pPer": [new Int32Array(F * 2).fill(-1), new Int32Array(F * 2).fill(-1)],
    "pVol": [new Uint8Array(F * 2), new Uint8Array(F * 2)], "pDuty": [new Uint8Array(F * 2), new Uint8Array(F * 2)],
  };
  const c = cfg["cal"], snap = cfg["snap"], zap = cfg["zap"], noiseLvl = 1 - 0.85 * zap, lm = cfg["lenMul"];
  const clearPulse = (p, from) => { T.pPer[p].fill(-1, from * 2); T.pVol[p].fill(0, from * 2); };
  for (const sh of shots) {
    const s = sh.frame;
    // NOISE (one channel: the round steals it, cutting the last round and its echo)
    T.nVol.fill(0, s);
    const L = Math.max(2, Math.round((6 + 26 * c) * lm * (1 - 0.55 * zap)));
    const start = cgClamp(Math.round(2 + 9 * c) + sh.dIdx, 0, 15), nMetal = Math.round(cfg["metal"] * 3);
    const nv = [], ni = [];
    for (let k = 0; k < L; k++) {
      const u = k / L;
      let vol = 15 * noiseLvl * sh.vScale * Math.exp(-k / (L * 0.3)), idx = start + Math.round(cfg["sweep"] * (15 - start) * Math.pow(u, 0.7));
      if (k === 0) { vol = 15 * Math.min(1, noiseLvl + 0.5 * snap) * sh.vScale; idx = Math.max(0, start - Math.round(snap * 5)); }
      nv.push(cgClamp(Math.round(vol), 0, 15)); ni.push(cgClamp(idx, 0, 15));
    }
    for (let k = 0; k < L && s + k < F; k++) { T.nVol[s + k] = nv[k]; T.nIdx[s + k] = ni[k]; T.nMode[s + k] = k < nMetal ? 1 : 0; }
    if (cfg["echo"] > 0) {                     // the driver replays the shot quieter once it is done
      const D = L + Math.round(2 + 4 * cfg["echo"]), g = 0.25 + 0.25 * cfg["echo"];
      for (let k = 0; k < L && s + D + k < F; k++) { const f = s + D + k; T.nVol[f] = Math.max(T.nVol[f], Math.round(nv[k] * g)); T.nIdx[f] = Math.min(15, ni[k] + 1); T.nMode[f] = 0; }
    }
    // TRIANGLE kick: pitch rewritten per frame, length in quarter-frames (its linear counter)
    T.tri.fill(-1, s * 4);
    if (cfg["thump"] > 0) {
      const Q = Math.max(1, Math.round(cfg["thump"] * (12 + 24 * c) * lm)), TF = Math.ceil(Q / 4);
      const f0 = (170 - 100 * c) * (1 + sh.dPitch), f1 = 45 - 10 * c;
      for (let k = 0; k < TF; k++) {
        const f = f0 * Math.pow(f1 / f0, TF > 1 ? k / (TF - 1) : 0), t = Math.round(CG_CPU / (32 * f) - 1);
        for (let q = 0; q < 4; q++) { const qq = k * 4 + q; if (qq < Q && (s * 4 + qq) < F * 4) T.tri[s * 4 + qq] = t; }
      }
    }
    // PULSE pop (the snap's body: a 50 % pulse dropping fast through the sweep unit, two frames) on pulse 1,
    // ZAP (the blaster's "pew": a 12.5 % pulse falling through the sweep unit) on pulse 2, or rotating over both
    const zapCh = cfg["voices"] >= 2 ? (sh.k % 2 === 0 ? 1 : 0) : 1;
    if (snap > 0 && !(zap > 0 && zapCh === 0)) {
      clearPulse(0, s);
      let t = Math.round(CG_CPU / (16 * (1200 - 600 * c) * (1 + sh.dPitch)) - 1);
      for (let h = 0; h < 4 && s * 2 + h < F * 2; h++) {
        T.pPer[0][s * 2 + h] = t; T.pVol[0][s * 2 + h] = Math.round((h < 2 ? 12 : 6) * snap); T.pDuty[0][s * 2 + h] = 2;
        t += t >> 1;
      }
    }
    if (zap > 0) {
      clearPulse(zapCh, s);
      const ZL = Math.max(2, Math.round((7 + 12 * c) * lm));
      const fz = 1800 * Math.pow(2, -1.5 * c) * (1 + sh.dPitch), oct = 1 + 3 * cfg["sweep"];
      const sw = cg8SweepFor(Math.pow(2, oct / (2 * ZL))), shift = sw[0], per = sw[1];
      let t = Math.round(CG_CPU / (16 * fz) - 1);
      for (let h = 0; h < ZL * 2 && s * 2 + h < F * 2; h++) {
        if (t > 0x7ff) break;                            // the sweep unit mutes past the top of the period
        T.pPer[zapCh][s * 2 + h] = t; T.pVol[zapCh][s * 2 + h] = Math.round(15 * zap * sh.vScale * (1 - (h >> 1) / ZL)); T.pDuty[zapCh][s * 2 + h] = 0;
        if ((h + 1) % (per + 1) === 0) t += t >> shift;
      }
    }
  }
  return T;
}
// the chip: every channel's timer run in CPU cycles and box-averaged over each output sample, then the nonlinear mixer
function cg8Render(sr, n, T, lfsrSeed) {
  const out = new Float64Array(n), cyc = CG_CPU / sr, F = T.nVol.length;
  let lfsr = (lfsrSeed & 0x7fff) || 1, nTim = 1, triStep = 0, triTim = 1;
  const pSeq = [0, 0], pTim = [1, 1];
  for (let i = 0; i < n; i++) {
    const tt = i / sr, fr = Math.min(F - 1, Math.floor(tt * CG_FPS)), qf = Math.min(F * 4 - 1, Math.floor(tt * CG_FPS * 4)), hf = Math.min(F * 2 - 1, Math.floor(tt * CG_FPS * 2));
    // noise
    const nP = CG_NOISE_PER[T.nIdx[fr]], tap = T.nMode[fr] ? 6 : 1, nVol = T.nVol[fr];
    let rem = cyc, acc = 0;
    while (rem > 0) {
      const st = Math.min(rem, nTim);
      if (!(lfsr & 1)) acc += st;
      nTim -= st; rem -= st;
      if (nTim <= 1e-9) { const fb = (lfsr ^ (lfsr >> tap)) & 1; lfsr = (lfsr >> 1) | (fb << 14); nTim += nP; }
    }
    const nz = nVol * acc / cyc;
    // triangle (halted = holds its step)
    const tP = T.tri[qf];
    let tri;
    if (tP >= 2) {
      rem = cyc; acc = 0;
      while (rem > 0) { const st = Math.min(rem, triTim); acc += CG_TRI[triStep] * st; triTim -= st; rem -= st; if (triTim <= 1e-9) { triStep = (triStep + 1) & 31; triTim += tP + 1; } }
      tri = acc / cyc;
    } else tri = CG_TRI[triStep];
    // pulses (the timer is clocked at CPU / 2)
    let pSum = 0;
    for (let p = 0; p < 2; p++) {
      const pP = T.pPer[p][hf], v = T.pVol[p][hf];
      if (pP < 8 || pP > 0x7ff || v === 0) continue;
      const duty = CG_DUTY[T.pDuty[p][hf]], len = 2 * (pP + 1);
      rem = cyc; acc = 0;
      while (rem > 0) { const st = Math.min(rem, pTim[p]); acc += duty[pSeq[p]] * st; pTim[p] -= st; rem -= st; if (pTim[p] <= 1e-9) { pSeq[p] = (pSeq[p] + 7) & 7; pTim[p] += len; } }
      pSum += v * acc / cyc;
    }
    const pOut = pSum > 0 ? 95.88 / (8128 / pSum + 100) : 0;
    const tn = tri / 8227 + nz / 12241, tnOut = tn > 0 ? 159.79 / (1 / tn + 100) : 0;
    out[i] = pOut + tnOut;
  }
  cgHP(out, sr, 40); cgLP(out, sr, 14000);
  return out;
}

// FM CHIP (+ its noise chip). One operator's output: 10-bit phase, attenuation in 10-bit envelope units (0.094 dB) -> 14-bit signed
function cgOp(phase10, att10) {
  const q = phase10 & 255, idx = (phase10 & 256) ? 255 - q : q;
  const a = CG_LOGSIN[idx] + (Math.min(1023, att10) << 2);
  const mag = a >= 13 * 256 ? 0 : ((CG_EXP[~a & 255] | 0x400) << 2) >> (a >> 8);
  return (phase10 & 512) ? -mag : mag;
}
function cgFmTimeline(cfg, shots, F) {
  const nCh = Math.min(2, cfg["voices"]);
  const mkCh = () => ({ "kon": new Uint8Array(F), "on": new Uint8Array(F), "fc": new Float32Array(F), "rm": new Float32Array(F).fill(1),
    "tlm": new Uint8Array(F).fill(127), "tlc": new Uint8Array(F).fill(127), "fb": new Uint8Array(F), "dc": new Float32Array(F), "dm": new Float32Array(F) });
  const T = { "crunch": Array.from({ "length": nCh }, mkCh), "thump": Array.from({ "length": nCh }, mkCh), "zap": Array.from({ "length": nCh }, mkCh),
    "psgN": new Uint16Array(F).fill(1), "psgA": new Uint8Array(F).fill(15), "psgMode": new Uint8Array(F) };
  const c = cfg["cal"], snap = cfg["snap"], zap = cfg["zap"], noiseLvl = 1 - 0.85 * zap, lm = cfg["lenMul"];
  const tlOf = (g) => cgClamp(Math.round(-20 * Math.log10(Math.max(1e-4, g)) / 0.75), 0, 127);
  const clear = (ch, s) => { ch.kon.fill(0, s); ch.on.fill(0, s); };
  const write = (ch, f, o) => { if (f >= F) return; ch.on[f] = 1; ch.fc[f] = o.fc; ch.rm[f] = o.rm; ch.tlm[f] = o.tlm; ch.tlc[f] = o.tlc; ch.fb[f] = o.fb; ch.dc[f] = o.dc; ch.dm[f] = o.dm; };
  for (const sh of shots) {
    const s = sh.frame, v = sh.k % nCh;
    const L = Math.max(2, Math.round((6 + 26 * c) * lm * (1 - 0.55 * zap)));
    // crunch channel: op1 (feedback 7) -> op2; the carrier frequency stepped down per frame (the falling grit)
    const A = T.crunch[v]; clear(A, s); A.kon[s] = 1;
    const fA0 = (700 - 450 * c) * (1 + sh.dPitch), rm = 1 + 2.53 * cfg["metal"], tlA = tlOf(noiseLvl * sh.vScale);
    const crunchFr = (k, extraTl) => {
      const u = k / L, fc = fA0 * Math.pow(2, -cfg["sweep"] * 2.5 * Math.pow(u, 0.7)) * (k === 0 ? 1 + snap : 1);
      return { "fc": fc, "rm": rm, "tlm": k === 0 ? Math.round(4 * (1 - snap)) : Math.round(4 + 22 * u), "tlc": Math.min(127, tlA + extraTl), "fb": 7, "dc": 42 / (L / CG_FPS), "dm": 20 / (L / CG_FPS) };
    };
    for (let k = 0; k < L; k++) write(A, s + k, crunchFr(k, 0));
    // noise chip: shift rate from the third tone channel's N, attenuation in 2 dB steps
    T.psgA.fill(15, s);
    const N0 = Math.max(1, Math.round((1 + 7 * c) * (1 + sh.dIdx * 0.3))), nMetal = Math.round(cfg["metal"] * 3);
    const psgFr = (k) => {
      const u = k / L;
      if (k === 0) return [Math.max(1, Math.round(N0 * (1 - snap))), Math.round((1 - noiseLvl) * 4)];
      return [cgClamp(Math.round(N0 * Math.pow(2, cfg["sweep"] * 5 * Math.pow(u, 0.7))), 1, 1023), cgClamp(Math.round(u * 13 + (1 - noiseLvl) * 6 + (1 - sh.vScale) * 10), 0, 15)];
    };
    for (let k = 0; k < L && s + k < F; k++) { const na = psgFr(k); T.psgN[s + k] = na[0]; T.psgA[s + k] = na[1]; T.psgMode[s + k] = k < nMetal ? 1 : 0; }
    if (cfg["echo"] > 0) {                      // the driver replays it quieter, re-keying the same channel
      const D = L + Math.round(2 + 4 * cfg["echo"]), extra = Math.round(8 + 10 * (1 - cfg["echo"]));
      if (s + D < F) A.kon[s + D] = 1;
      for (let k = 0; k < L; k++) {
        write(A, s + D + k, crunchFr(k, extra));
        if (s + D + k < F) { const na = psgFr(k); T.psgN[s + D + k] = Math.min(1023, na[0] + 1); T.psgA[s + D + k] = Math.min(15, na[1] + 3); T.psgMode[s + D + k] = 0; }
      }
    }
    // thump channel: op3 (a knock on the first frame) -> op4 sine, pitch rewritten per frame
    const B = T.thump[v]; clear(B, s);
    if (cfg["thump"] > 0) {
      B.kon[s] = 1;
      const TF = Math.max(1, Math.round(cfg["thump"] * (4 + 8 * c) * lm)), f0 = (160 - 90 * c) * (1 + sh.dPitch), f1 = 42;
      for (let k = 0; k <= TF; k++) {
        const fc = f0 * Math.pow(f1 / f0, Math.min(1, k / TF));
        write(B, s + k, { "fc": fc, "rm": 1, "tlm": k === 0 ? 6 : 40, "tlc": tlOf(Math.min(1, 0.4 + 0.6 * cfg["thump"]) * sh.vScale), "fb": 0, "dc": 30 / (TF / CG_FPS), "dm": 120 });
      }
    }
    // zap channel: op5 (ratio 2, some feedback) -> op6, falling per frame, the index closing
    const Z = T.zap[v]; clear(Z, s);
    if (zap > 0) {
      Z.kon[s] = 1;
      const ZL = Math.max(2, Math.round((7 + 12 * c) * lm)), fz = 1800 * Math.pow(2, -1.5 * c) * (1 + sh.dPitch), oct = 1 + 3 * cfg["sweep"];
      for (let k = 0; k < ZL; k++) {
        const fc = fz * Math.pow(2, -oct * k / ZL);
        write(Z, s + k, { "fc": fc, "rm": 2, "tlm": Math.round(10 + 30 * k / ZL), "tlc": tlOf(zap * sh.vScale), "fb": 3 + Math.round(cfg["metal"] * 4), "dc": 24 / (ZL / CG_FPS), "dm": 0 });
      }
    }
  }
  return T;
}
function cgFmRender(sr, n, T, seed) {
  const nat = Math.ceil(n * CG_FM_RATE / sr) + 2, buf = new Float64Array(nat), F = T.psgN.length;
  const chans = [].concat(T.crunch, T.thump, T.zap).map((tl) => ({ "tl": tl, "pm": 0, "pc": 0, "am": 1023 * 0.09375, "ac": 1023 * 0.09375, "m1": 0, "m2": 0, "live": false, "lastFr": -1 }));
  let lfsr = 0x8000 | (seed & 0x7fff), psgPh = 0, prevMode = 0;
  for (let j = 0; j < nat; j++) {
    const fr = Math.min(F - 1, Math.floor(j / CG_FM_RATE * CG_FPS));
    let fm = 0;
    for (const ch of chans) {
      const tl = ch.tl;
      if (fr !== ch.lastFr) { ch.lastFr = fr; if (tl.kon[fr]) { ch.am = 0; ch.ac = 0; ch.pm = 0; ch.pc = 0; ch.m1 = 0; ch.m2 = 0; ch.live = true; } }
      if (!ch.live) { fm += 4; continue; }
      const on = tl.on[fr];
      ch.ac += (on ? tl.dc[fr] : CG_FM_RELEASE) / CG_FM_RATE; ch.am += (on ? tl.dm[fr] : CG_FM_RELEASE) / CG_FM_RATE;
      const ac = Math.floor(ch.ac / 0.09375), am = Math.floor(ch.am / 0.09375);
      if (ac >= 1023 && !on) { ch.live = false; fm += 4; continue; }
      const fc = tl.fc[fr], fb = tl.fb[fr];
      ch.pm += fc * tl.rm[fr] / CG_FM_RATE; ch.pm -= Math.floor(ch.pm);
      ch.pc += fc / CG_FM_RATE; ch.pc -= Math.floor(ch.pc);
      const fbIn = fb > 0 ? (ch.m1 + ch.m2) >> (10 - fb) : 0;
      const om = cgOp((Math.floor(ch.pm * 1024) + fbIn) & 1023, am + tl.tlm[fr] * 8);
      ch.m2 = ch.m1; ch.m1 = om;
      const oc = cgOp((Math.floor(ch.pc * 1024) + (om >> 1)) & 1023, ac + tl.tlc[fr] * 8);
      // the 9-bit DAC with its crossover step while the channel sounds
      const v9 = oc >> 5;
      fm += v9 + (v9 >= 0 ? 4 : -4);
    }
    // noise chip
    const N = T.psgN[fr], a = T.psgA[fr], mode = T.psgMode[fr];
    if (mode !== prevMode) { lfsr = 0x8000; prevMode = mode; }   // writing the noise register resets the shift register
    psgPh += CG_PSG_CLK / (32 * N) / CG_FM_RATE;
    while (psgPh >= 1) { psgPh -= 1; const fbit = mode ? (lfsr & 1) : ((lfsr ^ (lfsr >> 3)) & 1); lfsr = (lfsr >> 1) | (fbit << 15); }
    const psg = a >= 15 ? 0 : ((lfsr & 1) ? 1 : -1) * Math.pow(10, -2 * a / 20);
    buf[j] = fm / 512 + psg * 0.45;
  }
  // to 44.1 kHz by linear interpolation, no anti-alias filter (what folds, folds)
  const out = new Float64Array(n), step = CG_FM_RATE / sr;
  for (let i = 0; i < n; i++) { const p = i * step, k = Math.floor(p), f = p - k; out[i] = buf[k] + (buf[k + 1] - buf[k]) * f; }
  cgHP(out, sr, 20); cgLP(out, sr, 12000);
  return out;
}

// 16-BIT SAMPLER. The "recording": this engine's own clean synthesis of the gun, at the sampler's 32 kHz
function cgSource(cfg, seed) {
  const sr = CG_SMP_RATE, c = cfg["cal"], lm = cfg["lenMul"], zap = cfg["zap"], noiseLvl = 1 - 0.85 * zap, rnd = cgRng(seed ^ 0x51ed270b);
  const Tb = (0.04 + 0.2 * c) * lm * (1 - 0.5 * zap), len = Math.ceil(sr * Math.max(Tb * 2.2, zap > 0 ? (0.13 + 0.2 * c) * lm : 0, 0.05 + 0.25 * c * cfg["thump"]) + 0.01 * sr);
  const x = new Float64Array(len);
  const fb0 = 2000 - 1300 * c, tauB = Tb / 3, sweep = cfg["sweep"];
  let lp = 0, bp = 0, brown = 0, hpPrev = 0, hp = 0, boomPh = 0, zapPh = 0;
  const qD = 1 / 0.9;                                    // SVF damping (Q 0.9)
  for (let i = 0; i < len; i++) {
    const t = i / sr, w = rnd() * 2 - 1;
    // crack: the first 1.5 ms, high-passed noise
    hp = 0.97 * (hp + w - hpPrev); hpPrev = w;
    let v = t < 0.0015 ? hp * 1.4 * cfg["snap"] * (1 - t / 0.0015) : 0;
    // body: a band of noise whose center falls as it decays (the "pshhh")
    const fc = fb0 * Math.pow(2, -sweep * 2.2 * Math.min(1, t / Tb)), f = 2 * Math.sin(Math.PI * Math.min(fc, 0.2 * sr) / sr);
    lp += f * bp; const hpS = w - lp - qD * bp; bp += f * hpS;
    const envB = (t < 0.001 ? t / 0.001 : 1) * Math.exp(-t / tauB);
    brown = brown * 0.985 + w * 0.015;
    v += (bp * 2.2 + brown * 4 * Math.exp(-t / (tauB * 2))) * envB * noiseLvl;
    // boom
    if (cfg["thump"] > 0) { const ft = 45 + ((160 - 90 * c) - 45) * Math.exp(-t / 0.02); boomPh += ft / sr; v += Math.sin(2 * Math.PI * boomPh) * Math.exp(-t / (0.025 + 0.06 * c)) * 0.45 * cfg["thump"]; }
    // metal ring
    if (cfg["metal"] > 0) v += (Math.sin(2 * Math.PI * 3150 * t) + 0.7 * Math.sin(2 * Math.PI * 4480 * t) + 0.5 * Math.sin(2 * Math.PI * 5620 * t)) * Math.exp(-t / 0.03) * 0.25 * cfg["metal"];
    // zap: a falling chirp with its own second harmonic
    if (zap > 0) {
      const Zt = (0.13 + 0.2 * c) * lm, fz = 1800 * Math.pow(2, -1.5 * c) * Math.pow(2, -(1 + 3 * sweep) * Math.min(1, t / Zt));
      zapPh += fz / sr;
      if (t < Zt) v += (Math.sin(2 * Math.PI * zapPh) + 0.45 * Math.sin(4 * Math.PI * zapPh + 0.8 * Math.sin(2 * Math.PI * zapPh))) * (1 - t / Zt) * 0.8 * zap;
    }
    x[i] = v;
  }
  let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(x[i]));
  for (let i = 0; i < len; i++) x[i] *= 0.9 / (pk || 1);
  return x;
}
// BRR: 4-bit ADPCM, 16 samples a block, shift 0..12 and predictor 0..3 chosen per block. Returns the DECODED sample (ints).
function cgBrr(x) {
  const n = Math.ceil(x.length / 16) * 16, pcm = new Float64Array(n), out = new Int16Array(n);
  for (let i = 0; i < x.length; i++) pcm[i] = cgClamp(Math.round(x[i] * 16383), -16384, 16383);
  const pred = (f, p1, p2) => (f === 0 ? 0 : f === 1 ? p1 * 15 / 16 : f === 2 ? p1 * 61 / 32 - p2 * 15 / 16 : p1 * 115 / 64 - p2 * 13 / 16);
  let p1 = 0, p2 = 0;
  for (let b = 0; b < n; b += 16) {
    let best = null;
    for (let f = 0; f < 4; f++) for (let sh = 0; sh <= 12; sh++) {
      let a1 = p1, a2 = p2, err = 0; const dec = new Int16Array(16);
      for (let k = 0; k < 16; k++) {
        const pr = pred(f, a1, a2), nib = cgClamp(Math.round((pcm[b + k] - pr) * 2 / Math.pow(2, sh)), -8, 7);
        const y = cgClamp(Math.round(nib * Math.pow(2, sh) / 2 + pr), -16384, 16383);
        dec[k] = y; err += (y - pcm[b + k]) * (y - pcm[b + k]); a2 = a1; a1 = y;
        if (best && err >= best.err) break;
      }
      if (!best || err < best.err) best = { "err": err, "dec": dec };
    }
    out.set(best.dec, b); p1 = best.dec[15]; p2 = best.dec[14];
  }
  return out;
}
function cgSamplerRender(sr, n, cfg, shots, seed) {
  const src = cgSource(cfg, seed), cr = cfg["crunch"];
  const store = Math.round(CG_SMP_RATE * Math.pow(2, -2.5 * cr));
  // the cartridge's tool: decimate with a 2-tap average only (the rest folds), then BRR
  const ratio = CG_SMP_RATE / store, m = Math.floor(src.length / ratio), dec = new Float64Array(m);
  for (let i = 0; i < m; i++) { const p = i * ratio, k = Math.floor(p); dec[i] = (src[k] + (src[Math.min(src.length - 1, k + 1)] || 0)) / 2; }
  const smp = cgBrr(dec);
  const gauss = cr < 0.5, hold = cr >= 0.5;
  const basePitch = (store / CG_SMP_RATE) * Math.pow(2, -0.5 * cfg["cal"]);   // heavier: the same sample, played lower
  const nOut = Math.ceil(n * CG_SMP_RATE / sr) + 2, mix = new Float64Array(nOut);
  const voices = Array.from({ "length": cfg["voices"] }, () => ({ "on": false, "pos": 0, "step": 0, "vol": 0 }));
  const keyAt = shots.map((s) => Math.round(s.frame / CG_FPS * CG_SMP_RATE));
  let si = 0;
  for (let j = 0; j < nOut; j++) {
    while (si < shots.length && keyAt[si] === j) {
      const sh = shots[si], v = voices[sh.k % voices.length];
      // a new round keys its voice again: whatever that voice was playing is gone (the steal); other voices ring on
      Object.assign(v, { "on": true, "pos": 0, "step": basePitch * (1 + sh.dPitch), "vol": Math.round(127 * sh.vScale) / 127 });
      si++;
    }
    let s = 0;
    for (const v of voices) {
      if (!v.on) continue;
      const i0 = Math.floor(v.pos), f = v.pos - i0;
      if (i0 >= smp.length) { v.on = false; continue; }
      let y;
      if (gauss) {
        let ws = 0, acc = 0;
        for (let d = -1; d <= 2; d++) { const w = Math.exp(-((d - f) * (d - f)) / (2 * CG_GAUSS_SIGMA * CG_GAUSS_SIGMA)), k = i0 + d; ws += w; acc += w * (k >= 0 && k < smp.length ? smp[k] : 0); }
        y = acc / ws;
      } else y = smp[i0];
      s += Math.trunc(y * v.vol);
      v.pos += v.step;
    }
    mix[j] = cgClamp(s, -32768, 32767) / 16384;
  }
  // hardware echo: 16 ms steps, an 8-tap FIR low-pass on the way back, feedback
  if (cfg["echo"] > 0) {
    const D = (2 + Math.round(3 * cfg["echo"])) * 512, fbk = 0.25 + 0.3 * cfg["echo"], wet = 0.2 + 0.35 * cfg["echo"];
    const fir = [0.35, 0.25, 0.16, 0.1, 0.07, 0.04, 0.02, 0.01], eb = new Float64Array(D), hist = new Float64Array(8);
    let w = 0;
    for (let j = 0; j < nOut; j++) {
      for (let k = 7; k > 0; k--) hist[k] = hist[k - 1]; hist[0] = eb[w];
      let e = 0; for (let k = 0; k < 8; k++) e += fir[k] * hist[k];
      eb[w] = cgClamp(mix[j] + e * fbk, -2, 2); w = (w + 1) % D;
      mix[j] += e * wet;
    }
  }
  // to 44.1 kHz: held (the DAC's stairs, imaging) when crunched, else linear
  const out = new Float64Array(n), step = CG_SMP_RATE / sr;
  for (let i = 0; i < n; i++) { const p = i * step, k = Math.floor(p), f = p - k; out[i] = hold ? mix[k] : mix[k] + (mix[k + 1] - mix[k]) * f; }
  cgHP(out, sr, 20);
  return out;
}

// the wrong conversion: sample-and-hold at a fractional rate (folds), then a bit depth, after setting the peak to 0.9
function cgCrunch(x, sr, amount) {
  let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (pk > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.9 / pk;
  if (!(amount > 0)) return;
  const holdHz = sr * Math.pow(2, -3 * amount), bits = Math.round(16 - 11 * amount), lv = Math.pow(2, bits - 1), step = holdHz / sr;
  let ph = 1, h = 0;
  for (let i = 0; i < x.length; i++) { ph += step; if (ph >= 1) { ph -= 1; h = Math.round(x[i] * lv) / lv; } x[i] = h; }
}

// the whole take: n samples (the patch's Duration), seeded by the patch's `cgSeed`. Returns { L, R, info } UNLEVELLED
// (chipgunLevel does that, after its own Peak control), L and R the same mono buffer; info.shots are the rounds' times
// in seconds (on frames).
function makeChipgun(sr, n, cfg, seed) {
  n = Math.max(1, n);
  const F = Math.ceil(n / sr * CG_FPS) + 2;
  const shots = cgShots(cfg, seed, F), con = cfg["console"];
  const info = { "machine": CHIPGUN_MACHINES[con], "rate": cfg["rate"], "shots": shots.map((s) => s.frame / CG_FPS) };
  let mono;
  if (con === 0) { mono = cg8Render(sr, n, cg8Timeline(cfg, shots, F), (seed * 2654435761) >>> 17); cgCrunch(mono, sr, cfg["crunch"]); }
  else if (con === 1) { mono = cgFmRender(sr, n, cgFmTimeline(cfg, shots, F), (seed * 2654435761) >>> 17); cgCrunch(mono, sr, cfg["crunch"]); }
  else { mono = cgSamplerRender(sr, n, cfg, shots, seed); cgCrunch(mono, sr, 0); }
  // no click where the buffer ends
  const fo = Math.min(n, Math.floor(0.015 * sr)); for (let i = 0; i < fo; i++) mono[n - 1 - i] *= i / fo;
  return { "L": Float32Array.from(mono), "R": Float32Array.from(mono), "info": info };
}

// Peak control (0 = off, as the prototype's takes; up to 1 the app's limiter once, past 1 again: gunLevel's), then the
// prototype's own level, a preset's with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9. In place.
function chipgunLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = CG_RMS / Math.sqrt(best);
  if (pk * g > CG_PEAK) g = CG_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ── Gun foley (wave "gunfoley", #41) ──────────────────────────────────────────────────────────────────────────────
// Everything AROUND the shot that sells a gun in a game: reloads, a bolt worked, a pump racked, a revolver's cylinder
// spun, dry fire, casings landing, ricochets and bullets passing. These are exactly what a user layers after a gun-engine
// shot (AJ's rule: the gunshot presets carry NO after-sound). The old presets were layered impact-engine clicks, a modal
// ping repeated, a falling saw through an echo and the blast engine's downrange crack; none modeled what a gun's mechanism
// IS. Prototyped in tools/proto/gunfoley.mjs and picked by ear (AJ, 2026-11-13, soundtests/proto-gunfoley/); this block
// is that model, unchanged in its maths, with its knobs mapped from the patch by gunfoleyCfg.
//   PARTS      a slide, a barrel, a magazine, a catch, a bolt, a hammer, a cylinder: each a resonator bank (its modes from a
//              table of its shape, scaled by Weight) with two strike points, so repeated hits on one part are not clones.
//   CONTACT    two parts meeting: a half-sine force pulse whose length is the contact time (steel on steel ~40 us, bright;
//              a palm on a baseplate ~2.5 ms, a thump), box-integrated (8x), driving the part, and through the joint the
//              BODY (polymer: a dull tok; steel: it rings; wood and steel: the stock's hollow knock) and the weapon's
//              rigid-body THUMP; a crisp hit carries its own air click.
//   SLIDE      friction along a rail: Poisson asperity contacts (rate ~ speed) plus a rubbing noise, driving the sliding
//              part's own modes, the speed following a hand's profile (pull, push, even).
//   SPRING     a coil's dispersive "ting" / "sproing": falling chirps that lengthen every round trip, plus its own ring.
//   HANDS      fabric and skin on the weapon (Handling).
//   CASINGS    a brass tube (its ovaling modes in shimmering pairs) or a plastic hull falling from a height, bouncing with
//              the restitution of the surface (gaps 2 v' / g, shrinking), a tilted tube's second end, then rolling on a
//              hard floor; the surface sets the contact time and its own sound (concrete grit, wooden boards, dirt, a
//              steel deck's ring).
//   RICOCHET   the hit (stone chips, a steel plate's "pang", wood, dirt), then the tumbling slug's whistle heard through
//              the exact DOPPLER of its straight-line path (emission time solved per output sample), 1/r and air loss.
//   BULLET     supersonic: the Mach cone's N-wave (Whitham), a ground-reflected second one, the wake's hiss; subsonic: the
//              wake's whiz alone through the same Doppler.
// A SCRIPT of events with human timing (Tempo, jittered gaps) makes each Action. Every category (the parts, the body, the
// thump, clicks, rubs, springs, hands, case, floor, grit, flyby) is set to a target ENERGY relative to a reference, so each
// knob is a ratio. Built up front into a stereo buffer (each part's bank runs once over the stretch it sounds) and
// levelled once (gunfoleyLevel, after its own Peak control). The AMP ENVELOPE STAYS THE GAIN. Seeded by the patch's own
// `gfSeed` ("which take"; the prototype's take seed, its variation 0), never Math.random; not salted per layer, like
// enSeed. Anti-aliasing: every mode at or past 0.45 SR is dropped; force pulses, clicks and the N-wave are box-integrated.
// Actions, frames, surfaces, cases and loads are stored as indices: append-only.
const GF_ACTIONS = ["pistol reload", "rifle reload", "bolt cycle", "pump rack", "revolver spin", "dry fire", "casing", "ricochet", "bullet pass", "bolt reload"];
const GF_LOADS = ["thumbed in", "stripper clip", "single round"];
const GF_FRAMES = ["polymer", "steel", "wood and steel"];
const GF_SURFACES = ["concrete", "wood", "dirt", "metal"];
const GF_CASES = ["pistol brass", "rifle brass", "shotgun hull"];
const GUNFOLEY_DEFAULTS = { "gfAction": 0, "gfFrame": 0, "gfWeight": 0.4, "gfTempo": 0.5, "gfCrisp": 0.5, "gfSpring": 0.5,
  "gfHandling": 0.3, "gfRack": 0, "gfCock": 0, "gfMagDrop": 0, "gfCasing": 0, "gfCase": 0, "gfSurface": 0, "gfDrop": 0.6,
  "gfDist": 0.2, "gfSpeed": 0.75, "gfPast": 1, "gfLoad": 0, "gfRounds": 5, "gfPeak": 0, "gfSeed": 0 };
const GF_SEED_MIX = 0x9e3779b1;     // the prototype's seed mix (its variation 0), so gfSeed N renders its take N exactly
const GF_MIN_SPAN = 3.5;            // s, the script's working buffer at least (the prototype's)
const GF_RMS = 0.12;                // gunfoleyLevel: RMS over the loudest 300 ms ...
const GF_PEAK = 0.9;                // ... its peak capped here

// materials: eta = loss factor at 1 kHz, tilt: eta ~ (f / 1 kHz)^tilt. Parts are HELD and JOINTED, so steel is far
// lossier than a free bar (a free steel bar ~1e-4): 0.005 gives a slide's 3 kHz mode a ~0.1 s ring, a 7 kHz one 40 ms.
const GF_MAT = {
  "steel":   { "eta": 0.005,  "tilt": 0.25 },
  "frame":   { "eta": 0.009,  "tilt": 0.2 },    // a steel frame / receiver, bolted, in a hand
  "sheet":   { "eta": 0.003,  "tilt": 0.3 },    // a sheet-steel magazine box: tinny, rings
  "alu":     { "eta": 0.006,  "tilt": 0.25 },
  "polymer": { "eta": 0.05,   "tilt": 0.1 },
  "wood":    { "eta": 0.03,   "tilt": 0.2 },
  "brass":   { "eta": 0.0012, "tilt": 0.3 },
  "hull":    { "eta": 0.04,   "tilt": 0.15 },
  "deck":    { "eta": 0.002,  "tilt": 0.3 },    // a steel deck plate
  "floor":   { "eta": 0.06,   "tilt": 0.1 },    // wooden floorboards
  "soil":    { "eta": 0.5,    "tilt": 0 },
};
// part shapes: mode frequencies (Hz, at weight 0.5) and gains
const GF_SHAPES = {
  "slide":    { "f": [2300, 3700, 5200, 7400, 9800], "a": [1, 0.8, 0.6, 0.45, 0.3], "mat": "steel" },
  "barrel":   { "f": [3500, 6100, 9400], "a": [1, 0.6, 0.35], "mat": "steel" },
  "catch":    { "f": [4300, 7400, 11000], "a": [1, 0.6, 0.4], "mat": "steel" },
  "lever":    { "f": [3900, 6800, 10500], "a": [1, 0.6, 0.4], "mat": "steel" },
  "pmag":     { "f": [850, 1600, 2500, 3600], "a": [1, 0.7, 0.5, 0.3], "mat": "polymer" },
  "smag":     { "f": [1500, 2400, 3300, 4500, 6000, 7600], "a": [1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "sheet" },
  "rmag":     { "f": [1100, 1850, 2600, 3500, 4700, 6200], "a": [1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "sheet" },
  "carrier":  { "f": [1500, 2600, 4100, 6000, 8200], "a": [1, 0.8, 0.6, 0.45, 0.3], "mat": "steel" },
  "handle":   { "f": [1900, 4300, 7000], "a": [1, 0.6, 0.4], "mat": "alu" },
  "lockclick":{ "f": [4600, 8100, 11800], "a": [1, 0.6, 0.35], "mat": "steel" },
  "bolt":     { "f": [1650, 2950, 4550, 6400, 9000], "a": [1, 0.7, 0.6, 0.4, 0.3], "mat": "steel" },
  "knob":     { "f": [3600, 7200, 10800], "a": [1, 0.5, 0.3], "mat": "steel" },
  "cocking":  { "f": [4200, 7600, 11000], "a": [1, 0.6, 0.4], "mat": "steel" },
  "ejector":  { "f": [5800, 9800, 13500], "a": [1, 0.5, 0.3], "mat": "steel" },
  "pforend":  { "f": [380, 950, 1700, 2600], "a": [1, 0.7, 0.5, 0.3], "mat": "polymer" },
  "wforend":  { "f": [420, 1050, 1800, 2900], "a": [1, 0.7, 0.5, 0.3], "mat": "wood" },
  "magtube":  { "f": [1150, 3100, 5900, 9000], "a": [1, 0.8, 0.5, 0.3], "mat": "steel" },
  "pbolt":    { "f": [1600, 2900, 4600, 6600], "a": [1, 0.8, 0.6, 0.4], "mat": "steel" },
  "bars":     { "f": [2600, 5200, 8100], "a": [1, 0.6, 0.4], "mat": "steel" },
  "lifter":   { "f": [3300, 6200, 9100], "a": [1, 0.6, 0.4], "mat": "steel" },
  "cylinder": { "f": [1700, 3100, 4600, 6400, 8700], "a": [1, 0.8, 0.6, 0.45, 0.3], "mat": "steel" },
  "latch":    { "f": [3900, 7000, 10200], "a": [1, 0.6, 0.4], "mat": "steel" },
  "stop":     { "f": [5200, 8800, 12500], "a": [1, 0.6, 0.4], "mat": "steel" },
  "crane":    { "f": [2400, 4300, 6900], "a": [1, 0.6, 0.4], "mat": "steel" },
  "hammer":   { "f": [3200, 5900, 8800, 12000], "a": [1, 0.7, 0.45, 0.3], "mat": "steel" },
  "trigger":  { "f": [3000, 5500, 8600], "a": [1, 0.6, 0.35], "mat": "steel" },
  "ptrigger": { "f": [1300, 2700, 4400], "a": [1, 0.6, 0.35], "mat": "polymer" },
  "sear":     { "f": [6000, 9800, 13600], "a": [1, 0.5, 0.3], "mat": "steel" },
  "striker":  { "f": [3800, 6900, 10400], "a": [1, 0.6, 0.35], "mat": "steel" },
  "round":    { "f": [3300, 4900, 9100, 12800], "a": [1, 0.6, 0.5, 0.3], "mat": "brass" },     // a LOADED rifle round (held: damped)
  "lips":     { "f": [3300, 6100, 9200], "a": [1, 0.6, 0.4], "mat": "steel" },                 // the magazine's feed lips
  "follower": { "f": [1700, 3500, 5600], "a": [1, 0.6, 0.35], "mat": "steel" },
  "clip":     { "f": [2100, 3700, 5600, 7900, 10400], "a": [1, 0.9, 0.7, 0.5, 0.35], "mat": "sheet" },   // a stripper clip: sheet steel, tinny
};
// the bodies (frame index): [{f, a, mat}] lists at weight 0.5; plus the rigid-body thump (the whole weapon in a hand)
const GF_BODIES = [
  [{ "f": [260, 470, 760, 1150, 1700, 2400], "a": [1, 0.8, 0.6, 0.45, 0.3, 0.2], "mat": "polymer" }],
  [{ "f": [620, 1150, 1850, 2700, 3800, 5100], "a": [1, 0.8, 0.7, 0.55, 0.4, 0.3], "mat": "frame" }],
  [{ "f": [170, 330, 560, 880], "a": [1, 0.8, 0.6, 0.4], "mat": "wood" }, { "f": [700, 1300, 2100, 3100, 4300], "a": [0.8, 0.7, 0.6, 0.45, 0.3], "mat": "frame" }],
];
const GF_GRAV = 9.81;          // m/s^2: a falling case or magazine
const GF_C = 343;              // m/s: the speed of sound (the Doppler, the N-wave)
const GF_MAX_T60 = 3;          // s, the longest any ring is rendered

const gfClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function gfRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gfPanGains = (p) => { const a = (gfClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
const gfT60 = (m, f, mul) => Math.min(GF_MAX_T60, 2.2 / (m["eta"] * Math.pow(f / 1000, m["tilt"]) * f) * mul);

// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name). The
// prototype's "dur" and "seed" are not here: the app hands makeGunfoley its buffer length (the Duration) and its seed
// (the patch's own `gfSeed`) directly, as makeEnergy's.
function gunfoleyCfg(st) {
  const g = (k) => (st[k] == null ? GUNFOLEY_DEFAULTS[k] : st[k]);
  const crisp = gfClamp(g("gfCrisp"), 0, 1), w = gfClamp(g("gfWeight"), 0, 1);
  return {
    "width": st.width == null ? 0.5 : st.width,
    "action": gfClamp(Math.round(g("gfAction")), 0, GF_ACTIONS.length - 1),
    "frame": gfClamp(Math.round(g("gfFrame")), 0, GF_FRAMES.length - 1),
    "weight": w, "size": 1.25 - 0.5 * w,                                   // frequency scale: compact 1.25x .. heavy 0.75x
    "tScale": 1.35 - 0.7 * gfClamp(g("gfTempo"), 0, 1),
    "crisp": crisp,
    "tauMul": 1.6 * Math.pow(0.5 / 1.6, crisp),                          // contact times x1.6 (natural) .. x0.5 (game)
    "ringMul": 0.9 + 0.5 * crisp,                                        // the big hits ring a little longer in game foley
    "rub": 1.15 - 0.6 * crisp,                                           // slides and scrapes
    "thump": (0.3 + 0.7 * w) * (0.55 + 0.9 * crisp),                     // the weapon's rigid-body thump
    "jitter": 0.16 - 0.12 * crisp,                                       // human timing spread
    "spring": g("gfSpring") * (0.7 + 0.6 * crisp),
    "handling": g("gfHandling") * (1 - 0.7 * crisp),
    "rack": g("gfRack") >= 0.5, "cock": g("gfCock") >= 0.5,
    "magDrop": g("gfMagDrop"), "casing": g("gfCasing"),
    "caseType": gfClamp(Math.round(g("gfCase")), 0, GF_CASES.length - 1),
    "surface": gfClamp(Math.round(g("gfSurface")), 0, GF_SURFACES.length - 1),
    "dropH": 0.3 + 1.3 * g("gfDrop"),
    "dist": 0.5 * Math.pow(60, g("gfDist")),                             // 0.5 .. 30 m
    "speed": 220 + 730 * g("gfSpeed"),                                   // m/s
    "past": g("gfPast") >= 0.5,
    "load": gfClamp(Math.round(g("gfLoad")), 0, GF_LOADS.length - 1), "rounds": gfClamp(Math.round(g("gfRounds")), 1, 5),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// primitives (a render context G = { sr, n, rnd, cfg, parts, floors, info, body, thump, cat(k): a category's [L, R] })

// a part: a resonator bank with two strike points (each mode's gain differs between them)
function gfPart(G, name, shape, opt) {
  opt = opt || {};
  const sh = typeof shape === "string" ? GF_SHAPES[shape] : shape, M = GF_MAT[opt.mat || sh["mat"]], rnd = G.rnd;
  const sc = (opt.scale == null ? G.cfg["size"] : opt.scale), gain = opt.gain == null ? 1 : opt.gain;
  const modes = [];
  sh["f"].forEach((f0, k) => {
    const f = f0 * sc * (1 + 0.012 * (rnd() * 2 - 1));
    if (f >= 0.45 * G.sr) return;
    const a = sh["a"][k] * gain;
    const t60 = gfT60(M, f, opt.ringMul == null ? 1 : opt.ringMul);
    modes.push({ "f": f, "t60": t60, "g0": a * (0.4 + 0.6 * rnd()) * (rnd() < 0.5 ? -1 : 1), "g1": a * (0.4 + 0.6 * rnd()) * (rnd() < 0.5 ? -1 : 1) });
    if (opt.split) {   // a degenerate pair (a tube's ovaling mode): the twin a little higher, weaker
      const f2 = f * (1 + opt.split * (0.5 + rnd()));
      if (f2 < 0.45 * G.sr) modes.push({ "f": f2, "t60": t60 * 0.9, "g0": a * 0.5 * (0.4 + 0.6 * rnd()), "g1": -a * 0.5 * (0.4 + 0.6 * rnd()) });
    }
  });
  const p = { "name": name, "modes": modes, "pan": (opt.pan == null ? (rnd() * 2 - 1) * 0.25 : opt.pan) * G.cfg["width"], "x0": null, "x1": null, "damp": [], "energy": 0, "cat": opt.cat || "mech" };
  G.parts.push(p);
  return p;
}
// a half-sine force pulse of area J and length tau, box-integrated (8x) into the part's two strike points
function gfForceRaw(G, p, t, J, tau, pos) {
  if (!p.x0) { p.x0 = new Float32Array(G.n); p.x1 = new Float32Array(G.n); }
  const sr = G.sr; tau = Math.max(tau, 0.5 / sr);
  const OS = 8, i0 = Math.max(0, Math.floor(t * sr)), i1 = Math.min(G.n, Math.ceil((t + tau) * sr) + 1), pk = J * Math.PI / (2 * tau);
  const w0 = 1 - pos, w1 = pos;
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const u = (i + (k + 0.5) / OS) / sr - t; if (u >= 0 && u < tau) s += Math.sin(Math.PI * u / tau); }
    const v = pk * s / (OS * sr);
    p.x0[i] += v * w0; p.x1[i] += v * w1;
  }
}
// a contact on a part: the part rings, the body takes the same impulse through the joint (softened), and a crisp hit
// carries its own air click. J is the impulse (relative), tau the contact time BEFORE crispness.
function gfHit(G, p, t, J, tau, opt) {
  opt = opt || {};
  const c = G.cfg, rnd = G.rnd, tt = tau * c["tauMul"];
  gfForceRaw(G, p, t, J, tt, rnd());
  const couple = opt.couple == null ? 0.6 : opt.couple;
  if (couple > 0 && G.body) for (const b of G.body) gfForceRaw(G, b, t + 0.0002, J * couple, tt + 0.00025 + 0.0004 * (1 - c["crisp"]), rnd());
  if (couple > 0 && G.thump && J * couple > 0.2) gfForceRaw(G, G.thump, t + 0.0003, J * couple * c["thump"], 0.0015 + tt, 0.5);
  if (opt.click !== 0) gfClick(G, t, J * (opt.click == null ? 0.05 : opt.click) * (0.5 + c["crisp"]), Math.max(tt, 1.2 / G.sr), p.pan);
  if (G.info) G.info.events.push([Math.round(t * 1000), opt.name || p.name]);
}
// after time t the part's rings decay faster (it came to rest on something, a hand closed on it)
function gfDamp(p, t, mul) { p.damp.push([t, mul]); p.damp.sort((a, b) => a[0] - b[0]); }
// the direct air click of a contact: the derivative of a half-sine force (glass.mjs glClick)
function gfClick(G, t0, amp, tau, pan, cat) {
  const [L, R] = G.cat(cat || "click"), sr = G.sr; tau = Math.max(tau, 1.5 / sr);
  const OS = 8, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(G.n, Math.ceil((t0 + tau) * sr) + 1);
  const [gl, gr] = gfPanGains(pan);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const u = (i + (k + 0.5) / OS) / sr - t0; if (u >= 0 && u < tau) s += Math.cos(Math.PI * u / tau); }
    const v = amp * s / OS; L[i] += v * gl; R[i] += v * gr;
  }
}
// band-limited noise state: a one-pole HP at lo into a one-pole LP at hi (glass.mjs glNoise's filter)
function gfBand(sr, lo, hi) { return { "aH": Math.exp(-2 * Math.PI * Math.min(lo, 0.45 * sr) / sr), "aL": Math.exp(-2 * Math.PI * Math.min(hi, 0.45 * sr) / sr), "h": 0, "l": 0, "l2": 0 }; }
function gfBandTick(b, x) { b.h = x + (b.h - x) * b.aH; const hp = x - b.h; b.l = hp + (b.l - hp) * b.aL; b.l2 = b.l + (b.l2 - b.l) * b.aL; return b.l2; }
// a hand's speed profile over u in [0, 1]: "pull" accelerates and stops at the end stop, "push" is spring-driven (fast,
// accelerating to the stop), "even" a free slide
function gfProfile(kind, u) {
  if (kind === "push") return Math.pow(u, 0.6) * (u < 0.92 ? 1 : (1 - u) / 0.08 * 0.5 + 0.5);
  if (kind === "even") return Math.sin(Math.PI * u) * 0.5 + 0.5 * Math.min(1, u * 8) * Math.min(1, (1 - u) * 8);
  return Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.075)), 0.8);   // pull
}
// SLIDE: part p dragged for dur s from t0 at relative force level J; micro-impacts + rub drive p's modes (and a little
// of the body), with the rub's direct hiss in [lo, hi]
function gfSlide(G, p, t0, dur, J, opt) {
  opt = opt || {};
  const sr = G.sr, rnd = G.rnd, c = G.cfg, i0 = Math.max(0, Math.floor(t0 * sr)), len = Math.min(G.n - i0, Math.ceil(dur * sr));
  if (len <= 0) return;
  if (!p.x0) { p.x0 = new Float32Array(G.n); p.x1 = new Float32Array(G.n); }
  const lvl = J * c["rub"], rough = opt.rough == null ? 0.5 : opt.rough, kind = opt.prof || "pull";
  const rate = (opt.rate || 2500) * (0.4 + rough);          // asperity contacts per second at full speed
  const bEx = gfBand(sr, opt.exLo || 600, opt.exHi || 12000), bD = gfBand(sr, opt.lo || 1500, opt.hi || 9000);
  const [gl, gr] = gfPanGains(p.pan), hiss = (opt.hiss == null ? 0.25 : opt.hiss) * lvl, b = G.body ? G.body[G.body.length - 1] : null;
  const bc = opt.couple == null ? 0.15 : opt.couple, [DL, DR] = G.cat("rub");
  let pos = rnd(), nextGrain = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len, v = gfProfile(kind, u), fade = Math.min(1, k / (0.003 * sr), (len - k) / (0.002 * sr));
    const x = gfBandTick(bEx, rnd() * 2 - 1) * v * lvl * 0.004 * fade;
    pos += (rnd() - 0.5) * 0.02; pos = gfClamp(pos, 0, 1);
    p.x0[i0 + k] += x * (1 - pos); p.x1[i0 + k] += x * pos;
    if (b && bc > 0) { if (!b.x0) { b.x0 = new Float32Array(G.n); b.x1 = new Float32Array(G.n); } b.x0[i0 + k] += x * bc; }
    // asperities: Poisson, rate ~ speed
    nextGrain -= v * rate / sr;
    if (nextGrain <= 0) {
      nextGrain = -Math.log(Math.max(1e-9, rnd()));
      const a = lvl * 0.02 * (0.2 + Math.pow(rnd(), 3) * 1.6) * v;
      if (rnd() < 0.5) p.x0[i0 + k] += a; else p.x1[i0 + k] += a;
    }
    const d = gfBandTick(bD, rnd() * 2 - 1) * v * hiss * fade;
    DL[i0 + k] += d * gl; DR[i0 + k] += d * gr;
  }
  if (G.info) G.info.events.push([Math.round(t0 * 1000), (opt.name || p.name) + " slides " + Math.round(dur * 1000) + " ms"]);
}
// SPRING: a coil released or compressed. A dispersive pulse on the coil (each echo a falling chirp fHi -> f1 that grows
// longer with every round trip, the spring engine's coil) plus the coil's own short ring; `period` is the round trip.
function gfSpring(G, t0, amp, opt) {
  if (!(amp > 0)) return;
  opt = opt || {};
  const sr = G.sr, rnd = G.rnd, [L, R] = G.cat("spring");
  const f1 = (opt.f1 || 2200) * (0.95 + 0.1 * rnd()), fHi = Math.min(0.42 * sr, f1 * (opt.span || 4)), period = opt.period || 0.006;
  const nE = opt.echoes || 8, dec = opt.decay || 0.72, disp = opt.disp || 0.0015;
  const [gl, gr] = gfPanGains(opt.pan == null ? 0 : opt.pan);
  for (let e = 0; e < nE; e++) {
    const te = t0 + e * period * (1 + 0.04 * (rnd() - 0.5)), clen = disp * (1 + e * 0.8), ae = amp * Math.pow(dec, e) / Math.sqrt(1 + e * 0.8);
    const i0 = Math.floor(te * sr), nl = Math.ceil(clen * sr);
    let ph = rnd() * 6.283;
    for (let k = 0; k < nl && i0 + k < G.n; k++) {
      if (i0 + k < 0) continue;
      const u = k / nl, f = fHi * Math.pow(f1 / fHi, u), env = Math.sin(Math.PI * u);
      ph += 2 * Math.PI * f / sr;
      const v = ae * env * Math.sin(ph); L[i0 + k] += v * gl; R[i0 + k] += v * gr;
    }
  }
  // the coil's own ring: a few stretched partials, buzzing at the round trip
  const ring = opt.ring == null ? 0.5 : opt.ring, rl = opt.ringLen || 0.12;
  if (ring > 0) {
    const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(G.n - i0, Math.ceil(rl * 2.2 * sr)), fb = 1 / period;
    const parts = [1, 2.15, 3.4].map((q, k) => ({ "f": f1 * 0.6 * q * (1 + 0.01 * rnd()), "a": 1 / (k + 1), "ph": rnd() * 6.283 }));
    for (let k = 0; k < n; k++) {
      const t = k / sr, env = Math.exp(-6.9 * t / rl) * Math.min(1, k / (0.001 * sr)), buzz = 0.6 + 0.4 * Math.cos(2 * Math.PI * fb * t);
      let s = 0; for (const q of parts) { if (q.f < 0.45 * sr) s += q.a * Math.sin(q.ph + 2 * Math.PI * q.f * t); }
      const v = amp * ring * 0.5 * env * buzz * s; L[i0 + k] += v * gl; R[i0 + k] += v * gr;
    }
  }
  if (G.info) G.info.events.push([Math.round(t0 * 1000), (opt.name || "spring")]);
}
// HANDS: a grip or a palm on the weapon (fabric and skin), soft broadband rustle with a few skin ticks
function gfHands(G, t0, len, amp) {
  if (!(amp > 0)) return;
  const sr = G.sr, rnd = G.rnd, i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(G.n - i0, Math.ceil(len * sr));
  const b = gfBand(sr, 250, 3500), [gl, gr] = gfPanGains((rnd() * 2 - 1) * 0.3 * G.cfg["width"]), [HL, HR] = G.cat("hands");
  let g = 0, tgt = 0;
  for (let k = 0; k < n; k++) {
    if (k % 256 === 0) tgt = Math.pow(rnd(), 2);
    g += (tgt - g) * 0.004;
    const u = k / n, env = Math.sin(Math.PI * u), v = gfBandTick(b, rnd() * 2 - 1) * amp * 0.25 * env * (0.3 + g);
    HL[i0 + k] += v * gl; HR[i0 + k] += v * gr;
  }
}
// a band noise burst with an exponential decay (grit, dust, splinters)
function gfBurst(G, t0, len, tau, amp, lo, hi, pan) {
  const [BL, BR] = G.cat("grit"), sr = G.sr, rnd = G.rnd, i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(G.n - i0, Math.ceil(len * sr));
  if (n <= 0) return;
  const b = gfBand(sr, lo, hi), [gl, gr] = gfPanGains(pan), d = Math.exp(-1 / (tau * sr));
  let e = amp;
  for (let k = 0; k < n; k++) { const v = gfBandTick(b, rnd() * 2 - 1) * e * Math.min(1, k / 12); BL[i0 + k] += v * gl; BR[i0 + k] += v * gr; e *= d; }
}
// run every part's resonator bank over the stretch where it is excited (plus its ring), into G's stereo mix
function gfRunParts(G) {
  const sr = G.sr, n = G.n;
  for (const p of G.parts) {
    if (!p.x0) continue;
    const [L, R] = G.cat(p.cat);
    let a = -1, b = -1;
    for (let i = 0; i < n; i++) if (p.x0[i] !== 0 || p.x1[i] !== 0) { a = i; break; }
    if (a < 0) continue;
    for (let i = n - 1; i >= a; i--) if (p.x0[i] !== 0 || p.x1[i] !== 0) { b = i; break; }
    const [gl, gr] = gfPanGains(p.pan);
    let e = 0;
    for (const m of p.modes) {
      const life = Math.ceil(Math.min(GF_MAX_T60, m.t60) * sr), end = Math.min(n, b + life + 1);
      const w = 2 * Math.PI * m.f / sr, cw = Math.cos(w), sw = Math.sin(w);
      // damping segments: [index, t60 multiplier]
      const segs = [[a, 1]];
      for (const [t, mul] of p.damp) { const i = Math.round(t * sr); if (i > a && i < end) segs.push([i, mul]); }
      let zr = 0, zi = 0;
      for (let s = 0; s < segs.length; s++) {
        const i0 = segs[s][0], i1 = s + 1 < segs.length ? segs[s + 1][0] : end;
        const r = Math.exp(-6.907755 / (Math.max(0.002, m.t60 * segs[s][1]) * sr)), c = cw * r, si = sw * r;
        for (let i = i0; i < i1; i++) {
          const nr = zr * c - zi * si + m.g0 * p.x0[i] + m.g1 * p.x1[i]; zi = zr * si + zi * c; zr = nr;
          L[i] += zi * gl; R[i] += zi * gr; e += zi * zi;
        }
      }
    }
    p.energy = e / sr;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// casings and surfaces

// the floor a thing lands on: a part (its modes) plus its contact time, restitution and grit
const GF_FLOORS = [
  { "tau": 0.00003, "e": 0.45, "roll": 1,   "grit": 0.5, "part": null,                                                                                           "name": "concrete" },
  { "tau": 0.00025, "e": 0.35, "roll": 0.6, "grit": 0.1, "part": { "f": [180, 340, 610, 1050, 1600], "a": [1, 0.8, 0.6, 0.4, 0.25], "mat": "floor" },          "name": "wood" },
  { "tau": 0.0015,  "e": 0.07, "roll": 0,   "grit": 1,   "part": { "f": [90, 160, 250], "a": [1, 0.6, 0.3], "mat": "soil" },                                    "name": "dirt" },
  { "tau": 0.00002, "e": 0.55, "roll": 1.2, "grit": 0.1, "part": { "f": [310, 760, 1290, 1980, 2850, 3900, 5200, 6800], "a": [0.7, 0.9, 1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "deck" }, "name": "metal" },
];
// the case's modes (Hz): the open end's ovaling pair (n = 2), the shoulder / head, n = 3
const GF_CASE_SHAPES = [
  { "f": [5500, 8300, 15500], "a": [1, 0.35, 0.45], "mat": "brass", "split": 0.004, "e": 1,   "mass": 0.45, "name": "pistol case" },
  { "f": [3900, 5600, 11000, 15200], "a": [1, 0.55, 0.5, 0.3], "mat": "brass", "split": 0.003, "e": 0.95, "mass": 0.8, "name": "rifle case" },
  { "f": [1250, 2600, 4100], "a": [1, 0.6, 0.35], "mat": "hull", "split": 0, "e": 0.6, "mass": 1, "name": "shotgun hull", "head": { "f": [6200, 9800], "a": [1, 0.5], "mat": "brass" } },
];
// a case lands at tLand with impact speed vImp: bounces with shrinking gaps, a tilted tube's second end, then rolls (hard
// floors) or stops dead (dirt). `lvl` scales it. Returns the time it comes to rest.
function gfCaseDrop(G, tLand, ci, si, vImp, lvl, pan) {
  const rnd = G.rnd, F = GF_FLOORS[si], C = GF_CASE_SHAPES[ci], sr = G.sr;
  const cs = gfPart(G, C["name"], C, { "scale": 0.96 + 0.08 * rnd(), "split": C["split"], pan, "gain": lvl, "cat": "case" });
  const head = C["head"] ? gfPart(G, "hull head", C["head"], { "scale": 1, "pan": pan, "gain": lvl * 0.4, "cat": "case" }) : null;
  let fl = F["part"] ? (G.floors[si] || (G.floors[si] = gfPart(G, F["name"] + " floor", F["part"], { "scale": 1, "pan": pan * 0.6, "gain": 1, "cat": "floor" }))) : null;
  let t = tLand, v = vImp, last = t;
  const jit = (x) => x * (0.75 + 0.5 * rnd());
  for (let k = 0; k < 14 && t < G.n / sr - 0.03; k++) {
    const amp = lvl * Math.min(1.4, v / 4) * (0.7 + 0.3 * rnd());
    const tau = F["tau"] * (0.8 + 0.4 * rnd()) * (C["mat"] === "hull" ? 3 : 1);
    gfForceRaw(G, cs, t, amp, tau, rnd());
    if (head) gfForceRaw(G, head, t + 0.0003 * rnd(), amp * 0.6, tau, rnd());
    if (fl) gfForceRaw(G, fl, t, amp * C["mass"] * (si === 2 ? 2.5 : 1), tau * 2 + 0.0002, rnd());
    if (C["mat"] !== "hull") gfClick(G, t, amp * 0.03 * (si === 2 ? 0.3 : 1), Math.max(tau, 1.5 / sr), pan, "case");
    if (F["grit"] > 0) gfBurst(G, t, 0.03 + 0.05 * (si === 2 ? 1 : 0), si === 2 ? 0.012 : 0.003, amp * F["grit"] * (si === 2 ? 0.05 : 0.025), si === 2 ? 900 : 2500, si === 2 ? 6000 : 12000, pan);
    // a tilted tube: the other end lands a few ms later
    if (k < 6 && rnd() < 0.75 && si !== 2) {
      const dt = 0.003 + 0.016 * rnd(), a2 = amp * (0.25 + 0.55 * rnd());
      gfForceRaw(G, cs, t + dt, a2, tau, rnd());
      if (fl) gfForceRaw(G, fl, t + dt, a2 * C["mass"], tau * 2 + 0.0002, rnd());
    }
    if (G.info) G.info.landings.push(Math.round(t * 1000));
    last = t;
    const e = gfClamp(F["e"] * C["e"] * (0.55 + 0.9 * rnd()), 0.02, 0.85), vn = e * v;
    if (vn < 0.12) break;
    t += 2 * vn / GF_GRAV; v = vn;
  }
  // rolling (a tube on a hard floor): tiny contacts over grit and seams, quickening then slowing
  if (F["roll"] > 0 && C["mat"] !== "hull" || (F["roll"] > 0 && C["mat"] === "hull" && rnd() < 0.5)) {
    const rollLen = jit(0.25 + 0.5 * F["roll"]) * (C["mat"] === "hull" ? 0.5 : 1);
    let tr = last + 0.02 + 0.03 * rnd(), rate = 35 + 30 * rnd();
    const tEnd = Math.min(G.n / sr - 0.03, last + rollLen);
    while (tr < tEnd) {
      const u = (tr - last) / rollLen, a = lvl * 0.05 * (1 - u) * (0.3 + 0.7 * Math.pow(rnd(), 2));
      gfForceRaw(G, cs, tr, a, F["tau"] * 2, rnd());
      if (F["grit"] > 0) gfBurst(G, tr, 0.004, 0.001, a * F["grit"] * 0.1, 3000, 12000, pan);
      tr += 1 / (rate * (1 - 0.7 * u)) * (0.5 + rnd());
    }
    last = tEnd;
  }
  gfDamp(cs, last + 0.01, 0.12);   // at rest: the floor takes the ring
  if (si === 2) gfDamp(cs, tLand + 0.003, 0.2);   // dirt: embedded at the first landing
  return last;
}

// ---------------------------------------------------------------------------------------------------------------------
// flyby geometry: a source on a straight line (closest point at distance dmin, passing it at time 0 with speed v(t) =
// v0 / (1 + k t), t from tStart), the listener at the origin. For each OUTPUT sample, the emission time te solving
// te + r(te) / c = ta (subsonic, so monotonic), the distance r and the Doppler factor dte/dta. Output starts at ta0.
// `stop(te)`, when given, ends the solve after the first sample it is true for (`len` samples solved): the PORT's bound.
// The prototype solved the whole 3.5 s buffer although its callers stop reading at a known emission time (a ricochet's
// whistle dies at `life`, a subsonic pass is heard only within 40 m); te rises with every sample, so nothing past that
// sample is ever read, and every sample before it is solved exactly as before (the solve is sequential: each starts from
// the last), which keeps the picks sample-identical while a whiz costs a fraction of what it did.
function gfFlyby(sr, n, ta0, o, stop) {
  const v0 = o.v0, k = o.k || 0, dmin = o.dmin, xs = o.x0;   // along-track position at te = 0 (negative: still coming)
  const sOf = (te) => (k > 0 ? v0 / k * Math.log(1 + k * te) : v0 * te), vOf = (te) => v0 / (1 + k * te);
  const te = new Float64Array(n), r = new Float64Array(n), dop = new Float64Array(n);
  let t = 0, len = n;
  for (let i = 0; i < n; i++) {
    const ta = ta0 + i / sr;
    for (let it = 0; it < 4; it++) {
      const x = xs + sOf(Math.max(0, t)), rr = Math.sqrt(x * x + dmin * dmin), f = t + rr / GF_C - ta;
      const dr = t > 0 ? x / rr * vOf(t) : 0, d = 1 + dr / GF_C;
      t -= f / d;
    }
    const x = xs + sOf(Math.max(0, t)), rr = Math.sqrt(x * x + dmin * dmin);
    te[i] = t; r[i] = rr; dop[i] = 1 / (1 + (x / rr) * vOf(Math.max(0, t)) / GF_C);
    if (stop && stop(t)) { len = i + 1; break; }
  }
  return { "te": te, "r": r, "dop": dop, "vOf": vOf, "sOf": sOf, "len": len };
}

// ---------------------------------------------------------------------------------------------------------------------
// the actions

const GF_SCRIPTS = {};
// a gap in the script: base seconds x tempo, jittered by human timing
const gfGap = (G, base) => base * G.cfg["tScale"] * (1 + G.cfg["jitter"] * (G.rnd() * 2 - 1));
const GF_STEEL_TAU = 0.00004;   // steel on steel contact (Hertz, gram-scale parts at a few m/s)

GF_SCRIPTS["pistol reload"] = (G) => {
  const c = G.cfg, poly = c["frame"] === 0;
  const slide = gfPart(G, "slide", "slide", { "gain": 0.8, "ringMul": c["ringMul"] }), barrel = gfPart(G, "barrel", "barrel", { "gain": 0.5 });
  const mag = gfPart(G, "magazine", poly ? "pmag" : "smag", { "gain": poly ? 0.9 : 0.7 }), cat = gfPart(G, "mag catch", "catch", { "gain": 0.35 });
  const lever = gfPart(G, "slide stop", "lever", { "gain": 0.4 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.12, c["handling"] * 0.5);
  gfHit(G, cat, t, 0.12, GF_STEEL_TAU, { "name": "mag release", "couple": 0.4 });
  gfSlide(G, mag, t + 0.008, 0.065 * c["tScale"], 0.25, { "rough": poly ? 0.25 : 0.6, "prof": "push", "lo": poly ? 700 : 1500, "hi": poly ? 5000 : 9000, "hiss": 0.15, "name": "mag out" });
  if (c["magDrop"] > 0) {   // the empty magazine falls ~1 m and lands
    const tl = t + 0.008 + 0.45, fl = GF_FLOORS[c["surface"]];
    const box = gfPart(G, "dropped magazine", poly ? "pmag" : "smag", { "gain": c["magDrop"] * 0.6, "pan": -0.4 });
    let tt = tl, v = 4.4;
    for (let k = 0; k < 3 && v > 0.3; k++) { gfForceRaw(G, box, tt, v / 4.4, Math.max(fl["tau"], 0.0001) * (poly ? 4 : 1.5), G.rnd()); gfClick(G, tt, 0.02 * v / 4.4 * c["magDrop"], 0.0002, -0.4); G.info.events.push([Math.round(tt * 1000), "mag lands"]); const e = fl["e"] * (poly ? 0.6 : 0.8) * (0.6 + 0.8 * G.rnd()); v *= e; tt += 2 * v / GF_GRAV; }
    if (fl["grit"] > 0) gfBurst(G, tl, 0.04, 0.008, 0.02 * c["magDrop"] * fl["grit"], 1500, 9000, -0.4);
    gfDamp(box, tt + 0.02, 0.2);
  }
  t += gfGap(G, 0.42);
  gfHands(G, t - 0.06, 0.12, c["handling"]);
  gfSlide(G, mag, t, 0.055 * c["tScale"], 0.3, { "rough": poly ? 0.25 : 0.6, "prof": "pull", "lo": poly ? 700 : 1500, "hi": poly ? 5000 : 9000, "hiss": 0.15, "name": "mag in" });
  t += 0.06 * c["tScale"];
  gfHit(G, mag, t, 0.25, 0.0025, { "name": "palm on the baseplate", "couple": 0.9, "click": 0 });
  gfHit(G, mag, t + 0.0015, 0.6, poly ? 0.0003 : 0.00008, { "name": "mag bottoms in the well", "couple": 0.6 });
  gfHit(G, cat, t + 0.004, 0.35, GF_STEEL_TAU, { "name": "catch snaps", "couple": 0.3 });
  gfSpring(G, t + 0.002, 0.02 * c["spring"], { "f1": 2600, "period": 0.0011, "echoes": 6, "decay": 0.6, "disp": 0.0006, "ring": 0.3, "ringLen": 0.04, "name": "mag spring" });
  if (c["rack"]) {
    t += gfGap(G, 0.3);
    gfHands(G, t - 0.03, 0.08, c["handling"] * 0.7);
    const pull = 0.075 * c["tScale"];
    gfSlide(G, slide, t, pull, 0.35, { "rough": 0.55, "prof": "pull", "name": "slide back" });
    gfSpring(G, t, 0.012 * c["spring"], { "f1": 1800, "period": 0.004, "echoes": 6, "disp": 0.002, "ring": 0.2, "name": "recoil spring compresses" });
    t += pull;
    gfHit(G, slide, t, 0.5, GF_STEEL_TAU, { "name": "slide hits the stop", "couple": 0.6 });
    t += gfGap(G, 0.05);
    gfSlide(G, slide, t, 0.024, 0.3, { "rough": 0.55, "prof": "push", "name": "slide forward" });
    gfSlide(G, mag, t + 0.006, 0.012, 0.15, { "rough": 0.6, "prof": "even", "hiss": 0.05, "name": "round strips" });
    gfSpring(G, t, 0.03 * c["spring"], { "f1": 2000, "period": 0.0035, "echoes": 8, "disp": 0.0015, "ring": 0.5, "ringLen": 0.09, "name": "recoil spring releases" });
    t += 0.025;
  } else {
    t += gfGap(G, 0.24);
    gfHands(G, t - 0.02, 0.05, c["handling"] * 0.5);
    gfHit(G, lever, t, 0.22, GF_STEEL_TAU, { "name": "slide release", "couple": 0.3 });
    gfSlide(G, slide, t + 0.002, 0.022, 0.3, { "rough": 0.55, "prof": "push", "name": "slide forward" });
    gfSlide(G, mag, t + 0.008, 0.012, 0.15, { "rough": 0.6, "prof": "even", "hiss": 0.05, "name": "round strips" });
    gfSpring(G, t + 0.002, 0.03 * c["spring"], { "f1": 2000, "period": 0.0035, "echoes": 8, "disp": 0.0015, "ring": 0.5, "ringLen": 0.09, "name": "recoil spring releases" });
    t += 0.024;
  }
  gfHit(G, slide, t, 1.0, GF_STEEL_TAU, { "name": "slide slams into battery", "couple": 0.9 });
  gfHit(G, barrel, t + 0.003, 0.45, GF_STEEL_TAU, { "name": "barrel locks", "couple": 0.3 });
  return t + 0.35;
};

GF_SCRIPTS["rifle reload"] = (G) => {
  const c = G.cfg, poly = c["frame"] === 0;
  const mag = gfPart(G, "magazine", poly ? "pmag" : "rmag", { "gain": poly ? 0.9 : 0.8, "scale": c["size"] * (poly ? 0.85 : 1) });
  const cat = gfPart(G, "mag catch", "catch", { "gain": 0.35 }), car = gfPart(G, "bolt carrier", "carrier", { "gain": 0.9, "ringMul": c["ringMul"] });
  const hdl = gfPart(G, "charging handle", "handle", { "gain": 0.5 }), lk = gfPart(G, "bolt lock", "lockclick", { "gain": 0.4 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.12, c["handling"] * 0.5);
  gfHit(G, cat, t, 0.15, GF_STEEL_TAU, { "name": "mag release", "couple": 0.4 });
  gfSlide(G, mag, t + 0.006, 0.085 * c["tScale"], 0.3, { "rough": 0.7, "prof": "push", "lo": 1200, "hi": 8000, "hiss": 0.2, "name": "mag out" });
  t += gfGap(G, 0.5);
  gfHands(G, t - 0.08, 0.14, c["handling"]);
  gfSlide(G, mag, t, 0.07 * c["tScale"], 0.35, { "rough": 0.7, "prof": "pull", "lo": 1200, "hi": 8000, "hiss": 0.2, "name": "mag in" });
  t += 0.075 * c["tScale"];
  gfHit(G, mag, t, 0.3, 0.003, { "name": "palm on the baseplate", "couple": 1, "click": 0 });
  gfHit(G, mag, t + 0.002, 0.7, poly ? 0.0003 : 0.00008, { "name": "mag bottoms in the well", "couple": 0.6 });
  gfHit(G, cat, t + 0.005, 0.4, GF_STEEL_TAU, { "name": "catch snaps", "couple": 0.3 });
  gfSpring(G, t + 0.003, 0.025 * c["spring"], { "f1": 2200, "period": 0.0014, "echoes": 7, "decay": 0.62, "disp": 0.0007, "ring": 0.35, "ringLen": 0.05, "name": "mag spring" });
  t += gfGap(G, 0.32);
  gfHands(G, t - 0.03, 0.08, c["handling"] * 0.7);
  gfHit(G, hdl, t, 0.2, GF_STEEL_TAU, { "name": "charging handle unlatches", "couple": 0.3 });
  const pull = 0.11 * c["tScale"];
  gfSlide(G, car, t + 0.005, pull, 0.4, { "rough": 0.5, "prof": "pull", "name": "carrier back" });
  gfSpring(G, t + 0.005, 0.025 * c["spring"], { "f1": 1500, "period": 0.009, "echoes": 9, "decay": 0.8, "disp": 0.003, "ring": 0.3, "ringLen": 0.12, "name": "buffer spring compresses" });
  t += pull + 0.005;
  gfHit(G, car, t, 0.5, GF_STEEL_TAU, { "name": "carrier hits the buffer", "couple": 0.6 });
  t += gfGap(G, 0.06);
  gfSlide(G, car, t, 0.03, 0.35, { "rough": 0.5, "prof": "push", "name": "carrier forward" });
  gfSpring(G, t, 0.06 * c["spring"], { "f1": 1400, "period": 0.008, "echoes": 12, "decay": 0.82, "disp": 0.003, "ring": 0.6, "ringLen": 0.22, "name": "buffer spring sproings" });
  t += 0.031;
  gfHit(G, car, t, 1.0, GF_STEEL_TAU, { "name": "carrier slams home", "couple": 0.9 });
  gfHit(G, lk, t + 0.004, 0.45, GF_STEEL_TAU, { "name": "bolt locks", "couple": 0.3 });
  gfHit(G, hdl, t + 0.016, 0.3, GF_STEEL_TAU, { "name": "handle latches", "couple": 0.3 });
  return t + 0.4;
};

GF_SCRIPTS["bolt cycle"] = (G) => {
  const c = G.cfg;
  const bolt = gfPart(G, "bolt", "bolt", { "gain": 0.9, "ringMul": c["ringMul"] }), knob = gfPart(G, "bolt knob", "knob", { "gain": 0.4 });
  const ck = gfPart(G, "cocking piece", "cocking", { "gain": 0.4 }), ej = gfPart(G, "ejector", "ejector", { "gain": 0.3 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.1, c["handling"]);
  gfHit(G, knob, t, 0.25, 0.0004, { "name": "hand on the knob", "couple": 0.3 });
  const cam = 0.06 * c["tScale"];
  gfSlide(G, ck, t + 0.004, cam, 0.25, { "rough": 0.6, "prof": "even", "name": "bolt up (cocking cam)" });
  gfSpring(G, t + 0.004, 0.01 * c["spring"], { "f1": 3000, "period": 0.003, "echoes": 5, "disp": 0.001, "ring": 0.2, "ringLen": 0.05, "name": "firing pin spring compresses" });
  t += cam + 0.004;
  gfHit(G, ck, t, 0.35, GF_STEEL_TAU, { "name": "cocks", "couple": 0.4 });
  t += gfGap(G, 0.05);
  const back = 0.12 * c["tScale"];
  gfSlide(G, bolt, t, back, 0.45, { "rough": 0.5, "prof": "pull", "name": "bolt back" });
  t += back;
  gfHit(G, bolt, t, 0.8, GF_STEEL_TAU, { "name": "bolt stop", "couple": 0.8 });
  gfHit(G, ej, t - 0.003, 0.25, GF_STEEL_TAU, { "name": "ejector flicks the case", "couple": 0.1 });
  if (c["casing"] > 0) {
    const vz = 1.8, H = 1.1, vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);
    gfCaseDrop(G, t + (vz + vImp) / GF_GRAV, 1, c["surface"], vImp, c["casing"] * 0.6, 0.5 * c["width"]);
  }
  t += gfGap(G, 0.12);
  const fwd = 0.13 * c["tScale"];
  gfSlide(G, bolt, t, fwd, 0.45, { "rough": 0.5, "prof": "even", "name": "bolt forward" });
  gfHit(G, bolt, t + fwd * 0.3, 0.2, 0.0006, { "name": "picks up a round", "couple": 0.3, "click": 0 });
  t += fwd;
  gfHit(G, bolt, t, 0.55, GF_STEEL_TAU, { "name": "round chambers", "couple": 0.6 });
  t += gfGap(G, 0.05);
  gfHit(G, knob, t, 0.9, GF_STEEL_TAU, { "name": "bolt down (lugs lock)", "couple": 0.9 });
  gfHit(G, ck, t + 0.004, 0.2, GF_STEEL_TAU, { "name": "cocking piece settles", "couple": 0.2 });
  return t + 0.35 + (c["casing"] > 0 ? 0.8 : 0);
};

GF_SCRIPTS["pump rack"] = (G) => {
  const c = G.cfg, wood = c["frame"] === 2;
  const fore = gfPart(G, "forend", wood ? "wforend" : "pforend", { "gain": 0.9 }), tube = gfPart(G, "magazine tube", "magtube", { "gain": 0.5 });
  const bolt = gfPart(G, "bolt", "pbolt", { "gain": 0.9, "ringMul": c["ringMul"] }), bars = gfPart(G, "action bars", "bars", { "gain": 0.45 });
  const lift = gfPart(G, "shell lifter", "lifter", { "gain": 0.4 });
  let t = 0.03;
  gfHands(G, t - 0.03, 0.1, c["handling"]);
  gfHit(G, bars, t, 0.3, GF_STEEL_TAU, { "name": "action unlocks", "couple": 0.4 });
  const back = 0.1 * c["tScale"];
  gfSlide(G, tube, t + 0.002, back, 0.5, { "rough": 0.45, "prof": "pull", "lo": 800, "hi": 7000, "hiss": 0.3, "name": "forend back on the tube" });
  gfSlide(G, fore, t + 0.002, back, 0.3, { "rough": 0.6, "prof": "pull", "hiss": 0, "name": "forend rubs" });
  gfSlide(G, bolt, t + 0.01, back - 0.008, 0.3, { "rough": 0.5, "prof": "pull", "hiss": 0.1, "name": "bolt back" });
  gfHit(G, lift, t + back * 0.8, 0.35, GF_STEEL_TAU, { "name": "lifter pops up", "couple": 0.3 });
  t += back + 0.002;
  gfHit(G, bolt, t, 1.0, GF_STEEL_TAU, { "name": "bolt hits the rear", "couple": 0.9 });
  gfHit(G, fore, t + 0.001, 0.7, 0.0006, { "name": "forend stops", "couple": 0.6, "click": 0 });
  if (c["casing"] > 0) {
    const vz = 2.2, H = 1.1, vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);
    gfCaseDrop(G, t + (vz + vImp) / GF_GRAV, 2, c["surface"], vImp, c["casing"], 0.5 * c["width"]);
  }
  t += gfGap(G, 0.1);
  const fwd = 0.09 * c["tScale"];
  gfSlide(G, tube, t, fwd, 0.45, { "rough": 0.45, "prof": "push", "lo": 800, "hi": 7000, "hiss": 0.3, "name": "forend forward" });
  gfSlide(G, fore, t, fwd, 0.25, { "rough": 0.6, "prof": "push", "hiss": 0, "name": "forend rubs" });
  gfSlide(G, bolt, t + 0.005, fwd - 0.005, 0.3, { "rough": 0.5, "prof": "push", "hiss": 0.1, "name": "bolt forward" });
  gfHit(G, lift, t + fwd * 0.35, 0.25, GF_STEEL_TAU, { "name": "lifter drops", "couple": 0.2 });
  gfSpring(G, t + fwd * 0.4, 0.015 * c["spring"], { "f1": 1700, "period": 0.006, "echoes": 7, "disp": 0.002, "ring": 0.3, "ringLen": 0.08, "name": "magazine spring pushes a shell" });
  t += fwd;
  gfHit(G, bolt, t, 1.0, GF_STEEL_TAU, { "name": "bolt into battery", "couple": 1 });
  gfHit(G, fore, t + 0.001, 0.6, 0.0006, { "name": "forend stops", "couple": 0.6, "click": 0 });
  gfHit(G, bars, t + 0.004, 0.35, GF_STEEL_TAU, { "name": "action locks", "couple": 0.3 });
  return t + 0.35 + (c["casing"] > 0 ? 0.7 : 0);
};

GF_SCRIPTS["revolver spin"] = (G) => {
  const c = G.cfg, rnd = G.rnd;
  const cyl = gfPart(G, "cylinder", "cylinder", { "gain": 0.7, "ringMul": c["ringMul"] }), lt = gfPart(G, "latch", "latch", { "gain": 0.45 });
  const stop = gfPart(G, "cylinder stop", "stop", { "gain": 0.35 }), crane = gfPart(G, "crane", "crane", { "gain": 0.6 });
  const ham = gfPart(G, "hammer", "hammer", { "gain": 0.6 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.1, c["handling"]);
  gfHit(G, lt, t, 0.25, GF_STEEL_TAU, { "name": "latch pressed", "couple": 0.4 });
  gfSlide(G, crane, t + 0.01, 0.06, 0.15, { "rough": 0.4, "prof": "even", "hiss": 0.1, "name": "cylinder swings out" });
  gfHit(G, crane, t + 0.07, 0.35, 0.0003, { "name": "crane stops", "couple": 0.5 });
  t += 0.07 + gfGap(G, 0.13);
  // the spin: a flick, then the notches ticking past the stop, slowing under friction (constant deceleration)
  gfHit(G, cyl, t, 0.3, 0.0015, { "name": "finger flicks the cylinder", "couple": 0.3, "click": 0 });
  const w0 = 4 + 2 * rnd() * (0.6 + 0.4 * c["crisp"]), Ts = (1.0 + 0.5 * rnd()) * (0.8 + 0.4 * c["weight"]);   // rev/s, spin time
  const notches = 6;
  let ph = rnd() / notches, nTicks = 0;
  for (let k = 0; k < 400; k++) {
    // time of the next notch: angle(t) = w0 t - w0 t^2 / (2 Ts) (rev); notch at angle ph + j / notches
    const target = ph + nTicks / notches;
    const disc = 1 - 2 * target / (w0 * Ts);
    if (disc < 0) break;
    const tk = Ts * (1 - Math.sqrt(disc));
    const speed = w0 * (1 - tk / Ts);
    const a = 0.08 + 0.12 * Math.min(1, speed / w0);
    gfForceRaw(G, stop, t + tk, a, GF_STEEL_TAU * c["tauMul"], rnd());
    gfForceRaw(G, cyl, t + tk, a * 0.4, GF_STEEL_TAU * c["tauMul"], rnd());
    gfClick(G, t + tk, a * 0.03, 2 / G.sr, stop.pan);
    nTicks++;
  }
  G.info.events.push([Math.round(t * 1000), "spin: " + nTicks + " notch ticks over " + Math.round(Ts * 1000) + " ms from " + (w0 * notches).toFixed(0) + "/s"]);
  gfSlide(G, cyl, t, Ts, 0.06, { "rough": 0.3, "prof": "even", "lo": 2000, "hi": 9000, "hiss": 0.25, "name": "cylinder whirs" });
  t += Ts + gfGap(G, 0.12);
  // flick shut: the crane swings in, the latch snaps, the stop drops into a notch as the cylinder settles
  gfHands(G, t - 0.03, 0.06, c["handling"] * 0.6);
  gfSlide(G, crane, t, 0.035, 0.2, { "rough": 0.4, "prof": "push", "hiss": 0.1, "name": "cylinder swings in" });
  t += 0.035;
  gfHit(G, crane, t, 0.95, GF_STEEL_TAU, { "name": "cylinder shuts", "couple": 0.9 });
  gfHit(G, lt, t + 0.003, 0.5, GF_STEEL_TAU, { "name": "latch snaps", "couple": 0.3 });
  gfHit(G, stop, t + 0.03 + 0.03 * rnd(), 0.25, GF_STEEL_TAU, { "name": "stop finds a notch", "couple": 0.2 });
  if (c["cock"]) {
    t += gfGap(G, 0.35);
    gfHands(G, t - 0.03, 0.08, c["handling"] * 0.6);
    const hb = 0.09 * c["tScale"];
    gfSlide(G, ham, t, hb, 0.12, { "rough": 0.5, "prof": "pull", "hiss": 0.05, "name": "hammer drawn back" });
    gfSpring(G, t, 0.012 * c["spring"], { "f1": 2400, "period": 0.004, "echoes": 6, "disp": 0.0015, "ring": 0.3, "ringLen": 0.06, "name": "mainspring compresses" });
    gfHit(G, stop, t + hb * 0.35, 0.25, GF_STEEL_TAU, { "name": "bolt drops (first click)", "couple": 0.3 });
    gfHit(G, cyl, t + hb * 0.7, 0.15, 0.0003, { "name": "cylinder turns", "couple": 0.2, "click": 0 });
    t += hb;
    gfHit(G, ham, t, 0.6, GF_STEEL_TAU, { "name": "hammer cocks", "couple": 0.6 });
    gfHit(G, stop, t + 0.006, 0.35, GF_STEEL_TAU, { "name": "cylinder locks", "couple": 0.3 });
  }
  return t + 0.35;
};

GF_SCRIPTS["dry fire"] = (G) => {
  const c = G.cfg, fr = c["frame"];
  let t = 0.04;
  gfHands(G, t - 0.03, 0.2, c["handling"] * 0.4);
  if (fr === 0) {           // a striker-fired polymer pistol: take-up, the wall, the break, the striker hits nothing
    const trg = gfPart(G, "trigger", "ptrigger", { "gain": 0.5 }), sear = gfPart(G, "sear", "sear", { "gain": 0.3 }), st = gfPart(G, "striker", "striker", { "gain": 0.8, "ringMul": c["ringMul"] });
    const take = 0.11 * c["tScale"];
    gfSlide(G, trg, t, take, 0.07, { "rough": 0.3, "prof": "even", "lo": 1500, "hi": 6000, "hiss": 0.15, "name": "trigger take-up" });
    t += take;
    gfHit(G, trg, t, 0.08, 0.0005, { "name": "trigger meets the wall", "couple": 0.2, "click": 0 });
    t += 0.05 * c["tScale"];
    gfHit(G, sear, t, 0.25, GF_STEEL_TAU, { "name": "sear breaks", "couple": 0.3 });
    gfSpring(G, t + 0.001, 0.015 * c["spring"], { "f1": 3200, "period": 0.0025, "echoes": 5, "disp": 0.001, "ring": 0.25, "ringLen": 0.04, "name": "striker spring" });
    t += 0.0025;
    gfHit(G, st, t, 1.0, GF_STEEL_TAU, { "name": "striker falls (empty chamber)", "couple": 0.9 });
    t += gfGap(G, 0.28);
    gfHit(G, trg, t, 0.2, GF_STEEL_TAU, { "name": "trigger resets", "couple": 0.3 });
  } else if (fr === 1) {    // a double-action steel revolver: the long pull turns the cylinder, then the hammer falls
    const trg = gfPart(G, "trigger", "trigger", { "gain": 0.4 }), cyl = gfPart(G, "cylinder", "cylinder", { "gain": 0.4 });
    const stop = gfPart(G, "cylinder stop", "stop", { "gain": 0.35 }), ham = gfPart(G, "hammer", "hammer", { "gain": 0.9, "ringMul": c["ringMul"] });
    const pull = 0.24 * c["tScale"];
    gfSlide(G, trg, t, pull, 0.08, { "rough": 0.35, "prof": "even", "lo": 1500, "hi": 7000, "hiss": 0.12, "name": "double-action pull" });
    gfSlide(G, cyl, t + pull * 0.2, pull * 0.6, 0.06, { "rough": 0.3, "prof": "even", "hiss": 0.05, "name": "cylinder turns" });
    gfSpring(G, t, 0.01 * c["spring"], { "f1": 2300, "period": 0.005, "echoes": 6, "disp": 0.002, "ring": 0.2, "ringLen": 0.07, "name": "mainspring compresses" });
    gfHit(G, stop, t + pull * 0.85, 0.3, GF_STEEL_TAU, { "name": "cylinder locks", "couple": 0.3 });
    t += pull;
    gfHit(G, ham, t, 1.0, GF_STEEL_TAU, { "name": "hammer falls (empty chamber)", "couple": 0.9 });
    gfSpring(G, t, 0.02 * c["spring"], { "f1": 2300, "period": 0.005, "echoes": 7, "disp": 0.0018, "ring": 0.4, "ringLen": 0.08, "name": "mainspring" });
    t += gfGap(G, 0.3);
    gfHit(G, trg, t, 0.15, GF_STEEL_TAU, { "name": "trigger returns", "couple": 0.2 });
  } else {                  // a rifle's hammer: a short take-up, the break, the hammer swings onto the firing pin
    const trg = gfPart(G, "trigger", "trigger", { "gain": 0.4 }), ham = gfPart(G, "hammer", "hammer", { "gain": 1, "ringMul": c["ringMul"], "scale": c["size"] * 0.85 });
    const pin = gfPart(G, "firing pin", "striker", { "gain": 0.4 });
    const take = 0.08 * c["tScale"];
    gfSlide(G, trg, t, take, 0.06, { "rough": 0.35, "prof": "even", "lo": 1500, "hi": 6000, "hiss": 0.12, "name": "trigger take-up" });
    t += take;
    gfHit(G, trg, t, 0.2, GF_STEEL_TAU, { "name": "trigger breaks", "couple": 0.3 });
    t += 0.007;
    gfHit(G, ham, t, 1.0, GF_STEEL_TAU, { "name": "hammer hits the firing pin", "couple": 1 });
    gfHit(G, pin, t + 0.0012, 0.4, GF_STEEL_TAU, { "name": "pin hits nothing", "couple": 0.2 });
    gfSpring(G, t, 0.05 * c["spring"], { "f1": 1900, "period": 0.006, "echoes": 10, "decay": 0.78, "disp": 0.0025, "ring": 0.6, "ringLen": 0.14, "name": "hammer spring sproings" });
    t += gfGap(G, 0.3);
    gfHit(G, trg, t, 0.25, GF_STEEL_TAU, { "name": "trigger resets", "couple": 0.3 });
  }
  return t + 0.3;
};

// BOLT RELOAD: the bolt opened, AMMUNITION loaded (thumbed in one by one, stripped off a clip, or a single round dropped
// into the port), the bolt closed. Each loaded round is its own part (a brass cartridge held in steel: damped).
GF_SCRIPTS["bolt reload"] = (G) => {
  const c = G.cfg, rnd = G.rnd, load = c["load"];
  const bolt = gfPart(G, "bolt", "bolt", { "gain": 0.9, "ringMul": c["ringMul"] }), knob = gfPart(G, "bolt knob", "knob", { "gain": 0.4 });
  const ck = gfPart(G, "cocking piece", "cocking", { "gain": 0.4 }), ej = gfPart(G, "ejector", "ejector", { "gain": 0.3 });
  const lips = gfPart(G, "feed lips", "lips", { "gain": 0.5 }), fol = gfPart(G, "follower", "follower", { "gain": 0.4 });
  const roundPart = (k) => gfPart(G, "round " + (k + 1), "round", { "gain": 0.6, "ringMul": 0.35, "scale": c["size"] * (0.97 + 0.06 * rnd()) });
  let t = 0.03;
  // OPEN: up (the cam cocks it), back to the stop; the single-round take ejects a fired case
  gfHit(G, knob, t, 0.25, 0.0004, { "name": "hand on the knob", "couple": 0.3 });
  const cam = 0.05 * c["tScale"];
  gfSlide(G, ck, t + 0.004, cam, 0.25, { "rough": 0.6, "prof": "even", "name": "bolt up (cocking cam)" });
  t += cam + 0.004;
  gfHit(G, ck, t, 0.35, GF_STEEL_TAU, { "name": "cocks", "couple": 0.4 });
  t += gfGap(G, 0.04);
  const back = 0.1 * c["tScale"];
  gfSlide(G, bolt, t, back, 0.45, { "rough": 0.5, "prof": "pull", "name": "bolt back" });
  t += back;
  gfHit(G, bolt, t, 0.8, GF_STEEL_TAU, { "name": "bolt stop", "couple": 0.8 });
  if (load === 2) {
    gfHit(G, ej, t - 0.003, 0.3, GF_STEEL_TAU, { "name": "ejector flicks the case", "couple": 0.1 });
    // the case leaving the port rings as it is kicked out ("ping"), then lands
    const cs = gfPart(G, "ejected case", GF_CASE_SHAPES[1], { "scale": 1, "split": 0.003, "pan": 0.5 * c["width"], "gain": 0.55, "cat": "mech" });
    gfForceRaw(G, cs, t + 0.002, 1, GF_STEEL_TAU, 0.3);
    G.info.events.push([Math.round((t + 0.002) * 1000), "case pings out of the port"]);
    const vz = 1.8, H = 1.1, vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);   // (its landing only with Ejected case > 0)
    if (c["casing"] > 0) G.caseRest = gfCaseDrop(G, t + (vz + vImp) / GF_GRAV, 1, c["surface"], vImp, 0.4, 0.6 * c["width"]);
  }
  t += gfGap(G, load === 2 ? 0.12 : 0.2);
  // LOAD
  if (load === 0) {               // thumbed in: each round pressed down past the feed lips, the follower and spring under it
    for (let k = 0; k < c["rounds"]; k++) {
      const r = roundPart(k), stiff = 1 + 0.08 * k;
      gfHands(G, t - 0.02, 0.08, c["handling"] * 0.5);
      gfHit(G, r, t, 0.12, 0.00008, { "name": "round " + (k + 1) + " on the lips", "couple": 0.15 });
      gfHit(G, lips, t + 0.001, 0.08, GF_STEEL_TAU, { "name": "brass on steel", "couple": 0.1, "click": 0 });
      const push = 0.05 * c["tScale"];
      gfSlide(G, r, t + 0.003, push, 0.3, { "rough": 0.6, "prof": "pull", "lo": 2000, "hi": 9000, "hiss": 0.2, "name": "pressed down" });
      gfSlide(G, lips, t + 0.003, push, 0.15, { "rough": 0.6, "prof": "pull", "hiss": 0, "name": "past the lips" });
      gfSpring(G, t + 0.004, 0.012 * c["spring"] * stiff, { "f1": 2400 * stiff, "period": 0.002, "echoes": 5, "decay": 0.6, "disp": 0.0008, "ring": 0.2, "ringLen": 0.04, "name": "mag spring compresses" });
      const ts = t + 0.003 + push;
      gfHit(G, lips, ts, 0.45, GF_STEEL_TAU, { "name": "round " + (k + 1) + " snaps under the lips", "couple": 0.45 });
      gfHit(G, r, ts + 0.0007, 0.35, GF_STEEL_TAU, { "name": "seats", "couple": 0.3, "click": 0 });
      gfHit(G, fol, ts + 0.002, 0.25, 0.0003, { "name": "the stack settles on the follower", "couple": 0.3, "click": 0 });
      t = ts + gfGap(G, 0.24);
    }
  } else if (load === 1) {        // stripper clip: set in its guide, five rounds stripped down in one long push, clip flicked away
    const clip = gfPart(G, "stripper clip", "clip", { "gain": 0.6 }), rs = [0, 1, 2, 3, 4].map((k) => roundPart(k));
    gfHands(G, t - 0.03, 0.1, c["handling"] * 0.6);
    gfSlide(G, clip, t, 0.03, 0.2, { "rough": 0.6, "prof": "push", "hiss": 0.2, "name": "clip into its guide" });
    t += 0.03;
    gfHit(G, clip, t, 0.5, GF_STEEL_TAU, { "name": "clip seats in the guide", "couple": 0.5 });
    t += gfGap(G, 0.12);
    // the push: rounds leave the clip's spring rails one at a time (the ratchet), the column grinding down the clip
    const len = 0.42 * c["tScale"];
    gfSlide(G, clip, t, len, 0.5, { "rough": 0.9, "prof": "even", "rate": 4000, "lo": 1800, "hi": 10000, "hiss": 0.45, "name": "five rounds stripped down (the long push)" });
    gfSlide(G, lips, t, len, 0.25, { "rough": 0.8, "prof": "even", "hiss": 0, "name": "rounds over the lips" });
    gfSpring(G, t, 0.02 * c["spring"], { "f1": 2300, "period": 0.003, "echoes": 8, "decay": 0.75, "disp": 0.002, "ring": 0.3, "ringLen": 0.12, "name": "mag spring compresses" });
    for (let k = 0; k < 5; k++) {
      const u = (k + 0.6) / 5.4, tk = t + len * Math.pow(u, 0.9) + 0.006 * (rnd() - 0.5);
      gfHit(G, clip, tk, 0.35, GF_STEEL_TAU, { "name": "round " + (k + 1) + " leaves the clip", "couple": 0.3 });
      gfHit(G, rs[k], tk + 0.0015, 0.35, GF_STEEL_TAU, { "name": "snaps into the magazine", "couple": 0.3, "click": 0 });
      gfHit(G, lips, tk + 0.003, 0.3, GF_STEEL_TAU, { "name": "lips", "couple": 0.2, "click": 0 });
    }
    t += len;
    gfHit(G, fol, t + 0.003, 0.3, 0.0003, { "name": "the stack bottoms", "couple": 0.4, "click": 0 });
    t += gfGap(G, 0.14);
    // the empty clip flicked out of its guide: a light tinny tick, and it lands somewhere off to the side
    gfSlide(G, clip, t, 0.012, 0.12, { "rough": 0.5, "prof": "push", "hiss": 0.1, "name": "clip flicked out" });
    gfHit(G, clip, t + 0.012, 0.25, GF_STEEL_TAU, { "name": "clip leaves the guide (tick)", "couple": 0.1 });
    const fl = gfPart(G, "dropped clip", "clip", { "gain": 0.25, "pan": -0.6 * c["width"], "scale": 1 });
    let tl = t + 0.012 + 0.42, v = 3;
    for (let k = 0; k < 3 && v > 0.3; k++) { gfForceRaw(G, fl, tl, v / 3, 0.00004, rnd()); G.info.events.push([Math.round(tl * 1000), "clip lands"]); v *= 0.4 * (0.6 + 0.8 * rnd()); tl += 2 * v / GF_GRAV; }
    gfDamp(fl, tl + 0.02, 0.2);
    t += gfGap(G, 0.12);
  } else {                        // single round: dropped into the open port, pushed forward with the bolt
    const r = roundPart(0);
    gfHands(G, t - 0.04, 0.08, c["handling"] * 0.5);
    gfHit(G, r, t, 0.55, 0.00006, { "name": "round dropped into the port", "couple": 0.4 });
    gfHit(G, fol, t + 0.0015, 0.35, 0.0002, { "name": "on the follower", "couple": 0.3, "click": 0 });
    gfHit(G, r, t + 0.045 + 0.01 * rnd(), 0.18, 0.00006, { "name": "rolls into the rails", "couple": 0.1, "click": 0 });
    t += gfGap(G, 0.12);
  }
  // CLOSE: forward (picking up the top round, chambering), then down: the ka-CHUNK
  const fwd = (load === 2 ? 0.09 : 0.12) * c["tScale"];
  gfSlide(G, bolt, t, fwd, 0.45, { "rough": 0.5, "prof": load === 2 ? "push" : "even", "name": "bolt forward" });
  gfHit(G, bolt, t + fwd * 0.3, 0.25, 0.0006, { "name": "picks up a round", "couple": 0.3, "click": 0 });
  t += fwd;
  gfHit(G, bolt, t, load === 2 ? 0.85 : 0.6, GF_STEEL_TAU, { "name": "round chambers (ka-)", "couple": 0.7 });
  t += gfGap(G, load === 2 ? 0.07 : 0.05);
  gfHit(G, knob, t, load === 2 ? 1.25 : 0.95, GF_STEEL_TAU, { "name": "bolt down, lugs lock (-CHUNK)", "couple": 1 });
  gfHit(G, bolt, t + 0.002, 0.5, GF_STEEL_TAU, { "name": "the bolt body seats", "couple": 0.6, "click": 0 });
  gfHit(G, ck, t + 0.005, 0.2, GF_STEEL_TAU, { "name": "cocking piece settles", "couple": 0.2 });
  return Math.max(t + 0.4, G.caseRest ? G.caseRest + 0.3 : 0);
};

GF_SCRIPTS["casing"] = (G) => {
  const c = G.cfg, vz = 1.5, H = c["dropH"], vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);
  const end = gfCaseDrop(G, 0.02, c["caseType"], c["surface"], vImp, 1, (G.rnd() * 2 - 1) * 0.3 * c["width"]);
  G.info.events.push([20, "first landing at " + vImp.toFixed(1) + " m/s"]);
  return end + 0.35;
};

// RICOCHET: the bullet hits the surface (gfDist sets how far away), then the tumbling slug flies past
GF_SCRIPTS["ricochet"] = (G) => {
  const c = G.cfg, rnd = G.rnd, sr = G.sr, si = c["surface"];
  // geometry: the slug leaves the impact point at v0 and passes the listener at dmin; "away" when crisp < 0.3 and surface metal
  const dmin = c["dist"], v0 = 100 + 0.15 * c["speed"], k = 0.3 + 0.3 * rnd();   // a deformed, tumbling slug leaves slow (~150-240 m/s) and keeps slowing
  const away = !c["past"];
  const xImp = away ? 2 + 4 * rnd() : -(6 + 10 * rnd()) * (0.5 + dmin / 10);   // along-track at the impact
  const rImp = Math.sqrt(xImp * xImp + dmin * dmin), tImp = 0.01;
  // the impact, heard at tImp
  const ia = 1 / Math.max(1, rImp / 5), pan = gfClamp(xImp / rImp, -1, 1) * 0.6 * c["width"];
  if (si === 3) {
    const plate = gfPart(G, "steel plate", { "f": [480, 1250, 2300, 3400, 4700, 6100, 7900], "a": [0.6, 1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "deck" }, { "scale": 1, "pan": pan, "gain": ia, "ringMul": 0.6, "cat": "impact" });
    gfForceRaw(G, plate, tImp, 1, 0.00002, 0.3);
    gfClick(G, tImp, ia * 0.25, 2 / sr, pan, "impact");
  } else {
    gfClick(G, tImp, ia * 0.18, 0.00012, pan, "impact");   // ~120 us: a lead slug flattening on stone, not a spike
    const chips = si === 2 ? 0 : si === 1 ? 25 : 60;
    for (let j = 0; j < chips; j++) { const tc = tImp + 0.06 * Math.pow(rnd(), 1.6); gfClick(G, tc, ia * 0.05 * Math.pow(rnd(), 2), 1.5 / sr, pan + (rnd() - 0.5) * 0.3, "impact"); }
    gfBurst(G, tImp, 0.12, si === 2 ? 0.03 : 0.02, ia * (si === 2 ? 0.25 : 0.12), si === 2 ? 300 : 1500, si === 2 ? 4000 : 11000, pan);
    if (si === 1) { const wd = gfPart(G, "wood", { "f": [320, 700, 1300], "a": [1, 0.6, 0.3], "mat": "wood" }, { "scale": 1, "pan": pan, "gain": ia * 0.7, "cat": "impact" }); gfForceRaw(G, wd, tImp, 1, 0.0003, 0.5); }
    if (si === 2) { const dt = gfPart(G, "dirt", { "f": [90, 170], "a": [1, 0.5], "mat": "soil" }, { "scale": 1, "pan": pan, "gain": ia * 1.2, "cat": "impact" }); gfForceRaw(G, dt, tImp, 1, 0.002, 0.5); }
  }
  G.info.events.push([Math.round(tImp * 1000), "impact on " + GF_SURFACES[si] + " " + rImp.toFixed(1) + " m away"]);
  // the slug: emission starts at te = 0 at xImp; arrival of te = 0 is tImp, so ta0 = rImp / c - tImp
  const life = 0.7 + 0.6 * c["crisp"];                 // emission seconds before the whistle dies (the slug drops / stops tumbling hard)
  const n = G.n, fb = gfFlyby(sr, n, rImp / GF_C - tImp, { "v0": v0, "k": k, "dmin": dmin, "x0": xImp }, (te) => te > life);
  const f0 = (2200 + 2400 * rnd()) * (0.75 + 0.5 * c["crisp"]), fr0 = 70 + 160 * rnd(), depth = 0.55 + 0.35 * rnd();
  const nb = gfBand(sr, 1500, 9000);
  let ph = rnd() * 6.283, phT = 0, lp = 0, lp2 = 0, emax = 0;
  const [L, R] = G.cat("flyby");
  for (let i = 0; i < fb.len; i++) {
    const te = fb.te[i];
    if (te < 0) continue;
    if (te > life) break;
    const vr = fb.vOf(te) / v0, fsrc = f0 * vr, fobs = fsrc * fb.dop[i];
    ph += 2 * Math.PI * Math.min(fobs, 0.45 * sr) / sr;
    phT += 2 * Math.PI * fr0 * vr * fb.dop[i] / sr;
    const tumble = 1 - depth * (0.5 + 0.5 * Math.cos(phT)) + 0.15 * Math.sin(2.3 * phT);
    let s = 0;
    if (fobs < 0.45 * sr) s += Math.sin(ph);
    if (2 * fobs < 0.45 * sr) s += 0.35 * Math.sin(2 * ph + 0.7);
    if (3 * fobs < 0.45 * sr) s += 0.12 * Math.sin(3 * ph + 1.9);
    s += 0.35 * gfBandTick(nb, rnd() * 2 - 1);
    // amplitude: 1/r, the Doppler's energy compression (intensity ~ dop^2 for a moving monopole, kept mild), the whistle
    // weakening as the slug slows, fade-in over its first few ms and out at its life's end
    const env = Math.min(1, te / 0.004) * Math.min(1, (life - te) / 0.12) * Math.pow(vr, 1.5);
    const a = env * tumble * Math.pow(fb.dop[i], 1.2) / fb.r[i];
    // air: a one-pole whose corner falls with distance (and a fixed 9 kHz top for the whistle's harmonics)
    const fc = Math.max(2500, 14000 * Math.pow(10 / (10 + fb.r[i]), 0.6)), al = Math.exp(-2 * Math.PI * fc / sr);
    lp = s * a + (lp - s * a) * al; lp2 = lp + (lp2 - lp) * al;
    const x = xImp + fb.sOf(te), [gl, gr] = gfPanGains(gfClamp(x / fb.r[i], -1, 1) * 0.8 * c["width"]);   // pan follows the slug
    L[i] += lp2 * gl; R[i] += lp2 * gr; emax = Math.max(emax, Math.abs(lp2));
  }
  // the dop at the start and the end, for the KEY
  let i0 = 0; while (i0 < n && fb.te[i0] < 0) i0++;
  let i1 = i0; while (i1 < n - 1 && fb.te[i1] < life) i1++;
  G.info.whine = { "f0": Math.round(f0), "tumbleHz": Math.round(fr0), "v0": Math.round(v0), "dmin": +dmin.toFixed(1), "start": Math.round(f0 * fb.dop[i0]), "end": Math.round(f0 * fb.vOf(fb.te[i1]) / v0 * fb.dop[i1]), "heardFrom": Math.round(i0 / sr * 1000), "heardTo": Math.round(i1 / sr * 1000) };
  G.info.events.push([Math.round(i0 / sr * 1000), "whine " + G.info.whine.start + " Hz -> " + G.info.whine.end + " Hz"]);
  G.whineLevel = 1.6 + 1.6 * c["crisp"];
  return Math.min(i1 / sr + 0.25, 2.5);
};

// BULLET PASS: supersonic N-wave + ground reflection + wake hiss; or a subsonic whiz through the flyby Doppler
GF_SCRIPTS["bullet pass"] = (G) => {
  const c = G.cfg, rnd = G.rnd, sr = G.sr, d = c["dist"], v = c["speed"], M = v / GF_C, [L, R] = G.cat("flyby");
  const side = (rnd() < 0.5 ? -1 : 1) * 0.7 * c["width"];
  const t0 = 0.01;
  if (M > 1.05) {
    const [NL, NR] = G.cat("nwave"), dia = 0.0078, blen = 0.03;
    const T = 1.82 * M * Math.pow(d, 0.25) * dia / (GF_C * Math.pow(M * M - 1, 0.375) * Math.pow(blen, 0.25));
    const P = Math.pow(d, -0.75), rise = 0.000004 + 0.00003 * Math.pow(d / 10, 1.2);   // turbulence smears the shock with distance
    const nwave = (t, amp, Tn, pan) => {
      const OS = 8, i0 = Math.floor(t * sr), i1 = Math.ceil((t + Tn + 4 * rise) * sr) + 1, [gl, gr] = gfPanGains(pan);
      for (let i = i0; i < i1 && i < G.n; i++) {
        let s = 0;
        for (let k = 0; k < OS; k++) {
          const u = (i + (k + 0.5) / OS) / sr - t;
          // the N: a front shock up, a linear fall through zero, a tail shock back up; each shock a tanh of width `rise`
          const s1 = 0.5 + 0.5 * Math.tanh(u / rise), s2 = 0.5 + 0.5 * Math.tanh((u - Tn) / rise);
          s += (s1 - s2) * (1 - 2 * u / Tn);
        }
        const val = amp * s / OS; NL[i] += val * gl; NR[i] += val * gr;
      }
    };
    nwave(t0, P, T, side);
    const h = 1.5, dRef = Math.sqrt(d * d + 4 * h * h), tRef = (dRef - d) / GF_C;
    nwave(t0 + tRef, Math.pow(dRef, -0.75) * 0.55, T * Math.pow(dRef / d, 0.25), side * 0.6);
    G.info.events.push([Math.round(t0 * 1000), "N-wave " + Math.round(T * 1e6) + " us, rise " + Math.round(rise * 1e6) + " us"]);
    G.info.events.push([Math.round((t0 + tRef) * 1000), "ground reflection"]);
    // the wake: turbulent hiss after the crack, its band falling as the bullet recedes, weaker with distance
    const wl = 0.12 + 0.1 * (1 - c["crisp"]), n = Math.ceil(wl * sr), i0 = Math.floor((t0 + 0.0005) * sr), b = { "l": 0, "l2": 0, "h": 0 };
    const amp = P * 0.06 * Math.pow(Math.min(1, 3 / d), 0.5), [gl, gr] = gfPanGains(side * 0.6);
    for (let k = 0; k < n && i0 + k < G.n; k++) {
      const u = k / n, fc = 9000 * Math.pow(1800 / 9000, Math.pow(u, 0.6)) * Math.pow(Math.min(1, 4 / d), 0.3), aL = Math.exp(-2 * Math.PI * fc / sr), aH = Math.exp(-2 * Math.PI * fc * 0.25 / sr);
      const x = rnd() * 2 - 1; b.h = x + (b.h - x) * aH; const hp = x - b.h; b.l = hp + (b.l - hp) * aL; b.l2 = b.l + (b.l2 - b.l) * aL;
      const env = Math.min(1, k / (0.002 * sr)) * Math.pow(1 - u, 2.2), vv = b.l2 * amp * env;
      L[i0 + k] += vv * gl; R[i0 + k] += vv * gr;
    }
    G.info.pass = { "mach": +M.toFixed(2), "nwaveUs": Math.round(T * 1e6), "reflectMs": +(tRef * 1000).toFixed(1) };
    // the wake is levelled against the N-waves' ENERGY (a 0.1-0.3 ms shock carries almost none, as blast.mjs found for
    // its muzzle shock): x2 .. x30, more when close and crisp, so the snap keeps its crest and the pass has a body
    G.wakeRatio = (2 + 28 * c["crisp"]) * Math.pow(Math.min(1, 3 / d), 0.5);
    return t0 + Math.max(0.35, wl + 0.1);
  }
  // subsonic: the wake's whiz (noise with a whistle) through the flyby
  const n = G.n, tPass = 0.3, X0 = 40;   // heard from 40 m out; the file starts 10 ms before that sound arrives
  const teS = (tPass * v - X0) / v, taS = teS + Math.sqrt(X0 * X0 + d * d) / GF_C - 0.01;
  const fb = gfFlyby(sr, n, taS, { "v0": v, "k": 0, "dmin": d, "x0": -v * tPass }, (te) => -v * tPass + v * te > X0);   // at its closest at emission time tPass; solved until it is 40 m past
  const fW = 1300 + 500 * rnd();
  let lp = 0, lp2 = 0, h = 0, ph = 0;
  for (let i = 0; i < fb.len; i++) {
    const te = fb.te[i], x = -v * tPass + v * te, r = fb.r[i], dp = fb.dop[i];
    if (Math.abs(x) > X0) continue;
    const fc = Math.min(6000, fW * dp), aL = Math.exp(-2 * Math.PI * fc * 1.6 / sr), aH = Math.exp(-2 * Math.PI * fc * 0.5 / sr);
    const xx = rnd() * 2 - 1; h = xx + (h - xx) * aH; const hp = xx - h; lp = hp + (lp - hp) * aL; lp2 = lp + (lp2 - lp) * aL;
    ph += 2 * Math.PI * Math.min(fc, 0.45 * sr) / sr;
    const a = Math.sqrt(dp) / r * Math.min(1, (X0 - Math.abs(x)) / 10);
    const s = (lp2 * 1.4 + 0.12 * Math.sin(ph) * (0.6 + 0.4 * Math.sin(ph * 0.013))) * a;
    const [gl, gr] = gfPanGains(gfClamp(x / r, -1, 1) * 0.8 * c["width"] * Math.sign(side || 1));
    L[i] += s * gl; R[i] += s * gr;
  }
  G.info.pass = { "mach": +M.toFixed(2), "subsonic": true, "whizHz": Math.round(fW), "approachX": +(1 / (1 - M)).toFixed(1), "recedeX": +(1 / (1 + M)).toFixed(2) };
  G.info.events.push([Math.round((tPass + d / GF_C - taS) * 1000), "closest pass"]);
  G.whineLevel = 1;
  return tPass + d / GF_C - taS + 0.3;
};

// One action into n samples (the patch's Duration), seeded by the patch's `gfSeed`. Returns { L, R, info } (Float32,
// DC-blocked, its categories balanced, NOT yet levelled: gunfoleyLevel does that, after its own Peak control). The script
// runs into a buffer of at least GF_MIN_SPAN seconds whatever the Duration (the prototype's), so a short Duration cuts the
// action rather than changing it; the balance is measured over the n samples the app keeps, as the prototype's was.
function makeGunfoley(sr, n, cfg, seed) {
  n = Math.max(1, n);
  const base = ((seed >>> 0) ^ GF_SEED_MIX) >>> 0;
  const rnd = gfRng(base ^ 0x1b873593);
  const name = GF_ACTIONS[cfg["action"]];
  const maxN = Math.max(n, Math.round(GF_MIN_SPAN * sr));
  const cats = {};
  const info = { "action": name, "events": [], "landings": [], "energies": {} };
  const G = { "sr": sr, "n": maxN, "rnd": rnd, "cfg": cfg, "parts": [], "floors": [], "info": info, "body": null, "thump": null, "whineLevel": 1,
    "cat": (k) => cats[k] || (cats[k] = [new Float64Array(maxN), new Float64Array(maxN)]) };
  if (cfg["action"] <= 5 || cfg["action"] === 9) {   // a weapon: its body and its rigid-body thump
    G.body = GF_BODIES[cfg["frame"]].map((b, k) => gfPart(G, "body " + k, b, { "pan": 0, "cat": "body" }));
    G.thump = gfPart(G, "weight thump", { "f": [115, 190], "a": [1, 0.4], "mat": "wood" }, { "pan": 0, "ringMul": 0.5, "cat": "thump" });
  }
  info.end = GF_SCRIPTS[name](G);   // the action's own length (s): the prototype's buffer length with no Duration given
  info.dur = n / sr;
  gfRunParts(G);
  // LEVELS: every category to a target ENERGY relative to the reference (the mechanism's parts; a lone casing's case; a
  // ricochet's impact), as glass levels its components, so each knob is a ratio and never an accident of gains.
  const E = {};
  for (const k in cats) { let e = 0; const [a0, a1] = cats[k]; for (let i = 0; i < n; i++) e += (a0[i] * a0[i] + a1[i] * a1[i]) / 2; E[k] = e / sr; }
  const c = cfg, refK = E["mech"] > 0 ? "mech" : E["case"] > 0 ? "case" : E["nwave"] > 0 ? "nwave" : "impact", ref = E[refK] || 0;
  const T = {};
  if (refK === "mech") {
    T["body"] = [0.35, 0.5, 0.7][c["frame"]] * (0.7 + 0.6 * c["crisp"]);
    T["thump"] = 0.25 * c["thump"];
    T["click"] = 0.04 * (0.5 + c["crisp"]);
    T["rub"] = 0.08 * c["rub"];
    T["spring"] = 0.12 * c["spring"];
    T["hands"] = 0.1 * c["handling"];
    T["case"] = 0.35 * c["casing"] * c["casing"];
    T["floor"] = T["case"] * [0, 0.35, 1.2, 0.3][c["surface"]];
    T["grit"] = T["case"] * 0.15 + (c["magDrop"] > 0 ? 0.02 * c["magDrop"] : 0);
  } else if (refK === "case") {
    T["floor"] = [0, 0.35, 1.2, 0.3][c["surface"]];
    T["grit"] = [0.12, 0.05, 0.6, 0.03][c["surface"]];
    T["click"] = 0.03;
  } else if (refK === "nwave") {
    T["flyby"] = G.wakeRatio;
  } else {
    T["click"] = null; T["grit"] = null;            // the impact's own balance (clicks, chips, dust) is the model's
    T["flyby"] = ref > 0 ? G.whineLevel * 2.5 : null;
  }
  const gains = {};
  for (const k in cats) {
    if (k === refK || !(E[k] > 0) || T[k] == null) { gains[k] = 1; continue; }
    gains[k] = Math.sqrt(T[k] * ref / E[k]);
  }
  for (const k in cats) info.energies[k] = ref > 0 ? (E[k] * gains[k] * gains[k]) / ref : E[k];
  info.ref = refK;
  // sum, then a 20 Hz two-pole DC / subsonic block (a microphone's own)
  const oL = new Float32Array(n), oR = new Float32Array(n), hpA = Math.exp(-2 * Math.PI * 20 / sr), list = Object.keys(cats);
  let h1l = 0, h1r = 0, x1l = 0, x1r = 0, h2l = 0, h2r = 0, y1l = 0, y1r = 0;
  for (let i = 0; i < n; i++) {
    let xl = 0, xr = 0;
    for (const k of list) { const g = gains[k]; xl += cats[k][0][i] * g; xr += cats[k][1][i] * g; }
    h1l = hpA * (h1l + xl - x1l); x1l = xl; h2l = hpA * (h2l + h1l - y1l); y1l = h1l;
    h1r = hpA * (h1r + xr - x1r); x1r = xr; h2r = hpA * (h2r + h1r - y1r); y1r = h1r;
    oL[i] = h2l; oR[i] = h2r;
  }
  info.events.sort((a, b) => a[0] - b[0]);
  return { "L": oL, "R": oR, "info": info };
}

// Level a gun foley buffer, in place. PEAK CONTROL first (`peak` 0..2, the patch's gfPeak), exactly energyLevel's: the
// buffer brought to a 0.9 peak and run through the app's own lookahead limiter (limiterProcess) at min(peak, 1), on the
// foley ALONE, before the chain; past 1 it is brought back to 0.9 and limited again at peak - 1 (a supersonic crack is a
// 0.1 ms spike, a shotgun hull's tock and a slide slamming home a few ms each). Then the prototype's own level: RMS
// GF_RMS over the loudest 300 ms, the peak capped at GF_PEAK, so Normalize off still sits it with the other engines.
function gunfoleyLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = GF_RMS / Math.sqrt(best);
  if (pk * g > GF_PEAK) g = GF_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ── Voice (wave "voice", #42) ─────────────────────────────────────────────────────────────────────────────────────
// A person's vocal EFFORT, the 16-bit era's game voice clip: battle cries ("toriya!"), sword cries ("hyaat!"), a jump's
// "hup", hurt grunts, death yells, falling screams. The creature engine (28) holds one call shape and no consonants, the
// formant engine (13) one vowel, speech (17) reads words in a level voice; a game cry is none of those: a consonant, a
// vowel path, a pitch gesture made with effort, and an ending (a glottal stop, a breath out, a creaky "gh"). Prototyped in
// tools/proto/voice.mjs and picked by ear over thirteen rounds (AJ, 2026-11-13, soundtests/proto-voice/); this block is
// that model, unchanged in its maths, with its knobs mapped from the patch by voiceCfg.
//   SCRIPT     a cry is a short script: an onset, a body (vowels, CAPITALS stressed, ":n" lengths, and consonants
//              between them: t k p b d g r y w m n h f s), a coda (! glottal stop, h breath out, gh creak, t k p f s, ~
//              trailing off), a pitch contour, and effort / roughness / breath curves. The Cry types are built-in
//              scripts; "custom" builds one from Onset, Body (the patch's `voBody` text, an SFX_EXTRAS field), Coda,
//              Rise, Fall and Peak at.
//   PLANNER    phones with durations (consonants fixed, vowels share the rest by weight), formant keyframes (a locus per
//              consonant; "h" takes the next sound's mouth), amplitude breakpoints per source (voicing, aspiration,
//              frication), stop bursts, and the f0 contour: effort raising pitch, vowel intrinsic pitch, the kick after a
//              voiceless stop, slow drift and effort tremor (seeded smoothed random walks), an old voice's tremor, voice
//              BREAKS (register jumps) when a rough voice pushes hard. A script may hold its source STEADY, switch the
//              roughness flutter off, forbid random breaks and set its own PRESENCE (the effort shelf's dB).
//   SOURCE     a Rosenberg glottal pulse (polyBLEP closure), open quotient and tilt by effort, jitter and shimmer;
//              roughness as period doubling into logistic chaos plus a random 30-150 Hz flutter; vocal FRY for a hard
//              attack, a glottal stop and a "gh" tail; aspiration riding the open phase.
//   TRACT      a cascade (a nasal pole / zero pair, F1..F5 and neutral resonances to the band edge, coefficients ramped
//              per sample, F1 damped while the glottis is open), a parallel band-pass for frication and bursts, the lips'
//              low-pass, and an effort shelf (a pressed voice is bright). Fall away recedes the voice (level, top, pitch).
//   CHARACTER  Lo-fi: clean -> a hot close-mic saturation (0.5) -> the 16-BIT SAMPLER (0.5 .. 1, the chip gun's S-DSP
//              model): decimated with no filter to 16 .. 6.3 kHz, 4-bit ADPCM blocks, gaussian or (from 0.7) drop-sample
//              playback at 32 kHz, the hardware echo (Echo). "Store follows pitch" stores a higher voice at a higher
//              rate: the sampler's low storage rate damaged the higher voices AJ heard through it.
// Built up front into a MONO buffer (a game clip is mono: centered) at the cry's own length, and levelled once
// (voiceLevel, after its own Peak control, as gunfoleyLevel); the Duration holds it (a longer one adds silence or a
// room's tail, a shorter one cuts it). The AMP ENVELOPE STAYS THE GAIN. Seeded by the patch's own `voSeed` ("which
// take"; the prototype's take seed, its variation 0), never Math.random; not salted per layer, like gfSeed. Cry types,
// voices, onsets and codas are stored as indices: append-only.
const VOICE_CRIES = ["grunt", "hup", "battle cry", "sword cry", "hurt", "big hurt", "death cry", "fall scream", "fear scream", "laugh", "custom"];
const VOICE_DEFAULTS = { "voCry": 2, "voVoice": 0, "voAge": 0.5, "voSize": 1, "voPitch": 0, "voEffort": 0.5, "voLength": 1, "voRough": 0.5,
  "voBreath": 0.5, "voExpress": 1, "voAway": 0, "voLofi": 0, "voEcho": 0, "voStoreFollow": 0, "voOnset": 1, "voCoda": 0, "voRise": 4,
  "voFall": -4, "voPeakAt": 0.3, "voPeak": 0, "voSeed": 41 };
const VO_ONSET_TOK = ["", "'", "h", "t", "k", "p", "b", "d", "g", "r", "y", "w", "m", "n", "h y", "f", "s"];
const VO_CODA_TOK = ["", "!", "h", "gh", "t", "k", "p", "f", "~"];
const VO_SEED_MIX = 0x9e3779b1;     // the prototype's seed mix (its variation 0), so voSeed N renders its take N exactly
const VO_RMS = 0.12;                // voiceLevel: RMS over the loudest 300 ms ...
const VO_PEAK = 0.9;                // ... peak capped here (the prototype's voiceLevel, as glassLevel)
const VO_MAX_BODY = 160;            // characters of a typed Body read
const VO_MAX_WEIGHT = 16;           // the longest ":n" a typed script may ask for
const VO_MAX_SEC = 8;               // the longest a planned cry may be (s)
// The cries. s: the script; dur: s of the whole cry at Length 1; f0: [u, semitones] over the voiced span (before effort's
// own raise); eff / rough / breath: scalars, [start, peak, end] (peak at the f0 contour's highest point) or [[u, v], ...]
// points. Optional: away (it falls away by itself), steady (0..1: the tremor off, drift halved, jitter and shimmer cut),
// flutter (the roughness flutter's scale), randomBreaks (false: never crack), presence (the effort shelf, dB; 13), breaks
// ([[u0, u1, st], ...] scripted cracks). Index 4 ("hurt") and 6 ("death cry") are AJ's picks, not the prototype's first
// scripts (those were heard as "sung" and as "very calm"): the strained "nngh" of hurt-3 (`' n:9 !`, a held, closed-mouth
// strain, the pitch sagging) and death-yell-4's "uwaaagh" (chest voice, steady, no flutter, the fall into creak). Each is
// exactly the script its round built, so a patch naming it renders the picked take.
const VOICE_SCRIPTS = [
  { "s": "' UH gh",              "dur": 0.3,  "f0": [[0, 0], [0.18, 2.5], [1, -4]],                         "eff": 0.75,            "rough": 0.3,  "breath": 0.3 },    // grunt (effort, lifting)
  { "s": "h UH p",               "dur": 0.2,  "f0": [[0, -1], [0.5, 3], [1, 4.5]],                          "eff": 0.65,            "rough": 0.05, "breath": 0.3 },    // hup (a jump)
  { "s": "t oh r EE y AH:5 !",   "dur": 0.95, "f0": [[0, 0], [0.18, 1], [0.32, 4], [0.5, 8], [0.85, 9], [1, 6]], "eff": [0.92, 1, 0.95], "rough": 0.2, "breath": 0.15 }, // battle cry
  { "s": "h y AH:4 t",           "dur": 0.42, "f0": [[0, 3], [0.14, 9], [0.65, 7.5], [1, 3.5]],             "eff": [0.85, 1, 0.9],  "rough": 0.12, "breath": 0.25 },   // sword cry
  { "s": "' n:9 !",              "dur": 0.5,  "f0": [[0, 0], [0.02, 0], [1, -5]],                            "eff": 0.75,            "rough": 0.2,  "breath": 0.25 },   // hurt ("nngh")
  { "s": "' AH:4 uh gh",         "dur": 0.62, "f0": [[0, 6], [0.07, 10], [0.45, 6], [1, -4]],               "eff": [1, 1, 0.6],     "rough": 0.42, "breath": 0.3 },    // big hurt ("aaagh")
  { "presence": 19, "s": "' uu:0.5 AH:5 gh", "dur": 0.66, "f0": [[0, 3.8], [0.07, 8.3], [0.15, 8], [0.6, 6.2], [0.72, 3.5], [1, -7]], "eff": 1, "breath": 0.25,
    "steady": 1, "flutter": 0, "randomBreaks": false, "rough": [[0, 0.5], [0.24, 0.5], [0.36, 0.1], [1, 0.1]] },                                            // death cry ("uwaaagh")
  { "s": "' AH:1 AE:6 ~",        "dur": 1.9,  "f0": [[0, 13], [0.06, 18], [0.3, 16.5], [1, 9]],             "eff": [1, 1, 0.85],    "rough": 0.62, "breath": 0.3, "away": 1 },  // fall scream
  { "s": "' AE:5 h",             "dur": 1.2,  "f0": [[0, 11], [0.08, 18], [0.55, 17], [1, 12]],             "eff": 1,               "rough": 0.72, "breath": 0.3 },    // fear scream
  { "s": "h AH h AH h AH h AH h AH h AH ~", "dur": 1.25, "f0": [[0, 7], [0.2, 6], [1, -1]],                  "eff": [0.7, 0.75, 0.5], "rough": 0.2, "breath": 0.6 },    // laugh
  null,                                                                                                                                                          // custom
];
// adult male vowel targets F1, F2, F3 (Hz), after Hillenbrand et al. 1995; F4 / F5 are neutral.
const VO_VOWELS = {
  "ee": [270, 2290, 3010], "ih": [400, 1990, 2550], "eh": [530, 1840, 2480], "ae": [660, 1720, 2410], "ah": [730, 1090, 2440],
  "aw": [570, 840, 2410], "oh": [500, 910, 2460], "uu": [440, 1020, 2240], "oo": [300, 870, 2240], "uh": [640, 1190, 2390],
  "er": [490, 1350, 1690], "ax": [500, 1450, 2450],
};
const VO_ALIAS = { "a": "ah", "i": "ee", "e": "eh", "o": "oh", "u": "oo" };
// intrinsic pitch: high vowels sit a little higher (semitones)
const VO_IPITCH = { "ee": 0.6, "oo": 0.6, "ih": 0.3, "uu": 0.3, "ah": -0.4, "ae": -0.3, "aw": -0.3 };
// the voices: f0 (Hz, speaking), tract scale, jitter / shimmer / breath bases, the fry rate (Hz)
const VO_KINDS = [
  { "f0": 112, "k": 1.0,  "jit": 0.2,  "shim": 0.2,  "br": 0.15, "fry": 46 },
  { "f0": 205, "k": 1.16, "jit": 0.18, "shim": 0.18, "br": 0.3,  "fry": 62 },
  { "f0": 265, "k": 1.3,  "jit": 0.15, "shim": 0.15, "br": 0.3,  "fry": 75 },
];
const VO_CTL = 32;                 // control rate: targets every 32 samples, coefficients ramped per sample
const VO_NF = 18;                  // formant slots in the cascade (F1..F5 + neutral resonances up to the band edge)
const VO_PRE = 0.012;              // s of silence before the cry
const VO_TAIL = 0.1;               // s after the last phone (the tract rings out)
const VO_ASP = 13;                // aspiration gain into the cascade (calibrated: an "h" at AH 1 ~ -10 dB under an "ah")
const VO_FRIC = 4.4;               // frication gain in the parallel branch (calibrated: an "s" ~ -14 dB under an "ah", an "f" ~ -22)
const VO_SMP_RATE = 32000;         // the sampler's output rate

const voClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const voEase = (x) => 0.5 - 0.5 * Math.cos(Math.PI * voClamp(x, 0, 1));
function voRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const voGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
function voBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// a centered knob: 0 -> none, 0.5 -> the scripted base, 1 -> all the way
const voNudge = (base, knob) => (knob <= 0.5 ? base * knob * 2 : base + (1 - base) * (knob - 0.5) * 2);
// [start, peak, end] or a scalar, at u with the peak at pk
function voShape3(v, u, pk) {
  if (!Array.isArray(v)) return v;
  pk = voClamp(pk, 0.02, 0.98);
  return u < pk ? v[0] + (v[1] - v[0]) * voEase(u / pk) : v[1] + (v[2] - v[1]) * voEase((u - pk) / (1 - pk));
}
// a script value: a scalar, [start, peak, end] (peak at pk), or [[u, v], ...] points (raised-cosine between them)
const voVal = (v, u, pk) => (Array.isArray(v) && Array.isArray(v[0]) ? voCurve(v, u) : voShape3(v, u, pk));
const voMax = (v) => (Array.isArray(v) ? Math.max(...v.map((q) => (Array.isArray(q) ? q[1] : q))) : v);
// piecewise raised-cosine through [u, value] points
function voCurve(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (u <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * voEase((u - a[0]) / (b[0] - a[0] || 1)); }
  return pts[pts.length - 1][1];
}


// ---- the planner: script -> phones -> control tracks ---------------------------------------------------------------
// a ":n" length weight as typed: a typed script is untrusted, so a weight is held to 0.05 .. 16 (every script the picks
// use sits inside that, so they parse as the prototype parsed them); "AH:0" or "AH:." would divide a cry by nothing
const voWeight = (t) => { const w = parseFloat(t); return w > 0 ? Math.min(w, VO_MAX_WEIGHT) : 0.05; };
function voParse(str) {
  const out = [], toks = String(str).trim().split(/[\s\-]+/).filter(Boolean);
  for (const raw of toks) {
    const m = /^([^:]+)(?::([\d.]+))?$/.exec(raw); if (!m) continue;
    const name = m[1], low = name.toLowerCase(), v = VO_VOWELS[low] ? low : VO_ALIAS[low];
    if (v && !(low === "h" || low === "gh")) {
      const stress = name !== low;
      out.push({ "t": "V", "v": v, "stress": stress, "w": m[2] ? voWeight(m[2]) : stress ? 2.5 : 1 });
    } else out.push({ "t": "C", "c": low, "w": m[2] ? voWeight(m[2]) : 1 });   // ":n" on a sonorant holds it n times as long
  }
  // a trailing consonant token is the coda (h, gh, t, k, p, f, s, !, ~); a leading "'" is a hard attack
  let coda = "";
  const last = out[out.length - 1];
  if (last && last["t"] === "C" && ["!", "h", "gh", "t", "k", "p", "f", "s", "~"].includes(last["c"])) { coda = last["c"]; out.pop(); }
  return { "phones": out, "coda": coda };
}

// consonant table: dur (s, at Length 1), AV, AH, AF, fric band, formant targets (male Hz; null = the neighbor vowel's),
// lip (0 closed .. 1 open), nasal, burst {amp, fc, bw} and its aspiration (VOT, s)
const VO_CONS = {
  "h":  { "dur": 0.065, "av": 0, "ah": 1, "F": null, "b1": 2.5 },
  "p":  { "dur": 0.035, "av": 0, "burst": [0.35, 900, 1400], "vot": 0.045, "F": [250, 850, 2200] },
  "t":  { "dur": 0.035, "av": 0, "burst": [0.8, 4600, 3200], "vot": 0.05, "F": [260, 1750, 2650] },
  "k":  { "dur": 0.04,  "av": 0, "burst": [0.75, 0, 1000], "vot": 0.06, "F": null },     // k's burst sits near the vowel's F2
  "b":  { "dur": 0.035, "av": 0.12, "lip": 0.04, "burst": [0.2, 800, 1400], "vot": 0.008, "F": [200, 800, 2200] },
  "d":  { "dur": 0.03,  "av": 0.12, "lip": 0.06, "burst": [0.35, 3800, 2600], "vot": 0.012, "F": [200, 1700, 2600] },
  "g":  { "dur": 0.035, "av": 0.12, "lip": 0.06, "burst": [0.35, 0, 900], "vot": 0.02, "F": null },
  "r":  { "dur": 0.024, "av": 0.35, "F": [330, 1600, 2500], "tap": 1 },
  "rr": { "dur": 0.075, "av": 0.35, "F": [330, 1600, 2500], "tap": 3 },
  "y":  { "dur": 0.05,  "av": 0.85, "F": [260, 2250, 3020] },
  "w":  { "dur": 0.055, "av": 0.8,  "F": [290, 640, 2200], "lip": 0.45 },
  "m":  { "dur": 0.07,  "av": 0.55, "F": [260, 1100, 2250], "lip": 0.05, "nas": 1 },
  "n":  { "dur": 0.065, "av": 0.55, "F": [260, 1600, 2600], "lip": 0.06, "nas": 1 },
  "f":  { "dur": 0.1,   "av": 0, "ah": 0.12, "af": 0.1, "fric": [5200, 7000], "F": null },
  "s":  { "dur": 0.11,  "av": 0, "ah": 0.05, "af": 0.6, "fric": [6300, 2800], "F": null },
  "sh": { "dur": 0.11,  "av": 0, "ah": 0.05, "af": 0.6, "fric": [3300, 2200], "F": null },
};

function voPlan(sr, cfg, seed) {
  const sc = cfg["script"], K = VO_KINDS[cfg["kind"]], age = cfg["age"];
  const rP = voRng(seed ^ 0x68e31da4), rD = voRng(seed ^ 0xb5297a4d), rB = voRng(seed ^ 0x1b56c4e9);
  // ---- the voice
  let f0Base = K["f0"], k = K["k"];
  if (age < 0.5) { const y = (0.5 - age) * 2; f0Base *= 1 + [0.32, 0.08, 0.12][cfg["kind"]] * y; k *= 1 + [0.08, 0.04, 0.08][cfg["kind"]] * y; }
  else { const o = (age - 0.5) * 2; f0Base *= 1 + [0.06, -0.12, 0][cfg["kind"]] * o; }
  const old = Math.max(0, age - 0.5) * 2;
  k /= cfg["size"]; f0Base *= Math.pow(cfg["size"], -0.35);
  f0Base *= Math.pow(2, cfg["pitch"] / 12);
  const vary = (a) => 1 + a * (rP() * 2 - 1);
  // ---- phones and durations
  const { phones, coda } = voParse(sc["s"]);
  const L = cfg["length"], T = sc["dur"] * L * vary(0.07);
  const cdur = (c) => (VO_CONS[c] ? VO_CONS[c]["dur"] + (VO_CONS[c]["vot"] || 0) : 0) * Math.pow(L, 0.4);
  const codaDur = ({ "": 0.07, "!": 0.01, "h": 0.2, "gh": 0.22, "t": 0.11, "k": 0.12, "p": 0.1, "f": 0.13, "s": 0.14, "~": 0.32 }[coda] || 0) * Math.pow(L, 0.6);
  let consT = 0, wsum = 0;
  for (const p of phones) { if (p["t"] === "C") consT += cdur(p["c"]) * (p["w"] || 1); else wsum += p["w"] * vary(0.15); }
  const vowT = Math.max(0.04 * Math.max(1, wsum), T - consT - codaDur * 0.5);
  // ---- tracks at control rate
  // the buffer holds the phones as planned: consonants keep their lengths, so they can outrun the script's own `dur`
  // (a held "n:9"); sized from `T` alone, hurt-3's longer rungs were cut at 0.41 s
  // and no plan is longer than VO_MAX_SEC (a typed script of many held sounds): what does not fit is not rendered
  const total = Math.min(VO_MAX_SEC, VO_PRE + Math.max(T, consT + vowT) + codaDur + VO_TAIL);
  const n = Math.ceil(total * sr), nc = Math.ceil(n / VO_CTL) + 2, tc = (c) => c * VO_CTL / sr;
  const mk = () => new Float32Array(nc);
  const tr = { "F1": mk(), "F2": mk(), "F3": mk(), "F4": mk(), "F5": mk(), "B1": mk(), "AV": mk(), "AH": mk(), "AF": mk(), "fF": mk(), "fB": mk(),
    "nas": mk(), "lip": mk(), "flut": mk(), "f0": mk(), "oq": mk(), "tilt": mk(), "rough": mk(), "fry": mk(), "eff": mk(), "away": mk(), "jit": mk(), "shim": mk() };
  const kf = [];                          // formant keyframes { t, F:[3], b1, lip, nas }
  const amp = { "AV": [[0, 0]], "AH": [[0, 0]], "AF": [[0, 0]] }, fric = [];   // [t, value] breakpoints; fric bands [t0, t1, fc, bw]
  const bursts = [], fryEv = [];          // { t, amp, fc, bw } ; [t0, t1, depth] creak windows
  const set = (key, t, v, ramp) => { const a = amp[key], prev = a[a.length - 1][1]; a.push([t, prev], [t + ramp, v]); };
  const vF = (v) => VO_VOWELS[v].map((f) => f * vary(0.03));
  let t = VO_PRE, voiceStart = -1, voiceEnd = -1, lastVF = null, firstV = null;
  for (const p of phones) if (p["t"] === "V") { firstV = vF(p["v"]); break; }
  const nextVF = (i) => { for (let j = i + 1; j < phones.length; j++) if (phones[j]["t"] === "V") return VO_VOWELS[phones[j]["v"]]; return lastVF || firstV || VO_VOWELS["ax"]; };
  let hardAttack = false, pendingRamp = 0.012, vIdx = 0;
  const vowels = [];
  phones.forEach((p, i) => {
    if (p["t"] === "V") {
      const d = vowT * p["w"] / wsum, F = vF(p["v"]), tr0 = Math.min(0.04, d / 3);
      if (voiceStart < 0) voiceStart = t;
      // a unity-DC cascade makes a close vowel (low F1) ~9 dB quieter than "ah"; real ones differ by ~5: half made up
      set("AV", t, (p["stress"] ? 1 : 0.82) * voClamp(Math.sqrt(730 / VO_VOWELS[p["v"]][0]), 1, 1.6), hardAttack ? 0.003 : pendingRamp);
      set("AH", t, 0, Math.max(0.01, pendingRamp));
      set("AF", t, 0, 0.01);
      if (hardAttack) { fryEv.push([t, t + 0.035, 0.85]); hardAttack = false; }
      kf.push({ "t": t + tr0, "F": F, "b1": 1, "lip": 1, "nas": 0 }, { "t": t + d - tr0, "F": F, "b1": 1, "lip": 1, "nas": 0 });
      vowels.push({ "t0": t, "t1": t + d, "v": p["v"], "stress": p["stress"] });
      lastVF = F; t += d; voiceEnd = t; vIdx++; pendingRamp = 0.012;
      return;
    }
    const c = p["c"];
    if (c === "'") { if (voiceStart < 0) hardAttack = true; else { set("AV", t - 0.006, 0, 0.006); fryEv.push([t - 0.03, t + 0.03, 0.9]); t += 0.035; hardAttack = true; } return; }
    const C = VO_CONS[c]; if (!C) return;
    const s = Math.pow(L, 0.4), nv = nextVF(i), base = C["F"] || nv;
    const Fl = base.map((f, j) => (C["F"] ? 0.7 * f + 0.3 * nv[j] : f));          // a locus pulls toward the vowel
    if (c === "h") {
      set("AV", t, 0, 0.012); set("AH", t, C["ah"], 0.012);
      // an "h" is the NEXT sound's mouth with breath through it: before a glide that is the glide's ("hy" hisses high)
      const nx = phones[i + 1], nC = nx && nx["t"] === "C" ? VO_CONS[nx["c"]] : null;
      kf.push({ "t": t + 0.01, "F": nC && nC["F"] && !nC["burst"] ? nC["F"] : nv, "b1": C["b1"], "lip": 1, "nas": 0 });
      t += C["dur"] * s * (p["w"] || 1); pendingRamp = 0.022; return;
    }
    if (C["burst"]) {
      const clo = C["dur"] * s * (voiceStart < 0 ? 0.6 : 1);
      set("AV", t, C["av"], 0.008); set("AH", t, 0, 0.006);
      kf.push({ "t": t + 0.005, "F": Fl, "b1": 1.6, "lip": C["lip"] == null ? 1 : C["lip"], "nas": 0 });
      t += clo;
      const fc = C["burst"][1] || Math.max(1300, 1.15 * nv[1]);
      bursts.push({ "t": t, "amp": C["burst"][0], "fc": fc, "bw": C["burst"][2] });
      if (c === "k" || c === "g") bursts.push({ "t": t + 0.009, "amp": C["burst"][0] * 0.45, "fc": fc, "bw": C["burst"][2] });
      const vot = C["vot"] * s;
      if (C["av"] === 0) { set("AV", t, 0, 0.001); set("AH", t + 0.002, 0.75, 0.004); }
      kf.push({ "t": t + 0.002, "F": Fl.map((f, j) => 0.5 * f + 0.5 * nv[j]), "b1": 2, "lip": 1, "nas": 0 });
      t += vot; pendingRamp = C["av"] === 0 ? 0.006 : 0.01;
      if (C["av"] === 0) set("AH", t, 0, 0.008);
      return;
    }
    if (C["fric"]) {
      set("AV", t, 0, 0.015); set("AH", t, C["ah"], 0.015); set("AF", t, C["af"], 0.02);
      fric.push([t, t + C["dur"] * s, C["fric"][0] * (k > 1 ? Math.sqrt(k) : 1), C["fric"][1]]);
      kf.push({ "t": t + C["dur"] * s / 2, "F": nv, "b1": 1.5, "lip": 1, "nas": 0 });
      t += C["dur"] * s; set("AF", t, 0, 0.02); pendingRamp = 0.02; return;
    }
    // sonorants: r (tap / trill), y, w, m, n
    const d = C["dur"] * s * (p["w"] || 1);
    if (C["tap"]) {
      const taps = C["tap"], per = d / taps;
      for (let q = 0; q < taps; q++) {
        const a = t + q * per;
        set("AV", a, C["av"], 0.006); set("AV", a + per * 0.55, 0.85, 0.006);
        kf.push({ "t": a + per * 0.4, "F": C["F"], "b1": 1.3, "lip": 1, "nas": 0 });
      }
    } else {
      set("AV", t, C["av"], 0.015);
      kf.push({ "t": t + d * 0.5, "F": C["F"], "b1": 1, "lip": C["lip"] == null ? 1 : C["lip"], "nas": C["nas"] || 0 });
    }
    if (voiceStart < 0) voiceStart = t;
    t += d; voiceEnd = t; pendingRamp = 0.02;
  });
  if (voiceStart < 0) { voiceStart = VO_PRE; voiceEnd = t; }
  // ---- the coda
  const endF = lastVF || VO_VOWELS["ax"], tEnd = t;
  let fryTail = null, tailFall = 0;
  if (coda === "" ) { set("AV", t - 0.04, 0, 0.07); set("AH", t - 0.04, 0, 0.05); }
  else if (coda === "!") { set("AV", t - 0.006, 0, 0.006); set("AH", t - 0.006, 0, 0.005); fryEv.push([t - 0.03, t, 0.8]); }
  else if (coda === "h") {
    set("AV", t - 0.03, 0, 0.04); set("AH", t - 0.03, 0.55, 0.03); set("AH", t + 0.02, 0.3, codaDur * 0.4); set("AH", t + codaDur * 0.45, 0, codaDur * 0.55);
    kf.push({ "t": t + codaDur * 0.6, "F": endF.map((f, j) => f * [0.75, 0.95, 1][j]), "b1": 2.5, "lip": 0.8, "nas": 0 });
    tailFall = -2;
  } else if (coda === "gh") {
    set("AV", t, 0.75, 0.03); set("AV", t + codaDur * 0.75, 0, codaDur * 0.25);
    fryTail = [t - 0.02, t + codaDur]; tailFall = -5;
    kf.push({ "t": t + codaDur * 0.7, "F": [Math.max(450, endF[0] * 0.8), 1250, 2300], "b1": 1.4, "lip": 0.85, "nas": 0 });
    fric.push([t + 0.02, t + codaDur * 0.85, 1700 * Math.sqrt(k), 1100]); set("AF", t + 0.02, 0.07, 0.04); set("AF", t + codaDur * 0.7, 0, codaDur * 0.2);
  } else if (coda === "t" || coda === "k" || coda === "p") {
    const C = VO_CONS[coda], fc = C["burst"][1] || Math.max(1300, 1.1 * endF[1]);
    set("AV", t - 0.008, 0, 0.008); set("AH", t - 0.008, 0, 0.006);
    kf.push({ "t": t + 0.01, "F": C["F"] || endF, "b1": 1.4, "lip": 1, "nas": 0 });
    const tb = t + 0.045 * Math.pow(L, 0.5);
    bursts.push({ "t": tb, "amp": C["burst"][0] * 0.8, "fc": fc, "bw": C["burst"][2] });
    set("AH", tb + 0.002, 0.45, 0.004); set("AH", tb + 0.01, 0, 0.05);
  } else if (coda === "f" || coda === "s") {
    const C = VO_CONS[coda];
    set("AV", t - 0.01, 0, 0.03); set("AH", t, C["ah"] + 0.08, 0.02); set("AF", t - 0.005, C["af"], 0.025);
    fric.push([t - 0.01, t + codaDur, C["fric"][0] * (k > 1 ? Math.sqrt(k) : 1), C["fric"][1]]);
    set("AF", t + codaDur * 0.5, 0, codaDur * 0.5); set("AH", t + codaDur * 0.5, 0, codaDur * 0.5);
  } else if (coda === "~") {
    set("AV", t - 0.05, 0, codaDur); set("AH", t - 0.05, 0.25, 0.05); set("AH", t + codaDur * 0.3, 0, codaDur * 0.7); tailFall = -4;
  }
  const tLast = coda === "" ? tEnd : tEnd + codaDur;
  // ---- the f0 contour over the voiced span; its peak is where effort peaks too
  const pts = sc["f0"].map((q) => q.slice());
  const mean = pts.reduce((a, q) => a + q[1], 0) / pts.length, ex = cfg["express"];
  for (const q of pts) { q[1] = mean + (q[1] - mean) * ex + (rP() * 2 - 1) * 0.6; q[0] = voClamp(q[0] + (q[0] > 0 && q[0] < 1 ? (rP() * 2 - 1) * 0.03 : 0), 0, 1); }
  let pkU = 0, pkV = -1e9; for (const q of pts) if (q[1] > pkV) { pkV = q[1]; pkU = q[0]; }
  const span = Math.max(0.02, voiceEnd - voiceStart);
  // voice breaks: register jumps when a rough voice pushes hard
  const roughBase = voNudge(voMax(sc["rough"]), cfg["rough"]);
  const breaks = [];
  // random breaks; a script may forbid them ("randomBreaks": false: death-yell-4 must never crack UP past ~300 Hz)
  const nBr = sc["randomBreaks"] === false ? 0 : Math.floor(Math.max(0, roughBase - 0.4) * 5 * span * (0.6 + 0.8 * rB()));
  for (const b of sc["breaks"] || []) breaks.push([voiceStart + span * b[0], voiceStart + span * b[1], b[2]]);   // scripted cracks
  for (let q = 0; q < nBr; q++) {
    const a = voiceStart + span * (0.15 + 0.7 * rB()), len = 0.04 + 0.11 * rB();
    breaks.push([a, a + len, (rB() < 0.6 ? 1 : -1) * (3 + 4 * rB())]);
  }
  // drift: two smoothed random walks (slow wander, effort tremor), one value per control tick
  const driftA = 1 - Math.exp(-2 * Math.PI * 3.5 * VO_CTL / sr), tremA = 1 - Math.exp(-2 * Math.PI * 9 * VO_CTL / sr);
  let dS = 0, dS2 = 0, dT = 0, dT2 = 0;
  // ---- fill the tracks
  const evalAmp = (a, x) => { let i = 1; while (i < a.length && a[i][0] < x) i++; if (i >= a.length) return a[a.length - 1][1]; const p0 = a[i - 1], p1 = a[i]; return p1[0] > p0[0] ? p0[1] + (p1[1] - p0[1]) * (x - p0[0]) / (p1[0] - p0[0]) : p1[1]; };
  for (const key in amp) amp[key].sort((p, q) => p[0] - q[0]);
  kf.sort((p, q) => p["t"] - q["t"]);
  const kfAt = (x) => {
    if (!kf.length) return { "F": VO_VOWELS["ax"], "b1": 1, "lip": 1, "nas": 0 };
    if (x <= kf[0]["t"]) return kf[0];
    for (let i = 1; i < kf.length; i++) if (x <= kf[i]["t"]) {
      const a = kf[i - 1], b = kf[i], u = voEase((x - a["t"]) / (b["t"] - a["t"] || 1));
      return { "F": a["F"].map((f, j) => f + (b["F"][j] - f) * u), "b1": a["b1"] + (b["b1"] - a["b1"]) * u, "lip": a["lip"] + (b["lip"] - a["lip"]) * u, "nas": a["nas"] + (b["nas"] - a["nas"]) * u };
    }
    return kf[kf.length - 1];
  };
  const effMul = cfg["effort"], brMul = cfg["breath"], rgMul = cfg["rough"];
  const steady = voClamp(sc["steady"] || 0, 0, 1), flutMul = sc["flutter"] == null ? 1 : voClamp(sc["flutter"], 0, 2);
  const awayOn = cfg["away"] > 0;
  for (let c = 0; c < nc; c++) {
    const x = tc(c), uV = voClamp((x - voiceStart) / span, 0, 1);
    const eff = voClamp(voNudge(voVal(sc["eff"], uV, pkU), effMul), 0, 1);
    const rough = voClamp(voNudge(voVal(sc["rough"], uV, pkU), rgMul) + 0.25 * Math.max(0, eff - 0.9), 0, 1);
    const breath = voClamp(voNudge(voVal(sc["breath"], uV, pkU), brMul) + K["br"] * 0.5 + 0.35 * old, 0, 1.2);
    // formants: keyframes, then effort opens the jaw (F1 up) and a high f0 drags F1 up with it (an open vowel tunes to it)
    const q = kfAt(x);
    // f0
    dS += (voGauss(rD) - dS) * driftA; dS2 += (dS - dS2) * driftA;
    dT += (voGauss(rD) - dT) * tremA; dT2 += (dT - dT2) * tremA;
    let semi = voCurve(pts, uV) + (9 * eff - 2.5);
    if (x > tEnd && tailFall) semi += tailFall * voEase((x - tEnd) / Math.max(0.02, tLast - tEnd));
    for (const v of vowels) if (x >= v["t0"] && x < v["t1"]) semi += VO_IPITCH[v["v"]] || 0;
    for (const b of bursts) if (x > b["t"] && x < b["t"] + 0.06) semi += 1.2 * (1 - (x - b["t"]) / 0.06);   // the kick after a voiceless stop
    for (const br of breaks) if (x > br[0] - 0.012 && x < br[1] + 0.012) semi += br[2] * Math.min(voClamp((x - br[0] + 0.012) / 0.012, 0, 1), voClamp((br[1] + 0.012 - x) / 0.012, 0, 1));
    // "steady" (a script field, 0..1): a strong, held source (death-yell-4: AJ heard round 3's wobble as a 90-year-old):
    // the effort tremor off, the slow drift halved, jitter and shimmer cut to 30% (below)
    semi += dS2 * (0.9 + 1.2 * rough) * 1.4 * (1 - 0.5 * steady) + dT2 * (0.25 + 0.9 * eff * eff) * 1.4 * (1 - steady) + old * 0.45 * Math.sin(2 * Math.PI * 5.2 * x);
    let away = 0;
    if (awayOn) { const ua = voClamp((x - voiceStart - 0.15 * span) / (tLast - voiceStart - 0.15 * span), 0, 1); away = cfg["away"] * ua * ua; semi -= 1.5 * away; }
    const f0 = f0Base * Math.pow(2, semi / 12);
    const f1Boost = 1 + 0.2 * eff;
    let F1 = q["F"][0] * k * f1Boost;
    if (q["lip"] > 0.5 && F1 < 0.95 * f0 && q["F"][0] > 450) F1 = F1 + (0.95 * f0 - F1) * 0.6 * eff;
    tr["F1"][c] = F1; tr["F2"][c] = q["F"][1] * k; tr["F3"][c] = q["F"][2] * k; tr["F4"][c] = 3350 * k; tr["F5"][c] = 3900 * k;
    tr["B1"][c] = q["b1"] * (1 + 0.6 * breath); tr["lip"][c] = q["lip"]; tr["nas"][c] = q["nas"];
    tr["AV"][c] = evalAmp(amp["AV"], x);
    tr["AH"][c] = evalAmp(amp["AH"], x) + breath * 0.1 * tr["AV"][c];     // breath under the voice (an "h" is AH 1)
    tr["AF"][c] = evalAmp(amp["AF"], x);
    let fc = 4000, bw = 3000; for (const f of fric) if (x >= f[0] - 0.03 && x <= f[1] + 0.03) { fc = f[2]; bw = f[3]; }
    tr["fF"][c] = fc; tr["fB"][c] = bw;
    tr["f0"][c] = f0; tr["eff"][c] = eff; tr["rough"][c] = rough; tr["away"][c] = away;
    tr["oq"][c] = 0.78 - 0.38 * eff + 0.08 * Math.max(0, breath - 0.4);
    tr["tilt"][c] = 900 + 9500 * eff * eff;
    let fry = 0;
    for (const e of fryEv) if (x >= e[0] && x < e[1]) fry = Math.max(fry, e[2] * Math.sin(Math.PI * (x - e[0]) / (e[1] - e[0])));
    if (fryTail && x >= fryTail[0]) fry = Math.max(fry, voClamp((x - fryTail[0]) / 0.05, 0, 1));
    tr["fry"][c] = fry;
    tr["jit"][c] = (K["jit"] + 0.5 * old + 0.3 * rough) * (1 - 0.7 * steady); tr["shim"][c] = (K["shim"] + 0.5 * old + 0.3 * rough) * (1 - 0.7 * steady);
    tr["flut"][c] = flutMul;
  }
  return { "presence": sc["presence"] == null ? 13 : sc["presence"], "n": n, "nc": nc, "tr": tr, "bursts": bursts, "f0Base": f0Base, "k": k, "kind": K, "T": T, "tLast": tLast,
    "voiceStart": voiceStart, "voiceEnd": voiceEnd, "breaks": breaks, "vowels": vowels, "phones": phones, "coda": coda };
}

// ---- the render ----------------------------------------------------------------------------------------------------
function voSynth(sr, P, seed) {
  const { n, tr } = P, out = new Float64Array(n);
  const rS = voRng(seed ^ 0x3c6ef372), rN = voRng(seed ^ 0xa54ff53a), rF = voRng(seed ^ 0x510e527f);
  const NYQ = 0.45 * sr, FTOP = 0.95 * NYQ, k = P.k, bwS = Math.sqrt(k);
  // glottis state
  let ph = 0, per = 0, logi = 0.31 + 0.4 * rS(), perScale = 1, ampScale = 1, oq = 0.6, fryOn = 0, fryJit = 0;
  const newPeriod = (c) => {
    per++;
    const rough = tr["rough"][c], sub = voClamp(rough * 2, 0, 1), chaos = voClamp(rough * 2 - 1, 0, 1), fry = tr["fry"][c];
    logi = 3.97 * logi * (1 - logi); if (logi <= 0 || logi >= 1) logi = 0.37;
    const m = (per & 1 ? 1 : -1) * (1 - chaos) + (2 * logi - 1) * chaos;
    const jit = tr["jit"][c] * 0.028 + 0.2 * fry, shim = tr["shim"][c] * 0.22 + 0.45 * fry;
    perScale = voClamp(1 + m * (0.03 * sub + 0.16 * chaos) + voGauss(rS) * jit, 0.55, 1.8);
    ampScale = voClamp((1 + m * (0.45 * sub + 0.35 * chaos)) * (1 + voGauss(rS) * shim), 0.05, 1.7);
    oq = voClamp(tr["oq"][c] - 0.4 * fry + voGauss(rS) * 0.07 * chaos, 0.2, 0.9);
    fryOn = fry; fryJit = voGauss(rS);
  };
  // the cascade: slot 0 nasal pole, 1..NF formants; separate: nasal zero, the parallel frication / burst band-passes
  const NR = VO_NF + 1, y1 = new Float64Array(NR), y2 = new Float64Array(NR), cA = new Float64Array(NR), cB = new Float64Array(NR), cC = new Float64Array(NR);
  const tA = new Float64Array(NR), tB = new Float64Array(NR), tC = new Float64Array(NR), dA = new Float64Array(NR), dB = new Float64Array(NR), dC = new Float64Array(NR);
  const coef = (i, F, BW) => { const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr); tA[i] = 1 - B - C; tB[i] = B; tC[i] = C; };
  let zA = 1, zB = 0, zC = 0, zx1 = 0, zx2 = 0, nForm = 0;
  // F1's bandwidth widens while the glottis is open (the subglottal coupling: Klatt & Klatt 1990's open-phase damping): a
  // second coefficient set for slot 1, blended per sample by a smoothed open-phase gate. Without it F1 rings like a bell.
  let oA = 0, oB = 0, oC = 0, toA = 0, toB = 0, toC = 0, doA = 0, doB = 0, doC = 0, opn = 0;
  // RBJ constant-peak band-pass (0 dB at fc): frication; and the burst's own
  const bp = (fc, bw) => { fc = Math.min(fc, NYQ * 0.98); const w = 2 * Math.PI * fc / sr, Q = Math.max(0.3, fc / Math.max(50, bw)), al = Math.sin(w) / (2 * Q), a0 = 1 + al; return [al / a0, 0, -al / a0, -2 * Math.cos(w) / a0, (1 - al) / a0]; };
  let fq = bp(4000, 3000), fx1 = 0, fx2 = 0, fy1 = 0, fy2 = 0;
  let bq = bp(4000, 3000), bx1 = 0, bx2 = 0, by1 = 0, by2 = 0;
  const brA = Math.exp(-2 * Math.PI * 2500 / sr);
  let brLp = 0;
  // effort brightens the voice: a pressed voice closes faster, so its top rises faster than its level. An RBJ high shelf at
  // 2 kHz, +13 dB x effort^3, on the output (measured: without it a full-effort "AH" kept its 2-4 kHz band 23 dB under its
  // 0-1 kHz band, a speaking voice's balance, because a lower open quotient and a raised F1 lift the bottom as much as the
  // top; a shelf on the SOURCE did the same thing for the same reason)
  let hs = [1, 0, 0, 0, 0], hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
  const shelf = (dB) => { const A = Math.pow(10, dB / 40), w = 2 * Math.PI * 2000 / sr, c = Math.cos(w), al = Math.sin(w) / 2 * 1.4142135623730951, sa = 2 * Math.sqrt(A) * al, a0 = (A + 1) - (A - 1) * c + sa;
    return [A * ((A + 1) + (A - 1) * c + sa) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - sa) / a0, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - sa) / a0]; };
  let tilt = 0, nPrev = 0, lip = 0, la = 0, laT = 0, dla = 0, lvl = 1, lvlT = 1, dlvl = 0, dcx = 0, dcy = 0;
  let av = 0, ah = 0, af = 0, first = true;
  // the roughness flutter: band-passed noise (30-150 Hz), never a sine
  let am1 = 0, am2 = 0, amE = 1e-3, flSS = 0, flN = 0;
  const amW = 2 * Math.PI * 70 / sr, amQ = 0.7, amAl = Math.sin(amW) / (2 * amQ), amA0 = 1 + amAl;
  const amB = [amAl / amA0, -amAl / amA0, -2 * Math.cos(amW) / amA0, (1 - amAl) / amA0];
  let amx1 = 0, amx2 = 0;
  // away: level and a low-pass
  let awLp = 0;
  // bursts: noise envelopes scheduled by sample
  const bs = P.bursts.map((b) => ({ "i": Math.round(b["t"] * sr), "amp": b["amp"], "fc": b["fc"], "bw": b["bw"] })).sort((a, b) => a.i - b.i);
  let bi = 0, bEnv = 0, bDec = Math.exp(-1 / (0.004 * sr));
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / VO_CTL), fr = (i - c * VO_CTL) / VO_CTL;
    if (i % VO_CTL === 0) {
      const f0 = tr["f0"][c], open = tr["lip"][c], nas = tr["nas"][c], bfl = 0.1 * f0;
      // nasal: a pole at 270 Hz (scaled) and a zero that matches it (cancels) unless the nose is open
      const FNP = 270 * k, nbw = Math.max(100 * bwS, bfl);
      coef(0, Math.min(FNP, NYQ), nbw);
      { const F = Math.min(FNP * (1 + 2.2 * nas), NYQ), BW = nbw * (1 + nas); const C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * F / sr); zA = 1 - B - C; zB = B; zC = C; }
      const shut = 1 - open, wide = 1 + 2 * shut * shut;
      const Fs = [tr["F1"][c], tr["F2"][c], tr["F3"][c], tr["F4"][c], tr["F5"][c]];
      let prevF = 0; nForm = 0;
      for (let j = 0; j < VO_NF; j++) {
        let Fi = j < 5 ? Fs[j] : (3900 + 1000 * (j - 4)) * k;
        Fi = Math.max(Fi, prevF + 180 * k); prevF = Fi;
        if (Fi >= FTOP) break;
        let Bi = j === 0 ? 70 * tr["B1"][c] : j === 1 ? 90 : j === 2 ? 130 : 200 + 60 * (j - 3);
        Bi *= j === 0 ? 1 : wide;
        coef(1 + j, Fi, Math.max(Bi * bwS, bfl)); nForm++;
        if (j === 0) { const BW = Math.max(Bi * bwS, bfl) * 2.6 + 60, C = -Math.exp(-2 * Math.PI * BW / sr), B = 2 * Math.exp(-Math.PI * BW / sr) * Math.cos(2 * Math.PI * Fi / sr); toA = 1 - B - C; toB = B; toC = C; }
      }
      fq = bp(tr["fF"][c], tr["fB"][c]);
      hs = shelf(P.presence * Math.pow(tr["eff"][c], 3));
      laT = Math.exp(-2 * Math.PI * Math.min(NYQ, (900 + 10000 * Math.pow(open, 0.8)) * bwS) / sr);
      lvlT = Math.max(0.1 + 0.9 * Math.pow(open, 0.7), 0.5 * nas);
      if (first) { first = false; cA.set(tA); cB.set(tB); cC.set(tC); la = laT; lvl = lvlT; dA.fill(0); dB.fill(0); dC.fill(0); oA = toA; oB = toB; oC = toC; }
      else { const r = 1 / VO_CTL; for (let j = 0; j < NR; j++) { dA[j] = (tA[j] - cA[j]) * r; dB[j] = (tB[j] - cB[j]) * r; dC[j] = (tC[j] - cC[j]) * r; } dla = (laT - la) * r; dlvl = (lvlT - lvl) * r; doA = (toA - oA) * r; doB = (toB - oB) * r; doC = (toC - oC) * r; }
    }
    for (let j = 0; j < NR; j++) { cA[j] += dA[j]; cB[j] += dB[j]; cC[j] += dC[j]; }
    la += dla; lvl += dlvl; oA += doA; oB += doB; oC += doC;
    const lerp = (key) => tr[key][c] + (tr[key][c + 1] - tr[key][c]) * fr;
    const AV = lerp("AV"), AH = lerp("AH"), AF = lerp("AF"), eff = tr["eff"][c], rough = tr["rough"][c];
    av += (AV - av) * 0.2; ah += (AH - ah) * 0.2; af += (AF - af) * 0.2;
    // ---- glottis (fry: the period pulled toward the creak rate)
    let f0 = lerp("f0");
    const fry = tr["fry"][c];
    if (fry > 0) f0 = Math.exp(Math.log(f0) * (1 - fry) + Math.log(P.kind["fry"] * (1 + 0.25 * fryJit)) * fry);
    const dt = Math.min(0.45, f0 / (sr * perScale));
    ph += dt; if (ph >= 1) { ph -= 1; newPeriod(c); }
    const Tp = oq * 2.4 / 3.4, Tn = oq / 3.4;
    let g = 0;
    if (ph < Tp) g = (Tn / Tp) * Math.sin(Math.PI * ph / Tp);
    else if (ph < oq) g = -Math.sin(Math.PI * (ph - Tp) / (2 * Tn));
    let trc = ph - oq; if (trc < 0) trc += 1;
    g += 0.5 * voBlep(trc, dt);
    g *= ampScale;
    const tA1 = Math.exp(-2 * Math.PI * tr["tilt"][c] / sr);
    tilt = (1 - tA1) * g + tA1 * tilt;
    const voiced = (0.15 + 0.45 * eff) * g + (0.85 - 0.45 * eff) * tilt * 2.2;
    const nz = rN() * 2 - 1, nHp = nz - nPrev; nPrev = nz;
    const gate = ph < oq ? 1 : 0.3, voicing = Math.min(1, av * 3);
    const asp = nHp * ah * VO_ASP * ((1 - voicing) + voicing * (0.25 + 0.75 * gate) * (0.6 + 0.4 * ampScale));
    let x = av * voiced + asp * 0.12;
    // ---- tract
    x = cA[0] * x + cB[0] * y1[0] + cC[0] * y2[0]; y2[0] = y1[0]; y1[0] = x;
    { const z = (x - zB * zx1 - zC * zx2) / zA; zx2 = zx1; zx1 = x; x = z; }
    opn += ((ph < oq && av > 0.05 ? 1 : 0) - opn) * 0.25;
    let y = x;
    if (nForm > 0) { const A1 = cA[1] + (oA - cA[1]) * opn, B1 = cB[1] + (oB - cB[1]) * opn, C1 = cC[1] + (oC - cC[1]) * opn; const v = A1 * y + B1 * y1[1] + C1 * y2[1]; y2[1] = y1[1]; y1[1] = v; y = v; }
    for (let j = 2; j <= nForm; j++) { const v = cA[j] * y + cB[j] * y1[j] + cC[j] * y2[j]; y2[j] = y1[j]; y1[j] = v; y = v; }
    lip = (1 - la) * y + la * lip;
    let o = lip * lvl;
    { const v = hs[0] * o + hs[1] * hx1 + hs[2] * hx2 - hs[3] * hy1 - hs[4] * hy2; hx2 = hx1; hx1 = o; hy2 = hy1; hy1 = v; o = v; }
    // ---- parallel: the breath's top (turbulence above the formants, which the cascade would filter out): asp high-passed
    brLp = (1 - brA) * asp + brA * brLp; o += (asp - brLp) * 0.05;
    // ---- parallel: frication and bursts (true band-passes)
    if (af > 1e-4) { const w = (rF() * 2 - 1) * af * VO_FRIC; const v = fq[0] * w + fq[2] * fx2 - fq[3] * fy1 - fq[4] * fy2; fx2 = fx1; fx1 = w; fy2 = fy1; fy1 = v; o += v; }
    while (bi < bs.length && bs[bi].i <= i) { bEnv = bs[bi].amp; bq = bp(bs[bi].fc, bs[bi].bw); bi++; }
    if (bEnv > 1e-4) { const w = (rF() * 2 - 1) * bEnv * 1.6; const v = bq[0] * w + bq[2] * bx2 - bq[3] * by1 - bq[4] * by2; bx2 = bx1; bx1 = w; by2 = by1; by1 = v; o += v; bEnv *= bDec; }
    // ---- roughness flutter (30-150 Hz, random)
    if (rough > 0.3 && tr["flut"][c] > 0) {
      const w = rN() * 2 - 1, v = amB[0] * w + amB[1] * amx2 - amB[2] * am1 - amB[3] * am2; amx2 = amx1; amx1 = w; am2 = am1; am1 = v;
      amE += (v * v - amE) * 0.0005;
      const d = voClamp((rough - 0.3) * 1.1, 0, 0.6) * tr["flut"][c], gm = d * voClamp(v / Math.sqrt(amE + 1e-12), -2.5, 2.5) * 0.4;
      o *= 1 + gm;
      if (av > 0.1) { flSS += gm * gm; }
    }
    if (av > 0.1) flN++;
    // ---- away
    const away = tr["away"][c];
    if (away > 0) { const a = Math.exp(-2 * Math.PI * 14000 * Math.pow(2, -2.6 * away) / sr); awLp = (1 - a) * o + a * awLp; o = awLp / (1 + 9 * away); }
    const dc = o - dcx + 0.9975 * dcy; dcx = o; dcy = dc;
    out[i] = dc;
  }
  P.flutterRms = Math.sqrt(flSS / Math.max(1, flN));     // the applied 30-150 Hz flutter: RMS of the gain's deviation while voiced
  return out;
}

// ---- the character stage -------------------------------------------------------------------------------------------
function voOnePole(x, sr, fc, high) {
  const a = Math.exp(-2 * Math.PI * fc / sr); let s = 0;
  for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; x[i] = high ? x[i] - s : s; }
}
function voPeakTo(x, p) { let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i])); if (pk > 0) for (let i = 0; i < x.length; i++) x[i] *= p / pk; return pk; }
// a hot, close mic: tanh drive, a high-pass and a low-pass (one-pole: gentle)
function voSaturate(x, sr, amt) {
  voPeakTo(x, 0.9);
  const kd = 1 + 3 * amt, nrm = Math.tanh(kd);
  voOnePole(x, sr, 60 + 140 * amt, true);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(kd * x[i]) / nrm;
  voOnePole(x, sr, 16000 - 8500 * amt, false);
}
// BRR: 4-bit ADPCM, 16 samples a block, shift 0..12 and predictor 0..3 per block (copied from chipgun.mjs cgBrr)
function voBrr(x) {
  const n = Math.ceil(x.length / 16) * 16, pcm = new Float64Array(n), out = new Int16Array(n);
  for (let i = 0; i < x.length; i++) pcm[i] = voClamp(Math.round(x[i] * 16383), -16384, 16383);
  const pred = (f, p1, p2) => (f === 0 ? 0 : f === 1 ? p1 * 15 / 16 : f === 2 ? p1 * 61 / 32 - p2 * 15 / 16 : p1 * 115 / 64 - p2 * 13 / 16);
  let p1 = 0, p2 = 0, blocks = 0; const use = [0, 0, 0, 0];
  for (let b = 0; b < n; b += 16) {
    let best = null;
    for (let f = 0; f < 4; f++) for (let sh = 0; sh <= 12; sh++) {
      let a1 = p1, a2 = p2, err = 0; const dec = new Int16Array(16);
      for (let q = 0; q < 16; q++) {
        const pr = pred(f, a1, a2), nib = voClamp(Math.round((pcm[b + q] - pr) * 2 / Math.pow(2, sh)), -8, 7);
        const y = voClamp(Math.round(nib * Math.pow(2, sh) / 2 + pr), -16384, 16383);
        dec[q] = y; err += (y - pcm[b + q]) * (y - pcm[b + q]); a2 = a1; a1 = y;
        if (best && err >= best.err) break;
      }
      if (!best || err < best.err) best = { "err": err, "dec": dec, "f": f };
    }
    out.set(best.dec, b); p1 = best.dec[15]; p2 = best.dec[14]; blocks++; use[best.f]++;
  }
  return { "pcm": out, "blocks": blocks, "use": use };
}
// the 16-bit sampler: s = 0..1 (Lo-fi 0.5..1). Returns a new buffer of length n and what it did.
function voSampler(x, sr, s, echo, follow, f0max) {
  const n = x.length;
  // the "recording" at 32 kHz (linear: the clean voice is band-limited)
  const m32 = Math.floor(n * VO_SMP_RATE / sr), src = new Float64Array(m32);
  for (let j = 0; j < m32; j++) { const p = j * sr / VO_SMP_RATE, q = Math.floor(p), f = p - q; src[j] = x[q] + ((x[q + 1] || 0) - x[q]) * f; }
  // the storage rate; with `follow`, a higher voice is stored higher (x sqrt(f0 / 150 Hz), up to 1.8x, never over 16 kHz)
  const store = Math.round(Math.min(16000, 16000 * Math.pow(2, -1.35 * s) * (1 + (follow || 0) * (voClamp(Math.sqrt((f0max || 150) / 150), 1, 1.8) - 1))));
  const ratio = VO_SMP_RATE / store, m = Math.floor(m32 / ratio), dec = new Float64Array(m);
  for (let j = 0; j < m; j++) { const p = j * ratio, q = Math.floor(p); dec[j] = (src[q] + (src[Math.min(m32 - 1, q + 1)] || 0)) / 2; }
  voPeakTo(dec, 0.95);
  const brr = voBrr(dec), smp = brr.pcm, hold = s >= 0.4, sigma = 0.63, step = store / VO_SMP_RATE, vol = 120 / 127;
  const nOut = Math.ceil(n * VO_SMP_RATE / sr) + 2, mix = new Float64Array(nOut);
  let pos = 0;
  for (let j = 0; j < nOut; j++) {
    const i0 = Math.floor(pos), f = pos - i0;
    if (i0 >= smp.length) break;
    let y;
    if (!hold) { let ws = 0, acc = 0; for (let d = -1; d <= 2; d++) { const w = Math.exp(-((d - f) * (d - f)) / (2 * sigma * sigma)), q = i0 + d; ws += w; acc += w * (q >= 0 && q < smp.length ? smp[q] : 0); } y = acc / ws; }
    else y = smp[i0];
    mix[j] = voClamp(Math.trunc(y * vol), -32768, 32767) / 16384;
    pos += step;
  }
  if (echo > 0) {
    const D = (2 + Math.round(3 * echo)) * 512, fbk = 0.2 + 0.3 * echo, wet = 0.18 + 0.32 * echo;
    const fir = [0.35, 0.25, 0.16, 0.1, 0.07, 0.04, 0.02, 0.01], eb = new Float64Array(D), hist = new Float64Array(8);
    let w = 0;
    for (let j = 0; j < nOut; j++) {
      for (let q = 7; q > 0; q--) hist[q] = hist[q - 1]; hist[0] = eb[w];
      let e = 0; for (let q = 0; q < 8; q++) e += fir[q] * hist[q];
      eb[w] = voClamp(mix[j] + e * fbk, -2, 2); w = (w + 1) % D;
      mix[j] += e * wet;
    }
  }
  const out = new Float64Array(n), st = VO_SMP_RATE / sr;
  for (let i = 0; i < n; i++) { const p = i * st, q = Math.floor(p), f = p - q; out[i] = hold ? mix[q] : mix[q] + ((mix[q + 1] || 0) - mix[q]) * f; }
  voOnePole(out, sr, 25, true);
  return { "out": out, "store": store, "blocks": brr.blocks, "use": brr.use, "hold": hold };
}

// The patch -> the cry. Knobs read with VOICE_DEFAULTS behind them; `voBody` is a string (an SFX_EXTRAS field, "" = "AH").
function voiceCfg(st) {
  const g = (k) => (st[k] == null ? VOICE_DEFAULTS[k] : st[k]);
  const cry = voClamp(Math.round(g("voCry")), 0, VOICE_SCRIPTS.length - 1);
  let sc = VOICE_SCRIPTS[cry];
  if (!sc) {                       // custom: the ingredients
    const pk = voClamp(g("voPeakAt"), 0.02, 0.98);
    sc = { "s": [VO_ONSET_TOK[voClamp(Math.round(g("voOnset")), 0, VO_ONSET_TOK.length - 1)], String(st["voBody"] || "AH").slice(0, VO_MAX_BODY),
      VO_CODA_TOK[voClamp(Math.round(g("voCoda")), 0, VO_CODA_TOK.length - 1)]].join(" "),
      "dur": 0.5, "f0": [[0, 0], [pk, g("voRise")], [1, g("voRise") + g("voFall")]], "eff": 0.75, "rough": 0.2, "breath": 0.25 };
  }
  return {
    "script": sc, "cry": VOICE_CRIES[cry], "kind": voClamp(Math.round(g("voVoice")), 0, 2), "age": voClamp(g("voAge"), 0, 1),
    "size": voClamp(g("voSize"), 0.6, 1.6), "pitch": g("voPitch"), "effort": voClamp(g("voEffort"), 0, 1), "length": voClamp(g("voLength"), 0.3, 3),
    "rough": voClamp(g("voRough"), 0, 1), "breath": voClamp(g("voBreath"), 0, 1), "express": voClamp(g("voExpress"), 0, 3),
    "away": voClamp(g("voAway") + (sc["away"] || 0), 0, 1),             // a fall scream falls away by itself
    "lofi": voClamp(g("voLofi"), 0, 1), "echo": voClamp(g("voEcho"), 0, 1), "storeFollow": voClamp(g("voStoreFollow"), 0, 1),
    "seed": Math.max(0, Math.round(g("voSeed"))),
  };
}

// One cry at its own length: { L, R (mono: the same samples), n, info }. The prototype's makeVoice with its take seed as
// `cfg.seed` and its variation 0.
function makeVoice(sr, cfg) {
  const base = ((cfg["seed"] >>> 0) ^ VO_SEED_MIX) >>> 0;
  const P = voPlan(sr, cfg, base);
  // an echo needs room to ring out
  const echoPad = cfg["lofi"] > 0.5 && cfg["echo"] > 0 ? Math.round((0.12 + 0.35 * cfg["echo"]) * sr) : 0;
  let x = voSynth(sr, P, base);
  if (echoPad) { const y = new Float64Array(x.length + echoPad); y.set(x); x = y; }
  const info = { "cry": cfg["cry"], "f0Base": P.f0Base, "k": P.k, "T": P.T, "breaks": P.breaks.length, "flutterPct": 100 * P.flutterRms, "lofi": "clean", "store": 0, "f0max": 0,
    "phones": P.phones.map((p) => p["t"] === "V" ? (p["stress"] ? p["v"].toUpperCase() : p["v"]) : p["c"]).join(" ") + (P.coda ? " |" + P.coda : "") };
  const lo = cfg["lofi"];
  if (lo > 0) {
    voSaturate(x, sr, Math.min(1, lo / 0.5));
    info["lofi"] = "saturation";
    if (lo > 0.5) {
      let f0max = 0; for (let c = 0; c < P.nc; c++) if (P.tr["AV"][c] > 0.25 && P.tr["fry"][c] < 0.5) f0max = Math.max(f0max, P.tr["f0"][c]);
      const r = voSampler(x, sr, (lo - 0.5) / 0.5, cfg["echo"], cfg["storeFollow"], f0max);
      x = r.out;
      info["lofi"] = "sampler"; info["store"] = r.store; info["f0max"] = f0max;
    }
  }
  const n = x.length, fo = Math.min(n, Math.floor(0.01 * sr));
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= i / fo;
  info["len"] = n / sr;
  return { "L": Float32Array.from(x), "R": Float32Array.from(x), "n": n, "info": info };
}

// Level a cry once: Peak control (0 = off; up to 1 the app's own lookahead limiter squeezes the first instants once, past
// 1 again: a hard attack or a glottal click), then RMS VO_RMS over the loudest 300 ms with the peak capped at VO_PEAK.
// With Peak 0 this is the prototype's voiceLevel exactly. In place.
function voiceLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = VO_RMS / Math.sqrt(best);
  if (pk * g > VO_PEAK) g = VO_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

// ── Melee (wave "melee", #43) ─────────────────────────────────────────────────────────────────────────────────────
// A weapon swung and LANDING in something: swords, axes, hammers, fists, kicks, daggers, spears, whips. Of the 52 Hits /
// Melee presets, 32 were the whoosh engine (20) alone, so no blade ever landed in anything; the rest an impact (19) or a
// modal bank (10). A melee hit is two or three events, the SWING, the CONTACT into a material and the BODY's weight (for
// a clash, two blades ringing and sliding along each other), and this engine builds those, in that order. Prototyped in
// tools/proto/melee.mjs and picked by ear (AJ, 2026-11-13/14, soundtests/proto-melee/); this block is that model,
// unchanged in its maths, with its knobs read from the patch by meleeCfg.
//   SWING    air past the weapon: K = 6 stations along it, each shedding vortices at the Strouhal frequency 0.2 v / d
//            (a katana's 3.5 mm edge whistles at ~1.9 kHz at the tip, a hammer's head "whumphs" broad and low), the tip
//            dominating (v^2.5), a Doppler tilt and a pan across; it STOPS at the contact or FOLLOWS THROUGH, slowing, by
//            the target. Spins whirl it first; a whip's tip passes the speed of sound (an N-wave crack).
//   CONTACT  the TARGET (flesh, cloth / leather, mail, plate, a wooden shield, stone, ground, a steel blade) times the HIT
//            (edge, blunt, point): a recipe of components set to target ENERGIES (fibers tearing, a wet squelch, bubbles,
//            a force pulse and the skin's slap, mail's tiny rings, plate's beating shell modes through the contact's
//            spectrum, a plank disc's boom, stone chips, dirt, and for a clash both blades' free-free beam modes and the
//            scrape), the flesh under armor, and the WEAPON ringing by how hard the target is.
//   BODY     the weight: a sine whose pitch drops, by how much the target gives. THUMP is the designed weight (a sub that
//            drops like a kick drum and a mid whump, never reduced by the target, with a slap crack); BONE crunch a dry
//            crackle; SNAP a clipped click on the contact; EXAGGERATE the fighting-game end (the swing swelling into the
//            hit, a longer, lower body with a sub boom, a bright saturated crack).
//   CRUNCH   the gun's stage: each group saturated (asymmetric tanh, 4x oversampled, each back to its own energy), a
//            compressor whose detector is high-passed at 150 Hz (the contact drives it; the body rides under), Peak
//            control on the HIT alone (before the swing joins, so the swing-to-hit balance holds), the THUMP added around
//            the compressor, the swing joined after it, the place (an impulse response from geometry), a final soft clip
//            by Crunch, bits and a sample-and-hold rate cut. Trimmed where it falls 60 dB under its peak.
// Built up front into a stereo buffer ending at the patch's Duration (with a 40 ms fade: a preset's Duration is where its
// blow ends; past the room the engine's buffer allows, silence) and levelled once over it (meleeLevel: RMS ML_RMS over the
// loudest 300 ms, the peak capped at ML_PEAK), exactly as the prototype rendered every take with a duration; a take
// rendered without one (trimmed where it fell 60 dB under its peak) is that length as a Duration. The AMP ENVELOPE STAYS
// THE GAIN. Seeded by the patch's own `meleeSeed` ("which take"; the prototype's take seed), never
// Math.random; own LCGs per component, so a level knob never reshuffles anything. Weapon, Target, Hit and Place are
// stored as indices: append-only.
// CPU (2026-11-14): the prototype ran every stage over a buffer sized for the longest room (2.6 s past the hit, more with a
// place). The port skips, EXACTLY, what that only multiplied by silence: the saturator runs the span that holds sound and
// skips the tanh of a sub-sample too small to move its bias, the compressor and the limiter stop at the last sound, the
// detector stops once it has decayed under 1e-300, and an unfiltered knock is only as long as its pulse. Sample-identical
// to the prototype on every take of every round (sign of zero included) and on 150 random patches; the room's FFT
// convolution is NOT trimmed (its rounding depends on its size), so it is most of what is left.
const MELEE_HITS = ["auto", "edge", "blunt", "point"];
const MELEE_PLACES = ["dry", "room", "stone hall", "outdoors", "cave"];
const MELEE_DEFAULTS = { "meleeWeapon": 2, "meleeTarget": 1, "meleeHit": 0, "meleeWeight": 0.5, "meleeSpeed": 0.5, "meleeSwing": 0.5,
  "meleeContact": 0.8, "meleeBody": 0.6, "meleeRing": 0.4, "meleeScrape": 0.3, "meleeSnap": 0.4, "meleeHype": 0, "meleeThump": 0,
  "meleeBone": 0, "meleeSpins": 1, "meleePeak": 0, "meleeCrunch": 0.3, "meleeComp": 0.5, "meleeBits": 0, "meleeRateCut": 0,
  "meleePlace": 0, "meleeTail": 0.3, "meleeSeed": 0 };
const ML_RMS = 0.12;                // meleeLevel: RMS over the loudest 300 ms ...
const ML_PEAK = 0.9;                // ... the peak capped here
const ML_DET_HP = 150;             // the compressor's detector is high-passed here (Hz): the contact drives it, the body rides under
// THE WEAPONS. len (m), d = the width the air sees (m), broad 0 a thin edge .. 1 a club, v = tip speed (m/s) at Speed 0.5,
// Ts = the swing's length (s) at Speed 0.5, hit = the default, strike = contact-time multiplier (soft fist, wooden staff),
// whistle = a tonal edge whistle, blade = beam modes { f1, lo, hi, n } or head = fixed modes { fs, tau }.
const ML_WEAPONS = [
  { "len": 0.65, "d": 0.09,   "broad": 1,    "v": 10, "Ts": 0.11, "hit": "blunt", "strike": 3,   "whistle": 0,   "huff": 1 },
  { "len": 0.30, "d": 0.004,  "broad": 0.15, "v": 13, "Ts": 0.12, "hit": "point", "strike": 0.8, "whistle": 0.3, "blade": { "f1": 120, "lo": 2500, "hi": 11000, "n": 8 } },
  { "len": 0.90, "d": 0.005,  "broad": 0.3,  "v": 28, "Ts": 0.22, "hit": "edge",  "strike": 1,   "whistle": 0.45, "blade": { "f1": 42, "lo": 900, "hi": 8000, "n": 12 } },
  { "len": 0.95, "d": 0.0035, "broad": 0.12, "v": 33, "Ts": 0.19, "hit": "edge",  "strike": 0.9, "whistle": 1,   "blade": { "f1": 38, "lo": 1200, "hi": 9000, "n": 12 } },
  { "len": 0.80, "d": 0.03,   "broad": 0.65, "v": 22, "Ts": 0.28, "hit": "edge",  "strike": 1.3, "whistle": 0.1, "head": { "fs": [1450, 2630, 3870, 5200], "tau": 0.07 } },
  { "len": 0.85, "d": 0.07,   "broad": 1,    "v": 17, "Ts": 0.32, "hit": "blunt", "strike": 1.6, "whistle": 0,   "head": { "fs": [1850, 2950, 4300, 6100], "tau": 0.05 } },
  { "len": 2.00, "d": 0.025,  "broad": 0.45, "v": 11, "Ts": 0.16, "hit": "point", "strike": 1.2, "whistle": 0.2, "thrust": 1, "head": { "fs": [2400, 4100, 6050], "tau": 0.05 } },
  { "len": 2.60, "d": 0.006,  "broad": 0.25, "v": 20, "Ts": 0.32, "hit": "edge",  "strike": 1,   "whistle": 0.2, "crack": 1 },
  { "len": 1.80, "d": 0.032,  "broad": 0.75, "v": 20, "Ts": 0.26, "hit": "blunt", "strike": 1.8, "whistle": 0,   "head": { "fs": [260, 710, 1380, 2250], "tau": 0.035 } },
  { "len": 0.95, "d": 0.12,   "broad": 1,    "v": 12, "Ts": 0.16, "hit": "blunt", "strike": 3.5, "whistle": 0,   "huff": 1, "mass": 1.4 },   // a kick: a leg, heavier and slower than a fist
  { "len": 1.10, "d": 0.08,   "broad": 1,    "v": 20, "Ts": 0.30, "hit": "blunt", "strike": 1.4, "whistle": 0,   "chain": 1, "head": { "fs": [1650, 2700, 3900], "tau": 0.04 } },   // a flail: a ball on a chain, the links rattling
  { "len": 1.00, "d": 0.003,  "broad": 0.08, "v": 26, "Ts": 0.13, "hit": "point", "strike": 0.7, "whistle": 0.7, "thrust": 1, "blade": { "f1": 60, "lo": 1800, "hi": 11000, "n": 10 } },   // a rapier: long, thin, thrust
];
// THE TARGETS. tau = contact time for a steel striker (s), give = the body's share (how much the target lets the blow
// through as weight), stop = how much it stops the swing (0 a blade through flesh .. 1 steel on steel), wring = how hard
// it rings the weapon, under = how much of a blow reaches the flesh under it
const ML_TARGETS = [
  null,
  { "tau": 0.004,   "give": 1,    "stop": 0.1,  "wring": 0.02, "under": 0 },      // flesh
  { "tau": 0.002,   "give": 0.9,  "stop": 0.35, "wring": 0.06, "under": 0.6 },    // cloth / leather
  { "tau": 0.0004,  "give": 0.8,  "stop": 0.7,  "wring": 0.35, "under": 0.35 },   // mail
  { "tau": 0.00012, "give": 0.5,  "stop": 1,    "wring": 0.6,  "under": 0.06 },   // plate
  { "tau": 0.0006,  "give": 0.7,  "stop": 0.85, "wring": 0.15, "under": 0 },      // wooden shield
  { "tau": 0.00008, "give": 0.55, "stop": 1,    "wring": 0.9,  "under": 0 },      // stone
  { "tau": 0.003,   "give": 1,    "stop": 0.9,  "wring": 0.1,  "under": 0 },      // ground
  { "tau": 0.00008, "give": 0.35, "stop": 1,    "wring": 1,    "under": 0 },      // steel blade (a clash)
];
const ML_PRE = 0.01;
const mlClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function mlRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const mlGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
const mlPan = (p) => { const a = (mlClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
const mlSeed = (seed, k, salt) => (Math.imul((seed + 1) >>> 0, 2654435761) ^ Math.imul(k + 7, 40503) ^ Math.imul(salt + 13, 9973)) >>> 0;
const mlW = (f, tau) => 1 / Math.sqrt(1 + Math.pow(1.6 * f * tau, 4));   // a contact of length tau reaches f this well

// knobs -> physics
function meleeCfg(st) {
  const g = (k) => (st[k] == null ? MELEE_DEFAULTS[k] : st[k]);
  const wi = mlClamp(Math.round(g("meleeWeapon")), 0, ML_WEAPONS.length - 1), W = ML_WEAPONS[wi];
  const ti = mlClamp(Math.round(g("meleeTarget")), 0, ML_TARGETS.length - 1);
  const hi = mlClamp(Math.round(g("meleeHit")), 0, 3), hit = hi === 0 ? W.hit : MELEE_HITS[hi];
  const sp = mlClamp(g("meleeSpeed"), 0, 1), hype = mlClamp(g("meleeHype"), 0, 1);
  const Ts = W.Ts * (1.45 - 0.9 * sp) * (1 + 0.25 * hype), v = W.v * (0.6 + 0.8 * sp);
  const sw = g("meleeSwing"), whiff = ti === 0;
  // the contact lands just after the swing's loudest point (a thrust at full extension)
  const land = W.crack ? 1 : W.thrust ? 0.86 : 0.72;
  // SPINS: the earlier revolutions come first, each a little longer than the last (the whirl accelerates into the blow),
  // overlapping by a fifth; the final arc is the one that lands
  const spins = mlClamp(Math.round(g("meleeSpins")), 1, 4), arcs = [];
  let ta = ML_PRE;
  for (let k = 0; k < spins - 1; k++) { const Ta = Ts * (1 + 0.12 * (spins - 1 - k)); arcs.push({ "t0": ta, "Ts": Ta, "g": 0.55 + 0.3 * k / Math.max(1, spins - 1) }); ta += Ta * 0.8; }
  const tS = ML_PRE, tLast = ta, tc = whiff ? -1 : sw > 0 || W.crack ? tLast + Ts * land : ML_PRE;
  return {
    "dur": st.duration || 0, "width": st.width == null ? 0.6 : st.width,
    "wi": wi, "W": W, "ti": ti, "T": ML_TARGETS[ti], "hit": hit, "whiff": whiff,
    "weight": mlClamp(g("meleeWeight"), 0, 1), "speed": sp, "swing": sw, "contact": g("meleeContact"), "body": g("meleeBody"),
    "ring": mlClamp(g("meleeRing"), 0, 1), "scrape": g("meleeScrape"), "snap": g("meleeSnap"), "hype": hype,
    "crunch": g("meleeCrunch"), "comp": g("meleeComp"), "bits": g("meleeBits"), "rateCut": g("meleeRateCut"),
    "place": mlClamp(Math.round(g("meleePlace")), 0, MELEE_PLACES.length - 1), "tail": g("meleeTail"),
    "thump": mlClamp(g("meleeThump"), 0, 1), "bone": mlClamp(g("meleeBone"), 0, 1),
    "Ts": Ts, "v": v, "land": land, "tS": tS, "tc": tc, "tLast": tLast, "arcs": arcs, "spins": spins, "peak": mlClamp(g("meleePeak"), 0, 2),
  };
}

// ---- small DSP pieces
function mlAddCont(buf, sr, t0, len, f, gain) {   // a continuous waveform, box-integrated at 16 sub-samples
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
function mlSvf() { return { "a": 0, "b": 0 }; }
function mlSvfTick(f, x, g, k, out) {   // TPT state-variable filter: out = [lp, bp (unity peak), hp]
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.b, v1 = a1 * f.a + a2 * v3, v2 = f.b + a2 * f.a + a3 * v3;
  f.a = 2 * v1 - f.a; f.b = 2 * v2 - f.b; out[0] = v2; out[1] = k * v1; out[2] = x - k * v1 - v2;
}
const mlG = (fc, sr) => Math.tan(Math.PI * mlClamp(fc, 5, sr * 0.45) / sr);
const mlBuf = (n) => ({ "L": new Float64Array(n), "R": new Float64Array(n) });
function mlPut(o, i, v, pg) { if (i >= 0 && i < o.L.length) { o.L[i] += v * pg[0]; o.R[i] += v * pg[1]; } }
// damped modes as beating PAIRS (two partials f -+ split/2, 0.55 / 0.45, the two placed a little apart)
function mlRing(o, sr, t0, fs, amps, taus, splits, gain, pan, spread, attack) {
  const n = o.L.length, i0 = Math.max(0, Math.round(t0 * sr)), at = Math.max(1, Math.round((attack || 0.00005) * sr));
  for (let m = 0; m < fs.length; m++) {
    const parts = splits && splits[m] > 0 ? [[fs[m] - splits[m] / 2, 0.55, -1], [fs[m] + splits[m] / 2, 0.45, 1]] : [[fs[m], 1, 0]];
    for (const [f, share, side] of parts) {
      if (!(f > 0) || f >= 0.45 * sr) continue;
      const pg = mlPan(pan + side * spread), a = amps[m] * share * gain, r = Math.exp(-1 / (taus[m] * sr)), w = 2 * Math.PI * f / sr;
      const len = Math.min(n - i0, Math.ceil(7 * taus[m] * sr));
      // s_j = a r^j sin(w j), by a rotating phasor (renormalized every 1024 samples)
      const cr = Math.cos(w), sr2 = Math.sin(w);
      let re = 1, im = 0, e = a;
      for (let j = 0; j < len; j++) {
        const v = e * im * (j < at ? j / at : 1);
        o.L[i0 + j] += v * pg[0]; o.R[i0 + j] += v * pg[1];
        const nr = re * cr - im * sr2; im = re * sr2 + im * cr; re = nr; e *= r;
        if ((j & 1023) === 1023) { const q = 1 / Math.hypot(re, im); re *= q; im *= q; }
      }
    }
  }
}
// noise burst: through an SVF (mode 0 lp, 1 bp, 2 hp) at fc (or a sweep fc(t)), exponential decay tau, attack att s
function mlBurst(o, sr, t0, tau, fc, k, mode, gain, pan, rnd, att, fcEnd) {
  const n = o.L.length, i0 = Math.round(t0 * sr), len = Math.min(n - i0, Math.ceil(7 * tau * sr)), pg = mlPan(pan);
  const f = mlSvf(), out = [0, 0, 0], dk = Math.exp(-1 / (tau * sr)), a = Math.max(1, Math.round((att || 0) * sr));
  let e = gain, g = mlG(fc, sr);
  for (let j = 0; j < len; j++) {
    if (fcEnd && (j & 15) === 0) g = mlG(fc * Math.pow(fcEnd / fc, Math.min(1, j / (3 * tau * sr))), sr);
    mlSvfTick(f, rnd() * 2 - 1, g, k, out);
    mlPut(o, i0 + j, out[mode] * e * (j < a ? j / a : 1), pg); e *= dk;
  }
}
// a train of grains (fibers tearing, chips, dirt): count grains, density falling over span (most land early), each
// noise through a band-pass at a log-uniform fc in [fLo, fHi], length ~gLen, a 1-sample attack (a crackle)
function mlGrains(o, sr, t0, span, count, fLo, fHi, gLen, gain, rnd, pan, spread, k) {
  for (let q = 0; q < count; q++) {
    const u = -Math.log(1 - rnd() * (1 - Math.exp(-3))) / 3, t = t0 + span * u;
    const fc = fLo * Math.pow(fHi / fLo, rnd()), len = gLen * (0.5 + rnd()), a = gain * Math.exp(0.7 * mlGauss(rnd)) * (1 - 0.6 * u);
    mlBurst(o, sr, t, len, fc, k || 1.2, 1, a, pan + spread * (rnd() * 2 - 1), rnd, 0);
  }
}
// tiny metal rings (mail links): each two damped sines and a tick
function mlTinkles(o, sr, t0, span, count, fLo, fHi, gain, rnd, pan, spread) {
  for (let q = 0; q < count; q++) {
    const u = -Math.log(1 - rnd() * (1 - Math.exp(-2.5))) / 2.5, t = t0 + span * u, f = fLo * Math.pow(fHi / fLo, rnd());
    const a = gain * Math.exp(0.6 * mlGauss(rnd)) * (1 - 0.5 * u), tau = 0.004 + 0.02 * rnd(), p = pan + spread * (rnd() * 2 - 1);
    mlRing(o, sr, t, [f, f * (1.45 + 0.9 * rnd())], [1, 0.5], [tau, tau * 0.6], null, a, p, 0, 0.00003);
    mlBurst(o, sr, t, 0.0004, Math.min(9000, 1.5 * f), 1.2, 1, a * 0.7, p, rnd, 0);
  }
}
// a raised-cosine force pulse of length tau and a softer rebound (the knock), optionally low-passed
// (CPU, exact: unfiltered, the buffer is only as long as the pulse. Filtered, the low-pass decays into the smallest
// numbers a double holds and then sits on a FIXED POINT (its input 0, y and y2 unchanged by a step) for the rest of the
// buffer, so from there every sample is that same value, and so is what it adds: computed once.)
function mlKnock(o, sr, t0, tau, gain, pan, lpHz) {
  const n = o.L.length, iP = Math.min(n, Math.ceil((t0 + tau * 3) * sr) + 1);
  const tmp = new Float64Array(lpHz ? n : Math.max(0, iP)), pg = mlPan(pan);
  mlAddCont(tmp, sr, t0, tau * 3, (t) => (t < tau ? Math.pow(Math.sin(Math.PI * t / tau), 2) : -0.35 * Math.pow(Math.sin(Math.PI * (t - tau) / (2 * tau)), 2)), gain);
  let end = tmp.length;
  if (lpHz) {
    const a = Math.exp(-2 * Math.PI * Math.min(lpHz, 0.45 * sr) / sr); let y = 0, y2 = 0;
    for (let i = 0; i < tmp.length; i++) {
      const py = y, py2 = y2; y = tmp[i] * (1 - a) + y * a; y2 = y * (1 - a) + y2 * a; tmp[i] = y2;
      if (i >= iP && y === py && y2 === py2) { end = i + 1; break; }
    }
  }
  for (let i = 0; i < end; i++) if (tmp[i]) { o.L[i] += tmp[i] * pg[0]; o.R[i] += tmp[i] * pg[1]; }
  if (end < tmp.length && tmp[end - 1]) { const v = tmp[end - 1], vl = v * pg[0], vr = v * pg[1]; for (let i = end; i < n; i++) { o.L[i] += vl; o.R[i] += vr; } }
}
// the WET squelch: noise through a band-pass whose fc falls fA -> fB over dur, Q-ish k, its level wobbling (a smoothed
// random walk at ~40 Hz), a 4 ms rise and a (1 - u)^1.5 fall
function mlSquelch(o, sr, t0, dur, fA, fB, k, gain, pan, rnd) {
  const n = o.L.length, i0 = Math.round(t0 * sr), N = Math.min(n - i0, Math.round(dur * sr)), pg = mlPan(pan);
  const f = mlSvf(), out = [0, 0, 0], aw = Math.exp(-2 * Math.PI * 40 / sr), at = Math.round(0.004 * sr);
  let g = mlG(fA, sr), w = 0, w2 = 0;
  for (let j = 0; j < N; j++) {
    const u = j / N;
    if ((j & 15) === 0) g = mlG(fA * Math.pow(fB / fA, Math.pow(u, 0.6)), sr);
    mlSvfTick(f, rnd() * 2 - 1, g, k, out);
    w = (rnd() * 2 - 1) * (1 - aw) + w * aw; w2 = w * (1 - aw) + w2 * aw;
    const env = (j < at ? j / at : 1) * Math.pow(1 - u, 1.5) * Math.max(0.15, 1 + 9 * w2);
    mlPut(o, i0 + j, out[1] * env * gain, pg);
  }
}
// bubbles: damped sines whose pitch RISES over their life (a bubble's, as it nears the surface)
function mlBubbles(o, sr, t0, span, count, fLo, fHi, gain, rnd, pan) {
  for (let q = 0; q < count; q++) {
    const t = t0 + span * Math.pow(rnd(), 1.3), f0 = fLo * Math.pow(fHi / fLo, rnd()), tau = 0.003 + 0.005 * rnd(), rise = 0.15 + 0.3 * rnd();
    const i0 = Math.round(t * sr), len = Math.min(o.L.length - i0, Math.ceil(6 * tau * sr)), pg = mlPan(pan + 0.4 * (rnd() - 0.5));
    let ph = 0, e = gain * (0.5 + rnd());
    const dk = Math.exp(-1 / (tau * sr));
    for (let j = 0; j < len; j++) { ph += 2 * Math.PI * f0 * (1 + rise * j / (6 * tau * sr)) / sr; mlPut(o, i0 + j, Math.sin(ph) * e, pg); e *= dk; }
  }
}
// a SCRAPE: noise through narrow band-passes at the given modes, each weighted by where the moving contact point is
// (x slides xA -> xB over dur: the "shiing" sweeps), plus the friction hiss (high-passed, stick-slip lumpy)
function mlScrape(o, sr, t0, dur, fs, amps, gain, rnd, pan, xA, xB, hiss) {
  const n = o.L.length, i0 = Math.round(t0 * sr), N = Math.min(n - i0, Math.round(dur * sr)), pg = mlPan(pan);
  const M = fs.filter((f) => f < 0.45 * sr).length, F = [], out = [0, 0, 0], fh = mlSvf(), gh = mlG(4200, sr);
  for (let m = 0; m < M; m++) F.push(mlSvf());
  const rise = Math.max(1, Math.round(0.006 * sr));
  let stick = 0;
  for (let j = 0; j < N; j++) {
    const u = j / N, x = xA + (xB - xA) * u, env = (j < rise ? j / rise : 1) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.5 + 0.5 * u)), 0.7);
    if (rnd() < 0.004) stick = 1;   // stick-slip: lumps in the friction
    stick *= 0.995;
    const ex = (rnd() * 2 - 1) * (1 + 2.5 * stick);
    let s = 0;
    for (let m = 0; m < M; m++) {
      mlSvfTick(F[m], ex, mlG(fs[m], sr), 0.03, out);
      s += out[1] * amps[m] * (0.15 + 0.85 * Math.abs(Math.sin(Math.PI * (2 * m + 3) * x * 0.5)));
    }
    mlSvfTick(fh, ex, gh, 1.0, out);
    mlPut(o, i0 + j, (s * 3 + out[2] * hiss) * env * gain, pg);
  }
}
// a blade's ring: free-free beam modes f1 ((2k+1)/3)^2 in [lo, hi], weighted by the contact point x, through the
// contact's spectrum; steel's loss + the hands' damping; beating pairs
function mlBladeModes(B, x, tauC, ring, rnd, detune) {
  const fs = [], amps = [], taus = [], splits = [];
  for (let k = 1; k < 80; k++) {
    const f = B.f1 * detune * Math.pow((2 * k + 1) / 3, 2) * (1 + 0.012 * mlGauss(rnd));
    if (f < B.lo) continue; if (f > B.hi) break;
    fs.push(f);
    amps.push((0.2 + 0.8 * Math.abs(Math.sin((2 * k + 1) * Math.PI * x / 2))) * mlW(f, tauC) * Math.pow(f / B.lo, -0.25));
    const tInt = 2.2 / (3e-4 * f) / 6.91, tHold = 0.04 + 0.5 * Math.pow(ring, 1.5);
    taus.push(1 / (1 / tInt + 1 / tHold) * (0.7 + 0.6 * rnd()));
    splits.push(0.4 + 3 * rnd());
  }
  // keep at most n, spread across the band
  if (fs.length > B.n) { const step = fs.length / B.n, idx = []; for (let q = 0; q < B.n; q++) idx.push(Math.floor(q * step)); return { "fs": idx.map((i) => fs[i]), "amps": idx.map((i) => amps[i]), "taus": idx.map((i) => taus[i]), "splits": idx.map((i) => splits[i]) }; }
  return { "fs": fs, "amps": amps, "taus": taus, "splits": splits };
}
function mlHeadModes(H, tauC, ring, rnd) {
  return { "fs": H.fs.map((f) => f * (1 + 0.02 * mlGauss(rnd))), "amps": H.fs.map((f, i) => (1 - 0.15 * i) * mlW(f, tauC)),
    "taus": H.fs.map((f, i) => H.tau * (0.5 + 1.2 * ring) * (1 - 0.12 * i)), "splits": H.fs.map(() => 0.5 + 2 * rnd()) };
}
// a target's own modes: [ratios, base f, base taus], pairs split by the given range
const ML_PLATE = { "r": [1, 1.53, 2.17, 2.62, 3.31, 3.98, 4.71, 5.62, 6.67], "f": 420, "t": [0.32, 0.28, 0.25, 0.22, 0.19, 0.16, 0.14, 0.12, 0.1], "split": [3, 9] };
const ML_WOOD = { "r": [1, 1.59, 2.14, 2.65, 3.16, 3.65, 4.6, 6.1, 8.3], "f": 135, "t": [0.09, 0.075, 0.06, 0.05, 0.045, 0.04, 0.03, 0.025, 0.02], "split": [0.5, 2] };
const ML_RIM = { "r": [1, 1.64, 2.32, 3.04], "f": 1250, "t": [0.18, 0.14, 0.11, 0.08], "split": [1, 4] };
const ML_STONE = { "r": [1, 1.65, 2.56, 3.42, 4.71, 6.35], "f": 520, "t": [0.022, 0.018, 0.014, 0.012, 0.01, 0.008], "split": [0, 0] };
function mlTargetModes(S, tauC, tMul, rnd, fMul) {
  return { "fs": S.r.map((r) => S.f * (fMul || 1) * r * (1 + 0.015 * mlGauss(rnd))), "amps": S.r.map((r, i) => (1 - 0.06 * i) * mlW(S.f * r, tauC)),
    "taus": S.t.map((t) => t * tMul * (0.85 + 0.3 * rnd())), "splits": S.r.map(() => S.split[0] + (S.split[1] - S.split[0]) * rnd()) };
}

// ---- THE RECIPES: target x hit -> components { bus, E (energy share of the contact), tag, render(o) }
function mlRecipe(c, seed) {
  const out = [], tc = c.tc, sr = c.sr, w = c.weight, W = c.W, T = c.T, hit = c.hit, ti = c.ti;
  let salt = 100;
  const add = (bus, E, tag, fn) => { if (E > 0) { const rnd = mlRng(mlSeed(seed, 0, salt++)); out.push({ "bus": bus, "E": E, "tag": tag, "render": (o) => fn(o, rnd) }); } else salt++; };
  const tauB = T.tau * W.strike * (0.7 + 0.6 * w);                   // a blunt contact
  const tauE = Math.min(tauB, 0.00035 * W.strike);                   // an edge's first instant
  const tauP = Math.min(tauB, 0.0002 * W.strike);                    // a point's
  const P = 0.1;                                                     // the contact's pan
  const flesh = (k, h, t0) => {                                      // the flesh recipe (also what lies under armor)
    if (h === "edge") {
      add("ct", 0.12 * k, "flesh: the edge's entry", (o, r) => mlBurst(o, sr, t0, 0.003, 5200, 0.9, 1, 1, P, r, 0.0002));
      add("ct", 0.28 * k, "flesh: fibers tearing", (o, r) => mlGrains(o, sr, t0 + 0.002, 0.06 + 0.04 * w, 26 + Math.round(20 * w), 1200, 5000, 0.0007, 1, r, P, 0.25));
      add("ct", 0.42 * k, "flesh: the wet squelch", (o, r) => mlSquelch(o, sr, t0 + 0.003, 0.08 + 0.06 * w, 1400, 350, 0.6, 1, P, r));
      add("ct", 0.06 * k, "flesh: bubbles", (o, r) => mlBubbles(o, sr, t0 + 0.01, 0.08, 5, 500, 1600, 1, r, P));
      add("ct", 0.18 * k, "flesh: the cut's knock", (o, r) => mlKnock(o, sr, t0, 0.0012 + 0.002 * w, 1, P, 2500));
    } else if (h === "blunt") {
      add("ct", 0.6 * k, "flesh: the force pulse (thup)", (o, r) => mlKnock(o, sr, t0, Math.max(0.003, tauB), 1, P, 900));
      add("ct", 0.32 * k, "flesh: the skin's slap", (o, r) => mlBurst(o, sr, t0 + 0.0005, 0.005, 3800, 0.75, 1, 1, P, r, 0.0003));
      add("ct", 0.08 * k, "flesh: cloth flap", (o, r) => mlGrains(o, sr, t0, 0.03, 10, 1500, 6000, 0.0008, 1, r, P, 0.3));
    } else {
      add("ct", 0.08 * k, "flesh: the point's tick", (o, r) => mlBurst(o, sr, t0, 0.0006, 6500, 1.0, 1, 1, P, r, 0));
      add("ct", 0.12 * k, "flesh: the skin's pop", (o, r) => mlRing(o, sr, t0 + 0.0008, [1600, 2700], [1, 0.4], [0.006, 0.003], null, 1, P, 0, 0.0004));
      add("ct", 0.45 * k, "flesh: the push (a lower squelch)", (o, r) => mlSquelch(o, sr, t0 + 0.004, 0.11 + 0.06 * w, 900, 240, 0.45, 1, P, r));
      add("ct", 0.12 * k, "flesh: the blade's flat sliding in", (o, r) => mlSquelch(o, sr, t0 + 0.002, 0.1, 4200, 2600, 1.0, 1, P, r));
      add("ct", 0.05 * k, "flesh: bubbles", (o, r) => mlBubbles(o, sr, t0 + 0.02, 0.09, 3, 400, 1200, 1, r, P));
      add("ct", 0.15 * k, "flesh: the knock", (o, r) => mlKnock(o, sr, t0, 0.002 + 0.002 * w, 1, P, 1500));
    }
    if (w > 0.4) add("ct", 0.3 * k * (w - 0.4) / 0.6, "flesh: bone cracking", (o, r) => {
      mlGrains(o, sr, t0 + 0.004, 0.03, 8 + Math.round(10 * w), 350, 2400, 0.0015, 1, r, P, 0.2);
      for (let q = 0; q < 2; q++) mlKnock(o, sr, t0 + 0.006 + 0.012 * r(), 0.00015, 1.5, P, 0);
    });
  };
  const wRing = (E) => {                                             // the WEAPON's own ring
    if (!(E > 0)) return;
    if (W.blade) add("rg", E, "the weapon rings (blade)", (o, r) => { const m = mlBladeModes(W.blade, 0.3, tauE, c.ring, r, 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, -0.15, 0.25); });
    else if (W.head) add("rg", E, "the weapon rings (head)", (o, r) => { const m = mlHeadModes(W.head, tauE, c.ring, r); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, -0.1, 0.15); });
  };
  const ringE = 0.6 * c.ring;
  if (W.chain) add("rg", 0.15, "the flail's chain jangling", (o, r) => mlTinkles(o, sr, tc + 0.002, 0.06, 20, 2000, 6000, 1, r, -0.1, 0.5));
  if (ti === 1) flesh(1, hit, tc);
  else if (ti === 2) {   // cloth / leather
    if (hit === "edge") { add("ct", 0.22, "leather: the hide's knock", (o, r) => mlKnock(o, sr, tc, 0.0018, 1, P, 1800)); add("ct", 0.5, "leather: the rip", (o, r) => mlGrains(o, sr, tc + 0.001, 0.07 + 0.03 * w, 50 + Math.round(30 * w), 900, 6000, 0.0006, 1, r, P, 0.3)); }
    else if (hit === "blunt") { add("ct", 0.5, "leather: the knock", (o, r) => mlKnock(o, sr, tc, Math.max(0.002, tauB), 1, P, 1200)); add("ct", 0.3, "leather: the slap", (o, r) => mlBurst(o, sr, tc + 0.0005, 0.008, 2200, 0.8, 1, 1, P, r, 0.0004)); }
    else { add("ct", 0.1, "leather: the point's tick", (o, r) => mlBurst(o, sr, tc, 0.0006, 6000, 1, 1, 1, P, r, 0)); add("ct", 0.3, "leather: the puncture's pop", (o, r) => mlRing(o, sr, tc + 0.0006, [900, 1700], [1, 0.4], [0.008, 0.004], null, 1, P, 0, 0.0005)); }
    flesh(T.under, hit, tc + 0.006);
    wRing(ringE * T.wring);
  } else if (ti === 3) {   // mail
    const n = hit === "point" ? 14 : 30 + Math.round(25 * w);
    add("ct", hit === "blunt" ? 0.5 : 0.15, "mail: the knock", (o, r) => mlKnock(o, sr, tc, Math.max(0.0004, hit === "blunt" ? tauB * 3 : tauE), 1, P, hit === "blunt" ? 1200 : 0));
    add("ct", hit === "blunt" ? 0.35 : 0.5, "mail: the links (" + n + " tiny rings)", (o, r) => mlTinkles(o, sr, tc + 0.001, 0.05 + 0.04 * w, n, 2500, 9000, 1, r, P, 0.5));
    if (hit !== "blunt") add("ct", 0.14, "mail: links snapping", (o, r) => { for (let q = 0; q < 4; q++) mlKnock(o, sr, tc + 0.002 + 0.02 * r(), 0.00008, 1, P + 0.3 * (r() - 0.5), 0); });
    if (hit === "edge" && c.scrape > 0) add("rg", 0.15 * c.scrape, "mail: the edge dragging over the links", (o, r) => mlGrains(o, sr, tc + 0.01, 0.08, 40, 3000, 9000, 0.0004, 1, r, P, 0.4));
    flesh(hit === "blunt" ? 0.6 : T.under, hit, tc + 0.008);
    wRing(ringE * T.wring);
  } else if (ti === 4) {   // plate
    const tauC = hit === "blunt" ? Math.max(0.0003, tauB * 2) : hit === "edge" ? 0.00012 : 0.0001;
    add("rg", hit === "point" ? 0.4 : 0.6, hit === "blunt" ? "plate: the BONG (a shell's modes, beating pairs, struck dull)" : "plate: the CLANG (a shell's modes, beating pairs)",
      (o, r) => { const m = mlTargetModes(ML_PLATE, tauC, 0.25 + 0.9 * c.ring, r, hit === "blunt" ? 0.85 : 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, P, 0.35); });
    add("ct", hit === "blunt" ? 0.4 : 0.1, "plate: the knock", (o, r) => mlKnock(o, sr, tc, tauC, 1, P, 0));
    if (hit === "blunt") add("ct", 0.1, "plate: the dent (low clicks)", (o, r) => mlGrains(o, sr, tc + 0.002, 0.02, 6, 300, 1500, 0.002, 1, r, P, 0.1));
    if (hit !== "blunt") add("rg", (hit === "point" ? 0.45 : 0.3) * Math.max(0.2, c.scrape), "plate: the " + hit + " skidding off",
      (o, r) => { const m = mlTargetModes(ML_PLATE, 0.0001, 1, r, 1); mlScrape(o, sr, tc + 0.004, (hit === "point" ? 0.09 : 0.05) + 0.12 * c.scrape, m.fs.slice(3), m.amps.slice(3), 1, r, P, 0.2, 0.7, 0.4); });
    flesh(T.under, hit, tc + 0.004);
    wRing(ringE * T.wring);
  } else if (ti === 5) {   // wooden shield
    const tauC = hit === "blunt" ? Math.max(0.0008, tauB * 1.5) : hit === "edge" ? 0.0006 : 0.0004;
    add("ct", hit === "point" ? 0.4 : 0.55, hit === "blunt" ? "shield: the BOOM (a plank disc's modes)" : "shield: the THOCK (a plank disc's modes)",
      (o, r) => { const m = mlTargetModes(ML_WOOD, tauC, 1, r, hit === "point" ? 1.6 : 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, P, 0.2, 0.0003); });
    add("ct", hit === "blunt" ? 0.35 : 0.22, "shield: the knock", (o, r) => mlKnock(o, sr, tc, tauC, 1, P, 3000));
    if (hit !== "blunt") add("ct", hit === "edge" ? 0.25 : 0.1, "shield: fibers splitting", (o, r) => { mlGrains(o, sr, tc + 0.003, 0.03, 12, 900, 4500, 0.0009, 1, r, P, 0.2); for (let q = 0; q < 3; q++) mlKnock(o, sr, tc + 0.004 + 0.02 * r(), 0.0002, 0.8, P, 0); });
    if (hit === "point") add("ct", 0.1, "shield: the shaft quivering", (o, r) => mlRing(o, sr, tc + 0.006, [128, 290], [1, 0.3], [0.08, 0.04], [7, 3], 1, P, 0.1, 0.004));
    add("rg", 0.3 * c.ring, "shield: the iron rim / boss", (o, r) => { const m = mlTargetModes(ML_RIM, tauC * 0.4, 0.4 + 1.2 * c.ring, r); mlRing(o, sr, tc + 0.0005, m.fs, m.amps, m.taus, m.splits, 1, P, 0.2); });
    wRing(ringE * T.wring);
  } else if (ti === 6) {   // stone
    add("ct", 0.35, "stone: the knock (very hard)", (o, r) => mlKnock(o, sr, tc, Math.max(0.00008, hit === "blunt" ? tauB : tauE * 0.5), 1, P, 0));
    add("ct", 0.25, "stone: its dead modes", (o, r) => { const m = mlTargetModes(ML_STONE, 0.0002, 1, r); mlRing(o, sr, tc, m.fs, m.amps, m.taus, null, 1, P, 0); });
    add("ct", hit === "blunt" ? 0.35 : 0.3, hit === "blunt" ? "stone: the crumble" : "stone: chips",
      (o, r) => mlGrains(o, sr, tc + 0.002, hit === "blunt" ? 0.15 : 0.05, hit === "blunt" ? 45 : 22, hit === "blunt" ? 900 : 2000, hit === "blunt" ? 6000 : 9000, 0.0008, 1, r, P, 0.5));
    if (hit === "edge") add("rg", 0.2 * Math.max(0.3, c.scrape), "stone: the edge skidding", (o, r) => mlScrape(o, sr, tc + 0.003, 0.06 + 0.1 * c.scrape, [2300, 3400, 4700, 6100], [1, 0.8, 0.6, 0.5], 1, r, P, 0.2, 0.6, 1.2));
    wRing(ringE * T.wring * 1.2);
  } else if (ti === 7) {   // ground
    add("ct", 0.6, "ground: the thump", (o, r) => mlKnock(o, sr, tc, Math.max(0.003, tauB), 1, P, 350));
    add("ct", 0.4, "ground: dirt", (o, r) => { mlGrains(o, sr, tc + 0.003, 0.18, 45, 700, 4500, 0.001, 1, r, P, 0.6); mlBurst(o, sr, tc + 0.002, 0.04, 1500, 0.9, 0, 0.6, P, r, 0.004); });
    if (hit === "edge") add("ct", 0.15, "ground: the bite into soil", (o, r) => mlSquelch(o, sr, tc + 0.001, 0.05, 2600, 1200, 1.0, 1, P, r));
    wRing(ringE * T.wring);
  } else if (ti === 8) {   // a CLASH, steel on steel
    const B2 = W.blade ? W.blade : ML_WEAPONS[2].blade;   // the other blade: a sword, if the weapon has none
    add("ct", 0.12, "clash: the contact click", (o, r) => mlKnock(o, sr, tc, 0.00008, 1, 0, 0));
    if (W.blade) add("rg", 0.5, "clash: the weapon's blade rings (beam modes, beating pairs)", (o, r) => { const m = mlBladeModes(W.blade, 0.32, 0.00008, c.ring, r, 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, -0.25, 0.3); });
    else wRing(0.5);
    add("rg", 0.45, "clash: the other blade rings (detuned, struck elsewhere)", (o, r) => { const m = mlBladeModes(B2, 0.57, 0.00008, c.ring, r, 0.93 + 0.03 * r()); mlRing(o, sr, tc + 0.0002, m.fs, m.amps, m.taus, m.splits, 1, 0.3, 0.3); });
    if (c.scrape > 0) add("rg", 0.45 * c.scrape, "clash: the edges sliding (the scrape)", (o, r) => {
      const a = mlBladeModes(W.blade || B2, 0.3, 0.0001, 0.5, r, 1), b = mlBladeModes(B2, 0.55, 0.0001, 0.5, r, 0.94);
      const fs = a.fs.concat(b.fs).filter((f) => f > 1400 && f < 8000), am = fs.map(() => 0.6 + 0.4 * r());
      mlScrape(o, sr, tc + 0.006, 0.06 + 0.26 * c.scrape, fs, am, 1, r, 0.05, 0.15, 0.8, 0.5);
    });
  }
  return out;
}

// ---- the SWING into a stereo buffer (and, for a whip, the crack)
function mlSwing(o, sr, c, rnd) {
  for (const a of c.arcs || []) {   // the earlier revolutions of a whirl: whole arcs, nothing hit
    const tmp = mlBuf(o.L.length); mlArc(tmp, sr, Object.assign({}, c, { "tLast": a.t0, "Ts": a.Ts, "whiff": true }), rnd);
    for (let i = 0; i < tmp.L.length; i++) { o.L[i] += tmp.L[i] * a.g; o.R[i] += tmp.R[i] * a.g; }
  }
  const r = mlArc(o, sr, c, rnd);
  if (c.W.chain) mlTinkles(o, sr, c.tS + 0.02, (c.tLast - c.tS) + c.Ts * 0.8, 10 + 6 * (c.arcs || []).length, 2200, 5000, 0.12, rnd, 0, 0.6);   // the chain
  return r;
}
function mlArc(o, sr, c, rnd) {
  const W = c.W, K = 6, t0 = c.tLast, Ts = c.Ts, hype = c.hype, n = o.L.length;
  const i0 = Math.round(t0 * sr), follow = c.whiff ? 1 : 1 - c.T.stop;
  const tEnd = c.whiff ? Ts : (c.tc - t0) + (follow > 0.05 ? 0.12 * follow + 0.04 : 0.003);
  const N = Math.min(n - i0, Math.round(tEnd * sr)), up = 0.62 + 0.13 * hype, iC = Math.round((c.tc - t0) * sr);
  const panA = rnd() < 0.5 ? -0.55 : 0.55, Fs = [], Q = 1.2 + 14 * W.whistle * (1 - W.broad);
  for (let k = 0; k < K; k++) Fs.push(mlSvf());
  const fh = mlSvf(), out = [0, 0, 0], gs = new Float64Array(K), rk = [];
  for (let k = 0; k < K; k++) rk.push(0.35 + 0.65 * k / (K - 1));
  let v = 0, gH = 1;
  for (let j = 0; j < N; j++) {
    const t = j / sr, u = t / Ts;
    // omega(u): a rise to `up` and a fall (a thrust rises fast and stops)
    let wv = u < up ? Math.pow(Math.sin(Math.PI / 2 * u / up), W.thrust ? 0.7 : 1.6) : Math.pow(Math.max(0, Math.cos(Math.PI / 2 * (u - up) / (1 - up))), 1.2);
    let amp = 1;
    if (!c.whiff && j >= iC) {   // the contact: stopped, or following through and slowing
      const dt = (j - iC) / sr;
      amp = follow > 0.05 ? (follow * Math.exp(-dt / (0.035 + 0.04 * follow))) + (1 - follow) * Math.max(0, 1 - dt / 0.003) : Math.max(0, 1 - dt / 0.003);
      wv *= follow > 0.05 ? Math.exp(-dt / 0.08) : 1;
    }
    v = c.v * wv;
    if ((j & 7) === 0) {
      const dop = 1 + 0.12 * (c.v / 30) * (1 + hype) * Math.cos(Math.PI * Math.min(1, u));
      for (let k = 0; k < K; k++) gs[k] = mlG(mlClamp(0.2 * v * rk[k] / W.d * dop, 180, 9000), sr);
      gH = mlG(mlClamp(0.4 * v / W.d * dop, 400, 12000), sr);
    }
    const x = rnd() * 2 - 1;
    let s = 0;
    for (let k = 0; k < K; k++) { mlSvfTick(Fs[k], x * (0.8 + 0.4 * rnd()), gs[k], 1 / Q, out); s += out[1] * Math.pow(rk[k] * wv, 2.5); }
    mlSvfTick(fh, x, gH, 1.0, out);
    s += out[2] * 0.25 * Math.pow(wv, 3) * (1 - W.broad * 0.6);
    const p = panA * (1 - 2 * Math.min(1, u)) * (0.6 + 0.4 * hype);
    mlPut(o, i0 + j, s * amp * (j < 32 ? j / 32 : 1), mlPan(p));
  }
  if (W.huff) mlGrains(o, sr, t0, Ts, 14, 1500, 6000, 0.001, 0.4, rnd, 0, 0.5);   // the sleeve
  return { "N": N, "tEnd": tEnd };
}
function mlWhipCrack(o, sr, t0, gain, rnd) {
  const tmp = new Float64Array(o.L.length), T = 0.0003;
  mlAddCont(tmp, sr, t0, T, (t) => 1 - 2 * t / T, 1);
  for (let i = 0; i < tmp.length; i++) if (tmp[i]) { o.L[i] += tmp[i] * gain; o.R[i] += tmp[i] * gain; }
  mlBurst(o, sr, t0 + 0.0002, 0.0025, 3500, 0.8, 2, gain * 0.25, 0.05, rnd, 0);
  mlRing(o, sr, t0 + 0.0003, [2900, 4700], [1, 0.5], [0.002, 0.0015], null, gain * 0.12, 0, 0, 0.00005);
}

// asymmetric tanh, 4x oversampled, on a peak-normalized STEREO pair, then back to the energy it had over [w0, w1)
// CPU, exact: a sub-sample too small to move the bias saturates to exactly 0 (tanh(d bias) less tb, the same expression),
// so its tanh is skipped, and a sample whose sub-samples all are (it and the one before both under 2^-56 of the bias) is 0
// outright (the decaying tails are thousands of such samples); and only the SPAN that holds sound is run, the samples
// before the first sound and from the second silent one after the last written as the 0 the whole loop wrote.
function mlSaturate(o, d, bias, w0, w1) {
  const n = o.L.length; let pk = 0, e0 = 0, e1 = 0;
  const sp = [mlSpan(o.L), mlSpan(o.R)], a0 = Math.min(sp[0][0], sp[1][0]), a1 = Math.max(sp[0][1], sp[1][1]);
  for (let i = a0; i < a1; i++) pk = Math.max(pk, Math.abs(o.L[i]), Math.abs(o.R[i]));
  if (!(pk > 0)) return;
  for (let i = w0; i < w1; i++) e0 += o.L[i] * o.L[i] + o.R[i] * o.R[i];
  const tb = Math.tanh(d * bias), tn = Math.tanh(d * (1 + bias)) - tb, OS = 4;
  const lim = 0.5 * bias * 1.3877787807814457e-17 * pk;   // under it, x / pk is under 2^-56 of the bias: every sub-sample between two such samples is under half an ulp of it
  for (let c = 0; c < 2; c++) {
    const x = c ? o.R : o.L, a = sp[c][0], b = Math.min(n, sp[c][1] + 1);
    x.fill(0, 0, a); x.fill(0, b);
    let raw = 0;   // the sample before, as it came in (prev is raw / pk, divided only when it is needed)
    for (let i = a; i < b; i++) {
      const xi = x[i];
      if (xi <= lim && xi >= -lim && raw <= lim && raw >= -lim) { raw = xi; x[i] = 0; continue; }
      const v0 = xi / pk, prev = raw / pk; let acc = 0;
      for (let s = 1; s <= OS; s++) { const u = prev + (v0 - prev) * s / OS + bias; if (u !== bias) acc += Math.tanh(d * u) - tb; }
      raw = xi; x[i] = acc / OS / tn;
    }
  }
  for (let i = w0; i < w1; i++) e1 += o.L[i] * o.L[i] + o.R[i] * o.R[i];
  const g = e1 > 0 ? Math.sqrt(e0 / e1) : 0;
  for (let i = a0; i < Math.min(n, a1 + 1); i++) { o.L[i] *= g; o.R[i] *= g; }
}
// [first, last + 1) of the samples that are not 0 ([n, n) when all are)
function mlSpan(x) {
  const n = x.length; let a = 0; while (a < n && x[a] === 0) a++;
  if (a === n) return [n, n];
  let b = n - 1; while (x[b] === 0) b--;
  return [a, b + 1];
}
function mlEnergy(o, w0, w1, sr) { let e = 0; for (let i = Math.max(0, w0); i < Math.min(o.L.length, w1); i++) e += (o.L[i] * o.L[i] + o.R[i] * o.R[i]) / 2; return e / sr; }

// the place: an impulse response from geometry (stereo), as the gun's
function mlPlaceIR(sr, place, tailMul, rnd) {
  if (place === 0) return null;
  const lenS = [0, 0.9, 2.2, 1.8, 2.2][place] * tailMul, n = Math.max(64, Math.round(lenS * sr));
  const L = new Float64Array(n), R = new Float64Array(n);
  const tap = (t, g, fc, ch) => {
    const i0 = Math.round(t * sr); if (i0 >= n) return;
    const a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr);
    let v = (1 - a) * g;
    for (let j = i0; j < n && Math.abs(v) > 1e-7 * Math.abs(g); j++) { if (ch !== 1) L[j] += v; if (ch !== 0) R[j] += v; v *= a; }
  };
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
  if (place === 1) {          // ROOM: image sources in 2-25 ms, a 0.45 s tail
    for (let q = 0; q < 16; q++) tap(0.002 + 0.023 * rnd(), 0.07 + 0.1 * rnd(), 4000 + 6000 * rnd(), q & 1);
    tail(0.005, 0.02, 0.45 * tailMul, 6000, 2000, 0.7);
  } else if (place === 2) {   // STONE HALL: early hits 8-45 ms off stone, a 1.6 s bright-ish tail
    for (let q = 0; q < 14; q++) tap(0.008 + 0.037 * rnd(), 0.08 + 0.1 * rnd(), 5000 + 4000 * rnd(), q & 1);
    tail(0.015, 0.05, 1.6 * tailMul, 5500, 1500, 1.1);
  } else if (place === 3) {   // OUTDOORS: the ground, a treeline at ~0.12 s, a short dark tail
    tap(0.003, 0.4, 7000, 2);
    const s1 = 0.1 + 0.05 * rnd(); for (let q = 0; q < 5; q++) tap(s1 + 0.012 * (rnd() - 0.5), 0.08 * (0.5 + rnd()), 2400, q & 1);
    tail(0.03, 0.12, 1.0 * tailMul, 2500, 500, 0.25);
  } else {                    // CAVE: dense flutter, a long dark tail
    for (let q = 0; q < 24; q++) tap(0.006 + 0.09 * rnd(), 0.06 + 0.08 * rnd(), 2500 + 2500 * rnd(), q & 1);
    tail(0.02, 0.08, 1.9 * tailMul, 3000, 600, 1.0);
  }
  return { L, R };
}
// ---- the whole blow: stereo, seeded, levelled. Returns { L, R, n, info }.
function makeMelee(sr, cfg, seed) {
  const c = Object.assign({ "sr": sr }, cfg), W = c.W, hype = c.hype, w = c.weight;
  const tMain = c.whiff ? c.tLast + c.Ts : c.tc;
  const n = Math.max(64, Math.round((tMain + 2.6 + (c.place ? 2.5 * (0.5 + c.tail) : 0)) * sr));
  const HI = mlBuf(n), LO = mlBuf(n), RG = mlBuf(n), SW = mlBuf(n), TH = mlBuf(n), parts = [];
  const thBus = TH;
  const cw0 = Math.round(Math.max(0, tMain - 0.005) * sr), cw1 = cw0 + Math.round(0.3 * sr);
  const place = (bus, o, E, tag, w0, w1) => {   // add o into bus at energy E over [w0, w1)
    const e = mlEnergy(o, w0, w1, sr); if (!(e > 1e-20) || !(E > 0)) return;
    const g = Math.sqrt(E / e); for (let i = 0; i < n; i++) { bus.L[i] += o.L[i] * g; bus.R[i] += o.R[i] * g; }
    parts.push(tag + " " + (10 * Math.log10(E)).toFixed(1) + " dB");
  };
  // CONTACT (the recipe), each component at its energy share x Contact^2
  const ctE = c.whiff ? 0 : c.contact * c.contact;
  if (ctE > 0) for (const p of mlRecipe(c, seed)) { const o = mlBuf(n); p.render(o); place(p.bus === "rg" ? RG : HI, o, p.E * ctE, p.tag, cw0, cw1); }
  // SWING: its energy over its own span, against the contact's
  let swDesc = null;
  if (c.swing > 0 || c.whiff || W.crack) {
    const o = mlBuf(n), sw = mlSwing(o, sr, c, mlRng(mlSeed(seed, 0, 1)));
    for (let i = 0; i < n; i++) { SW.L[i] = o.L[i]; SW.R[i] = o.R[i]; }
    swDesc = "swing (" + (W.broad > 0.6 ? "broad whoosh" : W.whistle > 0.6 ? "edge whistle" : W.huff ? "huff" : "blade swish") + ", " + Math.round(sw.tEnd * 1000) + " ms" + (c.spins > 1 ? ", " + c.spins + " revolutions" : "") + (W.chain ? ", the chain rattling" : "") + ")";
  }
  if (W.crack) {   // the whip's tip: the crack IS the contact (or the miss's end)
    const o = mlBuf(n); mlWhipCrack(o, sr, tMain, 1, mlRng(mlSeed(seed, 0, 2)));
    place(HI, o, c.whiff ? 0.5 : 0.7 * Math.max(0.3, c.contact), "whip: the tip's N-wave crack", cw0, cw1);
  }
  // BODY: the pitch-dropping sine (+ the sub boom when exaggerated), by how much the target gives
  if (!c.whiff && c.body > 0) {
    // a blunt blow carries through armor into the body behind it (a hammer on a knight); an edge or a point does not
    const give = (c.hit === "blunt" ? c.T.give + (1 - c.T.give) * 0.6 : c.T.give * (c.hit === "edge" ? 0.65 : 0.5));
    const fS = (210 - 120 * w) * (1 - 0.15 * hype), fE = (95 - 55 * w) * (1 - 0.25 * hype), tp = 0.005 + 0.015 * w, tau = (0.02 + 0.08 * w) * (1 + 0.6 * hype);
    const o = mlBuf(n), i0 = Math.round(c.tc * sr), len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr)), at = Math.round(0.0006 * sr);
    let ph = 0, e = 1;
    for (let j = 0; j < len; j++) { const f = fE + (fS - fE) * Math.exp(-j / sr / tp); ph += 2 * Math.PI * f / sr; const v = Math.sin(ph) * e * (j < at ? 0.5 - 0.5 * Math.cos(Math.PI * j / at) : 1); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
    if (hype > 0) { const ts = 0.07 + 0.1 * hype; let p2 = 0, e2 = 0.45 * hype; const d2 = Math.exp(-1 / (ts * sr)); for (let j = 0; j < Math.min(n - i0, Math.ceil(6 * ts * sr)); j++) { p2 += 2 * Math.PI * fE * 0.62 / sr; const v = Math.sin(p2) * e2 * Math.min(1, j / (0.008 * sr)); o.L[i0 + j] += v; o.R[i0 + j] += v; e2 *= d2; } }
    place(LO, o, 1.1 * c.body * c.body * give * (0.4 + 0.9 * w) * (1 + 0.9 * hype), "body (" + Math.round(fS) + " -> " + Math.round(fE) + " Hz, " + Math.round(tau * 1000) + " ms" + (hype > 0 ? ", + sub boom" : "") + ")", cw0, cw1);
  }
  // THE DESIGNED THUMP (Thump > 0): the weight as a game designs it, NOT scaled by how much the target gives. A sub that
  // drops like a kick drum (~100 -> 52 Hz at a light blow, ~85 -> 40 at the heaviest; a kick's leg lower and slower by
  // its mass), a decay of 50-100 ms time constant (so -20 dB at ~0.25-0.45 s), and a meaty mid WHUMP (a 380 -> 170 Hz
  // sweep + a 400 Hz low-passed noise burst, ~25-40 ms). Both into the low group.
  if (!c.whiff && c.thump > 0) {
    const ms = W.mass || 1, sq = Math.sqrt(ms), i0 = Math.round(c.tc * sr), at = Math.round(0.001 * sr);
    const fS = (100 - 15 * w) / sq * (1 - 0.1 * hype), fE = (52 - 12 * w) / sq * (1 - 0.15 * hype), tp = 0.012 + 0.012 * w, tau = (0.05 + 0.05 * w) * ms * (1 + 0.4 * hype);
    { const o = mlBuf(n), len = Math.min(n - i0, Math.ceil(7 * tau * sr)), dk = Math.exp(-1 / (tau * sr));
      let ph = 0, e = 1;
      for (let j = 0; j < len; j++) { const f = fE + (fS - fE) * Math.exp(-j / sr / tp); ph += 2 * Math.PI * f / sr; const v = Math.sin(ph) * e * (j < at ? 0.5 - 0.5 * Math.cos(Math.PI * j / at) : 1); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
      place(thBus, o, 2.6 * c.thump * c.thump * (1 + 0.5 * hype) * (0.6 + 0.6 * w) * ms, "THUMP (sub " + Math.round(fS) + " -> " + Math.round(fE) + " Hz, tau " + Math.round(tau * 1000) + " ms)", cw0, cw1); }
    { const o = mlBuf(n), tw = (0.022 + 0.012 * w) * ms, len = Math.min(n - i0, Math.ceil(7 * tw * sr)), dk = Math.exp(-1 / (tw * sr)), rn = mlRng(mlSeed(seed, 0, 5));
      let ph = 0, e = 1;
      for (let j = 0; j < len; j++) { const f = (170 + 210 * Math.exp(-j / sr / 0.008)) / sq; ph += 2 * Math.PI * f / sr; const v = Math.sin(ph) * e * (j < at ? j / at : 1); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
      mlBurst(o, sr, c.tc, tw * 0.8, 400 / sq, 0.8, 0, 0.6, 0, rn, 0.0008);
      place(thBus, o, 0.7 * c.thump * c.thump * (0.6 + 0.6 * w) * ms, "mid whump (380 -> 170 Hz, tau " + Math.round(tw * 1000) + " ms)", cw0, cw1); }
    if (c.snap > 0) {   // the designed SLAP / CRACK: 3.2 kHz noise through a hard tanh, ~2.5 ms
      const o = mlBuf(n), rn = mlRng(mlSeed(seed, 0, 6)), f = mlSvf(), out = [0, 0, 0], g = mlG(3200, sr), dk = Math.exp(-1 / (0.0025 * sr)), th = Math.tanh(6), len = Math.round(0.018 * sr);
      let e = 1; for (let j = 0; j < len && i0 + j < n; j++) { mlSvfTick(f, rn() * 2 - 1, g, 0.9, out); const v = Math.tanh(6 * out[1] * e * 2) / th; o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
      place(HI, o, 0.16 * c.snap * c.snap, "slap crack (3.2 kHz, clipped)", cw0, cw1);
    }
  }
  // BONE CRUNCH: celery snapping: 14-24 sharp clicks and a dry 1.5-7 kHz crackle, front-loaded over ~22 ms
  if (!c.whiff && c.bone > 0) {
    const o = mlBuf(n), rn = mlRng(mlSeed(seed, 0, 7)), t0 = c.tc + 0.003, K = 14 + Math.round(10 * c.bone);
    for (let q = 0; q < K; q++) mlKnock(o, sr, t0 + 0.022 * Math.pow(rn(), 1.5), 0.00006 + 0.00008 * rn(), (0.4 + rn()) * (rn() < 0.5 ? 1 : -1), 0.1 + 0.4 * (rn() - 0.5), 0);
    mlGrains(o, sr, t0, 0.02, 30, 1500, 7000, 0.0003, 0.5, rn, 0.1, 0.3);
    place(HI, o, 0.22 * c.bone * c.bone, "bone crunch (" + K + " clicks)", cw0, cw1);
  }
  // SNAP and the EXAGGERATED crack, on the contact
  if (!c.whiff && c.snap > 0) {
    const o = mlBuf(n), tmp = new Float64Array(Math.round(0.004 * sr)), rn = mlRng(mlSeed(seed, 0, 3)), wd = 0.00006 + 0.00006 * w;
    mlAddCont(tmp, sr, 0, wd + 0.00025, (t) => (t < wd ? 1 : -0.3), 1);
    const dk = Math.exp(-1 / (0.0003 * sr)); let e = 0.9;
    const i0 = Math.round(c.tc * sr);
    for (let j = 0; j < tmp.length && i0 + j < n; j++) { const v = mlClamp((tmp[j] + (rn() * 2 - 1) * e) * 1.6, -0.75, 0.75); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
    place(HI, o, 0.05 * c.snap * c.snap * (1 + hype), "snap", cw0, cw1);
  }
  if (!c.whiff && hype > 0) {
    const o = mlBuf(n), rn = mlRng(mlSeed(seed, 0, 4)), i0 = Math.round(c.tc * sr), tau = 0.012, len = Math.min(n - i0, Math.ceil(7 * tau * sr)), f = mlSvf(), out = [0, 0, 0], g = mlG(2800, sr), dk = Math.exp(-1 / (tau * sr)), th = Math.tanh(4);
    let e = 1; for (let j = 0; j < len; j++) { mlSvfTick(f, rn() * 2 - 1, g, 0.85, out); const v = Math.tanh(4 * out[1] * e * 1.4) / th; o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
    place(HI, o, 0.22 * hype * hype, "exaggerated crack", cw0, cw1);
  }
  // THE CRUNCH STAGE: each group saturated (rings and body gentler), each back to its own energy
  const d = 1 + 20 * Math.pow(c.crunch, 1.5), bias = 0.15 * c.crunch, w0 = Math.round(c.tS * sr), w1 = cw1;
  mlSaturate(HI, d, bias, w0, w1);
  mlSaturate(LO, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  mlSaturate(TH, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  mlSaturate(RG, 1 + 6 * Math.pow(c.crunch, 1.5), 0.3 * bias, w0, w1);
  if (swDesc) mlSaturate(SW, d, bias, 0, n);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) { L[i] = HI.L[i] + LO.L[i] + RG.L[i]; R[i] = HI.R[i] + LO.R[i] + RG.R[i]; }
  // COMPRESSOR (stereo-linked, log domain): attack 2.5 ms, release 60-120 ms
  let grMax = 0, pk0 = 1, thumpDone = false;
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    for (let i = 0; i < n; i++) { L[i] /= p || 1; R[i] /= p || 1; }
    pk0 = p || 1;
    if (c.comp > 0) {
      // the DETECTOR is high-passed at 150 Hz (a side-chain filter): the contact drives it, so the body is not held
      // down for its whole length; it rides under the hit and swells back as the compressor releases
      const det = new Float64Array(n), hA = Math.exp(-2 * Math.PI * ML_DET_HP / sr);
      // (CPU, exact: past the last sound the detector's filters only decay, max(|h|, |y|) never growing, so once all are
      // under 1e-300 no later value can be the peak, and the compressor reads none of them: the loop stops there)
      const cEnd = Math.max(mlSpan(L)[1], mlSpan(R)[1]);
      { let h1 = 0, x1 = 0, h2 = 0, y1 = 0, h3 = 0, x3 = 0, h4 = 0, y3 = 0, dp = 0;
        for (let i = 0; i < n; i++) {
          h1 = hA * (h1 + L[i] - x1); x1 = L[i]; h2 = hA * (h2 + h1 - y1); y1 = h1; h3 = hA * (h3 + R[i] - x3); x3 = R[i]; h4 = hA * (h4 + h3 - y3); y3 = h3; det[i] = Math.max(Math.abs(h2), Math.abs(h4)); dp = Math.max(dp, det[i]);
          if (i > cEnd && Math.max(Math.abs(h1), Math.abs(h2), Math.abs(h3), Math.abs(h4)) < 1e-300) break;
        }
        for (let i = 0; i < cEnd; i++) det[i] /= dp || 1; }
      const thrDb = -(6 + 24 * c.comp), ratio = 1.5 + 6.5 * c.comp, aA = Math.exp(-1 / (0.0025 * sr)), aR = Math.exp(-1 / ((0.06 + 0.06 * c.comp) * sr));
      let env = -120;
      for (let i = 0; i < cEnd; i++) {   // past the last sound a gain multiplies silence (CPU, exact)
        const m = det[i], lv = m > 1e-9 ? 20 * Math.log10(m) : -180;
        env = lv > env ? lv + (env - lv) * aA : lv + (env - lv) * aR;
        const over = env - thrDb, gr = over > 0 ? over * (1 - 1 / ratio) : 0;
        if (gr > grMax) grMax = gr;
        const gg = Math.pow(10, -gr / 20); L[i] *= gg; R[i] *= gg;
      }
    } }
  // PEAK CONTROL limits the HIT alone, here, before the swing joins: on the whole buffer it lifted the swing by up to
  // 12 dB against a clamped hit (measured: the swing level with the hit at Peak 1.2), which erased the swing-to-hit balance
  if (c.peak > 0 && !c.whiff) { for (let i = 0; i < n; i++) { L[i] += TH.L[i] / pk0; R[i] += TH.R[i] / pk0; } mlPeakControl(L, R, c.peak); thumpDone = true; }
  // the designed THUMP may go AROUND the compressor (thumpPost): saturated with the low group, then added here at the
  // same scale it had before the compressor, so the hit's gain reduction neither ducks it nor squashes it
  if (!thumpDone) for (let i = 0; i < n; i++) { L[i] += TH.L[i] / pk0; R[i] += TH.R[i] / pk0; }
  // the SWING joins AFTER the compressor (as the gun's mechanism does: a compressor before it lifted it to the hit's
  // level), its loudest 5 ms set swingDb under the hit's loudest 5 ms: -24 dB at Swing 0 .. -6 at 1, +6 when exaggerated
  if (swDesc) {
    const r5 = (A, B) => { const F = Math.round(0.005 * sr); let best = 0; for (let a = 0; a + F <= n; a += F) { let s = 0; for (let i = a; i < a + F; i++) s += A[i] * A[i] + B[i] * B[i]; best = Math.max(best, s); } return Math.sqrt(best / (2 * F)); };
    const hit = c.whiff ? 0 : r5(L, R), own = r5(SW.L, SW.R);
    const db = mlClamp(-24 + 18 * c.swing + 6 * hype, -30, 0), g = own > 0 ? (c.whiff ? 1 / own : hit * Math.pow(10, db / 20) / own) : 0;
    for (let i = 0; i < n; i++) { L[i] += SW.L[i] * g; R[i] += SW.R[i] * g; }
    parts.push(swDesc + (c.whiff ? "" : " at " + db.toFixed(1) + " dB under the hit"));
  }
  // PLACE
  const tailMul = 0.5 + c.tail, wetG = 1.0 * c.tail;
  const ir = mlPlaceIR(sr, c.place, tailMul, mlRng(mlSeed(seed, 8888, 0)));
  if (ir && wetG > 0) {
    const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = (L[i] + R[i]) / 2;
    const wet = blastConvolve(x, ir.L, ir.R, n);
    for (let i = 0; i < n; i++) { L[i] += wet.L[i] * wetG; R[i] += wet.R[i] * wetG; }
  }
  // CLIP, BITS / RATE, DC, width
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    const dc = 0.5 + 3 * c.crunch, tc = Math.tanh(dc), g = p > 0 ? 1 / p : 0;
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * g * dc) / tc; R[i] = Math.tanh(R[i] * g * dc) / tc; } }
  const ds = 1 + Math.round(7 * c.rateCut);
  if (ds > 1) { let hl = 0, hr = 0; for (let i = 0; i < n; i++) { if (i % ds === 0) { hl = L[i]; hr = R[i]; } L[i] = hl; R[i] = hr; } }
  if (c.bits > 0) { const lv = Math.pow(2, 16 - 12 * c.bits - 1); for (let i = 0; i < n; i++) { L[i] = Math.round(L[i] * lv) / lv; R[i] = Math.round(R[i] * lv) / lv; } }
  const hpA = Math.exp(-2 * Math.PI * 22 / sr);
  for (const B of [L, R]) { let h1 = 0, x1 = 0, h2 = 0, y1 = 0; for (let i = 0; i < n; i++) { h1 = hpA * (h1 + B[i] - x1); x1 = B[i]; h2 = hpA * (h2 + h1 - y1); y1 = h1; B[i] = h2; } }
  const wd = mlClamp(c.width, 0, 1) / 0.6;
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2 * wd; L[i] = m + s; R[i] = m - s; }
  // TRIM: at the Duration (the patch's own: a preset sets it where the blow should end), with a 40 ms fade, and levelled
  // over what is kept; with none (a Duration of 0, which no app patch has), where it falls 60 dB under its peak
  let m = n;
  if (c.dur > 0) m = Math.min(n, Math.round(c.dur * sr));
  else { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    let e = n - 1; while (e > 0 && Math.abs(L[e]) < p * 1e-3 && Math.abs(R[e]) < p * 1e-3) e--;
    m = Math.min(n, Math.max(Math.round((tMain + 0.15) * sr), e + Math.round(0.04 * sr))); }
  const fo = Math.min(m, Math.round(0.04 * sr)); for (let i = 0; i < fo; i++) { const g = i / fo; L[m - 1 - i] *= g; R[m - 1 - i] *= g; }
  const Lf = Float32Array.from(L.subarray(0, m)), Rf = Float32Array.from(R.subarray(0, m));
  if (c.peak > 0 && c.whiff) mlPeakControl(Lf, Rf, c.peak);   // a whiff is all swing: the whole of it
  const lv = meleeLevel(Lf, Rf, sr); for (let i = 0; i < m; i++) { Lf[i] *= lv; Rf[i] *= lv; }
  const info = { "tS": c.tS, "tc": c.whiff ? null : c.tc, "Ts": c.Ts, "hit": c.hit, "parts": parts, "grMax": grMax, "ds": ds,
    "bits": c.bits > 0 ? Math.round(16 - 12 * c.bits) : 16, "drive": d, "len": m / sr };
  return { "L": Lf, "R": Rf, "n": m, "info": info };
}

// PEAK CONTROL, the gun's gunPeak: the app's own lookahead limiter (limiterProcess) on the melee alone, from a 0.9 peak;
// past 1 a second pass. A hit is nearly all spike, so this is what lets it sit at a level beside the section without the
// master Limiter. In place.
// The limiter runs over the samples up to the last sound: past it, its lookahead reads silence and its gain multiplies
// silence, so the result is the whole buffer's (CPU, exact).
function mlPeakControl(L, R, peak) {
  const n = Math.max(mlSpan(L)[1], mlSpan(R)[1]), Ls = L.subarray(0, n), Rs = R.subarray(0, n);
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk < 1e-9) return;
  const g0 = 0.9 / pk; for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
  limiterProcess(Ls, Rs, Math.min(1, peak));
  if (peak > 1) { let p2 = 0; for (let i = 0; i < n; i++) p2 = Math.max(p2, Math.abs(L[i]), Math.abs(R[i])); const g1 = 0.9 / Math.max(1e-9, p2); for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; } limiterProcess(Ls, Rs, Math.min(1, peak - 1)); }
}
// The level a melee sound gets with Normalize off: RMS ML_RMS over its loudest 300 ms, the peak capped at ML_PEAK. Returns
// the gain.
function meleeLevel(L, R, sr) {
  const W = Math.min(L.length, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0, pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= L.length; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return 0;
  let g = ML_RMS / Math.sqrt(best);
  if (pk * g > ML_PEAK) g = ML_PEAK / pk;
  return g;
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
