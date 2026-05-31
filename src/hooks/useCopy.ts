import { useCallback } from "react";
import { useNotify } from "../components/Toaster";

/// Copia testo negli appunti mostrando un toast di esito. Fonte unica per la
/// copia dei tool: prima ogni tool ripeteva `navigator.clipboard.writeText`
/// senza gestire il caso di errore (la Clipboard API può rigettare). Qui il
/// try/catch è centralizzato e l'errore diventa un toast, come fa già App.tsx.
///
/// La guardia sul testo (es. `if (!out) return`) resta al call site: i tool
/// hanno condizioni diverse e alcuni copiano sempre.
export function useCopy() {
  const notify = useNotify();
  return useCallback(
    async (text: string, successMsg = "Copied") => {
      try {
        await navigator.clipboard.writeText(text);
        notify(successMsg, "success");
      } catch (e) {
        notify(`Couldn't copy: ${e}`, "error");
      }
    },
    [notify],
  );
}
