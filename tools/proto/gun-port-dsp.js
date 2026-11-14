// ── Gun (wave "gun", #38) ───────────────────────────────────────────────────────────────────────────────────────────
// Gunshots DESIGNED for game sound: hyper-real, not documentary. The blast engine (wave 31) is the physical model and
// gives what a microphone down the street hears ("a dull report and the facades' flutter"); the Guns sat on the impact
// engine, and a burst (Repeat > 1) re-gated ONE shot's envelope on a grid. Prototyped in tools/proto/gun.mjs and picked
// by ear (AJ, 2026-11-13: the model won all eight rounds, soundtests/proto-gun/; no pick was today's preset or a blast
// take); this block is that model, unchanged in its maths, with its knobs mapped from the patch by gunCfg. ONE SHOT is
// built from the layers a game gun is designed from:
//   SNAP       the first millisecond: a box-integrated pressure step 60-150 us wide with a negative lobe, plus a 0.35 ms
//              noise spit, HARD CLIPPED, so the shot lands as a square-edged click.
//   BODY       a sine whose pitch DROPS (a kick's sweep) under a Friedlander muzzle pop (0.25-1.9 ms); Caliber sets the
//              size: 260 -> 75 Hz over 25 ms at the small end, 110 -> 40 Hz over 135 ms at the big end.
//   GAS        the report's roar: noise through a low-pass that FALLS as the gas cools, its length by caliber.
//   CRACK      band-passed noise (1.4 kHz for a short barrel, 5 kHz for a long one) through tanh at drive 4, a supersonic
//              N-wave (120-320 us) on a long barrel, a high sizzle; a SHORT barrel adds the BARK (three damped modes at
//              550-900 Hz, the boxy pop of a pistol or carbine).
//   MECHANISM  per Action, from one metal-clack generator (an inharmonic modal set and a band-passed tick) and a
//              slide-friction noise: a pistol's slide unlocking and slamming home with the shot, a revolver's hammer and
//              frame, a pump racked and a bolt worked AFTER the shot, an assault rifle's carrier cycling per round (and
//              its bolt LOCKING back on the last when Empty click is up), a belt-fed's open bolt slamming forward to fire,
//              driven back, the links ticking, caught on the sear after the last; plus the CASINGS thrown out, landing
//              ~0.4 s later and bouncing (a pump's plastic hull dull). Casings default to 0: AJ's rule is that no
//              after-sound is layered on a shot (a mechanism sounding WITH the shot is fine).
//   SUPPRESSOR the crack and snap go (subsonic), the gas is low-passed and shortened, the body softened, a "pfft" of
//              band-passed gas (~750 Hz) and a baffle ring (~1.1 kHz) take their place.
//   PLACE      an impulse response built from geometry (as blast's): dry, outdoors (ground reflection, a slap-back at
//              110-160 ms, a second at ~370 ms, a dark rolling tail), street (facade flutter every ~47 ms), room, warehouse
//              (a 2 s metallic tail), canyon (smeared echoes at 0.45 / 0.8 / 1.15 s). All the shots are convolved as ONE
//              stream, so in a burst the tails overlap and build.
// THE BALANCE: each layer renders to its own bus, set to a target ENERGY over the first shot's 250 ms (the gains then
// hold for every round, so the shot-to-shot variation survives): Snap / Punch / Crack are ratios, caliber moves the
// weights. The mechanism is levelled against the shot's ENERGY over its first 150 ms, never its peak (the snap owns it).
// THE CRUNCH STAGE, after the layers: SATURATION of the high layers (asymmetric tanh, drive 1-21) and of the body on its
// own (gentler, drive 1-6), both 4x oversampled like driveOS and each brought back to its own energy (Crunch changes the
// texture, not the balance); a COMPRESSOR on the shot bus alone (threshold 6-30 dB under its peak, ratio 1.5-8, a 2.5 ms
// attack that lets the snap through and pulls the body up behind it, release 60-120 ms; the mechanism joins after it);
// the place; a final SOFT CLIP whose hardness follows Crunch; optional BITS (16 -> 4) and a sample-and-hold RATE cut
// (1x -> 8x), without anti-aliasing on purpose (the retro end); a 22 Hz DC block; the stereo width; a 60 ms end fade.
// AUTOMATIC FIRE: a rate (RPM) and a round count; each round is re-fired WHOLE: its own noise, pitch (+-4 % sd at
// Variation 1), level (+-1.2 dB sd), crack band (+-6 %), gas and body lengths (+-10 %), its cycle time (+-3.5 % sd,
// cumulative, so the rhythm breathes), the mechanism cycling, the gas thickening as the barrel heats (+15 % by round 20).
// Built up front into a stereo buffer like the blast's; the AMP ENVELOPE STAYS THE GAIN. Seeded by the patch's own
// `gunSeed` ("which take"), never Math.random; not salted per layer, like glSeed. gunLevel optionally tames the peaks
// first (Peak control, as blastLevel) and brings the buffer to a fixed loudness so Normalize off still sits it with the
// rest. Anti-aliasing: the snap, the pop and the N-wave are box-integrated at 16 sub-samples, every mode at or past
// 0.45 SR is dropped, the saturation is 4x oversampled.
const GUN_DEFAULTS = { "gunCaliber": 0.32, "gunBarrel": 0.3, "gunAction": 1, "gunSnap": 0.6, "gunPunch": 0.7, "gunCrack": 0.5,
  "gunMech": 0.4, "gunCasing": 0, "gunPlace": 1, "gunTail": 0.5, "gunSuppress": 0, "gunCrunch": 0.3, "gunComp": 0.5,
  "gunBits": 0, "gunRateCut": 0, "gunRPM": 700, "gunRounds": 1, "gunJitter": 0.4, "gunBoltLock": 0 };   // the PARAMS rows' defaults (index.html)
