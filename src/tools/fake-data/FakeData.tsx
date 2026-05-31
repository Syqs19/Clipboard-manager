import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { useCopy } from "../../hooks/useCopy";
import { ToolButton } from "../shared/ToolButton";
import { Toggle } from "../shared/Toggle";
import { tabBtnClass } from "../shared/ui";

type Mode = "lorem" | "data";

const WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident".split(
    " ",
  );
const FIRST = "James Mary John Patricia Robert Jennifer Michael Linda David Elizabeth Maria Luca Giulia Marco Sara".split(" ");
const LAST = "Smith Johnson Brown Garcia Miller Davis Rossi Bianchi Ferrari Romano Conti Greco Bruno".split(" ");
const DOMAINS = ["example.com", "mail.com", "test.org", "demo.io"];
const STREETS = "Main Oak Pine Maple Cedar Elm View Hill Lake Park".split(" ");
const CITIES = ["New York", "London", "Rome", "Berlin", "Tokyo", "Madrid", "Paris", "Milan"];
const COMPANIES = ["Acme", "Globex", "Initech", "Umbrella", "Soylent", "Hooli", "Stark", "Wayne"];
const SUFFIX = ["Inc", "LLC", "Group", "Labs", "Co"];

/// PRNG semplice (per generare dati finti; non serve crittografia qui).
function rand(n: number): number {
  return Math.floor(Math.random() * n);
}
const pick = <T,>(a: T[]): T => a[rand(a.length)];

function loremWords(n: number): string {
  return Array.from({ length: n }, () => pick(WORDS)).join(" ");
}
function loremSentence(): string {
  const s = loremWords(6 + rand(8));
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}
function loremParagraph(): string {
  return Array.from({ length: 3 + rand(3) }, loremSentence).join(" ");
}

/// Generatori per campo: ogni voce produce un valore finto del proprio tipo.
const FIELDS = {
  id: () => crypto.randomUUID(),
  name: () => `${pick(FIRST)} ${pick(LAST)}`,
  email: () => `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase()}${rand(100)}@${pick(DOMAINS)}`,
  phone: () => `+1 ${100 + rand(900)} ${100 + rand(900)} ${1000 + rand(9000)}`,
  address: () => `${1 + rand(999)} ${pick(STREETS)} St, ${pick(CITIES)}`,
  company: () => `${pick(COMPANIES)} ${pick(SUFFIX)}`,
  date: () => {
    // data casuale negli ultimi ~3 anni, formato ISO (solo data)
    const d = new Date(2023, 0, 1 + rand(1000));
    return d.toISOString().slice(0, 10);
  },
  bool: () => rand(2) === 1,
} as const;

type FieldKey = keyof typeof FIELDS;
const ALL_FIELDS: FieldKey[] = ["id", "name", "email", "phone", "address", "company", "date", "bool"];

export function FakeData() {
  const copy = useCopy();
  const [mode, setMode] = useState<Mode>("lorem");
  const [count, setCount] = useState(3);
  const [out, setOut] = useState("");
  // campi inclusi in ogni record (modalità "data"), selezionabili
  const [fields, setFields] = useState<Set<FieldKey>>(
    () => new Set<FieldKey>(["id", "name", "email"]),
  );

  function toggleField(f: FieldKey) {
    setFields((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });
  }

  function generate() {
    if (mode === "lorem") {
      setOut(Array.from({ length: count }, loremParagraph).join("\n\n"));
    } else {
      const keys = ALL_FIELDS.filter((f) => fields.has(f));
      const rows = Array.from({ length: count }, () => {
        const row: Record<string, unknown> = {};
        for (const k of keys) row[k] = FIELDS[k]();
        return row;
      });
      setOut(JSON.stringify(rows, null, 2));
    }
  }

  function copyOut() {
    if (out) copy(out);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {([
            ["lorem", "Lorem ipsum"],
            ["data", "Fake data (JSON)"],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`${tabBtnClass(mode === m)} px-3 py-1 text-sm`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-zinc-400">
          {mode === "lorem" ? "Paragraphs" : "Records"}
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-200 focus:border-accent/50 focus:outline-none"
          />
        </label>
        <ToolButton variant="accent" icon={RefreshCw} onClick={generate} className="ml-auto">
          Generate
        </ToolButton>
        <ToolButton icon={Copy} onClick={copyOut} disabled={!out}>
          Copy
        </ToolButton>
      </div>

      {/* selezione dei campi (solo per Fake data JSON) */}
      {mode === "data" && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
          {ALL_FIELDS.map((f) => (
            <Toggle key={f} label={f} checked={fields.has(f)} onChange={() => toggleField(f)} />
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
        {out ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">{out}</pre>
        ) : (
          <span className="text-sm text-zinc-600">Press Generate to produce sample {mode === "lorem" ? "text" : "data"}.</span>
        )}
      </div>
    </div>
  );
}
