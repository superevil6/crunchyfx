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
