# CrunchySFX — desktop build (Tauri)

The desktop app is a thin [Tauri](https://tauri.app) wrapper around the **same
`index.html`** the web version serves. One source of truth: fix a bug once, both the
web and desktop versions get it. Targets **Windows and Linux** (macOS intentionally
skipped for now).

## How it fits together

```
index.html          ← the whole app (single self-contained file)
   ├─ Web:      deploy to GitHub Pages (unchanged)
   └─ Desktop:  Tauri loads it as the frontend
src-tauri/          ← the Tauri project
   ├─ tauri.conf.json   window + bundle config; frontendDist = "../dist"
   ├─ build.rs          copies ../index.html → ../dist/index.html on every build
   ├─ src/main.rs       minimal Tauri entrypoint (no custom Rust commands)
   ├─ Cargo.toml
   └─ icons/            app icons (placeholder waveform — replace with real art)
.github/workflows/desktop-build.yml   builds Windows + Linux on each tag
dist/               ← generated copy of index.html (git-ignored)
```

`build.rs` does the `index.html → dist/` copy automatically during compilation, so you
never maintain a second copy.

## Prerequisites

- **Rust** (stable): https://rustup.rs
- **Tauri CLI**: `cargo install tauri-cli --version "^2"` (then use `cargo tauri …`), or `npm i -g @tauri-apps/cli`
- **Linux only** — system webview deps (Debian/Ubuntu names):
  ```
  sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
                       libayatana-appindicator3-dev patchelf
  ```
  (On Arch/CachyOS: `webkit2gtk-4.1 gtk3 librsvg`.)

## Local development

From the repo root:

```bash
cargo tauri dev      # run the app in a native window (hot-reloads on rebuild)
cargo tauri build    # produce installers in src-tauri/target/release/bundle/
```

Linux output: `.deb` and `.AppImage`. Windows output (built on Windows): `.exe` (NSIS
installer).

> Note: a full first build compiles the whole Tauri dependency tree and can take several
> minutes. If you hit a *compiler* ICE locally, it's a toolchain bug — the CI uses
> official stable Rust and is unaffected.

## Automated builds (recommended)

Push a version tag and GitHub Actions builds both platforms and attaches the installers
to a **draft** GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Then go to the repo's **Releases**, review the draft, and publish. You can also run the
workflow manually from the **Actions** tab (`workflow_dispatch`).

## Replacing the placeholder icon

The icons in `src-tauri/icons/` are a generated waveform placeholder. To swap in real
art, drop a square PNG (≥512×512) somewhere and run:

```bash
cargo tauri icon path/to/logo.png
```

This regenerates every size (including the Windows `.ico`) into `src-tauri/icons/`.

## Shipping to Steam / itch

- The installers from a release are your distributables.
- **Steam:** $100 one-time Steam Direct fee per app; upload the built app to your depots
  (Windows + Linux). The Steamworks SDK is optional — only needed for achievements, cloud
  saves, or the overlay (`steamworks-rs` bridges it from Rust if you add them later).
  Steam handles updates: just push new builds to the depot.
- **itch.io:** upload the installers directly; optionally use itch's `butler` to push
  updates. Tauri also has a built-in updater for non-Steam distribution.
- **Code signing (optional but nicer):** Windows/macOS show "unknown developer" warnings
  for unsigned apps. Windows code-signing certs and (if you add macOS later) Apple
  notarization remove those. Not required to ship, and Steam distribution softens it.

## Desktop-only polish ideas (optional)

- Native **Save As** dialog for WAV export (Tauri `dialog`/`fs` plugins) instead of a
  browser download.
- Tauri clipboard plugin for the **Share link** button.
- ~~A desktop-only feature gate~~: the suite's rule is that the desktop sells WORKFLOW, never sound (crunchyCore
  desktop.js). Everything the web makes stays free; see "The planted Library" below.

## The planted Library (2026-10-11)

crunchyCore's DESKTOP-ROADMAP.md step 3 (AJ's decisions §6), after crunchyTile (TILE-DESIGN.md §114) and crunchyUI
(UI-DESIGN.md §18). The worklog has the detail; in short:

