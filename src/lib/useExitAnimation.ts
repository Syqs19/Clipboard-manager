import { useEffect, useState } from "react";

type Phase = "closed" | "enter" | "exit";

/// Ritarda l'unmount di un componente per il tempo della keyframe di uscita.
///
/// Internamente usa una macchina a stati `closed | enter | exit` per evitare
/// che la transizione open->enter -> exit -> closed possa "rimbalzare" su
/// effetti che osservano lo stato a metà ciclo.
///
/// Uso:
/// ```tsx
/// const { mounted, exiting, requestClose } = useExitAnimation(open, 200, onClose);
/// if (!mounted) return null;
/// return <div className={exiting ? "anim-fade-out" : "anim-fade-in"} onClick={requestClose} />;
/// ```
export function useExitAnimation(
  open: boolean,
  durationMs: number,
  onClose?: () => void,
): { mounted: boolean; exiting: boolean; requestClose: () => void } {
  const [phase, setPhase] = useState<Phase>(open ? "enter" : "closed");

  // Quando `open` cambia dall'esterno: enter / inizia exit con cleanup.
  // Dipendiamo SOLO da `open`: cambi di fase interni non devono ritriggerare.
  useEffect(() => {
    if (open) {
      setPhase("enter");
      return;
    }
    let timer: number | undefined;
    setPhase((p) => {
      if (p === "closed" || p === "exit") return p;
      timer = window.setTimeout(() => setPhase("closed"), durationMs);
      return "exit";
    });
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [open, durationMs]);

  const requestClose = () => {
    setPhase((p) => {
      if (p !== "enter") return p;
      window.setTimeout(() => {
        setPhase("closed");
        onClose?.();
      }, durationMs);
      return "exit";
    });
  };

  return {
    mounted: phase !== "closed",
    exiting: phase === "exit",
    requestClose,
  };
}
