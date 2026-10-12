# CrunchySFX: project folders, a Library, and export straight into Godot and Unity

> **Superseded (2026-10-11) by the PLANTED Library** (crunchyCore DESKTOP-ROADMAP.md: AJ decided planting REPLACES
> separate project folders). There is no project folder and no link: CrunchySFX is planted in the game's own folder
> (`crunchy/sfx/<sound>/`), each sound a WAV beside a `.crunchy` sidecar. What was built, and why it differs from this
> plan (one kind, the share string not `state`, My Presets copied rather than moved), is in DESKTOP.md "The planted
> Library" and the worklog. Kept for the survey of SFX's code (§2) and the open questions (§8).

A handoff from CrunchyTile (2026-10-09). CrunchyTile's desktop tier gained these three features, and AJ wants
the same for SFX:

> "These direct exports to Unity and Godot are game changers, this single handedly makes the desktop version of
> all the applications worth it I think."

**Read these first, in order:**
1. `~/Code/crunchyTile/PROJECTS-HANDOFF.md`: the general design, the portable files, the Tauri permissions,
   the testing approach and the traps. This document doesn't repeat it.
2. `~/Code/crunchyTile/TILE-DESIGN.md` §79: what Tile built and why.
3. This file: what is different for sound, and where SFX's code already is. It is based on a survey of this
   repo on 2026-10-09. Line numbers refer to `index.html` at that date and will drift.

The rule that applies to all of it: **the desktop version sells workflow, never sound.** Everything you can make
on the web stays free and identical. Projects, the Library and engine links are desktop-only (`isDesktop`).

---

## 1. What the user gets

- **A project is a folder.** Each saved sound is a small file. The folder also holds a categories file and
  the sequences. Copy a sound's file into another project and it shows up there. The folder can be zipped
  or kept in git.
- **The Library** shows the project as cards: name, waveform, category, and a **▶ play** button (for sound,
  hearing it is the thumbnail). It has search and category filters. Each card can be opened, renamed,
  duplicated, exported or deleted.
- **Linked game projects:** link a Godot project, a Unity project, or both. Saving a sound writes its WAV
  into the game under a stable name, so `res://crunchysfx/coin_pickup.wav` updates in place, and the next
  playtest uses the new sound. **Export all** writes every sound.
- **My Presets and categories live in the open project** instead of in browser storage. That also removes
  the roughly 5 MB browser storage limit, and the silent save failures that come with it.

## 2. What SFX already has

| Need | Already in SFX | Notes |
|---|---|---|
| A saved sound | My Presets: `{id, name, state, sample?}` in `crunchyfx.userpresets.v1` (:2771). `state` is the `snapshotState()` object (:613). `sample` is base64 mono Int16. | **Store this same object in the project** (see §3). There's no need for a new format. |
| Rebuilding a sound off-screen | `withState(snap, fn)` (:507), `applyPreset` (resets, then overlays) | This is Tile's `withState` pattern: render a sound that isn't on screen without disturbing the editor. |
| Categories | `crunchyfx.usercats.v1` (:2882), holding references `{t:"b",n}` / `{t:"u",id}` | Becomes `categories.json` in the project. Keep it as references. |
| WAV encoding | `encodeWav(L,R,{rate,depth,channels,loop,title})` in `synth.js:793`, including a `smpl` loop chunk | **This is the export.** Engines read WAV natively. |
| Export settings | `exportFmt` (:521): 22.05/44.1/48 kHz × 16/24-bit, mono/stereo, loop | The project keeps its own copy, so every re-export uses the same format. |
| Stable file names | `expandNameTemplate` (:3137) and `sanitizeFilename` (:3132) | Use the plain `{name}` slug for engine export. `crunchysfx-<timestamp>.wav` can't be overwritten in place. |
| Batch to a folder | `batchExportUserPresets()` (:3154) | Close to "Export all", but without stable paths or a record of what was written. |
| Waveform thumbnail | `thumbPeaks(L)` (:618) and `drawThumb(canvas, peaks)` (:639) | Save the 96 peaks **inside the sound's file**, so the Library draws cards without rendering every sound. |
| Project file | `.crunchysfx` single file: `buildProject`/`loadProject` (:3190–3247) | Keep it as **Import/Export project file**, and offer to convert one into a folder project (§6). |
| Drag-out, update check, opener | `dragOutWav` (:582), `checkForUpdates` (:1933), the suite dialog | Unchanged. |

