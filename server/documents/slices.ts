/**
 * Tracer-slices zijn een onderdeel van het werkdocument: een dunne, verticale
 * implementatie-opdracht, inclusief testaanpak. Ze zijn geen aparte
 * datamodel-entiteit (zie de MVP-specificatie); ze zijn een sectie in het
 * werkdocument met een vast sjabloon. Deze module bevat de zuivere regels voor
 * het sjabloon: lezen, schrijven, herordenen, samenvoegen, splitsen en
 * exporteren. Zowel de agent (server) als de interface gebruikt ze.
 */

/** De kop van de sectie waarin de slices staan. */
export const SLICE_SECTION_TITLE = "Tracer-slices";

/** Een tracer-slice met alle velden van het vaste sjabloon. */
export interface TracerSlice {
  /** Positie in de sectie, beginnend bij 1. */
  order: number;
  /** Stabiele identificatie binnen één gelezen lijst: positie in het document. */
  id: string;
  titel: string;
  doel: string;
  gedrag: string;
  acceptatiecriteria: string[];
  requirementRefs: string[];
  buitenDezeSlice: string;
  afhankelijkheden: string[];
  testaanpak: string;
}

/** Een requirement uit het werkdocument: een kop met de tekst eronder. */
export interface WorkRequirement {
  title: string;
  body: string;
  /** Koptekstniveau: 1 voor `#`, 2 voor `##`. */
  level: number;
}

const SECTION_HEADING_PATTERN = /^##\s+(.+?)\s*$/;
const SLICE_HEADING_PATTERN = /^###\s+Slice\s+\d+\s*:\s*(.+?)\s*$/i;
const FIELD_PATTERN = /^\s*-\s*\*\*(.+?)\s*:?\*\*\s*:?\s*(.*)$/;
const LIST_ITEM_PATTERN = /^\s*-\s+(.*)$/;
const NUMBERED_ITEM_PATTERN = /^\s*\d+\.\s+(.*)$/;

const FIELD_LABELS = new Set([
  "doel",
  "gedrag",
  "acceptatiecriteria",
  "requirements-verwijzingen",
  "buiten deze slice",
  "afhankelijkheden",
  "testaanpak",
]);

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function isSliceSectionHeading(line: string): boolean {
  const match = line.match(SECTION_HEADING_PATTERN);
  return match !== null && normalizeLabel(match[1]) === normalizeLabel(SLICE_SECTION_TITLE);
}

function isHeading(line: string): boolean {
  return /^#{1,6}\s+/.test(line);
}

