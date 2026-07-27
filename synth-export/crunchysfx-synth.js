/*! CrunchySFX synthesis engine — GENERATED FILE, DO NOT EDIT.
 *
 *  Everything here is compiled from the CrunchySFX sources; edit those and re-export instead.
 *  Exposes exactly one global: CrunchySynth { render, encodeWav, DEFAULTS, PARAMS, SR, VERSION, BUILT, SHA256 }.
 *
 *    source   crunchysfx v1.1.0 (a8c4bbc — DIRTY WORKING TREE)
 *    from     dsp.js + synth.js + the PARAMS defaults
 *    sha256   546d831dfa8298e6f147865b4bccbcf319e23539e0a34452e8c3a3573ad1661f   (of everything below this banner, with the SHA256 field blanked)
 *
 *  Regenerate:  python3 tools/export-synth.py          (in the crunchysfx repo)
 *  Re-vendor:   python3 tools/pull-synth.py            (in the crunchyvfx repo)
 */
(function (root) {
"use strict";

// ==== dsp.js ================================================================================
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
// ==== synth.js =============================================================================
// CrunchySFX — the synthesis core: one patch object in, stereo audio out.
//
// Extracted from index.html so the engine can be exported and reused (CrunchyVFX synthesises
// its matched sounds with this exact code). Loaded via <script src="synth.js"> AFTER dsp.js and
// BEFORE the main <script> — classic scripts share one global scope, like presets.js.
//
// PURE: no DOM, no app globals, no module state. Everything it needs is either a dsp.js helper
// or an explicit argument, which is what makes it safe to ship standalone. Keep it that way —
// reaching for an app global here is what would break the export, silently.
//
//   renderPatch(st, opts) -> { L, R, rawPeak }
//     st   — a patch: the same flat key/value shape as PRESETS entries and `state`.
//     opts — { sample: Float32Array|null, normalize: boolean }, both optional.
//
// rawPeak is the pre-normalization peak, so callers can tell "quiet" from "silent".

// ---------- Audibility ----------
// A sound whose intrinsic peak is below this floor (~ -66 dB) is treated as
// inaudible: normalization can't rescue it, so we re-roll or flag it instead.
const AUDIBLE_FLOOR = 1e-3;  // below this (~ -60 dB) a sound counts as inaudible
const NORM_TARGET = 0.9;     // loudness-normalize quiet sounds up to this peak...
const NORM_MAX_BOOST = 300;  // ...capped at ~50 dB makeup so gated silence can't become hiss

function renderPatch(st, opts) {
  opts = opts || {};
  // The two pieces of app state render() used to reach for as globals. Defaults match the
  // app: no loaded sample, normalization on.
  const sampleBuf = opts.sample || null;
  const normalizeOut = opts.normalize !== false;

  const dur = st.duration;
  const n = Math.max(1, Math.floor(dur * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const susLevel = st.sustain;
  const atk = st.attack, dec = st.decay, hold = st.hold, rel = st.release;
  // burst: retrigger the shot `repeat` times at `rate` Hz. `slot` is one shot's
  // length; each shot gets its own local time so the envelope, pitch sweep and
  // filter env all re-fire per shot instead of once across the whole buffer.
  const repeat = Math.max(1, Math.round(st.repeat || 1));
  const rate = Math.max(0.5, st.rate || 10);
  const slot = repeat > 1 ? 1 / rate : dur;
  const relStart = Math.max(atk + hold + dec, slot - rel);

  const baseFreq = st.freq;
  const sweep = st.sweep;
  const waveType = Math.round(st.wave);
  const baseCut = st.cutoff;
  const filtEnv = st.filtEnv;
  const fmode = Math.round(st.filterMode);   // 0 LP, 1 HP, 2 BP, 3 notch, 4 peak

  // deterministic LCG so exports are reproducible
  let seed = 22222;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };

  // unison: V detuned voices, each with its own phase + equal-power stereo pan.
  // Detune (beating) + stereo spread is what turns one thin voice into a thick one.
  const V = Math.max(1, Math.round(st.unison));
  const width = st.width;
  const phases = new Float32Array(V);
  const ratios = new Float32Array(V);
  const panL = new Float32Array(V);
  const panR = new Float32Array(V);
  const voiceGain = 1 / Math.sqrt(V);
  for (let v = 0; v < V; v++) {
    phases[v] = V > 1 ? v / V : 0;                          // spread start phases
    const d = V > 1 ? (v / (V - 1)) * 2 - 1 : 0;            // -1..1 across the voices
    ratios[v] = Math.pow(2, (d * st.detune) / 1200);    // cents -> frequency ratio
    const pan = d * width;                                  // spread across the stereo field
    panL[v] = Math.cos((pan + 1) * Math.PI / 4);
    panR[v] = Math.sin((pan + 1) * Math.PI / 4);
  }

  let subPhase = 0, vibPhase = 0;
  let ic1L = 0, ic2L = 0, ic1R = 0, ic2R = 0;   // per-channel TPT filter state
  let ringPhase = 0, pwmPhase = 0;              // ring-mod carrier + PWM LFO phases
  let xprevL = 0, xprevR = 0;                   // previous pre-drive sample (for oversampling)
  // Karplus-Strong plucked string (wave "pluck"): a noise-filled delay line whose
  // averaging feedback both sets the pitch (length = SR/freq) and damps the tail.
  const isPluck = waveType === 8;
  const ksBuf = isPluck ? new Float32Array(2206) : null;   // max length at 20 Hz
  let ksN = 0, ksIdx = 0, ksPrevShot = -1;
  const ksRho = 0.999 - 0.02 * st.pluckDamp;            // string decay (higher damp -> shorter)
  // Imported WAV as the source (wave "sample"): read position advances at a varispeed
  // rate set by the pitch controls. Plays once from the start, then silence.
  const isSample = waveType === 9;
  let samplePos = 0, samplePrevShot = -1;
  // Modal resonator bank (wave "modal"): a struck sound = sum of decaying tuned partials.
  // Mode ratios/amplitudes/decays depend only on state (constant across the render), so we
  // precompute them once; only the per-mode phase resets on each (repeat) shot. `inharm`
  // morphs the ratios from harmonic (k) toward ideal free-bar modes ((2k+1)/3)^2 → bell/metal.
  const isModal = waveType === 10;
  const MODAL_MAX = 16;
  const modalRatio = new Float32Array(MODAL_MAX), modalAmp = new Float32Array(MODAL_MAX);
  const modalInvTau = new Float32Array(MODAL_MAX), modalPh = new Float32Array(MODAL_MAX);
  let nModes = 1, modalPrevShot = -1;
  if (isModal) {
    nModes = Math.max(1, Math.min(MODAL_MAX, Math.round(st.modalPartials)));
    const inh = st.modalInharm, mb = st.modalBright, dT = Math.max(0.02, st.modalDecay);
    let norm = 0;
    for (let k = 1; k <= nModes; k++) {
      const bar = (2 * k + 1) / 3;                                  // free-bar mode index
      modalRatio[k - 1] = (1 - inh) * k + inh * bar * bar;          // harmonic ↔ inharmonic
      modalAmp[k - 1] = 1 / Math.pow(k, 2 - 2 * mb);                // bright: 1/k² (dark) → flat
      modalInvTau[k - 1] = Math.sqrt(k) / dT;                       // higher modes ring shorter
      norm += modalAmp[k - 1];
    }
    if (norm > 0) for (let k = 0; k < nModes; k++) modalAmp[k] /= norm;   // keep level bounded
  }
  // Granular (wave "granular"): built up front into a stereo buffer (grains need random access),
  // then read per-sample below. Source = the imported sample if loaded, else a synth tone.
  const isGranular = waveType === 11;
  let granL = null, granR = null;
  if (isGranular) {
    const src = (sampleBuf && sampleBuf.length > 1) ? sampleBuf : granSynthSource();
    const gr = makeGranular(src, n, baseFreq, st.grainSize, st.grainDensity, st.grainSpray, st.grainScan, st.grainSpread, 0x00c0ffee);
    granL = gr.L; granR = gr.R;
  }
  // Custom drawn wave (wave 12): band-limit the drawing to this note's highest frequency (up-sweep
  // pushes it higher) so it can't alias, into the module-level table waveform() reads. Read via the
  // normal unison path, so detune/width/vibrato all work. customTable is cleared otherwise.
  let customTable = null, customTableB = null;
  if (waveType === 12) {
    const drawn = b64ToCustomWave(st.customWave) || CUSTOM_DEFAULT_DRAWN;
    const swMul = st.sweep > 0 ? Math.pow(2, st.sweep * 4) : 1;
    const fMax = Math.min(20000, Math.max(1, baseFreq * swMul));
    const maxH = Math.floor(22050 / fMax);
    customTable = buildCustomTable(drawn, maxH);
    // Wave Morph: build Wave B too when engaged (morph start > 0, or a sweep). Band-limited the same
    // way, so the two tables share length and blend cleanly. Off by default → no extra FFT cost.
    if (st.morph > 0 || st.morphSweep !== 0) {
      const drawnB = b64ToCustomWave(st.customWaveB) || CUSTOM_DEFAULT_DRAWN;
      customTableB = buildCustomTable(drawnB, maxH);
    }
  }
  // Formant / vocal (wave "formant"): a buzz (band-limited saw) through 3 parallel resonant
  // bandpasses tuned to vowel formants → "ahh/ooo/eee", voices, creatures, robots. Formant freqs
  // depend only on state (constant across the render), so coeffs are precomputed once here; only
  // the biquad states + source phase advance per sample. Special-cased (mono, ignores unison).
  const isFormant = waveType === 13;
  let fmPhase = 0;
  const F_N = 3, fmB0 = new Float64Array(F_N), fmA1 = new Float64Array(F_N), fmA2 = new Float64Array(F_N);
  const fmX1 = new Float64Array(F_N), fmX2 = new Float64Array(F_N), fmY1 = new Float64Array(F_N), fmY2 = new Float64Array(F_N);
  const fmBreath = st.formantBreath;
  const fmQ = 4 + Math.max(0, Math.min(1, st.formantQ)) * 16;   // formant sharpness
  const fmLfoRate = st.formantLfoRate, fmLfoDepth = st.formantLfoDepth;
  const fmLfoOn = isFormant && fmLfoRate > 0 && fmLfoDepth > 0;    // vowel morphs over time
  // Static vowel → coeffs are constant, precompute once (unchanged path). LFO on → recompute
  // per sample from the morphing vowel (in the osc branch below).
  if (isFormant && !fmLfoOn) computeFormantCoeffs(st.formantVowel, st.formantSize, fmQ, fmB0, fmA1, fmA2);
  // Bubble / water (wave "bubble"): built up front into a stereo buffer, then read per-sample.
  const isBubble = waveType === 14;
  let bubL = null, bubR = null;
  if (isBubble) {
    const b = makeBubbles(n, baseFreq, st.bubbleRate, st.bubbleRise, st.bubbleSpread, st.bubbleDecay, 0x00b0bb1e);
    bubL = b.L; bubR = b.R;
  }
  // Particle / crackle (wave "particle"): built up front into a stereo buffer, then read per-sample.
  const isParticle = waveType === 15;
  let parL = null, parR = null;
  if (isParticle) {
    const pr = makeParticles(n, st.particleTone, st.particleRate, st.particleDecay, st.particleSpread, 0x00facade);
    parL = pr.L; parR = pr.R;
  }
  // Impact / blast (wave "impact"): one percussive transient, front-loaded at index 0; read at
  // `lt` in the loop so it retriggers per burst shot (full-auto). Mono; body via boom layer.
  const isImpact = waveType === 19;
  let impactBuf = null;
  if (isImpact) impactBuf = makeImpact(n, st.impactTone, st.impactDecay, st.impactPunch, st.impactGrit, 0x1a2b3c4d);
  // Whoosh / air (wave "whoosh"): one swing gesture sized to a shot's slot, read at `lt` so combos
  // (repeat) retrigger a fresh swish. Mono.
  const isWhoosh = waveType === 20;
  let whooshBuf = null;
  if (isWhoosh) { const wlen = Math.max(2, Math.min(n, Math.round(slot * SR))); whooshBuf = makeWhoosh(wlen, st.whooshTone, st.whooshSweep, st.whooshBody, st.whooshPeak, 0x51ce5ab1); }
  // Additive / spectral pad (wave "additive"): sum of `addPartials` harmonics, each with its own
  // slow amplitude-drift LFO (random rate/phase) → evolving pad. Per-partial data is constant
  // across the render, so precompute it once; only the partial phases advance per sample.
  const isAdditive = waveType === 16;
  const ADD_MAX = 48;
  const addAmp = new Float32Array(ADD_MAX), addDet = new Float32Array(ADD_MAX), addPh = new Float32Array(ADD_MAX);
  const addLfoRate = new Float32Array(ADD_MAX), addLfoPh = new Float32Array(ADD_MAX);
  const addPanL = new Float32Array(ADD_MAX), addPanR = new Float32Array(ADD_MAX);
  let nAdd = 1;
  const addDrift = st.addDrift, addDriftRate = st.addDriftRate;
  if (isAdditive) {
    nAdd = Math.max(1, Math.min(ADD_MAX, Math.round(st.addPartials)));
    const exp = 2 - 1.8 * st.addTilt, det = st.addDetune;
    let s = 0x5eed1234 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };   // deterministic
    let norm = 0;
    for (let k = 0; k < nAdd; k++) {
      addAmp[k] = 1 / Math.pow(k + 1, exp);
      addDet[k] = 1 + (rnd() * 2 - 1) * det * 0.01;              // ±1%·detune → slow beating
      addLfoRate[k] = addDriftRate * (0.5 + rnd());              // each partial drifts at its own rate
      addLfoPh[k] = rnd() * 2 * Math.PI;
      const pan = (rnd() * 2 - 1) * det;                         // stereo spread (det 0 = mono)
      addPanL[k] = Math.cos((pan + 1) * Math.PI / 4); addPanR[k] = Math.sin((pan + 1) * Math.PI / 4);
      norm += addAmp[k];
    }
    if (norm > 0) for (let k = 0; k < nAdd; k++) addAmp[k] /= norm;
  }
  // Speech (wave "speech"): render the text to a mono buffer up front, then read it per-sample.
  const isSpeech = waveType === 17;
  let speechBuf = null;
  if (isSpeech) speechBuf = makeSpeech(n, st.speechText, baseFreq, st.speechSize, st.speechRate, 0x5eec0de);
  // 4-operator FM (wave "FM 4op"): per-sample; ops evaluated 3→2→1→0 so mods resolve in one pass.
  const isFM4 = waveType === 18;
  const fmRatio = [1, st.fmRatio2, st.fmRatio3, st.fmRatio4];
  const fmPh = [0, 0, 0, 0], fmOut = [0, 0, 0, 0];
  let fmFbPrev = 0, fmPrevShot = -1;
  const fmModDepth = st.fmIndex * 6, fmFbAmt = st.fmFeedback * 5;
  const fmAlg = FM_ALGOS[Math.round(st.fmAlgo)] || FM_ALGOS[0];
  const fmMods = fmAlg.mods, fmCarr = fmAlg.carriers;

  // Body layer: a clean low sine with its OWN exponential decay and a downward
  // pitch drop, independent of the crack envelope. Because it rings longer than the
  // transient (and is added after the drive stage so it isn't squashed), it's what
  // gives the shot chest-thump depth instead of just a short click.
  const boom = st.boom, boomF0 = st.boomFreq;
  const boomDrop = st.boomDrop, boomDec = Math.max(0.01, st.boomDecay);
  let boomPhase = 0, prevShot = -1;
  // colored-noise state + exponential-envelope exponent (both default to neutral → unchanged output)
  const noiseColor = st.noiseColor, eexp = 1 + st.envCurve * 3;
  let brownN = 0;

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const shotIdx = repeat > 1 ? Math.min(repeat - 1, Math.floor(t / slot)) : 0;
    const lt = t - shotIdx * slot;                 // time since this shot fired
    const prog = slot > 0 ? Math.min(1, lt / slot) : 0;

    const sweepMul = Math.pow(2, sweep * 4 * prog);
    const vib = st.vibDepth * Math.sin(vibPhase);
    // arpeggio: each repeat shot steps arpStep semitones (default 0 → ×1, so unchanged)
    const arpMul = st.arpStep ? Math.pow(2, st.arpStep * shotIdx / 12) : 1;
    const f = baseFreq * sweepMul * Math.pow(2, vib * 0.5) * arpMul;
    // keep the fundamental in the reproducible band so upward sweeps don't push it
    // ultrasonic (which aliases to garbage / near-silence instead of a real tone)
    const fOsc = Math.min(f, 20000);
    vibPhase += 2 * Math.PI * st.vibRate / SR;

    // pulse-width for this sample: base width wobbled by the PWM LFO
    let duty = st.pulseWidth;
    if (st.pwmDepth > 0) {
      pwmPhase += st.pwmRate / SR; if (pwmPhase >= 1) pwmPhase -= 1;
      duty += st.pwmDepth * Math.sin(2 * Math.PI * pwmPhase);
      if (duty < 0.05) duty = 0.05; else if (duty > 0.95) duty = 0.95;
    }

    let oscL = 0, oscR = 0;
    if (isSample) {
      // read the imported sample with linear interpolation at varispeed (f/440 =
      // playback rate, so 440 Hz plays native; freq/sweep/vibrato = tape-style speed).
      if (sampleBuf && sampleBuf.length) {
        if (shotIdx !== samplePrevShot) { samplePrevShot = shotIdx; samplePos = 0; }
        const ip = Math.floor(samplePos);
        let y = 0;
        if (ip < sampleBuf.length - 1) { const fr = samplePos - ip; y = sampleBuf[ip] * (1 - fr) + sampleBuf[ip + 1] * fr; }
        else if (ip < sampleBuf.length) y = sampleBuf[ip];
        samplePos += Math.max(0, f / 440);
        oscL = y; oscR = y;
      }
    } else if (isPluck) {
      // (re-)excite the delay line at each shot, then pluck one sample out of it
      if (shotIdx !== ksPrevShot) {
        ksPrevShot = shotIdx;
        ksN = Math.min(2205, Math.max(2, Math.round(SR / Math.max(20, fOsc))));
        ksIdx = 0;
        for (let j = 0; j < ksN; j++) ksBuf[j] = rnd();
      }
      const y = ksBuf[ksIdx];
      const nxt = ksIdx + 1 >= ksN ? 0 : ksIdx + 1;
      ksBuf[ksIdx] = (y + ksBuf[nxt]) * 0.5 * ksRho;   // lowpass-in-the-loop = damping
      ksIdx = nxt;
      oscL = y; oscR = y;                              // mono, centered (ignores unison)
    } else if (isModal) {
      // struck at each shot (reset mode phases); sum decaying partials. Phases start at 0 so
      // the sum begins near zero → soft click-free strike. Skip modes past Nyquist (band-limit).
      if (shotIdx !== modalPrevShot) { modalPrevShot = shotIdx; for (let k = 0; k < nModes; k++) modalPh[k] = 0; }
      let y = 0;
      for (let k = 0; k < nModes; k++) {
        const fk = fOsc * modalRatio[k];
        modalPh[k] += fk / SR; if (modalPh[k] >= 1) modalPh[k] -= 1;   // advance (keep continuity)
        if (fk >= 20000) continue;                                     // band-limit
        y += modalAmp[k] * Math.exp(-lt * modalInvTau[k]) * Math.sin(2 * Math.PI * modalPh[k]);
      }
      oscL = y * 2; oscR = y * 2;                     // mono, centered; ×2 for a healthy level
    } else if (isGranular) {
      oscL = granL[i]; oscR = granR[i];               // prebuilt grain cloud (already stereo)
    } else if (isFormant) {
      // buzz source (band-limited saw) + optional breath noise, through 3 formant resonators
      if (fmLfoOn) computeFormantCoeffs(st.formantVowel + fmLfoDepth * Math.sin(2 * Math.PI * fmLfoRate * t), st.formantSize, fmQ, fmB0, fmA1, fmA2);
      const dt = fOsc / SR;
      fmPhase += dt; if (fmPhase >= 1) fmPhase -= 1;
      let src = waveform(2, fmPhase, dt, 0.25);
      if (fmBreath > 0) src = src * (1 - fmBreath) + (rnd() * 2 - 1) * fmBreath;
      let y = 0;
      for (let fi = 0; fi < F_N; fi++) {
        const o = fmB0[fi] * (src - fmX2[fi]) - fmA1[fi] * fmY1[fi] - fmA2[fi] * fmY2[fi];   // b1=0, b2=−b0
        fmX2[fi] = fmX1[fi]; fmX1[fi] = src; fmY2[fi] = fmY1[fi]; fmY1[fi] = o;
        y += o * FORMANT_GAIN[fi];
      }
      oscL = y * 1.6; oscR = y * 1.6;                 // mono, centered; makeup for a healthy level
    } else if (isBubble) {
      oscL = bubL[i]; oscR = bubR[i];                 // prebuilt bubble cloud (already stereo)
    } else if (isParticle) {
      oscL = parL[i]; oscR = parR[i];                 // prebuilt particle cloud (already stereo)
    } else if (isImpact) {
      const idx = (lt * SR) | 0;                       // time since this shot → replays the transient per shot
      const v = idx < impactBuf.length ? impactBuf[idx] : 0;
      oscL = v; oscR = v;                             // mono blast; boom layer adds the low thump
    } else if (isWhoosh) {
      const idx = (lt * SR) | 0;                       // time since this shot → replays the swing per shot
      const v = idx < whooshBuf.length ? whooshBuf[idx] : 0;
      oscL = v; oscR = v;                             // mono swish
    } else if (isAdditive) {
      let sL = 0, sR = 0;
      for (let k = 0; k < nAdd; k++) {
        const fk = fOsc * (k + 1) * addDet[k];
        if (fk >= 20000) continue;                    // band-limit
        addPh[k] += fk / SR; if (addPh[k] >= 1) addPh[k] -= 1;
        const drift = 1 - addDrift * (0.5 + 0.5 * Math.cos(2 * Math.PI * addLfoRate[k] * t + addLfoPh[k]));
        const v = Math.sin(2 * Math.PI * addPh[k]) * addAmp[k] * drift;
        sL += v * addPanL[k]; sR += v * addPanR[k];
      }
      oscL = sL * 1.4; oscR = sR * 1.4;               // makeup for a healthy level
    } else if (isSpeech) {
      const v = speechBuf[i]; oscL = v; oscR = v;     // prebuilt speech utterance (mono)
    } else if (isFM4) {
      if (shotIdx !== fmPrevShot) { fmPrevShot = shotIdx; fmPh[0] = fmPh[1] = fmPh[2] = fmPh[3] = 0; fmFbPrev = 0; }
      let s3 = 0;
      for (let oi = 3; oi >= 0; oi--) {                // higher ops first (they modulate lower ops)
        let modIn = oi === 3 ? fmFbAmt * fmFbPrev : 0;
        const md = fmMods[oi];
        for (let m = 0; m < md.length; m++) modIn += fmOut[md[m]];
        const raw = Math.sin(2 * Math.PI * fmPh[oi] + modIn);
        fmPh[oi] += fOsc * fmRatio[oi] / SR; if (fmPh[oi] >= 1) fmPh[oi] -= 1;
        if (oi === 3) s3 = raw;
        fmOut[oi] = fmCarr.indexOf(oi) >= 0 ? raw : raw * fmModDepth;   // carrier = audio; modulator = radians
      }
      fmFbPrev = s3;
      let y = 0; for (let c = 0; c < fmCarr.length; c++) y += fmOut[fmCarr[c]];
      y /= fmCarr.length;
      oscL = y; oscR = y;                             // mono, centered
    } else {
      // Wave-Morph blend factor at this sample: A→B start (morph) plus a sweep over the sound's
      // duration. Same for every unison voice, so compute once. Only non-zero when Wave B is built.
      let morphB = 0;
      if (customTableB) morphB = Math.min(1, Math.max(0, st.morph + st.morphSweep * (n > 1 ? i / (n - 1) : 0)));
      // sum unison voices into L/R
      for (let v = 0; v < V; v++) {
        const dt = (fOsc * ratios[v]) / SR;
        let ph = phases[v] + dt;
        if (ph >= 1) ph -= 1;
        phases[v] = ph;
        const w = waveform(waveType, ph, dt, duty, customTable, customTableB, morphB);
        oscL += w * panL[v];
        oscR += w * panR[v];
      }
      oscL *= voiceGain; oscR *= voiceGain;
    }

    // sub oscillator: clean sine an octave down, centered, for weight
    if (st.subOsc > 0) {
      subPhase += (fOsc * 0.5) / SR; if (subPhase >= 1) subPhase -= 1;
      const sub = Math.sin(2 * Math.PI * subPhase) * st.subOsc;
      const k = 1 - st.subOsc * 0.5;
      oscL = oscL * k + sub; oscR = oscR * k + sub;
    }

    // noise (centered)
    let sL = oscL, sR = oscR;
    if (st.noise > 0) {
      let wn = rnd();
      if (noiseColor > 0) {   // lowpass toward brown; blend white↔brown by color (makeup for the level drop)
        brownN += (wn - brownN) * (1 - noiseColor * 0.98);
        wn = wn * (1 - noiseColor) + brownN * noiseColor * (1 + noiseColor * 4);
      }
      const nz = wn * st.noise, k = 1 - st.noise;
      sL = oscL * k + nz; sR = oscR * k + nz;
    }

    // ring modulation: multiply the source by a sine carrier -> inharmonic,
    // metallic/clangy partials. Dry/wet blended by the mix amount.
    if (st.ringMod > 0) {
      ringPhase += st.ringFreq / SR; if (ringPhase >= 1) ringPhase -= 1;
      const rm = Math.sin(2 * Math.PI * ringPhase), mix = st.ringMod;
      sL = sL * (1 - mix) + sL * rm * mix;
      sR = sR * (1 - mix) + sR * rm * mix;
    }

    // amp envelope (AHDSR-ish)
    let env;
    if (lt < atk) env = atk > 0 ? lt / atk : 1;
    else if (lt < atk + hold) env = 1;
    else if (lt < atk + hold + dec) { const d = (lt - atk - hold) / (dec || 1e-9); env = susLevel + (1 - susLevel) * Math.pow(1 - d, eexp); }
    else if (lt < relStart) env = susLevel;
    else { const r = rel > 0 ? (lt - relStart) / rel : 1; env = susLevel * Math.pow(1 - r, eexp); }
    if (env < 0) env = 0;
    sL *= env; sR *= env;

    // resonant low-pass — TPT / zero-delay-feedback state-variable filter
    // (Zavalishin). Unconditionally stable at ALL cutoffs; the old Chamberlin SVF
    // self-oscillated at Nyquist once cutoff neared SR/4, which turned bright sounds
    // into 22 kHz buzz that plays back as clicks/silence.
    let cut = baseCut * Math.pow(2, filtEnv * 3 * prog);
    cut = Math.min(Math.max(cut, 20), 20000);
    const g = Math.tan(Math.PI * cut / SR);
    const k = Math.max(2 - 1.9 * st.reso, 0.1);       // damping = 1/Q
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    // The SVF yields all responses at once: v2 = LP, v1 = BP, hp = HP.
    // notch = HP + LP, peak = LP - HP. fmode selects which one we keep.
    {
      const x = sL;
      const v3 = x - ic2L;
      const v1 = a1 * ic1L + a2 * v3;
      const v2 = ic2L + a2 * ic1L + a3 * v3;
      ic1L = 2 * v1 - ic1L; ic2L = 2 * v2 - ic2L;
      const hp = x - k * v1 - v2;
      sL = fmode === 0 ? v2 : fmode === 1 ? hp : fmode === 2 ? v1 : fmode === 3 ? hp + v2 : v2 - hp;
    }
    {
      const x = sR;
      const v3 = x - ic2R;
      const v1 = a1 * ic1R + a2 * v3;
      const v2 = ic2R + a2 * ic1R + a3 * v3;
      ic1R = 2 * v1 - ic1R; ic2R = 2 * v2 - ic2R;
      const hp = x - k * v1 - v2;
      sR = fmode === 0 ? v2 : fmode === 1 ? hp : fmode === 2 ? v1 : fmode === 3 ? hp + v2 : v2 - hp;
    }

    // crunch: tanh drive + bitcrush
    if (st.drive > 0) {
      const d = 1 + st.drive * 40, norm = Math.tanh(d), amp = 0.6 + 0.4 * (1 - st.drive);
      const OS = Math.max(1, Math.round(st.driveOS));
      if (OS <= 1) {
        sL = Math.tanh(sL * d) / norm * amp;
        sR = Math.tanh(sR * d) / norm * amp;
      } else {
        // oversample the nonlinearity: interpolate from the previous input toward
        // this one, shape each subsample, then average back down. The drive's new
        // harmonics land above the base rate's Nyquist, so far less aliasing folds
        // back — a cleaner crunch. Free here because rendering is offline.
        const pL = xprevL, pR = xprevR;
        let accL = 0, accR = 0;
        for (let s = 1; s <= OS; s++) {
          const f = s / OS;
          accL += Math.tanh((pL + (sL - pL) * f) * d);
          accR += Math.tanh((pR + (sR - pR) * f) * d);
        }
        xprevL = sL; xprevR = sR;
        sL = accL / OS / norm * amp;
        sR = accR / OS / norm * amp;
      }
    }
    const bits = Math.round(st.bitcrush);
    if (bits < 16) {
      const levels = Math.pow(2, bits);
      sL = Math.round(sL * levels) / levels;
      sR = Math.round(sR * levels) / levels;
    }

    // add the deep body last, using local time so it re-fires per shot in bursts
    if (boom > 0) {
      if (shotIdx !== prevShot) { boomPhase = 0; prevShot = shotIdx; }  // retrigger phase
      const bEnv = Math.exp(-lt / boomDec);                              // own long decay
      const bf = boomF0 * Math.pow(2, -boomDrop * Math.min(1, lt / boomDec)); // pitch drop
      boomPhase += bf / SR; if (boomPhase >= 1) boomPhase -= 1;
      const b = Math.sin(2 * Math.PI * boomPhase) * bEnv * boom;
      sL += b; sR += b;
    }

    L[i] = sL; R[i] = sR;
  }

  // downsample crunch (sample-and-hold)
  const ds = Math.round(st.downsample);
  if (ds > 1) {
    let hL = 0, hR = 0;
    for (let i = 0; i < n; i++) {
      if (i % ds === 0) { hL = L[i]; hR = R[i]; }
      L[i] = hL; R[i] = hR;
    }
  }

  // modulation FX (chorus/phaser) before the delay/reverb tail — no-ops when their mix is 0
  chorusProcess(L, R, st.chorusMix, st.chorusRate, st.chorusDepth);
  phaserProcess(L, R, st.phaserMix, st.phaserRate, st.phaserDepth);

  // feedback delay, then reverb -> space & depth.
  if (st.delay > 0) {
    const dt = Math.max(1, Math.round(st.delayTime * SR));
    const fbk = st.delayFb, wet = st.delay, pp = st.pingpong;
    if (pp <= 0) {
      // per-channel feedback delay (unchanged / byte-identical when ping-pong is off)
      for (const buf of [L, R]) {
        const acc = new Float32Array(n);
        for (let i = 0; i < n; i++) acc[i] = buf[i] + (i >= dt ? fbk * acc[i - dt] : 0);
        for (let i = dt; i < n; i++) buf[i] += wet * acc[i - dt];
      }
    } else {
      // ping-pong: one mono feedback line whose successive dt-taps alternate L/R (pp = how hard)
      const acc = new Float32Array(n);
      for (let i = 0; i < n; i++) acc[i] = (L[i] + R[i]) * 0.5 + (i >= dt ? fbk * acc[i - dt] : 0);
      for (let i = dt; i < n; i++) {
        const echo = wet * acc[i - dt], tap = Math.floor(i / dt) & 1;
        L[i] += echo * (tap ? 1 : 1 - pp);
        R[i] += echo * (tap ? 1 - pp : 1);
      }
    }
  }
  if (st.reverb > 0) reverbProcess(L, R, st.reverbSize, st.reverbTone, st.reverb);

  // convolution reverb (synthesized IRs) — parallel wet mix; decorrelated L/R IRs = stereo width.
  // Tail truncated at n like the delay/Freeverb stages. FFT only runs when engaged (convMix > 0).
  if (st.convMix > 0) {
    const ct = Math.round(st.convType);
    let irL = null, irR = null;
    if (ct >= 4) {                                          // "Custom IR": convolve with the user-loaded space (if any)
      if (customIR) {
        if (st.convTone >= 0.999) { irL = customIR.L; irR = customIR.R; }   // verbatim (bright) — use as-is
        else { const t = toneIR(customIR.L, customIR.R, st.convTone); irL = t.L; irR = t.R; }   // Conv tone darkens it
      }
    } else {                                                // built-in synthesized spaces (Room/Hall/Plate/Spring)
      irL = makeIR(ct, st.convSize, st.convTone, 0x1234abcd);
      irR = makeIR(ct, st.convSize, st.convTone, 0x9e3779b9);
    }
    if (irL) {                                              // (Custom IR selected but none loaded → skip, stays dry)
      const wetL = convolveFFT(L, irL), wetR = convolveFFT(R, irR);
      const mix = st.convMix, dryG = 1 - mix, wetG = mix * CONV_MAKEUP;
      for (let i = 0; i < n; i++) { L[i] = L[i] * dryG + wetL[i] * wetG; R[i] = R[i] * dryG + wetR[i] * wetG; }
    }
  }

  // master transient shaper (punch up / soften attacks) — before normalize since it moves peaks
  if (st.transient !== 0) transientShape(L, R, st.transient);

  // measure intrinsic peak (before gain) for loudness normalization + audibility
  let rawPeak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]); if (a > rawPeak) rawPeak = a;
    const b = Math.abs(R[i]); if (b > rawPeak) rawPeak = b;
  }
  // normalize quiet-but-present sounds up to a consistent level (capped so we never
  // amplify near-silence into hiss); the user gain then trims from there.
  let norm = 1;
  if (normalizeOut && rawPeak > AUDIBLE_FLOOR) norm = Math.min(NORM_TARGET / rawPeak, NORM_MAX_BOOST);

  // gain + short fade-out
  const g = st.gain * norm;
  const fade = Math.min(256, Math.floor(n * 0.02));
  for (let i = 0; i < n; i++) {
    let l = L[i] * g, r = R[i] * g;
    if (i > n - fade) { const kf = (n - i) / fade; l *= kf; r *= kf; }
    L[i] = l; R[i] = r;
  }
  // master limiter (lookahead brickwall) — bounds to its ceiling; louder/denser as it rises
  if (st.limiter > 0) limiterProcess(L, R, st.limiter);
  // final safety clip (a no-op when the limiter is engaged, since it stays under its ceiling)
  for (let i = 0; i < n; i++) { L[i] = Math.max(-1, Math.min(1, L[i])); R[i] = Math.max(-1, Math.min(1, R[i])); }
  // Reverse (default 0 = off → existing sounds byte-identical). Flip only the AUDIBLE span so
  // trailing silence stays at the end instead of becoming a leading gap; a reverb tail then swells
  // forward into the transient (reverse cymbal / whoosh / riser). Short declick at both new ends.
  if (st.reverse) {
    let last = n - 1;
    while (last > 0 && Math.abs(L[last]) < 1e-4 && Math.abs(R[last]) < 1e-4) last--;
    for (let i = 0, j = last; i < j; i++, j--) {
      const tl = L[i]; L[i] = L[j]; L[j] = tl;
      const tr = R[i]; R[i] = R[j]; R[j] = tr;
    }
    const dc = Math.min(fade, last >> 1) || 1;
    for (let i = 0; i < dc; i++) { const k = i / dc; L[i] *= k; R[i] *= k; L[last - i] *= k; R[last - i] *= k; }
  }
  return { L, R, rawPeak };
}

