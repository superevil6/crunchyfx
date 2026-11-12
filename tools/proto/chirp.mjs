/* chirp.mjs — PROTOTYPE of a "chirp" engine for CrunchySFX (birdsong + insects), and the blind round that auditions it.
 *
 *   node tools/proto/chirp.mjs              lists the rounds
 *   node tools/proto/chirp.mjs all          renders every round into soundtests/proto-chirp/<sound>/
 *   node tools/proto/chirp.mjs <round>      one round
 *   node tools/proto/chirp.mjs plan <round> prints each model take's syllable plan (no audio written)
 *   node tools/proto/chirp.mjs buzz         a sanity render of the buzz creature (measured, not written)
 *
 * The model lives in tools/proto/chirp/model.mjs (re-exported here) so it can be ported into dsp.js as one block:
 * makeChirp(sr, n, cfg, seed) -> { L, R, events } is a buffered engine like makeBubbles/makeWhoosh, chirpCfg(st) maps
 * the proposed PARAMS rows (CHIRP_PARAMS) to it.
 *
 * ROOM, CONSISTENTLY: every model take is run THROUGH THE REAL SFX CHAIN as an imported sample (wave 9, freq 440 =
 * native speed, `opts.sample`), with the CONTROL preset's own reverb settings copied in, a 40 Hz high-pass as the filter
 * (the low-pass default would shave a bird at 8 kHz) and drive 0. Stereo is kept by sending L and R through separately
 * (the sample path is mono). So a take differs from its control in the SOURCE only, never the room.
 *
 * Takes are matched to -18 LUFS (BS.1770, copied from tools/make-ab.mjs) and capped at 0.95 peak; order shuffled with a
 * fixed seed per round (make-ab's shuffle). The CONTROL is the current preset rendered by the exported engine
 * (synth-export/crunchysfx-synth.js) in a node vm, exactly as make-ab.mjs does.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeChirp, chirpCfg, CHIRP_PARAMS, CHIRP_DEFAULTS, CHIRP_GESTURES } from "./chirp/model.mjs";
import { measure, fmtMeasure, aliasCheck } from "./chirp/measure.mjs";
export { makeChirp, chirpCfg, CHIRP_PARAMS, CHIRP_DEFAULTS, CHIRP_GESTURES };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGET_LUFS = -18;
const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
  Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ctx.window = ctx; ctx.globalThis = ctx;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS;
const preset = (n) => { const o = Object.assign({}, PRESETS[n]); delete o._vary; return o; };
const ROOM_KEYS = ["reverb", "reverbSize", "reverbTone", "convMix", "convType", "convSize", "convTone", "delay", "delayTime", "delayFb", "pingpong"];

// ---- the takes. A take is { id, why, dur, parts: [{ at (s), gain, seed, st (knobs) }] } — one part is the engine as one
// patch would play it; more than one part is the app's LAYERS (each a chirp patch), and says so.
const P = (st, o) => Object.assign({ at: 0, gain: 1, seed: 1 }, o || {}, { st });
const bird = (o) => Object.assign({ chirpMode: 0 }, o);
const bug = (o) => Object.assign({ chirpMode: 1 }, o);

const ROUNDS = {
  "bird-chirp": {
    title: "Bird Chirp", control: "Bird Chirp",
    listen: "A small bird's chirp, the kind a game plays when a bird hops past or takes off. Which one is a BIRD (rather than a beep)? Listen for whether the pitch MOVES inside each note the way a bird's does, and whether it sounds like a throat or like an oscillator.",
    takes: [
      { id: "cheep", why: "ONE ENGINE PATCH. A sparrow-style 'cheep cheep': two arched syllables (up and over, 0.7 oct) around 3.6 kHz, ~75 ms each, with a little 2nd/3rd harmonic that grows with loudness.", dur: 0.6,
        parts: [P(bird({ chirpPitch: 3600, chirpGesture: 3, chirpSpan: 0.7, chirpRate: 6, chirpDuty: 0.45, chirpCount: 2, chirpGroups: 1, chirpRand: 0.3, chirpHarm: 0.35 }), { seed: 11 })] },
      { id: "chip-call", why: "ONE ENGINE PATCH. A songbird 'chip' call: three very short (~15 ms) steep down-sweeps from ~7 kHz to ~3 kHz, nearly pure. Sharper and drier than a cheep.", dur: 0.6,
        parts: [P(bird({ chirpPitch: 4600, chirpGesture: 6, chirpSpan: 1.3, chirpRate: 7, chirpDuty: 0.1, chirpCount: 3, chirpGroups: 1, chirpRand: 0.25, chirpHarm: 0.05 }), { seed: 12 })] },
      { id: "tsee-wit-2voice", why: "ONE ENGINE PATCH. Two up-slurred whistles with the SECOND VOICE on (the other side of the syrinx): it sits a fifth below and glides the other way, so each note is two independent tones crossing.", dur: 0.6,
        parts: [P(bird({ chirpPitch: 4200, chirpGesture: 1, chirpSpan: 0.5, chirpRate: 5, chirpDuty: 0.6, chirpCount: 2, chirpGroups: 1, chirpRand: 0.2, chirpHarm: 0.15, chirpVoice2: 0.6, chirpInterval: -7 }), { seed: 13 })] },
    ],
  },
  "bird-trill": {
    title: "Bird Trill", control: "Bird Trill",
    listen: "A bird trilling: one sound repeated very fast. Which one is a real bird TRILL? Listen for the speed of the repeats, whether each repeat is a little shaped note (a slur) or a wobble, and whether it goes anywhere.",
    takes: [
      { id: "flat-trill", why: "ONE ENGINE PATCH. A dry sparrow/junco trill: one short down-slurred syllable repeated 18 times a second, steady pitch ~5 kHz.", dur: 1.0,
        parts: [P(bird({ chirpPitch: 5000, chirpGesture: 2, chirpSpan: 0.6, chirpRate: 18, chirpDuty: 0.55, chirpCount: 16, chirpGroups: 1, chirpRand: 0.1, chirpHarm: 0.1 }), { seed: 21 })] },
      { id: "cascade", why: "ONE ENGINE PATCH. A 'bouncing ball' cascade: down-slurred whistles that ACCELERATE (4 -> 14 a second) and DESCEND (0.6 oct) as they go, like a wren's falling song.", dur: 2.2,
        parts: [P(bird({ chirpPitch: 3800, chirpGesture: 2, chirpSpan: 0.3, chirpRate: 4, chirpDuty: 0.7, chirpCount: 14, chirpGroups: 1, chirpAccel: 1.8, chirpDrift: -0.6, chirpRand: 0.1, chirpHarm: 0.12 }), { seed: 22 })] },
      { id: "liquid-roll", why: "ONE ENGINE PATCH. A canary-style ROLL: arched syllables at 26 a second, almost joined, with the second voice a third above moving the other way, so it bubbles rather than ticks.", dur: 1.0,
        parts: [P(bird({ chirpPitch: 3000, chirpGesture: 3, chirpSpan: 0.35, chirpRate: 26, chirpDuty: 0.8, chirpCount: 22, chirpGroups: 1, chirpRand: 0.12, chirpHarm: 0.3, chirpVoice2: 0.5, chirpInterval: 4 }), { seed: 23 })] },
    ],
  },
  "cricket-chirp": {
    title: "Cricket Chirp", control: "Cricket Chirp",
    listen: "A cricket at night. Which one is a CRICKET? Listen for the pulses inside each chirp (a real one is 3-5 quick pulses, not one beep), and whether the tone is a clean whistle or a scrape.",
    takes: [
      { id: "field-cricket", why: "ONE ENGINE PATCH (stridulation). A field cricket: a pure 4.7 kHz carrier gliding 3% down through each wing stroke, 4 pulses at 30/s make a chirp, two chirps ~0.45 s apart.", dur: 0.7,
        parts: [P(bug({ chirpPitch: 4700, chirpSpan: 0.05, chirpRate: 30, chirpDuty: 0.55, chirpCount: 4, chirpGroups: 2, chirpGroupGap: 0.33, chirpRand: 0.08, chirpHarm: 0.25 }), { seed: 31 })] },
      { id: "katydid-rasp", why: "ONE ENGINE PATCH (stridulation, rasp 0.85). A katydid's 'ch-ch-ch': the same pulse structure, but each pulse is tooth strikes ringing a broad 7 kHz resonance, a scrape instead of a whistle.", dur: 0.6,
        parts: [P(bug({ chirpPitch: 7000, chirpSpan: 0.1, chirpRasp: 0.85, chirpRate: 9, chirpDuty: 0.6, chirpCount: 3, chirpGroups: 1, chirpRand: 0.3, chirpHarm: 0 }), { seed: 32 })] },
      { id: "tree-cricket-purr", why: "ONE ENGINE PATCH (stridulation). A tree cricket's continuous purr: a lower, softer 2.7 kHz carrier pulsed 55 times a second without a break. The quiet-night version.", dur: 1.2,
        parts: [P(bug({ chirpPitch: 2700, chirpSpan: 0.02, chirpRate: 55, chirpDuty: 0.5, chirpCount: 200, chirpGroups: 1, chirpRand: 0.05, chirpHarm: 0.1 }), { seed: 33 })] },
    ],
  },
  "songbird-phrase": {
    title: "Songbird Phrase (a gap)", control: "Bird Trill", controlWhy: "no preset sings a phrase; Bird Trill is the nearest (the CONTROL).",
    listen: "A songbird SINGING a short phrase: ambience for a forest or a village morning, a few seconds long. Which one sounds like a bird singing a song (not a loop of beeps)? Listen for structure: does it have sections, does it go somewhere, does it end?",
    takes: [
      { id: "sparrow-song", why: "ONE ENGINE PATCH (gesture 'Mixed phrase'). A sparrow-style song: SECTIONS of repeated syllables, each section a different syllable type and pitch (slurs, chips, warbles, whistles), drifting down to an end.", dur: 2.4,
        parts: [P(bird({ chirpPitch: 3800, chirpGesture: 7, chirpSpan: 0.7, chirpRate: 13, chirpDuty: 0.65, chirpCount: 5, chirpGroups: 4, chirpGroupGap: 0.05, chirpDrift: -0.3, chirpRand: 0.35, chirpHarm: 0.15 }), { seed: 0 })] },
      { id: "carol", why: "ONE ENGINE PATCH (gesture 'Mixed phrase', 1-2 syllables per section). A robin-style carol: a string of VARIED single syllables with short gaps, more harmonics, a touch of second voice. Nothing repeats.", dur: 2.4,
        parts: [P(bird({ chirpPitch: 2900, chirpGesture: 7, chirpSpan: 0.6, chirpRate: 6, chirpDuty: 0.75, chirpCount: 1, chirpGroups: 9, chirpGroupGap: 0.1, chirpRand: 0.6, chirpHarm: 0.35, chirpVoice2: 0.25, chirpInterval: 3 }), { seed: 0 })] },
      { id: "thrush-flute", why: "TWO LAYERS (two chirp patches, as the app's Layers would hold them). A thrush-style flute: three slow pure whistles stepping down with the second voice a fifth above, then a rising two-voice warble as the flourish.", dur: 2.4,
        parts: [
          P(bird({ chirpPitch: 2400, chirpGesture: 0, chirpSpan: 0.3, chirpRate: 3.2, chirpDuty: 0.85, chirpCount: 3, chirpGroups: 1, chirpDrift: -0.45, chirpRand: 0.1, chirpHarm: 0.1, chirpVoice2: 0.55, chirpInterval: 7 }), { seed: 51 }),
          P(bird({ chirpPitch: 3600, chirpGesture: 5, chirpSpan: 0.5, chirpRate: 2, chirpDuty: 0.9, chirpCount: 1, chirpGroups: 1, chirpRand: 0.1, chirpHarm: 0.15, chirpVoice2: 0.6, chirpInterval: 5 }), { at: 1.0, gain: 0.8, seed: 52, dur: 0.5 }),
        ] },
    ],
  },
  "night-insects": {
    title: "Night Insects (a gap)", control: "Cricket Chirp", controlWhy: "no preset is a night ambience; Cricket Chirp is the nearest (the CONTROL), at its own 0.7 s.",
    listen: "A field at night: ambience under a night scene, a few seconds, meant to sit in the background. Which one is a NIGHT FULL OF INSECTS? Listen for depth (near and far ones), whether it reads as many animals, and whether it would get annoying on loop.",
    takes: [
      { id: "cricket-chorus", why: "ONE ENGINE PATCH (6 individuals). Six field crickets, each its own pitch (+-8%), tempo, timing, distance (quieter and duller further off) and place in the stereo field.", dur: 3.0,
        parts: [P(bug({ chirpPitch: 4600, chirpSpan: 0.05, chirpRate: 30, chirpDuty: 0.55, chirpCount: 4, chirpGroups: 0, chirpGroupGap: 0.3, chirpRand: 0.6, chirpHarm: 0.2, chirpChorus: 6 }), { seed: 61 })] },
      { id: "meadow", why: "THREE LAYERS (three chirp patches). Mixed species: three field crickets, two distant tree crickets purring underneath, and one katydid rasping now and then.", dur: 3.0,
        parts: [
          P(bug({ chirpPitch: 4600, chirpSpan: 0.05, chirpRate: 30, chirpDuty: 0.55, chirpCount: 4, chirpGroups: 0, chirpGroupGap: 0.3, chirpRand: 0.6, chirpHarm: 0.2, chirpChorus: 3 }), { seed: 62 }),
          P(bug({ chirpPitch: 2700, chirpSpan: 0.02, chirpRate: 55, chirpDuty: 0.5, chirpCount: 400, chirpGroups: 0, chirpRand: 0.3, chirpHarm: 0.1, chirpChorus: 2 }), { seed: 63, gain: 0.35 }),
          P(bug({ chirpPitch: 7000, chirpSpan: 0.1, chirpRasp: 0.85, chirpRate: 9, chirpDuty: 0.6, chirpCount: 3, chirpGroups: 0, chirpGroupGap: 0.9, chirpRand: 0.4, chirpHarm: 0 }), { seed: 64, gain: 0.45, at: 0.4 }),
        ] },
      { id: "synced-chorus", why: "ONE ENGINE PATCH (7 individuals, randomness ~0). Tree crickets that chirp IN TIME with each other, as real ones do: the whole field pulses together twice a second, each at its own pitch and distance.", dur: 3.0,
        parts: [P(bug({ chirpPitch: 2900, chirpSpan: 0.03, chirpRate: 50, chirpDuty: 0.5, chirpCount: 8, chirpGroups: 0, chirpGroupGap: 0.34, chirpRand: 0.03, chirpHarm: 0.1, chirpChorus: 7 }), { seed: 65 })] },
    ],
  },
};

// ---- loudness: ITU BS.1770 (copied from tools/make-ab.mjs)
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
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
function matchLoudness(L, R) {
  let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
  if (pk > 0.95) gn *= 0.95 / pk;
  for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  return lufs(L, R);
}

// ---- rendering
function renderDry(take, sr) {   // the model's own output: every part summed at its offset
  const n = Math.round(take.dur * sr), L = new Float32Array(n), R = new Float32Array(n), events = [];
  for (const p of take.parts) {
    const pn = Math.min(n - Math.round(p.at * sr), Math.round((p.dur || take.dur - p.at) * sr));
    const r = makeChirp(sr, pn, chirpCfg(p.st), p.seed), o = Math.round(p.at * sr);
    for (let i = 0; i < pn; i++) { L[o + i] += r.L[i] * p.gain; R[o + i] += r.R[i] * p.gain; }
    for (const e of r.events) events.push(Object.assign({}, e, { t: e.t + p.at }));
  }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk > 0) for (let i = 0; i < n; i++) { L[i] *= 0.5 / pk; R[i] *= 0.5 / pk; }
  return { L, R, events: events.sort((a, b) => a.t - b.t) };
}
function throughChain(dry, room) {   // the real SFX chain, the dry take as an imported sample, L and R separately
  const tail = room.reverb > 0 || room.convMix > 0 || room.delay > 0 ? 0.7 : 0.02;
  const n = dry.L.length + Math.round(tail * SR);
  const pad = (x) => { const b = new Float32Array(n); b.set(x); return b; };
  const patch = Object.assign({}, CS.DEFAULTS, room, { wave: 9, freq: 440, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.005,
    filterMode: 1, cutoff: 40, reso: 0, drive: 0, duration: n / SR });
  const a = CS.render(patch, { sample: pad(dry.L), normalize: false }), b = CS.render(patch, { sample: pad(dry.R), normalize: false });
  return { L: Float32Array.from(a.L), R: Float32Array.from(b.R), patch };
}
function controlTake(name) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, preset(name)), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}

function run(name) {
  const round = ROUNDS[name];
  const room = {}; const cp = preset(round.control);
  for (const k of ROOM_KEYS) if (cp[k] != null) room[k] = cp[k];
  const takes = [{ id: "current", control: true, why: "the CURRENT preset `" + round.control + "`, " + (round.controlWhy || "the CONTROL.") +
    " Patch: `" + JSON.stringify(cp) + "`" }].concat(round.takes);
  let seed = 0x5f3759df;
  for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const order = takes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = join(ROOT, "soundtests", "proto-chirp", name), key = [];
  mkdirSync(out, { recursive: true });
  console.log(name + "  (room from `" + round.control + "`: " + JSON.stringify(room) + ")");
  order.forEach((ti, slot) => {
    const t = takes[ti], file = "take-" + "ABCDEFGH"[slot] + ".wav";
    let wav, dryQ = null, alias = null;
    if (t.control) wav = controlTake(round.control);
    else {
      const dry = renderDry(t, SR);
      dryQ = measure(dry.L, dry.R, SR);
      const hi = renderDry(t, SR * 4);
      alias = aliasCheck(Float64Array.from(dry.L, (v, i) => 0.5 * (v + dry.R[i])), Float64Array.from(hi.L, (v, i) => 0.5 * (v + hi.R[i])), SR, SR * 4);
      dryQ.plan = planSummary(dry.events);
      if (t.parts.length > 1) alias.parts = t.parts.map((p) => { const one = { dur: t.dur, parts: [Object.assign({}, p, { at: 0 })] }, a = renderDry(one, SR), b = renderDry(one, SR * 4);
        return aliasCheck(Float64Array.from(a.L, (v, i) => 0.5 * (v + a.R[i])), Float64Array.from(b.L, (v, i) => 0.5 * (v + b.R[i])), SR, SR * 4).coarse.toFixed(1); });
      wav = throughChain(dry, room);
    }
    const lu = matchLoudness(wav.L, wav.R), q = measure(wav.L, wav.R, SR);
    writeFileSync(join(out, file), Buffer.from(CS.encodeWav(wav.L, wav.R, { rate: SR, depth: 16, channels: 2, title: "chirp " + name + " " + file })));
    key.push({ file, t, q, dryQ, alias, lu });
    console.log("  " + file + " " + t.id.padEnd(18) + " " + lu.toFixed(1) + " LUFS | WAV: " + fmtMeasure(q));
    if (dryQ) {
      console.log("      dry: " + fmtMeasure(dryQ));
      console.log("      plan: " + dryQ.plan);
      console.log("      alias (44.1k vs 176.4k, <16 kHz): coarse " + alias.coarse.toFixed(1) + " dB, fine " + alias.fine.toFixed(1) + " dB" + (alias.parts ? "; each layer alone, coarse: " + alias.parts.join(", ") + " dB (the sum differs because each layer is peak-normalized on its own SAMPLED peak)" : ""));
    }
  });
  const n = takes.length, last = "ABCDEFGH"[n - 1];
  writeFileSync(join(out, "LISTEN.md"), "# " + round.title + "\n\n" + n + " takes, `take-A.wav` to `take-" + last + ".wav`, each matched to " + TARGET_LUFS +
    " LUFS, in a shuffled order. One is the current preset; the others are a prototype \"chirp\" engine (birdsong + insects).\n\n" + round.listen +
    "\n\nSay the letter (and a runner-up if two are close). `KEY.md` says what each one is: **read it after listening.**\n");
  const f = (v, d = 0) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(d));
  writeFileSync(join(out, "KEY.md"), "# " + round.title + ": the key\n\nModel takes are run through the real SFX chain as an imported sample with the control's room (" +
    (Object.keys(room).length ? "`" + JSON.stringify(room) + "`" : "no reverb, as the control has none") + "), so they differ in the source only.\n\n" +
    key.map((k) => "## " + k.file + ": `" + k.t.id + "`" + (k.t.control ? " (CONTROL)" : "") + "\n" + k.t.why + "\n\n" +
      "Measured (the WAV): " + f(k.q.sec, 2) + " s, " + f(k.lu, 1) + " LUFS, peak " + f(k.q.peak, 3) + "; pitch p5-p95 " + f(k.q.f05) + "-" + f(k.q.f95) + " Hz" +
      (k.dryQ ? "; dry model: " + k.dryQ.n + " onsets at " + f(k.dryQ.rate, 1) + "/s in " + k.dryQ.groups + " group(s), gating " + f(k.dryQ.depth) + " dB, silent " + f(100 * k.dryQ.quiet) + "% of the time; alias check (44.1 vs 176.4 kHz, 500 Hz bands; clean -58, aliasing -12) " + f(k.alias.coarse, 1) + " dB" + (k.alias.parts ? " (layers alone: " + k.alias.parts.join(", ") + ")" : "") : "; " + (k.q.n || 0) + " onsets at " + f(k.q.rate, 1) + "/s") + ".\n\n" +
      (k.t.parts ? "```json\n" + JSON.stringify(k.t.parts.map((p) => ({ at: p.at, gain: p.gain, seed: p.seed, patch: Object.assign({ wave: "chirp" }, p.st) }))) + "\n```\n" : "")).join("\n"));
  console.log("  -> " + out);
}
function planSummary(ev) {
  if (!ev.length) return "(empty)";
  const fs = ev.map((e) => e.c), lo = Math.min(...fs), hi = Math.max(...fs), who = new Set(ev.map((e) => e.who)).size;
  // gesture runs (a section = consecutive syllables of one gesture, for the first individual)
  const runs = []; for (const e of ev.filter((e) => e.who === 0)) { const r = runs[runs.length - 1]; if (r && r.g === e.g) r.n++; else runs.push({ g: e.g, n: 1 }); }
  return ev.length + " events, " + who + " individual(s), centers " + lo.toFixed(0) + "-" + hi.toFixed(0) + " Hz; sections: " +
    runs.slice(0, 12).map((r) => (r.g < 0 ? "pulse" : CHIRP_GESTURES[r.g]) + "x" + r.n).join(", ") + (runs.length > 12 ? ", ..." : "");
}

const want = process.argv[2];
if (!want) { console.log("rounds: " + Object.keys(ROUNDS).join(", ") + ", all | plan <round> | buzz"); }
else if (want === "plan") {
  const r = ROUNDS[process.argv[3]];
  for (const t of r.takes) { const d = renderDry(t, SR); console.log(t.id + ": " + planSummary(d.events)); for (const e of d.events.slice(0, 40)) console.log("   t " + e.t.toFixed(3) + " len " + (e.len * 1000).toFixed(0) + " ms  " + (e.g < 0 ? "pulse" : CHIRP_GESTURES[e.g]).padEnd(9) + " c " + e.c.toFixed(0) + " span " + e.span.toFixed(2) + " who " + e.who); }
} else if (want === "calibrate") {
  // what the alias meter reads on known signals: an up/down sweep 2 -> 9 kHz, 60 ms, x8 with gaps; the same sweep with
  // five UNTAPERED harmonics (the failure tap() prevents); and a naive square wave on it
  const sig = (sr, kind) => {
    const n = Math.round(1.0 * sr), x = new Float64Array(n);
    for (let s = 0; s < 8; s++) {
      const t0 = 0.02 + s * 0.12, i0 = Math.ceil(t0 * sr), i1 = Math.ceil((t0 + 0.06) * sr); let ph = 0, fp = -1;
      for (let i = i0; i < i1; i++) {   // exact start + trapezoid phase, as the model does
        const u = (i / sr - t0) / 0.06, f = 2000 * Math.pow(4.5, Math.sin(Math.PI * u)), env = Math.sin(Math.PI * u) ** 2;
        ph += 2 * Math.PI * 0.5 * (f + (fp < 0 ? f : fp)) / sr; fp = f;
        let y = Math.sin(ph);
        if (kind === 1) for (let k = 2; k <= 5; k++) y += Math.sin(k * ph) / k;
        if (kind === 2) y = Math.sign(Math.sin(ph));
        x[i] = env * y;
      }
    }
    return x;
  };
  for (const [kind, name] of [[0, "sine sweep (alias-free)"], [1, "sweep + 4 untapered harmonics"], [2, "naive square sweep"]]) {
    const a = aliasCheck(sig(SR, kind), sig(SR * 4, kind), SR, SR * 4);
    console.log(name.padEnd(32) + " coarse (500 Hz) " + a.coarse.toFixed(1) + " dB, fine (50 Hz) " + a.fine.toFixed(1) + " dB");
  }
} else if (want === "buzz") {
  for (const [id, st] of [["bee", { chirpMode: 2, chirpPitch: 200, chirpSpan: 0.15, chirpHarm: 0.5, chirpRand: 0.4 }], ["fly", { chirpMode: 2, chirpPitch: 160, chirpSpan: 0.25, chirpHarm: 0.8, chirpRand: 0.8 }], ["mosquito", { chirpMode: 2, chirpPitch: 600, chirpSpan: 0.1, chirpHarm: 0.7, chirpRand: 0.3 }]]) {
    const t = { dur: 1.5, parts: [P(st, { seed: 7 })] }, d = renderDry(t, SR), h = renderDry(t, SR * 4);
    const al = aliasCheck(Float64Array.from(d.L, (v, i) => 0.5 * (v + d.R[i])), Float64Array.from(h.L, (v, i) => 0.5 * (v + h.R[i])), SR, SR * 4);
    console.log(id + ": " + fmtMeasure(measure(d.L, d.R, SR)) + " | alias coarse " + al.coarse.toFixed(1) + " dB, fine " + al.fine.toFixed(1) + " dB");
  }
} else for (const n of want === "all" ? Object.keys(ROUNDS) : [want]) { if (!ROUNDS[n]) { console.error("no round " + n); process.exit(1); } run(n); }
