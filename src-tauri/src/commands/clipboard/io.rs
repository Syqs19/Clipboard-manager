//! Import/export della cronologia in un file JSON autonomo (immagini inlinate
//! in base64). Formato versionato: v1 senza gruppi, v2 con gli items.

use crate::commands::{Database, Key};
use crate::db::NewClip;
use crate::error::AppResult;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};

/// Sanitizza un `image_filename` proveniente da un file di export (input non
/// fidato): tiene solo il nome file finale, scartando qualsiasi componente di
/// percorso. Impedisce il path traversal in scrittura (es. `..\..\evil.png` o
/// `C:\Windows\x.png`). Ritorna `None` se il nome è vuoto, è `.`/`..`, o non è
/// un semplice nome file. Il chiamante può così saltare l'immagine in sicurezza.
fn safe_image_filename(raw: &str) -> Option<String> {
    let name = std::path::Path::new(raw).file_name()?.to_str()?;
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    Some(name.to_string())
}

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

/// Un elemento di una clip-gruppo nell'export. Le immagini sono inlinate b64.
#[derive(Serialize, Deserialize)]
struct ExportItem {
    item_type: crate::db::ContentType,
    content: Option<String>,
    image_filename: Option<String>,
    image_b64: Option<String>,
    label: Option<String>,
    char_count: i64,
}

#[derive(Serialize, Deserialize)]
struct ExportClip {
    content: Option<String>,
    content_type: crate::db::ContentType,
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
    /// elementi della clip-gruppo (vuoto per le clip singole)
    #[serde(default)]
    items: Vec<ExportItem>,
}

