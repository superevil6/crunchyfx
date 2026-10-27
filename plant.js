// GENERATED from crunchyCore/plant.js @ 20d6cb4 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 40c091ad68a2d75061ded1f192e225a2478a9863ef5c80cc0985c56c5009b90c
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
//   (build 15) `pending: true` and an empty `hash` mark a JOURNAL: a save that has not finished (or was cut short). Its
//   `files` are everything that save may have written; plantNeedsUpdate is true for it, so the app offers to finish it.
//   `s` is the share string, the same one a web link carries: it reopens the design exactly. `files` is what this asset
//   wrote: re-export removes what it no longer makes and NEVER touches anything else. `hash` fingerprints the exported
//   bytes, so an app update that would change them can be shown as "update available" (plantNeedsUpdate).
//
// SAFETY, the same promises as project.js: nothing is written outside this app's child folder (but GAME FILES, below:
// only where an app names an engine's own asset folders; and GAME-LEVEL SUPPORT, build 15: one named folder under Godot's
// addons/, never one the app did not write, plus its own entry in project.godot's enabled plugins); nothing is removed that
// a sidecar does not list (and a listed path that would escape the asset's folder is ignored), with TWO companions: in a
// Godot project a removed file's own `<file>.import` goes with it, because Godot keeps serving a deleted texture from
// its import cache while that file remains (found by tests/godot-plant.mjs: the game still loaded a deleted asset), and
// `<file>.uid`, which Godot 4.4+ writes beside a script. A SAVE CUT SHORT NEVER ORPHANS A FILE (build 15): the sidecar
// is written FIRST as a journal listing every file the asset owned plus every new one it is about to write (`pending`,
// no fingerprint), then the files, then the sidecar again with the final list; so whatever landed is listed, and Delete
// takes it. A NEW asset whose save fails is rolled back (its files, then its sidecar); an update that fails keeps the
// journal, and the Library shows it as needing an update (Re-export finishes it). RENAME CHANGES ONLY THE NAME, never
// the path: a game's scenes refer to files by path, and moving them would break the game.
//
// PURE, like project.js: no DOM, no app state. The file system is PASSED IN as `fs`, an object of async functions
// (the Tauri fs plugin fits as is, see plantTauriFs; tests pass an in-memory one):
//   exists(path) → bool   readTextFile(path) → string   readFile(path) → bytes (build 16, optional)   readDir(path) → [{ name, isDirectory }]
//   mkdir(path, { recursive })   writeTextFile(path, text)   writeFile(path, Uint8Array)   remove(path)
// The app supplies PROJECT_APP (its project-app.js): id, name, suite (its key below), kinds, valid(kind, d), and
// optionally gameDirs (below) and generated: { <engine>: ["<folder>"] }, an asset's subfolder that the app's own
// engine-side tool builds (CrunchyCharacter's Unity importer: "Unity"), removed whole with the asset (build 8).
//
// GAME FILES (build 6, CrunchyCharacter's RPG Maker planting; AJ, 2026-10-12: "the manual export sucked"). An engine
// that only loads assets from ITS OWN folders (RPG Maker MV/MZ: img/characters/, img/faces/ …) cannot use files kept in
// crunchy/. There, and only for the folders the app names in PROJECT_APP.gameDirs[engine], a file path may be
// "@game/<folder>/<file>": written into the game's folder, listed in the sidecar like any other, removed on a re-export
// that no longer makes it and on delete. The promises that keep this safe: only a named folder, only a file directly in
// it (no subfolders, no ".."), NEVER a file that is already there unless this asset wrote it (another asset's, or the
// person's own, stops the save with its name), and a game folder itself is never removed or pruned.
//
// Replaces project.js's separate project folder (AJ, 2026-10-11: "let's try replace"); both exist until every app
// has moved. Prefixed plant*/PLANT_* so the two can load together while an app migrates.

const PLANT_BUILD = 17;
const PLANT_FORMAT = "crunchy-asset", PLANT_VERSION = 1, PLANT_EXT = ".crunchy";

// Each Crunchy tool's child of crunchy/: [Godot and plain folders, Unity]. The suite view reads the others.
const PLANT_SUITE = {
  tile: ["tile", "Tile"], ui: ["ui", "UI"], sfx: ["sfx", "SFX"],
  vfx: ["vfx", "VFX"], bgm: ["bgm", "BGM"], character: ["character", "Character"],
  items: ["item", "Item"],                                           // build 11: CrunchyItems; build 13: renamed CrunchyItem (crunchy/item/)
  shader: ["shader", "Shader"],                                      // build 12: CrunchyShader
  moments: ["moments", "Moments"],                                   // build 16: GAME MOMENTS (moments.js), the suite's own
  palettes: ["palettes", "Palettes"],                                // build 17: SHARED PALETTES (palette.js), the suite's own
};
const PLANT_SUITE_NAMES = { tile: "CrunchyTile", ui: "CrunchyUI", sfx: "CrunchySFX", vfx: "CrunchyVFX", bgm: "CrunchyBGM", character: "CrunchyCharacter",
                            items: "CrunchyItem", shader: "CrunchyShader", moments: "Game moments", palettes: "Palettes" };
// AN ASSET'S APP (build 16): a handle may carry its own `app` (moments.js's MOMENT_APP: game moments belong to no one
// tool, they are the suite's, in crunchy/moments/), else it is the opening app's PROJECT_APP, as every build before.
function plantApp(P) { return (P && P.app) || PROJECT_APP; }

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
// The engine of a chosen folder: Godot (project.godot), Unity (Assets/ and ProjectSettings/), RPG Maker MZ / MV
// (game.rmmzproject / Game.rpgproject; build 6), or a plain folder. RPG Maker keeps its sidecars in crunchy/ as a plain
// folder does; only an app with gameDirs.rpgmaker writes into its img/ folders.
async function plantEngineOf(fs, dir) {
  if (await fs.exists(plantJoin(dir, "project.godot"))) return "godot";
  if (await fs.exists(plantJoin(dir, "Assets")) && await fs.exists(plantJoin(dir, "ProjectSettings"))) return "unity";
  if (await fs.exists(plantJoin(dir, "game.rmmzproject")) || await fs.exists(plantJoin(dir, "Game.rpgproject"))) return "rpgmaker";
  return "plain";
}
// ---- game files (build 6) ----------------------------------------------------------------------------------------
const PLANT_GAME = "@game/";
// The path inside the GAME folder of a "@game/…" file, or null for a file in the asset's own folder.
function plantGameRel(path) { return typeof path === "string" && path.indexOf(PLANT_GAME) === 0 ? path.slice(PLANT_GAME.length) : null; }
// A game file this app may write here: a file directly in one of the folders it names for this engine.
function plantGameOk(P, rel) {
  const A = plantApp(P), dirs = A.gameDirs && A.gameDirs[P.engine];
  if (!Array.isArray(dirs) || !plantSafeRel(rel)) return false;
  return dirs.some(function (d) { return rel.indexOf(d) === 0 && rel.length > d.length && rel.slice(d.length).indexOf("/") < 0; });
}
// A listed path this app may remove: any file in the asset's folder; a game file only where it may write one (a
// sidecar copied into another engine's game never removes from that game's folders).
function plantWritable(P, path) { const g = plantGameRel(path); return g === null || plantGameOk(P, g); }
// Where a listed file lives on disk: in the asset's folder, or (a game file) in the game's.
function plantFileAt(P, dir, path) { const g = plantGameRel(path); return g === null ? plantJoin(dir, path) : plantJoin(P.dir, g); }
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
function plantSidecar(kind, name, fields, files, appVersion, created, app) {
  const now = new Date().toISOString(), A = app || PROJECT_APP;
  return Object.assign({ format: PLANT_FORMAT, version: PLANT_VERSION, app: A.id, suite: A.suite,
    appVersion: appVersion || "" }, fields, {
    kind: kind, name: String(name).trim(), files: files.map(function (f) { return f.path; }),
    hash: plantHash(files), created: created || now, modified: now });
}
function plantSidecarFile(slug, sidecar) { return { path: slug + PLANT_EXT, data: JSON.stringify(sidecar, null, 2) + "\n" }; }
function plantSidecarValid(d, app) {
  if (!d || typeof d !== "object" || d.format !== PLANT_FORMAT || typeof d.name !== "string" || !d.name.trim()) return false;
  if (!Array.isArray(d.files) || !d.files.every(plantSafeRel)) return false;
  const A = app || PROJECT_APP;
  return !!(A.kinds[d.kind] && A.valid(d.kind, d));
}