const GUN_ACTION_MAX = 6;           // none, slide, revolver, pump, bolt, rifle auto, belt-fed
const GUN_PLACE_MAX = 5;            // dry, outdoors, street, room, warehouse, canyon
const GUN_MECH_LEVEL = 0.9;         // the mechanism bus against a shot bus of energy GUN_E_REF over its first 150 ms
const GUN_E_REF = 0.008;            // amplitude^2 s: a typical peak-normalized, compressed shot
const GUN_PRE = 0.012;              // s before the first shot (the revolver's hammer and the open bolt's slam land in it)
const GUN_RMS = 0.12;               // gunLevel: RMS over the loudest 300 ms ...
const GUN_PEAK = 0.9;               // ... its peak capped here
const GUN_CLACK_R = [1, 1.62, 2.31, 2.93, 3.87];   // the clack's modal ratios ...
const GUN_CLACK_A = [1, 0.7, 0.55, 0.4, 0.3];      // ... their levels ...
const GUN_CLACK_T = [1, 0.8, 0.6, 0.5, 0.4];       // ... and their decays against the clack's own

const gunClamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function gunRng(seed) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const gunGauss = (rnd) => (rnd() + rnd() + rnd() + rnd() - 2) * 1.732;   // ~N(0, 1)
const gunPan = (p) => { const a = (gunClamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a) * 1.4142135623730951, Math.sin(a) * 1.4142135623730951]; };
// a stream's seed from (seed, shot, component): mixed so neighbouring shots are unrelated
const gunSeedMix = (seed, k, salt) => (Math.imul((seed + 1) >>> 0, 2654435761) ^ Math.imul(k + 7, 40503) ^ Math.imul(salt + 13, 9973)) >>> 0;

// knob values -> the model's configuration (keys quoted: the exporter's app-global scan reads a bare key as a name)
function gunCfg(st) {
  const g = (k) => (st[k] == null ? GUN_DEFAULTS[k] : st[k]);
  const c = gunClamp(g("gunCaliber"), 0, 1), b = gunClamp(g("gunBarrel"), 0, 1), s = gunClamp(g("gunSuppress"), 0, 1);
  return {
    "dur": st.duration || 0, "width": st.width == null ? 0.6 : st.width,
    "cal": c, "barrel": b, "action": gunClamp(Math.round(g("gunAction")), 0, GUN_ACTION_MAX),
    "snap": g("gunSnap"), "punch": g("gunPunch"), "crack": g("gunCrack"), "mech": g("gunMech"), "casing": g("gunCasing"),
    "place": gunClamp(Math.round(g("gunPlace")), 0, GUN_PLACE_MAX), "tail": g("gunTail"), "sup": s,
    "crunch": g("gunCrunch"), "comp": g("gunComp"), "bits": g("gunBits"), "rateCut": g("gunRateCut"),
    "interval": 60 / gunClamp(g("gunRPM"), 30, 3000), "rounds": Math.max(1, Math.round(g("gunRounds"))),
    "jitter": g("gunJitter"), "boltLock": g("gunBoltLock"),
    // the body (kick) and the pop
    "fStart": 260 - 150 * c, "fEnd": 75 - 35 * c, "tp": 0.006 + 0.014 * c, "tauBody": 0.025 + 0.11 * c,
    "popT": 0.00025 + 0.00165 * c,
    // the gas
    "tauGas": 0.015 + 0.06 * c, "gasHi": 6000 + 1500 * b, "gasLo": 500 + 500 * (1 - c),
    // the crack
    "crackHz": 1400 + 3600 * b, "tauCrack": 0.004 + 0.012 * b, "nwave": b > 0.45 ? (b - 0.45) / 0.55 : 0, "nT": 0.00012 + 0.0002 * c,
    "bark": Math.pow(1 - b, 1.5), "barkHz": 900 - 350 * c,
  };
}

