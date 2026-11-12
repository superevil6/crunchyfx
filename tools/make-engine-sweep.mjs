/* make-engine-sweep.mjs — the instrument presets, heard on the engines built for them. (2026-11-10)
 *
 *   node tools/make-engine-sweep.mjs            -> soundtests/engine-sweep/<family>/…
 *   node tools/make-engine-sweep.mjs --apply    -> writes every engine take into presets.js (done 2026-11-10)
 *
 * AJ, 2026-11-10: "do a sweep of presets that might be better suited with the new engines. For example, we have a
 * piano preset that would be better with piano." The six physical engines (brass 21, bowed 22, reed 23, bar 24,
 * piano 25, flute 26) came from CrunchyBGM, where each of these instruments was rebuilt and PICKED BY EAR in a band.
 * The SFX presets of the same names were copies of BGM's records from before that, so most of the "after" takes here
 * are not new designs: they are BGM's chosen patch (engine keys, envelope, vibrato), played at the SFX preset's own
 * pitch and length with its own width and room. The few with no BGM pick are designed here and marked so in KEY.md.
 *
 * LABELED, not blind: each preset is a yes/no between today's sound and the engine, and most "afters" were already
 * judged blind in BGM. SOUND-REVIEW.md's warning still applies — an engine that looks wrong for a name is not a defect
 * (Bubble Pop and Glass Shatter kept their old engines blind) — so "now" is always a take and can win.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) like make-ab.mjs, each take matched to -18 LUFS.
 * Writes, per family: <preset>-1-now.wav, <preset>-2-engine.wav, all-<family>.wav (every pair in order, now then engine,
 * with a gap), and KEY.md. soundtests/ is not tracked.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_LUFS = -18;
const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
  Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ctx.window = ctx; ctx.globalThis = ctx;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS;

// ---- CrunchyBGM's picked records (instruments.js, 2026-11-10), engine keys + envelope + vibrato only. BGM sets width 0
// for a band mix and adds its room on the bus, so the SFX preset's own width/reverb are kept instead (CARRY below).
const ENV = { hold: 0, decay: 0, sustain: 1, drive: 0, cutoff: 18000 };
const piano = (o) => Object.assign({ wave: 25, pianoHammer: 0.5, pianoStretch: 0.5, pianoRing: 0.5, pianoStrings: 0.4, attack: 0, release: 0.4 }, ENV, o);
const bar = (o) => Object.assign({ wave: 24, barType: 0, barMallet: 0.5, barRing: 0.5, barMotor: 0, attack: 0, release: 2 }, ENV, o);
const brass = (o) => Object.assign({ wave: 21, brassBreath: 0.57, brassLips: 0.4, brassBell: 0.59, brassTube: 0.31, attack: 0.05, release: 0.2 }, ENV, o);
const bow = (o) => Object.assign({ wave: 22, bowSpeed: 0.5, bowPressure: 0.75, bowPos: 0.39, bowTone: 0.82, bowString: 0.17, attack: 0.07, release: 0.3,
  vibDepth: 0.045, vibRate: 5.8, vibOnset: 0.35 }, ENV, o);
const sax = (o) => Object.assign({ wave: 23, reedBore: 1, reedBreath: 0.7, reedTongue: 1, reedBell: 0.82, reedWobble: 1, reedTone: 0.29, attack: 0.008, release: 0.12,
  vibDepth: 0.04, vibRate: 5, vibOnset: 0.3 }, ENV, o);
const clar = (o) => Object.assign({ wave: 23, reedBore: 0, reedBreath: 0.96, reedTongue: 0, reedBell: 0, reedWobble: 0, reedTone: 0.71, attack: 0.04, release: 0.12,
  vibDepth: 0.045, vibRate: 5, vibOnset: 0.3 }, ENV, o);
const lowReed = (o) => Object.assign({ wave: 23, reedBore: 1, reedBreath: 0.6, reedTongue: 0, reedBell: 0, reedWobble: 0, reedTone: 0.71, attack: 0.06, release: 0.12,
  vibDepth: 0.08, vibRate: 4.4, vibOnset: 0.3 }, ENV, o);
const flute = (o) => Object.assign({ wave: 26, fluteBreath: 1, fluteJet: 0.5, fluteAim: 0.4, fluteNoise: 0.05, fluteTone: 0.7, fluteVib: 0.33, fluteBuzz: 0,
  attack: 0.06, release: 0.18, vibDepth: 0.02, vibRate: 4.8, vibOnset: 0.3 }, ENV, o);

// [preset, engine take, source] — source "BGM <record>" means that record's ear-picked patch; "new" is designed here.
const FAMILIES = {
  piano: [
    ["Piano",       piano(),                                                            "BGM Piano"],
    ["Grand Piano", piano({ pianoHammer: 0.6, pianoStretch: 0.35, pianoRing: 0.75, release: 0.95 }), "BGM Grand Piano"],
    ["Jazz Piano",  piano({ pianoHammer: 0.45, pianoStretch: 0.65, pianoRing: 0.35, release: 0.22 }), "BGM Jazz Piano"],
    ["Honky-tonk",  piano({ pianoHammer: 0.65, pianoStrings: 0.9, pianoRing: 0.45, release: 0.3 }),
                    "new: BGM's Piano with the two strings of each note pulled far apart (Strings 0.9), the honky-tonk's out-of-tune shimmer, and a brighter hammer"],
    ["Toy Piano",   bar({ barType: 4, barMallet: 0.8, barRing: 0.35, release: 0.6 }),
                    "new: a toy piano strikes metal rods, not strings, so this is the bar engine's TINE, a hard mallet, a short ring"],
  ],
  mallets: [
    ["Marimba",        bar({ barType: 0 }),                                          "BGM Marimba"],
    ["Xylophone",      bar({ barType: 1, barMallet: 0.55, release: 1 }),             "BGM Xylophone"],
    ["Glockenspiel",   bar({ barType: 2, barMallet: 0.9, release: 2.5 }),            "BGM Glockenspiel"],
    ["Vibraphone",     bar({ barType: 3, barMotor: 0.3, release: 1.5 }),             "BGM Vibraphone (the motor's tremolo on)"],
    ["Celesta",        bar({ barType: 2, barMallet: 0.45, barRing: 0.45, release: 0.8 }), "BGM Celesta"],
    ["Music Box Note", bar({ barType: 4, barMallet: 1, barRing: 1, release: 3 }),   "BGM Music Box"],
    ["Kalimba",        bar({ barType: 4, barMallet: 0.55, release: 2 }),             "BGM Kalimba"],
  ],
  brass: [
    ["Brass",         brass(),                                                       "BGM Trumpet (the generic brass preset sits at C4, trumpet territory)"],
    ["Trombone",      brass(),                                                       "BGM Trombone"],
    ["Tuba",          brass({ brassBell: 0.32, release: 0.25 }),                     "BGM Tuba"],
    ["French Horn",   brass({ brassBell: 0.38, brassTube: 0.55, attack: 0.07, release: 0.3 }),
                      "new: a horn's bell faces away and is played with a hand in it, so a low Bell and a lossy Tube (darker, rounder) and a softer start"],
    ["Brass Section", brass({ attack: 0.05, release: 0.3, chorusMix: 0.45, chorusRate: 0.4, chorusDepth: 0.5 }),
                      "new: BGM's Trombone/Trumpet patch thickened into several players with the chorus, as the Strings preset does"],
  ],
  strings: [
    ["Strings",         bow({ attack: 0.14, vibDepth: 0.04, vibRate: 5.5 }),        "BGM Strings"],
    ["Solo Violin",     bow(),                                                       "BGM Violin"],
    ["Cello",           bow({ bowTone: 0.28, bowString: 0.42, attack: 0.1, vibDepth: 0.055, vibRate: 4.6 }), "BGM Cello"],
    ["Fiddle",          bow({ bowPressure: 0.95, bowPos: 0.2, bowTone: 1, bowString: 0.083, attack: 0.006, release: 0.12, vibDepth: 0.018, vibRate: 7.2, vibOnset: 0.2 }), "BGM Fiddle"],
    ["Tremolo Strings", bow({ bowTrem: 10, attack: 0.05, vibDepth: 0.04, vibRate: 5.5 }), "BGM Tremolo Strings (the bow reverses 10 times a second)"],
    ["Erhu",            bow({ bowPressure: 0.85, bowPos: 0.3, bowTone: 0.75, bowString: 0.12, attack: 0.06, release: 0.25, vibDepth: 0.2, vibRate: 5.2, vibOnset: 0.25 }), "BGM Erhu"],
    ["Bowed Bass",      bow({ bowTone: 0.18, bowString: 0.42, attack: 0.14, vibDepth: 0.05, vibRate: 5 }), "BGM Bowed Bass"],
  ],
  reeds: [
    ["Saxophone",    sax(),                                                          "BGM Saxophone"],
    ["Sax Sigh",     sax({ attack: 0.05, release: 0.3, vibDepth: 0.05, vibOnset: 0.5 }),
                     "new: BGM's Saxophone playing the preset's own two-note falling sigh (its sweep, repeat and step are kept)"],
    ["Clarinet",     clar(),                                                         "BGM Clarinet"],
    ["Low Reed",     lowReed(),                                                      "BGM Low Reed"],
    ["Reed Section", sax({ attack: 0.06, release: 0.28, chorusMix: 0.45, chorusRate: 0.4, chorusDepth: 0.5 }),
                     "new: BGM's Saxophone as several players with the chorus (a reed section is saxes)"],
    ["Bass Reed",    lowReed({ attack: 0.05, release: 0.3, vibDepth: 0 }),
                     "new: BGM's Low Reed at the preset's bass pitch, held straight (no vibrato, as the old one had none)"],
  ],
  flutes: [
    ["Flute",      flute(),                                                          "BGM Flute"],
    ["Dizi",       flute({ fluteTone: 0.8, fluteVib: 0, fluteBuzz: 0.03, attack: 0.05, release: 0.2, vibDepth: 0.1, vibRate: 5.6 }), "BGM Dizi (its membrane buzz on)"],
    ["Shakuhachi", flute({ fluteJet: 0.55, fluteNoise: 0.45, fluteTone: 0.5, fluteVib: 0.6, attack: 0.09, release: 0.3, vibDepth: 0.12, vibRate: 3.6 }), "BGM Shakuhachi"],
    ["Whistle",    flute({ fluteTone: 0.3, fluteVib: 0, attack: 0.02, vibDepth: 0.07, vibRate: 5 }), "BGM Whistle"],
    ["Ocarina",    flute({ fluteTone: 0.25, fluteNoise: 0.04, fluteVib: 0.2, attack: 0.035, release: 0.2, vibDepth: 0.03 }),
                   "new: an ocarina is a closed vessel, nearly a pure tone, so the flute's top rolled right off (Tone 0.25) with a little breath"],
  ],
};

// What the SFX preset keeps of itself: its pitch, length and gesture (repeat/arp/sweep), and its width and room.
const CARRY = ["freq", "duration", "sweep", "repeat", "rate", "arpStep", "width", "reverb", "reverbSize", "reverbTone",
  "delay", "delayTime", "delayFeedback", "chorusMix", "chorusRate", "chorusDepth"];
function engineTake(name, eng) {
  const old = PRESETS[name], out = Object.assign({}, eng);
  for (const k of CARRY) if (old[k] != null && !(k.startsWith("chorus") && eng[k] != null)) out[k] = old[k];
  return out;
}
const nowTake = (name) => { const o = Object.assign({}, PRESETS[name]); delete o._vary; return o; };

function lufs(L, R) {   // ITU BS.1770 (as make-ab.mjs): K-weighting, 400 ms blocks, gated; shorter than a block = whole
  const bq = (x, b0, b1, b2, a1, a2) => { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
  const kw = (x) => bq(bq(x, 1.53090959966, -2.65116903469, 1.16916686757, -1.66375011066, 0.712603855441), 1, -2, 1, -1.98916967363, 0.989199035379);
  const a = kw(L), b = kw(R), blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), ms = [];
  if (a.length < blk) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i] + b[i] * b[i]; ms.push(s / a.length); }
  else for (let i = 0; i + blk <= a.length; i += hop) { let s = 0; for (let j = i; j < i + blk; j++) s += a[j] * a[j] + b[j] * b[j]; ms.push(s / blk); }
  const l = (m) => -0.691 + 10 * Math.log10(m + 1e-12);
  let g = ms.filter((m) => l(m) > -70); if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10; g = g.filter((m) => l(m) > rel);
  return l(g.reduce((t, m) => t + m, 0) / g.length);
}
function render(patch) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, patch), { normalize: true });
  const L = Float32Array.from(r.L), R = Float32Array.from(r.R);
  let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
  if (pk > 0.95) gn *= 0.95 / pk;
  for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  return { L, R, sec: L.length / SR };
}
const wav = (L, R, title) => Buffer.from(CS.encodeWav(L, R, { rate: SR, depth: 16, channels: 2, title }));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- --apply (AJ, 2026-11-10: "Every engine sound is a dramatic improvement… swap them all"): write each engine take
// into presets.js in place of the preset, same name, same section. Each gets its own _vary, because DEFAULT_VARY
// jitters drive and decay, which sit at 0 on these engines and would be pushed UP (bipolar jitter from a zero base):
// random saturation on a physical model. The engine's own wobble is the one its Blown/Bowed/Struck preset declares.
const ENGINE_VARY = { 21: { brassBreath: 0.2, brassBell: 0.1 }, 22: { bowPressure: 0.1, bowTone: 0.05 }, 23: { reedBreath: 0.05, reedBell: 0.05 },
  24: { barMallet: 0.1 }, 25: { pianoHammer: 0.1 }, 26: { fluteBreath: 0.1, fluteJet: 0.05 } };
const VARY_KEEP = ["freq", "rate", "arpStep", "sweep", "vibRate", "reverb"];   // an old _vary entry that still means the same thing
function applied(name, eng) {
  const t = engineTake(name, eng), old = PRESETS[name]._vary || {}, v = { freq: old.freq != null ? old.freq : 0.15 };
  for (const k of VARY_KEEP) if (k !== "freq" && old[k] != null && t[k] != null) v[k] = old[k];
  Object.assign(v, ENGINE_VARY[t.wave]);
  if (t.wave === 23 && t.reedBell === 0) delete v.reedBell;
  return Object.assign(t, { _vary: v });
}
const lit = (o) => "{ " + Object.entries(o).map(([k, v]) => k + ":" + (v && typeof v === "object" ? lit(v) : JSON.stringify(v))).join(", ") + " }";
if (process.argv.includes("--apply")) {
  const file = join(ROOT, "presets.js"); let src = readFileSync(file, "utf8"), n = 0;
  for (const fam in FAMILIES) for (const [name, eng] of FAMILIES[fam]) {
    const head = "\n  " + JSON.stringify(name) + ": {", at = src.indexOf(head);
    if (at < 0 || src.indexOf(head, at + 1) >= 0) throw new Error("not exactly one entry for " + name);
    let i = at + head.length - 1, depth = 0;
    for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
    const body = src.slice(at + head.length - 1, i + 1);
    if (/\/\/|\/\*/.test(body)) throw new Error("a comment inside " + name + "'s entry: edit it by hand");
    src = src.slice(0, at + head.length - 1) + lit(applied(name, eng)) + src.slice(i + 1); n++;
  }
  writeFileSync(file, src);
  console.log("  applied " + n + " presets to presets.js");
  process.exit(0);
}

