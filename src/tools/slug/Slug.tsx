import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

/// Trasforma un testo in slug URL-friendly: rimuove accenti/diacritici
/// (normalize NFD), porta in minuscolo, e collassa tutto ciò che non è
/// alfanumerico nel separatore scelto.
function slugify(text: string, sep: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritici
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`\\${sep}+`, "g"), sep)
    .replace(new RegExp(`^\\${sep}|\\${sep}$`, "g"), "");
}

/// Tronca lo slug a `max` caratteri senza spezzare una parola a metà (taglia
/// all'ultimo separatore prima del limite).
function clamp(slug: string, max: number, sep: string): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const lastSep = cut.lastIndexOf(sep);
  return lastSep > 0 ? cut.slice(0, lastSep) : cut;
}

export function Slug() {
  const notify = useNotify();
  const [input, setInput] = useState("");
  const [sep, setSep] = useState("-");
  const [limit, setLimit] = useState(false);
  const [maxLen, setMaxLen] = useState(50);

  const slug = useMemo(() => {
    const s = slugify(input, sep);
    return limit ? clamp(s, maxLen, sep) : s;
  }, [input, sep, limit, maxLen]);

  async function copy() {
    if (slug) {
      await navigator.clipboard.writeText(slug);
      notify("Slug copied", "success");
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Café à Paris — 10 Best Tips!"
        spellCheck={false}
        rows={3}
        className="resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-400">
        <div className="flex items-center gap-2">
          Separator:
          {["-", "_"].map((s) => (
            <button
              key={s}
              onClick={() => setSep(s)}
              className={`rounded-md border px-2.5 py-0.5 font-mono transition-colors ${
                sep === s ? "border-accent/50 bg-accent/10 text-accent" : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" checked={limit} onChange={(e) => setLimit(e.target.checked)} className="h-4 w-4 accent-accent" />
          Max length
        </label>
        {limit && (
          <input
            type="number"
            min={5}
            max={200}
            value={maxLen}
            onChange={(e) => setMaxLen(Math.min(200, Math.max(5, Number(e.target.value) || 50)))}
            className="w-16 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1 text-zinc-200 focus:border-accent/50 focus:outline-none"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
          {slug || <span className="text-zinc-600">slug appears here</span>}
        </code>
        <button onClick={copy} disabled={!slug} className="shrink-0 rounded-md border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50">
          <Copy className="h-4 w-4" />
        </button>
      </div>
      {slug && <span className="font-mono text-xs text-zinc-600">{slug.length} characters</span>}
    </div>
  );
}
