//! Image Converter: converte un'immagine tra i formati supportati, con qualità
//! (per i formati con perdita) e resize opzionale. Tutto in locale via il crate
//! `image` — nessuna rete, coerente con la privacy dell'app.
//!
//! Due percorsi d'uso (decisi lato UI):
//! - **singolo file**: il frontend passa i byte, riceve i byte convertiti
//!   (`convert_image_bytes`) — drag&drop immediato con anteprima;
//! - **batch**: il frontend passa i path e una cartella di output; Rust legge,
//!   converte e scrive ogni file (`convert_images_batch`) — efficiente con molti
//!   file grossi, senza farli passare per il confine JS↔Rust.
//!
//! Il nucleo `convert_bytes` è puro (niente I/O) così è testabile.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::{codecs, DynamicImage, ImageEncoder, ImageFormat as ImgFmt};
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Formato di output supportato. Fonte unica (type-the-type): la stringa che
/// arriva dal frontend viene convertita qui in variante; un valore sconosciuto è
/// un errore esplicito, non un comportamento indefinito.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetFormat {
    Png,
    Jpeg,
    WebP,
    Bmp,
    Tiff,
    Ico,
    Avif,
}

impl TargetFormat {
    fn from_str(s: &str) -> AppResult<Self> {
        Ok(match s.to_ascii_lowercase().as_str() {
            "png" => Self::Png,
            "jpeg" | "jpg" => Self::Jpeg,
            "webp" => Self::WebP,
            "bmp" => Self::Bmp,
            "tiff" | "tif" => Self::Tiff,
            "ico" => Self::Ico,
            "avif" => Self::Avif,
            other => return Err(AppError::msg(format!("Unsupported target format: {other}"))),
        })
    }

    /// Estensione del file per il formato (per costruire il nome di output).
    fn ext(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::WebP => "webp",
            Self::Bmp => "bmp",
            Self::Tiff => "tiff",
            Self::Ico => "ico",
            Self::Avif => "avif",
        }
    }
}

/// Ridimensiona `img` perché il lato più lungo non superi `max_dim`, mantenendo
/// le proporzioni. `None` o un valore ≥ del lato attuale → nessun ridimensionamento.
fn maybe_resize(img: DynamicImage, max_dim: Option<u32>) -> DynamicImage {
    match max_dim {
        Some(max) if max > 0 && (img.width() > max || img.height() > max) => {
            // `resize` mantiene l'aspect ratio entro il box max×max (Lanczos3 = buona qualità).
            img.resize(max, max, image::imageops::FilterType::Lanczos3)
        }
        _ => img,
    }
}

/// Converte i byte di un'immagine nel formato target, con qualità (1–100, solo
/// per i formati con perdita) e resize opzionale. Funzione pura: nessun I/O.
pub fn convert_bytes(
    input: &[u8],
    target: TargetFormat,
    quality: u8,
    max_dim: Option<u32>,
) -> AppResult<Vec<u8>> {
    // decodifica rilevando il formato dal contenuto (no estensione)
    let img = image::load_from_memory(input)?;
    let img = maybe_resize(img, max_dim);
    let q = quality.clamp(1, 100);

    let mut out: Vec<u8> = Vec::new();
    match target {
        // formati con perdita / encoder con qualità
        TargetFormat::Jpeg => {
            // JPEG non ha canale alpha → appiattisci su RGB
            let rgb = img.to_rgb8();
            let enc = codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q);
            enc.write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )?;
        }
        TargetFormat::Avif => {
            let rgba = img.to_rgba8();
            // speed 1–10 (10 = più veloce/peggiore); qualità 1–100.
            let enc = codecs::avif::AvifEncoder::new_with_speed_quality(&mut out, 6, q);
            enc.write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                image::ExtendedColorType::Rgba8,
            )?;
        }
        // WebP qui è lossless (l'encoder del crate `image` non espone la qualità
        // lossy in modo stabile); il file resta comunque più compatto del PNG.
        TargetFormat::WebP => {
            img.write_to(&mut Cursor::new(&mut out), ImgFmt::WebP)?;
        }
        // formati lossless: la qualità non si applica
        TargetFormat::Png => img.write_to(&mut Cursor::new(&mut out), ImgFmt::Png)?,
        TargetFormat::Bmp => img.write_to(&mut Cursor::new(&mut out), ImgFmt::Bmp)?,
        TargetFormat::Tiff => img.write_to(&mut Cursor::new(&mut out), ImgFmt::Tiff)?,
        TargetFormat::Ico => img.write_to(&mut Cursor::new(&mut out), ImgFmt::Ico)?,
    }
    Ok(out)
}

