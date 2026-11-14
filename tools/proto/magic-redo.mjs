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
const SECTION = CATS.find((c) => c[0] === "Magic")[1];
const REFS = ["Choir Aah", "Angelic Wash", "Pixie Dust", "Shimmer Wash", "Thunder", "Electric Sparks", "Teleporter Hum", "Glass Shatter"];   // neighbours in other sections (the pads Healing / Radiant Aura copy, the sparkle, the storm, the transporter, glass), in the separation set

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
  console.log("\nMAGIC (" + SECTION.length + ") median " + median(e).toFixed(1) + " LUFS, range " + e[0].toFixed(1) + " to " + e[e.length - 1].toFixed(1) +
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
// ---- two more voices: glass (36) and the formant voice (13), and the bar's motor
// glass (36): o is shorthand for the gl* rows; the chassis is the shipped glass presets' (high-pass at 40 Hz, flat amp)
function glass(o) {
  return space({ wave: 36, freq: Math.round(o.f), glBreak: r2(o.brk ?? 0), glMaterial: o.mat ?? 1, glShape: o.shape ?? 0, glThick: r2(o.thick ?? 0.15), glStriker: r2(o.striker ?? 0.95),
    glThump: r2(o.thump ?? 0), glCrack: r2(o.crack ?? 0), glPieces: r2(o.pieces ?? 0.5), glShard: r2(o.shard ?? 0.4), glHeight: r2(o.height ?? 0), glThrow: r2(o.thr ?? 0.35),
    glBounce: r2(o.bounce ?? 0.5), glFloor: r2(o.floor ?? 0.7), glSettle: r2(o.settle ?? 0.3), glRing: r2(o.gring ?? 0.55), glBeat: r2(o.beat ?? 0.4), glPair: r2(o.pair ?? 0),
    glPairTune: r2(o.pairTune ?? 0), glSeed: o.seed ?? 1, glPeak: r2(o.peak ?? 0), width: r2(o.width ?? 0.5), attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06,
    filterMode: 1, cutoff: 40, reso: 0.31, drive: 0, duration: r2(o.dur) }, o);
}
// the formant voice: osc() with the formant rows (fsize, not size: size is the reverb's)
function voice(o) {
  const p = osc(Object.assign({}, o, { wave: 13 }));
  Object.assign(p, { formantVowel: r2(o.vowel ?? 0), formantSize: r2(o.fsize ?? 1), formantQ: r2(o.fq ?? 0.5), formantBreath: r2(o.breath ?? 0), formantTilt: r2(o.ftilt ?? 0.4) });
  if (o.lfo) Object.assign(p, { formantLfoRate: r2(o.lfo[0]), formantLfoDepth: r2(o.lfo[1]) });
  return p;
}
const barM = (o) => { const p = bar(o); if (o.motor) p.barMotor = r2(o.motor); return p; };
const today = (name) => { const p = Object.assign({}, PRESETS[name]); delete p._vary; delete p._alts; return p; };

// ============================================================================================================
// THE NAMED DESIGNS. Magic is synthetic BY NATURE (a shimmer, a chime cluster, an FM sparkle, a riser IS the idiom),
// so the gain comes from the BUILD (a charge, a release and a tail as separate layers) and, for an element, its own
// physical body: ice is glass 36 in Ice / Crystal, lightning is the weather engine's thunder under an arc, an arcane
// blast is the blast engine with a bell cluster and sparks, wind is weather wind with an edge tone, poison is bubbles.
// The Wizard's picked spells (index.html WIZ_SPELLS: ice forming then frost bells; a ring-modded warp with flickering
// chimes; the bolt + buzz + crackle) are AJ's own word on the idiom and are followed where they apply.
const S = {};

// TELEPORT: VANISHING. The body dissolves into light (a shimmering additive cluster rising a fifth, trembling at 14 Hz),
// glockenspiel sparks climbing through it in whole steps, and as it goes the air rushes into where it stood (a short
// whoosh and a soft low pop). Teleport 2 is its mirror: arriving.
S["Teleport"] = () => sound(
  osc({ wave: 16, f: 520, partials: 14, tilt: 0.75, drift: 0.9, driftRate: 2, adet: 0.8, sweep: 0.45, trem: [0.45, 14], atk: 0.3, hold: 0.25, dec: 0.12, sus: 0, rel: 0.06, curve: 0.5,
    dur: 0.75, reverb: 0.4, size: 0.7, rtone: 0.7, width: 0.8 }),
  [[bar({ f: 1568, type: 2, mallet: 0.55, ring: 0.35, repeat: 8, rate: 13, arp: 2, dur: 0.65, rel: 0.3, reverb: 0.4, size: 0.7, rtone: 0.75, width: 0.8 }), 0.04, 0.5],
   [whoosh({ tone: 0.55, sweep: 0.9, body: 0.45, peak: 0.25, atk: 0.005, dec: 0.25, sus: 0, rel: 0.08, dur: 0.4, width: 0.8, reverb: 0.3, size: 0.6 }), 0.56, 0.75],
   [imp({ tone: 0.35, decay: 0.08, punch: 0.8, grit: 0.05, dec: 0.06, rel: 0.05, dur: 0.35, boom: 0.5, boomFreq: 90, boomDrop: 0.5, boomDecay: 0.08, reverb: 0.3, size: 0.6 }), 0.6, 0.4]]);

// TELEPORT 2: ARRIVING. The pop and the air pushed aside first, then the light settling into a body: the shimmer
// falling a fifth and stilling, the sparks stepping down.
S["Teleport 2"] = () => sound(
  osc({ wave: 16, f: 1040, partials: 14, tilt: 0.75, drift: 0.9, driftRate: 2, adet: 0.8, sweep: -0.45, trem: [0.4, 14], atk: 0.01, hold: 0.05, dec: 0.75, sus: 0, rel: 0.3, curve: 0.5,
    dur: 1.1, reverb: 0.4, size: 0.7, rtone: 0.7, width: 0.8 }),
  [[imp({ tone: 0.35, decay: 0.08, punch: 0.85, grit: 0.05, dec: 0.06, rel: 0.05, dur: 0.35, boom: 0.55, boomFreq: 90, boomDrop: 0.5, boomDecay: 0.08, reverb: 0.3, size: 0.6 }), 0, 0.45],
   [whoosh({ tone: 0.55, sweep: 0.9, body: 0.45, peak: 0.08, atk: 0.003, dec: 0.3, sus: 0, rel: 0.08, dur: 0.4, width: 0.8, reverb: 0.3, size: 0.6 }), 0, 0.7],
   [bar({ f: 3136, type: 2, mallet: 0.55, ring: 0.35, repeat: 8, rate: 12, arp: -2, dur: 0.75, rel: 0.35, reverb: 0.4, size: 0.7, rtone: 0.75, width: 0.8 }), 0.08, 0.45]]);

// STARDUST CHIME: a cascade of tiny bells falling in whole steps (the whole-tone run IS fairy-tale magic), dust
// twinkling over it (very high, sparse particle), and a soft shimmer ringing on under it (today's additive chime,
// quieter, as the bed).
S["Stardust Chime"] = () => sound(
  bar({ f: 3136, type: 2, mallet: 0.35, ring: 0.6, repeat: 9, rate: 11, arp: -2, dur: 1.4, rel: 0.5, reverb: 0.45, size: 0.7, rtone: 0.8, width: 0.85, pingpong: 0.5, delay: 0.2, delayTime: 0.13, delayFb: 0.3 }),
  [[part({ rate: 28, tone: 0.98, decay: 0.05, spread: 0.95, hp: 5000, atk: 0.05, hold: 0.3, dec: 0.8, sus: 0, rel: 0.2, dur: 1.3, width: 0.95, reverb: 0.4, size: 0.7 }), 0.02, 0.3],
   [osc({ wave: 16, f: 1319, partials: 12, tilt: 0.8, drift: 0.7, driftRate: 1.2, adet: 0.6, atk: 0.2, hold: 0.2, dec: 0.9, sus: 0, rel: 0.3, dur: 1.5, reverb: 0.45, size: 0.7, width: 0.7 }), 0, 0.3]]);

// CURE: a status cured: a quick bright arpeggio up a major chord on glockenspiel (C E, then G C), a soft glow swelling
// under it, and a sparkle at the top.
S["Cure"] = () => sound(
  bar({ f: 1047, type: 2, mallet: 0.45, ring: 0.55, repeat: 2, rate: 11, arp: 4, dur: 0.8, rel: 0.4, reverb: 0.4, size: 0.65, rtone: 0.75, width: 0.6 }),
  [[bar({ f: 1568, type: 2, mallet: 0.5, ring: 0.6, repeat: 2, rate: 11, arp: 5, dur: 0.95, rel: 0.45, reverb: 0.4, size: 0.65, rtone: 0.75, width: 0.7 }), 0.18, 1.0],
   [osc({ wave: 16, f: 1047, partials: 8, tilt: 0.6, drift: 0.6, driftRate: 1.5, adet: 0.5, sweep: 0.1, atk: 0.15, hold: 0.1, dec: 0.6, sus: 0, rel: 0.3, dur: 1.0, reverb: 0.45, size: 0.7, width: 0.8 }), 0, 0.35],
   [part({ rate: 30, tone: 0.97, decay: 0.06, spread: 0.9, hp: 4500, atk: 0.02, dec: 0.5, sus: 0, rel: 0.15, dur: 0.6, width: 0.9, reverb: 0.4, size: 0.65 }), 0.32, 0.35]]);

// HEALING AURA: a warm glow that breathes in and stays (a soft additive pad on C with its fifth entering after it), a
// vibraphone with its motor turning (E then C, the chord's top), and motes of light drifting through it. Today's was
// the Pads section's Choir Aah note for note, so nothing is lost.
S["Healing Aura"] = () => sound(
  osc({ wave: 16, f: 262, partials: 10, tilt: 0.45, drift: 0.5, driftRate: 0.35, adet: 0.5, trem: [0.15, 0.6], atk: 0.5, hold: 0.6, dec: 0.4, sus: 0.7, rel: 0.4, curve: 0.4, dur: 2,
    chorus: [0.35, 0.6], reverb: 0.5, size: 0.85, rtone: 0.6, width: 0.75 }),
  [[osc({ wave: 16, f: 392, partials: 8, tilt: 0.45, drift: 0.5, driftRate: 0.45, adet: 0.5, atk: 0.5, hold: 0.5, dec: 0.4, sus: 0.6, rel: 0.4, curve: 0.4, dur: 1.75, reverb: 0.5, size: 0.85, width: 0.8 }), 0.25, 0.6],
   [barM({ f: 659, type: 3, mallet: 0.2, ring: 0.9, motor: 0.55, repeat: 2, rate: 2.2, arp: 8, dur: 1.5, rel: 0.5, reverb: 0.5, size: 0.85, rtone: 0.7, width: 0.7 }), 0.3, 0.6],
   [part({ rate: 10, tone: 0.95, decay: 0.15, spread: 0.9, hp: 3000, atk: 0.5, hold: 0.5, dec: 0.6, sus: 0, rel: 0.3, dur: 1.8, width: 0.95, reverb: 0.5, size: 0.85 }), 0.1, 0.4]]);

// POISON: poisoned: sickly bubbling (low bubbles, a sour wobble in their pitch), the life draining out (a detuned pulse
// drooping, crushed), and a hiss of vapor.
S["Poison"] = () => sound(
  bub({ f: 300, rate: 14, rise: 0.3, spread: 0.6, decay: 0.45, drive: 0.2, cut: 3000, vib: 0.1, vibRate: 6, atk: 0.04, hold: 0.3, dec: 0.5, sus: 0.3, rel: 0.25, dur: 1.15, reverb: 0.25, size: 0.55, rtone: 0.4, width: 0.6 }),
  [[osc({ wave: 4, f: 330, pw: 0.3, unison: 3, detune: 35, sweep: -0.35, vib: 0.12, vibRate: 7, crush: 10, cut: 1800, reso: 0.4, atk: 0.02, hold: 0.1, dec: 0.6, sus: 0.15, rel: 0.25, dur: 1.0,
     reverb: 0.25, size: 0.55, rtone: 0.4, width: 0.5 }), 0, 0.6],
   [osc({ wave: 0, f: 200, noise: 1, mode: 2, cut: 3800, reso: 0.3, atk: 0.08, hold: 0.1, dec: 0.5, sus: 0, rel: 0.15, dur: 0.8, width: 0.7 }), 0.05, 0.3]]);

// FROST BOLT: an ice bolt: a cold bright streak (a fast whoosh, high, the crystalline triangle tone falling with it),
// the HIT (glass 36 in Ice, a small shard bursting, the shards scattering), frost crackling where it struck.
S["Frost Bolt"] = () => sound(
  whoosh({ tone: 0.85, sweep: 0.9, body: 0.12, peak: 0.65, atk: 0.02, dec: 0, sus: 1, rel: 0.06, dur: 0.38, hp: 1000, width: 0.7, reverb: 0.25, size: 0.55, rtone: 0.75 }),
  [[osc({ wave: 3, f: 2400, unison: 3, detune: 16, sweep: -0.35, vib: 0.01, vibRate: 14, atk: 0.005, hold: 0.05, dec: 0.3, sus: 0, rel: 0.05, dur: 0.4, reverb: 0.3, size: 0.55, rtone: 0.75, width: 0.7 }), 0, 0.35],
   [glass({ f: 1800, brk: 0.8, mat: 4, shape: 2, thick: 0.4, striker: 0.9, thump: 0.2, crack: 0.7, pieces: 0.6, shard: 0.25, height: 0, thr: 0.5, bounce: 0.4, floor: 0.3, settle: 0.2, gring: 0.4,
     seed: 17, dur: 1.2, reverb: 0.3, size: 0.6, rtone: 0.7, width: 0.7 }), 0.3, 1.0],
   [part({ rate: 50, tone: 0.95, decay: 0.1, spread: 0.8, hp: 3000, atk: 0.005, dec: 0.5, sus: 0, rel: 0.15, dur: 0.6, width: 0.8, reverb: 0.3, size: 0.6 }), 0.32, 0.4]]);

// ICE: freezing over (the Wizard's pick: ice forming, then the frost bells): ice cracking as it spreads (fast, high
// ticks), a cold wind, then the ice set solid ringing (glass 36 in Ice, intact, a second piece warbling against it),
// frost fizzing.
S["Ice"] = () => sound(
  imp({ tone: 1, decay: 0.015, punch: 1, grit: 0.4, repeat: 12, rate: 22, dec: 0.02, rel: 0.03, dur: 0.6, width: 0.7, reverb: 0.3, size: 0.6, rtone: 0.75 }),
  [[wind({ int: 0.45, gust: 0.3, gustRate: 1.5, tone: 0.85, body: 0.05, seed: 23, atk: 0.12, hold: 0.3, dec: 0.7, sus: 0, rel: 0.2, dur: 1.3, hp: 2000, width: 0.8 }), 0, 0.45],
   [glass({ f: 1568, brk: 0, mat: 4, shape: 0, thick: 0.2, striker: 0.9, gring: 0.6, beat: 0.5, pair: 0.85, pairTune: 1.1, seed: 29, dur: 1.4, reverb: 0.4, size: 0.7, rtone: 0.75, width: 0.6 }), 0.48, 0.7],
   [part({ rate: 45, tone: 0.97, decay: 0.08, spread: 0.85, hp: 4000, atk: 0.2, hold: 0.2, dec: 0.6, sus: 0, rel: 0.2, dur: 1.1, width: 0.9 }), 0.1, 0.3]]);

// LIGHTNING STRIKE: a bolt striking close: the electric arc (a gritty crushed crackle, flickering) and its zap, then the
// thunder itself (weather 29 in Thunder: a close cloud-to-ground bolt, its crack rolling off).
S["Lightning Strike"] = () => sound(
  { wave: 29, wxType: 2, wxDistance: 0.35, wxBolt: 0, wxRoll: 1.3, wxPulse: 2.2, wxCrackle: 0.9, wxHeight: 1500, wxLength: 1800, wxTone: 0.6, wxSeed: 241, width: 0.8,
    attack: 0.001, hold: 0, decay: 0, sustain: 1, release: 0.06, filterMode: 0, cutoff: 12000, reso: 0, drive: 0, reverb: 0.5, reverbSize: 0.9, reverbTone: 0.2, duration: 2 },
  [[osc({ wave: 1, f: 620, noise: 0.5, drive: 0.72, crush: 4, down: 6, flicker: [0.6, 16], cut: 6500, reso: 0.5, atk: 0, hold: 0.001, dec: 0.08, sus: 0.3, rel: 0.1, dur: 0.45, width: 0.5 }), 0, 0.55],
   [osc({ wave: 2, f: 1400, sweep: -0.6, ring: 0.4, ringF: 400, drive: 0.4, cut: 7000, reso: 0.5, atk: 0, hold: 0.005, dec: 0.15, sus: 0, rel: 0.08, dur: 0.3, width: 0.5, reverb: 0.3, size: 0.7 }), 0, 0.5]]);

// ARCANE BLAST: a spell going off: a small blast (blast 31: a short sharp pressure wave, a little fire in it), the
// magic in it (an inharmonic FM bell cluster struck hard and falling, ring-modded, phased), its sparks scattering as
// glockenspiel glints falling in minor thirds and a sparkling crackle.
S["Arcane Blast"] = () => sound(
  blast({ size: 0.35, dist: 12, env: 0, room: 0.6, tail: 0.6, pulse: 2.5, roar: 0.35, rumble: 0.5, seed: 61, dur: 1.4 }),
  [[osc({ wave: 18, f: 330, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.6, fb: 0.2, fmEnv: 0.9, fmEnvTime: 0.2, sweep: -0.3, ring: 0.35, ringF: 460, atk: 0.001, hold: 0.01, dec: 0.8, sus: 0, rel: 0.4,
     curve: 0.6, dur: 1.3, phaser: [0.5, 0.8], reverb: 0.45, size: 0.8, rtone: 0.6, width: 0.8 }), 0, 0.8],
   [bar({ f: 2637, type: 2, mallet: 0.7, ring: 0.4, repeat: 6, rate: 12, arp: -3, dur: 0.85, rel: 0.35, reverb: 0.4, size: 0.75, rtone: 0.75, width: 0.9 }), 0.06, 0.4],
   [part({ rate: 80, tone: 0.9, decay: 0.08, spread: 0.9, hp: 2500, atk: 0.003, dec: 0.6, sus: 0, rel: 0.15, dur: 0.75, width: 0.9, reverb: 0.4, size: 0.75 }), 0.02, 0.4]]);

// HOLY SMITE: judgment from above: a great bell struck (FM 4op at the classic 1 : 3.5 bell ratio, its brightness
// dying away), a choir answering on the chord (two formant voices, a fifth apart, swelling), and the blow itself (a
// bright impact with a deep boom).
S["Holy Smite"] = () => sound(
  osc({ wave: 18, f: 392, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.55, fb: 0.05, fmEnv: 0.6, fmEnvTime: 0.3, atk: 0.001, hold: 0.01, dec: 1.0, sus: 0, rel: 0.5, curve: 0.65, dur: 1.9,
    reverb: 0.55, size: 0.85, rtone: 0.75, width: 0.7 }),
  [[voice({ f: 262, vowel: 0, fsize: 1.05, fq: 0.55, breath: 0.15, ftilt: 0.45, vib: 0.012, vibRate: 5, atk: 0.08, hold: 0.2, dec: 0.6, sus: 0.5, rel: 0.5, dur: 1.7, chorus: [0.3, 0.7],
     reverb: 0.55, size: 0.85, rtone: 0.75, width: 0.8 }), 0.03, 0.7],
   [voice({ f: 392, vowel: 0.05, fsize: 1.1, fq: 0.55, breath: 0.15, ftilt: 0.45, vib: 0.012, vibRate: 5.4, atk: 0.12, hold: 0.2, dec: 0.6, sus: 0.45, rel: 0.5, dur: 1.65, chorus: [0.3, 0.7],
     reverb: 0.55, size: 0.85, rtone: 0.75, width: 0.8 }), 0.06, 0.55],
   [imp({ tone: 0.55, decay: 0.25, punch: 1, grit: 0.15, dec: 0.15, rel: 0.25, dur: 0.9, boom: 0.7, boomFreq: 60, boomDrop: 0.6, boomDecay: 0.35, reverb: 0.4, size: 0.85 }), 0, 0.6]]);

// DARK CURSE: a curse laid: a low choir moaning "ooh", sinking (a deep formant voice), a second voice a tritone off it,
// a whispering hiss with its vowel moving, and a deep blow of doom under the start.
S["Dark Curse"] = () => sound(
  voice({ f: 110, vowel: 0.95, fsize: 0.75, fq: 0.6, breath: 0.4, ftilt: 0.1, vib: 0.03, vibRate: 3.5, sweep: -0.12, atk: 0.15, hold: 0.2, dec: 0.7, sus: 0.45, rel: 0.5, dur: 1.75, cut: 2500,
    reverb: 0.5, size: 0.85, rtone: 0.25, width: 0.6 }),
  [[voice({ f: 156, vowel: 0.75, fsize: 0.8, fq: 0.6, breath: 0.35, ftilt: 0.1, vib: 0.035, vibRate: 3.1, sweep: -0.14, atk: 0.2, hold: 0.2, dec: 0.7, sus: 0.4, rel: 0.5, dur: 1.7, cut: 2500,
     reverb: 0.5, size: 0.85, rtone: 0.25, width: 0.8 }), 0.05, 0.6],
   [voice({ f: 220, vowel: 0.25, fsize: 1.3, breath: 1, lfo: [1.3, 0.5], hp: 1200, atk: 0.3, hold: 0.3, dec: 0.7, sus: 0.2, rel: 0.4, dur: 1.6, reverb: 0.5, size: 0.85, rtone: 0.3, width: 0.9 }), 0.1, 0.4],
   [imp({ tone: 0.15, decay: 0.3, punch: 0.8, grit: 0.2, dec: 0.2, rel: 0.3, dur: 0.9, boom: 0.75, boomFreq: 55, boomDrop: 0.4, boomDecay: 0.55, reverb: 0.4, size: 0.85 }), 0, 0.5]]);

// WIND SLASH: a blade of air: the slash (a fast, bright whoosh), the air WHISTLING off its edge (weather wind, one
// edge tone at 1.7 kHz), and the wind it leaves behind, gusting away.
S["Wind Slash"] = () => sound(
  whoosh({ tone: 0.7, sweep: 1, body: 0.15, peak: 0.3, atk: 0.005, dec: 0, sus: 1, rel: 0.06, dur: 0.42, width: 0.8, reverb: 0.25, size: 0.6, rtone: 0.6 }),
  [[wind({ int: 0.9, gust: 0.2, gustRate: 2, tone: 0.7, body: 0.1, whistle: 0.6, whistles: 1, f: 1700, q: 70, seed: 31, atk: 0.02, hold: 0.05, dec: 0.35, sus: 0, rel: 0.06, dur: 0.6, width: 0.7 }), 0, 0.7],
   [wind({ int: 0.45, gust: 0.7, gustRate: 3, tone: 0.55, body: 0.15, seed: 37, atk: 0.05, hold: 0, dec: 0.8, sus: 0, rel: 0.2, dur: 1.0, width: 0.9, reverb: 0.25, size: 0.6 }), 0.15, 0.4]]);

// MAGIC FIZZLE: a spell failing: the tone sputtering out and falling (a saw cutting in and out), its last sparks
// dying, a sad little two-note droop on a bell (a tritone down), and a puff of smoke.
S["Magic Fizzle"] = () => sound(
  osc({ wave: 2, f: 700, sweep: -0.6, flicker: [0.75, 11], crush: 8, cut: 2500, reso: 0.4, atk: 0.005, hold: 0.05, dec: 0.5, sus: 0.1, rel: 0.2, dur: 0.8, reverb: 0.3, size: 0.6, rtone: 0.5, width: 0.5 }),
  [[part({ rate: 25, tone: 0.75, decay: 0.1, spread: 0.9, atk: 0.01, dec: 0.6, sus: 0, rel: 0.1, dur: 0.7, width: 0.8, reverb: 0.3, size: 0.6 }), 0.05, 0.5],
   [bar({ f: 784, type: 2, mallet: 0.2, ring: 0.25, repeat: 2, rate: 4.5, arp: -6, dur: 0.75, rel: 0.3, reverb: 0.3, size: 0.6, width: 0.5 }), 0.3, 0.4],
   [whoosh({ tone: 0.35, sweep: 0.3, body: 0.4, peak: 0.3, atk: 0.02, dec: 0, sus: 1, rel: 0.1, dur: 0.55, width: 0.8 }), 0.4, 0.45]]);

// CURSE WHOOSH: a curse flying past: a dark whoosh (low, full, phased) carrying a ghostly wail sliding down (a formant
// "ooh", ring-modded off-key), and a whisper trailing it.
S["Curse Whoosh"] = () => sound(
  whoosh({ tone: 0.25, sweep: 0.6, body: 0.6, peak: 0.45, atk: 0.02, dec: 0, sus: 1, rel: 0.15, dur: 1.0, phaser: [0.5, 1.2, 0.8], width: 0.8, reverb: 0.4, size: 0.75, rtone: 0.3 }),
  [[voice({ f: 330, vowel: 0.85, fsize: 0.9, fq: 0.6, breath: 0.3, ftilt: 0.2, vib: 0.04, vibRate: 6, sweep: -0.5, ring: 0.3, ringF: 233, atk: 0.15, hold: 0.1, dec: 0.7, sus: 0, rel: 0.3, dur: 1.1,
     reverb: 0.45, size: 0.8, rtone: 0.3, width: 0.7 }), 0.05, 0.6],
   [voice({ f: 220, vowel: 0.25, fsize: 1.3, breath: 1, lfo: [2, 0.5], hp: 1500, atk: 0.2, hold: 0.1, dec: 0.7, sus: 0, rel: 0.3, dur: 1.1, reverb: 0.45, size: 0.8, rtone: 0.3, width: 0.9 }), 0.25, 0.35]]);

// SHIELD CAST: a barrier going up: a "vwomm" rising into place (a phased detuned saw sweeping up, opening), the
// shield LOCKING with a crystal ring (glass 36 in Crystal, intact, a second piece warbling against it: the dome), its
// hum holding, a sparkle where it seals.
S["Shield Cast"] = () => sound(
  osc({ wave: 2, f: 220, unison: 3, detune: 12, sweep: 0.5, phaser: [0.6, 1.5, 0.8], cut: 1200, fenv: 0.7, reso: 0.3, atk: 0.22, hold: 0.05, dec: 0.15, sus: 0, rel: 0.05, curve: 0.5, dur: 0.48,
    reverb: 0.35, size: 0.65, rtone: 0.6, width: 0.7 }),
  [[glass({ f: 1180, brk: 0, mat: 1, thick: 0.15, striker: 0.95, gring: 0.65, beat: 0.5, pair: 0.85, pairTune: 1.1, seed: 401, dur: 1.4, reverb: 0.35, size: 0.65, rtone: 0.7, width: 0.6 }), 0.3, 0.8],
   [osc({ wave: 18, f: 440, algo: 1, r2: 1.5, r3: 3, r4: 1, index: 0.3, fb: 0.1, trem: [0.3, 7], phaser: [0.4, 0.4], atk: 0.25, hold: 0.2, dec: 0.5, sus: 0.2, rel: 0.3, dur: 1.2,
     reverb: 0.35, size: 0.65, width: 0.8 }), 0.3, 0.4],
   [part({ rate: 40, tone: 0.95, decay: 0.06, spread: 0.85, hp: 4000, atk: 0.005, dec: 0.35, sus: 0, rel: 0.1, dur: 0.45, width: 0.9, reverb: 0.35, size: 0.65 }), 0.32, 0.3]]);

// SUMMON PORTAL: a gateway tearing open: a vortex of air swirling up (weather wind, gusting, two hollow whistles,
// phased), the rift's drone (a thick detuned saw, ring-modded off-key, slowly throbbing, rising a little), the
// otherworld's shimmer pouring through once it is open, and the deep "whoomph" as it does.
S["Summon Portal"] = () => sound(
  wind({ int: 0.7, gust: 0.7, gustRate: 2.5, tone: 0.35, body: 0.6, whistle: 0.4, whistles: 2, f: 380, q: 40, seed: 43, atk: 0.5, hold: 0.6, dec: 0.5, sus: 0.4, rel: 0.3, dur: 1.9,
    phaser: [0.6, 1.2, 0.85], width: 0.9, reverb: 0.4, size: 0.85, rtone: 0.45 }),
  [[osc({ wave: 2, f: 110, unison: 5, detune: 25, ring: 0.4, ringF: 157, sweep: 0.15, cut: 1500, reso: 0.4, fenv: 0.5, phaser: [0.7, 0.4, 0.9], trem: [0.3, 3.5], atk: 0.5, hold: 0.8, dec: 0.4,
     sus: 0.6, rel: 0.4, dur: 1.9, reverb: 0.45, size: 0.85, rtone: 0.45, width: 0.8 }), 0, 0.7],
   [osc({ wave: 16, f: 880, partials: 12, tilt: 0.7, drift: 0.9, driftRate: 1.5, adet: 0.8, atk: 0.4, hold: 0.3, dec: 0.4, sus: 0.3, rel: 0.4, dur: 1.3, reverb: 0.5, size: 0.85, rtone: 0.7, width: 0.9 }), 0.55, 0.35],
   [imp({ tone: 0.2, decay: 0.3, punch: 0.7, grit: 0.1, dec: 0.2, rel: 0.3, dur: 0.9, boom: 0.7, boomFreq: 55, boomDrop: 0.5, boomDecay: 0.5, reverb: 0.45, size: 0.85 }), 0.55, 0.5]]);

// ============================================================================================================
// KEPT AS BASE, WITH NEW ALTS (AJ: "the joy of clicking the button repeatedly and getting variety"): today's sound stays
// the first version and these join it as other archetypes.
const ALTS = {}, ALT_IDEA = {};
ALTS["Chord Swell"] = [() => sound(
  osc({ wave: 16, f: 262, partials: 10, tilt: 0.55, drift: 0.5, driftRate: 0.3, adet: 0.5, atk: 0.5, hold: 0.6, dec: 0.4, sus: 0.7, rel: 0.5, curve: 0.4, dur: 2, reverb: 0.5, size: 0.85, rtone: 0.65, width: 0.75 }),
  [[osc({ wave: 16, f: 330, partials: 9, tilt: 0.55, drift: 0.5, driftRate: 0.4, adet: 0.5, atk: 0.5, hold: 0.5, dec: 0.4, sus: 0.6, rel: 0.5, curve: 0.4, dur: 1.85, reverb: 0.5, size: 0.85, width: 0.8 }), 0.15, 0.7],
   [osc({ wave: 16, f: 392, partials: 8, tilt: 0.55, drift: 0.5, driftRate: 0.5, adet: 0.5, atk: 0.5, hold: 0.4, dec: 0.4, sus: 0.6, rel: 0.5, curve: 0.4, dur: 1.7, reverb: 0.5, size: 0.85, width: 0.85 }), 0.3, 0.6],
   [bar({ f: 1047, type: 2, mallet: 0.35, ring: 0.5, repeat: 6, rate: 9, arp: 2, dur: 1.2, rel: 0.4, reverb: 0.5, size: 0.85, rtone: 0.8, width: 0.8 }), 0.45, 0.35]])];
ALT_IDEA["Chord Swell"] = ["the REVEAL: a major chord blooming one note at a time (C, then E, then G, soft additive voices), a glockenspiel run climbing over it"];
ALTS["Magic Sparkle"] = [() => sound(
  bar({ f: 1568, type: 2, mallet: 0.6, ring: 0.45, repeat: 4, rate: 16, arp: 5, dur: 0.9, rel: 0.4, reverb: 0.45, size: 0.7, rtone: 0.8, width: 0.8 }),
  [[part({ rate: 45, tone: 0.98, decay: 0.07, spread: 0.95, hp: 5000, atk: 0.005, dec: 0.6, sus: 0, rel: 0.15, dur: 0.75, width: 0.95, reverb: 0.4, size: 0.7 }), 0.03, 0.45],
   [whoosh({ tone: 0.85, sweep: 0.8, body: 0.05, peak: 0.25, atk: 0.005, dec: 0, sus: 1, rel: 0.05, dur: 0.3, hp: 2500, width: 0.9 }), 0, 0.3]])];
ALT_IDEA["Magic Sparkle"] = ["a BURST of glints: four glockenspiel notes leaping up in fourths, a twinkling dust over them, a breath of bright air"];
ALTS["Magic Sparkle 2"] = [() => sound(
  modal({ f: 2637, parts: 5, inharm: 0.45, ring: 0.5, bright: 0.9, repeat: 7, rate: 9, arp: -2, dur: 1.2, rel: 0.4, reverb: 0.45, size: 0.7, rtone: 0.85, width: 0.9, delay: 0.3, delayTime: 0.11, delayFb: 0.4, pingpong: 0.9 }),
  [[part({ rate: 20, tone: 1, decay: 0.1, spread: 0.95, hp: 6000, atk: 0.05, hold: 0.3, dec: 0.6, sus: 0, rel: 0.2, dur: 1.2, width: 0.95, reverb: 0.45, size: 0.7 }), 0, 0.35]])];
ALT_IDEA["Magic Sparkle 2"] = ["a GLITTER SHOWER: tiny bell glints falling in whole steps, bouncing left and right (ping-pong echo), a fine dust over them"];
ALTS["Mana Charge"] = [() => sound(
  osc({ wave: 16, f: 262, partials: 12, tilt: 0.7, drift: 0.8, driftRate: 2, adet: 0.7, sweep: 0.6, trem: [0.35, 9], atk: 0.5, hold: 0.45, dec: 0, sus: 1, rel: 0.05, curve: 0.6, dur: 0.97,
    reverb: 0.35, size: 0.65, rtone: 0.7, width: 0.8 }),
  [[bar({ f: 784, type: 2, mallet: 0.5, ring: 0.2, repeat: 10, rate: 10.5, arp: 2, dur: 0.95, rel: 0.1, reverb: 0.3, size: 0.6, rtone: 0.75, width: 0.6 }), 0, 0.35],
   [osc({ wave: 18, f: 1568, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.4, fmEnv: 0.8, fmEnvTime: 0.1, atk: 0.001, hold: 0.01, dec: 0.8, sus: 0, rel: 0.3, curve: 0.65, dur: 1.0,
     reverb: 0.45, size: 0.75, rtone: 0.75, width: 0.7 }), 0.95, 0.9],
   [part({ rate: 50, tone: 0.97, decay: 0.07, spread: 0.9, hp: 4500, atk: 0.003, dec: 0.5, sus: 0, rel: 0.1, dur: 0.6, width: 0.9, reverb: 0.4, size: 0.7 }), 0.96, 0.4]])];
ALT_IDEA["Mana Charge"] = ["a BUILD that lands: a shimmering cluster climbing an octave and a half, trembling faster, bell pings stepping up under it, then FULL: a bright bell and a sparkle"];
ALTS["Magic Missile"] = [() => sound(
  osc({ wave: 18, f: 1200, algo: 0, r2: 2.5, r3: 1, r4: 1, index: 0.45, fb: 0.2, fmEnv: 0.7, fmEnvTime: 0.08, sweep: -0.4, atk: 0.001, hold: 0.04, dec: 0.25, sus: 0, rel: 0.05, curve: 0.5, dur: 0.35,
    reverb: 0.3, size: 0.55, rtone: 0.7, width: 0.6, delay: 0.25, delayTime: 0.07, delayFb: 0.35 }),
  [[whoosh({ tone: 0.75, sweep: 0.9, body: 0.15, peak: 0.6, atk: 0.005, dec: 0, sus: 1, rel: 0.05, dur: 0.32, hp: 1500, width: 0.7 }), 0, 0.5],
   [bar({ f: 2637, type: 2, mallet: 0.7, ring: 0.3, repeat: 5, rate: 18, arp: -2, dur: 0.45, rel: 0.25, reverb: 0.35, size: 0.6, rtone: 0.8, width: 0.9 }), 0.04, 0.35],
   [imp({ tone: 0.6, decay: 0.08, punch: 0.9, grit: 0.1, dec: 0.05, rel: 0.08, dur: 0.4, boom: 0.4, boomFreq: 110, boomDrop: 0.6, boomDecay: 0.1, reverb: 0.35, size: 0.6 }), 0.3, 0.55]])];
ALT_IDEA["Magic Missile"] = ["a BOLT of light: an FM zap streaking down with a bright whoosh, a sparkling trail of glints, a small arcane pop where it hits"];
ALTS["Enchant"] = [() => sound(
  barM({ f: 784, type: 3, mallet: 0.3, ring: 0.9, motor: 0.6, repeat: 10, rate: 12, arp: 2, dur: 1.3, rel: 0.5, reverb: 0.5, size: 0.75, rtone: 0.75, width: 0.75, chorus: [0.3, 1.0] }),
  [[osc({ wave: 18, f: 523, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.25, fb: 0.1, vib: 0.01, vibRate: 5, phaser: [0.5, 0.6], atk: 0.25, hold: 0.4, dec: 0.5, sus: 0.3, rel: 0.4, dur: 1.5,
     reverb: 0.5, size: 0.75, width: 0.8 }), 0, 0.45],
   [glass({ f: 1568, brk: 0, mat: 1, thick: 0.12, striker: 1, gring: 0.55, beat: 0.6, pair: 0.9, pairTune: 0.6, seed: 419, dur: 1.15, reverb: 0.45, size: 0.75, rtone: 0.75, width: 0.6 }), 0.82, 0.55]])];
ALT_IDEA["Enchant"] = ["an item glowing with an enchantment: a vibraphone run whirling up (its motor turning), an FM glow under it, then a crystal \"shing\" as it takes"];
ALTS["Hex Bolt"] = [() => sound(
  osc({ wave: 18, f: 620, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.6, fb: 0.4, fmEnv: 0.6, fmEnvTime: 0.1, sweep: -0.5, ring: 0.45, ringF: 438, atk: 0.001, hold: 0.03, dec: 0.3, sus: 0.05, rel: 0.15,
    curve: 0.5, dur: 0.6, reverb: 0.35, size: 0.65, rtone: 0.35, width: 0.6, delay: 0.2, delayTime: 0.1, delayFb: 0.3 }),
  [[voice({ f: 220, vowel: 0.25, fsize: 1.3, breath: 1, lfo: [3, 0.6], hp: 1500, atk: 0.02, hold: 0.05, dec: 0.45, sus: 0, rel: 0.15, dur: 0.65, width: 0.8, reverb: 0.35, size: 0.65 }), 0.02, 0.5],
   [imp({ tone: 0.2, decay: 0.15, punch: 0.8, grit: 0.3, dec: 0.08, rel: 0.1, dur: 0.5, boom: 0.5, boomFreq: 70, boomDrop: 0.5, boomDecay: 0.15, reverb: 0.35, size: 0.65 }), 0.28, 0.5]])];
ALT_IDEA["Hex Bolt"] = ["a HEX: a dissonant FM zap dropping (a tritone ring under it), a hissing whisper riding it, a dull thud as it lands"];

// ============================================================================================================
// THE FAMILY: 26 names made of an ADJECTIVE x a NOUN (Arcane / Fae / Wyrd / Mystic / Ethereal / Radiant / Astral /
// Celestial / Runic / Glimmer / Prism / Enchanted / Shadow x Sigil / Shimmer / Glyph / Bloom / Weave / Rune / Whorl /
// Aura / Spark / Chime / Surge / Hymn). Sixteen were BRED at random in 2026-07 (3-decimal values) and are mutations of
// the named sounds above, whatever their names say (Shadow Hymn is a rising square zap, Fae Bloom and Glimmer Aura are
// Hex Bolt's copies, Glimmer Weave is Magic Fizzle's); ten were hand-made as additive pads, modal chimes and granular
// clouds that blur together (Ethereal Aura / Celestial Bloom 0.40 apart, Radiant Aura IS the Pads section's Angelic
// Wash). The name is the design: two tables, composed, as in scifi-redo.mjs.

// ADJ: the TREATMENT, the same on every noun. tone(o) the adjective's SUSTAINED voice, strike(o) its STRUCK voice
// (a noun picks which it needs); extra(c) the ONE layer the treatment adds over the whole event; chord the two
// intervals (semitones) a Hymn stacks on its root; fMul every pitch x this; tMul every time x this; lvl dB vs the median.
function ADJ_TABLE() {
  const S_ = (sp, o) => Object.assign({}, sp, o);
  const strikeEnv = (o, ring) => Object.assign({ atk: 0.001, hold: 0.004, dec: Math.min(1, ring), sus: 0, rel: 0.35, curve: 0.65, dur: o.dur || 1.4 }, o);
  return {
    // ARCANE: the classic magic: an inharmonic FM bell (1 : 3.5), phased; its signature a swirl of violet air
    Arcane: { fMul: 1, tMul: 1, lvl: 0, chord: [3, 8], sp: { reverb: 0.45, size: 0.75, rtone: 0.6, delay: 0.2, delayTime: 0.17, delayFb: 0.35 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 18, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.3, fb: 0.15, vib: 0.01, vibRate: 5, chorus: [0.3, 0.8], phaser: [0.45, 0.35, 0.8], width: 0.75 }, o))); },
      strike(o) { return osc(S_(this.sp, strikeEnv(Object.assign({ wave: 18, algo: 0, r2: 3.5, r3: 1, r4: 1, index: 0.5, fb: 0.1, fmEnv: 0.85, fmEnvTime: 0.15, width: 0.7 }, o), 1.0))); },
      extra(c) { return [osc(S_(this.sp, Object.assign({ wave: 0, f: 200, noise: 1, mode: 2, cut: cl(c.f * 2.5, 400, 8000), reso: 0.55, phaser: [0.7, 1.1, 0.9], trem: [0.3, 4], width: 0.9 }, c.shape))), 0, 0.4]; },
      idea: "the classic: an inharmonic FM bell (1 : 3.5), phased and chorused, a swirl of violet air (a resonant noise band through a phaser) around it" },
    // FAE: small and high and quick: a trembling triangle choir, glockenspiel strikes, fairy dust
    Fae: { fMul: 2, tMul: 0.9, lvl: -1, chord: [4, 7], sp: { reverb: 0.4, size: 0.6, rtone: 0.8, delay: 0.25, delayTime: 0.09, delayFb: 0.35, pingpong: 0.6 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 3, unison: 3, detune: 9, vib: 0.02, vibRate: 7.5, chorus: [0.4, 1.4], width: 0.85 }, o))); },
      strike(o) { return bar(S_(this.sp, Object.assign({ type: 2, mallet: 0.6, ring: 0.45, rel: 0.35, dur: o.dur || 1.0, width: 0.8 }, o))); },
      extra(c) { return [part(S_(this.sp, Object.assign({ rate: 25, tone: 0.98, decay: 0.04, spread: 0.95, hp: 5000, width: 0.95 }, c.shape))), 0, 0.35]; },
      idea: "small, high and quick: a trembling triangle choir, glockenspiel strikes, fairy dust twinkling over it, echoes bouncing left and right" },
    // WYRD: uncanny: a drifting, wavering additive tone; a bell with no harmony in it; a second voice a tritone off
    Wyrd: { fMul: 0.9, tMul: 1, lvl: 0, chord: [6, 11], sp: { reverb: 0.5, size: 0.8, rtone: 0.45, delay: 0.3, delayTime: 0.23, delayFb: 0.45 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 16, partials: 9, tilt: 0.5, drift: 0.9, driftRate: 1.8, adet: 0.9, vib: 0.05, vibRate: 2.3, width: 0.8 }, o))); },
      strike(o) { return modal(S_(this.sp, strikeEnv(Object.assign({ parts: 8, inharm: 0.92, ring: 1.2, bright: 0.6, width: 0.7 }, o), 0.8))); },
      extra(c) { return [c.struck ? this.strike(Object.assign({}, c.coreOpts, { f: c.f * semis(-6) })) : this.tone(Object.assign({}, c.coreOpts, { f: c.f * semis(-6), vib: 0.07, vibRate: 3.1 })), 0.05, 0.5]; },
      idea: "uncanny: a drifting, wavering additive tone, a bell with no harmony in it, and a second voice a tritone off the first, wavering at its own rate" },
    // MYSTIC: a singing bowl and a low hum: incense and ritual
    Mystic: { fMul: 0.75, tMul: 1.1, lvl: 0, chord: [5, 7], sp: { reverb: 0.55, size: 0.85, rtone: 0.4 },
      tone(o) { return voice(S_(this.sp, Object.assign({ vowel: 0.8, fsize: 0.85, fq: 0.6, breath: 0.25, ftilt: 0.2, vib: 0.01, vibRate: 4.5, lfo: [0.25, 0.15], width: 0.7 }, o))); },
      strike(o) { return modal(S_(this.sp, strikeEnv(Object.assign({ parts: 5, inharm: 0.12, ring: 2.6, bright: 0.35, width: 0.6 }, o), 1.4))); },
      extra(c) { return [modal(S_(this.sp, { f: Math.max(110, c.f * 0.5), parts: 5, inharm: 0.1, ring: 2.8, bright: 0.3, atk: 0.001, hold: 0.004, dec: 1.0, sus: 0, rel: 0.5, curve: 0.6, dur: c.span, width: 0.6 })), 0, 0.55]; },
      idea: "ritual: a low hummed \"ooh\" (a formant voice, its vowel slowly moving), a singing bowl struck under it and ringing long" },
    // ETHEREAL: air and light: a pure, soft, wide additive tone, a soft vibraphone, a breath of air through it all
    Ethereal: { fMul: 1.5, tMul: 1.1, lvl: -1, chord: [4, 9], sp: { reverb: 0.65, size: 0.9, rtone: 0.75, width: 0.95 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 16, partials: 6, tilt: 0.3, drift: 0.5, driftRate: 0.4, adet: 0.6, chorus: [0.5, 0.6] }, o))); },
      strike(o) { return bar(S_(this.sp, Object.assign({ type: 3, mallet: 0.15, ring: 0.8, rel: 0.5, dur: o.dur || 1.5 }, o))); },
      extra(c) { return [wind(S_(this.sp, Object.assign({ int: 0.35, gust: 0.4, gustRate: 0.6, tone: 0.75, body: 0.05, seed: c.seed, hp: 1500 }, c.shape))), 0, 0.4]; },
      idea: "air and light: a pure, soft, very wide additive tone, a soft-mallet vibraphone, a breath of air (gentle weather wind) through all of it, a big room" },
    // RADIANT: bright and warm: a brilliant many-partialed tone, sunlight glittering in it
    Radiant: { fMul: 1.25, tMul: 1, lvl: 0, chord: [4, 7], sp: { reverb: 0.5, size: 0.85, rtone: 0.85 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 16, partials: 24, tilt: 0.85, drift: 0.4, driftRate: 0.9, adet: 0.45, width: 0.8 }, o))); },
      strike(o) { return osc(S_(this.sp, strikeEnv(Object.assign({ wave: 18, algo: 0, r2: 2, r3: 1, r4: 1, index: 0.45, fmEnv: 0.7, fmEnvTime: 0.2, width: 0.7 }, o), 1.2))); },
      extra(c) { return [part(S_(this.sp, Object.assign({ rate: 40, tone: 0.97, decay: 0.15, spread: 0.9, hp: 5000, width: 0.95 }, c.shape))), 0, 0.3]; },
      idea: "bright and warm: a brilliant additive tone with twenty-four partials, a harmonic FM bell, sunlight glittering through it (fine high particle)" },
    // ASTRAL: deep space: a slow-phased detuned pad, starlight pings far off, long echoes crossing the sky
    Astral: { fMul: 1, tMul: 1.1, lvl: 0, chord: [7, 12], sp: { reverb: 0.5, size: 0.9, rtone: 0.6, delay: 0.35, delayTime: 0.28, delayFb: 0.5, pingpong: 0.9 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 2, unison: 5, detune: 14, cut: 2600, reso: 0.15, phaser: [0.55, 0.15, 0.9], width: 0.9 }, o))); },
      strike(o) { return bar(S_(this.sp, Object.assign({ type: 2, mallet: 0.85, ring: 0.3, rel: 0.4, dur: o.dur || 1.4, width: 0.7 }, o))); },
      extra(c) { return [bar(S_(this.sp, { f: cl(c.f * 3, 1200, 3500), type: 2, mallet: 0.9, ring: 0.25, repeat: 4, rate: r2(4 / Math.max(0.6, c.span * 0.7)), arp: -5, rel: 0.3, dur: c.span, width: 0.9 })), 0.1, 0.3]; },
      idea: "deep space: a slow-phased detuned saw pad, starlight pings far off (a high glockenspiel, stepping down in fourths), long echoes crossing left and right; its chords open fifths" },
    // CELESTIAL: heaven: a choir singing "aah", a great bell
    Celestial: { fMul: 1, tMul: 1, lvl: 0, chord: [4, 7], sp: { reverb: 0.6, size: 0.9, rtone: 0.7, conv: 0.25, convType: 1, convSize: 2.2, convTone: 0.6 },
      tone(o) { return voice(S_(this.sp, Object.assign({ vowel: 0, fsize: 1.05, fq: 0.55, breath: 0.15, ftilt: 0.45, vib: 0.012, vibRate: 5, chorus: [0.35, 0.7], width: 0.8 }, o))); },
      strike(o) { return modal(S_(this.sp, strikeEnv(Object.assign({ parts: 10, inharm: 0.28, ring: 2.2, bright: 0.55, width: 0.7 }, o), 1.4))); },
      extra(c) { return [this.tone(Object.assign({}, c.shape, { f: c.f * 1.5, vibRate: 5.4 })), 0.04, 0.6]; },
      idea: "heaven: a choir singing \"aah\" (formant voices, a fifth apart), a great bell, a hall" },
    // RUNIC: carved stone: a gritty hum through a band, a stone bar struck, a stone knock
    Runic: { fMul: 0.8, tMul: 1, lvl: 0, chord: [5, 10], sp: { reverb: 0.35, size: 0.7, rtone: 0.35 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 2, sub: 0.3, drive: 0.3, mode: 2, cut: cl((o.f || 300) * 3, 200, 6000), reso: 0.5, trem: [0.15, 3], width: 0.6 }, o))); },
      strike(o) { return modal(S_(this.sp, strikeEnv(Object.assign({ parts: 6, inharm: 0.25, ring: 0.6, bright: 0.3, noise: 0.2, color: 0.5, width: 0.6 }, o), 0.7))); },
      extra(c) { return [imp(S_(this.sp, { tone: 0.3, decay: 0.15, punch: 0.9, grit: 0.6, dec: 0.1, rel: 0.1, dur: 0.5, boom: 0.4, boomFreq: 90, boomDrop: 0.4, boomDecay: 0.1 })), Math.max(0, c.at), 0.6]; },
      idea: "carved stone: a gritty driven hum through a band, a stone bar struck (a dull, short modal ring with grit), a stone knock where it lands" },
    // GLIMMER: flickering light: a high sine choir flickering in and out, tiny glints
    Glimmer: { fMul: 2.5, tMul: 1, lvl: -1, chord: [4, 7], sp: { reverb: 0.45, size: 0.65, rtone: 0.85, delay: 0.25, delayTime: 0.07, delayFb: 0.4 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 0, unison: 3, detune: 10, flicker: [0.55, 18], chorus: [0.5, 2], vib: 0.008, vibRate: 9, width: 0.85 }, o))); },
      strike(o) { return modal(S_(this.sp, strikeEnv(Object.assign({ parts: 4, inharm: 0.5, ring: 0.25, bright: 0.95, width: 0.8 }, o), 0.3))); },
      extra(c) { return [part(S_(this.sp, Object.assign({ rate: 18, tone: 1, decay: 0.12, spread: 0.95, hp: 6000, width: 0.95 }, c.shape))), 0, 0.45]; },
      idea: "flickering light: a high, detuned sine choir flickering in and out at 18 Hz, tiny glints (the highest, sparsest particle) catching" },
    // PRISM: light split: a spread additive spectrum, crystal rings (glass 36 in Crystal)
    Prism: { fMul: 1.5, tMul: 1, lvl: 0, chord: [4, 7], sp: { reverb: 0.4, size: 0.7, rtone: 0.8 },
      tone(o) { return osc(S_(this.sp, Object.assign({ wave: 16, partials: 12, tilt: 0.75, drift: 0.3, driftRate: 1, adet: 0.95, width: 0.9 }, o))); },
      strike(o) { return glass(S_(this.sp, { f: o.f, brk: 0, mat: 1, thick: 0.15, striker: 0.95, gring: 0.6, beat: 0.5, pair: 0.85, pairTune: 1.1, seed: 401, dur: o.dur || 1.4, width: 0.6 })); },
      extra(c) { return [glass(S_(this.sp, { f: cl(c.f * 1.5, 300, 4000), brk: 0, mat: 1, thick: 0.12, striker: 1, gring: 0.55, beat: 0.6, pair: 0.9, pairTune: 0.6, seed: 419, dur: 1.3, width: 0.7 })), Math.max(0, c.at), 0.55]; },
      idea: "light split: an additive spectrum spread wide (detune at its maximum), crystal glasses ringing (glass 36 in Crystal, intact) where it lands" },
    // ENCHANTED: a music box come alive: a vibraphone with its motor turning, celesta tines
    Enchanted: { fMul: 1.5, tMul: 1, lvl: 0, chord: [4, 7], sp: { reverb: 0.45, size: 0.7, rtone: 0.7 },
      tone(o) { return barM(S_(this.sp, Object.assign({ type: 3, mallet: 0.3, ring: 0.95, motor: 0.7, width: 0.7 }, o))); },
      strike(o) { return bar(S_(this.sp, Object.assign({ type: 4, mallet: 0.5, ring: 0.5, rel: 0.35, dur: o.dur || 1.2, width: 0.7 }, o))); },
      extra(c) { return [bar(S_(this.sp, { f: cl(c.f * 2, 600, 3500), type: 4, mallet: 0.5, ring: 0.45, repeat: 4, rate: 5, arp: -3, rel: 0.35, dur: 1.2, width: 0.8 })), 0, 0.45]; },
      idea: "a music box come alive: a vibraphone with its motor turning (a slow tremolo in the ring), celesta tines, a little music-box figure stepping down" },
    // SHADOW: darkness: a low, breathy, dark choir "ooh", a dull bell, a whisper
    Shadow: { fMul: 0.5, tMul: 1.1, lvl: 0, chord: [3, 6], sp: { reverb: 0.6, size: 0.9, rtone: 0.25, delay: 0.25, delayTime: 0.31, delayFb: 0.4 },
      tone(o) { return voice(S_(this.sp, Object.assign({ vowel: 0.95, fsize: 0.7, fq: 0.6, breath: 0.45, ftilt: 0, vib: 0.02, vibRate: 4, cut: 1800, width: 0.7 }, o))); },
      strike(o) { return modal(S_(this.sp, strikeEnv(Object.assign({ parts: 6, inharm: 0.4, ring: 1.0, bright: 0.15, width: 0.6 }, o), 1.0))); },
      extra(c) { return [voice(S_(this.sp, Object.assign({ f: 220, vowel: 0.25, fsize: 1.3, breath: 1, lfo: [1.3, 0.5], hp: 1500, width: 0.9 }, c.shape))), 0, 0.45]; },
      idea: "darkness: a low, breathy, dark choir \"ooh\" (formant, a big tract, no brightness), a dull bell, a whisper (pure breath, its vowel moving), a dark room; its chords diminished" },
  };
}
const ADJ = ADJ_TABLE();
var ADJ_NAMES = Object.keys(ADJ);

