# Copied from crunchyVFX's restyle (2026-10-11). WebKitGTK (the desktop engine), headless enough: no focus races, no MiniBrowser.
# wkshot.py <url> <out.png> <width> <height> <delay_s> [js-at-end-file ...]
# WebKitGTK 4.1 (the desktop engine) in an offscreen window: no window-manager focus races.
import sys, gi
gi.require_version('WebKit2', '4.1'); gi.require_version('Gtk', '3.0')
from gi.repository import WebKit2, Gtk, GLib
url, out, w, h, delay = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5])
ucm = WebKit2.UserContentManager()
ucm.add_script(WebKit2.UserScript('window.__errs=[];addEventListener("error",e=>{window.__errs.push(e.message+" @"+e.lineno);document.title="ERR "+window.__errs.join(" | ")});',
  WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
ucm.add_script(WebKit2.UserScript('try{localStorage.setItem("crunchyvfx.tourseen.v1","1")}catch(e){}',
  WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
import os
if os.environ.get('FAKE_TAURI'):
    ucm.add_script(WebKit2.UserScript('window.__TAURI__={core:{invoke:()=>Promise.resolve(null)},event:{listen:()=>Promise.resolve(()=>{})}};', WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
for f in sys.argv[6:]:
    ucm.add_script(WebKit2.UserScript(open(f).read(), WebKit2.UserContentInjectedFrames.TOP_FRAME,
      WebKit2.UserScriptInjectionTime.END, None, None))
ctx = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView.new_with_user_content_manager(ucm) if False else WebKit2.WebView(web_context=ctx, user_content_manager=ucm)
s = view.get_settings(); s.set_allow_file_access_from_file_urls(True); s.set_allow_universal_access_from_file_urls(True)
win = Gtk.Window(); win.set_default_size(w, h); view.set_size_request(w, h); win.add(view); win.show_all()
view.load_uri(url)
def done(v, res):
    try:
        surf = v.get_snapshot_finish(res); surf.write_to_png(out)
    except Exception as e:
        print("snapshot failed:", e)
    t = v.get_title() or ''; print(t) if t.startswith('ERR') else None; Gtk.main_quit()
def snap():
    view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done); return False
GLib.timeout_add(int(delay * 1000), snap)
GLib.timeout_add(60000, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
