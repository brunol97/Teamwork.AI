import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createSkill,
  getSkill,
  getActiveSkillsForAgent,
  listSkills,
} from "../../server/skills/store.js";
import { createSamenwerking } from "../collaboration/samenwerking.js";

const SKILL_MD_V1 = `# Notuleren

Houd notulen bij van elke besluitvorming.

- Schrijf besluiten op met wie en wanneer.
`;

const SKILL_MD_V2 = `${SKILL_MD_V1}
- Sluit af met een checklist van open punten.
`;

describe("skills: opslag met versies en eigenaar", () => {
  it("maakt een skill aan als versie 1 met een menselijke eigenaar", async () => {
    const { orgId, lead } = await createSamenwerking();

    const skill = await createSkill({
      orgId,
      name: "Notuleren",
      description: "Recept voor notulen",
      content: SKILL_MD_V1,
      ownerId: lead,
    });

    expect(skill.name).toBe("Notuleren");
    expect(skill.ownerId).toBe(lead);
    expect(skill.currentVersion).toBe(1);

    const gelezen = await getSkill(skill.id, orgId);
    expect(gelezen?.skill.id).toBe(skill.id);
    expect(gelezen?.versions).toHaveLength(1);
    expect(gelezen?.versions[0]?.version).toBe(1);
    expect(gelezen?.versions[0]?.content).toBe(SKILL_MD_V1);
  });

  it("weigert twee skills met dezelfde naam in één organisatie", async () => {
    const { orgId, lead } = await createSamenwerking();

    await createSkill({
      orgId,
      name: "Dubbel",
      content: SKILL_MD_V1,
      ownerId: lead,
    });

    await expect(
      createSkill({ orgId, name: "Dubbel", content: SKILL_MD_V1, ownerId: lead }),
    ).rejects.toThrow("al een skill met deze naam");
  });

  it("weigert een skill zonder inhoud", async () => {
    const { orgId, lead } = await createSamenwerking();

    await expect(
      createSkill({ orgId, name: "Leeg", content: "   ", ownerId: lead }),
    ).rejects.toThrow("inhoud");
  });

  it("houdt de organisatiegrens aan bij lezen", async () => {
    const { orgId, lead } = await createSamenwerking();
    const skill = await createSkill({
      orgId,
      name: "AlleenOns",
      content: SKILL_MD_V1,
      ownerId: lead,
    });

    expect(await listSkills(randomUUID())).toEqual([]);
    expect(await getSkill(skill.id, randomUUID())).toBeUndefined();
  });
});

describe("getActiveSkillsForAgent: de actieve versie op aanroeptijd", () => {
  it("geeft de actieve versie van elke gevraagde skill en slaat onbekende namen over", async () => {
    const { orgId, lead } = await createSamenwerking();
    const skill = await createSkill({
      orgId,
      name: "Notuleren",
      content: SKILL_MD_V1,
      ownerId: lead,
    });

    const actief = await getActiveSkillsForAgent(orgId, [
      "notuleren",
      "bestaat-niet",
    ]);
    expect(actief).toHaveLength(1);
    expect(actief[0]?.name).toBe("Notuleren");
    expect(actief[0]?.version).toBe(1);
    expect(actief[0]?.content).toBe(SKILL_MD_V1);
    expect(actief[0]?.id).toBe(skill.id);
  });

  it("geeft de nieuwe versie zodra die actief is, en bewaart de oude", async () => {
    const { orgId, lead } = await createSamenwerking();
    const skill = await createSkill({
      orgId,
      name: "Notuleren",
      content: SKILL_MD_V1,
      ownerId: lead,
    });

    // Een goedgekeurd voorstel maakt versie 2 actief; versie 1 blijft bewaard.
    const { createSkillVersion } = await import("../../server/skills/store.js");
    await createSkillVersion({
      orgId,
      skillId: skill.id,
      content: SKILL_MD_V2,
      createdBy: lead,
    });

    const actief = await getActiveSkillsForAgent(orgId, ["notuleren"]);
    expect(actief[0]?.version).toBe(2);
    expect(actief[0]?.content).toContain("checklist van open punten");

    // De oude versie blijft leesbaar: hij is nooit weggeschreven of verwijderd.
    const gelezen = await getSkill(skill.id, orgId);
    expect(gelezen?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(gelezen?.versions[0]?.content).toBe(SKILL_MD_V1);
  });
});
