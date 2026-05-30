import { useRef, useState } from "react";
import {
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { api, type Clip, type ContentType } from "../lib/api";

/// Vero mentre si trascina una card PINNATA: in quel caso il drag è un
/// riordino del sortable, quindi il detector ignora i bersagli `card:` (merge).
let draggingPinned = false;

/// Collision detection ibrida.
/// Per i tag: la hitbox è il rettangolo dell'OVERLAY reale (dove la card è
/// disegnata), non quello della card originale nella lista. snapCenterToCursor
/// centra l'overlay sul puntatore, quindi ricostruiamo lo stesso rettangolo
/// (dimensioni della card centrate su pointerCoordinates) e lo intersechiamo
/// con ogni riga-tag: basta 1px di sovrapposizione visiva. Niente più
/// attivazioni "da lontano" causate dalla larghezza piena della card.
/// Per il riordino card: closestCenter come prima (tag esclusi dai candidati).
export const collisionDetection: CollisionDetection = (args) => {
  const { pointerCoordinates, droppableContainers } = args;
  // bersagli "precisi" (tag della sidebar + card per il merge): si attivano
  // solo se l'overlay li interseca davvero. Trascinando una pinnata (riordino)
  // i bersagli `card:` vengono ignorati, così il sortable non viene disturbato.
  const precise = droppableContainers.filter((c) => {
    const id = String(c.id);
    if (id.startsWith("tag:")) return true;
    return id.startsWith("card:") && !draggingPinned;
  });

  if (pointerCoordinates && precise.length > 0) {
    // hitbox a dimensione fissa centrata sul cursore (≈ overlay). Non usiamo
    // collisionRect: per le immagini l'overlay parte a 0×0 finché il blob non
    // è caricato, e la hitbox risulterebbe un punto → mai intersezione.
    const w = 200;
    const h = 80;
    const ox = pointerCoordinates.x - w / 2;
    const oy = pointerCoordinates.y - h / 2;
    let best: { id: string | number; area: number } | null = null;
    for (const c of precise) {
      const r = c.rect.current;
      if (!r) continue;
      const ix = Math.max(0, Math.min(ox + w, r.left + r.width) - Math.max(ox, r.left));
      const iy = Math.max(0, Math.min(oy + h, r.top + r.height) - Math.max(oy, r.top));
      const area = ix * iy;
      if (area > 0 && (!best || area > best.area)) best = { id: c.id, area };
    }
    if (best) return [{ id: best.id }];
  }

  // nessun bersaglio preciso → riordino dei pinnati (sortable, id numerici),
  // escludendo i bersagli precisi dai candidati
  return closestCenter({
    ...args,
    droppableContainers: droppableContainers.filter((c) => {
      const id = String(c.id);
      return !id.startsWith("tag:") && !id.startsWith("card:");
    }),
  });
};

/// Centra la DragOverlay sul cursore invece di ancorarla all'angolo in alto a
/// sinistra dell'elemento: così la card "presa" segue il punto di presa.
export const snapCenterToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const rect = draggingNodeRect;
  const ev = activatorEvent as PointerEvent;
  const offsetX = ev.clientX - rect.left;
  const offsetY = ev.clientY - rect.top;
  return {
    ...transform,
    x: transform.x + offsetX - rect.width / 2,
    y: transform.y + offsetY - rect.height / 2,
  };
};

