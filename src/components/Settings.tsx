import { useEffect, useState } from "react";
import { X, Trash2, Keyboard } from "lucide-react";
import { Store } from "@tauri-apps/plugin-store";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { api } from "../lib/api";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-emerald-500" : "bg-zinc-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm text-zinc-100">{title}</div>
        {hint && <div className="text-xs text-zinc-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/// Costruisce una stringa scorciatoia tipo "Ctrl+Shift+V" da un evento tastiera.
function buildCombo(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");
  if (e.metaKey) mods.push("Super");
  let key = "";
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else return null;
  if (mods.length === 0) return null; // serve almeno un modificatore
  return [...mods, key].join("+");
}

export function Settings({
  open,
  onClose,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  onReload: () => void;
}) {
  const [autostart, setAutostart] = useState(false);
  const [startHidden, setStartHidden] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [maxHistory, setMaxHistory] = useState(200);
  const [hotkey, setHotkey] = useState("Ctrl+Shift+V");
  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  // carica le impostazioni quando si apre
  useEffect(() => {
    if (!open) return;
    (async () => {
      const store = await Store.load("settings.json");
      setStartHidden((await store.get<boolean>("startHidden")) ?? false);
      setCloseToTray((await store.get<boolean>("closeToTray")) ?? true);
      setMaxHistory((await store.get<number>("maxHistory")) ?? 200);
      setHotkey((await store.get<string>("hotkey")) ?? "Ctrl+Shift+V");
      setAutostart(await isEnabled());
      setConfirmClear(false);
      setHotkeyError("");
    })();
  }, [open]);

  // cattura della scorciatoia
  useEffect(() => {
    if (!recording) return;
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = buildCombo(e);
      if (!combo) return;
      setRecording(false);
      try {
        await api.applyHotkey(combo);
        setHotkey(combo);
        setHotkeyError("");
        const store = await Store.load("settings.json");
        await store.set("hotkey", combo);
        await store.save();
      } catch (err) {
        setHotkeyError(`Scorciatoia non valida o già in uso: ${err}`);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  if (!open) return null;

  const save = async (key: string, val: unknown) => {
    const store = await Store.load("settings.json");
    await store.set(key, val);
    await store.save();
  };

  const onAutostart = async (v: boolean) => {
    setAutostart(v);
    if (v) await enable();
    else await disable();
  };
  const onStartHidden = async (v: boolean) => {
    setStartHidden(v);
    await save("startHidden", v);
  };
  const onCloseToTray = async (v: boolean) => {
    setCloseToTray(v);
    await save("closeToTray", v);
    await api.applyCloseToTray(v);
  };
  const onMaxHistory = async (v: number) => {
    if (!Number.isFinite(v) || v < 1) return;
    setMaxHistory(v);
    await save("maxHistory", v);
    await api.applyMaxHistory(v);
  };
  const onClear = async () => {
    await api.clearHistory();
    setConfirmClear(false);
    onReload();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Impostazioni</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="divide-y divide-zinc-800 px-5">
          <Row
            title="Avvia all'avvio del sistema"
            hint="Apri automaticamente all'accensione del PC"
          >
            <Toggle checked={autostart} onChange={onAutostart} />
          </Row>

          <Row
            title="Avvia nascosto nel tray"
            hint="All'avvio non mostrare la finestra"
          >
            <Toggle checked={startHidden} onChange={onStartHidden} />
          </Row>

          <Row
            title="Chiudi nel tray"
            hint="La X nasconde invece di uscire dall'app"
          >
            <Toggle checked={closeToTray} onChange={onCloseToTray} />
          </Row>

          <Row
            title="Max clip in cronologia"
            hint="Le clip non fissate oltre questo numero vengono rimosse"
          >
            <input
              type="number"
              min={1}
              value={maxHistory}
              onChange={(e) => onMaxHistory(parseInt(e.target.value, 10))}
              className="w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-sm text-zinc-100 outline-none focus:border-zinc-600"
            />
          </Row>

          <Row title="Scorciatoia globale" hint="Apre/nasconde la finestra">
            <button
              onClick={() => {
                setHotkeyError("");
                setRecording(true);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
                recording
                  ? "border-emerald-500 text-emerald-400"
                  : "border-zinc-700 text-zinc-200 hover:border-zinc-600"
              }`}
            >
              <Keyboard className="h-3.5 w-3.5" />
              {recording ? "Premi i tasti…" : hotkey}
            </button>
          </Row>
          {hotkeyError && (
            <div className="py-2 text-xs text-red-400">{hotkeyError}</div>
          )}

          <Row
            title="Pulisci cronologia"
            hint="Svuota la cronologia ma mantiene le clip fissate"
          >
            {confirmClear ? (
              <div className="flex gap-2">
                <button
                  onClick={onClear}
                  className="rounded-md bg-red-500/90 px-2.5 py-1 text-sm text-white hover:bg-red-500"
                >
                  Conferma
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-300"
                >
                  Annulla
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1 text-sm text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Pulisci
              </button>
            )}
          </Row>
        </div>
      </div>
    </div>
  );
}
