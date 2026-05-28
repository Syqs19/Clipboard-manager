import { useState } from "react";
import { ClipboardList } from "lucide-react";
import { type Clip } from "../lib/api";
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
}: {
  clips: Clip[];
  selectedIndex: number;
  copiedId: number | null;
  onSelect: (index: number) => void;
  colorOf: (name: string) => string;
  onCopy: (id: number) => void;
  onPreview: (clip: Clip) => void;
  onTogglePin: (clip: Clip) => void;
  onDelete: (id: number) => void;
  onUpdate: (id: number, content: string) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
  onSetTagColor: (name: string, color: string) => void;
  onReorderPinned: (ids: number[]) => void;
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
    <div className="flex flex-col gap-2">
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
                className={`text-[11px] font-semibold uppercase tracking-wider text-zinc-500 ${
                  i === 0 ? "" : "pt-2"
                }`}
              >
                {bucket}
              </div>
            )}
            <div
              draggable={draggable}
              onDragStart={
                draggable
                  ? (e) => {
                      setDragId(clip.id);
                      e.dataTransfer.effectAllowed = "move";
                    }
                  : undefined
              }
              onDragOver={
                draggable
                  ? (e) => {
                      if (dragId == null || dragId === clip.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverId !== clip.id) setDragOverId(clip.id);
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
                isDragOver ? "ring-2 ring-emerald-500/70" : ""
              } ${dragId === clip.id ? "opacity-50" : ""}`}
            >
              <ClipCard
                clip={clip}
                selected={i === selectedIndex}
                copied={clip.id === copiedId}
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
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
