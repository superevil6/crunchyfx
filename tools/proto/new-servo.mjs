/* new-servo.mjs — NEW servo presets (wave 33) for the parts of the engine no preset used yet: the ratchet, the clock
 * escapement, mains hum, the PWM drive whine, the stop click and hold buzz.
 *
 *   node tools/proto/new-servo.mjs            render every new preset (+ its _alts), measure, write the JSON
 *   node tools/proto/new-servo.mjs <slug>     just that one
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does, at the
 * REAL preset level (Normalize on, the patch's own Gain: what the app plays), NOT loudness-matched. Writes
 * soundtests/new-presets/<slug>.wav (+ <slug>-alt<N>.wav) and tools/new-presets/servo.json ({ name: patch, with
 * `category` as a suggestion to strip }). Every sound is measured: peak, DC, duration, BS.1770 loudness against the
 * median of the existing servo presets, onsets (count and rate), and the strongest tone over time (the whine's pitch).
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
const PRESETS = pctx.window.PRESETS;
// DIAGNOSTICS ONLY: dsp.js's own servoBuffer (the bundle hides it), to read each part's level before servoLevel's one
// gain; every WAV is rendered by the exported bundle above.
const dctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView });
dctx.window = dctx;
runInContext(readFileSync(join(ROOT, "dsp.js"), "utf8"), dctx, { filename: "dsp.js" });
const DSP = { buf: runInContext("servoBuffer", dctx), cfg: runInContext("servoCfg", dctx) };
const PARTS = {
  whine: ["servoWhine"], brush: ["servoComm", "servoSpark"], mesh: ["servoMesh1", "servoMesh2", "servoMesh3"], knock: ["servoKnock"],
  escape: ["servoTicks"], ratchet: ["servoRatchet"], click: ["servoStop", "servoHold"], hum: ["servoHum"], pwm: ["servoPwm"],
  bearing: ["servoBearing"], rumble: ["servoRumble"],
};
// each part alone (the others zeroed), RMS dBFS over [t0, t1] of the raw servo buffer (same scale for all parts)
function parts(patch, t0, t1) {
  const st = Object.assign({}, CS.DEFAULTS, patch), n = Math.floor(st.duration * SR), out = [];
  for (const [name, keys] of Object.entries(PARTS)) {
    if (!keys.some((k) => st[k] > 0)) continue;
    const s = Object.assign({}, st);
    for (const [o, ks] of Object.entries(PARTS)) if (o !== name) for (const k of ks) s[k] = 0;
    const x = DSP.buf(SR, n, DSP.cfg(s), (0x5e70 ^ (Math.round(s.servoSeed || 0) * 7919)) >>> 0);
    let ss = 0; const a = Math.floor(t0 * SR), b = Math.min(n, Math.floor(t1 * SR));
    for (let i = a; i < b; i++) ss += x[i] * x[i];
    out.push(name + " " + (10 * Math.log10(ss / Math.max(1, b - a) + 1e-14)).toFixed(0));
  }
  return out.join(", ");
}

// ---- loudness: ITU BS.1770 (as tools/make-ab.mjs)
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

// ---- measurement helpers
function render(patch) {
  const p = Object.assign({}, patch); delete p._vary; delete p._alts; delete p.category;
  const r = CS.render(Object.assign({}, CS.DEFAULTS, p), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
function basic(L, R) {
  let pk = 0, sum = 0, nan = 0, clip = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (!isFinite(L[i]) || !isFinite(R[i])) nan++;
    pk = Math.max(pk, a, b); if (a >= 0.999 || b >= 0.999) clip++;
    sum += L[i];
  }
  return { pk, dc: sum / L.length, nan, clip, sec: L.length / SR, lufs: lufs(L, R) };
}
// onsets: 1 ms frames of a first-difference (the clicks' edges), an onset where a frame rises past `k` x the mean of the
// previous 40 ms and past `floorDb` under the loudest frame, at least `refrac` s after the last one
function onsets(x, opt) {
  const o = Object.assign({ k: 4, floorDb: -30, refrac: 0.02, from: 0, to: Infinity }, opt);
  const F = Math.round(0.001 * SR), nF = Math.floor(x.length / F), e = new Float64Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0; for (let i = f * F + 1; i < (f + 1) * F; i++) { const d = x[i] - x[i - 1]; s += d * d; } e[f] = s / F; }
  let mx = 0; for (const v of e) mx = Math.max(mx, v);
  const floor = mx * Math.pow(10, o.floorDb / 10), out = [];
  let last = -1e9;
  for (let f = 3; f < nF; f++) {
    const t = f * F / SR;
    if (t < o.from || t > o.to) continue;
    const j0 = Math.max(0, f - 40);
    let m = 0; for (let j = j0; j < f; j++) m += e[j]; m /= (f - j0);
    if (e[f] > floor && e[f] > o.k * m && t - last >= o.refrac) { out.push(t); last = t; }
  }
  return out;
}
function rateOf(ts) {
  if (ts.length < 2) return 0;
  const gaps = []; for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  return 1 / gaps[gaps.length >> 1];
}
// the strongest spectral peak in [lo, hi] Hz in a Hann window of 8192 at time t
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
function spectrum(x, t, N) {
  N = N || 8192;
  const c = Math.round(t * SR), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { const k = c - N / 2 + i; re[i] = (k >= 0 && k < x.length ? x[k] : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))); }
  fft(re, im);
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
function topPeaks(x, t, lo, hi, k) {
  const N = 8192, mag = spectrum(x, t, N), bin = SR / N, c = [];
  for (let i = Math.max(2, Math.ceil(lo / bin)); i <= Math.min(N / 2 - 3, Math.floor(hi / bin)); i++)
    if (mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > mag[i - 2] && mag[i] >= mag[i + 2]) c.push([i, mag[i]]);
  c.sort((a, b) => b[1] - a[1]);
  const top = c[0] ? c[0][1] : 1;
  return c.slice(0, k).map((q) => (q[0] * bin).toFixed(0) + "(" + (20 * Math.log10(q[1] / top)).toFixed(0) + ")").join(" ");
}
function peakHz(x, t, lo, hi) {
  const N = 8192, mag = spectrum(x, t, N), bin = SR / N;
  let best = -1, bv = 0;
  for (let i = Math.ceil(lo / bin); i <= Math.min(N / 2 - 2, Math.floor(hi / bin)); i++) if (mag[i] > bv) { bv = mag[i]; best = i; }
  if (best < 1) return 0;
  const a = mag[best - 1], b = mag[best], c = mag[best + 1], d = 0.5 * (a - c) / (a - 2 * b + c || 1e-12);
  return (best + d) * bin;
}
// energy share per band (dB re the total) at time t: where the sound's weight sits
function bands(x, t, edges) {
  const N = 8192, mag = spectrum(x, t, N), bin = SR / N, out = [];
  let tot = 0; for (let i = 1; i < N / 2; i++) tot += mag[i] * mag[i];
  for (let b = 0; b + 1 < edges.length; b++) {
    let s = 0; for (let i = Math.ceil(edges[b] / bin); i < Math.min(N / 2, edges[b + 1] / bin); i++) s += mag[i] * mag[i];
    out.push((10 * Math.log10(s / tot + 1e-12)).toFixed(0));
  }
  return out.join("/");
}
// short-term level (RMS dBFS) over windows, to see a shape over time
function levels(x, step) {
  const W = Math.round(step * SR), out = [];
  for (let a = 0; a + W <= x.length; a += W) { let s = 0; for (let i = a; i < a + W; i++) s += x[i] * x[i]; out.push((10 * Math.log10(s / W + 1e-12)).toFixed(0)); }
  return out.join(" ");
}

// ---- the shared tail every servo preset carries (no filter, no crush, no room unless a preset asks)
const TAIL = { attack: 0.004, hold: 0, decay: 0, sustain: 1, release: 0.02, filterMode: 0, cutoff: 16000, reso: 0, drive: 0, bitcrush: 16, reverb: 0 };
const sv = (o) => Object.assign({ wave: 33 }, o, Object.assign({}, TAIL, o.__tail || {}), { __tail: undefined });
// presets.js's order: the engine's rows, the tail, then the burst and master rows, `_vary` last
const LAST = ["repeat", "rate", "limiter", "gain", "duration", "_vary"];
const clean = (p) => {
  const o = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined && k !== "__tail" && !LAST.includes(k)) o[k] = v;
  for (const k of LAST) if (p[k] !== undefined) o[k] = p[k];
  return o;
};

// ============================================================================================================================
// THE NEW PRESETS. Each: slug, name, category (a suggestion), what it is, a check (what to measure), the patch, alts.
// ============================================================================================================================
const NEW = [];

// ---- RATCHET WRENCH. Nothing turns: a clockwork shaft parked (power on past the end, no escapement, no gears, no
// bearings), so the sound is the RATCHET alone, its pawl over a fine-tooth wheel at ~34 clicks a second. The ratchet runs
// for the whole buffer and the amp envelope gates it into back-swings: Shots 3 at 1.9 a second, each ~0.22 s of clicks
// (7-8 clicks: a 72-tooth wrench swung back ~40 degrees) and a silent forward pull (Fire rate 2: a swing every 0.5 s). Wander moves the click rate +-25%
// within a swing, as a hand does. A small steel body.
NEW.push({
  slug: "ratchet-wrench", name: "Ratchet Wrench", category: "Machine",
  what: "a socket wrench cranked: three back-swings of pawl clicks, a silent pull between",
  check: { onsets: { refrac: 0.012, k: 3, floorDb: -28 }, bursts: 0.12 },
  patch: clean(sv({ servoType: 3, servoSpeed: 1, servoAt: 3, servoRun: 0.01, servoWhine: 0, servoBars: 0, servoStages: 0, servoBearing: 0,
    servoRatchet: 1.2, servoRatchetRate: 34, servoRatchetEnd: 3, servoSize: 0.22, servoBody: 0.45, servoWander: 0, servoSeed: 1,
    __tail: { attack: 0.002, hold: 0.2, decay: 0.03, sustain: 0, release: 0.01 },
    repeat: 3, rate: 2, gain: 1, limiter: 0.3, duration: 1.5, _vary: { servoSeed: 1, servoRatchetRate: 0.15 } })),
  alts: [
    // a long-handled breaker ratchet on a big bolt, slower: a coarse 36-tooth wheel, longer swings, heavier body
    { id: "big-coarse", why: "a big coarse-tooth ratchet: slower clicks (~20/s), longer swings, a heavier, lower body",
      patch: clean(sv({ servoType: 3, servoSpeed: 1, servoAt: 3, servoRun: 0.01, servoWhine: 0, servoBars: 0, servoStages: 0, servoBearing: 0,
        servoRatchet: 1.4, servoRatchetRate: 20, servoRatchetEnd: 3, servoSize: 0.5, servoBody: 0.65, servoSeed: 2,
        __tail: { attack: 0.002, hold: 0.3, decay: 0.04, sustain: 0, release: 0.01 },
        repeat: 2, rate: 1.5, gain: 1, limiter: 0.6, duration: 1.35 })) },
  ],
});

// ---- WINDING A TOY. Clockwork. The key turns the ratchet for 0.8 s (~13 clicks a second: a 12-tooth ratchet a little
// over a turn a second), then the spring is let go at 0.9 s: the governor train spins up fast and runs down (Speed at end
// 0.6) with the walking cam's knock once a turn of the second wheel, as Clockwork Whir's picked governor take, and coasts
// out at the end. A small tin case.
NEW.push({
  slug: "winding-a-toy", name: "Winding a Toy", category: "Machine",
  what: "a clockwork toy's key wound (ratchet clicks), then the spring whirs it off and it runs down",
  check: { onsets: { refrac: 0.03, k: 3, floorDb: -26, to: 0.88 }, pitch: [[1.1, 200, 900], [1.6, 200, 900]], parts: [[0, 0.85], [1.0, 1.8]], level: 0.1 },
  patch: clean(sv({ servoType: 3, servoSpeed: 3900, servoDrift: 0.6, servoAt: 0.9, servoRun: 0.85, servoLoad: 0.4, servoLoadEnd: 0.4, servoOffLoad: 0.4,
    servoInertia: 0.05, servoDecel: 0.3, servoCoast: 0.25, servoSlots: 3, servoWhine: 0, servoBars: 0,
    servoStages: 2, servoPinion1: 8, servoGear1: 48, servoMesh1: 0.3, servoPinion2: 8, servoGear2: 48, servoMesh2: 0.2, servoWear: 0.25,
    servoKnock: 0.45, servoKnockShaft: 1, servoKnockRate: 1, servoKnockHz: 2600, servoClickHz: 2631.58,
    servoRatchet: 2, servoRatchetRate: 13, servoRatchetEnd: 0.8,
    servoBearing: 0.06, servoBearingHz: 5000, servoRumble: 0.15, servoSize: 0.12, servoBody: 0.45, servoWander: 0.5, servoCog: 0.6, servoCogN: 1, servoSeed: 2,
    gain: 1, duration: 2.0, _vary: { servoSeed: 1, servoSpeed: 0.08, servoRatchetRate: 0.15 } })),
  alts: [],
});

// ---- CLOCK TICK. The escapement alone: a 15-tooth escape wheel at 2 rpm (2 x 15 x 1/30 = 1 tick a second), tick and
// tock on two pallets (the tock a little softer, 0.75), each an unlock click then the drop 4 ms later. No wander or cog
// (a clock keeps time), no bearings (the parked-shaft hiss would ride at full level at this speed), the train silent. A
// wooden wall-clock case. 4 s = 4 ticks, 2 tick-tock pairs: it loops.
const clock = (o) => clean(sv(Object.assign({ servoType: 3, servoStart: 1, servoSpeed: 2, servoRun: 10, servoSag: 0, servoLoad: 0.3, servoLoadEnd: 0.3, servoOffLoad: 0.3,
  servoWhine: 0, servoBars: 0, servoStages: 0, servoBearing: 0, servoRumble: 0, servoWander: 0, servoCog: 0,
  servoTicks: 1, servoEscTeeth: 15, servoDrop: 4, servoTock: 0.75, servoPawlHz: 2600, servoSize: 0.55, servoBody: 0.55, servoSeed: 1 }, o)));
NEW.push({
  slug: "clock-tick", name: "Clock Tick", category: "Machine",
  what: "a wall clock: tick, tock, one a second, 4 s (loops)",
  check: { onsets: { refrac: 0.25, k: 4, floorDb: -24 } },
  patch: clock({ gain: 1, limiter: 0.4, duration: 4, _vary: { servoSeed: 1, servoPawlHz: 0.08, servoTock: 0.15 } }),
  alts: [
    // a tall case clock: a seconds pendulum is also one beat a second; a bigger, darker drop in a big wooden case that
    // booms, a longer drop, a hall's reverb
    { id: "tall-case", why: "a tall case (grandfather) clock: the same one beat a second, but a deep, heavy tock in a big booming wooden case, in a hall",
      patch: clock({ servoDrop: 7, servoTock: 0.85, servoPawlHz: 1500, servoSize: 0.85, servoBody: 0.8, servoSeed: 2,
        __tail: { reverb: 0.25, reverbSize: 0.6, reverbTone: 0.35 }, gain: 1, limiter: 0.5, duration: 4 }) },
  ],
});

// ---- POCKET WATCH. A watch beats 21600 an hour, 6 a second: the 15-tooth escape wheel at 12 rpm. A tiny bright pallet
// (Tick tone 6200), a short drop, a tiny case. 2 s = 12 beats.
NEW.push({
  slug: "pocket-watch", name: "Pocket Watch", category: "Machine",
  what: "a pocket watch ticking: small, fast, bright, 6 beats a second, 2 s (loops)",
  check: { onsets: { refrac: 0.08, k: 4, floorDb: -24 } },
  patch: clock({ servoSpeed: 12, servoDrop: 1.6, servoTock: 0.85, servoPawlHz: 6200, servoSize: 0, servoBody: 0.3,
    gain: 1, limiter: 0.4, duration: 2, _vary: { servoSeed: 1, servoPawlHz: 0.06 } }),
  alts: [],
});

// ---- FRIDGE HUM. An induction compressor motor (brushless type, no brushes), 2-pole at 3450 rpm (57.5 a second). The
// relay clunks it on (the start click, low), the MAINS HUM arrives with the power (120 Hz strongest), it pulls up to speed
// over ~0.4 s against a heavy load that eases (Load 0.95 -> 0.4: the current and the buzz fall), and the PISTON knocks once
// a turn (57 a second, low: a buzzing thud, the compressor's drone). A faint rotor whine, a big sheet-metal cabinet.
NEW.push({
  slug: "fridge-hum", name: "Fridge Hum", category: "Machine",
  what: "a refrigerator compressor kicking on: a relay clunk, mains hum, a low knocking drone, settling",
  check: { onsets: { refrac: 0.3, k: 6, floorDb: -20, to: 0.6 }, pitch: [[1.0, 60, 400], [2.5, 60, 400]], parts: [[0.15, 0.6], [2, 3]], level: 0.25 },
  patch: clean(sv({ servoType: 0, servoSpeed: 3450, servoAt: 0.12, servoRun: 3, servoLoad: 0.95, servoLoadEnd: 0.4, servoOffLoad: 0.4,
    servoInertia: 0.4, servoDecel: 0.3, servoCoast: 1, servoSag: 0.06, servoSlots: 24, servoWhine: 0.12, servoWhineHarm: 4, servoWhineRoll: 2,
    servoBars: 0, servoKnock: 0.7, servoKnockShaft: 0, servoKnockRate: 1, servoKnockHz: 190,
    servoStop: 1.6, servoClickHz: 420, servoHum: 0.55, servoHumHz: 60, servoBearing: 0.05, servoBearingHz: 2000, servoRumble: 0.35,
    servoSize: 0.9, servoBody: 0.6, servoWander: 0.2, servoCog: 0.3, servoCogN: 1, servoSeed: 1,
    __tail: { attack: 0.004, hold: 0.45, decay: 1.3, sustain: 0.7, release: 0.03 },
    gain: 0.75, duration: 3, _vary: { servoSeed: 1, servoSpeed: 0.04, servoKnockHz: 0.1 } })),
  alts: [],
});

// ---- CORDLESS DRILL. A geared motor (a brushed motor through a gearbox: the type that has the stop click): 19000 rpm,
// 5 slots and 10 commutations a turn (the motor's whine at ~1.5 kHz, the brush buzz at ~3 kHz), a two-stage planetary box
// (the sun pinion's whine at 12 x 317 = 3.8 kHz, the next at ~950 Hz). Two trigger squeezes: 0.45 s full, then 0.55 s a little slower. It BRAKES on
// release (a drill's electronic brake) and the gears settle with a click each time.
NEW.push({
  slug: "cordless-drill", name: "Cordless Drill", category: "Machine",
  what: "a cordless drill: two trigger squeezes, brushed whine and gear whine, braking with a click on each release",
  check: { onsets: { refrac: 0.15, k: 8, floorDb: -22 }, pitch: [[0.3, 600, 6000], [1.1, 600, 6000]], peaks: [[0.3, 300, 12000]], parts: [[0.15, 0.45]], level: 0.05 },
  patch: clean(sv({ servoType: 2, servoSpeed: 19000, servoAt: 0.04, servoRun: 0.45, servoAt2: 0.78, servoRun2: 0.55, servoSpeed2: 17000,
    servoLoad: 0.3, servoLoadEnd: 0.3, servoOffLoad: 0.3, servoInertia: 0.07, servoDecel: 0.035, servoCoast: 0.2, servoBrake: 1,
    servoSlots: 5, servoWhine: 0.8, servoBars: 10, servoComm: 0.8, servoSpark: 0.5, servoSparkHz: 5500,
    servoStages: 2, servoPinion1: 12, servoGear1: 48, servoMesh1: 0.7, servoPinion2: 12, servoGear2: 48, servoMesh2: 0.3, servoWear: 0.1,
    servoStop: 1.1, servoClickHz: 1900, servoBearing: 0.1, servoBearingHz: 7000, servoRumble: 0.05,
    servoSize: 0.25, servoBody: 0.45, servoWander: 0.25, servoCog: 0.2, servoSeed: 1,
    gain: 0.55, duration: 1.6, _vary: { servoSeed: 1, servoSpeed: 0.08, servoSpeed2: 0.08 } })),
  alts: [],
});

// ---- ELECTRIC CAR PASS. A brushless traction motor (24 slots at ~5000 rpm: the magnetic whine near 2 kHz) through a
// single reduction (a 21-tooth pinion: ~1.75 kHz), the inverter's PWM whine at a fixed 7.5 kHz, and the TIRES and AIR as
// the engine's own speed-riding noise: Bearings tuned down to 900 Hz (a broad road roar) and Rumble. The pass: move 1
// approaches, the speed (so the whine) creeping up 0.95 -> 1.0; at 1.25 s move 2 takes over at ~0.84 of the speed reached (-3 semitones) and the
// shaft slews down to it over ~0.25 s (Slow-down): the pitch FALLING as it goes by. The amp envelope swells in over 1.2 s
// and dies away after. A light lowpass that the envelope opens (filtEnv) darkens the far ends. No room.
const ev = (o) => clean(sv(Object.assign({ servoType: 0, servoSpeed: 4800, servoDrift: 1.05, servoAt: 0, servoStart: 1, servoRun: 1.25,
  servoAt2: 1.25, servoRun2: 1.5, servoSpeed2: 4250, servoLoad: 0.6, servoLoadEnd: 0.6, servoOffLoad: 0.6,
  servoInertia: 0.25, servoDecel: 0.22, servoCoast: 1.5, servoSag: 0, servoSlots: 24, servoWhine: 0.35, servoWhineHarm: 5, servoWhineRoll: 1.6, servoBars: 0,
  servoStages: 1, servoPinion1: 21, servoGear1: 63, servoMesh1: 0.25,
  servoPwm: 0.2, servoPwmHz: 7500, servoBearing: 1, servoBearingHz: 900, servoRumble: 0.9,
  servoSize: 0.7, servoBody: 0.2, servoWander: 0.2, servoSeed: 1,
  __tail: { attack: 1.25, hold: 0.05, decay: 1.4, sustain: 0, release: 0.05, envCurve: 0.5, cutoff: 5000, filtEnv: 0.35, reso: 0, width: 0.4 },
  gain: 0.7, duration: 2.7 }, o)));
NEW.push({
  slug: "electric-car-pass", name: "Electric Car Pass", category: "Machine",
  what: "an electric car passing: a whine that rises as it comes and falls as it goes, over tire roar and air",
  check: { pitch: [[0.6, 1000, 2600], [1.15, 1000, 2600], [1.5, 1000, 2600], [2.0, 1000, 2600]], level: 0.15, bands: [0.6, 1.25, 2.0], parts: [[0.8, 1.6]], peaks: [[1.0, 900, 9000], [1.9, 900, 9000]] },
  patch: ev({ _vary: { servoSeed: 1, servoSpeed: 0.08, servoPwmHz: 0.1 } }),
  alts: [],
});

// ---- CEILING FAN. An induction fan motor (brushless type, no brushes) at 160 rpm, running from the start and never
// stopping (it loops): a low rotor drone (36 poles x 2.67 = 96 Hz and up), a little mains hum, the blades' air as soft
// low band noise, a gentle wobble once a turn (Cogging on one cog: the speed swings ~1% a turn; plus a mesh 'tone'
// with Wear, whose level swings once a turn), and a faint tick once a turn (a loose shade or a pull chain). 3 s = 8 turns.
NEW.push({
  slug: "ceiling-fan", name: "Ceiling Fan", category: "Machine",
  what: "a slow ceiling fan: a low hum and drone, soft air, a gentle wobble and a faint tick each turn (loops)",
  check: { onsets: { refrac: 0.2, k: 3, floorDb: -30 }, pitch: [[1.0, 60, 400], [2.0, 60, 400]], parts: [[0.5, 2.5]], level: 0.05 },
  patch: clean(sv({ servoType: 0, servoStart: 1, servoSpeed: 160, servoRun: 10, servoLoad: 0.3, servoLoadEnd: 0.3, servoOffLoad: 0.3,
    servoInertia: 0.5, servoSag: 0, servoSlots: 36, servoWhine: 0.6, servoWhineHarm: 4, servoWhineRoll: 1.8, servoBars: 0,
    servoStages: 1, servoPinion1: 48, servoGear1: 48, servoMesh1: 0.35, servoWear: 0.5,
    servoKnock: 0.85, servoKnockShaft: 0, servoKnockRate: 1, servoKnockHz: 2400,
    servoHum: 0.12, servoHumHz: 60, servoBearing: 0.5, servoBearingHz: 700, servoRumble: 0.2,
    servoSize: 0.6, servoBody: 0.3, servoWander: 0.15, servoCog: 0.5, servoCogN: 1, servoSeed: 1,
    __tail: { attack: 0.01, release: 0.01 },
    gain: 0.9, duration: 3, _vary: { servoSeed: 1, servoSpeed: 0.1, servoKnockHz: 0.1 } })),
  alts: [],
});

// ============================================================================================================================
const EXISTING = ["Robot Servo", "Mechanical Whir", "Servo Motor", "Conveyor Belt", "Clockwork Whir"];
function measureExisting() {
  const rows = [];
  for (const n of EXISTING) {
    const p = PRESETS[n];
    [p].concat(p._alts || []).forEach((q, k) => { const r = render(q), b = basic(r.L, r.R); rows.push({ name: n + (k ? " alt" + k : ""), b }); });
  }
  return rows;
}
function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length & 1 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; }

const want = process.argv[2];
const ex = measureExisting(), MED = median(ex.map((r) => r.b.lufs));
console.log("existing servo presets (real level):");
for (const r of ex) console.log("  " + r.name.padEnd(22) + r.b.lufs.toFixed(1) + " LUFS  peak " + r.b.pk.toFixed(3) + "  " + r.b.sec.toFixed(2) + " s");
console.log("  median " + MED.toFixed(1) + " LUFS\n");

const OUT = join(ROOT, "soundtests", "new-presets");
mkdirSync(OUT, { recursive: true });
function report(label, patch, check) {
  const r = render(patch), b = basic(r.L, r.R), x = r.L;
  const lines = [label.padEnd(30) + b.sec.toFixed(2) + " s  " + b.lufs.toFixed(1) + " LUFS (" + (b.lufs - MED >= 0 ? "+" : "") + (b.lufs - MED).toFixed(1) + ")  peak " + b.pk.toFixed(3) +
    "  dc " + b.dc.toExponential(1) + (b.nan ? "  NaN " + b.nan : "") + (b.clip ? "  CLIP " + b.clip : "")];
  if (check.onsets) {
    const ts = onsets(x, check.onsets);
    lines.push("    onsets " + ts.length + ", median rate " + rateOf(ts).toFixed(2) + "/s: " + ts.map((t) => t.toFixed(3)).join(" "));
    if (check.bursts) {
      const bs = []; let cur = null;
      for (const t of ts) { if (!cur || t - cur.end > check.bursts) { cur = { start: t, end: t, n: 0 }; bs.push(cur); } cur.end = t; cur.n++; }
      lines.push("    bursts " + bs.length + ": " + bs.map((q) => q.n + " clicks " + q.start.toFixed(2) + "-" + q.end.toFixed(2) + " s (" + ((q.n - 1) / Math.max(1e-3, q.end - q.start)).toFixed(0) + "/s)").join(", "));
    }
  }
  if (check.pitch) lines.push("    peak tone " + check.pitch.map((q) => q[0] + "s " + peakHz(x, q[0], q[1], q[2]).toFixed(0) + " Hz").join(", "));
  if (check.peaks) for (const q of check.peaks) lines.push("    top tones at " + q[0] + " s (Hz, dB re top): " + topPeaks(x, q[0], q[1], q[2], 5));
  if (check.bands) lines.push("    band share dB (<300/300-1k/1k-3k/3k-8k/8k+) " + check.bands.map((t) => t + "s " + bands(x, t, [20, 300, 1000, 3000, 8000, 20000])).join("  "));
  if (check.parts) for (const w of check.parts) lines.push("    parts dB " + w[0] + "-" + w[1] + " s: " + parts(patch, w[0], w[1]));
  if (check.level) lines.push("    level dBFS every " + check.level + " s: " + levels(x, check.level));
  console.log(lines.join("\n"));
  return { r, b };
}
const json = {};
for (const s of NEW) {
  if (want && want !== s.slug) continue;
  const base = report(s.name, s.patch, s.check);
  writeFileSync(join(OUT, s.slug + ".wav"), Buffer.from(CS.encodeWav(base.r.L, base.r.R, { rate: SR, depth: 16, channels: 2, title: s.name })));
  s.alts.forEach((a, k) => {
    const r = report("  alt" + (k + 1) + " " + a.id, a.patch, s.check);
    writeFileSync(join(OUT, s.slug + "-alt" + (k + 1) + ".wav"), Buffer.from(CS.encodeWav(r.r.L, r.r.R, { rate: SR, depth: 16, channels: 2, title: s.name + " alt " + (k + 1) })));
  });
  const entry = Object.assign({ category: s.category }, s.patch);
  if (s.alts.length) entry._alts = s.alts.map((a) => { const o = Object.assign({}, a.patch); delete o._vary; return o; });
  json[s.name] = entry;
}
if (!want) {
  writeFileSync(join(ROOT, "tools", "new-presets", "servo.json"), JSON.stringify(json, null, 2) + "\n");
  console.log("\n-> soundtests/new-presets/, tools/new-presets/servo.json");
}
