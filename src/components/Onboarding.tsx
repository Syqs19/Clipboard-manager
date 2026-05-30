import { Check, Keyboard, Lock, MousePointer2, Pin } from "lucide-react";
import { useExitAnimation } from "../lib/useExitAnimation";

export function Onboarding({
  open,
  onClose,
  hotkey,
}: {
  open: boolean;
  onClose: () => void;
  hotkey: string;
}) {
  const exit = useExitAnimation(open, 200, onClose);
  if (!exit.mounted) return null;
  const close = exit.requestClose;

  return (
    <div
      onClick={close}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${
        exit.exiting ? "anim-fade-out" : "anim-fade-in"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900 shadow-2xl ${
          exit.exiting ? "anim-scale-out" : "anim-scale-in"
        }`}
      >
        {/* Header con logo + welcome */}
        <div className="flex flex-col items-center gap-3 border-b border-zinc-800 px-6 pt-7 pb-5">
          <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/40 bg-accent/10 text-accent shadow-[0_0_28px_-6px_rgb(var(--accent)/0.55)]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <rect x="5" y="4" width="14" height="17" rx="2.5" />
              <rect
                x="9"
                y="2.5"
                width="6"
                height="3.5"
                rx="1"
                fill="currentColor"
                stroke="none"
              />
              <path d="M8.5 11h7M8.5 14h5" />
            </svg>
          </span>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-zinc-100">
              Welcome to Clipboard
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Everything you copy, always at hand.
            </p>
          </div>
        </div>

        {/* Tips */}
        <ul className="flex flex-col gap-3 px-6 py-5 text-sm">
          <Tip icon={<Keyboard className="h-4 w-4" />}>
            Press{" "}
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
              {hotkey}
            </kbd>{" "}
            anywhere to open the window.
          </Tip>
          <Tip icon={<MousePointer2 className="h-4 w-4" />}>
            Arrow keys <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd>{" "}
            to scroll, <kbd className="kbd">Enter</kbd> or{" "}
            <kbd className="kbd">1-9</kbd> to copy. No auto-paste: the window
            stays open.
          </Tip>
          <Tip icon={<Pin className="h-4 w-4" />}>
            Pin the clips you use most, organize them with colored tags, drag
            pinned items to reorder them.
          </Tip>
          <Tip icon={<Lock className="h-4 w-4" />}>
            Emails, IBANs, card numbers and tokens are masked automatically.
            The database is encrypted at rest with your Windows key.
          </Tip>
        </ul>

        {/* CTA */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-900/60 px-5 py-3">
          <button
            onClick={close}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-400"
          >
            <Check className="h-4 w-4" />
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}

function Tip({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 text-zinc-200">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/60 text-emerald-400">
        {icon}
      </span>
      <span className="flex-1 leading-relaxed">{children}</span>
    </li>
  );
}
