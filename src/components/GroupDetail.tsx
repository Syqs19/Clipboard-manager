import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { api, type Clip, type ClipItem } from "../lib/api";
import { useImageUrl } from "../lib/useImageUrl";
import { useExitAnimation } from "../lib/useExitAnimation";

/// Nome del primo file (basename) di un item 'files'.
function fileItemName(content: string | null): string {
  if (!content) return "file";
  try {
    const paths = JSON.parse(content);
    if (Array.isArray(paths) && paths.length > 0) {
      const name = String(paths[0]).split(/[\\/]/).pop() || String(paths[0]);
      return paths.length > 1 ? `${name} +${paths.length - 1}` : name;
    }
  } catch {
    /* ignora */
  }
  return "file";
}

/// Riga di un singolo elemento nella vista dettaglio.
function ItemRow({
  item,
  onCopy,
  onLabel,
  onZoom,
}: {
  item: ClipItem;
  onCopy: () => void;
  onLabel: (label: string) => void;
  onZoom: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState(item.label ?? "");
  const thumb = useImageUrl(
    item.item_type === "image" ? item.thumb_path ?? item.image_path : null,
  );

  const copy = () => {
    onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex items-start gap-3 border-b border-zinc-800 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        {/* etichetta editabile: solo per gli elementi di testo */}
        {item.item_type === "text" || item.item_type === "url" ? (
          <input
            value={label}
            placeholder="label (e.g. email)"
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label !== (item.label ?? "") && onLabel(label)}
            className="mb-1 w-40 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-300 outline-none ring-1 ring-zinc-700 placeholder:text-zinc-600 focus:ring-zinc-600"
          />
        ) : null}
        {item.item_type === "image" ? (
          thumb ? (
            <img
              src={thumb}
              alt=""
              onClick={() => item.image_path && onZoom(item.image_path)}
              className="max-h-32 cursor-zoom-in rounded border border-zinc-700 object-contain transition hover:brightness-110"
            />
          ) : (
            <div className="h-20 w-20 rounded border border-dashed border-zinc-700" />
          )
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">
            {item.item_type === "files"
              ? fileItemName(item.content)
              : item.content ?? ""}
          </p>
        )}
      </div>
      <button
        onClick={copy}
        title="Copy this item"
        className="shrink-0 rounded-md border border-zinc-700 p-2 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        {copied ? (
          <Check className="h-4 w-4 text-emerald-400" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

/// Vista dettaglio di una clip-gruppo: elenco degli elementi, etichetta
/// editabile sui testi, copia per singolo elemento.
export function GroupDetail({
  clip,
  onClose,
}: {
  clip: Clip | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ClipItem[]>([]);
  const [zoomPath, setZoomPath] = useState<string | null>(null);
  const exit = useExitAnimation(clip != null, 200, onClose);

  useEffect(() => {
    if (clip) api.listClipItems(clip.id).then(setItems);
  }, [clip]);

  if (!exit.mounted || !clip) return null;
  const close = exit.requestClose;

  return (
    <div
      onClick={close}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${
        exit.exiting ? "anim-fade-out" : "anim-fade-in"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl ${
          exit.exiting ? "anim-scale-out" : "anim-scale-in"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            Group · {items.length} items
          </h2>
          <button
            onClick={close}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5">
          {items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              onCopy={() => api.copyClipItem(it.id)}
              onLabel={(label) => api.setItemLabel(it.id, label || null)}
              onZoom={setZoomPath}
            />
          ))}
        </div>
      </div>

      {/* lightbox full-size dell'immagine di un elemento */}
      {zoomPath && <ItemZoom path={zoomPath} onClose={() => setZoomPath(null)} />}
    </div>
  );
}

/// Overlay full-size per ingrandire un'immagine-elemento del gruppo.
function ItemZoom({ path, onClose }: { path: string; onClose: () => void }) {
  const url = useImageUrl(path);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8"
    >
      {url && (
        <img
          src={url}
          alt=""
          className="anim-scale-in max-h-[85vh] max-w-full rounded-lg border border-zinc-700 object-contain shadow-2xl"
        />
      )}
    </div>
  );
}
