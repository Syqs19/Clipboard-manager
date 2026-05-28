//! Rispetta i formati clipboard di esclusione usati dai password manager.
//!
//! Quando un'app (KeePass, 1Password, Bitwarden, ecc.) copia dati che non vanno
//! storicizzati, mette nella clipboard uno di questi formati:
//! - `ExcludeClipboardContentFromMonitorProcessing` (Windows clipboard history)
//! - `CanIncludeInClipboardHistory` (semantica analoga; presenza = escludi)
//!
//! Se è presente uno dei due, il watcher salta la cattura.

#[cfg(windows)]
pub fn should_skip() -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EnumClipboardFormats, OpenClipboard, RegisterClipboardFormatW,
    };

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe {
        let cf_exclude = RegisterClipboardFormatW(
            wide("ExcludeClipboardContentFromMonitorProcessing").as_ptr(),
        );
        let cf_can_history =
            RegisterClipboardFormatW(wide("CanIncludeInClipboardHistory").as_ptr());
        if cf_exclude == 0 && cf_can_history == 0 {
            return false;
        }
        // se la clipboard è bloccata da un'altra app, meglio non saltare la cattura
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        let mut fmt: u32 = 0;
        let mut found = false;
        loop {
            fmt = EnumClipboardFormats(fmt);
            if fmt == 0 {
                break;
            }
            if (cf_exclude != 0 && fmt == cf_exclude)
                || (cf_can_history != 0 && fmt == cf_can_history)
            {
                found = true;
                break;
            }
        }
        CloseClipboard();
        found
    }
}

#[cfg(not(windows))]
pub fn should_skip() -> bool {
    false
}

/// Costante CF_HDROP (formato clipboard per liste di file).
#[cfg(windows)]
const CF_HDROP: u32 = 15;

/// Legge i path file presenti nella clipboard in formato CF_HDROP (drag di file
/// da Esplora risorse). Ritorna lista vuota se non ci sono file.
#[cfg(windows)]
pub fn read_file_drop() -> Vec<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return vec![];
        }
        let h = GetClipboardData(CF_HDROP);
        if h.is_null() {
            CloseClipboard();
            return vec![];
        }
        let hdrop = h as windows_sys::Win32::UI::Shell::HDROP;
        let count = DragQueryFileW(hdrop, 0xFFFFFFFF, std::ptr::null_mut(), 0);
        let mut paths = Vec::with_capacity(count as usize);
        for i in 0..count {
            let len = DragQueryFileW(hdrop, i, std::ptr::null_mut(), 0) as usize;
            if len == 0 {
                continue;
            }
            let mut buf = vec![0u16; len + 1];
            let written = DragQueryFileW(hdrop, i, buf.as_mut_ptr(), (len + 1) as u32);
            buf.truncate(written as usize);
            let s = OsString::from_wide(&buf).to_string_lossy().to_string();
            if !s.is_empty() {
                paths.push(s);
            }
        }
        CloseClipboard();
        paths
    }
}

#[cfg(not(windows))]
pub fn read_file_drop() -> Vec<String> {
    Vec::new()
}

/// Mette la clipboard in modalità CF_HDROP con la lista di path indicata
/// (così quando l'utente fa Incolla su Esplora risorse arrivano i file).
#[cfg(windows)]
pub fn write_file_drop(paths: &[String]) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    if paths.is_empty() {
        return false;
    }

    // costruisce il buffer wide-char: path\0path\0...\0\0
    let mut wide: Vec<u16> = Vec::new();
    for p in paths {
        wide.extend(OsStr::new(p).encode_wide());
        wide.push(0);
    }
    wide.push(0); // doppio null terminatore finale

    // DROPFILES header (20 byte) + dati wide
    let header_size: usize = 20;
    let total = header_size + wide.len() * std::mem::size_of::<u16>();

    unsafe {
        let h = GlobalAlloc(GMEM_MOVEABLE, total);
        if h.is_null() {
            return false;
        }
        let ptr = GlobalLock(h) as *mut u8;
        if ptr.is_null() {
            // HGLOBAL non liberato in caso di errore: leak raro/trascurabile
            return false;
        }

        // pFiles = 20 (offset dei dati), pt {0,0}, fNC = 0, fWide = 1 (TRUE)
        let mut header = [0u8; 20];
        header[0..4].copy_from_slice(&20u32.to_le_bytes()); // pFiles
        header[16..20].copy_from_slice(&1u32.to_le_bytes()); // fWide = TRUE
        std::ptr::copy_nonoverlapping(header.as_ptr(), ptr, header_size);

        // dati wide subito dopo l'header
        let dst = ptr.add(header_size) as *mut u16;
        std::ptr::copy_nonoverlapping(wide.as_ptr(), dst, wide.len());

        GlobalUnlock(h);

        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        EmptyClipboard();
        let set = SetClipboardData(CF_HDROP, h as windows_sys::Win32::Foundation::HANDLE);
        CloseClipboard();
        // su successo l'HGLOBAL diventa proprietà del sistema
        !set.is_null()
    }
}

