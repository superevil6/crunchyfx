/* chipgun.mjs — PROTOTYPE of a "chipgun" engine for CrunchySFX (the retro console gunshot: pistols, shotguns, full
 * auto, blasters), and the CLI that renders its blind listening round.
 *
 *   node tools/proto/chipgun.mjs              render every round into soundtests/proto-chipgun/<sound>/
 *   node tools/proto/chipgun.mjs pistol       one round
 *   node tools/proto/chipgun.mjs --cost       only the CPU cost: each take's model rendered 5x, ms per second of audio
 *
 * WHY. AJ built the suite because a generic retro SFX generator "couldn't make satisfying gunshot sounds": it draws white
 * noise and a square wave and crushes them. Today's console presets (Woodgrain Shot, Mega Shot, 8-Bit Hit) are exactly
 * that recipe. What made a console gunshot crunchy was never the bit depth of a white-noise burst; it was the HARDWARE and
 * the SOUND DRIVER: a shift-register noise channel whose clock the driver steps down every video frame (the "pshhh"), a
 * 4-bit volume written once a frame (audible stairs), a triangle kick whose pitch is rewritten per frame, a mixer that
 * ducks one channel under another, FM operators fed back on themselves until they turn to grit, compressed 4-bit samples
 * played back at the wrong pitch, and ONE noise channel, so an automatic weapon cuts its own tail every round. This builds
 * those, as three machines described by their sound:
 *
 *   8-bit chip     two pulse channels, a triangle and a noise channel. (Modelled on the 2A03: CPU clock 1.789773 MHz.)
 *                  NOISE: a 15-bit LFSR, long mode (taps 0,1: 32767 steps, hiss) or short mode (taps 0,6: 93 steps, a
 *                  metallic buzz), clocked from the 16-entry period table; output 0 or the 4-bit volume. TRIANGLE: the
 *                  32-step staircase, no volume control (on or off only; a halted triangle HOLDS its step, so the kick
 *                  ends on a DC step the output capacitor drains: the "thunk"), its linear counter at 240 Hz. PULSE: 12.5 /
 *                  25 / 50 % duty, 4-bit volume, and the hardware sweep unit (period += period >> shift every P+1
 *                  half-frames, muting past 0x7FF). MIXER: the chip's own nonlinear DAC formulas (pulse 95.88 / (8128 / sum
 *                  + 100); triangle + noise 159.79 / (1 / (t / 8227 + n / 12241) + 100)), so a loud noise burst squashes the
 *                  triangle under it. OUTPUT: a 40 Hz and a 14 kHz one-pole (the console's output stage, the later-model
 *                  filtering; the 440 Hz high-pass of the other model would delete the kick).
 *   FM chip        four-operator FM synthesis and a square-wave noise chip beside it. (Modelled on the YM2612 + SN76489.)
 *                  FM at the chip's own 53 267 Hz: a 10-bit phase into a log-sine table and an exponential table (the
 *                  chip's own quantization: 13-bit magnitude, envelope in 0.094 dB steps), operator 1 fed back on itself
 *                  (feedback 7 turns it to chaotic grit: the "crunchy noise"), modulation as phase offsets up to ~25 rad,
 *                  each channel through a 9-bit DAC with the crossover step (the "ladder" offset) while it sounds, then to
 *                  44.1 kHz by linear interpolation with no anti-alias filter. NOISE CHIP: a 16-bit LFSR (taps 0,3; white
 *                  or periodic: a 1/16 pulse, a buzz) clocked at 3.58 MHz / 32N with N from the third tone channel, so a
 *                  driver can sweep it; volume as 4-bit ATTENUATION in 2 dB steps (logarithmic, unlike the 8-bit chip's).
 *   16-bit sampler a sample player. (Modelled on the S-DSP.) The gun is a "recording" made by this engine's own clean
 *                  synthesis (crack, a band of noise falling as it decays, a sine boom, a metal ring), then stored the way a
 *                  cartridge stored it: decimated to a low rate with no filter (aliasing), encoded as 4-bit ADPCM (BRR: 16
 *                  samples a block, a shift 0-12 and one of four predictors per block, the encoder choosing the least
 *                  error), played back by pitch register (heavier calibers play the same sample lower, the trick games
 *                  used), through the 4-tap gaussian interpolator (approximated) or, at high Crunch, none (drop-sample
 *                  stairs), at 32 kHz, 7-bit voice volume, the hardware echo (16 ms steps, an
 *                  8-tap FIR, feedback), and to 44.1 kHz by hold (imaging) or linear interpolation.
 *
 * THE SOUND DRIVER. All three are driven the way a game drove them: a script of register writes once per 60 Hz frame.
 * Rounds are fired ON FRAMES (a rate of 13/s becomes "every 5 frames" = 12/s: the machine-exact feel of automatic fire),
 * every round restarts the script on the same channel (a TRUE re-trigger: the previous round's tail is CUT, its echo too;
 * the noise channel is always one), and `cgVoices` lets the pulse / FM / sampler parts rotate over 1-4 channels so a tail
 * may ring under the next round. Per-shot variation is what drivers did: the start noise period a step up or down, the
 * volume a step down, the pitch a few percent, the sample pitch register nudged. The 8-bit noise LFSR free-runs (it is never
 * reset), so every round's grain differs. A software echo (`cgEcho`, 8-bit and FM) is the driver replaying the shot quieter
 * after it ends, on the same channel; on the sampler it is the hardware echo.
 *
 * CRUNCH. The machines' own quantization is always on (4-bit volumes, the 9-bit DAC, BRR). `cgCrunch` adds the "wrong
 * conversion": a sample-and-hold to 44.1 kHz / 2^(3 crunch) (5.5 kHz at 1, a fractional ratio, so content folds DOWN: real
 * aliasing) and a bit depth of 16 - 11 crunch (5 bits at 1), after the output is set to peak 0.9. On the sampler Crunch
 * lowers the STORAGE rate instead (32 kHz / 2^(2.5 crunch)) and, from 0.5, drops the interpolator and holds the output.
 *
 * PORTABLE SHAPE. `makeChipgun(sr, cfg, seed)` is a pure factory like dsp.js makeBlast / makeGlass: no DOM, no Math.random
 * (a seeded hash per decision), SR in, BUFFERED (mono, written to L and R), returning { L, R, n, info, tick(drive, out) }.
 * `chipgunCfg(st)` maps the proposed rows (CHIPGUN_PARAMS) to the drivers; `chipgunLevel(L, R)` levels a buffer like
 * glassLevel. Rendered at 44.1 kHz only (the chips' clocks are integrated per output sample; the FM chip at its own rate).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

export const CG_CONSOLES = ["8-bit chip", "FM chip", "16-bit sampler"];   // append-only (stored as an index)
// Proposed PARAMS rows: [key, label, min, max, step, default, unit, group, kind?, enumList?]. Only wave "chipgun" reads the
// group, so no existing preset moves. Defaults: one 8-bit pistol round.
export const CHIPGUN_PARAMS = [
  ["cgConsole", "Console",      0, 2,   1,    0,    "",   "Chip gun", "enum", CG_CONSOLES],
  ["cgCaliber", "Caliber",      0, 1,   0.01, 0.35, "",   "Chip gun"],   // a small pistol .. a cannon: darker, longer, lower kick
  ["cgSnap",    "Snap",         0, 1,   0.01, 0.6,  "",   "Chip gun"],   // the first frame: brightest noise + a falling pulse pop
  ["cgThump",   "Thump",        0, 1,   0.01, 0.6,  "",   "Chip gun"],   // the kick under it (triangle / FM sine / sampled boom)
  ["cgSweep",   "Noise sweep",  0, 1,   0.01, 0.5,  "",   "Chip gun"],   // how far the hiss falls through the shot (the "pshhh")
  ["cgLength",  "Length",       0, 1,   0.01, 0.5,  "",   "Chip gun"],   // 0.5x .. 2x the caliber's length
  ["cgMetal",   "Metal",        0, 1,   0.01, 0,    "",   "Chip gun"],   // a metallic ring: periodic noise frames, inharmonic FM, a ring
  ["cgZap",     "Zap",          0, 1,   0.01, 0,    "",   "Chip gun"],   // gunpowder .. a blaster: a falling tone takes over the noise
  ["cgEcho",    "Echo",         0, 1,   0.01, 0,    "",   "Chip gun"],   // the driver's replay (8-bit, FM) / the hardware echo (sampler)
  ["cgCrunch",  "Crunch",       0, 1,   0.01, 0.25, "",   "Chip gun"],   // rate and bit reduction with real aliasing
  ["cgRate",    "Rate",         2, 30,  0.1,  12,   "/s", "Chip gun"],   // rounds a second, fired on 60 Hz frames (so quantized)
  ["cgRounds",  "Rounds",       1, 40,  1,    1,    "",   "Chip gun"],
  ["cgVary",    "Per-shot variation", 0, 1, 0.01, 0.3, "", "Chip gun"],
  ["cgVoices",  "Channels",     1, 4,   1,    1,    "",   "Chip gun"],   // 1: every round cuts the last; more: tails ring under
  ["cgSeed",    "Variation",    0, 999, 1,    0,    "",   "Chip gun"],
];
export const CHIPGUN_DEFAULTS = Object.fromEntries(CHIPGUN_PARAMS.map((p) => [p[0], p[5]]));

const CG_FPS = 60;                                       // the driver's frame rate (NTSC vertical blank)
const CG_CPU = 1789773;                                  // 8-bit chip clock (2A03, NTSC)
const CG_NOISE_PER = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];   // CPU cycles per LFSR clock
const CG_DUTY = [[0, 1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0, 0]];
const CG_TRI = Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 - i : i - 16));
const CG_FM_RATE = 7670453 / 144;                        // FM chip sample rate (YM2612, NTSC): 53 267 Hz
const CG_PSG_CLK = 3579545;                              // noise chip clock (SN76489, NTSC)
const CG_SMP_RATE = 32000;                               // sampler output rate (S-DSP)
const CG_LEAD = 0.004;                                   // s of silence before the first round

const cgClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// one seeded decision: hash of the integers given, in [0, 1)
function cgHash(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) { h = Math.imul(h ^ (x | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function cgRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// one-pole filters in place
function cgHP(x, sr, fc) {
  const a = Math.exp(-2 * Math.PI * fc / sr); let px = x[0], py = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; py = a * (py + v - px); px = v; x[i] = py; }
}
function cgLP(x, sr, fc) {
  const a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr); let y = x[0];
  for (let i = 0; i < x.length; i++) { y = x[i] + (y - x[i]) * a; x[i] = y; }
}

// knobs -> drivers
export function chipgunCfg(st) {
  const g = (k) => (st[k] == null ? CHIPGUN_DEFAULTS[k] : st[k]);
  const fpr = cgClamp(Math.round(CG_FPS / cgClamp(g("cgRate"), 2, 30)), 2, 30);   // frames per round
  return {
    "dur": st.duration || 0.6,
    "console": cgClamp(Math.round(g("cgConsole")), 0, CG_CONSOLES.length - 1),
    "cal": cgClamp(g("cgCaliber"), 0, 1), "snap": cgClamp(g("cgSnap"), 0, 1), "thump": cgClamp(g("cgThump"), 0, 1),
    "sweep": cgClamp(g("cgSweep"), 0, 1), "lenMul": Math.pow(2, 2 * cgClamp(g("cgLength"), 0, 1) - 1),
    "metal": cgClamp(g("cgMetal"), 0, 1), "zap": cgClamp(g("cgZap"), 0, 1), "echo": cgClamp(g("cgEcho"), 0, 1),
    "crunch": cgClamp(g("cgCrunch"), 0, 1), "fpr": fpr, "rate": CG_FPS / fpr,
    "rounds": cgClamp(Math.round(g("cgRounds")), 1, 40), "vary": cgClamp(g("cgVary"), 0, 1),
    "voices": cgClamp(Math.round(g("cgVoices")), 1, 4), "seed": Math.round(g("cgSeed")),
  };
}

// the rounds: frame, index, and the per-shot variation draws (what a driver randomized)
function cgShots(cfg, seed, F) {
  const out = [], lead = Math.round(CG_LEAD * CG_FPS);
  for (let k = 0; k < cfg["rounds"]; k++) {
    const frame = lead + k * cfg["fpr"]; if (frame >= F) break;
    const v = cfg["vary"], h = (s) => cgHash(seed, cfg["seed"], k, s);
    const u0 = h(1);
    out.push({ k, frame,
      dIdx: k === 0 ? 0 : (u0 < v * 0.4 ? -1 : u0 > 1 - v * 0.4 ? 1 : 0),       // noise start period a step up / down
      vScale: k === 0 ? 1 : 1 - v * 0.2 * h(2),                                 // volume a step or two down
      dPitch: k === 0 ? 0 : (h(3) * 2 - 1) * 0.06 * v,                          // pitch +-6 % at full variation
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// 8-BIT CHIP
// ---------------------------------------------------------------------------------------------------------------------
// the sweep unit's (shift, period) nearest to a wanted per-half-frame pitch ratio (the hardware can only do these)
function cg8SweepFor(ratio) {
  let best = [3, 0], be = Infinity;
  for (let s = 2; s <= 7; s++) for (let p = 0; p <= 2; p++) {
    const r = Math.pow(1 + Math.pow(2, -s), 1 / (p + 1)), e = Math.abs(Math.log(r / ratio));
    if (e < be) { be = e; best = [s, p]; }
  }
  return best;
}
// the driver: per-frame (noise), per-quarter-frame (triangle) and per-half-frame (pulse) register timelines
function cg8Timeline(cfg, shots, F) {
  const T = {
    nVol: new Uint8Array(F), nIdx: new Uint8Array(F), nMode: new Uint8Array(F),
    tri: new Int32Array(F * 4).fill(-1),
    pPer: [new Int32Array(F * 2).fill(-1), new Int32Array(F * 2).fill(-1)],
    pVol: [new Uint8Array(F * 2), new Uint8Array(F * 2)], pDuty: [new Uint8Array(F * 2), new Uint8Array(F * 2)],
    trace: null,
  };
  const c = cfg["cal"], snap = cfg["snap"], zap = cfg["zap"], noiseLvl = 1 - 0.85 * zap, lm = cfg["lenMul"];
  const clearPulse = (p, from) => { T.pPer[p].fill(-1, from * 2); T.pVol[p].fill(0, from * 2); };
  for (const sh of shots) {
    const s = sh.frame, tr = { noiseIdx: [], noiseVol: [], triHz: [], zapHz: [], popHz: [] };
    // NOISE (one channel: the round steals it, cutting the last round and its echo)
    T.nVol.fill(0, s);
    const L = Math.max(2, Math.round((6 + 26 * c) * lm * (1 - 0.55 * zap)));
    const start = cgClamp(Math.round(2 + 9 * c) + sh.dIdx, 0, 15), nMetal = Math.round(cfg["metal"] * 3);
    const nv = [], ni = [];
    for (let k = 0; k < L; k++) {
      const u = k / L;
      let vol = 15 * noiseLvl * sh.vScale * Math.exp(-k / (L * 0.3)), idx = start + Math.round(cfg["sweep"] * (15 - start) * Math.pow(u, 0.7));
      if (k === 0) { vol = 15 * Math.min(1, noiseLvl + 0.5 * snap) * sh.vScale; idx = Math.max(0, start - Math.round(snap * 5)); }
      nv.push(cgClamp(Math.round(vol), 0, 15)); ni.push(cgClamp(idx, 0, 15));
    }
    for (let k = 0; k < L && s + k < F; k++) { T.nVol[s + k] = nv[k]; T.nIdx[s + k] = ni[k]; T.nMode[s + k] = k < nMetal ? 1 : 0; }
    if (cfg["echo"] > 0) {                     // the driver replays the shot quieter once it is done
      const D = L + Math.round(2 + 4 * cfg["echo"]), g = 0.25 + 0.25 * cfg["echo"];
      for (let k = 0; k < L && s + D + k < F; k++) { const f = s + D + k; T.nVol[f] = Math.max(T.nVol[f], Math.round(nv[k] * g)); T.nIdx[f] = Math.min(15, ni[k] + 1); T.nMode[f] = 0; }
    }
    tr.noiseIdx = ni; tr.noiseVol = nv;
    // TRIANGLE kick: pitch rewritten per frame, length in quarter-frames (its linear counter)
    T.tri.fill(-1, s * 4);
    if (cfg["thump"] > 0) {
      const Q = Math.max(1, Math.round(cfg["thump"] * (12 + 24 * c) * lm)), TF = Math.ceil(Q / 4);
      const f0 = (170 - 100 * c) * (1 + sh.dPitch), f1 = 45 - 10 * c;
      for (let k = 0; k < TF; k++) {
        const f = f0 * Math.pow(f1 / f0, TF > 1 ? k / (TF - 1) : 0), t = Math.round(CG_CPU / (32 * f) - 1);
        tr.triHz.push(Math.round(CG_CPU / (32 * (t + 1))));
        for (let q = 0; q < 4; q++) { const qq = k * 4 + q; if (qq < Q && (s * 4 + qq) < F * 4) T.tri[s * 4 + qq] = t; }
      }
    }
    // PULSE pop (the snap's body: a 50 % pulse dropping fast through the sweep unit, two frames) on pulse 1,
    // ZAP (the blaster's "pew": a 12.5 % pulse falling through the sweep unit) on pulse 2, or rotating over both
    const zapCh = cfg["voices"] >= 2 ? (sh.k % 2 === 0 ? 1 : 0) : 1;
    if (snap > 0 && !(zap > 0 && zapCh === 0)) {
      clearPulse(0, s);
      let t = Math.round(CG_CPU / (16 * (1200 - 600 * c) * (1 + sh.dPitch)) - 1);
      for (let h = 0; h < 4 && s * 2 + h < F * 2; h++) {
        T.pPer[0][s * 2 + h] = t; T.pVol[0][s * 2 + h] = Math.round((h < 2 ? 12 : 6) * snap); T.pDuty[0][s * 2 + h] = 2;
        tr.popHz.push(Math.round(CG_CPU / (16 * (t + 1)))); t += t >> 1;
      }
    }
    if (zap > 0) {
      clearPulse(zapCh, s);
      const ZL = Math.max(2, Math.round((7 + 12 * c) * lm));
      const fz = 1800 * Math.pow(2, -1.5 * c) * (1 + sh.dPitch), oct = 1 + 3 * cfg["sweep"];
      const [shift, per] = cg8SweepFor(Math.pow(2, oct / (2 * ZL)));
      let t = Math.round(CG_CPU / (16 * fz) - 1);
      for (let h = 0; h < ZL * 2 && s * 2 + h < F * 2; h++) {
        if (t > 0x7ff) break;                            // the sweep unit mutes past the top of the period
        T.pPer[zapCh][s * 2 + h] = t; T.pVol[zapCh][s * 2 + h] = Math.round(15 * zap * sh.vScale * (1 - (h >> 1) / ZL)); T.pDuty[zapCh][s * 2 + h] = 0;
        if (h % 2 === 0) tr.zapHz.push(Math.round(CG_CPU / (16 * (t + 1))));
        if ((h + 1) % (per + 1) === 0) t += t >> shift;
      }
      tr.zapSweep = "shift " + shift + ", every " + (per + 1) + " half-frames";
    }
    if (!T.trace) T.trace = tr;
  }
  return T;
}
// the chip: every channel's timer run in CPU cycles and box-averaged over each output sample, then the nonlinear mixer
function cg8Render(sr, n, T, lfsrSeed) {
  const out = new Float64Array(n), cyc = CG_CPU / sr, F = T.nVol.length;
  let lfsr = (lfsrSeed & 0x7fff) || 1, nTim = 1, triStep = 0, triTim = 1;
  const pSeq = [0, 0], pTim = [1, 1];
  for (let i = 0; i < n; i++) {
    const tt = i / sr, fr = Math.min(F - 1, Math.floor(tt * CG_FPS)), qf = Math.min(F * 4 - 1, Math.floor(tt * CG_FPS * 4)), hf = Math.min(F * 2 - 1, Math.floor(tt * CG_FPS * 2));
    // noise
    const nP = CG_NOISE_PER[T.nIdx[fr]], tap = T.nMode[fr] ? 6 : 1, nVol = T.nVol[fr];
    let rem = cyc, acc = 0;
    while (rem > 0) {
      const st = Math.min(rem, nTim);
      if (!(lfsr & 1)) acc += st;
      nTim -= st; rem -= st;
      if (nTim <= 1e-9) { const fb = (lfsr ^ (lfsr >> tap)) & 1; lfsr = (lfsr >> 1) | (fb << 14); nTim += nP; }
    }
    const nz = nVol * acc / cyc;
    // triangle (halted = holds its step)
    const tP = T.tri[qf];
    let tri;
    if (tP >= 2) {
      rem = cyc; acc = 0;
      while (rem > 0) { const st = Math.min(rem, triTim); acc += CG_TRI[triStep] * st; triTim -= st; rem -= st; if (triTim <= 1e-9) { triStep = (triStep + 1) & 31; triTim += tP + 1; } }
      tri = acc / cyc;
    } else tri = CG_TRI[triStep];
    // pulses (the timer is clocked at CPU / 2)
    let pSum = 0;
    for (let p = 0; p < 2; p++) {
      const pP = T.pPer[p][hf], v = T.pVol[p][hf];
      if (pP < 8 || pP > 0x7ff || v === 0) continue;
      const duty = CG_DUTY[T.pDuty[p][hf]], len = 2 * (pP + 1);
      rem = cyc; acc = 0;
      while (rem > 0) { const st = Math.min(rem, pTim[p]); acc += duty[pSeq[p]] * st; pTim[p] -= st; rem -= st; if (pTim[p] <= 1e-9) { pSeq[p] = (pSeq[p] + 7) & 7; pTim[p] += len; } }
      pSum += v * acc / cyc;
    }
    const pOut = pSum > 0 ? 95.88 / (8128 / pSum + 100) : 0;
    const tn = tri / 8227 + nz / 12241, tnOut = tn > 0 ? 159.79 / (1 / tn + 100) : 0;
    out[i] = pOut + tnOut;
  }
  cgHP(out, sr, 40); cgLP(out, sr, 14000);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// FM CHIP (+ its noise chip)
// ---------------------------------------------------------------------------------------------------------------------
const CG_LOGSIN = Array.from({ length: 256 }, (_, i) => Math.round(-Math.log2(Math.sin((i + 0.5) * Math.PI / 512)) * 256));
const CG_EXP = Array.from({ length: 256 }, (_, i) => Math.round((Math.pow(2, i / 256) - 1) * 1024));
// one operator's output: 10-bit phase, attenuation in 10-bit envelope units (0.094 dB) -> 14-bit signed
function cgOp(phase10, att10) {
  const q = phase10 & 255, idx = (phase10 & 256) ? 255 - q : q;
  const a = CG_LOGSIN[idx] + (Math.min(1023, att10) << 2);
  const mag = a >= 13 * 256 ? 0 : ((CG_EXP[~a & 255] | 0x400) << 2) >> (a >> 8);
  return (phase10 & 512) ? -mag : mag;
}
function cgFmTimeline(cfg, shots, F) {
  const nCh = Math.min(2, cfg["voices"]);
  const mkCh = () => ({ kon: new Uint8Array(F), on: new Uint8Array(F), fc: new Float32Array(F), rm: new Float32Array(F).fill(1),
    tlm: new Uint8Array(F).fill(127), tlc: new Uint8Array(F).fill(127), fb: new Uint8Array(F), dc: new Float32Array(F), dm: new Float32Array(F) });
  const T = { crunch: Array.from({ length: nCh }, mkCh), thump: Array.from({ length: nCh }, mkCh), zap: Array.from({ length: nCh }, mkCh),
    psgN: new Uint16Array(F).fill(1), psgA: new Uint8Array(F).fill(15), psgMode: new Uint8Array(F), trace: null };
  const c = cfg["cal"], snap = cfg["snap"], zap = cfg["zap"], noiseLvl = 1 - 0.85 * zap, lm = cfg["lenMul"];
  const tlOf = (g) => cgClamp(Math.round(-20 * Math.log10(Math.max(1e-4, g)) / 0.75), 0, 127);
  const clear = (ch, s) => { ch.kon.fill(0, s); ch.on.fill(0, s); };
  const write = (ch, f, o) => { if (f >= F) return; ch.on[f] = 1; ch.fc[f] = o.fc; ch.rm[f] = o.rm; ch.tlm[f] = o.tlm; ch.tlc[f] = o.tlc; ch.fb[f] = o.fb; ch.dc[f] = o.dc; ch.dm[f] = o.dm; };
  for (const sh of shots) {
    const s = sh.frame, v = sh.k % nCh, tr = { crunchHz: [], psgShiftHz: [], psgAtt: [], thumpHz: [], zapHz: [] };
    const L = Math.max(2, Math.round((6 + 26 * c) * lm * (1 - 0.55 * zap)));
    // crunch channel: op1 (feedback 7) -> op2; the carrier frequency stepped down per frame (the falling grit)
    const A = T.crunch[v]; clear(A, s); A.kon[s] = 1;
    const fA0 = (700 - 450 * c) * (1 + sh.dPitch), rm = 1 + 2.53 * cfg["metal"], tlA = tlOf(noiseLvl * sh.vScale);
    const crunchFr = (k, extraTl) => {
      const u = k / L, fc = fA0 * Math.pow(2, -cfg["sweep"] * 2.5 * Math.pow(u, 0.7)) * (k === 0 ? 1 + snap : 1);
      return { fc, rm, tlm: k === 0 ? Math.round(4 * (1 - snap)) : Math.round(4 + 22 * u), tlc: Math.min(127, tlA + extraTl), fb: 7, dc: 42 / (L / CG_FPS), dm: 20 / (L / CG_FPS) };
    };
    for (let k = 0; k < L; k++) { const o = crunchFr(k, 0); write(A, s + k, o); if (k < 8) tr.crunchHz.push(Math.round(o.fc)); }
    // noise chip: shift rate from the third tone channel's N, attenuation in 2 dB steps
    T.psgA.fill(15, s);
    const N0 = Math.max(1, Math.round((1 + 7 * c) * (1 + sh.dIdx * 0.3))), nMetal = Math.round(cfg["metal"] * 3);
    const psgFr = (k) => {
      const u = k / L;
      if (k === 0) return [Math.max(1, Math.round(N0 * (1 - snap))), Math.round((1 - noiseLvl) * 4)];
      return [cgClamp(Math.round(N0 * Math.pow(2, cfg["sweep"] * 5 * Math.pow(u, 0.7))), 1, 1023), cgClamp(Math.round(u * 13 + (1 - noiseLvl) * 6 + (1 - sh.vScale) * 10), 0, 15)];
    };
    for (let k = 0; k < L && s + k < F; k++) {
      const [N, a] = psgFr(k); T.psgN[s + k] = N; T.psgA[s + k] = a; T.psgMode[s + k] = k < nMetal ? 1 : 0;
      tr.psgShiftHz.push(Math.round(CG_PSG_CLK / (32 * N))); tr.psgAtt.push(a);
    }
    if (cfg["echo"] > 0) {                      // the driver replays it quieter, re-keying the same channel
      const D = L + Math.round(2 + 4 * cfg["echo"]), extra = Math.round(8 + 10 * (1 - cfg["echo"]));
      if (s + D < F) A.kon[s + D] = 1;
      for (let k = 0; k < L; k++) {
        write(A, s + D + k, crunchFr(k, extra));
        if (s + D + k < F) { const [N, a] = psgFr(k); T.psgN[s + D + k] = Math.min(1023, N + 1); T.psgA[s + D + k] = Math.min(15, a + 3); T.psgMode[s + D + k] = 0; }
      }
    }
    // thump channel: op3 (a knock on the first frame) -> op4 sine, pitch rewritten per frame
    const B = T.thump[v]; clear(B, s);
    if (cfg["thump"] > 0) {
      B.kon[s] = 1;
      const TF = Math.max(1, Math.round(cfg["thump"] * (4 + 8 * c) * lm)), f0 = (160 - 90 * c) * (1 + sh.dPitch), f1 = 42;
      for (let k = 0; k <= TF; k++) {
        const fc = f0 * Math.pow(f1 / f0, Math.min(1, k / TF));
        write(B, s + k, { fc, rm: 1, tlm: k === 0 ? 6 : 40, tlc: tlOf(Math.min(1, 0.4 + 0.6 * cfg["thump"]) * sh.vScale), fb: 0, dc: 30 / (TF / CG_FPS), dm: 120 });
        tr.thumpHz.push(Math.round(fc));
      }
    }
    // zap channel: op5 (ratio 2, some feedback) -> op6, falling per frame, the index closing
    const Z = T.zap[v]; clear(Z, s);
    if (zap > 0) {
      Z.kon[s] = 1;
      const ZL = Math.max(2, Math.round((7 + 12 * c) * lm)), fz = 1800 * Math.pow(2, -1.5 * c) * (1 + sh.dPitch), oct = 1 + 3 * cfg["sweep"];
      for (let k = 0; k < ZL; k++) {
        const fc = fz * Math.pow(2, -oct * k / ZL);
        write(Z, s + k, { fc, rm: 2, tlm: Math.round(10 + 30 * k / ZL), tlc: tlOf(zap * sh.vScale), fb: 3 + Math.round(cfg["metal"] * 4), dc: 24 / (ZL / CG_FPS), dm: 0 });
        tr.zapHz.push(Math.round(fc));
      }
    }
    if (!T.trace) T.trace = tr;
  }
  return T;
}
function cgFmRender(sr, n, T, seed) {
  const nat = Math.ceil(n * CG_FM_RATE / sr) + 2, buf = new Float64Array(nat), F = T.psgN.length;
  const chans = [].concat(T.crunch, T.thump, T.zap).map((tl) => ({ tl, pm: 0, pc: 0, am: 1023 * 0.09375, ac: 1023 * 0.09375, m1: 0, m2: 0, live: false, lastFr: -1 }));
  let lfsr = 0x8000 | (seed & 0x7fff), psgPh = 0, prevMode = 0;
  const RELEASE = 400;                                   // dB/s after key-off
  for (let j = 0; j < nat; j++) {
    const fr = Math.min(F - 1, Math.floor(j / CG_FM_RATE * CG_FPS));
    let fm = 0;
    for (const ch of chans) {
      const tl = ch.tl;
      if (fr !== ch.lastFr) { ch.lastFr = fr; if (tl.kon[fr]) { ch.am = 0; ch.ac = 0; ch.pm = 0; ch.pc = 0; ch.m1 = 0; ch.m2 = 0; ch.live = true; } }
      if (!ch.live) { fm += 4; continue; }
      const on = tl.on[fr];
      ch.ac += (on ? tl.dc[fr] : RELEASE) / CG_FM_RATE; ch.am += (on ? tl.dm[fr] : RELEASE) / CG_FM_RATE;
      const ac = Math.floor(ch.ac / 0.09375), am = Math.floor(ch.am / 0.09375);
      if (ac >= 1023 && !on) { ch.live = false; fm += 4; continue; }
      const fc = tl.fc[fr], fb = tl.fb[fr];
      ch.pm += fc * tl.rm[fr] / CG_FM_RATE; ch.pm -= Math.floor(ch.pm);
      ch.pc += fc / CG_FM_RATE; ch.pc -= Math.floor(ch.pc);
      const fbIn = fb > 0 ? (ch.m1 + ch.m2) >> (10 - fb) : 0;
      const om = cgOp((Math.floor(ch.pm * 1024) + fbIn) & 1023, am + tl.tlm[fr] * 8);
      ch.m2 = ch.m1; ch.m1 = om;
      const oc = cgOp((Math.floor(ch.pc * 1024) + (om >> 1)) & 1023, ac + tl.tlc[fr] * 8);
      // the 9-bit DAC with its crossover step while the channel sounds
      const v9 = oc >> 5;
      fm += v9 + (v9 >= 0 ? 4 : -4);
    }
    // noise chip
    const N = T.psgN[fr], a = T.psgA[fr], mode = T.psgMode[fr];
    if (mode !== prevMode) { lfsr = 0x8000; prevMode = mode; }   // writing the noise register resets the shift register
    psgPh += CG_PSG_CLK / (32 * N) / CG_FM_RATE;
    while (psgPh >= 1) { psgPh -= 1; const fbit = mode ? (lfsr & 1) : ((lfsr ^ (lfsr >> 3)) & 1); lfsr = (lfsr >> 1) | (fbit << 15); }
    const psg = a >= 15 ? 0 : ((lfsr & 1) ? 1 : -1) * Math.pow(10, -2 * a / 20);
    buf[j] = fm / 512 + psg * 0.45;
  }
  // to 44.1 kHz by linear interpolation, no anti-alias filter (what folds, folds)
  const out = new Float64Array(n), step = CG_FM_RATE / sr;
  for (let i = 0; i < n; i++) { const p = i * step, k = Math.floor(p), f = p - k; out[i] = buf[k] + (buf[k + 1] - buf[k]) * f; }
  cgHP(out, sr, 20); cgLP(out, sr, 12000);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// 16-BIT SAMPLER
// ---------------------------------------------------------------------------------------------------------------------
// the "recording": this engine's own clean synthesis of the gun, at the sampler's 32 kHz
function cgSource(cfg, seed) {
  const sr = CG_SMP_RATE, c = cfg["cal"], lm = cfg["lenMul"], zap = cfg["zap"], noiseLvl = 1 - 0.85 * zap, rnd = cgRng(seed ^ 0x51ed270b);
  const Tb = (0.04 + 0.2 * c) * lm * (1 - 0.5 * zap), len = Math.ceil(sr * Math.max(Tb * 2.2, zap > 0 ? (0.13 + 0.2 * c) * lm : 0, 0.05 + 0.25 * c * cfg["thump"]) + 0.01 * sr);
  const x = new Float64Array(len);
  const fb0 = 2000 - 1300 * c, tauB = Tb / 3, sweep = cfg["sweep"];
  let lp = 0, bp = 0, brown = 0, hpPrev = 0, hp = 0, boomPh = 0, zapPh = 0;
  const qD = 1 / 0.9;                                    // SVF damping (Q 0.9)
  for (let i = 0; i < len; i++) {
    const t = i / sr, w = rnd() * 2 - 1;
    // crack: the first 1.5 ms, high-passed noise
    hp = 0.97 * (hp + w - hpPrev); hpPrev = w;
    let v = t < 0.0015 ? hp * 1.4 * cfg["snap"] * (1 - t / 0.0015) : 0;
    // body: a band of noise whose center falls as it decays (the "pshhh")
    const fc = fb0 * Math.pow(2, -sweep * 2.2 * Math.min(1, t / Tb)), f = 2 * Math.sin(Math.PI * Math.min(fc, 0.2 * sr) / sr);
    lp += f * bp; const hpS = w - lp - qD * bp; bp += f * hpS;
    const envB = (t < 0.001 ? t / 0.001 : 1) * Math.exp(-t / tauB);
    brown = brown * 0.985 + w * 0.015;
    v += (bp * 2.2 + brown * 4 * Math.exp(-t / (tauB * 2))) * envB * noiseLvl;
    // boom
    if (cfg["thump"] > 0) { const ft = 45 + ((160 - 90 * c) - 45) * Math.exp(-t / 0.02); boomPh += ft / sr; v += Math.sin(2 * Math.PI * boomPh) * Math.exp(-t / (0.025 + 0.06 * c)) * 0.45 * cfg["thump"]; }
    // metal ring
    if (cfg["metal"] > 0) v += (Math.sin(2 * Math.PI * 3150 * t) + 0.7 * Math.sin(2 * Math.PI * 4480 * t) + 0.5 * Math.sin(2 * Math.PI * 5620 * t)) * Math.exp(-t / 0.03) * 0.25 * cfg["metal"];
    // zap: a falling chirp with its own second harmonic
    if (zap > 0) {
      const Zt = (0.13 + 0.2 * c) * lm, fz = 1800 * Math.pow(2, -1.5 * c) * Math.pow(2, -(1 + 3 * sweep) * Math.min(1, t / Zt));
      zapPh += fz / sr;
      if (t < Zt) v += (Math.sin(2 * Math.PI * zapPh) + 0.45 * Math.sin(4 * Math.PI * zapPh + 0.8 * Math.sin(2 * Math.PI * zapPh))) * (1 - t / Zt) * 0.8 * zap;
    }
    x[i] = v;
  }
  let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(x[i]));
  for (let i = 0; i < len; i++) x[i] *= 0.9 / (pk || 1);
  return x;
}
// BRR: 4-bit ADPCM, 16 samples a block, shift 0..12 and predictor 0..3 chosen per block. Returns the DECODED sample (ints).
function cgBrr(x) {
  const n = Math.ceil(x.length / 16) * 16, pcm = new Float64Array(n), out = new Int16Array(n);
  for (let i = 0; i < x.length; i++) pcm[i] = cgClamp(Math.round(x[i] * 16383), -16384, 16383);
  const pred = (f, p1, p2) => (f === 0 ? 0 : f === 1 ? p1 * 15 / 16 : f === 2 ? p1 * 61 / 32 - p2 * 15 / 16 : p1 * 115 / 64 - p2 * 13 / 16);
  let p1 = 0, p2 = 0, blocks = 0; const use = [0, 0, 0, 0];
  for (let b = 0; b < n; b += 16) {
    let best = null;
    for (let f = 0; f < 4; f++) for (let sh = 0; sh <= 12; sh++) {
      let a1 = p1, a2 = p2, err = 0; const dec = new Int16Array(16);
      for (let k = 0; k < 16; k++) {
        const pr = pred(f, a1, a2), nib = cgClamp(Math.round((pcm[b + k] - pr) * 2 / Math.pow(2, sh)), -8, 7);
        const y = cgClamp(Math.round(nib * Math.pow(2, sh) / 2 + pr), -16384, 16383);
        dec[k] = y; err += (y - pcm[b + k]) * (y - pcm[b + k]); a2 = a1; a1 = y;
        if (best && err >= best.err) break;
      }
      if (!best || err < best.err) best = { err, dec, f };
    }
    out.set(best.dec, b); p1 = best.dec[15]; p2 = best.dec[14]; blocks++; use[best.f]++;
  }
  return { pcm: out, blocks, use };
}
function cgSamplerRender(sr, n, cfg, shots, seed) {
  const src = cgSource(cfg, seed), cr = cfg["crunch"];
  const store = Math.round(CG_SMP_RATE * Math.pow(2, -2.5 * cr));
  // the cartridge's tool: decimate with a 2-tap average only (the rest folds), then BRR
  const ratio = CG_SMP_RATE / store, m = Math.floor(src.length / ratio), dec = new Float64Array(m);
  for (let i = 0; i < m; i++) { const p = i * ratio, k = Math.floor(p); dec[i] = (src[k] + (src[Math.min(src.length - 1, k + 1)] || 0)) / 2; }
  const brr = cgBrr(dec), smp = brr.pcm;
  const gauss = cr < 0.5, hold = cr >= 0.5, SIG = 0.63;
  const basePitch = (store / CG_SMP_RATE) * Math.pow(2, -0.5 * cfg["cal"]);   // heavier: the same sample, played lower
  const nOut = Math.ceil(n * CG_SMP_RATE / sr) + 2, mix = new Float64Array(nOut);
  const voices = Array.from({ length: cfg["voices"] }, () => ({ on: false, pos: 0, step: 0, vol: 0 }));
  const keyAt = shots.map((s) => Math.round(s.frame / CG_FPS * CG_SMP_RATE));
  let si = 0;
  for (let j = 0; j < nOut; j++) {
    while (si < shots.length && keyAt[si] === j) {
      const sh = shots[si], v = voices[sh.k % voices.length];
      // a new round keys its voice again: whatever that voice was playing is gone (the steal); other voices ring on
      Object.assign(v, { on: true, pos: 0, step: basePitch * (1 + sh.dPitch), vol: Math.round(127 * sh.vScale) / 127 });
      si++;
    }
    let s = 0;
    for (const v of voices) {
      if (!v.on) continue;
      const i0 = Math.floor(v.pos), f = v.pos - i0;
      if (i0 >= smp.length) { v.on = false; continue; }
      let y;
      if (gauss) {
        let ws = 0, acc = 0;
        for (let d = -1; d <= 2; d++) { const w = Math.exp(-((d - f) * (d - f)) / (2 * SIG * SIG)), k = i0 + d; ws += w; acc += w * (k >= 0 && k < smp.length ? smp[k] : 0); }
        y = acc / ws;
      } else y = smp[i0];
      s += Math.trunc(y * v.vol);
      v.pos += v.step;
    }
    mix[j] = cgClamp(s, -32768, 32767) / 16384;
  }
  // hardware echo: 16 ms steps, an 8-tap FIR low-pass on the way back, feedback
  if (cfg["echo"] > 0) {
    const D = (2 + Math.round(3 * cfg["echo"])) * 512, fbk = 0.25 + 0.3 * cfg["echo"], wet = 0.2 + 0.35 * cfg["echo"];
    const fir = [0.35, 0.25, 0.16, 0.1, 0.07, 0.04, 0.02, 0.01], eb = new Float64Array(D), hist = new Float64Array(8);
    let w = 0;
    for (let j = 0; j < nOut; j++) {
      for (let k = 7; k > 0; k--) hist[k] = hist[k - 1]; hist[0] = eb[w];
      let e = 0; for (let k = 0; k < 8; k++) e += fir[k] * hist[k];
      eb[w] = cgClamp(mix[j] + e * fbk, -2, 2); w = (w + 1) % D;
      mix[j] += e * wet;
    }
  }
  // to 44.1 kHz: held (the DAC's stairs, imaging) when crunched, else linear
  const out = new Float64Array(n), step = CG_SMP_RATE / sr;
  for (let i = 0; i < n; i++) { const p = i * step, k = Math.floor(p), f = p - k; out[i] = hold ? mix[k] : mix[k] + (mix[k + 1] - mix[k]) * f; }
  cgHP(out, sr, 20);
  return { out, store, brr, srcLen: src.length, basePitch };
}

// the wrong conversion: sample-and-hold at a fractional rate (folds), then a bit depth, after setting the peak to 0.9
function cgCrunch(x, sr, amount) {
  let pk = 0; for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (pk > 0) for (let i = 0; i < x.length; i++) x[i] *= 0.9 / pk;
  if (!(amount > 0)) return { holdHz: sr, bits: 16 };
  const holdHz = sr * Math.pow(2, -3 * amount), bits = Math.round(16 - 11 * amount), lv = Math.pow(2, bits - 1), step = holdHz / sr;
  let ph = 1, h = 0;
  for (let i = 0; i < x.length; i++) { ph += step; if (ph >= 1) { ph -= 1; h = Math.round(x[i] * lv) / lv; } x[i] = h; }
  return { holdHz, bits };
}

// One take (a round or a burst). Returns { L, R, n, info, tick(drive, out) }.
export function makeChipgun(sr, cfg, seed) {
  const n = Math.max(1, Math.round(cfg["dur"] * sr)), F = Math.ceil(cfg["dur"] * CG_FPS) + 2;
  const shots = cgShots(cfg, seed, F), con = cfg["console"];
  const info = { console: CG_CONSOLES[con], fpr: cfg["fpr"], rate: cfg["rate"], shotTimes: shots.map((s) => s.frame / CG_FPS), detail: {} };
  let mono;
  if (con === 0) {
    const T = cg8Timeline(cfg, shots, F);
    mono = cg8Render(sr, n, T, (seed * 2654435761) >>> 17);
    info.detail = T.trace || {};
    info.crunch = cgCrunch(mono, sr, cfg["crunch"]);
  } else if (con === 1) {
    const T = cgFmTimeline(cfg, shots, F);
    mono = cgFmRender(sr, n, T, (seed * 2654435761) >>> 17);
    info.detail = T.trace || {};
    info.crunch = cgCrunch(mono, sr, cfg["crunch"]);
  } else {
    const r = cgSamplerRender(sr, n, cfg, shots, seed);
    mono = r.out;
    info.detail = { storeHz: r.store, brrBlocks: r.brr.blocks, brrFilters: r.brr.use.join("/"), sampleMs: Math.round(r.srcLen / CG_SMP_RATE * 1000), pitch: r.basePitch.toFixed(3) };
    info.crunch = cgCrunch(mono, sr, 0);
    info.crunch.sampler = "stored at " + r.store + " Hz, " + (cfg["crunch"] < 0.5 ? "gaussian interpolation, linear to 44.1 kHz" : "drop-sample playback, held to 44.1 kHz");
  }
  // no click where the buffer ends
  const fo = Math.min(n, Math.floor(0.015 * sr)); for (let i = 0; i < fo; i++) mono[n - 1 - i] *= i / fo;
  const L = Float32Array.from(mono), R = Float32Array.from(mono);
  let i = 0;
  return { L, R, n, info, tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } } };
}

// the level a preset gets with Normalize off: RMS 0.12 over the loudest 300 ms, peak capped at 0.9 (as glassLevel)
export function chipgunLevel(L, R, sr = 44100) {
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
  const SR = 44100, TARGET_LUFS = -18, OUT = join(ROOT, "soundtests", "proto-chipgun");
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

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, gated) + its 0.95 peak cap
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
  // as glass.mjs / blast.mjs: a take kept > 0.5 dB short by its peaks gets the app's OWN Limiter at the smallest 0.1 step
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
    return "max";
  }

  // ---- the takes. A model take: { id, why, st: rows + duration, seed }.
  const cg = (o) => Object.assign({ duration: 0.6 }, o);
  const B8 = 0, FM = 1, SMP = 2;
  const ROUNDS = {
    "pistol": {
      title: "Gunshot (pistol)", control: "Woodgrain Shot",
      controlWhy: "the CURRENT preset \"Woodgrain Shot\" exactly as it ships (Consoles / Chiptune: a square at 400 Hz under 70 % white noise, swept down, driven, crushed to 3 bits and downsampled 10x). It is the app's own console gunshot, the recipe a generic retro generator uses; the Guns section's pistols are realistic, not retro.",
      listen: "A retro game's pistol: one shot, the 8- and 16-bit console kind. Which one is the most SATISFYING gunshot, the one you would want to hear a thousand times in a game? Listen for the front (does it SNAP or just start?), the body (a kick under it, or only hiss?), the way the hiss falls away (\"pshhh\"), and whether the crunch sounds like a machine or like damage.",
      takes: [
        { id: "8bit-pistol", why: "MODEL, 8-bit chip (two pulse channels, a triangle, a 4-bit noise channel): frame 1 the noise at period index 1 (white) at full volume with a 50 % pulse popping down from ~1 kHz through the sweep unit, then the noise stepping darker per frame (index 6 -> 10) while its 4-bit volume stairs down 12, 9, 7 ... over 14 frames (0.23 s); the triangle kicks 140 -> 77 -> 42 Hz in three frame steps and halts on its DC step. Crunch 0.2 (held at ~29 kHz, 14 bits): nearly clean.",
          st: cg({ duration: 0.45, cgConsole: B8, cgCaliber: 0.3, cgSnap: 0.7, cgThump: 0.65, cgSweep: 0.55, cgLength: 0.5, cgCrunch: 0.2 }), seed: 101 },
        { id: "fm-pistol", why: "MODEL, FM chip + its noise chip: an operator fed back on itself at full feedback (grit) driving a carrier (~920 Hz on the first frame, then ~470 Hz stepping down per frame), its index closing; the noise chip's shift clock driven from its tone channel, sweeping from ~112 kHz down to ~6 kHz with attenuation in 2 dB steps; an FM kick (a knock on frame 1, then a sine stepping 129 -> 42 Hz over 5 frames); all through the 9-bit DAC's crossover step. Crunch 0.4 (held at ~19 kHz, 12 bits).",
          st: cg({ duration: 0.45, cgConsole: FM, cgCaliber: 0.35, cgSnap: 0.7, cgThump: 0.65, cgSweep: 0.55, cgLength: 0.5, cgCrunch: 0.4 }), seed: 103 },
        { id: "16bit-crunched-pistol", why: "MODEL, 16-bit sampler: a clean synthesized pistol (a 1.5 ms crack, a band of noise falling from ~1.6 kHz, a sine boom) STORED crushed: decimated to ~11 kHz with no filter, encoded to 4-bit ADPCM blocks, played back ~2 semitones lower by pitch register with no interpolation (drop-sample stairs) and held to 44.1 kHz, the hardware echo (48 ms, low-passed) at 0.3. Crunch 0.6.",
          st: cg({ duration: 0.55, cgConsole: SMP, cgCaliber: 0.3, cgSnap: 0.8, cgThump: 0.65, cgSweep: 0.45, cgLength: 0.5, cgCrunch: 0.6, cgEcho: 0.3 }), seed: 107 },
      ] },
    "shotgun": {
      title: "Shotgun", control: "Mega Shot",
      controlWhy: "the CURRENT preset \"Mega Shot\" exactly as it ships (Consoles / Chiptune: an FM tone at 220 Hz swept down under 40 % noise, a closing filter, heavy drive, a ring modulator, a little reverb): the heaviest console gun the app has. No retro shotgun preset exists; the Guns section's Shotgun is the impact engine, not retro.",
      listen: "A retro game's shotgun: one blast, heavier and longer than a pistol. Which one is the most SATISFYING shotgun? Listen for the weight (a kick you feel, a darker roar), the spread of the blast (does the hiss fall slowly, \"pshhhh\"?), and whether it still snaps at the front.",
      takes: [
        { id: "8bit-shotgun", why: "MODEL, 8-bit chip: frame 1 at noise index 4 with the pulse pop, then the noise stepping from index 9 to 13 (dark, rough) over 26 frames (0.43 s) as the 4-bit volume stairs down; the triangle kick 98 -> 38 Hz over 7 frames, the mixer squashing it under the noise; the driver's echo replaying the blast quieter after it ends. Crunch 0.3 (held at ~23 kHz, 13 bits).",
          st: cg({ duration: 0.95, cgConsole: B8, cgCaliber: 0.72, cgSnap: 0.8, cgThump: 0.9, cgSweep: 0.7, cgLength: 0.55, cgEcho: 0.25, cgCrunch: 0.3 }), seed: 201 },
        { id: "fm-shotgun", why: "MODEL, FM chip + noise chip: the fed-back operator grinding a carrier (~650 Hz on the first frame, then ~320 Hz falling to ~110 Hz over 26 frames), the noise chip's clock white on frame 1 then swept from ~14 kHz down to a ~1.7 kHz crackle in 2 dB steps, a deep FM kick (93 -> 42 Hz over 11 frames). Crunch 0.5 (held at ~16 kHz, 11 bits: the crunchy one).",
          st: cg({ duration: 0.75, cgConsole: FM, cgCaliber: 0.75, cgSnap: 0.8, cgThump: 0.9, cgSweep: 0.7, cgLength: 0.55, cgCrunch: 0.5 }), seed: 203 },
        { id: "16bit-crunched-shotgun", why: "MODEL, 16-bit sampler: a clean blast (crack, a band of noise falling from ~1 kHz over ~0.2 s, a heavy boom) stored at ~10 kHz in 4-bit ADPCM, played ~4.5 semitones low (the same-sample-pitched-down trick), drop-sample, with the hardware echo (48 ms) at 0.35. Crunch 0.65.",
          st: cg({ duration: 0.9, cgConsole: SMP, cgCaliber: 0.75, cgSnap: 0.8, cgThump: 0.9, cgSweep: 0.6, cgLength: 0.55, cgCrunch: 0.65, cgEcho: 0.35 }), seed: 207 },
      ] },
    "machine-gun": {
      title: "Machine Gun / Full Auto", control: "Machine Gun",
      controlWhy: "the CURRENT preset \"Machine Gun\" exactly as it ships (Guns: the impact engine re-gated 12 times at 12 a second). No retro full-auto preset exists, so this is the app's full-auto as it stands.",
      listen: "A retro game's machine gun: a burst of about a second. Which one is the most SATISFYING full auto? Listen for each round: does it cut the last one off cleanly (the old one-channel feel) or smear? Is the rhythm machine-tight? Do the rounds vary a little, or is it one sound pasted?",
      takes: [
        { id: "8bit-auto-15", why: "MODEL, 8-bit chip: 14 rounds every 4 frames (15 a second, exactly), each one restarting the ONE noise channel and the triangle, so every round cuts the last one's tail; per-shot variation 0.5 (the start noise period a step up or down, the volume a step down, the kick +-3 %); the noise LFSR free-runs, so no two rounds share a grain. Crunch 0.25.",
          st: cg({ duration: 1.05, cgConsole: B8, cgCaliber: 0.38, cgSnap: 0.6, cgThump: 0.6, cgSweep: 0.5, cgLength: 0.35, cgRate: 15, cgRounds: 14, cgVary: 0.5, cgCrunch: 0.25 }), seed: 301 },
        { id: "fm-auto-12", why: "MODEL, FM chip + noise chip: 12 rounds every 5 frames (12 a second), heavier (caliber 0.45), each round re-keying the same FM channels and the noise chip (cut tails), variation 0.4. Crunch 0.45.",
          st: cg({ duration: 1.1, cgConsole: FM, cgCaliber: 0.45, cgSnap: 0.6, cgThump: 0.7, cgSweep: 0.5, cgLength: 0.4, cgRate: 12, cgRounds: 12, cgVary: 0.4, cgCrunch: 0.45 }), seed: 303 },
        { id: "16bit-crunched-auto-20", why: "MODEL, 16-bit sampler: 18 rounds every 3 frames (20 a second), one stored sample played by TWO voices in turn (each round's tail rings under the next, then is cut by the one after), the pitch register nudged +-2.4 % per round. Stored at ~11 kHz, drop-sample, a short hardware echo (32 ms, 0.15). Crunch 0.6.",
          st: cg({ duration: 1.0, cgConsole: SMP, cgCaliber: 0.4, cgSnap: 0.7, cgThump: 0.6, cgSweep: 0.45, cgLength: 0.35, cgRate: 20, cgRounds: 18, cgVary: 0.4, cgVoices: 2, cgCrunch: 0.6, cgEcho: 0.15 }), seed: 307 },
      ] },
    "laser": {
      title: "Laser / Blaster", control: "8-Bit Laser",
      controlWhy: "the CURRENT preset \"8-Bit Laser\" exactly as it ships (Consoles / Chiptune: a 25 % pulse at 1.2 kHz swept down, crushed to 8 bits).",
      listen: "The retro shooter's shot: a laser or blaster, \"pew\". Which one is the most SATISFYING shot to fire over and over? Listen for the start (a tick, a bite), how the pitch falls (smooth, or in steps you can almost count), and whether it has any body.",
      takes: [
        { id: "8bit-pew", why: "MODEL, 8-bit chip: a 12.5 % pulse from ~1.5 kHz falling through the HARDWARE sweep unit (the period growing by a quarter every 3 half-frames, so the pitch falls in steps of about a major third every 25 ms, ~1.6 octaves over 9 frames), its 4-bit volume stepping down per frame, a frame of quiet bright noise and a pulse pop for the tick. Crunch 0.15.",
          st: cg({ duration: 0.3, cgConsole: B8, cgCaliber: 0.15, cgSnap: 0.35, cgThump: 0, cgSweep: 0.45, cgLength: 0.5, cgZap: 1, cgCrunch: 0.15 }), seed: 401 },
        { id: "fm-blaster", why: "MODEL, FM chip: a carrier from ~1.46 kHz with a ratio-2 modulator (some feedback) whose index closes over 9 frames, the pitch rewritten per frame (a stepped fall, 2.35 octaves to ~290 Hz), three frames of the fed-back grit channel at -16 dB with a little inharmonic metal, a one-frame FM kick, the noise chip's bright tick. Crunch 0.35 (held at ~21 kHz, 12 bits).",
          st: cg({ duration: 0.35, cgConsole: FM, cgCaliber: 0.2, cgSnap: 0.35, cgThump: 0.25, cgSweep: 0.55, cgLength: 0.5, cgZap: 1, cgMetal: 0.25, cgCrunch: 0.35 }), seed: 403 },
        { id: "16bit-crunched-blaster", why: "MODEL, 16-bit sampler: a clean synthesized blaster (a falling chirp with a phase-modulated second harmonic, a crack, a small boom) stored at ~12 kHz in 4-bit ADPCM, played drop-sample, with the hardware echo (48 ms) at 0.4 (the 16-bit shooter's room). Crunch 0.55.",
          st: cg({ duration: 0.55, cgConsole: SMP, cgCaliber: 0.2, cgSnap: 0.4, cgThump: 0.25, cgSweep: 0.5, cgLength: 0.5, cgZap: 1, cgCrunch: 0.55, cgEcho: 0.4 }), seed: 407 },
      ] },
  };
  const ORDER = ["pistol", "shotgun", "machine-gun", "laser"];

  function renderModel(t) {
    const st = Object.assign({}, CHIPGUN_DEFAULTS, t.st), cfg = chipgunCfg(st);
    const c0 = process.hrtime.bigint();
    const r = makeChipgun(SR, cfg, t.seed);
    const ms = Number(process.hrtime.bigint() - c0) / 1e6;
    return { r, cfg, ms };
  }
  function renderTake(t) {
    if (t.control) {
      const o = CS.render(Object.assign({}, CS.DEFAULTS, t.patch), { normalize: true });
      return { L: Float32Array.from(o.L), R: Float32Array.from(o.R), info: null };
    }
    const { r, cfg, ms } = renderModel(t);
    return { L: r.L, R: r.R, info: r.info, cfg, ms };
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
  function measure(L, R) {
    const n = L.length, mono = Float64Array.from(L, (x, i) => (x + R[i]) / 2);
    let pk = 0, nan = 0; for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e2 = Math.floor(0.002 * SR); let eE = 0;
    for (let i = 0; i < e2; i++) eE = Math.max(eE, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i]));
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeE: eE / (pk || 1) };
    let N = 1; while (N < n) N <<= 1;
    const p = spectrum(mono, 0, N); let all = 0, num = 0, hi = 0, lo = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; all += p[k]; num += f * p[k]; if (f > 4000) hi += p[k]; if (f < 200) lo += p[k]; }
    m.centroid = num / (all || 1); m.hi4k = hi / (all || 1); m.lo200 = lo / (all || 1);
    const W = Math.round(0.05 * SR), lv = [], cen = [];
    for (let a = 0; a + W <= n; a += W) {
      let s = 0; for (let i = a; i < a + W; i++) s += mono[i] * mono[i]; lv.push(s / W);
      const q = spectrum(mono, a, 2048); let t = 0, u = 0; for (let k = 2; k < 1024; k++) { t += q[k]; u += q[k] * k * SR / 2048; } cen.push(t > 1e-12 ? Math.round(u / t / 100) / 10 : "-");
    }
    const mx = Math.max(...lv);
    m.env = lv.map((v) => Math.round(10 * Math.log10(v / mx + 1e-12))).join(" ");
    m.cen = cen.join(" ");
    // crest: peak over the RMS of the loudest 400 ms (as glass.mjs), and over the loudest 50 ms (one shot's own crest)
    const crestOver = (sec) => { const B = Math.min(n, Math.floor(sec * SR)); let best = 0; for (let a = 0; a + B <= n; a += Math.floor(0.005 * SR)) { let s = 0; for (let i = a; i < a + B; i++) s += mono[i] * mono[i]; best = Math.max(best, s / B); } return 20 * Math.log10(pk / Math.sqrt(best || 1e-20)); };
    m.crest = crestOver(0.4); m.crest50 = crestOver(0.05);
    // attack: from the first sample over 1 % of the peak to where a 2 ms RMS envelope comes within 3 dB of its maximum
    // over the next 80 ms (time to full level; a sample peak in noise lands anywhere)
    const thr = 0.01 * pk, on = Math.max(0, mono.findIndex((x) => Math.abs(x) > thr)), W2 = Math.round(0.002 * SR), hop2 = Math.round(0.0005 * SR), e2s = [];
    for (let a = on; a + W2 <= Math.min(n, on + Math.round(0.08 * SR)); a += hop2) { let s = 0; for (let i = a; i < a + W2; i++) s += mono[i] * mono[i]; e2s.push(s / W2); }
    const e2m = Math.max(...e2s), ia = e2s.findIndex((v) => v >= e2m / 2);
    m.attackMs = ia * hop2 / SR * 1000;
    // onsets: a 10 ms RMS envelope (1 ms hop) rising 6 dB over its minimum in the last 20 ms, above -30 dB re its
    // maximum, 25 ms refractory -> the intervals between rounds
    const env = []; const H = Math.round(0.001 * SR), W10 = Math.round(0.01 * SR);
    for (let a = 0; a + W10 <= n; a += H) { let s = 0; for (let i = a; i < a + W10; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / W10 + 1e-20)); }
    const emax = Math.max(...env), ons = [];
    for (let i = 1; i < env.length; i++) {
      let mn = Infinity; for (let j = Math.max(0, i - 20); j < i; j++) mn = Math.min(mn, env[j]);
      if (env[i] > emax - 30 && env[i] - mn > 6 && (!ons.length || i - ons[ons.length - 1] > 25)) ons.push(i);
    }
    m.onsets = ons.length;
    const iv = ons.slice(1).map((v, i) => v - ons[i]);
    m.intervals = iv.length ? "median " + iv.slice().sort((a, b) => a - b)[iv.length >> 1] + " ms, " + Math.min(...iv) + "-" + Math.max(...iv) + " ms" : "";
    const i30 = env.findIndex((v, i) => i > env.indexOf(emax) && v < emax - 30);
    m.fall30 = ons.length <= 1 && i30 > 0 ? (i30 - env.indexOf(emax)) / 1000 : null;
    // the onset's spectrum: the first 20 ms
    const q0 = spectrum(mono, Math.max(0, on), 1024); let t0 = 0, u0 = 0; for (let k = 1; k < 512; k++) { t0 += q0[k]; u0 += q0[k] * k * SR / 1024; }
    m.cen20 = u0 / (t0 || 1);
    return m;
  }

  function run(name) {
    const round = ROUNDS[name];
    const takes = [{ id: "control", control: true, why: round.controlWhy, patch: preset(round.control) }].concat(round.takes);
    let seed = 0x5f3759df;
    for (const ch of name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, name), key = [];
    mkdirSync(dir, { recursive: true });
    console.log("\n" + name);
    order.forEach((ti, slot) => {
      const t = takes[ti], r = renderTake(t), lim = matchWithLimiter(r.L, r.R), m = measure(r.L, r.R), file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: name + " " + file })));
      const i = r.info;
      const line = m.sec.toFixed(2) + " s, " + m.lufs.toFixed(1) + " LUFS, peak " + m.peak.toFixed(3) + ", NaN " + m.nan + ", end edge " + m.edgeE.toFixed(4) +
        ", centroid " + Math.round(m.centroid) + " Hz (first 23 ms " + Math.round(m.cen20) + " Hz), >4 kHz " + (100 * m.hi4k).toFixed(0) + "%, <200 Hz " + (100 * m.lo200).toFixed(0) + "%, crest " + m.crest.toFixed(1) + " dB (over 50 ms " + m.crest50.toFixed(1) + " dB), attack " + m.attackMs.toFixed(1) + " ms" +
        (lim ? ", Limiter " + lim : "") + (m.fall30 != null ? ", falls 30 dB in " + m.fall30.toFixed(2) + " s" : "") + (m.onsets > 1 ? ", " + m.onsets + " onsets heard, intervals " + m.intervals : "");
      let detail = "level per 50 ms (dB): " + m.env + "\n      centroid per 50 ms (kHz): " + m.cen;
      if (i) {
        const d = i.detail, fmt = (a) => (a && a.length ? a.join(" ") : "-");
        detail += "\n      model: " + i.console + ", " + i.shotTimes.length + " round(s)" + (i.shotTimes.length > 1 ? " every " + i.fpr + " frames (" + i.rate.toFixed(1) + "/s)" : "") +
          ", crunch " + (i.crunch.sampler || (i.crunch.bits < 16 ? "held at " + Math.round(i.crunch.holdHz) + " Hz, " + i.crunch.bits + " bits" : "off"));
        if (i.console === CG_CONSOLES[0]) detail += "\n      round 1, per frame: noise period index " + fmt(d.noiseIdx) + " | 4-bit volume " + fmt(d.noiseVol) + " | triangle Hz " + fmt(d.triHz) + " | pop Hz per half-frame " + fmt(d.popHz) + (d.zapHz && d.zapHz.length ? " | zap Hz " + fmt(d.zapHz) + " (" + d.zapSweep + ")" : "");
        else if (i.console === CG_CONSOLES[1]) detail += "\n      round 1, per frame: FM grit carrier Hz " + fmt(d.crunchHz) + " | noise chip shift Hz " + fmt(d.psgShiftHz) + " | attenuation (2 dB steps) " + fmt(d.psgAtt) + " | FM kick Hz " + fmt(d.thumpHz) + (d.zapHz && d.zapHz.length ? " | zap Hz " + fmt(d.zapHz) : "");
        else detail += "\n      sample: " + d.sampleMs + " ms stored at " + d.storeHz + " Hz in " + d.brrBlocks + " ADPCM blocks (predictors 0/1/2/3 used " + d.brrFilters + "), played at pitch " + d.pitch + " of 32 kHz";
        detail += "\n      render " + r.ms.toFixed(1) + " ms for " + m.sec.toFixed(2) + " s = " + (r.ms / m.sec).toFixed(1) + " ms per second of audio";
      }
      console.log("  " + file + "  " + t.id.padEnd(24) + line + "\n      " + detail);
      const bad = []; if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target"); if (!t.control && m.edgeE > 0.02) bad.push("end edge");
      if (bad.length) console.log("    !! " + bad.join(", "));
      key.push({ file, t, line, detail, lim });
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + round.title + "\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS, in a shuffled order. One of them is the sound the app makes today.\n\n" + round.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + round.title + ": the key\n\n" +
      "Model takes are the chipgun prototype's output (mono, as the machines were; dry except their own echo), no other chain; the control is rendered by the exported engine exactly as `tools/make-ab.mjs` does.\n\n" +
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
      console.log((name + "/" + t.id).padEnd(40) + best.toFixed(1).padStart(7) + " ms for " + sec.toFixed(2) + " s = " + (best / sec).toFixed(1).padStart(6) + " ms per second of audio (best of 5)");
    }
    const per = rows.map((r) => r[1] / r[2]).sort((a, b) => a - b);
    console.log("median " + per[per.length >> 1].toFixed(1) + " ms/s, worst " + per[per.length - 1].toFixed(1) + " ms/s");
  }

  const README = `# Chipgun engine prototype: listening round

A PROTOTYPE engine, "chipgun" (the retro console gunshot), against today's presets. Made by
\`node tools/proto/chipgun.mjs\` (the model, \`makeChipgun\`, and this round are both in that file). Nothing in the app changed.

## What to do

Listen in this order. Each folder is one sound: open its \`LISTEN.md\`, play \`take-A.wav\` ... \`take-D.wav\` (every take
matched to -18 LUFS, order shuffled), say which one is the most satisfying, and a runner-up. **One take in each folder is
the control**, today's closest preset. Then read \`KEY.md\`.

| # | folder | the sound | control |
|---|---|---|---|
| 1 | pistol | one retro pistol shot | Woodgrain Shot (Consoles / Chiptune), as it ships |
| 2 | shotgun | one retro shotgun blast | Mega Shot (Consoles / Chiptune), as it ships: no retro shotgun exists |
| 3 | machine-gun | a full-auto burst, ~1 s | Machine Gun (Guns), as it ships: no retro full auto exists |
| 4 | laser | the shooter's "pew" | 8-Bit Laser (Consoles / Chiptune), as it ships |

The three model takes in each folder are the same gun on three different MACHINES, bracketing the range: an **8-bit chip**
(two pulse channels, a triangle and a 4-bit noise channel; mildly crunched), an **FM chip** with a square-wave noise chip
beside it (the crunchy one), and a **16-bit sampler** playing a crushed, compressed recording (the most degraded).

## What the engine is

Not "white noise plus a square, bit-crushed", which is what today's console presets and generic retro generators do. The
machines themselves, played the way a game's sound driver played them, once per 60 Hz frame: a shift-register noise
channel whose clock is stepped darker every frame (the "pshhh") at a 4-bit volume that stairs down, a triangle kick whose
pitch is rewritten each frame and which halts on a step; FM operators fed back on themselves until they grind, a noise
chip swept from its tone channel in 2 dB steps; a gunshot stored the way a cartridge stored it (a low rate, 4-bit ADPCM)
and played at the wrong pitch. Automatic fire is fired ON FRAMES (so the rhythm is exact), and each round re-triggers
the same channel, cutting the last one off. Crunch is a sample-and-hold at a fractional rate (real aliasing) and a bit
depth.

## Cues that are not the question

- **Mono and dry:** the machines were mono; the model takes carry only their own echo (the 16-bit sampler's hardware
  echo, the 8-bit shotgun's driver echo). Mega Shot and Machine Gun carry a little reverb of their own.
- **Machine gun rates differ on purpose:** 15, 12 and 20 rounds a second (every 4, 5 and 3 frames) against the control's
  12. If the rate is the only reason one wins, say so: it is one knob.
- **Lengths** run 0.3-1.1 s; judge the first 100 ms of the single shots too.
- **Peaks:** a few takes needed the app's own Limiter to reach -18 LUFS; KEY.md says which.
`;

  const want = process.argv[2];
  if (want === "--cost") { cost(); return; }
  mkdirSync(OUT, { recursive: true });
  for (const nm of want ? [want] : ORDER) { if (!ROUNDS[nm]) { console.error("no round " + nm + " (" + ORDER.join(", ") + ")"); process.exit(1); } run(nm); }
  writeFileSync(join(OUT, "README.md"), README);
  console.log("\n-> " + OUT);
}