// ---- open --------------------------------------------------------------------------------------------------------
// P = { fs, dir, engine, rel (this app's child, relative to dir), assets: [{ slug, kind, name, data }], skipped }
async function plantOpen(fs, dir) {
  const engine = await plantEngineOf(fs, dir);
  const P = { fs: fs, dir: dir, engine: engine, rel: plantChildRel(engine, PROJECT_APP.suite), assets: [], skipped: [] };
  await plantScan(P);
  return P;
}
// A SIBLING HANDLE (build 16) on another app's child of the same game, as that app: (P, MOMENT_APP) opens
// crunchy/moments/ so plantPut / plantDelete / plantScan work there with that app's kinds and checks.
async function plantOpenAs(P, app) {
  const Q = { fs: P.fs, dir: P.dir, engine: P.engine, rel: plantChildRel(P.engine, app.suite), assets: [], skipped: [], app: app };
  await plantScan(Q);
  return Q;
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
    if (!plantSidecarValid(d, plantApp(P))) { P.skipped.push(plantJoin(P.rel, e.name, e.name + PLANT_EXT)); continue; }
    P.assets.push({ slug: e.name, kind: d.kind, name: d.name, data: d });
  }
  P.assets.sort(function (x, y) { return x.name.localeCompare(y.name); });
  return P;
}
function plantFind(P, kind, name) {
  const low = String(name).trim().toLowerCase();
  return P.assets.find(function (a) { return a.kind === kind && a.name.toLowerCase() === low; }) || null;
}
// A NAME NO ASSET OF THIS KIND HAS YET: the name itself, or the next of its numbered series ("Hero" taken → "Hero 2";
// "Hero 2" taken → "Hero 3", never "Hero 2 2"). SAVE NEVER OVERWRITES (AJ, 2026-10-12, in CrunchyCharacter: opening a
// planted character, picking another and saving replaced the first): an app's Save plants under this name, and only a
// card's Replace (or Re-export) writes over an asset that is already there.
function plantFreeName(P, kind, name) {
  if (!plantFind(P, kind, name)) return name;
  const base = String(name).replace(/\s+\d+$/, "") || String(name);
  let n = 2;
  while (plantFind(P, kind, base + " " + n)) n++;
  return base + " " + n;
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
    await plantRemoveEmptyDir(P, sub);
  }
}
// A folder that is now EMPTY, and in Unity its own `<folder>.meta` beside it (build 8): Unity keeps a folder's identity
// in that file, and a left-over one brought the empty folder back on its next refresh.
async function plantRemoveEmptyDir(P, dir) {
  if (await P.fs.exists(dir)) {
    if ((await P.fs.readDir(dir)).length) return false;
    await P.fs.remove(dir);
  }
  // a folder already gone (or never made) leaves no orphan .meta behind either
  if (P.engine === "unity" && await P.fs.exists(dir + ".meta")) await P.fs.remove(dir + ".meta");
  return true;
}
// EVERYTHING under a folder an app's own ENGINE-SIDE tool generates for an asset (PROJECT_APP.generated[engine], e.g.
// CrunchyCharacter's importer builds `<asset>/Unity/` in a Unity project), then the folder: removed with its asset,
// because the tool that made it may be going at the same moment (the app's last asset takes its support files with it,
// and the importer with them, so it could never clean up after itself; found by Character's live Unity check).
async function plantRemoveTree(P, dir) {
  if (!(await P.fs.exists(dir))) return;
  for (const e of await P.fs.readDir(dir)) {
    const sub = plantJoin(dir, e.name);
    if (e.isDirectory) await plantRemoveTree(P, sub); else await P.fs.remove(sub);
  }
  await plantRemoveEmptyDir(P, dir);
}
// Remove one file this app wrote, and in Godot its companions: `.import` (see SAFETY above), and `.uid`, which Godot
// 4.4+ writes beside every script and shader (found by CrunchyVFX's Godot check, 2026-10-12: the combined scene's
// `.gd` left `<base>.gd.uid` behind, so a deleted effect's folder could not go).
// In Unity (build 8) its `.meta` goes with it: Unity would clear an orphan one itself on its next refresh, but only then,
// and the folder it sits in could not be removed before.
async function plantRemoveWritten(P, path) {
  if (await P.fs.exists(path)) await P.fs.remove(path);
  const companions = P.engine === "godot" ? [".import", ".uid"] : P.engine === "unity" ? [".meta"] : [];
  for (const c of companions) if (await P.fs.exists(path + c)) await P.fs.remove(path + c);
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
  // a slug never takes a SUPPORT folder's name (build 8: "editor" for Unity's Editor/, on a case-blind disk too)
  while (P.assets.some(function (a) { return a.slug === slug; }) || PLANT_SUPPORT_RESERVED.indexOf(slug) >= 0 ||
         await plantTaken(P, plantJoin(P.dir, P.rel, slug))) slug = base + "-" + n++;
  return slug;
}
// A folder with something in it. An EMPTY one (build 15: a save cut short by a power cut right after making its folder)
// holds nothing to clash with, so a retry takes its own name back rather than "-2".
async function plantTaken(P, dir) {
  if (!(await P.fs.exists(dir))) return false;
  try { return (await P.fs.readDir(dir)).length > 0; } catch (e) { return true; }
}

