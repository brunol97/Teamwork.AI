import { describe, expect, it } from "vitest";

import {
  extractRequirements,
  mergeSliceWithNext,
  parsePlannedSlices,
  parseSlices,
  parseSliceRequest,
  planSlicesFromRequirements,
  renderSliceExport,
  renderSlicesSection,
  reorderSlices,
  sliceFileName,
  splitSlice,
  upsertSlicesSection,
  validateSlice,
  type TracerSlice,
} from "../../server/documents/slices.js";

const WERKDOCUMENT = `# Eisen

## Inloggen
De gebruiker logt in met een magic link.

- De gebruiker logt in met alleen een e-mailadres.
- Een verlopen link wordt geweigerd.

## Dashboard
Het dashboard toont de stand van taken.
`;

const SLICE_1: TracerSlice = {
  id: "slice-1",
  order: 1,
  titel: "Inloggen met magic link",
  doel: "Een ingelogde sessie opzetten met een magic link.",
  gedrag: "De gebruiker vult een e-mailadres in en opent de link uit de mail.",
  acceptatiecriteria: [
    "De gebruiker logt in met alleen een e-mailadres.",
    "Een verlopen link wordt geweigerd met een leesbare melding.",
  ],
  requirementRefs: ["Inloggen"],
  buitenDezeSlice: "Het beheer van rollen.",
  afhankelijkheden: [],
  testaanpak: "Unit-tests op de sessie-opbouw en één E2E-test van het inloggen.",
};

const SLICE_2: TracerSlice = {
  id: "slice-2",
  order: 2,
  titel: "Dashboard met taken",
  doel: "Inzicht in de stand van taken.",
  gedrag: "De gebruiker ziet per project het aantal taken per status.",
  acceptatiecriteria: ["Het dashboard toont de stand van taken."],
  requirementRefs: ["Dashboard"],
  buitenDezeSlice: "Filteren op status.",
  afhankelijkheden: ["Inloggen met magic link"],
  testaanpak: "Unit-tests op de status-telling en één E2E-test van het dashboard.",
};

describe("parseSliceRequest", () => {
  it("herkent een verzoek om tracer-slices te maken", () => {
    expect(parseSliceRequest("Maak tracer-slices voor dit werkdocument")).not.toBeNull();
    expect(parseSliceRequest("verdeel het werk in tracer-slices")).not.toBeNull();
    expect(parseSliceRequest("Plan de tracer slices")).not.toBeNull();
  });

  it("herkent een verzoek om slices zonder het woord tracer", () => {
    expect(parseSliceRequest("Maak slices op basis van de requirements")).not.toBeNull();
  });

  it("negeert berichten zonder slice-verzoek", () => {
    expect(parseSliceRequest("Hoi agent")).toBeFalsy();
    expect(parseSliceRequest("Schrijf een sectie over datamigratie")).toBeFalsy();
    expect(parseSliceRequest("Wat is een slice eigenlijk?")).toBeFalsy();
  });
});

describe("extractRequirements", () => {
  it("leest de eisen als koppen met hun tekst", () => {
    const requirements = extractRequirements(WERKDOCUMENT);
    expect(requirements.map((requirement) => requirement.title)).toEqual([
      "Eisen",
      "Inloggen",
      "Dashboard",
    ]);
    expect(requirements[1].body).toContain("magic link");
  });

  it("laat de Tracer-slices-sectie weg", () => {
    const document = `${WERKDOCUMENT}\n${renderSlicesSection([SLICE_1, SLICE_2])}`;
    const requirements = extractRequirements(document);
    expect(requirements.map((requirement) => requirement.title)).not.toContain(
      "Tracer-slices",
    );
  });
});

describe("renderSlicesSection en parseSlices", () => {
  it("rondt renderen en parsen rond", () => {
    const section = renderSlicesSection([SLICE_1, SLICE_2]);
    const slices = parseSlices(section);
    expect(slices.map((slice) => slice.titel)).toEqual([SLICE_1.titel, SLICE_2.titel]);
    expect(slices[0].doel).toBe(SLICE_1.doel);
    expect(slices[0].gedrag).toBe(SLICE_1.gedrag);
    expect(slices[0].acceptatiecriteria).toEqual(SLICE_1.acceptatiecriteria);
    expect(slices[0].requirementRefs).toEqual(["Inloggen"]);
    expect(slices[0].buitenDezeSlice).toBe(SLICE_1.buitenDezeSlice);
    expect(slices[0].afhankelijkheden).toEqual([]);
    expect(slices[0].testaanpak).toBe(SLICE_1.testaanpak);
    expect(slices.map((slice) => slice.order)).toEqual([1, 2]);
  });

  it("leest afhankelijkheden als lijst en Geen als lege lijst", () => {
    const section = renderSlicesSection([SLICE_2]);
    const slices = parseSlices(section);
    expect(slices[0].afhankelijkheden).toEqual(["Inloggen met magic link"]);
  });

  it("geeft een lege lijst terug zonder Tracer-slices-sectie", () => {
    expect(parseSlices(WERKDOCUMENT)).toEqual([]);
    expect(parseSlices("")).toEqual([]);
  });

  it("leest een sectie die de agent in vrij markdown schreef", () => {
    const agentText = [
      "## Tracer-slices",
      "",
      "### Slice 1: Inloggen met magic link",
      "",
      "- **Doel:** Een ingelogde sessie opzetten met een magic link.",
      "- **Gedrag:** De gebruiker vult een e-mailadres in en opent de link uit de mail.",
      "- **Acceptatiecriteria:**",
      "  - De gebruiker logt in met alleen een e-mailadres.",
      "  - Een verlopen link wordt geweigerd met een leesbare melding.",
      "- **Requirements-verwijzingen:** Inloggen",
      "- **Buiten deze slice:** Het beheer van rollen.",
      "- **Afhankelijkheden:** Geen",
      "- **Testaanpak:** Unit-tests op de sessie-opbouw en één E2E-test van het inloggen.",
    ].join("\n");
    const slices = parseSlices(agentText);
    expect(slices).toHaveLength(1);
    expect(slices[0].titel).toBe("Inloggen met magic link");
    expect(slices[0].acceptatiecriteria).toHaveLength(2);
  });
});

