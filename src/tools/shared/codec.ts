/// Decodifica una stringa Base64URL (o Base64 standard) in testo UTF-8.
/// Fonte unica: prima la stessa pipeline (normalizza alfabeto + padding → atob →
/// bytes → TextDecoder) era ricopiata in Base64Url e in JWT. Il `.trim()` è
/// idempotente su input base64 valido, quindi è sicuro come default per entrambi.
export function base64UrlToText(input: string): string {
  let s = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
