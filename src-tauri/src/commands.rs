//! Comandi esposti al frontend (invoke). Accedono al DB condiviso e alla clipboard.
//!
//! Importante per la privacy: `copy_clip` recupera il contenuto **completo** dal
//! DB (non quello mascherato mostrato nella UI), così i dati sensibili restano
//! copiabili pur essendo nascosti a schermo.

use crate::db::{Clip, Db};
use std::sync::Arc;
use tauri::State;

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

/// Copia il contenuto completo della clip nella clipboard di sistema.
#[tauri::command]
pub fn copy_clip(db: State<Database>, id: i64) -> Result<(), String> {
    let clip = db
        .get_clip(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "clip non trovata".to_string())?;
    if let Some(content) = clip.content {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_text(content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_pin(db: State<Database>, id: i64, pinned: bool) -> Result<(), String> {
    db.set_pinned(id, pinned).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_clip(db: State<Database>, id: i64) -> Result<(), String> {
    db.delete_clip(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(db: State<Database>) -> Result<(), String> {
    db.clear_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tags(db: State<Database>) -> Result<Vec<(String, i64)>, String> {
    db.list_tags_with_counts().map_err(|e| e.to_string())
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
