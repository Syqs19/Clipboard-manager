import { useMemo, useState } from "react";
import { ArrowUpDown, Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

/// Codifica i caratteri HTML "pericolosi" in entità. Con `all` codifica anche
/// ogni carattere non-ASCII come entità numerica (&#NNN;), utile per embeddare
/// testo con accenti/emoji in HTML che non è UTF-8.
function encode(text: string, all: boolean): string {
  let out = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  if (all) {
    // ogni carattere non-ASCII (codepoint > 127) → entità numerica decimale.
    // codePointAt + spread gestisce correttamente anche le emoji (coppie surrogate).
    out = [...out]
      .map((c) => {
        const cp = c.codePointAt(0)!;
        return cp > 127 ? `&#${cp};` : c;
      })
      .join("");
  }
  return out;
}

/// Decodifica le entità HTML in modo SICURO: DOMParser parsifica il markup senza
/// eseguirlo (niente innerHTML, niente script). Leggiamo solo il testo risultante.
function decode(text: string): string {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return doc.documentElement.textContent ?? "";
}

export function HtmlEntities() {
  const notify = useNotify();
  const [decodeMode, setDecodeMode] = useState(false);
  const [encodeAll, setEncodeAll] = useState(false);
  const [input, setInput] = useState("");

  const out = useMemo(
    () => (input ? (decodeMode ? decode(input) : encode(input, encodeAll)) : ""),
    [input, decodeMode, encodeAll],
  );

  async function copyOut() {
    if (out) {
      await navigator.clipboard.writeText(out);
      notify("Output copied", "success");
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {[false, true].map((d) => (
            <button
              key={String(d)}
              onClick={() => setDecodeMode(d)}
              className={`px-3 py-1 text-sm transition-colors ${
                decodeMode === d ? "bg-accent/15 text-accent" : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {d ? "Decode" : "Encode"}
            </button>
          ))}
        </div>
        {/* encode-all ha senso solo in modalità Encode */}
        <label
          className={`flex items-center gap-1.5 text-sm ${
            decodeMode ? "cursor-not-allowed text-zinc-600" : "cursor-pointer text-zinc-400"
          }`}
        >
          <input
            type="checkbox"
            checked={encodeAll}
            disabled={decodeMode}
            onChange={(e) => setEncodeAll(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Encode all non-ASCII
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => out && (setInput(out), setDecodeMode((d) => !d))}
            disabled={!out}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <ArrowUpDown className="h-3.5 w-3.5" /> Swap
          </button>
          <button onClick={copyOut} disabled={!out} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50">
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={decodeMode ? "&lt;div&gt; &amp; &copy;" : "<div> & © …"}
          spellCheck={false}
          className="min-h-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        <div className="min-h-0 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
          {out ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">{out}</pre>
          ) : (
            <span className="text-sm text-zinc-600">Output appears here.</span>
          )}
        </div>
      </div>
    </div>
  );
}
