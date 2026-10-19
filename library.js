// GENERATED from crunchyCore/library.js @ 72870b9 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 9514b82baa8360e28ab72b526f3197b1725f29a7c4129305068b0007cba1a5b5
"use strict";
// CrunchyTile — THE LIBRARY (TILE-DESIGN.md §79): a visual asset viewer over a project, as a PORTABLE
// COMPONENT. AJ, 2026-10-09: "a visual project/asset viewer is a very obvious oversight in ALL of the
// suite's tools" — so this file knows nothing about tiles. The app hands it callbacks; it draws the
// overlay, the search, the filter chips, the cards and their actions, and reports back.
//
// It touches the DOM only INSIDE its functions, never at load (the wiring test runs every sibling with no
// DOM). Its styles are the `lib-*` block in styles.css, written against the suite's shared custom
// properties (--bg, --panel, --panel2, --line, --ink, --muted, --accent, --accent2, --bad), so the
// block copies into any Crunchy tool unchanged. See PROJECTS-HANDOFF.md.
//
//   const lib = libraryMount({
//     title: "Library",
//     project()            → { name, dir } or null (no project open: the start screen shows)
//     start: [{ label, title, run, primary }]            buttons on the start screen and the top bar
//     recent()             → [{ name, dir }]; openRecent(dir)
//     links()              → [{ key, label, path, hint, link(), unlink() }]   linked game projects
//     toggles()            → [{ key, label, title, checked, change(on) }]
//     commands()           → [{ label, title, run, primary }]                e.g. Export all
//     kinds()              → [{ key, label }]                                filter chips (after "All")
//     items()              → [{ id, name, kind, group, meta, badges: [{ text, title }] }]
//     thumb(item, canvas)  paints the card's picture
//     open(item)           the card's picture was clicked
//     rename(item, name)   → Promise (rejects with a message to show)
//     actions              → [{ label, title, run(item), confirm }]          confirm: a second click
//     (build 2, DESKTOP-ROADMAP.md, all optional; without them it is the dialog it always was)
//     items()[].badges[].hot  a badge that must be noticed ("update available"): drawn in the accent
//     tabs()               → [{ key, label, title, render(el) }]   (build 4, DESKTOP-ROADMAP.md) a row of TABS under the
//                            top bar, the first selected. An asset tab shows the items whose `tab` is its key (search
//                            and kind chips work inside it); a tab with `render` is the APP's own: the panel clears an
//                            element and hands it over (CrunchyVFX's Imports & history; CrunchyBGM's six libraries are
//                            asset tabs). A tab's `count` (optional) is shown after its label.
//     actions[].label        may be a function(item) (build 4): a button that says what it will do NOW (Play / Stop)
//     actions[].when(item)  (build 3) show this card button only where it returns true (Re-export: only on a card
//                           that has an update; Replace: only where the editor holds the same kind of thing)
//     dock                 an element: the Library is a PANEL docked in it rather than an overlay dialog
//     startHint, emptyHint the start screen's line and the empty grid's line (planted apps say "plant", not "link")
//     suite()              → [{ key, name, summary, title, open() }]   THE SUITE VIEW: what the other Crunchy tools
//                            planted in the same game, read-only, each with a button that opens that tool
//   });
//   lib.open(); lib.close(); lib.refresh(); lib.status("Saved."); lib.isOpen();

const LIBRARY_BUILD = 4;