// add a continuous waveform f(t) (t from its onset at t0 s, nonzero on [0, len)), box-integrated per sample (16 sub-samples)
function gunAddCont(buf, sr, t0, len, f, gain) {
  const OS = 16, i0 = Math.max(0, Math.floor(t0 * sr)), i1 = Math.min(buf.length, Math.ceil((t0 + len) * sr) + 1);
  for (let i = i0; i < i1; i++) {
    let s = 0;
    for (let k = 0; k < OS; k++) { const t = (i + (k + 0.5) / OS) / sr - t0; if (t >= 0 && t < len) s += f(t); }
    buf[i] += gain * s / OS;
  }
}
// TPT state-variable filter: out = [lp, bp (unity peak), hp]
function gunSvf() { return { "a": 0, "b": 0 }; }
function gunSvfTick(f, x, g, k, out) {
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, v3 = x - f.b, v1 = a1 * f.a + a2 * v3, v2 = f.b + a2 * f.a + a3 * v3;
  f.a = 2 * v1 - f.a; f.b = 2 * v2 - f.b; out[0] = v2; out[1] = k * v1; out[2] = x - k * v1 - v2;
}
const gunG = (fc, sr) => Math.tan(Math.PI * gunClamp(fc, 5, sr * 0.45) / sr);
// damped modes into a mono buffer (or a stereo pair through pan gains): sum a_m e^{-t/tau_m} sin(2 pi f_m t)
function gunModes(L, R, pg, sr, t0, fs, amps, taus, gain, attack) {
  const i0 = Math.max(0, Math.round(t0 * sr)), n = L.length;
  for (let m = 0; m < fs.length; m++) {
    const f = fs[m]; if (!(f > 0) || f >= 0.45 * sr) continue;
    const tau = taus[m], a = amps[m] * gain, len = Math.min(n - i0, Math.ceil(7 * tau * sr)), w = 2 * Math.PI * f / sr, dk = Math.exp(-1 / (tau * sr));
    const at = Math.max(1, Math.round((attack || 0.0001) * sr));
    let e = a;
    for (let j = 0; j < len; j++) {
      const v = e * Math.sin(w * j) * (j < at ? j / at : 1); e *= dk;
      if (R) { L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1]; } else L[i0 + j] += v;
    }
  }
}
// a metal CLACK (bolt, slide, hammer): an inharmonic modal set + a contact tick (noise band-passed around 3 f0)
function gunClack(L, R, sr, t0, f0, tau, gain, pan, rnd) {
  if (gain <= 0 || t0 < 0) return;
  const pg = gunPan(pan);
  const fs = GUN_CLACK_R.map((r) => f0 * r * (1 + 0.04 * gunGauss(rnd))), taus = GUN_CLACK_T.map((x) => x * tau);
  gunModes(L, R, pg, sr, t0, fs, GUN_CLACK_A, taus, gain * 0.5, 0.00008);
  const i0 = Math.round(t0 * sr), len = Math.min(L.length - i0, Math.round(0.004 * sr)), dk = Math.exp(-1 / (0.0004 * sr));
  const f = gunSvf(), o = [0, 0, 0], g = gunG(Math.min(8000, 3 * f0), sr);
  let e = gain * 0.9;
  for (let j = 0; j < len; j++) { gunSvfTick(f, rnd() * 2 - 1, g, 1.2, o); const v = o[1] * e; e *= dk; L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1]; }
}
// friction of a slide / bolt travelling: band-passed noise, a raised-cosine swell over len s
function gunSlide(L, R, sr, t0, len, fc, gain, pan, rnd) {
  if (gain <= 0) return;
  const pg = gunPan(pan), i0 = Math.round(t0 * sr), N = Math.min(L.length - i0, Math.round(len * sr)), f = gunSvf(), o = [0, 0, 0], g = gunG(fc, sr);
  for (let j = 0; j < N; j++) {
    gunSvfTick(f, rnd() * 2 - 1, g, 0.9, o);
    const e = Math.sin(Math.PI * j / N), v = o[1] * e * e * gain * (0.6 + 0.4 * rnd());
    L[i0 + j] += v * pg[0]; R[i0 + j] += v * pg[1];
  }
}
// a CASING thrown out and bouncing: a free tube's modes, restitution-timed bounces. hull = a shotgun's plastic hull.
function gunCasingDrop(L, R, sr, tLand, f0, gain, pan, rnd, hull) {
  const pg = gunPan(pan);
  let v = 4.2 + 1.2 * rnd(), t = tLand, lv = gain;
  const e = 0.35 + 0.15 * rnd();
  for (let b = 0; b < 5 && t < L.length / sr - 0.01 && lv > gain * 0.03; b++) {
    if (hull) {
      gunModes(L, R, pg, sr, t, [f0, f0 * 2.3], [1, 0.4], [0.012, 0.006], lv * 0.6, 0.0002);
    } else {
      const fs = [1, 2.756, 5.404, 8.933].map((r) => f0 * r * (1 + 0.01 * gunGauss(rnd)));
      const which = rnd();   // a tumbling casing lands on its end or its side: which modes it reaches moves
      gunModes(L, R, pg, sr, t, fs, [0.6 + 0.4 * which, 1 - 0.5 * which, 0.5, 0.25], [0.06, 0.04, 0.025, 0.015], lv * 0.5, 0.00005);
    }
    gunClack(L, R, sr, t, hull ? 900 : 2600, 0.002, lv * 0.25, pan, rnd);   // the contact tick
    v *= e * (0.85 + 0.3 * rnd()); t += 2 * v / 9.81; lv *= 0.45 + 0.2 * rnd();
  }
}

