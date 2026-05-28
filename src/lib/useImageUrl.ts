import { useEffect, useState } from "react";
import { api } from "./api";

/// Carica un PNG cifrato dal backend (via comando `read_image_bytes`) e ne
/// restituisce un ObjectURL utilizzabile da `<img src=...>`. L'URL viene
/// revocato all'unmount o quando cambia il path.
export function useImageUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let currentUrl: string | null = null;
    api
      .readImageBytes(path)
      .then((buf) => {
        if (cancelled) return;
        const blob = new Blob([buf], { type: "image/png" });
        currentUrl = URL.createObjectURL(blob);
        setUrl(currentUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [path]);
  return url;
}
