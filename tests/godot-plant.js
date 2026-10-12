"use strict";
// CrunchySFX — the page half of tests/godot-check.mjs: inside the real index.html with the mocked Tauri disk, plant a
// few sounds the way a person does (Plant in a folder…, Save), in several export formats, one of them looping, then
// dump every file the planted Library wrote, so the Node half can put them into a REAL Godot project.
(async function () {
  const M = window.__TAURI__.__mock, GODOT = "/home/aj/godot-game";
  const settle = async function () { for (let i = 0; i < 8; i++) { await null; await projQueue; } };
  const fmt = function (rate, depth, ch, loop) {
    [["fmtRate", rate], ["fmtDepth", depth], ["fmtChannels", ch]].forEach(function (x) { const el = document.getElementById(x[0]); el.value = String(x[1]); el.dispatchEvent(new Event("change")); });
    const l = document.getElementById("fmtLoop"); l.checked = loop; l.dispatchEvent(new Event("change"));
  };
  try {
    if (typeof endTour === "function") endTour(false);
    await settle();
    M.answer(GODOT);
    await projDo(projPlantPick);
    const plan = [["Coin", "Coin pickup", 44100, 16, 2, false], ["Laser", "Laser zap", 22050, 16, 1, false],
                  [Object.keys(PRESETS)[300], "Engine hum", 48000, 24, 2, true], [Object.keys(PRESETS)[600], "Big boom", 44100, 16, 1, true]];
    for (const p of plan) {
      fmt(p[2], p[3], p[4], p[5]);
      applyPreset(PRESETS[p[0]] || PRESETS[Object.keys(PRESETS)[9]], p[1]);
      projSave();
      await settle();
    }
    await projDo(projPlantPresets);                                   // and v1.1's My Presets (one plays recorded audio)
    await settle();
    M.list(GODOT + "/crunchy/").forEach(function (path) {
      const b = M.bytes(path);
      let bin = "";
      for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
      dump("PLANTFILE " + path.slice(GODOT.length + 1) + " " + btoa(bin) + "\n");
    });
    dump("PLANTDONE " + project.assets.length + "\n");
  } catch (e) { dump("PLANTFAIL " + e + " " + e.stack + "\n"); }
})();
