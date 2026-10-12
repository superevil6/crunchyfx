// GENERATED from crunchyCore/tools/core-commit.mjs @ 6a77157 by tools/pull-core.mjs. DO NOT EDIT HERE: edit crunchyCore, then pull.
// sha256 b6c4079c03f7d6fa0bd316b85e7e3a47cad91b4948e079e2f0356a4e737a33de
// core-commit — commit and push crunchyCore, then pull it into this app: the core-first order in one step.
//
//   node tools/core-commit.mjs          (the VS Code task "Commit crunchyCore, then pull it here" runs this)
//
// A CORE FILE: canonical in crunchyCore/tools/, copied into each app by tools/pull-core.mjs. Run from the app.
//
// Why it exists (crunchyTile TILE-DESIGN.md §111): an app's pre-commit hook refuses copies pulled from an uncommitted
// core, so a change that spans the core and an app must go core first. AJ asked whether a hook could do that itself;
// a hook cannot ask, would sweep in whatever else is in the core, and could push the core and then fail the app. This
// does the same in the open: it SHOWS what will be committed, runs the core's tests, asks for the core's own message
// and a yes, then commits, pushes, and pulls. It stops at the first thing that fails, saying where it stopped.
//
// It never commits the APP: that stays yours, with your message, after this finishes. It never stages anything in the
// app either (index.html may hold your own unstaged work); the changed files show in the Source Control panel.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const core = process.env.CRUNCHYCORE_DIR || join(app, "..", "crunchyCore");

const run = (cmd, args, cwd, quiet) => spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: quiet ? "pipe" : "inherit" });
const out = (cmd, args, cwd) => { const r = run(cmd, args, cwd, true); return r.status === 0 ? r.stdout.trim() : null; };
const stop = (why) => { console.error("\n✗ " + why); process.exit(1); };
const step = (s) => console.log("\n── " + s);

if (!existsSync(join(core, "tools", "pull-core.mjs"))) stop("no crunchyCore at " + core + " (set CRUNCHYCORE_DIR)");
if (!existsSync(join(app, "tools", "pull-core.mjs"))) stop("this app has no tools/pull-core.mjs: copy it in from crunchyCore/tools/ first");

const status = out("git", ["status", "--porcelain"], core);
if (status === null) stop("crunchyCore is not a git checkout");

if (status) {
  step("crunchyCore has these changes:");
  run("git", ["status", "--short"], core);
  run("git", ["diff", "--stat"], core);

  step("Running the core's tests");
  if (run(process.execPath, ["tests/core.test.mjs"], core, true).status !== 0) {
    run(process.execPath, ["tests/core.test.mjs"], core);
    stop("the core's tests fail; nothing was committed");
  }
  console.log("   passed");

  // One reader and a queue of lines: readline's own question() loses a line that arrives before it is asked (answers
  // pasted or piped in together), and an ended input answers "" rather than hanging.
  const lines = [], waiting = [];
  let ended = false;
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
  rl.on("close", () => { ended = true; while (waiting.length) waiting.shift()(""); });
  const ask = (q) => { process.stdout.write(q); return lines.length ? Promise.resolve(lines.shift()) : ended ? Promise.resolve("") : new Promise((r) => waiting.push(r)); };
  const msg = (await ask("\nA commit message for crunchyCore (what changed in the CORE), or empty to stop: ")).trim();
  if (!msg) { rl.close(); stop("no message: nothing was committed"); }
  const yes = (await ask("Commit ALL of the above to crunchyCore and push it? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (yes !== "y" && yes !== "yes") stop("not confirmed: nothing was committed");

  step("Committing crunchyCore (its pre-commit hook runs)");
  if (run("git", ["add", "-A"], core).status !== 0) stop("git add failed in crunchyCore");
  if (run("git", ["commit", "-m", msg], core).status !== 0) stop("the crunchyCore commit failed (see above); nothing was pushed");
} else {
  console.log("crunchyCore has nothing uncommitted.");
}

step("Pushing crunchyCore");
const ahead = out("git", ["rev-list", "--count", "@{u}..HEAD"], core);
if (ahead === "0") console.log("   already pushed");
else if (run("git", ["push"], core).status !== 0)
  stop("the push failed. crunchyCore is committed locally; push it (VS Code, or git push in crunchyCore), then run this again");

step("Pulling crunchyCore into this app");
const pulled = run(process.execPath, [join(app, "tools", "pull-core.mjs")], app);
if (pulled.status === 2) stop("the pull crosses a MIGRATION (printed above): do it, then run node tools/pull-core.mjs --migrated");
if (pulled.status !== 0) stop("the pull failed (see above)");

step("Done");
const changed = out("git", ["status", "--short"], app);
console.log("crunchyCore is committed and pushed, and this app holds it. Commit this app as usual:" +
  (changed ? "\n" + changed : " (nothing changed here)"));
