// THE SEARCH-ENGINE PASS, kept from drifting.   node tests/seo.test.mjs
//
// The same file in every Crunchy app (CrunchyTile, CrunchySFX, CrunchyVFX, CrunchyBGM, CrunchyUI), so the pattern
// stays one pattern. It knows which app it is from index.html's canonical link and suite.js (crunchyCore's
// CRUNCHY_SUITE, the one place the suite keeps its links). A crawler reads the STATIC pages; this checks what it reads.
//
// TWO PAGES (AJ, 2026-10-16: the About section under the app made the app page scroll, "that scroll is pretty ugly"):
//   index.html  the app, its layout untouched: title, description, og:/twitter: cards, canonical, the SoftwareApplication
//               JSON-LD, and one plain <a href="about.html" data-web> (data-web: the desktop app hides it)
//   about.html  a static page of words: its own head (canonical https://<site>/about), a visible <h1>, the paragraphs,
//               an FAQ, the FAQPage JSON-LD (= the visible FAQ, word for word), the suite footer (= suite.js's links)
//               and a link back to the app. No scripts. Web only: never in the desktop bundle (src-tauri/build.rs).
// WHY /about AND NOT /about.html: Cloudflare's static assets (html_handling "auto-trailing-slash", the default) serve
// about.html at /about and redirect /about.html there, so /about is the URL a crawler ends on. The pages still LINK
// "about.html" and "index.html": those work on file:// (where /about would not) and are one redirect on the web.
//
// Plus robots.txt (allow all + Sitemap:), sitemap.xml (/ and /about), one IndexNow <32 hex>.txt key file,
// tools/indexnow.mjs, and none of them hidden from the web deploy by .assetsignore.
//
// Exits non-zero on any problem. Outside the runtime: it reads files, it never touches the network.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const has = (f) => existsSync(join(root, f));
const fail = [];
const ok = [];
const check = (cond, good, bad) => (cond ? ok : fail).push(cond ? good : bad);

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&rsquo;/g, "’").replace(/&amp;/g, "&");
const text = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const metaOf = (html) => (attr, name) => {
  const m = html.match(new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`));
  return m ? decode(m[1]) : null;
};
const titleOf = (html) => text((html.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1]);
const canonOf = (html) => (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
const ldOf = (html, where) => {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { out.push(JSON.parse(m[1])); } catch (e) { fail.push(`${where}: a JSON-LD block does not parse: ${e.message}`); }
    if (/data:image\/|base64,/.test(m[1])) fail.push(`${where}: a JSON-LD block embeds data`);
  }
  return out;
};
// the head every page needs: a named title, a real description saying free + CC0 + AI, cards that agree
function head(html, where, name, canonical) {
  const meta = metaOf(html);
  const title = titleOf(html), desc = meta("name", "description");
  check(title.includes(name) && title.length <= 70, `${where} title (${title.length} chars): ${title}`,
    `${where}: the title must name ${name} in at most 70 characters: "${title}" (${title.length})`);
  check(desc && desc.length >= 70 && desc.length <= 160, `${where} description is ${desc && desc.length} characters`,
    `${where}: the meta description must be 70-160 characters, is ${desc && desc.length}`);
  check(desc && /CC0/.test(desc) && /\bfree\b/i.test(desc) && /AI/.test(desc), `${where} description says free, CC0 and no AI`,
    `${where}: the meta description must say free, CC0 and no generative AI`);
  check(canonOf(html) === canonical, `${where} canonical is ${canonical}`, `${where}: canonical must be ${canonical}, is ${canonOf(html)}`);
  for (const [k, want] of [["og:title", title], ["twitter:title", title], ["og:description", desc], ["twitter:description", desc], ["og:url", canonical]]) {
    const got = meta(k.startsWith("og:") ? "property" : "name", k);
    if (where === "about.html" && got === null) continue;           // cards are optional on the About page; if present, they agree
    check(got === want, `${where} ${k} matches`, `${where}: ${k} drifted: "${got}" vs "${want}"`);
  }
  return { title, desc };
}

// ---- who am I: the suite entry whose web link is index.html's canonical URL ----
const html = read("index.html");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(read("suite.js").replace(/^\s*"use strict";/, ""), ctx, { filename: "suite.js" });
const SUITE = vm.runInContext("CRUNCHY_SUITE", ctx);
const canonical = canonOf(html);
const self = SUITE.find((t) => t.web && t.web === canonical);
if (!self) {
  console.log(`FAIL canonical ${canonical} is no tool's web link in suite.js`);
  process.exit(1);
}
const aboutUrl = canonical + "about";
ok.push(`this is ${self.name} (${canonical})`);

// ---- 1. index.html: the app page ----
const { desc } = head(html, "index.html", self.name, canonical);
const ld = ldOf(html, "index.html");
const app = ld.find((x) => x["@type"] === "SoftwareApplication");
if (!app) fail.push("index.html: no SoftwareApplication JSON-LD");
else {
  const bad = [];
  if (app["@context"] !== "https://schema.org") bad.push("@context");
  if (app.name !== self.name) bad.push("name");
  if (app.url !== canonical) bad.push("url");
  if (app.description !== desc) bad.push("description (must equal the meta description)");
  if (!app.applicationCategory) bad.push("applicationCategory");
  if (app.isAccessibleForFree !== true) bad.push("isAccessibleForFree");
  if (!app.author || app.author.name !== "superevil6") bad.push("author superevil6");
  const os = String(app.operatingSystem || "");
  if (!/\bWeb\b/.test(os)) bad.push("operatingSystem names the web");
  const offers = [].concat(app.offers || []);
  const web = offers.find((o) => o.url === canonical);
  if (!web || web.price !== "0" || !web.priceCurrency) bad.push("a price-0 offer for the web version at " + canonical);
  const desk = offers.find((o) => o.url !== canonical);
  if (self.desktop) {
    const p = String(self.price || "").replace(/^\$/, "");
    if (!desk || desk.url !== self.desktop || Number(desk.price) !== Number(p) || desk.priceCurrency !== "USD")
      bad.push(`the desktop offer (${self.desktop}, ${self.price})`);
    if (!/Windows/.test(os) || !/Linux/.test(os)) bad.push("operatingSystem names the desktop's Windows and Linux");
  } else if (desk || /Windows|Linux|mac/i.test(os)) bad.push("a desktop offer or OS, but suite.js has no store page");
  if (/"license"/.test(JSON.stringify(app))) bad.push("a `license` (that would be the CODE's licence, which is not CC0)");
  check(!bad.length, `index.html SoftwareApplication JSON-LD (${offers.length} offer${offers.length === 1 ? "" : "s"})`,
    "index.html SoftwareApplication JSON-LD: " + bad.join(", "));
}
check(!ld.some((x) => x["@type"] === "FAQPage"), "index.html carries no FAQPage (the FAQ is on about.html)",
  "index.html has an FAQPage, but its FAQ is on about.html: the questions must be visible on the page that declares them");
check(!/<section class="about"|<footer class="suitelinks"/.test(html), "index.html keeps its own layout (no About section, no suite footer)",
  "index.html still holds the About section or the suite footer: they live on about.html");
const aboutLinks = [...html.matchAll(/<a\s[^>]*href="about\.html"[^>]*>/g)].map((m) => m[0]);
check(aboutLinks.length >= 1 && aboutLinks.every((a) => /\sdata-web\b/.test(a)), `index.html links about.html (${aboutLinks.length}, data-web)`,
  'index.html needs a plain <a href="about.html" data-web> (data-web: the desktop app hides it)');

// ---- 2. about.html: the words ----
if (!has("about.html")) fail.push("there is no about.html");
else {
  const ab = read("about.html");
  check(/^<!doctype html>/i.test(ab) && /<html lang="[a-z]+/.test(ab) && /<meta charset="utf-8">/i.test(ab) && /name="viewport"/.test(ab),
    "about.html is a whole document (doctype, lang, charset, viewport)", "about.html needs <!doctype html>, <html lang>, a utf-8 charset and a viewport meta");
  head(ab, "about.html", self.name, aboutUrl);
  check(/<link rel="stylesheet" href="crunchy-base\.css">/.test(ab), "about.html uses the suite's crunchy-base.css", "about.html must link crunchy-base.css");
  const scripts = [...ab.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/type="application\/ld\+json"/.test(m[1]));
  check(!scripts.length, "about.html runs no script", "about.html must be static: only JSON-LD scripts");
  const body = (ab.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ab])[1].replace(/<script[\s\S]*?<\/script>/g, "");
  const h1s = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]));
  check(h1s.length === 1 && h1s[0].split(" ").length >= 3 && !/class="[^"]*(visually-hidden|sr-only)/.test(body),
    `about.html has one visible h1: "${h1s[0]}"`, "about.html needs exactly one visible <h1> of a few words");
  const words = text(body).split(" ").length;
  check(words >= 250, `about.html is ${words} words of real text`, `about.html is only ${words} words`);
  const faq = [...((body.match(/<div class="faq">([\s\S]*?)<\/div>/) || [, ""])[1]).matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((m) => ({ q: text(m[1]), a: text(m[2]) }));
  check(faq.length >= 3 && faq.length <= 6, `${faq.length} visible FAQ entries`, `the FAQ needs 3-6 entries (<div class="faq"> of <h3>/<p>), has ${faq.length}`);
  const fp = ldOf(ab, "about.html").find((x) => x["@type"] === "FAQPage");
  if (!fp) fail.push("about.html: no FAQPage JSON-LD");
  else {
    const got = (fp.mainEntity || []).map((e) => ({ q: e.name, a: e.acceptedAnswer && e.acceptedAnswer.text }));
    const same = got.length === faq.length && got.every((g, i) => g.q === faq[i].q && g.a === faq[i].a);
    check(same, "FAQPage JSON-LD is the visible FAQ, word for word",
      "FAQPage JSON-LD differs from the visible FAQ:\n" + faq.map((f, i) => `    visible: ${f.q} / ${f.a}\n    json-ld: ${got[i] && got[i].q} / ${got[i] && got[i].a}`).join("\n"));
  }
  const back = [...body.matchAll(/<a\s[^>]*href="(index\.html|\.\/|\/)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[2]));
  check(back.some((t) => t.includes(self.name)), `about.html links back to the app ("${back[0]}")`,
    `about.html needs a link back to the app (href "index.html", "./" or "/") naming ${self.name}`);
  const footM = body.match(/<footer class="suitelinks"[^>]*>([\s\S]*?)<\/footer>/);
  const hrefs = footM ? [...footM[1].matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]) : [];
  const want = [...SUITE.filter((t) => t.id !== self.id && t.web).map((t) => t.web), ...SUITE.filter((t) => t.desktop).map((t) => t.desktop)];
  const missing = want.filter((u) => !hrefs.includes(u));
  const extra = hrefs.filter((u) => !want.includes(u));
  check(footM && !missing.length && !extra.length && hrefs.length === want.length, `about.html's suite footer links exactly suite.js's ${want.length} links`,
    `about.html's <footer class="suitelinks"> drifted from suite.js: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`);
}

// ---- 3. robots.txt, sitemap.xml, IndexNow key ----
const robots = has("robots.txt") ? read("robots.txt") : "";
check(/^User-agent: \*$/m.test(robots) && /^Allow: \/$/m.test(robots) && !/^Disallow: *\S/m.test(robots)
  && robots.includes(`Sitemap: ${canonical}sitemap.xml`), "robots.txt allows all and names the sitemap",
  "robots.txt must allow all (User-agent: *, Allow: /) and say Sitemap: " + canonical + "sitemap.xml");
const sm = has("sitemap.xml") ? read("sitemap.xml") : "";
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const mods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
check(sm.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') && locs.length === 2 && locs[0] === canonical && locs[1] === aboutUrl
  && mods.length === 2 && mods.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d))), `sitemap.xml lists ${locs.join(" and ")} (lastmod ${mods.join(", ")})`,
  `sitemap.xml must list ${canonical} and ${aboutUrl}, each with a YYYY-MM-DD lastmod`);
