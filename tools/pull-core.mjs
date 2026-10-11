// pull-core — copy the Crunchy suite's shared files from crunchyCore into this app, and check the copies.
//
//   node tools/pull-core.mjs                 pull from a COMMITTED crunchyCore (a dirty one is refused)
//   node tools/pull-core.mjs --wip           a trial pull of the core's uncommitted work (the core's author, testing)
//   node tools/pull-core.mjs --migrated      pull past a MIGRATION the changelog names, once you have done it
//   node tools/pull-core.mjs --check         the app's suite: fails ONLY when a copy is CORRUPT
//   node tools/pull-core.mjs --check --pinned  a commit (the app's pre-commit hook): also fails on a TRIAL copy, so an
//                                              app is never committed holding bytes that exist in no core commit
//   node tools/pull-core.mjs --check --strict  a release: also fails when a copy is BEHIND the core or a trial pull
//   node tools/pull-core.mjs --guard           write the app's pre-commit hook and switch it on in this clone
//   node tools/pull-core.mjs --precommit       what that hook runs: --check --pinned, then the app's wiring test
//
// THE GUARD (CrunchyUI's PROCESS-HANDOFF.md handback): `.githooks/pre-commit` is the SAME in every app (it only runs
// `--precommit`), so the puller writes it on every pull and keeps it current; it never overwrites a hook the app wrote
// itself (one without the marker line). Switching hooks on is per-clone git config that no file can carry, so a pull
// SAYS when this clone has no guard, and `--guard` switches it on (git config core.hooksPath .githooks).
//
// THIS SCRIPT IS ITSELF A CORE FILE: canonical in crunchyCore/tools/, copied verbatim into each app's tools/. When a
// pull brings a new one it RE-RUNS ITSELF at once, so the new rules apply to that same pull. It works on the app it
// sits in; crunchyCore is found beside the app (../crunchyCore) or at $CRUNCHYCORE_DIR.
//
// VENDORED BY COPY, NOT LINKED: every app stays buildless, opens on file://, and builds and deploys on its own (CI never
// needs the core). Each copy carries a two-line header: the core COMMIT it came from and the sha256 of everything below
// the header; the body is the core file at that commit, byte for byte. Nothing is substituted per app: what differs
// per app lives in the app's own files (project-app.js, its stylesheet's accent), never in a core file.
//
// THE RELEASE BOUNDARY (CrunchyUI's PROCESS-HANDOFF.md, 2026-10-11). An app depends on COMMITS, never on whatever the
// core's author is typing:
//   - a pull takes a committed core (or, with --wip, says in the header that it did not: "@ <sha>+uncommitted");
//   - the header's commit is the app's PIN: --check proves the copy is exactly the core's file at that commit;
//   - BEHIND (the core's HEAD has moved on) is the normal state of any consumer: reported, not failed, except --strict;
//   - CORRUPT (edited below the header, missing, or not the file at its commit) always fails.
//
// A PULL MOVES THE APP'S `want`: each core file carries a stamp (`const X_BUILD = n;`, or `--base-build: n` in CSS)
// that the app's index.html checks against a literal: the DEPS row naming the file (`file: "x.js"` … `want: n`), or
// the CSS check line naming it (`!== "n"` … `"x.css is build "` … `wants n`). A want it cannot find is REPORTED.
//
// A PULL READS THE CHANGELOG: every crunchyCore/CHANGELOG.md entry between the app's stamp and the core's is printed.
// An entry with a `MIGRATION:` line is work the APP must do (delete rules the core now owns, rename a call): a pull
// that crosses one prints it and writes NOTHING, until re-run with --migrated after the work is done.
//
// --check EXIT CODES: 0 every copy intact (behind or trial copies are listed) · 1 corrupt, or (--strict) behind or a
// trial copy · 3 every copy intact but crunchyCore is not beside this app, so the pin cannot be verified (CI).
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const core = process.env.CRUNCHYCORE_DIR || join(app, "..", "crunchyCore");
const SELF = "tools/pull-core.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const args = process.argv.slice(2), has = (f) => args.includes(f);
const check = has("--check"), strict = has("--strict"), pinnedOnly = has("--pinned"), guard = has("--guard"), precommit = has("--precommit"), wip = has("--wip"), migrated = has("--migrated");

const list = JSON.parse(readFileSync(join(here, "core-files.json"), "utf8"));
if (!Array.isArray(list) || !list.every((f) => typeof f === "string")) throw new Error("tools/core-files.json must be a list of file names");

