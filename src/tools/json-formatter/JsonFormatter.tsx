import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Trash2 } from "lucide-react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { useNotify } from "../../components/Toaster";

/// JSON formatter/validator: a sinistra incolli il JSON grezzo, a destra vedi
/// il risultato formattato con syntax highlighting. Validazione live: se il
/// parsing fallisce, mostra il messaggio d'errore di JSON.parse. Solo frontend.
export function JsonFormatter() {
  const notify = useNotify();
  const [input, setInput] = useState("");
  // indentazione corrente del Format (2 spazi di default)
  const [indent, setIndent] = useState(2);

  // parsing una volta sola: o il valore, o l'errore. Ricalcola al cambio input.
  const parsed = useMemo<
    { ok: true; value: unknown } | { ok: false; error: string }
  >(() => {
    if (!input.trim()) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(input) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [input]);

  const valid = parsed.ok && parsed.value !== undefined;

  // testo formattato dell'output (vuoto se input vuoto o non valido)
  const formatted = useMemo(() => {
    if (!parsed.ok || parsed.value === undefined) return "";
    return JSON.stringify(parsed.value, null, indent);
  }, [parsed, indent]);

  // highlight dell'output (solo quando valido)
  const highlighted = useMemo(
    () => (formatted ? hljs.highlight(formatted, { language: "json" }).value : ""),
    [formatted],
  );

  function applyFormat(spaces: number) {
    if (!parsed.ok || parsed.value === undefined) return;
    setIndent(spaces);
    setInput(JSON.stringify(parsed.value, null, spaces));
  }

  function minify() {
    if (!parsed.ok || parsed.value === undefined) return;
    setInput(JSON.stringify(parsed.value));
  }

  async function copyOutput() {
    if (!formatted) return;
    await navigator.clipboard.writeText(formatted);
    notify("Formatted JSON copied", "success");
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
      {/* toolbar: azioni + stato di validazione */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => applyFormat(2)}
          disabled={!valid}
          className="rounded-md border border-accent/40 px-2.5 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
        >
          Format
        </button>
        <button
          onClick={() => applyFormat(4)}
          disabled={!valid}
          className="rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
        >
          4 spaces
        </button>
        <button
          onClick={minify}
          disabled={!valid}
          className="rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
        >
          Minify
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={copyOutput}
            disabled={!valid}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button
            onClick={() => setInput("")}
            disabled={!input}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {/* riga di stato della validazione */}
      <div className="min-h-[1.25rem] text-sm">
        {!input.trim() ? (
          <span className="text-zinc-500">Paste JSON on the left to validate and format it.</span>
        ) : parsed.ok ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Valid JSON
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-red-400">
            <AlertCircle className="h-4 w-4" /> {parsed.error}
          </span>
        )}
      </div>

      {/* pannelli affiancati: input (grezzo) → output (formattato + highlight) */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='{ "paste": "your JSON here" }'
          spellCheck={false}
          className={`min-h-0 resize-none rounded-lg border bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
            parsed.ok
              ? "border-zinc-700/60 focus:border-accent/50"
              : "border-red-500/50"
          }`}
        />
        <div className="min-h-0 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
          {highlighted ? (
            // sicuro: highlight.js fa l'escape dell'HTML del contenuto (come in
            // CodeBlock); inoltre il testo è già passato per JSON.parse/stringify.
            <pre className="whitespace-pre text-sm">
              <code dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
          ) : (
            <span className="text-sm text-zinc-600">
              {parsed.ok ? "Formatted output appears here." : "Fix the error to see the output."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
