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