function headingLevel(line: string): number {
  const match = line.match(/^(#+)\s+/);
  return match ? match[1].length : 0;
}

/** Splitst "A, B" in een lijst; "Geen" wordt een lege lijst. */
function splitList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || /^geen$/i.test(trimmed)) {
    return [];
  }
  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/**
 * Herkent een verzoek om tracer-slices te maken in een bericht van de
 * gebruiker. Geeft true terug wanneer de agent de slice-planner moet starten.
 */
export function parseSliceRequest(message: string): boolean {
  if (/\btracer[-\s]?slices?\b/i.test(message)) {
    return true;
  }
  return (
    /\bslices?\b/i.test(message) &&
    /\b(maak|verdeel|plan|genereer|stel\s+op|maak\s+op)\b/i.test(message)
  );
}

/**
 * Leest de requirements uit het werkdocument: koppen met de tekst eronder.
 * De Tracer-slices-sectie zelf is geen requirement en wordt overgeslagen.
 */
export function extractRequirements(markdown: string): WorkRequirement[] {
  const lines = markdown.split("\n");
  const requirements: WorkRequirement[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!isHeading(line)) {
      index++;
      continue;
    }

    const level = headingLevel(line);
    const title = line.replace(/^#+\s+/, "").trim();

    if (level <= 2 && normalizeLabel(title) === normalizeLabel(SLICE_SECTION_TITLE)) {
      // Sla de hele Tracer-slices-sectie over: die beschrijft het werk, de
      // requirements beschrijven het.
      index++;
      while (index < lines.length && headingLevel(lines[index]) > level) {
        index++;
      }
      continue;
    }

    index++;
    const bodyLines: string[] = [];
    // De tekst loopt tot de volgende kop, op welk niveau dan ook: zo is elke
    // kop een eigen requirement met precies zijn eigen tekst.
    while (index < lines.length && !isHeading(lines[index])) {
      bodyLines.push(lines[index]);
      index++;
    }

    requirements.push({ title, body: bodyLines.join("\n").trim(), level });
  }

  return requirements;
}

/** Een slice zoals hij in de sectie staat, vóór het omzetten naar velden. */
interface RawSlice {
  titel: string;
  fields: Map<string, string>;
  criteria: string[];
  inCriteria: boolean;
}

/** Leest de tracer-slices uit een werkdocument, in de volgorde van het document. */
export function parseSlices(markdown: string): TracerSlice[] {
  const lines = markdown.split("\n");

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isSliceSectionHeading(lines[i])) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) {
    return [];
  }

  const raws: RawSlice[] = [];
  let current: RawSlice | null = null;

  for (let i = sectionStart + 1; i < lines.length; i++) {
    const line = lines[i];

    const sliceMatch = line.match(SLICE_HEADING_PATTERN);
    if (sliceMatch) {
      if (current) raws.push(current);
      current = {
        titel: sliceMatch[1].trim(),
        fields: new Map(),
        criteria: [],
        inCriteria: false,
      };
      continue;
    }

    // Een kop op sectieniveau of hoger eindigt de Tracer-slices-sectie.
    if (isHeading(line) && headingLevel(line) <= 2) {
      break;
    }

    if (!current) {
      continue;
    }

    const fieldMatch = line.match(FIELD_PATTERN);
    if (fieldMatch) {
      const label = normalizeLabel(fieldMatch[1]);
      if (!FIELD_LABELS.has(label)) {
        continue;
      }
      if (label === "acceptatiecriteria") {
        current.inCriteria = true;
        if (fieldMatch[2].trim()) {
          current.criteria.push(fieldMatch[2].trim());
        }
        continue;
      }
      current.inCriteria = false;
      current.fields.set(label, fieldMatch[2]);
      continue;
    }

    const listItemMatch = line.match(LIST_ITEM_PATTERN);
    if (listItemMatch && current.inCriteria) {
      const item = listItemMatch[1].trim();
      if (item) {
        current.criteria.push(item);
      }
      continue;
    }

    // Een tekstregel onder een enkelvoudig veld verlengt dat veld.
    if (line.trim() !== "" && !current.inCriteria && current.fields.size > 0) {
      const labels = [...current.fields.keys()];
      const lastLabel = labels[labels.length - 1];
      current.fields.set(
        lastLabel,
        `${current.fields.get(lastLabel)} ${line.trim()}`.trim(),
      );
    }
  }
  if (current) raws.push(current);

  return raws.map((raw, index) => ({
    order: index + 1,
    id: `slice-${index + 1}`,
    titel: raw.titel,
    doel: (raw.fields.get("doel") ?? "").trim(),
    gedrag: (raw.fields.get("gedrag") ?? "").trim(),
    acceptatiecriteria: raw.criteria,
    requirementRefs: splitList(raw.fields.get("requirements-verwijzingen") ?? ""),
    buitenDezeSlice: (raw.fields.get("buiten deze slice") ?? "").trim(),
    afhankelijkheden: splitList(raw.fields.get("afhankelijkheden") ?? ""),
    testaanpak: (raw.fields.get("testaanpak") ?? "").trim(),
  }));
}

/** Rendert één slice als onderdeel van de Tracer-slices-sectie. */
function renderSlice(slice: TracerSlice, order: number): string {
  return [
    `### Slice ${order}: ${slice.titel}`,
    "",
    `- **Doel:** ${slice.doel}`,
    `- **Gedrag:** ${slice.gedrag}`,
    "- **Acceptatiecriteria:**",
    ...slice.acceptatiecriteria.map((criterium) => `  - ${criterium}`),
    `- **Requirements-verwijzingen:** ${slice.requirementRefs.join(", ")}`,
    `- **Buiten deze slice:** ${slice.buitenDezeSlice}`,
    `- **Afhankelijkheden:** ${slice.afhankelijkheden.length > 0 ? slice.afhankelijkheden.join(", ") : "Geen"}`,
    `- **Testaanpak:** ${slice.testaanpak}`,
  ].join("\n");
}

/** Rendert de hele Tracer-slices-sectie, met hernummerde slices. */
export function renderSlicesSection(slices: TracerSlice[]): string {
  const parts = slices.map((slice, index) => renderSlice(slice, index + 1));
  return `## ${SLICE_SECTION_TITLE}\n\n${parts.join("\n\n")}\n`;
}

/**
 * Plaatst de Tracer-slices-sectie in het werkdocument: een bestaande sectie
 * wordt vervangen, anders komt de sectie onderaan te staan.
 */
export function upsertSlicesSection(markdown: string, slices: TracerSlice[]): string {
  const section = renderSlicesSection(slices);
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!isSliceSectionHeading(lines[i])) {
      continue;
    }
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (isHeading(lines[j]) && headingLevel(lines[j]) <= 2) {
        end = j;
        break;
      }
    }
    const before = lines.slice(0, i).join("\n").trimEnd();
    const after = lines.slice(end).join("\n").trimEnd();
    const parts = [before, section.trimEnd()];
    if (after) {
      parts.push(after);
    }
    return `${parts.join("\n\n")}\n`;
  }

  const existing = markdown.trimEnd();
  return existing === "" ? section : `${existing}\n\n${section}`;
}

