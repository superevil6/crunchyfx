// CrunchySFX — per-sound Open Graph cards (Cloudflare Pages Function).
//
// WHAT THIS DOES
//   A shared link is  https://crunchysfx.com/?s=<base64url-patch> .  The static
//   index.html already carries a generic OG card (see its <head>), so every link
//   unfurls to a branded "click to hear" card even without this file.  This
//   middleware upgrades that card *per sound*: it reads ?s=, pulls the sound's
//   name out of the patch (the `t` field encodePatch() puts there), and rewrites
//   the og:/twitter: title + description so the card reads e.g.
//       🔊 Laser Zap — CrunchySFX      Click to hear "Laser Zap" …
//   It streams-edits the real index.html via HTMLRewriter, so the page the
//   browser runs is unchanged — only the crawler-facing meta tags differ.
//
// WHERE IT RUNS
//   Cloudflare Pages runs any file under /functions automatically; `_middleware`
//   wraps every route.  On a plain static host (GitHub Pages) this file is inert
//   (never executed), and the generic static card is used instead — no breakage.
//   The Tauri desktop build never sees it (build.rs copies only the 4 app files).
//
// NOT VERIFIABLE HERE (no Cloudflare runtime in this env).  Deploy to a Pages
// preview and check with a card validator (e.g. the OpenGraph.xyz debugger) or by
// pasting a ?s= link into Discord.  atob + HTMLRewriter are Workers built-ins.

const MAX_TITLE = 60; // keep card titles tidy; also caps abuse from crafted links

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Decode the same base64url payload encodePatch() produces; return its title (`t`)
// or null. Never throws — a malformed link just falls back to the generic card.
function soundTitle(s) {
  try {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const obj = JSON.parse(atob(b64));
    if (obj && typeof obj.t === "string" && obj.t.trim()) {
      return obj.t.trim().slice(0, MAX_TITLE);
    }
  } catch (_) { /* ignore — generic card */ }
  return null;
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const s = url.searchParams.get("s");
  const res = await next(); // the static index.html (or asset)

  const isHtml = (res.headers.get("content-type") || "").includes("text/html");
  const title = s ? soundTitle(s) : null;
  if (!isHtml || !title) return res; // no sound / not HTML -> untouched static card

  const ogTitle = `🔊 ${title} — CrunchySFX`;
  const ogDesc = `Click to hear "${title}" — made with CrunchySFX, the free from-scratch sound-effect generator. Make your own and share it as a link.`;
  const set = (v) => ({ element: (e) => e.setAttribute("content", v) });

  return new HTMLRewriter()
    .on('meta[property="og:title"]',       set(esc(ogTitle)))
    .on('meta[name="twitter:title"]',      set(esc(ogTitle)))
    .on('meta[property="og:description"]', set(esc(ogDesc)))
    .on('meta[name="twitter:description"]',set(esc(ogDesc)))
    .on('meta[property="og:url"]',         set(esc(url.href)))
    .on('title', { element: (e) => e.setInnerContent(`${title} — CrunchySFX`) })
    .transform(res);
}
