/**
 * Het werkdocument van een taak is markdown. Deze module bevat de zuivere
 * markdown-regels die zowel de agent (server) als de editor (ui) gebruiken.
 */

/** Een verzoek van de gebruiker om een sectie aan het werkdocument toe te voegen. */
export interface SectionRequest {
  /** Het onderwerp zoals de gebruiker het noemde. */
  topic: string;
  /** De kop die boven de nieuwe sectie komt. */
  title: string;
}

const SECTION_REQUEST_PATTERN = /\bsectie\b[^.!?]*?\bover\s+([^.!?\n?]+)/i;

/**
 * Herkent "schrijf een sectie over X" (en varianten daarop) in een bericht van
 * de gebruiker. Het onderwerp loopt tot het eind van de zin. Geeft null terug
 * wanneer er geen verzoek om een sectie in zit.
 */
export function parseSectionRequest(message: string): SectionRequest | null {
  const match = message.match(SECTION_REQUEST_PATTERN);
  if (!match) {
    return null;
  }

  const topic = match[1].trim();
  if (!topic) {
    return null;
  }

  return { topic, title: toSectionTitle(topic) };
}

/** Maakt van een onderwerp een sectiekop: eerste letter groot, zonder slotpunt. */
export function toSectionTitle(topic: string): string {
  const cleaned = topic.trim().replace(/[.,;:!?]+$/, "").trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Een sectie is een kop van niveau twee met de tekst eronder. */
export function renderSection(title: string, body: string): string {
  return `## ${title}\n\n${body.trim()}\n`;
}

/** Plaat een sectie onderaan het bestaande werkdocument. */
export function appendSection(
  markdown: string,
  title: string,
  body: string,
): string {
  const existing = markdown.trimEnd();
  const section = renderSection(title, body);
  return existing === "" ? section : `${existing}\n\n${section}`;
}

/**
 * Leest de koppen van één niveau uit de markdown: de titel zonder #-prefix,
 * in documentvolgorde. Koppen van een ander niveau worden overgeslagen, en een
 * kop met lege titel telt niet mee.
 */
export function extractHeadings(markdown: string, level: number): string[] {
  const pattern = new RegExp(`^#{${level}}\\s+(.+)$`, "u");
  const koppen: string[] = [];
  for (const regel of markdown.split("\n")) {
    const match = regel.match(pattern);
    const titel = match?.[1]?.trim();
    if (titel) {
      koppen.push(titel);
    }
  }
  return koppen;
}

/** Eén onderdeel van het werkdocument: een kop van niveau twee met zijn tekst. */
export interface DocumentSection {
  title: string;
  body: string;
}

/**
 * Verdeelt de markdown in onderdelen: elke kop van niveau twee opent een
 * nieuw onderdeel; alle regels daaronder — koppen van diepere niveaus
 * inbegrepen — horen bij dat onderdeel. Wat vóór de eerste kop-niveau-2 staat,
 * hoort bij geen onderdeel.
 */
export function parseDocumentSections(markdown: string): DocumentSection[] {
  const secties: DocumentSection[] = [];
  let huidig: DocumentSection | null = null;

  for (const regel of markdown.split("\n")) {
    const kop = regel.match(/^##\s+(.+)$/);
    if (kop?.[1]?.trim()) {
      huidig = { title: kop[1].trim(), body: "" };
      secties.push(huidig);
      continue;
    }
    if (huidig) {
      huidig.body = huidig.body ? `${huidig.body}\n${regel}` : regel;
    }
  }

  return secties.map((sectie) => ({ ...sectie, body: sectie.body.trim() }));
}
