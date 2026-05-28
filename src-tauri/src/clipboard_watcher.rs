//! Monitoraggio della clipboard, event-driven.
//!
//! Su Windows `clipboard-master` usa `AddClipboardFormatListener` (eventi, zero
//! polling): la callback scatta solo quando la clipboard cambia davvero. Ogni
//! nuovo contenuto viene categorizzato e scritto subito nel DB (in WAL), così un
//! crash non perde nulla. Gestisce testo/URL e immagini (salvate come PNG).

use crate::db::{self, Db, NewClip};
use crate::{categorizer, images, win_clipboard};
use clipboard_master::{CallbackResult, ClipboardHandler, Master};
use std::collections::HashSet;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};

struct Handler {
    app: AppHandle,
    db: Arc<Db>,
    paused: Arc<AtomicBool>,
    max_history: Arc<AtomicI64>,
    dont_save_sensitive: Arc<AtomicBool>,
    sensitive_kinds: Arc<RwLock<HashSet<String>>>,
    images_dir: PathBuf,
    clipboard: arboard::Clipboard,
    /// Hash dell'ultima cattura, per non rielaborare lo stesso evento due volte.
    last_hash: Option<String>,
}

impl ClipboardHandler for Handler {
    fn on_clipboard_change(&mut self) -> CallbackResult {
        if self.paused.load(Ordering::Relaxed) {
            return CallbackResult::Next;
        }
        if let Err(e) = self.capture() {
            eprintln!("[watcher] errore cattura: {e}");
        }
        CallbackResult::Next
    }

    fn on_clipboard_error(&mut self, error: io::Error) -> CallbackResult {
        eprintln!("[watcher] errore: {error}");
        CallbackResult::Next // non fermare il monitoraggio per un errore transitorio
    }
}

impl Handler {
    fn capture(&mut self) -> Result<(), String> {
        // Rispetta i formati di esclusione dei password manager.
        if win_clipboard::should_skip() {
            return Ok(());
        }
        // Priorità ai file (CF_HDROP), poi testo, poi immagine.
        let files = win_clipboard::read_file_drop();
        if !files.is_empty() {
            return self.capture_files(files);
        }
        if let Ok(mut text) = self.clipboard.get_text() {
            if let Some(stripped) = text.strip_prefix('\u{feff}') {
                text = stripped.to_string();
            }
            if !text.trim().is_empty() {
                return self.capture_text(text);
            }
        }
        if let Ok(img) = self.clipboard.get_image() {
            return self.capture_image(img);
        }
        Ok(())
    }

    fn capture_files(&mut self, files: Vec<String>) -> Result<(), String> {
        // serializza la lista in JSON e usala sia come content sia per l'hash
        let json = serde_json::to_string(&files).map_err(|e| e.to_string())?;
        let hash = db::content_hash(&json);
        if self.last_hash.as_deref() == Some(hash.as_str()) {
            return Ok(());
        }
        self.last_hash = Some(hash.clone());

        let preview = if files.len() == 1 {
            files[0].clone()
        } else {
            format!("{} file ({})", files.len(), files[0])
        };
        let new = NewClip {
            content: Some(json),
            content_type: "files".into(),
            image_path: None,
            preview,
            created_at: db::now_millis(),
            char_count: files.len() as i64,
            sensitive: false,
            sensitive_kind: None,
            hash,
        };
        let id = self.db.insert_or_bump_clip(&new).map_err(|e| e.to_string())?;
        if let Ok(tag_id) = self.db.get_or_create_tag("File", None, true) {
            let _ = self.db.attach_tag(id, tag_id);
        }
        self.finish(id);
        Ok(())
    }

