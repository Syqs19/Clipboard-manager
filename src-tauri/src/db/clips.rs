//! Metodi di `Db` sulle clip: inserimento/dedup, lettura (list/search/get),
//! pin/riordino, cancellazione/pruning, statistiche e testo OCR.

use super::{Clip, ContentType, Db, DbStats, NewClip, SELECT_COLS};
use rusqlite::{params, OptionalExtension};

impl Db {
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
                params![clip_id, super::now_millis()],
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
        let placeholders = std::iter::repeat_n("?", ids.len()).collect::<Vec<_>>().join(",");
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
        let placeholders = std::iter::repeat_n("?", ids.len()).collect::<Vec<_>>().join(",");
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
        let placeholders = std::iter::repeat_n("?", kinds.len()).collect::<Vec<_>>().join(",");
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

    /// Aggiorna il contenuto di un clip (modifica manuale). In caso di conflitto
    /// di hash (UNIQUE), aggiorna tutto tranne l'hash.
    pub fn update_clip_content(
        &self,
        id: i64,
        content: &str,
        content_type: ContentType,
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
        match with_hash {
            Ok(_) => Ok(()),
            // Solo il conflitto sull'UNIQUE(hash) (il nuovo contenuto coincide con
            // un'altra clip) giustifica il fallback "aggiorna tutto tranne l'hash".
            // Qualsiasi altro errore (es. DB locked) deve propagare, non essere
            // mascherato da un secondo UPDATE.
            Err(e)
                if e.sqlite_error_code()
                    == Some(rusqlite::ErrorCode::ConstraintViolation) =>
            {
                conn.execute(
                    "UPDATE clips SET content=?2, content_html=NULL, content_rtf=NULL, content_type=?3, preview=?4, char_count=?5, sensitive=?6, sensitive_kind=?7 WHERE id=?1",
                    params![id, content, content_type, preview, char_count, sensitive as i64, sensitive_kind],
                )?;
                Ok(())
            }
            Err(e) => Err(e),
        }
    }
}
