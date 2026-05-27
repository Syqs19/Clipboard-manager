import { Search } from "lucide-react";

export function SearchBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Cerca nelle clip…"
        className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/60 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-zinc-600"
      />
    </div>
  );
}
