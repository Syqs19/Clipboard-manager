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

/// Valore-colore CSS che occupa l'intero contenuto: hex (#rgb/#rgba/#rrggbb/
/// #rrggbbaa) oppure funzione rgb()/rgba()/hsl()/hsla(). Case-insensitive.
static COLOR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|hsl)a?\([^)]*\))$",
    )
    .unwrap()
});

/// IBAN: 2 lettere + 2 cifre + 10-30 alfanumerici (spazi rimossi prima).
static IBAN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$").unwrap());

/// Codice fiscale italiano: 6 lettere, 2 cifre, 1 lettera, 2 cifre, 1 lettera,
/// 3 cifre, 1 lettera di controllo (16 caratteri). Case-insensitive.
static CF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$").unwrap()
});

/// Social Security Number USA nel formato canonico 123-45-6789.
static SSN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{3}-\d{2}-\d{4}$").unwrap());

/// JWT: header.payload.firma, l'header base64url inizia con "eyJ" ({" ...).
static JWT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$").unwrap()
});

/// Indirizzo Ethereum: 0x + 40 esadecimali.
static ETH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^0x[a-fA-F0-9]{40}$").unwrap());

/// Indirizzo Bitcoin: bech32 (bc1...) oppure legacy base58 (1.../3...).
static BTC_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(bc1[a-z0-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$").unwrap()
});

/// Valori canonici del campo `sensitive_kind`. Stabili: usati nel DB e nello store.
pub const SK_EMAIL: &str = "email";
pub const SK_IBAN: &str = "iban";
pub const SK_CARD: &str = "card";
pub const SK_TOKEN: &str = "token";
pub const SK_CF: &str = "codice_fiscale";
pub const SK_SSN: &str = "ssn";
pub const SK_KEY: &str = "private_key";
pub const SK_JWT: &str = "jwt";
pub const SK_CRYPTO: &str = "crypto";
pub const SK_MASK: &str = "mask";

/// Tutte le categorie sensibili, in un'unica lista derivata dalle costanti qui
/// sopra: è la fonte di verità che `settings`/`lib`/i comandi riusano per
/// validare e inizializzare il set selezionato dall'utente (niente lista
/// duplicata da tenere allineata a mano).
pub const ALL_SENSITIVE_KINDS: &[&str] = &[
    SK_EMAIL, SK_IBAN, SK_CARD, SK_TOKEN, SK_CF, SK_SSN, SK_KEY, SK_JWT,
    SK_CRYPTO, SK_MASK,
];

/// Caratteri-maschera tipici (un campo password copiato per sbaglio mostra questi).
const MASK_CHARS: &[char] = &['*', '•', '●', '·', '∙', '◦', '‣', '▪'];

/// Risultato della categorizzazione.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Category {
    /// `Text` oppure `Url` (le immagini/file non passano da qui).
    pub content_type: crate::db::ContentType,
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
    let sensitive_kind = if content_type != crate::db::ContentType::Url {
        detect_sensitive_kind(trimmed)
    } else {
        None
    };
    Category {
        content_type,
        tag,
        sensitive: sensitive_kind.is_some(),
        sensitive_kind,
    }
}

/// Determina (content_type, tag). Ordine dal più specifico al generico, così un
/// IBAN non diventa "Codice" e uno snippet lungo resta "Codice" non "Testo lungo".
fn classify(trimmed: &str, original: &str) -> (crate::db::ContentType, &'static str) {
    use crate::db::ContentType;
    if URL_RE.is_match(trimmed) {
        return (ContentType::Url, "Link");
    }
    if EMAIL_RE.is_match(trimmed) {
        return (ContentType::Text, "Email");
    }
    if COLOR_RE.is_match(trimmed) {
        return (ContentType::Text, "Color");
    }
    if is_numeric_like(trimmed) {
        return (ContentType::Text, "Numbers");
    }
    if looks_like_code(trimmed) {
        return (ContentType::Text, "Code");
    }
    if original.chars().count() > LONG_TEXT_THRESHOLD {
        return (ContentType::Text, "Long text");
    }
    (ContentType::Text, "Text")
}

