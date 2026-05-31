/// Classi del bottone-tab di un "segmented control" (selettore di modalità/
/// direzione) in stato attivo/inattivo. Fonte unica del solo colore: prima la
/// stessa stringa condizionale era ripetuta in 7 tool. Il call site concatena
/// liberamente padding, `flex-1`, `capitalize`/`uppercase`, `disabled:opacity-50`.
export const tabBtnClass = (active: boolean): string =>
  `transition-colors ${
    active
      ? "bg-accent/15 text-accent"
      : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200"
  }`;
