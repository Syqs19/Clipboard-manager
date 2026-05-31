import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { useCopy } from "../../hooks/useCopy";
import { ToolButton } from "../shared/ToolButton";

/// Spezza una stringa nelle sue "parole" indipendentemente dal case di origine
/// (camelCase, snake_case, kebab-case, spazi, ecc.).
function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/[_\-./]+/g, " ") // separatori → spazio
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

const CASES: { label: string; fn: (w: string[]) => string }[] = [
  { label: "camelCase", fn: (w) => w.map((x, i) => (i ? cap(x) : x)).join("") },
  { label: "PascalCase", fn: (w) => w.map(cap).join("") },
  { label: "snake_case", fn: (w) => w.join("_") },
  { label: "kebab-case", fn: (w) => w.join("-") },
  { label: "CONSTANT_CASE", fn: (w) => w.join("_").toUpperCase() },
  { label: "Title Case", fn: (w) => w.map(cap).join(" ") },
  { label: "Sentence case", fn: (w) => (w.length ? cap(w[0]) + (w.length > 1 ? " " + w.slice(1).join(" ") : "") : "") },
  { label: "lower case", fn: (w) => w.join(" ") },
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/// Rileva (in modo euristico) il case dell'input, per mostrarlo all'utente.
function detectCase(s: string): string {
  if (!s.trim()) return "";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s)) return "snake_case";
  if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(s)) return "CONSTANT_CASE";
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)) return "kebab-case";
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(s)) return "camelCase";
  if (/^([A-Z][a-z0-9]*)+$/.test(s)) return "PascalCase";
  if (/\s/.test(s)) return "words";
  return "single word";
}

/// String case converter: digiti un identificatore/frase e vedi tutte le
/// varianti di case, ognuna copiabile. Nativo, nessuna dipendenza.
export function CaseConverter() {
  const copy = useCopy();
  const [input, setInput] = useState("");

  const results = useMemo(() => {
    const w = words(input);
    return CASES.map((c) => ({ label: c.label, value: c.fn(w) }));
  }, [input]);
  const detected = useMemo(() => detectCase(input.trim()), [input]);

  // la guardia resta qui: copyVariant è invocata su varianti potenzialmente vuote.
  const copyVariant = (text: string) => {
    if (text) void copy(text);
  };
  function copyAll() {
    const all = results.map((r) => `${r.label}: ${r.value}`).join("\n");
    copy(all, "All variants copied");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="userProfileName / user_profile_name / User Profile Name…"
        spellCheck={false}
        className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
      />
      <div className="flex items-center gap-2 text-sm">
        {detected && (
          <span className="text-zinc-500">
            Detected: <span className="text-accent">{detected}</span>
          </span>
        )}
        <ToolButton icon={Copy} onClick={copyAll} disabled={!input.trim()} className="ml-auto">
          Copy all
        </ToolButton>
      </div>
      <div className="flex flex-col gap-1.5">
        {results.map((r) => (
          <button
            key={r.label}
            onClick={() => copyVariant(r.value)}
            className="group flex items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-left transition-colors hover:border-zinc-700/60 hover:bg-zinc-800/40"
          >
            <span className="w-32 shrink-0 text-xs uppercase tracking-wide text-zinc-500">
              {r.label}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-200">
              {r.value || <span className="text-zinc-600">—</span>}
            </span>
            <Copy className="h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
          </button>
        ))}
      </div>
    </div>
  );
}
