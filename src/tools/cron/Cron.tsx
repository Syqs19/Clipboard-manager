import { useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";

/// "in 3 hours" / "in 5 minutes" dato un istante futuro.
function untilLabel(target: number, nowMs: number): string {
  const diff = target - nowMs;
  if (diff <= 0) return "now";
  const units: [number, string][] = [
    [86400000, "day"],
    [3600000, "hour"],
    [60000, "minute"],
  ];
  for (const [u, name] of units) {
    if (diff >= u) {
      const v = Math.floor(diff / u);
      return `in ${v} ${v === 1 ? name : name + "s"}`;
    }
  }
  return "in less than a minute";
}

/// Espande un campo cron ("*", "*/5", "1-5", "1,3,5", "10") nell'insieme dei
/// valori ammessi nell'intervallo [min,max].
function expandField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let range = part;
    const slash = part.split("/");
    if (slash.length === 2) {
      range = slash[0];
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid step in "${part}"`);
    }
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const dash = range.split("-");
      if (dash.length === 2) {
        lo = Number(dash[0]);
        hi = Number(dash[1]);
      } else {
        lo = hi = Number(range);
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Out of range in "${part}" (allowed ${min}-${max})`);
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/// Descrizione in linguaggio naturale (semplice) dei 5 campi cron.
function describe(f: string[], sets: number[][]): string {
  const [minF, hourF, domF, monF, dowF] = f;
  const [mins, hours] = sets;
  const p = (n: number) => String(n).padStart(2, "0");

  // caso comune: ora:minuto preciso
  let time: string;
  if (minF !== "*" && hourF !== "*" && mins.length === 1 && hours.length === 1) {
    time = `at ${p(hours[0])}:${p(mins[0])}`;
  } else if (minF.startsWith("*/")) {
    time = `every ${minF.slice(2)} minutes`;
  } else if (hourF.startsWith("*/") && minF === "0") {
    time = `every ${hourF.slice(2)} hours`;
  } else if (minF === "*") {
    time = "every minute";
  } else {
    time = `at minute ${mins.join(",")}${hourF !== "*" ? ` of hour ${hours.join(",")}` : ""}`;
  }

  const parts = [time];
  if (dowF !== "*") {
    const days = sets[4].map((d) => DOW[d % 7]).join(", ");
    parts.push(`on ${days}`);
  }
  if (domF !== "*") parts.push(`on day-of-month ${domF}`);
  if (monF !== "*") parts.push(`in ${sets[3].map((m) => MON[m]).join(", ")}`);
  return parts.join(", ");
}

/// Prossime `count` esecuzioni a partire da `from`, scorrendo i minuti.
function nextRuns(sets: number[][], from: Date, count: number): Date[] {
  const [mins, hours, doms, mons, dows] = sets;
  const ms = new Set(mins), hs = new Set(hours), dm = new Set(doms), mo = new Set(mons), dw = new Set(dows.map((d) => d % 7));
  const out: Date[] = [];
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  let guard = 0;
  while (out.length < count && guard++ < 500000) {
    if (
      ms.has(d.getMinutes()) &&
      hs.has(d.getHours()) &&
      mo.has(d.getMonth() + 1) &&
      dm.has(d.getDate()) &&
      dw.has(d.getDay())
    ) {
      out.push(new Date(d));
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return out;
}

export function Cron() {
  const [expr, setExpr] = useState("");
  // tick ogni 30s per il "tempo alla prossima run" (basta una granularità grossa)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  const parsed = useMemo(() => {
    const e = expr.trim();
    if (!e) return null;
    const f = e.split(/\s+/);
    if (f.length !== 5) {
      return { ok: false as const, err: "A cron expression has 5 fields: min hour day-of-month month day-of-week." };
    }
    try {
      const sets = [
        expandField(f[0], 0, 59),
        expandField(f[1], 0, 23),
        expandField(f[2], 1, 31),
        expandField(f[3], 1, 12),
        expandField(f[4], 0, 7),
      ];
      return { ok: true as const, desc: describe(f, sets), runs: nextRuns(sets, new Date(), 5) };
    } catch (err) {
      return { ok: false as const, err: err instanceof Error ? err.message : String(err) };
    }
  }, [expr]);

  const examples = ["0 9 * * 1-5", "*/15 * * * *", "0 0 1 * *", "0 */6 * * *"];

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <input
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        placeholder="0 9 * * 1-5"
        spellCheck={false}
        className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 text-center font-mono text-base text-zinc-100 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
      />

      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-zinc-500">Examples:</span>
        {examples.map((ex) => (
          <button key={ex} onClick={() => setExpr(ex)} className="rounded border border-zinc-700/60 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-xs text-zinc-400 hover:text-zinc-200">
            {ex}
          </button>
        ))}
      </div>

      {parsed && !parsed.ok && (
        <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
          <AlertCircle className="h-4 w-4" /> {parsed.err}
        </span>
      )}

      {parsed && parsed.ok && (
        <>
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-zinc-100">
            {parsed.desc}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Next runs (local)</span>
            <div className="flex flex-col gap-1 rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3">
              {parsed.runs.length === 0 ? (
                <span className="text-sm text-zinc-500">No upcoming runs found.</span>
              ) : (
                parsed.runs.map((r, i) => (
                  <span key={i} className="flex items-baseline gap-2 font-mono text-sm text-zinc-200">
                    {r.toLocaleString()}
                    {i === 0 && (
                      <span className="text-xs text-accent">{untilLabel(r.getTime(), now)}</span>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