// NOUN: the EVENT (for fMul 1, tMul 1). build(A, f, t) returns { layers: [[patch, delay, gain], ...], struck, coreOpts,
// at (the accent: where it lands), shape (the event's envelope, for the adjective's extra) }.
const T = (o, t) => Object.assign({}, o, { atk: Math.min(0.5, (o.atk || 0) * t), hold: (o.hold || 0) * t + Math.max(0, (o.atk || 0) * t - 0.5), dec: (o.dec || 0) * t, rel: (o.rel || 0) * t,
  dur: r2(Math.min(2, (o.dur || 1) * t)) });
const shapeOf = (p) => ({ atk: p.attack, hold: p.hold, dec: p.decay, sus: Math.max(p.sustain, 0.35), rel: p.release, dur: p.duration });
const NOUN = {
  // AURA: a glow that breathes in and stays; an octave halo swelling in after it
  Aura: { f: 330, lvl: -1, idea: "a glow breathing in and staying (2 s, a slow 0.7 Hz swell in it), the same voice an octave up blooming in half a second later, so it peaks late and brightens",
    build(A, f, t) { const o = T({ f, atk: 0.5, hold: 0.3, dec: 0.4, sus: 0.8, rel: 0.5, dur: 1.9, trem: [0.2, 0.7] }, t), core = A.tone(o);
      return { layers: [[core, 0, 1], [A.tone(T({ f: f * 2, atk: 0.5, hold: 0.4, dec: 0.2, sus: 0.7, rel: 0.3, dur: 1.4, trem: [0.3, 0.45] }, t)), 0.5 * t, 0.6]], coreOpts: o, at: 0, shape: shapeOf(core) }; } },
  // SHIMMER: a trembling texture: fast tremolo, a glitter of high drifting partials over it
  Shimmer: { f: 660, lvl: -1, idea: "a trembling texture (a deep 9 Hz tremolo, 1.6 s), a glitter of high, fast-drifting partials over it",
    build(A, f, t) { const o = T({ f, atk: 0.15, hold: 0.4, dec: 0.6, sus: 0.5, rel: 0.4, dur: 1.6, trem: [0.65, 9] }, t), core = A.tone(o), sh = shapeOf(core);
      return { layers: [[core, 0, 1], [osc(Object.assign({ wave: 16, f: cl(f * 3, 300, 4000), partials: 6, tilt: 0.7, drift: 1, driftRate: 2, adet: 1, trem: [0.6, 13], width: 0.95 }, A.sp, sh)), 0, 0.3]], coreOpts: o, at: 0, shape: sh }; } },
  // BLOOM: a swell opening outward, peaking late, its "petals" (the struck voice, leaping up in fourths) at the peak
  Bloom: { f: 392, lvl: 0, idea: "a swell opening outward (its filter opening, peaking at 1 s), then its petals: the struck voice leaping up in fourths at the peak",
    build(A, f, t) { const o = T({ f, atk: 0.5, hold: 0.45, dec: 0.5, sus: 0.3, rel: 0.4, dur: 1.8, curve: 0.6, sweep: 0.08, fenv: 0.6, cut: 2500 }, t), core = A.tone(o);
      return { layers: [[core, 0, 1], [A.strike({ f: f * 2, repeat: 5, rate: 9, arp: 5, dur: 1.0 }), 0.85 * t, 0.5]], coreOpts: o, at: 0.85 * t, shape: shapeOf(core) }; } },
  // WEAVE: two voices crossing, one rising and one falling, trembling at different rates (a fifth apart at the start)
  Weave: { f: 523, lvl: 0, idea: "two voices crossing, one rising, one falling from a fifth above, trembling at different rates (6 and 4.5 Hz)",
    build(A, f, t) { const o = T({ f, atk: 0.1, hold: 0.4, dec: 0.4, sus: 0.4, rel: 0.3, dur: 1.3, sweep: 0.25, trem: [0.5, 6] }, t), core = A.tone(o);
      return { layers: [[core, 0, 1], [A.tone(Object.assign({}, o, { f: f * 1.5, sweep: -0.25, trem: [0.5, 4.5] })), 0.04, 0.8]], coreOpts: o, at: 0, shape: shapeOf(core) }; } },
  // WHORL: a spiral: the pitch circling (a slow, wide vibrato), a fast phaser, swirling air turning with it
  Whorl: { f: 294, lvl: 0, idea: "a spiral: the pitch circling (a wide 2.6 Hz vibrato), a fast phaser and a tremolo turning with it, swirling air (a phased whoosh) around it",
    build(A, f, t) { const o = T({ f, atk: 0.3, hold: 0.3, dec: 0.5, sus: 0.5, rel: 0.4, dur: 1.6, vib: 0.08, vibRate: 2.6, phaser: [0.8, 1.6, 0.95], trem: [0.35, 2.6] }, t), core = A.tone(o), sh = shapeOf(core);
      return { layers: [[core, 0, 1], [whoosh(Object.assign({ tone: 0.5, sweep: 0.6, body: 0.4, peak: 0.5, phaser: [0.8, 2.0, 0.9], trem: [0.4, 2.6], width: 0.9 }, A.sp, sh, { sus: 1 })), 0, 0.5]], coreOpts: o, at: 0, shape: sh }; } },
  // HYMN: a sung chord: the root, then the adjective's two intervals entering a beat apart, held
  Hymn: { f: 262, lvl: 0, idea: "a sung chord: the root, then the treatment's two intervals entering one after another, a fifth of a second apart, held (1.9 s)",
    build(A, f, t) { const o = T({ f, atk: 0.35, hold: 0.6, dec: 0.4, sus: 0.6, rel: 0.5, dur: 1.9 }, t), core = A.tone(o);
      const up = (k) => A.tone(Object.assign({}, o, { f: f * semis(A.chord[k]), vibRate: (o.vibRate || 5) + 0.4 * (k + 1), dur: r2(o.dur - 0.22 * (k + 1)) }));
      return { layers: [[core, 0, 1], [up(0), 0.22 * t, 0.75], [up(1), 0.44 * t, 0.7]], coreOpts: o, at: 0, shape: shapeOf(core) }; } },
  // SURGE: swelling in a quarter second, a jolt (a boom) at the peak, sagging and falling away
  Surge: { f: 349, lvl: 1, idea: "a swell in a quarter second, a jolt at the peak (an impact with a boom), then sagging and falling away",
    build(A, f, t) { const o = T({ f, atk: 0.25, hold: 0.06, dec: 0.7, sus: 0.15, rel: 0.3, dur: 1.4, sweep: -0.2, fenv: -0.4, curve: 0.5 }, t), core = A.tone(o), at = core.attack;
      return { layers: [[core, 0, 1], [imp({ tone: 0.3, decay: 0.25, punch: 0.9, grit: 0.2, dec: 0.15, rel: 0.2, dur: 0.8, boom: 0.6, boomFreq: 60, boomDrop: 0.6, boomDecay: 0.3, reverb: 0.35, size: 0.7 }), Math.max(0, at - 0.02), 0.6]],
        coreOpts: o, at, shape: shapeOf(core) }; } },
  // SIGIL: a mark traced and sealed: the stroke (the sustained voice sweeping up, quick), then the struck voice sealing it
  Sigil: { f: 784, lvl: 0, idea: "a mark traced and sealed: a stroke (the treatment's tone sweeping up in 0.2 s), then its struck voice sealing it",
    build(A, f, t) { const o = T({ f: f * 0.5, sweep: 0.7, atk: 0.18, hold: 0, dec: 0.08, sus: 0, rel: 0.04, dur: 0.3, curve: 0.5 }, t), stroke = A.tone(o), at = 0.2 * t;
      const s = A.strike({ f, dur: 1.3 });
      return { layers: [[stroke, 0, 1], [s, at, 1.0]], struck: true, coreOpts: { f, dur: 1.3 }, at, shape: { atk: 0.01, hold: 0.1, dec: 0.8, sus: 0, rel: 0.3, dur: r2(1.2 + at) } }; } },
  // GLYPH: a small mark: two quick struck notes a fourth apart, a tiny breath of air
  Glyph: { f: 1047, lvl: -2, idea: "a small mark: two quick struck notes a fourth apart, a tiny breath of air with them",
    build(A, f, t) { const s = A.strike({ f, repeat: 2, rate: 7, arp: 5, dur: 0.8 });
      return { layers: [[s, 0, 1], [whoosh({ tone: 0.8, sweep: 0.7, body: 0.05, peak: 0.3, atk: 0.005, dec: 0, sus: 1, rel: 0.05, dur: 0.22, hp: 2500, width: 0.8 }), 0, 0.3]], struck: true,
        coreOpts: { f, repeat: 2, rate: 7, arp: 5, dur: 0.8 }, at: 0, shape: { atk: 0.005, hold: 0.1, dec: 0.4, sus: 0, rel: 0.15, dur: 0.7 } }; } },
  // RUNE: a rune waking: struck, then a hum glowing up under it an octave down
  Rune: { f: 440, lvl: 0, idea: "a rune waking: struck, then the treatment's tone glowing up under it an octave down (a 5 Hz tremolo in it)",
    build(A, f, t) { const s = A.strike({ f, dur: 1.5 }), o = T({ f: f * 0.5, atk: 0.2, hold: 0.3, dec: 0.5, sus: 0.3, rel: 0.4, dur: 1.4, trem: [0.3, 5] }, t), hum = A.tone(o);
      return { layers: [[s, 0, 1], [hum, 0.03, 0.6]], struck: true, coreOpts: { f, dur: 1.5 }, at: 0, shape: shapeOf(hum) }; } },
  // CHIME: struck, and a softer second strike a fifth up
  Chime: { f: 880, lvl: 0, idea: "struck, then a softer second strike a fifth up",
    build(A, f, t) { const s = A.strike({ f, dur: 1.6 });
      return { layers: [[s, 0, 1], [A.strike({ f: f * 1.5, dur: 1.3 }), 0.38 * t, 0.6]], struck: true, coreOpts: { f, dur: 1.6 }, at: 0, shape: { atk: 0.005, hold: 0.2, dec: 1.0, sus: 0, rel: 0.3, dur: 1.6 } }; } },
  // SPARK: a burst: three quick struck notes leaping a fifth each, a crackle of sparks
  Spark: { f: 1319, lvl: -1, idea: "a burst: three quick struck notes leaping up a fifth each, a crackle of sparks with them",
    build(A, f, t) { const s = A.strike({ f, repeat: 3, rate: 18, arp: 7, dur: 0.6 });
      return { layers: [[s, 0, 1], [part(Object.assign({ rate: 70, tone: 0.9, decay: 0.05, spread: 0.9, atk: 0.005, dec: 0.35, sus: 0, rel: 0.1, dur: 0.45, width: 0.9 }, A.sp)), 0, 0.6]], struck: true,
        coreOpts: { f, repeat: 3, rate: 18, arp: 7, dur: 0.6 }, at: 0, shape: { atk: 0.005, hold: 0.05, dec: 0.35, sus: 0, rel: 0.1, dur: 0.5 } }; } },
};
var NOUN_NAMES = Object.keys(NOUN);
const FAMILY = SECTION.filter((n) => { const [a, b] = n.split(" "); return b && ADJ_NAMES.includes(a) && NOUN_NAMES.includes(b); });
for (const n of FAMILY) S[n] = () => compose(n);
function compose(name) {
  const [a, n] = name.split(" "), A = ADJ[a], N = NOUN[n];
  const f = cl(N.f * A.fMul, 80, 3200), b = N.build(A, f, A.tMul);
  const span = Math.max(...b.layers.map(([p, d]) => d + p.duration));
  const x = A.extra({ f, at: b.at, shape: b.shape, coreOpts: b.coreOpts, struck: !!b.struck, span: r2(Math.min(2, span)), seed: seedOf(name) });
  const layers = b.layers.concat([x]);
  // the whole sound within 2 s: a layer that would run past it ends at 2 s (its release starting earlier)
  for (const L of layers) if (L[1] + L[0].duration > 2) L[0].duration = r2(2 - L[1]);
  if (layers.length > 4) throw new Error(name + ": " + layers.length + " layers");
  return sound(layers[0][0], layers.slice(1));
}

