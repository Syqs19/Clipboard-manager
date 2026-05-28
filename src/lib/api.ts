import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/// Specchio di `db::Clip` lato Rust.
export interface Clip {
  id: number;
  content: string | null;
  content_type: string; // 'text' | 'image' | 'url'
  image_path: string | null;
  preview: string;
  created_at: number; // unix millis
  pinned: boolean;
  pinned_order: number | null;
  char_count: number;
  sensitive: boolean;
  tags: string[];
}

export const api = {
  listClips: (limit?: number) => invoke<Clip[]>("list_clips", { limit }),
  searchClips: (query: string) => invoke<Clip[]>("search_clips", { query }),
  copyClip: (id: number) => invoke<void>("copy_clip", { id }),
  togglePin: (id: number, pinned: boolean) =>
    invoke<void>("toggle_pin", { id, pinned }),
  removeClip: (id: number) => invoke<void>("remove_clip", { id }),
  clearHistory: () => invoke<void>("clear_history"),
  listTags: () => invoke<[string, number, string | null][]>("list_tags"),
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
};

export const SENSITIVE_KINDS = ["email", "iban", "card", "token"] as const;
export type SensitiveKind = (typeof SENSITIVE_KINDS)[number];

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
