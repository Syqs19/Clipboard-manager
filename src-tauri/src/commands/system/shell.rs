//! Azioni della shell di Windows: rivela un file in Esplora risorse, apre un
//! file con l'app predefinita.

use crate::error::{AppError, AppResult};

/// Apre la cartella contenente il file indicato in Esplora risorse, selezionando
/// il file (`explorer.exe /select,"path"`).
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> AppResult<()> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::msg("Path does not exist"));
    }
    // `explorer.exe /select,"path"` richiede che il path SIA quotato letteralmente,
    // ma std::process::Command::arg quoterebbe l'intero "/select,..." rompendo il
    // parsing di explorer. Usiamo raw_arg (Windows-only) per controllare la stringa.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Esplora risorse preferisce path assoluti con backslash
        let abs = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
        // strippa il prefisso UNC '\\?\' se presente
        let s = abs.to_string_lossy();
        let clean = s.strip_prefix(r"\\?\").unwrap_or(&s);
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", clean))
            .spawn()?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("explorer.exe")
            .arg(format!("/select,{}", path))
            .spawn()?;
    }
    Ok(())
}

/// Apre un file con l'applicazione predefinita di Windows (azione "open" della shell).
#[tauri::command]
pub fn open_path(path: String) -> AppResult<()> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::msg("Path does not exist"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let file: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let op: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
        // ShellExecuteW ritorna un valore > 32 in caso di successo
        let res = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1, // SW_SHOWNORMAL
            )
        };
        if (res as isize) <= 32 {
            return Err(AppError::msg("Failed to open the file"));
        }
    }
    Ok(())
}