// _vary: the PRESET BUTTON jitters layer 1 only (a preset with _alts never reaches it: its versions ARE the variety, but
// Variations and Breed still read it); a pitch lightly where another layer is tied to it, its colour more
function varyFor(p) {
  const w = Math.round(p.wave), v = {};
  if (w === 20) return { whooshTone: 0.1, whooshSweep: 0.15, whooshPeak: 0.1 };
  if (w === 29) return { wxSeed: 1, wxTone: 0.06 };
  if (w === 31) return { blastSeed: 1, blastSize: 0.08 };
  if (w === 36) return { glSeed: 1, freq: 0.06, glRing: 0.1 };
  if (w === 15) return { particleRate: 0.15, particleTone: 0.05 };
  if (w === 14) return { freq: 0.1, bubbleRate: 0.2, bubbleSpread: 0.15 };
  if (w === 19) return { impactTone: 0.1, impactDecay: 0.2 };
  v.freq = 0.04;
  if (w === 10) v.modalInharm = 0.1;
  if (w === 24) v.barMallet = 0.15;
  if (w === 13) v.formantVowel = 0.08;
  if (w === 16) v.addDrift = 0.2;
  if (w === 18) v.fmIndex = 0.12;
  if (p.cutoff < 12000 && p.filterMode !== 1) v.cutoff = 0.12;
  if (p.sweep) v.sweep = 0.12;
  if (p.repeat) v.rate = 0.08;
  return v;
}

