/* gunfoley.mjs — PROTOTYPE of a "gun foley" synthesis engine for CrunchySFX: everything around the shot that sells a
 * gun in a game (reloads, slides, bolts, magazines, pump racks, a revolver's cylinder, dry fire, casings, ricochets and
 * bullets passing), and the CLI that renders its blind listening round.
 *
 *   node tools/proto/gunfoley.mjs                 render every round into soundtests/proto-gunfoley/<sound>/
 *   node tools/proto/gunfoley.mjs quick-reload    one round
 *   node tools/proto/gunfoley.mjs --cost          only the CPU cost: each take's model rendered 5x, ms per second of audio
 *
 * WHY. The guns' mechanics are layered impact-engine clicks (Quick Reload: two of them; Bolt-Action Reload: two clacks,
 * two noise scrapes and the modal ping), a modal ping repeated three times (Shell Casing), a sawtooth sweeping down
 * through an echo (Ricochet Zing) and the blast engine's downrange crack (Bullet Whiz). None of them models what a gun's
 * mechanism IS: small steel and polymer parts meeting, each ringing at its own modes, inside a body that thumps.
 *
 * THE PHYSICS. A firearm's mechanism is a set of PARTS (a slide, a barrel, a magazine, a catch, a bolt, a hammer, a
 * cylinder) inside a BODY (the frame / receiver / stock, held in a hand). Everything the mechanism does is one of four
 * things:
 *   CONTACT   two parts meet at speed: a half-sine force pulse of area J (the impulse) and length tau (the contact time,
 *             Hertzian: steel on steel ~20-60 us, so bright to 10 kHz; a palm on a polymer baseplate ~2-3 ms, a thump).
 *             The force drives the PART's own resonator bank (small, bright, short metallic rings: a part's modes from a
 *             table of its shape, scaled by the weapon's size) at one of two strike points (each contact lands somewhere
 *             different, so repeated hits on one part are not clones), and through the joints into the BODY (the same
 *             force, softened by the joint's compliance: the "chunk" under the "tick"). The force pulse IS the contact's
 *             spectrum (a half-sine of length tau rolls off above ~1/tau), so hardness is not a filter, it is the hit.
 *   SLIDE     a part dragged along another (a slide on its rails, a bolt in its raceway, a forend on the magazine tube):
 *             FRICTION as asperity micro-impacts (Poisson, rate ~ speed x roughness) plus a continuous rubbing noise,
 *             both driving the sliding part's own modes, so a steel bolt "shhings" and a polymer forend hushes; a little
 *             of the rub is heard directly. Speed follows a hand: accelerates, peaks, stops at the end stop.
 *   SPRING    a coil spring released or compressed (a recoil spring, a buffer spring, a striker spring, a magazine
 *             spring): a DISPERSIVE pulse running up and down the coil (the spring engine's coil: each echo a falling
 *             chirp, each echo longer than the last), plus the coil's own short ring: the "ting" / "sproing".
 *   HANDS     fabric and skin on the weapon (a grip, a palm), soft broadband rustle; natural foley has it, game foley
 *             cleans it out.
 *   The BODY: polymer (a polymer frame: low, lossy, a dull "tok"), steel (an all-steel frame or receiver: higher, it
 *   rings), wood and steel (a steel receiver bedded in a wood stock: the stock's low hollow knock under the steel).
 *   WEIGHT scales every part (bigger = lower) and the body's rigid-body thump (the whole weapon in the hand).
 *   CRISPNESS (natural .. exaggerated game foley): harder contacts (shorter tau), longer rings on the big hits, more
 *   body thump and spring, less rub and handling noise, tighter timing. The SCRIPTS are human timing (each gap jittered),
 *   scaled by TEMPO.
 * CASINGS: a casing is a thin brass tube; its lowest strong mode is the open end's ovaling (shell mode n = 2), from the
 *   ring formula f_n ~ (h / R^2) c n (n^2 - 1) / sqrt(n^2 + 1): a pistol case (R 4.8 mm, wall 0.3 mm) ~5.5 kHz with
 *   n = 3 at 2.83x, a rifle case ~4 kHz with the shoulder's mode between; each mode a degenerate PAIR split by the
 *   case's asymmetry, so it shimmers. It falls from a height (an ejection's upward kick plus the drop), lands at
 *   v = sqrt(vz^2 + 2 g H), and bounces as a tube does: v' = e v (e per surface, jittered hard because a tumbling tube
 *   turns height into spin), the next gap 2 v' / g, so the gaps shrink; a tube landing tilted hits one end then the
 *   other a few ms later (the "ti-tink"). It ends ROLLING on a hard floor (an accelerating-then-slowing patter of tiny
 *   contacts), or stopped dead in dirt. The SURFACE sets the contact time (concrete ~30 us, wood ~0.25 ms, dirt 1.5 ms),
 *   the restitution, and its own sound: concrete a grit tick, a wooden floor's hollow boards, dirt a soft thud and a
 *   spray of grit, a steel deck's own ring. A shotgun hull is a plastic tube with a brass head: lower, lossy (a "tock"),
 *   heavier, and it barely bounces.
 * RICOCHET: the bullet hits the surface (a crack and stone chips; on steel the plate rings "pang"; wood splinters; dirt
 *   a thud and a spray), then the deformed bullet TUMBLES away: a whistle at a frequency proportional to its speed
 *   (vortex shedding off a blunt deformed slug), amplitude-modulated by the tumble (tens to hundreds of Hz: the buzz),
 *   slowing under drag (v = v0 / (1 + k t)), flying past the listener on a straight line, so it is heard through the
 *   exact DOPPLER of its geometry (emission time solved for every output sample: f_obs = f_src dte/dta) and 1/r with air
 *   absorption. A slug ricocheting past at 200 m/s falls about two octaves as it goes by: the "pyeeoww" is physics.
 * BULLET PASS: supersonic, the Mach cone's N-WAVE (Whitham: duration T = 1.82 M d^1/4 dia / (c (M^2-1)^3/8 len^1/4),
 *   peak ~ d^-3/4), a ground-reflected second N-wave behind it, and the wake's turbulent hiss falling in pitch after it.
 *   Subsonic, no crack: the wake's whiz alone, through the same Doppler as the ricochet ("fffwip").
 *
 * PORTABLE SHAPE. `makeGunfoley(sr, cfg, seed)` is a pure factory like dsp.js makeBlast / makeFlow (and glass.mjs's
 * makeGlass): no DOM, no Math.random (seeded LCGs), SR in. It renders BUFFERED (a script of events writes force signals
 * into each part's excitation buffers; each part's resonator bank then runs once over the stretch where it sounds) and
 * returns { L, R, n, info, tick(drive, out) }, blast's shape. `gunfoleyCfg(st)` maps the proposed rows (GUNFOLEY_PARAMS)
 * to physics; `gunfoleyLevel(L, R)` levels a buffer (RMS 0.12 over its loudest 300 ms, peak capped 0.9) like glassLevel.
 * Anti-aliasing: every mode at or past 0.45 SR is dropped; force pulses and the N-wave are box-integrated (8x
 * oversampled) so a 30 us contact or a 4 us shock rise is never a bare sample step. Cost: `--cost`.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Only wave "gunfoley" reads
// the group, so no existing preset moves. Enums are append-only (stored as indices).
export const GF_ACTIONS = ["pistol reload", "rifle reload", "bolt cycle", "pump rack", "revolver spin", "dry fire", "casing", "ricochet", "bullet pass", "bolt reload"];
export const GF_LOADS = ["thumbed in", "stripper clip", "single round"];
export const GF_FRAMES = ["polymer", "steel", "wood and steel"];
export const GF_SURFACES = ["concrete", "wood", "dirt", "metal"];
export const GF_CASES = ["pistol brass", "rifle brass", "shotgun hull"];
export const GUNFOLEY_PARAMS = [
  ["gfAction",   "Action",        0, 8,   1,    0,    "",  "Gun foley", "enum", GF_ACTIONS],
  ["gfFrame",    "Frame",         0, 2,   1,    0,    "",  "Gun foley", "enum", GF_FRAMES],
  ["gfWeight",   "Weight",        0, 1,   0.01, 0.4,  "",  "Gun foley"],   // compact .. heavy: parts' pitch, the body's thump
  ["gfTempo",    "Tempo",         0, 1,   0.01, 0.5,  "",  "Gun foley"],   // deliberate hands .. fast hands (gaps x1.35 .. x0.65)
  ["gfCrisp",    "Crispness",     0, 1,   0.01, 0.5,  "",  "Gun foley"],   // natural .. exaggerated game foley
  ["gfSpring",   "Springs",       0, 1,   0.01, 0.5,  "",  "Gun foley"],   // the springs' ting / sproing
  ["gfHandling", "Handling",      0, 1,   0.01, 0.3,  "",  "Gun foley"],   // hands on the weapon (fabric, skin)
  ["gfRack",     "Rack the slide",0, 1,   1,    0,    "",  "Gun foley"],   // pistol: rack it (back + forward) instead of the release lever
  ["gfCock",     "Cock after",    0, 1,   1,    0,    "",  "Gun foley"],   // revolver: cock the hammer after closing
  ["gfMagDrop",  "Mag drop",      0, 1,   0.01, 0,    "",  "Gun foley"],   // the empty magazine landing (level), on Surface
  ["gfCasing",   "Ejected case",  0, 1,   0.01, 0,    "",  "Gun foley"],   // an action that ejects: the case landing (level)
  ["gfCase",     "Case",          0, 2,   1,    0,    "",  "Gun foley", "enum", GF_CASES],
  ["gfSurface",  "Surface",       0, 3,   1,    0,    "",  "Gun foley", "enum", GF_SURFACES],
  ["gfDrop",     "Drop height",   0, 1,   0.01, 0.6,  "",  "Gun foley"],   // a case falls 0.3 .. 1.6 m
  ["gfDist",     "Distance",      0, 1,   0.01, 0.2,  "",  "Gun foley"],   // bullet pass / ricochet: miss distance 0.5 .. 30 m
  ["gfSpeed",    "Bullet speed",  0, 1,   0.01, 0.75, "",  "Gun foley"],   // 220 .. 950 m/s (supersonic past ~0.18)
  ["gfPast",     "Flies past",    0, 1,   1,    1,    "",  "Gun foley"],   // ricochet: the slug flies past you (1) or away (0)
  ["gfLoad",     "Load",          0, 2,   1,    0,    "",  "Gun foley", "enum", GF_LOADS],   // bolt reload: how the rounds go in
  ["gfRounds",   "Rounds",        1, 5,   1,    5,    "",  "Gun foley"],   // bolt reload, thumbed in: how many
  ["gfSeed",     "Variation",     0, 999, 1,    0,    "",  "Gun foley"],
];
export const GUNFOLEY_DEFAULTS = Object.fromEntries(GUNFOLEY_PARAMS.map((p) => [p[0], p[5]]));

// materials: eta = loss factor at 1 kHz, tilt: eta ~ (f / 1 kHz)^tilt. Parts are HELD and JOINTED, so steel is far
// lossier than a free bar (a free steel bar ~1e-4): 0.005 gives a slide's 3 kHz mode a ~0.1 s ring, a 7 kHz one 40 ms.
const GF_MAT = {
  "steel":   { "eta": 0.005,  "tilt": 0.25 },
  "frame":   { "eta": 0.009,  "tilt": 0.2 },    // a steel frame / receiver, bolted, in a hand
  "sheet":   { "eta": 0.003,  "tilt": 0.3 },    // a sheet-steel magazine box: tinny, rings
  "alu":     { "eta": 0.006,  "tilt": 0.25 },
  "polymer": { "eta": 0.05,   "tilt": 0.1 },
  "wood":    { "eta": 0.03,   "tilt": 0.2 },
  "brass":   { "eta": 0.0012, "tilt": 0.3 },
  "hull":    { "eta": 0.04,   "tilt": 0.15 },
  "deck":    { "eta": 0.002,  "tilt": 0.3 },    // a steel deck plate
  "floor":   { "eta": 0.06,   "tilt": 0.1 },    // wooden floorboards
  "soil":    { "eta": 0.5,    "tilt": 0 },
};
// part shapes: mode frequencies (Hz, at weight 0.5) and gains
const GF_SHAPES = {
  "slide":    { "f": [2300, 3700, 5200, 7400, 9800], "a": [1, 0.8, 0.6, 0.45, 0.3], "mat": "steel" },
  "barrel":   { "f": [3500, 6100, 9400], "a": [1, 0.6, 0.35], "mat": "steel" },
  "catch":    { "f": [4300, 7400, 11000], "a": [1, 0.6, 0.4], "mat": "steel" },
  "lever":    { "f": [3900, 6800, 10500], "a": [1, 0.6, 0.4], "mat": "steel" },
  "pmag":     { "f": [850, 1600, 2500, 3600], "a": [1, 0.7, 0.5, 0.3], "mat": "polymer" },
  "smag":     { "f": [1500, 2400, 3300, 4500, 6000, 7600], "a": [1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "sheet" },
  "rmag":     { "f": [1100, 1850, 2600, 3500, 4700, 6200], "a": [1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "sheet" },
  "carrier":  { "f": [1500, 2600, 4100, 6000, 8200], "a": [1, 0.8, 0.6, 0.45, 0.3], "mat": "steel" },
  "handle":   { "f": [1900, 4300, 7000], "a": [1, 0.6, 0.4], "mat": "alu" },
  "lockclick":{ "f": [4600, 8100, 11800], "a": [1, 0.6, 0.35], "mat": "steel" },
  "bolt":     { "f": [1650, 2950, 4550, 6400, 9000], "a": [1, 0.7, 0.6, 0.4, 0.3], "mat": "steel" },
  "knob":     { "f": [3600, 7200, 10800], "a": [1, 0.5, 0.3], "mat": "steel" },
  "cocking":  { "f": [4200, 7600, 11000], "a": [1, 0.6, 0.4], "mat": "steel" },
  "ejector":  { "f": [5800, 9800, 13500], "a": [1, 0.5, 0.3], "mat": "steel" },
  "pforend":  { "f": [380, 950, 1700, 2600], "a": [1, 0.7, 0.5, 0.3], "mat": "polymer" },
  "wforend":  { "f": [420, 1050, 1800, 2900], "a": [1, 0.7, 0.5, 0.3], "mat": "wood" },
  "magtube":  { "f": [1150, 3100, 5900, 9000], "a": [1, 0.8, 0.5, 0.3], "mat": "steel" },
  "pbolt":    { "f": [1600, 2900, 4600, 6600], "a": [1, 0.8, 0.6, 0.4], "mat": "steel" },
  "bars":     { "f": [2600, 5200, 8100], "a": [1, 0.6, 0.4], "mat": "steel" },
  "lifter":   { "f": [3300, 6200, 9100], "a": [1, 0.6, 0.4], "mat": "steel" },
  "cylinder": { "f": [1700, 3100, 4600, 6400, 8700], "a": [1, 0.8, 0.6, 0.45, 0.3], "mat": "steel" },
  "latch":    { "f": [3900, 7000, 10200], "a": [1, 0.6, 0.4], "mat": "steel" },
  "stop":     { "f": [5200, 8800, 12500], "a": [1, 0.6, 0.4], "mat": "steel" },
  "crane":    { "f": [2400, 4300, 6900], "a": [1, 0.6, 0.4], "mat": "steel" },
  "hammer":   { "f": [3200, 5900, 8800, 12000], "a": [1, 0.7, 0.45, 0.3], "mat": "steel" },
  "trigger":  { "f": [3000, 5500, 8600], "a": [1, 0.6, 0.35], "mat": "steel" },
  "ptrigger": { "f": [1300, 2700, 4400], "a": [1, 0.6, 0.35], "mat": "polymer" },
  "sear":     { "f": [6000, 9800, 13600], "a": [1, 0.5, 0.3], "mat": "steel" },
  "striker":  { "f": [3800, 6900, 10400], "a": [1, 0.6, 0.35], "mat": "steel" },
  "round":    { "f": [3300, 4900, 9100, 12800], "a": [1, 0.6, 0.5, 0.3], "mat": "brass" },     // a LOADED rifle round (held: damped)
  "lips":     { "f": [3300, 6100, 9200], "a": [1, 0.6, 0.4], "mat": "steel" },                 // the magazine's feed lips
  "follower": { "f": [1700, 3500, 5600], "a": [1, 0.6, 0.35], "mat": "steel" },
  "clip":     { "f": [2100, 3700, 5600, 7900, 10400], "a": [1, 0.9, 0.7, 0.5, 0.35], "mat": "sheet" },   // a stripper clip: sheet steel, tinny
};
// the bodies (frame index): [{f, a, mat}] lists at weight 0.5; plus the rigid-body thump (the whole weapon in a hand)
const GF_BODIES = [
  [{ "f": [260, 470, 760, 1150, 1700, 2400], "a": [1, 0.8, 0.6, 0.45, 0.3, 0.2], "mat": "polymer" }],
  [{ "f": [620, 1150, 1850, 2700, 3800, 5100], "a": [1, 0.8, 0.7, 0.55, 0.4, 0.3], "mat": "frame" }],
  [{ "f": [170, 330, 560, 880], "a": [1, 0.8, 0.6, 0.4], "mat": "wood" }, { "f": [700, 1300, 2100, 3100, 4300], "a": [0.8, 0.7, 0.6, 0.45, 0.3], "mat": "frame" }],
];
const GF_GRAV = 9.81, GF_C = 343, GF_MAX_T60 = 3;

const gfClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function gfRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gfPanGains = (p) => { const a = (gfClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
const gfT60 = (m, f, mul) => Math.min(GF_MAX_T60, 2.2 / (m["eta"] * Math.pow(f / 1000, m["tilt"]) * f) * mul);

// knobs -> physics
export function gunfoleyCfg(st) {
  const g = (k) => (st[k] == null ? GUNFOLEY_DEFAULTS[k] : st[k]);
  const crisp = gfClamp(g("gfCrisp"), 0, 1), w = gfClamp(g("gfWeight"), 0, 1);
  return {
    "dur": st.duration || 0, "width": st.width == null ? 0.5 : st.width,
    "action": gfClamp(Math.round(g("gfAction")), 0, GF_ACTIONS.length - 1),
    "frame": gfClamp(Math.round(g("gfFrame")), 0, GF_FRAMES.length - 1),
    "weight": w, "size": 1.25 - 0.5 * w,                                   // frequency scale: compact 1.25x .. heavy 0.75x
    "tScale": 1.35 - 0.7 * gfClamp(g("gfTempo"), 0, 1),
    "crisp": crisp,
    "tauMul": 1.6 * Math.pow(0.5 / 1.6, crisp),                          // contact times x1.6 (natural) .. x0.5 (game)
    "ringMul": 0.9 + 0.5 * crisp,                                        // the big hits ring a little longer in game foley
    "rub": 1.15 - 0.6 * crisp,                                           // slides and scrapes
    "thump": (0.3 + 0.7 * w) * (0.55 + 0.9 * crisp),                     // the weapon's rigid-body thump
    "jitter": 0.16 - 0.12 * crisp,                                       // human timing spread
    "spring": g("gfSpring") * (0.7 + 0.6 * crisp),
    "handling": g("gfHandling") * (1 - 0.7 * crisp),
    "rack": g("gfRack") >= 0.5, "cock": g("gfCock") >= 0.5,
    "magDrop": g("gfMagDrop"), "casing": g("gfCasing"),
    "caseType": gfClamp(Math.round(g("gfCase")), 0, GF_CASES.length - 1),
    "surface": gfClamp(Math.round(g("gfSurface")), 0, GF_SURFACES.length - 1),
    "dropH": 0.3 + 1.3 * g("gfDrop"),
    "dist": 0.5 * Math.pow(60, g("gfDist")),                             // 0.5 .. 30 m
    "speed": 220 + 730 * g("gfSpeed"),                                   // m/s
    "past": g("gfPast") >= 0.5,
    "load": gfClamp(Math.round(g("gfLoad")), 0, GF_LOADS.length - 1), "rounds": gfClamp(Math.round(g("gfRounds")), 1, 5),
    "seed": Math.round(g("gfSeed")),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// primitives (a render context G = { sr, n, rnd, parts, D: [L, R] direct, cfg, info })

// a part: a resonator bank with two strike points (each mode's gain differs between them)
function gfPart(G, name, shape, opt) {
  opt = opt || {};
  const sh = typeof shape === "string" ? GF_SHAPES[shape] : shape, M = GF_MAT[opt.mat || sh["mat"]], rnd = G.rnd;
  const sc = (opt.scale == null ? G.cfg["size"] : opt.scale), gain = opt.gain == null ? 1 : opt.gain;
  const modes = [];
  sh["f"].forEach((f0, k) => {
    const f = f0 * sc * (1 + 0.012 * (rnd() * 2 - 1));
    if (f >= 0.45 * G.sr) return;
    const a = sh["a"][k] * gain;
    const t60 = gfT60(M, f, opt.ringMul == null ? 1 : opt.ringMul);
    modes.push({ f, t60, g0: a * (0.4 + 0.6 * rnd()) * (rnd() < 0.5 ? -1 : 1), g1: a * (0.4 + 0.6 * rnd()) * (rnd() < 0.5 ? -1 : 1) });
    if (opt.split) {   // a degenerate pair (a tube's ovaling mode): the twin a little higher, weaker
      const f2 = f * (1 + opt.split * (0.5 + rnd()));
      if (f2 < 0.45 * G.sr) modes.push({ f: f2, t60: t60 * 0.9, g0: a * 0.5 * (0.4 + 0.6 * rnd()), g1: -a * 0.5 * (0.4 + 0.6 * rnd()) });
    }
  });
  const p = { name, modes, pan: (opt.pan == null ? (rnd() * 2 - 1) * 0.25 : opt.pan) * G.cfg["width"], x0: null, x1: null, damp: [], energy: 0, cat: opt.cat || "mech" };
  G.parts.push(p);
  return p;
}
// a half-sine force pulse of area J and length tau, box-integrated (8x) into the part's two strike points
function gfForceRaw(G, p, t, J, tau, pos) {
  if (!p.x0) { p.x0 = new Float32Array(G.n); p.x1 = new Float32Array(G.n); }
  const sr = G.sr; tau = Math.max(tau, 0.5 / sr);
  const OS = 8, i0 = Math.max(0, Math.floor(t * sr)), i1 = Math.min(G.n, Math.ceil((t + tau) * sr) + 1), pk = J * Math.PI / (2 * tau);
  const w0 = 1 - pos, w1 = pos;
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const u = (i + (k + 0.5) / OS) / sr - t; if (u >= 0 && u < tau) s += Math.sin(Math.PI * u / tau); }
    const v = pk * s / (OS * sr);
    p.x0[i] += v * w0; p.x1[i] += v * w1;
  }
}
// a contact on a part: the part rings, the body takes the same impulse through the joint (softened), and a crisp hit
// carries its own air click. J is the impulse (relative), tau the contact time BEFORE crispness.
function gfHit(G, p, t, J, tau, opt) {
  opt = opt || {};
  const c = G.cfg, rnd = G.rnd, tt = tau * c["tauMul"];
  gfForceRaw(G, p, t, J, tt, rnd());
  const couple = opt.couple == null ? 0.6 : opt.couple;
  if (couple > 0 && G.body) for (const b of G.body) gfForceRaw(G, b, t + 0.0002, J * couple, tt + 0.00025 + 0.0004 * (1 - c["crisp"]), rnd());
  if (couple > 0 && G.thump && J * couple > 0.2) gfForceRaw(G, G.thump, t + 0.0003, J * couple * c["thump"], 0.0015 + tt, 0.5);
  if (opt.click !== 0) gfClick(G, t, J * (opt.click == null ? 0.05 : opt.click) * (0.5 + c["crisp"]), Math.max(tt, 1.2 / G.sr), p.pan);
  if (G.info) G.info.events.push([Math.round(t * 1000), opt.name || p.name]);
}
// after time t the part's rings decay faster (it came to rest on something, a hand closed on it)
function gfDamp(p, t, mul) { p.damp.push([t, mul]); p.damp.sort((a, b) => a[0] - b[0]); }
// the direct air click of a contact: the derivative of a half-sine force (glass.mjs glClick)
function gfClick(G, t0, amp, tau, pan, cat) {
  const [L, R] = G.cat(cat || "click"), sr = G.sr; tau = Math.max(tau, 1.5 / sr);
  const OS = 8, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(G.n, Math.ceil((t0 + tau) * sr) + 1);
  const [gl, gr] = gfPanGains(pan);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const u = (i + (k + 0.5) / OS) / sr - t0; if (u >= 0 && u < tau) s += Math.cos(Math.PI * u / tau); }
    const v = amp * s / OS; L[i] += v * gl; R[i] += v * gr;
  }
}
// band-limited noise state: a one-pole HP at lo into a one-pole LP at hi (glass.mjs glNoise's filter)
function gfBand(sr, lo, hi) { return { aH: Math.exp(-2 * Math.PI * Math.min(lo, 0.45 * sr) / sr), aL: Math.exp(-2 * Math.PI * Math.min(hi, 0.45 * sr) / sr), h: 0, l: 0, l2: 0 }; }
function gfBandTick(b, x) { b.h = x + (b.h - x) * b.aH; const hp = x - b.h; b.l = hp + (b.l - hp) * b.aL; b.l2 = b.l + (b.l2 - b.l) * b.aL; return b.l2; }
// a hand's speed profile over u in [0, 1]: "pull" accelerates and stops at the end stop, "push" is spring-driven (fast,
// accelerating to the stop), "even" a free slide
function gfProfile(kind, u) {
  if (kind === "push") return Math.pow(u, 0.6) * (u < 0.92 ? 1 : (1 - u) / 0.08 * 0.5 + 0.5);
  if (kind === "even") return Math.sin(Math.PI * u) * 0.5 + 0.5 * Math.min(1, u * 8) * Math.min(1, (1 - u) * 8);
  return Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.85 + 0.075)), 0.8);   // pull
}
// SLIDE: part p dragged for dur s from t0 at relative force level J; micro-impacts + rub drive p's modes (and a little
// of the body), with the rub's direct hiss in [lo, hi]
function gfSlide(G, p, t0, dur, J, opt) {
  opt = opt || {};
  const sr = G.sr, rnd = G.rnd, c = G.cfg, i0 = Math.max(0, Math.floor(t0 * sr)), len = Math.min(G.n - i0, Math.ceil(dur * sr));
  if (len <= 0) return;
  if (!p.x0) { p.x0 = new Float32Array(G.n); p.x1 = new Float32Array(G.n); }
  const lvl = J * c["rub"], rough = opt.rough == null ? 0.5 : opt.rough, kind = opt.prof || "pull";
  const rate = (opt.rate || 2500) * (0.4 + rough);          // asperity contacts per second at full speed
  const bEx = gfBand(sr, opt.exLo || 600, opt.exHi || 12000), bD = gfBand(sr, opt.lo || 1500, opt.hi || 9000);
  const [gl, gr] = gfPanGains(p.pan), hiss = (opt.hiss == null ? 0.25 : opt.hiss) * lvl, b = G.body ? G.body[G.body.length - 1] : null;
  const bc = opt.couple == null ? 0.15 : opt.couple, [DL, DR] = G.cat("rub");
  let pos = rnd(), nextGrain = 0;
  for (let k = 0; k < len; k++) {
    const u = k / len, v = gfProfile(kind, u), fade = Math.min(1, k / (0.003 * sr), (len - k) / (0.002 * sr));
    const x = gfBandTick(bEx, rnd() * 2 - 1) * v * lvl * 0.004 * fade;
    pos += (rnd() - 0.5) * 0.02; pos = gfClamp(pos, 0, 1);
    p.x0[i0 + k] += x * (1 - pos); p.x1[i0 + k] += x * pos;
    if (b && bc > 0) { if (!b.x0) { b.x0 = new Float32Array(G.n); b.x1 = new Float32Array(G.n); } b.x0[i0 + k] += x * bc; }
    // asperities: Poisson, rate ~ speed
    nextGrain -= v * rate / sr;
    if (nextGrain <= 0) {
      nextGrain = -Math.log(Math.max(1e-9, rnd()));
      const a = lvl * 0.02 * (0.2 + Math.pow(rnd(), 3) * 1.6) * v;
      if (rnd() < 0.5) p.x0[i0 + k] += a; else p.x1[i0 + k] += a;
    }
    const d = gfBandTick(bD, rnd() * 2 - 1) * v * hiss * fade;
    DL[i0 + k] += d * gl; DR[i0 + k] += d * gr;
  }
  if (G.info) G.info.events.push([Math.round(t0 * 1000), (opt.name || p.name) + " slides " + Math.round(dur * 1000) + " ms"]);
}
// SPRING: a coil released or compressed. A dispersive pulse on the coil (each echo a falling chirp fHi -> f1 that grows
// longer with every round trip, the spring engine's coil) plus the coil's own short ring; `period` is the round trip.
function gfSpring(G, t0, amp, opt) {
  if (!(amp > 0)) return;
  opt = opt || {};
  const sr = G.sr, rnd = G.rnd, [L, R] = G.cat("spring");
  const f1 = (opt.f1 || 2200) * (0.95 + 0.1 * rnd()), fHi = Math.min(0.42 * sr, f1 * (opt.span || 4)), period = opt.period || 0.006;
  const nE = opt.echoes || 8, dec = opt.decay || 0.72, disp = opt.disp || 0.0015;
  const [gl, gr] = gfPanGains(opt.pan == null ? 0 : opt.pan);
  for (let e = 0; e < nE; e++) {
    const te = t0 + e * period * (1 + 0.04 * (rnd() - 0.5)), clen = disp * (1 + e * 0.8), ae = amp * Math.pow(dec, e) / Math.sqrt(1 + e * 0.8);
    const i0 = Math.floor(te * sr), nl = Math.ceil(clen * sr);
    let ph = rnd() * 6.283;
    for (let k = 0; k < nl && i0 + k < G.n; k++) {
      if (i0 + k < 0) continue;
      const u = k / nl, f = fHi * Math.pow(f1 / fHi, u), env = Math.sin(Math.PI * u);
      ph += 2 * Math.PI * f / sr;
      const v = ae * env * Math.sin(ph); L[i0 + k] += v * gl; R[i0 + k] += v * gr;
    }
  }
  // the coil's own ring: a few stretched partials, buzzing at the round trip
  const ring = opt.ring == null ? 0.5 : opt.ring, rl = opt.ringLen || 0.12;
  if (ring > 0) {
    const i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(G.n - i0, Math.ceil(rl * 2.2 * sr)), fb = 1 / period;
    const parts = [1, 2.15, 3.4].map((q, k) => ({ f: f1 * 0.6 * q * (1 + 0.01 * rnd()), a: 1 / (k + 1), ph: rnd() * 6.283 }));
    for (let k = 0; k < n; k++) {
      const t = k / sr, env = Math.exp(-6.9 * t / rl) * Math.min(1, k / (0.001 * sr)), buzz = 0.6 + 0.4 * Math.cos(2 * Math.PI * fb * t);
      let s = 0; for (const q of parts) { if (q.f < 0.45 * sr) s += q.a * Math.sin(q.ph + 2 * Math.PI * q.f * t); }
      const v = amp * ring * 0.5 * env * buzz * s; L[i0 + k] += v * gl; R[i0 + k] += v * gr;
    }
  }
  if (G.info) G.info.events.push([Math.round(t0 * 1000), (opt.name || "spring")]);
}
// HANDS: a grip or a palm on the weapon (fabric and skin), soft broadband rustle with a few skin ticks
function gfHands(G, t0, len, amp) {
  if (!(amp > 0)) return;
  const sr = G.sr, rnd = G.rnd, i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(G.n - i0, Math.ceil(len * sr));
  const b = gfBand(sr, 250, 3500), [gl, gr] = gfPanGains((rnd() * 2 - 1) * 0.3 * G.cfg["width"]), [HL, HR] = G.cat("hands");
  let g = 0, tgt = 0;
  for (let k = 0; k < n; k++) {
    if (k % 256 === 0) tgt = Math.pow(rnd(), 2);
    g += (tgt - g) * 0.004;
    const u = k / n, env = Math.sin(Math.PI * u), v = gfBandTick(b, rnd() * 2 - 1) * amp * 0.25 * env * (0.3 + g);
    HL[i0 + k] += v * gl; HR[i0 + k] += v * gr;
  }
}
// a band noise burst with an exponential decay (grit, dust, splinters)
function gfBurst(G, t0, len, tau, amp, lo, hi, pan) {
  const [BL, BR] = G.cat("grit"), sr = G.sr, rnd = G.rnd, i0 = Math.max(0, Math.floor(t0 * sr)), n = Math.min(G.n - i0, Math.ceil(len * sr));
  if (n <= 0) return;
  const b = gfBand(sr, lo, hi), [gl, gr] = gfPanGains(pan), d = Math.exp(-1 / (tau * sr));
  let e = amp;
  for (let k = 0; k < n; k++) { const v = gfBandTick(b, rnd() * 2 - 1) * e * Math.min(1, k / 12); BL[i0 + k] += v * gl; BR[i0 + k] += v * gr; e *= d; }
}
// run every part's resonator bank over the stretch where it is excited (plus its ring), into G's stereo mix
function gfRunParts(G) {
  const sr = G.sr, n = G.n;
  for (const p of G.parts) {
    if (!p.x0) continue;
    const [L, R] = G.cat(p.cat);
    let a = -1, b = -1;
    for (let i = 0; i < n; i++) if (p.x0[i] !== 0 || p.x1[i] !== 0) { a = i; break; }
    if (a < 0) continue;
    for (let i = n - 1; i >= a; i--) if (p.x0[i] !== 0 || p.x1[i] !== 0) { b = i; break; }
    const [gl, gr] = gfPanGains(p.pan);
    let e = 0;
    for (const m of p.modes) {
      const life = Math.ceil(Math.min(GF_MAX_T60, m.t60) * sr), end = Math.min(n, b + life + 1);
      const w = 2 * Math.PI * m.f / sr, cw = Math.cos(w), sw = Math.sin(w);
      // damping segments: [index, t60 multiplier]
      const segs = [[a, 1]];
      for (const [t, mul] of p.damp) { const i = Math.round(t * sr); if (i > a && i < end) segs.push([i, mul]); }
      let zr = 0, zi = 0;
      for (let s = 0; s < segs.length; s++) {
        const i0 = segs[s][0], i1 = s + 1 < segs.length ? segs[s + 1][0] : end;
        const r = Math.exp(-6.907755 / (Math.max(0.002, m.t60 * segs[s][1]) * sr)), c = cw * r, si = sw * r;
        for (let i = i0; i < i1; i++) {
          const nr = zr * c - zi * si + m.g0 * p.x0[i] + m.g1 * p.x1[i]; zi = zr * si + zi * c; zr = nr;
          L[i] += zi * gl; R[i] += zi * gr; e += zi * zi;
        }
      }
    }
    p.energy = e / sr;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// casings and surfaces

// the floor a thing lands on: a part (its modes) plus its contact time, restitution and grit
const GF_FLOORS = [
  { "tau": 0.00003, "e": 0.45, "roll": 1,   "grit": 0.5, "part": null,                                                                                           "name": "concrete" },
  { "tau": 0.00025, "e": 0.35, "roll": 0.6, "grit": 0.1, "part": { "f": [180, 340, 610, 1050, 1600], "a": [1, 0.8, 0.6, 0.4, 0.25], "mat": "floor" },          "name": "wood" },
  { "tau": 0.0015,  "e": 0.07, "roll": 0,   "grit": 1,   "part": { "f": [90, 160, 250], "a": [1, 0.6, 0.3], "mat": "soil" },                                    "name": "dirt" },
  { "tau": 0.00002, "e": 0.55, "roll": 1.2, "grit": 0.1, "part": { "f": [310, 760, 1290, 1980, 2850, 3900, 5200, 6800], "a": [0.7, 0.9, 1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "deck" }, "name": "metal" },
];
// the case's modes (Hz): the open end's ovaling pair (n = 2), the shoulder / head, n = 3
const GF_CASE_SHAPES = [
  { "f": [5500, 8300, 15500], "a": [1, 0.35, 0.45], "mat": "brass", "split": 0.004, "e": 1,   "mass": 0.45, "name": "pistol case" },
  { "f": [3900, 5600, 11000, 15200], "a": [1, 0.55, 0.5, 0.3], "mat": "brass", "split": 0.003, "e": 0.95, "mass": 0.8, "name": "rifle case" },
  { "f": [1250, 2600, 4100], "a": [1, 0.6, 0.35], "mat": "hull", "split": 0, "e": 0.6, "mass": 1, "name": "shotgun hull", "head": { "f": [6200, 9800], "a": [1, 0.5], "mat": "brass" } },
];
// a case lands at tLand with impact speed vImp: bounces with shrinking gaps, a tilted tube's second end, then rolls (hard
// floors) or stops dead (dirt). `lvl` scales it. Returns the time it comes to rest.
function gfCaseDrop(G, tLand, ci, si, vImp, lvl, pan) {
  const rnd = G.rnd, F = GF_FLOORS[si], C = GF_CASE_SHAPES[ci], sr = G.sr;
  const cs = gfPart(G, C["name"], C, { scale: 0.96 + 0.08 * rnd(), split: C["split"], pan, gain: lvl, cat: "case" });
  const head = C["head"] ? gfPart(G, "hull head", C["head"], { scale: 1, pan, gain: lvl * 0.4, cat: "case" }) : null;
  let fl = F["part"] ? (G.floors[si] || (G.floors[si] = gfPart(G, F["name"] + " floor", F["part"], { scale: 1, pan: pan * 0.6, gain: 1, cat: "floor" }))) : null;
  let t = tLand, v = vImp, last = t;
  const jit = (x) => x * (0.75 + 0.5 * rnd());
  for (let k = 0; k < 14 && t < G.n / sr - 0.03; k++) {
    const amp = lvl * Math.min(1.4, v / 4) * (0.7 + 0.3 * rnd());
    const tau = F["tau"] * (0.8 + 0.4 * rnd()) * (C["mat"] === "hull" ? 3 : 1);
    gfForceRaw(G, cs, t, amp, tau, rnd());
    if (head) gfForceRaw(G, head, t + 0.0003 * rnd(), amp * 0.6, tau, rnd());
    if (fl) gfForceRaw(G, fl, t, amp * C["mass"] * (si === 2 ? 2.5 : 1), tau * 2 + 0.0002, rnd());
    if (C["mat"] !== "hull") gfClick(G, t, amp * 0.03 * (si === 2 ? 0.3 : 1), Math.max(tau, 1.5 / sr), pan, "case");
    if (F["grit"] > 0) gfBurst(G, t, 0.03 + 0.05 * (si === 2 ? 1 : 0), si === 2 ? 0.012 : 0.003, amp * F["grit"] * (si === 2 ? 0.05 : 0.025), si === 2 ? 900 : 2500, si === 2 ? 6000 : 12000, pan);
    // a tilted tube: the other end lands a few ms later
    if (k < 6 && rnd() < 0.75 && si !== 2) {
      const dt = 0.003 + 0.016 * rnd(), a2 = amp * (0.25 + 0.55 * rnd());
      gfForceRaw(G, cs, t + dt, a2, tau, rnd());
      if (fl) gfForceRaw(G, fl, t + dt, a2 * C["mass"], tau * 2 + 0.0002, rnd());
    }
    if (G.info) G.info.landings.push(Math.round(t * 1000));
    last = t;
    const e = gfClamp(F["e"] * C["e"] * (0.55 + 0.9 * rnd()), 0.02, 0.85), vn = e * v;
    if (vn < 0.12) break;
    t += 2 * vn / GF_GRAV; v = vn;
  }
  // rolling (a tube on a hard floor): tiny contacts over grit and seams, quickening then slowing
  if (F["roll"] > 0 && C["mat"] !== "hull" || (F["roll"] > 0 && C["mat"] === "hull" && rnd() < 0.5)) {
    const rollLen = jit(0.25 + 0.5 * F["roll"]) * (C["mat"] === "hull" ? 0.5 : 1);
    let tr = last + 0.02 + 0.03 * rnd(), rate = 35 + 30 * rnd();
    const tEnd = Math.min(G.n / sr - 0.03, last + rollLen);
    while (tr < tEnd) {
      const u = (tr - last) / rollLen, a = lvl * 0.05 * (1 - u) * (0.3 + 0.7 * Math.pow(rnd(), 2));
      gfForceRaw(G, cs, tr, a, F["tau"] * 2, rnd());
      if (F["grit"] > 0) gfBurst(G, tr, 0.004, 0.001, a * F["grit"] * 0.1, 3000, 12000, pan);
      tr += 1 / (rate * (1 - 0.7 * u)) * (0.5 + rnd());
    }
    last = tEnd;
  }
  gfDamp(cs, last + 0.01, 0.12);   // at rest: the floor takes the ring
  if (si === 2) gfDamp(cs, tLand + 0.003, 0.2);   // dirt: embedded at the first landing
  return last;
}

// ---------------------------------------------------------------------------------------------------------------------
// flyby geometry: a source on a straight line (closest point at distance dmin, passing it at time 0 with speed v(t) =
// v0 / (1 + k t), t from tStart), the listener at the origin. For each OUTPUT sample, the emission time te solving
// te + r(te) / c = ta (subsonic, so monotonic), the distance r and the Doppler factor dte/dta. Output starts at ta0.
function gfFlyby(sr, n, ta0, o) {
  const v0 = o.v0, k = o.k || 0, dmin = o.dmin, xs = o.x0;   // along-track position at te = 0 (negative: still coming)
  const sOf = (te) => (k > 0 ? v0 / k * Math.log(1 + k * te) : v0 * te), vOf = (te) => v0 / (1 + k * te);
  const te = new Float64Array(n), r = new Float64Array(n), dop = new Float64Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const ta = ta0 + i / sr;
    for (let it = 0; it < 4; it++) {
      const x = xs + sOf(Math.max(0, t)), rr = Math.sqrt(x * x + dmin * dmin), f = t + rr / GF_C - ta;
      const dr = t > 0 ? x / rr * vOf(t) : 0, d = 1 + dr / GF_C;
      t -= f / d;
    }
    const x = xs + sOf(Math.max(0, t)), rr = Math.sqrt(x * x + dmin * dmin);
    te[i] = t; r[i] = rr; dop[i] = 1 / (1 + (x / rr) * vOf(Math.max(0, t)) / GF_C);
  }
  return { te, r, dop, vOf, sOf };
}

// ---------------------------------------------------------------------------------------------------------------------
// the actions

const GF_SCRIPTS = {};
// a gap in the script: base seconds x tempo, jittered by human timing
const gfGap = (G, base) => base * G.cfg["tScale"] * (1 + G.cfg["jitter"] * (G.rnd() * 2 - 1));
const S_TAU = 0.00004;   // steel on steel contact (Hertz, gram-scale parts at a few m/s)

GF_SCRIPTS["pistol reload"] = (G) => {
  const c = G.cfg, poly = c["frame"] === 0;
  const slide = gfPart(G, "slide", "slide", { gain: 0.8, ringMul: c["ringMul"] }), barrel = gfPart(G, "barrel", "barrel", { gain: 0.5 });
  const mag = gfPart(G, "magazine", poly ? "pmag" : "smag", { gain: poly ? 0.9 : 0.7 }), cat = gfPart(G, "mag catch", "catch", { gain: 0.35 });
  const lever = gfPart(G, "slide stop", "lever", { gain: 0.4 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.12, c["handling"] * 0.5);
  gfHit(G, cat, t, 0.12, S_TAU, { name: "mag release", couple: 0.4 });
  gfSlide(G, mag, t + 0.008, 0.065 * c["tScale"], 0.25, { rough: poly ? 0.25 : 0.6, prof: "push", lo: poly ? 700 : 1500, hi: poly ? 5000 : 9000, hiss: 0.15, name: "mag out" });
  if (c["magDrop"] > 0) {   // the empty magazine falls ~1 m and lands
    const tl = t + 0.008 + 0.45, fl = GF_FLOORS[c["surface"]];
    const box = gfPart(G, "dropped magazine", poly ? "pmag" : "smag", { gain: c["magDrop"] * 0.6, pan: -0.4 });
    let tt = tl, v = 4.4;
    for (let k = 0; k < 3 && v > 0.3; k++) { gfForceRaw(G, box, tt, v / 4.4, Math.max(fl["tau"], 0.0001) * (poly ? 4 : 1.5), G.rnd()); gfClick(G, tt, 0.02 * v / 4.4 * c["magDrop"], 0.0002, -0.4); G.info.events.push([Math.round(tt * 1000), "mag lands"]); const e = fl["e"] * (poly ? 0.6 : 0.8) * (0.6 + 0.8 * G.rnd()); v *= e; tt += 2 * v / GF_GRAV; }
    if (fl["grit"] > 0) gfBurst(G, tl, 0.04, 0.008, 0.02 * c["magDrop"] * fl["grit"], 1500, 9000, -0.4);
    gfDamp(box, tt + 0.02, 0.2);
  }
  t += gfGap(G, 0.42);
  gfHands(G, t - 0.06, 0.12, c["handling"]);
  gfSlide(G, mag, t, 0.055 * c["tScale"], 0.3, { rough: poly ? 0.25 : 0.6, prof: "pull", lo: poly ? 700 : 1500, hi: poly ? 5000 : 9000, hiss: 0.15, name: "mag in" });
  t += 0.06 * c["tScale"];
  gfHit(G, mag, t, 0.25, 0.0025, { name: "palm on the baseplate", couple: 0.9, click: 0 });
  gfHit(G, mag, t + 0.0015, 0.6, poly ? 0.0003 : 0.00008, { name: "mag bottoms in the well", couple: 0.6 });
  gfHit(G, cat, t + 0.004, 0.35, S_TAU, { name: "catch snaps", couple: 0.3 });
  gfSpring(G, t + 0.002, 0.02 * c["spring"], { f1: 2600, period: 0.0011, echoes: 6, decay: 0.6, disp: 0.0006, ring: 0.3, ringLen: 0.04, name: "mag spring" });
  if (c["rack"]) {
    t += gfGap(G, 0.3);
    gfHands(G, t - 0.03, 0.08, c["handling"] * 0.7);
    const pull = 0.075 * c["tScale"];
    gfSlide(G, slide, t, pull, 0.35, { rough: 0.55, prof: "pull", name: "slide back" });
    gfSpring(G, t, 0.012 * c["spring"], { f1: 1800, period: 0.004, echoes: 6, disp: 0.002, ring: 0.2, name: "recoil spring compresses" });
    t += pull;
    gfHit(G, slide, t, 0.5, S_TAU, { name: "slide hits the stop", couple: 0.6 });
    t += gfGap(G, 0.05);
    gfSlide(G, slide, t, 0.024, 0.3, { rough: 0.55, prof: "push", name: "slide forward" });
    gfSlide(G, mag, t + 0.006, 0.012, 0.15, { rough: 0.6, prof: "even", hiss: 0.05, name: "round strips" });
    gfSpring(G, t, 0.03 * c["spring"], { f1: 2000, period: 0.0035, echoes: 8, disp: 0.0015, ring: 0.5, ringLen: 0.09, name: "recoil spring releases" });
    t += 0.025;
  } else {
    t += gfGap(G, 0.24);
    gfHands(G, t - 0.02, 0.05, c["handling"] * 0.5);
    gfHit(G, lever, t, 0.22, S_TAU, { name: "slide release", couple: 0.3 });
    gfSlide(G, slide, t + 0.002, 0.022, 0.3, { rough: 0.55, prof: "push", name: "slide forward" });
    gfSlide(G, mag, t + 0.008, 0.012, 0.15, { rough: 0.6, prof: "even", hiss: 0.05, name: "round strips" });
    gfSpring(G, t + 0.002, 0.03 * c["spring"], { f1: 2000, period: 0.0035, echoes: 8, disp: 0.0015, ring: 0.5, ringLen: 0.09, name: "recoil spring releases" });
    t += 0.024;
  }
  gfHit(G, slide, t, 1.0, S_TAU, { name: "slide slams into battery", couple: 0.9 });
  gfHit(G, barrel, t + 0.003, 0.45, S_TAU, { name: "barrel locks", couple: 0.3 });
  return t + 0.35;
};

GF_SCRIPTS["rifle reload"] = (G) => {
  const c = G.cfg, poly = c["frame"] === 0;
  const mag = gfPart(G, "magazine", poly ? "pmag" : "rmag", { gain: poly ? 0.9 : 0.8, scale: c["size"] * (poly ? 0.85 : 1) });
  const cat = gfPart(G, "mag catch", "catch", { gain: 0.35 }), car = gfPart(G, "bolt carrier", "carrier", { gain: 0.9, ringMul: c["ringMul"] });
  const hdl = gfPart(G, "charging handle", "handle", { gain: 0.5 }), lk = gfPart(G, "bolt lock", "lockclick", { gain: 0.4 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.12, c["handling"] * 0.5);
  gfHit(G, cat, t, 0.15, S_TAU, { name: "mag release", couple: 0.4 });
  gfSlide(G, mag, t + 0.006, 0.085 * c["tScale"], 0.3, { rough: 0.7, prof: "push", lo: 1200, hi: 8000, hiss: 0.2, name: "mag out" });
  t += gfGap(G, 0.5);
  gfHands(G, t - 0.08, 0.14, c["handling"]);
  gfSlide(G, mag, t, 0.07 * c["tScale"], 0.35, { rough: 0.7, prof: "pull", lo: 1200, hi: 8000, hiss: 0.2, name: "mag in" });
  t += 0.075 * c["tScale"];
  gfHit(G, mag, t, 0.3, 0.003, { name: "palm on the baseplate", couple: 1, click: 0 });
  gfHit(G, mag, t + 0.002, 0.7, poly ? 0.0003 : 0.00008, { name: "mag bottoms in the well", couple: 0.6 });
  gfHit(G, cat, t + 0.005, 0.4, S_TAU, { name: "catch snaps", couple: 0.3 });
  gfSpring(G, t + 0.003, 0.025 * c["spring"], { f1: 2200, period: 0.0014, echoes: 7, decay: 0.62, disp: 0.0007, ring: 0.35, ringLen: 0.05, name: "mag spring" });
  t += gfGap(G, 0.32);
  gfHands(G, t - 0.03, 0.08, c["handling"] * 0.7);
  gfHit(G, hdl, t, 0.2, S_TAU, { name: "charging handle unlatches", couple: 0.3 });
  const pull = 0.11 * c["tScale"];
  gfSlide(G, car, t + 0.005, pull, 0.4, { rough: 0.5, prof: "pull", name: "carrier back" });
  gfSpring(G, t + 0.005, 0.025 * c["spring"], { f1: 1500, period: 0.009, echoes: 9, decay: 0.8, disp: 0.003, ring: 0.3, ringLen: 0.12, name: "buffer spring compresses" });
  t += pull + 0.005;
  gfHit(G, car, t, 0.5, S_TAU, { name: "carrier hits the buffer", couple: 0.6 });
  t += gfGap(G, 0.06);
  gfSlide(G, car, t, 0.03, 0.35, { rough: 0.5, prof: "push", name: "carrier forward" });
  gfSpring(G, t, 0.06 * c["spring"], { f1: 1400, period: 0.008, echoes: 12, decay: 0.82, disp: 0.003, ring: 0.6, ringLen: 0.22, name: "buffer spring sproings" });
  t += 0.031;
  gfHit(G, car, t, 1.0, S_TAU, { name: "carrier slams home", couple: 0.9 });
  gfHit(G, lk, t + 0.004, 0.45, S_TAU, { name: "bolt locks", couple: 0.3 });
  gfHit(G, hdl, t + 0.016, 0.3, S_TAU, { name: "handle latches", couple: 0.3 });
  return t + 0.4;
};

GF_SCRIPTS["bolt cycle"] = (G) => {
  const c = G.cfg;
  const bolt = gfPart(G, "bolt", "bolt", { gain: 0.9, ringMul: c["ringMul"] }), knob = gfPart(G, "bolt knob", "knob", { gain: 0.4 });
  const ck = gfPart(G, "cocking piece", "cocking", { gain: 0.4 }), ej = gfPart(G, "ejector", "ejector", { gain: 0.3 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.1, c["handling"]);
  gfHit(G, knob, t, 0.25, 0.0004, { name: "hand on the knob", couple: 0.3 });
  const cam = 0.06 * c["tScale"];
  gfSlide(G, ck, t + 0.004, cam, 0.25, { rough: 0.6, prof: "even", name: "bolt up (cocking cam)" });
  gfSpring(G, t + 0.004, 0.01 * c["spring"], { f1: 3000, period: 0.003, echoes: 5, disp: 0.001, ring: 0.2, ringLen: 0.05, name: "firing pin spring compresses" });
  t += cam + 0.004;
  gfHit(G, ck, t, 0.35, S_TAU, { name: "cocks", couple: 0.4 });
  t += gfGap(G, 0.05);
  const back = 0.12 * c["tScale"];
  gfSlide(G, bolt, t, back, 0.45, { rough: 0.5, prof: "pull", name: "bolt back" });
  t += back;
  gfHit(G, bolt, t, 0.8, S_TAU, { name: "bolt stop", couple: 0.8 });
  gfHit(G, ej, t - 0.003, 0.25, S_TAU, { name: "ejector flicks the case", couple: 0.1 });
  if (c["casing"] > 0) {
    const vz = 1.8, H = 1.1, vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);
    gfCaseDrop(G, t + (vz + vImp) / GF_GRAV, 1, c["surface"], vImp, c["casing"] * 0.6, 0.5 * c["width"]);
  }
  t += gfGap(G, 0.12);
  const fwd = 0.13 * c["tScale"];
  gfSlide(G, bolt, t, fwd, 0.45, { rough: 0.5, prof: "even", name: "bolt forward" });
  gfHit(G, bolt, t + fwd * 0.3, 0.2, 0.0006, { name: "picks up a round", couple: 0.3, click: 0 });
  t += fwd;
  gfHit(G, bolt, t, 0.55, S_TAU, { name: "round chambers", couple: 0.6 });
  t += gfGap(G, 0.05);
  gfHit(G, knob, t, 0.9, S_TAU, { name: "bolt down (lugs lock)", couple: 0.9 });
  gfHit(G, ck, t + 0.004, 0.2, S_TAU, { name: "cocking piece settles", couple: 0.2 });
  return t + 0.35 + (c["casing"] > 0 ? 0.8 : 0);
};

GF_SCRIPTS["pump rack"] = (G) => {
  const c = G.cfg, wood = c["frame"] === 2;
  const fore = gfPart(G, "forend", wood ? "wforend" : "pforend", { gain: 0.9 }), tube = gfPart(G, "magazine tube", "magtube", { gain: 0.5 });
  const bolt = gfPart(G, "bolt", "pbolt", { gain: 0.9, ringMul: c["ringMul"] }), bars = gfPart(G, "action bars", "bars", { gain: 0.45 });
  const lift = gfPart(G, "shell lifter", "lifter", { gain: 0.4 });
  let t = 0.03;
  gfHands(G, t - 0.03, 0.1, c["handling"]);
  gfHit(G, bars, t, 0.3, S_TAU, { name: "action unlocks", couple: 0.4 });
  const back = 0.1 * c["tScale"];
  gfSlide(G, tube, t + 0.002, back, 0.5, { rough: 0.45, prof: "pull", lo: 800, hi: 7000, hiss: 0.3, name: "forend back on the tube" });
  gfSlide(G, fore, t + 0.002, back, 0.3, { rough: 0.6, prof: "pull", hiss: 0, name: "forend rubs" });
  gfSlide(G, bolt, t + 0.01, back - 0.008, 0.3, { rough: 0.5, prof: "pull", hiss: 0.1, name: "bolt back" });
  gfHit(G, lift, t + back * 0.8, 0.35, S_TAU, { name: "lifter pops up", couple: 0.3 });
  t += back + 0.002;
  gfHit(G, bolt, t, 1.0, S_TAU, { name: "bolt hits the rear", couple: 0.9 });
  gfHit(G, fore, t + 0.001, 0.7, 0.0006, { name: "forend stops", couple: 0.6, click: 0 });
  if (c["casing"] > 0) {
    const vz = 2.2, H = 1.1, vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);
    gfCaseDrop(G, t + (vz + vImp) / GF_GRAV, 2, c["surface"], vImp, c["casing"], 0.5 * c["width"]);
  }
  t += gfGap(G, 0.1);
  const fwd = 0.09 * c["tScale"];
  gfSlide(G, tube, t, fwd, 0.45, { rough: 0.45, prof: "push", lo: 800, hi: 7000, hiss: 0.3, name: "forend forward" });
  gfSlide(G, fore, t, fwd, 0.25, { rough: 0.6, prof: "push", hiss: 0, name: "forend rubs" });
  gfSlide(G, bolt, t + 0.005, fwd - 0.005, 0.3, { rough: 0.5, prof: "push", hiss: 0.1, name: "bolt forward" });
  gfHit(G, lift, t + fwd * 0.35, 0.25, S_TAU, { name: "lifter drops", couple: 0.2 });
  gfSpring(G, t + fwd * 0.4, 0.015 * c["spring"], { f1: 1700, period: 0.006, echoes: 7, disp: 0.002, ring: 0.3, ringLen: 0.08, name: "magazine spring pushes a shell" });
  t += fwd;
  gfHit(G, bolt, t, 1.0, S_TAU, { name: "bolt into battery", couple: 1 });
  gfHit(G, fore, t + 0.001, 0.6, 0.0006, { name: "forend stops", couple: 0.6, click: 0 });
  gfHit(G, bars, t + 0.004, 0.35, S_TAU, { name: "action locks", couple: 0.3 });
  return t + 0.35 + (c["casing"] > 0 ? 0.7 : 0);
};

GF_SCRIPTS["revolver spin"] = (G) => {
  const c = G.cfg, rnd = G.rnd;
  const cyl = gfPart(G, "cylinder", "cylinder", { gain: 0.7, ringMul: c["ringMul"] }), lt = gfPart(G, "latch", "latch", { gain: 0.45 });
  const stop = gfPart(G, "cylinder stop", "stop", { gain: 0.35 }), crane = gfPart(G, "crane", "crane", { gain: 0.6 });
  const ham = gfPart(G, "hammer", "hammer", { gain: 0.6 });
  let t = 0.03;
  gfHands(G, t - 0.02, 0.1, c["handling"]);
  gfHit(G, lt, t, 0.25, S_TAU, { name: "latch pressed", couple: 0.4 });
  gfSlide(G, crane, t + 0.01, 0.06, 0.15, { rough: 0.4, prof: "even", hiss: 0.1, name: "cylinder swings out" });
  gfHit(G, crane, t + 0.07, 0.35, 0.0003, { name: "crane stops", couple: 0.5 });
  t += 0.07 + gfGap(G, 0.13);
  // the spin: a flick, then the notches ticking past the stop, slowing under friction (constant deceleration)
  gfHit(G, cyl, t, 0.3, 0.0015, { name: "finger flicks the cylinder", couple: 0.3, click: 0 });
  const w0 = 4 + 2 * rnd() * (0.6 + 0.4 * c["crisp"]), Ts = (1.0 + 0.5 * rnd()) * (0.8 + 0.4 * c["weight"]);   // rev/s, spin time
  const notches = 6;
  let ph = rnd() / notches, nTicks = 0;
  for (let k = 0; k < 400; k++) {
    // time of the next notch: angle(t) = w0 t - w0 t^2 / (2 Ts) (rev); notch at angle ph + j / notches
    const target = ph + nTicks / notches;
    const disc = 1 - 2 * target / (w0 * Ts);
    if (disc < 0) break;
    const tk = Ts * (1 - Math.sqrt(disc));
    const speed = w0 * (1 - tk / Ts);
    const a = 0.08 + 0.12 * Math.min(1, speed / w0);
    gfForceRaw(G, stop, t + tk, a, S_TAU * c["tauMul"], rnd());
    gfForceRaw(G, cyl, t + tk, a * 0.4, S_TAU * c["tauMul"], rnd());
    gfClick(G, t + tk, a * 0.03, 2 / G.sr, stop.pan);
    nTicks++;
  }
  G.info.events.push([Math.round(t * 1000), "spin: " + nTicks + " notch ticks over " + Math.round(Ts * 1000) + " ms from " + (w0 * notches).toFixed(0) + "/s"]);
  gfSlide(G, cyl, t, Ts, 0.06, { rough: 0.3, prof: "even", lo: 2000, hi: 9000, hiss: 0.25, name: "cylinder whirs" });
  t += Ts + gfGap(G, 0.12);
  // flick shut: the crane swings in, the latch snaps, the stop drops into a notch as the cylinder settles
  gfHands(G, t - 0.03, 0.06, c["handling"] * 0.6);
  gfSlide(G, crane, t, 0.035, 0.2, { rough: 0.4, prof: "push", hiss: 0.1, name: "cylinder swings in" });
  t += 0.035;
  gfHit(G, crane, t, 0.95, S_TAU, { name: "cylinder shuts", couple: 0.9 });
  gfHit(G, lt, t + 0.003, 0.5, S_TAU, { name: "latch snaps", couple: 0.3 });
  gfHit(G, stop, t + 0.03 + 0.03 * rnd(), 0.25, S_TAU, { name: "stop finds a notch", couple: 0.2 });
  if (c["cock"]) {
    t += gfGap(G, 0.35);
    gfHands(G, t - 0.03, 0.08, c["handling"] * 0.6);
    const hb = 0.09 * c["tScale"];
    gfSlide(G, ham, t, hb, 0.12, { rough: 0.5, prof: "pull", hiss: 0.05, name: "hammer drawn back" });
    gfSpring(G, t, 0.012 * c["spring"], { f1: 2400, period: 0.004, echoes: 6, disp: 0.0015, ring: 0.3, ringLen: 0.06, name: "mainspring compresses" });
    gfHit(G, stop, t + hb * 0.35, 0.25, S_TAU, { name: "bolt drops (first click)", couple: 0.3 });
    gfHit(G, cyl, t + hb * 0.7, 0.15, 0.0003, { name: "cylinder turns", couple: 0.2, click: 0 });
    t += hb;
    gfHit(G, ham, t, 0.6, S_TAU, { name: "hammer cocks", couple: 0.6 });
    gfHit(G, stop, t + 0.006, 0.35, S_TAU, { name: "cylinder locks", couple: 0.3 });
  }
  return t + 0.35;
};

GF_SCRIPTS["dry fire"] = (G) => {
  const c = G.cfg, fr = c["frame"];
  let t = 0.04;
  gfHands(G, t - 0.03, 0.2, c["handling"] * 0.4);
  if (fr === 0) {           // a striker-fired polymer pistol: take-up, the wall, the break, the striker hits nothing
    const trg = gfPart(G, "trigger", "ptrigger", { gain: 0.5 }), sear = gfPart(G, "sear", "sear", { gain: 0.3 }), st = gfPart(G, "striker", "striker", { gain: 0.8, ringMul: c["ringMul"] });
    const take = 0.11 * c["tScale"];
    gfSlide(G, trg, t, take, 0.07, { rough: 0.3, prof: "even", lo: 1500, hi: 6000, hiss: 0.15, name: "trigger take-up" });
    t += take;
    gfHit(G, trg, t, 0.08, 0.0005, { name: "trigger meets the wall", couple: 0.2, click: 0 });
    t += 0.05 * c["tScale"];
    gfHit(G, sear, t, 0.25, S_TAU, { name: "sear breaks", couple: 0.3 });
    gfSpring(G, t + 0.001, 0.015 * c["spring"], { f1: 3200, period: 0.0025, echoes: 5, disp: 0.001, ring: 0.25, ringLen: 0.04, name: "striker spring" });
    t += 0.0025;
    gfHit(G, st, t, 1.0, S_TAU, { name: "striker falls (empty chamber)", couple: 0.9 });
    t += gfGap(G, 0.28);
    gfHit(G, trg, t, 0.2, S_TAU, { name: "trigger resets", couple: 0.3 });
  } else if (fr === 1) {    // a double-action steel revolver: the long pull turns the cylinder, then the hammer falls
    const trg = gfPart(G, "trigger", "trigger", { gain: 0.4 }), cyl = gfPart(G, "cylinder", "cylinder", { gain: 0.4 });
    const stop = gfPart(G, "cylinder stop", "stop", { gain: 0.35 }), ham = gfPart(G, "hammer", "hammer", { gain: 0.9, ringMul: c["ringMul"] });
    const pull = 0.24 * c["tScale"];
    gfSlide(G, trg, t, pull, 0.08, { rough: 0.35, prof: "even", lo: 1500, hi: 7000, hiss: 0.12, name: "double-action pull" });
    gfSlide(G, cyl, t + pull * 0.2, pull * 0.6, 0.06, { rough: 0.3, prof: "even", hiss: 0.05, name: "cylinder turns" });
    gfSpring(G, t, 0.01 * c["spring"], { f1: 2300, period: 0.005, echoes: 6, disp: 0.002, ring: 0.2, ringLen: 0.07, name: "mainspring compresses" });
    gfHit(G, stop, t + pull * 0.85, 0.3, S_TAU, { name: "cylinder locks", couple: 0.3 });
    t += pull;
    gfHit(G, ham, t, 1.0, S_TAU, { name: "hammer falls (empty chamber)", couple: 0.9 });
    gfSpring(G, t, 0.02 * c["spring"], { f1: 2300, period: 0.005, echoes: 7, disp: 0.0018, ring: 0.4, ringLen: 0.08, name: "mainspring" });
    t += gfGap(G, 0.3);
    gfHit(G, trg, t, 0.15, S_TAU, { name: "trigger returns", couple: 0.2 });
  } else {                  // a rifle's hammer: a short take-up, the break, the hammer swings onto the firing pin
    const trg = gfPart(G, "trigger", "trigger", { gain: 0.4 }), ham = gfPart(G, "hammer", "hammer", { gain: 1, ringMul: c["ringMul"], scale: c["size"] * 0.85 });
    const pin = gfPart(G, "firing pin", "striker", { gain: 0.4 });
    const take = 0.08 * c["tScale"];
    gfSlide(G, trg, t, take, 0.06, { rough: 0.35, prof: "even", lo: 1500, hi: 6000, hiss: 0.12, name: "trigger take-up" });
    t += take;
    gfHit(G, trg, t, 0.2, S_TAU, { name: "trigger breaks", couple: 0.3 });
    t += 0.007;
    gfHit(G, ham, t, 1.0, S_TAU, { name: "hammer hits the firing pin", couple: 1 });
    gfHit(G, pin, t + 0.0012, 0.4, S_TAU, { name: "pin hits nothing", couple: 0.2 });
    gfSpring(G, t, 0.05 * c["spring"], { f1: 1900, period: 0.006, echoes: 10, decay: 0.78, disp: 0.0025, ring: 0.6, ringLen: 0.14, name: "hammer spring sproings" });
    t += gfGap(G, 0.3);
    gfHit(G, trg, t, 0.25, S_TAU, { name: "trigger resets", couple: 0.3 });
  }
  return t + 0.3;
};

// BOLT RELOAD: the bolt opened, AMMUNITION loaded (thumbed in one by one, stripped off a clip, or a single round dropped
// into the port), the bolt closed. Each loaded round is its own part (a brass cartridge held in steel: damped).
GF_SCRIPTS["bolt reload"] = (G) => {
  const c = G.cfg, rnd = G.rnd, load = c["load"];
  const bolt = gfPart(G, "bolt", "bolt", { gain: 0.9, ringMul: c["ringMul"] }), knob = gfPart(G, "bolt knob", "knob", { gain: 0.4 });
  const ck = gfPart(G, "cocking piece", "cocking", { gain: 0.4 }), ej = gfPart(G, "ejector", "ejector", { gain: 0.3 });
  const lips = gfPart(G, "feed lips", "lips", { gain: 0.5 }), fol = gfPart(G, "follower", "follower", { gain: 0.4 });
  const roundPart = (k) => gfPart(G, "round " + (k + 1), "round", { gain: 0.6, ringMul: 0.35, scale: c["size"] * (0.97 + 0.06 * rnd()) });
  let t = 0.03;
  // OPEN: up (the cam cocks it), back to the stop; the single-round take ejects a fired case
  gfHit(G, knob, t, 0.25, 0.0004, { name: "hand on the knob", couple: 0.3 });
  const cam = 0.05 * c["tScale"];
  gfSlide(G, ck, t + 0.004, cam, 0.25, { rough: 0.6, prof: "even", name: "bolt up (cocking cam)" });
  t += cam + 0.004;
  gfHit(G, ck, t, 0.35, S_TAU, { name: "cocks", couple: 0.4 });
  t += gfGap(G, 0.04);
  const back = 0.1 * c["tScale"];
  gfSlide(G, bolt, t, back, 0.45, { rough: 0.5, prof: "pull", name: "bolt back" });
  t += back;
  gfHit(G, bolt, t, 0.8, S_TAU, { name: "bolt stop", couple: 0.8 });
  if (load === 2) {
    gfHit(G, ej, t - 0.003, 0.3, S_TAU, { name: "ejector flicks the case", couple: 0.1 });
    // the case leaving the port rings as it is kicked out ("ping"), then lands
    const cs = gfPart(G, "ejected case", GF_CASE_SHAPES[1], { scale: 1, split: 0.003, pan: 0.5 * c["width"], gain: 0.55, cat: "mech" });
    gfForceRaw(G, cs, t + 0.002, 1, S_TAU, 0.3);
    G.info.events.push([Math.round((t + 0.002) * 1000), "case pings out of the port"]);
    const vz = 1.8, H = 1.1, vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);   // (its landing only with Ejected case > 0)
    if (c["casing"] > 0) G.caseRest = gfCaseDrop(G, t + (vz + vImp) / GF_GRAV, 1, c["surface"], vImp, 0.4, 0.6 * c["width"]);
  }
  t += gfGap(G, load === 2 ? 0.12 : 0.2);
  // LOAD
  if (load === 0) {               // thumbed in: each round pressed down past the feed lips, the follower and spring under it
    for (let k = 0; k < c["rounds"]; k++) {
      const r = roundPart(k), stiff = 1 + 0.08 * k;
      gfHands(G, t - 0.02, 0.08, c["handling"] * 0.5);
      gfHit(G, r, t, 0.12, 0.00008, { name: "round " + (k + 1) + " on the lips", couple: 0.15 });
      gfHit(G, lips, t + 0.001, 0.08, S_TAU, { name: "brass on steel", couple: 0.1, click: 0 });
      const push = 0.05 * c["tScale"];
      gfSlide(G, r, t + 0.003, push, 0.3, { rough: 0.6, prof: "pull", lo: 2000, hi: 9000, hiss: 0.2, name: "pressed down" });
      gfSlide(G, lips, t + 0.003, push, 0.15, { rough: 0.6, prof: "pull", hiss: 0, name: "past the lips" });
      gfSpring(G, t + 0.004, 0.012 * c["spring"] * stiff, { f1: 2400 * stiff, period: 0.002, echoes: 5, decay: 0.6, disp: 0.0008, ring: 0.2, ringLen: 0.04, name: "mag spring compresses" });
      const ts = t + 0.003 + push;
      gfHit(G, lips, ts, 0.45, S_TAU, { name: "round " + (k + 1) + " snaps under the lips", couple: 0.45 });
      gfHit(G, r, ts + 0.0007, 0.35, S_TAU, { name: "seats", couple: 0.3, click: 0 });
      gfHit(G, fol, ts + 0.002, 0.25, 0.0003, { name: "the stack settles on the follower", couple: 0.3, click: 0 });
      t = ts + gfGap(G, 0.24);
    }
  } else if (load === 1) {        // stripper clip: set in its guide, five rounds stripped down in one long push, clip flicked away
    const clip = gfPart(G, "stripper clip", "clip", { gain: 0.6 }), rs = [0, 1, 2, 3, 4].map((k) => roundPart(k));
    gfHands(G, t - 0.03, 0.1, c["handling"] * 0.6);
    gfSlide(G, clip, t, 0.03, 0.2, { rough: 0.6, prof: "push", hiss: 0.2, name: "clip into its guide" });
    t += 0.03;
    gfHit(G, clip, t, 0.5, S_TAU, { name: "clip seats in the guide", couple: 0.5 });
    t += gfGap(G, 0.12);
    // the push: rounds leave the clip's spring rails one at a time (the ratchet), the column grinding down the clip
    const len = 0.42 * c["tScale"];
    gfSlide(G, clip, t, len, 0.5, { rough: 0.9, prof: "even", rate: 4000, lo: 1800, hi: 10000, hiss: 0.45, name: "five rounds stripped down (the long push)" });
    gfSlide(G, lips, t, len, 0.25, { rough: 0.8, prof: "even", hiss: 0, name: "rounds over the lips" });
    gfSpring(G, t, 0.02 * c["spring"], { f1: 2300, period: 0.003, echoes: 8, decay: 0.75, disp: 0.002, ring: 0.3, ringLen: 0.12, name: "mag spring compresses" });
    for (let k = 0; k < 5; k++) {
      const u = (k + 0.6) / 5.4, tk = t + len * Math.pow(u, 0.9) + 0.006 * (rnd() - 0.5);
      gfHit(G, clip, tk, 0.35, S_TAU, { name: "round " + (k + 1) + " leaves the clip", couple: 0.3 });
      gfHit(G, rs[k], tk + 0.0015, 0.35, S_TAU, { name: "snaps into the magazine", couple: 0.3, click: 0 });
      gfHit(G, lips, tk + 0.003, 0.3, S_TAU, { name: "lips", couple: 0.2, click: 0 });
    }
    t += len;
    gfHit(G, fol, t + 0.003, 0.3, 0.0003, { name: "the stack bottoms", couple: 0.4, click: 0 });
    t += gfGap(G, 0.14);
    // the empty clip flicked out of its guide: a light tinny tick, and it lands somewhere off to the side
    gfSlide(G, clip, t, 0.012, 0.12, { rough: 0.5, prof: "push", hiss: 0.1, name: "clip flicked out" });
    gfHit(G, clip, t + 0.012, 0.25, S_TAU, { name: "clip leaves the guide (tick)", couple: 0.1 });
    const fl = gfPart(G, "dropped clip", "clip", { gain: 0.25, pan: -0.6 * c["width"], scale: 1 });
    let tl = t + 0.012 + 0.42, v = 3;
    for (let k = 0; k < 3 && v > 0.3; k++) { gfForceRaw(G, fl, tl, v / 3, 0.00004, rnd()); G.info.events.push([Math.round(tl * 1000), "clip lands"]); v *= 0.4 * (0.6 + 0.8 * rnd()); tl += 2 * v / GF_GRAV; }
    gfDamp(fl, tl + 0.02, 0.2);
    t += gfGap(G, 0.12);
  } else {                        // single round: dropped into the open port, pushed forward with the bolt
    const r = roundPart(0);
    gfHands(G, t - 0.04, 0.08, c["handling"] * 0.5);
    gfHit(G, r, t, 0.55, 0.00006, { name: "round dropped into the port", couple: 0.4 });
    gfHit(G, fol, t + 0.0015, 0.35, 0.0002, { name: "on the follower", couple: 0.3, click: 0 });
    gfHit(G, r, t + 0.045 + 0.01 * rnd(), 0.18, 0.00006, { name: "rolls into the rails", couple: 0.1, click: 0 });
    t += gfGap(G, 0.12);
  }
  // CLOSE: forward (picking up the top round, chambering), then down: the ka-CHUNK
  const fwd = (load === 2 ? 0.09 : 0.12) * c["tScale"];
  gfSlide(G, bolt, t, fwd, 0.45, { rough: 0.5, prof: load === 2 ? "push" : "even", name: "bolt forward" });
  gfHit(G, bolt, t + fwd * 0.3, 0.25, 0.0006, { name: "picks up a round", couple: 0.3, click: 0 });
  t += fwd;
  gfHit(G, bolt, t, load === 2 ? 0.85 : 0.6, S_TAU, { name: "round chambers (ka-)", couple: 0.7 });
  t += gfGap(G, load === 2 ? 0.07 : 0.05);
  gfHit(G, knob, t, load === 2 ? 1.25 : 0.95, S_TAU, { name: "bolt down, lugs lock (-CHUNK)", couple: 1 });
  gfHit(G, bolt, t + 0.002, 0.5, S_TAU, { name: "the bolt body seats", couple: 0.6, click: 0 });
  gfHit(G, ck, t + 0.005, 0.2, S_TAU, { name: "cocking piece settles", couple: 0.2 });
  return Math.max(t + 0.4, G.caseRest ? G.caseRest + 0.3 : 0);
};

GF_SCRIPTS["casing"] = (G) => {
  const c = G.cfg, vz = 1.5, H = c["dropH"], vImp = Math.sqrt(vz * vz + 2 * GF_GRAV * H);
  const end = gfCaseDrop(G, 0.02, c["caseType"], c["surface"], vImp, 1, (G.rnd() * 2 - 1) * 0.3 * c["width"]);
  G.info.events.push([20, "first landing at " + vImp.toFixed(1) + " m/s"]);
  return end + 0.35;
};

// RICOCHET: the bullet hits the surface (gfDist sets how far away), then the tumbling slug flies past
GF_SCRIPTS["ricochet"] = (G) => {
  const c = G.cfg, rnd = G.rnd, sr = G.sr, si = c["surface"];
  // geometry: the slug leaves the impact point at v0 and passes the listener at dmin; "away" when crisp < 0.3 and surface metal
  const dmin = c["dist"], v0 = 100 + 0.15 * c["speed"], k = 0.3 + 0.3 * rnd();   // a deformed, tumbling slug leaves slow (~150-240 m/s) and keeps slowing
  const away = !c["past"];
  const xImp = away ? 2 + 4 * rnd() : -(6 + 10 * rnd()) * (0.5 + dmin / 10);   // along-track at the impact
  const rImp = Math.sqrt(xImp * xImp + dmin * dmin), tImp = 0.01;
  // the impact, heard at tImp
  const ia = 1 / Math.max(1, rImp / 5), pan = gfClamp(xImp / rImp, -1, 1) * 0.6 * c["width"];
  if (si === 3) {
    const plate = gfPart(G, "steel plate", { "f": [480, 1250, 2300, 3400, 4700, 6100, 7900], "a": [0.6, 1, 0.9, 0.8, 0.6, 0.45, 0.3], "mat": "deck" }, { scale: 1, pan, gain: ia, ringMul: 0.6, cat: "impact" });
    gfForceRaw(G, plate, tImp, 1, 0.00002, 0.3);
    gfClick(G, tImp, ia * 0.25, 2 / sr, pan, "impact");
  } else {
    gfClick(G, tImp, ia * 0.18, 0.00012, pan, "impact");   // ~120 us: a lead slug flattening on stone, not a spike
    const chips = si === 2 ? 0 : si === 1 ? 25 : 60;
    for (let j = 0; j < chips; j++) { const tc = tImp + 0.06 * Math.pow(rnd(), 1.6); gfClick(G, tc, ia * 0.05 * Math.pow(rnd(), 2), 1.5 / sr, pan + (rnd() - 0.5) * 0.3, "impact"); }
    gfBurst(G, tImp, 0.12, si === 2 ? 0.03 : 0.02, ia * (si === 2 ? 0.25 : 0.12), si === 2 ? 300 : 1500, si === 2 ? 4000 : 11000, pan);
    if (si === 1) { const wd = gfPart(G, "wood", { "f": [320, 700, 1300], "a": [1, 0.6, 0.3], "mat": "wood" }, { scale: 1, pan, gain: ia * 0.7, cat: "impact" }); gfForceRaw(G, wd, tImp, 1, 0.0003, 0.5); }
    if (si === 2) { const dt = gfPart(G, "dirt", { "f": [90, 170], "a": [1, 0.5], "mat": "soil" }, { scale: 1, pan, gain: ia * 1.2, cat: "impact" }); gfForceRaw(G, dt, tImp, 1, 0.002, 0.5); }
  }
  G.info.events.push([Math.round(tImp * 1000), "impact on " + GF_SURFACES[si] + " " + rImp.toFixed(1) + " m away"]);
  // the slug: emission starts at te = 0 at xImp; arrival of te = 0 is tImp, so ta0 = rImp / c - tImp
  const n = G.n, fb = gfFlyby(sr, n, rImp / GF_C - tImp, { v0, k, dmin, x0: xImp });
  const f0 = (2200 + 2400 * rnd()) * (0.75 + 0.5 * c["crisp"]), fr0 = 70 + 160 * rnd(), depth = 0.55 + 0.35 * rnd();
  const life = 0.7 + 0.6 * c["crisp"];                 // emission seconds before the whistle dies (the slug drops / stops tumbling hard)
  const nb = gfBand(sr, 1500, 9000);
  let ph = rnd() * 6.283, phT = 0, lp = 0, lp2 = 0, emax = 0;
  const [L, R] = G.cat("flyby");
  for (let i = 0; i < n; i++) {
    const te = fb.te[i];
    if (te < 0) continue;
    if (te > life) break;
    const vr = fb.vOf(te) / v0, fsrc = f0 * vr, fobs = fsrc * fb.dop[i];
    ph += 2 * Math.PI * Math.min(fobs, 0.45 * sr) / sr;
    phT += 2 * Math.PI * fr0 * vr * fb.dop[i] / sr;
    const tumble = 1 - depth * (0.5 + 0.5 * Math.cos(phT)) + 0.15 * Math.sin(2.3 * phT);
    let s = 0;
    if (fobs < 0.45 * sr) s += Math.sin(ph);
    if (2 * fobs < 0.45 * sr) s += 0.35 * Math.sin(2 * ph + 0.7);
    if (3 * fobs < 0.45 * sr) s += 0.12 * Math.sin(3 * ph + 1.9);
    s += 0.35 * gfBandTick(nb, rnd() * 2 - 1);
    // amplitude: 1/r, the Doppler's energy compression (intensity ~ dop^2 for a moving monopole, kept mild), the whistle
    // weakening as the slug slows, fade-in over its first few ms and out at its life's end
    const env = Math.min(1, te / 0.004) * Math.min(1, (life - te) / 0.12) * Math.pow(vr, 1.5);
    const a = env * tumble * Math.pow(fb.dop[i], 1.2) / fb.r[i];
    // air: a one-pole whose corner falls with distance (and a fixed 9 kHz top for the whistle's harmonics)
    const fc = Math.max(2500, 14000 * Math.pow(10 / (10 + fb.r[i]), 0.6)), al = Math.exp(-2 * Math.PI * fc / sr);
    lp = s * a + (lp - s * a) * al; lp2 = lp + (lp2 - lp) * al;
    const x = xImp + fb.sOf(te), [gl, gr] = gfPanGains(gfClamp(x / fb.r[i], -1, 1) * 0.8 * c["width"]);   // pan follows the slug
    L[i] += lp2 * gl; R[i] += lp2 * gr; emax = Math.max(emax, Math.abs(lp2));
  }
  // the dop at the start and the end, for the KEY
  let i0 = 0; while (i0 < n && fb.te[i0] < 0) i0++;
  let i1 = i0; while (i1 < n - 1 && fb.te[i1] < life) i1++;
  G.info.whine = { f0: Math.round(f0), tumbleHz: Math.round(fr0), v0: Math.round(v0), dmin: +dmin.toFixed(1), start: Math.round(f0 * fb.dop[i0]), end: Math.round(f0 * fb.vOf(fb.te[i1]) / v0 * fb.dop[i1]), heardFrom: Math.round(i0 / sr * 1000), heardTo: Math.round(i1 / sr * 1000) };
  G.info.events.push([Math.round(i0 / sr * 1000), "whine " + G.info.whine.start + " Hz -> " + G.info.whine.end + " Hz"]);
  G.whineLevel = 1.6 + 1.6 * c["crisp"];
  return Math.min(i1 / sr + 0.25, 2.5);
};

// BULLET PASS: supersonic N-wave + ground reflection + wake hiss; or a subsonic whiz through the flyby Doppler
GF_SCRIPTS["bullet pass"] = (G) => {
  const c = G.cfg, rnd = G.rnd, sr = G.sr, d = c["dist"], v = c["speed"], M = v / GF_C, [L, R] = G.cat("flyby");
  const side = (rnd() < 0.5 ? -1 : 1) * 0.7 * c["width"];
  const t0 = 0.01;
  if (M > 1.05) {
    const [NL, NR] = G.cat("nwave"), dia = 0.0078, blen = 0.03;
    const T = 1.82 * M * Math.pow(d, 0.25) * dia / (GF_C * Math.pow(M * M - 1, 0.375) * Math.pow(blen, 0.25));
    const P = Math.pow(d, -0.75), rise = 0.000004 + 0.00003 * Math.pow(d / 10, 1.2);   // turbulence smears the shock with distance
    const nwave = (t, amp, Tn, pan) => {
      const OS = 8, i0 = Math.floor(t * sr), i1 = Math.ceil((t + Tn + 4 * rise) * sr) + 1, [gl, gr] = gfPanGains(pan);
      for (let i = i0; i < i1 && i < G.n; i++) {
        let s = 0;
        for (let k = 0; k < OS; k++) {
          const u = (i + (k + 0.5) / OS) / sr - t;
          // the N: a front shock up, a linear fall through zero, a tail shock back up; each shock a tanh of width `rise`
          const s1 = 0.5 + 0.5 * Math.tanh(u / rise), s2 = 0.5 + 0.5 * Math.tanh((u - Tn) / rise);
          s += (s1 - s2) * (1 - 2 * u / Tn);
        }
        const val = amp * s / OS; NL[i] += val * gl; NR[i] += val * gr;
      }
    };
    nwave(t0, P, T, side);
    const h = 1.5, dRef = Math.sqrt(d * d + 4 * h * h), tRef = (dRef - d) / GF_C;
    nwave(t0 + tRef, Math.pow(dRef, -0.75) * 0.55, T * Math.pow(dRef / d, 0.25), side * 0.6);
    G.info.events.push([Math.round(t0 * 1000), "N-wave " + Math.round(T * 1e6) + " us, rise " + Math.round(rise * 1e6) + " us"]);
    G.info.events.push([Math.round((t0 + tRef) * 1000), "ground reflection"]);
    // the wake: turbulent hiss after the crack, its band falling as the bullet recedes, weaker with distance
    const wl = 0.12 + 0.1 * (1 - c["crisp"]), n = Math.ceil(wl * sr), i0 = Math.floor((t0 + 0.0005) * sr), b = { l: 0, l2: 0, h: 0 };
    const amp = P * 0.06 * Math.pow(Math.min(1, 3 / d), 0.5), [gl, gr] = gfPanGains(side * 0.6);
    for (let k = 0; k < n && i0 + k < G.n; k++) {
      const u = k / n, fc = 9000 * Math.pow(1800 / 9000, Math.pow(u, 0.6)) * Math.pow(Math.min(1, 4 / d), 0.3), aL = Math.exp(-2 * Math.PI * fc / sr), aH = Math.exp(-2 * Math.PI * fc * 0.25 / sr);
      const x = rnd() * 2 - 1; b.h = x + (b.h - x) * aH; const hp = x - b.h; b.l = hp + (b.l - hp) * aL; b.l2 = b.l + (b.l2 - b.l) * aL;
      const env = Math.min(1, k / (0.002 * sr)) * Math.pow(1 - u, 2.2), vv = b.l2 * amp * env;
      L[i0 + k] += vv * gl; R[i0 + k] += vv * gr;
    }
    G.info.pass = { mach: +M.toFixed(2), nwaveUs: Math.round(T * 1e6), reflectMs: +(tRef * 1000).toFixed(1) };
    // the wake is levelled against the N-waves' ENERGY (a 0.1-0.3 ms shock carries almost none, as blast.mjs found for
    // its muzzle shock): x2 .. x30, more when close and crisp, so the snap keeps its crest and the pass has a body
    G.wakeRatio = (2 + 28 * c["crisp"]) * Math.pow(Math.min(1, 3 / d), 0.5);
    return t0 + Math.max(0.35, wl + 0.1);
  }
  // subsonic: the wake's whiz (noise with a whistle) through the flyby
  const n = G.n, tPass = 0.3, X0 = 40;   // heard from 40 m out; the file starts 10 ms before that sound arrives
  const teS = (tPass * v - X0) / v, taS = teS + Math.sqrt(X0 * X0 + d * d) / GF_C - 0.01;
  const fb = gfFlyby(sr, n, taS, { v0: v, k: 0, dmin: d, x0: -v * tPass });   // at its closest at emission time tPass
  const fW = 1300 + 500 * rnd();
  let lp = 0, lp2 = 0, h = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const te = fb.te[i], x = -v * tPass + v * te, r = fb.r[i], dp = fb.dop[i];
    if (Math.abs(x) > X0) continue;
    const fc = Math.min(6000, fW * dp), aL = Math.exp(-2 * Math.PI * fc * 1.6 / sr), aH = Math.exp(-2 * Math.PI * fc * 0.5 / sr);
    const xx = rnd() * 2 - 1; h = xx + (h - xx) * aH; const hp = xx - h; lp = hp + (lp - hp) * aL; lp2 = lp + (lp2 - lp) * aL;
    ph += 2 * Math.PI * Math.min(fc, 0.45 * sr) / sr;
    const a = Math.sqrt(dp) / r * Math.min(1, (X0 - Math.abs(x)) / 10);
    const s = (lp2 * 1.4 + 0.12 * Math.sin(ph) * (0.6 + 0.4 * Math.sin(ph * 0.013))) * a;
    const [gl, gr] = gfPanGains(gfClamp(x / r, -1, 1) * 0.8 * c["width"] * Math.sign(side || 1));
    L[i] += s * gl; R[i] += s * gr;
  }
  G.info.pass = { mach: +M.toFixed(2), subsonic: true, whizHz: Math.round(fW), approachX: +(1 / (1 - M)).toFixed(1), recedeX: +(1 / (1 + M)).toFixed(2) };
  G.info.events.push([Math.round((tPass + d / GF_C - taS) * 1000), "closest pass"]);
  G.whineLevel = 1;
  return tPass + d / GF_C - taS + 0.3;
};

// One action. Returns { L, R, n, info, tick(drive, out) }.
export function makeGunfoley(sr, cfg, seed) {
  const base = ((seed >>> 0) ^ Math.imul(cfg["seed"] + 1, 0x9e3779b1)) >>> 0;
  const rnd = gfRng(base ^ 0x1b873593);
  const name = GF_ACTIONS[cfg["action"]];
  const maxN = Math.round(Math.max(cfg["dur"] || 0, 3.5) * sr);
  const cats = {};
  const info = { action: name, events: [], landings: [], energies: {} };
  const G = { sr, n: maxN, rnd, cfg, parts: [], floors: [], info, body: null, thump: null, whineLevel: 1,
    cat: (k) => cats[k] || (cats[k] = [new Float64Array(maxN), new Float64Array(maxN)]) };
  if (cfg["action"] <= 5 || cfg["action"] === 9) {   // a weapon: its body and its rigid-body thump
    G.body = GF_BODIES[cfg["frame"]].map((b, k) => gfPart(G, "body " + k, b, { pan: 0, cat: "body" }));
    G.thump = gfPart(G, "weight thump", { "f": [115, 190], "a": [1, 0.4], "mat": "wood" }, { pan: 0, ringMul: 0.5, cat: "thump" });
  }
  const end = GF_SCRIPTS[name](G);
  const n = Math.max(1, Math.min(maxN, Math.round((cfg["dur"] > 0 ? cfg["dur"] : end) * sr)));
  info.dur = n / sr;
  gfRunParts(G);
  // LEVELS: every category to a target ENERGY relative to the reference (the mechanism's parts; a lone casing's case; a
  // ricochet's impact), as glass.mjs levels its components, so each knob is a ratio and never an accident of gains.
  const E = {};
  for (const k in cats) { let e = 0; const [a0, a1] = cats[k]; for (let i = 0; i < n; i++) e += (a0[i] * a0[i] + a1[i] * a1[i]) / 2; E[k] = e / sr; }
  const c = cfg, refK = E["mech"] > 0 ? "mech" : E["case"] > 0 ? "case" : E["nwave"] > 0 ? "nwave" : "impact", ref = E[refK] || 0;
  const T = {};
  if (refK === "mech") {
    T["body"] = [0.35, 0.5, 0.7][c["frame"]] * (0.7 + 0.6 * c["crisp"]);
    T["thump"] = 0.25 * c["thump"];
    T["click"] = 0.04 * (0.5 + c["crisp"]);
    T["rub"] = 0.08 * c["rub"];
    T["spring"] = 0.12 * c["spring"];
    T["hands"] = 0.1 * c["handling"];
    T["case"] = 0.35 * c["casing"] * c["casing"];
    T["floor"] = T["case"] * [0, 0.35, 1.2, 0.3][c["surface"]];
    T["grit"] = T["case"] * 0.15 + (c["magDrop"] > 0 ? 0.02 * c["magDrop"] : 0);
  } else if (refK === "case") {
    T["floor"] = [0, 0.35, 1.2, 0.3][c["surface"]];
    T["grit"] = [0.12, 0.05, 0.6, 0.03][c["surface"]];
    T["click"] = 0.03;
  } else if (refK === "nwave") {
    T["flyby"] = G.wakeRatio;
  } else {
    T["click"] = null; T["grit"] = null;            // the impact's own balance (clicks, chips, dust) is the model's
    T["flyby"] = ref > 0 ? G.whineLevel * 2.5 : null;
  }
  const gains = {};
  for (const k in cats) {
    if (k === refK || !(E[k] > 0)) { gains[k] = 1; continue; }
    if (T[k] == null) { gains[k] = (k === "flyby" && !(ref > 0)) ? 1 : 1; continue; }
    gains[k] = Math.sqrt(T[k] * ref / E[k]);
  }
  for (const k in cats) info.energies[k] = ref > 0 ? (E[k] * gains[k] * gains[k]) / ref : E[k];
  info.ref = refK;
  if (cfg["__debug"]) { info.__cats = cats; info.__gains = gains; }
  // sum, then a 20 Hz two-pole DC / subsonic block
  const oL = new Float32Array(n), oR = new Float32Array(n), hpA = Math.exp(-2 * Math.PI * 20 / sr), list = Object.keys(cats);
  let h1l = 0, h1r = 0, x1l = 0, x1r = 0, h2l = 0, h2r = 0, y1l = 0, y1r = 0;
  for (let i = 0; i < n; i++) {
    let xl = 0, xr = 0;
    for (const k of list) { const g = gains[k]; xl += cats[k][0][i] * g; xr += cats[k][1][i] * g; }
    h1l = hpA * (h1l + xl - x1l); x1l = xl; h2l = hpA * (h2l + h1l - y1l); y1l = h1l;
    h1r = hpA * (h1r + xr - x1r); x1r = xr; h2r = hpA * (h2r + h1r - y1r); y1r = h1r;
    oL[i] = h2l; oR[i] = h2r;
  }
  const lv = gunfoleyLevel(oL, oR, sr);
  for (let i = 0; i < n; i++) { oL[i] *= lv; oR[i] *= lv; }
  info.events.sort((a, b) => a[0] - b[0]);
  let i = 0;
  return { L: oL, R: oR, n, info, tick(drive, o) { if (i < n) { o[0] = oL[i] * drive; o[1] = oR[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9
export function gunfoleyLevel(L, R, sr = 44100) {
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
// (runCli is called at the end of the file, after README is defined)

function runCli() {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SR = 44100, TARGET_LUFS = -18, OUT = join(ROOT, "soundtests", "proto-gunfoley");
  const G = { console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  const ctx = createContext(Object.assign({}, G)); ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx);
  const dctx = createContext(Object.assign({}, G));
  runInContext(readFileSync(join(ROOT, "dsp.js"), "utf8"), dctx, { filename: "dsp.js" });
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  const PRESETS = pctx.window.PRESETS;
  const preset = (nm) => { if (!PRESETS[nm]) throw new Error("no preset " + nm); const o = Object.assign({}, PRESETS[nm]); delete o._vary; return o; };

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, gated) + its 0.95 peak cap (as glass.mjs)
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
  // glass.mjs's rule: a take kept > 0.5 dB under the target by its peaks gets the app's OWN Limiter (dsp.js
  // limiterProcess) at the smallest 0.1 step that brings it within 0.5 dB; past the slider's top, a second pass ("1+x")
  function matchWithLimiter(L, R) {
    const L0 = Float32Array.from(L), R0 = Float32Array.from(R);
    matchLoudness(L, R);
    if (lufs(L, R) > TARGET_LUFS - 0.5) return 0;
    let pk = 0; for (let i = 0; i < L0.length; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, amt);
      matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5) { L.set(l); R.set(r); return Math.round(amt * 10) / 10; }
    }
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, 1);
      let p2 = 0; for (let i = 0; i < l.length; i++) p2 = Math.max(p2, Math.abs(l[i]), Math.abs(r[i]));
      for (let i = 0; i < l.length; i++) { l[i] *= 0.9 / p2; r[i] *= 0.9 / p2; }
      dctx.limiterProcess(l, r, amt);
      matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5 || amt > 0.95) { L.set(l); R.set(r); return "1+" + Math.round(amt * 10) / 10; }
    }
    return 0;
  }

  // ---- the takes. A model take: { id, why, st: rows + width/duration, seed }. Its room is the round's `room`.
  const gf = (o) => Object.assign({ width: 0.5 }, o);
  const POLY = 0, STEEL = 1, WOOD = 2, CONCRETE = 0, WOODF = 1, DIRT = 2, METAL = 3;
  const dist = (m) => Math.log(m / 0.5) / Math.log(60), speed = (v) => (v - 220) / 730;
  const BENCH = { reverb: 0.1, reverbSize: 0.3, reverbTone: 0.6 }, OUTSIDE = { reverb: 0.14, reverbSize: 0.7, reverbTone: 0.45 };
  const ROUNDS = {
    "quick-reload": {
      title: "Quick Reload", control: "Quick Reload", room: BENCH,
      controlWhy: "the CURRENT preset \"Quick Reload\" exactly as it ships (round 3's pick, take D): an impact-engine click as the magazine comes out, a heavier clack 0.22 s later as the new one goes in.",
      listen: "A gun being reloaded in a game: the magazine out, a fresh one in, the gun made ready. Which one sounds like a REAL GUN'S METAL AND PLASTIC, and which one would you put in your game? Listen to the clacks (do they sound like small hard parts hitting, with a body behind them, or like generic clicks?), to the slides between them, and to whether you can tell what the gun is made of and how big it is.",
      takes: [
        { id: "polymer-pistol-quick", why: "MODEL, a light POLYMER pistol, fast hands, CRISP game foley: the mag release, the mag dropping free (a polymer box hushing out of a polymer well), a fresh one in and seated (palm, the mag bottoming in the well, the catch snapping), then the slide-release lever: the slide flies home on its spring and slams into battery with the barrel locking 3 ms behind. The polymer frame is the dull low \"tok\" under the steel slide's ring.",
          st: gf({ gfAction: 0, gfFrame: POLY, gfWeight: 0.25, gfTempo: 0.8, gfCrisp: 0.85, gfSpring: 0.6, gfHandling: 0.2, gfRack: 0 }), seed: 11 },
        { id: "steel-pistol-natural", why: "MODEL, an all-STEEL pistol, deliberate hands, NATURAL foley: handling noise, a steel magazine (sheet-steel box: it rings) dropping out and landing on concrete, a fresh one in and seated, then the slide RACKED by hand: pulled back against the recoil spring to the stop, let go, the round stripped off the magazine and the slide slamming home. The steel frame rings where a polymer one thuds.",
          st: gf({ gfAction: 0, gfFrame: STEEL, gfWeight: 0.5, gfTempo: 0.35, gfCrisp: 0.1, gfSpring: 0.5, gfHandling: 0.7, gfRack: 1, gfMagDrop: 0.8, gfSurface: CONCRETE }), seed: 23 },
        { id: "heavy-rifle-game", why: "MODEL, a HEAVY steel RIFLE, crisp exaggerated game foley: the mag release, a long steel magazine out of the well, a fresh one in and seated hard, then the charging handle: pulled back (the bolt carrier running back along its raceway against the buffer spring), let go, the carrier slamming home with the buffer spring's \"sproing\" and the bolt locking. Bigger parts ring lower; the weight is the thump under it.",
          st: gf({ gfAction: 1, gfFrame: STEEL, gfWeight: 0.85, gfTempo: 0.6, gfCrisp: 0.9, gfSpring: 0.8, gfHandling: 0.2 }), seed: 37 },
      ] },
    "bolt-action-reload": {
      title: "Bolt-Action Reload", control: "Bolt-Action Reload", room: BENCH,
      controlWhy: "the CURRENT preset \"Bolt-Action Reload\" exactly as it ships: two impact-engine clacks 0.45 s apart, two band-noise scrapes, a second pair of clacks, and the modal casing ping bouncing three times (layers, timed like the blast engine's own bolt).",
      listen: "A bolt-action rifle worked by hand: the bolt lifted, drawn back (the spent case flicked out), pushed forward and locked down. Which one sounds like a REAL RIFLE'S BOLT, and which would you put in your game? Listen for the four motions (up, back, forward, down), for the bolt sliding in its raceway, and for the solid lock at the end.",
      takes: [
        { id: "crisp-game-bolt", why: "MODEL, a wood-and-steel rifle, quick crisp game foley: bolt UP (the cocking cam, the click as it cocks), BACK (a short steel \"shhk\" along the raceway into the bolt stop, the ejector flicking the case out), FORWARD (picking up a round, chambering), DOWN (the lugs locking: the big one). The case lands on concrete ~0.6 s after it is flicked out and bounces three times, the gaps shrinking.",
          st: gf({ gfAction: 2, gfFrame: WOOD, gfWeight: 0.6, gfTempo: 0.7, gfCrisp: 0.9, gfSpring: 0.5, gfHandling: 0.1, gfCasing: 0.6, gfSurface: CONCRETE }), seed: 41 },
        { id: "heavy-natural-bolt", why: "MODEL, a HEAVY wood-and-steel rifle, deliberate hands, NATURAL foley: the same four motions slower and longer (the raceway's rub is long and audible, hands on the stock), softer contacts, the stock's low hollow knock under the steel. The case falls into DIRT: a dull tuk, no bounce.",
          st: gf({ gfAction: 2, gfFrame: WOOD, gfWeight: 0.95, gfTempo: 0.25, gfCrisp: 0.1, gfSpring: 0.4, gfHandling: 0.7, gfCasing: 0.5, gfSurface: DIRT }), seed: 43 },
        { id: "light-fast-polymer", why: "MODEL, a lighter rifle with a POLYMER stock, very fast hands (a competition cycle), fairly crisp: the four motions bunched into ~0.4 s, higher and drier (a smaller bolt, the polymer stock's dull tok instead of wood). The case rings off a STEEL DECK (the deck rings too).",
          st: gf({ gfAction: 2, gfFrame: POLY, gfWeight: 0.3, gfTempo: 0.95, gfCrisp: 0.6, gfSpring: 0.5, gfHandling: 0.2, gfCasing: 0.6, gfSurface: METAL }), seed: 47 },
      ] },
    "shell-casing": {
      title: "Shell Casing", control: "Shell Casing", room: BENCH,
      controlWhy: "the CURRENT preset \"Shell Casing\" exactly as it ships (round 3's pick, the plain one, take C): the modal engine at 2.6 kHz, four partials, repeated three times at 7 a second.",
      listen: "A spent case falling to the floor after a shot. Which one is a SHELL CASING? Listen to the material (thin brass tinkling, or something duller), to the bounces (do they come faster and faster, like something really bouncing?), and to how it comes to rest.",
      takes: [
        { id: "pistol-brass-concrete", why: "MODEL, a PISTOL case (thin brass, ~5.5 kHz ring, its modes in shimmering pairs) dropped ~1.1 m onto CONCRETE: tink, the gaps shrinking bounce by bounce, a tilted tube's second end landing a few ms after the first (\"ti-tink\"), then a short ROLL across the grit.",
          st: gf({ gfAction: 6, gfCase: 0, gfSurface: CONCRETE, gfDrop: 0.6 }), seed: 51 },
        { id: "rifle-brass-steel-deck", why: "MODEL, a RIFLE case (longer, ~3.9 kHz, with the shoulder's mode) dropped ~1.2 m onto a STEEL DECK: brighter contacts, bouncier, and the deck itself rings under each landing; rolls to rest.",
          st: gf({ gfAction: 6, gfCase: 1, gfSurface: METAL, gfDrop: 0.7 }), seed: 53 },
        { id: "shotgun-hull-wood", why: "MODEL, a SHOTGUN HULL (a plastic tube with a brass head: a dull ~1.25 kHz \"tock\" with the head's small tick) dropped onto a WOODEN floor: soft, heavy, barely bounces, the floorboards' hollow knock under it.",
          st: gf({ gfAction: 6, gfCase: 2, gfSurface: WOODF, gfDrop: 0.6 }), seed: 57 },
      ] },
    "ricochet-zing": {
      title: "Ricochet Zing", control: "Ricochet Zing", room: OUTSIDE,
      controlWhy: "the CURRENT preset \"Ricochet Zing\" exactly as it ships: a sawtooth at 1.8 kHz sweeping down, three notes stepping down, vibrato at 11 Hz, a ping-pong echo.",
      listen: "A bullet hitting something hard and glancing off: the hit, then the deformed bullet whining away. Which one is a RICOCHET? Listen to the hit (stone, metal?), to the whine (does it fall in pitch like something flying past you, does it buzz or tumble?) and to how it goes away.",
      takes: [
        { id: "off-rock-flies-past", why: "MODEL, a bullet glancing off a ROCK ~6 m away, the tumbling slug flying past you ~4 m off: the crack and stone chips, then the slug's whistle (~3.9 kHz at the source, buzzing at its tumble rate, leaving at ~200 m/s) through the exact Doppler of its path: it arrives high and falls about two octaves as it passes (the \"pyeeeoww\"), dropping further as drag slows it.",
          st: gf({ gfAction: 7, gfSurface: CONCRETE, gfDist: dist(4), gfPast: 1, gfCrisp: 0.8, gfSpeed: 0.6 }), seed: 61 },
        { id: "off-steel-flies-away", why: "MODEL, a bullet hitting a STEEL plate (the plate rings: \"pang\"), the slug flying AWAY from you: only the receding half of the Doppler (it starts below its own pitch and sinks as it slows), so a shorter, lower \"pwoww\" behind the ring.",
          st: gf({ gfAction: 7, gfSurface: METAL, gfDist: dist(3), gfPast: 0, gfCrisp: 0.5, gfSpeed: 0.6 }), seed: 67 },
        { id: "distant-zip", why: "MODEL, NATURAL, a ricochet off stone, the slug passing ~15 m off: the hit small and the whine thinner and duller (air takes the highs over distance), the Doppler fall slower and gentler because the slug is far: a \"zeeee-ow\" more than a \"pyeow\".",
          st: gf({ gfAction: 7, gfSurface: CONCRETE, gfDist: dist(15), gfPast: 1, gfCrisp: 0.2, gfSpeed: 0.6 }), seed: 71 },
      ] },
    "bullet-whiz": {
      title: "Bullet Whiz", control: "Bullet Whiz", room: OUTSIDE,
      controlWhy: "the CURRENT preset \"Bullet Whiz\" exactly as it ships: the blast engine DOWNRANGE at 150 m (the bullet's supersonic crack arriving first, the gun's report ~0.26 s later, through a street's echoes).",
      listen: "A bullet passing close to you (being shot at). Which one sounds like a BULLET GOING PAST? Listen for the snap or the whiz itself (one of the takes also has the gun's report arriving after it; the others are the pass alone, so judge the pass).",
      takes: [
        { id: "supersonic-snap-1m", why: "MODEL, a rifle bullet (850 m/s, Mach 2.5) passing 1 m away: its N-wave (Whitham: ~140 us long at this distance, a near-instant rise), a second, weaker N-wave from the ground ~6 ms behind (the \"crack-crack\" of a close miss), and the wake's hiss falling away after. No report. The game \"SNAP\".",
          st: gf({ gfAction: 8, gfDist: dist(1), gfSpeed: speed(850), gfCrisp: 0.8 }), seed: 81 },
        { id: "supersonic-crack-12m", why: "MODEL, the same bullet passing 12 m away: a weaker, longer N-wave (~260 us) with a slower, smeared rise (turbulence over the distance), the ground reflection close behind it, almost no wake: a duller \"crack\" than a snap. No report.",
          st: gf({ gfAction: 8, gfDist: dist(12), gfSpeed: speed(850), gfCrisp: 0.3 }), seed: 83 },
        { id: "subsonic-whiz", why: "MODEL, a SUBSONIC bullet (a pistol round, 300 m/s) passing 1.5 m away: no crack at all, only the wake's whiz through the Doppler of the pass: compressed and high as it comes, a fast fall as it goes by (\"fffwip\").",
          st: gf({ gfAction: 8, gfDist: dist(1.5), gfSpeed: speed(300), gfCrisp: 0.5 }), seed: 87 },
      ] },
    "pump-shotgun-rack": {
      title: "Pump Shotgun Rack (a GAP: no preset owns it)", control: "Quick Reload (stand-in)", controlName: "Quick Reload", room: BENCH,
      controlWhy: "CONTROL, today's closest stand-in: no pump preset exists, so the \"Quick Reload\" preset exactly as it ships (an impact-engine click, then a heavier clack 0.22 s later: the nearest thing to a \"chk-chk\" in the app). Bolt-Action Reload was the other candidate; it is four motions and a casing, so it is further from a rack.",
      listen: "A pump-action shotgun racked: the forend pulled back and pushed forward, \"chk-chk\". Which one is a SHOTGUN BEING RACKED, and which would you put in your game? Listen for the two strokes (back, then forward into battery), the forend sliding along the tube, and how heavy and solid the gun sounds.",
      takes: [
        { id: "light-polymer-crisp", why: "MODEL, a lighter shotgun with a POLYMER forend, fast, crisp game foley: the action unlocks, the forend runs back along the magazine tube (the tube's steel \"shhk\"), the bolt hits the rear (the lifter popping up just before), then forward: the lifter drops, the magazine spring pushes a shell, and the bolt slams into battery with the action locking.",
          st: gf({ gfAction: 3, gfFrame: POLY, gfWeight: 0.35, gfTempo: 0.85, gfCrisp: 0.9, gfSpring: 0.4, gfHandling: 0.1 }), seed: 91 },
        { id: "wood-natural-hull", why: "MODEL, a WOOD forend on a steel receiver, deliberate hands, NATURAL foley: slower strokes, more of the slide along the tube and the hands on the wood, softer contacts; the spent HULL ejected on the back stroke lands on a wooden floor ~0.75 s later (a dull tock, two small hops).",
          st: gf({ gfAction: 3, gfFrame: WOOD, gfWeight: 0.6, gfTempo: 0.3, gfCrisp: 0.1, gfSpring: 0.5, gfHandling: 0.7, gfCasing: 0.6, gfSurface: WOODF }), seed: 93 },
        { id: "heavy-steel-exaggerated", why: "MODEL, the HEAVIEST: an all-steel gun at full weight, exaggerated game foley: the hardest contacts, the longest rings on the two big hits, the most body thump and spring: the \"cinematic\" rack.",
          st: gf({ gfAction: 3, gfFrame: STEEL, gfWeight: 1, gfTempo: 0.6, gfCrisp: 1, gfSpring: 0.8, gfHandling: 0 }), seed: 97 },
      ] },
    "dry-fire": {
      title: "Dry Fire (a GAP: no preset owns it)", control: "Latch Click (stand-in)", controlName: "Latch Click", room: BENCH,
      controlWhy: "CONTROL, today's closest stand-in: no dry-fire preset exists, so \"Latch Click\" exactly as it ships (an impact-engine click, bright and short).",
      listen: "Pulling the trigger on an EMPTY gun: nothing fires, only the mechanism clicks. (Skipped in round 3 as a learned convention; this time each take is the real mechanism, so judge it as a gun.) Which one is the CLICK OF AN EMPTY GUN? Listen for the trigger, the hammer or striker falling on nothing, and whether it sounds like a gun's insides or a generic click.",
      takes: [
        { id: "striker-polymer-tick", why: "MODEL, a striker-fired POLYMER pistol: the trigger's take-up (a faint creep), the wall, the sear breaking, the striker snapping forward 2.5 ms later onto an empty chamber (a short dull \"tk\": the polymer frame swallows it), and the trigger's reset click ~0.3 s later as the finger lets go.",
          st: gf({ gfAction: 5, gfFrame: POLY, gfWeight: 0.3, gfTempo: 0.5, gfCrisp: 0.4, gfSpring: 0.5, gfHandling: 0.3 }), seed: 101 },
        { id: "hammer-revolver-click", why: "MODEL, a STEEL double-action REVOLVER: the long trigger pull turns the cylinder (a soft whir, the mainspring compressing, the cylinder locking into its notch), then the hammer falls on nothing: a bright, ringing \"click\" from a steel frame; the trigger returns later.",
          st: gf({ gfAction: 5, gfFrame: STEEL, gfWeight: 0.5, gfTempo: 0.5, gfCrisp: 0.5, gfSpring: 0.5, gfHandling: 0.3 }), seed: 103 },
        { id: "rifle-hammer-sproing", why: "MODEL, a RIFLE's hammer, crisp game foley: a short take-up, the trigger breaking, the hammer swinging onto the firing pin 7 ms later (a heavy \"clack\"), with the hammer spring's buzzy \"sproing\" after it, and the reset.",
          st: gf({ gfAction: 5, gfFrame: WOOD, gfWeight: 0.75, gfTempo: 0.5, gfCrisp: 0.9, gfSpring: 0.9, gfHandling: 0.1 }), seed: 107 },
      ] },
    "revolver-spin": {
      title: "Revolver Spin (a GAP: no preset owns it)", control: "Ratchet Wrench (stand-in)", controlName: "Ratchet Wrench", room: BENCH,
      controlWhy: "CONTROL, today's closest stand-in: no revolver preset exists, so \"Ratchet Wrench\" exactly as it ships (the servo engine's ratchet: a pawl over a toothed wheel, three strokes), the nearest mechanism in the app to a cylinder's ticking.",
      listen: "A revolver's cylinder opened, spun and closed (the gunslinger's flourish, or checking the chambers). Which one is a REVOLVER? Listen for the cylinder ticking past its stop as it spins and slows down, and for the solid close at the end.",
      takes: [
        { id: "spin-and-flick-shut", why: "MODEL, a steel revolver, crisp: the latch pressed, the cylinder swinging out to its stop, a finger's flick, the cylinder spinning (each of its six notches ticking past the stop, ~33 a second at first, slowing under friction to a stop over ~1 s: 17 ticks, a faint whir under it), then FLICKED SHUT: the crane slamming in, the latch snapping, the stop finding a notch as it settles.",
          st: gf({ gfAction: 4, gfFrame: STEEL, gfWeight: 0.5, gfTempo: 0.7, gfCrisp: 0.8, gfSpring: 0.5, gfHandling: 0.1 }), seed: 111 },
        { id: "gentle-natural", why: "MODEL, a lighter revolver handled gently, NATURAL foley: hands on the gun, a softer flick (fewer, slower ticks), deliberate pauses, the cylinder swung shut by hand rather than flicked: softer contacts throughout.",
          st: gf({ gfAction: 4, gfFrame: STEEL, gfWeight: 0.3, gfTempo: 0.3, gfCrisp: 0.1, gfSpring: 0.4, gfHandling: 0.7 }), seed: 113 },
        { id: "spin-shut-and-cock", why: "MODEL, a HEAVY revolver, crisp game foley: the spin and the flick shut, then the hammer COCKED: drawn back against the mainspring, the first click, the cylinder turning a chamber, the hammer's full-cock click and the cylinder locking (the Western \"click-clack\").",
          st: gf({ gfAction: 4, gfFrame: STEEL, gfWeight: 0.75, gfTempo: 0.6, gfCrisp: 0.9, gfSpring: 0.6, gfHandling: 0.1, gfCock: 1 }), seed: 117 },
      ] },
  };
  ROUNDS["bolt-action-reload-2"] = {
    title: "Bolt-Action Reload 2", control: "Bolt-Action Reload", room: BENCH,
    controlWhy: "the CURRENT preset \"Bolt-Action Reload\" exactly as it ships: two impact-engine clacks 0.45 s apart, two band-noise scrapes, a second pair of clacks, and the modal casing ping bouncing three times. (Round 1: \"doesn't really sound like a reload on any of them\": it, like round 1's three takes, is a bolt CYCLE, what happens between shots; nothing loaded ammunition.)",
    listen: "A bolt-action rifle RELOADED: the bolt opened, AMMUNITION put in, the bolt closed. (Round 1's takes only worked the bolt; these load rounds.) Which one is a RELOAD you would recognize in a game? Listen for the rounds going in (one by one, all at once off a clip, or a single round) and for the bolt closing on them.",
    takes: [
      { id: "thumbed-in", why: "MODEL, crisp game foley, a wood-and-steel rifle: bolt up and back, then FIVE rounds thumbed into the magazine one by one (each a brass-on-steel touch on the feed lips, a short push down against the magazine spring, which gets a little stiffer every round, and a click as it snaps under the lips: click ... click ... click ... click ... click), then the bolt forward (picking up the top round) and down.",
        st: gf({ gfAction: 9, gfLoad: 0, gfRounds: 5, gfFrame: WOOD, gfWeight: 0.65, gfTempo: 0.65, gfCrisp: 0.9, gfSpring: 0.6, gfHandling: 0.15 }), seed: 201 },
      { id: "stripper-clip", why: "MODEL, crisp game foley, a wood-and-steel rifle: bolt up and back, a stripper clip set into its guide (a tinny seat), the five rounds stripped down in ONE long push (~0.4 s: the column grinding down the clip, each round's rim ratcheting off the clip's rails and snapping into the magazine: \"zzzrrk\"), the empty clip flicked out of the guide (a light tinny tick; it lands off to the side), then the bolt home.",
        st: gf({ gfAction: 9, gfLoad: 1, gfFrame: WOOD, gfWeight: 0.65, gfTempo: 0.65, gfCrisp: 0.9, gfSpring: 0.6, gfHandling: 0.15, gfSurface: CONCRETE }), seed: 211 },
      { id: "single-round-sniper", why: "MODEL, the most game-like: a heavy rifle, very crisp: bolt up and snapped back, the fired case kicked out (a ping as it leaves the port; its landing left out, to keep it short), ONE round dropped into the port (a brass clunk on the follower), then the bolt driven forward and slammed down: the round chambering (\"ka-\") and the lugs locking ~55 ms later (\"-CHUNK\"), the heaviest hit, with the weight thump. Under a second.",
        st: gf({ gfAction: 9, gfLoad: 2, gfFrame: WOOD, gfWeight: 0.85, gfTempo: 0.8, gfCrisp: 1, gfSpring: 0.5, gfHandling: 0.1, gfSurface: CONCRETE }), seed: 221 },
    ] };
  const ORDER = ["quick-reload", "bolt-action-reload", "bolt-action-reload-2", "shell-casing", "ricochet-zing", "bullet-whiz", "pump-shotgun-rack", "dry-fire", "revolver-spin"];

  function renderModel(t) {
    const st = Object.assign({}, GUNFOLEY_DEFAULTS, t.st), cfg = gunfoleyCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeGunfoley(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms };
  }
  function renderTake(t, round) {
    if (t.control) {
      const o = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
      return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), info: null };
    }
    const { r, cfg, ms } = renderModel(t);
    // a little room for the tail (the reverb needs somewhere to ring), then the round's room
    const pad = Math.round(0.15 * SR), n = r.n + pad, L = new Float32Array(n), R = new Float32Array(n);
    L.set(r.L); R.set(r.R);
    const room = round.room;
    if (room && room.reverb > 0) dctx.reverbProcess(L, R, room.reverbSize, room.reverbTone, room.reverb);
    const fo = Math.floor(0.06 * SR);
    for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
    return { L, R, info: r.info, cfg, ms };
  }

  // ---- measurement (we cannot listen)
  function fft(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j], vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi; re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  function spectrum(x, a, N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N && a + i < x.length; i++) re[i] = x[a + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im); const p = new Float64Array(N / 2); for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]; return p;
  }
  // transients: a 1 ms peak envelope; an ONSET where it rises 10 dB over the quietest of the previous 15 ms and sits
  // within 36 dB of the take's peak, no two within 25 ms. ATTACK: from the first sample at 10% of the event's own peak
  // (the next 15 ms) to the first sample within 3 dB of it (the perceptual onset; a body's bloom after it is not attack).
  function onsets(mono) {
    const F = Math.round(0.001 * SR), nf = Math.floor(mono.length / F), env = new Float64Array(nf);
    let gpk = 0;
    for (let f = 0; f < nf; f++) { let m = 0; for (let i = f * F; i < (f + 1) * F; i++) m = Math.max(m, Math.abs(mono[i])); env[f] = m; gpk = Math.max(gpk, m); }
    const db = (x) => 20 * Math.log10(x / gpk + 1e-9), out = [];
    let last = -1e9;
    for (let f = 1; f < nf; f++) {
      let mn = Infinity; for (let j = Math.max(0, f - 15); j < f; j++) mn = Math.min(mn, env[j]);
      if (db(env[f]) > -36 && db(env[f]) - db(mn) > 10 && f - last >= 25) {
        const a = f * F, b = Math.min(mono.length, a + Math.round(0.015 * SR) + F);
        let pk = 0, ip = a; for (let i = Math.max(0, a - F); i < b; i++) if (Math.abs(mono[i]) > pk) { pk = Math.abs(mono[i]); ip = i; }
        let i10 = Math.max(0, a - F); while (i10 < ip && Math.abs(mono[i10]) < 0.1 * pk) i10++;
        let i70 = i10; while (i70 < ip && Math.abs(mono[i70]) < 0.708 * pk) i70++;
        out.push({ t: (i10 / SR) * 1000, db: db(pk), att: (i70 - i10) / SR * 1000, toPk: (ip - i10) / SR * 1000 });
        last = f;
      }
    }
    return out;
  }
  function measure(L, R) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e2 = Math.floor(0.002 * SR); let eS = 0, eE = 0;
    for (let i = 0; i < e2; i++) { eS = Math.max(eS, Math.abs(L[i]), Math.abs(R[i])); eE = Math.max(eE, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeS: eS / (pk || 1), edgeE: eE / (pk || 1) };
    let N = 1; while (N < n) N <<= 1;
    const p = spectrum(mono, 0, N); let all = 0, num = 0, hi = 0, lo = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; all += p[k]; num += f * p[k]; if (f > 4000) hi += p[k]; if (f < 500) lo += p[k]; }
    m.centroid = num / (all || 1); m.hi4k = hi / (all || 1); m.lo500 = lo / (all || 1);
    const W = Math.round(0.05 * SR), lv = [];
    for (let a = 0; a + W <= n; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += mono[i] * mono[i]; lv.push(s / W); }
    const mx = Math.max(...lv);
    m.env = lv.map((v) => Math.round(10 * Math.log10(v / mx + 1e-12))).join(" ");
    const B = Math.min(n, Math.floor(0.4 * SR)); let best = 0;
    for (let a = 0; a + B <= n; a += Math.floor(0.05 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += mono[i] * mono[i]; best = Math.max(best, s / B); }
    m.crest = 20 * Math.log10(pk / Math.sqrt(best || 1e-20));
    m.on = onsets(mono);
    const loud = m.on.reduce((a, o) => (o.db > a.db ? o : a), { db: -1e9 });
    m.attFirst = m.on.length ? m.on[0].att : null; m.attLoud = loud.att;
    return m;
  }

  function run(name) {
    const round = ROUNDS[name];
    const ctrl = preset(round.controlName || round.control);
    const takes = [{ id: "control", control: true, why: round.controlWhy, patch: ctrl }].concat(round.takes);
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(t, round), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R), file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const i = r.info;
      const line = m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", NaN " + m.nan + ", edges " + m.edgeS.toFixed(3) + "/" + m.edgeE.toFixed(4) +
        ", centroid " + Math.round(m.centroid) + " Hz, >4 kHz " + (100 * m.hi4k).toFixed(0) + "%, <500 Hz " + (100 * m.lo500).toFixed(0) + "%, crest " + m.crest.toFixed(1) + " dB" +
        ", attack (10% to -3 dB) " + (m.attFirst != null ? m.attFirst.toFixed(2) : "-") + " ms first event / " + (m.attLoud != null ? m.attLoud.toFixed(2) : "-") + " ms loudest" + (lim ? ", Limiter " + lim : "");
      const detail = "level per 50 ms (dB): " + m.env +
        "\n      onsets (ms, dB re peak): " + m.on.map((o) => Math.round(o.t) + " (" + Math.round(o.db) + ")").join(", ") +
        (i ? "\n      script (ms): " + i.events.map((e) => e[0] + " " + e[1]).join(" | ") +
          (i.landings.length ? "\n      case landings (ms): " + i.landings.join(" ") + "; gaps " + i.landings.slice(1).map((x, k) => x - i.landings[k]).join(" ") : "") +
          (i.whine ? "\n      whine: " + JSON.stringify(i.whine) : "") + (i.pass ? "\n      pass: " + JSON.stringify(i.pass) : "") +
          "\n      energy (x the " + i.ref + "): " + Object.entries(i.energies).map(([k, v]) => k + " " + v.toFixed(3)).join(", ") +
          "\n      render " + r.ms.toFixed(0) + " ms for " + (i.dur).toFixed(2) + " s = " + (r.ms / i.dur).toFixed(0) + " ms per second of audio" : "");
      console.log("  " + file + "  " + t.id.padEnd(24) + line + "\n      " + detail);
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target"); if (!t.control && m.edgeE > 0.02) bad.push("end edge"); if (!t.control && m.edgeS > 0.05) bad.push("start edge");
      if (bad.length) console.log("    !! " + bad.join(", "));
      key.push({ file, t, line, detail, lim });
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is " + (round.controlName ? "today's closest stand-in (no preset owns this sound)" : "the sound the app makes today") + ".\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" +
      "Model takes are the gun foley prototype's stereo output with the round's room (dsp.js `reverbProcess`: " + JSON.stringify(round.room) + "), no other chain; the control is rendered by the exported engine exactly as `tools/make-ab.mjs` does. Times in the script and the onsets are milliseconds from the start of the file.\n\n" +
      "**Each take stands alone as its own event** (no shot in front of it). They are designed to sit AFTER a gunshot from the gun engine: the gunshot presets carry no after-sound (no rack, no slide, no casing), so these are exactly what a user layers onto a shot themselves.\n\n" +
      key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\nMeasured: " + k.line + "\n\n```\n" + k.detail.replace(/\n\s+/g, "\n") + "\n```\n\n" +
        (k.lim ? "Note: its peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.lim + " before matching.\n\n" : "") +
        "```json\n" + JSON.stringify(k.t.control ? k.t.patch : { st: k.t.st, seed: k.t.seed }) + "\n```\n").join("\n"));
  }

  function cost() {
    const rows = [];
    for (const name of ORDER) for (const t of ROUNDS[name].takes) {
      let best = Infinity, sec = 0;
      for (let k = 0; k < 5; k++) { const { r, ms } = renderModel(t); best = Math.min(best, ms); sec = r.n / SR; }
      rows.push([name + "/" + t.id, best, sec]);
      console.log((name + "/" + t.id).padEnd(44) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    const per = rows.map((r) => r[1] / r[2]).sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  mkdirSync(OUT, { recursive: true });
  for (const n of want ? [want] : ORDER) { if (!ROUNDS[n]) { console.error("no round " + n + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(n); }
  writeFileSync(join(OUT, "README.md"), README);
  console.log("\n-> " + OUT);
}

const README = `# Gun foley engine prototype: listening round

A PROTOTYPE engine, "gun foley": everything around the shot that sells a gun (reloads, bolts, a pump rack, a revolver's
cylinder, dry fire, casings, ricochets, bullets passing), against today's presets. Made by
\`node tools/proto/gunfoley.mjs\` (the model, \`makeGunfoley\`, and this round are both in that file). Nothing in the app
changed. The gunshots themselves are another agent's round; these are the sounds AROUND them.

**Every take stands alone as its own event**: no shot in front of a rack, a reload or a casing. AJ's call (2026-11-13):
the gunshot presets carry NO after-sound ("if the user wants something like that they can add it themselves"), so
these are designed to sit after a gun-engine shot and are exactly what a user layers onto one.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one sounds most like the thing (and which you would put in your game),
and a runner-up. **One take in each folder is the control**: today's preset where one exists; for the three GAPS
(no preset owns them) today's closest stand-in, named in KEY.md. Then read \`KEY.md\`.

| # | folder | the sound | control |
|---|---|---|---|
| 1 | quick-reload | a magazine reload | Quick Reload, as it ships |
| 2 | bolt-action-reload | a bolt worked by hand | Bolt-Action Reload, as it ships |
| 2b | bolt-action-reload-2 | a bolt-action RELOAD: rounds thumbed in, a stripper clip, a single round (round 1 only cycled the bolt) | Bolt-Action Reload, as it ships |
| 3 | shell-casing | a spent case hitting the floor | Shell Casing, as it ships |
| 4 | ricochet-zing | a bullet glancing off and whining away | Ricochet Zing, as it ships |
| 5 | bullet-whiz | a bullet passing close | Bullet Whiz, as it ships |
| 6 | pump-shotgun-rack | "chk-chk" (a GAP) | Quick Reload (stand-in) |
| 7 | dry-fire | the click of an empty gun (a GAP) | Latch Click (stand-in) |
| 8 | revolver-spin | a cylinder spun and closed (a GAP) | Ratchet Wrench (stand-in) |

The three model takes in each folder are BRACKETED: different guns and different styles (a light polymer pistol against
a heavy steel rifle; crisp, exaggerated game foley against natural foley with hands on the gun; concrete, wood, dirt
and a steel deck under the casings; a slug flying past you against one flying away; a supersonic snap against a
subsonic whiz). If two of them are right for different games, say so: two winners become a preset and an alternate.

## What the engine is

A gun's mechanism as METAL AND POLYMER PARTS MEETING. Every part (a slide, a barrel, a magazine, a catch, a bolt, a
hammer, a cylinder) is a small resonator: bright, short metallic rings at its own modes. Every motion is one of: a
CONTACT (two parts meeting: the contact's hardness sets how bright it is; the gun's body takes the same hit through its
joints, so there is a "chunk" under every "tick"), a SLIDE (friction along a rail or a raceway: tiny asperity
contacts driving the sliding part's own ring), a SPRING (a coil's dispersive "ting" or "sproing"), or HANDS on the gun.
The body is polymer (a dull tok), steel (it rings) or wood and steel (the stock's hollow knock). Weight scales every
part. A script of events with human timing makes each action. Casings are brass tubes (or a plastic hull) bouncing with
physical, shrinking gaps on concrete, wood, dirt or steel; a ricochet is the hit and then a tumbling slug's whistle
through the real Doppler of its path; a bullet pass is a supersonic N-wave (with its ground reflection) or a subsonic
whiz.

## Cues that are not the question

- **Lengths:** the reloads and racks are whole actions (0.7-1.6 s) against Quick Reload's 0.5 s; the casings bounce for
  as long as physics says (about a second). Judge which sounds like the thing, not which is shorter.
- **Bullet Whiz:** today's preset includes the gun's report arriving after the crack (the blast engine downrange); the
  model takes are the pass alone. Judge the pass.
- **The room:** the model takes carry a small dry room (reload, casing, dry fire, revolver) or a little outdoor air
  (ricochet, bullet), the app's own reverb; the controls are rendered whole, as they ship.
- **Peaks:** a mechanism is peaky (every clack is a few milliseconds), so some takes needed the app's own Limiter to
  reach -18 LUFS; KEY.md says which.
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) runCli();
