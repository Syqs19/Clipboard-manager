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

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS clips (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    content        TEXT,                       -- NULL per le immagini pure
    content_type   TEXT NOT NULL,              -- 'text' | 'image' | 'url'
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
    is_auto INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS clip_tags (
    clip_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (clip_id, tag_id),
    FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)  REFERENCES tags(id)  ON DELETE CASCADE
);
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct Clip {
    pub id: i64,
    pub content: Option<String>,
    pub content_type: String,
    pub image_path: Option<String>,
    pub preview: String,
    pub created_at: i64,
    pub pinned: bool,
    pub pinned_order: Option<i64>,
    pub char_count: i64,
    pub sensitive: bool,
    pub tags: Vec<String>,
}

/// Dati per inserire una nuova clip (l'id lo assegna il DB).
#[derive(Debug, Clone)]
pub struct NewClip {
    pub content: Option<String>,
    pub content_type: String,
    pub image_path: Option<String>,
    pub preview: String,
    pub created_at: i64,
    pub char_count: i64,
    pub sensitive: bool,
    pub sensitive_kind: Option<String>,
    pub hash: String,
}

pub struct Db {
    conn: Mutex<Connection>,
}

const SELECT_COLS: &str =
    "id, content, content_type, image_path, preview, created_at, pinned, pinned_order, char_count, sensitive";

impl Db {
    pub fn open<P: AsRef<Path>>(path: P) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA)?;
        // migrazione additiva per DB pre-esistenti (colonna aggiunta dopo il rilascio)
        let _ = conn.execute("ALTER TABLE clips ADD COLUMN sensitive_kind TEXT", []);
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
            "INSERT INTO clips (content, content_type, image_path, preview, created_at, char_count, sensitive, sensitive_kind, hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                new.content,
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
        let mut stmt =
            conn.prepare("SELECT image_path FROM clips WHERE image_path IS NOT NULL")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
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
            conn.execute(
                "UPDATE clips SET pinned = 0, pinned_order = NULL WHERE id = ?1",
                params![clip_id],
            )?;
        }
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

    /// (nome_tag, conteggio_clip, colore) per la sidebar "Categorie".
    pub fn list_tags_with_counts(&self) -> rusqlite::Result<Vec<(String, i64, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.name, COUNT(ct.clip_id) AS n, t.color
             FROM tags t LEFT JOIN clip_tags ct ON ct.tag_id = t.id
             GROUP BY t.id HAVING n > 0 ORDER BY t.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?))
        })?;
        rows.collect()
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
        let with_hash = conn.execute(
            "UPDATE clips SET content=?2, content_type=?3, preview=?4, char_count=?5, sensitive=?6, sensitive_kind=?7, hash=?8 WHERE id=?1",
            params![id, content, content_type, preview, char_count, sensitive as i64, sensitive_kind, hash],
        );
        if with_hash.is_err() {
            conn.execute(
                "UPDATE clips SET content=?2, content_type=?3, preview=?4, char_count=?5, sensitive=?6, sensitive_kind=?7 WHERE id=?1",
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
        }
        Ok(clips)
    }

    fn map_row(row: &Row) -> rusqlite::Result<Clip> {
        Ok(Clip {
            id: row.get(0)?,
            content: row.get(1)?,
            content_type: row.get(2)?,
            image_path: row.get(3)?,
            preview: row.get(4)?,
            created_at: row.get(5)?,
            pinned: row.get::<_, i64>(6)? != 0,
            pinned_order: row.get(7)?,
            char_count: row.get(8)?,
            sensitive: row.get::<_, i64>(9)? != 0,
            tags: Vec::new(),
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
        assert_eq!(counts, vec![("Codice".to_string(), 1, Some("#888".to_string()))]);
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
}
