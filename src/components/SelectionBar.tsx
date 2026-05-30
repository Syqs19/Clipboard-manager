import { useState } from "react";
import { Pin, PinOff, Tag, Trash2, X } from "lucide-react";
import { TagPicker } from "./TagPicker";
import { type Tag as TagInfo } from "../lib/api";

/// Barra di azioni in cima alla lista quando l'utente ha selezionato 1+ clip
/// con Ctrl/Shift+click. Elimina, pinna/despinna, aggiungi/rimuovi tag, deseleziona.
export function SelectionBar({
  count,
  anyPinned,
  allPinned,
  allTags,
  selectedTagsInBulk,
  colorOf,
  onClear,
  onDelete,
  onTogglePin,
  onAddTag,
  onRemoveTag,
}: {
  count: number;
  anyPinned: boolean;
  allPinned: boolean;
  allTags: TagInfo[];
  selectedTagsInBulk: string[];
  colorOf: (name: string) => string;
  onClear: () => void;
  onDelete: () => void;
  onTogglePin: (pin: boolean) => void;
  onAddTag: (name: string) => void;
  onRemoveTag: (name: string) => void;
}) {
  const [tagging, setTagging] = useState(false);
  const [untagging, setUntagging] = useState(false);

  return (
    <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-zinc-900/95 px-3 py-2 shadow-md backdrop-blur">
      <span className="text-sm text-zinc-100">{count} selected</span>
      <div className="ml-auto flex items-center gap-1.5">
        <div className="relative">
          <button
            onClick={() => {
              setUntagging(false);
              setTagging((v) => !v);
            }}
            title="Add tag to selected"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Tag className="h-3.5 w-3.5" /> +Tag
          </button>
          {tagging && (
            <TagPicker
              tags={allTags}
              colorOf={colorOf}
              onPick={(name) => onAddTag(name)}
              onClose={() => setTagging(false)}
            />
          )}
        </div>
        {selectedTagsInBulk.length > 0 && (
          <div className="relative">
            <button
              onClick={() => {
                setTagging(false);
                setUntagging((v) => !v);
              }}
              title="Remove a tag from selected"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              <Tag className="h-3.5 w-3.5" /> -Tag
            </button>
            {untagging && (
              <TagPicker
                tags={allTags.filter((t) => selectedTagsInBulk.includes(t.name))}
                colorOf={colorOf}
                onPick={(name) => onRemoveTag(name)}
                onClose={() => setUntagging(false)}
              />
            )}
          </div>
        )}
        <button
          onClick={() => onTogglePin(!allPinned)}
          title={allPinned ? "Unpin selected" : "Pin selected"}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          {allPinned ? (
            <>
              <PinOff className="h-3.5 w-3.5" /> Unpin
            </>
          ) : (
            <>
              <Pin className="h-3.5 w-3.5" /> {anyPinned ? "Pin all" : "Pin"}
            </>
          )}
        </button>
        <button
          onClick={onDelete}
          title="Delete selected"
          className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
        <button
          onClick={onClear}
          title="Clear selection (Esc)"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
