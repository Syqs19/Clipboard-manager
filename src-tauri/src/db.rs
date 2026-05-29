//! Livello database (SQLite via rusqlite).
//!
//! Scelte chiave:
//! - modalità **WAL** + scrittura immediata di ogni clip → niente perdite su crash;
//! - dedup **move-to-top**: ricopiare un contenuto già presente non crea un
//!   duplicato ma riporta la clip in cima (aggiorna `created_at`);
//! - SQLite è compilato dentro l'eseguibile (feature `bundled` di rusqlite),
//!   quindi sul PC di destinazione non serve installare nulla.
#![allow(dead_code)] // alcune funzioni verranno collegate ai comandi negli step successivi

use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::crypto::MasterKey;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS clips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    content        TEXT,                       -- NULL per le immagini pure
    content_html   TEXT,                       -- versione formattata HTML (NULL se assente)
    content_rtf    TEXT,                       -- versione RTF (NULL se assente)
    content_type   TEXT NOT NULL,              -- 'text' | 'image' | 'url' | 'files'
    image_path     TEXT,
    preview        TEXT NOT NULL,
    created_at     INTEGER NOT NULL,           -- unix millis
    pinned         INTEGER NOT NULL DEFAULT 0,
    pinned_order   INTEGER,
    char_count     INTEGER NOT NULL DEFAULT 0,
    sensitive      INTEGER NOT NULL DEFAULT 0,  -- 1 = mascherare nella UI (IBAN/carte/email/token)
    sensitive_kind TEXT,                       -- 'email' | 'iban' | 'card' | 'token' (NULL se non sensibile)
    hash           TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS tags (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    color   TEXT,
    is_auto INTEGER NOT NULL DEFAULT 0,
    pinned  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clip_tags (
    clip_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (clip_id, tag_id),
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);
-- elementi di una clip-gruppo (content_type='group'): le clip singole non
-- usano questa tabella, restano atomiche sulla riga clips. CASCADE: cancellando
-- la clip-gruppo si cancellano i suoi elementi.
CREATE TABLE IF NOT EXISTS clip_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id    INTEGER NOT NULL,
    position   INTEGER NOT NULL,            -- ordine dell'elemento nel gruppo
    item_type  TEXT NOT NULL,               -- 'text' | 'image' | 'url' | 'files'
    content    TEXT,                        -- testo, o JSON di path per i files
    image_path TEXT,                        -- PNG cifrato per gli elementi immagine
    label      TEXT,                        -- etichetta utente (es. 'email'), solo testi
    char_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_clip_items_clip ON clip_items(clip_id, position);
CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_pinned  ON clips(pinned, pinned_order);
";

/// Millisecondi unix correnti.
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Hash deterministico (FNV-1a 64-bit) usato per il dedup. Stabile tra avvii.
pub fn bytes_hash(data: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in data {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:016x}", hash)
}

pub fn content_hash(s: &str) -> String {
    bytes_hash(s.as_bytes())
}

/// Vero se `path` punta a un DB SQLite **in chiaro** (header standard
/// `"SQLite format 3\0"`). Per SQLCipher l'header è cifrato → ritorna false.
fn is_plaintext_sqlite(path: &Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut header = [0u8; 16];
    if f.read_exact(&mut header).is_err() {
        return false;
    }
    &header == b"SQLite format 3\0"
}

/// Migra un DB SQLite in chiaro a SQLCipher copiando le tabelle via
/// `sqlcipher_export`. Lascia un backup `<path>.plain.bak`.
fn migrate_plaintext_to_encrypted(path: &Path, key: &MasterKey) -> rusqlite::Result<()> {
    let new_path = path.with_extension("db.new");
    let _ = std::fs::remove_file(&new_path);

    let plain = Connection::open(path)?;
    let escaped_path = new_path.to_string_lossy().replace('\'', "''");
    let sql = format!(
        "ATTACH DATABASE '{escaped_path}' AS encrypted KEY \"x'{hex}'\";
         SELECT sqlcipher_export('encrypted');
         DETACH DATABASE encrypted;",
        hex = key.to_hex()
    );
    plain.execute_batch(&sql)?;
    drop(plain);

    let bak = path.with_extension("plain.bak");
    let _ = std::fs::remove_file(&bak);
    std::fs::rename(path, &bak).map_err(io_to_rusqlite)?;
    std::fs::rename(&new_path, path).map_err(io_to_rusqlite)?;

    // i file -wal/-shm del DB in chiaro non sono più validi
    let wal = path.with_extension("db-wal");
    let shm = path.with_extension("db-shm");
    let _ = std::fs::remove_file(&wal);
    let _ = std::fs::remove_file(&shm);
    Ok(())
}

/// Apre una connessione SQLCipher con la chiave master applicata.
fn open_encrypted_connection(path: &Path, key: &MasterKey) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", key.to_hex()))?;
    // tocca lo schema: se la chiave è sbagliata, fallisce qui
    let _: i64 = conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0))?;
    Ok(conn)
}

fn io_to_rusqlite(e: std::io::Error) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
        Some(e.to_string()),
    )
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Clip {
    pub id: i64,
    pub content: Option<String>,
    pub content_html: Option<String>,
    pub content_rtf: Option<String>,
    pub content_type: String,
    pub image_path: Option<String>,
    pub thumb_path: Option<String>,
    pub preview: String,
    pub created_at: i64,
    pub pinned: bool,
    pub pinned_order: Option<i64>,
    pub char_count: i64,
    pub sensitive: bool,
    pub hash: String,
    pub tags: Vec<String>,
    /// Elementi della clip-gruppo (vuoto per le clip singole).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub items: Vec<ClipItem>,
    /// Testo riconosciuto via OCR per le immagini (NULL altrimenti). Usato solo
    /// per la ricerca, non serve al frontend → non serializzato.
    #[serde(skip_serializing)]
    pub ocr_text: Option<String>,
}

/// Dati per inserire una nuova clip (l'id lo assegna il DB).
#[derive(Debug, Clone)]
pub struct NewClip {
    pub content: Option<String>,
    pub content_html: Option<String>,
    pub content_rtf: Option<String>,
    pub content_type: String,
    pub image_path: Option<String>,
    pub preview: String,
    pub created_at: i64,
    pub char_count: i64,
    pub sensitive: bool,
    pub sensitive_kind: Option<String>,
    pub hash: String,
}

/// Un elemento di una clip-gruppo, restituito al frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ClipItem {
    pub id: i64,
    pub position: i64,
    pub item_type: String,
    pub content: Option<String>,
    pub image_path: Option<String>,
    pub thumb_path: Option<String>,
    pub label: Option<String>,
    pub char_count: i64,
}

/// Dati per inserire un nuovo elemento in una clip-gruppo (l'id lo assegna il DB).
#[derive(Debug, Clone)]
pub struct NewClipItem {
    pub item_type: String,
    pub content: Option<String>,
    pub image_path: Option<String>,
    pub label: Option<String>,
    pub char_count: i64,
}

