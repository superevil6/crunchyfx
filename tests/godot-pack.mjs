// CrunchySFX — does a VARIATION PACK drop into a real Godot game in one step?        node tests/godot-pack.mjs
//
// The app (the real index.html, headless Firefox) makes a 6-take pack of a coin; its zip's files go into a scratch Godot
// 4 project in a SUBFOLDER (res://sounds/pickups/), Godot imports them, and the game loads hit.tres: an
// AudioStreamRandomizer holding exactly the 6 takes (its relative paths resolved from the subfolder), each an
// AudioStreamWAV, random with no repeats; an AudioStreamPlayer plays it; and the README tells you to do just that.
// Then the GODOT FOOTSTEP SET (2026-11-01): eleven packs named for the suite's surfaces, crunchy_footsteps.gd and
// footsteps.tscn in res://audio/footsteps/; the helper reads a TileMapLayer cell's "surface" custom data and plays its pack.
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

// ---- FOOTSTEPS BY SURFACE (2026-11-01): the Godot footstep set, from the same page run ----
// The suite's surface names (CrunchyTile writes them as each tile's "surface" custom data): fixed, lowercase, in order.
const SURFACES = ["grass", "dirt", "sand", "gravel", "stone", "wood", "metal", "snow", "ice", "water", "carpet"];
const foot = [];
for (const line of (ff.stdout || "").split("\n")) { const m = /^FOOTFILE (\S+) (\S*)$/.exec(line); if (m) foot.push({ name: m[1], data: Buffer.from(m[2], "base64") }); }
const fim = /^FOOTINFO (.*)$/m.exec(ff.stdout || ""), finfo = fim ? JSON.parse(fim[1]) : {};
t("the footstep set's surfaces are the suite's eleven names, in order, each with its preset",
  JSON.stringify(finfo.surfaces) === JSON.stringify(SURFACES) && finfo.presets === true, JSON.stringify(finfo));
t("a footsteps/ folder: <surface>.tres + 6 takes in <surface>/ for every surface, crunchy_footsteps.gd, footsteps.tscn, README",
  foot.length === SURFACES.length * 7 + 3 && SURFACES.every((s) => foot.some((f) => f.name === "footsteps/" + s + ".tres") &&
    foot.filter((f) => new RegExp("^footsteps/" + s + "/" + s + "_0[1-6]\\.wav$").test(f.name)).length === 6) &&
    ["crunchy_footsteps.gd", "footsteps.tscn", "README.txt"].every((n) => foot.some((f) => f.name === "footsteps/" + n)), foot.map((f) => f.name).slice(0, 12).join(" "));
t("the set is seeded: made twice, the same bytes", finfo.same === true);
t("its button sits in the Footsteps by surface section", finfo.button === true);
// every take is a footstep: short, a sharp attack, no long tail (read from the WAV's 16-bit PCM)
const wavStats = (buf) => {
  let o = 12, fmt = null, pcm = null;
  while (o + 8 <= buf.length) { const id = buf.toString("ascii", o, o + 4), sz = buf.readUInt32LE(o + 4); if (id === "fmt ") fmt = { ch: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) }; if (id === "data") pcm = buf.subarray(o + 8, o + 8 + sz); o += 8 + sz + (sz & 1); }
  const n = pcm.length / 2 / fmt.ch, env = [];
  let pk = 0, pkAt = 0;
  for (let i = 0; i < n; i++) { let a = 0; for (let c = 0; c < fmt.ch; c++) a = Math.max(a, Math.abs(pcm.readInt16LE((i * fmt.ch + c) * 2))); if (a > pk) { pk = a; pkAt = i; } env.push(a); }
  let last = 0; env.forEach((a, i) => { if (a > pk * 0.01) last = i; });   // -40 dB
  let on = 0; while (env[on] < pk * 0.25) on++;                             // within 12 dB of its peak
  return { ms: n / fmt.rate * 1000, onsetMs: on / fmt.rate * 1000, peakMs: pkAt / fmt.rate * 1000, endMs: last / fmt.rate * 1000, peak: pk / 32768 };
};
const takes = foot.filter((f) => /\.wav$/.test(f.name)).map((f) => Object.assign({ name: f.name }, wavStats(f.data)));
// (a loose surface's loudest grain may come later in the crunch, so the attack is measured to within 12 dB of the peak)
const bad = takes.filter((s) => !(s.ms <= 250 && s.onsetMs <= 20 && s.endMs <= 200 && s.peak > 0.05 && s.peak <= 0.75));
t("every take is a footstep: at most 250 ms long, within 12 dB of its peak in 20 ms, under -40 dB by 200 ms, peaks below -3 dBFS",
  takes.length === SURFACES.length * 6 && !bad.length, bad.slice(0, 4).map((s) => s.name + " " + JSON.stringify(s)).join("; "));
