import { describe, it, expect } from "vitest";
import {
  baseName,
  parseFilePaths,
  fileLabel,
  isTextLike,
  effectiveType,
} from "./format";
import { makeClip } from "../test/fixtures";
import type { ClipItem } from "./api";

describe("baseName", () => {
  it("estrae l'ultimo segmento sia con \\ che con /", () => {
    expect(baseName(String.raw`C:\Users\me\foto.png`)).toBe("foto.png");
    expect(baseName("/home/me/doc.txt")).toBe("doc.txt");
  });
  it("ritorna il path stesso se non ha separatori", () => {
    expect(baseName("solo-nome.txt")).toBe("solo-nome.txt");
  });
});

describe("parseFilePaths", () => {
  it("decodifica un JSON array di percorsi", () => {
    expect(parseFilePaths('["a.txt","b.txt"]')).toEqual(["a.txt", "b.txt"]);
  });
  it("ritorna [] per contenuto nullo o malformato", () => {
    expect(parseFilePaths(null)).toEqual([]);
    expect(parseFilePaths("non-json")).toEqual([]);
    // JSON valido ma non-array → []
    expect(parseFilePaths('"x"')).toEqual([]);
    expect(parseFilePaths("{}")).toEqual([]);
  });
});

describe("fileLabel", () => {
  it("mostra il basename del primo file", () => {
    // path Windows: nel JSON i backslash sono raddoppiati
    expect(fileLabel('["C:\\\\dir\\\\report.pdf"]')).toBe("report.pdf");
  });
  it("aggiunge +N quando ci sono più file", () => {
    expect(fileLabel('["a.txt","b.txt","c.txt"]')).toBe("a.txt +2");
  });
  it("usa il fallback quando non c'è alcun percorso", () => {
    expect(fileLabel(null)).toBe(""); // default
    expect(fileLabel(null, "file")).toBe("file");
    expect(fileLabel("malformato", "file")).toBe("file");
  });
});

describe("isTextLike", () => {
  it("è vero solo per text e url", () => {
    expect(isTextLike("text")).toBe(true);
    expect(isTextLike("url")).toBe(true);
    expect(isTextLike("image")).toBe(false);
    expect(isTextLike("files")).toBe(false);
    expect(isTextLike("group")).toBe(false);
  });
});

describe("effectiveType", () => {
  it("per una clip singola è il suo content_type", () => {
    expect(effectiveType(makeClip({ content_type: "image" }))).toBe("image");
    expect(effectiveType(makeClip({ content_type: "url" }))).toBe("url");
  });
  it("per un gruppo è il tipo del primo elemento", () => {
    const items: ClipItem[] = [
      {
        id: 1,
        position: 0,
        item_type: "image",
        content: null,
        image_path: "x.png",
        thumb_path: null,
        label: null,
        char_count: 0,
      },
    ];
    const group = makeClip({ content_type: "group", items });
    expect(effectiveType(group)).toBe("image");
  });
  it("per un gruppo senza elementi ricade su text", () => {
    const group = makeClip({ content_type: "group", items: [] });
    expect(effectiveType(group)).toBe("text");
  });
});
