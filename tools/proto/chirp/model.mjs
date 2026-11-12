/* chirp/model.mjs — the "chirp" engine (birdsong + insects), written the way dsp.js writes its buffered engines
 * (makeBubbles, makeParticles, makeWhoosh): a PURE render that builds the whole call into a stereo buffer, which
 * render() then reads per sample. No DOM, no app state, no Math.random (a seeded LCG), every rate in seconds so the
 * random draws do not depend on the sample rate (that is what lets the alias check render it at two rates).
 *
 * THREE CREATURES, ONE SCHEDULER
 *   syllable scheduler (count per group, groups, rate, accel, gap, drift, randomness, chorus of individuals)
 *     |-> syrinx      a near-pure whistle per syllable: phase-accumulated sine on a pitch GESTURE (up, down, arch,
 *     |               dip, warble, chip, whistle), weak 2nd/3rd harmonic, optional SECOND VOICE (the other side of
 *     |               the syrinx) on its own, mirrored gesture.
 *     |-> stridulation one pulse per syllable: a near-pure carrier gliding slightly down through the wing stroke,
 *     |               blended (rasp) with tooth strikes ringing a resonator at the carrier — cricket .. katydid.
 *     '-> buzz        (ignores the scheduler) a wingbeat-rate harmonic buzz on a flight path: Doppler pitch,
 *                     1/r loudness, air absorption and pan follow the pass.
 *   each individual: distance -> gain + air absorption (an analog low-pass gain per partial) -> equal-power pan -> L/R; sum;
 *   peak to 0.85.
 *
 * ANTI-ALIASING: every partial is computed from its INSTANTANEOUS frequency and faded out between 0.40 and 0.46 of
 * the sample rate (tap()), so a fast up-slur at 8 kHz loses its harmonics before they reach Nyquist instead of
 * folding back. The rasp's tooth strikes are impulses into a discrete-time resonator, so there is nothing to alias.
 * Syllable envelopes are raised-cosine with a floor of ~1.5 ms, so no edge is a step.
 */

export const CHIRP_MODES = ["Bird (syrinx)", "Cricket (stridulation)", "Buzz (wings)"];
export const CHIRP_GESTURES = ["Whistle", "Up-slur", "Down-slur", "Arch", "Dip", "Warble", "Chip", "Mixed phrase"];

// Proposed PARAMS rows, in dsp.js/index.html's shape: [key, label, min, max, step, default, unit, group, kind?, list?]
export const CHIRP_PARAMS = [
  ["chirpMode", "Creature", 0, 2, 1, 0, "", "Chirp", "enum", CHIRP_MODES],
  ["chirpPitch", "Pitch", 500, 10000, 1, 3200, "Hz", "Chirp"],
  ["chirpGesture", "Gesture", 0, 7, 1, 1, "", "Chirp", "enum", CHIRP_GESTURES],
  ["chirpSpan", "Slur", 0, 2, 0.01, 0.6, "oct", "Chirp"],
  ["chirpRate", "Syllable rate", 1, 60, 0.1, 8, "/s", "Chirp"],
  ["chirpDuty", "Syllable length", 0.1, 1, 0.01, 0.6, "", "Chirp"],
  ["chirpCount", "Syllables", 1, 40, 1, 3, "", "Chirp"],
  ["chirpGroups", "Phrases", 0, 12, 1, 1, "", "Chirp"],            // 0 = keep going until the sound ends
  ["chirpGroupGap", "Phrase gap", 0, 2, 0.01, 0.25, "s", "Chirp"],
  ["chirpAccel", "Accelerate", -2, 2, 0.01, 0, "oct", "Chirp"],
  ["chirpDrift", "Pitch drift", -2, 2, 0.01, 0, "oct", "Chirp"],
  ["chirpRand", "Randomness", 0, 1, 0.01, 0.2, "", "Chirp"],
  ["chirpHarm", "Harmonics", 0, 1, 0.01, 0.15, "", "Chirp"],
  ["chirpVoice2", "Second voice", 0, 1, 0.01, 0, "", "Chirp"],
  ["chirpInterval", "Voice interval", -12, 12, 0.1, 5, "st", "Chirp"],
  ["chirpRasp", "Rasp", 0, 1, 0.01, 0, "", "Chirp"],
  ["chirpChorus", "Individuals", 1, 8, 1, 1, "", "Chirp"],
];
export const CHIRP_DEFAULTS = Object.fromEntries(CHIRP_PARAMS.map((p) => [p[0], p[5]]));