## 3. The project folder

```
My Game Sounds/
  crunchysfx-project.json     name, links, autoExport, the export format, the exported-file records
  sounds/<slug>.json          { name, state, sample?, peaks[96], category?, modified }
  categories.json             { cats: [{ name, items: [<sound slug> | "builtin:<preset name>"] }] }
  sequences/<slug>.json       a saved sequence, if you bring sequences in (optional for v1)
  README.txt
```

- **A sound file holds `state`, not the share string.** `encodePatch` is vendored into VFX and BGM, so it
  is frozen. Check whether it carries `customWave`, `customWaveB`, `speechText`, `riff` and `sample`. If it
  doesn't carry all of them, a share string would lose sounds. The `state` object My Presets already stores
  carries everything.
- **Samples:** a sampled sound's `sample` can be large. If it gets above a few hundred KB, store it as
  `sounds/<slug>.sample.wav` beside the JSON, as a real file, rather than base64.
- **Categories become a file of references** to sound slugs, so renaming a sound must update
  `categories.json` too. `projectRename` in `project.js` doesn't do that, so add it in SFX's glue code.

## 4. Export into a game

**Godot:** write to `res://crunchysfx/<slug>.wav`. Optionally use subfolders by category, but decide once,
because a later change moves every path.
- Godot imports WAV natively.
- Godot's WAV importer can read loop points from the file's `smpl` chunk, which `encodeWav` already writes.
  **Check this with a headless Godot** (port `~/Code/crunchyTile/tests/godot-check.mjs`): import a looping
  export and check the resulting AudioStreamWAV's `loop_mode`. Then a looping sound loops in the game with no
  import settings to touch.
- Don't write `.import` files. Godot makes them and keeps its own settings. A re-export overwrites only the
  `.wav`, so any import tweaks the user made in Godot survive.

**Unity:** write to `Assets/CrunchySFX/<slug>.wav`.
- Unity imports WAV as an AudioClip by itself.
- Don't write `.meta` files either. Unity makes them, and a re-export keeps the user's import settings and
  every reference.
- In Unity, looping is a setting on the AudioSource, not on the clip. Say so in the README written into the
  folder.

**Both:**
- The file is **exactly** what Export WAV gives for that sound in the project's format. Use one function,
  `soundFiles(asset) → [{ name, data }]`, called by the buttons and by the project alike. The desktop
  suite proves this byte for byte.
- **Re-export on save:** saving a sound in the project renders it (`withState`), encodes it and writes it
  into every linked engine. Rendering a sound takes milliseconds, so this can run on every save.
- **Rename:** the file moves, and the old one is removed from the game. Godot and Unity scenes that used the
  old path need relinking. Warn the user in the rename field.
- **Delete:** removes the sound's file from the game too, and only files this project wrote (see the
  manifest records in `project.js`).

## 5. The code

