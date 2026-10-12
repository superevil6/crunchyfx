"use strict";
// CrunchySFX — a LOOK at the planted Library, for a screenshot in WebKit (the desktop engine): the mocked disk, a
// Godot game with a few sounds planted, v1.1's My Presets planted, one "update available", and CrunchyTile's assets
// in the suite view. No assertions (the desktop suite has those); audio output is switched off.
//   python3 tests/build.py show && python3 tests/wkshot.py "file://$PWD/tests/run-show.html" "$PWD/tests/show.png" 1600 1000 8
(async function () {
  const M = window.__TAURI__.__mock, GODOT = "/home/aj/godot-game";
  const settle = async function () { for (let i = 0; i < 8; i++) { await null; await projQueue; } };
  playBuffer = function () { return null; };                        // no audio device needed to look
  if (typeof endTour === "function") endTour(false);
  M.put(GODOT + "/crunchy/tile/meadow/meadow.crunchy", JSON.stringify({ format: "crunchy-asset", kind: "design", name: "Meadow", files: ["meadow.png"] }));
  M.put(GODOT + "/crunchy/tile/cave/cave.crunchy", JSON.stringify({ format: "crunchy-asset", kind: "design", name: "Cave", files: ["cave.png"] }));
  M.put(GODOT + "/crunchy/ui/bounty-kit/bounty-kit.crunchy", JSON.stringify({ format: "crunchy-asset", kind: "kit", name: "Bounty", files: ["kit.tres"] }));
  M.answer(GODOT);
  await projDo(projPlantPick);
  for (const p of [["Coin", "Coin pickup"], [Object.keys(PRESETS)[120], "Door creak"], [Object.keys(PRESETS)[300], "Engine hum"], [Object.keys(PRESETS)[640], "Big boom"]]) {
    applyPreset(PRESETS[p[0]], p[1]);
    projSave();
    await settle();
  }
  await projDo(projPlantPresets);
  await settle();
  const d = JSON.parse(M.text(GODOT + "/crunchy/sfx/coin-pickup/coin-pickup.crunchy"));
  d.hash = "0";
  M.put(GODOT + "/crunchy/sfx/coin-pickup/coin-pickup.crunchy", JSON.stringify(d));
  await projDo(function () { return projOpen(GODOT); });
  await settle();
  projCheckUpdatesNow();
  applyPreset(PRESETS["Coin"], "Coin pickup");
  library.open();
  projRefreshSuite();
  await settle();
  scrollTo(0, 0);
  document.title = "SHOWN";
})();
