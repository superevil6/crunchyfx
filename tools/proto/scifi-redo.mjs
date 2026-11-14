/* scifi-redo.mjs — the SCI-FI & HAZARD presets redesigned. PROPOSAL / A-B material: nothing here is wired into presets.js;
 * AJ listens to the labeled before/after WAVs and keeps what is better. AJ: this category is "pretty weak". Today's sound
 * is always a valid outcome, and the KEPT list says why.
 *
 *   node tools/proto/scifi-redo.mjs            renders every redesign (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/scifi-redo.mjs ref        measures today's 42 (the level bar: their median and spread)
 *   node tools/proto/scifi-redo.mjs sep        separation only (renders the new ones, prints the named pairs and the closest)
 *   node tools/proto/scifi-redo.mjs <slug>     one redesign, measured, its WAVs written (no JSON, no all-new.wav)
 *   node tools/proto/scifi-redo.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/scifi-redo.mjs x '<js>' ...         measure patches built with the voices below (osc(), wind(), S["Gas Leak"]() ...)
 *
 * TWO KINDS OF SOUND, judged differently:
 *   HAZARDS are physical, so the newer engines carry them: gas through an orifice is a JET (weather 29's turbulence, an
 *     edge-tone whistle, particle fizz); acid and sludge are bubbles and fizz (bubble 14, flow 35, particle 15); a meteor
 *     or a comet is a body tearing through air (whoosh 20 + weather) and the meteor lands (blast 31); a Tesla coil is a
 *     real arc, which SINGS at its interrupter rate (narrow driven pulses) under its spark snaps.
 *   SCI-FI DEVICES are synthetic by nature (a laser, a force field, a transporter, a scanner beep): an oscillator, FM or a
 *     ring mod IS the idiom, exactly as for the robot beeps, which were kept. What changes is the BUILD: a charge, a
 *     discharge and a tail as separate layers; an FM edge; a whoosh for a pass. Where today's is already the idiom
 *     (Laser's fast downward saw sweep) it is KEPT.
 *   THE FAMILY: 19 names bred in 2026-07 as a TREATMENT x an EVENT (Ionized / Photon / Reactor / Toxic / Warp / Alien /
 *     Radioactive / Quantum x Charge / Surge / Beam / Scan / Whoosh / Drip / Leak / Alarm / Hum / Field / Pulse) are two
 *     tables composed (ADJ, NOUN, compose()), as in horror-redo-family.mjs and fire-redo.mjs. Toxic Bubble and the two
 *     Warp Drives share an adjective but are not in it: Toxic Bubble is a physical hazard (sludge), and Warp Drive /
 *     Warp Drive 2 are a numbered device pair (engaging / dropping out), which one table entry cannot tell apart.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, Normalize ON and NOT loudness-matched:
 * each WAV is what the app's button plays. `gain` on layer 1 (the whole sound's master gain) is the one number not from a
 * design: it lands the integrated loudness on today's section median plus a stated per-sound offset (a drip is small, a
 * meteor strike big); a Limiter only where gain 1 cannot reach it, stepped down if it puts DC in.
 *
 * MEASUREMENT: loudness is BS.1770 (K-weighted, gated). Brightness is a FULL 4096-point FFT (every bin to 16 kHz), not the
 * 100 Hz-spaced probe bins of fire-redo / creature-redo-family, which miss a tonal partial; the strongest FFT peak in the
 * first 150 ms (the body), a YIN pitch track (its median and its MOVE, last quarter against first, in octaves: a laser
 * falls, a charge rises) and an event count. Separation is a distance over those (1 = a clearly audible step).
 *
 * Writes soundtests/scifi-redo/<slug>-1-now.wav, <slug>-2-new.wav, all-new.wav + KEY.md, and
 * tools/new-presets/scifi-redo.json ({ name: patch with _vary, layers last }).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
  Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ctx.window = ctx; ctx.globalThis = ctx;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS, CATS = pctx.window.PRESET_CATEGORIES;

const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };

// ============================================================================================================
// THE SCOPE (exact names, section order)
const SECTION = CATS.find((c) => c[0] === "Sci-Fi & Hazard")[1];
const REFS = ["Transformer Buzz", "Electric Sparks", "Neon Hum"];   // electrical neighbours in other sections, in the separation set

// ============================================================================================================
// MEASUREMENT
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
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
  if (L.length <= B) ms.push(block(0, L.length));
  else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
  const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
  let g = ms.filter((m) => l(m) > -70);
  if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10;
  g = g.filter((m) => l(m) > rel);
  return l(g.reduce((t, m) => t + m, 0) / g.length);
}
// a real radix-2 FFT (in place), for the brightness and the body peak: every bin, so a partial between two coarse probes
// is not missed
const FN = 4096, FH = new Float64Array(FN);
for (let i = 0; i < FN; i++) FH[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FN - 1));
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function power(x, a) {   // power spectrum of 4096 samples from a (Hann), bins 0..2047
  const re = new Float64Array(FN), im = new Float64Array(FN);
  for (let i = 0; i < FN; i++) re[i] = (x[a + i] || 0) * FH[i];
  fft(re, im);
  const p = new Float64Array(FN / 2); for (let k = 0; k < FN / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}
const BIN = SR / FN;
function spectrum(x, a) {
  const p = power(x, a); let num = 0, den = 0, lo = 0, hi = 0;
  for (let k = 1; k < FN / 2; k++) { const f = k * BIN; if (f > 16000) break; num += f * p[k]; den += p[k]; if (f < 250) lo += p[k]; if (f > 4000) hi += p[k]; }
  return { cent: den > 0 ? num / den : 0, lo: den > 0 ? lo / den : 0, hi: den > 0 ? hi / den : 0, e: den };
}
// the BODY: the strongest peak (60 Hz-8 kHz) of the averaged spectrum over the first 150 ms after the onset, and its
// level against the median bin there (a resonance stands out; broadband noise does not)
function body(mono, onset) {
  const acc = new Float64Array(FN / 2);
  for (let a = onset; a < onset + Math.round(0.15 * SR) && a + FN < mono.length + FN; a += 1024) { const p = power(mono, a); for (let k = 0; k < acc.length; k++) acc[k] += p[k]; }
  let best = 0, bk = 0; const band = [];
  for (let k = Math.ceil(60 / BIN); k < 8000 / BIN; k++) { band.push(acc[k]); if (acc[k] > best) { best = acc[k]; bk = k; } }
  const med = median(band) || 1e-30;
  return { hz: bk * BIN, prom: 10 * Math.log10(best / med) };
}
function yinTrack(x, fmin, fmax, hop = 0.01, win = 0.03, thr = 0.15) {
  const W = Math.round(win * SR), tauMax = Math.min(W - 2, Math.ceil(SR / fmin)), tauMin = Math.floor(SR / fmax), H = Math.round(hop * SR);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const out = [], d = new Float64Array(tauMax + 1), cm = new Float64Array(tauMax + 1);
  for (let a = 0; a + W + tauMax < x.length; a += H) {
    let e = 0; for (let i = 0; i < W; i++) e += x[a + i] * x[a + i];
    const rms = Math.sqrt(e / W);
    if (rms < pk * 0.05) { out.push({ t: a / SR, f: 0, ap: 1, rms }); continue; }
    for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[a + i] - x[a + i + tau]; s += q * q; } d[tau] = s; }
    let run = 0, best = -1; cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = d[tau] * tau / (run || 1e-12); }
    for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) {
      if (cm[tau] < thr) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    }
    if (best < 0) { let m = 1e9; for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; } }
    const a0 = cm[best - 1], b0 = cm[best], c0 = cm[best + 1] ?? b0, den = a0 - 2 * b0 + c0;
    const t = den !== 0 ? best + 0.5 * (a0 - c0) / den : best;
    out.push({ t: a / SR, f: SR / t, ap: b0, rms });
  }
  return out;
}
const renderCache = new Map();
function render(patch) {
  const p = Object.assign({}, patch); delete p._vary; delete p._alts;
  const key = JSON.stringify(p);
  if (renderCache.has(key)) return renderCache.get(key);
  const r = CS.render(Object.assign({}, CS.DEFAULTS, p), { normalize: true });
  const out = { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
  renderCache.set(key, out);
  return out;
}
function measure(r) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.999 || b >= 0.999) clip++; }
  const mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  const B = Math.round(0.01 * SR); let last = 0, first = -1;
  for (let a = 0; a < n; a += B) { let m = 0; for (let i = a; i < Math.min(n, a + B); i++) m = Math.max(m, Math.abs(mono[i])); if (m > pk * 0.001) { last = a + B; if (first < 0) first = a; } }
  const span = Math.max(0.02, (Math.min(n, last) - Math.max(0, first)) / SR);
  const E = Math.round(0.02 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / E + 1e-12)); }
  if (!env.length) env.push(-120);
  const mx = Math.max(...env), imx = env.indexOf(mx), f0 = Math.max(0, Math.floor(first / E));
  for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], mx - 50);
  let iatk = f0; while (iatk < imx && env[iatk] < mx - 3) iatk++;
  const atk = Math.max(0.01, (iatk - f0 + 0.5) * 0.02);
  const i80 = Math.min(env.length - 1, Math.floor((first + 0.8 * span * SR) / E)), end80 = env[i80] - mx;
  // EVENTS: separate hits on a 10 ms level (armed: a rise of 6 dB over its own minimum within 25 dB of the max is an
  // event; falling 6 dB under that event's peak re-arms): a knock-knock, a latch then a thud, a tumbler's clicks
  const E10 = Math.round(0.01 * SR), e10 = [];
  for (let a = 0; a + E10 <= n; a += E10) { let s = 0; for (let i = a; i < a + E10; i++) s += mono[i] * mono[i]; e10.push(10 * Math.log10(s / E10 + 1e-12)); }
  const m10 = Math.max(...e10);
  let bursts = 0, armed = true, ref = m10 - 60;
  for (const v0 of e10) {
    const v = Math.max(v0, m10 - 60);
    if (armed) { ref = Math.min(ref, v); if (v > ref + 6 && v > m10 - 25) { bursts++; armed = false; ref = v; } }
    else { ref = Math.max(ref, v); if (v < ref - 6) { armed = true; ref = v; } }
  }
  // TEXTURE: the fast level movement (5 ms level against its 100 ms average): rattle, creak ticks, a slide's grain
  const E5 = Math.round(0.005 * SR), e5 = [];
  for (let a = 0; a + E5 <= n; a += E5) { let q = 0; for (let i = a; i < a + E5; i++) q += mono[i] * mono[i]; e5.push(10 * Math.log10(q / E5 + 1e-12)); }
  const m5 = Math.max(...e5); let ts = 0, tn = 0;
  for (let i = 0; i < e5.length; i++) e5[i] = Math.max(e5[i], m5 - 40);
  for (let i = 10; i < e5.length - 10; i++) { if (e5[i] < m5 - 30) continue; let av = 0; for (let j = i - 10; j <= i + 10; j++) av += e5[j]; av /= 21; ts += (e5[i] - av) ** 2; tn++; }
  const texture = tn ? Math.sqrt(ts / tn) : 0;
  // SPECTRUM (full FFT) over the loud part, every 25 ms, energy-weighted; and the colour's move (last quarter / first)
  let cn = 0, cd = 0, blo = 0, bhi = 0; const cents = [];
  for (let a = Math.max(0, first); a + FN < n; a += Math.round(0.025 * SR)) {
    let e = 0; for (let i = a; i < a + FN; i++) e += mono[i] * mono[i];
    if (10 * Math.log10(e / FN + 1e-12) < mx - 20) continue;
    const s = spectrum(mono, a); cn += s.cent * e; blo += s.lo * e; bhi += s.hi * e; cd += e; cents.push(s.cent);
  }
  if (!cents.length && n > 0) { const s = spectrum(mono, Math.max(0, first)); cents.push(s.cent); cn = s.cent; cd = 1; blo = s.lo; bhi = s.hi; }
  const q = Math.max(1, Math.floor(cents.length / 4));
  const cmove = Math.log2(Math.max(100, median(cents.slice(-q))) / Math.max(100, median(cents.slice(0, q))));
  const bd = body(mono, Math.max(0, first));
  const tr = yinTrack(mono, 60, 2000, 0.01);
  const voiced = tr.filter((x) => x.f > 0 && x.ap < 0.3);
  const f0med = voiced.length ? median(voiced.map((x) => x.f)) : 0;
  const tonal = tr.filter((x) => x.f > 0).length ? voiced.length / tr.filter((x) => x.f > 0).length : 0;
  // PITCH MOVE: the voiced pitch's last quarter against its first, in octaves (a laser falls, a charge rises)
  const vq = Math.max(1, Math.floor(voiced.length / 4));
  const pmove = voiced.length >= 4 ? Math.log2(median(voiced.slice(-vq).map((x) => x.f)) / median(voiced.slice(0, vq).map((x) => x.f))) : 0;
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R),
    cent: cd ? cn / cd : 0, lo: cd ? blo / cd : 0, hi: cd ? bhi / cd : 0, cmove, texture, atk, maxAt: imx * 0.02 - Math.max(0, first) / SR, end80,
    bursts, f0: f0med, tonal, pmove, bodyHz: bd.hz, bodyDb: bd.prom };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1) +
    "\n      centroid " + (m.cent / 1000).toFixed(2) + "k (moves " + (m.cmove >= 0 ? "+" : "") + m.cmove.toFixed(2) + " oct)  <250Hz " + (100 * m.lo).toFixed(0) +
    "%  >4k " + (100 * m.hi).toFixed(0) + "%  body " + m.bodyHz.toFixed(0) + " Hz (+" + m.bodyDb.toFixed(0) + " dB)  pitch " + (m.f0 ? m.f0.toFixed(0) + " Hz (tonal " + (100 * m.tonal).toFixed(0) + "%, moves " + (m.pmove >= 0 ? "+" : "") + m.pmove.toFixed(2) + " oct)" : "none") +
    "\n      events " + m.bursts + "  texture " + m.texture.toFixed(1) + " dB  attack " + m.atk.toFixed(2) + " s  peak at " + m.maxAt.toFixed(2) + " s  at 80% " + m.end80.toFixed(0) + " dB";
}
// The feature vector for separation (1 = a clearly audible step): length log2 of the audible span; brightness log2 of the
// centroid; colour move (octaves); rumble and hiss shares x 3; pitch log2(f0/60)/1.5 x tonal share; events log2(1 + n);
// texture dB / 3; attack log2 / 1.5; where it peaks (share of the span) x 2; what is left at 80% (dB / 12); and the body
// peak, log2 of its frequency x its prominence share (a 20 dB resonance counts fully; broadband noise counts nothing)
function features(m) {
  const bw = cl(m.bodyDb / 20, 0, 1);
  return [Math.log2(m.span), Math.log2(Math.max(100, m.cent)), cl(m.cmove, -2, 2), 3 * m.lo, 3 * m.hi,
    m.f0 ? m.tonal * Math.log2(m.f0 / 60) / 1.5 : 0, Math.log2(1 + m.bursts), Math.min(m.texture, 9) / 3,
    Math.log2(m.atk) / 1.5, 2 * cl(m.maxAt / m.span, 0, 1), cl(m.end80, -40, 0) / 12, bw * Math.log2(Math.max(60, m.bodyHz) / 60) / 1.5, cl(m.pmove, -3, 3) * m.tonal];
}
const FEAT = ["length", "bright", "colour-move", "rumble", "hiss", "pitch", "events", "texture", "attack", "peakpos", "tail", "body", "pitch-move"];
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); }
function why(a, b) { return FEAT.map((k, i) => [k, Math.abs(a[i] - b[i])]).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => k + " " + v.toFixed(2)).join(", "); }
// a 50 ms (HOP) level / centroid / pitch curve: what the shape does over time
function curve(r) {
  const hop = +(process.env.HOP || 0.05);
  const mono = Float64Array.from(r.L, (v, i) => 0.5 * (v + r.R[i])), E = Math.round(hop * SR), out = [];
  const tr = yinTrack(mono, 60, 2000, hop);
  for (let a = 0, k = 0; a + E <= mono.length; a += E, k++) {
    let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i];
    const c = spectrum(mono, Math.min(a, Math.max(0, mono.length - FN - 1))).cent, t = tr[k];
    out.push((a / SR).toFixed(2) + ":" + (10 * Math.log10(s / E + 1e-12)).toFixed(0) + "dB/" + (c / 1000).toFixed(1) + "k" + (t && t.f && t.ap < 0.3 ? "/" + t.f.toFixed(0) : ""));
  }
  return out.join(" ");
}

const arg = process.argv[2];
if (arg === "try") { const r = render(JSON.parse(process.argv[3])); console.log(fmt(measure(r)) + "\n      " + curve(r)); process.exit(0); }

// ---- the reference: today's 21
const refCache = new Map();
function refRow(name) {
  if (!refCache.has(name)) { const m = measure(render(PRESETS[name])); refCache.set(name, { name, m, f: features(m) }); }
  return refCache.get(name);
}
if (arg === "ref") {
  for (const name of SECTION) console.log(name.padEnd(18) + fmt(refRow(name).m));
  const e = SECTION.map((n) => refRow(n).m.lufs).sort((a, b) => a - b);
  console.log("\nSCI-FI & HAZARD (" + SECTION.length + ") median " + median(e).toFixed(1) + " LUFS, range " + e[0].toFixed(1) + " to " + e[e.length - 1].toFixed(1) +
    " (spread " + (e[e.length - 1] - e[0]).toFixed(1) + " dB; middle half " + e[Math.floor(e.length / 4)].toFixed(1) + " to " + e[Math.floor(3 * e.length / 4)].toFixed(1) + ")");
  const p = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) { const a = refRow(SECTION[i]), b = refRow(SECTION[j]); p.push([a.name, b.name, dist(a.f, b.f), a.f, b.f]); }
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY closest pairs:"); for (const [a, b, d, fa, fb] of p.slice(0, 12)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2));
  process.exit(0);
}

// ============================================================================================================
// THE VOICES (each a full patch for one layer; drive 0 unless asked: the default 0.1 is a tanh(5x) nobody asked for)
function space(p, o) {   // shared Space: reverb, a convolution room, an echo, a stereo width
  if (o.reverb) Object.assign(p, { reverb: r2(o.reverb), reverbSize: r2(o.size ?? 0.5), reverbTone: r2(o.rtone ?? 0.5) });
  if (o.conv) Object.assign(p, { convMix: r2(o.conv), convType: o.convType ?? 0, convSize: r2(o.convSize ?? 0.8), convTone: r2(o.convTone ?? 0.45) });
  if (o.delay) Object.assign(p, { delay: r2(o.delay), delayTime: r3(o.delayTime ?? 0.15), delayFb: r2(o.delayFb ?? 0.35) });
  if (o.pingpong) p.pingpong = r2(o.pingpong);
  if (o.width != null) p.width = r2(o.width);
  return p;
}
// the shared chassis: envelope, filter, crunch, modulation, burst. Every optional key is written only when asked
function chassis(p, o) {
  Object.assign(p, { attack: r3(o.atk ?? 0.005), hold: r3(o.hold || 0), decay: r3(o.dec ?? 0.1), sustain: r2(o.sus ?? 0), release: r3(o.rel ?? 0.1),
    duration: r2(o.dur), filterMode: o.mode ?? (o.hp ? 1 : 0), cutoff: Math.round(cl(o.hp || o.cut || 12000, 40, 12000)), reso: r2(o.reso ?? 0),
    drive: r2(o.drive || 0), width: r2(o.width ?? 0.5) });
  if (o.drive) p.driveOS = 2;
  if (o.curve) p.envCurve = r2(o.curve);
  if (o.fenv) p.filtEnv = r2(cl(o.fenv, -1, 1));
  if (o.wah) Object.assign(p, { wahRate: r2(o.wah[0]), wahDepth: r2(o.wah[1]) });
  if (o.crush) p.bitcrush = o.crush;
  if (o.down) p.downsample = o.down;
  if (o.trem) Object.assign(p, { tremDepth: r2(o.trem[0]), tremRate: r2(o.trem[1]) });
  if (o.flicker) Object.assign(p, { flicker: r2(o.flicker[0]), flickerRate: r2(o.flicker[1]) });
  if (o.phaser) Object.assign(p, { phaserMix: r2(o.phaser[0]), phaserRate: r2(o.phaser[1]), phaserDepth: r2(o.phaser[2] ?? 0.7) });
  if (o.chorus) Object.assign(p, { chorusMix: r2(o.chorus[0]), chorusRate: r2(o.chorus[1]), chorusDepth: r2(o.chorus[2] ?? 0.4) });
  if (o.repeat > 1) { p.repeat = o.repeat; p.rate = r2(cl(o.rate, 1, 30)); if (o.arp) p.arpStep = o.arp; }
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(cl(o.boomFreq || 60, 25, 200)), boomDrop: r2(o.boomDrop ?? 0.5), boomDecay: r2(cl(o.boomDecay ?? 0.2, 0.02, 1.2)) });
  return space(p, o);
}
// an oscillator (0 sine, 1 square, 2 saw, 3 triangle, 4 pulse, 6 organ), or FM 4op (18), or additive (16): pitch moves
function osc(o) {
  const p = { wave: o.wave ?? 0, freq: Math.round(cl(o.f, 20, 4000)) };
  if (o.sweep) p.sweep = r2(cl(o.sweep, -1, 1));
  if (o.vib) Object.assign(p, { vibDepth: r3(o.vib), vibRate: r2(o.vibRate ?? 6) });
  if (o.vibOnset) p.vibOnset = r2(o.vibOnset);
  if (o.unison > 1) Object.assign(p, { unison: o.unison, detune: r2(o.detune ?? 12) });
  if (o.pw != null) p.pulseWidth = r2(o.pw);
  if (o.pwm) Object.assign(p, { pwmDepth: r2(o.pwm[0]), pwmRate: r2(o.pwm[1]) });
  if (o.noise) { p.noise = r2(o.noise); if (o.color) p.noiseColor = r2(o.color); }
  if (o.sub) p.subOsc = r2(o.sub);
  if (o.ring) Object.assign(p, { ringMod: r2(o.ring), ringFreq: Math.round(cl(o.ringF, 0, 2000)) });
  if (p.wave === 18) Object.assign(p, { fmAlgo: o.algo ?? 0, fmRatio2: o.r2 ?? 1, fmRatio3: o.r3 ?? 2, fmRatio4: o.r4 ?? 3, fmIndex: r2(o.index ?? 0.5),
    fmFeedback: r2(o.fb || 0) }, o.fmEnv ? { fmEnv: r2(o.fmEnv), fmEnvTime: r2(o.fmEnvTime ?? 0.15) } : {});
  if (p.wave === 16) Object.assign(p, { addPartials: o.partials ?? 8, addTilt: r2(o.tilt ?? 0.4), addDrift: r2(o.drift ?? 0.3), addDriftRate: r2(o.driftRate ?? 0.3),
    addDetune: r2(o.adet ?? 0.3) });
  return chassis(p, o);
}
// impact (19): a contact transient + its boom
function imp(o) {
  return chassis({ wave: 19, impactTone: r2(o.tone), impactDecay: r2(o.decay), impactPunch: r2(o.punch ?? 0.8), impactGrit: r2(o.grit ?? 0.2) },
    Object.assign({ atk: 0.001, sus: 0 }, o));
}
// bar (24): a struck bar (2 glockenspiel, 3 vibraphone)
function bar(o) {
  const p = { wave: 24, freq: Math.round(cl(o.f, 20, 4000)), barType: o.type ?? 2, barMallet: r2(o.mallet ?? 0.5), barRing: r2(o.ring ?? 0.5) };
  return chassis(p, Object.assign({ atk: 0, hold: 0, dec: 0, sus: 1, rel: 0.4 }, o));
}
// modal (10): a struck resonant body
function modal(o) {
  const p = { wave: 10, freq: Math.round(cl(o.f, 20, 4000)), modalPartials: o.parts ?? 8, modalInharm: r2(o.inharm), modalDecay: r2(o.ring), modalBright: r2(o.bright ?? 0.5) };
  if (o.noise) { p.noise = r2(o.noise); p.noiseColor = r2(o.color ?? 0.3); }
  return chassis(p, Object.assign({ atk: 0.001, hold: 0.004, sus: 0 }, o));
}
// whoosh (20): air moved past
function whoosh(o) {
  return chassis({ wave: 20, whooshTone: r2(o.tone), whooshSweep: r2(o.sweep ?? 0.5), whooshBody: r2(o.body ?? 0.3), whooshPeak: r2(o.peak ?? 0.5) },
    Object.assign({ atk: 0.02, sus: 1, rel: 0.15, cut: 9000, width: 0.6 }, o));
}
// particle (15): dense tiny contacts (sparks, fizz, a counter's ticks)
function part(o) {
  return chassis({ wave: 15, particleRate: Math.round(cl(o.rate, 5, 200)), particleTone: r2(cl(o.tone, 0, 1)), particleDecay: r2(cl(o.decay, 0, 1)), particleSpread: r2(o.spread ?? 0.5) },
    Object.assign({ atk: 0.02, sus: 1, rel: 0.1, width: 0.6 }, o));
}
// bubble (14): Minnaert bubbles
function bub(o) {
  return chassis({ wave: 14, freq: Math.round(cl(o.f, 20, 4000)), bubbleRate: Math.round(cl(o.rate, 1, 60)), bubbleRise: r2(o.rise ?? 0.5), bubbleSpread: r2(o.spread ?? 0.4),
    bubbleDecay: r2(o.decay ?? 0.4) }, Object.assign({ atk: 0.01, sus: 1, rel: 0.2, cut: 6000, width: 0.6 }, o));
}
// weather wind (29): turbulence whose band and level follow the envelope; edge-tone whistles at freq when strong
function wind(o) {
  const p = { wave: 29, wxType: 0, wxIntensity: r2(o.int), wxGust: r2(o.gust ?? 0.3), wxGustRate: r2(o.gustRate ?? 1), wxTone: r2(o.tone), wxBody: r2(o.body ?? 0.2),
    wxWhistle: r2(o.whistle || 0), wxWhistles: o.whistles ?? 0, wxSeed: o.seed ?? 1 };
  if (o.whistle) { p.freq = Math.round(o.f || 1200); p.wxWhistleQ = Math.round(o.q ?? 60); }
  return chassis(p, Object.assign({ cut: 12000, width: 0.6 }, o));
}
// flow (35): a stream's pockets (type 0) or a waterfall (1); the envelope is the flow
function flow(o) {
  const p = { wave: 35, flowType: o.type ?? 0, flowAmount: r2(o.amount ?? 0.5), flowSize: r2(o.bsize ?? 2), flowBabble: r2(o.babble ?? 0.5), flowBody: r2(o.body ?? 0.3),
    flowRise: r2(o.rise ?? 0.3), flowTone: r2(o.tone ?? 0.5), flowDistance: r2(o.distance ?? 0.2), flowSeed: o.seed ?? 1 };
  return chassis(p, Object.assign({ cut: 12000, width: 0.6 }, o));
}
// blast (31): a pressure wave in a place (its own room: reverb 0); the chassis is the shipped blast presets'
function blast(o) {
  return { wave: 31, blastSize: r2(o.size), blastDist: Math.round(o.dist || 30), blastEnv: o.env ?? 0, blastRoom: r2(o.room ?? 0.8), blastTail: r2(o.tail ?? 0.8),
    blastPulse: r2(o.pulse ?? 2), blastShape: r2(o.shape ?? 1), blastRoar: r2(o.roar ?? 0.3), blastRumble: r2(o.rumble ?? 0.6), blastDebris: r2(o.debris || 0),
    blastDebrisType: o.debrisType ?? 0, blastSeed: o.seed ?? 1, blastPeak: r2(o.peak ?? 0.5), width: o.width ?? 0.6, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06,
    filterMode: 0, cutoff: 12000, reso: 0.31, drive: 0, reverb: 0, duration: r2(o.dur || 1.5) };
}
// spring (32): 0 a coil (a dispersive "pew" on every round trip)
function spring(o) {
  return space({ wave: 32, springType: o.type ?? 0, freq: Math.round(o.f), springLength: Math.round(o.len ?? 60), springDisp: r2(o.disp ?? 0.8), springDamp: r2(o.damp ?? 0.5),
    springSway: r2(o.sway || 0), springSwayRate: r2(o.swayRate || 7), springPluck: r2(o.pluck ?? 0.6), springSeed: o.seed ?? 1,
    attack: 0, hold: 0, decay: 0, sustain: 1, release: r3(o.rel ?? 0.05), filterMode: 1, cutoff: Math.round(o.hp || 40), reso: 0, drive: 0, duration: r2(o.dur), width: 0.4 }, o);
}
// servo (33): o is the servo* rows verbatim; the chassis is the shipped servo presets' (in range: cutoff 12000)
function servo(o, env, sp) {
  return space(Object.assign({ wave: 33, attack: r3(env.atk ?? 0.004), hold: r3(env.hold || 0), decay: r3(env.dec || 0), sustain: r2(env.sus ?? 1), release: r3(env.rel ?? 0.02),
    filterMode: 0, cutoff: 12000, reso: 0, drive: 0, bitcrush: 16, width: 0.4, duration: r2(env.dur) }, o), sp || {});
}
// A sound = layer 1's patch + layers 2-4 as the JSON string the app stores ({ s, d, g, p, m: 0 })
function sound(base, extra) {
  const p = Object.assign({}, base);
  const ls = (extra || []).filter(Boolean).map(([s, d, g, pt]) => ({ s, d: r3(d), g: r2(g), p: pt || 0, m: 0 }));
  if (ls.length > 3) throw new Error("more than 4 layers");
  if (ls.length) p.layers = JSON.stringify(ls);
  return p;
}
const STRETCH = new Set([27, 29, 30, 31, 35]);
// every key a layer sets must be a PARAMS row and sit inside its range (index.html's own table, read as text)
const PRANGE = {};
for (const m of readFileSync(join(ROOT, "index.html"), "utf8").matchAll(/^\s*\["(\w+)",\s*"[^"]*",\s*(-?[\d.]+),\s*([^,]+),\s*(-?[\d.]+),/gm)) {
  const max = m[1] === "wave" ? 35 : m[1] === "filterMode" ? 4 : +m[3]; PRANGE[m[1]] = [+m[2], max];
}
function rangeCheck(name, p) {
  const ls = [p].concat(p.layers ? JSON.parse(p.layers).map((l) => l.s) : []);
  ls.forEach((l, i) => { for (const [k, v] of Object.entries(l)) { if (k[0] === "_" || k === "layers") continue; const r = PRANGE[k];
    if (!r) console.log("  !! " + name + " layer " + (i + 1) + ": " + k + " is not a PARAMS row");
    else if (typeof v !== "number" || isNaN(v) || v < r[0] - 1e-9 || v > r[1] + 1e-9) console.log("  !! " + name + " layer " + (i + 1) + ": " + k + " " + v + " outside " + r[0] + ".." + r[1]); } });
  if (p.layers) JSON.parse(p.layers).forEach((l, i) => { if (l.g > 2 || l.d > 2) console.log("  !! " + name + " layer " + (i + 2) + " gain/delay out of range"); });
}
function durCheck(name, p) {
  rangeCheck(name, p);
  const ls = [p].concat(p.layers ? JSON.parse(p.layers).map((l) => l.s) : []);
  ls.forEach((l, i) => { if (l.duration > 2.0001 && !STRETCH.has(l.wave)) console.log("  !! " + name + " layer " + (i + 1) + " (wave " + l.wave + ") duration " + l.duration + " > 2 s"); });
}
// a stable small seed per name
const seedOf = (s, salt = 0) => { let h = 2166136261 ^ salt; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % 997 + 1; };
const semis = (n) => Math.pow(2, n / 12);
// ============================================================================================================
// THE NAMED DESIGNS. Two kinds, judged differently (see the header): HAZARDS are physical, so the newer engines carry
// them; DEVICES are synthetic by nature, so an oscillator, FM or a ring mod is the idiom and only the BUILD changes
// (a charge, a discharge, a tail as separate layers).
const S = {};

// ---- HAZARDS ---------------------------------------------------------------------------------------------------
// TESLA COIL: a real arc. The interrupter fires the spark gap ~120 times a second, so the arc SINGS at that rate: a
// train of very narrow, driven pulses (pulse 6%: mostly impulses) with the arc's rasp in it, flickering as streamers
// strike and die. Over it the sparks themselves (dense, driven, sharp particle snaps) and the streamers' hiss (a
// ring-modded bright noise band, flickering faster). A big room.
S["Tesla Coil"] = () => sound(
  osc({ wave: 4, f: 120, pw: 0.06, noise: 0.3, drive: 0.55, mode: 0, cut: 7000, reso: 0.2, flicker: [0.55, 14], atk: 0.004, hold: 0, dec: 0.1, sus: 0.85, rel: 0.12,
    dur: 1.3, reverb: 0.22, size: 0.6, rtone: 0.55, width: 0.5 }),
  [[part({ rate: 70, tone: 0.92, decay: 0.02, spread: 0.85, drive: 0.5, hp: 1500, atk: 0.005, dec: 0.1, sus: 0.85, rel: 0.12, dur: 1.3, reverb: 0.2, size: 0.6, width: 0.8 }), 0, 0.85],
   [osc({ wave: 2, f: 2400, noise: 0.6, ring: 0.8, ringF: 120, mode: 2, cut: 3800, reso: 0.35, flicker: [0.8, 28], atk: 0.01, dec: 0.1, sus: 0.8, rel: 0.12, dur: 1.3,
     reverb: 0.2, size: 0.6, width: 0.7 }), 0, 0.45]]);

// GAS LEAK: gas forced through a small hole: a JET. Its turbulence is a high, steady hiss (weather wind: strong, barely
// gusting, bright band, no body), and a jet past a sharp edge WHISTLES (an edge tone, here one whistle at ~2.6 kHz that
// sings only where the jet is strong). The fine grain of the escaping gas is dense high particle fizz.
S["Gas Leak"] = () => sound(
  wind({ int: 0.8, gust: 0.12, gustRate: 3.5, tone: 0.88, body: 0.02, whistle: 0.45, whistles: 1, f: 2600, q: 80, seed: 5, atk: 0.12, hold: 0, dec: 0, sus: 1, rel: 0.3,
    dur: 1.7, hp: 500, width: 0.5 }),
  [[part({ rate: 200, tone: 0.9, decay: 0.02, spread: 0.3, hp: 3000, atk: 0.12, sus: 1, rel: 0.3, dur: 1.7, width: 0.5 }), 0, 0.6]]);

// GAS PUFF: a valve cracks open and shuts: the valve's click, a short burst of gas (a bright wind burst: a jet starting
// hard and running out of pressure, its band falling as it goes) with its hiss, and the valve seating again, softer.
S["Gas Puff"] = () => sound(
  wind({ int: 0.9, gust: 0.1, gustRate: 2, tone: 0.72, body: 0.08, seed: 3, atk: 0.008, hold: 0.04, dec: 0.32, sus: 0, rel: 0.08, dur: 0.6, hp: 300, width: 0.6,
    reverb: 0.12, size: 0.4 }),
  [[osc({ wave: 0, f: 200, noise: 1, mode: 2, cut: 2800, reso: 0.25, fenv: -0.45, atk: 0.004, hold: 0.03, dec: 0.25, sus: 0, rel: 0.06, dur: 0.5, reverb: 0.12, size: 0.4, width: 0.5 }), 0, 0.7],
   [imp({ tone: 0.75, decay: 0.03, punch: 0.9, grit: 0.1, dec: 0.02, rel: 0.02, dur: 0.2, width: 0.3 }), 0, 0.3],
   [imp({ tone: 0.6, decay: 0.04, punch: 0.7, grit: 0.1, dec: 0.025, rel: 0.02, dur: 0.2, width: 0.3 }), 0.36, 0.2]]);

// STEAM VENT: a pressure release. The vent bangs open (a metal chunk; no boom: a low pulse here costs the Limiter DC), the steam ROARS out (weather wind at full: bright,
// with body, a fast unsteady flutter, a hollow whistle as it peaks) and its hiss with it, then the pressure falls away
// and the condensate spits and sputters (sparse driven particle) as it dies down.
S["Steam Vent"] = () => sound(
  wind({ int: 1, gust: 0.3, gustRate: 2.8, tone: 0.75, body: 0.35, whistle: 0.35, whistles: 2, f: 1500, q: 45, seed: 7, atk: 0.03, hold: 0.45, dec: 0.9, sus: 0.35,
    rel: 0.4, dur: 1.9, width: 0.7, reverb: 0.15, size: 0.55 }),
  [[part({ rate: 200, tone: 0.86, decay: 0.03, spread: 0.35, hp: 2500, atk: 0.03, hold: 0.45, dec: 0.9, sus: 0.35, rel: 0.4, dur: 1.9, width: 0.7 }), 0, 1.3],
   [part({ rate: 22, tone: 0.5, decay: 0.06, spread: 0.9, drive: 0.35, atk: 0.2, dec: 0.6, sus: 0.4, rel: 0.3, dur: 1.4, reverb: 0.15, size: 0.55, width: 0.8 }), 0.35, 0.55],
   [imp({ tone: 0.38, decay: 0.12, punch: 0.9, grit: 0.35, dec: 0.08, rel: 0.1, dur: 0.5, reverb: 0.15, size: 0.55 }), 0, 0.3]]);

// TOXIC BUBBLE: thick sludge bubbling: big slow bubbles (the bubble engine, low, rising, driven a little so they are
// fat), the vat's viscous gurgle under them (a flow stream of large bubbles, dark), and a sickly sour wobble in the
// pitch of the bubbles (vibrato) — the one non-physical touch, as the name asks for "toxic".
S["Toxic Bubble"] = () => sound(
  bub({ f: 240, rate: 6, rise: 0.85, spread: 0.55, decay: 0.6, drive: 0.25, cut: 2800, vib: 0.08, vibRate: 5, atk: 0.02, sus: 1, rel: 0.25, dur: 1.5, reverb: 0.2, size: 0.45, width: 0.6 }),
  [[flow({ type: 0, amount: 0.35, bsize: 6, babble: 0.6, body: 0.5, rise: 0.4, tone: 0.35, distance: 0.1, seed: 4, atk: 0.1, sus: 1, rel: 0.25, dur: 1.5, cut: 3000, reverb: 0.15, size: 0.45 }), 0, 0.55],
   [bub({ f: 85, rate: 2, rise: 0.9, spread: 0.3, decay: 0.8, drive: 0.3, cut: 1800, atk: 0.01, sus: 1, rel: 0.25, dur: 1.4, reverb: 0.2, size: 0.45 }), 0.15, 0.6]]);

// ACID SPLASH: liquid hitting a surface (a splat: a short dark thud and a band of noise falling as the sheet breaks
// up), the droplets (a fast burst of small bubbles), then the acid EATING: a fizz that lingers (dense high particle).
// The fizz is layer 1 (it is what lasts, so it carries the loudness; the splat set the peak and left it 3.5 dB short),
// driven 0.3 with a low spread: undriven, the loudest pop sets the peak and the fizz reads 6 dB quieter.
S["Acid Splash"] = () => sound(
  part({ rate: 190, tone: 0.84, decay: 0.03, spread: 0.35, hp: 2200, drive: 0.3, atk: 0.04, hold: 0.2, dec: 0.7, sus: 0.25, rel: 0.35, dur: 1.34, width: 0.7 }),
  [[osc({ wave: 0, f: 200, noise: 1, color: 0.25, mode: 2, cut: 1700, reso: 0.2, fenv: -0.5, atk: 0.004, hold: 0.03, dec: 0.25, sus: 0, rel: 0.08, dur: 0.6, reverb: 0.15, size: 0.4, width: 0.6 }), 0, 0.75],
   [bub({ f: 700, rate: 50, rise: 0.6, spread: 0.85, decay: 0.2, atk: 0.001, hold: 0.02, dec: 0.3, sus: 0, rel: 0.1, dur: 0.6, reverb: 0.15, size: 0.4, width: 0.8 }), 0.01, 0.45],
   [imp({ tone: 0.28, decay: 0.08, punch: 0.6, grit: 0.15, dec: 0.06, rel: 0.05, dur: 0.3, width: 0.4 }), 0, 0.3]]);

// ACID SIZZLE: something dissolving: an effervescent fizz (dense, fine, high particle, a slow swell), tiny bubbles
// bursting in it (high, quick), and the acid spitting now and then (sparse, driven snaps).
S["Acid Sizzle"] = () => sound(
  part({ rate: 190, tone: 0.84, decay: 0.03, spread: 0.55, hp: 2000, drive: 0.15, atk: 0.15, hold: 0.3, dec: 0.5, sus: 0.6, rel: 0.3, dur: 1.4, width: 0.7 }),
  [[bub({ f: 1900, rate: 45, rise: 0.4, spread: 0.7, decay: 0.12, atk: 0.1, hold: 0.3, dec: 0.5, sus: 0.6, rel: 0.3, dur: 1.4, cut: 9000, width: 0.8 }), 0, 0.55],
   [part({ rate: 11, tone: 0.65, decay: 0.05, spread: 0.9, drive: 0.4, atk: 0.05, sus: 1, rel: 0.2, dur: 1.3, width: 0.8 }), 0.1, 0.6]]);

// METEOR DESCENT: a body tearing down through the air and hitting the ground. The passing air's whoosh grows to a late
// peak (layer 1: the whoosh engine's own late peak carries the approach, since an attack stops at 0.5 s), the air ROARS
// in under it half a second later (weather wind: its band climbs with the envelope), the rock burns and spits (driven
// particle crackle, later still), and it lands: a blast (big, 150 m off, earth debris) as the roar cuts.
S["Meteor Descent"] = () => sound(
  whoosh({ tone: 0.35, sweep: 0.8, body: 0.55, peak: 0.88, atk: 0.4, hold: 0, dec: 0, sus: 1, rel: 0.05, dur: 1.32, width: 0.7 }),
  [[wind({ int: 1, gust: 0.35, gustRate: 2.2, tone: 0.45, body: 0.6, seed: 11, atk: 0.5, hold: 0.3, dec: 0, sus: 1, rel: 0.06, dur: 0.87, width: 0.7, curve: 0.5 }), 0.45, 0.9],
   [part({ rate: 55, tone: 0.55, decay: 0.05, spread: 0.85, drive: 0.35, atk: 0.5, hold: 0.15, dec: 0, sus: 1, rel: 0.05, dur: 0.72, width: 0.8, curve: 0.5 }), 0.6, 0.6],
   [blast({ size: 0.72, dist: 150, env: 0, room: 1, tail: 0.9, pulse: 3.5, roar: 0.2, rumble: 0.85, debris: 0.55, debrisType: 0, seed: 21, peak: 0.6, dur: 1.9 }), 1.28, 1.2]]);

// COMET WHOOSH: a burning body passing overhead: the air it tears (whoosh, bright, a pass), the wind behind it (a brief
// gust in its wake, so the pass has weight), and its sparkling tail fizzing after the head (bright particle, late).
S["Comet Whoosh"] = () => sound(
  whoosh({ tone: 0.62, sweep: 0.75, body: 0.35, peak: 0.45, atk: 0.04, dec: 0, sus: 1, rel: 0.15, dur: 1.15, width: 0.85, reverb: 0.2, size: 0.6, rtone: 0.6 }),
  [[wind({ int: 0.8, gust: 0.2, gustRate: 1.5, tone: 0.6, body: 0.25, seed: 9, atk: 0.4, hold: 0, dec: 0.5, sus: 0, rel: 0.15, dur: 1.15, width: 0.8 }), 0.05, 0.55],
   [part({ rate: 130, tone: 0.92, decay: 0.04, spread: 0.6, hp: 3000, atk: 0.25, hold: 0, dec: 0.6, sus: 0, rel: 0.15, dur: 1.0, width: 0.9, reverb: 0.2, size: 0.6 }), 0.28, 0.6]]);

// ---- SCI-FI DEVICES --------------------------------------------------------------------------------------------
// VORTEX WHOOSH: a swirl, not one pass: today's whoosh (kept as layer 1) now ROTATES (a 4 Hz tremolo, the phaser
// faster and deeper), and the vortex HOWLS (weather wind, very gusty and fast-gusting, two hollow whistles that sing at
// each surge), with a band of air spiralling up through it (noise band-passed, its band rising).
S["Vortex Whoosh"] = () => sound(
  whoosh({ tone: 0.45, sweep: 0.5, body: 0.55, peak: 0.6, atk: 0.02, dec: 0.2, sus: 0.6, rel: 0.3, dur: 1.4, cut: 5000, reso: 0.2, phaser: [0.6, 2.2, 0.9], trem: [0.35, 4], width: 0.9,
    reverb: 0.2, size: 0.55 }),
  [[wind({ int: 0.85, gust: 0.65, gustRate: 3, tone: 0.55, body: 0.3, whistle: 0.6, whistles: 2, f: 650, q: 45, seed: 13, atk: 0.3, hold: 0.3, dec: 0.5, sus: 0.3, rel: 0.3, dur: 1.45, width: 0.8 }), 0, 0.7],
   [osc({ wave: 0, f: 200, noise: 1, mode: 2, cut: 500, reso: 0.55, fenv: 0.8, atk: 0.3, hold: 0.2, dec: 0.6, sus: 0.2, rel: 0.3, dur: 1.4, phaser: [0.5, 1.4, 0.8], width: 0.9 }), 0, 0.4]]);

// FLYING SAUCER: the 1950s saucer: a theremin-like sine swooping slowly up and down (wide 1.6 Hz vibrato: the
// "wooo-OOO-ooo") with a fast shimmer on top (a second, higher sine with a quick warble and a ring mod), over the hull's
// pulsing hum (a low organ tone, tremolo at the swoop's rate x 4, ring-modded), in a phaser swirl and an echo.
S["Flying Saucer"] = () => sound(
  osc({ wave: 0, f: 480, vib: 0.55, vibRate: 1.6, atk: 0.25, hold: 0, dec: 0.2, sus: 0.9, rel: 0.4, dur: 1.9, phaser: [0.4, 0.5, 0.8], chorus: [0.3, 0.8], reverb: 0.3, size: 0.65,
    delay: 0.2, delayTime: 0.21, delayFb: 0.35, width: 0.7 }),
  [[osc({ wave: 0, f: 1450, vib: 0.06, vibRate: 11, ring: 0.35, ringF: 37, atk: 0.4, hold: 0, dec: 0.2, sus: 0.8, rel: 0.4, dur: 1.9, reverb: 0.3, size: 0.65, width: 0.8 }), 0, 0.35],
   [osc({ wave: 6, f: 70, ring: 0.45, ringF: 55, trem: [0.5, 6.4], mode: 0, cut: 900, atk: 0.2, sus: 1, rel: 0.4, dur: 1.9, reverb: 0.25, size: 0.65, width: 0.5 }), 0, 0.7]]);

// LASER 2: the BLASTER: Ben Burtt's struck guy-wire. A coil spring smears a tap into a falling "pew" (high runs ahead
// of low), and on a short, damped coil it comes back once or twice; an FM zap gives the bolt its metallic edge, falling
// with it; a slap of echo. A different object from Laser's saw sweep, so the numbered pair separates by construction.
S["Laser 2"] = () => sound(
  spring({ type: 0, f: 1100, len: 45, disp: 1, damp: 0.4, pluck: 0.9, seed: 3, dur: 0.55, reverb: 0.15, size: 0.45, delay: 0.18, delayTime: 0.09, delayFb: 0.25 }),
  [[osc({ wave: 18, f: 1700, algo: 0, r2: 2, r3: 3.5, r4: 1, index: 0.55, fb: 0.3, fmEnv: 0.8, fmEnvTime: 0.05, sweep: -0.6, atk: 0.001, hold: 0.06, dec: 0.2, sus: 0, rel: 0.05,
     dur: 0.32, reverb: 0.15, size: 0.45, width: 0.4 }), 0, 1.3]]);

// LASER CHARGE: a laser charging and firing: the capacitor's whine climbs (a sine-FM tone sweeping up two octaves,
// swelling), a stepped ratchet of blips climbing a semitone at a time under it (the charge counter), and at full
// charge the SHOT: a bright driven saw sweep down (the laser itself) with an echo tail.
S["Laser Charge"] = () => sound(
  osc({ wave: 18, f: 260, algo: 0, r2: 2, r3: 1, r4: 1, index: 0.25, sweep: 0.5, atk: 0.5, hold: 0.35, dec: 0, sus: 1, rel: 0.04, dur: 0.92, curve: 0.6, vib: 0.01, vibRate: 14, mode: 0, cut: 1800, fenv: 0.6,
    reverb: 0.2, size: 0.5, width: 0.4 }),
  [[osc({ wave: 1, f: 520, repeat: 12, rate: 13.5, arp: 1, atk: 0.001, hold: 0.01, dec: 0.03, sus: 0, rel: 0.01, dur: 0.89, crush: 10, width: 0.3, reverb: 0.12, size: 0.4 }), 0, 0.35],
   [osc({ wave: 2, f: 1500, sweep: -0.55, drive: 0.3, mode: 0, cut: 7000, reso: 0.35, atk: 0.001, hold: 0.02, dec: 0.22, sus: 0, rel: 0.08, dur: 0.6, reverb: 0.25, size: 0.55,
     delay: 0.3, delayTime: 0.11, delayFb: 0.4, width: 0.5 }), 0.9, 1.1]]);

// ENERGY DRAIN: power sucked out of something: a rich, drifting tone falling (additive, a long slide down), a warbling
// sine falling with it, ring-modded (the energy leaving in pulses), and a suck of air peaking early (whoosh).
S["Energy Drain"] = () => sound(
  osc({ wave: 16, f: 620, partials: 10, tilt: 0.55, drift: 0.6, driftRate: 1.2, adet: 0.4, sweep: -0.4, atk: 0.03, hold: 0.05, dec: 0.6, sus: 0.5, rel: 0.45, dur: 1.6, chorus: [0.3, 1.2],
    reverb: 0.3, size: 0.65, width: 0.6 }),
  [[osc({ wave: 0, f: 330, sweep: -0.5, vib: 0.18, vibRate: 7, ring: 0.45, ringF: 9, atk: 0.02, hold: 0.05, dec: 0.8, sus: 0.3, rel: 0.4, dur: 1.6, reverb: 0.3, size: 0.65, width: 0.5 }), 0, 0.55],
   [whoosh({ tone: 0.5, sweep: 0.6, body: 0.3, peak: 0.2, atk: 0.03, dec: 0.4, sus: 0.3, rel: 0.4, dur: 1.2, width: 0.7 }), 0, 0.45]]);

// TELEPORTER HUM: the transporter: a shimmering cluster of high partials fluttering (additive, fast drift, a slow
// rise), glittering bell sparks climbing through it (glockenspiel, a burst stepping up), over the machine's electric
// hum (a 110 Hz saw with a 120 Hz tremolo, low-passed). A long bright room.
S["Teleporter Hum"] = () => sound(
  osc({ wave: 16, f: 880, partials: 16, tilt: 0.7, drift: 0.9, driftRate: 1.6, adet: 0.8, sweep: 0.12, atk: 0.5, hold: 0.5, dec: 0.4, sus: 0.4, rel: 0.4, dur: 1.9,
    chorus: [0.35, 1.1], reverb: 0.4, size: 0.75, rtone: 0.7, width: 0.8 }),
  [[bar({ f: 1568, type: 2, mallet: 0.3, ring: 0.6, repeat: 10, rate: 8, arp: 2, dur: 1.6, rel: 0.4, reverb: 0.35, size: 0.75, rtone: 0.7, width: 0.8 }), 0.2, 0.6],
   [osc({ wave: 2, f: 110, trem: [0.4, 120], mode: 0, cut: 900, reso: 0.2, atk: 0.3, hold: 0, dec: 0, sus: 1, rel: 0.4, dur: 1.9, reverb: 0.2, size: 0.6, width: 0.4 }), 0, 0.3]]);

// FORCE FIELD: switching on and holding: the activation (a low saw swooping up into the field, with a boom), then the
// field: an electric hum (a 110 Hz saw, a 100 Hz tremolo, a slow phaser sweeping it) with a metallic FM shimmer over
// it, and a spark now and then where something touches the edge.
S["Force Field"] = () => sound(
  osc({ wave: 2, f: 110, drive: 0.35, mode: 0, cut: 3200, reso: 0.3, trem: [0.3, 100], phaser: [0.6, 0.45, 0.9], atk: 0.12, hold: 0, dec: 0.2, sus: 0.85, rel: 0.4,
    dur: 1.8, reverb: 0.3, size: 0.65, rtone: 0.4, width: 0.6 }),
  [[osc({ wave: 18, f: 640, algo: 1, r2: 1.5, r3: 3, r4: 1, index: 0.35, fb: 0.2, vib: 0.01, vibRate: 5, chorus: [0.4, 0.7], phaser: [0.4, 0.3], atk: 0.3, hold: 0, dec: 0.2, sus: 0.8,
     rel: 0.4, dur: 1.8, reverb: 0.3, size: 0.65, width: 0.8 }), 0, 1.3],
   [osc({ wave: 2, f: 45, sweep: 0.55, drive: 0.4, mode: 0, cut: 1500, atk: 0.005, hold: 0.05, dec: 0.25, sus: 0, rel: 0.08, dur: 0.4, boom: 0.6, boomFreq: 50, boomDrop: 0.3, boomDecay: 0.2,
     reverb: 0.25, size: 0.6 }), 0, 0.55],
   [part({ rate: 7, tone: 0.88, decay: 0.03, spread: 0.85, drive: 0.4, atk: 0.2, sus: 1, rel: 0.3, dur: 1.7, reverb: 0.2, size: 0.6, width: 0.8 }), 0.1, 0.35]]);

// SCAN COMPLETE: a scanner finishing: the scan (a run of square blips climbing two semitones a step over a soft rising
// sine sweep), then the CONFIRM: two clean sine beeps a fifth apart.
S["Scan Complete"] = () => sound(
  osc({ wave: 1, f: 700, repeat: 7, rate: 15, arp: 2, atk: 0.001, hold: 0.01, dec: 0.03, sus: 0, rel: 0.01, dur: 0.47, crush: 10, mode: 0, cut: 6000, width: 0.4, reverb: 0.15, size: 0.45 }),
  [[osc({ wave: 0, f: 420, sweep: 0.35, atk: 0.05, hold: 0.2, dec: 0.15, sus: 0, rel: 0.05, dur: 0.46, width: 0.4, reverb: 0.15, size: 0.45 }), 0, 0.35],
   [osc({ wave: 0, f: 1320, repeat: 2, rate: 7, arp: 7, atk: 0.002, hold: 0.07, dec: 0.06, sus: 0, rel: 0.03, dur: 0.45, width: 0.4, reverb: 0.22, size: 0.5, rtone: 0.6 }), 0.5, 0.85]]);

// WARP DRIVE: ENGAGING warp: the drive spools up (a thick detuned saw climbing three octaves, phased, opening, swelling
// in), then the JUMP: a hard bright whoosh, a deep boom, and a high streak falling away (the stars stretching past) with
// an echo. Warp Drive 2 is its reverse: dropping OUT of warp.
S["Warp Drive"] = () => sound(
  osc({ wave: 2, f: 55, unison: 5, detune: 25, sweep: 0.8, mode: 0, cut: 900, reso: 0.35, fenv: 0.7, phaser: [0.6, 0.7, 0.9], vib: 0.04, vibRate: 9, drive: 0.2,
    atk: 0.5, hold: 0.72, dec: 0, sus: 1, rel: 0.05, dur: 1.27, curve: 0.5, reverb: 0.25, size: 0.7, width: 0.8 }),
  [[whoosh({ tone: 0.65, sweep: 0.95, body: 0.6, peak: 0.12, atk: 0.003, dec: 0.5, sus: 0.2, rel: 0.25, dur: 0.85, width: 0.9, reverb: 0.3, size: 0.75 }), 1.24, 1.0],
   [imp({ tone: 0.25, decay: 0.3, punch: 1, grit: 0.2, dec: 0.2, rel: 0.2, dur: 0.9, boom: 0.85, boomFreq: 48, boomDrop: 1.0, boomDecay: 0.45, reverb: 0.3, size: 0.75 }), 1.25, 0.8],
   [osc({ wave: 0, f: 2400, sweep: -0.75, atk: 0.002, hold: 0.02, dec: 0.45, sus: 0, rel: 0.1, dur: 0.6, phaser: [0.5, 1.2], delay: 0.35, delayTime: 0.13, delayFb: 0.45,
     reverb: 0.3, size: 0.75, width: 0.8 }), 1.25, 0.4]]);

// WARP DRIVE 2: DROPPING OUT of warp: the arrival (a deep boom and a hard whoosh at the very start), then the drive
// winding down: the same thick phased saw falling three octaves, darkening, with a high shimmer settling after.
S["Warp Drive 2"] = () => sound(
  osc({ wave: 2, f: 520, unison: 5, detune: 25, sweep: -0.75, mode: 0, cut: 4500, reso: 0.35, fenv: -0.7, phaser: [0.6, 0.7, 0.9], vib: 0.04, vibRate: 9, drive: 0.2,
    atk: 0.004, hold: 0.05, dec: 1.0, sus: 0.25, rel: 0.4, dur: 1.75, curve: 0.4, reverb: 0.3, size: 0.75, width: 0.8 }),
  [[imp({ tone: 0.25, decay: 0.3, punch: 1, grit: 0.2, dec: 0.2, rel: 0.2, dur: 0.9, boom: 0.85, boomFreq: 48, boomDrop: 1.0, boomDecay: 0.45, reverb: 0.3, size: 0.75 }), 0, 0.8],
   [whoosh({ tone: 0.62, sweep: 0.9, body: 0.5, peak: 0.08, atk: 0.003, dec: 0.45, sus: 0.15, rel: 0.25, dur: 0.8, width: 0.9, reverb: 0.3, size: 0.75 }), 0, 0.8],
   [osc({ wave: 16, f: 1760, partials: 8, tilt: 0.6, drift: 0.85, driftRate: 1.4, adet: 0.7, atk: 0.3, hold: 0.1, dec: 0.6, sus: 0, rel: 0.3, dur: 1.3, reverb: 0.4, size: 0.8, rtone: 0.7, width: 0.9 }), 0.3, 0.25]]);

// ============================================================================================================
// THE FAMILY: 19 names BRED at random in 2026-07 as a TREATMENT x an EVENT (their patches are sine / saw / pulse noise
// beds with 3-decimal values: Ionized Alarm was white noise at -1.2 LUFS, Photon Charge a crushed noise burst). The
// name is the design: two tables, composed.
const FAMILY = ["Ionized Leak", "Alien Surge", "Warp Field", "Radioactive Scan", "Reactor Surge", "Toxic Surge", "Warp Scan", "Toxic Hum", "Ionized Charge",
  "Quantum Pulse", "Alien Field", "Ionized Alarm", "Photon Whoosh", "Photon Charge", "Photon Drip", "Ionized Beam", "Photon Surge", "Reactor Beam", "Reactor Charge"];

// ADJ: the TREATMENT, the same rule on every noun.
//   core     the tone every pitched layer is made of: an oscillator's wave and its modulation (osc() options), its
//            filter and crunch. ringRatio: the ring carrier at the layer's pitch x this (an inharmonic partner)
//   fMul / tMul   every pitch / every time x this; sweepMul the noun's pitch move x this (Warp bends space-time)
//   air      a whoosh noun's air in this treatment: [tone, body]
//   space    reverb / echo on every layer
//   extra    the ONE layer the treatment adds (its signature); extraG its volume
//              sparks   Ionized: electrical sparks (driven, sharp particle) shaped like the core
//              glint    Photon: a glockenspiel glint an octave over the core, at the noun's accent (each shot on a burst)
//              plant    Reactor: the plant under it: a big 50 Hz machine (servo: mains hum, rumble, a low whine)
//              gloop    Toxic: thick low bubbles through the whole sound
//              rush     Warp: the air rushing INTO the event (a whoosh peaking at the accent; into every shot of a burst)
//              double   Alien: a second, metallic FM voice a minor sixth up, warbling at its own rate
//              geiger   Radioactive: a Geiger counter's random ticks over the whole sound
//              glitch   Quantum: the core stuttering an octave up in falling jumps, downsampled
//   lvl      dB against the section median (Reactor is big, Photon a touch under)
const ADJ = {
  Ionized:     { core: { wave: 2, drive: 0.45, noise: 0.12, trem: [0.35, 120], flicker: [0.3, 16], cut: 5500, reso: 0.3 }, fMul: 1, tMul: 1, air: [0.6, 0.25],
                 space: { reverb: 0.2, size: 0.5, rtone: 0.55 }, extra: "sparks", extraG: 0.75, lvl: 0 },
  Photon:      { core: { wave: 16, partials: 5, tilt: 0.5, drift: 0.25, driftRate: 0.7, adet: 0.35, chorus: [0.35, 1.0], cut: 12000 }, fMul: 2, tMul: 0.9, air: [0.78, 0.12],
                 space: { reverb: 0.35, size: 0.7, rtone: 0.75 }, extra: "glint", extraG: 0.55, lvl: -0.5 },
  Reactor:     { core: { wave: 2, sub: 0.6, drive: 0.35, cut: 1600, reso: 0.25, trem: [0.2, 50] }, fMul: 0.45, tMul: 1.25, air: [0.3, 0.75],
                 space: { reverb: 0.35, size: 0.85, rtone: 0.3 }, extra: "plant", extraG: 0.5, lvl: 1 },
  Toxic:       { core: { wave: 4, pw: 0.3, pwm: [0.25, 3], unison: 3, detune: 30, vib: 0.1, vibRate: 4.5, crush: 10, cut: 2600, reso: 0.45 }, fMul: 0.8, tMul: 1.1, air: [0.4, 0.4],
                 space: { reverb: 0.3, size: 0.6, rtone: 0.35 }, extra: "gloop", extraG: 0.55, lvl: 0 },
  Warp:        { core: { wave: 2, unison: 5, detune: 22, phaser: [0.75, 0.6, 0.9], vib: 0.12, vibRate: 0.8, cut: 6000, reso: 0.2 }, sweepMul: 1.6, fMul: 1, tMul: 1.15, air: [0.5, 0.4],
                 space: { reverb: 0.45, size: 0.85, rtone: 0.5, delay: 0.3, delayTime: 0.18, delayFb: 0.5 }, extra: "rush", extraG: 0.7, lvl: 0 },
  Alien:       { core: { wave: 18, algo: 0, r2: 2.5, r3: 1, r4: 1, index: 0.3, fb: 0.1, vib: 0.2, vibRate: 7.5, ringRatio: 1.37, ring: 0.3, chorus: [0.3, 0.9] }, fMul: 1.25, tMul: 1, air: [0.55, 0.3],
                 space: { reverb: 0.35, size: 0.7, rtone: 0.5 }, extra: "double", extraG: 0.55, lvl: 0 },
  Radioactive: { core: { wave: 4, pw: 0.15, drive: 0.25, crush: 8, down: 2, mode: 2, cut: 1400, reso: 0.5 }, fMul: 0.9, tMul: 1, air: [0.5, 0.3],
                 space: { reverb: 0.25, size: 0.55, rtone: 0.4 }, extra: "geiger", extraG: 0.8, lvl: 0 },
  Quantum:     { core: { wave: 1, crush: 6, down: 4, flicker: [0.6, 24], cut: 8000 }, fMul: 1.1, tMul: 0.9, air: [0.6, 0.3],
                 space: { reverb: 0.3, size: 0.6, rtone: 0.5 }, extra: "glitch", extraG: 0.5, lvl: 0 },
};

// NOUN: the EVENT's shape (for fMul 1, tMul 1). f the core's pitch; env its envelope (s); dur; sweep (the pitch move
// over the sound, or over each shot of a burst); repeat / rate a burst; fenv the filter's move; trem / vib / phaser
// the noun's own motion (an adjective's own wins: Ionized's 120 Hz buzz over a beam's 45 Hz); accent where the event
// lands ("start", "peak" = end of the attack, "end" = end of the hold, "shots" = every shot), which is where a glint or
// a rush goes; extra the ONE layer the event adds; lvl dB against the median.
//   kind "whoosh": layer 1 is the whoosh engine (the air), in the adjective's air; "leak": the core is mostly noise
//   through a band at f (energy escaping), with its own hiss layer
const NOUN = {
  Charge: { f: 220, env: { atk: 0.5, hold: 0.53, dec: 0, sus: 1, rel: 0.05, curve: 0.6 }, dur: 1.08, sweep: 0.45, fenv: 0.7, accent: "end", extra: "steps", extraG: 0.4, lvl: 0 },
  Surge:  { f: 260, env: { atk: 0.28, hold: 0.08, dec: 0.75, sus: 0.12, rel: 0.3, curve: 0.5 }, dur: 1.45, sweep: -0.22, fenv: -0.45, accent: "peak", extra: "jolt", extraG: 0.75, lvl: 1 },
  Beam:   { f: 440, env: { atk: 0.015, hold: 0, dec: 0.1, sus: 0.85, rel: 0.25 }, dur: 1.5, trem: [0.3, 45], vib: 0.008, vibRate: 5, accent: "start", extra: "zap", extraG: 0.9, lvl: 0 },
  Scan:   { f: 520, env: { atk: 0.02, hold: 0, dec: 0.25, sus: 0.1, rel: 0.05 }, repeat: 4, rate: 2.6, sweep: 0.35, accent: "shots", lvl: -1 },
  Whoosh: { kind: "whoosh", f: 700, dur: 1.15, wsweep: 0.75, peak: 0.45, accent: "peak", extra: "streak", extraG: 0.8, lvl: 0 },
  Drip:   { f: 950, env: { atk: 0.001, hold: 0.004, dec: 0.09, sus: 0, rel: 0.05 }, dur: 0.45, sweep: 0.2, accent: "start", extra: "drop2", extraG: 0.55, lvl: -4 },
  Leak:   { kind: "leak", f: 1800, env: { atk: 0.08, hold: 0, dec: 0.2, sus: 0.7, rel: 0.25 }, dur: 1.3, trem: [0.25, 11], accent: "start", extra: "hiss", extraG: 0.7, lvl: -1.5 },
  Alarm:  { f: 620, env: { atk: 0.01, hold: 0.14, dec: 0.08, sus: 0, rel: 0.03 }, repeat: 5, rate: 3.3, sweep: 0.25, accent: "shots", lvl: 0 },
  Hum:    { f: 110, env: { atk: 0.25, hold: 0, dec: 0, sus: 1, rel: 0.4 }, dur: 1.6, vib: 0.006, vibRate: 3, accent: "start", extra: "beat", extraG: 0.5, lvl: -2 },
  Field:  { f: 330, env: { atk: 0.4, hold: 0, dec: 0.3, sus: 0.8, rel: 0.5 }, dur: 1.8, phaser: [0.5, 0.3, 0.8], accent: "start", extra: "shimmer", extraG: 0.4, lvl: -1 },
  Pulse:  { f: 180, env: { atk: 0.008, hold: 0.04, dec: 0.18, sus: 0, rel: 0.05 }, repeat: 4, rate: 3.2, sweep: -0.35, accent: "shots", extra: "thud", extraG: 0.4, lvl: 0 },
};

// Per-name overrides: only where composition genuinely fails, each with its reason.
const OVERRIDES = {};

// THE COMPOSER. The rules, all of them:
//   core      osc(adj.core + the noun's shape): pitch = noun f x fMul; every time x tMul (a burst's rate / tMul); sweep x
//             sweepMul; the noun's trem / phaser only where the adjective brings none; vibrato = noun + adjective (the
//             adjective's rate); Alien's ring carrier at the pitch x 1.37; adj.space on every layer
//   whoosh    layer 1 = the whoosh engine in the adjective's air, its filter and crunch (not its wave)
//   leak      the core with noise 0.7 through a band-pass at f (reso 0.4) instead of the adjective's filter
//   extras    the adjective's, then the noun's; each spans the core (its envelope, or the burst's span) unless it is
//             placed at the accent; a layer copied from the core (steps, zap, drop2, beat, glitch) keeps the treatment
//   jolt      a surge's boom at 55 Hz (x sqrt(fMul) for a higher treatment; never lower: under 50 Hz it is mud and the
//             Limiter turns it into DC)
//   level     gain on layer 1: the trim to the section median + adj.lvl + noun.lvl
const OSC_ONLY = ["wave", "algo", "r2", "r3", "r4", "index", "fb", "pw", "pwm", "unison", "detune", "vib", "vibRate", "sub", "partials", "tilt", "drift", "driftRate", "adet", "ring", "ringRatio", "noise"];
function compose(name) {
  const [adjName, nounName] = name.split(" ");
  const A = ADJ[adjName], N = NOUN[nounName];
  if (!A || !N) throw new Error("no table entry for " + name);
  const t = A.tMul, f = N.f * A.fMul, sp = A.space, layers = [];
  // every time x tMul; an attack past its row's 0.5 s ceiling goes into the hold (the build carries on in pitch and filter)
  const env = N.env ? { atk: Math.min(0.5, N.env.atk * t), hold: N.env.hold * t + Math.max(0, N.env.atk * t - 0.5), dec: N.env.dec * t, sus: N.env.sus, rel: N.env.rel * t, curve: N.env.curve } : null;
  const rate = N.repeat ? N.rate / t : 0;
  const dur = N.repeat ? r2(N.repeat / rate + 0.03) : r2(Math.min(2, N.dur * t));
  // the treatment: the adjective's core, its ring at its own ratio, the noun's motion where the adjective brings none
  const treat = (o, pitched) => {
    const c = Object.assign({}, A.core);
    if (!pitched) for (const k of OSC_ONLY) delete c[k];
    if (pitched && c.ringRatio) c.ringF = Math.min(2000, o.f * c.ringRatio);
    delete c.ringRatio;
    if (!c.trem && N.trem) c.trem = N.trem;
    if (!c.phaser && N.phaser) c.phaser = N.phaser;
    if (pitched && N.vib) { c.vib = (c.vib || 0) + N.vib; c.vibRate = A.core.vib ? A.core.vibRate : N.vibRate; }
    return Object.assign(c, sp, o);
  };
  const coreOpts = Object.assign({ f, dur }, env, { sweep: (N.sweep || 0) * (A.sweepMul || 1), fenv: N.fenv });
  if (N.repeat) Object.assign(coreOpts, { repeat: N.repeat, rate });
  let core;
  if (N.kind === "whoosh") {
    const w = N.dur * t;
    core = whoosh(treat({ tone: A.air[0], sweep: N.wsweep, body: A.air[1], peak: N.peak, atk: 0.02, dec: 0, sus: 1, rel: 0.12, dur: r2(w), width: 0.8 }, false));
  } else if (N.kind === "leak") {
    core = osc(treat(Object.assign({}, coreOpts, { noise: 0.7, mode: 2, cut: f, reso: 0.4 }), true));
  } else core = osc(treat(coreOpts, true));
  layers.push([core, 0, 1]);
  const atkEnd = core.attack, holdEnd = core.attack + core.hold, span = core.duration;
  const at = N.accent === "end" ? holdEnd : N.accent === "peak" ? (N.kind === "whoosh" ? span * N.peak : atkEnd) : 0;
  const shape = N.repeat ? { atk: 0.02, hold: 0, dec: 0, sus: 1, rel: 0.1, dur: span } : { atk: core.attack, hold: core.hold, dec: core.decay, sus: Math.max(core.sustain, 0.35), rel: core.release, dur: span };
  const clone = (o) => osc(treat(Object.assign({}, coreOpts, o), true));
  const blip = { atk: 0.001, hold: 0.01, dec: 0.03, sus: 0, rel: 0.01, curve: 0 };
  // ---- the adjective's layer
  let x = null;
  if (A.extra === "sparks") x = [part(Object.assign({ rate: 35, tone: 0.9, decay: 0.03, spread: 0.85, drive: 0.5, hp: 1200, width: 0.8 }, sp, shape)), 0];
  if (A.extra === "glint") {
    const g = bar(Object.assign({ f: cl(f * 2, 600, 3500), type: 2, mallet: 0.75, ring: 0.6, dur: 1.0, rel: 0.4, width: 0.6 }, sp));
    if (N.repeat) Object.assign(g, { repeat: N.repeat, rate: r2(rate), duration: dur });
    x = [g, at];
  }
  if (A.extra === "plant") x = [servo({ servoType: 0, servoSpeed: 1500, servoAt: 0, servoRun: r3(span), servoLoad: 0.8, servoLoadEnd: 0.8, servoInertia: 0.3, servoDecel: 0.3,
    servoSlots: 12, servoWhine: 0.25, servoWhineHarm: 3, servoWhineRoll: 2.5, servoBars: 0, servoComm: 0, servoSpark: 0, servoHum: 0.7, servoHumHz: 50, servoRumble: 1.2,
    servoSize: 1, servoBody: 0.7, servoWander: 0.3, servoBearing: 0.05, servoBearingHz: 1500, servoSeed: seedOf(name) },
    { atk: Math.min(0.3, shape.atk + 0.05), sus: 1, rel: Math.min(0.4, shape.rel + 0.1), dur: span }, sp), 0];
  if (A.extra === "gloop") x = [bub(Object.assign({ f: 160, rate: 6 / t, rise: 0.8, spread: 0.5, decay: 0.6, drive: 0.25, cut: 2400 }, sp, shape)), 0];
  if (A.extra === "rush") {
    const into = N.repeat ? 1 / rate : at > 0.15 ? at : span * 0.5;
    const w = whoosh(Object.assign({ tone: 0.5, sweep: 0.9, body: 0.35, peak: 0.88, atk: Math.min(0.5, into * 0.8), hold: Math.max(0, into * 0.8 - 0.5), dec: 0, sus: 1,
      rel: 0.12, dur: r2(Math.min(2, into + 0.12)), width: 0.9, phaser: [0.6, 0.8, 0.9] }, sp));
    if (N.repeat) Object.assign(w, { attack: r3(into * 0.7), release: r3(into * 0.25), repeat: N.repeat, rate: r2(rate), duration: dur });
    x = [w, 0];
  }
  if (A.extra === "double") x = [osc(Object.assign({}, coreOpts, sp, { wave: 18, f: f * semis(8), algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.4, fb: 0.3, vib: 0.15, vibRate: 9,
    chorus: [0.3, 0.9], width: 0.7 })), 0.04 * t];
  if (A.extra === "geiger") x = [part(Object.assign({ rate: 20, tone: 1, decay: 0, spread: 0.95, drive: 0.65, hp: 2000, width: 0.5 }, sp, { atk: 0.01, hold: 0, dec: 0, sus: 1, rel: 0.1, dur: span })), 0];
  if (A.extra === "glitch") x = [clone(Object.assign({}, blip, { f: f * 2, repeat: 6, rate: 16, arp: -3, sweep: 0, down: 6, dur: 0.4 })), 0.05];
  if (x) layers.push([x[0], x[1], A.extraG]);
  // ---- the noun's layer
  let y = null;
  if (N.extra === "steps") y = [clone(Object.assign({}, blip, { f: f * 2, sweep: 0, fenv: 0, repeat: 12, rate: 12 / Math.max(0.3, atkEnd), arp: 1, dur: r2(atkEnd) })), 0];
  if (N.extra === "jolt") y = [imp(Object.assign({ tone: 0.25, decay: 0.3, punch: 0.9, grit: 0.25, dec: 0.15, rel: 0.2, dur: 0.9, boom: 0.7, boomFreq: 55 * Math.sqrt(Math.max(1, A.fMul)), boomDrop: 0.6, boomDecay: 0.4 }, sp)), Math.max(0, at - 0.02)];
  if (N.extra === "zap") y = [clone({ f: f * 2, sweep: -0.6, atk: 0.001, hold: 0.01, dec: 0.15, sus: 0, rel: 0.04, curve: 0, dur: 0.22 }), 0];
  if (N.extra === "streak") y = [clone({ f, sweep: -0.35, atk: span * N.peak, hold: 0, dec: span * (1 - N.peak) * 0.8, sus: 0, rel: 0.08, dur: r2(span) }), 0];
  if (N.extra === "drop2") y = [clone({ f: f * semis(5) }), 0.2 * t];
  if (N.extra === "hiss") y = [part(Object.assign({ rate: 200, tone: 0.88, decay: 0.02, spread: 0.3, hp: 3000, width: 0.7 }, sp, shape)), 0];
  if (N.extra === "beat") y = [clone({ f: f * 1.006 }), 0];
  if (N.extra === "shimmer") y = [osc(Object.assign({}, sp, shape, { wave: 16, f: Math.min(4000, f * 3), partials: 8, tilt: 0.6, drift: 0.8, driftRate: 1.2, adet: 0.6, width: 0.8 })), 0];
  if (N.extra === "thud") y = [imp(Object.assign({ tone: 0.2, decay: 0.2, punch: 0.8, grit: 0.15, dec: 0.12, rel: 0.05, boom: 0.6, boomFreq: 55, boomDrop: 0.5, boomDecay: 0.15 }, sp,
    { repeat: N.repeat, rate, dur })), 0];
  if (y) layers.push([y[0], y[1], N.extraG]);
  const p = sound(layers[0][0], layers.slice(1));
  Object.assign(p, OVERRIDES[name] || {});
  return p;
}
for (const n of FAMILY) S[n] = () => compose(n);

// _vary: the PRESET BUTTON jitters layer 1 only; a pitch is varied lightly where another layer is tied to it (a glint,
// a double, a beat, the steps), its colour and length more
function varyFor(p) {
  const w = Math.round(p.wave), v = {};
  if (w === 20) return { whooshTone: 0.1, whooshSweep: 0.15, whooshPeak: 0.1 };
  v.freq = 0.04;
  if (p.cutoff < 12000) v.cutoff = 0.12;
  if (p.sweep) v.sweep = 0.12;
  if (p.repeat) v.rate = 0.08;
  if (w === 16) v.addDrift = 0.2;
  if (p.drive) v.drive = 0.15;
  if (p.vibDepth) v.vibRate = 0.12;
  return v;
}

// ============================================================================================================
const ALTS = {};
const ALT_IDEA = {};
const ADJ_IDEA = {
  Ionized: "crackly electrical: a driven saw buzzing at 120 Hz, flickering, with sparks",
  Photon: "clean light: a pure, bright, high additive tone (no drive), a glockenspiel glint where it lands",
  Reactor: "heavy plant: a low driven saw with a sub, a 50 Hz throb, the machine room's hum and rumble under it",
  Toxic: "sickly: a detuned, wobbling pulse, crushed, thick low bubbles through it",
  Warp: "space-time: a wide detuned saw, phased, its pitch bending further, an echo, the air rushing into the event",
  Alien: "other-worldly: a hollow FM tone warbling fast, ring-modded at an inharmonic ratio, a metallic FM voice a sixth up warbling at its own rate",
  Radioactive: "a thin crushed pulse through a band, a Geiger counter ticking at random over it",
  Quantum: "discrete: a crushed square, downsampled, flickering out at random, stuttering an octave up in jumps",
};
const NOUN_IDEA = {
  Charge: "builds for a second, rising and brightening, a ratchet of blips climbing under it, snapping off at full",
  Surge: "swells in a quarter second, a jolt (a boom) at the peak, then sags and releases",
  Beam: "a sustained ray: a zap down into it, then holding, buzzing",
  Scan: "four sweeps up, a beat apart",
  Whoosh: "a pass of air, the treatment's tone streaking down under it",
  Drip: "one droplet (a rising blip) and a smaller one after it",
  Leak: "energy escaping: a hissing band of the treatment's tone, fluttering, with a fine hiss",
  Alarm: "five rising whoops",
  Hum: "a steady drone, a slow beat in it",
  Field: "a slow swell into a sustained, phased field, a shimmer of high partials over it",
  Pulse: "four throbs, each dropping in pitch, a thud under each",
};
const IDEA = {
  "Tesla Coil": "the arc SINGS at the interrupter's 120 Hz (narrow driven pulses, flickering), sharp spark snaps, the streamers' ring-modded hiss",
  "Vortex Whoosh": "today's whoosh, now rotating (4 Hz tremolo, faster phaser), the vortex howling (gusty wind, two hollow whistles), air spiralling up",
  "Flying Saucer": "a theremin sine swooping slowly up and down, a fast shimmering sine over it, the hull's pulsing ring-modded hum; phaser and echo",
  "Laser 2": "the BLASTER: a short damped coil spring's dispersive \"pew\" (Ben Burtt's struck wire) with an FM zap falling with it",
  "Meteor Descent": "a whoosh growing to a late peak, the air roaring in under it (weather wind), the rock burning (crackle), then the blast",
  "Comet Whoosh": "a bright whoosh passing over, the wind in its wake, its sparkling tail fizzing after the head",
  "Acid Sizzle": "an effervescent fizz swelling, tiny high bubbles bursting in it, the acid spitting now and then",
  "Acid Splash": "a splat (dark thud, a noise band falling), droplets (a fast bubble burst), then the acid eating (a lingering fizz)",
  "Toxic Bubble": "big slow sludge bubbles, the vat's viscous gurgle (a stream of large bubbles), a fat plop, a sour wobble in the pitch",
  "Gas Leak": "a jet of gas: steady bright turbulence (weather wind) with one edge-tone whistle and a fine fizz",
  "Gas Puff": "a valve clicks open, a short jet bursts and runs out of pressure (its band falling), the valve seats again",
  "Steam Vent": "the vent bangs open, steam ROARS out (wind at full, a hollow whistle at the peak), dies away, condensate sputtering",
  "Force Field": "switching on (a low saw swooping up with a boom), then the field: a phased 100 Hz electric hum, an FM shimmer, a stray spark",
  "Warp Drive": "ENGAGE: a thick phased saw spooling up three octaves, then the jump: a hard whoosh, a deep boom, a high streak falling away",
  "Laser Charge": "the capacitor's whine climbing two octaves, a semitone ratchet under it, then the SHOT: a bright saw sweep down with an echo",
  "Teleporter Hum": "a shimmering cluster of high fluttering partials rising, glockenspiel sparks climbing through it, the machine's 120 Hz hum under it",
  "Energy Drain": "a rich drifting tone sliding down, a warbling ring-modded sine falling with it, a suck of air at the start",
  "Scan Complete": "a run of square blips climbing over a soft rising sweep, then two clean confirm beeps a fifth apart",
  "Warp Drive 2": "DROP OUT: a boom and a hard whoosh on arrival, then the same thick phased saw winding down three octaves, a shimmer settling",
};
for (const n of FAMILY) { const [a, b] = n.split(" "); IDEA[n] = "[" + a + "] " + ADJ_IDEA[a].split(":")[0] + " x [" + b + "] " + NOUN_IDEA[b]; }
const KEPT = {
  "Laser": "the classic laser IS a fast downward pitch sweep on a bright wave (saw, 1200 Hz falling two octaves in 0.3 s); it is the idiom, as the robot beeps were. Laser 2 moves away from it instead (the blaster), so the pair separates",
  "Sci-Fi Brass": "a playable FM 4op brass tone: the four-operator FM brass of 80s/90s sci-fi scores is what the name asks for, and FM 4op is that engine. A static colour (fmEnv 0) is the one thing a brass swell (fmEnv about -0.5) could add; noted, not changed",
  "Slinky": "added this week on the spring engine's coil and picked; a slinky is exactly the dispersive coil the engine models",
  "Ping-Pong Pluck": "a plucked string through a ping-pong delay: a showcase of the stereo delay, and a pluck is the right source for it. Nothing sci-fi or hazardous to model",
};
// Per-sound level offset from the section median, by design (dB). Family offsets come from the tables (adj.lvl + noun.lvl).
const LEVEL_OFFSET = { "Scan Complete": -2, "Gas Leak": -2, "Gas Puff": -1.5, "Acid Sizzle": -1.5, "Acid Splash": -2, "Toxic Bubble": -1, "Steam Vent": 0, "Meteor Descent": 0, "Tesla Coil": 1,
  "Warp Drive": 1, "Laser 2": 0, "Laser Charge": 0 };
// _vary: layer 1 only (the preset button's roll); Variations vary every layer with one shared pitch move
const VARY = {
  "Tesla Coil": { freq: 0.1, pulseWidth: 0.15, flickerRate: 0.2 },
  "Vortex Whoosh": { whooshSweep: 0.2, phaserRate: 0.25, tremRate: 0.15 },
  "Flying Saucer": { freq: 0.12, vibRate: 0.2 },
  "Laser 2": { springSeed: 1, freq: 0.1, springLength: 0.15 },
  "Meteor Descent": { whooshTone: 0.1, whooshSweep: 0.15, whooshBody: 0.15 },
  "Comet Whoosh": { whooshTone: 0.1, whooshSweep: 0.15, whooshPeak: 0.15 },
  "Acid Sizzle": { particleRate: 0.15, particleTone: 0.06, particleSpread: 0.1 },
  "Acid Splash": { particleRate: 0.15, particleTone: 0.06, decay: 0.2 },
  "Toxic Bubble": { freq: 0.12, bubbleRate: 0.2, bubbleSpread: 0.15 },
  "Gas Leak": { wxSeed: 1, wxTone: 0.06, freq: 0.1 },
  "Gas Puff": { wxSeed: 1, decay: 0.2, wxTone: 0.08 },
  "Steam Vent": { wxSeed: 1, wxTone: 0.08, decay: 0.15 },
  "Force Field": { freq: 0.1, phaserRate: 0.3, tremRate: 0.1 },
  "Warp Drive": { sweep: 0.08, detune: 0.3, phaserRate: 0.25 },
  "Laser Charge": { freq: 0.06, sweep: 0.1, attack: 0.08 },
  "Teleporter Hum": { freq: 0.06, addDriftRate: 0.2, sweep: 0.2 },
  "Energy Drain": { freq: 0.12, sweep: 0.12, addDriftRate: 0.2 },
  "Scan Complete": { freq: 0.06, rate: 0.08 },
  "Warp Drive 2": { sweep: 0.08, detune: 0.3, phaserRate: 0.25 },
};

if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e), r = render(p); console.log(fmt(measure(r)) + "\n      " + curve(r)); } process.exit(0); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "scifi-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in steps
// of 0.05 (the smallest that reaches the target), capped at LIMIT_MAX: past that a transient is being squashed to buy
// loudness it does not have, so a sound that cannot get there lands short and the report says by how much.
const LIMIT_MAX = 0.4;
function level(p, target) {
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - m.lufs) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  let lo = 0, hi = Math.round(LIMIT_MAX / 0.05);
  p.limiter = LIMIT_MAX; m = measure(render(p));
  if (m.lufs < target - 0.4) return dcGuard(p);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); const mm = measure(render(p)); if (mm.lufs >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  for (let k = 0; k < 2; k++) { m = measure(render(p)); if (m.lufs > target + 0.3) p.gain = r2(p.gain * Math.pow(10, (target - m.lufs) / 20)); }
  return dcGuard(p);
}
// The Limiter puts DC into low asymmetric pulses (a boom, a rumble): step it down until |DC| is within today's typical
// worst in the section (2e-4), so a level trim never buys loudness with an offset
const DC_MAX = 2e-4;
function dcGuard(p) {
  let m = measure(render(p));
  while (p.limiter && Math.max(Math.abs(m.dcL), Math.abs(m.dcR)) > DC_MAX) { p.limiter = r2(p.limiter - 0.05); if (p.limiter <= 0) delete p.limiter; m = measure(render(p)); }
  return m;
}
// key order as the app writes a preset: the patch, then _vary, then _alts, then layers last
function asPreset(p, vary, alts) {
  const o = {}; for (const [k, v] of Object.entries(p)) if (k !== "layers") o[k] = v;
  o._vary = vary; if (alts && alts.length) o._alts = alts; if (p.layers) o.layers = p.layers;
  return o;
}
const TARGET = median(SECTION.map((n) => refRow(n).m.lufs));
const REDO = SECTION.filter((n) => S[n]);
const lvlOf = (name) => FAMILY.includes(name) ? (ADJ[name.split(" ")[0]].lvl || 0) + (NOUN[name.split(" ")[1]].lvl || 0) : (LEVEL_OFFSET[name] || 0);
const varyOf = (name, p) => VARY[name] || varyFor(p);
const only = arg && arg !== "sep" ? arg : null;
if (only && !REDO.some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + REDO.map(slug).join(", ")); process.exit(1); }
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {}, altRows = [];
console.log("Sci-Fi & Hazard median " + TARGET.toFixed(1) + " LUFS (the level target)");
const fmtLv = (p, m, tgt) => (p.layers ? JSON.parse(p.layers).length + 1 : 1) + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
  ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")";
for (const name of REDO) {
  const s = slug(name);
  if (only && only !== s) continue;
  const p = S[name](), tgt = TARGET + lvlOf(name);
  durCheck(name, p);
  const m = level(p, tgt), r = render(p), now = refRow(name);
  const alts = (ALTS[name] || []).map((fn, i) => { const a = fn(); durCheck(name + " alt " + (i + 1), a); const am = level(a, tgt); const ar = render(a); altRows.push({ name, i, p: a, r: ar, m: am, f: features(am) }); return a; });
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    wav(s + "-2-new.wav", r, name);
    alts.forEach((a, i) => wav(s + "-alt" + (i + 1) + ".wav", render(a), name + " (alt " + (i + 1) + ")"));
  }
  json[name] = asPreset(p, varyOf(name, p), alts);
  for (const k of Object.keys(json[name]._vary)) if (!PRANGE[k]) console.log("  !! " + name + " _vary: " + k + " is not a PARAMS row");
  rows.push({ name, slug: s, p, r, m, f: features(m), now });
  console.log(name.padEnd(18) + "NEW " + fmt(m) + "\n      " + fmtLv(p, m, tgt) +
    altRows.filter((x) => x.name === name).map((x) => "\n  " + "".padEnd(12) + "ALT" + (x.i + 1) + " " + fmt(x.m).replace(/\n/g, "\n    ") + "\n      " + fmtLv(x.p, x.m, tgt)).join("") +
    "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
  if (only) console.log("      " + curve(r));
}
if (only) process.exit(0);

// ---- separation: the whole section as it would ship (new where redesigned, today's where kept), plus three electrical
// neighbours elsewhere (Transformer Buzz, Electric Sparks, Neon Hum)
const shipped = SECTION.map((n) => rows.find((x) => x.name === n) || Object.assign({ kept: true }, refRow(n))).concat(REFS.map((n) => Object.assign({ ref: true }, refRow(n))));
const D = (a, b, set) => { const x = set.find((q) => q.name === a), y = set.find((q) => q.name === b); return [dist(x.f, y.f), why(x.f, y.f)]; };
const todaySet = SECTION.map((n) => refRow(n)).concat(REFS.map((n) => refRow(n)));
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or body, or a clear shape step) — NEW (today)");
const GROUPS = [["Laser", "Laser 2", "Laser Charge"], ["Warp Drive", "Warp Drive 2", "Warp Field", "Warp Scan"],
  ["Photon Whoosh", "Photon Charge", "Photon Drip", "Photon Surge"], ["Reactor Surge", "Reactor Beam", "Reactor Charge"],
  ["Ionized Leak", "Ionized Charge", "Ionized Alarm", "Ionized Beam"], ["Alien Surge", "Reactor Surge", "Toxic Surge", "Photon Surge"],
  ["Ionized Charge", "Photon Charge", "Reactor Charge", "Laser Charge"], ["Ionized Beam", "Reactor Beam"], ["Warp Field", "Alien Field", "Force Field"],
  ["Radioactive Scan", "Warp Scan", "Scan Complete"], ["Vortex Whoosh", "Comet Whoosh", "Photon Whoosh", "Meteor Descent"],
  ["Gas Leak", "Gas Puff", "Steam Vent", "Ionized Leak"], ["Acid Sizzle", "Acid Splash", "Toxic Bubble", "Toxic Surge", "Toxic Hum"],
  ["Teleporter Hum", "Toxic Hum", "Force Field", "Transformer Buzz", "Neon Hum"], ["Tesla Coil", "Electric Sparks", "Ionized Leak"],
  ["Energy Drain", "Laser Charge", "Warp Drive 2"], ["Alien Surge", "Alien Field", "Flying Saucer"], ["Quantum Pulse", "Scan Complete"]];
for (const g of GROUPS) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
  const [d, w] = D(g[i], g[j], shipped), [d0] = D(g[i], g[j], todaySet);
  console.log("  " + d.toFixed(2) + " (" + d0.toFixed(2) + ")  " + g[i] + " / " + g[j] + "   (" + w + ")");
}
for (const a of altRows) { const base = rows.find((x) => x.name === a.name); console.log("  " + dist(a.f, base.f).toFixed(2) + "  " + a.name + " / its alt " + (a.i + 1) + "   (" + why(a.f, base.f) + ")"); }
const all = []; for (let i = 0; i < shipped.length; i++) for (let j = i + 1; j < shipped.length; j++) all.push([shipped[i].name, shipped[j].name, dist(shipped[i].f, shipped[j].f), why(shipped[i].f, shipped[j].f)]);
all.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as shipped (the section + Transformer Buzz, Electric Sparks, Neon Hum):"); for (const [a, b, d, w] of all.slice(0, 12)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
const todayPairs = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) todayPairs.push(dist(refRow(SECTION[i]).f, refRow(SECTION[j]).f));
const secPairs = all.filter(([a, b]) => SECTION.includes(a) && SECTION.includes(b)).map((x) => x[2]);
console.log("  section median pair " + median(secPairs).toFixed(2) + ", min " + Math.min(...secPairs).toFixed(2) + "; TODAY median " + median(todayPairs).toFixed(2) + ", min " + Math.min(...todayPairs).toFixed(2));
const every = rows.concat(altRows);
const over2 = every.filter((x) => x.m.sec > 2.001).map((x) => x.name + (x.i != null ? " alt" + (x.i + 1) : "") + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges (new + alts): audible " + Math.min(...every.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...every.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...every.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...every.map((x) => x.m.lufs)).toFixed(1) + " (target " + TARGET.toFixed(1) + "); peaks max " +
  Math.max(...every.map((x) => x.m.peak)).toFixed(3) + ", clipping " + every.filter((x) => x.m.clip).length + ", |DC| max " +
  Math.max(...every.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1) + "; centroids " +
  Math.min(...every.map((x) => x.m.cent)).toFixed(0) + "-" + Math.max(...every.map((x) => x.m.cent)).toFixed(0) + " Hz");
console.log("  over 2 s: " + (over2.join(", ") || "none"));
const lvShip = shipped.filter((x) => !x.ref).map((x) => x.m.lufs).sort((a, b) => a - b);
console.log("  section as shipped: median " + median(lvShip).toFixed(1) + " LUFS, range " + lvShip[0].toFixed(1) + " to " + lvShip[lvShip.length - 1].toFixed(1));
console.log("  before/after loudness (new - now, dB): " + rows.map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (section order, ~0.4 s apart)
writeFileSync(join(jsonDir, "scifi-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR);
let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(18) + IDEA[x.name]); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Sci-Fi & Hazard redo, all new");
const lv = rows.map((x) => "  " + x.name.padEnd(18) + "now " + x.now.m.lufs.toFixed(1) + "  new " + x.m.lufs.toFixed(1) + " LUFS  (" + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + " dB)" +
  altRows.filter((a) => a.name === x.name).map((a) => "   alt" + (a.i + 1) + " " + a.m.lufs.toFixed(1)).join(""));
const altLines = altRows.map((a) => "- **" + a.name + "**, `" + slug(a.name) + "-alt" + (a.i + 1) + ".wav`: " + ALT_IDEA[a.name][a.i]);
const tables = "## The family (" + FAMILY.length + " names, two tables composed)\n\nAdjective = the treatment:\n\n" + Object.entries(ADJ_IDEA).map(([k, v]) => "- **" + k + "**: " + v).join("\n") +
  "\n\nNoun = the event:\n\n" + Object.entries(NOUN_IDEA).map(([k, v]) => "- **" + k + "**: " + v).join("\n") + "\n\n";
writeFileSync(join(wavDir, "KEY.md"), "# Sci-Fi & Hazard redo — all-new.wav: the " + rows.length + " redesigned sounds in section order, 0.4 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it, <slug>-2-new.wav the redesign (-alt<N>.wav an\n" +
  "# alternative archetype); all Normalize on, NOT loudness-matched (each is what its button plays). The new ones aim at\n" +
  "# the section's median, " + TARGET.toFixed(1) + " LUFS, with stated offsets (a drip and the quiet hazards under it, the reactor\n" +
  "# sounds and Tesla Coil over), at most Limiter " + LIMIT_MAX + "; a transient that cannot get there lands short rather than being squashed.\n\n```\n" + key.join("\n") + "\n```\n\n" +
  (altLines.length ? "## Alternatives (a different object, not a variation)\n\n" + altLines.join("\n") + "\n\n" : "") + tables +
  "## Loudness, before and after (BS.1770; a big gap makes the louder one sound better, so listen past it)\n\n```\n" + lv.join("\n") + "\n```\n\n" +
  "## KEPT (no file: today's sound stays)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + rows.length + " x2 WAVs + " + altRows.length + " alts, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, scifi-redo.json");

