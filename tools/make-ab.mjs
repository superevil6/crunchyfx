/* make-ab.mjs — a BLIND listening round for one sound: a few deliberately different takes, loudness-matched, shuffled.
 *
 *   node tools/make-ab.mjs <round>        (no round: lists them)
 *   node tools/make-ab.mjs all
 *
 * The SFX care pass (2026-10-29, AJ: "some of the existing sounds or engines being used to make the sounds are just
 * the wrong lever"), run the way BGM's instrument review runs (~/Code/crunchyBGM/tools/make-ab-*.mjs): AJ listens to
 * take-A … take-D, says which sounds best, and THAT design is kept. The agent cannot hear; the ear decides.
 *
 * THE TAKES ARE DESIGN PROPOSALS, NOT A SWEEP. They differ in KIND (another engine, a layered build, another idea of
 * what the sound is), because "which value of this knob" cannot answer "is this the wrong lever". Where a preset exists,
 * the CURRENT one is a take, so it is heard against the others rather than remembered.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js, the bundle VFX and BGM use) in a node vm: no
 * browser, no app. Each take is matched to TARGET_LUFS (ITU BS.1770: K-weighting, 400 ms blocks, gated; a sound shorter
 * than a block is measured whole), then capped below full scale, so the choice is about the sound, not its volume.
 * The order is shuffled with a fixed seed per round. Writes soundtests/ab-<round>/: take-*.wav, LISTEN.md, KEY.md
 * (read KEY.md AFTER listening). soundtests/ is not tracked.
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
// presets.js is data: the current preset is a take
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS;
const preset = (n) => { const o = Object.assign({}, PRESETS[n]); delete o._vary; return o; };
const layers = (list) => JSON.stringify(list);

// ---- parts for designing takes (each a patch; `o` overrides), and a layer
const click = (o) => Object.assign({ wave: 19, impactTone: 0.9, impactDecay: 0.03, impactPunch: 1, impactGrit: 0.1, attack: 0.001, decay: 0.02, sustain: 0, release: 0.03, duration: 0.1 }, o);
const thump = (o) => Object.assign({ wave: 0, freq: 80, sweep: -0.4, boom: 0.8, boomFreq: 70, boomDrop: 0.7, boomDecay: 0.12, attack: 0, decay: 0.1, sustain: 0, release: 0.06, cutoff: 400, duration: 0.25 }, o);
const whoosh = (o) => Object.assign({ wave: 20, whooshTone: 0.6, whooshSweep: 0.6, whooshBody: 0.35, whooshPeak: 0.35, sustain: 1, attack: 0.001, release: 0.05, duration: 0.3, width: 0.5 }, o);
const chime = (o) => Object.assign({ wave: 10, freq: 1320, modalPartials: 6, modalInharm: 0.3, modalBright: 0.85, modalDecay: 0.4, sustain: 1, attack: 0.001, release: 0.3, reverb: 0.25, duration: 0.6 }, o);
const noiseHit = (o) => Object.assign({ wave: 0, freq: 1000, noise: 0.9, attack: 0, hold: 0.002, decay: 0.06, sustain: 0, release: 0.05, filterMode: 2, cutoff: 2500, reso: 0.3, duration: 0.15 }, o);
const blip = (o) => Object.assign({ wave: 4, pulseWidth: 0.25, freq: 880, attack: 0, hold: 0.005, decay: 0.05, sustain: 0, release: 0.03, cutoff: 9000, bitcrush: 6, duration: 0.1 }, o);
const ly = (s, d, g, p) => ({ s, d, g, p: p || 0 });
const stack = (base, list) => Object.assign({}, base, { layers: layers(list) });

// ---- THE SPELL ROUNDS (round 5): a control (today's wizard spell for the material) + three fused designs each
const CURRENT_SPELLS = JSON.parse(readFileSync(join(ROOT, "tools", "ab-current-spells.json"), "utf8"));
const flames = (o) => Object.assign({ wave: 15, particleRate: 90, particleTone: 0.5, particleDecay: 0.3, particleSpread: 0.6, sustain: 1, attack: 0.05, release: 0.3, cutoff: 7000, drive: 0.25, duration: 0.9 }, o);
const embers = (o) => Object.assign({ wave: 15, particleRate: 18, particleTone: 0.25, particleDecay: 0.5, particleSpread: 0.85, sustain: 1, attack: 0.05, release: 0.5, cutoff: 4000, duration: 1.2 }, o);
const buzz = (o) => Object.assign({ wave: 2, freq: 120, attack: 0.02, decay: 0.1, sustain: 1, release: 0.2, cutoff: 2600, reso: 0.55, drive: 0.65, bitcrush: 7, tremDepth: 0.5, tremRate: 120, duration: 0.8 }, o);
const crackleE = (o) => Object.assign({ wave: 1, freq: 620, noise: 0.5, attack: 0, hold: 0.001, decay: 0.05, sustain: 0.3, release: 0.08, cutoff: 6500, reso: 0.5, drive: 0.72, bitcrush: 4, downsample: 6, flicker: 0.6, flickerRate: 16, duration: 0.7, width: 0.45 }, o);
const bubbles = (o) => Object.assign({ wave: 14, freq: 350, bubbleRate: 18, bubbleRise: 0.5, bubbleSpread: 0.5, bubbleDecay: 0.35, sustain: 1, attack: 0.01, release: 0.2, duration: 0.7 }, o);
const swell = (o) => Object.assign({ wave: 0, freq: 300, noise: 0.95, attack: 0.25, decay: 0.2, sustain: 0.2, release: 0.25, cutoff: 900, reso: 0.4, filtEnv: 0.7, width: 0.7, duration: 0.8 }, o);
const rumble = (o) => Object.assign({ wave: 0, freq: 60, noise: 0.75, subOsc: 0.6, sweep: -0.2, attack: 0.15, decay: 0.4, sustain: 0.2, release: 0.3, cutoff: 700, drive: 0.35, duration: 0.9 }, o);
const SPELL_ROUNDS = {};
function spellRound(mat, title, listen, takes) {
  const cur = CURRENT_SPELLS[mat];
  SPELL_ROUNDS["spell-" + mat] = { title: title, listen: listen, takes: [{ id: "current", why: "the wizard's spell today (" + cur.name + ": " + cur.parts + "), the CONTROL.", patch: cur.patch }].concat(takes) };
}
spellRound("fire", "Fire spell", "Casting a fire spell (a fireball, a flame burst). Which one is FIRE, as one sound rather than a cast plus a fire noise?", [
  { id: "ignite-roar", why: "FUSED: an ignition whoosh, the flames roaring as its body, embers crackling as it fades.",
    patch: stack(whoosh({ whooshTone: 0.6, whooshSweep: 0.8, whooshBody: 0.55, whooshPeak: 0.28, noise: 0.3, drive: 0.3, cutoff: 6500, reverb: 0.2, duration: 0.6 }), [ly(flames({ duration: 0.9 }), 0.05, 0.75), ly(embers({ duration: 1.2 }), 0.3, 0.5)]) },
  { id: "fireball", why: "FUSED: a filtered roar sweeping up (the fireball growing), a thump as it launches, crackle trailing.",
    patch: stack({ wave: 2, freq: 180, noise: 0.88, sweep: 0.4, attack: 0.03, decay: 0.3, sustain: 0.35, release: 0.4, cutoff: 1200, reso: 0.4, filtEnv: 0.6, drive: 0.4, width: 0.6, reverb: 0.3, duration: 0.8 }, [ly(thump({ freq: 70, boomFreq: 60, boomDecay: 0.2, duration: 0.35 }), 0.32, 0.6), ly(flames({ particleRate: 60, duration: 0.6 }), 0.35, 0.5)]) },
  { id: "flame-burst", why: "FUSED: a soft burst, a dense flare of flames, and a whoosh of heat: a fire blast at the target.",
    patch: stack(click({ impactTone: 0.35, impactDecay: 0.15, impactGrit: 0.6, boom: 0.5, boomFreq: 70, boomDecay: 0.15, duration: 0.4 }), [ly(flames({ particleRate: 140, particleDecay: 0.2, attack: 0.005, duration: 0.7 }), 0, 0.8), ly(whoosh({ whooshTone: 0.4, whooshPeak: 0.25, duration: 0.5 }), 0, 0.45)]) },
]);
spellRound("ice", "Ice spell", "Casting an ice spell (freezing, ice shards). Which one is ICE, as one sound?", [
  { id: "freeze", why: "FUSED: crystal tones rising, a cold rush of air, frost crackling as it sets.",
    patch: stack(chime({ freq: 1500, modalPartials: 6, modalInharm: 0.5, modalBright: 0.75, modalDecay: 0.5, repeat: 4, rate: 12, arpStep: 4, reverb: 0.35, duration: 0.9 }), [ly(swell({ freq: 2000, filterMode: 1, cutoff: 2500, attack: 0.15, duration: 0.7 }), 0, 0.45), ly({ wave: 15, particleRate: 55, particleTone: 0.95, particleDecay: 0.1, particleSpread: 0.8, sustain: 1, attack: 0.05, release: 0.3, filterMode: 1, cutoff: 4000, duration: 0.8 }, 0.25, 0.4)]) },
  { id: "shard-cast", why: "FUSED: a sharp whoosh, a bright crack, ice shards tinkling outward.",
    patch: stack(whoosh({ whooshTone: 0.85, whooshSweep: 0.9, whooshPeak: 0.3, duration: 0.35 }), [ly(click({ impactTone: 0.95, impactDecay: 0.05, impactGrit: 0.3 }), 0.12, 0.6), ly(chime({ freq: 2800, modalPartials: 8, modalInharm: 0.85, modalBright: 0.9, modalDecay: 0.25, repeat: 5, rate: 14, reverb: 0.25, duration: 0.7 }), 0.13, 0.55)]) },
  { id: "frost-swell", why: "FUSED: a glassy shimmer swelling and settling, with a few crystal pings.",
    patch: stack({ wave: 16, freq: 880, addPartials: 14, addTilt: 0.6, addDrift: 0.6, addDriftRate: 2, addDetune: 0.5, attack: 0.15, decay: 0.4, sustain: 0.4, release: 0.5, cutoff: 14000, reverb: 0.45, reverbSize: 0.7, width: 0.7, duration: 1.1 }, [ly(chime({ freq: 2349, modalDecay: 0.3, repeat: 3, rate: 8, arpStep: 7, duration: 0.7 }), 0.1, 0.4)]) },
]);
spellRound("electric", "Lightning spell", "Casting a lightning spell (a bolt, a shock). Which one is ELECTRIC, as one sound?", [
  { id: "bolt", why: "FUSED: a gritty crack (the bolt), the transformer buzz under it, crackle flickering out.",
    patch: stack(click({ impactTone: 0.9, impactDecay: 0.12, impactGrit: 0.85, boom: 0.4, boomFreq: 90, boomDecay: 0.12, reverb: 0.3, duration: 0.6 }), [ly(buzz({ duration: 0.6, release: 0.3 }), 0, 0.5), ly(crackleE({ duration: 0.8 }), 0.05, 0.5)]) },
  { id: "charge-release", why: "FUSED: a buzz charging up (rising), released as a zap with crackle.",
    patch: stack(buzz({ freq: 90, sweep: 0.6, attack: 0.25, decay: 0.1, sustain: 0.8, release: 0.05, duration: 0.45 }), [ly({ wave: 2, freq: 1400, sweep: -0.6, attack: 0, decay: 0.15, sustain: 0, release: 0.1, cutoff: 7000, reso: 0.5, drive: 0.4, ringMod: 0.4, ringFreq: 400, duration: 0.35 }, 0.42, 0.7), ly(crackleE({ duration: 0.5 }), 0.45, 0.45)]) },
  { id: "spark-chain", why: "FUSED: crackling sparks jumping, ring-modulated zaps between them, a buzz underneath.",
    patch: stack(crackleE({ flicker: 0.8, flickerRate: 22, duration: 0.9, sustain: 0.5 }), [ly({ wave: 1, freq: 800, sweep: -0.4, attack: 0, decay: 0.06, sustain: 0, release: 0.04, ringMod: 0.6, ringFreq: 1200, cutoff: 8000, repeat: 5, rate: 9, duration: 0.6 }, 0.05, 0.5), ly(buzz({ duration: 0.9, release: 0.3 }), 0, 0.3)]) },
]);
spellRound("water", "Water spell", "Casting a water spell (a wave, a water blast). Which one is WATER, as one sound?", [
  { id: "wave-surge", why: "FUSED: water surging up (a swelling roar), bubbles churning, a splash as it breaks.",
    patch: stack(swell({ freq: 250, cutoff: 1100, attack: 0.3, duration: 0.9 }), [ly(bubbles({ duration: 0.8 }), 0.1, 0.5), ly(noiseHit({ freq: 600, filterMode: 0, cutoff: 3000, decay: 0.15, release: 0.2, reverb: 0.25, duration: 0.4 }), 0.4, 0.6)]) },
  { id: "bubble-blast", why: "FUSED: a riser full of bubbles, bursting into a spray.",
    patch: stack(bubbles({ bubbleRate: 30, bubbleRise: 0.8, freq: 300, attack: 0.15, duration: 0.6 }), [ly({ wave: 0, freq: 300, sweep: 0.6, attack: 0.2, decay: 0.2, sustain: 0, release: 0.1, cutoff: 2000, reso: 0.5, duration: 0.5 }, 0, 0.4), ly(noiseHit({ freq: 3000, filterMode: 1, cutoff: 2500, decay: 0.2, release: 0.2, duration: 0.4 }), 0.38, 0.4)]) },
  { id: "water-whip", why: "FUSED: a wet whoosh, a slap of water, droplets scattering.",
    patch: stack(whoosh({ whooshTone: 0.5, whooshBody: 0.5, whooshPeak: 0.4, duration: 0.4 }), [ly(noiseHit({ freq: 500, filterMode: 0, cutoff: 2200, decay: 0.08, duration: 0.25 }), 0.15, 0.7), ly({ wave: 14, freq: 1000, bubbleRate: 12, bubbleRise: 0.7, bubbleSpread: 0.4, bubbleDecay: 0.3, sustain: 1, attack: 0.005, release: 0.15, duration: 0.5 }, 0.18, 0.4)]) },
]);
spellRound("magic", "Arcane spell", "Casting a pure magic spell (arcane, not an element). Which one is MAGIC, as one sound?", [
  { id: "arcane-burst", why: "FUSED: a shimmering swell rising into a burst of bright chimes, a sparkling tail.",
    patch: stack({ wave: 16, freq: 523, addPartials: 14, addTilt: 0.7, addDrift: 0.6, addDriftRate: 2.5, sweep: 0.3, attack: 0.2, decay: 0.3, sustain: 0.3, release: 0.4, reverb: 0.45, reverbSize: 0.7, width: 0.7, duration: 0.8 }, [ly(chime({ freq: 1568, modalDecay: 0.4, repeat: 4, rate: 14, arpStep: 4, reverb: 0.4, duration: 0.8 }), 0.25, 0.55)]) },
  { id: "rune-chime", why: "FUSED: a whoosh and a ring of rune-like bells (inharmonic, a little strange).",
    patch: stack(whoosh({ whooshTone: 0.45, whooshPeak: 0.5, reverb: 0.3, duration: 0.5 }), [ly(chime({ freq: 740, modalPartials: 8, modalInharm: 0.55, modalBright: 0.7, modalDecay: 0.7, repeat: 3, rate: 7, arpStep: 6, reverb: 0.45, duration: 1.1 }), 0.08, 0.7)]) },
  { id: "warp", why: "FUSED: a ring-modulated sweep (space bending), sparkles flickering through it.",
    patch: stack({ wave: 2, freq: 220, sweep: 0.7, ringMod: 0.5, ringFreq: 330, vibDepth: 0.08, vibRate: 7, attack: 0.1, decay: 0.3, sustain: 0.3, release: 0.3, cutoff: 5000, reso: 0.4, reverb: 0.4, width: 0.7, duration: 0.8 }, [ly(chime({ freq: 2093, modalDecay: 0.2, repeat: 6, rate: 16, flicker: 0.4, flickerRate: 12, duration: 0.8 }), 0.1, 0.4)]) },
]);
spellRound("stone", "Earth spell", "Casting an earth spell (a rock slam, a quake). Which one is STONE, as one sound?", [
  { id: "earth-slam", why: "FUSED: a rumble rising out of the ground, a heavy impact, rubble falling.",
    patch: stack(rumble({ duration: 0.6 }), [ly({ wave: 19, impactTone: 0.3, impactDecay: 0.35, impactPunch: 1, impactGrit: 0.7, boom: 0.9, boomFreq: 50, boomDecay: 0.3, attack: 0.001, sustain: 0, decay: 0.12, release: 0.2, drive: 0.4, duration: 0.6 }, 0.35, 0.9), ly({ wave: 15, particleRate: 40, particleTone: 0.15, particleDecay: 0.35, particleSpread: 0.8, sustain: 1, attack: 0.01, release: 0.4, cutoff: 2200, duration: 0.8 }, 0.42, 0.5)]) },
  { id: "boulder", why: "FUSED: a low heavy whoosh (a boulder flying), a thump, debris.",
    patch: stack(whoosh({ whooshTone: 0.2, whooshSweep: 0.4, whooshBody: 0.6, whooshPeak: 0.5, duration: 0.5 }), [ly(thump({ freq: 55, boomFreq: 50, boomDecay: 0.3, duration: 0.5 }), 0.3, 0.9), ly({ wave: 15, particleRate: 30, particleTone: 0.2, particleDecay: 0.3, particleSpread: 0.85, sustain: 1, attack: 0.005, release: 0.3, cutoff: 2500, duration: 0.6 }, 0.33, 0.45)]) },
  { id: "quake", why: "FUSED: a deep rumble with the ground cracking in bursts through it.",
    patch: stack(rumble({ attack: 0.05, sustain: 0.5, duration: 1.1 }), [ly(click({ impactTone: 0.4, impactDecay: 0.08, impactGrit: 0.9, repeat: 4, rate: 6, duration: 0.8 }), 0.1, 0.6)]) },
]);
spellRound("slime", "Poison / slime spell", "Casting a poison or acid spell (a toxic blob, an acid splash). Which one is SLIME, as one sound?", [
  { id: "acid-splash", why: "FUSED: a gooey blorp, bubbling, and an acid hiss as it lands.",
    patch: stack({ wave: 13, freq: 120, sweep: -0.3, formantVowel: 0.8, formantSize: 1.4, formantQ: 0.5, formantBreath: 0.2, sustain: 1, attack: 0.01, release: 0.15, drive: 0.2, duration: 0.35 }, [ly(bubbles({ freq: 180, bubbleRate: 25, bubbleRise: 0.2, duration: 0.7 }), 0.05, 0.6), ly({ wave: 0, freq: 4000, noise: 1, attack: 0.05, decay: 0.3, sustain: 0.2, release: 0.3, filterMode: 1, cutoff: 3500, duration: 0.7 }, 0.2, 0.3)]) },
  { id: "toxic-cloud", why: "FUSED: a hissing cloud swelling, thick bubbles inside it.",
    patch: stack(swell({ freq: 1500, filterMode: 2, cutoff: 1800, reso: 0.5, attack: 0.2, duration: 1 }), [ly(bubbles({ freq: 150, bubbleRate: 14, bubbleRise: 0.15, bubbleDecay: 0.5, duration: 0.9 }), 0.1, 0.6)]) },
  { id: "goo-blob", why: "FUSED: a big slimy blob launched (a low wobble) and splatting.",
    patch: stack({ wave: 13, freq: 90, sweep: 0.2, formantVowel: 0.5, formantSize: 1.6, formantQ: 0.4, vibDepth: 0.15, vibRate: 9, sustain: 1, attack: 0.02, release: 0.1, duration: 0.4 }, [ly(bubbles({ freq: 120, bubbleRate: 8, bubbleRise: 0.3, bubbleDecay: 0.5, duration: 0.5 }), 0.3, 0.6), ly(noiseHit({ freq: 400, filterMode: 0, cutoff: 1500, decay: 0.1, duration: 0.25 }), 0.35, 0.6)]) },
]);

// round 5b: ice again. AJ: A (freeze) or B (shard cast), "neither are great, but they are far closer. Maybe A". The
// freeze stays a take unchanged; four new ways to make it COLD, borrowing the shard cast's crack and shards.
const FREEZE = SPELL_ROUNDS["spell-ice"].takes.find((t) => t.id === "freeze").patch;
SPELL_ROUNDS["spell-ice-2"] = { title: "Ice spell, round 2 (built on your pick)", listen: "An ice spell again. Last round's pick was close but not great; one of these is it, unchanged. Which is most COLD and most like ice forming or striking?", takes: [
  { id: "freeze-round-1", why: "last round's pick, unchanged (the control): crystal tones rising, cold air, frost crackling.", patch: FREEZE },
  { id: "ice-forming", why: "FUSED: ice cracking as it forms (fast, high ticks), a cold wind under it, crystal tones settling.",
    patch: stack(click({ impactTone: 1, impactDecay: 0.015, impactGrit: 0.4, repeat: 12, rate: 22, duration: 0.65 }), [ly(swell({ freq: 2500, filterMode: 1, cutoff: 3000, reso: 0.3, attack: 0.1, release: 0.4, duration: 0.9 }), 0, 0.45), ly(chime({ freq: 1760, modalPartials: 6, modalInharm: 0.6, modalDecay: 0.6, repeat: 2, rate: 6, arpStep: 5, reverb: 0.4, duration: 0.9 }), 0.35, 0.5)]) },
  { id: "freeze-and-shatter", why: "FUSED: the freeze's crystal tones and cold air, then a crack and shards tinkling outward at its end (the two picks joined; the shards take the frost crackle's place: four layers at most).",
    patch: stack(Object.assign({}, FREEZE, { layers: "" }), [JSON.parse(FREEZE.layers)[0], ly(click({ impactTone: 0.95, impactDecay: 0.05, impactGrit: 0.3 }), 0.45, 0.5), ly(chime({ freq: 2800, modalPartials: 8, modalInharm: 0.85, modalBright: 0.9, modalDecay: 0.25, repeat: 4, rate: 14, reverb: 0.25, duration: 0.6 }), 0.46, 0.45)]) },
  { id: "glacial", why: "FUSED: big ice: a low groaning creak, a shimmering crystal swell over it, a cold hiss.",
    patch: stack({ wave: 2, freq: 70, sweep: -0.15, attack: 0.1, decay: 0.4, sustain: 0.2, release: 0.3, cutoff: 600, reso: 0.75, drive: 0.4, vibDepth: 0.03, vibRate: 5, duration: 0.9 }, [ly({ wave: 16, freq: 1175, addPartials: 12, addTilt: 0.5, addDrift: 0.7, addDriftRate: 3, addDetune: 0.6, attack: 0.15, decay: 0.4, sustain: 0.3, release: 0.4, reverb: 0.5, reverbSize: 0.8, width: 0.8, duration: 1 }, 0.05, 0.6), ly(swell({ freq: 3000, filterMode: 1, cutoff: 4000, attack: 0.2, duration: 0.9 }), 0.05, 0.35)]) },
  { id: "frost-bells", why: "FUSED: a cold whoosh and a cluster of high, slightly detuned glass bells, frost crackling after.",
    patch: stack(whoosh({ whooshTone: 0.8, whooshSweep: 0.7, whooshPeak: 0.35, filterMode: 1, cutoff: 1500, duration: 0.4 }), [ly(chime({ freq: 2637, modalPartials: 7, modalInharm: 0.4, modalBright: 0.95, modalDecay: 0.8, unison: 3, detune: 14, reverb: 0.45, reverbSize: 0.75, duration: 1.1 }), 0.08, 0.6), ly({ wave: 15, particleRate: 50, particleTone: 0.95, particleDecay: 0.1, particleSpread: 0.8, sustain: 1, attack: 0.05, release: 0.3, filterMode: 1, cutoff: 4000, duration: 0.8 }, 0.3, 0.35)]) },
] };

// round 5c: ice, B then A. AJ: "combine ice b and then a. It sounds like it's being pelted with frost until it's frozen
// solid with a." B (frost bells) is a cold whoosh + detuned glass bells + frost crackle; A (ice forming) is fast cracking
// ticks + a cold wind + crystals settling. Three layers each and a sound has four, so each take keeps a different part of
// the pelting, then the freezing.
{
  const R2 = SPELL_ROUNDS["spell-ice-2"].takes, B = R2.find((t) => t.id === "frost-bells").patch, A = R2.find((t) => t.id === "ice-forming").patch;
  const bL = JSON.parse(B.layers), aL = JSON.parse(A.layers), top = (p) => Object.assign({}, p, { layers: "" });
  const at = (L, d) => Object.assign({}, L, { d: L.d + d });
  const T = 0.5;   // where the freezing takes over
  // AJ, right after: "I believe I misspoke, can we swap the order of the sounds?" So A (the ice forming) first, then B
  // (the frost bells). The same three ways to join them, the other way round.
  SPELL_ROUNDS["spell-ice-3"] = { title: "Ice spell, round 3: ice forming, then the frost bells", listen: "Your two picks joined, the ice forming first and the frost bells after. Which joins them best? (Say if the second part comes too early or too late.)", takes: [
    { id: "ticks-wind-then-bells-frost", why: "A's cracking ticks and cold wind, then B's glass bells and frost crackle (A's crystals and B's whoosh left out).",
      patch: stack(top(A), [aL[0], ly(bL[0].s, T + bL[0].d, bL[0].g), at(bL[1], T)]) },
    { id: "ticks-crystals-then-bells-frost", why: "A's cracking ticks and settling crystals, then B's glass bells and frost crackle (A's wind and B's whoosh left out).",
      patch: stack(top(A), [aL[1], ly(bL[0].s, T + bL[0].d, bL[0].g), at(bL[1], T)]) },
    { id: "all-of-a-then-bells", why: "all of A (ticks, wind, crystals), then B's glass bells alone (B's whoosh and frost left out).",
      patch: stack(top(A), [aL[0], aL[1], ly(bL[0].s, T + bL[0].d, bL[0].g)]) },
  ] };
}

// ---- THE ROUNDS. A take: { id, why, patch } (patch over the defaults; `layers` for a layered build).
const ROUNDS = {
  "electric-buzz": {
    title: "Electrical buzzing (a gap: SFX had none)",
    listen: "A live electrical buzz: a power line, a transformer, a neon sign, a shorting wire. Which sounds most like electricity, and which would you use in a game? Report a second favorite too: two of these could both earn a preset.",
    takes: [
      { id: "mains-hum", why: "a square wave at 60 Hz (mains), driven, with a 120 Hz tremolo: the flutter of rectified power. The classic hum.",
        patch: { wave: 1, freq: 60, noise: 0.04, attack: 0.03, decay: 0.1, sustain: 1, release: 0.2, cutoff: 1600, reso: 0.2, drive: 0.55, tremDepth: 0.35, tremRate: 120, duration: 1.6, width: 0.3 } },
      { id: "transformer", why: "a saw at 120 Hz through a resonant filter, harder drive and bitcrush, deep 120 Hz tremolo: the angrier buzz of a transformer or a bug lamp.",
        patch: { wave: 2, freq: 120, attack: 0.02, decay: 0.1, sustain: 1, release: 0.2, cutoff: 2600, reso: 0.55, drive: 0.65, bitcrush: 7, tremDepth: 0.5, tremRate: 120, vibDepth: 0.01, vibRate: 3, duration: 1.6, width: 0.35 } },
      { id: "neon-flicker", why: "a band-passed 120 Hz buzz with a little noise that FLICKERS: drops out and surges at random, like a dying neon tube.",
        patch: { wave: 1, freq: 120, noise: 0.12, attack: 0.01, decay: 0.1, sustain: 1, release: 0.1, filterMode: 2, cutoff: 1400, reso: 0.4, drive: 0.4, tremDepth: 0.3, tremRate: 120, flicker: 0.55, flickerRate: 9, duration: 1.6, width: 0.4 } },
      { id: "live-wire", why: "LAYERED: a hum, a flickering crackle over it, and three arc snaps: a shorting live wire.",
        patch: Object.assign({ wave: 1, freq: 60, noise: 0.04, attack: 0.03, decay: 0.1, sustain: 1, release: 0.2, cutoff: 1600, reso: 0.2, drive: 0.55, tremDepth: 0.35, tremRate: 120, duration: 1.6, width: 0.3 }, {
          layers: layers([
            { s: { wave: 1, freq: 620, noise: 0.5, attack: 0, hold: 0.001, decay: 0.05, sustain: 0.4, release: 0.08, cutoff: 6500, reso: 0.5, drive: 0.72, bitcrush: 4, downsample: 6, flicker: 0.7, flickerRate: 14, duration: 1.5, width: 0.45 }, d: 0.1, g: 0.45, p: 0 },
            { s: { wave: 19, impactTone: 0.95, impactDecay: 0.03, impactPunch: 1, impactGrit: 0.6, attack: 0.001, decay: 0.02, sustain: 0, release: 0.03, repeat: 3, rate: 2.5, duration: 1.3, reverb: 0.15 }, d: 0.25, g: 0.35, p: 0 },
          ]) }) },
    ],
  },
  "bubble-pop": {
    title: "Bubble Pop (today: a sine sweep; SFX has a bubble engine)",
    listen: "A single bubble popping, as in a bubble-wrap or a soap-bubble pickup. Which pops most convincingly?",
    takes: [
      { id: "current", why: "the preset as it is: a sine sweeping up through a resonant filter.", patch: preset("Bubble Pop") },
      { id: "bubble-engine", why: "the bubble engine (Minnaert model): one bubble, its pitch rising as it closes.",
        patch: { wave: 14, freq: 500, bubbleRate: 1, bubbleRise: 0.8, bubbleSpread: 0.05, bubbleDecay: 0.35, attack: 0.001, hold: 0.003, decay: 0.08, sustain: 1, release: 0.06, cutoff: 12000, reverb: 0.1, duration: 0.25 } },
      { id: "bubble-and-pop", why: "LAYERED: the bubble engine plus the tiny click of the film breaking.",
        patch: { wave: 14, freq: 500, bubbleRate: 1, bubbleRise: 0.8, bubbleSpread: 0.05, bubbleDecay: 0.35, attack: 0.001, hold: 0.003, decay: 0.08, sustain: 1, release: 0.06, cutoff: 12000, reverb: 0.1, duration: 0.25,
          layers: layers([{ s: { wave: 19, impactTone: 0.95, impactDecay: 0.02, impactPunch: 1, impactGrit: 0.05, attack: 0.001, decay: 0.01, sustain: 0, release: 0.02, duration: 0.08 }, d: 0.015, g: 0.4, p: 0 }]) } },
      { id: "wet-plop", why: "the bubble engine lower and wetter: a deeper plop with some room.",
        patch: { wave: 14, freq: 320, bubbleRate: 1, bubbleRise: 0.9, bubbleSpread: 0.05, bubbleDecay: 0.5, attack: 0.001, hold: 0.004, decay: 0.1, sustain: 1, release: 0.08, cutoff: 10000, reverb: 0.2, reverbSize: 0.5, duration: 0.35 } },
    ],
  },
  "glass-shatter": {
    title: "Glass Shatter (today: a triangle + noise; SFX has a modal engine for glass)",
    listen: "A window or a bottle smashing. Which one is glass? Listen for the shards: do they ring like glass, or hiss like static?",
    takes: [
      { id: "current", why: "the preset as it is: a triangle at 2.4 kHz buried in noise, crushed, with an echo.", patch: preset("Glass Shatter") },
      { id: "modal-shards", why: "LAYERED: a bright crack, a modal ring of many inharmonic partials (glass), and a spray of tinkling particles.",
        patch: { wave: 19, impactTone: 0.95, impactDecay: 0.05, impactPunch: 1, impactGrit: 0.3, attack: 0.001, decay: 0.03, sustain: 0, release: 0.05, duration: 0.25, width: 0.6,
          layers: layers([
            { s: { wave: 10, freq: 2800, modalPartials: 10, modalInharm: 0.9, modalBright: 0.9, modalDecay: 0.35, sustain: 1, attack: 0.001, release: 0.3, duration: 0.9, reverb: 0.25, width: 0.7 }, d: 0, g: 0.8, p: 0 },
            { s: { wave: 15, particleRate: 45, particleTone: 0.95, particleDecay: 0.2, particleSpread: 0.9, sustain: 1, attack: 0.005, release: 0.4, duration: 0.9, filterMode: 1, cutoff: 3000, width: 0.8 }, d: 0.03, g: 0.6, p: 0 },
          ]) } },
      { id: "falling-shards", why: "LAYERED: a crack and a noise burst, then glass pieces landing one after another (a modal tinkle repeating).",
        patch: { wave: 19, impactTone: 0.9, impactDecay: 0.08, impactPunch: 1, impactGrit: 0.5, attack: 0.001, decay: 0.04, sustain: 0, release: 0.06, duration: 0.3, width: 0.6,
          layers: layers([
            { s: { wave: 0, freq: 3000, noise: 0.95, attack: 0, hold: 0.002, decay: 0.08, sustain: 0, release: 0.1, filterMode: 1, cutoff: 2500, duration: 0.3 }, d: 0, g: 0.5, p: 0 },
            { s: { wave: 10, freq: 3500, modalPartials: 6, modalInharm: 0.85, modalBright: 0.9, modalDecay: 0.15, sustain: 1, attack: 0.001, release: 0.1, repeat: 7, rate: 11, duration: 0.8, reverb: 0.2, width: 0.8 }, d: 0.12, g: 0.45, p: 0 },
          ]) } },
      { id: "heavy-pane", why: "the modal shards plus a low thump: a big pane, with weight.",
        patch: { wave: 19, impactTone: 0.95, impactDecay: 0.05, impactPunch: 1, impactGrit: 0.3, attack: 0.001, decay: 0.03, sustain: 0, release: 0.05, duration: 0.25, width: 0.6,
          layers: layers([
            { s: { wave: 10, freq: 2400, modalPartials: 10, modalInharm: 0.9, modalBright: 0.85, modalDecay: 0.4, sustain: 1, attack: 0.001, release: 0.3, duration: 1, reverb: 0.3, width: 0.7 }, d: 0, g: 0.8, p: 0 },
            { s: { wave: 15, particleRate: 45, particleTone: 0.95, particleDecay: 0.2, particleSpread: 0.9, sustain: 1, attack: 0.005, release: 0.4, duration: 1, filterMode: 1, cutoff: 3000, width: 0.8 }, d: 0.03, g: 0.55, p: 0 },
            { s: { wave: 0, freq: 70, sweep: -0.4, boom: 0.8, boomFreq: 65, boomDrop: 0.7, boomDecay: 0.15, attack: 0, decay: 0.12, sustain: 0, release: 0.08, cutoff: 400, duration: 0.3 }, d: 0, g: 0.5, p: 0 },
          ]) } },
    ],
  },
  // ---- round 2 (2026-10-29): platformer moves, gaps (no preset to compete; the nearest tuned sounds are the starting points)
  "double-jump": {
    title: "Double jump (a gap)",
    listen: "The second jump, in mid-air. It should read as 'another jump' (not a different action) yet feel lighter or more special than the first. Which one?",
    takes: [
      { id: "higher-hop", why: "the Jump preset a fifth higher and snappier: the same action, again, up.",
        patch: { wave: 1, freq: 420, sweep: 0.5, attack: 0.003, decay: 0.08, sustain: 0.15, release: 0.1, cutoff: 9000, duration: 0.25 } },
      { id: "flip-whoosh", why: "LAYERED: a hop and a short whoosh of air: a spin or flip.",
        patch: { wave: 1, freq: 380, sweep: 0.45, attack: 0.003, decay: 0.08, sustain: 0.15, release: 0.1, cutoff: 9000, duration: 0.25,
          layers: layers([{ s: { wave: 20, whooshTone: 0.7, whooshSweep: 0.8, whooshBody: 0.3, whooshPeak: 0.35, sustain: 1, attack: 0.001, release: 0.04, duration: 0.25, width: 0.6 }, d: 0.02, g: 0.6, p: 0 }]) } },
      { id: "twinkle", why: "LAYERED: a softer hop with a two-note magic twinkle: the 'special' second jump.",
        patch: { wave: 3, freq: 500, sweep: 0.5, attack: 0.003, decay: 0.1, sustain: 0.1, release: 0.1, cutoff: 9000, duration: 0.3,
          layers: layers([{ s: { wave: 10, freq: 1600, modalPartials: 5, modalInharm: 0.3, modalBright: 0.8, modalDecay: 0.3, repeat: 2, rate: 14, arpStep: 7, sustain: 1, attack: 0.001, release: 0.2, duration: 0.4, reverb: 0.3, width: 0.6 }, d: 0.04, g: 0.45, p: 0 }]) } },
      { id: "wing-flap", why: "LAYERED: two soft whoosh puffs (wings) and a little rising blip.",
        patch: { wave: 20, whooshTone: 0.35, whooshSweep: 0.4, whooshBody: 0.25, whooshPeak: 0.3, sustain: 1, attack: 0.001, release: 0.04, duration: 0.18, width: 0.5,
          layers: layers([
            { s: { wave: 20, whooshTone: 0.35, whooshSweep: 0.4, whooshBody: 0.25, whooshPeak: 0.3, sustain: 1, attack: 0.001, release: 0.04, duration: 0.18, width: 0.5 }, d: 0.09, g: 0.8, p: 0 },
            { s: { wave: 0, freq: 600, sweep: 0.6, attack: 0, decay: 0.12, sustain: 0, release: 0.08, duration: 0.25 }, d: 0.02, g: 0.35, p: 0 },
          ]) } },
    ],
  },
  "checkpoint": {
    title: "Checkpoint reached (a gap)",
    listen: "Touching a checkpoint: reassuring, clearly GOOD, but smaller than a level-complete fanfare. Which one would you want to hear every time you reach one?",
    takes: [
      { id: "bell-arp", why: "a modal bell, three notes rising in fifths, with some room.",
        patch: { wave: 10, freq: 880, modalPartials: 6, modalInharm: 0.35, modalBright: 0.8, modalDecay: 0.6, repeat: 3, rate: 9, arpStep: 7, sustain: 1, attack: 0.001, release: 0.5, reverb: 0.35, reverbSize: 0.6, duration: 1.2 } },
      { id: "flag-unfurl", why: "LAYERED: a cloth whoosh (the flag going up) and a bright two-note chime.",
        patch: { wave: 20, whooshTone: 0.42, whooshSweep: 0.45, whooshBody: 0.22, whooshPeak: 0.45, attack: 0.01, hold: 0.02, decay: 0.2, sustain: 1, release: 0.2, cutoff: 4200, reso: 0.15, width: 0.65, reverb: 0.16, duration: 0.45,
          layers: layers([{ s: { wave: 10, freq: 1320, modalPartials: 6, modalInharm: 0.3, modalBright: 0.85, modalDecay: 0.5, repeat: 2, rate: 6, arpStep: 5, sustain: 1, attack: 0.001, release: 0.4, reverb: 0.3, duration: 0.9 }, d: 0.12, g: 0.7, p: 0 }]) } },
      { id: "retro-arp", why: "an 8-bit pulse arpeggio, four quick notes up: the classic save-point blip.",
        patch: { wave: 4, pulseWidth: 0.25, freq: 523, attack: 0, hold: 0.01, decay: 0.06, sustain: 0.2, release: 0.05, repeat: 4, rate: 14, arpStep: 4, cutoff: 9000, bitcrush: 6, duration: 0.55 } },
      { id: "warm-bell", why: "LAYERED: a warm, slowly shimmering additive tone (a safe place) with a sprinkle of high chimes.",
        patch: { wave: 16, freq: 523, addPartials: 12, addTilt: 0.7, addDrift: 0.5, addDriftRate: 1, attack: 0.02, decay: 0.4, sustain: 0.4, release: 0.8, cutoff: 12000, reverb: 0.55, reverbSize: 0.8, width: 0.6, duration: 1.6,
          layers: layers([{ s: { wave: 10, freq: 2093, modalPartials: 5, modalInharm: 0.3, modalBright: 0.85, modalDecay: 0.3, repeat: 4, rate: 10, arpStep: 7, sustain: 1, attack: 0.001, release: 0.3, reverb: 0.4, duration: 0.8, width: 0.7 }, d: 0.1, g: 0.3, p: 0 }]) } },
    ],
  },
  "dash": {
    title: "Dash (a gap)",
    listen: "A quick burst of speed: an air dash or a dodge. Short and punchy; it will be heard a LOT. Which one?",
    takes: [
      { id: "air-whoosh", why: "the whoosh engine, sharp and early-peaking: air rushing past.",
        patch: { wave: 20, whooshTone: 0.75, whooshSweep: 0.9, whooshBody: 0.35, whooshPeak: 0.2, sustain: 1, attack: 0.001, release: 0.04, duration: 0.28, width: 0.6 } },
      { id: "dash-burst", why: "LAYERED: the whoosh, a noise burst sweeping down, and a small push-off thump.",
        patch: { wave: 20, whooshTone: 0.75, whooshSweep: 0.9, whooshBody: 0.35, whooshPeak: 0.2, sustain: 1, attack: 0.001, release: 0.04, duration: 0.28, width: 0.6,
          layers: layers([
            { s: { wave: 0, freq: 1200, noise: 0.8, sweep: -0.6, attack: 0, decay: 0.12, sustain: 0, release: 0.08, filterMode: 2, cutoff: 2500, reso: 0.4, duration: 0.25 }, d: 0, g: 0.4, p: 0 },
            { s: { wave: 0, freq: 90, sweep: -0.4, boom: 0.6, boomFreq: 80, boomDecay: 0.08, attack: 0, decay: 0.08, sustain: 0, release: 0.05, cutoff: 400, duration: 0.15 }, d: 0, g: 0.35, p: 0 },
          ]) } },
      { id: "retro-dash", why: "an 8-bit noise sweep down, crushed: the console dash.",
        patch: { wave: 0, freq: 900, noise: 0.7, sweep: -0.7, attack: 0, decay: 0.12, sustain: 0, release: 0.06, bitcrush: 5, downsample: 3, cutoff: 7000, duration: 0.22 } },
      { id: "boost-dash", why: "LAYERED: the whoosh, a rising engine note (a boost), and a trail of sparks.",
        patch: { wave: 20, whooshTone: 0.75, whooshSweep: 0.9, whooshBody: 0.35, whooshPeak: 0.2, sustain: 1, attack: 0.001, release: 0.04, duration: 0.28, width: 0.6,
          layers: layers([
            { s: { wave: 2, freq: 220, sweep: 0.7, attack: 0, decay: 0.2, sustain: 0, release: 0.1, cutoff: 3000, reso: 0.5, filtEnv: 0.6, duration: 0.3 }, d: 0, g: 0.45, p: 0 },
            { s: { wave: 15, particleRate: 60, particleTone: 0.9, particleDecay: 0.15, particleSpread: 0.8, sustain: 1, attack: 0.005, release: 0.2, filterMode: 1, cutoff: 3000, duration: 0.4, width: 0.7 }, d: 0.05, g: 0.3, p: 0 },
          ]) } },
    ],
  },
  // ---- round 3 (2026-10-29): every remaining gap at once. Each round keeps ONE plain single-layer take as a CONTROL
  // (round 2's winners were all layered: does that hold for the shortest sounds too?).
  "reload": { title: "Reload (a gap)", listen: "A gun being reloaded: the magazine out, a new one in, the action racked. Which reads as a reload you would hear in a game?", takes: [
    { id: "mag-swap", why: "LAYERED: the release click, the magazine sliding out, the new one seating with a thunk, the slide racking.",
      patch: stack(click({ impactTone: 0.8, duration: 1.0 }), [ly(noiseHit({ freq: 800, cutoff: 1800, decay: 0.12, duration: 0.2 }), 0.12, 0.35), ly(click({ impactTone: 0.5, impactDecay: 0.08, impactGrit: 0.3, boom: 0.3, boomFreq: 140, boomDecay: 0.05, duration: 0.15 }), 0.38, 0.9), ly(click({ impactTone: 0.85, repeat: 2, rate: 8, duration: 0.35 }), 0.62, 0.8)]) },
    { id: "quick", why: "LAYERED: a fast two-part reload: click out, clack in.", patch: stack(click({ impactTone: 0.85, duration: 0.5 }), [ly(click({ impactTone: 0.55, impactDecay: 0.07, impactGrit: 0.35, boom: 0.25, boomFreq: 150, duration: 0.2 }), 0.22, 1)]) },
    { id: "revolver", why: "LAYERED: a cylinder spinning (fast ticks) and snapping shut.", patch: stack(click({ impactTone: 0.95, impactDecay: 0.015, repeat: 8, rate: 22, duration: 0.5 }), [ly(click({ impactTone: 0.7, impactDecay: 0.06, impactGrit: 0.2, duration: 0.2 }), 0.42, 1)]) },
    { id: "plain-retro", why: "CONTROL, single layer: two 8-bit blips, down then up.", patch: blip({ freq: 440, repeat: 2, rate: 5, arpStep: 7, duration: 0.45 }) },
  ] },
  "dry-fire": { title: "Dry fire: an empty gun's click (a gap)", listen: "Pulling the trigger with no ammo: the click that tells you you're empty. Which?", takes: [
    { id: "plain-click", why: "CONTROL, single layer: one dry mechanical click.", patch: click({ impactTone: 0.75, impactDecay: 0.04, impactGrit: 0.15 }) },
    { id: "hollow", why: "LAYERED: the click and a tiny hollow metal ring after it.", patch: stack(click({ impactTone: 0.75, impactDecay: 0.04, duration: 0.3 }), [ly(chime({ freq: 2200, modalDecay: 0.12, modalInharm: 0.6, reverb: 0, duration: 0.25 }), 0.005, 0.25)]) },
    { id: "double", why: "LAYERED: the trigger and the hammer: two clicks close together, the second duller.", patch: stack(click({ impactTone: 0.85, duration: 0.2 }), [ly(click({ impactTone: 0.55, impactDecay: 0.05, impactGrit: 0.2 }), 0.045, 0.8)]) },
    { id: "retro", why: "LAYERED: a click and a low 8-bit 'nope' blip.", patch: stack(click({ impactTone: 0.75, duration: 0.25 }), [ly(blip({ freq: 180, decay: 0.08, duration: 0.15 }), 0.03, 0.5)]) },
  ] },
  "shell-casing": { title: "Shell casing hitting the floor (a gap)", listen: "A spent brass casing landing and bouncing. Which is brass on a hard floor?", takes: [
    { id: "plain-tinkle", why: "CONTROL, single layer: a modal ping repeating three times.", patch: chime({ freq: 2600, modalPartials: 4, modalInharm: 0.6, modalDecay: 0.15, repeat: 3, rate: 7, reverb: 0.1, duration: 0.6 }) },
    { id: "bounces", why: "LAYERED: three bounces, each quicker, quieter and a little different in pitch.",
      patch: stack(chime({ freq: 2600, modalPartials: 4, modalInharm: 0.6, modalDecay: 0.18, reverb: 0.1, duration: 0.3 }), [ly(chime({ freq: 2750, modalPartials: 4, modalInharm: 0.6, modalDecay: 0.12, reverb: 0.1, duration: 0.25 }), 0.14, 0.6), ly(chime({ freq: 2500, modalPartials: 4, modalInharm: 0.6, modalDecay: 0.08, reverb: 0.1, duration: 0.2 }), 0.23, 0.35)]) },
    { id: "brass-roll", why: "LAYERED: the bounces, then a rolling rattle as it settles.",
      patch: stack(chime({ freq: 2400, modalPartials: 5, modalInharm: 0.55, modalDecay: 0.2, reverb: 0.1, duration: 0.3 }), [ly(chime({ freq: 2600, modalPartials: 4, modalInharm: 0.6, modalDecay: 0.05, repeat: 6, rate: 16, reverb: 0.05, duration: 0.5 }), 0.15, 0.4)]) },
    { id: "heavy-shell", why: "LAYERED: a bigger, lower casing (a shotgun shell) with a dull knock.", patch: stack(chime({ freq: 1500, modalPartials: 4, modalInharm: 0.5, modalDecay: 0.12, repeat: 2, rate: 6, reverb: 0.1, duration: 0.5 }), [ly(click({ impactTone: 0.4, impactDecay: 0.05 }), 0, 0.5)]) },
  ] },
  "scope": { title: "Scope / aim down sights (a gap)", listen: "Raising a scope or zooming in. Which says 'aiming'?", takes: [
    { id: "plain-zoom", why: "CONTROL, single layer: a filtered saw sweeping up, like a lens motor.", patch: { wave: 2, freq: 300, sweep: 0.5, attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.1, cutoff: 1500, reso: 0.5, filtEnv: 0.5, duration: 0.35 } },
    { id: "click-whoosh", why: "LAYERED: two quick ratchet clicks and a soft whoosh of the weapon coming up.", patch: stack(whoosh({ whooshTone: 0.45, whooshPeak: 0.4, duration: 0.3 }), [ly(click({ repeat: 2, rate: 18, impactTone: 0.85, duration: 0.15 }), 0.15, 0.6)]) },
    { id: "electronic", why: "LAYERED: a rising electronic beep and a tiny click (a digital sight).", patch: stack({ wave: 0, freq: 900, sweep: 0.3, attack: 0.005, decay: 0.1, sustain: 0, release: 0.05, ringMod: 0.2, ringFreq: 300, duration: 0.2 }, [ly(click({ impactTone: 0.95 }), 0.0, 0.4)]) },
    { id: "lens-glint", why: "LAYERED: a soft whoosh and a glassy ping (light on the lens).", patch: stack(whoosh({ whooshTone: 0.4, duration: 0.25 }), [ly(chime({ freq: 3200, modalDecay: 0.3, modalInharm: 0.2, duration: 0.5 }), 0.1, 0.35)]) },
  ] },
  "hit-marker": { title: "Hit marker (a gap)", listen: "The tick that confirms your shot landed. Heard constantly: it must be clear and never annoying. Which?", takes: [
    { id: "plain-tick", why: "CONTROL, single layer: a short bright tick.", patch: click({ impactTone: 1, impactDecay: 0.015, duration: 0.07 }) },
    { id: "tink", why: "LAYERED: a tick with a tiny metallic tink.", patch: stack(click({ impactTone: 1, impactDecay: 0.015, duration: 0.15 }), [ly(chime({ freq: 3000, modalDecay: 0.06, reverb: 0, duration: 0.12 }), 0, 0.4)]) },
    { id: "thock", why: "LAYERED: a tick with a soft low thock under it (felt more than heard).", patch: stack(click({ impactTone: 0.95, impactDecay: 0.02, duration: 0.1 }), [ly(thump({ freq: 140, boomFreq: 120, boomDecay: 0.04, decay: 0.04, duration: 0.08 }), 0, 0.4)]) },
    { id: "retro", why: "LAYERED: a tick and a very short high 8-bit blip.", patch: stack(click({ impactTone: 1, impactDecay: 0.015, duration: 0.1 }), [ly(blip({ freq: 1760, decay: 0.03, duration: 0.06 }), 0, 0.35)]) },
  ] },
  "knockout": { title: "Knockout / KO (a gap)", listen: "The finishing blow that knocks someone out. Which feels like a KO?", takes: [
    { id: "plain-impact", why: "CONTROL, single layer: a big punchy impact with a long body.", patch: { wave: 19, impactTone: 0.35, impactDecay: 0.4, impactPunch: 1, impactGrit: 0.5, boom: 0.9, boomFreq: 55, boomDrop: 1, boomDecay: 0.35, attack: 0.001, sustain: 0, decay: 0.15, release: 0.3, drive: 0.4, reverb: 0.3, reverbSize: 0.6, duration: 0.8 } },
    { id: "bell-ko", why: "LAYERED: a punch and a boxing-ring bell.", patch: stack({ wave: 19, impactTone: 0.4, impactDecay: 0.25, impactPunch: 1, impactGrit: 0.4, boom: 0.7, boomFreq: 65, boomDecay: 0.2, attack: 0.001, sustain: 0, decay: 0.1, release: 0.15, duration: 0.4 }, [ly(chime({ freq: 1050, modalPartials: 8, modalInharm: 0.55, modalDecay: 0.9, repeat: 2, rate: 4, reverb: 0.35, duration: 1.4 }), 0.15, 0.55)]) },
    { id: "slide-down", why: "LAYERED: the hit, a whoosh, and a tone sliding down: out cold.", patch: stack({ wave: 19, impactTone: 0.4, impactDecay: 0.25, impactPunch: 1, impactGrit: 0.4, boom: 0.7, boomFreq: 65, boomDecay: 0.2, attack: 0.001, sustain: 0, decay: 0.1, release: 0.15, duration: 0.4 }, [ly(whoosh({ duration: 0.35 }), 0, 0.5), ly({ wave: 0, freq: 900, sweep: -0.9, attack: 0.01, decay: 0.6, sustain: 0, release: 0.2, vibDepth: 0.05, vibRate: 8, duration: 0.9 }, 0.12, 0.4)]) },
    { id: "stars", why: "LAYERED: the hit, a heavy thump, and cartoon stars twinkling round the head.", patch: stack({ wave: 19, impactTone: 0.4, impactDecay: 0.25, impactPunch: 1, impactGrit: 0.4, boom: 0.7, boomFreq: 65, boomDecay: 0.2, attack: 0.001, sustain: 0, decay: 0.1, release: 0.15, duration: 0.4 }, [ly(thump({ freq: 55, boomFreq: 50, boomDecay: 0.3, duration: 0.5 }), 0, 0.6), ly(chime({ freq: 2093, modalDecay: 0.25, repeat: 5, rate: 9, arpStep: 4, reverb: 0.3, duration: 0.9 }), 0.25, 0.35)]) },
  ] },
  "enemy-death": { title: "Enemy death (a gap)", listen: "A regular enemy defeated and vanishing. It will play many times per level. Which?", takes: [
    { id: "plain-retro", why: "CONTROL, single layer: an 8-bit arpeggio falling.", patch: blip({ freq: 880, repeat: 5, rate: 18, arpStep: -3, decay: 0.04, duration: 0.4 }) },
    { id: "poof", why: "LAYERED: a puff of noise and a sparkle as it vanishes.", patch: stack(noiseHit({ freq: 600, cutoff: 1800, filterMode: 0, decay: 0.15, release: 0.15, reverb: 0.2, duration: 0.35 }), [ly(chime({ freq: 1760, modalDecay: 0.2, repeat: 3, rate: 14, arpStep: 5, duration: 0.5 }), 0.05, 0.4)]) },
    { id: "groan-thud", why: "LAYERED: a short falling groan and a body hitting the floor.", patch: stack({ wave: 13, freq: 140, sweep: -0.5, formantVowel: 0.3, formantSize: 1.3, formantQ: 0.4, formantBreath: 0.2, sustain: 1, attack: 0.02, release: 0.15, drive: 0.25, duration: 0.45 }, [ly(thump({ freq: 70, boomFreq: 60, boomDecay: 0.15, duration: 0.3 }), 0.38, 0.7)]) },
    { id: "dissolve", why: "LAYERED: a noise sweep falling away with a fading shimmer.", patch: stack({ wave: 0, freq: 2000, noise: 0.85, sweep: -0.7, attack: 0.005, decay: 0.35, sustain: 0, release: 0.2, filterMode: 2, cutoff: 3000, reso: 0.5, filtEnv: -0.6, duration: 0.5 }, [ly(chime({ freq: 1500, modalInharm: 0.5, modalDecay: 0.4, duration: 0.6 }), 0.05, 0.3)]) },
  ] },
  "wood-break": { title: "Wood breaking (a gap)", listen: "A crate or a plank smashing. Which is wood?", takes: [
    { id: "plain-crack", why: "CONTROL, single layer: a gritty, low-toned impact.", patch: { wave: 19, impactTone: 0.35, impactDecay: 0.2, impactPunch: 0.9, impactGrit: 0.85, attack: 0.001, sustain: 0, decay: 0.1, release: 0.12, drive: 0.35, duration: 0.45 } },
    { id: "crack-knock-splinters", why: "LAYERED: a crack, a hollow wooden knock, splinters spraying.", patch: stack(click({ impactTone: 0.6, impactDecay: 0.08, impactGrit: 0.7, duration: 0.2 }), [ly(chime({ freq: 320, modalPartials: 4, modalInharm: 0.25, modalBright: 0.35, modalDecay: 0.12, reverb: 0, duration: 0.3 }), 0, 0.7), ly({ wave: 15, particleRate: 50, particleTone: 0.45, particleDecay: 0.2, particleSpread: 0.8, sustain: 1, attack: 0.003, release: 0.3, duration: 0.6 }, 0.03, 0.5)]) },
    { id: "plank-snap", why: "LAYERED: a sharp snap and a creaking split (a plank breaking across).", patch: stack(noiseHit({ freq: 1500, cutoff: 3500, decay: 0.04, duration: 0.1 }), [ly({ wave: 2, freq: 180, sweep: -0.3, attack: 0.01, decay: 0.15, sustain: 0, release: 0.08, cutoff: 1500, reso: 0.7, drive: 0.4, repeat: 3, rate: 30, duration: 0.25 }, 0.02, 0.5), ly(chime({ freq: 260, modalPartials: 4, modalInharm: 0.2, modalBright: 0.3, modalDecay: 0.1, reverb: 0, duration: 0.25 }), 0.01, 0.5)]) },
    { id: "crate-smash", why: "LAYERED: a thump, boards knocking as they fall apart, splinters.", patch: stack(thump({ freq: 90, boomFreq: 80, boomDecay: 0.1, duration: 0.3 }), [ly(chime({ freq: 300, modalPartials: 4, modalInharm: 0.3, modalBright: 0.35, modalDecay: 0.08, repeat: 4, rate: 12, arpStep: -2, reverb: 0, duration: 0.45 }), 0.02, 0.7), ly({ wave: 15, particleRate: 40, particleTone: 0.4, particleDecay: 0.2, particleSpread: 0.85, sustain: 1, attack: 0.003, release: 0.3, duration: 0.6 }, 0.05, 0.45)]) },
  ] },
  "swim": { title: "Swim stroke (a gap)", listen: "One swimming stroke: an arm pulling through water. It repeats while swimming. Which?", takes: [
    { id: "plain-swish", why: "CONTROL, single layer: lowpassed noise swelling and fading (water moving).", patch: { wave: 0, freq: 300, noise: 0.95, attack: 0.08, decay: 0.2, sustain: 0, release: 0.15, cutoff: 900, reso: 0.3, filtEnv: 0.5, width: 0.6, duration: 0.45 } },
    { id: "swish-bubbles", why: "LAYERED: the water swish and a few bubbles.", patch: stack({ wave: 0, freq: 300, noise: 0.95, attack: 0.08, decay: 0.2, sustain: 0, release: 0.15, cutoff: 900, reso: 0.3, filtEnv: 0.5, width: 0.6, duration: 0.45 }, [ly({ wave: 14, freq: 350, bubbleRate: 10, bubbleRise: 0.5, bubbleSpread: 0.5, bubbleDecay: 0.3, sustain: 1, attack: 0.01, release: 0.1, duration: 0.4 }, 0.1, 0.4)]) },
    { id: "splash-stroke", why: "LAYERED: a small splash as the hand enters, then the pull.", patch: stack(noiseHit({ freq: 600, filterMode: 0, cutoff: 2500, decay: 0.08, release: 0.1, duration: 0.2 }), [ly({ wave: 0, freq: 300, noise: 0.95, attack: 0.06, decay: 0.2, sustain: 0, release: 0.12, cutoff: 800, filtEnv: 0.4, duration: 0.4 }, 0.06, 0.8), ly({ wave: 14, freq: 450, bubbleRate: 8, bubbleRise: 0.6, bubbleSpread: 0.4, bubbleDecay: 0.25, sustain: 1, attack: 0.005, release: 0.1, duration: 0.3 }, 0.02, 0.3)]) },
    { id: "underwater", why: "LAYERED: muffled and low: a swish and bubbles heard from under the water.", patch: stack({ wave: 0, freq: 200, noise: 0.95, attack: 0.1, decay: 0.25, sustain: 0, release: 0.2, cutoff: 450, reso: 0.4, reverb: 0.3, reverbSize: 0.6, duration: 0.55 }, [ly({ wave: 14, freq: 220, bubbleRate: 14, bubbleRise: 0.4, bubbleSpread: 0.6, bubbleDecay: 0.4, sustain: 1, attack: 0.01, release: 0.15, cutoff: 1200, duration: 0.5 }, 0.05, 0.5)]) },
  ] },
  "crawl": { title: "Crawl (a gap)", listen: "Crawling: knees and hands shuffling along the ground, through a vent, under a fence. Which?", takes: [
    { id: "plain-scrape", why: "CONTROL, single layer: a soft band-passed scrape, twice.", patch: noiseHit({ freq: 600, cutoff: 1400, reso: 0.2, attack: 0.03, decay: 0.12, release: 0.1, repeat: 2, rate: 3.5, duration: 0.6 }) },
    { id: "cloth-rustle", why: "LAYERED: cloth rustling and a soft knee knock.", patch: stack({ wave: 15, particleRate: 70, particleTone: 0.2, particleDecay: 0.25, particleSpread: 0.6, sustain: 1, attack: 0.05, release: 0.2, duration: 0.6, cutoff: 3000 }, [ly(thump({ freq: 120, boomFreq: 100, boom: 0.5, boomDecay: 0.05, duration: 0.15 }), 0.08, 0.5), ly(thump({ freq: 110, boomFreq: 95, boom: 0.5, boomDecay: 0.05, duration: 0.15 }), 0.36, 0.45)]) },
    { id: "vent", why: "LAYERED: a shuffle with a hollow metal knock (crawling through a vent).", patch: stack(noiseHit({ freq: 600, cutoff: 1400, reso: 0.2, attack: 0.03, decay: 0.12, release: 0.1, repeat: 2, rate: 3.5, duration: 0.6 }), [ly(chime({ freq: 420, modalPartials: 6, modalInharm: 0.6, modalBright: 0.4, modalDecay: 0.25, repeat: 2, rate: 3.5, reverb: 0.3, duration: 0.7 }), 0.02, 0.45)]) },
    { id: "dirt", why: "LAYERED: a scrape and a trickle of gravel (crawling on dirt).", patch: stack(noiseHit({ freq: 500, cutoff: 1200, attack: 0.04, decay: 0.15, release: 0.1, duration: 0.3 }), [ly({ wave: 15, particleRate: 45, particleTone: 0.35, particleDecay: 0.15, particleSpread: 0.7, sustain: 1, attack: 0.02, release: 0.2, duration: 0.5 }, 0.05, 0.5)]) },
  ] },
  "slider": { title: "Slider / scroll tick (a gap)", listen: "The tick as a menu slider moves one notch or a list scrolls one row. It repeats fast, so it must be tiny. Which?", takes: [
    { id: "plain-click", why: "CONTROL, single layer: a tiny high click.", patch: click({ impactTone: 0.95, impactDecay: 0.01, impactPunch: 0.8, duration: 0.05 }) },
    { id: "pitched-tick", why: "LAYERED: a click with a tiny pitched blip (a notch you can almost hear the value of).", patch: stack(click({ impactTone: 0.95, impactDecay: 0.01, duration: 0.06 }), [ly({ wave: 0, freq: 1400, attack: 0, decay: 0.025, sustain: 0, release: 0.01, duration: 0.05 }, 0, 0.4)]) },
    { id: "wood-tick", why: "LAYERED: a click with a tiny wooden knock (a physical dial).", patch: stack(click({ impactTone: 0.85, impactDecay: 0.01, duration: 0.06 }), [ly(chime({ freq: 900, modalPartials: 3, modalInharm: 0.2, modalBright: 0.4, modalDecay: 0.03, reverb: 0, duration: 0.06 }), 0, 0.5)]) },
    { id: "digital", why: "LAYERED: a click with a very short 8-bit blip.", patch: stack(click({ impactTone: 0.95, impactDecay: 0.01, duration: 0.05 }), [ly(blip({ freq: 1320, decay: 0.015, duration: 0.04 }), 0, 0.3)]) },
  ] },
  "line-clear": { title: "Line clear (a gap)", listen: "A puzzle line or row cleared: satisfying, a reward, but short enough to chain. Which?", takes: [
    { id: "plain-arp", why: "CONTROL, single layer: a bright quick arpeggio up.", patch: chime({ freq: 784, modalDecay: 0.2, repeat: 4, rate: 16, arpStep: 4, duration: 0.5 }) },
    { id: "zap-sparkle", why: "LAYERED: a zap sweeping up and a sparkle on top.", patch: stack({ wave: 2, freq: 400, sweep: 0.8, attack: 0, decay: 0.15, sustain: 0, release: 0.08, cutoff: 6000, reso: 0.4, duration: 0.25 }, [ly(chime({ freq: 1760, modalDecay: 0.25, repeat: 3, rate: 14, arpStep: 5, duration: 0.5 }), 0.05, 0.5)]) },
    { id: "retro", why: "LAYERED: an 8-bit arpeggio and a noise swish (the row sweeping away).", patch: stack(blip({ freq: 523, repeat: 4, rate: 16, arpStep: 4, decay: 0.04, duration: 0.35 }), [ly(noiseHit({ freq: 3000, filterMode: 1, cutoff: 2000, attack: 0.02, decay: 0.15, duration: 0.3 }), 0, 0.3)]) },
    { id: "crunch-chime", why: "LAYERED: a crunchy burst (blocks breaking) and a two-note chime.", patch: stack(noiseHit({ freq: 800, filterMode: 0, cutoff: 3000, decay: 0.08, bitcrush: 5, duration: 0.2 }), [ly(chime({ freq: 1320, modalDecay: 0.3, repeat: 2, rate: 10, arpStep: 7, duration: 0.5 }), 0.03, 0.6)]) },
  ] },
  "rotate": { title: "Rotate a piece (a gap)", listen: "Turning a puzzle piece: tiny, frequent, mechanical. Which?", takes: [
    { id: "plain-blip", why: "CONTROL, single layer: a short soft 8-bit blip.", patch: blip({ freq: 660, decay: 0.03, bitcrush: 8, duration: 0.07 }) },
    { id: "whoosh-tick", why: "LAYERED: a tiny whoosh and a tick as it lands.", patch: stack(whoosh({ whooshTone: 0.7, whooshPeak: 0.5, duration: 0.1 }), [ly(click({ impactTone: 0.9, impactDecay: 0.01 }), 0.07, 0.6)]) },
    { id: "ratchet", why: "LAYERED: two fast ratchet clicks and a soft knock.", patch: stack(click({ impactTone: 0.9, impactDecay: 0.01, repeat: 2, rate: 35, duration: 0.1 }), [ly(chime({ freq: 600, modalPartials: 3, modalInharm: 0.3, modalBright: 0.4, modalDecay: 0.04, reverb: 0, duration: 0.08 }), 0.03, 0.4)]) },
    { id: "click-up", why: "LAYERED: a click and a little rising tone.", patch: stack(click({ impactTone: 0.9, impactDecay: 0.01, duration: 0.1 }), [ly({ wave: 0, freq: 700, sweep: 0.4, attack: 0, decay: 0.05, sustain: 0, release: 0.03, duration: 0.08 }, 0, 0.4)]) },
  ] },
  // ---- round 4 (2026-10-29): wood break again. AJ: take A (the plain gritty crack) "is the best, but it doesn't really
  // sound much like it". A stays the core; each take adds a different cue of WOOD (the fibers tearing, a hollow body,
  // a splinter rattle), and A itself is a take, so whether a cue helps is heard, not assumed.
  "wood-break-2": { title: "Wood breaking, round 2 (built on your pick)", listen: "A wooden thing breaking: a crate, a plank, a door. Last round's pick was close but not wood. Which of these sounds most like WOOD breaking? (One of them is last round's pick again.)", takes: [
    { id: "round-1-pick", why: "last round's take A, unchanged: the plain gritty crack (the control).",
      patch: { wave: 19, impactTone: 0.35, impactDecay: 0.2, impactPunch: 0.9, impactGrit: 0.85, attack: 0.001, sustain: 0, decay: 0.1, release: 0.12, drive: 0.35, duration: 0.45 } },
    { id: "fiber-tear", why: "LAYERED: the crack plus a dense burst of tiny crackles under it: the grain tearing.",
      patch: stack({ wave: 19, impactTone: 0.35, impactDecay: 0.2, impactPunch: 0.9, impactGrit: 0.85, attack: 0.001, sustain: 0, decay: 0.1, release: 0.12, drive: 0.35, duration: 0.45 },
        [ly(click({ impactTone: 0.6, impactDecay: 0.01, impactGrit: 0.6, repeat: 9, rate: 70, duration: 0.15 }), 0.005, 0.55)]) },
    { id: "hollow-knock", why: "LAYERED: the crack plus a short, low hollow knock: wood resonating (a crate, a door).",
      patch: stack({ wave: 19, impactTone: 0.35, impactDecay: 0.2, impactPunch: 0.9, impactGrit: 0.85, attack: 0.001, sustain: 0, decay: 0.1, release: 0.12, drive: 0.35, duration: 0.45 },
        [ly(chime({ freq: 230, modalPartials: 4, modalInharm: 0.2, modalBright: 0.3, modalDecay: 0.14, reverb: 0, duration: 0.3 }), 0, 0.7)]) },
    { id: "dry-snap", why: "the crack made drier and sharper (higher tone, more grit and drive) with a bright snap on top: a plank splitting.",
      patch: stack({ wave: 19, impactTone: 0.5, impactDecay: 0.12, impactPunch: 1, impactGrit: 0.95, attack: 0.001, sustain: 0, decay: 0.07, release: 0.08, drive: 0.5, duration: 0.35 },
        [ly(noiseHit({ freq: 2500, filterMode: 1, cutoff: 2200, decay: 0.025, release: 0.03, duration: 0.08 }), 0, 0.5)]) },
    { id: "full-break", why: "LAYERED: the crack, the fibers tearing, the hollow knock and a short splinter rattle after: everything at once.",
      patch: stack({ wave: 19, impactTone: 0.35, impactDecay: 0.2, impactPunch: 0.9, impactGrit: 0.85, attack: 0.001, sustain: 0, decay: 0.1, release: 0.12, drive: 0.35, duration: 0.45 },
        [ly(click({ impactTone: 0.6, impactDecay: 0.01, impactGrit: 0.6, repeat: 9, rate: 70, duration: 0.15 }), 0.005, 0.45),
         ly(chime({ freq: 230, modalPartials: 4, modalInharm: 0.2, modalBright: 0.3, modalDecay: 0.14, reverb: 0, duration: 0.3 }), 0, 0.55),
         ly({ wave: 15, particleRate: 45, particleTone: 0.4, particleDecay: 0.18, particleSpread: 0.8, sustain: 1, attack: 0.003, release: 0.25, duration: 0.5 }, 0.08, 0.4)]) },
  ] },
  // ---- round 5 (2026-10-29): THE SPELL REDESIGN. AJ: with Spell selected "the casting layer sounds the same on all
  // magic". Today's wizard spell is swell + sparkle + <the material's layer> + thump for every material (the CURRENT take,
  // captured from the app into tools/ab-current-spells.json). The new designs FUSE: an ignition / attack, the element's
  // body and its tail, overlapping as one event, each in the element's own sound.
  ...SPELL_ROUNDS,
};

// ---- loudness: ITU BS.1770 (K-weighting, 400 ms blocks with 75% overlap, -70 LUFS absolute and -10 LU relative gates)
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

function take(patch) {
  const r = CS.render(Object.assign({}, CS.DEFAULTS, patch), { normalize: true });
  const L = Float32Array.from(r.L), R = Float32Array.from(r.R);
  let gn = Math.pow(10, (TARGET_LUFS - lufs(L, R)) / 20), pk = 0;
  for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i] * gn), Math.abs(R[i] * gn));
  if (pk > 0.95) gn *= 0.95 / pk;
  for (let i = 0; i < L.length; i++) { L[i] *= gn; R[i] *= gn; }
  return { L, R, lufs: lufs(L, R), sec: L.length / SR };
}
function run(name) {
  const round = ROUNDS[name];
  let seed = 0x5f3759df;
  for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  const order = round.takes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const out = join(ROOT, "soundtests", "ab-" + name), key = [];
  mkdirSync(out, { recursive: true });
  order.forEach((ti, slot) => {
    const t = round.takes[ti], r = take(t.patch), file = "take-" + "ABCDEFGH"[slot] + ".wav";
    writeFileSync(join(out, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
    key.push({ file, t, r });
    console.log("  " + file + "  " + r.sec.toFixed(2) + " s  " + r.lufs.toFixed(1) + " LUFS");
  });
  writeFileSync(join(out, "LISTEN.md"), "# " + round.title + "\n\n" + round.takes.length + " takes, `take-A.wav` to `take-" + "ABCDEFGH"[round.takes.length - 1] +
    ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order.\n\n" + round.listen + "\n\nSay the letter (and a runner-up if two are close). `KEY.md` says what each one is: **read it after listening.**\n");
  writeFileSync(join(out, "KEY.md"), "# " + round.title + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
    k.r.sec.toFixed(2) + " s, " + k.r.lufs.toFixed(1) + " LUFS\n\n```json\n" + JSON.stringify(k.t.patch) + "\n```\n").join("\n"));
  console.log("  -> " + out);
}
const want = process.argv[2];
if (!want) { console.log("rounds: " + Object.keys(ROUNDS).join(", ") + ", all"); process.exit(0); }
for (const n of want === "all" ? Object.keys(ROUNDS) : [want]) { if (!ROUNDS[n]) { console.error("no round " + n); process.exit(1); } console.log(n); run(n); }
