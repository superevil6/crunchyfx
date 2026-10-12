"use strict";
// CrunchySFX — THE DESKTOP SUITE (the planted Library, crunchyCore plant.js; crunchyTile's tests/regression-desktop.js
// is the model). Runs INSIDE the real index.html with window.__TAURI__ mocked (tests/tauri-mock.js, an in-memory disk)
// and the browser store seeded EXACTLY as CrunchySFX v1.1 left it (tests/fixtures/v1.1.js, seed-v11.js).
//
//   python3 tests/build.py desktop
//   firefox --headless --profile "$(mktemp -d)" --window-size=1400,900 \
//           --screenshot "$PWD/tests/desktop.png" "file://$PWD/tests/run-desktop.html"      # ?show: ends with the Library open
//
// ASYNC: every planted action is file work on a queue (projDo). MICROTASKS ONLY (never setTimeout), so the whole
// suite finishes before the load event and Firefox's --screenshot shows the result, not "running…".

(async function () {
  const rows = [], M = window.__TAURI__.__mock, V = window.SFX_V11;
  const GODOT = "/home/aj/godot-game", UNITY = "/home/aj/unity-game", PLAIN = "/home/aj/plain";
  const ROOT = GODOT + "/crunchy/sfx";
  async function t(name, fn) {
    let pass = false, detail = "";
    try {
      const r = await fn();
      if (r === true || r === undefined) pass = true;
      else if (typeof r === "string") detail = r;
      else { pass = !!r.pass; detail = r.detail || ""; }
    } catch (e) { detail = "threw: " + (e && e.message ? e.message : e) + " " + String(e && e.stack || "").split("\n")[1]; }
    rows.push({ name: name, pass: pass, detail: detail });
  }
  const ok = function (p, d) { return { pass: !!p, detail: p ? "" : (d || "") }; };
  const shown = function (el) { return !!el && el.getClientRects().length > 0; };
  async function settle() { for (let i = 0; i < 8; i++) { await null; await projQueue; } }
  const lib = function () { return library.root(); };
  const libButton = function (re) {
    return Array.from(lib().querySelectorAll("button")).find(function (b) { return typeof re === "string" ? b.textContent === re : re.test(b.textContent); });
  };
  const card = function (name) {
    return Array.from(lib().querySelectorAll(".lib-card")).find(function (c) { return c.querySelector(".lib-name") && c.querySelector(".lib-name").textContent === name; });
  };
  const cardButton = function (name, text) {
    const c = card(name);
    return c && Array.from(c.querySelectorAll(".lib-acts button")).find(function (b) { return b.textContent === text || b.textContent === "Really?"; });
  };
  const status = function () { return document.getElementById("plantMsg").textContent; };
  const side = function (root, slug) { return JSON.parse(M.text(root + "/" + slug + "/" + slug + ".crunchy") || "null"); };
  const sidecar = function (slug) { return side(ROOT, slug); };
  const same = function (a, b) { return !!a && !!b && a.length === b.length && a.every(function (x, i) { return x === b[i]; }); };
  // the fingerprint tests/make-fixtures.js recorded v1.1's audio with
  const audio = function (r) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    [r.L, r.R].forEach(function (arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0; b = Math.imul(b ^ bytes[i], 0x5bd1e995) >>> 0; }
    });
    return ("00000000" + a.toString(16)).slice(-8) + ("00000000" + b.toString(16)).slice(-8);
  };
  // a WAV's chunks, by id (RIFF/WAVE), to compare two files but for one chunk
  const chunks = function (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {};
    for (let o = 12; o + 8 <= bytes.length;) {
      const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]), n = dv.getUint32(o + 4, true);
      out[id] = bytes.subarray(o + 8, o + 8 + n);
      o += 8 + n + (n & 1);
    }
    return out;
  };
  const store = function () {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^crunchyfx\./.test(k)) o[k] = localStorage.getItem(k); }
    return o;
  };
  const LEGACY = ["crunchyfx.userpresets.v1", "crunchyfx.usercats.v1", "crunchyfx.mywaves.v1"];
  const legacyNow = function () { return LEGACY.map(function (k) { return localStorage.getItem(k); }).join("\u0000"); };
  if (typeof endTour === "function") endTour(false);
  await settle();
  const atBoot = legacyNow();

  // ---- the gate, and v1.1's saved things as this build boots with them ----
  await t("gate/desktop-controls-and-no-web-button", function () {
    return ok(isDesktop && shown(document.getElementById("libraryBtn")) && shown(document.getElementById("mypresets")) &&
              document.getElementById("projSave") && document.getElementById("projOpen") && !document.querySelector(".desk-cta") && !document.querySelector(".desk-overlay"));
  });
  await t("legacy/the-v1.1-store-is-read-as-it-was", function () {
    const want = JSON.parse(V.localStorage.store["crunchyfx.userpresets.v1"]).items, cats = JSON.parse(V.localStorage.store["crunchyfx.usercats.v1"]).cats;
    return ok(atBoot === LEGACY.map(function (k) { return V.localStorage.store[k]; }).join("\u0000") &&
              JSON.stringify(userPresets) === JSON.stringify(want) && JSON.stringify(userCats) === JSON.stringify(cats) &&
              myWaves.length === 1 && myWaves[0].name === "Bumpy" && prefs.promptPresetSave === true && prefs.checkUpdates === false &&
              scopeMode === "xy" && histItems.length === 2 && document.querySelectorAll("#mpList .up-item").length === 5,
              userPresets.length + " " + histItems.length + " " + scopeMode);
  });
  await t("legacy/my-presets-render-the-v1.1-audio", function () {
    const got = userPresets.map(function (p) {
      const prev = sampleBuf;
      if (p.sample) sampleBuf = b64ToSample(p.sample);
      try { return audio(withState(p.state, function () { return render(); })); } finally { sampleBuf = prev; }
    });
    return ok(JSON.stringify(got) === JSON.stringify(V.localStorage.upAudio), got.join(","));
  });

  // ---- Settings: the core's dialog, every old preference ----
  await t("settings/the-core-dialog-with-every-old-row", function () {
    document.getElementById("settingsBtn").click();
    const root = document.getElementById("setModal");
    const labels = Array.from(root.querySelectorAll(".setlbl")).map(function (l) { return l.firstChild.textContent; });
    const fmt = root.querySelector("#settingsFmtRow #fmtRate") && root.querySelector("#fmtDepth") && root.querySelector("#fmtChannels") && root.querySelector("#fmtLoop");
    return ok(root.classList.contains("set-overlay") && !root.hidden && fmt && root.querySelector("#updMsg") &&
              root.querySelector("#prefNormalize").checked === true && root.querySelector("#prefPromptSave").checked === true &&
              root.querySelector("#prefCheckUpdates").checked === false &&
              labels.join("|") === "Export format|Normalize loudness|Getting started|Prompt on preset save|Check for updates on launch|Updates" &&
              !document.querySelector(".settings-box"), labels.join("|"));
  });
  await t("settings/each-preference-still-works-and-keeps-its-key", function () {
    const root = document.getElementById("setModal"), before = localStorage.getItem("crunchyfx.prefs.v1");
    const ps = root.querySelector("#prefPromptSave"), cu = root.querySelector("#prefCheckUpdates"), nz = root.querySelector("#prefNormalize");
    ps.click(); const p1 = JSON.parse(localStorage.getItem("crunchyfx.prefs.v1")).promptPresetSave === false && prefs.promptPresetSave === false;
    ps.click();
    cu.click(); const c1 = JSON.parse(localStorage.getItem("crunchyfx.prefs.v1")).checkUpdates === true;
    cu.click();
    nz.click(); const n1 = normalizeOut === false && /Normalize off/.test(normBtn.textContent);
    nz.click(); const n2 = normalizeOut === true;
    const rate = root.querySelector("#fmtRate");
    rate.value = "22050"; rate.dispatchEvent(new Event("change")); const r1 = exportFmt.rate === 22050;
    rate.value = "44100"; rate.dispatchEvent(new Event("change"));
    const after = localStorage.getItem("crunchyfx.prefs.v1");
    settingsDialog.close();
    return ok(p1 && c1 && n1 && n2 && r1 && exportFmt.rate === 44100 && after === before && root.hidden, before + " → " + after);
  });
  await t("settings/a-share-link-turning-normalize-off-shows-in-the-row", function () {
    loadSharedSound("?s=" + V.links[3].enc);                       // "Quiet one" was linked with normalize off
    settingsDialog.open();
    const off = document.getElementById("prefNormalize").checked === false;
    settingsDialog.close();
    normalizeOut = true; updateNormBtn();
    return ok(off);
  });

  // ---- the docked panel, planting ----
  await t("dock/a-docked-panel-with-the-start-screen", function () {
    document.getElementById("libraryBtn").click();
    const r = lib();
    return ok(library.isOpen() && r.classList.contains("lib-dock") && r.parentElement.id === "libDock" && shown(document.getElementById("libDock")) &&
              libButton("Plant in a folder…") && !r.querySelector(".lib-grid") && /Plant CrunchySFX in your game/.test(r.textContent) &&
              getComputedStyle(document.body).paddingRight === "680px", getComputedStyle(document.body).paddingRight);
  });
  await t("plant/a-godot-project-writes-nothing-yet-and-offers-my-presets", async function () {
    M.answer(GODOT);
    libButton("Plant in a folder…").click();
    await settle();
    return ok(project && project.engine === "godot" && project.rel === "crunchy/sfx" && !M.list(GODOT + "/crunchy").length &&
              document.getElementById("plantWhere").textContent === "Planted in godot-game" && !document.getElementById("plantSave").disabled &&
              /My Presets hold 5 sounds/.test(status()) && libButton("Plant my presets (5)") && /Nothing planted yet/.test(lib().querySelector(".lib-grid").textContent), status());
  });
  await t("save/a-sound-is-its-wav-and-a-sidecar", async function () {
    applyPreset(PRESETS["Coin"], "Coin");
    const box = document.getElementById("plantName").value;
    document.getElementById("plantSave").click();
    await settle();
    const d = sidecar("coin");
    return ok(box === "Coin" && d && d.format === "crunchy-asset" && d.app === "crunchysfx" && d.suite === "sfx" && d.kind === "sound" && d.name === "Coin" &&
              d.s === encodePatch("Coin") && d.exportName === "Coin" && d.wav === "coin.wav" && JSON.stringify(d.files) === '["coin.wav"]' &&
              JSON.stringify(d.fmt) === JSON.stringify(fmtNow()) && d.peaks.length === 96 && M.files.has(ROOT + "/coin/coin.wav") &&
              /res:\/\/crunchy\/sfx\/coin\/coin\.wav/.test(status()) && d.hash === plantHash([{ path: "coin.wav", data: M.bytes(ROOT + "/coin/coin.wav") }]), status());
  });
  await t("save/the-wav-is-byte-equal-to-export-wav", async function () {
    const planted = M.bytes(ROOT + "/coin/coin.wav");
    // Export WAV's own write (downloadWav through the native Save dialog), under the planted title
    M.answerSave("/home/aj/Downloads/same.wav");
    const r = render();
    await downloadWav(r.L, r.R, "coin.wav", "Coin");
    const viaExport = M.bytes("/home/aj/Downloads/same.wav");
    // and the Export WAV BUTTON: identical but for its title (it names the file crunchysfx-<time>), chunk for chunk
    M.answerSave("/home/aj/Downloads/button.wav");
    document.getElementById("export").click();
    await settle();
    const btn = chunks(M.bytes("/home/aj/Downloads/button.wav")), pl = chunks(planted);
    const others = Object.keys(pl).filter(function (k) { return k !== "LIST"; });
    return ok(same(planted, viaExport) && others.length >= 2 && others.every(function (k) { return same(pl[k], btn[k]); }) && Object.keys(btn).join() === Object.keys(pl).join(),
              planted.length + " vs " + (viaExport && viaExport.length) + " " + Object.keys(btn).join());
  });
  await t("save/other-formats-and-a-sampled-sound-byte-equal", async function () {
    const s = new Float32Array(9000);
    for (let i = 0; i < s.length; i++) s[i] = Math.sin(i * 0.07) * Math.exp(-i / 3000) * 0.8 + 1e-7 * (i % 3);
    applyPreset({ wave: 9, duration: 0.3, sustain: 1, attack: 0.003, decay: 0.05, release: 0.03, hold: 0 }, "Boom take");
    sampleBuf = s; sampleName = "boom";
    ["fmtRate", "fmtDepth", "fmtChannels"].forEach(function (id, i) { const el = document.getElementById(id); el.value = ["48000", "24", "1"][i]; el.dispatchEvent(new Event("change")); });
    const loop = document.getElementById("fmtLoop"); loop.checked = true; loop.dispatchEvent(new Event("change"));
    document.getElementById("plantSave").click();
    await settle();
    const d = sidecar("boom-take");
    M.answerSave("/home/aj/Downloads/boom.wav");
    const r = render();
    await downloadWav(r.L, r.R, "boom.wav", "Boom take");
    const eq = same(M.bytes(ROOT + "/boom-take/boom-take.wav"), M.bytes("/home/aj/Downloads/boom.wav"));
    ["fmtRate", "fmtDepth", "fmtChannels"].forEach(function (id, i) { const el = document.getElementById(id); el.value = ["44100", "16", "2"][i]; el.dispatchEvent(new Event("change")); });
    loop.checked = false; loop.dispatchEvent(new Event("change"));
    return ok(d && typeof d.sampleF32 === "string" && !d.sample && d.fmt.rate === 48000 && d.fmt.depth === 24 && d.fmt.channels === 1 && d.fmt.loop === true &&
              same(b64ToF32(d.sampleF32), s) && eq, JSON.stringify(d && d.fmt));
  });
  // SAVE NEVER OVERWRITES (crunchyCore plant.js 5; AJ, 2026-10-12): a taken name gets the next number, and only a card's
  // Replace updates a sound. Each row removes its extra sound and makes the update the old row made, by Replace, so the
  // rows after see the same folder as before.
  const dropSound = async function (name) {
    await projDo(async function () { await plantDelete(project, plantFind(project, "sound", name)); });
    projAfter(); await settle();
  };
  const replaceCard = async function (name) {
    cardButton(name, "Replace").click();
    const c = cardButton(name, "Replace");
    if (c && /Really/.test(c.textContent)) c.click();
    await settle();
  };
  await t("save/the-sound-opened-from-saves-as-a-new-one", async function () {
    card("Coin").querySelector(".lib-pic").click();
    await settle();
    state.freq = state.freq * 1.5;
    const was = M.text(ROOT + "/coin/coin.crunchy");
    document.getElementById("plantSave").click();
    await settle();
    const two = sidecar("coin-2");
    const pass = M.text(ROOT + "/coin/coin.crunchy") === was && two && two.s === encodePatch("Coin 2") && /“Coin” was taken/.test(status()) &&
                 document.getElementById("plantName").value === "Coin 2";
    const msg = status();
    await dropSound("Coin 2");
    document.getElementById("plantName").value = "Coin";
    await replaceCard("Coin");                                  // the update, the way it is made now
    const d = sidecar("coin");
    return ok(pass && d.s === encodePatch("Coin") && project.assets.length === 2 && /Replaced Coin/.test(status()), msg + " / " + status());
  });
  await t("save/a-taken-name-gets-the-next-number", async function () {
    applyPreset(PRESETS["Laser"] || PRESETS[Object.keys(PRESETS)[7]], "Laser");
    document.getElementById("plantName").value = "Coin";
    const was = M.text(ROOT + "/coin/coin.crunchy");
    document.getElementById("plantSave").click();
    await settle();
    const pass = M.text(ROOT + "/coin/coin.crunchy") === was && !!sidecar("coin-2");
    const msg = status();
    await dropSound("Coin 2");
    document.getElementById("plantName").value = "Coin";
    await replaceCard("Coin");
    const d = sidecar("coin");
    return ok(pass && d.s === encodePatch("Coin") && d.exportName === "Coin" && /Replaced Coin/.test(status()), msg + " / " + status());
  });
  await t("save/ctrl-s-saves-and-save-preset-goes-to-the-library-not-the-browser", async function () {
    applyPreset(PRESETS[Object.keys(PRESETS)[20]], "Ctrl one");
    dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    await settle();
    const viaKey = !!sidecar("ctrl-one");
    applyPreset(PRESETS[Object.keys(PRESETS)[21]], "Button one");
    M.answerSave("/home/aj/Downloads/button-one.json");            // Save preset still writes its .json (Prompt on save is on)
    document.getElementById("save").click();
    await settle();
    return ok(viaKey && !!sidecar("button-one") && legacyNow() === atBoot && userPresets.length === 5 &&
              /Saved to the Library/.test(document.getElementById("save").textContent) && M.files.has("/home/aj/Downloads/button-one.json"), status());
  });
  await t("library/cards-with-a-waveform-badges-and-a-heading", function () {
    const c = card("Coin"), cv = c && c.querySelector("canvas");
    const b = card("Boom take") && Array.from(card("Boom take").querySelectorAll(".lib-badge")).map(function (x) { return x.textContent; });
    return ok(c && cv.width === 192 && cv.height === 64 && b && b.indexOf("48 kHz · 24-bit · mono · loop") >= 0 && b.indexOf("♪ audio") >= 0 &&
              Array.from(lib().querySelectorAll(".lib-h")).some(function (h) { return /^Sounds \(4\)/.test(h.textContent); }), JSON.stringify(b));
  });
  await t("library/play-hears-it-without-touching-the-editor", function () {
    const before = encodePatch("x"), buf = sampleBuf;
    cardButton("Boom take", "▶ Play").click();
    return ok(encodePatch("x") === before && sampleBuf === buf);
  });

  // ---- keeping it current ----
  await t("update/a-changed-export-is-marked-and-update-all-fixes-it", async function () {
    const d = sidecar("coin"), wav = M.bytes(ROOT + "/coin/coin.wav");
    d.hash = "0000000000000000";                                    // as if an older CrunchySFX had exported it
    M.put(ROOT + "/coin/coin.crunchy", JSON.stringify(d));
    await projDo(function () { return projOpen(GODOT); });
    await settle();
    projCheckUpdatesNow();
    const badge = Array.from(card("Coin").querySelectorAll(".lib-badge.hot")).some(function (b) { return /update available/.test(b.textContent); });
    const others = Array.from(lib().querySelectorAll(".lib-badge.hot")).length === 1;
    const btn = libButton("Update all (1)");
    const screen = encodePatch("x");
    btn.click();
    await settle();
    projCheckUpdatesNow();
    const fixed = sidecar("coin").hash === plantHash([{ path: "coin.wav", data: wav }]) && !card("Coin").querySelector(".lib-badge.hot") && !libButton("Update all (1)");
    return ok(badge && others && btn && fixed && same(M.bytes(ROOT + "/coin/coin.wav"), wav) && encodePatch("x") === screen, status());
  });
  // AJ, 2026-10-12: a card's Play must be stoppable: it reads Stop while that sound plays
  await t("card/play-turns-into-stop-and-stops", async function () {
    const play = cardButton("Coin", "▶ Play");
    play.click();
    await settle();                                                 // the Library runs a card's action a tick later
    const stop = cardButton("Coin", "■ Stop"), playing = !!projAudition;
    if (!stop) return ok(false, JSON.stringify({ playing: playing, open: library.isOpen(), buttons: card("Coin") ? Array.from(card("Coin").querySelectorAll(".lib-acts button")).map(function (b) { return b.textContent; }) : "no card" }));
    stop.click();
    await settle();
    return ok(play && stop && playing && !projAudition && !!cardButton("Coin", "▶ Play"));
  });
  await t("card/re-export-shows-only-with-an-update", async function () {
    const before = !cardButton("Coin", "Re-export");                // up to date: no Re-export on the card
    const d = sidecar("coin");
    d.hash = "0000000000000000";
    M.put(ROOT + "/coin/coin.crunchy", JSON.stringify(d));
    await projDo(function () { return projOpen(GODOT); });
    await settle();
    projCheckUpdatesNow();
    const shown = !!cardButton("Coin", "Re-export");
    M.put(ROOT + "/coin/coin.wav", new Uint8Array([1, 2, 3]));     // a file someone broke by hand, too
    cardButton("Coin", "Re-export").click();
    await settle();
    projCheckUpdatesNow();
    return ok(before && shown && M.bytes(ROOT + "/coin/coin.wav").length > 1000 && /Re-exported Coin in place/.test(status()) && !cardButton("Coin", "Re-export"), status());
  });
  await t("card/replace-puts-the-editor-sound-into-the-card", async function () {
    // load a sound that is really DIFFERENT from the card's (the first try may render the same as it)
    let other = null;
    for (const k of Object.keys(PRESETS)) {
      if (/coin/i.test(k)) continue;
      applyPreset(PRESETS[k], k);
      sampleBuf = null;
      if (editorFields("Coin").s !== sidecar("coin").s) { other = k; break; }
    }
    const was = M.bytes(ROOT + "/coin/coin.wav"), wav0 = sidecar("coin").wav, s0 = sidecar("coin").s;
    cardButton("Coin", "Replace").click();
    await settle();
    const armed = /Really/.test(cardButton("Coin", "Replace").textContent) && same(M.bytes(ROOT + "/coin/coin.wav"), was);
    cardButton("Coin", "Replace").click();
    await settle();
    const d = sidecar("coin"), want = editorFields("Coin");
    return ok(armed && d.name === "Coin" && d.wav === wav0 && d.s === want.s && !same(M.bytes(ROOT + "/coin/coin.wav"), was) &&
              /Replaced Coin with the editor's sound/.test(status()) && s0 !== d.s,
              JSON.stringify({ armed: armed, wav: d.wav === wav0, s: d.s === want.s, changed: !same(M.bytes(ROOT + "/coin/coin.wav"), was), other: other }));
  });

  // ---- open, rename, duplicate, delete ----
  await t("open/a-card-reopens-the-sound-exactly", async function () {
    applyPreset(PRESETS["Coin"], "Something else");
    sampleBuf = null;
    card("Boom take").querySelector(".lib-pic").click();
    await settle();
    const d = sidecar("boom-take"), r = render();
    return ok(seqLabel === "Boom take" && document.getElementById("plantName").value === "Boom take" && same(sampleBuf, b64ToF32(d.sampleF32)) &&
              exportFmt.rate === 48000 && exportFmt.channels === 1 && exportFmt.loop === true &&
              same(soundWav(r, d.fmt, d.exportName), M.bytes(ROOT + "/boom-take/boom-take.wav")) && /Opened Boom take/.test(status()), status());
  });
  await t("open/replace-keeps-the-same-file-byte-for-byte", async function () {
    const before = M.bytes(ROOT + "/boom-take/boom-take.wav");
    await replaceCard("Boom take");
    ["fmtRate", "fmtDepth", "fmtChannels"].forEach(function (id, i) { const el = document.getElementById(id); el.value = ["44100", "16", "2"][i]; el.dispatchEvent(new Event("change")); });
    const loop = document.getElementById("fmtLoop"); loop.checked = false; loop.dispatchEvent(new Event("change"));
    return ok(same(before, M.bytes(ROOT + "/boom-take/boom-take.wav")) && /Replaced Boom take/.test(status()), status());
  });
  await t("rename/the-name-only-the-path-and-bytes-stay", async function () {
    const before = M.list(ROOT + "/coin/"), wav = M.bytes(ROOT + "/coin/coin.wav");
    card("Coin").querySelector(".lib-name").dispatchEvent(new MouseEvent("dblclick"));
    const input = lib().querySelector(".lib-rename");
    input.value = "Coin pickup";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await settle();
    const d = sidecar("coin");
    card("Coin pickup").querySelector(".lib-pic").click();
    await settle();
    document.getElementById("plantSave").click();                   // saving it under its new name: same folder, same file
    await settle();
    return ok(d.name === "Coin pickup" && d.exportName === "Coin" && d.wav === "coin.wav" && !M.dirs.has(ROOT + "/coin-pickup") &&
              M.list(ROOT + "/coin/").join("|") === before.join("|") && same(M.bytes(ROOT + "/coin/coin.wav"), wav) && sidecar("coin").name === "Coin pickup", status());
  });
  await t("duplicate/a-copy-in-its-own-folder", async function () {
    cardButton("Coin pickup", "Duplicate").click();
    await settle();
    const d = sidecar("coin-pickup-copy");
    const a = chunks(M.bytes(ROOT + "/coin-pickup-copy/coin-pickup-copy.wav")), b = chunks(M.bytes(ROOT + "/coin/coin.wav"));
    return ok(d && d.name === "Coin pickup copy" && d.exportName === "Coin pickup copy" && d.wav === "coin-pickup-copy.wav" && d.s === sidecar("coin").s &&
              same(a.data, b.data) && card("Coin pickup copy"), status());
  });
  await t("delete/two-clicks-remove-its-files-godot-import-and-folder-nothing-else", async function () {
    M.put(ROOT + "/coin-pickup-copy/coin-pickup-copy.wav.import", "[remap]\n");   // what Godot writes beside it
    const b = cardButton("Coin pickup copy", "Delete");
    b.click();
    const armed = /Really/.test(b.textContent) && !!sidecar("coin-pickup-copy");
    cardButton("Coin pickup copy", "Delete").click();
    await settle();
    const gone = !M.list(ROOT + "/coin-pickup-copy/").length && !M.dirs.has(ROOT + "/coin-pickup-copy") && !card("Coin pickup copy");
    // a file of the person's own keeps the folder
    M.put(ROOT + "/ctrl-one/notes.txt", "mine");
    cardButton("Ctrl one", "Delete").click(); cardButton("Ctrl one", "Delete").click();
    await settle();
    return ok(armed && gone && M.text(ROOT + "/ctrl-one/notes.txt") === "mine" && !M.files.has(ROOT + "/ctrl-one/ctrl-one.wav") && !M.files.has(ROOT + "/ctrl-one/ctrl-one.crunchy"), status());
  });

  // ---- My Presets and .crunchysfx files: copied in, never moved ----
  await t("my-presets/plant-my-presets-copies-them-and-the-browser-store-is-byte-identical", async function () {
    const before = store();
    libButton("Plant my presets (5)").click();
    await settle();
    const after = store();
    const planted = project.assets.filter(function (a) { return /^my-presets:/.test(a.data.from || ""); });
    const byId = {};
    planted.forEach(function (a) { byId[a.data.from.slice(11)] = a; });
    // each planted sound renders to the audio v1.1's My Presets made for that preset
    const aud = userPresets.map(function (p) { return byId[p.id] ? audio(soundRender(byId[p.id].data)) : "missing"; });
    const cats = byId[1] && byId[5] && JSON.stringify(byId[1].data.categories) === '["Pickups"]' && JSON.stringify(byId[5].data.categories) === '["Pickups"]' && !byId[2].data.categories;
    return ok(planted.length === 5 && JSON.stringify(after) === JSON.stringify(before) && legacyNow() === atBoot &&
              JSON.stringify(aud) === JSON.stringify(V.localStorage.upAudio) && cats && byId[5].data.sample === userPresets[4].sample &&
              byId[4].name === "Feu ✨ laser" && !libButton(/^Plant my presets/) && /exactly as it was/.test(status()), aud.join(",") + " " + status());
  });
  await t("my-presets/planted-wavs-equal-my-presets-own-export", function () {
    const p = userPresets[4], a = project.assets.find(function (x) { return x.data.from === "my-presets:5"; });
    const prev = sampleBuf;
    sampleBuf = b64ToSample(p.sample);
    let r;
    try { r = withState(p.state, function () { return render(); }); } finally { sampleBuf = prev; }
    const want = new Uint8Array(encodeWav(r.L, r.R, { rate: a.data.fmt.rate, depth: a.data.fmt.depth, channels: a.data.fmt.channels, loop: a.data.fmt.loop, title: a.data.exportName }));
    return ok(same(want, M.bytes(ROOT + "/" + a.slug + "/" + a.data.wav)));
  });
  await t("my-presets/the-categories-make-chips-and-headings", function () {
    const chips = Array.from(lib().querySelectorAll(".lib-chip")).map(function (c) { return c.textContent; });
    return ok(chips.join("|") === "All|Pickups|Sounds", chips.join("|"));
  });
  await t("my-presets/a-second-plant-adds-nothing", async function () {
    const n = project.assets.length;
    await projDo(projPlantPresets);
    return ok(project.assets.length === n && /planted here already/.test(status()), status());
  });
  await t("project-file/plant-a-v1.1-crunchysfx-file-untouched", async function () {
    M.put("/home/aj/old.crunchysfx", V.project.file);
    const before = store(), n = project.assets.length;
    M.answer("/home/aj/old.crunchysfx");
    libButton("Plant a project file…").click();
    await settle();
    const got = project.assets.filter(function (a) { return /^file:old\.crunchysfx#/.test(a.data.from || ""); });
    return ok(got.length === 5 && project.assets.length === n + 5 && M.text("/home/aj/old.crunchysfx") === V.project.file && JSON.stringify(store()) === JSON.stringify(before) &&
              got.some(function (a) { return a.name === "Coin keep 2"; }), status());
  });
  await t("project-file/the-pre-rename-crunchyfx-app-plants-too", async function () {
    const old = JSON.parse(V.project.file);
    old.app = "crunchyfx";
    M.put("/home/aj/older.crunchyfx", JSON.stringify(old));
    M.answer("/home/aj/older.crunchyfx");
    libButton("Plant a project file…").click();
    await settle();
    return ok(project.assets.filter(function (a) { return /^file:older\.crunchyfx#/.test(a.data.from || ""); }).length === 5, status());
  });

  // ---- the suite view, copied-in web zips, other engines ----
  await t("suite/the-other-tools-in-the-same-game", async function () {
    M.put(GODOT + "/crunchy/tile/meadow/meadow.crunchy", JSON.stringify({ format: "crunchy-asset", kind: "design", name: "Meadow", files: ["meadow.png"] }));
    M.put(GODOT + "/crunchy/tile/cave/cave.crunchy", JSON.stringify({ format: "crunchy-asset", kind: "design", name: "Cave", files: ["cave.png"] }));
    projRefreshSuite();
    await settle();
    const row = lib().querySelector('.lib-suite-row[data-key="tile"]');
    row.querySelector("button").click();
    await settle();
    return ok(row && /CrunchyTile/.test(row.textContent) && /2 designs/.test(row.textContent) && /crunchy\/tile/.test(row.textContent) &&
              /^open https:\/\/crunchytile\.com\//.test(M.log[M.log.length - 1]), row ? row.textContent : "no row");
  });
  await t("web-zip/an-unzipped-variation-pack-appears-current", async function () {
    applyPreset(PRESETS["Coin"], "Coin");
    document.getElementById("varName").value = "step";
    seedVariations();
    const zipped = packZipFiles(buildPackFiles());
    zipped.forEach(function (f) { M.put(ROOT + "/" + f.name, f.data); });
    await projDo(function () { return projOpen(GODOT); });
    await settle();
    projCheckUpdatesNow();
    const steps = project.assets.filter(function (a) { return /^step \d+$/.test(a.name); });
    document.getElementById("varClose").click();
    return ok(steps.length === 8 && steps.every(function (a) { return !projUpdates[a.slug]; }) && card("step 1") && !project.skipped.length, steps.length + " " + project.skipped.join(","));
  });
  await t("unity/plants-into-assets-crunchy-sfx", async function () {
    libButton("Close").click();
    await settle();
    M.answer(UNITY);
    libButton("Plant in a folder…").click();
    await settle();
    applyPreset(PRESETS["Coin"], "Coin");
    document.getElementById("plantSave").click();
    await settle();
    const d = side(UNITY + "/Assets/Crunchy/SFX", "coin");
    const wav = M.bytes(UNITY + "/Assets/Crunchy/SFX/coin/coin.wav");
    const r = render();
    return ok(project.engine === "unity" && project.rel === "Assets/Crunchy/SFX" && d && same(wav, soundWav(r, d.fmt, "Coin")) &&
              !M.list(UNITY + "/crunchy").length && /Assets\/Crunchy\/SFX\/coin\/coin\.wav/.test(status()), status());
  });
  await t("plain/any-folder-works", async function () {
    libButton("Close").click();
    await settle();
    M.answer(PLAIN);
    libButton("Plant in a folder…").click();
    await settle();
    document.getElementById("plantSave").click();
    await settle();
    return ok(project.engine === "plain" && M.files.has(PLAIN + "/crunchy/sfx/coin/coin.wav") && !/res:\/\//.test(status()), status());
  });

  // ---- recent, close ----
  await t("recent/reopens-and-a-gone-one-is-forgotten", async function () {
    libButton("Close").click();
    await settle();
    const b = Array.from(lib().querySelectorAll(".lib-recent")).find(function (x) { return x.textContent.indexOf(GODOT) >= 0; });
    b.click();
    await settle();
    const reopened = project && project.dir === GODOT;
    localStorage.setItem(PLANT_RECENT_KEY, JSON.stringify([{ name: "gone", dir: "/home/aj/gone" }].concat(projRecent())));
    await projDo(function () { return projOpenRecent("/home/aj/gone"); });
    return ok(reopened && !projRecent().some(function (r) { return r.dir === "/home/aj/gone"; }) && /gone/.test(status()), status());
  });
  await t("close/save-preset-is-my-presets-again", async function () {
    libButton("Close").click();
    await settle();
    const n = userPresets.length;
    M.answerSave("/home/aj/Downloads/again.json");
    applyPreset(PRESETS["Coin"], "Back home");
    document.getElementById("save").click();
    await settle();
    const added = userPresets.length === n + 1 && userPresets[0].name === "Back home";
    localStorage.setItem(UP_KEY, V.localStorage.store[UP_KEY]);     // put the store back as v1.1 left it
    loadUserPresets(); renderMyPresets();
    return ok(project === null && added && legacyNow() === atBoot && document.getElementById("plantSave").disabled);
  });

  // ---- v1.1's project files and share links, through the unchanged paths ----
  await t("legacy/a-v1.1-crunchysfx-file-opens-as-it-did", async function () {
    sampleBuf = null;                                               // as when v1.1 made the fixtures
    M.answer("/home/aj/old.crunchysfx");
    document.getElementById("projOpen").click();
    await settle();
    const want = JSON.parse(V.project.file);
    return ok(audio(render()) === V.project.editorAudio && seqLabel === V.project.label && JSON.stringify(userPresets) === JSON.stringify(want.userPresets) &&
              audio(renderSequenceBuffers()) === V.project.seqAudio && sequence.length === 2);
  });
  await t("legacy/a-pre-rename-crunchyfx-file-opens-now", async function () {
    applyPreset(PRESETS["Coin"], "Not the project's");                 // so only a real load brings the project's sound back
    const away = audio(render()) !== V.project.editorAudio;
    M.answer("/home/aj/older.crunchyfx");
    document.getElementById("projOpen").click();
    await settle();
    return ok(away && audio(render()) === V.project.editorAudio && seqLabel === V.project.label);
  });
  await t("legacy/save-project-round-trips", async function () {
    M.answerSave("/home/aj/round.crunchysfx");
    document.getElementById("projSave").click();
    await settle();
    const d = JSON.parse(M.text("/home/aj/round.crunchysfx"));
    return ok(d.app === "crunchysfx" && d.version === 1 && JSON.stringify(Object.keys(d)) === JSON.stringify(Object.keys(JSON.parse(V.project.file))) &&
              JSON.stringify(d.userPresets) === JSON.stringify(JSON.parse(V.project.file).userPresets));
  });
  await t("legacy/v1.1-share-links-open-to-the-same-audio", function () {
    sampleBuf = null;
    const got = V.links.map(function (l) { loadSharedSound("?s=" + l.enc); return audio(render()); });
    const riff = JSON.stringify(riffGetPatch()) === JSON.stringify(V.links[5].riff);
    normalizeOut = true; updateNormBtn();
    return ok(JSON.stringify(got) === JSON.stringify(V.links.map(function (l) { return l.audio; })) && riff && seqLabel === "With riff", got.join(","));
  });

  // ---- safety ----
  // crunchyCore plant.js 4 (the guard): a delete whose files a SCENE uses says so by name, and deletes on the next press
  await t("guard/a-delete-whose-files-a-scene-uses-asks-first", async function () {
    if (!project) await projDo(function () { return projOpen(GODOT); });
    if (!library.isOpen()) library.open();
    const s0 = lib().querySelector(".lib-search"); if (s0 && s0.value) { s0.value = ""; s0.dispatchEvent(new Event("input")); }
    const a = project.assets.find(function (x) { return x.data.files.length > 0 && card(x.name); });
    if (!a) return ok(false, "no planted asset with files on screen");
    const scene = GODOT + "/scenes/uses-" + a.slug + ".tscn";
    M.put(scene, 'path="res://' + project.rel + "/" + a.slug + "/" + a.data.files[0] + '"');
    const msg = function () { const s = lib().querySelector(".lib-status"); return (s ? s.textContent : "") + " " + status(); };
    const press = async function () {
      cardButton(a.name, "Delete").click();
      const b = cardButton(a.name, "Delete"); if (b && /Really/.test(b.textContent)) b.click();
      await settle();
    };
    await press();
    const held = !!sidecar(a.slug) && /Press again to delete/.test(msg()) && msg().indexOf("uses-" + a.slug + ".tscn") >= 0;
    await press();
    M.files.delete(scene);
    return ok(held && !sidecar(a.slug) && !card(a.name), msg());
  });
  await t("safety/nothing-written-outside-crunchy-sfx", function () {
    const allowed = [ROOT + "/", UNITY + "/Assets/Crunchy/SFX/", PLAIN + "/crunchy/sfx/",
      "/home/aj/Downloads/", "/home/aj/round.crunchysfx"];                  // the last two: the suite's own Save dialogs
    const bad = M.log.filter(function (l) { return /^(w|rm|rmdir) /.test(l); }).map(function (l) { return l.replace(/^(w|rm|rmdir) /, ""); })
      .filter(function (p) { return !allowed.some(function (a) { return p.indexOf(a) === 0 || p === a; }); });
    return ok(!bad.length, bad.slice(0, 4).join(" "));
  });
  await t("safety/the-game-and-the-other-tools-untouched", function () {
    return ok(M.text(GODOT + "/project.godot") === "config_version=5\n" && M.text("/home/aj/old.crunchysfx") === V.project.file &&
              !M.log.some(function (l) { return /^(w|rm|rmdir) /.test(l) && l.indexOf("/crunchy/tile/") >= 0; }));
  });
  await t("safety/the-legacy-keys-are-all-there-under-their-names", function () {
    const keys = Object.keys(V.localStorage.store);
    return ok(keys.every(function (k) { return localStorage.getItem(k) !== null; }) && localStorage.getItem(PLANT_RECENT_KEY) !== null &&
              Object.keys(store()).every(function (k) { return keys.indexOf(k) >= 0 || k === PLANT_RECENT_KEY; }), Object.keys(store()).join(","));
  });
  await t("words/no-pro-premium-or-unlock-in-the-library-or-settings", function () {
    library.open();
    settingsDialog.open();
    const text = [lib(), document.getElementById("libDock"), document.getElementById("setModal"), document.querySelector(".controls")].map(function (e) {
      return e.innerText + " " + Array.from(e.querySelectorAll("[title], [placeholder]")).map(function (x) { return (x.title || "") + " " + (x.placeholder || ""); }).join(" ");
    }).join(" ");
    settingsDialog.close();
    const bad = text.match(/\b(pro|premium|unlock(ed|s)?)\b/gi);
    return ok(!bad, bad ? bad.join(",") : "");
  });
  await t("safety/no-page-errors", function () { return ok(!M.errors.length, M.errors.slice(0, 3).join(" | ")); });

  // ?show: end with the docked Library open over the planted Godot folder, to LOOK at it
  const show = /show/.test(location.search);
  if (show) {
    await projDo(function () { return projOpen(GODOT); });
    applyPreset(PRESETS["Coin"], "Coin pickup");
    library.open();
    projRefreshSuite();
    await settle();
    M.put(ROOT + "/coin/coin.crunchy", JSON.stringify(Object.assign(sidecar("coin"), { hash: "0" })));
    await projDo(function () { return projOpen(GODOT); });
    await settle();
    projCheckUpdatesNow();
  } else library.close();

  // ---- report ----
  scrollTo(0, 0);                                                   // fixed rails are drawn against the scroll position
  const failed = rows.filter(function (r) { return !r.pass; });
  const b = document.getElementById("dombanner");
  b.style.background = failed.length ? "#4d1418" : "#12441f";
  b.style.color = failed.length ? "#ffb3b8" : "#9ff5b6";
  b.textContent = "";
  const head = document.createElement("div");
  head.style.fontWeight = "700"; head.style.fontSize = "15px";
  head.textContent = (failed.length ? "FAIL" : "PASS") + " · desktop suite · " + (rows.length - failed.length) + "/" + rows.length;
  b.appendChild(head);
  try { dump("DESKTOP " + head.textContent + "\n"); rows.forEach(function (r) { dump((r.pass ? "ok   " : "FAIL ") + r.name + (r.detail ? " — " + r.detail : "") + "\n"); }); } catch (e) { /* dump off */ }
  if (show && !failed.length) { b.style.right = "auto"; return; }
  (failed.length ? failed : rows).forEach(function (r) {
    const d = document.createElement("div");
    d.textContent = (r.pass ? "ok   " : "FAIL ") + r.name + (r.detail ? " — " + r.detail : "");
    b.appendChild(d);
  });
})();
