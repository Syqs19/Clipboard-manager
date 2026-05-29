import { Boxes, FileText } from "lucide-react";
import { type ClipItem } from "../lib/api";
import { useImageUrl } from "../lib/useImageUrl";

/// Miniatura di un singolo elemento-immagine del gruppo.
function ItemThumb({ item }: { item: ClipItem }) {
  const url = useImageUrl(item.thumb_path ?? item.image_path);
  return url ? (
    <img
      src={url}
      alt={item.label ?? ""}
      draggable={false}
      className="h-16 w-16 rounded border border-zinc-700 object-cover"
    />
  ) : (
    <div className="h-16 w-16 rounded border border-dashed border-zinc-700" />
  );
}

/// Etichetta del primo file di un item 'files' (basename del primo path).
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

/// Anteprima aggregata di una clip-gruppo nella lista: badge col conteggio +
/// griglia di thumbnail per le immagini, elenco compatto per testi/file.
export function GroupPreview({ items }: { items: ClipItem[] }) {
  const type = items[0]?.item_type ?? "text";
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        <Boxes className="h-3.5 w-3.5" />
        Group · {items.length}
      </div>

      {type === "image" ? (
        <div className="flex flex-wrap gap-1.5">
          {shown.map((it) => (
            <ItemThumb key={it.id} item={it} />
          ))}
          {extra > 0 && (
            <div className="flex h-16 w-16 items-center justify-center rounded border border-zinc-700 text-xs text-zinc-400">
              +{extra}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {shown.map((it) => (
            <div
              key={it.id}
              className="flex items-center gap-1.5 text-sm text-zinc-200"
            >
              {type === "files" && (
                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              )}
              {it.label && (
                <span className="shrink-0 rounded bg-zinc-700/60 px-1 text-[10px] text-zinc-300">
                  {it.label}
                </span>
              )}
              <span className="min-w-0 truncate">
                {type === "files"
                  ? fileItemName(it.content)
                  : it.content ?? ""}
              </span>
            </div>
          ))}
          {extra > 0 && (
            <div className="text-xs text-zinc-500">+{extra} more</div>
          )}
        </div>
      )}
    </div>
  );
}