// knob values -> the model's configuration (the brassCfg(st) of this engine)
export function chirpCfg(st) {
  const g = (k) => (st[k] == null ? CHIRP_DEFAULTS[k] : st[k]);
  return {
    mode: Math.round(g("chirpMode")), pitch: g("chirpPitch"), gesture: Math.round(g("chirpGesture")), span: g("chirpSpan"),
    rate: Math.max(0.5, g("chirpRate")), duty: g("chirpDuty"), count: Math.max(1, Math.round(g("chirpCount"))),
    groups: Math.max(0, Math.round(g("chirpGroups"))), groupGap: g("chirpGroupGap"), accel: g("chirpAccel"), drift: g("chirpDrift"),
    rand: g("chirpRand"), harm: g("chirpHarm"), voice2: g("chirpVoice2"), interval: g("chirpInterval"), rasp: g("chirpRasp"),
    chorus: Math.max(1, Math.round(g("chirpChorus"))),
  };
}

function lcg(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const mix = (seed, k) => ((seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0) || 1;
const rc = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * x));   // raised-cosine edge

// a partial's gain by its instantaneous frequency: 1 below 0.40 sr, 0 above 0.46 sr, a cosine between
// `air` (Hz, optional) is distance: the ANALOG one-pole low-pass magnitude at f, applied per partial, so a far animal is
// duller with no discrete filter in the path (a one-pole filter discretizes differently at each rate; this does not)
function tap(f, sr, air) {
  const a = 0.40 * sr, b = 0.46 * sr, t = f <= a ? 1 : f >= b ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (f - a) / (b - a));
  return air ? t / Math.sqrt(1 + (f / air) * (f / air)) : t;
}

// the pitch gesture of one syllable, as octaves from its center, u = 0..1 through the syllable
function traj(g, u, span, cyc, ph) {
  switch (g) {
    case 0: return u < 0.7 ? 0.02 * span * u : 0.02 * span * 0.7 - span * 0.25 * Math.pow((u - 0.7) / 0.3, 2);   // whistle: held, falls off at the end
    case 1: return span * (0.5 - 0.5 * Math.cos(Math.PI * u) - 0.5);       // up-slur
    case 2: return -span * (0.5 - 0.5 * Math.cos(Math.PI * u) - 0.5);      // down-slur
    case 3: return span * (Math.sin(Math.PI * u) - 0.5);                   // arch: up and over
    case 4: return -span * (Math.sin(Math.PI * u) - 0.5);                  // dip
    case 5: return span * 0.5 * Math.sin(2 * Math.PI * cyc * u + ph);      // warble
    case 6: return span * (0.5 - (1 - Math.pow(1 - u, 3)));                // chip: a steep fall, fastest at the start (finite slope: an infinite one splatters)
    default: return 0;
  }
}
const MIRROR = [1, 2, 1, 4, 3, 5, 6];   // the second voice's gesture: the other side of the syrinx moves the other way
// per-gesture habits, used when the gesture is "Mixed phrase": [rate x, length x, count x, attack frac, release frac]
const HABIT = [[0.3, 0.85, 0.34, 0.2, 0.35], [1, 1, 1, 0.15, 0.3], [1, 1, 1, 0.12, 0.35], [0.8, 1, 0.8, 0.15, 0.3],
  [0.8, 1, 0.8, 0.15, 0.3], [0.45, 0.9, 0.5, 0.15, 0.3], [1.6, 0.45, 1.5, 0.06, 0.6]];

