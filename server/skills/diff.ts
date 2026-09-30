/**
 * Een eenvoudige regeldiff tussen twee versies van een skill. Het resultaat
 * noemt alleen de regels die verdwenen ("- ") of bijgekomen ("+ ") zijn,
 * in volgorde van boven naar onder. De diff wordt berekend op het moment
 * van voorstellen en bewaard bij het voorstel, zodat het voorstel later
 * precies zo getoond wordt als de agent hem voorstelde — ook als de actieve
 * versie inmiddels weer is veranderd.
 */

interface DiffOp {
  type: "gelijk" | "weg" | "erbij";
  line: string;
}

function verdeel(oudeRegels: string[], nieuweRegels: string[]): DiffOp[] {
  const n = oudeRegels.length;
  const m = nieuweRegels.length;

  // LCS-tabel: lengte[i][j] is de lengte van de langste gemeenschappelijke
  // reeks van oudeRegels[i..] en nieuweRegels[j..]. Skills zijn tekstbestanden
  // van bescheiden grootte, dus de kwadratische tabel is prima.
  const lengte: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengte[i][j] =
        oudeRegels[i] === nieuweRegels[j]
          ? (lengte[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lengte[i + 1]?.[j] ?? 0, lengte[i]?.[j + 1] ?? 0);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oudeRegels[i] === nieuweRegels[j]) {
      ops.push({ type: "gelijk", line: oudeRegels[i] ?? "" });
      i++;
      j++;
    } else if ((lengte[i + 1]?.[j] ?? 0) >= (lengte[i]?.[j + 1] ?? 0)) {
      ops.push({ type: "weg", line: oudeRegels[i] ?? "" });
      i++;
    } else {
      ops.push({ type: "erbij", line: nieuweRegels[j] ?? "" });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "weg", line: oudeRegels[i] ?? "" });
    i++;
  }
  while (j < m) {
    ops.push({ type: "erbij", line: nieuweRegels[j] ?? "" });
    j++;
  }
  return ops;
}

/**
 * Het verschil tussen twee teksten, als regels met "- " (verwijderd) en
 * "+ " (toegevoegd). Onveranderde regels komen er niet in; identieke teksten
 * geven een lege string.
 */
export function lineDiff(oudeTekst: string, nieuweTekst: string): string {
  const ops = verdeel(oudeTekst.split("\n"), nieuweTekst.split("\n"));
  return ops
    .filter((op) => op.type !== "gelijk")
    .map((op) => `${op.type === "weg" ? "-" : "+"} ${op.line}`)
    .join("\n");
}
