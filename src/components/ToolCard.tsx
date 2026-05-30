import { Star } from "lucide-react";
import type { ToolDescriptor } from "../tools/types";

/// Tile della griglia Tools: icona (badge con l'accent della sezione, come gli
/// header di sezione) + nome + descrizione breve + stella preferiti. Cliccandola
/// apre il tool a tutto schermo; la stella (in alto a destra) lo marca preferito.
/// È un div role=button (non <button>) per poter annidare il bottone-stella.
export function ToolCard({
  tool,
  favorite,
  onOpen,
  onToggleFavorite,
}: {
  tool: ToolDescriptor;
  favorite: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const Icon = tool.icon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="tool-card group relative flex cursor-pointer flex-col items-start gap-2 overflow-hidden rounded-xl border border-zinc-700/60 p-4 text-left"
    >
      {/* bagliore accent dietro l'angolo dell'icona: tenue a riposo, più vivo
          al hover (vedi .tool-card in index.css). Decorativo, non cliccabile. */}
      <span className="tool-card-glow pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full" />
      {/* stella preferiti: ferma la propagazione per non aprire il tool */}
      <button
        type="button"
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className={`absolute right-2 top-2 rounded-md p-1 transition-colors ${
          favorite
            ? "text-amber-400 hover:text-amber-300"
            : "text-zinc-600 hover:text-zinc-300"
        }`}
      >
        <Star className="h-4 w-4" fill={favorite ? "currentColor" : "none"} />
      </button>
      <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-accent/40 bg-accent/10 text-accent shadow-[0_0_18px_-4px_rgb(var(--accent)/0.45)]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="relative text-sm font-medium text-zinc-100">
        {tool.label}
      </span>
      <span className="relative text-xs leading-snug text-zinc-500">
        {tool.description}
      </span>
    </div>
  );
}
