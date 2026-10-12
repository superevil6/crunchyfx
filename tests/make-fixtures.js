"use strict";
// CrunchySFX — SAVED THINGS FROM v1.1 (the "everything keeps opening" proof). Run ONCE against the build being
// protected (it was run on HEAD 5e457cc, 2026-10-11, before the planted Library): it makes, with THAT build's own
// functions, a .crunchysfx project, the browser-store values under every legacy crunchyfx.* key, and share links, and
// records the audio each one opens to. tests/fixtures/ holds the result; regression-desktop.js and regression-web.js
// open them with the current build and compare.
//
//   python3 tests/build.py fixtures
//   p=$(mktemp -d); echo 'user_pref("browser.dom.window.dump.enabled", true);' > $p/user.js
//   firefox --headless --profile $p --screenshot "$PWD/tests/f.png" "file://$PWD/tests/run-fixtures.html" | python3 tests/save-fixtures.py
//
// Every record is one dumped line: FIXTURE <name> <json>.

(function () {
  const put = function (name, value) { dump("FIXTURE " + name + " " + JSON.stringify(value) + "\n"); };
  const audio = function (r) {                                         // the same fingerprint as audio-hash.js
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    [r.L, r.R].forEach(function (arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0; b = Math.imul(b ^ bytes[i], 0x5bd1e995) >>> 0; }
    });
    return ("00000000" + a.toString(16)).slice(-8) + ("00000000" + b.toString(16)).slice(-8);
  };
  try {
    if (typeof endTour === "function") endTour(false);
    // a drawn wave, a second one for Wave Morph, a recorded sample: deterministic
    const drawn = new Float32Array(CUSTOM_N), drawnB = new Float32Array(CUSTOM_N);
    for (let i = 0; i < CUSTOM_N; i++) { drawn[i] = Math.sin(i / CUSTOM_N * Math.PI * 2) * 0.8 + (i % 7) / 40; drawnB[i] = i < CUSTOM_N / 2 ? 0.7 : -0.7; }
    const mic = new Float32Array(11025);
    for (let i = 0; i < mic.length; i++) mic[i] = Math.sin(i * 0.031) * Math.exp(-i / 4000) * 0.9;
    const snapOf = function (patch) { return withState(patch, function () { return snapshotState(); }); };
    const sounds = [
      { name: "Coin keep", patch: PRESETS[Object.keys(PRESETS)[0]] },
      { name: "Drawn wave", patch: { wave: 12, customWave: customWaveToB64(drawn), customWaveB: customWaveToB64(drawnB), duration: 0.6, freq: 330 } },
      { name: "Robot says hi", patch: Object.assign({}, PRESETS[Object.keys(PRESETS).find(function (n) { return PRESETS[n].speechText; })]) },
      { name: "Feu ✨ laser", patch: PRESETS[Object.keys(PRESETS)[200]] },
    ];
    const ups = sounds.map(function (s, i) { return { id: i + 1, name: s.name, state: snapOf(s.patch) }; });
    ups.push({ id: 5, name: "Mic take", state: snapOf({ wave: 9, duration: 0.25, sustain: 1, attack: 0.003, decay: 0.05, release: 0.03, hold: 0 }), sample: sampleToB64(mic) });
    // the audio each saved preset renders to (with its own sample, as My Presets plays it)
    const upAudio = ups.map(function (p) {
      const prev = sampleBuf;
      if (p.sample) sampleBuf = b64ToSample(p.sample);
      try { return audio(withState(p.state, function () { return render(); })); } finally { sampleBuf = prev; }
    });
    // the legacy browser store, written by v1.1's own save functions
    userPresets = ups; upSeq = 5;
    userCats = [{ id: 1, name: "Pickups", items: [{ t: "b", n: Object.keys(PRESETS)[3] }, { t: "u", id: 1 }, { t: "u", id: 5 }] },
                { id: 2, name: "Empty one", items: [] }];
    ucSeq = 2;
    saveUserPresets(); saveUserCats();
    myWaves = [{ id: 1, name: "Bumpy", wave: customWaveToB64(drawn) }]; mwSeq = 1; saveMyWaves();
    prefs.promptPresetSave = true; prefs.checkUpdates = false; prefs.tourSeen = true; prefs.scopeMode = "xy"; prefs.hideBrowser = false;
    prefs.collapsed = { quickShape: true }; savePrefs();
    applyPreset(PRESETS[Object.keys(PRESETS)[10]], "History one");
    applyPreset(PRESETS[Object.keys(PRESETS)[11]], "History two");
    const store = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^crunchyfx\./.test(k)) store[k] = localStorage.getItem(k); }
    put("localStorage", { store: store, upAudio: upAudio });

    // a project file, as Save project writes it (buildProject is what saveProject serialises)
    applyPreset(PRESETS[Object.keys(PRESETS)[42]], "Editor sound");
    sequence = [{ genome: genomeFromState(), label: "Step one" }, { genome: snapOf(sounds[1].patch), label: "Step two" }];
    const proj = buildProject();
    const editorAudio = audio(render());
    put("project", { file: JSON.stringify(proj), editorAudio: editorAudio, label: seqLabel, seqAudio: audio(renderSequenceBuffers()) });

    // share links: the editor's encodePatch, and the audio loadSharedSound opens to
    const links = [];
    const linkOf = function (patch, label, norm, nameArg) {
      applyPreset(patch, label);
      normalizeOut = norm; updateNormBtn();
      const enc = encodePatch(nameArg);
      const a = audio(render());
      normalizeOut = true; updateNormBtn();
      links.push({ enc: enc, audio: a, label: label });
    };
    linkOf(PRESETS[Object.keys(PRESETS)[5]], "Plain", true);
    linkOf(sounds[1].patch, "Drawn", true);
    linkOf(sounds[2].patch, "Speech", true);
    linkOf(PRESETS[Object.keys(PRESETS)[300]], "Quiet one", false);
    linkOf(PRESETS[Object.keys(PRESETS)[400]], "Named", true, "Feu ✨ 日本");
    riffSetPatch({ p: [60, null, 64, 67, null, 72, null, null], bpm: 150 });
    const enc = encodePatch("With riff");
    links.push({ enc: enc, audio: audio(render()), label: "With riff", riff: riffGetPatch() });
    put("links", links);
    put("done", { build: "HEAD", presets: Object.keys(PRESETS).length });
  } catch (e) { dump("FIXTURE error " + JSON.stringify(String(e) + " " + e.stack) + "\n"); }
})();
