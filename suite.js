// GENERATED from crunchyCore/suite.js @ f97934f by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 7be377fde736ec43f3da4b7b5f1be8557814b26912ab1ef9dba324c089b86151
"use strict";
// THE CRUNCHY SUITE (TILE-DESIGN.md §80): one button, one dialog listing every Crunchy tool with a line
// about what it makes and where to get it. AJ, 2026-10-09: "A Crunchy Suite Button that pops open a modal
// with links to the other Crunchy applications and one liner about what they do."
//
// A CORE FILE (crunchyCore; each app pulls it with tools/pull-core.mjs, unchanged), then calls
// suiteMount("<its id>", …). CHANGE A LINK OR A LINE IN crunchyCore, so the apps never disagree about each other.
// Its styles are the `suite-*` block in crunchy-base.css.
//
// EACH TOOL IN ITS OWN COLOR (build 4, CONSOLIDATION-PLAN.md §9): `accent` is that app's --accent, set on its row
// as --tool, so the list reads as siblings. `pxi` names its pixel icon (crunchy-icons.js); an app that has not pulled
// the icons yet shows the text glyph in `icon` instead.
//
// The data is pure; the DOM is touched only inside suiteMount's functions (the wiring test loads every
// sibling with no DOM).
//
// LINKS: a web link only once that deploy answers, a desktop link only once its store page is published.
// A tool with neither says "coming soon". A dead link from a store-bought app looks worse than none.
// Each tool has its own .com (crunchysfx.com, crunchyvfx.com and crunchybgm.com are live, crunchytile.com since
// 2026-10-09; crunchyui.com since 2026-10-11). When a link changes, change it HERE, AND in
// each desktop app's capability scope (src-tauri/capabilities: opener:allow-open-url), which opens only
// the hosts listed there. A link outside that scope does nothing on desktop.
// PRICE (build 9): `price` is the desktop app's one-time price as shown ("$6"), set only beside a `desktop` link;
// desktop.js's tour says it in its pitch. Change it HERE when the store page's price changes.

const SUITE_BUILD = 16;
const CRUNCHY_SUITE = [
  { id: "tile", name: "CrunchyTile", icon: "▦", pxi: "grid", accent: "#ff7a45",
    what: "Tilesets, backdrops, objects and rooms for top-down and side-scrolling games, ready for Godot and Unity.",
    web: "https://crunchytile.com/", desktop: "https://sevi66.itch.io/crunchytile", price: "$6" },
  { id: "ui", name: "CrunchyUI", icon: "▣", pxi: "window", accent: "#7ea6ff",
    what: "Game UI: panels, buttons, bars, frames, slots, cursors and icons, with 9-slice insets.",
    web: "https://crunchyui.com/", desktop: "https://sevi66.itch.io/crunchyui", price: "$6" },   // desktop 1.0.0, 2026-10-22
  { id: "sfx", name: "CrunchySFX", icon: "♪", pxi: "speaker", accent: "#ffd23f",
    what: "Sound effects from scratch: coins, lasers, explosions, robot voices and more, as WAV.",
    web: "https://crunchysfx.com/", desktop: "https://sevi66.itch.io/crunchysfx", price: "$6" },
  { id: "vfx", name: "CrunchyVFX", icon: "✸", pxi: "sparkle", accent: "#c77dff",
    what: "Sprite effects: explosions, hit sparks, magic, smoke and weather, as sprite sheets.",
    web: "https://crunchyvfx.com/", desktop: "https://sevi66.itch.io/crunchyvfx", price: "$6" },
  { id: "bgm", name: "CrunchyBGM", icon: "♫", pxi: "music", accent: "#3ddc97",
    what: "Background music: whole game scores in seamless loops, with layers your engine mixes live.",
    web: "https://crunchybgm.com/", desktop: "" },
  // Added 2026-10-09 (build 3) from CrunchyCharacter, at AJ's request. No domain or store page yet.
  { id: "character", name: "CrunchyCharacter", icon: "♟", pxi: "person", accent: "#ff5c8a",
    what: "Animated pixel-art characters for top-down RPGs: idle and walk in every facing, ready for Godot and RPG Maker.",
    web: "", desktop: "" },
  // Added 2026-10-13 (build 6) as CrunchyItems (SUITE-LINKS §5). Build 11 (2026-10-18): renamed CrunchyItem (AJ: "misnamed
  // by me"), live on the web at crunchyitem.com. The id stays "items" (every app's tests and links key on it).
  { id: "items", name: "CrunchyItem", icon: "⚔", pxi: "sword", accent: "#a6e22e",
    what: "Item icons for RPGs: swords, bows, potions, keys and gems at 16, 24 and 32 px, ready for Godot and RPG Maker.",
    web: "https://crunchyitem.com/", desktop: "https://sevi66.itch.io/crunchyitem", price: "$6" },   // desktop 1.0.0, 2026-10-21
  // Added 2026-10-14 (build 7): CrunchyShader (crunchyTile SHADER-HANDOFF.md). No domain or store page yet.
  { id: "shader", name: "CrunchyShader", icon: "◐", pxi: "shade", accent: "#36d6e7",
    what: "Pixel-art shaders: looks, eras, CRT, sprite flashes and screen transitions, ready for Godot and the web.",
    web: "https://crunchyshader.com/", desktop: "https://sevi66.itch.io/crunchyshader", price: "$6" },   // desktop 1.0.0, 2026-10-23
];
// The mission statement's one line (crunchy-suite.md §1). Quoted, never reworded.
const SUITE_LINE = "Crunchy tools make the art and sound for your game, so you can spend your time on the game.";

