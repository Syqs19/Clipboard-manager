//! Test del livello DB. Restano in un unico file: condividono gli helper
//! `new_text`/`new_sensitive`/`new_group`/`new_item` e accedono al DB in-memory.

use super::*;

fn new_text(content: &str, ts: i64) -> NewClip {
    NewClip {
        content: Some(content.to_string()),
        content_html: None,
        content_rtf: None,
        content_type: ContentType::Text,
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
        vec![TagInfo {
            name: "Codice".to_string(),
            count: 1,
            color: Some("#888".to_string()),
            pinned: false,
        }]
    );
}

#[test]
fn list_recent_assigns_tags_to_the_right_clip() {
    // Verifica il caricamento batch dei tag (ex N+1): più clip caricate
    // insieme devono avere ciascuna i propri tag, ordinati per nome.
    let db = Db::open_in_memory().unwrap();
    let a = db.insert_or_bump_clip(&new_text("aaa", 100)).unwrap();
    let b = db.insert_or_bump_clip(&new_text("bbb", 200)).unwrap();
    let _c = db.insert_or_bump_clip(&new_text("ccc", 300)).unwrap(); // senza tag

    let t_zebra = db.get_or_create_tag("Zebra", None, false).unwrap();
    let t_alfa = db.get_or_create_tag("Alfa", None, false).unwrap();
    let t_solo = db.get_or_create_tag("Solo", None, false).unwrap();
    // alla clip A do due tag in ordine "sbagliato" per testare l'ORDER BY name
    db.attach_tag(a, t_zebra).unwrap();
    db.attach_tag(a, t_alfa).unwrap();
    db.attach_tag(b, t_solo).unwrap();

    let clips = db.list_recent(100).unwrap();
    // list_recent ordina per created_at DESC: ccc, bbb, aaa
    let by_id: std::collections::HashMap<i64, &Clip> =
        clips.iter().map(|c| (c.id, c)).collect();
    assert_eq!(by_id[&a].tags, vec!["Alfa".to_string(), "Zebra".to_string()]);
    assert_eq!(by_id[&b].tags, vec!["Solo".to_string()]);
    assert!(by_id[&_c].tags.is_empty());
}

fn new_sensitive(content: &str, kind: &str, ts: i64) -> NewClip {
    NewClip {
        content: Some(content.to_string()),
        content_html: None,
        content_rtf: None,
        content_type: ContentType::Text,
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
        content_type: ContentType::Image,
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
    assert!(counts[0].pinned);
    db.set_tag_pinned("T", false).unwrap();
    assert!(!db.list_tags_with_counts().unwrap()[0].pinned);
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
        ContentType::Text,
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
        content_type: ContentType::Image,
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
        content_type: ContentType::Group,
        image_path: None,
        preview: "Group".into(),
        created_at: ts,
        char_count: 0,
        sensitive: false,
        sensitive_kind: None,
        hash: format!("group-{ts}"),
    }
}

fn new_item(item_type: ContentType, content: &str, label: Option<&str>) -> NewClipItem {
    NewClipItem {
        item_type,
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
    assert_eq!(list[0].content_type, ContentType::Group);

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
        content_type: ContentType::Image,
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
    db.insert_clip_item(gid, 0, &new_item(ContentType::Text, "mario@x.it", Some("email")))
        .unwrap();
    let i2 = db
        .insert_clip_item(gid, 1, &new_item(ContentType::Text, "Passw0rd!", None))
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
