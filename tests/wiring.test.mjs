// CrunchySFX — the registrations a new frontend file needs, checked (crunchyTile's tests/wiring.test.mjs is the model).
// Run by the suite's pre-commit hook (`pull-core --precommit` runs this file when it exists).   node tests/wiring.test.mjs
//
// A file the page loads must be: a <script src>/<link href> in index.html, in src-tauri/build.rs's list, in the CI
// workflow's "Prepare frontend" cp, and NOT matched by .assetsignore (the web deploy). Forgetting one ships a desktop
// app that 404s a script (WINDOWS-RELEASE-PLAYBOOK.md: synth.js once did) or a site without it.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const ok = [], fail = [];
const t = (name, pass, why) => (pass ? ok : fail).push(name + (pass || !why ? "" : " — " + why));

const html = read("index.html");
const loaded = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)].map((m) => m[1]);
const page = ["index.html", ...loaded];
const rs = read("src-tauri/build.rs"), rsList = JSON.parse("[" + /for f in \[([^\]]+)\]/.exec(rs)[1] + "]");
const ci = /cp ((?:[\w.-]+ )+)dist\//.exec(read(".github/workflows/desktop-build.yml"))[1].trim().split(/\s+/);
const sorted = (a) => a.slice().sort().join(" ");
t("every file index.html loads exists", loaded.every((f) => existsSync(join(root, f))), loaded.filter((f) => !existsSync(join(root, f))).join(","));
t("src-tauri/build.rs copies exactly the page's files", sorted(rsList) === sorted(page), sorted(rsList) + " vs " + sorted(page));
t("the CI workflow's Prepare frontend copies exactly the page's files", sorted(ci) === sorted(page), sorted(ci) + " vs " + sorted(page));
const ignore = read(".assetsignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const matches = (f, pat) => pat.endsWith("/") ? f.startsWith(pat) : new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$").test(f);
const hidden = page.filter((f) => ignore.some((p) => matches(f, p)));
t("no page file is kept off the web deploy by .assetsignore", !hidden.length, hidden.join(","));
t("project-app.js loads before plant.js, suite.js before desktop.js", loaded.indexOf("project-app.js") >= 0 && loaded.indexOf("project-app.js") < loaded.indexOf("plant.js") &&
  loaded.indexOf("suite.js") < loaded.indexOf("desktop.js") && loaded.indexOf("crunchy-base.css") < loaded.indexOf("styles.css"));
const pa = read("project-app.js").replace(/\/\/.*$/gm, "");
t("project-app.js is pure (no document, window, localStorage, state)", !/\b(document|window|localStorage|state)\b/.test(pa));
t("the audio baseline is kept", existsSync(join(root, "tests/audio-hash.expected.txt")) && /AUDIOHASH [0-9a-f]{16} over \d+/.test(read("tests/audio-hash.expected.txt")));
t("the legacy browser keys are still the ones v1.1 used", ["crunchyfx.userpresets.v1", "crunchyfx.usercats.v1", "crunchyfx.mywaves.v1", "crunchyfx.history.v1", "crunchyfx.prefs.v1"]
  .every((k) => html.indexOf('"' + k + '"') >= 0));

for (const l of ok) console.log("ok   " + l);
for (const l of fail) console.log("FAIL " + l);
console.log(fail.length ? `\nFAIL · wiring · ${fail.length} of ${ok.length + fail.length}` : `\nPASS · wiring · ${ok.length}`);
process.exit(fail.length ? 1 : 0);
