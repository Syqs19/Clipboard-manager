/// Classe della textarea di input dei convertitori. Fonte unica: era byte-identica
/// in YamlJson/EnvJson/HtmlEntities (e altri). Esportata come costante così i tool
/// che divergono nella struttura attorno (contatori, classi condizionali) possono
/// comunque riusare la stessa textarea senza ereditare un wrapper.
export const INPUT_TEXTAREA_CLASS =
  "min-h-0 resize-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 p-3 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none";
