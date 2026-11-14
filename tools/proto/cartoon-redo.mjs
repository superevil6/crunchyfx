/* magic-redo.mjs — the MAGIC presets redesigned. PROPOSAL / A-B material: nothing here is wired into presets.js; AJ
 * listens to the labeled before/after WAVs and keeps what is better. AJ: this is one of three categories left "that would
 * benefit from it" before the next release.
 *
 *   node tools/proto/magic-redo.mjs            renders every redesign (now + new + alts), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/magic-redo.mjs ref        measures today's 51 (the level bar: their median and spread)
 *   node tools/proto/magic-redo.mjs sep        separation only (renders the new ones, prints the named pairs and the closest)
 *   node tools/proto/magic-redo.mjs <slug>     one redesign, measured, its WAVs written (no JSON, no all-new.wav)
 *   node tools/proto/magic-redo.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/magic-redo.mjs x '<js>' ...         measure patches built with the voices below (osc(), glass(), S["Ice"]() ...)
 *
 * MAGIC IS SYNTHETIC BY NATURE, like the sci-fi devices: a shimmer, a chime cluster, an FM sparkle or a riser IS the
 * idiom. So the gain is in the BUILD (a charge, a release and a tail as separate layers), and where a spell is an
 * ELEMENT, in that element's own physical body: ice is glass 36 (Ice, Crystal), lightning the weather engine's thunder
 * under an arc, an arcane blast the blast engine, wind slash weather wind with an edge tone, poison bubbles; a holy or a
 * dark spell has a choir in it (formant 13). The Wizard's picked spells (WIZ_SPELLS) are AJ's word on the idiom.
 *
 * VARIETY OVER REPLACEMENT (AJ: "the joy of clicking the button repeatedly and getting variety"; "someone may actually
 * be looking for a more synth'd version"). Three outcomes per sound:
 *   REDESIGNED  a new base; where today's still holds up as the synth'd take it is KEPT AS THE LAST ALT (TODAY_ALT)
 *   KEEP_BASE   today's stays the base and the new takes join it as _alts (ALTS)
 *   KEPT        unchanged, with the reason
 *   THE FAMILY: 26 names that are an ADJECTIVE x a NOUN (16 bred at random in 2026-07, 10 hand-made) are two tables
 *   composed (ADJ, NOUN, compose()), as in scifi-redo.mjs and horror-redo-family.mjs.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, Normalize ON and NOT loudness-matched:
 * each WAV is what the app's button plays. `gain` on layer 1 (the whole sound's master gain) is the one number not from a
 * design: it lands the integrated loudness on today's section median plus a stated per-sound offset; a Limiter only
 * where gain 1 cannot reach it, stepped down if it puts DC in. Measurement and separation are scifi-redo.mjs's.
 *
 * Writes soundtests/magic-redo/<slug>-1-now.wav, <slug>-2-new.wav, <slug>-alt<N>.wav, all-new.wav + KEY.md, and
 * tools/new-presets/magic-redo.json ({ name: patch with _vary, _alts, layers last }) for node tools/replace-presets.mjs.
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
const SECTION = CATS.find((c) => c[0] === "Cartoon / Misc")[1];
// neighbours in other sections, in the separation set: a coil boing, a jaw harp, two bubbles, a kazoo, a snap
const REFS = ["Slinky", "Jaw Harp", "Bubble Drop", "Goopy Slurp", "Kazoo", "Finger Snap"];

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
  if (!g.length) return { i: -70, m: -70 };
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10;
  g = g.filter((m) => l(m) > rel);
  // i: integrated (BS.1770); m: the loudest 400 ms (momentary max). A one-shot with a tail (a cork's fizz, a jar's ring)
  // is judged on m: integrated loudness averages the tail in, so the same pop reads quieter the longer it rings
  return { i: l(g.reduce((t, m) => t + m, 0) / g.length), m: l(Math.max(...ms)) };
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
  const LU = lufs(L, R);
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: LU.i, mmax: LU.m,
    cent: cd ? cn / cd : 0, lo: cd ? blo / cd : 0, hi: cd ? bhi / cd : 0, cmove, texture, atk, maxAt: imx * 0.02 - Math.max(0, first) / SR, end80,
    bursts, f0: f0med, tonal, pmove, bodyHz: bd.hz, bodyDb: bd.prom };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS (max " + m.mmax.toFixed(1) + ")  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
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

// ---- the reference: today's 44
const refCache = new Map();
function refRow(name) {
  if (!refCache.has(name)) { const m = measure(render(PRESETS[name])); refCache.set(name, { name, m, f: features(m) }); }
  return refCache.get(name);
}
if (arg === "ref") {
  for (const name of SECTION) console.log(name.padEnd(18) + fmt(refRow(name).m));
  const e = SECTION.map((n) => refRow(n).m.lufs).sort((a, b) => a - b);
  console.log("\nCARTOON / MISC (" + SECTION.length + ") median " + median(e).toFixed(1) + " LUFS, range " + e[0].toFixed(1) + " to " + e[e.length - 1].toFixed(1) +
    " (spread " + (e[e.length - 1] - e[0]).toFixed(1) + " dB; middle half " + e[Math.floor(e.length / 4)].toFixed(1) + " to " + e[Math.floor(3 * e.length / 4)].toFixed(1) + ")");
  const p = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) { const a = refRow(SECTION[i]), b = refRow(SECTION[j]); p.push([a.name, b.name, dist(a.f, b.f), a.f, b.f]); }
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY closest pairs:"); for (const [a, b, d, fa, fb] of p.slice(0, 12)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2));
  process.exit(0);
}

const STRETCH = new Set([27, 29, 30, 31, 35, 37]);
// every key a layer sets must be a PARAMS row and sit inside its range (index.html's own table, read as text)
const PRANGE = {};
for (const m of readFileSync(join(ROOT, "index.html"), "utf8").matchAll(/^\s*\["(\w+)",\s*"[^"]*",\s*(-?[\d.]+),\s*([^,]+),\s*(-?[\d.]+),/gm)) {
  const max = m[1] === "wave" ? 37 : m[1] === "filterMode" ? 4 : +m[3]; PRANGE[m[1]] = [+m[2], max];
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
// the pitch rows any pitched engine reads: a sweep (octaves = sweep x 4 over the sound, or over each shot), vibrato,
// noise, sub, ring
function pitched(p, o) {
  p.freq = Math.round(cl(o.f, 20, 4000));
  if (o.sweep) p.sweep = r2(cl(o.sweep, -1, 1));
  if (o.vib) Object.assign(p, { vibDepth: r3(o.vib), vibRate: r2(o.vibRate ?? 6) });
  if (o.vibOnset) p.vibOnset = r2(o.vibOnset);
  if (o.unison > 1) Object.assign(p, { unison: o.unison, detune: r2(o.detune ?? 12) });
  if (o.noise) { p.noise = r2(o.noise); if (o.color) p.noiseColor = r2(o.color); }
  if (o.sub) p.subOsc = r2(o.sub);
  if (o.ring) Object.assign(p, { ringMod: r2(o.ring), ringFreq: Math.round(cl(o.ringF, 0, 2000)) });
  return p;
}
// an oscillator (0 sine, 1 square, 2 saw, 3 triangle, 4 pulse, 6 organ, 7 half-sine), or FM 4op (18), or additive (16)
function osc(o) {
  const p = pitched({ wave: o.wave ?? 0 }, o);
  if (o.pw != null) p.pulseWidth = r2(o.pw);
  if (o.pwm) Object.assign(p, { pwmDepth: r2(o.pwm[0]), pwmRate: r2(o.pwm[1]) });
  if (p.wave === 18) Object.assign(p, { fmAlgo: o.algo ?? 0, fmRatio2: o.r2 ?? 1, fmRatio3: o.r3 ?? 2, fmRatio4: o.r4 ?? 3, fmIndex: r2(o.index ?? 0.5),
    fmFeedback: r2(o.fb || 0) }, o.fmEnv ? { fmEnv: r2(o.fmEnv), fmEnvTime: r2(o.fmEnvTime ?? 0.15) } : {});
  if (p.wave === 16) Object.assign(p, { addPartials: o.partials ?? 8, addTilt: r2(o.tilt ?? 0.4), addDrift: r2(o.drift ?? 0.3), addDriftRate: r2(o.driftRate ?? 0.3),
    addDetune: r2(o.adet ?? 0.3) });
  return chassis(p, o);
}
// flute (26): a jet across a pipe. A SLIDE WHISTLE is exactly this with the plunger moving: a sweep moves the pipe
function flute(o) {
  const p = pitched({ wave: 26, fluteBreath: r2(o.breath ?? 1), fluteJet: r2(o.jet ?? 0.5), fluteAim: r2(o.aim ?? 0.4), fluteNoise: r2(o.fnoise ?? 0.05),
    fluteTone: r2(o.tone ?? 0.5), fluteVib: r2(o.fvib || 0), fluteBuzz: r2(o.buzz || 0) }, o);
  return chassis(p, Object.assign({ atk: 0.03, dec: 0, sus: 1, rel: 0.12, cut: 12000 }, o));
}
// brass (21): lips buzzing into a tube. A RASPBERRY is lips buzzing with no tube to speak of (a short, open bell)
function brass(o) {
  const p = pitched({ wave: 21, brassBreath: r2(o.breath ?? 0.57), brassLips: r2(o.lips ?? 0.4), brassBell: r2(o.bell ?? 0.59), brassTube: r2(o.tube ?? 0.31) }, o);
  return chassis(p, Object.assign({ atk: 0.03, dec: 0, sus: 1, rel: 0.12, cut: 12000 }, o));
}
// reed (23): a reed buzzing on a tube (a kazoo-ish, a duck call)
function reed(o) {
  const p = pitched({ wave: 23, reedBore: o.bore ?? 0, reedBreath: r2(o.breath ?? 0.7), reedTongue: r2(o.tongue ?? 1), reedBell: r2(o.bell ?? 0.82),
    reedWobble: r2(o.wobble ?? 1), reedTone: r2(o.tone ?? 0.29) }, o);
  return chassis(p, Object.assign({ atk: 0.02, dec: 0, sus: 1, rel: 0.1, cut: 12000 }, o));
}
// creature (28): a throat (a burp is a throat letting go) and a mouth that opens and closes
function creature(o) {
  const p = { wave: 28, freq: Math.round(cl(o.f, 20, 4000)), crSize: r2(o.csize ?? 1), crPitchStart: r2(o.p0 ?? 0), crPitchEnd: r2(o.p1 ?? 0), crPeak: r2(o.peak ?? 0.4),
    crOpenStart: r2(o.o0 ?? 0.3), crOpenPeak: r2(o.op ?? 0.8), crOpenEnd: r2(o.o1 ?? 0.3), crVowelStart: r2(o.v0 ?? 0.5), crVowelEnd: r2(o.v1 ?? 0.5),
    crNasal: r2(o.nasal || 0), crTension: r2(o.tension ?? 0.5), crJitter: r2(o.jitter || 0), crShimmer: r2(o.shimmer || 0), crRough: r2(o.rough || 0),
    crBreath: r2(o.breath || 0) };
  if (o.flutter) Object.assign(p, { crFlutter: r2(o.flutter), crFlutterRate: r2(o.flutterRate ?? 20) });
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.vib) Object.assign(p, { vibDepth: r3(o.vib), vibRate: r2(o.vibRate ?? 6) });
  return chassis(p, Object.assign({ atk: 0.02, dec: 0, sus: 1, rel: 0.08, cut: 12000 }, o));
}
// formant (13): a buzz through three resonators (vowels); its vowel LFO is a "wah-wah-wah"
function formant(o) {
  const p = pitched({ wave: 13, formantVowel: r2(o.vowel ?? 0.5), formantSize: r2(o.fsize ?? 1), formantQ: r2(o.q ?? 0.5), formantBreath: r2(o.breath || 0) }, o);
  if (o.tilt) p.formantTilt = r2(o.tilt);
  if (o.rough) p.formantRough = r2(o.rough);
  if (o.lfo) Object.assign(p, { formantLfoRate: r2(cl(o.lfo[0], 0, 8)), formantLfoDepth: r2(o.lfo[1]) });
  return chassis(p, Object.assign({ atk: 0.01, dec: 0.1, sus: 1, rel: 0.1 }, o));
}
// friction (34): stick-slip on a body (0 wood, 1 iron, 2 rubber, 3 hinged wood). speeds: [[t, speed], ...] up to four
// (the first at t 0), presses likewise; stop: when the push stops. The amp envelope gates it (hold to the stop)
function fric(o) {
  const p = { wave: 34, fricBody: o.body ?? 2, freq: Math.round(cl(o.f, 20, 4000)), fricTone: r2(o.tone ?? 0.5), fricGrip: r2(o.grip ?? 0.5), fricRough: r2(o.rough ?? 0.3),
    fricLock: r2(o.lock ?? 0.5) };
  const sp = o.speeds || [[0, 0.5]], pr = o.presses || [[0, 0.5]];
  p.fricSpeed = r2(sp[0][1]);
  sp.slice(1, 4).forEach(([t, v], i) => { p["fricT" + (i + 1)] = r3(t); p["fricSpeed" + (i + 1)] = r2(v); });
  p.fricStop = r3(o.stop ?? 0);
  p.fricPress = r2(pr[0][1]);
  pr.slice(1, 4).forEach(([t, v], i) => { p["fricPressT" + (i + 1)] = r3(t); p["fricPress" + (i + 1)] = r2(v); });
  p.fricSeed = o.seed ?? 1;
  // (no sweep or vibrato: the body's modes are fixed, and the friction engine reads neither; measured)
  const stop = o.stop || o.dur - 0.04;
  return chassis(p, Object.assign({ atk: 0.001, hold: Math.max(0, stop - 0.001), dec: 0.03, sus: 0, rel: 0.01, mode: 0, cut: 12000, width: 0.35 }, o));
}
// impact (19): a contact transient + its boom
function imp(o) {
  const p = { wave: 19, impactTone: r2(o.tone), impactDecay: r2(o.decay), impactPunch: r2(o.punch ?? 0.8), impactGrit: r2(o.grit ?? 0.2) };
  if (o.noise) { p.noise = r2(o.noise); if (o.color) p.noiseColor = r2(o.color); }
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.ring) Object.assign(p, { ringMod: r2(o.ring), ringFreq: Math.round(cl(o.ringF, 0, 2000)) });
  return chassis(p, Object.assign({ atk: 0.001, sus: 0 }, o));
}
// bar (24): a struck bar (0 marimba, 1 xylophone, 2 glockenspiel, 3 vibraphone)
function bar(o) {
  const p = { wave: 24, freq: Math.round(cl(o.f, 20, 4000)), barType: o.type ?? 2, barMallet: r2(o.mallet ?? 0.5), barRing: r2(o.ring ?? 0.5) };
  return chassis(p, Object.assign({ atk: 0, hold: 0, dec: 0, sus: 1, rel: 0.4 }, o));
}
// modal (10): a struck resonant body
function modal(o) {
  const p = { wave: 10, freq: Math.round(cl(o.f, 20, 4000)), modalPartials: o.parts ?? 8, modalInharm: r2(o.inharm), modalDecay: r2(o.ring), modalBright: r2(o.bright ?? 0.5) };
  if (o.noise) { p.noise = r2(o.noise); p.noiseColor = r2(o.color ?? 0.3); }
  if (o.sweep) p.sweep = r2(o.sweep);
  return chassis(p, Object.assign({ atk: 0.001, hold: 0.004, sus: 0 }, o));
}
// whoosh (20): air moved past
function whoosh(o) {
  return chassis({ wave: 20, whooshTone: r2(o.tone), whooshSweep: r2(o.sweep ?? 0.5), whooshBody: r2(o.body ?? 0.3), whooshPeak: r2(o.peak ?? 0.5) },
    Object.assign({ atk: 0.02, sus: 1, rel: 0.15, cut: 9000, width: 0.6 }, o));
}
// particle (15): dense tiny contacts (crackle, fizz, grit, bristles)
function part(o) {
  return chassis({ wave: 15, particleRate: Math.round(cl(o.rate, 5, 200)), particleTone: r2(cl(o.tone, 0, 1)), particleDecay: r2(cl(o.decay, 0, 1)), particleSpread: r2(o.spread ?? 0.5) },
    Object.assign({ atk: 0.02, sus: 1, rel: 0.1, width: 0.6 }, o));
}
// bubble (14): Minnaert bubbles (a plop is one big one)
function bub(o) {
  const p = { wave: 14, freq: Math.round(cl(o.f, 20, 4000)), bubbleRate: Math.round(cl(o.rate, 1, 60)), bubbleRise: r2(o.rise ?? 0.5), bubbleSpread: r2(o.spread ?? 0.4),
    bubbleDecay: r2(o.decay ?? 0.4) };
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.vib) Object.assign(p, { vibDepth: r3(o.vib), vibRate: r2(o.vibRate ?? 6) });
  if (o.noise) { p.noise = r2(o.noise); if (o.color) p.noiseColor = r2(o.color); }
  return chassis(p, Object.assign({ atk: 0.005, sus: 1, rel: 0.12, cut: 8000, width: 0.5 }, o));
}
// flow (35): a stream's pockets (type 0), a waterfall (1), a pour (3); the envelope is the flow
function flow(o) {
  const p = { wave: 35, flowType: o.type ?? 0, flowAmount: r2(o.amount ?? 0.5), flowSize: r2(o.bsize ?? 2), flowBabble: r2(o.babble ?? 0.5), flowBody: r2(o.body ?? 0.3),
    flowRise: r2(o.rise ?? 0.3), flowTone: r2(o.tone ?? 0.5), flowDistance: r2(o.distance ?? 0.2), flowSeed: o.seed ?? 1 };
  if (o.type === 3) Object.assign(p, { flowVessel: r2(o.vessel ?? 0.2), flowFillStart: r2(o.fill0 ?? 0.05), flowFill: r2(o.fill1 ?? 0.85) });
  return chassis(p, Object.assign({ cut: 12000, width: 0.6 }, o));
}
// spring (32): 0 a coil (a "pew" on every round trip), 1 a doorstop ("doinng"), 2 a twang (a jaw harp; mouth = how the
// mouth moves: + opening, - closing; vowel where it sits)
function spring(o) {
  const p = { wave: 32, springType: o.type ?? 0, freq: Math.round(o.f) };
  if ((o.type ?? 0) === 0) Object.assign(p, { springLength: Math.round(o.len ?? 60) });
  if (o.disp != null) p.springDisp = r2(o.disp);
  if (o.type === 2) Object.assign(p, { springMouth: r2(o.mouth ?? 0), springVowel: r2(o.vowel ?? 0.4) });
  Object.assign(p, { springDamp: r2(o.damp ?? 0.5), springSway: r2(o.sway || 0), springSwayRate: r2(o.swayRate || 7), springPluck: r2(o.pluck ?? 0.6), springSeed: o.seed ?? 1 });
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.vib) Object.assign(p, { vibDepth: r3(o.vib), vibRate: r2(o.vibRate ?? 6) });
  Object.assign(p, { attack: r3(o.atk || 0), hold: 0, decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.015), filterMode: 1, cutoff: Math.round(o.hp || 40),
    reso: 0, drive: r2(o.drive || 0), duration: r2(o.dur), width: r2(o.width ?? 0.4) });
  if (o.drive) p.driveOS = 2;
  if (o.trem) Object.assign(p, { tremDepth: r2(o.trem[0]), tremRate: r2(o.trem[1]) });
  if (o.repeat > 1) { p.repeat = o.repeat; p.rate = r2(cl(o.rate, 1, 30)); if (o.arp) p.arpStep = o.arp; }
  return space(p, o);
}
// glass (36), no break: a vessel or a solid struck (the striker 0 soft .. 1 hard), ringing
function glass(o) {
  return space({ wave: 36, freq: Math.round(o.f), glBreak: 0, glMaterial: o.material ?? 0, glShape: o.shape ?? 0, glThick: r2(o.thick ?? 0.3), glStriker: r2(o.striker ?? 0.6),
    glThump: r2(o.thump || 0), glCrack: 0, glRing: r2(o.ring ?? 0.5), glBeat: r2(o.beat ?? 0.3), glPair: r2(o.pair || 0), glPairTune: r2(o.pairTune || 0), glSeed: o.seed ?? 1,
    glPeak: r2(o.peakCtl || 0), width: r2(o.width ?? 0.5), attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06, filterMode: 1, cutoff: 40, reso: 0, drive: 0,
    duration: r2(o.dur) }, o);
}
// A sound = layer 1's patch + layers 2-4 as the JSON string the app stores ({ s, d, g, p, m: 0 })
function sound(base, extra) {
  const p = Object.assign({}, base);
  const ls = (extra || []).filter(Boolean).map(([s, d, g, pt]) => ({ s, d: r3(d), g: r2(g), p: pt || 0, m: 0 }));
  if (ls.length > 3) throw new Error("more than 4 layers");
  if (ls.length) p.layers = JSON.stringify(ls);
  return p;
}
// ============================================================================================================
// THE NAMED DESIGNS. S[name]() is the new base; ALTS[name] the extra archetypes (a function each), ALT_IDEA what each
// is. TODAY(name) puts today's preset in as an alt where it is a good SYNTH version of the gesture (AJ: "someone may
// actually be looking for a more synth'd version"), so redesigning a base never removes the old sound from the button.
const S = {}, ALTS = {}, ALT_IDEA = {};
const TODAY = (name) => () => { const p = Object.assign({}, PRESETS[name]); delete p._vary; delete p._alts; return p; };
const TODAY_IDEA = "today's preset, kept as an alt: the synth version of the same gesture";

// ---- REAL OBJECTS --------------------------------------------------------------------------------------------
// GOLD BAR CLUNK: a heavy bar of soft, dense metal set down hard on a wooden table. Gold barely rings (it is soft), so
// the bar is a short, low, inharmonic ring with a dull contact; the TABLE gives the weight (a wooden thump with a
// little boom); and a bar landing flat rocks once onto its other edge, a softer second clunk a beat later.
S["Gold Bar Clunk"] = () => sound(
  modal({ f: 410, parts: 8, inharm: 0.55, ring: 0.22, bright: 0.32, noise: 0.18, color: 0.45, drive: 0.3, atk: 0.001, hold: 0.004, dec: 0.22, rel: 0.2, dur: 0.75, cut: 5200,
    reverb: 0.12, size: 0.35, rtone: 0.4, width: 0.35 }),
  [[imp({ tone: 0.28, decay: 0.16, punch: 0.95, grit: 0.12, boom: 0.3, boomFreq: 125, boomDrop: 0.2, boomDecay: 0.1, dec: 0.12, rel: 0.12, dur: 0.5, cut: 4000, width: 0.3 }), 0, 0.85],
   [modal({ f: 395, parts: 6, inharm: 0.55, ring: 0.14, bright: 0.25, noise: 0.15, color: 0.5, dec: 0.12, rel: 0.12, dur: 0.45, cut: 4000, reverb: 0.12, size: 0.35, width: 0.35 }), 0.085, 0.42],
   [imp({ tone: 0.3, decay: 0.08, punch: 0.7, grit: 0.1, dec: 0.06, rel: 0.06, dur: 0.3, cut: 3500, width: 0.3 }), 0.085, 0.3]]);
ALTS["Gold Bar Clunk"] = [TODAY("Gold Bar Clunk")];
ALT_IDEA["Gold Bar Clunk"] = ["today's: one dull ring-modded impact, a darker thud"];

// PALETTE SCRAPE: a thin steel palette knife dragged through paint across a wooden palette: stick-slip of a BLADE
// (friction, iron, a small high body; low grip: the paint greases it; rough: the paint's lumps), the paint's tack
// under it (fine low grit), and the knife lifted off with a short second flick.
S["Palette Scrape"] = () => sound(
  fric({ body: 1, f: 1500, tone: 0.72, grip: 0.32, rough: 0.8, lock: 0.18, speeds: [[0, 0.42], [0.12, 0.62], [0.32, 0.5]], presses: [[0, 0.55], [0.28, 0.4]],
    stop: 0.4, dur: 0.46, seed: 31, reverb: 0.1, size: 0.3, rtone: 0.45, width: 0.4 }),
  [[osc({ wave: 0, f: 200, noise: 1, color: 0.25, mode: 2, cut: 1900, reso: 0.35, wah: [2.5, 0.3], atk: 0.04, hold: 0.24, dec: 0.12, sus: 0, rel: 0.05, dur: 0.46, width: 0.45 }), 0, 0.55],
   [part({ rate: 140, tone: 0.32, decay: 0.12, spread: 0.6, atk: 0.04, hold: 0.25, dec: 0.12, sus: 0, rel: 0.05, dur: 0.46, cut: 3000, width: 0.45 }), 0, 0.4],
   [fric({ body: 1, f: 1650, tone: 0.75, grip: 0.3, rough: 0.8, lock: 0.18, speeds: [[0, 0.6]], presses: [[0, 0.4]], stop: 0.09, dur: 0.13, seed: 32, width: 0.4 }), 0.5, 0.6]]);

// BRUSH TAP: a wet paintbrush tapped twice on the rim of a glass water jar to shake it off: the jar rings under a
// wooden handle (glass engine, a vessel, a soft striker), tap-tap, and the shaken-off drops land in the water.
S["Brush Tap"] = () => sound(
  glass({ f: 1250, material: 0, shape: 0, thick: 0.35, striker: 0.42, ring: 0.32, beat: 0.35, seed: 61, dur: 0.6, reverb: 0.12, size: 0.3, rtone: 0.55, width: 0.4 }),
  [[glass({ f: 1250, material: 0, shape: 0, thick: 0.35, striker: 0.38, ring: 0.3, beat: 0.35, seed: 62, dur: 0.5, reverb: 0.12, size: 0.3, rtone: 0.55, width: 0.4 }), 0.13, 0.7],
   [bub({ f: 1500, rate: 9, rise: 0.6, spread: 0.5, decay: 0.25, atk: 0.005, sus: 1, rel: 0.08, dur: 0.3, cut: 9000, width: 0.6 }), 0.06, 0.35]]);
ALTS["Brush Tap"] = [TODAY("Brush Tap")];
ALT_IDEA["Brush Tap"] = ["today's: one dry tap on a small wooden body"];

// BRUSH CLATTER: a handful of brushes dropped into a jar: wooden handles rattling against each other (two modal wood
// bodies at their own rates, so the clatter never falls into a grid), the jar ringing under them, a last settle.
S["Brush Clatter"] = () => sound(
  modal({ f: 940, parts: 6, inharm: 0.35, ring: 0.06, bright: 0.55, noise: 0.15, color: 0.3, dec: 0.03, rel: 0.05, repeat: 6, rate: 19, dur: 0.36, cut: 7000, width: 0.55,
    reverb: 0.12, size: 0.35, rtone: 0.55 }),
  [[modal({ f: 1310, parts: 6, inharm: 0.4, ring: 0.05, bright: 0.6, noise: 0.15, color: 0.3, dec: 0.025, rel: 0.04, repeat: 4, rate: 13, dur: 0.33, cut: 8000, width: 0.6 }), 0.03, 0.7],
   [glass({ f: 780, material: 0, shape: 0, thick: 0.45, striker: 0.35, ring: 0.42, beat: 0.4, seed: 71, dur: 0.7, reverb: 0.12, size: 0.35, width: 0.5 }), 0, 0.45],
   [modal({ f: 1080, parts: 6, inharm: 0.35, ring: 0.08, bright: 0.5, noise: 0.12, dec: 0.04, rel: 0.06, dur: 0.25, cut: 7000, width: 0.4 }), 0.44, 0.45]]);

// KNUCKLE CRACK: knuckles cracked one after another: each crack is a cavitation POP in a joint (a very short, sharp
// broadband click with a low knock of the finger behind it), irregularly spaced, and the last a gristly "crrk" run.
S["Knuckle Crack"] = () => sound(
  imp({ tone: 0.72, decay: 0.03, punch: 1, grit: 0.4, boom: 0.25, boomFreq: 170, boomDrop: 0.2, boomDecay: 0.03, dec: 0.025, rel: 0.03, dur: 0.12, hp: 250, width: 0.3,
    reverb: 0.08, size: 0.25 }),
  [[imp({ tone: 0.66, decay: 0.03, punch: 1, grit: 0.45, boom: 0.2, boomFreq: 190, boomDecay: 0.03, dec: 0.025, rel: 0.03, dur: 0.12, hp: 250, width: 0.3 }), 0.14, 0.75],
   [imp({ tone: 0.78, decay: 0.025, punch: 1, grit: 0.35, dec: 0.02, rel: 0.03, dur: 0.1, hp: 300, width: 0.3 }), 0.23, 0.55],
   [part({ rate: 90, tone: 0.6, decay: 0.04, spread: 0.85, atk: 0.003, hold: 0.04, dec: 0.04, sus: 0, rel: 0.02, dur: 0.1, hp: 400, width: 0.35 }), 0.33, 0.65]]);

// WAX SEAL: a seal pressed into a pool of hot wax and lifted: the wax squishes under it (a soft, dark, wet squeeze),
// the press lands with the desk's dull thud, a breath of the wax still hissing, and the seal pulled off with a sticky tick.
S["Wax Seal"] = () => sound(
  imp({ tone: 0.22, decay: 0.15, punch: 0.6, grit: 0.05, drive: 0.4, dec: 0.12, rel: 0.1, dur: 0.4, cut: 2400, width: 0.3,
    reverb: 0.1, size: 0.3, rtone: 0.35 }),
  [[bub({ f: 240, rate: 28, rise: 0.4, spread: 0.6, decay: 0.15, atk: 0.005, hold: 0.06, dec: 0.12, sus: 0, rel: 0.05, dur: 0.24, cut: 1500, width: 0.4 }), 0.01, 0.6],
   [part({ rate: 160, tone: 0.7, decay: 0.02, spread: 0.3, atk: 0.04, hold: 0.1, dec: 0.2, sus: 0, rel: 0.05, dur: 0.4, hp: 3000, width: 0.5 }), 0.05, 0.18],
   [part({ rate: 130, tone: 0.55, decay: 0.05, spread: 0.7, atk: 0.002, hold: 0.02, dec: 0.04, sus: 0, rel: 0.02, dur: 0.08, hp: 600, width: 0.35 }), 0.52, 0.55]]);
ALTS["Wax Seal"] = [TODAY("Wax Seal")];
ALT_IDEA["Wax Seal"] = ["today's: a soft, dark stamp thud alone"];

// SHEARS SNIP: two cuts with a pair of shears: each is the blades SLIDING past each other (stick-slip on a small iron
// body, fast: the "shhk") and then CLOSING (the blades meet: a crisp, bright metal click with a short ring).
const shear = (seed) => fric({ body: 1, f: 2300, tone: 0.85, grip: 0.45, rough: 0.45, lock: 0.45, speeds: [[0, 0.7], [0.04, 0.85]], presses: [[0, 0.45]], stop: 0.07, dur: 0.1, seed, width: 0.35 });
const snip = () => modal({ f: 2650, parts: 5, inharm: 0.6, ring: 0.07, bright: 0.9, noise: 0.25, color: 0.1, dec: 0.04, rel: 0.05, dur: 0.22, cut: 12000, width: 0.35, reverb: 0.1, size: 0.3, rtone: 0.65 });
S["Shears Snip"] = () => sound(shear(41), [[snip(), 0.07, 0.9], [shear(42), 0.24, 0.85], [snip(), 0.31, 0.8]]);
ALTS["Shears Snip"] = [TODAY("Shears Snip")];
ALT_IDEA["Shears Snip"] = ["today's: two bright metal clicks, no blade slide"];

// PAINT STROKE: a loaded brush dragged across canvas: the bristles' scratch IS the stroke (dense soft particle grit
// swelling and fading with the stroke), the canvas tooth catching a few of them brighter, and a soft swish of the stroke.
S["Paint Stroke"] = () => sound(
  part({ rate: 170, tone: 0.48, decay: 0.08, spread: 0.65, atk: 0.07, hold: 0.12, dec: 0.22, sus: 0, rel: 0.08, dur: 0.52, hp: 350, mode: 1, width: 0.55, reverb: 0.08, size: 0.3 }),
  [[whoosh({ tone: 0.25, sweep: 0.3, body: 0.3, peak: 0.45, atk: 0.06, hold: 0.1, dec: 0.25, sus: 0, rel: 0.08, dur: 0.52, cut: 3500, width: 0.6 }), 0, 0.55],
   [part({ rate: 50, tone: 0.78, decay: 0.02, spread: 0.9, atk: 0.07, hold: 0.12, dec: 0.2, sus: 0, rel: 0.05, dur: 0.5, hp: 2500, width: 0.6 }), 0, 0.35]]);
ALTS["Paint Stroke"] = [TODAY("Paint Stroke")];
ALT_IDEA["Paint Stroke"] = ["today's: a soft whoosh of the stroke, no bristles"];

// ---- CARTOON NAMED ----------------------------------------------------------------------------------------------
// SLIDE WHISTLE: a real slide whistle is a FLUTE whose plunger moves: a breathy jet over an open pipe, a chiff of air
// as it speaks, the pitch gliding as the pipe shortens (up) or lengthens (down) two octaves, a slight unsteadiness of
// the player's breath. The flute engine moves its pipe with the sweep.
const slide = (o) => flute(Object.assign({ breath: 1, jet: 0.5, aim: 0.42, fnoise: 0.22, tone: 0.32, fvib: 0.15, atk: 0.025, dec: 0, sus: 1, rel: 0.09,
  vib: 0.012, vibRate: 5.5, reverb: 0.15, size: 0.4, rtone: 0.6, width: 0.3 }, o));
S["Slide Whistle Up"] = () => slide({ f: 420, sweep: 0.5, dur: 0.72 });
ALTS["Slide Whistle Up"] = [TODAY("Slide Whistle Up"), () => slide({ f: 360, sweep: 0.55, vib: 0.05, vibRate: 7, vibOnset: 0.45, dur: 1.05, rel: 0.15 })];
ALT_IDEA["Slide Whistle Up"] = [TODAY_IDEA, "a slower climb (2.2 octaves over a second) with a wobble blooming at the top"];
S["Slide Whistle Down"] = () => slide({ f: 1500, sweep: -0.5, dur: 0.72 });
ALTS["Slide Whistle Down"] = [TODAY("Slide Whistle Down"), () => slide({ f: 1700, sweep: -0.4, vib: 0.04, vibRate: 6, vibOnset: 0.3, dur: 1.3, rel: 0.2 })];
ALT_IDEA["Slide Whistle Down"] = [TODAY_IDEA, "the long fall off a cliff: a slower glide down over 1.3 s, wobbling as it goes"];

// FART: LIPS buzzing (the brass engine's lips with almost no tube or bell, which is what a raspberry is), low, the
// cheeks fluttering it (a fast tremolo and flicker: the sputter), sagging in pitch, with the escaping air under it.
// (driven: lips through no tube are spiky, so without the drive's squash a raspberry lands 6 dB under the section)
const raspberry = (o) => brass(Object.assign({ f: 95, breath: 0.9, lips: 0.8, bell: 0.08, tube: 0.08, sweep: -0.1, trem: [0.25, 17], flicker: [0.1, 23], vib: 0.04, vibRate: 7,
  drive: 0.4, atk: 0.02, hold: 0.3, dec: 0.25, sus: 0.5, rel: 0.12, dur: 0.68, cut: 4000, width: 0.3 }, o));
S["Fart"] = () => sound(raspberry({}),
  [[osc({ wave: 0, f: 100, noise: 1, color: 0.55, mode: 2, cut: 900, reso: 0.3, trem: [0.4, 19], atk: 0.02, hold: 0.22, dec: 0.25, sus: 0.3, rel: 0.12, dur: 0.68, width: 0.3 }), 0, 0.3]]);
ALTS["Fart"] = [TODAY("Fart"), () => raspberry({ f: 185, sweep: 0.06, vib: 0.12, vibRate: 9, trem: [0.3, 27], flicker: [0.12, 30], drive: 0.3, hold: 0.1, dec: 0.18, sus: 0.3, dur: 0.38, cut: 6000 })];
ALT_IDEA["Fart"] = [TODAY_IDEA, "a short squeaky one: higher, quicker, the cheeks fluttering faster"];

// BURP: a THROAT letting go: the creature engine at a human size, low, the voice rough and fluttering (vocal fry, the
// "rrr"), the mouth opening from shut to wide ("b-RAAWP"), the pitch lifting into it and sagging out.
S["Burp"] = () => creature({ f: 92, csize: 1.3, p0: 1, p1: -4, peak: 0.25, o0: 0.1, op: 1, o1: 0.3, v0: 0.25, v1: 0.85, nasal: 0.1, tension: 0.35, jitter: 0.45, shimmer: 0.5,
  rough: 0.75, breath: 0.15, flutter: 0.55, flutterRate: 32, drive: 0.45, atk: 0.015, dec: 0, sus: 1, rel: 0.08, dur: 0.55, width: 0.3 });
ALTS["Burp"] = [TODAY("Burp")];
ALT_IDEA["Burp"] = [TODAY_IDEA];

// SLIME SPLAT: a blob of slime hitting a wall: the wet thud (a dull impact with its noise), the splash spraying out
// (a short burst of the flow engine's waterfall, its band falling as it spreads), gloop bubbling and a last drip.
S["Slime Splat"] = () => sound(
  imp({ tone: 0.18, decay: 0.12, punch: 0.85, grit: 0.1, noise: 0.45, color: 0.4, boom: 0.25, boomFreq: 105, boomDrop: 0.4, boomDecay: 0.08, drive: 0.3, dec: 0.1, rel: 0.1, dur: 0.4, cut: 2500,
    width: 0.4, reverb: 0.12, size: 0.4, rtone: 0.45 }),
  [[flow({ type: 1, amount: 0.9, bsize: 3, babble: 0.6, body: 0.5, tone: 0.45, distance: 0, seed: 81, atk: 0.002, hold: 0.03, dec: 0.25, sus: 0, rel: 0.08, dur: 0.4, width: 0.7 }), 0, 0.7],
   [bub({ f: 260, rate: 25, rise: 0.6, spread: 0.7, decay: 0.35, drive: 0.15, atk: 0.01, hold: 0.05, dec: 0.2, sus: 0, rel: 0.08, dur: 0.35, cut: 3000, width: 0.6 }), 0.04, 0.5],
   [bub({ f: 520, rate: 1, rise: 0.8, spread: 0, decay: 0.4, atk: 0.001, sus: 1, rel: 0.08, dur: 0.25, width: 0.4 }), 0.45, 0.3]]);
ALTS["Slime Splat"] = [TODAY("Slime Splat")];
ALT_IDEA["Slime Splat"] = [TODAY_IDEA];

// BUBBLE BLORP (base kept: today's resonant sine "bloop" is the synth idiom): the alts are the bubble engine's.
ALTS["Bubble Blorp"] = [
  () => sound(bub({ f: 150, rate: 1, rise: 1, spread: 0, decay: 0.75, drive: 0.15, atk: 0.001, sus: 1, rel: 0.1, dur: 0.4, cut: 3000, reverb: 0.2, size: 0.45, width: 0.4 }),
    [[bub({ f: 270, rate: 1, rise: 1, spread: 0, decay: 0.7, atk: 0.001, sus: 1, rel: 0.1, dur: 0.38, cut: 4000, reverb: 0.2, size: 0.45, width: 0.4 }), 0.11, 0.8]]),
  () => formant({ f: 210, vowel: 0.85, fsize: 1.3, q: 0.75, breath: 0.1, sweep: 0.18, lfo: [3.5, 0.6], atk: 0.005, hold: 0.02, dec: 0.22, sus: 0, rel: 0.08, dur: 0.36, cut: 4000,
    reverb: 0.2, size: 0.45, width: 0.35 })];
ALT_IDEA["Bubble Blorp"] = ["the bubble engine: a big low bubble gulping up, a second rising out of it (\"bl-ORP\")",
  "a mouth blorp: a voiced \"oo-orp\" through the formant engine, rising"];

// MUD SQUELCH: a boot pulled out of deep mud: the mud's pockets sucking and bursting (the flow engine at its biggest
// bubbles, close, dark), the suction itself (a band of noise whistling DOWN as the seal stretches), and the boot
// coming free with a deep plop, mud dripping off it.
S["Mud Squelch"] = () => sound(
  flow({ type: 0, amount: 0.7, bsize: 4.5, babble: 1, body: 0.6, rise: 0.2, tone: 0.2, distance: 0, seed: 91, atk: 0.06, hold: 0.12, dec: 0.15, sus: 0, rel: 0.06, dur: 0.42, cut: 2500, width: 0.5 }),
  [[osc({ wave: 0, f: 300, noise: 1, color: 0.5, mode: 2, cut: 1000, reso: 0.72, fenv: -0.6, atk: 0.08, hold: 0.12, dec: 0.15, sus: 0, rel: 0.05, dur: 0.4, width: 0.4 }), 0, 0.55],
   [bub({ f: 170, rate: 1, rise: 0.9, spread: 0, decay: 0.55, drive: 0.15, atk: 0.001, sus: 1, rel: 0.1, dur: 0.3, cut: 2500, width: 0.4 }), 0.37, 0.8],
   [bub({ f: 620, rate: 8, rise: 0.6, spread: 0.6, decay: 0.3, atk: 0.01, sus: 1, rel: 0.08, dur: 0.3, cut: 6000, width: 0.6 }), 0.47, 0.25]]);

// BUBBLE POP (base kept: today's quick rising "pip" is the cartoon idiom): the alts are a soap bubble and a row of them.
ALTS["Bubble Pop"] = [
  () => sound(imp({ tone: 0.92, decay: 0.012, punch: 1, grit: 0.2, dec: 0.01, rel: 0.02, dur: 0.06, hp: 1500, width: 0.35, reverb: 0.1, size: 0.3 }),
    [[bub({ f: 1500, rate: 1, rise: 0.8, spread: 0, decay: 0.2, atk: 0.001, sus: 1, rel: 0.04, dur: 0.1, cut: 12000, width: 0.35 }), 0.003, 0.55],
     [part({ rate: 200, tone: 0.9, decay: 0.01, spread: 0.5, atk: 0.001, hold: 0.02, dec: 0.03, sus: 0, rel: 0.01, dur: 0.06, hp: 4000, width: 0.7 }), 0.002, 0.4]]),
  () => sound(bub({ f: 900, rate: 1, rise: 0.9, spread: 0, decay: 0.3, atk: 0.001, sus: 1, rel: 0.04, dur: 0.12, cut: 12000, width: 0.4, reverb: 0.1, size: 0.3 }),
    [[bub({ f: 1250, rate: 1, rise: 0.9, spread: 0, decay: 0.3, atk: 0.001, sus: 1, rel: 0.04, dur: 0.12, cut: 12000, width: 0.4 }), 0.085, 0.8],
     [bub({ f: 760, rate: 1, rise: 0.9, spread: 0, decay: 0.3, atk: 0.001, sus: 1, rel: 0.04, dur: 0.12, cut: 12000, width: 0.4 }), 0.15, 0.7]])];
ALT_IDEA["Bubble Pop"] = ["a soap bubble: a tiny bright click, a faint high pip and a spray too short to hear as one",
  "pop-pop-pop: three bubbles in a row, each its own pitch"];

// BOING SPRING (base kept: today's sine with a deep 16 Hz vibrato is the classic synth boing): the alt is a real
// doorstop spring, struck higher and shorter than Doorstop Spring, swaying hard ("boyoyoyoing").
ALTS["Boing Spring"] = [() => spring({ type: 1, f: 330, disp: 0.95, damp: 0.35, sway: 0.9, swayRate: 9, pluck: 0.7, seed: 17, dur: 0.85, drive: 0.5, reverb: 0.1, size: 0.35 })];
ALT_IDEA["Boing Spring"] = ["a real doorstop spring flicked: struck at 330 Hz, swaying hard at 9 Hz (\"boyoyoyoing\")"];

// SQUISH POP: squeezing something rubbery and wet until it pops: the squeeze is rubber stick-slip under rising
// pressure (a low squeaky squish) with a wet squelch under it, then the POP: a sharp burst and its resonant "pok".
S["Squish Pop"] = () => sound(
  fric({ body: 2, f: 380, tone: 0.5, grip: 0.75, rough: 0.35, lock: 0.8, speeds: [[0, 0.3], [0.08, 0.55], [0.14, 0.75]], presses: [[0, 0.3], [0.1, 0.6]], stop: 0.17, dur: 0.2, seed: 101,
    width: 0.35 }),
  [[flow({ type: 0, amount: 0.5, bsize: 2, babble: 0.95, body: 0.3, tone: 0.35, distance: 0, seed: 102, atk: 0.03, hold: 0.08, dec: 0.06, sus: 0, rel: 0.03, dur: 0.18, width: 0.5 }), 0, 0.5],
   [imp({ tone: 0.6, decay: 0.04, punch: 1, grit: 0.25, dec: 0.03, rel: 0.04, dur: 0.15, hp: 200, width: 0.35, reverb: 0.12, size: 0.4 }), 0.18, 0.8],
   [osc({ wave: 0, f: 420, sweep: 0.35, drive: 0.4, atk: 0.001, hold: 0.008, dec: 0.07, sus: 0, rel: 0.04, dur: 0.12, cut: 4000, reso: 0.4, width: 0.3, reverb: 0.12, size: 0.4 }), 0.18, 0.8]]);
ALTS["Squish Pop"] = [TODAY("Squish Pop")];
ALT_IDEA["Squish Pop"] = [TODAY_IDEA];

// RUBBER STRETCH: a rubber band pulled out slowly: rubber stick-slip whose speed and pressure rise as it stretches,
// separate creaks running together into a squeal, and as the tension rises the band's own note rises with it (the
// friction engine's body modes are fixed, so the climb is three stretches of the band, each tighter and higher: 430,
// 590, 800 Hz, each faster and gripping harder).
S["Rubber Stretch"] = () => sound(
  fric({ body: 2, f: 430, tone: 0.65, grip: 0.8, rough: 0.5, lock: 0.7, speeds: [[0, 0.15], [0.15, 0.35], [0.3, 0.55]], presses: [[0, 0.35], [0.3, 0.5]], stop: 0.42, dur: 0.46, seed: 111,
    drive: 0.3, width: 0.35, reverb: 0.1, size: 0.35 }),
  [[fric({ body: 2, f: 590, tone: 0.75, grip: 0.82, rough: 0.35, lock: 0.8, speeds: [[0, 0.5], [0.12, 0.75]], presses: [[0, 0.5]], stop: 0.25, dur: 0.29, seed: 112, drive: 0.3, width: 0.35 }), 0.32, 0.9],
   [fric({ body: 2, f: 800, tone: 0.85, grip: 0.85, rough: 0.2, lock: 0.9, speeds: [[0, 0.75], [0.08, 1]], presses: [[0, 0.6]], stop: 0.2, dur: 0.24, seed: 113, drive: 0.3, width: 0.35 }), 0.52, 0.9]]);
ALTS["Rubber Stretch"] = [TODAY("Rubber Stretch")];
ALT_IDEA["Rubber Stretch"] = [TODAY_IDEA];

// POP CORK: a cork shot from a bottle: the sharp burst of escaping pressure, the bottle neck's resonance (a short,
// rising "pok": the air column ringing as it empties), the champagne fizzing after it, and the cork landing twice.
S["Pop Cork"] = () => sound(
  osc({ wave: 0, f: 470, sweep: 0.3, noise: 0.12, color: 0.3, drive: 0.4, atk: 0.001, hold: 0.008, dec: 0.09, sus: 0, rel: 0.05, dur: 0.18, cut: 5000, reso: 0.3, width: 0.3, reverb: 0.15, size: 0.45 }),
  [[imp({ tone: 0.75, decay: 0.025, punch: 1, grit: 0.3, noise: 0.3, color: 0.2, dec: 0.02, rel: 0.03, dur: 0.15, hp: 300, width: 0.4 }), 0, 0.5],
   [part({ rate: 200, tone: 0.85, decay: 0.02, spread: 0.5, atk: 0.03, hold: 0.04, dec: 0.45, sus: 0, rel: 0.08, dur: 0.6, hp: 3000, width: 0.7 }), 0.03, 0.3],
   [modal({ f: 1400, parts: 5, inharm: 0.35, ring: 0.05, bright: 0.5, dec: 0.02, rel: 0.03, repeat: 2, rate: 7, dur: 0.25, cut: 8000, width: 0.4 }), 0.55, 0.3]]);
ALTS["Pop Cork"] = [TODAY("Pop Cork")];
ALT_IDEA["Pop Cork"] = ["today's: a finger-in-the-cheek \"pop\" (a rising sine), the cartoon version"];

// ============================================================================================================
// THE FAMILY: 16 names BRED at random in 2026-07 as an ADJECTIVE x a NOUN (13 a sine with a sweep, three-decimal values;
// today's closest pair in the whole section is two of them). The name is the design: two tables, composed.
const FAMILY = ["Squishy Plop", "Goofy Plop", "Silly Blorp", "Goofy Splat", "Zany Squish", "Silly Wobble", "Zany Wobble", "Bouncy Pop", "Squishy Boing", "Zany Splat",
  "Loony Wobble", "Slippery Sproing", "Wobbly Plop", "Bouncy Sproing", "Silly Boing", "Loony Squeak"];

// NOUN: the OBJECT and the engine that makes it. build(c) returns { core(o): layer 1's patch (o: the adjective's
// changes, merged last), layers: the noun's own extra layers [patch, delay, gain], hit: when the event lands, end: when
// it is over }. c.f multiplies every pitch, c.t every time.
const NOUN = {
  // a thing dropped into liquid: ONE big bubble ringing up (Minnaert; the bubble engine) and the drop's wet tick
  Plop: { lvl: -1, build: (c) => ({ hit: 0, end: 0.3 * c.t,
    core: (o) => bub(Object.assign({ f: 330 * c.f, rate: 1, rise: 1, spread: 0, decay: 0.55, atk: 0.001, sus: 1, rel: 0.08, dur: r2(0.32 * c.t), cut: 6000, width: 0.4 }, o)),
    layers: [[imp({ tone: 0.55, decay: 0.02, punch: 0.7, grit: 0.1, noise: 0.4, color: 0.3, dec: 0.015, rel: 0.02, dur: 0.06, hp: 300, width: 0.4 }), 0, 0.3]] }) },
  // a big gloopy bubble surfacing: a low gulp ("bl") and a bigger one rising out of it ("ORP")
  Blorp: { lvl: 0, build: (c) => ({ hit: 0.1 * c.t, end: 0.45 * c.t,
    core: (o) => bub(Object.assign({ f: 150 * c.f, rate: 1, rise: 1, spread: 0, decay: 0.75, drive: 0.15, atk: 0.001, sus: 1, rel: 0.1, dur: r2(0.4 * c.t), cut: 3000, width: 0.4 }, o)),
    layers: [[bub({ f: 270 * c.f, rate: 1, rise: 1, spread: 0, decay: 0.7, atk: 0.001, sus: 1, rel: 0.1, dur: r2(0.38 * c.t), cut: 4000, width: 0.4 }), 0.1 * c.t, 0.85]] }) },
  // a wet blob hitting a surface: the dull wet thud (impact + noise) and its spray (the flow engine's burst)
  Splat: { lvl: 1, build: (c) => ({ hit: 0, end: 0.35 * c.t,
    core: (o) => imp(Object.assign({ tone: 0.18, decay: 0.12 * c.t, punch: 0.85, grit: 0.1, noise: 0.45, color: 0.4, boom: 0.25, boomFreq: 105 * Math.sqrt(c.f), boomDrop: 0.4, boomDecay: 0.08, drive: 0.3,
      dec: 0.1 * c.t, rel: 0.1, dur: r2(0.4 * c.t), cut: 2500, width: 0.4 }, o)),
    layers: [[flow({ type: 1, amount: 0.9, bsize: 3 / c.f, babble: 0.6, body: 0.5, tone: cl(0.45 * Math.sqrt(c.f), 0.1, 0.9), distance: 0, seed: 7, atk: 0.002, hold: 0.03 * c.t,
      dec: 0.25 * c.t, sus: 0, rel: 0.08, dur: r2(0.4 * c.t), width: 0.7 }), 0, 0.7]] }) },
  // squeezing something soft and wet: the wet pockets squelching (flow) and the rubbery squeak of the squeeze
  Squish: { lvl: 0, build: (c) => ({ hit: 0.12 * c.t, end: 0.35 * c.t,
    core: (o) => flow(Object.assign({ type: 0, amount: 0.6, bsize: 2.5 / c.f, babble: 0.95, body: 0.4, tone: 0.35, distance: 0, seed: 9, atk: 0.06 * c.t, hold: 0.08 * c.t, dec: 0.18 * c.t,
      sus: 0, rel: 0.05, dur: r2(0.36 * c.t), width: 0.5 }, o)),
    layers: [[fric({ body: 2, f: 300 * c.f, tone: 0.5, grip: 0.75, rough: 0.35, lock: 0.8, speeds: [[0, 0.35], [0.1 * c.t, 0.6]], presses: [[0, 0.4], [0.1 * c.t, 0.65]], stop: 0.24 * c.t,
      dur: r2(0.27 * c.t), seed: 10, width: 0.35 }), 0.02 * c.t, 0.55]] }) },
  // a jelly slapped and left wobbling: the soft slap, then a voiced "wow-wow-wow" (the formant engine's vowel moving
  // at the wobble rate, the pitch and the level wobbling with it) dying away
  Wobble: { lvl: 0, build: (c) => ({ hit: 0, end: 0.8 * c.t,
    core: (o) => formant(Object.assign({ f: 165 * c.f, vowel: 0.25, fsize: 1.2, q: 0.6, breath: 0.05, lfo: [r2(7 / c.t), 0.9], vib: 0.06, vibRate: r2(7 / c.t), trem: [0.5, r2(7 / c.t)],
      atk: 0.01, hold: 0.05 * c.t, dec: 0.6 * c.t, sus: 0.2, rel: 0.2 * c.t, dur: r2(Math.min(2, 0.85 * c.t)), cut: 5000, width: 0.4 }, o)),
    layers: [[imp({ tone: 0.15, decay: 0.08, punch: 0.6, grit: 0.05, noise: 0.3, color: 0.5, boom: 0.3, boomFreq: 110, boomDecay: 0.06, dec: 0.06, rel: 0.06, dur: 0.25, cut: 1800, width: 0.35 }), 0, 0.5]] }) },
  // a cheek / cork pop: a sharp click and a resonant "pok" rising
  Pop: { lvl: -1, build: (c) => ({ hit: 0, end: 0.12 * c.t,
    core: (o) => osc(Object.assign({ wave: 0, f: 380 * c.f, sweep: 0.35, drive: 0.4, atk: 0.001, hold: 0.005, dec: 0.07 * c.t, sus: 0, rel: 0.04, dur: r2(0.15 * c.t), cut: 5000, reso: 0.4, width: 0.3 }, o)),
    layers: [[imp({ tone: 0.65, decay: 0.03, punch: 1, grit: 0.2, dec: 0.02, rel: 0.03, dur: 0.1, hp: 250, width: 0.35 }), 0, 0.6]] }) },
  // a doorstop spring flicked: "doinng", swaying
  Boing: { lvl: 0, build: (c) => ({ hit: 0, end: 0.7 * c.t,
    core: (o) => spring(Object.assign({ type: 1, f: 200 * c.f, disp: 0.95, damp: 0.3, sway: 0.75, swayRate: r2(7 / c.t), pluck: 0.6, seed: 21, dur: r2(Math.min(2, 0.9 * c.t)) }, o)),
    layers: [] }) },
  // a coil spring let go: the coil's dispersive "spr" (a short coil's pew) and a jaw-harp twang rising out of it
  // as the mouth opens, a full octave and a half, and swaying ("-OIIING"): the rise is what the kept twangs lack
  Sproing: { lvl: 0, build: (c) => ({ hit: 0.03, end: 0.6 * c.t,
    core: (o) => spring(Object.assign({ type: 2, f: 150 * c.f, mouth: 0.9, vowel: 0.1, damp: 0.4, pluck: 0.8, sweep: 0.38, sway: 0.5, swayRate: 8, seed: 23, dur: r2(Math.min(2, 0.7 * c.t)) }, o)),
    layers: [[spring({ type: 0, f: 1100 * c.f, len: 22, disp: 1, damp: 0.4, pluck: 0.8, seed: 24, dur: 0.4 }), 0, 0.5]] }) },
  // rubber squeaked hard and fast: two quick squeaks (the friction engine's rubber cavity, locked)
  Squeak: { lvl: -1, build: (c) => ({ hit: 0, end: 0.3 * c.t,
    // friction reads no vibrato, so an adjective's warble (o.vib) becomes the squeak's SPEED stuttering at its rate
    core: (o) => fric(Object.assign({ body: 2, f: 1300 * c.f, tone: 0.85, grip: 0.85, rough: 0.15, lock: 0.9, speeds: [[0, 0.6], [0.05 * c.t, 1]], presses: [[0, 0.3]], stop: 0.14 * c.t,
      dur: r2(0.17 * c.t), seed: 31, width: 0.3 }, o, o.vib ? { speeds: [0, 1, 2, 3].map((k) => [r3(k / (2 * o.vibRate)), k % 2 ? 0.55 : 1]), stop: r3(2.2 / o.vibRate),
      dur: r2(2.2 / o.vibRate + 0.04) } : {})),
    layers: [[fric({ body: 2, f: 1550 * c.f, tone: 0.85, grip: 0.85, rough: 0.15, lock: 0.9, speeds: [[0, 0.7], [0.04 * c.t, 1]], presses: [[0, 0.35]], stop: 0.1 * c.t,
      dur: r2(0.13 * c.t), seed: 32, width: 0.3 }), 0.17 * c.t, 0.8]] }) },
};

// ADJ: the PERFORMANCE, the same rule on every noun. f / t: pitch and time multipliers; core: what changes on layer 1;
// extra(n, c): the one layer it adds (or, for Bouncy / Zany, copies of the core); lvl dB.
//   Squishy  wetter and softer: lower, slower, darker, the wet pockets squelching through the whole event
//   Goofy    dopey: low and lumbering, a slow wobble in the pitch, and a tuba's "bwomp" falling after the hit
//   Silly    high and quick, then a slide-whistle "whee!" flicking up after it
//   Zany     frantic: a slide-whistle ZIP up as the anticipation, the event, and a double take a fourth higher
//   Bouncy   the event BOUNCES: twice more, each gap shorter (x0.62), each smaller and a little higher
//   Loony    a wild warble (deep, fast vibrato) and a cuckoo clock's "cu-ckoo" after it
//   Slippery a rubber skid squealing down first (the slip), the event landing late and sliding down in pitch
//   Wobbly   the tail wobbles: a slow tremolo and vibrato through it, longer, and a jelly "wow-wow" after
const flick = (f0, sweep, dur, o) => flute(Object.assign({ f: f0, sweep, breath: 1, jet: 0.5, aim: 0.42, fnoise: 0.2, tone: 0.32, fvib: 0.1, atk: 0.015, dec: 0, sus: 1, rel: 0.05,
  dur, width: 0.35 }, o));
const ADJ = {
  Squishy: { f: 0.75, t: 1.2, lvl: 0, core: { cut: 2200 },
    extra: (n, c) => [[flow({ type: 0, amount: 0.6, bsize: 3.2, babble: 0.95, body: 0.5, tone: 0.25, distance: 0, seed: 41, atk: 0.02, hold: n.end * 0.6, dec: n.end * 0.6, sus: 0, rel: 0.06,
      dur: r2(n.end * 1.25 + 0.12), width: 0.55 }), 0, 0.7]] },
  Goofy: { f: 0.62, t: 1.3, lvl: 0.5, core: { vib: 0.04, vibRate: 4 },
    extra: (n, c) => [[brass({ f: 73, breath: 0.6, lips: 0.5, bell: 0.35, tube: 0.5, sweep: -0.12, atk: 0.02, hold: 0.06, dec: 0.18, sus: 0, rel: 0.08, dur: 0.34, width: 0.3 }), n.hit + 0.06, 0.6]] },
  Silly: { f: 1.45, t: 0.8, lvl: -0.5, core: {},
    extra: (n, c) => [[flick(780, 0.38, 0.24, { rel: 0.06 }), n.end * 0.85, 0.55]] },
  Zany: { f: 1.15, t: 0.7, lvl: 0, core: {}, lead: 0.15, double: { at: 0.19, f: semis(5), g: 0.8 },
    extra: (n, c) => [[flick(620, 0.7, 0.16, { atk: 0.01, rel: 0.03 }), 0, 0.6]] },
  Bouncy: { f: 1, t: 0.9, lvl: 0, core: {}, bounce: [[0.26, 0.6, semis(1)], [0.42, 0.35, semis(2)]] },
  Loony: { f: 1.1, t: 1, lvl: 0, core: { vib: 0.22, vibRate: 11 },
    extra: (n, c) => [[flute({ f: 880, breath: 1, jet: 0.5, aim: 0.4, fnoise: 0.08, tone: 0.2, atk: 0.02, hold: 0, dec: 0.12, sus: 0.6, rel: 0.06, repeat: 2, rate: 4, arp: -4, dur: 0.5,
      width: 0.35, reverb: 0.12, size: 0.35 }), n.end + 0.05, 0.6]] },
  Slippery: { f: 1, t: 1, lvl: 0, core: { sweepAdd: -0.5 }, lead: 0.2,
    extra: (n, c) => [[fric({ body: 2, f: 1700, tone: 0.9, grip: 0.8, rough: 0.2, lock: 0.85, speeds: [[0, 1], [0.12, 0.6]], presses: [[0, 0.4]], stop: 0.18, dur: 0.21, seed: 51,
      width: 0.35 }), 0, 0.6]] },
  Wobbly: { f: 0.95, t: 1.25, lvl: 0, core: { trem: [0.55, 6], vib: 0.05, vibRate: 6 },
    extra: (n, c) => [[formant({ f: 190, vowel: 0.25, fsize: 1.2, q: 0.6, lfo: [6, 0.9], vib: 0.05, vibRate: 6, trem: [0.5, 6], atk: 0.02, hold: 0.05, dec: 0.45, sus: 0.15, rel: 0.15, dur: 0.6,
      cut: 5000, width: 0.4 }), n.end * 0.7, 0.5]] },
};
// Per-name overrides: only where composition genuinely fails, each with its reason.
const OVERRIDES = {};

// THE COMPOSER. The rules, all of them:
//   c         { f: adj.f, t: adj.t }: the noun is built at the adjective's register and pace
//   core      the noun's layer 1 with the adjective's core changes merged (sweepAdd adds to the noun's own sweep)
//   lead      an adjective that comes FIRST (Zany's zip, Slippery's skid) delays the noun by `lead` s
//   double    Zany: the core again at `at` (x t), pitched up, at gain g
//   bounce    Bouncy: the core again at each [at x t, gain, pitch]
//   extra     the adjective's one layer, placed against the noun's hit / end
//   level     gain on layer 1: the trim to the section median + adj.lvl + noun.lvl
function compose(name) {
  const [an, nn] = name.split(" ");
  const A = ADJ[an], N = NOUN[nn];
  if (!A || !N) throw new Error("no table entry for " + name);
  const c = { f: A.f, t: A.t };
  const n = N.build(c);
  const lead = A.lead || 0;
  const mods = Object.assign({}, A.core);
  const coreWith = (extraMods) => {
    const m = Object.assign({}, mods, extraMods || {});
    const probe = n.core({});
    if (m.sweepAdd != null) { m.sweep = r2((probe.sweep || 0) + m.sweepAdd); delete m.sweepAdd; }
    if (m.cut && probe.cutoff && probe.cutoff < m.cut) delete m.cut;   // darker only, never brighter
    if (m.fMul) { if (probe.freq) m.f = probe.freq * m.fMul; else if (probe.wave === 19) m.tone = r2(Math.min(1, probe.impactTone + 0.15)); delete m.fMul; }
    return n.core(m);
  };
  const layers = [[coreWith(), lead, 1]];
  for (const [p, d, g] of n.layers) layers.push([p, d + lead, g]);
  const nn2 = { hit: n.hit + lead, end: n.end + lead };
  if (A.double) layers.push([coreWith({ fMul: A.double.f }), lead + A.double.at * c.t, A.double.g]);
  if (A.bounce) for (const [at, g, fm] of A.bounce) layers.push([coreWith({ fMul: fm }), lead + at * c.t, g]);
  if (A.extra) for (const x of A.extra(nn2, c)) layers.push(x);
  if (layers.length > 4) throw new Error(name + ": " + layers.length + " layers");
  // a layer delayed by `lead` is the noun; layer 1 must start at 0, so when the adjective leads, its own layer goes
  // first and the noun's core moves to layer 2
  let order = layers;
  if (lead > 0) { const ix = layers.findIndex((l) => l[1] === 0); order = [layers[ix]].concat(layers.filter((_, i) => i !== ix)); order[0] = [order[0][0], 0, 1]; }
  const p = sound(order[0][0], order.slice(1).map(([s, d, g]) => [s, d, g * (lead > 0 ? 1 / layers.find((l) => l[1] === 0)[2] : 1)]));
  Object.assign(p, OVERRIDES[name] || {});
  return p;
}
for (const n of FAMILY) S[n] = () => compose(n);

// _vary: the PRESET BUTTON jitters layer 1 only; a pitch is varied lightly where another layer is tied to it
function varyFor(p) {
  const w = Math.round(p.wave), v = {};
  if (w === 20) return { whooshTone: 0.1, whooshSweep: 0.15, whooshPeak: 0.1 };
  if (w === 35) return { flowSeed: 1, flowSize: 0.1 };
  if (w === 34) return { fricSeed: 1, freq: 0.06 };
  if (w === 32) return { springSeed: 1, freq: 0.06 };
  if (w === 19) return { impactTone: 0.12, impactDecay: 0.15 };
  if (w === 15) return { particleRate: 0.15, particleTone: 0.06 };
  v.freq = 0.08;
  if (w === 14) { v.bubbleRise = 0.15; v.bubbleDecay = 0.15; }
  if (w === 13) v.formantVowel = 0.15;
  if (p.sweep) v.sweep = 0.12;
  if (p.vibDepth) v.vibRate = 0.15;
  return v;
}

// ============================================================================================================
const ADJ_IDEA = {
  Squishy: "wetter and softer: lower, slower, darker, wet pockets squelching all through it",
  Goofy: "dopey: low and lumbering, a slow wobble in the pitch, a tuba's \"bwomp\" falling after the hit",
  Silly: "high and quick, then a slide-whistle \"whee!\" flicking up after it",
  Zany: "frantic: a slide-whistle ZIP up first (the anticipation), the event, and a double take a fourth higher",
  Bouncy: "it BOUNCES: twice more, each gap shorter, each smaller and a little higher",
  Loony: "a wild warble (deep, fast vibrato) and a cuckoo clock's \"cu-ckoo\" after it",
  Slippery: "a rubber skid squeal first (the slip), then the event landing late and sliding DOWN in pitch",
  Wobbly: "the tail wobbles (slow tremolo and vibrato), longer, a jelly \"wow-wow\" after it",
};
const NOUN_IDEA = {
  Plop: "one big bubble ringing up as a drop goes in (the bubble engine), the drop's wet tick",
  Blorp: "a big gloopy bubble surfacing: a low gulp (\"bl\") and a bigger one rising out of it (\"ORP\")",
  Splat: "a wet blob hitting: a dull wet thud and its spray (the flow engine's burst)",
  Squish: "squeezing something soft and wet: wet pockets squelching and the rubbery squeak of the squeeze",
  Wobble: "a jelly slapped and left wobbling: a soft slap, then a voiced \"wow-wow-wow\" dying away",
  Pop: "a cheek pop: a sharp click and a short resonant \"pok\" rising",
  Boing: "a doorstop spring flicked: \"doinng\", swaying",
  Sproing: "a coil spring let go: the coil's short \"spr\" and a jaw-harp twang rising out of it (\"-OING\")",
  Squeak: "rubber squeaked hard: two quick squeaks, the second higher",
};
const IDEA = {
  "Gold Bar Clunk": "a heavy bar of soft metal set down on a wooden table: a short low ring, the table's thump, the bar rocking once onto its other edge",
  "Palette Scrape": "a steel palette knife dragged through paint on a palette (blade stick-slip, greased and lumpy), the paint's tack, a last short flick",
  "Brush Tap": "a wet brush tapped twice on a glass jar's rim (tap-tap, the jar ringing) and the drops shaken off into the water",
  "Brush Clatter": "brushes dropped into a jar: wooden handles rattling at two rates, the jar ringing under them, a last settle",
  "Knuckle Crack": "knuckles cracked one by one: sharp cavitation pops with a low knock, irregular, ending in a gristly run",
  "Wax Seal": "a seal pressed into hot wax: the wax squishing, the press's dull thud, a breath of hiss, the seal pulled off with a sticky tick",
  "Shears Snip": "two cuts: each the blades SLIDING (a short metal shear) and CLOSING (a crisp bright click)",
  "Paint Stroke": "a loaded brush across canvas: the bristles' soft scratch swelling and fading, the canvas tooth catching, a soft swish",
  "Slide Whistle Up": "a real slide whistle (the flute engine, its pipe moving): breathy, a chiff as it speaks, gliding up two octaves",
  "Slide Whistle Down": "the same slide whistle gliding down two octaves",
  "Fart": "a raspberry is LIPS buzzing: the brass engine with no tube to speak of, low, cheeks fluttering it, sagging, air under it",
  "Burp": "a throat letting go (the creature engine): rough, fluttering vocal fry, the mouth opening \"b-RAAWP\", lifting and sagging",
  "Slime Splat": "slime hitting a wall: a wet thud, the splash spraying out (a falling burst), gloop bubbling, one last drip",
  "Mud Squelch": "a boot pulled out of deep mud: the pockets sucking (big dark flow bubbles), the suction whistling down, a deep plop as it comes free, drips",
  "Squish Pop": "squeezing something rubbery and wet until it pops: a low squeaky squish rising, a wet squelch, then a sharp pop and its \"pok\"",
  "Rubber Stretch": "a rubber band pulled out slowly: rubber stick-slip speeding up as it stretches, creaks running together into a climbing squeal",
  "Pop Cork": "a cork shot from a bottle: the burst, the neck's short rising \"pok\", the fizz after it, the cork landing twice",
};
for (const n of FAMILY) { const [a, b] = n.split(" "); IDEA[n] = "[" + a + "] " + ADJ_IDEA[a] + "  x  [" + b + "] " + NOUN_IDEA[b]; }
// KEPT AS IS (no file: today's sound stays, no alts added)
const KEPT = {
  "Glass Clink": "finished today (glass engine alts); not touched, as asked",
  "Springy Boing": "the spring round's pick (\"twang-up\", the spring engine's jaw-harp twang); exactly what a springy boing is",
  "Cartoon Boing": "the spring round's pick (the jaw-harp twang, \"bwoing\"); the cartoon boing",
  "Doorstop Spring": "the spring round's pick (a big floor spring: \"doinng\", swaying); a real doorstop on the engine that models one",
  "Spring Tank Crash": "a spring reverb tank kicked: the coil engine's dispersive crash is what a spring tank is; nothing to add",
  "Squeaky Toy": "the friction round's pick (\"squeeze\": rubber stick-slip in a squeeze toy's cavity); AJ chose it over the control",
  "Robot Chuckle": "a crushed, ring-modded formant \"ha-ha-ha-ha\": a robot laughing IS a formant voice through a crusher (the robot round kept the same idiom); it is already the only laugh in the section",
  "Fart 2": "the formant fart (a voice-like \"pfrrr\" with a moving vowel) is a different archetype from Fart's new lips, so the pair now separates instead of doubling",
};
// KEPT AS BASE, NEW ALTS (today's stays the base; the alts are added to `_alts`)
const KEPT_ALTS = {
  "Bubble Blorp": "today's resonant rising sine is the synth \"bloop\" idiom and holds up; two alts make it a real bubble and a mouth",
  "Bubble Pop": "today's quick rising \"pip\" is the cartoon bubble pop and holds up; alts: a real soap bubble, and pop-pop-pop",
  "Boing Spring": "today's sine with a deep 16 Hz vibrato is THE synth boing (and the spring presets already cover the physical ones); alt: a doorstop flicked high and short",
};
// Per-sound level offset from the section median, by design (dB). Family offsets come from the tables (adj.lvl + noun.lvl).
const LEVEL_OFFSET = { "Gold Bar Clunk": 1, "Palette Scrape": -2, "Brush Tap": -3, "Brush Clatter": -2, "Knuckle Crack": -2, "Wax Seal": -2, "Shears Snip": -2, "Paint Stroke": -3,
  "Slide Whistle Up": 0, "Slide Whistle Down": 0, "Fart": 0, "Burp": 0, "Slime Splat": 0, "Mud Squelch": -1, "Squish Pop": -1, "Rubber Stretch": -1, "Pop Cork": -1 };
// _vary: layer 1 only (the preset button's roll)
const VARY = {
  "Gold Bar Clunk": { freq: 0.08, modalDecay: 0.15 },
  "Palette Scrape": { fricSeed: 1, freq: 0.08, fricRough: 0.1 },
  "Brush Tap": { glSeed: 1, freq: 0.06 },
  "Brush Clatter": { freq: 0.08, rate: 0.15 },
  "Knuckle Crack": { impactTone: 0.1, impactDecay: 0.15 },
  "Wax Seal": { impactTone: 0.12, boomFreq: 0.12 },
  "Shears Snip": { fricSeed: 1, freq: 0.06 },
  "Paint Stroke": { particleRate: 0.15, particleTone: 0.06, decay: 0.15 },
  "Slide Whistle Up": { freq: 0.1, sweep: 0.1 },
  "Slide Whistle Down": { freq: 0.1, sweep: 0.1 },
  "Fart": { freq: 0.15, tremRate: 0.2, decay: 0.25 },
  "Burp": { freq: 0.12, crSize: 0.08, crOpenPeak: 0.1 },
  "Slime Splat": { impactTone: 0.12, boomFreq: 0.12 },
  "Mud Squelch": { flowSeed: 1, flowSize: 0.12 },
  "Squish Pop": { fricSeed: 1, freq: 0.1 },
  "Rubber Stretch": { fricSeed: 1, freq: 0.1, sweep: 0.15 },
  "Pop Cork": { impactTone: 0.1 },
};

if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e), r = render(p); console.log(fmt(measure(r)) + "\n      " + curve(r)); } process.exit(0); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "cartoon-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in steps
// of 0.05 (the smallest that reaches the target), capped at LIMIT_MAX: past that a transient is being squashed to buy
// loudness it does not have, so a sound that cannot get there lands short and the report says by how much.
const LIMIT_MAX = 0.4;
// ONE-SHOTS WITH A TAIL are levelled on their loudest 400 ms (m.mmax), everything else on integrated loudness (m.lufs):
// integrated loudness averages a ring-out in, so a cork's pop followed by fizz would be pushed into the Limiter to buy
// back loudness its tail cost it. For a sound under 0.4 s the two are the same number.
let LVM = false;
const LV_OF = (m) => LVM ? m.mmax : m.lufs;
function level(p, target, byMax) {
  LVM = !!byMax;
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - LV_OF(m)) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  let lo = 0, hi = Math.round(LIMIT_MAX / 0.05);
  p.limiter = LIMIT_MAX; m = measure(render(p));
  if (LV_OF(m) < target - 0.4) return dcGuard(p);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); const mm = measure(render(p)); if (LV_OF(mm) >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  for (let k = 0; k < 2; k++) { m = measure(render(p)); if (LV_OF(m) > target + 0.3) p.gain = r2(p.gain * Math.pow(10, (target - LV_OF(m)) / 20)); }
  return dcGuard(p);
}
// The Limiter puts DC into low asymmetric pulses (a boom, a rumble): step it down until |DC| is within 2e-4, so a
// level trim never buys loudness with an offset
const DC_MAX = 2e-4;
function dcGuard(p) {
  let m = measure(render(p));
  while (p.limiter && Math.max(Math.abs(m.dcL), Math.abs(m.dcR)) > DC_MAX) { p.limiter = r2(p.limiter - 0.05); if (p.limiter <= 0) delete p.limiter; m = measure(render(p)); }
  return m;
}
// key order as the app writes a preset: the patch, then _vary, then _alts, then layers last
function asPreset(p, vary, alts) {
  const o = {}; for (const [k, v] of Object.entries(p)) if (k !== "layers" && k !== "_vary" && k !== "_alts") o[k] = v;
  if (vary) o._vary = vary; if (alts && alts.length) o._alts = alts; if (p.layers) o.layers = p.layers;
  return o;
}
const TARGET = median(SECTION.map((n) => refRow(n).m.lufs));
// lv '<js>' ...: level each patch to the section median (LV=<dB offset>) and measure it, nothing written
if (arg === "lv") { for (const e of process.argv.slice(3)) { const p = eval(e), m = level(p, TARGET + +(process.env.LV || 0), !!process.env.LVM); console.log(fmt(m) + "\n      gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") + "\n      " + curve(render(p))); } process.exit(0); }
const REDO = SECTION.filter((n) => S[n]);
const ALT_ONLY = SECTION.filter((n) => !S[n] && ALTS[n]);
const lvlOf = (name) => FAMILY.includes(name) ? (ADJ[name.split(" ")[0]].lvl || 0) + (NOUN[name.split(" ")[1]].lvl || 0) : (LEVEL_OFFSET[name] || 0);
const varyOf = (name, p) => VARY[name] || varyFor(p);
// levelled on the loudest 400 ms (see level()): the one-shots with a ring or a tail, and the whole family (each an event)
const ONESHOT = new Set(["Gold Bar Clunk", "Brush Tap", "Brush Clatter", "Knuckle Crack", "Wax Seal", "Shears Snip", "Slime Splat", "Mud Squelch", "Squish Pop", "Pop Cork"]);
const byMax = (name) => ONESHOT.has(name) || FAMILY.includes(name);
const only = arg && arg !== "sep" && arg !== "gag" ? arg : null;
const ALL = REDO.concat(ALT_ONLY);
if (only && !ALL.some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + ALL.map(slug).join(", ")); process.exit(1); }
if (only || !arg || arg === "gag") mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {}, altRows = [];
console.log("Cartoon / Misc median " + TARGET.toFixed(1) + " LUFS (the level target)");
const fmtLv = (p, m, tgt, bm) => { const v = bm ? m.mmax : m.lufs; return (p.layers ? JSON.parse(p.layers).length + 1 : 1) + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
  ", vs target " + (v - tgt >= 0 ? "+" : "") + (v - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + (bm ? ", on the loudest 400 ms" : "") + ")"; };
const mkAlts = (name, tgt, byMax) => (ALTS[name] || []).map((fn, i) => {
  const a = fn(); delete a._vary; delete a._alts; durCheck(name + " alt " + (i + 1), a);
  const am = level(a, tgt, byMax), ar = render(a);
  altRows.push({ name, i, p: a, r: ar, m: am, f: features(am) });
  return a;
});
if (arg !== "gag") for (const name of ALL) {
  const s = slug(name);
  if (only && only !== s) continue;
  const now = refRow(name);
  if (!S[name]) {   // KEPT AS BASE: today's preset stays; its new alts are levelled to today's loudness, so a click does not jump
    const alts = mkAlts(name, now.m.mmax, true);
    if (arg !== "sep") { wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now, kept)"); alts.forEach((a, i) => wav(s + "-alt" + (i + 1) + ".wav", render(a), name + " (alt " + (i + 1) + ")")); }
    const base = Object.assign({}, PRESETS[name]);
    json[name] = asPreset(base, base._vary, alts);
    rows.push({ name, slug: s, p: base, r: render(PRESETS[name]), m: now.m, f: now.f, now, keptBase: true });
    console.log(name.padEnd(18) + "KEPT base, " + alts.length + " new alt(s)" + altRows.filter((x) => x.name === name).map((x) => "\n  " + "".padEnd(12) + "ALT" + (x.i + 1) + " " + fmt(x.m).replace(/\n/g, "\n    ") + "\n      " + fmtLv(x.p, x.m, now.m.mmax, true)).join("") +
      "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
    continue;
  }
  const p = S[name](), tgt = TARGET + lvlOf(name);
  durCheck(name, p);
  const m = level(p, tgt, byMax(name)), r = render(p);
  const alts = mkAlts(name, tgt, byMax(name));
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    wav(s + "-2-new.wav", r, name);
    alts.forEach((a, i) => wav(s + "-alt" + (i + 1) + ".wav", render(a), name + " (alt " + (i + 1) + ")"));
  }
  json[name] = asPreset(p, varyOf(name, p), alts);
  for (const k of Object.keys(json[name]._vary)) if (!PRANGE[k]) console.log("  !! " + name + " _vary: " + k + " is not a PARAMS row");
  rows.push({ name, slug: s, p, r, m, f: features(m), now });
  console.log(name.padEnd(18) + "NEW " + fmt(m) + "\n      " + fmtLv(p, m, tgt, byMax(name)) +
    altRows.filter((x) => x.name === name).map((x) => "\n  " + "".padEnd(12) + "ALT" + (x.i + 1) + " " + fmt(x.m).replace(/\n/g, "\n    ") + "\n      " + fmtLv(x.p, x.m, tgt, byMax(name))).join("") +
    "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
  if (only) console.log("      " + curve(r));
}
if (only) process.exit(0);

// ============================================================================================================
// THE GAG (a NEW preset, appended to the section; replace-presets.mjs cannot place it, so it is written to
// cartoon-new.json). The crowd round's tavern-chatter take A (soundtests/proto-crowd/tavern-chatter/KEY.md) is the
// file AJ heard as "a flock of gulls all yelling the same syllable — MINE MINE MINE … might be the funniest thing I've
// ever heard". That take was the round's CONTROL, not a crowd-engine take: four creature-engine (wave 28) talkers at
// human size, each a burst of 7-10 identical calls ("a rise and a fall", ~5 a second), entering one after another. The
// exported engine renders it SAMPLE-IDENTICAL to the WAV AJ heard (correlation 1.0000 at lag 0), so the base is that
// patch verbatim with only its gain set; the alt is the same squabble sized as actual gulls (small throats, high,
// a sharper rise and fall per call).
const GAG = "Seagull Squabble";
const GAG_TAKE = JSON.parse(readFileSync(join(ROOT, "soundtests", "proto-crowd", "tavern-chatter", "KEY.md"), "utf8").split("```json\n")[1].split("\n```")[0]);
const gulls = () => {
  const p = Object.assign({}, GAG_TAKE), up = (s) => Object.assign({}, s, { freq: Math.round(s.freq * 3.1), crSize: r2(s.crSize * 0.5), crPitchStart: 4, crPitchEnd: -6, crTension: 0.75,
    crNasal: 0.5, crRough: 0.2 });
  Object.assign(p, up(p));
  p.layers = JSON.stringify(JSON.parse(p.layers).map((l) => Object.assign({}, l, { s: up(l.s) })));
  return p;
};
const GAG_IDEA = "the crowd round's tavern take A, verbatim: four voices each yelling the same syllable ~5 times a second (\"MINE MINE MINE\"), one after another";
const GAG_ALT_IDEA = "the same squabble sized as real gulls: small throats, three times higher, a sharper rise and fall on every call";
if (arg === "gag" || !arg || arg === "sep") {
  const p = Object.assign({}, GAG_TAKE), a = gulls();
  durCheck(GAG, p); durCheck(GAG + " alt", a);
  // the base is the take verbatim: gain 1 (the round played it at 0.7, then matched levels), no Limiter
  p.gain = 1; delete p.limiter;
  const m = measure(render(p)), am = level(a, m.lufs);
  console.log(GAG.padEnd(18) + "NEW PRESET " + fmt(m) + "\n      gain 1, no Limiter (" + (m.lufs - TARGET).toFixed(1) + " dB against the section median)\n  " + "".padEnd(12) + "ALT1 " + fmt(am) + "\n      " + fmtLv(a, am, m.lufs));
  const gm = Object.assign({ category: "Cartoon / Misc" }, asPreset(p, { freq: 0.08, crSize: 0.06, rate: 0.1 }, [a]));
  rows.gag = { name: GAG, p, r: render(p), m, f: features(m), alt: { p: a, r: render(a), m: am, f: features(am) }, json: gm };
  if (arg !== "sep") {
    wav(slug(GAG) + "-2-new.wav", rows.gag.r, GAG + " (NEW preset)");
    wav(slug(GAG) + "-alt1.wav", rows.gag.alt.r, GAG + " (alt 1)");
    writeFileSync(join(jsonDir, "cartoon-new.json"), JSON.stringify({ [GAG]: gm }, null, 2) + "\n");
  }
  if (arg === "gag") process.exit(0);
}

// ---- separation: the whole section as it would ship (new where redesigned, today's where kept), plus neighbours in
// other sections, plus the gag. Alts are measured against their own base.
const shipped = SECTION.map((n) => rows.find((x) => x.name === n) || Object.assign({ kept: true }, refRow(n))).concat(REFS.map((n) => Object.assign({ ref: true }, refRow(n))));
if (rows.gag) shipped.push(rows.gag);
const D = (a, b, set) => { const x = set.find((q) => q.name === a), y = set.find((q) => q.name === b); return [dist(x.f, y.f), why(x.f, y.f)]; };
const todaySet = SECTION.map((n) => refRow(n)).concat(REFS.map((n) => refRow(n)));
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or body, or a clear shape step) — NEW (today)");
const GROUPS = [["Squishy Plop", "Goofy Plop", "Wobbly Plop", "Bubble Blorp", "Silly Blorp"], ["Goofy Splat", "Zany Splat", "Slime Splat", "Mud Squelch"],
  ["Silly Wobble", "Zany Wobble", "Loony Wobble", "Boing Spring"], ["Squishy Boing", "Silly Boing", "Boing Spring", "Cartoon Boing", "Springy Boing", "Doorstop Spring"],
  ["Slippery Sproing", "Bouncy Sproing", "Cartoon Boing", "Springy Boing"], ["Bouncy Pop", "Bubble Pop", "Pop Cork", "Squish Pop"], ["Zany Squish", "Squish Pop", "Mud Squelch"],
  ["Loony Squeak", "Squeaky Toy", "Rubber Stretch"], ["Fart", "Fart 2", "Burp"], ["Slide Whistle Up", "Slide Whistle Down", "Rubber Stretch"],
  ["Gold Bar Clunk", "Wax Seal", "Knuckle Crack"], ["Brush Tap", "Brush Clatter", "Glass Clink"], ["Palette Scrape", "Paint Stroke", "Shears Snip"]];
for (const g of GROUPS) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
  const [d, w] = D(g[i], g[j], shipped), [d0] = D(g[i], g[j], todaySet);
  console.log("  " + d.toFixed(2) + " (" + d0.toFixed(2) + ")  " + g[i] + " / " + g[j] + "   (" + w + ")");
}
// the family against itself: every pair
const fam = shipped.filter((x) => FAMILY.includes(x.name)), famPairs = [], famToday = [];
for (let i = 0; i < fam.length; i++) for (let j = i + 1; j < fam.length; j++) { famPairs.push([fam[i].name, fam[j].name, dist(fam[i].f, fam[j].f), why(fam[i].f, fam[j].f)]); famToday.push(dist(refRow(fam[i].name).f, refRow(fam[j].name).f)); }
famPairs.sort((a, b) => a[2] - b[2]);
console.log("  the family's closest pairs (" + FAMILY.length + " names):"); for (const [a, b, d, w] of famPairs.slice(0, 6)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
console.log("  family median pair " + median(famPairs.map((x) => x[2])).toFixed(2) + ", min " + famPairs[0][2].toFixed(2) + "; TODAY median " + median(famToday).toFixed(2) + ", min " + Math.min(...famToday).toFixed(2));
for (const a of altRows) { const base = rows.find((x) => x.name === a.name); console.log("  " + dist(a.f, base.f).toFixed(2) + "  " + a.name + " / its alt " + (a.i + 1) + "   (" + why(a.f, base.f) + ")"); }
if (rows.gag) console.log("  " + dist(rows.gag.alt.f, rows.gag.f).toFixed(2) + "  " + GAG + " / its alt 1   (" + why(rows.gag.alt.f, rows.gag.f) + ")");
const all = []; for (let i = 0; i < shipped.length; i++) for (let j = i + 1; j < shipped.length; j++) all.push([shipped[i].name, shipped[j].name, dist(shipped[i].f, shipped[j].f), why(shipped[i].f, shipped[j].f)]);
all.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as shipped (the section + " + REFS.join(", ") + " + the gag):"); for (const [a, b, d, w] of all.slice(0, 14)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
const todayPairs = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) todayPairs.push(dist(refRow(SECTION[i]).f, refRow(SECTION[j]).f));
const secPairs = all.filter(([a, b]) => SECTION.includes(a) && SECTION.includes(b)).map((x) => x[2]);
console.log("  section median pair " + median(secPairs).toFixed(2) + ", min " + Math.min(...secPairs).toFixed(2) + "; TODAY median " + median(todayPairs).toFixed(2) + ", min " + Math.min(...todayPairs).toFixed(2));
const every = rows.filter((x) => !x.keptBase).concat(altRows);
const over2 = every.filter((x) => x.m.sec > 2.001).map((x) => x.name + (x.i != null ? " alt" + (x.i + 1) : "") + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges (new + alts): audible " + Math.min(...every.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...every.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...every.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...every.map((x) => x.m.lufs)).toFixed(1) + " (target " + TARGET.toFixed(1) + "); peaks max " +
  Math.max(...every.map((x) => x.m.peak)).toFixed(3) + ", clipping " + every.filter((x) => x.m.clip).length + ", |DC| max " +
  Math.max(...every.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1) + "; centroids " +
  Math.min(...every.map((x) => x.m.cent)).toFixed(0) + "-" + Math.max(...every.map((x) => x.m.cent)).toFixed(0) + " Hz");
console.log("  over 2 s: " + (over2.join(", ") || "none"));
const lvShip = shipped.filter((x) => !x.ref && x !== rows.gag).map((x) => x.m.lufs).sort((a, b) => a - b);
console.log("  section as shipped: median " + median(lvShip).toFixed(1) + " LUFS, range " + lvShip[0].toFixed(1) + " to " + lvShip[lvShip.length - 1].toFixed(1));
const redone = rows.filter((x) => !x.keptBase);
console.log("  before/after loudness (new - now, dB; integrated, loudest 400 ms): " + redone.map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + "/" +
  (x.m.mmax - x.now.m.mmax >= 0 ? "+" : "") + (x.m.mmax - x.now.m.mmax).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (section order, ~0.4 s apart): each redesign, then each new alt
writeFileSync(join(jsonDir, "cartoon-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR), seq = [];
for (const x of rows) {
  if (!x.keptBase) seq.push({ r: x.r, label: x.name, idea: IDEA[x.name] });
  altRows.filter((a) => a.name === x.name).forEach((a) => seq.push({ r: a.r, label: x.name + " (alt " + (a.i + 1) + ")", idea: ALT_IDEA[x.name][a.i] }));
}
if (rows.gag) { seq.push({ r: rows.gag.r, label: GAG + " (NEW)", idea: GAG_IDEA }); seq.push({ r: rows.gag.alt.r, label: GAG + " (alt 1)", idea: GAG_ALT_IDEA }); }
let total = 0; for (const x of seq) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
seq.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.label.padEnd(29) + x.idea); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Cartoon / Misc redo, all new");
const lvl = (x) => x.m.lufs.toFixed(1) + " (max " + x.m.mmax.toFixed(1) + ")";
const lv = rows.map((x) => "  " + x.name.padEnd(18) + "now " + lvl(x.now) + (x.keptBase ? "  (kept)" : "  new " + lvl(x) + "  (" + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + " dB)") +
  altRows.filter((a) => a.name === x.name).map((a) => "   alt" + (a.i + 1) + " " + lvl(a)).join(""));
if (rows.gag) lv.push("  " + GAG.padEnd(18) + "NEW " + lvl(rows.gag) + "   alt1 " + lvl(rows.gag.alt));
const perSound = rows.map((x) => "- **" + x.name + "**" + (x.keptBase ? " (base KEPT; `" + x.slug + "-1-now.wav` is it)" : ", `" + x.slug + "-1-now.wav` → `" + x.slug + "-2-new.wav`: " + IDEA[x.name]) +
  altRows.filter((a) => a.name === x.name).map((a) => "\n  - `" + x.slug + "-alt" + (a.i + 1) + ".wav`: " + ALT_IDEA[x.name][a.i]).join(""));
const tables = "## The family (" + FAMILY.length + " names, two tables composed)\n\nAdjective = the performance:\n\n" + Object.entries(ADJ_IDEA).map(([k, v]) => "- **" + k + "**: " + v).join("\n") +
  "\n\nNoun = the object:\n\n" + Object.entries(NOUN_IDEA).map(([k, v]) => "- **" + k + "**: " + v).join("\n") + "\n\n";
writeFileSync(join(wavDir, "KEY.md"), "# Cartoon / Misc redo\n\n`all-new.wav`: every redesign and every new alt in section order, 0.4 s apart, then the new gag preset.\n" +
  "Per sound: `<slug>-1-now.wav` is today's preset as the app plays it, `<slug>-2-new.wav` the redesign, `<slug>-alt<N>.wav` an\n" +
  "alternative archetype (the button picks one at random per click). All Normalize on, NOT loudness-matched (each is what its button\n" +
  "plays). The new ones aim at the section's median, " + TARGET.toFixed(1) + " LUFS, with stated offsets (small real objects under it, a gold bar over);\n" +
  "one-shots with a ring or a tail, and the whole family, are levelled on their loudest 400 ms rather than the integrated figure,\n" +
  "which averages the tail in. At most Limiter " + LIMIT_MAX + "; a transient that cannot get there lands short rather than being squashed.\n" +
  "Where a redesign replaces the base, today's sound usually stays as an alt (\"someone may actually be looking for a more synth'd version\");\n" +
  "that alt is today's patch with only its gain (and, where needed, a Limiter) reset to the redesign's level, so a click does not jump.\n" +
  "Where today's base is KEPT, its new alts are levelled to today's loudest 400 ms instead.\n\n" +
  "```\n" + key.join("\n") + "\n```\n\n## What to listen for, sound by sound\n\n" + perSound.join("\n") + "\n\n" +
  "## NEW preset: " + GAG + " (appended to the section; `tools/new-presets/cartoon-new.json`)\n\n- `" + slug(GAG) + "-2-new.wav`: " + GAG_IDEA +
  ". This is the crowd round's tavern-chatter **take A** (the round's creature-engine control, not a crowd-engine take), re-rendered sample-identical to the file you heard; only its gain is set.\n- `" +
  slug(GAG) + "-alt1.wav`: " + GAG_ALT_IDEA + "\n\n" + tables +
  "## Loudness, before and after (BS.1770 integrated, and the loudest 400 ms; a big gap makes the louder one sound better, so listen past it)\n\n```\n" + lv.join("\n") + "\n```\n\n" +
  "## KEPT AS BASE, with new alts\n\n" + Object.entries(KEPT_ALTS).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n\n" +
  "## KEPT AS IS (no file: today's sound stays)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + redone.length + " redesigns (now + new), " + altRows.length + " alts, the gag, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, cartoon-redo.json, cartoon-new.json");
