import { useEffect, useRef, useState } from "react";
import {
  Boxes,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  FolderOpen,
  Globe,
  Pencil,
  Pin,
  Plus,
  Trash2,
  Type,
  Wand2,
  X,
} from "lucide-react";
import { type Clip, type SelectModifier, type Tag } from "../lib/api";
import { TagPicker } from "./TagPicker";
import { TransformPicker } from "./TransformPicker";
import { CodeBlock } from "./CodeBlock";
import { GroupPreview } from "./GroupPreview";
import {
  detectColors,
  maskSensitive,
  relativeTime,
  splitMatches,
} from "../lib/format";
import { useImageUrl } from "../lib/useImageUrl";

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
  keyHint,
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
  onReveal,
  onCopyImageAsFile,
  onQuickOpen,
  onTransform,
  onOpenGroup,
  onPopoverOpenChange,
  selectModifier,
  selectionMode,
  allTags,
  highlightQuery,
}: {
  clip: Clip;
  selected: boolean;
  copied: boolean;
  keyHint?: number;
  selectedForBulk?: boolean;
  onSelect: () => void;
  colorOf: (name: string) => string;
  onCopy: (id: number, asPlain?: boolean) => void;
  onPreview: (clip: Clip) => void;
  onTogglePin: (clip: Clip) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, content: string) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
  onSetTagColor: (name: string, color: string) => void;
  onBulkClick?: (e: React.MouseEvent) => void;
  onReveal?: (path: string) => void;
  onCopyImageAsFile?: (id: number) => void;
  onQuickOpen?: (clip: Clip) => void;
  onTransform?: (id: number, transform: string) => void;
  onOpenGroup?: (clip: Clip) => void;
  onPopoverOpenChange?: (open: boolean) => void;
  selectModifier?: SelectModifier;
  selectionMode?: boolean;
  allTags: Tag[];
  highlightQuery?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) rootRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // segnala al parent quando il popover "Copy as…" è aperto, così la
  // navigazione ↑↓ della lista viene sospesa finché il menu è visibile
  useEffect(() => {
    onPopoverOpenChange?.(transforming);
    return () => onPopoverOpenChange?.(false);
  }, [transforming]);

  const masked = clip.sensitive && !revealed;
  const text = masked ? maskSensitive(clip.preview) : clip.preview;
  const isImage = clip.content_type === "image" && !!clip.image_path;
  const isFiles = clip.content_type === "files";
  const isGroup = clip.content_type === "group";
  const groupItems = clip.items ?? [];
  // clip di codice (tag automatico "Code"): syntax highlighting nell'anteprima,
  // ma solo senza ricerca attiva (l'highlight dei match userebbe gli stessi nodi)
  const isCode = clip.tags.includes("Code");
  // i PNG su disco sono cifrati: il backend li decifra e li serve come blob
  const thumbUrl = useImageUrl(
    isImage ? clip.thumb_path ?? clip.image_path : null,
  );
  const hasHtml = !!clip.content_html && !isImage && !isFiles;
  const hasRtf = !!clip.content_rtf && !isImage && !isFiles;
  const hasRich = hasHtml || hasRtf;
  // per i file, content è un JSON array di path
  const filePaths: string[] = (() => {
    if (!isFiles || !clip.content) return [];
    try {
      const v = JSON.parse(clip.content);
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  })();

  // azione rapida in base al tipo: link → browser, file → apri
  const quick = (() => {
    if (clip.content_type === "url")
      return { title: "Open in browser", icon: <Globe className="h-4 w-4" /> };
    if (isFiles && filePaths[0])
      return { title: "Open file", icon: <ExternalLink className="h-4 w-4" /> };
    return null;
  })();

  const startEdit = () => {
    setEditValue(clip.content ?? "");
    setEditing(true);
  };
  const saveEdit = () => {
    if (editValue.trim()) onUpdate(clip.id, editValue);
    setEditing(false);
  };

  // Rende il testo del clip intrecciando: pallini-colore davanti a ogni
  // valore-colore CSS rilevato (#hex/rgb/hsl) e highlight giallo dei match di
  // ricerca. Lo swatch è grande abbastanza da distinguere bene la tinta.
  const renderText = (value: string) => {
    const colors = detectColors(value);
    const out: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;

    const pushPlain = (chunk: string) => {
      if (!chunk) return;
      if (highlightQuery && highlightQuery.trim()) {
        for (const seg of splitMatches(chunk, highlightQuery)) {
          out.push(
            seg.match ? (
              <mark
                key={key++}
                className="rounded bg-amber-400/30 px-0.5 text-amber-100"
              >
                {seg.text}
              </mark>
            ) : (
              <span key={key++}>{seg.text}</span>
            ),
          );
        }
      } else {
        out.push(<span key={key++}>{chunk}</span>);
      }
    };

    for (const c of colors) {
      pushPlain(value.slice(cursor, c.start));
      out.push(
        <span
          key={key++}
          title={c.css}
          style={{ backgroundColor: c.css }}
          className="mr-1.5 inline-block h-4 w-4 shrink-0 -translate-y-px rounded border border-zinc-600/80 align-middle"
        />,
      );
      pushPlain(value.slice(c.start, c.end));
      cursor = c.end;
    }
    pushPlain(value.slice(cursor));
    return out;
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
    if (isGroup) onOpenGroup?.(clip);
    else if (isImage) onPreview(clip);
    else onCopy(clip.id);
  };

  return (
    <div
      ref={rootRef}
      onClick={handleCardClick}
      // il popover "Copy as…" vive nelle hover-actions: se il mouse lascia la
      // card va chiuso davvero, altrimenti resterebbe montato (invisibile) e
      // riapparirebbe al successivo hover
      onMouseLeave={() => transforming && setTransforming(false)}
      // viewTransitionName univoco per ogni clip: il browser anima le
      // card che cambiano posizione (riordino drag&drop dei fissati).
      style={{ viewTransitionName: `clip-${clip.id}` }}
      className={`card-lift group relative rounded-xl border bg-zinc-800/40 p-3 ${
        adding || transforming ? "z-30" : ""
      } ${
        editing ? "" : "cursor-pointer hover:bg-zinc-800/70"
      } ${
        selectedForBulk
          ? "glow-emerald scale-[0.98] border-emerald-500/70 bg-emerald-500/5"
          : copied
            ? "glow-emerald border-emerald-500/60"
            : selected
              ? "border-zinc-600 bg-zinc-800/60 ring-1 ring-zinc-500/40"
              : "border-zinc-800/60 hover:border-zinc-700/80"
      }`}
    >
      {/* barra in testa: badge tastiera a sinistra, azioni a destra (in hover).
          In flusso normale (non overlay) così il contenuto non viene mai coperto. */}
      {!editing && !selectionMode && (
        <div className="mb-1.5 flex h-7 items-center gap-2">
          {keyHint !== undefined ? (
            <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-700 bg-zinc-900/80 text-[10px] font-semibold text-zinc-400">
              {keyHint}
            </div>
          ) : (
            <span className="w-0" />
          )}
          <div className="ml-auto flex items-center gap-0.5 rounded-lg bg-zinc-900/60 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {quick && onQuickOpen && (
              <IconButton title={quick.title} onClick={() => onQuickOpen(clip)}>
                {quick.icon}
              </IconButton>
            )}
            {clip.sensitive && (
              <IconButton
                title={revealed ? "Hide" : "Reveal"}
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </IconButton>
            )}
            {!isImage && !isFiles && !isGroup && (
              <IconButton title="Edit" onClick={startEdit}>
                <Pencil className="h-4 w-4" />
              </IconButton>
            )}
            {/* "Apri posizione" disponibile solo per i file copiati dall'Explorer:
                i PNG delle immagini sono cifrati su disco, mostrarli in Esplora
                non avrebbe senso */}
            {isFiles && onReveal && filePaths[0] && (
              <IconButton
                title="Open location"
                onClick={() => onReveal(filePaths[0])}
              >
                <FolderOpen className="h-4 w-4" />
              </IconButton>
            )}
            {isImage && onCopyImageAsFile && (
              <IconButton
                title="Copy as file (paste into a folder with Ctrl+V)"
                onClick={() => onCopyImageAsFile(clip.id)}
              >
                <FileDown className="h-4 w-4" />
              </IconButton>
            )}
            {onTransform && !isFiles && !isGroup && (
              <div className="relative">
                <IconButton
                  title="Copy as…"
                  onClick={() => setTransforming((v) => !v)}
                >
                  <Wand2 className="h-4 w-4" />
                </IconButton>
                {transforming && (
                  <TransformPicker
                    isImage={isImage}
                    content={clip.content}
                    onPick={(t) => onTransform(clip.id, t)}
                    onClose={() => setTransforming(false)}
                  />
                )}
              </div>
            )}
            {isGroup ? (
              <IconButton title="Open group" onClick={() => onOpenGroup?.(clip)}>
                <Boxes className="h-4 w-4" />
              </IconButton>
            ) : (
              <IconButton
                title={hasRich ? "Copy with formatting" : "Copy"}
                onClick={() => onCopy(clip.id)}
              >
                <Copy className="h-4 w-4" />
              </IconButton>
            )}
            {!isGroup && hasRich && (
              <IconButton
                title="Copy as plain text"
                onClick={() => onCopy(clip.id, true)}
              >
                <Type className="h-4 w-4" />
              </IconButton>
            )}
            <IconButton
              title={clip.pinned ? "Unpin" : "Pin"}
              onClick={() => onTogglePin(clip)}
            >
              <Pin
                className={`h-4 w-4 ${
                  clip.pinned ? "fill-amber-400 text-amber-400" : ""
                }`}
              />
            </IconButton>
            <IconButton title="Delete" danger onClick={() => onDelete(clip.id)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      )}

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
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300"
            >
              Cancel
            </button>
            <span className="ml-auto text-[11px] text-zinc-600">
              Ctrl+Enter to save
            </span>
          </div>
        </div>
      ) : isGroup ? (
        <GroupPreview items={groupItems} />
      ) : isImage ? (
        thumbUrl ? (
          // altezza massima fissa con ritaglio dall'alto: immagini molto alte
          // (es. screenshot lunghi) non invadono la lista — l'intera immagine
          // resta visibile aprendo il preview. object-cover evita le "strisce".
          <div className="max-h-[190px] w-fit max-w-full overflow-hidden rounded border border-zinc-700">
            <img
              src={thumbUrl}
              alt={clip.preview}
              draggable={false}
              className="max-h-[190px] w-auto object-cover object-top"
            />
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center rounded border border-dashed border-zinc-700 text-xs text-zinc-500">
            {clip.preview}
          </div>
        )
      ) : isFiles ? (
        <div className="flex flex-col gap-1">
          {filePaths.slice(0, 4).map((p) => {
            const name = p.split(/[\\/]/).pop() || p;
            return (
              <div
                key={p}
                className="flex items-center gap-2 text-sm text-zinc-100"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={p}
                >
                  {name}
                </span>
              </div>
            );
          })}
          {filePaths.length > 4 && (
            <div className="text-xs text-zinc-500">
              + {filePaths.length - 4} more
            </div>
          )}
        </div>
      ) : isCode && !masked && text && !(highlightQuery && highlightQuery.trim()) ? (
        <CodeBlock code={text} />
      ) : (
        <p
          // key cambia ad ogni toggle mask/reveal → la fade-in riparte
          key={masked ? "mask" : "reveal"}
          className={`anim-fade-in line-clamp-3 whitespace-pre-wrap break-words text-sm ${
            masked ? "font-mono tracking-wide text-zinc-400" : "text-zinc-100"
          }`}
        >
          {!text ? "(empty)" : masked ? text : renderText(text)}
        </p>
      )}

      {/* tag + meta */}
      {!editing && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {clip.pinned && (
            <Pin className="h-3 w-3 fill-amber-400 text-amber-400" />
          )}
          {hasRich && (
            <span
              title={
                hasHtml && hasRtf
                  ? "Contains HTML and RTF formatting"
                  : hasHtml
                    ? "Contains HTML formatting"
                    : "Contains RTF formatting"
              }
              className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300"
            >
              {hasHtml && hasRtf ? "HTML+RTF" : hasHtml ? "HTML" : "RTF"}
            </span>
          )}
          {clip.tags.map((t) => (
            <span
              key={t}
              className="anim-pop inline-flex max-w-[12rem] items-center gap-1 rounded bg-zinc-700/50 px-1.5 py-0.5 text-[11px] text-zinc-300"
            >
              <input
                type="color"
                value={colorOf(t)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onSetTagColor(t, e.target.value)}
                title="Tag color"
                className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full"
              />
              <span className="truncate" title={t}>
                {t}
              </span>
              <button
                title="Remove tag"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveTag(clip.id, t);
                }}
                className="shrink-0 text-zinc-500 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}

          <div className="relative">
            <button
              title="Add tag"
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

      {/* checkbox in modalità selezione: piccolo bounce al toggle */}
      {selectionMode && !editing && (
        <div className="absolute right-2 top-2 text-emerald-400">
          {selectedForBulk ? (
            <CheckCircle2
              key="checked"
              className="anim-pop h-5 w-5 fill-emerald-500/20"
            />
          ) : (
            <Circle key="unchecked" className="h-5 w-5 text-zinc-500" />
          )}
        </div>
      )}

      {/* overlay "Copiato" — easing back-out per un'entrata "viva" senza essere vistosa */}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
          copied ? "opacity-100" : "opacity-0"
        }`}
      >
        <span
          className={`ease-back-out flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white shadow-lg transition-transform duration-500 ${
            copied ? "scale-100" : "scale-50"
          }`}
        >
          <Check className="h-3.5 w-3.5" /> Copied
        </span>
      </div>
    </div>
  );
}
