import { describe, expect, it } from "vitest";

import { lineDiff } from "../../server/skills/diff.js";
import {
  parseSkillProposals,
  extractEvaluation,
} from "../../server/skills/proposals.js";

const OUDE_INHOUD = `# Notuleren

Houd notulen bij van elke besluitvorming.

- Schrijf besluiten op met wie en wanneer.
`;

const NIEUWE_INHOUD = `# Notuleren

Houd notulen bij van elke besluitvorming.

- Schrijf besluiten op met wie en wanneer.
- Sluit af met een checklist van open punten.
`;

describe("lineDiff: het verschil tussen twee versies", () => {
  it("toont verwijderde en toegevoegde regels", () => {
    const diff = lineDiff(OUDE_INHOUD, NIEUWE_INHOUD);

    expect(diff).toContain("+ - Sluit af met een checklist van open punten.");
    expect(diff).not.toContain("- # Notuleren");
  });

  it("geeft een lege diff bij identieke inhoud", () => {
    expect(lineDiff(OUDE_INHOUD, OUDE_INHOUD)).toBe("");
  });
});

describe("parseSkillProposals: het vaste formaat in het antwoord van de agent", () => {
  it("leest naam, uitleg en inhoud uit een voorstel", () => {
    const reply = `Hier is mijn evaluatie.

SKILL-VOORSTEL: notuleren
UITLEG: De skill mist een afsluitchecklist; die voorkomt onvolledige notulen.
INHOUD:
${NIEUWE_INHOUD}EINDE VOORSTEL
`;

    const voorstellen = parseSkillProposals(reply);
    expect(voorstellen).toHaveLength(1);
    expect(voorstellen[0]?.name).toBe("notuleren");
    expect(voorstellen[0]?.uitleg).toBe(
      "De skill mist een afsluitchecklist; die voorkomt onvolledige notulen.",
    );
    // De inhoud is de tekst tussen INHOUD: en EINDE VOORSTEL, zonder de
    // afsluitende regeleinde.
    expect(voorstellen[0]?.content).toBe(NIEUWE_INHOUD.replace(/\n$/, ""));
  });

  it("leest meerdere voorstellen achter elkaar", () => {
    const reply = `SKILL-VOORSTEL: notuleren
UITLEG: Eerste wijziging.
INHOUD:
${NIEUWE_INHOUD}EINDE VOORSTEL

SKILL-VOORSTEL: reviewen
UITLEG: Tweede wijziging.
INHOUD:
# Reviewen
Lees werk na.
EINDE VOORSTEL
`;

    const voorstellen = parseSkillProposals(reply);
    expect(voorstellen.map((voorstel) => voorstel.name)).toEqual([
      "notuleren",
      "reviewen",
    ]);
  });

  it("laat een voorstel zonder uitleg vallen", () => {
    const reply = `SKILL-VOORSTEL: notuleren
UITLEG:
INHOUD:
${NIEUWE_INHOUD}EINDE VOORSTEL
`;
    expect(parseSkillProposals(reply)).toEqual([]);
  });

  it("laat een voorstel zonder inhoud vallen", () => {
    const reply = `SKILL-VOORSTEL: notuleren
UITLEG: Een goede reden.
INHOUD:
EINDE VOORSTEL
`;
    expect(parseSkillProposals(reply)).toEqual([]);
  });

  it("ziet geen voorstellen in een antwoord zonder het formaat", () => {
    expect(parseSkillProposals("Dit is een geautomatiseerd testantwoord.")).toEqual(
      [],
    );
  });
});

describe("extractEvaluation: de evaluatie is het antwoord zonder de voorstellen", () => {
  it("haalt de voorstellen uit de evaluatietekst", () => {
    const reply = `De taak liep goed. De notulerenskill kan beter.

SKILL-VOORSTEL: notuleren
UITLEG: Beter.
INHOUD:
${NIEUWE_INHOUD}EINDE VOORSTEL
`;

    const evaluatie = extractEvaluation(reply);
    expect(evaluatie).toContain("De taak liep goed");
    expect(evaluatie).not.toContain("SKILL-VOORSTEL");
    expect(evaluatie).not.toContain("EINDE VOORSTEL");
  });

  it("geeft een lege tekst terug wanneer het antwoord alleen voorstellen bevat", () => {
    const reply = `SKILL-VOORSTEL: notuleren
UITLEG: Beter.
INHOUD:
${NIEUWE_INHOUD}EINDE VOORSTEL
`;
    expect(extractEvaluation(reply)).toBe("");
  });
});
