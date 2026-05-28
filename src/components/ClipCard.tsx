import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type Clip, type SelectModifier } from "../lib/api";
import { TagPicker } from "./TagPicker";
import { maskSensitive, relativeTime } from "../lib/format";

function IconButton({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700/70 ${
        danger ? "hover:text-red-400" : "hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

export function ClipCard({
  clip,
  selected,
  copied,
  selectedForBulk,
  onSelect,
  colorOf,
  onCopy,
  onPreview,
  onTogglePin,
  onDelete,
  onUpdate,
  onAddTag,
  onRemoveTag,
  onSetTagColor,
  onBulkClick,
  selectModifier,
  selectionMode,
  allTags,
}: {
  clip: Clip;
  selected: boolean;
  copied: boolean;
  selectedForBulk?: boolean;
  onSelect: () => void;
  colorOf: (name: string) => string;
  onCopy: (id: number) => void;
  onPreview: (clip: Clip) => void;
  onTogglePin: (clip: Clip) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, content: string) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
  onSetTagColor: (name: string, color: string) => void;
  onBulkClick?: (e: React.MouseEvent) => void;
  selectModifier?: SelectModifier;
  selectionMode?: boolean;
  allTags: [string, number, string | null, boolean][];
}) {
  const [revealed, setRevealed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const masked = clip.sensitive && !revealed;
  const text = masked ? maskSensitive(clip.preview) : clip.preview;
  const isImage = clip.content_type === "image" && !!clip.image_path;

  const startEdit = () => {
    setEditValue(clip.content ?? "");
    setEditing(true);
  };
  const saveEdit = () => {
    if (editValue.trim()) onUpdate(clip.id, editValue);
    setEditing(false);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (editing) return;
    // in modalità selezione: qualsiasi click toggla la selezione (no copia/preview)
    if (selectionMode) {
      onBulkClick?.(e);
      return;
    }
    // fuori dalla modalità selezione: il modifier scelto attiva il bulk;
    // Shift+click resta sempre attivo per l'estensione del range.
    const mod = selectModifier ?? "ctrl";
    const bulkHit =
      e.shiftKey ||
      (mod === "ctrl" && (e.ctrlKey || e.metaKey)) ||
      (mod === "alt" && e.altKey);
    if (bulkHit) {
      onBulkClick?.(e);
      return;
    }
    onSelect(); // sincronizza la selezione da tastiera col click
    if (isImage) onPreview(clip);
    else onCopy(clip.id);
  };

  return (
    <div
      ref={rootRef}
      onClick={handleCardClick}
      className={`group relative rounded-lg border bg-zinc-800/30 p-3 transition-all ${
        editing ? "" : "cursor-pointer hover:bg-zinc-800/60"
      } ${
        selectedForBulk
          ? "border-emerald-500/70 bg-emerald-500/5 ring-1 ring-emerald-500/40"
          : copied
            ? "border-emerald-500/60 ring-1 ring-emerald-500/40"
            : selected
              ? "border-zinc-600 ring-1 ring-zinc-500/50"
              : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      {editing ? (
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            rows={4}
            className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 outline-none focus:border-zinc-600"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveEdit}
              className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-400"
            >
              Salva
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300"
            >
              Annulla
            </button>
            <span className="ml-auto text-[11px] text-zinc-600">
              Ctrl+Invio per salvare
            </span>
          </div>
        </div>
      ) : isImage ? (
        <img
          src={convertFileSrc(clip.thumb_path ?? clip.image_path!)}
          alt={clip.preview}
          draggable={false}
          className="max-h-40 w-auto rounded border border-zinc-700 object-contain"
        />
      ) : (
        <p
          className={`line-clamp-3 whitespace-pre-wrap break-words text-sm ${
            masked ? "font-mono tracking-wide text-zinc-400" : "text-zinc-100"
          }`}
        >
          {text || "(vuoto)"}
        </p>
      )}

      {/* tag + meta */}
      {!editing && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {clip.pinned && (
            <Pin className="h-3 w-3 fill-amber-400 text-amber-400" />
          )}
          {clip.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded bg-zinc-700/50 px-1.5 py-0.5 text-[11px] text-zinc-300"
            >
              <input
                type="color"
                value={colorOf(t)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onSetTagColor(t, e.target.value)}
                title="Colore tag"
                className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full"
              />
              {t}
              <button
                title="Rimuovi tag"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveTag(clip.id, t);
                }}
                className="text-zinc-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          <div className="relative">
            <button
              title="Aggiungi tag"
              onClick={(e) => {
                e.stopPropagation();
                setAdding((v) => !v);
              }}
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-500 opacity-0 transition-opacity hover:text-zinc-300 group-hover:opacity-100"
            >
              <Plus className="h-3 w-3" /> tag
            </button>
            {adding && (
              <TagPicker
                tags={allTags}
                excluded={clip.tags}
                colorOf={colorOf}
                onPick={(name) => onAddTag(clip.id, name)}
                onClose={() => setAdding(false)}
              />
            )}
          </div>

          <span className="ml-auto text-[11px] text-zinc-600">
            {relativeTime(clip.created_at)}
          </span>
        </div>
      )}

      {/* checkbox in modalità selezione */}
      {selectionMode && !editing && (
        <div className="absolute right-2 top-2 text-emerald-400">
          {selectedForBulk ? (
            <CheckCircle2 className="h-5 w-5 fill-emerald-500/20" />
          ) : (
            <Circle className="h-5 w-5 text-zinc-500" />
          )}
        </div>
      )}

      {/* azioni in hover (nascoste durante la modalità selezione) */}
      {!editing && !selectionMode && (
        <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-zinc-900/90 p-0.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {clip.sensitive && (
            <IconButton
              title={revealed ? "Nascondi" : "Rivela"}
              onClick={() => setRevealed((r) => !r)}
            >
              {revealed ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </IconButton>
          )}
          {!isImage && (
            <IconButton title="Modifica" onClick={startEdit}>
              <Pencil className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton title="Copia" onClick={() => onCopy(clip.id)}>
            <Copy className="h-4 w-4" />
          </IconButton>
          <IconButton
            title={clip.pinned ? "Rimuovi dai fissati" : "Fissa"}
            onClick={() => onTogglePin(clip)}
          >
            <Pin
              className={`h-4 w-4 ${
                clip.pinned ? "fill-amber-400 text-amber-400" : ""
              }`}
            />
          </IconButton>
          <IconButton title="Elimina" danger onClick={() => onDelete(clip.id)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      )}

      {/* overlay "Copiato" */}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
          copied ? "opacity-100" : "opacity-0"
        }`}
      >
        <span
          className={`flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white shadow-lg transition-transform duration-200 ${
            copied ? "scale-100" : "scale-90"
          }`}
        >
          <Check className="h-3.5 w-3.5" /> Copiato
        </span>
      </div>
    </div>
  );
}
