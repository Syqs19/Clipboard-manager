//! OCR delle immagini tramite l'engine integrato di Windows (Windows.Media.Ocr).
//!
//! Nessuna dipendenza esterna né dati lingua da bundlare: usa le lingue OCR già
//! installate nel sistema. Tutto offline, coerente con la natura privacy-first.
//! Le chiamate WinRT vanno fatte su un thread con l'apartment COM inizializzato
//! (vedi [`init_thread`]); per questo l'OCR gira sempre su thread dedicati.

/// Inizializza l'apartment COM (MTA) del thread corrente. Idempotente: va
/// chiamata una volta all'inizio di ogni thread che esegue l'OCR.
#[cfg(windows)]
pub fn init_thread() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    // ignora l'esito: S_FALSE = già inizializzato, RPC_E_CHANGED_MODE = altro
    // apartment già attivo sul thread (va comunque bene per le nostre chiamate).
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

#[cfg(not(windows))]
pub fn init_thread() {}

/// Riconosce il testo in un'immagine RGBA (ordine R,G,B,A). Ritorna il testo
/// (può essere vuoto se l'immagine non contiene testo).
#[cfg(windows)]
pub fn ocr_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<String, String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Security::Cryptography::CryptographicBuffer;

    let expected = (width as usize) * (height as usize) * 4;
    if width == 0 || height == 0 || rgba.len() < expected {
        return Err("invalid image data".into());
    }

    // WinRT vuole BGRA8: scambio i canali R e B (l'alfa resta in posizione).
    let mut bgra = rgba[..expected].to_vec();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
    }

    let buffer =
        CryptographicBuffer::CreateFromByteArray(&bgra).map_err(|e| e.to_string())?;
    let bmp = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width as i32,
        height as i32,
    )
    .map_err(|e| e.to_string())?;

    // engine dalle lingue del profilo utente (può essere assente se non c'è
    // alcuna lingua OCR installata → errore propagato, l'OCR viene saltato)
    let engine =
        OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| e.to_string())?;
    let result = engine
        .RecognizeAsync(&bmp)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let text = result.Text().map_err(|e| e.to_string())?.to_string();
    Ok(text)
}

#[cfg(not(windows))]
pub fn ocr_rgba(_width: u32, _height: u32, _rgba: &[u8]) -> Result<String, String> {
    Err("OCR is only available on Windows".into())
}