describe("validateSlice", () => {
  it("accepteert een slice met alle velden en bestaande requirements", () => {
    expect(validateSlice(SLICE_1, ["Inloggen", "Dashboard"])).toEqual([]);
  });

  it("keurt een slice zonder veld af", () => {
    const onvolledig = { ...SLICE_1, doel: "" };
    expect(validateSlice(onvolledig, ["Inloggen"])).toContain("doel");
    const zonderCriteria = { ...SLICE_1, acceptatiecriteria: [] };
    expect(validateSlice(zonderCriteria, ["Inloggen"])).toContain("acceptatiecriteria");
  });

  it("keurt een slice met een onbekende requirement af", () => {
    const onbekend = { ...SLICE_1, requirementRefs: ["Niet in het document"] };
    expect(validateSlice(onbekend, ["Inloggen"])).toContain("requirements");
  });
});

describe("parsePlannedSlices", () => {
  it("leest bruikbare slices uit het antwoord van de agent", () => {
    const antwoord = renderSlicesSection([SLICE_1]);
    const slices = parsePlannedSlices(antwoord, ["Inloggen"]);
    expect(slices).toHaveLength(1);
    expect(slices[0].titel).toBe(SLICE_1.titel);
  });

  it("laat slices zonder veld of met een onbekende requirement vallen", () => {
    const antwoord = [
      renderSlicesSection([SLICE_1]),
      "",
      "### Slice 2: Onbekend",
      "",
      "- **Doel:**",
      "- **Gedrag:**",
      "- **Acceptatiecriteria:**",
      "- **Requirements-verwijzingen:** Niet in het document",
      "- **Buiten deze slice:**",
      "- **Afhankelijkheden:** Geen",
      "- **Testaanpak:**",
    ].join("\n");
    const slices = parsePlannedSlices(antwoord, ["Inloggen"]);
    expect(slices.map((slice) => slice.titel)).toEqual([SLICE_1.titel]);
  });
});

describe("planSlicesFromRequirements", () => {
  it("maakt per requirement een slice met alle velden", () => {
    const slices = planSlicesFromRequirements(WERKDOCUMENT);
    expect(slices).toHaveLength(2);
    expect(slices[0].titel).toBe("Inloggen");
    expect(slices[1].titel).toBe("Dashboard");
    for (const slice of slices) {
      expect(validateSlice(slice, extractRequirements(WERKDOCUMENT).map((r) => r.title))).toEqual([]);
      expect(slice.doel).not.toBe("");
      expect(slice.gedrag).not.toBe("");
      expect(slice.acceptatiecriteria.length).toBeGreaterThan(0);
      expect(slice.requirementRefs).toEqual([slice.titel]);
      expect(slice.buitenDezeSlice).not.toBe("");
      expect(slice.testaanpak).not.toBe("");
    }
  });

  it("geeft een lege lijst terug zonder requirements", () => {
    expect(planSlicesFromRequirements("Geen koppen hier.")).toEqual([]);
  });
});

describe("reorderSlices", () => {
  it("zet de volgorde om en hernummert", () => {
    const reordered = reorderSlices([SLICE_1, SLICE_2], ["slice-2", "slice-1"]);
    expect(reordered.map((slice) => slice.titel)).toEqual([SLICE_2.titel, SLICE_1.titel]);
    expect(reordered.map((slice) => slice.order)).toEqual([1, 2]);
  });

  it("houdt de volgorde aan wanneer de ids onvolledig zijn", () => {
    const reordered = reorderSlices([SLICE_1, SLICE_2], ["slice-2"]);
    expect(reordered.map((slice) => slice.titel)).toEqual([SLICE_1.titel, SLICE_2.titel]);
  });
});

