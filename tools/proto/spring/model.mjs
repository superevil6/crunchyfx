/* spring/model.mjs — the "spring" engine (boing / doorstop / spring tank / jaw-harp twang), written the way dsp.js writes
 * makeBrass/makeBowed: a pure factory with a per-sample tick(). No DOM, no app state, no Math.random (a seeded LCG).
 *
 * WHY A SPRING IS NOT A PITCH SWEEP. A coil spring is a DISPERSIVE medium: below its transition frequency, high
 * frequencies travel along the coil faster than low ones. An impulse therefore arrives at the far end as a falling
 * chirp ("pew"), comes back after every round trip, and each trip smears it further (the spring tank's "drip"). Close
 * the same coil into a loop a few milliseconds long and it is a PITCHED, strongly inharmonic string: its upper partials
 * are stretched apart, which is the metallic "doinng" of a doorstop.
 *
 * SIGNAL FLOW (types 0 and 1: two loops, one per output channel = two springs / the tip's two directions of swing)
 *
 *   excitation (coil: a zero-mean doublet, a tap on the end, width from Pluck; doorstop: the bent tip let go, a
 *   one-period smooth bump like a plucked string's initial shape, sent as its velocity, brightened by Pluck, plus a
 *   seeded finger scrape)
 *     -> + feedback --> soft limit tanh(d x)/d (Pluck: a hard flick clangs) --> DC leak (3 Hz; normalized to <= 1;
 *        a loop rings at 0 Hz too, so a unipolar pluck would otherwise park a slowly decaying offset in it)
 *     -> THE DISPERSION: a cascade of second-order allpasses DESIGNED so the chain's group delay is a straight line in
 *        log-frequency between flo and fhi (band-wise allpass design, after Abel & Smith's dispersion-filter method):
 *        sections are placed where the running integral of the wanted group delay crosses each multiple of 2 pi (one
 *        2nd-order allpass carries exactly 2 pi of phase over 0..pi), each as wide as its spacing. So the chirp is an
 *        even glide in OCTAVES, either direction, with its duration per pass set directly by Dispersion. Falling
 *        (Dispersion > 0): the lows wait; rising (< 0): the highs wait.
 *     -> 4th-order Butterworth low-pass at fhi (a spring is band-limited; the rising design stops at fhi); 2.5 fhi on
 *        a doorstop, whose hundreds of passes a second would otherwise strip its top in a fraction of a second
 *     ==> TAP (the output; before the loss, so the first arrival keeps its top; DC-blocked outside the loop)
 *     -> one-pole high-frequency loss (Damping: highs die faster) -> x g (per-pass loss from the T60)
 *     -> fractional delay line (4-point Lagrange) whose length the SWAY LFO modulates (the coil stretching as it
 *        swings) -> back to the top
 *   the tap x (1 + 0.5 sway(t)) (the swinging spring points toward and away from you), the two channels' sway a
 *   quarter cycle apart (the tip moves in a circle).
 *
 *   type 0 COIL     loop = the Length knob (5..400 ms round trip): separate chirps, a spring tank, a long toy coil.
 *                   The patch pitch sets the band: fhi = 6 x freq (500..9000 Hz), flo = fhi / 32 (5 octaves).
 *                   Dispersion 1 = 80 ms of glide per pass (never more than 90% of the round trip).
 *   type 1 DOORSTOP loop = one period of the patch pitch (the delay is solved so the FUNDAMENTAL lands on freq after
 *                   the dispersion's own phase delay); flo = freq, fhi = 16 x freq. Dispersion = how inharmonic:
 *                   falling stretches the partials apart (stiff-wire "doinng"), rising crowds them (a bell-ish "dunk").
 *   type 2 TWANG    a jaw harp: no loop. A plucked steel reed (decaying, harmonically rich: the reed chopping the
 *                   airflow, built additively so it cannot alias) plus the lamella's own first bar overtone
 *                   (6.27 x, a short "ting"), through the MOUTH: two resonant band-passes (F1, F2) where F2 picks
 *                   individual harmonics out of the drone. Mouth glides F2 up (+) or down (-) by up to 2 octaves after
 *                   the pluck ("bwoing"/"boyng"); Sway wobbles it ("oy-oy-oy").
 *   The mouth stage also runs on types 0 and 1 when Mouth is not 0 (a "talking" spring), mixed with the dry spring.
 *
 * STABILITY: every block in the loop has |H| <= 1 at every frequency (allpasses exactly 1; Butterworth low-pass, the
 * the DC leak and the one-pole are <= 1; 4-point Lagrange with the fraction between its middle taps is <= 1), the soft limit has |f(x)| <= |x|,
 * and g < 1 — so the loop is contractive. loopGainMax() evaluates it on a frequency grid; spring.mjs `stability`
 * renders the worst corners for 4 s and checks the tail only decays.
 */

