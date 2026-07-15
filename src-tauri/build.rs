// crunchyfx ships as index.html + presets.js + styles.css at the repo root — the SAME files
// the web version serves. Tauri wants a frontend directory, so before compiling we copy them
// into ../dist/ (the configured frontendDist). Runs on every build via cargo, on every
// platform, with no external tooling. Keeps web + desktop in sync.
fn main() {
    let _ = std::fs::create_dir_all("../dist");
    for f in ["index.html", "presets.js", "styles.css"] {
        std::fs::copy(format!("../{f}"), format!("../dist/{f}"))
            .unwrap_or_else(|e| panic!("build.rs: could not copy ../{f} -> ../dist/{f}: {e}"));
        // rebuild if the frontend changes
        println!("cargo:rerun-if-changed=../{f}");
    }
    tauri_build::build();
}
