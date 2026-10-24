// GENERATED from crunchyCore/desktop.js @ e9469bf by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 23437ac9a6d4f4d10beb0386f8e4fa1bd4bb054d2fcb8fabe7002c07fcb1cdb1
"use strict";
// THE DESKTOP GATE AND THE WEB'S ONE INVITATION (CONSOLIDATION-PLAN.md §2–§3; crunchyTile TILE-DESIGN.md §11).
//
// The rule every Crunchy tool keeps: the desktop sells WORKFLOW, never generation. The web version makes everything,
// free, unwatermarked and CC0; the desktop app keeps, organizes and delivers it into your game.
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
//     thumb(name, i, canvas)   paints a sample's picture (default: the app's `art`, below)
//   Build 3: EACH APP HAS ITS OWN DEMO without PROJECT_APP.tour: DESKTOP_TOUR_APPS, keyed by the suite id, gives the
//   noun, samples, files and an `art` (DESKTOP_TOUR_ART: tile terrain, a sound's waveform, an effect's burst, a track's
//   piano roll, a UI panel, an item icon, a shader's CRT gradient, a pixel figure), each thumbnail seeded by its name.
//   The pitch names the price when suite.js gives the tool a `price` (desktopTourPitch).
// Entry points: the web's "Get the desktop app" (desktopMount) opens it; settings.js (build 3) adds a row for it.

const DESKTOP_BUILD = 4;

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
// Unknown ids (an app not in the table below) take these.
const DESKTOP_TOUR_DEFAULTS = { noun: "assets", where: "your scenes", samples: ["Hero", "Coin", "Door", "Cave", "Boss"],
                                exts: [".png"], uses: "level_1.tscn", art: "tile" };
const DESKTOP_TOUR_CLOSING = "Everything you make on the web stays free and CC0. The desktop app adds workflow, never features.";

// EACH APP'S OWN DEMO (build 3; from CrunchySFX's usability test, 2026-10-16: every app showed Tile's grass tileset).
// Keyed by the suite id (CRUNCHY_SUITE). An `exts` entry starting with "." or "_" follows the asset's slug
// (".wav" → jump.wav); any other entry is a file name as written ("paint.tscn"). `art` names a painter in
// DESKTOP_TOUR_ART (the editor mock and the Library's thumbnails, drawn here, no images). The app's own
// PROJECT_APP.tour still wins, field by field.
const DESKTOP_TOUR_APPS = {
  tile:      { noun: "tilesets", where: "your TileMap", samples: ["Meadow", "Castle", "Cave", "Swamp", "Desert"],
               exts: [".png", ".tres", "paint.tscn"], uses: "level_1.tscn", art: "tile" },
  sfx:       { noun: "sounds", where: "your AudioStreamPlayers", samples: ["Jump", "Coin", "Hurt", "Explosion", "Menu Click"],
               exts: [".wav"], uses: "player.tscn", art: "wave" },
  vfx:       { noun: "effects", where: "your AnimatedSprite2Ds", samples: ["Hit Spark", "Fireball", "Heal", "Smoke Puff", "Lightning"],
               exts: [".png", ".tres"], uses: "level_1.tscn", art: "burst" },
  bgm:       { noun: "tracks", where: "your music player", samples: ["Title Theme", "Dungeon", "Boss", "Overworld", "Victory"],
               exts: [".wav"], uses: "main.tscn", art: "roll" },
  ui:        { noun: "UI kits", where: "your menus", samples: ["Main Menu", "HUD", "Inventory", "Dialogue", "Pause"],
               exts: [".tres", ".png"], uses: "main_menu.tscn", art: "panel" },
  items:     { noun: "items", where: "your inventory", samples: ["Iron Sword", "Potion", "Oak Shield", "Ruby", "Gold Key"],
               exts: [".png"], uses: "inventory.tscn", art: "item" },
  shader:    { noun: "shaders", where: "your materials", samples: ["CRT", "Pixelate", "Dissolve", "Scanlines", "Hit Flash"],
               exts: [".gdshader", ".tres"], uses: "level_1.tscn", art: "crt" },
  character: { noun: "characters", where: "your scenes", samples: ["Hero", "Goblin", "Knight", "Mage", "Villager"],
               exts: [".png", ".tres", ".tscn"], uses: "level_1.tscn", art: "figure" },
};