const TAU = 2 * Math.PI;
export const SPRING_TYPES = ["Coil (spring tank / toy coil)", "Doorstop", "Twang (jaw harp)"];

// Proposed PARAMS rows, in index.html's shape: [key, label, min, max, step, default, unit, group, kind?, list?]
// The patch's own `freq` is the spring's pitch (tension), as `freq` is every engine's pitch.
export const SPRING_PARAMS = [
  ["springType", "Spring", 0, 2, 1, 0, "", "Spring", "enum", SPRING_TYPES],
  ["springLength", "Length (coil)", 5, 400, 1, 60, "ms", "Spring"],
  ["springDisp", "Dispersion", -1, 1, 0.01, 0.6, "", "Spring"],
  ["springDamp", "Damping", 0, 1, 0.01, 0.4, "", "Spring"],
  ["springSway", "Sway", 0, 1, 0.01, 0, "", "Spring"],
  ["springSwayRate", "Sway rate", 0.5, 30, 0.1, 7, "Hz", "Spring"],
  ["springPluck", "Pluck", 0, 1, 0.01, 0.5, "", "Spring"],
  ["springMouth", "Mouth", -1, 1, 0.01, 0, "", "Spring"],
  ["springVowel", "Vowel", 0, 1, 0.01, 0.4, "", "Spring"],
];
export const SPRING_DEFAULTS = Object.fromEntries(SPRING_PARAMS.map((p) => [p[0], p[5]]));

export function springCfg(st) {
  const s = Object.assign({}, SPRING_DEFAULTS, st);
  return {
    type: Math.max(0, Math.min(2, Math.round(s.springType))),
    lengthS: s.springLength / 1000, disp: s.springDisp, damp: s.springDamp, sway: s.springSway,
    swayRate: s.springSwayRate, pluck: s.springPluck, mouth: s.springMouth, vowel: s.springVowel,
    _noSat: !!s._noSat, _noScrape: !!s._noScrape,   // measurement hooks (not PARAMS rows): the soft limit off, the scrape off
  };
}

const COIL_GLIDE = 0.08;     // seconds of glide per pass at |Dispersion| 1 (coil)
const SWAY_PITCH = [0.06, 0.03]; // delay-length swing at Sway 1 (coil, doorstop): +-6% / +-3% (~ +-50 cents)
const GLIDE_MAX = 0.35;      // the mouth's glide time (s), shortened on a short-lived pluck
const MAX_SECTIONS = 400;    // a ceiling on the allpass count (a 400 ms rising glide over 5 octaves needs ~260)

// T60 (seconds) of the loop / the reed, from Damping
export const springT60 = (type, damp) => type === 0 ? 5 * Math.pow(0.04, damp) : type === 1 ? 3 * Math.pow(0.06, damp) : 2.5 * Math.pow(0.1, damp);