/**
 * Keurt een slice: de teruggegeven lijst noemt wat er ontbreekt of misgaat;
 * een lege lijst betekent dat de slice volledig is en alleen naar bestaande
 * requirements verwijst.
 */
export function validateSlice(
  slice: TracerSlice,
  requirementTitles: string[],
): string[] {
  const problems: string[] = [];
  const normalized = requirementTitles.map((title) => normalizeLabel(title));

  if (!slice.titel.trim()) problems.push("titel");
  if (!slice.doel.trim()) problems.push("doel");
  if (!slice.gedrag.trim()) problems.push("gedrag");
  if (slice.acceptatiecriteria.length === 0) problems.push("acceptatiecriteria");
  if (!slice.buitenDezeSlice.trim()) problems.push("buiten deze slice");
  if (!slice.testaanpak.trim()) problems.push("testaanpak");
  if (
    slice.requirementRefs.length === 0 ||
    slice.requirementRefs.some((ref) => !normalized.includes(normalizeLabel(ref)))
  ) {
    problems.push("requirements");
  }

  return problems;
}

/**
 * Leest slices uit het antwoord van de slice-planner-agent en houdt alleen de
 * slices over die volledig zijn en naar bestaande requirements verwijzen.
 */
export function parsePlannedSlices(
  response: string,
  requirementTitles: string[],
): TracerSlice[] {
  return parseSlices(response).filter(
    (slice) => validateSlice(slice, requirementTitles).length === 0,
  );
}

/**
 * De terugvalplanner: maakt per requirement een slice volgens het sjabloon.
 * De agent gebruikt deze wanneer zijn eigen antwoord niet als slices te lezen
 * is, zodat er altijd een bruikbare planning ontstaat uit de eisen die er
 * staan. Level-2-koppen zijn de eisen; alleen zonder level-2-koppen tellen
 * level-1-koppen mee.
 */
export function planSlicesFromRequirements(markdown: string): TracerSlice[] {
  const requirements = extractRequirements(markdown);
  const levelTwo = requirements.filter((requirement) => requirement.level === 2);
  const chosen = levelTwo.length > 0 ? levelTwo : requirements.filter((r) => r.level === 1);

  const slices: TracerSlice[] = [];
  for (const requirement of chosen) {
    const criteria = listItems(requirement.body);
    const bodySentences = sentences(requirement.body);
    const acceptatiecriteria =
      criteria.length > 0
        ? criteria
        : bodySentences.length > 0
          ? bodySentences
          : [`De eis "${requirement.title}" is afgerond.`];
    const previous = slices[slices.length - 1];

    slices.push({
      id: `slice-${slices.length + 1}`,
      order: slices.length + 1,
      titel: requirement.title,
      doel: `Werk de eis "${requirement.title}" uit in een dunne, verticale slice.`,
      gedrag:
        requirement.body.trim() ||
        `Werk de eis "${requirement.title}" uit zoals die in het werkdocument staat.`,
      acceptatiecriteria,
      requirementRefs: [requirement.title],
      buitenDezeSlice: "De overige eisen uit het werkdocument.",
      afhankelijkheden: previous ? [previous.titel] : [],
      testaanpak:
        "Unit-tests met Vitest op de logica en minstens één E2E-test van het gedrag.",
    });
  }

  return slices;
}

/** De opsommingsitems in een requirementtekst. */
function listItems(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(LIST_ITEM_PATTERN) ?? line.match(NUMBERED_ITEM_PATTERN);
    if (match && match[1].trim()) {
      items.push(match[1].trim());
    }
  }
  return items;
}

