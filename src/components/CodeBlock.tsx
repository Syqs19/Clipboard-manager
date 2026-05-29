import { useMemo } from "react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";

/// Evidenziazione sintattica per i clip di codice. Usa il bundle "common" di
/// highlight.js (i linguaggi più diffusi) e l'auto-detect: snippet brevi non
/// hanno un linguaggio dichiarato, quindi lasciamo decidere alla libreria.
/// Il contenuto resta selezionabile/copiabile come testo normale.
export function CodeBlock({ code }: { code: string }) {
  const html = useMemo(() => hljs.highlightAuto(code).value, [code]);
  return (
    <pre className="anim-fade-in line-clamp-3 overflow-hidden whitespace-pre-wrap break-words text-sm">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
