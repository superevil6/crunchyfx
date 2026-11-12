/* chirp/measure.mjs — what the agent checks instead of listening: level, NaN, edges, pitch track, event rates, aliasing.
 * Independent of the model: everything here reads the AUDIO (the alias check renders the model twice, at two rates). */

export function fft(re, im) {   // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const mono = (L, R) => { const m = new Float64Array(L.length); for (let i = 0; i < L.length; i++) m[i] = 0.5 * (L[i] + R[i]); return m; };
const pct = (a, p) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const median = (a) => pct(a, 0.5);
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

// pitch track: the strongest peak per 1024-frame (hop 256), parabolic, over frames within 30 dB of the loudest
export function pitchTrack(x, sr) {
  const N = 1024, H = 256, win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const fr = [];
  for (let s = 0; s + N <= x.length; s += H) {
    const re = new Float64Array(N), im = new Float64Array(N); let e = 0;
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; e += re[i] * re[i]; }
    fft(re, im);
    let best = 2, bm = 0; const mag = new Float64Array(N / 2);
    for (let k = 1; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); if (k > 4 && mag[k] > bm) { bm = mag[k]; best = k; } }
    const a = mag[best - 1], b = mag[best], c = mag[best + 1] || 0, d = (a - c) / (2 * (a - 2 * b + c) || 1);
    fr.push({ e, f: (best + d) * sr / N });
  }
  const em = Math.max(...fr.map((q) => q.e), 1e-20);
  return fr.filter((q) => q.e > em * 1e-3).map((q) => q.f);
}

// onsets from a 2 ms envelope with hysteresis (on above -14 dB of the peak, re-armed below -24 dB)
export function onsets(x, sr) {
  const H = Math.round(0.002 * sr), env = [];
  for (let s = 0; s + H <= x.length; s += H) { let m = 0; for (let i = s; i < s + H; i++) m = Math.max(m, Math.abs(x[i])); env.push(m); }
  // a slow peak reference (the loudest 2% of envelope frames) so one hot syllable does not hide the rest
  const ref = pct(env, 0.98) || 1e-9, on = [];
  let armed = true;
  for (let k = 0; k < env.length; k++) {
    if (armed && env[k] > ref * 0.2) { on.push(k * H / sr); armed = false; }
    else if (!armed && env[k] < ref * 0.063) armed = true;
  }
  return on;
}
export function rates(on) {
  if (on.length < 2) return { n: on.length };
  const ioi = []; for (let i = 1; i < on.length; i++) ioi.push(on[i] - on[i - 1]);
  const m = median(ioi), inner = ioi.filter((d) => d < 2.2 * m), gaps = ioi.filter((d) => d >= 2.2 * m);
  const groups = gaps.length + 1;
  return { n: on.length, rate: 1 / median(inner.length ? inner : ioi), groups, perGroup: on.length / groups,
    groupPeriod: groups > 1 ? (on[on.length - 1] - on[0]) / (groups - 1) * (on.length / groups) / (on.length / groups) : null,
    ioiMin: Math.min(...ioi), ioiMax: Math.max(...ioi) };
}

// whole-signal Welch PSD (Hann 2048, hop 1024), returned as power per Hz-bin up to `fmax`
export function psd(x, sr, fmax) {
  // the window scales with the rate (2048 at 44.1 kHz), so two rates get the same bin width and the same time window
  const N = 1 << Math.round(Math.log2(2048 * sr / 44100)), H = N >> 1, win = new Float64Array(N), acc = new Float64Array(N / 2);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  let frames = 0;
  for (let s = 0; s + N <= x.length; s += H) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * win[i];
    fft(re, im); for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; frames++;
  }
  const bins = Math.floor(fmax / (sr / N)), out = new Float64Array(bins);
  for (let k = 0; k < bins; k++) out[k] = acc[k] / Math.max(1, frames);
  return { p: out, hz: sr / N };
}
// resample a PSD onto `w` Hz bands so two sample rates compare band for band
function bands(ps, fmax, w) {
  const B = Math.floor(fmax / w), o = new Float64Array(B);
  for (let k = 0; k < ps.p.length; k++) { const b = Math.floor(k * ps.hz / w); if (b < B) o[b] += ps.p[k]; }
  let tot = 0; for (const v of o) tot += v; for (let b = 0; b < B; b++) o[b] /= tot || 1;
  return o;
}
/* ALIAS CHECK: render at 44.1 kHz and at 4x that; an alias-free render has the same normalized spectrum below 16 kHz.
 * Returns the energy of the difference (total-variation distance) as dB, in 50 Hz bands (fine: also reads line
 * structure and filter discretization) and in 500 Hz bands (coarse: aliasing moves energy FAR from where it belongs,
 * so this is the number that reads aliasing). `calibrate` in chirp.mjs prints both on known clean and aliasing signals. */
