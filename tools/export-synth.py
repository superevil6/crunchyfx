#!/usr/bin/env python3
"""Export the CrunchySFX synthesis engine as one self-contained, namespaced file.

    python3 tools/export-synth.py

Writes synth-export/crunchysfx-synth.js — dsp.js + synth.js + the canonical parameter defaults,
wrapped in an IIFE that exposes a single `window.CrunchySynth`. That namespacing is not cosmetic:
the consumer (CrunchyVFX) is also a buildless app whose scripts share one global scope, and it
already defines `withState`, `undoEdit`, `EDIT_HIST_MAX` and others that collide with names in
here. A plain concatenation would silently clobber its undo/redo.

Nothing is rewritten on the way out: dsp.js and synth.js are copied verbatim, which is what makes
the export trustworthy. Everything the engine needs is already pure (no DOM, no app globals) —
if that ever stops being true, this script fails loudly rather than shipping something broken.

The banner carries a sha256 of the payload so a consumer can prove its vendored copy is an
unmodified export (see tools/pull-synth.py on the CrunchyVFX side).
"""

import hashlib
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "synth-export" / "crunchysfx-synth.js"

# Names the bundle publishes. Anything else it defines stays private inside the IIFE.
EXPORTS = ["render", "encodeWav", "DEFAULTS", "PARAMS", "SR", "VERSION", "BUILT", "SHA256"]

# Things that must NOT appear in the engine sources — the whole point of the extraction is that
# the engine is pure, and each of these would work in the app but break in the export.
FORBIDDEN = [
    (r"\bdocument\.", "DOM access"),
    (r"\bwindow\.(?!AudioContext)", "window access"),
    (r"\blocalStorage\b", "localStorage"),
    (r"\balert\(", "alert()"),
    (r"\bstate\.", "the app's global `state` (pass a patch instead)"),
]


def die(msg):
    sys.exit("export-synth: " + msg)


def read(name):
    p = ROOT / name
    if not p.exists():
        die("missing " + name)
    return p.read_text()


def check_pure(name, text):
    # Strip line comments so prose about the DOM doesn't trip the scan.
    code = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    for pattern, what in FORBIDDEN:
        m = re.search(pattern, code)
        if m:
            line = code[: m.start()].count("\n") + 1
            die("%s:%d uses %s — the engine must stay pure, so it cannot be exported as-is."
                % (name, line, what))


def app_version():
    m = re.search(r'const APP_VERSION = "([^"]+)"', read("index.html"))
    return m.group(1) if m else "0.0.0"


def git_sha():
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True,
            stderr=subprocess.DEVNULL).strip()
    except Exception:
        return "unknown"


def git_dirty():
    try:
        out = subprocess.check_output(
            ["git", "status", "--porcelain", "index.html", "dsp.js", "synth.js"],
            cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
        return bool(out)
    except Exception:
        return False


def strip_literals(js):
    """Blank out comments and string/template literals so an identifier scan sees only code.
    Without this, prose in a comment ("...see PANEL_WAVES...") and words inside display labels
    ("Pulse (PWM)") read as code references."""
    out, i, n = [], 0, len(js)
    while i < n:
        c = js[i]
        if c == "/" and i + 1 < n and js[i + 1] == "/":
            j = js.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i)); i = j
        elif c == "/" and i + 1 < n and js[i + 1] == "*":
            j = js.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append(" " * (j - i)); i = j
        elif c in "\"'`":
            j, quote = i + 1, c
            while j < n and js[j] != quote:
                j += 2 if js[j] == "\\" else 1
            j = min(j + 1, n)
            out.append(" " * (j - i)); i = j
        else:
            out.append(c); i += 1
    return "".join(out)


# Identifiers that are language/host builtins rather than app values to carry along.
BUILTINS = {"true", "false", "null", "undefined", "const", "let", "var", "function", "return",
            "new", "typeof", "of", "in", "if", "else", "for", "while", "Math", "Number", "String",
            "Array", "Object", "JSON", "Infinity", "NaN"}


def slice_params(html):
    """The PARAMS table plus whatever it references, verbatim. PARAMS is the single source of
    truth for every parameter's default, so shipping it means the consumer never keeps its own
    copy to drift out of sync."""
    pm = re.search(r"^const PARAMS = \[.*?^\];$", html, flags=re.M | re.S)
    if not pm:
        die("could not find the PARAMS table in index.html")

    # Resolve the table's dependencies by name rather than assuming which ones exist: scan the
    # code (literals stripped), then carry along every referenced const. `WAVES.length - 1` is
    # exactly the kind of reference a bounded ,NAME] pattern would miss.
    code = strip_literals(pm.group(0))
    code = re.sub(r"\.\s*[A-Za-z_$][\w$]*", "", code)          # drop property accesses (.length)
    refs = {m for m in re.findall(r"[A-Za-z_$][\w$]*", code)} - BUILTINS - {"PARAMS"}

    deps = []
    for name in sorted(refs):
        d = re.search(r"^const %s = .*?;$" % re.escape(name), html, flags=re.M | re.S)
        if not d:
            die("PARAMS references `%s`, which has no top-level `const %s = ...;` in index.html. "
                "Inline the value or make it a const so the export can carry it."
                % (name, name))
        deps.append(d.group(0))

    return "\n".join(deps) + ("\n\n" if deps else "") + pm.group(0)