// today's sound KEPT AS AN ALT under a redesigned base: it holds up as the "synth'd version" (AJ: "someone may actually be
// looking for a more synth'd version"), so it stays one click away. Left out where it duplicates another preset
// (Healing Aura IS Choir Aah, Radiant Aura IS Angelic Wash) or is a bred mutation of a neighbour (the 3-decimal family).
const TODAY_ALT = new Set(["Teleport", "Teleport 2", "Stardust Chime", "Cure", "Poison", "Frost Bolt", "Lightning Strike", "Arcane Blast", "Holy Smite", "Dark Curse",
  "Magic Fizzle", "Ice", "Curse Whoosh", "Shield Cast", "Summon Portal",
  "Arcane Shimmer", "Ethereal Aura", "Celestial Bloom", "Runic Chime", "Glimmer Whorl", "Arcane Chime", "Ethereal Spark", "Shadow Shimmer", "Astral Chime"]);
const KEEP_BASE = Object.keys(ALTS).filter((n) => !S[n]);   // today's base, new alts beside it
const KEPT = {
  "Fireball Cast": "redesigned in the fire round (weather 29's roar, a whoosh, a blast and crackle) and picked there; nothing to add",
};
const IDEA = {
  "Teleport": "VANISHING: a shimmering cluster rising and trembling, glockenspiel sparks climbing through it, then the air rushing into where it stood (a whoosh, a soft pop)",
  "Teleport 2": "ARRIVING (Teleport's mirror): the pop and the air pushed aside first, then the shimmer falling and stilling, the sparks stepping down",
  "Stardust Chime": "a cascade of tiny bells falling in whole steps, echoing left and right, dust twinkling over it, today's shimmer quietly under it",
  "Cure": "a status cured: a quick major arpeggio up on glockenspiel (C E G C), a soft glow swelling, a sparkle at the top",
  "Healing Aura": "a warm glow breathing in and staying: a soft pad on C, its fifth entering after, a vibraphone with its motor turning, motes of light drifting",
  "Poison": "poisoned: sickly low bubbles with a sour wobble, a detuned pulse drooping, a hiss of vapor",
  "Frost Bolt": "a cold bright streak (a fast high whoosh, the crystalline tone falling), then the HIT: a shard of ice bursting (glass 36 in Ice), frost crackling",
  "Ice": "freezing over (the Wizard's pick): ice cracking as it spreads (fast high ticks), a cold wind, then the ice set solid ringing (glass 36 in Ice, intact, warbling), frost fizzing",
  "Lightning Strike": "a bolt striking close: the electric arc crackling and its zap, then the thunder itself (weather 29 in Thunder, close, rolling off)",
  "Arcane Blast": "a spell going off: a small sharp blast (blast 31), an inharmonic FM bell cluster struck hard and falling, its sparks scattering (falling glints, a crackle)",
  "Holy Smite": "judgment from above: a great FM bell struck, a choir answering on the chord (two voices a fifth apart), a bright impact with a deep boom",
  "Dark Curse": "a curse laid: a low choir moaning \"ooh\" and sinking, a second voice a tritone off, a whispering hiss, a deep blow of doom under the start",
  "Wind Slash": "a blade of air: a fast bright slash, the air WHISTLING off its edge (an edge tone at 1.7 kHz), the wind it leaves gusting away",
  "Magic Fizzle": "a spell failing: the tone sputtering out and falling, its last sparks dying, a sad two-note droop on a bell (a tritone down), a puff of smoke",
  "Curse Whoosh": "a curse flying past: a dark phased whoosh carrying a ghostly \"ooh\" sliding down (ring-modded off-key), a whisper trailing it",
  "Shield Cast": "a barrier going up: a \"vwomm\" rising into place, then it LOCKS with a crystal ring (glass 36 in Crystal, two pieces warbling), its hum holding, a sparkle as it seals",
  "Summon Portal": "a gateway tearing open: a vortex of wind swirling (two hollow whistles), the rift's ring-modded drone throbbing, a deep whoomph as it opens, the otherworld's shimmer pouring through",
};
// Per-sound level offset from the section median, by design (dB). Family offsets come from the tables (adj.lvl + noun.lvl).
const LEVEL_OFFSET = { "Arcane Blast": 2, "Lightning Strike": 2, "Holy Smite": 1.5, "Dark Curse": 1, "Summon Portal": 1, "Frost Bolt": 0.5, "Cure": -1, "Stardust Chime": -1.5,
  "Magic Fizzle": -1, "Poison": -0.5, "Teleport": 0, "Teleport 2": 0, "Wind Slash": 0, "Healing Aura": -1, "Ice": 0, "Shield Cast": 0, "Curse Whoosh": 0,
  "Magic Sparkle": -1, "Magic Sparkle 2": -1.5, "Magic Missile": 0, "Hex Bolt": 0, "Mana Charge": 0, "Enchant": -0.5, "Chord Swell": -0.5 };
