//! Stato runtime condiviso e regolabile dalle Impostazioni.
//!
//! I valori persistenti vivono nello store `settings.json` (lato frontend);
//! qui teniamo gli atomici letti dai thread (watcher, gestione finestra) e
//! aggiornati dai comandi quando l'utente cambia le impostazioni.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64};
use std::sync::{Arc, Mutex, RwLock};

/// Hash dell'ultimo contenuto scritto nella clipboard **dall'app stessa**
/// (es. quando l'utente copia una clip dalla cronologia). Il watcher lo
/// confronta col contenuto del prossimo evento clipboard: se coincide,
/// non rielabora (evita il fastidioso "auto-bump" della clip in cima a
/// ogni copia interna). Consume-on-match: viene messo a None dopo l'uso.
pub type LastSelfWrite = Arc<Mutex<Option<String>>>;

pub const DEFAULT_MAX_HISTORY: i64 = 200;
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+V";

/// Categorie considerate sensibili ai fini della cancellazione/non-salvataggio.
/// Default: tutte. La mascheratura nella UI è indipendente da questa selezione.
pub const ALL_SENSITIVE_KINDS: &[&str] = &[
    "email",
    "iban",
    "card",
    "token",
    "codice_fiscale",
    "ssn",
    "private_key",
    "jwt",
    "crypto",
    "mask",
];

pub struct RuntimeState {
    /// Cattura in pausa (toggle dal tray).
    pub paused: Arc<AtomicBool>,
    /// Limite massimo di clip non-pinnate in cronologia.
    pub max_history: Arc<AtomicI64>,
    /// Se true, la X nasconde nel tray; se false, la X chiude l'app.
    pub close_to_tray: Arc<AtomicBool>,
    /// Se true, le clip rilevate come sensibili non vengono salvate affatto.
    pub dont_save_sensitive: Arc<AtomicBool>,
    /// TTL in minuti per le clip sensibili (0 = disabilitato, mai cancellate per età).
    pub sensitive_ttl_minutes: Arc<AtomicI64>,
    /// Categorie sensibili per cui valgono "non salvare" e TTL (subset di ALL_SENSITIVE_KINDS).
    pub sensitive_kinds: Arc<RwLock<HashSet<String>>>,
    /// Se true, le immagini catturate vengono indicizzate via OCR (testo cercabile).
    pub ocr_enabled: Arc<AtomicBool>,
}
