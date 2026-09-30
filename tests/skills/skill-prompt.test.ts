import { describe, expect, it, vi } from "vitest";

import { runAgentTurn } from "../../server/agents/runner.js";
import type { AgentConfig } from "../../server/agents/store.js";
import type { SkillContent } from "../../server/skills/store.js";

const agent: AgentConfig = {
  id: "agent-1",
  name: "Notuleerder",
  description: "Maakt notulen.",
  model: null,
  tools: [],
  skills: ["Notuleren", "BestaatNiet"],
  enabled: true,
};

const V1: SkillContent = {
  id: "skill-1",
  name: "Notuleren",
  version: 1,
  content: "# Notuleren\n\nHoud notulen bij.\n",
};

describe("de systeemprompt van een agent met skills uit de bibliotheek", () => {
  it("neemt de volledige inhoud van de actieve versie op in de prompt", async () => {
    const resolveSkills = vi.fn().mockResolvedValue([V1]);
    const generate = vi.fn().mockResolvedValue("Klaar.");

    await runAgentTurn({
      taskTitle: "Notuleren",
      agents: [agent],
      agent,
      messages: [{ role: "user", content: "Maak notulen." }],
      generate,
      resolveSkills,
    });

    const system = generate.mock.calls[0][0] as string;
    expect(system).toContain("Houd notulen bij.");
    expect(system).toContain("Notuleren");
    expect(resolveSkills).toHaveBeenCalledWith(agent);
  });

  it("gebruikt op aanroeptijd de versie die de oplosser geeft", async () => {
    const generate = vi.fn().mockResolvedValue("Klaar.");
    const actieveVersie = vi.fn().mockResolvedValue([
      { ...V1, version: 2, content: "# Notuleren\n\nNieuwe versie.\n" },
    ]);

    await runAgentTurn({
      taskTitle: "Notuleren",
      agents: [agent],
      agent,
      messages: [{ role: "user", content: "Maak notulen." }],
      generate,
      resolveSkills: actieveVersie,
    });

    const system = generate.mock.calls[0][0] as string;
    expect(system).toContain("Nieuwe versie.");
    expect(system).not.toContain("Houd notulen bij.");
  });

  it("noemt de skillnaam wanneer er geen inhoud geresolved kan worden", async () => {
    const generate = vi.fn().mockResolvedValue("Klaar.");

    await runAgentTurn({
      taskTitle: "Notuleren",
      agents: [agent],
      agent,
      messages: [{ role: "user", content: "Maak notulen." }],
      generate,
      resolveSkills: vi.fn().mockResolvedValue([]),
    });

    const system = generate.mock.calls[0][0] as string;
    expect(system).toContain("Notuleren");
    expect(system).toContain("BestaatNiet");
    expect(system).not.toContain("# Notuleren");
  });

  it("geeft de uitbesteede agent zijn eigen skills, niet die van de actieve agent", async () => {
    const uitbesteed: AgentConfig = { ...agent, id: "agent-2", name: "Reviewer", skills: ["Reviewen"] };
    const generate = vi
      .fn()
      .mockResolvedValueOnce(`UITBESTEED AAN @Reviewer: lees het na.`)
      .mockResolvedValueOnce("Nagekeken.");
    const resolveSkills = vi
      .fn()
      .mockImplementation(async (gevraagd: AgentConfig) =>
        gevraagd.skills.includes("Reviewen")
          ? [{ id: "skill-2", name: "Reviewen", version: 1, content: "# Reviewen\n\nLees na.\n" }]
          : [V1],
      );

    const result = await runAgentTurn({
      taskTitle: "Notuleren",
      agents: [agent, uitbesteed],
      agent,
      messages: [{ role: "user", content: "Ga aan het werk." }],
      generate,
      resolveSkills,
    });

    expect(result.delegation?.ok).toBe(true);
    // Tweede aanroep is de uitbesteede agent; die krijgt de Reviewen-skill.
    const subSystem = generate.mock.calls[1][0] as string;
    expect(subSystem).toContain("Lees na.");
    expect(subSystem).not.toContain("Houd notulen bij.");
    expect(resolveSkills).toHaveBeenNthCalledWith(2, uitbesteed);
  });

  it("werkt ook zonder oplosser: dan blijven alleen de namen staan", async () => {
    const generate = vi.fn().mockResolvedValue("Klaar.");

    await runAgentTurn({
      taskTitle: "Notuleren",
      agents: [agent],
      agent,
      messages: [{ role: "user", content: "Maak notulen." }],
      generate,
    });

    const system = generate.mock.calls[0][0] as string;
    expect(system).toContain("Notuleren");
    expect(system).not.toContain("# Notuleren");
  });
});