/// Restituisce il sottotipo del sensibile, se presente. Ordine dal più specifico
/// al più generico: i pattern strutturati (chiave, JWT, crypto, CF, SSN) vanno
/// PRIMA del catch-all `token`, che altrimenti li assorbirebbe.
fn detect_sensitive_kind(trimmed: &str) -> Option<&'static str> {
    if EMAIL_RE.is_match(trimmed) {
        return Some(SK_EMAIL);
    }
    if is_mask_only(trimmed) {
        return Some(SK_MASK);
    }
    if is_private_key(trimmed) {
        return Some(SK_KEY);
    }
    if JWT_RE.is_match(trimmed) {
        return Some(SK_JWT);
    }
    let compact: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if IBAN_RE.is_match(&compact) {
        return Some(SK_IBAN);
    }
    if CF_RE.is_match(trimmed) {
        return Some(SK_CF);
    }
    if SSN_RE.is_match(trimmed) {
        return Some(SK_SSN);
    }
    if ETH_RE.is_match(trimmed) || BTC_RE.is_match(trimmed) {
        return Some(SK_CRYPTO);
    }
    if is_card_number(&compact) {
        return Some(SK_CARD);
    }
    if is_long_token(trimmed) {
        return Some(SK_TOKEN);
    }
    None
}

/// Blocco di chiave privata (PEM/OpenSSH): contiene un header BEGIN e "PRIVATE KEY".
/// Cattura RSA/EC/OPENSSH/PKCS8. Le chiavi pubbliche (ssh-rsa AAAA…) non sono qui:
/// non sono segrete.
fn is_private_key(s: &str) -> bool {
    s.contains("-----BEGIN") && s.contains("PRIVATE KEY")
}