// ---------- WAV encoding ----------
// Pure byte-shuffling: patch -> audio -> file, all in one unit. Lives here rather than in the
// app because anything consuming the engine also needs to write the result out (CrunchyVFX
// ships the matched sound beside the sprite sheet). The DOM/Tauri save path stays in the app.

// Linear resample a mono buffer. Fine for sfx (offline, no real-time deadline); when the
// target rate matches SR the input buffer is returned untouched (bit-exact passthrough).
function resampleLinear(buf, srcRate, dstRate) {
  if (srcRate === dstRate || !buf.length) return buf;
  const ratio = dstRate / srcRate;
  const n = Math.max(1, Math.round(buf.length * ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ratio;                                  // source position
    const i0 = Math.floor(t), i1 = Math.min(i0 + 1, buf.length - 1);
    const frac = t - i0;
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  return out;
}

// One RIFF chunk: id(4) + size(4) + body, body zero-padded to an even length (WAV spec).
// `size` is the unpadded body length. Returns a Uint8Array (full chunk).
function wavChunk(id, body) {
  const pad = body.length & 1;
  const out = new Uint8Array(8 + body.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
// LIST/INFO metadata: software tag (always) + title (if given). null if nothing to write.
function wavInfoChunk(title) {
  const subs = [wavChunk("ISFT", new TextEncoder().encode("CrunchySFX\0"))];
  if (title) subs.push(wavChunk("INAM", new TextEncoder().encode(title + "\0")));
  let len = 4; for (const s of subs) len += s.length;
  const body = new Uint8Array(len);
  body.set([73, 78, 70, 79], 0);   // "INFO"
  let o = 4; for (const s of subs) { body.set(s, o); o += s.length; }
  return wavChunk("LIST", body);
}
// smpl chunk with a single forward loop over the whole file (frames 0..end, infinite play).
function wavSmplChunk(rate, frames) {
  const b = new Uint8Array(60), v = new DataView(b.buffer);
  v.setUint32(8, Math.round(1e9 / rate), true);   // sample period (ns); others default 0
  v.setUint32(12, 60, true);                       // MIDI unity note
  v.setUint32(28, 1, true);                        // one sample loop
  v.setUint32(48, Math.max(0, frames - 1), true);  // loop end frame (start=0, type=forward=0)
  return wavChunk("smpl", b);
}

function encodeWav(L, R, opts) {
  const rate = (opts && opts.rate) || SR;
  const depth = (opts && opts.depth) || 16;               // 16 or 24
  const channels = (opts && opts.channels) || 2;          // 1 (mono) or 2 (stereo)
  const loop = !!(opts && opts.loop);
  const title = opts && opts.title ? String(opts.title) : "";
  let l = resampleLinear(L, SR, rate);
  let r = resampleLinear(R, SR, rate);
  if (channels === 1) {                                   // downmix to mono
    const m = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) m[i] = (l[i] + r[i]) * 0.5;
    l = r = m;
  }
  const bytesPer = depth / 8;                             // 2 or 3
  const blockAlign = channels * bytesPer;
  const frames = l.length;

  // fmt chunk body (16 bytes)
  const fmt = new Uint8Array(16), fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true);                    // PCM
  fv.setUint16(2, channels, true);
  fv.setUint32(4, rate, true);
  fv.setUint32(8, rate * blockAlign, true);    // byte rate
  fv.setUint16(12, blockAlign, true);
  fv.setUint16(14, depth, true);

  // data chunk body (the PCM samples)
  const data = new Uint8Array(frames * blockAlign);
  const dv = new DataView(data.buffer);
  let off = 0;
  const write16 = (s) => { s = Math.max(-1, Math.min(1, s)); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2; };
  const write24 = (s) => {
    s = Math.max(-1, Math.min(1, s));
    const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);   // signed 24-bit
    dv.setUint8(off, v & 0xff); dv.setUint8(off + 1, (v >> 8) & 0xff); dv.setUint8(off + 2, (v >> 16) & 0xff); off += 3;
  };
  const writeSample = depth === 24 ? write24 : write16;
  for (let i = 0; i < frames; i++) {
    writeSample(l[i]);
    if (channels === 2) writeSample(r[i]);
  }

  // Assemble RIFF. fmt + data stay first (audio at the standard offset 44); metadata /
  // loop chunks follow so naive offset-44 readers still find the samples.
  const chunks = [wavChunk("fmt ", fmt), wavChunk("data", data), wavInfoChunk(title)];
  if (loop) chunks.push(wavSmplChunk(rate, frames));
  let bodyLen = 4; for (const c of chunks) bodyLen += c.length;   // "WAVE" + chunks
  const out = new Uint8Array(8 + bodyLen);
  const ov = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0);   // "RIFF"
  ov.setUint32(4, bodyLen, true);
  out.set([87, 65, 86, 69], 8);   // "WAVE"
  let o = 12; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;   // ArrayBuffer of the .wav file
}
// ==== parameter table (from index.html) ====================================================
// Carried so consumers read the canonical defaults instead of maintaining their own copy.
const FILTER_MODES = ["lowpass", "highpass", "bandpass", "notch", "peak"];
const WAVES = ["sine", "square", "saw", "triangle", "pulse", "FM", "organ", "half-sine", "pluck", "sample", "modal", "granular", "custom", "formant", "bubble", "particle", "additive", "speech", "FM 4op", "impact", "whoosh"];

