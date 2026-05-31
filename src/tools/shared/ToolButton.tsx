import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

/// Bottone della toolbar dei tool (Swap / Copy / Clear / Format / Generate).
/// Fonte unica: prima la stessa lunga stringa di classi era copiata ~15 volte,
/// con padding già divergente tra icon-only (`p-2`) e con-label (`px-2.5 py-1`).
/// Qui il padding e la dimensione icona sono decisi dalla presenza di `children`,
/// così la divergenza sparisce per costruzione.
///
/// - `variant`: "neutral" (default, bordo/zinc) o "accent" (azione primaria).
/// - `icon`: icona Lucide opzionale, dimensionata in automatico.
export function ToolButton({
  variant = "neutral",
  icon: Icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "neutral" | "accent";
  icon?: LucideIcon;
}) {
  const hasLabel = children != null && children !== false;
  const base =
    "inline-flex items-center gap-1.5 rounded-md border text-sm transition-colors disabled:opacity-50";
  const variantClass =
    variant === "accent"
      ? "border-accent/40 font-medium text-accent hover:bg-accent/10"
      : "border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800/80";
  const sizeClass = hasLabel ? "px-2.5 py-1" : "p-2";
  const iconSize = hasLabel ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <button
      className={`${base} ${variantClass} ${sizeClass} ${className}`}
      {...rest}
    >
      {Icon && <Icon className={iconSize} />}
      {children}
    </button>
  );
}
