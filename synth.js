// CrunchySFX — the synthesis core: one patch object in, stereo audio out.
//
// Extracted from index.html so the engine can be exported and reused (CrunchyVFX synthesises
// its matched sounds with this exact code). Loaded via <script src="synth.js"> AFTER dsp.js and
// BEFORE the main <script> — classic scripts share one global scope, like presets.js.
//
// PURE: no DOM, no app globals, no module state. Everything it needs is either a dsp.js helper
// or an explicit argument, which is what makes it safe to ship standalone. Keep it that way —
// reaching for an app global here is what would break the export, silently.
//
//   renderPatch(st, opts) -> { L, R, rawPeak }
//     st   — a patch: the same flat key/value shape as PRESETS entries and `state`.
//     opts — { sample: Float32Array|null, normalize: boolean }, both optional.
//
// rawPeak is the pre-normalization peak, so callers can tell "quiet" from "silent".

// ---------- Audibility ----------
// A sound whose intrinsic peak is below this floor (~ -66 dB) is treated as
// inaudible: normalization can't rescue it, so we re-roll or flag it instead.
const AUDIBLE_FLOOR = 1e-3;  // below this (~ -60 dB) a sound counts as inaudible
const NORM_TARGET = 0.9;     // loudness-normalize quiet sounds up to this peak...
const NORM_MAX_BOOST = 300;  // ...capped at ~50 dB makeup so gated silence can't become hiss

