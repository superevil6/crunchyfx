// CrunchySFX — do PLANTED sounds work inside a real Godot project?        node tests/godot-check.mjs
//
// The desktop suite proves planting over a mocked disk. This asks the CONSUMER (crunchyCore's tests/godot-plant.mjs and
// crunchyTile's godot-check are the models):
//   1. the real app plants sounds (tests/godot-plant.js inside the real index.html, headless Firefox, the Tauri mock),
//      in four export formats (two loop), plus v1.1's My Presets through "Plant my presets", and hands over the files;
//   2. they go into a scratch Godot 4 project at res://crunchy/sfx/, and Godot's own importer runs (--import);
//   3. the game loads every WAV as an AudioStreamWAV by its res:// path, with the sample rate, channels and length the
//      file says, and a loop for the files Export WAV marked with a loop point (smpl chunk);
//   4. the .crunchy sidecar is not a resource and gets no .import;
//   5. plant.js + SFX's project-app.js, on the REAL disk, read every sidecar back (none skipped), and a delete removes the
//      WAV with its .import, after which Godot no longer finds it.
// Needs a Godot 4 binary ($GODOT, else godot / godot4 / godot-mono on PATH) and Firefox; skips (exit 0) without Godot.
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const godot = [process.env.GODOT, "godot", "godot4", "godot-mono"].filter(Boolean).find((b) => {
  const r = spawnSync(b, ["--version"], { encoding: "utf8" });
  return r.status === 0 && /^4\./.test(r.stdout.trim());
});
if (!godot) { console.log("SKIP · no Godot 4 binary found (set $GODOT)"); process.exit(0); }

const ok = [], fail = [];
const t = (name, pass, why) => (pass ? ok : fail).push(name + (pass || !why ? "" : " — " + why));

// 1. the app plants, in Firefox
spawnSync("python3", [join(root, "tests/build.py"), "godot"], { stdio: "ignore" });
const prof = mkdtempSync(join(tmpdir(), "sfx-godot-ff-"));
writeFileSync(join(prof, "user.js"), 'user_pref("browser.dom.window.dump.enabled", true);\n');
const ff = spawnSync("firefox", ["--headless", "--profile", prof, "--window-size=1200,800", "--screenshot", join(prof, "shot.png"),
  "file://" + join(root, "tests/run-godot.html")], { encoding: "utf8", timeout: 300000, maxBuffer: 1 << 28 });
const planted = [];
for (const line of (ff.stdout || "").split("\n")) {
  const m = /^PLANTFILE (\S+) (\S*)$/.exec(line);
  if (m) planted.push({ rel: m[1], data: Buffer.from(m[2], "base64") });
}
const done = /PLANTDONE (\d+)/.exec(ff.stdout || "");
t("the app planted sounds through the planted Library", done && planted.length > 0, (ff.stdout || "").split("\n").filter((l) => /PLANTFAIL/.test(l)).join(" ") || "no output");
rmSync(prof, { recursive: true, force: true });

