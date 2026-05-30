import { useCallback, useEffect, useRef, useState } from "react";
import { api, onClipsChanged, type Clip, type Tag } from "../lib/api";

/// Sorgente dati della Clipboard: possiede `clips` e `tags`, li ricarica dal
/// backend (lista o ricerca a seconda di `query`) e si sottoscrive una sola
/// volta all'evento `clips-changed` del watcher. Espone anche il feedback
/// "Copiato" (`copiedId` lampeggia ~900ms), legato agli stessi eventi.
///
/// Estratto da App.tsx senza cambiarne il comportamento: gli `useRef` che
/// tenevano `reload`/`flashCopied` "freschi" dentro l'effetto registrato una
/// volta vivono ora qui dentro, incapsulati.
export function useClipboardData(query: string) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const reload = useCallback(async () => {
    const data = query.trim()
      ? await api.searchClips(query)
      : await api.listClips();
    setClips(data);
    setTags(await api.listTags());
  }, [query]);

  // ricarica al mount e quando cambia la ricerca
  useEffect(() => {
    reload();
  }, [reload]);

  // feedback "Copiato": id della clip appena copiata/risalita (lampeggia ~900ms)
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const flashCopied = useCallback((id: number) => {
    setCopiedId(id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 900);
  }, []);

  // si sottoscrive una sola volta agli eventi del watcher; usa i ref per
  // leggere reload/flash freschi senza ri-registrare il listener.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const flashRef = useRef(flashCopied);
  flashRef.current = flashCopied;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onClipsChanged((id) => {
      reloadRef.current();
      if (id != null) flashRef.current(id);
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return { clips, tags, reload, copiedId, flashCopied };
}