describe("mergeSliceWithNext", () => {
  it("voegt een slice samen met de volgende en bewaart alle velden", () => {
    const merged = mergeSliceWithNext([SLICE_1, SLICE_2], "slice-1");
    expect(merged).toHaveLength(1);
    const slice = merged[0];
    expect(slice.titel).toBe(`${SLICE_1.titel} en ${SLICE_2.titel}`);
    expect(slice.acceptatiecriteria).toEqual([
      ...SLICE_1.acceptatiecriteria,
      ...SLICE_2.acceptatiecriteria,
    ]);
    expect(slice.requirementRefs).toEqual(["Inloggen", "Dashboard"]);
    expect(slice.doel).toContain(SLICE_1.doel);
    expect(slice.doel).toContain(SLICE_2.doel);
    expect(slice.gedrag).toContain(SLICE_1.gedrag);
    expect(slice.gedrag).toContain(SLICE_2.gedrag);
    expect(slice.afhankelijkheden).toEqual([]);
    expect(slice.testaanpak).toContain(SLICE_1.testaanpak);
    expect(validateSlice(slice, ["Inloggen", "Dashboard"])).toEqual([]);
  });

  it("geeft null terug voor de laatste slice", () => {
    expect(mergeSliceWithNext([SLICE_1, SLICE_2], "slice-2")).toBeNull();
  });
});

describe("splitSlice", () => {
  it("splitst een slice na een acceptatiecriterium", () => {
    const gesplitst = splitSlice([SLICE_1], "slice-1", 1);
    expect(gesplitst).toHaveLength(2);
    const [eerste, vervolg] = gesplitst;
    expect(eerste.acceptatiecriteria).toEqual([SLICE_1.acceptatiecriteria[0]]);
    expect(vervolg.acceptatiecriteria).toEqual([SLICE_1.acceptatiecriteria[1]]);
    expect(vervolg.titel).toContain(SLICE_1.titel);
    expect(eerste.requirementRefs).toEqual(["Inloggen"]);
    expect(vervolg.requirementRefs).toEqual(["Inloggen"]);
    for (const slice of gesplitst) {
      expect(validateSlice(slice, ["Inloggen"])).toEqual([]);
    }
  });

  it("weigert een splitsing op de randen", () => {
    expect(splitSlice([SLICE_1], "slice-1", 0)).toBeNull();
    expect(
      splitSlice([SLICE_1], "slice-1", SLICE_1.acceptatiecriteria.length),
    ).toBeNull();
  });
});

describe("upsertSlicesSection", () => {
  it("plaatst de sectie onderaan een document zonder sectie", () => {
    const document = upsertSlicesSection(WERKDOCUMENT, [SLICE_1]);
    expect(document).toContain("## Tracer-slices");
    expect(parseSlices(document)).toHaveLength(1);
    expect(document).toContain("## Inloggen");
  });

  it("vervangt de bestaande sectie in plaats van er een tweede toe te voegen", () => {
    const document = upsertSlicesSection(WERKDOCUMENT, [SLICE_1]);
    const opnieuw = upsertSlicesSection(document, [SLICE_2]);
    expect(opnieuw.match(/## Tracer-slices/g)).toHaveLength(1);
    const slices = parseSlices(opnieuw);
    expect(slices.map((slice) => slice.titel)).toEqual([SLICE_2.titel]);
    expect(opnieuw).toContain("## Dashboard");
  });
});

describe("renderSliceExport", () => {
  it("maakt een zelfstandige export zonder de app", () => {
    const document = `${WERKDOCUMENT}\n${renderSlicesSection([SLICE_1, SLICE_2])}`;
    const exportMarkdown = renderSliceExport(SLICE_1, {
      taskTitle: "E2E Werkdocument",
      projectName: "E2E Document",
      requirements: extractRequirements(document),
    });

    expect(exportMarkdown).toContain("# Slice 1: Inloggen met magic link");
    expect(exportMarkdown).toContain("E2E Werkdocument");
    expect(exportMarkdown).toContain("E2E Document");
    expect(exportMarkdown).toContain("## Doel");
    expect(exportMarkdown).toContain(SLICE_1.doel);
    expect(exportMarkdown).toContain("## Gedrag");
    expect(exportMarkdown).toContain("## Acceptatiecriteria");
    expect(exportMarkdown).toContain(SLICE_1.acceptatiecriteria[0]);
    expect(exportMarkdown).toContain("## Requirements-verwijzingen");
    expect(exportMarkdown).toContain("## Inloggen");
    expect(exportMarkdown).toContain("De gebruiker logt in met een magic link.");
    expect(exportMarkdown).toContain("## Buiten deze slice");
    expect(exportMarkdown).toContain("## Afhankelijkheden");
    expect(exportMarkdown).toContain("## Testaanpak");
  });

  it("geeft de slice een bestandsnaam zonder spaties", () => {
    expect(sliceFileName(SLICE_1)).toBe("slice-1-inloggen-met-magic-link.md");
  });
});
