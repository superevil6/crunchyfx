// GENERATED from crunchyCore/desktop.js @ eb28e11 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 3a6705900a6465f31d15c818ca9749f7a312f0df97ae3f11d460238fbdbd284f
"use strict";
// THE DESKTOP GATE AND THE WEB'S ONE INVITATION (CONSOLIDATION-PLAN.md §2–§3; crunchyTile TILE-DESIGN.md §11).
//
// The rule every Crunchy tool keeps: the desktop sells WORKFLOW, never generation. The web version makes everything,
// free, unwatermarked and CC0; the desktop app keeps, organises and delivers it into your game.
//
//   - Anything marked `data-desktop` is simply ABSENT on the web: a dead control you can click is worse than none.
//   - The web shows ONE "Get the desktop app" button, saying plainly what the desktop ADDS. Never "unlock",
//     "premium" or "pro".
//   - THE BUTTON EXISTS ONLY ONCE THE STORE PAGE DOES. The link is the tool's `desktop` in suite.js (CRUNCHY_SUITE),
//     the one place the suite keeps its links: publishing a store page is one edit in crunchyCore, and every app's
//     button appears with its next pull. Until then nothing is shown (a dead link on the way out is worse).
//
// A DOM component, like suite.js: the DOM is touched only inside functions. Needs suite.js loaded first (for the
// tool's name and store link). Styled by the `desk-*` and `dtour-*` blocks in crunchy-base.css.
//
// desktopIs() → bool                    true inside the Tauri desktop app
// desktopStoreUrl(self) → string        the tool's store page, "" until it is published
// desktopMount(self, { place, adds, openUrl }) → { isDesktop, cta, open, close }
//   self     the tool's id in CRUNCHY_SUITE ("tile", "ui", "sfx", "vfx", "bgm", "character", …)
//   place    the element the web's button is appended to (the header)
//   adds     build 1's list of what the desktop adds; since build 2 the button opens THE TOUR (below), which says it
//   openUrl  (url) → open it; default a new tab
//
// THE TOUR (build 2; AJ: "instead of leaving what desktop mode is a mystery, have a little modal with screenshots that
// show it in action", and chose LIVE mock-ups over screenshots: the suite bundles no images). Four short panels, each
// with a working miniature drawn in the page: the REAL Library (library.js, docked in the panel and fed sample assets),
// the paths plant.js really writes and the removal guard's real sentence (plantUsedMessage). Nothing reads or writes a
// disk, storage or the network: the mock-up is a picture (inert, aria-hidden) and the captions say it in words.
//   desktopTourOpen(self, { openUrl, onClose }) → { root, close(), go(i), isOpen() }   one tour at a time
//   desktopTourLink(self, text) → a <button> that opens it (an app's first-run tour, an About box)
//   desktopTour = { open, link, words, panels }                                        the same, as one object
//   desktopTourWords(self) → the captions' words: the app's PROJECT_APP.tour (when PROJECT_APP.suite is `self`) over
//   the defaults. PROJECT_APP.tour, every field optional:
//     noun     what the app makes, plural ("tilesets"; default "assets")
//     where    where the game uses them ("your TileMap"; default "your scenes")
//     samples  asset names for the mock Library; the first is the one saved (default Hero, Coin, Door, Cave, Boss)
//     exts     the files one save writes (default [".png"]); the .crunchy sidecar is added
//     uses     the game file the removal guard names (default "level_1.tscn")
//     thumb(name, i, canvas)   paints a sample's picture (default: a small drawn tile in one of five colourways)
// Entry points: the web's "Get the desktop app" (desktopMount) opens it; settings.js (build 3) adds a row for it.

const DESKTOP_BUILD = 2;

function desktopIs() { return typeof window !== "undefined" && !!window.__TAURI__; }

function desktopStoreUrl(self) {
  const t = typeof CRUNCHY_SUITE !== "undefined" ? CRUNCHY_SUITE.find(function (x) { return x.id === self; }) : null;
  return t && t.desktop ? t.desktop : "";
}