/// Conteggi aggregati per il pannello statistiche.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct DbStats {
    pub total: i64,
    pub pinned: i64,
    pub images: i64,
    pub sensitive: i64,
    pub tags: i64,
}

pub struct Db {
    conn: Mutex<Connection>,
}

const SELECT_COLS: &str =
    "id, content, content_type, image_path, preview, created_at, pinned, pinned_order, char_count, sensitive, hash, content_html, content_rtf, ocr_text";

impl Db {
    /// Apre il DB cifrato con SQLCipher. Se trova un DB pre-esistente in
    /// chiaro nella stessa path, lo migra in-place al formato cifrato
    /// (backup del vecchio in `<path>.plain.bak`).
    pub fn open<P: AsRef<Path>>(path: P, key: &MasterKey) -> rusqlite::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if path.exists() && is_plaintext_sqlite(&path) {
            migrate_plaintext_to_encrypted(&path, key)?;
        }
        let conn = open_encrypted_connection(&path, key)?;
        Self::init(conn)
    }

    /// DB in-memory (usato solo dai test, non cifrato).
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA)?;
        // migrazione additiva per DB pre-esistenti (colonne aggiunte dopo il rilascio)
        let _ = conn.execute("ALTER TABLE clips ADD COLUMN sensitive_kind TEXT", []);
        let _ = conn.execute("ALTER TABLE clips ADD COLUMN content_html TEXT", []);
        let _ = conn.execute("ALTER TABLE clips ADD COLUMN content_rtf TEXT", []);
        let _ = conn.execute("ALTER TABLE clips ADD COLUMN ocr_text TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE tags ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            [],
        );
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Inserisce una clip; se l'hash esiste già la riporta in cima
    /// (aggiorna `created_at`) invece di duplicarla. Ritorna l'id della clip.
    pub fn insert_or_bump_clip(&self, new: &NewClip) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<i64> = conn
            .query_row("SELECT id FROM clips WHERE hash = ?1", params![new.hash], |r| r.get(0))
            .optional()?;
        if let Some(id) = existing {
            conn.execute(
                "UPDATE clips SET created_at = ?1 WHERE id = ?2",
                params![new.created_at, id],
            )?;
            return Ok(id);
        }
        conn.execute(
            "INSERT INTO clips (content, content_html, content_rtf, content_type, image_path, preview, created_at, char_count, sensitive, sensitive_kind, hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                new.content,
                new.content_html,
                new.content_rtf,
                new.content_type,
                new.image_path,
                new.preview,
                new.created_at,
                new.char_count,
                new.sensitive as i64,
                new.sensitive_kind,
                new.hash
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Clip ordinate: prima i pinned (per ordine manuale), poi per data desc.
    pub fn list_recent(&self, limit: i64) -> rusqlite::Result<Vec<Clip>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "SELECT {SELECT_COLS} FROM clips
             ORDER BY pinned DESC,
                      COALESCE(pinned_order, 9223372036854775807) ASC,
                      created_at DESC
             LIMIT ?1"
        );
        Self::collect(&conn, &sql, params![limit])
    }

    /// Ricerca full-text semplice su contenuto, preview e nomi dei tag.
    pub fn search(&self, query: &str) -> rusqlite::Result<Vec<Clip>> {
        let conn = self.conn.lock().unwrap();
        let like = format!("%{query}%");
        let sql = format!(
            "SELECT {SELECT_COLS} FROM clips
             WHERE content LIKE ?1 OR preview LIKE ?1
                OR id IN (
                    SELECT ct.clip_id FROM clip_tags ct
                    JOIN tags t ON t.id = ct.tag_id
                    WHERE t.name LIKE ?1
                )
             ORDER BY pinned DESC, created_at DESC"
        );
        Self::collect(&conn, &sql, params![like])
    }

    /// Tutti i percorsi immagine referenziati (per ripulire i file orfani).
    pub fn all_image_paths(&self) -> rusqlite::Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        // include anche le immagini che vivono dentro le clip-gruppo (clip_items),
        // altrimenti il cleanup degli orfani le cancellerebbe per errore.
        let mut stmt = conn.prepare(
            "SELECT image_path FROM clips WHERE image_path IS NOT NULL
             UNION
             SELECT image_path FROM clip_items WHERE image_path IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// Path immagine degli ELEMENTI (clip_items) appartenenti alle clip indicate.
    /// Serve a ripulire i PNG dei gruppi quando vengono eliminati (i loro item
    /// non sono in clips.image_path ma in clip_items.image_path).
    pub fn group_item_image_paths(&self, ids: &[i64]) -> rusqlite::Result<Vec<String>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let conn = self.conn.lock().unwrap();
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT image_path FROM clip_items
             WHERE image_path IS NOT NULL AND clip_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(ids.iter()),
            |r| r.get::<_, String>(0),
        )?;
        rows.collect()
    }

    /// Una singola clip con il contenuto completo (per copiare anche i sensibili).
    pub fn get_clip(&self, id: i64) -> rusqlite::Result<Option<Clip>> {
        let conn = self.conn.lock().unwrap();
        let sql = format!("SELECT {SELECT_COLS} FROM clips WHERE id = ?1");
        Ok(Self::collect(&conn, &sql, params![id])?.pop())
    }

    pub fn set_pinned(&self, clip_id: i64, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        if pinned {
            // nuova pinned: in cima ai fissati (pinned_order = min - 1)
            let min: Option<i64> = conn.query_row(
                "SELECT MIN(pinned_order) FROM clips WHERE pinned = 1",
                [],
                |r| r.get::<_, Option<i64>>(0),
            )?;
            let new_order = min.unwrap_or(0).saturating_sub(1);
            conn.execute(
                "UPDATE clips SET pinned = 1, pinned_order = ?1 WHERE id = ?2",
                params![new_order, clip_id],
            )?;
        } else {
            // despinnando, la card torna in cima ai non-pinnati (created_at = ora)
            // così non "si perde" in mezzo alla cronologia per la sua vecchia data.
            conn.execute(
                "UPDATE clips SET pinned = 0, pinned_order = NULL, created_at = ?2 WHERE id = ?1",
                params![clip_id, now_millis()],
            )?;
        }
        Ok(())
    }

    /// Imposta direttamente `pinned` e `pinned_order` (usato dall'import).
    pub fn set_pin_raw(
        &self,
        clip_id: i64,
        pinned: bool,
        pinned_order: Option<i64>,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE clips SET pinned = ?1, pinned_order = ?2 WHERE id = ?3",
            params![pinned as i64, pinned_order, clip_id],
        )?;
        Ok(())
    }

    /// Riassegna `pinned_order` ai fissati nell'ordine dato (0, 1, 2, ...).
    /// Gli id non pinnati vengono ignorati.
    pub fn reorder_pinned(&self, ordered_ids: &[i64]) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        for (i, id) in ordered_ids.iter().enumerate() {
            conn.execute(
                "UPDATE clips SET pinned_order = ?1 WHERE id = ?2 AND pinned = 1",
                params![i as i64, id],
            )?;
        }
        Ok(())
    }

    pub fn delete_clip(&self, clip_id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM clips WHERE id = ?1", params![clip_id])?;
        Ok(())
    }

    /// Restituisce i path delle immagini associate alle clip indicate (per la pulizia
    /// dei file prima della cancellazione).
    pub fn image_paths_for(&self, ids: &[i64]) -> rusqlite::Result<Vec<String>> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT image_path FROM clips WHERE id IN ({placeholders}) AND image_path IS NOT NULL"
        );
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&sql)?;
        let params = rusqlite::params_from_iter(ids.iter());
        let rows = stmt.query_map(params, |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    /// Cancella le clip con gli id indicati. Ritorna quante ne sono state rimosse.
    pub fn delete_clips(&self, ids: &[i64]) -> rusqlite::Result<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM clips WHERE id IN ({placeholders})");
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(&sql, rusqlite::params_from_iter(ids.iter()))?;
        Ok(n)
    }

    /// Tiene solo le `limit` clip non-pinnate più recenti; elimina le altre
    /// non-pinnate. I pinned non vengono mai eliminati. Ritorna quante ne ha tolte.
    pub fn prune_to_limit(&self, limit: i64) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "DELETE FROM clips
             WHERE pinned = 0
               AND id NOT IN (
                   SELECT id FROM clips WHERE pinned = 0
                   ORDER BY created_at DESC LIMIT ?1
               )",
            params![limit],
        )?;
        Ok(n)
    }

    /// Svuota la cronologia mantenendo le clip fissate (i clip_tags vanno via in cascata).
    pub fn clear_unpinned(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM clips WHERE pinned = 0", [])?;
        Ok(())
    }

    /// Cancella la clip non-pinnata con questo hash, se esiste. Ritorna quante (0 o 1).
    pub fn delete_by_hash_if_unpinned(&self, hash: &str) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "DELETE FROM clips WHERE hash = ?1 AND pinned = 0",
            params![hash],
        )?;
        Ok(n)
    }

    /// Cancella le clip non-pinnate più vecchie di `cutoff_ms` il cui `sensitive_kind`
    /// è in `kinds`. Se `kinds` è vuoto non fa nulla. Ritorna quante ne ha rimosse.
    pub fn delete_expired_sensitive_kinds(
        &self,
        cutoff_ms: i64,
        kinds: &[&str],
    ) -> rusqlite::Result<usize> {
        if kinds.is_empty() {
            return Ok(0);
        }
        let placeholders = std::iter::repeat("?").take(kinds.len()).collect::<Vec<_>>().join(",");
        let sql = format!(
            "DELETE FROM clips
             WHERE pinned = 0 AND created_at < ?1 AND sensitive_kind IN ({placeholders})"
        );
        let conn = self.conn.lock().unwrap();
        let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(kinds.len() + 1);
        p.push(&cutoff_ms);
        for k in kinds {
            p.push(k);
        }
        let n = conn.execute(&sql, rusqlite::params_from_iter(p.iter().copied()))?;
        Ok(n)
    }

    /// Riempi `sensitive_kind` per le clip pre-esistenti dove è NULL ma `sensitive=1`,
    /// ricategorizzando il contenuto. Chiamata una volta sola all'avvio.
    pub fn backfill_sensitive_kinds(&self) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, content FROM clips
             WHERE sensitive = 1 AND sensitive_kind IS NULL AND content IS NOT NULL",
        )?;
        let rows: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<_, _>>()?;
        drop(stmt);
        let mut n = 0;
        for (id, content) in rows {
            let cat = crate::categorizer::categorize(&content);
            if let Some(kind) = cat.sensitive_kind {
                conn.execute(
                    "UPDATE clips SET sensitive_kind = ?1 WHERE id = ?2",
                    params![kind, id],
                )?;
                n += 1;
            }
        }
        Ok(n)
    }

    /// Conteggi aggregati (totale clip, pinnate, immagini, sensibili, numero tag).
    pub fn stats(&self) -> rusqlite::Result<DbStats> {
        let conn = self.conn.lock().unwrap();
        let (total, pinned, images, sensitive) = conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(pinned), 0),
                    COALESCE(SUM(content_type = 'image'), 0),
                    COALESCE(SUM(sensitive), 0)
             FROM clips",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        let tags: i64 = conn.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0))?;
        Ok(DbStats { total, pinned, images, sensitive, tags })
    }

    /// Salva il testo OCR di una clip immagine (per renderla ricercabile).
    pub fn set_ocr_text(&self, id: i64, text: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE clips SET ocr_text = ?2 WHERE id = ?1",
            params![id, text],
        )?;
        Ok(())
    }

    /// (id, image_path) delle clip immagine ancora prive di testo OCR.
    /// Usato per il backfill all'avvio quando l'OCR è attivo.
    pub fn images_needing_ocr(&self) -> rusqlite::Result<Vec<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, image_path FROM clips
             WHERE content_type = 'image' AND image_path IS NOT NULL AND ocr_text IS NULL",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }

    // ----- tag -----

    pub fn get_or_create_tag(
        &self,
        name: &str,
        color: Option<&str>,
        is_auto: bool,
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        if let Some(id) = conn
            .query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))
            .optional()?
        {
            return Ok(id);
        }
        conn.execute(
            "INSERT INTO tags (name, color, is_auto) VALUES (?1, ?2, ?3)",
            params![name, color, is_auto as i64],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn attach_tag(&self, clip_id: i64, tag_id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id) VALUES (?1, ?2)",
            params![clip_id, tag_id],
        )?;
        Ok(())
    }

    pub fn detach_tag(&self, clip_id: i64, tag_id: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM clip_tags WHERE clip_id = ?1 AND tag_id = ?2",
            params![clip_id, tag_id],
        )?;
        Ok(())
    }

    /// Stacca un tag da una clip dato il nome (per i tag rimossi dalla UI).
    pub fn remove_tag_by_name(&self, clip_id: i64, name: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM clip_tags
             WHERE clip_id = ?1 AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
            params![clip_id, name],
        )?;
        Ok(())
    }

    /// (nome_tag, conteggio_clip, colore, pinned) per la sidebar "Categorie".
    pub fn list_tags_with_counts(
        &self,
    ) -> rusqlite::Result<Vec<(String, i64, Option<String>, bool)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.name, COUNT(ct.clip_id) AS n, t.color, t.pinned
             FROM tags t LEFT JOIN clip_tags ct ON ct.tag_id = t.id
             GROUP BY t.id HAVING n > 0
             ORDER BY t.pinned DESC, t.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)? != 0,
            ))
        })?;
        rows.collect()
    }

    /// Rinomina un tag. Errore se il nuovo nome è vuoto o già usato da un altro tag.
    pub fn rename_tag(&self, old: &str, new: &str) -> Result<(), String> {
        let new = new.trim();
        let old = old.trim();
        if new.is_empty() {
            return Err("empty new name".into());
        }
        if new == old {
            return Ok(());
        }
        let conn = self.conn.lock().unwrap();
        let exists: Option<i64> = conn
            .query_row("SELECT id FROM tags WHERE name = ?1", params![new], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_some() {
            return Err(format!("esiste già un tag chiamato '{new}'"));
        }
        conn.execute(
            "UPDATE tags SET name = ?2 WHERE name = ?1",
            params![old, new],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Rimuove un tag (per nome) da più clip in un colpo.
    pub fn bulk_remove_tag(&self, ids: &[i64], name: &str) -> rusqlite::Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");
        let conn = self.conn.lock().unwrap();
        let sql = format!(
            "DELETE FROM clip_tags
             WHERE clip_id IN ({placeholders})
               AND tag_id = (SELECT id FROM tags WHERE name = ?)"
        );
        let mut p: Vec<&dyn rusqlite::ToSql> = ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        p.push(&name);
        conn.execute(&sql, rusqlite::params_from_iter(p.iter().copied()))?;
        Ok(())
    }

    /// Fissa/sfissa un tag nella sidebar.
    pub fn set_tag_pinned(&self, name: &str, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tags SET pinned = ?2 WHERE name = ?1",
            params![name, pinned as i64],
        )?;
        Ok(())
    }

    /// Tutti i tag con colore e flag is_auto (usato dall'export).
    pub fn list_all_tags(&self) -> rusqlite::Result<Vec<(String, Option<String>, bool)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT name, color, is_auto FROM tags ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)? != 0,
            ))
        })?;
        rows.collect()
    }

    /// Svuota completamente la cronologia (usato dall'import in modalità "replace").
    /// Le immagini su disco vanno rimosse dal chiamante prima di invocarla.
    pub fn wipe_all(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM clips", [])?;
        conn.execute("DELETE FROM tags", [])?;
        Ok(())
    }

    /// Imposta il colore (hex) di un tag.
    pub fn set_tag_color(&self, name: &str, color: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE tags SET color = ?2 WHERE name = ?1", params![name, color])?;
        Ok(())
    }

    /// Aggiorna il contenuto di un clip (modifica manuale). In caso di conflitto
    /// di hash (UNIQUE), aggiorna tutto tranne l'hash.
    pub fn update_clip_content(
        &self,
        id: i64,
        content: &str,
        content_type: &str,
        preview: &str,
        char_count: i64,
        sensitive: bool,
        sensitive_kind: Option<&str>,
        hash: &str,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        // l'editor manuale produce solo plain text: azzera HTML e RTF
        let with_hash = conn.execute(
            "UPDATE clips SET content=?2, content_html=NULL, content_rtf=NULL, content_type=?3, preview=?4, char_count=?5, sensitive=?6, sensitive_kind=?7, hash=?8 WHERE id=?1",
            params![id, content, content_type, preview, char_count, sensitive as i64, sensitive_kind, hash],
        );
        if with_hash.is_err() {
            conn.execute(
                "UPDATE clips SET content=?2, content_html=NULL, content_rtf=NULL, content_type=?3, preview=?4, char_count=?5, sensitive=?6, sensitive_kind=?7 WHERE id=?1",
                params![id, content, content_type, preview, char_count, sensitive as i64, sensitive_kind],
            )?;
        }
        Ok(())
    }

    // ----- helper privati (assumono il lock già acquisito) -----

    fn collect(
        conn: &Connection,
        sql: &str,
        p: impl rusqlite::Params,
    ) -> rusqlite::Result<Vec<Clip>> {
        let mut stmt = conn.prepare(sql)?;
        let mut clips: Vec<Clip> = stmt.query_map(p, Self::map_row)?.collect::<Result<_, _>>()?;
        for c in clips.iter_mut() {
            c.tags = Self::tags_for_clip(conn, c.id)?;
            if c.content_type == "group" {
                c.items = Self::items_for_clip_conn(conn, c.id)?;
            }
        }
        Ok(clips)
    }

    /// Inserisce un elemento in una clip-gruppo alla posizione `position`.
    pub fn insert_clip_item(
        &self,
        clip_id: i64,
        position: i64,
        item: &NewClipItem,
    ) -> rusqlite::Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO clip_items (clip_id, position, item_type, content, image_path, label, char_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                clip_id,
                position,
                item.item_type,
                item.content,
                item.image_path,
                item.label,
                item.char_count,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Elementi di una clip-gruppo, ordinati per posizione.
    pub fn items_for_clip(&self, clip_id: i64) -> rusqlite::Result<Vec<ClipItem>> {
        let conn = self.conn.lock().unwrap();
        Self::items_for_clip_conn(&conn, clip_id)
    }

    /// Versione che riusa una connessione già lockata (per evitare doppi lock
    /// quando si caricano gli item insieme alla lista delle clip).
    fn items_for_clip_conn(conn: &Connection, clip_id: i64) -> rusqlite::Result<Vec<ClipItem>> {
        let mut stmt = conn.prepare(
            "SELECT id, position, item_type, content, image_path, label, char_count
             FROM clip_items WHERE clip_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![clip_id], |row| {
            let image_path: Option<String> = row.get(4)?;
            let thumb_path = image_path.as_deref().map(|p| {
                crate::images::thumb_path_for(std::path::Path::new(p))
                    .to_string_lossy()
                    .to_string()
            });
            Ok(ClipItem {
                id: row.get(0)?,
                position: row.get(1)?,
                item_type: row.get(2)?,
                content: row.get(3)?,
                image_path,
                thumb_path,
                label: row.get(5)?,
                char_count: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    /// Un singolo elemento di gruppo (per copiarlo negli appunti).
    pub fn get_clip_item(&self, item_id: i64) -> rusqlite::Result<Option<ClipItem>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, position, item_type, content, image_path, label, char_count
             FROM clip_items WHERE id = ?1",
            params![item_id],
            |row| {
                let image_path: Option<String> = row.get(4)?;
                let thumb_path = image_path.as_deref().map(|p| {
                    crate::images::thumb_path_for(std::path::Path::new(p))
                        .to_string_lossy()
                        .to_string()
                });
                Ok(ClipItem {
                    id: row.get(0)?,
                    position: row.get(1)?,
                    item_type: row.get(2)?,
                    content: row.get(3)?,
                    image_path,
                    thumb_path,
                    label: row.get(5)?,
                    char_count: row.get(6)?,
                })
            },
        )
        .optional()
    }

    /// Imposta (o azzera) l'etichetta di un elemento di gruppo.
    pub fn set_item_label(&self, item_id: i64, label: Option<&str>) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE clip_items SET label = ?2 WHERE id = ?1",
            params![item_id, label],
        )?;
        Ok(())
    }

    /// Tipo "effettivo" di una clip ai fini del merge: per una clip-gruppo è il
    /// tipo dei suoi elementi (omogeneo per costruzione), altrimenti il suo
    /// `content_type`. `url` è trattato come `text` (entrambi testo copiabile).
    fn effective_type(conn: &Connection, id: i64, content_type: &str) -> rusqlite::Result<String> {
        let raw = if content_type == "group" {
            conn.query_row(
                "SELECT item_type FROM clip_items WHERE clip_id = ?1 ORDER BY position LIMIT 1",
                params![id],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_default()
        } else {
            content_type.to_string()
        };
        Ok(if raw == "url" { "text".into() } else { raw })
    }

    /// Trasforma una clip in una lista di (item_type, content, image_path) da
    /// inserire come elementi di gruppo. Una clip-gruppo restituisce i suoi
    /// elementi esistenti; una clip singola un solo elemento dai suoi campi.
    fn clip_as_items(
        conn: &Connection,
        id: i64,
        content_type: &str,
        content: Option<String>,
        image_path: Option<String>,
        char_count: i64,
    ) -> rusqlite::Result<Vec<(String, Option<String>, Option<String>, Option<String>, i64)>> {
        if content_type == "group" {
            let mut stmt = conn.prepare(
                "SELECT item_type, content, image_path, label, char_count
                 FROM clip_items WHERE clip_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })?;
            rows.collect()
        } else {
            Ok(vec![(content_type.to_string(), content, image_path, None, char_count)])
        }
    }

    /// Fonde `source` dentro `target` (devono essere dello stesso tipo effettivo).
    /// - se `target` è già un gruppo: aggiunge gli elementi di `source` in coda;
    /// - altrimenti: crea una NUOVA clip-gruppo con gli elementi di target+source,
    ///   ne eredita i tag uniti, e rimuove le due clip originali.
    /// I PNG su disco NON vengono toccati: gli item riusano gli stessi `image_path`.
    /// Ritorna l'id della clip-gruppo risultante.
    pub fn merge_clips(&self, source_id: i64, target_id: i64, now: i64) -> rusqlite::Result<i64> {
        if source_id == target_id {
            return Err(rusqlite::Error::InvalidParameterName(
                "source e target coincidono".into(),
            ));
        }
        let mut guard = self.conn.lock().unwrap();
        // transazione: se una qualsiasi scrittura fallisce, il rollback (al drop
        // del tx) ripristina lo stato → niente gruppi a metà o originali perse.
        let conn = guard.transaction()?;

        // carica i campi minimi di entrambe
        let load = |id: i64| -> rusqlite::Result<(String, Option<String>, Option<String>, i64)> {
            conn.query_row(
                "SELECT content_type, content, image_path, char_count FROM clips WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
        };
        let (s_type, s_content, s_image, s_cc) = load(source_id)?;
        let (t_type, t_content, t_image, t_cc) = load(target_id)?;

        // guardia same-type sul tipo effettivo
        let s_eff = Self::effective_type(&conn, source_id, &s_type)?;
        let t_eff = Self::effective_type(&conn, target_id, &t_type)?;
        if s_eff != t_eff {
            return Err(rusqlite::Error::InvalidParameterName(
                "tipi diversi: merge non consentito".into(),
            ));
        }

        let source_items =
            Self::clip_as_items(&conn, source_id, &s_type, s_content, s_image, s_cc)?;

        // posizione di partenza per i nuovi item nel gruppo target
        let next_pos = |conn: &Connection, clip_id: i64| -> rusqlite::Result<i64> {
            conn.query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM clip_items WHERE clip_id = ?1",
                params![clip_id],
                |r| r.get::<_, i64>(0),
            )
        };

        let insert_items =
            |conn: &Connection,
             group_id: i64,
             start: i64,
             items: &[(String, Option<String>, Option<String>, Option<String>, i64)]|
             -> rusqlite::Result<()> {
                for (i, (ty, content, image, label, cc)) in items.iter().enumerate() {
                    conn.execute(
                        "INSERT INTO clip_items (clip_id, position, item_type, content, image_path, label, char_count)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![group_id, start + i as i64, ty, content, image, label, cc],
                    )?;
                }
                Ok(())
            };

        if t_type == "group" {
            // target è già un gruppo → aggiungo gli elementi di source in coda
            let start = next_pos(&conn, target_id)?;
            insert_items(&conn, target_id, start, &source_items)?;
            // i tag di source confluiscono nel gruppo
            conn.execute(
                "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id)
                 SELECT ?1, tag_id FROM clip_tags WHERE clip_id = ?2",
                params![target_id, source_id],
            )?;
            conn.execute("DELETE FROM clips WHERE id = ?1", params![source_id])?;
            conn.commit()?;
            return Ok(target_id);
        }

        // target è una clip singola → crea una nuova clip-gruppo.
        // Se il target era pinnato, il gruppo eredita pin e posizione, così
        // "prende il posto" del vecchio invece di nascere in fondo.
        let (t_pinned, t_pinned_order): (i64, Option<i64>) = conn.query_row(
            "SELECT pinned, pinned_order FROM clips WHERE id = ?1",
            params![target_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let target_items =
            Self::clip_as_items(&conn, target_id, &t_type, t_content, t_image, t_cc)?;
        let preview = format!("Group · {} items", target_items.len() + source_items.len());
        let hash = format!("group-{now}-{target_id}-{source_id}");
        conn.execute(
            "INSERT INTO clips (content, content_type, image_path, preview, created_at, char_count, sensitive, hash, pinned, pinned_order)
             VALUES (NULL, 'group', NULL, ?1, ?2, 0, 0, ?3, ?4, ?5)",
            params![preview, now, hash, t_pinned, t_pinned_order],
        )?;
        let group_id = conn.last_insert_rowid();
        insert_items(&conn, group_id, 0, &target_items)?;
        insert_items(&conn, group_id, target_items.len() as i64, &source_items)?;
        // unione dei tag di entrambe le originali sul gruppo
        conn.execute(
            "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id)
             SELECT ?1, tag_id FROM clip_tags WHERE clip_id IN (?2, ?3)",
            params![group_id, target_id, source_id],
        )?;
        // rimuovi le due clip originali (i PNG restano: ora puntati dagli item)
        conn.execute("DELETE FROM clips WHERE id IN (?1, ?2)", params![target_id, source_id])?;
        conn.commit()?;
        Ok(group_id)
    }

    fn map_row(row: &Row) -> rusqlite::Result<Clip> {
        let image_path: Option<String> = row.get(3)?;
        let thumb_path = image_path.as_deref().map(|p| {
            crate::images::thumb_path_for(std::path::Path::new(p))
                .to_string_lossy()
                .to_string()
        });
        Ok(Clip {
            id: row.get(0)?,
            content: row.get(1)?,
            content_type: row.get(2)?,
            image_path,
            thumb_path,
            preview: row.get(4)?,
            created_at: row.get(5)?,
            pinned: row.get::<_, i64>(6)? != 0,
            pinned_order: row.get(7)?,
            char_count: row.get(8)?,
            sensitive: row.get::<_, i64>(9)? != 0,
            hash: row.get(10)?,
            content_html: row.get(11)?,
            content_rtf: row.get(12)?,
            ocr_text: row.get(13)?,
            tags: Vec::new(),
            items: Vec::new(),
        })
    }

    fn tags_for_clip(conn: &Connection, clip_id: i64) -> rusqlite::Result<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT t.name FROM tags t
             JOIN clip_tags ct ON ct.tag_id = t.id
             WHERE ct.clip_id = ?1 ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![clip_id], |r| r.get::<_, String>(0))?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_text(content: &str, ts: i64) -> NewClip {
        NewClip {
            content: Some(content.to_string()),
            content_html: None,
            content_rtf: None,
            content_type: "text".into(),
            image_path: None,
            preview: content.chars().take(80).collect(),
            created_at: ts,
            char_count: content.chars().count() as i64,
            sensitive: false,
            sensitive_kind: None,
            hash: content_hash(content),
        }
    }

    #[test]
    fn insert_and_list() {
        let db = Db::open_in_memory().unwrap();
        db.insert_or_bump_clip(&new_text("uno", 100)).unwrap();
        db.insert_or_bump_clip(&new_text("due", 200)).unwrap();
        let clips = db.list_recent(10).unwrap();
        assert_eq!(clips.len(), 2);
        assert_eq!(clips[0].content.as_deref(), Some("due")); // più recente in cima
    }

    #[test]
    fn dedup_moves_to_top() {
        let db = Db::open_in_memory().unwrap();
        let id_a = db.insert_or_bump_clip(&new_text("alpha", 100)).unwrap();
        db.insert_or_bump_clip(&new_text("beta", 200)).unwrap();
        // ricopio "alpha" più tardi: NON deve duplicare, deve risalire in cima
        let id_a2 = db.insert_or_bump_clip(&new_text("alpha", 300)).unwrap();
        assert_eq!(id_a, id_a2);
        let clips = db.list_recent(10).unwrap();
        assert_eq!(clips.len(), 2);
        assert_eq!(clips[0].content.as_deref(), Some("alpha"));
    }

    #[test]
    fn pin_prune_and_tags() {
        let db = Db::open_in_memory().unwrap();
        let keep = db.insert_or_bump_clip(&new_text("pinned", 1)).unwrap();
        db.set_pinned(keep, true).unwrap();
        for i in 0..5 {
            db.insert_or_bump_clip(&new_text(&format!("c{i}"), 10 + i)).unwrap();
        }
        // tieni solo 2 non-pinnate: ne restano 2 + 1 pinnata = 3
        let removed = db.prune_to_limit(2).unwrap();
        assert_eq!(removed, 3);
        assert_eq!(db.list_recent(100).unwrap().len(), 3);

        // tag
        let tag = db.get_or_create_tag("Codice", Some("#888"), true).unwrap();
        db.attach_tag(keep, tag).unwrap();
        let counts = db.list_tags_with_counts().unwrap();
        assert_eq!(
            counts,
            vec![("Codice".to_string(), 1, Some("#888".to_string()), false)]
        );
    }

    fn new_sensitive(content: &str, kind: &str, ts: i64) -> NewClip {
        NewClip {
            content: Some(content.to_string()),
            content_html: None,
            content_rtf: None,
            content_type: "text".into(),
            image_path: None,
            preview: content.chars().take(80).collect(),
            created_at: ts,
            char_count: content.chars().count() as i64,
            sensitive: true,
            sensitive_kind: Some(kind.to_string()),
            hash: content_hash(content),
        }
    }

    #[test]
    fn delete_clips_removes_multiple() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("a", 1)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("b", 2)).unwrap();
        let c = db.insert_or_bump_clip(&new_text("c", 3)).unwrap();
        let removed = db.delete_clips(&[a, c]).unwrap();
        assert_eq!(removed, 2);
        let left = db.list_recent(10).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, b);
    }

    #[test]
    fn delete_by_hash_skips_pinned() {
        let db = Db::open_in_memory().unwrap();
        let p = db.insert_or_bump_clip(&new_text("keep", 1)).unwrap();
        db.set_pinned(p, true).unwrap();
        let n = db.delete_by_hash_if_unpinned(&content_hash("keep")).unwrap();
        assert_eq!(n, 0); // pinnato, non rimosso
        let _u = db.insert_or_bump_clip(&new_text("drop", 2)).unwrap();
        let n2 = db.delete_by_hash_if_unpinned(&content_hash("drop")).unwrap();
        assert_eq!(n2, 1);
    }

    #[test]
    fn delete_expired_sensitive_kinds_filters_and_skips_pinned() {
        let db = Db::open_in_memory().unwrap();
        let old_email = db
            .insert_or_bump_clip(&new_sensitive("a@b.it", "email", 100))
            .unwrap();
        let _old_iban = db
            .insert_or_bump_clip(&new_sensitive("IT60X0542811101000000123456", "iban", 100))
            .unwrap();
        let pinned_email = db
            .insert_or_bump_clip(&new_sensitive("c@d.it", "email", 100))
            .unwrap();
        db.set_pinned(pinned_email, true).unwrap();
        // cutoff > 100 → tutte le clip "vecchie" sono scadute
        let n = db.delete_expired_sensitive_kinds(200, &["email"]).unwrap();
        assert_eq!(n, 1); // solo old_email; iban escluso per kind, pinned_email escluso per pin
        assert!(db.get_clip(old_email).unwrap().is_none());
        assert!(db.get_clip(pinned_email).unwrap().is_some());
    }

    #[test]
    fn delete_expired_sensitive_kinds_empty_list_noop() {
        let db = Db::open_in_memory().unwrap();
        db.insert_or_bump_clip(&new_sensitive("x@y.it", "email", 1))
            .unwrap();
        let n = db.delete_expired_sensitive_kinds(999, &[]).unwrap();
        assert_eq!(n, 0);
        assert_eq!(db.list_recent(10).unwrap().len(), 1);
    }

    #[test]
    fn backfill_sensitive_kinds_fills_legacy_rows() {
        let db = Db::open_in_memory().unwrap();
        // simula clip pre-migrazione: sensitive=1 ma sensitive_kind=NULL
        let clip = NewClip {
            sensitive_kind: None,
            ..new_sensitive("legacy@x.it", "ignored", 1)
        };
        db.insert_or_bump_clip(&clip).unwrap();
        // force NULL in DB
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("UPDATE clips SET sensitive_kind = NULL", [])
                .unwrap();
        }
        let n = db.backfill_sensitive_kinds().unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn stats_counts_clips_pins_images_sensitive_and_tags() {
        let db = Db::open_in_memory().unwrap();
        let p = db.insert_or_bump_clip(&new_text("pinned", 1)).unwrap();
        db.set_pinned(p, true).unwrap();
        db.insert_or_bump_clip(&new_text("plain", 2)).unwrap();
        db.insert_or_bump_clip(&new_sensitive("a@b.it", "email", 3))
            .unwrap();
        let img = NewClip {
            content: None,
            content_html: None,
            content_rtf: None,
            content_type: "image".into(),
            image_path: Some("X:/x.png".into()),
            preview: "Immagine".into(),
            created_at: 4,
            char_count: 0,
            sensitive: false,
            sensitive_kind: None,
            hash: "h-img".into(),
        };
        db.insert_or_bump_clip(&img).unwrap();
        let tag = db.get_or_create_tag("T", None, false).unwrap();
        db.attach_tag(p, tag).unwrap();

        let s = db.stats().unwrap();
        assert_eq!(s.total, 4);
        assert_eq!(s.pinned, 1);
        assert_eq!(s.images, 1);
        assert_eq!(s.sensitive, 1);
        assert_eq!(s.tags, 1);
    }

    #[test]
    fn rename_tag_renames_or_errors_on_conflict() {
        let db = Db::open_in_memory().unwrap();
        db.get_or_create_tag("OldName", None, false).unwrap();
        db.get_or_create_tag("Other", None, false).unwrap();
        db.rename_tag("OldName", "NewName").unwrap();
        // conflitto
        assert!(db.rename_tag("Other", "NewName").is_err());
    }

    #[test]
    fn set_tag_pinned_toggles() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_or_bump_clip(&new_text("hi", 1)).unwrap();
        let tag = db.get_or_create_tag("T", None, false).unwrap();
        db.attach_tag(id, tag).unwrap();
        db.set_tag_pinned("T", true).unwrap();
        let counts = db.list_tags_with_counts().unwrap();
        assert_eq!(counts[0].3, true); // pinned
        db.set_tag_pinned("T", false).unwrap();
        assert_eq!(db.list_tags_with_counts().unwrap()[0].3, false);
    }

    #[test]
    fn bulk_remove_tag_unties_clips() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("a", 1)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("b", 2)).unwrap();
        let tag = db.get_or_create_tag("Z", None, false).unwrap();
        db.attach_tag(a, tag).unwrap();
        db.attach_tag(b, tag).unwrap();
        db.bulk_remove_tag(&[a, b], "Z").unwrap();
        let clips = db.list_recent(10).unwrap();
        for c in clips {
            assert!(c.tags.is_empty());
        }
    }

    #[test]
    fn reorder_pinned_assigns_order() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("a", 1)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("b", 2)).unwrap();
        let c = db.insert_or_bump_clip(&new_text("c", 3)).unwrap();
        for id in [a, b, c] {
            db.set_pinned(id, true).unwrap();
        }
        db.reorder_pinned(&[c, a, b]).unwrap();
        let clips = db.list_recent(10).unwrap();
        // pinnati ordinati per pinned_order asc
        assert_eq!(clips[0].id, c);
        assert_eq!(clips[1].id, a);
        assert_eq!(clips[2].id, b);
    }

    #[test]
    fn wipe_all_clears_everything() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_or_bump_clip(&new_text("x", 1)).unwrap();
        let tag = db.get_or_create_tag("T", None, false).unwrap();
        db.attach_tag(id, tag).unwrap();
        db.wipe_all().unwrap();
        assert_eq!(db.list_recent(10).unwrap().len(), 0);
        assert_eq!(db.list_all_tags().unwrap().len(), 0);
    }

    #[test]
    fn content_html_roundtrip_and_update_clears_it() {
        let db = Db::open_in_memory().unwrap();
        let mut c = new_text("Hello", 1);
        c.content_html = Some("<b>Hello</b>".to_string());
        let id = db.insert_or_bump_clip(&c).unwrap();
        let got = db.get_clip(id).unwrap().unwrap();
        assert_eq!(got.content_html.as_deref(), Some("<b>Hello</b>"));

        // update_clip_content deve azzerare content_html (editor manuale = solo testo)
        db.update_clip_content(
            id,
            "Hello edited",
            "text",
            "Hello edited",
            12,
            false,
            None,
            &content_hash("Hello edited"),
        )
        .unwrap();
        let got2 = db.get_clip(id).unwrap().unwrap();
        assert_eq!(got2.content_html, None);
        assert_eq!(got2.content.as_deref(), Some("Hello edited"));
    }

    #[test]
    fn image_paths_for_returns_only_existing_images() {
        let db = Db::open_in_memory().unwrap();
        let _txt = db.insert_or_bump_clip(&new_text("no-img", 1)).unwrap();
        let with_img = NewClip {
            content: None,
            content_html: None,
            content_rtf: None,
            content_type: "image".into(),
            image_path: Some("X:/tmp/abc.png".into()),
            preview: "Immagine".into(),
            created_at: 2,
            char_count: 0,
            sensitive: false,
            sensitive_kind: None,
            hash: "h-img".into(),
        };
        let img_id = db.insert_or_bump_clip(&with_img).unwrap();
        let paths = db.image_paths_for(&[img_id]).unwrap();
        assert_eq!(paths, vec!["X:/tmp/abc.png".to_string()]);
    }

    #[test]
    fn search_matches_content_and_tags() {
        let db = Db::open_in_memory().unwrap();
        let id = db.insert_or_bump_clip(&new_text("ciao mondo", 1)).unwrap();
        let tag = db.get_or_create_tag("Saluti", None, false).unwrap();
        db.attach_tag(id, tag).unwrap();
        assert_eq!(db.search("mondo").unwrap().len(), 1);
        assert_eq!(db.search("Saluti").unwrap().len(), 1);
        assert_eq!(db.search("inesistente").unwrap().len(), 0);
    }

    #[test]
    fn prune_to_limit_keeps_pinned_above_limit() {
        let db = Db::open_in_memory().unwrap();
        // 3 normali + 1 pinnata, limit = 2 → ne devono restare 2 normali +
        // tutte le pinnate (le pinnate non concorrono al limite).
        let a = db.insert_or_bump_clip(&new_text("a", 100)).unwrap();
        let _b = db.insert_or_bump_clip(&new_text("b", 200)).unwrap();
        let _c = db.insert_or_bump_clip(&new_text("c", 300)).unwrap();
        let _d = db.insert_or_bump_clip(&new_text("d", 400)).unwrap();
        db.set_pinned(a, true).unwrap();

        db.prune_to_limit(2).unwrap();
        let all = db.list_recent(100).unwrap();
        // resta: pinnata 'a' + 2 più recenti non pinnate ('c','d')
        let contents: Vec<_> = all
            .iter()
            .filter_map(|c| c.content.clone())
            .collect();
        assert!(contents.contains(&"a".to_string())); // pinned mai potata
        assert!(contents.contains(&"c".to_string()));
        assert!(contents.contains(&"d".to_string()));
        assert!(!contents.contains(&"b".to_string())); // potata
    }

    #[test]
    fn search_with_empty_query_is_empty_list() {
        // search() richiede una query non-vuota: comportamento UI è chiamare
        // direttamente list_recent. Qui validiamo che con stringa vuota il
        // LIKE %% matcha tutto (è il caso d'uso che usa la UI).
        let db = Db::open_in_memory().unwrap();
        db.insert_or_bump_clip(&new_text("alpha", 100)).unwrap();
        db.insert_or_bump_clip(&new_text("beta", 200)).unwrap();
        let res = db.search("").unwrap();
        assert_eq!(res.len(), 2);
    }

    #[test]
    fn list_recent_orders_pinned_first_then_by_date_desc() {
        let db = Db::open_in_memory().unwrap();
        let _old = db.insert_or_bump_clip(&new_text("old", 100)).unwrap();
        let mid = db.insert_or_bump_clip(&new_text("mid", 200)).unwrap();
        let _new = db.insert_or_bump_clip(&new_text("new", 300)).unwrap();
        db.set_pinned(mid, true).unwrap();
        let list = db.list_recent(10).unwrap();
        let order: Vec<_> = list.iter().filter_map(|c| c.content.clone()).collect();
        assert_eq!(order, vec!["mid", "new", "old"]); // pinned in cima, poi data desc
    }

    fn new_group(ts: i64) -> NewClip {
        NewClip {
            content: None,
            content_html: None,
            content_rtf: None,
            content_type: "group".into(),
            image_path: None,
            preview: "Group".into(),
            created_at: ts,
            char_count: 0,
            sensitive: false,
            sensitive_kind: None,
            hash: format!("group-{ts}"),
        }
    }

    fn new_item(item_type: &str, content: &str, label: Option<&str>) -> NewClipItem {
        NewClipItem {
            item_type: item_type.into(),
            content: Some(content.into()),
            image_path: None,
            label: label.map(|s| s.into()),
            char_count: content.chars().count() as i64,
        }
    }

    #[test]
    fn merge_two_singles_creates_group_and_removes_originals() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("mario@x.it", 100)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("Passw0rd!", 200)).unwrap();
        let gid = db.merge_clips(a, b, 300).unwrap();

        // le due originali sono sparite, resta solo il gruppo
        let list = db.list_recent(10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, gid);
        assert_eq!(list[0].content_type, "group");

        // il gruppo contiene entrambi gli elementi, nell'ordine target poi source
        let items = db.items_for_clip(gid).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].content.as_deref(), Some("Passw0rd!")); // target (b) prima
        assert_eq!(items[1].content.as_deref(), Some("mario@x.it")); // source (a) dopo
    }

    #[test]
    fn merge_onto_group_appends_in_place() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("uno", 100)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("due", 200)).unwrap();
        let gid = db.merge_clips(a, b, 300).unwrap();
        let c = db.insert_or_bump_clip(&new_text("tre", 400)).unwrap();

        // trascino c sul gruppo esistente → append, stesso gid, nessuna nuova clip
        let same = db.merge_clips(c, gid, 500).unwrap();
        assert_eq!(same, gid);
        let list = db.list_recent(10).unwrap();
        assert_eq!(list.len(), 1); // solo il gruppo
        let items = db.items_for_clip(gid).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[2].content.as_deref(), Some("tre")); // aggiunto in coda
    }

    #[test]
    fn merge_unites_tags() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("aaa", 100)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("bbb", 200)).unwrap();
        let t1 = db.get_or_create_tag("rosso", None, false).unwrap();
        let t2 = db.get_or_create_tag("verde", None, false).unwrap();
        db.attach_tag(a, t1).unwrap();
        db.attach_tag(b, t2).unwrap();
        let gid = db.merge_clips(a, b, 300).unwrap();
        let tags = db.list_recent(10).unwrap()[0].tags.clone();
        assert!(tags.contains(&"rosso".to_string()));
        assert!(tags.contains(&"verde".to_string()));
        let _ = gid;
    }

    #[test]
    fn merge_onto_pinned_inherits_pin() {
        let db = Db::open_in_memory().unwrap();
        let a = db.insert_or_bump_clip(&new_text("src", 100)).unwrap();
        let b = db.insert_or_bump_clip(&new_text("tgt", 200)).unwrap();
        db.set_pinned(b, true).unwrap();
        let gid = db.merge_clips(a, b, 300).unwrap();
        let group = db.list_recent(10).unwrap().into_iter().find(|c| c.id == gid).unwrap();
        assert!(group.pinned); // il gruppo eredita il pin del target
    }

    #[test]
    fn merge_rejects_different_types() {
        let db = Db::open_in_memory().unwrap();
        let txt = db.insert_or_bump_clip(&new_text("hello", 100)).unwrap();
        let img = NewClip {
            content: None,
            content_html: None,
            content_rtf: None,
            content_type: "image".into(),
            image_path: Some("X:/img.png".into()),
            preview: "Image".into(),
            created_at: 200,
            char_count: 0,
            sensitive: false,
            sensitive_kind: None,
            hash: "img-hash".into(),
        };
        let img_id = db.insert_or_bump_clip(&img).unwrap();
        assert!(db.merge_clips(txt, img_id, 300).is_err());
    }

    #[test]
    fn clip_items_insert_order_label_and_cascade_delete() {
        let db = Db::open_in_memory().unwrap();
        let gid = db.insert_or_bump_clip(&new_group(100)).unwrap();
        db.insert_clip_item(gid, 0, &new_item("text", "mario@x.it", Some("email")))
            .unwrap();
        let i2 = db
            .insert_clip_item(gid, 1, &new_item("text", "Passw0rd!", None))
            .unwrap();

        let items = db.items_for_clip(gid).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].position, 0);
        assert_eq!(items[0].label.as_deref(), Some("email"));
        assert_eq!(items[1].content.as_deref(), Some("Passw0rd!"));
        assert_eq!(items[1].label, None);

        // etichetta impostata a posteriori
        db.set_item_label(i2, Some("password")).unwrap();
        let items = db.items_for_clip(gid).unwrap();
        assert_eq!(items[1].label.as_deref(), Some("password"));

        // CASCADE: cancellando la clip-gruppo spariscono i suoi elementi
        db.delete_clip(gid).unwrap();
        assert!(db.items_for_clip(gid).unwrap().is_empty());
    }
}
