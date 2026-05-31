import { describe, it, expect } from "vitest";
import { matchesQuery } from "./ToolsSection";
import { toolsRegistry } from "../tools/registry";

/// Filtra il registry reale con la stessa logica della UI.
function search(query: string): string[] {
  return toolsRegistry.filter((t) => matchesQuery(t, query)).map((t) => t.id);
}

describe("matchesQuery (ricerca tool)", () => {
  it("query vuota → matcha tutto", () => {
    expect(toolsRegistry.every((t) => matchesQuery(t, ""))).toBe(true);
    expect(toolsRegistry.every((t) => matchesQuery(t, "   "))).toBe(true);
  });

  it("trova per nome", () => {
    expect(search("port killer")).toContain("port-killer");
  });

  it("cerca anche nelle keyword, non solo nel nome/descrizione", () => {
    // "png" non è nel nome di Vectorial ma è una sua keyword (input raster)
    const r = search("png");
    expect(r).toContain("image-converter");
    expect(r).toContain("vectorial");
  });

  it("è case-insensitive", () => {
    expect(search("JSON")).toContain("json-formatter");
    expect(search("json")).toContain("json-formatter");
  });

  it("più termini restringono (AND)", () => {
    const broad = search("convert");
    const narrow = search("convert yaml");
    expect(narrow.length).toBeLessThan(broad.length);
    expect(narrow).toContain("yaml-json");
  });

  it("nessun risultato per un termine senza corrispondenze", () => {
    expect(search("zzznotarealtool")).toEqual([]);
  });
});