function desktopMount(self, opts) {
  opts = opts || {};
  if (desktopIs()) return { isDesktop: true, cta: null, open: function () {}, close: function () {} };
  document.querySelectorAll("[data-desktop]").forEach(function (e) { e.hidden = true; });
  const url = desktopStoreUrl(self);
  if (!url) return { isDesktop: false, cta: null, open: function () {}, close: function () {} };

  const tool = CRUNCHY_SUITE.find(function (x) { return x.id === self; });
  const cta = document.createElement("button");
  cta.className = "desk-cta";
  cta.textContent = "Get the desktop app";
  cta.type = "button";
  cta.title = "What the " + tool.name + " desktop app adds, and where to get it";
  const ic = typeof crunchyIcon === "function" ? crunchyIcon("monitor") : null;
  if (ic) cta.insertBefore(ic, cta.firstChild);
  if (opts.place) opts.place.appendChild(cta);

  let tour = null;
  function open() { tour = desktopTourOpen(self, { openUrl: opts.openUrl }); }
  function close() { if (tour) tour.close(); }
  cta.addEventListener("click", open);
  return { isDesktop: false, cta: cta, open: open, close: close };
}

// ---- the tour: its words (no DOM) ---------------------------------------------------------------------------------
const DESKTOP_TOUR_DEFAULTS = { noun: "assets", where: "your scenes", samples: ["Hero", "Coin", "Door", "Cave", "Boss"],
                                exts: [".png"], uses: "level_1.tscn" };
const DESKTOP_TOUR_CLOSING = "Everything you make on the web stays free and CC0. The desktop app adds workflow, never features.";

function desktopTourChild(self, engine) {
  return typeof plantChildRel === "function" && typeof PLANT_SUITE !== "undefined" && PLANT_SUITE[self]
    ? plantChildRel(engine, self) : (engine === "unity" ? "Assets/Crunchy/" : "crunchy/") + self;
}

function desktopTourWords(self) {
  const own = typeof PROJECT_APP !== "undefined" && PROJECT_APP && PROJECT_APP.suite === self && PROJECT_APP.tour ? PROJECT_APP.tour : {};
  const w = {};
  Object.keys(DESKTOP_TOUR_DEFAULTS).forEach(function (k) { w[k] = own[k] != null ? own[k] : DESKTOP_TOUR_DEFAULTS[k]; });
  w.samples = (Array.isArray(w.samples) && w.samples.length ? w.samples : DESKTOP_TOUR_DEFAULTS.samples).map(String);
  w.exts = Array.isArray(w.exts) && w.exts.length ? w.exts.map(String) : DESKTOP_TOUR_DEFAULTS.exts;
  w.thumb = typeof own.thumb === "function" ? own.thumb : null;
  const tool = typeof CRUNCHY_SUITE !== "undefined" ? CRUNCHY_SUITE.find(function (x) { return x.id === self; }) : null;
  w.self = self;
  w.name = tool ? tool.name : (typeof PLANT_SUITE_NAMES !== "undefined" && PLANT_SUITE_NAMES[self]) || "The app";
  w.child = desktopTourChild(self, "godot");
  w.unity = desktopTourChild(self, "unity");
  w.sample = w.samples[0];
  w.slug = typeof plantSlug === "function" ? plantSlug(w.sample)
    : w.sample.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  w.dir = "res://" + w.child + "/" + w.slug + "/";
  w.files = w.exts.map(function (e) { return w.slug + e; }).concat([w.slug + (typeof PLANT_EXT !== "undefined" ? PLANT_EXT : ".crunchy")]);
  w.store = desktopStoreUrl(self);
  return w;
}

