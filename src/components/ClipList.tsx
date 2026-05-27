import { ClipboardList } from "lucide-react";
import { type Clip } from "../lib/api";
import { ClipCard } from "./ClipCard";

export function ClipList({
  clips,
  onCopy,
  onTogglePin,
  onDelete,
  onAddTag,
  onRemoveTag,
}: {
  clips: Clip[];
  onCopy: (id: number) => void;
  onTogglePin: (clip: Clip) => void;
  onDelete: (id: number) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
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
      {clips.map((clip) => (
        <ClipCard
          key={clip.id}
          clip={clip}
          onCopy={onCopy}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
          onAddTag={onAddTag}
          onRemoveTag={onRemoveTag}
        />
      ))}
    </div>
  );
}
