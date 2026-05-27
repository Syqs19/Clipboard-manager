mod categorizer;
mod clipboard_watcher;
mod commands;
mod db;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // DB nella cartella dati dell'app (es. %APPDATA%\com.matte.clipboardmanager)
            let data_dir = app.path().app_data_dir().expect("app data dir non disponibile");
            std::fs::create_dir_all(&data_dir).ok();
            let database =
                Arc::new(db::Db::open(data_dir.join("clips.db")).expect("apertura DB fallita"));
            let paused = Arc::new(AtomicBool::new(false));

            app.manage(database.clone());
            app.manage(clipboard_watcher::WatcherState { paused: paused.clone() });

            // avvia il monitoraggio della clipboard in background
            clipboard_watcher::start(app.handle().clone(), database, paused);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
