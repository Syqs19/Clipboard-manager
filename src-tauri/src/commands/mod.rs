//! Comandi esposti al frontend (invoke), organizzati per area funzionale.
//!
//! Struttura pensata per crescere con le macro-sezioni dell'app: ogni sezione
//! ha la sua sotto-cartella (`clipboard/` oggi; in futuro `tools/`, `design/`…),
//! mentre `system/` raccoglie i comandi trasversali (impostazioni, shell, stats).
//!
//! I comandi sono re-esportati qui sotto con `pub use`, così `lib.rs` continua a
//! riferirli come `commands::nome` nel `generate_handler!` senza conoscere la
//! struttura interna dei moduli.
//!
//! Importante per la privacy: `copy_clip` recupera il contenuto **completo** dal
//! DB (non quello mascherato mostrato nella UI), così i dati sensibili restano
//! copiabili pur essendo nascosti a schermo.

use crate::crypto::MasterKey;
use crate::db::Db;
use crate::settings::RuntimeState;
use crate::settings::DEFAULT_MAX_HISTORY;
use std::sync::Arc;

/// Alias condivisi dai comandi per gli oggetti gestiti da Tauri.
pub(crate) type Database = Arc<Db>;
pub(crate) type Key = Arc<MasterKey>;
pub(crate) type Runtime = Arc<RuntimeState>;

// se il frontend non passa un limite, carica fino al tetto della cronologia
// (così la UI mostra tutte le clip conservate, non un sottoinsieme)
pub(crate) const DEFAULT_LIMIT: i64 = DEFAULT_MAX_HISTORY;

pub mod clipboard;
pub mod system;
pub mod tools;

// Re-export piatto: i nomi dei comandi restano `commands::<nome>` per lib.rs.
pub use clipboard::clips::*;
pub use clipboard::io::*;
pub use clipboard::tags::*;
pub use system::settings::*;
pub use system::shell::*;
pub use system::stats::*;
pub use tools::convert::*;
pub use tools::ports::*;
