/* spring/measure.mjs — what the agent checks instead of listening. Reads the AUDIO, never the model's internals (the
 * design is only used to print the PREDICTION beside the measurement). The generic meters (level, NaN, edges, pitch,
 * onsets, the 44.1-vs-176.4 kHz alias check) are the chirp prototype's, imported read-only. */
import { fft, measure, fmtMeasure, aliasCheck } from "../chirp/measure.mjs";
export { measure, fmtMeasure, aliasCheck };

const TAU = 2 * Math.PI;
export const mono = (L, R) => { const m = new Float64Array(L.length); for (let i = 0; i < L.length; i++) m[i] = 0.5 * (L[i] + R[i]); return m; };

// band envelope: TPT band-pass (Q 4) -> |x| -> one-pole 1 ms, run forward and backward (no lag, so arrival times are real)
export function bandEnv(x, sr, f, q = 4) {   // two band-passes in cascade (4th order): a loud neighbor band must not leak in
  const g = Math.tan(Math.PI * f / sr), k = 1 / q, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const s = [0, 0, 0, 0], e = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let u = x[i];
    for (let b = 0; b < 2; b++) {
      const v3 = u - s[2 * b + 1], v1 = a1 * s[2 * b] + a2 * v3, v2 = s[2 * b + 1] + a2 * s[2 * b] + a3 * v3;
      s[2 * b] = 2 * v1 - s[2 * b]; s[2 * b + 1] = 2 * v2 - s[2 * b + 1]; u = k * v1;
    }
    e[i] = Math.abs(u);
  }
  const c = Math.exp(-1 / (0.001 * sr));
  let y = 0; for (let i = 0; i < e.length; i++) { y = c * y + (1 - c) * e[i]; e[i] = y; }
  y = 0; for (let i = e.length - 1; i >= 0; i--) { y = c * y + (1 - c) * e[i]; e[i] = y; }
  return e;
}

/* ECHO CHIRPS: in each band, the arrival times of the first `nEcho` echoes (envelope maxima that are the largest within
 * +-minGap of themselves and within 40 dB of the band's loudest). Echo k is then a set of (frequency, time) points; a least-squares line of
 * time against log2(frequency) gives its sweep: seconds per octave, and so octaves per second and a DIRECTION
 * (higher bands first = FALLING). `span` = arrival of the lowest band minus the highest. */
export function echoChirps(x, sr, bandsHz, minGapS, nEcho) {
  const arr = bandsHz.map((f) => {
    // an arrival = an envelope sample that is the largest within +-minGap of itself and within 40 dB of the band's loudest
    const e = bandEnv(x, sr, f), gap = Math.round(minGapS * sr); let mx = 0; for (const v of e) mx = Math.max(mx, v);
    const pk = [];
    for (let i = 1; i < e.length - 1 && pk.length < nEcho; i++) {
      if (!(e[i] >= e[i - 1] && e[i] > e[i + 1] && e[i] > 0.01 * mx)) continue;
      let top = true; for (let q = Math.max(0, i - gap); q < Math.min(e.length, i + gap) && top; q++) if (e[q] > e[i]) top = false;
      // minus the meter's own delay: two band-passes in cascade delay their center by 2 Q / (pi f)
      if (top) { pk.push({ t: i / sr - 2 * 4 / (Math.PI * f), db: 20 * Math.log10(e[i] / mx) }); i += gap; }
    }
    return pk;
  });
  const echoes = [];
  for (let k = 0; k < nEcho; k++) {
    const pts = bandsHz.map((f, b) => arr[b][k] ? { f, t: arr[b][k].t } : null).filter(Boolean);
    if (pts.length < 2) break;
    const xs = pts.map((p) => Math.log2(p.f)), ys = pts.map((p) => p.t), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const sPerOct = sxy / sxx;
    echoes.push({ k: k + 1, pts, sPerOct, octPerS: 1 / sPerOct, dir: Math.abs(sPerOct) < 3e-3 ? "flat (inside the meter floor, 3 ms/oct)" : sPerOct < 0 ? "FALLING" : "RISING",
      spanMs: 1000 * (pts[0].t - pts[pts.length - 1].t) });
  }
  return echoes;
}
export function fmtEchoes(ec) {
  return ec.map((e) => "echo " + e.k + ": " + e.pts.map((p) => (p.f >= 1000 ? (p.f / 1000).toFixed(1) + "k" : p.f.toFixed(0)) + "@" + (1000 * p.t).toFixed(0)).join(" ") +
    " ms -> " + e.dir + " " + Math.abs(e.octPerS).toFixed(0) + " oct/s (low-band minus high-band " + e.spanMs.toFixed(0) + " ms)").join("\n");
}

// spectrum of a Hann window: magnitude per bin
function spectrum(x, start, N) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[start + i] || 0) * (0.5 - 0.5 * Math.cos(TAU * i / N));
  fft(re, im); const m = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) m[k] = Math.hypot(re[k], im[k]); return m;
}
/* PARTIALS (doorstop): the strongest spectral peaks of a 0.37 s window starting 25 ms in, at least 0.6 f0 apart, sorted
 * by frequency; each reported as its ratio to the lowest. A harmonic string reads 1, 2, 3 ...; a dispersive one is
 * STRETCHED (ratios above n) or compressed. */
