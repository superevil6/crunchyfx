// TELL THE SEARCH ENGINES A DEPLOY HAPPENED (IndexNow: Bing, and DuckDuckGo through Bing's index; Yandex, Seznam,
// Naver). Run it by hand AFTER the deploy is live, never from the app: it is the one Crunchy file that touches the
// network, and it is outside the runtime (tools/ is never published, never bundled).
//
//   node tools/indexnow.mjs             check the key file is live, then ping api.indexnow.org with sitemap.xml's URLs
//                                       (the app at / and its About page at /about)
//   node tools/indexnow.mjs --dry-run   print what it would send, send nothing
//
// The same file in every Crunchy app. Everything comes from the repo: the site from index.html's canonical link, the
// URLs from sitemap.xml, the key from the root's one <32 hex>.txt (which the site must serve, so the engines can see
// the ping is the site's own). tests/seo.test.mjs checks all three exist and agree.
//
// The same ping as one line, if Node is not to hand (replace the host and key):
//   curl -s -H 'Content-Type: application/json; charset=utf-8' -d '{"host":"crunchytile.com","key":"<key>","keyLocation":"https://crunchytile.com/<key>.txt","urlList":["https://crunchytile.com/","https://crunchytile.com/about"]}' https://api.indexnow.org/indexnow -w '%{http_code}\n'
// 200 or 202 is success. 403: the key file is not live yet. 422: a URL is not on the host.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const dry = process.argv.includes("--dry-run");

const site = (read("index.html").match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
const keyFile = readdirSync(root).find((n) => /^[0-9a-f]{32}\.txt$/.test(n));
if (!site || !keyFile) { console.error("need index.html's canonical link and a <32 hex>.txt key file in the repo root"); process.exit(1); }
const key = keyFile.slice(0, 32);
const host = new URL(site).host;
const urlList = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const body = { host, key, keyLocation: site + keyFile, urlList };

console.log(JSON.stringify(body, null, 2));
if (dry) { console.log("--dry-run: nothing sent"); process.exit(0); }

const live = await fetch(body.keyLocation, { cache: "no-store" }).then((r) => r.ok ? r.text() : "", () => "");
if (live.trim() !== key) {
  console.error(`${body.keyLocation} does not serve the key yet: deploy first (and check .assetsignore), then run this again`);
  process.exit(1);
}
const r = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
});
console.log(`api.indexnow.org: HTTP ${r.status} ${r.status === 200 || r.status === 202 ? "(accepted)" : await r.text()}`);
process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
