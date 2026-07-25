#!/usr/bin/env bash
# CrunchySFX release script — bumps the version everywhere, commits, and pushes the tag that
# makes CI build + ship both desktop builds to itch.io.
#
#   ./scripts/release.sh 1.0.1          # do it
#   ./scripts/release.sh 1.0.1 --dry    # show what would change, touch nothing
#
# Written in bash (runs fine from fish: just `./scripts/release.sh 1.0.1`).
#
# What it automates — the 5 version locations that must agree with the tag:
#   src-tauri/tauri.conf.json          "version": "x.y.z"
#   src-tauri/Cargo.toml               version = "x.y.z"   (+ Cargo.lock)
#   flatpak/…metainfo.xml              <release version="x.y.z" …/>
#   index.html                         const APP_VERSION = "x.y.z"   (what the update check compares)
#   version.json                       served at crunchysfx.com/version.json — what the DESKTOP app
#                                      polls to decide whether to show the "update available" banner.
#                                      ⚠️ Edit its "notes" by hand before releasing — that text is
#                                      shown to users in the banner.
#
# Then: commit → push main (ships the WEB build via Cloudflare) → push tag (CI ships Windows .exe
# and the Linux Flatpak to itch). See ITCH-RELEASE.md for the full runbook and the standing rules
# (never publish the GitHub draft release; tags are immutable; never ship a locally-built binary).

set -euo pipefail

die() { printf '\033[31m✖ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✔\033[0m %s\n' "$*"; }
info(){ printf '\033[36m→\033[0m %s\n' "$*"; }

VERSION="${1:-}"
DRY=""
[[ "${2:-}" == "--dry" || "${2:-}" == "-n" ]] && DRY=1

[[ -n "$VERSION" ]] || die "usage: $0 <version> [--dry]   e.g. $0 1.0.1"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be x.y.z (got '$VERSION')"

cd "$(git rev-parse --show-toplevel)" || die "not inside a git repo"
TAG="v$VERSION"

# ---------------------------------------------------------------- pre-flight
BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)"
[[ "$BRANCH" == "main" ]] || die "on branch '$BRANCH' — releases are cut from main"

if ! git diff --quiet || ! git diff --cached --quiet; then
  die "working tree has uncommitted changes — commit or stash them first (this script makes its own commit)"
fi

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists locally — tags are immutable, use the next version"
if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists on origin — it has already shipped; use the next version"
fi

CURRENT="$(grep -m1 -oP '^version = "\K[^"]+' src-tauri/Cargo.toml)"
info "current version: $CURRENT  →  new version: $VERSION"
[[ "$CURRENT" != "$VERSION" ]] || die "version is already $VERSION"

# Fast sanity gate: does the Rust side still compile? (cheap with a warm target dir)
info "checking the Rust build…"
(cd src-tauri && cargo check --quiet --offline 2>/dev/null) \
  || (cd src-tauri && cargo check --quiet) \
  || die "cargo check failed — fix the build before releasing"
ok "cargo check passed"

# ---------------------------------------------------------------- bump versions
TODAY="$(date +%F)"

bump() {
  # bump <file> <sed-expression>
  local file="$1" expr="$2"
  [[ -f "$file" ]] || die "missing $file"
  sed -i -E "$expr" "$file"
  ok "bumped $file"
}

if [[ -n "$DRY" ]]; then
  info "--dry: showing planned changes only, nothing will be written or pushed"
fi

apply() {
  # Only the FIRST match in each file is touched (0,/…/), so dependency version
  # strings in Cargo.toml are never rewritten.
  bump src-tauri/Cargo.toml       "0,/^version = \"[^\"]*\"/s//version = \"$VERSION\"/"
  bump src-tauri/tauri.conf.json  "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$VERSION\"/"
  bump index.html                 "0,/const APP_VERSION = \"[^\"]*\"/s//const APP_VERSION = \"$VERSION\"/"
  bump version.json               "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$VERSION\"/"

  # AppStream: prepend a <release> entry (skip if this version is already listed)
  if grep -q "release version=\"$VERSION\"" flatpak/com.crunchysfx.app.metainfo.xml; then
    info "metainfo already lists $VERSION — leaving it alone"
  else
    sed -i "s|<releases>|<releases>\n    <release version=\"$VERSION\" date=\"$TODAY\"/>|" \
      flatpak/com.crunchysfx.app.metainfo.xml
    ok "bumped flatpak/com.crunchysfx.app.metainfo.xml"
  fi

  # refresh Cargo.lock so it records the new package version
  (cd src-tauri && cargo check --quiet --offline 2>/dev/null || cargo check --quiet 2>/dev/null || true)
}

if [[ -n "$DRY" ]]; then
  apply
  printf '\n\033[1m--- diff that WOULD be committed ---\033[0m\n'
  git --no-pager diff --stat
  git --no-pager diff
  printf '\n\033[33m--dry: reverting those edits now\033[0m\n'
  git checkout -- src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock \
                  flatpak/com.crunchysfx.app.metainfo.xml index.html version.json 2>/dev/null || true
  exit 0
fi

apply

printf '\n\033[1m--- changes to be committed ---\033[0m\n'
git --no-pager diff --stat

# ---------------------------------------------------------------- confirm
cat <<EOF

Reminder: version.json "notes" is shown verbatim in the in-app update banner — edit it first
if it still describes an older release.

This will:
  1. commit the version bump
  2. push main            → Cloudflare redeploys crunchysfx.com (the free web build)
  3. push tag $TAG        → CI builds + pushes to itch.io:
                              windows-latest → .exe          → sevi66/crunchysfx:windows
                              ubuntu-22.04   → .deb→Flatpak  → sevi66/crunchysfx:linux-flatpak

EOF
read -r -p "Proceed? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { git checkout -- . ; die "aborted — version bump reverted"; }

# ---------------------------------------------------------------- ship
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json \
        flatpak/com.crunchysfx.app.metainfo.xml index.html version.json
git commit -m "Release $TAG"
ok "committed"

git push origin main
ok "pushed main — crunchysfx.com will redeploy"

git tag -a "$TAG" -m "CrunchySFX $TAG"
git push origin "$TAG"
ok "pushed $TAG — CI is building the desktop releases"

cat <<EOF

$(printf '\033[32m✔ Released %s\033[0m' "$TAG")

Next:
  • Watch the build:   https://github.com/superevil6/crunchyfx/actions
  • When green:        butler status sevi66/crunchysfx
  • REMINDER: the GitHub release is a DRAFT on purpose — never publish it, or your paid
    installers become free public downloads.
EOF
