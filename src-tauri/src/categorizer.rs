//! Auto-categorizzazione del contenuto della clipboard.
//!
//! Data una stringa di testo, decide il `content_type` ("text" o "url"), un
//! tag suggerito ("Link", "Email", "Numeri", "Codice", "Testo lungo", "Testo")
//! e un flag `sensitive` per i dati da mascherare nella UI (IBAN, carte, email,
//! token/chiavi). Le immagini non passano da qui: il watcher le marca come "image".
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

/// IBAN: 2 lettere + 2 cifre + 10-30 alfanumerici (spazi rimossi prima).
static IBAN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$").unwrap());

/// Valori canonici del campo `sensitive_kind`. Stabili: usati nel DB e nello store.
pub const SK_EMAIL: &str = "email";
pub const SK_IBAN: &str = "iban";
pub const SK_CARD: &str = "card";
pub const SK_TOKEN: &str = "token";

/// Risultato della categorizzazione.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Category {
    /// "text" oppure "url".
    pub content_type: &'static str,
    /// Tag suggerito, mostrato all'utente (modificabile).
    pub tag: &'static str,
    /// Se true, la UI maschera il contenuto (ma resta copiabile/rivelabile).
    pub sensitive: bool,
    /// Sottotipo del sensibile ("email" | "iban" | "card" | "token"), se `sensitive`.
    pub sensitive_kind: Option<&'static str>,
}

/// Classifica un contenuto testuale.
pub fn categorize(content: &str) -> Category {
    // alcune app/strumenti antepongono un BOM (U+FEFF), che non è whitespace:
    // va rimosso o spezza i match ancorati (URL/email/IBAN).
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    let (content_type, tag) = classify(trimmed, content);
    // gli URL non si mascherano; per il resto applica le regole sui dati sensibili
    let sensitive_kind = if content_type != "url" { detect_sensitive_kind(trimmed) } else { None };
    Category {
        content_type,
        tag,
        sensitive: sensitive_kind.is_some(),
        sensitive_kind,
    }
}

/// Determina (content_type, tag). Ordine dal più specifico al generico, così un
/// IBAN non diventa "Codice" e uno snippet lungo resta "Codice" non "Testo lungo".
fn classify(trimmed: &str, original: &str) -> (&'static str, &'static str) {
    if URL_RE.is_match(trimmed) {
        return ("url", "Link");
    }
    if EMAIL_RE.is_match(trimmed) {
        return ("text", "Email");
    }
    if is_numeric_like(trimmed) {
        return ("text", "Numeri");
    }
    if looks_like_code(trimmed) {
        return ("text", "Codice");
    }
    if original.chars().count() > LONG_TEXT_THRESHOLD {
        return ("text", "Testo lungo");
    }
    ("text", "Testo")
}

/// Restituisce il sottotipo del sensibile, se presente.
fn detect_sensitive_kind(trimmed: &str) -> Option<&'static str> {
    if EMAIL_RE.is_match(trimmed) {
        return Some(SK_EMAIL);
    }
    let compact: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if IBAN_RE.is_match(&compact) {
        return Some(SK_IBAN);
    }
    if is_card_number(&compact) {
        return Some(SK_CARD);
    }
    if is_long_token(trimmed) {
        return Some(SK_TOKEN);
    }
    None
}

/// Numeri puri, IBAN o carte: usato per il tag "Numeri" (non implica sensibile).
fn is_numeric_like(s: &str) -> bool {
    let compact: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return false;
    }
    if IBAN_RE.is_match(&compact) {
        return true;
    }
    let digits: String = compact.chars().filter(|c| *c != '-').collect();
    if digits.chars().all(|c| c.is_ascii_digit()) {
        return (1..=19).contains(&digits.len());
    }
    false
}

/// 13-19 cifre, eventuali separatori '-' (numero tipo carta di credito).
fn is_card_number(compact: &str) -> bool {
    if !compact.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return false;
    }
    let digits = compact.chars().filter(|c| c.is_ascii_digit()).count();
    (13..=19).contains(&digits)
}

/// Token/chiave: nessuno spazio, 20-400 char, mix di lettere e cifre
/// (es. API key, JWT, hash). Esclude parole singole e percorsi senza cifre.
fn is_long_token(s: &str) -> bool {
    if s.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let n = s.chars().count();
    if !(20..=400).contains(&n) {
        return false;
    }
    let has_digit = s.chars().any(|c| c.is_ascii_digit());
    let has_alpha = s.chars().any(|c| c.is_ascii_alphabetic());
    has_digit && has_alpha
}

/// Euristica "sembra codice": simboli/parole chiave tipiche o indentazione.
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
        assert!(!categorize("https://example.com/very/long/path/12345").sensitive); // url mai mascherato
        assert_ne!(categorize("vai su https://x.com adesso").tag, "Link");
    }

    #[test]
    fn email() {
        let c = categorize("mario.rossi@example.it");
        assert_eq!(c.tag, "Email");
        assert!(c.sensitive);
        assert_ne!(categorize("non una email @ niente").tag, "Email");
    }

    #[test]
    fn numbers_and_sensitivity() {
        assert_eq!(categorize("4111 1111 1111 1111").tag, "Numeri");
        assert!(categorize("4111 1111 1111 1111").sensitive); // carta
        assert!(categorize("IT60X0542811101000000123456").sensitive); // IBAN
        assert_eq!(categorize("42").tag, "Numeri");
        assert!(!categorize("42").sensitive); // numero corto: non sensibile
    }

    #[test]
    fn long_token_is_sensitive() {
        assert!(categorize("sk_live_4eC39HqLyjWDarjtT1zdp7dc").sensitive); // API key
        assert!(!categorize("ciao come stai oggi").sensitive); // testo normale
        assert!(!categorize("parolasingolasenzacifre").sensitive); // niente cifre
    }

    #[test]
    fn bom_is_stripped() {
        // BOM iniziale (clip.exe / certi editor) non deve rompere la categoria
        assert_eq!(categorize("\u{feff}https://example.com\r\n").tag, "Link");
        assert_eq!(categorize("\u{feff}test@example.com").tag, "Email");
        assert!(!categorize("\u{feff}https://example.com").sensitive);
    }

    #[test]
    fn code() {
        assert_eq!(categorize("fn main() { println!(\"hi\"); }").tag, "Codice");
        assert_eq!(categorize("import os\ndef f():\n    return 1").tag, "Codice");
    }

    #[test]
    fn long_and_default() {
        let long = "lorem ipsum ".repeat(60);
        assert_eq!(categorize(&long).tag, "Testo lungo");
        assert!(!categorize(&long).sensitive); // testo lungo con spazi: non sensibile
        assert_eq!(categorize("ciao come stai").tag, "Testo");
    }
}