// the place: an impulse response from geometry (stereo), built like blastPlaceIR
function gunPlaceIR(sr, place, tailMul, rnd) {
  if (place === 0) return null;
  const lenS = [0, 2.2, 1.6, 0.9, 2.8, 2.8][place] * tailMul, n = Math.round(lenS * sr);
  const L = new Float64Array(n), R = new Float64Array(n);
  // a darkened tap: a one-pole kernel at fc, unit DC, gain g
  const tap = (t, g, fc, ch) => {
    const i0 = Math.round(t * sr); if (i0 >= n) return;
    const a = Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * sr) / sr);
    let v = (1 - a) * g;
    for (let j = i0; j < n && Math.abs(v) > 1e-7 * Math.abs(g); j++) { if (ch !== 1) L[j] += v; if (ch !== 0) R[j] += v; v *= a; }
  };
  // a smeared echo: a cluster of taps around t
  const cluster = (t, g, fc, spread, k) => { for (let q = 0; q < k; q++) { const ch = q & 1; tap(t + (rnd() - 0.5) * spread, g * (0.5 + rnd()) / Math.sqrt(k) * 1.4, fc, ch); } };
  // a diffuse tail: noise, rising over `rise`, decaying at rt60, low-passed from fcA to fcB, scaled to ENERGY e (wet/dry)
  const tail = (t0, rise, rt60, fcA, fcB, e) => {
    const i0 = Math.round(t0 * sr), dk = Math.exp(-6.9078 / (rt60 * sr)), ri = Math.max(1, Math.round(rise * sr));
    const bl = new Float64Array(n), br = new Float64Array(n);
    let env = 1, yl = 0, yr = 0, ss = 0;
    for (let j = i0; j < n; j++) {
      const u = (j - i0) / (rt60 * sr), fc = fcB + (fcA - fcB) * Math.exp(-3 * u), a = Math.exp(-2 * Math.PI * fc / sr);
      const r = j - i0 < ri ? 0.5 - 0.5 * Math.cos(Math.PI * (j - i0) / ri) : 1;
      yl = (rnd() * 2 - 1) * (1 - a) + yl * a; yr = (rnd() * 2 - 1) * (1 - a) + yr * a;
      bl[j] = yl * env * r; br[j] = yr * env * r; ss += (bl[j] * bl[j] + br[j] * br[j]) / 2; env *= dk;
    }
    const g = Math.sqrt(e / (ss || 1));
    for (let j = i0; j < n; j++) { L[j] += bl[j] * g; R[j] += br[j] * g; }
  };
  if (place === 1) {                 // OUTDOORS: ground, a slap-back off a building / treeline, a second, a rolling tail
    tap(0.0035, 0.42, 7000, 2);
    const s1 = 0.11 + 0.05 * rnd();
    cluster(s1, 0.22, 2600, 0.012, 6); cluster(s1 + 0.004 + 0.02 * rnd(), 0.12, 2200, 0.012, 4);
    cluster(0.33 + 0.08 * rnd(), 0.10, 1400, 0.03, 8);
    tail(0.03, 0.15, 1.6 * tailMul, 2500, 450, 0.35);
  } else if (place === 2) {          // STREET: facades ~16 m apart, a flutter every ~47 ms, darker per bounce
    tap(0.0035, 0.4, 7000, 2);
    const P = 0.047 + 0.006 * rnd();
    for (let m = 1; m <= 12; m++) tap(m * P + 0.002 * (rnd() - 0.5), 0.5 * Math.pow(0.72, m), 6000 * Math.pow(0.8, m), m & 1);
    tail(0.02, 0.06, 1.2 * tailMul, 3200, 700, 0.45);
  } else if (place === 3) {          // ROOM: a dozen image sources in 2-30 ms, then a 0.55 s tail
    for (let q = 0; q < 16; q++) tap(0.002 + 0.028 * rnd(), (0.07 + 0.1 * rnd()), 4000 + 6000 * rnd(), q & 1);
    tail(0.005, 0.02, 0.55 * tailMul, 6000, 2000, 0.8);
  } else if (place === 4) {          // WAREHOUSE: early hits 10-70 ms off walls and racks, a 2 s metallic tail
    for (let q = 0; q < 12; q++) tap(0.01 + 0.06 * rnd(), 0.08 + 0.12 * rnd(), 3000 + 4000 * rnd(), q & 1);
    tail(0.02, 0.08, 2.0 * tailMul, 4000, 900, 1.2);
    const pg = [1, 1];   // sheet metal ringing under it
    gunModes(L, R, pg, sr, 0.02, [182, 263, 411, 587], [1, 0.8, 0.6, 0.4], [0.5, 0.42, 0.35, 0.25], 0.0035, 0.03);
  } else {                           // CANYON: rock walls, smeared echoes, darker per bounce, a long low tail
    tap(0.0035, 0.42, 7000, 2);
    cluster(0.45 + 0.05 * rnd(), 0.25, 2000, 0.03, 10);
    cluster(0.80 + 0.06 * rnd(), 0.15, 1300, 0.045, 10);
    cluster(1.15 + 0.08 * rnd(), 0.09, 900, 0.06, 10);
    tail(0.06, 0.4, 2.5 * tailMul, 1000, 300, 0.25);
  }
  return { "L": L, "R": R };
}
// mono x convolved with a stereo IR, first n samples (blastConvolve's one-FFT trick, dsp.js's fftInPlace)
function gunConvolve(x, irL, irR, n) {
  let N = 1; while (N < n + irL.length) N <<= 1;
  const xr = new Float64Array(N), xi = new Float64Array(N), hr = new Float64Array(N), hi = new Float64Array(N);
  xr.set(x.subarray(0, n)); hr.set(irL); hi.set(irR);
  fftInPlace(xr, xi, -1); fftInPlace(hr, hi, -1);
  for (let k = 0; k < N; k++) { const a = xr[k], b = xi[k], c = hr[k], e = hi[k]; hr[k] = a * c - b * e; hi[k] = a * e + b * c; }
  fftInPlace(hr, hi, 1);
  const L = new Float64Array(n), R = new Float64Array(n), inv = 1 / N;
  for (let i = 0; i < n; i++) { L[i] = hr[i] * inv; R[i] = hi[i] * inv; }
  return { "L": L, "R": R };
}

