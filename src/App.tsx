import { useCallback, useEffect, useRef, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, onClipsChanged, onOpenSettings, type Clip } from "./lib/api";
import { Sidebar, type Filter } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ClipList } from "./components/ClipList";
import { Settings } from "./components/Settings";
import { ImagePreview } from "./components/ImagePreview";

function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [tags, setTags] = useState<[string, number][]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewClip, setPreviewClip] = useState<Clip | null>(null);

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

  // ESC: chiude prima i modal aperti, altrimenti nasconde la finestra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (previewClip) setPreviewClip(null);
      else if (settingsOpen) setSettingsOpen(false);
      else getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewClip, settingsOpen]);

  // si sottoscrive una sola volta agli eventi del watcher
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onClipsChanged(() => reloadRef.current()).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  // apertura impostazioni dal menu tray
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onOpenSettings(() => setSettingsOpen(true)).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const visible = clips.filter((c) => {
    if (filter.kind === "pinned") return c.pinned;
    if (filter.kind === "images") return c.content_type === "image";
    if (filter.kind === "tag") return c.tags.includes(filter.name);
    return true;
  });
  const imageCount = clips.filter((c) => c.content_type === "image").length;

  const handleCopy = (id: number) => {
    api.copyClip(id);
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

  const pinnedCount = clips.filter((c) => c.pinned).length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
      <Sidebar
        filter={filter}
        onSelect={setFilter}
        tags={tags}
        pinnedCount={pinnedCount}
        imageCount={imageCount}
        totalCount={clips.length}
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
          <ClipList
            clips={visible}
            onCopy={handleCopy}
            onPreview={setPreviewClip}
            onTogglePin={handlePin}
            onDelete={handleDelete}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />
        </div>
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onReload={reload}
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