// one individual's syllable plan: [{ t, len, g, c, span, amp, cyc, ph }]
function schedule(cfg, rnd, durSec, start, pm, rm) {
  const ev = [], R = cfg.rand, mixed = cfg.gesture === 7, end = durSec - Math.min(cfg.ring || 0, durSec / 2) - 0.015;
  const total = cfg.groups > 0 ? cfg.groups * cfg.count : 0;
  let t = start, gi = 0, kg = 0, prevG = -1;
  while (t < end && (cfg.groups === 0 || gi < cfg.groups)) {
    let g = cfg.gesture, rateX = 1, lenX = 1, cnt = cfg.count, oct = (rnd() * 2 - 1) * 0.06 * R, gspan = cfg.span;
    if (mixed) {
      // a song has a GRAMMAR: it opens slow (a whistle or an up-slur), develops, and ends on a flourish (a fall,
      // a warble or chips). Groups 0 ("keep going") read every fourth group as a new song.
      const last = cfg.groups > 0 ? cfg.groups - 1 : 3, pos = cfg.groups > 0 ? gi : gi % 4;
      const pool = pos === 0 ? [0, 1] : pos === last ? [2, 5, 6] : [1, 2, 3, 4, 5, 6];
      do { g = pool[Math.floor(rnd() * pool.length)]; } while (g === prevG && pool.length > 1);
      const h = HABIT[g]; rateX = h[0]; lenX = h[1];
      cnt = Math.max(1, Math.round(cfg.count * h[2] * (0.7 + 0.6 * rnd())));
      oct = (rnd() * 2 - 1) * 0.35 * (0.4 + R); gspan = cfg.span * (0.6 + 0.8 * rnd());
    }
    prevG = g;
    let last = null;
    for (let k = 0; k < cnt; k++) {
      const rk = cfg.rate * rm * rateX * Math.pow(2, cfg.accel * (cnt > 1 ? k / (cnt - 1) : 0)), period = 1 / rk;
      const len = Math.max(0.006, Math.min(period * 0.98, cfg.duty * period * lenX * (1 + (rnd() * 2 - 1) * 0.2 * R)));
      if (t + len > end) break;
      const prog = total > 1 ? kg / (total - 1) : cnt > 1 ? k / (cnt - 1) : 0.5;
      const c = cfg.pitch * pm * Math.pow(2, oct + cfg.drift * (prog - 0.5) + (rnd() * 2 - 1) * 0.06 * R);
      const amp = Math.pow(10, (rnd() * 2 - 1) * R * 3 / 20);
      const cyc = Math.max(1, len * (18 + 14 * rnd())), ph = rnd() * 2 * Math.PI;
      last = { t, len, g, c, span: gspan, amp, cyc, ph, h: HABIT[g] || HABIT[1] };
      ev.push(last);
      t += period * (1 + (rnd() * 2 - 1) * 0.15 * R); kg++;
    }
    if (!last) break;
    t = last.t + last.len + cfg.groupGap * (1 + (rnd() * 2 - 1) * 0.3 * R);
    gi++;
  }
  return ev;
}

// Both syllable voices start at the event's EXACT time (the first sample at or after it, with local time measured from
// the true start), so a syllable is the same continuous signal at any sample rate — what lets the alias check compare
// a 44.1 kHz render to a 176.4 kHz one sample-for-sample-in-spirit rather than through rounding jitter.
function span(out, sr, e) {
  const i0 = Math.ceil(e.t * sr), i1 = Math.min(out.length, Math.ceil((e.t + e.len) * sr));
  return { i0, i1, N: i1 - i0 };
}

function syrinx(out, sr, e, cfg, rnd) {
  const { i0, i1, N } = span(out, sr, e);
  if (N < 8) return;
  const a = Math.max(e.h[3], 0.0015 / e.len), r = Math.max(e.h[4], 0.002 / e.len);
  const h2 = cfg.harm * 0.22, h3 = cfg.harm * 0.09, v2 = cfg.voice2, ratio2 = Math.pow(2, cfg.interval / 12), g2 = MIRROR[e.g] ?? 1;
  const TAU = 6.283185307179586;
  let p1 = rnd() * TAU, p2 = rnd() * TAU, prev = e.t, fp1 = -1, fp2 = -1;   // phases integrate by the trapezoid rule (rate-robust on fast slurs)
  for (let i = i0; i < i1; i++) {
    const tl = i / sr - e.t, u = tl / e.len, dt = i / sr - prev; prev = i / sr;
    const shape = rc(u / a) * rc((1 - u) / r);
    const f = e.c * Math.pow(2, traj(e.g, u, e.span, e.cyc, e.ph));
    p1 += TAU * 0.5 * (f + (fp1 < 0 ? f : fp1)) * dt; fp1 = f; if (p1 > TAU) p1 -= TAU;
    const lv = Math.sqrt(shape);   // harmonics grow with the push (louder = a little richer)
    let y = shape * (tap(f, sr, e.air) * Math.sin(p1) + lv * (h2 * tap(2 * f, sr, e.air) * Math.sin(2 * p1) + h3 * tap(3 * f, sr, e.air) * Math.sin(3 * p1)));
    if (v2 > 0) {   // the other side of the syrinx: its own pitch, mirrored gesture, a little late
      const u2 = (u - 0.12) / 0.88, shape2 = u2 <= 0 ? 0 : rc(u2 / a) * rc((1 - u2) / r);
      const f2 = e.c * ratio2 * Math.pow(2, traj(g2, Math.max(0, u2), e.span * 0.8, e.cyc * 0.8, e.ph + 1.3));
      p2 += TAU * 0.5 * (f2 + (fp2 < 0 ? f2 : fp2)) * dt; fp2 = f2; if (p2 > TAU) p2 -= TAU;
      y += v2 * shape2 * tap(f2, sr, e.air) * (Math.sin(p2) + h2 * 0.5 * tap(2 * f2, sr, e.air) * Math.sin(2 * p2));
    }
    out[i] += e.amp * y / (1 + 0.6 * v2);
  }
}

