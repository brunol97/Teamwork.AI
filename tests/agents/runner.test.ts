import { describe, expect, it, vi } from "vitest";

import type { AgentConfig } from "../../server/agents/store.js";
import {
  buildAgentSystemPrompt,
  parseDelegation,
  parseMention,
  runAgentTurn,
} from "../../server/agents/runner.js";
import { estimateCostCents } from "../../server/agents/cost.js";

function agent(fields: Partial<AgentConfig> & { name: string }): AgentConfig {
  return {
    id: `id-${fields.name}`,
    description: "",
    model: null,
    tools: [],
    skills: [],
    enabled: true,
    ...fields,
  };
}

describe("parseMention", () => {
  const agents = [
    agent({ name: "Onderzoeker", enabled: true }),
    agent({ name: "Schrijver", enabled: false }),
  ];

  it("vindt de genoemde agent, zonder hoofdlettergevoeligheid", () => {
    expect(parseMention("@onderzoeker wat weet je?", agents)?.name).toBe(
      "Onderzoeker",
    );
  });

  it("negeert namen zonder match en berichten zonder @", () => {
    expect(parseMention("wat weet je?", agents)).toBeNull();
    expect(parseMention("@niemand wat weet je?", agents)).toBeNull();
  });

  it("roept nooit een uitgeschakelde agent aan", () => {
    expect(parseMention("@schrijver schrijf dit", agents)).toBeNull();
  });
});

describe("parseDelegation", () => {
  it("leest de uitbestedingsregel met opdracht", () => {
    expect(
      parseDelegation(
        "Ik doe de kern zelf.\nUITBESTEED AAN @reviewer: lees het hoofdstuk na",
      ),
    ).toEqual({
      name: "reviewer",
      opdracht: "lees het hoofdstuk na",
    });
  });

  it("ziet geen uitbesteding in een gewone vermelding", () => {
    expect(parseDelegation("Vraag het aan @reviewer.")).toBeNull();
  });
});

describe("runAgentTurn", () => {
  it("laat de agent met zijn eigen model en tools spreken", async () => {
    const generate = vi.fn().mockResolvedValue("Klaar.");
    const onderzoeker = agent({
      name: "Onderzoeker",
      tools: ["web-zoeken"],
      skills: ["rechercheren"],
      model: "llama3:8b",
    });

    const result = await runAgentTurn({
      taskTitle: "Migratie",
      agents: [onderzoeker],
      agent: onderzoeker,
      messages: [{ role: "user", content: "Wat weet je?" }],
      generate,
    });

    expect(result.reply).toBe("Klaar.");
    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('"Onderzoeker"'),
      [{ role: "user", content: "Wat weet je?" }],
      { model: "llama3:8b" },
    );
    const system = generate.mock.calls[0][0] as string;
    expect(system).toContain("web-zoeken");
    expect(system).toContain("rechercheren");
  });

  it("geeft de standaardagent de gewone prompt zonder tools", async () => {
    const generate = vi.fn().mockResolvedValue("Klaar.");
    await runAgentTurn({
      taskTitle: "Migratie",
      agents: [],
      agent: null,
      messages: [{ role: "user", content: "Hoi" }],
      generate,
    });

    const system = generate.mock.calls[0][0] as string;
    expect(system).toContain("behulpzame agent");
    expect(system).not.toContain("Je beschikt alleen");
  });

  it("stapelt rechten niet: de uitbesteede agent krijgt alleen zijn eigen tools", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("UITBESTEED AAN @reviewer: lees het na")
      .mockResolvedValueOnce("Het klopt.");

    const actief = agent({ name: "Schrijver", tools: ["werkdocument-schrijven"] });
    const reviewer = agent({ name: "reviewer", tools: ["werkdocument-lezen"] });

    const result = await runAgentTurn({
      taskTitle: "Migratie",
      agents: [actief, reviewer],
      agent: actief,
      messages: [{ role: "user", content: "Schrijf en laat controleren." }],
      generate,
    });

    expect(result.delegation).toEqual({
      name: "reviewer",
      opdracht: "lees het na",
      ok: true,
    });
    expect(result.reply).toContain("(uitbesteed aan @reviewer)");
    expect(result.reply).toContain("Het klopt.");

    // De tweede aanroep is de uitbesteede agent: zijn prompt noemt alleen zijn
    // eigen tool, nooit de tools van de agent die uitbesteedde.
    const uitbesteedSystem = generate.mock.calls[1][0] as string;
    expect(uitbesteedSystem).toContain('"reviewer"');
    expect(uitbesteedSystem).toContain("werkdocument-lezen");
    expect(uitbesteedSystem).not.toContain("werkdocument-schrijven");
    // En hij krijgt zijn eigen thread: alleen de deeltaak, niet het gesprek.
    expect(generate.mock.calls[1][1]).toEqual([
      { role: "user", content: "lees het na" },
    ]);
  });

  it("weigert een derde delegatieniveau met een duidelijke melding", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("UITBESTEED AAN @tweede: doe de deeltaak")
      .mockResolvedValueOnce("UITBESTEED AAN @derde: nog een niveau dieper");

    const eerste = agent({ name: "eerste" });
    const tweede = agent({ name: "tweede" });
    const derde = agent({ name: "derde" });

    const result = await runAgentTurn({
      taskTitle: "Migratie",
      agents: [eerste, tweede, derde],
      agent: eerste,
      messages: [{ role: "user", content: "Ga aan het werk." }],
      generate,
    });

    // Niveau 1 -> 2 mocht, niveau 3 wordt geweigerd.
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.refusal).toContain("delegatiediepte is maximaal 2");
    expect(result.refusal).toContain("derde niveau is niet toegestaan");
  });

  it("weigert een uitbesteding aan een onbekende of uitgeschakelde agent", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("UITBESTEED AAN @spook: doe iets")
      .mockResolvedValueOnce("UITBESTEED AAN @slaper: doe iets")
      .mockResolvedValueOnce("Zelf gedaan.");

    const slaper = agent({ name: "slaper", enabled: false });
    const result = await runAgentTurn({
      taskTitle: "Migratie",
      agents: [slaper],
      agent: null,
      messages: [{ role: "user", content: "Ga aan het werk." }],
      generate,
    });

    expect(result.delegation?.ok).toBe(false);
    expect(result.refusal).toContain("@spook");
    expect(result.refusal).toContain("bestaat niet in deze organisatie of is uitgeschakeld");
  });
});

describe("buildAgentSystemPrompt", () => {
  it("noemt precies de tools van deze agent", () => {
    const prompt = buildAgentSystemPrompt(
      agent({ name: "Reviewer", tools: ["werkdocument-lezen"] }),
      "Migratie",
    );
    expect(prompt).toContain("werkdocument-lezen");
    expect(prompt).not.toContain("web-zoeken");
  });

  it("meldt expliciet dat een agent zonder tools ook geen tools heeft", () => {
    const prompt = buildAgentSystemPrompt(agent({ name: "Leeg" }), "Migratie");
    expect(prompt).toContain("over de volgende tools: geen");
  });
});

describe("estimateCostCents", () => {
  it("is deterministisch en stijgt met het aantal tekens", () => {
    expect(estimateCostCents(0, 0)).toBe(0);
    expect(estimateCostCents(1000, 1000)).toBe(1);
    expect(estimateCostCents(8000, 8000)).toBeGreaterThan(1);
  });
});