#[cfg(not(windows))]
pub fn write_file_drop(_paths: &[String]) -> bool {
    false
}

/// Legge il frammento HTML dalla clipboard (formato "HTML Format" di Windows),
/// estraendolo tra StartFragment/EndFragment. None se non c'è HTML.
#[cfg(windows)]
pub fn read_html() -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let cf_html = RegisterClipboardFormatW(wide("HTML Format").as_ptr());
        if cf_html == 0 {
            return None;
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let h = GetClipboardData(cf_html);
        if h.is_null() {
            CloseClipboard();
            return None;
        }
        let ptr = GlobalLock(h) as *const u8;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }
        let size = GlobalSize(h);
        let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
        GlobalUnlock(h);
        CloseClipboard();

        // CF_HTML è UTF-8 con un header tipo:
        // Version:0.9\r\nStartHTML:...\r\nEndHTML:...\r\nStartFragment:NNNNN\r\nEndFragment:NNNNN\r\n<html>...
        let s = String::from_utf8_lossy(&bytes);
        let start = parse_offset(&s, "StartFragment:")?;
        let end = parse_offset(&s, "EndFragment:")?;
        if start >= end || end > bytes.len() {
            return None;
        }
        let frag = String::from_utf8_lossy(&bytes[start..end]).trim().to_string();
        if frag.is_empty() {
            None
        } else {
            Some(frag)
        }
    }
}

#[cfg(windows)]
fn parse_offset(s: &str, key: &str) -> Option<usize> {
    let i = s.find(key)? + key.len();
    let rest = &s[i..];
    let end = rest.find(|c: char| !c.is_ascii_digit())?;
    rest[..end].parse::<usize>().ok()
}

#[cfg(not(windows))]
pub fn read_html() -> Option<String> {
    None
}

/// Scrive contemporaneamente CF_UNICODETEXT (plain) e CF_HTML (formattato) nella
/// clipboard. Ritorna true se entrambi i formati sono stati impostati.
#[cfg(windows)]
pub fn write_text_with_html(plain: &str, html: &str) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    // costruisce l'header CF_HTML con offset corretti
    let cf_html_bytes = build_cf_html_payload(html);

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        EmptyClipboard();

        // CF_UNICODETEXT (1 = CF_TEXT, 13 = CF_UNICODETEXT)
        const CF_UNICODETEXT: u32 = 13;
        let wide_text = wide(plain);
        let txt_bytes = wide_text.len() * 2;
        let h_txt = GlobalAlloc(GMEM_MOVEABLE, txt_bytes);
        let mut ok_txt = false;
        if !h_txt.is_null() {
            let p = GlobalLock(h_txt) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(wide_text.as_ptr(), p, wide_text.len());
                GlobalUnlock(h_txt);
                ok_txt = !SetClipboardData(
                    CF_UNICODETEXT,
                    h_txt as windows_sys::Win32::Foundation::HANDLE,
                )
                .is_null();
            }
        }

        // CF_HTML (registrato dinamicamente)
        let mut ok_html = false;
        let cf_html_name = wide("HTML Format");
        let cf_html = RegisterClipboardFormatW(cf_html_name.as_ptr());
        if cf_html != 0 {
            // alloca con un byte extra per il null terminator finale (richiesto da CF_HTML)
            let h = GlobalAlloc(GMEM_MOVEABLE, cf_html_bytes.len() + 1);
            if !h.is_null() {
                let p = GlobalLock(h) as *mut u8;
                if !p.is_null() {
                    std::ptr::copy_nonoverlapping(
                        cf_html_bytes.as_ptr(),
                        p,
                        cf_html_bytes.len(),
                    );
                    *p.add(cf_html_bytes.len()) = 0; // null terminator
                    GlobalUnlock(h);
                    ok_html = !SetClipboardData(
                        cf_html,
                        h as windows_sys::Win32::Foundation::HANDLE,
                    )
                    .is_null();
                }
            }
        }

        CloseClipboard();
        ok_txt && ok_html
    }
}

