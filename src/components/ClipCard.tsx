import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Pin, Plus, Trash2, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type Clip } from "../lib/api";
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
  onCopy,
  onPreview,
  onTogglePin,
  onDelete,
  onAddTag,
  onRemoveTag,
}: {
  clip: Clip;
  onCopy: (id: number) => void;
  onPreview: (clip: Clip) => void;
  onTogglePin: (clip: Clip) => void;
  onDelete: (id: number) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const masked = clip.sensitive && !revealed;
  const text = masked ? maskSensitive(clip.preview) : clip.preview;
  const isImage = clip.content_type === "image" && !!clip.image_path;

  const triggerCopy = () => {
    onCopy(clip.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 900);
  };

  const commitTag = () => {
    const name = tagInput.trim();
    if (name) onAddTag(clip.id, name);
    setTagInput("");
    setAdding(false);
  };

  return (
    <div
      onClick={() => (isImage ? onPreview(clip) : triggerCopy())}
      className={`group relative cursor-pointer rounded-lg border bg-zinc-800/30 p-3 transition-all hover:bg-zinc-800/60 ${
        copied
          ? "border-emerald-500/60 ring-1 ring-emerald-500/40"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      {isImage ? (
        <img
          src={convertFileSrc(clip.image_path!)}
          alt={clip.preview}
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
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {clip.pinned && <Pin className="h-3 w-3 fill-amber-400 text-amber-400" />}
        {clip.tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded bg-zinc-700/50 px-1.5 py-0.5 text-[11px] text-zinc-300"
          >
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

        {adding ? (
          <input
            autoFocus
            value={tagInput}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTag();
              } else if (e.key === "Escape") {
                setAdding(false);
                setTagInput("");
              }
            }}
            onBlur={() => (tagInput.trim() ? commitTag() : setAdding(false))}
            placeholder="nuovo tag…"
            className="w-24 rounded bg-zinc-700/60 px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none ring-1 ring-zinc-600"
          />
        ) : (
          <button
            title="Aggiungi tag"
            onClick={(e) => {
              e.stopPropagation();
              setAdding(true);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-dashed border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-500 opacity-0 transition-opacity hover:text-zinc-300 group-hover:opacity-100"
          >
            <Plus className="h-3 w-3" /> tag
          </button>
        )}

        <span className="ml-auto text-[11px] text-zinc-600">
          {relativeTime(clip.created_at)}
        </span>
      </div>

      {/* azioni in hover */}
      <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-zinc-900/90 p-0.5 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {clip.sensitive && (
          <IconButton
            title={revealed ? "Nascondi" : "Rivela"}
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </IconButton>
        )}
        <IconButton title="Copia" onClick={triggerCopy}>
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
