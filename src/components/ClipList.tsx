import { ClipboardList } from "lucide-react";
import { type Clip } from "../lib/api";
import { ClipCard } from "./ClipCard";

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
}) {
  if (clips.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-600">
        <ClipboardList className="h-10 w-10" />
        <p className="text-sm">Nessuna clip. Copia qualcosa per iniziare.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {clips.map((clip, i) => (
        <ClipCard
          key={clip.id}
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
      ))}
    </div>
  );
}
