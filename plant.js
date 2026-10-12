// GENERATED from crunchyCore/plant.js @ b41dd27 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 1553994825b16465f91d74473e323b875a8ebf489f7c32aab912c593ad582abf
"use strict";
// Crunchy suite — PLANTING (DESKTOP-ROADMAP.md): an app's Library lives INSIDE the game's own folder.
//
//   MyGame/                         the folder the person picks: a Godot project, a Unity project, or any folder
//     crunchy/                      ONE folder for the whole suite (Unity: Assets/Crunchy/)
//       tile/                       this app's child (PROJECT_APP.suite; Unity: Tile/)
//         grass-meadow/             one folder per asset, named for it (its slug)
//           grass-meadow.png        the exports: exactly what the app's zip holds
//           grass-meadow.tres
//           grass-meadow.crunchy    THE SIDECAR: how it was made, what it wrote, and a fingerprint of the bytes
//
// Files are the truth: there is no manifest. Opening reads the folders, so an asset copied in appears and one deleted
// in a file manager goes. A damaged sidecar is SKIPPED and named, never allowed to stop the Library opening.
//
// THE SIDECAR (`<slug>.crunchy`, JSON; the extension keeps Godot from importing it as a resource):
//   { format: "crunchy-asset", version: 1, app: "<PROJECT_APP.id>", suite: "<PROJECT_APP.suite>", appVersion,
//     kind, name, s, …the kind's own fields…, files: [paths inside the asset folder], hash, created, modified }
//   `s` is the share string, the same one a web link carries: it reopens the design exactly. `files` is what this asset
//   wrote: re-export removes what it no longer makes and NEVER touches anything else. `hash` fingerprints the exported
//   bytes, so an app update that would change them can be shown as "update available" (plantNeedsUpdate).
//
// SAFETY, the same promises as project.js: nothing is written outside this app's child folder; nothing is removed that
// a sidecar does not list (and a listed path that would escape the asset's folder is ignored), with ONE companion: in a
// Godot project a removed file's own `<file>.import` goes with it, because Godot keeps serving a deleted texture from
// its import cache while that file remains (found by tests/godot-plant.mjs: the game still loaded a deleted asset); a sidecar is written
// LAST, so an export interrupted half-way never claims files it did not finish. RENAME CHANGES ONLY THE NAME, never
// the path: a game's scenes refer to files by path, and moving them would break the game.
//
// PURE, like project.js: no DOM, no app state. The file system is PASSED IN as `fs`, an object of async functions
// (the Tauri fs plugin fits as is, see plantTauriFs; tests pass an in-memory one):
//   exists(path) → bool   readTextFile(path) → string   readDir(path) → [{ name, isDirectory }]
//   mkdir(path, { recursive })   writeTextFile(path, text)   writeFile(path, Uint8Array)   remove(path)
// The app supplies PROJECT_APP (its project-app.js): id, name, suite (its key below), kinds, valid(kind, d).
//
// Replaces project.js's separate project folder (AJ, 2026-10-11: "let's try replace"); both exist until every app
// has moved. Prefixed plant*/PLANT_* so the two can load together while an app migrates.

const PLANT_BUILD = 3;
const PLANT_FORMAT = "crunchy-asset", PLANT_VERSION = 1, PLANT_EXT = ".crunchy";

// Each Crunchy tool's child of crunchy/: [Godot and plain folders, Unity]. The suite view reads the others.
const PLANT_SUITE = {
  tile: ["tile", "Tile"], ui: ["ui", "UI"], sfx: ["sfx", "SFX"],
  vfx: ["vfx", "VFX"], bgm: ["bgm", "BGM"], character: ["character", "Character"],
};

// ---- paths ------------------------------------------------------------------------------------------------------
function plantJoin() {
  const parts = Array.prototype.filter.call(arguments, function (p) { return p != null && p !== ""; });
  return parts.map(function (p, i) {
    p = String(p);
    if (i > 0) p = p.replace(/^[\/\\]+/, "");
    if (i < parts.length - 1) p = p.replace(/[\/\\]+$/, "");
    return p;
  }).join("/");
}
// A relative path inside an asset's folder: no absolute paths, no "..", no empty segments. The ONE gate between
// generated or read-back file names and the person's disk.
function plantSafeRel(rel) {
  if (typeof rel !== "string" || !rel || /^[\/\\]|^[a-zA-Z]:/.test(rel)) return false;
  return rel.split(/[\/\\]/).every(function (seg) { return seg && seg !== "." && seg !== ".."; });
}
function plantSlug(name) {
  const s = String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return s || "untitled";
}

