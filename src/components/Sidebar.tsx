import { useLayoutEffect, useRef, useState } from "react";
import { useExitAnimation } from "../lib/useExitAnimation";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ChevronDown,
  FileText,
  Image,
  Inbox,
  Pin,
  Star,
  Type,
} from "lucide-react";
import { tagColor } from "../lib/format";

/// Categorie principali della sidebar.
export type MainKind = "all" | "images" | "files" | "text";

export type Filter =
  | { kind: MainKind; pinned?: boolean }
  | { kind: "tag"; name: string };

function sameFilter(a: Filter, b: Filter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "tag" && b.kind === "tag") return a.name === b.name;
  if (a.kind !== "tag" && b.kind !== "tag") {
    return Boolean(a.pinned) === Boolean(b.pinned);
  }
  return true;
}

function Item({
  active,
  sectionActive,
  onClick,
  icon,
  label,
  count,
}: {
  /** Item evidenziato con sfondo (fuoco visivo). */
  active: boolean;
  /** L'ActiveBar si posiziona qui (di default coincide con `active`,
   *  ma può restare sulla categoria padre anche se è attiva una sub-voce). */
  sectionActive?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      data-active={(sectionActive ?? active) ? "true" : undefined}
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

/// Voce indentata per filtri secondari (es. "Fissati" dentro una categoria).
/// Disegna una piccola guida ad L verde che si "disegna" all'attivazione
/// (verticale poi orizzontale) e si "smonta" al contrario all'uscita.
function SubItem({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  // 330ms = durata orizzontale (160) + delay verticale (150) + buffer
  const guide = useExitAnimation(active, 340);
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-2 rounded-md py-1 pl-9 pr-2.5 text-xs transition-colors ${
        active
          ? "bg-zinc-700/40 text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
      }`}
    >
      {/* guida ad L verde: stesso spessore della ActiveBar (w-0.5),
          stessa x (-left-1). All'entrata si disegna verticale→orizzontale,
          all'uscita si ritira orizzontale→verticale. */}
      {guide.mounted && (
        <>
          <span
            aria-hidden
            className={`${
              guide.exiting ? "guide-shrink-y" : "guide-grow-y"
            } pointer-events-none absolute -left-1 -top-1 h-[calc(50%+4px)] w-0.5 rounded-full bg-emerald-400`}
          />
          <span
            aria-hidden
            className={`${
              guide.exiting ? "guide-shrink-x" : "guide-grow-x"
            } pointer-events-none absolute -left-1 top-1/2 h-0.5 w-[24px] rounded-full bg-emerald-400`}
          />
        </>
      )}
      <Pin className="h-3 w-3 shrink-0 text-amber-400/80" />
      <span className="flex-1 truncate text-left">{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-zinc-600">{count}</span>
      )}
    </button>
  );
}

/// Item categoria + sub-voce "Fissati" che appare solo quando la
/// categoria è attiva e ha almeno una clip fissata.
function CategoryWithPinned({
  mainKind,
  filter,
  onSelect,
  icon,
  label,
  mainCount,
  pinnedCount,
}: {
  mainKind: MainKind;
  filter: Filter;
  onSelect: (f: Filter) => void;
  icon: React.ReactNode;
  label: string;
  mainCount: number;
  pinnedCount: number;
}) {
  const sectionActive = filter.kind === mainKind;
  const mainActive = sectionActive && !filter.pinned;
  const pinnedActive = sectionActive && filter.pinned === true;
  return (
    <>
      <Item
        active={mainActive}
        sectionActive={sectionActive}
        onClick={() => onSelect({ kind: mainKind })}
        icon={icon}
        label={label}
        count={mainCount}
      />
      {sectionActive && (
        <SubItem
          active={pinnedActive}
          onClick={() => onSelect({ kind: mainKind, pinned: true })}
          label="Fissati"
          count={pinnedCount}
        />
      )}
    </>
  );
}

/// Barra verticale che scivola tra le voci `data-active` del nav genitore.
/// Misura la voce attiva ad ogni cambio del filtro e anima top/height.
function ActiveBar({ deps }: { deps: unknown[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const active = parent.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      setPos(null);
      return;
    }
    const parentRect = parent.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    setPos({ top: r.top - parentRect.top + 6, height: r.height - 12 });
    // deps: dipendenze che fanno ricalcolare la posizione
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <span
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute -left-1 w-0.5 rounded-full bg-emerald-400 transition-all duration-200 ease-out ${
        pos ? "opacity-100" : "opacity-0"
      }`}
      style={pos ? { top: pos.top, height: pos.height } : undefined}
    />
  );
}

/// Variante di ActiveBar per i tag, ancorata all'`<aside>` (fuori dal
/// container scrollabile per non essere clippata da `overflow-y-auto`).
/// Riposiziona anche durante lo scroll della lista tag.
function TagActiveBar({
  filter,
  asideRef,
  scrollRef,
}: {
  filter: Filter;
  asideRef: React.RefObject<HTMLElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState<{ top: number; height: number } | null>(null);
  const [smooth, setSmooth] = useState(true);
  const targetName = filter.kind === "tag" ? filter.name : null;

  useLayoutEffect(() => {
    const measure = (animate: boolean) => {
      const aside = asideRef.current;
      const scroll = scrollRef.current;
      if (!aside || !scroll) return;
      const active = scroll.querySelector<HTMLElement>('[data-active="true"]');
      if (!active) {
        setPos(null);
        return;
      }
      const asideRect = aside.getBoundingClientRect();
      const r = active.getBoundingClientRect();
      setSmooth(animate);
      setPos({ top: r.top - asideRect.top + 6, height: r.height - 12 });
    };
    // primo render / cambio filter: anima
    measure(true);
    // su scroll, niente animazione (segue 1:1 il pointer)
    const scroll = scrollRef.current;
    const onScroll = () => measure(false);
    scroll?.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll?.removeEventListener("scroll", onScroll);
  }, [targetName, asideRef, scrollRef]);

  return (
    <span
      aria-hidden
      // left-2 = 8px dall'aside: le voci tag iniziano a 12px (padding p-3)
      // quindi resta lo stesso "stacco" di 4px che ha l'ActiveBar del nav.
      className={`pointer-events-none absolute left-2 w-0.5 rounded-full bg-emerald-400 ${
        smooth ? "transition-all duration-200 ease-out" : ""
      } ${pos ? "opacity-100" : "opacity-0"}`}
      style={pos ? { top: pos.top, height: pos.height } : undefined}
    />
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
  onRename,
}: {
  name: string;
  count: number;
  color: string;
  pinned: boolean;
  active: boolean;
  onSelect: () => void;
  onSetColor: (color: string) => void;
  onTogglePinned: () => void;
  onRename: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== name) onRename(v);
    else setDraft(name);
  };

  return (
    <div
      data-active={active ? "true" : undefined}
      className={`group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-zinc-700/60 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
      }`}
    >
      <input
        type="color"
        value={color}
        onChange={(e) => onSetColor(e.target.value)}
        title="Scegli un colore"
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full"
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation(); // non far copiare la clip in cima
              commit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setDraft(name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded bg-zinc-700/60 px-1 text-sm text-zinc-100 outline-none ring-1 ring-zinc-600"
        />
      ) : (
        <button
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          title="Doppio click per rinominare"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex-1 truncate">{name}</span>
          <span className="text-xs text-zinc-500">{count}</span>
        </button>
      )}
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
  imageCount,
  fileCount,
  textCount,
  totalCount,
  pinnedAllCount,
  pinnedImageCount,
  pinnedFileCount,
  pinnedTextCount,
  onSetTagColor,
  onSetTagPinned,
  onRenameTag,
}: {
  filter: Filter;
  onSelect: (f: Filter) => void;
  tags: [string, number, string | null, boolean][];
  imageCount: number;
  fileCount: number;
  textCount: number;
  totalCount: number;
  pinnedAllCount: number;
  pinnedImageCount: number;
  pinnedFileCount: number;
  pinnedTextCount: number;
  onSetTagColor: (name: string, color: string) => void;
  onSetTagPinned: (name: string, pinned: boolean) => void;
  onRenameTag: (oldName: string, newName: string) => void;
}) {
  const [sortBy, setSortBy] = useState<"name" | "count">("name");
  const [clipboardOpen, setClipboardOpen] = useState(true);
  // durante la transizione collapse del Clipboard wrapper disabilito lo
  // scroll del container tag per evitare il flash della scrollbar.
  const [animatingCollapse, setAnimatingCollapse] = useState(false);
  const toggleClipboard = () => {
    setAnimatingCollapse(true);
    setClipboardOpen((o) => !o);
    window.setTimeout(() => setAnimatingCollapse(false), 220);
  };
  const compare = (
    a: [string, number, string | null, boolean],
    b: [string, number, string | null, boolean],
  ) =>
    sortBy === "count"
      ? b[1] - a[1] || a[0].localeCompare(b[0])
      : a[0].localeCompare(b[0]);
  const pinnedTags = tags.filter(([, , , p]) => p).sort(compare);
  const otherTags = tags.filter(([, , , p]) => !p).sort(compare);
  const asideRef = useRef<HTMLElement>(null);
  const tagScrollRef = useRef<HTMLDivElement>(null);
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
      onRename={(newName) => onRenameTag(name, newName)}
    />
  );
  return (
    <aside
      ref={asideRef}
      className="relative flex h-full w-60 shrink-0 flex-col border-r border-zinc-800/60 bg-zinc-900/40 p-4 backdrop-blur-md"
    >
      {/* Brand header espandibile: logo + wordmark + chevron a destra */}
      <button
        type="button"
        onClick={toggleClipboard}
        className="group mb-3 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-800/40"
      >
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-[0_0_18px_-4px_rgba(16,185,129,0.45)]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            {/* clipboard: clip + body */}
            <rect x="5" y="4" width="14" height="17" rx="2.5" />
            <rect x="9" y="2.5" width="6" height="3.5" rx="1" fill="currentColor" stroke="none" />
            <path d="M8.5 11h7M8.5 14h5" />
          </svg>
        </span>
        <span className="flex-1 text-[15px] font-semibold tracking-tight text-zinc-100">
          Clipboard
        </span>
        <ChevronDown
          className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${
            clipboardOpen ? "" : "-rotate-90"
          }`}
        />
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5">
        <div
          className={`grid min-h-0 flex-1 transition-all duration-200 ease-out ${
            clipboardOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          {/* overflow-hidden solo durante l'animazione collapse, altrimenti
              visible cosi l'ActiveBar a -left-1 del nav non viene clippata */}
          <div
            className={`flex min-h-0 flex-col gap-2 ${
              animatingCollapse || !clipboardOpen
                ? "overflow-hidden"
                : "overflow-visible"
            }`}
          >
            <nav className="relative flex flex-col gap-0.5">
              <ActiveBar
                deps={[
                  filter.kind,
                  filter.kind !== "tag" ? filter.pinned : null,
                ]}
              />
              <CategoryWithPinned
                mainKind="all"
                filter={filter}
                onSelect={onSelect}
                icon={<Inbox className="h-4 w-4" />}
                label="Tutto"
                mainCount={totalCount}
                pinnedCount={pinnedAllCount}
              />
              <CategoryWithPinned
                mainKind="images"
                filter={filter}
                onSelect={onSelect}
                icon={<Image className="h-4 w-4" />}
                label="Immagini"
                mainCount={imageCount}
                pinnedCount={pinnedImageCount}
              />
              <CategoryWithPinned
                mainKind="files"
                filter={filter}
                onSelect={onSelect}
                icon={<FileText className="h-4 w-4" />}
                label="File"
                mainCount={fileCount}
                pinnedCount={pinnedFileCount}
              />
              <CategoryWithPinned
                mainKind="text"
                filter={filter}
                onSelect={onSelect}
                icon={<Type className="h-4 w-4" />}
                label="Testo"
                mainCount={textCount}
                pinnedCount={pinnedTextCount}
              />
            </nav>

            <div
              ref={tagScrollRef}
              className={`flex min-h-0 flex-1 flex-col gap-2 ${
                animatingCollapse ? "overflow-hidden" : "overflow-y-auto"
              }`}
            >
              {pinnedTags.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <div className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-600">
                    Fissati
                  </div>
                  {pinnedTags.map(renderTag)}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between px-2.5 pb-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                    Tags
                  </span>
            <button
              onClick={() =>
                setSortBy((s) => (s === "name" ? "count" : "name"))
              }
              title={
                sortBy === "name"
                  ? "Ordina per più usati"
                  : "Ordina alfabeticamente"
              }
              className="text-zinc-600 hover:text-zinc-300"
            >
              {sortBy === "name" ? (
                <ArrowDownAZ className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
                {otherTags.length === 0 && tags.length === 0 && (
                  <div className="px-2.5 py-1 text-xs text-zinc-600">
                    nessuna
                  </div>
                )}
                {otherTags.map(renderTag)}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* ActiveBar dei tag fuori dal container scrollabile (evita il
          clipping di overflow-y-auto), ancorata all'aside */}
      <TagActiveBar filter={filter} asideRef={asideRef} scrollRef={tagScrollRef} />
    </aside>
  );
}
