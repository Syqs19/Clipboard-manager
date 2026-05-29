//! Comandi sulle clip: elenco, ricerca, copia (testo/immagine/file), pin,
//! cancellazione, trasformazioni "Paste as", merge e clip-gruppo (items).

use crate::commands::{Database, Key, DEFAULT_LIMIT};
use crate::crypto::MasterKey;
use crate::db::{Clip, Db};
use crate::error::{AppError, AppResult};
use crate::settings::LastSelfWrite;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn list_clips(db: State<Database>, limit: Option<i64>) -> AppResult<Vec<Clip>> {
    Ok(db.list_recent(limit.unwrap_or(DEFAULT_LIMIT))?)
}

#[tauri::command]
pub fn search_clips(db: State<Database>, query: String) -> AppResult<Vec<Clip>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(db.list_recent(DEFAULT_LIMIT)?);
    }
    // carica tutta la cronologia e classifica per pertinenza fuzzy in memoria
    // (la history è limitata, quindi è veloce)
    let all = db.list_recent(i64::MAX)?;
    Ok(fuzzy_rank(all, q))
}

/// Ordina le clip per pertinenza fuzzy rispetto a `query` (tollera refusi e match
/// parziali), considerando contenuto, preview, testo OCR e tag. Scarta i non-match.
fn fuzzy_rank(clips: Vec<Clip>, query: &str) -> Vec<Clip> {
    let matcher = SkimMatcherV2::default();
    let mut scored: Vec<(i64, Clip)> = clips
        .into_iter()
        .filter_map(|c| {
            let tags_joined = c.tags.join(" ");
            let mut best: Option<i64> = None;
            let fields = [
                c.content.as_deref(),
                Some(c.preview.as_str()),
                c.ocr_text.as_deref(),
                if tags_joined.is_empty() {
                    None
                } else {
                    Some(tags_joined.as_str())
                },
            ];
            for s in fields.into_iter().flatten() {
                if let Some(score) = matcher.fuzzy_match(s, query) {
                    best = Some(best.map_or(score, |b| b.max(score)));
                }
            }
            best.map(|score| (score, c))
        })
        .collect();
    // pertinenza desc, a parità i più recenti prima
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.created_at.cmp(&a.1.created_at)));
    scored.into_iter().map(|(_, c)| c).collect()
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
) -> AppResult<()> {
    let clip = db
        .get_clip(id)?
        .ok_or_else(|| AppError::msg("clip not found"))?;
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    // segnala al watcher: il prossimo evento clipboard con questo hash
    // è una nostra scrittura, va ignorato (niente "auto-bump" della clip).
    let mark_self_write = |hash: String| {
        if let Ok(mut g) = last_self_write.lock() {
            *g = Some(hash);
        }
    };

    if clip.content_type == crate::db::ContentType::Image {
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
    } else if clip.content_type == crate::db::ContentType::Files {
        // CF_HDROP per consentire all'utente di incollare i file in Esplora risorse
        if let Some(json) = clip.content {
            let paths: Vec<String> = serde_json::from_str(&json)?;
            // l'hash usato dal watcher è quello del JSON serializzato dai path
            let watcher_json = serde_json::to_string(&paths)?;
            mark_self_write(crate::db::content_hash(&watcher_json));
            if !crate::win_clipboard::write_file_drop(&paths) {
                return Err(AppError::msg("Couldn't write the file list to the clipboard"));
            }
        }
    } else if let Some(content) = clip.content {
        mark_self_write(crate::db::content_hash(&content));
        // se sono disponibili versioni formattate (HTML/RTF) e l'utente non
        // ha chiesto "plain", le scriviamo accanto al testo così l'incolla
        // mantiene la formattazione
        if !as_plain
            && (clip.content_html.is_some() || clip.content_rtf.is_some())
            && crate::win_clipboard::write_rich_clipboard(
                &content,
                clip.content_html.as_deref(),
                clip.content_rtf.as_deref(),
            )
        {
            return Ok(());
        }
        // fallback su testo semplice se la scrittura combinata fallisce
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
) -> AppResult<()> {
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
pub fn read_image_bytes(key: State<Key>, path: String) -> AppResult<Response> {
    let bytes =
        crate::images::load_png_bytes(std::path::Path::new(&path), key.inner())?;
    Ok(Response::new(bytes))
}

/// Mette un'immagine della cronologia negli appunti **come file** (CF_HDROP),
/// così l'utente può incollarla in una cartella con Ctrl+V. Il PNG è cifrato su
/// disco: lo decifro in una cartella temporanea dedicata (ripulita ad ogni uso,
/// così resta al massimo una copia in chiaro) e metto quel percorso negli appunti.
#[tauri::command]
pub fn copy_image_as_file(
    app: AppHandle,
    db: State<Database>,
    key: State<Key>,
    last_self_write: State<LastSelfWrite>,
    id: i64,
) -> AppResult<()> {
    let clip = db
        .get_clip(id)?
        .ok_or_else(|| AppError::msg("clip not found"))?;
    if clip.content_type != crate::db::ContentType::Image {
        return Err(AppError::msg("not an image clip"));
    }
    let src = clip.image_path.ok_or_else(|| AppError::msg("no image on disk"))?;
    let bytes = crate::images::load_png_bytes(std::path::Path::new(&src), key.inner())?;

    let tmp_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("tmp_export");
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir)?;
    let dest = tmp_dir.join("clipboard-image.png");
    std::fs::write(&dest, &bytes)?;

    let paths = vec![dest.to_string_lossy().to_string()];
    // segnala self-write: il watcher non deve trasformare il file temporaneo
    // in una clip "files" (l'hash combacia con quello calcolato in capture_files)
    let watcher_json = serde_json::to_string(&paths)?;
    if let Ok(mut g) = last_self_write.lock() {
        *g = Some(crate::db::content_hash(&watcher_json));
    }
    if !crate::win_clipboard::write_file_drop(&paths) {
        return Err(AppError::msg("Couldn't put the image on the clipboard as a file"));
    }
    Ok(())
}

/// Mette negli appunti una versione **trasformata** del clip, senza modificare
/// quello salvato (feature "Paste as"). Per i clip di testo applica una delle
/// trasformazioni pure di `transforms`; per le immagini scrive il PNG come
/// stringa base64 (`base64`) o come immagine markdown con data-URI (`markdown`).
///
/// La trasformazione "stats" è informativa (conteggi): NON tocca gli appunti e
/// ritorna la stringa, che il frontend mostra in un toast. Tutte le altre
/// copiano il risultato e ritornano `None`.
#[tauri::command]
pub fn copy_transformed(
    db: State<Database>,
    key: State<Key>,
    last_self_write: State<LastSelfWrite>,
    id: i64,
    transform: String,
) -> AppResult<Option<String>> {
    let clip = db
        .get_clip(id)?
        .ok_or_else(|| AppError::msg("clip not found"))?;

    let out = if clip.content_type == crate::db::ContentType::Image {
        let path = clip.image_path.ok_or_else(|| AppError::msg("no image on disk"))?;
        let bytes = crate::images::load_png_bytes(std::path::Path::new(&path), key.inner())?;
        let b64 = B64.encode(&bytes);
        match transform.as_str() {
            "base64" => b64,
            "markdown" => format!("![](data:image/png;base64,{})", b64),
            _ => return Err(AppError::msg("unsupported image transform")),
        }
    } else {
        let content = clip.content.ok_or_else(|| AppError::msg("clip has no text"))?;
        crate::transforms::apply(&transform, &content)
            .ok_or_else(|| AppError::msg("transform not applicable to this content"))?
    };

    // "stats" è solo informazione: ritorna senza copiare
    if transform == "stats" {
        return Ok(Some(out));
    }

    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    // self-write guard: il watcher ignora il prossimo evento con questo hash
    if let Ok(mut g) = last_self_write.lock() {
        *g = Some(crate::db::content_hash(&out));
    }
    cb.set_text(out).map_err(|e| e.to_string())?;
    Ok(None)
}

#[tauri::command]
pub fn toggle_pin(db: State<Database>, id: i64, pinned: bool) -> AppResult<()> {
    Ok(db.set_pinned(id, pinned)?)
}

/// Riordina le clip fissate secondo la lista di id passata (drag & drop).
#[tauri::command]
pub fn reorder_pinned(db: State<Database>, ids: Vec<i64>) -> AppResult<()> {
    Ok(db.reorder_pinned(&ids)?)
}

/// Cancella il PNG e la sua thumbnail dato il path.
fn remove_png_and_thumb(path: &str) {
    let p = std::path::Path::new(path);
    let _ = std::fs::remove_file(p);
    let _ = std::fs::remove_file(crate::images::thumb_path_for(p));
}

#[tauri::command]
pub fn remove_clip(db: State<Database>, id: i64) -> AppResult<()> {
    // elimina anche l'eventuale file immagine + thumbnail associati
    if let Ok(Some(clip)) = db.get_clip(id) {
        if let Some(path) = clip.image_path {
            remove_png_and_thumb(&path);
        }
    }
    // se è una clip-gruppo, ripulisci anche i PNG dei suoi elementi immagine
    if let Ok(paths) = db.group_item_image_paths(&[id]) {
        for path in paths {
            remove_png_and_thumb(&path);
        }
    }
    Ok(db.delete_clip(id)?)
}

/// Elimina più clip in un colpo (con cleanup dei file immagine e thumbnail).
#[tauri::command]
pub fn remove_clips(db: State<Database>, ids: Vec<i64>) -> AppResult<()> {
    if let Ok(paths) = db.image_paths_for(&ids) {
        for p in paths {
            remove_png_and_thumb(&p);
        }
    }
    // PNG degli elementi delle eventuali clip-gruppo tra gli id
    if let Ok(paths) = db.group_item_image_paths(&ids) {
        for p in paths {
            remove_png_and_thumb(&p);
        }
    }
    db.delete_clips(&ids)?;
    Ok(())
}

/// Imposta lo stato pinned su più clip (true=pinna, false=despinna).
#[tauri::command]
pub fn bulk_set_pinned(
    db: State<Database>,
    ids: Vec<i64>,
    pinned: bool,
) -> AppResult<()> {
    for id in ids {
        db.set_pinned(id, pinned)?;
    }
    Ok(())
}

/// Fonde la clip `source` dentro `target` (devono essere dello stesso tipo).
/// Ritorna l'id della clip-gruppo risultante.
#[tauri::command]
pub fn merge_clips(db: State<Database>, source_id: i64, target_id: i64) -> AppResult<i64> {
    Ok(db.merge_clips(source_id, target_id, crate::db::now_millis())?)
}

/// Elementi di una clip-gruppo (per la vista dettaglio).
#[tauri::command]
pub fn list_clip_items(db: State<Database>, clip_id: i64) -> AppResult<Vec<crate::db::ClipItem>> {
    Ok(db.items_for_clip(clip_id)?)
}

/// Imposta (o azzera) l'etichetta di un elemento di gruppo.
#[tauri::command]
pub fn set_item_label(
    db: State<Database>,
    item_id: i64,
    label: Option<String>,
) -> AppResult<()> {
    Ok(db.set_item_label(item_id, label.as_deref())?)
}

/// Copia negli appunti un singolo elemento di una clip-gruppo (per tipo:
/// immagine ricostruita dal PNG, file come CF_HDROP, testo come testo).
#[tauri::command]
pub fn copy_clip_item(
    db: State<Database>,
    key: State<Key>,
    last_self_write: State<LastSelfWrite>,
    item_id: i64,
) -> AppResult<()> {
    let item = db
        .get_clip_item(item_id)?
        .ok_or_else(|| AppError::msg("item not found"))?;
    let mark = |hash: String| {
        if let Ok(mut g) = last_self_write.lock() {
            *g = Some(hash);
        }
    };
    if item.item_type == crate::db::ContentType::Image {
        if let Some(path) = item.image_path {
            let (w, h, rgba) =
                crate::images::load_png_rgba(std::path::Path::new(&path), key.inner())?;
            mark(crate::db::bytes_hash(&rgba));
            let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
            cb.set_image(arboard::ImageData {
                width: w as usize,
                height: h as usize,
                bytes: std::borrow::Cow::Owned(rgba),
            })
            .map_err(|e| e.to_string())?;
        }
    } else if item.item_type == crate::db::ContentType::Files {
        if let Some(json) = item.content {
            let paths: Vec<String> = serde_json::from_str(&json)?;
            let watcher_json = serde_json::to_string(&paths)?;
            mark(crate::db::content_hash(&watcher_json));
            if !crate::win_clipboard::write_file_drop(&paths) {
                return Err(AppError::msg("Couldn't write the file list to the clipboard"));
            }
        }
    } else if let Some(content) = item.content {
        mark(crate::db::content_hash(&content));
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_text(content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_history(db: State<Database>) -> AppResult<()> {
    Ok(db.clear_unpinned()?)
}

/// Modifica il contenuto testuale di un clip (ricategorizza tipo e sensibilità).
#[tauri::command]
pub fn update_clip(db: State<Database>, id: i64, content: String) -> AppResult<()> {
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
    )?;
    Ok(())
}
