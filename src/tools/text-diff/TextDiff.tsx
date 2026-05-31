import { useMemo, useState } from "react";

type LineRow =
  | { type: "same"; a: string; b: string }
  | { type: "add"; b: string }
  | { type: "del"; a: string }
  | { type: "mod"; a: string; b: string }; // riga modificata (diff per parola)

type WordPart = { text: string; kind: "same" | "add" | "del" };

/// LCS generico su array (righe o parole). Ritorna gli indici della
/// sottosequenza comune più lunga.
function lcsOps<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): ("same" | "add" | "del")[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: ("same" | "add" | "del")[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      ops.push("same");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push("del");
      i++;
    } else {
      ops.push("add");
      j++;
    }
  }
  while (i++ < n) ops.push("del");
  while (j++ < m) ops.push("add");
  return ops;
}

/// Diff a livello di parola fra due righe (per evidenziare COSA è cambiato).
function wordDiff(a: string, b: string): { aParts: WordPart[]; bParts: WordPart[] } {
  const aw = a.split(/(\s+)/);
  const bw = b.split(/(\s+)/);
  const ops = lcsOps(aw, bw, (x, y) => x === y);
  const aParts: WordPart[] = [];
  const bParts: WordPart[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === "same") {
      aParts.push({ text: aw[i], kind: "same" });
      bParts.push({ text: bw[j], kind: "same" });
      i++;
      j++;
    } else if (op === "del") {
      aParts.push({ text: aw[i], kind: "del" });
      i++;
    } else {
      bParts.push({ text: bw[j], kind: "add" });
      j++;
    }
  }
  return { aParts, bParts };
}

function normalize(s: string, ignoreWs: boolean, ignoreCase: boolean): string {
  let r = s;
  if (ignoreWs) r = r.trim().replace(/\s+/g, " ");
  if (ignoreCase) r = r.toLowerCase();
  return r;
}

