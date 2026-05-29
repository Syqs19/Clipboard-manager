import { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { useImageUrl } from "./lib/useImageUrl";
import {
  api,
  onClipsChanged,
  onOpenSettings,
  SELECT_MODIFIERS,
  type Clip,
  type ContentType,
  type SelectModifier,
  type Tag,
} from "./lib/api";
import { Store } from "@tauri-apps/plugin-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tagColor } from "./lib/format";
import { Sidebar, type Filter, type Section } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ClipList } from "./components/ClipList";
import { Settings } from "./components/Settings";
import { ImagePreview } from "./components/ImagePreview";
import { GroupDetail } from "./components/GroupDetail";
import { SelectionBar } from "./components/SelectionBar";
import { useNotify } from "./components/Toaster";
import { Onboarding } from "./components/Onboarding";

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
const collisionDetection: CollisionDetection = (args) => {
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
const snapCenterToCursor: Modifier = ({
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

/// Contenuto dell'anteprima (immagine / file / testo) di una singola clip.
function DragPreviewBody({ clip }: { clip: Clip }) {
  const isImage = clip.content_type === "image" && !!clip.image_path;
  const thumb = useImageUrl(isImage ? clip.thumb_path ?? clip.image_path : null);
  if (isImage) {
    return thumb ? (
      <img
        src={thumb}
        alt={clip.preview}
        className="max-h-24 max-w-[200px] rounded-lg border border-zinc-700 object-contain shadow-xl"
      />
    ) : (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 shadow-xl">
        Image
      </div>
    );
  }
  // per i file mostra il nome (basename), non il percorso completo
  const label =
    clip.content_type === "files"
      ? fileLabel(clip.content)
      : clip.preview || clip.content || "";
  return (
    <div className="max-w-[260px] truncate rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 shadow-xl">
      {label}
    </div>
  );
}

/// Anteprima della clip trascinata. Con `stackCount > 1` (drag di una selezione
/// multipla) disegna un piccolo "mazzo" di card dietro e un badge col totale.
function DragPreview({ clip, stackCount = 1 }: { clip: Clip; stackCount?: number }) {
  if (stackCount <= 1) return <DragPreviewBody clip={clip} />;
  return (
    <div className="relative w-fit">
      {/* layer dietro sfalsati: danno l'idea del mazzo */}
      <div className="absolute inset-0 -translate-x-1.5 -translate-y-1.5 rounded-lg border border-zinc-700 bg-zinc-800/80 shadow-lg" />
      <div className="absolute inset-0 -translate-x-0.5 -translate-y-0.5 rounded-lg border border-zinc-700 bg-zinc-800/90 shadow-lg" />
      <div className="relative w-fit">
        <DragPreviewBody clip={clip} />
      </div>
      <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[11px] font-semibold text-white shadow-md">
        {stackCount}
      </span>
    </div>
  );
}

/// Etichetta per una clip di tipo "files": nome del primo file (+N altri),
/// invece del percorso completo. `content` è un JSON array di path.
function fileLabel(content: string | null): string {
  if (!content) return "";
  try {
    const paths = JSON.parse(content);
    if (!Array.isArray(paths) || paths.length === 0) return "";
    const name = String(paths[0]).split(/[\\/]/).pop() || String(paths[0]);
    return paths.length > 1 ? `${name} +${paths.length - 1}` : name;
  } catch {
    return "";
  }
}

function App() {
  const notify = useNotify();
  const [clips, setClips] = useState<Clip[]>([]);
  const [tags, setTags] = useState<Tag[]>(
    [],
  );
  const [query, setQuery] = useState("");
  // macro-sezione attiva (Clipboard / Strumenti / Design): guida cosa mostra
  // l'area principale. `null` = tutte chiuse (main mostra un placeholder).
  // Il `filter` qui sotto resta interno alla Clipboard.
  const [activeSection, setActiveSection] = useState<Section | null>("clipboard");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [groupClip, setGroupClip] = useState<Clip | null>(null);
  // conferma al drop di una card su un'altra dello stesso tipo
  const [mergePrompt, setMergePrompt] = useState<{
    sourceId: number;
    targetId: number;
  } | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [hotkey, setHotkey] = useState("Ctrl+Shift+V");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectModifier, setSelectModifier] = useState<SelectModifier>("ctrl");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastBulkIndexRef = useRef<number | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const visibleRef = useRef<Clip[]>([]);
  const selRef = useRef(0);
  const modalRef = useRef(false);
  // la navigazione da tastiera (↑↓ / Enter / 1-9) vale solo nella Clipboard:
  // nelle altre sezioni la lista non è visibile.
  const clipboardActiveRef = useRef(true);
  clipboardActiveRef.current = activeSection === "clipboard";
  // true mentre un popover "Copy as…" è aperto: sospende la navigazione ↑↓ così
  // le frecce non scorrono la lista dietro al menu.
  const popoverOpenRef = useRef(false);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastBulkIndexRef.current = null;
  }, []);

  // feedback "Copiato": id della clip appena copiata/risalita (lampeggia ~900ms)
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const flashCopied = useCallback((id: number) => {
    setCopiedId(id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 900);
  }, []);
  const flashRef = useRef(flashCopied);
  flashRef.current = flashCopied;

  const reload = useCallback(async () => {
    const data = query.trim()
      ? await api.searchClips(query)
      : await api.listClips();
    setClips(data);
    setTags(await api.listTags());
  }, [query]);

  // ricarica al mount e quando cambia la ricerca
  useEffect(() => {
    reload();
  }, [reload]);

  // legge il modifier per la multi-selezione (default Ctrl)
  useEffect(() => {
    (async () => {
      const store = await Store.load("settings.json");
      const m = await store.get<string>("multiSelectModifier");
      if (m && (SELECT_MODIFIERS as readonly string[]).includes(m)) {
        setSelectModifier(m as SelectModifier);
      }
    })();
  }, []);

  // ESC: chiude prima i modal aperti, poi la selezione bulk, altrimenti nasconde la finestra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (groupClip) setGroupClip(null);
      else if (previewClip) setPreviewClip(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (selectedIdsRef.current.size > 0) clearSelection();
      else getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupClip, previewClip, settingsOpen, clearSelection]);

  // si sottoscrive una sola volta agli eventi del watcher
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onClipsChanged((id) => {
      reloadRef.current();
      if (id != null) flashRef.current(id);
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  // primo avvio: mostra l'onboarding e leggi l'hotkey corrente
  useEffect(() => {
    (async () => {
      try {
        const store = await Store.load("settings.json");
        const onboarded = await store.get<boolean>("onboarded");
        const savedHotkey = await store.get<string>("hotkey");
        if (savedHotkey) setHotkey(savedHotkey);
        if (!onboarded) setOnboardingOpen(true);
      } catch {
        setOnboardingOpen(true);
      }
    })();
  }, []);
  const closeOnboarding = async () => {
    setOnboardingOpen(false);
    try {
      const store = await Store.load("settings.json");
      await store.set("onboarded", true);
      await store.save();
    } catch {
      // ignora: al massimo si rivede al prossimo avvio
    }
  };

  // apertura impostazioni dal menu tray
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onOpenSettings(() => setSettingsOpen(true)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  // riparti dalla cima quando cambia ricerca o filtro
  useEffect(() => setSelectedIndex(0), [query, filter]);

  // navigazione da tastiera: ↑↓ scorri, Invio incolla nell'app attiva, 1-9 rapido
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalRef.current || popoverOpenRef.current) return;
      if (!clipboardActiveRef.current) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      const list = visibleRef.current;
      if (list.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        if (tag === "TEXTAREA") return; // a capo nell'editor inline
        // Nota: i campi che vogliono "consumare" Enter (es. rename tag)
        // devono chiamare e.stopPropagation() nel proprio handler.
        const c = list[selRef.current];
        if (c) {
          e.preventDefault();
          // i gruppi non si copiano: Enter apre la vista dettaglio
          if (c.content_type === "group") {
            setGroupClip(c);
          } else {
            // solo copia, la finestra resta aperta
            api.copyClip(c.id).catch(() => {});
            flashRef.current(c.id);
          }
        }
      } else if (/^[1-9]$/.test(e.key) && !typing) {
        const c = list[parseInt(e.key, 10) - 1];
        // i gruppi non hanno badge numerico e non si copiano: 1-9 li ignora
        if (c && c.content_type !== "group") {
          e.preventDefault();
          api.copyClip(c.id).catch(() => {});
          flashRef.current(c.id);
        }
      } else if (e.key === "Delete" && !typing) {
        // Del con selezione bulk attiva → elimina tutte le selezionate
        if (selectedIdsRef.current.size > 0) {
          e.preventDefault();
          deleteSelectedRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isTextLike = (t: ContentType) => t === "text" || t === "url";
  // tipo "effettivo" di un clip: per i gruppi è il tipo dei loro elementi, così
  // un gruppo di immagini appare anche in "Images", uno di testi in "Text", ecc.
  const effectiveType = (c: Clip) =>
    c.content_type === "group" ? c.items?.[0]?.item_type ?? "text" : c.content_type;
  const typeMatches = (c: Clip, kind: Filter["kind"]) => {
    switch (kind) {
      case "all":
        return true;
      case "images":
        return effectiveType(c) === "image";
      case "files":
        return effectiveType(c) === "files";
      case "text":
        return isTextLike(effectiveType(c));
      case "groups":
        if (c.content_type !== "group") return false;
        // sotto-voce per tipo: filtra i gruppi per il tipo dei loro elementi
        return filter.kind === "groups" && filter.groupType
          ? (c.items?.[0]?.item_type ?? "text") === filter.groupType
          : true;
      case "tags":
        // categoria-contenitore "Tags": tutte le clip con almeno un tag
        return c.tags.length > 0;
      case "tag":
        return false; // gestito a parte
    }
  };
  const visible = clips.filter((c) => {
    if (filter.kind === "tag") {
      if (!c.tags.includes(filter.name)) return false;
      // sotto-voce "Pinned" del tag: solo le clip fissate con quel tag
      return filter.pinned ? c.pinned : true;
    }
    if (!typeMatches(c, filter.kind)) return false;
    // categoria principale: tutto (fissati inclusi, fissati restano in cima
    // grazie all'ordinamento del backend). Sub-voce "Fissati": solo fissati.
    return filter.pinned ? c.pinned : true;
  });
  // count categoria principale = tutto del tipo; sub-voce = solo fissati
  const allCount = clips.length;
  const imageCount = clips.filter((c) => effectiveType(c) === "image").length;
  const fileCount = clips.filter((c) => effectiveType(c) === "files").length;
  const textCount = clips.filter((c) => isTextLike(effectiveType(c))).length;
  const groupCount = clips.filter((c) => c.content_type === "group").length;
  const tagsCount = clips.filter((c) => c.tags.length > 0).length;
  const pinnedAllCount = clips.filter((c) => c.pinned).length;
  const pinnedImageCount = clips.filter(
    (c) => effectiveType(c) === "image" && c.pinned,
  ).length;
  const pinnedFileCount = clips.filter(
    (c) => effectiveType(c) === "files" && c.pinned,
  ).length;
  const pinnedTextCount = clips.filter(
    (c) => isTextLike(effectiveType(c)) && c.pinned,
  ).length;
  // clip fissate per tag (per la sotto-voce "Pinned" di ogni tag)
  const pinnedByTag = new Map<string, number>();
  for (const c of clips) {
    if (!c.pinned) continue;
    for (const t of c.tags) pinnedByTag.set(t, (pinnedByTag.get(t) ?? 0) + 1);
  }

  // selezione corrente (per la navigazione da tastiera)
  const sel = visible.length ? Math.min(selectedIndex, visible.length - 1) : 0;
  visibleRef.current = visible;
  selRef.current = sel;
  modalRef.current = settingsOpen || previewClip !== null || groupClip !== null;

  const handleCopy = (id: number, asPlain = false) => {
    api.copyClip(id, asPlain).catch((e) => notify(`Couldn't copy: ${e}`, "error"));
    flashCopied(id);
  };
  const handleCopyImageAsFile = async (id: number) => {
    try {
      await api.copyImageAsFile(id);
      flashCopied(id);
      notify("Image copied as a file — paste it anywhere with Ctrl+V", "success");
    } catch (e) {
      notify(`Couldn't copy the image as a file: ${e}`, "error");
    }
  };
  // "Copy as": copia una versione trasformata del clip senza modificarlo.
  // Le trasformazioni informative (es. "stats") ritornano una stringa da
  // mostrare nel toast invece di toccare gli appunti.
  const handleTransform = async (id: number, transform: string) => {
    try {
      const info = await api.copyTransformed(id, transform);
      if (info != null) notify(info, "info");
      else flashCopied(id);
    } catch (e) {
      notify(`Couldn't transform: ${e}`, "error");
    }
  };
  const handlePin = async (clip: Clip) => {
    await api.togglePin(clip.id, !clip.pinned);
    reload();
  };
  const handleDelete = async (id: number) => {
    await api.removeClip(id);
    reload();
  };
  const handleAddTag = async (id: number, name: string) => {
    await api.addTag(id, name);
    reload();
  };
  const handleRemoveTag = async (id: number, name: string) => {
    await api.removeTag(id, name);
    reload();
  };
  const handleUpdate = async (id: number, content: string) => {
    await api.updateClip(id, content);
    reload();
  };
  const handleSetTagColor = async (name: string, color: string) => {
    await api.setTagColor(name, color);
    reload();
  };
  const handleSetTagPinned = async (name: string, pinned: boolean) => {
    await api.setTagPinned(name, pinned);
    reload();
  };
  const handleReveal = async (path: string) => {
    try {
      await api.revealInExplorer(path);
    } catch (e) {
      notify(`Impossibile aprire la cartella: ${e}`, "error");
    }
  };
  // Azione rapida in base al tipo di clip: link → browser, file → apri.
  const handleQuickOpen = async (clip: Clip) => {
    try {
      const text = clip.content?.trim() ?? "";
      if (clip.content_type === "url" && text) {
        await openUrl(text);
      } else if (clip.content_type === "files") {
        const first = (JSON.parse(clip.content || "[]") as string[])[0];
        if (first) await api.openPath(first);
      }
    } catch (e) {
      notify(`Couldn't open: ${e}`, "error");
    }
  };
  const handleRenameTag = async (oldName: string, newName: string) => {
    try {
      await api.renameTag(oldName, newName);
      reload();
      notify(`Tag rinominato in "${newName}"`, "success");
    } catch (e) {
      notify(`Impossibile rinominare: ${e}`, "error");
    }
  };

  // multi-selezione: Ctrl/Cmd+click toggle, Shift+click range
  const onCardBulkClick = (clipIndex: number, e: React.MouseEvent) => {
    const list = visibleRef.current;
    const clip = list[clipIndex];
    if (!clip) return;
    if (e.shiftKey && lastBulkIndexRef.current != null) {
      const start = Math.min(lastBulkIndexRef.current, clipIndex);
      const end = Math.max(lastBulkIndexRef.current, clipIndex);
      const next = new Set(selectedIdsRef.current);
      for (let i = start; i <= end; i++) {
        if (list[i]) next.add(list[i].id);
      }
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIdsRef.current);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      setSelectedIds(next);
    }
    lastBulkIndexRef.current = clipIndex;
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.removeClips(ids);
    clearSelection();
    reload();
  };
  const deleteSelectedRef = useRef(deleteSelected);
  deleteSelectedRef.current = deleteSelected;

  const togglePinSelected = async (pin: boolean) => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.bulkSetPinned(ids, pin);
    reload();
  };

  const addTagSelected = async (name: string) => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.bulkAddTag(ids, name);
    reload();
  };
  const removeTagSelected = async (name: string) => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.bulkRemoveTag(ids, name);
    reload();
  };

  // stato pinned aggregato della selezione (per il bottone Pinna/Despinna)
  const selectedClips = clips.filter((c) => selectedIds.has(c.id));
  const anyPinned = selectedClips.some((c) => c.pinned);
  const allPinned = selectedClips.length > 0 && selectedClips.every((c) => c.pinned);
  const selectedTagsInBulk = Array.from(
    new Set(selectedClips.flatMap((c) => c.tags)),
  );

  // colore di un tag: override salvato oppure deterministico dal nome
  const colorOf = (name: string) =>
    tagColor(name, tags.find((t) => t.name === name)?.color ?? null);

  // --- Drag & drop (unico DndContext per Sidebar + lista) ---
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
  // fantasma che vola dentro il tag al drop: posizione di partenza + vettore
  const [flying, setFlying] = useState<{
    clip: Clip;
    count: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);

  const onDragStart = (event: DragStartEvent) => {
    const id = event.active.id as number;
    setDraggingId(id);
    // se trascino una pinnata è un riordino: il detector ignora i merge target
    draggingPinned = clips.find((c) => c.id === id)?.pinned ?? false;
    // nascondi il cursore mentre trascini: la card stessa fa da puntatore
    document.body.classList.add("dragging-clip");
    window.addEventListener("pointermove", trackPointer);
  };
  const trackPointer = (e: PointerEvent) => {
    pointerRef.current = { x: e.clientX, y: e.clientY };
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent text-zinc-100">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        filter={filter}
        onSelect={setFilter}
        tags={tags}
        imageCount={imageCount}
        fileCount={fileCount}
        textCount={textCount}
        groupCount={groupCount}
        tagsCount={tagsCount}
        totalCount={allCount}
        pinnedAllCount={pinnedAllCount}
        pinnedImageCount={pinnedImageCount}
        pinnedFileCount={pinnedFileCount}
        pinnedTextCount={pinnedTextCount}
        pinnedByTag={pinnedByTag}
        onSetTagColor={handleSetTagColor}
        onSetTagPinned={handleSetTagPinned}
        onRenameTag={handleRenameTag}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 p-4">
          <div className="flex-1">
            {activeSection === "clipboard" && (
              <SearchBar value={query} onChange={setQuery} />
            )}
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Impostazioni"
            className="rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-400 transition-colors hover:text-zinc-100 hover:bg-zinc-800/80"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
        {activeSection === "clipboard" ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {selectedIds.size > 0 && (
              <SelectionBar
                count={selectedIds.size}
                anyPinned={anyPinned}
                allPinned={allPinned}
                allTags={tags}
                selectedTagsInBulk={selectedTagsInBulk}
                colorOf={colorOf}
                onClear={clearSelection}
                onDelete={deleteSelected}
                onTogglePin={togglePinSelected}
                onAddTag={addTagSelected}
                onRemoveTag={removeTagSelected}
              />
            )}
            <ClipList
              clips={visible}
              selectedIndex={sel}
              copiedId={copiedId}
              onSelect={setSelectedIndex}
              colorOf={colorOf}
              onCopy={handleCopy}
              onPreview={setPreviewClip}
              onTogglePin={handlePin}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              onSetTagColor={handleSetTagColor}
              onReorderPinned={async (ids) => {
                await api.reorderPinned(ids);
                await reload();
              }}
              registerReorder={(fn) => {
                reorderRef.current = fn;
              }}
              selectedIds={selectedIds}
              onBulkClick={onCardBulkClick}
              selectModifier={selectModifier}
              selectionMode={selectedIds.size > 0}
              allTags={tags}
              onReveal={handleReveal}
              onCopyImageAsFile={handleCopyImageAsFile}
              onQuickOpen={handleQuickOpen}
              onTransform={handleTransform}
              onOpenGroup={setGroupClip}
              onPopoverOpenChange={(open) => {
                popoverOpenRef.current = open;
              }}
              highlightQuery={query}
              grouped={!query.trim()}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-4 text-center">
            {activeSection ? (
              <>
                <p className="text-sm font-medium text-zinc-300">
                  {activeSection === "tools" ? "Tools" : "Design"}
                </p>
                <p className="max-w-xs text-xs text-zinc-500">Coming soon.</p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Select a section.</p>
            )}
          </div>
        )}
      </main>

        {/* anteprima della clip trascinata, centrata sul cursore */}
        <DragOverlay modifiers={[snapCenterToCursor]} dropAnimation={null}>
          {draggingClip ? (
            <DragPreview clip={draggingClip} stackCount={dragStackCount} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* fantasma che "cade dentro" il tag al drop: parte dal punto di rilascio
          e converge verso il centro del tag rimpicciolendosi */}
      {flying && (
        <div
          className="anim-fly-to-tag pointer-events-none fixed z-[60]"
          style={
            {
              left: flying.x,
              top: flying.y,
              "--fly-dx": `${flying.dx}px`,
              "--fly-dy": `${flying.dy}px`,
            } as React.CSSProperties
          }
        >
          <DragPreview clip={flying.clip} stackCount={flying.count} />
        </div>
      )}

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onReload={reload}
        onSelectModifierChange={setSelectModifier}
      />

      <ImagePreview
        clip={previewClip}
        onClose={() => setPreviewClip(null)}
        onCopy={handleCopy}
        onCopyAsFile={handleCopyImageAsFile}
      />

      <GroupDetail clip={groupClip} onClose={() => setGroupClip(null)} />

      {/* conferma merge al drop di una card su un'altra dello stesso tipo */}
      {mergePrompt && (
        <div
          onClick={() => setMergePrompt(null)}
          className="anim-fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="anim-scale-in w-full max-w-xs rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
          >
            <p className="text-sm text-zinc-200">
              Merge these two clips into a group?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setMergePrompt(null)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const { sourceId, targetId } = mergePrompt;
                  setMergePrompt(null);
                  try {
                    await api.mergeClips(sourceId, targetId);
                    await reload();
                  } catch (e) {
                    notify(`Couldn't merge: ${e}`, "error");
                  }
                }}
                className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-400"
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      )}

      <Onboarding
        open={onboardingOpen}
        onClose={closeOnboarding}
        hotkey={hotkey}
      />
    </div>
  );
}

export default App;