function desktopTourPanels(w) {
  return [
    { key: "plant", title: "Plant in your game",
      line: "Pick your Godot project (or a Unity project, or any folder) once. " + w.name + " keeps its Library inside it, " +
            "so your " + w.noun + " travel with the game." },
    { key: "save", title: "Save, and it’s in your project",
      line: "Every save lands in res://" + w.child + "/<asset>/, ready for " + w.where + ", beside a small .crunchy file " +
            "that reopens the design exactly." },
    { key: "update", title: "Change it, and it updates in place",
      line: "Save again and it re-exports under the same paths, so " + w.where + " keeps working. The removal guard stops a " +
            "save that would delete a file your scenes use." },
    { key: "library", title: "The Library",
      line: "All your " + w.noun + " as pictures: search them, see which ones a newer " + w.name + " would draw " +
            "differently, and what your other Crunchy tools planted in the same game." },
  ];
}

// ---- the tour: the modal ------------------------------------------------------------------------------------------
let desktopTourCur = null;

function desktopTourLink(self, text) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dtour-link";
  b.textContent = text || "What does the desktop app add?";
  b.addEventListener("click", function () { desktopTourOpen(self); });
  return b;
}

function desktopTourOpen(self, opts) {
  opts = opts || {};
  if (desktopTourCur) desktopTourCur.close();
  const w = desktopTourWords(self), panels = desktopTourPanels(w), back = document.activeElement;
  const go = opts.openUrl || function (u) { window.open(u, "_blank", "noopener"); };
  const el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let at = 0, timers = [], open = true;

  const root = el("div", "dtour-overlay");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "dtourTitle");
  const panel = el("div", "dtour-panel"), head = el("div", "dtour-head");
  const kicker = el("span", "dtour-kicker", w.name + " Desktop");
  const ic = typeof crunchyIcon === "function" ? crunchyIcon("monitor") : null;
  if (ic) kicker.insertBefore(ic, kicker.firstChild);
  head.appendChild(kicker);
  const step = el("span", "dtour-step");
  head.appendChild(step);
  const x = el("button", "dtour-x", "×");
  x.type = "button"; x.title = "Close (Esc)"; x.setAttribute("aria-label", "Close");
  head.appendChild(x);
  panel.appendChild(head);
  const title = el("h2", "dtour-title");
  title.id = "dtourTitle";
  panel.appendChild(title);
  const line = el("p", "dtour-line");
  line.setAttribute("aria-live", "polite");
  panel.appendChild(line);
  const stage = el("div", "dtour-stage");
  stage.setAttribute("aria-hidden", "true");                        // a picture: the caption above says it in words
  stage.inert = true;
  panel.appendChild(stage);
  const end = el("div", "dtour-end");
  end.appendChild(el("p", "dtour-closing", DESKTOP_TOUR_CLOSING));
  const getRow = el("div", "dtour-getrow");
  if (desktopIs()) getRow.appendChild(el("span", "dtour-soon", "You have it: this is the desktop app."));
  else if (w.store) {
    const get = el("button", "primary dtour-get", "Get it on itch.io ↗");
    get.type = "button";
    get.addEventListener("click", function () { go(w.store); });
    getRow.appendChild(get);
    getRow.appendChild(el("span", "dtour-soon", "One-time purchase. No account, no subscription."));
  } else getRow.appendChild(el("span", "dtour-soon dtour-coming", "Coming soon to itch.io"));
  end.appendChild(getRow);
  panel.appendChild(end);
  const foot = el("div", "dtour-foot");
  const prev = el("button", "dtour-prev", "Back");
  prev.type = "button";
  const dots = el("div", "dtour-dots");
  const dotEls = panels.map(function (p, i) {
    const d = el("button", "dtour-dot");
    d.type = "button";
    d.setAttribute("aria-label", "Step " + (i + 1) + " of " + panels.length + ": " + p.title);
    d.addEventListener("click", function () { show(i); });
    dots.appendChild(d);
    return d;
  });
  const next = el("button", "primary dtour-next", "Next");
  next.type = "button";
  foot.appendChild(prev); foot.appendChild(dots); foot.appendChild(next);
  panel.appendChild(foot);
  root.appendChild(panel);
  document.body.appendChild(root);

  function later(ms, fn) {
    if (still) { fn(); return; }
    timers.push(setTimeout(function () { if (open) fn(); }, ms));
  }
  function show(i) {
    at = Math.max(0, Math.min(panels.length - 1, i));
    timers.forEach(clearTimeout); timers = [];
    const p = panels[at];
    root.dataset.panel = p.key;
    step.textContent = (at + 1) + " / " + panels.length;
    title.textContent = p.title;
    line.textContent = p.line;
    dotEls.forEach(function (d, j) {
      d.classList.toggle("on", j === at);
      if (j === at) d.setAttribute("aria-current", "step"); else d.removeAttribute("aria-current");
    });
    prev.disabled = at === 0;
    next.textContent = at === panels.length - 1 ? "Done" : "Next";
    end.hidden = at !== panels.length - 1;
    stage.textContent = "";
    stage.className = "dtour-stage dtour-" + p.key;
    desktopTourStage(p.key, w, stage, later, el);
  }
  function close() {
    if (!open) return;
    open = false;
    timers.forEach(clearTimeout); timers = [];
    root.remove();
    if (desktopTourCur && desktopTourCur.root === root) desktopTourCur = null;
    if (back && back.focus && document.contains(back)) back.focus();
    if (opts.onClose) opts.onClose();
  }
  prev.addEventListener("click", function () { show(at - 1); if (prev.disabled) next.focus(); });
  next.addEventListener("click", function () { if (at === panels.length - 1) close(); else show(at + 1); });
  x.addEventListener("click", close);
  root.addEventListener("click", function (e) { if (e.target === root) close(); });
  root.addEventListener("keydown", function (e) {                  // CAPTURE: before the mock Library's own Escape
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); show(at + (e.key === "ArrowRight" ? 1 : -1)); return; }
    if (e.key === "Tab") {                                           // focus stays inside the dialog
      const f = Array.prototype.filter.call(panel.querySelectorAll("button"), function (b) {
        return !b.disabled && !b.closest("[hidden]") && !b.closest(".dtour-stage");
      });
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i < 0 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
  }, true);
  show(0);
  next.focus();
  desktopTourCur = { root: root, close: close, go: show, isOpen: function () { return open; } };
  return desktopTourCur;
}

