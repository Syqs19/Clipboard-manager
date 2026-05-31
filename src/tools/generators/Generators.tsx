import { useEffect, useState } from "react";
import { Copy, RefreshCw, Upload } from "lucide-react";
import { useCopy } from "../../hooks/useCopy";
import { ToolButton } from "../shared/ToolButton";
import { Toggle } from "../shared/Toggle";
import { HASH_ALGOS, type HashAlgo, hashBytes, hashText } from "../shared/hash";
import { tabBtnClass } from "../shared/ui";

type Tab = "uuid" | "hash" | "password";

/// UUID v7: 48 bit di timestamp (ms) + versione 7 + bit casuali. A differenza
/// del v4 (random puro), il v7 è ordinabile per tempo di creazione.
function uuidV7(): string {
  const ts = Date.now();
  const rnd = new Uint8Array(10);
  crypto.getRandomValues(rnd);
  const b = new Uint8Array(16);
  // 48 bit di timestamp (big-endian) nei primi 6 byte
  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b.set(rnd, 6);
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
}

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";
const AMBIGUOUS = /[O0Il1|]/g;

function genPassword(
  len: number,
  sets: { lower: boolean; upper: boolean; digits: boolean; symbols: boolean },
  noAmbiguous: boolean,
): string {
  let pool = "";
  if (sets.lower) pool += LOWER;
  if (sets.upper) pool += UPPER;
  if (sets.digits) pool += DIGITS;
  if (sets.symbols) pool += SYMBOLS;
  if (noAmbiguous) pool = pool.replace(AMBIGUOUS, "");
  if (!pool) return "";
  const rnd = new Uint32Array(len);
  crypto.getRandomValues(rnd);
  let out = "";
  for (let i = 0; i < len; i++) out += pool[rnd[i] % pool.length];
  return out;
}

/// Stima di robustezza in bit di entropia (len × log2(dimensione pool)) → 0..4.
function strength(pw: string, poolSize: number): { score: number; label: string } {
  if (!pw || poolSize <= 1) return { score: 0, label: "—" };
  const bits = pw.length * Math.log2(poolSize);
  const score = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  const label = ["—", "Weak", "Fair", "Strong", "Very strong"][score];
  return { score, label };
}

