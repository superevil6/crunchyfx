/* spring.mjs — PROTOTYPE of a "spring" engine for CrunchySFX (boing / doorstop / spring tank / jaw-harp twang), and the
 * blind round that auditions it.
 *
 *   node tools/proto/spring.mjs              lists the rounds
 *   node tools/proto/spring.mjs all          renders every round into soundtests/proto-spring/<sound>/
 *   node tools/proto/spring.mjs <round>      one round
 *   node tools/proto/spring.mjs stability    the worst corners of the knob space, 4 s each: loop gain, growth, NaN
 *   node tools/proto/spring.mjs dispersion   the measured chirp of each echo against the design, across the knob
 *
 * The model lives in tools/proto/spring/model.mjs (re-exported here) so it can be ported into dsp.js as one block:
 * makeSpring(sr, cfg, f0, seed) -> { tick() -> [L, R] } like makeBrass/makeBowed; springCfg(st) maps the proposed PARAMS
 * rows (SPRING_PARAMS) to it; renderSpring(sr, n, cfg, f0, seed) is the offline shape.
 *
 * ROOM, CONSISTENTLY (the same rule as the chirp and friction prototypes): every model take is run THROUGH THE REAL SFX
 * CHAIN as an imported sample (wave 9, freq 440 = native speed, `opts.sample`), with the CONTROL preset's own reverb and
 * delay settings copied in, a 40 Hz high-pass as the filter and drive 0. L and R go through separately (the sample path
 * is mono), so the stereo is kept. A take differs from its control in the SOURCE only, never the room.
 *
 * Takes are matched to -18 LUFS (BS.1770, copied from tools/make-ab.mjs) and capped at 0.95 peak. Order shuffled with a
 * fixed seed per round, the swap index drawn from the LCG's HIGH 16 bits (make-ab's `seed % (i + 1)` reads the low bits,
 * whose short period put the control first too often). The CONTROL is the current preset rendered by the exported
 * engine (synth-export/crunchysfx-synth.js) in a node vm, exactly as make-ab.mjs does.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { makeSpring, renderSpring, springCfg, springDesign, loopGainMax, chainGroupDelay, SPRING_PARAMS, SPRING_DEFAULTS, SPRING_TYPES } from "./spring/model.mjs";
import { measure, fmtMeasure, aliasCheck, echoChirps, fmtEchoes, partials, modRate, formantTrack, growth, mono, clicks } from "./spring/measure.mjs";
export { makeSpring, renderSpring, springCfg, springDesign, loopGainMax, SPRING_PARAMS, SPRING_DEFAULTS, SPRING_TYPES };

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

// ---- the takes. A take is { id, why, dur, parts: [{ at (s), gain, seed, freq, st (knobs) }] } — one part is the engine as
// one patch would play it; more than one part is the app's LAYERS (each a spring patch), and says so.
const P = (freq, st, o) => Object.assign({ at: 0, gain: 1, seed: 1, freq }, o || {}, { st });
const coil = (o) => Object.assign({ springType: 0 }, o);
const door = (o) => Object.assign({ springType: 1 }, o);
const twang = (o) => Object.assign({ springType: 2 }, o);

const ROUNDS = {
  "cartoon-boing": {
    title: "Cartoon Boing", control: "Cartoon Boing",
    listen: "The cartoon BOING: something bounces off a spring, a character's head goes boing. Which one is a real, funny BOING? Listen for whether it sounds like a physical spring (metal, a wobble, a ring that dies away) or like a tone sliding about.",
    takes: [
      { id: "doorstop", why: "ONE ENGINE PATCH (type Doorstop). A doorstop spring flicked: a 180 Hz pitched coil whose upper partials are stretched apart by the dispersion (the metallic 'doinng'), the tip swinging 9 times a second (a wobble in level and pitch, the two channels a quarter swing apart).", dur: 1.0,
        parts: [P(180, door({ springDisp: 0.7, springDamp: 0.4, springSway: 0.7, springSwayRate: 9, springPluck: 0.35 }), { seed: 11 })] },
      { id: "jaw-harp", why: "ONE ENGINE PATCH (type Twang). A jaw harp's 'bwoing': a 110 Hz plucked steel reed (a buzzy drone), the mouth's resonance gliding up 1.6 octaves after the pluck and then wobbling a little.", dur: 1.0,
        parts: [P(110, twang({ springMouth: 0.8, springVowel: 0.15, springSway: 0.4, springSwayRate: 6, springDamp: 0.45, springPluck: 0.7 }), { seed: 12 })] },
      { id: "long-coil", why: "ONE ENGINE PATCH (type Coil). A long loose toy coil: one flick sends a FALLING chirp down the coil (high frequencies arrive first), and it comes back every 110 ms, smeared further each time.", dur: 1.0,
        parts: [P(330, coil({ springLength: 110, springDisp: 0.9, springDamp: 0.55, springPluck: 0.5, springSway: 0.3, springSwayRate: 5 }), { seed: 13 })] },
    ],
  },
  "springy-boing": {
    title: "Springy Boing", control: "Springy Boing",
    listen: "A short springy 'boing' that falls and wobbles: a spring-loaded trap, a jack-in-the-box, a bounce pad. Which one sounds most like a SPRING? Listen for the 'pew' or 'doing' character and whether it wobbles like something physical.",
    takes: [
      { id: "tank-drip", why: "ONE ENGINE PATCH (type Coil). A spring-reverb tank's 'drip': a 45 ms coil, maximum dispersion, so each echo is a 40 ms falling chirp ('pew'), repeating and smearing.", dur: 0.6,
        parts: [P(520, coil({ springLength: 45, springDisp: 1, springDamp: 0.6, springPluck: 0.7 }), { seed: 21 })] },
      { id: "fast-wobble", why: "ONE ENGINE PATCH (type Doorstop). A small stiff spring at 330 Hz with a fast 18 Hz swing (near the current preset's 20 Hz wobble, but as a swinging coil: level and pitch together, decaying with the ring).", dur: 0.6,
        parts: [P(330, door({ springDisp: 0.6, springDamp: 0.55, springSway: 1, springSwayRate: 18, springPluck: 0.3 }), { seed: 22 })] },
      { id: "falling-twang", why: "ONE ENGINE PATCH (type Twang). A jaw harp 'boyng' going DOWN: the mouth's resonance starts high ('ee') and glides down 1.6 octaves while wobbling at 14 Hz.", dur: 0.6,
        parts: [P(147, twang({ springMouth: -0.8, springVowel: 0.85, springSway: 0.5, springSwayRate: 14, springDamp: 0.6, springPluck: 0.8 }), { seed: 23 })] },
    ],
  },
  "bouncy-blip": {
    title: "Bouncy Blip", control: "Bouncy Blip",
    listen: "A short arcade bounce: a character lands on a spring or a bumper. Which one is the best BOUNCE for a game? It should be short and snappy. Listen for whether it reads as springy, and whether it stays out of the way.",
    takes: [
      { id: "rising-zip", why: "ONE ENGINE PATCH (type Coil, negative dispersion). A RISING chirp: the lows arrive first and the highs last, a 63 ms 'zip' up to 4.2 kHz, heavily damped so there is one clear echo.", dur: 0.3,
        parts: [P(700, coil({ springLength: 70, springDisp: -1, springDamp: 0.85, springPluck: 0.9 }), { seed: 31 })] },
      { id: "boink", why: "ONE ENGINE PATCH (type Doorstop). A tiny stiff spring 'boink' at 523 Hz, damped short, a fast 16 Hz swing.", dur: 0.3,
        parts: [P(523, door({ springDisp: 0.5, springDamp: 0.8, springSway: 0.4, springSwayRate: 16, springPluck: 0.25 }), { seed: 32 })] },
      { id: "twang-up", why: "ONE ENGINE PATCH (type Twang). A short jaw-harp 'bwip': a 262 Hz reed with the mouth sweeping up two octaves in 0.14 s, damped short.", dur: 0.3,
        parts: [P(262, twang({ springMouth: 1, springVowel: 0, springDamp: 0.85, springPluck: 0.6 }), { seed: 33 })] },
    ],
  },
  "doorstop-spring": {
    title: "Doorstop Spring (a gap)", control: "Boing Spring", controlWhy: "no preset is a doorstop; Boing Spring (a sine sweep with vibrato) is the nearest (the CONTROL).",
    listen: "A doorstop spring (the coiled one on the baseboard behind a door) flicked with a finger: 'doinnnng'. Which one is a real DOORSTOP? Listen for the metallic ring, the wobble as the tip swings round, and how it dies away.",
    takes: [
      { id: "doorstop", why: "ONE ENGINE PATCH (type Doorstop). The ordinary one: a 220 Hz coil, partials stretched by the dispersion, a finger scrape at the flick, the tip swinging 7 times a second; rings about 1.5 s.", dur: 1.6,
        parts: [P(220, door({ springDisp: 0.75, springDamp: 0.25, springSway: 0.6, springSwayRate: 7, springPluck: 0.35 }), { seed: 41 })] },
      { id: "big-floor-spring", why: "ONE ENGINE PATCH (type Doorstop). A big heavy floor spring flicked harder: 110 Hz, the most dispersion (the most out-of-tune, metallic partials), a slower 4.5 Hz swing, a brighter flick and a longer ring (about 2 s).", dur: 2.0,
        parts: [P(110, door({ springDisp: 0.95, springDamp: 0.15, springSway: 0.8, springSwayRate: 4.5, springPluck: 0.4 }), { seed: 42 })] },
      { id: "doorstop-and-zing", why: "TWO LAYERS (two spring patches, as the app's Layers would hold them). The doorstop's ring (260 Hz) plus the waves running along the coil itself: a short dispersive coil (22 ms round trip) that adds a fast falling 'zing' under the 'doing'.", dur: 1.6,
        parts: [
          P(260, door({ springDisp: 0.6, springDamp: 0.3, springSway: 0.5, springSwayRate: 8, springPluck: 0.35 }), { seed: 43 }),
          P(900, coil({ springLength: 22, springDisp: 1, springDamp: 0.4, springPluck: 0.8 }), { seed: 44, gain: 0.5 }),
        ] },
    ],
  },
  "jaw-harp": {
    title: "Jaw Harp (a gap)", control: "Didgeridoo", controlWhy: "no preset is a jaw harp; Didgeridoo (a buzzy drone with a slowly moving formant, the same idea of a drone filtered by a mouth) is the nearest (the CONTROL).",
    listen: "A jaw harp (the little steel reed held against the teeth and plucked): 'bwoing', 'oy-oy-oy'. For a western town, a hillbilly gag, a goofy character. Which one sounds like a JAW HARP? Listen for the steel twang, the buzzing drone under it, and the 'wah' of the mouth moving.",
    takes: [
      { id: "bwoing", why: "ONE ENGINE PATCH (type Twang). One pluck at 98 Hz, the mouth gliding from 'oo' up 1.8 octaves: the classic single 'bwoooing'.", dur: 1.6,
        parts: [P(98, twang({ springMouth: 0.9, springVowel: 0.1, springDamp: 0.3, springPluck: 0.7 }), { seed: 51 })] },
      { id: "oy-oy", why: "ONE ENGINE PATCH (type Twang). One pluck at 110 Hz, the mouth wobbling 5.5 times a second over a small rise: 'oy-oy-oy-oy'.", dur: 1.8,
        parts: [P(110, twang({ springMouth: 0.25, springVowel: 0.45, springSway: 0.9, springSwayRate: 5.5, springDamp: 0.25, springPluck: 0.6 }), { seed: 52 })] },
      { id: "played-riff", why: "THREE LAYERS (three twang patches). A jaw harp PLAYED: three plucks on the same reed (98 Hz) a third of a second apart, each with a different mouth shape (up, down, up), as a player strums it.", dur: 1.6,
        parts: [
          P(98, twang({ springMouth: 0.5, springVowel: 0.2, springDamp: 0.45, springPluck: 0.7 }), { seed: 53 }),
          P(98, twang({ springMouth: -0.35, springVowel: 0.6, springDamp: 0.45, springPluck: 0.6 }), { seed: 54, at: 0.32 }),
          P(98, twang({ springMouth: 0.7, springVowel: 0.3, springDamp: 0.4, springPluck: 0.8 }), { seed: 55, at: 0.64 }),
        ] },
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
function renderDry(take, sr) {   // the model's own output: every part summed at its offset, then peak 0.5
  const n = Math.round(take.dur * sr), L = new Float32Array(n), R = new Float32Array(n), designs = [];
  for (const p of take.parts) {
    const o = Math.round(p.at * sr), pn = n - o;
    const r = renderSpring(sr, pn, springCfg(p.st), p.freq, p.seed);
    for (let i = 0; i < pn; i++) { L[o + i] += r.L[i] * p.gain; R[o + i] += r.R[i] * p.gain; }
    designs.push(r.design);
  }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk > 0) for (let i = 0; i < n; i++) { L[i] *= 0.5 / pk; R[i] *= 0.5 / pk; }
  return { L, R, designs };
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

// ---- the spring-specific readings of ONE part rendered alone (dry): what the dispersion / sway / mouth actually did
function partReading(p, dur) {
  const cfg = springCfg(p.st), n = Math.round((dur - p.at) * SR), r = renderSpring(SR, n, cfg, p.freq, p.seed), m = mono(r.L, r.R), d = r.design, lines = [];
  const gr = growth(r.L, r.R, SR);
  if (cfg.type === 0) {
    const bands = [0, 1, 2, 3].map((i) => d.flo * 2 * Math.pow(0.7 * d.fhi / (2 * d.flo), i / 3));
    const pred = bands.map((f) => (1000 * chainGroupDelay(SR, cfg, p.freq, f) / SR).toFixed(0)).join("/");
    lines.push("coil: band " + d.flo.toFixed(0) + "-" + d.fhi.toFixed(0) + " Hz, round trip " + (1000 * d.passS).toFixed(0) + " ms, designed glide " + (1000 * d.S / SR).toFixed(0) +
      " ms per pass " + (d.rising ? "RISING" : "FALLING") + " (" + d.sec.length + " allpass sections); designed chain delay at " + bands.map((f) => f.toFixed(0)).join("/") + " Hz = " + pred + " ms");
    lines.push(...fmtEchoes(echoChirps(m, SR, bands, 0.6 * d.passS, 3)).split("\n").map((s) => "  measured " + s));
    if (d.S > 0.5 * d.passS * SR) lines.push("  (the glide is " + Math.round(100 * d.S / (d.passS * SR)) + "% of the round trip, so echoes overlap and the meter's echo 2 and 3 pair up the wrong arrivals: echo 1 is the reading)");
  } else if (cfg.type === 1) {
    const pa = partials(m, SR, p.freq), mr = modRate(Float64Array.from(r.L), SR, 0.03, Math.min(dur - p.at, 1.2));   // one channel: the two swing a quarter cycle apart
    lines.push("doorstop: f0 " + p.freq + " Hz, designed glide " + (1000 * d.S / SR).toFixed(1) + " ms " + (d.rising ? "RISING" : "FALLING") + " (" + d.sec.length + " sections)");
    lines.push("  measured partials (ratio to the lowest; harmonic = 1, 2, 3 ...): " + pa.map((q) => q.f.toFixed(0) + " (" + q.ratio.toFixed(2) + ")").join(", "));
    if (mr) lines.push("  measured level wobble: " + mr.hz.toFixed(1) + " Hz, " + mr.depthDb.toFixed(1) + " dB deep (sway rate asked " + cfg.swayRate + " Hz, depth " + cfg.sway + ")");
  } else {
    const tr = formantTrack(m, SR, Math.max(300, 2.5 * p.freq)), at = (t) => { const q = tr.reduce((b, x) => Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b, tr[0]); return q ? q.f.toFixed(0) : "-"; };
    const fs = tr.map((q) => q.f);
    lines.push("twang: f0 " + p.freq + " Hz; measured mouth peak (strongest component above " + Math.max(300, 2.5 * p.freq).toFixed(0) + " Hz) at 0.03/0.1/0.2/0.35/0.6 s: " +
      [0.03, 0.1, 0.2, 0.35, 0.6].map(at).join("/") + " Hz, range " + Math.min(...fs).toFixed(0) + "-" + Math.max(...fs).toFixed(0) + " Hz");
  }
  lines.push("  growth: loudest 50 ms block at " + gr.peakBlockS.toFixed(2) + " s; largest later block / loudest earlier " + gr.worstRise.toFixed(2) + " (<= 1: only decays; the sway's swing can lift it a little)");
  return lines;
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
  for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = join(ROOT, "soundtests", "proto-spring", name), key = [];
  mkdirSync(out, { recursive: true });
  console.log(name + "  (room from `" + round.control + "`: " + JSON.stringify(room) + ")");
  order.forEach((ti, slot) => {
    const t = takes[ti], file = "take-" + "ABCDEFGH"[slot] + ".wav";
    let wav, dryQ = null, alias = null, reading = [];
    if (t.control) wav = controlTake(round.control);
    else {
      const dry = renderDry(t, SR);
      dryQ = measure(dry.L, dry.R, SR);
      const hi = renderDry(t, SR * 4);
      alias = aliasCheck(mono(dry.L, dry.R), mono(hi.L, hi.R), SR, SR * 4);
      // the loop is linear but for the soft limit: if the reading does not move with the limit off, it is not aliasing
      // but the loop's rate-sensitivity (a 200-pass loop compounds a 0.1% per-pass difference between the two rates)
      if (t.parts.some((p) => springCfg(p.st).type < 2)) {
        const off = (tk) => Object.assign({}, tk, { parts: tk.parts.map((p) => Object.assign({}, p, { st: Object.assign({ _noSat: 1 }, p.st) })) });
        const a = renderDry(off(t), SR), b = renderDry(off(t), SR * 4);
        alias.noSat = aliasCheck(mono(a.L, a.R), mono(b.L, b.R), SR, SR * 4).coarse;
      }
      for (const p of t.parts) reading.push(...(t.parts.length > 1 ? ["layer @" + p.at + " s:"] : []), ...partReading(p, t.dur));
      wav = throughChain(dry, room);
    }
    const lu = matchLoudness(wav.L, wav.R), q = measure(wav.L, wav.R, SR), ck = clicks(wav.L, wav.R, SR);
    key.push({ file, t, q, dryQ, alias, lu, reading, ck, wav });
    console.log("  " + file + " " + t.id.padEnd(18) + " " + lu.toFixed(1) + " LUFS | WAV: " + fmtMeasure(q));
    console.log("      clicks: first sample " + ck.firstDb.toFixed(0) + " dB, last " + ck.lastDb.toFixed(0) + " dB re peak; largest step in the first ms / the 30 ms after " + ck.startRatio.toFixed(2) + ", last ms / the 30 ms before " + ck.endRatio.toFixed(2) + " (well above 1 = a click)");
    if (dryQ) {
      console.log("      dry: " + fmtMeasure(dryQ));
      console.log("      alias (44.1k vs 176.4k, <16 kHz; clean ~ -58, aliasing ~ -12): coarse " + alias.coarse.toFixed(1) + " dB, fine " + alias.fine.toFixed(1) + " dB" +
        (alias.noSat != null ? "; with the soft limit OFF " + alias.noSat.toFixed(1) + " dB (within a few dB of the reading with it on: the only nonlinearity adds no aliasing; the residual is the loop compounding small per-pass differences between the two rates)" : "") + "; >16 kHz " + dryQ.hiDb.toFixed(0) + " dB");
      for (const l of reading) console.log("      " + l);
    }
  });
  // every file padded with silence to the round's longest, so a file's size or length does not give the control away
  const longest = Math.max(...key.map((k) => k.wav.L.length));
  for (const k of key) {
    const pad = (x) => { const b = new Float32Array(longest); b.set(x); return b; };
    writeFileSync(join(out, k.file), Buffer.from(CS.encodeWav(pad(k.wav.L), pad(k.wav.R), { rate: SR, depth: 16, channels: 2, title: "spring " + name })));
  }
  const n = takes.length, last = "ABCDEFGH"[n - 1];
  writeFileSync(join(out, "LISTEN.md"), "# " + round.title + "\n\n" + n + " takes, `take-A.wav` to `take-" + last + ".wav`, each matched to " + TARGET_LUFS +
    " LUFS, in a shuffled order. One is the current preset; the others are a prototype \"spring\" engine (boing, doorstop, spring tank, jaw harp).\n\n" + round.listen +
    "\n\nSay the letter (and a runner-up if two are close). `KEY.md` says what each one is: **read it after listening.**\n");
  const f = (v, d = 0) => (v == null || Number.isNaN(v) ? "-" : v.toFixed(d));
  writeFileSync(join(out, "KEY.md"), "# " + round.title + ": the key\n\nModel takes are run through the real SFX chain as an imported sample with the control's room (" +
    (Object.keys(room).length ? "`" + JSON.stringify(room) + "`" : "no reverb, as the control has none") + "), so they differ in the source only.\n\n" +
    key.map((k) => "## " + k.file + ": `" + k.t.id + "`" + (k.t.control ? " (CONTROL)" : "") + "\n" + k.t.why + "\n\n" +
      "Measured (the WAV): " + f(k.q.sec, 2) + " s, " + f(k.lu, 1) + " LUFS, peak " + f(k.q.peak, 3) + ", NaN " + k.q.nan + "; first / last sample " + f(k.ck.firstDb) + " / " + f(k.ck.lastDb) + " dB re peak, step ratio start " + f(k.ck.startRatio, 2) + " end " + f(k.ck.endRatio, 2) + " (above 1 = a click)" +
      (k.dryQ ? "; dry model: alias check (44.1 vs 176.4 kHz) " + f(k.alias.coarse, 1) + " dB" + (k.alias.noSat != null ? " (" + f(k.alias.noSat, 1) + " dB with the soft limit, the only nonlinearity, switched off: about the same, so the residual is the loop's sensitivity to the rate, not aliasing)" : "") + ", energy above 16 kHz " + f(k.dryQ.hiDb) + " dB.\n\n" + k.reading.map((l) => "    " + l).join("\n") + "\n" : ".\n") +
      (k.t.parts ? "\n```json\n" + JSON.stringify(k.t.parts.map((p) => ({ at: p.at, gain: p.gain, seed: p.seed, patch: Object.assign({ wave: "spring", freq: p.freq }, p.st) }))) + "\n```\n" : "")).join("\n"));
  console.log("  -> " + out);
}

// ---- stability: the worst corners (least damping, most sway, hardest pluck, both dispersion directions and none, the
// extremes of pitch and length), 4 s each. Reports the analytic loop gain (and that every allpass reads |H| = 1) and
// what the audio did: NaN, growth after the loudest block, last 0.5 s against 0.5-1.0 s.
function stability() {
  let worst = { gain: 0, rise: 0, tail: 0, nan: 0 }, rows = 0;
  for (const type of [0, 1]) for (const disp of [-1, 0, 1]) for (const f0 of [55, 220, 1500]) for (const len of type ? [0] : [5, 400]) for (const damp of [0, 1]) {
    const st = { springType: type, springDisp: disp, springDamp: damp, springSway: 1, springSwayRate: 30, springPluck: 1, springLength: len || 60 };
    const cfg = springCfg(st), lg = loopGainMax(SR, cfg, f0), r = renderSpring(SR, 4 * SR, cfg, f0, 7), q = measure(r.L, r.R, SR), gr = growth(r.L, r.R, SR);
    rows++;
    worst.gain = Math.max(worst.gain, lg.max); worst.rise = Math.max(worst.rise, gr.worstRise); worst.tail = Math.max(worst.tail, gr.tailVsEarly); worst.nan += q.nan;
    if (lg.max >= 1 || q.nan || gr.tailVsEarly >= 1 || lg.apDev > 1e-9)
      console.log("  FLAG", JSON.stringify(st), "f0", f0, lg, gr, "nan", q.nan);
    else console.log("  ok  " + ["coil", "door"][type] + " disp " + disp + " f0 " + f0 + (type ? "" : " len " + len) + " damp " + damp + ": loop gain max " + lg.max.toFixed(4) +
      " (" + lg.sections + " sections, |AP|-1 <= " + lg.apDev.toExponential(0) + "), peak " + q.peak.toFixed(2) + ", later/earlier " + gr.worstRise.toFixed(2) + ", tail/early " + gr.tailVsEarly.toExponential(1));
  }
  const tw = renderSpring(SR, 4 * SR, springCfg({ springType: 2, springDamp: 0, springSway: 1, springSwayRate: 30, springPluck: 1, springMouth: 1, springVowel: 1 }), 55, 7), tq = measure(tw.L, tw.R, SR), tg = growth(tw.L, tw.R, SR);
  console.log("  twang (no loop) worst corner: NaN " + tq.nan + ", peak " + tq.peak.toFixed(2) + ", tail/early " + tg.tailVsEarly.toExponential(1));
  console.log(rows + " loop corners: max loop gain " + worst.gain.toFixed(4) + ", worst later/earlier block " + worst.rise.toFixed(2) + ", worst tail/early " + worst.tail.toExponential(1) + ", NaN " + worst.nan);
}

// ---- dispersion probe: the measured first three echoes against the design, across the dispersion knob
function dispersionProbe() {
  for (const disp of [1, 0.5, 0, -0.5, -1]) {
    const st = { springType: 0, springLength: 150, springDisp: disp, springDamp: 0.3, springPluck: 0.7 }, f0 = 500, cfg = springCfg(st);
    const r = renderSpring(SR, Math.round(0.8 * SR), cfg, f0, 3), d = r.design, m = mono(r.L, r.R);
    const bands = [0, 1, 2, 3].map((i) => d.flo * 2 * Math.pow(0.7 * d.fhi / (2 * d.flo), i / 3));
    console.log("coil disp " + disp + ": designed " + (1000 * d.S / SR).toFixed(0) + " ms " + (d.rising ? "rising" : "falling") + ", chain delay at " + bands.map((f) => f.toFixed(0)).join("/") + " Hz = " +
      bands.map((f) => (1000 * chainGroupDelay(SR, cfg, f0, f) / SR).toFixed(1)).join("/") + " ms");
    console.log(fmtEchoes(echoChirps(m, SR, bands, 0.6 * d.passS, 3)).split("\n").map((s) => "   " + s).join("\n"));
  }
}

export { lufs };
const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const want = main ? process.argv[2] : null;
if (!main) { /* imported: no CLI */ }
else if (!want) console.log("rounds: " + Object.keys(ROUNDS).join(", ") + ", all | stability | dispersion");
else if (want === "stability") stability();
else if (want === "dispersion") dispersionProbe();
else for (const n of want === "all" ? Object.keys(ROUNDS) : [want]) { if (!ROUNDS[n]) { console.error("no round " + n); process.exit(1); } run(n); }
