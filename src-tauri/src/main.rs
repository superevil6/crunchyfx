// Prevent an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init()) // native Save dialog for WAV export
        .plugin(tauri_plugin_fs::init())     // write the chosen file to disk
        .plugin(tauri_plugin_drag::init())   // drag a rendered WAV out into the OS / an engine
        .setup(|app| {
            // Microphone for the Record button. WebKitGTK (Linux) denies getUserMedia by default —
            // enable the media-stream setting and auto-grant the permission request. (No JS change:
            // the getUserMedia code is the same as the web build; the webview just has to allow it.)
            // Windows/WebView2 handles the mic itself; macOS isn't a bundle target.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|pw| {
                        use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
                        let webview = pw.inner();
                        if let Some(settings) = WebViewExt::settings(&webview) {
                            settings.set_enable_media_stream(true);
                        }
                        webview.connect_permission_request(|_wv, req| {
                            req.allow(); // the app only ever asks for the mic
                            true
                        });
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CrunchySFX");
}