/// "Fantasma" che vola dentro il tag al drop: posizione di partenza + vettore.
export interface FlyingState {
  clip: Clip;
  count: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/// Drag & drop delle clip (unico DndContext per Sidebar + lista), estratto da
/// App.tsx senza cambiarne il comportamento. Gestisce: trascinamento (overlay),
/// drop su un tag (tagga 1 o N clip + animazione "fantasma"), drop su un'altra
/// card (merge → conferma), riordino dei pinnati (delega a ClipList via ref).
///
/// Dipendenze iniettate:
/// - `clips`/`selectedIds`/`selectedIdsRef`: per risolvere la clip trascinata e
///   capire se il drop riguarda la selezione multipla;
/// - `reload`: ricarica dopo aver taggato;
/// - `setMergePrompt`: apre la conferma di merge;
/// - `effectiveType`: confronto di tipo per decidere se due card sono fondibili.
export function useClipDnd(opts: {
  clips: Clip[];
  selectedIds: Set<number>;
  selectedIdsRef: React.RefObject<Set<number>>;
  reload: () => void;
  setMergePrompt: (m: { sourceId: number; targetId: number } | null) => void;
  effectiveType: (c: Clip) => ContentType;
}) {
  const { clips, selectedIds, selectedIdsRef, reload, setMergePrompt, effectiveType } =
    opts;

  // Il drag parte dopo 8px così un click breve resta un click (copia/selezione).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  // id della clip in trascinamento (per la DragOverlay); null = nessun drag
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // handler di riordino pinnati registrato dalla ClipList (lo stato ottimistico
  // vive lì dentro, qui chiamiamo solo la funzione al drop su un'altra card)
  const reorderRef = useRef<(activeId: number, overId: number) => void>(() => {});
  const draggingClip = clips.find((c) => c.id === draggingId) ?? null;
  // quante card verranno taggate dal drop: tutta la selezione se trascino una
  // card selezionata (≥2), altrimenti 1. Guida lo stack nell'anteprima.
  const dragStackCount =
    draggingId != null && selectedIds.has(draggingId) && selectedIds.size > 1
      ? selectedIds.size
      : 1;
  // ultima posizione del puntatore durante il drag (per far partire da lì il
  // "fantasma" che cade dentro il tag, dato che il cursore è nascosto)
  const pointerRef = useRef({ x: 0, y: 0 });
  const [flying, setFlying] = useState<FlyingState | null>(null);

  const trackPointer = (e: PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
  };

  const onDragStart = (event: DragStartEvent) => {
    const id = event.active.id as number;
    setDraggingId(id);
    // se trascino una pinnata è un riordino: il detector ignora i merge target
    draggingPinned = clips.find((c) => c.id === id)?.pinned ?? false;
    // nascondi il cursore mentre trascini: la card stessa fa da puntatore
    document.body.classList.add("dragging-clip");
    window.addEventListener("pointermove", trackPointer);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const clip = draggingClip;
    setDraggingId(null);
    draggingPinned = false;
    document.body.classList.remove("dragging-clip");
    window.removeEventListener("pointermove", trackPointer);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as number;
    if (typeof over.id === "string" && over.id.startsWith("tag:")) {
      const tagName = over.id.slice(4);
      // se trascini una card che fa parte della selezione multipla, il drop
      // tagga tutte le selezionate; altrimenti solo quella trascinata.
      const sel = selectedIdsRef.current;
      const ids = sel.has(activeId) && sel.size > 1 ? Array.from(sel) : [activeId];
      // scrivi subito nel DB, ma fai comparire le chip solo dopo che il
      // "fantasma" è atterrato (reload ritardato)
      const write =
        ids.length > 1 ? api.bulkAddTag(ids, tagName) : api.addTag(activeId, tagName);
      write.then(() => window.setTimeout(() => reload(), 460));
      // fantasma che converge verso il centro del tag dal punto di rilascio
      const r = over.rect;
      if (clip && r) {
        const from = pointerRef.current;
        const tx = r.left + r.width / 2;
        const ty = r.top + r.height / 2;
        setFlying({
          clip,
          count: ids.length,
          x: from.x,
          y: from.y,
          dx: tx - from.x,
          dy: ty - from.y,
        });
        window.setTimeout(() => setFlying(null), 360);
      }
      return;
    }
    // drop su una card non pinnata (bersaglio merge, id "card:N")
    if (typeof over.id === "string" && over.id.startsWith("card:")) {
      const targetId = Number(over.id.slice(5));
      if (targetId === activeId) return;
      const source = clips.find((c) => c.id === activeId);
      const target = clips.find((c) => c.id === targetId);
      if (!source || !target) return;
      // merge se la SORGENTE non è pinnata (così non disturba il sortable) e i
      // tipi effettivi coincidono. Il bersaglio può essere pinnato o no.
      if (!source.pinned && effectiveType(source) === effectiveType(target)) {
        setMergePrompt({ sourceId: activeId, targetId });
      }
      return;
    }
    // drop su un'altra card pinnata (sortable, id numerico) → riordino
    if (active.id !== over.id) reorderRef.current(activeId, over.id as number);
  };

  return {
    sensors,
    draggingClip,
    dragStackCount,
    flying,
    reorderRef,
    onDragStart,
    onDragEnd,
  };
}
