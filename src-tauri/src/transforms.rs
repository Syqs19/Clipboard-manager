//! Trasformazioni testuali "al volo" per la feature "Paste as".
//! Funzioni pure (facili da testare): non toccano DB né clipboard.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
// `md5` e `sha2` riesportano lo stesso trait `digest::Digest`: ne basta uno
// per chiamare `::digest()` su entrambi i tipi.
use sha2::{Digest, Sha256};
use md5::Md5;

/// Applica la trasformazione identificata da `kind` al testo.
/// Ritorna `None` se la trasformazione non è applicabile (es. JSON non valido,
/// Base64 non decodificabile), così il comando segnala l'errore senza scrivere
/// nulla negli appunti.
pub fn apply(kind: &str, text: &str) -> Option<String> {
    match kind {
        "uppercase" => Some(text.to_uppercase()),
        "lowercase" => Some(text.to_lowercase()),
        "capitalize" => Some(capitalize(text)),
        "title" => Some(title_case(text)),
        "trim" => Some(text.trim().to_string()),
        "slugify" => Some(slugify(text)),
        "remove_breaks" => Some(remove_breaks(text)),
        "json" => pretty_json(text),
        "json_minify" => minify_json(text),
        "base64_encode" => Some(B64.encode(text.as_bytes())),
        "base64_decode" => base64_decode(text),
        "url_encode" => Some(url_encode(text)),
        "url_decode" => url_decode(text),
        "md5" => Some(hex(Md5::digest(text.as_bytes()).as_slice())),
        "sha256" => Some(hex(Sha256::digest(text.as_bytes()).as_slice())),
        "stats" => Some(stats(text)),
        _ => None,
    }
}

/// Prima lettera maiuscola, resto invariato.
fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Iniziale maiuscola per ogni parola (separatori = whitespace).
fn title_case(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut at_word_start = true;
    for ch in text.chars() {
        if ch.is_whitespace() {
            out.push(ch);
            at_word_start = true;
        } else if at_word_start {
            out.extend(ch.to_uppercase());
            at_word_start = false;
        } else {
            out.extend(ch.to_lowercase());
        }
    }
    out
}

/// `Hello World!` → `hello-world`. Minuscolo, sequenze non alfanumeriche
/// collassate in un singolo trattino, niente trattini ai bordi.
fn slugify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_dash = false;
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            for low in ch.to_lowercase() {
                out.push(low);
            }
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    if out.ends_with('-') {
        out.pop();
    }
    out
}

/// Unisce le righe in una sola: ogni interruzione di riga diventa spazio e gli
/// spazi multipli risultanti vengono collassati. Utile per testo da PDF.
fn remove_breaks(text: &str) -> String {
    let spaced: String = text
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    spaced.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Riformatta come JSON indentato. `None` se non è JSON valido.
fn pretty_json(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    serde_json::to_string_pretty(&value).ok()
}

/// Compatta il JSON su una riga. `None` se non è JSON valido.
fn minify_json(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    serde_json::to_string(&value).ok()
}

/// Decodifica una stringa Base64 in testo UTF-8. `None` se non è Base64 valido
/// o se i byte non sono UTF-8.
fn base64_decode(text: &str) -> Option<String> {
    let bytes = B64.decode(text.trim()).ok()?;
    String::from_utf8(bytes).ok()
}

/// Percent-encoding: lascia inalterati i caratteri "unreserved" (RFC 3986),
/// codifica tutto il resto come %XX sui byte UTF-8.
fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for &b in text.as_bytes() {
        let unreserved = b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'_' | b'.' | b'~');
        if unreserved {
            out.push(b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{:02X}", b));
        }
    }
    out
}

/// Inverso di `url_encode`. `None` se le sequenze %XX non sono valide o se il
/// risultato non è UTF-8.
fn url_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hi = bytes.get(i + 1)?;
                let lo = bytes.get(i + 2)?;
                let hex = |c: &u8| (*c as char).to_digit(16);
                let byte = (hex(hi)? * 16 + hex(lo)?) as u8;
                out.push(byte);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Byte → stringa esadecimale minuscola.
fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Conteggio leggibile: caratteri, parole, righe. È informazione (non un valore
/// da incollare): il frontend la mostra in un toast.
fn stats(text: &str) -> String {
    let chars = text.chars().count();
    let words = text.split_whitespace().count();
    let lines = if text.is_empty() {
        0
    } else {
        text.lines().count()
    };
    format!("{chars} characters · {words} words · {lines} lines")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_transforms() {
        assert_eq!(apply("uppercase", "aBc").as_deref(), Some("ABC"));
        assert_eq!(apply("lowercase", "aBc").as_deref(), Some("abc"));
    }

    #[test]
    fn capitalize_first_only() {
        assert_eq!(apply("capitalize", "hello world").as_deref(), Some("Hello world"));
        assert_eq!(apply("capitalize", "").as_deref(), Some(""));
    }

    #[test]
    fn title_case_each_word() {
        assert_eq!(
            apply("title", "hello BRAVE world").as_deref(),
            Some("Hello Brave World"),
        );
    }

    #[test]
    fn trim_strips_edges_only() {
        assert_eq!(apply("trim", "  a b  ").as_deref(), Some("a b"));
    }

    #[test]
    fn slugify_basic() {
        assert_eq!(apply("slugify", "Hello World!").as_deref(), Some("hello-world"));
    }

    #[test]
    fn slugify_collapses_and_trims_separators() {
        assert_eq!(
            apply("slugify", "  Foo___Bar -- Baz  ").as_deref(),
            Some("foo-bar-baz"),
        );
    }

    #[test]
    fn remove_breaks_joins_lines() {
        assert_eq!(
            apply("remove_breaks", "line one\nline   two\r\nthree").as_deref(),
            Some("line one line two three"),
        );
    }

    #[test]
    fn json_pretty_prints_valid() {
        let out = apply("json", r#"{"b":1,"a":[2,3]}"#).unwrap();
        assert!(out.contains('\n'));
        assert!(out.contains("  \"b\": 1"));
    }

    #[test]
    fn json_minify_compacts() {
        assert_eq!(
            apply("json_minify", "{\n  \"a\": 1\n}").as_deref(),
            Some(r#"{"a":1}"#),
        );
    }

    #[test]
    fn json_rejects_invalid() {
        assert_eq!(apply("json", "not json"), None);
        assert_eq!(apply("json_minify", "not json"), None);
    }

    #[test]
    fn base64_round_trip() {
        let enc = apply("base64_encode", "Ciao €").unwrap();
        assert_eq!(apply("base64_decode", &enc).as_deref(), Some("Ciao €"));
    }

    #[test]
    fn base64_decode_rejects_invalid() {
        assert_eq!(apply("base64_decode", "!!!notbase64"), None);
    }

    #[test]
    fn url_round_trip() {
        let enc = apply("url_encode", "a b&c=é").unwrap();
        assert_eq!(enc, "a%20b%26c%3D%C3%A9");
        assert_eq!(apply("url_decode", &enc).as_deref(), Some("a b&c=é"));
    }

    #[test]
    fn url_decode_rejects_truncated() {
        assert_eq!(apply("url_decode", "%2"), None);
    }

    #[test]
    fn hashes_known_vectors() {
        // vettori noti per la stringa vuota
        assert_eq!(
            apply("md5", "").as_deref(),
            Some("d41d8cd98f00b204e9800998ecf8427e"),
        );
        assert_eq!(
            apply("sha256", "").as_deref(),
            Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        );
        // vettori noti per "abc"
        assert_eq!(
            apply("md5", "abc").as_deref(),
            Some("900150983cd24fb0d6963f7d28e17f72"),
        );
        assert_eq!(
            apply("sha256", "abc").as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
        );
    }

    #[test]
    fn stats_counts() {
        assert_eq!(
            apply("stats", "one two\nthree").as_deref(),
            Some("13 characters · 3 words · 2 lines"),
        );
        assert_eq!(apply("stats", "").as_deref(), Some("0 characters · 0 words · 0 lines"));
    }

    #[test]
    fn unknown_kind_is_none() {
        assert_eq!(apply("nope", "x"), None);
    }
}
