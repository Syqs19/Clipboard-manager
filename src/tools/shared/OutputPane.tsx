import type { ReactNode } from "react";

/// Pannello di output dei convertitori: box scrollabile con il testo in `<pre>`,
/// placeholder quando è vuoto, slot opzionale per il ramo errore. Fonte unica del
/// markup che era quasi byte-identico in YamlJson/EnvJson/HtmlEntities (incluso il
/// testo letterale "Output appears here.").
export function OutputPane({
  output,
  error,
  placeholder = "Output appears here.",
}: {
  output: string;
  /// se presente, mostra il messaggio d'errore al posto dell'output.
  error?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="min-h-0 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3">
      {error != null ? (
        <span className="text-sm text-red-400">{error}</span>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-200">
          {output || <span className="text-zinc-600">{placeholder}</span>}
        </pre>
      )}
    </div>
  );
}