const VARY = {
  "Teleport": { freq: 0.08, addDriftRate: 0.2, sweep: 0.12 },
  "Teleport 2": { freq: 0.08, addDriftRate: 0.2, sweep: 0.12 },
  "Stardust Chime": { freq: 0.1, rate: 0.12, barMallet: 0.2 },
  "Cure": { freq: 0.06, barMallet: 0.15, rate: 0.08 },
  "Healing Aura": { freq: 0.06, addDrift: 0.15, addDriftRate: 0.2 },
  "Poison": { freq: 0.12, bubbleRate: 0.2, vibRate: 0.2 },
  "Frost Bolt": { whooshTone: 0.06, whooshSweep: 0.12, whooshPeak: 0.1 },
  "Ice": { impactTone: 0.05, rate: 0.12 },
  "Lightning Strike": { wxSeed: 1, wxRoll: 0.15, wxCrackle: 0.1 },
  "Arcane Blast": { blastSeed: 1, blastSize: 0.1, blastRoar: 0.15 },
  "Holy Smite": { freq: 0.06, fmIndex: 0.12, fmEnvTime: 0.2 },
  "Dark Curse": { freq: 0.08, formantVowel: 0.06, vibRate: 0.2 },
  "Wind Slash": { whooshTone: 0.08, whooshSweep: 0.1, whooshPeak: 0.15 },
  "Magic Fizzle": { freq: 0.12, flickerRate: 0.2, sweep: 0.12 },
  "Curse Whoosh": { whooshTone: 0.1, whooshPeak: 0.12, whooshBody: 0.12 },
  "Shield Cast": { freq: 0.08, sweep: 0.12, phaserRate: 0.2 },
  "Summon Portal": { wxSeed: 1, wxGust: 0.12, wxTone: 0.06 },
};
for (const n of FAMILY) { const [a, b] = n.split(" "); IDEA[n] = "[" + a + "] " + ADJ[a].idea.split(":")[0] + " x [" + b + "] " + NOUN[b].idea; }
for (const n of KEEP_BASE) IDEA[n] = "TODAY'S SOUND KEPT AS THE BASE; new version(s) beside it";

