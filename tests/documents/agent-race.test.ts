import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb } from "../../server/db/client.js";
import { workDocuments } from "../../server/db/schema.js";
import {
  addWorkDocumentSection,
  applyWorkDocumentChange,
  getWorkDocument,
  saveWorkDocument,
} from "../../server/documents/store.js";
import { createTask } from "../../server/tasks/store.js";

const ORG = "org-agent-race";

async function createTaak() {
  return createTask({
    orgId: ORG,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Agent tegen mens",
  });
}

/**
 * Simuleert de save van een beheerder die landt nadat de agent zijn sectie al
 * heeft toegepast maar nog niet heeft geschreven: de versie loopt op en de
 * markdown verandert, zonder een transactie te openen (PGlite kan niet
 * nesten). De schrijfactie van de agent botst daarna op de versie.
 */
async function mensSlaatOp(taskId: string, markdown: string, version: number): Promise<void> {
  await getDb()
    .update(workDocuments)
    .set({ markdown, version })
    .where(eq(workDocuments.taskId, taskId));
}

/**
 * De agent bouwt zijn sectie uit een leesactie van een moment geleden. Landt er
 * tussen die leesactie en de schrijfactie een menselijke save, dan mag de
 * herhaalpoging van de agent die menselijke tekst niet overschrijven: de
 * herhaalpoging leest opnieuw en plakt de sectie opnieuw onderaan.
 *
 * De race wordt hierbinnen geforceerd: `tijdensChange` slaat de beheerder op
 * terwijl de agent zijn mutatie al heeft toegepast maar nog niet heeft
 * geschreven. Zonder herhaaltoepassing overschrijft de agent die save.
 */
describe("agentsectie die met een menselijke save botst", () => {
  it("herhaalt de append tegen de nieuwste markdown", async () => {
    const task = await createTaak();
    await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    let gebouwdUit = "";
    const document = await applyWorkDocumentChange({
      taskId: task.id,
      orgId: ORG,
      actorType: "agent",
      actorId: "ollama",
      eventType: "document_section_added",
      eventData: "Datamigratie",
      change: async (current) => {
        if (gebouwdUit === "") {
          gebouwdUit = current;
          await mensSlaatOp(task.id, "# Eisen\n\n- Snel\n", 2);
        }
        return `${current}\n## Datamigratie\n\nIn drie stappen.\n`;
      },
    });

    // De agent is begonnen op de markdown zonder de menselijke save.
    expect(gebouwdUit).toBe("# Eisen\n");

    // Toch staat de menselijke tekst er nog: de append is opnieuw toegepast.
    const read = await getWorkDocument(task.id, ORG);
    expect(read?.markdown).toBe(
      "# Eisen\n\n- Snel\n\n## Datamigratie\n\nIn drie stappen.\n",
    );
    expect(document?.markdown).toBe(read?.markdown);
  });

  it("laat de tekst van de beheerder staan als de agent meerdere keren botst", async () => {
    const task = await createTaak();
    await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    // Drie menselijke saves terwijl de agent zijn sectie bouwt.
    const regels = [
      { markdown: "# Eisen\n\n- Snel\n", version: 2 },
      { markdown: "# Eisen\n\n- Duurzaam\n", version: 3 },
      { markdown: "# Eisen\n\n- Goedkoop\n", version: 4 },
    ];
    let poging = 0;
    await applyWorkDocumentChange({
      taskId: task.id,
      orgId: ORG,
      actorType: "agent",
      actorId: "ollama",
      eventType: "document_section_added",
      eventData: "Datamigratie",
      change: async (current) => {
        if (poging < regels.length) {
          await mensSlaatOp(task.id, regels[poging].markdown, regels[poging].version);
          poging += 1;
        }
        return `${current}\n## Datamigratie\n\nIn drie stappen.\n`;
      },
    });

    // Elke poging is opnieuw toegepast, dus alleen de laatste save is de basis.
    const read = await getWorkDocument(task.id, ORG);
    expect(read?.markdown).toBe(
      "# Eisen\n\n- Goedkoop\n\n## Datamigratie\n\nIn drie stappen.\n",
    );
  });

  it("plakt de agentsectie nog steeds onderaan bij een gewoon append", async () => {
    const task = await createTaak();
    await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    const document = await addWorkDocumentSection({
      taskId: task.id,
      orgId: ORG,
      title: "Datamigratie",
      body: "In drie stappen.",
      actorType: "agent",
      actorId: "ollama",
    });

    expect(document?.markdown).toBe("# Eisen\n\n## Datamigratie\n\nIn drie stappen.\n");
  });
});
