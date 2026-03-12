#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeInfo {
    app_name: String,
    app_version: String,
    platform: String,
    arch: String,
    debug: bool,
}

#[tauri::command]
fn desktop_runtime_info(app: tauri::AppHandle) -> DesktopRuntimeInfo {
    DesktopRuntimeInfo {
        app_name: app.package_info().name.clone(),
        app_version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        debug: cfg!(debug_assertions),
    }
}

#[tauri::command]
fn desktop_toggle_maximize(window: tauri::WebviewWindow) -> Result<bool, String> {
    let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;

    if is_maximized {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn desktop_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_window_maximized(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_info,
            desktop_toggle_maximize,
            desktop_minimize,
            desktop_window_maximized,
            desktop_close_window
        ])
        // TODO: Add system tray when tauri-plugin-tray is installed:
        // .plugin(tauri_plugin_tray::init())
        // Tray menu items: Open, Mute All, separator, Quit
        //
        // TODO: Add notification support when tauri-plugin-notification is installed:
        // .plugin(tauri_plugin_notification::init())
        //
        // TODO: Add deep link support when tauri-plugin-deep-link is installed:
        // .plugin(tauri_plugin_deep_link::init())
        // Protocol: vostok:// (configured in tauri.conf.json)
        .run(tauri::generate_context!())
        .expect("failed to run Vostok desktop shell");
}
