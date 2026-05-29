//! Metodi di `Db` sui tag: creazione/lookup, associazione alle clip, rinomina,
//! colore, pin nella sidebar, elenchi (con conteggi o per export).

use super::{Db, TagInfo};
use rusqlite::{params, OptionalExtension};

impl Db {
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

    /// Tag con conteggio clip, colore e flag pinned, per la sidebar "Categorie".
    pub fn list_tags_with_counts(&self) -> rusqlite::Result<Vec<TagInfo>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT t.name, COUNT(ct.clip_id) AS n, t.color, t.pinned
             FROM tags t LEFT JOIN clip_tags ct ON ct.tag_id = t.id
             GROUP BY t.id HAVING n > 0
             ORDER BY t.pinned DESC, t.name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(TagInfo {
                name: r.get(0)?,
                count: r.get(1)?,
                color: r.get(2)?,
                pinned: r.get::<_, i64>(3)? != 0,
            })
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
        let placeholders = std::iter::repeat_n("?", ids.len()).collect::<Vec<_>>().join(",");
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

    /// Imposta il colore (hex) di un tag.
    pub fn set_tag_color(&self, name: &str, color: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE tags SET color = ?2 WHERE name = ?1", params![name, color])?;
        Ok(())
    }

    /// Svuota completamente la cronologia (usato dall'import in modalità "replace").
    /// Le immagini su disco vanno rimosse dal chiamante prima di invocarla.
    pub fn wipe_all(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM clips", [])?;
        conn.execute("DELETE FROM tags", [])?;
        Ok(())
    }
}
