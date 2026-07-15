// crunchyfx ships as a single index.html at the repo root — the SAME file the web
// version serves. Tauri wants a frontend directory, so before compiling we copy
// index.html into ../dist/ (the configured frontendDist). Runs on every build via
// cargo, on every platform, with no external tooling. Keeps web + desktop in sync.
fn main() {
    let _ = std::fs::create_dir_all("../dist");
    std::fs::copy("../index.html", "../dist/index.html")
        .expect("build.rs: could not copy ../index.html -> ../dist/index.html");
    // rebuild if the frontend changes
    println!("cargo:rerun-if-changed=../index.html");
    tauri_build::build();
}
