// GENERATED from crunchyCore/feedback.js @ 4108e9a by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 d9e4f56f5f85ab54ea5c0e2c18b381a04108182ef8e282ac4e806de5fad9d800
"use strict";
// Crunchy suite — FEEDBACK: one "Send feedback" for every Crunchy tool (AJ, 2026-10-12: "we need a feedback loop for
// this", and "no telemetry. I hate it myself"). The apps never touch the network (each app's wiring test says so), so
// nothing here sends anything: the person writes what they were doing and what happened, SEES every detail that would
// go with it (and can untick any), then either copies the report or presses Send, which opens THEIR OWN mail app with
// the report filled in, addressed to FEEDBACK_ADDRESS. Nothing leaves until they press send there.
//
// A DOM component, like settings.js: the DOM is touched only inside feedbackMount's functions. Styled by the `fb-*` block
// in crunchy-base.css. The report itself (feedbackReport, feedbackMailto) is pure, and tested without a DOM.
//
// feedbackMount({ app, version, button, details, share, openUrl, id }) → { open, close, isOpen, note }
//   app       the tool's name ("CrunchyBGM"): the subject's tag
//   version   the app's version ("0.1.0"); the core commit is read from the copies' headers when the app passes it in
//             `details` (an app knows its own pins)
//   button    the element that opens it (the app places it; give it data-icon="mail")
//   details() → [[label, value]] the app's own lines, shown and removable: web or desktop, the planted engine, the tab …
//   share()   → a link that reopens what is on screen, or null: offered as one more line, OFF by default (a design is the
//               person's work; they choose to send it)
//   openUrl   the desktop's way to open a mailto: link (the opener plugin); the web uses location
//   id        the overlay's id (default "fbModal")
// note(text) puts a line in the RECENT list (what the app's status line said: a save, an error), kept in memory only,
// the last FEEDBACK_KEEP. Errors the page throws are noted too, once the dialog is mounted. Never written to disk.

const FEEDBACK_BUILD = 1;
const FEEDBACK_ADDRESS = "feedback@crunchytile.com";      // Cloudflare Email Routing on crunchytile.com (AJ, 2026-10-12)
const FEEDBACK_KEEP = 12;                                 // recent lines kept
const FEEDBACK_MAILTO_MAX = 1800;                         // a mailto: link longer than this is cut by some mail apps

// The report as plain text, from what the person wrote and the details they kept ticked.
//   { app, trying, happened, details: [[label, value]] } → { subject, body }
function feedbackReport(r) {
  const clean = function (s) { return String(s == null ? "" : s).replace(/\r\n?/g, "\n").trim(); };
  const trying = clean(r.trying), happened = clean(r.happened);
  const first = (happened || trying || "Feedback").split("\n")[0].slice(0, 70);
  const lines = [];
  if (trying) lines.push("What I was trying to do:", trying, "");
  if (happened) lines.push("What happened:", happened, "");
  const det = (r.details || []).filter(function (d) { return d && d[0] && d[1] != null && String(d[1]) !== ""; });
  if (det.length) {
    lines.push("--- details (shown to me before sending) ---");
    det.forEach(function (d) { lines.push(d[0] + ": " + String(d[1]).replace(/\n+/g, "\n  ")); });
  }
  return { subject: "[" + (r.app || "Crunchy") + "] " + first, body: lines.join("\n").trim() + "\n" };
}
// The mailto: link for a report. Too long for a mail app to take whole: the body is cut at a line and says so (Copy
// report gives the whole text).
function feedbackMailto(rep, address) {
  const to = "mailto:" + (address || FEEDBACK_ADDRESS) + "?subject=" + encodeURIComponent(rep.subject) + "&body=";
  let body = rep.body;
  if ((to + encodeURIComponent(body)).length > FEEDBACK_MAILTO_MAX) {
    const tail = "\n(shortened to fit an email link: use Copy report for the whole text)\n";
    const lines = body.split("\n");
    while (lines.length > 1 && (to + encodeURIComponent(lines.join("\n") + tail)).length > FEEDBACK_MAILTO_MAX) lines.pop();
    body = lines.join("\n") + tail;
  }
  return to + encodeURIComponent(body);
}

