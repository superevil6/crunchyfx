// CrunchySFX — per-sound Open Graph cards (Cloudflare Worker + static assets).
//
// This is the ACTIVE edge handler for the current deployment: a Worker (Workers Builds
// connected to Git) that serves the site's static files through the ASSETS binding.
// Its twin, functions/_middleware.js, does the identical job but only runs if the project
// is ever re-created as a Cloudflare *Pages* project (Pages Functions). Keep the two in sync.
//
// WHAT IT DOES: serves every request from static assets unchanged, EXCEPT when the URL
// carries ?s=<patch> (a shared sound). Then it fetches index.html, reads the sound's name
// from the patch (the `t` field encodePatch() adds), and HTMLRewriter-rewrites the og:/
// twitter: title + description so the link unfurls as "🔊 Laser Zap — CrunchySFX".
// The page the browser runs is unchanged — only the crawler-facing meta tags differ.
//
// WHY wrangler.jsonc sets assets.run_worker_first = true: without it, a request for "/"
// matches the index.html asset and is served BEFORE this Worker runs, so ?s= links would
// never reach us. run_worker_first routes every request through here first; non-?s=
// requests fall straight through to env.ASSETS (one cheap pass-through call).
//
// UNVERIFIED on a Cloudflare runtime here (no CF in this env). The base64url→title decode
// is verified (same algorithm as decodePatch, tested headless). The ASSETS binding +
// HTMLRewriter wiring must be confirmed on a PREVIEW deploy — see the rollout notes in chat.
// soundTitle/esc are exported only so the headless test can exercise them; harmless in prod.

const MAX_TITLE = 60; // keep card titles tidy; also caps abuse from crafted links

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Decode the base64url payload encodePatch() produces; return its title (`t`) or null.
// Never throws — a malformed link just falls through to the generic static card.
export function soundTitle(s) {
  try {
    let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const obj = JSON.parse(atob(b64));
    if (obj && typeof obj.t === "string" && obj.t.trim()) return obj.t.trim().slice(0, MAX_TITLE);
  } catch (_) { /* ignore — generic card */ }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const s = url.searchParams.get("s");
    // Fast path: not a shared-sound link -> serve the static asset unchanged.
    if (!s) return env.ASSETS.fetch(request);

    const res = await env.ASSETS.fetch(request);
    const ct = res.headers.get("content-type") || "";
    const title = ct.includes("text/html") ? soundTitle(s) : null;
    if (!title) return res; // not an HTML doc, or no sound name -> leave the generic card

    const ogTitle = esc(`🔊 ${title} — CrunchySFX`);
    const ogDesc = esc(`Click to hear "${title}" — made with CrunchySFX, the free from-scratch sound-effect generator. Make your own and share it as a link.`);
    const set = (v) => ({ element: (e) => e.setAttribute("content", v) });

    return new HTMLRewriter()
      .on('meta[property="og:title"]',        set(ogTitle))
      .on('meta[name="twitter:title"]',       set(ogTitle))
      .on('meta[property="og:description"]',  set(ogDesc))
      .on('meta[name="twitter:description"]', set(ogDesc))
      .on('meta[property="og:url"]',          set(esc(url.href)))
      .on('title', { element: (e) => e.setInnerContent(`${title} — CrunchySFX`) })
      .transform(res);
  },
};