// ---- where -------------------------------------------------------------------------------------------------------
// The engine of a chosen folder: Godot (project.godot), Unity (Assets/ and ProjectSettings/), or a plain folder.
async function plantEngineOf(fs, dir) {
  if (await fs.exists(plantJoin(dir, "project.godot"))) return "godot";
  if (await fs.exists(plantJoin(dir, "Assets")) && await fs.exists(plantJoin(dir, "ProjectSettings"))) return "unity";
  return "plain";
}
function plantRootRel(engine) { return engine === "unity" ? "Assets/Crunchy" : "crunchy"; }
function plantChildRel(engine, key) {
  const c = PLANT_SUITE[key];
  if (!c) throw new Error("plant: unknown suite key " + key);
  return plantJoin(plantRootRel(engine), engine === "unity" ? c[1] : c[0]);
}

// ---- the fingerprint ---------------------------------------------------------------------------------------------
// Every file's path and bytes, in path order, in two independent 32-bit lanes (64 bits): enough to tell "these bytes
// changed" (a change detector, not a security hash), synchronous, and the same in every runtime.
// VERSION 2 (written "2:<hex>", build 3): lane A is FNV-1a, lane B a multiply-xorshift with an ODD multiplier.
// VERSION 1 (bare hex, builds 1-2): lane B multiplied by an EVEN number (0x010001bc), so its low bits drained to zero
// over a long file (CrunchySFX's review found it); still a working change detector, kept so a sidecar written with it
// is compared the way it was written and never shows a false "update available".
function plantHash(files, version) {
  const v1 = version === 1;
  let a = 0x811c9dc5, b = v1 ? 0x01000193 ^ 0x5bd1e995 : 0x9747b28c;
  const enc = new TextEncoder();
  const step = v1 ? function (byte) {
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b ^ byte, 0x01000193 ^ 0x2f) >>> 0;
  } : function (byte) {
    a = Math.imul(a ^ byte, 0x01000193) >>> 0;
    b = Math.imul(b ^ byte, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  };
  files.slice().sort(function (x, y) { return x.path < y.path ? -1 : x.path > y.path ? 1 : 0; }).forEach(function (f) {
    enc.encode(f.path + "\0").forEach(step);
    const bytes = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    for (let i = 0; i < bytes.length; i++) step(bytes[i]);
    step(0xff);
  });
  const hex = ("00000000" + a.toString(16)).slice(-8) + ("00000000" + b.toString(16)).slice(-8);
  return v1 ? hex : "2:" + hex;
}

// ---- the sidecar -------------------------------------------------------------------------------------------------
// Pure: also what a WEB zip carries beside its exports (DESKTOP-ROADMAP.md §6.4), so a web export can be adopted later.
//   kind, name   the asset;   fields   the kind's own data, `s` above all;   files   [{ path, data }] as written
function plantSidecar(kind, name, fields, files, appVersion, created) {
  const now = new Date().toISOString();
  return Object.assign({ format: PLANT_FORMAT, version: PLANT_VERSION, app: PROJECT_APP.id, suite: PROJECT_APP.suite,
    appVersion: appVersion || "" }, fields, {
    kind: kind, name: String(name).trim(), files: files.map(function (f) { return f.path; }),
    hash: plantHash(files), created: created || now, modified: now });
}
function plantSidecarFile(slug, sidecar) { return { path: slug + PLANT_EXT, data: JSON.stringify(sidecar, null, 2) + "\n" }; }
function plantSidecarValid(d) {
  if (!d || typeof d !== "object" || d.format !== PLANT_FORMAT || typeof d.name !== "string" || !d.name.trim()) return false;
  if (!Array.isArray(d.files) || !d.files.every(plantSafeRel)) return false;
  return !!(PROJECT_APP.kinds[d.kind] && PROJECT_APP.valid(d.kind, d));
}

