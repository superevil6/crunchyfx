/* robot-redo.mjs — the ROBOT presets swept against the new engines. PROPOSAL / A-B material: nothing here is wired into
 * presets.js; AJ listens to the labeled before/after WAVs and keeps what is better. Today's sound is always a valid
 * outcome: a robot is synthetic by nature (a beep IS a square wave), so only the sounds whose physical thing is
 * mechanical or acoustic are redesigned, and the KEPT list says why the rest stay.
 *
 *   node tools/proto/robot-redo.mjs            renders every redesign (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/robot-redo.mjs ref        measures today's Machine section and the 18 robot presets (the level bar)
 *   node tools/proto/robot-redo.mjs sep        separation only (renders the new ones, prints the named pairs and the closest)
 *   node tools/proto/robot-redo.mjs <slug>     one redesign, measured, written (no JSON, no all-new.wav)
 *   node tools/proto/robot-redo.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/robot-redo.mjs x '<js>' ...         measure patches built with the voices below (servo(), clang() ...)
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, Normalize ON and NOT
 * loudness-matched: each WAV is what the app's button plays. The one per-name number not from a design is `gain` on
 * layer 1, a trim that lands the integrated loudness on today's Machine-section median (plus a stated per-sound offset
 * where a sound should sit lower or higher by design).
 *
 * Writes soundtests/robot-redo/<slug>-1-now.wav, <slug>-2-new.wav (+ -alt<N>.wav), all-new.wav + KEY.md, and
 * tools/new-presets/robot-redo.json ({ name: patch with _vary, optional _alts and layers }).
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
// THE SCOPE (exact names)
const MACHINE = CATS.find((c) => c[0] === "Machine")[1];
const ROBOT_MACHINE = ["Robot Beep", "Robot Power Up", "Robot Power Down", "Robot Talk", "Robot Stomp", "Robot Alarm", "Servo Twitch",
  "Robot Beep 2", "Robot Talk 2", "Servo Drone", "Servo Chime"];
const ROBOT_ELSEWHERE = ["Robot Voice", "Robot Yes", "Robot No", "Robot Chuckle"];
const SERVO_REFS = ["Robot Servo", "Mechanical Whir", "Servo Motor"];   // already on the servo engine: references, not redone
const EIGHTEEN = ROBOT_MACHINE.concat(ROBOT_ELSEWHERE, SERVO_REFS);

// ============================================================================================================
// MEASUREMENT (loudness as tools/proto/fire-redo.mjs; a YIN pitch track as creature-redo-animals.mjs)
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
// one 2048-sample Hann DFT on bins every 100 Hz to 16 kHz: centroid, and the energy below 250 Hz and above 4 kHz
const SPN = 2048, SPK = 160, SPC = [], SPS = [], SPH = new Float64Array(SPN);
for (let i = 0; i < SPN; i++) SPH[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SPN - 1));
for (let k = 1; k < SPK; k++) { const w = 2 * Math.PI * (k * 100) / SR, c = new Float64Array(SPN), s = new Float64Array(SPN); for (let i = 0; i < SPN; i++) { c[i] = Math.cos(w * i); s[i] = Math.sin(w * i); } SPC.push(c); SPS.push(s); }
function spectrum(x, a) {
  let num = 0, den = 0, lo = 0, hi = 0;
  const v = new Float64Array(SPN); for (let i = 0; i < SPN; i++) v[i] = (x[a + i] || 0) * SPH[i];
  for (let k = 1; k < SPK; k++) {
    const f = k * 100, C = SPC[k - 1], S = SPS[k - 1]; let re = 0, im = 0;
    for (let i = 0; i < SPN; i++) { re += v[i] * C[i]; im -= v[i] * S[i]; }
    const m = re * re + im * im; num += f * m; den += m;
    if (f < 250) lo += m; if (f > 4000) hi += m;
  }
  return { cent: den > 0 ? num / den : 0, lo: den > 0 ? lo / den : 0, hi: den > 0 ? hi / den : 0, e: den };
}
function render(patch) {
  const p = Object.assign({}, patch); delete p._vary; delete p._alts;
  const r = CS.render(Object.assign({}, CS.DEFAULTS, p), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
function measure(r) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.999 || b >= 0.999) clip++; }
  const mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  // audible span: 10 ms blocks over -60 dB of the peak
  const B = Math.round(0.01 * SR); let last = 0, first = -1;
  for (let a = 0; a < n; a += B) { let m = 0; for (let i = a; i < Math.min(n, a + B); i++) m = Math.max(m, Math.abs(mono[i])); if (m > pk * 0.001) { last = a + B; if (first < 0) first = a; } }
  const span = Math.max(0.02, (Math.min(n, last) - Math.max(0, first)) / SR);
  // 20 ms level envelope (dB): where it peaks, how fast it gets there, how much is left at 80% of the span
  const E = Math.round(0.02 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / E + 1e-12)); }
  if (!env.length) env.push(-120);
  const mx = Math.max(...env), imx = env.indexOf(mx), f0 = Math.max(0, Math.floor(first / E));
  for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], mx - 50);
  let iatk = f0; while (iatk < imx && env[iatk] < mx - 3) iatk++;
  const atk = Math.max(0.01, (iatk - f0 + 0.5) * 0.02);
  const i80 = Math.min(env.length - 1, Math.floor((first + 0.8 * span * SR) / E)), end80 = env[i80] - mx;
  // BURSTS: separate events on a 10 ms level: armed, the level rising 6 dB over its own minimum (and within 25 dB of
  // the max) is an event; the level then falling 6 dB under that event's peak re-arms (a beep train, a chuckle, a
  // stomp's clank then its servo settle)
  const E10 = Math.round(0.01 * SR), e10 = [];
  for (let a = 0; a + E10 <= n; a += E10) { let s = 0; for (let i = a; i < a + E10; i++) s += mono[i] * mono[i]; e10.push(10 * Math.log10(s / E10 + 1e-12)); }
  const m10 = Math.max(...e10);
  let bursts = 0, armed = true, ref = m10 - 60;
  for (const v0 of e10) {
    const v = Math.max(v0, m10 - 60);
    if (armed) { ref = Math.min(ref, v); if (v > ref + 6 && v > m10 - 25) { bursts++; armed = false; ref = v; } }
    else { ref = Math.max(ref, v); if (v < ref - 6) { armed = true; ref = v; } }
  }
  // TEXTURE: the fast level movement (5 ms level against its 100 ms average): buzz, crackle, gear warble
  const E5 = Math.round(0.005 * SR), e5 = [];
  for (let a = 0; a + E5 <= n; a += E5) { let q = 0; for (let i = a; i < a + E5; i++) q += mono[i] * mono[i]; e5.push(10 * Math.log10(q / E5 + 1e-12)); }
  const m5 = Math.max(...e5); let ts = 0, tn = 0;
  for (let i = 0; i < e5.length; i++) e5[i] = Math.max(e5[i], m5 - 40);
  for (let i = 10; i < e5.length - 10; i++) { if (e5[i] < m5 - 30) continue; let av = 0; for (let j = i - 10; j <= i + 10; j++) av += e5[j]; av /= 21; ts += (e5[i] - av) ** 2; tn++; }
  const texture = tn ? Math.sqrt(ts / tn) : 0;
  // SPECTRUM: energy-weighted over the loud part (within 20 dB of the max), every 25 ms; and the centroid's MOVE
  // (log2 of the last loud frame's centroid over the first's: a spin-up brightens, a spin-down darkens)
  let cn = 0, cd = 0, blo = 0, bhi = 0; const cents = [];
  for (let a = 0; a + 2048 < n; a += Math.round(0.025 * SR)) {
    let e = 0; for (let i = a; i < a + 2048; i++) e += mono[i] * mono[i];
    if (10 * Math.log10(e / 2048 + 1e-12) < mx - 20) continue;
    const s = spectrum(mono, a); cn += s.cent * e; blo += s.lo * e; bhi += s.hi * e; cd += e; cents.push(s.cent);
  }
  if (!cents.length && n > 0) { const s = spectrum(mono, 0); cents.push(s.cent); cn = s.cent; cd = 1; blo = s.lo; bhi = s.hi; }
  const q = Math.max(1, Math.floor(cents.length / 4));
  // WOBBLE: how much the colour moves around its own trend frame to frame (a talking vowel, a warbling gear): the RMS of
  // log2(centroid) against its 5-frame (125 ms) average
  let wb = 0, wn = 0;
  for (let i = 2; i < cents.length - 2; i++) { let av = 0; for (let j = i - 2; j <= i + 2; j++) av += Math.log2(Math.max(100, cents[j])); av /= 5; wb += (Math.log2(Math.max(100, cents[i])) - av) ** 2; wn++; }
  const wobble = wn ? Math.sqrt(wb / wn) : 0;
  const cFirst = median(cents.slice(0, q)), cLast = median(cents.slice(-q));
  const cmove = Math.log2(Math.max(100, cLast) / Math.max(100, cFirst));
  // PITCH: YIN over 60-2000 Hz, on the frames that are periodic (aperiodicity < 0.3): the median, the move (log2 of the
  // last quarter's median over the first's) and the share of frames that are periodic at all
  const tr = yinTrack(mono, 60, 2000, 0.01);
  const voiced = tr.filter((x) => x.f > 0 && x.ap < 0.3);
  const vq = Math.max(1, Math.floor(voiced.length / 4));
  const f0med = voiced.length ? median(voiced.map((x) => x.f)) : 0;
  const pmove = voiced.length >= 4 ? Math.log2(median(voiced.slice(-vq).map((x) => x.f)) / median(voiced.slice(0, vq).map((x) => x.f))) : 0;
  const tonal = tr.filter((x) => x.f > 0).length ? voiced.length / tr.filter((x) => x.f > 0).length : 0;
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R),
    cent: cd ? cn / cd : 0, lo: cd ? blo / cd : 0, hi: cd ? bhi / cd : 0, cmove, texture, atk, maxAt: imx * 0.02 - Math.max(0, first) / SR, end80,
    bursts, f0: f0med, pmove, tonal, wobble };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1) +
    "\n      centroid " + (m.cent / 1000).toFixed(2) + "k (moves " + (m.cmove >= 0 ? "+" : "") + m.cmove.toFixed(2) + " oct)  <250Hz " + (100 * m.lo).toFixed(0) +
    "%  >4k " + (100 * m.hi).toFixed(0) + "%  wobble " + m.wobble.toFixed(2) + "  pitch " + (m.f0 ? m.f0.toFixed(0) + " Hz (moves " + (m.pmove >= 0 ? "+" : "") + m.pmove.toFixed(2) + " oct, tonal " + (100 * m.tonal).toFixed(0) + "%)" : "none") +
    "\n      bursts " + m.bursts + "  texture " + m.texture.toFixed(1) + " dB  attack " + m.atk.toFixed(2) + " s  peak at " + m.maxAt.toFixed(2) + " s  at 80% " + m.end80.toFixed(0) + " dB";
}
// The feature vector for separation (units chosen so 1 = a clearly audible step):
//   length log2 of the audible span; brightness log2 of the centroid; colour MOVE (octaves); rumble and hiss: the
//   < 250 Hz and > 4 kHz shares x 3; pitch log2 of f0 / 1.5 (0 when atonal) x tonal share; pitch move (octaves);
//   bursts log2(1 + n); texture (dB) / 3; attack log2 / 1.5; shape: where it peaks (share of the span) x 2 and how much
//   is left at 80% of the span (dB / 12); wobble x 4 (0.25 = a quarter-octave colour swing frame to frame, a talking vowel)
function features(m) {
  return [Math.log2(m.span), Math.log2(Math.max(100, m.cent)), cl(m.cmove, -2, 2), 3 * m.lo, 3 * m.hi,
    m.f0 ? m.tonal * Math.log2(m.f0 / 60) / 1.5 : 0, cl(m.pmove, -2, 2) * m.tonal, Math.log2(1 + m.bursts), Math.min(m.texture, 9) / 3,
    Math.log2(m.atk) / 1.5, 2 * cl(m.maxAt / m.span, 0, 1), cl(m.end80, -40, 0) / 12, 4 * Math.min(m.wobble, 0.5)];
}
const FEAT = ["length", "bright", "colour-move", "rumble", "hiss", "pitch", "pitch-move", "bursts", "texture", "attack", "peakpos", "tail", "wobble"];
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); }
function why(a, b) { return FEAT.map((k, i) => [k, Math.abs(a[i] - b[i])]).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => k + " " + v.toFixed(2)).join(", "); }

const arg = process.argv[2];
if (arg === "try") { console.log(fmt(measure(render(JSON.parse(process.argv[3]))))); process.exit(0); }

// ---- the reference: today's Machine section and the 18
const refCache = new Map();
function refRow(name) {
  if (!refCache.has(name)) { const m = measure(render(PRESETS[name])); refCache.set(name, { name, m, f: features(m) }); }
  return refCache.get(name);
}
if (arg === "ref") {
  const mach = MACHINE.map(refRow), mlu = mach.map((x) => x.m.lufs);
  for (const name of EIGHTEEN) console.log(name.padEnd(17) + fmt(refRow(name).m));
  const e = EIGHTEEN.map((n) => refRow(n).m.lufs);
  console.log("\nMACHINE SECTION (" + mach.length + " presets) median " + median(mlu).toFixed(1) + " LUFS, range " + Math.min(...mlu).toFixed(1) + " to " + Math.max(...mlu).toFixed(1));
  console.log("THE 18 median " + median(e).toFixed(1) + " LUFS, range " + Math.min(...e).toFixed(1) + " to " + Math.max(...e).toFixed(1));
  const p = []; for (let i = 0; i < EIGHTEEN.length; i++) for (let j = i + 1; j < EIGHTEEN.length; j++) { const a = refRow(EIGHTEEN[i]), b = refRow(EIGHTEEN[j]); p.push([a.name, b.name, dist(a.f, b.f), a.f, b.f]); }
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY closest pairs among the 18:"); for (const [a, b, d, fa, fb] of p.slice(0, 14)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2));
  process.exit(0);
}

// ============================================================================================================
// THE LAYER VOICES (each a full patch; the chassis numbers every layer shares are stated once here)
//   every engine layer is DRY and CLEAN unless asked: drive 0 (the default 0.1 is a tanh(5x) nobody asked for), reso 0,
//   no crush, no reverb. The servo chassis mirrors the shipped servo presets (attack 4 ms, release 20 ms, LP 16 kHz).
function servo(o, dur) {   // the servo engine (wave 33): o is the servo* rows, verbatim
  return Object.assign({ wave: 33, attack: 0.004, hold: 0, decay: 0, sustain: 1, release: 0.02, filterMode: 0, cutoff: 16000, reso: 0,
    drive: 0, bitcrush: 16, reverb: 0, width: 0.4, duration: r2(dur) }, o);
}
function thud(o) {         // the impact engine (wave 19): a noise body + crack, the boom stage for the low thump
  const p = { wave: 19, impactTone: r2(o.tone), impactDecay: r2(o.decay), impactPunch: r2(o.punch ?? 0.8), impactGrit: r2(o.grit ?? 0.3),
    attack: 0.001, hold: 0, decay: r3(o.dec ?? 0.2), sustain: 0, release: r3(o.rel ?? 0.15), filterMode: 0, cutoff: Math.round(o.cut || 9000), reso: 0,
    drive: r2(o.drive || 0), width: 0.5, duration: r2(o.dur || 0.6) };
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(o.boomFreq || 55), boomDrop: r2(o.boomDrop ?? 0.5), boomDecay: r2(o.boomDecay ?? 0.15) });
  return p;
}
function weight(o) {       // the blast engine (wave 31) as a WEIGHT: a tiny charge, close, Weight stretched: one low pressure push
  return { wave: 31, blastSize: r2(o.size), blastDist: Math.round(o.dist || 3), blastEnv: o.env ?? 2, blastRoom: r2(o.room ?? 0.4), blastTail: r2(o.tail ?? 0.35),
    blastPulse: r2(o.pulse ?? 5), blastShape: r2(o.shape ?? 1), blastRoar: r2(o.roar ?? 0), blastRumble: r2(o.rumble ?? 0.5), blastDebris: r2(o.debris || 0),
    blastSeed: o.seed ?? 1, blastPeak: r2(o.peak ?? 0.5), width: 0.5, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06,
    filterMode: 0, cutoff: 12000, reso: 0.31, drive: 0, reverb: 0, duration: r2(o.dur || 0.8) };
}
function clang(o) {        // the modal engine (wave 10): struck metal, inharmonic partials
  const p = { wave: 10, freq: Math.round(o.freq), modalPartials: o.partials ?? 10, modalInharm: r2(o.inharm ?? 0.8), modalBright: r2(o.bright ?? 0.6),
    modalDecay: r2(o.ring), attack: 0.001, hold: r3(o.hold ?? 0.004), decay: r3(o.dec ?? 0.1), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.3),
    filterMode: 0, cutoff: Math.round(o.cut || 9000), reso: 0, drive: r2(o.drive || 0), width: 0.5, duration: r2(o.dur || 0.8) };
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.noise) p.noise = r2(o.noise);
  if (o.ringMod) Object.assign(p, { ringMod: r2(o.ringMod), ringFreq: Math.round(o.ringFreq) });
  if (o.reverb) Object.assign(p, { reverb: r2(o.reverb), reverbSize: r2(o.reverbSize ?? 0.5), reverbTone: r2(o.reverbTone ?? 0.5) });
  return p;
}
function hiss(o) {         // escaping air / hydraulics: filtered noise on a plain oscillator (noise 1)
  return { wave: 0, freq: 200, noise: 1, noiseColor: r2(o.color ?? 0), attack: r3(o.atk ?? 0.005), hold: r3(o.hold || 0), decay: r3(o.dec ?? 0.2), sustain: r2(o.sus ?? 0),
    release: r3(o.rel ?? 0.15), filterMode: o.mode ?? 2, cutoff: Math.round(o.cut || 3000), reso: r2(o.reso ?? 0.2), filtEnv: r2(o.fenv || 0),
    drive: 0, width: 0.6, duration: r2(o.dur || 0.6) };
}
function tick(o) {         // a relay or contactor: a tiny bright impact, one or two shots
  const p = thud({ tone: o.tone ?? 0.75, decay: o.decay ?? 0.02, punch: 1, grit: o.grit ?? 0.2, dec: 0.02, rel: 0.02, dur: o.dur || 0.12, cut: o.cut || 12000 });
  if (o.shots) Object.assign(p, { repeat: o.shots, rate: o.rate || 30 });
  if (o.hp) Object.assign(p, { filterMode: 1, cutoff: Math.round(o.hp) });
  return p;
}
function beep(o) {         // the idiom: a square-wave beep (shots, glide), crushed like today's robots
  const p = { wave: 1, freq: Math.round(o.freq), sweep: r2(o.sweep || 0), attack: 0, hold: r3(o.hold ?? 0.002), decay: r3(o.dec ?? 0.05), sustain: r2(o.sus ?? 0.2),
    release: r3(o.rel ?? 0.03), cutoff: Math.round(o.cut || 5000), reso: r2(o.reso ?? 0.3), bitcrush: o.crush ?? 5, downsample: o.down ?? 3, width: 0.3, duration: r2(o.dur) };
  if (o.shots) Object.assign(p, { repeat: o.shots, rate: r2(o.rate) });
  if (o.arp) p.arpStep = o.arp;
  if (o.vib) Object.assign(p, { vibDepth: r2(o.vib), vibRate: r2(o.vibRate || 8) });
  return p;
}
// A sound = layer 1's patch + layers 2-4 as the JSON string the app stores ({ s, d, g, p, m: 0 })
function sound(base, extra) {
  const p = Object.assign({}, base);
  const ls = extra.filter(Boolean).map(([s, d, g, pt]) => ({ s, d: r3(d), g: r2(g), p: pt || 0, m: 0 }));
  if (ls.length > 3) throw new Error("more than 4 layers");
  if (ls.length) p.layers = JSON.stringify(ls);
  return p;
}
// x '<js expression>': measure a patch built with the voices above
// a 50 ms level and pitch curve (for the x mode): what the shape actually does over time
function curve(r) {
  const hop = +(process.env.HOP || 0.05);   // HOP=0.01 node ... x '...' for a finer look
  const mono = Float64Array.from(r.L, (v, i) => 0.5 * (v + r.R[i])), E = Math.round(hop * SR), out = [];
  const tr = yinTrack(mono, 60, 2000, hop);
  for (let a = 0, k = 0; a + E <= mono.length; a += E, k++) {
    let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i];
    const c = spectrum(mono, Math.min(a, mono.length - 2049)).cent, t = tr[k];
    out.push((a / SR).toFixed(2) + ":" + (10 * Math.log10(s / E + 1e-12)).toFixed(0) + "dB/" + (c / 1000).toFixed(1) + "k" + (t && t.f && t.ap < 0.3 ? "/" + t.f.toFixed(0) : ""));
  }
  return out.join(" ");
}

// ============================================================================================================
// THE DESIGNS. One machine where a pair should sound like the same robot: Power Up and Power Down share ONE geared
// actuator (a 5-slot brushed motor, 10:40 then 12:44 gears, mains hum under it), so a game can play them as a pair.
const ACTUATOR = { servoType: 2, servoSpeed: 9000, servoSlots: 5, servoWhine: 0.6, servoBars: 8, servoComm: 0.6, servoSpark: 0.3, servoSparkHz: 4200,
  servoStages: 2, servoPinion1: 10, servoGear1: 40, servoMesh1: 1, servoPinion2: 12, servoGear2: 44, servoMesh2: 0.7, servoBearing: 0.15,
  servoHum: 0.2, servoHumHz: 60, servoSize: 0.55, servoBody: 0.55, servoWander: 0.2 };
// A small geared servo (the head, a finger, a sensor turret): Robot Servo's family, its own gears and click
const HEAD = { servoType: 2, servoSlots: 3, servoWhine: 0.3, servoBars: 6, servoComm: 0.9, servoSpark: 0.5, servoSparkHz: 4800, servoStages: 3,
  servoPinion1: 9, servoGear1: 45, servoMesh1: 1, servoPinion2: 10, servoGear2: 40, servoMesh2: 0.7, servoPinion3: 12, servoGear3: 36, servoMesh3: 0.45,
  servoBrake: 1, servoInertia: 0.02, servoDecel: 0.01, servoCoast: 0.1, servoLoad: 0.35, servoLoadEnd: 0.35, servoOffLoad: 0.35,
  servoBearing: 0.08, servoSize: 0.12, servoBody: 0.45, servoWander: 0.3, servoCog: 0.3 };

const S = {
  // POWER UP: the contactor closes (a double clack), the mains hum arrives, and the actuator spins up under power: its
  // whine, brush buzz and two gear meshes all rise together, locked to the shaft. The amp envelope swells over 0.5 s as
  // it gets going, so it crescendos into speed rather than starting at its loudest.
  "Robot Power Up": () => sound(
    servo(Object.assign({}, ACTUATOR, { servoAt: 0.07, servoRun: 1.2, servoLoad: 0.5, servoLoadEnd: 0.55, servoInertia: 0.6, servoSeed: 1, attack: 0.7 }), 1.25),
    [[tick({ tone: 0.55, decay: 0.05, grit: 0.35, shots: 2, rate: 32, dur: 0.15 }), 0.02, 0.7]]),
  // POWER DOWN: the same actuator, already running; the contactor drops out at 0.15 s (a clack), the whine and brushes
  // stop with the power and the gears coast down, falling ~3 octaves over a second while the sound fades; at the end
  // the arm it drives drops onto its stop (a dull metal clunk).
  "Robot Power Down": () => sound(
    servo(Object.assign({}, ACTUATOR, { servoStart: 1, servoAt: 0, servoRun: 0.15, servoLoad: 0.5, servoLoadEnd: 0.5, servoOffLoad: 0.25, servoInertia: 0.1,
      servoDecel: 0.2, servoCoast: 0.5, servoBrake: 0, servoSeed: 1, attack: 0.004, hold: 0.15, decay: 0.9, sustain: 0.35, release: 0.25 }), 1.45),
    [[tick({ tone: 0.5, decay: 0.06, grit: 0.35, dur: 0.15 }), 0.14, 0.4],
     [thud({ tone: 0.3, decay: 0.12, punch: 0.6, grit: 0.2, dec: 0.15, rel: 0.15, dur: 0.4, boom: 0.4, boomFreq: 70, boomDecay: 0.1 }), 1.1, 0.35],
     [clang({ freq: 210, partials: 10, inharm: 0.78, bright: 0.45, ring: 0.3, dec: 0.08, rel: 0.25, dur: 0.4, cut: 6000 }), 1.1, 0.25]]),
  // STOMP: a heavy metal foot landing. The impact engine's thud (dark, punchy, a 55 Hz boom under it), the blast engine
  // as WEIGHT (a tiny charge right at the foot, Weight 5: one long low pressure push, no fire, indoors so the floor
  // answers), the foot's steel ringing (modal, inharmonic, low), and 0.12 s later the leg's servo re-centring.
  "Robot Stomp": () => sound(
    thud({ tone: 0.3, decay: 0.45, punch: 0.9, grit: 0.5, dec: 0.3, rel: 0.25, dur: 0.85, boom: 0.8, boomFreq: 48, boomDrop: 0.6, boomDecay: 0.3 }),
    [[weight({ size: 0.15, dist: 3, env: 2, room: 0.5, tail: 0.45, pulse: 5.5, rumble: 0.7, seed: 3, dur: 0.85 }), 0, 1],
     [clang({ freq: 190, partials: 12, inharm: 0.85, bright: 0.55, ring: 0.35, dec: 0.2, sus: 0, rel: 0.25, dur: 0.85, cut: 7000, drive: 0.25 }), 0, 0.45],
     [servo(Object.assign({}, HEAD, { servoSpeed: 9000, servoAt: 0.0, servoRun: 0.11, servoStop: 0.9, servoClickHz: 1800, servoSize: 0.35, servoSeed: 4 }), 0.3), 0.14, 0.18]]),
  // SERVO TWITCH: a tiny servo jerking twice, too fast to be a move: a 35 ms flick and a 20 ms correction, each ending
  // on its gears' click. Robot Servo is one deliberate 0.23 s zip; this is a nervous tic.
  "Servo Twitch": () => servo(Object.assign({}, HEAD, { servoSpeed: 14000, servoAt: 0.005, servoRun: 0.035, servoAt2: 0.1, servoRun2: 0.018, servoSpeed2: 11000,
    servoStop: 1.5, servoClickHz: 3200, servoSize: 0.06, servoSeed: 5 }), 0.22),
  // SERVO DRONE: a brushless servo HOLDING a load, running steadily: its magnetic whine and the drive's high whine,
  // cogging lumps and bearings, sagging a little as it strains. Sustained, where Power Down coasts to nothing.
  "Servo Drone": () => servo({ servoType: 0, servoStart: 1, servoSpeed: 7200, servoDrift: 0.82, servoAt: 0, servoRun: 1.2, servoLoad: 0.7, servoLoadEnd: 0.8,
    servoSag: 0.3, servoSlots: 12, servoWhine: 1, servoWhineHarm: 6, servoWhineRoll: 1.3, servoBars: 0, servoComm: 0, servoSpark: 0, servoPwm: 0.06, servoPwmHz: 8200,
    servoBearing: 0.25, servoBearingHz: 6000, servoSize: 0.45, servoBody: 0.5, servoWander: 0.6, servoCog: 0.5, servoCogN: 6, servoSeed: 6,
    attack: 0.06, hold: 0, decay: 0, sustain: 1, release: 0.15 }, 1.2),
  // SERVO CHIME: the chime of a little helper robot, now with the servo that turns its head first: a quick zip and the
  // gears' click, and the chime (today's bell, unchanged) rings ON the click.
  "Servo Chime": () => sound(
    servo(Object.assign({}, HEAD, { servoSpeed: 12000, servoAt: 0.01, servoRun: 0.11, servoStop: 1.1, servoClickHz: 2600, servoSeed: 7 }), 1.05),
    [[Object.assign({}, chimeToday()), 0.125, 0.85]]),
  // ROBOT TALK: the beep idiom kept, made to TALK: four squares chattering in turn at their own pitches, each glides
  // (up a question, down an answer), so the line rises and falls like a phrase. Today's is six equal beeps, a twin of
  // Robot Beep.
  "Robot Talk": () => sound(
    beep({ freq: 620, sweep: 0.35, dec: 0.06, sus: 0.25, rel: 0.03, shots: 2, rate: 7.5, arp: 3, dur: 0.95, crush: 5, cut: 4500 }),
    [[beep({ freq: 880, sweep: -0.4, dec: 0.05, sus: 0.2, rel: 0.03, shots: 2, rate: 6, arp: -5, dur: 0.5, crush: 5, cut: 4500 }), 0.09, 0.9],
     [beep({ freq: 470, sweep: 0.2, dec: 0.04, sus: 0.15, rel: 0.03, shots: 3, rate: 14, arp: 4, dur: 0.4, crush: 5, cut: 4500 }), 0.37, 0.85],
     [beep({ freq: 760, sweep: -0.6, dec: 0.09, sus: 0.3, rel: 0.05, dur: 0.2, crush: 5, cut: 4500 }), 0.74, 0.9]]),
  // ROBOT YES / NO: the word (today's speech patch, unchanged, as layer 1) with the robot's HEAD moving under it, about
  // 12 dB down: a nod is two short servo moves (down, up), a shake three (left, right, back).
  "Robot Yes": () => sound(today("Robot Yes"),
    [[servo(Object.assign({}, HEAD, { servoSpeed: 9000, servoAt: 0.02, servoRun: 0.09, servoAt2: 0.2, servoRun2: 0.08, servoSpeed2: 8000, servoStop: 0.9,
      servoClickHz: 2200, servoSeed: 8 }), 0.45), 0, 0.4]]),
  "Robot No": () => sound(today("Robot No"),
    [[servo(Object.assign({}, HEAD, { servoSpeed: 10000, servoAt: 0.02, servoRun: 0.07, servoAt2: 0.14, servoRun2: 0.1, servoSpeed2: 10000, servoAt3: 0.3,
      servoRun3: 0.07, servoSpeed3: 9000, servoStop: 0.9, servoClickHz: 2200, servoSeed: 9 }), 0.5), 0, 0.4]]),
};
function today(name) { const p = Object.assign({}, PRESETS[name]); delete p._vary; delete p._alts; return p; }
function chimeToday() { const p = today("Servo Chime"); delete p.gain; return p; }

const IDEA = {
  "Robot Power Up": "servo: the contactor clacks, the hum arrives, a geared actuator spins up under power (whine + brushes + two gear meshes rising together)",
  "Robot Power Down": "servo: the same actuator running; the contactor drops out, the gears coast down ~3 octaves and fade, the arm clunks onto its stop",
  "Robot Stomp": "impact thud + blast WEIGHT (a long low push) + modal steel ring, then the leg's servo re-centres (0.13 s)",
  "Servo Twitch": "servo: a tiny servo jerks twice (a 35 ms flick, a 20 ms correction), each ending on its gears' click",
  "Servo Drone": "servo: a brushless servo holding a load, running steadily (whine + drive whine + cogging), sagging as it strains",
  "Servo Chime": "today's chime, rung on the click of the servo that turns the robot's head first (zip, click-ding)",
  "Robot Talk": "the square-beep idiom made to talk: four chattering squares at their own pitches, gliding up and down like a phrase",
  "Robot Yes": "today's spoken \"yes\" with the head NODDING under it (two quiet servo moves)",
  "Robot No": "today's spoken \"no\" with the head SHAKING under it (three quiet servo moves)",
};
const KEPT = {
  "Robot Beep": "a beep IS a square wave: six crushed squares at 16/s is the idiom; no engine models it better",
  "Robot Beep 2": "the same idiom, lower and slower (5 at 12/s, falling); measured clearly apart from Robot Beep",
  "Robot Alarm": "an alarm IS an oscillator: a 1 kHz square pulsing 8/s; a speaker body would only soften it",
  "Robot Talk 2": "formant (vowel LFO + ring mod) is this repo's synthetic-voice engine and exactly what a robot voice is",
  "Robot Voice": "a held formant vowel, ring-modded and crushed: the vocoder-ish robot voice the formant engine is for",
  "Robot Chuckle": "a formant heh-heh-heh with growl and ring mod; a laugh is a voice, and formant is the voice engine",
  "Robot Servo": "already on the servo engine, picked by ear (reference)",
  "Mechanical Whir": "already on the servo engine, picked by ear (reference)",
  "Servo Motor": "already on the servo engine, picked by ear (reference)",
};
// Per-sound level offset from the Machine-section median, by design (dB). Everything else lands ON the median.
//   Servo Twitch: a 0.1 s tic, a small sound (-3). Yes / No keep their Speech / Vox level (today -9.7 / -10.0).
//   Robot Stomp: a transient, whose integrated loudness reads low at any peak; today's sits at -14.7 (-6, still +1.4 on today).
const LEVEL_OFFSET = { "Servo Twitch": -3, "Robot Yes": -2.5, "Robot No": -2.5, "Robot Stomp": -6 };
// _vary: the shipped servo presets' rule (seed + speed + one tone) on a servo layer 1; an impact layer 1 its tone and
// boom; the beep its pitch and rate; a speech layer 1 only its pitch (the head under it varies with the shared move)
const VARY = {
  "Robot Power Up": { servoSeed: 1, servoSpeed: 0.08, servoInertia: 0.15 },
  "Robot Power Down": { servoSeed: 1, servoSpeed: 0.08, servoCoast: 0.15 },
  "Robot Stomp": { impactTone: 0.12, impactDecay: 0.15, boomFreq: 0.1 },
  "Servo Twitch": { servoSeed: 1, servoSpeed: 0.1, servoClickHz: 0.1, servoRun: 0.15 },
  "Servo Drone": { servoSeed: 1, servoSpeed: 0.1, servoWander: 0.2 },
  "Servo Chime": { servoSeed: 1, servoSpeed: 0.1, servoClickHz: 0.1 },
  "Robot Talk": { freq: 0.15, rate: 0.15 },
  "Robot Yes": { freq: 0.1, speechRate: 0.06 },
  "Robot No": { freq: 0.1, speechRate: 0.06 },
};
const REDO = Object.keys(S);
if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e), r = render(p); console.log(fmt(measure(r)) + "\n      " + curve(r)); } process.exit(0); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "robot-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// The most Limiter a level trim may add: past ~0.3 it flattens a stomp's attack or a coast's fade, so a sound that
// cannot reach the target under it lands short, and the shortfall is printed (by design, not by accident).
const LIMIT_MAX = 0.3;
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in
// steps of 0.05 (the smallest that reaches the target; it raises loudness by driving into a 0.98 ceiling)
function level(p, target) {
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - m.lufs) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  let lo = 0, hi = Math.round(LIMIT_MAX / 0.05);
  p.limiter = LIMIT_MAX; m = measure(render(p));
  if (m.lufs < target - 0.4) return m;   // short of the target at the cap: reported (a transient or a fade), never squashed further
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); const mm = measure(render(p)); if (mm.lufs >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  for (let k = 0; k < 2; k++) { m = measure(render(p)); if (m.lufs > target + 0.3) p.gain = r2(p.gain * Math.pow(10, (target - m.lufs) / 20)); }
  return measure(render(p));
}
// key order as the app writes a preset: the patch, then _vary, then layers last (presets.js's own order)
function asPreset(p, vary) { const o = {}; for (const [k, v] of Object.entries(p)) if (k !== "layers") o[k] = v; o._vary = vary; if (p.layers) o.layers = p.layers; return o; }

const TARGET = median(MACHINE.map((n) => refRow(n).m.lufs));
const only = arg && arg !== "sep" ? arg : null;
if (only && !REDO.some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + REDO.map(slug).join(", ")); process.exit(1); }
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {};
console.log("Machine-section median " + TARGET.toFixed(1) + " LUFS (the level target)");
for (const name of REDO) {
  const s = slug(name);
  if (only && only !== s) continue;
  const p = S[name](), tgt = TARGET + (LEVEL_OFFSET[name] || 0);
  const m = level(p, tgt), r = render(p), now = refRow(name);
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    wav(s + "-2-new.wav", r, name);
  }
  json[name] = asPreset(p, VARY[name]);
  rows.push({ name, slug: s, p, r, m, f: features(m), now });
  const nl = p.layers ? JSON.parse(p.layers).length + 1 : 1;
  console.log(name.padEnd(17) + "NEW " + fmt(m) + "\n      " + nl + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
    ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")" +
    "\n  " + "".padEnd(15) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
}
if (only) process.exit(0);

// ---- separation: the whole set of 18 as it would ship (new where redesigned, today's where kept)
const shipped = EIGHTEEN.map((n) => rows.find((x) => x.name === n) || Object.assign({ kept: true }, refRow(n)));
const D = (a, b) => { const x = shipped.find((q) => q.name === a), y = shipped.find((q) => q.name === b); return [dist(x.f, y.f), why(x.f, y.f)]; };
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or pitch, or a clear shape step)");
const NAMED = [["Robot Beep", "Robot Beep 2"], ["Robot Talk", "Robot Talk 2"], ["Robot Power Up", "Robot Power Down"], ["Robot Talk", "Robot Beep"],
  ["Robot Yes", "Robot No"], ["Robot Power Down", "Servo Drone"]];
for (const t of ["Servo Twitch", "Servo Drone", "Servo Chime"]) for (const r of SERVO_REFS) NAMED.push([t, r]);
for (const [a, b] of NAMED) { const [d, w] = D(a, b); console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")"); }
const all = []; for (let i = 0; i < shipped.length; i++) for (let j = i + 1; j < shipped.length; j++) all.push([shipped[i].name, shipped[j].name, dist(shipped[i].f, shipped[j].f), why(shipped[i].f, shipped[j].f)]);
all.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs among the 18 as shipped:"); for (const [a, b, d, w] of all.slice(0, 10)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")");
const todayPairs = []; for (let i = 0; i < EIGHTEEN.length; i++) for (let j = i + 1; j < EIGHTEEN.length; j++) todayPairs.push(dist(refRow(EIGHTEEN[i]).f, refRow(EIGHTEEN[j]).f));
console.log("  median pair " + median(all.map((x) => x[2])).toFixed(2) + ", min " + all[0][2].toFixed(2) + "; TODAY median " + median(todayPairs).toFixed(2) + ", min " + Math.min(...todayPairs).toFixed(2));
const over2 = rows.filter((x) => x.m.sec > 2.001).map((x) => x.name + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges (new): audible " + Math.min(...rows.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...rows.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...rows.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...rows.map((x) => x.m.lufs)).toFixed(1) + " (target " + TARGET.toFixed(1) + "); peaks max " +
  Math.max(...rows.map((x) => x.m.peak)).toFixed(3) + ", clipping " + rows.filter((x) => x.m.clip).length + ", |DC| max " +
  Math.max(...rows.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1));
console.log("  over 2 s: " + (over2.join(", ") || "none"));
console.log("  before/after loudness (new - now, dB): " + rows.map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (the redesigns in the order above)
writeFileSync(join(jsonDir, "robot-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.5 * SR);
let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(17) + IDEA[x.name]); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Robot redo, all new");
const lv = rows.map((x) => "  " + x.name.padEnd(17) + "now " + x.now.m.lufs.toFixed(1) + "  new " + x.m.lufs.toFixed(1) + " LUFS  (" + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1) + " dB)");
writeFileSync(join(wavDir, "KEY.md"), "# Robot redo — all-new.wav: the " + rows.length + " redesigned robot sounds, 0.5 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it, <slug>-2-new.wav the redesign; both Normalize on,\n" +
  "# NOT loudness-matched (each is what its button plays). New ones aim at the Machine-section median, " + TARGET.toFixed(1) + " LUFS\n" +
  "# (Servo Twitch 3 dB under; Robot Yes / No 2.5 dB under, their Speech / Vox level; Robot Stomp 6 dB under, a transient,\n" +
  "# about today's level), with at most Limiter " + LIMIT_MAX + ": Robot Power Down's coast fades, so it lands short of its target\n" +
  "# rather than being squashed into it.\n\n```\n" + key.join("\n") + "\n```\n\n" +
  "## Loudness, before and after (BS.1770; a big gap makes the louder one sound better, so listen past it)\n\n```\n" + lv.join("\n") + "\n```\n\n" +
  "## KEPT (no file: today's sound stays)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, robot-redo.json");
