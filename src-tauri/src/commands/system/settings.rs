//! Comandi che aggiornano lo stato runtime dalle Impostazioni.

use crate::commands::{Database, Runtime};
use crate::error::AppResult;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Aggiorna il limite cronologia e pota subito le clip in eccesso.
#[tauri::command]
pub fn apply_max_history(
    state: State<Runtime>,
    db: State<Database>,
    value: i64,
) -> AppResult<()> {
    let v = value.max(1);
    state.max_history.store(v, Ordering::Relaxed);
    db.prune_to_limit(v)?;
    Ok(())
}

/// Imposta se la X chiude nel tray (true) o esce dall'app (false).
#[tauri::command]
pub fn apply_close_to_tray(state: State<Runtime>, value: bool) {
    state.close_to_tray.store(value, Ordering::Relaxed);
}

/// Cambia l'hotkey globale. Registra PRIMA la nuova: se la stringa non è valida
/// l'errore esce qui e la scorciatoia precedente resta attiva (niente "buco" che
/// lascia l'utente senza hotkey). Solo a registrazione riuscita rimuove le vecchie
/// e ri-registra la nuova, così resta attiva una sola scorciatoia.
#[tauri::command]
pub fn apply_hotkey(app: AppHandle, shortcut: String) -> AppResult<()> {
    let gs = app.global_shortcut();
    // già attiva quella richiesta: niente da fare (evita l'errore "già registrata")
    if gs.is_registered(shortcut.as_str()) {
        return Ok(());
    }
    // valida la nuova provando a registrarla: se fallisce, la vecchia è intatta
    gs.register(shortcut.as_str()).map_err(|e| e.to_string())?;
    // la nuova è valida e attiva: rimuovi tutto e tieni solo lei
    let _ = gs.unregister_all();
    gs.register(shortcut.as_str()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Se true, le clip rilevate come sensibili non vengono salvate affatto.
#[tauri::command]
pub fn apply_dont_save_sensitive(state: State<Runtime>, value: bool) {
    state.dont_save_sensitive.store(value, Ordering::Relaxed);
}

/// TTL in minuti per le clip sensibili (0 = disabilitato).
#[tauri::command]
pub fn apply_sensitive_ttl(state: State<Runtime>, minutes: i64) {
    state.sensitive_ttl_minutes.store(minutes.max(0), Ordering::Relaxed);
}

/// Attiva/disattiva l'indicizzazione OCR delle immagini.
#[tauri::command]
pub fn apply_ocr_enabled(state: State<Runtime>, value: bool) {
    state.ocr_enabled.store(value, Ordering::Relaxed);
}

/// Tetto massimo (in byte del PNG) per salvare un'immagine; 0 = nessun limite.
#[tauri::command]
pub fn apply_max_image_bytes(state: State<Runtime>, bytes: i64) {
    state.max_image_bytes.store(bytes.max(0), Ordering::Relaxed);
}

/// Sostituisce il set di categorie sensibili attive (subset di "email"/"iban"/"card"/"token").
#[tauri::command]
pub fn apply_sensitive_kinds(state: State<Runtime>, kinds: Vec<String>) {
    let valid: std::collections::HashSet<String> = kinds
        .into_iter()
        .filter(|k| crate::settings::ALL_SENSITIVE_KINDS.contains(&k.as_str()))
        .collect();
    if let Ok(mut s) = state.sensitive_kinds.write() {
        *s = valid;
    }
}