// ---- open --------------------------------------------------------------------------------------------------------
// P = { fs, dir, engine, rel (this app's child, relative to dir), assets: [{ slug, kind, name, data }], skipped }
async function plantOpen(fs, dir) {
  const engine = await plantEngineOf(fs, dir);
  const P = { fs: fs, dir: dir, engine: engine, rel: plantChildRel(engine, PROJECT_APP.suite), assets: [], skipped: [] };
  await plantScan(P);
  return P;
}
async function plantScan(P) {
  P.assets = []; P.skipped = [];
  const appDir = plantJoin(P.dir, P.rel);
  if (!(await P.fs.exists(appDir))) return P;
  for (const e of await P.fs.readDir(appDir)) {
    if (!e.isDirectory || !plantSafeRel(e.name)) continue;
    const side = plantJoin(appDir, e.name, e.name + PLANT_EXT);
    if (!(await P.fs.exists(side))) continue;                    // a folder of the app's that is not an asset
    let d = null;
    try { d = JSON.parse(await P.fs.readTextFile(side)); } catch (err) { d = null; }
    if (!plantSidecarValid(d)) { P.skipped.push(plantJoin(P.rel, e.name, e.name + PLANT_EXT)); continue; }
    P.assets.push({ slug: e.name, kind: d.kind, name: d.name, data: d });
  }
  P.assets.sort(function (x, y) { return x.name.localeCompare(y.name); });
  return P;
}
function plantFind(P, kind, name) {
  const low = String(name).trim().toLowerCase();
  return P.assets.find(function (a) { return a.kind === kind && a.name.toLowerCase() === low; }) || null;
}
function plantSearch(P, q, kind) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  return P.assets.filter(function (a) {
    if (kind && a.kind !== kind) return false;
    const hay = (a.name + " " + (a.data.view || "") + " " + a.kind).toLowerCase();
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  });
}
function plantAssetDir(P, a) { return plantJoin(P.dir, P.rel, a.slug); }
// Remove the EMPTY folders under `dir` (an export's subfolders, emptied by a removal), deepest first; a folder with
// anything in it stays. `dir` itself is left to the caller.
async function plantPrune(P, dir) {
  if (!(await P.fs.exists(dir))) return;
  for (const e of await P.fs.readDir(dir)) {
    if (!e.isDirectory) continue;
    const sub = plantJoin(dir, e.name);
    await plantPrune(P, sub);
    if ((await P.fs.readDir(sub)).length === 0) await P.fs.remove(sub);
  }
}
// Remove one file this app wrote, and in Godot its `.import` companion (see SAFETY above).
async function plantRemoveWritten(P, path) {
  if (await P.fs.exists(path)) await P.fs.remove(path);
  if (P.engine === "godot" && await P.fs.exists(path + ".import")) await P.fs.remove(path + ".import");
}

// ---- write -------------------------------------------------------------------------------------------------------
// Save an asset: its exports and its sidecar. The same name and kind UPDATES in place (same folder, same paths, so the
// game's references hold); a new name makes a new folder. Files the previous export wrote and this one does not are
// removed; nothing else is. Returns the asset.
//   { kind, name, fields: { s, … }, files: [{ path, data: string | Uint8Array }], appVersion }
// THE FOLDER a save of (kind, name) will use, before the files are made: an app whose exports name their own path
// (CrunchyUI's README and loaders say res://crunchy/ui/<slug>/) asks here rather than copying the rule. The same name
// and kind keeps its folder; a new one gets its slug, numbered past any folder already there.
async function plantSlugFor(P, kind, name) {
  const prev = plantFind(P, kind, name);
  if (prev) return prev.slug;
  const base = plantSlug(name);
  let slug = base, n = 2;
  while (P.assets.some(function (a) { return a.slug === slug; }) || await P.fs.exists(plantJoin(P.dir, P.rel, slug))) slug = base + "-" + n++;
  return slug;
}
async function plantPut(P, req) {
  const fields = Object.assign({}, req.fields);
  const probe = Object.assign({ format: PLANT_FORMAT, files: [] }, fields, { kind: req.kind, name: String(req.name || "") });
  if (!plantSidecarValid(probe)) throw new Error("plantPut: not a valid " + req.kind);
  (req.files || []).forEach(function (f) {
    if (!plantSafeRel(f.path) || f.path.slice(-PLANT_EXT.length) === PLANT_EXT) throw new Error("plantPut: refused path " + f.path);
  });
  const fs = P.fs, prev = plantFind(P, req.kind, req.name);
  const slug = await plantSlugFor(P, req.kind, req.name);
  const dir = plantJoin(P.dir, P.rel, slug);
  await fs.mkdir(dir, { recursive: true });
  for (const f of req.files) {
    const at = plantJoin(dir, f.path);
    const parent = at.slice(0, at.lastIndexOf("/"));
    if (parent !== dir) await fs.mkdir(parent, { recursive: true });
    if (typeof f.data === "string") await fs.writeTextFile(at, f.data); else await fs.writeFile(at, f.data);
  }
  const keep = {};
  req.files.forEach(function (f) { keep[f.path] = true; });
  if (prev) {
    for (const old of prev.data.files) if (!keep[old] && plantSafeRel(old)) await plantRemoveWritten(P, plantJoin(dir, old));
    await plantPrune(P, dir);                                         // subfolders the old export had and this one does not
  }
  const side = plantSidecar(req.kind, req.name, fields, req.files, req.appVersion, prev ? prev.data.created : null);
  const sf = plantSidecarFile(slug, side);
  await fs.writeTextFile(plantJoin(dir, sf.path), sf.data);           // LAST: the asset is complete only now
  const asset = { slug: slug, kind: req.kind, name: side.name, data: side };
  P.assets = P.assets.filter(function (a) { return a.slug !== slug; }).concat([asset])
    .sort(function (x, y) { return x.name.localeCompare(y.name); });
  return asset;
}
// The NAME only: the folder and every path stay, so nothing in the game breaks. A name another asset of the kind
// already has is refused.
async function plantRename(P, a, name) {
  name = String(name || "").trim();
  if (!name) throw new Error("A name is needed.");
  const clash = plantFind(P, a.kind, name);
  if (clash && clash.slug !== a.slug) throw new Error("Another " + a.kind + " is already called " + name + ".");
  a.data = Object.assign({}, a.data, { name: name, modified: new Date().toISOString() });
  a.name = name;
  const sf = plantSidecarFile(a.slug, a.data);
  await P.fs.writeTextFile(plantJoin(plantAssetDir(P, a), sf.path), sf.data);
  return a;
}
// Remove what the sidecar lists (with Godot's .import companions), then the sidecar, then the folder if nothing else
// is in it. Anything else in it (the person's own file, Unity's .meta, which Unity clears itself) keeps the folder.
async function plantDelete(P, a) {
  const fs = P.fs, dir = plantAssetDir(P, a);
  for (const f of a.data.files) if (plantSafeRel(f)) await plantRemoveWritten(P, plantJoin(dir, f));
  const side = plantJoin(dir, a.slug + PLANT_EXT);
  if (await fs.exists(side)) await fs.remove(side);
  await plantPrune(P, dir);                                           // the export's own subfolders, now empty
  if (await fs.exists(dir) && (await fs.readDir(dir)).length === 0) await fs.remove(dir);
  P.assets = P.assets.filter(function (x) { return x.slug !== a.slug; });
}

