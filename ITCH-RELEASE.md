# CrunchySFX — itch.io release kit

LIVE at **https://sevi66.itch.io/crunchysfx** ($6 desktop) · free web at **https://crunchysfx.com/**.
Model: free in the browser, pay for the desktop app.

Sections 1–7 below are the original launch setup (mostly historical now). **For shipping an
update, use the runbook directly below — that's the part you'll actually reuse.**

---

# 🚀 SHIPPING AN UPDATE (the happy path)

Example: you've written some code and want it out as **v1.0.1**.

### 1. Write + verify the change
```fish
# headless verification (project convention — see CLAUDE.md "How to verify a change")
# and for anything desktop-side, confirm it runs natively:
cd src-tauri; cargo build --release; ./target/release/crunchyfx
```

### 2. Bump the version in THREE places (they must match the tag)
- `src-tauri/tauri.conf.json` → `"version": "1.0.1"`
- `src-tauri/Cargo.toml` → `version = "1.0.1"`  (this also updates `Cargo.lock`)
- `flatpak/com.crunchysfx.app.metainfo.xml` → add `<release version="1.0.1" date="YYYY-MM-DD"/>`

### 3. Commit + push `main`  → this ships the WEB version
```fish
git add -A
git commit -m "…"
git push origin main
```
Cloudflare redeploys **crunchysfx.com** from `main` automatically. *If your change is web-only,
you're done here — no tag needed.*

### 4. Tag + push the tag  → this ships BOTH DESKTOP builds
```fish
git tag v1.0.1
git push origin v1.0.1
```
CI (`.github/workflows/desktop-build.yml`) then does everything:

| Runner | Builds | Ships to |
|---|---|---|
| `windows-latest` | `.exe` (NSIS) | `butler` → `sevi66/crunchysfx:windows` |
| `ubuntu-22.04` | `.deb` → **Flatpak** | `butler` → `sevi66/crunchysfx:linux-flatpak` |

It also attaches `.exe` / `.deb` / `.AppImage` to a **DRAFT** GitHub release.

### 5. Verify (~10–20 min later)
```fish
butler status sevi66/crunchysfx      # both channels should show the new version
```
- Actions tab: the run is green.
- itch page shows the new build.
- Buyers using the **itch app** auto-update. Web users already got it in step 3.

---

## ⚠️ The rules that will bite you if you forget

1. **NEVER click "Publish release" on the GitHub draft.** Draft = only you can see it. Publishing
   makes your **paid** installers free public downloads. The draft is just your private archive.
2. **Tags are immutable once pushed.** If CI fails, fix the problem and ship **v1.0.2** — don't try
   to reuse a tag that already ran.
3. **Never upload a locally-built Linux binary.** It links CachyOS's bleeding-edge glibc/GL and will
   break on other distros. Local builds are for *your* testing only; CI's ubuntu-22.04 build is the
   one that ships. (See the glibc/AppImage notes in `flatpak/com.crunchysfx.app.yml`.)
