# tools/

Developer tooling. Nothing here ships — the app never loads any of it.

## The synth export

CrunchyVFX synthesises its matched sounds with **this** engine, not a reimplementation of it. The
boundary is one generated file:

```sh
python3 tools/export-synth.py        # -> synth-export/crunchysfx-synth.js
```

That bundles `dsp.js` + `synth.js` + the canonical `PARAMS` defaults into an IIFE exposing a
single `CrunchySynth` global, with a version, the source commit, and a sha256 of the payload in
the banner. The consumer never runs this directly — in the crunchyvfx repo,
`python3 tools/pull-synth.py` runs it here and vendors the result, so "pull" always means *what
this repo looks like right now*.

**The engine must stay pure.** `synth.js` and `dsp.js` may not touch the DOM, `window`,
`localStorage`, or the app's global `state`, and may not reference a constant that only
`index.html` declares. All of that works fine in the app — one shared global scope — but becomes a
`ReferenceError` inside the bundle's IIFE. `export-synth.py` refuses to export when it sees any of
it, which is how `CONV_MAKEUP` and `CUSTOM_DEFAULT_DRAWN` were caught (both now live in `dsp.js`,
where they belong: the engine is what reads them).

Anything that needs app state is passed in instead:

```js
renderPatch(patch, { sample, normalize })   // -> { L, R, rawPeak }
```

`index.html` keeps a one-line `render()` wrapper binding the editor's `state`, the loaded sample
and the Normalize toggle to it.

## Verifying it

```sh
firefox tools/verify-synth.html
```

Loads the app's real engine *and* the exported bundle in one page — they can coexist because the
bundle is namespaced — then renders all 736 presets through both and asserts the audio is
identical, plus every waveform, the `sample`/`normalize` options, and `encodeWav` across six
formats. Green banner = the export is faithful. Run it after any change to `dsp.js` or `synth.js`.

It is deliberately synchronous: a headless `--screenshot` fires at `window.load`, so a result
behind an `await` would never appear in the shot.

## A note on the extraction

`synth.js` was carved out of `index.html` and is meant to be *byte-identical in behaviour*. That
was verified by hashing every preset's rendered audio (and encoded WAV) before and after against
the pre-extraction commit — 780 checks, all identical. If you refactor in here, do the same:
render everything, hash it, compare. Ear-checking a few presets will not catch a drifted filter
coefficient in a preset you did not think to try.
