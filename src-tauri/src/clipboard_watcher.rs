//! Monitoraggio della clipboard, event-driven.
//!
//! Su Windows `clipboard-master` usa `AddClipboardFormatListener` (eventi, zero
//! polling): la callback scatta solo quando la clipboard cambia davvero. Ogni
//! nuovo contenuto viene categorizzato e scritto subito nel DB (in WAL), così un
//! crash non perde nulla.
//!
//! NOTA: per ora cattura solo testo/URL. La cattura immagini è un incremento
//! successivo (richiede encoder PNG + gestione file).

use crate::categorizer;
use crate::db::{self, Db, NewClip};
use clipboard_master::{CallbackResult, ClipboardHandler, Master};
use std::io;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

struct Handler {
    app: AppHandle,
    db: Arc<Db>,
    paused: Arc<AtomicBool>,
    max_history: Arc<AtomicI64>,
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
        // Solo testo/URL per ora: se non c'è testo (immagine/file), ignora.
        let mut text = match self.clipboard.get_text() {
            Ok(t) => t,
            Err(_) => return Ok(()),
        };
        // rimuovi un eventuale BOM iniziale (artefatto di alcune app/strumenti)
        if let Some(stripped) = text.strip_prefix('\u{feff}') {
            text = stripped.to_string();
        }
        if text.trim().is_empty() {
            return Ok(());
        }

        let hash = db::content_hash(&text);
        if self.last_hash.as_deref() == Some(hash.as_str()) {
            return Ok(()); // stesso contenuto dell'evento precedente
        }
        self.last_hash = Some(hash.clone());

        let cat = categorizer::categorize(&text);
        let preview: String = text.trim().chars().take(200).collect();
        let new = NewClip {
            content: Some(text.clone()),
            content_type: cat.content_type.to_string(),
            image_path: None,
            preview,
            created_at: db::now_millis(),
            char_count: text.chars().count() as i64,
            sensitive: cat.sensitive,
            hash,
        };

        let id = self.db.insert_or_bump_clip(&new).map_err(|e| e.to_string())?;
        // tag automatico suggerito
        if let Ok(tag_id) = self.db.get_or_create_tag(cat.tag, None, true) {
            let _ = self.db.attach_tag(id, tag_id);
        }
        let _ = self.db.prune_to_limit(self.max_history.load(Ordering::Relaxed));

        // avvisa il frontend che la cronologia è cambiata
        let _ = self.app.emit("clips-changed", ());
        Ok(())
    }
}

/// Avvia il monitoraggio su un thread dedicato.
pub fn start(
    app: AppHandle,
    db: Arc<Db>,
    paused: Arc<AtomicBool>,
    max_history: Arc<AtomicI64>,
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