// The tools other than `self`, with `self` first (it is marked "you're here").
function suiteList(self) {
  const me = CRUNCHY_SUITE.filter(function (t) { return t.id === self; });
  return me.concat(CRUNCHY_SUITE.filter(function (t) { return t.id !== self; }));
}

// suiteMount(self, { button, openUrl }) → { open, close, isOpen }
//   button   the element that opens it (the app places it)
//   openUrl  (url) → opens it outside the app. The web passes nothing (a plain link with target _blank);
//            the desktop app passes its opener plugin, since a webview will not leave for a browser itself.
function suiteMount(self, opts) {
  opts = opts || {};
  let root = null;
  const el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function link(label, url, title) {
    const a = el("a", "suite-link", label);
    a.href = url; a.target = "_blank"; a.rel = "noopener"; a.title = title;
    if (opts.openUrl) a.addEventListener("click", function (e) { e.preventDefault(); opts.openUrl(url); });
    return a;
  }
  function build() {
    root = el("div", "suite-overlay");
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "The Crunchy suite");
    root.addEventListener("click", function (e) { if (e.target === root) close(); });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    const panel = el("div", "suite-panel");
    const head = el("div", "suite-head");
    head.appendChild(el("h2", "suite-title", "The Crunchy suite"));
    const x = el("button", "suite-close", "×");
    x.title = "Close (Esc)";
    x.addEventListener("click", close);
    head.appendChild(x);
    panel.appendChild(head);
    panel.appendChild(el("p", "suite-line", SUITE_LINE));
    const list = el("div", "suite-list");
    suiteList(self).forEach(function (t) {
      const row = el("div", "suite-tool" + (t.id === self ? " here" : ""));
      row.dataset.id = t.id;
      row.style.setProperty("--tool", t.accent);
      const mark = el("span", "suite-icon"), px = typeof crunchyIcon === "function" ? crunchyIcon(t.pxi) : null;
      if (px) mark.appendChild(px); else mark.textContent = t.icon;
      row.appendChild(mark);
      const body = el("div", "suite-body");
      body.appendChild(el("strong", "suite-name", t.name));
      body.appendChild(el("span", "suite-what", t.what));
      row.appendChild(body);
      const go = el("div", "suite-go");
      if (t.id === self) go.appendChild(el("span", "suite-here", "You're here"));
      else {
        if (t.web) go.appendChild(link("Open ↗", t.web, "Open " + t.name + " in your browser (free)"));
        if (t.desktop) go.appendChild(link("Desktop ↗", t.desktop, t.name + "'s desktop app on itch.io"));
        if (!t.web && !t.desktop) go.appendChild(el("span", "suite-soon", "Coming soon"));
      }
      row.appendChild(go);
      list.appendChild(row);
    });
    panel.appendChild(list);
    panel.appendChild(el("p", "suite-foot", "Every Crunchy tool makes everything in code, with no generative AI and no samples, " +
      "and what you make is CC0. The web versions are free; the desktop versions add workflow, never features."));
    root.appendChild(panel);
    document.body.appendChild(root);
  }
  function open() {
    if (!root) build();
    root.hidden = false;
    root.querySelector(".suite-close").focus();
  }
  function close() { if (root) root.hidden = true; }
  if (opts.button) opts.button.addEventListener("click", open);
  return { open: open, close: close, isOpen: function () { return !!root && !root.hidden; } };
}
