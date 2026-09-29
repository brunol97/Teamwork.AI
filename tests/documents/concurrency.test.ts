import { describe, expect, it } from "vitest";

import updateWorkDocumentAction from "../../actions/update-work-document.js";
import {
  addWorkDocumentSection,
  getWorkDocument,
  saveWorkDocument,
  WorkDocumentConflictError,
} from "../../server/documents/store.js";
import { createTask } from "../../server/tasks/store.js";

const ORG = "org-concurrentie";

async function createTaak() {
  return createTask({
    orgId: ORG,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Gelijktijdig bewerken",
  });
}

describe("gelijktijdig bewerken van het werkdocument", () => {
  it("verhoogt de versie bij elke schrijfactie", async () => {
    const task = await createTaak();

    const first = await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Eerste\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });
    const second = await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Eerste\n\n## Tweede\n",
      actorType: "user",
      actorId: "beheerder@example.com",
      expectedVersion: first.version,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await getWorkDocument(task.id, ORG))?.version).toBe(2);
  });

  it("weigert een schrijfactie op een verouderde versie en bewaart de tekst van de ander", async () => {
    const task = await createTaak();
    const start = await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Gezamenlijk\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    // De agent voegt een sectie toe terwijl de beheerder de pagina open heeft.
    await addWorkDocumentSection({
      taskId: task.id,
      orgId: ORG,
      title: "Datamigratie",
      body: "In drie stappen.",
      actorType: "agent",
      actorId: "ollama",
    });

    // De beheerder bewaart de versie die hij geladen heeft.
    await expect(
      saveWorkDocument({
        taskId: task.id,
        orgId: ORG,
        markdown: "# Gezamenlijk\n\nVan de beheerder\n",
        actorType: "user",
        actorId: "beheerder@example.com",
        expectedVersion: start.version,
      }),
    ).rejects.toBeInstanceOf(WorkDocumentConflictError);

    // De wijziging van de tweede bewerker staat er nog.
    const read = await getWorkDocument(task.id, ORG);
    expect(read?.markdown).toContain("## Datamigratie");
    expect(read?.markdown).not.toContain("Van de beheerder");
    expect(read?.version).toBe(2);
  });

  it("laat een sectie van de agent toe zonder de versie op te geven", async () => {
    const task = await createTaak();
    const saved = await saveWorkDocument({
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
    expect(document?.version).toBeGreaterThan(saved.version);
  });

  it("meldt het conflict via de action met errorCode conflict", async () => {
    const task = await createTaak();
    const ctx = {
      caller: "frontend",
      userEmail: "beheerder@example.com",
      orgId: ORG,
    } as any;

    const start = await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Gezamenlijk\n" },
      ctx,
    );

    await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Gezamenlijk\n\n- Snel\n", expectedVersion: start.version },
      { ...ctx, userEmail: "tweede@example.com" },
    );

    await expect(
      updateWorkDocumentAction.run(
        { taskId: task.id, markdown: "# Gezamenlijk\n\n- Goedkoop\n", expectedVersion: start.version },
        ctx,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "conflict",
      statusCode: 409,
    });

    const read = await getWorkDocument(task.id, ORG);
    expect(read?.markdown).toBe("# Gezamenlijk\n\n- Snel\n");
  });
});
