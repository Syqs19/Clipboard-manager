//! Comandi esposti al frontend (invoke). Accedono al DB condiviso e alla clipboard.
//!
//! Importante per la privacy: `copy_clip` recupera il contenuto **completo** dal
//! DB (non quello mascherato mostrato nella UI), così i dati sensibili restano
//! copiabili pur essendo nascosti a schermo.

use crate::db::{Clip, Db};
use crate::settings::RuntimeState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

type Database = Arc<Db>;

const DEFAULT_LIMIT: i64 = 200;

#[tauri::command]
pub fn list_clips(db: State<Database>, limit: Option<i64>) -> Result<Vec<Clip>, String> {
    db.list_recent(limit.unwrap_or(DEFAULT_LIMIT)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_clips(db: State<Database>, query: String) -> Result<Vec<Clip>, String> {
    if query.trim().is_empty() {
        db.list_recent(DEFAULT_LIMIT).map_err(|e| e.to_string())
    } else {
        db.search(query.trim()).map_err(|e| e.to_string())
    }
}

/// Mette il contenuto completo della clip nella clipboard di sistema
/// (testo intero per i sensibili, immagine ricostruita dal PNG per le immagini).
fn write_clip_to_clipboard(db: &Db, id: i64) -> Result<(), String> {
    let clip = db
        .get_clip(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "clip non trovata".to_string())?;
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    if clip.content_type == "image" {
        if let Some(path) = clip.image_path {
            let (w, h, rgba) = crate::images::load_png_rgba(std::path::Path::new(&path))?;
            cb.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(rgba),
            })
            .map_err(|e| e.to_string())?;
        }
    } else if let Some(content) = clip.content {
        cb.set_text(content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn copy_clip(db: State<Database>, id: i64) -> Result<(), String> {
    write_clip_to_clipboard(db.inner(), id)
}

#[tauri::command]
pub fn toggle_pin(db: State<Database>, id: i64, pinned: bool) -> Result<(), String> {
    db.set_pinned(id, pinned).map_err(|e| e.to_string())
}

/// Riordina le clip fissate secondo la lista di id passata (drag & drop).
#[tauri::command]
pub fn reorder_pinned(db: State<Database>, ids: Vec<i64>) -> Result<(), String> {
    db.reorder_pinned(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_clip(db: State<Database>, id: i64) -> Result<(), String> {
    // elimina anche l'eventuale file immagine associato
    if let Ok(Some(clip)) = db.get_clip(id) {
        if let Some(path) = clip.image_path {
            let _ = std::fs::remove_file(path);
        }
    }
    db.delete_clip(id).map_err(|e| e.to_string())
}

/// Elimina più clip in un colpo (con cleanup dei file immagine).
#[tauri::command]
pub fn remove_clips(db: State<Database>, ids: Vec<i64>) -> Result<(), String> {
    if let Ok(paths) = db.image_paths_for(&ids) {
        for p in paths {
            let _ = std::fs::remove_file(p);
        }
    }
    db.delete_clips(&ids).map_err(|e| e.to_string())?;
    Ok(())
}

/// Imposta lo stato pinned su più clip (true=pinna, false=despinna).
#[tauri::command]
pub fn bulk_set_pinned(
    db: State<Database>,
    ids: Vec<i64>,
    pinned: bool,
) -> Result<(), String> {
    for id in ids {
        db.set_pinned(id, pinned).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Aggiunge un tag manuale a più clip in un colpo.
#[tauri::command]
pub fn bulk_add_tag(
    db: State<Database>,
    ids: Vec<i64>,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("nome tag vuoto".to_string());
    }
    let tag_id = db.get_or_create_tag(name, None, false).map_err(|e| e.to_string())?;
    for id in ids {
        db.attach_tag(id, tag_id).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_history(db: State<Database>) -> Result<(), String> {
    db.clear_unpinned().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tags(db: State<Database>) -> Result<Vec<(String, i64, Option<String>)>, String> {
    db.list_tags_with_counts().map_err(|e| e.to_string())
}

/// Imposta il colore di un tag.
#[tauri::command]
pub fn set_tag_color(db: State<Database>, name: String, color: String) -> Result<(), String> {
    db.set_tag_color(name.trim(), &color).map_err(|e| e.to_string())
}

/// Modifica il contenuto testuale di un clip (ricategorizza tipo e sensibilità).
#[tauri::command]
pub fn update_clip(db: State<Database>, id: i64, content: String) -> Result<(), String> {
    let cat = crate::categorizer::categorize(&content);
    let preview: String = content.trim().chars().take(200).collect();
    db.update_clip_content(
        id,
        &content,
        cat.content_type,
        &preview,
        content.chars().count() as i64,
        cat.sensitive,
        cat.sensitive_kind,
        &crate::db::content_hash(&content),
    )
    .map_err(|e| e.to_string())
}

/// Aggiunge un tag manuale (creandolo se non esiste) a una clip.
#[tauri::command]
pub fn add_tag(db: State<Database>, id: i64, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("nome tag vuoto".to_string());
    }
    let tag_id = db.get_or_create_tag(name, None, false).map_err(|e| e.to_string())?;
    db.attach_tag(id, tag_id).map_err(|e| e.to_string())
}

/// Rimuove un tag da una clip (per nome).
#[tauri::command]
pub fn remove_tag(db: State<Database>, id: i64, name: String) -> Result<(), String> {
    db.remove_tag_by_name(id, name.trim()).map_err(|e| e.to_string())
}

// ----- impostazioni (aggiornano lo stato runtime) -----

/// Aggiorna il limite cronologia e pota subito le clip in eccesso.
#[tauri::command]
pub fn apply_max_history(
    state: State<RuntimeState>,
    db: State<Database>,
    value: i64,
) -> Result<(), String> {
    let v = value.max(1);
    state.max_history.store(v, Ordering::Relaxed);
    db.prune_to_limit(v).map_err(|e| e.to_string())?;
    Ok(())
}

/// Imposta se la X chiude nel tray (true) o esce dall'app (false).
#[tauri::command]
pub fn apply_close_to_tray(state: State<RuntimeState>, value: bool) {
    state.close_to_tray.store(value, Ordering::Relaxed);
}

/// Cambia l'hotkey globale: deregistra quelle vecchie e registra la nuova.
/// Ritorna errore se la stringa scorciatoia non è valida.
#[tauri::command]
pub fn apply_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(shortcut.as_str()).map_err(|e| e.to_string())
}

/// Se true, le clip rilevate come sensibili non vengono salvate affatto.
#[tauri::command]
pub fn apply_dont_save_sensitive(state: State<RuntimeState>, value: bool) {
    state.dont_save_sensitive.store(value, Ordering::Relaxed);
}

/// TTL in minuti per le clip sensibili (0 = disabilitato).
#[tauri::command]
pub fn apply_sensitive_ttl(state: State<RuntimeState>, minutes: i64) {
    state.sensitive_ttl_minutes.store(minutes.max(0), Ordering::Relaxed);
}

/// Sostituisce il set di categorie sensibili attive (subset di "email"/"iban"/"card"/"token").
#[tauri::command]
pub fn apply_sensitive_kinds(state: State<RuntimeState>, kinds: Vec<String>) {
    let valid: std::collections::HashSet<String> = kinds
        .into_iter()
        .filter(|k| crate::settings::ALL_SENSITIVE_KINDS.contains(&k.as_str()))
        .collect();
    if let Ok(mut s) = state.sensitive_kinds.write() {
        *s = valid;
    }
}