// ---- the guard -------------------------------------------------------------------------------------------------
const HOOK = ".githooks/pre-commit", HOOK_MARK = "# crunchyCore guard: written by tools/pull-core.mjs";
const HOOK_TEXT = `#!/bin/sh
${HOOK_MARK}. Rewritten on every pull: do not edit (an app that
# needs its own hook removes this line, and the puller leaves it alone). Refuses a commit holding crunchyCore copies that
# are trial pulls (commit the core first: the VS Code task "Commit crunchyCore, then pull it here") or hand-edited, or
# that fails this app's tests/wiring.test.mjs. Switched on per clone: node tools/pull-core.mjs --guard
# Skip once, knowingly: git commit --no-verify
cd "$(git rev-parse --show-toplevel)" || exit 1
exec node tools/pull-core.mjs --precommit
`;
const appGit = (...a) => { try { return execFileSync("git", a, { cwd: app, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) { return null; } };
function writeHook() {
  const p = join(app, HOOK);
  if (existsSync(p) && !readFileSync(p, "utf8").includes(HOOK_MARK)) return "own";     // the app's own hook: left alone
  if (!existsSync(p) || readFileSync(p, "utf8") !== HOOK_TEXT) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, HOOK_TEXT);
    chmodSync(p, 0o755);
    return "written";
  }
  return "current";
}
function guardOn() { return appGit("config", "--get", "core.hooksPath") === ".githooks"; }
function guardNote() {
  if (appGit("rev-parse", "--git-dir") === null) return "";                          // not a git checkout: nothing to guard
  return guardOn() ? "" : "\n  note: this clone has NO pre-commit guard, so a trial copy could reach a commit. Switch it on:" +
    "\n        node tools/pull-core.mjs --guard";
}
if (guard) {
  const w = writeHook();
  if (appGit("config", "core.hooksPath", ".githooks") === null) { console.error("pull-core --guard: this app is not a git checkout"); process.exit(1); }
  console.log(`pull-core --guard: ${HOOK} ${w === "own" ? "is the app's own (left alone)" : w}; hooks switched on in this clone (core.hooksPath = .githooks)`);
  process.exit(0);
}
if (precommit) {
  const c = spawnSync(process.execPath, [join(app, SELF), "--check", "--pinned"], { stdio: "inherit", env: process.env });
  if (c.status !== 0 && c.status !== 3) process.exit(1);
  const wiring = join(app, "tests", "wiring.test.mjs");
  if (existsSync(wiring)) {
    const w = spawnSync(process.execPath, [wiring], { cwd: app, encoding: "utf8" });
    if (w.status !== 0) {
      console.error((w.stdout + w.stderr).split("\n").filter((l) => /FAIL/.test(l)).join("\n") || (w.stdout + w.stderr).slice(-2000));
      console.error("pre-commit: tests/wiring.test.mjs failed, commit stopped");
      process.exit(1);
    }
  }
  process.exit(0);
}

const git = (...a) => execFileSync("git", a, { cwd: core, stdio: ["ignore", "pipe", "ignore"] }).toString();
const atCommit = (commit, f) => { try { return git("show", commit + ":" + f); } catch (e) { return null; } };
const haveCore = existsSync(join(core, SELF));

