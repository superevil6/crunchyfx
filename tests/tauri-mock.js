// A STAND-IN FOR window.__TAURI__ (the desktop suite; from crunchyTile/tests/tauri-mock.js): the fs, dialog, opener,
// path and core plugins over an in-memory disk, injected before index.html's scripts so the page boots as the desktop
// app does. Paths with "forbidden" in them reject, as a path outside the fs scope does. Page errors are collected in
// __mock.errors (the suite fails on any).
(function () {
  const files = new Map(), dirs = new Set(["/"]), queue = [], saves = [], log = [], errors = [];
  addEventListener("error", function (e) { errors.push(String(e.message || e)); });
  addEventListener("unhandledrejection", function (e) { errors.push("unhandled: " + String(e.reason && e.reason.message || e.reason)); });
  const norm = function (p) { return String(p).replace(/\/+$/, "") || "/"; };
  const parent = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
  const guard = function (p) { if (/forbidden/.test(p)) throw new Error("forbidden path: " + p); };
  const needDir = function (p) { if (!dirs.has(p)) throw new Error("no such directory: " + p); };
  const enc = new TextEncoder(), dec = new TextDecoder();
  function mkdirAll(p) { for (let q = p; q !== "/" && !dirs.has(q); q = parent(q)) dirs.add(q); }
  window.__TAURI__ = {
    __mock: {
      files: files, dirs: dirs, log: log, errors: errors,
      answer: function (path) { queue.push(path); },               // the next dialog.open returns this
      answerSave: function (path) { saves.push(path); },           // the next dialog.save returns this
      mkdirAll: mkdirAll,
      put: function (p, data) { mkdirAll(parent(norm(p))); files.set(norm(p), typeof data === "string" ? enc.encode(data) : data); },
      text: function (p) { const b = files.get(norm(p)); return b ? dec.decode(b) : null; },
      bytes: function (p) { return files.get(norm(p)) || null; },
      list: function (prefix) { return Array.from(files.keys()).filter(function (k) { return k.indexOf(prefix) === 0; }).sort(); },
    },
    opener: { openUrl: async function (u) { log.push("open " + u); } },
    dialog: {
      open: async function () { return queue.length ? queue.shift() : null; },
      save: async function () { return saves.length ? saves.shift() : null; },
    },
    path: { tempDir: async function () { return "/tmp"; } },
    core: { invoke: async function (cmd) { log.push("invoke " + cmd); }, Channel: function () { this.onmessage = null; } },
    fs: {
      exists: async function (p) { p = norm(p); guard(p); return files.has(p) || dirs.has(p); },
      mkdir: async function (p, o) { p = norm(p); guard(p); if (!(o && o.recursive)) needDir(parent(p)); mkdirAll(p); },
      readTextFile: async function (p) { p = norm(p); guard(p); if (!files.has(p)) throw new Error("no such file: " + p); return dec.decode(files.get(p)); },
      readFile: async function (p) { p = norm(p); guard(p); if (!files.has(p)) throw new Error("no such file: " + p); return Array.from(files.get(p)); },
      readDir: async function (p) {
        p = norm(p); guard(p); needDir(p);
        const out = new Map();
        files.forEach(function (_, q) { if (parent(q) === p) out.set(q.slice(p.length + 1), false); });
        dirs.forEach(function (q) { if (q !== p && parent(q) === p) out.set(q.slice(p.length + 1), true); });
        return Array.from(out).map(function (e) { return { name: e[0], isDirectory: e[1], isFile: !e[1] }; });
      },
      writeTextFile: async function (p, t) { p = norm(p); guard(p); needDir(parent(p)); files.set(p, enc.encode(t)); log.push("w " + p); },
      writeFile: async function (p, b) {
        p = norm(p); guard(p); needDir(parent(p));
        if (!(b instanceof Uint8Array)) throw new Error("writeFile wants a Uint8Array");
        files.set(p, b); log.push("w " + p);
      },
      // a file, or an EMPTY folder (as the plugin's remove does); never a full folder
      remove: async function (p) {
        p = norm(p); guard(p);
        if (files.delete(p)) { log.push("rm " + p); return; }
        if (dirs.has(p)) {
          const full = Array.from(files.keys()).concat(Array.from(dirs)).some(function (q) { return q !== p && q.indexOf(p + "/") === 0; });
          if (full) throw new Error("remove: folder not empty " + p);
          dirs.delete(p); log.push("rmdir " + p); return;
        }
        throw new Error("remove: no such file " + p);
      },
    },
  };
  // a Godot project, a Unity project and a plain folder on the mock disk; /tmp for drag-out
  window.__TAURI__.__mock.put("/home/aj/godot-game/project.godot", "config_version=5\n");
  mkdirAll("/home/aj/unity-game/Assets"); mkdirAll("/home/aj/unity-game/ProjectSettings");
  mkdirAll("/home/aj/plain"); mkdirAll("/tmp"); mkdirAll("/home/aj/Downloads");
})();
