//! Stato runtime condiviso e regolabile dalle Impostazioni.
//!
//! I valori persistenti vivono nello store `settings.json` (lato frontend);
//! qui teniamo gli atomici letti dai thread (watcher, gestione finestra) e
//! aggiornati dai comandi quando l'utente cambia le impostazioni.

use std::sync::atomic::{AtomicBool, AtomicI64};
use std::sync::Arc;

pub const DEFAULT_MAX_HISTORY: i64 = 200;
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+V";

pub struct RuntimeState {
    /// Cattura in pausa (toggle dal tray).
    pub paused: Arc<AtomicBool>,
    /// Limite massimo di clip non-pinnate in cronologia.
    pub max_history: Arc<AtomicI64>,
    /// Se true, la X nasconde nel tray; se false, la X chiude l'app.
    pub close_to_tray: Arc<AtomicBool>,
}