const keys = readdirSync(root).filter((n) => /^[0-9a-f]{32}\.txt$/.test(n));
check(keys.length === 1 && read(keys[0]).trim() === keys[0].slice(0, 32), `IndexNow key file ${keys[0]}`,
  `there must be exactly one IndexNow key file <32 hex>.txt holding its own name (found ${keys.length})`);
check(has("tools/indexnow.mjs"), "tools/indexnow.mjs is there to ping after a deploy", "tools/indexnow.mjs is missing");

// ---- 4. the web deploy publishes them, at the URLs above; the desktop bundle leaves about.html out ----
if (has(".assetsignore")) {
  const pats = read(".assetsignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const rx = (p) => {
    const dir = p.endsWith("/");
    const body = p.replace(/\/$/, "").replace(/^\//, "");
    const re = body.split("**/").map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")).join("(?:.*/)?");
    return new RegExp((body.includes("/") ? "^" : "(^|/)") + re + (dir ? "/" : "(/|$)"));
  };
  const files = ["index.html", "about.html", "crunchy-base.css", "robots.txt", "sitemap.xml", ...keys];
  const hidden = files.filter((f) => pats.some((p) => rx(p).test(f)));
  check(!hidden.length, `.assetsignore publishes ${files.join(", ")}`, ".assetsignore hides from the web deploy: " + hidden.join(", "));
}
if (has("wrangler.jsonc")) {
  const hh = (read("wrangler.jsonc").match(/"html_handling"\s*:\s*"([^"]+)"/) || [, "auto-trailing-slash"])[1];
  check(hh === "auto-trailing-slash" || hh === "drop-trailing-slash", `wrangler html_handling "${hh}": about.html is served at /about`,
    `wrangler.jsonc html_handling "${hh}" does not serve about.html at /about (the canonical URL)`);
}
if (has("src-tauri/build.rs")) {
  check(!/"about\.html"/.test(read("src-tauri/build.rs")), "about.html is web only (not in src-tauri/build.rs)",
    "src-tauri/build.rs bundles about.html: it is a web page, the desktop app has no use for it");
}

for (const l of ok) console.log("ok   " + l);
for (const l of fail) console.log("FAIL " + l);
console.log(fail.length ? `\nFAIL · ${fail.length} problem(s)` : `\nPASS · ${ok.length} checks`);
process.exit(fail.length ? 1 : 0);
