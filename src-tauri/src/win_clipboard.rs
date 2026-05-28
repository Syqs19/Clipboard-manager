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
