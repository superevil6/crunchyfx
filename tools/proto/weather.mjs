/* weather.mjs — PROTOTYPE of a "weather" synthesis engine for CrunchySFX (wind / rain / thunder), and the CLI that
 * renders its blind listening round.
 *
 *   node tools/proto/weather.mjs            render the round into soundtests/proto-weather/
 *   node tools/proto/weather.mjs --measure  the same, and print the per-take measurements in full
 *
 * WHY. Almost every "Nature" preset is a sine plus filtered noise. Noise fakes wind passably; the question this round
 * asks is whether a model of what the air and the water are DOING is clearly better:
 *   WIND    is turbulence: broadband noise whose LEVEL and SPECTRAL CENTER follow a slow random gust curve (aerodynamic
 *           noise rises steeply with air speed, and its band moves up with it), plus WHISTLES: narrow resonances (edge
 *           tones, air through a gap or across a wire) whose pitch is proportional to air speed (an edge tone is
 *           f = St * v / d), and which only sing once the gust passes a threshold.
 *   RAIN    is many discrete drops: Poisson arrivals at a density, drop sizes from an exponential (Marshall-Palmer)
 *           distribution, positions spread over an area so most drops are far, quiet and dull and a few are near,
 *           loud and bright. Each drop is an impact on its SURFACE (a hard click with a splash tail for big drops; a
 *           damped two-mode tap on a leaf; on water a soft slap and, for some drops, a Minnaert bubble a few ms later,
 *           f0 = 3.26/r, decay d = 0.13/r + 0.0072 r^-1.5, pitch rising as it rings: the "plink"), over a diffuse hiss.
 *   THUNDER is the arrival of N-waves from every point of a tortuous channel. The channel is grown as a random walk
 *           (with branches) in metres; each 12 m segment emits an N-wave whose arrival time is its distance / 343 m/s.
 *           A segment broadside to the listener delivers its whole length at once (a sharp clap); one pointing at the
 *           listener smears over length/c and is weak: that, and clusters of segments at equal distance, ARE the
 *           irregular swells of a rumble. Each arrival is low-passed by its distance (air absorption) and N-waves
 *           lengthen with distance. A close strike therefore opens with a crack (the nearest segments, unfiltered);
 *           a far one is a dark roll with no crack. The physical spread of arrivals (several seconds) is compressed to
 *           `roll` seconds for a game sound: arrival ORDER and clustering are kept, pulse lengths are not stretched.
 *
 * PORTABLE SHAPE (how it would port into dsp.js): `makeWeather(sr, cfg, seed)` is a pure factory like makeBrass /
 * makeBowed: no DOM, no Math.random (own seeded LCG), returns { tick(drive, out), info }. tick writes one stereo
 * sample into out[0], out[1]. `drive` (0..1) is the patch's amp envelope: for WIND it is the wind SPEED (so the
 * spectral center and the whistles follow the envelope, not only the level), for RAIN it scales the drop RATE, for
 * THUNDER it is a plain gain (the bolt is one event). In synth.js the engine would be a wave branch that calls
 * tick(env) per sample and adds out[] into sL/sR, ahead of the filter / drive / reverb chain like every other wave.
 *
 * THE ROOM. Takes get the control preset's OWN Freeverb (dsp.js `reverbProcess`, same size / tone / wet as the
 * control), loaded from dsp.js in a vm. Running the output through CrunchySynth.render with `wave: 9` and
 * `opts.sample` was checked and NOT used: the sample input is mono (the "sample" wave reads one buffer, and `width`
 * only pans unison voices), so it would collapse the stereo field rain and gusts depend on. Same reverb code, same
 * settings, stereo kept.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// =====================================================================================================================
// THE MODEL (pure; this block is what would move into dsp.js)
// =====================================================================================================================

const WX_DEFAULTS = {
  type: 0,            // 0 wind, 1 rain, 2 thunder
  intensity: 0.7,     // wind speed / strike energy (rain uses density)
  tone: 0.5,          // brightness 0..1
  width: 0.7,         // stereo spread 0..1
  body: 0.3,          // wind: low buffeting rumble; rain: low roar of the downpour
  // wind
  gustiness: 0.5, gustRate: 0.8, whistle: 0, whistles: 0, pitch: 600, whistleQ: 60,
  // rain
  density: 300, drop: 1.2, surface: 0, hiss: 0.5, bubbles: 0.7, ring: 1, sheets: 0, sheetRate: 0.6, spread: 12,
  // thunder
  distance: 2, roll: 1.6, kind: 0, pulseMs: 4, crackle: 0.5, height: 2500, cloudLen: 2500,
};

const WX_BED = 0.065;           // the rain bed's level against the drops (calibrated: see the round's 'drops' share')
// a ringing surface puts more energy in each drop than a click does, so its bed is scaled to keep the same balance
const WX_BED_SURF = [1, 6, 6];
function wxRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function wxGauss(rnd) { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// value noise with cosine interpolation: a smooth random curve at about `hz` changes a second, range ±1
function wxSmooth(sr, hz, rnd) {
  let a = rnd() * 2 - 1, b = rnd() * 2 - 1, ph = rnd();
  const inc = hz / sr;
  return () => { ph += inc; if (ph >= 1) { ph -= 1; a = b; b = rnd() * 2 - 1; } const u = 0.5 - 0.5 * Math.cos(Math.PI * ph); return a + (b - a) * u; };
}
// TPT state-variable filter (Simper). tick returns the band output; .lp / .hp hold the others. k = 1/Q.
function wxSvf() { return { ic1: 0, ic2: 0, lp: 0, hp: 0 }; }
function wxSvfTick(f, x, g, k) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const v3 = x - f.ic2, v1 = a1 * f.ic1 + a2 * v3, v2 = f.ic2 + a2 * f.ic1 + a3 * v3;
  f.ic1 = 2 * v1 - f.ic1; f.ic2 = 2 * v2 - f.ic2; f.lp = v2; f.hp = x - k * v1 - v2;
  return v1;
}
const wxG = (fc, sr) => Math.tan(Math.PI * Math.min(Math.max(fc, 5), sr * 0.45) / sr);
// unit-RMS makeup for uniform white noise (variance 1/3) through a unit-peak band of quality Q at fc
const wxBandMakeup = (fc, Q, sr) => Math.sqrt(3 * Q * sr / (Math.PI * Math.max(fc, 5)));
const wxPan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// ---------------------------------------------------------------- WIND
function wxWind(sr, c, rnd) {
  const inten = c.intensity, gusty = c.gustiness, rate = Math.max(0.05, c.gustRate), tone = c.tone, width = c.width;
  const fLo = 110 * Math.pow(2, tone * 1.6), fHi = 1100 * Math.pow(2, tone * 2.2);   // the band's center, calm -> gale
  const white = () => rnd() * 2 - 1;
  const flutter = wxSmooth(sr, 4 + gusty * 8, rnd), panDrift = wxSmooth(sr, 0.3, rnd);
  const tL = wxSvf(), tR = wxSvf(), bL = wxSvf(), bR = wxSvf();
  const bodyMk = Math.sqrt(3 * sr / (2 * 1.11 * 130));
  const W = [];
  const ratios = [1, 1.37 + 0.1 * rnd(), 1.83 + 0.15 * rnd()];
  for (let i = 0; i < Math.round(c.whistles); i++) {
    W.push({ f0: c.pitch * ratios[i] * (1 + 0.03 * (rnd() - 0.5)), th: 0.42 + 0.12 * i + 0.06 * rnd(), pan: (rnd() * 2 - 1) * 0.6 * width,
      flt: wxSvf(), wob: wxSmooth(sr, 1.5 + rnd() * 2, rnd), lvl: 0 });
  }
  const gusts = [];
  const info = { type: "wind", gusts: 0, samples: 0, whistleOnSamples: 0, speedMax: 0, speedSum: 0, whistleE: 0, allE: 0 };
  let t = 0, next = Math.floor(sr * 0.02);
  const out = {
    info,
    tick(drive, o) {
      while (t >= next) {   // a new gust: Poisson arrivals, never closer than a third of the mean spacing
        const rise = sr * (0.15 + 0.2 * rnd()) / rate, fall = rise * (1.0 + 0.8 * rnd());
        gusts.push({ t0: t, rise, fall, amp: 0.3 + 0.7 * rnd(), pan: rnd() * 2 - 1 });
        info.gusts++;
        next += Math.floor(sr / rate * (0.33 - 0.67 * Math.log(Math.max(1e-6, rnd()))));
      }
      let sum = 0, pAcc = 0;
      for (let i = gusts.length - 1; i >= 0; i--) {
        const g = gusts[i], tau = t - g.t0;
        if (tau > g.rise + g.fall * 8) { gusts.splice(i, 1); continue; }
        const b = g.amp * (tau < g.rise ? 0.5 - 0.5 * Math.cos(Math.PI * tau / g.rise) : Math.exp(-(tau - g.rise) / g.fall));
        sum += b; pAcc += b * g.pan;
      }
      const G = 1 - Math.exp(-2.2 * sum);                                          // gust strength 0..1
      const rel = (1 - gusty) * 0.8 + gusty * (0.1 + 0.9 * G * Math.sqrt(G));                   // gusty air eases off between gusts
      let s = drive * inten * rel * (1 + gusty * 0.16 * flutter());
      if (s < 0) s = 0; else if (s > 1.2) s = 1.2;
      info.samples++; info.speedSum += s; if (s > info.speedMax) info.speedMax = s;
      // turbulence: a wide band whose center climbs with the speed, level ~ speed^1.6, plus edge hiss in the strongest air
      const fc = fLo * Math.pow(fHi / fLo, Math.min(1, s)), g = wxG(fc, sr), k = 1 / 0.9, mk = wxBandMakeup(fc, 0.9, sr);
      const nl = white(), nr = white();
      const yl = wxSvfTick(tL, nl, g, k) * k * mk, yr = wxSvfTick(tR, nr, g, k) * k * mk;
      const air = 0.35 * Math.pow(Math.max(0, s - 0.5), 2) * (0.5 + tone);
      const a = 0.45 * Math.pow(s, 1.6);
      let L = a * yl + air * tL.hp, R = a * yr + air * tR.hp;
      // body: low buffeting, shaken by the flutter
      if (c.body > 0) {
        const gb = wxG(130, sr), kb = Math.SQRT2, fb = 1 + 0.7 * flutter();
        wxSvfTick(bL, white(), gb, kb); wxSvfTick(bR, white(), gb, kb);
        const ab = c.body * 0.5 * Math.pow(s, 1.3) * fb;
        L += ab * bL.lp * bodyMk; R += ab * bR.lp * bodyMk;
      }
      // whistles: narrow resonators on noise; pitch ~ speed (edge tone), gated by the gust
      let on = false;
      for (const w of W) {
        const f = w.f0 * (0.6 + 0.65 * Math.min(1.1, s)) * (1 + 0.012 * w.wob());
        let gate = (s - w.th) / 0.18; gate = gate <= 0 ? 0 : gate >= 1 ? 1 : gate * gate * (3 - 2 * gate);
        w.lvl += (gate - w.lvl) * (40 / sr);                                       // the edge tone locks in, it doesn't switch
        const y = wxSvfTick(w.flt, white(), wxG(f, sr), 1 / c.whistleQ) / c.whistleQ * wxBandMakeup(f, c.whistleQ, sr);
        const amp = c.whistle * 0.3 * w.lvl * (0.5 + s);
        if (w.lvl > 0.1) on = true;
        const [pl, pr] = wxPan(w.pan);
        L += amp * y * pl; R += amp * y * pr; info.whistleE += amp * amp * y * y / 2;
      }
      info.allE += (L * L + R * R) / 2;
      if (on) info.whistleOnSamples++;
      // the gust's place in the field drifts
      const p = Math.max(-1, Math.min(1, (sum > 1e-6 ? pAcc / sum : 0) * 0.45 * width + 0.3 * width * panDrift()));
      const [pl, pr] = wxPan(p);
      o[0] = L * pl * Math.SQRT2; o[1] = R * pr * Math.SQRT2;
      t++;
    },
  };
  return out;
}

// ---------------------------------------------------------------- RAIN
function wxRain(sr, c, rnd) {
  const width = c.width, surf = Math.round(c.surface), white = () => rnd() * 2 - 1;
  const voices = [];
  const hL = wxSvf(), hR = wxSvf(), rL = wxSvf(), rR = wxSvf(), hpL = wxSvf(), hpR = wxSvf();
  const sheet = wxSmooth(sr, c.sheetRate, rnd), shimmer = wxSmooth(sr, 0.7, rnd);
  const hissFc = 2500 * Math.pow(2.6, c.tone);
  const info = { type: "rain", drops: 0, bubbles: 0, samples: 0, dropE: 0, bedE: 0, maxVoices: 0 };
  const exp = (x) => Math.exp(x);
  function spawn() {
    let D = -c.drop * Math.log(Math.max(1e-6, 1 - rnd()));                       // Marshall-Palmer: exponential sizes
    D = Math.max(0.25, Math.min(4.5, D));
    const rr = 1.5 + c.spread * Math.sqrt(rnd());                                  // uniform over a disc: most drops are far
    const lpA = 1 - Math.exp(-2 * Math.PI * Math.min(18000, 15000 / Math.pow(rr, 0.55) * (0.6 + 0.8 * c.tone)) / sr);
    const [pl, pr] = wxPan((rnd() * 2 - 1) * width);
    const amp = Math.pow(D, 1.3) / rr;
    const v = { age: 0, amp, pl, pr, lp: 0, lpA, e1: 0, m1: 0, b0: 0, a1: 0, a2: 0, x1: 0, x2: 0, y1: 0, y2: 0,
      e2: 0, m2: 0, modes: null, bub: null };
    const bp = (fc, Q) => { const w0 = 2 * Math.PI * Math.min(fc, 0.45 * sr) / sr, al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
      v.b0 = al / a0; v.a1 = -2 * Math.cos(w0) / a0; v.a2 = (1 - al) / a0; };
    if (surf === 0) {            // HARD: a sharp click, brighter the smaller the drop; big drops splatter
      bp(3200 * Math.pow(1.5 / D, 0.6) * (0.7 + 0.6 * rnd()), 1.3);
      v.e1 = 1; v.m1 = exp(-1 / (sr * (0.0004 + 0.00035 * D)));
      if (D > 1.6) { v.e2 = 0.12 * (D - 1.6); v.m2 = exp(-1 / (sr * (0.008 + 0.012 * rnd()))); }
    } else if (surf === 1) {     // LEAF: a soft click into two damped plate modes: a papery tap
      bp(2500, 1); v.e1 = 0.4; v.m1 = exp(-1 / (sr * 0.0003));
      const f1 = 420 * (1 + 3 * rnd()) * Math.pow(1.2 / D, 0.3), tau = 0.004 + 0.008 * rnd();
      v.modes = [{ ph: 0, w: 2 * Math.PI * f1 / sr, a: 0.8, e: 1, m: exp(-1 / (sr * tau)) },
                 { ph: 0, w: 2 * Math.PI * f1 * (1.5 + 0.9 * rnd()) / sr, a: 0.45, e: 1, m: exp(-1 / (sr * tau * 0.6)) }];
    } else {                     // WATER: a soft slap, and (for some drops) a Minnaert bubble a few ms later
      bp(1400 * (0.7 + 0.6 * rnd()), 0.8); v.e1 = 0.45; v.m1 = exp(-1 / (sr * (0.0005 + 0.0003 * D)));
      const pB = c.bubbles * (D > 0.8 && D < 1.3 ? 1 : 0.45);                     // regular entrainment window ~0.8-1.2 mm
      if (rnd() < pB) {
        const rb = Math.max(0.3, Math.min(3, D * (0.3 + 0.9 * rnd()))) * 1e-3;  // bubble radius (m)
        const f0 = 3.26 / rb, d = (0.13 / rb + 0.0072 * Math.pow(rb, -1.5)) / Math.max(0.2, c.ring);
        v.bub = { at: Math.floor(sr * (0.001 + 0.002 * D * rnd())), f0, d, ph: 0, e: 0.9 * Math.sqrt(rb * 1e3), m: exp(-d / sr), t: 0 };
        info.bubbles++;
      }
    }
    voices.push(v); info.drops++;
  }
  return {
    info,
    tick(drive, o) {
      const sh = c.sheets > 0 ? Math.max(0, 1 + c.sheets * sheet()) : 1;          // wind-driven sheets of rain
      const lam = c.density * drive * sh;
      if (rnd() < lam / sr) spawn();
      if (lam / sr > 1 && rnd() < lam / sr - 1) spawn();
      let L = 0, R = 0;
      for (let i = voices.length - 1; i >= 0; i--) {
        const v = voices[i];
        const x = white() * (v.e1 + v.e2);
        let y = v.b0 * (x - v.x2) - v.a1 * v.y1 - v.a2 * v.y2; v.x2 = v.x1; v.x1 = x; v.y2 = v.y1; v.y1 = y;
        y += white() * v.e2 * 0.6;                                                  // the splash is broadband
        v.e1 *= v.m1; v.e2 *= v.m2;
        let alive = v.e1 > 1e-4 || v.e2 > 1e-4;
        if (v.modes) for (const m of v.modes) { y += m.a * m.e * Math.sin(m.ph); m.ph += m.w; m.e *= m.m; if (m.e > 1e-4) alive = true; }
        if (v.bub) {
          const b = v.bub;
          if (v.age >= b.at) {
            const tb = b.t / sr;
            b.ph += 2 * Math.PI * b.f0 * (1 + 0.1 * b.d * tb) / sr;                // the rising chirp
            y += b.e * Math.sin(b.ph); b.e *= b.m; b.t++;
          }
          if (b.e > 1e-4) alive = true;
        }
        v.lp += (y - v.lp) * v.lpA;                                                // farther drops are duller
        const s = v.lp * v.amp; L += s * v.pl; R += s * v.pr;
        v.age++;
        if (!alive || v.age > sr) voices.splice(i, 1);
      }
      if (voices.length > info.maxVoices) info.maxVoices = voices.length;
      info.dropE += L * L + R * R;
      // the bed: the drops too many and too far to hear one by one
      const bedA = c.hiss * WX_BED * WX_BED_SURF[surf] * Math.sqrt(Math.max(0, lam) / 300) * (1 + 0.15 * shimmer());
      const g = wxG(hissFc, sr), gh = wxG(350, sr);
      wxSvfTick(hL, white(), g, 0.9); wxSvfTick(hR, white(), g, 0.9);
      wxSvfTick(hpL, hL.lp, gh, 1.2); wxSvfTick(hpR, hR.lp, gh, 1.2);
      let bl = bedA * hpL.hp * 2.2, br = bedA * hpR.hp * 2.2;
      if (c.body > 0) {                                                            // the low roar of a downpour
        const gr = wxG(320, sr), ar = c.body * WX_BED * WX_BED_SURF[surf] * Math.sqrt(Math.max(0, lam) / 300) * (1 + 0.3 * shimmer());
        wxSvfTick(rL, white(), gr, Math.SQRT2); wxSvfTick(rR, white(), gr, Math.SQRT2);
        bl += ar * rL.lp * 8; br += ar * rR.lp * 8;
      }
      info.bedE += bl * bl + br * br; info.samples++;
      o[0] = L + bl; o[1] = R + br;
    },
  };
}

// ---------------------------------------------------------------- THUNDER
function wxThunder(sr, c, rnd) {
  const C = 343, ls = 12, tort = 0.2, pull = 0.1;   // ~16 deg kinks per 12 m, a weak pull to the leader's heading
  const segs = [];
  const norm = (v) => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; };
  function grow(p, dir, len, e, depth, down, zLock) {
    let d = dir.slice();
    const h0 = dir.slice();
    for (let s = 0; s < len / ls; s++) {
      d = norm([d[0] + tort * wxGauss(rnd) + pull * h0[0], d[1] + tort * wxGauss(rnd) + pull * h0[1], d[2] + tort * wxGauss(rnd) * (zLock ? 0.4 : 1) + pull * h0[2] - down]);
      if (zLock) d = norm([d[0], d[1], d[2] + (zLock - p[2]) * 0.0015]);         // in-cloud: wander at its height
      const q = [p[0] + d[0] * ls, p[1] + d[1] * ls, p[2] + d[2] * ls];
      if (q[2] <= 0) { q[2] = 0; }
      segs.push({ m: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], u: d, e: e * Math.exp(0.45 * wxGauss(rnd)) });
      p = q;
      if (p[2] <= 0) break;
      if (depth < 2 && rnd() < 0.012) {
        const bd = norm([d[0] + 1.2 * wxGauss(rnd), d[1] + 1.2 * wxGauss(rnd), d[2] + 0.3 * wxGauss(rnd)]);
        grow(p.slice(), bd, len * (0.1 + 0.25 * rnd()), e * 0.35, depth + 1, down * 0.5, zLock);
      }
    }
  }
  const H = c.height;
  if (Math.round(c.kind) === 0) {        // cloud to ground, plus the in-cloud part it came from
    grow([0, 0, H], [0, 0, -1], H * 3, 1, 0, 0.22, 0);
    const a = rnd() * 2 * Math.PI;
    grow([0, 0, H], [Math.cos(a), Math.sin(a), 0], c.cloudLen, 0.55, 1, 0, H);
  } else {                                // in-cloud / cloud to cloud: a long horizontal channel, no ground strike
    const a = rnd() * 2 * Math.PI;
    grow([-Math.cos(a) * c.cloudLen / 2, -Math.sin(a) * c.cloudLen / 2, H], [Math.cos(a), Math.sin(a), 0], c.cloudLen, 1, 0, 0, H);
  }
  const az = (rnd() - 0.5) * 0.6, D = c.distance * 1000, lis = [D * Math.cos(az), D * Math.sin(az), 1.6];
  // arrivals
  const arr = [];
  let dMin = Infinity, dMax = 0;
  for (const s of segs) {
    const v = [lis[0] - s.m[0], lis[1] - s.m[1], lis[2] - s.m[2]], d = Math.hypot(v[0], v[1], v[2]);
    const cos = Math.abs((v[0] * s.u[0] + v[1] * s.u[1] + v[2] * s.u[2]) / d);
    const T = c.pulseMs / 1000 * Math.pow(d / 1000, 0.25) * (0.7 + 0.6 * rnd()) + 0.0004 * d / 1000; // stretch + scatter
    // a segment along the line of sight smears its pulse over ls*cos/c: it arrives weaker (energy spread in time). Only
    // part of that is a LONGER pulse, because sub-segment kinks keep the emission from being one coherent line source.
    const smear = ls * cos / C, tot = 2 * T + 0.3 * smear;
    // the side of the bolt it comes from: listener faces the strike (-x)
    const side = (lis[1] - s.m[1]) / Math.hypot(lis[0] - s.m[0], lis[1] - s.m[1]);
    arr.push({ d, tot, a: s.e * Math.pow(1000 / d, 1.1) * (2 * T / (2 * T + smear)), side, cr: s.e * Math.pow(1000 / d, 1.1) });
    if (d < dMin) dMin = d; if (d > dMax) dMax = d;
  }
  const spread = (dMax - dMin) / C, kT = spread > c.roll ? c.roll / spread : 1;
  const pre = Math.floor(0.03 * sr), maxTot = arr.reduce((m, a) => Math.max(m, a.tot), 0);
  const n = pre + Math.ceil((spread * kT + maxTot) * sr) + Math.floor(0.6 * sr);
  // distance bands, each low-passed for its distance (air absorption)
  const NB = 7, bands = [];
  for (let b = 0; b < NB; b++) bands.push({ L: new Float32Array(n), R: new Float32Array(n) });
  const lnMin = Math.log(dMin), lnSpan = Math.max(1e-6, Math.log(dMax) - lnMin);
  for (const a of arr) {
    const b = Math.min(NB - 1, Math.floor((Math.log(a.d) - lnMin) / lnSpan * NB));
    const at = pre + Math.floor(((a.d - dMin) / C) * kT * sr), N = Math.max(4, Math.round(a.tot * sr));
    const [pl, pr] = wxPan(Math.max(-1, Math.min(1, a.side * c.width)));
    const BL = bands[b].L, BR = bands[b].R;
    for (let k = 0; k < N && at + k < n; k++) {
      let v = 1 - 2 * k / N;                                                       // the N: a jump up, a ramp down, a jump back
      if (k === 0) v *= 0.5;
      BL[at + k] += a.a * v * pl; BR[at + k] += a.a * v * pr;
    }
    // CRACKLE: the channel's fine (metre-scale) kinks inside this segment, each a tiny N-wave of a fraction of a ms,
    // scattered over the segment's arrival window. Their highs are what the air absorbs first, so they only survive
    // from the near part of a close bolt: the crack.
    const nm = Math.round(c.crackle * 6 * rnd());
    for (let q = 0; q < nm; q++) {
      const st = at + Math.floor(rnd() * Math.max(1, N)), M = Math.max(3, Math.round(sr * (0.00015 + 0.0005 * rnd())));
      const am = a.cr * c.crackle * (0.3 + 0.7 * rnd()) * (rnd() < 0.5 ? -1 : 1);
      for (let k = 0; k < M && st + k < n; k++) { const v = am * (1 - 2 * k / M); BL[st + k] += v * pl; BR[st + k] += v * pr; }
    }
  }
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let b = 0; b < NB; b++) {
    const dB = Math.exp(lnMin + (b + 0.5) / NB * lnSpan);
    const fc = Math.min(16000, 3500 * Math.pow(1000 / dB, 0.8) * (0.5 + c.tone));
    const al = 1 - Math.exp(-2 * Math.PI * fc / sr);
    for (const [src, dst] of [[bands[b].L, L], [bands[b].R, R]]) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < n; i++) { s1 += (src[i] - s1) * al; s2 += (s1 - s2) * al; dst[i] += s2; }
    }
  }
  const info = { type: "thunder", segments: segs.length, dMin, dMax, physSpread: spread, roll: spread * kT, compress: kT, bufSec: n / sr };
  let i = 0;
  return {
    info,
    tick(drive, o) { if (i < n) { o[0] = L[i] * drive; o[1] = R[i] * drive; i++; } else { o[0] = 0; o[1] = 0; } },
  };
}

export function makeWeather(sr, cfg, seed) {
  const c = Object.assign({}, WX_DEFAULTS, cfg);
  const rnd = wxRng(seed);
  const t = Math.round(c.type);
  return t === 1 ? wxRain(sr, c, rnd) : t === 2 ? wxThunder(sr, c, rnd) : wxWind(sr, c, rnd);
}
// convenience: render n samples with a per-sample drive curve (a function of the sample index)
export function renderWeather(sr, cfg, seed, n, drive) {
  const w = makeWeather(sr, cfg, seed), L = new Float32Array(n), R = new Float32Array(n), o = [0, 0];
  for (let i = 0; i < n; i++) { w.tick(drive ? drive(i) : 1, o); L[i] = o[0]; R[i] = o[1]; }
  return { L, R, info: w.info };
}
export { WX_DEFAULTS };

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

  // ---- loudness: copied from tools/make-ab.mjs (ITU BS.1770, K-weighted, gated)
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
  // A take whose peaks keep it more than 0.5 dB under the target gets the app's OWN Limiter (dsp.js limiterProcess,
  // the "Limiter" control any preset can set), the smallest amount in steps of 0.1 that brings it within 0.5 dB.
  // Without it a peaky take (a near raindrop, a thunder crack) is heard several dB quieter, which decides a blind round.
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
    const env = envelope(t.env || {}, dur);
    const r = renderWeather(SR, t.cfg, t.seed || 1234, n, env);
    if (t.cfg.type === 2) r.info.dryRumble = rumbleOf(r.L, r.R);
    const room = t.room || ctrl;                    // the control's own Freeverb settings
    if (room && room.reverb > 0) reverbProcess(r.L, r.R, room.reverbSize, room.reverbTone, room.reverb);
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
  function frames(L, R, hop) {   // per frame: rms dB, spectral centroid, tonality (strongest narrow peak above its neighborhood, dB)
    const N = 2048, out = [];
    for (let a = 0; a + N <= L.length; a += hop) {
      const re = new Float64Array(N), im = new Float64Array(N); let e = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), x = (L[a + i] + R[a + i]) / 2; re[i] = x * w; e += x * x; }
      fft(re, im);
      const mag = new Float64Array(N / 2); let num = 0, den = 0;
      for (let k = 1; k < N / 2; k++) { mag[k] = Math.hypot(re[k], im[k]); num += k * mag[k] * mag[k]; den += mag[k] * mag[k]; }
      let ton = 0;
      for (let k = 6; k < N / 2 - 30; k++) {      // > 130 Hz
        if (mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
        let s = 0, c = 0; for (let j = k - 25; j <= k + 25; j++) if (Math.abs(j - k) > 3) { s += mag[j] * mag[j]; c++; }
        const r = 10 * Math.log10(mag[k] * mag[k] / (s / c + 1e-20)); if (r > ton) ton = r;
      }
      out.push({ t: (a + N / 2) / SR, db: 10 * Math.log10(e / N + 1e-20), cent: den > 0 ? num / den * SR / N : 0, ton });
    }
    return out;
  }
  function corr(a, b) { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let sab = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sab / Math.sqrt(sa * sb + 1e-30); }
  function rumbleOf(L, R) {   // seconds from onset (-40 dB re peak) to the last 50 ms window above -25 dB re peak
    const n = L.length, env = [], hop = Math.floor(0.01 * SR), w = Math.floor(0.05 * SR);
    for (let a = 0; a + w <= n; a += hop) { let s = 0; for (let i = a; i < a + w; i++) s += L[i] * L[i] + R[i] * R[i]; env.push(10 * Math.log10(s / w + 1e-20)); }
    const tp = Math.max(...env), on = env.findIndex((v) => v > tp - 40);
    let last = on; for (let i = 0; i < env.length; i++) if (env[i] > tp - 25) last = i;
    return (last - on) * hop / SR;
  }
  function measure(L, R, kind, info) {
    const n = L.length; let pk = 0, nan = 0;
    for (let i = 0; i < n; i++) { if (!isFinite(L[i]) || !isFinite(R[i])) nan++; pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
    const e = Math.floor(0.002 * SR); let sMax = 0, eMax = 0;
    for (let i = 0; i < e; i++) { sMax = Math.max(sMax, Math.abs(L[i]), Math.abs(R[i])); eMax = Math.max(eMax, Math.abs(L[n - 1 - i]), Math.abs(R[n - 1 - i])); }
    const m = { sec: n / SR, lufs: lufs(L, R), peak: pk, nan, edgeStart: sMax / (pk || 1), edgeEnd: eMax / (pk || 1), first: Math.abs(L[0]) + Math.abs(R[0]), last: Math.abs(L[n - 1]) + Math.abs(R[n - 1]) };
    const F = frames(L, R, Math.floor(0.025 * SR)), top = Math.max(...F.map((f) => f.db));
    const live = F.filter((f) => f.db > top - 30);
    m.centroid = live.reduce((s, f) => s + f.cent, 0) / (live.length || 1);
    if (kind === "wind") {
      // gusts heard: peaks in a 150 ms smoothed level with >= 2 dB on both sides
      const sm = live.map((f, i) => { let s = 0, c = 0; for (let j = i - 3; j <= i + 3; j++) if (live[j]) { s += live[j].db; c++; } return s / c; });
      let peaks = 0;
      for (let i = 1; i < sm.length - 1; i++) if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1]) {
        let lm = sm[i], rm = sm[i]; for (let j = i; j >= 0 && sm[j] <= sm[i]; j--) lm = Math.min(lm, sm[j]); for (let j = i; j < sm.length && sm[j] <= sm[i]; j++) rm = Math.min(rm, sm[j]);
        if (sm[i] - lm >= 2 && sm[i] - rm >= 2) peaks++;
      }
      m.levelPeaksPerSec = peaks / m.sec;
      m.levelCentroidCorr = corr(live.map((f) => f.db), live.map((f) => f.cent));
      m.tonalFrames = live.filter((f) => f.ton > 12).length / (live.length || 1);
    }
    if (kind === "rain") {
      m.tonalFrames = live.filter((f) => f.ton > 12).length / (live.length || 1);
      // drops HEARD: 1 ms frames of the high-passed signal standing 6 dB over the median of the 40 ms around them
      // (a lower bound: in dense rain, drops that overlap are counted once)
      const h = Math.floor(0.001 * SR), E = [];
      for (let a = 1; a + h <= n; a += h) { let s = 0; for (let i = a; i < a + h; i++) { const x = L[i] - L[i - 1], y = R[i] - R[i - 1]; s += x * x + y * y; } E.push(s); }
      let on = 0;
      for (let i = 20; i < E.length - 20; i++) {
        if (!(E[i] > E[i - 1] && E[i] >= E[i + 1])) continue;
        const nb = E.slice(i - 20, i + 21).sort((x, y) => x - y)[20];
        if (E[i] > nb * 4) on++;
      }
      m.dropsHeardPerSec = on / ((E.length - 40) / 1000);
    }
    if (kind === "thunder") {
      const env = [], hop = Math.floor(0.01 * SR), w = Math.floor(0.05 * SR);
      for (let a = 0; a + w <= n; a += hop) { let s = 0; for (let i = a; i < a + w; i++) s += L[i] * L[i] + R[i] * R[i]; env.push(10 * Math.log10(s / w + 1e-20)); }
      const tp = Math.max(...env), on = env.findIndex((v) => v > tp - 40);
      let lastAbove = on; for (let i = 0; i < env.length; i++) if (env[i] > tp - 25) lastAbove = i;
      m.rumbleSec = (lastAbove - on) * hop / SR;
      // swells: local maxima of a 120 ms smoothed envelope standing 3 dB over both neighborhoods, within the rumble
      const sm = env.map((v, i) => { let s = 0, c = 0; for (let j = i - 6; j <= i + 6; j++) if (env[j] !== undefined) { s += env[j]; c++; } return s / c; });
      let sw = 0; for (let i = on + 1; i < lastAbove; i++) if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1]) {
        let lm = sm[i], rm = sm[i]; for (let j = i; j >= on && sm[j] <= sm[i]; j--) lm = Math.min(lm, sm[j]); for (let j = i; j <= lastAbove && sm[j] <= sm[i]; j++) rm = Math.min(rm, sm[j]);
        if (sm[i] - lm >= 3 && sm[i] - rm >= 3) sw++; }
      m.swells = sw;
      // crack: share of > 2 kHz energy in the first 150 ms after onset, and the crest factor there
      const o0 = on * hop, o1 = Math.min(n, o0 + Math.floor(0.15 * SR));
      let hf = 0, all = 0, pk2 = 0, rms2 = 0, py = 0, px = 0; const a2 = Math.exp(-2 * Math.PI * 2000 / SR);
      for (let i = o0; i < o1; i++) { const x = (L[i] + R[i]) / 2; py = a2 * (py + x - px); px = x; hf += py * py; all += x * x; pk2 = Math.max(pk2, Math.abs(x)); rms2 += x * x; }
      m.crackHF = hf / (all || 1); m.crackCrest = pk2 / Math.sqrt(rms2 / (o1 - o0) || 1);
    }
    if (info) m.info = info;
    return m;
  }

  // ---- THE ROUND
  const SOUNDS = [
    { name: "Wind Gust", kind: "wind", listen: "One gust of wind, the way a game uses it (a door opening onto a storm, a cliff edge, a transition). Which is WIND: air moving, not a hiss with a filter on it? Listen to whether the sound changes COLOR as it gets stronger, and whether it feels like moving air or like a static noise being faded.",
      takes: [
        { id: "open-field", why: "MODEL, wind over open ground: turbulence only, no whistle. One gust swell (an attack/decay/release like the control's, used as the wind SPEED) with a surge or two inside it; the band climbs from ~200 Hz to ~1.5 kHz as the speed rises and falls back as it eases.",
          cfg: { type: 0, intensity: 0.9, gustiness: 0.75, gustRate: 1.6, tone: 0.45, body: 0.25, width: 0.7 }, env: { a: 0.45, h: 0.15, d: 0.5, s: 0.45, r: 0.75 }, seed: 11 },
        { id: "through-a-gap", why: "MODEL, the same kind of gust heard through a gap (a window frame, a door): darker turbulence and two edge-tone whistles (~700 Hz, Q 70) that lock in only near the peak, rising in pitch with the gust and gliding down as it dies.",
          cfg: { type: 0, intensity: 1, gustiness: 0.45, gustRate: 1.0, tone: 0.25, body: 0.2, width: 0.6, whistles: 2, whistle: 0.5, pitch: 700, whistleQ: 70 }, env: { a: 0.5, h: 0.15, d: 0.45, s: 0.5, r: 0.7 }, seed: 23 },
        { id: "buffeting", why: "MODEL, wind hitting you or a corner: fast flutter (gust rate 2.5/s, high gustiness), a strong low buffeting body, dark, no whistle: the rumble of air shoving at something.",
          cfg: { type: 0, intensity: 1, gustiness: 0.85, gustRate: 2.5, tone: 0.3, body: 0.8, width: 0.8 }, env: { a: 0.35, h: 0.1, d: 0.5, s: 0.5, r: 0.7 }, seed: 37 },
      ] },
    { name: "Howling Squall", kind: "wind", listen: "A squall: strong, sustained, howling wind (a storm outside, a mountain pass). Which one HOWLS like wind rather than droning like an engine? Listen for whether the howl moves with the strength of the wind.",
      takes: [
        { id: "chimney-howl", why: "MODEL, the moan of wind over an opening (a chimney, a pipe, a cave mouth): three low resonances (~190 Hz and two inharmonic partners, Q 25) that swell and bend in pitch with each gust, over a dark roar.",
          cfg: { type: 0, intensity: 1, gustiness: 0.6, gustRate: 0.9, tone: 0.2, body: 0.5, width: 0.7, whistles: 3, whistle: 1, pitch: 190, whistleQ: 25 }, env: { a: 0.25, d: 0.4, s: 0.85, r: 0.55 }, seed: 51 },
        { id: "storm-front", why: "MODEL, a storm front with no whistle at all: full intensity, very gusty (1.6 surges a second), bright turbulence and heavy low body. The howl, if there is one, comes only from the band sweeping up and down.",
          cfg: { type: 0, intensity: 1, gustiness: 0.9, gustRate: 1.6, tone: 0.6, body: 0.7, width: 0.85 }, env: { a: 0.2, d: 0.4, s: 0.85, r: 0.55 }, seed: 63 },
        { id: "shrieking-rigging", why: "MODEL, high wind through wires and rigging: three narrow high whistles (~950 Hz up, Q 90) over a moderate roar; each gust drags their pitch up and lets it fall.",
          cfg: { type: 0, intensity: 1, gustiness: 0.7, gustRate: 1.1, tone: 0.4, body: 0.35, width: 0.75, whistles: 3, whistle: 0.6, pitch: 950, whistleQ: 90 }, env: { a: 0.25, d: 0.4, s: 0.85, r: 0.55 }, seed: 79 },
      ] },
    { name: "Rain", kind: "rain", listen: "Steady rain (a loop under a scene). Which one is RAIN: many separate drops, rather than static? Then which surface it sounds like it is falling on.",
      takes: [
        { id: "on-pavement", why: "MODEL, rain on a hard surface: ~350 drops/s, exponential sizes (mean 1.1 mm), each a sharp click brighter the smaller it is (big ones splatter), spread over an area so most are far and dull; a light hiss bed.",
          cfg: { type: 1, density: 350, drop: 1.1, spread: 6, surface: 0, hiss: 0.5, tone: 0.55, body: 0, width: 0.8 }, env: { a: 0.15, d: 0.5, s: 0.75, r: 0.6 }, seed: 101 },
        { id: "on-a-pond", why: "MODEL, rain on water: ~260 drops/s, soft slaps, and for most drops a bubble ringing a few ms later (Minnaert: 1.5-6 kHz, pitch rising as it rings): the plink of rain on a pond.",
          cfg: { type: 1, density: 260, drop: 1.3, spread: 6, surface: 2, hiss: 0.4, bubbles: 0.8, ring: 1.6, tone: 0.5, width: 0.8 }, env: { a: 0.15, d: 0.5, s: 0.75, r: 0.6 }, seed: 113 },
        { id: "on-leaves", why: "MODEL, rain on a forest canopy: ~300 drops/s tapping leaves (two damped plate modes each, 400-2000 Hz), papery and lower; a darker bed.",
          cfg: { type: 1, density: 300, drop: 1.5, spread: 6, surface: 1, hiss: 0.35, tone: 0.3, width: 0.85 }, env: { a: 0.15, d: 0.5, s: 0.75, r: 0.6 }, seed: 127 },
      ] },
    { name: "Heavy Rain", kind: "rain", listen: "A downpour. Which one is HEAVY RAIN rather than frying or static? Which has weight?",
      takes: [
        { id: "downpour-on-a-roof", why: "MODEL, a downpour on a hard roof: ~2500 drops/s, big drops (mean 2.2 mm) splattering, a loud hiss and a low roar under it.",
          cfg: { type: 1, density: 2500, drop: 2.2, spread: 7, surface: 0, hiss: 0.9, body: 0.6, tone: 0.45, width: 0.85 }, env: { a: 0.05, h: 0.02, d: 0.1, s: 1, r: 0.4 }, seed: 131 },
        { id: "deluge-on-a-lake", why: "MODEL, a deluge on open water: ~1800 drops/s with bubbles plinking all through it, a roar of the water surface.",
          cfg: { type: 1, density: 1800, drop: 2.0, spread: 7, surface: 2, hiss: 0.8, bubbles: 0.7, ring: 1.3, body: 0.45, tone: 0.5, width: 0.85 }, env: { a: 0.05, h: 0.02, d: 0.1, s: 1, r: 0.4 }, seed: 149 },
        { id: "windswept-sheets", why: "MODEL, a storm driving rain in SHEETS across foliage: ~1600 drops/s whose rate surges and drops (wind-driven sheets, ~0.8 Hz), on leaves, with a roar.",
          cfg: { type: 1, density: 1600, drop: 1.9, spread: 7, surface: 1, hiss: 0.85, body: 0.5, sheets: 0.85, sheetRate: 0.8, tone: 0.4, width: 0.9 }, env: { a: 0.05, h: 0.02, d: 0.1, s: 1, r: 0.4 }, seed: 157 },
      ] },
    { name: "Thunder", kind: "thunder", listen: "Thunder. Which one is a real THUNDERCLAP / roll of thunder rather than an explosion with reverb? Listen to the shape over time: does it roll, with swells, or just decay? (Use headphones or speakers with some bass: real thunder lives low.)",
      takes: [
        { id: "close-strike", why: "MODEL, a cloud-to-ground strike ~500 m away: the tortuous channel's nearest segments arrive first nearly unfiltered (the ripping crack), the rest of the bolt rolls in behind it (15-25 dB under the crack, ~1.3 s dry), darker as it comes from higher and farther. Crack-dominated: closer to a Thunderclap than a roll.",
          cfg: { type: 2, distance: 0.5, kind: 0, roll: 1.6, pulseMs: 2.5, crackle: 0.8, height: 2500, cloudLen: 2000, tone: 0.55, width: 0.8 }, env: { a: 0.0005, s: 1, r: 0.06 }, seed: 211, dur: 2.4 },
        { id: "rolling-overhead", why: "MODEL, an in-cloud discharge rolling overhead (~1.5 km): a long horizontal channel and no ground strike, so no crack: the rumble swells wherever a stretch of the channel lies broadside to you.",
          cfg: { type: 2, distance: 1.5, kind: 1, roll: 1.9, pulseMs: 2.2, crackle: 0.5, height: 2000, cloudLen: 6000, tone: 0.5, width: 0.9 }, env: { a: 0.0005, s: 1, r: 0.06 }, seed: 223, dur: 2.4 },
        { id: "distant-rumble", why: "MODEL, a strike ~7 km away: long N-waves, the highs absorbed by the air, a low dark roll with no crack.",
          cfg: { type: 2, distance: 7, kind: 0, roll: 1.9, pulseMs: 2.5, crackle: 0.6, height: 3000, cloudLen: 4000, tone: 0.5, width: 0.7 }, env: { a: 0.0005, s: 1, r: 0.06 }, seed: 239, dur: 2.4 },
      ] },
  ];

  const OUT = join(ROOT, "soundtests", "proto-weather");
  mkdirSync(OUT, { recursive: true });
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const fmt = (m) => {
    const parts = [m.sec.toFixed(2) + " s", m.lufs.toFixed(1) + " LUFS", "peak " + m.peak.toFixed(3), "NaN " + m.nan, "edge " + m.edgeStart.toFixed(4) + "/" + m.edgeEnd.toFixed(4), "centroid " + Math.round(m.centroid) + " Hz"];
    if (m.levelPeaksPerSec !== undefined) parts.push("surges " + m.levelPeaksPerSec.toFixed(2) + "/s", "level~centroid r=" + m.levelCentroidCorr.toFixed(2), "tonal " + (m.tonalFrames * 100).toFixed(0) + "%");
    else if (m.tonalFrames !== undefined) parts.push("tonal " + (m.tonalFrames * 100).toFixed(0) + "%", "drops heard " + Math.round(m.dropsHeardPerSec) + "/s");
    if (m.rumbleSec !== undefined) parts.push("rumble " + m.rumbleSec.toFixed(2) + " s", "swells " + m.swells, "crack HF " + (m.crackHF * 100).toFixed(1) + "%", "crest " + m.crackCrest.toFixed(1));
    if (m.info) {
      const i = m.info;
      if (i.type === "wind") parts.push("gusts " + (i.gusts / m.sec).toFixed(2) + "/s", "whistle on " + (i.whistleOnSamples / i.samples * 100).toFixed(0) + "%", "whistle energy " + (i.whistleE / (i.allE || 1) * 100).toFixed(0) + "%", "speed max " + i.speedMax.toFixed(2));
      if (i.type === "rain") parts.push("drops " + Math.round(i.drops / m.sec) + "/s", "bubbles " + Math.round(i.bubbles / m.sec) + "/s", "drops' share " + (i.dropE / (i.dropE + i.bedE) * 100).toFixed(0) + "%", "max voices " + i.maxVoices);
      if (i.type === "thunder") parts.push("dry rumble " + i.dryRumble.toFixed(2) + " s", "segments " + i.segments, "dist " + Math.round(i.dMin) + "-" + Math.round(i.dMax) + " m", "phys spread " + i.physSpread.toFixed(2) + " s -> " + i.roll.toFixed(2) + " s");
    }
    if (m.limiter) parts.push("LIMITER " + m.limiter);
    return parts.join(", ");
  };
  const readme = [];
  for (const S of SOUNDS) {
    const ctrlPatch = preset(S.name), ctrlDur = ctrlPatch.duration;
    const takes = [{ id: "current", why: "the CURRENT preset \"" + S.name + "\", rendered by the exported engine (the control).", control: ctrlPatch }].concat(S.takes);
    let seed = 0x5f3759df;
    for (const ch of S.name) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const order = takes.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const j = seed % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const dir = join(OUT, slug(S.name)), key = [];
    mkdirSync(dir, { recursive: true });
    console.log(S.name);
    order.forEach((ti, slot) => {
      const t = takes[ti], dur = t.dur || ctrlDur;
      const r = renderTake(t, dur, ctrlPatch);
      const lim = matchWithLimiter(r.L, r.R);
      const m = measure(r.L, r.R, S.kind, r.info); m.limiter = lim;
      const file = "take-" + "ABCD"[slot] + ".wav";
      writeFileSync(join(dir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title: S.name + " " + file })));
      key.push({ file, t, m });
      console.log("  " + file + "  " + t.id.padEnd(20) + " " + fmt(m));
      const bad = [];
      if (m.nan) bad.push("NaN"); if (m.peak >= 1) bad.push("peak"); if (m.lufs < -40) bad.push("silent");
      if (!t.control && (m.edgeStart > 0.05 || m.edgeEnd > 0.05)) bad.push("edge click?");
      if (m.lufs < TARGET_LUFS - 0.6) bad.push("under target");
      if (bad.length) console.log("    !! " + bad.join(", "));
    });
    writeFileSync(join(dir, "LISTEN.md"), "# " + S.name + " (weather engine prototype)\n\n" + takes.length + " takes, `take-A.wav` to `take-" + "ABCD"[takes.length - 1] +
      ".wav`, each matched to " + TARGET_LUFS + " LUFS (or capped below full scale), in a shuffled order. One of them is today's preset.\n\n" + S.listen +
      "\n\nSay the letter (and a runner-up if two are close), and whether the best one is CLEARLY better than the rest or only a little. `KEY.md` says what each one is: **read it after listening.**\n");
    writeFileSync(join(dir, "KEY.md"), "# " + S.name + ": the key\n\n" + key.map((k) => "## " + k.file + ": `" + k.t.id + "`\n" + k.t.why + "\n\n" +
      "Measured: " + fmt(k.m) + "\n\n" +
      (k.t.control && (k.m.edgeStart > 0.05 || k.m.edgeEnd > 0.05) ? "Note: the control itself starts or ends abruptly (edge " + k.m.edgeStart.toFixed(3) + " / " + k.m.edgeEnd.toFixed(3) + " of its peak in the first / last 2 ms): a click that is in today's preset, not added here.\n\n" : "") +
      (k.m.limiter ? "Note: this take's peaks kept it under " + TARGET_LUFS + " LUFS, so it got the app's own Limiter at " + k.m.limiter + " before matching (see README).\n\n" : "") +
      "```json\n" + JSON.stringify(k.t.control ? k.t.control : { cfg: k.t.cfg, env: k.t.env, seed: k.t.seed }) + "\n```\n").join("\n"));
    readme.push("- `" + slug(S.name) + "/`: " + S.name + " (" + takes.length + " takes)");
    if (VERBOSE) for (const k of key) console.log(JSON.stringify({ take: k.file, id: k.t.id, m: k.m }));
  }
  writeFileSync(join(OUT, "README.md"), "# Weather engine prototype: listening round\n\n" +
    "A prototype synthesis engine for wind, rain and thunder (`tools/proto/weather.mjs`, regenerate with `node tools/proto/weather.mjs`), heard " +
    "against today's presets, which are mostly a sine plus filtered noise. The question is not \"which settings\" but **is a model of the air and " +
    "the water clearly better than noise**, sound by sound.\n\n" + readme.join("\n") + "\n\n" +
    "In each folder: `take-A.wav` ... `take-D.wav`, one of them the CURRENT preset (rendered by the exported engine, `synth-export/crunchysfx-synth.js`), " +
    "the others three different interpretations from the model. All loudness-matched to " + TARGET_LUFS + " LUFS (peaks capped at 0.95) and shuffled with a fixed seed. " +
    "Read `LISTEN.md` first, listen, then read `KEY.md`.\n\n" +
    "**The room:** every model take gets the control preset's own reverb (the same Freeverb from dsp.js, same size, tone and wet), so the comparison is not about space. " +
    "The control's delay (Thunder has one) is not copied: the model's roll is meant to do that job.\n\n" +
    "**The limiter:** a take whose peaks (a near raindrop, a thunder crack) kept it more than 0.5 dB under the target after the 0.95 peak cap " +
    "was run through the app's own Limiter (dsp.js `limiterProcess`, the Limiter control any preset can set) at the smallest amount, in steps of 0.1, that " +
    "brings it within 0.5 dB. Otherwise a peaky take is heard several dB quieter, which decides a blind round. KEY.md says which takes got it and how much.\n\n" +
    "**Playback:** Thunder especially: the model's distant takes sit mostly below 150 Hz, as real thunder does, so laptop speakers will undersell them.\n\n" +
    "**Lengths:** the model takes match the control's duration, except Thunder (2.4 s against 2.0 s) so the roll can finish.\n\n" +
    "**What to report per sound:** the letter you prefer, and whether it is clearly better, a little better, or no better than the others. " +
    "\"Noise was fine here\" is a useful answer: it means that weather type does not need the engine.\n");
  console.log("-> " + OUT);
}