/// Esporta tutta la cronologia (clip + tag) in un file JSON. Le immagini
/// vengono inlinate in base64 così il file è autonomo.
#[tauri::command]
pub fn export_history(
    app: AppHandle,
    db: State<Database>,
    key: State<Key>,
    path: String,
) -> AppResult<usize> {
    let clips = db.list_recent(i64::MAX)?;
    let tags = db.list_all_tags()?;

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
        // per le clip-gruppo, serializza anche gli elementi (immagini inlinate b64)
        let mut items = Vec::new();
        if c.content_type == crate::db::ContentType::Group {
            for it in &c.items {
                let (ifn, ib64) = match &it.image_path {
                    Some(p) => {
                        let bytes = crate::images::load_png_bytes(Path::new(p), key.inner())?;
                        let fname = Path::new(p)
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string());
                        (fname, Some(B64.encode(&bytes)))
                    }
                    None => (None, None),
                };
                items.push(ExportItem {
                    item_type: it.item_type,
                    content: it.content.clone(),
                    image_filename: ifn,
                    image_b64: ib64,
                    label: it.label.clone(),
                    char_count: it.char_count,
                });
            }
        }
        export_clips.push(ExportClip {
            content: c.content.clone(),
            content_type: c.content_type,
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
            items,
        });
    }

    let data = ExportData {
        version: 2, // v2: include gli elementi (items) delle clip-gruppo
        exported_at: crate::db::now_millis(),
        tags: tags
            .into_iter()
            .map(|(name, color, is_auto)| ExportTag { name, color, is_auto })
            .collect(),
        clips: export_clips,
    };

    let json = serde_json::to_string_pretty(&data)?;
    std::fs::write(&path, json)?;
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
) -> AppResult<usize> {
    let json = std::fs::read_to_string(&path)?;
    let data: ExportData = serde_json::from_str(&json)?;
    // v1 = senza gruppi, v2 = con gli items delle clip-gruppo. Entrambe ok:
    // i file v1 non hanno il campo items (serde default = vuoto).
    if data.version != 1 && data.version != 2 {
        return Err(crate::error::AppError::msg(format!(
            "unknown export format (v{})",
            data.version
        )));
    }

    let images_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("images");
    std::fs::create_dir_all(&images_dir)?;

    let replace = mode == "replace";
    if replace {
        // rimuovi i file immagine attualmente referenziati prima del wipe
        if let Ok(paths) = db.all_image_paths() {
            for p in paths {
                let _ = std::fs::remove_file(p);
            }
        }
        db.wipe_all()?;
    }

    // crea/aggiorna tag (con colore e flag auto)
    for t in &data.tags {
        db.get_or_create_tag(&t.name, t.color.as_deref(), t.is_auto)?;
    }

    // pre-calcola gli hash esistenti per il merge (no full scan in loop)
    let existing_hashes: std::collections::HashSet<String> = if replace {
        std::collections::HashSet::new()
    } else {
        db.list_recent(i64::MAX)?
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
            (Some(b64), Some(fname)) => match safe_image_filename(fname) {
                Some(safe) => {
                    let png_bytes = B64.decode(b64)?;
                    let blob = crate::crypto::encrypt_bytes(key.inner(), &png_bytes)?;
                    let dest = images_dir.join(safe);
                    std::fs::write(&dest, &blob)?;
                    Some(dest.to_string_lossy().to_string())
                }
                None => None, // filename non valido/malevolo: importa la clip senza immagine
            },
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

        let is_group = c.content_type == crate::db::ContentType::Group;
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
        let id = db.insert_or_bump_clip(&new)?;
        db.set_pin_raw(id, c.pinned, c.pinned_order)?;
        for tag_name in c.tags {
            // import best-effort: un tag che non si attacca non deve far abortire
            // l'intero import (non è transazionale), ma il fallimento va segnalato.
            match db.get_or_create_tag(&tag_name, None, false) {
                Ok(tid) => {
                    if let Err(e) = db.attach_tag(id, tid) {
                        eprintln!("[import] tag '{tag_name}' su clip {id}: {e}");
                    }
                }
                Err(e) => eprintln!("[import] creazione tag '{tag_name}': {e}"),
            }
        }
        // ricostruisci gli elementi di una clip-gruppo (immagini da b64 → cifrate)
        if is_group {
            for (pos, it) in c.items.into_iter().enumerate() {
                let item_image = match (it.image_b64.as_deref(), it.image_filename.as_deref()) {
                    (Some(b64), Some(fname)) => match safe_image_filename(fname) {
                        Some(safe) => {
                            let png_bytes = B64.decode(b64)?;
                            let blob = crate::crypto::encrypt_bytes(key.inner(), &png_bytes)?;
                            let dest = images_dir.join(safe);
                            std::fs::write(&dest, &blob)?;
                            Some(dest.to_string_lossy().to_string())
                        }
                        None => None, // filename non valido/malevolo: item senza immagine
                    },
                    _ => None,
                };
                let new_item = crate::db::NewClipItem {
                    item_type: it.item_type,
                    content: it.content,
                    image_path: item_image,
                    label: it.label,
                    char_count: it.char_count,
                };
                if let Err(e) = db.insert_clip_item(id, pos as i64, &new_item) {
                    eprintln!("[import] elemento {pos} del gruppo {id}: {e}");
                }
            }
        }
        imported += 1;
    }

    // notifica la UI che la lista è cambiata
    let _ = app.emit("clips-changed", 0_i64);
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::safe_image_filename;

    #[test]
    fn keeps_a_plain_filename() {
        assert_eq!(safe_image_filename("clip-123.png").as_deref(), Some("clip-123.png"));
    }

    #[test]
    fn strips_traversal_components() {
        // un nome ostile con risalita viene ridotto al solo file finale
        assert_eq!(
            safe_image_filename(r"..\..\Windows\System32\evil.png").as_deref(),
            Some("evil.png")
        );
        assert_eq!(safe_image_filename("../../evil.png").as_deref(), Some("evil.png"));
    }

    #[test]
    fn strips_absolute_path() {
        assert_eq!(safe_image_filename(r"C:\Windows\x.png").as_deref(), Some("x.png"));
        assert_eq!(safe_image_filename("/etc/passwd").as_deref(), Some("passwd"));
    }

    #[test]
    fn rejects_empty_or_dot_segments() {
        assert_eq!(safe_image_filename(""), None);
        assert_eq!(safe_image_filename(".."), None);
        assert_eq!(safe_image_filename("."), None);
        assert_eq!(safe_image_filename(r"..\"), None);
    }
}