// A sample's picture: the app's own painter, or a small drawn tile (ground, a lit top band, flecks), seeded by i.
function desktopTourThumb(w, name, i, canvas) {
  if (w.thumb) { try { w.thumb(name, i, canvas); return; } catch (e) { /* fall back to the drawn tile */ } }
  const sets = [["#3b7a3c", "#7bc950", "#5a3d2b", "#3d2a1e"], ["#4a4f6a", "#8f96b8", "#33364a", "#23253a"],
                ["#7a4a2c", "#d8a35a", "#5a3420", "#3c2216"], ["#2d6a78", "#73d1d9", "#1f4954", "#163640"],
                ["#6a3a6e", "#c47ad0", "#4a284e", "#331a36"]];
  const c = sets[i % sets.length], n = 16;
  canvas.width = n; canvas.height = n;
  const g = canvas.getContext("2d");
  if (!g) return;
  let s = (0x9e3779b9 ^ Math.imul(i + 1, 2654435761)) | 0;
  const rnd = function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  g.fillStyle = "#1c1a24"; g.fillRect(0, 0, n, n);
  for (let x = 0; x < n; x++) {
    const top = 5 + Math.round(Math.sin((x + i * 3) / 2.6) * 1.5);
    g.fillStyle = c[1]; g.fillRect(x, top, 1, 2);
    g.fillStyle = c[0]; g.fillRect(x, top + 2, 1, 2);
    g.fillStyle = c[2]; g.fillRect(x, top + 4, 1, n);
  }
  for (let k = 0; k < 9; k++) { g.fillStyle = c[3]; g.fillRect(Math.floor(rnd() * n), 11 + Math.floor(rnd() * 5), 1, 1); }
  g.fillStyle = c[1]; g.fillRect(2 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 2), 2, 1);
}

