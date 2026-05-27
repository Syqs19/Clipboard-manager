import { useCallback, useEffect, useRef, useState } from "react";
import { api, onClipsChanged, type Clip } from "./lib/api";
import { Sidebar, type Filter } from "./components/Sidebar";
import { SearchBar } from "./components/SearchBar";
import { ClipList } from "./components/ClipList";

function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [tags, setTags] = useState<[string, number][]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ kind: "all" });

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

  // si sottoscrive una sola volta agli eventi del watcher
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onClipsChanged(() => reloadRef.current()).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const visible = clips.filter((c) => {
    if (filter.kind === "pinned") return c.pinned;
    if (filter.kind === "tag") return c.tags.includes(filter.name);
    return true;
  });

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
        totalCount={clips.length}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-zinc-800 p-3">
          <SearchBar value={query} onChange={setQuery} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ClipList
            clips={visible}
            onCopy={handleCopy}
            onTogglePin={handlePin}
            onDelete={handleDelete}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