const fread = (n) => (foot.find((f) => f.name === "footsteps/" + n) || { data: Buffer.alloc(0) }).data.toString();
t("the README says how: play_at with the layer, the \"surface\" custom data (CrunchyTile's, or a String layer you add)",
  /\$Footsteps\.play_at\(\$TileMapLayer, global_position\)/.test(fread("README.txt")) && /Custom Data Layers/.test(fread("README.txt")) &&
  /name it surface, type String/.test(fread("README.txt")) && /CrunchyTile/.test(fread("README.txt")));
t("the helper says CC0", /CC0/.test(fread("crunchy_footsteps.gd")));

const proj2 = mkdtempSync(join(tmpdir(), "sfx-steps-godot-"));
try {
  writeFileSync(join(proj2, "project.godot"), 'config_version=5\n\n[application]\nconfig/name="steps"\n');
  for (const f of foot) { mkdirSync(dirname(join(proj2, "audio", f.name)), { recursive: true }); writeFileSync(join(proj2, "audio", f.name), f.data); }
  writeFileSync(join(proj2, "check.gd"), `extends SceneTree
const SURFACES := ${JSON.stringify(SURFACES)}
func tiles(with_layer: bool) -> TileSet:
	var ts := TileSet.new()
	ts.tile_size = Vector2i(16, 16)
	if with_layer:
		ts.add_custom_data_layer()
		ts.set_custom_data_layer_name(0, "surface")
		ts.set_custom_data_layer_type(0, TYPE_STRING)
	var src := TileSetAtlasSource.new()
	src.texture = ImageTexture.create_from_image(Image.create(48, 16, false, Image.FORMAT_RGBA8))
	src.texture_region_size = Vector2i(16, 16)
	ts.add_source(src, 0)
	for x in 3:
		src.create_tile(Vector2i(x, 0))
	if with_layer:
		src.get_tile_data(Vector2i(0, 0), 0).set_custom_data("surface", "gravel")
		src.get_tile_data(Vector2i(2, 0), 0).set_custom_data("surface", "stone")
	return ts
func _initialize() -> void:
	var out := {}
	out.packs = {}
	for s in SURFACES:
		var r = load("res://audio/footsteps/" + s + ".tres")
		var wavs := 0
		var paths_ok := true
		if r is AudioStreamRandomizer:
			for i in r.streams_count:
				var w = r.get_stream(i)
				if w is AudioStreamWAV: wavs += 1
				if w == null or w.resource_path != "res://audio/footsteps/%s/%s_%02d.wav" % [s, s, i + 1]: paths_ok = false
		out.packs[s] = [r.get_class() if r else "null", r.streams_count if r is AudioStreamRandomizer else 0, wavs, paths_ok, snappedf(r.random_pitch, 0.001) if r is AudioStreamRandomizer else 0.0]
	var gd = load("res://audio/footsteps/crunchy_footsteps.gd")
	out.script = gd is GDScript and gd.can_instantiate()
	var steps = (load("res://audio/footsteps/footsteps.tscn") as PackedScene).instantiate()
	get_root().add_child(steps)
	var layer := TileMapLayer.new()
	layer.tile_set = tiles(true)
	layer.position = Vector2(100, 40)
	get_root().add_child(layer)
	await process_frame
	layer.set_cell(Vector2i(2, 3), 0, Vector2i(0, 0))   # gravel
	layer.set_cell(Vector2i(5, 3), 0, Vector2i(1, 0))   # a tile with no surface
	var at := func(l: TileMapLayer, c: Vector2i) -> Vector2: return l.to_global(l.map_to_local(c))
	out.surface = steps.surface_at(layer, at.call(layer, Vector2i(2, 3)))
	out.played = steps.play_at(layer, at.call(layer, Vector2i(2, 3)))
	await process_frame
	out.stream = steps.player.stream.resource_path if steps.player.stream else ""
	out.playing = steps.player.playing
	out.empty = steps.play_at(layer, at.call(layer, Vector2i(9, 9)))
	out.untagged = steps.play_at(layer, at.call(layer, Vector2i(5, 3)))
	steps.default_surface = "stone"
	out.fallback = steps.play_at(layer, at.call(layer, Vector2i(5, 3)))
	out.fallback_stream = steps.player.stream.resource_path if steps.player.stream else ""
	steps.default_surface = ""
	var ground := TileMapLayer.new()
	ground.tile_set = layer.tile_set
	ground.position = layer.position
	get_root().add_child(ground)
	for x in 12:
		ground.set_cell(Vector2i(x, 3), 0, Vector2i(2, 0))   # stone everywhere
	out.layers_top = steps.play_at([ground, layer], at.call(layer, Vector2i(2, 3)))
	out.layers_under = steps.play_at([ground, layer], at.call(layer, Vector2i(7, 3)))
	var plain := TileMapLayer.new()
	plain.tile_set = tiles(false)
	get_root().add_child(plain)
	plain.set_cell(Vector2i(1, 1), 0, Vector2i(0, 0))
	out.no_layer = steps.play_at(plain, at.call(plain, Vector2i(1, 1)))
	out.by_name = steps.play_surface("water")
	print("STEPS " + JSON.stringify(out))
	quit()
`);
  spawnSync(godot, ["--headless", "--path", proj2, "--import"], { encoding: "utf8", timeout: 180000 });
  const r = spawnSync(godot, ["--headless", "--path", proj2, "--script", "res://check.gd"], { encoding: "utf8", timeout: 120000 });
  const log = (r.stdout || "") + (r.stderr || ""), m = /STEPS (\{.*\})/.exec(log), res = m ? JSON.parse(m[1]) : {};
  const packs = res.packs || {};
  t("Godot loads all eleven footsteps/<surface>.tres as AudioStreamRandomizers of 6 AudioStreamWAVs (random pitch 1.03), from res://audio/footsteps/",
    SURFACES.every((s) => packs[s] && packs[s][0] === "AudioStreamRandomizer" && packs[s][1] === 6 && packs[s][2] === 6 && packs[s][3] === true && packs[s][4] === 1.03),
    JSON.stringify(packs).slice(0, 400) + "\n" + log.split("\n").slice(-6).join("\n"));
  t("crunchy_footsteps.gd parses, and footsteps.tscn instantiates with it", res.script === true);
  t("a cell whose tile has surface \"gravel\": surface_at says gravel, play_at plays gravel.tres", res.surface === "gravel" && res.played === "gravel" &&
    res.stream === "res://audio/footsteps/gravel.tres" && res.playing === true, JSON.stringify({ surface: res.surface, played: res.played, stream: res.stream, playing: res.playing }));
  t("no tile, or a tile with no surface: quiet (\"\"); with Default Surface stone: stone.tres", res.empty === "" && res.untagged === "" &&
    res.fallback === "stone" && res.fallback_stream === "res://audio/footsteps/stone.tres", JSON.stringify(res));
  t("several layers: the topmost tile with a surface wins (gravel over stone; stone where the top is empty)", res.layers_top === "gravel" && res.layers_under === "stone");
  t("a TileSet with no \"surface\" layer: quiet, no error; play_surface(\"water\") by name", res.no_layer === "" && res.by_name === "water");
  t("no script errors", m && !/SCRIPT ERROR|ERROR:/.test(log), log.split("\n").filter((l) => /ERROR/.test(l)).slice(0, 6).join("\n"));
} finally { rmSync(proj2, { recursive: true, force: true }); }

for (const n of ok) console.log("ok   " + n);
for (const n of fail) console.log("FAIL " + n);
console.log(`\n${fail.length ? "FAIL" : "PASS"} · ${ok.length + fail.length} checks`);
process.exit(fail.length ? 1 : 0);