- **Plant in a folder…** (the Library, a panel docked beside History; Ctrl+L): a Godot game, a Unity project or any
  folder. Each sound saved there is `crunchy/sfx/<slug>/<slug>.wav` (Unity: `Assets/Crunchy/SFX/<slug>/`), the very
  bytes Export WAV writes, beside `<slug>.crunchy` (JSON: the share string `s` that reopens it, the files it wrote,
  a fingerprint). Save (Ctrl+S, or Save preset while planted) re-exports in place; rename changes the name only;
  Update / Update all, Duplicate, Delete (its files and Godot's `.import`, nothing else), recent folders, and the
  suite view (what CrunchyTile, UI, … planted in the same game).
- **My Presets stay in the browser, untouched.** "Plant my presets" and "Plant a project file…" copy sounds in.
- **Permissions:** capabilities/default.json adds read-text, read-dir, exists, mkdir, write-text and remove to the fs
  plugin (scope `$HOME/**` and the usual places, as before). The Flatpak gets `--filesystem=home` (was
  `xdg-download:rw`): the app writes into the game's folder directly, not through a portal.
- **Proved:** `tests/` (see CLAUDE.md "How to verify"): the desktop suite over a mocked disk, a real Godot 4 import
  (`node tests/godot-check.mjs`), and the audio of every preset identical to v1.1.
- **Not yet:** a person clicking the native dialogs (AJ did for Tile and UI); a live Unity import (Unity imports WAVs
  natively, and the `.crunchy` becomes a harmless DefaultAsset with a `.meta`, but no Unity is installed here).
- **A release needs:** the version bump in the three places (ITCH-RELEASE.md: tauri.conf.json, Cargo.toml, the
  metainfo's `<release>`; `scripts/release.sh` also moves APP_VERSION and version.json), release notes naming the
  planted Library and the Flatpak's new home-folder access, and the itch page's "desktop app" lines (ITCH-RELEASE.md
  §3) brought in line with the new list in index.html's `desktopMount` call.

**Card buttons (AJ, 2026-10-11):** on SFX's card AJ expected "Update" to put the editor's sound into the card; it
re-exported the saved one. Now, the same in Tile, UI and SFX (library.js 3's `when`): **Replace** (two clicks) puts
what's in the editor into that card, same name and same files, so the game gets it (Tile: only on a card of the tab on
screen, or a kit on the Scene tab; UI: the card keeps its shape); **Re-export** shows only on a card with "update
available". The Save bar is unchanged. Each app's desktop suite proves both.

**Proved by hand (AJ, 2026-10-11, the real desktop app and native dialogs):** planted, saved sounds, replaced one from
the editor, and the card buttons: "Worked exactly as expected."

**The removal guard (crunchyCore plant.js 4, 2026-10-12; crunchyTile TILE-DESIGN §115):** a save of an existing asset
(Save, Replace, Re-export, Update all) or a Delete that would remove a file one of the game's scenes or resources uses
(Godot: its `res://` path in a .tscn/.tres/.gd/…; Unity: its GUID) stops and names the file and its users; the same press
again goes through. Found when AJ's player_test.tscn lost a Tile decoration a later save no longer made. The desktop
suite has a delete-guard row.

**Save never overwrites (crunchyCore plant.js 5, 2026-10-12; crunchyTile TILE-DESIGN §117).** AJ, testing CrunchyCharacter:
opening a planted asset, changing to another and saving replaced the first. Save now always plants a NEW asset; a taken
name gets the next number ("… 2", then "… 3"), and only a card's Replace (two clicks), Re-export and Update all write over a
planted one. The desktop suite's same-name rows prove it and make their update through Replace.

**Suite links (crunchyCore SUITE-LINKS.md §4, 2026-10-12).** A CrunchyVFX effect in the same game can use a planted sound
WHERE IT IS: its Godot scene plays `res://crunchy/sfx/<sound>/<file>.wav`, so a Replace here reaches the game with nothing
re-exported in VFX. A card says "used by 1 effect" (the linkers, read from the other tools' sidecars; the title names
them), and Delete (or a re-export that would remove the WAV) names the scene and the effect and asks again: crunchyCore
plant.js 7's guard now looks inside other tools' `crunchy/` folders and at their links. Proved by the desktop suite (48).

## Feedback, by the person's own email (2026-10-12)

**Why:** the suite needs a feedback loop, and no telemetry (AJ: "no telemetry. I hate it myself"). SFX's one network
call stays the opt-in version check; a report goes only when the person sends it from their own mail app. The canonical
write-up is CrunchyTile's TILE-DESIGN.md §118; this is SFX's adoption.

**What:** crunchyCore `feedback.js` (build 1; `crunchy-base.css` 7 for its `fb-*` look, `crunchy-icons.js` 8 for `mail`),
pulled like the other core files and registered in index.html, `src-tauri/build.rs`, the CI workflow's `cp` and (by not
being matched) `.assetsignore`. A **Feedback** button in the header, just before ⚙ Settings, opens it. The lines it
shows, each untickable: the app and version, web or desktop, the sound in the editor (its label and waveform), the planted
folder and its sound count, the browser, the last status lines (`feedback.note`, fed by `projStatus`, memory only), and the
Share dialog's own link (`buildShareUrl`, always `https://crunchysfx.com/?s=…`), OFF unless ticked. The desktop's opener
may open `mailto:*` (capabilities). SFX's index.html has no build-stamp checks, so feedback.js has no `want` here.

**Proved:** the web suite (10/10 with `feedback/the-dialog-shows-what-would-be-sent-and-the-link-is-off`: the header
button opens it with its mail icon, the Sound line is ticked, the link is shown but unticked, the earlier status line is
under Recent, the subject is "[CrunchySFX] <first line>", Close closes), the desktop suite (48), audio identical, wiring.
