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
- A **pro-only** feature gate (batch/family export, extra preset packs) to differentiate
  the paid desktop build from the free web version.
