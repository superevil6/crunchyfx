"use strict";
// CrunchySFX — the page half of tests/godot-pack.mjs: inside the real index.html (the web build), make a VARIATION PACK
// the way a person does (a preset, Variations, a name) and dump every file of its zip (the takes, the .tres, the README).
(function () {
  try {
    if (typeof endTour === "function") endTour(false);
    applyPreset(PRESETS["Coin"] || PRESETS[Object.keys(PRESETS)[9]], "Coin pickup");
    varNameEl.value = "hit";
    varCountEl.value = "6";
    seedVariations();
    const files = packZipFiles(buildPackFiles());
    for (const f of files) {
      let bin = "";
      for (let i = 0; i < f.data.length; i += 8192) bin += String.fromCharCode.apply(null, f.data.subarray(i, i + 8192));
      dump("PACKFILE " + f.name + " " + btoa(bin) + "\n");
    }
    dump("PACKDONE " + files.length + "\n");
  } catch (e) { dump("PACKERROR " + (e && e.stack || e) + "\n"); }
})();
