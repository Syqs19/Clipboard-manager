import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCw, Search, X } from "lucide-react";
import { api, type PortInfo } from "../../lib/api";
import { useNotify } from "../../components/Toaster";

/// Port Killer: elenca le porte TCP in ascolto (porta, PID, processo) e permette
/// di terminare il processo che le tiene, con conferma. Il colore d'accent dei
/// bottoni "Kill" segue la sezione (rosso in Tools, via la variabile --accent);
/// il bottone di conferma distruttivo è invece un rosso fisso (semantica "danger").
export function PortKiller() {
  const notify = useNotify();
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // riga in attesa di conferma kill (null = nessuna)
  const [confirm, setConfirm] = useState<PortInfo | null>(null);
  // pid con kill in corso (per disabilitare il bottone)
  const [killingPid, setKillingPid] = useState<number | null>(null);
  // testo di ricerca (filtra su porta/PID/nome/path)
  const [query, setQuery] = useState("");
  // nasconde i processi di sistema (Windows): di default ON, per ridurre il rumore
  const [hideSystem, setHideSystem] = useState(true);

  // lista filtrata: prima togli i processi di sistema (se attivo), poi applica
  // la ricerca su porta, PID, nome processo e path.
  const visible = useMemo(() => {
    if (!ports) return [];
    const q = query.trim().toLowerCase();
    return ports.filter((p) => {
      if (hideSystem && p.is_system) return false;
      if (!q) return true;
      return (
        String(p.port).includes(q) ||
        String(p.pid).includes(q) ||
        p.process_name.toLowerCase().includes(q) ||
        p.display_name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q)
      );
    });
  }, [ports, query, hideSystem]);

  // quante righe di sistema sono nascoste dal filtro (per l'hint nello stato vuoto)
  const hiddenSystemCount = useMemo(
    () => (ports ? ports.filter((p) => p.is_system).length : 0),
    [ports],
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setPorts(await api.listPorts());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doKill(p: PortInfo) {
    setConfirm(null);
    setKillingPid(p.pid);
    try {
      await api.killProcess(p.pid);
      notify(`Killed ${p.process_name} (PID ${p.pid})`, "success");
      await load();
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setKillingPid(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* intestazione: titolo + refresh */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          TCP ports currently listening on this machine.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100 disabled:opacity-60"
        >
          <RotateCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* barra di ricerca + filtro "nascondi processi di sistema" */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by port, PID, name or path…"
            className="w-full rounded-md border border-zinc-700/60 bg-zinc-800/60 py-1.5 pl-8 pr-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-accent/50 focus:outline-none"
          />
        </div>
        <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={hideSystem}
            onChange={(e) => setHideSystem(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Hide system processes
        </label>
      </div>

      {/* stati: loading iniziale / errore / vuoto / lista */}
      {loading && ports === null ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning ports…
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={load}
            className="rounded-md border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800/80"
          >
            Retry
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center text-sm text-zinc-500">
          {ports && ports.length === 0 ? (
            "No listening TCP ports found."
          ) : query.trim() ? (
            "No ports match your search."
          ) : (
            <>
              No user ports listening.
              {hideSystem && hiddenSystemCount > 0 && (
                <>
                  {" "}
                  <button
                    onClick={() => setHideSystem(false)}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Show {hiddenSystemCount} system process
                    {hiddenSystemCount === 1 ? "" : "es"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* header colonne */}
          <div className="flex items-center gap-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-600">
            <span className="w-16">Port</span>
            <span className="w-20">PID</span>
            <span className="flex-1">Process</span>
            <span className="w-16" />
          </div>
          {visible.map((p) => (
            <div
              key={`${p.port}-${p.pid}-${p.ipv6 ? "6" : "4"}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-700/60 bg-zinc-800/40 px-3 py-2"
            >
              <span className="w-16 font-mono text-sm font-semibold text-zinc-100">
                {p.port}
              </span>
              <span className="w-20 font-mono text-sm tabular-nums text-zinc-400">
                {p.pid}
              </span>
              {/* nome leggibile (grande) + nome file (piccolo) + badge famiglia;
                  path completo come riga secondaria. Se manca la descrizione, il
                  nome file diventa la riga principale. */}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm text-zinc-200">
                    {p.display_name || p.process_name}
                  </span>
                  {p.display_name && (
                    <span className="shrink-0 truncate font-mono text-xs text-zinc-500">
                      {p.process_name}
                    </span>
                  )}
                  <span className="shrink-0 rounded border border-zinc-700 px-1 py-px font-mono text-[10px] uppercase text-zinc-500">
                    {p.ipv6 ? "IPv6" : "IPv4"}
                  </span>
                </span>
                {p.path && (
                  <span
                    className="truncate text-xs text-zinc-500"
                    title={p.path}
                  >
                    {p.path}
                  </span>
                )}
              </span>
              <button
                onClick={() => setConfirm(p)}
                disabled={killingPid === p.pid}
                className="inline-flex w-16 shrink-0 items-center justify-center gap-1 rounded-md border border-accent/40 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-60"
              >
                {killingPid === p.pid ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <X className="h-3.5 w-3.5" /> Kill
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* conferma kill: stesso pattern del mergePrompt, bottone distruttivo rosso */}
      {confirm && (
        <div
          onClick={() => setConfirm(null)}
          className="anim-fade-in fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="anim-scale-in w-full max-w-xs rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
          >
            <p className="text-sm text-zinc-200">
              Kill <span className="font-medium">{confirm.process_name}</span> (PID{" "}
              {confirm.pid}) on port {confirm.port}?
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              The process will be terminated immediately.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => doKill(confirm)}
                className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400"
              >
                Kill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