// ---------- exact responses (the stability and tuning math evaluates the same filters the loop runs) ----------
const cabs = (r) => Math.hypot(r[0], r[1]);
const mul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
function biquadLP(fc, q, sr) {   // RBJ low-pass; Butterworth Qs keep the cascade <= 1 everywhere
  const w = TAU * fc / sr, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: -2 * c / a0, a2: (1 - al) / a0 };
}
function bqResp(f, w) {
  const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
  const nr = f.b0 + f.b1 * c1 + f.b2 * c2, ni = f.b1 * s1 + f.b2 * s2, dr = 1 + f.a1 * c1 + f.a2 * c2, di = f.a1 * s1 + f.a2 * s2, dd = dr * dr + di * di;
  return [(nr * dr + ni * di) / dd, (ni * dr - nr * di) / dd];
}
function opResp(h, w) {   // (1-h) / (1 - h e^-jw)
  const dr = 1 - h * Math.cos(w), di = h * Math.sin(w), dd = dr * dr + di * di;
  return [(1 - h) * dr / dd, -(1 - h) * di / dd];
}
function dcResp(R, w) {   // (1+R)/2 (1 - e^-jw) / (1 - R e^-jw): peak gain exactly 1 at Nyquist
  const nr = 1 - Math.cos(w), ni = Math.sin(w), dr = 1 - R * Math.cos(w), di = R * Math.sin(w), dd = dr * dr + di * di, k = (1 + R) / 2;
  return [k * (nr * dr + ni * di) / dd, k * (ni * dr - nr * di) / dd];
}
// one 2nd-order allpass, poles r e^{+-j th}: unwrapped phase = -2w - 2 arg D(e^jw), D(z) = (1 - p z^-1)(1 - p* z^-1)
function ap2Phase(r, th, w) {
  const f = (phi) => Math.atan2(r * Math.sin(w - phi), 1 - r * Math.cos(w - phi));   // arg(1 - r e^{j phi} e^{-jw})
  return -2 * w - 2 * (f(th) + f(-th));
}
function ap2Group(r, th, w) {
  const g = (phi) => (1 - r * r) / (1 - 2 * r * Math.cos(w - phi) + r * r);
  return g(th) + g(-th);
}

/* THE DISPERSION DESIGN. Wanted group delay (samples) on (0, pi): falling = S at and below flo, falling linearly in
 * log2(f) to 0 at fhi; rising = 0 at and below flo, rising to S at fhi, then easing back to 0 over half an octave (the
 * low-pass is there). Sections at the 2 pi crossings of the running integral; pole radius 1 - r = local spacing. */
export function designDispersion(sr, flo, fhi, S, rising) {
  const wlo = TAU * flo / sr, whi = TAU * fhi / sr, lnR = Math.log(whi / wlo), wtop = Math.min(Math.PI * 0.98, whi * Math.SQRT2);
  const want = (w) => {
    if (!rising) return w <= wlo ? S : w >= whi ? 0 : S * (1 - Math.log(w / wlo) / lnR);
    if (w <= wlo) return 0; if (w <= whi) return S * Math.log(w / wlo) / lnR;
    return w >= wtop ? 0 : S * (1 - Math.log(w / whi) / Math.log(wtop / whi));
  };
  const G = 8192, cum = new Float64Array(G + 1);
  for (let i = 1; i <= G; i++) { const w0 = Math.PI * (i - 1) / G, w1 = Math.PI * i / G; cum[i] = cum[i - 1] + 0.5 * (want(w0) + want(w1)) * (w1 - w0) / TAU; }
  const n = Math.min(MAX_SECTIONS, Math.round(cum[G]));
  const scale = n > 0 ? cum[G] / n : 1, th = [];
  for (let k = 0, i = 1; k < n; k++) {
    const target = (k + 0.5) * scale;
    while (i < G && cum[i] < target) i++;
    const fr = (target - cum[i - 1]) / Math.max(1e-12, cum[i] - cum[i - 1]);
    th.push(Math.PI * (i - 1 + fr) / G);
  }
  const sec = th.map((t, k) => {
    const sp = 0.5 * ((k + 1 < n ? th[k + 1] : t + (t - (th[k - 1] ?? 0))) - (k > 0 ? th[k - 1] : 0));
    const r = Math.max(0.5, Math.min(0.99995, 1 - sp));
    return { r, th: t, c1: -2 * r * Math.cos(t), c2: r * r };   // y = c2 x + c1 x1 + x2 - c1 y1 - c2 y2
  });
  return sec;
}