// The four mock-ups. `later(ms, fn)` runs one step of the little animation (all at once under reduced motion).
function desktopTourStage(key, w, stage, later, el) {
  const mini = function (cls) { const d = el("div", cls); stage.appendChild(d); return d; };
  const file = function (depth, name, cls) {
    const r = el("div", "dtour-file" + (cls ? " " + cls : ""));
    r.style.paddingLeft = (6 + depth * 14) + "px";
    r.appendChild(el("span", "dtour-fic"));
    r.appendChild(el("span", "", name));
    return r;
  };
  const press = function (b) { b.classList.add("press"); };

  if (key === "plant") {                                              // a folder dialog: pick the game, plant
    const dlg = mini("dtour-dlg");
    dlg.appendChild(el("div", "dtour-dlgbar", "Plant in a folder: choose your game"));
    const list = el("div", "dtour-dlglist");
    const rows = [["Documents", ""], ["MyGame", "project.godot"], ["Music", ""], ["Pictures", ""]].map(function (r) {
      const row = el("div", "dtour-dlgrow");
      row.appendChild(el("span", "dtour-fic"));
      row.appendChild(el("span", "dtour-dlgname", r[0]));
      if (r[1]) row.appendChild(el("span", "dtour-dlgtag", r[1]));
      list.appendChild(row);
      return row;
    });
    const body = el("div", "dtour-dlgbody"), places = el("div", "dtour-places");
    ["Home", "Desktop", "Games"].forEach(function (n, i) { places.appendChild(el("div", "dtour-place" + (i ? "" : " on"), n)); });
    body.appendChild(places); body.appendChild(list);
    dlg.appendChild(body);
    const bar = el("div", "dtour-dlgfoot");
    const path = el("span", "dtour-dlgpath", "~/");
    bar.appendChild(path);
    const plant = el("span", "dtour-btn primary", "Plant here");
    bar.appendChild(plant);
    dlg.appendChild(bar);
    const res = mini("dtour-result");
    res.appendChild(el("b", "", "Planted in MyGame"));
    res.appendChild(el("span", "", "A Godot project: your saves go to res://" + w.child + "/"));
    res.appendChild(el("span", "dtour-mute", "A Unity project: " + w.unity + "/. Any other folder: crunchy/."));
    later(500, function () { rows[1].classList.add("sel"); path.textContent = "~/MyGame"; });
    later(1300, function () { press(plant); });
    later(1700, function () { dlg.classList.add("done"); res.classList.add("on"); });
    return;
  }
  if (key === "save") {                                               // the editor's Save, and the game's file tree
    const ed = mini("dtour-editor");
    const cv = el("canvas", "dtour-big");
    desktopTourThumb(w, w.sample, 0, cv);
    ed.appendChild(cv);
    const row = el("div", "dtour-saverow");
    const name = el("span", "dtour-input", "");
    row.appendChild(name);
    const save = el("span", "dtour-btn primary", "Save");
    row.appendChild(save);
    ed.appendChild(row);
    const tree = mini("dtour-tree");
    tree.appendChild(el("div", "dtour-treebar", "FileSystem"));
    tree.appendChild(file(0, "res://", "dir"));
    tree.appendChild(file(1, "scenes/", "dir"));
    tree.appendChild(file(2, w.uses));
    const parts = w.child.split("/");
    let after = null;
    parts.forEach(function (p, i) { after = tree.appendChild(file(i + 1, p + "/", "dir")); });
    const depth = parts.length + 1, typed = w.sample, t0 = 300 + typed.length * 45;
    for (let i = 1; i <= typed.length; i++) later(250 + i * 45, function () { name.textContent = typed.slice(0, i); });
    later(t0, function () { press(save); });
    later(t0 + 300, function () { after = tree.appendChild(file(depth, w.slug + "/", "dir new")); });
    w.files.forEach(function (f, k) {
      later(t0 + 650 + k * 320, function () { after = tree.appendChild(file(depth + 1, f, "new" + (/\.crunchy$/.test(f) ? " side" : ""))); });
    });
    return;
  }

  // The last two use the REAL library.js, docked in the stage and fed sample assets (nothing is read or written).
  const items = w.samples.map(function (n, i) {
    return { id: "s" + i, name: n, kind: "asset", meta: i === 0 ? "saved just now" : (i + 1) + " days ago", badges: [] };
  });
  let shown = [];
  const others = (typeof CRUNCHY_SUITE !== "undefined" ? CRUNCHY_SUITE : []).filter(function (t) { return t.id !== w.self; }).slice(0, 2);
  const lib = desktopTourLibrary(w, mini("dtour-dock"), function () { return shown; }, key === "library" ? others : []);
  if (key === "update") {
    shown = items.slice(0, 3);
    const guard = mini("dtour-guard");
    const used = [{ path: w.child + "/" + w.slug + "/" + w.slug + "-old" + w.exts[0], by: [w.uses] }];
    guard.appendChild(el("b", "", "The removal guard"));
    guard.appendChild(el("span", "", typeof plantUsedMessage === "function" ? plantUsedMessage(used, "save")
      : "This save removes a file your game uses. Press again to save anyway."));
    lib.open();
    later(700, function () { shown[0].badges = [{ text: "update available", hot: true }]; lib.refresh(); });
    later(1700, function () {
      const b = Array.prototype.find.call(stage.querySelectorAll(".lib-acts button"), function (x) { return x.textContent === "Re-export"; });
      if (b) press(b);
    });
    later(2100, function () {
      shown[0].badges = [{ text: "updated in place" }]; shown[0].meta = "same paths";
      lib.refresh(); lib.status("Re-exported " + w.sample + " into " + w.dir + ": " + w.uses + " keeps working.");
    });
    later(2900, function () { guard.classList.add("on"); });
    return;
  }
  shown = items.slice(1);                                             // "library": a save appears, a badge lights
  lib.open();
  later(900, function () { items[0].badges = [{ text: "new" }]; shown = [items[0]].concat(shown); lib.refresh(); lib.status("Saved " + w.sample + "."); });
  later(1900, function () { shown[2].badges = [{ text: "update available", hot: true }]; lib.refresh(); });
}

