import { useMemo, useState } from "react";
import { ChevronLeft, Search, Star, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useToolPrefs } from "../tools/useToolPrefs";
import type { ToolDescriptor } from "../tools/types";
import { ToolCard } from "./ToolCard";

/// Wrapper sortable di una ToolCard: il drag parte dopo 8px (soglia del sensor),
/// così un click breve apre il tool invece di iniziare un riordino.
function SortableToolCard({
  tool,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  tool: ToolDescriptor;
  favorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tool.id });
  // scarta role/tabIndex degli attributes di dnd-kit: ToolCard è già un
  // role="button" tabbabile con il suo onKeyDown, quindi metterli anche sul
  // wrapper darebbe due button annidati e due tab stop per la stessa card.
  // Gli aria-* di dnd-kit restano.
  const { role: _role, tabIndex: _tabIndex, ...a11y } = attributes;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...a11y} {...listeners}>
      <ToolCard
        tool={tool}
        favorite={favorite}
        onOpen={onOpen}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}

/// Contenitore della macro-sezione Tools: griglia di card (dashboard) che
/// aprono un tool a tutto schermo. Lo stato "quale tool è aperto" vive QUI,
/// così App.tsx non sa nulla dei singoli tool. Ordine e preferiti sono
/// persistiti via useToolPrefs (settings.json). Il riordino usa un DndContext
/// DEDICATO, isolato da quello delle clip in App.
/// Testo su cui cercare un tool: nome + descrizione + keyword, minuscolo.
function haystack(tool: ToolDescriptor): string {
  return [tool.label, tool.description, ...(tool.keywords ?? [])]
    .join(" ")
    .toLowerCase();
}

/// Un tool matcha la query se OGNI termine (separato da spazi) compare nel suo
/// testo di ricerca. Così "json convert" restringe, non allarga.
export function matchesQuery(tool: ToolDescriptor, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(tool);
  return terms.every((t) => hay.includes(t));
}

export function ToolsSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const { orderedTools, favorites, reorder, toggleFavorite } = useToolPrefs();
  // drag dopo 8px → un click breve resta un click (apre il tool)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  // risultati della ricerca (solo quando c'è una query); mantiene l'ordine personalizzato.
  const results = useMemo(
    () => (searching ? orderedTools.filter((t) => matchesQuery(t, trimmed)) : []),
    [searching, trimmed, orderedTools],
  );

  const openTool = openId
    ? orderedTools.find((t) => t.id === openId) ?? null
    : null;

  if (openTool) {
    const Tool = openTool.component;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2">
          <button
            onClick={() => setOpenId(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100"
          >
            <ChevronLeft className="h-4 w-4" /> Tools
          </button>
          <span className="text-sm font-medium text-zinc-200">
            {openTool.label}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Tool />
        </div>
      </div>
    );
  }

  if (orderedTools.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="text-sm text-zinc-500">No tools yet.</p>
      </div>
    );
  }

  const favTools = orderedTools.filter((t) => favorites.includes(t.id));
  // "All tools" mostra solo i NON preferiti: un tool che è nei Favorites non
  // compare anche qui (niente doppione).
  const otherTools = orderedTools.filter((t) => !favorites.includes(t.id));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  }

  const gridClass =
    "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3";
  const hasFav = favTools.length > 0;

  // barra di ricerca dei tool (filtra su nome/descrizione/keyword)
  const searchBar = (
    <div className="relative mb-4">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tools (try “png”, “json”, “hash”)…"
        className="w-full rounded-lg border border-zinc-700/60 bg-zinc-900/60 py-2 pl-9 pr-9 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-accent/50 focus:outline-none"
      />
      {searching && (
        <button
          onClick={() => setQuery("")}
          title="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  // ricerca attiva: griglia piatta filtrata (niente sezioni/riordino — durante
  // una ricerca non avrebbero senso). Mostra anche i preferiti, qui mescolati.
  if (searching) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {searchBar}
        {results.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No tools match “{trimmed}”.
          </p>
        ) : (
          <div className={gridClass}>
            {results.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                favorite={favorites.includes(tool.id)}
                onOpen={() => setOpenId(tool.id)}
                onToggleFavorite={() => toggleFavorite(tool.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {searchBar}
      {/* sezione Favorites: solo se c'è almeno un preferito. */}
      {hasFav && (
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <Star className="h-3.5 w-3.5 text-amber-400" fill="currentColor" />
            Favorites
          </div>
          <div className={gridClass}>
            {favTools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                favorite
                onOpen={() => setOpenId(tool.id)}
                onToggleFavorite={() => toggleFavorite(tool.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* tool non preferiti: riordinabili via drag (DndContext dedicato).
          L'header diventa "Other tools" se ci sono già dei preferiti sopra. */}
      {otherTools.length > 0 && (
        <>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {hasFav ? "Other tools" : "All tools"}
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={otherTools.map((t) => t.id)}
              strategy={rectSortingStrategy}
            >
              <div className={gridClass}>
                {otherTools.map((tool) => (
                  <SortableToolCard
                    key={tool.id}
                    tool={tool}
                    favorite={false}
                    onOpen={() => setOpenId(tool.id)}
                    onToggleFavorite={() => toggleFavorite(tool.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}
    </div>
  );
}
