import { useMemo, useRef, useState } from "react";
import { Download, FolderOpen, Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, type BatchItem } from "../../lib/api";
import { useNotify } from "../../components/Toaster";
import { humanBytes } from "../../lib/format";
import { ToolButton } from "../shared/ToolButton";
import { Toggle } from "../shared/Toggle";

/// Formati di output offerti (specchio di TargetFormat lato Rust). `lossy` =
/// lo slder qualità ha effetto (JPEG/WebP/AVIF). Estensione usata nel Save.
const FORMATS = [
  { key: "png", label: "PNG", ext: "png", lossy: false },
  { key: "jpeg", label: "JPEG", ext: "jpg", lossy: true },
  { key: "webp", label: "WebP", ext: "webp", lossy: false },
  { key: "bmp", label: "BMP", ext: "bmp", lossy: false },
  { key: "tiff", label: "TIFF", ext: "tiff", lossy: false },
  { key: "ico", label: "ICO", ext: "ico", lossy: false },
  { key: "avif", label: "AVIF", ext: "avif", lossy: true },
] as const;

type FormatKey = (typeof FORMATS)[number]["key"];

/// File singolo scelto via drag&drop / file input (passa per i byte).
type SingleFile = { name: string; size: number; bytes: Uint8Array };

/// Image Converter: cambia formato a un'immagine (PNG/JPEG/WebP/BMP/TIFF/ICO/AVIF),
/// con qualità (per i formati con perdita) e resize opzionale. Un file singolo
/// passa per i byte (anteprima); più file usano i path nativi (batch in una
/// cartella). Tutto in locale via il backend Rust (crate `image`).
export function ImageConverter() {
  const notify = useNotify();
  const [format, setFormat] = useState<FormatKey>("webp");
  const [quality, setQuality] = useState(80);
  const [resize, setResize] = useState(false);
  const [maxDim, setMaxDim] = useState(1920);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // file singolo (modalità bytes) e ultima dimensione convertita per il feedback
  const [single, setSingle] = useState<SingleFile | null>(null);
  const [convertedSize, setConvertedSize] = useState<number | null>(null);
  // batch: lista di path scelti col dialog nativo
  const [batch, setBatch] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fmt = FORMATS.find((f) => f.key === format)!;
  const maxDimArg = resize ? maxDim : null;
  // qualità inviata solo se il formato è con perdita (altrimenti ininfluente)
  const qualityArg = fmt.lossy ? quality : 100;

  // basename di un path (per mostrare il nome nel batch)
  const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

  function takeSingle(file: File) {
    file.arrayBuffer().then((buf) => {
      setSingle({ name: file.name, size: file.size, bytes: new Uint8Array(buf) });
      setBatch([]);
      setConvertedSize(null);
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 1) takeSingle(files[0]);
    else if (files.length > 1)
      notify("Drop one image, or use “Choose files…” for a batch.", "info");
  }

  /// Scelta di più file via dialog nativo → modalità batch (path).
  async function chooseBatch() {
    const sel = await openDialog({
      title: "Choose images to convert",
      multiple: true,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "tif", "gif", "ico"] },
      ],
    });
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    // path scelti dal dialog → modalità batch (anche con un solo file: lo
    // converte il backend leggendolo da disco, senza passare i byte alla UI).
    setBatch(paths);
    setSingle(null);
    setConvertedSize(null);
  }

  /// Converte il file singolo: chiede dove salvare, poi il backend converte i
  /// byte e scrive il file, ritornando la dimensione (per il feedback prima→dopo).
  async function convertSingle() {
    if (!single) return;
    const base = single.name.replace(/\.[^.]+$/, "");
    const dest = await saveDialog({
      title: "Save converted image",
      defaultPath: `${base}.${fmt.ext}`,
      filters: [{ name: fmt.label, extensions: [fmt.ext] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const size = await api.convertImageBytesToPath(
        Array.from(single.bytes),
        dest,
        format,
        qualityArg,
        maxDimArg,
      );
      setConvertedSize(size);
      notify(`Saved ${baseName(dest)} (${humanBytes(size)})`, "success");
    } catch (e) {
      notify(`Conversion failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  /// Converte tutti i file del batch in una cartella scelta una volta.
  async function convertBatch() {
    if (batch.length === 0) return;
    const outDir = await openDialog({ title: "Choose output folder", directory: true });
    if (!outDir || typeof outDir !== "string") return;
    setBusy(true);
    try {
      const report: BatchItem[] = await api.convertImagesBatch(
        batch,
        outDir,
        format,
        qualityArg,
        maxDimArg,
      );
      const ok = report.filter((r) => r.output).length;
      const failed = report.length - ok;
      notify(
        failed === 0
          ? `Converted ${ok} image${ok === 1 ? "" : "s"} to ${fmt.label}.`
          : `Converted ${ok}, ${failed} failed.`,
        failed === 0 ? "success" : "error",
      );
    } catch (e) {
      notify(`Batch failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const reduction = useMemo(() => {
    if (!single || convertedSize == null || single.size === 0) return null;
    const pct = Math.round((1 - convertedSize / single.size) * 100);
    return pct; // positivo = più piccolo, negativo = più grande
  }, [single, convertedSize]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* dropzone / scelta file */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-8 text-sm transition-colors ${
          dragOver
            ? "border-accent/60 bg-accent/5 text-accent"
            : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400"
        }`}
      >
        <ImageIcon className="h-6 w-6" />
        <span>Drop an image here</span>
        <div className="mt-1 flex items-center gap-2">
          <ToolButton
            icon={Upload}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose file
          </ToolButton>
          <ToolButton icon={FolderOpen} onClick={chooseBatch}>
            Choose files…
          </ToolButton>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) takeSingle(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* formato di output */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Convert to
        </span>
        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFormat(f.key)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                format === f.key
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-zinc-700/60 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* qualità (solo formati con perdita) */}
      {fmt.lossy && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">Quality: {quality}</span>
          <input
            type="range"
            min={1}
            max={100}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
        </div>
      )}

      {/* resize opzionale */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
        <Toggle label="Resize (max side)" checked={resize} onChange={setResize} />
        {resize && (
          <label className="flex items-center gap-1.5 text-sm text-zinc-400">
            <input
              type="number"
              min={16}
              max={10000}
              value={maxDim}
              onChange={(e) =>
                setMaxDim(Math.min(10000, Math.max(16, Number(e.target.value) || 16)))
              }
              className="w-24 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-200 focus:border-accent/50 focus:outline-none"
            />
            px
          </label>
        )}
      </div>

      {/* azione + stato */}
      {single ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-zinc-200">{single.name}</span>
            <span className="shrink-0 font-mono text-xs text-zinc-500">
              {humanBytes(single.size)}
              {convertedSize != null && (
                <>
                  {" → "}
                  <span className="text-zinc-300">{humanBytes(convertedSize)}</span>
                  {reduction != null && (
                    <span className={reduction >= 0 ? "text-emerald-400" : "text-amber-400"}>
                      {" "}
                      ({reduction >= 0 ? "−" : "+"}
                      {Math.abs(reduction)}%)
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
          <ToolButton
            variant="accent"
            icon={busy ? undefined : Download}
            onClick={convertSingle}
            disabled={busy}
            className={`self-start ${busy ? "btn-busy" : ""}`}
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting…
              </>
            ) : (
              `Convert & save as ${fmt.label}`
            )}
          </ToolButton>
        </div>
      ) : batch.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex max-h-48 flex-col gap-1 overflow-auto rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2">
            {batch.map((p) => (
              <span key={p} className="truncate px-1 text-sm text-zinc-300" title={p}>
                {baseName(p)}
              </span>
            ))}
          </div>
          <ToolButton
            variant="accent"
            icon={busy ? undefined : Download}
            onClick={convertBatch}
            disabled={busy}
            className={`self-start ${busy ? "btn-busy" : ""}`}
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Converting…
              </>
            ) : (
              `Convert ${batch.length} files to ${fmt.label}…`
            )}
          </ToolButton>
        </div>
      ) : null}
    </div>
  );
}
