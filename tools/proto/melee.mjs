/* melee.mjs — PROTOTYPE of a "melee" synthesis engine for CrunchySFX (swords, axes, hammers, fists, whips: a weapon
 * swung, landing in something), and the CLI that renders its blind listening round.
 *
 *   node tools/proto/melee.mjs                 render every round into soundtests/proto-melee/<sound>/
 *   node tools/proto/melee.mjs sword-clash     one round
 *   node tools/proto/melee.mjs --cost          only the CPU cost: each melee take rendered 5x, ms per second of audio
 *
 * WHY. Hits / Melee is "pretty weak and almost everything sounds the same" (AJ). Measured: of its 52 presets, 32 are the
 * whoosh engine alone (wave 20), so every Chop, Slice, Cleave and Thrust is air moving and no blade ever LANDS in
 * anything; the rest are the impact engine (one filtered noise hit and a boom) or the modal bank (one resonator set).
 * A melee hit is two or three events: the SWING, the CONTACT into a material, the BODY's weight; and for a clash, two
 * pieces of steel ringing and sliding along each other. This engine builds those, in that order, on purpose; a miss
 * (a "whiff", target "air") is the swing alone, which is what today's whoosh presets are by accident.
 *
 * THE LAYERS (one blow):
 *   SWING    air past the weapon. The weapon is K = 6 stations along its length; station r moves at v = omega(t) r, and
 *            sheds vortices at the Strouhal frequency f = 0.2 v / d (d = the edge or head the air sees: a katana's 3.5 mm
 *            edge whistles at ~1.9 kHz at the tip, a hammer's 7 cm head "whumphs" broad and low). Each station is
 *            noise through a band-pass at its f, amplitude ~ v^2.5 (the tip dominates); a thin edge is a narrow band
 *            (a katana's groove is the tonal "whistle", Q ~13), a broad head a wide one (Q ~0.6). omega rises and falls
 *            over the arc (peak ~0.62 of the swing), a Doppler tilt raises the pitch on the approach, the pan sweeps
 *            across. The swing joins AFTER the compressor (as the gun's mechanism does), its loudest 5 ms set
 *            24 dB under the hit's at Swing 0 up to 6 dB at Swing 1 (6 dB closer when exaggerated): a compressor before
 *            it lifted the air to nearly the hit's level. AT CONTACT the swing STOPS (a hammer on plate, a blade on stone or steel) or FOLLOWS THROUGH,
 *            slowing (a blade through flesh), per target. A thrust (spear, a dagger's point) is a short "fff" push;
 *            a fist is a short huff with a sleeve's rustle. A WHIP is its own physics: a long thong whoosh, then the tip
 *            passes the speed of sound: a 0.3 ms N-wave (the crack), box-integrated, and a tear of air behind it.
 *   CONTACT  the TARGET (flesh, cloth / leather, mail, plate, a wooden shield, stone, ground, a steel blade) times the HIT
 *            (EDGE: a cut, BLUNT: a thud, POINT: a stab). Each pair is a recipe of components set to target ENERGIES
 *            (as glass.mjs levels its components), so "Contact" is a level and the recipe is the texture:
 *              flesh    edge  the edge's entry "shk", fibers tearing (a crackle of grains), a WET squelch (noise through
 *                             a band-pass falling 1.4 kHz -> 350 Hz, its level wobbling), a few bubbles (damped sines
 *                             whose pitch RISES, as a bubble's does), bone cracking under a heavy blow
 *                       blunt the force pulse (a 4-12 ms "thup") and the skin's SLAP (2-7 kHz, ~5 ms); bone, heavy
 *                       point a tick, the skin's pop, the PUSH (a lower, longer squelch) and the blade's flat sliding in
 *              cloth / leather: the hide's knock and a dry RIP (dense crackle), then the flesh under it, 60 % through
 *              mail     the links: dozens of tiny rings (2.5-9 kHz, two modes each, 4-25 ms), links snapping, the
 *                       flesh under it at 35 %; the blade rings a little
 *              plate    a CLANG: a shell's modes (420 Hz up, as degenerate PAIRS split 3-9 Hz, so it beats), excited
 *                       through the contact's spectrum W(f) = 1 / sqrt(1 + (1.6 f tau)^4) (an edge's 0.12 ms contact
 *                       is bright, a hammer's 0.5 ms a dull "bong"); an edge or a point SKIDS (a scrape on the plate's
 *                       modes); a hammer dents it (a few low clicks)
 *              wooden shield: a plank disc's modes (135 Hz up: a "boom-thock"), the fibers splitting under an edge,
 *                       the iron rim / boss ringing with Ring
 *              stone    a very hard knock, a few dead modes, chips (edge) or a crumble (blunt); the weapon rings
 *              ground   a low thump through a low-pass, and dirt (grains, 0.18 s), an edge biting into soil
 *              steel blade (a CLASH): both blades ring. A blade is a free-free beam: modes at f1 ((2k+1) / 3)^2 kept in
 *                       its band (sword ~0.9-8 kHz, katana 1.2-9, dagger 2.5-11), each one weighted by where along the
 *                       blade the contact is (|sin((2k+1) pi x / 2)|), each a beating PAIR (0.4-3.4 Hz apart), steel's
 *                       loss (eta 3e-4: T60 = 2.2 / (eta f)) plus the hands' damping (Ring: tau 0.04 -> 0.54 s). The other
 *                       blade is the same kind, detuned and struck elsewhere. Then the SCRAPE: the edges sliding along
 *                       each other, noise through narrow band-passes at both blades' modes whose weights follow the
 *                       moving contact point (the "shiing" sweeps), with the friction hiss on top.
 *            Every hard target also rings the WEAPON itself (a hammer's head, an axe's bit, the blade), by how hard it
 *            is (stone 0.9, plate 0.6, mail 0.35, flesh 0.02).
 *   BODY     the weight: a sine whose pitch DROPS (a kick's sweep: 210 -> 95 Hz over 30 ms for a light blow, 90 -> 40 Hz
 *            over 100 ms for the heaviest), scaled by how much the target gives (flesh and ground 1, plate 0.5, a
 *            blade 0.35) and the hit (edge 0.65, point 0.5; a blunt blow carries 60 % of the rest through armor).
 *   SNAP     the designed transient on the contact: a hard-clipped 80 us step and a noise spit (the gun's snap), so the
 *            hit lands instantly.
 *   EXAGGERATE (the fighting-game / anime end): the swing louder and swelling right into the hit, the body longer and
 *            deeper with a sub boom under it, and a bright saturated CRACK (band-passed noise through tanh at 2.8 kHz,
 *            ~12 ms) on the contact.
 * THE CRUNCH STAGE (the gun's, after the layers): the high group (swing, contact, snap) and the ring group (rings,
 *   scrapes) and the body each saturated (asymmetric tanh, 4x oversampled, each back to its own energy, the body and
 *   the rings gentler so a clang does not turn into a buzz); a compressor (2.5 ms attack, its detector high-passed at 150 Hz:
 *   the contact drives it and gets through, the body rides under it and comes up behind); the place (dry, room, stone hall, outdoors, cave: an impulse response from geometry, as
 *   the gun's); a final soft clip whose hardness follows Crunch; optional bits and a sample-and-hold rate cut. The end is
 *   TRIMMED where the sound falls 60 dB under its peak: no after-sound is layered on (AJ's rule from the guns).
 *
 * PORTABLE SHAPE. `makeMelee(sr, cfg, seed)` is a pure factory like dsp.js makeGun: no DOM, no Math.random (own seeded
 * LCGs, one per component, so a level knob never reshuffles anything), SR in, buffered; returns { L, R, n, info,
 * tick(drive, out) }. `meleeCfg(st)` maps the proposed rows (MELEE_PARAMS) to physics; `meleeLevel(L, R)` levels a buffer
 * (RMS 0.12 over its loudest 300 ms, peak capped 0.9). `mlFFT` is dsp.js's fftInPlace verbatim (the port calls that).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

export const MELEE_WEAPONS = ["fist", "dagger", "sword", "katana", "axe", "hammer / mace", "spear", "whip", "staff", "kick", "flail", "rapier"];  // append-only
export const MELEE_TARGETS = ["air (a miss)", "flesh", "cloth / leather", "mail", "plate armor", "wooden shield", "stone", "ground", "steel blade"];  // append-only
export const MELEE_HITS = ["auto", "edge", "blunt", "point"];                                                         // append-only
export const MELEE_PLACES = ["dry", "room", "stone hall", "outdoors", "cave"];                                         // append-only
// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Defaults: a sword cutting
// flesh, dry, lightly crunched.
export const MELEE_PARAMS = [
  ["meleeWeapon",  "Weapon",       0, 11,   1,    2,   "", "Melee", "enum", MELEE_WEAPONS],
  ["meleeTarget",  "Target",       0, 8,   1,    1,   "", "Melee", "enum", MELEE_TARGETS],
  ["meleeHit",     "Hit",          0, 3,   1,    0,   "", "Melee", "enum", MELEE_HITS],   // auto = the weapon's own
  ["meleeWeight",  "Weight",       0, 1,   0.01, 0.5, "", "Melee"],   // a light flick .. the heaviest blow
  ["meleeSpeed",   "Speed",        0, 1,   0.01, 0.5, "", "Melee"],   // the swing's speed (its pitch, and the time to contact)
  ["meleeSwing",   "Swing",        0, 1,   0.01, 0.5, "", "Melee"],   // the air before the hit (0 = the hit alone)
  ["meleeContact", "Contact",      0, 1,   0.01, 0.8, "", "Melee"],   // the material's own sound
  ["meleeBody",    "Body",         0, 1,   0.01, 0.6, "", "Melee"],   // the low punch
  ["meleeRing",    "Ring",         0, 1,   0.01, 0.4, "", "Melee"],   // how long steel rings (and how much the weapon rings)
  ["meleeScrape",  "Scrape",       0, 1,   0.01, 0.3, "", "Melee"],   // edges sliding (a clash, a glance off plate)
  ["meleeSnap",    "Snap",         0, 1,   0.01, 0.4, "", "Melee"],   // the clipped click on the contact
  ["meleeHype",    "Exaggerate",   0, 1,   0.01, 0,   "", "Melee"],   // 0 physical .. 1 fighting-game
  ["meleeThump",   "Thump",        0, 1,   0.01, 0,   "", "Melee"],   // the DESIGNED weight: a sub + a mid whump, never reduced by the target
  ["meleeBone",    "Bone crunch",  0, 1,   0.01, 0,   "", "Melee"],   // a short, dry crackle (celery snapping)
  ["meleeSpins",   "Spins",        1, 4,   1,    1,   "", "Melee"],   // whirling: revolutions before the one that lands
  ["meleePeak",    "Peak control", 0, 1.2, 0.05, 0,   "", "Melee"],   // the app's limiter on the melee alone (the gun's gunPeak)
  ["meleeCrunch",  "Crunch",       0, 1,   0.01, 0.3, "", "Melee"],
  ["meleeComp",    "Compression",  0, 1,   0.01, 0.5, "", "Melee"],
  ["meleeBits",    "Bits",         0, 1,   0.01, 0,   "", "Melee"],   // 0 clean .. 1 = 4-bit
  ["meleeRateCut", "Rate cut",     0, 1,   0.01, 0,   "", "Melee"],   // 0 full rate .. 1 = sample-and-hold x8
  ["meleePlace",   "Place",        0, 4,   1,    0,   "", "Melee", "enum", MELEE_PLACES],
  ["meleeTail",    "Tail",         0, 1,   0.01, 0.3, "", "Melee"],
  ["meleeSeed",    "Variation seed", 0, 999, 1,  0,   "", "Melee"],
];
export const MELEE_DEFAULTS = Object.fromEntries(MELEE_PARAMS.map((p) => [p[0], p[5]]));

// THE WEAPONS. len (m), d = the width the air sees (m), broad 0 a thin edge .. 1 a club, v = tip speed (m/s) at Speed 0.5,
// Ts = the swing's length (s) at Speed 0.5, hit = the default, strike = contact-time multiplier (soft fist, wooden staff),
// whistle = a tonal edge whistle, blade = beam modes { f1, lo, hi, n } or head = fixed modes { fs, tau }.
const ML_WEAPONS = [
  { len: 0.65, d: 0.09,   broad: 1,    v: 10, Ts: 0.11, hit: "blunt", strike: 3,   whistle: 0,   huff: 1 },
  { len: 0.30, d: 0.004,  broad: 0.15, v: 13, Ts: 0.12, hit: "point", strike: 0.8, whistle: 0.3, blade: { f1: 120, lo: 2500, hi: 11000, n: 8 } },
  { len: 0.90, d: 0.005,  broad: 0.3,  v: 28, Ts: 0.22, hit: "edge",  strike: 1,   whistle: 0.45, blade: { f1: 42, lo: 900, hi: 8000, n: 12 } },
  { len: 0.95, d: 0.0035, broad: 0.12, v: 33, Ts: 0.19, hit: "edge",  strike: 0.9, whistle: 1,   blade: { f1: 38, lo: 1200, hi: 9000, n: 12 } },
  { len: 0.80, d: 0.03,   broad: 0.65, v: 22, Ts: 0.28, hit: "edge",  strike: 1.3, whistle: 0.1, head: { fs: [1450, 2630, 3870, 5200], tau: 0.07 } },
  { len: 0.85, d: 0.07,   broad: 1,    v: 17, Ts: 0.32, hit: "blunt", strike: 1.6, whistle: 0,   head: { fs: [1850, 2950, 4300, 6100], tau: 0.05 } },
  { len: 2.00, d: 0.025,  broad: 0.45, v: 11, Ts: 0.16, hit: "point", strike: 1.2, whistle: 0.2, thrust: 1, head: { fs: [2400, 4100, 6050], tau: 0.05 } },
  { len: 2.60, d: 0.006,  broad: 0.25, v: 20, Ts: 0.32, hit: "edge",  strike: 1,   whistle: 0.2, crack: 1 },
  { len: 1.80, d: 0.032,  broad: 0.75, v: 20, Ts: 0.26, hit: "blunt", strike: 1.8, whistle: 0,   head: { fs: [260, 710, 1380, 2250], tau: 0.035 } },
  { len: 0.95, d: 0.12,   broad: 1,    v: 12, Ts: 0.16, hit: "blunt", strike: 3.5, whistle: 0,   huff: 1, mass: 1.4 },   // a kick: a leg, heavier and slower than a fist
  { len: 1.10, d: 0.08,   broad: 1,    v: 20, Ts: 0.30, hit: "blunt", strike: 1.4, whistle: 0,   chain: 1, head: { fs: [1650, 2700, 3900], tau: 0.04 } },   // a flail: a ball on a chain, the links rattling
  { len: 1.00, d: 0.003,  broad: 0.08, v: 26, Ts: 0.13, hit: "point", strike: 0.7, whistle: 0.7, thrust: 1, blade: { f1: 60, lo: 1800, hi: 11000, n: 10 } },   // a rapier: long, thin, thrust
];
// THE TARGETS. tau = contact time for a steel striker (s), give = the body's share (how much the target lets the blow
// through as weight), stop = how much it stops the swing (0 a blade through flesh .. 1 steel on steel), wring = how hard
// it rings the weapon, under = how much of a blow reaches the flesh under it
const ML_TARGETS = [
  null,
  { tau: 0.004,   give: 1,    stop: 0.1,  wring: 0.02, under: 0 },      // flesh
  { tau: 0.002,   give: 0.9,  stop: 0.35, wring: 0.06, under: 0.6 },    // cloth / leather
  { tau: 0.0004,  give: 0.8,  stop: 0.7,  wring: 0.35, under: 0.35 },   // mail
  { tau: 0.00012, give: 0.5,  stop: 1,    wring: 0.6,  under: 0.06 },   // plate
  { tau: 0.0006,  give: 0.7,  stop: 0.85, wring: 0.15, under: 0 },      // wooden shield
  { tau: 0.00008, give: 0.55, stop: 1,    wring: 0.9,  under: 0 },      // stone
  { tau: 0.003,   give: 1,    stop: 0.9,  wring: 0.1,  under: 0 },      // ground
  { tau: 0.00008, give: 0.35, stop: 1,    wring: 1,    under: 0 },      // steel blade (a clash)
];
const ML_PRE = 0.01;
const mlClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function mlRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const mlGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;
const mlPan = (p) => { const a = (mlClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]; };
const mlSeed = (seed, k, salt) => (Math.imul((seed + 1) >>> 0, 2654435761) ^ Math.imul(k + 7, 40503) ^ Math.imul(salt + 13, 9973)) >>> 0;
const mlW = (f, tau) => 1 / Math.sqrt(1 + Math.pow(1.6 * f * tau, 4));   // a contact of length tau reaches f this well

// knobs -> physics
export function meleeCfg(st) {
  const g = (k) => (st[k] == null ? MELEE_DEFAULTS[k] : st[k]);
  const wi = mlClamp(Math.round(g("meleeWeapon")), 0, ML_WEAPONS.length - 1), W = ML_WEAPONS[wi];
  const ti = mlClamp(Math.round(g("meleeTarget")), 0, ML_TARGETS.length - 1);
  const hi = mlClamp(Math.round(g("meleeHit")), 0, 3), hit = hi === 0 ? W.hit : MELEE_HITS[hi];
  const sp = mlClamp(g("meleeSpeed"), 0, 1), hype = mlClamp(g("meleeHype"), 0, 1);
  const Ts = W.Ts * (1.45 - 0.9 * sp) * (1 + 0.25 * hype), v = W.v * (0.6 + 0.8 * sp);
  const sw = g("meleeSwing"), whiff = ti === 0;
  // the contact lands just after the swing's loudest point (a thrust at full extension)
  const land = W.crack ? 1 : W.thrust ? 0.86 : 0.72;
  // SPINS: the earlier revolutions come first, each a little longer than the last (the whirl accelerates into the blow),
  // overlapping by a fifth; the final arc is the one that lands
  const spins = mlClamp(Math.round(g("meleeSpins")), 1, 4), arcs = [];
  let ta = ML_PRE;
  for (let k = 0; k < spins - 1; k++) { const Ta = Ts * (1 + 0.12 * (spins - 1 - k)); arcs.push({ t0: ta, Ts: Ta, g: 0.55 + 0.3 * k / Math.max(1, spins - 1) }); ta += Ta * 0.8; }
  const tS = ML_PRE, tLast = ta, tc = whiff ? -1 : sw > 0 || W.crack ? tLast + Ts * land : ML_PRE;
  return {
    "dur": st.duration || 0, "width": st.width == null ? 0.6 : st.width,
    "wi": wi, "W": W, "ti": ti, "T": ML_TARGETS[ti], "hit": hit, "whiff": whiff,
    "weight": mlClamp(g("meleeWeight"), 0, 1), "speed": sp, "swing": sw, "contact": g("meleeContact"), "body": g("meleeBody"),
    "ring": mlClamp(g("meleeRing"), 0, 1), "scrape": g("meleeScrape"), "snap": g("meleeSnap"), "hype": hype,
    "crunch": g("meleeCrunch"), "comp": g("meleeComp"), "bits": g("meleeBits"), "rateCut": g("meleeRateCut"),
    "place": mlClamp(Math.round(g("meleePlace")), 0, MELEE_PLACES.length - 1), "tail": g("meleeTail"),
    "thump": mlClamp(g("meleeThump"), 0, 1), "bone": mlClamp(g("meleeBone"), 0, 1), "detHP": st.__detHP || 150, "thumpPost": st.__thumpPost == null ? 1 : st.__thumpPost,
    "Ts": Ts, "v": v, "land": land, "tS": tS, "tc": tc, "tLast": tLast, "arcs": arcs, "spins": spins, "peak": mlClamp(g("meleePeak"), 0, 2),
  };
}

// ---- small DSP pieces
function mlAddCont(buf, sr, t0, len, f, gain) {   // a continuous waveform, box-integrated at 16 sub-samples
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
function mlSvf() { return { a: 0, b: 0 }; }
function mlSvfTick(f, x, g, k, out) {   // TPT state-variable filter: out = [lp, bp (unity peak), hp]
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.b, v1 = a1 * f.a + a2 * v3, v2 = f.b + a2 * f.a + a3 * v3;
  f.a = 2 * v1 - f.a; f.b = 2 * v2 - f.b; out[0] = v2; out[1] = k * v1; out[2] = x - k * v1 - v2;
}
const mlG = (fc, sr) => Math.tan(Math.PI * mlClamp(fc, 5, sr * 0.45) / sr);
const mlBuf = (n) => ({ L: new Float64Array(n), R: new Float64Array(n) });
function mlPut(o, i, v, pg) { if (i >= 0 && i < o.L.length) { o.L[i] += v * pg[0]; o.R[i] += v * pg[1]; } }
// damped modes as beating PAIRS (two partials f -+ split/2, 0.55 / 0.45, the two placed a little apart)
function mlRing(o, sr, t0, fs, amps, taus, splits, gain, pan, spread, attack) {
  const n = o.L.length, i0 = Math.max(0, Math.round(t0 * sr)), at = Math.max(1, Math.round((attack || 0.00005) * sr));
  for (let m = 0; m < fs.length; m++) {
    const parts = splits && splits[m] > 0 ? [[fs[m] - splits[m] / 2, 0.55, -1], [fs[m] + splits[m] / 2, 0.45, 1]] : [[fs[m], 1, 0]];
    for (const [f, share, side] of parts) {
      if (!(f > 0) || f >= 0.45 * sr) continue;
      const pg = mlPan(pan + side * spread), a = amps[m] * share * gain, r = Math.exp(-1 / (taus[m] * sr)), w = 2 * Math.PI * f / sr;
      const len = Math.min(n - i0, Math.ceil(7 * taus[m] * sr));
      // s_j = a r^j sin(w j), by a rotating phasor (renormalized every 1024 samples)
      const cr = Math.cos(w), sr2 = Math.sin(w);
      let re = 1, im = 0, e = a;
      for (let j = 0; j < len; j++) {
        const v = e * im * (j < at ? j / at : 1);
        o.L[i0 + j] += v * pg[0]; o.R[i0 + j] += v * pg[1];
        const nr = re * cr - im * sr2; im = re * sr2 + im * cr; re = nr; e *= r;
        if ((j & 1023) === 1023) { const q = 1 / Math.hypot(re, im); re *= q; im *= q; }
      }
    }
  }
}
// noise burst: through an SVF (mode 0 lp, 1 bp, 2 hp) at fc (or a sweep fc(t)), exponential decay tau, attack att s
function mlBurst(o, sr, t0, tau, fc, k, mode, gain, pan, rnd, att, fcEnd) {
  const n = o.L.length, i0 = Math.round(t0 * sr), len = Math.min(n - i0, Math.ceil(7 * tau * sr)), pg = mlPan(pan);
  const f = mlSvf(), out = [0, 0, 0], dk = Math.exp(-1 / (tau * sr)), a = Math.max(1, Math.round((att || 0) * sr));
  let e = gain, g = mlG(fc, sr);
  for (let j = 0; j < len; j++) {
    if (fcEnd && (j & 15) === 0) g = mlG(fc * Math.pow(fcEnd / fc, Math.min(1, j / (3 * tau * sr))), sr);
    mlSvfTick(f, rnd() * 2 - 1, g, k, out);
    mlPut(o, i0 + j, out[mode] * e * (j < a ? j / a : 1), pg); e *= dk;
  }
}
// a train of grains (fibers tearing, chips, dirt): count grains, density falling over span (most land early), each
// noise through a band-pass at a log-uniform fc in [fLo, fHi], length ~gLen, a 1-sample attack (a crackle)
function mlGrains(o, sr, t0, span, count, fLo, fHi, gLen, gain, rnd, pan, spread, k) {
  for (let q = 0; q < count; q++) {
    const u = -Math.log(1 - rnd() * (1 - Math.exp(-3))) / 3, t = t0 + span * u;
    const fc = fLo * Math.pow(fHi / fLo, rnd()), len = gLen * (0.5 + rnd()), a = gain * Math.exp(0.7 * mlGauss(rnd)) * (1 - 0.6 * u);
    mlBurst(o, sr, t, len, fc, k || 1.2, 1, a, pan + spread * (rnd() * 2 - 1), rnd, 0);
  }
}
// tiny metal rings (mail links): each two damped sines and a tick
function mlTinkles(o, sr, t0, span, count, fLo, fHi, gain, rnd, pan, spread) {
  for (let q = 0; q < count; q++) {
    const u = -Math.log(1 - rnd() * (1 - Math.exp(-2.5))) / 2.5, t = t0 + span * u, f = fLo * Math.pow(fHi / fLo, rnd());
    const a = gain * Math.exp(0.6 * mlGauss(rnd)) * (1 - 0.5 * u), tau = 0.004 + 0.02 * rnd(), p = pan + spread * (rnd() * 2 - 1);
    mlRing(o, sr, t, [f, f * (1.45 + 0.9 * rnd())], [1, 0.5], [tau, tau * 0.6], null, a, p, 0, 0.00003);
    mlBurst(o, sr, t, 0.0004, Math.min(9000, 1.5 * f), 1.2, 1, a * 0.7, p, rnd, 0);
  }
}
// a raised-cosine force pulse of length tau and a softer rebound (the knock), optionally low-passed
function mlKnock(o, sr, t0, tau, gain, pan, lpHz) {
  const tmp = new Float64Array(o.L.length), pg = mlPan(pan);
  mlAddCont(tmp, sr, t0, tau * 3, (t) => (t < tau ? Math.pow(Math.sin(Math.PI * t / tau), 2) : -0.35 * Math.pow(Math.sin(Math.PI * (t - tau) / (2 * tau)), 2)), gain);
  if (lpHz) { const a = Math.exp(-2 * Math.PI * Math.min(lpHz, 0.45 * sr) / sr); let y = 0, y2 = 0; for (let i = 0; i < tmp.length; i++) { y = tmp[i] * (1 - a) + y * a; y2 = y * (1 - a) + y2 * a; tmp[i] = y2; } }
  for (let i = 0; i < tmp.length; i++) if (tmp[i]) { o.L[i] += tmp[i] * pg[0]; o.R[i] += tmp[i] * pg[1]; }
}
// the WET squelch: noise through a band-pass whose fc falls fA -> fB over dur, Q-ish k, its level wobbling (a smoothed
// random walk at ~40 Hz), a 4 ms rise and a (1 - u)^1.5 fall
function mlSquelch(o, sr, t0, dur, fA, fB, k, gain, pan, rnd) {
  const n = o.L.length, i0 = Math.round(t0 * sr), N = Math.min(n - i0, Math.round(dur * sr)), pg = mlPan(pan);
  const f = mlSvf(), out = [0, 0, 0], aw = Math.exp(-2 * Math.PI * 40 / sr), at = Math.round(0.004 * sr);
  let g = mlG(fA, sr), w = 0, w2 = 0;
  for (let j = 0; j < N; j++) {
    const u = j / N;
    if ((j & 15) === 0) g = mlG(fA * Math.pow(fB / fA, Math.pow(u, 0.6)), sr);
    mlSvfTick(f, rnd() * 2 - 1, g, k, out);
    w = (rnd() * 2 - 1) * (1 - aw) + w * aw; w2 = w * (1 - aw) + w2 * aw;
    const env = (j < at ? j / at : 1) * Math.pow(1 - u, 1.5) * Math.max(0.15, 1 + 9 * w2);
    mlPut(o, i0 + j, out[1] * env * gain, pg);
  }
}
// bubbles: damped sines whose pitch RISES over their life (a bubble's, as it nears the surface)
function mlBubbles(o, sr, t0, span, count, fLo, fHi, gain, rnd, pan) {
  for (let q = 0; q < count; q++) {
    const t = t0 + span * Math.pow(rnd(), 1.3), f0 = fLo * Math.pow(fHi / fLo, rnd()), tau = 0.003 + 0.005 * rnd(), rise = 0.15 + 0.3 * rnd();
    const i0 = Math.round(t * sr), len = Math.min(o.L.length - i0, Math.ceil(6 * tau * sr)), pg = mlPan(pan + 0.4 * (rnd() - 0.5));
    let ph = 0, e = gain * (0.5 + rnd());
    const dk = Math.exp(-1 / (tau * sr));
    for (let j = 0; j < len; j++) { ph += 2 * Math.PI * f0 * (1 + rise * j / (6 * tau * sr)) / sr; mlPut(o, i0 + j, Math.sin(ph) * e, pg); e *= dk; }
  }
}
// a SCRAPE: noise through narrow band-passes at the given modes, each weighted by where the moving contact point is
// (x slides xA -> xB over dur: the "shiing" sweeps), plus the friction hiss (high-passed, stick-slip lumpy)
function mlScrape(o, sr, t0, dur, fs, amps, gain, rnd, pan, xA, xB, hiss) {
  const n = o.L.length, i0 = Math.round(t0 * sr), N = Math.min(n - i0, Math.round(dur * sr)), pg = mlPan(pan);
  const M = fs.filter((f) => f < 0.45 * sr).length, F = [], out = [0, 0, 0], fh = mlSvf(), gh = mlG(4200, sr);
  for (let m = 0; m < M; m++) F.push(mlSvf());
  const rise = Math.max(1, Math.round(0.006 * sr));
  let stick = 0;
  for (let j = 0; j < N; j++) {
    const u = j / N, x = xA + (xB - xA) * u, env = (j < rise ? j / rise : 1) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.5 + 0.5 * u)), 0.7);
    if (rnd() < 0.004) stick = 1;   // stick-slip: lumps in the friction
    stick *= 0.995;
    const ex = (rnd() * 2 - 1) * (1 + 2.5 * stick);
    let s = 0;
    for (let m = 0; m < M; m++) {
      mlSvfTick(F[m], ex, mlG(fs[m], sr), 0.03, out);
      s += out[1] * amps[m] * (0.15 + 0.85 * Math.abs(Math.sin(Math.PI * (2 * m + 3) * x * 0.5)));
    }
    mlSvfTick(fh, ex, gh, 1.0, out);
    mlPut(o, i0 + j, (s * 3 + out[2] * hiss) * env * gain, pg);
  }
}
// a blade's ring: free-free beam modes f1 ((2k+1)/3)^2 in [lo, hi], weighted by the contact point x, through the
// contact's spectrum; steel's loss + the hands' damping; beating pairs
function mlBladeModes(B, x, tauC, ring, rnd, detune) {
  const fs = [], amps = [], taus = [], splits = [];
  for (let k = 1; k < 80; k++) {
    const f = B.f1 * detune * Math.pow((2 * k + 1) / 3, 2) * (1 + 0.012 * mlGauss(rnd));
    if (f < B.lo) continue; if (f > B.hi) break;
    fs.push(f);
    amps.push((0.2 + 0.8 * Math.abs(Math.sin((2 * k + 1) * Math.PI * x / 2))) * mlW(f, tauC) * Math.pow(f / B.lo, -0.25));
    const tInt = 2.2 / (3e-4 * f) / 6.91, tHold = 0.04 + 0.5 * Math.pow(ring, 1.5);
    taus.push(1 / (1 / tInt + 1 / tHold) * (0.7 + 0.6 * rnd()));
    splits.push(0.4 + 3 * rnd());
  }
  // keep at most n, spread across the band
  if (fs.length > B.n) { const step = fs.length / B.n, idx = []; for (let q = 0; q < B.n; q++) idx.push(Math.floor(q * step)); return { fs: idx.map((i) => fs[i]), amps: idx.map((i) => amps[i]), taus: idx.map((i) => taus[i]), splits: idx.map((i) => splits[i]) }; }
  return { fs, amps, taus, splits };
}
function mlHeadModes(H, tauC, ring, rnd) {
  return { fs: H.fs.map((f) => f * (1 + 0.02 * mlGauss(rnd))), amps: H.fs.map((f, i) => (1 - 0.15 * i) * mlW(f, tauC)),
    taus: H.fs.map((f, i) => H.tau * (0.5 + 1.2 * ring) * (1 - 0.12 * i)), splits: H.fs.map(() => 0.5 + 2 * rnd()) };
}
// a target's own modes: [ratios, base f, base taus], pairs split by the given range
const ML_PLATE = { r: [1, 1.53, 2.17, 2.62, 3.31, 3.98, 4.71, 5.62, 6.67], f: 420, t: [0.32, 0.28, 0.25, 0.22, 0.19, 0.16, 0.14, 0.12, 0.1], split: [3, 9] };
const ML_WOOD = { r: [1, 1.59, 2.14, 2.65, 3.16, 3.65, 4.6, 6.1, 8.3], f: 135, t: [0.09, 0.075, 0.06, 0.05, 0.045, 0.04, 0.03, 0.025, 0.02], split: [0.5, 2] };
const ML_RIM = { r: [1, 1.64, 2.32, 3.04], f: 1250, t: [0.18, 0.14, 0.11, 0.08], split: [1, 4] };
const ML_STONE = { r: [1, 1.65, 2.56, 3.42, 4.71, 6.35], f: 520, t: [0.022, 0.018, 0.014, 0.012, 0.01, 0.008], split: [0, 0] };
function mlTargetModes(S, tauC, tMul, rnd, fMul) {
  return { fs: S.r.map((r) => S.f * (fMul || 1) * r * (1 + 0.015 * mlGauss(rnd))), amps: S.r.map((r, i) => (1 - 0.06 * i) * mlW(S.f * r, tauC)),
    taus: S.t.map((t) => t * tMul * (0.85 + 0.3 * rnd())), splits: S.r.map(() => S.split[0] + (S.split[1] - S.split[0]) * rnd()) };
}

// ---- THE RECIPES: target x hit -> components { bus, E (energy share of the contact), tag, render(o) }
function mlRecipe(c, seed) {
  const out = [], tc = c.tc, sr = c.sr, w = c.weight, W = c.W, T = c.T, hit = c.hit, ti = c.ti;
  let salt = 100;
  const add = (bus, E, tag, fn) => { if (E > 0) { const rnd = mlRng(mlSeed(seed, 0, salt++)); out.push({ bus, E, tag, render: (o) => fn(o, rnd) }); } else salt++; };
  const tauB = T.tau * W.strike * (0.7 + 0.6 * w);                   // a blunt contact
  const tauE = Math.min(tauB, 0.00035 * W.strike);                   // an edge's first instant
  const tauP = Math.min(tauB, 0.0002 * W.strike);                    // a point's
  const P = 0.1;                                                     // the contact's pan
  const flesh = (k, h, t0) => {                                      // the flesh recipe (also what lies under armor)
    if (h === "edge") {
      add("ct", 0.12 * k, "flesh: the edge's entry", (o, r) => mlBurst(o, sr, t0, 0.003, 5200, 0.9, 1, 1, P, r, 0.0002));
      add("ct", 0.28 * k, "flesh: fibers tearing", (o, r) => mlGrains(o, sr, t0 + 0.002, 0.06 + 0.04 * w, 26 + Math.round(20 * w), 1200, 5000, 0.0007, 1, r, P, 0.25));
      add("ct", 0.42 * k, "flesh: the wet squelch", (o, r) => mlSquelch(o, sr, t0 + 0.003, 0.08 + 0.06 * w, 1400, 350, 0.6, 1, P, r));
      add("ct", 0.06 * k, "flesh: bubbles", (o, r) => mlBubbles(o, sr, t0 + 0.01, 0.08, 5, 500, 1600, 1, r, P));
      add("ct", 0.18 * k, "flesh: the cut's knock", (o, r) => mlKnock(o, sr, t0, 0.0012 + 0.002 * w, 1, P, 2500));
    } else if (h === "blunt") {
      add("ct", 0.6 * k, "flesh: the force pulse (thup)", (o, r) => mlKnock(o, sr, t0, Math.max(0.003, tauB), 1, P, 900));
      add("ct", 0.32 * k, "flesh: the skin's slap", (o, r) => mlBurst(o, sr, t0 + 0.0005, 0.005, 3800, 0.75, 1, 1, P, r, 0.0003));
      add("ct", 0.08 * k, "flesh: cloth flap", (o, r) => mlGrains(o, sr, t0, 0.03, 10, 1500, 6000, 0.0008, 1, r, P, 0.3));
    } else {
      add("ct", 0.08 * k, "flesh: the point's tick", (o, r) => mlBurst(o, sr, t0, 0.0006, 6500, 1.0, 1, 1, P, r, 0));
      add("ct", 0.12 * k, "flesh: the skin's pop", (o, r) => mlRing(o, sr, t0 + 0.0008, [1600, 2700], [1, 0.4], [0.006, 0.003], null, 1, P, 0, 0.0004));
      add("ct", 0.45 * k, "flesh: the push (a lower squelch)", (o, r) => mlSquelch(o, sr, t0 + 0.004, 0.11 + 0.06 * w, 900, 240, 0.45, 1, P, r));
      add("ct", 0.12 * k, "flesh: the blade's flat sliding in", (o, r) => mlSquelch(o, sr, t0 + 0.002, 0.1, 4200, 2600, 1.0, 1, P, r));
      add("ct", 0.05 * k, "flesh: bubbles", (o, r) => mlBubbles(o, sr, t0 + 0.02, 0.09, 3, 400, 1200, 1, r, P));
      add("ct", 0.15 * k, "flesh: the knock", (o, r) => mlKnock(o, sr, t0, 0.002 + 0.002 * w, 1, P, 1500));
    }
    if (w > 0.4) add("ct", 0.3 * k * (w - 0.4) / 0.6, "flesh: bone cracking", (o, r) => {
      mlGrains(o, sr, t0 + 0.004, 0.03, 8 + Math.round(10 * w), 350, 2400, 0.0015, 1, r, P, 0.2);
      for (let q = 0; q < 2; q++) mlKnock(o, sr, t0 + 0.006 + 0.012 * r(), 0.00015, 1.5, P, 0);
    });
  };
  const wRing = (E) => {                                             // the WEAPON's own ring
    if (!(E > 0)) return;
    if (W.blade) add("rg", E, "the weapon rings (blade)", (o, r) => { const m = mlBladeModes(W.blade, 0.3, tauE, c.ring, r, 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, -0.15, 0.25); });
    else if (W.head) add("rg", E, "the weapon rings (head)", (o, r) => { const m = mlHeadModes(W.head, tauE, c.ring, r); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, -0.1, 0.15); });
  };
  const ringE = 0.6 * c.ring;
  if (W.chain) add("rg", 0.15, "the flail's chain jangling", (o, r) => mlTinkles(o, sr, tc + 0.002, 0.06, 20, 2000, 6000, 1, r, -0.1, 0.5));
  if (ti === 1) flesh(1, hit, tc);
  else if (ti === 2) {   // cloth / leather
    if (hit === "edge") { add("ct", 0.22, "leather: the hide's knock", (o, r) => mlKnock(o, sr, tc, 0.0018, 1, P, 1800)); add("ct", 0.5, "leather: the rip", (o, r) => mlGrains(o, sr, tc + 0.001, 0.07 + 0.03 * w, 50 + Math.round(30 * w), 900, 6000, 0.0006, 1, r, P, 0.3)); }
    else if (hit === "blunt") { add("ct", 0.5, "leather: the knock", (o, r) => mlKnock(o, sr, tc, Math.max(0.002, tauB), 1, P, 1200)); add("ct", 0.3, "leather: the slap", (o, r) => mlBurst(o, sr, tc + 0.0005, 0.008, 2200, 0.8, 1, 1, P, r, 0.0004)); }
    else { add("ct", 0.1, "leather: the point's tick", (o, r) => mlBurst(o, sr, tc, 0.0006, 6000, 1, 1, 1, P, r, 0)); add("ct", 0.3, "leather: the puncture's pop", (o, r) => mlRing(o, sr, tc + 0.0006, [900, 1700], [1, 0.4], [0.008, 0.004], null, 1, P, 0, 0.0005)); }
    flesh(T.under, hit, tc + 0.006);
    wRing(ringE * T.wring);
  } else if (ti === 3) {   // mail
    const n = hit === "point" ? 14 : 30 + Math.round(25 * w);
    add("ct", hit === "blunt" ? 0.5 : 0.15, "mail: the knock", (o, r) => mlKnock(o, sr, tc, Math.max(0.0004, hit === "blunt" ? tauB * 3 : tauE), 1, P, hit === "blunt" ? 1200 : 0));
    add("ct", hit === "blunt" ? 0.35 : 0.5, "mail: the links (" + n + " tiny rings)", (o, r) => mlTinkles(o, sr, tc + 0.001, 0.05 + 0.04 * w, n, 2500, 9000, 1, r, P, 0.5));
    if (hit !== "blunt") add("ct", 0.14, "mail: links snapping", (o, r) => { for (let q = 0; q < 4; q++) mlKnock(o, sr, tc + 0.002 + 0.02 * r(), 0.00008, 1, P + 0.3 * (r() - 0.5), 0); });
    if (hit === "edge" && c.scrape > 0) add("rg", 0.15 * c.scrape, "mail: the edge dragging over the links", (o, r) => mlGrains(o, sr, tc + 0.01, 0.08, 40, 3000, 9000, 0.0004, 1, r, P, 0.4));
    flesh(hit === "blunt" ? 0.6 : T.under, hit, tc + 0.008);
    wRing(ringE * T.wring);
  } else if (ti === 4) {   // plate
    const tauC = hit === "blunt" ? Math.max(0.0003, tauB * 2) : hit === "edge" ? 0.00012 : 0.0001;
    add("rg", hit === "point" ? 0.4 : 0.6, hit === "blunt" ? "plate: the BONG (a shell's modes, beating pairs, struck dull)" : "plate: the CLANG (a shell's modes, beating pairs)",
      (o, r) => { const m = mlTargetModes(ML_PLATE, tauC, 0.25 + 0.9 * c.ring, r, hit === "blunt" ? 0.85 : 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, P, 0.35); });
    add("ct", hit === "blunt" ? 0.4 : 0.1, "plate: the knock", (o, r) => mlKnock(o, sr, tc, tauC, 1, P, 0));
    if (hit === "blunt") add("ct", 0.1, "plate: the dent (low clicks)", (o, r) => mlGrains(o, sr, tc + 0.002, 0.02, 6, 300, 1500, 0.002, 1, r, P, 0.1));
    if (hit !== "blunt") add("rg", (hit === "point" ? 0.45 : 0.3) * Math.max(0.2, c.scrape), "plate: the " + hit + " skidding off",
      (o, r) => { const m = mlTargetModes(ML_PLATE, 0.0001, 1, r, 1); mlScrape(o, sr, tc + 0.004, (hit === "point" ? 0.09 : 0.05) + 0.12 * c.scrape, m.fs.slice(3), m.amps.slice(3), 1, r, P, 0.2, 0.7, 0.4); });
    flesh(T.under, hit, tc + 0.004);
    wRing(ringE * T.wring);
  } else if (ti === 5) {   // wooden shield
    const tauC = hit === "blunt" ? Math.max(0.0008, tauB * 1.5) : hit === "edge" ? 0.0006 : 0.0004;
    add("ct", hit === "point" ? 0.4 : 0.55, hit === "blunt" ? "shield: the BOOM (a plank disc's modes)" : "shield: the THOCK (a plank disc's modes)",
      (o, r) => { const m = mlTargetModes(ML_WOOD, tauC, 1, r, hit === "point" ? 1.6 : 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, P, 0.2, 0.0003); });
    add("ct", hit === "blunt" ? 0.35 : 0.22, "shield: the knock", (o, r) => mlKnock(o, sr, tc, tauC, 1, P, 3000));
    if (hit !== "blunt") add("ct", hit === "edge" ? 0.25 : 0.1, "shield: fibers splitting", (o, r) => { mlGrains(o, sr, tc + 0.003, 0.03, 12, 900, 4500, 0.0009, 1, r, P, 0.2); for (let q = 0; q < 3; q++) mlKnock(o, sr, tc + 0.004 + 0.02 * r(), 0.0002, 0.8, P, 0); });
    if (hit === "point") add("ct", 0.1, "shield: the shaft quivering", (o, r) => mlRing(o, sr, tc + 0.006, [128, 290], [1, 0.3], [0.08, 0.04], [7, 3], 1, P, 0.1, 0.004));
    add("rg", 0.3 * c.ring, "shield: the iron rim / boss", (o, r) => { const m = mlTargetModes(ML_RIM, tauC * 0.4, 0.4 + 1.2 * c.ring, r); mlRing(o, sr, tc + 0.0005, m.fs, m.amps, m.taus, m.splits, 1, P, 0.2); });
    wRing(ringE * T.wring);
  } else if (ti === 6) {   // stone
    add("ct", 0.35, "stone: the knock (very hard)", (o, r) => mlKnock(o, sr, tc, Math.max(0.00008, hit === "blunt" ? tauB : tauE * 0.5), 1, P, 0));
    add("ct", 0.25, "stone: its dead modes", (o, r) => { const m = mlTargetModes(ML_STONE, 0.0002, 1, r); mlRing(o, sr, tc, m.fs, m.amps, m.taus, null, 1, P, 0); });
    add("ct", hit === "blunt" ? 0.35 : 0.3, hit === "blunt" ? "stone: the crumble" : "stone: chips",
      (o, r) => mlGrains(o, sr, tc + 0.002, hit === "blunt" ? 0.15 : 0.05, hit === "blunt" ? 45 : 22, hit === "blunt" ? 900 : 2000, hit === "blunt" ? 6000 : 9000, 0.0008, 1, r, P, 0.5));
    if (hit === "edge") add("rg", 0.2 * Math.max(0.3, c.scrape), "stone: the edge skidding", (o, r) => mlScrape(o, sr, tc + 0.003, 0.06 + 0.1 * c.scrape, [2300, 3400, 4700, 6100], [1, 0.8, 0.6, 0.5], 1, r, P, 0.2, 0.6, 1.2));
    wRing(ringE * T.wring * 1.2);
  } else if (ti === 7) {   // ground
    add("ct", 0.6, "ground: the thump", (o, r) => mlKnock(o, sr, tc, Math.max(0.003, tauB), 1, P, 350));
    add("ct", 0.4, "ground: dirt", (o, r) => { mlGrains(o, sr, tc + 0.003, 0.18, 45, 700, 4500, 0.001, 1, r, P, 0.6); mlBurst(o, sr, tc + 0.002, 0.04, 1500, 0.9, 0, 0.6, P, r, 0.004); });
    if (hit === "edge") add("ct", 0.15, "ground: the bite into soil", (o, r) => mlSquelch(o, sr, tc + 0.001, 0.05, 2600, 1200, 1.0, 1, P, r));
    wRing(ringE * T.wring);
  } else if (ti === 8) {   // a CLASH, steel on steel
    const B2 = W.blade ? W.blade : ML_WEAPONS[2].blade;   // the other blade: a sword, if the weapon has none
    add("ct", 0.12, "clash: the contact click", (o, r) => mlKnock(o, sr, tc, 0.00008, 1, 0, 0));
    if (W.blade) add("rg", 0.5, "clash: the weapon's blade rings (beam modes, beating pairs)", (o, r) => { const m = mlBladeModes(W.blade, 0.32, 0.00008, c.ring, r, 1); mlRing(o, sr, tc, m.fs, m.amps, m.taus, m.splits, 1, -0.25, 0.3); });
    else wRing(0.5);
    add("rg", 0.45, "clash: the other blade rings (detuned, struck elsewhere)", (o, r) => { const m = mlBladeModes(B2, 0.57, 0.00008, c.ring, r, 0.93 + 0.03 * r()); mlRing(o, sr, tc + 0.0002, m.fs, m.amps, m.taus, m.splits, 1, 0.3, 0.3); });
    if (c.scrape > 0) add("rg", 0.45 * c.scrape, "clash: the edges sliding (the scrape)", (o, r) => {
      const a = mlBladeModes(W.blade || B2, 0.3, 0.0001, 0.5, r, 1), b = mlBladeModes(B2, 0.55, 0.0001, 0.5, r, 0.94);
      const fs = a.fs.concat(b.fs).filter((f) => f > 1400 && f < 8000), am = fs.map(() => 0.6 + 0.4 * r());
      mlScrape(o, sr, tc + 0.006, 0.06 + 0.26 * c.scrape, fs, am, 1, r, 0.05, 0.15, 0.8, 0.5);
    });
  }
  return out;
}

// ---- the SWING into a stereo buffer (and, for a whip, the crack)
function mlSwing(o, sr, c, rnd) {
  for (const a of c.arcs || []) {   // the earlier revolutions of a whirl: whole arcs, nothing hit
    const tmp = mlBuf(o.L.length); mlArc(tmp, sr, Object.assign({}, c, { tLast: a.t0, Ts: a.Ts, whiff: true }), rnd);
    for (let i = 0; i < tmp.L.length; i++) { o.L[i] += tmp.L[i] * a.g; o.R[i] += tmp.R[i] * a.g; }
  }
  const r = mlArc(o, sr, c, rnd);
  if (c.W.chain) mlTinkles(o, sr, c.tS + 0.02, (c.tLast - c.tS) + c.Ts * 0.8, 10 + 6 * (c.arcs || []).length, 2200, 5000, 0.12, rnd, 0, 0.6);   // the chain
  return r;
}
function mlArc(o, sr, c, rnd) {
  const W = c.W, K = 6, t0 = c.tLast, Ts = c.Ts, hype = c.hype, n = o.L.length;
  const i0 = Math.round(t0 * sr), follow = c.whiff ? 1 : 1 - c.T.stop;
  const tEnd = c.whiff ? Ts : (c.tc - t0) + (follow > 0.05 ? 0.12 * follow + 0.04 : 0.003);
  const N = Math.min(n - i0, Math.round(tEnd * sr)), up = 0.62 + 0.13 * hype, iC = Math.round((c.tc - t0) * sr);
  const panA = rnd() < 0.5 ? -0.55 : 0.55, Fs = [], Q = 1.2 + 14 * W.whistle * (1 - W.broad);
  for (let k = 0; k < K; k++) Fs.push(mlSvf());
  const fh = mlSvf(), out = [0, 0, 0], gs = new Float64Array(K), rk = [];
  for (let k = 0; k < K; k++) rk.push(0.35 + 0.65 * k / (K - 1));
  let v = 0, gH = 1;
  for (let j = 0; j < N; j++) {
    const t = j / sr, u = t / Ts;
    // omega(u): a rise to `up` and a fall (a thrust rises fast and stops)
    let wv = u < up ? Math.pow(Math.sin(Math.PI / 2 * u / up), W.thrust ? 0.7 : 1.6) : Math.pow(Math.max(0, Math.cos(Math.PI / 2 * (u - up) / (1 - up))), 1.2);
    let amp = 1;
    if (!c.whiff && j >= iC) {   // the contact: stopped, or following through and slowing
      const dt = (j - iC) / sr;
      amp = follow > 0.05 ? (follow * Math.exp(-dt / (0.035 + 0.04 * follow))) + (1 - follow) * Math.max(0, 1 - dt / 0.003) : Math.max(0, 1 - dt / 0.003);
      wv *= follow > 0.05 ? Math.exp(-dt / 0.08) : 1;
    }
    v = c.v * wv;
    if ((j & 7) === 0) {
      const dop = 1 + 0.12 * (c.v / 30) * (1 + hype) * Math.cos(Math.PI * Math.min(1, u));
      for (let k = 0; k < K; k++) gs[k] = mlG(mlClamp(0.2 * v * rk[k] / W.d * dop, 180, 9000), sr);
      gH = mlG(mlClamp(0.4 * v / W.d * dop, 400, 12000), sr);
    }
    const x = rnd() * 2 - 1;
    let s = 0;
    for (let k = 0; k < K; k++) { mlSvfTick(Fs[k], x * (0.8 + 0.4 * rnd()), gs[k], 1 / Q, out); s += out[1] * Math.pow(rk[k] * wv, 2.5); }
    mlSvfTick(fh, x, gH, 1.0, out);
    s += out[2] * 0.25 * Math.pow(wv, 3) * (1 - W.broad * 0.6);
    const p = panA * (1 - 2 * Math.min(1, u)) * (0.6 + 0.4 * hype);
    mlPut(o, i0 + j, s * amp * (j < 32 ? j / 32 : 1), mlPan(p));
  }
  if (W.huff) mlGrains(o, sr, t0, Ts, 14, 1500, 6000, 0.001, 0.4, rnd, 0, 0.5);   // the sleeve
  return { N, tEnd };
}
function mlWhipCrack(o, sr, t0, gain, rnd) {
  const tmp = new Float64Array(o.L.length), T = 0.0003;
  mlAddCont(tmp, sr, t0, T, (t) => 1 - 2 * t / T, 1);
  for (let i = 0; i < tmp.length; i++) if (tmp[i]) { o.L[i] += tmp[i] * gain; o.R[i] += tmp[i] * gain; }
  mlBurst(o, sr, t0 + 0.0002, 0.0025, 3500, 0.8, 2, gain * 0.25, 0.05, rnd, 0);
  mlRing(o, sr, t0 + 0.0003, [2900, 4700], [1, 0.5], [0.002, 0.0015], null, gain * 0.12, 0, 0, 0.00005);
}

// asymmetric tanh, 4x oversampled, on a peak-normalized STEREO pair, then back to the energy it had over [w0, w1)
function mlSaturate(o, d, bias, w0, w1) {
  const n = o.L.length; let pk = 0, e0 = 0, e1 = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(o.L[i]), Math.abs(o.R[i]));
  if (!(pk > 0)) return;
  for (let i = w0; i < w1; i++) e0 += o.L[i] * o.L[i] + o.R[i] * o.R[i];
  const tb = Math.tanh(d * bias), tn = Math.tanh(d * (1 + bias)) - tb, OS = 4;
  for (const x of [o.L, o.R]) {
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const v0 = x[i] / pk; let acc = 0;
      for (let s = 1; s <= OS; s++) { const v = prev + (v0 - prev) * s / OS; acc += Math.tanh(d * (v + bias)) - tb; }
      prev = v0; x[i] = acc / OS / tn;
    }
  }
  for (let i = w0; i < w1; i++) e1 += o.L[i] * o.L[i] + o.R[i] * o.R[i];
  const g = e1 > 0 ? Math.sqrt(e0 / e1) : 0;
  for (let i = 0; i < n; i++) { o.L[i] *= g; o.R[i] *= g; }
}
function mlEnergy(o, w0, w1, sr) { let e = 0; for (let i = Math.max(0, w0); i < Math.min(o.L.length, w1); i++) e += (o.L[i] * o.L[i] + o.R[i] * o.R[i]) / 2; return e / sr; }

// the place: an impulse response from geometry (stereo), as the gun's
function mlPlaceIR(sr, place, tailMul, rnd) {
  if (place === 0) return null;
  const lenS = [0, 0.9, 2.2, 1.8, 2.2][place] * tailMul, n = Math.max(64, Math.round(lenS * sr));
  const L = new Float64Array(n), R = new Float64Array(n);
  const tap = (t, g, fc, ch) => {
    const i0 = Math.round(t * sr); if (i0 >= n) return;
    const a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr);
    let v = (1 - a) * g;
    for (let j = i0; j < n && Math.abs(v) > 1e-7 * Math.abs(g); j++) { if (ch !== 1) L[j] += v; if (ch !== 0) R[j] += v; v *= a; }
  };
  const tail = (t0, rise, rt60, fcA, fcB, e) => {
    const i0 = Math.round(t0 * sr), dk = Math.exp(-6.9078 / (rt60 * sr)), ri = Math.max(1, Math.round(rise * sr));
    const bl = new Float64Array(n), br = new Float64Array(n);
    let env = 1, yl = 0, yr = 0, ss = 0;
    for (let j = i0; j < n; j++) {
      const u = (j - i0) / (rt60 * sr), fc = fcB + (fcA - fcB) * Math.exp(-3 * u), a = Math.exp(-2 * Math.PI * fc / sr);
      const r = j - i0 < ri ? 0.5 - 0.5 * Math.cos(Math.PI * (j - i0) / ri) : 1;
      yl = (rnd() * 2 - 1) * (1 - a) + yl * a; yr = (rnd() * 2 - 1) * (1 - a) + yr * a;
      bl[j] = yl * env * r; br[j] = yr * env * r; ss += (bl[j] * bl[j] + br[j] * br[j]) / 2; env *= dk;
    }
    const g = Math.sqrt(e / (ss || 1));
    for (let j = i0; j < n; j++) { L[j] += bl[j] * g; R[j] += br[j] * g; }
  };
  if (place === 1) {          // ROOM: image sources in 2-25 ms, a 0.45 s tail
    for (let q = 0; q < 16; q++) tap(0.002 + 0.023 * rnd(), 0.07 + 0.1 * rnd(), 4000 + 6000 * rnd(), q & 1);
    tail(0.005, 0.02, 0.45 * tailMul, 6000, 2000, 0.7);
  } else if (place === 2) {   // STONE HALL: early hits 8-45 ms off stone, a 1.6 s bright-ish tail
    for (let q = 0; q < 14; q++) tap(0.008 + 0.037 * rnd(), 0.08 + 0.1 * rnd(), 5000 + 4000 * rnd(), q & 1);
    tail(0.015, 0.05, 1.6 * tailMul, 5500, 1500, 1.1);
  } else if (place === 3) {   // OUTDOORS: the ground, a treeline at ~0.12 s, a short dark tail
    tap(0.003, 0.4, 7000, 2);
    const s1 = 0.1 + 0.05 * rnd(); for (let q = 0; q < 5; q++) tap(s1 + 0.012 * (rnd() - 0.5), 0.08 * (0.5 + rnd()), 2400, q & 1);
    tail(0.03, 0.12, 1.0 * tailMul, 2500, 500, 0.25);
  } else {                    // CAVE: dense flutter, a long dark tail
    for (let q = 0; q < 24; q++) tap(0.006 + 0.09 * rnd(), 0.06 + 0.08 * rnd(), 2500 + 2500 * rnd(), q & 1);
    tail(0.02, 0.08, 1.9 * tailMul, 3000, 600, 1.0);
  }
  return { L, R };
}
// dsp.js fftInPlace, verbatim (the port calls that instead)
function mlFFT(re, im, sign) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; } }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = sign * 2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + half], bi = im[i + k + half];
        const tr = cr * br - ci * bi, ti = cr * bi + ci * br;
        re[i + k] = ar + tr; im[i + k] = ai + ti; re[i + k + half] = ar - tr; im[i + k + half] = ai - ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
function mlConvolve(x, irL, irR, n) {   // mono x with a stereo IR, first n samples (dsp.js blastConvolve's one-FFT trick)
  let N = 1; while (N < n + irL.length) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x.subarray(0, n)); hr.set(irL); hi.set(irR);
  mlFFT(xr, xi, -1); mlFFT(hr, hi, -1);
  for (let k = 0; k < N; k++) { const a = xr[k], b = xi[k], c = hr[k], e = hi[k]; hr[k] = a * c - b * e; hi[k] = a * e + b * c; }
  mlFFT(hr, hi, 1);
  const L = new Float64Array(n), R = new Float64Array(n), inv = 1 / N;
  for (let i = 0; i < n; i++) { L[i] = hr[i] * inv; R[i] = hi[i] * inv; }
  return { L, R };
}

// ---- the whole blow: stereo, seeded. Returns { L, R, n, info, tick }.
export function makeMelee(sr, cfg, seed) {
  const c = Object.assign({ sr }, cfg), W = c.W, hype = c.hype, w = c.weight;
  const tMain = c.whiff ? c.tLast + c.Ts : c.tc;
  const n = Math.max(64, Math.round((tMain + 2.6 + (c.place ? 2.5 * (0.5 + c.tail) : 0)) * sr));
  const HI = mlBuf(n), LO = mlBuf(n), RG = mlBuf(n), SW = mlBuf(n), TH = mlBuf(n), parts = [];
  const thBus = c.thumpPost ? TH : LO;
  const cw0 = Math.round(Math.max(0, tMain - 0.005) * sr), cw1 = cw0 + Math.round(0.3 * sr);
  const place = (bus, o, E, tag, w0, w1) => {   // add o into bus at energy E over [w0, w1)
    const e = mlEnergy(o, w0, w1, sr); if (!(e > 1e-20) || !(E > 0)) return;
    const g = Math.sqrt(E / e); for (let i = 0; i < n; i++) { bus.L[i] += o.L[i] * g; bus.R[i] += o.R[i] * g; }
    parts.push(tag + " " + (10 * Math.log10(E)).toFixed(1) + " dB");
  };
  // CONTACT (the recipe), each component at its energy share x Contact^2
  const ctE = c.whiff ? 0 : c.contact * c.contact;
  if (ctE > 0) for (const p of mlRecipe(c, seed)) { const o = mlBuf(n); p.render(o); place(p.bus === "rg" ? RG : HI, o, p.E * ctE, p.tag, cw0, cw1); }
  // SWING: its energy over its own span, against the contact's
  let swDesc = null;
  if (c.swing > 0 || c.whiff || W.crack) {
    const o = mlBuf(n), sw = mlSwing(o, sr, c, mlRng(mlSeed(seed, 0, 1)));
    for (let i = 0; i < n; i++) { SW.L[i] = o.L[i]; SW.R[i] = o.R[i]; }
    swDesc = "swing (" + (W.broad > 0.6 ? "broad whoosh" : W.whistle > 0.6 ? "edge whistle" : W.huff ? "huff" : "blade swish") + ", " + Math.round(sw.tEnd * 1000) + " ms" + (c.spins > 1 ? ", " + c.spins + " revolutions" : "") + (W.chain ? ", the chain rattling" : "") + ")";
  }
  if (W.crack) {   // the whip's tip: the crack IS the contact (or the miss's end)
    const o = mlBuf(n); mlWhipCrack(o, sr, tMain, 1, mlRng(mlSeed(seed, 0, 2)));
    place(HI, o, c.whiff ? 0.5 : 0.7 * Math.max(0.3, c.contact), "whip: the tip's N-wave crack", cw0, cw1);
  }
  // BODY: the pitch-dropping sine (+ the sub boom when exaggerated), by how much the target gives
  if (!c.whiff && c.body > 0) {
    // a blunt blow carries through armor into the body behind it (a hammer on a knight); an edge or a point does not
    const give = (c.hit === "blunt" ? c.T.give + (1 - c.T.give) * 0.6 : c.T.give * (c.hit === "edge" ? 0.65 : 0.5));
    const fS = (210 - 120 * w) * (1 - 0.15 * hype), fE = (95 - 55 * w) * (1 - 0.25 * hype), tp = 0.005 + 0.015 * w, tau = (0.02 + 0.08 * w) * (1 + 0.6 * hype);
    const o = mlBuf(n), i0 = Math.round(c.tc * sr), len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr)), at = Math.round(0.0006 * sr);
    let ph = 0, e = 1;
    for (let j = 0; j < len; j++) { const f = fE + (fS - fE) * Math.exp(-j / sr / tp); ph += 2 * Math.PI * f / sr; const v = Math.sin(ph) * e * (j < at ? 0.5 - 0.5 * Math.cos(Math.PI * j / at) : 1); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
    if (hype > 0) { const ts = 0.07 + 0.1 * hype; let p2 = 0, e2 = 0.45 * hype; const d2 = Math.exp(-1 / (ts * sr)); for (let j = 0; j < Math.min(n - i0, Math.ceil(6 * ts * sr)); j++) { p2 += 2 * Math.PI * fE * 0.62 / sr; const v = Math.sin(p2) * e2 * Math.min(1, j / (0.008 * sr)); o.L[i0 + j] += v; o.R[i0 + j] += v; e2 *= d2; } }
    place(LO, o, 1.1 * c.body * c.body * give * (0.4 + 0.9 * w) * (1 + 0.9 * hype), "body (" + Math.round(fS) + " -> " + Math.round(fE) + " Hz, " + Math.round(tau * 1000) + " ms" + (hype > 0 ? ", + sub boom" : "") + ")", cw0, cw1);
  }
  // THE DESIGNED THUMP (Thump > 0): the weight as a game designs it, NOT scaled by how much the target gives. A sub that
  // drops like a kick drum (~100 -> 52 Hz at a light blow, ~85 -> 40 at the heaviest; a kick's leg lower and slower by
  // its mass), a decay of 50-100 ms time constant (so -20 dB at ~0.25-0.45 s), and a meaty mid WHUMP (a 380 -> 170 Hz
  // sweep + a 400 Hz low-passed noise burst, ~25-40 ms). Both into the low group.
  if (!c.whiff && c.thump > 0) {
    const ms = W.mass || 1, sq = Math.sqrt(ms), i0 = Math.round(c.tc * sr), at = Math.round(0.001 * sr);
    const fS = (100 - 15 * w) / sq * (1 - 0.1 * hype), fE = (52 - 12 * w) / sq * (1 - 0.15 * hype), tp = 0.012 + 0.012 * w, tau = (0.05 + 0.05 * w) * ms * (1 + 0.4 * hype);
    { const o = mlBuf(n), len = Math.min(n - i0, Math.ceil(7 * tau * sr)), dk = Math.exp(-1 / (tau * sr));
      let ph = 0, e = 1;
      for (let j = 0; j < len; j++) { const f = fE + (fS - fE) * Math.exp(-j / sr / tp); ph += 2 * Math.PI * f / sr; const v = Math.sin(ph) * e * (j < at ? 0.5 - 0.5 * Math.cos(Math.PI * j / at) : 1); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
      place(thBus, o, 2.6 * c.thump * c.thump * (1 + 0.5 * hype) * (0.6 + 0.6 * w) * ms, "THUMP (sub " + Math.round(fS) + " -> " + Math.round(fE) + " Hz, tau " + Math.round(tau * 1000) + " ms)", cw0, cw1); }
    { const o = mlBuf(n), tw = (0.022 + 0.012 * w) * ms, len = Math.min(n - i0, Math.ceil(7 * tw * sr)), dk = Math.exp(-1 / (tw * sr)), rn = mlRng(mlSeed(seed, 0, 5));
      let ph = 0, e = 1;
      for (let j = 0; j < len; j++) { const f = (170 + 210 * Math.exp(-j / sr / 0.008)) / sq; ph += 2 * Math.PI * f / sr; const v = Math.sin(ph) * e * (j < at ? j / at : 1); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
      mlBurst(o, sr, c.tc, tw * 0.8, 400 / sq, 0.8, 0, 0.6, 0, rn, 0.0008);
      place(thBus, o, 0.7 * c.thump * c.thump * (0.6 + 0.6 * w) * ms, "mid whump (380 -> 170 Hz, tau " + Math.round(tw * 1000) + " ms)", cw0, cw1); }
    if (c.snap > 0) {   // the designed SLAP / CRACK: 3.2 kHz noise through a hard tanh, ~2.5 ms
      const o = mlBuf(n), rn = mlRng(mlSeed(seed, 0, 6)), f = mlSvf(), out = [0, 0, 0], g = mlG(3200, sr), dk = Math.exp(-1 / (0.0025 * sr)), th = Math.tanh(6), len = Math.round(0.018 * sr);
      let e = 1; for (let j = 0; j < len && i0 + j < n; j++) { mlSvfTick(f, rn() * 2 - 1, g, 0.9, out); const v = Math.tanh(6 * out[1] * e * 2) / th; o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
      place(HI, o, 0.16 * c.snap * c.snap, "slap crack (3.2 kHz, clipped)", cw0, cw1);
    }
  }
  // BONE CRUNCH: celery snapping: 14-24 sharp clicks and a dry 1.5-7 kHz crackle, front-loaded over ~22 ms
  if (!c.whiff && c.bone > 0) {
    const o = mlBuf(n), rn = mlRng(mlSeed(seed, 0, 7)), t0 = c.tc + 0.003, K = 14 + Math.round(10 * c.bone);
    for (let q = 0; q < K; q++) mlKnock(o, sr, t0 + 0.022 * Math.pow(rn(), 1.5), 0.00006 + 0.00008 * rn(), (0.4 + rn()) * (rn() < 0.5 ? 1 : -1), 0.1 + 0.4 * (rn() - 0.5), 0);
    mlGrains(o, sr, t0, 0.02, 30, 1500, 7000, 0.0003, 0.5, rn, 0.1, 0.3);
    place(HI, o, 0.22 * c.bone * c.bone, "bone crunch (" + K + " clicks)", cw0, cw1);
  }
  // SNAP and the EXAGGERATED crack, on the contact
  if (!c.whiff && c.snap > 0) {
    const o = mlBuf(n), tmp = new Float64Array(Math.round(0.004 * sr)), rn = mlRng(mlSeed(seed, 0, 3)), wd = 0.00006 + 0.00006 * w;
    mlAddCont(tmp, sr, 0, wd + 0.00025, (t) => (t < wd ? 1 : -0.3), 1);
    const dk = Math.exp(-1 / (0.0003 * sr)); let e = 0.9;
    const i0 = Math.round(c.tc * sr);
    for (let j = 0; j < tmp.length && i0 + j < n; j++) { const v = mlClamp((tmp[j] + (rn() * 2 - 1) * e) * 1.6, -0.75, 0.75); o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
    place(HI, o, 0.05 * c.snap * c.snap * (1 + hype), "snap", cw0, cw1);
  }
  if (!c.whiff && hype > 0) {
    const o = mlBuf(n), rn = mlRng(mlSeed(seed, 0, 4)), i0 = Math.round(c.tc * sr), tau = 0.012, len = Math.min(n - i0, Math.ceil(7 * tau * sr)), f = mlSvf(), out = [0, 0, 0], g = mlG(2800, sr), dk = Math.exp(-1 / (tau * sr)), th = Math.tanh(4);
    let e = 1; for (let j = 0; j < len; j++) { mlSvfTick(f, rn() * 2 - 1, g, 0.85, out); const v = Math.tanh(4 * out[1] * e * 1.4) / th; o.L[i0 + j] += v; o.R[i0 + j] += v; e *= dk; }
    place(HI, o, 0.22 * hype * hype, "exaggerated crack", cw0, cw1);
  }
  // THE CRUNCH STAGE: each group saturated (rings and body gentler), each back to its own energy
  const d = 1 + 20 * Math.pow(c.crunch, 1.5), bias = 0.15 * c.crunch, w0 = Math.round(c.tS * sr), w1 = cw1;
  mlSaturate(HI, d, bias, w0, w1);
  mlSaturate(LO, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  if (c.thumpPost) mlSaturate(TH, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  mlSaturate(RG, 1 + 6 * Math.pow(c.crunch, 1.5), 0.3 * bias, w0, w1);
  if (swDesc) mlSaturate(SW, d, bias, 0, n);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) { L[i] = HI.L[i] + LO.L[i] + RG.L[i]; R[i] = HI.R[i] + LO.R[i] + RG.R[i]; }
  // COMPRESSOR (stereo-linked, log domain): attack 2.5 ms, release 60-120 ms
  let grMax = 0, pk0 = 1, thumpDone = false;
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    for (let i = 0; i < n; i++) { L[i] /= p || 1; R[i] /= p || 1; }
    pk0 = p || 1;
    if (c.comp > 0) {
      // the DETECTOR is high-passed at 150 Hz (a side-chain filter): the contact drives it, so the body is not held
      // down for its whole length; it rides under the hit and swells back as the compressor releases
      const det = new Float64Array(n), hA = Math.exp(-2 * Math.PI * c.detHP / sr);
      { let h1 = 0, x1 = 0, h2 = 0, y1 = 0, h3 = 0, x3 = 0, h4 = 0, y3 = 0, dp = 0;
        for (let i = 0; i < n; i++) { h1 = hA * (h1 + L[i] - x1); x1 = L[i]; h2 = hA * (h2 + h1 - y1); y1 = h1; h3 = hA * (h3 + R[i] - x3); x3 = R[i]; h4 = hA * (h4 + h3 - y3); y3 = h3; det[i] = Math.max(Math.abs(h2), Math.abs(h4)); dp = Math.max(dp, det[i]); }
        for (let i = 0; i < n; i++) det[i] /= dp || 1; }
      const thrDb = -(6 + 24 * c.comp), ratio = 1.5 + 6.5 * c.comp, aA = Math.exp(-1 / (0.0025 * sr)), aR = Math.exp(-1 / ((0.06 + 0.06 * c.comp) * sr));
      let env = -120;
      for (let i = 0; i < n; i++) {
        const m = det[i], lv = m > 1e-9 ? 20 * Math.log10(m) : -180;
        env = lv > env ? lv + (env - lv) * aA : lv + (env - lv) * aR;
        const over = env - thrDb, gr = over > 0 ? over * (1 - 1 / ratio) : 0;
        if (gr > grMax) grMax = gr;
        const gg = Math.pow(10, -gr / 20); L[i] *= gg; R[i] *= gg;
      }
    } }
  // PEAK CONTROL limits the HIT alone, here, before the swing joins: on the whole buffer it lifted the swing by up to
  // 12 dB against a clamped hit (measured: the swing level with the hit at Peak 1.2), which erased the swing-to-hit balance
  if (c.peak > 0 && !c.whiff) { for (let i = 0; i < n; i++) { L[i] += c.thumpPost ? TH.L[i] / pk0 : 0; R[i] += c.thumpPost ? TH.R[i] / pk0 : 0; } mlPeakControl(L, R, sr, c.peak); thumpDone = true; }
  // the designed THUMP may go AROUND the compressor (thumpPost): saturated with the low group, then added here at the
  // same scale it had before the compressor, so the hit's gain reduction neither ducks it nor squashes it
  if (c.thumpPost && !thumpDone) for (let i = 0; i < n; i++) { L[i] += TH.L[i] / pk0; R[i] += TH.R[i] / pk0; }
  // the SWING joins AFTER the compressor (as the gun's mechanism does: a compressor before it lifted it to the hit's
  // level), its loudest 5 ms set swingDb under the hit's loudest 5 ms: -24 dB at Swing 0 .. -6 at 1, +6 when exaggerated
  if (swDesc) {
    const r5 = (A, B) => { const F = Math.round(0.005 * sr); let best = 0; for (let a = 0; a + F <= n; a += F) { let s = 0; for (let i = a; i < a + F; i++) s += A[i] * A[i] + B[i] * B[i]; best = Math.max(best, s); } return Math.sqrt(best / (2 * F)); };
    const hit = c.whiff ? 0 : r5(L, R), own = r5(SW.L, SW.R);
    const db = mlClamp(-24 + 18 * c.swing + 6 * hype, -30, 0), g = own > 0 ? (c.whiff ? 1 / own : hit * Math.pow(10, db / 20) / own) : 0;
    for (let i = 0; i < n; i++) { L[i] += SW.L[i] * g; R[i] += SW.R[i] * g; }
    parts.push(swDesc + (c.whiff ? "" : " at " + db.toFixed(1) + " dB under the hit"));
  }
  // PLACE
  const tailMul = 0.5 + c.tail, wetG = 1.0 * c.tail;
  const ir = mlPlaceIR(sr, c.place, tailMul, mlRng(mlSeed(seed, 8888, 0)));
  if (ir && wetG > 0) {
    const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = (L[i] + R[i]) / 2;
    const wet = mlConvolve(x, ir.L, ir.R, n);
    for (let i = 0; i < n; i++) { L[i] += wet.L[i] * wetG; R[i] += wet.R[i] * wetG; }
  }
  // CLIP, BITS / RATE, DC, width
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    const dc = 0.5 + 3 * c.crunch, tc = Math.tanh(dc), g = p > 0 ? 1 / p : 0;
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * g * dc) / tc; R[i] = Math.tanh(R[i] * g * dc) / tc; } }
  const ds = 1 + Math.round(7 * c.rateCut);
  if (ds > 1) { let hl = 0, hr = 0; for (let i = 0; i < n; i++) { if (i % ds === 0) { hl = L[i]; hr = R[i]; } L[i] = hl; R[i] = hr; } }
  if (c.bits > 0) { const lv = Math.pow(2, 16 - 12 * c.bits - 1); for (let i = 0; i < n; i++) { L[i] = Math.round(L[i] * lv) / lv; R[i] = Math.round(R[i] * lv) / lv; } }
  const hpA = Math.exp(-2 * Math.PI * 22 / sr);
  for (const B of [L, R]) { let h1 = 0, x1 = 0, h2 = 0, y1 = 0; for (let i = 0; i < n; i++) { h1 = hpA * (h1 + B[i] - x1); x1 = B[i]; h2 = hpA * (h2 + h1 - y1); y1 = h1; B[i] = h2; } }
  const wd = mlClamp(c.width, 0, 1) / 0.6;
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2 * wd; L[i] = m + s; R[i] = m - s; }
  // TRIM where it falls 60 dB under its peak (no after-sound), a 40 ms fade; or the preset's own duration
  let m = n;
  if (c.dur > 0) m = Math.min(n, Math.round(c.dur * sr));
  else { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    let e = n - 1; while (e > 0 && Math.abs(L[e]) < p * 1e-3 && Math.abs(R[e]) < p * 1e-3) e--;
    m = Math.min(n, Math.max(Math.round((tMain + 0.15) * sr), e + Math.round(0.04 * sr))); }
  const fo = Math.min(m, Math.round(0.04 * sr)); for (let i = 0; i < fo; i++) { const g = i / fo; L[m - 1 - i] *= g; R[m - 1 - i] *= g; }
  const Lf = Float32Array.from(L.subarray(0, m)), Rf = Float32Array.from(R.subarray(0, m));
  if (c.peak > 0 && c.whiff) mlPeakControl(Lf, Rf, sr, c.peak);   // a whiff is all swing: the whole of it
  const lv = meleeLevel(Lf, Rf, sr); for (let i = 0; i < m; i++) { Lf[i] *= lv; Rf[i] *= lv; }
  const info = { tS: c.tS, tc: c.whiff ? null : c.tc, Ts: c.Ts, hit: c.hit, parts, grMax, ds, bits: c.bits > 0 ? Math.round(16 - 12 * c.bits) : 16, drive: d };
  let i = 0;
  return { L: Lf, R: Rf, n: m, info, tick(drive, o) { if (i < m) { o[0] = Lf[i] * drive; o[1] = Rf[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// PEAK CONTROL, the gun's gunPeak: the app's own limiter (dsp.js limiterProcess, copied here; the port calls it) on the
// melee alone, from a 0.9 peak; past 1 a second pass. A hit is nearly all spike, so this is what lets it sit at a level
// beside the section without the master Limiter
function mlLimiter(L, R, sr, amount) {
  const n = L.length; if (!n || amount <= 0) return;
  const ceiling = 0.98, drive = 1 + amount * 3, look = Math.max(1, Math.floor(0.003 * sr)), rel = Math.exp(-1 / (0.05 * sr));
  for (let i = 0; i < n; i++) { L[i] *= drive; R[i] *= drive; }
  let g = 1;
  for (let i = 0; i < n; i++) {
    let mx = 0; const end = Math.min(n, i + look);
    for (let j = i; j < end; j++) { const a = Math.abs(L[j]), b = Math.abs(R[j]), mm = a > b ? a : b; if (mm > mx) mx = mm; }
    const target = mx > ceiling ? ceiling / mx : 1;
    g = target < g ? target : target + (g - target) * rel;
    L[i] *= g; R[i] *= g;
  }
}
function mlPeakControl(L, R, sr, peak) {
  const n = L.length; let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk < 1e-9) return;
  const g0 = 0.9 / pk; for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
  mlLimiter(L, R, sr, Math.min(1, peak));
  if (peak > 1) { let p2 = 0; for (let i = 0; i < n; i++) p2 = Math.max(p2, Math.abs(L[i]), Math.abs(R[i])); const g1 = 0.9 / Math.max(1e-9, p2); for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; } mlLimiter(L, R, sr, Math.min(1, peak - 1)); }
}
// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9
export function meleeLevel(L, R, sr = 44100) {
  const W = Math.min(L.length, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0, pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= L.length; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return 0;
  let g = 0.12 / Math.sqrt(best);
  if (pk * g > 0.9) g = 0.9 / pk;
  return g;
}

// =====================================================================================================================
// THE CLI: the listening round (tooling, not the model)
// =====================================================================================================================
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli();

function runCli() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SR = 44100, TARGET_LUFS = -18, OUT = join(ROOT, "soundtests", "proto-melee");
  const G = { console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  // the engine files: the live ones, or (if another agent has one mid-edit) a snapshot in the scratch folder
  const SNAP = "/tmp/melee-proto-scratch";
  function load(rel, snapName, get) {
    for (const p of [join(ROOT, rel), join(SNAP, snapName)]) {
      try { const ctx = createContext(Object.assign({}, G)); ctx.window = ctx; ctx.globalThis = ctx; runInContext(readFileSync(p, "utf8"), ctx, { filename: snapName }); const v = get(ctx); if (v) return v; } catch (e) { console.error("(could not load " + p + ": " + e.message + ")"); }
    }
    throw new Error("no " + rel);
  }
  const CS = load("synth-export/crunchysfx-synth.js", "crunchysfx-synth.js", (x) => runInContext("CrunchySynth", x));
  const dctx = load("dsp.js", "dsp.js", (x) => (typeof x.limiterProcess === "function" ? x : null));
  const PRESETS = load("presets.js", "presets.js", (x) => x.window.PRESETS);
  const preset = (nm) => { if (!PRESETS[nm]) throw new Error("no preset " + nm); const o = Object.assign({}, PRESETS[nm]); delete o._vary; return o; };

  // ---- loudness: tools/make-ab.mjs (ITU BS.1770, K-weighted, gated) + its 0.95 peak cap
  function biquad(x, b0, b1, b2, a0, a1, a2) {
    const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
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
    if (L.length <= B) ms.push(block(0, L.length)); else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
    const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
    let g = ms.filter((m) => l(m) > -70); if (!g.length) return -70;
    const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10; g = g.filter((m) => l(m) > rel);
    return l(g.reduce((t, m) => t + m, 0) / g.length);
  }
  function matchLoudness(L, R) {
    let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
    for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
    if (pk > 0.95) gn *= 0.95 / pk;
    for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  }
  // as gun.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js limiterProcess),
  // the smallest amount in 0.1 steps that brings it within 0.5 dB; past 1, a second pass ("1+x")
  function matchWithLimiter(L, R) {
    const L0 = Float32Array.from(L), R0 = Float32Array.from(R);
    matchLoudness(L, R);
    if (lufs(L, R) > TARGET_LUFS - 0.5) return 0;
    let pk = 0; for (let i = 0; i < L0.length; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, amt); matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5) { L.set(l); R.set(r); return Math.round(amt * 10) / 10; }
    }
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, 1);
      let p2 = 0; for (let i = 0; i < l.length; i++) p2 = Math.max(p2, Math.abs(l[i]), Math.abs(r[i]));
      for (let i = 0; i < l.length; i++) { l[i] *= 0.9 / p2; r[i] *= 0.9 / p2; }
      dctx.limiterProcess(l, r, amt); matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5 || amt > 0.95) { L.set(l); R.set(r); return "1+" + Math.round(amt * 10) / 10; }
    }
    return 0;
  }

  // ---- the takes. Three design points of the same engine, bracketing the range:
  const ARC = { meleeCrunch: 0.9, meleeComp: 0.85, meleeBits: 0.55, meleeRateCut: 0.45, meleeSnap: 0.9, meleeHype: 0.2, meleePlace: 0, meleeTail: 0 };
  const HR = { meleeCrunch: 0.25, meleeComp: 0.55, meleeBits: 0, meleeRateCut: 0, meleeSnap: 0.35, meleeHype: 0, meleePlace: 1, meleeTail: 0.3 };
  const FG = { meleeCrunch: 0.55, meleeComp: 0.9, meleeBits: 0, meleeRateCut: 0, meleeSnap: 0.85, meleeHype: 1, meleePlace: 1, meleeTail: 0.4 };
  const ARC_WHY = "MELEE ENGINE, the CRUNCHY / ARCADE point: Crunch 0.9 (the swing and contact driven at ~18 with an asymmetric bias, the rings at ~6, the body at ~5, a hard final clip), compression 0.85, 9-bit, sample-and-hold at 1/4 rate (11 kHz, aliasing on purpose), Snap 0.9, Exaggerate 0.2, DRY. ";
  const HR_WHY = "MELEE ENGINE, the HYPER-REAL point: every layer physical and only lightly crunched (Crunch 0.25), compression 0.55 (threshold 19 dB under the peak, ratio 5.1, 2.5 ms attack), full rate, 16-bit, Snap 0.35, no exaggeration, a small room (Tail 0.3). ";
  const FG_WHY = "MELEE ENGINE, the EXAGGERATED FIGHTING-GAME point: Exaggerate 1 (the swing 6 dB closer to the hit and swelling right into it, the body 1.6x longer and a quarter lower with a sub boom under it, a bright saturated crack on the contact), Snap 0.85, Crunch 0.55, compression 0.9 (threshold 28 dB under, ratio 7.4), full rate, a room (Tail 0.4). ";
  const ml = (...o) => Object.assign({ width: 0.6 }, ...o);
  const WP = (name) => MELEE_WEAPONS.indexOf(name), TG = (name) => MELEE_TARGETS.indexOf(name), HT = (name) => MELEE_HITS.indexOf(name);
  const ROUNDS = {
    "punch-kick": {
      title: "Punch / Kick", control: "Punch / Kick",
      controlWhy: "the CURRENT preset \"Punch / Kick\" exactly as it ships (the impact engine: a noise hit with a 70 Hz boom, drive 0.3).",
      listen: "A fist (or a foot) landing on a body in a brawler. Which one is the most SATISFYING punch to throw a hundred times: you hear the blow come in, it lands with a SMACK, and it has WEIGHT? Listen for the instant of contact (the skin's slap, the thud of the body), the low end under it, and whether there is any movement of air before it.",
      base: { meleeWeapon: WP("fist"), meleeTarget: TG("flesh"), meleeHit: HT("blunt") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "A fist on a body (Weight 0.5), a short huff of a swing (0.3), the slap and the thup.", st: { meleeWeight: 0.5, meleeSpeed: 0.6, meleeSwing: 0.3, meleeContact: 0.85, meleeBody: 0.8, meleeRing: 0 }, seed: 11 },
        { id: "hyper-real", why: HR_WHY + "A fist on a body (Weight 0.45): the arm's huff and the sleeve (Swing 0.35), the ~12 ms force pulse (a \"thup\" through a 900 Hz low-pass), the skin's slap (3.8 kHz, 5 ms), a cloth flap; the bone under it just starts (Weight > 0.4).", st: { meleeWeight: 0.45, meleeSpeed: 0.55, meleeSwing: 0.35, meleeContact: 0.85, meleeBody: 0.7, meleeRing: 0 }, seed: 13 },
        { id: "fighting-game", why: FG_WHY + "A heavy fist (Weight 0.75, a sub boom under the body), a big swung huff (Swing 0.8) swelling into the hit, bone cracking under it.", st: { meleeWeight: 0.75, meleeSpeed: 0.65, meleeSwing: 0.8, meleeContact: 0.85, meleeBody: 1, meleeRing: 0 }, seed: 17 },
      ] },
    "katana-slice": {
      title: "Katana Slice (a cut that lands)", control: "Katana Slice",
      controlWhy: "the CURRENT preset \"Katana Slice\" exactly as it ships (the whoosh engine alone: a swish of air; nothing lands).",
      listen: "A katana cutting an enemy: the cut LANDS. Which one is the most SATISFYING slice: the blade's whistle through the air, then the bite into the body (a sharp, wet, tearing cut), with a little weight? Listen for whether the blade hits ANYTHING, for the texture of the cut (sharp? wet? tearing?), and for the swing before it (a thin whistle, or a broad whoosh).",
      base: { meleeWeapon: WP("katana"), meleeTarget: TG("flesh"), meleeHit: HT("edge") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "A katana through flesh (Weight 0.45), a fast swing (Speed 0.8: the edge whistle at ~2 kHz, Q ~13), the cut following through.", st: { meleeWeight: 0.45, meleeSpeed: 0.8, meleeSwing: 0.65, meleeContact: 0.85, meleeBody: 0.5, meleeRing: 0.25 }, seed: 21 },
        { id: "hyper-real", why: HR_WHY + "A katana through flesh (Weight 0.45): the groove's whistle (the tip at ~2 kHz, a narrow band, Doppler-tilted, panned across) for ~0.1 s, then the edge's entry \"shk\", fibers tearing (~35 grains over 80 ms), a wet squelch falling 1.4 kHz -> 350 Hz, a few bubbles, the blade following through and slowing; the body light (edge: 0.65 of a blunt hit's).", st: { meleeWeight: 0.45, meleeSpeed: 0.75, meleeSwing: 0.7, meleeContact: 0.85, meleeBody: 0.4, meleeRing: 0.3 }, seed: 23 },
        { id: "fighting-game", why: FG_WHY + "The same katana cut, heavier (Weight 0.6: bone starting to crack), the whistle swelling into the hit, the anime crack on the bite, the body long.", st: { meleeWeight: 0.6, meleeSpeed: 0.8, meleeSwing: 0.8, meleeContact: 0.85, meleeBody: 0.7, meleeRing: 0.3 }, seed: 27 },
      ] },
    "axe-chop": {
      title: "Axe Chop", control: "Axe Chop",
      controlWhy: "the CURRENT preset \"Axe Chop\" exactly as it ships (the whoosh engine alone: air; nothing lands).",
      listen: "A heavy axe chopping into an enemy in a leather jerkin. Which one is the most SATISFYING chop: a heavy swing, a BITE that goes in deep (leather tearing, a wet chop, bone), and real weight? Listen for whether the axe hits anything, for the weight of the blow, and for the texture of the bite.",
      base: { meleeWeapon: WP("axe"), meleeTarget: TG("cloth / leather"), meleeHit: HT("edge") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "An axe into leather over flesh (Weight 0.75), a broad whoosh (Swing 0.5).", st: { meleeWeight: 0.75, meleeSpeed: 0.45, meleeSwing: 0.5, meleeContact: 0.9, meleeBody: 0.8, meleeRing: 0.2 }, seed: 31 },
        { id: "hyper-real", why: HR_WHY + "An axe into a leather jerkin (Weight 0.75: the body 120 -> 54 Hz over ~80 ms): a broad whoosh of the head (~0.2 s before the bite, Strouhal ~180-280 Hz, a wide band), then the hide's knock and the RIP (~75 grains, 0.9-6 kHz), the flesh under it 60 % through (6 ms later: the wet squelch, bubbles), bone cracking (Weight > 0.4), the axe's bit ringing faintly.", st: { meleeWeight: 0.75, meleeSpeed: 0.45, meleeSwing: 0.5, meleeContact: 0.9, meleeBody: 0.8, meleeRing: 0.2 }, seed: 33 },
        { id: "fighting-game", why: FG_WHY + "The same chop at Weight 0.9 (the sub boom under the body), the whoosh swelling in.", st: { meleeWeight: 0.9, meleeSpeed: 0.5, meleeSwing: 0.75, meleeContact: 0.9, meleeBody: 1, meleeRing: 0.2 }, seed: 37 },
      ] },
    "sword-clash": {
      title: "Sword Clash", control: "Sword Clash",
      controlWhy: "the CURRENT preset \"Sword Clash\" exactly as it ships (the modal bank: six partials at 1.2 kHz, inharmonic, one strike, drive 0.15, a reverb).",
      listen: "Two swords meeting: a parry or a clash in a duel. Which one is the most SATISFYING clash: two pieces of STEEL that ring (long, bright, a little out of tune with each other, shimmering), and maybe the edges sliding along each other? Listen for the ring (is it steel, or a bell or a beep?), the shimmer (beating) in it, and the scrape after.",
      base: { meleeWeapon: WP("sword"), meleeTarget: TG("steel blade"), meleeHit: HT("edge") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "Sword on sword (Ring 0.5: the hands damp each mode with a ~0.22 s time constant), a short scrape (0.35), a short swing (0.3).", st: { meleeWeight: 0.55, meleeSpeed: 0.6, meleeSwing: 0.3, meleeContact: 1, meleeBody: 0.4, meleeRing: 0.5, meleeScrape: 0.35 }, seed: 41 },
        { id: "hyper-real", why: HR_WHY + "Sword on sword: a short swing (0.35), the contact click, BOTH blades ringing (each ~12 beam modes from ~0.9 to 8 kHz, weighted by where along the blade it was struck, each a beating pair 0.4-3.4 Hz apart; the other blade detuned ~6 % and struck elsewhere; Ring 0.6: the hands damp each mode with a ~0.27 s time constant, steel's own loss on top), then the edges SLIDE (Scrape 0.5: ~0.19 s, narrow band-passes at both blades' modes whose weights follow the moving contact, the friction hiss).", st: { meleeWeight: 0.55, meleeSpeed: 0.6, meleeSwing: 0.35, meleeContact: 1, meleeBody: 0.35, meleeRing: 0.6, meleeScrape: 0.5 }, seed: 43 },
        { id: "fighting-game", why: FG_WHY + "The same clash, heavier (Weight 0.7), a longer ring (0.75: a ~0.37 s time constant) and a long scrape (0.7: ~0.24 s), the swing swelling into it, the crack and the body boom under the steel.", st: { meleeWeight: 0.7, meleeSpeed: 0.65, meleeSwing: 0.6, meleeContact: 1, meleeBody: 0.6, meleeRing: 0.75, meleeScrape: 0.7 }, seed: 47 },
      ] },
    "hammer-smash": {
      title: "Hammer Smash", control: "Hammer Smash",
      controlWhy: "the CURRENT preset \"Hammer Smash\" exactly as it ships (the impact engine: a gritty noise hit with a deep 55 Hz boom, drive 0.45, a reverb).",
      listen: "A war hammer smashing into a knight in plate armor. Which one is the most SATISFYING smash: a huge, slow swing, a dull metal BONG of the armor denting, and enormous weight? Listen for the weight and the low end, the metal of the armor (a dented bong, a clang), and the swing before it.",
      base: { meleeWeapon: WP("hammer / mace"), meleeTarget: TG("plate armor"), meleeHit: HT("blunt") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "A hammer on plate (Weight 0.9), a broad slow whoosh (Swing 0.45, Speed 0.35).", st: { meleeWeight: 0.9, meleeSpeed: 0.35, meleeSwing: 0.45, meleeContact: 0.9, meleeBody: 0.9, meleeRing: 0.35 }, seed: 51 },
        { id: "hyper-real", why: HR_WHY + "A war hammer on plate armor (Weight 0.9: the body 102 -> 46 Hz over ~90 ms): a broad, slow \"whumph\" (Speed 0.35: ~0.36 s of swing), then the plate's BONG (a shell's 9 modes from ~360 Hz, beating pairs 3-9 Hz apart, struck dull: a ~0.5 ms contact reaches the low modes and not the high ones), the knock, the dent (a few low clicks), the hammer's head ringing a little, the knight under it.", st: { meleeWeight: 0.9, meleeSpeed: 0.35, meleeSwing: 0.45, meleeContact: 0.9, meleeBody: 0.9, meleeRing: 0.4 }, seed: 53 },
        { id: "fighting-game", why: FG_WHY + "The same smash at Weight 1 (the sub boom under the body), the whoosh swelling in.", st: { meleeWeight: 1, meleeSpeed: 0.4, meleeSwing: 0.7, meleeContact: 0.9, meleeBody: 1, meleeRing: 0.4 }, seed: 57 },
      ] },
    "shield-block": {
      title: "Shield Block", control: "Shield Block",
      controlWhy: "the CURRENT preset \"Shield Block\" exactly as it ships (the impact engine: a noise hit with a 95 Hz boom, drive 0.28).",
      listen: "A sword blow stopped by a wooden shield (a round shield with an iron rim and boss). Which one is the most SATISFYING block: a solid wooden \"THOCK\" that says the blow was STOPPED, with weight, maybe the iron ringing a little? Listen for the wood (hollow, resonant, a big plank disc), whether the blow feels stopped, and the metal of the rim.",
      base: { meleeWeapon: WP("sword"), meleeTarget: TG("wooden shield"), meleeHit: HT("edge") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "A sword's edge on a wooden shield (Weight 0.55), a short swing (0.3), the rim at Ring 0.25.", st: { meleeWeight: 0.55, meleeSpeed: 0.55, meleeSwing: 0.3, meleeContact: 0.9, meleeBody: 0.7, meleeRing: 0.25 }, seed: 61 },
        { id: "hyper-real", why: HR_WHY + "A sword's edge on a wooden shield (Weight 0.55: the body 144 -> 65 Hz): a short swing (0.35), then the shield's THOCK (a plank disc's 9 modes from ~135 Hz, a 0.6 ms contact), the knock, fibers splitting under the edge, the iron rim and boss ringing (Ring 0.3), the blade ringing a little; the swing STOPS.", st: { meleeWeight: 0.55, meleeSpeed: 0.55, meleeSwing: 0.35, meleeContact: 0.9, meleeBody: 0.7, meleeRing: 0.3 }, seed: 63 },
        { id: "fighting-game", why: FG_WHY + "The same block at Weight 0.75, the rim at Ring 0.45, the swing swelling in.", st: { meleeWeight: 0.75, meleeSpeed: 0.6, meleeSwing: 0.6, meleeContact: 0.9, meleeBody: 0.9, meleeRing: 0.45 }, seed: 67 },
      ] },
    "dagger-stab": {
      title: "Dagger Stab", control: "Dagger Stab",
      controlWhy: "the CURRENT preset \"Dagger Stab\" exactly as it ships (the impact engine: a bright noise hit with a 100 Hz boom, drive 0.25).",
      listen: "A dagger stabbed into an enemy, close and quick (a stealth kill, a backstab). Which one is the most SATISFYING stab: a quick thrust, the point going IN (a pierce and a wet push), short and nasty? Listen for the pierce (a sharp point breaking in), the push after it, and whether it reads as a stab or as a punch.",
      base: { meleeWeapon: WP("dagger"), meleeTarget: TG("flesh"), meleeHit: HT("point") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "A dagger's point into flesh (Weight 0.3), a short thrust (Swing 0.2).", st: { meleeWeight: 0.3, meleeSpeed: 0.8, meleeSwing: 0.2, meleeContact: 0.9, meleeBody: 0.4, meleeRing: 0.1 }, seed: 71 },
        { id: "hyper-real", why: HR_WHY + "A dagger's point into flesh (Weight 0.3): a short thrust's \"fff\" (Swing 0.25), the point's tick, the skin's pop (1.6 kHz, 6 ms), the PUSH (a lower squelch, 900 -> 240 Hz over ~0.13 s), the blade's flat sliding in (a high, narrow hiss), a few bubbles; a light body (point: half a blunt hit's).", st: { meleeWeight: 0.3, meleeSpeed: 0.8, meleeSwing: 0.25, meleeContact: 0.9, meleeBody: 0.35, meleeRing: 0.1 }, seed: 73 },
        { id: "fighting-game", why: FG_WHY + "The same stab, heavier (Weight 0.5), the thrust swelling in (Swing 0.5).", st: { meleeWeight: 0.5, meleeSpeed: 0.85, meleeSwing: 0.5, meleeContact: 0.9, meleeBody: 0.6, meleeRing: 0.1 }, seed: 77 },
      ] },
    "critical-slash": {
      title: "Critical Slash (the big finisher)", control: "Critical Slash",
      controlWhy: "the CURRENT preset \"Critical Slash\" exactly as it ships (the whoosh engine alone: a long, fast swish; nothing lands).",
      listen: "The big finishing blow: a critical hit with a sword through an armored enemy (mail over a body). Which one is the most SATISFYING finisher: a huge swing, a cut that LANDS hard through armor (the mail's links bursting, the bite, the blade ringing), and real weight, the hit that ends a fight? Listen for the size of the swing, what the blade cuts through, and the weight.",
      base: { meleeWeapon: WP("sword"), meleeTarget: TG("mail"), meleeHit: HT("edge") },
      takes: [
        { id: "crunchy-arcade", why: ARC_WHY + "A sword through mail at Weight 0.95, a big swing (0.8).", st: { meleeWeight: 0.95, meleeSpeed: 0.7, meleeSwing: 0.8, meleeContact: 1, meleeBody: 1, meleeRing: 0.4, meleeScrape: 0.4 }, seed: 81 },
        { id: "hyper-real", why: HR_WHY + "A sword through mail at Weight 0.95 (the body 96 -> 43 Hz over ~95 ms): a big, fast swing (0.85, Speed 0.7), then the links (~54 tiny rings, 2.5-9 kHz) and links snapping, the edge dragging over them, the flesh under it 35 % through (bone cracking), the blade ringing (Ring 0.45), the swing slowed by the mail.", st: { meleeWeight: 0.95, meleeSpeed: 0.7, meleeSwing: 0.85, meleeContact: 1, meleeBody: 1, meleeRing: 0.45, meleeScrape: 0.4 }, seed: 83 },
        { id: "fighting-game", why: FG_WHY + "The same finisher at Weight 1, the swing swelling right into the hit, the long sub boom and the crack.", st: { meleeWeight: 1, meleeSpeed: 0.75, meleeSwing: 0.9, meleeContact: 1, meleeBody: 1, meleeRing: 0.5, meleeScrape: 0.4 }, seed: 87 },
      ] },
  };
  ROUNDS["punch-kick-2"] = {
    title: "Punch / Kick, round 2 (a DESIGNED punch)", noControl: true,
    listen: "Round 1's punches were built physically and \"lack any sort of gravity or power\". These four are DESIGNED the way the guns are: a long, low THUMP that dominates (a kick-drum sub, never thinned by the body it lands on), a meaty mid \"whump\", a sharp clipped SLAP on top, sometimes a short dry bone CRUNCH, a very short swing tight to the hit, all saturated and compressed into one hit. Three are punches in three styles and one is a KICK. Which one has GRAVITY and POWER, the hit you want to land a hundred times? Listen for the weight under it (do you feel it?), the slap on top, and whether it reads as one hit.",
    base: { meleeWeapon: WP("fist"), meleeTarget: TG("flesh"), meleeHit: HT("blunt"), meleeRing: 0 },
    takes: [
      { id: "cinematic-heavy", style: { meleeCrunch: 0.45, meleeComp: 0.85, meleeBits: 0, meleeRateCut: 0, meleeHype: 0, meleePlace: 1, meleeTail: 0.15 },
        why: "MELEE ENGINE, a CINEMATIC heavy punch: Thump 1 (a sub dropping 90 -> 44 Hz with a 85 ms time constant, and the mid whump), Weight 0.7, the slap crack (Snap 0.7), Bone crunch 0.6, a 60 ms swing tight to the hit (Swing 0.25), the physical contact under it (Contact 0.6: the force pulse and the skin), Crunch 0.45, compression 0.85, a small room (Tail 0.15).",
        st: { meleeWeight: 0.7, meleeSpeed: 0.75, meleeSwing: 0.25, meleeContact: 0.6, meleeBody: 0.2, meleeThump: 1, meleeBone: 0.6, meleeSnap: 0.7 }, seed: 101 },
      { id: "beat-em-up", style: { meleeCrunch: 0.9, meleeComp: 0.9, meleeBits: 0.6, meleeRateCut: 0.5, meleeHype: 0.15, meleePlace: 0, meleeTail: 0 },
        why: "MELEE ENGINE, a CRUNCHY BEAT-'EM-UP punch: short, dry and low-fi (Crunch 0.9, 9-bit, sample-and-hold at 1/5 rate, no room), still with the big thump (Thump 0.95, Weight 0.6), the slap crack at Snap 0.9, no bone, a 55 ms swing.",
        st: { meleeWeight: 0.6, meleeSpeed: 0.8, meleeSwing: 0.2, meleeContact: 0.55, meleeBody: 0.2, meleeThump: 0.95, meleeBone: 0, meleeSnap: 0.9 }, seed: 103 },
      { id: "fighting-game-heavy", style: { meleeCrunch: 0.55, meleeComp: 0.9, meleeBits: 0, meleeRateCut: 0, meleeHype: 1, meleePlace: 1, meleeTail: 0.2 },
        why: "MELEE ENGINE, a FIGHTING-GAME heavy hit: Exaggerate 1 (the thump lower and 1.4x longer, a sub boom under it, the bright saturated crack on the contact), Thump 1, Weight 0.8, Snap 0.9, Bone 0.35, a 75 ms swing swelling in, a small room (Tail 0.2).",
        st: { meleeWeight: 0.8, meleeSpeed: 0.75, meleeSwing: 0.35, meleeContact: 0.55, meleeBody: 0.3, meleeThump: 1, meleeBone: 0.35, meleeSnap: 0.9 }, seed: 107 },
      { id: "kick", style: { meleeCrunch: 0.5, meleeComp: 0.85, meleeBits: 0, meleeRateCut: 0, meleeHype: 0.2, meleePlace: 1, meleeTail: 0.15 },
        why: "MELEE ENGINE, a KICK (a new weapon, \"kick\": a leg, 1.4x the mass of a fist): the leg's whoosh (~0.11 s before the hit), a bigger, deeper, slower thump (the sub ~15 % lower and its decay 1.4x longer, the whump lower), Weight 0.85, Snap 0.6, Bone 0.4, a small room.",
        st: { meleeWeapon: 9, meleeWeight: 0.85, meleeSpeed: 0.55, meleeSwing: 0.4, meleeContact: 0.6, meleeBody: 0.3, meleeThump: 1, meleeBone: 0.4, meleeSnap: 0.6 }, seed: 109 },
    ] };
  const ORDER = ["punch-kick", "punch-kick-2", "katana-slice", "axe-chop", "sword-clash", "hammer-smash", "shield-block", "dagger-stab", "critical-slash"];
  const STYLE = { "crunchy-arcade": ARC, "hyper-real": HR, "fighting-game": FG };

  function renderMelee(round, t) {
    const st = Object.assign({}, MELEE_DEFAULTS, ml(round.base, t.style || STYLE[t.id], t.st)), cfg = meleeCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeMelee(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms, st };
  }
  function renderTake(round, t) {
    if (t.kind === "control") {
      const o = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
      return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), info: null };
    }
    const { r, ms, st } = renderMelee(round, t);
    return { L: r.L, R: r.R, info: r.info, ms, st };
  }

  // ---- measurement (we cannot listen)
  function bandShare(x, a, len, f0, f1) {
    let N = 1; while (N < len) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < Math.min(N, len) && a + i < x.length; i++) re[i] = x[a + i];
    mlFFT(re, im, -1);
    let all = 0, b = 0, num = 0;
    for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k], f = k * SR / N; all += p; num += f * p; if (f >= f0 && f < f1) b += p; }
    return { share: b / (all || 1), centroid: num / (all || 1) };
  }
  function measure(L, R) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0, ip = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; const a = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (a > pk) { pk = a; ip = i; } }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan };
    const whole = bandShare(mono, 0, n, 0, 150); m.centroid = whole.centroid; m.lo150 = whole.share;
    const B = Math.min(n, Math.floor(0.4 * SR)); let best = 0;
    for (let a = 0; a + B <= n; a += Math.floor(0.01 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += mono[i] * mono[i]; best = Math.max(best, s / B); }
    m.crest = 20 * Math.log10(pk / Math.sqrt(best || 1e-20));
    // 1 ms RMS frames: the CONTACT is the loudest frame; the attack is 10 % -> 90 % of that frame's level going into it
    const F = Math.round(0.001 * SR), fr = [];
    for (let a = 0; a + F <= n; a += F) { let s = 0; for (let i = a; i < a + F; i++) s += mono[i] * mono[i]; fr.push(Math.sqrt(s / F)); }
    // the CONTACT: the largest jump in level (a swing swells, a thump peaks late; a hit JUMPS)
    let mx = 0; for (const v of fr) mx = Math.max(mx, v);
    const hpm = hpOnset(mono), fh = []; for (let a = 0; a + F <= n; a += F) { let s = 0; for (let i = a; i < a + F; i++) s += hpm[i] * hpm[i]; fh.push(Math.sqrt(s / F)); }
    let kc = 0, bestR = -1; for (let k = 3; k < fh.length; k++) { const j = fh[k] - Math.max(fh[k - 1], fh[k - 2], fh[k - 3]); if (j > bestR) { bestR = j; kc = k; } }
    // walk back along the RISE only (stop where the level stops falling: that is the swing, not the contact's attack)
    let k10 = kc; while (k10 > 0 && fr[k10 - 1] > 0.1 * fr[kc] && fr[k10 - 1] <= fr[k10] * 1.05 && kc - k10 < 60) k10--;
    let k90 = k10; while (k90 < kc && fr[k90] < 0.9 * fr[kc]) k90++;
    m.attackMs = k90 - k10; m.contactMs = kc;
    // the onset: the first 1 ms frame over -40 dB of the loudest; swing -> contact = onset to the loudest frame
    const k0 = fr.findIndex((v) => v > 0.01 * fr[kc]); m.onsetMs = k0; m.leadMs = kc - k0;
    // the swing's level: the loudest frame before the contact window (more than 15 ms before), against the contact's
    let sw = 0; for (let k = k0; k < kc - 15; k++) sw = Math.max(sw, fr[k]); m.swingDb = sw > 0 ? 20 * Math.log10(sw / fr[kc]) : null;
    const first = bandShare(mono, Math.max(0, kc * F - Math.round(0.005 * SR)), Math.round(0.15 * SR), 0, 150); m.lo150first = first.share;
    // how long it rings: from the contact to -30 dB / -60 dB of the loudest frame
    let k30 = kc, k60 = kc; for (let k = kc; k < fr.length; k++) { if (fr[k] > 0.0316 * fr[kc]) k30 = k; if (fr[k] > 0.001 * fr[kc]) k60 = k; }
    m.to30 = (k30 - kc) / 1000; m.to60 = (k60 - kc) / 1000;
    const W5 = Math.round(0.05 * SR), lv = [];
    for (let a = 0; a + W5 <= n; a += W5) { let s = 0; for (let i = a; i < a + W5; i++) s += mono[i] * mono[i]; lv.push(s / W5); }
    const mxl = Math.max(...lv); m.env = lv.map((v) => Math.round(10 * Math.log10(v / mxl + 1e-12))).join(" ");
    const e2 = Math.floor(0.002 * SR); let eS = 0, eE = 0;
    for (let i = 0; i < e2; i++) { eS = Math.max(eS, Math.abs(mono[i])); eE = Math.max(eE, Math.abs(mono[n - 1 - i])); }
    m.edgeS = eS / (pk || 1); m.edgeE = eE / (pk || 1);
    m.thump = thumpMeasure(L, R, SR);
    return m;
  }
// shared meter: low share <150 Hz, energy share <120 Hz in the 300 ms from the contact, the thump band's decay
function lpf(x, fc, SR) { // 4th-order Butterworth LP (two biquads)
  let y = x; for (const q of [0.5412, 1.3066]) { const w = 2 * Math.PI * fc / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), b0 = (1 - c) / 2, b1 = 1 - c, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    const o = new Float64Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < y.length; i++) { const v = (b0 * y[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; } y = o; } return y; }
function hpOnset(x) { const a = Math.exp(-2 * Math.PI * 1000 / 44100), y = new Float64Array(x.length); let h1 = 0, x1 = 0, h2 = 0, y1 = 0; for (let i = 0; i < x.length; i++) { h1 = a * (h1 + x[i] - x1); x1 = x[i]; h2 = a * (h2 + h1 - y1); y1 = h1; y[i] = h2; } return y; }
function thumpMeasure(L, R, SR) {
  const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
  const F = Math.round(0.001 * SR), fr = []; for (let a = 0; a + F <= n; a += F) { let s = 0; for (let i = a; i < a + F; i++) s += mono[i] * mono[i]; fr.push(s / F); }
  // the CONTACT: the largest jump in level (a swing swells, a thump peaks late; a hit JUMPS)
  let mx = 0; for (const v of fr) mx = Math.max(mx, v);
  const hpm = hpOnset(mono), fa = []; for (let a = 0; a + F <= n; a += F) { let s = 0; for (let i = a; i < a + F; i++) s += hpm[i] * hpm[i]; fa.push(Math.sqrt(s / F)); }
  let kc = 0, best = -1; for (let k = 3; k < fa.length; k++) { const j = fa[k] - Math.max(fa[k - 1], fa[k - 2], fa[k - 3]); if (j > best) { best = j; kc = k; } }
  const c0 = Math.max(0, kc * F - Math.round(0.005 * SR));
  const lo150 = lpf(mono, 150, SR), lo120 = lpf(mono, 120, SR);
  let et = 0, el = 0; for (let i = 0; i < n; i++) { et += mono[i] * mono[i]; el += lo150[i] * lo150[i]; }
  let e3 = 0, l3 = 0; for (let i = c0; i < Math.min(n, c0 + Math.round(0.3 * SR)); i++) { e3 += mono[i] * mono[i]; l3 += lo120[i] * lo120[i]; }
  // the thump: the <120 Hz band's 10 ms RMS envelope, from its peak to -20 / -40 dB
  const W = Math.round(0.01 * SR), env = []; for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += lo120[i] * lo120[i]; env.push(Math.sqrt(s / W)); }
  let kp = 0; for (let k = 0; k < env.length; k++) if (env[k] > env[kp]) kp = k;
  let k20 = kp, k40 = kp; for (let k = kp; k < env.length; k++) { if (env[k] > env[kp] * 0.1) k20 = k; if (env[k] > env[kp] * 0.01) k40 = k; }
  return { kc, lo150: el / et, lo120_300: l3 / e3, t20: (k20 - kp) * 0.01, t40: (k40 - kp) * 0.01, sec: n / SR };
}
const fmtT = (m) => "<150 Hz " + (100 * m.lo150).toFixed(0) + "%, <120 Hz in the 300 ms from contact " + (100 * m.lo120_300).toFixed(0) + "%, thump (<120 Hz) peak to -20 / -40 dB " + (m.t20 * 1000).toFixed(0) + " / " + (m.t40 * 1000).toFixed(0) + " ms";

  const fmt = (m, lim) => (m.thump ? fmtT(m.thump) + "; " : "") + m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", NaN " + m.nan +
    ", crest " + m.crest.toFixed(1) + " dB, contact at " + m.contactMs + " ms (attack " + m.attackMs + " ms), swing -> contact " + m.leadMs + " ms" +
    (m.swingDb != null ? " (swing peak " + m.swingDb.toFixed(1) + " dB under the contact)" : "") +
    ", contact to -30 / -60 dB " + m.to30.toFixed(2) + " / " + m.to60.toFixed(2) + " s" +
    ", <150 Hz " + (100 * m.lo150).toFixed(0) + "% (150 ms from contact " + (100 * m.lo150first).toFixed(0) + "%), centroid " + Math.round(m.centroid) + " Hz" +
    ", edges " + m.edgeS.toFixed(3) + "/" + m.edgeE.toFixed(4) + (lim ? ", Limiter " + lim : "");

  const costLog = [];
  function run(name) {
    const round = ROUNDS[name];
    const takes = (round.noControl ? [] : [{ id: "control", kind: "control", why: round.controlWhy, patch: preset(round.control) }]).concat(round.takes.map((t) => Object.assign({ kind: "melee" }, t)));
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(round, t), m0 = measure(r.L, r.R), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R), file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const line = fmt(m, lim), raw = "before matching: crest " + m0.crest.toFixed(1) + " dB, peak/LUFS as rendered " + m0.peak.toFixed(3) + " / " + m0.lufs.toFixed(1);
      const detail = "level per 50 ms (dB): " + m.env + "\n" + raw +
        (r.info ? "\nmodel: swing " + (r.info.Ts * 1000).toFixed(0) + " ms from " + (r.info.tS * 1000).toFixed(0) + " ms, contact at " + (r.info.tc == null ? "- (a miss)" : (r.info.tc * 1000).toFixed(0) + " ms") + ", hit " + r.info.hit +
          ", drive " + r.info.drive.toFixed(1) + ", compressor max " + r.info.grMax.toFixed(1) + " dB of reduction, " + r.info.bits + "-bit, rate /" + r.info.ds +
          "\nlayers (energy over the 300 ms from the contact, the swing over its own span): " + r.info.parts.join("; ") +
          "\nrender " + r.ms.toFixed(0) + " ms for " + m.sec.toFixed(2) + " s = " + (r.ms / m.sec).toFixed(0) + " ms per second of audio" : "");
      console.log("  " + file + "  " + t.id.padEnd(16) + line + "\n      " + detail.replace(/\n/g, "\n      "));
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target"); if (t.kind !== "control" && (m.edgeS > 0.02 || m.edgeE > 0.02)) bad.push("edge");
      if (bad.length) console.log("    !! " + bad.join(", "));
      if (r.ms) costLog.push(r.ms / m.sec);
      key.push({ file, t, line, detail, lim, st: r.st });
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. " + (round.noControl ? "All of them are the new engine; today's preset is not in this round (you heard it in round 1)." : "One of them is the sound the app makes today.") + "\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. If one is the right IDEA but too much or too little of something (swing, weight, wetness, ring, crunch, room), say that too: those are knobs. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" +
      "Melee-engine takes are the prototype's stereo output (its own crunch stage, place and level; no other chain). The control is rendered by the exported engine (`synth-export/crunchysfx-synth.js`) exactly as `tools/make-ab.mjs` does, Normalize on.\n\n" +
      "Measurement legend: crest = peak over the loudest 400 ms; the CONTACT is the 1 ms frame with the largest jump in level over the 3 before it, read above 1 kHz (where a thump's cycles cannot pass for the hit), its attack 10 % -> 90 % of that frame's level along the rise into it; swing -> contact = the first frame over -40 dB of the contact to the contact (for a control with no swing, this is just the attack); the swing's peak is the loudest frame more than 15 ms before the contact; contact to -30 / -60 dB = how long it rings; <150 Hz = the low-end share of the energy (whole file, and the 150 ms from the contact); edges = the first / last 2 ms against the peak.\n\n" +
      key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\nMeasured: " + k.line + "\n\n```\n" + k.detail + "\n```\n\n" +
        (k.lim ? "Note: its peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.lim + " before matching.\n\n" : "") +
        "```json\n" + JSON.stringify(k.t.kind === "control" ? k.t.patch : { st: Object.fromEntries(Object.entries(k.st).filter(([kk, v]) => kk === "width" || MELEE_DEFAULTS[kk] !== v || kk === "meleeWeapon" || kk === "meleeTarget" || kk === "meleeHit")), seed: k.t.seed }) + "\n```\n").join("\n"));
  }

  function cost() {
    const per = [];
    for (const name of ORDER) for (const t of ROUNDS[name].takes) {
      let best = Infinity, sec = 0;
      for (let k = 0; k < 5; k++) { const { r, ms } = renderMelee(ROUNDS[name], t); best = Math.min(best, ms); sec = r.n / SR; }
      per.push(best / sec);
      console.log((name + "/" + t.id).padEnd(36) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    per.sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }

  const README = `# Melee engine prototype: listening round

A PROTOTYPE engine, "melee" (a weapon swung, LANDING in something), against today's presets. Made by
\`node tools/proto/melee.mjs\` (the model, \`makeMelee\`, and this round are both in that file). Nothing in the app changed.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one is the most SATISFYING hit, and a runner-up. **One take in each folder
is today's preset.** Then read \`KEY.md\`.

| # | folder | the sound | control (today's preset) | the other three |
|---|---|---|---|---|
| 1 | punch-kick | a fist on a body | Punch / Kick (impact) | melee crunchy-arcade, hyper-real, fighting-game |
| 2 | katana-slice | a katana cut that lands in flesh | Katana Slice (whoosh only) | melee crunchy-arcade, hyper-real, fighting-game |
| 3 | axe-chop | an axe into a leather jerkin | Axe Chop (whoosh only) | melee crunchy-arcade, hyper-real, fighting-game |
| 4 | sword-clash | sword on sword | Sword Clash (modal bank) | melee crunchy-arcade, hyper-real, fighting-game |
| 5 | hammer-smash | a war hammer on plate armor | Hammer Smash (impact) | melee crunchy-arcade, hyper-real, fighting-game |
| 6 | shield-block | a sword stopped by a wooden shield | Shield Block (impact) | melee crunchy-arcade, hyper-real, fighting-game |
| 7 | dagger-stab | a dagger's point into flesh | Dagger Stab (impact) | melee crunchy-arcade, hyper-real, fighting-game |
| 8 | critical-slash | the big finisher: a sword through mail | Critical Slash (whoosh only) | melee crunchy-arcade, hyper-real, fighting-game |

Every round BRACKETS the range with the same weapon and target: crunchy / arcade (crushed, bit-reduced, dry) ->
hyper-real (every layer physical, lightly crunched, a small room) -> exaggerated fighting-game (the swing swelling into
the hit, a long deep body with a sub boom, a bright crack on the contact, heavily compressed).

## What the engine is

A blow is built from the events a real one has, in order: the SWING (air past the weapon: a katana's thin edge whistles,
an axe or hammer head whumphs broad and low, a fist huffs; it STOPS on steel, stone or plate and FOLLOWS THROUGH,
slowing, through flesh); the CONTACT, which is the TARGET (flesh, cloth / leather, mail, plate, a wooden shield, stone,
ground, a steel blade) times the HIT (an edge's cut, a blunt thud, a point's stab), each pair its own recipe: a wet,
tearing cut; the skin's slap and the body's thup; mail's links bursting; plate's clang as beating pairs; a shield's
plank-disc thock and its iron rim; and what lies UNDER armor; the BODY (the weight: a kick-style pitch drop, sized by the
blow and by how much the target gives); for a CLASH, both blades ringing as real beam modes, a little out of tune with
each other and shimmering, then the edges SLIDING along each other; a whip's tip breaking the sound barrier. Then a
crunch stage like the gun's (saturation, a compressor that lets the contact through and pulls the weight up behind it,
a place, a clip, optional bits and rate cut). Nothing is layered on after the hit: the end is trimmed where it has died.

## Cues that are not the question

- **Lengths:** the melee takes include the swing BEFORE the hit (0.1-0.35 s), so the contact is not at the very start
  of the file as it is in the impact controls. A game would fire the sound that much before the hit lands, or use
  Swing 0 for the hit alone. Judge the hit as well as the whole.
- **The whoosh-only controls** (Katana Slice, Axe Chop, Critical Slash) have no contact at all; that is the finding
  this round tests, not a rendering fault.

## Round 2: punch-kick-2 (added after round 1's verdict)

Round 1's punches "lack any sort of gravity or power". \`punch-kick-2/\` has four takes of a DESIGNED punch (no control:
today's preset was heard in round 1): a long, low THUMP that dominates (a kick-drum sub ~90 -> 44 Hz, never thinned by
the target, and routed AROUND the compressor so the hit's gain reduction can neither duck nor squash it), a mid whump, a
clipped slap crack, an optional bone crunch, a swing of 60-115 ms. Takes: cinematic heavy, crunchy beat-'em-up,
fighting-game heavy, and a KICK. Same format: LISTEN.md first, KEY.md after.
`;

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  if (want === "--thump") {   // the thump meter on every take-*.wav of a folder (16-bit PCM)
    const dir = process.argv[3];
    for (const f of ["A", "B", "C", "D"].map((x) => "take-" + x + ".wav")) {
      let b; try { b = readFileSync(join(dir, f)); } catch (e) { continue; }
      let o = 12, dataAt = -1, len = 0, ch = 2; while (o < b.length) { const id = b.toString("ascii", o, o + 4), sz = b.readUInt32LE(o + 4); if (id === "fmt ") ch = b.readUInt16LE(o + 10); if (id === "data") { dataAt = o + 8; len = sz; break; } o += 8 + sz + (sz & 1); }
      const N = len / (2 * ch), L = new Float32Array(N), R = new Float32Array(N);
      for (let i = 0; i < N; i++) { L[i] = b.readInt16LE(dataAt + 2 * ch * i) / 32768; R[i] = ch > 1 ? b.readInt16LE(dataAt + 2 * ch * i + 2) / 32768 : L[i]; }
      console.log(f + "  " + fmtT(thumpMeasure(L, R, SR)));
    }
    return;
  }
  mkdirSync(OUT, { recursive: true });
  for (const nm of want ? [want] : ORDER) { if (!ROUNDS[nm]) { console.error("no round " + nm + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(nm); }
  writeFileSync(join(OUT, "README.md"), README);
  if (costLog.length) { costLog.sort((a, b) => a - b); console.log("\ncost: median " + costLog[costLog.length >> 1].toFixed(1) + " ms/s, worst " + costLog[costLog.length - 1].toFixed(1) + " ms/s (single renders)"); }
  console.log("\n-> " + OUT);
}
