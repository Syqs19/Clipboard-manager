mod categorizer;
mod clipboard_watcher;
mod commands;
mod db;
mod settings;
mod tray;

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // unica scorciatoia registrata: apre/nasconde la finestra
                    if event.state() == ShortcutState::Pressed {
                        tray::toggle_main_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            // "chiudi nel tray" configurabile: se attivo la X nasconde, altrimenti esce
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<settings::RuntimeState>();
                if state.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // DB nella cartella dati dell'app (es. %APPDATA%\com.matte.clipboardmanager)
            let data_dir = app.path().app_data_dir().expect("app data dir non disponibile");
            std::fs::create_dir_all(&data_dir).ok();
            let database =
                Arc::new(db::Db::open(data_dir.join("clips.db")).expect("apertura DB fallita"));

            // legge le impostazioni persistenti (con default sensati)
            let (max_history, close_to_tray, start_hidden, hotkey) =
                match app.store("settings.json") {
                    Ok(store) => (
                        store
                            .get("maxHistory")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(settings::DEFAULT_MAX_HISTORY),
                        store
                            .get("closeToTray")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(true),
                        store
                            .get("startHidden")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                        store
                            .get("hotkey")
                            .and_then(|v| v.as_str().map(str::to_string))
                            .unwrap_or_else(|| settings::DEFAULT_HOTKEY.to_string()),
                    ),
                    Err(_) => (
                        settings::DEFAULT_MAX_HISTORY,
                        true,
                        false,
                        settings::DEFAULT_HOTKEY.to_string(),
                    ),
                };

            let runtime = settings::RuntimeState {
                paused: Arc::new(AtomicBool::new(false)),
                max_history: Arc::new(AtomicI64::new(max_history)),
                close_to_tray: Arc::new(AtomicBool::new(close_to_tray)),
            };
            let paused = runtime.paused.clone();
            let max_hist = runtime.max_history.clone();

            app.manage(database.clone());
            app.manage(runtime);

            // avvia il monitoraggio della clipboard in background
            clipboard_watcher::start(app.handle().clone(), database, paused, max_hist);

            // hotkey globale (salvata o default); se non valida, ripiega sul default
            if app.global_shortcut().register(hotkey.as_str()).is_err() {
                let _ = app.global_shortcut().register(settings::DEFAULT_HOTKEY);
            }

            // system tray
            tray::create_tray(app.handle())?;

            // mostra la finestra a meno che non debba partire nascosta nel tray
            if !start_hidden {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_clips,
            commands::search_clips,
            commands::copy_clip,
            commands::toggle_pin,
            commands::remove_clip,
            commands::clear_history,
            commands::list_tags,
            commands::add_tag,
            commands::remove_tag,
            commands::apply_max_history,
            commands::apply_close_to_tray,
            commands::apply_hotkey,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
