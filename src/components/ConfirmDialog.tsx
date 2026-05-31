import type { ReactNode } from "react";

/// Modale di conferma condivisa (overlay + card + footer Cancel/azione). Fonte
/// unica: lo stesso scaffolding era copiato 1:1 tra il merge-prompt di App e la
/// conferma kill di PortKiller. Cambiare z-index/animazione/stile ora è un punto
/// solo. Il corpo è libero (`children`); il bottone d'azione prende etichetta e
/// classe colore (verde "merge" vs rosso "danger") dal chiamante.
export function ConfirmDialog({
  children,
  confirmLabel,
  confirmClassName,
  onConfirm,
  onCancel,
}: {
  children: ReactNode;
  confirmLabel: string;
  /// classe del bottone d'azione (es. `bg-red-500 hover:bg-red-400` per distruttivo).
  confirmClassName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      className="anim-fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="anim-scale-in w-full max-w-xs rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        {children}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
