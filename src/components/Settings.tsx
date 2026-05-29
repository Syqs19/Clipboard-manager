import { useEffect, useState } from "react";
import { X, Trash2, Keyboard, Download, Upload, ExternalLink } from "lucide-react";
import { useExitAnimation } from "../lib/useExitAnimation";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Store } from "@tauri-apps/plugin-store";
import {
  open as openDialog,
  save as saveDialog,
  message as messageDialog,
} from "@tauri-apps/plugin-dialog";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  api,
  SELECT_MODIFIERS,
  SENSITIVE_KINDS,
  type SelectModifier,
  type SensitiveKind,
  type Stats,
} from "../lib/api";

/// Formatta un numero di byte in B / KB / MB.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const REPO_URL = "https://github.com/Syqs19/Clipboard-manager";

const MODIFIER_LABELS: Record<SelectModifier, string> = {
  ctrl: "Ctrl",
  alt: "Alt",
};

const KIND_LABELS: Record<SensitiveKind, string> = {
  email: "Email",
  iban: "IBAN",
  card: "Credit cards",
  token: "Tokens / API keys",
  codice_fiscale: "Codice Fiscale (IT)",
  ssn: "US SSN",
  private_key: "Private / SSH keys",
  jwt: "JWT",
  crypto: "Crypto addresses",
  mask: "Masked values (****)",
};

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
  onSelectModifierChange,
}: {
  open: boolean;
  onClose: () => void;
  onReload: () => void;
  onSelectModifierChange?: (m: SelectModifier) => void;
}) {
  const [autostart, setAutostart] = useState(false);
  const [startHidden, setStartHidden] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [maxHistory, setMaxHistory] = useState(5000);
  const [hotkey, setHotkey] = useState("Ctrl+Shift+V");
  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [dontSaveSensitive, setDontSaveSensitive] = useState(false);
  const [sensitiveTtl, setSensitiveTtl] = useState(0);
  const [sensitiveKinds, setSensitiveKinds] = useState<SensitiveKind[]>([
    ...SENSITIVE_KINDS,
  ]);
  const [ocrEnabled, setOcrEnabled] = useState(true);
  // limite dimensione immagini: attivo (on/off) + soglia in MB. Lo store tiene
  // i byte (maxImageBytes, 0 = nessun limite); qui mostriamo i MB all'utente.
  const [imageLimitOn, setImageLimitOn] = useState(false);
  const [imageLimitMb, setImageLimitMb] = useState(10);
  const [selectMod, setSelectMod] = useState<SelectModifier>("ctrl");
  const [tab, setTab] = useState<
    "general" | "security" | "stats" | "about" | "reset"
  >("general");
  const [stats, setStats] = useState<Stats | null>(null);
  const [version, setVersion] = useState("");

  // carica le impostazioni quando si apre
  useEffect(() => {
    if (!open) return;
    (async () => {
      const store = await Store.load("settings.json");
      setStartHidden((await store.get<boolean>("startHidden")) ?? false);
      setCloseToTray((await store.get<boolean>("closeToTray")) ?? true);
      setMaxHistory((await store.get<number>("maxHistory")) ?? 5000);
      setHotkey((await store.get<string>("hotkey")) ?? "Ctrl+Shift+V");
      setDontSaveSensitive((await store.get<boolean>("dontSaveSensitive")) ?? false);
      setSensitiveTtl((await store.get<number>("sensitiveTtlMinutes")) ?? 0);
      const storedKinds = (await store.get<string[]>("sensitiveKinds")) ?? [
        ...SENSITIVE_KINDS,
      ];
      setSensitiveKinds(
        storedKinds.filter((k): k is SensitiveKind =>
          (SENSITIVE_KINDS as readonly string[]).includes(k),
        ),
      );
      setOcrEnabled((await store.get<boolean>("ocrEnabled")) ?? true);
      const bytes = (await store.get<number>("maxImageBytes")) ?? 0;
      setImageLimitOn(bytes > 0);
      if (bytes > 0) setImageLimitMb(Math.round(bytes / (1024 * 1024)));
      const m = (await store.get<string>("multiSelectModifier")) ?? "ctrl";
      if ((SELECT_MODIFIERS as readonly string[]).includes(m)) {
        setSelectMod(m as SelectModifier);
      }
      setAutostart(await isEnabled());
      setConfirmClear(false);
      setHotkeyError("");
      setVersion(await getVersion());
    })();
  }, [open]);

  // carica le statistiche quando si apre il tab "stats" (valori sempre freschi)
  useEffect(() => {
    if (!open || tab !== "stats") return;
    setStats(null);
    api.getStats().then(setStats).catch(() => setStats(null));
  }, [open, tab]);

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

  const exit = useExitAnimation(open, 200, onClose);
  if (!exit.mounted) return null;
  const close = exit.requestClose;

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
  const onExport = async () => {
    const path = await saveDialog({
      title: "Export history",
      defaultPath: `clipboard-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const n = await api.exportHistory(path);
      await messageDialog(`${n} clips exported to:\n${path}`, {
        title: "Export complete",
      });
    } catch (e) {
      await messageDialog(`Error during export: ${e}`, {
        title: "Export failed",
        kind: "error",
      });
    }
  };
  const onImport = async (mode: "merge" | "replace") => {
    const selected = await openDialog({
      title: "Import history",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected || typeof selected !== "string") return;
    try {
      const n = await api.importHistory(selected, mode);
      const summary =
        mode === "replace"
          ? `History replaced: ${n} clips loaded from file.`
          : `${n} new clips added (clips with the same content already present were skipped).`;
      await messageDialog(summary, { title: "Import complete" });
      onReload();
    } catch (e) {
      await messageDialog(`Error during import: ${e}`, {
        title: "Import failed",
        kind: "error",
      });
    }
  };
  const onDontSaveSensitive = async (v: boolean) => {
    setDontSaveSensitive(v);
    await save("dontSaveSensitive", v);
    await api.applyDontSaveSensitive(v);
  };
  const onSensitiveTtl = async (v: number) => {
    if (!Number.isFinite(v) || v < 0) return;
    setSensitiveTtl(v);
    await save("sensitiveTtlMinutes", v);
    await api.applySensitiveTtl(v);
  };
  const onOcrEnabled = async (v: boolean) => {
    setOcrEnabled(v);
    await save("ocrEnabled", v);
    await api.applyOcrEnabled(v);
  };
  // applica il limite in byte: 0 se disattivato, altrimenti mb × 1 MiB
  const applyImageLimit = async (on: boolean, mb: number) => {
    const bytes = on ? Math.round(mb * 1024 * 1024) : 0;
    await save("maxImageBytes", bytes);
    await api.applyMaxImageBytes(bytes);
  };
  const onImageLimitOn = async (v: boolean) => {
    setImageLimitOn(v);
    await applyImageLimit(v, imageLimitMb);
  };
  const onImageLimitMb = async (v: number) => {
    if (!Number.isFinite(v) || v < 1) return;
    setImageLimitMb(v);
    if (imageLimitOn) await applyImageLimit(true, v);
  };
  const onSelectMod = async (m: SelectModifier) => {
    setSelectMod(m);
    await save("multiSelectModifier", m);
    onSelectModifierChange?.(m);
  };
  const onToggleKind = async (kind: SensitiveKind, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...sensitiveKinds, kind]))
      : sensitiveKinds.filter((k) => k !== kind);
    setSensitiveKinds(next);
    await save("sensitiveKinds", next);
    await api.applySensitiveKinds(next);
  };

  return (
    <div
      onClick={close}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 ${
        exit.exiting ? "anim-fade-out" : "anim-fade-in"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl ${
          exit.exiting ? "anim-scale-out" : "anim-scale-in"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <button
            onClick={close}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1 border-b border-zinc-800 px-3 pt-2">
          {(
            [
              ["general", "General"],
              ["security", "Security"],
              ["stats", "Stats"],
              ["about", "About"],
              ["reset", "Reset"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative shrink-0 rounded-t-md px-3 py-2 text-sm transition-colors ${
                tab === id
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
              {tab === id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 bg-emerald-500" />
              )}
            </button>
          ))}
        </div>

        <div key={tab} className="anim-fade-in h-[26rem] divide-y divide-zinc-800 overflow-y-auto px-5">
          {tab === "general" && (
            <>
              <Row
                title="Launch on system startup"
                hint="Open automatically when the PC boots"
              >
                <Toggle checked={autostart} onChange={onAutostart} />
              </Row>

              <Row
                title="Start hidden in tray"
                hint="Don't show the window on startup"
              >
                <Toggle checked={startHidden} onChange={onStartHidden} />
              </Row>

              <Row
                title="Close to tray"
                hint="The X hides instead of quitting the app"
              >
                <Toggle checked={closeToTray} onChange={onCloseToTray} />
              </Row>

              <Row
                title="Max clips in history"
                hint="Unpinned clips above this number are removed"
              >
                <input
                  type="number"
                  min={1}
                  value={maxHistory}
                  onChange={(e) => onMaxHistory(parseInt(e.target.value, 10))}
                  className="w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
              </Row>

              <Row title="Global shortcut" hint="Opens/hides the window">
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
                  {recording ? "Press keys…" : hotkey}
                </button>
              </Row>
              {hotkeyError && (
                <div className="py-2 text-xs text-red-400">{hotkeyError}</div>
              )}

              <Row
                title="Multi-select modifier"
                hint="+ click on clips. Shift+click always extends the range."
              >
                <select
                  value={selectMod}
                  onChange={(e) => onSelectMod(e.target.value as SelectModifier)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                >
                  {SELECT_MODIFIERS.map((m) => (
                    <option key={m} value={m}>
                      {MODIFIER_LABELS[m]}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}

          {tab === "security" && (
            <>
              <Row
                title="Don't save sensitive clips"
                hint="IBAN, cards, emails, tokens: never added to history"
              >
                <Toggle
                  checked={dontSaveSensitive}
                  onChange={onDontSaveSensitive}
                />
              </Row>

              <Row
                title="Delete sensitive after (minutes)"
                hint="0 = never. Expired unpinned sensitive clips are removed"
              >
                <input
                  type="number"
                  min={0}
                  value={sensitiveTtl}
                  onChange={(e) =>
                    onSensitiveTtl(parseInt(e.target.value, 10))
                  }
                  className="w-20 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
              </Row>

              <Row
                title="Index text inside images (OCR)"
                hint="Search inside screenshots. Recognized text is stored in the encrypted DB."
              >
                <Toggle checked={ocrEnabled} onChange={onOcrEnabled} />
              </Row>

              <Row
                title="Limit image size"
                hint="Skip images larger than the limit (they stay on the Windows clipboard). Keeps the encrypted store from bloating."
              >
                <div className="flex items-center gap-2">
                  {imageLimitOn && (
                    <>
                      <input
                        type="number"
                        min={1}
                        value={imageLimitMb}
                        onChange={(e) =>
                          onImageLimitMb(parseInt(e.target.value, 10))
                        }
                        className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-right text-sm text-zinc-100 outline-none focus:border-zinc-600"
                      />
                      <span className="text-sm text-zinc-400">MB</span>
                    </>
                  )}
                  <Toggle checked={imageLimitOn} onChange={onImageLimitOn} />
                </div>
              </Row>

              <div className="py-3">
                <div className="text-sm text-zinc-100">
                  Sensitive categories for skip/cleanup
                </div>
                <div className="text-xs text-zinc-500">
                  Only the selected categories are skipped or deleted. The UI
                  masking always stays active for every detected sensitive
                  value.
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {SENSITIVE_KINDS.map((k) => (
                    <label
                      key={k}
                      className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200"
                    >
                      <input
                        type="checkbox"
                        checked={sensitiveKinds.includes(k)}
                        onChange={(e) => onToggleKind(k, e.target.checked)}
                        className="h-4 w-4 accent-emerald-500"
                      />
                      {KIND_LABELS[k]}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === "stats" && (
            <>
              {stats ? (
                <>
                  <Row title="Total">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {stats.total}
                    </span>
                  </Row>
                  <Row title="Pinned">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {stats.pinned}
                    </span>
                  </Row>
                  <Row title="Images">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {stats.images}
                    </span>
                  </Row>
                  <Row title="Sensitive" hint="Masked clips (IBAN, cards, emails, tokens)">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {stats.sensitive}
                    </span>
                  </Row>
                  <Row title="Tags">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {stats.tags}
                    </span>
                  </Row>
                  <Row title="Database size" hint="Encrypted clips.db (+ WAL)">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {formatBytes(stats.db_bytes)}
                    </span>
                  </Row>
                  <Row title="Images size" hint="Encrypted PNGs + thumbnails on disk">
                    <span className="text-sm tabular-nums text-zinc-100">
                      {formatBytes(stats.images_bytes)}
                    </span>
                  </Row>
                  <Row title="Total disk usage">
                    <span className="text-sm font-semibold tabular-nums text-emerald-400">
                      {formatBytes(stats.db_bytes + stats.images_bytes)}
                    </span>
                  </Row>
                </>
              ) : (
                <div className="py-8 text-center text-sm text-zinc-500">
                  Loading…
                </div>
              )}
            </>
          )}

          {tab === "about" && (
            <>
              <div className="flex flex-col items-center gap-1 py-6 text-center">
                <div className="text-base font-semibold text-zinc-100">
                  Clipboard Manager
                </div>
                <div className="text-sm font-medium tabular-nums text-emerald-400">
                  {version ? `v${version}` : "—"}
                </div>
                <div className="mt-1 max-w-xs text-xs text-zinc-500">
                  Local clipboard manager — private by design. No cloud, no
                  telemetry, no accounts.
                </div>
              </div>

              <Row title="Repository" hint="Source code & releases on GitHub">
                <button
                  onClick={() => openUrl(REPO_URL)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> GitHub
                </button>
              </Row>

              <Row title="License" hint="Proprietary — © 2026 Syqs19">
                <span className="text-sm text-zinc-300">All rights reserved</span>
              </Row>
            </>
          )}

          {tab === "reset" && (
            <>
              <Row
                title="Export history"
                hint="Saves all clips (including images) into a JSON file"
              >
                <button
                  onClick={onExport}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </button>
              </Row>

              <Row
                title="Import history (merge)"
                hint="Adds only new clips from the file (duplicates are skipped)"
              >
                <button
                  onClick={() => onImport("merge")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                >
                  <Upload className="h-3.5 w-3.5" /> Merge
                </button>
              </Row>

              <Row
                title="Import history (replace)"
                hint="Erases the current history and replaces it with the file"
              >
                <button
                  onClick={() => onImport("replace")}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1 text-sm text-red-400 hover:bg-red-500/10"
                >
                  <Upload className="h-3.5 w-3.5" /> Replace
                </button>
              </Row>

              <Row
                title="Clear history"
                hint="Empties history but keeps pinned clips"
              >
            {confirmClear ? (
              <div className="flex gap-2">
                <button
                  onClick={onClear}
                  className="rounded-md bg-red-500/90 px-2.5 py-1 text-sm text-white hover:bg-red-500"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 px-2.5 py-1 text-sm text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            )}
              </Row>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
