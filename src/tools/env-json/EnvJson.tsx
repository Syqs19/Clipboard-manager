import { useMemo, useState } from "react";
import { ArrowRightLeft, Copy } from "lucide-react";
import { useCopy } from "../../hooks/useCopy";
import { ToolButton } from "../shared/ToolButton";
import { tabBtnClass } from "../shared/ui";
import { INPUT_TEXTAREA_CLASS } from "../shared/panels";
import { OutputPane } from "../shared/OutputPane";
import { parseEnv, toEnv } from "./env";

type Dir = "env2json" | "json2env";

export function EnvJson() {
  const copy = useCopy();
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
  function copyOut() {
    if (result.ok && result.out) copy(result.out, "Output copied");
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
              className={`${tabBtnClass(dir === d)} px-3 py-1 text-sm`}
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
          <ToolButton icon={ArrowRightLeft} onClick={swap} disabled={!result.ok || !result.out}>
            Swap
          </ToolButton>
          <ToolButton icon={Copy} onClick={copyOut} disabled={!result.ok || !result.out}>
            Copy
          </ToolButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dir === "env2json" ? "API_KEY=abc123\nDEBUG=true" : '{ "API_KEY": "abc123" }'}
          spellCheck={false}
          className={INPUT_TEXTAREA_CLASS}
        />
        <OutputPane output={result.ok ? result.out : ""} error={result.ok ? undefined : result.err} />
      </div>
    </div>
  );
}
