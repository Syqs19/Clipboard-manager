import { useRef, useState } from "react";
import { Download, Image as ImageIcon, Info, Loader2, Upload } from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api } from "../../lib/api";
import { useNotify } from "../../components/Toaster";
import { humanBytes } from "../../lib/format";
import { ToolButton } from "../shared/ToolButton";
import { Toggle } from "../shared/Toggle";

type Loaded = { name: string; size: number; bytes: Uint8Array };

/// Vectorial: vettorializza (tracing) un'immagine raster in SVG. NON è una
/// conversione di formato come l'Image Converter: ricostruisce le forme, quindi
/// rende bene su loghi/icone/grafica piatta e male sulle foto. La UI lo dice.
export function Vectorial() {
  const notify = useNotify();
  const [img, setImg] = useState<Loaded | null>(null);
  const [binary, setBinary] = useState(false);
  const [filterSpeckle, setFilterSpeckle] = useState(4);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [svgSize, setSvgSize] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

  function take(file: File) {
    file.arrayBuffer().then((buf) => {
      setImg({ name: file.name, size: file.size, bytes: new Uint8Array(buf) });
      setSvgSize(null);
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
    if (f) take(f);
  }

  async function run() {
    if (!img) return;
    const base = img.name.replace(/\.[^.]+$/, "");
    const dest = await saveDialog({
      title: "Save SVG",
      defaultPath: `${base}.svg`,
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const size = await api.vectorizeImageToPath(
        Array.from(img.bytes),
        dest,
        binary,
        filterSpeckle,
      );
      setSvgSize(size);
      notify(`Saved ${baseName(dest)} (${humanBytes(size)})`, "success");
    } catch (e) {
      notify(`Vectorization failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* avviso onesto: il tracing rende bene solo su grafica piatta */}
      <div className="flex items-start gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          Best for logos, icons and flat graphics. Photos trace into thousands of
          shapes and rarely look good — use the Image Converter for those.
        </span>
      </div>

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
        <ToolButton icon={Upload} onClick={() => fileInputRef.current?.click()}>
          Choose file
        </ToolButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) take(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* opzioni di tracing */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
        <Toggle label="Black & white" checked={binary} onChange={setBinary} />
        <label className="flex items-center gap-1.5 text-sm text-zinc-400">
          Denoise
          <input
            type="number"
            min={0}
            max={100}
            value={filterSpeckle}
            onChange={(e) =>
              setFilterSpeckle(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
            }
            className="w-16 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-200 focus:border-accent/50 focus:outline-none"
          />
          <span className="text-xs text-zinc-600">px</span>
        </label>
      </div>

      {/* azione + stato */}
      {img && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-zinc-200">{img.name}</span>
            <span className="shrink-0 font-mono text-xs text-zinc-500">
              {humanBytes(img.size)}
              {svgSize != null && (
                <>
                  {" → "}
                  <span className="text-zinc-300">{humanBytes(svgSize)}</span> SVG
                </>
              )}
            </span>
          </div>
          <ToolButton
            variant="accent"
            icon={busy ? undefined : Download}
            onClick={run}
            disabled={busy}
            className={`self-start ${busy ? "btn-busy" : ""}`}
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Tracing…
              </>
            ) : (
              "Vectorize & save as SVG"
            )}
          </ToolButton>
        </div>
      )}
    </div>
  );
}
