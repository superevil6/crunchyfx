/* replace-presets.mjs — swap redesigned presets into presets.js IN PLACE, then prove the round trip. (2026-11-12)
 *
 *   node tools/replace-presets.mjs tools/new-presets/<round>.json [more.json …]
 *
 * The redo rounds (creature, fire, horror, robot, doors, sci-fi) each wrote their kept designs to
 * tools/new-presets/*.json; this writes them over the same-named entries in presets.js, keeping each entry's place,
 * section and order (PRESET_CATEGORIES is never touched). A layered preset is written multi-line with
 * `layers: JSON.stringify([...])`, one layer per line, like the hand-written layered presets.
 * Every name must exist exactly once, or it stops before writing. After writing it evaluates presets.js and checks each
 * replaced entry equals its JSON ORDER-INSENSITIVELY (presets.js puts `layers` after the other keys).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "presets.js");
const jsons = process.argv.slice(2);
if (!jsons.length) { console.error("usage: node tools/replace-presets.mjs <json> [<json>…]"); process.exit(1); }
const want = {};
for (const j of jsons) Object.assign(want, JSON.parse(readFileSync(j, "utf8")));

const ID = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const val = (v) => typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? "[" + v.map(val).join(", ") + "]"
  : (v && typeof v === "object") ? inner(v) : String(v);
function inner(o) {
  const parts = [];
  for (const [k, v] of Object.entries(o)) {
    if (k === "category") continue;
    const key = ID.test(k) ? k : JSON.stringify(k);
    if (k === "layers" && typeof v === "string") parts.push(key + ": JSON.stringify(" + val(JSON.parse(v)) + ")");
    else if (k === "_alts") parts.push(key + ": [" + v.map(inner).join(", ") + "]");
    else parts.push(key + ":" + val(v));
  }
  return "{ " + parts.join(", ") + " }";
}
function block(name, o) {
  if (typeof o.layers !== "string") return "  " + JSON.stringify(name) + ": " + inner(o);
  const head = {}, tail = {};
  for (const [k, v] of Object.entries(o)) { if (k === "category" || k === "layers") continue; (k === "_vary" || k === "_alts" ? tail : head)[k] = v; }
  const L = JSON.parse(o.layers).map((l) => "      " + val(l) + ",");
  const h = inner(head).slice(0, -2), t = Object.keys(tail).length ? ", " + inner(tail).slice(2, -2) : "";
  return "  " + JSON.stringify(name) + ": " + h + ",\n    layers: JSON.stringify([\n" + L.join("\n") + "\n    ])" + t + " }";
}

let src = readFileSync(file, "utf8");
for (const name of Object.keys(want)) {
  const key = "\n  " + JSON.stringify(name) + ": {", at = src.indexOf(key);
  if (at < 0 || src.indexOf(key, at + 1) >= 0) { console.error("not exactly one entry for " + name + "; nothing written"); process.exit(1); }
}
const done = [];
for (const [name, o] of Object.entries(want)) {
  const key = "\n  " + JSON.stringify(name) + ": {", at = src.indexOf(key);
  let i = at + key.length - 1, d = 0, q = null;   // string- and comment-aware brace match from the opening {
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i) - 1; continue; }
    if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; }
  }
  src = src.slice(0, at + 1) + block(name, o) + src.slice(i + 1);
  done.push(name);
}
writeFileSync(file, src);

const ctx = createContext({ window: {} }); ctx.window = ctx; runInContext(src, ctx);
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object"
  ? "{" + Object.keys(v).filter((k) => k !== "category").sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v);
let bad = 0;
for (const n of done) if (canon(ctx.PRESETS[n]) !== canon(want[n])) { bad++; console.log("MISMATCH", n); }
console.log("replaced", done.length, "· content mismatches (order-insensitive)", bad, "· presets", Object.keys(ctx.PRESETS).length);
process.exit(bad ? 1 : 0);
