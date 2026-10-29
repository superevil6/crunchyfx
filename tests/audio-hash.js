"use strict";
// CrunchySFX — THE AUDIO HASH (the "no sound changes" proof for a sold app). Runs INSIDE the real index.html (the
// app's own render() → synth.js renderPatch, the app's own withState and encodeWav), renders EVERY built-in preset
// and fingerprints the exact float samples and the exported WAV bytes. Run it before a change and after: the hashes
// must match exactly.
//
//   python3 tests/build.py audio
//   p=$(mktemp -d); echo 'user_pref("browser.dom.window.dump.enabled", true);' > $p/user.js
//   firefox --headless --profile $p --window-size=1100,600 --screenshot "$PWD/tests/audio.png" \
//           "file://$PWD/tests/run-audio.html" | grep '^AUDIO'
//
// Prints (to stdout through dump(), and in the banner) one `AUDIO <name> <hash>` line per preset, then
// `AUDIOHASH <total> over <n>`. Diff two runs' outputs to name a preset that moved.

(function () {
  const out = [];
  const say = function (line) { out.push(line); try { dump(line + "\n"); } catch (e) { /* dump disabled */ } };
  // FNV-1a over bytes, two independent 32-bit lanes (64 bits). Both multipliers are ODD (an even one, as plant.js's
  // second lane has, shifts that lane's low bits out to zero over a long input).
  function fnv(bytes, h) {
    let a = h ? h[0] : 0x811c9dc5, b = h ? h[1] : 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < bytes.length; i++) {
      a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
      b = Math.imul(b ^ bytes[i], 0x5bd1e995) >>> 0;
    }
    return [a, b];
  }
  const hex = function (h) { return ("00000000" + h[0].toString(16)).slice(-8) + ("00000000" + h[1].toString(16)).slice(-8); };
  const f32 = function (arr) { return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); };
  try {
    if (typeof endTour === "function") endTour(false);
    const names = Object.keys(PRESETS);
    let total = null, nan = 0, n = 0;
    const FORMATS = [
      { rate: 44100, depth: 16, channels: 2, loop: false },
      { rate: 22050, depth: 16, channels: 1, loop: false },
      { rate: 48000, depth: 24, channels: 2, loop: true },
    ];
    names.forEach(function (name, i) {
      const r = withState(PRESETS[name], function () { return render(); });
      for (let k = 0; k < r.L.length; k += 97) if (r.L[k] !== r.L[k] || r.R[k] !== r.R[k]) { nan++; break; }
      let h = fnv(f32(r.L));
      h = fnv(f32(r.R), h);
      const fmt = FORMATS[i % FORMATS.length];                       // every format, a third of the presets each
      h = fnv(new Uint8Array(encodeWav(r.L, r.R, Object.assign({ title: name }, fmt))), h);
      say("AUDIO " + name + " " + hex(h));
      total = fnv(new TextEncoder().encode(hex(h)), total);
      n++;
    });
    // the two pieces of app state render() reads: normalize off, and an imported sample (wave 9)
    const keepN = normalizeOut, keepS = sampleBuf;
    try {
      normalizeOut = false;
      names.slice(0, 40).forEach(function (name) {
        const r = withState(PRESETS[name], function () { return render(); });
        const h = fnv(f32(r.R), fnv(f32(r.L)));
        say("AUDIO nonorm:" + name + " " + hex(h));
        total = fnv(new TextEncoder().encode(hex(h)), total); n++;
      });
      normalizeOut = true;
      const s = new Float32Array(22050);
      for (let k = 0; k < s.length; k++) s[k] = Math.sin(k * 0.05) * Math.exp(-k / 8000);
      sampleBuf = s;
      [{ wave: 9, duration: 0.5 }, { wave: 9, duration: 0.5, cutoff: 900, drive: 0.4 }].forEach(function (p, j) {
        const r = withState(p, function () { return render(); });
        const h = fnv(f32(r.R), fnv(f32(r.L)));
        say("AUDIO sample:" + j + " " + hex(h));
        total = fnv(new TextEncoder().encode(hex(h)), total); n++;
      });
    } finally { normalizeOut = keepN; sampleBuf = keepS; }
    say("AUDIONAN " + nan);
    say("AUDIOHASH " + hex(total) + " over " + n);
    extended();
  } catch (e) { say("AUDIOFAIL threw: " + e + " " + (e.stack || "")); }

  // SFX 1.3: MORE COVERAGE, under its own total so every line above (the v1.2 proof) stays exactly as it was. What a
  // preset render never reaches: a loaded custom IR, granular over a sample, a variation pack's .tres and zip BYTES, and
  // Breed / Variations output. Breed and Variations draw from Math.random (unseeded in the app, on purpose); here
  // Math.random is swapped for a fixed LCG for the duration, so the same code makes the same children and any change
  // to what they draw, or how they draw it, moves a line. The app's own behavior is untouched.
  function extended() {
    let tot = null, m = 0;
    const line = function (name, h) { say("AUDIO x:" + name + " " + hex(h)); tot = fnv(new TextEncoder().encode(hex(h)), tot); m++; };
    const pcm = function (r) { return fnv(f32(r.R), fnv(f32(r.L))); };
    const keepN = normalizeOut, keepS = sampleBuf, keepIR = customIR, keepRand = Math.random, keepName = varNameEl.value;
    const keepVar = varGenomes, keepSeq = sequence;
    try {
      // a loaded impulse response (the app's own prepareIR: trim + normalize), convolved through render()
      const irL = new Float32Array(9000), irR = new Float32Array(9000);
      for (let k = 0; k < irL.length; k++) { const e = Math.exp(-k / 1800); irL[k] = Math.sin(k * 0.31) * e; irR[k] = Math.sin(k * 0.29 + 1) * e; }
      customIR = prepareIR(irL, irR, 4);   // (set as the app does on Load IR, so the same lines prove the code before 1.3)
      ["Coin", "Laser", "Explosion"].forEach(function (name) {
        [1, 0.4].forEach(function (tone) {
          line("ir:" + name + ":" + tone, pcm(withState(Object.assign({}, PRESETS[name], { convType: 4, convMix: 0.45, convTone: tone }), render)));
        });
      });
      // granular over an imported sample (wave 11 reads sampleBuf as its source)
      const smp = new Float32Array(30000);
      for (let k = 0; k < smp.length; k++) smp[k] = Math.sin(k * 0.021 + Math.sin(k * 0.0007) * 3) * (0.5 + 0.5 * Math.cos(k * 0.0003));
      customIR = keepIR;
      sampleBuf = smp;
      [{ wave: 11, duration: 0.8 }, { wave: 11, duration: 0.8, grainSpray: 0.4, grainSpread: 0.3, grainSize: 60, grainDensity: 40 }].forEach(function (pt, j) {
        line("granular-sample:" + j, pcm(withState(pt, render)));
      });
      sampleBuf = keepS;
      // Breed and Variations under a fixed seed (parents: an oscillator, a speech sound, a drawn wave)
      let rs = 0x5eedf00d;
      Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
      const drawn = new Float32Array(256);
      for (let k = 0; k < 256; k++) drawn[k] = k < 128 ? k / 64 - 1 : Math.sin(k * 0.2);
      const parents = [
        Object.assign({}, PRESETS["Laser"]),
        { wave: 17, speechText: "game over", duration: 0.9 },
        { wave: 12, customWave: customWaveToB64(drawn), duration: 0.4 },
      ].map(function (p) { return withState(p, genomeFromState); });
      parents.forEach(function (p, j) {
        const child = breedChild([p], BREED_AMT);
        line("breed:" + j, fnv(new TextEncoder().encode(JSON.stringify(child)), pcm(withState(child, render))));
      });
      const crossed = breedChild([parents[0], parents[1], parents[2]], BREED_AMT);
      line("breed:cross", fnv(new TextEncoder().encode(JSON.stringify(crossed)), pcm(withState(crossed, render))));
      normalizeOut = true;
      varGenomes = makeVariations(parents[0], 4, 0.2);
      sequence = [];
      varGenomes.forEach(function (g, j) { line("vary:" + j, fnv(new TextEncoder().encode(JSON.stringify(g)), pcm(withState(g, render)))); });
      // the pack: its .tres text and the whole zip, byte for byte (WAVs, hit.tres, README with each take's link)
      varNameEl.value = "hit";
      const files = buildPackFiles(), zf = packZipFiles(files);
      line("pack:tres", fnv(new TextEncoder().encode(packTres(files))));
      line("pack:zip", fnv(makeZip(zf)));
      // SFX 1.3 LAYERS (appended): a three-layer sound (Laser over an Explosion 20 ms in, 5 semitones down, and a Coin at
      // 100 ms), the same with the Coin muted, with Normalize off, and two layers of one noisy engine (their noise differs)
      normalizeOut = true;
      const lay = function (list) { return Object.assign({}, PRESETS["Laser"], { layers: JSON.stringify(list) }); };
      const three = [{ s: PRESETS["Explosion"], d: 0.02, g: 0.6, p: -5 }, { s: PRESETS["Coin"], d: 0.1, g: 0.5, p: 0 }];
      line("layers:three", pcm(withState(lay(three), render)));
      line("layers:muted", pcm(withState(lay([three[0], Object.assign({}, three[1], { m: 1 })]), render)));
      normalizeOut = false;
      line("layers:no-normalize", pcm(withState(lay(three), render)));
      normalizeOut = true;
      line("layers:same-engine", pcm(withState(Object.assign({}, PRESETS["Explosion"], { layers: JSON.stringify([{ s: PRESETS["Explosion"], d: 0, g: 1, p: 0 }]) }), render)));
      // SFX 1.3 THE WIZARD (appended): three answers' nine, seeded; each line hashes the nine sounds' settings and audio
      [[{ kind: "gunshot", mats: ["metal"], era: "Generic", power: 5 }, "gunshot-metal"], [{ kind: "explosion", mats: ["fire", "stone"], era: "8-Bit", power: 9 }, "explosion-fire-stone-8bit-9"],
       [{ kind: "pickup", mats: [], era: "Generic", power: 1 }, "pickup-1"]].forEach(function (q) {
        let h = null;
        wizNine(q[0], 1).forEach(function (c) { const snd = wizSound(c); h = fnv(new TextEncoder().encode(JSON.stringify(snd)), h); h = fnv(f32(withState(snd, render).L), h); });
        line("wizard:" + q[1], h);
      });
    } finally {
      Math.random = keepRand; normalizeOut = keepN; sampleBuf = keepS; customIR = keepIR;
      varNameEl.value = keepName; varGenomes = keepVar; sequence = keepSeq;
    }
    say("AUDIOXHASH " + hex(tot) + " over " + m);
  }
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:0;top:0;right:0;z-index:99999;background:#060;color:#fff;font:14px monospace;padding:8px;white-space:pre-wrap";
  d.textContent = out.filter(function (l) { return !/^AUDIO /.test(l); }).join("\n");
  document.body.appendChild(d);
})();
