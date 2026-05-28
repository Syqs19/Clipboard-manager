import { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  api,
  onClipsChanged,
  onOpenSettings,
  SELECT_MODIFIERS,
  type Clip,
  type SelectModifier,
} from "./lib/api";
import { Store } from "@tauri-apps/plugin-store";
import { tagColor } from "./lib/format";
import { Sidebar, type Filter } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ClipList } from "./components/ClipList";
import { Settings } from "./components/Settings";
import { ImagePreview } from "./components/ImagePreview";
import { SelectionBar } from "./components/SelectionBar";
import { useNotify } from "./components/Toaster";

function App() {
  const notify = useNotify();
  const [clips, setClips] = useState<Clip[]>([]);
  const [tags, setTags] = useState<[string, number, string | null, boolean][]>(
    [],
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectModifier, setSelectModifier] = useState<SelectModifier>("ctrl");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastBulkIndexRef = useRef<number | null>(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const visibleRef = useRef<Clip[]>([]);
  const selRef = useRef(0);
  const modalRef = useRef(false);

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
      if (previewClip) setPreviewClip(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (selectedIdsRef.current.size > 0) clearSelection();
      else getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewClip, settingsOpen, clearSelection]);

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
      if (modalRef.current) return;
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
        if (tag === "TEXTAREA") return; // a capo nell'editor
        const c = list[selRef.current];
        if (c) {
          e.preventDefault();
          api.copyClip(c.id); // solo copia, la finestra resta aperta
          flashRef.current(c.id);
        }
      } else if (/^[1-9]$/.test(e.key) && !typing) {
        const c = list[parseInt(e.key, 10) - 1];
        if (c) {
          e.preventDefault();
          api.copyClip(c.id);
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

  const visible = clips.filter((c) => {
    if (filter.kind === "pinned") return c.pinned;
    if (filter.kind === "images") return c.content_type === "image";
    if (filter.kind === "files") return c.content_type === "files";
    if (filter.kind === "tag") return c.tags.includes(filter.name);
    return true;
  });
  const imageCount = clips.filter((c) => c.content_type === "image").length;
  const fileCount = clips.filter((c) => c.content_type === "files").length;

  // selezione corrente (per la navigazione da tastiera)
  const sel = visible.length ? Math.min(selectedIndex, visible.length - 1) : 0;
  visibleRef.current = visible;
  selRef.current = sel;
  modalRef.current = settingsOpen || previewClip !== null;

  const handleCopy = (id: number, asPlain = false) => {
    api.copyClip(id, asPlain);
    flashCopied(id);
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
    tagColor(name, tags.find((t) => t[0] === name)?.[2] ?? null);

  const pinnedCount = clips.filter((c) => c.pinned).length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
      <Sidebar
        filter={filter}
        onSelect={setFilter}
        tags={tags}
        pinnedCount={pinnedCount}
        imageCount={imageCount}
        fileCount={fileCount}
        totalCount={clips.length}
        onSetTagColor={handleSetTagColor}
        onSetTagPinned={handleSetTagPinned}
        onRenameTag={handleRenameTag}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 p-3">
          <div className="flex-1">
            <SearchBar value={query} onChange={setQuery} />
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Impostazioni"
            className="rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-400 transition-colors hover:text-zinc-100"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
            selectedIds={selectedIds}
            onBulkClick={onCardBulkClick}
            selectModifier={selectModifier}
            selectionMode={selectedIds.size > 0}
            allTags={tags}
            onReveal={handleReveal}
            highlightQuery={query}
          />
        </div>
      </main>

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
      />
    </div>
  );
}

export default App;
