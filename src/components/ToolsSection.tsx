import { useState } from "react";
import { ChevronLeft, Star } from "lucide-react";
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
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
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
export function ToolsSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { orderedTools, favorites, reorder, toggleFavorite } = useToolPrefs();
  // drag dopo 8px → un click breve resta un click (apre il tool)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