/// Stringa fatta solo di caratteri-maschera (≥4, ignorando gli spazi): è il
/// display di un campo password copiato per sbaglio, non un segreto reale.
fn is_mask_only(s: &str) -> bool {
    let chars: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
    chars.len() >= 4 && chars.iter().all(|c| MASK_CHARS.contains(c))
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
        assert_eq!(categorize("  http://a.b  ").content_type, crate::db::ContentType::Url);
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
        assert_eq!(categorize("4111 1111 1111 1111").tag, "Numbers");
        assert!(categorize("4111 1111 1111 1111").sensitive); // card
        assert!(categorize("IT60X0542811101000000123456").sensitive); // IBAN
        assert_eq!(categorize("42").tag, "Numbers");
        assert!(!categorize("42").sensitive); // short number: not sensitive
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
        assert_eq!(categorize("fn main() { println!(\"hi\"); }").tag, "Code");
        assert_eq!(categorize("import os\ndef f():\n    return 1").tag, "Code");
    }

    #[test]
    fn color_values_get_color_tag() {
        // hex e funzioni colore puri → "Color", non "Code"/"Numbers"
        assert_eq!(categorize("#3b82f6").tag, "Color");
        assert_eq!(categorize("#abc").tag, "Color");
        assert_eq!(categorize("#3b82f680").tag, "Color");
        assert_eq!(categorize("rgb(59, 130, 246)").tag, "Color");
        assert_eq!(categorize("rgba(239, 68, 68, 0.5)").tag, "Color");
        assert_eq!(categorize("hsl(217, 91%, 60%)").tag, "Color");
        // case-insensitive
        assert_eq!(categorize("#FFF").tag, "Color");
        // testo con un colore dentro NON è solo un colore → non "Color"
        assert_ne!(categorize("color: #3b82f6;").tag, "Color");
        // un colore non è mai sensibile
        assert!(!categorize("#3b82f6").sensitive);
    }

    #[test]
    fn long_and_default() {
        let long = "lorem ipsum ".repeat(60);
        assert_eq!(categorize(&long).tag, "Long text");
        assert!(!categorize(&long).sensitive); // long text with spaces: not sensitive
        assert_eq!(categorize("ciao come stai").tag, "Text");
    }

    #[test]
    fn sensitive_kind_is_set_per_type() {
        assert_eq!(categorize("a@b.it").sensitive_kind, Some(SK_EMAIL));
        assert_eq!(
            categorize("IT60X0542811101000000123456").sensitive_kind,
            Some(SK_IBAN)
        );
        assert_eq!(
            categorize("4111 1111 1111 1111").sensitive_kind,
            Some(SK_CARD)
        );
        assert_eq!(
            categorize("sk_live_4eC39HqLyjWDarjtT1zdp7dc").sensitive_kind,
            Some(SK_TOKEN)
        );
        assert_eq!(categorize("ciao mondo").sensitive_kind, None);
        assert_eq!(categorize("https://example.com").sensitive_kind, None);
    }

    #[test]
    fn sensitive_kind_takes_priority_order() {
        // IBAN ha priorità su token (entrambi potrebbero matchare strutture lunghe)
        let iban = "IT60X0542811101000000123456";
        assert_eq!(categorize(iban).sensitive_kind, Some(SK_IBAN));
        // email ha priorità sugli altri
        assert_eq!(
            categorize("test123@example.com").sensitive_kind,
            Some(SK_EMAIL)
        );
    }

    #[test]
    fn iban_with_spaces() {
        // gli IBAN scritti dai siti bancari hanno spazi ogni 4 caratteri
        let with_spaces = "IT60 X054 2811 1010 0000 0012 3456";
        let c = categorize(with_spaces);
        assert_eq!(c.sensitive_kind, Some(SK_IBAN));
        assert!(c.sensitive);
    }

    #[test]
    fn card_with_dashes() {
        let dashed = "4111-1111-1111-1111";
        assert_eq!(categorize(dashed).sensitive_kind, Some(SK_CARD));
    }

    #[test]
    fn card_too_long_is_not_card() {
        // 20 cifre non è una carta valida → non sensibile come card
        let s = "12345678901234567890";
        assert_ne!(categorize(s).sensitive_kind, Some(SK_CARD));
    }

    #[test]
    fn email_with_plus_alias() {
        let c = categorize("user+inbox@example.com");
        assert_eq!(c.tag, "Email");
        assert_eq!(c.sensitive_kind, Some(SK_EMAIL));
    }

    #[test]
    fn token_with_underscore_dash() {
        // chiavi tipo "ghp_xxx" o "sk-ant-..." sono token comuni
        let c = categorize("ghp_aBcD1234EFgh5678IjKlMnOp");
        assert_eq!(c.sensitive_kind, Some(SK_TOKEN));
    }

    #[test]
    fn token_too_short_is_not_sensitive() {
        // 15 char con cifre/lettere ma sotto soglia min (20)
        assert!(!categorize("abc123xyz789def").sensitive);
    }

    #[test]
    fn url_with_port_and_query() {
        let c = categorize("https://example.com:8443/path?q=1&x=2");
        assert_eq!(c.content_type, crate::db::ContentType::Url);
        assert!(!c.sensitive);
    }

    #[test]
    fn codice_fiscale_is_sensitive() {
        let c = categorize("RSSMRA80A01H501U");
        assert_eq!(c.sensitive_kind, Some(SK_CF));
        assert!(c.sensitive);
        // minuscolo accettato
        assert_eq!(categorize("rssmra80a01h501u").sensitive_kind, Some(SK_CF));
        // 15 caratteri non è un CF
        assert_ne!(categorize("RSSMRA80A01H501").sensitive_kind, Some(SK_CF));
    }

    #[test]
    fn ssn_us_is_sensitive() {
        assert_eq!(categorize("123-45-6789").sensitive_kind, Some(SK_SSN));
        // senza trattini non è riconosciuto come SSN
        assert_ne!(categorize("123456789").sensitive_kind, Some(SK_SSN));
    }

    #[test]
    fn jwt_is_sensitive_and_not_token() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let c = categorize(jwt);
        assert_eq!(c.sensitive_kind, Some(SK_JWT)); // JWT prima di token
        assert!(c.sensitive);
    }

    #[test]
    fn private_key_block_is_sensitive() {
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";
        let c = categorize(pem);
        assert_eq!(c.sensitive_kind, Some(SK_KEY));
        assert!(c.sensitive);
        // una chiave pubblica non è segreta
        assert_ne!(
            categorize("ssh-rsa AAAAB3NzaC1yc2E user@host").sensitive_kind,
            Some(SK_KEY)
        );
    }

    #[test]
    fn mask_only_string_is_sensitive() {
        assert_eq!(categorize("********").sensitive_kind, Some(SK_MASK));
        assert_eq!(categorize("••••••••").sensitive_kind, Some(SK_MASK));
        assert!(categorize("●●●●●●").sensitive);
        // troppo corta (<4) o testo misto non è "mask"
        assert_ne!(categorize("***").sensitive_kind, Some(SK_MASK));
        assert_ne!(categorize("ab**cd").sensitive_kind, Some(SK_MASK));
    }

    #[test]
    fn crypto_addresses_are_sensitive_and_not_token() {
        // ETH: 0x + 40 hex
        let eth = "0x52908400098527886E0F7030069857D2E4169EE7";
        assert_eq!(categorize(eth).sensitive_kind, Some(SK_CRYPTO));
        // BTC bech32
        assert_eq!(
            categorize("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq").sensitive_kind,
            Some(SK_CRYPTO)
        );
        // BTC legacy
        assert_eq!(
            categorize("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa").sensitive_kind,
            Some(SK_CRYPTO)
        );
    }
}
