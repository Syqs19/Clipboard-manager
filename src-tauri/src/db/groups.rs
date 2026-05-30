//! Metodi di `Db` sulle clip-gruppo e i loro elementi (`clip_items`):
//! inserimento/lettura degli item, etichette, e la fusione (merge) di due clip
//! in un gruppo.

use super::{ClipItem, ContentType, Db, NewClipItem};
use rusqlite::{params, Connection, OptionalExtension};

impl Db {
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
    fn effective_type(
        conn: &Connection,
        id: i64,
        content_type: ContentType,
    ) -> rusqlite::Result<ContentType> {
        let raw = if content_type == ContentType::Group {
            conn.query_row(
                "SELECT item_type FROM clip_items WHERE clip_id = ?1 ORDER BY position LIMIT 1",
                params![id],
                |r| r.get::<_, ContentType>(0),
            )
            .optional()?
            .unwrap_or(ContentType::Text)
        } else {
            content_type
        };
        // url e text sono entrambi testo copiabile: equiparati per il merge
        Ok(if raw == ContentType::Url { ContentType::Text } else { raw })
    }

    /// Trasforma una clip in una lista di (item_type, content, image_path) da
    /// inserire come elementi di gruppo. Una clip-gruppo restituisce i suoi
    /// elementi esistenti; una clip singola un solo elemento dai suoi campi.
    fn clip_as_items(
        conn: &Connection,
        id: i64,
        content_type: ContentType,
        content: Option<String>,
        image_path: Option<String>,
        char_count: i64,
    ) -> rusqlite::Result<Vec<(ContentType, Option<String>, Option<String>, Option<String>, i64)>>
    {
        if content_type == ContentType::Group {
            let mut stmt = conn.prepare(
                "SELECT item_type, content, image_path, label, char_count
                 FROM clip_items WHERE clip_id = ?1 ORDER BY position",
            )?;
            let rows = stmt.query_map(params![id], |r| {
                Ok((
                    r.get::<_, ContentType>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })?;
            rows.collect()
        } else {
            Ok(vec![(content_type, content, image_path, None, char_count)])
        }
    }

    /// Fonde `source` dentro `target` (devono essere dello stesso tipo effettivo).
    /// - se `target` è già un gruppo: aggiunge gli elementi di `source` in coda;
    /// - altrimenti: crea una NUOVA clip-gruppo con gli elementi di target+source,
    ///   ne eredita i tag uniti, e rimuove le due clip originali.
    ///
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
        let load =
            |id: i64| -> rusqlite::Result<(ContentType, Option<String>, Option<String>, i64)> {
                conn.query_row(
                    "SELECT content_type, content, image_path, char_count FROM clips WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
            };
        let (s_type, s_content, s_image, s_cc) = load(source_id)?;
        let (t_type, t_content, t_image, t_cc) = load(target_id)?;

        // guardia same-type sul tipo effettivo
        let s_eff = Self::effective_type(&conn, source_id, s_type)?;
        let t_eff = Self::effective_type(&conn, target_id, t_type)?;
        if s_eff != t_eff {
            return Err(rusqlite::Error::InvalidParameterName(
                "tipi diversi: merge non consentito".into(),
            ));
        }

        let source_items =
            Self::clip_as_items(&conn, source_id, s_type, s_content, s_image, s_cc)?;

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
             items: &[(ContentType, Option<String>, Option<String>, Option<String>, i64)]|
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

        if t_type == ContentType::Group {
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
            Self::clip_as_items(&conn, target_id, t_type, t_content, t_image, t_cc)?;
        let preview = format!("Group · {} items", target_items.len() + source_items.len());
        // hash temporaneo solo per soddisfare il vincolo NOT NULL/UNIQUE all'INSERT;
        // subito dopo lo riscrivo con l'id auto-increment (univoco per costruzione),
        // così due merge nello stesso millisecondo non possono collidere.
        let tmp_hash = format!("group-tmp-{now}-{target_id}-{source_id}");
        conn.execute(
            "INSERT INTO clips (content, content_type, image_path, preview, created_at, char_count, sensitive, hash, pinned, pinned_order)
             VALUES (NULL, 'group', NULL, ?1, ?2, 0, 0, ?3, ?4, ?5)",
            params![preview, now, tmp_hash, t_pinned, t_pinned_order],
        )?;
        let group_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE clips SET hash = ?1 WHERE id = ?2",
            params![format!("group-{group_id}"), group_id],
        )?;
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
}
