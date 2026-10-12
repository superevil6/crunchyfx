#!/usr/bin/env python3
"""Build CrunchySFX's browser suites. Each one runs INSIDE the real index.html (real markup, stylesheets and app
script), with a test script appended after the app's own (and, for the desktop suite, a mocked window.__TAURI__
injected BEFORE every script, so the page boots as the desktop app does). Ported from crunchyTile/tests/build.py.

    python3 tests/build.py audio      # -> tests/run-audio.html    (audio-hash.js: every preset's samples + WAV bytes)
    python3 tests/build.py desktop    # -> tests/run-desktop.html  (regression-desktop.js + tauri-mock.js)
    python3 tests/build.py web        # -> tests/run-web.html      (regression-web.js: the web build, no Tauri)

Then (a FRESH profile every time: Firefox caches file:// assets; an ABSOLUTE screenshot path):

    firefox --headless --profile "$(mktemp -d)" --window-size=1400,900 \\
            --screenshot "$PWD/tests/desktop.png" "file://$PWD/tests/run-desktop.html"

The generated run-*.html pages are git-ignored. Nothing here is ever injected into the repo's index.html.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# suite: (its test script, the scripts injected BEFORE the app's: a mock, the v1.1 fixtures and their seeding)
SUITES = {
    "audio": ("audio-hash.js", []),
    "desktop": ("regression-desktop.js", ["tauri-mock.js", "fixtures/v1.1.js", "seed-v11.js"]),
    "web": ("regression-web.js", ["fixtures/v1.1.js", "seed-v11.js"]),
    "fixtures": ("make-fixtures.js", []),
    "show": ("show-desktop.js", ["tauri-mock.js", "fixtures/v1.1.js", "seed-v11.js"]),     # a look, for wkshot.py
    "godot": ("godot-plant.js", ["tauri-mock.js", "fixtures/v1.1.js", "seed-v11.js"]),   # tests/godot-check.mjs runs it     # ONCE, on the build being protected (see make-fixtures.js)
}


def read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def build(suite):
    test, before = SUITES[suite]
    page = read(os.path.join(ROOT, "index.html"))
    # REBASE every relative file reference: the page lives in tests/, the app's files one level up.
    page = re.sub(r'(src|href)="([A-Za-z0-9_.\-]+\.(?:js|css|svg|png))"', r'\1="../\2"', page)
    if before:
        # BEFORE every app script: the page decides it is the desktop app as it loads (isDesktop), and reads the store.
        pre = "".join("<script>\n" + read(os.path.join(HERE, f)) + "\n</script>\n" for f in before)
        page = page.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + pre, 1)
    banner = ('<div id="dombanner" style="position:fixed;left:0;right:0;top:0;z-index:99999;max-height:100vh;overflow:auto;'
              'padding:8px 12px;font:12px ui-monospace,monospace;background:#12441f;color:#9ff5b6;white-space:pre-wrap">'
              'running…</div>') if suite not in ("audio", "fixtures", "godot", "show") else ""
    page = page.rstrip() + "\n" + banner + "\n<script>\n" + read(os.path.join(HERE, test)) + "\n</script>\n"
    path = os.path.join(HERE, "run-" + suite + ".html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)
    return path


def main():
    suite = sys.argv[1] if len(sys.argv) > 1 else "desktop"
    if suite not in SUITES:
        sys.exit("no such suite: " + suite + " (" + ", ".join(SUITES) + ")")
    print(build(suite))


if __name__ == "__main__":
    main()