export function aliasCheck(lo, hi, srLo, srHi) {
  const pa = psd(lo, srLo, 16000), pb = psd(hi, srHi, 16000), out = {};
  for (const [w, k] of [[50, "fine"], [500, "coarse"]]) {
    const a = bands(pa, 16000, w), b = bands(pb, 16000, w);
    let d = 0, worst = 0, wf = 0;
    for (let i = 0; i < a.length; i++) { const q = Math.abs(a[i] - b[i]); d += q; if (q > worst) { worst = q; wf = i * w; } }
    out[k] = 10 * Math.log10(Math.max(1e-12, d / 2)); out[k + "WorstHz"] = wf;
  }
  out.diffDb = out.coarse; out.worstDb = out.fine; out.worstHz = out.fineWorstHz;
  return out;
}
// share of energy above 16 kHz (a control can't be re-rendered at another rate, so this is its alias proxy)
export function highShare(x, sr) {
  const ps = psd(x, sr, sr / 2); let hi = 0, tot = 0;
  for (let k = 0; k < ps.p.length; k++) { tot += ps.p[k]; if (k * ps.hz >= 16000) hi += ps.p[k]; }
  return 10 * Math.log10(Math.max(1e-12, hi / (tot || 1)));
}

export function measure(L, R, sr) {
  let nan = 0, pk = 0;
  for (let i = 0; i < L.length; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  const m = mono(L, R), E = Math.round(0.003 * sr);
  const edge = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * (b - a))); };
  // biggest sample-to-sample step relative to the peak, in the first and last 3 ms
  const step = (a, b) => { let s = 0; for (let i = Math.max(1, a); i < b; i++) s = Math.max(s, Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1])); return s; };
  const ft = pitchTrack(m, sr), on = onsets(m, sr);
  // gating depth: 20 ms RMS frames over the sounding span, p90 against p10 — deep = the sound stops between chirps
  const W = Math.round(0.02 * sr), fr = [];
  for (let s = 0; s + W <= m.length; s += W) { let q = 0; for (let i = s; i < s + W; i++) q += m[i] * m[i]; fr.push(Math.sqrt(q / W)); }
  let a = 0, b = fr.length - 1; const top = Math.max(...fr); while (a < b && fr[a] < top * 0.01) a++; while (b > a && fr[b] < top * 0.01) b--;
  const mid = fr.slice(a, b + 1), quiet = mid.filter((v) => v < top * 0.01).length / Math.max(1, mid.length), depth = Math.min(60, db(pct(mid, 0.9) / Math.max(1e-9, pct(mid, 0.1))));   // 60 = silent between
  return {
    sec: L.length / sr, peak: pk, nan,
    startDb: db(edge(0, E) / (pk || 1)), endDb: db(edge(L.length - E, L.length) / (pk || 1)),
    edgeStepDb: db(Math.max(step(0, E), step(L.length - E, L.length)) / (pk || 1)),
    f05: pct(ft, 0.05), f50: pct(ft, 0.5), f95: pct(ft, 0.95),
    ...rates(on), hiDb: highShare(m, sr), depth, quiet,
  };
}
export function fmtMeasure(q) {
  const f = (v, d = 0) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(d));
  return `${f(q.sec, 2)}s peak ${f(q.peak, 3)} NaN ${q.nan} | edges start ${f(q.startDb)} dB end ${f(q.endDb)} dB step ${f(q.edgeStepDb)} dB | ` +
    `pitch p5/p50/p95 ${f(q.f05)}/${f(q.f50)}/${f(q.f95)} Hz | onsets ${q.n} rate ${f(q.rate, 1)}/s groups ${q.groups ?? "-"} x ${f(q.perGroup, 1)} | gating ${f(q.depth)} dB, silent ${f(100 * q.quiet)}% | >16k ${f(q.hiDb)} dB`;
}