**Copy these from `~/Code/crunchyTile`:**
- `library.js`: unchanged.
- The `lib-*` block at the end of `styles.css`: unchanged. It now hides itself, which SFX needs because it has
  no global `[hidden]` rule (see the trap in Tile's handoff).
- `project.js`: copy it, then change only these parts:
  - `PROJECT_APP`: `{ id: "crunchysfx", name: "CrunchySFX", kinds: { sound: { dir: "sounds", label: "Sounds" }, sequence: … }, godotDir: "crunchysfx", unityDir: "CrunchySFX" }`.
  - `projectAssetValid`: a sound has a `name` and an object `state`.
  - `projectReadme`.
  - It calls `slugify` and `utf8Bytes`, which come from Tile's `export.js`. SFX has `sanitizeFilename`
    instead, so add the two small helpers to SFX's own code rather than editing `project.js`.
- `tests/tauri-mock.js` and the pattern of `tests/regression-desktop.js`.

**Register every new file** in all three lists: the `<script>` tags, the `FRONTEND` array in
`src-tauri/build.rs`, and the `cp` line in `.github/workflows/desktop-build.yml`. Make sure `.assetsignore`
doesn't match any of them.

**Glue code**, modelled on the "PROJECTS AND THE LIBRARY" section of Tile's `index.html`:
- `projDo` is the one queue for all file work.
- Open, New and Recent, with the last project reopened at start-up.
- `persistUserPresets` and `persistUserCats` write into the project while one is open, the same way Tile's
  `persistMyObjects` does.
- The Library's callbacks:
  - `thumb` draws the stored peaks with `drawThumb`.
  - A **Play** action plays the sound with `withState` plus the app's existing play path. Library actions
    run one at a time, so Play must return immediately.

**Tauri permissions:** SFX has `dialog:allow-open`, `fs:allow-write-file` and `fs:allow-read-file`. Add:
- `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-read-dir`, `fs:allow-exists`,
  `fs:allow-mkdir` and `fs:allow-remove`;
- `$PICTURE`/`$DOCUMENT`-style scopes as needed.

`cargo build` checks the permission names.

## 6. Moving existing users over

- **Converting a `.crunchysfx` file:** *Open project* accepts a `.crunchysfx` file and offers to turn it into
  a folder project. It writes each user preset as `sounds/<slug>.json`, the categories as `categories.json`,
  and the sequence. Single-file Save and Open stay, as Export/Import.
- **Bug to fix first:** `loadProject` (:3226) accepts only `app === "crunchysfx"`. Files saved before the
  rename say `"crunchyfx"`, including this repo's own `test.crunchyfx`, so they're refused. Accept both.
- The first time a project opens, offer to copy the browser's My Presets into it. Ask, never move silently:
  the browser keeps its copy.

## 7. Tests (SFX has no Node runner today)

- **`tests/project.test.mjs`:** Tile's runs `project.js` against an in-memory file system in Node. Port it
  with SFX's two helpers. It needs no DOM.
- **A desktop suite:** the real `index.html` with `tauri-mock.js` injected before the scripts. Settle on
  **microtasks only** so the Firefox screenshot shows the result (see Tile's tests/README).
- It should prove:
  - the WAV in the game is byte-identical to Export WAV for that sound;
  - re-export removes only files this project wrote;
  - a renamed sound's old file is gone and its category still points to it;
  - a `.crunchysfx` file (and an old `crunchyfx` one) converts into a folder project;
  - nothing is written outside the three folders (the project, Godot and Unity).
- **A headless Godot check** that a looping export loops (§4).

## 8. Decisions for AJ

1. **Godot layout:** a flat `res://crunchysfx/<name>.wav`, or subfolders by category? Recommendation: flat.
   It's simpler, and a category rename never moves files.
2. **The default export format for engines:** 44.1 kHz, 16-bit, mono is the usual game default.
3. **Sequences:** in v1, or later?
4. **OGG:** `todo.md` lists it. Godot and Unity both prefer OGG for longer sounds, but for short effects WAV
   is standard. Not needed for v1.

## 9. Order of work

1. Fix the `crunchyfx`/`crunchysfx` project check (a small change, worth doing anyway).
2. Refactor exports so one function returns the files, with the buttons only zipping or saving them.
3. `project.js` with its Node test, then the folder format, conversion from `.crunchysfx`, and My Presets
   in the project.
4. `library.js` with waveform cards and Play.
5. Engine links, re-export on save, Export all, and the headless Godot loop check.
6. A desktop suite with the mocked Tauri, and a live click-through by AJ.
