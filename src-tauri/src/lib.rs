mod ai_service;
mod font_service;
mod plantuml_native;
mod plantuml_runtime;

use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                for arg in argv.iter().skip(1) {
                    let trimmed = arg.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let lower = trimmed.to_lowercase();
                    if lower.ends_with(".md") || lower.ends_with(".markdown") {
                        let _ = app.emit("open-markdown-path", trimmed.to_string());
                        break;
                    }
                }
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }));
    }

    builder
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Allow reading/writing any path the user selects via dialog
            let scope = app.fs_scope();
            let _ = scope.allow_directory("/", true);
            #[cfg(windows)]
            {
                // On Windows allow all drive letters
                for letter in b'A'..=b'Z' {
                    let drive = format!("{}:\\\\", letter as char);
                    let _ = scope.allow_directory(&drive, true);
                }
            }

            #[cfg(windows)]
            {
                use window_vibrancy::apply_mica;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_mica(&window, None);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            plantuml_runtime::render_plantuml_local,
            plantuml_runtime::plantuml_runtime_available,
            font_service::list_system_fonts,
            ai_service::ai_chat_stream,
            ai_service::ai_list_models
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                plantuml_runtime::shutdown_plantuml_picoweb();
            }
        });
}
