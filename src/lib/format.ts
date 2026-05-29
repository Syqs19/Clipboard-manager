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
