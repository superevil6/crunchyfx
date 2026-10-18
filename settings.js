// GENERATED from crunchyCore/settings.js @ 0dfc8c4 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 661aad65e8a71a7faf584f94ec313fd83d89b4bf626c5e077a6eab77d3fe9508
"use strict";
// THE SETTINGS DIALOG — one ⚙ Settings for every Crunchy tool (CONSOLIDATION-PLAN.md §2; crunchyTile TILE-DESIGN.md
// §93.1, from CrunchyBGM's preferences dialog). PREFERENCES, which follow the person, not the design: never in a
// share link, a saved design or the history. The app owns its preferences and where they are stored; this file only
// draws the rows it is given and calls back.
//
// A DOM component, like suite.js: the DOM is touched only inside settingsMount's functions. Styled by the `set-*`
// block in crunchy-base.css.
//
// settingsMount({ button, rows, hint, id }) → { open, close, isOpen, refresh }
//   button   the element that opens it (the app places it; give it data-icon="cog")
//   rows     in order, each one of:
//              { type: "check",  label, sub, id, get() → bool, set(bool) }   a preference, as a checkbox
//              { type: "button", label, sub, text, run() }                   an action (replay the tour, check for updates)
//              { type: "element", label, sub, el }                           the app's own control(s), placed on the right
//                                                                            (build 2: CrunchySFX's four export-format selects)
//            `id` names the checkbox (so a test can find it); `sub` is the plain-text explanation under the label.
//   hint     the line beside the title (default: what preferences are)
//   id       the overlay's id (default "setModal")
//   tour     (build 3) the LAST row is "What does the desktop app add?", opening desktop.js's tour, whenever desktop.js is
//            loaded: `tour` is the tool's suite id (default PROJECT_APP.suite); false leaves the row out
// refresh() re-reads every check's get(): call it when a preference changes elsewhere. open() refreshes first.

const SETTINGS_BUILD = 3;

function settingsMount(opts) {
  opts = opts || {};
  let root = null;
  const checks = [];
  const el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function tourRow() {                                            // build 3: the desktop tour, from every app's Settings
    const self = opts.tour !== undefined ? opts.tour : typeof PROJECT_APP !== "undefined" && PROJECT_APP ? PROJECT_APP.suite : null;
    if (!self || typeof desktopTourOpen !== "function") return null;
    return { type: "button", label: "What does the desktop app add?", text: "Show me",
             sub: "A short look at the desktop app in action: planted in your game, saved into it, updated in place, and the Library.",
             run: function () { close(); desktopTourOpen(self); } };
  }
  function build() {
    root = el("div", "set-overlay");
    root.id = opts.id || "setModal";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Settings");
    root.addEventListener("click", function (e) { if (e.target === root) close(); });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    const panel = el("div", "set-panel"), head = el("div", "set-head");
    const title = el("h2", "set-title", "Settings");
    const ic = typeof crunchyIcon === "function" ? crunchyIcon("cog") : null;
    if (ic) title.insertBefore(ic, title.firstChild);
    head.appendChild(title);
    head.appendChild(el("span", "set-hint", opts.hint || "Preferences, not design settings: these follow you, not the file."));
    const x = el("button", "set-close", "×");
    x.type = "button"; x.title = "Close (Esc)";
    x.addEventListener("click", close);
    head.appendChild(x);
    panel.appendChild(head);
    const tour = tourRow();
    (opts.rows || []).concat(tour ? [tour] : []).forEach(function (r) {
      const row = el("div", "setrow"), lbl = el("div", "setlbl", r.label);
      if (r.sub) lbl.appendChild(el("span", "setsub", r.sub));
      row.appendChild(lbl);
      if (r.type === "check") {
        const wrap = el("label", "setchk"), box = el("input");
        box.type = "checkbox";
        if (r.id) box.id = r.id;
        box.setAttribute("aria-label", r.label);
        box.addEventListener("change", function () { r.set(box.checked); });
        wrap.appendChild(box);
        row.appendChild(wrap);
        checks.push({ box: box, row: r });
      } else if (r.type === "element" && r.el) {
        const box = el("div", "set-el");
        box.appendChild(r.el);
        row.appendChild(box);
      } else if (r.type === "button") {
        const b = el("button", "set-btn", r.text || r.label);
        b.type = "button";
        b.addEventListener("click", function () { r.run(); });
        row.appendChild(b);
      }
      panel.appendChild(row);
    });
    root.appendChild(panel);
    document.body.appendChild(root);
  }
  function refresh() { checks.forEach(function (c) { c.box.checked = !!c.row.get(); }); }
  function open() {
    if (!root) build();
    refresh();
    root.hidden = false;
    root.querySelector(".set-close").focus();
  }
  function close() { if (root) root.hidden = true; }
  if (opts.button) opts.button.addEventListener("click", open);
  return { open: open, close: close, refresh: refresh, isOpen: function () { return !!root && !root.hidden; } };
}