// ---------- the loop's design (shared by the factory, loopGainMax and the measurement) ----------
export function springDesign(sr, cfg, f0) {
  const type = cfg.type, rising = cfg.disp < 0, amt = Math.abs(cfg.disp);
  const fhi = type === 0 ? Math.min(9000, Math.max(500, 6 * f0)) : Math.min(9000, Math.max(1500, 16 * f0));
  const flo = type === 0 ? Math.max(40, fhi / 32) : f0;
  // the loop's low-pass: at fhi for a coil (a spring is band-limited, and the rising design stops there); 2.5 x fhi for a
  // doorstop, whose loop runs hundreds of passes a second — at fhi it took ~30 dB a second off 0.7 fhi on its own
  const lpHz = Math.min(0.45 * sr, type === 0 ? fhi : 2.5 * fhi);
  const lp = [biquadLP(lpHz, 0.5412, sr), biquadLP(lpHz, 1.3066, sr)];
  const R = 1 - TAU * 20 / sr, Rin = 1 - TAU * 3 / sr;   // the output DC blocker (20 Hz); the in-loop DC leak (3 Hz)
  const t60 = springT60(type, cfg.damp), rho = 0.7 - 0.55 * cfg.damp;   // rho: T60 at the top / T60 at the bottom
  const P = type === 0 ? cfg.lengthS * sr : sr / f0;                     // the round trip, samples
  // the glide per pass (samples); a doorstop's falling glide is capped so the fundamental still fits in one period
  let S = type === 0 ? Math.min(0.9 * P, amt * COIL_GLIDE * sr) : amt * (rising ? 2 : 0.85) * P;
  const fixedResp = (w, h) => mul(mul(mul(bqResp(lp[0], w), bqResp(lp[1], w)), opResp(h, w)), dcResp(Rin, w));
  const fixedPhase = (w, h) => { const r = fixedResp(w, h); return -Math.atan2(r[1], r[0]) / w; };
  const chainPhase = (sec, w) => { let p = 0; for (const s of sec) p += ap2Phase(s.r, s.th, w); return -p / w; };
  const wRef = type === 0 ? TAU * Math.sqrt(flo * fhi) / sr : TAU * f0 / sr;   // the coil's "round trip" is at mid-band
  let sec = [], h = 0, g = 0.99, D0 = 2, passS = P / sr;
  for (let it = 0; it < 6; it++) {   // h needs the pass time, the pass time needs h's phase: converges at once
    sec = S > 0.5 ? designDispersion(sr, flo, fhi, S, rising) : [];
    const used = chainPhase(sec, wRef) + fixedPhase(wRef, h);
    if (type === 1 && used > P - 2 && S > 0) { S *= 0.9 * (P - 2 - fixedPhase(wRef, h)) / Math.max(1e-9, chainPhase(sec, wRef)); continue; }
    D0 = Math.max(4, P - used);
    passS = (D0 + used) / sr;
    // the per-pass loss, net of what the filters already take at the reference frequency (so the T60 is the T60)
    g = Math.min(0.9995, Math.pow(10, -3 * passS / t60) / Math.max(0.5, cabs(fixedResp(wRef, h))));
    const want = Math.pow(10, -3 * passS * (1 / (rho * t60) - 1 / t60)), wh = TAU * 0.7 * fhi / sr;
    // (net of what the low-pass already takes there, relative to the reference: if that is already enough, h = 0)
    const lpRel = cabs(mul(bqResp(lp[0], wh), bqResp(lp[1], wh))) / cabs(mul(bqResp(lp[0], wRef), bqResp(lp[1], wRef)));
    let lo = 0, hi = 0.99;
    for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (cabs(opResp(m, wh)) * lpRel > want) lo = m; else hi = m; }
    h = 0.5 * (lo + hi);
  }
  return { flo, fhi, S, rising, sec, D0, lp, R, Rin, h, g, t60, rho, passS, wRef, P };
}

// max over frequency of |loop gain| (the linear loop; the soft limit only lowers it). Must be < 1. The allpass
// sections are evaluated too (each must read 1: a coefficient bug would show here).
export function loopGainMax(sr, cfg, f0) {
  const d = springDesign(sr, cfg, f0);
  let mx = 0, at = 0, apDev = 0;
  for (let i = 1; i < 2048; i++) {
    const w = Math.PI * i / 2048;
    const r = mul(mul(mul(bqResp(d.lp[0], w), bqResp(d.lp[1], w)), opResp(d.h, w)), dcResp(d.Rin, w));
    for (const s of d.sec) {   // the section's own transfer function, from its coefficients
      const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
      const num = [s.c2 + s.c1 * c1 + c2, s.c1 * s1 + s2], den = [1 + s.c1 * c1 + s.c2 * c2, s.c1 * s1 + s.c2 * s2];
      apDev = Math.max(apDev, Math.abs(cabs(num) / cabs(den) - 1));
    }
    let li = 0;   // the interpolator's largest |H| over the fraction (must be <= 1)
    for (let q = 0; q <= 20; q++) {
      const u = q / 20, c = [-u * (u - 1) * (u - 2) / 6, (u + 1) * (u - 1) * (u - 2) / 2, -(u + 1) * u * (u - 2) / 2, (u + 1) * u * (u - 1) / 6];
      let re = 0, im = 0; for (let k = 0; k < 4; k++) { re += c[k] * Math.cos((k - 1) * w); im += c[k] * Math.sin((k - 1) * w); }
      li = Math.max(li, Math.hypot(re, im));
    }
    const v = d.g * cabs(r) * li;
    if (v > mx) { mx = v; at = w * sr / TAU; }
  }
  return { max: mx, atHz: at, g: d.g, apDev, sections: d.sec.length };
}

