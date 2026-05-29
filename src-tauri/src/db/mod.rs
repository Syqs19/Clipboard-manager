//! Livello database (SQLite via rusqlite).
//!
//! Scelte chiave:
//! - modalità **WAL** + scrittura immediata di ogni clip → niente perdite su crash;
//! - dedup **move-to-top**: ricopiare un contenuto già presente non crea un
//!   duplicato ma riporta la clip in cima (aggiorna `created_at`);
//! - SQLite è compilato dentro l'eseguibile (feature `bundled` di rusqlite),
//!   quindi sul PC di destinazione non serve installare nulla.
//!
//! Il modulo è diviso per dominio: i tipi, lo schema e gli helper condivisi
//! stanno qui in `mod.rs`; i metodi di `Db` sono raggruppati in `clips`, `tags`
//! e `groups` (più blocchi `impl Db` sullo stesso struct). Gli helper privati
//! usati da più sottomoduli sono `pub(crate)` per restare interni al crate.
#![allow(dead_code)] // alcune funzioni verranno collegate ai comandi negli step successivi

use rusqlite::{params, Connection, Row};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::crypto::MasterKey;

mod clips;
mod groups;
mod tags;

#[cfg(test)]
mod tests;

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

/// Tipo di una clip (e di un elemento di gruppo). Unica fonte di verità per i
/// valori che prima erano stringhe libere sparse nel codice ("text", "image"…).
///
/// Aggiungere una variante qui fa fallire la compilazione in ogni `match` che
/// deve gestirla: il compilatore diventa la checklist dei punti da aggiornare.
///
/// serde la (de)serializza in minuscolo, quindi il JSON verso il frontend e i
/// file di export restano identici alle vecchie stringhe. Su SQLite passa sempre
/// per `as_str`/`from_str`, così lo schema (colonna TEXT) non cambia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentType {
    Text,
    Url,
    Image,
    Files,
    Group,
}

impl ContentType {
    pub fn as_str(self) -> &'static str {
        match self {
            ContentType::Text => "text",
            ContentType::Url => "url",
            ContentType::Image => "image",
            ContentType::Files => "files",
            ContentType::Group => "group",
        }
    }

    /// Converte la stringa letta da SQLite (o da un file di export legacy) nella
    /// variante. Valori sconosciuti ricadono su `Text` (degradazione sicura).
    pub fn from_str(s: &str) -> Self {
        match s {
            "url" => ContentType::Url,
            "image" => ContentType::Image,
            "files" => ContentType::Files,
            "group" => ContentType::Group,
            _ => ContentType::Text,
        }
    }

    /// Vero per i tipi "testuali" (text o url), trattati insieme in più punti.
    pub fn is_text_like(self) -> bool {
        matches!(self, ContentType::Text | ContentType::Url)
    }
}

/// Permette di leggere direttamente una colonna SQLite TEXT come `ContentType`.
impl rusqlite::types::FromSql for ContentType {
    fn column_result(
        value: rusqlite::types::ValueRef<'_>,
    ) -> rusqlite::types::FromSqlResult<Self> {
        value.as_str().map(ContentType::from_str)
    }
}

/// Permette di passare un `ContentType` come parametro SQLite (scrive `as_str`).
impl rusqlite::ToSql for ContentType {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.as_str()))
    }
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
    pub content_type: ContentType,
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
    pub content_type: ContentType,
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
    pub item_type: ContentType,
    pub content: Option<String>,
    pub image_path: Option<String>,
    pub thumb_path: Option<String>,
    pub label: Option<String>,
    pub char_count: i64,
}

/// Dati per inserire un nuovo elemento in una clip-gruppo (l'id lo assegna il DB).
#[derive(Debug, Clone)]
pub struct NewClipItem {
    pub item_type: ContentType,
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

/// Un tag con i suoi metadati per la sidebar. Sostituisce la vecchia tupla
/// anonima `(String, i64, Option<String>, bool)` che rendeva illeggibili gli
/// accessi posizionali (`.0`/`.3`) e fragili le modifiche allo schema dei tag.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct TagInfo {
    pub name: String,
    /// Numero di clip che hanno questo tag.
    pub count: i64,
    pub color: Option<String>,
    pub pinned: bool,
}

