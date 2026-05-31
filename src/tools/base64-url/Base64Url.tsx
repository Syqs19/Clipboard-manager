import { useMemo, useState } from "react";
import { ArrowUpDown, Copy, Trash2 } from "lucide-react";
import { useNotify } from "../../components/Toaster";

type Mode = "base64" | "url";

/// Base64 con supporto UTF-8 corretto (btoa/atob lavorano su byte latin1).
/// `urlSafe`: usa l'alfabeto URL-safe (- _ al posto di + /, senza padding =).
function encodeBase64(text: string, urlSafe: boolean): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  let b64 = btoa(bin);
  if (urlSafe) b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64;
}
function decodeBase64(b64: string): string {
  // accetta sia standard sia url-safe: normalizza alfabeto e padding.
  let s = b64.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/// Euristica per l'auto-detect in decode: se il testo contiene % seguito da hex
/// sembra URL-encoded; altrimenti lo trattiamo come Base64.
function looksUrlEncoded(text: string): boolean {
  return /%[0-9a-fA-F]{2}/.test(text);
}

const byteLen = (s: string) => new TextEncoder().encode(s).length;

/// Base64 / URL encoder: codifica o decodifica testo nei due versi, con swap
/// rapido input↔output, variante URL-safe, auto-detect in decode e conteggi.
export function Base64Url() {
  const notify = useNotify();
  const [mode, setMode] = useState<Mode>("base64");
  const [decode, setDecode] = useState(false); // false = encode, true = decode
  const [urlSafe, setUrlSafe] = useState(false);
  const [auto, setAuto] = useState(false); // auto-detect Base64 vs URL in decode
  const [input, setInput] = useState("");

  // modalità effettiva: in decode con auto-detect attivo, scegli da sola.
  const effMode: Mode =
    decode && auto ? (looksUrlEncoded(input) ? "url" : "base64") : mode;

  const result = useMemo<
    { ok: true; out: string } | { ok: false; err: string }
  >(() => {
    if (!input) return { ok: true, out: "" };
    try {
      let out: string;
      if (effMode === "base64") {
        out = decode ? decodeBase64(input) : encodeBase64(input, urlSafe);
      } else {
        out = decode ? decodeURIComponent(input) : encodeURIComponent(input);
      }
      return { ok: true, out };
    } catch (e) {
      return { ok: false, err: e instanceof Error ? e.message : String(e) };
    }
  }, [input, effMode, decode, urlSafe]);

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

  const tabBtn = (active: boolean) =>
    `px-3 py-1 text-sm transition-colors ${
      active ? "bg-accent/15 text-accent" : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      {/* selettore modalità + direzione */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {(["base64", "url"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={decode && auto}
              className={`${tabBtn(effMode === m)} disabled:opacity-50`}
            >
              {m === "base64" ? "Base64" : "URL"}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
          {[false, true].map((d) => (
            <button key={String(d)} onClick={() => setDecode(d)} className={tabBtn(decode === d)}>
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

      {/* opzioni: url-safe (solo Base64) + auto-detect (solo Decode) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
        <label
          className={`flex items-center gap-1.5 ${
            effMode === "base64" ? "cursor-pointer" : "cursor-not-allowed opacity-40"
          }`}
        >
          <input
            type="checkbox"
            checked={urlSafe}
            disabled={effMode !== "base64"}
            onChange={(e) => setUrlSafe(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          URL-safe Base64
        </label>
        <label
          className={`flex items-center gap-1.5 ${
            decode ? "cursor-pointer" : "cursor-not-allowed opacity-40"
          }`}
        >
          <input
            type="checkbox"
            checked={auto}
            disabled={!decode}
            onChange={(e) => setAuto(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Auto-detect{decode && auto ? ` (→ ${effMode})` : ""}
        </label>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <div className="flex min-h-0 flex-col gap-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={decode ? "Paste encoded text…" : "Type or paste text…"}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
          />
          <span className="shrink-0 px-1 font-mono text-xs text-zinc-600">
            {input.length} chars · {byteLen(input)} B
          </span>
        </div>
        <div className="flex min-h-0 flex-col gap-1">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
            {result.ok ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">
                {result.out || <span className="text-zinc-600">Output appears here.</span>}
              </pre>
            ) : (
              <span className="text-sm text-red-400">
                {decode ? "Invalid input for this format." : result.err}
              </span>
            )}
          </div>
          <span className="shrink-0 px-1 font-mono text-xs text-zinc-600">
            {result.ok ? `${result.out.length} chars · ${byteLen(result.out)} B` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