// ONE SHOT into the layer buses B (mono) and the mechanism bus (stereo ML/MR). k = the round's index.
function gunShot(B, ML, MR, sr, c, t0, k, last, seed) {
  const J = c.jitter, rs = gunRng(gunSeedMix(seed, k, 1)), sup = c.sup;
  const lvl = Math.pow(10, (J * 1.2 * gunGauss(rs) + (k === 0 ? 0.6 : 0)) / 20);
  const pm = 1 + 0.04 * J * gunGauss(rs), cm = 1 + 0.06 * J * gunGauss(rs), tm = 1 + 0.10 * J * gunGauss(rs), heat = 1 + 0.15 * Math.min(1, k / 20);
  const i0 = Math.round(t0 * sr), n = ML.length, SN = B.sn, BO = B.bo, GA = B.ga, CR = B.cr, SU = B.su;
  // SNAP: a square-edged pressure step and a noise spit, hard clipped
  const snapG = c.snap * (1 - 0.85 * sup) * lvl;
  if (snapG > 0) {
    const w = (0.00006 + 0.00009 * c.cal) * (1 + 0.1 * J * gunGauss(rs)), tmp = new Float64Array(Math.round(0.004 * sr));
    gunAddCont(tmp, sr, 0, w + 0.00025, (t) => (t < w ? 1 : -0.3), 1);
    const rn = gunRng(gunSeedMix(seed, k, 2)), dk = Math.exp(-1 / (0.00035 * sr));
    let e = 0.9;
    for (let j = 0; j < tmp.length; j++) { tmp[j] += (rn() * 2 - 1) * e; e *= dk; }
    for (let j = 0; j < tmp.length && i0 + j < n; j++) SN[i0 + j] += gunClamp(tmp[j] * 1.6, -0.75, 0.75) * snapG;
  }
  // BODY: a pitch-dropping sine and the muzzle pop
  const bodyG = c.punch * (1 - 0.55 * sup) * lvl * 1.1;
  if (bodyG > 0) {
    const fS = c.fStart * pm * (1 - 0.15 * sup), fE = c.fEnd * pm, tau = c.tauBody * tm * (1 - 0.4 * sup), at = Math.round(0.0004 * sr);
    const len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr));
    let ph = 0, e = bodyG;
    for (let j = 0; j < len; j++) {
      const t = j / sr, f = fE + (fS - fE) * Math.exp(-t / c.tp);
      ph += 2 * Math.PI * f / sr;
      BO[i0 + j] += Math.sin(ph) * e * (j < at ? 0.5 - 0.5 * Math.cos(Math.PI * j / at) : 1); e *= dk;
    }
    const T = c.popT * tm, bF = 1.3;
    gunAddCont(BO, sr, t0, T * 8, (t) => { const u = t / T; return (1 - u) * Math.exp(-bF * u); }, bodyG * 0.9 * (1 - 0.5 * sup));
  }
  // GAS: noise, its low-pass falling as it cools
  const gasG = (0.35 + 0.5 * c.crack) * (0.4 + 0.6 * c.cal) * (1 - 0.5 * sup) * lvl * heat;
  {
    const tau = c.tauGas * tm * (1 - 0.5 * sup), hi = c.gasHi * (1 - 0.82 * sup), lo = c.gasLo * (1 - 0.3 * sup);
    const len = Math.min(n - i0, Math.ceil(6 * tau * sr)), dk = Math.exp(-1 / (tau * sr)), f = gunSvf(), o = [0, 0, 0], rn = gunRng(gunSeedMix(seed, k, 3));
    let e = gasG;
    for (let j = 0; j < len; j++) {
      const fc = lo + (hi - lo) * Math.exp(-j / (0.8 * tau * sr));
      gunSvfTick(f, rn() * 2 - 1, gunG(fc, sr), 1.2, o);
      GA[i0 + j] += o[0] * e * (j < 20 ? j / 20 : 1); e *= dk;
    }
  }
  // CRACK: band-passed noise through tanh, the supersonic N-wave, the sizzle; the BARK of a short barrel
  const crackG = c.crack * Math.pow(1 - sup, 3) * lvl;
  if (crackG > 0.001) {
    const fc = c.crackHz * cm, tau = c.tauCrack * tm, len = Math.min(n - i0, Math.ceil(7 * Math.max(tau, 0.04) * sr));
    const f = gunSvf(), f2 = gunSvf(), o = [0, 0, 0], o2 = [0, 0, 0], rn = gunRng(gunSeedMix(seed, k, 4)), g1 = gunG(fc, sr), g2 = gunG(5200, sr);
    const dk = Math.exp(-1 / (tau * sr)), tauS = 0.02 + 0.03 * c.barrel, dkS = Math.exp(-1 / (tauS * sr)), th = Math.tanh(4);
    let e = 1, eS = 0.22;
    for (let j = 0; j < len; j++) {
      const x = rn() * 2 - 1;
      gunSvfTick(f, x, g1, 0.85, o); gunSvfTick(f2, x, g2, 1.0, o2);
      CR[i0 + j] += (Math.tanh(4 * o[1] * e * 1.4) / th) * crackG * 0.9 + o2[2] * eS * crackG;
      e *= dk; eS *= dkS;
    }
    if (c.nwave > 0) { const T = c.nT; gunAddCont(CR, sr, t0, T, (t) => 1 - 2 * t / T, crackG * c.nwave * 0.9); }
  }
  const barkG = c.bark * (0.3 + 0.7 * c.crack) * (1 - 0.7 * sup) * lvl * 0.55;
  if (barkG > 0.001) { const f0 = c.barkHz * cm; gunModes(CR, null, null, sr, t0, [f0, f0 * 1.47, f0 * 2.09], [1, 0.7, 0.45], [0.011 * tm, 0.008, 0.006], barkG, 0.0002); }
  // SUPPRESSOR: the "pfft" and the baffle ring
  if (sup > 0) {
    const tau = 0.012 + 0.01 * c.cal, len = Math.min(n - i0, Math.ceil(6 * tau * sr)), f = gunSvf(), o = [0, 0, 0], rn = gunRng(gunSeedMix(seed, k, 5)), gg = gunG(750 * cm, sr), dk = Math.exp(-1 / (tau * sr));
    let e = sup * 0.9 * lvl;
    for (let j = 0; j < len; j++) { gunSvfTick(f, rn() * 2 - 1, gg, 1.1, o); SU[i0 + j] += o[1] * e * (j < 30 ? j / 30 : 1); e *= dk; }
    gunModes(SU, null, null, sr, t0 + 0.0005, [1100 * cm, 2650 * cm], [1, 0.35], [0.006, 0.004], sup * 0.3 * lvl, 0.0003);
  }
  // MECHANISM, per action (into the stereo mechanism bus, placed a little right of the shot)
  const rm = gunRng(gunSeedMix(seed, k, 6)), M = c.mech, cl = c.cal, I = c.interval, act = c.action;
  const jt = () => 1 + 0.03 * J * gunGauss(rm);
  if (M > 0) {
    if (act === 1) {                  // SLIDE: unlocking under the shot, slamming home ~22 ms later
      gunClack(ML, MR, sr, t0 + 0.0012, 1900 * (1 - 0.25 * cl), 0.008, M * 0.25, 0.2, rm);
      gunSlide(ML, MR, sr, t0 + 0.003, 0.018 * jt(), 3200, M * 0.08, 0.2, rm);
      gunClack(ML, MR, sr, t0 + 0.022 * jt(), 1650 * (1 - 0.25 * cl), 0.022, M * 0.7, 0.25, rm);
    } else if (act === 2) {           // REVOLVER: the hammer falling 4 ms before, the frame ringing
      gunClack(ML, MR, sr, t0 - 0.004, 2800, 0.006, M * 0.45, 0.15, rm);
      gunModes(ML, MR, gunPan(0.1), sr, t0 + 0.001, [2350, 3720, 5100], [1, 0.6, 0.3], [0.09, 0.06, 0.04], M * 0.06, 0.0005);
    } else if (act === 3) {           // PUMP: racked AFTER the shot (if the next round leaves time)
      const tb = t0 + 0.40 * jt();
      if (last || I > 0.8) {
        gunSlide(ML, MR, sr, tb, 0.08, 1800, M * 0.22, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.08, 640, 0.03, M * 0.65, 0.3, rm);
        gunSlide(ML, MR, sr, tb + 0.16, 0.06, 2200, M * 0.18, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.22, 820, 0.026, M * 0.7, 0.3, rm);
      }
    } else if (act === 4) {           // BOLT, worked by hand AFTER the shot
      if (last || I > 0.9) {
        const tb = t0 + 0.42 * jt();
        gunClack(ML, MR, sr, tb, 2200, 0.01, M * 0.45, 0.3, rm);
        gunSlide(ML, MR, sr, tb + 0.03, 0.08, 2600, M * 0.2, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.11, 1100, 0.025, M * 0.75, 0.3, rm);
        gunSlide(ML, MR, sr, tb + 0.2, 0.06, 2800, M * 0.16, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.26, 1300, 0.02, M * 0.7, 0.3, rm);
        gunClack(ML, MR, sr, tb + 0.33, 1900, 0.012, M * 0.6, 0.3, rm);
      }
    } else if (act === 5) {           // RIFLE AUTO (closed bolt): the carrier to its stop and back into battery
      const cyc = Math.min(I, 0.09);
      gunClack(ML, MR, sr, t0 + 0.35 * cyc * jt(), 950 * (1 - 0.25 * cl), 0.012, M * 0.4, 0.25, rm);
      gunModes(ML, MR, gunPan(0.25), sr, t0 + 0.3 * cyc, [470 * jt(), 940], [1, 0.3], [0.04, 0.02], M * 0.035, 0.004);   // buffer spring
      if (last && c.boltLock > 0) {
        gunClack(ML, MR, sr, t0 + 0.45 * cyc * jt(), 1500, 0.014, c.boltLock * M * 1.1, 0.25, rm);
        gunClack(ML, MR, sr, t0 + 0.45 * cyc + 0.012, 2600, 0.006, c.boltLock * M * 0.5, 0.25, rm);
      } else gunClack(ML, MR, sr, t0 + 0.75 * cyc * jt(), 1300 * (1 - 0.25 * cl), 0.02, M * 0.7, 0.25, rm);
    } else if (act === 6) {           // BELT-FED (open bolt)
      const cyc = Math.min(I, 0.12);
      gunClack(ML, MR, sr, t0 - 0.003, 700 * (1 - 0.25 * cl), 0.03, M * 0.6, 0.2, rm);       // slam forward (fires it)
      gunClack(ML, MR, sr, t0 + 0.4 * cyc * jt(), 620 * (1 - 0.2 * cl), 0.025, M * 0.45, 0.2, rm);   // driven back
      for (let q = 0; q < 3; q++) gunClack(ML, MR, sr, t0 + (0.5 + 0.08 * q + 0.03 * rm()) * cyc, 3400 * jt(), 0.004, M * 0.14, 0.45 + 0.1 * q, rm);   // links
      if (last) gunClack(ML, MR, sr, t0 + 0.45 * cyc + 0.01, 650 * (1 - 0.2 * cl), 0.04, M * (0.8 + 0.4 * c.boltLock), 0.2, rm);   // caught on the sear
    }
  }
  // CASING (not for a revolver, which keeps its brass)
  if (c.casing > 0 && act !== 2 && act !== 0) {
    const hull = act === 3, rc = gunRng(gunSeedMix(seed, k, 7));
    const tl = (hull ? t0 + 0.62 + 0.15 * rc() : t0 + 0.36 + 0.14 * rc());
    const f0 = hull ? 650 : (6800 - 3800 * cl) * (1 + 0.04 * gunGauss(rc));
    gunCasingDrop(ML, MR, sr, tl, f0, c.casing * (hull ? 0.3 : 0.12) * (0.7 + 0.6 * rc()), 0.3 + 0.6 * (rc() - 0.3), rc, hull);
  }
}