export function partials(x, sr, f0, count = 8) {
  const N = 16384, m = spectrum(x, Math.round(0.025 * sr), N), hz = sr / N, peaks = [];
  for (let k = 2; k < N / 2 - 1; k++) if (m[k] > m[k - 1] && m[k] >= m[k + 1] && k * hz > 0.5 * f0) peaks.push({ k, v: m[k] });
  peaks.sort((a, b) => b.v - a.v);
  const keep = [];
  for (const p of peaks) { if (keep.length >= count) break; if (keep.every((q) => Math.abs(q.k - p.k) * hz > 0.6 * f0) && p.v > peaks[0].v * 0.01) keep.push(p); }
  keep.sort((a, b) => a.k - b.k);
  const fr = keep.map((p) => { const a = m[p.k - 1], b = m[p.k], c = m[p.k + 1], d = (a - c) / (2 * (a - 2 * b + c) || 1); return (p.k + d) * hz; });
  return fr.map((f) => ({ f, ratio: f / fr[0] }));
}
// the rate of the strongest slow modulation of the level (the sway): 5 ms RMS frames in log, minus a 0.4 s moving
// average (removes the decay however it curves), Hann, FFT; strongest peak 2-30 Hz, and its depth (p90 - p10, dB)
export function modRate(x, sr, from = 0.03, to = null) {
  const H = Math.round(0.005 * sr), fr = [];
  const end = to ? Math.min(x.length, Math.round(to * sr)) : x.length;
  for (let s = Math.round(from * sr); s + H <= end; s += H) { let q = 0; for (let i = s; i < s + H; i++) q += x[i] * x[i]; fr.push(Math.log(Math.sqrt(q / H) + 1e-9)); }
  const n = fr.length, W = 40; if (n < 2 * W) return null;
  const hp = [];
  for (let i = W; i < n - W; i++) { let m = 0; for (let j = i - W; j <= i + W; j++) m += fr[j]; hp.push(fr[i] - m / (2 * W + 1)); }
  const N = 1 << Math.ceil(Math.log2(hp.length * 4)), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < hp.length; i++) re[i] = hp[i] * (0.5 - 0.5 * Math.cos(TAU * i / (hp.length - 1)));
  fft(re, im);
  const fs = 1 / 0.005; let best = 0, bv = 0;
  for (let k = 1; k < N / 2; k++) { const f = k * fs / N; if (f < 2 || f > 30) continue; const v = Math.hypot(re[k], im[k]); if (v > bv) { bv = v; best = f; } }
  const r = hp.slice().sort((a, b) => a - b);
  return { hz: best, depthDb: 20 / Math.LN10 * (r[Math.floor(0.9 * (r.length - 1))] - r[Math.floor(0.1 * (r.length - 1))]) };
}
/* FORMANT TRACK (twang): per 46 ms frame (hop 12 ms) the strongest spectral peak above `floor` Hz (above the drone's
 * fundamental, so it reads where the mouth's F2 sits), on frames within 40 dB of the loudest. */
export function formantTrack(x, sr, floor) {
  const N = 2048, H = 512, out = []; let emax = 0;
  for (let s = 0; s + N <= x.length; s += H) {
    const m = spectrum(x, s, N), hz = sr / N; let e = 0, best = 0, bv = 0;
    for (let k = 0; k < N / 2; k++) { e += m[k] * m[k]; if (k * hz >= floor && k * hz < 6000 && m[k] > bv) { bv = m[k]; best = k * hz; } }
    out.push({ t: (s + N / 2) / sr, f: best, e }); emax = Math.max(emax, e);
  }
  return out.filter((q) => q.e > emax * 1e-4);
}
// growth check: 50 ms RMS blocks; after the loudest block, the largest block relative to the loudest BEFORE it (<= 1
// means it only ever decays, allowing the sway's own swing), and the last 0.5 s against 0.5-1.0 s
export function growth(L, R, sr) {
  const B = Math.round(0.05 * sr), r = [];
  for (let s = 0; s + B <= L.length; s += B) { let q = 0; for (let i = s; i < s + B; i++) q += L[i] * L[i] + R[i] * R[i]; r.push(Math.sqrt(q / (2 * B))); }
  let pk = 0; for (let i = 1; i < r.length; i++) if (r[i] > r[pk]) pk = i;
  let worst = 0, run = r[pk];
  for (let i = pk + 1; i < r.length; i++) { worst = Math.max(worst, r[i] / run); run = Math.max(run, r[i]); }
  const mean = (a, b) => { const s = r.slice(a, b); return s.reduce((x, y) => x + y, 0) / Math.max(1, s.length); };
  return { peakBlockS: pk * 0.05, worstRise: worst, tailVsEarly: mean(r.length - 10, r.length) / Math.max(1e-30, mean(10, 20)) };
}
/* CLICK CHECK: a click is a step the sound does not otherwise make. First sample against the peak, and the largest
 * sample-to-sample step in the first 1 ms against the largest in the 30 ms after it (a ratio well above 1 = a click
 * at the start); the same at the end (the last 1 ms against the 30 ms before it), and the last sample. */
export function clicks(L, R, sr) {
  let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const step = (a, b) => { let s = 0; for (let i = Math.max(1, a); i < Math.min(L.length, b); i++) s = Math.max(s, Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1])); return s; };
  const ms = Math.round(0.001 * sr), n = L.length, db = (x) => 20 * Math.log10(Math.max(1e-12, x));
  return { firstDb: db(Math.max(Math.abs(L[0]), Math.abs(R[0])) / pk), lastDb: db(Math.max(Math.abs(L[n - 1]), Math.abs(R[n - 1])) / pk),
    startRatio: step(0, ms) / Math.max(1e-12, step(ms, 31 * ms)), endRatio: step(n - ms, n) / Math.max(1e-12, step(n - 31 * ms, n - ms)) };
}
