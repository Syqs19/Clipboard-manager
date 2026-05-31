import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Trash2 } from "lucide-react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { useCopy } from "../../hooks/useCopy";
import { Toggle } from "../shared/Toggle";
import { ToolButton } from "../shared/ToolButton";
import { humanBytes } from "../../lib/format";

/// Ordina ricorsivamente le chiavi di ogni oggetto (A→Z); array e valori
/// primitivi restano invariati. Usato dal toggle "Sort keys".
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/// Se il testo è un JSON "stringificato" (una stringa che contiene JSON, es.
/// "{\"a\":1}"), lo de-escapa una volta. Altrimenti restituisce il testo com'è.
function tryUnescape(text: string): string {
  const t = text.trim();
  if (!t.startsWith('"')) return text;
  try {
    const inner = JSON.parse(t);
    return typeof inner === "string" ? inner : text;
  } catch {
    return text;
  }
}

/// Statistiche del JSON: numero di chiavi (su tutti gli oggetti), profondità
/// massima di annidamento, dimensione in byte del testo formattato.
function computeStats(value: unknown, formatted: string) {
  let keys = 0;
  let depth = 0;
  const walk = (v: unknown, d: number) => {
    depth = Math.max(depth, d);
    if (Array.isArray(v)) v.forEach((x) => walk(x, d + 1));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      keys += Object.keys(o).length;
      for (const k of Object.keys(o)) walk(o[k], d + 1);
    }
  };
  walk(value, 0);
  const bytes = new TextEncoder().encode(formatted).length;
  return { keys, depth, bytes };
}

/// JSON formatter/validator: input grezzo a sinistra, output formattato (con
/// syntax highlighting) a destra. Validazione live. Opzioni a toggle: ordina
/// chiavi, auto-format, de-escape di JSON stringificato, a-capo, statistiche.
/// Solo frontend.
export function JsonFormatter() {
  const copy = useCopy();
  const [input, setInput] = useState("");
  const [indent, setIndent] = useState(2);
  // opzioni extra (tutte off di default: il tool resta minimale finché non le attivi)
  const [sort, setSort] = useState(false);
  const [autoFormat, setAutoFormat] = useState(false);
  const [unescape, setUnescape] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // testo effettivamente parsato: se "Parse escaped" è attivo, prima de-escapa.
  const effective = useMemo(
    () => (unescape ? tryUnescape(input) : input),
    [input, unescape],
  );

  // parsing una volta sola: valore valido oppure errore (messaggio di JSON.parse).
  const parsed = useMemo<
    { ok: true; value: unknown } | { ok: false; error: string }
  >(() => {
    if (!effective.trim()) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(effective) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [effective]);

  const valid = parsed.ok && parsed.value !== undefined;
  // valore da formattare: undefined se non valido, altrimenti il parsed
  // (eventualmente con chiavi ordinate se il toggle "Sort keys" è attivo).
  const shaped = useMemo(() => {
    if (!parsed.ok || parsed.value === undefined) return undefined;
    return sort ? sortKeys(parsed.value) : parsed.value;
  }, [parsed, sort]);

  const formatted = useMemo(
    () => (shaped === undefined ? "" : JSON.stringify(shaped, null, indent)),
    [shaped, indent],
  );

  const highlighted = useMemo(
    () => (formatted ? hljs.highlight(formatted, { language: "json" }).value : ""),
    [formatted],
  );

  const stats = useMemo(
    () => (valid && showStats ? computeStats(shaped, formatted) : null),
    [valid, showStats, shaped, formatted],
  );

  // Auto-format: quando attivo e il JSON è valido, riscrive l'input formattato.
  // Si autolimita (evita loop) confrontando col testo già formattato.
  useEffect(() => {
    if (!autoFormat || !valid) return;
    if (input !== formatted) setInput(formatted);
  }, [autoFormat, valid, formatted]);

  function applyFormat(spaces: number) {
    if (!valid) return;
    setIndent(spaces);
    setInput(JSON.stringify(shaped, null, spaces));
  }

  function minify() {
    if (!valid) return;
    setInput(JSON.stringify(shaped));
  }

  function copyOutput() {
    if (!formatted) return;
    copy(formatted, "Formatted JSON copied");
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
      {/* toolbar: azioni principali + stato di validazione */}
      <div className="flex flex-wrap items-center gap-2">
        <ToolButton variant="accent" onClick={() => applyFormat(2)} disabled={!valid}>
          Format
        </ToolButton>
        <ToolButton onClick={() => applyFormat(4)} disabled={!valid}>
          4 spaces
        </ToolButton>
        <ToolButton onClick={minify} disabled={!valid}>
          Minify
        </ToolButton>
        <div className="ml-auto flex items-center gap-2">
          <ToolButton icon={Copy} onClick={copyOutput} disabled={!valid}>
            Copy
          </ToolButton>
          <ToolButton icon={Trash2} onClick={() => setInput("")} disabled={!input}>
            Clear
          </ToolButton>
        </div>
      </div>

      {/* opzioni a toggle: tutte spente di default, attivabili a piacere */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
        <Toggle label="Sort keys" checked={sort} onChange={setSort} />
        <Toggle label="Auto-format" checked={autoFormat} onChange={setAutoFormat} />
        <Toggle label="Parse escaped" checked={unescape} onChange={setUnescape} />
        <Toggle label="Wrap lines" checked={wrap} onChange={setWrap} />
        <Toggle label="Stats" checked={showStats} onChange={setShowStats} />
      </div>

      {/* riga di stato della validazione */}
      <div className="min-h-[1.25rem] text-sm">
        {!effective.trim() ? (
          <span className="text-zinc-500">
            Paste JSON on the left to validate and format it.
          </span>
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

      {/* pannelli affiancati: input grezzo → output formattato + highlight */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='{ "paste": "your JSON here" }'
          spellCheck={false}
          className={`min-h-0 resize-none rounded-lg border bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
            wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
          } ${
            parsed.ok
              ? "border-zinc-700/60 focus:border-accent/50"
              : "border-red-500/50"
          }`}
        />
        <div className="flex min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
            {highlighted ? (
              // sicuro: highlight.js fa l'escape dell'HTML del contenuto (come in
              // CodeBlock); inoltre il testo è già passato per JSON.parse/stringify.
              <pre
                className={`text-sm ${
                  wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                }`}
              >
                <code dangerouslySetInnerHTML={{ __html: highlighted }} />
              </pre>
            ) : (
              <span className="text-sm text-zinc-600">
                {parsed.ok
                  ? "Formatted output appears here."
                  : "Fix the error to see the output."}
              </span>
            )}
          </div>
          {/* statistiche (toggle Stats) */}
          {stats && (
            <div className="shrink-0 rounded-md border border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 font-mono text-xs text-zinc-400">
              {stats.keys} keys · depth {stats.depth} · {humanBytes(stats.bytes)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
