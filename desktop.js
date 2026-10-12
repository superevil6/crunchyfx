// GENERATED from crunchyCore/desktop.js @ b41dd27 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 a1f5b9e5ddac820d37fe7505465c2cbccd25456cb164e773f1e49feea8a51327
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
// tool's name and store link). Styled by the `desk-*` block in crunchy-base.css.
//
// desktopIs() → bool                    true inside the Tauri desktop app
// desktopStoreUrl(self) → string        the tool's store page, "" until it is published
// desktopMount(self, { place, adds, openUrl }) → { isDesktop, cta, open, close }
//   self     the tool's id in CRUNCHY_SUITE ("tile", "ui", "sfx", "vfx", "bgm", "character")
//   place    the element the web's button is appended to (the header)
//   adds     what the desktop adds, as [title, plain-text line] pairs: the app's own honest list
//   openUrl  (url) → open it; default a new tab

const DESKTOP_BUILD = 1;

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
  const el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const icon = function (target, name) {
    const ic = typeof crunchyIcon === "function" ? crunchyIcon(name) : null;
    if (ic) target.insertBefore(ic, target.firstChild);
  };
  const go = opts.openUrl || function (u) { window.open(u, "_blank", "noopener"); };

  const root = el("div", "desk-overlay");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", tool.name + " Desktop");
  const panel = el("div", "desk-panel"), head = el("div", "desk-head");
  const title = el("h2", "desk-title", tool.name + " Desktop");
  icon(title, "monitor");
  head.appendChild(title);
  const x = el("button", "desk-close", "×");
  x.type = "button"; x.title = "Close (Esc)";
  head.appendChild(x);
  panel.appendChild(head);
  panel.appendChild(el("p", "desk-line", "The web version stays free, and makes everything. The desktop app adds the workflow around it."));
  const list = el("ul", "desk-adds");
  (opts.adds || []).forEach(function (a) {
    const li = el("li");
    li.appendChild(el("b", null, a[0]));
    li.appendChild(document.createTextNode(" " + a[1]));
    list.appendChild(li);
  });
  panel.appendChild(list);
  panel.appendChild(el("p", "desk-note", "Everything you make in the web version is yours: full resolution, no watermark, CC0. " +
    "The desktop app is about keeping and organising your work, never about holding any of it back."));
  const foot = el("div", "desk-foot"), get = el("button", "primary", "Get it on itch.io ↗");
  get.type = "button";
  get.addEventListener("click", function () { go(url); });
  foot.appendChild(get);
  foot.appendChild(el("span", "desk-hint", "One-time purchase. No account, no subscription."));
  panel.appendChild(foot);
  root.appendChild(panel);
  document.body.appendChild(root);

  const cta = el("button", "desk-cta", "Get the desktop app");
  cta.type = "button";
  cta.title = "What the " + tool.name + " desktop app adds, and where to get it";
  icon(cta, "monitor");
  if (opts.place) opts.place.appendChild(cta);

  function open() { root.hidden = false; x.focus(); }
  function close() { root.hidden = true; }
  cta.addEventListener("click", open);
  x.addEventListener("click", close);
  root.addEventListener("click", function (e) { if (e.target === root) close(); });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  return { isDesktop: false, cta: cta, open: open, close: close };
}
