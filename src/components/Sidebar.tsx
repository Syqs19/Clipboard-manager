import { useLayoutEffect, useRef, useState } from "react";
import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import { useExitAnimation } from "../lib/useExitAnimation";
import { UpdateButton } from "./UpdateButton";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Boxes,
  ChevronDown,
  FileText,
  Image,
  Inbox,
  Palette,
  Pin,
  Star,
  Tags,
  Type,
  Wrench,
} from "lucide-react";
import { tagColor } from "../lib/format";
import { type Tag } from "../lib/api";

/// Macro-categorie (sezioni) della sidebar: ognuna ha un header collassabile e
/// guida cosa mostra l'area principale. "clipboard" è quella storica.
export type Section = "clipboard" | "tools" | "design";

/// Categorie principali della sidebar. "tags" è la categoria-contenitore: come
/// "groups", se attiva espande sotto i singoli tag e filtra le clip con ≥1 tag.
export type MainKind = "all" | "images" | "files" | "text" | "groups" | "tags";

/// Sotto-tipo dei gruppi (per le sotto-voci di "Groups").
export type GroupType = "image" | "files" | "text";

export type Filter =
  | { kind: MainKind; pinned?: boolean; groupType?: GroupType }
  | { kind: "tag"; name: string; pinned?: boolean };

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
      className={`flex w-full items-center gap-2 rounded-md py-1.5 pl-2.5 pr-5 text-sm transition-colors ${
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
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  /// icona della sub-voce (default: il pin ambra usato da "Pinned").
  icon?: React.ReactNode;
}) {
  // 330ms = durata orizzontale (160) + delay verticale (150) + buffer
  const guide = useExitAnimation(active, 340);
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-2 rounded-md py-1 pl-9 pr-5 text-xs transition-colors ${
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
            } pointer-events-none absolute -left-1 -top-1 h-[calc(50%+4px)] w-0.5 rounded-full bg-accent`}
          />
          <span
            aria-hidden
            className={`${
              guide.exiting ? "guide-shrink-x" : "guide-grow-x"
            } pointer-events-none absolute -left-1 top-1/2 h-0.5 w-[24px] rounded-full bg-accent`}
          />
        </>
      )}
      {icon ?? <Pin className="h-3 w-3 shrink-0 text-amber-400/80" />}
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
          label="Pinned"
          count={pinnedCount}
        />
      )}
    </>
  );
}

/// Voce "Groups" con sotto-voci per tipo (Images/Files/Text), mostrate solo
/// quando la sezione è attiva. Replica lo stile di CategoryWithPinned.
function GroupsCategory({
  filter,
  onSelect,
  mainCount,
}: {
  filter: Filter;
  onSelect: (f: Filter) => void;
  mainCount: number;
}) {
  const sectionActive = filter.kind === "groups";
  const gt = filter.kind === "groups" ? filter.groupType : undefined;
  const subs: { type: GroupType; label: string; icon: React.ReactNode }[] = [
    { type: "image", label: "Images", icon: <Image className="h-3 w-3 shrink-0 text-zinc-500" /> },
    { type: "files", label: "Files", icon: <FileText className="h-3 w-3 shrink-0 text-zinc-500" /> },
    { type: "text", label: "Text", icon: <Type className="h-3 w-3 shrink-0 text-zinc-500" /> },
  ];
  return (
    <>
      <Item
        active={sectionActive && !gt}
        sectionActive={sectionActive}
        onClick={() => onSelect({ kind: "groups" })}
        icon={<Boxes className="h-4 w-4" />}
        label="Groups"
        count={mainCount}
      />
      {sectionActive &&
        subs.map((s) => (
          <SubItem
            key={s.type}
            active={gt === s.type}
            onClick={() => onSelect({ kind: "groups", groupType: s.type })}
            label={s.label}
            icon={s.icon}
          />
        ))}
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
      className={`pointer-events-none absolute -left-1 w-0.5 rounded-full bg-accent transition-all duration-200 ease-out ${
        pos ? "opacity-100" : "opacity-0"
      }`}
      style={pos ? { top: pos.top, height: pos.height } : undefined}
    />
  );
}