export function Generators() {
  const copy = useCopy();
  const [tab, setTab] = useState<Tab>("uuid");

  // ---- UUID ----
  const [uuidVer, setUuidVer] = useState<"v4" | "v7">("v4");
  const [uuidCount, setUuidCount] = useState(1);
  const gen = () =>
    Array.from({ length: uuidCount }, () =>
      uuidVer === "v4" ? crypto.randomUUID() : uuidV7(),
    );
  const [uuids, setUuids] = useState<string[]>(() => [crypto.randomUUID()]);

  // ---- Hash ----
  const [hashInput, setHashInput] = useState("");
  const [algo, setAlgo] = useState<HashAlgo>("SHA-256");
  const [hashOut, setHashOut] = useState("");
  const [fileName, setFileName] = useState("");
  useEffect(() => {
    // l'hash del testo si ricalcola al volo; quello del file è on-demand (sotto)
    if (fileName) return;
    let alive = true;
    if (!hashInput) {
      setHashOut("");
      return;
    }
    hashText(hashInput, algo).then((h) => alive && setHashOut(h));
    return () => {
      alive = false;
    };
  }, [hashInput, algo, fileName]);

  async function hashFile(file: File) {
    setFileName(file.name);
    setHashInput("");
    const buf = await file.arrayBuffer();
    setHashOut(await hashBytes(buf, algo));
  }
  // se cambio algoritmo con un file caricato, ricalcola: gestito ricliccando il file
  useEffect(() => {
    setFileName("");
  }, [algo]);

  // ---- Password ----
  const [pwLen, setPwLen] = useState(16);
  const [sets, setSets] = useState({ lower: true, upper: true, digits: true, symbols: false });
  const [noAmbiguous, setNoAmbiguous] = useState(false);
  const [pw, setPw] = useState(() => genPassword(16, { lower: true, upper: true, digits: true, symbols: false }, false));
  const poolSize = (() => {
    let p = "";
    if (sets.lower) p += LOWER;
    if (sets.upper) p += UPPER;
    if (sets.digits) p += DIGITS;
    if (sets.symbols) p += SYMBOLS;
    if (noAmbiguous) p = p.replace(AMBIGUOUS, "");
    return p.length;
  })();
  const pwStrength = strength(pw, poolSize);

  // copia solo se c'è del testo (la guardia resta qui: copy() è invocata su
  // valori potenzialmente vuoti — uuid/hash/password non ancora generati).
  const copyIfAny = (text: string) => {
    if (text) void copy(text);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
        {(["uuid", "hash", "password"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`${tabBtnClass(tab === t)} flex-1 px-3 py-1.5 text-sm capitalize`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "uuid" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-zinc-700/60">
              {(["v4", "v7"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setUuidVer(v)}
                  className={`${tabBtnClass(uuidVer === v)} px-3 py-1 text-sm uppercase`}
                >
                  {v}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-zinc-400">
              Count
              <input
                type="number"
                min={1}
                max={100}
                value={uuidCount}
                onChange={(e) => setUuidCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                className="w-16 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-200 focus:border-accent/50 focus:outline-none"
              />
            </label>
            <ToolButton variant="accent" icon={RefreshCw} onClick={() => setUuids(gen())} className="ml-auto">
              Generate
            </ToolButton>
            <ToolButton icon={Copy} onClick={() => copyIfAny(uuids.join("\n"))}>
              Copy all
            </ToolButton>
          </div>
          <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded-md border border-zinc-800/60 bg-zinc-900/40 p-2">
            {uuids.map((u, i) => (
              <button key={i} onClick={() => copyIfAny(u)} title="Copy" className="rounded px-2 py-1 text-left font-mono text-sm text-zinc-200 transition-colors hover:bg-zinc-800/60">
                {u}
              </button>
            ))}
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
            onChange={(e) => {
              setHashInput(e.target.value);
              setFileName("");
            }}
            placeholder="Text to hash…"
            spellCheck={false}
            rows={3}
            className="resize-none rounded-md border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
          />
          <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80">
            <Upload className="h-3.5 w-3.5" />
            {fileName || "Hash a file…"}
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void hashFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
              {hashOut || <span className="text-zinc-600">Hash appears here.</span>}
            </code>
            <ToolButton icon={Copy} onClick={() => copyIfAny(hashOut)} disabled={!hashOut} title="Copy" className="shrink-0" />
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
              <Toggle
                key={key}
                label={label}
                checked={sets[key]}
                onChange={(v) => setSets((s) => ({ ...s, [key]: v }))}
              />
            ))}
            <Toggle
              label="No ambiguous (O0 l1)"
              checked={noAmbiguous}
              onChange={setNoAmbiguous}
            />
          </div>
          {/* barra di robustezza */}
          <div className="flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-full ${
                    i <= pwStrength.score
                      ? pwStrength.score <= 1
                        ? "bg-red-500"
                        : pwStrength.score === 2
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      : "bg-zinc-700"
                  }`}
                />
              ))}
            </div>
            <span className="w-24 shrink-0 text-right text-xs text-zinc-400">{pwStrength.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
              {pw || <span className="text-zinc-600">Pick at least one character set.</span>}
            </code>
            <ToolButton variant="accent" icon={RefreshCw} onClick={() => setPw(genPassword(pwLen, sets, noAmbiguous))} title="Generate" className="shrink-0" />
            <ToolButton icon={Copy} onClick={() => copyIfAny(pw)} disabled={!pw} title="Copy" className="shrink-0" />
          </div>
        </div>
      )}
    </div>
  );
}