// the chain's group delay (samples, per pass) at f Hz: what the measurement compares the audio against
export function chainGroupDelay(sr, cfg, f0, f) {
  const d = springDesign(sr, cfg, f0), w = TAU * f / sr; let g = 0;
  for (const s of d.sec) g += ap2Group(s.r, s.th, w);
  return g;
}

// 4-point (3rd-order) Lagrange interpolation at fraction u in [0,1) between p1 and p2
export function lagrange(p0, p1, p2, p3, u) {
  const um1 = u - 1, um2 = u - 2, up1 = u + 1;
  return -u * um1 * um2 / 6 * p0 + up1 * um1 * um2 / 2 * p1 - up1 * u * um2 / 2 * p2 + up1 * u * um1 / 6 * p3;
}

// ---------- the factory ----------
export function makeSpring(sr, cfg, f0, seedIn) {
  let seed = (seedIn >>> 0) || 0x5eed5;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const out = [0, 0];
  const type = cfg.type, pluck = cfg.pluck;
  let t = 0; const dt = 1 / sr;
  const life = springT60(type, cfg.damp);
  const swayTau = Math.max(0.4, 4 * life / 6.9);    // the swing's DEPTH (relative to the ring) fades at a quarter of the ring's rate
  const swayPh0 = rnd() * TAU;

  // ---- the mouth (two TPT state-variable band-passes, coefficients per sample) ----
  const useMouth = type === 2 || Math.abs(cfg.mouth) > 1e-6;
  const F2base = 500 * Math.pow(5, cfg.vowel);   // 500 .. 2500 Hz
  const glide = Math.min(GLIDE_MAX, 0.4 * life);
  const sv = [{ s1: 0, s2: 0 }, { s1: 0, s2: 0 }, { s1: 0, s2: 0 }, { s1: 0, s2: 0 }];   // F1 L, F2 L, F1 R, F2 R
  function bp(st, x, f, q) {
    const g = Math.tan(Math.PI * Math.min(f, 0.45 * sr) / sr), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - st.s2, v1 = a1 * st.s1 + a2 * v3, v2 = st.s2 + a2 * st.s1 + a3 * v3;
    st.s1 = 2 * v1 - st.s1; st.s2 = 2 * v2 - st.s2;
    return k * v1;   // unity gain at the peak
  }
  function mouthAt(swayV) {   // F2 at time t: the glide, then the wobble
    const u = Math.min(1, t / glide), sm = u * u * (3 - 2 * u);
    return F2base * Math.pow(2, 2 * cfg.mouth * sm) * Math.pow(2, 0.6 * swayV);
  }

  if (type === 2) {
    // ---- TWANG: the reed. Additive, so nothing above 0.45 SR is ever made. ----
    const nH = Math.max(1, Math.min(90, Math.floor(Math.min(0.45 * sr, 10000) / f0)));
    const tilt = 0.9 - 0.5 * pluck;                      // a hard pluck is brighter (a jaw harp's source is very rich)
    const amp = new Float64Array(nH + 1), dec = new Float64Array(nH + 1);
    for (let k = 1; k <= nH; k++) {
      amp[k] = Math.pow(k, -tilt) * (k === 1 ? 1.5 : 1);  // the drone's fundamental is strong in a jaw harp
      const tk = life / 6.9 / (1 + 0.015 * (k - 1) * (0.5 + cfg.damp));   // the upper harmonics fade a little first
      dec[k] = Math.exp(-dt / tk);
    }
    const ting = 6.27 * f0 < 0.45 * sr ? 0.25 * pluck : 0, tingDec = Math.exp(-dt / 0.05), tingPh0 = rnd() * TAU;
    const env = Float64Array.from(amp);
    let tingE = ting, ph = 0;
    const atk = 0.002;   // the reed leaves the finger at full swing; a 2 ms ramp keeps the first sample from stepping
    return {
      out,
      tick() {
        ph += TAU * f0 * dt; if (ph > TAU * 1e4) ph -= TAU * 1e4;
        let s = 0;
        for (let k = 1; k <= nH; k++) { s += env[k] * Math.sin(k * ph); env[k] *= dec[k]; }
        s += tingE * Math.sin(6.27 * ph + tingPh0); tingE *= tingDec;
        s *= Math.min(1, t / atk);
        const sw = cfg.sway * Math.sin(TAU * cfg.swayRate * t + swayPh0);
        const F2 = mouthAt(sw), F1 = Math.min(800, Math.max(220, 0.42 * F2));
        const y = 0.12 * s + 0.6 * bp(sv[0], s, F1, 5) + 3.2 * bp(sv[1], s, F2, 16);
        out[0] = y; out[1] = y;
        t += dt;
        return out;
      },
    };
  }

  // ---- COIL / DOORSTOP: two dispersive loops ----
  const d = springDesign(sr, cfg, f0), sec = d.sec, nS = sec.length;
  const ch = [0, 1].map((c) => {
    // the second spring / polarization: coil +-1.7% long, doorstop +-0.25% (a slow beat between the tip's two directions)
    const sp = type === 0 ? (c ? 1.017 : 0.983) : (c ? 1.0008 : 0.9992);
    const D0 = Math.max(4, d.D0 + (sp - 1) * d.P);
    const maxD = Math.ceil(D0 * (1 + SWAY_PITCH[type] * 1.05)) + 4;
    let size = 1; while (size < maxD + 2) size <<= 1;
    return { D0, buf: new Float64Array(size), mask: size - 1, w: 0, st: new Float64Array(4 * nS), z: [0, 0, 0, 0], dcx: 0, dcy: 0, lx: 0, ly: 0, hp: 0 };
  });
  // the excitation. COIL: a zero-mean doublet (one cycle of a sine), a tap on the end of the coil, width from Pluck.
  // DOORSTOP: the bent tip let go — like a plucked string's initial shape, ONE PERIOD long, its apex moving from 0.45 to
  // 0.20 of the period as Pluck rises (energy where the ring is; a sharper apex is a brighter flick; a narrow pulse
  // mixed in instead cost up to 7 dB of loudness at the same peak). A short pulse alone put its energy into the top partials, which die in 50 ms, and left
  // the first millisecond ~19 dB over the ring: a click with a ring after it.
  let wN, exc;
  if (type === 0) {
    wN = Math.max(3, Math.round(0.002 * Math.pow(0.15, pluck) * sr)); exc = new Float64Array(wN);
    for (let i = 0; i < wN; i++) exc[i] = Math.sin(TAU * i / wN);
  } else {
    wN = Math.max(8, Math.round(sr / f0)); exc = new Float64Array(wN);
    // the tip's displacement over the period is a smooth bump d(u) = sin^2(pi w(u)), w piecewise linear so the apex sits
    // at beta, zero with zero slope at both ends; what reaches the base is its VELOCITY, the per-sample difference —
    // zero-sum exactly (it telescopes to d(1) - d(0) = 0, so no DC to ring at 0 Hz) and starting from silence
    const beta = 0.45 - 0.25 * pluck, wu = (u) => u < beta ? 0.5 * u / beta : 0.5 + 0.5 * (u - beta) / (1 - beta);
    const dsp = (u) => Math.sin(Math.PI * wu(u)) ** 2;
    let pk = 0;
    for (let i = 0; i < wN; i++) { exc[i] = dsp((i + 1) / wN) - dsp(i / wN); pk = Math.max(pk, Math.abs(exc[i])); }
    for (let i = 0; i < wN; i++) exc[i] /= pk;
  }
  // a doorstop flick: the finger scrapes off the tip — 6 ms of seeded noise, louder with Pluck (each channel its own)
  const scrN = type === 1 ? Math.round(0.006 * sr) : 0, scr = [new Float64Array(scrN), new Float64Array(scrN)];
  for (const s of scr) { let lp = 0; for (let i = 0; i < scrN; i++) { lp += 0.5 * ((rnd() * 2 - 1) - lp); s[i] = lp * 0.35 * pluck * Math.sin(Math.PI * i / scrN); } }
  const drv = 0.2 + 2.5 * pluck * pluck;
  const Rk = (1 + d.R) / 2, Rl = (1 + d.Rin) / 2, lp = d.lp, h = d.h, g = d.g, swP = SWAY_PITCH[type];
  let n = 0;
  return {
    out, design: d,
    tick() {
      const decay = cfg.sway * Math.exp(-t / swayTau);
      for (let c = 0; c < 2; c++) {
        const C = ch[c], st = C.st;
        const sw = decay * Math.sin(TAU * cfg.swayRate * t + swayPh0 + c * Math.PI / 2);
        // read the delay line at the swayed length: 4-point Lagrange (|H| <= 1 for a fraction between the middle two
        // taps; linear interpolation would low-pass every pass, ~19 dB at 2 kHz after one second of a 220 Hz loop)
        const rp = C.w - C.D0 * (1 + swP * sw), i0 = Math.floor(rp), u = rp - i0, m = C.mask, B = C.buf;
        const fb = lagrange(B[(i0 - 1) & m], B[i0 & m], B[(i0 + 1) & m], B[(i0 + 2) & m], u);
        let x = fb + (n < wN ? exc[n] : 0) + (n < scrN && !cfg._noScrape ? scr[c][n] : 0);
        if (!cfg._noSat) x = Math.tanh(drv * x) / drv;
        { const y = Rl * (x - C.lx) + d.Rin * C.ly; C.lx = x; C.ly = y; x = y; }   // DC leak (3 Hz, peak gain 1)
        // the dispersion: nS second-order allpasses (state x1 x2 y1 y2 per section)
        for (let m = 0, o = 0; m < nS; m++, o += 4) {
          const s = sec[m], y = s.c2 * x + s.c1 * st[o] + st[o + 1] - s.c1 * st[o + 2] - s.c2 * st[o + 3];
          st[o + 1] = st[o]; st[o] = x; st[o + 3] = st[o + 2]; st[o + 2] = y; x = y;
        }
        // low-pass at fhi (two Butterworth biquads, transposed direct form II)
        for (let b = 0; b < 2; b++) {
          const f = lp[b], z = C.z, y = f.b0 * x + z[2 * b];
          z[2 * b] = f.b1 * x - f.a1 * y + z[2 * b + 1]; z[2 * b + 1] = f.b2 * x - f.a2 * y; x = y;
        }
        // TAP before the loss filter (the first arrival keeps its top), through a DC blocker OUTSIDE the loop: inside,
        // its loss at the fundamental compounds every pass (-15 dB/s at 110 Hz from a 20 Hz corner)
        const yd = Rk * (x - C.dcx) + d.R * C.dcy; C.dcx = x; C.dcy = yd;
        out[c] = yd * (1 + 0.5 * sw);
        C.hp = (1 - h) * x + h * C.hp;
        C.buf[C.w & C.mask] = g * C.hp; C.w++;
      }
      // the mouth on a spring (a "talking" boing), mixed with the dry spring
      if (useMouth) {
        const swv = cfg.sway * Math.sin(TAU * cfg.swayRate * t + swayPh0);
        const F2 = mouthAt(swv), F1 = Math.min(800, Math.max(220, 0.42 * F2));
        for (let c = 0; c < 2; c++) { const x = out[c]; out[c] = 0.3 * x + 0.5 * bp(sv[2 * c], x, F1, 5) + 2.0 * bp(sv[2 * c + 1], x, F2, 12); }
      }
      n++; t += dt;
      return out;
    },
  };
}

// offline: n samples, with a 15 ms raised-cosine fade at the end so the buffer ends at silence
export function renderSpring(sr, n, cfg, f0, seed) {
  const s = makeSpring(sr, cfg, f0, seed), L = new Float32Array(n), R = new Float32Array(n), fade = Math.round(0.015 * sr);
  for (let i = 0; i < n; i++) {
    const o = s.tick(), e = i >= n - fade ? 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / fade) : 1;
    L[i] = o[0] * e; R[i] = o[1] * e;
  }
  return { L, R, design: s.design || null };
}
