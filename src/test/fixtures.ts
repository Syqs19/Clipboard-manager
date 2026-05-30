// Helper per costruire `Clip`/`Tag` di test senza ripetere tutti i campi.
import type { Clip, ContentType, Tag } from "../lib/api";

let nextId = 1;

/// Crea una Clip di test. Passa solo i campi che contano per il singolo test;
/// il resto ha default sensati. `id` è auto-incrementale se non specificato.
export function makeClip(over: Partial<Clip> = {}): Clip {
  const id = over.id ?? nextId++;
  const content = over.content ?? `clip ${id}`;
  return {
    id,
    content,
    content_html: null,
    content_rtf: null,
    content_type: "text" as ContentType,
    image_path: null,
    thumb_path: null,
    preview: content ?? "",
    created_at: 1_000_000 + id,
    pinned: false,
    pinned_order: null,
    char_count: content?.length ?? 0,
    sensitive: false,
    hash: `hash-${id}`,
    tags: [],
    ...over,
  };
}

export function makeTag(over: Partial<Tag> = {}): Tag {
  return {
    name: over.name ?? "tag",
    count: over.count ?? 1,
    color: over.color ?? null,
    pinned: over.pinned ?? false,
  };
}
