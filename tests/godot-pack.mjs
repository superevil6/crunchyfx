// CrunchySFX — does a VARIATION PACK drop into a real Godot game in one step?        node tests/godot-pack.mjs
//
// The app (the real index.html, headless Firefox) makes a 6-take pack of a coin; its zip's files go into a scratch Godot
// 4 project in a SUBFOLDER (res://sounds/pickups/), Godot imports them, and the game loads hit.tres: an
// AudioStreamRandomizer holding exactly the 6 takes (its relative paths resolved from the subfolder), each an
// AudioStreamWAV, random with no repeats; an AudioStreamPlayer plays it; and the README tells you to do just that.
// Needs a Godot 4 binary ($GODOT, else godot / godot4 / godot-mono on PATH) and Firefox; skips (exit 0) without Godot.
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const godot = [process.env.GODOT, "godot", "godot4", "godot-mono"].filter(Boolean).find((b) => {
  const r = spawnSync(b, ["--version"], { encoding: "utf8" });
  return r.status === 0 && /^4\./.test(r.stdout.trim());
});
if (!godot) { console.log("SKIP · no Godot 4 binary found (set $GODOT)"); process.exit(0); }
const ok = [], fail = [];
const t = (name, pass, why) => (pass ? ok : fail).push(name + (pass || !why ? "" : " — " + why));

spawnSync("python3", [join(root, "tests/build.py"), "pack"], { stdio: "ignore" });
const prof = mkdtempSync(join(tmpdir(), "sfx-pack-ff-"));
writeFileSync(join(prof, "user.js"), 'user_pref("browser.dom.window.dump.enabled", true);\n');
const ff = spawnSync("firefox", ["--headless", "--profile", prof, "--window-size=1200,800", "--screenshot", join(prof, "shot.png"),
  "file://" + join(root, "tests/run-pack.html")], { encoding: "utf8", timeout: 300000, maxBuffer: 1 << 28 });
rmSync(prof, { recursive: true, force: true });
const files = [];
for (const line of (ff.stdout || "").split("\n")) { const m = /^PACKFILE (\S+) (\S*)$/.exec(line); if (m) files.push({ name: m[1], data: Buffer.from(m[2], "base64") }); }
const err = (ff.stdout || "").split("\n").find((l) => l.startsWith("PACKERROR"));
t("the app makes a pack: 6 takes, hit.tres and a README", !err && files.filter((f) => /^hit_\d+\.wav$/.test(f.name)).length === 6 && files.some((f) => f.name === "hit.tres") && files.some((f) => f.name === "README.txt"), err || files.map((f) => f.name).join(" "));
const readme = (files.find((f) => f.name === "README.txt") || { data: Buffer.alloc(0) }).data.toString();
t("the README says: drag hit.tres onto an AudioStreamPlayer's Stream, then play()", /drag hit\.tres onto its Stream/.test(readme) && /\$AudioStreamPlayer\.play\(\)/.test(readme));

const proj = mkdtempSync(join(tmpdir(), "sfx-pack-godot-"));
try {
  writeFileSync(join(proj, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="pack"\n');
  mkdirSync(join(proj, "sounds/pickups"), { recursive: true });
  for (const f of files) writeFileSync(join(proj, "sounds/pickups", f.name), f.data);
  writeFileSync(join(proj, "check.gd"), `extends SceneTree
func _initialize() -> void:
	var out := {}
	var r = load("res://sounds/pickups/hit.tres")
	out.type = r.get_class() if r else "null"
	if r is AudioStreamRandomizer:
		out.count = r.streams_count
		out.mode = r.playback_mode
		out.pitch = r.random_pitch
		out.paths = []
		out.wavs = 0
		for i in r.streams_count:
			var s = r.get_stream(i)
			if s is AudioStreamWAV: out.wavs += 1
			out.paths.append(s.resource_path if s else "")
		var p := AudioStreamPlayer.new()
		p.stream = r
		get_root().add_child(p)
		await process_frame
		p.play()
		await process_frame
		await process_frame
		out.playing = p.playing
	print("PACK " + JSON.stringify(out))
	quit()
`);
  spawnSync(godot, ["--headless", "--path", proj, "--import"], { encoding: "utf8", timeout: 120000 });
  const r = spawnSync(godot, ["--headless", "--path", proj, "--script", "res://check.gd"], { encoding: "utf8", timeout: 120000 });
  const log = (r.stdout || "") + (r.stderr || ""), m = /PACK (\{.*\})/.exec(log), res = m ? JSON.parse(m[1]) : {};
  t("Godot loads hit.tres as an AudioStreamRandomizer", res.type === "AudioStreamRandomizer", log.split("\n").slice(-8).join("\n"));
  t("it holds the 6 takes, each an AudioStreamWAV, found from its subfolder by the relative paths",
    res.count === 6 && res.wavs === 6 && (res.paths || []).every((p, i) => p === "res://sounds/pickups/hit_0" + (i + 1) + ".wav"), JSON.stringify(res.paths));
  t("random without repeats, pitch neutral (the takes already differ)", res.mode === 0 && res.pitch === 1);
  t("an AudioStreamPlayer plays it", res.playing === true);
  t("no errors loading it", !/ERROR|SCRIPT ERROR/.test(log), log.split("\n").filter((l) => /ERROR/.test(l)).slice(0, 4).join("\n"));
} finally { rmSync(proj, { recursive: true, force: true }); }

for (const n of ok) console.log("ok   " + n);
for (const n of fail) console.log("FAIL " + n);
console.log(`\n${fail.length ? "FAIL" : "PASS"} · ${ok.length + fail.length} checks`);
process.exit(fail.length ? 1 : 0);
