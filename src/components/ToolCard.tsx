import type { ToolDescriptor } from "../tools/types";

/// Tile della griglia Tools: icona (badge con l'accent della sezione, come gli
/// header di sezione) + nome + descrizione breve. Cliccandola apre il tool a
/// tutto schermo.
export function ToolCard({
  tool,
  onOpen,
}: {
  tool: ToolDescriptor;
  onOpen: () => void;
}) {
  const Icon = tool.icon;
  return (
    <button
      onClick={onOpen}
      className="tool-card group relative flex flex-col items-start gap-2 overflow-hidden rounded-xl border border-zinc-700/60 p-4 text-left"
    >
      {/* bagliore accent dietro l'angolo dell'icona: tenue a riposo, più vivo
          al hover (vedi .tool-card in index.css). Decorativo, non cliccabile. */}
      <span className="tool-card-glow pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full" />
      <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent shadow-[0_0_18px_-4px_rgb(var(--accent)/0.45)]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="relative text-sm font-medium text-zinc-100">
        {tool.label}
      </span>
      <span className="relative text-xs leading-snug text-zinc-500">
        {tool.description}
      </span>
    </button>
  );
}
