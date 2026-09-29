/**
 * Het werkdocument is markdown. De editor biedt koppen, opsommingen en een
 * tabel aan als invoegblokken, zodat de gebruiker die niet uit hoeft te typen.
 */

export type DocumentBlockKind =
  | "kop1"
  | "kop2"
  | "kop3"
  | "opsomming"
  | "genummerd"
  | "tabel";

export interface DocumentBlockInsertion {
  markdown: string;
  /** Positie van de caret na het invoegen. */
  caret: number;
}

const HEADING_PREFIX: Record<string, string> = {
  kop1: "# ",
  kop2: "## ",
  kop3: "### ",
};

const TABLE_BLOCK = "| Kop 1 | Kop 2 |\n| --- | --- |\n|  |  |\n|  |  |";

/** Voegt een kop, opsomming of tabel in op de plek van de selectie. */
export function insertDocumentBlock(
  markdown: string,
  start: number,
  end: number,
  kind: DocumentBlockKind,
): DocumentBlockInsertion {
  const from = clamp(start, markdown.length);
  const to = clamp(Math.max(end, from), markdown.length);

  if (kind === "tabel") {
    return insertTable(markdown, from, to);
  }
  if (kind === "opsomming" || kind === "genummerd") {
    return insertList(markdown, from, to, kind);
  }
  if (kind in HEADING_PREFIX) {
    return insertHeading(markdown, from, HEADING_PREFIX[kind]);
  }

  return { markdown, caret: from };
}

function insertHeading(
  markdown: string,
  caret: number,
  prefix: string,
): DocumentBlockInsertion {
  const lineStart = startOfLine(markdown, caret);
  const lineEnd = endOfLine(markdown, caret);
  const line = markdown.slice(lineStart, lineEnd);

  return {
    markdown: `${markdown.slice(0, lineStart)}${prefix}${line}${markdown.slice(lineEnd)}`,
    caret: lineStart + prefix.length + line.length,
  };
}

function insertList(
  markdown: string,
  from: number,
  to: number,
  kind: "opsomming" | "genummerd",
): DocumentBlockInsertion {
  const lineStart = startOfLine(markdown, from);
  const lineEnd = endOfLine(markdown, to);
  const lines = markdown.slice(lineStart, lineEnd).split("\n");

  let number = 0;
  let caretOffset = 0;
  const numbered = lines.map((line, index) => {
    if (line.trim() === "") {
      return line;
    }
    number += 1;
    const prefix = kind === "opsomming" ? "- " : `${number}. `;
    const numberedLine = `${prefix}${line}`;
    caretOffset += (index > 0 ? 1 : 0) + numberedLine.length;
    return numberedLine;
  });

  return {
    markdown: `${markdown.slice(0, lineStart)}${numbered.join("\n")}${markdown.slice(lineEnd)}`,
    caret: lineStart + caretOffset,
  };
}

function insertTable(
  markdown: string,
  from: number,
  to: number,
): DocumentBlockInsertion {
  const before = markdown.slice(0, from).replace(/[ \t]+$/, "");
  const after = markdown.slice(to);
  const blankBefore =
    before === "" ? 0 : Math.max(0, 2 - countTrailingNewlines(before));
  const blankAfter =
    after === "" ? 0 : Math.max(0, 2 - countLeadingNewlines(after));

  const insertion = `${"\n".repeat(blankBefore)}${TABLE_BLOCK}${after === "" ? "\n" : "\n".repeat(blankAfter)}`;
  const caret = from + blankBefore + TABLE_BLOCK.indexOf("|  |  |") + 2;

  return {
    markdown: `${before}${insertion}${after}`,
    caret,
  };
}

function startOfLine(markdown: string, index: number): number {
  return markdown.lastIndexOf("\n", index - 1) + 1;
}

function endOfLine(markdown: string, index: number): number {
  const lineBreak = markdown.indexOf("\n", index);
  return lineBreak === -1 ? markdown.length : lineBreak;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function countLeadingNewlines(markdown: string): number {
  return markdown.match(/^\n*/)?.[0].length ?? 0;
}

function countTrailingNewlines(markdown: string): number {
  return markdown.match(/\n*$/)?.[0].length ?? 0;
}
