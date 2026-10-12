"use strict";
// CrunchySFX — THIS APP'S PART OF THE PLANTED LIBRARY (crunchyCore plant.js, DESKTOP-ROADMAP.md step 3). plant.js is
// the suite's shared core (byte-identical in every tool, pulled by tools/pull-core.mjs); everything about a planted
// asset that is CrunchySFX's own is this one object, loaded BEFORE plant.js. Pure: no DOM, no app state.
//
// ONE KIND, a SOUND: `crunchy/sfx/<slug>/<file>.wav` (exactly what Export WAV writes for it) beside `<slug>.crunchy`.
// The sidecar's fields (index.html's planted block writes them):
//   s           the share string (encodePatch: the same ?s= a link carries): reopens the sound exactly
//   exportName  the name it was FIRST planted under: the WAV's INAM title, so a rename never changes the bytes
//   wav         the WAV's file name, fixed at the first save, so a rename never moves the file
//   fmt         { rate, depth, channels, loop }: the export format it was saved in (Update re-renders in it)
//   sample      (optional) the imported/recorded audio a "sample" or granular sound plays, as My Presets keeps it
//                (base64 mono Int16): a share link cannot carry audio, a sidecar can
//   categories  (optional) the names of the My Presets categories it was filed under when it was planted
//   from        (optional) "my-presets:<id>": which browser preset "Plant my presets" made it from (never planted twice)
// SFX has no other savable thing with a share form (a sequence is a list of sounds, no link), so no other kind.

const PROJECT_APP_BUILD = 1;
const PROJECT_APP = {
  id: "crunchysfx",
  name: "CrunchySFX",
  suite: "sfx",                                        // its child of a planted crunchy/ folder: crunchy/sfx/, Unity Assets/Crunchy/SFX/
  kinds: {
    sound: { dir: "sounds", label: "Sounds" },
  },
  // a kind's own fields (plant.js has already checked the format, the name and the file list)
  valid: function (kind, d) {
    if (kind !== "sound") return false;
    if (typeof d.s !== "string" || !d.s.length) return false;
    if (d.wav != null && (typeof d.wav !== "string" || !/\.wav$/i.test(d.wav))) return false;
    if (d.sample != null && typeof d.sample !== "string") return false;
    return true;
  },
};
