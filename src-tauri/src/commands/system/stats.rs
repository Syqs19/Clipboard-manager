//! Statistiche d'uso mostrate nel pannello Impostazioni.

use crate::commands::Database;
use crate::error::AppResult;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
pub struct Stats {
    total: i64,
    pinned: i64,
    images: i64,
    sensitive: i64,
    tags: i64,
    db_bytes: u64,
    images_bytes: u64,
}

/// Statistiche: conteggi dal DB + uso disco (file DB e cartella immagini).
#[tauri::command]
pub fn get_stats(app: AppHandle, db: State<Database>) -> AppResult<Stats> {
    let c = db.stats()?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // DB cifrato + eventuali file WAL/SHM
    let db_bytes: u64 = ["clips.db", "clips.db-wal", "clips.db-shm"]
        .iter()
        .map(|f| std::fs::metadata(data_dir.join(f)).map(|m| m.len()).unwrap_or(0))
        .sum();

    // somma di tutti i file nella cartella immagini (PNG cifrati + thumbnail)
    let images_bytes: u64 = std::fs::read_dir(data_dir.join("images"))
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.metadata().ok().map(|m| m.len()))
                .sum()
        })
        .unwrap_or(0);

    Ok(Stats {
        total: c.total,
        pinned: c.pinned,
        images: c.images,
        sensitive: c.sensitive,
        tags: c.tags,
        db_bytes,
        images_bytes,
    })
}