if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e), r = render(p); console.log(fmt(measure(r)) + "\n      " + curve(r)); } process.exit(0); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "magic-redo"), jsonDir = join(ROOT, "tools", "new-presets");
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
// The Limiter puts DC into low asymmetric pulses (a boom, a rumble): step it down until |DC| is within 2e-4
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
const REDO = SECTION.filter((n) => S[n] || ALTS[n]);
const lvlOf = (name) => FAMILY.includes(name) ? (ADJ[name.split(" ")[0]].lvl || 0) + (NOUN[name.split(" ")[1]].lvl || 0) : (LEVEL_OFFSET[name] || 0);
const varyOf = (name, p) => VARY[name] || varyFor(p);
const only = arg && arg !== "sep" ? arg : null;
if (only && !REDO.some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + REDO.map(slug).join(", ")); process.exit(1); }
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {}, altRows = [];
console.log("Magic median " + TARGET.toFixed(1) + " LUFS (the level target)");
const fmtLv = (p, m, tgt) => (p.layers ? JSON.parse(p.layers).length + 1 : 1) + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
  ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")";
for (const name of REDO) {
  const s = slug(name);
  if (only && only !== s) continue;
  const tgt = TARGET + lvlOf(name), now = refRow(name), keep = !S[name];
  let p, m, r;
  if (keep) { p = today(name); r = render(p); m = now.m; }
  else { p = S[name](); durCheck(name, p); m = level(p, tgt); r = render(p); }
  const alts = (ALTS[name] || []).map((fn, i) => { const a = fn(); durCheck(name + " alt " + (i + 1), a); const am = level(a, tgt); const ar = render(a); altRows.push({ name, i, p: a, r: ar, m: am, f: features(am) }); return a; });
  if (!keep && TODAY_ALT.has(name)) alts.push(today(name));
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    if (!keep) wav(s + "-2-new.wav", r, name);
    altRows.filter((x) => x.name === name).forEach((x) => wav(s + "-alt" + (x.i + 1) + ".wav", x.r, name + " (alt " + (x.i + 1) + ")"));
  }
  json[name] = keep ? asPreset(p, PRESETS[name]._vary || varyFor(p), alts) : asPreset(p, varyOf(name, p), alts);
  for (const k of Object.keys(json[name]._vary)) if (!PRANGE[k]) console.log("  !! " + name + " _vary: " + k + " is not a PARAMS row");
  rows.push({ name, slug: s, p, r, m, f: features(m), now, keep });
  console.log(name.padEnd(18) + (keep ? "KEPT AS BASE" : "NEW " + fmt(m) + "\n      " + fmtLv(p, m, tgt)) +
    altRows.filter((x) => x.name === name).map((x) => "\n  " + "".padEnd(12) + "ALT" + (x.i + 1) + " " + fmt(x.m).replace(/\n/g, "\n    ") + "\n      " + fmtLv(x.p, x.m, tgt)).join("") +
    (!keep && TODAY_ALT.has(name) ? "\n  " + "".padEnd(12) + "(today's kept as the last alt)" : "") +
    "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
  if (only) console.log("      " + curve(r));
}
if (only) process.exit(0);

