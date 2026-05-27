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
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    content      TEXT,                       -- NULL per le immagini pure
    content_type TEXT NOT NULL,              -- 'text' | 'image' | 'url'
    image_path   TEXT,
    preview      TEXT NOT NULL,
    created_at   INTEGER NOT NULL,           -- unix millis
    pinned       INTEGER NOT NULL DEFAULT 0,
    pinned_order INTEGER,
    char_count   INTEGER NOT NULL DEFAULT 0,
    hash         TEXT NOT NULL UNIQUE
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
pub fn content_hash(s: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{:016x}", hash)
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
    pub hash: String,
}

pub struct Db {
    conn: Mutex<Connection>,
}

const SELECT_COLS: &str =
    "id, content, content_type, image_path, preview, created_at, pinned, pinned_order, char_count";

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
            "INSERT INTO clips (content, content_type, image_path, preview, created_at, char_count, hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                new.content,
                new.content_type,
                new.image_path,
                new.preview,
                new.created_at,
                new.char_count,
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

    pub fn set_pinned(&self, clip_id: i64, pinned: bool) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE clips SET pinned = ?1 WHERE id = ?2",
            params![pinned as i64, clip_id],
        )?;
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

    pub fn clear_all(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("DELETE FROM clip_tags; DELETE FROM clips;")?;
        Ok(())
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

    /// (nome_tag, conteggio_clip) per la sidebar "Categorie".
    pub fn list_tags_with_counts(&self) -> rusqlite::Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.name, COUNT(ct.clip_id)
             FROM tags t LEFT JOIN clip_tags ct ON ct.tag_id = t.id
             GROUP BY t.id ORDER BY t.name",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        rows.collect()
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
        assert_eq!(counts, vec![("Codice".to_string(), 1)]);
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
