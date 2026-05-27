import { useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type Clip } from "../lib/api";

export function ImagePreview({
  clip,
  onClose,
  onCopy,
}: {
  clip: Clip | null;
  onClose: () => void;
  onCopy: (id: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!clip || !clip.image_path) return null;

  const copy = () => {
    onCopy(clip.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/70 p-8"
    >
      <img
        src={convertFileSrc(clip.image_path)}
        alt={clip.preview}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[75vh] max-w-full rounded-lg border border-zinc-700 object-contain shadow-2xl"
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-3"
      >
        <span className="text-sm text-zinc-400">{clip.preview}</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-400"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copiato" : "Copia"}
        </button>
      </div>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-md p-2 text-zinc-300 transition-colors hover:bg-white/10"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