// ---- separation: the whole section as it would ship (new where redesigned, today's where kept), plus the neighbours in
// other sections (REFS)
const shipped = SECTION.map((n) => rows.find((x) => x.name === n) || Object.assign({ kept: true }, refRow(n))).concat(REFS.map((n) => Object.assign({ ref: true }, refRow(n))));
const D = (a, b, set) => { const x = set.find((q) => q.name === a), y = set.find((q) => q.name === b); return [dist(x.f, y.f), why(x.f, y.f)]; };
const todaySet = SECTION.map((n) => refRow(n)).concat(REFS.map((n) => refRow(n)));
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or body, or a clear shape step) — NEW (today)");
const GROUPS = [["Teleport", "Teleport 2", "Teleporter Hum"], ["Magic Sparkle", "Magic Sparkle 2", "Stardust Chime", "Pixie Dust", "Cure", "Glimmer Aura", "Fae Glyph"],
  ["Frost Bolt", "Ice", "Glass Shatter", "Prism Surge"], ["Lightning Strike", "Thunder", "Electric Sparks", "Wyrd Spark", "Ethereal Spark"],
  ["Arcane Blast", "Holy Smite", "Fireball Cast", "Prism Surge"], ["Dark Curse", "Curse Whoosh", "Hex Bolt", "Shadow Hymn", "Shadow Shimmer", "Poison"],
  ["Healing Aura", "Ethereal Aura", "Radiant Aura", "Astral Aura", "Glimmer Aura", "Choir Aah", "Angelic Wash", "Chord Swell"],
  ["Celestial Bloom", "Wyrd Bloom", "Enchanted Bloom", "Fae Bloom", "Holy Smite"], ["Runic Chime", "Arcane Chime", "Astral Chime", "Stardust Chime"],
  ["Arcane Sigil", "Arcane Shimmer", "Arcane Weave", "Arcane Rune", "Arcane Chime"], ["Mystic Whorl", "Glimmer Whorl", "Summon Portal"],
  ["Arcane Weave", "Glimmer Weave", "Enchant"], ["Arcane Rune", "Ethereal Rune", "Arcane Sigil", "Fae Glyph"], ["Shadow Hymn", "Astral Hymn", "Holy Smite"],
  ["Arcane Shimmer", "Shadow Shimmer", "Shimmer Wash"], ["Mana Charge", "Magic Missile", "Magic Fizzle", "Wind Slash", "Shield Cast", "Enchant"]];
