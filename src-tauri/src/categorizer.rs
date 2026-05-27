//! Auto-categorizzazione del contenuto della clipboard.
//!
//! Data una stringa di testo, decide il `content_type` ("text" o "url") e un
//! tag suggerito ("Link", "Email", "Numeri", "Codice", "Testo lungo", "Testo").
//! Le immagini non passano da qui: il watcher le marca direttamente come "image".
#![allow(dead_code)] // `categorize` verrà collegato al watcher nello step successivo

use regex::Regex;
use std::sync::LazyLock;

/// Soglia oltre la quale un testo è considerato "lungo".
const LONG_TEXT_THRESHOLD: usize = 500;

static URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^https?://[^\s]+$").unwrap());

static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$").unwrap()
});

/// IBAN: 2 lettere + 2 cifre + fino a 30 alfanumerici (spazi opzionali rimossi prima).
static IBAN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$").unwrap());

/// Risultato della categorizzazione.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Category {
    /// "text" oppure "url".
    pub content_type: &'static str,
    /// Tag suggerito, mostrato all'utente (modificabile).
    pub tag: &'static str,
}

/// Classifica un contenuto testuale. L'ordine dei controlli è dal più specifico
/// al più generico, così un IBAN non viene scambiato per "codice" e uno snippet
/// lungo resta "Codice" invece di "Testo lungo".
pub fn categorize(content: &str) -> Category {
    let trimmed = content.trim();

    if URL_RE.is_match(trimmed) {
        return Category { content_type: "url", tag: "Link" };
    }
    if EMAIL_RE.is_match(trimmed) {
        return Category { content_type: "text", tag: "Email" };
    }
    if is_numeric_like(trimmed) {
        return Category { content_type: "text", tag: "Numeri" };
    }
    if looks_like_code(trimmed) {
        return Category { content_type: "text", tag: "Codice" };
    }
    if content.chars().count() > LONG_TEXT_THRESHOLD {
        return Category { content_type: "text", tag: "Testo lungo" };
    }
    Category { content_type: "text", tag: "Testo" }
}

/// Numeri puri, IBAN o carte di credito (13-19 cifre, eventuali spazi/trattini).
fn is_numeric_like(s: &str) -> bool {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return false;
    }
    if IBAN_RE.is_match(&compact) {
        return true;
    }
    // carta di credito / numero lungo: solo cifre (con eventuali separatori già rimossi)
    let digits: String = compact.chars().filter(|c| *c != '-').collect();
    if digits.chars().all(|c| c.is_ascii_digit()) {
        let n = digits.len();
        return (1..=19).contains(&n);
    }
    false
}

/// Euristica "sembra codice": presenza di simboli/parole chiave tipiche o
/// indentazione su più righe.
fn looks_like_code(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let symbols = ['{', '}', ';', '(', ')', '=', '<', '>'];
    let symbol_hits = s.chars().filter(|c| symbols.contains(c)).count();

    let keywords = [
        "function", "def ", "import ", "class ", "const ", "let ", "var ",
        "public ", "private ", "fn ", "return ", "#include", "=>", "::",
    ];
    let has_keyword = keywords.iter().any(|k| s.contains(k));

    // righe multiple con indentazione iniziale (spazi o tab)
    let indented_lines = s
        .lines()
        .filter(|l| l.starts_with("    ") || l.starts_with('\t'))
        .count();

    has_keyword || symbol_hits >= 2 || indented_lines >= 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url() {
        assert_eq!(categorize("https://example.com/path?q=1").tag, "Link");
        assert_eq!(categorize("  http://a.b  ").content_type, "url");
        // url in mezzo a testo non è un Link "puro"
        assert_ne!(categorize("vai su https://x.com adesso").tag, "Link");
    }

    #[test]
    fn email() {
        assert_eq!(categorize("mario.rossi@example.it").tag, "Email");
        assert_ne!(categorize("non una email @ niente").tag, "Email");
    }

    #[test]
    fn numbers() {
        assert_eq!(categorize("4111 1111 1111 1111").tag, "Numeri"); // carta
        assert_eq!(categorize("IT60X0542811101000000123456").tag, "Numeri"); // IBAN
        assert_eq!(categorize("42").tag, "Numeri");
    }

    #[test]
    fn code() {
        assert_eq!(categorize("fn main() { println!(\"hi\"); }").tag, "Codice");
        assert_eq!(categorize("import os\ndef f():\n    return 1").tag, "Codice");
    }

    #[test]
    fn long_and_default() {
        let long = "lorem ipsum ".repeat(60); // > 500 char, niente simboli codice
        assert_eq!(categorize(&long).tag, "Testo lungo");
        assert_eq!(categorize("ciao come stai").tag, "Testo");
    }
}
