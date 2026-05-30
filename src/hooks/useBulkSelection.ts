import { useCallback, useRef, useState } from "react";
import { api, type Clip } from "../lib/api";

/// Multi-selezione delle clip (Ctrl/Alt+click toggle, Shift+click range) e le
/// operazioni bulk relative (elimina / pin / tag). Estratto da App.tsx senza
/// cambiarne il comportamento.
///
/// Dipendenze iniettate:
/// - `getVisible`: ritorna la lista attualmente visibile (serve al range di
///   Shift+click e a leggere gli id correnti senza ricalcolarli qui);
/// - `reload`: ricarica clip+tag dopo una mutazione.
export function useBulkSelection(opts: {
  getVisible: () => Clip[];
  reload: () => void;
}) {
  const { getVisible, reload } = opts;

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastBulkIndexRef = useRef<number | null>(null);
  // ref sempre fresco sugli id selezionati: usato dagli handler registrati una
  // volta (keyboard nav, drag&drop) e dalle operazioni async qui sotto.
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastBulkIndexRef.current = null;
  }, []);

  // Ctrl/Cmd+click toggle, Shift+click range
  const onCardBulkClick = (clipIndex: number, e: React.MouseEvent) => {
    const list = getVisible();
    const clip = list[clipIndex];
    if (!clip) return;
    if (e.shiftKey && lastBulkIndexRef.current != null) {
      const start = Math.min(lastBulkIndexRef.current, clipIndex);
      const end = Math.max(lastBulkIndexRef.current, clipIndex);
      const next = new Set(selectedIdsRef.current);
      for (let i = start; i <= end; i++) {
        if (list[i]) next.add(list[i].id);
      }
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIdsRef.current);
      if (next.has(clip.id)) next.delete(clip.id);
      else next.add(clip.id);
      setSelectedIds(next);
    }
    lastBulkIndexRef.current = clipIndex;
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.removeClips(ids);
    clearSelection();
    reload();
  };
  // ref per chiamare deleteSelected dalla keyboard nav (tasto Del) senza
  // ri-registrare il listener globale.
  const deleteSelectedRef = useRef(deleteSelected);
  deleteSelectedRef.current = deleteSelected;

  const togglePinSelected = async (pin: boolean) => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.bulkSetPinned(ids, pin);
    reload();
  };

  const addTagSelected = async (name: string) => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.bulkAddTag(ids, name);
    reload();
  };
  const removeTagSelected = async (name: string) => {
    const ids = Array.from(selectedIdsRef.current);
    if (ids.length === 0) return;
    await api.bulkRemoveTag(ids, name);
    reload();
  };

  return {
    selectedIds,
    selectedIdsRef,
    clearSelection,
    onCardBulkClick,
    deleteSelected,
    deleteSelectedRef,
    togglePinSelected,
    addTagSelected,
    removeTagSelected,
  };
}