function stridulate(out, sr, e, cfg, rnd) {
  const { i0, i1, N } = span(out, sr, e);
  if (N < 8) return;
  const a = Math.max(0.15, 0.001 / e.len), r = Math.max(0.3, 0.002 / e.len), rasp = cfg.rasp, TAU = 6.283185307179586;
  const h2 = cfg.harm * 0.1, h3 = cfg.harm * 0.04;
  // the rasp: tooth strikes, each a GRAIN — a gammatone (order 4: a sinusoid at the carrier under t^3 e^(-t/tau), tau set
  // by the resonance's bandwidth) placed at its exact time and computed analytically. It is the same signal at any
  // sample rate, and its skirt is ~70 dB down by Nyquist, so nothing folds.
  const buf = rasp > 0 ? new Float64Array(N) : null;
  if (buf) {
    const bw = e.c * (0.06 + 0.45 * rasp), tau = 1 / (2 * Math.PI * bw * 0.4), life = 14 * tau, gnorm = 1 / (27 * Math.exp(-3));
    const toothHz = e.c / (5 + 6 * rasp);
    for (let tt = 0; tt < e.len; tt += (1 / toothHz) * (1 + (rnd() * 2 - 1) * 0.25 * (0.3 + cfg.rand))) {
      const fc = Math.min(0.4 * sr, e.c * Math.pow(2, -e.span * tt / e.len)), amp = (0.5 + rnd() * (0.5 + cfg.rand)) * tap(fc, sr, e.air);
      const k0 = Math.max(0, Math.ceil((e.t + tt) * sr) - i0), k1 = Math.min(N, Math.ceil((e.t + tt + life) * sr) - i0);
      for (let k = k0; k < k1; k++) {
        const dt = (i0 + k) / sr - e.t - tt, x = dt / tau;
        if (x > 0) buf[k] += amp * gnorm * x * x * x * Math.exp(-x) * Math.sin(TAU * fc * dt);
      }
    }
    // normalized by RMS to a unit sine's (rate-robust, where a sampled peak is not), at the carrier's own air gain
    let ss = 0; for (let k = 0; k < N; k++) ss += buf[k] * buf[k];
    const rms = Math.sqrt(ss / N), ref = tap(e.c, sr, e.air) * Math.SQRT1_2;
    if (rms > 0) for (let k = 0; k < N; k++) buf[k] *= ref / rms;
  }
  let p = rnd() * TAU, prev = e.t, fp = -1;
  for (let k = 0; k < N; k++) {
    const i = i0 + k, u = (i / sr - e.t) / e.len, dt = i / sr - prev; prev = i / sr;
    const env = rc(u / a) * rc((1 - u) / r) * (0.55 + 0.45 * u) * e.amp;
    const f = e.c * Math.pow(2, -e.span * u);   // the wing closes: the carrier glides a little down
    p += TAU * 0.5 * (f + (fp < 0 ? f : fp)) * dt; fp = f; if (p > TAU) p -= TAU;
    const tone = tap(f, sr, e.air) * Math.sin(p) + h2 * tap(2 * f, sr, e.air) * Math.sin(2 * p) + h3 * tap(3 * f, sr, e.air) * Math.sin(3 * p);
    out[i] += env * (buf ? (1 - rasp) * tone + rasp * buf[k] : tone);
  }
}

