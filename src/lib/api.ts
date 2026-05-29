import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/// Specchio di `db::Clip` lato Rust.
export interface Clip {
  id: number;
  content: string | null;
  content_html: string | null;
  content_rtf: string | null;
  content_type: string; // 'text' | 'image' | 'url' | 'files'
  image_path: string | null;
  thumb_path: string | null;
  preview: string;
  created_at: number; // unix millis
  pinned: boolean;
  pinned_order: number | null;
  char_count: number;
  sensitive: boolean;
  hash: string;
  tags: string[];
}

export const api = {
  listClips: (limit?: number) => invoke<Clip[]>("list_clips", { limit }),
  searchClips: (query: string) => invoke<Clip[]>("search_clips", { query }),
  copyClip: (id: number, asPlain = false) =>
    invoke<void>("copy_clip", { id, asPlain }),
  copyImageAsFile: (id: number) =>
    invoke<void>("copy_image_as_file", { id }),
  togglePin: (id: number, pinned: boolean) =>
    invoke<void>("toggle_pin", { id, pinned }),
  reorderPinned: (ids: number[]) => invoke<void>("reorder_pinned", { ids }),
  removeClip: (id: number) => invoke<void>("remove_clip", { id }),
  removeClips: (ids: number[]) => invoke<void>("remove_clips", { ids }),
  bulkSetPinned: (ids: number[], pinned: boolean) =>
    invoke<void>("bulk_set_pinned", { ids, pinned }),
  bulkAddTag: (ids: number[], name: string) =>
    invoke<void>("bulk_add_tag", { ids, name }),
  clearHistory: () => invoke<void>("clear_history"),
  listTags: () =>
    invoke<[string, number, string | null, boolean][]>("list_tags"),
  setTagPinned: (name: string, pinned: boolean) =>
    invoke<void>("set_tag_pinned", { name, pinned }),
  renameTag: (old: string, newName: string) =>
    invoke<void>("rename_tag", { old, new: newName }),
  bulkRemoveTag: (ids: number[], name: string) =>
    invoke<void>("bulk_remove_tag", { ids, name }),
  revealInExplorer: (path: string) =>
    invoke<void>("reveal_in_explorer", { path }),
  addTag: (id: number, name: string) => invoke<void>("add_tag", { id, name }),
  removeTag: (id: number, name: string) =>
    invoke<void>("remove_tag", { id, name }),
  setTagColor: (name: string, color: string) =>
    invoke<void>("set_tag_color", { name, color }),
  updateClip: (id: number, content: string) =>
    invoke<void>("update_clip", { id, content }),
  applyMaxHistory: (value: number) =>
    invoke<void>("apply_max_history", { value }),
  applyCloseToTray: (value: boolean) =>
    invoke<void>("apply_close_to_tray", { value }),
  applyHotkey: (shortcut: string) => invoke<void>("apply_hotkey", { shortcut }),
  applyDontSaveSensitive: (value: boolean) =>
    invoke<void>("apply_dont_save_sensitive", { value }),
  applySensitiveTtl: (minutes: number) =>
    invoke<void>("apply_sensitive_ttl", { minutes }),
  applySensitiveKinds: (kinds: string[]) =>
    invoke<void>("apply_sensitive_kinds", { kinds }),
  exportHistory: (path: string) =>
    invoke<number>("export_history", { path }),
  importHistory: (path: string, mode: "merge" | "replace") =>
    invoke<number>("import_history", { path, mode }),
  /// Legge un PNG cifrato dal disco e restituisce i byte decifrati come ArrayBuffer.
  readImageBytes: (path: string) =>
    invoke<ArrayBuffer>("read_image_bytes", { path }),
  getStats: () => invoke<Stats>("get_stats"),
};

/// Specchio di `commands::Stats` lato Rust.
export interface Stats {
  total: number;
  pinned: number;
  images: number;
  sensitive: number;
  tags: number;
  db_bytes: number;
  images_bytes: number;
}

export const SENSITIVE_KINDS = [
  "email",
  "iban",
  "card",
  "token",
  "codice_fiscale",
  "ssn",
  "private_key",
  "jwt",
  "crypto",
  "mask",
] as const;
export type SensitiveKind = (typeof SENSITIVE_KINDS)[number];

/// Tasto modificatore per attivare la multi-selezione con click sulle clip.
/// Shift è riservato all'estensione del range (sempre attivo).
export const SELECT_MODIFIERS = ["ctrl", "alt"] as const;
export type SelectModifier = (typeof SELECT_MODIFIERS)[number];

/// Evento emesso dal menu tray "Impostazioni".
export function onOpenSettings(cb: () => void): Promise<UnlistenFn> {
  return listen("open-settings", cb);
}

/// Si registra agli eventi "clips-changed" (payload: id del clip aggiunto/risalito).
export function onClipsChanged(
  cb: (id: number | null) => void,
): Promise<UnlistenFn> {
  return listen<number>("clips-changed", (e) => cb(e.payload));
}
