import { useEffect, useRef } from "react";

/// Voce del menu. `divider` introduce un separatore prima della voce.
/// `needsJson` la abilita solo se il contenuto è JSON valido.
type Item = { id: string; label: string; needsJson?: boolean; divider?: boolean };

const TEXT_TRANSFORMS: Item[] = [
  { id: "uppercase", label: "UPPERCASE" },
  { id: "lowercase", label: "lowercase" },
  { id: "capitalize", label: "Capitalize" },
  { id: "title", label: "Title Case" },
  { id: "trim", label: "Trim whitespace" },
  { id: "slugify", label: "Slugify" },
  { id: "remove_breaks", label: "Remove line breaks" },
  { id: "json", label: "Pretty JSON", needsJson: true, divider: true },
  { id: "json_minify", label: "Minify JSON", needsJson: true },
  { id: "base64_encode", label: "Base64 encode", divider: true },
  { id: "base64_decode", label: "Base64 decode" },
  { id: "url_encode", label: "URL encode" },
  { id: "url_decode", label: "URL decode" },
  { id: "md5", label: "MD5 hash", divider: true },
  { id: "sha256", label: "SHA-256 hash" },
  { id: "stats", label: "Count chars / words", divider: true },
];

const IMAGE_TRANSFORMS: Item[] = [
  { id: "base64", label: "Base64" },
  { id: "markdown", label: "Markdown image" },
];

function isJson(text: string): boolean {
  try {
    JSON.parse(text.trim());
    return true;
  } catch {
    return false;
  }
}

/// Popover "Copy as…": elenca le trasformazioni applicabili al clip e ne copia
/// il risultato negli appunti (senza modificare il clip salvato). "Count" mostra
/// invece le statistiche in un toast.
export function TransformPicker({
  isImage,
  content,
  onPick,
  onClose,
}: {
  isImage: boolean;
  content: string | null;
  onPick: (transform: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // chiude cliccando fuori o premendo Esc. La chiusura "uscendo dalla card"
  // è gestita da onMouseLeave in ClipCard.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const jsonOk = !isImage && !!content && isJson(content);
  const items = isImage ? IMAGE_TRANSFORMS : TEXT_TRANSFORMS;

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="anim-scale-in absolute right-0 z-20 mt-1 max-h-72 w-44 origin-top-right overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
    >
      <div className="px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
        Copy as
      </div>
      {items.map((t) => {
        const disabled = t.needsJson === true && !jsonOk;
        return (
          <button
            key={t.id}
            disabled={disabled}
            onClick={() => {
              onPick(t.id);
              onClose();
            }}
            title={disabled ? "Not valid JSON" : undefined}
            className={`flex w-full items-center px-2.5 py-1 text-left text-sm ${
              t.divider ? "mt-1 border-t border-zinc-800 pt-1.5" : ""
            } ${
              disabled
                ? "cursor-not-allowed text-zinc-600"
                : "text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
