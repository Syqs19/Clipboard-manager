import { md5 } from "js-md5";

/// Algoritmi di hash supportati dai tool. Fonte unica: prima Generators e
/// HashCompare avevano due liste separate (e già divergenti — a HashCompare
/// mancava SHA-384). L'union derivata fa sì che usare un algoritmo fuori lista
/// sia un errore di compilazione, non un fallimento a runtime.
export const HASH_ALGOS = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
export type HashAlgo = (typeof HASH_ALGOS)[number];

/// Hash esadecimale di byte. SHA-* via Web Crypto; MD5 via js-md5.
/// L'union `ArrayBuffer | Uint8Array` è assegnabile sia a `BufferSource`
/// (crypto.subtle.digest) sia al tipo `Message` di js-md5 → niente cast.
export async function hashBytes(
  data: ArrayBuffer | Uint8Array,
  algo: HashAlgo,
): Promise<string> {
  if (algo === "MD5") return md5(data);
  const buf = await crypto.subtle.digest(algo, data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/// Hash esadecimale di una stringa (UTF-8).
export async function hashText(text: string, algo: HashAlgo): Promise<string> {
  return hashBytes(new TextEncoder().encode(text), algo);
}