/// Conversione di un singolo file: il frontend passa i byte dell'immagine (li ha
/// già dal drag&drop / file input) e il path di destinazione scelto col dialog
/// nativo. Rust converte e scrive il file, ritornando la dimensione scritta (per
/// il feedback "prima → dopo"). Scrivere lato Rust evita di aggiungere il plugin
/// filesystem solo per salvare.
#[tauri::command]
pub fn convert_image_bytes_to_path(
    bytes: Vec<u8>,
    dest: String,
    format: String,
    quality: u8,
    max_dim: Option<u32>,
) -> AppResult<u64> {
    let target = TargetFormat::from_str(&format)?;
    let out = convert_bytes(&bytes, target, quality, max_dim)?;
    std::fs::write(&dest, &out)?;
    Ok(out.len() as u64)
}

/// Esito della conversione di un singolo file nel batch (per il report alla UI).
#[derive(Serialize)]
pub struct BatchItem {
    /// path di origine (per identificare la riga nella UI)
    pub source: String,
    /// path scritto se ok, altrimenti null
    pub output: Option<String>,
    /// messaggio d'errore se la conversione di QUESTO file è fallita
    pub error: Option<String>,
}

/// Conversione batch: legge ogni `path`, converte e scrive in `out_dir` con lo
/// stesso nome base + la nuova estensione. Un fallimento su un file NON ferma gli
/// altri (best-effort): l'esito per riga torna nel report.
#[tauri::command]
pub fn convert_images_batch(
    paths: Vec<String>,
    out_dir: String,
    format: String,
    quality: u8,
    max_dim: Option<u32>,
) -> AppResult<Vec<BatchItem>> {
    let target = TargetFormat::from_str(&format)?;
    let out_dir = PathBuf::from(out_dir);
    if !out_dir.is_dir() {
        return Err(AppError::msg("Output folder does not exist"));
    }

    let mut report = Vec::with_capacity(paths.len());
    for src in paths {
        let item = convert_one_file(Path::new(&src), &out_dir, target, quality, max_dim);
        report.push(match item {
            Ok(output) => BatchItem {
                source: src,
                output: Some(output),
                error: None,
            },
            Err(e) => BatchItem {
                source: src,
                output: None,
                error: Some(e.to_string()),
            },
        });
    }
    Ok(report)
}

/// Converte un file e lo scrive in `out_dir`; ritorna il path scritto.
fn convert_one_file(
    src: &Path,
    out_dir: &Path,
    target: TargetFormat,
    quality: u8,
    max_dim: Option<u32>,
) -> AppResult<String> {
    let bytes = std::fs::read(src)?;
    let converted = convert_bytes(&bytes, target, quality, max_dim)?;
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "image".to_string());
    let dest = out_dir.join(format!("{stem}.{}", target.ext()));
    std::fs::write(&dest, converted)?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PNG 2×2 RGBA minimale, codificato in memoria, da usare come input dei test.
    fn sample_png() -> Vec<u8> {
        let img = DynamicImage::new_rgba8(2, 2);
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), ImgFmt::Png).unwrap();
        out
    }

    #[test]
    fn converts_png_to_jpeg_and_back_decodes() {
        let png = sample_png();
        let jpg = convert_bytes(&png, TargetFormat::Jpeg, 80, None).unwrap();
        // il risultato dev'essere un JPEG valido e decodificabile
        let fmt = image::guess_format(&jpg).unwrap();
        assert_eq!(fmt, ImgFmt::Jpeg);
        assert!(image::load_from_memory(&jpg).is_ok());
    }

    #[test]
    fn converts_to_webp_and_bmp() {
        let png = sample_png();
        for (target, expected) in [
            (TargetFormat::WebP, ImgFmt::WebP),
            (TargetFormat::Bmp, ImgFmt::Bmp),
        ] {
            let out = convert_bytes(&png, target, 90, None).unwrap();
            assert_eq!(image::guess_format(&out).unwrap(), expected);
        }
    }

    #[test]
    fn resize_caps_the_longest_side() {
        // 10×4 → max_dim 5 → il lato lungo (10) scende a 5, l'altro in proporzione
        let img = DynamicImage::new_rgba8(10, 4);
        let mut png = Vec::new();
        img.write_to(&mut Cursor::new(&mut png), ImgFmt::Png).unwrap();
        let out = convert_bytes(&png, TargetFormat::Png, 100, Some(5)).unwrap();
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!(decoded.width(), 5);
        assert_eq!(decoded.height(), 2);
    }

    #[test]
    fn no_resize_when_under_limit() {
        let png = sample_png(); // 2×2
        let out = convert_bytes(&png, TargetFormat::Png, 100, Some(100)).unwrap();
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (2, 2));
    }

    #[test]
    fn unknown_format_is_rejected() {
        assert!(TargetFormat::from_str("xyz").is_err());
        assert!(TargetFormat::from_str("jpg").is_ok()); // alias di jpeg
    }

    #[test]
    fn invalid_input_bytes_error() {
        let res = convert_bytes(b"not an image", TargetFormat::Png, 90, None);
        assert!(res.is_err());
    }
}