/** De zinnen in een requirementtekst, voor criteria uit lopende tekst. */
function sentences(body: string): string[] {
  return body
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Zet de slices in de gevraagde volgorde; een onvolledige lijst negeert hij. */
export function reorderSlices(
  slices: TracerSlice[],
  orderedIds: string[],
): TracerSlice[] {
  const byId = new Map(slices.map((slice) => [slice.id, slice]));
  if (
    orderedIds.length !== slices.length ||
    orderedIds.some((id) => !byId.has(id)) ||
    new Set(orderedIds).size !== slices.length
  ) {
    return slices;
  }
  return orderedIds.map((id, index) => {
    const slice = byId.get(id)!;
    // De volgorde en de ids volgen de nieuwe positie in de sectie.
    return { ...slice, order: index + 1, id: `slice-${index + 1}` };
  });
}

/** Voegt een slice samen met de volgende; null als er geen volgende is. */
export function mergeSliceWithNext(
  slices: TracerSlice[],
  sliceId: string,
): TracerSlice[] | null {
  const index = slices.findIndex((slice) => slice.id === sliceId);
  if (index === -1 || index === slices.length - 1) {
    return null;
  }

  const first = slices[index];
  const second = slices[index + 1];
  const merged: TracerSlice = {
    id: first.id,
    order: first.order,
    titel: `${first.titel} en ${second.titel}`,
    doel: `${first.doel} ${second.doel}`.trim(),
    gedrag: `${first.gedrag}\n\n${second.gedrag}`.trim(),
    acceptatiecriteria: [...first.acceptatiecriteria, ...second.acceptatiecriteria],
    requirementRefs: dedupe([...first.requirementRefs, ...second.requirementRefs]),
    buitenDezeSlice: dedupe([first.buitenDezeSlice, second.buitenDezeSlice])
      .join(" ")
      .trim(),
    // Een afhankelijkheid op een van de samengevoegde slices zelf vervalt.
    afhankelijkheden: dedupe([...first.afhankelijkheden, ...second.afhankelijkheden]).filter(
      (afhankelijkheid) =>
        afhankelijkheid !== first.titel && afhankelijkheid !== second.titel,
    ),
    testaanpak: `${first.testaanpak} ${second.testaanpak}`.trim(),
  };

  return [...slices.slice(0, index), merged, ...slices.slice(index + 2)];
}

/** Splitst een slice na het gegeven aantal acceptatiecriteria. */
export function splitSlice(
  slices: TracerSlice[],
  sliceId: string,
  afterCriteria: number,
): TracerSlice[] | null {
  const index = slices.findIndex((slice) => slice.id === sliceId);
  if (index === -1) {
    return null;
  }

  const slice = slices[index];
  if (afterCriteria < 1 || afterCriteria >= slice.acceptatiecriteria.length) {
    return null;
  }

  const eerste: TracerSlice = {
    ...slice,
    acceptatiecriteria: slice.acceptatiecriteria.slice(0, afterCriteria),
  };
  const vervolg: TracerSlice = {
    ...slice,
    id: `${slice.id}-vervolg`,
    titel: `${slice.titel} (vervolg)`,
    gedrag: `Zoals in "${slice.titel}", beperkt tot de genoemde criteria.`,
    acceptatiecriteria: slice.acceptatiecriteria.slice(afterCriteria),
  };

  return [...slices.slice(0, index), eerste, vervolg, ...slices.slice(index + 1)];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export interface SliceExportContext {
  taskTitle: string;
  projectName: string;
  requirements: WorkRequirement[];
}

/**
 * Rendert één slice als zelfstandig markdown-bestand: iemand zonder de app
 * begrijpt de opdracht, want de export noemt de taak, het project, alle velden
 * van het sjabloon en de volledige tekst van de verwezen requirements.
 */
export function renderSliceExport(
  slice: TracerSlice,
  context: SliceExportContext,
): string {
  const lines: string[] = [
    `# Slice ${slice.order}: ${slice.titel}`,
    "",
    `> Tracer-slice uit het werkdocument van taak "${context.taskTitle}" (project: ${context.projectName}).`,
    "",
    "## Doel",
    slice.doel,
    "",
    "## Gedrag",
    slice.gedrag,
    "",
    "## Acceptatiecriteria",
    ...slice.acceptatiecriteria.map((criterium) => `- ${criterium}`),
    "",
    "## Requirements-verwijzingen",
  ];

  for (const ref of slice.requirementRefs) {
    lines.push(`- ${ref}`);
    const requirement = context.requirements.find(
      (candidate) => normalizeLabel(candidate.title) === normalizeLabel(ref),
    );
    lines.push("");
    if (requirement) {
      lines.push(`### ${requirement.title}`);
      lines.push("");
      if (requirement.body) {
        lines.push(requirement.body);
      }
    } else {
      lines.push(`> Requirement "${ref}" staat niet in het werkdocument.`);
    }
  }

  lines.push(
    "",
    "## Buiten deze slice",
    slice.buitenDezeSlice,
    "",
    "## Afhankelijkheden",
    slice.afhankelijkheden.length > 0
      ? slice.afhankelijkheden.map((item) => `- ${item}`).join("\n")
      : "Geen",
    "",
    "## Testaanpak",
    slice.testaanpak,
    "",
  );

  return lines.join("\n");
}

/** Een leesbare bestandsnaam voor de export van één slice. */
export function sliceFileName(slice: TracerSlice): string {
  const slug = slice.titel
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `slice-${slice.order}-${slug || "slice"}.md`;
}