// 2. a scratch Godot project with the planted folder in it
const proj = mkdtempSync(join(tmpdir(), "sfx-godot-"));
writeFileSync(join(proj, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="crunchysfx-plant-check"\n');
for (const f of planted) { mkdirSync(dirname(join(proj, f.rel)), { recursive: true }); writeFileSync(join(proj, f.rel), f.data); }
const wavs = planted.filter((f) => /\.wav$/.test(f.rel)), sides = planted.filter((f) => /\.crunchy$/.test(f.rel));
t("every planted WAV has its sidecar beside it in crunchy/sfx/<slug>/", wavs.length >= 8 && sides.length === wavs.length &&
  sides.every((s) => { const slug = s.rel.split("/")[2]; return s.rel === "crunchy/sfx/" + slug + "/" + slug + ".crunchy"; }), wavs.length + " wavs, " + sides.length + " sidecars");

// what each WAV says about itself (fmt, data, smpl)
function wavInfo(b) {
  const out = { loop: false };
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString("latin1", o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === "fmt ") { out.channels = b.readUInt16LE(o + 10); out.rate = b.readUInt32LE(o + 12); out.bits = b.readUInt16LE(o + 22); }
    if (id === "data") out.bytes = n;
    if (id === "smpl") out.loop = b.readUInt32LE(o + 8 + 28) > 0;
    o += 8 + n + (n & 1);
  }
  out.frames = out.bytes / (out.channels * out.bits / 8);
  return out;
}
const expect = {};
for (const w of wavs) expect["res://" + w.rel] = wavInfo(w.data);

writeFileSync(join(proj, "check.gd"), `extends SceneTree
func _init():
	var out = {}
	for p in ${JSON.stringify(Object.keys(expect))}:
		var s = load(p)
		if s == null:
			out[p] = null
			continue
		out[p] = { "cls": s.get_class(), "rate": s.mix_rate, "stereo": s.stereo, "len": s.get_length(), "loop": s.loop_mode }
	for p in ${JSON.stringify(sides.map((s) => "res://" + s.rel))}:
		out[p] = { "resource": ResourceLoader.exists(p) }
	print("CHECK " + JSON.stringify(out))
	quit()
`);
const check = () => {
  spawnSync(godot, ["--headless", "--path", proj, "--import"], { encoding: "utf8", timeout: 180000 });
  const r = spawnSync(godot, ["--headless", "--path", proj, "--script", "res://check.gd"], { encoding: "utf8", timeout: 120000 });
  const m = /CHECK (\{.*\})/.exec(r.stdout || "");
  return m ? JSON.parse(m[1]) : { error: (r.stdout + r.stderr).slice(-800) };
};
const first = check();
if (process.env.VERBOSE) console.log(JSON.stringify(first, null, 1), JSON.stringify(expect, null, 1));
const bad = Object.keys(expect).filter((p) => {
  const g = first[p], e = expect[p];
  return !g || g.cls !== "AudioStreamWAV" || g.rate !== e.rate || g.stereo !== (e.channels === 2) || Math.abs(g.len - e.frames / e.rate) > 1e-3;
});
t("Godot imports every planted WAV and the game loads it by res:// path, with the file's rate, channels and length",
  !first.error && bad.length === 0, first.error || bad.map((p) => p + " " + JSON.stringify(first[p]) + " vs " + JSON.stringify(expect[p])).join(" | "));
const loops = Object.keys(expect).filter((p) => expect[p].loop);
t("a WAV saved with Loop on loops in Godot (the smpl chunk), the others do not",
  loops.length >= 2 && Object.keys(expect).every((p) => first[p] && (first[p].loop !== 0) === expect[p].loop),
  Object.keys(expect).map((p) => p.split("/").pop() + ":" + (first[p] && first[p].loop) + "/" + expect[p].loop).join(" "));
t("24-bit and 22 kHz mono exports import too", Object.values(expect).some((e) => e.bits === 24) && Object.values(expect).some((e) => e.rate === 22050 && e.channels === 1));
t("Godot leaves the .crunchy sidecars alone: no resource, no .import",
  sides.every((s) => first["res://" + s.rel] && first["res://" + s.rel].resource === false && !existsSync(join(proj, s.rel + ".import"))));
t("Godot made its own .import beside each WAV", wavs.every((w) => existsSync(join(proj, w.rel + ".import"))));

// 5. plant.js and SFX's adapter on the real disk
const nodeFs = {
  async exists(p) { return existsSync(p); },
  async readTextFile(p) { return readFileSync(p, "utf8"); },
  async readDir(p) { return readdirSync(p).map((name) => ({ name, isDirectory: statSync(join(p, name)).isDirectory() })); },
  async mkdir(p) { mkdirSync(p, { recursive: true }); },
  async writeTextFile(p, s) { writeFileSync(p, s); },
  async writeFile(p, b) { writeFileSync(p, b); },
  async remove(p) { if (existsSync(p) && statSync(p).isDirectory()) rmdirSync(p); else rmSync(p, { force: true }); },
};
const ctx = { console, TextEncoder, TextDecoder };
vm.createContext(ctx);
for (const f of ["project-app.js", "plant.js"]) vm.runInContext(readFileSync(join(root, f), "utf8"), ctx, { filename: f });
const P = await vm.runInContext("plantOpen", ctx)(nodeFs, proj);
t("plant.js with SFX's PROJECT_APP reads every sidecar back from the real disk", P.engine === "godot" && P.rel === "crunchy/sfx" &&
  P.assets.length === sides.length && P.skipped.length === 0, P.assets.length + " assets, skipped " + P.skipped.join(","));
const victim = P.assets[0], vdir = join(proj, "crunchy/sfx", victim.slug), vwav = join(vdir, victim.data.wav);
await vm.runInContext("plantDelete", ctx)(P, victim);
t("a delete removes the WAV, its .import and the sidecar, then the folder", !existsSync(vwav) && !existsSync(vwav + ".import") && !existsSync(vdir));
const second = check(), gone = "res://crunchy/sfx/" + victim.slug + "/" + victim.data.wav;
t("after a delete and a re-import, the game no longer finds that sound", second[gone] === null && Object.keys(expect).filter((p) => p !== gone).every((p) => second[p]),
  JSON.stringify(second[gone]));

rmSync(proj, { recursive: true, force: true });
for (const l of ok) console.log("ok   " + l);
for (const l of fail) console.log("FAIL " + l);
console.log(fail.length ? `\nFAIL · ${fail.length} of ${ok.length + fail.length}` : `\nPASS · ${ok.length} checks · ${wavs.length} planted sounds (${godot})`);
process.exit(fail.length ? 1 : 0);
