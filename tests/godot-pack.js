"use strict";
// CrunchySFX — the page half of tests/godot-pack.mjs: inside the real index.html (the web build), make a VARIATION PACK
// the way a person does (a preset, Variations, a name) and dump every file of its zip (the takes, the .tres, the README);
// then the Godot footstep set (footstepSetFiles), every file.
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
    // FOOTSTEPS BY SURFACE (2026-11-01): the Godot footstep set, every file (footsteps/grass.tres, footsteps/grass/…,
    // crunchy_footsteps.gd, footsteps.tscn, README), made twice: the second must be the same bytes (it is seeded)
    const set = footstepSetFiles(), again = footstepSetFiles();
    const same = set.length === again.length && set.every(function (f, i) { const g = again[i]; return g.name === f.name && g.data.length === f.data.length && g.data.every(function (b, k) { return b === f.data[k]; }); });
    for (const f of set) {
      let bin = "";
      for (let i = 0; i < f.data.length; i += 8192) bin += String.fromCharCode.apply(null, f.data.subarray(i, i + 8192));
      dump("FOOTFILE " + f.name + " " + btoa(bin) + "\n");
    }
    const btn = document.getElementById("footstepSet");
    dump("FOOTINFO " + JSON.stringify({ same: same, surfaces: FOOTSTEP_SURFACES.map(function (s) { return s[0]; }),
      presets: FOOTSTEP_SURFACES.every(function (s) { return !!PRESETS[s[1]]; }), button: !!btn && !!btn.closest(".preset-section") && /Footsteps by surface/.test(btn.closest(".preset-section").querySelector("summary").textContent) }) + "\n");
  } catch (e) { dump("PACKERROR " + (e && e.stack || e) + "\n"); }
})();
