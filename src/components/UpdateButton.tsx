import { useEffect, useState } from "react";
import { ArrowDownToLine, Download, Loader2 } from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useNotify } from "./Toaster";

type Phase = "idle" | "checking" | "available" | "downloading" | "installing" | "ready";

/// Floating update button shown in the bottom of the sidebar only when an
/// update is available. Clicking it downloads + installs + relaunches.
export function UpdateButton() {
  const notify = useNotify();
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  // Check once on mount (silent: no error toasts if offline).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("checking");
      try {
        const u = await check();
        if (cancelled) return;
        if (u) {
          setUpdate(u);
          setPhase("available");
        } else {
          setPhase("idle");
        }
      } catch {
        if (!cancelled) setPhase("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onInstall = async () => {
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    try {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) setProgress(Math.round((downloaded / total) * 100));
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });
      setPhase("ready");
      // brief delay so the user sees "installing" → relaunch
      window.setTimeout(() => {
        relaunch().catch(() => {});
      }, 600);
    } catch (e) {
      notify(`Update failed: ${e}`, "error");
      setPhase("available");
      setProgress(null);
    }
  };

  if (phase === "idle" || phase === "checking") return null;

  const label = (() => {
    switch (phase) {
      case "available":
        return `Update to v${update?.version ?? ""}`;
      case "downloading":
        return progress != null ? `Downloading ${progress}%` : "Downloading…";
      case "installing":
        return "Installing…";
      case "ready":
        return "Restarting…";
      default:
        return "";
    }
  })();
  const busy =
    phase === "downloading" || phase === "installing" || phase === "ready";

  return (
    <button
      type="button"
      onClick={busy ? undefined : onInstall}
      disabled={busy}
      title={
        update?.body ? `Release notes:\n\n${update.body}` : "Install update"
      }
      className={`anim-fade-in glow-emerald mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-2 text-left text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-progress disabled:opacity-90`}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : phase === "available" ? (
        <Download className="h-4 w-4 shrink-0" />
      ) : (
        <ArrowDownToLine className="h-4 w-4 shrink-0" />
      )}
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