/// Riga di un tag: è una sotto-voce di "Tags" (stessa indentazione/dimensione
/// dei "Pinned" delle categorie, con guida-L), ma conserva le funzioni proprie
/// del tag: pallino colore, stella per fissarlo, rinomina (doppio click), drop
/// di una clip per assegnarlo. La barretta verticale resta su "Tags": qui c'è
/// solo la guida-L. Quando il tag è attivo mostra sotto un "Pinned" di terzo
/// livello (ancora più indentato).
function TagRow({
  name,
  count,
  color,
  pinned,
  pinnedCount,
  filter,
  onSelect,
  onSetColor,
  onTogglePinned,
  onRename,
}: {
  name: string;
  count: number;
  color: string;
  pinned: boolean;
  pinnedCount: number;
  filter: Filter;
  onSelect: (f: Filter) => void;
  onSetColor: (color: string) => void;
  onTogglePinned: () => void;
  onRename: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  // flash "pop" di conferma quando una card viene rilasciata su questo tag
  const [received, setReceived] = useState(false);

  const sectionActive = filter.kind === "tag" && filter.name === name;
  const mainActive = sectionActive && !filter.pinned;
  const pinnedActive = sectionActive && filter.pinned === true;
  // guida-L: si disegna quando il tag è selezionato (anche con Pinned attivo)
  const guide = useExitAnimation(sectionActive, 340);
  // guida-L della sotto-voce "Pinned" del tag (terzo livello)
  const pinnedGuide = useExitAnimation(pinnedActive, 340);

  // droppable: trascinando una card su questa riga si aggiunge il tag alla clip
  const { setNodeRef, isOver } = useDroppable({ id: `tag:${name}` });
  useDndMonitor({
    onDragEnd: ({ over }) => {
      if (over?.id !== `tag:${name}`) return;
      setReceived(true);
      window.setTimeout(() => setReceived(false), 420);
    },
  });

  const commit = () => {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== name) onRename(v);
    else setDraft(name);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        className={`group relative flex w-full min-w-0 items-center gap-2 rounded-md py-1 pl-9 pr-5 text-xs transition-colors ${
          isOver ? "anim-tag-hover bg-accent/10" : ""
        } ${received ? "anim-tag-received" : ""} ${
          mainActive
            ? "bg-zinc-700/40 text-zinc-100"
            : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
        }`}
      >
        {/* guida ad L verde, come nei SubItem delle categorie */}
        {guide.mounted && (
          <>
            <span
              aria-hidden
              className={`${
                guide.exiting ? "guide-shrink-y" : "guide-grow-y"
              } pointer-events-none absolute -left-1 -top-1 h-[calc(50%+4px)] w-0.5 rounded-full bg-accent`}
            />
            <span
              aria-hidden
              className={`${
                guide.exiting ? "guide-shrink-x" : "guide-grow-x"
              } pointer-events-none absolute -left-1 top-1/2 h-0.5 w-[24px] rounded-full bg-accent`}
            />
          </>
        )}
        {/* pallino colore sempre a sinistra: cliccabile per cambiare il colore */}
        <input
          type="color"
          value={color}
          onChange={(e) => onSetColor(e.target.value)}
          title="Pick a color"
          className="h-3 w-3 shrink-0 cursor-pointer rounded-full"
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
            className="min-w-0 flex-1 rounded bg-zinc-700/60 px-1 text-xs text-zinc-100 outline-none ring-1 ring-zinc-600"
          />
        ) : (
          <button
            onClick={() => onSelect({ kind: "tag", name })}
            onDoubleClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            title="Double-click to rename"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="block max-w-[90px] flex-1 truncate md:max-w-[150px]">
              {name}
            </span>
            <span className="shrink-0 text-[10px] text-zinc-600">{count}</span>
          </button>
        )}
        {/* stella: mostrata se il tag è pinnato o quando è selezionato */}
        {(sectionActive || pinned) && (
          <button
            onClick={onTogglePinned}
            title={pinned ? "Unpin tag" : "Pin tag"}
            className={`shrink-0 ${
              pinned ? "text-amber-400" : "text-zinc-500 hover:text-zinc-200"
            }`}
          >
            <Star className={`h-3 w-3 ${pinned ? "fill-amber-400" : ""}`} />
          </button>
        )}
      </div>
      {/* "Pinned" del tag: terzo livello, ancora più indentato e piccolo */}
      {sectionActive && pinnedCount > 0 && (
        <button
          onClick={() => onSelect({ kind: "tag", name, pinned: true })}
          className={`relative flex w-full items-center gap-2 rounded-md py-0.5 pl-[3.75rem] pr-5 text-[11px] transition-colors ${
            pinnedActive
              ? "bg-zinc-700/40 text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
          }`}
        >
          {/* guida ad L verde del terzo livello: rientra dalla colonna del tag
              (≈ icona del tag padre) verso l'icona del Pinned */}
          {pinnedGuide.mounted && (
            <>
              <span
                aria-hidden
                className={`${
                  pinnedGuide.exiting ? "guide-shrink-y" : "guide-grow-y"
                } pointer-events-none absolute left-[2.1rem] -top-1 h-[calc(50%+4px)] w-0.5 rounded-full bg-accent`}
              />
              <span
                aria-hidden
                className={`${
                  pinnedGuide.exiting ? "guide-shrink-x" : "guide-grow-x"
                } pointer-events-none absolute left-[2.1rem] top-1/2 h-0.5 w-[20px] rounded-full bg-accent`}
              />
            </>
          )}
          <Pin className="h-2.5 w-2.5 shrink-0 text-amber-400/80" />
          <span className="flex-1 truncate text-left">Pinned</span>
          <span className="text-[10px] text-zinc-600">{pinnedCount}</span>
        </button>
      )}
    </>
  );
}

