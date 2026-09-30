import { createOrganization } from "@agent-native/core/org";
import { describe, expect, it } from "vitest";

import { createKlant, listKlanten } from "../../server/org/klanten.js";
import { convertPersonalToTeam, getOrgKind } from "../../server/org/store.js";
import { createAgent } from "../../server/agents/store.js";
import { createTask, listTasks } from "../../server/tasks/store.js";
import { getWorkDocument } from "../../server/documents/store.js";
import { createSkill } from "../../server/skills/store.js";
import {
  answerHumanTask,
  createHumanTask,
} from "../../server/collaboration/human-tasks.js";

/**
 * AC3: een persoonlijke werkruimte is om te zetten naar een team zonder
 * dataverlies. De omzetting is een vlagverandering in `organization_settings`;
 * dit test telt alles wat de organisatie bevat voor en na de omzetting en
 * bewijst dat er niets verdween of veranderde — behalve de vlag zelf.
 */
const BEHEERDER = "beheerder@dataverlies.test";

describe("persoonlijke werkruimte omzetten naar een team zonder dataverlies", () => {
  it("houdt alle taken, projecten, klanten, agents, skills, documenten en vragen over de omzetting heen", async () => {
    const org = await createOrganization(
      `Dataverlies ${Date.now()}`,
      BEHEERDER,
    );
    const orgId = org.id;

    // Seed: klant met project, twee losse projecten, taken in alle statussen,
    // een agent, een skill, een werkdocument en een beantwoorde vraag.
    const klant = await createKlant(orgId, "Acme BV");
    const taakBezig = await createTask({
      orgId,
      leadId: BEHEERDER,
      projectName: "Website",
      taskTitle: "Concept schrijven",
    });
    const taakKlaar = await createTask({
      orgId,
      leadId: BEHEERDER,
      projectName: "Website",
      taskTitle: "Deployen",
    });
    const taakOnderKlant = await createTask({
      orgId,
      leadId: BEHEERDER,
      projectName: "Klantproject",
      taskTitle: "Vraag stellen",
    });
    await createAgent({
      orgId,
      createdBy: BEHEERDER,
      name: `Onderzoeker-${Date.now()}`,
      description: "Verzamelt informatie.",
    });
    await createSkill({
      orgId,
      ownerId: BEHEERDER,
      createdBy: BEHEERDER,
      name: `Recept-${Date.now()}`,
      content: "---\nname: recept\n---\nDoe het zo.",
    });
    await createTask({
      orgId,
      leadId: BEHEERDER,
      projectName: "Los",
      taskTitle: "Gepauzeerde taak",
    });
    const vraag = await createHumanTask({
      taskId: taakOnderKlant.id,
      orgId,
      askedUserId: BEHEERDER,
      question: "Postgres of SQLite?",
      reason: "De keuze bepaalt het datamodel.",
      options: ["Postgres", "SQLite"],
    });
    expect(vraag).toBeDefined();
    const beantwoord = await answerHumanTask({
      id: vraag!.id,
      orgId,
      answer: "Postgres",
    });
    expect(beantwoord).toBeDefined();

    const takenVoor = await listTasks(orgId);
    const klantenVoor = await listKlanten(orgId);
    const documentVoor = await getWorkDocument(taakBezig.id, orgId);
    expect(takenVoor.length).toBeGreaterThanOrEqual(4);
    expect(klantenVoor).toHaveLength(1);

    // De omzetting zelf.
    await convertPersonalToTeam(orgId);
    expect((await getOrgKind(orgId)).isPersonal).toBe(false);

    // Alles is er nog, onveranderd.
    const takenNa = await listTasks(orgId);
    expect(takenNa).toHaveLength(takenVoor.length);
    expect(takenNa.map((t) => t.id).sort()).toEqual(
      takenVoor.map((t) => t.id).sort(),
    );
    expect(takenNa.map((t) => t.status).sort()).toEqual(
      takenVoor.map((t) => t.status).sort(),
    );
    expect(takenNa.find((t) => t.id === taakBezig.id)?.status).toBe("bezig");

    const klantenNa = await listKlanten(orgId);
    expect(klantenNa).toHaveLength(klantenVoor.length);
    expect(klantenNa[0].id).toBe(klant.id);

    const documentNa = await getWorkDocument(taakBezig.id, orgId);
    expect(documentNa?.markdown).toBe(documentVoor?.markdown);

    // De beantwoorde vraag en de taakstatus zijn intact.
    expect(takenNa.find((t) => t.id === taakOnderKlant.id)?.status).toBe(
      "bezig",
    );
    expect(takenNa.find((t) => t.id === taakKlaar.id)).toBeDefined();
  });

  it("weigert de omzetting van een organisatie die al een team is", async () => {
    const org = await createOrganization(`Al team ${Date.now()}`, BEHEERDER);
    await convertPersonalToTeam(org.id);
    await expect(convertPersonalToTeam(org.id)).rejects.toThrow(
      "al een team",
    );
  });
});
