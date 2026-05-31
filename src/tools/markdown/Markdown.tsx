import { useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useCopy } from "../../hooks/useCopy";
import { ToolButton } from "../shared/ToolButton";
import { INPUT_TEXTAREA_CLASS } from "../shared/panels";

/// Markdown preview: scrivi markdown a sinistra, vedi il render a destra.
/// marked produce HTML "vero" → lo SANITIZZIAMO con DOMPurify prima di mostrarlo
/// (rimuove <script>, on*-handler, ecc.), così l'innerHTML è sicuro. Copia
/// l'HTML generato e tiene lo scroll dei due pannelli sincronizzato.
export function Markdown() {
  const copy = useCopy();
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

  function copyHtml() {
    if (!html) return;
    copy(html, "HTML copied");
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">Markdown editor with live preview.</span>
        <ToolButton icon={Copy} onClick={copyHtml} disabled={!html}>
          Copy HTML
        </ToolButton>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          ref={editorRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onScroll={(e) => syncScroll(e.currentTarget, previewRef.current)}
          placeholder={"# Title\n\nSome **bold** text and a [link](https://…).\n\n- item one\n- item two"}
          spellCheck={false}
          className={INPUT_TEXTAREA_CLASS}
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
