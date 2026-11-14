/* jingles.mjs — ALTERNATIVES for the musical jingles (Game Over, Level Up, the fanfares, the coins, the dings, the
 * chimes …) plus five new jingle presets. PROPOSAL material: nothing here is wired into presets.js. AJ listens to the
 * labeled WAVs and keeps what is good. AJ (2026-11-14): "stuff like Game Over and Level Up are still a bit odd … Instead of
 * wholesale replacing them it might be good to come up with alternatives that user can keep clicking through to get more."
 *
 *   node tools/proto/jingles.mjs              renders everything, measures, writes the WAVs, KEY.md and both JSONs
 *   node tools/proto/jingles.mjs tune         the tuning check alone: every note of every design, solo, against its pitch
 *   node tools/proto/jingles.mjs <slug>       one preset (e.g. game-over), measured, its WAVs written, no JSON
 *   node tools/proto/jingles.mjs x <LUFS> '<J(...)>' …   level designs to a target and print what they reach, nothing written
 *
 * THE BRIEF IS soundtests/audit-untouched/REPORT.md, "The jingle family". Its finding: no preset has a melody. Two-thirds
 * are one continuous `sweep` (a slide, not notes) and `arpStep` is ONE constant interval, so a single voice cannot play a
 * major or minor triad. LAYERS CAN: up to 4 per sound, each with its own delay, gain and patch. The Riff sequencer is no
 * help, since a preset's Play button does not play it. So every design here is written as NOTES (`runs` below) and
 * COMPILED into layers, one RUN per layer:
 *
 *   a run = notes at a constant spacing (the layer's `rate`) a constant interval apart (its `arpStep`), `repeat` of them.
 *   [C5 E5] is one run (+4), [G5 C6] another (+5): two layers make a major arpeggio. Runs of +12 interleaved (C5/C6,
 *   E5/E6, G5/G6 a beat apart) make a two-octave arpeggio from three layers. A HELD note is a run of one.
 *
 * Pitches are exact equal temperament (A4 = 440): a layer's `freq` is its first note's frequency, `arpStep` moves it in
 * whole semitones, `sweep` is 0. `tune` renders every note of every design SOLO and reads its fundamental partial (by
 * FFT) against the note it should be, because the physical models (blown brass, struck bars) are not oscillators and
 * could drift. They did: the blown brass came in 10-28 cents flat on short notes until it was tongued (see V.trumpet).
 *
 * THE YARDSTICK is CrunchyBGM's stings (BGM-DESIGN.md §127/§586, makeSting): item get rises to the tonic an octave up;
 * level up is V-I rising; victory is I-IV-V-I with an octave leap; defeat falls i-vi-iv and ends LOW and unresolved on
 * purpose. Every figure here is an original one written inside those conventions (a rising arpeggio is a convention; a
 * specific famous tune is not), so the coins are a fourth up on pitches other than the famous one's.
 *
 * VARIETY OVER REPLACEMENT: every existing preset keeps today's sound as its base and gains 2-4 `_alts` (the button
 * plays the base or one alt at random per click). Within a preset the alts differ in gesture or instrument, usually both.
 *
 * LEVELS: rendered with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, Normalize ON, as the app's
 * Play button sounds. An alt's master `gain` lands its BS.1770 loudness on its preset's base (a click must not jump); a
 * new preset lands on its section's median. The Limiter only where gain 1 cannot reach it (as the redo rounds do).
 *
 * Writes soundtests/jingles/<slug>-0-now.wav, <slug>-alt<N>-<what>.wav, <slug>-all.wav (today's, then each alt, 0.5 s
 * apart), all-new.wav, KEY.md; tools/new-presets/jingle-alts.json (each existing preset's FULL object, base unchanged,
 * `_alts` appended) and tools/new-presets/jingles-new.json (the new presets, each with its `category`).
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
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR, DEF = CS.DEFAULTS;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS, CATS = pctx.window.PRESET_CATEGORIES;

const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000, r4 = (x) => Math.round(x * 10000) / 10000;
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };

// ============================================================================================================
// NOTES
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function midi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error("bad note " + name);
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const nm = (m, flats) => (flats ? FLATS : SHARPS)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// ============================================================================================================
// MEASUREMENT (BS.1770 loudness as in tools/proto/cartoon-redo.mjs; the pitch meter is under TUNING below)
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
const renderCache = new Map();
function render(patch) {
  const p = Object.assign({}, patch); delete p._vary; delete p._alts; delete p.category;
  const key = JSON.stringify(p);
  if (renderCache.has(key)) return renderCache.get(key);
  const r = CS.render(Object.assign({}, DEF, p), { normalize: true });
  const out = { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
  renderCache.set(key, out);
  return out;
}
// peak, DC, loudness, and THE ENDING: how long the sound takes from its last moment at 30% of its peak to the end of the
// buffer (the audit's click test: 5 ms or less is a cut), and the level of its last 10 ms against its peak
function measure(r) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  let nan = 0;
  for (let i = 0; i < n; i++) { if (L[i] !== L[i] || R[i] !== R[i]) nan++; const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.98 || b >= 0.98) clip++; }
  let last30 = 0;
  for (let i = n - 1; i >= 0; i--) if (Math.max(Math.abs(L[i]), Math.abs(R[i])) >= 0.3 * pk) { last30 = i; break; }
  let tail = 0; for (let i = Math.max(0, n - Math.round(0.01 * SR)); i < n; i++) tail = Math.max(tail, Math.abs(L[i]), Math.abs(R[i]));
  return { sec: n / SR, peak: pk, clip, nan, dc: Math.max(Math.abs(sl / n), Math.abs(sr / n)), lufs: lufs(L, R),
    fallMs: (n - last30) / SR * 1000, tailDb: 20 * Math.log10(tail / pk + 1e-9) };
}

// ============================================================================================================
// VOICES: the instruments. Each is (L, o) -> a patch with no `freq` and no envelope timing; `shape()` below sets the
// envelope so the note SOUNDS for L seconds and is silent before its slot ends (a burst cuts each shot at its slot).
// `held` voices fade over most of the note (a struck or decaying tone; `hf` holds part of it first, `curve` shapes the
// fade); others hold and release (a blown or chip tone).
// `tail` is the room a layer needs after its last note for its reverb/echo to ring out inside its own duration.
const tailOf = (p) => Math.max(0.03, (p.reverb ? 0.2 + 0.8 * (p.reverbSize ?? 0.6) * Math.min(1, p.reverb * 2) : 0),
  p.delay ? Math.min(0.6, (p.delayTime || 0.15) * Math.log(0.05) / Math.log(Math.max(0.05, p.delayFb ?? 0.35))) : 0);
const V = {
  // CHIP (the consoles' own voicings, from index.html's CONSOLES table and the coin presets beside them)
  square:  (o) => Object.assign({ wave: 1, cutoff: 10000, bitcrush: 7, drive: 0, width: 0.4 }, o),              // Retro: a plain square
  pulse:   (o) => Object.assign({ wave: 4, pulseWidth: 0.5, cutoff: 12000, bitcrush: 8, drive: 0, width: 0.4 }, o),   // 8-bit console: a clean 50% pulse
  narrow:  (o) => Object.assign({ wave: 4, pulseWidth: 0.25, cutoff: 9000, bitcrush: 4, downsample: 2, drive: 0, width: 0.3 }, o),   // the pocket handheld: thin, gritty
  tri:     (o) => Object.assign({ wave: 3, cutoff: 9000, bitcrush: 12, drive: 0.05, width: 0.6, reverb: 0.3, reverbSize: 0.6, reverbTone: 0.6 }, o),  // 16-bit console: warm triangle + echo
  wavetbl: (o) => Object.assign({ wave: 6, cutoff: 11000, bitcrush: 5, drive: 0.06, width: 0.4 }, o),            // the bright little wavetable console
  sid:     (o) => Object.assign({ wave: 4, pulseWidth: 0.5, pwmDepth: 0.25, pwmRate: 4, cutoff: 3500, reso: 0.5, filtEnv: 0.4, drive: 0.12, width: 0.4 }, o),   // the squelchy filtered-pulse computer
  sine:    (o) => Object.assign({ wave: 0, cutoff: 9000, drive: 0, width: 0.4 }, o),
  saw:     (o) => Object.assign({ wave: 2, unison: 3, detune: 12, width: 0.6, cutoff: 6000, reso: 0.15, drive: 0.1, reverb: 0.35, reverbSize: 0.65, reverbTone: 0.5 }, o),
  // KEYS / FM
  organ:   (o) => Object.assign({ wave: 6, cutoff: 8500, reso: 0.15, drive: 0.06, bitcrush: 11, width: 0.7, reverb: 0.35, reverbSize: 0.7, reverbTone: 0.6 }, o),
  fmbell:  (o) => Object.assign({ wave: 18, fmAlgo: 3, fmRatio2: 4, fmRatio3: 5, fmRatio4: 7, fmIndex: 0.45, fmFeedback: 0, cutoff: 14000, reso: 0.1, drive: 0, width: 0.6, reverb: 0.35, reverbSize: 0.7, reverbTone: 0.6, held: 1 }, o),
  fmbrass: (o) => Object.assign({ wave: 18, fmAlgo: 4, fmRatio2: 1, fmRatio3: 2, fmRatio4: 3, fmIndex: 0.45, fmFeedback: 0.15, cutoff: 11000, reso: 0.1, filtEnv: 0.2, drive: 0.08, width: 0.5, reverb: 0.3, reverbSize: 0.6 }, o),
  fm2:     (o) => Object.assign({ wave: 5, cutoff: 9000, drive: 0, width: 0.5, reverb: 0.25, reverbSize: 0.55, held: 1 }, o),
  // BLOWN BRASS (wave 21, the lip-reed model; the engine-sweep Blown Trumpet / Trombone / Tuba). TONGUED: the lips take
// time to lock onto the tube, and on the sweep's 50 ms breath-in a note sits 20-60 cents flat for its first 100 ms, so a
// fanfare's short notes were heard mostly flat (measured: 10-28 cents over a 0.18 s note). A 6 ms attack with a little
// more breath and tighter lips locks within 20-80 ms to 3-8 cents (swept: attack x lips x breath, eight pitches C3-C5),
// and the breath's fall is held to 70 ms, since the pitch droops as the breath dies.
  trumpet: (o) => Object.assign({ wave: 21, brassBreath: 0.7, brassLips: 0.5, brassBell: 0.59, brassTube: 0.31, cutoff: 18000, drive: 0, width: 0.35, reverb: 0.25, reverbSize: 0.55 }, o),
  trombone:(o) => Object.assign({ wave: 21, brassBreath: 0.68, brassLips: 0.45, brassBell: 0.59, brassTube: 0.31, cutoff: 18000, drive: 0, width: 0.3, reverb: 0.25, reverbSize: 0.55 }, o),
  tuba:    (o) => Object.assign({ wave: 21, brassBreath: 0.65, brassLips: 0.4, brassBell: 0.32, brassTube: 0.31, cutoff: 18000, drive: 0, width: 0.2, reverb: 0.2, reverbSize: 0.5 }, o),
  // MALLETS AND BELLS (bar 24, modal 10, pluck 8). A PITCHED BELL HERE IS HARMONIC. The fundamental partial is exact
// either way, but the pitch heard is not only the fundamental: a modal bell's `modalInharm` stretches its upper partials
// (0.25: the 2nd at 2.19x) and its periodicity pitch reads 55-145 cents SHARP at 0.1-0.25 (0.4 cents at 0); FM ratio 3.5
// (the FM Bell preset's) makes the wave repeat at HALF its note (autocorrelation -0.1 at one period, 0.98 at two), so it
// can be heard an octave down. So the modal bell sits at inharm 0 and the FM bell's ratios are 4 : 5 : 7.
  glock:   (o) => Object.assign({ wave: 24, barType: 2, barMallet: 0.85, barRing: 0.5, cutoff: 18000, drive: 0, width: 0.4, reverb: 0.25, reverbSize: 0.6, held: 1 }, o),
  xylo:    (o) => Object.assign({ wave: 24, barType: 1, barMallet: 0.55, barRing: 0.5, cutoff: 18000, drive: 0, width: 0.4, reverb: 0.15, reverbSize: 0.5, held: 1 }, o),
  marimba: (o) => Object.assign({ wave: 24, barType: 0, barMallet: 0.35, barRing: 0.55, cutoff: 18000, drive: 0, width: 0.4, reverb: 0.25, reverbSize: 0.6, held: 1 }, o),
  vibes:   (o) => Object.assign({ wave: 24, barType: 3, barMallet: 0.5, barRing: 0.6, barMotor: 0.25, cutoff: 18000, drive: 0, width: 0.5, reverb: 0.3, reverbSize: 0.65, held: 1 }, o),
  bell:    (o) => Object.assign({ wave: 10, modalPartials: 6, modalInharm: 0, modalDecay: 0.6, modalBright: 0.7, cutoff: 12000, drive: 0, width: 0.5, reverb: 0.3, reverbSize: 0.6, held: 1 }, o),
  pluck:   (o) => Object.assign({ wave: 8, pluckDamp: 0.3, cutoff: 10000, reso: 0.1, drive: 0, width: 0.4, reverb: 0.3, reverbSize: 0.55, reverbTone: 0.72, held: 1 }, o),
};
// The envelope for a note sounding L seconds in a slot of S seconds (S = L for a lone note). Struck/decaying voices
// (`held`): an instant attack and a decay to silence over the note (the bar and modal engines ring by themselves, so the
// envelope only damps them by the note's end). Blown and chip voices: attack, hold, then a release-shaped decay to
// silence. The decay always reaches 0 by L, so a shot is silent before the next one cuts it.
// envCurve (an exponential decay) only on a LONE note: on a burst it renders NaN. The engine's release is
// susLevel * pow(1 - r, 1 + 3 envCurve), and the last shot of a burst keeps running past its release (r > 1) while the
// layer's tail plays, so pow(negative, non-integer) is NaN, and 0 * NaN is still NaN. A linear curve (exponent 1) is safe.
function shape(p, L, S, lone) {
  const q = Object.assign({}, p), hf = q.hf, curve = q.curve ?? 0.6; delete q.held; delete q.hf; delete q.curve;
  const atk = q.wave === 21 ? 0.006 : q.wave === 6 || q.wave === 18 && q.fmAlgo === 4 ? 0.008 : 0.002;
  if (q.wave === 24 || q.wave === 25) {            // bar / piano: the envelope is a damper, linear from the strike to 0 at S
    Object.assign(q, { attack: 0, hold: 0, decay: 0, sustain: 1, release: r3(L) });
  } else if (p.held) {                              // struck / FM bell / pluck: decays over the note
    // hf: how much of the note is held before the decay (default a few ms: a strike); curve: the decay's shape
    const h = hf != null ? hf * L : Math.min(0.02, 0.1 * L);
    Object.assign(q, { attack: atk, hold: r3(h), decay: r3(L - atk - h), sustain: 0, release: 0.01, envCurve: lone ? curve : 0 });
  } else {                                          // blown / chip: hold most of the note, fall away over the rest
    const fall = Math.min(0.25 * L, q.wave === 21 ? 0.07 : L > 0.4 ? 0.22 : 0.06);
    Object.assign(q, { attack: atk, hold: r3(L - atk - fall), decay: r3(fall), sustain: 0, release: 0.01, envCurve: lone ? (L > 0.4 ? 0.5 : 0.2) : 0 });
  }
  return q;
}

// ============================================================================================================
// THE COMPILER: runs -> layers. A design is { unit (seconds per beat), voice, runs: [[t, ioi, len, "notes", o?], …] }:
// t = when the run starts, ioi = the spacing of its notes, len = how long each note sounds (≤ ioi), all in beats; the
// notes must be a constant interval apart. o: { v: another voice for this run, g: its layer gain, x: extra params }.
// The run starting at 0 is layer 1 (it carries the master gain / limiter); the rest are layers 2-4, written as a diff
// against the engine's defaults, `freq` = the run's first note EXACTLY, `p` 0.
const diff = (p) => { const o = {}; for (const [k, v] of Object.entries(p)) if (k === "wave" || k === "freq" || k === "duration" || DEF[k] !== v) o[k] = v; return o; };
function compile(d) {
  const u = d.unit, runs = d.runs.map((r) => {
    const [t, ioi, len, notes, o = {}] = r, written = notes.trim().split(/\s+/), ms = written.map(midi).map((m) => m + (d.tr || 0));
    // the names as written (a transposed gesture is spelled in flats when it went down, the keys it lands in here)
    const names = d.tr ? ms.map((m) => nm(m, d.tr < 0)) : written;
    const step = ms.length > 1 ? ms[1] - ms[0] : 0;
    for (let i = 1; i < ms.length; i++) if (ms[i] - ms[i - 1] !== step) throw new Error((d.id || "?") + ": run " + notes + " is not one interval");
    if (ms.length > 1 && len > ioi + 1e-9) throw new Error((d.id || "?") + ": run " + notes + " sounds longer than its spacing");
    return { t: t * u, S: (ms.length > 1 ? ioi : len) * u, L: len * u, ms, names, step, o };
  });
  if (runs.length > 4) throw new Error((d.id || "?") + ": " + runs.length + " runs; a sound has 4 layers");
  const i0 = runs.findIndex((r) => r.t === 0);
  if (i0 < 0) throw new Error((d.id || "?") + ": nothing starts at 0");
  const order = [runs[i0]].concat(runs.filter((_, i) => i !== i0));
  const pats = order.map((r) => {
    const vf = typeof (r.o.v || d.voice) === "function" ? (r.o.v || d.voice) : V[r.o.v || d.voice];
    r.voice = vf(Object.assign({}, d.x || {}, r.o.x || {}));
    let p = shape(r.voice, r.L, r.S, r.ms.length === 1);
    p.freq = r4(hz(r.ms[0]));
    if (r.ms.length > 1) { p.repeat = r.ms.length; p.rate = r4(1 / r.S); if (r.step) p.arpStep = r.step; }
    p.duration = r3(Math.min(2, (r.ms.length - 1) * r.S + r.L + tailOf(p)));
    // a LONE struck bar's slot is its whole duration: its damper must run to the end of it, or the ring is cut there
    if ((p.wave === 24 || p.wave === 25) && r.ms.length === 1) p.release = r3(Math.min(1.5, p.duration));
    return p;
  });
  const base = diff(pats[0]);
  if (d.limiter) base.limiter = d.limiter;
  if (pats.length > 1) base.layers = JSON.stringify(pats.slice(1).map((p, i) => {
    const r = order[i + 1], e = { s: diff(p), d: r3(r.t) };
    if (r.o.g != null && r.o.g !== 1) e.g = r.o.g;
    return e;
  }));
  const notes = order.flatMap((r, li) => r.ms.map((m, k) => ({ m, name: r.names[k], t: r.t + k * r.S, L: r.L, layer: li })));
  return { p: base, notes, pats, order };
}
const noteList = (c) => c.notes.slice().sort((a, b) => a.t - b.t || a.m - b.m);
// "C5 E5 G5 C6 (held)": chords (notes within 5 ms) in brackets, a note at least 2.5x the shortest one marked held
function noteText(c) {
  const ns = noteList(c), short = Math.min(...ns.map((n) => n.L)), out = [];
  for (let i = 0; i < ns.length;) {
    const g = [ns[i]]; let j = i + 1;
    while (j < ns.length && ns[j].t - ns[i].t < 0.005) g.push(ns[j++]);
    const held = g.some((n) => n.L >= 2.5 * short && n.L >= 0.3);
    out.push((g.length > 1 ? "[" + g.map((n) => n.name).join("+") + "]" : g[0].name) + (held ? " (held)" : ""));
    i = j;
  }
  return out.join(" ");
}

// today's patch as a VOICE: its timbre without its pitch, timing or envelope (so an alt can keep a preset's own sound
// and give it notes: Super Chime retuned, Boot-Up's own FM resolving)
const TIMING = ["freq", "sweep", "repeat", "rate", "arpStep", "attack", "hold", "decay", "sustain", "release", "envCurve", "duration", "gain", "limiter", "_vary", "_alts", "layers"];
const todayVoice = (name, extra) => (o) => { const p = Object.assign({}, PRESETS[name]); for (const k of TIMING) delete p[k]; return Object.assign(p, extra || {}, o); };
const TODAY = (name) => () => { const p = Object.assign({}, PRESETS[name]); delete p._vary; delete p._alts; return p; };

// ============================================================================================================
// THE DESIGNS. J(id, what, voice, unit, runs, opts): one alt, as notes. `id` is the label in the file name.
// A gesture written once and voiced twice is a function of the voice (fanfare(v), ...), so the composition shows.
const J = (id, what, voice, unit, runs, o) => Object.assign({ id, what, voice, unit, runs }, o || {});
const RAW = (id, what, make) => ({ id, what, raw: make });   // a patch as it is (today's sound reused elsewhere)

// GESTURES that recur, in C (tr transposes)
const fanfare3 = (v, tr, unit, chord, x) => J("fanfare-" + v, "the fanfare rhythm: three short, then the tonic held" + (chord ? " over its chord" : ""), v, unit,
  [[0, 1, 0.72, "G5 G5 G5"], [3, 0, 6, "C6"]].concat(chord ? [[3, 0, 6, "E5", { g: 0.65 }], [3, 0, 6, "C4", { v: chord, g: 0.6 }]] : []), { tr, x });
const twoNote = (v, lo, hi, unit, o) => J("two-note-" + v, "the two-note coin: a short note, then a fourth up, held", v, unit, [[0, 0, 0.85, lo], [1, 0, 5, hi]], o);
const bling = (v, notes4, unit, o) => { const n = notes4.split(" "); return J("bling-" + v, "a bling: a major arpeggio up an octave in four quick strikes, the top ringing", v, unit,
  [[0, 1, 1, n[0] + " " + n[1]], [2, 0, 1, n[2]], [3, 0, 5, n[3]]], o); };
const octHop = (v, lo, hi, unit, o) => J("octave-" + v, "a coin that hops an octave: short, then the octave held", v, unit, [[0, 0, 0.85, lo], [1, 0, 5, hi]], o);

const ALTS = {
  // ---------------- GAME OVER: falls and lands LOW (BGM's defeat: i-vi-iv, unresolved on purpose)
  "Game Over": [
    J("brass-fall", "a falling F-minor line on blown trombone, landing on the low tonic on a tuba", "trombone", 0.2,
      [[0, 1, 0.92, "C4 Ab3"], [2, 1, 0.92, "F3 C3"], [4, 0, 4.4, "F2", { v: "tuba" }]]),
    J("sad-trombone", "the sad trombone: a chromatic fall, the last note held with a slow vibrato", "trombone", 0.3,
      [[0, 1, 0.9, "Bb3 A3 Ab3"], [3, 0, 3.4, "G3", { x: { vibDepth: 0.06, vibRate: 5, vibOnset: 0.3 } }]]),
    J("chip-arp-down", "a chip A-minor arpeggio falling two octaves to the low tonic", "pulse", 0.085,
      [[0, 1, 0.9, "E6 C6"], [2, 1, 0.9, "A5 E5"], [4, 1, 0.9, "C5 A4"], [6, 0, 7, "A3"]]),
    J("mallet-fall", "a soft marimba fall through D minor, Bb and G minor (i-vi-iv), left hanging low", "marimba", 0.24,
      [[0, 1, 1, "A4 F4"], [2, 1, 1, "D4 Bb3"], [4, 0, 5.5, "G3"]]),
    // its own ending is cut by the buffer (its reverb is still at -17 dB in the last 10 ms), so here it decays to silence
    // over 1.2 s instead of holding then releasing at the end: the same slide, a little slower, with room to ring
    RAW("pixel-slide", "Pixel Fanfare's sound today, a falling saw slide (the audit's ready Game Over), stretched to 1.2 s and left to decay into its reverb",
      () => Object.assign(TODAY("Pixel Fanfare")(), { duration: 1.2, sustain: 0, decay: 0.75, release: 0.01, envCurve: 0.4 })),
  ],
  // ---------------- LEVEL UP: resolves UP onto the tonic (V-I)
  "Level Up": [
    J("chip-arp", "a chip major arpeggio up to a held high tonic, a triangle an octave under it", "pulse", 0.075,
      [[0, 1, 1, "C5 E5"], [2, 0, 1, "G5"], [3, 0, 8, "C6"], [3, 0, 8, "C5", { v: "tri", g: 0.6 }]]),
    J("fm-bell-run", "an FM bell run from the dominant up to the tonic an octave higher", "fmbell", 0.09,
      [[0, 1, 1, "A4 D5"], [2, 1, 1, "F#5 A5"], [4, 0, 10, "D6"]]),
    J("brass-ta-da", "a blown-brass ta-DA: a short pickup on the fifth, then the tonic chord held", "trumpet", 0.13,
      [[0, 0, 0.8, "G4"], [1, 0, 7, "C5"], [1, 0, 7, "G4", { g: 0.7 }], [1, 0, 7, "E4", { g: 0.7 }]]),
    J("mallet-scale", "a xylophone scale run up an octave to the tonic, a glockenspiel ringing on top", "xylo", 0.06,
      [[0, 1, 1, "C5 D5 E5"], [3, 1, 1, "F5 G5 A5 B5"], [7, 0, 10, "C6"], [7, 0, 10, "C7", { v: "glock", g: 0.35 }]]),
  ],
  // ---------------- THE FANFARES
  "8-Bit Fanfare": [
    fanfare3("pulse", 0, 0.1, "tri"),
    J("stabs-pulse", "chip stabs on the roots of I-IV-V-I, the last an octave up and held", "pulse", 0.12,
      [[0, 1, 0.75, "D5 D5"], [2, 0, 1.5, "G5"], [4, 0, 1.5, "A5"], [6, 0, 7, "D6"]]),
    Object.assign(fanfare3("trumpet", -7, 0.12, "trombone", { drive: 0.3, reverb: 0.12 }), { what: "the fanfare rhythm on blown brass: three short, then the tonic chord held, a trombone under it" }),
  ],
  "Super Fanfare": [
    J("organ-stabs", "organ stabs on the roots of I-IV-V-I, the last an octave up and held", "organ", 0.17,
      [[0, 0, 0.8, "F4"], [1, 0, 0.8, "Bb4"], [2, 0, 0.8, "C5"], [3, 0, 5.5, "F5"]]),
    J("fanfare-tri", "a rising fanfare on the warm triangle with echo: two quarters, two eighths, the tonic held", "tri", 0.14,
      [[0, 2, 1.7, "G4 C5"], [4, 1, 0.85, "E5 G5"], [6, 0, 6, "C6"]]),
    Object.assign(fanfare3("fmbrass", -2, 0.11, "fmbrass"), { what: "the fanfare rhythm on four-op FM brass in Bb: three short, then the tonic chord held" }),
  ],
  "Trumpet Fanfare": [
    J("blown-arp", "a real G-major arpeggio on the blown-brass trumpet, the top held over a trombone", "trumpet", 0.15,
      [[0, 1, 0.9, "G4 B4"], [2, 0, 0.9, "D5"], [3, 0, 6, "G5"], [3, 0, 6, "G3", { v: "trombone", g: 0.6 }]], { x: { drive: 0.3, reverb: 0.12 } }),
    J("fm-major", "today's FM trumpet, its augmented arpeggio made major (G B D G)", "fmbrass", 1 / 6,
      [[0, 1, 1, "G4 B4"], [2, 1, 1, "D5 G5"]]),
    J("call-brass", "a blown-brass call, long-short-short-long: C, G-G, then C held over its third", "trumpet", 0.13,
      [[0, 0, 1.8, "C5"], [2, 1, 0.8, "G4 G4"], [4, 0, 6, "C5"], [4, 0, 6, "E4", { g: 0.65 }]], { x: { drive: 0.4, reverb: 0.1, brassBreath: 0.8 } }),
  ],
  "Pixel Fanfare": [
    J("saw-rise", "today's saw, rising: a D-major fanfare up to the held tonic", "saw", 0.1,
      [[0, 1, 0.9, "A4 D5"], [2, 1, 0.9, "F#5 A5"], [4, 0, 6, "D6"]]),
    J("chip-call", "a chip call: two short, a fifth up, the octave held over its third", "square", 0.1,
      [[0, 1, 0.7, "D5 D5"], [2, 0, 1.8, "A5"], [4, 0, 7, "D6"], [4, 0, 7, "F#5", { g: 0.6 }]]),
    J("pixel-sweep", "a two-octave major arpeggio sweeping up (three interleaved octave runs) to a held top", "narrow", 0.055,
      [[0, 3, 1, "D4 D5"], [1, 3, 1, "F#4 F#5"], [2, 3, 1, "A4 A5"], [6, 0, 9, "D6"]]),
  ],
  "Game Start": [
    J("chip-motif", "a short rising chip motif: C-E, G-G, then the high C held", "square", 0.1,
      [[0, 1, 0.8, "C5 E5"], [2, 1, 0.8, "G5 G5"], [4, 0, 5, "C6"]]),
    J("ready-go", "ready, ready, GO: two short on the fifth, then the tonic held, an octave doubled", "pulse", 0.12,
      [[0, 2, 1, "G4 G4"], [4, 0, 6, "C5"], [4, 0, 6, "C6", { v: "narrow", g: 0.5 }]]),
  ],
  "Extra Life": [
    J("arp-up", "a six-note rising E-major arpeggio, the top tonic held", "square", 0.07,
      [[0, 1, 0.8, "G#4 B4"], [2, 1, 0.8, "E5 G#5"], [4, 0, 0.8, "B5"], [5, 0, 7, "E6"]]),
    J("steps-tri", "six rising notes by step and skip on the warm triangle, the tonic held over a low one", "tri", 0.075,
      [[0, 1, 0.85, "E5 F#5 G#5"], [3, 1, 0.85, "B5 C#6"], [5, 0, 7, "E6"], [5, 0, 7, "E5", { g: 0.55 }]]),
  ],
  "8-Bit 1UP": [
    J("steps-pulse", "six rising notes, G A B then D E, up to the high tonic", "pulse", 0.075,
      [[0, 1, 0.8, "G5 A5 B5"], [3, 1, 0.8, "D6 E6"], [5, 0, 7, "G6"]]),
    J("octave-arp", "a two-octave G-major arpeggio from three interleaved octave runs, the high tonic held", "narrow", 0.07,
      [[0, 3, 0.9, "G4 G5"], [1, 3, 0.9, "B4 B5"], [2, 3, 0.9, "D5 D6"], [6, 0, 7, "G6"]]),
  ],
  // ---------------- THE COINS: two notes a fourth up (never the famous pitches), voiced per machine
  "Coin":        [twoNote("square", "G5", "C6", 0.065), bling("glock", "C6 E6 G6 C7", 0.045, { x: { barMallet: 0.3, barRing: 0.8, reverb: 0.1 } })],
  "Coin 2":      [twoNote("saw", "C6", "F6", 0.065, { x: { unison: 1, bitcrush: 7, reverb: 0, drive: 0.12, cutoff: 11000 } }), octHop("fmbell", "F5", "F6", 0.07, { x: { hf: 0.5, curve: 0, reverb: 0.15 } })],
  "8-Bit Coin":  [twoNote("pulse", "A5", "D6", 0.07), bling("pulse", "D6 F#6 A6 D7", 0.04)],
  "Pocket Coin": [twoNote("narrow", "C6", "F6", 0.065), octHop("narrow", "C6", "C7", 0.06)],
  "Super Coin":  [twoNote("tri", "D6", "G6", 0.07), bling("vibes", "G5 B5 D6 G6", 0.05)],
  "Turbo Coin":  [twoNote("wavetbl", "E6", "A6", 0.065), bling("wavetbl", "A5 C#6 E6 A6", 0.04)],
  "SID Coin":    [twoNote("sid", "Bb5", "Eb6", 0.07), octHop("sid", "Eb5", "Eb6", 0.065)],
  // ---------------- JINGLES: three or four notes, ending on the tonic
  "High Jingle": [
    J("triad-square", "three notes up a C-major triad, the tonic held", "square", 0.065, [[0, 1, 0.85, "E4 G4"], [2, 0, 5, "C5"]]),
    J("steps-narrow", "three steps up, then the octave tonic held", "narrow", 0.06, [[0, 1, 0.85, "C5 D5 E5"], [3, 0, 5, "C6"]]),
  ],
  "Bonus Bounce": [
    J("bounce-square", "a bounce between the fifth and the tonic, then up to the high tonic", "square", 0.06,
      [[0, 2, 0.8, "A4 A4"], [1, 2, 0.8, "D5 D5"], [4, 0, 4.5, "D6"]]),
    J("hop-xylo", "a xylophone hop up a D-major triad, the tonic ringing", "xylo", 0.075, [[0, 1, 1, "F#5 A5"], [2, 0, 5, "D6"]], { x: { barMallet: 0.3, barRing: 0.85, reverb: 0.1 } }),
  ],
  "Arcade Jingle": [
    J("steps-I-IV-V-I", "two-note steps up on I, IV, V, then I an octave up (a layered I-IV-V-I)", "sine", 0.07,
      [[0, 1, 0.9, "C5 E5"], [2, 1, 0.9, "F5 A5"], [4, 1, 0.9, "G5 B5"], [6, 0, 4, "C6"]], { x: { bitcrush: 8 } }),
    J("turn-fm", "a four-op FM turn: the tonic, down to the fifth, a step up twice, home", "fmbrass", 0.08,
      [[0, 1, 1, "C6 G5"], [2, 1, 1, "A5 B5"], [4, 0, 4, "C6"]], { x: { fmAlgo: 1, fmRatio2: 2, fmRatio3: 3, fmRatio4: 1, fmIndex: 0.5, fmFeedback: 0.2, filtEnv: 0, bitcrush: 12, reverb: 0.2 } }),
  ],
  // ---------------- DINGS: a struck tone that HOLDS its pitch, a second strike a fifth or octave up
  "8-Bit Ding": [
    J("bell", "a modal bell struck once on D5 and left to ring", "bell", 0.12, [[0, 0, 4, "D5"]], { x: { hf: 0.7, curve: 0, modalDecay: 2, modalBright: 0.55, modalPartials: 4, reverb: 0.15 } }),
    J("glock-fifth", "a glockenspiel ding on D5, a second strike a fifth up", "glock", 0.1, [[0, 0, 1.4, "D5"], [1.4, 0, 3.5, "A5"]], { x: { barMallet: 0.25, barRing: 0.8, reverb: 0.1 } }),
  ],
  "Chiptune Ding": [
    J("tri-octave", "a chip triangle ding on C6, a second strike an octave up", "tri", 0.1, [[0, 0, 1.6, "C6"], [1.6, 0, 4, "C7"]], { x: { held: 1, bitcrush: 8, reverb: 0.2 } }),
    J("bell-fifth", "a modal bell on C6, then a fifth up", "bell", 0.1, [[0, 0, 1.8, "C6"], [1.8, 0, 5, "G6"]], { x: { hf: 0.6, curve: 0, modalDecay: 1.5, modalBright: 0.55, reverb: 0.15 } }),
  ],
  "Retro Ding": [
    J("square-echo", "one square ding on G5, held in pitch, ringing into its echo", "square", 0.1, [[0, 0, 3, "G5"]], { x: { held: 1, hf: 0.5, curve: 0, delay: 0.3, delayTime: 0.143, delayFb: 0.4, reverb: 0.3, reverbSize: 0.7, unison: 3, detune: 8, width: 0.8 } }),
    J("vibes-fifth", "a vibraphone ding on G5, a second strike a fifth up", "vibes", 0.12, [[0, 0, 1.3, "G5"], [1.3, 0, 5.5, "D6"]]),
  ],
  // ---------------- CHIMES
  "Super Chime": [
    J("in-tune", "today's chime, in tune: D6 (1174.7 Hz) where it was 1200 Hz, 37 cents sharp", todayVoice("Super Chime", { held: 1 }), 0.15, [[0, 0, 8.5, "D6"]]),
    J("ding-dong", "a two-note chime on the warm triangle: F#6 then D6, ringing into its echo", "tri", 0.18, [[0, 0, 1.6, "F#6"], [1.6, 0, 5, "D6"]], { x: { held: 1, delay: 0.25, delayTime: 0.16, delayFb: 0.35, reverb: 0.5, reverbSize: 0.8 } }),
  ],
  "Turbo Chime": [
    J("in-tune", "today's chime, in tune: D6 where it was 1200 Hz", todayVoice("Turbo Chime", { held: 1 }), 0.12, [[0, 0, 7, "D6"]]),
    J("fourth-up", "a two-note chime up a fourth, A5 to D6, on the bright wavetable", "wavetbl", 0.12, [[0, 0, 1.4, "A5"], [1.4, 0, 5, "D6"]], { x: { held: 1, delay: 0.22, delayTime: 0.12, delayFb: 0.35, reverb: 0.35, reverbSize: 0.65 } }),
  ],
  "Ascend Chime": [
    J("major-bells", "today's bells and pace (made harmonic, inharm 0) on a major arpeggio: C5 E5 G5 C6", todayVoice("Ascend Chime", { held: 1, modalInharm: 0 }), 1 / 11, [[0, 1, 1, "C5 E5"], [2, 1, 1, "G5 C6"]]),
    J("major-glock", "a glockenspiel F-major arpeggio up an octave, the top ringing", "glock", 1 / 11, [[0, 1, 1, "F5 A5"], [2, 0, 1, "C6"], [3, 0, 5, "F6"]], { x: { barMallet: 0.25, barRing: 0.85, reverb: 0.15 } }),
  ],
  "Heavenly Chime": [
    J("major-bells", "today's high bells (made harmonic, inharm 0) on a major arpeggio: C6 E6 G6 C7, the top ringing", todayVoice("Heavenly Chime", { held: 1, modalInharm: 0 }), 0.1, [[0, 1, 1, "C6 E6"], [2, 0, 1, "G6"], [3, 0, 9, "C7"]]),
    J("fm-cascade", "an FM bell cascade up an Eb-major chord, the high tonic ringing", "fmbell", 0.11, [[0, 1, 1, "Bb4 Eb5"], [2, 1, 1, "G5 Bb5"], [4, 0, 9, "Eb6"]], { x: { reverb: 0.45, reverbSize: 0.8 } }),
  ],
  "Boot-Up Chime": [
    J("add9-chord", "a resolved boot chord on FM bell: C G D E rolled upward and held (an add9)", "fmbell", 0.07,
      [[0, 0, 13, "C4"], [1, 0, 12, "G4"], [2, 0, 11, "D5"], [3, 0, 10, "E5"]]),
    J("sus-resolves", "today's stacked fourths, G C F, and then the F resolves down to E", todayVoice("Boot-Up Chime", { held: 1 }), 1 / 9,
      [[0, 1, 1, "G4 C5 F5"], [3, 0, 7, "E5"], [3, 0, 7, "C4", { g: 0.6 }]]),
    J("vibes-chord", "a vibraphone C-major chord rolled upward and left ringing", "vibes", 0.06,
      [[0, 0, 14, "C4"], [1, 0, 13, "G4"], [2, 0, 12, "C5"], [3, 0, 11, "E5"]], { x: { barMallet: 0.35, reverb: 0.2 } }),
  ],
  "Unlock": [
    J("pluck-fourth", "today's pluck, two notes up a fourth: D5 then G5, ringing", todayVoice("Unlock", { held: 1 }), 0.09, [[0, 0, 0.9, "D5"], [1, 0, 5, "G5"]]),
    J("xylo-fourth", "a dry xylophone click-clack up a fourth, A5 then D6", "xylo", 0.08, [[0, 0, 0.9, "A5"], [1, 0, 4, "D6"]], { x: { barMallet: 0.5, barRing: 0.75, reverb: 0.1 } }),
  ],
  // ---------------- TWO OF THE EIGHT POWERUP SLIDES
  "Powerup": [
    J("arp-two-octaves", "a triangle arpeggio climbing two octaves (three interleaved octave runs) to a held top", "tri", 0.055,
      [[0, 3, 1, "C5 C6"], [1, 3, 1, "E5 E6"], [2, 3, 1, "G5 G6"], [6, 0, 7, "C7"]], { x: { reverb: 0.15 } }),
    J("fm-arp", "a bright FM arpeggio up an E-major chord, the tonic ringing", "fm2", 0.06, [[0, 1, 1, "B4 E5"], [2, 1, 1, "G#5 B5"], [4, 0, 6, "E6"]]),
  ],
  "Retro Jingle": [
    J("arp-twice", "the same A-major arpeggio twice, the second time an octave up, then the top tonic held", "square", 0.06,
      [[0, 4, 1, "A4 A5"], [1, 4, 1, "C#5 C#6"], [2, 4, 1, "E5 E6"], [8, 0, 5, "A6"]]),
    J("scale-fm", "an FM bell scale up an octave to the tonic", "fm2", 0.055, [[0, 1, 1, "G4 A4 B4"], [3, 1, 1, "C5 D5 E5"], [6, 1, 1, "F#5"], [7, 0, 6, "G5"]]),
  ],
};

// ============================================================================================================
// THE NEW PRESETS (the gaps: no Victory, Achievement, Defeat, Success or Fail jingle existed). base + alts each.
const NEW = {
  "Victory": { category: "Retro / Arcade", designs: [
    J("brass-I-IV-V-I", "blown brass: I-IV-V-I, a trumpet line G A B over trombone roots C F G, landing on C with the bass leaping an octave", "trumpet", 0.2,
      [[0, 1, 0.95, "G4 A4 B4"], [0, 1, 0.95, "C3 F3", { v: "trombone", g: 0.75 }], [2, 1, 0.95, "G3 C4", { v: "trombone", g: 0.75 }], [3, 0, 6, "C5"]]),
    J("chip-I-IV-V-I", "chip: a triplet on I, then IV, V and I an octave up, held", "square", 0.09,
      [[0, 1, 0.7, "C5 C5 C5"], [3, 0, 1.4, "F5"], [4.5, 0, 1.4, "G5"], [6, 0, 7, "C6"]]),
    J("fm-brass-I-IV-V-I", "four-op FM brass: I-IV-V-I as rising fourths, the last an octave up and held over its third", "fmbrass", 0.15,
      [[0, 1, 0.9, "D5 G5"], [2, 0, 0.9, "A5"], [3, 0, 6, "D6"], [3, 0, 6, "F#5", { g: 0.6 }]]),
    J("mallet-run", "mallets: a two-octave major arpeggio on xylophone, the top tonic on a glockenspiel", "xylo", 0.06,
      [[0, 3, 1, "F4 F5"], [1, 3, 1, "A4 A5"], [2, 3, 1, "C5 C6"], [6, 0, 10, "F6", { v: "glock" }]]),
  ] },
  "Achievement": { category: "UI", designs: [
    J("glock-item-get", "a glockenspiel rising to the tonic an octave up, a bell doubling it higher", "glock", 0.08,
      [[0, 1, 1, "C5 E5"], [2, 0, 1, "G5"], [3, 0, 9, "C6"], [3, 0, 9, "C7", { v: "bell", g: 0.4 }]], { x: { barMallet: 0.3, barRing: 0.8 } }),
    J("chip-leading-tone", "chip: G A B rising into a held C over its fifth", "narrow", 0.07,
      [[0, 1, 0.85, "G5 A5 B5"], [3, 0, 7, "C6"], [3, 0, 7, "G5", { v: "pulse", g: 0.55 }]]),
    J("vibes-V-I", "vibraphone: the fifth, then the tonic chord ringing", "vibes", 0.12,
      [[0, 0, 1.3, "D5"], [1.3, 0, 7, "G5"], [1.3, 0, 7, "B4", { g: 0.6 }], [1.3, 0, 7, "G4", { g: 0.6 }]], { x: { barMallet: 0.3, reverb: 0.15 } }),
  ] },
  "Defeat": { category: "Retro / Arcade", designs: [
    J("brass-i-vi-iv", "blown trombone: falling through A minor, F and D minor (i-vi-iv), left hanging low on a tuba", "trombone", 0.24,
      [[0, 1, 0.95, "E4 C4"], [2, 1, 0.95, "A3 F3"], [4, 0, 5, "D3"], [4, 0, 5, "D2", { v: "tuba", g: 0.8 }]]),
    J("chip-i-vi-iv", "chip: a falling fourth from each root, A, F, D (i-vi-iv), then the low D held, unresolved", "square", 0.1,
      [[0, 1, 0.85, "A5 E5"], [2, 1, 0.85, "F5 C5"], [4, 1, 0.85, "D5 A4"], [6, 0, 7, "D4"]]),
    J("mallet-roots", "soft marimba: the roots A, F, D falling, the last held over its low octave", "marimba", 0.24,
      [[0, 0, 1.9, "A4"], [2, 0, 1.9, "F4"], [4, 0, 5, "D4"], [4, 0, 5, "D3", { g: 0.7 }]]),
  ] },
  "Success": { category: "UI", designs: [
    J("vibes-up", "vibraphone: up a C-major triad to the tonic, ringing", "vibes", 0.08, [[0, 1, 1, "E5 G5"], [2, 0, 7, "C6"]]),
    J("chip-V-I", "chip: the fifth, then the tonic held over its third", "pulse", 0.07, [[0, 0, 1, "G5"], [1, 0, 6, "C6"], [1, 0, 6, "E5", { g: 0.55 }]]),
    J("fm-bell-V-I", "FM bell: a fifth up from the dominant, then the tonic", "fmbell", 0.08, [[0, 1, 1, "D5 A5"], [2, 0, 7, "D6"]]),
  ] },
  "Fail": { category: "UI", designs: [
    J("marimba-down", "marimba: two notes falling a major third, E to C, the low one ringing", "marimba", 0.1, [[0, 0, 1.4, "E5"], [1.6, 0, 6, "C5"]], { x: { barRing: 0.8 } }),
    J("chip-chromatic", "chip: a chromatic fall G, F#, landing low on F", "square", 0.08, [[0, 1, 0.85, "G4 F#4"], [2, 0, 6, "F4"]]),
    J("brass-wah-wah", "blown trombone: a half-step down, the low note held with vibrato", "trombone", 0.22,
      [[0, 0, 0.9, "Bb3"], [1, 0, 3, "A3", { x: { vibDepth: 0.05, vibRate: 5, vibOnset: 0.15 } }]]),
  ] },
};

// ============================================================================================================
// LEVELS: Normalize sets the peak at 0.9 x gain, so loudness follows gain up to 1; past that the Limiter in steps of
// 0.05 up to 0.4 (the redo rounds' rule), and a sound that still cannot get there lands short and says so
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
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); if (measure(render(p)).lufs >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  return dcGuard(p);
}
function dcGuard(p) {
  let m = measure(render(p));
  while (p.limiter && m.dc > 2e-4) { p.limiter = r2(p.limiter - 0.05); if (p.limiter <= 0) delete p.limiter; m = measure(render(p)); }
  return m;
}

// ============================================================================================================
// TUNING: every note of a design rendered SOLO (no reverb, no echo, the layer's own voice) at its pitch for at least
// 0.15 s, and its pitch read over the middle of the note (20-85%), against equal temperament. A chip wave is exact by
// construction (freq x 2^(arpStep k/12)); the check is there for the blown brass and the struck bars.
// THE METER: the fundamental partial's frequency, from a Hann-windowed, zero-padded FFT (2^17 points) over the middle
// of the note, the strongest bin within 6% of the target refined by a parabola in log power. YIN was tried first and is
// the wrong meter here: it reads a thin pulse through its aliasing jitter 10-37 cents off a fundamental this meter
// finds exact, and on a glockenspiel (modes 1 : 2.76 : 5.40) or a 3.5-ratio FM bell it locks between partials.
const FN = 1 << 17;
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
function partialHz(x, f, a, b) {
  const re = new Float64Array(FN), im = new Float64Array(FN), w = b - a;
  for (let i = a; i < b; i++) re[i - a] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / w));
  fft(re, im);
  const P = (k) => re[k] * re[k] + im[k] * im[k] + 1e-30;
  const k0 = Math.floor(f / 1.06 * FN / SR), k1 = Math.ceil(f * 1.06 * FN / SR);
  let bk = k0; for (let k = k0; k <= k1; k++) if (P(k) > P(bk)) bk = k;
  let top = 0; for (let k = 1; k < FN / 2; k++) top = Math.max(top, P(k));
  const y0 = Math.log(P(bk - 1)), y1 = Math.log(P(bk)), y2 = Math.log(P(bk + 1)), den = y0 - 2 * y1 + y2;
  return { f: (bk + (den ? 0.5 * (y0 - y2) / den : 0)) * SR / FN, db: 10 * Math.log10(P(bk) / top) };
}
// THE SECOND METER, for what is HEARD: the periodicity pitch, the autocorrelation peak within 10% of the note's period.
// It agrees with the partial on any harmonic tone and drifts when the partials are stretched (see the bells above), so
// `tune` prints both; a struck bar's own modes (a glockenspiel's 1 : 2.76) are the instrument and read off here by design.
function periodCents(x, f, a, b) {
  const A = (t) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i + t]; return s; };
  const t0 = Math.floor(SR / f / 1.1), t1 = Math.ceil(SR / f * 1.1);
  let best = -Infinity, bt = t0; for (let t = t0; t <= t1; t++) { const v = A(t); if (v > best) { best = v; bt = t; } }
  const y0 = A(bt - 1), y1 = A(bt), y2 = A(bt + 1), den = y0 - 2 * y1 + y2;
  return 1200 * Math.log2(SR / (bt + (den ? 0.5 * (y0 - y2) / den : 0)) / f);
}
function noteCents(c) {
  const out = [];
  c.order.forEach((r, li) => r.ms.forEach((m, k) => {
    const L = Math.max(0.15, r.L), p = shape(Object.assign({}, r.voice, { reverb: 0, delay: 0, vibDepth: 0, unison: 1 }), L, L, true);
    p.freq = hz(m); p.duration = L + 0.02;
    if (p.wave === 24 || p.wave === 25) p.release = p.duration;
    const x = render(p), mono = Float64Array.from(x.L, (v, i) => 0.5 * (v + x.R[i]));
    const pk = partialHz(mono, hz(m), Math.round(0.2 * L * SR), Math.round(0.85 * L * SR));
    out.push({ m, layer: li, k, cents: 1200 * Math.log2(pk.f / hz(m)), db: pk.db, ac: periodCents(mono, hz(m), Math.round(0.2 * L * SR), Math.round(0.85 * L * SR)) });
  }));
  return out;
}

// ============================================================================================================
// RUN
const ARG = process.argv[2];
const VOICE_NAME = { square: "chip square", pulse: "chip 50% pulse", narrow: "thin chip pulse (handheld)", tri: "chip triangle with echo (16-bit)",
  wavetbl: "bright wavetable (chip)", sid: "filtered PWM pulse (home-computer chip)", sine: "sine", saw: "saw unison", organ: "organ",
  fmbell: "FM 4-op bell", fmbrass: "FM 4-op brass", fm2: "simple FM (2-op)", trumpet: "blown-brass trumpet", trombone: "blown-brass trombone",
  tuba: "blown-brass tuba", glock: "glockenspiel (bar)", xylo: "xylophone (bar)", marimba: "marimba (bar)", vibes: "vibraphone (bar)",
  bell: "modal bell", pluck: "pluck" };
const voiceLabel = (d, pname) => {
  const main = typeof d.voice === "function" ? "today's " + pname + " voice" : VOICE_NAME[d.voice];
  const extra = [...new Set(d.runs.map((r) => r[4] && r[4].v).filter((v) => v && v !== d.voice))].map((v) => VOICE_NAME[v]);
  return main + (extra.length ? " + " + extra.join(" + ") : "");
};
const sectionOf = (n) => (CATS.find((c) => c[1].includes(n)) || ["?"])[0];
const base = (n) => { const p = Object.assign({}, PRESETS[n]); delete p._vary; delete p._alts; return p; };
const wavDir = join(ROOT, "soundtests", "jingles"), jsonDir = join(ROOT, "tools", "new-presets");
mkdirSync(wavDir, { recursive: true });
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
function concat(list) {
  const gap = Math.round(0.5 * SR), n = list.reduce((t, r) => t + r.L.length + gap, 0) - gap;
  const L = new Float32Array(n), R = new Float32Array(n); let o = 0;
  for (const r of list) { L.set(r.L, o); R.set(r.R, o); o += r.L.length + gap; }
  return { L, R };
}
function extend(p, dt) {
  const grow = (q) => { q.duration = r3(Math.min(2, (q.duration ?? DEF.duration) + dt)); if ((q.wave === 24 || q.wave === 25) && !(q.repeat > 1)) q.release = r3(Math.min(1.5, q.duration)); };
  grow(p);
  if (p.layers) { const ls = JSON.parse(p.layers); for (const l of ls) grow(l.s); p.layers = JSON.stringify(ls); }
}
// a design -> { p (the patch, levelled), c (compiled notes, or null for a raw patch), m (its measurement) }
function build(d, target) {
  let c = null, p;
  if (d.raw) p = d.raw(); else { c = compile(d); p = c.p; }
  let m = level(p, target);
  // a reverb or echo still ringing in the last 10 ms (above -30 dB of the peak) is cut by the buffer's end: lengthen
  // every layer by 0.1 s and level again, until it has room (a layer is at most 2 s)
  for (let k = 0; k < 6 && m.tailDb > -30; k++) { extend(p, 0.1); m = level(p, target); }
  return { p, c, m, target };
}
const knownKeys = (p) => Object.keys(p).filter((k) => !(k in DEF) && !["layers", "_alts", "_vary", "category"].includes(k));
function check(name, id, b) {
  const bad = [];
  if (b.m.peak > 0.981) bad.push("peak " + b.m.peak.toFixed(3));
  if (Math.abs(b.m.lufs - b.target) > 2) bad.push("level " + (b.m.lufs - b.target).toFixed(1) + " dB off");
  if (b.m.nan) bad.push(b.m.nan + " NaN samples");
  if (b.m.dc > 2e-4) bad.push("DC " + b.m.dc.toExponential(1));
  if (b.m.fallMs <= 5) bad.push("cut ending (" + b.m.fallMs.toFixed(1) + " ms from 30%)");
  if (b.m.tailDb > -30) bad.push("last 10 ms at " + b.m.tailDb.toFixed(1) + " dB");
  if (b.p.gain > 1) bad.push("gain " + b.p.gain);
  const unk = knownKeys(b.p).concat(b.p.layers ? JSON.parse(b.p.layers).flatMap((l) => knownKeys(l.s)) : []);
  if (unk.length) bad.push("unknown keys " + unk.join(","));
  if (b.p.layers) for (const l of JSON.parse(b.p.layers)) { if (l.d > 1) bad.push("layer delay " + l.d + " s (the slider stops at 1 s)"); if (l.s.freq > 4000 || l.s.freq < 20) bad.push("freq " + l.s.freq); }
  if (b.p.freq > 4000) bad.push("freq " + b.p.freq);
  if (b.p.duration > 2) bad.push("duration " + b.p.duration);
  if (b.c) {
    const t = noteCents(b.c), worst = t.reduce((a, q) => (Math.abs(q.cents) > Math.abs(a.cents) || isNaN(q.cents) ? q : a), { cents: 0 });
    b.tune = worst;
    if (isNaN(worst.cents) || Math.abs(worst.cents) > 10) bad.push("tuning: " + nm(worst.m) + " " + (isNaN(worst.cents) ? "unread" : worst.cents.toFixed(1) + " c"));
  }
  if (bad.length) console.log("  !! " + name + " / " + id + ": " + bad.join("; "));
  return bad;
}
const fmtM = (m) => m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(2) + ", " + m.sec.toFixed(2) + " s";
const fmtLv = (p) => "gain " + p.gain + (p.limiter ? ", limiter " + p.limiter : "");

if (ARG === "tune") {
  const all = Object.entries(ALTS).flatMap(([n, ds]) => ds.filter((d) => !d.raw).map((d) => [n, d])).concat(Object.entries(NEW).flatMap(([n, o]) => o.designs.map((d) => [n, d])));
  let worst = 0;
  for (const [n, d] of all) {
    const c = compile(d), t = noteCents(c), w = t.reduce((a, q) => Math.max(a, isNaN(q.cents) ? 999 : Math.abs(q.cents)), 0);
    worst = Math.max(worst, w);
    console.log((n + " / " + d.id).padEnd(46) + noteText(c).padEnd(54) + " worst " + (w === 999 ? "UNREAD" : w.toFixed(1) + " c") +
      (w > 3 ? "  [" + t.filter((q) => isNaN(q.cents) || Math.abs(q.cents) > 3).map((q) => nm(q.m) + " " + (isNaN(q.cents) ? "?" : q.cents.toFixed(1))).join(", ") + "]" : "") +
      (t.some((q) => Math.abs(q.ac) > 15) ? "  periodicity off: " + t.filter((q) => Math.abs(q.ac) > 15).map((q) => nm(q.m) + " " + q.ac.toFixed(0)).join(", ") : ""));
  }
  console.log("worst note in the set: " + worst.toFixed(1) + " cents");
  process.exit(0);
}

// x <target LUFS> '<J(...) expr>' ...: level each design to the target and print what it reaches, nothing written
if (ARG === "x") {
  const target = +process.argv[3];
  for (const e of process.argv.slice(4)) { const d = eval(e), b = build(d, target); console.log((b.m.lufs - target).toFixed(1).padStart(6) + " dB  " + fmtLv(b.p) + "  end " + b.m.tailDb.toFixed(0) + " dB  " + b.m.sec.toFixed(2) + " s  " + (d.id || "")); }
  process.exit(0);
}
const only = ARG && ARG !== "all" ? ARG : null;
const key = ["# Jingle alternatives (CrunchySFX)", "",
  "Proposal round: `node tools/proto/jingles.mjs`. Not blind: every file says what it is. Each existing preset KEEPS today's sound as its base (`<slug>-0-now.wav`) and gains the alts beside it (the button plays the base or one alt at random per click). `<slug>-all.wav` is today's, then each alt, 0.5 s apart. Levels: each alt's BS.1770 loudness is matched to its preset's base; the new presets sit on their section's median. Notes are exact equal temperament (A4 = 440); `(held)` marks a long note, `[a+b]` a chord.", ""];
const altJson = {}, newJson = {}, allNew = [], problems = [];
let nAlts = 0, maxDev = 0, worstTune = 0;
for (const [name, designs] of Object.entries(ALTS)) {
  if (only && slug(name) !== only) continue;
  if (!PRESETS[name]) throw new Error("no preset " + name);
  const s = slug(name), now = render(base(name)), mNow = measure(now), target = mNow.lufs;
  wav(s + "-0-now.wav", now, name + " (today)");
  key.push("## " + name + " (" + sectionOf(name) + ")", "", "- `" + s + "-0-now.wav`: today's sound, kept as the base. " + fmtM(mNow) + ".");
  const outs = [now], alts = [];
  designs.forEach((d, i) => {
    const b = build(d, target), bad = check(name, d.id, b), r = render(b.p);
    problems.push(...bad.map((x) => name + " / " + d.id + ": " + x));
    const f = s + "-alt" + (i + 1) + "-" + d.id + ".wav";
    wav(f, r, name + " alt " + (i + 1) + ": " + d.id);
    outs.push(r); alts.push(b.p); nAlts++;
    maxDev = Math.max(maxDev, Math.abs(b.m.lufs - target));
    if (b.tune) worstTune = Math.max(worstTune, Math.abs(b.tune.cents));
    key.push("- `" + f + "`: " + (b.c ? noteText(b.c) + "; " + voiceLabel(d, name) + "; " : "") + d.what + ". " + (b.m.lufs - target >= 0 ? "+" : "") + (b.m.lufs - target).toFixed(1) + " dB against today's (" + fmtLv(b.p) + ")" + (b.c ? ", " + b.c.order.length + " layer" + (b.c.order.length > 1 ? "s" : "") : "") + ".");
  });
  key.push("");
  wav(s + "-all.wav", concat(outs), name + ": today's, then each alt");
  const full = Object.assign({}, PRESETS[name]);
  const o = {}; for (const [k, v] of Object.entries(full)) if (k !== "layers" && k !== "_alts") o[k] = v;
  o._alts = (full._alts || []).concat(alts);
  if (full.layers) o.layers = full.layers;
  altJson[name] = o;
  console.log(name.padEnd(16) + " today " + fmtM(mNow) + " · " + designs.length + " alts");
}
// THE NEW PRESETS: their section's median loudness (today's bases in that section)
const medianOf = {};
const sectionMedian = (sec) => medianOf[sec] ??= median(CATS.find((c) => c[0] === sec)[1].filter((n) => PRESETS[n]).map((n) => measure(render(base(n))).lufs));
key.push("# New presets", "");
for (const [name, o] of Object.entries(NEW)) {
  if (only && slug(name) !== only) continue;
  if (PRESETS[name]) throw new Error("a preset called " + name + " already exists");
  const s = slug(name), target = sectionMedian(o.category), outs = [], built = [];
  key.push("## " + name + " (NEW, " + o.category + "; that section's median " + target.toFixed(1) + " LUFS)", "");
  o.designs.forEach((d, i) => {
    const b = build(d, target), bad = check(name, d.id, b), r = render(b.p);
    problems.push(...bad.map((x) => name + " / " + d.id + ": " + x));
    const f = s + "-" + (i ? "alt" + i : "0-base") + "-" + d.id + ".wav";
    wav(f, r, name + (i ? " alt " + i : " (base)") + ": " + d.id);
    outs.push(r); built.push(b.p); allNew.push(r);
    maxDev = Math.max(maxDev, Math.abs(b.m.lufs - target));
    if (b.tune) worstTune = Math.max(worstTune, Math.abs(b.tune.cents));
    key.push("- `" + f + "`" + (i ? "" : " (the BASE)") + ": " + noteText(b.c) + "; " + voiceLabel(d, name) + "; " + d.what + ". " + b.m.lufs.toFixed(1) + " LUFS (" + fmtLv(b.p) + "), " + b.c.order.length + " layer" + (b.c.order.length > 1 ? "s" : "") + ".");
  });
  key.push("");
  wav(s + "-all.wav", concat(outs), name + ": the base, then each alt");
  const p0 = built[0], obj = { category: o.category };
  for (const [k, v] of Object.entries(p0)) if (k !== "layers") obj[k] = v;
  obj._alts = built.slice(1);
  if (p0.layers) obj.layers = p0.layers;
  newJson[name] = obj;
  console.log(name.padEnd(16) + " NEW in " + o.category + " (median " + target.toFixed(1) + ") · base + " + (o.designs.length - 1) + " alts");
}
if (allNew.length) wav("all-new.wav", concat(allNew), "the new jingle presets, each base then its alts");
if (!only) {
  writeFileSync(join(jsonDir, "jingle-alts.json"), JSON.stringify(altJson, null, 2) + "\n");
  writeFileSync(join(jsonDir, "jingles-new.json"), JSON.stringify(newJson, null, 2) + "\n");
  key.push("`all-new.wav` plays the five new presets in order, each base then its alts, 0.5 s apart.", "");
  writeFileSync(join(wavDir, "KEY.md"), key.join("\n"));
}
console.log("\n" + nAlts + " alts on " + Object.keys(altJson).length + " presets, " + Object.keys(newJson).length + " new presets · worst level miss " + maxDev.toFixed(2) + " dB · worst note " + worstTune.toFixed(1) + " cents · " + problems.length + " problems");