for (const g of GROUPS) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
  const [d, w] = D(g[i], g[j], shipped), [d0] = D(g[i], g[j], todaySet);
  console.log("  " + d.toFixed(2) + " (" + d0.toFixed(2) + ")  " + g[i] + " / " + g[j] + "   (" + w + ")");
}
for (const a of altRows) { const base = rows.find((x) => x.name === a.name); console.log("  " + dist(a.f, base.f).toFixed(2) + "  " + a.name + " / its alt " + (a.i + 1) + "   (" + why(a.f, base.f) + ")"); }
const all = []; for (let i = 0; i < shipped.length; i++) for (let j = i + 1; j < shipped.length; j++) all.push([shipped[i].name, shipped[j].name, dist(shipped[i].f, shipped[j].f), why(shipped[i].f, shipped[j].f)]);
all.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as shipped (the section + " + REFS.join(", ") + "):"); for (const [a, b, d, w] of all.slice(0, 16)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
const todayPairs = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) todayPairs.push(dist(refRow(SECTION[i]).f, refRow(SECTION[j]).f));
const secPairs = all.filter(([a, b]) => SECTION.includes(a) && SECTION.includes(b)).map((x) => x[2]);
console.log("  section median pair " + median(secPairs).toFixed(2) + ", min " + Math.min(...secPairs).toFixed(2) + "; TODAY median " + median(todayPairs).toFixed(2) + ", min " + Math.min(...todayPairs).toFixed(2));
const every = rows.filter((x) => !x.keep).concat(altRows);
const over2 = every.filter((x) => x.m.sec > 2.001).map((x) => x.name + (x.i != null ? " alt" + (x.i + 1) : "") + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges (new + alts): audible " + Math.min(...every.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...every.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...every.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...every.map((x) => x.m.lufs)).toFixed(1) + " (target " + TARGET.toFixed(1) + "); peaks max " +
  Math.max(...every.map((x) => x.m.peak)).toFixed(3) + ", clipping " + every.filter((x) => x.m.clip).length + ", |DC| max " +
  Math.max(...every.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1) + "; centroids " +
  Math.min(...every.map((x) => x.m.cent)).toFixed(0) + "-" + Math.max(...every.map((x) => x.m.cent)).toFixed(0) + " Hz");
console.log("  over 2 s: " + (over2.join(", ") || "none"));
const lvShip = shipped.filter((x) => !x.ref).map((x) => x.m.lufs).sort((a, b) => a - b);
console.log("  section as shipped: median " + median(lvShip).toFixed(1) + " LUFS, range " + lvShip[0].toFixed(1) + " to " + lvShip[lvShip.length - 1].toFixed(1));
console.log("  before/after loudness (new - now, dB): " + rows.filter((x) => !x.keep).map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (section order, ~0.4 s apart; a kept base contributes its new alts)
writeFileSync(join(jsonDir, "magic-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR);
const tour = [];
for (const x of rows) { if (!x.keep) tour.push({ name: x.name, r: x.r, idea: IDEA[x.name] }); altRows.filter((a) => a.name === x.name).forEach((a) => tour.push({ name: x.name + " (alt " + (a.i + 1) + ")", r: a.r, idea: ALT_IDEA[x.name][a.i] })); }
let total = 0; for (const x of tour) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
tour.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(24) + x.idea); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Magic redo, all new");
const lv = rows.map((x) => "  " + x.name.padEnd(18) + "now " + x.now.m.lufs.toFixed(1) + (x.keep ? "  (base kept)        " : "  new " + x.m.lufs.toFixed(1) + " LUFS  (" + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + " dB)") +
  altRows.filter((a) => a.name === x.name).map((a) => "   alt" + (a.i + 1) + " " + a.m.lufs.toFixed(1)).join(""));
const altLines = altRows.map((a) => "- **" + a.name + "**, `" + slug(a.name) + "-alt" + (a.i + 1) + ".wav`: " + ALT_IDEA[a.name][a.i]);
const tables = "## The family (" + FAMILY.length + " names, two tables composed)\n\nAdjective = the treatment:\n\n" + Object.entries(ADJ).filter(([k]) => FAMILY.some((n) => n.startsWith(k + " "))).map(([k, v]) => "- **" + k + "**: " + v.idea).join("\n") +
  "\n\nNoun = the event:\n\n" + Object.entries(NOUN).map(([k, v]) => "- **" + k + "**: " + v.idea).join("\n") + "\n\n";
writeFileSync(join(wavDir, "KEY.md"), "# Magic redo — all-new.wav: the " + rows.filter((x) => !x.keep).length + " redesigned sounds and every new alt, in section order, 0.4 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it, <slug>-2-new.wav the redesign, <slug>-alt<N>.wav a new\n" +
  "# version beside it (a different archetype, not a variation); all Normalize on, NOT loudness-matched (each is what its\n" +
  "# button plays). The new ones aim at the section's median, " + TARGET.toFixed(1) + " LUFS, with stated offsets (the blasts, the smite\n" +
  "# and the strike over; the sparkles, the glyphs and the auras under), at most Limiter " + LIMIT_MAX + ".\n" +
  "# Where a base is redesigned and today's still holds up as the synth'd version, today's is kept as the LAST alt\n" +
  "# (listed below), so clicking the button again still reaches it.\n\n```\n" + key.join("\n") + "\n```\n\n" +
  "## Kept as the base, new versions beside it (" + KEEP_BASE.length + ")\n\n" + altLines.join("\n") + "\n\n" +
  "## Today's kept as an alt under the new base (" + [...TODAY_ALT].filter((n) => json[n]).length + ")\n\n" + [...TODAY_ALT].filter((n) => json[n]).join(", ") +
  "\n\nLeft out on purpose: Healing Aura (it was Choir Aah, Pads, note for note), Radiant Aura (Angelic Wash, Pads, note for note), Wind Slash (a filtered\nnoise sweep the wind engine replaces), and the sixteen BRED family names (mutations of Hex Bolt, Magic Fizzle, Teleport 2, Enchant… under names they never matched).\n\n" + tables +
  "## Loudness, before and after (BS.1770; a big gap makes the louder one sound better, so listen past it)\n\n```\n" + lv.join("\n") + "\n```\n\n" +
  "## KEPT AS IS (no file: today's sound stays)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + rows.filter((x) => !x.keep).length + " redesigns + " + altRows.length + " new alts, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, magic-redo.json");