4. **Don't "modernise" the Linux runner to `ubuntu-latest`.** ubuntu-22.04 (glibc 2.35) is
   deliberately OLDER than the GNOME 46 Flatpak runtime (2.37). Bumping it reintroduces
   ``version `GLIBC_2.39' not found``.
5. **Version bump before tagging** — if `tauri.conf.json` says 1.0.0 but the tag says v1.0.1, the
   installers claim the wrong version.
6. The **AppImage is built but NOT sold** — it stays on the draft release until verified on a
   non-bleeding-edge machine. Flatpak is the Linux product.

---

## Original launch setup (historical)

### 0) Pre-flight — ✅ DONE (kept for reference)

- [x] Commit + push the work so crunchysfx.com matches the itch build.
- [x] Remove the dangling `new_presets.js` reference (the file was deleted outright).
- [x] Decide **pricing** ($6, paid desktop / free web) and **launch scope**.

---

## 1) What to upload  (DECISION: no HTML embed — link to the live site instead)

The free web version already lives at **https://crunchysfx.com/**, so the itch page is a
**Downloadable** project (paid desktop installers) that **links to the site** for the free
browser version. Bonus: no HTML embed = no embed `params` = the "expected type table, got nil"
save error can't happen.

**Desktop builds** (the only uploads):
  - Push a version tag → your CI builds them: `git tag v1.0.0 && git push origin v1.0.0`
    → GitHub Actions produces a **draft Release** with the Windows installer + Linux `.deb`/`.AppImage`.
  - Publish the draft release, download the installers, upload each to itch (tag platform:
    Windows / Linux). macOS isn't built (not a target).
  - Optional but nicer: use **butler** (itch's CLI) to push builds — see §5.

**Linux — ship BOTH:**
  - **AppImage** (from CI) for mainstream distros (Ubuntu/Fedora/Mint/Pop). Note: the CI AppImage's
    bundled GL libs hit a WebKitGTK `EGL_BAD_PARAMETER` / blank-page bug on bleeding-edge Arch/Wayland.
  - **Flatpak** (`flatpak/com.crunchysfx.app.yml`) — robust everywhere incl. Arch/CachyOS/Steam Deck
    (the Flatpak runtime brokers GPU drivers, sidestepping that bug). Build from the CI `.deb`; the
    manifest header has the exact build/bundle commands. Upload the single `CrunchySFX-*.flatpak`
    file to itch, platform-tagged Linux.

*(The `dist-itch/crunchysfx-web.zip` build is no longer needed for itch — keep it as a backup or
delete it.)*

---

## 2) Project page fields

- **Title:** `CrunchySFX`
- **Short tagline (one line):**
  `A from-scratch sound-effect generator — 15+ synth engines, 600+ presets, public-domain (CC0) output. Free in your browser.`
- **Classification:** Tool  ·  **Kind of project:** **Downloadable** (no HTML embed).
- **Genre:** (leave "No genre" or "Other") — it's a tool, not a game.
- **Tags:** `sound-effects`, `audio`, `sfx`, `tool`, `generator`, `gamedev`, `synthesizer`,
  `procedural-generation`, `chiptune`, `retro`, `cc0`, `public-domain`  *(itch caps tags ~10)*
- **Link to the free web version:** put a prominent **▶ Play free in your browser →
  https://crunchysfx.com/** line at the top of the description (itch has no dedicated "website"
  button beyond the description / app-store-link fields). Also add the Steam page when live.
- **Community:** enable Comments (good for a tool).

---

## 3) Description (paste into the itch rich-text editor, adapt freely)

> **CrunchySFX is a from-scratch sound-effect generator, and everything you make is public
> domain (CC0 1.0).** Every sound is synthesized by a hand-written DSP engine — no sample
> libraries, no AI models, no cloud. The coins, lasers, explosions, UI blips, bells, voices and
> textures you create are **yours to use for anything, commercial or not, no attribution, no
> royalties, forever.**
>
> In the tradition of sfxr/bfxr, but far beyond classic chiptune — **15+ synthesis engines:**
> subtractive, FM & 4-operator FM, Karplus-Strong pluck, modal/bell resonators, granular,
> a formant vocal model with text-to-speech, additive pads, impact/whoosh/particle foley, and a
> draw-your-own wavetable. **600+ ready presets** across 23 categories, one-click WAV export,
> shareable "sound-as-a-URL" links, procedural **breeding** for variations, and a **Foundry** that
> generates + re-voices sounds on 11 retro console chips.
>
> **▶ Play it free in your browser at https://crunchysfx.com/** — nothing to install.
>
> **Get the desktop app** (this page) for the power workflow: a persistent **My Presets** library, drag-organized
> **custom categories**, **batch export**, project files, mic recording, variation packs, and native
> drag-out of WAVs into your editor/DAW.
>
> Made by one developer. No samples. No AI at runtime. Pure synthesis.

**Recommended screenshots to capture (4–6):** the main editor with the Engine grid + Quick Shape;
the Foundry modal (8 candidates); the Console re-voice row; the preset browser with custom
categories; the waveform scope on a rich sound. **Cover image:** reuse/adapt `og.png` (1200×630;
itch cover is 630×500 — crop the wordmark + waveform motif).

---

## 4) Pricing (recommended)

itch keeps the **HTML5 embed free to play** regardless of download price, so the two-path model
just works:

- **Recommended: set a minimum price on the project (e.g. $4–6), "web build free to play."**
  Browser users play free; the **desktop downloads require the purchase** — the exact Steam model,
  but with no $100 gate and you can launch tonight. You can flip individual uploads to "free" if you
  ever want a free desktop demo.
- **Alternative: "Pay what you want"** ($0 minimum, suggested $5) — maximum reach, downloads are
  free but nudge a tip. Good for building an audience first, monetize later.
- itch revenue share is **whatever you choose** (default 10%; adjustable), plus payment processing.

---

## 5) butler (CLI uploads, easy updates)

```sh
# install (Arch/CachyOS): paru -S butler   —   or the official download:
curl -L -o /tmp/butler.zip https://broth.itch.zone/butler/linux-amd64/LATEST/archive/default
unzip -o /tmp/butler.zip -d ~/.local/opt/butler && chmod +x ~/.local/opt/butler/butler
ln -sf ~/.local/opt/butler/butler ~/.local/bin/butler && butler -V   # ~/.local/bin already on PATH
butler login                         # opens browser for an API key
```

**Windows** is pushed automatically by CI (the `BUTLER_API_KEY` secret + the push step in
`.github/workflows/desktop-build.yml`), so there's nothing to run by hand for the `.exe`.

### ▶ LINUX — run these BY HAND once each Linux build exists

Linux isn't in CI: the **Flatpak** is built locally (see `flatpak/com.crunchysfx.app.yml`), and the
**AppImage** must be verified on a non-RDNA4 machine before shipping (it blank-screens on bleeding-edge
GPUs — see the notes in §1). So push them manually as they become ready:

```sh
# ── Flatpak (PREFERRED Linux format — robust on Arch/CachyOS/Steam Deck/new GPUs)
#    built via: cd flatpak && flatpak-builder … && flatpak build-bundle repo CrunchySFX-1.0.0.flatpak com.crunchysfx.app
butler push CrunchySFX-1.0.0.flatpak          sevi66/crunchysfx:linux-flatpak