    fn capture_text(&mut self, text: String) -> Result<(), String> {
        let hash = db::content_hash(&text);
        if self.last_hash.as_deref() == Some(hash.as_str()) {
            return Ok(());
        }
        self.last_hash = Some(hash.clone());

        let cat = categorizer::categorize(&text);
        // "Sensibile per cancellazione" = kind rilevato E selezionato dall'utente.
        let kind_active = cat
            .sensitive_kind
            .map(|k| {
                self.sensitive_kinds
                    .read()
                    .map(|s| s.contains(k))
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if kind_active && self.dont_save_sensitive.load(Ordering::Relaxed) {
            // se quel contenuto era già in cronologia, rimuovilo (le pinnate restano)
            if let Ok(n) = self.db.delete_by_hash_if_unpinned(&hash) {
                if n > 0 {
                    let _ = self.app.emit("clips-changed", 0_i64);
                }
            }
            return Ok(());
        }
        let preview: String = text.trim().chars().take(200).collect();
        let new = NewClip {
            content: Some(text.clone()),
            content_type: cat.content_type.to_string(),
            image_path: None,
            preview,
            created_at: db::now_millis(),
            char_count: text.chars().count() as i64,
            sensitive: cat.sensitive,
            sensitive_kind: cat.sensitive_kind.map(|s| s.to_string()),
            hash,
        };
        let id = self.db.insert_or_bump_clip(&new).map_err(|e| e.to_string())?;
        if let Ok(tag_id) = self.db.get_or_create_tag(cat.tag, None, true) {
            let _ = self.db.attach_tag(id, tag_id);
        }
        self.finish(id);
        Ok(())
    }

    fn capture_image(&mut self, img: arboard::ImageData) -> Result<(), String> {
        let hash = db::bytes_hash(&img.bytes);
        if self.last_hash.as_deref() == Some(hash.as_str()) {
            return Ok(());
        }
        self.last_hash = Some(hash.clone());

        let path = self.images_dir.join(format!("{hash}.png"));
        if !path.exists() {
            images::save_rgba_png(&path, img.width as u32, img.height as u32, &img.bytes)?;
        }
        // genera la thumbnail (200px lato lungo) se manca
        let thumb = images::thumb_path_for(&path);
        if !thumb.exists() {
            let _ = images::save_thumbnail(&path, &thumb, 200);
        }
        let new = NewClip {
            content: None,
            content_type: "image".into(),
            image_path: Some(path.to_string_lossy().to_string()),
            preview: format!("Immagine {}×{}", img.width, img.height),
            created_at: db::now_millis(),
            char_count: 0,
            sensitive: false,
            sensitive_kind: None,
            hash,
        };
        // niente tag automatico: le immagini hanno la loro sezione dedicata
        let id = self.db.insert_or_bump_clip(&new).map_err(|e| e.to_string())?;
        self.finish(id);
        Ok(())
    }

    /// Pota la cronologia e notifica il frontend (con l'id appena aggiunto/risalito).
    fn finish(&self, id: i64) {
        let _ = self.db.prune_to_limit(self.max_history.load(Ordering::Relaxed));
        let _ = self.app.emit("clips-changed", id);
    }
}

/// Avvia il monitoraggio su un thread dedicato.
pub fn start(
    app: AppHandle,
    db: Arc<Db>,
    paused: Arc<AtomicBool>,
    max_history: Arc<AtomicI64>,
    dont_save_sensitive: Arc<AtomicBool>,
    sensitive_kinds: Arc<RwLock<HashSet<String>>>,
    images_dir: PathBuf,
) {
    std::thread::spawn(move || {
        let clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[watcher] impossibile aprire la clipboard: {e}");
                return;
            }
        };
        let handler = Handler {
            app,
            db,
            paused,
            max_history,
            dont_save_sensitive,
            sensitive_kinds,
            images_dir,
            clipboard,
            last_hash: None,
        };
        match Master::new(handler) {
            Ok(mut master) => {
                if let Err(e) = master.run() {
                    eprintln!("[watcher] master terminato con errore: {e}");
                }
            }
            Err(e) => eprintln!("[watcher] impossibile creare il master: {e}"),
        }
    });
}
