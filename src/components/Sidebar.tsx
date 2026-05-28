import { Clock, Pin, Image, Star } from "lucide-react";
import { tagColor } from "../lib/format";

export type Filter =
  | { kind: "all" }
  | { kind: "pinned" }
  | { kind: "images" }
  | { kind: "tag"; name: string };

function sameFilter(a: Filter, b: Filter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "tag" && b.kind === "tag") return a.name === b.name;
  return true;
}

function Item({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-zinc-700/60 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
      }`}
    >
      <span className="text-zinc-500">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-zinc-500">{count}</span>
      )}
    </button>
  );
}

function TagRow({
  name,
  count,
  color,
  pinned,
  active,
  onSelect,
  onSetColor,
  onTogglePinned,
}: {
  name: string;
  count: number;
  color: string;
  pinned: boolean;
  active: boolean;
  onSelect: () => void;
  onSetColor: (color: string) => void;
  onTogglePinned: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-zinc-700/60 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
      }`}
    >
      {/* color picker nativo (ruota colori completa) */}
      <input
        type="color"
        value={color}
        onChange={(e) => onSetColor(e.target.value)}
        title="Scegli un colore"
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full"
      />
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="flex-1 truncate">{name}</span>
        <span className="text-xs text-zinc-500">{count}</span>
      </button>
      <button
        onClick={onTogglePinned}
        title={pinned ? "Rimuovi dai tag fissati" : "Fissa il tag"}
        className={`shrink-0 transition-opacity ${
          pinned
            ? "text-amber-400"
            : "text-zinc-600 opacity-0 hover:text-zinc-300 group-hover:opacity-100"
        }`}
      >
        <Star
          className={`h-3.5 w-3.5 ${pinned ? "fill-amber-400" : ""}`}
        />
      </button>
    </div>
  );
}

export function Sidebar({
  filter,
  onSelect,
  tags,
  pinnedCount,
  imageCount,
  totalCount,
  onSetTagColor,
  onSetTagPinned,
}: {
  filter: Filter;
  onSelect: (f: Filter) => void;
  tags: [string, number, string | null, boolean][];
  pinnedCount: number;
  imageCount: number;
  totalCount: number;
  onSetTagColor: (name: string, color: string) => void;
  onSetTagPinned: (name: string, pinned: boolean) => void;
}) {
  const pinnedTags = tags.filter(([, , , p]) => p);
  const otherTags = tags.filter(([, , , p]) => !p);
  const renderTag = (
    [name, count, color, pinned]: [string, number, string | null, boolean],
  ) => (
    <TagRow
      key={name}
      name={name}
      count={count}
      color={tagColor(name, color)}
      pinned={pinned}
      active={sameFilter(filter, { kind: "tag", name })}
      onSelect={() => onSelect({ kind: "tag", name })}
      onSetColor={(c) => onSetTagColor(name, c)}
      onTogglePinned={() => onSetTagPinned(name, !pinned)}
    />
  );
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col gap-4 border-r border-zinc-800 bg-zinc-900/50 p-3">
      <div className="px-1 text-sm font-semibold text-zinc-200">Clipboard</div>

      <nav className="flex flex-col gap-0.5">
        <Item
          active={sameFilter(filter, { kind: "pinned" })}
          onClick={() => onSelect({ kind: "pinned" })}
          icon={<Pin className="h-4 w-4" />}
          label="Fissati"
          count={pinnedCount}
        />
        <Item
          active={sameFilter(filter, { kind: "images" })}
          onClick={() => onSelect({ kind: "images" })}
          icon={<Image className="h-4 w-4" />}
          label="Immagini"
          count={imageCount}
        />
        <Item
          active={sameFilter(filter, { kind: "all" })}
          onClick={() => onSelect({ kind: "all" })}
          icon={<Clock className="h-4 w-4" />}
          label="Cronologia"
          count={totalCount}
        />
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {pinnedTags.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-600">
              Fissati
            </div>
            {pinnedTags.map(renderTag)}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-600">
            Categorie
          </div>
          {otherTags.length === 0 && tags.length === 0 && (
            <div className="px-2.5 py-1 text-xs text-zinc-600">nessuna</div>
          )}
          {otherTags.map(renderTag)}
        </div>
      </div>
    </aside>
  );
}