# ── AppImage (from the CI draft release) — ONLY after it's confirmed to render somewhere
butler push CrunchySFX_1.0.0_amd64.AppImage   sevi66/crunchysfx:linux

# ── .deb (optional, for Debian/Ubuntu folks who prefer a system package)
butler push crunchysfx_1.0.0_amd64.deb        sevi66/crunchysfx:linux-deb

# verify what's live on every channel
butler status sevi66/crunchysfx
```

**Notes**
- Replace `sevi66/crunchysfx` with your actual page slug if it differs.
- Channel names containing `linux` auto-tag the upload as Linux — keep the `linux…` prefix.
- Use the **real filenames** (versions change): `ls flatpak/*.flatpak` and the CI release assets.
- After pushing, on the itch page label the uploads so buyers pick correctly, e.g.
  *"Flatpak — recommended (Arch, Steam Deck, newest GPUs)"* and *"AppImage — most distros"*.
- `butler push` is incremental (diff-based), so re-pushing an updated build only uploads the delta.

---

## 6) AI-content disclosure — itch is stricter than Steam here

**Do NOT tick "No AI" on itch.** itch's policy has **no dev-tool/workflow exemption** (unlike
Steam's Jan-2026 clarification). itch's founder drew the line explicitly: asking an AI a question
to inform yourself = no; **inserting AI-generated code into your project = yes, it contains
generative-AI content.** "Code" is one of the four disclosure categories (Graphics / Sound / Text
& Dialog / **Code**), and this project's codebase includes AI-written code. Your GitHub repo is
**public**, so a "No AI" tag that contradicts your own commit history is a real reputational risk
on a platform whose community polices AI-mislabeling.

**Recommended answer:** tick **"Yes" → select only "AI Generated Code"** (leave Graphics / Sound /
Text unchecked — those are all human/DSP, and that's accurate). Then lead the description with the
true, stronger claim:

> *"Every sound is DSP-synthesized — no AI models, no samples, ever. (Some of the app's own code
> was written with AI assistance.)"*

That keeps your real USP (pure-synthesis, CC0, no-samples output) intact and 100% honest, while
being transparent about code. "AI-assisted code" is far less loaded on itch than AI *art* — nobody
is buying your source.

**Note — Steam vs itch can differ honestly.** Disclosure is **mandatory only for asset packs** on
itch; for a *tool* it's voluntary, so you *could* leave the field unset + put the one-liner in the
description. And your Steam "No" (dev-tool exemption, survey is about generated assets/gameplay) and
itch "Yes → Code" (no exemption, code is a category) can both be honest because the two platforms
define the question differently — an easy, defensible explanation if anyone asks. Keep the *facts*
consistent across both.

---

## 7) Publish checklist

- [ ] **Kind of project = Downloadable** (no HTML upload), desktop installers attached + platform-tagged.
- [ ] Prominent **▶ Play free in your browser → https://crunchysfx.com/** link near the top of the description.
- [ ] Cover + 4–6 screenshots added; pricing (min ~$5) + AI disclosure (Yes → AI Generated Code) set.
- [ ] Download + run one installer to sanity-check it launches.
- [ ] Flip **Visibility → Public**. Grab the page URL for the guerrilla-marketing links.
