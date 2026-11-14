/* guns-redo.mjs — the GUNS still on the impact engine, redesigned on the gun engine (wave 38). PROPOSAL / A-B material:
 * nothing here is wired into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better.
 *
 *   node tools/proto/guns-redo.mjs            renders every redesign (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/guns-redo.mjs sep        separation only (prints the named pairs and the closest)
 *   node tools/proto/guns-redo.mjs <slug>     one redesign, measured, its WAVs written (no JSON, no all-new.wav)
 *
 * WHY. The gun engine won all eight of AJ's blind rounds (soundtests/proto-gun/); the eight base guns move onto it
 * (tools/new-presets/gun-picks.json). Twelve more Guns presets are the same impact-engine shot: Gunshot 2, Shotgun 2,
 * Rifle Crack 2, Compact Fire, Suppressed Crack, Suppressed Fire, Burst Round, Magnum Fire, Heavy Discharge, Heavy Round,
 * Snub Report, Snub Discharge. NOT here: the energy / plasma / rail presets (the energy engine owns them), Shell Casing,
 * the reloads, Ricochet Zing and Bullet Whiz (gun foley owns them), Pistol Shot, Sniper Rifle and Sniper From Afar (AJ's
 * blast picks).
 *
 * AJ'S PREFERENCE PATTERN, from the eight picks: CRUNCHY / ARCADE for handguns and suppressed (Gunshot, Magnum Shot,
 * Suppressed all picked it), HYPER-REAL for long guns (Rifle Crack, Shotgun), the MIDDLE point for automatic fire (Full
 * Auto, 3-Round Burst, Machine Gun). And the RULE: no after-sound layered on a shot (no pump rack, no bolt worked after it,
 * no casings landing), so every redesign carries Casings 0 and a pump or bolt action carries Mechanism 0. A mechanism that
 * sounds WITH the shot (a slide, a revolver's hammer, a carrier cycling under a burst) is fine.
 *
 * EACH IS A DIFFERENT GUN, not a re-roll: its numbered sibling and the eight base guns are its neighbours, so each design
 * moves at least one of what a listener hears first (caliber, barrel, place, rounds and rate, the retro end) and the
 * separation check below measures it.
 *
 * THE ENGINE: the app's own chain, built in a vm from dsp.js + synth.js. Until the gun engine is ported into the app,
 * dsp.js lacks makeGun, so the proven port block (tools/proto/gun-port-dsp.js, sample-identical to tools/proto/gun.mjs on
 * all 21 of its takes) is appended and synth.js gets the two-line render branch; once the app has it, the app's files
 * are used as they are. Checked on load: the build renders ordinary presets byte-identical to the exported bundle.
 * Chassis as the eight base guns: the amp envelope a plain gain, the filter OPEN (a 20 kHz low-pass: the chain's filter
 * cannot be bypassed, and a 40 Hz high-pass would cut the .50's 40 Hz body), no drive, no reverb (the place is the gun's).
 * "Now" renders with the EXPORTED engine. Normalize ON, NOT loudness-matched: each WAV is what its button plays. Levels
 * as the base guns: a single shot to at least -18.5 LUFS by the smallest 0.05 step of Peak control, a burst down to
 * -14.5 by gain (the buffered engines' bar). TODAY'S impact guns play at -8.2 to -14.5 (most -9 to -12), so the new ones are mostly 7-10 dB
 * quieter: KEY.md says so, so the louder one is not mistaken for the better one.
 *
 * Writes soundtests/guns-redo/<slug>-1-now.wav, <slug>-2-new.wav, all-new.wav + KEY.md, and
 * tools/new-presets/guns-redo.json ({ name: patch with _vary }).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const G = () => ({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
  TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
const ex = createContext(G()); ex.window = ex; ex.globalThis = ex;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ex, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ex), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS;

// ---- the gun engine in the app's chain
const GUN_ROWS = { gunCaliber: 0.32, gunBarrel: 0.3, gunAction: 1, gunSnap: 0.6, gunPunch: 0.7, gunCrack: 0.5, gunMech: 0.4, gunCasing: 0,
  gunPlace: 1, gunTail: 0.5, gunSuppress: 0, gunCrunch: 0.3, gunComp: 0.5, gunBits: 0, gunRateCut: 0, gunRPM: 700, gunRounds: 1,
  gunJitter: 0.4, gunBoltLock: 0, gunPeak: 0, gunSeed: 0 };
let dsp = readFileSync(join(ROOT, "dsp.js"), "utf8"), syn = readFileSync(join(ROOT, "synth.js"), "utf8");
const ported = /function makeGun\(/.test(dsp) && /isGun/.test(syn);
if (!ported) {
  dsp += "\n" + readFileSync(join(ROOT, "tools", "proto", "gun-port-dsp.js"), "utf8");
  const a1 = "glassLevel(gb.L, gb.R, SR, st.glPeak || 0); glL = gb.L; glR = gb.R; }\n";
  const a2 = "      oscL = glL[i]; oscR = glR[i];                   // prebuilt strike, break and pieces (already stereo)\n";
  if (syn.split(a1).length !== 2 || syn.split(a2).length !== 2) throw new Error("synth.js moved: the gun branch's anchors are not unique");
  syn = syn.replace(a1, a1 + "  const isGun = waveType === 38;\n  let gnL = null, gnR = null;\n  if (isGun) { const gg = makeGun(SR, n, gunCfg(st), Math.round(st.gunSeed || 0)); gunLevel(gg.L, gg.R, SR, st.gunPeak || 0); gnL = gg.L; gnR = gg.R; }\n")
    .replace(a2, a2 + "    } else if (isGun) {\n      oscL = gnL[i]; oscR = gnR[i];\n");
}
const ec = createContext(G()); ec.window = ec; ec.globalThis = ec;
runInContext('"use strict";' + dsp + "\n" + syn + "\nthis.__r = renderSound;", ec);
const DEFAULTS = Object.assign({}, GUN_ROWS, CS.DEFAULTS);
const strip = (p) => { const o = Object.assign({}, p); delete o._vary; delete o._alts; return o; };
const renderNew = (p) => ec.__r(Object.assign({}, DEFAULTS, strip(p)), DEFAULTS, { normalize: true });
const renderNow = (p) => CS.render(Object.assign({}, CS.DEFAULTS, strip(p)), { normalize: true });
for (const n of ["Gunshot 2", "Coin", "Glass Shatter", "Pistol Shot"]) {   // the build IS the app's chain
  const a = renderNow(PRESETS[n]), b = renderNew(PRESETS[n]);
  for (let i = 0; i < a.L.length; i++) if (a.L[i] !== b.L[i] || a.R[i] !== b.R[i]) throw new Error("the vm build differs from the export on " + n);
}

// ---- measurement
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
// RECTANGULAR on purpose: energy shares of the zero-padded whole sound (a Hann window would all but drop a shot at t = 0)
function measure(r, rounds) {
  const L = r.L, R = r.R, n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  let N = 1; while (N < n) N <<= 1; const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = (L[i] + R[i]) / 2; fft(re, im);
  let all = 0, num = 0, lo = 0, hi = 0, top = 0;
  for (let k = 1; k < N / 2; k++) { const f = k * SR / N, p = re[k] * re[k] + im[k] * im[k]; all += p; num += f * p; if (f < 150) lo += p; if (f > 4000) hi += p; if (f > 11000) top += p; }
  // the audible span (-40 dB of the peak) and the ring: from the loudest 10 ms to the last 10 ms within 30 dB of it
  let a0 = -1, a1 = 0; for (let i = 0; i < n; i++) { const m = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (m > pk * 0.01) { if (a0 < 0) a0 = i; a1 = i; } }
  const W = 441, env = []; for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; env.push(10 * Math.log10(s / W + 1e-20)); }
  const emax = Math.max(...env), ipk = env.indexOf(emax); let i30 = ipk; for (let k = env.length - 1; k > ipk; k--) if (env[k] > emax - 30) { i30 = k; break; }
  return { lufs: lufs(L, R), peak: pk, sec: n / SR, span: (a1 - a0) / SR, ring: (i30 - ipk) * W / SR, cent: num / all, lo150: lo / all, hi4k: hi / all, top11: top / all, rounds: rounds || 1 };
}
// FEATURE DISTANCE, 1 = a clearly audible step: a centroid 1.5x apart, 15 points of low end, 12 points above 4 kHz, 5
// points above 11 kHz (the arcade end's aliasing), a doubling of the ring or of the length, a doubling of the rounds
const feat = (m) => [Math.log2(m.cent) / 0.585, m.lo150 / 0.15, m.hi4k / 0.12, m.top11 / 0.05, Math.log2(Math.max(0.05, m.ring)), Math.log2(Math.max(0.1, m.span)), Math.log2(m.rounds)];
const FN = ["colour", "low end", "highs", "grit", "ring", "length", "rounds"];
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) * (x - b[i]), 0));
const why = (a, b) => a.map((x, i) => [FN[i], Math.abs(x - b[i])]).sort((p, q) => q[1] - p[1]).slice(0, 2).map(([f, d]) => f + " " + d.toFixed(1)).join(", ");

// ---- the designs
const ARC = { gunCrunch: 0.95, gunComp: 0.85, gunBits: 0.6, gunRateCut: 0.5, gunSnap: 1 };   // the crunchy / arcade point
const HR = { gunCrunch: 0.3, gunComp: 0.6, gunBits: 0, gunRateCut: 0 };                      // the hyper-real point
const MID = { gunCrunch: 0.6, gunComp: 0.7, gunBits: 0.25, gunRateCut: 0 };                  // between (automatic fire)
const CHASSIS = { width: 0.6, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06, filterMode: 0, cutoff: 20000, reso: 0.31, drive: 0, reverb: 0, gain: 1 };
const D = (point, o, seed, duration) => Object.assign({ wave: 38 }, GUN_ROWS, point, o, { gunCasing: 0, gunSeed: seed }, CHASSIS, { duration });
const DESIGNS = {
  "Gunshot 2": ["HANDGUN, arcade. A .45 automatic fired down a STREET, the facades' flutter ringing on behind it, the crunchiest pistol in the set: 7-bit, a 1/6 rate. Gunshot is a 9 mm in a small room at 9 bits and 1/5.",
    D(ARC, { gunCaliber: 0.45, gunBarrel: 0.3, gunAction: 1, gunMech: 0.45, gunPunch: 0.85, gunCrack: 0.75, gunPlace: 2, gunTail: 0.6, gunCrunch: 0.9, gunBits: 0.75, gunRateCut: 0.7 }, 201, 1.2)],
  "Shotgun 2": ["LONG GUN, hyper-real. A sawn-off double barrel inside a WAREHOUSE: the biggest bore with the shortest barrel (all bark and boom, little crack), a break action so nothing cycles, the walls and racks answering in 10-70 ms and a long metal tail. Shotgun is a pump 12 gauge outdoors with a slap-back; its alt the crunchy one in a room.",
    D(HR, { gunCaliber: 0.95, gunBarrel: 0.08, gunAction: 0, gunMech: 0, gunSnap: 0.7, gunPunch: 1, gunCrack: 0.35, gunPlace: 4, gunTail: 0.5 }, 202, 2)],
  "Rifle Crack 2": ["LONG GUN, hyper-real. A marksman rifle in a CANYON: a step up from Rifle Crack's 5.56 (a 178 Hz thump) with the brightest crack in the set (the longest barrel, Crack 1, its supersonic snap), the bolt left still (it would be worked after the shot), and the rock throwing it back at 0.45, 0.8 and 1.15 s.",
    D(HR, { gunCaliber: 0.55, gunBarrel: 1, gunAction: 4, gunMech: 0, gunSnap: 0.7, gunPunch: 0.7, gunCrack: 1, gunPlace: 5, gunTail: 0.6 }, 203, 2)],
  "Compact Fire": ["HANDGUN, arcade. A pocket pistol (Caliber 0.12, the smallest round: a 242 Hz pop over 38 ms) with the boxiest barrel, DRY: the smallest, tightest \"pap\" in the set, its slide snapping with it.",
    D(ARC, { gunCaliber: 0.12, gunBarrel: 0.05, gunAction: 1, gunMech: 0.5, gunPunch: 0.7, gunCrack: 0.55, gunPlace: 0, gunTail: 0, gunBits: 0.55, gunRateCut: 0.4 }, 204, 0.35)],
  "Suppressed Crack": ["SUPPRESSED, arcade. A suppressed RIFLE firing supersonic rounds: the can takes the blast but not the bullet, so a crack stays on top of the \"pfft\" (Suppressor 0.35), the carrier cycling under it, a small room. Suppressed is a subsonic pistol, dry, no crack at all.",
    D(ARC, { gunCaliber: 0.48, gunBarrel: 0.8, gunAction: 5, gunMech: 0.5, gunSuppress: 0.35, gunPunch: 0.75, gunCrack: 0.9, gunPlace: 3, gunTail: 0.2 }, 205, 0.5)],
  "Suppressed Fire": ["SUPPRESSED + AUTOMATIC, the middle point (AJ's pick for automatic fire). A suppressed submachine gun: eight tight \"pfft\"s at 850 a minute, the bolt clattering louder than the shots (Mechanism 0.6), a small room.",
    D(MID, { gunCaliber: 0.3, gunBarrel: 0.35, gunAction: 5, gunMech: 0.6, gunSuppress: 0.85, gunPunch: 0.7, gunCrack: 0.3, gunPlace: 3, gunTail: 0.25, gunRPM: 850, gunRounds: 8, gunJitter: 0.5 }, 206, 1.1)],
  "Burst Round": ["AUTOMATIC, the middle point. A heavier carbine's three-round burst, SLOWER (720 a minute, 83 ms) and OUTDOORS with a slap-back. 3-Round Burst is a 5.56 at 900 a minute down a street.",
    D(MID, { gunCaliber: 0.6, gunBarrel: 0.55, gunAction: 5, gunMech: 0.45, gunPunch: 0.9, gunCrack: 0.8, gunPlace: 1, gunTail: 0.55, gunRPM: 720, gunRounds: 3, gunJitter: 0.5 }, 207, 1.75)],
  "Magnum Fire": ["HANDGUN, arcade. A semi-auto hand cannon (Caliber 0.88: a 128 -> 44 Hz thump, the biggest handgun) OUTDOORS, its slap-back and rolling tail, a little less crushed (Bits 0.55, Rate cut 0.35). Magnum Shot is a revolver down a street at 8 bits.",
    D(ARC, { gunCaliber: 0.88, gunBarrel: 0.4, gunAction: 1, gunMech: 0.4, gunPunch: 1, gunCrack: 0.7, gunPlace: 1, gunTail: 0.55, gunCrunch: 0.9, gunBits: 0.55, gunRateCut: 0.35 }, 208, 1.4)],
  "Heavy Discharge": ["LONG GUN, hyper-real. A .50 anti-materiel rifle, ONE shot, outdoors: the deepest thump (110 -> 40 Hz over 135 ms), the darkest of the long guns (Crack 0.45), and the LONGEST rolling tail in the set (Tail 1). Machine Gun is the same round as a burst at the middle point.",
    D(HR, { gunCaliber: 1, gunBarrel: 0.85, gunAction: 4, gunMech: 0, gunSnap: 0.7, gunPunch: 1, gunCrack: 0.45, gunPlace: 1, gunTail: 1 }, 209, 2.6)],
  "Heavy Round": ["LONG GUN, hyper-real. A heavy slug from a short, boxy barrel in a small ROOM: a big bore (Caliber 0.95), a fat bark and little crack, the room closing it down fast. Heavy Discharge is the long-barrel .50 outdoors, ringing for two seconds.",
    D(HR, { gunCaliber: 0.95, gunBarrel: 0.3, gunAction: 0, gunMech: 0, gunSnap: 0.6, gunPunch: 1, gunCrack: 0.5, gunPlace: 3, gunTail: 0.35 }, 210, 0.9)],
  "Snub Report": ["HANDGUN, arcade. A snub-nosed .38 revolver in an empty WAREHOUSE (a parking garage): no barrel at all (a sharp, thin bark at ~770 Hz, more crack than thump), the hammer falling just before the shot, a long metal ring after it.",
    D(ARC, { gunCaliber: 0.38, gunBarrel: 0, gunAction: 2, gunMech: 0.4, gunPunch: 0.6, gunCrack: 0.9, gunPlace: 4, gunTail: 0.4 }, 211, 1.6)],
  "Snub Discharge": ["HANDGUN, arcade at its rawest. The snub revolver again, DRY and pushed to the end of the retro range: 6-bit, a 1/7 rate, Crunch 1, Compression 0.9. Snub Report rings on in a warehouse at 9 bits.",
    D(ARC, { gunCaliber: 0.5, gunBarrel: 0.05, gunAction: 2, gunMech: 0.5, gunPunch: 0.9, gunCrack: 0.7, gunPlace: 0, gunTail: 0, gunCrunch: 1, gunComp: 0.9, gunBits: 0.85, gunRateCut: 0.8 }, 212, 0.45)],
};
const SIBLING = { "Gunshot 2": "Gunshot", "Shotgun 2": "Shotgun", "Rifle Crack 2": "Rifle Crack", "Suppressed Crack": "Suppressed", "Suppressed Fire": "Suppressed",
  "Burst Round": "3-Round Burst", "Magnum Fire": "Magnum Shot", "Heavy Discharge": "Heavy Round", "Heavy Round": "Heavy Discharge", "Snub Report": "Snub Discharge",
  "Snub Discharge": "Snub Report", "Compact Fire": "Gunshot" };
const VARY = { gunSeed: 1, gunCaliber: 0.04, gunPunch: 0.08 };

// ---- level (as the eight base guns): a shot up to -18.5 LUFS by Peak control in 0.05 steps, a burst down to -14.5 by gain
const LO = -18.5, HI = -14.5;
function level(p) {
  delete p.gunPeak; p.gain = 1;
  let m = measure(renderNew(p), p.gunRounds);
  while (m.lufs < LO && (p.gunPeak || 0) < 2) { p.gunPeak = Math.round(((p.gunPeak || 0) + 0.05) * 100) / 100; m = measure(renderNew(p), p.gunRounds); }
  if (m.lufs > HI) { p.gain = Math.floor(Math.pow(10, (HI - 0.1 - m.lufs) / 20) * 100) / 100; m = measure(renderNew(p), p.gunRounds); }
  if (!p.gunPeak) p.gunPeak = 0;
  return m;
}

// ---- run
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const arg = process.argv[2], only = arg && arg !== "sep" ? arg : null;
if (only && !Object.keys(DESIGNS).some((n) => slug(n) === only)) { console.log("no redesign named " + only + "; slugs: " + Object.keys(DESIGNS).map(slug).join(", ")); process.exit(1); }
const wavDir = join(ROOT, "soundtests", "guns-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
if (arg !== "sep") mkdirSync(wavDir, { recursive: true });
const fmt = (m) => m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(2) + ", " + m.sec.toFixed(2) + " s (audible " + m.span.toFixed(2) + ", rings " + m.ring.toFixed(2) + "), centroid " + Math.round(m.cent) +
  " Hz, <150 Hz " + (100 * m.lo150).toFixed(0) + "%, >4 kHz " + (100 * m.hi4k).toFixed(0) + "%, >11 kHz " + (100 * m.top11).toFixed(1) + "%" + (m.rounds > 1 ? ", " + m.rounds + " rounds" : "");
console.log((ported ? "the app has the gun engine" : "dsp.js has no makeGun yet: the proven port block (tools/proto/gun-port-dsp.js) is built in") + "; the vm build renders 4 presets byte-identical to the export");
const rows = [];
for (const [name, [idea, p]] of Object.entries(DESIGNS)) {
  if (only && slug(name) !== only) continue;
  const m = level(p), r = renderNew(p), now = renderNow(PRESETS[name]), mn = measure(now, Math.round(PRESETS[name].repeat || 1));
  rows.push({ name, idea, p, r, m, now: mn });
  if (arg !== "sep") { wav(slug(name) + "-1-now.wav", now, name + " (now)"); wav(slug(name) + "-2-new.wav", r, name); }
  console.log(name.padEnd(17) + "NEW " + fmt(m) + "\n" + "".padEnd(17) + "    Peak control " + p.gunPeak + ", gain " + p.gain + "\n" + "".padEnd(17) + "NOW " + fmt(mn));
}
if (only) process.exit(0);

// ---- separation, as the section would ship: the eight base guns (gun-picks.json) + Shotgun's alt + these twelve + the
// two blast picks (Pistol Shot, Sniper Rifle)
const picks = JSON.parse(readFileSync(join(jsonDir, "gun-picks.json"), "utf8"));
const set = rows.map((x) => ({ name: x.name, f: feat(x.m) }));
for (const [n, p] of Object.entries(picks)) {
  set.push({ name: n, f: feat(measure(renderNew(p), p.gunRounds)) });
  (p._alts || []).forEach((a, j) => set.push({ name: n + " (alt " + (j + 1) + ")", f: feat(measure(renderNew(a), a.gunRounds)) }));
}
for (const n of ["Pistol Shot", "Sniper Rifle"]) set.push({ name: n, f: feat(measure(renderNow(PRESETS[n]), 1)) });
const F = (n) => set.find((x) => x.name === n).f;
const sepLines = [];
console.log("\nSEPARATION (feature distance; 1 = a clearly audible step: a centroid 1.5x apart, 15 points of low end, a doubling of the ring...)");
for (const x of rows) {
  const sib = SIBLING[x.name], others = set.filter((q) => q.name !== x.name).map((q) => [q.name, dist(F(x.name), q.f), why(F(x.name), q.f)]).sort((a, b) => a[1] - b[1]);
  const line = x.name.padEnd(17) + "vs " + sib + " " + dist(F(x.name), F(sib)).toFixed(2) + " (" + why(F(x.name), F(sib)) + ");  nearest " + others[0][0] + " " + others[0][1].toFixed(2) + " (" + others[0][2] + ")";
  sepLines.push(line); console.log("  " + line);
}
const pairs = []; for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) pairs.push([set[i].name, set[j].name, dist(set[i].f, set[j].f), why(set[i].f, set[j].f)]);
pairs.sort((a, b) => a[2] - b[2]);
console.log("  closest pairs as the section would ship:"); pairs.slice(0, 8).forEach(([a, b, d, w]) => console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")"));
if (arg === "sep") process.exit(0);

// ---- JSON, the listen-through and KEY.md
const json = {}; for (const x of rows) json[x.name] = Object.assign({}, x.p, { _vary: VARY });
writeFileSync(join(jsonDir, "guns-redo.json"), JSON.stringify(json, null, 1) + "\n");
const gap = Math.round(0.4 * SR); let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = []; let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Guns redo, all new");
const lv = rows.map((x) => "  " + x.name.padEnd(17) + "now " + x.now.lufs.toFixed(1) + "  new " + x.m.lufs.toFixed(1) + " LUFS  (" + (x.m.lufs - x.now.lufs).toFixed(1) + " dB)");
writeFileSync(join(wavDir, "KEY.md"), "# Guns redo: the twelve impact-engine guns on the gun engine\n\n" +
  "`all-new.wav` plays the " + rows.length + " redesigns in section order, 0.4 s apart. For each sound, `<slug>-1-now.wav` is today's preset as the\n" +
  "app plays it and `<slug>-2-new.wav` is the redesign. All are rendered with Normalize on and NOT loudness-matched, so each is what its button plays.\n\n" +
  "**The new ones are 3-10 dB QUIETER than today's (most 7-10).** They sit where the eight base guns now sit (-18.5 to -14.5 LUFS, beside the blast\n" +
  "guns' -18.5), while today's impact presets play at -8.2 to -14.5 (most of them -9 to -12). Turn the new ones up in your head, or the louder one will sound better.\n\n" +
  "AJ's pattern from the eight picks is followed: crunchy / arcade for handguns and suppressed guns, hyper-real for long guns, and the middle\n" +
  "point for automatic fire. No take has an after-sound: Casings are 0 and the pump / bolt actions are silent. Each design is a different\n" +
  "GUN from its numbered sibling and its neighbors; the separation lines below measure that.\n\n```\n" + key.join("\n") + "\n```\n\n## What each one is\n\n" +
  rows.map((x) => "- **" + x.name + "** (`" + slug(x.name) + "`): " + x.idea + "\n  Measured: " + fmt(x.m) + "; Peak control " + x.p.gunPeak + ", gain " + x.p.gain + ".").join("\n") +
  "\n\n## Loudness, before and after (BS.1770)\n\n```\n" + lv.join("\n") + "\n```\n\n## Separation (feature distance; 1 = a clearly audible step)\n\n```\n" + sepLines.join("\n") + "\n\nclosest pairs as the section would ship:\n" +
  pairs.slice(0, 8).map(([a, b, d, w]) => "  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + w + ")").join("\n") + "\n```\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, guns-redo.json");
