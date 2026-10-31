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
  // THE SEARCH-ENGINE PASS (2026-10-16, worklog): the words live on about.html (AJ: the About section under the app made
  // the page scroll); the app page keeps its own layout and shows one plain About link in the license footer
  t("seo/an-about-link-on-the-web-and-no-about-section-on-the-app-page", function () {
    const a = document.querySelector('footer.license a[href="about.html"]');
    return ok(shown(a) && /About/.test(a.textContent) && !document.querySelector("section.about") && !document.querySelector("footer.suitelinks"),
              a ? a.textContent : "no About link in the license footer");
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
  // THE PACK (2026-10-15 usability round, "Sam"): the WAVs flat at the top (for Godot's AudioStreamRandomizer) and a
  // README with each take's share link — NO crunchy-library/ copies (Godot imported 16 WAVs for 8), and a valid DOS date
  // (1980-01-01 00:00; it was 1980-00-00, which unzip shows as 2114).
  t("zip/a-variation-pack-is-flat-wavs-and-a-readme-with-valid-dates", function () {
    applyPreset(PRESETS["Coin"], "Coin");
    document.getElementById("varName").value = "footstep";
    seedVariations();
    const files = buildPackFiles(), zipped = packZipFiles(files);
    const good = files.every(function (f) { const w = zipped.find(function (z) { return z.name === f.name; }); return w && same(w.data, f.data); });
    const readme = zipped.find(function (z) { return z.name === "README.txt"; });
    const rt = readme ? new TextDecoder().decode(readme.data) : "";
    const links = rt.match(/https:\/\/crunchysfx\.com\/\?s=\S+/g) || [];
    const zip = makeZip(zipped), names = [], dates = [];
    const dv = new DataView(zip.buffer);
    let o = 0;
    for (; dv.getUint32(o, true) === 0x04034b50;) { const n = dv.getUint16(o + 26, true), sz = dv.getUint32(o + 18, true); dates.push(dv.getUint16(o + 12, true), dv.getUint16(o + 10, true)); names.push(new TextDecoder().decode(zip.subarray(o + 30, o + 30 + n))); o += 30 + n + sz; }
    for (; dv.getUint32(o, true) === 0x02014b50;) { dates.push(dv.getUint16(o + 14, true), dv.getUint16(o + 12, true)); o += 46 + dv.getUint16(o + 28, true); }
    const validDates = dates.every(function (d, i) { return i % 2 ? d === 0 : (d >> 5 & 15) >= 1 && (d & 31) >= 1 && (d >> 9) === 0; });
    // a take's link opens that take (the same state as its variation genome)
    loadSharedSound("?" + links[2].split("?")[1]);
    const opened = files[2].item && Object.keys(files[2].item).every(function (k) { return k[0] === "_" || !(k in state) || state[k] === files[2].item[k]; });
    normalizeOut = true; updateNormBtn();
    document.getElementById("varClose").click();
    // (2026-10-24: + footstep.tres, the ready Godot AudioStreamRandomizer; tests/godot-pack.mjs loads it in real Godot)
    return ok(files.length === 8 && zipped.length === 10 && names.length === 10 && names.every(function (n) { return n.indexOf("/") < 0; }) && good &&
              names.indexOf("footstep.tres") >= 0 && /ExtResource\("8_take"\)/.test(new TextDecoder().decode(zipped.find(function (z) { return z.name === "footstep.tres"; }).data)) &&
              names.filter(function (n) { return /^footstep_0[1-8]\.wav$/.test(n); }).length === 8 && names[0] === "footstep_01.wav" &&
              /AudioStreamRandomizer/.test(rt) && !/crunchy-library/.test(rt) && links.length === 8 && validDates && opened,
              names.length + " names, " + links.length + " links, dates " + dates.slice(0, 2).join("/") + (opened ? "" : ", the link opened another sound"));
  });
  t("zip/a-sequence-pack-stays-wavs-and-a-readme", function () {
    sequence = [{ genome: genomeFromState(), label: "a" }, { genome: genomeFromState(), label: "b" }];
    seedVariations();
    const files = buildPackFiles(), zipped = packZipFiles(files);
    sequence = []; renderSeq();
    document.getElementById("varClose").click();
    return ok(zipped.length === files.length + 2 && zipped.every(function (f) { return /^[^/]+\.(wav|txt|tres)$/.test(f.name); }));
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
  // AJ 2026-10-31: a Quick Shape slider moved away and back gave "a totally different noise" (it read one param back but
  // wrote several). Every macro on several presets: the start spot is the sound, two drags away and back restore every
  // param exactly, and the ends still reach the macro's own extremes (enums aside).
  t("quick-shape/back-to-the-start-is-the-same-sound-and-the-ends-still-reach-the-extremes", function () {
    const bad = [];
    capture(function () {
      const move = (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); };
      ["Jump", "Laser", "Explosion", "Coin"].filter((n) => PRESETS[n]).forEach(function (n) {
        MACROS.forEach(function (m) {
          applyPreset(PRESETS[n], n);
          const el = document.getElementById(m.id), start = +el.value, keys = Object.keys(m.to(0));
          const before = JSON.stringify(keys.map((k) => state[k]));
          move(el, Math.min(1, start + 0.37)); move(el, Math.max(0, start - 0.29)); move(el, start);
          if (JSON.stringify(keys.map((k) => state[k])) !== before) bad.push(n + " " + m.name + ": " + before + " → " + JSON.stringify(keys.map((k) => state[k])));
          [0, 1].filter((v) => v !== start).forEach(function (v) {   // an end that IS the start gives the sound itself
            move(el, v);
            const want = m.to(v);
            keys.forEach(function (k) { if (PARAM_BY_KEY[k][8] !== "enum" && Math.abs(state[k] - want[k]) > 1e-6 * Math.max(1, Math.abs(want[k]))) bad.push(n + " " + m.name + " at " + v + ": " + k + " " + state[k] + " ≠ " + want[k]); });
          });
        });
      });
    });
    return ok(!bad.length, bad.slice(0, 4).join(" · "));
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
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); };
    const back = find("back"), menu = find("menu"), hit = find("hit"), coin = find("coin");
    presetSearch.value = ""; filterPresets();
    return ok(back.indexOf("Cancel") >= 0 && menu.indexOf("Cursor Move") >= 0 && hit.indexOf("Chittering Chirp") < 0 && hit.indexOf("8-Bit Hit") >= 0 && coin.indexOf("Coin") >= 0,
              [back.length, menu.length, hit.length, hit.indexOf("Chittering Chirp")].join(","));
  });
  // ---- the second usability round (2026-10-15, "Sam": a Godot platformer dev, no synth knowledge) ----
  // 3: presets on the first screen; the header button says what a click does; the tour lands on the top of the presets
  t("sam/presets-on-the-first-screen-the-riff-folded-on-a-first-visit", function () {
    // as a FIRST visit lays out: the v1.1 fixture's store has the XY scope (a tall square), a fresh visit the thin wave
    // strip — set the strip without saving a pref (the store must stay as v1.1 left it), then put the square back
    scrollTo(0, 0);
    const row = document.querySelector(".scoperow"), cv = document.getElementById("scope"), keep = [row.className, cv.width, cv.height];
    row.classList.remove("xy"); cv.width = 2320; cv.height = 90;
    const first = document.querySelector("#presets > .preset-section"), btn = first.querySelector(".sec-buttons button");
    const r = btn.getBoundingClientRect();
    row.className = keep[0]; cv.width = keep[1]; cv.height = keep[2];
    return ok(riffPanel.classList.contains("collapsed") && !(prefs.collapsed || {}).instrument && first.open && r.top > 0 && r.bottom < innerHeight,
              "first preset button at " + Math.round(r.top) + " of " + innerHeight + (riffPanel.classList.contains("collapsed") ? "" : ", riff open"));
  });
  t("sam/the-presets-button-says-hide-or-show", function () {
    const b = document.getElementById("browseToggle"), bad = [];
    if (b.textContent.trim() !== "Hide presets" || b.classList.contains("active")) bad.push("start: " + b.textContent);
    b.click();
    if (b.textContent.trim() !== "Show presets" || shown(document.querySelector(".ws-browser"))) bad.push("hidden: " + b.textContent);
    b.click();
    if (b.textContent.trim() !== "Hide presets" || !shown(document.querySelector(".ws-browser")) || prefs.hideBrowser) bad.push("again: " + b.textContent);
    localStorage.setItem("crunchyfx.prefs.v1", atBoot[3]); delete prefs.hideBrowser; scrollTo(0, 0);   // the store as v1.1 left it
    return ok(!bad.length, bad.join(" · "));
  });
  t("sam/the-tour-s-preset-step-lands-on-the-top-of-the-presets", function () {
    startTour(); showTourStep(TOUR.findIndex(function (st) { return /preset/i.test(st.title); }));
    const box = document.querySelector(".ws-browser .presetsearch").getBoundingClientRect();
    const sec = document.querySelector("#presets > .preset-section").getBoundingClientRect();
    const bar = document.querySelector(".controls").getBoundingClientRect();
    endTour(false); scrollTo(0, 0);
    return ok(box.top >= bar.bottom && box.top < bar.bottom + 60 && sec.top < innerHeight, "search box at " + Math.round(box.top) + ", controls end " + Math.round(bar.bottom));
  });
  // 4: spaces/hyphens don't matter; aliases name presets, never a whole section; the best matches first
  t("sam/search-hurt-and-power-up", function () {
    const run = function (q) {
      presetSearch.value = q; filterPresets();
      const all = Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; });
      return { all: all, best: Array.from(document.querySelectorAll("#presets .best-matches button")).map(function (b) { return b.textContent; }) };
    };
    const hurt = run("hurt"), pu = run("power up"), pu2 = run("power-up"), pu3 = run("powerup"), boom = run("explode"), heal = run("heal");
    presetSearch.value = ""; filterPresets();
    const bad = [];
    if (hurt.all.length > 30 || hurt.all.indexOf("Hit") < 0 || hurt.best[0] !== "Hit" || hurt.all.indexOf("Sword Swing") >= 0) bad.push("hurt: " + hurt.all.length + " " + hurt.best.slice(0, 3));
    [pu, pu2, pu3].forEach(function (r, i) { if (r.all.indexOf("Powerup") < 0 || r.all.indexOf("Robot Power Up") < 0 || r.all.indexOf("Power Down") >= 0) bad.push("power up #" + i + ": " + r.all.length); });
    if (JSON.stringify(pu.all) !== JSON.stringify(pu2.all) || pu.all.length < 10) bad.push("power up " + pu.all.length + " vs power-up " + pu2.all.length + " vs powerup " + pu3.all.length);
    if (boom.best.indexOf("Explosion") < 0) bad.push("explode: " + boom.best.slice(0, 3));
    if (heal.all.indexOf("Healing Aura") < 0) bad.push("heal");
    if (!document.querySelector("#presets .best-matches").hidden) bad.push("best row left after clearing");
    return ok(!bad.length, bad.join(" · ") || hurt.all.length + " hurt, " + pu.all.length + " power up");
  });
  // 5 + 9: the first click is the preset; again = a variation, named apart; files never reuse a name for another sound
  t("sam/first-click-is-the-preset-again-is-a-named-variation", function () {
    const bad = [], btn = function (n) { return Array.from(document.querySelectorAll("#presets details button")).find(function (b) { return b.textContent === n; }); };
    let files = [];
    files = capture(function () {
      btn("Jump").click();
      btn("Coin").click();
      const exact = snapshotState(); applyPreset(PRESETS["Coin"], "Coin");
      if (!sameState(exact, snapshotState()) || soundName() !== "Coin") bad.push("first click was not the preset: " + soundName());
      presetTake = { name: "Coin", state: snapshotState() };
      exportWav();                                             // coin.wav
      btn("Coin").click();
      if (soundName() !== "Coin v2" || histItems[0].name !== "Coin v2" || histItems[0].label !== "Variation") bad.push("second: " + soundName() + "/" + histItems[0].name);
      if (!/variation 2/.test(document.getElementById("nowStatus").textContent)) bad.push("status: " + document.getElementById("nowStatus").textContent);
      exportWav();                                             // coin_v2.wav
      btn("Coin").click();
      if (soundName() !== "Coin v3") bad.push("third: " + soundName());
      btn("Jump").click(); btn("Coin").click();
      if (soundName() !== "Coin") bad.push("back to the preset: " + soundName());
      exportWav();                                             // the same Coin: coin.wav again
      state.freq = state.freq * 2; play("Edit");
      exportWav();                                             // a different sound still called Coin: coin-2.wav
    });
    if (JSON.stringify(files) !== JSON.stringify(["coin.wav", "coin_v2.wav", "coin.wav", "coin-2.wav"])) bad.push("files: " + files.join(","));
    if (!/click again/i.test(btn("Coin").title)) bad.push("tooltip: " + btn("Coin").title);
    return ok(!bad.length, bad.join(" · "));
  });
  // 6: a plain-English line on every control and console
  t("sam/every-params-key-and-console-has-help", function () {
    const noHelp = PARAMS.filter(function (p) { return !PARAM_HELP[p[0]] || PARAM_HELP[p[0]].length < 12; }).map(function (p) { return p[0]; });
    const rows = Array.from(document.querySelectorAll("#panels input[data-key], #panels select[data-key]")).filter(function (el) { return PARAM_BY_KEY[el.dataset.key] && !el.closest(".row, .waverow") || !el.closest(".row, .waverow").title; }).map(function (el) { return el.dataset.key; });
    const consoles = Array.from(document.querySelectorAll("#consoleGrid .engine-btn")).filter(function (b) { return !b.title; }).map(function (b) { return b.textContent; });
    const engines = Array.from(document.querySelectorAll("#engineGrid .engine-btn")).filter(function (b) { return !b.title; }).map(function (b) { return b.textContent; });
    const head = document.querySelector(".console .engine-title").textContent;
    const ring = document.querySelector('#panels [data-key="ringMod"]').closest(".row").title;
    return ok(!noHelp.length && !rows.length && !consoles.length && !engines.length && /old game console/.test(head) && /metallic/.test(ring),
              [noHelp.join(","), rows.join(","), consoles.join(","), engines.join(","), head].join(" | "));
  });
  // 7: the page says a WAV is Godot-ready
  t("sam/export-says-godot-ready", function () {
    const nf = document.querySelector(".nowbar .now-file"), ex = document.getElementById("export");
    const step = TOUR.find(function (st) { return st.target === "#export"; });
    return ok(shown(nf) && /Godot/.test(nf.textContent) && /AudioStreamPlayer/.test(nf.querySelector(".now-engine").title) && /res:\/\//.test(ex.title) && /Godot/.test(step.body), nf.textContent);
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

  // ---- THE SOUND KIT (2026-10-15, AJ): a modal, an era menu, one sound per role, a zip of them; every sound in History ----
  const unzip = function (zip) {                       // a STORE zip's entries, by its local headers
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength), out = [];
    for (let o = 0; dv.getUint32(o, true) === 0x04034b50;) {
      const n = dv.getUint16(o + 26, true), sz = dv.getUint32(o + 18, true);
      out.push({ name: new TextDecoder().decode(zip.subarray(o + 30, o + 30 + n)), data: zip.subarray(o + 30 + n, o + 30 + n + sz), date: dv.getUint16(o + 12, true) });
      o += 30 + n + sz;
    }
    return out;
  };
  const kitG = function () { return kitRows.map(function (r) { return JSON.stringify(r.g); }); };
  t("kit/the-modal-opens-with-a-row-per-role-and-every-era", function () {
    let open = false, rows = 0, roles = "", focus = false, eras = [];
    capture(function () {
      document.getElementById("kitBtn").click();
      open = !kitModal.hidden;
      rows = kitModal.querySelectorAll(".kit-row").length;
      roles = Array.from(kitModal.querySelectorAll(".kit-role")).map(function (e) { return e.textContent; }).join("|");
      focus = kitModal.contains(document.activeElement) && document.activeElement !== document.body;
      eras = Array.from(document.getElementById("kitEra").options).map(function (o) { return o.value; });
    });
    const btn = document.getElementById("kitBtn");
    const each = kitModal.querySelectorAll(".kit-row canvas").length === KIT_ROLES.length && kitModal.querySelectorAll(".kit-play").length === KIT_ROLES.length &&
                 kitModal.querySelectorAll(".kit-reroll").length === KIT_ROLES.length;
    const titled = Array.from(kitModal.querySelectorAll("button")).every(function (b) { return !!b.title; });
    const want = ["Jump", "Coin", "Confirm", "Cancel", "Menu Move", "Swing", "Hit", "Hurt", "Explosion", "Power-up", "Shoot", "Game Over"];
    return ok(open && rows === KIT_ROLES.length && roles === want.join("|") && focus && each && titled &&
              JSON.stringify(eras) === JSON.stringify(STYLES.map(function (s) { return s.name; })) && eras[0] === "Generic" && eras.indexOf("8-Bit") > 0 &&
              Array.from(document.getElementById("kitEra").options).slice(1).every(function (o) { return o.title === CONSOLE_HELP[o.value]; }) &&
              btn.parentElement.classList.contains("controls-left") && /Sound Kit/.test(btn.textContent) && /a set for your game/.test(btn.querySelector("small").textContent) &&
              document.getElementById("kitDl").textContent === "Download kit" && !document.getElementById("kitLib"),
              rows + " rows · " + roles + " · eras " + eras.join(","));
  });
  t("kit/sounds-are-audible-and-ui-sounds-are-short", function () {
    const len = function (role) { const r = kitRows.find(function (x) { return x.r.role === role; }); return r.L.length / SR; };
    const loud = kitRows.every(function (r) { return withState(r.g, function () { return render(); }).rawPeak > AUDIBLE_FLOOR; });
    return ok(loud && len("Menu Move") <= 0.2 && len("Confirm") <= 0.4 && len("Cancel") <= 0.4 && len("Coin") <= 0.6 && len("Game Over") <= 2.5,
              kitRows.map(function (r) { return r.r.role + " " + (r.L.length / SR).toFixed(2); }).join(", "));
  });
  t("kit/reroll-changes-only-that-row", function () {
    const before = kitG();
    capture(function () { kitModal.querySelectorAll(".kit-reroll")[0].click(); });
    const after = kitG();
    const changed = after.map(function (g, i) { return g !== before[i]; });
    return ok(changed[0] && changed.slice(1).every(function (c) { return !c; }) && kitModal.querySelectorAll(".kit-row").length === KIT_ROLES.length,
              changed.join(","));
  });
  t("kit/changing-the-era-rerolls-all-in-that-era", function () {
    const before = kitG(), sel = document.getElementById("kitEra");
    capture(function () { sel.value = "8-Bit"; sel.dispatchEvent(new Event("change")); });
    const after = kitG();
    // 8-Bit: no reverb, no unison anywhere; every basic tone is a pulse wave in one of the four widths
    const styled = kitRows.every(function (r) { return r.g.reverb === 0 && r.g.delay === 0 && r.g.unison === 1 && (r.g.wave > 7 || r.g.noise >= 0.6 || (r.g.wave === 4 && NES_PW.indexOf(r.g.pulseWidth) >= 0)); });
    return ok(kitEra === "8-Bit" && after.every(function (g, i) { return g !== before[i]; }) && styled && /NES/.test(document.getElementById("kitEraHelp").textContent),
              kitRows.map(function (r) { return r.r.role + ":" + r.g.wave + "/" + r.g.reverb; }).join(" "));
  });
  t("kit/download-kit-is-one-zip-a-wav-per-role-and-a-readme-and-history-has-them", function () {
    kitNameEl.value = "Forest Kit";
    const keepZip = window.makeZip;
    let zip = null;
    window.makeZip = function (files) { zip = keepZip(files); return zip; };
    let got;
    try { got = capture(function () { document.getElementById("kitDl").click(); }); } finally { window.makeZip = keepZip; }
    const ents = zip ? unzip(zip) : [];
    const names = ents.map(function (e) { return e.name; });
    const want = KIT_ROLES.map(function (r) { return "forest_kit/" + fileStem(r.role) + ".wav"; }).concat(["forest_kit/README.txt"]);
    const rt = ents.length ? new TextDecoder().decode(ents[ents.length - 1].data) : "";
    const links = rt.match(/https:\/\/crunchysfx\.com\/\?s=\S+/g) || [];
    // every WAV is the row's own sound in the export format, titled "<Kit> <Role>"
    const wavs = kitRows.every(function (r, i) {
      const d = ents[i] && ents[i].data, dv = d && new DataView(d.buffer, d.byteOffset, d.byteLength);
      return d && String.fromCharCode(d[0], d[1], d[2], d[3], d[8], d[9], d[10], d[11]) === "RIFFWAVE" && dv.getUint32(24, true) === exportFmt.rate &&
             dv.getUint16(22, true) === exportFmt.channels && dv.getUint16(34, true) === exportFmt.depth && same(d, kitWav(r));
    });
    // a link reopens that exact sound
    loadSharedSound("?" + links[1].split("?")[1]);
    const reopened = audio(render()) === audio(kitRows[1]) && soundName() === "Forest Kit Coin";
    normalizeOut = true; updateNormBtn();
    const hist = KIT_ROLES.every(function (r) { return histItems.some(function (h) { return h.name === "Forest Kit " + r.role; }); });
    const shownHist = Array.from(document.querySelectorAll("#histlist .hist-label")).some(function (e) { return /^Forest Kit Jump/.test(e.textContent); });
    return ok(JSON.stringify(got) === '["forest_kit.zip"]' && JSON.stringify(names) === JSON.stringify(want) && wavs &&
              ents.every(function (e) { return e.date === ZIP_DOS_DATE; }) && links.length === KIT_ROLES.length && reopened &&
              /era: 8-Bit/.test(rt) && /CC0/.test(rt) && /No attribution required/.test(rt) && /res:\/\/forest_kit\/jump\.wav/.test(rt) && /AudioStreamPlayer/.test(rt) &&
              /menu_move\.wav +Menu Move: /.test(rt) && hist && shownHist,
              got.join(",") + " · " + names.length + " entries · " + links.length + " links · reopened " + reopened + " · history " + hist);
  });
  t("kit/escape-closes-and-the-kit-is-kept-for-next-time", function () {
    const before = kitG();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const closed = kitModal.hidden && document.activeElement === document.getElementById("kitBtn");
    capture(function () { document.getElementById("kitBtn").click(); });
    const kept = JSON.stringify(kitG()) === JSON.stringify(before) && document.getElementById("kitEra").value === "8-Bit";
    kitClose();
    return ok(closed && kept && kitModal.hidden);
  });


  // ---- SFX 1.3 FOUNDATION (SFX-1.3-PLAN.md): SFX_EXTRAS at every site, withState's own audio. Each row has a negative.
  const peakOfR = function (r) { let m = 0; for (let i = 0; i < r.L.length; i++) m = Math.max(m, Math.abs(r.L[i]), Math.abs(r.R[i])); return m; };
  const sameR = function (a, b) { return a.L.length === b.L.length && a.L.every(function (v, i) { return v === b.L[i]; }) && a.R.every(function (v, i) { return v === b.R[i]; }); };
  const without = function (g, k) { const o = Object.assign({}, g); delete o[k]; return o; };
  t("extras/the-table-lists-the-drawn-waves-and-the-speech-text-with-neutral-defaults", function () {
    return ok(JSON.stringify(SFX_EXTRAS) === JSON.stringify({ customWave: "", customWaveB: "", speechText: "" }), JSON.stringify(SFX_EXTRAS));
  });
  // Bug 1: mutateGenome / crossGenome copied PARAMS only, so a bred speech sound lost its text and went silent.
  t("extras/a-bred-speech-sound-still-speaks", function () {
    const parent = withState({ wave: 17, speechText: "game over", duration: 0.9 }, genomeFromState);
    const kids = [mutateGenome(parent, BREED_AMT), crossGenome(parent, parent), mutateGenome(crossGenome(parent, parent), BREED_AMT)];
    const bad = [];
    kids.forEach(function (g, i) {
      if (g.speechText !== "game over") bad.push("child " + i + " text " + JSON.stringify(g.speechText));
      if (peakOfR(withState(g, render)) <= AUDIBLE_FLOOR) bad.push("child " + i + " is silent");
    });
    // NEGATIVE: without its text (what Breed made before) the speech sound is silent, and the child sounds different
    // without it (a mutation can add noise or a sub, so the child itself need not go fully silent)
    const silentBefore = peakOfR(withState(without(parent, "speechText"), render)) <= AUDIBLE_FLOOR &&
                         !sameR(withState(kids[0], render), withState(without(kids[0], "speechText"), render));
    return ok(!bad.length && silentBefore, bad.join(" · ") + (silentBefore ? "" : " · negative: a textless speech sound was not silent"));
  });
  t("extras/a-bred-custom-wave-sound-keeps-its-drawing-and-is-not-a-plain-sine", function () {
    const drawn = new Float32Array(256);
    for (let k = 0; k < 256; k++) drawn[k] = k < 128 ? 0.9 : -0.9;            // a square, drawn
    const parent = withState({ wave: 12, customWave: customWaveToB64(drawn), customWaveB: customWaveToB64(drawn.map(function (v, k) { return k < 64 ? 1 : -0.3; })), duration: 0.3 }, genomeFromState);
    const child = mutateGenome(parent, BREED_AMT), crossed = crossGenome(parent, withState({ wave: 0 }, genomeFromState));
    const sine = withState(without(without(child, "customWave"), "customWaveB"), render);
    const kept = child.customWave === parent.customWave && child.customWaveB === parent.customWaveB;
    // a crossed child's drawings follow the parent that gave it its wave
    const follows = crossed.wave === 12 ? crossed.customWave === parent.customWave : !("customWave" in crossed);
    return ok(kept && follows && !sameR(withState(child, render), sine), (kept ? "" : "drawing lost · ") + (follows ? "" : "cross took the wrong parent's drawing"));
  });
  // Bug 2: applyPreset wrote ANY key into state (riff, a newer build's key, a hand-made link's).
  t("extras/an-unknown-key-in-a-preset-never-reaches-state", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset({ wave: 17, freq: 333, speechText: "hello", bogusKey: 7, riff: { p: [60, null], bpm: 120 }, __proto2: 1 }, "Probe");
      const leaked = ["bogusKey", "riff", "__proto2"].filter(function (k) { return k in state; });
      // NEGATIVE: known keys DO land (a PARAMS row and an extra)
      return ok(!leaked.length && state.freq === 333 && state.speechText === "hello", "leaked: " + leaked.join(", ") + " freq " + state.freq + " text " + state.speechText);
    } finally { applyPreset(keep, keepLabel); }
  });
  t("extras/load-from-history-brings-the-text-and-drawing-back-and-clears-them-for-a-sound-without", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      loadSnapshot({ wave: 17, speechText: "load me", duration: 0.5 }, "Probe");
      const got = state.speechText;
      loadSnapshot({ wave: 0, duration: 0.2 }, "Probe 2");
      // NEGATIVE: a sound without text leaves none behind (reset, not kept from the one before)
      return ok(got === "load me" && state.speechText === "", "got " + JSON.stringify(got) + ", then " + JSON.stringify(state.speechText));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("extras/share-link-history-and-undo-carry-every-extra", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset({ wave: 12, customWave: "AQID", customWaveB: "BAUG", speechText: "x" }, "Probe");
      const link = decodePatch(encodePatch()).s, snap = snapshotState();
      const all = ["customWave", "customWaveB", "speechText"].every(function (k) { return link[k] === state[k] && snap[k] === state[k]; });
      const differs = !sameState(snap, Object.assign({}, snap, { customWaveB: "" }));   // NEGATIVE: sameState sees an extra change
      return ok(all && differs && sameState(snap, JSON.parse(JSON.stringify(snap))), JSON.stringify(link));
    } finally { applyPreset(keep, keepLabel); }
  });
  // SFX 1.3 LAYERS (SFX-1.3-PLAN.md): the editor edits one layer; the sound is all of them, in renders, links, undo.
  t("layers/add-a-layer-edit-it-and-the-sound-is-both", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Laser"]), "Laser");
      const alone = render(), laserWave = state.wave;
      document.querySelector("#layerBar .layer-add").click();
      const tabs = document.querySelectorAll("#layerBar .layer-tab"), list1 = soundLayers(soundSnap().layers);
      const added = tabs.length === 2 && layerSel === 1 && list1.length === 1 && list1[0].p === -12 && tabs[1].classList.contains("on") &&
        !!document.querySelector('#layerBar input[data-mix="d"]');
      state.wave = 0; state.freq = 110;                      // make layer 2 a low sine
      const list2 = soundLayers(soundSnap().layers), both = render();
      const kept = soundSnap().wave === laserWave && list2[0].s.wave === 0 && list2[0].s.freq === 110 && layerBase.wave === laserWave;
      return ok(added && kept && !sameR(both, alone) && both.L.length === alone.L.length, [added, kept, sameR(both, alone)].join(" "));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("layers/a-preset-replaces-only-the-selected-layer-and-switching-changes-nothing", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Laser"]), "Laser");
      layerAdd();
      const before = snapshotState();
      applyPreset(PRESETS["Coin"], "Coin");                  // a preset on layer 2
      const after = snapshotState(), l = soundLayers(after.layers);
      const local = layerSel === 1 && after.wave === before.wave && after.freq === before.freq && l.length === 1 && l[0].s.wave === (PRESETS["Coin"].wave != null ? PRESETS["Coin"].wave : PARAM_DEFAULTS.wave);
      const s0 = snapshotState(); layerSelect(0); const s1 = snapshotState(); layerSelect(1); const s2 = snapshotState();
      const still = sameState(s0, s1) && sameState(s1, s2) && layerSel === 1;
      return ok(local && still, [local, still].join(" "));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("layers/a-link-history-and-undo-carry-every-layer", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Laser"]), "Laser");
      layerAdd(); layerMix("d", 0.12); layerMix("g", 0.5); play("Layer delay");
      const snd = snapshotState(), link = decodePatch(encodePatch()).s, rWhole = render();
      const linked = typeof link.layers === "string" && soundLayers(link.layers)[0].d === 0.12;
      applyPreset(Object.assign({ layers: "" }, PRESETS["Coin"]), "Coin");   // a whole other sound
      const cleared = !state.layers && layerSel === 0 && document.querySelectorAll("#layerBar .layer-tab").length === 1;
      applyPreset(Object.assign({ layers: "" }, link), "Shared");            // the link opens it, every layer
      const reopened = sameState(snapshotState(), snd) && layerSel === 0 && sameR(render(), rWhole);
      undoEdit();                                                         // back to the Coin
      const undone = !state.layers;
      redoEdit();
      const redone = sameState(snapshotState(), snd);
      return ok(linked && cleared && reopened && undone && redone, [linked, cleared, reopened, undone, redone].join(" "));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("layers/mute-and-remove-and-at-most-four", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Explosion"]), "Explosion");
      const one = render();
      layerAdd();
      const two = render();
      layerMix("m", 1);
      const muted = render(), mutedTab = document.querySelector("#layerBar .layer-tab.muted");
      layerAdd(); layerAdd();
      const full = soundLayers(soundSnap().layers).length === 3 && document.querySelector("#layerBar .layer-add").disabled;
      layerAdd();                                                         // a fifth: refused
      const capped = soundLayers(soundSnap().layers).length === 3;
      layerSelect(3); layerRemove(); layerSelect(2); layerRemove(); layerSelect(1); layerRemove();
      const back = !state.layers && layerSel === 0 && sameR(render(), one);
      return ok(!sameR(two, one) && !sameR(muted, two) && !!mutedTab && full && capped && back, [!sameR(two, one), !sameR(muted, two), !!mutedTab, full, capped, back].join(" "));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("layers/a-one-layer-sound-is-exactly-as-before-and-a-bred-child-carries-no-layers", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Coin"]), "Coin");
      const single = sameR(render(), renderPatch(state, { sample: sampleBuf, normalize: normalizeOut, customIR: customIR })) && snapshotState().layers === "" &&
        !("layers" in decodePatch(encodePatch()).s);
      layerAdd();
      const g = genomeFromState();
      return ok(single && !("layers" in g), [single, "layers" in g].join(" "));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("layers/a-planted-sound-keeps-its-layers", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Laser"]), "Laser");
      layerAdd();
      const f = editorFields("Layered"), r = soundRender(f), here = render();
      return ok(sameR(r, here) && typeof soundPatch(f).snap.layers === "string", "planted render matches the editor's");
    } finally { applyPreset(keep, keepLabel); }
  });
  // SFX 1.3 THE WIZARD: three questions, nine layered sounds, a power dial; nothing renders until Play; a load is whole.
  t("wizard/three-questions-then-nine-layered-sounds-none-rendered-until-play", function () {
    const keepA = JSON.stringify(wiz.answers), keepStep = wiz.step;
    try {
      wiz.answers = { kind: "", mats: [], era: "Generic", power: 5 }; wiz.step = 0; wiz.seed = 1;
      document.getElementById("wizardBtn").click();
      const q1 = !wizModal.hidden && wizBody.querySelectorAll(".wiz-card").length === WIZ_KINDS.length;
      wizBody.querySelector('.wiz-card[data-key="gunshot"]').click();
      const q2 = wiz.step === 1 && wizBody.querySelectorAll(".wiz-card").length === WIZ_MATERIALS.length + 1;
      wizBody.querySelector('.wiz-card[data-key="metal"]').click();
      const picked = wiz.answers.mats.join() === "metal" && /1 material/.test(wizFoot.querySelector(".wiz-next").textContent);
      wizFoot.querySelector(".wiz-next").click();
      const q3 = wiz.step === 2 && wizBody.querySelectorAll(".wiz-card").length === STYLES.length;
      wizBody.querySelector('.wiz-card[data-key="Generic"]').click();
      const picks = wizBody.querySelectorAll(".wiz-pick"), dial = wizBody.querySelectorAll(".wiz-power button");
      const nine = wiz.step === WIZ_STEPS && picks.length === 9 && wizBody.querySelectorAll(".wiz-play").length === 9 && dial.length === 9 &&
        wizBody.querySelector(".wiz-power button.on").dataset.power === "5";
      const unrendered = Object.keys(wiz.cache).length === 0;
      wizBody.querySelectorAll(".wiz-play")[3].click();
      const one = Object.keys(wiz.cache).length === 1 && wizBody.querySelectorAll(".wiz-play")[3].classList.contains("on");
      wizClose();
      return ok(q1 && q2 && picked && q3 && nine && unrendered && one, [q1, q2, picked, q3, nine, unrendered, one].join(" "));
    } finally { wiz.answers = JSON.parse(keepA); wiz.step = keepStep; wizClose(); }
  });
  t("wizard/every-result-is-audible-at-most-four-layers-carries-its-materials-and-has-its-own-name", function () {
    const bad = [];
    let n = 0;
    for (const kd of WIZ_KINDS) for (const mats of [[], ["metal"], ["fire", "ice"]]) for (const power of [1, 5, 9]) {
      const l = wizNine({ kind: kd.key, mats: mats, era: "Generic", power: power }, 1), tag = kd.key + "+" + (mats.join("+") || "any") + "@" + power;
      if (new Set(l.map(function (c) { return c.name; })).size !== 9) bad.push(tag + " names");
      for (const c of l) {
        n++;
        if (c.layers.length > WIZ_LAYER_MAX || !c.layers.length) bad.push(tag + " " + c.layers.length + " layers");
        if (mats.length && !c.layers.some(function (L) { return L.mat; })) bad.push(tag + " " + c.name + " has no material");
        c.layers.forEach(function (L, i) { if (!(renderPatch(L.s, { normalize: true }).rawPeak > AUDIBLE_FLOOR)) bad.push(tag + " " + c.name + " layer " + (i + 1) + " silent"); });
      }
      if (mats.some(function (m) { return !l.some(function (c) { return c.layers.some(function (L) { return L.mat === m; }); }); })) bad.push(tag + " a material never shows");
    }
    return ok(!bad.length, n + " results; " + (bad.slice(0, 5).join(", ") || "clean"));
  });
  t("wizard/the-same-answers-give-the-same-nine-and-more-like-these-nine-others", function () {
    const a = { kind: "explosion", mats: ["fire"], era: "Generic", power: 6 };
    const j = function (seed) { return JSON.stringify(wizNine(a, seed).map(wizSound)); };
    const r1 = Math.random();   // the app's own random is left as it was
    return ok(j(1) === j(1) && j(1) !== j(2) && typeof r1 === "number" && Math.random !== undefined, "seeded");
  });
  t("wizard/up-the-power-dial-longer-lower-and-fewer-layers-when-tame", function () {
    const at = function (power) {
      const l = wizNine({ kind: "gunshot", mats: [], era: "Generic", power: power }, 1);
      let dur = 0, lay = 0, pitch = 0;
      for (const c of l) { const snd = wizSound(c), r = renderSound(Object.assign({}, PARAM_DEFAULTS, snd), PARAM_DEFAULTS, { normalize: true }); dur += r.L.length / SR; lay += c.layers.length; pitch += soundLayers(snd.layers).reduce(function (t, e) { return t + (e.p || 0); }, 0); }
      return { dur: dur / 9, lay: lay / 9, pitch: pitch / 9 };
    };
    const lo = at(1), mid = at(5), hi = at(9);
    return ok(lo.dur < mid.dur && mid.dur < hi.dur && lo.lay <= 2 && hi.lay >= mid.lay && lo.pitch > mid.pitch && hi.pitch < mid.pitch,
      [lo, mid, hi].map(function (x) { return x.dur.toFixed(2) + "s/" + x.lay.toFixed(1) + "L/" + x.pitch.toFixed(1) + "st"; }).join(" "));
  });
  t("wizard/a-result-loads-whole-with-its-layers-as-one-undo-step", function () {
    const keep = snapshotState(), keepLabel = seqLabel, keepA = JSON.stringify(wiz.answers), keepStep = wiz.step;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Coin"]), "Coin");
      const before = snapshotState();
      wiz.answers = { kind: "sword", mats: ["ice"], era: "Generic", power: 7 }; wiz.step = WIZ_STEPS; wiz.seed = 3;
      wizOpen();
      const c = wiz.list[4], heard = wizRender(4);
      wizBody.querySelectorAll(".wiz-pick")[4].click();
      const loaded = wizModal.hidden && seqLabel === c.name && soundLayers(state.layers).length === c.layers.length - 1 && layerSel === 0 &&
        document.querySelectorAll("#layerBar .layer-tab").length === c.layers.length;
      const same = sameR(render(), heard);
      undoEdit();
      const undone = sameState(snapshotState(), before);
      return ok(loaded && same && undone, [loaded, same, undone].join(" "));
    } finally { wiz.answers = JSON.parse(keepA); wiz.step = keepStep; applyPreset(keep, keepLabel); }
  });
  // SFX care pass round 5: a spell is its material's own FUSED recipe (AJ's blind picks), not swell + sparkle + a layer
  t("wizard/a-spell-is-its-materials-own-recipe-two-alternate-none-goes-round-every-element", function () {
    const bad = [];
    const mats = Array.from(new Set(WIZ_SPELLS.map(function (r) { return r.mat; })));
    for (const m of mats) {
      const l = wizNine({ kind: "spell", mats: [m], era: "Generic", power: 5 }, 1), own = WIZ_SPELLS.filter(function (r) { return r.mat === m; });
      const keys = l.map(function (c) { return (c.layers[0].part || "").split(":")[1]; });
      if (keys.some(function (k) { return !own.some(function (r) { return r.key === k; }); })) bad.push(m + ": not its own spell");
      if (own.length > 1 && new Set(keys).size < 2) bad.push(m + ": its two recipes do not alternate");
      if (l.some(function (c) { return c.parts.indexOf("swell") >= 0 || c.parts.indexOf("sparkle") >= 0 && m !== "magic"; })) bad.push(m + ": still the generic cast");
    }
    const any = wizNine({ kind: "spell", mats: [], era: "Generic", power: 5 }, 1);
    const elems = new Set(any.map(function (c) { return c.layers[0].mat; }));
    if (elems.size < 5) bad.push("no material: only " + elems.size + " elements in the nine");
    const metal = wizNine({ kind: "spell", mats: ["metal"], era: "Generic", power: 5 }, 1);
    if (!metal.every(function (c) { return c.layers.some(function (L) { return L.mat === "metal"; }); })) bad.push("metal (no spell of its own) lost its layer");
    return ok(!bad.length, bad.join(", ") || mats.length + " materials, each its own spell");
  });
  t("wizard/an-era-shapes-every-layer", function () {
    const l = wizNine({ kind: "laser", mats: ["electric"], era: "8-Bit", power: 5 }, 1);
    const dry = l.every(function (c) { return c.layers.every(function (L) { return L.s.reverb === 0 && L.s.delay === 0; }); });
    const wet = wizNine({ kind: "laser", mats: ["electric"], era: "Generic", power: 5 }, 1).some(function (c) { return c.layers.some(function (L) { return L.s.reverb > 0; }); });
    return ok(dry && wet, "8-Bit strips every layer's reverb and delay (a negative: Generic keeps some)");
  });
  // Foundation 3: withState swaps the snapshot's OWN sample / IR / Normalize when given, and puts the editor's back.
  t("withstate/a-snapshot-renders-with-its-own-sample-ir-and-normalize-then-the-editor-is-untouched", function () {
    const keepS = sampleBuf, keepIR = customIR, keepN = normalizeOut;
    const smp = new Float32Array(8000); for (let k = 0; k < smp.length; k++) smp[k] = Math.sin(k * 0.05) * 0.8;
    const irL = new Float32Array(3000), irR = new Float32Array(3000); for (let k = 0; k < 3000; k++) { irL[k] = Math.sin(k * 0.3) * Math.exp(-k / 600); irR[k] = irL[k]; }
    const withSmp = withState({ wave: 9, duration: 0.3 }, render, { sample: smp });
    const noSmp = withState({ wave: 9, duration: 0.3 }, render, { sample: null });
    const wet = withState({ wave: 0, duration: 0.3, convType: 4, convMix: 0.5 }, render, { ir: { L: irL, R: irR } });
    const dry = withState({ wave: 0, duration: 0.3, convType: 4, convMix: 0.5 }, render, { ir: null });
    const quiet = { wave: 0, duration: 0.3, gain: 1, cutoff: 200, sustain: 0.05 };
    const normOff = withState(quiet, render, { norm: false }), normOn = withState(quiet, render, { norm: true });
    const restored = sampleBuf === keepS && customIR === keepIR && normalizeOut === keepN;
    // NEGATIVE: with no `audio` it renders exactly as before (the editor's own), the old behavior every caller keeps
    const plain = sameR(withState(quiet, render), normalizeOut ? normOn : normOff);
    return ok(peakOfR(withSmp) > 0.01 && peakOfR(noSmp) === 0 && !sameR(wet, dry) && !sameR(normOff, normOn) && restored && plain,
              [peakOfR(withSmp), peakOfR(noSmp), sameR(wet, dry), sameR(normOff, normOn), restored, plain].join(" "));
  });
  t("history/an-entry-replays-with-the-sample-it-was-made-with", function () {
    const keepS = sampleBuf, keep = snapshotState(), keepLabel = seqLabel;
    try {
      const smp = new Float32Array(8000); for (let k = 0; k < smp.length; k++) smp[k] = Math.sin(k * 0.07) * 0.7;
      sampleBuf = smp;
      applyPreset({ wave: 9, duration: 0.3 }, "Sampled probe");
      const item = histItems[0];
      sampleBuf = null;                                      // the editor moves on: no sample loaded now
      const r = withState(item.state, render, item.audio);
      // NEGATIVE: without the entry's audio it would render silent (no sample loaded)
      return ok(item.audio && item.audio.sample === smp && peakOfR(r) > 0.01 && peakOfR(withState(item.state, render)) === 0 && sampleBuf === null);
    } finally { sampleBuf = keepS; applyPreset(keep, keepLabel); }
  });


  // AMERICAN SPELLING (AJ, 2026-10-18: "no British spelling … wipe it out everywhere in all apps"; the suite rule).
  // CrunchyUI's copy/on-screen-text-uses-american-spelling, ported: every word the page holds (visible or in a closed
  // dialog), every title / placeholder / alt / aria-label, every option, and the words that reach the screen from
  // data: row labels, row tooltips, tour steps and preset names. The same word-boundary list as Tile's and UI's rows.
  t("copy/on-screen-text-uses-american-spelling", function () {
    const BRIT = /\b(\w*colour\w*|grey|greys|greyed|greying|greyish|greyscale|\w*armour\w*|armoury|centre|centres|centred|centring|centrepiece|behaviour\w*|favourites?|favour(s|ed|ing)?|\w*neighbour\w*|honour\w*|harbour\w*|rumour\w*|flavour\w*|odour\w*|vapour\w*|humour\w*|labour\w*|saviour|valour|splendour|licences?|defences?|offences?|fibres?|metres?|litres?|theatres?|calibre|lustre|sombre|spectres?|sceptres?|catalogue\w*|analogue|programmes?|jewellery|jeweller\w*|mould\w*|plough\w*|aluminium|cheques?|travell(ed|ing|er)|cancell(ed|ing)|modell(ed|ing)|labell(ed|ing)|fuell(ed|ing)|panelling|whilst|amongst|learnt|spelt|sulphur\w*|manoeuvre\w*|maths|storeys?|kerb|tyres?|artefacts?|(organ|real|recogn|custom|random|normal|optim|minim|maxim|visual|initial|synthes|serial|summar|stabil|categor|character|util|special|sanit|quant|material|raster|harmon|author|local|equal|neutral|synchron|crystall|styl|general|personal|ideal|final|priorit|emphas|apolog|memor|vapor|color|standard|modern|parameter)is(e|ed|es|ing|ation|ations|er|able))\b/i;
    const bad = [];
    const look = function (where, s) { const m = String(s || "").match(BRIT); if (m) bad.push(where + ": " + m[0] + " in " + JSON.stringify(String(s).trim().slice(0, 50))); };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (!n.parentElement.closest("script, style, #dombanner")) look("text", n.nodeValue);
    ["placeholder", "title", "alt", "aria-label"].forEach(function (a) {
      document.querySelectorAll("[" + a + "]").forEach(function (e) { look("@" + a, e.getAttribute(a)); });
    });
    document.querySelectorAll("optgroup").forEach(function (g) { look("optgroup", g.label); });
    PARAMS.forEach(function (p) { look("row " + p[0], p[1]); look("section of " + p[0], p[7]); });
    Object.keys(PARAM_HELP).forEach(function (k) { look("tip " + k, PARAM_HELP[k]); });
    TOUR.forEach(function (s) { look("tour", s.title); look("tour", s.body); });
    Object.keys(PRESETS).forEach(function (k) { look("preset", k); });
    // NEGATIVE: the list catches what it is for and passes look-alikes
    const sane = BRIT.test("Colour of the hiss") && BRIT.test("centred") && BRIT.test("organise") && !BRIT.test("noise") && !BRIT.test("Color");
    return ok(!bad.length && sane, (sane ? "" : "the word list itself · ") + bad.slice(0, 8).join(" · "));
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
