import { useEffect, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { Store } from "@tauri-apps/plugin-store";
import { toolsRegistry } from "./registry";
import type { ToolDescriptor } from "./types";

const STORE = "settings.json";
const ORDER_KEY = "toolOrder";
const FAV_KEY = "toolFavorites";

/// Riconcilia l'ordine salvato col registry attuale: tiene gli id salvati che
/// esistono ancora (nell'ordine salvato) e accoda i tool nuovi del registry non
/// ancora presenti. Così aggiungere un tool lo fa comparire in fondo senza
/// rompere l'ordine personalizzato, e rimuoverne uno non lascia id orfani.
function reconcileOrder(savedOrder: string[]): string[] {
  const ids = toolsRegistry.map((t) => t.id);
  const kept = savedOrder.filter((id) => ids.includes(id));
  const missing = ids.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

/// Preferenze dei Tools (ordine + preferiti) persistite su settings.json, lo
/// stesso store delle impostazioni. Tutto lato frontend, nessun comando Rust.
export function useToolPrefs() {
  // ordine come lista di id; default = ordine del registry finché non carica.
  const [order, setOrder] = useState<string[]>(() =>
    toolsRegistry.map((t) => t.id),
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  // evita di scrivere sullo store durante il caricamento iniziale
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const store = await Store.load(STORE);
      const savedOrder = (await store.get<string[]>(ORDER_KEY)) ?? [];
      const savedFav = (await store.get<string[]>(FAV_KEY)) ?? [];
      const ids = toolsRegistry.map((t) => t.id);
      setOrder(reconcileOrder(savedOrder));
      setFavorites(savedFav.filter((id) => ids.includes(id)));
      setLoaded(true);
    })();
  }, []);

  async function persist(key: string, value: string[]) {
    const store = await Store.load(STORE);
    await store.set(key, value);
    await store.save();
  }

  /// Sposta un tool prima/dopo un altro (drag&drop) e salva il nuovo ordine.
  function reorder(activeId: string, overId: string) {
    setOrder((prev) => {
      const from = prev.indexOf(activeId);
      const to = prev.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = arrayMove(prev, from, to);
      if (loaded) void persist(ORDER_KEY, next);
      return next;
    });
  }

  /// Aggiunge/toglie un tool dai preferiti e salva.
  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      if (loaded) void persist(FAV_KEY, next);
      return next;
    });
  }

  // i ToolDescriptor del registry nell'ordine personalizzato
  const orderedTools: ToolDescriptor[] = order
    .map((id) => toolsRegistry.find((t) => t.id === id))
    .filter((t): t is ToolDescriptor => t !== undefined);

  return { orderedTools, favorites, reorder, toggleFavorite };
}
