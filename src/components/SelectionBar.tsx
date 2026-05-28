import { useState } from "react";
import { Pin, PinOff, Tag, Trash2, X } from "lucide-react";

/// Barra di azioni in cima alla lista quando l'utente ha selezionato 1+ clip
/// con Ctrl/Shift+click. Elimina, pinna/despinna, aggiungi tag, deseleziona.
export function SelectionBar({
  count,
  anyPinned,
  allPinned,
  onClear,
  onDelete,
  onTogglePin,
  onAddTag,
}: {
  count: number;
  anyPinned: boolean;
  allPinned: boolean;
  onClear: () => void;
  onDelete: () => void;
  onTogglePin: (pin: boolean) => void;
  onAddTag: (name: string) => void;
}) {
  const [tagging, setTagging] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const commitTag = () => {
    const name = tagInput.trim();
    if (name) onAddTag(name);
    setTagInput("");
    setTagging(false);
  };

  return (
    <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-zinc-900/95 px-3 py-2 shadow-md backdrop-blur">
      <span className="text-sm text-zinc-100">
        {count} selezionate
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        {tagging ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTag();
                else if (e.key === "Escape") {
                  setTagging(false);
                  setTagInput("");
                }
              }}
              placeholder="nome tag"
              className="w-32 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-600"
            />
            <button
              onClick={commitTag}
              className="rounded-md bg-emerald-500/90 px-2 py-1 text-xs text-white hover:bg-emerald-500"
            >
              OK
            </button>
          </div>
        ) : (
          <button
            onClick={() => setTagging(true)}
            title="Aggiungi tag alle selezionate"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <Tag className="h-3.5 w-3.5" /> Tag
          </button>
        )}
        <button
          onClick={() => onTogglePin(!allPinned)}
          title={allPinned ? "Despinna selezionate" : "Pinna selezionate"}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        >
          {allPinned ? (
            <>
              <PinOff className="h-3.5 w-3.5" /> Despinna
            </>
          ) : (
            <>
              <Pin className="h-3.5 w-3.5" /> {anyPinned ? "Pinna tutte" : "Pinna"}
            </>
          )}
        </button>
        <button
          onClick={onDelete}
          title="Elimina selezionate"
          className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Elimina
        </button>
        <button
          onClick={onClear}
          title="Annulla selezione (Esc)"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
