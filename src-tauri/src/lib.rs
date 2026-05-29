mod categorizer;
mod clipboard_watcher;
mod commands;
mod crypto;
mod db;
mod images;
mod ocr;
mod settings;
mod transforms;
mod tray;
mod win_clipboard;

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            // DB nella cartella dati dell'app (es. %APPDATA%\com.clipboardmanager.app)
            let data_dir = app.path().app_data_dir().expect("app data dir non disponibile");
            std::fs::create_dir_all(&data_dir).ok();

            // chiave master per SQLCipher + PNG cifrati: persistita in key.bin
            // (cifrata via Windows DPAPI scope utente). Generata al primo avvio.
            let master_key = Arc::new(
                crypto::load_or_create_master_key(&data_dir.join("key.bin"))
                    .expect("impossibile inizializzare la chiave master"),
            );

            let database = Arc::new(
                db::Db::open(data_dir.join("clips.db"), &master_key)
                    .expect("apertura DB fallita"),
            );

            // cartella immagini + pulizia dei PNG orfani (non più referenziati dal DB)
            let images_dir = data_dir.join("images");
            std::fs::create_dir_all(&images_dir).ok();
            if let Ok(referenced) = database.all_image_paths() {
                let keep: std::collections::HashSet<String> = referenced
                    .iter()
                    .flat_map(|p| {
                        let thumb = images::thumb_path_for(std::path::Path::new(p))
                            .to_string_lossy()
                            .to_string();
                        [p.clone(), thumb]
                    })
                    .collect();
                if let Ok(entries) = std::fs::read_dir(&images_dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if !keep.contains(&p.to_string_lossy().to_string()) {
                            let _ = std::fs::remove_file(p);
                        }
                    }
                }
            }

            // legge le impostazioni persistenti (con default sensati)
            let default_kinds: HashSet<String> = settings::ALL_SENSITIVE_KINDS
                .iter()
                .map(|s| s.to_string())
                .collect();
            let (
                max_history,
                close_to_tray,
                start_hidden,
                hotkey,
                dont_save_sensitive,
                sensitive_ttl,
                sensitive_kinds_set,
            ) = match app.store("settings.json") {
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
                    store
                        .get("dontSaveSensitive")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                    store
                        .get("sensitiveTtlMinutes")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                    store
                        .get("sensitiveKinds")
                        .and_then(|v| v.as_array().cloned())
                        .map(|arr| {
                            arr.into_iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .filter(|s| settings::ALL_SENSITIVE_KINDS.contains(&s.as_str()))
                                .collect::<HashSet<_>>()
                        })
                        .unwrap_or_else(|| default_kinds.clone()),
                ),
                Err(_) => (
                    settings::DEFAULT_MAX_HISTORY,
                    true,
                    false,
                    settings::DEFAULT_HOTKEY.to_string(),
                    false,
                    0,
                    default_kinds.clone(),
                ),
            };

            // OCR delle immagini: attivo di default, disattivabile da Settings
            let ocr_enabled_val = app
                .store("settings.json")
                .ok()
                .and_then(|s| s.get("ocrEnabled").and_then(|v| v.as_bool()))
                .unwrap_or(true);

            let runtime = settings::RuntimeState {
                paused: Arc::new(AtomicBool::new(false)),
                max_history: Arc::new(AtomicI64::new(max_history)),
                close_to_tray: Arc::new(AtomicBool::new(close_to_tray)),
                dont_save_sensitive: Arc::new(AtomicBool::new(dont_save_sensitive)),
                sensitive_ttl_minutes: Arc::new(AtomicI64::new(sensitive_ttl.max(0))),
                sensitive_kinds: Arc::new(RwLock::new(sensitive_kinds_set)),
                ocr_enabled: Arc::new(AtomicBool::new(ocr_enabled_val)),
            };
            let paused = runtime.paused.clone();
            let max_hist = runtime.max_history.clone();
            let dont_save = runtime.dont_save_sensitive.clone();
            let ttl = runtime.sensitive_ttl_minutes.clone();
            let kinds_for_watcher = runtime.sensitive_kinds.clone();
            let kinds_for_sweep = runtime.sensitive_kinds.clone();
            let ocr_for_watcher = runtime.ocr_enabled.clone();
            let ocr_for_backfill = runtime.ocr_enabled.clone();

            // segnale "self-write": condiviso fra commands (writer) e watcher
            // (consumer) per evitare l'auto-bump quando l'app copia una clip.
            let last_self_write: settings::LastSelfWrite =
                Arc::new(Mutex::new(None));

            app.manage(database.clone());
            app.manage(master_key.clone());
            app.manage(last_self_write.clone());
            app.manage(runtime);

            // backfill di sensitive_kind sulle clip pre-esistenti (idempotente)
            if let Err(e) = database.backfill_sensitive_kinds() {
                eprintln!("[backfill] errore: {e}");
            }

            // migrazione una-tantum: cifra in place i PNG salvati con la
            // versione precedente (idempotente: i file già cifrati si saltano)
            if let Ok(entries) = std::fs::read_dir(&images_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let is_png = p
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .is_some_and(|n| n.ends_with(".png"));
                    if !is_png {
                        continue;
                    }
                    if let Err(e) = images::encrypt_in_place_if_needed(&p, &master_key) {
                        eprintln!("[migrate-png] {}: {e}", p.display());
                    }
                }
            }

            // backfill thumbnail per PNG esistenti senza .thumb.png (idempotente)
            if let Ok(entries) = std::fs::read_dir(&images_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    let name = p.file_name().map(|s| s.to_string_lossy().to_string());
                    let is_png = name.as_deref().is_some_and(|n| n.ends_with(".png"));
                    let is_thumb = name.as_deref().is_some_and(|n| n.ends_with(".thumb.png"));
                    if !is_png || is_thumb {
                        continue;
                    }
                    let thumb = images::thumb_path_for(&p);
                    if !thumb.exists() {
                        let _ = images::save_thumbnail(&p, &thumb, 200, &master_key);
                    }
                }
            }

            // avvia il monitoraggio della clipboard in background
            clipboard_watcher::start(
                app.handle().clone(),
                database.clone(),
                master_key.clone(),
                last_self_write,
                paused,
                max_hist,
                dont_save,
                kinds_for_watcher,
                ocr_for_watcher,
                images_dir,
            );

            // sweep periodico delle clip sensibili scadute (ogni 60s), filtrato per kind selezionati
            {
                let db_sweep = database.clone();
                let app_sweep = app.handle().clone();
                std::thread::spawn(move || loop {
                    std::thread::sleep(std::time::Duration::from_secs(60));
                    let mins = ttl.load(Ordering::Relaxed);
                    if mins <= 0 {
                        continue;
                    }
                    let kinds: Vec<String> = match kinds_for_sweep.read() {
                        Ok(s) => s.iter().cloned().collect(),
                        Err(_) => continue,
                    };
                    if kinds.is_empty() {
                        continue;
                    }
                    let kinds_ref: Vec<&str> = kinds.iter().map(|s| s.as_str()).collect();
                    let cutoff = db::now_millis() - mins * 60_000;
                    match db_sweep.delete_expired_sensitive_kinds(cutoff, &kinds_ref) {
                        Ok(n) if n > 0 => {
                            let _ = app_sweep.emit("clips-changed", 0_i64);
                        }
                        Ok(_) => {}
                        Err(e) => eprintln!("[sweep] errore: {e}"),
                    }
                });
            }

            // backfill OCR: indicizza in background gli screenshot già in
            // cronologia ancora privi di testo OCR (idempotente, rispetta il toggle)
            {
                let db_ocr = database.clone();
                let key_ocr = master_key.clone();
                let app_ocr = app.handle().clone();
                std::thread::spawn(move || {
                    if !ocr_for_backfill.load(Ordering::Relaxed) {
                        return;
                    }
                    ocr::init_thread();
                    let pending = match db_ocr.images_needing_ocr() {
                        Ok(v) => v,
                        Err(_) => return,
                    };
                    let mut changed = false;
                    for (id, path) in pending {
                        if !ocr_for_backfill.load(Ordering::Relaxed) {
                            break;
                        }
                        let Ok((w, h, rgba)) =
                            images::load_png_rgba(std::path::Path::new(&path), &key_ocr)
                        else {
                            continue;
                        };
                        if let Ok(text) = ocr::ocr_rgba(w, h, &rgba) {
                            // salvo anche la stringa vuota: così le immagini senza
                            // testo non vengono ri-processate ad ogni avvio
                            let _ = db_ocr.set_ocr_text(id, text.trim());
                            if !text.trim().is_empty() {
                                changed = true;
                            }
                        }
                    }
                    if changed {
                        let _ = app_ocr.emit("clips-changed", 0_i64);
                    }
                });
            }

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
            commands::set_tag_color,
            commands::update_clip,
            commands::apply_max_history,
            commands::apply_close_to_tray,
            commands::apply_hotkey,
            commands::apply_dont_save_sensitive,
            commands::apply_sensitive_ttl,
            commands::apply_sensitive_kinds,
            commands::apply_ocr_enabled,
            commands::reorder_pinned,
            commands::remove_clips,
            commands::bulk_set_pinned,
            commands::bulk_add_tag,
            commands::export_history,
            commands::import_history,
            commands::set_tag_pinned,
            commands::rename_tag,
            commands::bulk_remove_tag,
            commands::reveal_in_explorer,
            commands::open_path,
            commands::read_image_bytes,
            commands::get_stats,
            commands::copy_image_as_file,
            commands::copy_transformed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
