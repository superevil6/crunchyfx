// Generate og.png, the link-preview card (1200 × 630), with the app's own engine.   node tools/make-og.mjs
//
// Like CrunchyTile's card (its tools/make-og.mjs): drawn in code, pixel art doubled by nearest-neighbour so it stays
// crisp in a feed, no text (the title and description come from the og: tags in index.html). Four presets rendered by
// the SHIPPING synth (dsp.js + synth.js + presets.js, PARAMS' defaults sliced from index.html as tools/export-synth.py
// does), each as an oscilloscope trace in the scope's own colours (--wave orange, --sel cyan) on the suite's dark base
// (crunchy-base.css --bg / --panel), with the app's yellow accent.
//
// --check regenerates it in memory and compares with the file on disk.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
// PARAMS: the array literal from `const PARAMS = [` to its closing `];`
const p0 = html.indexOf("const PARAMS = ["), p1 = html.indexOf("\n];", p0);
if (p0 < 0 || p1 < 0) throw new Error("make-og: no PARAMS in index.html");
const ctx = { console, Math, Float32Array, Int16Array, Uint8Array, window: {} };
vm.createContext(ctx);
for (const f of ["dsp.js", "synth.js"]) vm.runInContext(readFileSync(join(root, f), "utf8"), ctx, { filename: f });
vm.runInContext(readFileSync(join(root, "presets.js"), "utf8"), ctx, { filename: "presets.js" });
// PARAMS names consts defined elsewhere in index.html (WAVES …): carry each one it asks for, as export-synth.py does
let deps = "";
for (let tries = 0; ; tries++) {
  // a fresh sandbox each try: a failed run still holds its `const PARAMS` (its name, uninitialised)
  const pc = vm.createContext({ Math });
  try { vm.runInContext(deps + html.slice(p0, p1 + 3) + "\nglobalThis.__PARAMS = PARAMS;", pc); ctx.__PARAMS = pc.__PARAMS; break; }
  catch (e) {
    const m = /^(\w+) is not defined/.exec(e.message), d = m && new RegExp("^const " + m[1] + " = [\\s\\S]*?;$", "m").exec(html);
    if (!d || tries > 40) throw e;
    deps += d[0] + "\n";
  }
}

// One preset's samples, left and right, normalised as the app plays it.
function render(name) {
  const st = {};
  for (const p of ctx.__PARAMS) st[p[0]] = p[5];
  Object.assign(st, ctx.window.PRESETS[name]);
  const out = ctx.renderPatch(st, {});
  return { L: out.L || out[0] || out.left, R: out.R || out[1] || out.right || out.L };
}

// ---- the picture: 600 × 315, an indexed palette ----------------------------------------------------------------
const W = 600, H = 315, SCALE = 2;
const PAL = ["#111015", "#1a1820", "#23202b", "#c25326", "#ff7a45", "#ffb08a", "#1f6f8b", "#45d0ff", "#ffd23f"];
const BG = 0, LANE = 1, GRID = 2, WDK = 3, WAVE = 4, WHI = 5, SDK = 6, SEL = 7, ACC = 8;
const px = new Uint8Array(W * H).fill(BG);
const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y * W + x] = v; };
const rect = (x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, v); };

// FOUR SCOPES, one sound each, zoomed to a window where its shape shows (a coin's square, a laser's saw, a cartoon
// boing's sine, an explosion's noise in wider columns), the sample at each 2 px column drawn as a stepped trace 3 px tall, the
// steps joined vertically, over a dotted grid and a centre line. The lanes alternate the scope's two channel colours.
const SR = ctx.SR || 44100;
// [preset, window start, end (s), column px]: four different shapes, square, saw, sine and noise
const LANES = [["Coin", 0.004, 0.030, 2], ["Laser", 0.010, 0.040, 2], ["Cartoon Boing", 0.020, 0.150, 2], ["Explosion", 0.020, 0.060, 4]];
const M = 18, GAP = 12, LH = Math.floor((H - 2 * M - GAP * (LANES.length - 1)) / LANES.length), ROW = 3;
LANES.forEach(([name, t0, t1, COL], i) => {
  const s = render(name), ch = s.L, y0 = M + i * (LH + GAP), x0 = M + 6, w = W - 2 * M - 6, mid = y0 + Math.floor(LH / 2);
  const [dk, br] = i % 2 ? [SDK, SEL] : [WDK, WAVE];
  rect(M, y0, W - 2 * M, LH, LANE);
  for (let x = x0; x < x0 + w; x += 6) for (let y = y0 + 3; y < y0 + LH; y += 6) put(x, y, GRID);
  for (let x = x0; x < x0 + w; x += 2) put(x, mid, GRID);
  const a0 = Math.floor(t0 * SR), a1 = Math.min(ch.length, Math.floor(t1 * SR)), cols = Math.floor(w / COL);
  let peak = 1e-9;
  for (let k = a0; k < a1; k++) peak = Math.max(peak, Math.abs(ch[k]));
  const amp = (LH / 2 - 5) / peak;
  let prev = null;
  for (let c = 0; c < cols; c++) {
    const v = ch[Math.min(a1 - 1, a0 + Math.floor(c * (a1 - a0) / cols))] || 0;
    const y = mid - Math.round(v * amp / ROW) * ROW, xs = x0 + c * COL;
    const lo = prev === null ? y : Math.min(prev, y), hi = prev === null ? y : Math.max(prev, y);
    for (let yy = lo; yy <= hi + ROW - 1; yy++) for (let k = 0; k < COL; k++) put(xs + k, yy, br);
    // a darker body between the trace and the centre line, so each wave reads as a filled shape
    for (let yy = Math.min(y + ROW, mid); yy < Math.max(y, mid); yy++) if (px[yy * W + xs] !== br) for (let k = 0; k < COL; k++) put(xs + k, yy, dk);
    prev = y;
  }
  rect(M, y0, 3, LH, ACC);                       // the lane's tab, in the app's yellow
});

// ---- PNG (indexed, no text chunks: byte-stable) ---------------------------------------------------------------
function png(w, h, data, pal) {
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = T[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 3;
  const plte = Buffer.from(pal.flatMap((hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16))));
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = data[y * w + x]; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("PLTE", plte), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const big = new Uint8Array(W * SCALE * H * SCALE);
for (let y = 0; y < H * SCALE; y++) for (let x = 0; x < W * SCALE; x++) big[y * W * SCALE + x] = px[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)];
const bytes = png(W * SCALE, H * SCALE, big, PAL);

const file = process.env.OG_OUT || join(root, "og.png");                    // OG_OUT: a draft elsewhere (absolute path)
if (process.argv.includes("--check")) {
  let same = false;
  try { same = readFileSync(file).equals(bytes); } catch (e) { same = false; }
  console.log(same ? "og.png matches the engine" : "STALE: og.png");
  process.exit(same ? 0 : 1);
}
writeFileSync(file, bytes);
console.log("wrote " + file + " (" + W * SCALE + " x " + H * SCALE + ")");
