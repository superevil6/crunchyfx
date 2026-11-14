/* doors-redo.mjs — the DOORS / CONTAINERS presets redesigned as sequences of mechanical events. PROPOSAL / A-B material:
 * nothing here is wired into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better. AJ: this
 * category is "pretty weak". Today's sound is always a valid outcome, and the KEPT list says why.
 *
 *   node tools/proto/doors-redo.mjs            renders every redesign (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/doors-redo.mjs ref        measures today's 21 (the level bar: their median and spread)
 *   node tools/proto/doors-redo.mjs sep        separation only (renders the new ones, prints the named pairs and the closest)
 *   node tools/proto/doors-redo.mjs <slug>     one redesign, measured, its WAVs written (no JSON, no all-new.wav)
 *   node tools/proto/doors-redo.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/doors-redo.mjs x '<js>' ...         measure patches built with the voices below (imp(), modal(), S["Door Knock"]() ...)
 *
 * THE QUESTION PER SOUND is what happens MECHANICALLY, in order, and what each event is made of:
 *   a knock or a slam is a CONTACT (impact, 19: the knuckle, the edge hitting the frame) exciting a RESONANT BODY (the
 *     panel: modal, 10 — a wooden door rings low, dense and short; a steel locker thin, inharmonic and long) and the
 *     frame around it (a rattle, a latch's clack), in a ROOM (convolution or the reverb). The impact engine alone is noise
 *     with no pitched body: a knock with no wood in it reads as a tap on nothing.
 *   a creak, a scrape, a slide is STICK-SLIP (friction, 34): Hinged wood for a door's hinge, Iron for a gate's or a
 *     vault's, Wood for a drawer's runners.
 *   a motor (an automatic door, a vault's bolt drive) is the SERVO engine (33): one shaft, its whine and its gears.
 *   small metal (keys, a chain, a bell, a tumbler's ring) is MODAL, several layers at their own pitches and times so no two
 *     strikes are identical (a `repeat` burst replays one strike exactly).
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, Normalize ON and NOT loudness-matched:
 * each WAV is what the app's button plays. `gain` on layer 1 (the whole sound's master gain) is the one number not from a
 * design: it lands the integrated loudness on today's Doors / Containers median plus a stated per-sound offset (a latch
 * click is small, a vault door big); a Limiter only where gain 1 cannot reach it.
 *
 * MEASUREMENT: loudness is BS.1770 (K-weighted, gated). Brightness is a FULL 4096-point FFT (every bin to 16 kHz), not the
 * 100 Hz-spaced probe bins of fire-redo / creature-redo-family, which miss a tonal partial falling between two probes;
 * the strongest FFT peak in the first 150 ms after the onset is printed too (the BODY: a wooden door's panel mode, a
 * locker's ring), so a design that claims a body can be checked for one.
 *
 * Writes soundtests/doors-redo/<slug>-1-now.wav, <slug>-2-new.wav (+ -alt<N>.wav), all-new.wav + KEY.md, and
 * tools/new-presets/doors-redo.json ({ name: patch with _vary, optional _alts, layers last }).
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
const SECTION = CATS.find((c) => c[0] === "Doors / Containers")[1];
const REFS = ["Creaking Door", "Floorboard Creak"];   // friction neighbours in other sections, in the separation set

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
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R),
    cent: cd ? cn / cd : 0, lo: cd ? blo / cd : 0, hi: cd ? bhi / cd : 0, cmove, texture, atk, maxAt: imx * 0.02 - Math.max(0, first) / SR, end80,
    bursts, f0: f0med, tonal, bodyHz: bd.hz, bodyDb: bd.prom };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1) +
    "\n      centroid " + (m.cent / 1000).toFixed(2) + "k (moves " + (m.cmove >= 0 ? "+" : "") + m.cmove.toFixed(2) + " oct)  <250Hz " + (100 * m.lo).toFixed(0) +
    "%  >4k " + (100 * m.hi).toFixed(0) + "%  body " + m.bodyHz.toFixed(0) + " Hz (+" + m.bodyDb.toFixed(0) + " dB)  pitch " + (m.f0 ? m.f0.toFixed(0) + " Hz (tonal " + (100 * m.tonal).toFixed(0) + "%)" : "none") +
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
    Math.log2(m.atk) / 1.5, 2 * cl(m.maxAt / m.span, 0, 1), cl(m.end80, -40, 0) / 12, bw * Math.log2(Math.max(60, m.bodyHz) / 60) / 1.5];
}
const FEAT = ["length", "bright", "colour-move", "rumble", "hiss", "pitch", "events", "texture", "attack", "peakpos", "tail", "body"];
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
  for (const name of SECTION) console.log(name.padEnd(17) + fmt(refRow(name).m));
  const e = SECTION.map((n) => refRow(n).m.lufs).sort((a, b) => a - b);
  console.log("\nDOORS / CONTAINERS (" + SECTION.length + ") median " + median(e).toFixed(1) + " LUFS, range " + e[0].toFixed(1) + " to " + e[e.length - 1].toFixed(1) +
    " (spread " + (e[e.length - 1] - e[0]).toFixed(1) + " dB; middle half " + e[Math.floor(e.length / 4)].toFixed(1) + " to " + e[Math.floor(3 * e.length / 4)].toFixed(1) + ")");
  const p = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) { const a = refRow(SECTION[i]), b = refRow(SECTION[j]); p.push([a.name, b.name, dist(a.f, b.f), a.f, b.f]); }
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY closest pairs:"); for (const [a, b, d, fa, fb] of p.slice(0, 12)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2));
  process.exit(0);
}

// ============================================================================================================
// THE VOICES (each a full patch for one layer; drive 0 unless asked: the default 0.1 is a tanh(5x) nobody asked for)
function space(p, o) {   // shared Space: reverb (a small room by default), a convolution room, a stereo width
  if (o.reverb) Object.assign(p, { reverb: r2(o.reverb), reverbSize: r2(o.size ?? 0.45), reverbTone: r2(o.rtone ?? 0.45) });
  if (o.conv) Object.assign(p, { convMix: r2(o.conv), convType: o.convType ?? 0, convSize: r2(o.convSize ?? 0.8), convTone: r2(o.convTone ?? 0.45) });
  if (o.width != null) p.width = r2(o.width);
  return p;
}
// impact (19): a contact transient + its boom (the low thump of a mass)
function imp(o) {
  const p = { wave: 19, impactTone: r2(o.tone), impactDecay: r2(o.decay), impactPunch: r2(o.punch ?? 0.8), impactGrit: r2(o.grit ?? 0.2),
    attack: 0.001, hold: r3(o.hold || 0), decay: r3(o.dec ?? 0.1), sustain: 0, release: r3(o.rel ?? 0.1), duration: r2(o.dur),
    filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 12000), reso: r2(o.reso ?? 0), drive: r2(o.drive || 0), width: 0.4 };
  if (o.drive) p.driveOS = 2;
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(o.boomFreq || 80), boomDrop: r2(o.boomDrop ?? 0.4), boomDecay: r2(o.boomDecay ?? 0.15) });
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); }
  return space(p, o);
}
// modal (10): a struck resonant body. inharm 0 harmonic, ~0.5 a wooden plate's dense modes, ~0.9 thin metal. The
// partials start at phase 0 (a soft onset), so a hard contact needs `noise` (a burst through the same envelope) or an
// impact layer. ring = modalDecay (the body's own ring); the envelope cuts it
function modal(o) {
  const p = { wave: 10, freq: Math.round(o.f), modalPartials: o.parts ?? 8, modalInharm: r2(o.inharm), modalDecay: r2(o.ring), modalBright: r2(o.bright ?? 0.5),
    attack: r3(o.atk ?? 0.001), hold: r3(o.hold ?? 0.004), decay: r3(o.dec ?? 0.1), sustain: r2(o.sus ?? 0), release: r3(o.rel ?? 0.1), duration: r2(o.dur),
    filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 12000), reso: r2(o.reso ?? 0), drive: r2(o.drive || 0), width: 0.4 };
  if (o.drive) p.driveOS = 2;
  if (o.curve) p.envCurve = r2(o.curve);
  if (o.noise) { p.noise = r2(o.noise); p.noiseColor = r2(o.color ?? 0.3); }
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); if (o.arp) p.arpStep = o.arp; }
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(o.boomFreq || 80), boomDrop: r2(o.boomDrop ?? 0.3), boomDecay: r2(o.boomDecay ?? 0.08) });
  if (o.vib) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate || 6); }
  if (o.trem) { p.tremDepth = r2(o.trem); p.tremRate = r2(o.tremRate || 6); }
  return space(p, o);
}
// bar (24): a struck bar (1 glockenspiel = a free bar, 3 vibraphone = a tuned one)
function bar(o) {
  const p = { wave: 24, freq: Math.round(o.f), barType: o.type ?? 2, barMallet: r2(o.mallet ?? 0.5), barRing: r2(o.ring ?? 0.5), barMotor: r3(o.motor ?? 0),
    attack: 0, hold: 0, decay: 0, sustain: 1, release: r3(o.rel ?? 0.4), duration: r2(o.dur), filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0, drive: 0, width: 0.3 };
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); if (o.arp) p.arpStep = o.arp; }
  return space(p, o);
}
// friction (34): stick-slip on a body (0 wood, 1 iron, 2 rubber, 3 hinged wood); freq = the body's size.
// speed / press: [[t, v], ...] (the first t is 0, at most 4 points); stop: when the push ends. The envelope is the
// shipped friction presets' (1 ms in, hold to 31 ms before the stop, a 30 ms fade), so the reverb rings on.
function fric(o) {
  const p = { wave: 34, fricBody: o.body, freq: Math.round(o.f), fricTone: r2(o.tone ?? 0.45), fricGrip: r2(o.grip ?? 0.6), fricRough: r2(o.rough ?? 0.4),
    fricLock: r2(o.lock ?? 0.3), attack: 0.001, hold: r3(Math.max(0, o.stop - 0.031)), decay: 0.03, sustain: 0, release: 0.01,
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0, drive: 0, width: 0.4, duration: r2(Math.min(2, o.dur || o.stop + 0.3)), fricStop: r3(o.stop) };
  o.speed.forEach(([t, v], i) => { if (i === 0) p.fricSpeed = r2(v); else { p["fricT" + i] = r3(t); p["fricSpeed" + i] = r2(v); } });
  o.press.forEach(([t, v], i) => { if (i === 0) p.fricPress = r2(v); else { p["fricPressT" + i] = r3(t); p["fricPress" + i] = r2(v); } });
  p.fricSeed = o.seed;
  // Hold's row stops at 1 s (Variations clamp it there), so a push longer than that is held by the SUSTAIN instead: the
  // model rings down on its own after the stop (measured: ~3 dB per 20 ms), so no fade is needed at the push's end
  if (p.hold > 1) Object.assign(p, { hold: 0, decay: 0, sustain: 1, release: 0.25 });
  return space(p, o);
}
// servo (33): o is the servo* rows verbatim; the chassis is the shipped servo presets' (4 ms in, 20 ms out, dry)
function servo(o, dur, sp) {
  return space(Object.assign({ wave: 33, attack: 0.004, hold: 0, decay: 0, sustain: 1, release: 0.02, filterMode: 0, cutoff: 12000, reso: 0,
    drive: 0, bitcrush: 16, width: 0.4, duration: r2(dur) }, o), sp || {});
}
// whoosh (20): air moved by a swinging panel
function whoosh(o) {
  const p = { wave: 20, whooshTone: r2(o.tone), whooshSweep: r2(o.sweep ?? 0.3), whooshBody: r2(o.body ?? 0.2), whooshPeak: r2(o.peak ?? 0.5),
    attack: r3(o.atk ?? 0.02), hold: r3(o.hold || 0), decay: r3(o.dec ?? 0.1), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.15), duration: r2(o.dur),
    filterMode: 0, cutoff: Math.round(o.cut || 8000), reso: 0, drive: 0, width: 0.5 };
  return space(p, o);
}
// particle (15): dense tiny contacts (a runner's grit, a rail's grain)
function part(o) {
  const p = { wave: 15, particleRate: Math.round(cl(o.rate, 5, 200)), particleTone: r2(o.tone), particleDecay: r2(o.decay), particleSpread: r2(o.spread ?? 0.4),
    attack: r3(o.atk ?? 0.02), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.1), duration: r2(o.dur),
    filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 8000), reso: 0, drive: r2(o.drive || 0), width: 0.5 };
  return space(p, o);
}
// spring (32): 0 a coil (a spring's dispersive "tsing"), 1 a doorstop
function spring(o) {
  const p = { wave: 32, springType: o.type ?? 0, freq: Math.round(o.f), springLength: Math.round(o.len ?? 60), springDisp: r2(o.disp ?? 0.8), springDamp: r2(o.damp ?? 0.5),
    springSway: r2(o.sway || 0), springSwayRate: r2(o.swayRate || 7), springPluck: r2(o.pluck ?? 0.6), springSeed: o.seed ?? 1,
    attack: 0, hold: 0, decay: 0, sustain: 1, release: r3(o.rel ?? 0.05), filterMode: 1, cutoff: Math.round(o.hp || 40), reso: 0, drive: 0, duration: r2(o.dur), width: 0.3 };
  return space(p, o);
}
// noise (a plain oscillator with noise 1): escaping air, a pneumatic hiss
function hiss(o) {
  const p = { wave: 0, freq: 200, noise: 1, noiseColor: r2(o.color ?? 0), attack: r3(o.atk ?? 0.01), hold: r3(o.hold || 0), decay: r3(o.dec ?? 0.2), sustain: r2(o.sus ?? 0),
    release: r3(o.rel ?? 0.15), filterMode: o.mode ?? 2, cutoff: Math.round(o.cut || 3000), reso: r2(o.reso ?? 0.2), drive: 0, width: 0.6, duration: r2(o.dur) };
  if (o.fenv) p.filtEnv = r2(o.fenv);
  return space(p, o);
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
  const max = m[1] === "wave" ? 35 : +m[3]; PRANGE[m[1]] = [+m[2], max];
}
function rangeCheck(name, p) {
  const ls = [p].concat(p.layers ? JSON.parse(p.layers).map((l) => l.s) : []);
  ls.forEach((l, i) => { for (const [k, v] of Object.entries(l)) { if (k[0] === "_" || k === "layers") continue; const r = PRANGE[k];
    if (!r) console.log("  !! " + name + " layer " + (i + 1) + ": " + k + " is not a PARAMS row");
    else if (v < r[0] - 1e-9 || v > r[1] + 1e-9) console.log("  !! " + name + " layer " + (i + 1) + ": " + k + " " + v + " outside " + r[0] + ".." + r[1]); } });
  if (p.layers) JSON.parse(p.layers).forEach((l, i) => { if (l.g > 2 || l.d > 2) console.log("  !! " + name + " layer " + (i + 2) + " gain/delay out of range"); });
}   // engines whose Duration slider stretches past 2 s
function durCheck(name, p) {
  rangeCheck(name, p);
  const ls = [p].concat(p.layers ? JSON.parse(p.layers).map((l) => l.s) : []);
  ls.forEach((l, i) => { if (l.duration > 2.0001 && !STRETCH.has(l.wave)) console.log("  !! " + name + " layer " + (i + 1) + " (wave " + l.wave + ") duration " + l.duration + " > 2 s"); });
}

// ============================================================================================================
// THE DESIGNS
const S = {};

// ---- knocks, slams and closes: a contact on a resonant body, in a room ----------------------------------------------
// DOOR KNOCK: a knuckle on a solid wooden door, three times. Each knock is the PANEL ringing (modal: low, dense wooden
// modes, ~190 Hz, dying in ~80 ms) with the knuckle's soft contact in it (a dark noise burst through the same envelope),
// so the wood is in the sound. The three are three layers at slightly different pitches and strengths (a hand never
// lands twice on the same spot), 0.18 s apart, the last a touch firmer. Each layer carries its own knuckle, so
// Variations (which vary a burst's rate per layer) can never pull a tick off its knock.
function knock(f, ring, o) {
  return modal(Object.assign({ f, parts: 10, inharm: 0.55, ring, bright: 0.42, noise: 0.4, color: 0.3, hold: 0.003, dec: 0.1, rel: 0.05, dur: 0.75,
    cut: 4500, boom: 0.15, boomFreq: 95, boomDrop: 0.2, boomDecay: 0.05, reverb: 0.12, size: 0.35 }, o || {}));
}
S["Door Knock"] = () => sound(knock(188, 0.09),
  [[knock(181, 0.085, { noise: 0.38 }), 0.183, 0.84],
   [knock(194, 0.095, { noise: 0.42 }), 0.372, 1.0]]);
// ALT, a METAL door (a steel fire door, a ship's hatch, a dungeon's iron door): the same three knocks on thin steel
// over a hollow frame: a longer, inharmonic ring (~310 Hz) and a boomier cavity. A different object, so an archetype.
function steelKnock(f, o) {
  return modal(Object.assign({ f, parts: 14, inharm: 0.9, ring: 0.32, bright: 0.5, noise: 0.3, color: 0.35, hold: 0.003, dec: 0.25, rel: 0.12, dur: 0.75,
    cut: 6000, boom: 0.35, boomFreq: 90, boomDrop: 0.15, boomDecay: 0.08, reverb: 0.18, size: 0.5, rtone: 0.5 }, o || {}));
}
const KNOCK_METAL = () => sound(steelKnock(310),
  [[steelKnock(298, { noise: 0.33 }), 0.2, 0.85],
   [steelKnock(318, { noise: 0.35 }), 0.405, 1.0]]);

// DOOR SLAM: a door swung hard into its frame. The edge's THUD (impact, a 65 Hz boom: the door's mass), the PANEL ringing
// (wood, ~115 Hz, a quarter second, in the room), the LATCH snapping into the strike plate 15 ms later (a small bright
// metal clack with a short ring), and the door RATTLING in the frame (three fast small knocks) — in a hallway.
S["Door Slam"] = () => sound(
  imp({ tone: 0.48, decay: 0.3, punch: 0.95, grit: 0.4, dec: 0.18, rel: 0.25, dur: 1.1, cut: 6000, boom: 0.45, boomFreq: 72, boomDrop: 0.45, boomDecay: 0.18,
    reverb: 0.3, size: 0.6, rtone: 0.4 }),
  [[modal({ f: 138, parts: 12, inharm: 0.6, ring: 0.28, bright: 0.48, noise: 0.15, color: 0.6, dec: 0.3, rel: 0.25, dur: 1.1, cut: 4500, reverb: 0.3, size: 0.6, rtone: 0.4 }), 0, 1.0],
   [modal({ f: 1750, parts: 6, inharm: 0.85, ring: 0.05, bright: 0.8, noise: 0.5, color: 0.1, dec: 0.05, rel: 0.04, dur: 0.4, cut: 9000, reverb: 0.2, size: 0.6 }), 0.016, 0.85],
   [imp({ tone: 0.5, decay: 0.04, punch: 0.8, grit: 0.15, dec: 0.03, rel: 0.03, dur: 0.4, cut: 6000, repeat: 3, rate: 19 }), 0.07, 0.5]]);

// CABINET CLOSE: a small cupboard door (light, MDF) pushed shut: a lighter, higher thump on a HOLLOW BOX (the cabinet
// rings at ~260 Hz, short), and the magnetic catch's little click as it pulls the door home. No boom, a kitchen's
// small room.
S["Cabinet Close"] = () => sound(
  modal({ f: 262, parts: 9, inharm: 0.5, ring: 0.08, bright: 0.45, noise: 0.35, color: 0.35, hold: 0.003, dec: 0.09, rel: 0.05, dur: 0.45, cut: 4500,
    boom: 0.12, boomFreq: 150, boomDrop: 0.2, boomDecay: 0.04, reverb: 0.12, size: 0.35 }),
  [[imp({ tone: 0.5, decay: 0.08, punch: 0.85, grit: 0.15, dec: 0.06, rel: 0.05, dur: 0.45, cut: 6000 }), 0, 0.45],
   [modal({ f: 2900, parts: 4, inharm: 0.8, ring: 0.05, bright: 0.7, noise: 0.5, color: 0.1, dec: 0.02, rel: 0.02, dur: 0.2, cut: 10000 }), 0.012, 0.4]]);

// ---- latches, bolts and locks: small precise metal ---------------------------------------------------------------
// LATCH CLICK: a door latch's tongue snapping over the strike and seating: a crisp click (a tiny bright contact with a
// short steel ring at ~3.3 kHz) and 40 ms later the seat (softer, lower), the door's wood answering faintly under both.
S["Latch Click"] = () => sound(
  imp({ tone: 0.82, decay: 0.03, punch: 1, grit: 0.15, dec: 0.02, rel: 0.02, dur: 0.25, cut: 12000 }),
  [[modal({ f: 3300, parts: 5, inharm: 0.85, ring: 0.05, bright: 0.7, dec: 0.035, rel: 0.03, dur: 0.25 }), 0, 0.5],
   [imp({ tone: 0.62, decay: 0.03, punch: 0.9, grit: 0.1, dec: 0.02, rel: 0.02, dur: 0.2, cut: 9000 }), 0.042, 0.6],
   [modal({ f: 300, parts: 8, inharm: 0.55, ring: 0.05, bright: 0.35, noise: 0.2, color: 0.5, dec: 0.05, rel: 0.03, dur: 0.25, cut: 3000 }), 0.042, 0.35]]);

// LOCK BOLT: a deadbolt thrown by a key: the key turning the cam (three tiny pin clicks, a rough little scrape), then the
// spring-loaded BOLT snapping across into the frame: a heavier clack with its own steel ring (~1.15 kHz) and the
// door's wood thumping under it.
S["Lock Bolt"] = () => sound(
  modal({ f: 2600, parts: 5, inharm: 0.85, ring: 0.05, bright: 0.6, noise: 0.5, color: 0.2, dec: 0.02, rel: 0.015, dur: 0.6, cut: 9000, repeat: 3, rate: 24 }),
  [[imp({ tone: 0.58, decay: 0.08, punch: 1, grit: 0.35, dec: 0.06, rel: 0.06, dur: 0.5, cut: 9000, boom: 0.3, boomFreq: 150, boomDrop: 0.3, boomDecay: 0.05, reverb: 0.1 }), 0.15, 1.4],
   [modal({ f: 1150, parts: 8, inharm: 0.85, ring: 0.12, bright: 0.6, dec: 0.15, rel: 0.1, dur: 0.5, reverb: 0.1 }), 0.152, 1.0],
   [modal({ f: 190, parts: 10, inharm: 0.55, ring: 0.08, bright: 0.3, noise: 0.2, color: 0.5, dec: 0.08, rel: 0.05, dur: 0.4, cut: 2500 }), 0.15, 0.9]]);

// SAFE TUMBLER: a combination dial turned: fine, even detent clicks (16 a second — they ARE identical, a dial's spring
// detent), each a tiny click with a faint high steel ring from the wheel pack (one modal layer, the click its noise, so
// the two can never drift apart), then the GATE: the fence dropping into the wheel's notch, a duller, lower "tunk"
// ringing at ~860 Hz with the safe's heavy door (~300 Hz) answering faintly under it.
S["Safe Tumbler"] = () => sound(
  modal({ f: 3950, parts: 6, inharm: 0.9, ring: 0.05, bright: 0.65, noise: 0.55, color: 0.05, hold: 0.002, dec: 0.03, rel: 0.015, dur: 0.75, repeat: 11, rate: 16 }),
  [[imp({ tone: 0.42, decay: 0.05, punch: 0.85, grit: 0.15, dec: 0.04, rel: 0.04, dur: 0.4, cut: 5000 }), 0.78, 0.85],
   [modal({ f: 860, parts: 8, inharm: 0.8, ring: 0.18, bright: 0.4, hold: 0.002, dec: 0.18, rel: 0.12, dur: 0.45, reverb: 0.1 }), 0.781, 0.5],
   [modal({ f: 300, parts: 10, inharm: 0.75, ring: 0.3, bright: 0.3, hold: 0.002, dec: 0.25, rel: 0.15, dur: 0.5, cut: 3000, reverb: 0.1 }), 0.78, 0.4]]);

// ---- openers: a sequence (the latch, the hinge, the air, the stop) ------------------------------------------------
// WOODEN DOOR OPEN: the handle drops and the latch draws back (a small steel clack), the door unseats from its frame (a
// soft wooden bump), and swings: its iron pin creaks a short way (Hinged wood friction, ticks running into a brief groan,
// on layer 1 so a roll varies it; its pressure held at 0 for 0.1 s so it begins after the latch), and the panel moves
// air (a low, slow whoosh). Creaking Door (Horror) is the long eerie one; this is a door opened in passing.
S["Wooden Door Open"] = () => sound(
  fric({ body: 3, f: 165, tone: 0.42, grip: 0.55, rough: 0.4, lock: 0.35, speed: [[0, 0.2], [0.22, 0.5], [0.5, 0.62], [0.72, 0.3]],
    press: [[0, 0], [0.1, 0], [0.2, 0.5], [0.7, 0.4]], stop: 0.82, dur: 1.3, seed: 7, reverb: 0.22, size: 0.5 }),
  [[modal({ f: 2350, parts: 6, inharm: 0.85, ring: 0.05, bright: 0.7, noise: 0.45, color: 0.1, dec: 0.04, rel: 0.03, dur: 0.3, cut: 9000, reverb: 0.12, repeat: 2, rate: 16 }), 0, 0.7],
   [modal({ f: 205, parts: 9, inharm: 0.55, ring: 0.06, bright: 0.35, noise: 0.3, color: 0.5, dec: 0.06, rel: 0.04, dur: 0.3, cut: 2500, reverb: 0.15 }), 0.1, 0.55],
   [whoosh({ tone: 0.12, sweep: 0.15, body: 0.1, peak: 0.45, atk: 0.25, dec: 0.3, sus: 0.3, rel: 0.3, dur: 0.95, cut: 2500, reverb: 0.15 }), 0.18, 0.4]]);

// CHEST OPEN: a wooden chest with iron fittings. The hasp flips up off its staple (an iron clink with a short ring),
// the lid lifts on two small iron hinges (Hinged wood friction, a smaller body than a door's: higher and quicker, more
// squeak than groan; layer 1, held silent for the first 0.15 s), and the lid falls back onto its stop (a wooden thump)
// and its chain stay pulls taut (a light clink).
S["Chest Open"] = () => sound(
  fric({ body: 3, f: 235, tone: 0.5, grip: 0.6, rough: 0.35, lock: 0.5, speed: [[0, 0.3], [0.3, 0.68], [0.6, 0.75], [0.8, 0.45]],
    press: [[0, 0], [0.14, 0], [0.24, 0.55], [0.75, 0.5]], stop: 0.86, dur: 1.4, seed: 11, reverb: 0.2, size: 0.45 }),
  [[modal({ f: 1450, parts: 8, inharm: 0.85, ring: 0.16, bright: 0.65, noise: 0.35, color: 0.15, dec: 0.16, rel: 0.12, dur: 0.5, cut: 9000, reverb: 0.15 }), 0, 0.7],
   [modal({ f: 196, parts: 10, inharm: 0.55, ring: 0.09, bright: 0.4, noise: 0.4, color: 0.4, dec: 0.1, rel: 0.06, dur: 0.5, cut: 3500,
     boom: 0.25, boomFreq: 110, boomDrop: 0.2, boomDecay: 0.05, reverb: 0.18 }), 0.88, 0.9],
   [modal({ f: 2150, parts: 6, inharm: 0.85, ring: 0.07, bright: 0.7, noise: 0.25, color: 0.1, dec: 0.07, rel: 0.05, dur: 0.4, cut: 10000, reverb: 0.12, repeat: 2, rate: 22 }), 0.9, 0.4]]);

// VAULT DOOR: a bank vault opening. The bolt drive (a big geared motor, slow and heavy, on layer 1) runs the locking bars
// back for 0.65 s and they CLEAR with a deep clunk (impact, a 48 Hz boom) that sets the door's steel ringing (modal, ~76
// Hz, inharmonic, long); then the door swings on its massive hinge: an iron groan (friction, Iron body ~92 Hz, slow under
// full weight) for a second and a half. A stone hall answers everything.
S["Vault Door"] = () => sound(
  servo({ servoType: 2, servoSpeed: 2600, servoAt: 0.02, servoRun: 0.62, servoLoad: 0.75, servoLoadEnd: 0.85, servoInertia: 0.12, servoDecel: 0.03,
    servoBrake: 1, servoSlots: 8, servoWhine: 0.35, servoBars: 6, servoComm: 0.4, servoSpark: 0.1, servoStages: 3, servoPinion1: 10, servoGear1: 50, servoMesh1: 0.9,
    servoPinion2: 12, servoGear2: 60, servoMesh2: 0.8, servoPinion3: 14, servoGear3: 70, servoMesh3: 0.6, servoWear: 0.3, servoKnock: 0.6, servoKnockShaft: 3,
    servoKnockRate: 2, servoKnockHz: 400, servoStop: 1.4, servoClickHz: 520, servoBearing: 0.1, servoRumble: 0.5, servoSize: 0.95, servoBody: 0.8, servoWander: 0.3, servoSeed: 3 },
    1.2, { reverb: 0.35, size: 0.85, rtone: 0.35 }),
  [[imp({ tone: 0.33, decay: 0.4, punch: 0.9, grit: 0.5, dec: 0.3, rel: 0.4, dur: 1.4, cut: 4000, boom: 0.85, boomFreq: 48, boomDrop: 0.4, boomDecay: 0.35, reverb: 0.4, size: 0.9, rtone: 0.35 }), 0.66, 1],
   [modal({ f: 76, parts: 14, inharm: 0.82, ring: 1.4, bright: 0.55, noise: 0.1, color: 0.6, hold: 0.01, dec: 0.2, sus: 1, rel: 0.8, dur: 2, cut: 3000, reverb: 0.4, size: 0.9, rtone: 0.35 }), 0.66, 0.6],
   [fric({ body: 1, f: 92, tone: 0.3, grip: 0.65, rough: 0.8, lock: 0.05, speed: [[0, 0.12], [0.35, 0.3], [1.0, 0.38], [1.4, 0.2]], press: [[0, 0.9], [1.2, 0.95]],
     stop: 1.6, dur: 2, seed: 3, reverb: 0.4, size: 0.9, rtone: 0.3 }), 0.95, 0.85]]);

// ---- metal: panels, bars, chains, keys, bells ------------------------------------------------------------------
// METAL LOCKER: a steel locker door slammed shut. The thin steel PANEL rings (modal: dense, very inharmonic, bright, ~0.4
// s, the sheet's shimmer), the edge's hit (impact, gritty), the latch lever dropping into its catch 12 ms later (a small
// clack), and the door RATTLING in its frame (five fast small hits). A tiled room.
S["Metal Locker"] = () => sound(
  modal({ f: 236, parts: 16, inharm: 0.95, ring: 0.5, bright: 0.65, noise: 0.12, color: 0.1, hold: 0.003, dec: 0.06, sus: 0.85, rel: 0.4, dur: 1.0, cut: 9000,
    reverb: 0.22, size: 0.5, rtone: 0.6 }),
  [[imp({ tone: 0.58, decay: 0.12, punch: 1, grit: 0.5, dec: 0.08, rel: 0.08, dur: 0.6, cut: 9000, boom: 0.15, boomFreq: 120, boomDrop: 0.3, boomDecay: 0.05 }), 0, 0.5],
   [modal({ f: 2050, parts: 6, inharm: 0.85, ring: 0.05, bright: 0.75, noise: 0.4, color: 0.1, dec: 0.05, rel: 0.04, dur: 0.3, cut: 10000 }), 0.012, 0.5],
   [imp({ tone: 0.66, decay: 0.03, punch: 0.9, grit: 0.25, dec: 0.025, rel: 0.02, dur: 0.6, cut: 9000, repeat: 5, rate: 24, reverb: 0.15, size: 0.5 }), 0.045, 0.4]]);

// CELL DOOR CLANG: a barred iron cell door slammed shut in a stone dungeon. A heavy iron-on-iron HIT (impact with a 70 Hz
// boom), the door's frame and bars RINGING as two sets of inharmonic modes a little apart (they beat), and the lock's
// bolt dropping home 90 ms later (a clack-clack). Today's ring kept its 0.22 noise under the whole two seconds; here the
// hit carries the noise and the ring is clean.
S["Cell Door Clang"] = () => sound(
  modal({ f: 172, parts: 14, inharm: 0.72, ring: 1.5, bright: 0.58, noise: 0.08, color: 0.3, hold: 0.004, dec: 0.15, sus: 1, rel: 0.8, dur: 2, cut: 6000,
    reverb: 0.42, size: 0.88, rtone: 0.4 }),
  [[imp({ tone: 0.55, decay: 0.22, punch: 1, grit: 0.6, dec: 0.15, rel: 0.2, dur: 1.0, cut: 8000, boom: 0.6, boomFreq: 70, boomDrop: 0.4, boomDecay: 0.18, reverb: 0.4, size: 0.88, rtone: 0.4 }), 0, 0.9],
   [modal({ f: 251, parts: 12, inharm: 0.8, ring: 1.0, bright: 0.62, hold: 0.004, dec: 0.15, sus: 1, rel: 0.6, dur: 1.8, cut: 7000, reverb: 0.42, size: 0.88, rtone: 0.4 }), 0.004, 0.55],
   [imp({ tone: 0.7, decay: 0.05, punch: 1, grit: 0.35, dec: 0.04, rel: 0.04, dur: 0.6, cut: 9000, repeat: 2, rate: 9, reverb: 0.35, size: 0.88 }), 0.09, 0.45]]);

// CHAIN CLINK: a short length of steel chain dropped or jostled: a handful of link-on-link collisions at irregular times,
// each link ringing at its own pitch (three modal layers, 960-1640 Hz, inharmonic, short) over the dull clack of the
// links (impact). Heavier and lower than keys, and only five or six strikes.
S["Chain Clink"] = () => sound(
  modal({ f: 1180, parts: 6, inharm: 0.85, ring: 0.08, bright: 0.5, noise: 0.25, color: 0.2, dec: 0.08, rel: 0.05, dur: 0.6, hp: 400, repeat: 2, rate: 6.5, reverb: 0.1 }),
  [[modal({ f: 1640, parts: 6, inharm: 0.88, ring: 0.07, bright: 0.55, noise: 0.25, color: 0.2, dec: 0.07, rel: 0.04, dur: 0.5, hp: 400, repeat: 2, rate: 9, reverb: 0.1 }), 0.062, 0.8],
   [modal({ f: 955, parts: 6, inharm: 0.82, ring: 0.09, bright: 0.48, noise: 0.25, color: 0.2, dec: 0.09, rel: 0.05, dur: 0.4, hp: 400, reverb: 0.1 }), 0.235, 0.7],
   [imp({ tone: 0.5, decay: 0.03, punch: 0.9, grit: 0.3, dec: 0.025, rel: 0.02, dur: 0.6, cut: 7000, repeat: 3, rate: 7.5 }), 0.004, 0.4]]);

// KEY JINGLE: a bunch of keys shaken: many thin plates (brass and steel), bright and very inharmonic (2-4 kHz), struck
// against each other DENSELY and IRREGULARLY. Four keys, four layers at their own pitches and rates, so the strikes
// interleave and no two in a row match; the shimmer overlaps. Today's was one key struck five times evenly.
S["Key Jingle"] = () => sound(
  modal({ f: 2050, parts: 8, inharm: 0.95, ring: 0.18, bright: 0.75, noise: 0.1, color: 0.1, dec: 0.05, sus: 0.12, rel: 0.04, dur: 0.75, hp: 1200, repeat: 6, rate: 14, reverb: 0.15 }),
  [[modal({ f: 2750, parts: 8, inharm: 0.95, ring: 0.15, bright: 0.75, noise: 0.1, color: 0.1, dec: 0.045, sus: 0.12, rel: 0.03, dur: 0.6, hp: 1200, repeat: 7, rate: 17.5, reverb: 0.15 }), 0.023, 0.8],
   [modal({ f: 3450, parts: 7, inharm: 0.95, ring: 0.13, bright: 0.75, noise: 0.08, color: 0.1, dec: 0.045, sus: 0.12, rel: 0.03, dur: 0.6, hp: 1200, repeat: 6, rate: 15.5, reverb: 0.15 }), 0.051, 0.6],
   [modal({ f: 1580, parts: 8, inharm: 0.92, ring: 0.2, bright: 0.7, noise: 0.1, color: 0.1, dec: 0.06, sus: 0.12, rel: 0.05, dur: 0.6, hp: 900, repeat: 5, rate: 8, reverb: 0.15 }), 0.09, 0.6]]);

// SHOP BELL: the bell on a coiled spring over a shop door. The door knocks it and it swings: one full strike that rings
// on, then the clapper bouncing (quicker, softer strikes) as the spring sways, dying away, and its smaller partner bell on
// the same strap catching a few. Today's was two strikes a tone apart (a doorbell's ding-dong).
S["Shop Bell"] = () => sound(
  modal({ f: 1480, parts: 7, inharm: 0.55, ring: 0.9, bright: 0.7, hold: 0.004, dec: 0.2, sus: 1, rel: 0.5, dur: 1.5, vib: 0.004, vibRate: 5, reverb: 0.2, size: 0.45 }),
  [[modal({ f: 1480, parts: 7, inharm: 0.55, ring: 0.5, bright: 0.7, dec: 0.08, sus: 0.6, rel: 0.03, dur: 0.7, repeat: 6, rate: 11.5, reverb: 0.2, size: 0.45 }), 0.075, 0.55],
   [modal({ f: 1480, parts: 7, inharm: 0.55, ring: 0.6, bright: 0.65, dec: 0.1, sus: 0.6, rel: 0.05, dur: 0.75, repeat: 4, rate: 7.5, reverb: 0.2, size: 0.45 }), 0.6, 0.3],
   [modal({ f: 1985, parts: 6, inharm: 0.55, ring: 0.5, bright: 0.7, dec: 0.08, sus: 0.6, rel: 0.05, dur: 0.8, repeat: 3, rate: 9, reverb: 0.2, size: 0.45 }), 0.13, 0.4]]);

// ---- slides ---------------------------------------------------------------------------------------------------
// DRAWER SLIDE: a wooden drawer pulled out on wooden runners: wood-on-wood friction (Wood body, a light even pressure:
// a scrape whose grain follows the pull, speeding then easing; the friction engine's Wood body is dark, so the runners'
// fine grit rides over it as a particle layer), then the drawer reaching its stop (a wooden thump with a soft knock)
// and what is inside it shifting (a few small rattles).
S["Drawer Slide"] = () => sound(
  fric({ body: 0, f: 330, tone: 0.48, grip: 0.6, rough: 0.65, lock: 0.25, speed: [[0, 0.35], [0.12, 0.62], [0.32, 0.55], [0.44, 0.3]], press: [[0, 0.4], [0.3, 0.45]],
    stop: 0.48, dur: 0.95, seed: 5, reverb: 0.12, size: 0.35 }),
  [[part({ rate: 160, tone: 0.55, decay: 0.08, spread: 0.6, atk: 0.06, hold: 0.25, dec: 0.15, sus: 0, rel: 0.05, dur: 0.48, cut: 6000, reverb: 0.1, size: 0.35 }), 0, 0.35],
   [modal({ f: 225, parts: 10, inharm: 0.55, ring: 0.08, bright: 0.42, noise: 0.45, color: 0.35, dec: 0.08, rel: 0.05, dur: 0.45, cut: 4000,
     boom: 0.2, boomFreq: 120, boomDrop: 0.2, boomDecay: 0.04, reverb: 0.12, size: 0.35 }), 0.48, 0.9],
   [imp({ tone: 0.75, decay: 0.02, punch: 0.9, grit: 0.2, dec: 0.015, rel: 0.015, dur: 0.35, cut: 9000, repeat: 3, rate: 21 }), 0.505, 0.28]]);

// ALT, a HAND-PUSHED sliding door on a track (a barn door, a wardrobe, a shoji on wooden rails): no motor; the roller
// wheels RUMBLE along the steel track (dense low particle grain, the panel's wood under it as Wood friction at a low
// even speed), and it meets the jamb with a wooden bump. A different machine from the automatic one, so an archetype.
const SLIDE_TRACK = () => sound(
  fric({ body: 0, f: 140, tone: 0.4, grip: 0.55, rough: 0.7, lock: 0.2, speed: [[0, 0.3], [0.15, 0.5], [0.55, 0.45], [0.75, 0.25]], press: [[0, 0.5]],
    stop: 0.8, dur: 1.2, seed: 9, reverb: 0.18, size: 0.5 }),
  [[part({ rate: 190, tone: 0.3, decay: 0.12, spread: 0.5, atk: 0.12, hold: 0.45, dec: 0.2, sus: 0, rel: 0.05, dur: 0.8, cut: 2500, reverb: 0.15, size: 0.5 }), 0, 0.6],
   [modal({ f: 150, parts: 10, inharm: 0.55, ring: 0.12, bright: 0.38, noise: 0.4, color: 0.4, dec: 0.12, rel: 0.08, dur: 0.6, cut: 3500,
     boom: 0.35, boomFreq: 80, boomDrop: 0.2, boomDecay: 0.08, reverb: 0.2, size: 0.5 }), 0.8, 0.95],
   [imp({ tone: 0.6, decay: 0.03, punch: 0.9, grit: 0.25, dec: 0.025, rel: 0.02, dur: 0.4, cut: 8000, repeat: 2, rate: 17 }), 0.83, 0.3]]);

// SLIDING DOOR: an automatic sliding door: the drive motor (brushless, a belt and one gear stage) spins up and brakes
// over 0.75 s, the panel pushes air (today's whoosh, kept as a layer), and the door meets its rubber seal (a soft, damped
// thud). Layer 1 is the motor, so a roll varies it.
S["Sliding Door"] = () => sound(
  servo({ servoType: 0, servoSpeed: 5200, servoAt: 0.02, servoRun: 0.42, servoAt2: 0.46, servoRun2: 0.26, servoSpeed2: 2200, servoLoad: 0.5, servoLoadEnd: 0.45,
    servoInertia: 0.14, servoDecel: 0.1, servoBrake: 1, servoSlots: 9, servoWhine: 0.7, servoWhineHarm: 5, servoWhineRoll: 1.5, servoBars: 0, servoComm: 0, servoSpark: 0,
    servoStages: 1, servoPinion1: 12, servoGear1: 40, servoMesh1: 0.4, servoPwm: 0.03, servoPwmHz: 7800, servoBearing: 0.2, servoBearingHz: 5200, servoRumble: 0.3,
    servoSize: 0.6, servoBody: 0.55, servoWander: 0.2, servoStop: 0.5, servoClickHz: 900, servoSeed: 4 }, 1.0, { reverb: 0.15, size: 0.5 }),
  [[whoosh({ tone: 0.4, sweep: 0.35, body: 0.6, peak: 0.5, atk: 0.12, dec: 0.15, sus: 1, rel: 0.25, dur: 0.85, cut: 5000, reverb: 0.2, size: 0.5 }), 0.03, 0.75],
   [modal({ f: 140, parts: 8, inharm: 0.5, ring: 0.07, bright: 0.25, noise: 0.35, color: 0.7, dec: 0.08, rel: 0.06, dur: 0.4, cut: 1800, boom: 0.35, boomFreq: 85, boomDrop: 0.2, boomDecay: 0.06, reverb: 0.15, size: 0.5 }), 0.74, 0.8]]);
//@@DESIGNS@@
const ALTS = { "Door Knock": [KNOCK_METAL], "Sliding Door": [SLIDE_TRACK] };

const IDEA = {
  "Cell Door Clang": "an iron-on-iron hit (impact, 70 Hz boom), two sets of bars ringing a little apart (they beat), the lock's clack-clack; a stone room",
  "Chain Clink": "five or six link collisions at irregular times, three links at their own pitches (955-1640 Hz) over the links' dull clack",
  "Door Knock": "three knocks on a wooden PANEL (modal ~190 Hz, the knuckle a dark noise burst in each), each at its own pitch and strength",
  "Shop Bell": "a bell on a coiled spring: one full strike ringing on, the clapper bouncing softer and quicker as it sways, a partner bell",
  "Wooden Door Open": "the latch drawing back (click-clack), the door unseating (wood bump), a short hinge creak (Hinged wood friction), the swing's air",
  "Door Slam": "the edge's thud (65 Hz boom), the panel's wooden ring, the latch snapping into the strike, the door rattling in its frame; a hallway",
  "Latch Click": "a latch tongue snapping over the strike (a crisp click, a short steel ring) and seating 40 ms later, the door's wood under both",
  "Chest Open": "the hasp clinks up, the lid lifts on small iron hinges (a higher, squeakier creak), the lid falls onto its stop (thump) and its chain stay clinks",
  "Drawer Slide": "wood on wood runners (Wood friction + the runners' grit), the drawer hitting its stop (thump), the contents shifting",
  "Sliding Door": "an automatic door: the drive motor spins up and brakes (servo, brushless), the panel's air (today's whoosh as a layer), the rubber seal's thud",
  "Safe Tumbler": "eleven even detent clicks with a faint high ring, then the gate: a duller tunk, a ~860 Hz ring and the safe's door under it",
  "Lock Bolt": "a key turning the cam (three tiny pin clicks), then the spring-loaded bolt snapping across: a heavy clack, a 1.15 kHz ring, the door's wood",
  "Cabinet Close": "a light cupboard door on a hollow box (modal ~260 Hz, no boom), the magnetic catch's click as it pulls home",
  "Metal Locker": "a steel locker slammed: the thin panel's bright inharmonic shimmer, the edge's hit, the latch lever's clack, the door rattling in its frame",
  "Key Jingle": "four keys at their own pitches and rates (1.6-3.5 kHz, very inharmonic), struck densely and irregularly, the shimmer overlapping",
  "Vault Door": "the bolt drive (big geared servo) runs the bars back, they clear with a deep clunk that sets the door's steel ringing, then the hinge's iron groan",
};
const ALT_IDEA = {
  "Door Knock": ["a METAL door: the same three knocks on thin steel over a hollow frame (a longer inharmonic ring ~310 Hz, a boomier cavity)"],
  "Sliding Door": ["a HAND-PUSHED sliding door on a track: rollers rumbling along (particle + Wood friction), a wooden bump at the jamb"],
};
const KEPT = {
  "Wood Break": "AJ's pick in a blind round (wood-break-2, \"fiber tear\"); the crack + the grain tearing is right. (It carries no _vary; noted, not changed.)",
  "Chair Scrape": "on the friction engine's Wood body this week; a chair leg's stick-slip is exactly what the engine models",
  "Heavy Gate": "picked by ear in the friction round (iron hinge under its weight)",
  "Trapdoor Creak": "picked by ear in the friction round (a hatch lifting; alt the iron eek)",
  "Elevator Ding": "a near-harmonic modal chime (1046 Hz, 4 partials, 1.4 s ring) is what an elevator's struck chime bar sounds like: one clean tone. A tuned bar (bar engine, vibraphone) was considered and is the same idea with a different overtone; nothing here is wrong to fix",
};
// Per-sound level offset from the section median, by design (dB). The small mechanisms sit under it; the vault is big.
const LEVEL_OFFSET = { "Latch Click": -4, "Safe Tumbler": -3, "Lock Bolt": -2, "Cabinet Close": -3, "Key Jingle": -2, "Chain Clink": -2, "Drawer Slide": -2,
  "Door Knock": -2, "Vault Door": 1 };
// _vary: layer 1 only (the preset button's roll); Variations vary every layer with one shared pitch move
const VARY = {
  "Cell Door Clang": { freq: 0.06, modalInharm: 0.08, modalDecay: 0.15 },
  "Chain Clink": { freq: 0.1, rate: 0.2, modalInharm: 0.1 },
  "Door Knock": { freq: 0.06, modalDecay: 0.15, modalInharm: 0.1 },
  "Shop Bell": { freq: 0.05, modalDecay: 0.15 },
  "Wooden Door Open": { fricSeed: 1 },
  "Door Slam": { impactTone: 0.15, impactDecay: 0.15, boomFreq: 0.12 },
  "Latch Click": { impactTone: 0.1, impactDecay: 0.2 },
  "Chest Open": { fricSeed: 1 },
  "Drawer Slide": { fricSeed: 1 },
  "Sliding Door": { servoSeed: 1, servoSpeed: 0.1, servoWhine: 0.15 },
  "Safe Tumbler": { freq: 0.06, rate: 0.08 },
  "Lock Bolt": { freq: 0.1, rate: 0.15 },
  "Cabinet Close": { freq: 0.08, modalDecay: 0.15, modalInharm: 0.1 },
  "Metal Locker": { freq: 0.1, modalInharm: 0.05, modalDecay: 0.2 },
  "Key Jingle": { freq: 0.1, rate: 0.2, modalInharm: 0.05 },
  "Vault Door": { servoSeed: 1, servoSpeed: 0.1, servoRun: 0.1 },
};

if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e), r = render(p); console.log(fmt(measure(r)) + "\n      " + curve(r)); } process.exit(0); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "doors-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in steps
// of 0.05 (the smallest that reaches the target), capped at LIMIT_MAX: past that a transient is being squashed to buy
// loudness it does not have, so a knock or a slam that cannot reach its target lands short and the report says by how much.
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
// The Limiter puts DC into low asymmetric pulses (a boom, a rumble): step it down until |DC| is within today's worst
// in the section (2e-4), so a level trim never buys loudness with an offset
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
const only = arg && arg !== "sep" ? arg : null;
if (only && !REDO.some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + REDO.map(slug).join(", ")); process.exit(1); }
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {}, altRows = [];
console.log("Doors / Containers median " + TARGET.toFixed(1) + " LUFS (the level target)");
const fmtLv = (p, m, tgt) => (p.layers ? JSON.parse(p.layers).length + 1 : 1) + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
  ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")";
for (const name of REDO) {
  const s = slug(name);
  if (only && only !== s) continue;
  const p = S[name](), tgt = TARGET + (LEVEL_OFFSET[name] || 0);
  durCheck(name, p);
  const m = level(p, tgt), r = render(p), now = refRow(name);
  const alts = (ALTS[name] || []).map((fn, i) => { const a = fn(); durCheck(name + " alt " + (i + 1), a); const am = level(a, tgt); const ar = render(a); altRows.push({ name, i, p: a, r: ar, m: am, f: features(am) }); return a; });
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    wav(s + "-2-new.wav", r, name);
    alts.forEach((a, i) => wav(s + "-alt" + (i + 1) + ".wav", render(a), name + " (alt " + (i + 1) + ")"));
  }
  json[name] = asPreset(p, VARY[name], alts);
  rows.push({ name, slug: s, p, r, m, f: features(m), now });
  console.log(name.padEnd(17) + "NEW " + fmt(m) + "\n      " + fmtLv(p, m, tgt) +
    altRows.filter((x) => x.name === name).map((x) => "\n  " + "".padEnd(12) + "ALT" + (x.i + 1) + " " + fmt(x.m).replace(/\n/g, "\n    ") + "\n      " + fmtLv(x.p, x.m, tgt)).join("") +
    "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
}
if (only) process.exit(0);

// ---- separation: the whole section as it would ship (new where redesigned, today's where kept), plus the two friction
// neighbours elsewhere (Creaking Door, Floorboard Creak)
const shipped = SECTION.map((n) => rows.find((x) => x.name === n) || Object.assign({ kept: true }, refRow(n))).concat(REFS.map((n) => Object.assign({ ref: true }, refRow(n))));
const D = (a, b) => { const x = shipped.find((q) => q.name === a), y = shipped.find((q) => q.name === b); return [dist(x.f, y.f), why(x.f, y.f)]; };
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or body, or a clear shape step)");
const GROUPS = [["Door Knock", "Door Slam", "Cabinet Close"], ["Latch Click", "Lock Bolt", "Safe Tumbler"],
  ["Wooden Door Open", "Chest Open", "Trapdoor Creak", "Heavy Gate", "Creaking Door"], ["Metal Locker", "Cell Door Clang"], ["Chain Clink", "Key Jingle"],
  ["Drawer Slide", "Chair Scrape", "Sliding Door", "Floorboard Creak"], ["Shop Bell", "Elevator Ding"]];
for (const g of GROUPS) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) { const [d, w] = D(g[i], g[j]); console.log("  " + d.toFixed(2) + "  " + g[i] + " / " + g[j] + "   (" + w + ")"); }
for (const a of altRows) { const base = rows.find((x) => x.name === a.name); console.log("  " + dist(a.f, base.f).toFixed(2) + "  " + a.name + " / its alt " + (a.i + 1) + "   (" + why(a.f, base.f) + ")"); }
const all = []; for (let i = 0; i < shipped.length; i++) for (let j = i + 1; j < shipped.length; j++) all.push([shipped[i].name, shipped[j].name, dist(shipped[i].f, shipped[j].f), why(shipped[i].f, shipped[j].f)]);
all.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as shipped (the section + Creaking Door, Floorboard Creak):"); for (const [a, b, d, w] of all.slice(0, 10)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
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
writeFileSync(join(jsonDir, "doors-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR);
let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(17) + IDEA[x.name]); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Doors / Containers redo, all new");
const lv = rows.map((x) => "  " + x.name.padEnd(17) + "now " + x.now.m.lufs.toFixed(1) + "  new " + x.m.lufs.toFixed(1) + " LUFS  (" + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + " dB)" +
  altRows.filter((a) => a.name === x.name).map((a) => "   alt" + (a.i + 1) + " " + a.m.lufs.toFixed(1)).join(""));
const altLines = altRows.map((a) => "- **" + a.name + "**, `" + slug(a.name) + "-alt" + (a.i + 1) + ".wav`: " + ALT_IDEA[a.name][a.i]);
writeFileSync(join(wavDir, "KEY.md"), "# Doors / Containers redo — all-new.wav: the " + rows.length + " redesigned sounds in section order, 0.4 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it, <slug>-2-new.wav the redesign (-alt<N>.wav an\n" +
  "# alternative archetype); all Normalize on, NOT loudness-matched (each is what its button plays). The new ones aim at\n" +
  "# the section's median, " + TARGET.toFixed(1) + " LUFS, with stated offsets (the small mechanisms under it, the vault over), at most\n" +
  "# Limiter " + LIMIT_MAX + "; a transient that cannot get there lands short rather than being squashed into it.\n\n```\n" + key.join("\n") + "\n```\n\n" +
  "## Alternatives (a different object, not a variation)\n\n" + altLines.join("\n") + "\n\n" +
  "## Loudness, before and after (BS.1770; a big gap makes the louder one sound better, so listen past it)\n\n```\n" + lv.join("\n") + "\n```\n\n" +
  "## KEPT (no file: today's sound stays)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + rows.length + " x2 WAVs + " + altRows.length + " alts, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, doors-redo.json");