function feedbackMount(opts) {
  opts = opts || {};
  const recent = [];
  const note = function (text) {
    const t = String(text || "").trim();
    if (!t || recent[recent.length - 1] === t) return;
    recent.push(t.slice(0, 300));
    if (recent.length > FEEDBACK_KEEP) recent.shift();
  };
  // what the page throws, noted (never sent: it waits here for a report the person chooses to make)
  window.addEventListener("error", function (e) { note("error: " + (e && e.message ? e.message : e)); });
  window.addEventListener("unhandledrejection", function (e) { const r = e && e.reason; note("error: " + (r && r.message ? r.message : r)); });

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
  const root = el("div", "fb-overlay");
  root.id = opts.id || "fbModal";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Send feedback");
  const panel = el("div", "fb-panel");
  const head = el("div", "fb-head");
  const title = el("h2", "fb-title", "Send feedback");
  icon(title, "mail");
  head.appendChild(title);
  head.appendChild(el("span", "fb-hint", "Goes to the person who makes " + (opts.app || "this tool") + ", from your own mail app. Nothing is sent without you."));
  const x = el("button", "fb-close", "×");
  x.type = "button"; x.title = "Close (Esc)";
  head.appendChild(x);
  panel.appendChild(head);

  const field = function (label, ph) {
    const wrap = el("label", "fb-field");
    wrap.appendChild(el("span", "fb-label", label));
    const ta = el("textarea", "fb-text");
    ta.rows = 3; ta.placeholder = ph;
    wrap.appendChild(ta);
    panel.appendChild(wrap);
    return ta;
  };
  const trying = field("What were you trying to do?", "e.g. put a character into my Godot game");
  const happened = field("What happened? (Or an idea, or what you liked.)", "e.g. the Save button did nothing, or I wished it could…");
  const detHead = el("div", "fb-label", "Sent with it: untick anything you'd rather not include");
  panel.appendChild(detHead);
  const detBox = el("div", "fb-details");
  panel.appendChild(detBox);
  const foot = el("div", "fb-foot");
  const copy = el("button", "", "Copy report");
  copy.type = "button"; copy.dataset.icon = "copy";
  const send = el("button", "primary", "Send by email");
  send.type = "button"; send.dataset.icon = "mail";
  send.title = "Opens your mail app with the report filled in, to " + FEEDBACK_ADDRESS + ": you press send there";
  const said = el("span", "fb-said", "");
  foot.appendChild(copy); foot.appendChild(send); foot.appendChild(said);
  panel.appendChild(foot);
  root.appendChild(panel);
  document.body.appendChild(root);
  if (typeof crunchyIconsApply === "function") crunchyIconsApply(root);

  // the detail lines, each with its checkbox: [[label, value, on]]
  let rows = [];
  const buildDetails = function () {
    rows = [];
    rows.push(["App", (opts.app || "") + (opts.version ? " " + opts.version : ""), true]);
    (typeof opts.details === "function" ? opts.details() || [] : []).forEach(function (d) { if (d && d[0]) rows.push([d[0], d[1], true]); });
    rows.push(["Browser", navigator.userAgent, true]);
    if (recent.length) rows.push(["Recent", recent.join("\n"), true]);
    const link = typeof opts.share === "function" ? opts.share() : null;
    if (link) rows.push(["Link to what was on screen", link, false]);
    detBox.textContent = "";
    rows.forEach(function (r, i) {
      const line = el("label", "fb-det");
      const cb = el("input");
      cb.type = "checkbox"; cb.checked = r[2];
      cb.addEventListener("change", function () { rows[i][2] = cb.checked; });
      line.appendChild(cb);
      line.appendChild(el("b", "", r[0] + ": "));
      line.appendChild(el("span", "fb-val", String(r[1])));
      detBox.appendChild(line);
    });
  };
  const report = function () {
    return feedbackReport({ app: opts.app, trying: trying.value, happened: happened.value,
      details: rows.filter(function (r) { return r[2]; }).map(function (r) { return [r[0], r[1]]; }) });
  };
  const text = function (rep) { return "To: " + FEEDBACK_ADDRESS + "\nSubject: " + rep.subject + "\n\n" + rep.body; };
  copy.addEventListener("click", function () {
    const t = text(report());
    const done = function () { said.textContent = "Copied. Paste it into an email to " + FEEDBACK_ADDRESS + "."; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { fallback(t); done(); });
    else { fallback(t); done(); }
  });
  const fallback = function (t) {
    const ta = el("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { /* the text is still selectable in the dialog's fields */ }
    ta.remove();
  };
  send.addEventListener("click", function () {
    const rep = report();
    if (!trying.value.trim() && !happened.value.trim()) { said.textContent = "Write a line or two first: what were you doing, and what happened?"; return; }
    const url = feedbackMailto(rep);
    if (typeof opts.openUrl === "function") opts.openUrl(url); else window.location.href = url;
    // Many people have no mail app (webmail only, AJ's own PC had none): then nothing opens, so say what to do instead
    said.textContent = "Your mail app should open with the report: send it from there. Nothing opened? Use Copy report " +
      "and paste it into an email to " + FEEDBACK_ADDRESS + " (Gmail and the like work fine). Thank you!";
  });

  const open = function () { buildDetails(); said.textContent = ""; root.hidden = false; trying.focus(); };
  const close = function () { root.hidden = true; if (opts.button) opts.button.focus(); };
  x.addEventListener("click", close);
  root.addEventListener("click", function (e) { if (e.target === root) close(); });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  if (opts.button) opts.button.addEventListener("click", open);
  return { open: open, close: close, isOpen: function () { return !root.hidden; }, note: note, root: function () { return root; } };
}
