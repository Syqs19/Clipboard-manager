//! Comandi sui tag: elenco con conteggi, creazione/rimozione (singola e bulk),
//! rinomina, colore e pin nella sidebar.

use crate::commands::Database;
use crate::error::{AppError, AppResult};
use tauri::State;

#[tauri::command]
pub fn list_tags(db: State<Database>) -> AppResult<Vec<crate::db::TagInfo>> {
    Ok(db.list_tags_with_counts()?)
}

/// Fissa/sfissa un tag nella sidebar.
#[tauri::command]
pub fn set_tag_pinned(db: State<Database>, name: String, pinned: bool) -> AppResult<()> {
    Ok(db.set_tag_pinned(name.trim(), pinned)?)
}

/// Rinomina un tag (errore se il nuovo nome è già usato).
#[tauri::command]
pub fn rename_tag(db: State<Database>, old: String, new: String) -> AppResult<()> {
    // db.rename_tag ritorna Result<_, String>: la stringa diventa AppError::Msg via From.
    db.rename_tag(&old, &new).map_err(AppError::Msg)
}

/// Rimuove un tag da più clip in un colpo.
#[tauri::command]
pub fn bulk_remove_tag(db: State<Database>, ids: Vec<i64>, name: String) -> AppResult<()> {
    Ok(db.bulk_remove_tag(&ids, name.trim())?)
}

/// Aggiunge un tag manuale a più clip in un colpo.
#[tauri::command]
pub fn bulk_add_tag(db: State<Database>, ids: Vec<i64>, name: String) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::msg("empty tag name"));
    }
    let tag_id = db.get_or_create_tag(name, None, false)?;
    for id in ids {
        db.attach_tag(id, tag_id)?;
    }
    Ok(())
}

/// Imposta il colore di un tag.
#[tauri::command]
pub fn set_tag_color(db: State<Database>, name: String, color: String) -> AppResult<()> {
    Ok(db.set_tag_color(name.trim(), &color)?)
}

/// Aggiunge un tag manuale (creandolo se non esiste) a una clip.
#[tauri::command]
pub fn add_tag(db: State<Database>, id: i64, name: String) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::msg("empty tag name"));
    }
    let tag_id = db.get_or_create_tag(name, None, false)?;
    Ok(db.attach_tag(id, tag_id)?)
}

/// Rimuove un tag da una clip (per nome).
#[tauri::command]
pub fn remove_tag(db: State<Database>, id: i64, name: String) -> AppResult<()> {
    Ok(db.remove_tag_by_name(id, name.trim())?)
}
