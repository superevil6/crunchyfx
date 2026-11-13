/* horror-redo-named.mjs — 29 NAMED HORROR presets checked against the engines built since they were written (most are a
 * plain oscillator: a sine, saw, square or triangle with noise, a filter and a boom). AJ: "What about robot and horror
 * noises? Can we sweep those to see if our new engines suit them better?" PROPOSAL / A-B material: nothing here is wired
 * into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better. (The 31 adjective x noun Horror
 * family, Ghastly Murmur ... Wretched Murmur, and the robot sounds are other rounds; Creaking Door and Floorboard Creak are
 * already on the friction engine and are left alone.)
 *
 *   node tools/proto/horror-redo-named.mjs            renders every redesign (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/horror-redo-named.mjs ref        measures today's 29 (and the whole Horror section: the level bar)
 *   node tools/proto/horror-redo-named.mjs sep        separation only (the new set against itself and the creature presets)
 *   node tools/proto/horror-redo-named.mjs <slug>     one sound, measured, its two WAVs written (no JSON, no all-new.wav)
 *   node tools/proto/horror-redo-named.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/horror-redo-named.mjs x '<js>' ...         measure patches built with the voices below (cr(), wind() ...,
 *                                                               or S["Ghost Moan"]() for a design)
 *   node tools/proto/horror-redo-named.mjs env '<js>' [ms]      the level envelope of one, dB per block
 *   node tools/proto/horror-redo-named.mjs track '<js>' [ms]    level, centroid, strongest peak and YIN f0 per block
 *   node tools/proto/horror-redo-named.mjs js '<code>'          run code with the voices in scope (the friction seed sweep)
 *
 * THE QUESTION PER SOUND is what the sound physically IS, and whether an engine models that:
 *   a ghost's or a demon's VOICE (wail, moan, scream, roar, laugh, whisper) -> the CREATURE engine (28): a larynx with
 *     jitter / shimmer / roughness / breath into a tract whose mouth and vowel move. A WHISPER is that tract with the
 *     breath up and the voice high-passed away (the creature always voices; the aspiration runs through the same moving
 *     formants, so what is left over 700 Hz is a whispered vowel). Formant (13) stays reserved for the voice presets.
 *   AIR (a void, wind in a dark place, a draught that breathes) -> the WEATHER engine's wind (29), whose hollow low-Q
 *     whistles are "a chimney, a cave mouth".
 *   a BOWED string (a riser, a stinger's string stab, a cello drone) -> BOWED (22); a scrape that squeals (nails on a
 *     board) -> FRICTION (34), stick-slip locking onto the board's own ring.
 *   BELLS and CHIMES -> MODAL (10); the MUSIC BOX -> BAR (24) as a tine (a music box's comb).
 *   HITS (a jump scare's slam, a bone's crack, a heartbeat's thud) -> IMPACT (19) and BLAST (31); a bone's splinter and
 *     a swarm's legs -> PARTICLE (15).
 *   A plain oscillator stays where the sound IS abstract synthesis (a dead tone, a dread pulse): KEPT, with the reason.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does, Normalize
 * ON and NOT loudness-matched: each WAV is what the app's button plays. `gain` on layer 1 (the master gain of the whole
 * sound) is the one number not from a design: it lands the integrated loudness on today's Horror-section median plus a
 * stated per-sound offset (a whisper sits lower, a jump scare higher); a Limiter only where gain 1 cannot reach it.
 *
 * Writes soundtests/horror-redo/named/<slug>-1-now.wav, <slug>-2-new.wav, all-new.wav + KEY.md, and
 * tools/new-presets/horror-redo-named.json ({ name: patch with _vary, optional layers }).
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
const HORROR = CATS.find((c) => c[0] === "Horror")[1];
const ALL = ["Void Thump", "Dead Tone", "Ominous Heartbeat", "Jump Scare Stinger", "Horror Drone", "Ghostly Wail", "Demonic Roar", "Creepy Whisper",
  "Heartbeat", "Distant Scream", "Sinister Laugh", "Music Box", "Tension Riser", "Ghost Breath", "Nails on Chalkboard", "Ominous Bell", "Rattling Chains",
  "Possessed Screech", "Dread Pulse", "Skittering Swarm", "Ghost Moan", "Jumpscare Hit", "Whispering Void", "Demon Whisper", "Bone Crack", "Cursed Chime",
  "Jump Scare Stinger 2", "Ghostly Wail 2", "Heartbeat 2"];
// the creature presets a new voice must stay clear of (every wave-28 preset in Animal / Monster, alts included)
const CREATURE_REF = CATS.find((c) => /Animal/.test(c[0]))[1].filter((n) => PRESETS[n] && PRESETS[n].wave === 28);

// ============================================================================================================
// THE VOICES (each a full patch for one layer; drive 0 unless asked: the default 0.1 is a tanh(5x) nobody asked for)
// creature voice. o.f = pitch at the call's peak; ps/pe = semitones at the start / end; open/vowel: [start, peak, end] / [start, end]
function cr(o) {
  const p = { wave: 28, freq: Math.round(o.f), crSize: r2(o.size ?? 1), crPitchStart: r2(o.ps ?? 0), crPitchEnd: r2(o.pe ?? 0), crPeak: r2(o.peak ?? 0.4),
    crOpenStart: r2(o.open[0]), crOpenPeak: r2(o.open[1]), crOpenEnd: r2(o.open[2]), crVowelStart: r2(o.vowel[0]), crVowelEnd: r2(o.vowel[1]),
    crNasal: r2(o.nasal || 0), crTension: r2(o.tension ?? 0.5), crJitter: r2(o.jitter ?? 0.2), crShimmer: r2(o.shimmer ?? 0.2), crRough: r2(o.rough || 0),
    crBreath: r2(o.breath || 0), attack: r3(o.atk ?? 0.03), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.3),
    duration: r2(o.dur), filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 18000), reso: 0, drive: r2(o.drive || 0), width: o.width ?? 0.4 };
  if (o.drive) p.driveOS = 2;
  if (o.flutter) { p.crFlutter = r2(o.flutter); p.crFlutterRate = r2(o.flutterRate || 20); }
  if (o.vib) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate || 5); if (o.vibOnset) p.vibOnset = r2(o.vibOnset); }
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); if (o.arp) p.arpStep = o.arp; }
  return space(p, o);
}
// shared Space settings: reverb, delay
function space(p, o) {
  if (o.reverb) Object.assign(p, { reverb: r2(o.reverb), reverbSize: r2(o.reverbSize ?? 0.8), reverbTone: r2(o.reverbTone ?? 0.4) });
  if (o.delay) Object.assign(p, { delay: r2(o.delay), delayTime: r3(o.delayTime ?? 0.3), delayFb: r2(o.delayFb ?? 0.4) });
  return p;
}
// weather wind (hollow moans through the low-Q whistles; freq = the whistle's pitch)
function wind(o) {
  const p = { wave: 29, wxType: 0, wxIntensity: r2(o.int), wxGust: r2(o.gust ?? 0.5), wxGustRate: r2(o.gustRate ?? 0.8), wxTone: r2(o.tone ?? 0.4),
    wxBody: r2(o.body ?? 0.3), wxWhistles: o.whistles || 0, wxWhistle: r2(o.whistle || 0), wxSeed: o.seed, width: o.width ?? 0.7,
    attack: r3(o.atk), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.4), duration: r2(o.dur),
    filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 18000), reso: 0, drive: 0 };
  if (o.whistles) { p.freq = Math.round(o.f || 400); p.wxWhistleQ = Math.round(o.q ?? 40); }
  return space(p, o);
}
// bowed string (the amp envelope is the bow speed)
function bow(o) {
  const p = { wave: 22, freq: Math.round(o.f), bowSpeed: r2(o.speed ?? 0.5), bowPressure: r2(o.press ?? 0.75), bowPos: r2(o.pos ?? 0.39), bowTone: r2(o.tone ?? 0.5),
    bowString: r2(o.string ?? 0.3), attack: r3(o.atk ?? 0.05), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.3),
    duration: r2(o.dur), filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 18000), reso: 0, drive: r2(o.drive || 0), width: o.width ?? 0.4 };
  if (o.drive) p.driveOS = 2;
  if (o.trem) { p.bowTrem = r2(o.trem); if (o.tremPhase) p.bowTremPhase = r2(o.tremPhase); }
  if (o.vib) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate || 5); p.vibOnset = r2(o.vibOnset ?? 0.3); }
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); }
  return space(p, o);
}
// modal struck object (bells, chimes, chain links)
function modal(o) {
  const p = { wave: 10, freq: Math.round(o.f), modalPartials: o.parts ?? 8, modalInharm: r2(o.inharm), modalDecay: r2(o.decay), modalBright: r2(o.bright ?? 0.5),
    attack: r3(o.atk ?? 0.002), hold: r3(o.hold ?? 0.01), decay: r3(o.dec ?? 0.1), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.6), duration: r2(o.dur),
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0.1, drive: r2(o.drive || 0), width: o.width ?? 0.5 };
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); if (o.arp) p.arpStep = o.arp; }
  if (o.vib) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate || 5); }
  if (o.sweep) p.sweep = r2(o.sweep);
  if (o.sub) p.subOsc = r2(o.sub);
  if (o.conv) Object.assign(p, { convMix: r2(o.conv), convType: o.convType ?? 1, convSize: r2(o.convSize ?? 2.5), convTone: r2(o.convTone ?? 0.4) });
  return space(p, o);
}
// bar (tine = a music box's comb); notes = a repeat burst stepping arpStep
function bar(o) {
  const p = { wave: 24, freq: Math.round(o.f), barType: o.type ?? 4, barMallet: r2(o.mallet ?? 1), barRing: r2(o.ring ?? 1), barMotor: 0,
    attack: 0, hold: 0, decay: 0, sustain: 1, release: r3(o.rel ?? 2.5), duration: r2(o.dur), filterMode: 0, cutoff: Math.round(o.cut || 18000), reso: 0, drive: 0, width: o.width ?? 0.3 };
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); if (o.arp) p.arpStep = o.arp; }
  if (o.vib) { p.vibDepth = r3(o.vib); p.vibRate = r2(o.vibRate || 5); }
  return space(p, o);
}
// impact (a hit) with its boom
function imp(o) {
  const p = { wave: 19, impactTone: r2(o.tone), impactDecay: r2(o.decay), impactPunch: r2(o.punch ?? 0.8), impactGrit: r2(o.grit ?? 0.3),
    attack: 0.001, hold: r3(o.hold || 0), decay: r3(o.dec ?? 0.1), sustain: 0, release: r3(o.rel ?? 0.2), duration: r2(o.dur),
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: r2(o.reso ?? 0.1), drive: r2(o.drive || 0), width: o.width ?? 0.5 };
  if (o.drive) p.driveOS = 2;
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(o.boomFreq || 60), boomDrop: r2(o.boomDrop ?? 0.6), boomDecay: r2(o.boomDecay ?? 0.25) });
  if (o.repeat) { p.repeat = o.repeat; p.rate = r2(o.rate); }
  return space(p, o);
}
// blast (a pressure wave through a place); the place is the engine's room, so reverb 0
function blast(o) {
  return { wave: 31, blastSize: r2(o.size), blastDist: Math.round(o.dist || 10), blastEnv: o.env ?? 2, blastRoom: r2(o.room ?? 1), blastTail: r2(o.tail ?? 1),
    blastPulse: r2(o.pulse ?? 1), blastShape: r2(o.shape ?? 1), blastRoar: r2(o.roar ?? 0.2), blastRumble: r2(o.rumble ?? 0.5), blastDebris: 0,
    blastSeed: o.seed, blastPeak: r2(o.peak ?? 0.5), width: o.width ?? 0.6, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06,
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0.31, drive: 0, reverb: 0, duration: r2(o.dur || 1.2) };
}
// particle (ticks, splinters, legs)
function part(o) {
  const p = { wave: 15, particleRate: Math.round(cl(o.rate, 5, 200)), particleTone: r2(o.tone), particleDecay: r2(o.decay), particleSpread: r2(o.spread ?? 0.5),
    attack: r3(o.atk ?? 0.01), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.1), duration: r2(o.dur),
    filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 12000), reso: 0, drive: r2(o.drive || 0), width: o.width ?? 0.7 };
  if (o.flicker) { p.flicker = r2(o.flicker); p.flickerRate = r2(o.flickerRate || 8); }
  return space(p, o);
}
// friction (stick-slip on a body; freq = the body's size). speed / press: [[t, v], ...] (the first t is 0); stop: when it stops
function fric(o) {
  const p = { wave: 34, fricBody: o.body, freq: Math.round(o.f), fricTone: r2(o.tone ?? 0.5), fricGrip: r2(o.grip ?? 0.6), fricRough: r2(o.rough ?? 0.4),
    fricLock: r2(o.lock ?? 0.5), fricSeed: o.seed, attack: 0.001, hold: r3(Math.max(0, o.stop - 0.031)), decay: 0.03, sustain: 0, release: 0.01,
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0, drive: 0, width: o.width ?? 0.4, duration: r2(o.dur || o.stop + 0.3), fricStop: r3(o.stop) };
  o.speed.forEach(([t, v], i) => { if (i === 0) p.fricSpeed = r2(v); else { p["fricT" + i] = r3(t); p["fricSpeed" + i] = r2(v); } });
  o.press.forEach(([t, v], i) => { if (i === 0) p.fricPress = r2(v); else { p["fricPressT" + i] = r3(t); p["fricPress" + i] = r2(v); } });
  return space(p, o);
}
// a plain oscillator layer (sub thumps under a hit)
function osc(o) {
  const p = Object.assign({ wave: 0, attack: 0.001, hold: 0, decay: 0.2, sustain: 0, release: 0.2, filterMode: 0, cutoff: 18000, reso: 0, drive: 0, width: 0.2 }, o);
  return p;
}
// A sound = layer 1's patch + layers 2-4 as the JSON string the app stores ({ s, d, g, p })
function sound(base, extra, master) {
  const p = Object.assign({}, base, master || {});
  const ls = (extra || []).filter(Boolean).map(([s, d, g, pt]) => ({ s, d: r3(d), g: r2(g), p: pt || 0 }));
  if (ls.length > 3) throw new Error("more than 4 layers");
  if (ls.length) p.layers = JSON.stringify(ls);
  return p;
}
const STRETCH = new Set([27, 29, 30, 31, 35]);   // engines whose Duration slider stretches past 2 s

// ============================================================================================================
// MEASUREMENT (loudness as tools/proto/fire-redo.mjs; YIN as tools/proto/creature-redo-named.mjs)
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
// YIN (de Cheveigne & Kawahara 2002) on the mono mix, every 20 ms; ap = the normalized-difference dip (0 = a clean periodic
// tone, toward 1 = noise). Frames under -40 dB of the peak are skipped.
function yinTrack(x, fmin, fmax, hop = 0.02, win = 0.04, thr = 0.15) {
  const W = Math.round(win * SR), tauMax = Math.min(W - 2, Math.ceil(SR / fmin)), tauMin = Math.floor(SR / fmax), H = Math.round(hop * SR);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
  const out = [], d = new Float64Array(tauMax + 1), cm = new Float64Array(tauMax + 1);
  for (let a = 0; a + W + tauMax < x.length; a += H) {
    let e = 0; for (let i = 0; i < W; i++) e += x[a + i] * x[a + i];
    if (Math.sqrt(e / W) < pk * 0.01) continue;
    for (let tau = 1; tau <= tauMax; tau++) { let s = 0; for (let i = 0; i < W; i++) { const q = x[a + i] - x[a + i + tau]; s += q * q; } d[tau] = s; }
    let run = 0, best = -1; cm[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) { run += d[tau]; cm[tau] = d[tau] * tau / (run || 1e-12); }
    for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < thr) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
    if (best < 0) { let m = 1e9; for (let tau = Math.max(2, tauMin); tau < tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; } }
    const a0 = cm[best - 1], b0 = cm[best], c0 = cm[best + 1] ?? b0, den = a0 - 2 * b0 + c0;
    const t = den !== 0 ? best + 0.5 * (a0 - c0) / den : best;
    out.push({ t: a / SR, f: SR / t, ap: Math.min(1, b0), e });
  }
  return out;
}
// one 2048-sample Hann DFT on bins every 100 Hz to 16 kHz: centroid, < 250 Hz share, > 4 kHz share
const SPN = 2048, SPK = 160, SPC = [], SPS = [], SPH = new Float64Array(SPN);
for (let i = 0; i < SPN; i++) SPH[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SPN - 1));
for (let k = 1; k < SPK; k++) { const w = 2 * Math.PI * (k * 100) / SR, c = new Float64Array(SPN), s = new Float64Array(SPN); for (let i = 0; i < SPN; i++) { c[i] = Math.cos(w * i); s[i] = Math.sin(w * i); } SPC.push(c); SPS.push(s); }
function spectrum(x, a) {
  let num = 0, den = 0, lo = 0, hi = 0;
  const v = new Float64Array(SPN); for (let i = 0; i < SPN; i++) v[i] = x[a + i] * SPH[i];
  for (let k = 1; k < SPK; k++) {
    const f = k * 100, C = SPC[k - 1], S = SPS[k - 1]; let re = 0, im = 0;
    for (let i = 0; i < SPN; i++) { re += v[i] * C[i]; im -= v[i] * S[i]; }
    const m = re * re + im * im; num += f * m; den += m;
    if (f < 250) lo += m; if (f > 4000) hi += m;
  }
  return { cent: den > 0 ? num / den : 0, lo: den > 0 ? lo / den : 0, hi: den > 0 ? hi / den : 0, e: den };
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
  const E = Math.round(0.05 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / E + 1e-12)); }
  const mx = Math.max(...env), imx = env.indexOf(mx), f0i = Math.max(0, Math.floor(first / E));
  for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], mx - 50);
  let iatk = f0i; while (iatk < imx && env[iatk] < mx - 3) iatk++;
  const atk = Math.max(0.025, (iatk - f0i + 0.5) * 0.05);
  const i80 = Math.min(env.length - 1, Math.floor((first + 0.8 * span * SR) / E)), end80 = env[i80] - mx;
  // EVENTS: 20 ms level steps of +8 dB or more over the 100 ms before the frame preceding them (beats, shots, syllables, links), per second
  const E20 = Math.round(0.02 * SR), e20 = [];
  for (let a = 0; a + E20 <= n; a += E20) { let q = 0; for (let i = a; i < a + E20; i++) q += mono[i] * mono[i]; e20.push(10 * Math.log10(q / E20 + 1e-12)); }
  const m20 = Math.max(...e20); let evN = 0, lastEv = -99;
  for (let i = 0; i < e20.length; i++) {
    if (e20[i] < m20 - 30 || i - lastEv < 4) continue;
    let pre = -1e9; for (let j = Math.max(0, i - 6); j < i - 1; j++) pre = Math.max(pre, e20[j]);   // the frame just before may be the rise itself
    if (e20[i] > Math.max(pre, m20 - 45) + 8) { evN++; lastEv = i; }
  }
  // TEXTURE: the fast level movement (5 ms against its 100 ms average): crackle, rattle, tremolo
  const E5 = Math.round(0.005 * SR), e5 = [];
  for (let a = 0; a + E5 <= n; a += E5) { let q = 0; for (let i = a; i < a + E5; i++) q += mono[i] * mono[i]; e5.push(10 * Math.log10(q / E5 + 1e-12)); }
  const m5 = Math.max(...e5); let ts = 0, tn = 0;
  for (let i = 0; i < e5.length; i++) e5[i] = Math.max(e5[i], m5 - 40);
  for (let i = 10; i < e5.length - 10; i++) { if (e5[i] < m5 - 30) continue; let av = 0; for (let j = i - 10; j <= i + 10; j++) av += e5[j]; av /= 21; ts += (e5[i] - av) ** 2; tn++; }
  const texture = tn ? Math.sqrt(ts / tn) : 0;
  // SPECTRUM over the loud part
  let cn = 0, cd = 0, lo = 0, hi = 0;
  for (let a = 0; a + 2048 < n; a += Math.round(0.05 * SR)) {
    let e = 0; for (let i = a; i < a + 2048; i++) e += mono[i] * mono[i];
    if (10 * Math.log10(e / 2048 + 1e-12) < mx - 20) continue;
    const s = spectrum(mono, a); cn += s.cent * e; lo += s.lo * e; hi += s.hi * e; cd += e;
  }
  // PITCH: YIN over the loud frames (within 20 dB of the loudest): median f0 of the periodic ones and the mean dip
  const tr = yinTrack(mono, 35, 2000);
  const emx = Math.max(1e-12, ...tr.map((p) => p.e)), loud = tr.filter((p) => p.e > emx * 0.01);
  const ap = loud.length ? loud.reduce((s, p) => s + p.ap, 0) / loud.length : 1;
  const vf = loud.filter((p) => p.ap < 0.25), f0 = vf.length ? median(vf.map((p) => p.f)) : 0;
  const third = (k) => { const s = vf.slice(Math.floor(k * vf.length / 3), Math.ceil((k + 1) * vf.length / 3)); return s.length ? median(s.map((p) => p.f)) : 0; };
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R),
    cent: cd ? cn / cd : 0, lo: cd ? lo / cd : 0, hi: cd ? hi / cd : 0, events: evN, texture, atk, maxAt: imx * 0.05 - first / SR, end80,
    ap, voiced: loud.length ? vf.length / loud.length : 0, f0, f0a: third(0), f0b: third(1), f0c: third(2) };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1) +
    "\n      centroid " + (m.cent / 1000).toFixed(2) + "k  <250Hz " + (100 * m.lo).toFixed(0) + "%  >4k " + (100 * m.hi).toFixed(0) + "%  events " + m.events +
    "  texture " + m.texture.toFixed(1) + " dB  attack " + m.atk.toFixed(2) + " s  peak at " + m.maxAt.toFixed(2) + " s  at 80% " + m.end80.toFixed(0) + " dB" +
    "\n      pitch " + (m.f0 ? m.f0.toFixed(0) + " Hz (" + m.f0a.toFixed(0) + " > " + m.f0b.toFixed(0) + " > " + m.f0c.toFixed(0) + ")" : "none") +
    "  voiced " + (100 * m.voiced).toFixed(0) + "%  aperiodicity " + m.ap.toFixed(2);
}
// The feature vector for separation (1 = a clearly audible step): length log2 of the audible span; brightness log2 of the
// centroid; rumble and hiss shares x 3; events log2(1 + count) (one hit, a lub-dub, a burst of eight); texture dB / 3;
// attack log2 / 1.5; where it peaks x 2; what is left at 80% (dB / 12); tonality: aperiodicity / 0.2; and PITCH, log2 of
// the median f0, counted only when both sounds are mostly voiced (a pitch is not a feature of a hiss).
function features(m) {
  return [Math.log2(m.span), Math.log2(Math.max(100, m.cent)), 3 * m.lo, 3 * m.hi, Math.log2(1 + m.events), Math.min(m.texture, 9) / 3,
    Math.log2(m.atk) / 1.5, 2 * cl(m.maxAt / m.span, 0, 1), cl(m.end80, -40, 0) / 12, m.ap / 0.2, m.voiced > 0.5 && m.f0 ? Math.log2(m.f0) : NaN];
}
const FEAT = ["length", "bright", "rumble", "hiss", "events", "texture", "attack", "peakpos", "tail", "noisy", "pitch"];
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; if (!isNaN(d)) s += d * d; } return Math.sqrt(s); }
function why(a, b) { return FEAT.map((k, i) => [k, Math.abs(a[i] - b[i])]).filter((x) => !isNaN(x[1])).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => k + " " + v.toFixed(2)).join(", "); }

// ============================================================================================================
// THE DESIGNS (one function per redesigned name; KEPT names have none, see KEPT below)
const S = {};

// ---- hits and thumps ------------------------------------------------------------------------------------------
// Void Thump: a deep thump heard in a vast empty hall: the blast engine's pressure wave, huge and Weight-stretched into a
// long low pulse, far enough that the air has taken every high, indoors with a long room (the "void" is the room). Today
// is a 52 Hz sine with a boom, filtered at 260 Hz, at -22.9 LUFS: on a small speaker it is nearly nothing.
S["Void Thump"] = () => blast({ size: 0.95, pulse: 5, shape: 0.6, dist: 120, env: 2, room: 1.4, tail: 2, roar: 0, rumble: 0.8, seed: 211, peak: 0.6, dur: 2 });

// HEARTBEATS: a beat is two closures of the heart's valves, "lub" (louder, lower, longer) then "dub" ~0.3 s later, heard
// through a chest as muffled low thuds. Each thud is the impact engine at its lowest tone with almost no grit and a boom
// for the chest's thump, low-passed: a real attack (audible on a small speaker, which a sine-only thud is not) that does
// not click. The three presets are three hearts: Heartbeat one calm close beat at 72 bpm (0.83 s: it loops); Heartbeat 2
// a racing heart, four beats at 150 bpm, tighter and a little brighter; Ominous Heartbeat two slow deep beats at 50 bpm
// in a big dark room (four layers, lub dub lub dub: a burst cannot go slower than 60 bpm, the Fire rate's floor of 1/s).
function lub(o) { return imp(Object.assign({ tone: 0.06, decay: 0.12, punch: 0.45, grit: 0.04, boom: 0.95, boomFreq: 56, boomDrop: 0.35, boomDecay: 0.07, dec: 0.05, rel: 0.08, cut: 420, width: 0.25 }, o)); }
S["Heartbeat"] = () => sound(lub({ dur: 0.83 }), [[lub({ tone: 0.1, punch: 0.35, boomFreq: 62, boomDecay: 0.08, dur: 0.5 }), 0.29, 0.62]]);
S["Heartbeat 2"] = () => sound(lub({ tone: 0.1, punch: 0.6, boomFreq: 60, boomDecay: 0.05, cut: 600, repeat: 4, rate: 2.5, dur: 1.6 }),
  [[lub({ tone: 0.14, punch: 0.5, boomFreq: 68, boomDecay: 0.045, cut: 600, repeat: 4, rate: 2.5, dur: 1.5 }), 0.15, 0.65]]);
const omLub = () => lub({ tone: 0.04, punch: 0.4, boomFreq: 44, boomDrop: 0.45, boomDecay: 0.16, cut: 320, dur: 1.2, reverb: 0.45, reverbSize: 0.9, reverbTone: 0.25 });
const omDub = () => lub({ tone: 0.07, punch: 0.3, boomFreq: 50, boomDecay: 0.12, cut: 320, dur: 1.2, reverb: 0.45, reverbSize: 0.9, reverbTone: 0.25 });
S["Ominous Heartbeat"] = () => sound(omLub(), [[omDub(), 0.34, 0.6], [omLub(), 1.2, 1], [omDub(), 1.54, 0.6]]);

// Bone Crack: a bone snapping is a sharp bright crack and the splinter of it tearing, with a dull knock of the limb under
// it: an impact crack (high tone, all grit, very short), a burst of hard particle splinters right behind it, a second
// smaller crack (the break running through), and a low knock.
S["Bone Crack"] = () => sound(imp({ tone: 0.85, decay: 0.05, punch: 1, grit: 0.85, dec: 0.03, rel: 0.05, dur: 0.3, reverb: 0.15, reverbSize: 0.4 }), [
  [part({ rate: 200, tone: 0.72, decay: 0.03, spread: 0.75, atk: 0.001, dec: 0.07, sus: 0, rel: 0.03, dur: 0.14, drive: 0.35 }), 0.004, 0.7],
  [imp({ tone: 0.7, decay: 0.04, punch: 0.9, grit: 0.9, dec: 0.02, rel: 0.04, dur: 0.15 }), 0.045, 0.55],
  [imp({ tone: 0.2, decay: 0.1, punch: 0.6, grit: 0.2, boom: 0.5, boomFreq: 90, boomDecay: 0.06, dec: 0.05, rel: 0.08, dur: 0.25, cut: 2000 }), 0, 0.45]]);

// Jumpscare Hit: the hit alone, no scream: a huge slam (impact, all punch, a deep boom), the room it happens in (blast,
// indoors, so the hit has a space and a weight that a reverb on an oscillator does not), and a dissonant metal clang
// ringing out of it (modal, very inharmonic): a door slammed in an iron hall.
S["Jumpscare Hit"] = () => sound(imp({ tone: 0.5, decay: 0.4, punch: 1, grit: 0.7, boom: 0.6, boomFreq: 50, boomDrop: 1, boomDecay: 0.3, dec: 0.12, rel: 0.35, drive: 0.4, dur: 1.1, reverb: 0.35, reverbSize: 0.85, reverbTone: 0.45 }), [
  [blast({ size: 0.55, pulse: 2.5, shape: 0.9, dist: 12, env: 2, room: 1.2, tail: 1, roar: 0, rumble: 0.3, seed: 77, peak: 0.6, dur: 1.1 }), 0, 0.5],
  [modal({ f: 196, parts: 12, inharm: 0.95, decay: 1, bright: 0.8, dur: 1.1, cut: 11000, drive: 0.2, reverb: 0.35, reverbSize: 0.85 }), 0.004, 1.1]]);

// Jump Scare Stinger: the orchestral stab: a string section slashing at a dissonant cluster near the bridge in tremolo
// (bowed, two violins a semitone apart, pressed hard and fast so the bow screams), a cello stab under them, and a slam with
// a deep boom on the downbeat.
S["Jump Scare Stinger"] = () => sound(imp({ tone: 0.3, decay: 0.35, punch: 1, grit: 0.55, boom: 0.85, boomFreq: 48, boomDrop: 0.9, boomDecay: 0.3, dec: 0.1, rel: 0.3, drive: 0.3, dur: 1.4, reverb: 0.45, reverbSize: 0.85, reverbTone: 0.4 }), [
  [bow({ f: 1245, speed: 0.95, press: 1, pos: 0.07, tone: 0.85, string: 0.15, atk: 0.004, dec: 0.5, sus: 0.4, rel: 0.4, trem: 13, hp: 500, dur: 1.4, reverb: 0.5, reverbSize: 0.85, width: 0.6 }), 0, 1.1],
  [bow({ f: 1319, speed: 0.95, press: 1, pos: 0.07, tone: 0.85, string: 0.15, atk: 0.004, dec: 0.5, sus: 0.4, rel: 0.4, trem: 14, tremPhase: 0.4, hp: 500, dur: 1.4, reverb: 0.5, reverbSize: 0.85, width: 0.6 }), 0.008, 1],
  [bow({ f: 92, speed: 0.9, press: 1, pos: 0.12, tone: 0.3, string: 0.35, atk: 0.004, dec: 0.3, sus: 0.15, rel: 0.3, dur: 1.1, reverb: 0.4, reverbSize: 0.85 }), 0, 0.5]]);

// Jump Scare Stinger 2: the monster lunges: a shrieking roar right in your face (creature: chaotic larynx, wide open, a
// pitch thrown up then falling), on a slam, with a sub drop under it.
S["Jump Scare Stinger 2"] = () => sound(cr({ f: 520, size: 1.3, ps: 3, pe: -10, peak: 0.12, open: [0.6, 1, 0.4], vowel: [0.15, 0.35], tension: 1, jitter: 0.5, shimmer: 0.5, rough: 0.72, breath: 0.65,
  atk: 0.006, rel: 0.4, dur: 1.1, drive: 0.25, reverb: 0.4, reverbSize: 0.85, reverbTone: 0.45, width: 0.5 }), [
  [imp({ tone: 0.4, decay: 0.3, punch: 1, grit: 0.6, boom: 0.9, boomFreq: 52, boomDrop: 1.1, boomDecay: 0.45, dec: 0.1, rel: 0.3, drive: 0.3, dur: 1.2, reverb: 0.35, reverbSize: 0.8 }), 0, 0.85],
  [osc({ wave: 0, freq: 70, sweep: -0.35, attack: 0.002, hold: 0.05, decay: 0.7, sustain: 0, release: 0.3, cutoff: 300, duration: 1.2, boom: 0.7, boomFreq: 45, boomDrop: 0.8, boomDecay: 0.5 }), 0, 0.5]]);

// ---- voices -----------------------------------------------------------------------------------------------------
// Ghostly Wail: a woman's ghost: a high rounded "oo" that swells in, rises to its peak early and falls away a long way,
// soft and breathy (a ghost's throat is not pressed), with a slow vibrato that blooms in, through an echo and a big room.
S["Ghostly Wail"] = () => cr({ f: 780, size: 0.6, ps: -4, pe: -9, peak: 0.3, open: [0.25, 0.55, 0.2], vowel: [0.7, 1], tension: 0.35, jitter: 0.12, shimmer: 0.15, breath: 0.45,
  atk: 0.25, rel: 0.7, dur: 1.9, vib: 0.06, vibRate: 5, vibOnset: 0.4, reverb: 0.6, reverbSize: 0.9, reverbTone: 0.5, delay: 0.25, delayTime: 0.22, delayFb: 0.35, width: 0.7 });
// Ghostly Wail 2: a different ghost: lower and slower, rising the whole way to a late peak before it sinks (a building
// "ooo-OOO-oo" where the first one is a falling cry), breathier, over a hollow draught (wind, a low hollow whistle) that
// carries it on past 2 s.
S["Ghostly Wail 2"] = () => sound(wind({ int: 0.55, gust: 0.55, gustRate: 0.5, tone: 0.2, body: 0.25, whistles: 2, whistle: 0.6, f: 260, q: 18, seed: 41, atk: 0.6, sus: 0.8, rel: 0.6, dur: 2.5, reverb: 0.5, reverbSize: 0.9, reverbTone: 0.3 }), [
  [cr({ f: 430, size: 0.8, ps: -7, pe: -5, peak: 0.62, open: [0.15, 0.6, 0.15], vowel: [0.85, 0.95], tension: 0.25, jitter: 0.1, shimmer: 0.12, breath: 0.7,
    atk: 0.5, rel: 0.6, dur: 2, vib: 0.05, vibRate: 3.5, vibOnset: 0.6, reverb: 0.7, reverbSize: 0.93, reverbTone: 0.35, delay: 0.25, delayTime: 0.32, delayFb: 0.4, width: 0.7 }), 0.15, 1.3]]);
// Ghost Moan: a low moan, a man's: the mouth closed on a humming "mmm" that opens into a long "ohh" and closes again,
// sagging in pitch, soft, in an echoing room.
S["Ghost Moan"] = () => cr({ f: 165, size: 1.15, ps: -2, pe: -5, peak: 0.45, open: [0.05, 0.6, 0.1], vowel: [0.6, 0.9], nasal: 0.7, tension: 0.3, jitter: 0.15, shimmer: 0.2, breath: 0.35,
  atk: 0.3, rel: 0.7, dur: 2, vib: 0.03, vibRate: 4, vibOnset: 0.5, reverb: 0.65, reverbSize: 0.9, reverbTone: 0.35, delay: 0.25, delayTime: 0.3, delayFb: 0.4, width: 0.6 });
// Distant Scream: a woman screaming far off: pressed flat out and rough, wide open on a front "AEH", thrown up at once
// then falling, a 1.1 s call; heard from a distance (the highs taken off, a long echo and room carrying it on). Sits 3 dB
// under the median by design. (A wail is soft, rounded and long; a scream is pressed, open and short.)
S["Distant Scream"] = () => cr({ f: 1050, size: 0.7, ps: -5, pe: -8, peak: 0.15, open: [0.7, 1, 0.6], vowel: [0.05, 0.25], tension: 1, jitter: 0.35, shimmer: 0.35, rough: 0.32, breath: 0.35,
  atk: 0.04, hold: 0.85, dec: 0.25, sus: 0, rel: 0.1, dur: 1.9, cut: 2600, reverb: 0.75, reverbSize: 0.92, reverbTone: 0.35, delay: 0.35, delayTime: 0.3, delayFb: 0.45, width: 0.6 });
// Possessed Screech: right in your ear: a shrieking "EEH" from a chaotic larynx (roughness past period doubling), pressed
// flat out, and the same scream a tritone under it from another throat: two voices in one body.
S["Possessed Screech"] = () => sound(cr({ f: 760, size: 0.8, ps: 2, pe: -8, peak: 0.18, open: [0.5, 1, 0.45], vowel: [0.02, 0.15], tension: 1, jitter: 0.5, shimmer: 0.45, rough: 0.68, breath: 0.55,
  atk: 0.008, rel: 0.3, dur: 1.3, drive: 0.25, reverb: 0.35, reverbSize: 0.75, reverbTone: 0.45, width: 0.5 }), [
  [cr({ f: 760, size: 1.1, ps: 2, pe: -9, peak: 0.2, open: [0.45, 0.9, 0.4], vowel: [0.08, 0.2], tension: 1, jitter: 0.6, shimmer: 0.5, rough: 0.8, breath: 0.6,
    atk: 0.02, rel: 0.3, dur: 1.25, reverb: 0.35, reverbSize: 0.75, reverbTone: 0.45, width: 0.6 }), 0.02, 0.75, -6]]);
// Demonic Roar: a demon, not a beast: a huge body roaring from a chaotic throat with a rattle in it, and the same roar an
// octave under it from a second, bigger throat (the doubled voice is what makes it unnatural), in a huge room.
S["Demonic Roar"] = () => sound(cr({ f: 80, size: 2.6, ps: -2, pe: -6, peak: 0.3, open: [0.2, 1, 0.3], vowel: [0.4, 0.85], tension: 0.85, jitter: 0.5, shimmer: 0.5, rough: 0.85, breath: 0.6,
  flutter: 0.3, flutterRate: 16, atk: 0.08, rel: 0.45, dur: 1.7, drive: 0.2, reverb: 0.45, reverbSize: 0.88, reverbTone: 0.25, width: 0.6 }), [
  [cr({ f: 80, size: 3, ps: -2, pe: -7, peak: 0.32, open: [0.25, 0.85, 0.3], vowel: [0.5, 0.9], tension: 0.8, jitter: 0.6, shimmer: 0.5, rough: 0.95, breath: 0.45,
    flutter: 0.4, flutterRate: 11, atk: 0.12, rel: 0.45, dur: 1.65, reverb: 0.45, reverbSize: 0.88, reverbTone: 0.25, width: 0.7 }), 0.03, 0.8, -12]]);
// Sinister Laugh: a villain's "ha-ha-ha-ha-ha-HAAH": six short open "ha" calls (breathy, a little growl in the throat),
// each a touch lower than the last, then one long falling "haaah" to finish, in a hall.
S["Sinister Laugh"] = () => sound(cr({ f: 150, size: 1.25, ps: 1.5, pe: -2, peak: 0.25, open: [0.35, 0.9, 0.3], vowel: [0.2, 0.3], tension: 0.6, jitter: 0.3, shimmer: 0.3, rough: 0.28, breath: 0.65,
  atk: 0.008, hold: 0.06, dec: 0.07, sus: 0, rel: 0.04, repeat: 6, rate: 6, arp: -1, dur: 1, reverb: 0.4, reverbSize: 0.8, reverbTone: 0.35 }), [
  [cr({ f: 125, size: 1.25, ps: 3, pe: -6, peak: 0.15, open: [0.4, 0.95, 0.2], vowel: [0.2, 0.45], tension: 0.55, jitter: 0.3, shimmer: 0.3, rough: 0.32, breath: 0.7,
    atk: 0.01, rel: 0.25, dur: 0.55, reverb: 0.4, reverbSize: 0.8, reverbTone: 0.35 }), 1.02, 0.95]]);

// WHISPERS. The creature engine always voices, but its breath is turbulence through the same moving tract: soft (tension
// 0) and all breath, high-passed over ~800 Hz, what is left is the aspiration through the formants: a whispered vowel
// that moves. A whisper sits under the median by design.
function hush(o) { return cr(Object.assign({ tension: 0.02, jitter: 0.6, shimmer: 0.4, breath: 1, hp: 850 }, o)); }
// Creepy Whisper: someone whispering close to your ear: three breathy syllables, each a different mouth (the burst's
// calls vary), then a long "sss"-ish trailing hush, dry-ish (close).
S["Creepy Whisper"] = () => sound(hush({ f: 140, size: 0.95, ps: 0, pe: -2, peak: 0.35, open: [0.2, 0.75, 0.25], vowel: [0.1, 0.7], atk: 0.04, hold: 0.12, dec: 0.12, sus: 0, rel: 0.08,
  repeat: 3, rate: 3.2, dur: 1, reverb: 0.3, reverbSize: 0.6, reverbTone: 0.5, width: 0.5 }), [
  [hush({ f: 140, size: 0.85, open: [0.3, 0.45, 0.1], vowel: [0.05, 0.1], hp: 2200, atk: 0.06, rel: 0.25, dur: 0.6, reverb: 0.3, reverbSize: 0.6, reverbTone: 0.5, width: 0.5 }), 0.95, 0.8]]);
// Demon Whisper: a demon whispering: the whisper from a huge tract (every formant low), under it a low growling purr
// from the same throat (creature, slow rattle), through an echo in a big dark room.
S["Demon Whisper"] = () => sound(hush({ f: 90, size: 2.2, ps: 0, pe: -3, peak: 0.4, open: [0.25, 0.8, 0.2], vowel: [0.3, 0.9], hp: 500, atk: 0.1, hold: 0.25, dec: 0.25, sus: 0, rel: 0.15,
  repeat: 3, rate: 1.6, dur: 2, reverb: 0.55, reverbSize: 0.92, reverbTone: 0.3, delay: 0.25, delayTime: 0.26, delayFb: 0.4, width: 0.65 }), [
  [cr({ f: 48, size: 2.8, ps: 0, pe: -2, peak: 0.5, open: [0.1, 0.35, 0.1], vowel: [0.7, 0.8], tension: 0.6, jitter: 0.5, shimmer: 0.4, rough: 0.8, breath: 0.3,
    flutter: 0.6, flutterRate: 9, atk: 0.4, rel: 0.5, dur: 2, reverb: 0.5, reverbSize: 0.92, reverbTone: 0.25, width: 0.6 }), 0, 0.55]]);
// Ghost Breath: a cold breath on your neck: a slow inhale (thin, tight, rising) then a long exhale (open "haaa", lower,
// falling away), all breath, in a quiet room.
S["Ghost Breath"] = () => sound(hush({ f: 160, size: 0.9, ps: -2, pe: 1, peak: 0.8, open: [0.15, 0.3, 0.25], vowel: [0.4, 0.3], hp: 1300, atk: 0.55, rel: 0.12, dur: 0.75, reverb: 0.45, reverbSize: 0.8, reverbTone: 0.4, width: 0.6 }), [
  [hush({ f: 130, size: 1, ps: 0, pe: -4, peak: 0.15, open: [0.55, 0.7, 0.3], vowel: [0.35, 0.6], hp: 700, atk: 0.05, rel: 0.4, dur: 1.2, reverb: 0.45, reverbSize: 0.8, reverbTone: 0.4, width: 0.6 }), 0.85, 1]]);
// Whispering Void: an empty dark space that whispers: hollow wind through low, impure whistles (a cave mouth), slow
// swells, and a whisper surfacing inside it (three soft syllables), far down an echo.
S["Whispering Void"] = () => sound(wind({ int: 0.6, gust: 0.7, gustRate: 0.45, tone: 0.25, body: 0.35, whistles: 3, whistle: 0.7, f: 180, q: 14, seed: 93, atk: 0.5, sus: 0.85, rel: 0.6, dur: 2.6,
  reverb: 0.55, reverbSize: 0.92, reverbTone: 0.4 }), [
  [hush({ f: 120, size: 1.1, ps: 0, pe: -2, peak: 0.4, open: [0.2, 0.7, 0.2], vowel: [0.2, 0.8], hp: 1100, atk: 0.08, hold: 0.15, dec: 0.18, sus: 0, rel: 0.1,
    repeat: 3, rate: 2.4, dur: 1.3, reverb: 0.7, reverbSize: 0.93, reverbTone: 0.4, delay: 0.35, delayTime: 0.24, delayFb: 0.45, width: 0.8 }), 0.55, 0.85]]);

// ---- strings, scrapes and drones ---------------------------------------------------------------------------------
// Horror Drone: a dark place with something in it: a hollow low draught (wind, low impure whistles) and, rising out of it,
// a double bass bowed sul ponticello (close to the bridge, pressed: glassy and grinding), then a cello a tritone above it.
S["Horror Drone"] = () => sound(wind({ int: 0.55, gust: 0.5, gustRate: 0.35, tone: 0.12, body: 0.55, whistles: 2, whistle: 0.55, f: 110, q: 12, seed: 17, atk: 0.8, sus: 0.85, rel: 0.6, dur: 3,
  reverb: 0.4, reverbSize: 0.9, reverbTone: 0.2 }), [
  [bow({ f: 55, speed: 0.55, press: 0.92, pos: 0.1, tone: 0.18, string: 0.3, atk: 0.9, sus: 1, rel: 0.6, dur: 2, vib: 0.01, vibRate: 3, vibOnset: 1, reverb: 0.5, reverbSize: 0.9, reverbTone: 0.2, width: 0.5 }), 0.25, 0.85],
  [bow({ f: 78, speed: 0.5, press: 0.88, pos: 0.12, tone: 0.3, string: 0.3, atk: 0.9, sus: 1, rel: 0.5, dur: 1.9, vib: 0.012, vibRate: 3.5, vibOnset: 1, reverb: 0.5, reverbSize: 0.9, reverbTone: 0.2, width: 0.6 }), 0.9, 0.55]]);
// Tension Riser: a string section's crescendo climbing in tremolo, cellos then violins a semitone apart, each sweeping up,
// over a wind that swells the whole way and cuts off at the top (2.6 s). Every tremolo layer is high-passed under its note:
// the bowed engine thumps below ~50 Hz at each stroke reversal while the bow is slow (in a long attack), measured as the
// loudest thing in the riser's first second.
S["Tension Riser"] = () => sound(wind({ int: 1, gust: 0.1, gustRate: 1.2, tone: 0.55, body: 0.08, seed: 58, atk: 2.5, sus: 1, rel: 0.04, dur: 2.6 }), [
  [bow({ f: 110, speed: 0.7, press: 0.85, pos: 0.15, tone: 0.3, string: 0.25, atk: 2, sus: 1, rel: 0.05, trem: 11, sweep: 0.25, dur: 2, hp: 90, reverb: 0.3, reverbSize: 0.7, width: 0.5 }), 0.25, 0.8],
  [bow({ f: 440, speed: 0.8, press: 0.9, pos: 0.12, tone: 0.8, string: 0.2, atk: 1.9, sus: 1, rel: 0.04, trem: 15, sweep: 0.25, dur: 2, hp: 300, reverb: 0.3, reverbSize: 0.7, width: 0.6 }), 0.6, 1],
  [bow({ f: 466, speed: 0.8, press: 0.9, pos: 0.12, tone: 0.8, string: 0.2, atk: 1.9, sus: 1, rel: 0.04, trem: 16, tremPhase: 0.45, sweep: 0.25, dur: 2, hp: 300, reverb: 0.3, reverbSize: 0.7, width: 0.6 }), 0.6, 0.8]]);
// Nails on Chalkboard: the screech of a nail dragged over a board is stick-slip locking onto the board's own ring: the
// friction engine, a stiff iron-like contact gripping hard, dragged fast so it locks into a squeal: two strokes, the
// first locking near 2.3 kHz, the second higher, near 3.8 kHz. The model is chaotic: both seeds were picked from a sweep
// for how much of the stroke squeals (the first's neighbours, 195-222, lock on 1.9-2.3 kHz on 10 of 15 seeds).
S["Nails on Chalkboard"] = () => sound(fric({ body: 1, f: 1700, tone: 0.9, grip: 0.85, rough: 0.5, lock: 1, seed: 207, speed: [[0, 0.75], [0.2, 0.95], [0.45, 0.85]], press: [[0, 0.55], [0.25, 0.75]], stop: 0.6, dur: 0.7 }), [
  [fric({ body: 1, f: 1400, tone: 0.9, grip: 0.85, rough: 0.5, lock: 1, seed: 186, speed: [[0, 0.85], [0.15, 1], [0.35, 0.8]], press: [[0, 0.6], [0.2, 0.8]], stop: 0.45, dur: 0.55 }), 0.62, 0.9]]);

// ---- bells, chimes, chains, the music box -------------------------------------------------------------------------
// Ominous Bell: a big low bronze bell tolled once in a stone hall (modal: very inharmonic, long ring, a dark strike), its
// low hum a fraction out of tune with it so the ring beats slowly.
S["Ominous Bell"] = () => sound(modal({ f: 147, parts: 10, inharm: 0.85, decay: 2.8, bright: 0.4, cut: 5000, dur: 2, conv: 0.45, convType: 1, convSize: 2.5, convTone: 0.35, width: 0.5 }), [
  [modal({ f: 147, parts: 3, inharm: 0.1, decay: 3, bright: 0.1, cut: 1200, dur: 2, conv: 0.4, convType: 1, convSize: 2.5, convTone: 0.3 }), 0, 0.45, -11.85]]);
// Cursed Chime: a glass chime struck and going sour: two chimes a quarter-tone apart so they beat against each other, both
// bending slowly flat as they ring, and a dull glockenspiel tine under them.
S["Cursed Chime"] = () => sound(modal({ f: 1568, parts: 5, inharm: 0.45, decay: 1.4, bright: 0.8, sweep: -0.04, dur: 1.8, cut: 14000, reverb: 0.5, reverbSize: 0.85, reverbTone: 0.6, delay: 0.25, delayTime: 0.19, delayFb: 0.35, width: 0.6 }), [
  [modal({ f: 1568, parts: 5, inharm: 0.5, decay: 1.3, bright: 0.75, sweep: -0.05, dur: 1.8, cut: 14000, reverb: 0.5, reverbSize: 0.85, reverbTone: 0.6, width: 0.6 }), 0.025, 0.8, -0.5],
  [bar({ f: 784, type: 2, mallet: 0.5, ring: 0.7, rel: 1.5, dur: 1.6, reverb: 0.4, reverbSize: 0.85 }), 0.01, 0.5]]);
// Rattling Chains: links knocking: three sizes of iron link (modal, very inharmonic, short ring) each rattling at its own
// rate so the pattern never repeats, and the grit of the chain dragging (particle).
S["Rattling Chains"] = () => sound(modal({ f: 1900, parts: 8, inharm: 0.95, decay: 0.12, bright: 0.85, hold: 0.002, dec: 0.03, sus: 0.05, rel: 0.05, repeat: 9, rate: 13, dur: 0.9, cut: 16000, reverb: 0.2, reverbSize: 0.5, width: 0.6 }), [
  [modal({ f: 1340, parts: 8, inharm: 0.95, decay: 0.16, bright: 0.8, hold: 0.002, dec: 0.04, sus: 0.05, rel: 0.05, repeat: 7, rate: 10.5, dur: 0.85, cut: 16000, reverb: 0.2, reverbSize: 0.5, width: 0.6 }), 0.035, 0.85],
  [modal({ f: 620, parts: 8, inharm: 0.92, decay: 0.25, bright: 0.6, hold: 0.003, dec: 0.06, sus: 0.05, rel: 0.08, repeat: 4, rate: 5.5, dur: 0.8, cut: 12000, reverb: 0.2, reverbSize: 0.5 }), 0.07, 0.75],
  [part({ rate: 70, tone: 0.8, decay: 0.08, spread: 0.6, atk: 0.02, rel: 0.2, dur: 0.85, drive: 0.25 }), 0, 0.45]]);
// Music Box: a music box winding down: a minor tune on a comb's tines (bar, tine), slowing as the spring runs out, its
// last note a fraction out of tune.
S["Music Box"] = () => sound(bar({ f: 1319, rel: 1.6, dur: 0.9, reverb: 0.3, reverbSize: 0.6 }), [
  [bar({ f: 1047, rel: 1.6, dur: 0.9, reverb: 0.3, reverbSize: 0.6 }), 0.4, 1],
  [bar({ f: 880, rel: 1.6, dur: 0.9, reverb: 0.3, reverbSize: 0.6 }), 0.84, 1],
  [bar({ f: 831, rel: 2, dur: 1.4, reverb: 0.3, reverbSize: 0.6 }), 1.38, 1, -0.4]]);

// ---- swarms -------------------------------------------------------------------------------------------------------
// Skittering Swarm: hundreds of small legs on a hard floor: random ticks (particle, hard and short), a lower carapace
// clatter under them, both surging in waves (flicker), coming and going.
S["Skittering Swarm"] = () => sound(part({ rate: 170, tone: 0.78, decay: 0.03, spread: 0.7, atk: 0.12, sus: 1, rel: 0.3, dur: 1.3, flicker: 0.6, flickerRate: 9, drive: 0.3 }), [
  [part({ rate: 80, tone: 0.55, decay: 0.07, spread: 0.6, atk: 0.2, rel: 0.3, dur: 1.2, flicker: 0.5, flickerRate: 5, drive: 0.25 }), 0.08, 0.7],
  [part({ rate: 200, tone: 0.95, decay: 0.02, spread: 0.4, atk: 0.3, rel: 0.3, dur: 1.1, hp: 5000 }), 0.1, 0.3]]);

// ============================================================================================================
const arg = process.argv[2];
// env '<js>' [ms]: print the level envelope (dB re max) in blocks of ms (default 20)
if (arg === "env") { const r = render(eval(process.argv[3])), B = Math.round((+process.argv[4] || 20) / 1000 * SR), e = [];
  for (let a = 0; a + B <= r.L.length; a += B) { let q = 0; for (let i = a; i < a + B; i++) q += (0.5 * (r.L[i] + r.R[i])) ** 2; e.push(10 * Math.log10(q / B + 1e-12)); }
  const mx = Math.max(...e); console.log(e.map((v) => Math.max(-60, v - mx).toFixed(0)).join(" ")); process.exit(0); }
// track '<js>' [ms]: per block (default 50 ms): level dB re max, centroid, the strongest spectral peak, YIN f0 / dip
if (arg === "track") { const r = render(eval(process.argv[3])), B = Math.round((+process.argv[4] || 50) / 1000 * SR), mono = Float64Array.from(r.L, (v, i) => 0.5 * (v + r.R[i]));
  const tr = yinTrack(mono, 35, 2000, B / SR); const rows = []; let mx = -1e9;
  for (let a = 0; a + 2048 <= mono.length; a += B) { let q = 0; for (let i = a; i < a + 2048; i++) q += mono[i] * mono[i]; const l = 10 * Math.log10(q / 2048 + 1e-12); mx = Math.max(mx, l);
    const v = new Float64Array(SPN); for (let i = 0; i < SPN; i++) v[i] = mono[a + i] * SPH[i]; let bk = 0, bm = 0;
    for (let k = 1; k < SPK; k++) { const C = SPC[k - 1], S2 = SPS[k - 1]; let re = 0, im = 0; for (let i = 0; i < SPN; i++) { re += v[i] * C[i]; im -= v[i] * S2[i]; } const m = re * re + im * im; if (m > bm) { bm = m; bk = k; } }
    const y = tr.find((p) => Math.abs(p.t - a / SR) < B / SR / 2); rows.push([a / SR, l, spectrum(mono, a).cent, bk * 100, y]); }
  for (const [t, l, c, pk, y] of rows) if (l > mx - 40) console.log(t.toFixed(2).padStart(5) + "  " + (l - mx).toFixed(0).padStart(4) + " dB  cent " + c.toFixed(0).padStart(5) + "  peak " + String(pk).padStart(5) + (y ? "  f0 " + y.f.toFixed(0).padStart(5) + " dip " + y.ap.toFixed(2) : ""));
  process.exit(0); }
// js '<code>': run code with every voice and measure in scope (seed searches)
if (arg === "js") { eval(process.argv[3]); process.exit(0); }
// squeal(r): the share of 50 ms frames (within 20 dB of the max) that are periodic (YIN dip < 0.25), and their median f0
function squeal(r) { const mono = Float64Array.from(r.L, (v, i) => 0.5 * (v + r.R[i])), tr = yinTrack(mono, 200, 4000, 0.05, 0.02);
  const emx = Math.max(...tr.map((p) => p.e)), loud = tr.filter((p) => p.e > emx * 0.01), per = loud.filter((p) => p.ap < 0.25);
  return { share: per.length / Math.max(1, loud.length), f0: per.length ? median(per.map((p) => p.f)) : 0, n: loud.length }; }
if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e); console.log(fmt(measure(render(p)))); } process.exit(0); }
if (arg === "try") { console.log(fmt(measure(render(JSON.parse(process.argv[3]))))); process.exit(0); }
const strip = (p) => { const q = Object.assign({}, p); delete q._vary; delete q._alts; return q; };
const nowRows = ALL.map((name) => { const m = measure(render(strip(PRESETS[name]))); return { name, m, f: features(m) }; });
// The level bar: the median of the WHOLE Horror section as it stands today (62 presets; the family is another round)
const secRows = HORROR.map((name) => ({ name, lufs: (ALL.includes(name) ? nowRows.find((x) => x.name === name).m : measure(render(strip(PRESETS[name])))).lufs }));
const TARGET = median(secRows.map((x) => x.lufs));
if (arg === "ref") {
  for (const x of nowRows) console.log(x.name.padEnd(21) + "w" + PRESETS[x.name].wave + "  " + fmt(x.m));
  const mine = nowRows.map((x) => x.m.lufs), sec = secRows.map((x) => x.lufs);
  console.log("HORROR SECTION (" + sec.length + ") median " + TARGET.toFixed(1) + " LUFS, range " + Math.min(...sec).toFixed(1) + " to " + Math.max(...sec).toFixed(1) +
    ", IQR " + median(sec.filter((v) => v <= TARGET)).toFixed(1) + " .. " + median(sec.filter((v) => v >= TARGET)).toFixed(1));
  console.log("THESE 29 median " + median(mine).toFixed(1) + " LUFS, range " + Math.min(...mine).toFixed(1) + " to " + Math.max(...mine).toFixed(1));
  const p = []; for (let i = 0; i < nowRows.length; i++) for (let j = i + 1; j < nowRows.length; j++) p.push([nowRows[i].name, nowRows[j].name, dist(nowRows[i].f, nowRows[j].f), nowRows[i].f, nowRows[j].f]);
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY closest pairs:"); for (const [a, b, d, fa, fb] of p.slice(0, 12)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2));
  process.exit(0);
}

// ============================================================================================================
// KEPT: today's preset stays, with the reason
const KEPT = {
  "Dead Tone": "a flat, dead sine with a sub, cut off sharply: abstract synthesis by nature (a tone, not an object), so no physical engine models it better",
  "Dread Pulse": "a low synth throb pulsing five times: abstract synthesis by nature (a pulse, not a heartbeat or an object; the three heartbeats are the physical version)",
};
// One line per sound for KEY.md (what to listen for)
const IDEA = {
  "Void Thump": "blast: a huge, far, Weight-stretched pressure wave in a long indoor room; a deep thump with a hall behind it",
  "Ominous Heartbeat": "impact lub-dub x2 at 50 bpm, the slowest and deepest of the three hearts, in a big dark room (2.7 s)",
  "Jump Scare Stinger": "orchestral stab: a slam + boom, two violins a semitone apart slashing in tremolo at the bridge, a cello stab under them",
  "Horror Drone": "a hollow low draught (wind) with a double bass bowed at the bridge rising out of it, then a cello a tritone above (3 s)",
  "Ghostly Wail": "creature: a woman's ghost, high breathy 'oo' swelling in, peaking early, falling a long way, echo + big room",
  "Demonic Roar": "creature: a huge chaotic roar with a rattle, doubled an octave below by a second bigger throat, big room",
  "Creepy Whisper": "creature whisper (all breath, voice high-passed away): three whispered syllables close to the ear, then a trailing hush",
  "Heartbeat": "impact lub-dub, one calm close beat at 72 bpm (0.83 s, loops)",
  "Distant Scream": "creature: a woman's pressed, rough, wide-open 'AEH' scream thrown up and falling, highs gone, long echo and room (3 dB under on purpose)",
  "Sinister Laugh": "creature burst: six breathy growly 'ha's stepping down, then a long falling 'haaah'",
  "Music Box": "bar tines: a minor tune winding down (E C A, slowing), the last note G# a fraction flat",
  "Tension Riser": "bowed tremolo: cellos then two violins a semitone apart, all sweeping up, over a wind swelling to a cut-off (2.6 s)",
  "Ghost Breath": "creature whisper: a thin rising inhale, then a long open falling exhale (sits under on purpose)",
  "Nails on Chalkboard": "friction: a stiff contact dragged fast, locking into a squeal on the board's ring; two strokes",
  "Ominous Bell": "modal: one toll of a big low inharmonic bell in a stone hall (convolution), its hum detuned so the ring beats",
  "Rattling Chains": "modal links in three sizes rattling at three rates (never repeats), with particle drag grit",
  "Possessed Screech": "creature: a chaotic pressed 'EEH' shriek, doubled a tritone below by a second throat, driven",
  "Skittering Swarm": "particle: hard random leg ticks + a lower carapace clatter, surging in waves, a faint high rustle",
  "Ghost Moan": "creature: a man's low moan, a hummed 'mmm' opening into 'ohh' and closing, sagging, echoing room",
  "Jumpscare Hit": "the hit alone: an impact slam with a deep boom, a blast in an indoor room, a dissonant metal clang ringing out",
  "Whispering Void": "hollow wind through low impure whistles (a cave mouth), a whisper surfacing far down an echo (2.6 s)",
  "Demon Whisper": "creature: a whisper from a huge tract (three syllables), a low growling purr under it, echo + dark room",
  "Bone Crack": "impact crack + particle splinters + a second smaller crack running through + a dull low knock",
  "Cursed Chime": "modal glass chimes a quarter-tone apart beating, both bending flat as they ring, a glockenspiel tine under",
  "Jump Scare Stinger 2": "the monster lunges: a chaotic shrieking roar in your face, on a slam, a sub drop under it",
  "Ghostly Wail 2": "creature over wind: a lower, slower, breathier 'ooo-OOO-oo' rising to a late peak over a hollow draught (2.5 s)",
  "Heartbeat 2": "impact lub-dub x4 at 150 bpm: a racing, panicked heart, tighter and a little brighter",
};
// Per-sound level offset from the Horror median, by design (dB). Everything else lands ON the median.
const LEVEL_OFFSET = { "Creepy Whisper": -4, "Ghost Breath": -4, "Demon Whisper": -2, "Whispering Void": -2, "Distant Scream": -3,
  "Heartbeat": -3, "Heartbeat 2": -2, "Ominous Heartbeat": -2, "Void Thump": -1, "Music Box": -2, "Bone Crack": -2, "Sinister Laugh": -1.5,
  "Jump Scare Stinger": 1.5, "Jump Scare Stinger 2": 1.5, "Jumpscare Hit": 1 };
// _vary: what makes a take different, on LAYER 1 (the preset's click-again variation jitters layer 1's keys; Variations
// vary every layer). Seeds where the engine has one; never `freq` on a layered sound whose layer 1 is pitched against the
// rest (a jitter there detunes it from the others).
const VARY = {
  "Void Thump": { blastSeed: 1, blastSize: 0.06, blastPulse: 0.1, blastTail: 0.1 },
  "Ominous Heartbeat": { impactTone: 0.2, impactPunch: 0.1, reverb: 0.1 },
  "Jump Scare Stinger": { impactTone: 0.15, impactGrit: 0.15, boomFreq: 0.1 },
  "Horror Drone": { wxSeed: 1, wxGust: 0.15, wxTone: 0.15 },
  "Ghostly Wail": { freq: 0.08, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.05, vibRate: 0.15 },
  "Demonic Roar": { crSize: 0.06, crOpenPeak: 0.08, crRough: 0.05, crFlutterRate: 0.15 },
  "Creepy Whisper": { crSize: 0.08, crOpenPeak: 0.1, crVowelEnd: 0.1, rate: 0.1 },
  "Heartbeat": { impactTone: 0.2, boomFreq: 0.06, boomDecay: 0.1 },
  "Distant Scream": { freq: 0.08, crSize: 0.08, crOpenPeak: 0.08, crPitchEnd: 0.05 },
  "Sinister Laugh": { crSize: 0.06, crOpenPeak: 0.1, rate: 0.08, crRough: 0.1 },
  "Music Box": { barMallet: 0.05 },
  "Tension Riser": { wxSeed: 1, wxTone: 0.1, wxGust: 0.15 },
  "Ghost Breath": { crSize: 0.08, crOpenPeak: 0.1, attack: 0.1 },
  "Nails on Chalkboard": { fricSeed: 0.05, fricSpeed: 0.05, fricPress: 0.08 },
  "Ominous Bell": { modalInharm: 0.05, modalDecay: 0.1, modalBright: 0.1 },
  "Rattling Chains": { rate: 0.12, modalInharm: 0.03, modalDecay: 0.15 },
  "Possessed Screech": { crSize: 0.08, crOpenPeak: 0.08, crRough: 0.06, crPitchEnd: 0.05 },
  "Skittering Swarm": { particleRate: 0.15, particleTone: 0.06, flickerRate: 0.2 },
  "Ghost Moan": { freq: 0.08, crSize: 0.08, crOpenPeak: 0.1, crPitchEnd: 0.05, vibRate: 0.15 },
  "Jumpscare Hit": { impactTone: 0.15, impactGrit: 0.15, boomFreq: 0.1, boomDecay: 0.1 },
  "Whispering Void": { wxSeed: 1, wxGust: 0.15, wxTone: 0.15 },
  "Demon Whisper": { crSize: 0.06, crOpenPeak: 0.1, crVowelEnd: 0.1 },
  "Bone Crack": { impactTone: 0.1, impactGrit: 0.1, impactDecay: 0.15 },
  "Cursed Chime": { modalInharm: 0.08, modalDecay: 0.1, modalBright: 0.08 },
  "Jump Scare Stinger 2": { crSize: 0.06, crOpenPeak: 0.08, crRough: 0.06, crPitchEnd: 0.05 },
  "Ghostly Wail 2": { wxSeed: 1, wxGust: 0.15, wxTone: 0.15 },
  "Heartbeat 2": { impactTone: 0.2, boomFreq: 0.06, rate: 0.06 },
};

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "horror-redo", "named"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter, in steps
// of 0.05, the smallest that reaches the target (bisected), then the gain trimmed back so it lands on the target
// The Limiter is capped at LIM_MAX (0.4): past that a peaky sound (a crack, a burst of laughs) is being squashed to buy
// loudness it does not have, and on an asymmetric low pulse the limiter itself puts DC in (measured: a heartbeat at
// limiter 0.25 reads 4e-4 against 6e-9 at gain 1). NO_LIMIT sounds (the sub thumps) stop at gain 1; either way a
// sound that cannot reach its target lands short and the report says by how much.
const LIM_MAX = 0.4, NO_LIMIT = new Set(["Void Thump", "Heartbeat", "Heartbeat 2", "Ominous Heartbeat"]);
function level(p, target, name) {
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - m.lufs) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  if (NO_LIMIT.has(name)) return measure(render(p));
  let lo = 0, hi = Math.round(LIM_MAX / 0.05);
  p.limiter = LIM_MAX; m = measure(render(p));
  if (m.lufs < target - 0.4) return m;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); const mm = measure(render(p)); if (mm.lufs >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  for (let k = 0; k < 2; k++) { m = measure(render(p)); if (m.lufs > target + 0.3) p.gain = r2(p.gain * Math.pow(10, (target - m.lufs) / 20)); }
  return measure(render(p));
}
// every layer's own Duration must sit on its slider (2 s) unless its engine stretches
function durCheck(name, p) {
  const ls = [p].concat(p.layers ? JSON.parse(p.layers).map((l) => l.s) : []);
  ls.forEach((l, i) => { if (l.duration > 2.0001 && !STRETCH.has(l.wave)) console.log("  !! " + name + " layer " + (i + 1) + " (wave " + l.wave + ") duration " + l.duration + " > 2 s"); });
}
const DESIGNED = ALL.filter((n) => S[n]);
const only = arg && arg !== "sep" ? arg : null;
if (only && !DESIGNED.some((n) => slug(n) === only)) { console.log("no design named " + only + " (designed: " + DESIGNED.map(slug).join(" ") + ")"); process.exit(1); }
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {};
for (const name of DESIGNED) {
  const s = slug(name);
  if (only && only !== s) continue;
  const p = S[name](), tgt = TARGET + (LEVEL_OFFSET[name] || 0);
  durCheck(name, p);
  const m = level(p, tgt, name), r = render(p);
  const now = nowRows.find((x) => x.name === name);
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(strip(PRESETS[name])), name + " (now)");
    wav(s + "-2-new.wav", r, name);
  }
  json[name] = Object.assign({}, p, { _vary: VARY[name] || {} });
  rows.push({ name, slug: s, p, r, m, f: features(m), now });
  const nl = p.layers ? JSON.parse(p.layers).length + 1 : 1;
  console.log(name.padEnd(21) + "NEW " + fmt(m) + "\n      " + nl + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
    ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")" +
    "\n  " + "".padEnd(19) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
}
if (only) process.exit(0);

// ---- separation: the new set (kept ones as they are) against itself and against the creature presets
const finalRows = ALL.map((n) => (S[n] ? rows.find((x) => x.name === n) : nowRows.find((x) => x.name === n)));
const pairs = (list) => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i].name, list[j].name, dist(list[i].f, list[j].f), list[i].f, list[j].f]); return out.sort((a, b) => a[2] - b[2]); };
const pn = pairs(finalRows), po = pairs(nowRows);
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour or pitch, a clear shape step)");
console.log("  closest pairs in the 29 (new where redesigned, today's where kept):");
for (const [a, b, d, fa, fb] of pn.slice(0, 12)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  29: NEW median pair " + median(pn.map((x) => x[2])).toFixed(2) + ", min " + pn[0][2].toFixed(2) + "; TODAY median " + median(po.map((x) => x[2])).toFixed(2) + ", min " + po[0][2].toFixed(2));
console.log("  the numbered and related sets:");
for (const set of [["Jump Scare Stinger", "Jump Scare Stinger 2", "Jumpscare Hit"], ["Ghostly Wail", "Ghostly Wail 2", "Ghost Moan"], ["Heartbeat", "Heartbeat 2", "Ominous Heartbeat", "Dread Pulse"],
  ["Creepy Whisper", "Demon Whisper", "Whispering Void", "Ghost Breath"], ["Distant Scream", "Possessed Screech", "Jump Scare Stinger 2"]]) {
  const pr = pn.filter(([a, b]) => set.includes(a) && set.includes(b));
  for (const [a, b, d, fa, fb] of pr) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")" + "   today " + po.find((x) => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a))[2].toFixed(2));
}
const crRows = [];
for (const n of CREATURE_REF) {
  const base = strip(PRESETS[n]); crRows.push({ name: n, f: features(measure(render(base))) });
  (PRESETS[n]._alts || []).forEach((a, k) => crRows.push({ name: n + " alt" + (k + 1), f: features(measure(render(a))) }));
}
const pc = []; for (const a of rows) for (const b of crRows) pc.push([a.name, b.name, dist(a.f, b.f), a.f, b.f]);
pc.sort((a, b) => a[2] - b[2]);
console.log("  closest against the " + crRows.length + " creature presets (Animal / Monster, alts included):");
for (const [a, b, d, fa, fb] of pc.slice(0, 10)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
const over2 = rows.filter((x) => x.m.sec > 2.001).map((x) => x.name + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges (" + rows.length + " redesigned): audible " + Math.min(...rows.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...rows.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...rows.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...rows.map((x) => x.m.lufs)).toFixed(1) + " (median " + median(rows.map((x) => x.m.lufs)).toFixed(1) +
  "; target " + TARGET.toFixed(1) + "); peaks max " + Math.max(...rows.map((x) => x.m.peak)).toFixed(3) + ", clipping " + rows.filter((x) => x.m.clip).length +
  ", |DC| max " + Math.max(...rows.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1));
console.log("  over 2 s: " + (over2.join(", ") || "none"));
console.log("  before/after loudness (new - now, dB): " + rows.map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (section order)
writeFileSync(join(jsonDir, "horror-redo-named.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR);
let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(21) + IDEA[x.name]); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Horror redo (named), all new");
writeFileSync(join(wavDir, "KEY.md"), "# Horror redo (named) — all-new.wav: the " + rows.length + " redesigned Horror sounds in section order, 0.4 s apart.\n" +
  "# Per sound: <slug>-1-now.wav is today's preset as the app plays it, <slug>-2-new.wav the redesign; both Normalize on,\n" +
  "# NOT loudness-matched (each is what its button plays).\n\n```\n" + key.join("\n") + "\n```\n\n## KEPT (no new WAV; today's preset stays)\n\n" +
  Object.entries(KEPT).map(([n, w]) => "- **" + n + "**: " + w).join("\n") + "\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, horror-redo-named.json");
