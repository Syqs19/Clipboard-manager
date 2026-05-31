import { type Clip, type ContentType } from "./api";

/// Maschera un valore sensibile lasciando abbastanza contesto per riconoscerlo.
/// Il contenuto completo resta nel DB ed è copiabile/rivelabile.
/// - Email: inizio del nome + dominio visibile  → ma••••••@example.it
/// - Token/IBAN/carte: prefisso + ultimi 4       → ghp_••••••5pQr
export function maskSensitive(text: string): string {
  const t = text.trim();

  // Email: mantieni le prime lettere e il dominio (così capisci di chi è).
  const at = t.indexOf("@");
  if (at > 0 && t.indexOf(".", at) > at) {
    const local = t.slice(0, at);
    const domain = t.slice(at); // include '@'
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${"•".repeat(Math.max(local.length - head.length, 1))}${domain}`;
  }

  // Generico (token, IBAN, carta): prefisso + bullet + ultimi 4.
  if (t.length <= 6) return "•".repeat(t.length);
  const head = t.slice(0, 4);
  const tail = t.slice(-4);
  const dots = "•".repeat(Math.min(Math.max(t.length - 8, 1), 12));
  return `${head}${dots}${tail}`;
}

/// Palette di colori preset per i tag (picker).
export const TAG_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#a1a1aa",
];

/// Colore di un tag (hex): usa l'override salvato, altrimenti uno deterministico
/// dal nome (preso dalla palette, così è sempre un hex valido per <input type=color>).
export function tagColor(name: string, override?: string | null): string {
  if (override) return override;
  // il tag "Color" mostra lo swatch del contenuto accanto: tieni il suo dot
  // neutro (bianco) così non si confonde col colore vero del clip.
  if (name === "Color") return "#fafafa";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/// Splitta `text` in segmenti alternati (testo / match) in base alla query.
/// Case-insensitive. Se `query` è vuoto, ritorna un solo segmento non-match.
export function splitMatches(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const out: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const at = lower.indexOf(q, i);
    if (at < 0) {
      out.push({ text: text.slice(i), match: false });
      break;
    }
    if (at > i) out.push({ text: text.slice(i, at), match: false });
    out.push({ text: text.slice(at, at + q.length), match: true });
    i = at + q.length;
  }
  return out;
}

/// Trova i valori-colore CSS in `text` con la loro posizione.
/// Riconosce hex (#rgb/#rgba/#rrggbb/#rrggbbaa), rgb()/rgba(), hsl()/hsla().
/// Ritorna i match ordinati e non sovrapposti; `css` è il valore così com'è,
/// usabile direttamente come `background-color` per lo swatch.
export function detectColors(
  text: string,
): Array<{ start: number; end: number; css: string }> {
  const re =
    /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|(?:rgb|hsl)a?\([^)]*\)/g;
  const out: Array<{ start: number; end: number; css: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, css: m[0] });
  }
  return out;
}

/// Vero per i tipi "testuali" (testo o url), trattati insieme in più punti della UI.
/// Specchio di `ContentType::is_text_like` lato Rust.
export function isTextLike(t: ContentType): boolean {
  return t === "text" || t === "url";
}

/// Tipo "effettivo" di una clip: per i gruppi è il tipo dei loro elementi (così un
/// gruppo di immagini compare in "Images", uno di testi in "Text", ecc.); per le
/// clip singole è il loro stesso `content_type`. Fonte unica del concetto, usata sia
/// dai filtri/conteggi (App) sia dalla regola "fondibili se stesso tipo" (drag&drop).
export function effectiveType(c: Clip): ContentType {
  return c.content_type === "group"
    ? c.items?.[0]?.item_type ?? "text"
    : c.content_type;
}

/// Estrae l'ultimo segmento (basename) di un percorso, indipendente dal separatore
/// (`\` su Windows, `/` altrove). Se il path è vuoto ritorna il path stesso.
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/// Decodifica il `content` di una clip 'files' (JSON array di percorsi).
/// Ritorna sempre un array (vuoto se il contenuto è assente o malformato).
export function parseFilePaths(content: string | null): string[] {
  if (!content) return [];
  try {
    const v = JSON.parse(content);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/// Etichetta di una clip/elemento 'files': basename del primo file, con `+N`
/// se ce n'è più d'uno. `empty` è il fallback quando non c'è nessun percorso.
export function fileLabel(content: string | null, empty = ""): string {
  const paths = parseFilePaths(content);
  if (paths.length === 0) return empty;
  const name = baseName(String(paths[0]));
  return paths.length > 1 ? `${name} +${paths.length - 1}` : name;
}

/// Formatta un numero di byte in B / KB / MB / GB leggibili. Fonte unica: prima
/// la stessa funzione era ridefinita (con nomi diversi) in più tool e in Settings.
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/// Tempo relativo conciso (it).
export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "ora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h fa`;
  const d = Math.floor(h / 24);
  return `${d} g fa`;
}