function desktopTourChild(self, engine) {
  return typeof plantChildRel === "function" && typeof PLANT_SUITE !== "undefined" && PLANT_SUITE[self]
    ? plantChildRel(engine, self) : (engine === "unity" ? "Assets/Crunchy/" : "crunchy/") + self;
}

function desktopTourWords(self) {
  const own = typeof PROJECT_APP !== "undefined" && PROJECT_APP && PROJECT_APP.suite === self && PROJECT_APP.tour ? PROJECT_APP.tour : {};
  const app = Object.prototype.hasOwnProperty.call(DESKTOP_TOUR_APPS, self) ? DESKTOP_TOUR_APPS[self] : {};
  const base = {};
  Object.keys(DESKTOP_TOUR_DEFAULTS).forEach(function (k) { base[k] = app[k] != null ? app[k] : DESKTOP_TOUR_DEFAULTS[k]; });
  const w = {};
  Object.keys(base).forEach(function (k) { w[k] = own[k] != null ? own[k] : base[k]; });
  w.samples = (Array.isArray(w.samples) && w.samples.length ? w.samples : base.samples).map(String);
  w.exts = Array.isArray(w.exts) && w.exts.length ? w.exts.map(String) : base.exts;
  w.art = Object.prototype.hasOwnProperty.call(DESKTOP_TOUR_ART, w.art) ? w.art : "tile";
  w.thumb = typeof own.thumb === "function" ? own.thumb : null;
  const tool = typeof CRUNCHY_SUITE !== "undefined" ? CRUNCHY_SUITE.find(function (x) { return x.id === self; }) : null;
  w.self = self;
  w.name = tool ? tool.name : (typeof PLANT_SUITE_NAMES !== "undefined" && PLANT_SUITE_NAMES[self]) || "The app";
  w.accent = tool && tool.accent ? tool.accent : "#ff7a45";
  w.price = tool && tool.price ? String(tool.price) : "";
  w.child = desktopTourChild(self, "godot");
  w.unity = desktopTourChild(self, "unity");
  w.sample = w.samples[0];
  w.slug = typeof plantSlug === "function" ? plantSlug(w.sample)
    : w.sample.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
  w.dir = "res://" + w.child + "/" + w.slug + "/";
  w.files = w.exts.map(function (e) { return /^[._]/.test(e) ? w.slug + e : e; })
    .concat([w.slug + (typeof PLANT_EXT !== "undefined" ? PLANT_EXT : ".crunchy")]);
  w.store = desktopStoreUrl(self);
  return w;
}

