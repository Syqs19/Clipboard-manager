import { describe, it, expect } from "vitest";
import { parseEnv, toEnv } from "./env";

describe("parseEnv", () => {
  it("parsa KEY=value, ignora commenti e righe vuote", () => {
    expect(parseEnv("# commento\nA=1\n\nB=two")).toEqual({ A: "1", B: "two" });
  });
  it("toglie le virgolette circondanti (doppie e singole)", () => {
    expect(parseEnv('A="hello world"\nB=\'x\'')).toEqual({ A: "hello world", B: "x" });
  });
  it("rimuove il prefisso export", () => {
    expect(parseEnv("export A=1")).toEqual({ A: "1" });
  });
});

describe("toEnv", () => {
  it("quota i valori con spazi/speciali, lascia nudi gli altri", () => {
    expect(toEnv({ A: "1", B: "two words" })).toBe('A=1\nB="two words"');
  });
});

describe("round-trip JSON↔.env", () => {
  // ogni oggetto deve sopravvivere a toEnv → parseEnv invariato.
  const cases: Record<string, string>[] = [
    { A: "1", B: "simple" },
    { KEY: "with spaces" },
    { PEM: "line1\nline2\nline3" }, // multilinea: era il caso che si corrompeva
    { CRLF: "a\r\nb" },
    { Q: 'has "quotes" inside' },
    { HASH: "value # with hash" },
  ];
  for (const obj of cases) {
    it(`preserva ${JSON.stringify(obj)}`, () => {
      expect(parseEnv(toEnv(obj))).toEqual(obj);
    });
  }
});