/// Diff riga-per-riga; le coppie del/add adiacenti diventano righe "mod" col
/// diff per parola. `eq` usa la normalizzazione (ignora ws/case se attivi).
function diffLines(
  aText: string,
  bText: string,
  ignoreWs: boolean,
  ignoreCase: boolean,
  byWord: boolean,
): LineRow[] {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const eq = (x: string, y: string) =>
    normalize(x, ignoreWs, ignoreCase) === normalize(y, ignoreWs, ignoreCase);
  const ops = lcsOps(a, b, eq);
  const rows: LineRow[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op === "same") {
      rows.push({ type: "same", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (op === "del") {
      // del seguito da add → riga modificata (se diff per parola attivo)
      if (byWord && ops[k + 1] === "add") {
        rows.push({ type: "mod", a: a[i], b: b[j] });
        i++;
        j++;
        k++;
      } else {
        rows.push({ type: "del", a: a[i] });
        i++;
      }
    } else {
      rows.push({ type: "add", b: b[j] });
      j++;
    }
  }
  return rows;
}

/// Rende le parti con evidenziazione (per le righe "mod").
function renderParts(parts: WordPart[]) {
  return parts.map((p, i) => (
    <span
      key={i}
      className={
        p.kind === "add"
          ? "bg-emerald-500/30 text-emerald-200"
          : p.kind === "del"
            ? "bg-red-500/30 text-red-200"
            : ""
      }
    >
      {p.text}
    </span>
  ));
}

export function TextDiff() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [byWord, setByWord] = useState(true);
  const [split, setSplit] = useState(false);

  const rows = useMemo(
    () => (a || b ? diffLines(a, b, ignoreWs, ignoreCase, byWord) : []),
    [a, b, ignoreWs, ignoreCase, byWord],
  );
  const stats = useMemo(() => {
    let add = 0;
    let del = 0;
    let mod = 0;
    for (const r of rows) {
      if (r.type === "add") add++;
      else if (r.type === "del") del++;
      else if (r.type === "mod") mod++;
    }
    return { add, del, mod };
  }, [rows]);

  const toggle = (label: string, checked: boolean, on: (v: boolean) => void) => (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-zinc-400">
      <input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} className="h-4 w-4 accent-accent" />
      {label}
    </label>
  );

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
        {toggle("Word diff", byWord, setByWord)}
        {toggle("Ignore whitespace", ignoreWs, setIgnoreWs)}
        {toggle("Ignore case", ignoreCase, setIgnoreCase)}
        {toggle("Split view", split, setSplit)}
        {rows.length > 0 && (
          <span className="ml-auto font-mono text-xs">
            <span className="text-emerald-400">+{stats.add}</span>{" "}
            <span className="text-red-400">−{stats.del}</span>{" "}
            <span className="text-amber-400">~{stats.mod}</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <textarea value={a} onChange={(e) => setA(e.target.value)} placeholder="Original…" spellCheck={false} rows={5}
          className="resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none" />
        <textarea value={b} onChange={(e) => setB(e.target.value)} placeholder="Changed…" spellCheck={false} rows={5}
          className="resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-2">
        {rows.length === 0 ? (
          <span className="px-1 text-sm text-zinc-600">Type in both fields to see the differences.</span>
        ) : split ? (
          // VISTA AFFIANCATA: colonna sinistra (original) | destra (changed)
          <div className="grid grid-cols-2 gap-px font-mono text-sm leading-relaxed">
            {rows.map((r, idx) => {
              const wd = r.type === "mod" ? wordDiff(r.a, r.b) : null;
              const left =
                r.type === "add" ? <div key={`l${idx}`} className="px-1">&nbsp;</div> :
                r.type === "del" ? <div key={`l${idx}`} className="bg-red-500/10 px-1 text-red-300">{r.a || " "}</div> :
                r.type === "mod" ? <div key={`l${idx}`} className="bg-red-500/5 px-1 text-zinc-300">{renderParts(wd!.aParts)}</div> :
                <div key={`l${idx}`} className="px-1 text-zinc-400">{r.a || " "}</div>;
              const right =
                r.type === "del" ? <div key={`r${idx}`} className="px-1">&nbsp;</div> :
                r.type === "add" ? <div key={`r${idx}`} className="bg-emerald-500/10 px-1 text-emerald-300">{r.b || " "}</div> :
                r.type === "mod" ? <div key={`r${idx}`} className="bg-emerald-500/5 px-1 text-zinc-300">{renderParts(wd!.bParts)}</div> :
                <div key={`r${idx}`} className="px-1 text-zinc-400">{r.b || " "}</div>;
              return [left, right];
            })}
          </div>
        ) : (
          // VISTA UNIFICATA
          <pre className="font-mono text-sm leading-relaxed">
            {rows.map((r, idx) => {
              if (r.type === "same")
                return <div key={idx} className="px-1 text-zinc-400"><span className="select-none text-zinc-600">{"  "}</span>{r.a || " "}</div>;
              if (r.type === "add")
                return <div key={idx} className="bg-emerald-500/10 px-1 text-emerald-300"><span className="select-none text-emerald-500">{"+ "}</span>{r.b || " "}</div>;
              if (r.type === "del")
                return <div key={idx} className="bg-red-500/10 px-1 text-red-300"><span className="select-none text-red-500">{"- "}</span>{r.a || " "}</div>;
              // mod: due righe con diff per parola
              const wd = wordDiff(r.a, r.b);
              return (
                <div key={idx}>
                  <div className="bg-red-500/10 px-1 text-red-300"><span className="select-none text-red-500">{"- "}</span>{renderParts(wd.aParts)}</div>
                  <div className="bg-emerald-500/10 px-1 text-emerald-300"><span className="select-none text-emerald-500">{"+ "}</span>{renderParts(wd.bParts)}</div>
                </div>
              );
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
