/* fire-redo.mjs — the FIRE presets redesigned as layered fire: a combustion ROAR, a CRACKLE of pops, a HISS, and the
 * event that makes each name what it is (a catch, a surge, a sear, a pass). PROPOSAL / A-B material: nothing here is
 * wired into presets.js; AJ listens to the labeled before/after WAVs and keeps what is better.
 *
 *   node tools/proto/fire-redo.mjs            renders every sound (now + new), measures, writes WAVs + KEY.md + JSON
 *   node tools/proto/fire-redo.mjs ref        measures only today's 28 fire presets (the level bar and today's spread)
 *   node tools/proto/fire-redo.mjs sep        separation only (renders the new ones, prints every close pair, writes nothing)
 *   node tools/proto/fire-redo.mjs <slug>     one sound, measured, written (no JSON, no all-new.wav)
 *   node tools/proto/fire-redo.mjs try '<patch json>'   measure one patch, nothing written
 *   node tools/proto/fire-redo.mjs x '<js>' ...     measure patches built with the voices below (roar(), crackle(), sound() ...)
 *
 * WHAT FIRE IS, and which engine plays each part (every one an existing engine; layers, never the formant engine):
 *   ROAR     broadband turbulent combustion, low-mid, with slow random swells and a 4-12 Hz flicker. The WEATHER engine's
 *            wind (wave 29, wxType 0) is exactly that model: noise in a band whose CENTRE and LEVEL follow a speed (the amp
 *            envelope x a seeded gust curve x a flutter), low buffeting under it (wxBody), and an edge hiss when the air is
 *            strongest. Driven by the envelope, so a flare BRIGHTENS as it surges, which is what burning more fuel does.
 *            It is layer 1 of every sound that has one, so the Duration slider stretches (DUR_STRETCH has 29) and
 *            Variations (which vary layer 1 only) re-roll the fire's swells through `wxSeed`.
 *   CRACKLE  sparse sharp pops from resin and moisture, random in time and level: the PARTICLE engine (wave 15) at a low
 *            rate with a high spread (its amplitude skew pow(rnd, 1 + 4 spread) is what makes a few loud pops among quiet
 *            ticks), a short decay (2-14 ms) and a mid-high tone. Its rate cannot go under 5/s (the row's minimum), so a
 *            sparse fire is sparse through the spread (few of the 5 are loud), not the rate.
 *   HISS     high narrowband noise, gas and steam escaping: the particle engine again, dense (150-200/s), bright, short,
 *            high-passed. The sizzle of a sear is the same layer with an envelope.
 *   EVENTS   the catch of an IGNITE is a soft deflagration "foomp": the BLAST engine (wave 31) at a small size with its
 *            Weight stretched (a long, low pressure pulse rather than a crack) and its fireball ROAR at full; a FLARE's
 *            surge and a WHOOSH's pass are the WHOOSH engine (wave 20, a band whose centre and level swell together); a
 *            SCORCH's sear is the sizzle with a fast attack; a MATCH's scratch is the FRICTION engine (wave 34) dragged
 *            fast and rough; MOLTEN fuel adds the BUBBLE engine's slow, low gloops; a DRAGON's breath carries a CREATURE
 *            (wave 28) growl under the jet.
 *
 * THE FAMILY (Searing Blaze ... Ashen Whoosh) is composed from two tables, the approach of creature-redo-family.mjs:
 *   ADJ  = the fire's CHARACTER: heat (how bright the roar, how much hiss), size (how strong and how low), crackle density
 *          and pitch, smoke (how muffled), unsteadiness (gusts), guttering (flicker drop-outs), grit, rumble, space, tempo,
 *          and a fuel layer (Molten's gloops)
 *   NOUN = the EVENT's SHAPE: which event layer it has, the roar's envelope (a catch then a bloom; a surge and fall; a
 *          steady burn; a big or a small sustained fire; a sear; a pass), and how crackle and hiss follow it
 * and compose() is the only place they meet. A collision between two names is a table entry not doing its job.
 *
 * Renders with the EXPORTED engine (synth-export/crunchysfx-synth.js) in a node vm, as tools/make-ab.mjs does, Normalize
 * ON and NOT loudness-matched: each WAV is what the app's button plays. The one per-name number not from a design is
 * `gain` on layer 1, a trim that lands the integrated loudness on today's Fire-section median (plus a stated per-sound
 * offset where a sound should sit lower or higher by design); a Limiter is added only where gain 1 cannot reach it.
 *
 * Writes soundtests/fire-redo/<slug>-1-now.wav, <slug>-2-new.wav (+ -alt<N>.wav), all-new.wav + KEY.md, and
 * tools/new-presets/fire-redo.json ({ name: patch with _vary, optional _alts and layers }).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = createContext({ console, Math, JSON, Float32Array, Float64Array, Int16Array, Uint8Array, Uint32Array, Int8Array,
  Int32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, isNaN, parseFloat, parseInt, atob: (s) => Buffer.from(s, "base64").toString("binary") });
ctx.window = ctx; ctx.globalThis = ctx;
runInContext(readFileSync(join(ROOT, "synth-export", "crunchysfx-synth.js"), "utf8"), ctx, { filename: "crunchysfx-synth.js" });
const CS = runInContext("CrunchySynth", ctx), SR = CS.SR;
const pctx = createContext({ window: {} });
runInContext(readFileSync(join(ROOT, "presets.js"), "utf8"), pctx);
const PRESETS = pctx.window.PRESETS, CATS = pctx.window.PRESET_CATEGORIES;

const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const median = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2])) : NaN; };
// a stable small seed per name (so a take is the same take on every run)
const seedOf = (s, salt = 0) => { let h = 2166136261 ^ salt; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % 997 + 1; };

// ============================================================================================================
// THE SCOPE (exact names; section order). The four filed elsewhere stay where they are.
const FIRE_SECTION = CATS.find((c) => c[0] === "Fire")[1];
const ELSEWHERE = ["Campfire Crackle", "Crackling Fire", "Dragon Fire Breath", "Fireball Cast"];
const ALL = FIRE_SECTION.concat(ELSEWHERE);
const FAMILY = ["Searing Blaze", "Searing Torch", "Kindled Ignite", "Kindled Flare", "Smoldering Ignite", "Searing Flare", "Blazing Torch",
  "Searing Ignite", "Kindled Flame", "Molten Scorch", "Infernal Flare", "Molten Flame", "Ashen Whoosh"];

// ============================================================================================================
// THE LAYER VOICES (each a full patch; the chassis numbers that every layer shares are stated once here)
//   every layer: drive 0 unless asked (the default 0.1 is a tanh(5x) the fire did not ask for), reso 0
function roar(o) {   // the combustion roar: weather wind
  const p = { wave: 29, wxType: 0, wxIntensity: r2(o.int), wxGust: r2(o.gust), wxGustRate: r2(o.gustRate), wxTone: r2(o.tone),
    wxBody: r2(o.body), wxWhistles: 0, wxWhistle: 0, wxSeed: o.seed, width: o.width ?? 0.6,
    attack: r3(o.atk), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus), release: r3(o.rel), duration: r2(o.dur),
    filterMode: 0, cutoff: Math.round(o.cut || 18000), reso: 0, drive: r2(o.drive || 0) };
  if (o.drive) p.driveOS = 2;
  if (o.flicker) { p.flicker = r2(o.flicker); p.flickerRate = r2(o.flickerRate || 12); }
  if (o.boom) Object.assign(p, { boom: r2(o.boom), boomFreq: Math.round(o.boomFreq || 50), boomDrop: r2(o.boomDrop ?? 0.4), boomDecay: r2(o.boomDecay || 0.8) });
  if (o.reverb) Object.assign(p, { reverb: r2(o.reverb), reverbSize: r2(o.reverbSize ?? 0.6), reverbTone: r2(o.reverbTone ?? 0.4) });
  return p;
}
// DRIVE IS WHAT MAKES A CRACKLE AUDIBLE UNDER A ROAR (measured: fire-redo.mjs x). The particle engine skews its pops'
// amplitudes as pow(rnd, 1 + 4 spread), and a layer is peak-normalised, so undriven the loudest pop sets the level and
// the rest sit 15-30 dB under it: over the Fire roar, 14 pops/s at spread 0.6-0.8 read 0.4 audible pops/s (2 ms frames
// 9 dB over their 60 ms surroundings) undriven, 5.6-9.3/s at drive 0.3-0.5. Drive 0.3 (tanh(13x)) is the default:
// it evens the pops into snaps of one family while the spread still decides how many are loud.
function crackle(o) {   // resin and moisture pops: sparse particle
  const p = { wave: 15, particleRate: Math.round(cl(o.rate, 5, 200)), particleTone: r2(cl(o.tone, 0, 1)), particleDecay: r2(cl(o.decay, 0, 1)),
    particleSpread: r2(cl(o.spread ?? 0.9, 0, 1)), attack: r3(o.atk ?? 0.02), hold: r3(o.hold || 0), decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1),
    release: r3(o.rel ?? 0.2), duration: r2(o.dur), filterMode: o.hp ? 1 : 0, cutoff: Math.round(o.hp || o.cut || 12000), reso: 0, drive: r2(o.drive ?? 0.3),
    width: o.width ?? 0.8 };
  if (o.reverb) Object.assign(p, { reverb: r2(o.reverb), reverbSize: r2(o.reverbSize ?? 0.5), reverbTone: r2(o.reverbTone ?? 0.5) });
  return p;
}
function hiss(o) {     // gas and steam: dense bright particle, high-passed
  return crackle(Object.assign({ spread: 0.35, hp: o.hp || 2500, drive: 0 }, o));
}
function foomp(o) {    // the catch: a small deflagration (blast), Weight-stretched, its fireball roar at full
  return { wave: 31, blastSize: r2(o.size), blastDist: Math.round(o.dist || 4), blastEnv: o.env ?? 0, blastRoom: r2(o.room ?? 0.3), blastTail: r2(o.tail ?? 0.4),
    blastPulse: r2(o.pulse ?? 4), blastShape: r2(o.shape ?? 1), blastRoar: r2(o.roar ?? 1), blastRumble: r2(o.rumble ?? 0.3), blastDebris: 0,
    blastSeed: o.seed, blastPeak: r2(o.peak ?? 0.5), width: o.width ?? 0.6, attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.06,
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0.31, drive: 0, reverb: 0, duration: r2(o.dur || 0.8) };
}
function swish(o) {    // a surge or a pass: the whoosh engine
  return { wave: 20, whooshTone: r2(o.tone), whooshSweep: r2(o.sweep), whooshBody: r2(o.body ?? 0.2), whooshPeak: r2(o.peak),
    attack: 0.001, hold: 0, decay: 0, sustain: 1, release: r3(o.rel ?? 0.05), duration: r2(o.dur), noise: r2(o.noise || 0),
    filterMode: 0, cutoff: Math.round(o.cut || 12000), reso: 0, drive: r2(o.drive || 0), width: o.width ?? 0.6 };
}
function gloop(o) {    // molten fuel: slow low bubbles
  return { wave: 14, freq: Math.round(o.freq), bubbleRate: Math.round(o.rate), bubbleRise: r2(o.rise ?? 0.5), bubbleSpread: r2(o.spread ?? 0.45),
    bubbleDecay: r2(o.decay ?? 0.65), attack: r3(o.atk ?? 0.05), hold: 0, decay: r3(o.dec || 0), sustain: r2(o.sus ?? 1), release: r3(o.rel ?? 0.3),
    duration: r2(o.dur), filterMode: 0, cutoff: Math.round(o.cut || 3000), reso: 0, drive: r2(o.drive ?? 0.25), driveOS: 2, width: 0.6 };
}
// A sound = layer 1's patch + layers 2-4 as the JSON string the app stores ({ s, d, g, p: 0 })
function sound(base, extra, master) {
  const p = Object.assign({}, base, master || {});
  const ls = extra.filter(Boolean).map(([s, d, g]) => ({ s, d: r3(d), g: r2(g), p: 0 }));
  if (ls.length > 3) throw new Error("more than 4 layers");
  if (ls.length) p.layers = JSON.stringify(ls);
  return p;
}

// ============================================================================================================
// MEASUREMENT (loudness as tools/proto/new-wings-coil.mjs)
function biquad(x, b0, b1, b2, a0, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}
function kweight(x) {
  const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, c = Math.cos(w), al = Math.sin(w) / (2 / Math.SQRT2), sa = 2 * Math.sqrt(A) * al;
  const s = biquad(x, A * ((A + 1) + (A - 1) * c + sa), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sa),
    (A + 1) - (A - 1) * c + sa, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sa);
  const w2 = 2 * Math.PI * 38 / SR, c2 = Math.cos(w2), al2 = Math.sin(w2) / (2 * 0.5);
  return biquad(s, (1 + c2) / 2, -(1 + c2), (1 + c2) / 2, 1 + al2, -2 * c2, 1 - al2);
}
function lufs(L, R) {
  const kl = kweight(L), kr = kweight(R), B = Math.round(0.4 * SR), H = Math.round(0.1 * SR), ms = [];
  const block = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += kl[i] * kl[i] + kr[i] * kr[i]; return s / (b - a); };
  if (L.length <= B) ms.push(block(0, L.length));
  else for (let a = 0; a + B <= L.length; a += H) ms.push(block(a, a + B));
  const l = (m) => -0.691 + 10 * Math.log10(m || 1e-12);
  let g = ms.filter((m) => l(m) > -70);
  if (!g.length) return -70;
  const rel = l(g.reduce((t, m) => t + m, 0) / g.length) - 10;
  g = g.filter((m) => l(m) > rel);
  return l(g.reduce((t, m) => t + m, 0) / g.length);
}
// one 2048-sample Hann DFT on 128 bins: centroid, and the energy in three bands (< 250 Hz rumble, 250 Hz - 2 kHz roar body,
// > 4 kHz hiss) as shares of the whole
const SPN = 2048, SPK = 160, SPC = [], SPS = [], SPH = new Float64Array(SPN);
for (let i = 0; i < SPN; i++) SPH[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SPN - 1));
for (let k = 1; k < SPK; k++) { const w = 2 * Math.PI * (k * 100) / SR, c = new Float64Array(SPN), s = new Float64Array(SPN); for (let i = 0; i < SPN; i++) { c[i] = Math.cos(w * i); s[i] = Math.sin(w * i); } SPC.push(c); SPS.push(s); }
function spectrum(x, a) {   // bins every 100 Hz to 16 kHz
  let num = 0, den = 0, lo = 0, hi = 0;
  const v = new Float64Array(SPN); for (let i = 0; i < SPN; i++) v[i] = x[a + i] * SPH[i];
  for (let k = 1; k < SPK; k++) {
    const f = k * 100, C = SPC[k - 1], S = SPS[k - 1]; let re = 0, im = 0;
    for (let i = 0; i < SPN; i++) { re += v[i] * C[i]; im -= v[i] * S[i]; }
    const m = re * re + im * im; num += f * m; den += m;
    if (f < 250) lo += m; if (f > 4000) hi += m;
  }
  return { cent: den > 0 ? num / den : 0, lo: den > 0 ? lo / den : 0, hi: den > 0 ? hi / den : 0, e: den };
}
function render(patch) {
  const p = Object.assign({}, patch); delete p._vary; delete p._alts;
  const r = CS.render(Object.assign({}, CS.DEFAULTS, p), { normalize: true });
  return { L: Float32Array.from(r.L), R: Float32Array.from(r.R) };
}
function measure(r) {
  const { L, R } = r, n = L.length;
  let pk = 0, sl = 0, sr = 0, clip = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); pk = Math.max(pk, a, b); sl += L[i]; sr += R[i]; if (a >= 0.999 || b >= 0.999) clip++; }
  const mono = Float64Array.from(L, (v, i) => 0.5 * (v + R[i]));
  // audible span: 10 ms blocks over -60 dB of the peak
  const B = Math.round(0.01 * SR); let last = 0, first = -1;
  for (let a = 0; a < n; a += B) { let m = 0; for (let i = a; i < Math.min(n, a + B); i++) m = Math.max(m, Math.abs(mono[i])); if (m > pk * 0.001) { last = a + B; if (first < 0) first = a; } }
  const span = Math.max(0.02, (Math.min(n, last) - Math.max(0, first)) / SR);
  // 50 ms level envelope (dB): where the loudness peaks, how fast it gets there, how much is left at 80% of the span
  const E = Math.round(0.05 * SR), env = [];
  for (let a = 0; a + E <= n; a += E) { let s = 0; for (let i = a; i < a + E; i++) s += mono[i] * mono[i]; env.push(10 * Math.log10(s / E + 1e-12)); }
  const mx = Math.max(...env), imx = env.indexOf(mx), f0 = Math.max(0, Math.floor(first / E));
  for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], mx - 50);   // silence counts as -50 dB, not -120
  let iatk = f0; while (iatk < imx && env[iatk] < mx - 3) iatk++;
  const atk = Math.max(0.025, (iatk - f0 + 0.5) * 0.05);
  const i80 = Math.min(env.length - 1, Math.floor((first + 0.8 * span * SR) / E)), end80 = env[i80] - mx;
  // SWELL: the slow level movement, the 50 ms level against its own 500 ms average over the part within 20 dB of the max
  let ws = 0, wn = 0;
  for (let i = 5; i < env.length - 5; i++) { if (env[i] < mx - 20) continue; let av = 0; for (let j = i - 5; j <= i + 5; j++) av += env[j]; av /= 11; ws += (env[i] - av) ** 2; wn++; }
  const swell = wn ? Math.sqrt(ws / wn) : 0;
  // TEXTURE: the fast level movement (5 ms level against its 100 ms average) -- crackle and flutter
  const E5 = Math.round(0.005 * SR), e5 = [];
  for (let a = 0; a + E5 <= n; a += E5) { let q = 0; for (let i = a; i < a + E5; i++) q += mono[i] * mono[i]; e5.push(10 * Math.log10(q / E5 + 1e-12)); }
  const m5 = Math.max(...e5); let ts = 0, tn = 0;
  for (let i = 0; i < e5.length; i++) e5[i] = Math.max(e5[i], m5 - 40);   // the gaps between pops count as -40 dB
  for (let i = 10; i < e5.length - 10; i++) { if (e5[i] < m5 - 30) continue; let av = 0; for (let j = i - 10; j <= i + 10; j++) av += e5[j]; av /= 21; ts += (e5[i] - av) ** 2; tn++; }
  const texture = tn ? Math.sqrt(ts / tn) : 0;
  // POPS: on the signal HIGH-PASSED at 1.5 kHz (a pop is broadband, the roar low-mid: the ear hears a crackle over a low
  // roar because they sit in different bands, and a broadband detector would call every pop over a big roar masked),
  // 2 ms frames standing 9 dB over the median of the 60 ms around them, within 36 dB of the loudest frame, at least
  // 8 ms apart -- the crackle a listener counts. Per second of the audible span.
  const hpw = Math.tan(Math.PI * 1500 / SR), hpk = Math.SQRT2, ha1 = 1 / (1 + hpw * (hpw + hpk)), ha2 = hpw * ha1, ha3 = hpw * ha2;
  let hc1 = 0, hc2 = 0; const hpx = new Float64Array(n);
  for (let i = 0; i < n; i++) { const v3 = mono[i] - hc2, v1 = ha1 * hc1 + ha2 * v3, v2 = hc2 + ha2 * hc1 + ha3 * v3; hc1 = 2 * v1 - hc1; hc2 = 2 * v2 - hc2; hpx[i] = mono[i] - hpk * v1 - v2; }
  const E2 = Math.round(0.002 * SR), e2 = [];
  for (let a = 0; a + E2 <= n; a += E2) { let q = 0; for (let i = a; i < a + E2; i++) q += hpx[i] * hpx[i]; e2.push(10 * Math.log10(q / E2 + 1e-12)); }
  const m2 = Math.max(...e2); let pops = 0, lastPop = -99;
  for (let i = 15; i < e2.length - 15; i++) {
    if (e2[i] < m2 - 36 || i - lastPop < 4) continue;
    if (e2[i] < e2[i - 1] || e2[i] < e2[i + 1]) continue;
    const md = median(e2.slice(i - 15, i + 16));
    if (e2[i] > md + 9) { pops++; lastPop = i; }
  }
  // SPECTRUM: energy-weighted over the loud part (within 20 dB of the max), every 50 ms
  let cn = 0, cd = 0, lo = 0, hi = 0;
  for (let a = 0; a + 2048 < n; a += Math.round(0.05 * SR)) {
    let e = 0; for (let i = a; i < a + 2048; i++) e += mono[i] * mono[i];
    if (10 * Math.log10(e / 2048 + 1e-12) < mx - 20) continue;
    const s = spectrum(mono, a); cn += s.cent * e; lo += s.lo * e; hi += s.hi * e; cd += e;
  }
  return { sec: n / SR, span, onset: Math.max(0, first) / SR, peak: pk, clip, dcL: sl / n, dcR: sr / n, lufs: lufs(L, R),
    cent: cd ? cn / cd : 0, lo: cd ? lo / cd : 0, hi: cd ? hi / cd : 0, pops: pops / span, texture, swell, atk, maxAt: imx * 0.05 - first / SR, end80 };
}
const db = (x) => (20 * Math.log10(x)).toFixed(1);
function fmt(m) {
  return m.span.toFixed(2) + " s audible (" + m.sec.toFixed(2) + " s)  " + m.lufs.toFixed(1) + " LUFS  peak " + m.peak.toFixed(3) + " (" + db(m.peak) + ")" +
    (m.clip ? "  CLIPS x" + m.clip : "") + "  DC " + Math.max(Math.abs(m.dcL), Math.abs(m.dcR)).toExponential(1) +
    "\n      centroid " + (m.cent / 1000).toFixed(2) + "k  <250Hz " + (100 * m.lo).toFixed(0) + "%  >4k " + (100 * m.hi).toFixed(0) + "%  pops " + m.pops.toFixed(1) +
    "/s  texture " + m.texture.toFixed(1) + " dB  swell " + m.swell.toFixed(1) + " dB  attack " + m.atk.toFixed(2) + " s  peak at " + m.maxAt.toFixed(2) + " s  at 80% " + m.end80.toFixed(0) + " dB";
}
// The feature vector for separation (units chosen so 1 = a clearly audible step):
//   length log2 of the audible span (1 = twice as long); brightness log2 of the centroid (1 = an octave of colour);
//   rumble and hiss: the < 250 Hz and > 4 kHz shares x 3; crackle log2(1 + pops/s) / 1.5; texture (dB) / 3; swell (dB) / 2;
//   attack log2 of the time to -3 dB of the loudest 50 ms / 1.5; shape: where it peaks (share of the span) x 2 and how
//   much is left at 80% of the span (dB / 12)
function features(m) {
  return [Math.log2(m.span), Math.log2(Math.max(100, m.cent)), 3 * m.lo, 3 * m.hi, Math.log2(1 + m.pops) / 1.5, Math.min(m.texture, 9) / 3,
    Math.min(m.swell, 8) / 2, Math.log2(m.atk) / 1.5, 2 * cl(m.maxAt / m.span, 0, 1), cl(m.end80, -40, 0) / 12];
}
const FEAT = ["length", "bright", "rumble", "hiss", "crackle", "texture", "swell", "attack", "peakpos", "tail"];
function dist(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); }
function why(a, b) { return FEAT.map((k, i) => [k, Math.abs(a[i] - b[i])]).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => k + " " + v.toFixed(2)).join(", "); }

// ============================================================================================================
const arg = process.argv[2];
if (arg === "try") { console.log(fmt(measure(render(JSON.parse(process.argv[3]))))); process.exit(0); }
// x '<js expression>': measure a patch built with the voices above (roar / crackle / hiss / foomp / swish / gloop / sound)
if (arg === "x") { for (const e of process.argv.slice(3)) { const p = eval(e); console.log(fmt(measure(render(p)))); } process.exit(0); }
const nowRows = ALL.map((name) => { const m = measure(render(PRESETS[name])); return { name, m, f: features(m) }; });
const TARGET = median(nowRows.filter((x) => FIRE_SECTION.includes(x.name)).map((x) => x.m.lufs));
if (arg === "ref") {
  for (const x of nowRows) console.log(x.name.padEnd(20) + fmt(x.m));
  const sec = nowRows.filter((x) => FIRE_SECTION.includes(x.name)).map((x) => x.m.lufs);
  console.log("FIRE SECTION median " + TARGET.toFixed(1) + " LUFS, range " + Math.min(...sec).toFixed(1) + " to " + Math.max(...sec).toFixed(1) +
    " (" + sec.length + " presets); all 28 range " + Math.min(...nowRows.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...nowRows.map((x) => x.m.lufs)).toFixed(1));
  const p = []; for (let i = 0; i < nowRows.length; i++) for (let j = i + 1; j < nowRows.length; j++) p.push([nowRows[i].name, nowRows[j].name, dist(nowRows[i].f, nowRows[j].f), nowRows[i].f, nowRows[j].f]);
  p.sort((a, b) => a[2] - b[2]);
  console.log("TODAY closest pairs:"); for (const [a, b, d, fa, fb] of p.slice(0, 12)) console.log("  " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
  console.log("TODAY median pair " + median(p.map((x) => x[2])).toFixed(2));
  process.exit(0);
}

// ============================================================================================================
// THE FAMILY: TWO TABLES
//
// ADJ: the fire's character.
//   heat     0..1: how hot. The roar's band sits higher (wxTone), the hiss is denser and brighter, the pops brighter.
//   size     0..1: how much fire. The roar's strength (wxIntensity: its level AND, through the wind model, how far up its
//            band climbs) and its low buffeting (wxBody).
//   pops     crackle density (pops/s at a noun's 1x) and popTone / popDecay: their colour and length (a twig snap is
//            bright and short, an ember's pop dark and soft); popLvl how far they stand out
//   smoke    0..1: how muffled (one low-pass on every layer, 12 kHz down three octaves at 1)
//   gust     how unsteady the burn (wxGust: slow swells and flicker depth)
//   gutter   flicker drop-outs (a fire about to go out)
//   grit     drive on the roar (a violent, dirty burn)
//   rumble   extra low buffeting, and a low onset thud where the noun has an onset
//   space    reverb (a big fire in a big place)
//   tMul     every time in the noun's shape (a big or a dying fire is slow, a hot one quick)
//   hissLvl  the hiss layer's level
//   fuel     an extra layer: "gloop" = molten rock (slow low bubbles)
const ADJ = {
  Searing:    { heat: 1.0,  size: 0.55, pops: 6,  popTone: 0.8,  popDecay: 0.02, popLvl: 0.6,  smoke: 0,    gust: 0.3,  gutter: 0,    grit: 0.12, rumble: 0,   space: 0.12, tMul: 0.85, hissLvl: 1.0 },
  Kindled:    { heat: 0.45, size: 0.25, pops: 28, popTone: 0.68, popDecay: 0.04, popLvl: 0.9,  smoke: 0.12, gust: 0.55, gutter: 0.03, grit: 0,    rumble: 0,   space: 0.1,  tMul: 0.9,  hissLvl: 0.12 },
  Smoldering: { heat: 0.05, size: 0.3,  pops: 5,  popTone: 0.36, popDecay: 0.2,  popLvl: 0.8,  smoke: 0.75, gust: 0.75, gutter: 0.22, grit: 0,    rumble: 0.1, space: 0.18, tMul: 1.5,  hissLvl: 0.04 },
  Blazing:    { heat: 0.55, size: 0.85, pops: 22, popTone: 0.56, popDecay: 0.07, popLvl: 1.0,  smoke: 0.08, gust: 0.6,  gutter: 0,    grit: 0.08, rumble: 0.3, space: 0.22, tMul: 1.0,  hissLvl: 0.2 },
  Molten:     { heat: 0.35, size: 0.7,  pops: 5,  popTone: 0.42, popDecay: 0.12, popLvl: 0.5,  smoke: 0.5,  gust: 0.3,  gutter: 0,    grit: 0.25, rumble: 0.3, space: 0.18, tMul: 1.25, hissLvl: 0.35, fuel: "gloop" },
  Infernal:   { heat: 0.5,  size: 1.0,  pops: 8,  popTone: 0.45, popDecay: 0.1,  popLvl: 0.5,  smoke: 0.35, gust: 0.85, gutter: 0,    grit: 0.35, rumble: 0.7, space: 0.45, tMul: 1.3,  hissLvl: 0.18 },
  Ashen:      { heat: 0.1,  size: 0.3,  pops: 5,  popTone: 0.52, popDecay: 0.03, popLvl: 0.45, smoke: 0.7,  gust: 0.5,  gutter: 0.1,  grit: 0,    rumble: 0,   space: 0.35, tMul: 1.3,  hissLvl: 0.1 },
};

// NOUN: the event's shape, for a tMul-1 fire.
//   event    the layer that makes the event: "foomp" (a catch: a small deflagration), "surge" (a flare's bright rush),
//            "sear" (a scorch: the sizzle with a fast attack, which REPLACES the hiss layer), "pass" (a whoosh), or none
//   env      the roar's envelope [attack, hold, decay, sustain, release, duration] (s; sustain a level)
//   intMul / toneAdd / bodyMul / gustMul / gustRate   the roar against the adjective's (gustRate in swells per second)
//   popMul / popToneAdd / cDelay / cEnv               the crackle: density, colour, when it starts, its own envelope
//                                                     [attack, decay, sustain, release] (it lasts as long as the roar)
//   hissMul / hEnv   the hiss's level and envelope (null = it follows the roar's)
//   ev       the event layer's own numbers
//   fuelMul  how far a fuel layer (Molten's gloops) comes forward (1 when absent): a scorch is its sear, so it sits under
const NOUN = {
  Ignite: { event: "foomp", env: [0.25, 0.05, 0.35, 0.45, 0.3, 1.3], intMul: 1.0, toneAdd: 0, bodyMul: 1.0, gustMul: 0.8, gustRate: 1.2,
            popMul: 1.0, popToneAdd: 0, cDelay: 0.2, cEnv: [0.25, 0, 1, 0.3], hissMul: 0.8,
            ev: { at: 0, g: 0.85 } },
  Flare:  { event: "surge", env: [0.05, 0.08, 0.6, 0, 0.15, 0.95], intMul: 1.15, toneAdd: 0.12, bodyMul: 0.8, gustMul: 0.5, gustRate: 2.0,
            popMul: 1.6, popToneAdd: 0.05, cDelay: 0.02, cEnv: [0.02, 0.5, 0.1, 0.2], hissMul: 1.2,
            ev: { at: 0, g: 0.7, tone: 0.3, sweep: 0.75, peak: 0.12, body: 0.15, dur: 0.6 } },
  Torch:  { event: null, env: [0.15, 0, 0, 1, 0.35, 2.0], intMul: 0.9, toneAdd: 0.05, bodyMul: 0.7, gustMul: 0.3, gustRate: 3.0,
            popMul: 0.7, popToneAdd: 0, cDelay: 0.1, cEnv: [0.2, 0, 1, 0.3], hissMul: 1.3 },
  Blaze:  { event: null, env: [0.45, 0, 0, 1, 0.6, 2.8], intMul: 1.15, toneAdd: 0, bodyMul: 1.3, gustMul: 2.0, gustRate: 0.7,
            popMul: 1.4, popToneAdd: -0.03, cDelay: 0.1, cEnv: [0.4, 0, 1, 0.5], hissMul: 1.0 },
  Flame:  { event: null, env: [0.35, 0, 0, 1, 0.45, 2.2], intMul: 0.8, toneAdd: 0, bodyMul: 0.75, gustMul: 1.0, gustRate: 1.1,
            popMul: 1.0, popToneAdd: 0, cDelay: 0.15, cEnv: [0.3, 0, 1, 0.4], hissMul: 0.8 },
  Scorch: { event: "sear", env: [0.02, 0.05, 0.5, 0.2, 0.3, 1.2], intMul: 0.75, toneAdd: 0.08, bodyMul: 0.6, gustMul: 0.6, gustRate: 1.5,
            popMul: 0.8, popToneAdd: 0.1, cDelay: 0.05, cEnv: [0.05, 0.6, 0.3, 0.3], hissMul: 1.0,
            ev: { at: 0, g: 1.2 }, fuelMul: 0.35 },
  Whoosh: { event: "pass", env: [0.35, 0, 0.55, 0, 0.12, 1.05], intMul: 1.0, toneAdd: 0.05, bodyMul: 0.6, gustMul: 0.5, gustRate: 1.5,
            popMul: 0.9, popToneAdd: 0, cDelay: 0.3, cEnv: [0.05, 0.55, 0, 0.15], hissMul: 0.5,
            ev: { at: 0, g: 0.8, tone: 0.25, sweep: 0.6, peak: 0.42, body: 0.25 } },
};

// Per-name overrides: only where composition genuinely fails, each with its reason. (None needed: see the report.)
const OVERRIDES = {};

// THE COMPOSER. The rules, all of them:
//   times      every time in the noun's shape x adj.tMul
//   roar       wxIntensity = (0.35 + 0.55 size) x intMul, capped 1; wxTone = 0.02 + 0.7 heat + toneAdd;
//              wxBody = (0.12 + 0.6 size + 0.4 rumble) x bodyMul, capped 1; wxGust = gust x gustMul; swells at
//              gustRate / tMul a second; drive = grit; flicker = gutter (at 9 Hz); reverb = space (size 0.5 + 0.4 space)
//   smoke      cutoff 12 kHz x 2^(-3 smoke) on the roar, crackle, hiss and event (a muffled fire is muffled throughout)
//   onset      a noun with an onset (foomp, surge, sear) carries a low thud on its event when rumble > 0
//   crackle    rate = pops x popMul; tone = popTone + popToneAdd; decay = popDecay; spread 0.92; starts cDelay x tMul
//              in and runs to the roar's end; drive 0.4; level 1.5 x popLvl (a layer's Volume goes to 200%: a crackle
//              must stand OUT of the roar, 9 dB over it in its own 2 ms, or it is only texture)
//   hiss       rate 120 + 80 heat; tone 0.8 + 0.15 heat; level hissLvl x hissMul; high-passed at 2.5 kHz (1.6 kHz
//              when smoky, so there is something left under the low-pass); follows the roar's envelope
//   events     foomp: blast size 0.3 + 0.18 size, Weight 3 + 3 size, fireball roar 1, rumble 0.25 + 0.5 rumble;
//              surge / pass: the whoosh, its tone 0.15 + 0.35 heat (+ the noun's), length the roar's; sear: the hiss
//              with a 4 ms attack, a 60 ms hold, decaying to 0.3 over half the roar
//   fuel       gloop: 4.5 bubbles a second / tMul at 70 + 40 (1 - size) Hz, as long as the roar, level 0.75 x fuelMul
//   level      gain on layer 1: the trim to the section median (see the header)
function compose(name) {
  const [adjName, nounName] = name.split(" ");
  const A = ADJ[adjName], N = NOUN[nounName];
  if (!A || !N) throw new Error("no table entry for " + name);
  const t = A.tMul, seed = seedOf(name), cut = Math.round(12000 * Math.pow(2, -3 * A.smoke));
  const [ra, rh, rd, rs, rr, rdur] = N.env.map((x, i) => (i === 3 ? x : x * t));
  const base = roar({ int: Math.min(1, (0.35 + 0.55 * A.size) * N.intMul), tone: cl(0.02 + 0.7 * A.heat + N.toneAdd, 0, 1),
    body: Math.min(1, (0.12 + 0.6 * A.size + 0.4 * A.rumble) * N.bodyMul), gust: cl(A.gust * N.gustMul, 0, 1), gustRate: N.gustRate / t,
    seed, atk: ra, hold: rh, dec: rd, sus: rs, rel: rr, dur: rdur, cut, drive: A.grit, flicker: A.gutter, flickerRate: 9,
    reverb: A.space, reverbSize: 0.5 + 0.4 * A.space, width: 0.6 });
  const layers = [];
  // the event
  const onsetThud = A.rumble > 0 ? { boom: r2(0.6 * A.rumble), boomFreq: 45, boomDrop: 0.5, boomDecay: r2(0.25 + 0.4 * A.rumble) } : {};
  if (N.event === "foomp") {
    layers.push([foomp({ size: 0.3 + 0.18 * A.size, pulse: 3 + 3 * A.size, rumble: 0.25 + 0.5 * A.rumble, seed: seedOf(name, 7), cut, dur: 0.9 * t }), N.ev.at, N.ev.g]);
  } else if (N.event === "surge" || N.event === "pass") {
    const e = N.ev, s = swish({ tone: cl(0.15 + 0.35 * A.heat + (e.tone || 0) - 0.25, 0, 1), sweep: e.sweep, peak: e.peak, body: e.body, dur: (e.dur || N.env[5]) * t, cut });
    Object.assign(s, onsetThud);
    layers.push([s, e.at, e.g]);
  } else if (N.event === "sear") {
    const s = hiss({ rate: 160 + 40 * A.heat, tone: 0.8 + 0.15 * A.heat, decay: 0.04, atk: 0.004, hold: 0.06, dec: 0.5 * rdur, sus: 0.3, rel: rr, dur: rdur,
      hp: A.smoke > 0.4 ? 1600 : 2500, cut });
    Object.assign(s, onsetThud);
    layers.push([s, N.ev.at, N.ev.g]);
  }
  // the crackle
  const cd = N.cDelay * t, [ca, cdc, cs, cr] = N.cEnv;
  layers.push([crackle({ rate: A.pops * N.popMul, tone: A.popTone + N.popToneAdd, decay: A.popDecay, spread: 0.92,
    atk: ca * t, dec: cdc * t, sus: cs, rel: cr * t, dur: Math.max(0.1, rdur - cd), cut, drive: 0.4 }), cd, 1.5 * A.popLvl]);
  // the hiss (a scorch's sear already is one)
  if (N.event !== "sear") {
    const h = hiss({ rate: 120 + 80 * A.heat, tone: 0.8 + 0.15 * A.heat, decay: 0.05, atk: ra, hold: rh, dec: rd, sus: rs, rel: rr, dur: rdur,
      hp: A.smoke > 0.4 ? 1600 : 2500, cut });
    layers.push([h, 0, A.hissLvl * N.hissMul]);
  }
  // the fuel
  if (A.fuel === "gloop") layers.push([gloop({ freq: 70 + 40 * (1 - A.size), rate: 4.5 / t, dur: rdur, atk: Math.min(0.2, ra), rel: rr, cut: Math.min(cut, 3000) }), 0.05, 0.75 * (N.fuelMul ?? 1)]);
  return sound(base, layers, OVERRIDES[name]);
}

// ============================================================================================================
// THE SINGLES (one design each; same voices, chosen by what the sound is). A crackle layer's Volume runs 1.1-1.6 for
// the reason stated at crackle(): a pop must stand out of the roar, not only colour it.
const S = {};
// Fire: the flagship, a full campfire: a warm roar with slow swells, a crackle of small pops, a few big resin pops, a
// little hiss. Long enough to audition as a bed (2.5 s; layer 1 is the roar, so the Duration slider stretches).
S["Fire"] = () => sound(roar({ int: 0.55, tone: 0.12, body: 0.45, gust: 0.6, gustRate: 0.9, seed: 41, atk: 0.3, sus: 1, rel: 0.5, dur: 2.5, reverb: 0.12, reverbSize: 0.5 }), [
  [crackle({ rate: 16, tone: 0.62, decay: 0.03, spread: 0.85, atk: 0.2, rel: 0.4, dur: 2.4, drive: 0.4 }), 0.05, 1.3],
  [crackle({ rate: 4, tone: 0.42, decay: 0.14, spread: 0.95, atk: 0.2, rel: 0.4, dur: 2.4, drive: 0.4 }), 0.1, 1.2],
  [hiss({ rate: 140, tone: 0.84, decay: 0.05, atk: 0.3, rel: 0.5, dur: 2.5 }), 0, 0.15]]);
// Flamethrower: a pressurised jet. The catch, then a strong, steady, bright jet roar with its own spray hiss and a
// spit of burning fuel crackling; heavy drive for the violence; the pressure pulses at ~4/s (gust rate) where a
// campfire swells. Bigger, lower and dirtier than any torch (a torch is a flame, this is a weapon).
S["Flamethrower"] = () => sound(roar({ int: 1, tone: 0.33, body: 0.85, gust: 0.3, gustRate: 4, seed: 113, atk: 0.08, sus: 1, rel: 0.35, dur: 2.0, drive: 0.35 }), [
  [foomp({ size: 0.48, pulse: 3, rumble: 0.4, seed: 17, dur: 0.8 }), 0, 1.0],
  [hiss({ rate: 200, tone: 0.8, decay: 0.08, spread: 0.3, hp: 1800, atk: 0.06, rel: 0.35, dur: 1.97 }), 0.03, 0.5],
  [crackle({ rate: 16, tone: 0.6, decay: 0.03, spread: 0.85, atk: 0.2, rel: 0.3, dur: 1.8, drive: 0.4 }), 0.15, 1.2]]);
// Fire Whoosh: a flame swung through the air (a torch waved): the swish, the roar shaped as the pass, crackle trailing.
S["Fire Whoosh"] = () => sound(roar({ int: 0.8, tone: 0.28, body: 0.35, gust: 0.4, gustRate: 2, seed: 211, atk: 0.22, dec: 0.4, sus: 0, rel: 0.12, dur: 0.8 }), [
  [swish({ tone: 0.38, sweep: 0.75, body: 0.3, peak: 0.35, dur: 0.75 }), 0, 0.8],
  [crackle({ rate: 16, tone: 0.62, decay: 0.03, spread: 0.85, atk: 0.04, dec: 0.4, sus: 0, rel: 0.1, dur: 0.6 }), 0.2, 1.2],
  [hiss({ rate: 150, tone: 0.86, decay: 0.05, atk: 0.22, dec: 0.4, sus: 0, rel: 0.12, dur: 0.8 }), 0, 0.25]]);
// Torch Ignite: a soaked torch catching: a small sharp catch, then it settles straight into the steady, fast-fluttering
// burn of a torch and holds it (not a bloom: the fumes catch and the torch is simply alight).
S["Torch Ignite"] = () => sound(roar({ int: 0.72, tone: 0.3, body: 0.35, gust: 0.2, gustRate: 2.8, seed: 307, atk: 0.06, hold: 0.04, dec: 0.2, sus: 0.75, rel: 0.3, dur: 1.4 }), [
  [foomp({ size: 0.38, pulse: 4, rumble: 0.3, seed: 23, dur: 0.7 }), 0, 0.9],
  [hiss({ rate: 160, tone: 0.86, decay: 0.05, atk: 0.06, hold: 0.04, dec: 0.2, sus: 0.75, rel: 0.3, dur: 1.4 }), 0, 0.35],
  [crackle({ rate: 7, tone: 0.62, decay: 0.03, spread: 0.85, atk: 0.1, rel: 0.25, dur: 1.2 }), 0.15, 1.1]]);
// Ember Crackle: the fire's end: no flame to speak of, soft ember ticks and the odd bright tink of one cracking over a
// faint low glow breathing. The ticks are layer 1 and the glow a quiet layer under them (layer 1 is never mixed below
// the others, and here the glow must be). Sits LOWER than the section by design (a quiet bed).
S["Ember Crackle"] = () => sound(crackle({ rate: 7, tone: 0.58, decay: 0.01, spread: 0.95, atk: 0.2, rel: 0.4, dur: 2.0, drive: 0.25 }), [
  [crackle({ rate: 5, tone: 0.86, decay: 0.0, spread: 0.97, atk: 0.2, rel: 0.4, dur: 1.9, drive: 0.2 }), 0.1, 0.6],
  [roar({ int: 0.28, tone: 0, body: 0.25, gust: 0.7, gustRate: 0.5, seed: 401, atk: 0.4, sus: 1, rel: 0.5, dur: 2.0, cut: 1500 }), 0, 0.15]]);
// Match Strike: the head dragged fast over the striker (friction: a rough, bright stick-slip rasp, with a particle grit
// on top for the sandpaper), then the head flaring ("fssst": a sizzle burst), then a small flame puffing up and settling.
S["Match Strike"] = () => sound({ wave: 34, fricBody: 0, freq: 2600, fricTone: 1, fricGrip: 0.7, fricRough: 1, fricLock: 0.1, fricSpeed: 0.9,
  fricT1: 0.06, fricSpeed1: 1, fricStop: 0.1, fricPress: 0.75, fricPressT1: 0.08, fricPress1: 0.4, fricSeed: 5,
  attack: 0.001, hold: 0.1, decay: 0.02, sustain: 0, release: 0.01, filterMode: 1, cutoff: 600, reso: 0, drive: 0, width: 0.3, duration: 1.0 }, [
  [crackle({ rate: 200, tone: 0.75, decay: 0.01, spread: 0.6, atk: 0.005, hold: 0.07, dec: 0.03, sus: 0, rel: 0.01, dur: 0.15, drive: 0 }), 0, 0.5],
  [hiss({ rate: 200, tone: 0.82, decay: 0.05, spread: 0.4, hp: 2000, atk: 0.004, hold: 0.04, dec: 0.25, sus: 0.12, rel: 0.25, dur: 0.6 }), 0.09, 0.8],
  [roar({ int: 0.45, tone: 0.25, body: 0.1, gust: 0.5, gustRate: 3, seed: 503, atk: 0.03, dec: 0.3, sus: 0.35, rel: 0.3, dur: 0.85 }), 0.1, 0.6]]);
// Inferno Roar: a building fully alight: a huge, deep, driven roar with heavy swells and a sub thud, a second brighter
// roar for the turbulence on top, dense dark crackle and big structural pops under it; it roars UP over a second. 3.5 s.
S["Inferno Roar"] = () => sound(roar({ int: 1, tone: 0.05, body: 1, gust: 0.95, gustRate: 0.6, seed: 601, atk: 1.0, sus: 1, rel: 0.9, dur: 3.5, drive: 0.3,
  boom: 0.6, boomFreq: 38, boomDrop: 0.3, boomDecay: 1.2, reverb: 0.3, reverbSize: 0.8, reverbTone: 0.35 }), [
  [roar({ int: 0.85, tone: 0.3, body: 0, gust: 0.7, gustRate: 1.2, seed: 613, atk: 1.0, sus: 1, rel: 0.9, dur: 3.5 }), 0, 0.35],
  [crackle({ rate: 30, tone: 0.45, decay: 0.05, spread: 0.85, atk: 0.6, rel: 0.7, dur: 3.4, drive: 0.4 }), 0.1, 0.9],
  [crackle({ rate: 5, tone: 0.33, decay: 0.2, spread: 0.95, atk: 0.4, rel: 0.7, dur: 3.3, drive: 0.4 }), 0.2, 1.2]]);
// Fire Sparks: a log pops and sparks fly: one pop, then a shower of tiny bright ticks thinning out, the tink of a few
// landing, a thin hiss. No roar (it is the sparks, not the fire).
S["Fire Sparks"] = () => sound(crackle({ rate: 45, tone: 0.88, decay: 0.02, spread: 0.9, atk: 0.005, dec: 0.9, sus: 0.15, rel: 0.25, dur: 1.3, width: 0.9 }), [
  [crackle({ rate: 14, tone: 0.97, decay: 0.0, spread: 1, atk: 0.05, dec: 0.8, sus: 0.3, rel: 0.3, dur: 1.2, width: 0.9 }), 0.08, 0.6],
  [hiss({ rate: 120, tone: 0.92, decay: 0.03, atk: 0.005, dec: 0.7, sus: 0.05, rel: 0.2, dur: 1.0 }), 0, 0.25],
  [crackle({ rate: 6, tone: 0.5, decay: 0.12, spread: 0.97, atk: 0.001, hold: 0.02, dec: 0.15, sus: 0, rel: 0.1, dur: 0.3 }), 0, 0.8]]);
// Lava Bubble: slow, deep molten gloops (the bubble engine, driven), a crust crackling as they break, a sizzle, and a
// low heaving roar under them.
S["Lava Bubble"] = () => sound(gloop({ freq: 75, rate: 4, rise: 0.6, spread: 0.4, decay: 0.75, drive: 0.3, cut: 2500, atk: 0.03, rel: 0.4, dur: 1.8 }), [
  [crackle({ rate: 8, tone: 0.38, decay: 0.12, spread: 0.9, atk: 0.1, rel: 0.4, dur: 1.7, cut: 5000 }), 0.05, 1.0],
  [hiss({ rate: 120, tone: 0.8, decay: 0.05, atk: 0.1, rel: 0.4, dur: 1.8 }), 0, 0.15],
  [roar({ int: 0.35, tone: 0, body: 0.9, gust: 0.6, gustRate: 0.8, seed: 709, atk: 0.2, sus: 1, rel: 0.4, dur: 1.8, cut: 1200 }), 0, 0.35]]);
// Fireball Whoosh: a fireball flying past: the roar swells and dies as it passes, the swish's band rising and falling
// with it (heard as the Doppler turn), crackle streaming behind.
S["Fireball Whoosh"] = () => sound(roar({ int: 0.95, tone: 0.3, body: 0.55, gust: 0.5, gustRate: 2, seed: 809, atk: 0.48, dec: 0.5, sus: 0, rel: 0.1, dur: 1.1, drive: 0.15 }), [
  [swish({ tone: 0.22, sweep: 0.9, body: 0.15, peak: 0.45, dur: 1.05 }), 0, 0.75],
  [crackle({ rate: 24, tone: 0.55, decay: 0.04, spread: 0.85, atk: 0.05, dec: 0.55, sus: 0, rel: 0.1, dur: 0.75, drive: 0.4 }), 0.35, 1.3],
  [hiss({ rate: 150, tone: 0.85, decay: 0.05, atk: 0.48, dec: 0.5, sus: 0, rel: 0.1, dur: 1.1 }), 0, 0.2]]);
// Fire Burst: a ball of flame bursting out (a gas pocket, a barrel going up): a heavy foomp with its fireball, the roar
// blown out and gone fast, burning bits crackling outward. Short and front-loaded where Torch Ignite holds a burn.
S["Fire Burst"] = () => sound(roar({ int: 1, tone: 0.4, body: 0.7, gust: 0.4, gustRate: 2, seed: 907, atk: 0.01, dec: 0.4, sus: 0, rel: 0.15, dur: 0.75, drive: 0.2 }), [
  [foomp({ size: 0.56, pulse: 3, rumble: 0.6, dist: 8, room: 0.5, seed: 31, dur: 0.9 }), 0, 1.2],
  [crackle({ rate: 50, tone: 0.7, decay: 0.03, spread: 0.85, atk: 0.005, dec: 0.6, sus: 0, rel: 0.12, dur: 0.72, drive: 0.4 }), 0.03, 1.6],
  [hiss({ rate: 170, tone: 0.86, decay: 0.05, atk: 0.01, dec: 0.4, sus: 0, rel: 0.15, dur: 0.7 }), 0, 0.3]]);
// Campfire Crackle (Nature): a campfire heard as its crackle: wood pops forward, a soft open-air roar far behind them,
// a little outdoor space. Shorter and pop-led where "Fire" is the whole fire; woody, thick, slow pops where a kindled
// flame's are bright twig snaps.
S["Campfire Crackle"] = () => sound(roar({ int: 0.4, tone: 0.0, body: 0.35, gust: 0.6, gustRate: 0.7, seed: 1009, atk: 0.15, sus: 1, rel: 0.4, dur: 1.6, reverb: 0.2, reverbSize: 0.75, reverbTone: 0.45 }), [
  [crackle({ rate: 7, tone: 0.4, decay: 0.08, spread: 0.88, atk: 0.05, rel: 0.4, dur: 1.55, reverb: 0.2, reverbSize: 0.75, drive: 0.4 }), 0, 1.6],
  [crackle({ rate: 5, tone: 0.38, decay: 0.3, spread: 0.97, atk: 0.05, rel: 0.4, dur: 1.5, reverb: 0.2, reverbSize: 0.75, drive: 0.4 }), 0.08, 1.4]]);
// Crackling Fire (Crackle / Particle, the particle engine's showcase, so it stays ALL particle): a close crackle with
// no roar: fine fast crackle, big pops, and a low dense ember mutter standing in for the flame.
S["Crackling Fire"] = () => sound(crackle({ rate: 30, tone: 0.6, decay: 0.03, spread: 0.85, atk: 0.1, rel: 0.4, dur: 2.0 }), [
  [crackle({ rate: 6, tone: 0.45, decay: 0.15, spread: 0.95, atk: 0.1, rel: 0.4, dur: 1.95 }), 0.05, 0.9],
  [crackle({ rate: 80, tone: 0.28, decay: 0.3, spread: 0.55, atk: 0.2, rel: 0.4, dur: 2.0, cut: 2500, drive: 0 }), 0, 0.3]]);
// Dragon Fire Breath (Animal / Monster): a dragon breathing fire: a huge throat growl (the creature engine) with the
// jet swelling out of it: the catch, a deep driven jet roar, its spray hiss.
S["Dragon Fire Breath"] = () => sound(roar({ int: 1, tone: 0.25, body: 0.9, gust: 0.4, gustRate: 2.5, seed: 1103, atk: 0.25, sus: 1, rel: 0.45, dur: 1.6, drive: 0.3, reverb: 0.2, reverbSize: 0.7 }), [
  [{ wave: 28, drive: 0, cutoff: 18000, reso: 0, freq: 52, crPitchStart: -1.5, crPitchEnd: -4, crPeak: 0.3, crOpenStart: 0.3, crOpenPeak: 0.9, crOpenEnd: 0.4,
     crVowelStart: 0.4, crVowelEnd: 0.7, crNasal: 0.05, crSize: 2.7, crTension: 0.75, crJitter: 0.35, crShimmer: 0.35, crRough: 0.6, crBreath: 0.5,
     crFlutter: 0.35, crFlutterRate: 14, hold: 0, decay: 0, sustain: 1, attack: 0.06, release: 0.35, duration: 1.3 }, 0, 0.7],
  [foomp({ size: 0.5, pulse: 5, rumble: 0.5, seed: 41, dur: 0.9 }), 0.12, 0.6],
  [hiss({ rate: 190, tone: 0.82, decay: 0.07, spread: 0.3, hp: 1800, atk: 0.25, rel: 0.45, dur: 1.5 }), 0.1, 0.35]]);
// Fireball Cast (Magic): the spell AJ picked for the Wizard ("fireball": a roar sweeping up as it grows, a thump as
// it launches, crackle trailing), rebuilt on the fire voices: the roar and a rising swish grow together, the launch is
// a foomp, the crackle streams after it.
S["Fireball Cast"] = () => sound(roar({ int: 0.9, tone: 0.32, body: 0.5, gust: 0.35, gustRate: 2.5, seed: 1201, atk: 0.33, dec: 0.3, sus: 0, rel: 0.12, dur: 0.85, drive: 0.15, reverb: 0.2, reverbSize: 0.6 }), [
  [swish({ tone: 0.3, sweep: 1, body: 0.3, peak: 0.72, dur: 0.45 }), 0, 0.6],
  [foomp({ size: 0.42, pulse: 4, rumble: 0.4, seed: 47, dur: 0.6 }), 0.3, 0.75],
  [crackle({ rate: 24, tone: 0.6, decay: 0.04, spread: 0.85, atk: 0.03, dec: 0.4, sus: 0, rel: 0.1, dur: 0.5, drive: 0.4 }), 0.33, 1.2]]);

// One line per sound for KEY.md (what to listen for)
const IDEA = {
  "Fire": "full campfire: warm swelling roar, small pops, a few big resin pops, a breath of hiss (2.5 s bed)",
  "Flamethrower": "a catch, then a steady pressurised bright jet roar with spray hiss and spitting crackle",
  "Fire Whoosh": "a flame swung through the air: swish + roar shaped as the pass + crackle trailing",
  "Torch Ignite": "a small sharp catch that settles straight into a torch's steady fast-fluttering burn",
  "Ember Crackle": "the fire's end: sparse soft ember ticks and the odd bright tink over a barely-there glow (sits low)",
  "Match Strike": "rough scratch on the striker (friction) -> the head flares 'fssst' -> a small flame settling",
  "Inferno Roar": "a building alight: huge deep driven roar rising over a second, heavy swells, brighter turbulence on top, dense dark crackle (3.5 s)",
  "Fire Sparks": "a log pops and sparks fly: a shower of tiny bright ticks thinning out, a few tinks, thin hiss, no roar",
  "Lava Bubble": "slow deep driven gloops, the crust crackling, a sizzle, a low heaving roar under them",
  "Fireball Whoosh": "a fireball flying past: roar and swish swell and turn together, crackle streaming behind",
  "Fire Burst": "a ball of flame bursting out: heavy foomp with its fireball, roar blown out fast, burning bits crackling outward",
  "Searing Blaze": "white-hot big fire: high bright roar, strong hiss, few dry pops (Searing = hot / Blaze = big sustained)",
  "Searing Torch": "white-hot steady torch: hiss-roar with a fast flutter, little crackle",
  "Kindled Ignite": "kindling catching: a soft foomp, then a small fire blooming with lots of bright twig snaps",
  "Kindled Flare": "kindling flaring: a quick surge and fall full of twig snaps",
  "Smoldering Ignite": "a smoky fire that barely catches: slow dark muffled bloom, guttering, a few soft ember pops",
  "Searing Flare": "a white-hot flare: a bright hissing surge and fall",
  "Blazing Torch": "a big torch: strong steady roar with body, crackling hard",
  "Searing Ignite": "a white-hot catch: foomp, then a bright hissing bloom",
  "Kindled Flame": "a small young fire: gentle roar, busy bright crackle",
  "Molten Scorch": "a molten sear: a sizzle burst over dark heat, gloops underneath",
  "Infernal Flare": "a hellish flare: a deep driven surge with a sub thud, slow and huge, big space",
  "Molten Flame": "molten fire: dark heavy roar with slow low gloops and sizzle",
  "Ashen Whoosh": "ash blown on hot air: a slow, dark, muffled, dusty pass with a few dry ticks",
  "Campfire Crackle": "a campfire heard as its crackle: wood pops forward, soft open-air roar behind",
  "Crackling Fire": "close crackle, all particle (no roar): fine fast crackle, big pops, a low ember mutter",
  "Dragon Fire Breath": "a huge throat growl (creature engine) with the jet swelling out of it: catch, deep driven roar, spray",
  "Fireball Cast": "the Wizard's picked fireball on the fire voices: roar + rising swish grow, a foomp launches it, crackle trails",
};

// Per-sound level offset from the section median, by design (dB). Everything else lands ON the median.
const LEVEL_OFFSET = { "Ember Crackle": -8, "Match Strike": -3, "Fire Sparks": -3, "Crackling Fire": -2, "Campfire Crackle": -2, "Smoldering Ignite": -2, "Ashen Whoosh": -2,
  "Inferno Roar": 1, "Infernal Flare": 1, "Fire Burst": 1, "Flamethrower": 1, "Dragon Fire Breath": 1 };

// _vary: Variations vary layer 1 only. A roar layer 1 re-rolls its swells (wxSeed) and nudges its strength and colour;
// a particle / bubble / friction layer 1 nudges its own rate and colour.
function varyFor(p) {
  const w = Math.round(p.wave);
  if (w === 29) return { wxSeed: 1, wxGust: 0.15, wxTone: 0.1, wxIntensity: 0.06 };
  if (w === 15) return { particleRate: 0.2, particleTone: 0.08, particleSpread: 0.05 };
  if (w === 14) return { freq: 0.12, bubbleRate: 0.2, bubbleSpread: 0.2 };
  if (w === 34) return { fricSeed: 1, freq: 0.08, fricSpeed: 0.06 };
  return {};
}
function design(name) { return FAMILY.includes(name) ? compose(name) : S[name](); }

// ============================================================================================================
const wavDir = join(ROOT, "soundtests", "fire-redo"), jsonDir = join(ROOT, "tools", "new-presets");
const wav = (file, r, title) => writeFileSync(join(wavDir, file), Buffer.from(CS.encodeWav(r.L, r.R, { rate: SR, depth: 16, channels: 2, title })));
// level: Normalize sets the peak at 0.9 x gain, so loudness scales with gain until gain 1; past that the Limiter in
// steps of 0.05 (the smallest that reaches the target; it raises loudness by driving into a 0.98 ceiling)
function level(p, target) {
  p.gain = 0.7; delete p.limiter;
  let m = measure(render(p));
  const want = 0.7 * Math.pow(10, (target - m.lufs) / 20);
  if (want <= 1) { p.gain = r2(Math.max(0.05, want)); return measure(render(p)); }
  p.gain = 1;
  let lo = 0, hi = 20;   // in 0.05 steps: the smallest Limiter within 0.4 dB of the target (bisected; loudness rises with it)
  p.limiter = 1; m = measure(render(p));
  if (m.lufs < target - 0.4) return m;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; p.limiter = r2(mid * 0.05); const mm = measure(render(p)); if (mm.lufs >= target - 0.4) hi = mid; else lo = mid; }
  p.limiter = r2(hi * 0.05);
  // the 0.05 step can overshoot: trim the gain back under 1 so the loudness lands on the target (twice: with the
  // limiter in, loudness is not quite linear in gain)
  for (let k = 0; k < 2; k++) { m = measure(render(p)); if (m.lufs > target + 0.3) p.gain = r2(p.gain * Math.pow(10, (target - m.lufs) / 20)); }
  return measure(render(p));
}
const only = arg && arg !== "sep" ? arg : null;
if (only || !arg) mkdirSync(wavDir, { recursive: true }), mkdirSync(jsonDir, { recursive: true });
const rows = [], json = {};
for (const name of ALL) {
  const s = slug(name);
  if (only && only !== s) continue;
  const p = design(name), tgt = TARGET + (LEVEL_OFFSET[name] || 0);
  const m = level(p, tgt), r = render(p);
  const now = nowRows.find((x) => x.name === name);
  if (arg !== "sep") {
    wav(s + "-1-now.wav", render(PRESETS[name]), name + " (now)");
    wav(s + "-2-new.wav", r, name);
  }
  json[name] = Object.assign({}, p, { _vary: varyFor(p) });
  rows.push({ name, slug: s, p, r, m, f: features(m), now });
  const nl = p.layers ? JSON.parse(p.layers).length + 1 : 1;
  console.log(name.padEnd(19) + "NEW " + fmt(m) + "\n      " + nl + " layer(s), gain " + p.gain + (p.limiter ? " limiter " + p.limiter : "") +
    ", vs target " + (m.lufs - tgt >= 0 ? "+" : "") + (m.lufs - tgt).toFixed(1) + " dB (target " + tgt.toFixed(1) + ")" +
    "\n  " + "".padEnd(17) + "NOW " + fmt(now.m).replace(/\n/g, "\n    "));
}
if (only) process.exit(0);

// ---- separation
const pairs = (list, key) => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i].name, list[j].name, dist(list[i][key], list[j][key]), list[i][key], list[j][key]]); return out.sort((a, b) => a[2] - b[2]); };
const pn = pairs(rows, "f");
const fam = rows.filter((x) => FAMILY.includes(x.name)), pf = pairs(fam, "f"), pfo = pairs(fam.map((x) => ({ name: x.name, f: x.now.f })), "f");
console.log("\nSEPARATION (feature distance; 1 = about a doubling of length, an octave of colour, or a clear crackle/shape step)");
console.log("  closest NEW pairs (all 28):");
for (const [a, b, d, fa, fb] of pn.slice(0, 14)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  NEW all-28 median pair " + median(pn.map((x) => x[2])).toFixed(2) + ", min " + pn[0][2].toFixed(2) + "; TODAY " + median(pairs(nowRows, "f").map((x) => x[2])).toFixed(2) + ", min " + pairs(nowRows, "f")[0][2].toFixed(2));
console.log("  FAMILY (13): NEW median " + median(pf.map((x) => x[2])).toFixed(2) + ", min " + pf[0][2].toFixed(2) + "; TODAY median " + median(pfo.map((x) => x[2])).toFixed(2) + ", min " + pfo[0][2].toFixed(2));
console.log("  family closest NEW:"); for (const [a, b, d, fa, fb] of pf.slice(0, 6)) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  same-noun pairs:"); for (const [a, b, d, fa, fb] of pf.filter(([a, b]) => a.split(" ")[1] === b.split(" ")[1])) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
console.log("  same-adjective pairs:"); for (const [a, b, d, fa, fb] of pf.filter(([a, b]) => a.split(" ")[0] === b.split(" ")[0])) console.log("    " + d.toFixed(2) + "  " + a + " / " + b + "   (" + why(fa, fb) + ")");
const over2 = rows.filter((x) => x.m.sec > 2.001).map((x) => x.name + " " + x.m.sec.toFixed(2) + " s");
console.log("  ranges: audible " + Math.min(...rows.map((x) => x.m.span)).toFixed(2) + "-" + Math.max(...rows.map((x) => x.m.span)).toFixed(2) + " s; LUFS " +
  Math.min(...rows.map((x) => x.m.lufs)).toFixed(1) + " to " + Math.max(...rows.map((x) => x.m.lufs)).toFixed(1) + " (median " + median(rows.map((x) => x.m.lufs)).toFixed(1) +
  "; target " + TARGET.toFixed(1) + "); peaks max " + Math.max(...rows.map((x) => x.m.peak)).toFixed(3) + ", clipping " + rows.filter((x) => x.m.clip).length +
  ", |DC| max " + Math.max(...rows.map((x) => Math.max(Math.abs(x.m.dcL), Math.abs(x.m.dcR)))).toExponential(1));
console.log("  over 2 s: " + (over2.join(", ") || "none"));
console.log("  before/after loudness (new - now, dB): " + rows.map((x) => x.name + " " + (x.m.lufs - x.now.m.lufs >= 0 ? "+" : "") + (x.m.lufs - x.now.m.lufs).toFixed(1)).join("; "));
if (arg === "sep") process.exit(0);

// ---- the JSON and the listen-through (section order: the Fire section, then the four filed elsewhere)
writeFileSync(join(jsonDir, "fire-redo.json"), JSON.stringify(json, null, 2) + "\n");
const gap = Math.round(0.4 * SR);
let total = 0; for (const x of rows) total += x.r.L.length + gap;
const AL = new Float32Array(total), AR = new Float32Array(total), key = [];
let at = 0;
rows.forEach((x, i) => { AL.set(x.r.L, at); AR.set(x.r.R, at); key.push(String(i + 1).padStart(2) + ". " + (at / SR).toFixed(2).padStart(6) + " s  " + x.name.padEnd(19) + IDEA[x.name]); at += x.r.L.length + gap; });
wav("all-new.wav", { L: AL, R: AR }, "Fire redo, all new");
writeFileSync(join(wavDir, "KEY.md"), "# Fire redo — all-new.wav: the 28 new fire sounds in section order (the Fire section, then Campfire Crackle,\n" +
  "# Crackling Fire, Dragon Fire Breath, Fireball Cast), 0.4 s apart. Per sound: <slug>-1-now.wav is today's preset as the app\n" +
  "# plays it, <slug>-2-new.wav the redesign; both Normalize on, NOT loudness-matched (each is what its button plays).\n\n```\n" + key.join("\n") + "\n```\n");
console.log("\nwrote " + rows.length + " x2 WAVs, all-new.wav (" + (total / SR).toFixed(1) + " s), KEY.md, fire-redo.json");