// The header, in the file's own comment syntax. Line 2 holds the body's hash: a hand edit below it changes the body,
// not the recorded hash, and --check sees the difference.
function header(file, body, commit) {
  const l1 = `GENERATED from crunchyCore/${file} @ ${commit} by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.`;
  const l2 = `sha256 ${sha(body)}`;
  return file.endsWith(".css") ? `/* ${l1} */\n/* ${l2} */\n` : `// ${l1}\n// ${l2}\n`;
}
function split(text) {
  const lines = text.split("\n");
  const m = /sha256 ([0-9a-f]{64})/.exec(lines[1] || ""), c = /crunchyCore\/\S+ @ (\S+) by/.exec(lines[0] || "");
  if (!/GENERATED from crunchyCore\//.test(lines[0] || "") || !m) return null;
  return { hash: m[1], commit: c ? c[1] : "unknown", body: lines.slice(2).join("\n") };
}
function stampOf(file, body) {
  const m = file.endsWith(".css") ? /--[\w-]+-build:\s*(\d+)/.exec(body) : /^const \w+_BUILD = (\d+);/m.exec(body);
  return m ? Number(m[1]) : null;
}

// ---- --check ---------------------------------------------------------------------------------------------------
if (check) {
  const corrupt = [], behind = [], trial = [];
  for (const f of list) {
    if (!existsSync(join(app, f))) { corrupt.push(f + ": missing (run node tools/pull-core.mjs)"); continue; }
    const got = split(readFileSync(join(app, f), "utf8"));
    if (!got) { corrupt.push(f + ": has no pull-core header (not pulled, or the header was edited)"); continue; }
    if (sha(got.body) !== got.hash) { corrupt.push(f + ": edited by hand below the header (edit crunchyCore instead)"); continue; }
    if (!haveCore) continue;
    const pinned = /^[0-9a-f]{7,40}$/.test(got.commit);
    if (pinned) {
      const then = atCommit(got.commit, f);
      if (then === null) corrupt.push(`${f}: names crunchyCore@${got.commit}, which this core does not have (fetch it, or re-pull)`);
      else if (then !== got.body) corrupt.push(`${f}: is not crunchyCore/${f} at ${got.commit} (re-pull)`);
    } else trial.push(f);
    if (!pinned) continue;                              // a trial copy is newer than any commit, not behind one
    const head = atCommit("HEAD", f);
    if (head === null) corrupt.push(f + ": no longer in crunchyCore");
    else if (head !== got.body) behind.push(f);
  }
  const selfHead = haveCore ? atCommit("HEAD", SELF) : null;
  // the puller is behind only when the core's own copy is committed and this one differs (else it is a trial copy)
  if (selfHead !== null && selfHead !== readFileSync(join(app, SELF), "utf8") &&
      readFileSync(join(core, SELF), "utf8") === selfHead) behind.push(SELF);
  const notes = [];
  if (behind.length) notes.push(`${behind.length} behind crunchyCore (${behind.join(", ")}): run node tools/pull-core.mjs when you want them`);
  if (trial.length) notes.push(`${trial.length} from an uncommitted core (${trial.join(", ")}): re-pull once it is committed`);
  if (corrupt.length) { console.error("pull-core --check: " + corrupt.join("; ")); process.exit(1); }
  if (pinnedOnly && !strict && trial.length) {
    console.error(`pull-core --check --pinned: ${trial.length} core copies came from an UNCOMMITTED crunchyCore (${trial.join(", ")}).\n` +
      "Commit crunchyCore first, then run node tools/pull-core.mjs here, then commit this app.");
    process.exit(1);
  }
  if (strict && (behind.length || trial.length)) { console.error("pull-core --check --strict: " + notes.join("; ")); process.exit(1); }
  if (!haveCore) { console.log(`pull-core --check: ${list.length} copies intact; crunchyCore not found, the pin not verified`); process.exit(3); }
  console.log(`pull-core --check: ${list.length} copies intact` + (notes.length ? " · " + notes.join(" · ") : ", each the core's file at its commit, all current"));
  process.exit(0);
}

// ---- pull ------------------------------------------------------------------------------------------------------
if (!haveCore) { console.error("pull-core: no crunchyCore at " + core + " (set CRUNCHYCORE_DIR)"); process.exit(1); }

// A new puller first: write it and hand over to it, so this pull already follows its rules.
{
  const mine = readFileSync(join(app, SELF), "utf8"), theirs = readFileSync(join(core, SELF), "utf8");
  if (mine !== theirs && !process.env.PULL_CORE_HANDED_OVER) {
    writeFileSync(join(app, SELF), theirs);
    console.log("pull-core: a new puller came from crunchyCore; running it");
    const r = spawnSync(process.execPath, [join(app, SELF), ...args], { stdio: "inherit", env: { ...process.env, PULL_CORE_HANDED_OVER: "1" } });
    process.exit(r.status === null ? 1 : r.status);
  }
}

let commit;
try {
  commit = git("rev-parse", "--short", "HEAD").trim();
  const dirty = git("status", "--porcelain", "--", ...list, SELF, "CHANGELOG.md").trim();
  if (dirty) {
    if (!wip) {
      console.error("pull-core: crunchyCore has uncommitted changes to files this app takes:\n" + dirty +
        "\nCommit crunchyCore first, so this app depends on a commit. (Testing the core's work in progress? --wip.)");
      process.exit(1);
    }
    commit += "+uncommitted";
  }
} catch (e) { console.error("pull-core: crunchyCore is not a git checkout"); process.exit(1); }

// The changelog between the app's stamps and the core's, and any MIGRATION it crosses.
const changes = [], migrations = [];
{
  const log = existsSync(join(core, "CHANGELOG.md")) ? readFileSync(join(core, "CHANGELOG.md"), "utf8").split("\n") : [];
  const entries = [];                                   // { file, n, text }
  for (let i = 0; i < log.length; i++) {
    const m = /^- \*\*(\S+) (?:→|->) (\d+)/.exec(log[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < log.length && /^\s+\S/.test(log[j])) j++;
    entries.push({ file: m[1], n: Number(m[2]), text: log.slice(i, j).join("\n") });
  }
  for (const f of list) {
    if (!existsSync(join(core, f))) continue;
    const now = stampOf(f, readFileSync(join(core, f), "utf8"));
    // The app's stamp before this pull: its pulled copy's, else its OWN hand-made copy's (BGM had suite.js 3), else 0:
    // a FIRST adoption crosses every entry up to now, migrations included (CrunchyBGM found a first pull skipped them).
    const text = existsSync(join(app, f)) ? readFileSync(join(app, f), "utf8") : null;
    const mine = text === null ? null : split(text);
    const was = text === null ? 0 : mine ? stampOf(f, mine.body) : (stampOf(f, text) ?? 0);
    if (now === null || was === null || now <= was) continue;
    for (const e of entries) if (e.file === f && e.n > was && e.n <= now) {
      changes.push(e.text);
      if (/MIGRATION:/.test(e.text)) migrations.push(e.text);
    }
  }
}
if (migrations.length && !migrated) {
  console.error("pull-core: this pull crosses work THIS APP must do first. Nothing was written.\n\n" + migrations.join("\n\n") +
    "\n\nDo it, then: node tools/pull-core.mjs --migrated");
  process.exit(2);
}

const bad = [];
for (const f of list) {
  if (!existsSync(join(core, f))) { bad.push(f + ": not in crunchyCore"); continue; }
  const body = readFileSync(join(core, f), "utf8");
  mkdirSync(dirname(join(app, f)), { recursive: true });
  writeFileSync(join(app, f), header(f, body, commit) + body);
}
const moved = followWants(list.filter((f) => existsSync(join(core, f))));
const hookState = appGit("rev-parse", "--git-dir") === null ? "none" : writeHook();
if (hookState === "written") moved.push(HOOK + ": written (the suite's pre-commit guard)");
if (bad.length) { console.error("pull-core: " + bad.join("; ")); process.exit(1); }
console.log(`pull-core: ${list.length} files from crunchyCore @ ${commit}` + (moved.length ? "\n  " + moved.join("\n  ") : "") + guardNote());
if (changes.length) console.log("\nWhat changed (crunchyCore/CHANGELOG.md):\n" + changes.join("\n"));
process.exit(0);

function followWants(files) {
  const page = join(app, "index.html"), notes = [], unchecked = [];
  if (!existsSync(page)) return notes;
  const lines = readFileSync(page, "utf8").split("\n");
  let changed = false;
  for (const f of files) {
    const n = stampOf(f, readFileSync(join(core, f), "utf8"));
    if (n === null) continue;
    const css = f.endsWith(".css");
    // a DEPS row may put `want:` on one of the next lines (CrunchyBGM's do): look up to three lines on
    let i = -1;
    if (css) i = lines.findIndex((l) => l.includes('"' + f + ' is build "'));
    else {
      const at = lines.findIndex((l) => l.includes('file: "' + f + '"'));
      if (at >= 0) for (let k = at; k < Math.min(at + 4, lines.length); k++) {
        if (k > at && /file: "/.test(lines[k])) break;
        if (/want: \d+/.test(lines[k])) { i = k; break; }
      }
    }
    if (i < 0) { unchecked.push(`${f} ${n}`); continue; }
    const was = (css ? /wants (\d+)/ : /want: (\d+)/).exec(lines[i]);
    if (was && Number(was[1]) === n) continue;
    lines[i] = css ? lines[i].replace(/!== "\d+"/, '!== "' + n + '"').replace(/wants \d+/, "wants " + n)
                   : lines[i].replace(/want: \d+/, "want: " + n);
    changed = true;
    notes.push(`${f}: index.html want ${was ? was[1] : "?"} -> ${n}`);
  }
  if (changed) writeFileSync(page, lines.join("\n"));
  // one line, not one per file: an app may simply not check stamps (SFX); the stamps are listed for its own guard
  if (unchecked.length) notes.push(`index.html checks no stamp for: ${unchecked.join(", ")} (add a want, or ignore if this app has no stamp checks)`);
  return notes;
}
