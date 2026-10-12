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
  } catch (e) { say("AUDIOFAIL threw: " + e + " " + (e.stack || "")); }
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:0;top:0;right:0;z-index:99999;background:#060;color:#fff;font:14px monospace;padding:8px;white-space:pre-wrap";
  d.textContent = out.filter(function (l) { return !/^AUDIO /.test(l); }).join("\n");
  document.body.appendChild(d);
})();
