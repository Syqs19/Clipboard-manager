import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toolsRegistry } from "../tools/registry";
import { ToolCard } from "./ToolCard";

/// Contenitore della macro-sezione Tools: griglia di card (dashboard) che
/// aprono un tool a tutto schermo. Lo stato "quale tool è aperto" vive QUI,
/// così App.tsx non sa nulla dei singoli tool. Legge solo da `toolsRegistry`.
export function ToolsSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  const openTool = openId
    ? toolsRegistry.find((t) => t.id === openId) ?? null
    : null;

  if (openTool) {
    const Tool = openTool.component;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-2">
          <button
            onClick={() => setOpenId(null)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-sm text-zinc-300 transition-colors hover:bg-zinc-800/80 hover:text-zinc-100"
          >
            <ChevronLeft className="h-4 w-4" /> Tools
          </button>
          <span className="text-sm font-medium text-zinc-200">
            {openTool.label}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Tool />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {toolsRegistry.length === 0 ? (
        <p className="text-sm text-zinc-500">No tools yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {toolsRegistry.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onOpen={() => setOpenId(tool.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
