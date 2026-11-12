/* flow.mjs — PROTOTYPE of a "flow" synthesis engine for CrunchySFX (moving water: stream / waterfall / surf / pour), and
 * the CLI that renders its blind listening round.
 *
 *   node tools/proto/flow.mjs            render the round into soundtests/proto-flow/
 *   node tools/proto/flow.mjs --measure  the same, and print the per-take measurements in full
 *   node tools/proto/flow.mjs --probe-babble   only the babble sweep: does `babble` show in the audio (8 s dry streams)
 *
 * WHY. Every moving-water preset in "Nature" (Waterfall, Ocean Surf, Stream Babble, Wave of Water, Water Ambient, the
 * Tides and Cascades) is a sine plus filtered noise, and the "Water / Liquid" category is the bubble engine (wave 14,
 * `makeBubbles`), which does single bubbles well but scatters them uniformly in time and size: it has no BODY of water.
 * The question this round asks is whether a model of what the water is DOING is clearly better than noise:
 *
 *   STREAM     water over stones. The sound is bubbles and small cavities resonating (Minnaert pings, f0 = 3.26 / r,
 *              damping d = 0.13 / r + 0.0072 r^-1.5, pitch rising f(t) = f0 (1 + sigma d t) as the bubble nears the
 *              surface), but NOT scattered uniformly: they come from POCKETS (a gap behind a stone, a lip, an eddy), each
 *              with its own bubble size and pan, firing short CLUSTERS that RECUR. The babble is that recurrence: the same
 *              few gurgles coming back, slightly irregular, while pockets slowly form and wash out. Some pockets are
 *              cavities (a hollow tonk: a noise-excited resonance, not a sine). Under it, turbulent flow noise.
 *   WATERFALL  the dense limit: thousands of bubbles a second with a broad size spread merge into a slightly PITCHED roar
 *              (the hump sits where the commonest bubble size rings), plus the impact thunder at the base (a low rumble
 *              that swells, with thumps of mass hitting the pool) and spray hiss (high, only up close).
 *   SURF       cyclic. Each wave BUILDS (a rising low swell), BREAKS (a broadband crash spilling along the wave front, so
 *              the crash travels across the stereo field, with a thump, then FOAM: a burst of thousands of tiny bubbles
 *              fizzing out), WASHES up the beach, then DRAWS BACK (a long receding hiss for sand, a rattle of stones
 *              knocking for pebbles: drawback 0..1 crossfades the two), every `period` s with variation in size and
 *              timing, the next swell rising under the last drawback. A far bed of other waves underneath.
 *   POUR       a jet into a vessel. The jet's turbulence and the bubbles it entrains excite the air column above the
 *              liquid, a quarter-wave tube closed at the liquid surface: f_k = (2k-1) c / (4 (L_air + 0.6 r_mouth)).
 *              As the vessel fills, L_air shrinks and the resonance rises, hyperbolically (slow at first, racing at the
 *              end): the "filling a bottle" sound. A narrow bottle rings (Q ~30), a wide glass barely (Q ~6). `babble`
 *              here is GLUGGING: the flow from the pouring bottle stutters as air gulps back into it.
 *
 * PORTABLE SHAPE (how it would port into dsp.js): `makeFlow(sr, cfg, seed)` is a pure factory like makeBubbles /
 * makeWeather: no DOM, no Math.random (own seeded LCG), returns { tick(drive, out), info }. tick writes one stereo sample
 * into out[0], out[1]. `drive` (0..1) is the patch's amp envelope: for STREAM and WATERFALL it scales the FLOW (event
 * rates and the bed), so a release lets already-entrained bubbles ring out instead of cutting them; for SURF it is a
 * plain gain (the cycle runs on its own clock); for POUR it is the JET (excitation and how fast the vessel fills). In
 * synth.js the engine would be a wave branch that calls tick(env) per sample and adds out[] into sL/sR, ahead of the
 * filter / drive / reverb chain like every other wave. `cfg.dur` (the patch duration) is read only by POUR, to spread
 * the fill over the sound.
 *
 * THE ROOM. Model takes get the control preset's OWN Freeverb (dsp.js `reverbProcess`, same size / tone / wet as the
 * control), loaded from dsp.js in a vm: stereo kept. Same choice as weather.mjs, for the same reason: `wave: 9` sample
 * playback is mono and would collapse the field (pockets panned across a stream, a crash travelling along a wave).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

const FL_DEFAULTS = {
  type: 0,          // 0 stream, 1 waterfall, 2 surf, 3 pour
  flow: 0.5,        // amount of water: bubble/cluster rates, turbulence, roar
  size: 2,          // typical bubble radius in mm (0.3 fizz .. 10 glug); pitch = 3.26 / r
  babble: 0.5,      // stream/waterfall: how REGULARLY pockets recur (0 Poisson .. 1 near-periodic); pour: glugging
  body: 0.3,        // low weight: stream gurgle, waterfall impact thunder, surf swell + thump
  rise: 0.3,        // bubble pitch rise (sigma); surface bubbles rise more
  period: 8,        // surf: seconds per wave (jittered per wave)
  waveSize: 0.6,    // surf: crash size / spill length / foam
  drawback: 0.3,    // surf: 0 sand (hiss) .. 1 pebbles (rattle)
  phase: 0.1,       // surf: where in the first wave's cycle the sound starts (0 = start of the swell)
  waves: 0,         // surf: 0 endless, n = only n waves (a one-shot)
  fill: 0.85,       // pour: how full the vessel is at the end
  fillStart: 0.05,  // pour: how full it is at the start
  vessel: 0.2,      // pour: 0 narrow tall bottle (rings) .. 1 wide short glass (barely)
  distance: 0.2,    // 0 at the water's edge .. 1 far: air absorption, detail sinks into the bed
  width: 0.7, tone: 0.5, dur: 2,
};
const C_AIR = 343;

function flRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function flGauss(rnd) { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// value noise with cosine interpolation: a smooth random curve at about `hz` changes a second, range ±1
function flSmooth(sr, hz, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = rnd();
  const inc = hz / sr;
  return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } const u = 0.5 - 0.5 * Math.cos(Math.PI * ph); return a + (b - a) * u; };
}
// TPT state-variable filter (Simper). tick returns the band output; .lp / .hp hold the others. k = 1/Q.
function flSvf() { return { ic1: 0, ic2: 0, lp: 0, hp: 0 }; }
function flSvfTick(f, x, g, k) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const v3 = x - f.ic2, v1 = a1 * f.ic1 + a2 * v3, v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
  f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2; f.lp = v2; f.hp = x - k * v1 - v2;
  return v1;
}
const flG = (fc, sr) => Math.tan(Math.PI * clamp(fc, 5, sr * 0.45) / sr);
// unit-RMS makeup for uniform white noise (variance 1/3) through a unit-peak band of quality Q at fc
const flMk = (fc, Q, sr) => Math.sqrt(3 * Q * sr / (Math.PI * Math.max(fc, 5)));
const flPan = (p) => [Math.cos((clamp(p, -1, 1) + 1) * Math.PI / 4), Math.sin((clamp(p, -1, 1) + 1) * Math.PI / 4)];

// ---------------------------------------------------------------- the event voices every type shares
// BUBBLE: a Minnaert bubble, a decaying sine whose pitch rises as it rings. BURST: a band of noise with an attack and a
// decay (a slap, a crash fragment, a thump, a pebble knock; a high Q makes it a ringing cavity "tonk").
function flVoices(sr, rnd, info) {
  const vs = [];
  const white = () => rnd() * 2 - 1;
  return {
    count: () => vs.length,
    bubble(rmm, amp, pan, sigma, delay, tag) {
      const r = clamp(rmm, 0.15, 25) * 1e-3;
      const f0 = Math.min(3.26 / r, 0.42 * sr), d = 0.13 / r + 0.0072 * Math.pow(r, -1.5);
      const w0 = 2 * Math.PI * f0 / sr, [pl, pr] = flPan(pan);
      vs.push({ k: 0, ph: 0, w: w0, dw: w0 * sigma * d / sr, e: amp, m: Math.exp(-d / sr), end: amp * 1e-3, pl, pr, delay: delay | 0, tag: tag || "bubble" });
      info.bubbles++;
    },
    burst(fc, Q, ta, tau, amp, pan, delay, tag) {
      fc = clamp(fc, 20, 0.45 * sr);
      const w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al, [pl, pr] = flPan(pan);
      vs.push({ k: 1, b0: al / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0,
        eb: 1, mb: Math.exp(-1 / (sr * tau)), ea: ta > 0 ? 1 : 0, ma: ta > 0 ? Math.exp(-1 / (sr * ta)) : 0,
        mk: Math.min(40, flMk(fc, Q, sr)) * amp, age: 0, life: Math.ceil(sr * (7 * tau + 7 * Q / (Math.PI * fc) + 3 * ta)), pl, pr, delay: delay | 0, tag: tag || "burst" });
      info.bursts++;
    },
    tick(o) {
      let L = 0, R = 0;
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i];
        if (v.delay > 0) { v.delay--; continue; }
        let y, dead;
        if (v.k === 0) {
          y = v.e * Math.sin(v.ph); v.ph += v.w; v.w += v.dw; v.e *= v.m;
          dead = v.e < v.end || v.w > 2.8;
        } else {
          const x = white() * (v.eb - v.ea); v.eb *= v.mb; v.ea *= v.ma;
          const yy = v.b0 * (x - v.x2) - v.a1 * v.y1 - v.a2 * v.y2; v.x2 = v.x1; v.x1 = x; v.y2 = v.y1; v.y1 = yy;
          y = yy * v.mk; dead = ++v.age > v.life;
        }
        L += y * v.pl; R += y * v.pr; info.tagE[v.tag] = (info.tagE[v.tag] || 0) + y * y;
        if (dead) { vs[i] = vs[vs.length - 1]; vs.pop(); }
      }
      if (vs.length > info.maxVoices) info.maxVoices = vs.length;
      o[0] = L; o[1] = R;
    },
  };
}

// ---------------------------------------------------------------- STREAM
function flStream(sr, c, rnd, V, info) {
  const K = Math.max(2, Math.round(3 + 11 * c.flow)), white = () => rnd() * 2 - 1;
  const dampOf = (rmm) => { const r = rmm * 1e-3; return 0.13 / r + 0.0072 * Math.pow(r, -1.5); };
  const pockets = [];
  info.pockets = K; info.clusters = 0; info.intervals = []; info.ivSec = [];
  function pocket(t, first) {
    const r = clamp(c.size * Math.exp(0.55 * flGauss(rnd)), 0.4, 14);
    const T = (0.1 + 0.45 * rnd()) * (1.35 - 0.6 * c.flow);                       // mean recurrence (s)
    const life = sr * (3 + 6 * rnd());
    const P = { r, T, pan: (rnd() * 2 - 1) * c.width, amp: 0.45 + 0.55 * rnd(), n: 1 + Math.floor(rnd() * (1.5 + 3 * c.flow)),
      fig: null, cav: rnd() < 0.35, cavF: 3.26 / (r * 1e-3) * (0.55 + 0.25 * rnd()), cavQ: 10 + 8 * rnd(), slapF: 1500 * Math.pow(2, 2 * rnd()), next: t + Math.floor((first ? rnd() : 0.3 + 0.7 * rnd()) * T * sr), die: t + Math.floor(first ? rnd() * life : life), last: -1 };
    P.fig = []; for (let b = 0; b < P.n; b++) P.fig.push(0.004 + 0.03 * rnd());
    return P;
  }
  for (let i = 0; i < K; i++) pockets.push(pocket(0, true));
  const turbL = flSvf(), turbR = flSvf(), lowL = flSvf(), lowR = flSvf();
  const eddy = flSmooth(sr, 3, rnd), eddy2 = flSmooth(sr, 0.7, rnd);
  const turbFc = 2000 * Math.pow(2, 1.4 * (c.tone - 0.5)), gT = flG(turbFc, sr), mkT = flMk(turbFc, 0.5, sr), gLo = flG(240, sr);
  const bgRate = c.flow * (8 + 110 * c.flow);                                    // fizz grows faster than the pockets: a trickle is all pockets
  let t = 0;
  return (drive, o) => {
    for (let i = 0; i < pockets.length; i++) {
      let p = pockets[i];
      if (t >= p.die) { p = pockets[i] = pocket(t, false); }
      if (t >= p.next) {
        // a cluster: n bubbles of this pocket's size, a few ms apart, sometimes led by a slap or a cavity tonk
        if (rnd() < drive) {
          // a pocket has a FIGURE (how many bubbles, how far apart): with probability `babble` it repeats it, so what
          // comes back is the same gurgle, not just the same pitch
          const same = rnd() < c.babble;
          const n = same ? p.fig.length : Math.max(1, p.n + Math.round(flGauss(rnd) * 0.7));
          let d = 0;
          if (p.cav) V.burst(p.cavF, p.cavQ, 0.0004, 0.004 + 0.003 * rnd(), 0.5 * p.amp, p.pan, 0, "cavity");
          else if (rnd() < 0.7) V.burst(p.slapF, 0.9, 0, 0.002 + 0.003 * rnd(), 0.7 * p.amp, p.pan, 0, "slap");
          for (let b = 0; b < n; b++) {
            const r = p.r * Math.exp(0.04 * flGauss(rnd));            // one pocket, one size: its gurgle comes back at its pitch
            // a big bubble is louder, but less than its longer ring alone would make it (energy ~ r^1.2, not r^2.4)
            V.bubble(r, p.amp * 0.8 * Math.pow(r / 2, 0.35) * Math.sqrt(dampOf(r) / dampOf(2)) * (0.6 + 0.4 * rnd()), p.pan + 0.1 * (rnd() - 0.5), c.rise * (0.6 + 0.8 * rnd()), d);
            d += sr * (same ? p.fig[b] * (1 + 0.05 * flGauss(rnd)) : 0.004 + 0.03 * rnd());
          }
          info.clusters++;
          if (p.last >= 0 && info.intervals.length < 4000) { info.intervals.push((t - p.last) / sr / p.T); info.ivSec.push((t - p.last) / sr); }
          p.last = t;
        }
        // recurrence: babble 1 -> near-periodic (±12%), 0 -> Poisson with the same mean
        const iv = p.T * (c.babble * (1 + 0.12 * flGauss(rnd)) + (1 - c.babble) * -Math.log(Math.max(1e-6, rnd())));
        p.next = t + Math.max(Math.floor(0.03 * sr), Math.floor(iv * sr));
      }
    }
    // loose small bubbles: the fizz between the gurgles
    if (rnd() < bgRate * drive / sr) {
      const r = clamp(c.size * 0.5 * Math.exp(0.6 * flGauss(rnd)), 0.3, 6);
      V.bubble(r, 0.22 * Math.pow(r / 2, 0.7), (rnd() * 2 - 1) * c.width, c.rise, 0, "fizz");
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    // the flow: turbulent noise, swirling with the eddies; a low gurgle for body
    const tb = drive * (0.08 + 0.25 * c.flow) * (1 + 0.35 * eddy()) * (1 + 0.2 * eddy2());
    let L = flSvfTick(turbL, white(), gT, 2) * 2 * mkT * tb, R = flSvfTick(turbR, white(), gT, 2) * 2 * mkT * tb;
    if (c.body > 0) {
      flSvfTick(lowL, white(), gLo, 1.2); flSvfTick(lowR, white(), gLo, 1.2);
      const ab = drive * c.body * 0.25 * (1 + 0.6 * eddy());
      L += ab * lowL.lp * 7; R += ab * lowR.lp * 7;
    }
    info.eventE += o[0] * o[0] + o[1] * o[1]; info.bedE += L * L + R * R;
    o[0] += L; o[1] += R;
    t++;
  };
}

// ---------------------------------------------------------------- WATERFALL
function flWaterfall(sr, c, rnd, V, info) {
  const white = () => rnd() * 2 - 1;
  const rate = 500 + 5500 * c.flow, thumpRate = 2 + 9 * c.babble;
  const hump = Math.min(0.4 * sr, 3.26 / (c.size * 1e-3) * 0.85);
  const dampOf = (rmm) => { const r = rmm * 1e-3; return 0.13 / r + 0.0072 * Math.pow(r, -1.5); }, d0 = dampOf(c.size);
  info.hump = hump;
  const rL = flSvf(), rR = flSvf(), bL = flSvf(), bR = flSvf(), b2L = flSvf(), b2R = flSvf(), sL = flSvf(), sR = flSvf();
  const gH = flG(hump * 1.3, sr), mkH = flMk(hump * 1.3, 0.5, sr), gB = flG(110, sr), gS = flG(6500 * Math.pow(2, c.tone - 0.5), sr);
  const swell = flSmooth(sr, 1.6, rnd), swell2 = flSmooth(sr, 0.45, rnd), shimmer = flSmooth(sr, 9, rnd);
  let t = 0;
  return (drive, o) => {
    const lam = rate * drive / sr;
    if (rnd() < lam) {
      // equal ENERGY per bubble across the size spread (a big bubble rings longer, so it gets less amplitude): the
      // cloud's spectrum then sits on the commonest size instead of sliding down to the few biggest
      const r = clamp(c.size * Math.exp(0.55 * flGauss(rnd)), 0.25, 12);
      V.bubble(r, 0.15 * Math.sqrt(dampOf(r) / d0) * (0.4 + 0.6 * rnd()), (rnd() * 2 - 1) * c.width, c.rise * 0.5, 0);
    }
    if (c.body > 0 && rnd() < thumpRate * drive / sr) {                            // mass hitting the pool
      V.burst(45 + 70 * rnd(), 0.8, 0.006, 0.08 + 0.18 * rnd(), c.body * (0.5 + 0.5 * rnd()) * 0.5, (rnd() * 2 - 1) * 0.5 * c.width, 0, "thump");
      info.thumps++;
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    info.eventE += o[0] * o[0] + o[1] * o[1];
    // the roar: the bubbles too many to hear one by one, a wide band centred on the hump
    const ra = drive * (0.1 + 0.3 * c.flow) * (1 + 0.12 * shimmer());
    let L = flSvfTick(rL, white(), gH, 2) * 2 * mkH * ra, R = flSvfTick(rR, white(), gH, 2) * 2 * mkH * ra;
    // impact thunder at the base: low noise that swells
    if (c.body > 0) {
      const sw = 0.55 + 0.45 * swell() + 0.25 * swell2(), ab = drive * c.body * 0.35 * Math.max(0.1, sw);
      flSvfTick(bL, white(), gB, 1.1); flSvfTick(bR, white(), gB, 1.1);
      flSvfTick(b2L, bL.lp, gB, 1.1); flSvfTick(b2R, bR.lp, gB, 1.1);
      L += ab * b2L.lp * 9; R += ab * b2R.lp * 9;
    }
    // spray: high hiss, mostly up close
    const sa = drive * c.flow * 0.16 * (1 - c.distance) * (1 + 0.3 * shimmer());
    flSvfTick(sL, white(), gS, 1.2); flSvfTick(sR, white(), gS, 1.2);
    L += sa * sL.hp * 2.2; R += sa * sR.hp * 2.2;
    info.bedE += L * L + R * R;
    o[0] += L; o[1] += R;
    t++;
  };
}

// ---------------------------------------------------------------- SURF
function flSurf(sr, c, rnd, V, info) {
  const white = () => rnd() * 2 - 1;
  const waves = [];
  info.breaks = []; info.waveStarts = []; info.parts = { swell: 0, crash: 0, wash: 0, sand: 0, bed: 0 };
  let t = 0, spawned = 0, nextStart = Math.floor(-c.phase * c.period * sr);
  function spawn(t0) {
    const P = c.period * clamp(1 + 0.18 * flGauss(rnd), 0.7, 1.35), A = clamp(c.waveSize * (0.75 + 0.5 * rnd()), 0.05, 1.3);
    const tb = 0.3 * P, spill = 0.25 + 0.55 * A;
    const p0 = (rnd() * 2 - 1) * 0.6, dir = rnd() < 0.5 ? -1 : 1;
    waves.push({ t0, P, A, tb, spill, p0, p1: clamp(p0 + dir * (0.6 + 0.6 * rnd()), -1, 1), thumped: false, end: t0 + Math.floor(P * 1.6 * sr) });
    info.waveStarts.push(t0 / sr); info.breaks.push((t0 + tb * sr) / sr);
    spawned++;
    return P;
  }
  const swL = flSvf(), swR = flSvf(), crL = flSvf(), crR = flSvf(), crHL = flSvf(), crHR = flSvf(), waL = flSvf(), waR = flSvf();
  const saL = flSvf(), saR = flSvf(), bedL = flSvf(), bedR = flSvf(), lisL = flSvf(), lisR = flSvf();
  const grit = flSmooth(sr, 180, rnd), grit2 = flSmooth(sr, 35, rnd), bedMod = flSmooth(sr, 0.25, rnd);
  const gCr = flG(4200 * Math.pow(2, c.tone - 0.5), sr), gCrH = flG(140, sr), gWa = flG(1800 * Math.pow(2, c.tone - 0.5), sr), mkWa = flMk(1800, 0.5, sr);
  const gBed = flG(380, sr), gLis = flG(9000, sr);
  return (drive, o) => {
    while (t >= nextStart && (!c.waves || spawned < c.waves)) nextStart += Math.floor(spawn(nextStart) * sr);
    let sw = 0, swFc = 0, crash = 0, cpan = 0, wash = 0, sand = 0, sandFc = 0, peb = 0, foam = 0, lisp = 0;
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], s = (t - w.t0) / sr, A = w.A, P = w.P;
      if (t > w.end) { waves.splice(i, 1); continue; }
      if (s < 0) continue;
      // BUILD: the swell rises under the next wave, until it breaks; then it collapses fast
      if (s < w.tb) { const u = s / w.tb; sw += A * u * u; swFc += A * u * u * (60 + 260 * Math.pow(u, 1.5)); lisp += A * Math.pow(u, 6); }
      else { const v = Math.exp(-(s - w.tb) / 0.25); sw += A * v; swFc += A * v * 320; }
      const sb = s - w.tb, Ac = 1.65 * A * A;          // the crash grows faster than the wash: a small wave mostly washes
      if (sb >= 0) {
        // BREAK: the crash spills along the front (sub-crashes travelling across the field) over a decaying roar
        if (!w.thumped) { w.thumped = true; V.burst(55 + 30 * rnd(), 0.7, 0.012, 0.25 + 0.2 * A, c.body * Ac * 1.5, w.p0 * 0.5, 0, "thump"); }
        const u = sb / w.spill;
        if (u < 1 && rnd() < (12 + 70 * A) * drive / sr) {
          const pan = w.p0 + (w.p1 - w.p0) * u;
          V.burst(350 * Math.pow(2, 3.2 * rnd()), 0.6 + 0.6 * rnd(), 0.004 + 0.02 * rnd(), 0.04 + 0.1 * rnd(), 0.45 * Ac * (0.35 + 0.65 * rnd()) * (1 - 0.5 * u), pan, 0, "crash");
        }
        const crE = Ac * (1 - Math.exp(-sb / 0.07)) * Math.exp(-sb / (0.5 + 0.7 * A));
        crash += crE; cpan += crE * (w.p0 + (w.p1 - w.p0) * Math.min(1, u));
        foam += A * (1 - Math.exp(-sb / 0.05)) * Math.exp(-sb / (0.5 + 0.7 * A));
        // WASH: the water running up the beach
        const x = (sb - 0.03 * P) / (0.32 * P);
        if (x > 0 && x < 1) wash += A * 0.7 * Math.sin(Math.PI * x) * (1 - 0.4 * x);
        // DRAWBACK: receding over the rest of the cycle, the hiss thinning and darkening as the film of water thins
        const sd = sb - 0.2 * P;
        if (sd > 0) {
          const td = 0.42 * P, g = A * Math.min(1, sd / 0.4) * Math.exp(-sd / td);
          sand += g; sandFc += g * (1300 + 4200 * Math.exp(-sd / td)); peb += g;
        }
      }
    }
    const k = 1 - c.drawback;
    // events: foam bubbles (tiny, high), pebbles knocking (clustered: stones rolling knock several times)
    if (foam > 1e-3 && rnd() < 3800 * foam * c.waveSize * drive / sr) {
      const r = clamp(0.55 * Math.exp(0.5 * flGauss(rnd)), 0.18, 2.5);
      V.bubble(r, 0.05 + 0.08 * rnd(), cpan / (crash || 1) + (rnd() * 2 - 1) * 0.7 * c.width, 0.2, 0, "foam");
      info.foamBubbles++;
    }
    if (c.drawback > 0 && peb > 1e-3 && rnd() < 260 * peb * c.drawback * drive / sr) {
      const pan = (rnd() * 2 - 1) * c.width, f = 1600 * Math.pow(2, 2 * rnd()), nk = 1 + Math.floor(rnd() * 3);
      let d = 0;
      for (let q = 0; q < nk; q++) {
        V.burst(f * (0.9 + 0.2 * rnd()), 5 + 6 * rnd(), 0, 0.0015 + 0.0035 * rnd(), 0.5 * c.drawback * Math.min(1, peb * 1.5) * (0.4 + 0.6 * rnd()), pan, d, "pebble");
        d += sr * (0.008 + 0.03 * rnd());
      }
      info.pebbleKnocks += nk;
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    info.eventE += o[0] * o[0] + o[1] * o[1];
    // the beds
    let L = 0, R = 0;
    const swF = sw > 1e-4 ? swFc / sw : 100, gSw = flG(swF, sr), as = c.body * 0.55 * sw;
    flSvfTick(swL, white(), gSw, 1.3); flSvfTick(swR, white(), gSw, 1.3);
    L += as * swL.lp * 6; R += as * swR.lp * 6;
    const P = info.parts; let l0 = L; P.swell += l0 * l0;
    // the lip feathering just before it breaks
    if (lisp > 1e-4) { flSvfTick(lisL, white(), gLis, 1); flSvfTick(lisR, white(), gLis, 1); L += 0.08 * lisp * lisL.hp; R += 0.08 * lisp * lisR.hp; }
    if (crash > 1e-4) {
      const [pl, pr] = flPan(cpan / crash * c.width);
      const nl = white(), nr = white();
      flSvfTick(crL, nl, gCr, 0.8); flSvfTick(crR, nr, gCr, 0.8); flSvfTick(crHL, crL.lp, gCrH, 0.8); flSvfTick(crHR, crR.lp, gCrH, 0.8);
      L += 0.9 * crash * crHL.hp * pl * 1.4; R += 0.9 * crash * crHR.hp * pr * 1.4;
    }
    P.crash += (L - l0) * (L - l0); l0 = L;
    if (wash > 1e-4) {
      const aw = 0.14 * wash * (1 + 0.25 * grit2());
      L += aw * flSvfTick(waL, white(), gWa, 2) * 2 * mkWa; R += aw * flSvfTick(waR, white(), gWa, 2) * 2 * mkWa;
    }
    P.wash += (L - l0) * (L - l0); l0 = L;
    if (sand > 1e-4 && k > 0) {
      const g = flG(sandFc / sand, sr), gr = 0.55 + 0.45 * Math.abs(grit()) * 1.6;      // the grain: fast, rough level
      const yl = flSvfTick(saL, white(), g, 1.4), yr = flSvfTick(saR, white(), g, 1.4);
      const a = 1.3 * sand * k * gr;
      L += a * yl; R += a * yr;
    }
    P.sand += (L - l0) * (L - l0); l0 = L;
    // far waves: a low, slowly heaving bed so the gaps are never dead silence
    const ab = (0.012 + 0.03 * c.body) * (1 + 0.5 * bedMod());
    flSvfTick(bedL, white(), gBed, 1.2); flSvfTick(bedR, white(), gBed, 1.2);
    L += ab * bedL.lp * 5; R += ab * bedR.lp * 5;
    P.bed += (L - l0) * (L - l0);
    info.bedE += L * L + R * R;
    o[0] = (o[0] + L) * drive; o[1] = (o[1] + R) * drive;
    t++;
  };
}

// ---------------------------------------------------------------- POUR
function flPour(sr, c, rnd, V, info) {
  const white = () => rnd() * 2 - 1;
  const vs = clamp(c.vessel, 0, 1);
  const H = 0.3 - 0.18 * vs, rMouth = 0.009 + 0.03 * vs, Q1 = 30 - 24 * vs;          // bottle 0.30 m / r 9 mm / Q 30 .. glass 0.12 / 39 / 6
  const fillRate = (c.fill - c.fillStart) / Math.max(0.1, c.dur * 0.92) / sr;
  let fill = c.fillStart;
  const modes = [1, 3, 5].map((m, i) => ({ m, g: [1, 0.45, 0.22][i], Q: Q1 * (1 + 0.6 * i), x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, a1: 0, a2: 0, mk: 1 }));
  const flutter = flSmooth(sr, 22, rnd), flutter2 = flSmooth(sr, 4, rnd);
  const spL = flSvf(), spR = flSvf(), gSp = flG(3500 * Math.pow(2, c.tone - 0.5), sr);
  const glugRate = 5.5 + 2 * rnd();
  let glugPh = 0.3, glugHz = glugRate, t = 0, kick = 0;
  info.f1 = []; info.glugs = 0;
  const f1Of = () => C_AIR / (4 * (Math.max(0.004, H * (1 - fill)) + 0.6 * rMouth));
  function coeffs() {
    const f1 = f1Of();
    for (const m of modes) {
      const fc = Math.min(0.45 * sr, f1 * m.m), w0 = 2 * Math.PI * fc / sr, al = Math.sin(w0) / (2 * m.Q), a0 = 1 + al;
      m.b0 = al / a0; m.a1 = -2 * Math.cos(w0) / a0; m.a2 = (1 - al) / a0; m.mk = Math.min(60, flMk(fc, m.Q, sr)) * m.g / Math.sqrt(m.Q / 6);
    }
    return f1;
  }
  coeffs();
  return (drive, o) => {
    // glug: the pouring bottle stutters as air gulps back into it (flow on for ~70% of each glug, then cut off while
    // the air goes in); each restart slaps and entrains a couple of big bubbles
    let jet = drive;
    if (c.babble > 0) {
      glugPh += glugHz / sr;
      if (glugPh >= 1) {
        glugPh -= 1; glugHz = glugRate * (0.85 + 0.3 * rnd()); info.glugs++;
        if (drive > 0.2) {
          kick = 1;
          V.burst(900 + 1200 * rnd(), 0.8, 0.001, 0.01, 0.4 * c.babble * drive, 0, 0);
          for (let b = 0; b < 2; b++) V.bubble(c.size * 2.2 * Math.exp(0.3 * flGauss(rnd)), 0.25 * c.babble * drive, 0.15 * (rnd() - 0.5), 0.4, sr * 0.01 * b);
        }
      }
      const sm = (x) => x * x * (3 - 2 * x), ph = glugPh;
      const gate = ph < 0.7 ? 0 : ph < 0.78 ? sm((ph - 0.7) / 0.08) : ph < 0.94 ? 1 : 1 - sm((ph - 0.94) / 0.06);
      jet = drive * (1 - c.babble * 0.85 * gate);
    }
    // fill: the column shortens with the water that has gone in (normalized by the mean jet, so `fill` is reached)
    fill = Math.min(0.97, fill + fillRate * jet / (1 - 0.85 * c.babble * 0.23));
    if ((t & 15) === 0) { const f1 = coeffs(); if ((t & 1023) === 0) info.f1.push(f1); }
    // entrained bubbles: small, where the jet plunges; each one also kicks the air column
    if (rnd() < (40 + 220 * c.flow) * jet / sr) {
      const r = clamp(c.size * Math.exp(0.5 * flGauss(rnd)), 0.3, 8);
      V.bubble(r, 0.12 * Math.pow(r / 2, 0.7), 0.25 * (rnd() - 0.5) * c.width, c.rise, 0);
      kick = Math.max(kick, 0.6);
    }
    V.tick(o); o[0] *= c.evG; o[1] *= c.evG;
    info.eventE += o[0] * o[0] + o[1] * o[1];
    // the jet's turbulence (with kicks from bubbles and glugs) drives the vessel's air column
    const ex = white() * jet * (0.5 + 0.6 * c.flow) * (1 + 0.35 * flutter() + 0.2 * flutter2()) + white() * kick * 1.2;
    kick *= 0.996;
    let res = 0;
    for (const m of modes) {
      const y = m.b0 * (ex - m.x2) - m.a1 * m.y1 - m.a2 * m.y2; m.x2 = m.x1; m.x1 = ex; m.y2 = m.y1; m.y1 = y;
      res += y * m.mk;
    }
    res *= 0.25;
    // the splash itself, direct: bright, a little wide
    const sp = jet * 0.035 * (0.5 + c.flow);
    flSvfTick(spL, white(), gSp, 1.4); flSvfTick(spR, white(), gSp, 1.4);
    const L = res + sp * spL.lp * 1.6, R = res * 0.97 + sp * spR.lp * 1.6;
    info.resE += res * res * 2; info.bedE += L * L + R * R;
    o[0] += L; o[1] += R;
    t++;
  };
}

export function makeFlow(sr, cfg, seed) {
  const c = Object.assign({}, FL_DEFAULTS, cfg);
  c.evG = 1 - 0.55 * clamp(c.distance, 0, 1);         // far away, the single events sink into the bed
  const rnd = flRng(seed);
  const info = { type: ["stream", "waterfall", "surf", "pour"][Math.round(c.type)] || "stream", bubbles: 0, bursts: 0, maxVoices: 0, eventE: 0, bedE: 0,
    tagE: {}, thumps: 0, foamBubbles: 0, pebbleKnocks: 0, resE: 0, samples: 0 };
  const V = flVoices(sr, rnd, info);
  const T = Math.round(c.type);
  const step = T === 1 ? flWaterfall(sr, c, rnd, V, info) : T === 2 ? flSurf(sr, c, rnd, V, info) : T === 3 ? flPour(sr, c, rnd, V, info) : flStream(sr, c, rnd, V, info);
  // distance: air absorption (two one-poles); the detail sinking is c.evG, applied by each type to its events
  const fc = 18000 * Math.pow(2, -3.6 * clamp(c.distance, 0, 1)), al = 1 - Math.exp(-2 * Math.PI * fc / sr);
  let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
  return {
    info,
    tick(drive, o) {
      step(drive, o);
      l1 += (o[0] - l1) * al; l2 += (l1 - l2) * al; r1 += (o[1] - r1) * al; r2 += (r1 - r2) * al;
      o[0] = l2; o[1] = r2; info.samples++;
    },
  };
}
// convenience: render n samples with a per-sample drive curve (a function of the sample index)
export function renderFlow(sr, cfg, seed, n, drive) {
  const w = makeFlow(sr, Object.assign({ dur: n / sr }, cfg), seed), L = new Float32Array(n), R = new Float32Array(n), o = [0, 0];
  for (let i = 0; i < n; i++) { w.tick(drive ? drive(i) : 1, o); L[i] = o[0]; R[i] = o[1]; }
  return { L, R, info: w.info };
}
export { FL_DEFAULTS };

// =====================================================================================================================
// THE CLI: the listening round
// =====================================================================================================================
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const SR = 44100, TARGET_LUFS = -18, VERBOSE = process.argv.includes("--measure");
  const G = { console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array, Int32Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") };
  const ctx = createContext(Object.assign({}, G)); ctx.window = ctx; ctx.globalThis = ctx;
  runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
  const CS = runInContext("CrunchySynth", ctx);
  const dctx = createContext(Object.assign({}, G));
  runInContext(readFileSync(join(ROOT, "dsp.js"), "utf8"), dctx, { filename: "dsp.js" });
  const reverbProcess = dctx.reverbProcess;
  const pctx = createContext({ window: {} });
  runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
  const PRESETS = pctx.window.PRESETS;
  const preset = (n) => { const o = Object.assign({}, PRESETS[n]); delete o._vary; return o; };

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, gated), with its 0.95 peak cap
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
  // as weather.mjs: a take whose peaks keep it > 0.5 dB under the target gets the app's OWN Limiter (dsp.js
  // limiterProcess), the smallest amount in steps of 0.1 that brings it within 0.5 dB
  function matchWithLimiter(L, R) {
    const L0 = Float32Array.from(L), R0 = Float32Array.from(R);
    matchLoudness(L, R);
    if (lufs(L, R) > TARGET_LUFS - 0.5) return 0;
    let pk = 0; for (let i = 0; i < L0.length; i++) pk = Math.max(pk, Math.abs(L0[i]), Math.abs(R0[i]));
    for (let amt = 0.1; amt <= 1.001; amt += 0.1) {
      const l = Float32Array.from(L0, (x) => x * 0.9 / pk), r = Float32Array.from(R0, (x) => x * 0.9 / pk);
      dctx.limiterProcess(l, r, amt);
      matchLoudness(l, r);
      if (lufs(l, r) > TARGET_LUFS - 0.5 || amt > 0.95) { L.set(l); R.set(r); return Math.round(amt * 10) / 10; }
    }
    return 0;
  }

  // ---- the amp envelope stand-in (SFX's attack / hold / decay -> sustain / release, release ending at the duration)
  function envelope(e, dur) {
    const a = e.a ?? 0.01, h = e.h ?? 0, d = e.d ?? 0, s = e.s ?? 1, r = e.r ?? 0.1, relAt = dur - r;
    return (i) => {
      const t = i / SR;
      let v = t < a ? 0.5 - 0.5 * Math.cos(Math.PI * t / a) : t < a + h ? 1 : t < a + h + d ? 1 - (1 - s) * (t - a - h) / d : s;
      if (t > relAt) v *= Math.max(0, 1 - (t - relAt) / r);
      return v;
    };
  }
  function renderTake(t, dur, ctrl) {
    const n = Math.floor(dur * SR);
    if (t.control) {
      const r = CS.render(Object.assign({}, CS.DEFAULTS, t.control), { normalize: true });
      return { L: Float32Array.from(r.L), R: Float32Array.from(r.R), info: null };
    }
    const r = renderFlow(SR, Object.assign({ dur }, t.cfg), t.seed || 1234, n, envelope(t.env || {}, dur));
    const room = t.room || ctrl;                    // the control's own Freeverb settings
    if (room && room.reverb > 0) reverbProcess(r.L, r.R, room.reverbSize ?? 0.5, room.reverbTone ?? 0.5, room.reverb);
    const fi = Math.floor(0.004 * SR), fo = Math.floor(0.06 * SR);  // guards: no click at either edge
    for (let i = 0; i < fi; i++) { const g = i / fi; r.L[i] *= g; r.R[i] *= g; }
    for (let i = 0; i < fo; i++) { const g = i / fo; r.L[n - 1 - i] *= g; r.R[n - 1 - i] *= g; }
    return r;
  }

  // ---- measurement
  function fft(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  const N_FFT = 2048;
  function frames(L, R, hop) {   // per frame: rms dB, centroid, the magnitude spectrum
    const N = N_FFT, out = [];
    for (let a = 0; a + N <= L.length; a += hop) {
      const re = new Float64Array(N), im = new Float64Array(N); let e = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), x = (L[a + i] + R[a + i]) / 2; re[i] = x * w; e += x * x; }
      fft(re, im);
      const mag = new Float64Array(N / 2); let num = 0, den = 0;
      for (let k = 1; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); num += k * mag[k] * mag[k]; den += mag[k] * mag[k]; }
      out.push({ t: (a + N / 2) / SR, db: 10 * Math.log10(e / N + 1e-20), cent: den > 0 ? num / den * SR / N : 0, mag });
    }
    return out;
  }
  const binHz = SR / N_FFT;
  function envDb(L, R, hopS, winS) {
    const hop = Math.floor(hopS * SR), w = Math.floor(winS * SR), env = [];
    for (let a = 0; a + w <= L.length; a += hop) { let s = 0; for (let i = a; i < a + w; i++) s += L[i] * L[i] + R[i] * R[i]; env.push(10 * Math.log10(s / w + 1e-20)); }
    return env;
  }
  // events HEARD (the rain detector of weather.mjs): 1 ms frames of the high-passed signal standing 6 dB over the
  // median of the 40 ms around them. A lower bound: overlapping events count once.
  function eventsHeard(L, R) {
    const n = L.length, h = Math.floor(0.001 * SR), E = [];
    for (let a = 1; a + h <= n; a += h) { let s = 0; for (let i = a; i < a + h; i++) { const x = L[i] - L[i - 1], y = R[i] - R[i - 1]; s += x * x + y * y; } E.push(s); }
    let on = 0;
    for (let i = 20; i < E.length - 20; i++) {
      if (!(E[i] > E[i - 1] && E[i] >= E[i + 1])) continue;
      const nb = E.slice(i - 20, i + 21).sort((x, y) => x - y)[20];
      if (E[i] > nb * 4) on++;
    }
    return on / Math.max(1e-6, (E.length - 40) / 1000);
  }
  // the period of a cycle: the first strong peak of the autocorrelation of a 100 ms dB envelope, lag 2..20 s
  function cyclePeriod(L, R) {
    const env = envDb(L, R, 0.1, 0.2), m = env.reduce((s, x) => s + x, 0) / env.length, x = env.map((v) => v - m), n = x.length;
    let best = 0, bestLag = 0;
    const ac = (lag) => { let s = 0, a = 0, b = 0; for (let i = 0; i + lag < n; i++) { s += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag]; } return s / Math.sqrt(a * b + 1e-20); };
    for (let lag = 20; lag <= Math.min(200, n - 50); lag++) { const r = ac(lag); if (r > best) { best = r; bestLag = lag; } }
    return { period: bestLag * 0.1, r: best };
  }
  // BABBLE, from the audio, with no onset picking (an onset detector fires 2-3 times per cluster in a texture this dense
  // and was found unreliable): split into 1/3-octave bands 315 Hz-5 kHz, take each band's energy envelope (5 ms hop),
  // and find its strongest autocorrelation peak at lags 60-800 ms (a bubble rings < 30 ms, so this is RECURRENCE, not
  // ring). Near-periodic pockets put a peak in their band; Poisson clusters, a static filter or a scatter of sizes do not.
  // Reported: the energy-weighted mean of those peaks over the bands, and the best band (its centre and lag).
  function periodicity(L, R) {
    const n = L.length, hop = Math.round(0.005 * SR), out = [];
    for (let b = 0; b < 13; b++) {
      const fc = 315 * Math.pow(2, b / 3), w0 = 2 * Math.PI * fc / SR, Q = 4.3, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
      const b0 = al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, acc = 0, k = 0; const env = [];
      for (let i = 0; i < n; i++) {
        const x = (L[i] + R[i]) / 2, y = b0 * (x - x2) - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y;
        acc += y * y; if (++k === hop) { env.push(acc / hop); acc = 0; k = 0; }
      }
      // detrend: minus a 300 ms moving mean, so the sound's overall rise and fall is not mistaken for recurrence
      const W = 30, E = env.reduce((t, v) => t + v, 0), e = env.map((v, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - W); j <= Math.min(env.length - 1, i + W); j++) { s += env[j]; c++; } return v - s / c; });
      const ac = []; for (let lag = 0; lag <= 162 && lag < e.length - 20; lag++) {
        let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i + lag < e.length; i++) { sxy += e[i] * e[i + lag]; sxx += e[i] * e[i]; syy += e[i + lag] * e[i + lag]; }
        ac.push(sxy / Math.sqrt(sxx * syy + 1e-30)); }
      let best = 0, lagB = 0;                                          // a true PEAK only (a local maximum), 60-800 ms
      for (let lag = 12; lag < ac.length - 1; lag++) if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best) { best = ac[lag]; lagB = lag; }
      out.push({ fc, r: best, lag: lagB * 0.005, E });
    }
    const Et = out.reduce((t, o) => t + o.E, 0) || 1, top = out.reduce((a, o) => (o.r * o.E > a.r * a.E ? o : a), out[0]);
    return { periodic: out.reduce((t, o) => t + o.r * o.E, 0) / Et, bestBand: top.fc, bestLag: top.lag, bestR: top.r };
  }
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  function measure(L, R, kind, info) {
    const n = L.length; let pk = 0, nan = 0;
    for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e = Math.floor(0.002 * SR); let sMax = 0, eMax = 0;
    for (let i = 0; i < e; i++) { sMax = Math.max(sMax, Math.abs(L[i]), Math.abs(R[i])); eMax = Math.max(eMax, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeStart: sMax / (pk || 1), edgeEnd: eMax / (pk || 1) };
    const F = frames(L, R, 1024), top = Math.max(...F.map((f) => f.db)), live = F.filter((f) => f.db > top - 30);
    m.centroid = live.reduce((s, f) => s + f.cent, 0) / (live.length || 1);
    // band shares of the live frames' energy, and where the long-term spectrum peaks (1/3-octave smoothed, 250 Hz-8 kHz)
    const bands = [0, 200, 2000, 6000, SR / 2], share = [0, 0, 0, 0]; const avg = new Float64Array(N_FFT / 2);
    for (const f of live) for (let k = 1; k < N_FFT / 2; k++) { const p = f.mag[k] * f.mag[k], hz = k * binHz; avg[k] += p; for (let b = 0; b < 4; b++) if (hz >= bands[b] && hz < bands[b + 1]) share[b] += p; }
    const tot = share.reduce((s, x) => s + x, 0) || 1; m.bands = share.map((x) => x / tot);
    let hb = 0, hv = 0;
    for (let k = Math.ceil(250 / binHz); k < 8000 / binHz; k++) { const lo = Math.floor(k / 1.122), hi = Math.ceil(k * 1.122); let s = 0; for (let j = lo; j <= hi; j++) s += avg[j]; s /= (hi - lo + 1); if (s > hv) { hv = s; hb = k; } }
    m.specPeak = hb * binHz;
    if (kind !== "pour") m.eventsHeard = eventsHeard(L, R);
    if (kind === "stream") Object.assign(m, periodicity(L, R));
    if (kind === "surf") {
      const env = envDb(L, R, 0.05, 0.1), tp = Math.max(...env), on = env.findIndex((v) => v > tp - 40);
      // the crash: the steepest 250 ms rise; the tail: from the loudest 100 ms to the last one within 20 dB of it
      let rise = 0, at = 0; for (let i = on + 8; i + 5 < env.length; i++) if (env[i + 5] - env[i] > rise) { rise = env[i + 5] - env[i]; at = i + 5; }
      const ip = env.indexOf(tp); let last = ip; for (let i = ip; i < env.length; i++) if (env[i] > tp - 20) last = i;
      m.crashAt = at * 0.05; m.crashRise = rise; m.tail20 = (last - ip) * 0.05;
      // the crash travelling: L/R balance in the first and the last third of the 0.6 s after the steepest rise
      const bal = (a, b) => { let l = 0, r = 0; for (let i = a; i < b && i < n; i++) { l += L[i] * L[i]; r += R[i] * R[i]; } return (r - l) / (r + l + 1e-20); };
      const c0 = Math.floor((at * 0.05 - 0.1) * SR); m.panSweep = [bal(c0, c0 + 0.2 * SR), bal(c0 + 0.4 * SR, c0 + 0.6 * SR)];
    }
    if (kind === "pour") {
      // the vessel's pitch: the strongest 1/12-octave-smoothed peak 150 Hz-5 kHz per frame, over frames within 20 dB of the top
      const tr = F.filter((f) => f.db > top - 20).map((f) => { let kb = 0, v = 0; for (let k = Math.ceil(150 / binHz); k < 5000 / binHz; k++) { const s = f.mag[k - 1] + f.mag[k] + f.mag[k + 1]; if (s > v) { v = s; kb = k; } } return kb * binHz; });
      const q = Math.max(1, Math.floor(tr.length * 0.15));
      m.pitchStart = median(tr.slice(0, q)); m.pitchEnd = median(tr.slice(-q));
      const sm = tr.map((_, i) => median(tr.slice(Math.max(0, i - 2), i + 3)));
      let up = 0, steps = 0; for (let i = 4; i < sm.length; i += 4) { if (sm[i] !== sm[i - 4]) { steps++; if (sm[i] > sm[i - 4]) up++; } }
      m.pitchRising = steps ? up / steps : 0;
    }
    if (info) m.info = info;
    return m;
  }

  const pct = (x) => (x * 100).toFixed(0) + "%";
  // ---- the BABBLE sweep: does the control show in the audio? dry 8 s streams, babble x rise, recurrence (above)
  function probeBabble() {
    const lines = [];
    for (const [nm, flow, rise] of [["trickle", 0.08, 0], ["trickle", 0.08, 0.5], ["brook", 0.45, 0.35]]) for (const babble of [0, 0.5, 0.9]) {
      const r = renderFlow(SR, { type: 0, flow, size: 2.5, babble, body: 0.3, rise }, 31, 8 * SR, null), m = periodicity(r.L, r.R), iv = r.info.intervals;
      const mu = iv.reduce((t, x) => t + x, 0) / iv.length, cv = Math.sqrt(iv.reduce((t, x) => t + (x - mu) ** 2, 0) / iv.length) / mu;
      lines.push("| " + nm + " | " + rise + " | " + babble + " | " + cv.toFixed(2) + " | " + m.periodic.toFixed(2) + " | " + Math.round(m.bestBand) + " Hz, r " + m.bestR.toFixed(2) + " at " + Math.round(m.bestLag * 1000) + " ms |");
    }
    return lines;
  }
  if (process.argv.includes("--probe-babble")) { console.log(probeBabble().join("\n")); process.exit(0); }
  // ---- THE ROUND
  // Envelopes are the AMP envelope (drive): stream/waterfall flow, surf gain, pour jet.
  const SOUNDS = [
    { name: "Stream Babble", kind: "stream", dur: 2.0,
      listen: "A babbling brook (a loop by a stream in a forest or a village). Which one is WATER MOVING OVER STONES, the gurgle of a brook, rather than a filtered hiss? Listen for whether the little gurgles come back, like a brook's, or the texture is the same everywhere.",
      takes: [
        { id: "brook-over-stones", why: "MODEL, a brook: 9 pockets (mean bubble radius 2.5 mm, ~1.3 kHz, each pocket its own size and place in the field) firing clusters of 1-3 bubbles that recur fairly regularly (babble 0.7), a third of them hollow cavity tonks; loose small bubbles between; moderate turbulence.",
          cfg: { type: 0, flow: 0.45, size: 2.5, babble: 0.7, body: 0.3, rise: 0.35, tone: 0.5, width: 0.75 }, env: { a: 0.12, s: 1, r: 0.35 }, seed: 31 },
        { id: "trickle", why: "MODEL, a thin trickle / a rill: only 4 pockets of small bubbles (1.4 mm, ~2.3 kHz), very regular recurrence (babble 0.9): you can follow each plink coming back; almost no flow noise.",
          cfg: { type: 0, flow: 0.08, size: 1.4, babble: 0.9, body: 0.05, rise: 0.5, tone: 0.6, width: 0.6 }, env: { a: 0.08, s: 1, r: 0.35 }, seed: 47 },
        { id: "rushing-creek", why: "MODEL, a fuller creek: 13 pockets of bigger bubbles (4 mm, ~800 Hz: deeper glugs), clusters of up to 4, irregular recurrence (babble 0.35), strong turbulence and a low gurgle.",
          cfg: { type: 0, flow: 0.9, size: 4, babble: 0.35, body: 0.6, rise: 0.25, tone: 0.45, width: 0.85 }, env: { a: 0.12, s: 1, r: 0.35 }, seed: 59 },
      ] },
    { name: "Waterfall", kind: "waterfall", dur: 2.0,
      listen: "A waterfall (a loop near falling water). Which one is FALLING WATER, with weight, rather than a rushing static? Is there a sense of a body of water landing somewhere?",
      takes: [
        { id: "at-the-plunge-pool", why: "MODEL, close to a big fall: ~4500 bubbles/s with a wide size spread (centre 2 mm) merging into a roar pitched near 1.4 kHz, the impact thunder at the base (a swelling low rumble and ~8 thumps/s of water mass landing), spray hiss on top.",
          cfg: { type: 1, flow: 0.75, size: 2, body: 0.7, babble: 0.6, rise: 0.2, distance: 0.1, tone: 0.5, width: 0.85 }, env: { a: 0.2, s: 1, r: 0.5 }, seed: 71 },
        { id: "across-the-valley", why: "MODEL, the same kind of fall heard from far off: the bubbles' detail and the spray sink into the bed and the air takes the highs (distance 0.7, lowpass ~3 kHz): a dark, steady roar with the thunder still there.",
          cfg: { type: 1, flow: 0.8, size: 2.5, body: 0.6, babble: 0.4, rise: 0.2, distance: 0.7, tone: 0.5, width: 0.7 }, env: { a: 0.3, s: 1, r: 0.5 }, seed: 83 },
        { id: "cascade-over-rocks", why: "MODEL, a smaller cascade: fewer, bigger bubbles (~1700/s, centre 3.5 mm, ~800 Hz), so the roar is grainier and you hear gurgles in it; light thunder.",
          cfg: { type: 1, flow: 0.22, size: 3.5, body: 0.3, babble: 0.3, rise: 0.3, distance: 0.15, tone: 0.5, width: 0.8 }, env: { a: 0.2, s: 1, r: 0.5 }, seed: 97 },
      ] },
    { name: "Ocean Surf", kind: "surf", dur: 12.0, period: true,
      listen: "Ocean surf on a shore (a beach loop). The takes are NOT the same length (one is much shorter); judge each on whether it is the SEA: waves arriving, breaking and drawing back, rather than a swell of noise. Then which kind of shore.",
      takes: [
        { id: "sandy-beach", why: "MODEL, waves on sand, ~8 s apart (jittered per wave): a low swell rising under each wave, the crash spilling along the front (it travels across the field), a foam fizz of tiny bubbles, the wash up the beach, then a long hiss drawing back, thinning and darkening as it goes. The second wave breaks near the end.",
          cfg: { type: 2, period: 8, waveSize: 0.65, drawback: 0.05, body: 0.45, phase: 0.12, tone: 0.5, width: 0.8 }, env: { a: 0.3, s: 1, r: 1.0 }, seed: 113 },
        { id: "pebble-beach", why: "MODEL, the same sea on shingle: the drawback is the rattle of stones knocking as the water pulls them back (clusters of short resonant knocks, 1.6-6 kHz), with only a little hiss.",
          cfg: { type: 2, period: 7.5, waveSize: 0.6, drawback: 0.85, body: 0.4, phase: 0.12, tone: 0.5, width: 0.8 }, env: { a: 0.3, s: 1, r: 1.0 }, seed: 127 },
        { id: "heavy-shore-break", why: "MODEL, big waves dumping on a steep shore, ~6 s apart: a heavier thump and longer crash, more foam, a shorter drawback over mixed sand and stones.",
          cfg: { type: 2, period: 6, waveSize: 0.95, drawback: 0.35, body: 0.7, phase: 0.15, tone: 0.55, width: 0.85 }, env: { a: 0.3, s: 1, r: 1.0 }, seed: 131 },
      ] },
    { name: "Wave of Water", kind: "surf", dur: 2.2,
      listen: "ONE wave of water (a single gesture: a wave hitting a shore, a water spell washing over, a scene transition). Which one is a WAVE, water arriving and breaking, rather than a noise swell?",
      takes: [
        { id: "shore-break", why: "MODEL, one wave (period 2.4 s, so the whole cycle fits): a short swell, the crash at ~0.7 s travelling across the field, foam fizz, and the wash drawing back over sand.",
          cfg: { type: 2, waves: 1, phase: 0, period: 2.4, waveSize: 0.75, drawback: 0.1, body: 0.5, tone: 0.5, width: 0.8 }, env: { a: 0.02, s: 1, r: 0.45 }, seed: 151 },
        { id: "wave-on-rocks", why: "MODEL, a wave slamming into rocks: big crash (wave size 1), a heavy thump, lots of foam, a short drawback with stones knocking.",
          cfg: { type: 2, waves: 1, phase: 0, period: 2.2, waveSize: 1.05, drawback: 0.6, body: 0.8, tone: 0.6, width: 0.85 }, env: { a: 0.02, s: 1, r: 0.45 }, seed: 163 },
        { id: "lapping-wave", why: "MODEL, a small wave lapping a shore: hardly any crash (the crash grows with the square of wave size, the wash only with it), mostly the wash coming up and the hiss drawing back.",
          cfg: { type: 2, waves: 1, phase: 0, period: 2.6, waveSize: 0.25, drawback: 0.15, body: 0.25, tone: 0.45, width: 0.7 }, env: { a: 0.02, s: 1, r: 0.45 }, seed: 179 },
      ] },
    { name: "Filling a Bottle", control: "Pouring Water", kind: "pour", dur: 2.6,
      listen: "Water POURED INTO A CONTAINER (filling a bottle or a glass: a potion, a drink, a canteen at a well). Which one sounds like a vessel FILLING UP? Listen for whether you can hear how full it is getting.",
      takes: [
        { id: "bottle-under-a-tap", why: "MODEL, a steady jet into a narrow bottle (0.30 m, Q ~30): the air column above the water rings, from ~330 Hz to ~2.6 kHz as the bottle goes from 5% to 88% full, rising faster at the end (f = c / 4 L, L shrinking).",
          cfg: { type: 3, vessel: 0.05, flow: 0.5, size: 1.5, babble: 0, fillStart: 0.05, fill: 0.88, rise: 0.3, tone: 0.5, width: 0.6 }, env: { a: 0.04, s: 1, r: 0.12 }, seed: 191 },
        { id: "pouring-a-glass", why: "MODEL, a drink poured into a wide glass (0.12 m, Q ~7): the resonance is broad and weak, so it is mostly splash and bubbles with a rising color under them.",
          cfg: { type: 3, vessel: 0.95, flow: 0.7, size: 2, babble: 0, fillStart: 0.1, fill: 0.85, rise: 0.4, tone: 0.55, width: 0.7 }, env: { a: 0.05, s: 1, r: 0.15 }, seed: 211 },
        { id: "glugging-into-a-flask", why: "MODEL, poured from another bottle that glugs (~6 glugs/s as air gulps back into it): the jet stutters, each restart slaps and drops a couple of big bubbles, while a medium flask (Q ~19) fills and its pitch climbs.",
          cfg: { type: 3, vessel: 0.45, flow: 0.55, size: 1.8, babble: 0.8, fillStart: 0.08, fill: 0.86, rise: 0.4, tone: 0.5, width: 0.6 }, env: { a: 0.04, s: 1, r: 0.12 }, seed: 223 },
      ] },
  ];

  const OUT = join(ROOT, "soundtests", "proto-flow");
  mkdirSync(OUT, { recursive: true });
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fmt = (m) => {
    const p = [m.sec.toFixed(2) + " s", m.lufs.toFixed(1) + " LUFS", "peak " + m.peak.toFixed(3), "NaN " + m.nan, "edge " + m.edgeStart.toFixed(4) + "/" + m.edgeEnd.toFixed(4),
      "centroid " + Math.round(m.centroid) + " Hz", "spectrum peak " + Math.round(m.specPeak) + " Hz", "bands <200/200-2k/2-6k/>6k " + m.bands.map(pct).join("/")];
    if (m.eventsHeard !== undefined) p.push("clicks heard " + Math.round(m.eventsHeard) + "/s");
    if (m.periodic !== undefined) p.push("recurrence (band-envelope autocorrelation peak at 60-800 ms, energy-weighted; at 2 s this is at its noise floor, see README) " + m.periodic.toFixed(2) + ", best band " + Math.round(m.bestBand) + " Hz r " + m.bestR.toFixed(2) + " at " + Math.round(m.bestLag * 1000) + " ms");
    if (m.crashAt !== undefined) p.push("crash at " + m.crashAt.toFixed(2) + " s (+" + m.crashRise.toFixed(1) + " dB in 250 ms)", "tail within 20 dB of the peak " + m.tail20.toFixed(2) + " s",
      "L/R balance across the crash " + m.panSweep.map((x) => x.toFixed(2)).join(" -> "));
    if (m.pitchStart !== undefined) p.push("vessel pitch " + Math.round(m.pitchStart) + " -> " + Math.round(m.pitchEnd) + " Hz", "rising steps " + pct(m.pitchRising));
    if (m.cycle) p.push("WAVE PERIOD (60 s dry render, envelope autocorrelation) " + m.cycle.period.toFixed(1) + " s (r " + m.cycle.r.toFixed(2) + ", set " + m.cycle.set + " s)");
    const i = m.info;
    if (i) {
      p.push("bubbles " + Math.round(i.bubbles / m.sec) + "/s", "max voices " + i.maxVoices, "events' share " + pct(i.eventE / (i.eventE + i.bedE + 1e-20)));
      if (i.type === "stream") { const iv = i.intervals, mu = iv.reduce((s, x) => s + x, 0) / (iv.length || 1), sd = Math.sqrt(iv.reduce((s, x) => s + (x - mu) ** 2, 0) / (iv.length || 1));
        p.push("pockets " + i.pockets, "clusters " + (i.clusters / m.sec).toFixed(1) + "/s", "a pocket recurs every " + median(i.ivSec).toFixed(2) + " s (median), interval CV within a pocket " + (sd / (mu || 1)).toFixed(2)); }
      if (i.type === "waterfall") p.push("thumps " + (i.thumps / m.sec).toFixed(1) + "/s", "roar centre " + Math.round(i.hump) + " Hz");
      if (i.type === "surf") p.push("breaks at " + i.breaks.filter((b) => b >= 0 && b < m.sec).map((b) => b.toFixed(2)).join(", ") + " s", "foam bubbles " + i.foamBubbles, "pebble knocks " + i.pebbleKnocks);
      if (i.type === "pour") p.push("model f1 " + Math.round(i.f1[0]) + " -> " + Math.round(i.f1[i.f1.length - 1]) + " Hz", "glugs " + (i.glugs / m.sec).toFixed(1) + "/s", "air column's share " + pct(i.resE / (i.eventE + i.bedE + 1e-20)));
    }
    if (m.limiter) p.push("LIMITER " + m.limiter);
    return p.join(", ");
  };
  const readme = [];
  for (const S of SOUNDS) {
    const ctrlName = S.control || S.name, ctrlPatch = preset(ctrlName);
    const takes = [{ id: "current", why: "the CURRENT preset \"" + ctrlName + "\", rendered by the exported engine (the control)" + (S.control ? ": there is no \"" + S.name + "\" preset, this is the nearest one." : "."), control: ctrlPatch }].concat(S.takes);
    // shuffle with a fixed seed, using the HIGH bits of the LCG (the low bits of a power-of-two LCG barely move)
    let seed = 0x5f3759df;
    for (const ch of S.name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    // avalanche the name hash (murmur3's finalizer) before the LCG: uniform either way over 4000 test names, but without
    // it these five names put the control in slot A four times
    seed ^= seed >>> 16; seed = Math.imul(seed, 0x85ebca6b) >>> 0; seed ^= seed >>> 13; seed = Math.imul(seed, 0xc2b2ae35) >>> 0; seed = (seed ^ (seed >>> 16)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = (seed >>> 16) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, slug(S.name)), key = [];
    mkdirSync(dir, { recursive: true });
    console.log(S.name + "  (control: " + ctrlName + ", " + ctrlPatch.duration + " s)");
    order.forEach((ti, slot) => {
      const t = takes[ti], dur = t.dur || S.dur;
      const r = renderTake(t, dur, ctrlPatch);
      const lim = matchWithLimiter(r.L, r.R);
      const m = measure(r.L, r.R, S.kind, r.info); m.limiter = lim;
      if (S.period && !t.control) { const d = renderFlow(SR, Object.assign({}, t.cfg, { phase: 0 }), t.seed, 60 * SR, null); m.cycle = Object.assign(cyclePeriod(d.L, d.R), { set: t.cfg.period }); }
      const file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: S.name + " " + file })));
      key.push({ file, t, m });
      console.log("  " + file + "  " + t.id.padEnd(22) + " " + fmt(m));
      const bad = [];
      if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < -40) bad.push("silent");
      if (!t.control && (m.edgeStart > 0.05 || m.edgeEnd > 0.05)) bad.push("edge click?");
      if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target");
      if (bad.length) console.log("    !! " + bad.join(", "));
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + S.name + " (flow engine prototype)\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS (or capped below full scale), in a shuffled order. One of them is " + (S.control ? "the nearest existing preset" : "today's preset") + ".\n\n" + S.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + S.name + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
      "Measured: " + fmt(k.m) + "\n\n" +
      (k.t.control && (k.m.edgeStart > 0.05 || k.m.edgeEnd > 0.05) ? "Note: the control itself starts or ends abruptly (edge " + k.m.edgeStart.toFixed(3) + " / " + k.m.edgeEnd.toFixed(3) + " of its peak in the first / last 2 ms): a click that is in today's preset, not added here.\n\n" : "") +
      (k.m.limiter ? "Note: this take's peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.m.limiter + " before matching (see README).\n\n" : "") +
      "```json\n" + JSON.stringify(k.t.control ? k.t.control : { cfg: k.t.cfg, env: k.t.env, seed: k.t.seed }) + "\n```\n").join("\n"));
    readme.push("- `" + slug(S.name) + "/`: " + S.name + " (" + takes.length + " takes; control: " + ctrlName + ", " + ctrlPatch.duration + " s; model takes " + S.dur + " s)");
    if (VERBOSE) for (const k of key) { const mm = Object.assign({}, k.m); if (mm.info) mm.info = Object.assign({}, mm.info, { intervals: undefined, ivSec: undefined, f1: undefined }); console.log(JSON.stringify({ take: k.file, id: k.t.id, m: mm })); }
  }
  writeFileSync(join(OUT, "README.md"), "# Flow engine prototype: listening round\n\n" +
    "A prototype synthesis engine for MOVING water (`tools/proto/flow.mjs`, regenerate with `node tools/proto/flow.mjs`): a stream, a waterfall, " +
    "surf, and pouring into a vessel. Today the moving water in \"Nature\" is a sine plus filtered noise, and \"Water / Liquid\" is the bubble engine, which " +
    "does single bubbles but not a body of water. The question is not \"which settings\" but **is a model of what the water is doing clearly better " +
    "than noise**, sound by sound. (Rain is not here: it belongs to the weather prototype.)\n\n" + readme.join("\n") + "\n\n" +
    "In each folder: `take-A.wav` ... `take-D.wav`, one of them the CURRENT preset (rendered by the exported engine, `synth-export/crunchysfx-synth.js`), " +
    "the others three different interpretations from the model. All loudness-matched to " + TARGET_LUFS + " LUFS (peaks capped at 0.95) and shuffled with a fixed seed " +
    "(the high bits of the LCG). Read `LISTEN.md` first, listen, then read `KEY.md`.\n\n" +
    "**The room:** every model take gets the control preset's own reverb (the same Freeverb from dsp.js `reverbProcess`, same size, tone and wet), in stereo, " +
    "so the comparison is not about space. (Running the output back through the synth as a `wave: 9` sample was not used: that path is mono, and the model " +
    "places pockets across a stream and moves a breaking wave across the field.)\n\n" +
    "**The limiter:** as in the weather round, a take whose peaks kept it more than 0.5 dB under the target after the 0.95 peak cap gets the app's own Limiter " +
    "(dsp.js `limiterProcess`) at the smallest amount that brings it within 0.5 dB. KEY.md says which takes got it.\n\n" +
    "**Lengths, and one unfair comparison:** model takes are about the control's length (Stream Babble 2.0 s against 1.6 s, Wave of Water 2.2 against 1.7, " +
    "Filling a Bottle 2.6 against 1.5, so the vessel has time to fill), EXCEPT **Ocean Surf: the preset is 2.0 s, which cannot hold even one wave** (a real cycle " +
    "is 6-12 s), so the model takes are 12 s and hold a wave and a half. The control is the shipped preset as it is, so that round is not blind on length; judge it on " +
    "whether a take is the sea at all. `wave-of-water/` is the fair version of the same question: one wave, at about the preset's length.\n\n" +
    "**Is the babble real? (measured, `node tools/proto/flow.mjs --probe-babble`)** The stream's claim is that its gurgles RECUR: each pocket has one " +
    "bubble size and a figure, and `babble` sets how regularly it fires (0 = Poisson, 1 = near-periodic). From the audio, with no onset picking: split into " +
    "1/3-octave bands, detrend each band's energy envelope, and take its strongest autocorrelation PEAK at 60-800 ms (a bubble rings < 30 ms, so a peak " +
    "there is recurrence). Dry 8 s renders:\n\n| stream | rise | babble | model's interval CV | recurrence (audio) | best band |\n|---|---|---|---|---|---|\n" +
    probeBabble().join("\n") + "\n\nThe effect is real and monotonic but MODEST: it doubles in a sparse trickle and is blurred in a brook, where several pockets share each band. " +
    "On the 2 s takes the same measure sits at its noise floor (~0.2; the Stream Babble control's 7 Hz vibrato scores as high), so KEY.md's per-take number " +
    "says nothing either way. Whether the recurrence is HEARD is the listening question.\n\n" +
    "**Filling a Bottle is a gap**: no preset does it. Its control is the nearest one, `Pouring Water` (the bubble engine).\n\n" +
    "**What to report per sound:** the letter you prefer, and whether it is clearly better, a little better, or no better than the others. " +
    "\"Noise was fine here\" is a useful answer: it means that water type does not need the engine.\n");
  console.log("-> " + OUT);
}
