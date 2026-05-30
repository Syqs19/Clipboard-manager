import { useMemo, useState } from "react";

type Row =
  | { type: "same"; a: string; b: string }
  | { type: "add"; b: string }
  | { type: "del"; a: string };

/// Diff riga-per-riga via LCS (longest common subsequence) sulle righe: trova le
/// righe in comune e marca il resto come aggiunte (+) o rimozioni (-). Algoritmo
/// classico O(n·m) con tabella di programmazione dinamica; nessuna dipendenza.
function diffLines(aText: string, bText: string): Row[] {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = lunghezza LCS di a[i..] e b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  // ricostruisci il diff scorrendo la tabella
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", a: a[i] });
      i++;
    } else {
      rows.push({ type: "add", b: b[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: "del", a: a[i++] });
  while (j < m) rows.push({ type: "add", b: b[j++] });
  return rows;
}

export function TextDiff() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  const rows = useMemo(() => (a || b ? diffLines(a, b) : []), [a, b]);
  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    for (const r of rows) {
      if (r.type === "add") add++;
      else if (r.type === "del") del++;
    }
    return { add, del };
  }, [rows]);

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-zinc-400">Compare two texts line by line.</span>
        {rows.length > 0 && (
          <span className="ml-auto font-mono text-xs">
            <span className="text-emerald-400">+{stats.add}</span>{" "}
            <span className="text-red-400">−{stats.del}</span>
          </span>
        )}
      </div>

      {/* due input affiancati */}
      <div className="grid grid-cols-2 gap-3">
        <textarea
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder="Original…"
          spellCheck={false}
          rows={6}
          className="resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        <textarea
          value={b}
          onChange={(e) => setB(e.target.value)}
          placeholder="Changed…"
          spellCheck={false}
          rows={6}
          className="resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
      </div>

      {/* risultato del diff */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-2">
        {rows.length === 0 ? (
          <span className="px-1 text-sm text-zinc-600">
            Type in both fields to see the differences.
          </span>
        ) : (
          <pre className="font-mono text-sm leading-relaxed">
            {rows.map((r, idx) => {
              if (r.type === "same")
                return (
                  <div key={idx} className="px-1 text-zinc-400">
                    <span className="select-none text-zinc-600">{"  "}</span>
                    {r.a || " "}
                  </div>
                );
              if (r.type === "add")
                return (
                  <div key={idx} className="bg-emerald-500/10 px-1 text-emerald-300">
                    <span className="select-none text-emerald-500">{"+ "}</span>
                    {r.b || " "}
                  </div>
                );
              return (
                <div key={idx} className="bg-red-500/10 px-1 text-red-300">
                  <span className="select-none text-red-500">{"- "}</span>
                  {r.a || " "}
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
