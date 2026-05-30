import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { md5 } from "js-md5";
import { useNotify } from "../../components/Toaster";

type Tab = "uuid" | "hash" | "password";

/// Hash esadecimale di un testo. SHA-* via Web Crypto (nativo); MD5 via js-md5
/// (Web Crypto non lo offre).
async function hashText(text: string, algo: string): Promise<string> {
  if (algo === "MD5") return md5(text);
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest(algo, data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const HASH_ALGOS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

/// Genera una password casuale dalle classi di caratteri scelte, usando
/// crypto.getRandomValues (CSPRNG).
function genPassword(len: number, sets: { lower: boolean; upper: boolean; digits: boolean; symbols: boolean }): string {
  let pool = "";
  if (sets.lower) pool += "abcdefghijklmnopqrstuvwxyz";
  if (sets.upper) pool += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (sets.digits) pool += "0123456789";
  if (sets.symbols) pool += "!@#$%^&*()-_=+[]{};:,.?";
  if (!pool) return "";
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[rnd[i] % pool.length];
  return out;
}

export function Generators() {
  const notify = useNotify();
  const [tab, setTab] = useState<Tab>("uuid");

  // UUID
  const [uuid, setUuid] = useState(() => crypto.randomUUID());

  // Hash
  const [hashInput, setHashInput] = useState("");
  const [algo, setAlgo] = useState<(typeof HASH_ALGOS)[number]>("SHA-256");
  const [hashOut, setHashOut] = useState("");
  useEffect(() => {
    let alive = true;
    if (!hashInput) {
      setHashOut("");
      return;
    }
    hashText(hashInput, algo).then((h) => {
      if (alive) setHashOut(h);
    });
    return () => {
      alive = false;
    };
  }, [hashInput, algo]);

  // Password
  const [pwLen, setPwLen] = useState(16);
  const [sets, setSets] = useState({ lower: true, upper: true, digits: true, symbols: false });
  const [pw, setPw] = useState(() => genPassword(16, { lower: true, upper: true, digits: true, symbols: false }));

  async function copy(text: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    notify("Copied", "success");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* tab */}
      <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
        {(["uuid", "hash", "password"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 text-sm capitalize transition-colors ${
              tab === t ? "bg-accent/15 text-accent" : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "uuid" && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">UUID v4</label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
              {uuid}
            </code>
            <button onClick={() => setUuid(crypto.randomUUID())} title="Generate" className="rounded-md border border-accent/40 p-2 text-accent transition-colors hover:bg-accent/10">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={() => copy(uuid)} title="Copy" className="rounded-md border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-300 transition-colors hover:bg-zinc-800/80">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {tab === "hash" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {HASH_ALGOS.map((a) => (
              <button
                key={a}
                onClick={() => setAlgo(a)}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  algo === a ? "border-accent/50 bg-accent/10 text-accent" : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <textarea
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            placeholder="Text to hash…"
            spellCheck={false}
            rows={3}
            className="resize-none rounded-md border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
              {hashOut || <span className="text-zinc-600">Hash appears here.</span>}
            </code>
            <button onClick={() => copy(hashOut)} disabled={!hashOut} title="Copy" className="shrink-0 rounded-md border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {tab === "password" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-400">Length: {pwLen}</label>
            <input
              type="range"
              min={4}
              max={64}
              value={pwLen}
              onChange={(e) => setPwLen(Number(e.target.value))}
              className="flex-1 accent-accent"
            />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {([
              ["lower", "a-z"],
              ["upper", "A-Z"],
              ["digits", "0-9"],
              ["symbols", "!@#"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={sets[key]}
                  onChange={(e) => setSets((s) => ({ ...s, [key]: e.target.checked }))}
                  className="h-4 w-4 accent-accent"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
              {pw || <span className="text-zinc-600">Pick at least one character set.</span>}
            </code>
            <button onClick={() => setPw(genPassword(pwLen, sets))} title="Generate" className="shrink-0 rounded-md border border-accent/40 p-2 text-accent transition-colors hover:bg-accent/10">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={() => copy(pw)} disabled={!pw} title="Copy" className="shrink-0 rounded-md border border-zinc-700/60 bg-zinc-800/60 p-2 text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50">
              <Copy className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
