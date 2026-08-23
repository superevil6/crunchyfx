# Shipping a Windows installer (Tauri → itch.io) — playbook for the sibling apps

**Give this to the agent working in CrunchyBGM (and CrunchyVFX).** It documents exactly how
CrunchySFX builds and ships its Windows installer, including the mistakes we hit and fixed, so you
can replicate it. The pipeline is identical across the three apps — only names/slugs/file-lists differ.

## The model

- **Free web** (Cloudflare) + **paid desktop** (Tauri). The Windows build is an **NSIS `.exe`
  installer**, built in CI and uploaded straight to itch.io's `:windows` channel via **butler** — the
  paid binary never sits on a public surface.
- **Trigger = a git tag** `vX.Y.Z`. Pushing the tag fires the CI workflow; that's the whole release.
- The GitHub Release the CI creates is a **DRAFT and must stay a draft** — publishing it turns your
  paid installers into free public downloads.

---

## The pieces (what must exist in the repo)

```
src-tauri/
  Cargo.toml            # crate name + version; tauri + plugin deps
  tauri.conf.json       # productName, identifier, version, frontendDist, bundle.targets
  build.rs              # copies EVERY frontend file into ../dist before the build  ← see GOTCHA 1
  src/main.rs           # Tauri entrypoint (+ Linux webview setup hook)
  capabilities/         # Tauri v2 ACL (dialog/fs/etc.)
  icons/                # MUST include icon.ico for the Windows NSIS installer
.github/workflows/desktop-build.yml   # the CI that builds + ships
scripts/release.sh      # bumps versions, commits, pushes main + tag
```

### `tauri.conf.json` — the Windows-relevant fields
```jsonc
{
  "productName": "CrunchySFX",              // -> "CrunchyBGM"
  "version": "1.1.0",                        // bumped by release.sh
  "identifier": "com.crunchysfx.app",        // -> "com.crunchybgm.app"  (must be unique per app)
  "build": { "frontendDist": "../dist" },    // Tauri bundles whatever is in ../dist
  "app": { "withGlobalTauri": true, "windows": [{ "label": "main", "title": "…", "width": 1600, "height": 950 }] },
  "bundle": {
    "active": true,
    "targets": ["nsis", "deb", "appimage"],  // "nsis" = the Windows installer
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.png", "icons/icon.ico"]  // .ico REQUIRED for Windows
  }
}
```

### `build.rs` — copies the frontend into `../dist` on every build
```rust
fn main() {
    let _ = std::fs::create_dir_all("../dist");
    // LIST EVERY FRONTEND SIBLING FILE. Missing one = the packaged app 404s it and throws at
    // startup. For CrunchySFX that's five files (synth.js is the vendored engine bundle):
    for f in ["index.html", "presets.js", "dsp.js", "synth.js", "styles.css"] {
        std::fs::copy(format!("../{f}"), format!("../dist/{f}")).unwrap();
        println!("cargo:rerun-if-changed=../{f}");
    }
    tauri_build::build();
}
```

### `.github/workflows/desktop-build.yml` — the Windows path
Triggers on `push: tags: ["v*"]` (+ `workflow_dispatch`). `env: ITCH_TARGET: <user>/<project-slug>`.
Matrix includes `windows-latest`. The Windows-specific steps:

1. **Prepare frontend** (`cp` the frontend files into `dist/`). ← must list ALL files, see GOTCHA 1.
2. **tauri-action@v0** builds the app and creates a **draft** GitHub release (`releaseDraft: true`).
   The NSIS installer lands at `src-tauri/target/release/bundle/nsis/<Product>_<ver>_x64-setup.exe`.