function renderPatch(st, opts) {
  opts = opts || {};
  // The two pieces of app state render() used to reach for as globals. Defaults match the
  // app: no loaded sample, normalization on.
  const sampleBuf = opts.sample || null;
  const normalizeOut = opts.normalize !== false;

  const dur = st.duration;
  const n = Math.max(1, Math.floor(dur * SR));
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const susLevel = st.sustain;
  const atk = st.attack, dec = st.decay, hold = st.hold, rel = st.release;
  // burst: retrigger the shot `repeat` times at `rate` Hz. `slot` is one shot's
  // length; each shot gets its own local time so the envelope, pitch sweep and
  // filter env all re-fire per shot instead of once across the whole buffer.
  const repeat = Math.max(1, Math.round(st.repeat || 1));
  const rate = Math.max(0.5, st.rate || 10);
  const slot = repeat > 1 ? 1 / rate : dur;
  const relStart = Math.max(atk + hold + dec, slot - rel);

  const baseFreq = st.freq;
  const sweep = st.sweep;
  const waveType = Math.round(st.wave);
  const baseCut = st.cutoff;
  const filtEnv = st.filtEnv;
  const fmode = Math.round(st.filterMode);   // 0 LP, 1 HP, 2 BP, 3 notch, 4 peak

  // deterministic LCG so exports are reproducible
  let seed = 22222;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };

  // unison: V detuned voices, each with its own phase + equal-power stereo pan.
  // Detune (beating) + stereo spread is what turns one thin voice into a thick one.
  const V = Math.max(1, Math.round(st.unison));
  const width = st.width;
  const phases = new Float32Array(V);
  const ratios = new Float32Array(V);
  const panL = new Float32Array(V);
  const panR = new Float32Array(V);
  const voiceGain = 1 / Math.sqrt(V);
  for (let v = 0; v < V; v++) {
    phases[v] = V > 1 ? v / V : 0;                          // spread start phases
    const d = V > 1 ? (v / (V - 1)) * 2 - 1 : 0;            // -1..1 across the voices
    ratios[v] = Math.pow(2, (d * st.detune) / 1200);    // cents -> frequency ratio
    const pan = d * width;                                  // spread across the stereo field
    panL[v] = Math.cos((pan + 1) * Math.PI / 4);
    panR[v] = Math.sin((pan + 1) * Math.PI / 4);
  }

  let subPhase = 0, vibPhase = 0;
  let ic1L = 0, ic2L = 0, ic1R = 0, ic2R = 0;   // per-channel TPT filter state
  let ringPhase = 0, pwmPhase = 0;              // ring-mod carrier + PWM LFO phases
  let xprevL = 0, xprevR = 0;                   // previous pre-drive sample (for oversampling)
  // Karplus-Strong plucked string (wave "pluck"): a noise-filled delay line whose
  // averaging feedback both sets the pitch (length = SR/freq) and damps the tail.
  const isPluck = waveType === 8;
  const ksBuf = isPluck ? new Float32Array(2206) : null;   // max length at 20 Hz
  let ksN = 0, ksIdx = 0, ksPrevShot = -1;
  let ksC = 0, ksApX = 0, ksApY = 0;                  // fractional-delay allpass (see below)
  const ksRho = 0.999 - 0.02 * st.pluckDamp;            // string decay (higher damp -> shorter)
  // Imported WAV as the source (wave "sample"): read position advances at a varispeed
  // rate set by the pitch controls. Plays once from the start, then silence.
  const isSample = waveType === 9;
  let samplePos = 0, samplePrevShot = -1;
  // Modal resonator bank (wave "modal"): a struck sound = sum of decaying tuned partials.
  // Mode ratios/amplitudes/decays depend only on state (constant across the render), so we
  // precompute them once; only the per-mode phase resets on each (repeat) shot. `inharm`
  // morphs the ratios from harmonic (k) toward ideal free-bar modes ((2k+1)/3)^2 → bell/metal.
  const isModal = waveType === 10;
  const MODAL_MAX = 16;
  const modalRatio = new Float32Array(MODAL_MAX), modalAmp = new Float32Array(MODAL_MAX);
  const modalInvTau = new Float32Array(MODAL_MAX), modalPh = new Float32Array(MODAL_MAX);
  let nModes = 1, modalPrevShot = -1;
  if (isModal) {
    nModes = Math.max(1, Math.min(MODAL_MAX, Math.round(st.modalPartials)));
    const inh = st.modalInharm, mb = st.modalBright, dT = Math.max(0.02, st.modalDecay);
    let norm = 0;
    for (let k = 1; k <= nModes; k++) {
      const bar = (2 * k + 1) / 3;                                  // free-bar mode index
      modalRatio[k - 1] = (1 - inh) * k + inh * bar * bar;          // harmonic ↔ inharmonic
      modalAmp[k - 1] = 1 / Math.pow(k, 2 - 2 * mb);                // bright: 1/k² (dark) → flat
      modalInvTau[k - 1] = Math.sqrt(k) / dT;                       // higher modes ring shorter
      norm += modalAmp[k - 1];
    }
    if (norm > 0) for (let k = 0; k < nModes; k++) modalAmp[k] /= norm;   // keep level bounded
  }
  // Granular (wave "granular"): built up front into a stereo buffer (grains need random access),
  // then read per-sample below. Source = the imported sample if loaded, else a synth tone.
  const isGranular = waveType === 11;
  let granL = null, granR = null;
  if (isGranular) {
    const src = (sampleBuf && sampleBuf.length > 1) ? sampleBuf : granSynthSource();
    const gr = makeGranular(src, n, baseFreq, st.grainSize, st.grainDensity, st.grainSpray, st.grainScan, st.grainSpread, 0x00c0ffee);
    granL = gr.L; granR = gr.R;
  }
  // Custom drawn wave (wave 12): band-limit the drawing to this note's highest frequency (up-sweep
  // pushes it higher) so it can't alias, into the module-level table waveform() reads. Read via the
  // normal unison path, so detune/width/vibrato all work. customTable is cleared otherwise.
  let customTable = null, customTableB = null;
  if (waveType === 12) {
    const drawn = b64ToCustomWave(st.customWave) || CUSTOM_DEFAULT_DRAWN;
    const swMul = st.sweep > 0 ? Math.pow(2, st.sweep * 4) : 1;
    const fMax = Math.min(20000, Math.max(1, baseFreq * swMul));
    const maxH = Math.floor(22050 / fMax);
    customTable = buildCustomTable(drawn, maxH);
    // Wave Morph: build Wave B too when engaged (morph start > 0, or a sweep). Band-limited the same
    // way, so the two tables share length and blend cleanly. Off by default → no extra FFT cost.
    if (st.morph > 0 || st.morphSweep !== 0) {
      const drawnB = b64ToCustomWave(st.customWaveB) || CUSTOM_DEFAULT_DRAWN;
      customTableB = buildCustomTable(drawnB, maxH);
    }
  }
  // Formant / vocal (wave "formant"): a buzz (band-limited saw) through 3 parallel resonant
  // bandpasses tuned to vowel formants → "ahh/ooo/eee", voices, creatures, robots. Formant freqs
  // depend only on state (constant across the render), so coeffs are precomputed once here; only
  // the biquad states + source phase advance per sample. Special-cased (mono, ignores unison).
  const isFormant = waveType === 13;
  let fmPhase = 0;
  const F_N = 3, fmB0 = new Float64Array(F_N), fmA1 = new Float64Array(F_N), fmA2 = new Float64Array(F_N);
  const fmX1 = new Float64Array(F_N), fmX2 = new Float64Array(F_N), fmY1 = new Float64Array(F_N), fmY2 = new Float64Array(F_N);
  const fmBreath = st.formantBreath;
  const fmQ = 4 + Math.max(0, Math.min(1, st.formantQ)) * 16;   // formant sharpness
  const fmLfoRate = st.formantLfoRate, fmLfoDepth = st.formantLfoDepth;
  const fmLfoOn = isFormant && fmLfoRate > 0 && fmLfoDepth > 0;    // vowel morphs over time
  // Static vowel → coeffs are constant, precompute once (unchanged path). LFO on → recompute
  // per sample from the morphing vowel (in the osc branch below).
  if (isFormant && !fmLfoOn) computeFormantCoeffs(st.formantVowel, st.formantSize, fmQ, fmB0, fmA1, fmA2);
  // Bubble / water (wave "bubble"): built up front into a stereo buffer, then read per-sample.
  const isBubble = waveType === 14;
  let bubL = null, bubR = null;
  if (isBubble) {
    const b = makeBubbles(n, baseFreq, st.bubbleRate, st.bubbleRise, st.bubbleSpread, st.bubbleDecay, 0x00b0bb1e);
    bubL = b.L; bubR = b.R;
  }
  // Particle / crackle (wave "particle"): built up front into a stereo buffer, then read per-sample.
  const isParticle = waveType === 15;
  let parL = null, parR = null;
  if (isParticle) {
    const pr = makeParticles(n, st.particleTone, st.particleRate, st.particleDecay, st.particleSpread, 0x00facade);
    parL = pr.L; parR = pr.R;
  }
  // Impact / blast (wave "impact"): one percussive transient, front-loaded at index 0; read at
  // `lt` in the loop so it retriggers per burst shot (full-auto). Mono; body via boom layer.
  const isImpact = waveType === 19;
  let impactBuf = null;
  if (isImpact) impactBuf = makeImpact(n, st.impactTone, st.impactDecay, st.impactPunch, st.impactGrit, 0x1a2b3c4d);
  // Whoosh / air (wave "whoosh"): one swing gesture sized to a shot's slot, read at `lt` so combos
  // (repeat) retrigger a fresh swish. Mono.
  const isWhoosh = waveType === 20;
  let whooshBuf = null;
  if (isWhoosh) { const wlen = Math.max(2, Math.min(n, Math.round(slot * SR))); whooshBuf = makeWhoosh(wlen, st.whooshTone, st.whooshSweep, st.whooshBody, st.whooshPeak, 0x51ce5ab1); }
  // Additive / spectral pad (wave "additive"): sum of `addPartials` harmonics, each with its own
  // slow amplitude-drift LFO (random rate/phase) → evolving pad. Per-partial data is constant
  // across the render, so precompute it once; only the partial phases advance per sample.
  const isAdditive = waveType === 16;
  const ADD_MAX = 48;
  const addAmp = new Float32Array(ADD_MAX), addDet = new Float32Array(ADD_MAX), addPh = new Float32Array(ADD_MAX);
  const addLfoRate = new Float32Array(ADD_MAX), addLfoPh = new Float32Array(ADD_MAX);
  const addPanL = new Float32Array(ADD_MAX), addPanR = new Float32Array(ADD_MAX);
  let nAdd = 1;
  const addDrift = st.addDrift, addDriftRate = st.addDriftRate;
  if (isAdditive) {
    nAdd = Math.max(1, Math.min(ADD_MAX, Math.round(st.addPartials)));
    const exp = 2 - 1.8 * st.addTilt, det = st.addDetune;
    let s = 0x5eed1234 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };   // deterministic
    let norm = 0;
    for (let k = 0; k < nAdd; k++) {
      addAmp[k] = 1 / Math.pow(k + 1, exp);
      addDet[k] = 1 + (rnd() * 2 - 1) * det * 0.01;              // ±1%·detune → slow beating
      addLfoRate[k] = addDriftRate * (0.5 + rnd());              // each partial drifts at its own rate
      addLfoPh[k] = rnd() * 2 * Math.PI;
      const pan = (rnd() * 2 - 1) * det;                         // stereo spread (det 0 = mono)
      addPanL[k] = Math.cos((pan + 1) * Math.PI / 4); addPanR[k] = Math.sin((pan + 1) * Math.PI / 4);
      norm += addAmp[k];
    }
    if (norm > 0) for (let k = 0; k < nAdd; k++) addAmp[k] /= norm;
  }
  // Speech (wave "speech"): render the text to a mono buffer up front, then read it per-sample.
  const isSpeech = waveType === 17;
  let speechBuf = null;
  if (isSpeech) speechBuf = makeSpeech(n, st.speechText, baseFreq, st.speechSize, st.speechRate, 0x5eec0de);
  // 4-operator FM (wave "FM 4op"): per-sample; ops evaluated 3→2→1→0 so mods resolve in one pass.
  const isFM4 = waveType === 18;
  const fmRatio = [1, st.fmRatio2, st.fmRatio3, st.fmRatio4];
  const fmPh = [0, 0, 0, 0], fmOut = [0, 0, 0, 0];
  let fmFbPrev = 0, fmPrevShot = -1;
  const fmModDepth = st.fmIndex * 6, fmFbAmt = st.fmFeedback * 5;
  const fmAlg = FM_ALGOS[Math.round(st.fmAlgo)] || FM_ALGOS[0];
  const fmMods = fmAlg.mods, fmCarr = fmAlg.carriers;

  // Body layer: a clean low sine with its OWN exponential decay and a downward
  // pitch drop, independent of the crack envelope. Because it rings longer than the
  // transient (and is added after the drive stage so it isn't squashed), it's what
  // gives the shot chest-thump depth instead of just a short click.
  const boom = st.boom, boomF0 = st.boomFreq;
  const boomDrop = st.boomDrop, boomDec = Math.max(0.01, st.boomDecay);
  let boomPhase = 0, prevShot = -1;
  // colored-noise state + exponential-envelope exponent (both default to neutral → unchanged output)
  const noiseColor = st.noiseColor, eexp = 1 + st.envCurve * 3;
  let brownN = 0;

  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const shotIdx = repeat > 1 ? Math.min(repeat - 1, Math.floor(t / slot)) : 0;
    const lt = t - shotIdx * slot;                 // time since this shot fired
    const prog = slot > 0 ? Math.min(1, lt / slot) : 0;

    const sweepMul = Math.pow(2, sweep * 4 * prog);
    const vib = st.vibDepth * Math.sin(vibPhase);
    // arpeggio: each repeat shot steps arpStep semitones (default 0 → ×1, so unchanged)
    const arpMul = st.arpStep ? Math.pow(2, st.arpStep * shotIdx / 12) : 1;
    const f = baseFreq * sweepMul * Math.pow(2, vib * 0.5) * arpMul;
    // keep the fundamental in the reproducible band so upward sweeps don't push it
    // ultrasonic (which aliases to garbage / near-silence instead of a real tone)
    const fOsc = Math.min(f, 20000);
    vibPhase += 2 * Math.PI * st.vibRate / SR;

    // pulse-width for this sample: base width wobbled by the PWM LFO
    let duty = st.pulseWidth;
    if (st.pwmDepth > 0) {
      pwmPhase += st.pwmRate / SR; if (pwmPhase >= 1) pwmPhase -= 1;
      duty += st.pwmDepth * Math.sin(2 * Math.PI * pwmPhase);
      if (duty < 0.05) duty = 0.05; else if (duty > 0.95) duty = 0.95;
    }

    let oscL = 0, oscR = 0;
    if (isSample) {
      // read the imported sample with linear interpolation at varispeed (f/440 =
      // playback rate, so 440 Hz plays native; freq/sweep/vibrato = tape-style speed).
      if (sampleBuf && sampleBuf.length) {
        if (shotIdx !== samplePrevShot) { samplePrevShot = shotIdx; samplePos = 0; }
        const ip = Math.floor(samplePos);
        let y = 0;
        if (ip < sampleBuf.length - 1) { const fr = samplePos - ip; y = sampleBuf[ip] * (1 - fr) + sampleBuf[ip + 1] * fr; }
        else if (ip < sampleBuf.length) y = sampleBuf[ip];
        samplePos += Math.max(0, f / 440);
        oscL = y; oscR = y;
      }
    } else if (isPluck) {
      // (re-)excite the delay line at each shot, then pluck one sample out of it
      if (shotIdx !== ksPrevShot) {
        ksPrevShot = shotIdx;
        // THE DELAY LINE IS FRACTIONAL. `round(SR/f)` alone is wrong twice over, and the two
        // errors are of different kinds:
        //
        //   1. The loop reads the NEXT sample as well as the current one, so it is `ksN - 0.5`
        //      samples long and sounds SR/(ksN - 0.5), not SR/ksN. That half-sample is
        //      unconditional, so NO pitch was in tune — not one.
        //   2. `round()` quantises, so neighbouring semitones are out by DIFFERENT amounts. That
        //      is worse than a uniform offset: a uniform one is a key change nobody can hear,
        //      this one detunes intervals against each other. Measured downstream in CrunchyBGM
        //      across the 25 records that use this wave: 26.1% of generated notes over 10 cents
        //      out, reaching 65 cents at MIDI 95, and adjacent semitones up to 54 cents apart.
        //
        // The fix carries the fractional part in a first-order ALLPASS in the loop (below). An
        // allpass rather than the textbook linear interpolation because |H| = 1 at every
        // frequency: the in-loop averager IS the string's damping, and letting the fraction ride
        // on its coefficient would make decay a function of pitch. Measured at 0.3 cents worst,
        // with decay, peak level and CrunchyBGM's `instrumentGain` all unmoved.
        //
        // `ksFrac` is kept in [0.5, 1.5) — the band a first-order allpass is well behaved in, since
        // its pole walks toward z = -1 as the fraction goes to 0.
        const ksD = Math.min(2205.49, Math.max(2.5, SR / Math.max(20, fOsc)));
        ksN = Math.floor(ksD);
        const ksFrac = ksD - ksN + 0.5;                  // 0.5..1.5
        ksC = (1 - ksFrac) / (1 + ksFrac);
        ksApX = 0; ksApY = 0;
        ksIdx = 0;
        for (let j = 0; j < ksN; j++) ksBuf[j] = rnd();
      }
      const y = ksBuf[ksIdx];
      const nxt = ksIdx + 1 >= ksN ? 0 : ksIdx + 1;
      const ksU = (y + ksBuf[nxt]) * 0.5 * ksRho;      // lowpass-in-the-loop = damping
      const ksW = ksC * (ksU - ksApY) + ksApX;         // fractional delay, |H| = 1 (see above)
      ksApX = ksU; ksApY = ksW;
      ksBuf[ksIdx] = ksW;
      ksIdx = nxt;
      oscL = y; oscR = y;                              // mono, centered (ignores unison)
    } else if (isModal) {
      // struck at each shot (reset mode phases); sum decaying partials. Phases start at 0 so
      // the sum begins near zero → soft click-free strike. Skip modes past Nyquist (band-limit).
      if (shotIdx !== modalPrevShot) { modalPrevShot = shotIdx; for (let k = 0; k < nModes; k++) modalPh[k] = 0; }
      let y = 0;
      for (let k = 0; k < nModes; k++) {
        const fk = fOsc * modalRatio[k];
        modalPh[k] += fk / SR; if (modalPh[k] >= 1) modalPh[k] -= 1;   // advance (keep continuity)
        if (fk >= 20000) continue;                                     // band-limit
        y += modalAmp[k] * Math.exp(-lt * modalInvTau[k]) * Math.sin(2 * Math.PI * modalPh[k]);
      }
      oscL = y * 2; oscR = y * 2;                     // mono, centered; ×2 for a healthy level
    } else if (isGranular) {
      oscL = granL[i]; oscR = granR[i];               // prebuilt grain cloud (already stereo)
    } else if (isFormant) {
      // buzz source (band-limited saw) + optional breath noise, through 3 formant resonators
      if (fmLfoOn) computeFormantCoeffs(st.formantVowel + fmLfoDepth * Math.sin(2 * Math.PI * fmLfoRate * t), st.formantSize, fmQ, fmB0, fmA1, fmA2);
      const dt = fOsc / SR;
      fmPhase += dt; if (fmPhase >= 1) fmPhase -= 1;
      let src = waveform(2, fmPhase, dt, 0.25);
      if (fmBreath > 0) src = src * (1 - fmBreath) + (rnd() * 2 - 1) * fmBreath;
      let y = 0;
      for (let fi = 0; fi < F_N; fi++) {
        const o = fmB0[fi] * (src - fmX2[fi]) - fmA1[fi] * fmY1[fi] - fmA2[fi] * fmY2[fi];   // b1=0, b2=−b0
        fmX2[fi] = fmX1[fi]; fmX1[fi] = src; fmY2[fi] = fmY1[fi]; fmY1[fi] = o;
        y += o * FORMANT_GAIN[fi];
      }
      oscL = y * 1.6; oscR = y * 1.6;                 // mono, centered; makeup for a healthy level
    } else if (isBubble) {
      oscL = bubL[i]; oscR = bubR[i];                 // prebuilt bubble cloud (already stereo)
    } else if (isParticle) {
      oscL = parL[i]; oscR = parR[i];                 // prebuilt particle cloud (already stereo)
    } else if (isImpact) {
      const idx = (lt * SR) | 0;                       // time since this shot → replays the transient per shot
      const v = idx < impactBuf.length ? impactBuf[idx] : 0;
      oscL = v; oscR = v;                             // mono blast; boom layer adds the low thump
    } else if (isWhoosh) {
      const idx = (lt * SR) | 0;                       // time since this shot → replays the swing per shot
      const v = idx < whooshBuf.length ? whooshBuf[idx] : 0;
      oscL = v; oscR = v;                             // mono swish
    } else if (isAdditive) {
      let sL = 0, sR = 0;
      for (let k = 0; k < nAdd; k++) {
        const fk = fOsc * (k + 1) * addDet[k];
        if (fk >= 20000) continue;                    // band-limit
        addPh[k] += fk / SR; if (addPh[k] >= 1) addPh[k] -= 1;
        const drift = 1 - addDrift * (0.5 + 0.5 * Math.cos(2 * Math.PI * addLfoRate[k] * t + addLfoPh[k]));
        const v = Math.sin(2 * Math.PI * addPh[k]) * addAmp[k] * drift;
        sL += v * addPanL[k]; sR += v * addPanR[k];
      }
      oscL = sL * 1.4; oscR = sR * 1.4;               // makeup for a healthy level
    } else if (isSpeech) {
      const v = speechBuf[i]; oscL = v; oscR = v;     // prebuilt speech utterance (mono)
    } else if (isFM4) {
      if (shotIdx !== fmPrevShot) { fmPrevShot = shotIdx; fmPh[0] = fmPh[1] = fmPh[2] = fmPh[3] = 0; fmFbPrev = 0; }
      let s3 = 0;
      for (let oi = 3; oi >= 0; oi--) {                // higher ops first (they modulate lower ops)
        let modIn = oi === 3 ? fmFbAmt * fmFbPrev : 0;
        const md = fmMods[oi];
        for (let m = 0; m < md.length; m++) modIn += fmOut[md[m]];
        const raw = Math.sin(2 * Math.PI * fmPh[oi] + modIn);
        fmPh[oi] += fOsc * fmRatio[oi] / SR; if (fmPh[oi] >= 1) fmPh[oi] -= 1;
        if (oi === 3) s3 = raw;
        fmOut[oi] = fmCarr.indexOf(oi) >= 0 ? raw : raw * fmModDepth;   // carrier = audio; modulator = radians
      }
      fmFbPrev = s3;
      let y = 0; for (let c = 0; c < fmCarr.length; c++) y += fmOut[fmCarr[c]];
      y /= fmCarr.length;
      oscL = y; oscR = y;                             // mono, centered
    } else {
      // Wave-Morph blend factor at this sample: A→B start (morph) plus a sweep over the sound's
      // duration. Same for every unison voice, so compute once. Only non-zero when Wave B is built.
      let morphB = 0;
      if (customTableB) morphB = Math.min(1, Math.max(0, st.morph + st.morphSweep * (n > 1 ? i / (n - 1) : 0)));
      // sum unison voices into L/R
      for (let v = 0; v < V; v++) {
        const dt = (fOsc * ratios[v]) / SR;
        let ph = phases[v] + dt;
        if (ph >= 1) ph -= 1;
        phases[v] = ph;
        const w = waveform(waveType, ph, dt, duty, customTable, customTableB, morphB);
        oscL += w * panL[v];
        oscR += w * panR[v];
      }
      oscL *= voiceGain; oscR *= voiceGain;
    }

    // sub oscillator: clean sine an octave down, centered, for weight
    if (st.subOsc > 0) {
      subPhase += (fOsc * 0.5) / SR; if (subPhase >= 1) subPhase -= 1;
      const sub = Math.sin(2 * Math.PI * subPhase) * st.subOsc;
      const k = 1 - st.subOsc * 0.5;
      oscL = oscL * k + sub; oscR = oscR * k + sub;
    }

    // noise (centered)
    let sL = oscL, sR = oscR;
    if (st.noise > 0) {
      let wn = rnd();
      if (noiseColor > 0) {   // lowpass toward brown; blend white↔brown by color (makeup for the level drop)
        brownN += (wn - brownN) * (1 - noiseColor * 0.98);
        wn = wn * (1 - noiseColor) + brownN * noiseColor * (1 + noiseColor * 4);
      }
      const nz = wn * st.noise, k = 1 - st.noise;
      sL = oscL * k + nz; sR = oscR * k + nz;
    }

    // ring modulation: multiply the source by a sine carrier -> inharmonic,
    // metallic/clangy partials. Dry/wet blended by the mix amount.
    if (st.ringMod > 0) {
      ringPhase += st.ringFreq / SR; if (ringPhase >= 1) ringPhase -= 1;
      const rm = Math.sin(2 * Math.PI * ringPhase), mix = st.ringMod;
      sL = sL * (1 - mix) + sL * rm * mix;
      sR = sR * (1 - mix) + sR * rm * mix;
    }

    // amp envelope (AHDSR-ish)
    let env;
    if (lt < atk) env = atk > 0 ? lt / atk : 1;
    else if (lt < atk + hold) env = 1;
    else if (lt < atk + hold + dec) { const d = (lt - atk - hold) / (dec || 1e-9); env = susLevel + (1 - susLevel) * Math.pow(1 - d, eexp); }
    else if (lt < relStart) env = susLevel;
    else { const r = rel > 0 ? (lt - relStart) / rel : 1; env = susLevel * Math.pow(1 - r, eexp); }
    if (env < 0) env = 0;
    sL *= env; sR *= env;

    // resonant low-pass — TPT / zero-delay-feedback state-variable filter
    // (Zavalishin). Unconditionally stable at ALL cutoffs; the old Chamberlin SVF
    // self-oscillated at Nyquist once cutoff neared SR/4, which turned bright sounds
    // into 22 kHz buzz that plays back as clicks/silence.
    let cut = baseCut * Math.pow(2, filtEnv * 3 * prog);
    cut = Math.min(Math.max(cut, 20), 20000);
    const g = Math.tan(Math.PI * cut / SR);
    const k = Math.max(2 - 1.9 * st.reso, 0.1);       // damping = 1/Q
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    // The SVF yields all responses at once: v2 = LP, v1 = BP, hp = HP.
    // notch = HP + LP, peak = LP - HP. fmode selects which one we keep.
    {
      const x = sL;
      const v3 = x - ic2L;
      const v1 = a1 * ic1L + a2 * v3;
      const v2 = ic2L + a2 * ic1L + a3 * v3;
      ic1L = 2 * v1 - ic1L; ic2L = 2 * v2 - ic2L;
      const hp = x - k * v1 - v2;
      sL = fmode === 0 ? v2 : fmode === 1 ? hp : fmode === 2 ? v1 : fmode === 3 ? hp + v2 : v2 - hp;
    }
    {
      const x = sR;
      const v3 = x - ic2R;
      const v1 = a1 * ic1R + a2 * v3;
      const v2 = ic2R + a2 * ic1R + a3 * v3;
      ic1R = 2 * v1 - ic1R; ic2R = 2 * v2 - ic2R;
      const hp = x - k * v1 - v2;
      sR = fmode === 0 ? v2 : fmode === 1 ? hp : fmode === 2 ? v1 : fmode === 3 ? hp + v2 : v2 - hp;
    }

    // crunch: tanh drive + bitcrush
    if (st.drive > 0) {
      const d = 1 + st.drive * 40, norm = Math.tanh(d), amp = 0.6 + 0.4 * (1 - st.drive);
      const OS = Math.max(1, Math.round(st.driveOS));
      if (OS <= 1) {
        sL = Math.tanh(sL * d) / norm * amp;
        sR = Math.tanh(sR * d) / norm * amp;
      } else {
        // oversample the nonlinearity: interpolate from the previous input toward
        // this one, shape each subsample, then average back down. The drive's new
        // harmonics land above the base rate's Nyquist, so far less aliasing folds
        // back — a cleaner crunch. Free here because rendering is offline.
        const pL = xprevL, pR = xprevR;
        let accL = 0, accR = 0;
        for (let s = 1; s <= OS; s++) {
          const f = s / OS;
          accL += Math.tanh((pL + (sL - pL) * f) * d);
          accR += Math.tanh((pR + (sR - pR) * f) * d);
        }
        xprevL = sL; xprevR = sR;
        sL = accL / OS / norm * amp;
        sR = accR / OS / norm * amp;
      }
    }
    const bits = Math.round(st.bitcrush);
    if (bits < 16) {
      const levels = Math.pow(2, bits);
      sL = Math.round(sL * levels) / levels;
      sR = Math.round(sR * levels) / levels;
    }

    // add the deep body last, using local time so it re-fires per shot in bursts
    if (boom > 0) {
      if (shotIdx !== prevShot) { boomPhase = 0; prevShot = shotIdx; }  // retrigger phase
      const bEnv = Math.exp(-lt / boomDec);                              // own long decay
      const bf = boomF0 * Math.pow(2, -boomDrop * Math.min(1, lt / boomDec)); // pitch drop
      boomPhase += bf / SR; if (boomPhase >= 1) boomPhase -= 1;
      const b = Math.sin(2 * Math.PI * boomPhase) * bEnv * boom;
      sL += b; sR += b;
    }

    L[i] = sL; R[i] = sR;
  }

  // downsample crunch (sample-and-hold)
  const ds = Math.round(st.downsample);
  if (ds > 1) {
    let hL = 0, hR = 0;
    for (let i = 0; i < n; i++) {
      if (i % ds === 0) { hL = L[i]; hR = R[i]; }
      L[i] = hL; R[i] = hR;
    }
  }

  // modulation FX (chorus/phaser) before the delay/reverb tail — no-ops when their mix is 0
  chorusProcess(L, R, st.chorusMix, st.chorusRate, st.chorusDepth);
  phaserProcess(L, R, st.phaserMix, st.phaserRate, st.phaserDepth);

  // feedback delay, then reverb -> space & depth.
  if (st.delay > 0) {
    const dt = Math.max(1, Math.round(st.delayTime * SR));
    const fbk = st.delayFb, wet = st.delay, pp = st.pingpong;
    if (pp <= 0) {
      // per-channel feedback delay (unchanged / byte-identical when ping-pong is off)
      for (const buf of [L, R]) {
        const acc = new Float32Array(n);
        for (let i = 0; i < n; i++) acc[i] = buf[i] + (i >= dt ? fbk * acc[i - dt] : 0);
        for (let i = dt; i < n; i++) buf[i] += wet * acc[i - dt];
      }
    } else {
      // ping-pong: one mono feedback line whose successive dt-taps alternate L/R (pp = how hard)
      const acc = new Float32Array(n);
      for (let i = 0; i < n; i++) acc[i] = (L[i] + R[i]) * 0.5 + (i >= dt ? fbk * acc[i - dt] : 0);
      for (let i = dt; i < n; i++) {
        const echo = wet * acc[i - dt], tap = Math.floor(i / dt) & 1;
        L[i] += echo * (tap ? 1 : 1 - pp);
        R[i] += echo * (tap ? 1 - pp : 1);
      }
    }
  }
  if (st.reverb > 0) reverbProcess(L, R, st.reverbSize, st.reverbTone, st.reverb);

  // convolution reverb (synthesized IRs) — parallel wet mix; decorrelated L/R IRs = stereo width.
  // Tail truncated at n like the delay/Freeverb stages. FFT only runs when engaged (convMix > 0).
  if (st.convMix > 0) {
    const ct = Math.round(st.convType);
    let irL = null, irR = null;
    if (ct >= 4) {                                          // "Custom IR": convolve with the user-loaded space (if any)
      if (customIR) {
        if (st.convTone >= 0.999) { irL = customIR.L; irR = customIR.R; }   // verbatim (bright) — use as-is
        else { const t = toneIR(customIR.L, customIR.R, st.convTone); irL = t.L; irR = t.R; }   // Conv tone darkens it
      }
    } else {                                                // built-in synthesized spaces (Room/Hall/Plate/Spring)
      irL = makeIR(ct, st.convSize, st.convTone, 0x1234abcd);
      irR = makeIR(ct, st.convSize, st.convTone, 0x9e3779b9);
    }
    if (irL) {                                              // (Custom IR selected but none loaded → skip, stays dry)
      const wetL = convolveFFT(L, irL), wetR = convolveFFT(R, irR);
      const mix = st.convMix, dryG = 1 - mix, wetG = mix * CONV_MAKEUP;
      for (let i = 0; i < n; i++) { L[i] = L[i] * dryG + wetL[i] * wetG; R[i] = R[i] * dryG + wetR[i] * wetG; }
    }
  }

  // master transient shaper (punch up / soften attacks) — before normalize since it moves peaks
  if (st.transient !== 0) transientShape(L, R, st.transient);

  // Remove any DC the drive stage put back (see dcBlock). BEFORE the peak measurement below, and
  // for the same reason the transient shaper is: an offset counts toward rawPeak, so a driven
  // narrow-pulse sound measures louder than it sounds and normalization then pulls it DOWN.
  dcBlock(L, R);

  // measure intrinsic peak (before gain) for loudness normalization + audibility
  let rawPeak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i]); if (a > rawPeak) rawPeak = a;
    const b = Math.abs(R[i]); if (b > rawPeak) rawPeak = b;
  }
  // normalize quiet-but-present sounds up to a consistent level (capped so we never
  // amplify near-silence into hiss); the user gain then trims from there.
  let norm = 1;
  if (normalizeOut && rawPeak > AUDIBLE_FLOOR) norm = Math.min(NORM_TARGET / rawPeak, NORM_MAX_BOOST);

  // gain + short fade-out
  const g = st.gain * norm;
  const fade = Math.min(256, Math.floor(n * 0.02));
  for (let i = 0; i < n; i++) {
    let l = L[i] * g, r = R[i] * g;
    if (i > n - fade) { const kf = (n - i) / fade; l *= kf; r *= kf; }
    L[i] = l; R[i] = r;
  }
  // master limiter (lookahead brickwall) — bounds to its ceiling; louder/denser as it rises
  if (st.limiter > 0) limiterProcess(L, R, st.limiter);
  // final safety clip (a no-op when the limiter is engaged, since it stays under its ceiling)
  for (let i = 0; i < n; i++) { L[i] = Math.max(-1, Math.min(1, L[i])); R[i] = Math.max(-1, Math.min(1, R[i])); }
  // Reverse (default 0 = off → existing sounds byte-identical). Flip only the AUDIBLE span so
  // trailing silence stays at the end instead of becoming a leading gap; a reverb tail then swells
  // forward into the transient (reverse cymbal / whoosh / riser). Short declick at both new ends.
  if (st.reverse) {
    let last = n - 1;
    while (last > 0 && Math.abs(L[last]) < 1e-4 && Math.abs(R[last]) < 1e-4) last--;
    for (let i = 0, j = last; i < j; i++, j--) {
      const tl = L[i]; L[i] = L[j]; L[j] = tl;
      const tr = R[i]; R[i] = R[j]; R[j] = tr;
    }
    const dc = Math.min(fade, last >> 1) || 1;
    for (let i = 0; i < dc; i++) { const k = i / dc; L[i] *= k; R[i] *= k; L[last - i] *= k; R[last - i] *= k; }
  }
  return { L, R, rawPeak };
}