// ---- keeping it current ------------------------------------------------------------------------------------------
// The app re-renders an asset from its sidecar (`s`) and hands the files here: true when they differ from what was
// exported, i.e. this version of the app would now make something different ("update available").
function plantNeedsUpdate(a, files) {
  const h = String(a.data.hash || "");
  return (h.indexOf("2:") === 0 ? plantHash(files) : plantHash(files, 1)) !== h;     // compared the way it was written
}

// ---- the suite view ----------------------------------------------------------------------------------------------
// Read-only: what the OTHER Crunchy tools have planted in the same folder. [{ key, rel, count, kinds: { kind: n } }],
// only the tools that have something. Their sidecars are counted, never parsed for more than kind, never written.
async function plantSuiteView(P) {
  const out = [], fs = P.fs;
  for (const key of Object.keys(PLANT_SUITE)) {
    if (key === PROJECT_APP.suite) continue;
    const rel = plantChildRel(P.engine, key), dir = plantJoin(P.dir, rel);
    if (!(await fs.exists(dir))) continue;
    const row = { key: key, rel: rel, count: 0, kinds: {} };
    for (const e of await fs.readDir(dir)) {
      if (!e.isDirectory || !plantSafeRel(e.name)) continue;
      const side = plantJoin(dir, e.name, e.name + PLANT_EXT);
      if (!(await fs.exists(side))) continue;
      let kind = "asset";
      try { const d = JSON.parse(await fs.readTextFile(side)); if (d && d.format === PLANT_FORMAT && typeof d.kind === "string") kind = d.kind; else continue; }
      catch (err) { continue; }
      row.count++;
      row.kinds[kind] = (row.kinds[kind] || 0) + 1;
    }
    if (row.count) out.push(row);
  }
  return out;
}

// ---- the desktop's file system -------------------------------------------------------------------------------------
// The Tauri fs plugin as the `fs` above (window.__TAURI__.fs, passed in so this file stays pure).
function plantTauriFs(T) {
  return {
    exists: function (p) { return T.exists(p); },
    readTextFile: function (p) { return T.readTextFile(p); },
    readDir: function (p) { return T.readDir(p).then(function (es) { return es.map(function (e) { return { name: e.name, isDirectory: !!e.isDirectory }; }); }); },
    mkdir: function (p, o) { return T.mkdir(p, o); },
    writeTextFile: function (p, t) { return T.writeTextFile(p, t); },
    writeFile: function (p, b) { return T.writeFile(p, b); },
    remove: function (p) { return T.remove(p); },
  };
}