// ---- SUPPORT FILES (build 8): an app's files that serve EVERY asset of it in this game, written once ---------------------
// A Unity project needs an editor script to turn a planted export into ready-made assets (CrunchyCharacter's importer
// slices the sheet and builds clips, an Animator and a prefab). One copy per game: a copy in each asset's folder would
// be the same class twice, which Unity refuses. So an app may keep support files in its child folder, outside every
// asset folder (Unity needs editor scripts under a folder named "Editor": `Editor/<Name>.cs`), listed in a small
// `_support.crunchy` beside them (build 9: it was `.crunchy-support`, and the desktop's file scope ($HOME/**) does not
// match a name starting with a dot, so AJ's first real save was refused; the `.crunchy` extension keeps Godot from
// importing it, Unity gives it a harmless .meta, and no slug can start with "_"). plantSupport writes them when they
// differ, removes ones it listed before and no longer makes, and plantDelete removes them all with the app's LAST
// asset here. Nothing else in the folder is touched.
// Build 10: also "scripts", for an app's RUNTIME scripts (CrunchyTile's Rule Tile classes: a tile asset's script cannot
// live under Editor/, which Unity leaves out of a build). No asset slug takes either name.
// Build 14: also "combined", for a file built FROM every asset of the app in this game (CrunchyTile's combined/game.tres:
// one Godot TileSet holding every planted tileset, TILE-DESIGN §146). The same rules: written only by the app, removed
// with its last asset here, and no asset slug takes the name.
const PLANT_SUPPORT_FILE = "_support" + PLANT_EXT, PLANT_SUPPORT_RESERVED = ["editor", "scripts", "combined"];
function plantSupportOk(rel) {
  return plantSafeRel(rel) && rel.slice(-PLANT_EXT.length) !== PLANT_EXT && PLANT_SUPPORT_RESERVED.indexOf(rel.split("/")[0].toLowerCase()) >= 0 && rel.indexOf("/") > 0;
}
async function plantSupportRead(P) {
  const side = plantJoin(P.dir, P.rel, PLANT_SUPPORT_FILE);
  try { const d = (await P.fs.exists(side)) ? JSON.parse(await P.fs.readTextFile(side)) : null; return d && Array.isArray(d.files) ? d : null; }
  catch (e) { return null; }
}
// files: [{ path: "Editor/X.cs", data }] (paths under a reserved support folder only) → true when anything was written
async function plantSupport(P, files) {
  files.forEach(function (f) { if (!plantSupportOk(f.path)) throw new Error("plantSupport: refused path " + f.path); });
  const fs = P.fs, base = plantJoin(P.dir, P.rel), prev = await plantSupportRead(P), hash = plantHash(files);
  if (prev && prev.hash === hash && prev.files.length === files.length) {
    let all = true;
    for (const f of files) if (!(await fs.exists(plantJoin(base, f.path)))) { all = false; break; }
    if (all) return false;                                           // already there, byte for byte: Unity is not poked
  }
  // THE LIST FIRST (build 15), as a journal: what it listed before and everything about to be written, with no
  // fingerprint, so a write cut short leaves nothing the list does not own (and the next call writes them all again)
  const listed = prev ? prev.files.filter(plantSupportOk) : [];
  files.forEach(function (f) { if (listed.indexOf(f.path) < 0) listed.push(f.path); });
  const writeList = function (paths, h) {
    return fs.writeTextFile(plantJoin(base, PLANT_SUPPORT_FILE), JSON.stringify({ format: "crunchy-support", app: plantApp(P).id, files: paths, hash: h }, null, 2) + "\n");
  };
  await fs.mkdir(base, { recursive: true });
  await writeList(listed, "");
  for (const f of files) {
    const at = plantJoin(base, f.path);
    await fs.mkdir(at.slice(0, at.lastIndexOf("/")), { recursive: true });
    if (typeof f.data === "string") await fs.writeTextFile(at, f.data); else await fs.writeFile(at, f.data);
  }
  const keep = {};
  files.forEach(function (f) { keep[f.path] = true; });
  if (prev) for (const old of prev.files) if (!keep[old] && plantSupportOk(old)) await plantRemoveWritten(P, plantJoin(base, old));
  await writeList(files.map(function (f) { return f.path; }), hash);
  return true;
}
// Remove every support file (and the list), then their emptied folders. Called by plantDelete with the app's last asset.
async function plantSupportClear(P) {
  const prev = await plantSupportRead(P), base = plantJoin(P.dir, P.rel);
  if (!prev) return;
  for (const f of prev.files) if (plantSupportOk(f)) await plantRemoveWritten(P, plantJoin(base, f));
  await plantRemoveWritten(P, plantJoin(base, PLANT_SUPPORT_FILE));
  for (const top of PLANT_SUPPORT_RESERVED.concat(prev.files.map(function (f) { return f.split("/")[0]; }))) {
    const d = plantJoin(base, top);
    if (await P.fs.exists(d)) { await plantPrune(P, d); await plantRemoveEmptyDir(P, d); }
  }
}
// ---- GAME-LEVEL SUPPORT (build 15): an app's folder in the GAME itself, outside crunchy/, shared by its assets -------
// Godot lists an editor plugin only at res://addons/<name>/plugin.cfg, so an app whose exports carry one (CrunchyTile's
// raised-blocks helper, TILE-DESIGN §150) can install ONE copy there for the whole game, and switch it on. The rules are
// the support folders' (Unity's Editor/ above), with more care, because this is outside crunchy/:
//  - only a folder DIRECTLY under a root the engine allows (PLANT_GAME_ROOTS; Godot: addons/), named by the app;
//  - recorded in `_game.crunchy` in the app's child folder (beside _support.crunchy; no slug starts with "_"): per folder,
//    the files it wrote, their fingerprint, the parent folders it had to make, and the project.godot entry it added; and
//    the person's answers ("Not now") by a key of the app's choosing;
//  - NEVER a folder of that name the app did not write: plantGameSupport finds it there unrecorded, writes nothing and
//    says "foreign"; a recorded folder whose every file is gone was removed by the person ("gone"), and is not put back
//    unless the app asks again;
//  - written only when the bytes differ; files it no longer makes are removed; the record is written FIRST listing every
//    file about to land (a write cut short still owns what landed), then again with the fingerprint;
//  - removed by plantGameSupportRemove (the APP decides when nothing needs it any more; plantGameUsersOf finds what in
//    the game still refers to it, for the removal guard), and by plantDelete with the app's last asset here: its files
//    (and Godot's .uid / .import beside them), then the folder and the parents it made, each only when empty, so
//    anything the person put in there keeps it.
// SWITCHING A GODOT PLUGIN ON: plantGodotPluginOn / Off edit project.godot's `[editor_plugins] enabled=PackedStringArray(…)`
// as TEXT and touch nothing else: the entry appended to the list (or the key added to the section, or the section added
// where Godot itself would put it, sorted by name), the file's line endings kept; off removes ONLY that entry, and the key
// or section too when this added them and nothing else is in them, so on then off gives back the same bytes. A value it
// cannot read for certain (spread over lines, not a PackedStringArray of plain strings) is left alone: the app asks the
// person to tick the plugin in Project Settings > Plugins instead. Godot reads the list when the editor starts.
const PLANT_GAME_FILE = "_game" + PLANT_EXT, PLANT_GAME_ROOTS = { godot: ["addons"] };
function plantGameFolderOk(P, folder) {
  const roots = PLANT_GAME_ROOTS[P.engine];
  if (!Array.isArray(roots) || !plantSafeRel(folder) || folder.indexOf("\\") >= 0) return false;
  const seg = folder.split("/");
  return seg.length === 2 && roots.indexOf(seg[0]) >= 0;
}
// The record: { format, app, folders: { "<folder>": { files, hash, made, plugin: { cfg, added } | null } }, declined: { key: true } }.
// A missing or damaged one reads as empty; a listed path that is not safe is dropped, so it can never reach elsewhere.
async function plantGameRead(P) {
  const at = plantJoin(P.dir, P.rel, PLANT_GAME_FILE), rec = { format: "crunchy-game", app: PROJECT_APP.id, folders: {}, declined: {} };
  let d = null;
  try { d = (await P.fs.exists(at)) ? JSON.parse(await P.fs.readTextFile(at)) : null; } catch (e) { d = null; }
  if (!d || d.format !== "crunchy-game") return rec;
  if (d.folders && typeof d.folders === "object") Object.keys(d.folders).forEach(function (k) {
    const f = d.folders[k];
    if (!plantGameFolderOk(P, k) || !f || !Array.isArray(f.files) || !f.files.every(plantSafeRel)) return;
    const pl = f.plugin && typeof f.plugin.cfg === "string" && plantSafeRel(f.plugin.cfg) && /^(entry|key|section|)$/.test(String(f.plugin.added))
      ? { cfg: f.plugin.cfg, added: f.plugin.added } : null;
    rec.folders[k] = { files: f.files.slice(), hash: String(f.hash || ""),
      made: Array.isArray(f.made) ? f.made.filter(function (m) { return typeof m === "string" && plantSafeRel(m) && k.indexOf(m + "/") === 0; }) : [], plugin: pl };
  });
  if (d.declined && typeof d.declined === "object") Object.keys(d.declined).forEach(function (k) { if (d.declined[k] === true) rec.declined[k] = true; });
  return rec;
}
async function plantGameWrite(P, rec) {
  const base = plantJoin(P.dir, P.rel), at = plantJoin(base, PLANT_GAME_FILE);
  if (!Object.keys(rec.folders).length && !Object.keys(rec.declined).length) { await plantRemoveWritten(P, at); return; }
  await P.fs.mkdir(base, { recursive: true });
  await P.fs.writeTextFile(at, JSON.stringify({ format: "crunchy-game", app: PROJECT_APP.id, folders: rec.folders, declined: rec.declined }, null, 2) + "\n");
}
// "ours" (recorded, something of it there) | "gone" (recorded, every file gone: the person removed it) |
// "absent" (not there) | "foreign" (there, and this app never wrote it: never touched)
async function plantGameState(P, folder) {
  if (!plantGameFolderOk(P, folder)) throw new Error("plant: refused game folder " + folder);
  const mine = (await plantGameRead(P)).folders[folder], at = plantJoin(P.dir, folder);
  if (mine) {
    for (const f of mine.files) if (await P.fs.exists(plantJoin(at, f))) return "ours";
    return "gone";
  }
  return (await P.fs.exists(at)) ? "foreign" : "absent";
}
// Install or update `folder` with `files` ([{ path inside the folder, data }]). opts.godotPlugin: the plugin.cfg among
// them to switch on in project.godot (an INSTALL asks for it; an update leaves the person's own on/off alone).
// → { state: "ours" | "foreign" | "gone", wrote: bool, plugin: null | "added" | "on" | "unparsed" | "unreadable" }
// "gone" writes nothing unless opts.reinstall (the person asked for it again).
async function plantGameSupport(P, folder, files, opts) {
  opts = opts || {};
  if (!plantGameFolderOk(P, folder)) throw new Error("plantGameSupport: refused folder " + folder);
  files.forEach(function (f) { if (!plantSafeRel(f.path) || f.path.slice(-PLANT_EXT.length) === PLANT_EXT) throw new Error("plantGameSupport: refused path " + f.path); });
  if (opts.godotPlugin != null && (P.engine !== "godot" || !files.some(function (f) { return f.path === opts.godotPlugin; })))
    throw new Error("plantGameSupport: " + opts.godotPlugin + " is not one of its files in a Godot project");
  const fs = P.fs, rec = await plantGameRead(P), at = plantJoin(P.dir, folder), hash = plantHash(files);
  const prev = rec.folders[folder] || null;
  const state = await plantGameState(P, folder);
  if (state === "foreign") return { state: "foreign", wrote: false, plugin: null };
  if (state === "gone" && !opts.reinstall) return { state: "gone", wrote: false, plugin: null };
  let same = !!prev && prev.hash === hash && prev.files.length === files.length;
  if (same) for (const f of files) if (!(await fs.exists(plantJoin(at, f.path)))) { same = false; break; }
  let wrote = false;
  if (!same) {
    const made = prev ? prev.made.slice() : [];
    if (!prev) {                                                     // the parents it makes (addons/), removed with it when empty
      const seg = folder.split("/");
      for (let i = 1; i < seg.length; i++) { const d = seg.slice(0, i).join("/"); if (!(await fs.exists(plantJoin(P.dir, d)))) made.push(d); }
    }
    const listed = prev ? prev.files.slice() : [];
    files.forEach(function (f) { if (listed.indexOf(f.path) < 0) listed.push(f.path); });
    rec.folders[folder] = { files: listed, hash: "", made: made, plugin: prev ? prev.plugin : null };
    await plantGameWrite(P, rec);                                    // FIRST: whatever lands is owned
    for (const f of files) {
      const to = plantJoin(at, f.path);
      await fs.mkdir(to.slice(0, to.lastIndexOf("/")), { recursive: true });
      if (typeof f.data === "string") await fs.writeTextFile(to, f.data); else await fs.writeFile(to, f.data);
    }
    const keep = {};
    files.forEach(function (f) { keep[f.path] = true; });
    if (prev) { for (const old of prev.files) if (!keep[old]) await plantRemoveWritten(P, plantJoin(at, old)); await plantPrune(P, at); }
    rec.folders[folder] = { files: files.map(function (f) { return f.path; }), hash: hash, made: made, plugin: prev ? prev.plugin : null };
    await plantGameWrite(P, rec);
    wrote = true;
  }
  let plugin = null;
  if (opts.godotPlugin != null) plugin = await plantGamePluginOn(P, rec, folder, opts.godotPlugin);
  return { state: "ours", wrote: wrote, plugin: plugin };
}
async function plantGamePluginOn(P, rec, folder, cfg) {
  const pg = plantJoin(P.dir, "project.godot"), res = "res://" + folder + "/" + cfg;
  let text = null;
  try { text = await P.fs.readTextFile(pg); } catch (e) { return "unreadable"; }
  const r = plantGodotPluginOn(text, res);
  if (!r) return "unparsed";
  const mine = rec.folders[folder];
  if (!r.added) {                                                    // on already (by the person, or by an earlier install)
    if (!mine.plugin) { mine.plugin = { cfg: cfg, added: "" }; await plantGameWrite(P, rec); }
    return "on";
  }
  mine.plugin = { cfg: cfg, added: r.added };
  await plantGameWrite(P, rec);                                      // recorded first: an "off" of an entry not there is nothing
  await P.fs.writeTextFile(pg, r.text);
  return "added";
}
// Remove an installed folder: the project.godot entry this added first (so Godot never enables a plugin whose files are
// gone), then its files, then the folder and the parents it made, each only when empty; the record last. → bool
async function plantGameSupportRemove(P, folder) {
  if (!plantGameFolderOk(P, folder)) throw new Error("plantGameSupportRemove: refused folder " + folder);
  const rec = await plantGameRead(P), mine = rec.folders[folder], at = plantJoin(P.dir, folder);
  if (!mine) return false;
  if (mine.plugin && mine.plugin.added && P.engine === "godot") {
    const pg = plantJoin(P.dir, "project.godot");
    let text = null;
    try { text = (await P.fs.exists(pg)) ? await P.fs.readTextFile(pg) : null; } catch (e) { text = null; }
    const out = text == null ? null : plantGodotPluginOff(text, "res://" + folder + "/" + mine.plugin.cfg, mine.plugin.added);
    if (out != null && out !== text) await P.fs.writeTextFile(pg, out);
  }
  for (const f of mine.files) await plantRemoveWritten(P, plantJoin(at, f));
  await plantPrune(P, at);
  await plantRemoveEmptyDir(P, at);
  for (const d of mine.made.slice().sort(function (a, b) { return b.length - a.length; })) await plantRemoveEmptyDir(P, plantJoin(P.dir, d));
  delete rec.folders[folder];
  await plantGameWrite(P, rec);
  return true;
}
// Everything game-level, and the record with the person's answers: the app's last asset here is going.
async function plantGameClear(P) {
  const rec = await plantGameRead(P);
  for (const k of Object.keys(rec.folders)) await plantGameSupportRemove(P, k);
  await plantRemoveWritten(P, plantJoin(P.dir, P.rel, PLANT_GAME_FILE));
}
// The person's answer to an app's offer, per game ("Not now"): remembered in the record until the app's last asset goes.
async function plantGameDeclined(P, key) { return !!(await plantGameRead(P)).declined[key]; }
async function plantGameDecline(P, key, on) {
  const rec = await plantGameRead(P);
  if (on) rec.declined[key] = true; else delete rec.declined[key];
  await plantGameWrite(P, rec);
}
// What in the game still refers to a game-level folder: its res:// path, or any of `needles` (a script's class name).
// Not the folder itself, not this app's own planted folder (its exports may carry their own copy), not project.godot
// (the entry this app added). → [path inside the game]. Read-only.
async function plantGameUsersOf(P, folder, needles) {
  if (!plantGameFolderOk(P, folder)) throw new Error("plant: refused game folder " + folder);
  const at = plantJoin(P.dir, folder), own = plantJoin(P.dir, P.rel), out = [];
  const want = (P.engine === "godot" ? ["res://" + folder + "/"] : []).concat((needles || []).filter(function (n) { return typeof n === "string" && n; }));
  await plantRefWalk(P, function (d) { return d === at || d === own; }, function (text, r) {
    if (r !== "project.godot" && want.some(function (n) { return text.indexOf(n) >= 0; })) out.push(r);
  });
  return out.sort();
}

