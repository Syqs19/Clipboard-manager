import { useMemo, useState } from "react";
import { AlertCircle, Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

const FLAGS = [
  ["g", "global"],
  ["i", "ignore case"],
  ["m", "multiline"],
  ["s", "dotall"],
  ["u", "unicode"],
  ["y", "sticky"],
] as const;

/// Riferimento rapido dei pattern più comuni: cliccando si inserisce il token
/// nel pattern (utile per chi non ricorda la sintassi a memoria).
const CHEATSHEET: [string, string][] = [
  ["\\d", "digit"],
  ["\\w", "word char"],
  ["\\s", "whitespace"],
  [".", "any char"],
  ["[a-z]", "range"],
  ["+", "1 or more"],
  ["*", "0 or more"],
  ["?", "optional"],
  ["^", "start"],
  ["$", "end"],
  ["(…)", "group"],
  ["a|b", "or"],
];

type MatchInfo = { start: number; end: number; text: string; groups: string[] };

/// Regex tester: scrivi una regex + flag e un testo; evidenzia i match live,
/// mostra i gruppi di cattura. Tutto con RegExp nativo (nessuna dipendenza).
export function Regex() {
  const notify = useNotify();
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [replacement, setReplacement] = useState("");

  const result = useMemo<
    | { ok: true; matches: MatchInfo[] }
    | { ok: false; err: string }
    | null
  >(() => {
    if (!pattern) return null;
    let re: RegExp;
    try {
      // forza 'g' per iterare tutti i match nell'evidenziazione, ma ricordando
      // se l'utente l'aveva messo (per il conteggio è indifferente).
      re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
    const matches: MatchInfo[] = [];
    if (text) {
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) !== null && guard++ < 10000) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          groups: m.slice(1).map((g) => g ?? ""),
        });
        if (m[0] === "") re.lastIndex++; // evita loop su match vuoti
      }
    }
    return { ok: true, matches };
  }, [pattern, flags, text]);

  // segmenti del testo con evidenziazione dei match
  const highlighted = useMemo(() => {
    if (!result || !result.ok || result.matches.length === 0) return null;
    const segs: { text: string; match: boolean }[] = [];
    let cursor = 0;
    for (const m of result.matches) {
      if (m.start > cursor) segs.push({ text: text.slice(cursor, m.start), match: false });
      segs.push({ text: text.slice(m.start, m.end), match: true });
      cursor = m.end;
    }
    if (cursor < text.length) segs.push({ text: text.slice(cursor), match: false });
    return segs;
  }, [result, text]);

  // risultato della sostituzione (usa i riferimenti $1, $2… del replacement)
  const replaced = useMemo(() => {
    if (!showReplace || !result || !result.ok || !pattern) return null;
    try {
      const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      return text.replace(re, replacement);
    } catch {
      return null;
    }
  }, [showReplace, result, pattern, flags, text, replacement]);

  function toggleFlag(f: string) {
    setFlags((prev) => (prev.includes(f) ? prev.replace(f, "") : prev + f));
  }
  function insert(token: string) {
    setPattern((p) => p + token.replace("…", ""));
  }
  async function copyReplaced() {
    if (replaced == null) return;
    await navigator.clipboard.writeText(replaced);
    notify("Result copied", "success");
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      {/* pattern + flag */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 focus-within:border-accent/50">
          <span className="font-mono text-sm text-zinc-500">/</span>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="pattern"
            spellCheck={false}
            className="flex-1 bg-transparent py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <span className="font-mono text-sm text-zinc-500">/{flags}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FLAGS.map(([f, label]) => (
            <button
              key={f}
              onClick={() => toggleFlag(f)}
              title={label}
              className={`rounded-md border px-2 py-0.5 font-mono text-xs transition-colors ${
                flags.includes(f)
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f}
            </button>
          ))}
          {result && result.ok && (
            <span className="ml-auto self-center text-xs text-zinc-500">
              {result.matches.length} match{result.matches.length === 1 ? "" : "es"}
            </span>
          )}
        </div>
        {result && !result.ok && (
          <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
            <AlertCircle className="h-4 w-4" /> {result.err}
          </span>
        )}
        {/* cheatsheet: token comuni cliccabili */}
        <div className="flex flex-wrap gap-1">
          {CHEATSHEET.map(([token, label]) => (
            <button
              key={token}
              onClick={() => insert(token)}
              title={label}
              className="rounded border border-zinc-800/60 bg-zinc-800/40 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent"
            >
              {token}
            </button>
          ))}
        </div>
      </div>

      {/* testo + evidenziazione */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Test string…"
        spellCheck={false}
        rows={4}
        className="shrink-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
        {highlighted ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-300">
            {highlighted.map((s, i) =>
              s.match ? (
                <mark key={i} className="rounded bg-accent/30 px-0.5 text-zinc-100">
                  {s.text}
                </mark>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
          </pre>
        ) : (
          <span className="text-sm text-zinc-600">
            {result && result.ok && text ? "No matches." : "Matches are highlighted here."}
          </span>
        )}

        {/* gruppi di cattura per ogni match */}
        {result && result.ok && result.matches.some((m) => m.groups.length > 0) && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-zinc-800/60 pt-3">
            {result.matches.map((m, i) => (
              <div key={i} className="text-xs">
                <span className="text-zinc-500">match {i + 1}: </span>
                <span className="font-mono text-zinc-300">"{m.text}"</span>
                {m.groups.map((g, gi) => (
                  <span key={gi} className="ml-2 font-mono text-zinc-500">
                    ${gi + 1}=<span className="text-accent">"{g}"</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* replace: opzionale, sostituisce i match usando $1, $2… */}
      <div className="shrink-0">
        <label className="flex w-fit cursor-pointer select-none items-center gap-1.5 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={showReplace}
            onChange={(e) => setShowReplace(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Replace
        </label>
        {showReplace && (
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replacement (use $1, $2 for groups)"
              spellCheck={false}
              className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
            />
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-auto rounded-md border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200">
                {replaced ?? <span className="text-zinc-600">Result appears here.</span>}
              </pre>
              <button
                onClick={copyReplaced}
                disabled={replaced == null}
                className="shrink-0 rounded-md border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
