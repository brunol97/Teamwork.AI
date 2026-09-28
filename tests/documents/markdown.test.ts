import { describe, expect, it } from "vitest";

import {
  appendSection,
  parseSectionRequest,
  renderSection,
  toSectionTitle,
} from "../../server/documents/markdown.js";

describe("parseSectionRequest", () => {
  it("reads the topic from a request to write a section", () => {
    const request = parseSectionRequest("Schrijf een sectie over datamigratie");
    expect(request).toEqual({ topic: "datamigratie", title: "Datamigratie" });
  });

  it("recognises alternative phrasings", () => {
    expect(parseSectionRequest("voeg een sectie toe over de roadmap")?.topic).toBe(
      "de roadmap",
    );
    expect(
      parseSectionRequest("Ik wil graag een sectie over de opdrachtgever.")?.topic,
    ).toBe("de opdrachtgever");
  });

  it("ignores messages without a section request", () => {
    expect(parseSectionRequest("Hoi agent")).toBeNull();
    expect(parseSectionRequest("Schrijf een samenvatting van de taak")).toBeNull();
    expect(parseSectionRequest("")).toBeNull();
  });
});

describe("toSectionTitle", () => {
  it("capitalises the topic and drops trailing punctuation", () => {
    expect(toSectionTitle("datamigratie")).toBe("Datamigratie");
    expect(toSectionTitle("  de roadmap.  ")).toBe("De roadmap");
  });

  it("returns an empty title when there is no topic", () => {
    expect(toSectionTitle("   ")).toBe("");
  });
});

describe("renderSection and appendSection", () => {
  it("renders a section as a level two heading with the body", () => {
    expect(renderSection("Datamigratie", "Stap 1: back-up maken.")).toBe(
      "## Datamigratie\n\nStap 1: back-up maken.\n",
    );
  });

  it("appends the section to an existing document with a blank line between", () => {
    const document = appendSection(
      "# Eisen\n\n- Snelheid\n",
      "Datamigratie",
      "Stap 1: back-up maken.",
    );

    expect(document).toBe(
      "# Eisen\n\n- Snelheid\n\n## Datamigratie\n\nStap 1: back-up maken.\n",
    );
  });

  it("starts a new document when it is still empty", () => {
    expect(appendSection("", "Datamigratie", "Stap 1.")).toBe(
      "## Datamigratie\n\nStap 1.\n",
    );
  });
});
