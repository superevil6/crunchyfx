# Hand-off: auto-receive a shared sound (for the CrunchyVFX & CrunchyBGM agents)

**Give this to the agent working in the CrunchyVFX and CrunchyBGM repos.**

CrunchySFX now has **"Send to CrunchyVFX"** / **"Send to CrunchyBGM"** buttons (in its Share
dialog). They open, in a new tab:

```
https://crunchyvfx.com/?s=<PATCH>
https://crunchybgm.com/?s=<PATCH>
```

`<PATCH>` is the **exact same base64url patch** a CrunchySFX share link carries — produced by
`encodePatch`, decoded by the `decodePatch` you already vendor. So there is **no new codec and no
new decode logic to write.**

## The only change needed on your side

You already decode a *pasted* CrunchySFX URL. Do the same thing **automatically on page load,
reading your own URL** instead of a paste field:

> On boot, check `location.search` for `?s=<PATCH>`; if present, run your existing import path with
> that payload. That's it — trigger the import you already have from the URL, not just from paste.

## Reference (mirror of CrunchySFX's `loadSharedSound`)

```js
function loadSharedSound(src) {
  const q = src != null ? src : (location.search + location.hash);
  const m = q.match(/[?#&]s=([A-Za-z0-9\-_]+)/);   // base64url alphabet only; stops at #/&
  if (!m) return false;
  try {
    const obj = decodePatch(m[1]);   // -> { v, s, n?, t? }   (decodePatch is already vendored)
    importSound(obj.s, obj.t);       // <-- YOUR existing import path (reuse it verbatim)
    return true;
  } catch (e) { console.warn("bad ?s= link:", e.message); return false; }
}
// run once at startup:
loadSharedSound();
```

## Payload contract (what `decodePatch` returns)

- `obj.s` — the sound. **It is a SPARSE DIFF**, not a full patch: only the params that differ from
  defaults, plus the non-PARAM keys `customWave` / `customWaveB` / `speechText` / `riff` when used.
  **Reset to your full default param set FIRST, then overlay `obj.s`** before rendering with
  `renderPatch(state)` — exactly what CrunchySFX's `applyPreset` does, and what your paste path
  already does. Reuse that path; don't re-implement it.
- `obj.t` — optional display name (string), e.g. `"Laser Zap"`. Show it if useful; safe to ignore.
- `obj.n` — normalize flag. `obj.n === 0` means loudness-normalize is OFF; absent means ON (default).
- `obj.v` — payload version (currently `1`).

## CrunchyBGM only: reuse one tab instead of piling up new ones

CrunchySFX opens BGM with a **named window target** (`window.open(url, "crunchybgm")`), so a second
"Send to CrunchyBGM" reuses the existing BGM tab instead of spawning another. For that to be robust,
do two things on the BGM side:

1. **Advertise the name on load** so *any* BGM tab is targetable (even one opened manually), not just
   ones opened via the button:
   ```js
   window.name = "crunchybgm";   // run once at startup
   ```
2. **Handle an incoming sound additively (recommended).** Reusing the tab NAVIGATES it, which reloads
   the page and would discard whatever the user was working on. If instead BGM *adds* the incoming
   `?s=` sound to a list/track rather than resetting, the single-tab reuse becomes non-destructive.
   (If BGM sounds are inherently one-at-a-time, you can skip this and accept the reload.)

Caveats to know: this is best-effort and same-browser only; it will not cross browsers or normal/
private windows. CrunchyVFX is intentionally left as new-tab-per-send (one word to change if you ever
want it to reuse too).

## Not needed yet

Desktop (Tauri) hand-off is deferred on the CrunchySFX side — this is **web-only** for now
(`window.open` to your `.com`). Nothing to do on your end for desktop.

## Quick test

In CrunchySFX: Share → Copy link (gives `https://crunchysfx.com/?s=<PATCH>`). Swap the host to
yours and open it:

```
https://crunchyvfx.com/?s=<PATCH>
```

The sound should auto-import on load, no paste step. If it doesn't, check: (1) `loadSharedSound()`
is actually called at startup, (2) the `?s=` regex matched, (3) `obj.s` was overlaid on defaults
(not fed to `renderPatch` as a bare diff).
