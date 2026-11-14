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
  // 2026-11-12. The Length macro clamped Duration to its row's 2 s, so the smallest nudge cut a long sound (the 12 s surf,
  // a 3 s distant boom, Night Insects) to 2 s. It asks durationMax now, like the Duration slider: a long sound shortens
  // smoothly from where it is, and an ordinary one still stops at 2 s.
  t("quick-shape/length-shortens-a-long-sound-smoothly-and-an-ordinary-one-still-stops-at-2s", function () {
    const bad = [];
    capture(function () {
      const el = document.getElementById("m-length");
      const move = (v) => { el.value = String(v); el.dispatchEvent(new Event("input")); el.dispatchEvent(new Event("change")); };
      ["Distant Boom", "Night Insects"].forEach(function (n) {
        if (!PRESETS[n]) { bad.push(n + " missing"); return; }
        applyPreset(PRESETS[n], n);
        const d0 = state.duration, v0 = +el.value;
        if (!(d0 > 2)) bad.push(n + " is not a long sound (" + d0 + " s), so this row proves nothing");
        move(Math.max(0, v0 - 0.02));
        if (!(state.duration > 2 && state.duration < d0)) bad.push(n + ": a small nudge left gave " + state.duration + " s from " + d0 + " s");
        move(v0);
        if (state.duration !== d0) bad.push(n + ": back to the start gave " + state.duration + " s, not " + d0);
      });
      applyPreset(PRESETS["Laser"], "Laser");
      move(1);
      if (state.duration > 2) bad.push("Laser at Long went to " + state.duration + " s, past the row's 2 s");
    });
    return ok(!bad.length, bad.slice(0, 4).join(" · "));
  });
  // 2026-11-12. A preset may hold a value past its slider (Temple Bell's decay 3.85 on a 1 s row, a creature's cutoff
  // 18000 on a 12000 row). Variations, Breed and the macros never clamp such a value below where the sound already is.
  t("ranges/a-value-past-its-slider-survives-variations-breed-and-the-macros", function () {
    const bad = [];
    capture(function () {
      const rnd = Math.random; let rs = 7; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
      try {
        const src = Object.assign(withState(PRESETS["Temple Bell"], genomeFromState), { cutoff: 18000 });
        if (!(src.decay > 1)) bad.push("Temple Bell's decay is not past its row, so this row proves nothing");
        for (let i = 0; i < 40; i++) {
          const v = varyGenome(src, 0.2), b = mutateGenome(src, 0.22);
          [["varied", v], ["bred", b]].forEach(function (x) {
            if (x[1].decay <= 1 || x[1].cutoff <= 12000) bad.push(x[0] + " decay " + x[1].decay + " cutoff " + x[1].cutoff);
          });
        }
        applyPreset(PRESETS["Temple Bell"], "Temple Bell");
        const d0 = state.decay, el = document.getElementById("m-length"), v0 = +el.value;
        el.value = String(Math.max(0, v0 - 0.01)); el.dispatchEvent(new Event("input"));
        if (!(state.decay > 1)) bad.push("a small Length nudge cut the decay from " + d0 + " to " + state.decay);
        el.value = String(v0); el.dispatchEvent(new Event("input"));
        if (state.decay !== d0) bad.push("Length back to the start gave decay " + state.decay + ", not " + d0);
      } finally { Math.random = rnd; }
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
  // 2026-11-13. THE GLASS ENGINE (wave 36): its rows are drawn only by a glass sound (and its panel shown only for it);
  // every glass preset and alt renders audible, stereo, finite, under full scale and seeded (the same take twice is the
  // same bytes, another Variation is another take); Glass Clink's base is still today's modal patch; and a Variations
  // pack of a break is levelled like any other (glPeak is the engine's, so `gain` stays a plain level: blast's lesson).
  t("glass/drawn-only-when-used-presets-audible-and-variations-levelled", function () {
    const bad = [], glKeys = PARAMS.filter(function (p) { return p[7] === "Glass"; }).map(function (p) { return p[0]; });
    if (glKeys.length !== 20 || WAVES[36] !== "glass") bad.push("rows " + glKeys.length + ", wave 36 " + WAVES[36]);
    const coin = withState(PRESETS["Coin"], genomeFromState), shat = withState(PRESETS["Glass Shatter"], genomeFromState);
    glKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, shat)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[1].indexOf(36) >= 0; })) bad.push("not in the engine picker");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Glass"]');
    if (!panel || !panel.hidden) bad.push("Glass panel shown for a Coin");
    applyPreset(PRESETS["Glass Shatter"], "Glass Shatter");
    if (!panel || panel.hidden) bad.push("Glass panel hidden for Glass Shatter");
    if (PRESETS["Glass Clink"].wave !== 10 || PRESETS["Glass Clink"].freq !== 2093) bad.push("Glass Clink's base moved");
    ["Glass Shatter", "Window Smash", "Bottle Break", "Pot Smash", "Glass Clink"].forEach(function (n) {
      const list = (n === "Glass Clink" ? [] : [PRESETS[n]]).concat(PRESETS[n]._alts || []);
      if (list.length < 2) bad.push(n + ": " + list.length + " versions");
      list.forEach(function (p, j) {
        if (Math.round(p.wave) !== 36) bad.push(n + " #" + j + " not glass");
        const r = withState(p, render); let pk = 0, side = 0, nan = 0;
        for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); }
        if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.95 || !(side > 0)) bad.push(n + " #" + j + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan);
      });
    });
    const p0 = PRESETS["Window Smash"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { glSeed: p0.glSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("glSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    const rnd = Math.random; let rs = 36; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Glass Shatter", "Window Smash", "Pot Smash"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)), end: Math.max(-60, 20 * Math.log10(tailLevel(r.L) + 1e-12)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
        m.slice(1).forEach(function (x, i) { if (x.end > Math.max(-40, m[0].end + 3)) bad.push(n + " #" + (i + 2) + " ends at " + x.end.toFixed(0) + " dB"); });
      });
    } finally { Math.random = rnd; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-13. THE CROWD ENGINE (wave 37): its rows are drawn only by a crowd sound (and its panel shown only for it);
  // every crowd preset and alt renders audible, stereo, finite, under full scale and seeded (the same take twice is the
  // same bytes, another Variation is another take); the crowd stops at the Duration less its Ring-out (cwTail), so with
  // no room the last stretch is silent and with one only the reverb rings there; and a Variations pack of a crowd is
  // levelled like any other (cwPeak is the engine's, so `gain` stays a plain level: blast's lesson).
  t("crowd/drawn-only-when-used-presets-audible-ring-out-and-variations-levelled", function () {
    const bad = [], cwKeys = PARAMS.filter(function (p) { return p[7] === "Crowd"; }).map(function (p) { return p[0]; });
    if (cwKeys.length !== 21 || WAVES[37] !== "crowd") bad.push("rows " + cwKeys.length + ", wave 37 " + WAVES[37]);
    const coin = withState(PRESETS["Coin"], genomeFromState), cheer = withState(PRESETS["Crowd Cheer"], genomeFromState);
    cwKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, cheer)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[1].indexOf(37) >= 0; })) bad.push("not in the engine picker");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Crowd"]');
    if (!panel || !panel.hidden) bad.push("Crowd panel shown for a Coin");
    applyPreset(PRESETS["Crowd Cheer"], "Crowd Cheer");
    if (!panel || panel.hidden) bad.push("Crowd panel hidden for Crowd Cheer");
    if (durationMax(state) < 4.4) bad.push("Duration slider stops at " + durationMax(state) + " s on a 4.4 s crowd");
    ["Crowd Cheer", "Crowd Applause", "Stadium Chant", "Audience Ooh", "Audience Aww", "Audience Gasp", "Crowd Chatter"].forEach(function (n) {
      [PRESETS[n]].concat(PRESETS[n]._alts || []).forEach(function (p, j) {
        if (Math.round(p.wave) !== 37) bad.push(n + " #" + j + " not crowd");
        const r = withState(p, render); let pk = 0, side = 0, nan = 0;
        for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); }
        if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.95 || !(side > 0)) bad.push(n + " #" + j + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan);
      });
    });
    const p0 = PRESETS["Audience Gasp"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { cwSeed: p0.cwSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("cwSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    // the ring-out: Crowd Chatter talks to the end of its crowd; dry, its last 0.9 s (the ring-out) is silent, with no
    // ring-out the talk runs on into it, and with its room the reverb rings there
    const pc = PRESETS["Crowd Chatter"], cut = pc.duration - pc.cwTail;
    const tailRms = function (r) { let s = 0, m = 0; for (let i = Math.floor((cut + 0.01) * SR); i < r.L.length; i++) { s += r.L[i] * r.L[i] + r.R[i] * r.R[i]; m++; } return Math.sqrt(s / Math.max(1, m)); };
    const dry = tailRms(withState(Object.assign({}, pc, { reverb: 0 }), render)), noTail = tailRms(withState(Object.assign({}, pc, { reverb: 0, cwTail: 0 }), render));
    const wet = tailRms(withState(pc, render));
    if (!(dry < 1e-4) || !(noTail > 1e-2) || !(wet > 1e-3)) bad.push("ring-out: dry " + dry.toExponential(1) + ", no ring-out " + noTail.toExponential(1) + ", wet " + wet.toExponential(1));
    const rnd = Math.random; let rs = 37; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Audience Gasp"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "6"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-13. THE GUN ENGINE (wave 38): its rows are drawn only by a gun sound (and its panel shown only for it); every
  // gun preset and alt (AJ's eight blind picks and the ten redo picks) renders audible, stereo, finite, under full scale and seeded; a BURST really re-fires: every
  // round of Full Auto, 3-Round Burst and Machine Gun is a peak at its own time and a new shot (consecutive rounds are
  // not the same samples), where Repeat re-gated one envelope; AJ's rule holds (no gun preset lands a casing or racks a
  // pump after the shot); and a Variations pack of a gun is levelled like any other (gunPeak is the engine's).
  t("gun/drawn-only-when-used-presets-audible-bursts-refire-and-variations-levelled", function () {
    const bad = [], gunKeys = PARAMS.filter(function (p) { return p[7] === "Gun"; }).map(function (p) { return p[0]; });
    if (gunKeys.length !== 21 || WAVES[38] !== "gun") bad.push("rows " + gunKeys.length + ", wave 38 " + WAVES[38]);
    const coin = withState(PRESETS["Coin"], genomeFromState), shot = withState(PRESETS["Gunshot"], genomeFromState);
    gunKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, shot)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[1].indexOf(38) >= 0; })) bad.push("not in the engine picker");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Gun"]');
    if (!panel || !panel.hidden) bad.push("Gun panel shown for a Coin");
    applyPreset(PRESETS["Gunshot"], "Gunshot");
    if (!panel || panel.hidden) bad.push("Gun panel hidden for Gunshot");
    if (durationMax(state) < 2) bad.push("Duration slider stops at " + durationMax(state) + " s on a gun");
    applyPreset(PRESETS["Full Auto"], "Full Auto");
    if (durationMax(state) < PRESETS["Full Auto"].duration) bad.push("Duration slider stops at " + durationMax(state) + " s on a " + PRESETS["Full Auto"].duration + " s Full Auto");
    const names = ["Gunshot", "Shotgun", "Rifle Crack", "Magnum Shot", "Suppressed", "Full Auto", "3-Round Burst", "Machine Gun",
      "Compact Fire", "Gunshot 2", "Heavy Discharge", "Heavy Round", "Magnum Fire", "Shotgun 2", "Snub Discharge", "Snub Report",
      "Suppressed Crack", "Suppressed Fire"];
    names.forEach(function (n) {
      [PRESETS[n]].concat(PRESETS[n]._alts || []).forEach(function (p, j) {
        if (Math.round(p.wave) !== 38) bad.push(n + " #" + j + " not gun");
        if ((p.gunCasing || 0) > 0 || (Math.round(p.gunAction) === 3 || Math.round(p.gunAction) === 4) && (p.gunMech || 0) > 0) bad.push(n + " #" + j + " has an after-sound");
        if (Math.round(p.repeat || 1) !== 1) bad.push(n + " #" + j + " uses Repeat");
        const r = withState(p, render); let pk = 0, side = 0, nan = 0;
        for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); }
        if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.95 || !(side > 0)) bad.push(n + " #" + j + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan);
      });
    });
    // a burst: Rounds shots at the engine's own times, each a peak, each a NEW shot
    [["Full Auto", 18], ["3-Round Burst", 3], ["Machine Gun", 8]].forEach(function (e) {
      const p = PRESETS[e[0]], st = Object.assign({}, PARAM_DEFAULTS, p), g = makeGun(SR, Math.floor(st.duration * SR), gunCfg(st), Math.round(st.gunSeed));
      const r = withState(p, render), m = Float64Array.from(r.L, function (x, i) { return x + r.R[i]; }), times = g.info.times;
      if (times.length !== e[1] || Math.round(p.gunRounds) !== e[1]) bad.push(e[0] + ": " + times.length + " rounds");
      let all = 0; for (let i = 0; i < m.length; i++) all = Math.max(all, Math.abs(m[i]));
      const at = times.map(function (t) { return Math.round(t * SR); });
      at.forEach(function (a, k) { let p0 = 0; for (let i = a; i < a + 220; i++) p0 = Math.max(p0, Math.abs(m[i])); if (p0 < 0.25 * all) bad.push(e[0] + " round " + (k + 1) + " missing"); });
      let same = 0;
      for (let k = 0; k + 1 < at.length; k++) { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < 882; i++) { const x = m[at[k] + i], y = m[at[k + 1] + i]; ab += x * y; aa += x * x; bb += y * y; } if (ab / Math.sqrt(aa * bb) > 0.95) same++; }
      if (same) bad.push(e[0] + ": " + same + " rounds a copy of the one before");
    });
    const p0 = PRESETS["Gunshot"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { gunSeed: p0.gunSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("gunSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    const rnd = Math.random; let rs = 38; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Gunshot", "Rifle Crack", "Full Auto"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-13. THE ENERGY ENGINE (wave 39): its rows are drawn only by an energy sound (and its panel shown only for it);
  // every energy preset (AJ's five blind picks: Plasma Rifle, Plasma Shot, Plasma Discharge, Rail Fire and the new Pulse
  // Rifle) renders audible, stereo, finite, under full scale, seeded and without Repeat; Pulse Rifle's FULL AUTO really
  // re-fires: every round is a peak at the engine's own time and a new shot (consecutive rounds are not the same
  // samples); and a Variations pack of an energy sound is levelled like any other (enPeak is the engine's).
  t("energy/drawn-only-when-used-presets-audible-pulse-rifle-refires-and-variations-levelled", function () {
    const bad = [], enKeys = PARAMS.filter(function (p) { return p[7] === "Energy"; }).map(function (p) { return p[0]; });
    if (enKeys.length !== 15 || WAVES[39] !== "energy") bad.push("rows " + enKeys.length + ", wave 39 " + WAVES[39]);
    const coin = withState(PRESETS["Coin"], genomeFromState), shot = withState(PRESETS["Plasma Rifle"], genomeFromState);
    enKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, shot)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[1].indexOf(39) >= 0; })) bad.push("not in the engine picker");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Energy"]');
    if (!panel || !panel.hidden) bad.push("Energy panel shown for a Coin");
    applyPreset(PRESETS["Rail Fire"], "Rail Fire");
    if (!panel || panel.hidden) bad.push("Energy panel hidden for Rail Fire");
    if (durationMax(state) < PRESETS["Rail Fire"].duration) bad.push("Duration slider stops at " + durationMax(state) + " s on a " + PRESETS["Rail Fire"].duration + " s Rail Fire");
    const names = ["Plasma Rifle", "Plasma Shot", "Plasma Discharge", "Rail Fire", "Pulse Rifle"];
    if (!PRESET_CATEGORIES.some(function (c) { return c[0] === "Guns" && c[1].indexOf("Pulse Rifle") >= 0; })) bad.push("Pulse Rifle not in Guns");
    names.forEach(function (n) {
      [PRESETS[n]].concat(PRESETS[n]._alts || []).forEach(function (p, j) {
        if (Math.round(p.wave) !== 39) bad.push(n + " #" + j + " not energy");
        if (Math.round(p.repeat || 1) !== 1) bad.push(n + " #" + j + " uses Repeat");
        if ((p.limiter || 0) > 0) bad.push(n + " #" + j + " uses the master Limiter");
        const r = withState(p, render); let pk = 0, side = 0, nan = 0;
        for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); }
        if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.95 || !(side > 0)) bad.push(n + " #" + j + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan);
      });
    });
    // full auto: Rounds shots at the engine's own times, each a peak, each a NEW shot
    [["Pulse Rifle", 14]].forEach(function (e) {
      const p = PRESETS[e[0]], st = Object.assign({}, PARAM_DEFAULTS, p), g = makeEnergy(SR, Math.floor(st.duration * SR), energyCfg(st), Math.round(st.enSeed));
      const r = withState(p, render), m = Float64Array.from(r.L, function (x, i) { return x + r.R[i]; }), times = g.info.shots;
      if (times.length !== e[1] || Math.round(p.enRounds) !== e[1]) bad.push(e[0] + ": " + times.length + " rounds");
      let all = 0; for (let i = 0; i < m.length; i++) all = Math.max(all, Math.abs(m[i]));
      const at = times.map(function (t) { return Math.round(t * SR); });
      at.forEach(function (a, k) { let p0 = 0; for (let i = a; i < a + 220; i++) p0 = Math.max(p0, Math.abs(m[i])); if (p0 < 0.25 * all) bad.push(e[0] + " round " + (k + 1) + " missing"); });
      let same = 0;
      for (let k = 0; k + 1 < at.length; k++) { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < 882; i++) { const x = m[at[k] + i], y = m[at[k + 1] + i]; ab += x * y; aa += x * x; bb += y * y; } if (ab / Math.sqrt(aa * bb) > 0.95) same++; }
      if (same) bad.push(e[0] + ": " + same + " rounds a copy of the one before");
    });
    const p0 = PRESETS["Plasma Shot"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { enSeed: p0.enSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("enSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    const rnd = Math.random; let rs = 39; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Plasma Rifle", "Rail Fire", "Pulse Rifle"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-13. THE CHIP GUN ENGINE (wave 40): its rows are drawn only by a chip gun sound (and its panel shown only for
  // it); every chip gun preset and its alt (AJ's four blind picks: Woodgrain Shot, Mega Shot and 8-Bit Laser, each with
  // today's sound kept as its alt, and the new Chip Machine Gun) renders audible, finite, under full scale, seeded,
  // without Repeat or the master Limiter, and CENTERED (the machines were mono); a base and its alt sit within 2 dB of
  // each other (BS.1770, as the levels were set), so a repeat click does not jump; Chip Machine Gun really re-fires ON
  // FRAMES: every round a peak at a whole number of 60 Hz frames, each a new shot (consecutive rounds are not the same
  // samples); a Variations pack is levelled like any other (cgPeak is the engine's); and no chip gun label, enum or help
  // line names a console or a chip (the machines are described by their sound).
  t("chipgun/drawn-only-when-used-presets-centered-and-levelled-machine-gun-refires-on-frames-no-brand-names", function () {
    const bad = [], cgKeys = PARAMS.filter(function (p) { return p[7] === "Chip gun"; }).map(function (p) { return p[0]; });
    if (cgKeys.length !== 16 || WAVES[40] !== "chipgun") bad.push("rows " + cgKeys.length + ", wave 40 " + WAVES[40]);
    const coin = withState(PRESETS["Coin"], genomeFromState), shot = withState(PRESETS["Woodgrain Shot"], genomeFromState);
    cgKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, shot)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[1].indexOf(40) >= 0; })) bad.push("not in the engine picker");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Chip gun"]');
    if (!panel || !panel.hidden) bad.push("Chip gun panel shown for a Coin");
    applyPreset(PRESETS["Chip Machine Gun"], "Chip Machine Gun");
    if (!panel || panel.hidden) bad.push("Chip gun panel hidden for Chip Machine Gun");
    const sec = PRESET_CATEGORIES.find(function (c) { return c[0] === "Consoles / Chiptune"; });
    if (!sec || sec[1].indexOf("Chip Machine Gun") !== sec[1].indexOf("Woodgrain Shot") + 1) bad.push("Chip Machine Gun not right after Woodgrain Shot");
    // integrated loudness (BS.1770: K-weighted, 400 ms blocks, gated), the measure the levels were set on
    const lufs = function (L, R) {
      const bq = function (x, b0, b1, b2, a0, a1, a2) { const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
      const kw = function (x) {
        const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, c = Math.cos(w), al = Math.sin(w) * 0.7071067811865476, sa = 2 * Math.sqrt(A) * al;
        const s = bq(x, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa), (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
        const w2 = 2 * Math.PI * 38 / SR, c2 = Math.cos(w2), al2 = Math.sin(w2);
        return bq(s, (1 + c2) / 2, -(1 + c2), (1 + c2) / 2, 1 + al2, -2 * c2, 1 - al2);
      };
      const kl = kw(L), kr = kw(R), B = Math.round(0.4 * SR), H = Math.round(0.1 * SR), ms = [];
      const block = function (a, b) { let s = 0; for (let i = a; i < b; i++) s += kl[i] * kl[i] + kr[i] * kr[i]; return s / (b - a); };
      if (L.length <= B) ms.push(block(0, L.length)); else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
      const l = function (m) { return -0.691 + 10 * Math.log10(m || 1e-12); };
      let g = ms.filter(function (m) { return l(m) > -70; }); if (!g.length) return -70;
      const rel = l(g.reduce(function (t, m) { return t + m; }, 0) / g.length) - 10; g = g.filter(function (m) { return l(m) > rel; });
      return l(g.reduce(function (t, m) { return t + m; }, 0) / g.length);
    };
    ["Woodgrain Shot", "Mega Shot", "8-Bit Laser", "Chip Machine Gun"].forEach(function (n) {
      const lv = [];
      [PRESETS[n]].concat(PRESETS[n]._alts || []).forEach(function (p, j) {
        if (j === 0 && Math.round(p.wave) !== 40) bad.push(n + " base not chipgun");
        if (Math.round(p.repeat || 1) !== 1) bad.push(n + " #" + j + " uses Repeat");
        if ((p.limiter || 0) > 0) bad.push(n + " #" + j + " uses the master Limiter");
        if ((p.gain == null ? 0.7 : p.gain) > 1) bad.push(n + " #" + j + " gain over 1");
        const r = withState(p, render); let pk = 0, side = 0, nan = 0;
        for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); }
        if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.95) bad.push(n + " #" + j + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan);
        if (Math.round(p.wave) === 40 && side !== 0) bad.push(n + " #" + j + " not centered");
        lv.push(lufs(r.L, r.R));
      });
      if (lv.length < 2) bad.push(n + " has no alt");
      else if (Math.abs(lv[0] - lv[1]) > 2) bad.push(n + " base " + lv[0].toFixed(1) + " vs alt " + lv[1].toFixed(1) + " LUFS");
    });
    // full auto, base (8-bit) and alt (FM): Rounds shots on whole frames, each a peak, each a NEW shot
    [[PRESETS["Chip Machine Gun"], 14, 4], [PRESETS["Chip Machine Gun"]._alts[0], 12, 5]].forEach(function (e, j) {
      const p = e[0], st = Object.assign({}, PARAM_DEFAULTS, p), g = makeChipgun(SR, Math.floor(st.duration * SR), chipgunCfg(st), Math.round(st.cgSeed));
      const r = withState(p, render), m = Float64Array.from(r.L, function (x, i) { return x + r.R[i]; }), times = g.info.shots, who = "Chip Machine Gun #" + j;
      if (times.length !== e[1] || Math.round(p.cgRounds) !== e[1]) bad.push(who + ": " + times.length + " rounds");
      times.forEach(function (tm, k) { if (k && Math.abs((tm - times[k - 1]) * 60 - e[2]) > 1e-9) bad.push(who + " round " + (k + 1) + " off its frame"); });
      let all = 0; for (let i = 0; i < m.length; i++) all = Math.max(all, Math.abs(m[i]));
      const at = times.map(function (tm) { return Math.round(tm * SR); });
      at.forEach(function (a, k) { let p0 = 0; for (let i = a; i < a + 220; i++) p0 = Math.max(p0, Math.abs(m[i])); if (p0 < 0.25 * all) bad.push(who + " round " + (k + 1) + " missing"); });
      let copies = 0;
      for (let k = 0; k + 1 < at.length; k++) { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < 882; i++) { const x = m[at[k] + i], y = m[at[k + 1] + i]; ab += x * y; aa += x * x; bb += y * y; } if (ab / Math.sqrt(aa * bb) > 0.95) copies++; }
      if (copies) bad.push(who + ": " + copies + " rounds a copy of the one before");
    });
    const p0 = PRESETS["Woodgrain Shot"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { cgSeed: p0.cgSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("cgSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    // no console or chip names anywhere a user reads about this engine (CONSOLE_HELP may: it is the Consoles strip's)
    const BRAND = /\b(NES|SNES|Famicom|Nintendo|Sega|Genesis|Mega ?Drive|Game ?Boy|Atari|Commodore|C64|SID|Neo ?Geo|PC ?Engine|TurboGrafx|Amiga|Yamaha|YM ?\d+|2A03|SN76489|SPC ?700|S-DSP|Sony|PlayStation|Master System)\b/i;
    const prose = [WAVES[40], WAVE_HELP.chipgun || "", panel ? words(panel) : ""];
    PARAMS.filter(function (p) { return p[7] === "Chip gun"; }).forEach(function (p) { prose.push(p[1], PARAM_HELP[p[0]] || "", (p[9] || []).join(" ")); if (!PARAM_HELP[p[0]]) bad.push(p[0] + " has no help"); });
    if (!WAVE_HELP.chipgun) bad.push("no WAVE_HELP for chipgun");
    prose.forEach(function (x) { const m = BRAND.exec(x); if (m) bad.push("names \"" + m[0] + "\""); });
    const rnd = Math.random; let rs = 40; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Woodgrain Shot", "Mega Shot", "Chip Machine Gun"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-13. THE GUN FOLEY ENGINE (wave 41): everything around the shot. Its rows are drawn only by a gun foley sound
  // (and its panel shown only for it); every gun foley preset (AJ's blind picks: Shell Casing, Ricochet Zing, Bullet Whiz
  // and Bolt-Action Reload replaced in place, Revolver Spin and Dry Fire new, in Guns beside Shell Casing and the reloads)
  // is the action it names, renders audible, stereo, finite, under full scale, seeded, without Repeat, the master Limiter
  // or a gain over 1, and is never cut (the action ends inside its Duration); a Variations pack is levelled like any other
  // (gfPeak is the engine's); and no gun foley label, enum or help line names a real firearm.
  t("gunfoley/drawn-only-when-used-presets-audible-and-whole-variations-levelled-no-firearm-names", function () {
    const bad = [], gfKeys = PARAMS.filter(function (p) { return p[7] === "Gun foley"; }).map(function (p) { return p[0]; });
    if (gfKeys.length !== 21 || WAVES[41] !== "gunfoley") bad.push("rows " + gfKeys.length + ", wave 41 " + WAVES[41]);
    const coin = withState(PRESETS["Coin"], genomeFromState), spin = withState(PRESETS["Revolver Spin"], genomeFromState);
    gfKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, spin)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[1].indexOf(41) >= 0; })) bad.push("not in the engine picker");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Gun foley"]');
    if (!panel || !panel.hidden) bad.push("Gun foley panel shown for a Coin");
    applyPreset(PRESETS["Revolver Spin"], "Revolver Spin");
    if (!panel || panel.hidden) bad.push("Gun foley panel hidden for Revolver Spin");
    if (durationMax(state) < 2) bad.push("Duration slider stops at " + durationMax(state) + " s on a gun foley sound");
    const guns = (PRESET_CATEGORIES.find(function (c) { return c[0] === "Guns"; }) || [0, []])[1];
    ["Revolver Spin", "Dry Fire"].forEach(function (n) { if (guns.indexOf(n) < 0 || guns.indexOf(n) > guns.indexOf("Bolt-Action Reload") + 2) bad.push(n + " not beside the reloads in Guns"); });
    const want = { "Shell Casing": "casing", "Ricochet Zing": "ricochet", "Bullet Whiz": "bullet pass", "Bolt-Action Reload": "bolt reload", "Revolver Spin": "revolver spin", "Dry Fire": "dry fire" };
    Object.keys(want).forEach(function (n) {
      const p = PRESETS[n];
      if (!p || Math.round(p.wave) !== 41) { bad.push(n + " not gun foley"); return; }
      if (Math.round(p.repeat || 1) !== 1) bad.push(n + " uses Repeat");
      if ((p.limiter || 0) > 0) bad.push(n + " uses the master Limiter");
      if ((p.gain == null ? 0.7 : p.gain) > 1) bad.push(n + " gain over 1");
      const st = Object.assign({}, PARAM_DEFAULTS, p), g = makeGunfoley(SR, Math.floor(st.duration * SR), gunfoleyCfg(st), Math.round(st.gfSeed));
      if (g.info.action !== want[n]) bad.push(n + " is a " + g.info.action);
      if (g.info.end > st.duration + 0.001) bad.push(n + " cut: the action runs " + g.info.end.toFixed(3) + " s in a " + st.duration + " s sound");
      const r = withState(p, render); let pk = 0, side = 0, nan = 0, dc = 0;
      for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); dc += r.L[i] + r.R[i]; }
      if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.95 || !(side > 0) || Math.abs(dc / (2 * r.L.length)) > 1e-4) bad.push(n + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan + " dc " + (dc / (2 * r.L.length)).toExponential(1));
    });
    if (Math.round(PRESETS["Bolt-Action Reload"].gfLoad) !== 2) bad.push("Bolt-Action Reload is not the single round AJ picked");
    if (PRESETS["Bullet Whiz"] && 220 + 730 * PRESETS["Bullet Whiz"].gfSpeed >= 343) bad.push("Bullet Whiz is not the subsonic whiz AJ picked");
    const p0 = PRESETS["Dry Fire"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { gfSeed: p0.gfSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("gfSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    // no real firearm's maker or model anywhere a user reads about this engine
    const BRAND = /\b(Glock|Colt|Beretta|Remington|Winchester|Mossberg|Wesson|Ruger|SIG|Sauer|Kalashnikov|AK-?\d+|AR-?1[05]|M16|M4|M1911|1911|Mauser|Enfield|Springfield|Desert Eagle|Uzi|Thompson|Walther|Luger|Browning|Benelli|Heckler|Koch|MP5|Garand|Mosin|Nagant|SKS|Tavor|FN|SCAR|Henry|Marlin|Savage|Taurus|Kimber)\b/i;
    const prose = [WAVES[41], WAVE_HELP.gunfoley || "", panel ? words(panel) : ""];
    PARAMS.filter(function (p) { return p[7] === "Gun foley"; }).forEach(function (p) { prose.push(p[1], PARAM_HELP[p[0]] || "", (p[9] || []).join(" ")); if (!PARAM_HELP[p[0]]) bad.push(p[0] + " has no help"); });
    if (!WAVE_HELP.gunfoley) bad.push("no WAVE_HELP for gunfoley");
    prose.forEach(function (x) { const m = BRAND.exec(x); if (m) bad.push("names \"" + m[0] + "\""); });
    const rnd = Math.random; let rs = 41; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Revolver Spin", "Bolt-Action Reload", "Ricochet Zing"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-13. THE VOICE ENGINE (wave 42): a person's cries, the game voice clip. Its rows are drawn only by a voice
  // sound (and its panel, with the Body box, shown only for one); every voice preset (AJ's picks: Battle Cry, Sword Cry,
  // Jump Hup, Falling Scream, Hurt Grunt and Woman Hurt Cry new in Voice / Vocal; Enemy Death replaced in place in Hits /
  // Melee, its thud a layer and today's formant yell kept as an alt) is the cry it names, renders audible, finite, mono,
  // under 0.98, without DC, Repeat, the master Limiter or a gain over 1, and is never cut (the cry ends inside its
  // Duration); a base and its alts play within 2.5 dB of each other (gated RMS; LUFS within 2 dB in SOUND-REVIEW.md);
  // the seed is the take; a Variations pack is levelled like any other; a CUSTOM cry's typed Body (voBody, an SFX_EXTRAS
  // field) survives a share link and is what it plays; and no label, enum or help line names a game, a character or a
  // company.
  t("voice/drawn-only-when-used-presets-audible-whole-and-level-custom-body-round-trips-no-names", function () {
    const bad = [], voKeys = PARAMS.filter(function (p) { return p[7] === "Vocal"; }).map(function (p) { return p[0]; });
    if (voKeys.length !== 21 || WAVES[42] !== "voice") bad.push("rows " + voKeys.length + ", wave 42 " + WAVES[42]);
    const coin = withState(PRESETS["Coin"], genomeFromState), cry = withState(PRESETS["Battle Cry"], genomeFromState);
    voKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, cry)) bad.push(k + " drawn wrong"); });
    if (!ENGINE_CATS.some(function (c) { return c[0] === "Voice" && c[1].indexOf(42) >= 0; })) bad.push("not in the engine picker's Voice family");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Vocal"]');
    if (!panel || !panel.hidden) bad.push("Vocal panel shown for a Coin");
    applyPreset(PRESETS["Battle Cry"], "Battle Cry");
    if (!panel || panel.hidden) bad.push("Vocal panel hidden for Battle Cry");
    if (!panel || !panel.querySelector("#voBodyInput")) bad.push("no Body box in the Vocal panel");
    if (durationMax(state) < 2) bad.push("Duration slider stops at " + durationMax(state) + " s on a voice");
    const vocal = (PRESET_CATEGORIES.find(function (c) { return c[0] === "Voice / Vocal"; }) || [0, []])[1];
    const melee = (PRESET_CATEGORIES.find(function (c) { return c[0] === "Hits / Melee"; }) || [0, []])[1];
    ["Battle Cry", "Sword Cry", "Jump Hup", "Falling Scream", "Hurt Grunt", "Woman Hurt Cry"].forEach(function (n) { if (vocal.indexOf(n) < 0) bad.push(n + " not in Voice / Vocal"); });
    if (melee.indexOf("Enemy Death") < 0) bad.push("Enemy Death left Hits / Melee");
    const want = { "Battle Cry": "battle cry", "Sword Cry": "sword cry", "Jump Hup": "hup", "Falling Scream": "fall scream", "Hurt Grunt": "hurt", "Woman Hurt Cry": "big hurt", "Enemy Death": "death cry" };
    const SR_ = SR, cut = function (p) { const st = Object.assign({}, PARAM_DEFAULTS, p); return makeVoice(SR_, voiceCfg(st)).info.len - st.duration; };
    Object.keys(want).forEach(function (n) {
      const p = PRESETS[n];
      if (!p || Math.round(p.wave) !== 42) { bad.push(n + " not a voice"); return; }
      const takes = [p].concat(p._alts || []), levels = [];
      takes.forEach(function (a, j) {
        const nm = n + (j ? " alt " + j : "");
        if (Math.round(a.wave) !== 42) { if (n === "Enemy Death" && j === takes.length - 1 && Math.round(a.wave) === 13) { levels.push(null); return; } bad.push(nm + " not a voice"); return; }
        if (!j && makeVoice(SR_, voiceCfg(Object.assign({}, PARAM_DEFAULTS, a))).info.cry !== want[n]) bad.push(nm + " is not a " + want[n]);
        if (Math.round(a.repeat || 1) !== 1) bad.push(nm + " uses Repeat");
        if ((a.limiter || 0) > 0) bad.push(nm + " uses the master Limiter");
        if ((a.gain == null ? 0.7 : a.gain) > 1) bad.push(nm + " gain over 1");
        if (cut(a) > 0.0005) bad.push(nm + " cut: the cry runs " + cut(a).toFixed(3) + " s past its Duration");
        const r = withState(a, render); let pk = 0, side = 0, nan = 0, dc = 0;
        for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); dc += r.L[i] + r.R[i]; }
        if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.98 || (side > 1e-3 && !a.reverb) || Math.abs(dc / (2 * r.L.length)) > 1e-4) bad.push(nm + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan + " side " + side.toFixed(4) + " dc " + (dc / (2 * r.L.length)).toExponential(1));
        levels.push(20 * Math.log10(gatedRms(r.L, r.R)));
      });
      const lv = levels.filter(function (x) { return x != null; });
      if (Math.max.apply(null, lv) - Math.min.apply(null, lv) > 2.5) bad.push(n + " base and alts span " + (Math.max.apply(null, lv) - Math.min.apply(null, lv)).toFixed(2) + " dB");
    });
    const ed = PRESETS["Enemy Death"];
    if (!ed || !ed.layers || JSON.parse(ed.layers).length !== 1 || JSON.parse(ed.layers)[0].s.cutoff !== 400) bad.push("Enemy Death lost its thud layer");
    const p0 = PRESETS["Jump Hup"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { voSeed: p0.voSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("voSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    // a CUSTOM cry's typed Body travels with the sound: a share link carries it, applying the link plays the same audio,
    // and the Body is what it plays (NEGATIVES: another Body, and no Body, each sound different)
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      const hiyah = (PRESETS["Sword Cry"]._alts || []).find(function (a) { return a.voBody; });
      if (!hiyah || Math.round(hiyah.voCry) !== 10) bad.push("no custom take among Sword Cry's alts");
      else {
        applyPreset(hiyah, "Probe");
        const heard = audio(render()), link = decodePatch(encodePatch()).s;
        if (link.voBody !== hiyah.voBody) bad.push("the link dropped the Body: " + JSON.stringify(link.voBody));
        applyPreset(PRESETS["Coin"], "Coin"); applyPreset(link, "Shared");
        if (state.voBody !== hiyah.voBody || audio(render()) !== heard) bad.push("the link did not play the same cry back");
        if (audio(withState(Object.assign({}, hiyah, { voBody: "oo AE:4" }), render)) === heard) bad.push("another Body plays the same");
        if (audio(withState(Object.assign({}, hiyah, { voBody: "" }), render)) === heard) bad.push("no Body plays the same");
        // a typed body far too long or too held is bounded, never a huge buffer or a NaN
        const big = withState(Object.assign({}, hiyah, { voBody: new Array(200).join("n:1000 AH:0 "), duration: 2 }), function () { return makeVoice(SR_, voiceCfg(state)); });
        if (!(big.info.len <= 8.01) || big.L.some(function (x) { return x !== x; })) bad.push("a long typed body: " + big.info.len + " s");
      }
    } finally { applyPreset(keep, keepLabel); }
    // no game, character or company names anywhere a user reads about this engine
    const NAMES = /\b(Nintendo|Sega|Capcom|Konami|Namco|Taito|SNK|Sony|Atari|SNES|Famicom|Genesis|Mega ?Drive|Street Fighter|Final Fight|Streets of Rage|Double Dragon|Golden Axe|Mortal Kombat|Tekken|Zelda|Mario|Sonic|Mega ?Man|Castlevania|Ryu|Chun-?Li|Wilhelm|Howie|S-DSP|SPC ?700)\b/i;
    const prose = [WAVES[42], WAVE_HELP.voice || "", panel ? words(panel) : ""];
    PARAMS.filter(function (p) { return p[7] === "Vocal"; }).forEach(function (p) { prose.push(p[1], PARAM_HELP[p[0]] || "", (p[9] || []).join(" ")); if (!PARAM_HELP[p[0]]) bad.push(p[0] + " has no help"); });
    if (!WAVE_HELP.voice) bad.push("no WAVE_HELP for voice");
    prose.forEach(function (x) { const m = NAMES.exec(x); if (m) bad.push("names \"" + m[0] + "\""); });
    const rnd = Math.random; let rs = 42; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      ["Battle Cry", "Jump Hup", "Falling Scream"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  // 2026-11-14. THE MELEE ENGINE (wave 43): a weapon swung and landing in something. Its rows are drawn only by a melee
  // sound (and its panel shown only for one), in the Foley family beside the gun; every melee preset (AJ's picks, each
  // replacing today's in place in Hits / Melee: Katana Slice, Axe Chop, Sword Clash, Hammer Smash, Dagger Stab, Shield
  // Block, Critical Slash, and Punch / Kick with three alts) is the weapon and target it names, renders audible, finite,
  // stereo, under 0.98, without DC, Repeat, the master Limiter, a gain over 1 or a Peak past 2, and is never cut (the
  // blow ends inside its Duration); Punch / Kick and its alts play within 2.5 dB of each other (gated RMS; LUFS within 2
  // dB in SOUND-REVIEW.md); the seed is the take; Peak control lifts the hit; a Variations pack is levelled like any
  // other; and no label, enum or help line names a game, a film or a company. The MELEE REDO (2026-11-14, AJ: "all of
  // the melee redos are actually very good") holds to the same: the rest of the section's blows, 34 replaced in place and
  // four (Visor Clank, Sword Ting, Hit, Crossbow Bolt) joining today's base as an alt, each a melee take in Hits / Melee.
  t("melee/drawn-only-when-used-presets-audible-whole-and-level-variations-levelled-no-names", function () {
    const bad = [], mlKeys = PARAMS.filter(function (p) { return p[7] === "Melee"; }).map(function (p) { return p[0]; });
    if (mlKeys.length !== 23 || WAVES[43] !== "melee") bad.push("rows " + mlKeys.length + ", wave 43 " + WAVES[43]);
    const coin = withState(PRESETS["Coin"], genomeFromState), cut0 = withState(PRESETS["Katana Slice"], genomeFromState);
    mlKeys.forEach(function (k) { if (!undrawn(k, coin) || undrawn(k, cut0)) bad.push(k + " drawn wrong"); });
    const foley = ENGINE_CATS.find(function (c) { return c[0] === "Foley"; });
    if (!foley || foley[1].indexOf(43) !== foley[1].indexOf(38) + 1) bad.push("not in the engine picker's Foley family beside the gun");
    applyPreset(PRESETS["Coin"], "Coin");
    const panel = document.querySelector('#panels [data-group="Melee"]');
    if (!panel || !panel.hidden) bad.push("Melee panel shown for a Coin");
    applyPreset(PRESETS["Katana Slice"], "Katana Slice");
    if (!panel || panel.hidden) bad.push("Melee panel hidden for Katana Slice");
    if (durationMax(state) < 2) bad.push("Duration slider stops at " + durationMax(state) + " s on a melee sound");
    const melee = (PRESET_CATEGORIES.find(function (c) { return c[0] === "Hits / Melee"; }) || [0, []])[1];
    // [weapon, target, hit] each names (hit 0 = the weapon's own); the kick is Punch / Kick's last alt
    const want = { "Katana Slice": [3, 1, 1], "Axe Chop": [4, 2, 1], "Sword Clash": [2, 8, 1], "Hammer Smash": [5, 4, 2], "Dagger Stab": [1, 1, 3],
      "Shield Block": [2, 5, 1], "Critical Slash": [2, 3, 1], "Punch / Kick": [0, 1, 2] };
    // the blow's own end as AJ heard it (Peak control off, trimmed where it falls 60 dB under its peak: the take's length)
    // against its Duration; the engine ends a blow at its Duration, so measuring the render itself could never fail
    const SR_ = SR, cut = function (p) { const st = Object.assign({}, PARAM_DEFAULTS, p); return makeMelee(SR_, meleeCfg(Object.assign({}, st, { duration: 0, meleePeak: 0 })), Math.round(st.meleeSeed)).info.len - st.duration; };
    // one melee take, whole and levelled: no Repeat, master Limiter, gain over 1 or Peak past 2; never cut; audible,
    // finite, stereo, under 0.98, no DC. Returns its gated RMS (dB). PEAK PAST 2, NOT 1.2: the row stopped at 1.2 (the
    // gun's ceiling) until AJ chose to "meet in between" (2026-11-14, SOUND-REVIEW.md): a high-crest blow short of the
    // level of the preset it replaced is lifted half the gap, and the second full pass up to 2 is how; the engine clamps
    // at 2, so this holds the presets to the engine's own range rather than to a number.
    const whole = function (nm, a) {
      if (Math.round(a.repeat || 1) !== 1) bad.push(nm + " uses Repeat");
      if ((a.limiter || 0) > 0) bad.push(nm + " uses the master Limiter");
      if ((a.gain == null ? 0.7 : a.gain) > 1) bad.push(nm + " gain over 1");
      if ((a.meleePeak || 0) > 2) bad.push(nm + " Peak past 2");
      if (cut(a) > 0.0005) bad.push(nm + " cut: the blow runs " + cut(a).toFixed(3) + " s past its Duration");
      const r = withState(a, render); let pk = 0, side = 0, nan = 0, dc = 0;
      for (let i = 0; i < r.L.length; i++) { if (r.L[i] !== r.L[i] || r.R[i] !== r.R[i]) nan++; pk = Math.max(pk, Math.abs(r.L[i]), Math.abs(r.R[i])); side += Math.abs(r.L[i] - r.R[i]); dc += r.L[i] + r.R[i]; }
      if (nan || !(r.rawPeak > AUDIBLE_FLOOR) || pk > 0.98 || !(side > 0) || Math.abs(dc / (2 * r.L.length)) > 1e-4) bad.push(nm + " peak " + pk.toFixed(3) + " raw " + r.rawPeak + " nan " + nan + " side " + side.toFixed(4) + " dc " + (dc / (2 * r.L.length)).toExponential(1));
      return 20 * Math.log10(gatedRms(r.L, r.R));
    };
    Object.keys(want).forEach(function (n) {
      const p = PRESETS[n];
      if (melee.indexOf(n) < 0) bad.push(n + " left Hits / Melee");
      if (!p || Math.round(p.wave) !== 43) { bad.push(n + " not melee"); return; }
      const takes = [p].concat(p._alts || []), levels = [];
      if (n === "Punch / Kick" ? takes.length !== 4 : takes.length !== 1) bad.push(n + " has " + takes.length + " takes");
      takes.forEach(function (a, j) {
        const nm = n + (j ? " alt " + j : "");
        if (Math.round(a.wave) !== 43) { bad.push(nm + " not melee"); return; }
        const w = n === "Punch / Kick" && j === 3 ? [9, 1, 2] : want[n];
        if (Math.round(a.meleeWeapon) !== w[0] || Math.round(a.meleeTarget) !== w[1] || Math.round(a.meleeHit) !== w[2]) bad.push(nm + " is weapon " + a.meleeWeapon + " on target " + a.meleeTarget + ", hit " + a.meleeHit);
        levels.push(whole(nm, a));
      });
      if (levels.length > 1 && Math.max.apply(null, levels) - Math.min.apply(null, levels) > 2.5) bad.push(n + " base and alts span " + (Math.max.apply(null, levels) - Math.min.apply(null, levels)).toFixed(2) + " dB");
    });
    // THE MELEE REDO: 34 blows replaced in place, and four joining today's base as its last alt (today's stays the base,
    // on its own engine). Each is in Hits / Melee, a melee take, whole and levelled as above.
    const redoAlt = ["Visor Clank", "Sword Ting", "Hit", "Crossbow Bolt"];
    const redo = ["Sword Swing", "Heavy Cleave", "War Hammer Crush", "Ground Slam", "Spear Thrust", "Whip Crack", "Rapier Lunge",
      "Flail Swing", "Sword Clash 2", "Hammer Smash 2", "Katana Slice 2", "Reckless Chop", "Heavy Thrust", "Whirling Riposte",
      "Iron Slice", "Heavy Chop", "Reckless Slice", "Grim Cleave", "Swift Cleave", "Keen Cleave", "Swift Thrust",
      "Reckless Thrust", "Brutal Bash", "Grim Chop", "Reckless Clash", "Keen Swing", "Whirling Swing", "Swift Riposte",
      "Iron Clash", "Razor Cleave", "Iron Cleave", "Heavy Slice", "Swift Chop", "Whirling Chop"];
    if (redo.length + redoAlt.length !== 38) bad.push("the redo is " + (redo.length + redoAlt.length) + " sounds");
    redo.concat(redoAlt).forEach(function (n) {
      const p = PRESETS[n];
      if (melee.indexOf(n) < 0) bad.push(n + " left Hits / Melee");
      if (!p) { bad.push(n + " missing"); return; }
      const alt = redoAlt.indexOf(n) >= 0, alts = p._alts || [], a = alt ? alts[alts.length - 1] : p;
      if (alt ? Math.round(p.wave) === 43 || alts.length !== 1 : alts.length) bad.push(n + ": base wave " + p.wave + ", " + alts.length + " alts");
      if (!a || Math.round(a.wave) !== 43) { bad.push(n + " has no melee take"); return; }
      whole(n + (alt ? " alt" : ""), a);
    });
    const ed = PRESETS["Enemy Death"];
    if (!ed || Math.round(ed.wave) !== 42) bad.push("Enemy Death is no longer the voice engine's");
    const p0 = PRESETS["Dagger Stab"], again = audio(withState(p0, render)), other = audio(withState(Object.assign({}, p0, { meleeSeed: p0.meleeSeed + 1 }), render));
    if (again !== audio(withState(p0, render)) || other === again) bad.push("meleeSeed: same " + (again === audio(withState(p0, render))) + ", another differs " + (other !== again));
    // Peak control squeezes the hit, so the blow sits louder at the same peak (Normalize on)
    const hs = Object.assign({}, PRESETS["Sword Clash"], { gain: 1 }), soft = withState(Object.assign({}, hs, { meleePeak: 0 }), render), hard = withState(Object.assign({}, hs, { meleePeak: 1.2 }), render);
    if (!(gatedRms(hard.L, hard.R) > 1.2 * gatedRms(soft.L, soft.R))) bad.push("Peak control does not lift the hit: " + gatedRms(soft.L, soft.R).toFixed(4) + " -> " + gatedRms(hard.L, hard.R).toFixed(4));
    // a miss (target Air) is the swing alone, and it is audible
    const miss = withState(Object.assign({}, PRESETS["Katana Slice"], { meleeTarget: 0 }), render);
    if (!(miss.rawPeak > AUDIBLE_FLOOR)) bad.push("a miss is silent");
    // no game, film or company names anywhere a user reads about this engine
    const NAMES = /\b(Nintendo|Sega|Capcom|Konami|Namco|Taito|SNK|Sony|Atari|Street Fighter|Final Fight|Streets of Rage|Double Dragon|Golden Axe|Mortal Kombat|Tekken|Soul ?Calibur|Zelda|Mario|Sonic|Castlevania|Dark Souls|Elden Ring|Kill Bill|Star Wars|Lightsaber|Bruce Lee|Kurosawa|Samurai Jack|Ryu)\b/i;
    const prose = [WAVES[43], WAVE_HELP.melee || "", panel ? words(panel) : ""];
    PARAMS.filter(function (p) { return p[7] === "Melee"; }).forEach(function (p) { prose.push(p[1], PARAM_HELP[p[0]] || "", (p[9] || []).join(" ")); if (!PARAM_HELP[p[0]]) bad.push(p[0] + " has no help"); });
    if (!WAVE_HELP.melee) bad.push("no WAVE_HELP for melee");
    prose.forEach(function (x) { const m = NAMES.exec(x); if (m) bad.push("names \"" + m[0] + "\""); });
    const rnd = Math.random; let rs = 43; Math.random = function () { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
    try {
      // the redo's too: a whiff, a blow at Peak 2 and a clash (a Variations pack levels Peak-controlled takes alike)
      ["Katana Slice", "Hammer Smash", "Punch / Kick", "Sword Swing", "Rapier Lunge", "Iron Clash"].forEach(function (n) {
        applyPreset(PRESETS[n], n); varCountEl.value = "8"; seedVariations();
        const m = varGenomes.map(function (g) { const r = renderVariation(g); return { rms: 20 * Math.log10(gatedRms(r.L, r.R)), pk: 20 * Math.log10(peakOf(r.L, r.R)) }; });
        const rms = m.map(function (x) { return x.rms; }), spread = Math.max.apply(null, rms) - Math.min.apply(null, rms);
        const pk = Math.max.apply(null, m.map(function (x) { return x.pk; }));
        if (spread > 1 || pk > -2.9) bad.push(n + " pack spread " + spread.toFixed(2) + " dB, peak " + pk.toFixed(1));
      });
    } finally { Math.random = rnd; varCountEl.value = "8"; document.getElementById("varClose").click(); }
    return ok(!bad.length, bad.slice(0, 5).join(" · "));
  });
  t("search/the-voice-words-toriya-kiai-hyah-hup-ugh-scream", function () {
    // 2026-11-13: the voice engine's cries are found by the sound people type ("toriya", "hiyah", "hup", "ugh") and by
    // what they are; "hurt", "pain", "ouch", "oof" and "jump" keep their old aliases first and gain the cries.
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); };
    const want = { toriya: ["Battle Cry"], kiai: ["Battle Cry"], yell: ["Battle Cry"], shout: ["Battle Cry"], hyah: ["Sword Cry"], hiyah: ["Sword Cry"],
      slash: ["Sword Cry", "Critical Slash"], hup: ["Jump Hup"], jump: ["Jump Hup"], hurt: ["Hurt Grunt", "Woman Hurt Cry"], pain: ["Hurt Grunt", "Woman Hurt Cry"],
      ugh: ["Hurt Grunt", "Woman Hurt Cry"], ouch: ["Hurt Grunt", "Woman Hurt Cry"], oof: ["Hurt Grunt", "Woman Hurt Cry"], scream: ["Falling Scream"], fall: ["Falling Scream"] };
    const bad = [];
    Object.keys(want).forEach(function (q) { const got = find(q); want[q].forEach(function (n) { if (got.indexOf(n) < 0) bad.push(q + " ✗ " + n); }); });
    presetSearch.value = ""; filterPresets();
    return ok(!bad.length, bad.join(" · "));
  });
  // 2026-11-12. Variations of a LAYERED sound: every take is the whole sound (every layer, same delays and volumes), more
  // than layer 1 is varied, and the layers keep their pitch relation (one shared move), so a rooster's syllables stay in
  // tune with each other. Before, the seed was genomeFromState (no layers), so every take was the first syllable alone.
  // Also from a SELECTED layer 2: the takes are still the whole sound.
  t("variations/a-layered-sound-varies-every-layer-and-keeps-its-arrangement-and-tuning", function () {
    const bad = [];
    ["Rooster Crow", "Owl Hoot"].forEach(function (n) {
      if (!PRESETS[n] || !PRESETS[n].layers) { bad.push(n + " is not layered, so this row proves nothing"); return; }
      [0, 1].forEach(function (sel) {
        applyPreset(PRESETS[n], n);
        if (sel) layerSelect(1);
        varAmtEl.value = "0.3"; varCountEl.value = "6"; seedVariations();
        const orig = soundLayers(PRESETS[n].layers), f0 = PRESETS[n].freq;
        const rel = orig.map(function (l) { return (l.s.freq || PARAM_BY_KEY.freq[5]) / f0; });
        let movedLayers = 0;
        varGenomes.forEach(function (g, i) {
          const L = soundLayers(g.layers || "");
          if (L.length !== orig.length) { bad.push(n + " sel " + sel + " take " + (i + 1) + ": " + L.length + " layers, not " + orig.length); return; }
          L.forEach(function (l, j) {
            if (l.d !== orig[j].d || l.g !== orig[j].g || (l.p || 0) !== (orig[j].p || 0)) bad.push(n + " take " + (i + 1) + " layer " + (j + 2) + ": arrangement moved");
            const r = (l.s.freq || PARAM_BY_KEY.freq[5]) / g.freq;
            if (Math.abs(Math.log2(r / rel[j]) * 1200) > 8) bad.push(n + " take " + (i + 1) + " layer " + (j + 2) + ": out of tune by " + (Math.log2(r / rel[j]) * 1200).toFixed(1) + " cents");
            if (i && JSON.stringify(l.s) !== JSON.stringify(orig[j].s)) movedLayers++;
          });
        });
        if (!movedLayers) bad.push(n + " sel " + sel + ": no layer past the first was ever varied");
        const r = renderVariation(varGenomes[0]), whole = withState(PRESETS[n], render);
        if (r.L.length !== whole.L.length) bad.push(n + " sel " + sel + ": take 1 is not the whole sound (" + r.L.length + " vs " + whole.L.length + " samples)");
      });
    });
    varAmtEl.value = "0.2"; document.getElementById("varClose").click();
    // Leave a plain one-layer sound with layer 1 selected: a preset button on layer 2 sets only that layer (by design), so
    // the next row's clicks would otherwise land inside Owl Hoot.
    layerSelect(0); applyPreset(Object.assign({}, PRESETS["Hit"], { layers: "" }), "Hit");
    return ok(!bad.length, bad.slice(0, 4).join(" · "));
  });
  t("search/word-starts-and-a-game-dev-vocabulary", function () {
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); };
    const back = find("back"), menu = find("menu"), hit = find("hit"), coin = find("coin");
    presetSearch.value = ""; filterPresets();
    return ok(back.indexOf("Cancel") >= 0 && menu.indexOf("Cursor Move") >= 0 && hit.indexOf("Chittering Chirp") < 0 && hit.indexOf("8-Bit Hit") >= 0 && coin.indexOf("Coin") >= 0,
              [back.length, menu.length, hit.length, hit.indexOf("Chittering Chirp")].join(","));
  });
  t("search/the-glass-breaks-answer-glass-vase-potion-and-break", function () {
    // SFX 1.3 (2026-11-13): Window Smash, Bottle Break and Pot Smash don't say "glass"; the aliases must find them, and
    // "break" must not lose Wood Break (a name match always outranks an alias).
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); };
    const want = { glass: ["Glass Shatter", "Glass Clink", "Window Smash", "Bottle Break", "Pot Smash"], vase: ["Pot Smash"], potion: ["Bottle Break"],
      jar: ["Pot Smash", "Bottle Break"], "break": ["Wood Break", "Bottle Break", "Glass Shatter", "Window Smash"], shatter: ["Glass Shatter", "Window Smash"] };
    const bad = [];
    Object.keys(want).forEach(function (q) { const got = find(q); want[q].forEach(function (n) { if (got.indexOf(n) < 0) bad.push(q + " ✗ " + n); }); });
    presetSearch.value = ""; filterPresets();
    return ok(!bad.length, bad.join(" · "));
  });
  t("search/the-gun-foley-words-pump-rack-empty-click-revolver-cylinder", function () {
    // 2026-11-13: AJ picked today's Quick Reload as the pump-shotgun rack too (no duplicate preset), so "pump" and "rack"
    // must find it; "empty" and "click" find Dry Fire (an empty gun's click), "revolver" and "cylinder" Revolver Spin; and
    // "click" keeps its UI meanings (a name match and its first aliases outrank Dry Fire).
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); };
    const want = { pump: ["Quick Reload"], rack: ["Quick Reload"], empty: ["Dry Fire"], click: ["Dry Fire", "Latch Click"], revolver: ["Revolver Spin"], cylinder: ["Revolver Spin"] };
    const bad = [];
    Object.keys(want).forEach(function (q) { const got = find(q); want[q].forEach(function (n) { if (got.indexOf(n) < 0) bad.push(q + " ✗ " + n); }); });
    presetSearch.value = ""; filterPresets();
    return ok(!bad.length, bad.join(" · "));
  });
  t("search/the-jingles-victory-achievement-defeat-success-fail", function () {
    // 2026-11-14: five new game-state cues. Each is found by its own name, and by the words a dev types instead: "win" and
    // "trophy" a Victory, "trophy" and "unlock" an Achievement, "lose" a Defeat and a Fail.
    const find = function (q) { presetSearch.value = q; filterPresets(); return Array.from(document.querySelectorAll("#presets details button")).filter(function (b) { return b.style.display !== "none" && b.closest("details").style.display !== "none"; }).map(function (b) { return b.textContent; }); }
    const want = { victory: ["Victory"], achievement: ["Achievement"], defeat: ["Defeat"], success: ["Success"], fail: ["Fail"],
      win: ["Victory", "Success"], trophy: ["Victory", "Achievement"], unlock: ["Unlock", "Achievement"], lose: ["Fail", "Defeat"] };
    const bad = [];
    Object.keys(want).forEach(function (q) { const got = find(q); want[q].forEach(function (n) { if (got.indexOf(n) < 0) bad.push(q + " ✗ " + n); }); });
    presetSearch.value = ""; filterPresets();
    return ok(!bad.length, bad.join(" · "));
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
    // since 2026-11-13 two presets SAY "hurt" (the voice engine's Hurt Grunt and Woman Hurt Cry), and a name match outranks an
    // alias by design, so they lead the row; Sam's point stands as: the first preset an ALIAS finds is Hit
    const hurtAlias = hurt.best.filter(function (n) { return !/\bhurt\b/i.test(n); });
    if (hurt.all.length > 30 || hurt.all.indexOf("Hit") < 0 || hurtAlias[0] !== "Hit" || hurt.all.indexOf("Sword Swing") >= 0) bad.push("hurt: " + hurt.all.length + " " + hurt.best.slice(0, 3));
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
    // A preset with no `_alts` (2026-11-14): Coin was this row's preset until the jingle round gave it two alts, and a click on
    // a preset with alts plays "version N of M" through its takes, which is a different contract (the alts rows hold it).
    let files = [];
    files = capture(function () {
      btn("Jump").click();
      btn("Pickup Item").click();
      const exact = snapshotState(); applyPreset(PRESETS["Pickup Item"], "Pickup Item");
      if (!sameState(exact, snapshotState()) || soundName() !== "Pickup Item") bad.push("first click was not the preset: " + soundName());
      presetTake = { name: "Pickup Item", state: snapshotState() };
      exportWav();                                             // pickup_item.wav
      btn("Pickup Item").click();
      if (soundName() !== "Pickup Item v2" || histItems[0].name !== "Pickup Item v2" || histItems[0].label !== "Variation") bad.push("second: " + soundName() + "/" + histItems[0].name);
      if (!/variation 2/.test(document.getElementById("nowStatus").textContent)) bad.push("status: " + document.getElementById("nowStatus").textContent);
      exportWav();                                             // pickup_item_v2.wav
      btn("Pickup Item").click();
      if (soundName() !== "Pickup Item v3") bad.push("third: " + soundName());
      btn("Jump").click(); btn("Pickup Item").click();
      if (soundName() !== "Pickup Item") bad.push("back to the preset: " + soundName());
      exportWav();                                             // the same Pickup Item: pickup_item.wav again
      state.freq = state.freq * 2; play("Edit");
      exportWav();                                             // a different sound still called Pickup Item: pickup_item-2.wav
    });
    if (JSON.stringify(files) !== JSON.stringify(["pickup_item.wav", "pickup_item_v2.wav", "pickup_item.wav", "pickup_item-2.wav"])) bad.push("files: " + files.join(","));
    if (!/click again/i.test(btn("Pickup Item").title)) bad.push("tooltip: " + btn("Pickup Item").title);
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
    return ok(JSON.stringify(SFX_EXTRAS) === JSON.stringify({ customWave: "", customWaveB: "", speechText: "", voBody: "" }), JSON.stringify(SFX_EXTRAS));
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
      applyPreset({ wave: 12, customWave: "AQID", customWaveB: "BAUG", speechText: "x", voBody: "h y AH:4" }, "Probe");
      const link = decodePatch(encodePatch()).s, snap = snapshotState();
      const all = ["customWave", "customWaveB", "speechText", "voBody"].every(function (k) { return link[k] === state[k] && snap[k] === state[k]; });
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
  // AJ, 2026-11-11: a layered preset, then a one-layer preset, played the first one's layer 2 under the second.
  t("layers/a-preset-button-after-a-loaded-layered-sound-loads-it-whole", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      const layered = Object.keys(PRESETS).find((n) => PRESETS[n].layers && !PRESETS[n]._alts);
      const plain = Object.keys(PRESETS).find((n) => !PRESETS[n].layers && !PRESETS[n]._alts && n !== layered);
      applyPreset(PRESETS[layered], layered);
      const had = soundLayers(state.layers).length > 0;
      presetClick(plain);
      const want = Object.assign({}, PARAM_DEFAULTS, PRESETS[plain]);
      const clean = !state.layers && layerSel === 0 && !soundLayers(soundSnap().layers).length && state.wave === want.wave && state.freq === want.freq;
      return ok(had && clean, [layered, plain, had, clean].join(" "));
    } finally { applyPreset(keep, keepLabel); }
  });
  t("layers/layers-you-built-are-kept-when-a-preset-button-sets-layer-1", function () {
    const keep = snapshotState(), keepLabel = seqLabel;
    try {
      applyPreset(Object.assign({ layers: "" }, PRESETS["Laser"]), "Laser");
      layerAdd();                                           // built by hand: layer 2
      document.querySelectorAll("#layerBar .layer-tab")[0].click();   // back to layer 1 through its tab
      const before = soundLayers(soundSnap().layers);
      presetClick("Pickup Item");   // one layer and no `_alts` (Coin was this row's until the jingle round gave it layered alts)
      const after = soundLayers(soundSnap().layers);
      const kept = layerSel === 0 && after.length === 1 && before.length === 1 && JSON.stringify(after[0]) === JSON.stringify(before[0]);
      return ok(kept, [layerSel, before.length, after.length].join(" "));
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


  // FOOTSTEPS BY SURFACE (2026-11-01): a section of eleven presets named for the suite's surfaces (CrunchyTile's "surface"
  // custom data), each a short dry step, and its Godot footstep set button (tests/godot-pack.mjs proves the set in Godot)
  t("footsteps/a-section-of-the-eleven-surfaces-and-the-godot-set-button", function () {
    const names = ["grass", "dirt", "sand", "gravel", "stone", "wood", "metal", "snow", "ice", "water", "carpet"];
    const sec = Array.from(document.querySelectorAll("#presets > .preset-section")).find(function (d) { return /^Footsteps by surface/.test(d.querySelector("summary").textContent); });
    if (!sec) return ok(false, "no section");
    const btns = Array.from(sec.querySelectorAll(".sec-buttons button")).map(function (b) { return b.textContent; });
    const keep = sec.open; sec.open = true;
    const b = document.getElementById("footstepSet"), vis = shown(b) && sec.contains(b);
    sec.open = keep;
    return ok(same(FOOTSTEP_SURFACES.map(function (x) { return x[0]; }), names) && FOOTSTEP_SURFACES.every(function (x) { return btns.indexOf(x[1]) >= 0; }) &&
      vis && /surface/.test(b.title) && /Godot footstep set/.test(b.textContent), btns.join(", "));
  });
  t("footsteps/every-surface-preset-is-a-short-dry-step", function () {
    const bad = [];
    FOOTSTEP_SURFACES.forEach(function (x) {
      const r = withState(PRESETS[x[1]], render), n = r.L.length;
      let pk = 0, last = 0, on = -1;
      for (let i = 0; i < n; i++) { const a = Math.abs(r.L[i]); if (a > pk) pk = a; }
      for (let i = 0; i < n; i++) { const a = Math.abs(r.L[i]); if (on < 0 && a >= pk * 0.25) on = i; if (a > pk * 0.01) last = i; }
      if (!(n <= 0.2 * SR + 1 && on <= 0.02 * SR && last <= 0.2 * SR && r.rawPeak > AUDIBLE_FLOOR)) bad.push(x[0] + " " + Math.round(n / SR * 1000) + "ms on " + Math.round(on / SR * 1000) + " end " + Math.round(last / SR * 1000));
    });
    return ok(!bad.length, bad.join(" · "));
  });
  t("footsteps/a-surface-pack-is-named-for-its-surface", function () {
    const f = footstepPackFiles("gravel", "Gravel Footstep"), tres = packTres(f, FOOTSTEP_PITCH);
    return ok(f.length === FOOTSTEP_TAKES && f.every(function (x, i) { return x.name === "gravel/gravel_0" + (i + 1) + ".wav"; }) &&
      /path="gravel\/gravel_01\.wav"/.test(tres) && /random_pitch = 1\.03/.test(tres) && /surface/.test(FOOTSTEP_GD) && /play_at/.test(footstepReadme()), tres.slice(0, 200));
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
