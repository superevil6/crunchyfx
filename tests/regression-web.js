"use strict";
// CrunchySFX — THE WEB SUITE: the free web build, for anyone who never opens the desktop app. Runs INSIDE the real
// index.html with NO window.__TAURI__ and the browser store seeded exactly as v1.1 left it (tests/fixtures/v1.1.js).
//
//   python3 tests/build.py web
//   firefox --headless --profile "$(mktemp -d)" --window-size=1400,900 \
//           --screenshot "$PWD/tests/web.png" "file://$PWD/tests/run-web.html"

(function () {
  const rows = [], V = window.SFX_V11;
  function t(name, fn) {
    let pass = false, detail = "";
    try {
      const r = fn();
      if (r === true || r === undefined) pass = true;
      else if (typeof r === "string") detail = r;
      else { pass = !!r.pass; detail = r.detail || ""; }
    } catch (e) { detail = "threw: " + (e && e.message ? e.message : e) + " " + String(e && e.stack || "").split("\n")[1]; }
    rows.push({ name: name, pass: pass, detail: detail });
  }
  const ok = function (p, d) { return { pass: !!p, detail: p ? "" : (d || "") }; };
  const shown = function (el) { return !!el && el.getClientRects().length > 0; };
  const same = function (a, b) { return !!a && !!b && a.length === b.length && a.every(function (x, i) { return x === b[i]; }); };
  const audio = function (r) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    [r.L, r.R].forEach(function (arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0; b = Math.imul(b ^ bytes[i], 0x5bd1e995) >>> 0; }
    });
    return ("00000000" + a.toString(16)).slice(-8) + ("00000000" + b.toString(16)).slice(-8);
  };
  // the visible words of an element tree: never a script's or a style's text, nor SOUND NAMES (content: the preset
  // library has a UI sound called "Unlock", and the history lists sounds by name)
  const CONTENT = "script, style, #presets, #histlist";
  const words = function (root) {
    const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (!n.parentElement.closest(CONTENT)) out.push(n.nodeValue);
    root.querySelectorAll("[title], [placeholder], [aria-label]").forEach(function (e) { if (!e.closest(CONTENT)) out.push(e.title || "", e.placeholder || "", e.getAttribute("aria-label") || ""); });
    return out.join(" ");
  };
  const opened = [];
  window.open = function (u) { opened.push(u); return null; };
  if (typeof endTour === "function") endTour(false);
  const STATIC = ["crunchyfx.userpresets.v1", "crunchyfx.usercats.v1", "crunchyfx.mywaves.v1", "crunchyfx.prefs.v1"];
  const atBoot = STATIC.map(function (k) { return localStorage.getItem(k); });

  t("gate/no-desktop-controls-on-the-web", function () {
    return ok(!isDesktop && !document.getElementById("libraryBtn") && !document.getElementById("libDock") && !document.getElementById("plantSave") &&
              !document.getElementById("projSave") && !document.getElementById("dragOut") && !shown(document.getElementById("mypresets")) && !shown(document.getElementById("userCats")));
  });
  t("legacy/v1.1-prefs-and-history-read-as-they-were", function () {
    return ok(atBoot.every(function (v, i) { return v === V.localStorage.store[STATIC[i]]; }) && scopeMode === "xy" && prefs.tourSeen === true && histItems.length === 2 &&
              document.querySelector(".macro").classList.contains("collapsed"));
  });
  // crunchyCore desktop.js 2: the button opens the DESKTOP TOUR (four panels; the last has "Get it on itch.io" when the
  // store link exists, as SFX's does)
  t("desktop-button/one-button-in-the-controls-with-the-core-dialog", function () {
    const b = document.querySelector(".desk-cta");
    b.click();
    const d = document.querySelector(".dtour-overlay");
    const nextBtn = function () { return Array.from(d.querySelectorAll("button")).find(function (x) { return /^(Next|Done)$/.test(x.textContent); }); };
    for (let i = 0; i < 3; i++) nextBtn().click();
    const get = d.querySelector(".dtour-get");
    if (get) get.click();
    d.querySelector('[aria-label="Close"]').click();
    const gone = !document.querySelector(".dtour-overlay") || document.querySelector(".dtour-overlay").hidden;
    return ok(b && b.parentElement.classList.contains("controls-right") && /Get the desktop app/.test(b.textContent) && b.querySelector(".pxi") &&
              !!get && opened[opened.length - 1] === "https://sevi66.itch.io/crunchysfx" && gone &&
              !document.getElementById("steambtn"), String(opened[opened.length - 1]));
  });
  t("desktop-button/no-pro-premium-or-unlock-anywhere-visible", function () {
    document.getElementById("settingsBtn").click();
    const text = words(document.body);
    settingsDialog.close();
    const bad = text.match(/\b(pro|premium|unlock(ed|s)?|pro-only)\b/gi);
    return ok(!bad && /desktop app/.test(text), bad ? bad.join(",") : "");
  });
  t("settings/the-core-dialog-with-the-web-rows", function () {
    document.getElementById("settingsBtn").click();
    const root = document.getElementById("setModal");
    const labels = Array.from(root.querySelectorAll(".setlbl")).map(function (l) { return l.firstChild.textContent; });
    const nz = root.querySelector("#prefNormalize");
    nz.click(); const off = normalizeOut === false;
    nz.click();
    const tour = Array.from(root.querySelectorAll(".set-btn")).find(function (b) { return b.textContent === "Take the tour"; });
    tour.click();
    const toured = root.hidden && !document.querySelector(".tour").hidden;
    endTour(false);
    return ok(labels.join("|") === "Export format|Normalize loudness|Getting started|What does the desktop app add?" && off && normalizeOut === true && toured &&
              !root.querySelector("#prefPromptSave") && !root.querySelector("#prefCheckUpdates") && root.querySelector("#fmtRate"), labels.join("|"));
  });
  t("legacy/v1.1-share-links-open-to-the-same-audio", function () {
    const got = V.links.map(function (l) { loadSharedSound("?s=" + l.enc); return audio(render()); });
    normalizeOut = true; updateNormBtn();
    return ok(JSON.stringify(got) === JSON.stringify(V.links.map(function (l) { return l.audio; })), got.join(","));
  });
  // THE PACK (2026-10-14 usability round): the WAVs flat at the top (for Godot's AudioStreamRandomizer), a README, and the
  // Library form (a folder per sound: its WAV beside its .crunchy) under crunchy-library/. The WAVs are the same bytes.
  t("zip/a-variation-pack-is-flat-wavs-a-readme-and-the-library-form-in-a-subfolder", function () {
    applyPreset(PRESETS["Coin"], "Coin");
    document.getElementById("varName").value = "footstep";
    seedVariations();
    const files = buildPackFiles(), zipped = packZipFiles(files);
    const top = zipped.filter(function (f) { return f.name.indexOf("/") < 0; });
    const good = files.every(function (f, i) {
      const stem = f.name.replace(/\.wav$/, ""), w = zipped.find(function (z) { return z.name === f.name; });
      const lw = zipped.find(function (z) { return z.name === "crunchy-library/" + stem + "/" + f.name; });
      const sc = zipped.find(function (z) { return z.name === "crunchy-library/" + stem + "/" + stem + ".crunchy"; });
      const d = sc && JSON.parse(new TextDecoder().decode(sc.data));
      return w && same(w.data, f.data) && lw && same(lw.data, f.data) && d && plantSidecarValid(d) && d.kind === "sound" && d.name === "footstep " + (i + 1) &&
             d.wav === f.name && d.exportName === "footstep " + (i + 1) && JSON.stringify(d.files) === JSON.stringify([f.name]) &&
             d.hash === plantHash([{ path: f.name, data: f.data }]) && same(soundFiles(d)[0].data, f.data);   // the desktop re-renders the very same bytes
    });
    const readme = zipped.find(function (z) { return z.name === "README.txt"; });
    const rt = readme ? new TextDecoder().decode(readme.data) : "";
    const zip = makeZip(zipped), names = [];
    const dv = new DataView(zip.buffer);
    for (let o = 0; dv.getUint32(o, true) === 0x04034b50;) { const n = dv.getUint16(o + 26, true), sz = dv.getUint32(o + 18, true); names.push(new TextDecoder().decode(zip.subarray(o + 30, o + 30 + n))); o += 30 + n + sz; }
    document.getElementById("varClose").click();
    return ok(files.length === 8 && top.length === 9 && top.filter(function (f) { return /^footstep_0[1-8]\.wav$/.test(f.name); }).length === 8 && good &&
              /AudioStreamRandomizer/.test(rt) && /crunchy-library/.test(rt) && names.length === 25 && names[0] === "footstep_01.wav", names.slice(0, 3).join(",") + " " + top.length);
  });
  t("zip/a-sequence-pack-stays-wavs-and-a-readme", function () {
    sequence = [{ genome: genomeFromState(), label: "a" }, { genome: genomeFromState(), label: "b" }];
    seedVariations();
    const files = buildPackFiles(), zipped = packZipFiles(files);
    sequence = []; renderSeq();
    document.getElementById("varClose").click();
    return ok(zipped.length === files.length + 1 && zipped.every(function (f) { return /^[^/]+\.(wav|txt)$/.test(f.name); }));
  });

  // ---- the usability round (2026-10-14): one naming rule, a sound keeps its name, the tools' click rule, Variations ----
  const capture = function (fn) {          // the file names the app would save (downloadWav's and an <a download>'s)
    const got = [], keepDl = window.downloadWav, keepClick = HTMLAnchorElement.prototype.click, keepPlay = window.playBuffer;
    window.downloadWav = function (L, R, name) { got.push(name); return Promise.resolve(name); };
    HTMLAnchorElement.prototype.click = function () { if (this.download) got.push(this.download); };
    window.playBuffer = function () { return { stop: function () {} }; };
    try { fn(); } finally { window.downloadWav = keepDl; HTMLAnchorElement.prototype.click = keepClick; window.playBuffer = keepPlay; }
    return got;
  };
  t("naming/one-rule-export-history-save-preset-and-pack-all-named-from-the-sound", function () {
    const box = document.getElementById("soundName");
    const got = capture(function () {
      applyPreset(PRESETS["Jump"], "Jump");
      exportWav();
      box.value = "Big Jump"; box.dispatchEvent(new Event("input"));
      exportWav();
      play("Edit");
      document.querySelector('#histlist .hist-item [data-a="wav"]').click();
      savePreset();
      varNameEl.value = ""; varCountEl.value = "3"; seedVariations();
      exportPack();
      document.getElementById("varClose").click();
    });
    const want = ["jump.wav", "big_jump.wav", "big_jump.wav", "big_jump.json", "big_jump_pack.zip"];
    return ok(JSON.stringify(got) === JSON.stringify(want) && document.getElementById("soundFile").textContent === "big_jump.wav" &&
              fileStem("Punch / Kick") === "punch_kick" && fileStem("") === "sound" && fileStem("Feu ✨ été") === "feu_ete", got.join(","));
  });
  t("name/quick-shape-and-the-tools-keep-the-sound-s-name", function () {
    const box = document.getElementById("soundName"), bad = [];
    capture(function () {
      applyPreset(PRESETS["Jump"], "Jump");
      const m = document.querySelector('#macros input[type=range], .macro input[type=range], input[data-macro]') || document.querySelectorAll('input[type=range]')[0];
      m.value = String(Math.min(+m.max, +m.value + 0.2)); m.dispatchEvent(new Event("input")); m.dispatchEvent(new Event("change"));
      if (soundName() !== "Jump" || box.value !== "Jump") bad.push("quick shape: " + soundName());
      if (histItems[0].name !== "Jump") bad.push("history: " + histItems[0].name + "/" + histItems[0].label);
      document.getElementById("breed").click(); breedNext(); adoptGenome(breedGenomes[1]);
      if (soundName() !== "Jump") bad.push("breed: " + soundName());
      document.getElementById("variations").click(); varGrid.querySelectorAll(".breed-cell")[1].querySelector(".tile-use").click();
      if (soundName() !== "Jump") bad.push("variation: " + soundName());
      document.getElementById("foundry").click();
      document.querySelector("#fndGrid .breed-cell .tile-use").click();
      if (/foundry/i.test(soundName()) || !soundName()) bad.push("foundry: " + soundName());
    });
    return ok(!bad.length, bad.join(" · "));
  });
  t("tools/click-hears-double-click-or-use-loads-in-breed-variations-and-foundry", function () {
    const bad = [];
    capture(function () {
      applyPreset(PRESETS["Coin"], "Coin");
      let heard = 0; const keep = window.playBuffer; window.playBuffer = function () { heard++; return { stop: function () {} }; };
      try {
        [["breed", "#breedGrid", breedModal], ["variations", "#varGrid", varModal], ["foundry", "#fndGrid", foundryModal]].forEach(function (x) {
          document.getElementById(x[0]).click();
          const cells = document.querySelectorAll(x[1] + " .breed-cell"), h0 = heard;
          cells[1].click();
          if (heard !== h0 + 1 || !cells[1].classList.contains("heard")) bad.push(x[0] + ": click did not play");
          if (x[2].hidden) bad.push(x[0] + ": click closed it");
          if (!/Click a sound to hear it/.test(x[2].querySelector(".modal-head .hint").textContent)) bad.push(x[0] + ": no click rule in its hint");
          cells[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
          if (!x[2].hidden) bad.push(x[0] + ": double-click did not use it");
          x[2].hidden = true;
        });
      } finally { window.playBuffer = keep; }
    });
    const tour = TOUR.find(function (s) { return /Breed/.test(s.body); });
    if (!tour || /Breed[^.]*variation/i.test(tour.body)) bad.push("tour: " + (tour && tour.body));
    ["rand", "breed", "foundry", "variations"].forEach(function (id) { const b = document.getElementById(id); if (!b.querySelector("small") || !b.title) bad.push(id + ": no description"); });
    return ok(!bad.length, bad.join(" · "));
  });
  t("breed/use-is-off-until-a-sound-is-heard-and-says-why", function () {
    const bad = [];
    capture(function () {
      applyPreset(PRESETS["Coin"], "Coin");
      document.getElementById("breed").click();
      const use = document.getElementById("breedAdopt"), hint = document.getElementById("breedUseHint");
      if (!use.disabled || !hint.textContent) bad.push("fresh batch: enabled");
      breedGrid.querySelectorAll(".breed-cell")[2].click();
      if (use.disabled) bad.push("after a click: disabled");
      breedNext();
      if (!use.disabled || !hint.textContent) bad.push("after breeding: enabled with nothing heard");
      breedGrid.querySelectorAll(".breed-cell")[3].click(); use.click();
      if (!breedModal.hidden) bad.push("Use did nothing");
    });
    return ok(!bad.length, bad.join(" · "));
  });
  t("variations/count-takes-any-number-2-to-16", function () {
    applyPreset(PRESETS["Hit"], "Hit"); varNameEl.value = "";
    const counts = [3, 5, 16, 1, 40].map(function (n) { varCountEl.value = String(n); varCountEl.dispatchEvent(new Event("change")); return varGenomes.length; });
    const tag = varGrid.querySelectorAll(".breed-tag")[2].textContent;
    varCountEl.value = "8"; seedVariations(); document.getElementById("varClose").click();
    return ok(JSON.stringify(counts) === "[3,5,16,2,16]" && /^hit_03\.wav/.test(tag) && varCountEl.type === "number", counts + " " + tag);
  });
  // MEASURED (tests/ measure, the worklog): with Normalize loudness on, a pack's takes match (gated RMS) and stay under -3 dBFS.
  t("variations/loudness-matched-within-1-db-and-no-peak-near-full-scale", function () {
    const out = [];
    ["Coin", "Hit", "Footstep", "Cancel", "Jump", "Explosion"].forEach(function (n) {
      applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
      const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
      const spread = Math.max.apply(null, m.map(function (x) { return x.rms; })) - Math.min.apply(null, m.map(function (x) { return x.rms; }));
      out.push({ n: n, spread: spread, pk: Math.max.apply(null, m.map(function (x) { return x.pk; })) });
    });
    document.getElementById("varClose").click();
    return ok(out.every(function (o) { return o.spread <= 1 && o.pk <= -2.9; }), out.map(function (o) { return o.n + " " + o.spread.toFixed(2) + "dB pk " + o.pk.toFixed(1); }).join(", "));
  });
  t("variations/no-take-is-cut-off-louder-than-the-original-ends", function () {
    const bad = [];
    ["Coin", "Laser", "Explosion", "Footstep", "Jump"].forEach(function (n) {
      applyPreset(PRESETS[n], n); varAmtEl.value = "0.5"; varCountEl.value = "8"; seedVariations();
      const ends = varGenomes.map(function (g) { return Math.max(-60, 20 * Math.log10(tailLevel(renderVariation(g).L) + 1e-12)); });
      ends.slice(1).forEach(function (e, i) { if (e > Math.max(-40, ends[0] + 3)) bad.push(n + " #" + (i + 2) + " " + e.toFixed(0) + " vs " + ends[0].toFixed(0)); });
    });
    varAmtEl.value = "0.2"; document.getElementById("varClose").click();
    return ok(!bad.length, bad.join(", "));
  });
  t("search/word-starts-and-a-game-dev-vocabulary", function () {
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); };
    const back = find("back"), menu = find("menu"), hit = find("hit"), coin = find("coin");
    presetSearch.value = ""; filterPresets();
    return ok(back.indexOf("Cancel") >= 0 && menu.indexOf("Cursor Move") >= 0 && hit.indexOf("Chittering Chirp") < 0 && hit.indexOf("8-Bit Hit") >= 0 && coin.indexOf("Coin") >= 0,
              [back.length, menu.length, hit.length, hit.indexOf("Chittering Chirp")].join(","));
  });
  t("presets/game-dev-sections-first", function () {
    const heads = Array.from(document.querySelectorAll("#presets details > summary")).map(function (s) { return s.textContent; });
    return ok(/Retro \/ Arcade/.test(heads[0]) && /\bUI\b/.test(heads[1]) && heads.length === PRESET_CATEGORIES.length, heads.slice(0, 4).join(" | "));
  });
  t("legacy/the-v1.1-store-is-left-as-it-was", function () {
    const now = STATIC.map(function (k) { return localStorage.getItem(k); });
    return ok(now.every(function (v, i) { return v === atBoot[i]; }) && localStorage.getItem("crunchyfx.recentPlanted.v1") === null);
  });

  // FEEDBACK (DESKTOP.md "Feedback"; crunchyCore feedback.js, CrunchyTile TILE-DESIGN §118): the header button opens the
  // core's dialog; every detail is shown and can be unticked; the link to the sound is OFF unless ticked; a status line
  // said earlier is under Recent. (Send is never pressed here: on the web it navigates to a mailto: link.)
  t("feedback/the-dialog-shows-what-would-be-sent-and-the-link-is-off", function () {
    projStatus("Saved Coin");                                  // a status line it should remember
    document.getElementById("feedbackBtn").click();
    const root = feedback.root(), dets = Array.from(root.querySelectorAll(".fb-det"));
    const label = function (d) { return d.querySelector("b").textContent; };
    const link = dets.find(function (d) { return /Link to what was on screen/.test(label(d)); });
    const snd = dets.find(function (d) { return /^Sound/.test(label(d)); });
    const recent = dets.find(function (d) { return /^Recent/.test(label(d)); });
    const open = feedback.isOpen() && !!root.querySelector(".fb-title .pxi") && !!document.querySelector("#feedbackBtn .pxi");
    const ta = root.querySelectorAll("textarea");
    ta[0].value = "Make a coin sound"; ta[1].value = "It sounded great\nand more";
    const r = feedbackReport({ app: "CrunchySFX", trying: ta[0].value, happened: ta[1].value, details: [["Sound", snd ? snd.querySelector(".fb-val").textContent : ""]] });
    feedback.close();
    const bad = [];
    if (!open) bad.push("the header button (with its mail icon) did not open the dialog with a mail icon in its title");
    if (!snd || !snd.querySelector("input").checked) bad.push("no ticked 'Sound' line");
    if (!link) bad.push("no link line");
    else if (link.querySelector("input").checked) bad.push("the link is ticked by default");
    else if (!/^https:\/\/crunchysfx\.com\/\?s=/.test(link.querySelector(".fb-val").textContent)) bad.push("the link is not crunchysfx.com's ?s= form");
    if (!recent || !/Saved Coin/.test(recent.querySelector(".fb-val").textContent)) bad.push("the earlier status line is not under Recent");
    if (r.subject !== "[CrunchySFX] It sounded great") bad.push("subject: " + r.subject);
    if (feedback.isOpen()) bad.push("close left it open");
    return bad.length ? bad.join(" · ") + " (" + dets.map(label).join("|") + ")" : { pass: true, detail: dets.map(label).join("|") };
  });

  scrollTo(0, 0);
  const failed = rows.filter(function (r) { return !r.pass; });
  const b = document.getElementById("dombanner");
  b.style.background = failed.length ? "#4d1418" : "#12441f";
  b.style.color = failed.length ? "#ffb3b8" : "#9ff5b6";
  b.textContent = "";
  const head = document.createElement("div");
  head.style.fontWeight = "700"; head.style.fontSize = "15px";
  head.textContent = (failed.length ? "FAIL" : "PASS") + " · web suite · " + (rows.length - failed.length) + "/" + rows.length;
  b.appendChild(head);
  try { dump("WEB " + head.textContent + "\n"); rows.forEach(function (r) { dump((r.pass ? "ok   " : "FAIL ") + r.name + (r.detail ? " — " + r.detail : "") + "\n"); }); } catch (e) { /* dump off */ }
  (failed.length ? failed : rows).forEach(function (r) {
    const d = document.createElement("div");
    d.textContent = (r.pass ? "ok   " : "FAIL ") + r.name + (r.detail ? " — " + r.detail : "");
    b.appendChild(d);
  });
})();