// asymmetric tanh, 4x oversampled (driveOS's method), on a peak-normalized copy, then back to the energy the buffer had
// over [w0, w1)
function gunSaturate(x, d, bias, w0, w1) {
  const n = x.length; let pk = 0, e0 = 0, e1 = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(x[i]));
  if (!(pk > 0)) return;
  for (let i = w0; i < w1; i++) e0 += x[i] * x[i];
  const tb = Math.tanh(d * bias), tn = Math.tanh(d * (1 + bias)) - tb, OS = 4;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const v0 = x[i] / pk; let acc = 0;
    for (let s = 1; s <= OS; s++) { const v = prev + (v0 - prev) * s / OS; acc += Math.tanh(d * (v + bias)) - tb; }
    prev = v0; x[i] = acc / OS / tn;
  }
  for (let i = w0; i < w1; i++) e1 += x[i] * x[i];
  const g = e1 > 0 ? Math.sqrt(e0 / e1) : 0;
  for (let i = 0; i < n; i++) x[i] *= g;
}

// The whole gun: n samples of stereo (Float32), seeded, NOT yet levelled (gunLevel does that). Returns { L, R, info }.
function makeGun(sr, n, cfg, seed) {
  const c = cfg, J = c.jitter, rt = gunRng(gunSeedMix(seed, 9999, 0));
  n = Math.max(64, n);
  // the shots' times: a cyclic rate that breathes (cumulative jitter)
  const times = [];
  let t = GUN_PRE + (c.action === 6 ? 0.008 : 0);
  for (let k = 0; k < c.rounds; k++) { times.push(t); t += c.interval * (1 + 0.035 * J * gunGauss(rt)); }
  const ML = new Float64Array(n), MR = new Float64Array(n);
  const B = { "sn": new Float64Array(n), "bo": new Float64Array(n), "ga": new Float64Array(n), "cr": new Float64Array(n), "su": new Float64Array(n) };
  times.forEach((tk, k) => gunShot(B, ML, MR, sr, c, tk, k, k === times.length - 1, seed));
  // THE BALANCE: each layer's bus set to a target ENERGY over the first shot's 250 ms
  const sup = c.sup, cal = c.cal;
  const want = { "sn": 0.10 * c.snap * c.snap * (1 - 0.85 * sup),
    "bo": 1.1 * c.punch * c.punch * (0.6 + 0.8 * cal) * (1 - 0.5 * sup),
    "ga": (0.5 + 0.7 * cal) * Math.pow(1 - 0.6 * sup, 2),
    "cr": 1.0 * c.crack * c.crack * (1 - 0.1 * cal) * Math.pow(1 - sup, 4),
    "su": 0.6 * sup * sup };
  const w0 = Math.round(times[0] * sr), w1 = Math.min(n, w0 + Math.round(0.25 * sr));
  const SLo = new Float64Array(n), SHi = new Float64Array(n);
  for (const k in B) {
    let e = 0; const x = B[k], dst = k === "bo" ? SLo : SHi; for (let i = w0; i < w1; i++) e += x[i] * x[i];
    const gk = e > 1e-20 && want[k] > 0 ? Math.sqrt(want[k] / (e / sr)) : 0;
    if (gk) for (let i = 0; i < n; i++) dst[i] += x[i] * gk;
  }
  // SATURATION: the high layers at the full drive, the body gentler, each back to its own energy
  const d = 1 + 20 * Math.pow(c.crunch, 1.5), bias = 0.15 * c.crunch;
  gunSaturate(SHi, d, bias, w0, w1);
  gunSaturate(SLo, 1 + 5 * Math.pow(c.crunch, 1.5), 0.5 * bias, w0, w1);
  const S = new Float64Array(n); for (let i = 0; i < n; i++) S[i] = SLo[i] + SHi[i];
  // COMPRESSOR on the shot bus alone (log domain); the mechanism joins after it, so it never lifts it
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(S[i]));
    for (let i = 0; i < n; i++) S[i] /= p || 1;
    if (c.comp > 0) {
      const thrDb = -(6 + 24 * c.comp), ratio = 1.5 + 6.5 * c.comp;
      const aA = Math.exp(-1 / (0.0025 * sr)), aR = Math.exp(-1 / ((0.06 + 0.06 * c.comp) * sr));
      let env = -120;
      for (let i = 0; i < n; i++) {
        const m = Math.abs(S[i]), lv = m > 1e-9 ? 20 * Math.log10(m) : -180;
        env = lv > env ? lv + (env - lv) * aA : lv + (env - lv) * aR;
        const over = env - thrDb, gr = over > 0 ? over * (1 - 1 / ratio) : 0;
        S[i] *= Math.pow(10, -gr / 20);
      }
      p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(S[i]));
      for (let i = 0; i < n; i++) S[i] /= p || 1;
    } }
  // the DRY gun: the shot bus + the mechanism, levelled against the shot's ENERGY over its first 150 ms
  let Es = 0; for (let i = w0; i < Math.min(n, w0 + Math.round(0.15 * sr)); i++) Es += S[i] * S[i];
  Es /= sr;
  const mg = GUN_MECH_LEVEL * Math.sqrt(Es / GUN_E_REF);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) { L[i] = S[i] + ML[i] * mg; R[i] = S[i] + MR[i] * mg; }
  // PLACE: the compressed dry gun through it; in a burst the tails overlap and build
  const tailMul = 0.5 + c.tail, wetG = 1.2 * c.tail * (1 - 0.6 * sup);
  const ir = gunPlaceIR(sr, c.place, tailMul, gunRng(gunSeedMix(seed, 8888, 0)));
  if (ir && wetG > 0) {
    const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = S[i] + 0.35 * (L[i] + R[i] - 2 * S[i]) / 2;
    const wet = gunConvolve(x, ir.L, ir.R, n);
    for (let i = 0; i < n; i++) { L[i] += wet.L[i] * wetG; R[i] += wet.R[i] * wetG; }
  }
  // CLIP: peak to 1, a soft clip whose hardness follows Crunch
  { let p = 0; for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
    const dc = 0.5 + 3 * c.crunch, tc = Math.tanh(dc), g = p > 0 ? 1 / p : 0;
    for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * g * dc) / tc; R[i] = Math.tanh(R[i] * g * dc) / tc; } }
  // BITS / RATE (the retro end; aliasing on purpose)
  const ds = 1 + Math.round(7 * c.rateCut);
  if (ds > 1) { let hl = 0, hr = 0; for (let i = 0; i < n; i++) { if (i % ds === 0) { hl = L[i]; hr = R[i]; } L[i] = hl; R[i] = hr; } }
  if (c.bits > 0) { const lv = Math.pow(2, 16 - 12 * c.bits - 1); for (let i = 0; i < n; i++) { L[i] = Math.round(L[i] * lv) / lv; R[i] = Math.round(R[i] * lv) / lv; } }
  // DC (the asymmetric clip and the pop have area): 2-pole high-pass at 22 Hz; the stereo width; a 60 ms end fade
  const hpA = Math.exp(-2 * Math.PI * 22 / sr);
  for (const X of [L, R]) { let h1 = 0, x1 = 0, h2 = 0, y1 = 0; for (let i = 0; i < n; i++) { h1 = hpA * (h1 + X[i] - x1); x1 = X[i]; h2 = hpA * (h2 + h1 - y1); y1 = h1; X[i] = h2; } }
  const w = gunClamp(c.width, 0, 1) / 0.6;
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2 * w; L[i] = m + s; R[i] = m - s; }
  const fo = Math.min(n, Math.round(0.06 * sr)); for (let i = 0; i < fo; i++) { const g = i / fo; L[n - 1 - i] *= g; R[n - 1 - i] *= g; }
  return { "L": Float32Array.from(L), "R": Float32Array.from(R), "info": { "times": times, "interval": c.interval, "rounds": c.rounds } };
}
// Level a gun buffer, in place. PEAK CONTROL first (`peak` 0..2, the patch's gunPeak), exactly blastLevel's / glassLevel's:
// the buffer brought to a 0.9 peak and run through the app's own lookahead limiter (limiterProcess) at min(peak, 1), ON
// THE GUN ALONE, before the chain; past 1 it is brought back to 0.9 and limited again at peak - 1 (a shot is nearly all
// spike, and a master Limiter after `gain` would pin the peak whatever the gain, so Variations could not level a pack).
// Then the prototype's own level: RMS GUN_RMS over the loudest 300 ms, the peak capped at GUN_PEAK, so Normalize off
// still sits it with the other engines.
function gunLevel(L, R, sr, peak) {
  const n = L.length; let pk = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > pk) pk = a; if (b > pk) pk = b; }
  if (pk < 1e-9) return;
  if (peak > 0) {
    const g0 = 0.9 / pk;
    for (let i = 0; i < n; i++) { L[i] *= g0; R[i] *= g0; }
    limiterProcess(L, R, Math.min(1, peak));
    if (peak > 1) {
      let p2 = 0;
      for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p2) p2 = a; if (b > p2) p2 = b; }
      const g1 = 0.9 / Math.max(1e-9, p2);
      for (let i = 0; i < n; i++) { L[i] *= g1; R[i] *= g1; }
      limiterProcess(L, R, Math.min(1, peak - 1));
    }
  }
  const W = Math.min(n, Math.round(0.3 * sr)), hop = Math.round(0.01 * sr);
  let best = 0; pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  for (let a = 0; a + W <= n; a += hop) { let s = 0; for (let i = a; i < a + W; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; best = Math.max(best, s / W); }
  if (!(best > 0)) return;
  let g = GUN_RMS / Math.sqrt(best);
  if (pk * g > GUN_PEAK) g = GUN_PEAK / pk;
  for (let i = 0; i < n; i++) { L[i] *= g; R[i] *= g; }
}

