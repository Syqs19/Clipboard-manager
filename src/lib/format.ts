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
