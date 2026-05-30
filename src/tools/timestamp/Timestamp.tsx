import { useMemo, useState } from "react";
import { Clock, Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

/// Formatta una Date in "YYYY-MM-DD HH:mm:ss" in locale o UTC.
function formatDate(d: Date, utc: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  if (utc) {
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/// Timestamp converter: Unix (secondi o millisecondi) ↔ data leggibile, nei due
/// versi. "Now" inserisce l'istante corrente; toggle s/ms e local/UTC. Solo Date.
export function Timestamp() {
  const notify = useNotify();
  const [unit, setUnit] = useState<"s" | "ms">("s");
  const [utc, setUtc] = useState(false);

  // campo timestamp numerico → data
  const [ts, setTs] = useState("");
  const tsResult = useMemo(() => {
    const t = ts.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false as const };
    const ms = unit === "s" ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return { ok: false as const };
    return { ok: true as const, text: formatDate(d, utc), iso: d.toISOString() };
  }, [ts, unit, utc]);

  // campo data ("YYYY-MM-DD HH:mm:ss" o ISO) → timestamp
  const [dateStr, setDateStr] = useState("");
  const dateResult = useMemo(() => {
    const s = dateStr.trim();
    if (!s) return null;
    // interpreta come UTC se il toggle UTC è attivo e manca un offset esplicito
    const norm = s.replace(" ", "T");
    const iso = utc && !/[zZ]|[+-]\d\d:?\d\d$/.test(norm) ? norm + "Z" : norm;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { ok: false as const };
    const ms = d.getTime();
    return { ok: true as const, value: unit === "s" ? Math.floor(ms / 1000) : ms };
  }, [dateStr, unit, utc]);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    notify("Copied", "success");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {/* opzioni globali */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {(["s", "ms"] as const).map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-3 py-1 text-sm transition-colors ${
                unit === u ? "bg-accent/15 text-accent" : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {u === "s" ? "Seconds" : "Millis"}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {[false, true].map((u) => (
            <button
              key={String(u)}
              onClick={() => setUtc(u)}
              className={`px-3 py-1 text-sm transition-colors ${
                utc === u ? "bg-accent/15 text-accent" : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {u ? "UTC" : "Local"}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            const now = Date.now();
            setTs(String(unit === "s" ? Math.floor(now / 1000) : now));
          }}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          <Clock className="h-3.5 w-3.5" /> Now
        </button>
      </div>

      {/* timestamp → data */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Unix timestamp ({unit})
        </label>
        <input
          value={ts}
          onChange={(e) => setTs(e.target.value)}
          placeholder={unit === "s" ? "1735689600" : "1735689600000"}
          spellCheck={false}
          className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        {tsResult && (
          <div className="flex items-center gap-2 text-sm">
            {tsResult.ok ? (
              <>
                <span className="font-mono text-zinc-200">{tsResult.text}</span>
                <span className="text-xs text-zinc-500">{utc ? "UTC" : "local"}</span>
                <button onClick={() => copy(tsResult.text)} className="ml-auto text-zinc-400 hover:text-zinc-100">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <span className="text-red-400">Invalid timestamp</span>
            )}
          </div>
        )}
      </div>

      {/* data → timestamp */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Date (YYYY-MM-DD HH:mm:ss or ISO)
        </label>
        <input
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          placeholder="2025-01-01 00:00:00"
          spellCheck={false}
          className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        {dateResult && (
          <div className="flex items-center gap-2 text-sm">
            {dateResult.ok ? (
              <>
                <span className="font-mono text-zinc-200">{dateResult.value}</span>
                <span className="text-xs text-zinc-500">{unit}</span>
                <button onClick={() => copy(String(dateResult.value))} className="ml-auto text-zinc-400 hover:text-zinc-100">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <span className="text-red-400">Invalid date</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
