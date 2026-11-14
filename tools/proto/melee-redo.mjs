/* melee-redo.mjs — the rest of HITS / MELEE redesigned on the melee engine (tools/proto/melee.mjs). PROPOSAL / A-B
 * material: nothing here is wired into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better.
 *
 *   node tools/proto/melee-redo.mjs            renders every redesign (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/melee-redo.mjs sep        separation only (prints the named pairs and the closest)
 *   node tools/proto/melee-redo.mjs <slug>     one redesign, measured, its WAVs written (no JSON, no all-new.wav)
 *
 * WHY. The melee engine won all seven judged blind rounds (soundtests/proto-melee/, PICKS.md "Melee engine"). The rest of
 * the section is the same problem: 32 of its 52 presets are the whoosh engine alone (air, nothing lands), the rest the
 * impact engine or the modal bank. NOT here: Enemy Death (the voice engine owns it), the eight blind-round sounds (they
 * take their picks: tools/new-presets/melee-picks.json, written here for the separation set and the port) and Punch / Kick
 * (its designed-punch round, punch-kick-2, is pending).
 *
 * AJ'S PATTERN, from the seven picks: QUICK, SHARP BLADES -> FIGHTING-GAME (Katana Slice, Sword Clash, Dagger Stab);
 * HARD HITS ON ARMOR, SHIELDS AND MAIL -> CRUNCHY-ARCADE (Hammer Smash, Shield Block, Critical Slash); THE HEAVY AXE ->
 * HYPER-REAL (Axe Chop). `styleFor` applies it as a rule: a target of plate, mail, a shield or stone -> arcade; else a
 * heavy weapon (axe, hammer, flail) -> hyper-real; else -> fighting-game. AND the rule from the guns: no after-sound.
 *
 * THE NAMES SAY WHAT LANDS: a Swing is a deliberate WHIFF (target air: the swing alone, built on purpose, which today's
 * whoosh presets are by accident); Thrust, Lunge and Riposte land a POINT; Chop, Cleave and Slice an EDGE; Bash and Crush
 * BLUNT. THE FAMILY (24 names bred as ADJECTIVE x VERB) is two composed tables, as scifi-redo.mjs does: the VERB sets the
 * weapon, the target and the hit; the ADJECTIVE sets the character, the same rule on every verb (Heavy = weight, Swift =
 * speed, Iron = a metal target, Razor = a thin edge, Brutal = crunch, Whirling = revolutions before the blow ...).
 * Heavy Cleave is a family member too (it fits the grammar exactly).
 *
 * THE NON-WEAPON ITEMS are judged as the object each names. Where today's holds up it is KEPT (with a reason), or kept as
 * the base with the melee version as an ALT (AJ likes variety: repeat clicks discover it).
 *
 * RENDERING. The melee engine is not in the app yet, so "new" is the prototype (`makeMelee`) through the app's master
 * stage emulated exactly as it would run on an open chassis (Normalize: the peak to 0.9 x gain; the 256-sample end fade).
 * "Now" is the EXPORTED engine (synth-export/crunchysfx-synth.js), Normalize on. Neither is loudness-matched: each WAV is
 * what its button plays (or would). LEVEL: each new one is aimed at TODAY'S SECTION MEDIAN (measured here, BS.1770) plus
 * a stated offset (a whiff or a small object a little under, the heaviest hits a little over), by the smallest 0.05 step
 * of Peak control (the gun's gunPeak: the app's limiter on the melee alone, capped at 1.2, past which the squeeze is
 * audible) and, if over, by gain. A hit is almost all spike, so most land SHORT at the cap: KEY.md says by how much.
 *
 * Writes soundtests/melee-redo/<slug>-1-now.wav, <slug>-2-new.wav, all-new.wav + KEY.md, and
 * tools/new-presets/melee-redo.json ({ name: patch with _vary }, an ALT as today's patch with _alts: [new]) and
 * tools/new-presets/melee-picks.json (the seven judged picks, levelled the same way).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeMelee, meleeCfg, MELEE_DEFAULTS, MELEE_WEAPONS, MELEE_TARGETS, MELEE_HITS, MELEE_PLACES } from "./melee.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ex = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
  TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ex.window = ex; ex.globalThis = ex;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ex, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ex), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS, SECTION = pctx.window.PRESET_CATEGORIES.find((c) => c[0] === "Hits / Melee")[1];
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const cl = (x, a, b) => (x < a ? a : x > b ? b : x), r2 = (x) => Math.round(x * 100) / 100;
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]); };

// ============================================================================================================
// RENDERING
const strip = (p) => { const o = Object.assign({}, p); delete o._vary; delete o._alts; return o; };
const renderNow = (p) => CS.render(Object.assign({}, CS.DEFAULTS, strip(p)), { normalize: true });
const MELEE_KEYS = Object.keys(MELEE_DEFAULTS);
const CHASSIS = { width: 0.6, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06, filterMode: 0, cutoff: 20000, reso: 0.31, drive: 0, reverb: 0, gain: 1 };
function renderNew(p) {   // the prototype + the app's master stage on an open chassis (Normalize: peak -> 0.9 x gain; 256-sample fade)
  const st = Object.assign({}, MELEE_DEFAULTS); for (const k of MELEE_KEYS) if (p[k] != null) st[k] = p[k];
  st.duration = p.duration || 0; st.width = p.width;
  const r = makeMelee(SR, meleeCfg(st), Math.round(p.meleeSeed || 0));
  let pk = 0; for (let i = 0; i < r.n; i++) pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i]));
  const g = (pk > 1e-3 ? 0.9 / pk : 1) * (p.gain == null ? 1 : p.gain), n = r.n, fade = Math.min(256, Math.floor(n * 0.02));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { let l = r.L[i] * g, rr = r.R[i] * g; if (i > n - fade) { const k = (n - i) / fade; l *= k; rr *= k; } L[i] = cl(l, -1, 1); R[i] = cl(rr, -1, 1); }
  return { L, R, info: r.info };
}

// ============================================================================================================
// MEASUREMENT
function biquad(x, b0, b1, b2, a0, a1, a2) { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; }
function kweight(x) { const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, c = Math.cos(w), al = Math.sin(w) / (2 / Math.SQRT2), sa = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa), (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
  const w2 = 2 * Math.PI * 38 / SR, c2 = Math.cos(w2), al2 = Math.sin(w2) / (2 * 0.5); return biquad(s, (1 + c2) / 2, -(1 + c2), (1 + c2) / 2, 1 + al2, -2 * c2, 1 - al2); }
function lufs(L, R) { const kl = kweight(L), kr = kweight(R), B = Math.round(0.4 * SR), H = Math.round(0.1 * SR), ms = [];
  const block = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += kl[i] * kl[i] + kr[i] * kr[i]; return s / (b - a); };
  if (L.length <= B) ms.push(block(0, L.length)); else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
  const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12); let g = ms.filter((m) => l(m) > -70); if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10; g = g.filter((m) => l(m) > rel); return l(g.reduce((t, m) => t + m, 0) / g.length); }
function fft(re, im) { const N = re.length;
  for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) { const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
      re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
// RECTANGULAR on purpose: energy shares of the zero-padded whole sound. The CONTACT is the largest jump in 1 ms level
// read above 1 kHz (a swing swells, a thump peaks late; a hit jumps); LEAD = the first audible frame to the contact
function measure(r) {   // r.info (a melee take): the lead-in is the MODEL's (a limited contact no longer jumps)
  const L = r.L, R = r.R, n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  let N = 1; while (N < n) N <<= 1; const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = (L[i] + R[i]) / 2; fft(re, im);
  let all = 0, num = 0, lo = 0, hi = 0, top = 0;
  for (let k = 1; k < N / 2; k++) { const f = k * SR / N, p = re[k] * re[k] + im[k] * im[k]; all += p; num += f * p; if (f < 150) lo += p; if (f > 4000) hi += p; if (f > 11000) top += p; }
  let a0 = -1, a1 = 0; for (let i = 0; i < n; i++) { const m = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (m > pk * 0.01) { if (a0 < 0) a0 = i; a1 = i; } }
  const W = 441, env = []; for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; env.push(10 * Math.log10(s / W + 1e-20)); }
  const emax = Math.max(...env), ipk = env.indexOf(emax); let i30 = ipk; for (let k = env.length - 1; k > ipk; k--) if (env[k] > emax - 30) { i30 = k; break; }
  const hA = Math.exp(-2 * Math.PI * 1000 / SR); let h1 = 0, x1 = 0, h2 = 0, y1 = 0; const F = 44, fh = [];
  let acc = 0, cnt = 0; for (let i = 0; i < n; i++) { const x = (L[i] + R[i]) / 2; h1 = hA * (h1 + x - x1); x1 = x; h2 = hA * (h2 + h1 - y1); y1 = h1; acc += h2 * h2; if (++cnt === F) { fh.push(Math.sqrt(acc / F)); acc = 0; cnt = 0; } }
  let kc = 0, best = -1; for (let k = 3; k < fh.length; k++) { const j = fh[k] - Math.max(fh[k - 1], fh[k - 2], fh[k - 3]); if (j > best) { best = j; kc = k; } }
  let lead = Math.max(0, kc * F - Math.max(0, a0)) / SR;
  if (r.info) lead = r.info.tc == null ? (a1 - a0) / SR : Math.max(0, r.info.tc - Math.max(0, a0) / SR);   // a whiff is all lead-in
  // the SWING's level against the hit: the loudest 5 ms before (contact - 15 ms) against the loudest 5 ms in the 50 ms
  // from the contact (a whiff is all swing: 0 dB)
  const ic = r.info ? (r.info.tc == null ? -1 : Math.round(r.info.tc * SR)) : kc * F, W5 = 220;
  const rms5 = (a, b) => { let bst = 0; for (let q = Math.max(0, a); q + W5 <= Math.min(n, b); q += 110) { let s = 0; for (let i = q; i < q + W5; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; bst = Math.max(bst, s / W5); } return Math.sqrt(bst); };
  const swDb = ic < 0 ? 0 : cl(20 * Math.log10((rms5(a0, ic - 661) + 1e-9) / (rms5(ic, ic + 2205) + 1e-9)), -40, 0);
  return { lufs: lufs(L, R), peak: pk, sec: n / SR, span: (a1 - a0) / SR, ring: (i30 - ipk) * W / SR, cent: num / all, lo150: lo / all, hi4k: hi / all, top11: top / all, lead, swDb };
}
// FEATURE DISTANCE, 1 = a clearly audible step: a centroid 1.5x apart, 15 points of low end, 12 points above 4 kHz, 5
// points above 11 kHz (the arcade end's aliasing), a doubling of the ring or the length, 0.1 s more swing before the hit,
// the swing 8 dB louder against the hit
const feat = (m) => [Math.log2(m.cent) / 0.585, m.lo150 / 0.15, m.hi4k / 0.12, m.top11 / 0.05, Math.log2(Math.max(0.05, m.ring)), Math.log2(Math.max(0.1, m.span)), m.lead / 0.1, m.swDb / 8];
const FN = ["colour", "low end", "highs", "grit", "ring", "length", "lead-in", "swing level"];
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) * (x - b[i]), 0));
const why = (a, b) => a.map((x, i) => [FN[i], Math.abs(x - b[i])]).sort((p, q) => q[1] - p[1]).slice(0, 2).map(([f, d]) => f + " " + d.toFixed(1)).join(", ");

// ============================================================================================================
// THE STYLES (the blind round's three points) and AJ's pattern as a rule
const ARC = { meleeCrunch: 0.9, meleeComp: 0.85, meleeBits: 0.55, meleeRateCut: 0.45, meleeSnap: 0.9, meleeHype: 0.2, meleePlace: 0, meleeTail: 0 };
const HR = { meleeCrunch: 0.25, meleeComp: 0.55, meleeBits: 0, meleeRateCut: 0, meleeSnap: 0.35, meleeHype: 0, meleePlace: 1, meleeTail: 0.3 };
const FG = { meleeCrunch: 0.55, meleeComp: 0.9, meleeBits: 0, meleeRateCut: 0, meleeSnap: 0.85, meleeHype: 1, meleePlace: 1, meleeTail: 0.4 };
const STYLE_NAME = new Map([[ARC, "crunchy-arcade"], [HR, "hyper-real"], [FG, "fighting-game"]]);
const WP = (n) => MELEE_WEAPONS.indexOf(n), TG = (n) => MELEE_TARGETS.indexOf(n), HT = (n) => MELEE_HITS.indexOf(n);
const ARMORED = new Set(["mail", "plate armor", "wooden shield", "stone"]), HEAVY = new Set(["axe", "hammer / mace", "flail"]);
function styleFor(weapon, target) {
  if (ARMORED.has(target)) return ARC;
  if (HEAVY.has(weapon)) return HR;
  return FG;
}

// a design: weapon / target / hit by NAME, knobs, and the style the pattern gives (or a stated override)
function design(o) {
  const style = o.style || styleFor(o.weapon, o.target);
  const p = Object.assign({ wave: "melee" }, MELEE_DEFAULTS, style, o.k || {},
    { meleeWeapon: WP(o.weapon), meleeTarget: TG(o.target), meleeHit: HT(o.hit || "auto"), meleeSeed: o.seed }, CHASSIS);
  for (const k of Object.keys(p)) if (typeof p[k] === "number") p[k] = r2(p[k]);
  return { p, style: STYLE_NAME.get(style) + (o.style ? " (override)" : ""), lvl: o.lvl || 0 };
}

// ============================================================================================================
// THE FAMILY: two tables, composed
const VERB = {
  Chop:    { weapon: "axe",     target: "flesh",           hit: "edge",  k: { meleeWeight: 0.7, meleeSpeed: 0.5, meleeSwing: 0.5, meleeContact: 0.9, meleeBody: 0.8, meleeRing: 0.2 },
             idea: "an axe's edge into a body (the bite, the wet chop, bone)" },
  Cleave:  { weapon: "sword",   target: "cloth / leather", hit: "edge",  k: { meleeWeight: 0.75, meleeSpeed: 0.55, meleeSwing: 0.85, meleeContact: 0.9, meleeBody: 0.8, meleeRing: 0.5 },
             idea: "a big two-handed sword cut through a leather jerkin (the rip, the flesh under it)" },
  Slice:   { weapon: "katana",  target: "flesh",           hit: "edge",  k: { meleeWeight: 0.45, meleeSpeed: 0.8, meleeSwing: 0.7, meleeContact: 0.85, meleeBody: 0.45, meleeRing: 0.3 },
             idea: "a thin, fast blade drawn through flesh (the whistle, the wet cut, following through)" },
  Thrust:  { weapon: "spear",   target: "flesh",           hit: "point", k: { meleeWeight: 0.55, meleeSpeed: 0.65, meleeSwing: 0.35, meleeContact: 0.9, meleeBody: 0.9, meleeRing: 0.05 },
             idea: "a spear's point driven in with the whole body behind it (the shaft's push of air, the pierce, the push, the weight)" },
  Riposte: { weapon: "rapier",  target: "flesh",           hit: "point", k: { meleeWeight: 0.35, meleeSpeed: 0.85, meleeSwing: 0.3, meleeContact: 0.85, meleeBody: 0.35, meleeRing: 0.2 },
             idea: "a rapier's counter-thrust (a thin, quick lunge, the point going in)" },
  Clash:   { weapon: "sword",   target: "steel blade",     hit: "edge",  k: { meleeWeight: 0.6, meleeSpeed: 0.6, meleeSwing: 0.35, meleeContact: 1, meleeBody: 0.4, meleeRing: 0.6, meleeScrape: 0.5 },
             idea: "blade on blade (both ringing, the edges sliding)" },
  Swing:   { weapon: "sword",   target: "air (a miss)",    hit: "auto",  k: { meleeSpeed: 0.65, meleeSwing: 1 },
             idea: "a deliberate WHIFF: the blade through air, nothing hit" },
  Bash:    { weapon: "hammer / mace", target: "plate armor", hit: "blunt", k: { meleeWeight: 0.75, meleeSpeed: 0.45, meleeSwing: 0.45, meleeContact: 0.9, meleeBody: 0.9, meleeRing: 0.35 },
             idea: "a mace bashed into plate (the bong, the dent, the knight under it)" },
};
// ADJ: the character, the same rule on every verb. f(v) -> overrides { weapon?, target?, k: {...}, style?, lvl }
const up = (k, key, d, lo = 0, hi = 1) => cl((k[key] == null ? MELEE_DEFAULTS[key] : k[key]) + d, lo, hi);
const ADJ = {
  Reckless: { idea: "wild, over-committed: the fastest, widest arc, more weight, the edges sliding further", lvl: 0.5,
    f: (v) => ({ k: { meleeSpeed: up(v.k, "meleeSpeed", 0.25), meleeSwing: up(v.k, "meleeSwing", 0.25), meleeWeight: up(v.k, "meleeWeight", 0.15), meleeScrape: up(v.k, "meleeScrape", 0.3), meleeBone: 0.3 } }) },
  Heavy: { idea: "WEIGHT: the heaviest blow (Weight 0.95), much slower, the designed thump dominating under it", lvl: 0.5,
    f: (v) => ({ k: { meleeWeight: 0.95, meleeSpeed: up(v.k, "meleeSpeed", -0.3), meleeBody: 1, meleeThump: 0.9, meleeSwing: up(v.k, "meleeSwing", 0.1) } }) },
  Whirling: { idea: "SPINS: three revolutions accelerating into the blow (the whirl you hear coming)", lvl: 0,
    f: (v) => ({ k: { meleeSpins: 3, meleeSpeed: up(v.k, "meleeSpeed", 0.15), meleeSwing: up(v.k, "meleeSwing", 0.2) } }) },
  Iron: { idea: "a METAL target: flesh becomes mail, leather becomes plate (and a clash becomes heavy iron blades); the steel rings longer", lvl: 0,
    f: (v) => ({ target: { flesh: "mail", "cloth / leather": "plate armor" }[v.target] || v.target, style: v.target === "steel blade" ? ARC : undefined,
      k: { meleeRing: up(v.k, "meleeRing", 0.2), meleeWeight: up(v.k, "meleeWeight", v.target === "steel blade" ? 0.25 : 0.05) } }) },
  Grim: { idea: "GORE: the full contact, bone crunching, slower, a dark cave around it", lvl: 0,
    f: (v) => ({ k: { meleeContact: 1, meleeBone: 0.75, meleeWeight: up(v.k, "meleeWeight", 0.1), meleeSpeed: up(v.k, "meleeSpeed", -0.15), meleePlace: 4, meleeTail: 0.3 } }) },
  Swift: { idea: "SPEED: Speed 1, a lighter blow, a shorter arc (the quickest of its verb)", lvl: -0.5,
    f: (v) => ({ k: { meleeSpeed: 1, meleeWeight: up(v.k, "meleeWeight", -0.25), meleeSwing: up(v.k, "meleeSwing", -0.15), meleeBody: up(v.k, "meleeBody", -0.2) } }) },
  Keen: { idea: "SHARP and SINGING: a thinner, whistling edge (a sword becomes a katana) heard longer before it lands, the cut brighter, the blade ringing on after it", lvl: 0,
    f: (v) => ({ weapon: { sword: "katana", "hammer / mace": "axe" }[v.weapon] || v.weapon,
      k: { meleeSnap: 1, meleeRing: up(v.k, "meleeRing", 0.4), meleeSwing: up(v.k, "meleeSwing", 0.2), meleeSpeed: up(v.k, "meleeSpeed", -0.05), meleeContact: up(v.k, "meleeContact", 0.05) } }) },
  Razor: { idea: "a RAZOR edge: the thinnest blade (a katana), the lightest and fastest, almost no swing, the brightest cut, a hard snap, no ring", lvl: -0.5,
    f: (v) => ({ weapon: v.hit === "point" ? "rapier" : "katana",
      k: { meleeWeight: 0.2, meleeSpeed: 1, meleeSwing: 0.25, meleeSnap: 1, meleeRing: 0.05, meleeBody: 0.3, meleeContact: 1 } }) },
  Brutal: { idea: "CRUNCH: crushed and saturated to the end (Crunch 1, 7-bit), the designed thump, bone breaking", lvl: 0.5,
    f: (v) => ({ style: ARC, k: { meleeCrunch: 1, meleeComp: 0.95, meleeBits: 0.75, meleeWeight: 0.9, meleeThump: 0.7, meleeBone: 0.8 } }) },
};
const FAMILY = ["Reckless Chop", "Heavy Thrust", "Whirling Riposte", "Iron Slice", "Heavy Chop", "Reckless Slice", "Grim Cleave", "Swift Cleave",
  "Keen Cleave", "Swift Thrust", "Reckless Thrust", "Brutal Bash", "Grim Chop", "Reckless Clash", "Keen Swing", "Whirling Swing", "Swift Riposte",
  "Iron Clash", "Razor Cleave", "Iron Cleave", "Heavy Slice", "Swift Chop", "Whirling Chop", "Heavy Cleave"];
function compose(name, seed) {
  const [a, b] = name.split(" "), V = VERB[b], A = ADJ[a], o = A.f(V);
  const k = Object.assign({}, V.k, o.k);
  if (V.target === "air (a miss)") { delete k.meleeThump; delete k.meleeBone; }
  const weapon = o.weapon || V.weapon, target = o.target || V.target;
  const d = design({ weapon, target, hit: V.hit, k, style: o.style, seed, lvl: (A.lvl || 0) + (b === "Swing" ? -1 : 0) });
  d.idea = "[" + a + "] " + A.idea + " x [" + b + "] " + V.idea + ". Built: " + weapon + " -> " + target + " (" + V.hit + ")" + (o.style ? "" : "") + ", " + d.style + ".";
  return d;
}

// ============================================================================================================
// THE NAMED DESIGNS (weapons with their own names, and the non-weapon items judged as objects)
const NAMED = {
  "Sword Swing": [{ weapon: "sword", target: "air (a miss)", k: { meleeSpeed: 0.6, meleeSwing: 1 }, lvl: -1 },
    "REPLACE. A deliberate WHIFF, built: the blade's 6 stations shedding at their own speed (a ~1 kHz swish at the tip), the arc rising and falling, a Doppler tilt and a pan across, fighting-game (the arc a quarter longer, the Doppler doubled). Today's is the whoosh engine's generic sweep."],
  "Flail Swing": [{ weapon: "flail", target: "air (a miss)", k: { meleeSpeed: 0.5, meleeSwing: 1, meleeSpins: 2 }, lvl: -1 },
    "REPLACE. A flail swung round twice and missing: the ball's broad whoosh twice, accelerating, the chain's links rattling through it (a new weapon, \"flail\"), hyper-real (a heavy weapon)."],
  "War Hammer Crush": [{ weapon: "hammer / mace", target: "mail", hit: "blunt", k: { meleeWeight: 0.95, meleeSpeed: 0.3, meleeSwing: 0.5, meleeContact: 1, meleeBody: 1, meleeRing: 0.3, meleeBone: 1, meleeThump: 0.6 }, lvl: 0.5 },
    "REPLACE. A war hammer CRUSHING a man in mail: the slow broad whoosh, the links bursting, the bone crunch at full (celery snapping), the designed thump under it; crunchy-arcade (mail). Hammer Smash (the pick) is the same hammer on PLATE: a bong, not a crush."],
  "Spear Thrust": [{ weapon: "spear", target: "cloth / leather", hit: "point", k: { meleeWeight: 0.8, meleeSpeed: 0.4, meleeSwing: 0.55, meleeContact: 0.9, meleeBody: 0.8, meleeRing: 0.1 } },
    "REPLACE. A heavy polearm's thrust through a leather jerkin: the shaft's long push of air (Speed 0.4, Weight 0.8), the hide's puncture pop, the flesh under it pushed hard; fighting-game (a point). Today's is air only."],
  "Rapier Lunge": [{ weapon: "rapier", target: "cloth / leather", hit: "point", k: { meleeWeight: 0.4, meleeSpeed: 0.55, meleeSwing: 0.55, meleeContact: 0.85, meleeBody: 0.4, meleeRing: 0.3 } },
    "REPLACE. A rapier LUNGE (a new weapon, \"rapier\": long, thin, a whistling thrust): a longer reach than a riposte (Speed 0.55, the thin whistle carrying), the point through a doublet; fighting-game."],
  "Sword Clash 2": [{ weapon: "dagger", target: "steel blade", hit: "edge", k: { meleeWeight: 0.4, meleeSpeed: 0.7, meleeSwing: 0.2, meleeContact: 1, meleeBody: 0.3, meleeRing: 0.4, meleeScrape: 0 } },
    "REPLACE. A PARRY, not a clash: a parrying dagger catching a sword, a short, high \"ting-clank\" (the dagger's blade modes at 2.5-11 kHz), no slide; fighting-game. Sword Clash (the pick) is two swords ringing long and scraping."],
  "Hammer Smash 2": [{ weapon: "hammer / mace", target: "stone", hit: "blunt", k: { meleeWeight: 0.9, meleeSpeed: 0.35, meleeSwing: 0.45, meleeContact: 1, meleeBody: 0.9, meleeRing: 0.3, meleeThump: 0.5 }, lvl: 0.5 },
    "REPLACE. A hammer smashing STONE (a statue, a wall): the very hard knock, the stone's dead modes, the crumble, the head ringing; crunchy-arcade. Hammer Smash (the pick) is plate's bong."],
  "Katana Slice 2": [{ weapon: "katana", target: "cloth / leather", hit: "edge", k: { meleeWeight: 0.3, meleeSpeed: 1, meleeSwing: 0.3, meleeContact: 0.85, meleeBody: 0.35, meleeRing: 0.75 } },
    "REPLACE. A DRAW-CUT through a robe: the blade out and through in one motion, almost no swing heard (Swing 0.3, Speed 1), the cloth's dry rip, the flesh under it, and the blade SINGING on after it (Ring 0.75); fighting-game. Katana Slice (the pick) is a heavier, whistling cut through bare flesh."],
  "Ground Slam": [{ weapon: "hammer / mace", target: "ground", hit: "blunt", k: { meleeWeight: 1, meleeSpeed: 0.35, meleeSwing: 0.5, meleeContact: 1, meleeBody: 1, meleeThump: 0.8, meleePlace: 3, meleeTail: 0.4 }, lvl: 0.5 },
    "REPLACE. A heavy weapon slammed into the GROUND: the slow whoosh, the low thump, dirt thrown, the designed thump under it, outdoors; hyper-real (a heavy weapon)."],
  "Whip Crack": [{ weapon: "whip", target: "air (a miss)", k: { meleeSpeed: 0.6, meleeSwing: 0.7 } },
    "REPLACE. A whip's real physics: the thong's long whoosh, then the tip passing the speed of sound, a 0.3 ms N-wave (the crack) and the tear of air behind it; fighting-game. Today's is a whoosh with drive."],
  "Hit": [{ weapon: "staff", target: "cloth / leather", hit: "blunt", k: { meleeWeight: 0.5, meleeSwing: 0, meleeContact: 0.9, meleeBody: 0.7, meleeThump: 0.5 }, style: ARC, lvl: -1 },
    "ALT (today's kept as the base). A generic game HIT with no lead-in (Swing 0: it lands at once, wherever it is fired): a club on a padded body, the thump under it, crunchy-arcade."],
  "Visor Clank": [{ weapon: "fist", target: "plate armor", hit: "blunt", k: { meleeWeight: 0.2, meleeSwing: 0, meleeContact: 1, meleeBody: 0.2, meleeRing: 0.45 }, lvl: -1.5 },
    "ALT (today's kept as the base). A gauntlet knocking a visor shut: a small plate's clang with its beating pairs, light (Weight 0.2), no swing; crunchy-arcade (armor)."],
  "Sword Ting": [{ weapon: "dagger", target: "steel blade", hit: "edge", k: { meleeWeight: 0.15, meleeSwing: 0, meleeContact: 1, meleeBody: 0, meleeRing: 0.85, meleeScrape: 0, meleeSnap: 0.2 }, style: HR, lvl: -1.5 },
    "ALT (today's kept as the base). Two blades just touching: a light tap, both rings long and beating, nothing else; hyper-real (override: arcade's bits would grit the ring)."],
  "Crossbow Bolt": [{ weapon: "spear", target: "wooden shield", hit: "point", k: { meleeWeight: 0.3, meleeSpeed: 1, meleeSwing: 0.5, meleeContact: 0.9, meleeBody: 0.4, meleeRing: 0.1 }, lvl: -1.5 },
    "ALT (today's flyby kept as the base). The bolt LANDING: its short rush of air, the thock into a wooden shield, the shaft quivering in it; crunchy-arcade (a shield)."],
};
const KEPT = {
  "Knockout": "KEPT: AJ's own pick from an earlier care round (the bell). A cartoon knockout, not a blow.",
  "Triumphant Clank": "KEPT: a two-note victory stinger on the modal bank, a musical cue rather than a weapon landing; nothing in the melee engine is that.",
  "Gauntlet Creak": "KEPT: a leather-and-metal creak is friction (a stick-slip squeal), the friction engine's territory, not a blow.",
  "Blade Sheathe": "KEPT: a blade sliding into a scabbard and its guard clicking home; the melee engine has no scabbard (its scrape is steel on steel), so a redesign would be the wrong object.",
  "Anvil Strike": "KEPT: an anvil is a massive steel block with sparse, high, long modes; the melee engine's metals are a blade, a plate and a weapon head, none of them an anvil. A candidate for a later target, not a stretch of this one.",
};
const JUDGED = { "Katana Slice": ["katana-slice", "fighting-game"], "Axe Chop": ["axe-chop", "hyper-real"], "Sword Clash": ["sword-clash", "fighting-game"],
  "Hammer Smash": ["hammer-smash", "crunchy-arcade"], "Dagger Stab": ["dagger-stab", "fighting-game"], "Shield Block": ["shield-block", "crunchy-arcade"],
  "Critical Slash": ["critical-slash", "crunchy-arcade"] };
const SKIPPED = { "Enemy Death": "the voice engine owns it", "Punch / Kick": "pending (punch-kick-2)" };
const SIBLING = { "Sword Clash 2": "Sword Clash", "Hammer Smash 2": "Hammer Smash", "Katana Slice 2": "Katana Slice", "War Hammer Crush": "Hammer Smash",
  "Rapier Lunge": "Swift Riposte", "Spear Thrust": "Swift Thrust", "Flail Swing": "Whirling Swing", "Sword Swing": "Keen Swing", "Ground Slam": "Hammer Smash 2" };
const VARY = { meleeSeed: 1, meleeWeight: 0.05, meleeSpeed: 0.08 };

// the scope check: every section name is in exactly one list
{ const all = new Set([...FAMILY, ...Object.keys(NAMED), ...Object.keys(KEPT), ...Object.keys(JUDGED), ...Object.keys(SKIPPED), "Punch / Kick"]);
  const miss = SECTION.filter((n) => !all.has(n)), extra = [...all].filter((n) => !SECTION.includes(n));
  if (miss.length || extra.length) throw new Error("scope: missing " + miss.join(", ") + " / not in the section " + extra.join(", ")); }

// ============================================================================================================
// LEVEL: today's section median + the design's offset, by Peak control (<= 1.2, 0.05 steps) and gain
const NOW = {}; for (const n of SECTION) NOW[n] = measure(renderNow(PRESETS[n]));
const SEC_MEDIAN = median(SECTION.map((n) => NOW[n].lufs));
function level(p, offset) {
  const target = SEC_MEDIAN + offset; p.meleePeak = 0; p.gain = 1;
  let m = measure(renderNew(p)), best = { pk: 0, m };
  while (m.lufs < target - 0.25 && p.meleePeak < 1.2) { p.meleePeak = r2(p.meleePeak + 0.05); m = measure(renderNew(p)); if (m.lufs > best.m.lufs) best = { pk: p.meleePeak, m }; }
  if (m.lufs < target - 0.25) { p.meleePeak = best.pk; m = best.m; }   // short at the cap: the loudest step found
  if (m.lufs > target + 0.25) { p.gain = Math.floor(Math.pow(10, (target - m.lufs) / 20) * 100) / 100; m = measure(renderNew(p)); }
  return { m, target };
}
// the duration a preset carries: the engine's own trimmed length
function fixDuration(p) { const r = renderNew(Object.assign({}, p, { duration: 0 })); p.duration = Math.ceil(r.L.length / SR * 100) / 100; }

// ============================================================================================================
// RUN
const arg = process.argv[2], only = arg && arg !== "sep" ? arg : null;
const names = [...Object.keys(NAMED), ...FAMILY].sort((a, b) => SECTION.indexOf(a) - SECTION.indexOf(b));
if (only && !names.some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + names.map(slug).join(", ")); process.exit(1); }
const wavDir = join(ROOT, "soundtests", "melee-redo"), jsonDir = join(ROOT, "tools", "new-presets");
if (arg !== "sep") mkdirSync(wavDir, { recursive: true });
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
const fmt = (m) => m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(2) + ", " + m.sec.toFixed(2) + " s (audible " + m.span.toFixed(2) + ", rings " + m.ring.toFixed(2) +
  ", lead-in " + Math.round(m.lead * 1000) + " ms, swing " + m.swDb.toFixed(0) + " dB), centroid " + Math.round(m.cent) + " Hz, <150 Hz " + (100 * m.lo150).toFixed(0) + "%, >4 kHz " + (100 * m.hi4k).toFixed(0) + "%, >11 kHz " + (100 * m.top11).toFixed(1) + "%";
console.log("today's section: " + SECTION.length + " presets, median " + SEC_MEDIAN.toFixed(1) + " LUFS (Normalize on)");
const rows = [];
names.forEach((name, idx) => {
  if (only && slug(name) !== only) return;
  const seed = 301 + idx;
  let d, idea, alt = false;
  if (FAMILY.includes(name)) { d = compose(name, seed); idea = "REPLACE. " + d.idea; }
  else { const [o, txt] = NAMED[name]; d = design(Object.assign({ seed }, o)); idea = txt; alt = /^ALT/.test(txt); }
  fixDuration(d.p);
  const { m, target } = level(d.p, d.lvl), r = renderNew(d.p), now = NOW[name];
  rows.push({ name, idea, alt, p: d.p, style: d.style, r, m, now, target });
  if (arg !== "sep") { wav(slug(name) + "-1-now.wav", renderNow(PRESETS[name]), name + " (now)"); wav(slug(name) + "-2-new.wav", r, name); }
  console.log(name.padEnd(17) + "NEW " + fmt(m) + "\n" + "".padEnd(17) + "    " + d.style + "; aimed at " + target.toFixed(1) + " LUFS: Peak control " + d.p.meleePeak + ", gain " + d.p.gain + (alt ? "; ALT" : "") +
    "\n" + "".padEnd(17) + "NOW " + fmt(now));
});
if (only) process.exit(0);

// the seven judged picks, re-rendered from their KEY.md patches and levelled the same way (the separation set; the port)
const picks = {}, pickRows = [];
for (const [name, [round, id]] of Object.entries(JUDGED)) {
  const key = readFileSync(join(ROOT, "soundtests", "proto-melee", round, "KEY.md"), "utf8");
  const sec = key.split("\n## ").find((s) => s.includes("`" + id + "`")), js = JSON.parse(sec.split("```json\n")[1].split("\n```")[0]);
  const p = Object.assign({ wave: "melee" }, MELEE_DEFAULTS, js.st, { meleeSeed: js.seed }, CHASSIS, { width: js.st.width == null ? 0.6 : js.st.width });
  fixDuration(p);
  const { m } = level(p, 0);
  picks[name] = Object.assign({}, p, { _vary: VARY });
  pickRows.push({ name, m, style: id });
}

// ---- SEPARATION, as the section would ship: the redesigns, the seven picks, the kept and the alt bases (today's)
const set = rows.map((x) => ({ name: x.name + (x.alt ? " (alt)" : ""), f: feat(x.m) }));
for (const x of pickRows) set.push({ name: x.name, f: feat(x.m) });
for (const n of [...Object.keys(KEPT), ...rows.filter((x) => x.alt).map((x) => x.name), "Punch / Kick", "Enemy Death"]) set.push({ name: n + (KEPT[n] || rows.some((x) => x.alt && x.name === n) ? " (today's)" : " (today's, not in scope)"), f: feat(NOW[n]) });
const F = (n) => (set.find((x) => x.name === n) || set.find((x) => x.name.startsWith(n + " ("))).f;
const sepLines = [];
console.log("\nSEPARATION (feature distance; 1 = a clearly audible step: a centroid 1.5x apart, 15 points of low end, a doubling of the ring, 0.1 s more lead-in...)");
for (const x of rows) {
  const me = x.name + (x.alt ? " (alt)" : ""), others = set.filter((q) => q.name !== me).map((q) => [q.name, dist(F(me), q.f), why(F(me), q.f)]).sort((a, b) => a[1] - b[1]);
  const sib = SIBLING[x.name], sibTxt = sib ? "vs " + sib + " " + dist(F(me), F(sib)).toFixed(2) + " (" + why(F(me), F(sib)) + ");  " : "";
  const line = me.padEnd(23) + sibTxt + "nearest " + others[0][0] + " " + others[0][1].toFixed(2) + " (" + others[0][2] + ")";
  sepLines.push(line); console.log("  " + line);
}
const pairs = []; for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) pairs.push([set[i].name, set[j].name, dist(set[i].f, set[j].f), why(set[i].f, set[j].f)]);
pairs.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as the section would ship:"); pairs.slice(0, 10).forEach(([a, b, d, w]) => console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")"));
if (arg === "sep") process.exit(0);

// ---- JSON, the listen-through and KEY.md
const json = {};
for (const x of rows) {
  const p = Object.assign({}, x.p, { _vary: VARY });
  json[x.name] = x.alt ? Object.assign({}, PRESETS[x.name], { _alts: [p] }) : p;
}
writeFileSync(join(jsonDir, "melee-redo.json"), JSON.stringify(json, null, 1) + "\n");
writeFileSync(join(jsonDir, "melee-picks.json"), JSON.stringify(picks, null, 1) + "\n");
const gap = Math.round(0.4 * SR); let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = []; let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name + (x.alt ? "  (alt)" : "")); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Melee redo, all new");
const short = rows.filter((x) => x.m.lufs < x.target - 0.5);
const lv = rows.map((x) => "  " + x.name.padEnd(17) + "now " + x.now.lufs.toFixed(1) + "  new " + x.m.lufs.toFixed(1) + " LUFS  (aimed " + x.target.toFixed(1) + ", Peak " + x.p.meleePeak + ", gain " + x.p.gain + ")");
writeFileSync(join(wavDir, "KEY.md"), "# Melee redo: the rest of Hits / Melee on the melee engine\n\n" +
  "`all-new.wav` plays the " + rows.length + " redesigns in section order, 0.4 s apart. For each sound, `<slug>-1-now.wav` is today's preset as the\n" +
  "app plays it and `<slug>-2-new.wav` is the redesign. Normalize on, NOT loudness-matched, so each is what its button plays (the new ones: the\n" +
  "prototype through the app's master stage, emulated: the melee engine is not in the app yet).\n\n" +
  "**Levels.** Today's section plays at a median of " + SEC_MEDIAN.toFixed(1) + " LUFS. Each new one is aimed there (a whiff or a small object 1-1.5 dB under,\n" +
  "the heaviest hits 0.5 over) by the engine's Peak control (capped at 1.2, the gun's ceiling) and gain. A hit is nearly all spike: " + short.length + " of " + rows.length + "\n" +
  "land SHORT of their aim at the cap, by " + (short.length ? Math.min(...short.map((x) => x.target - x.m.lufs)).toFixed(1) + "-" + Math.max(...short.map((x) => x.target - x.m.lufs)).toFixed(1) : "0") + " dB: turn those up in your head, or the louder one will sound better." + "\n\n**Why they are short, measured.** Today's Hits / Melee are mostly the whoosh engine: steady noise with a low crest, which BS.1770 reads as loud. A melee take is a quiet swing and then a HIT, and the integrated loudness under-reads a transient. Peak control limits the HIT alone (before the swing joins, so the swing keeps its set level under the hit: limiting the whole buffer raised the swing by up to 12 dB to meet a clamped hit, which is what an earlier draft did). The limiter mostly lifts the low body, which K-weighting discounts, so 12 dB of limiting buys 0-4 dB of LUFS. Two full passes (Peak 2, past the gun's 1.2 ceiling) would buy 1-3 dB more (Razor Cleave -17.1 -> -13.6, Hammer Smash 2 -15.9 -> -14.2, Heavy Chop -14.0 -> -13.3), so the cap stays. Judge each new one against today's at matched loudness (turn it up), or say the word and the levels move to the master Limiter, which the guns' rule kept off." + "\n\n" +
  "**AJ's pattern** from the seven picks is a rule here (`styleFor`): a target of plate, mail, a shield or stone -> crunchy-arcade; else a heavy weapon\n" +
  "(axe, hammer, flail) -> hyper-real; else -> fighting-game. Overrides are stated. No after-sounds. A Swing is a deliberate whiff; Thrust, Lunge and\n" +
  "Riposte land a point; Chop, Cleave and Slice an edge; Bash and Crush blunt.\n\n" +
  "**ALT** = today's stays the base and the new one joins as an `_alts` take (repeat clicks discover it). **Not here:** " +
  Object.entries(SKIPPED).map(([n, w]) => n + " (" + w + ")").join(", ") + ", and the seven judged blind-round sounds (`tools/new-presets/melee-picks.json`: " +
  Object.entries(JUDGED).map(([n, [, id]]) => n + " " + id).join(", ") + ").\n\n```\n" + key.join("\n") + "\n```\n\n## What each one is\n\n" +
  rows.map((x) => "- **" + x.name + "** (`" + slug(x.name) + "`, " + x.style + "): " + x.idea + "\n  Measured: " + fmt(x.m) + ".").join("\n") +
  "\n\n## Kept (no WAVs: nothing to compare)\n\n" + Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") +
  "\n\n## The family: two tables composed\n\nVerb = what lands (weapon -> target, hit):\n\n" + Object.entries(VERB).map(([k, v]) => "- **" + k + "**: " + v.idea + " (" + v.weapon + " -> " + v.target + ", " + v.hit + ")").join("\n") +
  "\n\nAdjective = the character, the same rule on every verb:\n\n" + Object.entries(ADJ).map(([k, v]) => "- **" + k + "**: " + v.idea).join("\n") +
  "\n\n## Loudness (BS.1770)\n\n```\n" + lv.join("\n") + "\n```\n\n## Separation (feature distance; 1 = a clearly audible step)\n\nThe set is the section as it would ship: these redesigns, the seven picks, the kept presets and the alt bases (today's).\n\n```\n" + sepLines.join("\n") + "\n\nclosest pairs as the section would ship:\n" +
  pairs.slice(0, 10).map(([a, b, d, w]) => "  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")").join("\n") + "\n```\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, melee-redo.json, melee-picks.json");