const BASE = join(ROOT, "soundtests", "engine-sweep"), W = ["sine", "square", "saw", "triangle", "pulse", "FM", "organ", "half-sine", "pluck",
  "sample", "modal", "granular", "custom", "formant", "bubble", "particle", "additive", "speech", "FM 4op", "impact", "whoosh", "brass", "bowed", "reed", "bar", "piano", "flute"];
const top = [];
for (const fam in FAMILIES) {
  const dir = join(BASE, fam); mkdirSync(dir, { recursive: true });
  const gap = Math.round(0.6 * SR), pairGap = Math.round(1.4 * SR), parts = [], key = [];
  let t = 0; const mmss = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  for (const [name, eng, src] of FAMILIES[fam]) {
    if (!PRESETS[name]) throw new Error("no preset " + name);
    const now = render(nowTake(name)), aft = render(engineTake(name, eng));
    writeFileSync(join(dir, slug(name) + "-1-now.wav"), wav(now.L, now.R, name + " now"));
    writeFileSync(join(dir, slug(name) + "-2-engine.wav"), wav(aft.L, aft.R, name + " engine"));
    const at = t;
    parts.push(now, { gap }, aft, { gap: pairGap }); t += now.sec + gap / SR + aft.sec + pairGap / SR;
    key.push("- **" + name + "** (" + W[Math.round(PRESETS[name].wave || 0)] + " → " + W[eng.wave] + ") — at " + mmss(at) + " in all-" + fam + ".wav\n  " +
      (src.startsWith("new") ? "**" + src + "**" : "after: " + src + "'s patch, at the preset's own pitch, length, width and room"));
    console.log("  " + fam.padEnd(8) + name.padEnd(16) + now.sec.toFixed(2) + " s -> " + aft.sec.toFixed(2) + " s");
  }
  const n = parts.reduce((s, p) => s + (p.gap || p.L.length), 0), L = new Float32Array(n), R = new Float32Array(n);
  let o = 0; for (const p of parts) { if (p.gap) { o += p.gap; continue; } L.set(p.L, o); R.set(p.R, o); o += p.L.length; }
  writeFileSync(join(dir, "all-" + fam + ".wav"), wav(L, R, "all " + fam));
  writeFileSync(join(dir, "KEY.md"), "# " + fam + ": each preset now, then on its engine\n\n`all-" + fam +
    ".wav` plays every pair in order (now, a short gap, the engine, a longer gap). The single files are the same takes.\n\n" + key.join("\n") + "\n");
  top.push("- **" + fam + "/** — " + FAMILIES[fam].map((x) => x[0] + (x[2].startsWith("new") ? "*" : "")).join(", "));
}
writeFileSync(join(BASE, "README.md"), "# Engine sweep (CrunchySFX, 2026-11-10)\n\nEach instrument preset NOW, then on the engine built for it, " +
  "matched to " + TARGET_LUFS + " LUFS. Start with `<family>/all-<family>.wav`; `KEY.md` in each folder has the times.\n\n" +
  "Most \"afters\" are CrunchyBGM's ear-picked patch for the same instrument. A `*` marks one designed here (no BGM pick to copy).\n\n" + top.join("\n") +
  "\n\nFor each: keep **now**, take the **engine**, or say what is off about the engine take.\n");
console.log("  -> " + BASE);