#[cfg(windows)]
fn build_cf_html_payload(fragment: &str) -> Vec<u8> {
    // costruisce l'header con placeholder lunghezza fissa (8 cifre zero-padded),
    // poi calcola gli offset reali e li sostituisce in-place.
    let prefix =
        "Version:0.9\r\nStartHTML:00000000\r\nEndHTML:00000000\r\nStartFragment:00000000\r\nEndFragment:00000000\r\n";
    let html_open = "<html><body>\r\n<!--StartFragment-->";
    let html_close = "<!--EndFragment-->\r\n</body></html>";

    let mut s = String::with_capacity(
        prefix.len() + html_open.len() + fragment.len() + html_close.len(),
    );
    s.push_str(prefix);
    let start_html = s.len();
    s.push_str(html_open);
    let start_fragment = s.len();
    s.push_str(fragment);
    let end_fragment = s.len();
    s.push_str(html_close);
    let end_html = s.len();

    // sostituisce i placeholder (8 cifre) — gli offset stanno tutti sotto 10^8
    let replace = |buf: &mut String, key: &str, value: usize| {
        let needle = format!("{key}00000000");
        let replacement = format!("{key}{:08}", value);
        if let Some(at) = buf.find(&needle) {
            buf.replace_range(at..at + needle.len(), &replacement);
        }
    };
    replace(&mut s, "StartHTML:", start_html);
    replace(&mut s, "EndHTML:", end_html);
    replace(&mut s, "StartFragment:", start_fragment);
    replace(&mut s, "EndFragment:", end_fragment);
    s.into_bytes()
}

#[cfg(not(windows))]
pub fn write_text_with_html(_plain: &str, _html: &str) -> bool {
    false
}

/// Legge l'eventuale frammento RTF dalla clipboard (formato "Rich Text Format").
/// RTF è UTF-8 / ANSI a 7 bit, restituiamo la stringa così com'è.
#[cfg(windows)]
pub fn read_rtf() -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    unsafe {
        let cf_rtf = RegisterClipboardFormatW(wide("Rich Text Format").as_ptr());
        if cf_rtf == 0 {
            return None;
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let h = GetClipboardData(cf_rtf);
        if h.is_null() {
            CloseClipboard();
            return None;
        }
        let ptr = GlobalLock(h) as *const u8;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }
        let size = GlobalSize(h);
        // RTF è ASCII/UTF-8, tronca su eventuale null terminator
        let len = std::slice::from_raw_parts(ptr, size)
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(size);
        let bytes = std::slice::from_raw_parts(ptr, len).to_vec();
        GlobalUnlock(h);
        CloseClipboard();
        let s = String::from_utf8_lossy(&bytes).to_string();
        if s.trim().is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

#[cfg(not(windows))]
pub fn read_rtf() -> Option<String> {
    None
}

/// Scrive contemporaneamente CF_UNICODETEXT, CF_HTML e CF_RTF nella clipboard.
/// Passa `None` per saltare il formato relativo. Ritorna true se almeno il testo
/// plain è stato scritto.
#[cfg(windows)]
pub fn write_rich_clipboard(plain: &str, html: Option<&str>, rtf: Option<&str>) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return false;
        }
        EmptyClipboard();

        // CF_UNICODETEXT
        const CF_UNICODETEXT: u32 = 13;
        let wide_text = wide(plain);
        let mut ok_txt = false;
        let h_txt = GlobalAlloc(GMEM_MOVEABLE, wide_text.len() * 2);
        if !h_txt.is_null() {
            let p = GlobalLock(h_txt) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(wide_text.as_ptr(), p, wide_text.len());
                GlobalUnlock(h_txt);
                ok_txt = !SetClipboardData(
                    CF_UNICODETEXT,
                    h_txt as windows_sys::Win32::Foundation::HANDLE,
                )
                .is_null();
            }
        }

        // CF_HTML (opzionale)
        if let Some(html_str) = html {
            let payload = build_cf_html_payload(html_str);
            let cf_html_name = wide("HTML Format");
            let cf_html = RegisterClipboardFormatW(cf_html_name.as_ptr());
            if cf_html != 0 {
                let h = GlobalAlloc(GMEM_MOVEABLE, payload.len() + 1);
                if !h.is_null() {
                    let p = GlobalLock(h) as *mut u8;
                    if !p.is_null() {
                        std::ptr::copy_nonoverlapping(payload.as_ptr(), p, payload.len());
                        *p.add(payload.len()) = 0;
                        GlobalUnlock(h);
                        let _ = SetClipboardData(
                            cf_html,
                            h as windows_sys::Win32::Foundation::HANDLE,
                        );
                    }
                }
            }
        }

        // CF_RTF (opzionale) — registrato come "Rich Text Format"
        if let Some(rtf_str) = rtf {
            let bytes = rtf_str.as_bytes();
            let cf_rtf_name = wide("Rich Text Format");
            let cf_rtf = RegisterClipboardFormatW(cf_rtf_name.as_ptr());
            if cf_rtf != 0 {
                let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len() + 1);
                if !h.is_null() {
                    let p = GlobalLock(h) as *mut u8;
                    if !p.is_null() {
                        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
                        *p.add(bytes.len()) = 0;
                        GlobalUnlock(h);
                        let _ = SetClipboardData(
                            cf_rtf,
                            h as windows_sys::Win32::Foundation::HANDLE,
                        );
                    }
                }
            }
        }

        CloseClipboard();
        ok_txt
    }
}

#[cfg(not(windows))]
pub fn write_rich_clipboard(_plain: &str, _html: Option<&str>, _rtf: Option<&str>) -> bool {
    false
}
