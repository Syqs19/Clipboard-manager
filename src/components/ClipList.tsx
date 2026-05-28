import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { type Clip, type SelectModifier } from "../lib/api";
import { ClipCard } from "./ClipCard";

/// Etichetta del gruppo a cui appartiene una clip in base a pin/data.
function bucketOf(clip: Clip, now: Date): string {
  if (clip.pinned) return "Fissati";
  const d = new Date(clip.created_at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d >= today) return "Oggi";
  if (d >= yesterday) return "Ieri";
  // inizio settimana = lunedì (dow 0=lun, ..., 6=dom)
  const dow = (today.getDay() + 6) % 7;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dow);
  if (d >= startOfWeek) return "Questa settimana";
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (d >= startOfMonth) return "Questo mese";
  return "Più vecchi";
}

export function ClipList({
  clips,
  selectedIndex,
  copiedId,
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
  onReorderPinned,
  selectedIds,
  onBulkClick,
  selectModifier,
  selectionMode,
  allTags,
}: {
  clips: Clip[];
  selectedIndex: number;
  copiedId: number | null;
  onSelect: (index: number) => void;
  colorOf: (name: string) => string;
  onCopy: (id: number, asPlain?: boolean) => void;
  onPreview: (clip: Clip) => void;
  onTogglePin: (clip: Clip) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, content: string) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
  onSetTagColor: (name: string, color: string) => void;
  onReorderPinned: (ids: number[]) => void;
  selectedIds: Set<number>;
  onBulkClick: (clipIndex: number, e: React.MouseEvent) => void;
  selectModifier: SelectModifier;
  selectionMode: boolean;
  allTags: [string, number, string | null, boolean][];
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const pinnedIds = clips.filter((c) => c.pinned).map((c) => c.id);

  const dropOnPinned = (targetId: number) => {
    const src = dragId;
    setDragId(null);
    setDragOverId(null);
    if (src == null || src === targetId) return;
    const from = pinnedIds.indexOf(src);
    const to = pinnedIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...pinnedIds];
    next.splice(from, 1);
    next.splice(to, 0, src);
    onReorderPinned(next);
  };
  if (clips.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-600">
        <ClipboardList className="h-10 w-10" />
        <p className="text-sm">Nessuna clip. Copia qualcosa per iniziare.</p>
      </div>
    );
  }

  const now = new Date();
  let lastBucket = "";

  return (
    <div
      className="flex flex-col gap-2"
      // accetta il drag in tutta l'area lista così il cursore resta "move";
      // il vero target di drop sono le singole card pinnate sotto.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setDragId(null);
        setDragOverId(null);
      }}
    >
      {clips.map((clip, i) => {
        const bucket = bucketOf(clip, now);
        const showHeader = bucket !== lastBucket;
        lastBucket = bucket;
        const draggable = clip.pinned;
        const isDragOver = draggable && dragOverId === clip.id && dragId !== clip.id;
        return (
          <div key={clip.id} className="flex flex-col gap-2">
            {showHeader && (
              <div
                className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300 ${
                  i === 0 ? "" : "pt-3"
                }`}
              >
                <span>{bucket}</span>
                <span className="h-px flex-1 bg-zinc-800" />
              </div>
            )}
            <div
              draggable={draggable}
              onDragStart={
                draggable
                  ? (e) => {
                      setDragId(clip.id);
                      e.dataTransfer.effectAllowed = "move";
                      // serve setData per avviare il drag su Chromium
                      e.dataTransfer.setData("text/plain", String(clip.id));
                    }
                  : undefined
              }
              onDragOver={
                draggable
                  ? (e) => {
                      // preventDefault DEVE essere chiamato sempre, prima dei check,
                      // altrimenti il browser mostra il cursore "divieto"
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (
                        dragId != null &&
                        dragId !== clip.id &&
                        dragOverId !== clip.id
                      ) {
                        setDragOverId(clip.id);
                      }
                    }
                  : undefined
              }
              onDragLeave={
                draggable
                  ? () => {
                      if (dragOverId === clip.id) setDragOverId(null);
                    }
                  : undefined
              }
              onDrop={
                draggable
                  ? (e) => {
                      e.preventDefault();
                      dropOnPinned(clip.id);
                    }
                  : undefined
              }
              onDragEnd={() => {
                setDragId(null);
                setDragOverId(null);
              }}
              className={`rounded-lg transition-shadow ${
                draggable ? "cursor-move select-none" : ""
              } ${isDragOver ? "ring-2 ring-emerald-500/70" : ""} ${
                dragId === clip.id ? "opacity-50" : ""
              }`}
            >
              <ClipCard
                clip={clip}
                selected={i === selectedIndex}
                copied={clip.id === copiedId}
                selectedForBulk={selectedIds.has(clip.id)}
                onSelect={() => onSelect(i)}
                colorOf={colorOf}
                onCopy={onCopy}
                onPreview={onPreview}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
                onUpdate={onUpdate}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
                onSetTagColor={onSetTagColor}
                onBulkClick={(e) => onBulkClick(i, e)}
                selectModifier={selectModifier}
                selectionMode={selectionMode}
                allTags={allTags}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
