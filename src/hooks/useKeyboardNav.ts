import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Clip } from "../lib/api";

/// Navigazione da tastiera della Clipboard, estratta da App.tsx senza cambiarne
/// il comportamento. Registra due listener globali `keydown`:
/// - ESC: chiude i modal aperti, poi la selezione bulk, altrimenti nasconde la
///   finestra (dipende dagli stati dei modal, quindi si ri-registra quando
///   cambiano);
/// - ↑↓ / Enter / 1-9 / Del: scorre la lista, copia, apre i gruppi, elimina la
///   selezione (registrato una volta; legge lo "stato vivo" tramite i ref).
///
/// I ref sono creati e posseduti da App (dipendono da valori calcolati lì:
/// `visible`, `sel`, ecc.) e passati qui così l'handler legge sempre l'ultimo
/// valore senza ri-registrarsi.
export function useKeyboardNav(opts: {
  // ESC
  groupClip: Clip | null;
  previewClip: Clip | null;
  settingsOpen: boolean;
  setGroupClip: (c: Clip | null) => void;
  setPreviewClip: (c: Clip | null) => void;
  setSettingsOpen: (v: boolean) => void;
  clearSelection: () => void;
  // navigazione
  modalRef: RefObject<boolean>;
  popoverOpenRef: RefObject<boolean>;
  clipboardActiveRef: RefObject<boolean>;
  visibleRef: RefObject<Clip[]>;
  selRef: RefObject<number>;
  selectedIdsRef: RefObject<Set<number>>;
  deleteSelectedRef: RefObject<() => void>;
  flashRef: RefObject<(id: number) => void>;
  setSelectedIndex: (updater: (i: number) => number) => void;
}) {
  const {
    groupClip,
    previewClip,
    settingsOpen,
    setGroupClip,
    setPreviewClip,
    setSettingsOpen,
    clearSelection,
    modalRef,
    popoverOpenRef,
    clipboardActiveRef,
    visibleRef,
    selRef,
    selectedIdsRef,
    deleteSelectedRef,
    flashRef,
    setSelectedIndex,
  } = opts;

  // ESC: chiude prima i modal aperti, poi la selezione bulk, altrimenti nasconde la finestra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (groupClip) setGroupClip(null);
      else if (previewClip) setPreviewClip(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (selectedIdsRef.current.size > 0) clearSelection();
      else getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    groupClip,
    previewClip,
    settingsOpen,
    clearSelection,
    setGroupClip,
    setPreviewClip,
    setSettingsOpen,
    selectedIdsRef,
  ]);

  // navigazione da tastiera: ↑↓ scorri, Invio incolla nell'app attiva, 1-9 rapido
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalRef.current || popoverOpenRef.current) return;
      if (!clipboardActiveRef.current) return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      const list = visibleRef.current;
      if (list.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        if (tag === "TEXTAREA") return; // a capo nell'editor inline
        // Nota: i campi che vogliono "consumare" Enter (es. rename tag)
        // devono chiamare e.stopPropagation() nel proprio handler.
        const c = list[selRef.current];
        if (c) {
          e.preventDefault();
          // i gruppi non si copiano: Enter apre la vista dettaglio
          if (c.content_type === "group") {
            setGroupClip(c);
          } else {
            // solo copia, la finestra resta aperta
            api.copyClip(c.id).catch(() => {});
            flashRef.current(c.id);
          }
        }
      } else if (/^[1-9]$/.test(e.key) && !typing) {
        const c = list[parseInt(e.key, 10) - 1];
        // i gruppi non hanno badge numerico e non si copiano: 1-9 li ignora
        if (c && c.content_type !== "group") {
          e.preventDefault();
          api.copyClip(c.id).catch(() => {});
          flashRef.current(c.id);
        }
      } else if (e.key === "Delete" && !typing) {
        // Del con selezione bulk attiva → elimina tutte le selezionate
        if (selectedIdsRef.current.size > 0) {
          e.preventDefault();
          deleteSelectedRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // registrato una volta: tutto lo stato vivo è letto via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
