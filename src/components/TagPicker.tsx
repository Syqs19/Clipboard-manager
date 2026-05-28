import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";

/// Popover per selezionare un tag esistente o crearne uno nuovo.
/// `tags` = lista `[name, count, color, pinned]` (stesso formato dello store).
export function TagPicker({
  tags,
  excluded,
  colorOf,
  onPick,
  onClose,
}: {
  tags: [string, number, string | null, boolean][];
  excluded?: string[];
  colorOf: (name: string) => string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // chiude cliccando fuori
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const exclSet = useMemo(() => new Set(excluded ?? []), [excluded]);
  const norm = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      tags
        .filter(([n]) => !exclSet.has(n))
        .filter(([n]) => !norm || n.toLowerCase().includes(norm)),
    [tags, exclSet, norm],
  );
  const exactMatch = filtered.some(([n]) => n.toLowerCase() === norm);
  const canCreate = norm.length > 0 && !exactMatch;

  const commit = (name: string) => {
    const v = name.trim();
    if (!v) return;
    onPick(v);
    onClose();
  };

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="anim-scale-in absolute z-20 mt-1 w-56 origin-top-left rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 text-zinc-500" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[0]) commit(filtered[0][0]);
              else if (canCreate) commit(q);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="cerca o crea…"
          className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
        />
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 && !canCreate && (
          <div className="px-3 py-2 text-xs text-zinc-500">Nessun tag</div>
        )}
        {filtered.map(([name, count]) => (
          <button
            key={name}
            onClick={() => commit(name)}
            className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorOf(name) }}
            />
            <span className="flex-1 truncate">{name}</span>
            <span className="text-xs text-zinc-500">{count}</span>
          </button>
        ))}
        {canCreate && (
          <button
            onClick={() => commit(q)}
            className="flex w-full items-center gap-2 border-t border-zinc-800 px-2.5 py-1.5 text-left text-sm text-emerald-400 hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="truncate">Crea "{q.trim()}"</span>
          </button>
        )}
      </div>
    </div>
  );
}
