/* nature-redo.mjs — the NATURE presets audited and the weak ones redesigned. PROPOSAL / A-B material: nothing here is
 * wired into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better. AJ: "some of nature" would
 * benefit. Today's sound is always a valid outcome, and AJ's standing rule decides what happens to it:
 *   "Sometimes the originals really aren't that bad, but the joy of clicking the button repeatedly and getting variety is
 *   nice… someone may actually be looking for a more synth'd version."
 * so there are THREE outcomes, not two:
 *   REPLACED   the base loses clearly (a plain noise band pretending to be a lake or leaves; a "Drizzle" that is a 0.17 s
 *              footstep thud): a new base, <slug>-2-new.wav
 *   KEPT + ALTS today's holds up as the synth version (the rising-sine water drop, the 8-bit boulder, the synth thunderclap):
 *              it stays the base and the physical takes join its `_alts` (the button plays a random version per click),
 *              <slug>-alt<N>.wav
 *   KEPT       already on a physical engine and picked in an engine round, or the name IS a synth recipe (Brown Noise
 *              Wind): no file, the reason in KEY.md
 *
 *   node tools/proto/nature-redo.mjs            renders every design (now + new + alts), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/nature-redo.mjs ref        measures today's 44 (the level bar: their median and spread, the closest pairs)
 *   node tools/proto/nature-redo.mjs sep        separation only (renders the new ones, prints the named pairs and the closest)
 *   node tools/proto/nature-redo.mjs <slug>     one sound, measured, its WAVs written (no JSON, no all-new.wav)
 *   node tools/proto/nature-redo.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/nature-redo.mjs x '<js>' ...         measure patches built with the voices below (wind(), rain(), S["Water Ambient"]() ...)
 *
 * NATURE IS PHYSICAL, so the newer engines carry it, each for what it models:
 *   AIR       wind, a gust, a breeze, a hollow's moan: the WEATHER engine's wind (29, wxType 0): turbulence whose band and
 *             level follow the envelope, edge-tone whistles when strong. A hollow is a LOW, broad whistle (170 Hz, Q 22:
 *             blowing across a bottle) in a hall.
 *   RAIN      separate drops on a surface: weather rain (wxType 1). A drizzle is few, small drops; sleet is tiny hard
 *             drops with no bubbles; mist is many tiny drops that are almost all hiss.
 *   THUNDER   weather thunder (wxType 2): a bolt's N-waves arriving from its whole length; near = a crack, far = a roll.
 *   WATER     the FLOW engine (35): a stream's pockets (0), a waterfall (1), surf (2: waves building, breaking, drawing
 *             back over pebbles); a drop is the BUBBLE engine (14: the trapped bubble ringing up, Minnaert).
 *   LEAVES, GRAVEL, ICE, RATTLE   the PARTICLE engine (15): dense crisp contacts (leaves), low driven grinding (gravel),
 *             sparse ringing high ticks (ice), rattle that comes and goes (flicker) with a quake's shaking.
 *   EARTH     the ground's rumble is the wind engine with no air in it (tone 0, body 1, low-passed: buffeting) under
 *             IMPACT (19) knocks with a boom.
 *
 * THE FAMILY: 20 names bred in 2026-07 (Restless / Rushing / Misty / Frozen / Windswept / Quiet / Rolling / Gentle /
 * Howling x Hollow / Drizzle / Breeze / Rumble / Stream / Cascade / Gust / Squall / Tide / Rustle) were random breeds of
 * Thunder, Footstep, Earthquake Rumble, Water Ambient and Rustling Leaves: two Drizzles were footstep thuds, a Breeze and
 * a Gust were thunder booms, three were near-clones of other presets. They are two tables composed (ADJ, NOUN,
 * compose()), as in scifi-redo.mjs: the NOUN is the physical event and its engine, the ADJECTIVE its character. Howling
 * Squall (already on the weather engine, picked) is left alone.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, Normalize ON and NOT loudness-matched:
 * each WAV is what the app's button plays. `gain` on layer 1 (the whole sound's master gain) is the one number not from a
 * design: it lands the integrated loudness on today's section median plus a stated per-sound offset (a drop, a drizzle
 * and the quiet/gentle/misty ones under it, thunder, quakes and squalls over); a Limiter only where gain 1 cannot reach
 * it, capped at 0.4 and stepped down if it puts DC in. A kept base is never re-leveled.
 *
 * MEASUREMENT and SEPARATION are scifi-redo.mjs's (BS.1770 loudness, a full 4096-point FFT, a YIN pitch track, events,
 * texture; a feature distance where 1 is a clearly audible step). The separation set is the section as it would ship
 * plus five neighbours elsewhere (Cave Drip, Droplet Plink, Bubbling Stream, Feather Rustle, Sewer Drip); every alt is
 * checked against its own base AND the nearest other shipped base, since it plays from the same button.
 *
 * Writes soundtests/nature-redo/<slug>-1-now.wav, <slug>-2-new.wav, <slug>-alt<N>.wav, all-new.wav + KEY.md, and
 * tools/new-presets/nature-redo.json ({ name: full preset with _vary, _alts, layers last }) for every sound that changes,
 * a kept base included (its entry is today's preset, untouched, plus the new `_alts`).
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
const SECTION = CATS.find((c) => c[0] === "Nature")[1];
const REFS = ["Cave Drip", "Droplet Plink", "Bubbling Stream", "Feather Rustle", "Sewer Drip"];   // water and rustle neighbours in other sections, in the separation set

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

// ---- the reference: today's 44
const refCache = new Map();
function refRow(name) {
  if (!refCache.has(name)) { const m = measure(render(PRESETS[name])); refCache.set(name, { name, m, f: features(m) }); }
  return refCache.get(name);
}
if (arg === "ref") {
  for (const name of SECTION) console.log(name.padEnd(18) + "wave " + PRESETS[name].wave + "  " + fmt(refRow(name).m));
  const e = SECTION.map((n) => refRow(n).m.lufs).sort((a, b) => a - b);
  console.log("\nNATURE (" + SECTION.length + ") median " + median(e).toFixed(1) + " LUFS, range " + e[0].toFixed(1) + " to " + e[e.length - 1].toFixed(1) +
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
    if (k === "duration" && STRETCH.has(l.wave) && v <= 12) continue;   // the stretch engines take a longer Duration (Thunder's takes are 2.4 s, Night Insects 3 s)
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
const S = {};
// ---- the weather engine's other two models, and the flow engine's surf
// rain (29, wxType 1): separate drops on a surface (0 hard, 1 leaves, 2 water) over a diffuse hiss; the envelope is the
// RATE, so a swell is the shower thickening
function rain(o) {
  const p = { wave: 29, wxType: 1, wxDensity: Math.round(cl(o.density, 5, 4000)), wxDrop: r2(cl(o.drop ?? 1.2, 0.3, 4)), wxSpread: r2(o.spread ?? 8), wxSurface: o.surface ?? 0,
    wxHiss: r2(cl(o.hiss ?? 0.4, 0, 1)), wxBubbles: r2(o.bubbles ?? 0.7), wxRing: r2(o.ring ?? 1), wxTone: r2(cl(o.tone ?? 0.5, 0, 1)), wxBody: r2(cl(o.body ?? 0, 0, 1)), wxSeed: o.seed ?? 1 };
  if (o.sheets) p.wxSheets = r2(o.sheets);
  return chassis(p, Object.assign({ hp: 40, width: 0.8 }, o));
}
// thunder (29, wxType 2): a bolt's N-waves arriving from its whole length; the envelope is a plain gain
function thunder(o) {
  return chassis({ wave: 29, wxType: 2, wxDistance: r2(cl(o.distance, 0.2, 10)), wxBolt: o.bolt ?? 0, wxRoll: r2(cl(o.roll ?? 1.6, 0.5, 6)), wxPulse: r2(o.pulse ?? 2.5),
    wxCrackle: r2(cl(o.crackle ?? 0.5, 0, 1)), wxHeight: Math.round(o.height ?? 2500), wxLength: Math.round(o.len ?? 2500), wxTone: r2(cl(o.tone ?? 0.5, 0, 1)), wxSeed: o.seed ?? 1 },
    Object.assign({ atk: 0.001, hold: 0, dec: 0, sus: 1, rel: 0.06, width: 0.8 }, o));
}
// surf (35, flowType 2): waves building, breaking and drawing back
function surf(o) {
  return chassis({ wave: 35, flowType: 2, flowPeriod: r2(cl(o.period ?? 3, 2, 14)), flowWaveSize: r2(cl(o.wsize ?? 0.5, 0.05, 1.3)), flowDrawback: r2(cl(o.drawback ?? 0.3, 0, 1)),
    flowPhase: r2(o.phase ?? 0), flowWaves: o.waves ?? 1, flowBody: r2(cl(o.body ?? 0.4, 0, 1)), flowTone: r2(cl(o.tone ?? 0.5, 0, 1)), flowDistance: r2(cl(o.distance ?? 0.2, 0, 1)),
    flowSeed: o.seed ?? 1 }, Object.assign({ atk: 0.02, hold: 0, dec: 0, sus: 1, rel: 0.45, cut: 12000, width: 0.75 }, o));
}
// the recurring parts, as physical events
const leaves = (o) => part(Object.assign({ rate: 110, tone: 0.82, decay: 0.05, spread: 0.9, hp: 900, width: 0.85 }, o));          // dry leaves: dense crisp contacts
const gravel = (o) => part(Object.assign({ rate: 70, tone: 0.4, decay: 0.12, spread: 0.85, drive: 0.25, width: 0.6 }, o));          // grit and gravel grinding
const iceTicks = (o) => part(Object.assign({ rate: 14, tone: 1, decay: 0.35, spread: 0.95, hp: 2500, width: 0.9 }, o));             // ice: sparse ringing high ticks
const rumbleBed = (o) => wind(Object.assign({ int: 0.85, gust: 0.7, gustRate: 2, tone: 0, body: 1, cut: 260, width: 0.7 }, o));      // the ground's low rumble: buffeting with no air

// ============================================================================================================
// THE NAMED DESIGNS (base REPLACED: Water Ambient, Rustling Leaves)
// WATER AMBIENT: the edge of a lake: small waves lapping at a stony shore (the surf model at its smallest: a short
// period, tiny waves, the pebbles' rattle as each draws back) and a trickle somewhere further off (a far stream). Today's
// is a resonant noise band at 160 Hz, which is the one sound a lake does not make.
S["Water Ambient"] = () => sound(
  surf({ period: 2.2, wsize: 0.18, drawback: 0.55, waves: 0, phase: 0.15, body: 0.3, tone: 0.5, distance: 0.25, seed: 41, atk: 0.12, rel: 0.5, dur: 2.2, reverb: 0.3, size: 0.6, width: 0.8 }),
  [[flow({ type: 0, amount: 0.12, bsize: 2.2, babble: 0.6, body: 0.1, rise: 0.4, tone: 0.45, distance: 0.7, seed: 17, atk: 0.3, sus: 1, rel: 0.5, dur: 2.2, reverb: 0.3, width: 0.7 }), 0, 0.45]]);

// RUSTLING LEAVES: a hand (or an animal) moving through dry leaves: dense crisp contacts coming in BUNCHES (two
// handfuls, the second smaller), a soft breath of air under them. Today's is a crushed noise band with no grain at all.
S["Rustling Leaves"] = () => sound(
  leaves({ rate: 140, tone: 0.8, decay: 0.05, spread: 0.9, atk: 0.06, hold: 0.12, dec: 0.3, sus: 0.25, rel: 0.2, dur: 0.8, flicker: [0.35, 9], reverb: 0.15, size: 0.4 }),
  [[leaves({ rate: 90, tone: 0.86, decay: 0.04, spread: 0.92, atk: 0.08, hold: 0.06, dec: 0.25, sus: 0.2, rel: 0.2, dur: 0.75, flicker: [0.4, 11], reverb: 0.15, size: 0.4 }), 0.55, 0.75],
   [wind({ int: 0.35, gust: 0.4, gustRate: 1.2, tone: 0.35, body: 0.05, seed: 9, atk: 0.3, sus: 1, rel: 0.4, dur: 1.4, hp: 300, reverb: 0.15, size: 0.4 }), 0, 0.3]]);

// ---- KEPT AS BASE, with new takes as _alts (today's still plays; clicking again brings the others)
const ALTS = {}, ALT_IDEA = {};
// FOOTSTEP: today's is a short low thud (a generic step, and the footstep set reads the BASE); the takes are the ground
ALTS["Footstep"] = [
  () => sound(imp({ tone: 0.3, decay: 0.12, punch: 0.7, grit: 0.3, dec: 0.06, rel: 0.05, dur: 0.35, reverb: 0.08, size: 0.3, width: 0.4 }),
    [[gravel({ rate: 160, tone: 0.42, decay: 0.08, spread: 0.85, drive: 0.3, atk: 0.003, hold: 0.04, dec: 0.12, sus: 0, rel: 0.05, dur: 0.3, width: 0.5 }), 0, 1.2],
     [gravel({ rate: 90, tone: 0.5, decay: 0.06, spread: 0.9, drive: 0.2, atk: 0.01, hold: 0.02, dec: 0.08, sus: 0, rel: 0.04, dur: 0.2, width: 0.5 }), 0.07, 0.7]]),
  () => sound(imp({ tone: 0.22, decay: 0.1, punch: 0.5, grit: 0.1, dec: 0.05, rel: 0.05, dur: 0.35, reverb: 0.08, size: 0.3, width: 0.4 }),
    [[leaves({ rate: 180, tone: 0.8, decay: 0.05, spread: 0.9, atk: 0.004, hold: 0.05, dec: 0.15, sus: 0, rel: 0.06, dur: 0.35, width: 0.6 }), 0, 1.3],
     [leaves({ rate: 80, tone: 0.86, decay: 0.04, spread: 0.92, atk: 0.02, hold: 0.02, dec: 0.1, sus: 0, rel: 0.05, dur: 0.25, width: 0.7 }), 0.09, 0.6]]),
];
ALT_IDEA["Footstep"] = ["on GRAVEL: the heel's thud and the stones grinding under it, a smaller crunch as the weight rolls off",
  "in DRY LEAVES: a soft heel and a crisp crackle of leaves crushed under it, a few more as the foot lifts"];

// WATER DROP: today's rising sine IS the game idiom for a drop (kept); the take is the physical drop into still water: the
// slap of contact, then the bubble it traps ringing UP in pitch (Minnaert), in a little space
ALTS["Water Drop"] = [
  () => sound(bub({ f: 1100, rate: 3, rise: 0.75, spread: 0.1, decay: 0.45, atk: 0.001, hold: 0.003, dec: 0.08, sus: 1, rel: 0.12, dur: 0.4, cut: 12000, reverb: 0.3, size: 0.5, rtone: 0.6, width: 0.4 }),
    [[imp({ tone: 0.85, decay: 0.02, punch: 0.6, grit: 0.05, dec: 0.01, rel: 0.02, dur: 0.1, width: 0.3 }), 0, 0.35]]),
];
ALT_IDEA["Water Drop"] = ["a drop into STILL WATER: the slap of contact, then the bubble it traps ringing up in pitch, a little room"];

// DRIPPING CAVE: today's echoing synth bloops stay; the take is a cave: drips falling into a pool at irregular moments, each
// a bubble ringing up, the cave's still air droning low under them, a long hall answering
ALTS["Dripping Cave"] = [
  () => sound(bub({ f: 820, rate: 4, rise: 0.7, spread: 0.65, decay: 0.55, atk: 0.001, hold: 0.004, dec: 0.1, sus: 1, rel: 0.5, dur: 1.9, cut: 9000, width: 0.7,
      conv: 0.5, convType: 1, convSize: 1.2, convTone: 0.4, delay: 0.25, delayTime: 0.31, delayFb: 0.3 }),
    [[wind({ int: 0.3, gust: 0.2, gustRate: 0.4, tone: 0, body: 0.6, seed: 13, atk: 0.4, sus: 1, rel: 0.5, dur: 1.9, cut: 500, width: 0.8 }), 0, 0.5]]),
];
ALT_IDEA["Dripping Cave"] = ["a CAVE: drips into a pool at irregular moments, each ringing up in pitch, the still air droning low, a long hall and an echo"];

// BOULDER RUMBLE: today's crushed saw rumble is an 8-bit rock slide and stays; the takes are a boulder ROLLING (the
// ground's rumble, gravel grinding under it, knocks as it bounces) and a ROCKSLIDE (a dense pour of rubble, a heavy
// knock to start it)
ALTS["Boulder Rumble"] = [
  () => sound(rumbleBed({ int: 0.8, gust: 0.75, gustRate: 3, seed: 27, atk: 0.15, hold: 0.6, dec: 0.6, sus: 0.4, rel: 0.4, dur: 1.9, reverb: 0.3, size: 0.7, rtone: 0.3 }),
    [[gravel({ rate: 40, tone: 0.22, decay: 0.3, spread: 0.85, drive: 0.35, atk: 0.1, hold: 0.7, dec: 0.5, sus: 0.3, rel: 0.3, dur: 1.8, reverb: 0.3, size: 0.7 }), 0, 1.1],
     [imp({ tone: 0.15, decay: 0.35, punch: 0.9, grit: 0.4, dec: 0.12, rel: 0.2, dur: 0.6, boom: 0.6, boomFreq: 50, boomDrop: 0.4, boomDecay: 0.3, reverb: 0.3, size: 0.7 }), 0.32, 0.8],
     [imp({ tone: 0.2, decay: 0.3, punch: 0.8, grit: 0.4, dec: 0.1, rel: 0.2, dur: 0.6, boom: 0.5, boomFreq: 60, boomDrop: 0.4, boomDecay: 0.25, reverb: 0.3, size: 0.7 }), 0.95, 0.6]]),
  () => sound(rumbleBed({ int: 0.95, gust: 0.5, gustRate: 2, seed: 31, atk: 0.05, hold: 0.5, dec: 0.9, sus: 0.3, rel: 0.4, dur: 1.9, reverb: 0.35, size: 0.8, rtone: 0.3 }),
    [[gravel({ rate: 110, tone: 0.3, decay: 0.25, spread: 0.8, drive: 0.35, atk: 0.08, hold: 0.5, dec: 0.8, sus: 0.2, rel: 0.3, dur: 1.85, reverb: 0.35, size: 0.8 }), 0, 1.0],
     [gravel({ rate: 18, tone: 0.18, decay: 0.5, spread: 0.95, drive: 0.4, atk: 0.05, hold: 0.6, dec: 0.7, sus: 0.2, rel: 0.3, dur: 1.8, reverb: 0.35, size: 0.8 }), 0.05, 1.0],
     [imp({ tone: 0.12, decay: 0.45, punch: 0.95, grit: 0.5, dec: 0.15, rel: 0.25, dur: 0.8, boom: 0.7, boomFreq: 45, boomDrop: 0.5, boomDecay: 0.4, reverb: 0.35, size: 0.8 }), 0, 0.8]]),
];
ALT_IDEA["Boulder Rumble"] = ["a boulder ROLLING: the ground's rumble, gravel grinding under it, two knocks as it bounces",
  "a ROCKSLIDE: a heavy knock sets it off, then a dense pour of rubble and big stones over the rumble"];

// EARTHQUAKE RUMBLE: today's deep crushed rumble stays; the take is the ground SHAKING: a low unsteady rumble swelling
// and easing, and everything loose rattling with it (the rattle comes and goes with the shaking)
ALTS["Earthquake Rumble"] = [
  () => sound(rumbleBed({ int: 1, gust: 0.85, gustRate: 3.5, cut: 180, seed: 53, atk: 0.4, hold: 0.5, dec: 0.8, sus: 0.3, rel: 0.4, dur: 2, reverb: 0.4, size: 0.85, rtone: 0.2 }),
    [[part({ rate: 45, tone: 0.55, decay: 0.12, spread: 0.7, drive: 0.2, flicker: [0.5, 7], atk: 0.45, hold: 0.45, dec: 0.8, sus: 0.2, rel: 0.3, dur: 2, reverb: 0.3, size: 0.6, width: 0.8 }), 0, 0.55],
     [osc({ wave: 0, f: 38, sub: 0.5, trem: [0.5, 7], atk: 0.4, hold: 0.5, dec: 0.8, sus: 0.3, rel: 0.4, dur: 2, cut: 200, width: 0.3 }), 0, 0.55]]),
];
ALT_IDEA["Earthquake Rumble"] = ["the ground SHAKING: a low unsteady rumble swelling and easing, everything loose rattling with it, a deep throb under it"];

// THUNDERCLAP: today's synth clap stays (Thunder's base was kept the same way); the takes are the weather engine's bolt
// CLOSE (the nearest channel arriving at once: a crack, then a short roll)
ALTS["Thunderclap"] = [
  () => thunder({ distance: 0.25, bolt: 0, roll: 1.1, pulse: 3.5, crackle: 0.9, height: 1500, len: 1500, tone: 0.7, seed: 307, dur: 2, reverb: 0.6, size: 0.9, rtone: 0.2 }),
  () => thunder({ distance: 0.45, bolt: 0, roll: 1.5, pulse: 3, crackle: 0.85, height: 2000, len: 3000, tone: 0.6, seed: 331, dur: 2, reverb: 0.6, size: 0.9, rtone: 0.2 }),
];
ALT_IDEA["Thunderclap"] = ["a strike OVERHEAD (250 m): the crack of the nearest channel all at once, then a short roll", "a strike NEARBY (450 m): a ripping crack along a long channel, rolling off"];

// THUNDER 2: today's stays; the takes roll rather than strike (Thunder's own takes are a strike at 0.5, 1.5 and 7 km)
ALTS["Thunder 2"] = [
  () => sound(thunder({ distance: 1.0, bolt: 0, roll: 1.4, pulse: 3, crackle: 0.65, height: 2500, len: 2500, tone: 0.65, seed: 353, dur: 2.4, reverb: 0.7, size: 0.95, rtone: 0.15 }),
    [[thunder({ distance: 1.6, bolt: 0, roll: 1.2, pulse: 3, crackle: 0.5, height: 2500, len: 2000, tone: 0.6, seed: 359, dur: 1.5, reverb: 0.7, size: 0.95, rtone: 0.15 }), 0.85, 1]]),
  () => thunder({ distance: 0.9, bolt: 0, roll: 2.0, pulse: 2.2, crackle: 0.75, height: 4500, len: 6000, tone: 0.6, seed: 367, dur: 2.6, reverb: 0.7, size: 0.95, rtone: 0.15 }),
];
ALT_IDEA["Thunder 2"] = ["a DOUBLE strike: a bolt at 1 km and a second one further off just after it, their rolls overlapping", "a TALL bolt at 900 m: a long ripping crack down its whole length, then the roll"];

// WIND GUST 2: today's resonant noise swell stays (a classic synth gust; Wind Gust has the weather takes); the takes
// are a gust that MOVES something: through the trees (the leaves rustle as it peaks), and kicking up sand (fine grit)
ALTS["Wind Gust 2"] = [
  () => sound(wind({ int: 0.85, gust: 0.55, gustRate: 1.4, tone: 0.4, body: 0.25, seed: 71, atk: 0.4, hold: 0.15, dec: 0.5, sus: 0.4, rel: 0.6, dur: 1.9, reverb: 0.35, size: 0.8, width: 0.75 }),
    [[leaves({ rate: 160, tone: 0.84, decay: 0.05, spread: 0.85, atk: 0.45, hold: 0.15, dec: 0.5, sus: 0.3, rel: 0.5, dur: 1.85, flicker: [0.3, 6], reverb: 0.35, size: 0.8 }), 0.05, 0.7]]),
  () => sound(wind({ int: 0.95, gust: 0.4, gustRate: 2, tone: 0.5, body: 0.3, seed: 83, atk: 0.3, hold: 0.1, dec: 0.6, sus: 0.3, rel: 0.6, dur: 1.9, reverb: 0.3, size: 0.7, width: 0.8 }),
    [[part({ rate: 200, tone: 0.95, decay: 0.01, spread: 0.4, hp: 3500, atk: 0.35, hold: 0.1, dec: 0.6, sus: 0.25, rel: 0.5, dur: 1.85, width: 0.9 }), 0.05, 0.6]]),
];
ALT_IDEA["Wind Gust 2"] = ["a gust through the TREES: the air swells and the leaves rustle as it peaks", "a gust kicking up SAND: the air with a fine hiss of grit blown along in it"];

// ============================================================================================================
// THE FAMILY: 20 names bred in 2026-07 as an ADJECTIVE x a NOUN (Howling Squall, the 21st, was already redone on the
// weather engine and is kept). Today they are random breeds: two "Drizzles" are 0.17 s footstep thuds, "Rushing
// Breeze" and "Windswept Gust" are thunder booms, "Rushing Tide" and "Restless Hollow" clone Earthquake Rumble, "Restless
// Tide" clones Water Ambient. So they are two tables composed here: the NOUN is the physical event and its engine, the
// ADJECTIVE its character; compose() is the only place they meet.
const ADJ = {
  Restless: { idea: "unsteady: gusting hard and fast, coming and going in bursts", gust: 0.9, gustRate: 2.6, burst: [0.5, 2.2], seed: 3 },
  Rushing:  { idea: "fast and strong: more of it, brighter, arriving quickly behind a rush of air", energy: 1.35, tone: 0.12, atkMul: 0.35, extra: "rush", lvl: 1, seed: 5 },
  Misty:    { idea: "far and soft: muffled, darker, a lot of space around it", energy: 0.7, tone: -0.2, far: true, lvl: -2, seed: 7 },
  Frozen:   { idea: "icy: brittle and bright, thin, ice ticking and tinkling through it", tone: 0.22, ice: true, lvl: -1, seed: 11 },
  Windswept:{ idea: "blown: a wide wind sweeping over it (on a wind itself, the grit it carries)", extra: "wind", lvl: 0, seed: 13 },
  Quiet:    { idea: "small and near: little of it, soft, close", energy: 0.45, lvl: -4, dry: true, seed: 17 },
  Rolling:  { idea: "slow waves: swelling and easing in long rolls", roll: [0.65, 0.7], lvl: 0, seed: 19 },
  Gentle:   { idea: "light and slow: soft, arriving gradually, a little darker", energy: 0.6, tone: -0.08, atkMul: 1.8, lvl: -2.5, seed: 23 },
  Howling:  { idea: "the air whistling: strong, pure edge tones singing in it", howl: true, lvl: 0.5, seed: 29 },
};
const NOUN = {
  Hollow:  { idea: "wind across a hollow (a cave mouth, a hollow trunk): a low moaning edge tone and the hollow's own boom", lvl: 0 },
  Drizzle: { idea: "light rain: separate small drops on a surface, a soft hiss", lvl: -1 },
  Breeze:  { idea: "a light wind, steady, leaves stirring in it", lvl: -1.5 },
  Rumble:  { idea: "thunder far off: no crack, a dark roll", lvl: 0.5 },
  Stream:  { idea: "a stream: gurgles from the same pockets, babbling", lvl: -1 },
  Cascade: { idea: "water falling over rocks: a small waterfall's roar with the splashing on top", lvl: 0 },
  Gust:    { idea: "one gust: the air swelling and falling away", lvl: 0 },
  Squall:  { idea: "a storm squall: hard gusting wind with rain driven in it", lvl: 1 },
  Tide:    { idea: "waves on a shore: building, breaking, drawing back", lvl: 0 },
  Rustle:  { idea: "dry leaves stirred: crisp contacts in bunches", lvl: -1 },
};
const FAMILY = SECTION.filter((n) => { const [a, b] = n.split(" "); return ADJ[a] && NOUN[b] && n !== "Howling Squall"; });
const tn = (A, x) => cl(x + (A.tone || 0), 0, 1);
function compose(name) {
  const [an, nn] = name.split(" "), A = ADJ[an], E = A.energy ?? 1, seed = seedOf(name);
  const atk = (x) => r3(cl(x * (A.atkMul ?? 1), 0.005, 0.5));
  // the shared Space: far = a big dark room and a low-pass; dry = little room; otherwise a modest outdoor reverb
  const sp = A.far ? { reverb: 0.55, size: 0.9, rtone: 0.25, cut: 2400 } : A.dry ? { reverb: 0.1, size: 0.35, rtone: 0.5 } : { reverb: 0.3, size: 0.7, rtone: 0.45 };
  const mov = Object.assign({}, A.burst ? { flicker: A.burst } : {}, A.roll ? { trem: A.roll } : {});
  const env = { atk: atk(0.35), hold: 0, dec: 0, sus: 1, rel: 0.5, dur: 2 };
  let core, layers = [];
  if (nn === "Hollow") {
    core = wind(Object.assign({ int: cl(0.65 * E, 0, 1), gust: A.gust ?? 0.5, gustRate: A.gustRate ?? 0.9, tone: tn(A, 0.2), body: 0.65,
      whistle: A.howl ? 0.95 : 0.6, whistles: A.howl ? 3 : 1, f: A.howl ? 420 : 170, q: A.howl ? 90 : 22, seed, atk: atk(0.4), hold: 0.25, dec: 0.6, sus: 0.55, rel: 0.6, dur: 2,
      conv: 0.45, convType: 1, convSize: 1.1, convTone: 0.35 }, sp, mov, { width: 0.7 }));
  } else if (nn === "Drizzle") {
    const ice = A.ice, mist = A.far;
    const burst = an === "Restless";
    core = rain(Object.assign({ density: Math.round((mist ? 420 : ice ? 160 : burst ? 240 : 90) * E), drop: mist ? 0.3 : ice ? 0.45 : an === "Rushing" ? 1.0 : 0.75, spread: mist ? 14 : 8,
      surface: ice || burst ? 0 : an === "Gentle" ? 1 : 2, hiss: mist ? 0.8 : 0.45, bubbles: ice ? 0 : 0.6, ring: 1.2, tone: tn(A, mist ? 0.75 : 0.5), seed }, env, sp, mov,
      mist ? { cut: 12000 } : {}, burst ? { trem: [0.65, 1.4] } : {}, { width: 0.85 }));
  } else if (nn === "Breeze") {
    core = wind(Object.assign({ int: cl(0.45 * E, 0, 1), gust: A.gust ?? 0.35, gustRate: A.gustRate ?? 0.6, tone: tn(A, 0.3), body: 0.12, seed }, env, sp, mov, { width: 0.8 }));
    layers.push([leaves(Object.assign({ rate: 55, tone: 0.84, decay: 0.05, spread: 0.92 }, env, sp, { width: 0.9 })), 0.1, 0.45]);
  } else if (nn === "Rumble") {
    const roll = A.roll ? 3.4 : 2.2;
    core = thunder(Object.assign({ distance: A.far ? 6 : A.extra === "rush" ? 2.5 : 4, bolt: 1, roll, pulse: 3, crackle: 0.25, height: 3500, len: A.roll ? 8000 : 5000,
      tone: tn(A, 0.55), seed, dur: A.roll ? 3 : 2.4 }, sp, A.far ? {} : { reverb: 0.6, size: 0.95, rtone: 0.15 }));
  } else if (nn === "Stream") {
    core = flow(Object.assign({ type: 0, amount: cl(0.3 * E, 0.02, 1), bsize: A.ice ? 1.2 : 2, babble: A.burst ? 0.9 : 0.6, body: 0.2, rise: 0.4, tone: tn(A, 0.5), distance: A.far ? 0.6 : 0.2,
      seed }, env, sp, mov, A.ice ? { cut: 1500 } : {}));
  } else if (nn === "Cascade") {
    core = flow(Object.assign({ type: 1, amount: cl(0.42 * E, 0.05, 1), bsize: 1.6, babble: A.burst ? 0.9 : 0.7, body: A.dry ? 0.15 : 0.35, rise: 0.3, tone: tn(A, 0.55),
      distance: A.far ? 0.6 : A.dry ? 0.05 : 0.2, seed }, env, sp, mov));
    layers.push([flow(Object.assign({ type: 0, amount: cl(0.25 * E, 0.02, 1), bsize: 1.3, babble: 0.85, body: 0.05, rise: 0.5, tone: tn(A, 0.6), distance: 0.1, seed: seed + 1 }, env, sp, mov)), 0, 0.6]);
  } else if (nn === "Gust") {
    core = wind(Object.assign({ int: cl(0.9 * E, 0, 1), gust: A.gust ?? 0.5, gustRate: A.gustRate ?? 1.2, tone: tn(A, 0.4), body: 0.35, seed, atk: atk(0.45), hold: 0.1, dec: 0.6, sus: 0.25, rel: 0.6,
      dur: 1.9 }, A.howl ? { whistle: 0.8, whistles: 3, f: 900, q: 90 } : {}, sp, mov, { width: 0.85 }));
  } else if (nn === "Squall") {
    core = wind(Object.assign({ int: 1, gust: 0.8, gustRate: 1.8, tone: tn(A, 0.45), body: 0.5, seed }, A.ice ? { whistle: 0.5, whistles: 2, f: 1400, q: 80 } : {}, env, { atk: atk(0.2), sus: 0.85 }, sp, mov, { width: 0.85 }));
    layers.push([rain(Object.assign({ density: A.ice ? 500 : 650, drop: A.ice ? 0.5 : 1.4, spread: 6, surface: 0, hiss: 0.5, bubbles: A.ice ? 0 : 0.5, tone: tn(A, 0.5), seed: seed + 2 }, env, sp)), 0, 0.8]);
  } else if (nn === "Tide") {
    const choppy = !!A.burst;
    core = surf(Object.assign({ period: choppy ? 2.1 : 2.6, wsize: choppy ? 0.4 : cl(0.6 * E, 0.05, 1.3), drawback: choppy ? 0.35 : 0.5, waves: choppy ? 2 : 1, phase: 0, body: 0.5, tone: tn(A, 0.5),
      seed }, sp, { atk: atk(0.05), rel: 0.5, dur: 2.4 }));
  } else if (nn === "Rustle") {
    core = leaves(Object.assign({ rate: Math.round(110 * E), tone: tn(A, 0.82), seed }, sp, mov, { atk: 0.08, hold: 0.25, dec: 0.4, sus: 0.3, rel: 0.25, dur: A.roll ? 1.6 : 1.0 }, A.roll ? { trem: [0.7, 2.2] } : {}));
    layers.push([wind(Object.assign({ int: 0.3, gust: 0.4, gustRate: 1, tone: 0.3, body: 0.05, seed, hp: 300 }, sp, { atk: 0.2, sus: 1, rel: 0.4, dur: A.roll ? 1.6 : 1.0 })), 0, 0.3]);
  }
  // ---- the adjective's extra layer
  const span = core.duration;
  if (A.extra === "rush") layers.push([wind({ int: 0.95, gust: 0.2, gustRate: 1, tone: tn(A, 0.55), body: 0.15, seed: seed + 3, atk: 0.35, hold: 0, dec: 0.5, sus: 0.15, rel: 0.4, dur: Math.min(2, span),
    reverb: sp.reverb, size: sp.size, width: 0.9 }), 0, 0.55]);
  if (A.extra === "wind") layers.push(nn === "Gust" ? [part({ rate: 200, tone: 0.93, decay: 0.01, spread: 0.45, hp: 3000, atk: 0.4, hold: 0.1, dec: 0.6, sus: 0.25, rel: 0.5, dur: 1.85, width: 0.95 }), 0.05, 0.6]
    : [wind({ int: 0.8, gust: 0.65, gustRate: 1.1, tone: 0.35, body: 0.35, seed: seed + 4, atk: 0.4, sus: 1, rel: 0.5, dur: Math.min(2, span), reverb: 0.3, size: 0.75, width: 0.95 }), 0, 0.6]);
  if (A.ice) layers.push([iceTicks({ rate: nn === "Drizzle" ? 30 : 14, atk: 0.2, sus: 1, rel: 0.3, dur: Math.min(2, span), reverb: 0.3, size: 0.6 }), 0, nn === "Drizzle" ? 0.7 : 0.55]);
  const p = sound(core, layers.slice(0, 3));
  return p;
}
for (const n of FAMILY) S[n] = () => compose(n);

// _vary: layer 1 only (the preset button's roll): the engine's seed (a new gust curve, new drops, a new bolt), and its tone
function varyFor(p) {
  const w = Math.round(p.wave);
  if (w === 29) return p.wxType === 1 ? { wxSeed: 1, wxDensity: 0.15, wxDrop: 0.1 } : p.wxType === 2 ? { wxSeed: 1, wxRoll: 0.15, wxTone: 0.08 } : { wxSeed: 1, wxGust: 0.15, wxTone: 0.08 };
  if (w === 35) return p.flowType === 2 ? { flowSeed: 1, flowPeriod: 0.12, flowWaveSize: 0.15 } : { flowSeed: 1, flowAmount: 0.15, flowBabble: 0.1 };
  if (w === 15) return { particleRate: 0.2, particleTone: 0.06, particleSpread: 0.1 };
  return { freq: 0.1 };
}
const IDEA = {
  "Water Ambient": "a lake's edge: small waves lapping at a stony shore, the pebbles rattling as each draws back, a trickle further off",
  "Rustling Leaves": "a hand moving through dry leaves: crisp contacts in two bunches (the second smaller), a soft breath of air under them",
};
for (const n of FAMILY) { const [a, b] = n.split(" "); IDEA[n] = "[" + a + "] " + ADJ[a].idea + " x [" + b + "] " + NOUN[b].idea; }
const KEPT = {
  "Petal Scatter": "particle engine already: a soft scatter of light contacts, high-passed; physical and right, and its grain separates it from Rustling Leaves' crisp bunches",
  "Wind Gust": "the weather engine, picked (B, C, D as takes)",
  "Wave of Water": "flow surf takes picked (all four, incl. today's)",
  "Thunder": "picked: today's as base + three weather bolts",
  "Rain": "weather rain, picked (three surfaces)",
  "Ship Hull Creak": "friction engine, picked in the friction round",
  "Rope Creak": "friction engine, picked in the friction round",
  "Waterfall": "flow takes picked (all four, incl. today's)",
  "Ocean Surf": "flow takes picked (all four, incl. today's)",
  "Campfire Crackle": "already weather roar + particle crackle (the fire round's build)",
  "Bird Trill": "chirp engine takes already in _alts (\"every chirp is perfect\"); today's sine trill is the synth version among them",
  "Stream Babble": "flow, picked (D trickle)",
  "Howling Squall": "weather wind, picked (three takes)",
  "Brown Noise Wind": "the name IS the recipe: brown noise shaped as wind. A synth texture on purpose; a physical model would make it a different preset",
};
// Per-sound level offset from the section median, by design (dB). Family offsets come from the tables (adj.lvl + noun.lvl).
const LEVEL_OFFSET = { "Water Ambient": -1, "Rustling Leaves": -1.5, "Footstep": -1, "Water Drop": -2, "Dripping Cave": -1.5, "Boulder Rumble": 0.5, "Earthquake Rumble": 1,
  "Thunderclap": 1, "Thunder 2": 0.5, "Wind Gust 2": 0 };
const VARY = {
  "Water Ambient": { flowSeed: 1, flowPeriod: 0.12, flowWaveSize: 0.15 },
  "Rustling Leaves": { particleRate: 0.2, particleTone: 0.06, flickerRate: 0.2 },
};

// Family names whose today's sound holds up as a synth take: KEPT as base, the composed design added as an _alt
const KEEP_BASE_FAMILY = {};
for (const n of Object.keys(KEEP_BASE_FAMILY)) { ALTS[n] = [() => compose(n)]; ALT_IDEA[n] = [IDEA[n]]; delete S[n]; }

if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e), r = render(p); console.log(fmt(measure(r)) + "\n      " + curve(r)); } process.exit(0); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "nature-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in steps
// of 0.05 (the smallest that reaches the target), capped at LIMIT_MAX: past that a transient is being squashed to buy
// loudness it does not have, so a sound that cannot get there lands short and the report says by how much.
const LIMIT_MAX = 0.4, LIMIT_THUNDER = 0.9;
// written into KEY.md: the ones the level rule could not reach, and why (from the last full run's report)
const SHORT_NOTE = "## Landed short of their bar (by design, not squashed)\n\n- **Thunder** (the weather bolt is nearly all low end, which BS.1770 discounts; past a small Limiter it puts DC in, so the DC guard stops it): Thunderclap alt1/alt2 -20.1/-21.2 (a close crack is peaky; its point is the peak), Thunder 2 alt1 -22.2 (two bolts), Rolling Rumble -21.1, Rushing Rumble -18.7, against Thunder's picked takes at -17.8. Misty Rumble -20.1 is its stated -2 dB.\n- **Wind Gust 2 alt2** -12.7 against its base's -9.8 (the base is a loud resonant band; the sand gust is broadband air).\n- **Restless Drizzle** -15.8 against -13.8, **Earthquake Rumble alt1** -16.9 against its base's -15.7.\n\n";
function level(p, target, LIM = LIMIT_MAX) {
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - m.lufs) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  let lo = 0, hi = Math.round(LIM / 0.05);
  p.limiter = LIM; m = measure(render(p));
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
  const o = {}; for (const [k, v] of Object.entries(p)) if (k !== "layers" && k !== "_vary" && k !== "_alts") o[k] = v;
  o._vary = vary; if (alts && alts.length) o._alts = alts; if (p.layers) o.layers = p.layers;
  return o;
}
const TARGET = median(SECTION.map((n) => refRow(n).m.lufs));
const REDO = SECTION.filter((n) => S[n]);                       // base replaced (+ maybe alts)
const KEEPALT = SECTION.filter((n) => !S[n] && ALTS[n]);        // today's base kept, new takes as _alts
const ALL = SECTION.filter((n) => S[n] || ALTS[n]);
const lvlOf0 = (name) => FAMILY.includes(name) ? (ADJ[name.split(" ")[0]].lvl || 0) + (NOUN[name.split(" ")[1]].lvl || 0) : (LEVEL_OFFSET[name] || 0);
// THE LEVEL RULES. (1) A new base: the section median plus its offset. (2) A take beside a KEPT base sits at that base's
// own level (clamped to the median +-3 dB), because the button plays them in turn: a take 5 dB under its base sounds
// broken (AJ, the car engine's base and takes). (3) THUNDER (weather wxType 2) cannot reach the median: it is nearly all
// low end, which K-weighting discounts, and a Limiter on it puts DC in. Its bar is Thunder's three PICKED takes (their
// median), with the Limiter up to 0.9 as they use, DC-guarded.
const isThunder = (p) => p.wave === 29 && p.wxType === 2;
const THUNDER_TARGET = median(PRESETS["Thunder"]._alts.map((a) => measure(render(a)).lufs));
const lvlOf = (name) => lvlOf0(name);
function targetOf(name, p, kept) {
  if (isThunder(p)) return THUNDER_TARGET + (FAMILY.includes(name) ? lvlOf(name) - NOUN.Rumble.lvl : 0);
  if (kept) return cl(refRow(name).m.lufs, TARGET - 3, TARGET + 3);
  return TARGET + lvlOf(name);
}
const varyOf = (name, p) => VARY[name] || varyFor(p);
const only = arg && arg !== "sep" ? arg : null;
if (only && !ALL.some((n) => slug(n) === only)) { console.log("no design named " + only + "; slugs: " + ALL.map(slug).join(", ")); process.exit(1); }
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {}, altRows = [];
console.log("Nature median " + TARGET.toFixed(1) + " LUFS (the level target); thunder bar " + THUNDER_TARGET.toFixed(1) + " (Thunder's picked takes)");
const fmtLv = (p, m, tgt) => (p.layers ? JSON.parse(p.layers).length + 1 : 1) + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
  ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")";
const strip = (p) => { const q = Object.assign({}, p); delete q._vary; delete q._alts; return q; };
for (const name of ALL) {
  const s = slug(name);
  if (only && only !== s) continue;
  const kept = !S[name], now = refRow(name);
  const p = kept ? strip(PRESETS[name]) : S[name]();
  durCheck(name, p);
  const tgt = targetOf(name, p, false), m = kept ? now.m : level(p, tgt, isThunder(p) ? LIMIT_THUNDER : LIMIT_MAX), r = render(p);
  const alts = (ALTS[name] || []).map((fn, i) => { const a = fn(); durCheck(name + " alt " + (i + 1), a); const at = targetOf(name, a, kept); const am = level(a, at, isThunder(a) ? LIMIT_THUNDER : LIMIT_MAX); const ar = render(a); altRows.push({ name, i, p: a, r: ar, m: am, f: features(am), t: at }); return a; });
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    if (!kept) wav(s + "-2-new.wav", r, name);
    alts.forEach((a, i) => wav(s + "-alt" + (i + 1) + ".wav", render(a), name + " (alt " + (i + 1) + ")"));
  }
  json[name] = asPreset(p, kept ? PRESETS[name]._vary : varyOf(name, p), alts);
  for (const k of Object.keys(json[name]._vary)) if (!PRANGE[k]) console.log("  !! " + name + " _vary: " + k + " is not a PARAMS row");
  rows.push({ name, slug: s, p, r, m, f: features(m), now, kept });
  console.log(name.padEnd(18) + (kept ? "KEPT " : "NEW ") + fmt(m) + "\n      " + (kept ? "today's base, unchanged" : fmtLv(p, m, tgt)) +
    altRows.filter((x) => x.name === name).map((x) => "\n  " + "".padEnd(12) + "ALT" + (x.i + 1) + " " + fmt(x.m).replace(/\n/g, "\n    ") + "\n      " + fmtLv(x.p, x.m, x.t)).join("") +
    (kept ? "" : "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    ")));
  if (only) { console.log("      " + curve(r)); altRows.filter((x) => x.name === name).forEach((x) => console.log("  alt" + (x.i + 1) + " " + curve(x.r))); }
}
if (only) process.exit(0);

// ---- separation: the whole section as it would ship (new base where replaced, today's elsewhere), plus five water and
// rustle neighbours elsewhere; each alt against every shipped base (an alt plays from the same button, so it must not be
// mistaken for a NEIGHBOUR's sound)
const shipped = SECTION.map((n) => { const x = rows.find((q) => q.name === n && !q.kept); return x || Object.assign({ kept: true }, refRow(n)); }).concat(REFS.map((n) => Object.assign({ ref: true }, refRow(n))));
const D = (a, b, set) => { const x = set.find((q) => q.name === a), y = set.find((q) => q.name === b); return [dist(x.f, y.f), why(x.f, y.f)]; };
const todaySet = SECTION.map((n) => refRow(n)).concat(REFS.map((n) => refRow(n)));
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or body, or a clear shape step) — NEW (today)");
const GROUPS = [["Rustling Leaves", "Rolling Rustle", "Petal Scatter", "Feather Rustle"], ["Water Ambient", "Restless Tide", "Rushing Tide", "Ocean Surf", "Wave of Water"],
  ["Rushing Drizzle", "Misty Drizzle", "Restless Drizzle", "Frozen Drizzle", "Gentle Drizzle", "Rain"], ["Restless Hollow", "Howling Hollow", "Howling Squall"],
  ["Misty Rumble", "Rushing Rumble", "Rolling Rumble", "Thunder", "Thunder 2", "Earthquake Rumble", "Boulder Rumble"],
  ["Frozen Stream", "Stream Babble", "Bubbling Stream"], ["Restless Cascade", "Quiet Cascade", "Windswept Cascade", "Waterfall"],
  ["Windswept Gust", "Wind Gust", "Wind Gust 2", "Rushing Breeze", "Brown Noise Wind"], ["Frozen Squall", "Howling Squall", "Rain"]];
for (const g of GROUPS) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
  const [d, w] = D(g[i], g[j], shipped), [d0] = D(g[i], g[j], todaySet);
  console.log("  " + d.toFixed(2) + " (" + d0.toFixed(2) + ")  " + g[i] + " / " + g[j] + "   (" + w + ")");
}
console.log("  each alt: its own base, and the nearest OTHER shipped base");
for (const a of altRows) {
  const base = shipped.find((x) => x.name === a.name);
  let best = null; for (const x of shipped) if (x.name !== a.name) { const d = dist(a.f, x.f); if (!best || d < best[0]) best = [d, x.name, why(a.f, x.f)]; }
  console.log("    " + (a.name + " alt" + (a.i + 1)).padEnd(24) + " own base " + dist(a.f, base.f).toFixed(2) + "   nearest other " + best[0].toFixed(2) + " " + best[1] + "  (" + best[2] + ")");
}
const all = []; for (let i = 0; i < shipped.length; i++) for (let j = i + 1; j < shipped.length; j++) all.push([shipped[i].name, shipped[j].name, dist(shipped[i].f, shipped[j].f), why(shipped[i].f, shipped[j].f)]);
all.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as shipped (the section + " + REFS.join(", ") + "):"); for (const [a, b, d, w] of all.slice(0, 14)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
const todayPairs = []; for (let i = 0; i < SECTION.length; i++) for (let j = i + 1; j < SECTION.length; j++) todayPairs.push(dist(refRow(SECTION[i]).f, refRow(SECTION[j]).f));
const secPairs = all.filter(([a, b]) => SECTION.includes(a) && SECTION.includes(b)).map((x) => x[2]);
console.log("  section median pair " + median(secPairs).toFixed(2) + ", min " + Math.min(...secPairs).toFixed(2) + "; TODAY median " + median(todayPairs).toFixed(2) + ", min " + Math.min(...todayPairs).toFixed(2));
const every = rows.filter((x) => !x.kept).concat(altRows);
const over2 = every.filter((x) => x.m.sec > 2.001).map((x) => x.name + (x.i != null ? " alt" + (x.i + 1) : "") + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges (new + alts): audible " + Math.min(...every.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...every.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...every.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...every.map((x) => x.m.lufs)).toFixed(1) + " (target " + TARGET.toFixed(1) + "); peaks max " +
  Math.max(...every.map((x) => x.m.peak)).toFixed(3) + ", clipping " + every.filter((x) => x.m.clip).length + ", |DC| max " +
  Math.max(...every.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1));
console.log("  over 2 s: " + (over2.join(", ") || "none"));
const lvShip = shipped.filter((x) => !x.ref).map((x) => x.m.lufs).sort((a, b) => a - b);
console.log("  section as shipped (bases): median " + median(lvShip).toFixed(1) + " LUFS, range " + lvShip[0].toFixed(1) + " to " + lvShip[lvShip.length - 1].toFixed(1));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (section order, every new sound: replaced bases, then each alt, ~0.4 s apart)
writeFileSync(join(jsonDir, "nature-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR), seq = [];
for (const x of rows) {
  if (!x.kept) seq.push({ label: x.name, r: x.r, idea: IDEA[x.name] });
  altRows.filter((a) => a.name === x.name).forEach((a) => seq.push({ label: x.name + " alt" + (a.i + 1), r: a.r, idea: ALT_IDEA[x.name][a.i] }));
}
let total = 0; for (const x of seq) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
seq.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.label.padEnd(24) + x.idea); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Nature redo, all new");
const lv = rows.map((x) => "  " + x.name.padEnd(18) + "now " + x.now.m.lufs.toFixed(1) + (x.kept ? "  (base kept)" : "  new " + x.m.lufs.toFixed(1) + " LUFS  (" + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + " dB)") +
  altRows.filter((a) => a.name === x.name).map((a) => "   alt" + (a.i + 1) + " " + a.m.lufs.toFixed(1)).join(""));
const tables = "## The family (" + FAMILY.length + " names, two tables composed)\n\nAdjective = the character:\n\n" + Object.entries(ADJ).map(([k, v]) => "- **" + k + "**: " + v.idea).join("\n") +
  "\n\nNoun = the physical event:\n\n" + Object.entries(NOUN).map(([k, v]) => "- **" + k + "**: " + v.idea).join("\n") + "\n\n";
writeFileSync(join(wavDir, "KEY.md"), "# Nature redo — all-new.wav: every new sound in section order (replaced bases, then each new take), 0.4 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it; <slug>-2-new.wav a REPLACEMENT base; <slug>-alt<N>.wav a new take\n" +
  "# that joins the button's _alts (where there is no -2-new, today's base STAYS and the takes are added beside it). All Normalize\n" +
  "# on, NOT loudness-matched (each is what its button plays). The new ones aim at the section's median, " + TARGET.toFixed(1) + " LUFS, with stated\n" +
  "# offsets (a drizzle and the quiet/gentle/misty ones under it, squalls and rushing ones over), at most Limiter " + LIMIT_MAX + ". A take beside a\n" +
  "# KEPT base sits at that base's own level (within 3 dB of the median), since the button plays them in turn. THUNDER (the weather\n" +
  "# engine's bolt, nearly all low end) aims at Thunder's three picked takes instead, " + THUNDER_TARGET.toFixed(1) + " LUFS, Limiter up to " + LIMIT_THUNDER + " as they use.\n\n```\n" + key.join("\n") + "\n```\n\n" +
  "## Replaced, and kept-with-new-takes\n\n" + rows.map((x) => "- **" + x.name + "**: " + (x.kept ? "base KEPT (" + (KEEP_BASE_FAMILY[x.name] || "today's still plays") + "), " + (ALTS[x.name] || []).length + " new take(s) added" : "base REPLACED" + ((ALTS[x.name] || []).length ? ", plus " + ALTS[x.name].length + " take(s)" : ""))).join("\n") + "\n\n" +
  tables +
  "## Loudness, before and after (BS.1770; a big gap makes the louder one sound better, so listen past it)\n\n```\n" + lv.join("\n") + "\n```\n\n" +
  SHORT_NOTE + "## KEPT AS IS (no file: today's sound stays)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + rows.filter((x) => !x.kept).length + " replaced (now + new), " + rows.filter((x) => x.kept).length + " kept bases (now), " + altRows.length + " alts, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, nature-redo.json");
