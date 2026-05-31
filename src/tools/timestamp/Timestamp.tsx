import { useEffect, useMemo, useState } from "react";
import { Clock, Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

/// "YYYY-MM-DD HH:mm:ss" in locale o UTC.
function formatDate(d: Date, utc: boolean): string {
  const p = (n: number) => String(n).padStart(2, "0");
  if (utc) {
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/// Tempo relativo leggibile ("3 hours ago", "in 2 days").
function relative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [31536000000, "year"],
    [2592000000, "month"],
    [86400000, "day"],
    [3600000, "hour"],
    [60000, "minute"],
    [1000, "second"],
  ];
  for (const [u, name] of units) {
    if (abs >= u) {
      const v = Math.round(abs / u);
      const plural = v === 1 ? name : name + "s";
      return diff < 0 ? `${v} ${plural} ago` : `in ${v} ${plural}`;
    }
  }
  return "just now";
}

/// Riga di output copiabile (etichetta + valore monospace + bottone copia).
function OutRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">{value}</span>
      <button onClick={onCopy} className="shrink-0 text-zinc-400 hover:text-zinc-100">
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/// Timestamp converter: Unix (s/ms) ↔ data nei due versi, con più formati di
/// output (locale, ISO, RFC, relativo), un "now" che ticchetta in tempo reale,
/// e toggle s/ms e local/UTC. Solo Date.
export function Timestamp() {
  const notify = useNotify();
  const [unit, setUnit] = useState<"s" | "ms">("s");
  const [utc, setUtc] = useState(false);

  // "now" live: aggiornato ogni secondo come riferimento sempre visibile.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [ts, setTs] = useState("");
  const tsResult = useMemo(() => {
    const t = ts.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false as const };
    const ms = unit === "s" ? n * 1000 : n;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return { ok: false as const };
    return {
      ok: true as const,
      ms,
      local: formatDate(d, false),
      utcStr: formatDate(d, true),
      iso: d.toISOString(),
      rfc: d.toUTCString(),
      rel: relative(ms),
    };
  }, [ts, unit]);

  const [dateStr, setDateStr] = useState("");
  const dateResult = useMemo(() => {
    const s = dateStr.trim();
    if (!s) return null;
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

  const nowVal = unit === "s" ? Math.floor(now / 1000) : now;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {/* opzioni globali + now live */}
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
      </div>

      {/* orologio "now" live, cliccabile per riempire il campo */}
      <button
        onClick={() => setTs(String(nowVal))}
        title="Use current time"
        className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-left transition-colors hover:bg-accent/10"
      >
        <Clock className="h-4 w-4 text-accent" />
        <span className="text-xs uppercase tracking-wide text-zinc-500">Now</span>
        <span className="font-mono text-sm text-zinc-100">{nowVal}</span>
        <span className="text-xs text-zinc-500">{unit}</span>
      </button>

      {/* timestamp → data (più formati) */}
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
        {tsResult &&
          (tsResult.ok ? (
            <div className="flex flex-col gap-1.5 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
              <OutRow label="Local" value={tsResult.local} onCopy={() => copy(tsResult.local)} />
              <OutRow label="UTC" value={tsResult.utcStr} onCopy={() => copy(tsResult.utcStr)} />
              <OutRow label="ISO 8601" value={tsResult.iso} onCopy={() => copy(tsResult.iso)} />
              <OutRow label="RFC" value={tsResult.rfc} onCopy={() => copy(tsResult.rfc)} />
              <OutRow label="Relative" value={tsResult.rel} onCopy={() => copy(tsResult.rel)} />
            </div>
          ) : (
            <span className="text-sm text-red-400">Invalid timestamp</span>
          ))}
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
        {dateResult &&
          (dateResult.ok ? (
            <OutRow
              label={unit}
              value={String(dateResult.value)}
              onCopy={() => copy(String(dateResult.value))}
            />
          ) : (
            <span className="text-sm text-red-400">Invalid date</span>
          ))}
      </div>
    </div>
  );
}
