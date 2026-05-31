import { useEffect, useState } from "react";
import { CheckCircle2, Upload, XCircle } from "lucide-react";
import { HASH_ALGOS, type HashAlgo, hashBytes } from "../shared/hash";
import { humanBytes } from "../../lib/format";

/// Hash / checksum compare: calcola l'hash di un file e lo confronta con un
/// valore atteso (verifica integrità di un download). Condivide hashing e lista
/// algoritmi con i Generators via ../shared/hash (fonte unica).
export function HashCompare() {
  const [algo, setAlgo] = useState<HashAlgo>("SHA-256");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [fileBuf, setFileBuf] = useState<ArrayBuffer | null>(null);
  const [computed, setComputed] = useState("");
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ricalcola l'hash quando cambia il file o l'algoritmo
  useEffect(() => {
    if (!fileBuf) {
      setComputed("");
      return;
    }
    let alive = true;
    setBusy(true);
    hashBytes(fileBuf, algo).then((h) => {
      if (alive) {
        setComputed(h);
        setBusy(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [fileBuf, algo]);

  async function onFile(f: File) {
    setFileName(f.name);
    setFileSize(f.size);
    setFileBuf(await f.arrayBuffer());
  }

  const match =
    computed && expected.trim()
      ? computed.toLowerCase() === expected.trim().toLowerCase()
      : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* algoritmo */}
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

      {/* selezione file: click oppure drag&drop */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-6 text-sm transition-colors ${
          dragOver ? "border-accent/60 bg-accent/5 text-accent" : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400 hover:bg-zinc-800/40"
        }`}
      >
        <Upload className="h-5 w-5" />
        {fileName ? (
          <span className="text-zinc-200">
            {fileName} <span className="text-zinc-500">· {humanBytes(fileSize)}</span>
          </span>
        ) : (
          <span>Drop a file here or click to choose</span>
        )}
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {/* hash calcolato */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Computed</label>
        <code className="break-all rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200">
          {busy ? <span className="text-zinc-500">Hashing…</span> : computed || <span className="text-zinc-600">Choose a file to compute its hash.</span>}
        </code>
      </div>

      {/* hash atteso */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Expected</label>
        <input
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="Paste the expected checksum…"
          spellCheck={false}
          className={`break-all rounded-md border bg-zinc-900/60 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none ${
            match === null ? "border-zinc-700/60 focus:border-accent/50" : match ? "border-emerald-500/60" : "border-red-500/60"
          }`}
        />
      </div>

      {/* esito confronto */}
      {match !== null && (
        <span className={`inline-flex items-center gap-1.5 text-sm ${match ? "text-emerald-400" : "text-red-400"}`}>
          {match ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {match ? "Match — the file is intact." : "No match — the file differs."}
        </span>
      )}
    </div>
  );
}
