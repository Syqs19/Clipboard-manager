//! Salvataggio/lettura delle immagini della clipboard come PNG.
//! arboard fornisce/accetta byte RGBA8; qui convertiamo da/verso PNG su disco.

use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::path::Path;

/// Salva byte RGBA8 come PNG.
pub fn save_rgba_png(path: &Path, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    Ok(())
}

/// Genera (o sovrascrive) una thumbnail RGBA a `max_side` pixel sul lato lungo,
/// mantenendo l'aspect ratio. Salva come PNG in `dst`.
pub fn save_thumbnail(src: &Path, dst: &Path, max_side: u32) -> Result<(), String> {
    let (w, h, rgba) = load_png_rgba(src)?;
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
    save_rgba_png(dst, dw, dh, &small)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
        let path = tmp("roundtrip.png");
        let rgba = solid_rgba(4, 3, [10, 20, 30, 255]);
        save_rgba_png(&path, 4, 3, &rgba).unwrap();
        let (w, h, out) = load_png_rgba(&path).unwrap();
        assert_eq!((w, h), (4, 3));
        assert_eq!(out, rgba);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn thumbnail_keeps_aspect_ratio_and_max_side() {
        let src = tmp("thumb-src.png");
        let dst = tmp("thumb-dst.png");
        // 400x200 → max_side 100 → 100x50
        save_rgba_png(&src, 400, 200, &solid_rgba(400, 200, [50, 60, 70, 255])).unwrap();
        save_thumbnail(&src, &dst, 100).unwrap();
        let (w, h, _) = load_png_rgba(&dst).unwrap();
        assert_eq!(w, 100);
        assert_eq!(h, 50);
        std::fs::remove_file(&src).ok();
        std::fs::remove_file(&dst).ok();
    }

    #[test]
    fn thumbnail_smaller_than_max_keeps_size() {
        let src = tmp("thumb-small-src.png");
        let dst = tmp("thumb-small-dst.png");
        save_rgba_png(&src, 50, 30, &solid_rgba(50, 30, [200, 200, 200, 255])).unwrap();
        save_thumbnail(&src, &dst, 100).unwrap();
        let (w, h, _) = load_png_rgba(&dst).unwrap();
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
}

/// Legge un PNG e ritorna (width, height, rgba8). Converte a RGBA se serve.
pub fn load_png_rgba(path: &Path) -> Result<(u32, u32, Vec<u8>), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut reader = png::Decoder::new(BufReader::new(file))
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
