import { useMemo, useState } from "react";
import { ArrowUpDown, Copy, Trash2 } from "lucide-react";
import { useNotify } from "../../components/Toaster";

type Mode = "base64" | "url";

/// Base64 con supporto UTF-8 corretto (btoa/atob lavorano su byte latin1).
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeBase64(b64: string): string {
  const bin = atob(b64.trim());
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/// Base64 / URL encoder: codifica o decodifica testo nei due versi, con swap
/// rapido input↔output. Solo frontend.
export function Base64Url() {
  const notify = useNotify();
  const [mode, setMode] = useState<Mode>("base64");
  const [decode, setDecode] = useState(false); // false = encode, true = decode
  const [input, setInput] = useState("");

  // risultato o errore (la decodifica può fallire su input non valido)
  const result = useMemo<{ ok: true; out: string } | { ok: false; err: string }>(() => {
    if (!input) return { ok: true, out: "" };
    try {
      let out: string;
      if (mode === "base64") {
        out = decode ? decodeBase64(input) : encodeBase64(input);
      } else {
        out = decode ? decodeURIComponent(input) : encodeURIComponent(input);
      }
      return { ok: true, out };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
  }, [input, mode, decode]);

  // swap: il risultato diventa il nuovo input e si inverte encode/decode
  function swap() {
    if (result.ok) {
      setInput(result.out);
      setDecode((d) => !d);
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
      {/* selettore modalità + direzione */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {(["base64", "url"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-sm transition-colors ${
                mode === m
                  ? "bg-accent/15 text-accent"
                  : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m === "base64" ? "Base64" : "URL"}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {[false, true].map((d) => (
            <button
              key={String(d)}
              onClick={() => setDecode(d)}
              className={`px-3 py-1 text-sm transition-colors ${
                decode === d
                  ? "bg-accent/15 text-accent"
                  : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {d ? "Decode" : "Encode"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={swap}
            disabled={!result.ok || !result.out}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <ArrowUpDown className="h-3.5 w-3.5" /> Swap
          </button>
          <button
            onClick={copyOut}
            disabled={!result.ok || !result.out}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button
            onClick={() => setInput("")}
            disabled={!input}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={decode ? "Paste encoded text…" : "Type or paste text…"}
          spellCheck={false}
          className="min-h-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        <div className="min-h-0 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
          {result.ok ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">
              {result.out || (
                <span className="text-zinc-600">Output appears here.</span>
              )}
            </pre>
          ) : (
            <span className="text-sm text-red-400">{result.err}</span>
          )}
        </div>
      </div>
    </div>
  );
}