/// Header di una macro-sezione: icona + label + chevron. Cliccandolo si attiva
/// la sezione (e nell'accordion si chiudono le altre). Replica lo stile del
/// vecchio brand header "Clipboard".
function SectionHeader({
  section,
  icon,
  label,
  open,
  collapsible,
  active,
  onClick,
}: {
  section: Section;
  icon: React.ReactNode;
  label: string;
  /** Solo per le sezioni collassabili: ruota il chevron. */
  open: boolean;
  /** Clipboard è collassabile (ha sotto-voci); Tools/Design sono solo cliccabili. */
  collapsible: boolean;
  /** Sezione attualmente selezionata: evidenzia leggermente l'header. */
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-zinc-800/40 ${
        active ? "bg-zinc-800/30" : ""
      }`}
    >
      {/* badge col colore FISSO della sezione: `data-section` fa risolvere la
          terna --accent dalla stessa regola CSS di index.css (fonte unica), così
          il badge mostra il colore della sua sezione a prescindere da quella attiva.
          key legata ad `active`: quando la sezione viene selezionata il nodo si
          rimonta e fa il pop di conferma (.anim-pop). */}
      <span
        key={active ? "on" : "off"}
        data-section={section}
        className={`relative inline-flex h-7 w-7 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent shadow-[0_0_18px_-4px_rgb(var(--accent)/0.45)] ${
          active ? "anim-section-pop" : ""
        }`}
      >
        {icon}
      </span>
      <span className="flex-1 text-[15px] font-semibold tracking-tight text-zinc-100">
        {label}
      </span>
      {collapsible && (
        <ChevronDown
          className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
      )}
    </button>
  );
}

/// Wrapper collassabile del contenuto di una sezione: replica l'animazione
/// grid-rows usata in origine dalla Clipboard.
function SectionBody({
  open,
  animating,
  children,
}: {
  open: boolean;
  animating: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid transition-all duration-200 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div
        className={`flex min-h-0 flex-col gap-2 ${
          animating || !open ? "overflow-hidden" : "overflow-visible"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function Sidebar({
  activeSection,
  onSectionChange,
  filter,
  onSelect,
  tags,
  imageCount,
  fileCount,
  textCount,
  groupCount,
  tagsCount,
  totalCount,
  pinnedAllCount,
  pinnedImageCount,
  pinnedFileCount,
  pinnedTextCount,
  pinnedByTag,
  onSetTagColor,
  onSetTagPinned,
  onRenameTag,
}: {
  activeSection: Section | null;
  onSectionChange: (s: Section | null) => void;
  filter: Filter;
  onSelect: (f: Filter) => void;
  tags: Tag[];
  imageCount: number;
  fileCount: number;
  textCount: number;
  groupCount: number;
  tagsCount: number;
  totalCount: number;
  pinnedAllCount: number;
  pinnedImageCount: number;
  pinnedFileCount: number;
  pinnedTextCount: number;
  pinnedByTag: Map<string, number>;
  onSetTagColor: (name: string, color: string) => void;
  onSetTagPinned: (name: string, pinned: boolean) => void;
  onRenameTag: (oldName: string, newName: string) => void;
}) {
  const [sortBy, setSortBy] = useState<"name" | "count">("name");
  // accordion: la sezione aperta coincide con quella attiva.
  const clipboardOpen = activeSection === "clipboard";
  // categoria "Tags": attiva (espansa) sia sul contenitore che su un tag
  // specifico; "main" = riga Tags evidenziata (contenitore, non un tag).
  const tagsSectionActive = filter.kind === "tags" || filter.kind === "tag";
  const tagsMainActive = filter.kind === "tags";
  // durante la transizione collapse del Clipboard wrapper disabilito lo
  // scroll del container tag per evitare il flash della scrollbar.
  const [animatingCollapse, setAnimatingCollapse] = useState(false);
  // toggle di una sezione: se è già aperta la chiude (null), altrimenti la apre
  // chiudendo le altre (accordion).
  const toggleSection = (s: Section) => {
    setAnimatingCollapse(true);
    onSectionChange(s === activeSection ? null : s);
    window.setTimeout(() => setAnimatingCollapse(false), 220);
  };
  const compare = (a: Tag, b: Tag) =>
    sortBy === "count"
      ? b.count - a.count || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name);
  const pinnedTags = tags.filter((t) => t.pinned).sort(compare);
  const otherTags = tags.filter((t) => !t.pinned).sort(compare);
  const renderTag = ({ name, count, color, pinned }: Tag) => (
    <TagRow
      key={name}
      name={name}
      count={count}
      color={tagColor(name, color)}
      pinned={pinned}
      pinnedCount={pinnedByTag.get(name) ?? 0}
      filter={filter}
      onSelect={onSelect}
      onSetColor={(c) => onSetTagColor(name, c)}
      onTogglePinned={() => onSetTagPinned(name, !pinned)}
      onRename={(newName) => onRenameTag(name, newName)}
    />
  );
  return (
    <aside
      className="relative flex h-full w-44 shrink-0 flex-col overflow-x-hidden border-r border-zinc-800/60 bg-zinc-900/40 p-4 backdrop-blur-md md:w-60"
    >
      {/* unico contenitore scrollabile: le 3 sezioni si impilano dall'alto e,
          se non entrano, scorre l'intera colonna. L'UpdateButton resta fuori,
          fisso in fondo. pl-2/-ml-2: spazio interno a sinistra per la barretta
          verde (-left-1), che l'overflow-x-hidden taglierebbe; il -ml-2 riporta
          il contenuto nella posizione originale senza spostarlo. */}
      <div className="-ml-2 flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto pl-2">
      {/* Sezione Clipboard: header + voci (categorie + tag) */}
      <SectionHeader
        section="clipboard"
        open={clipboardOpen}
        collapsible
        active={activeSection === "clipboard"}
        onClick={() => toggleSection("clipboard")}
        label="Clipboard"
        icon={
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
        }
      />

      <SectionBody open={clipboardOpen} animating={animatingCollapse}>
        <div className="flex flex-col gap-2 pt-3">
            <nav className="relative flex flex-col gap-0.5">
              <ActiveBar
                deps={[
                  filter.kind,
                  filter.kind === "tag" ? filter.name : null,
                  filter.pinned,
                ]}
              />
              <CategoryWithPinned
                mainKind="all"
                filter={filter}
                onSelect={onSelect}
                icon={<Inbox className="h-4 w-4" />}
                label="All"
                mainCount={totalCount}
                pinnedCount={pinnedAllCount}
              />
              <CategoryWithPinned
                mainKind="images"
                filter={filter}
                onSelect={onSelect}
                icon={<Image className="h-4 w-4" />}
                label="Images"
                mainCount={imageCount}
                pinnedCount={pinnedImageCount}
              />
              <CategoryWithPinned
                mainKind="files"
                filter={filter}
                onSelect={onSelect}
                icon={<FileText className="h-4 w-4" />}
                label="Files"
                mainCount={fileCount}
                pinnedCount={pinnedFileCount}
              />
              <CategoryWithPinned
                mainKind="text"
                filter={filter}
                onSelect={onSelect}
                icon={<Type className="h-4 w-4" />}
                label="Text"
                mainCount={textCount}
                pinnedCount={pinnedTextCount}
              />
              {groupCount > 0 && (
                <GroupsCategory
                  filter={filter}
                  onSelect={onSelect}
                  mainCount={groupCount}
                />
              )}

              {/* "Tags": categoria-contenitore come "Groups". La riga è sempre
                  presente; selezionandola si attiva (filtra le clip taggate) e
                  sotto compaiono i singoli tag. Si chiude scegliendo altro. */}
              {tagsCount > 0 && (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div
                    data-active={tagsSectionActive ? "true" : undefined}
                    className={`flex items-center rounded-md text-sm transition-colors ${
                      tagsMainActive
                        ? "bg-zinc-700/60 text-zinc-100"
                        : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                    }`}
                  >
                    <button
                      onClick={() => onSelect({ kind: "tags" })}
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 text-left"
                    >
                      <span className="text-zinc-500">
                        <Tags className="h-4 w-4" />
                      </span>
                      <span className="flex-1 truncate">Tags</span>
                      <span className="text-xs text-zinc-500">{tagsCount}</span>
                    </button>
                    {/* ordinamento: visibile solo quando la sezione è attiva */}
                    {tagsSectionActive && (
                      <button
                        onClick={() =>
                          setSortBy((s) => (s === "name" ? "count" : "name"))
                        }
                        title={
                          sortBy === "name"
                            ? "Sort by most used"
                            : "Sort alphabetically"
                        }
                        className="px-2 text-zinc-600 hover:text-zinc-300"
                      >
                        {sortBy === "name" ? (
                          <ArrowDownAZ className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  {/* singoli tag: visibili solo se la sezione "Tags" è attiva */}
                  {tagsSectionActive && (
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {pinnedTags.length > 0 && (
                        <>
                          <div className="px-2.5 pb-1 pl-9 text-xs font-medium uppercase tracking-wide text-zinc-600">
                            Pinned
                          </div>
                          {pinnedTags.map(renderTag)}
                        </>
                      )}
                      {otherTags.map(renderTag)}
                    </div>
                  )}
                </div>
              )}
            </nav>
        </div>
      </SectionBody>

      {/* Sezione Strumenti: voce cliccabile (la griglia dei tool vive nel main). */}
      <div className="mt-1">
        <SectionHeader
          section="tools"
          open={false}
          collapsible={false}
          active={activeSection === "tools"}
          onClick={() => toggleSection("tools")}
          label="Tools"
          icon={<Wrench className="h-4 w-4" />}
        />
      </div>

      {/* Sezione Design: voce cliccabile (contenuto nel main, in arrivo). */}
      <div className="mt-1">
        <SectionHeader
          section="design"
          open={false}
          collapsible={false}
          active={activeSection === "design"}
          onClick={() => toggleSection("design")}
          label="Design"
          icon={<Palette className="h-4 w-4" />}
        />
      </div>
      </div>

      {/* Update button: appare solo quando c'e' un update disponibile */}
      <UpdateButton />
    </aside>
  );
}
