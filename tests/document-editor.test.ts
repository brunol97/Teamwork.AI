import { describe, expect, it } from "vitest";

import {
  insertDocumentBlock,
  type DocumentBlockKind,
} from "../app/lib/document-editor.js";

describe("insertDocumentBlock", () => {
  it("turns the current line into a heading", () => {
    const result = insertDocumentBlock("Eisen\n", 0, 0, "kop2");
    expect(result.markdown).toBe("## Eisen\n");
    expect(result.caret).toBe(8);
  });

  it("prefixes every selected line with a bullet", () => {
    const result = insertDocumentBlock("Snelheid\nKosten\n", 0, 16, "opsomming");
    expect(result.markdown).toBe("- Snelheid\n- Kosten\n");
    expect(result.caret).toBe(19);
  });

  it("numbers every selected line", () => {
    const result = insertDocumentBlock("Snelheid\nKosten\n", 0, 16, "genummerd");
    expect(result.markdown).toBe("1. Snelheid\n2. Kosten\n");
    expect(result.caret).toBe(21);
  });

  it("inserts a table skeleton and puts the caret in the first cell", () => {
    const result = insertDocumentBlock("Eisen\n", 0, 0, "tabel");
    expect(result.markdown).toBe(
      "| Kop 1 | Kop 2 |\n| --- | --- |\n|  |  |\n|  |  |\n\nEisen\n",
    );
    expect(result.caret).toBe(34);
  });

  it("keeps the text after the caret when a table is inserted", () => {
    const result = insertDocumentBlock("Eisen\n", 6, 6, "tabel");
    expect(result.markdown).toBe(
      "Eisen\n\n| Kop 1 | Kop 2 |\n| --- | --- |\n|  |  |\n|  |  |\n",
    );
    expect(result.caret).toBe(41);
  });

  it("does nothing for an unknown block", () => {
    const result = insertDocumentBlock(
      "Eisen\n",
      0,
      0,
      "onbekend" as DocumentBlockKind,
    );
    expect(result.markdown).toBe("Eisen\n");
    expect(result.caret).toBe(0);
  });
});
