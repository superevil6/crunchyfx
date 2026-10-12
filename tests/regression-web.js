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
  t("desktop-button/one-button-in-the-controls-with-the-core-dialog", function () {
    const b = document.querySelector(".desk-cta");
    b.click();
    const d = document.querySelector(".desk-overlay");
    const items = Array.from(d.querySelectorAll(".desk-adds li b")).map(function (x) { return x.textContent; });
    d.querySelector(".desk-foot button.primary").click();
    d.querySelector(".desk-close").click();
    return ok(b && b.parentElement.classList.contains("controls-right") && /Get the desktop app/.test(b.textContent) && b.querySelector(".pxi") &&
              items.length === 5 && items[0] === "Planted in your game." && opened[opened.length - 1] === "https://sevi66.itch.io/crunchysfx" && d.hidden &&
              !document.getElementById("steambtn"), items.join("|"));
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
    return ok(labels.join("|") === "Export format|Normalize loudness|Getting started" && off && normalizeOut === true && toured &&
              !root.querySelector("#prefPromptSave") && !root.querySelector("#prefCheckUpdates") && root.querySelector("#fmtRate"), labels.join("|"));
  });
  t("legacy/v1.1-share-links-open-to-the-same-audio", function () {
    const got = V.links.map(function (l) { loadSharedSound("?s=" + l.enc); return audio(render()); });
    normalizeOut = true; updateNormBtn();
    return ok(JSON.stringify(got) === JSON.stringify(V.links.map(function (l) { return l.audio; })), got.join(","));
  });
  t("zip/a-variation-pack-carries-a-sidecar-per-sound-and-the-same-wavs", function () {
    applyPreset(PRESETS["Coin"], "Coin");
    document.getElementById("varName").value = "footstep";
    seedVariations();
    const files = buildPackFiles(), zipped = packZipFiles(files);
    const wavs = zipped.filter(function (f) { return /\.wav$/.test(f.name); }), sides = zipped.filter(function (f) { return /\.crunchy$/.test(f.name); });
    const good = files.every(function (f, i) {
      const stem = f.name.replace(/\.wav$/, ""), w = zipped.find(function (z) { return z.name === stem + "/" + f.name; });
      const sc = zipped.find(function (z) { return z.name === stem + "/" + stem + ".crunchy"; });
      const d = sc && JSON.parse(new TextDecoder().decode(sc.data));
      return w && same(w.data, f.data) && d && plantSidecarValid(d) && d.kind === "sound" && d.name === "footstep " + (i + 1) && d.wav === f.name &&
             d.exportName === "footstep " + (i + 1) && JSON.stringify(d.files) === JSON.stringify([f.name]) && d.hash === plantHash([{ path: f.name, data: f.data }]) &&
             same(soundFiles(d)[0].data, f.data);                     // the desktop re-renders the very same bytes
    });
    // and the zip itself: a real one, every entry in it
    const zip = makeZip(zipped), names = [];
    const dv = new DataView(zip.buffer);
    for (let o = 0; dv.getUint32(o, true) === 0x04034b50;) { const n = dv.getUint16(o + 26, true), sz = dv.getUint32(o + 18, true); names.push(new TextDecoder().decode(zip.subarray(o + 30, o + 30 + n))); o += 30 + n + sz; }
    document.getElementById("varClose").click();
    return ok(files.length === 8 && wavs.length === 8 && sides.length === 8 && good && names.length === 16 && names[0] === "footstep_01/footstep_01.wav", names.slice(0, 2).join(","));
  });
  t("zip/a-sequence-pack-stays-wavs-only", function () {
    sequence = [{ genome: genomeFromState(), label: "a" }, { genome: genomeFromState(), label: "b" }];
    seedVariations();
    const files = buildPackFiles(), zipped = packZipFiles(files);
    sequence = []; renderSeq();
    document.getElementById("varClose").click();
    return ok(zipped === files && zipped.every(function (f) { return /^[^/]+\.wav$/.test(f.name); }));
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
