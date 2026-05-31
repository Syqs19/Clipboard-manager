import { useMemo, useState } from "react";
import { ArrowRightLeft, CheckCircle2, Copy } from "lucide-react";
import yaml from "js-yaml";
import { useCopy } from "../../hooks/useCopy";
import { ToolButton } from "../shared/ToolButton";
import { tabBtnClass } from "../shared/ui";
import { INPUT_TEXTAREA_CLASS } from "../shared/panels";
import { OutputPane } from "../shared/OutputPane";

/// Conta le chiavi di primo livello di un oggetto (0 se non è un oggetto piatto).
function topKeys(v: unknown): number {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : 0;
}

type Dir = "yaml2json" | "json2yaml";

/// YAML ↔ JSON converter. Usa js-yaml (load è "safe" di default: niente tipi
/// custom/eseguibili). Conversione nei due versi con swap.
export function YamlJson() {
  const copy = useCopy();
  const [dir, setDir] = useState<Dir>("yaml2json");
  const [input, setInput] = useState("");

  const result = useMemo<
    { ok: true; out: string; keys: number } | { ok: false; err: string }
  >(() => {
    if (!input.trim()) return { ok: true, out: "", keys: 0 };
    try {
      if (dir === "yaml2json") {
        const obj = yaml.load(input);
        return { ok: true, out: JSON.stringify(obj, null, 2), keys: topKeys(obj) };
      }
      const obj = JSON.parse(input);
      return { ok: true, out: yaml.dump(obj, { indent: 2, lineWidth: -1 }), keys: topKeys(obj) };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
  }, [input, dir]);

  function swap() {
    if (result.ok) {
      setInput(result.out);
      setDir((d) => (d === "yaml2json" ? "json2yaml" : "yaml2json"));
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
            ["yaml2json", "YAML → JSON"],
            ["json2yaml", "JSON → YAML"],
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
        {result.ok && result.out && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Valid
            {result.keys > 0 && <span className="text-zinc-500">· {result.keys} keys</span>}
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
          placeholder={dir === "yaml2json" ? "name: app\nversion: 2\ntags:\n  - a\n  - b" : '{ "name": "app", "version": 2 }'}
          spellCheck={false}
          className={INPUT_TEXTAREA_CLASS}
        />
        <OutputPane output={result.ok ? result.out : ""} error={result.ok ? undefined : result.err} />
      </div>
    </div>
  );
}
