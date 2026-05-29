//! Cifratura a riposo.
//!
//! - **Chiave master**: 32 byte casuali generati al primo avvio. Custoditi su
//!   disco in `key.bin` cifrati via Windows DPAPI (CryptProtectData) con scope
//!   utente: solo l'utente Windows corrente sulla stessa macchina può decifrare.
//! - **DB SQLite**: cifrato con SQLCipher passando la chiave raw via
//!   `PRAGMA key = "x'<hex>'"` (salta il KDF, la chiave è già random a 32 byte).
//! - **PNG immagini**: cifrati con AES-256-GCM, formato file
//!   `MAGIC(6) || NONCE(12) || CIPHERTEXT+TAG`. Nonce per file generato a caso.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;
use std::path::Path;

/// Magic prefix dei file PNG cifrati (`CMENC1` = ClipManager ENCrypted v1).
pub const ENC_MAGIC: &[u8; 6] = b"CMENC1";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Chiave master a 32 byte usata sia per SQLCipher sia per AES-GCM dei PNG.
#[derive(Clone)]
pub struct MasterKey([u8; KEY_LEN]);

impl MasterKey {
    /// Costruttore esplicito (usato dai test e da future migrazioni).
    #[allow(dead_code)]
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    /// Rappresentazione esadecimale (64 caratteri) per `PRAGMA key = "x'...'"`.
    pub fn to_hex(&self) -> String {
        let mut s = String::with_capacity(KEY_LEN * 2);
        for b in &self.0 {
            s.push_str(&format!("{:02x}", b));
        }
        s
    }
}

/// Carica la chiave master da `key_path`. Se il file non esiste, ne genera
/// una nuova (32 byte da OsRng), la cifra via DPAPI e la persiste.
pub fn load_or_create_master_key(key_path: &Path) -> Result<MasterKey, String> {
    if key_path.exists() {
        let blob = std::fs::read(key_path).map_err(|e| format!("lettura key.bin: {e}"))?;
        let raw = dpapi_unprotect(&blob)?;
        if raw.len() != KEY_LEN {
            return Err(format!(
                "chiave master corrotta (attesi {KEY_LEN} byte, trovati {})",
                raw.len()
            ));
        }
        let mut k = [0u8; KEY_LEN];
        k.copy_from_slice(&raw);
        Ok(MasterKey(k))
    } else {
        let mut k = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut k);
        let blob = dpapi_protect(&k)?;
        if let Some(parent) = key_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(key_path, &blob).map_err(|e| format!("scrittura key.bin: {e}"))?;
        Ok(MasterKey(k))
    }
}

/// Vero se il blob inizia col magic `CMENC1` (== file PNG già cifrato).
pub fn is_encrypted_blob(bytes: &[u8]) -> bool {
    bytes.len() >= ENC_MAGIC.len() && &bytes[..ENC_MAGIC.len()] == ENC_MAGIC
}

/// Cifra `plaintext` con AES-256-GCM. Output: `MAGIC || NONCE || CIPHERTEXT+TAG`.
pub fn encrypt_bytes(key: &MasterKey, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("AES-GCM encrypt: {e}"))?;
    let mut out = Vec::with_capacity(ENC_MAGIC.len() + NONCE_LEN + ct.len());
    out.extend_from_slice(ENC_MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decifra un blob prodotto da [`encrypt_bytes`].
pub fn decrypt_bytes(key: &MasterKey, blob: &[u8]) -> Result<Vec<u8>, String> {
    if !is_encrypted_blob(blob) {
        return Err("blob non cifrato (magic assente)".into());
    }
    if blob.len() < ENC_MAGIC.len() + NONCE_LEN {
        return Err("blob cifrato troppo corto".into());
    }
    let nonce_bytes = &blob[ENC_MAGIC.len()..ENC_MAGIC.len() + NONCE_LEN];
    let ct = &blob[ENC_MAGIC.len() + NONCE_LEN..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|e| format!("AES-GCM decrypt: {e}"))
}

// ---------- Windows DPAPI ----------

#[cfg(windows)]
fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB};
    use windows_sys::Win32::Foundation::LocalFree;

    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("CryptProtectData fallita".into());
    }
    let slice =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let out = slice.to_vec();
    unsafe { LocalFree(output.pbData as _) };
    Ok(out)
}

#[cfg(windows)]
fn dpapi_unprotect(blob: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};
    use windows_sys::Win32::Foundation::LocalFree;

    let input = CRYPT_INTEGER_BLOB {
        cbData: blob.len() as u32,
        pbData: blob.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("CryptUnprotectData fallita (chiave incompatibile con utente/macchina?)".into());
    }
    let slice =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let out = slice.to_vec();
    unsafe { LocalFree(output.pbData as _) };
    Ok(out)
}

#[cfg(not(windows))]
fn dpapi_protect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI è disponibile solo su Windows".into())
}

#[cfg(not(windows))]
fn dpapi_unprotect(_blob: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI è disponibile solo su Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_key() -> MasterKey {
        let mut k = [0u8; KEY_LEN];
        for (i, b) in k.iter_mut().enumerate() {
            *b = i as u8;
        }
        MasterKey::from_bytes(k)
    }

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let key = dummy_key();
        let plaintext = b"hello clipboard manager".to_vec();
        let blob = encrypt_bytes(&key, &plaintext).unwrap();
        assert!(is_encrypted_blob(&blob));
        let out = decrypt_bytes(&key, &blob).unwrap();
        assert_eq!(out, plaintext);
    }

    #[test]
    fn decrypt_rejects_non_encrypted() {
        let key = dummy_key();
        let err = decrypt_bytes(&key, b"not encrypted").unwrap_err();
        assert!(err.contains("magic"));
    }

    #[test]
    fn wrong_key_fails() {
        let key1 = dummy_key();
        let mut k2 = [0u8; KEY_LEN];
        k2[0] = 0xff;
        let key2 = MasterKey::from_bytes(k2);
        let blob = encrypt_bytes(&key1, b"secret").unwrap();
        assert!(decrypt_bytes(&key2, &blob).is_err());
    }

    #[test]
    fn to_hex_is_64_chars() {
        let key = dummy_key();
        let hex = key.to_hex();
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