// ---- project.godot, as text ----------------------------------------------------------------------------------------
// Its lines, and for each whether it starts at the TOP level (outside a string and outside any bracket): Godot writes a
// multi-line string or dictionary over several lines, and a "[" inside one is not a section. `;` outside a string
// starts a comment.
function plantGodotLines(text) {
  const eol = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n", lines = text.split(/\r?\n/), top = [];
  let inStr = false, esc = false, depth = 0;
  lines.forEach(function (line) {
    top.push(!inStr && depth === 0);
    for (let i = 0; i < line.length; i++) {
      const c = line.charAt(i);
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === ";") break;
      if (c === '"') inStr = true;
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if ((c === ")" || c === "]" || c === "}") && depth > 0) depth--;
    }
  });
  return { eol: eol, lines: lines, top: top };
}
function plantGodotSections(L) {
  const out = [];
  L.lines.forEach(function (l, i) { const m = L.top[i] ? /^\s*\[([^\]]+)\]\s*$/.exec(l) : null; if (m) out.push({ i: i, name: m[1] }); });
  return out;
}
// The quoted strings of a PackedStringArray's inside: [{ value, start, end }] or null when it is anything else.
function plantGodotStrings(s) {
  const out = [];
  let i = 0;
  const ws = function () { while (i < s.length && /\s/.test(s.charAt(i))) i++; };
  ws();
  while (i < s.length) {
    if (s.charAt(i) !== '"') return null;
    const start = i++;
    let v = "";
    while (i < s.length && s.charAt(i) !== '"') { if (s.charAt(i) === "\\") { i++; if (i >= s.length) return null; } v += s.charAt(i++); }
    if (i >= s.length) return null;
    out.push({ value: v, start: start, end: ++i });
    ws();
    if (i < s.length) { if (s.charAt(i) !== ",") return null; i++; ws(); }
  }
  return out;
}
// The section's `enabled=` line: { h, end, k, m, list } (k -1: no such key), or null when the value cannot be read for certain.
function plantGodotEnabled(L) {
  const h = plantGodotSections(L).filter(function (x) { return x.name === "editor_plugins"; })[0];
  if (!h) return { h: null };
  const next = plantGodotSections(L).filter(function (x) { return x.i > h.i; })[0], end = next ? next.i : L.lines.length;
  for (let k = h.i + 1; k < end; k++) {
    if (!L.top[k] || !/^\s*enabled\s*=/.test(L.lines[k])) continue;
    const m = /^(\s*enabled\s*=\s*PackedStringArray\()(.*)(\)\s*)$/.exec(L.lines[k]);
    if (!m || (k + 1 < L.lines.length && !L.top[k + 1])) return null;
    const list = plantGodotStrings(m[2]);
    return list ? { h: h, end: end, k: k, m: m, list: list } : null;
  }
  return { h: h, end: end, k: -1 };
}
const PLANT_GODOT_RES = /^res:\/\/[^"\\\r\n]+$/;
// → { text, added: "entry" | "key" | "section" | "" (on already) }, or null (left alone: the app asks the person)
function plantGodotPluginOn(text, res) {
  if (!PLANT_GODOT_RES.test(res)) throw new Error("plant: not a res:// path " + res);
  const L = plantGodotLines(String(text)), E = plantGodotEnabled(L), line = 'enabled=PackedStringArray("' + res + '")';
  if (!E) return null;
  if (E.h && E.k >= 0) {
    if (E.list.some(function (x) { return x.value === res; })) return { text: text, added: "" };
    L.lines[E.k] = E.m[1] + (E.list.length ? E.m[2].replace(/\s+$/, "") + ", " : "") + '"' + res + '"' + E.m[3];
    return { text: L.lines.join(L.eol), added: "entry" };
  }
  if (E.h) {                                                         // the section without the key: after its last line
    let last = E.h.i;
    for (let i = E.h.i + 1; i < E.end; i++) if (L.lines[i].trim()) last = i;
    L.lines.splice(last + 1, 0, line);
    return { text: L.lines.join(L.eol), added: "key" };
  }
  const after = plantGodotSections(L).filter(function (x) { return x.name > "editor_plugins"; })[0];
  if (after) L.lines.splice(after.i, 0, "[editor_plugins]", "", line, "");
  else if (L.lines[L.lines.length - 1] === "") L.lines.splice(L.lines.length - 1, 0, "", "[editor_plugins]", "", line);
  else L.lines.push("", "[editor_plugins]", "", line);
  return { text: L.lines.join(L.eol), added: "section" };
}
// → the text without `res` in the list (and without the key / section `added` made, when nothing else is in them),
// the same text when it is not there, or null when the list cannot be read for certain (left alone).
function plantGodotPluginOff(text, res, added) {
  const L = plantGodotLines(String(text)), E = plantGodotEnabled(L);
  if (!E) return null;
  if (!E.h || E.k < 0) return text;
  const at = E.list.findIndex(function (x) { return x.value === res; });
  if (at < 0) return text;
  const inner = E.m[2], it = E.list[at];
  const left = E.list.length === 1 ? "" : at > 0 ? inner.slice(0, E.list[at - 1].end) + inner.slice(it.end) : inner.slice(0, it.start) + inner.slice(E.list[1].start);
  if (E.list.length > 1 || (added !== "key" && added !== "section")) { L.lines[E.k] = E.m[1] + left + E.m[3]; return L.lines.join(L.eol); }
  L.lines.splice(E.k, 1);
  if (added === "section") {
    const h = plantGodotSections(L).filter(function (x) { return x.name === "editor_plugins"; })[0];
    const next = plantGodotSections(L).filter(function (x) { return x.i > h.i; })[0], end = next ? next.i : L.lines.length;
    let empty = true;
    for (let i = h.i + 1; i < end; i++) if (L.lines[i].trim()) empty = false;
    if (empty) L.lines.splice(h.i, end - h.i);
    if (empty && !next && !/\n$/.test(text) && L.lines[L.lines.length - 1] === "") L.lines.pop();   // it was added at the very end
  }
  return L.lines.join(L.eol);
}
// ---- the guard: a save or delete must not silently break the game -------------------------------------------------
// A re-export removes the files its last export wrote and this one does not; a delete removes them all. If the GAME
// uses one (a scene that placed a decoration sprite: AJ's player_test.tscn lost cable-1-ceiling.png when a re-save made
// one cable fewer), the app warns by name and asks again. These find what would go and who uses it; the app asks.
//
// plantStale(P, req) → [path inside the asset folder] that plantPut(P, req) would remove (none for a new asset)
async function plantStale(P, req) {
  const prev = plantFind(P, req.kind, req.name);
  if (!prev) return [];
  const keep = {};
  (req.files || []).forEach(function (f) { keep[f.path] = true; });
  return prev.data.files.filter(function (f) { return !keep[f] && plantSafeRel(f); });
}
// The game's own files that may refer to an asset's files, by engine. Skipped: the engine's caches and imports, the VCS,
// and the planted folder itself (an asset's files are its own business, and a re-export rewrites them together).
const PLANT_REF_EXT = { godot: /\.(tscn|tres|gd|cs|gdshader|godot|cfg)$/i, unity: /\.(unity|prefab|asset|mat|controller|anim|overrideController|playable|spriteatlas)$/i };
const PLANT_REF_SKIP = /^(\.godot|\.import|\.git|\.svn|\.hg|node_modules|Library|Temp|Logs|obj|build|addons\/godot-git-plugin)$/;
const PLANT_REF_MAX = 20000;                                    // files read at most: a guard, not an indexer
// plantUsersOf(P, slug, paths) → [{ path, by: [who, as a person reads it] }], only the paths something uses. Read-only.
//   SUITE LINKS (build 7, SUITE-LINKS.md): another planted asset, of any app, whose sidecar links this one (any engine,
//     a plain folder too): "CrunchyVFX's effect “Fireball”".
//   Godot: a text resource or script that names the file's res:// path, ANYWHERE but this app's own planted folder (a
//     VFX scene in crunchy/vfx/ that plays an SFX WAV counts; before build 7 all of crunchy/ was skipped and missed it).
//   Unity: an asset that names the GUID in the file's .meta, likewise.
//   RPG Maker (build 6): the Database (data/*.json) naming an image by its file name without ".png" ("$Hero", "Hero").
async function plantUsersOf(P, slug, paths) {
  if (!paths.length) return [];
  const fs = P.fs, by = {};
  const add = function (path, who) { const l = by[path] = by[path] || []; if (l.indexOf(who) < 0) l.push(who); };
  for (const l of await plantLinkersOf(P, slug)) paths.forEach(function (p) { if (l.file == null || l.file === p) add(p, l.label); });
  if (P.engine === "rpgmaker") {
    const imgs = paths.map(function (p) { const g = plantGameRel(p); return g === null ? null : { path: p, needle: JSON.stringify(g.split("/").pop().replace(/\.png$/i, "")) }; })
      .filter(Boolean);
    const data = plantJoin(P.dir, "data");
    if (imgs.length && await fs.exists(data)) for (const e of await fs.readDir(data)) {
      if (e.isDirectory || !/\.json$/i.test(e.name)) continue;
      let text = "";
      try { text = await fs.readTextFile(plantJoin(data, e.name)); } catch (err) { continue; }
      imgs.forEach(function (w) { if (text.indexOf(w.needle) >= 0) add(w.path, "data/" + e.name); });
    }
  } else if (P.engine === "godot" || P.engine === "unity") {
    const dir = plantJoin(P.dir, P.rel, slug), want = [];
    for (const p of paths) {
      if (P.engine === "godot") want.push({ path: p, needle: "res://" + plantJoin(P.rel, slug, p) });
      else {
        const meta = plantJoin(dir, p) + ".meta";
        if (!(await fs.exists(meta))) continue;                  // Unity never imported it: nothing can refer to it
        const m = /^guid:\s*([0-9a-f]{32})/m.exec(await fs.readTextFile(meta));
        if (m) want.push({ path: p, needle: m[1] });
      }
    }
    if (want.length) {
      const own = plantJoin(P.dir, P.rel);
      await plantRefWalk(P, function (d) { return d === own; }, function (text, r) {
        want.forEach(function (w) { if (text.indexOf(w.needle) >= 0) add(w.path, r); });
      });
    }
  }
  return paths.filter(function (p) { return by[p]; }).map(function (p) { return { path: p, by: by[p] }; });
}
// Read every text resource of the game (Godot / Unity, by PLANT_REF_EXT), past the engine's caches and any folder
// `skip(fullPath)` names: look(text, pathInTheGame). At most PLANT_REF_MAX files. Read-only. (Build 15: shared by
// plantUsersOf and plantGameUsersOf.)
async function plantRefWalk(P, skip, look) {
  const fs = P.fs, ext = PLANT_REF_EXT[P.engine];
  if (!ext) return;
  let read = 0;
  const walk = async function (d, rel) {
    if (read > PLANT_REF_MAX || skip(d)) return;
    let entries = [];
    try { entries = await fs.readDir(d); } catch (e) { return; }
    for (const e of entries) {
      if (read > PLANT_REF_MAX) return;
      const r = rel ? rel + "/" + e.name : e.name, full = plantJoin(d, e.name);
      if (e.isDirectory) { if (!PLANT_REF_SKIP.test(e.name) && !PLANT_REF_SKIP.test(r)) await walk(full, r); continue; }
      if (!ext.test(e.name)) continue;
      read++;
      let text = "";
      try { text = await fs.readTextFile(full); } catch (err) { continue; }
      look(text, r);
    }
  };
  await walk(P.dir, "");
}
// One plain sentence for the app's status line: what would go, and what in the game uses it.
function plantUsedMessage(used, verb) {
  const n = used.length, first = used.slice(0, 3).map(function (u) {
    return u.path.split("/").pop() + " (used by " + u.by.slice(0, 2).join(", ") + (u.by.length > 2 ? " and " + (u.by.length - 2) + " more" : "") + ")";
  }).join(", ");
  return "This " + (verb || "save") + " removes " + n + " file" + (n === 1 ? "" : "s") + " your game uses: " + first +
    (n > 3 ? " and " + (n - 3) + " more" : "") + ". Press again to " + (verb || "save") + " anyway; those scenes will lose " +
    (n === 1 ? "it" : "them") + ".";
}

async function plantPut(P, req) {
  const fields = Object.assign({}, req.fields);
  const probe = Object.assign({ format: PLANT_FORMAT, files: [] }, fields, { kind: req.kind, name: String(req.name || "") });
  if (!plantSidecarValid(probe, plantApp(P))) throw new Error("plantPut: not a valid " + req.kind);
  (req.files || []).forEach(function (f) {
    if (!plantSafeRel(f.path) || f.path.slice(-PLANT_EXT.length) === PLANT_EXT) throw new Error("plantPut: refused path " + f.path);
    const g = plantGameRel(f.path);
    if (g !== null && !plantGameOk(P, g)) throw new Error("plantPut: refused game path " + f.path);
  });
  const fs = P.fs, prev = plantFind(P, req.kind, req.name);
  // GAME FILES are never written over unless THIS asset wrote them: checked for every one before anything is written
  const mine = {};
  if (prev) prev.data.files.forEach(function (f) { mine[f] = true; });
  for (const f of req.files) {
    const g = plantGameRel(f.path);
    if (g === null || mine[f.path] || !(await fs.exists(plantJoin(P.dir, g)))) continue;
    const other = P.assets.find(function (a) { return a.data.files.indexOf(f.path) >= 0; });
    throw new Error(g + " is already in the game" + (other ? ", written for " + other.name : ", and " + plantApp(P).name + " did not write it") +
      ": give this one another name" + (other ? ", or Replace that one" : ", or move that file") + ".");
  }
  const slug = await plantSlugFor(P, req.kind, req.name);
  const dir = plantJoin(P.dir, P.rel, slug);
  delete fields.pending;                                              // a journal's mark, handed back by an app: never kept
  const keep = {};
  req.files.forEach(function (f) { keep[f.path] = true; });
  // THE JOURNAL (build 15; AJ's game: a save stopped at a refused write, its sidecar was never updated, and a later Delete
  // left the files it had written with nothing owning them). Before any export is written, the sidecar lists everything
  // the asset owned and every NEW file about to land (one that is not on disk yet: a file already there that the asset
  // never wrote is not claimed by a save that stops before it). So whatever lands is owned, by any failure, a crash too.
  const owned = prev ? prev.data.files.filter(plantSafeRel) : [], have = {};
  owned.forEach(function (f) { have[f] = true; });
  const fresh = [];
  // (a new asset's folder is new, and a game file already there stopped it above: everything it writes is fresh)
  for (const f of req.files) if (!have[f.path] && (!prev || !(await fs.exists(plantFileAt(P, dir, f.path))))) fresh.push(f.path);
  const journal = Object.assign(plantSidecar(req.kind, req.name, fields, [], req.appVersion, prev ? prev.data.created : null, plantApp(P)),
                                { files: owned.concat(fresh), hash: "", pending: true });
  const remember = function (side) {
    const asset = { slug: slug, kind: req.kind, name: side.name, data: side };
    P.assets = P.assets.filter(function (a) { return a.slug !== slug; }).concat([asset])
      .sort(function (x, y) { return x.name.localeCompare(y.name); });
    return asset;
  };
  await fs.mkdir(dir, { recursive: true });
  const jf = plantSidecarFile(slug, journal);
  await fs.writeTextFile(plantJoin(dir, jf.path), jf.data);
  remember(journal);                                                  // a Delete in this session sees what it owns
  try {
    for (const f of req.files) {
      const at = plantFileAt(P, dir, f.path);
      const parent = at.slice(0, at.lastIndexOf("/"));
      if (parent !== dir) await fs.mkdir(parent, { recursive: true });
      if (typeof f.data === "string") await fs.writeTextFile(at, f.data); else await fs.writeFile(at, f.data);
    }
    if (prev) {
      for (const old of owned) if (!keep[old] && plantWritable(P, old)) await plantRemoveWritten(P, plantFileAt(P, dir, old));
      await plantPrune(P, dir);                                       // subfolders the old export had and this one does not
    }
    const side = plantSidecar(req.kind, req.name, fields, req.files, req.appVersion, prev ? prev.data.created : null, plantApp(P));
    const sf = plantSidecarFile(slug, side);
    await fs.writeTextFile(plantJoin(dir, sf.path), sf.data);         // the asset is complete only now
    return remember(side);
  } catch (err) {
    // A NEW asset is rolled back: what it wrote, then its journal, then its folder. If that fails too, the journal
    // stays and still owns everything (the Library shows it; Delete removes it). An UPDATE keeps its journal: the old
    // bytes are gone already, and the next Re-export (or Delete) finishes the job.
    if (!prev) {
      try {
        for (const f of fresh) if (plantWritable(P, f)) await plantRemoveWritten(P, plantFileAt(P, dir, f));
        await plantRemoveWritten(P, plantJoin(dir, jf.path));
        await plantPrune(P, dir);
        await plantRemoveEmptyDir(P, dir);
        P.assets = P.assets.filter(function (a) { return a.slug !== slug; });
      } catch (e2) { /* the journal still owns what is left */ }
    }
    throw err;
  }
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
  for (const f of a.data.files) if (plantSafeRel(f) && plantWritable(P, f)) await plantRemoveWritten(P, plantFileAt(P, dir, f));
  await plantRemoveWritten(P, plantJoin(dir, a.slug + PLANT_EXT));
  const A = plantApp(P), gen = A.generated && A.generated[P.engine];
  if (Array.isArray(gen)) for (const g of gen) if (plantSafeRel(g) && g.indexOf("/") < 0) await plantRemoveTree(P, plantJoin(dir, g));
  await plantPrune(P, dir);                                           // the export's own subfolders, now empty
  await plantRemoveEmptyDir(P, dir);
  P.assets = P.assets.filter(function (x) { return x.slug !== a.slug; });
  if (!P.assets.length) {                                            // build 8: the app's last asset here takes its support
    await plantSupportClear(P);
    await plantGameClear(P);                                          // build 15: and its game-level folders
  }
}

// ---- keeping it current ------------------------------------------------------------------------------------------
// The app re-renders an asset from its sidecar (`s`) and hands the files here: true when they differ from what was
// exported, i.e. this version of the app would now make something different ("update available").
function plantNeedsUpdate(a, files) {
  if (a.data.pending) return true;                                     // build 15: a save that did not finish
  const h = String(a.data.hash || "");
  return (h.indexOf("2:") === 0 ? plantHash(files) : plantHash(files, 1)) !== h;     // compared the way it was written
}

// ---- the suite view, and SUITE LINKS (build 7, SUITE-LINKS.md) --------------------------------------------------------
// Every sidecar in one app's child folder here (any app's, this one's too): [{ slug, d }], unreadable ones left out.
async function plantReadChild(P, key) {
  const fs = P.fs, rel = plantChildRel(P.engine, key), dir = plantJoin(P.dir, rel), out = [];
  if (!(await fs.exists(dir))) return out;
  for (const e of await fs.readDir(dir)) {
    if (!e.isDirectory || !plantSafeRel(e.name)) continue;
    const side = plantJoin(dir, e.name, e.name + PLANT_EXT);
    if (!(await fs.exists(side))) continue;
    let d = null;
    try { d = JSON.parse(await fs.readTextFile(side)); } catch (err) { continue; }
    if (!d || d.format !== PLANT_FORMAT || typeof d.kind !== "string" || typeof d.name !== "string") continue;
    out.push({ slug: e.name, rel: rel, d: d });
  }
  return out;
}
// ANOTHER APP'S planted assets, read-only, by the fields every sidecar shares (rule 6: never an app's own fields):
// [{ suite, slug, rel, kind, name, files, s, hash, modified }], by name. `kind` filters.
async function plantPeek(P, key, kind) {
  if (!PLANT_SUITE[key]) throw new Error("plant: unknown suite key " + key);
  return (await plantReadChild(P, key)).filter(function (x) { return !kind || x.d.kind === kind; }).map(function (x) {
    return { suite: key, slug: x.slug, rel: x.rel, kind: x.d.kind, name: x.d.name,
             files: Array.isArray(x.d.files) ? x.d.files.filter(plantSafeRel) : [], s: typeof x.d.s === "string" ? x.d.s : "",
             hash: String(x.d.hash || ""), modified: x.d.modified || "" };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}
// Read-only: what the OTHER Crunchy tools have planted in the same folder. [{ key, rel, count, kinds: { kind: n } }],
// only the tools that have something.
async function plantSuiteView(P) {
  const out = [];
  for (const key of Object.keys(PLANT_SUITE)) {
    if (key === PROJECT_APP.suite) continue;
    const list = await plantReadChild(P, key);
    if (!list.length) continue;
    const row = { key: key, rel: plantChildRel(P.engine, key), count: list.length, kinds: {} };
    list.forEach(function (x) { row.kinds[x.d.kind] = (row.kinds[x.d.kind] || 0) + 1; });
    out.push(row);
  }
  return out;
}
// A LINK, kept in the sidecar of the asset that uses another (`fields.links`, an array): { suite, slug, kind, name,
// file, mode, hash }. mode "reference": the export POINTS at that file (a change reaches the game by itself); "embed":
// the export is DRAWN from that design (a change makes this asset "update available"). `file` (one of its files; for
// "reference") names what is used. `hash` is the target's fingerprint when linked.
function plantLinkOf(peeked, file, mode) {
  if (mode !== "reference" && mode !== "embed") throw new Error("plant: a link is \"reference\" or \"embed\"");
  if (file != null && peeked.files.indexOf(file) < 0) throw new Error("plant: " + peeked.name + " has no file " + file);
  if (mode === "reference" && file == null) throw new Error("plant: a reference link names a file");
  const l = { suite: peeked.suite, slug: peeked.slug, kind: peeked.kind, name: peeked.name, mode: mode, hash: peeked.hash };
  if (file != null) l.file = file;
  return l;
}
// An asset's links, only well-formed ones (a hand-edited or foreign sidecar never reaches outside crunchy/ through one).
function plantLinks(a) {
  const ls = a && a.data && Array.isArray(a.data.links) ? a.data.links : [];
  return ls.filter(function (l) {
    return l && PLANT_SUITE[l.suite] && typeof l.slug === "string" && plantSafeRel(l.slug) && l.slug.indexOf("/") < 0 &&
      (l.mode === "reference" || l.mode === "embed") && (l.file == null || (plantSafeRel(l.file) && plantGameRel(l.file) === null));
  });
}
// Where a link's file is, relative to the game folder ("crunchy/sfx/boom/boom.wav"); Godot's path is "res://" + this.
function plantLinkPath(P, l) { return plantJoin(plantChildRel(P.engine, l.suite), l.slug, l.file || ""); }
// "ok" | "changed" (an embed link whose target was re-exported since) | "missing" (the target, or its file, is gone)
async function plantLinkState(P, l) {
  const side = plantJoin(P.dir, plantChildRel(P.engine, l.suite), l.slug, l.slug + PLANT_EXT);
  let d = null;
  try { d = (await P.fs.exists(side)) ? JSON.parse(await P.fs.readTextFile(side)) : null; } catch (err) { d = null; }
  if (!d || d.format !== PLANT_FORMAT) return "missing";
  if (l.file != null && (!Array.isArray(d.files) || d.files.indexOf(l.file) < 0 || !(await P.fs.exists(plantJoin(P.dir, plantLinkPath(P, l)))))) return "missing";
  return l.mode === "embed" && String(d.hash || "") !== l.hash ? "changed" : "ok";
}
// WHO LINKS TO an asset of this app (`slug`), across every app here: [{ suite, slug, kind, name, file, mode, label }].
// "This app" is the HANDLE's (build 17: plantApp(P), so a palette deleted through plantOpenAs(P, PALETTE_APP) finds the
// assets that link to the palette; before, it looked for links to the opening app's own suite).
async function plantLinkersOf(P, slug) {
  const out = [], own = plantApp(P).suite;
  for (const key of Object.keys(PLANT_SUITE)) {
    for (const x of await plantReadChild(P, key)) {
      if (key === own && x.slug === slug) continue;
      plantLinks({ data: x.d }).forEach(function (l) {
        if (l.suite !== own || l.slug !== slug) return;
        out.push({ suite: key, slug: x.slug, kind: x.d.kind, name: x.d.name, file: l.file, mode: l.mode, label: plantLabelOf(key, x.d) });
      });
    }
  }
  return out;
}

// How the removal guard names an asset to a person: "CrunchyVFX's effect “Fireball”"; the suite's own kinds by what they
// are: "the game moment “Hit”", "the palette “Moonlit keep”", "the color set “Fire”" (build 17).
function plantLabelOf(key, d) {
  if (key === "moments") return "the game moment “" + d.name + "”";
  if (key === "palettes") return (d.kind === "colorset" ? "the color set “" : "the palette “") + d.name + "”";
  return PLANT_SUITE_NAMES[key] + "'s " + d.kind + " “" + d.name + "”";
}

// ---- the desktop's file system -------------------------------------------------------------------------------------
// The Tauri fs plugin as the `fs` above (window.__TAURI__.fs, passed in so this file stays pure).
function plantTauriFs(T) {
  return {
    exists: function (p) { return T.exists(p); },
    readTextFile: function (p) { return T.readTextFile(p); },
    readFile: function (p) { return T.readFile(p); },              // build 16: bytes (the game moment modal's PNG and WAV)
    readDir: function (p) { return T.readDir(p).then(function (es) { return es.map(function (e) { return { name: e.name, isDirectory: !!e.isDirectory }; }); }); },
    mkdir: function (p, o) { return T.mkdir(p, o); },
    writeTextFile: function (p, t) { return T.writeTextFile(p, t); },
    writeFile: function (p, b) { return T.writeFile(p, b); },
    remove: function (p) { return T.remove(p); },
  };
}
