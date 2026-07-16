// Prevent an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init()) // native Save dialog for WAV export
        .plugin(tauri_plugin_fs::init())     // write the chosen file to disk
        .plugin(tauri_plugin_drag::init())   // drag a rendered WAV out into the OS / an engine
        .run(tauri::generate_context!())
        .expect("error while running crunchyfx");
}
