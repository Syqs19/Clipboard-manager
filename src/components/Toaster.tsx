import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "error" | "success" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type NotifyFn = (message: string, kind?: ToastKind) => void;

const ToastCtx = createContext<NotifyFn>(() => {});

/// Hook per mostrare un toast. Usare come: `const notify = useNotify(); notify("ok", "success")`.
export function useNotify(): NotifyFn {
  return useContext(ToastCtx);
}

const AUTO_DISMISS_MS = 4500;
const EXIT_MS = 200;

/// Provider che mantiene lo stato dei toast e renderizza il container.
export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback<NotifyFn>((message, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, kind, message }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: () => void;
}) {
  const [exiting, setExiting] = useState(false);

  // gestione exit + unmount delayed (sia auto-dismiss che click su X)
  const requestClose = useCallback(() => {
    setExiting(true);
    window.setTimeout(onRemove, EXIT_MS);
  }, [onRemove]);

  useEffect(() => {
    const t = window.setTimeout(requestClose, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [requestClose]);

  const palette: Record<ToastKind, string> = {
    error: "border-red-500/40 bg-zinc-900 text-red-300",
    success: "border-emerald-500/40 bg-zinc-900 text-emerald-300",
    info: "border-zinc-700 bg-zinc-900 text-zinc-200",
  };
  const Icon =
    toast.kind === "error"
      ? AlertCircle
      : toast.kind === "success"
        ? CheckCircle2
        : Info;
  return (
    <div
      className={`${exiting ? "anim-slide-out-right" : "anim-slide-in-right"} pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${palette[toast.kind]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
        {toast.message}
      </span>
      <button
        onClick={requestClose}
        className="shrink-0 text-zinc-500 hover:text-zinc-100"
        title="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
