/// Interruttore a pillola (checkbox + label) condiviso dai tool. Fonte unica del
/// markup che prima era ridefinito due volte come componente locale (JsonFormatter,
/// TextDiff) e ricostruito inline in altri tool. I tool con stato `disabled` o
/// classi label diverse restano inline: forzarli qui richiederebbe prop di
/// override (configurabilità non richiesta).
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-zinc-400">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}