def check_self_contained(dsp, synth):
    """The engine must not reach for a constant that only index.html declares.

    Such a reference works fine in the app — one shared global scope — but the bundle wraps
    everything in an IIFE, so it becomes a ReferenceError the moment a consumer loads it. That is
    exactly how CONV_MAKEUP and CUSTOM_DEFAULT_DRAWN were caught. Scanning is limited to
    SCREAMING_CASE, this project's convention for module-level constants: those are never locals,
    so the check needs no scope analysis and cannot produce false alarms from function-local
    names. Anything subtler is caught by tools/verify-synth.html, which actually runs the bundle.
    """
    code = strip_literals(dsp) + "\n" + strip_literals(synth)
    declared = set(re.findall(
        r"(?:^|\n)\s*(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)", code))
    free = sorted({m for m in re.findall(r"\b[A-Z][A-Z0-9_]{2,}\b", code)} - declared - BUILTINS)
    if free:
        die("the engine references %s, which it does not declare. Those are almost certainly "
            "declared in index.html — move them into dsp.js (the engine reads them, so they are "
            "engine constants). Left as-is they would throw a ReferenceError inside the bundle's "
            "IIFE, where index.html's globals do not exist." % ", ".join(free))


def main():
    dsp, synth, html = read("dsp.js"), read("synth.js"), read("index.html")
    check_pure("dsp.js", dsp)
    check_pure("synth.js", synth)
    check_self_contained(dsp, synth)

    if "function renderPatch(" not in synth:
        die("synth.js no longer defines renderPatch()")
    if "function encodeWav(" not in synth:
        die("synth.js no longer defines encodeWav()")

    version, sha, dirty = app_version(), git_sha(), git_dirty()

    payload = """(function (root) {
"use strict";

// ==== dsp.js ================================================================================
%s
// ==== synth.js =============================================================================
%s
// ==== parameter table (from index.html) ====================================================
// Carried so consumers read the canonical defaults instead of maintaining their own copy.
%s

const DEFAULTS = {};
for (const p of PARAMS) DEFAULTS[p[0]] = p[5];

root.CrunchySynth = {
  VERSION: %s,
  BUILT: %s,
  SHA256: "@@SHA256@@",
  SR: SR,
  PARAMS: PARAMS,
  DEFAULTS: DEFAULTS,
  // renderPatch(patch, { sample, normalize }) -> { L, R, rawPeak }
  render: renderPatch,
  // encodeWav(L, R, { rate, depth, channels, loop, title }) -> ArrayBuffer
  encodeWav: encodeWav,
};
})(typeof window !== "undefined" ? window : globalThis);
""" % (dsp.rstrip("\n"), synth.rstrip("\n"), slice_params(html),
       json.dumps(version), json.dumps(sha + ("-dirty" if dirty else "")))

    digest = hashlib.sha256(payload.replace("@@SHA256@@", "").encode()).hexdigest()
    payload = payload.replace("@@SHA256@@", digest)

    banner = """/*! CrunchySFX synthesis engine — GENERATED FILE, DO NOT EDIT.
 *
 *  Everything here is compiled from the CrunchySFX sources; edit those and re-export instead.
 *  Exposes exactly one global: CrunchySynth { %s }.
 *
 *    source   crunchysfx v%s (%s)
 *    from     dsp.js + synth.js + the PARAMS defaults
 *    sha256   %s   (of everything below this banner, with the SHA256 field blanked)
 *
 *  Regenerate:  python3 tools/export-synth.py          (in the crunchysfx repo)
 *  Re-vendor:   python3 tools/pull-synth.py            (in the crunchyvfx repo)
 */
""" % (", ".join(EXPORTS), version, sha + (" — DIRTY WORKING TREE" if dirty else ""), digest)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(banner + payload)
    kb = len(banner + payload) / 1024.0
    print("wrote %s  (%.0f KB, v%s @ %s%s)"
          % (OUT.relative_to(ROOT), kb, version, sha, ", DIRTY" if dirty else ""))
    print("sha256 %s" % digest)
    if dirty:
        print("NOTE: engine sources have uncommitted changes — the export records the tree as "
              "dirty so a consumer can tell it did not come from a clean commit.")


if __name__ == "__main__":
    main()