function libraryMount(opts) {
  let root = null, grid = null, statusEl = null, searchEl = null, query = "", kind = "", tab = null, busy = false;
  const el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const button = function (b, cls) {
    const x = el("button", (cls || "") + (b.primary ? " primary" : ""), b.label);
    if (b.title) x.title = b.title;
    x.addEventListener("click", function () { run(b.run); });
    return x;
  };
  // Every callback may be async; one at a time, errors shown in the status line rather than thrown away.
  function run(fn, arg) {
    if (busy) return Promise.resolve();
    busy = true;
    root.classList.add("lib-busy");
    return Promise.resolve().then(function () { return fn(arg); })
      .catch(function (e) { status(String(e && e.message ? e.message : e)); })
      .then(function () { busy = false; root.classList.remove("lib-busy"); refresh(); });
  }
  function status(text) { if (statusEl) statusEl.textContent = text || ""; }

  function build() {
    if (opts.dock) {                                              // a PANEL beside the app's controls (build 2)
      root = el("aside", "lib-dock");
      root.hidden = true;
      root.setAttribute("aria-label", opts.title || "Library");
      root.addEventListener("keydown", function (e) { if (e.key === "Escape" && e.target.tagName !== "INPUT") { e.stopPropagation(); close(); } });
      root.appendChild(el("div", "lib-panel lib-docked"));
      opts.dock.appendChild(root);
      return;
    }
    root = el("div", "lib-overlay");
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", opts.title || "Library");
    root.addEventListener("click", function (e) { if (e.target === root) close(); });
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    const panel = el("div", "lib-panel");
    root.appendChild(panel);
    document.body.appendChild(root);
  }
  function refresh() {
    if (!root || root.hidden) return;
    const panel = root.firstChild, keepStatus = statusEl ? statusEl.textContent : "";
    panel.textContent = "";
    const P = opts.project();

    const top = el("div", "lib-top");
    top.appendChild(el("h2", "lib-title", (opts.title || "Library") + (P ? " · " + P.name : "")));
    if (P) { const path = el("span", "lib-path", P.dir); path.title = P.dir; top.appendChild(path); }
    top.appendChild(el("span", "lib-spacer"));
    (opts.start || []).forEach(function (b) { top.appendChild(button(b)); });
    const x = el("button", "lib-close", "×");
    x.title = opts.dock ? "Hide the Library (Esc)" : "Close (Esc)";
    x.addEventListener("click", close);
    top.appendChild(x);
    panel.appendChild(top);

    if (!P) {                                                     // the start screen
      const start = el("div", "lib-start");
      start.appendChild(el("p", "lib-hint", opts.startHint || "A project is a folder: every design you save is a small file in it, with a thumbnail, " +
        "and with a game project linked, its export lands straight in your game and is refreshed each time you save."));
      const rec = opts.recent ? opts.recent() : [];
      if (rec.length) {
        start.appendChild(el("h3", "lib-h", "Recent"));
        rec.forEach(function (r) {
          const b = el("button", "lib-recent");
          b.appendChild(el("strong", "", r.name));
          b.appendChild(el("span", "lib-path", r.dir));
          b.addEventListener("click", function () { run(opts.openRecent, r.dir); });
          start.appendChild(b);
        });
      }
      panel.appendChild(start);
    } else {
      const links = el("div", "lib-links");
      (opts.links ? opts.links() : []).forEach(function (l) {
        const row = el("div", "lib-link" + (l.path ? " linked" : ""));
        row.dataset.key = l.key;
        row.appendChild(el("strong", "", l.label));
        const p = el("span", "lib-path", l.path || l.hint || "not linked");
        if (l.path) p.title = l.path;
        row.appendChild(p);
        row.appendChild(button({ label: l.path ? "Change…" : "Link…", title: l.title, run: l.link }));
        if (l.path) row.appendChild(button({ label: "Unlink", title: "Stop exporting into this folder (nothing in it is deleted)", run: l.unlink }));
        links.appendChild(row);
      });
      const tools = el("div", "lib-tools");
      (opts.toggles ? opts.toggles() : []).forEach(function (t) {
        const lab = el("label", "lib-toggle");
        const cb = el("input");
        cb.type = "checkbox"; cb.checked = !!t.checked; cb.dataset.key = t.key;
        cb.addEventListener("change", function () { run(t.change, cb.checked); });
        lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + t.label));
        if (t.title) lab.title = t.title;
        tools.appendChild(lab);
      });
      (opts.commands ? opts.commands() : []).forEach(function (c) { tools.appendChild(button(c)); });
      links.appendChild(tools);
      if (links.childElementCount > 1 || tools.childElementCount) panel.appendChild(links);   // no empty bar (build 4)

      // TABS (build 4): asset tabs filter the cards; an app-drawn tab replaces the search, chips and cards
      const tabs = opts.tabs ? opts.tabs() : [];
      if (tabs.length && !tabs.some(function (t) { return t.key === tab; })) tab = tabs[0].key;
      const cur = tabs.find(function (t) { return t.key === tab; }) || null;
      if (tabs.length) {
        const row = el("div", "lib-tabs");
        row.setAttribute("role", "tablist");
        tabs.forEach(function (t) {
          const b = el("button", "lib-tab" + (t.key === tab ? " on" : ""), t.label + (t.count != null ? " " + t.count : ""));
          b.type = "button"; b.dataset.tab = t.key; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", t.key === tab ? "true" : "false");
          if (t.title) b.title = t.title;
          b.addEventListener("click", function () { if (tab !== t.key) { tab = t.key; kind = ""; query = ""; refresh(); } });
          row.appendChild(b);
        });
        panel.appendChild(row);
      }
      if (cur && cur.render) {
        const host = el("div", "lib-grid lib-own");
        host.dataset.tab = cur.key;
        panel.appendChild(host);
        try { cur.render(host); } catch (e) { host.appendChild(el("p", "lib-hint", String(e && e.message ? e.message : e))); }
        grid = null;
      } else {
      const bar = el("div", "lib-bar");
      searchEl = el("input", "lib-search");
      searchEl.type = "search"; searchEl.placeholder = "Search by name…"; searchEl.value = query;
      searchEl.addEventListener("input", function () { query = searchEl.value; drawGrid(); });
      bar.appendChild(searchEl);
      [{ key: "", label: "All" }].concat(typeof opts.kinds === "function" ? opts.kinds() : opts.kinds || []).forEach(function (k) {
        const chip = el("button", "lib-chip" + (kind === k.key ? " on" : ""), k.label);
        chip.dataset.kind = k.key;
        chip.addEventListener("click", function () { kind = k.key; refresh(); });
        bar.appendChild(chip);
      });
      panel.appendChild(bar);
      grid = el("div", "lib-grid");
      panel.appendChild(grid);
      drawGrid();
      }
      const others = opts.suite ? opts.suite() : [];
      if (others.length) {                                        // THE SUITE VIEW (build 2): read-only
        const sv = el("div", "lib-suite");
        sv.appendChild(el("h3", "lib-h", "Also in this game, from the Crunchy suite"));
        others.forEach(function (o) {
          const row = el("div", "lib-suite-row");
          row.dataset.key = o.key;
          row.appendChild(el("strong", "", o.name));
          row.appendChild(el("span", "lib-meta", o.summary));
          if (o.open) row.appendChild(button({ label: "Open " + o.name + " ↗", title: o.title, run: o.open }));
          sv.appendChild(row);
        });
        panel.appendChild(sv);
      }
    }
    statusEl = el("div", "lib-status", keepStatus);
    statusEl.setAttribute("aria-live", "polite");
    panel.appendChild(statusEl);
  }
  function drawGrid() {
    grid.textContent = "";
    const q = query.trim().toLowerCase();
    const items = opts.items().filter(function (it) {
      return (!tab || it.tab === tab) && (!kind || it.kind === kind) && (!q || it.name.toLowerCase().indexOf(q) >= 0 || String(it.group || "").toLowerCase().indexOf(q) >= 0);
    });
    if (!items.length) {
      grid.appendChild(el("p", "lib-hint", q || kind ? "Nothing matches." : opts.emptyHint || "Nothing saved yet. Name a design and press “Save to project”."));
      return;
    }
    // grouped, in the order the groups first appear
    const groups = [], by = {};
    items.forEach(function (it) {
      const g = it.group || "";
      if (!by[g]) { by[g] = []; groups.push(g); }
      by[g].push(it);
    });
    groups.forEach(function (g) {
      if (g) grid.appendChild(el("h3", "lib-h", g + " (" + by[g].length + ")"));
      const row = el("div", "lib-cards");
      by[g].forEach(function (it) { row.appendChild(card(it)); });
      grid.appendChild(row);
    });
  }
  function card(it) {
    const c = el("div", "lib-card");
    c.dataset.id = it.id;
    const pic = el("button", "lib-pic");
    pic.title = "Open " + it.name;
    const cv = el("canvas", "lib-thumb");
    try { opts.thumb(it, cv); } catch (e) { cv.width = cv.height = 1; }
    pic.appendChild(cv);
    pic.addEventListener("click", function () { run(opts.open, it); });
    c.appendChild(pic);
    const nm = el("div", "lib-name", it.name);
    nm.title = "Double-click to rename";
    nm.addEventListener("dblclick", function () { renameIn(c, nm, it); });
    c.appendChild(nm);
    if (it.meta) c.appendChild(el("div", "lib-meta", it.meta));
    if (it.badges && it.badges.length) {
      const bs = el("div", "lib-badges");
      it.badges.forEach(function (b) { const s = el("span", "lib-badge" + (b.hot ? " hot" : ""), b.text); if (b.title) s.title = b.title; bs.appendChild(s); });
      c.appendChild(bs);
    }
    const acts = el("div", "lib-acts");
    if (opts.rename) {
      const r = el("button", "", "Rename");
      r.addEventListener("click", function () { renameIn(c, nm, it); });
      acts.appendChild(r);
    }
    (opts.actions || []).forEach(function (a) {
      if (a.when && !a.when(it)) return;
      const b = el("button", a.confirm ? "lib-danger" : "", typeof a.label === "function" ? a.label(it) : a.label);
      if (a.title) b.title = a.title;
      b.addEventListener("click", function () {
        if (a.confirm && !b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Really?"; return; }
        run(a.run, it);
      });
      acts.appendChild(b);
    });
    c.appendChild(acts);
    return c;
  }
  function renameIn(c, nm, it) {
    const input = el("input", "lib-rename");
    input.type = "text"; input.maxLength = 60; input.value = it.name;
    let done = false;
    const finish = function (save) {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (!save || !v || v === it.name) { input.replaceWith(nm); return; }
      run(function () { return opts.rename(it, v); });
    };
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
    nm.replaceWith(input);
    input.focus(); input.select();
  }
  function open() {
    if (!root) build();
    query = ""; kind = "";                                        // a filter from last time would hide things (the tab stays)
    root.hidden = false;
    refresh();
    if (searchEl) searchEl.focus(); else root.querySelector("button").focus();
  }
  function close() { if (root) root.hidden = true; status(""); }
  return {
    open: open, close: close, refresh: refresh, status: status,
    isOpen: function () { return !!root && !root.hidden; },
    root: function () { return root; },
    tab: function (key) { if (key !== undefined) { tab = key; kind = ""; query = ""; refresh(); } return tab; },   // build 4
  };
}