3. **Install butler** (tag pushes only):
   ```pwsh
   curl.exe -sL --retry 5 --retry-all-errors --retry-delay 5 --connect-timeout 30 `
     -o butler.zip https://broth.itch.zone/butler/windows-amd64/LATEST/archive/default   # NOT .ovh, see GOTCHA 2
   Expand-Archive -Force butler.zip -DestinationPath butler-bin
   "$PWD\butler-bin" | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8
   ```
4. **Push to itch** (tag pushes only), guarded on the `BUTLER_API_KEY` secret:
   ```bash
   butler push src-tauri/target/release/bundle/nsis/CrunchySFX_*_x64-setup.exe \
     "$ITCH_TARGET:windows" --userversion "${GITHUB_REF_NAME#v}"   # glob UNQUOTED so the shell expands it
   butler status "$ITCH_TARGET"
   ```

### `scripts/release.sh` — the one command that cuts a release
Guards (on `main`, clean tree, tag not already used, `cargo check` passes), then bumps the version in
**every** location that must agree with the tag, commits `Release vX.Y.Z`, pushes `main`, tags, pushes
the tag (which fires CI). For CrunchySFX those locations are: `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` (+ `Cargo.lock`), `index.html` (`APP_VERSION`), `version.json`, and the Flatpak
metainfo. **BGM will have its own set — audit yours and make release.sh bump all of them.**

---

## One-time setup (before the first Windows release)

1. Create the itch project (a **Downloadable** project; you'll push a Windows channel to it).
2. Generate a butler **API key** (itch.io → Settings → API keys) and add it as a GitHub repo secret
   named **`BUTLER_API_KEY`**.
3. Set `env: ITCH_TARGET` in the workflow to `<itch-user>/<project-slug>` (must match the itch URL).
4. Make sure `src-tauri/icons/icon.ico` exists (NSIS needs it) and `identifier` is unique to the app.
5. itch **AI-content disclosure**: tick **"Yes → AI Generated Code"** (itch has no dev-tool exemption;
   inserting AI-written code counts). Graphics/Sound/Text remain human/DSP.

## Cutting a release

```bash
./scripts/release.sh 1.1.0     # bumps versions, commits, pushes main + tag
```
The script shows the diff and asks `y/N` before pushing. **It needs your git credentials — run it
yourself in a terminal; an agent sandbox usually can't authenticate to push.** Then:

1. Watch the run at `github.com/<you>/<repo>/actions` — wait for the Windows job to go **green**.
2. Confirm the upload: `butler status <user>/<project-slug>` → the version should show on `windows`.
3. **Do NOT publish the draft GitHub release.** Leave it as a draft.
4. The web build (if you have one) redeploys from the `main` push separately.

---

## GOTCHAS WE ACTUALLY HIT (read these)

**1. `build.rs` (AND the CI "Prepare frontend" step) must copy EVERY frontend file.**
CrunchySFX extracted its synth engine into `synth.js`, but `build.rs` still listed only the old four
files → the packaged app 404'd `synth.js` and threw `ReferenceError: renderPatch is not defined` at
startup (blank/broken app). Fix: add every sibling file to the `build.rs` array **and** to the
workflow's `cp` line. (In CrunchySFX the workflow's `cp` line is *still* stale at four files but is
saved by `build.rs` running during the cargo build — don't rely on that; list them in both.)
**BGM: enumerate your real frontend files — your index.html, the vendored synth engine bundle, your
data/preset file(s), your styles — in both places.**

**2. butler's download host moved: `broth.itch.zone`, NOT `broth.itch.ovh`.**
`broth.itch.ovh` (and its parent `itch.ovh`) were **retired and now return NXDOMAIN globally**, so the
"Install butler" step failed with `curl: (6) Could not resolve host` on both runners. Use
`https://broth.itch.zone/butler/<platform>/LATEST/archive/default`, and add curl's
`--retry 5 --retry-all-errors --retry-delay 5` so transient CDN hiccups self-heal.

**3. The GitHub release stays a DRAFT.** `releaseDraft: true` is deliberate. Never click "Publish
release" — the draft holds the raw `.exe`, and publishing makes your paid installer a free download.

**4. Tags are immutable-by-convention.** `release.sh` refuses a tag that already exists. If a build
fails on a workflow/config bug (not the app), the clean recovery — since nothing shipped to itch —
is to commit the fix to `main`, then **move the tag onto it** and force-push it, which re-triggers CI:
```bash
git push origin main
git tag -f -a vX.Y.Z -m "…"
git push --force origin vX.Y.Z
```
(If the draft release blocks re-creation, delete that draft in the GitHub UI first.)

**5. A tag-triggered build uses the workflow file AS IT WAS AT THE TAGGED COMMIT.** Fixing the
workflow on `main` does **not** help the current tag's run until you move the tag onto the fix
(gotcha 4). Re-running the failed job alone re-uses the old workflow.

---

## BGM adaptation checklist (rename pass)

- [ ] `tauri.conf.json`: `productName` → CrunchyBGM, unique `identifier`, window `title`.
- [ ] `Cargo.toml`: `name`/`description` (crate name can stay whatever compiles — it's the binary
      name, not the product name).
- [ ] `build.rs`: list **BGM's** actual frontend files (incl. its vendored synth engine bundle).
- [ ] Workflow: `ITCH_TARGET` → `<you>/crunchybgm`, `releaseName`, and the `butler push` glob to match
      BGM's installer filename (`CrunchyBGM_*_x64-setup.exe`).
- [ ] `release.sh`: bump **BGM's** version locations (audit them — they differ from SFX's).
- [ ] `icons/icon.ico` present; `BUTLER_API_KEY` secret set; itch project + slug created.

CrunchySFX also has deeper docs (`ITCH-RELEASE.md`, `DESKTOP.md`) if you want the full Linux/Flatpak
and store-page detail — ask the maintainer to share those too. This file covers the Windows path.
