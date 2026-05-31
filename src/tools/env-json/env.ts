/// Conversione pura .env ↔ oggetto, estratta dal componente per essere testabile
/// (round-trip). Niente React qui.

/// Parsa un file .env (KEY=value, # commenti, virgolette opzionali) in oggetto.
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim().replace(/^export\s+/, "");
    let val = t.slice(eq + 1).trim();
    // togli virgolette circondanti. Le sequenze di escape (\n \r \") si espandono
    // solo dentro i doppi apici (semantica .env standard), non nei singoli.
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"');
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/// Serializza un oggetto piatto in righe .env (quota i valori con spazi/speciali).
/// I newline nel valore vengono escapati in sequenze (\n \r) così l'output resta
/// su una riga e il round-trip JSON↔.env non perde i valori multilinea.
export function toEnv(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => {
      let val = v == null ? "" : String(v);
      if (/[\s#"']/.test(val)) {
        val = `"${val.replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
      }
      return `${k}=${val}`;
    })
    .join("\n");
}
