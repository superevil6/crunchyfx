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
5. **DECIDED 2026-10-28 (with layers):** layer 1 stays the top-level `s`; layers 2+ ride in `s.layers`, so `v` stays 1
   and every older reader (SFX before 1.3, VFX, BGM) plays layer 1 and ignores the rest. The re-exported bundle's
   `render` plays every layer. (The `v: 2` alternative was not needed.)
   **Decide link versioning.** Proposed: layer 0 stays the top-level `s`, plus `l: [diffs]`, so older SFX, VFX and BGM play
   the primary layer. Alternatively `v: 2`, which old decoders reject. They don't check `v` today, so `decodePatch` becomes
   `v`-aware and is re-exported to VFX and BGM BEFORE layers ship.
6. **DONE except the layered set** (layers don't exist yet): `extended()` in tests/audio-hash.js adds 18 `x:` lines + an
   `AUDIOXHASH` (a loaded custom IR on 3 presets x 2 tones, granular over a sample x 2, Breed x 4 and Variations x 4, the
   pack's `.tres` and whole zip). Breed / Variations are seeded IN THE TEST by swapping `Math.random` for an LCG during the
   run, so the app stays unseeded. The same fixtures on HEAD gave identical lines except the 3 bug-1 breed lines.
   **Extend the audio hash** (tests/audio-hash.js, 983 renders today) with a layered fixture set, the pack's `.tres` and
   zip bytes, a custom IR, granular with a sample, and Breed and Variations output under a seed.

## 1.3 features

> **2026-10-28: LAYERS ARE IN** (not committed). What was built:
>
> **The engine** (synth.js, all pure):
> - `renderLayers(base, layers, opts)` is the mix bus. Each layer renders raw with `seedSalt + i`. With Normalize on,
>   each is brought to the same peak, then weighted by its own Gain (relative to the 0.7 default) and its mix volume.
>   Pitch scales `freq` and `boomFreq`. Layers sum at their delays (0-2 s) and one master stage runs, layer 1's.
> - `renderSound(snap, defaults, opts)` renders a whole sound from its link shape (`layers` a JSON string of
>   `{ s: diff, d, g, p, m }`; absent, "" or unreadable is exactly `renderPatch`). At most 4 layers.
> - The bundle's `render` is `renderSound` with its DEFAULTS, and it publishes `renderLayers`.
>
> **The app** (index.html):
> - `state` is the SELECTED layer, so every control works unchanged. `layerSel` / `layerBase` / `soundSnap()` put the
>   whole sound back together for render, snapshots, History, Undo (which returns to the layer the edit was on), links,
>   My Presets, project files and planted sounds.
> - `layers` is deliberately NOT an SFX_EXTRA: genomes never carry it.
> - A preset, Randomize, Breed, Variations, Foundry or a Kit sound replaces the selected layer. A whole sound (it says
>   `layers`: a link, History, My Presets, a project, a planted sound) replaces all. A preset on one layer of a layered
>   sound keeps the sound's name.
> - The layer bar over Quick shape: tabs named by engine, + Layer (a copy an octave down), Solo, and a layer 2+'s
>   Delay / Volume / Pitch / Mute / Remove.
>
> **Proved:**
> - The audio hash: all 996 earlier lines identical, plus 4 `x:layers` lines (three layers, muted, Normalize off, two
>   layers of one engine).
> - synth-bundle 50/50 (layers through the bare bundle).
> - Web 48/48 (6 `layers/` rows); desktop 52/52 (the v1.1 store and files open as before); wiring.
> - godot-check 10 and godot-pack 7 in real Godot.
>
> **Not yet:**
> - Variations (and so the Godot pack) of a layered sound vary and render the SELECTED layer alone.
> - The riff transposes layer 1 only.
> - One imported sample and one IR serve every layer.
> - VFX and BGM play layer 1 until they re-pull the bundle (VFX: re-pulling moves one frame-hash line, AJ's call, below).
> - The Wizard, built on layers, is next.

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
> **2026-10-28: THE WIZARD IS IN** (not committed), after AJ's layered presets ("Everything sounds great!"):
>
> **The flow.** A header button (wand); three questions; nine LAYERED results.
> - What is it: 11 kinds, Gunshot … Monster.
> - What's it made of: any of 10 materials.
> - Which era: the Foundry's STYLES.
>
> **Building a result.**
> - A kind is a recipe of ROLES, `WIZ_KINDS`: a gunshot is a crack + a body + a thump, plus maybe a casing. `keep` is
>   the roles a material never replaces; an `extra` role fills a free place.
> - Each role is filled from `WIZ_PARTS`, hand-written recipes in the Foundry's way (a patch + `_vary`; several reuse
>   its ARCHETYPES). Each material brings its own layer. Materials take turns across the nine when they outnumber the
>   places (at most 4 layers).
> - Every layer is varied and re-rolled until audible (`audiblePatch`), then shaped by the era (`styleShaper`).
> - **Seeded:** `wizSeeded` swaps in an LCG for `Math.random` during composing, so the same answers and seed give the
>   same nine. "More like these" is the next seed.
>
> **The POWER dial (1-9 on the results, AJ's from VFX).** 5 is as designed.
> - Up: longer, roomier, hotter, 5 semitones lower at 9, louder low layers, and a sub layer at 8+.
> - Down: shorter, drier, higher. 1-2 are two layers: the first and, when chosen, a material.
>
> **The cards.** Each card's ingredients are listed ("crack · grit · thump · metal ring"). Play renders that one only
> (VFX's lesson). A click loads the whole sound, every layer, as one undo step, and the layer bar shows how it is
> built. Names: power word + a material's or part's word + one of the kind's nouns, never echoing ("Blasting Blast").
>
> **Measured:** 100-220 ms to compose nine; 8-31 ms to render one when played.
>
> **Tests:**
> - web 54/54, 6 `wizard/` rows: the flow and nothing rendered until Play; 891 results (every kind x 3 material mixes
>   x power 1/5/9) at most 4 layers, every layer audible, materials carried, nine names; seeded; power longer / lower /
>   fewer when tame; a load is whole and one undo; 8-Bit shapes every layer.
> - audio hash: every line unchanged + 3 `x:wizard` lines (stable over two runs).
> - desktop 52/52; wiring.
>
> **Listen:** `~/.cache/crunchy-wip/sfxlayers/wizard-wav/`.
>
> **Next:** AJ's ears on the parts; a few more kinds (footstep, door, alarm); the Foundry's kinds pointing here.

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
