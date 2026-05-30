import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Clip, type SelectModifier, type Tag } from "../lib/api";
import { ClipCard } from "./ClipCard";

/// Etichetta del gruppo a cui appartiene una clip in base a pin/data.
function bucketOf(clip: Clip, now: Date): string {
  if (clip.pinned) return "Pinned";
  const d = new Date(clip.created_at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  // start of week = Monday (dow 0=Mon, ..., 6=Sun)
  const dow = (today.getDay() + 6) % 7;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dow);
  if (d >= startOfWeek) return "This week";
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (d >= startOfMonth) return "This month";
  return "Older";
}

/// Wrapper sortable per le card pinnate (usa dnd-kit/sortable).
/// Il drag parte solo dopo 8px di movimento (activationConstraint), così
/// un click breve resta un click — non avvia mai un drag.
function SortableCard({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  // droppable extra per ricevere il merge da una card non pinnata trascinata
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `card:${id}` });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setDropRef(el);
      }}
      style={style}
      className={`cursor-grab select-none rounded-xl active:cursor-grabbing ${
        isOver ? "ring-2 ring-accent/70" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/// Wrapper per le card non pinnate: draggable (per trascinarle su un tag o
/// su un'altra card per il merge) E droppable (per essere bersaglio di un
/// merge). Il drag parte dopo 8px, così un click breve resta un click.
function DraggableCard({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  // droppable separato per ricevere il merge da un'altra card non pinnata
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `card:${id}` });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setDropRef(el);
      }}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`cursor-grab select-none rounded-xl active:cursor-grabbing ${
        isOver ? "ring-2 ring-accent/70" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
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
  registerReorder,
  selectedIds,
  onBulkClick,
  selectModifier,
  selectionMode,
  allTags,
  onReveal,
  onCopyImageAsFile,
  onQuickOpen,
  onTransform,
  onOpenGroup,
  onPopoverOpenChange,
  highlightQuery,
  grouped = true,
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
  /// Espone al parent (App) l'handler di riordino pinnati: lo stato ottimistico
  /// resta qui dentro, mentre il DndContext vive in App.
  registerReorder: (fn: (activeId: number, overId: number) => void) => void;
  selectedIds: Set<number>;
  onBulkClick: (clipIndex: number, e: React.MouseEvent) => void;
  selectModifier: SelectModifier;
  selectionMode: boolean;
  allTags: Tag[];
  onReveal: (path: string) => void;
  onCopyImageAsFile: (id: number) => void;
  onQuickOpen: (clip: Clip) => void;
  onOpenGroup: (clip: Clip) => void;
  onTransform: (id: number, transform: string) => void;
  onPopoverOpenChange: (open: boolean) => void;
  highlightQuery: string;
  /// false in ricerca: lista piatta per pertinenza, senza header data né riordino pinnati.
  grouped?: boolean;
}) {
  // animazione di uscita: tengo gli id in via di eliminazione per ~240ms
  // così la classe `anim-clip-exit` gira prima del vero unmount.
  const [exitingIds, setExitingIds] = useState<Set<number>>(new Set());
  const animatedDelete = (id: number) => {
    setExitingIds((s) => new Set(s).add(id));
    window.setTimeout(() => {
      onDelete(id);
      setExitingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 240);
  };

  const realPinnedIds = clips.filter((c) => c.pinned).map((c) => c.id);

  // Update ottimistico del riordino: al drop applichiamo subito il nuovo
  // ordine in locale, così dnd-kit non vede la card "tornare indietro" nel
  // tempo che intercorre fra la chiamata al backend e il reload. Quando
  // l'ordine del parent coincide con il nostro, resettiamo lo stato locale.
  const [optimisticPinnedIds, setOptimisticPinnedIds] = useState<
    number[] | null
  >(null);
  useEffect(() => {
    if (optimisticPinnedIds == null) return;
    const same =
      optimisticPinnedIds.length === realPinnedIds.length &&
      optimisticPinnedIds.every((id, i) => id === realPinnedIds[i]);
    if (same) setOptimisticPinnedIds(null);
  }, [clips, optimisticPinnedIds]);
  const pinnedIds = optimisticPinnedIds ?? realPinnedIds;

  // Riordino visivo: sostituisco le posizioni delle clip pinnate seguendo
  // pinnedIds (preservando l'ordine delle non-pinnate).
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const reordered: Clip[] = [];
  let pinnedCursor = 0;
  for (const c of clips) {
    if (c.pinned) {
      const id = pinnedIds[pinnedCursor++];
      const replacement = clipById.get(id);
      if (replacement) reordered.push(replacement);
    } else {
      reordered.push(c);
    }
  }
  // in ricerca (flat) niente riordino dei pinnati: si tiene l'ordine per pertinenza
  const orderedClips = grouped ? reordered : clips;

  // Registra l'handler di riordino verso App: il DndContext è in App ma il
  // calcolo (arrayMove + stato ottimistico) resta qui. Rieseguo quando cambia
  // pinnedIds così la closure cattura sempre l'ordine corrente.
  useEffect(() => {
    registerReorder((activeId, overId) => {
      const oldIndex = pinnedIds.indexOf(activeId);
      const newIndex = pinnedIds.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      const next = arrayMove(pinnedIds, oldIndex, newIndex);
      setOptimisticPinnedIds(next);
      onReorderPinned(next);
    });
  }, [pinnedIds, registerReorder, onReorderPinned]);

  if (clips.length === 0) {
    return (
      <div className="anim-fade-in flex h-full flex-col items-center justify-center gap-3 text-zinc-600">
        <ClipboardList className="anim-pulse-soft h-10 w-10" />
        <p className="text-sm">No clips. Copy something to start.</p>
      </div>
    );
  }

  const now = new Date();
  let lastBucket = "";

  return (
    <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-2.5">
          {orderedClips.map((clip, i) => {
            const bucket = bucketOf(clip, now);
            const showHeader = grouped && bucket !== lastBucket;
            lastBucket = bucket;
            // slide-in solo per la clip "in cima" appena flashata (nuova
            // cattura o risalita per dedup)
            const justArrived = i === 0 && copiedId === clip.id;

            const card = (
              <ClipCard
                clip={clip}
                selected={i === selectedIndex}
                copied={clip.id === copiedId}
                keyHint={
                  i < 9 && clip.content_type !== "group" ? i + 1 : undefined
                }
                selectedForBulk={selectedIds.has(clip.id)}
                onSelect={() => onSelect(i)}
                colorOf={colorOf}
                onCopy={onCopy}
                onPreview={onPreview}
                onTogglePin={onTogglePin}
                onDelete={animatedDelete}
                onUpdate={onUpdate}
                onAddTag={onAddTag}
                onRemoveTag={onRemoveTag}
                onSetTagColor={onSetTagColor}
                onBulkClick={(e) => onBulkClick(i, e)}
                onReveal={onReveal}
                onCopyImageAsFile={onCopyImageAsFile}
                onQuickOpen={onQuickOpen}
                onOpenGroup={onOpenGroup}
                onTransform={onTransform}
                onPopoverOpenChange={onPopoverOpenChange}
                selectModifier={selectModifier}
                selectionMode={selectionMode}
                allTags={allTags}
                highlightQuery={highlightQuery}
              />
            );

            const exiting = exitingIds.has(clip.id);
            return (
              <div
                key={clip.id}
                className={`flex flex-col gap-2 ${justArrived ? "anim-slide-in-top" : ""} ${exiting ? "anim-clip-exit" : ""}`}
              >
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
                {clip.pinned && grouped ? (
                  <SortableCard id={clip.id}>{card}</SortableCard>
                ) : (
                  <DraggableCard id={clip.id}>{card}</DraggableCard>
                )}
              </div>
            );
          })}
      </div>
    </SortableContext>
  );
}
