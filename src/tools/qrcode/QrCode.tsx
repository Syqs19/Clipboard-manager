import { useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import QRCode from "qrcode";
import { useNotify } from "../../components/Toaster";

type Level = "L" | "M" | "Q" | "H";

/// QR code generator: testo/URL → QR PNG, con livello di correzione d'errore,
/// dimensione e colore del modulo selezionabili, download e copia immagine.
export function QrCode() {
  const notify = useNotify();
  const [text, setText] = useState("");
  const [level, setLevel] = useState<Level>("M");
  const [size, setSize] = useState(320);
  const [dark, setDark] = useState("#e4e4e7"); // colore dei moduli (zinc-200)
  const [transparent, setTransparent] = useState(true); // sfondo trasparente
  const [dataUrl, setDataUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!text) {
      setDataUrl("");
      setError("");
      return;
    }
    let alive = true;
    QRCode.toDataURL(text, {
      errorCorrectionLevel: level,
      margin: 2,
      width: size,
      color: { dark, light: transparent ? "#0000" : "#ffffff" },
    })
      .then((url) => alive && (setDataUrl(url), setError("")))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [text, level, size, dark, transparent]);

  function download() {
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "qrcode.png";
    a.click();
    notify("QR code downloaded", "success");
  }

  /// Copia l'immagine PNG negli appunti (dataURL → blob → ClipboardItem).
  async function copyImage() {
    if (!dataUrl) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("QR code copied", "success");
    } catch {
      notify("Copy not supported here", "error");
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Text or URL to encode…"
        spellCheck={false}
        rows={3}
        className="shrink-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
      />

      {/* opzioni: correzione errore, dimensione, colore, sfondo */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-400">
        <div className="flex items-center gap-1.5">
          <span>Error level:</span>
          {(["L", "M", "Q", "H"] as Level[]).map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              title={{ L: "Low ~7%", M: "Medium ~15%", Q: "Quartile ~25%", H: "High ~30%" }[l]}
              className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                level === l ? "border-accent/50 bg-accent/10 text-accent" : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5">
          Size
          <input
            type="range"
            min={128}
            max={512}
            step={32}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="w-24 accent-accent"
          />
          <span className="w-10 font-mono text-xs text-zinc-500">{size}px</span>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          Color
          <input
            type="color"
            value={dark}
            onChange={(e) => setDark(e.target.value)}
            className="h-5 w-5"
          />
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1.5">
          <input
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Transparent bg
        </label>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={copyImage}
            disabled={!dataUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button
            onClick={download}
            disabled={!dataUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> PNG
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-4">
        {error ? (
          <span className="text-sm text-red-400">{error}</span>
        ) : dataUrl ? (
          <img src={dataUrl} alt="QR code" className="max-h-full" />
        ) : (
          <span className="text-sm text-zinc-600">The QR code appears here.</span>
        )}
      </div>
    </div>
  );
}
