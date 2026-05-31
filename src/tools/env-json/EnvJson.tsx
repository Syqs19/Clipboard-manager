import { useMemo, useState } from "react";
import { ArrowRightLeft, Copy } from "lucide-react";
import { useNotify } from "../../components/Toaster";

type Dir = "env2json" | "json2env";

/// Parsa un file .env (KEY=value, # commenti, virgolette opzionali) in oggetto.
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim().replace(/^export\s+/, "");
    let val = t.slice(eq + 1).trim();
    // togli virgolette circondanti
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/// Serializza un oggetto piatto in righe .env (quota i valori con spazi/speciali).
function toEnv(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      let val = v == null ? "" : String(v);
      if (/[\s#"']/.test(val)) val = `"${val.replace(/"/g, '\\"')}"`;
      return `${k}=${val}`;
    })
    .join("\n");
}

export function EnvJson() {
  const notify = useNotify();
  const [dir, setDir] = useState<Dir>("env2json");
  const [input, setInput] = useState("");

  const result = useMemo<
    { ok: true; out: string; count: number } | { ok: false; err: string }
  >(() => {
    if (!input.trim()) return { ok: true, out: "", count: 0 };
    try {
      if (dir === "env2json") {
        const obj = parseEnv(input);
        return { ok: true, out: JSON.stringify(obj, null, 2), count: Object.keys(obj).length };
      }
      const obj = JSON.parse(input);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        return { ok: false, err: "JSON must be a flat object." };
      }
      const rec = obj as Record<string, unknown>;
      return { ok: true, out: toEnv(rec), count: Object.keys(rec).length };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
  }, [input, dir]);

  function swap() {
    if (result.ok) {
      setInput(result.out);
      setDir((d) => (d === "env2json" ? "json2env" : "env2json"));
    }
  }
  async function copyOut() {
    if (result.ok && result.out) {
      await navigator.clipboard.writeText(result.out);
      notify("Output copied", "success");
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {([
            ["env2json", ".env → JSON"],
            ["json2env", "JSON → .env"],
          ] as const).map(([d, label]) => (
            <button
              key={d}
              onClick={() => setDir(d)}
              className={`px-3 py-1 text-sm transition-colors ${
                dir === d ? "bg-accent/15 text-accent" : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {result.ok && result.count > 0 && (
          <span className="text-xs text-zinc-500">
            {result.count} variable{result.count === 1 ? "" : "s"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={swap} disabled={!result.ok || !result.out} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50">
            <ArrowRightLeft className="h-3.5 w-3.5" /> Swap
          </button>
          <button onClick={copyOut} disabled={!result.ok || !result.out} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50">
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dir === "env2json" ? "API_KEY=abc123\nDEBUG=true" : '{ "API_KEY": "abc123" }'}
          spellCheck={false}
          className="min-h-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        <div className="min-h-0 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
          {result.ok ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">
              {result.out || <span className="text-zinc-600">Output appears here.</span>}
            </pre>
          ) : (
            <span className="text-sm text-red-400">{result.err}</span>
          )}
        </div>
      </div>
    </div>
  );
}