// The pitch beside "Get it on itch.io": the price when suite.js gives one.
function desktopTourPitch(w) {
  return w && w.price ? "One-time purchase: " + w.price + ". No account, no subscription." : "One-time purchase. No account, no subscription.";
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
      line: "Save again and it re-exports under the same paths, so it keeps working in " + w.where + ". The removal guard stops a " +
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
    getRow.appendChild(el("span", "dtour-soon", desktopTourPitch(w)));
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

// A sample's picture: the app's own painter (PROJECT_APP.tour.thumb), else its `art` from DESKTOP_TOUR_ART, seeded by
// the sample's name and place so the mock Library reads as several different assets. Plain canvas, whole pixels.
function desktopTourThumb(w, name, i, canvas) {
  if (w.thumb) { try { w.thumb(name, i, canvas); return; } catch (e) { /* fall back to the drawn picture */ } }
  const art = DESKTOP_TOUR_ART[w.art] || DESKTOP_TOUR_ART.tile;
  const n = art.size;
  canvas.width = n; canvas.height = n;
  const g = canvas.getContext("2d");
  if (!g) return;
  let s = 0x811c9dc5;
  String(name).split("").forEach(function (ch) { s = Math.imul(s ^ ch.charCodeAt(0), 16777619); });
  s = (s ^ Math.imul(i + 1, 2654435761)) | 0;
  if (!s) s = 0x9e3779b9;
  const rnd = function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  const px = function (c, x, y, ww, hh) { g.fillStyle = c; g.fillRect(x, y, ww || 1, hh || 1); };
  g.fillStyle = "#1c1a24"; g.fillRect(0, 0, n, n);
  art.draw(px, n, rnd, String(name).toLowerCase(), i, w.accent);
}

// The painters, one per app's kind of asset (`art` in DESKTOP_TOUR_APPS). Each gets px(color, x, y, w, h), the size,
// a seeded rnd, the sample's name in lower case, its place and the app's accent.
const DESKTOP_TOUR_ART = {
  tile: { size: 16, draw: function (px, n, rnd, name, i) {             // terrain: a lit top band over ground, flecks
    const sets = [["#3b7a3c", "#7bc950", "#5a3d2b", "#3d2a1e"], ["#4a4f6a", "#8f96b8", "#33364a", "#23253a"],
                  ["#7a4a2c", "#d8a35a", "#5a3420", "#3c2216"], ["#2d6a78", "#73d1d9", "#1f4954", "#163640"],
                  ["#6a3a6e", "#c47ad0", "#4a284e", "#331a36"]];
    const c = sets[i % sets.length];
    for (let x = 0; x < n; x++) {
      const top = 5 + Math.round(Math.sin((x + i * 3) / 2.6) * 1.5);
      px(c[1], x, top, 1, 2); px(c[0], x, top + 2, 1, 2); px(c[2], x, top + 4, 1, n);
    }
    for (let k = 0; k < 9; k++) px(c[3], Math.floor(rnd() * n), 11 + Math.floor(rnd() * 5));
    px(c[1], 2 + Math.floor(rnd() * 10), 1 + Math.floor(rnd() * 2), 2, 1);
  } },
  wave: { size: 24, draw: function (px, n, rnd, name, i) {             // a sound: a chunky waveform on a scope
    const mid = 12, shape = i % 4;
    px("#2a2633", 0, mid, n, 1);
    for (let x = 1; x < n - 1; x += 2) {                                 // one bar per two pixels, as an editor draws it
      const t = (x - 1) / (n - 3);
      const env = shape === 0 ? Math.exp(-t * 2.6) : shape === 1 ? Math.sin(t * Math.PI)
        : shape === 2 ? (t < 0.1 ? 0.6 : Math.exp(-(t - 0.1) * 1.4)) : 0.45 + 0.4 * Math.abs(Math.sin(t * 6.3 + i));
      const a = Math.max(1, Math.round(10 * env * (0.4 + rnd() * 0.6)));
      px("#c25326", x, mid - a, 1, a * 2 + 1);
      px("#ff7a45", x, mid - a + 1, 1, Math.max(1, a * 2 - 1));
    }
  } },
  burst: { size: 24, draw: function (px, n, rnd, name, i) {             // an effect: a spark burst, a hot core
    const sets = [["#c77dff", "#f3d9ff", "#7b3fb0"], ["#ff7a45", "#ffe08a", "#b3401c"], ["#3ddc97", "#d6ffe9", "#1f8a5c"],
                  ["#9aa3b8", "#e6e9f2", "#5a6072"], ["#7ea6ff", "#ffffff", "#3a5bb0"]];
    const c = sets[i % sets.length], cx = 11 + Math.floor(rnd() * 2), cy = 11 + Math.floor(rnd() * 2);
    const rays = 5 + Math.floor(rnd() * 4), turn = rnd() * Math.PI;
    for (let r = 0; r < rays; r++) {
      const ang = turn + r * Math.PI * 2 / rays, len = 5 + Math.floor(rnd() * 6);
      for (let k = 2; k <= len; k++) px(k > len - 2 ? c[2] : c[0], Math.round(cx + Math.cos(ang) * k), Math.round(cy + Math.sin(ang) * k));
    }
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const d = x * x + y * y;
      if (d <= 9) px(d <= 2 ? c[1] : d <= 5 ? c[0] : c[2], cx + x, cy + y);
    }
    for (let k = 0; k < 4; k++) px(c[1], 1 + Math.floor(rnd() * 22), 1 + Math.floor(rnd() * 22));
  } },
  roll: { size: 24, draw: function (px, n, rnd, name, i, accent) {      // a track: notes on a piano-roll strip
    for (let y = 0; y < n; y += 2) {                                     // the keyboard down the left, its rows across
      const black = [1, 3, 6, 8, 10].indexOf((y / 2) % 12) >= 0;
      px(black ? "#2a2633" : "#d8dde8", 0, y, 4, 2); px(black ? "#201d27" : "#25222d", 4, y, n - 4, 2);
    }
    for (let x = 4; x < n; x += 5) px("#33304a", x, 0, 1, n);
    let x = 5, row = 3 + Math.floor(rnd() * 4);
    while (x < n) {
      const len = 2 + Math.floor(rnd() * 3);
      row = Math.max(0, Math.min(10, row + Math.floor(rnd() * 5) - 2));
      const y = row * 2;
      px(accent, x, y, Math.min(len, n - x), 2); px("#a8f5d2", x, y, 1, 1);
      if (rnd() < 0.4) px("#1f8a5c", x, Math.min(n - 2, y + 6 + Math.floor(rnd() * 3) * 2), Math.min(len, n - x), 2);
      x += len + (rnd() < 0.3 ? 1 : 0);
    }
  } },
  panel: { size: 24, draw: function (px, n, rnd, name, i, accent) {     // a UI kit: a framed panel with buttons
    px(accent, 1, 2, 22, 20); px("#23253a", 2, 3, 20, 18); px("#3a5bb0", 2, 3, 20, 3);
    px("#cfdcff", 3, 4, 4 + Math.floor(rnd() * 8), 1);
    const kind = i % 3;
    if (kind === 0) for (let k = 0; k < 3; k++) {                       // a menu: three buttons, one lit
      const lit = k === Math.floor(rnd() * 3);
      px(lit ? accent : "#4a4f6a", 5, 8 + k * 4, 14, 3); px(lit ? "#ffffff" : "#8f96b8", 8, 9 + k * 4, 4 + Math.floor(rnd() * 5), 1);
    } else if (kind === 1) {                                             // a HUD: bars and a slot row
      [["#ff5c8a", 0.4 + rnd() * 0.6], ["#7ea6ff", 0.3 + rnd() * 0.7]].forEach(function (b, k) {
        px("#14131a", 4, 8 + k * 4, 16, 3); px(b[0], 4, 8 + k * 4, Math.round(16 * b[1]), 3);
      });
      for (let k = 0; k < 4; k++) px(k === Math.floor(rnd() * 4) ? accent : "#4a4f6a", 4 + k * 4, 16, 3, 3);
    } else {                                                             // a grid of slots
      for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) px(rnd() < 0.3 ? accent : "#33364a", 4 + x * 4, 8 + y * 4, 3, 3);
    }
  } },
  item: { size: 24, draw: function (px, n, rnd, name, i) {             // an item icon: sword, potion, shield, gem, key
    const kinds = ["sword", "potion", "shield", "gem", "key"];
    let kind = kinds.find(function (k) { return name.indexOf(k) >= 0; }) ||
      (/ruby|emerald|sapphire/.test(name) ? "gem" : kinds[(i + Math.floor(rnd() * 5)) % 5]);
    const hue = [["#ff5c5c", "#ffb3b3", "#a32a2a"], ["#5ca8ff", "#c2dcff", "#2a5aa3"], ["#a6e22e", "#e1ffb0", "#5c8a12"]][Math.floor(rnd() * 3)];
    if (kind === "sword") {
      for (let k = 0; k < 13; k++) { px("#d8dde8", 6 + k, 16 - k, 2, 1); px("#8f96b8", 6 + k, 17 - k); }
      px("#ffffff", 19, 3);
      for (let k = -3; k <= 3; k++) px("#c9913e", 5 + k, 17 + k);
      px("#6f3f01", 3, 19, 2, 2); px("#5a3420", 2, 20, 2, 2); px(hue[0], 1, 21, 2, 2);
    } else if (kind === "potion") {
      px("#c9913e", 10, 3, 4, 2); px("#8f96b8", 10, 5, 4, 3);
      for (let y = 8; y < 21; y++) { const r = y < 11 ? y - 6 : y > 18 ? 22 - y : 6; px("#8f96b8", 12 - r, y, r * 2, 1); }
      for (let y = 12; y < 20; y++) { const r = y > 18 ? 21 - y : 5; px(hue[0], 12 - r, y, r * 2, 1); }
      px(hue[1], 8, 13, 2, 2); px(hue[2], 14, 17, 2, 2);
    } else if (kind === "shield") {
      for (let y = 3; y < 21; y++) { const r = y < 14 ? 8 : Math.max(1, 8 - (y - 13)); px("#6f3f01", 12 - r, y, r * 2, 1); px("#c9913e", 13 - r, y, r * 2 - 2, 1); }
      px(hue[0], 11, 5, 2, 13); px(hue[0], 6, 9, 12, 2);
    } else if (kind === "gem") {
      for (let y = 0; y < 13; y++) { const r = y < 4 ? 4 + y : 13 - y; px(hue[2], 12 - r, 6 + y, r * 2, 1); px(hue[0], 13 - r, 6 + y, Math.max(1, r * 2 - 2), 1); }
      px(hue[1], 8, 8, 3, 2); px("#ffffff", 9, 8);
    } else {                                                             // a key
      for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) { const d = x * x + y * y; if (d <= 10 && d >= 3) px("#ffd23f", 7 + x, 8 + y); }
      px("#ffd23f", 9, 10, 2, 2);
      for (let k = 0; k < 9; k++) px("#ffd23f", 10 + k, 11 + k, 2, 2);
      px("#c9913e", 15, 18, 3, 2); px("#c9913e", 17, 14, 3, 2);
    }
  } },
  crt: { size: 24, draw: function (px, n, rnd, name, i, accent) {        // a shader: a gradient under CRT scanlines
    const pairs = [[[54, 214, 231], [199, 125, 255]], [[255, 122, 69], [255, 210, 63]], [[61, 220, 151], [126, 166, 255]],
                   [[255, 92, 138], [54, 214, 231]], [[30, 30, 60], [54, 214, 231]]];
    const p = pairs[i % pairs.length], tilt = rnd() * 0.8, block = name.indexOf("pixel") >= 0 ? 4 : 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const bx = Math.floor(x / block) * block, by = Math.floor(y / block) * block;
      let t = Math.min(1, Math.max(0, (bx + by * tilt) / (n * (1 + tilt))));
      t = Math.round(t * 5) / 5;
      const dim = y % 2 ? 0.55 : 1;
      const cx = Math.abs(x - 11.5) / 12, cy = Math.abs(y - 11.5) / 12, vig = 1 - Math.max(0, cx * cx + cy * cy - 0.45);
      const ch = function (k) { return Math.round((p[0][k] + (p[1][k] - p[0][k]) * t) * dim * vig); };
      px("rgb(" + ch(0) + "," + ch(1) + "," + ch(2) + ")", x, y);
    }
    [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]].forEach(function (c) { px("#1c1a24", c[0], c[1]); });
  } },
  figure: { size: 24, draw: function (px, n, rnd, name, i, accent) {    // a character: a little pixel figure
    const goblin = /goblin|orc|slime/.test(name);
    const skin = goblin ? "#7bc950" : ["#f2c9a0", "#c98e5e", "#8a5a3c"][Math.floor(rnd() * 3)];
    const tunic = [accent, "#7ea6ff", "#c9913e", "#3ddc97", "#c77dff"][i % 5];
    const hair = ["#5a3420", "#ffd23f", "#2a2633", "#c25326"][Math.floor(rnd() * 4)];
    const ox = 7 + Math.floor(rnd() * 2);
    px("#14131a", ox, 3, 10, 19);                                        // the outline
    px(skin, ox + 1, 4, 8, 6);
    if (/mage|wizard/.test(name)) { px("#4a284e", ox - 1, 1, 12, 4); px("#4a284e", ox + 3, -1, 4, 2); }
    else if (/knight/.test(name)) { px("#8f96b8", ox + 1, 3, 8, 4); px("#d8dde8", ox + 2, 3, 6, 1); }
    else px(goblin ? "#3b7a3c" : hair, ox + 1, 4, 8, 2);
    px("#14131a", ox + 3, 7); px("#14131a", ox + 6, 7);
    if (goblin) { px(skin, ox - 1, 6, 2, 2); px(skin, ox + 9, 6, 2, 2); }
    px(tunic, ox + 1, 11, 8, 6); px(skin, ox - 1, 12, 2, 4); px(skin, ox + 9, 12, 2, 4);
    px("#5a3420", ox + 1, 15, 8, 1);
    px("#33364a", ox + 2, 17, 2, 4); px("#33364a", ox + 6, 17, 2, 4);
    px("#2a2633", ox + 1, 21, 3, 1); px("#2a2633", ox + 6, 21, 3, 1);
  } },
};

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
    const old = w.files[0].indexOf(".") > 0 ? w.files[0].replace(/(\.[^.]+)$/, "-old$1") : w.files[0] + "-old";
    const used = [{ path: w.child + "/" + w.slug + "/" + old, by: [w.uses] }];
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
        const noun = (DESKTOP_TOUR_APPS[t.id] || DESKTOP_TOUR_DEFAULTS).noun;
        return { key: t.id, name: t.name, summary: (i ? 2 : 4) + " " + noun + " in " + desktopTourChild(t.id, "godot") + "/", open: function () {} };
      });
    } : null,
  });
  return lib;
}

const desktopTour = { open: desktopTourOpen, link: desktopTourLink, words: desktopTourWords, panels: desktopTourPanels };
