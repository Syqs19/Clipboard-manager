//! Vectorial: vettorializza (tracing) un'immagine raster in SVG, in locale via
//! `vtracer`. A differenza dell'Image Converter (raster↔raster, conversione vera),
//! questa è una RICOSTRUZIONE: funziona bene su loghi/icone/grafica piatta, male
//! sulle foto. La UI lo segnala.
//!
//! Nota sulle dipendenze: `vtracer` usa al suo interno una vecchia versione del
//! crate `image` (0.23), isolata da Cargo dalla nostra 0.25. Per evitare ogni
//! conflitto di tipi NON le passiamo un'immagine tipata: decodifichiamo l'input
//! con il NOSTRO `image` in RGBA grezzo e riempiamo il `ColorImage` di vtracer
//! con quei byte. Il confine fra i due mondi sono semplici `u8`.

use std::path::Path;

use vtracer::{ColorImage, ColorMode, Config};

use crate::error::{AppResult};

/// Modalità di tracing scelta dall'utente.
fn color_mode(binary: bool) -> ColorMode {
    if binary {
        ColorMode::Binary
    } else {
        ColorMode::Color
    }
}

/// Vettorializza i byte di un'immagine raster in una stringa SVG (funzione pura).
/// `binary` = bianco/nero (Binary) invece che a colori; `filter_speckle` =
/// soglia in pixel sotto cui le macchioline vengono ignorate (riduce il rumore).
pub fn vectorize_bytes(input: &[u8], binary: bool, filter_speckle: usize) -> AppResult<String> {
    // decodifica con il nostro `image` 0.25 → RGBA grezzo
    let img = image::load_from_memory(input)?.to_rgba8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    let color = ColorImage {
        pixels: img.into_raw(),
        width: w,
        height: h,
    };

    let config = Config {
        color_mode: color_mode(binary),
        filter_speckle,
        ..Config::default()
    };

    // vtracer ritorna Err(String) → AppError::Msg via From<String>
    let svg = vtracer::convert(color, config)?;
    Ok(svg.to_string())
}

/// Vettorializza un'immagine (byte dal frontend) e scrive l'SVG nel path scelto.
/// Ritorna la dimensione (byte) del file scritto. Come per l'Image Converter, la
/// scrittura la fa il backend per non aggiungere un plugin filesystem.
#[tauri::command]
pub fn vectorize_image_to_path(
    bytes: Vec<u8>,
    dest: String,
    binary: bool,
    filter_speckle: usize,
) -> AppResult<u64> {
    let svg = vectorize_bytes(&bytes, binary, filter_speckle)?;
    std::fs::write(Path::new(&dest), svg.as_bytes())?;
    Ok(svg.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Piccolo PNG sintetico: metà nera, metà bianca (qualcosa da tracciare).
    fn sample_png() -> Vec<u8> {
        let mut img = image::RgbaImage::new(8, 8);
        for (x, _y, px) in img.enumerate_pixels_mut() {
            *px = if x < 4 {
                image::Rgba([0, 0, 0, 255])
            } else {
                image::Rgba([255, 255, 255, 255])
            };
        }
        let mut out = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn vectorizes_to_svg_string() {
        let png = sample_png();
        let svg = vectorize_bytes(&png, false, 4).unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn binary_mode_also_produces_svg() {
        let png = sample_png();
        let svg = vectorize_bytes(&png, true, 4).unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn invalid_input_errors() {
        assert!(vectorize_bytes(b"not an image", false, 4).is_err());
    }
}
