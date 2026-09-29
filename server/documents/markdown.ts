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