function desktopTourLibrary(w, dock, items, others) {
  if (typeof libraryMount !== "function") {                          // a page without library.js: a plain row of cards
    const draw = function () {
      dock.textContent = "";
      items().forEach(function (it, i) {
        const c = document.createElement("div"), cv = document.createElement("canvas");
        c.className = "lib-card"; cv.className = "lib-thumb";
        desktopTourThumb(w, it.name, i, cv);
        c.appendChild(cv);
        c.appendChild(document.createTextNode(it.name));
        dock.appendChild(c);
      });
    };
    return { open: draw, refresh: draw, status: function () {} };
  }
  const lib = libraryMount({
    title: "Library",
    dock: dock,
    project: function () { return { name: "MyGame", dir: "~/MyGame/" + w.child }; },
    kinds: [],
    items: items,
    thumb: function (it, cv) { desktopTourThumb(w, it.name, Math.max(0, w.samples.indexOf(it.name)), cv); },
    open: function () {},
    actions: [{ label: "Re-export", when: function (it) { return (it.badges || []).some(function (b) { return b.hot; }); }, run: function () {} }],
    emptyHint: "Nothing planted yet.",
    suite: others.length ? function () {
      return others.map(function (t, i) {
        return { key: t.id, name: t.name, summary: (i ? 2 : 4) + " assets in " + desktopTourChild(t.id, "godot") + "/", open: function () {} };
      });
    } : null,
  });
  return lib;
}

const desktopTour = { open: desktopTourOpen, link: desktopTourLink, words: desktopTourWords, panels: desktopTourPanels };
