//! Tipo d'errore unico dei comandi Tauri.
//!
//! Sostituisce il vecchio `Result<_, String>` con `.map_err(|e| e.to_string())`
//! ripetuto in ogni comando: con `#[from]` gli errori sottostanti (DB, I/O,
//! base64) si convertono da soli, quindi i `?` propagano senza boilerplate.
//!
//! Verso il frontend l'errore viaggia come **stringa** (il suo messaggio), così
//! il contratto invoke non cambia: la UI continua a ricevere un testo d'errore.

use serde::{Serialize, Serializer};

/// Errore restituito dai comandi. Le varianti `#[from]` assorbono gli errori
/// delle librerie; `Msg` copre gli errori di dominio con messaggio esplicito.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Db(#[from] rusqlite::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("decodifica base64 fallita: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("serializzazione JSON fallita: {0}")]
    Json(#[from] serde_json::Error),

    #[error("immagine: {0}")]
    Image(#[from] image::ImageError),

    /// Errore di dominio con messaggio già pronto per l'utente
    /// (es. "clip not found", "not an image clip").
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    /// Crea un errore di dominio da un messaggio.
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

/// `String` → `AppError::Msg`: permette `Err("…".into())` e `ok_or_else(|| "…".into())`
/// come prima, senza cambiare i siti che già usavano stringhe letterali.
impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Msg(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Msg(s.to_string())
    }
}

/// Verso il frontend serializza il messaggio (Display), non la struttura: la UI
/// riceve la stessa stringa d'errore di prima.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Alias comodo per le firme dei comandi: `AppResult<T>` = `Result<T, AppError>`.
pub type AppResult<T> = Result<T, AppError>;
