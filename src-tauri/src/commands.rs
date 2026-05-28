//! Comandi esposti al frontend (invoke). Accedono al DB condiviso e alla clipboard.
//!
//! Importante per la privacy: `copy_clip` recupera il contenuto **completo** dal
//! DB (non quello mascherato mostrato nella UI), così i dati sensibili restano
//! copiabili pur essendo nascosti a schermo.

use crate::crypto::MasterKey;
use crate::db::{Clip, Db, NewClip};
use crate::settings::{LastSelfWrite, RuntimeState};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

type Database = Arc<Db>;
type Key = Arc<MasterKey>;

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
/// Se `as_plain` è true, una clip con HTML viene copiata SOLO come testo (utile per
/// "Incolla come testo semplice").
fn write_clip_to_clipboard(
    db: &Db,
    key: &MasterKey,
    last_self_write: &LastSelfWrite,
    id: i64,
    as_plain: bool,
) -> Result<(), String> {
    let clip = db
        .get_clip(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "clip not found".to_string())?;
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    // segnala al watcher: il prossimo evento clipboard con questo hash
    // è una nostra scrittura, va ignorato (niente "auto-bump" della clip).
    let mark_self_write = |hash: String| {
        if let Ok(mut g) = last_self_write.lock() {
            *g = Some(hash);
        }
    };

    if clip.content_type == "image" {
        if let Some(path) = clip.image_path {
            let (w, h, rgba) =
                crate::images::load_png_rgba(std::path::Path::new(&path), key)?;
            mark_self_write(crate::db::bytes_hash(&rgba));
            cb.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(rgba),
            })
            .map_err(|e| e.to_string())?;
        }
    } else if clip.content_type == "files" {
        // CF_HDROP per consentire all'utente di incollare i file in Esplora risorse
        if let Some(json) = clip.content {
            let paths: Vec<String> =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            // l'hash usato dal watcher è quello del JSON serializzato dai path
            let watcher_json =
                serde_json::to_string(&paths).map_err(|e| e.to_string())?;
            mark_self_write(crate::db::content_hash(&watcher_json));
            if !crate::win_clipboard::write_file_drop(&paths) {
                return Err("Couldn't write the file list to the clipboard".into());
            }
        }
    } else if let Some(content) = clip.content {
        mark_self_write(crate::db::content_hash(&content));
        // se sono disponibili versioni formattate (HTML/RTF) e l'utente non
        // ha chiesto "plain", le scriviamo accanto al testo così l'incolla
        // mantiene la formattazione
        if !as_plain && (clip.content_html.is_some() || clip.content_rtf.is_some()) {
            if crate::win_clipboard::write_rich_clipboard(
                &content,
                clip.content_html.as_deref(),
                clip.content_rtf.as_deref(),
            ) {
                return Ok(());
            }
            // fallback su testo semplice se la scrittura combinata fallisce
        }
        cb.set_text(content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn copy_clip(
    db: State<Database>,
    key: State<Key>,
    last_self_write: State<LastSelfWrite>,
    id: i64,
    as_plain: Option<bool>,
) -> Result<(), String> {
    write_clip_to_clipboard(
        db.inner(),
        key.inner(),
        last_self_write.inner(),
        id,
        as_plain.unwrap_or(false),
    )
}

/// Restituisce i byte PNG (decifrati) di un'immagine salvata su disco, così
/// il frontend può costruire un Blob/ObjectURL senza passare dal protocollo
/// `asset://` (che vedrebbe solo blob cifrati opachi).
#[tauri::command]
pub fn read_image_bytes(key: State<Key>, path: String) -> Result<Response, String> {
    let bytes =
        crate::images::load_png_bytes(std::path::Path::new(&path), key.inner())?;
    Ok(Response::new(bytes))
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
    // elimina anche l'eventuale file immagine + thumbnail associati
    if let Ok(Some(clip)) = db.get_clip(id) {
        if let Some(path) = clip.image_path {
            let p = std::path::Path::new(&path);
            let _ = std::fs::remove_file(p);
            let _ = std::fs::remove_file(crate::images::thumb_path_for(p));
        }
    }
    db.delete_clip(id).map_err(|e| e.to_string())
}

/// Elimina più clip in un colpo (con cleanup dei file immagine e thumbnail).
#[tauri::command]
pub fn remove_clips(db: State<Database>, ids: Vec<i64>) -> Result<(), String> {
    if let Ok(paths) = db.image_paths_for(&ids) {
        for p in paths {
            let path = std::path::Path::new(&p);
            let _ = std::fs::remove_file(path);
            let _ = std::fs::remove_file(crate::images::thumb_path_for(path));
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

// ----- Export / Import della cronologia -----

#[derive(Serialize, Deserialize)]
struct ExportData {
    version: u32,
    exported_at: i64,
    tags: Vec<ExportTag>,
    clips: Vec<ExportClip>,
}

#[derive(Serialize, Deserialize)]
struct ExportTag {
    name: String,
    color: Option<String>,
    is_auto: bool,
}

#[derive(Serialize, Deserialize)]
struct ExportClip {
    content: Option<String>,
    content_type: String,
    image_filename: Option<String>,
    image_b64: Option<String>,
    preview: String,
    created_at: i64,
    pinned: bool,
    pinned_order: Option<i64>,
    char_count: i64,
    sensitive: bool,
    sensitive_kind: Option<String>,
    hash: String,
    tags: Vec<String>,
}

/// Esporta tutta la cronologia (clip + tag) in un file JSON. Le immagini
/// vengono inlinate in base64 così il file è autonomo.
#[tauri::command]
pub fn export_history(
    app: AppHandle,
    db: State<Database>,
    key: State<Key>,
    path: String,
) -> Result<usize, String> {
    let clips = db.list_recent(i64::MAX).map_err(|e| e.to_string())?;
    let tags = db.list_all_tags().map_err(|e| e.to_string())?;

    let mut export_clips = Vec::with_capacity(clips.len());
    for c in &clips {
        let (image_filename, image_b64) = match &c.image_path {
            Some(p) => {
                // export: salva il PNG **in chiaro** (decifrato) così il file
                // JSON è portabile su altre macchine / nuove installazioni
                let bytes = crate::images::load_png_bytes(Path::new(p), key.inner())?;
                let fname = Path::new(p)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string());
                (fname, Some(B64.encode(&bytes)))
            }
            None => (None, None),
        };
        export_clips.push(ExportClip {
            content: c.content.clone(),
            content_type: c.content_type.clone(),
            image_filename,
            image_b64,
            preview: c.preview.clone(),
            created_at: c.created_at,
            pinned: c.pinned,
            pinned_order: c.pinned_order,
            char_count: c.char_count,
            sensitive: c.sensitive,
            sensitive_kind: None, // ricategorizzato all'import dal contenuto
            hash: c.hash.clone(),
            tags: c.tags.clone(),
        });
    }

    let data = ExportData {
        version: 1,
        exported_at: crate::db::now_millis(),
        tags: tags
            .into_iter()
            .map(|(name, color, is_auto)| ExportTag { name, color, is_auto })
            .collect(),
        clips: export_clips,
    };

    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    let _ = app;
    Ok(clips.len())
}

/// Importa una cronologia da file JSON. `mode` = "merge" (mantiene gli esistenti
/// per hash, aggiunge gli altri) oppure "replace" (svuota tutto e reinserisce).
#[tauri::command]
pub fn import_history(
    app: AppHandle,
    db: State<Database>,
    key: State<Key>,
    path: String,
    mode: String,
) -> Result<usize, String> {
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: ExportData = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    if data.version != 1 {
        return Err(format!("unknown export format (v{})", data.version));
    }

    let images_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let replace = mode == "replace";
    if replace {
        // rimuovi i file immagine attualmente referenziati prima del wipe
        if let Ok(paths) = db.all_image_paths() {
            for p in paths {
                let _ = std::fs::remove_file(p);
            }
        }
        db.wipe_all().map_err(|e| e.to_string())?;
    }

    // crea/aggiorna tag (con colore e flag auto)
    for t in &data.tags {
        db.get_or_create_tag(&t.name, t.color.as_deref(), t.is_auto)
            .map_err(|e| e.to_string())?;
    }

    // pre-calcola gli hash esistenti per il merge (no full scan in loop)
    let existing_hashes: std::collections::HashSet<String> = if replace {
        std::collections::HashSet::new()
    } else {
        db.list_recent(i64::MAX)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|x| x.hash)
            .collect()
    };

    let mut imported = 0usize;
    for c in data.clips {
        if !replace && existing_hashes.contains(&c.hash) {
            continue;
        }

        // ricostruisci eventuale immagine da base64 (i byte JSON sono PNG in
        // chiaro: vanno cifrati prima di toccare il disco)
        let image_path = match (c.image_b64.as_deref(), c.image_filename.as_deref()) {
            (Some(b64), Some(fname)) => {
                let png_bytes = B64.decode(b64).map_err(|e| e.to_string())?;
                let blob = crate::crypto::encrypt_bytes(key.inner(), &png_bytes)?;
                let dest = images_dir.join(fname);
                std::fs::write(&dest, &blob).map_err(|e| e.to_string())?;
                Some(dest.to_string_lossy().to_string())
            }
            _ => None,
        };

        // ricategorizza per ricavare sensitive_kind se mancante (rifletto su contenuto)
        let sensitive_kind = if let Some(text) = c.content.as_deref() {
            crate::categorizer::categorize(text)
                .sensitive_kind
                .map(|s| s.to_string())
        } else {
            None
        };

        let new = NewClip {
            content: c.content,
            content_html: None,
            content_rtf: None,
            content_type: c.content_type,
            image_path,
            preview: c.preview,
            created_at: c.created_at,
            char_count: c.char_count,
            sensitive: c.sensitive,
            sensitive_kind,
            hash: c.hash,
        };
        let id = db.insert_or_bump_clip(&new).map_err(|e| e.to_string())?;
        db.set_pin_raw(id, c.pinned, c.pinned_order)
            .map_err(|e| e.to_string())?;
        for tag_name in c.tags {
            if let Ok(tid) = db.get_or_create_tag(&tag_name, None, false) {
                let _ = db.attach_tag(id, tid);
            }
        }
        imported += 1;
    }

    // notifica la UI che la lista è cambiata
    let _ = app.emit("clips-changed", 0_i64);
    Ok(imported)
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
        return Err("empty tag name".to_string());
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
pub fn list_tags(
    db: State<Database>,
) -> Result<Vec<(String, i64, Option<String>, bool)>, String> {
    db.list_tags_with_counts().map_err(|e| e.to_string())
}

/// Fissa/sfissa un tag nella sidebar.
#[tauri::command]
pub fn set_tag_pinned(db: State<Database>, name: String, pinned: bool) -> Result<(), String> {
    db.set_tag_pinned(name.trim(), pinned).map_err(|e| e.to_string())
}

/// Rinomina un tag (errore se il nuovo nome è già usato).
#[tauri::command]
pub fn rename_tag(db: State<Database>, old: String, new: String) -> Result<(), String> {
    db.rename_tag(&old, &new)
}

/// Rimuove un tag da più clip in un colpo.
#[tauri::command]
pub fn bulk_remove_tag(
    db: State<Database>,
    ids: Vec<i64>,
    name: String,
) -> Result<(), String> {
    db.bulk_remove_tag(&ids, name.trim()).map_err(|e| e.to_string())
}

/// Apre la cartella contenente il file indicato in Esplora risorse, selezionando
/// il file (`explorer.exe /select,"path"`).
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".into());
    }
    // `explorer.exe /select,"path"` richiede che il path SIA quotato letteralmente,
    // ma std::process::Command::arg quoterebbe l'intero "/select,..." rompendo il
    // parsing di explorer. Usiamo raw_arg (Windows-only) per controllare la stringa.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Esplora risorse preferisce path assoluti con backslash
        let abs = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
        // strippa il prefisso UNC '\\?\' se presente
        let s = abs.to_string_lossy();
        let clean = s.strip_prefix(r"\\?\").unwrap_or(&s);
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", clean))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
        return Err("empty tag name".to_string());
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
