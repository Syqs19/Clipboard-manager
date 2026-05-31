import { useState } from "react";
import { Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

const BASES = [
  { key: "dec", label: "Decimal", radix: 10, re: /^[0-9]*$/, prefix: "", group: 0 },
  { key: "hex", label: "Hexadecimal", radix: 16, re: /^[0-9a-fA-F]*$/, prefix: "0x", group: 2 },
  { key: "oct", label: "Octal", radix: 8, re: /^[0-7]*$/, prefix: "0o", group: 0 },
  { key: "bin", label: "Binary", radix: 2, re: /^[01]*$/, prefix: "0b", group: 4 },
] as const;

/// Raggruppa una stringa in blocchi di `n` cifre da destra, separati da spazio
/// (es. "11111111" → "1111 1111"). n=0 → nessun raggruppamento.
function groupDigits(s: string, n: number): string {
  if (n <= 0 || s.length <= n) return s;
  const out: string[] = [];
  for (let i = s.length; i > 0; i -= n) out.unshift(s.slice(Math.max(0, i - n), i));
  return out.join(" ");
}

/// Number base converter: digiti in una base qualsiasi (dec/hex/oct/bin) e gli
/// altri campi si aggiornano in tempo reale. Usa BigInt per interi grandi.
export function NumberBase() {
  const notify = useNotify();
  // valore canonico come BigInt; null = vuoto, undefined = input non valido
  const [value, setValue] = useState<bigint | null>(null);
  // quale campo è in errore (input non valido per la sua base)
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // testo grezzo del campo attivo, per non normalizzare ciò che stai scrivendo
  const [raw, setRaw] = useState<{ key: string; text: string } | null>(null);
  // opzioni di visualizzazione (non toccano il valore, solo il display)
  const [showPrefix, setShowPrefix] = useState(false);
  const [group, setGroup] = useState(false);

  function onChange(key: string, radix: number, re: RegExp, input: string) {
    // togli prefissi (0x/0b/0o) e spazi di raggruppamento prima di validare/parsare
    const text = input.replace(/^0[xbo]/i, "").replace(/\s+/g, "");
    setRaw({ key, text });
    if (text === "") {
      setValue(null);
      setErrorKey(null);
      return;
    }
    if (!re.test(text)) {
      setErrorKey(key);
      return;
    }
    try {
      setValue(parseBig(text, radix));
      setErrorKey(null);
    } catch {
      setErrorKey(key);
    }
  }

  async function copy(text: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    notify("Copied", "success");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      {/* opzioni di visualizzazione */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" checked={showPrefix} onChange={(e) => setShowPrefix(e.target.checked)} className="h-4 w-4 accent-accent" />
          Prefix (0x/0b/0o)
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="h-4 w-4 accent-accent" />
          Group digits
        </label>
      </div>
      {BASES.map((b) => {
        const isActive = raw?.key === b.key;
        // base = valore puro nella base; display = con prefisso/raggruppamento.
        // Il campo ATTIVO resta grezzo (non formattato) per non disturbare l'editing.
        const base = isActive ? raw!.text : value === null ? "" : value.toString(b.radix);
        const display =
          isActive || !base
            ? base
            : (showPrefix ? b.prefix : "") + (group ? groupDigits(base, b.group) : base);
        const invalid = errorKey === b.key;
        return (
          <div key={b.key} className="flex flex-col gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {b.label}
            </label>
            <div className="flex items-center gap-2">
              <input
                value={display}
                onChange={(e) => onChange(b.key, b.radix, b.re, e.target.value.trim())}
                placeholder="0"
                spellCheck={false}
                className={`min-w-0 flex-1 rounded-md border bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
                  invalid ? "border-red-500/60" : "border-zinc-700/60 focus:border-accent/50"
                }`}
              />
              <button
                onClick={() => copy(display)}
                disabled={!display}
                className="shrink-0 rounded-md border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
      {errorKey && <span className="text-sm text-red-400">Invalid digit for that base.</span>}
    </div>
  );
}

/// Parsing di un intero non negativo in una base arbitraria → BigInt (gestisce
/// numeri più grandi di Number.MAX_SAFE_INTEGER).
function parseBig(text: string, radix: number): bigint {
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
  let acc = 0n;
  const r = BigInt(radix);
  for (const ch of text.toLowerCase()) {
    const d = digits.indexOf(ch);
    if (d < 0 || d >= radix) throw new Error("bad digit");
    acc = acc * r + BigInt(d);
  }
  return acc;
}
