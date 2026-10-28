# CrunchySFX 1.3: the plan (2026-10-27, from a read-only technical review; build after the weekly reset)

AJ: SFX "was the first, and I think the least thought out technically". 1.3 brings **layers** (2–4 engines in one
sound), a **Wizard** and **Variety** in the Godot pack. The review shows the foundation needs a small, safe pass first.
Full findings are in the review (lead's session, 2026-10-27); file:line pointers below.

> **2026-10-28: the BUGS + FOUNDATION pass is done** (bugs 1–3 and foundation 1–4 and 6; foundation 5, link versioning, is
> still open). Every existing audio hash held: the 977 v1.2 lines of `tests/audio-hash.expected.txt` are unchanged, 19 new
> `x:` lines were appended under their own `AUDIOXHASH`. Each item below says what proved it. Not committed (AJ commits).

## Bugs shipping today (fix first)

**All three FIXED 2026-10-28** (proofs inline).

1. **Breed and Variations lose a sound's text or drawing.** `mutateGenome` / `crossGenome` (index.html ~2908–2916) copy
   only PARAMS, so a bred child of a SPEECH sound goes silent and a CUSTOM-wave sound falls back to a sine. (`varyGenome`
   keeps them.)
   **FIXED:** index.html `mutateGenome` / `crossGenome` loop `SFX_EXTRAS` (a crossed child's text and drawing come from the
   parent that gave it its wave; no extra `Math.random` draw, so the PARAMS draws are the same sequence). Proved by the web
   suite rows `extras/a-bred-speech-sound-still-speaks` and `extras/a-bred-custom-wave-sound-keeps-its-drawing-and-is-not-a-plain-sine`
   (both FAIL on HEAD 32c21d8, pass now), and by the seeded audio-hash lines `x:breed:1` (speech parent), `x:breed:2`
   (drawn wave) and `x:breed:cross`: those three were the ONLY lines that differ between HEAD and now; `x:breed:0` (Laser) is
   identical, so the draw sequence did not move.
2. **`loadSnapshot` (~1004) doesn't restore those extras**, and `applyPreset` (~1852) writes ANY key into `state`
   (`riff`, unknown future keys).
   **FIXED:** `loadSnapshot` loops `SFX_EXTRAS` (and takes the entry's own audio, see foundation 3); `applyPreset` writes only
   `PARAM_KEYS` + `SFX_EXTRAS` (`riff` still goes to `riffSetPatch`, `_vary` still skipped). Rows
   `extras/an-unknown-key-in-a-preset-never-reaches-state` (negative: known keys still land) and
   `extras/load-from-history-brings-the-text-and-drawing-back-and-clears-them-for-a-sound-without`; both FAIL on HEAD.
3. **The exported synth isn't fully pure.** `renderPatch` reads the app global `customIR` (synth.js ~680), which the
   exported bundle never declares. A link with `convType: 4, convMix > 0` can throw a ReferenceError where the bundle
   runs: in CrunchyVFX (its game moment's sound links and Match a sound) and in BGM. Not yet reproduced; prove it with a test,
   then fix.
   **PROVED, then FIXED:** `tests/synth-bundle.test.mjs` loads the bundle alone in a node vm (no app globals) and renders
   `convType: 4, convMix: 0.5`. Against the old export it threw `ReferenceError: customIR is not defined`; so do BGM's
   vendored copy (v1.1.0 a0bfe25) and VFX's previous one (v1.1.0 56e16c0). Fix: synth.js `renderPatch` reads
   `opts.customIR` (none = dry, as the app with no IR loaded); the app's `render()` passes it. export-synth.py gained
   `check_no_app_globals` (any top-level index.html name the engine uses without declaring it fails the export) with a
   `--self-test` of negatives that runs on every export (a bare `customIR` read is caught; a local one, a comment, a string
   and a property are not; a `state.` read is caught). The bundle test runs that self-test too.

## The foundation (before layers): small, safe, every audio hash unchanged

1. **DONE** (see bug 3). Re-exported; VFX re-pulled (`tools/pull-synth.py --no-export`); BGM NOT touched (another session
   works there; it carries v1.1.0 a0bfe25 through its own `tools/pull-synth.py`, and still has the bug).
   **`renderPatch` truly pure:** `customIR` (and the sample) come in through `opts`. Test it by rendering a `convType: 4`
   patch with the exported bundle, then re-export the bundle to VFX and BGM.
2. **DONE:** `SFX_EXTRAS` in index.html (an object of neutral defaults, append-only, key order = link key order), looped at
   state init, restoreEdit, withState, snapshotState, sameState, applyPreset, genomeFromState, mutateGenome/crossGenome,
   loadSnapshot, encodePatch and useSample (the sample import's reset; it used to leave `customWaveB`). decodePatch is
   generic (dsp.js) and needs no list. Row `extras/share-link-history-and-undo-carry-every-extra`.
   **An `SFX_EXTRAS` table** (`customWave`, `customWaveB`, `speechText`; append-only, as VFX's `PATCH_EXTRAS`), looped at
   EVERY site: state init, restoreEdit, withState, snapshot, sameState, applyPreset (known keys only), genome, encodePatch.
   This fixes bugs 1–2 and stops future drift.
3. **DONE:** `withState(snap, fn, audio)`: `audio = { sample, ir, norm }`, each key given swaps that global for the call and
   puts it back; a key left out keeps the editor's (every old caller, byte for byte). The four hand-swapped sites (My Presets
   play / drag / batch export, `soundRender`) use it. History entries now keep their audio by reference (session only;
   `saveHistory` never writes it), so History Play / WAV / drag / Load hear the sample, IR and Normalize they were made with
   (Load replaces the editor's sample / IR only when the sound uses them). Rows
   `withstate/a-snapshot-renders-with-its-own-sample-ir-and-normalize-then-the-editor-is-untouched` and
   `history/an-entry-replays-with-the-sample-it-was-made-with`.
   **`withState` swaps the sample, IR and normalize too** (or tools call `renderPatch(snap, opts)` directly).
4. **DONE:** synth.js. The master stage moved verbatim into `masterStage(L, R, st, rawPeak, normalize)` (exported by the
   bundle); `opts.raw` returns before it (the raw render skips gain too: the mix bus applies each layer's volume).
   `opts.seedSalt` runs every fixed seed through `sd()` (the main LCG, granular, bubble, particle, impact, whoosh, additive,
   speech, the synth IRs); 0 returns the seed untouched. `tests/synth-bundle.test.mjs`: `masterStage(raw)` equals the normal
   render exactly in 46 cases (every engine, normalize on and off, limiter + reverse); salt 0 equals no salt and salt 1
   differs on every engine; a plain sine is unmoved by a salt (negative).
   **`opts.raw` (no master stage: normalize, fade, limiter, clip, reverse) and `seedSalt`,** both neutral by default.
   Layers need them: each layer must be raw audio for the mix bus, and two layers of one engine need different noise.
5. **Decide link versioning.** Proposed: layer 0 stays the top-level `s`, plus `l: [diffs]`, so older SFX, VFX and BGM play
   the primary layer. Alternatively `v: 2`, which old decoders reject. They don't check `v` today, so `decodePatch` becomes
   `v`-aware and is re-exported to VFX and BGM BEFORE layers ship.
6. **DONE except the layered set** (layers don't exist yet): `extended()` in tests/audio-hash.js adds 18 `x:` lines + an
   `AUDIOXHASH` (a loaded custom IR on 3 presets x 2 tones, granular over a sample x 2, Breed x 4 and Variations x 4, the
   pack's `.tres` and whole zip). Breed / Variations are seeded IN THE TEST by swapping `Math.random` for an LCG during the
   run, so the app stays unseeded. The same fixtures on HEAD gave identical lines except the 3 bug-1 breed lines.
   **Extend the audio hash** (tests/audio-hash.js, 983 renders today) with a layered fixture set, the pack's `.tres` and
   zip bytes, a custom IR, granular with a sample, and Breed and Variations output under a seed.

## 1.3 features

- **Layers:** `renderLayers(patch, opts)` in synth.js calls `renderPatch` per layer (raw, salted), applies each layer's
  delay, pitch (scaling `freq` and `boomFreq`) and volume, sums them on a mix bus, then runs one master stage.
  - The total length is max(delay + duration); duration caps at 2 s per layer today.
  - Imported audio (sample, granular from a sample, custom IR) goes per layer through `opts`. The project file and sidecar
    then need one sample per layer.
  - Engines that layer well: impact, whoosh, bubble, particle, modal, additive, the oscillators. Needing care: speech (fixed
    pitch, truncation), sample, granular and custom IR (not in links), custom waves (extras per layer), FM 4op (cost), pluck
    and modal (a pitch offset changes the decay).
  - Model choice: VFX's "layers" are fixed flat PARAMS slots (Layer B `emit2*`), which keeps links flat. Weigh that against a
    nested array.
- **The Wizard:** build it on the Foundry's `ARCHETYPES` and `STYLES` (~3923–3978), with a seeded random (VFX's
  `withSeededRandom`), plus an audibility and loudness check per result (VFX's `wizardMeasure`). The questions: what is it,
  how big, what material, what feel. The answer is NINE layered sounds, each opening with its layers visible.
- **Variety in the Godot pack:** `packTres` hardcodes `random_pitch = 1.0` and `random_volume_offset_db = 0.0` (~3306);
  make both controls. Verify in Godot 4.7 whether `random_pitch` is a scale or a semitone field. `tests/godot-pack.mjs`
  asserts both. Seed `makeVariations` too.

## Can wait

- Seeded Breed and Variations.
- **Rendering in a Web Worker.** Everything renders on the main thread today; Variations does about 16 renders per take, and
  layers multiply that. Profile before moving.
- Hash runs in WebKit (the desktop engine) as well as Firefox: math functions aren't guaranteed bit-exact across engines.
- Splitting the ~715-line `renderPatch` by engine; named engine constants in place of bare numbers.
- ~~A stale line in CLAUDE.md says index.html is "untracked" (it's tracked).~~ Fixed 2026-10-28.
- **For the lead / AJ (2026-10-28):** VFX's vendored synth was pinned at SFX v1.1.0 (56e16c0). Re-pulling it moves ONE line
  of VFX's frame hash, `EXPORT "sound:Hit Spark"` (+ its FRAMEHASH total): that is the 1.1 → 1.2 engine catch-up (e.g. the
  DC block), NOT 1.3: SFX HEAD's own export vendored into VFX gives the identical moved line. VFX's
  `frame-hash.expected.txt` was NOT re-recorded; that is AJ's call (VFX's rule: only for a meant change).