// ---------- WAV encoding ----------
// Pure byte-shuffling: patch -> audio -> file, all in one unit. Lives here rather than in the
// app because anything consuming the engine also needs to write the result out (CrunchyVFX
// ships the matched sound beside the sprite sheet). The DOM/Tauri save path stays in the app.

// Linear resample a mono buffer. Fine for sfx (offline, no real-time deadline); when the
// target rate matches SR the input buffer is returned untouched (bit-exact passthrough).
function resampleLinear(buf, srcRate, dstRate) {
  if (srcRate === dstRate || !buf.length) return buf;
  const ratio = dstRate / srcRate;
  const n = Math.max(1, Math.round(buf.length * ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / ratio;                                  // source position
    const i0 = Math.floor(t), i1 = Math.min(i0 + 1, buf.length - 1);
    const frac = t - i0;
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  return out;
}

// One RIFF chunk: id(4) + size(4) + body, body zero-padded to an even length (WAV spec).
// `size` is the unpadded body length. Returns a Uint8Array (full chunk).
function wavChunk(id, body) {
  const pad = body.length & 1;
  const out = new Uint8Array(8 + body.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}
// LIST/INFO metadata: software tag (always) + title (if given). null if nothing to write.
function wavInfoChunk(title) {
  const subs = [wavChunk("ISFT", new TextEncoder().encode("CrunchySFX\0"))];
  if (title) subs.push(wavChunk("INAM", new TextEncoder().encode(title + "\0")));
  let len = 4; for (const s of subs) len += s.length;
  const body = new Uint8Array(len);
  body.set([73, 78, 70, 79], 0);   // "INFO"
  let o = 4; for (const s of subs) { body.set(s, o); o += s.length; }
  return wavChunk("LIST", body);
}
// smpl chunk with a single forward loop over the whole file (frames 0..end, infinite play).
function wavSmplChunk(rate, frames) {
  const b = new Uint8Array(60), v = new DataView(b.buffer);
  v.setUint32(8, Math.round(1e9 / rate), true);   // sample period (ns); others default 0
  v.setUint32(12, 60, true);                       // MIDI unity note
  v.setUint32(28, 1, true);                        // one sample loop
  v.setUint32(48, Math.max(0, frames - 1), true);  // loop end frame (start=0, type=forward=0)
  return wavChunk("smpl", b);
}

function encodeWav(L, R, opts) {
  const rate = (opts && opts.rate) || SR;
  const depth = (opts && opts.depth) || 16;               // 16 or 24
  const channels = (opts && opts.channels) || 2;          // 1 (mono) or 2 (stereo)
  const loop = !!(opts && opts.loop);
  const title = opts && opts.title ? String(opts.title) : "";
  let l = resampleLinear(L, SR, rate);
  let r = resampleLinear(R, SR, rate);
  if (channels === 1) {                                   // downmix to mono
    const m = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) m[i] = (l[i] + r[i]) * 0.5;
    l = r = m;
  }
  const bytesPer = depth / 8;                             // 2 or 3
  const blockAlign = channels * bytesPer;
  const frames = l.length;

  // fmt chunk body (16 bytes)
  const fmt = new Uint8Array(16), fv = new DataView(fmt.buffer);
  fv.setUint16(0, 1, true);                    // PCM
  fv.setUint16(2, channels, true);
  fv.setUint32(4, rate, true);
  fv.setUint32(8, rate * blockAlign, true);    // byte rate
  fv.setUint16(12, blockAlign, true);
  fv.setUint16(14, depth, true);

  // data chunk body (the PCM samples)
  const data = new Uint8Array(frames * blockAlign);
  const dv = new DataView(data.buffer);
  let off = 0;
  const write16 = (s) => { s = Math.max(-1, Math.min(1, s)); dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2; };
  const write24 = (s) => {
    s = Math.max(-1, Math.min(1, s));
    const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);   // signed 24-bit
    dv.setUint8(off, v & 0xff); dv.setUint8(off + 1, (v >> 8) & 0xff); dv.setUint8(off + 2, (v >> 16) & 0xff); off += 3;
  };
  const writeSample = depth === 24 ? write24 : write16;
  for (let i = 0; i < frames; i++) {
    writeSample(l[i]);
    if (channels === 2) writeSample(r[i]);
  }

  // Assemble RIFF. fmt + data stay first (audio at the standard offset 44); metadata /
  // loop chunks follow so naive offset-44 readers still find the samples.
  const chunks = [wavChunk("fmt ", fmt), wavChunk("data", data), wavInfoChunk(title)];
  if (loop) chunks.push(wavSmplChunk(rate, frames));
  let bodyLen = 4; for (const c of chunks) bodyLen += c.length;   // "WAVE" + chunks
  const out = new Uint8Array(8 + bodyLen);
  const ov = new DataView(out.buffer);
  out.set([82, 73, 70, 70], 0);   // "RIFF"
  ov.setUint32(4, bodyLen, true);
  out.set([87, 65, 86, 69], 8);   // "WAVE"
  let o = 12; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;   // ArrayBuffer of the .wav file
}