// a wingbeat buzz flying past: Doppler (span = octaves of shift at the ends), 1/r level, air absorption, pan
function buzz(L, R, sr, cfg, seed) {
  const n = L.length, rnd = lcg(seed), dur = n / sr, R0 = cfg.rand;
  // a slow random walk (nodes every 1/25 s, so the draws are per SECOND, not per sample)
  const nodes = Math.ceil(dur * 25) + 3, wf = new Float64Array(nodes), wa = new Float64Array(nodes);
  let vf = 0, va = 0;
  for (let k = 0; k < nodes; k++) { vf = 0.85 * vf + (rnd() * 2 - 1) * 0.5; va = 0.8 * va + (rnd() * 2 - 1) * 0.5; wf[k] = vf; wa[k] = va; }
  const W = 1.5 + 2 * rnd(), dir = rnd() < 0.5 ? -1 : 1, tilt = 1.6 - 0.9 * cfg.harm;
  const KMAX = Math.floor(0.46 * sr / (cfg.pitch * Math.pow(2, -Math.abs(cfg.span)) * 0.8)) + 2, wk = new Float64Array(KMAX + 1);
  for (let k = 1; k <= KMAX; k++) wk[k] = Math.pow(k, -tilt);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = dir * (t / dur - 0.5) * 2 * W, rr = Math.sqrt(1 + x * x), xr = x / rr;
    const q = t * 25, k0 = Math.floor(q), fr = q - k0, wob = wf[k0] * (1 - fr) + wf[k0 + 1] * fr, amw = wa[k0] * (1 - fr) + wa[k0 + 1] * fr;
    const f = cfg.pitch * Math.pow(2, -cfg.span * xr * 0.5 + wob * 0.05 * (0.3 + R0));
    ph += 2 * Math.PI * f / sr; if (ph > 6.283185307179586) ph -= 6.283185307179586;
    // the harmonic series by the sine recurrence, k^-tilt, faded below Nyquist
    const K = Math.min(KMAX, Math.floor(0.46 * sr / f)), c2 = 2 * Math.cos(ph);
    let s1 = Math.sin(ph), s0 = 0, y = 0;
    const fcA = 2500 + 9000 / rr;   // closer = brighter (air absorption by distance)
    for (let k = 1; k <= K; k++) { y += s1 * wk[k] * tap(k * f, sr, fcA); const s = c2 * s1 - s0; s0 = s1; s1 = s; }
    const amp = (1 / rr) * (1 + amw * 0.25 * (0.3 + R0)) * rc(t / 0.03) * rc((dur - t) / 0.03);
    const lp = y * amp;
    const pan = xr * 0.7, pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    L[i] += lp * pl; R[i] += lp * pr;
  }
}

/* makeChirp(sr, n, cfg, seed) -> { L, R, events }
 *   sr    sample rate (44100 in the app; anything, for the alias check)
 *   n     length in samples (the patch's duration)
 *   cfg   chirpCfg(st)
 *   seed  integer
 * events: the plan (seconds, Hz) of every syllable/pulse, per individual, for measurement. */
export function makeChirp(sr, n, cfg, seed) {
  const L = new Float32Array(n), R = new Float32Array(n), events = [];
  if (n < 16) return { L, R, events };
  if (cfg.mode === 2) buzz(L, R, sr, cfg, seed);
  else {
    const C = cfg.chorus, durSec = n / sr, one = new Float64Array(n);
    // one cycle of the song (a group and its gap), so a chorus can be spread across it (rand) or held together (rand ~ 0)
    const cycle = cfg.count / cfg.rate + cfg.groupGap;
    for (let c = 0; c < C; c++) {
      const rnd = lcg(mix(seed, c));
      const pm = c === 0 ? 1 : Math.pow(2, (rnd() * 2 - 1) * 0.12);                  // individuals differ in pitch...
      // ...and in tempo and timing, both by `rand`: near 0 the chorus holds together (tree crickets synchronize), at
      // ~0.3 and up every individual keeps its own time
      const rm = c === 0 ? 1 : 1 + (rnd() * 2 - 1) * 0.15 * cfg.rand;
      const start = 0.005 + (c === 0 ? 0 : rnd() * cycle * Math.pow(Math.min(1, cfg.rand * 3), 2) + rnd() * 0.003);
      const dist = c === 0 ? 0 : 0.25 + 0.75 * rnd(), pan = c === 0 ? 0 : (rnd() * 2 - 1) * 0.9;
      const ev = schedule(cfg, rnd, durSec, start, pm, rm), air = dist > 0 ? 16000 * Math.pow(0.18, dist) : 0;
      for (const e of ev) e.air = air;
      one.fill(0);
      // each syllable draws from its OWN generator, so a sample-count rounding inside one (a tooth more or less) cannot
      // shift the draws of every syllable after it — the same sound at any sample rate
      ev.forEach((e, k) => (cfg.mode === 1 ? stridulate : syrinx)(one, sr, e, cfg, lcg(mix(mix(seed, c), 1000 + k))));
      const gain = 1 / (1 + 2.5 * dist);
      const pl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, pr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
      for (let i = 0; i < n; i++) { const v = one[i] * gain; L[i] += v * pl; R[i] += v * pr; }
      events.push(ev.map((e) => ({ t: e.t, len: e.len, g: cfg.mode === 1 ? -1 : e.g, c: e.c, span: e.span, who: c })));
    }
  }
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  if (pk > 1e-9) { const g = 0.85 / pk; for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; } }
  return { L, R, events: events.flat() };
}
