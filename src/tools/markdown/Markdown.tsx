import { useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useNotify } from "../../components/Toaster";

/// Markdown preview: scrivi markdown a sinistra, vedi il render a destra.
/// marked produce HTML "vero" → lo SANITIZZIAMO con DOMPurify prima di mostrarlo
/// (rimuove <script>, on*-handler, ecc.), così l'innerHTML è sicuro. Copia
/// l'HTML generato e tiene lo scroll dei due pannelli sincronizzato.
export function Markdown() {
  const notify = useNotify();
  const [input, setInput] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // evita il loop di scroll-eco quando uno scroll programmato ne innesca un altro
  const syncing = useRef(false);

  const html = useMemo(() => {
    if (!input) return "";
    const raw = marked.parse(input, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [input]);

  /// Sincronizza lo scroll dell'altro pannello in proporzione (i due hanno
  /// altezze diverse, quindi usiamo la percentuale di scroll).
  function syncScroll(from: HTMLElement, to: HTMLElement | null) {
    if (!to || syncing.current) return;
    syncing.current = true;
    const ratio = from.scrollTop / (from.scrollHeight - from.clientHeight || 1);
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
    requestAnimationFrame(() => (syncing.current = false));
  }

  async function copyHtml() {
    if (!html) return;
    await navigator.clipboard.writeText(html);
    notify("HTML copied", "success");
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">Markdown editor with live preview.</span>
        <button
          onClick={copyHtml}
          disabled={!html}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" /> Copy HTML
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          ref={editorRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onScroll={(e) => syncScroll(e.currentTarget, previewRef.current)}
          placeholder={"# Title\n\nSome **bold** text and a [link](https://…).\n\n- item one\n- item two"}
          spellCheck={false}
          className="min-h-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
        />
        <div
          ref={previewRef}
          onScroll={(e) => syncScroll(e.currentTarget, editorRef.current)}
          className="min-h-0 overflow-auto rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-4"
        >
          {html ? (
            // sicuro: l'HTML è già passato per DOMPurify.sanitize sopra.
            <div className="md-preview text-sm text-zinc-200" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="text-sm text-zinc-600">Rendered markdown appears here.</span>
          )}
        </div>
      </div>
    </div>
  );
}
