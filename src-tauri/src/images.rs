//! Salvataggio/lettura delle immagini della clipboard come PNG.
//!
//! I file su disco sono **cifrati con AES-256-GCM** (vedi [`crate::crypto`]):
//! il formato a riposo è `MAGIC || NONCE || CIPHERTEXT(PNG)+TAG`. I path nel DB
//! restano `<hash>.png` / `<hash>.thumb.png`, ma il contenuto è opaco se aperto
//! con un visualizzatore PNG.

use std::io::{BufReader, BufWriter, Cursor};
use std::path::Path;

use crate::crypto::{
    decrypt_bytes, encrypt_bytes, is_encrypted_blob, MasterKey,
};

/// Codifica RGBA8 → byte PNG in memoria (nessun I/O).
pub fn encode_rgba_to_png_bytes(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out: Vec<u8> = Vec::new();
    {
        let mut encoder = png::Encoder::new(BufWriter::new(&mut out), width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Decodifica byte PNG → (width, height, rgba8). Converte a RGBA se serve.
fn decode_png_bytes(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut reader = png::Decoder::new(BufReader::new(Cursor::new(bytes)))
        .read_info()
        .map_err(|e| e.to_string())?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| "dimensioni immagine non valide".to_string())?;
    let mut buf = vec![0; size];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let data = &buf[..info.buffer_size()];
    let px = (info.width as usize) * (info.height as usize);

    let rgba = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => {
            let mut out = Vec::with_capacity(px * 4);
            for c in data.chunks_exact(3) {
                out.extend_from_slice(&[c[0], c[1], c[2], 255]);
            }
            out
        }
        png::ColorType::Grayscale => {
            let mut out = Vec::with_capacity(px * 4);
            for &g in data {
                out.extend_from_slice(&[g, g, g, 255]);
            }
            out
        }
        png::ColorType::GrayscaleAlpha => {
            let mut out = Vec::with_capacity(px * 4);
            for c in data.chunks_exact(2) {
                out.extend_from_slice(&[c[0], c[0], c[0], c[1]]);
            }
            out
        }
        png::ColorType::Indexed => return Err("PNG indicizzato non supportato".into()),
    };
    Ok((info.width, info.height, rgba))
}

/// Salva byte RGBA8 come PNG **cifrato** (AES-GCM con `key`).
pub fn save_rgba_png(
    path: &Path,
    width: u32,
    height: u32,
    rgba: &[u8],
    key: &MasterKey,
) -> Result<(), String> {
    let png_bytes = encode_rgba_to_png_bytes(width, height, rgba)?;
    save_png_bytes(path, &png_bytes, key)
}

/// Cifra e scrive su disco byte PNG già codificati. Utile quando il PNG è
/// stato codificato a monte (es. per misurarne il peso prima di decidere se
/// salvarlo) ed evita una doppia codifica.
pub fn save_png_bytes(path: &Path, png_bytes: &[u8], key: &MasterKey) -> Result<(), String> {
    let blob = encrypt_bytes(key, png_bytes)?;
    std::fs::write(path, blob).map_err(|e| e.to_string())
}

/// Legge un PNG **cifrato** dal disco e ritorna (w, h, rgba8).
pub fn load_png_rgba(path: &Path, key: &MasterKey) -> Result<(u32, u32, Vec<u8>), String> {
    let png_bytes = load_png_bytes(path, key)?;
    decode_png_bytes(&png_bytes)
}

/// Legge un PNG **cifrato** dal disco e restituisce i byte PNG decifrati
/// (utile per servirli al frontend via comando Tauri).
pub fn load_png_bytes(path: &Path, key: &MasterKey) -> Result<Vec<u8>, String> {
    let blob = std::fs::read(path).map_err(|e| e.to_string())?;
    decrypt_bytes(key, &blob)
}

/// Genera una thumbnail RGBA a `max_side` pixel sul lato lungo (mantenendo
/// l'aspect ratio), salvata come PNG cifrato in `dst`.
pub fn save_thumbnail(
    src: &Path,
    dst: &Path,
    max_side: u32,
    key: &MasterKey,
) -> Result<(), String> {
    let (w, h, rgba) = load_png_rgba(src, key)?;
    if w == 0 || h == 0 {
        return Err("immagine vuota".into());
    }
    let scale = (max_side as f32 / w.max(h) as f32).min(1.0);
    let dw = ((w as f32 * scale).round() as u32).max(1);
    let dh = ((h as f32 * scale).round() as u32).max(1);
    let small = if dw == w && dh == h {
        rgba
    } else {
        resize_rgba_bilinear(&rgba, w, h, dw, dh)
    };
    save_rgba_png(dst, dw, dh, &small, key)
}

/// Resize bilineare RGBA8. Qualità sufficiente per le miniature in lista.
fn resize_rgba_bilinear(src: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
    let mut out = vec![0u8; (dw * dh * 4) as usize];
    let x_ratio = (sw - 1) as f32 / dw as f32;
    let y_ratio = (sh - 1) as f32 / dh as f32;
    for y in 0..dh {
        let fy = y as f32 * y_ratio;
        let y0 = fy.floor() as u32;
        let y1 = (y0 + 1).min(sh - 1);
        let wy = fy - y0 as f32;
        for x in 0..dw {
            let fx = x as f32 * x_ratio;
            let x0 = fx.floor() as u32;
            let x1 = (x0 + 1).min(sw - 1);
            let wx = fx - x0 as f32;
            let i00 = ((y0 * sw + x0) * 4) as usize;
            let i01 = ((y0 * sw + x1) * 4) as usize;
            let i10 = ((y1 * sw + x0) * 4) as usize;
            let i11 = ((y1 * sw + x1) * 4) as usize;
            let dst = ((y * dw + x) * 4) as usize;
            for ch in 0..4 {
                let v = (src[i00 + ch] as f32) * (1.0 - wx) * (1.0 - wy)
                    + (src[i01 + ch] as f32) * wx * (1.0 - wy)
                    + (src[i10 + ch] as f32) * (1.0 - wx) * wy
                    + (src[i11 + ch] as f32) * wx * wy;
                out[dst + ch] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Convenzione: dato il path di un'immagine `<hash>.png`, ritorna il path
/// della thumbnail `<hash>.thumb.png`.
pub fn thumb_path_for(image_path: &Path) -> std::path::PathBuf {
    let parent = image_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = image_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    parent.join(format!("{stem}.thumb.png"))
}

/// Migrazione una-tantum: se `path` contiene un PNG in chiaro (no magic header),
/// lo legge e lo riscrive cifrato. Idempotente: se è già cifrato non tocca nulla.
pub fn encrypt_in_place_if_needed(path: &Path, key: &MasterKey) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if is_encrypted_blob(&bytes) {
        return Ok(());
    }
    // riconosci che sia un PNG plausibile prima di toccarlo
    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err("file non riconosciuto come PNG".into());
    }
    let blob = encrypt_bytes(key, &bytes)?;
    std::fs::write(path, blob).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::MasterKey;
    use std::path::PathBuf;

    fn dummy_key() -> MasterKey {
        MasterKey::from_bytes([7u8; 32])
    }

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("clipmgr-test-{name}"))
    }

    fn solid_rgba(w: u32, h: u32, color: [u8; 4]) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..(w * h) {
            v.extend_from_slice(&color);
        }
        v
    }

    #[test]
    fn save_and_load_png_roundtrip() {
        let key = dummy_key();
        let path = tmp("roundtrip.png");
        let rgba = solid_rgba(4, 3, [10, 20, 30, 255]);
        save_rgba_png(&path, 4, 3, &rgba, &key).unwrap();
        let (w, h, out) = load_png_rgba(&path, &key).unwrap();
        assert_eq!((w, h), (4, 3));
        assert_eq!(out, rgba);
        // verifica che su disco sia davvero cifrato (no header PNG visibile)
        let raw = std::fs::read(&path).unwrap();
        assert!(crate::crypto::is_encrypted_blob(&raw));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn thumbnail_keeps_aspect_ratio_and_max_side() {
        let key = dummy_key();
        let src = tmp("thumb-src.png");
        let dst = tmp("thumb-dst.png");
        save_rgba_png(&src, 400, 200, &solid_rgba(400, 200, [50, 60, 70, 255]), &key).unwrap();
        save_thumbnail(&src, &dst, 100, &key).unwrap();
        let (w, h, _) = load_png_rgba(&dst, &key).unwrap();
        assert_eq!(w, 100);
        assert_eq!(h, 50);
        std::fs::remove_file(&src).ok();
        std::fs::remove_file(&dst).ok();
    }

    #[test]
    fn thumbnail_smaller_than_max_keeps_size() {
        let key = dummy_key();
        let src = tmp("thumb-small-src.png");
        let dst = tmp("thumb-small-dst.png");
        save_rgba_png(&src, 50, 30, &solid_rgba(50, 30, [200, 200, 200, 255]), &key).unwrap();
        save_thumbnail(&src, &dst, 100, &key).unwrap();
        let (w, h, _) = load_png_rgba(&dst, &key).unwrap();
        assert_eq!((w, h), (50, 30));
        std::fs::remove_file(&src).ok();
        std::fs::remove_file(&dst).ok();
    }

    #[test]
    fn thumb_path_for_replaces_extension() {
        let p = Path::new("X:/data/images/abcdef.png");
        let t = thumb_path_for(p);
        assert_eq!(
            t.file_name().unwrap().to_string_lossy(),
            "abcdef.thumb.png"
        );
    }

    #[test]
    fn migration_encrypts_in_place_then_idempotent() {
        let key = dummy_key();
        let path = tmp("migrate.png");
        // scrivi un PNG in chiaro (formato pre-cifratura)
        let png_bytes = encode_rgba_to_png_bytes(2, 2, &solid_rgba(2, 2, [1, 2, 3, 255])).unwrap();
        std::fs::write(&path, &png_bytes).unwrap();
        assert!(!crate::crypto::is_encrypted_blob(&std::fs::read(&path).unwrap()));

        encrypt_in_place_if_needed(&path, &key).unwrap();
        let blob = std::fs::read(&path).unwrap();
        assert!(crate::crypto::is_encrypted_blob(&blob));

        // seconda chiamata: nessun cambio (idempotente)
        encrypt_in_place_if_needed(&path, &key).unwrap();
        let blob2 = std::fs::read(&path).unwrap();
        assert_eq!(blob, blob2);

        // e si rilegge correttamente
        let (w, h, rgba) = load_png_rgba(&path, &key).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(rgba, solid_rgba(2, 2, [1, 2, 3, 255]));
        std::fs::remove_file(&path).ok();
    }
}