const PARAMS = [
  // Oscillator
  ["wave",       "Waveform",   0, WAVES.length - 1, 1, 2, "",   "Oscillator", "wave"],
  ["freq",       "Frequency",  20, 4000, 1, 440, "Hz", "Oscillator"],
  ["sweep",      "Pitch sweep",-1, 1, 0.01, 0, "",  "Oscillator"],
  ["vibDepth",   "Vibrato",    0, 1, 0.01, 0, "",   "Oscillator"],
  ["vibRate",    "Vib rate",   0, 40, 0.1, 6, "Hz", "Oscillator"],
  ["unison",     "Unison",     1, 7, 1, 1, "v",     "Oscillator"],
  ["detune",     "Detune",     0, 50, 0.5, 12, "ct","Oscillator"],
  // Pulse width + PWM (applies to the pulse wave); pluck damping (Karplus-Strong). These live in
  // their own groups so their panels only appear when the matching waveform is selected (see
  // PANEL_WAVES / updateWavePanels) — keeps the editor uncluttered as waveforms proliferate.
  ["pulseWidth", "Pulse width",0.05, 0.95, 0.01, 0.25, "", "Pulse (PWM)"],
  ["pwmDepth",   "PWM depth",  0, 0.45, 0.01, 0, "",  "Pulse (PWM)"],
  ["pwmRate",    "PWM rate",   0, 20, 0.1, 2, "Hz",   "Pulse (PWM)"],
  ["pluckDamp",  "Pluck damp", 0, 1, 0.01, 0.5, "",   "Pluck"],
  // Modal resonator bank (wave "modal"): struck bells / bars / metal / mallets. A sum of
  // exponentially-decaying tuned partials; inharm morphs harmonic->bar/bell ratios. Ignored
  // unless wave is "modal", so defaults are neutral for every existing preset.
  ["modalPartials","Modal partials",1, 16, 1, 6, "",  "Modal"],
  ["modalDecay",  "Modal decay", 0.05, 3, 0.01, 0.6, "s", "Modal"],
  ["modalInharm", "Modal inharm",0, 1, 0.01, 0, "",   "Modal"],
  ["modalBright", "Modal bright",0, 1, 0.01, 0.5, "", "Modal"],
  // Granular synthesis (wave "granular"): grain cloud over the imported sample, or a synth tone
  // when none is loaded. scan decouples time from pitch. Ignored unless wave is "granular".
  ["grainSize",   "Grain size",  5, 200, 1, 60, "ms", "Granular"],
  ["grainDensity","Grain density",1, 80, 1, 20, "/s", "Granular"],
  ["grainSpray",  "Grain spray", 0, 1, 0.01, 0, "",   "Granular"],
  ["grainScan",   "Grain scan",  0, 2, 0.01, 1, "x",  "Granular"],
  ["grainSpread", "Grain spread",0, 1, 0.01, 0, "",   "Granular"],
  // Wave Morph (wave "custom"): blend the drawn Wave A into a second drawn Wave B. `morph` is the
  // A→B blend at the start; `morphSweep` (±) is how far the blend travels over the sound's duration
  // (+ toward B, − toward A). Both default 0 → pure Wave A, so existing custom-wave patches are
  // byte-identical. Only apply when wave is "custom".
  ["morph",       "Morph A→B",  0, 1, 0.01, 0, "",     "Wave morph"],
  ["morphSweep",  "Morph sweep",-1, 1, 0.01, 0, "",    "Wave morph"],
  // Formant / vocal (wave "formant"): a buzz source through 3 tuned resonators = vowels / voices /
  // creatures. Ignored unless wave is "formant", so defaults don't affect existing presets.
  ["formantVowel","Vowel",      0, 1, 0.01, 0, "",     "Formant"],
  ["formantSize", "Voice size", 0.5, 2, 0.01, 1, "",   "Formant"],
  ["formantQ",    "Formant Q",  0, 1, 0.01, 0.5, "",   "Formant"],
  ["formantBreath","Breath",    0, 1, 0.01, 0, "",     "Formant"],
  // Vowel LFO — slowly morphs the vowel over time so the voice "talks" (aa-ee-oo). Both default 0
  // (off) so existing formant presets are unchanged.
  ["formantLfoRate","Vowel rate",0, 8, 0.01, 0, "Hz",  "Formant"],
  ["formantLfoDepth","Vowel move",0, 1, 0.01, 0, "",   "Formant"],
  // Bubble / water (wave "bubble"): scattered decaying rising-pitch sines (the Minnaert bubble
  // model) → drops / streams / boiling. Ignored unless wave is "bubble".
  ["bubbleRate",  "Bubble rate",1, 60, 1, 8, "/s",     "Bubble"],
  ["bubbleRise",  "Pitch rise", 0, 1, 0.01, 0.5, "",   "Bubble"],
  ["bubbleSpread","Bubble spread",0, 1, 0.01, 0.3, "", "Bubble"],
  ["bubbleDecay", "Bubble decay",0, 1, 0.01, 0.4, "",  "Bubble"],
  // Particle / crackle (wave "particle"): scattered resonant noise bursts → fire / rain / sparks /
  // footsteps / geiger / sizzle. Ignored unless wave is "particle".
  ["particleRate","Particle rate",5, 200, 1, 40, "/s", "Particle"],
  ["particleTone","Particle tone",0, 1, 0.01, 0.5, "", "Particle"],
  ["particleDecay","Particle decay",0, 1, 0.01, 0.3, "","Particle"],
  ["particleSpread","Particle spread",0, 1, 0.01, 0.5, "","Particle"],
  // Impact / blast engine (wave 19): crack + body of a percussive hit. Caliber/thump = shared
  // boom layer; environment = convolution reverb / delay. Only apply when wave==impact.
  ["impactTone",  "Impact tone", 0, 1, 0.01, 0.5, "",  "Impact"],
  ["impactDecay", "Impact decay",0, 1, 0.01, 0.3, "",  "Impact"],
  ["impactPunch", "Impact punch",0, 1, 0.01, 0.6, "",  "Impact"],
  ["impactGrit",  "Impact grit", 0, 1, 0.01, 0.3, "",  "Impact"],
  // Whoosh / air engine (wave 20): swept band-passed noise = a swing through air. Only when wave==whoosh.
  ["whooshTone",  "Whoosh tone", 0, 1, 0.01, 0.5, "",  "Whoosh"],
  ["whooshSweep", "Whoosh sweep",0, 1, 0.01, 0.5, "",  "Whoosh"],
  ["whooshBody",  "Whoosh body", 0, 1, 0.01, 0.3, "",  "Whoosh"],
  ["whooshPeak",  "Whoosh peak", 0, 1, 0.01, 0.4, "",  "Whoosh"],
  // Additive / spectral pad (wave "additive"): a stack of harmonics, each with its own slowly
  // drifting amplitude → evolving pads / drones / choirs. Ignored unless wave is "additive".
  ["addPartials", "Partials",   1, 48, 1, 12, "",     "Additive"],
  ["addTilt",     "Brightness", 0, 1, 0.01, 0.4, "",  "Additive"],
  ["addDrift",    "Drift depth",0, 1, 0.01, 0.5, "",  "Additive"],
  ["addDriftRate","Drift rate", 0.02, 2, 0.01, 0.15, "Hz", "Additive"],
  ["addDetune",   "Detune/width",0, 1, 0.01, 0.4, "", "Additive"],
  // Speech (wave "speech"): retro formant speech synth. Text lives in state.speechText (a text box
  // in the Speech panel); these shape the voice. Pitch = Frequency. Ignored unless wave is "speech".
  ["speechRate",  "Speak rate", 0.5, 2, 0.01, 1, "x",  "Speech"],
  ["speechSize",  "Voice size", 0.5, 2, 0.01, 1, "",   "Speech"],
  // 4-operator FM synth (wave "FM 4op"): DX-style. algorithm picks the operator routing; op1 is the
  // base carrier (ratio 1), op2/3/4 ratios set the timbre; index = FM depth; feedback = grit.
  ["fmAlgo",      "FM algorithm",0, 5, 1, 0, "", "FM synth", "enum", ["Chain", "Y-Mod", "Twin", "3→Carrier", "Y+Carrier", "Additive"]],
  ["fmRatio2",    "Op2 ratio",  0.5, 16, 0.5, 1, "", "FM synth"],
  ["fmRatio3",    "Op3 ratio",  0.5, 16, 0.5, 2, "", "FM synth"],
  ["fmRatio4",    "Op4 ratio",  0.5, 16, 0.5, 3, "", "FM synth"],
  ["fmIndex",     "FM index",   0, 1, 0.01, 0.5, "", "FM synth"],
  ["fmFeedback",  "FM feedback",0, 1, 0.01, 0, "", "FM synth"],
  // Mix
  ["noise",      "Noise mix",  0, 1, 0.01, 0, "",   "Mix"],
  ["subOsc",     "Sub osc",    0, 1, 0.01, 0, "",   "Mix"],
  ["ringMod",    "Ring mod",   0, 1, 0.01, 0, "",   "Mix"],
  ["ringFreq",   "Ring freq",  0, 2000, 1, 200, "Hz","Mix"],
  ["noiseColor", "Noise color",0, 1, 0.01, 0, "",   "Mix"],   // 0 white → 1 brown (pink in between)
  // Body: a deep sine layer with its own long decay + pitch drop, for weight/depth
  ["boom",       "Boom level", 0, 1, 0.01, 0, "",    "Body"],
  ["boomFreq",   "Boom freq",  25, 200, 1, 80, "Hz", "Body"],
  ["boomDrop",   "Boom drop",  0, 3, 0.01, 0.6, "oct","Body"],
  ["boomDecay",  "Boom decay", 0.02, 1.2, 0.01, 0.25, "s", "Body"],
  // Amp envelope
  ["attack",     "Attack",     0, 0.5, 0.001, 0.005, "s", "Amp Envelope"],
  ["decay",      "Decay",      0, 1, 0.001, 0.12, "s",  "Amp Envelope"],
  ["sustain",    "Sustain",    0, 1, 0.01, 0.0, "",     "Amp Envelope"],
  ["release",    "Release",    0, 1.5, 0.001, 0.1, "s", "Amp Envelope"],
  ["hold",       "Hold",       0, 1, 0.001, 0.02, "s",  "Amp Envelope"],
  ["envCurve",   "Env curve",  0, 1, 0.01, 0, "",       "Amp Envelope"],   // 0 linear → 1 exponential
  // Filter
  ["filterMode", "Filter type",0, FILTER_MODES.length - 1, 1, 0, "", "Filter", "enum", FILTER_MODES],
  ["cutoff",     "Cutoff",     40, 12000, 1, 8000, "Hz", "Filter"],
  ["reso",       "Resonance",  0, 0.95, 0.01, 0.1, "",   "Filter"],
  ["filtEnv",    "Filter env", -1, 1, 0.01, 0, "",       "Filter"],
  // Crunch
  ["drive",      "Drive",      0, 1, 0.01, 0.1, "",  "Crunch"],
  ["driveOS",    "Drive OS",   1, 8, 1, 1, "x",     "Crunch"],
  ["bitcrush",   "Bit depth",  1, 16, 1, 16, "bit", "Crunch"],
  ["downsample", "Downsample", 1, 32, 1, 1, "x",    "Crunch"],
  // Space
  ["width",      "Stereo width",0, 1, 0.01, 0.4, "", "Space"],
  ["reverb",     "Reverb mix", 0, 1, 0.01, 0, "",    "Space"],
  ["reverbSize", "Reverb size",0, 1, 0.01, 0.6, "",  "Space"],
  ["reverbTone", "Reverb tone",0, 1, 0.01, 0.5, "",  "Space"],
  // Convolution reverb (synthesized IRs). convMix 0 = off, so existing presets are unchanged
  // and it costs nothing (the FFT only runs when convMix > 0).
  ["convMix",    "Conv reverb",0, 1, 0.01, 0, "",    "Space"],
  ["convType",   "Conv space", 0, 4, 1, 0, "", "Space", "enum", ["Room", "Hall", "Plate", "Spring", "Custom IR"]],
  ["convSize",   "Conv size",  0.1, 3, 0.01, 1.0, "s", "Space"],
  ["convTone",   "Conv tone",  0, 1, 0.01, 0.5, "",  "Space"],
  ["delay",      "Delay mix",  0, 1, 0.01, 0, "",     "Space"],
  ["delayTime",  "Delay time", 0.01, 0.5, 0.005, 0.15, "s", "Space"],
  ["delayFb",    "Delay fbk",  0, 0.9, 0.01, 0.35, "", "Space"],
  ["pingpong",   "Ping-pong",  0, 1, 0.01, 0, "",     "Space"],   // cross-feed L/R echoes (0 = normal delay)
  // Modulation FX (phaser + chorus). Both default mix 0 = off, so existing presets are unchanged.
  ["phaserMix",  "Phaser",     0, 1, 0.01, 0, "",     "Modulation"],
  ["phaserRate", "Phaser rate",0.05, 4, 0.01, 0.5, "Hz","Modulation"],
  ["phaserDepth","Phaser depth",0, 1, 0.01, 0.7, "",  "Modulation"],
  ["chorusMix",  "Chorus",     0, 1, 0.01, 0, "",     "Modulation"],
  ["chorusRate", "Chorus rate",0.05, 6, 0.01, 1.5, "Hz","Modulation"],
  ["chorusDepth","Chorus depth",0, 1, 0.01, 0.4, "",  "Modulation"],
  // Burst / full-auto: retrigger the whole shot N times at a fixed rate
  ["repeat",     "Shots",      1, 12, 1, 1, "x",    "Burst"],
  ["rate",       "Fire rate",  1, 30, 0.5, 10, "Hz","Burst"],
  // Arpeggio: shift each repeat shot's pitch by N semitones (rising/falling runs). Default 0 = off.
  ["arpStep",    "Arp step",   -12, 12, 1, 0, "st", "Burst"],
  // Master finishing stage (transient shaper + lookahead limiter). Both default to off/neutral,
  // so existing presets are unchanged and there's no CPU cost until engaged.
  ["transient",  "Transient",  -1, 1, 0.01, 0, "",      "Master"],
  ["limiter",    "Limiter",    0, 1, 0.01, 0, "",        "Master"],
  ["reverse",    "Reverse",    0, 1, 1, 0, "",           "Master"],
  // Output
  ["gain",       "Gain",       0, 1, 0.01, 0.7, "",     "Output"],
  ["duration",   "Duration",   0.05, 2, 0.01, 0.4, "s", "Output"],
];

const DEFAULTS = {};
for (const p of PARAMS) DEFAULTS[p[0]] = p[5];

root.CrunchySynth = {
  VERSION: "1.1.0",
  BUILT: "a8c4bbc-dirty",
  SHA256: "546d831dfa8298e6f147865b4bccbcf319e23539e0a34452e8c3a3573ad1661f",
  SR: SR,
  PARAMS: PARAMS,
  DEFAULTS: DEFAULTS,
  // renderPatch(patch, { sample, normalize }) -> { L, R, rawPeak }
  render: renderPatch,
  // encodeWav(L, R, { rate, depth, channels, loop, title }) -> ArrayBuffer
  encodeWav: encodeWav,
};
})(typeof window !== "undefined" ? window : globalThis);