pub struct Db {
    conn: Mutex<Connection>,
}

/// Colonne caricate per costruire una `Clip` completa (vedi `map_row`).
pub(crate) const SELECT_COLS: &str =
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
        conn.execute_batch(
            // WAL + foreign keys come prima; in più i PRAGMA di performance:
            // - synchronous=NORMAL: con WAL è il setting consigliato, meno fsync
            //   (perdita possibile solo sull'ultimo commit in caso di crash del
            //   SO/power-loss, non per crash dell'app — accettabile per una clipboard);
            // - cache_size=-8000: ~8 MB di cache pagine (accelera le letture ripetute);
            // - temp_store=MEMORY: i sort/NOT IN temporanei restano in RAM.
            "PRAGMA journal_mode = WAL; \
             PRAGMA foreign_keys = ON; \
             PRAGMA synchronous = NORMAL; \
             PRAGMA cache_size = -8000; \
             PRAGMA temp_store = MEMORY;",
        )?;
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

    // ----- helper privati condivisi tra i sottomoduli (assumono il lock già acquisito) -----

    /// Esegue una query che seleziona `SELECT_COLS` e costruisce le `Clip`,
    /// caricando in batch i tag e (per i gruppi) gli item. Usato da clips e groups.
    pub(crate) fn collect(
        conn: &Connection,
        sql: &str,
        p: impl rusqlite::Params,
    ) -> rusqlite::Result<Vec<Clip>> {
        let mut stmt = conn.prepare(sql)?;
        let mut clips: Vec<Clip> = stmt.query_map(p, Self::map_row)?.collect::<Result<_, _>>()?;

        // Carica TUTTI i tag delle clip in scope con una sola query (evita il
        // pattern N+1: prima c'era una query per ogni clip). Li raggruppo in
        // memoria per clip_id e li assegno; idem per gli item dei gruppi.
        if !clips.is_empty() {
            let ids: Vec<i64> = clips.iter().map(|c| c.id).collect();
            let mut tags_by_clip = Self::tags_for_clips(conn, &ids)?;
            for c in clips.iter_mut() {
                if let Some(tags) = tags_by_clip.remove(&c.id) {
                    c.tags = tags;
                }
                if c.content_type == ContentType::Group {
                    c.items = Self::items_for_clip_conn(conn, c.id)?;
                }
            }
        }
        Ok(clips)
    }

    /// Mappa una riga (colonne = `SELECT_COLS`) in una `Clip` (tag/items vuoti).
    pub(crate) fn map_row(row: &Row) -> rusqlite::Result<Clip> {
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

    /// Carica i tag di un insieme di clip in UNA sola query e li raggruppa per
    /// clip_id. Sostituisce il vecchio `tags_for_clip` chiamato in loop (N+1).
    /// L'ordinamento `clip_id, name` mantiene i tag ordinati per nome dentro
    /// ogni clip, come prima.
    pub(crate) fn tags_for_clips(
        conn: &Connection,
        clip_ids: &[i64],
    ) -> rusqlite::Result<std::collections::HashMap<i64, Vec<String>>> {
        let mut map: std::collections::HashMap<i64, Vec<String>> =
            std::collections::HashMap::new();
        if clip_ids.is_empty() {
            return Ok(map);
        }
        let placeholders = clip_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT ct.clip_id, t.name FROM tags t
             JOIN clip_tags ct ON ct.tag_id = t.id
             WHERE ct.clip_id IN ({placeholders})
             ORDER BY ct.clip_id, t.name"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(clip_ids), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (clip_id, name) = row?;
            map.entry(clip_id).or_default().push(name);
        }
        Ok(map)
    }

    /// Elementi di una clip-gruppo riusando una connessione già lockata.
    /// Condiviso fra `collect` (mod) e i metodi gruppi.
    pub(crate) fn items_for_clip_conn(
        conn: &Connection,
        clip_id: i64,
    ) -> rusqlite::Result<Vec<ClipItem>> {
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
}
