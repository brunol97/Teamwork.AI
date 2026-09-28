import { describe, expect, it } from "vitest";

import updateWorkDocumentAction from "../../actions/update-work-document.js";
import {
  addWorkDocumentSection,
  getWorkDocument,
  saveWorkDocument,
  WorkDocumentConflictError,
} from "../../server/documents/store.js";
import { createTask } from "../../server/tasks/store.js";

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Gelijktijdig bewerken",
  });
}

describe("gelijktijdig bewerken van het werkdocument", () => {
  it("verhoogt de versie bij elke schrijfactie", async () => {
    const task = await createTaak("org-concurrentie");

    const first = await saveWorkDocument({
      taskId: task.id,
      orgId: "org-concurrentie",
      markdown: "# Eerste\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });
    const second = await saveWorkDocument({
      taskId: task.id,
      orgId: "org-concurrentie",
      markdown: "# Eerste\n\n# Tweede\n",
      actorType: "user",
      actorId: "beheerder@example.com",
      expectedVersion: first.version,
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect((await getWorkDocument(task.id, "org-concurrentie"))?.version).toBe(2);
  });

  it("weigert een schrijfactie op een verouderde versie", async () => {
    const task = await createTaak("org-concurrentie");
    const start = await saveWorkDocument({
      taskId: task.id,
      orgId: "org-concurrentie",
      markdown: "# Gezamenlijk\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    // De tweede persoon bewerkt op basis van dezelfde versie.
    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-concurrentie",
      markdown: "# Gezamenlijk\n\nVan de tweede persoon\n",
      actorType: "user",
      actorId: "tweede@example.com",
      expectedVersion: start.version,
    });

    await expect(
      saveWorkDocument({
        taskId: task.id,
        orgId: "org-concurrentie",
        markdown: "# Gezamenlijk\n\nVan de eerste persoon\n",
        actorType: "user",
        actorId: "beheerder@example.com",
        expectedVersion: start.version,
      }),
    ).rejects.toBeInstanceOf(WorkDocumentConflictError);

    // De wijziging van de tweede persoon staat er nog.
    const read = await getWorkDocument(task.id, "org-concurrentie");
    expect(read?.markdown).toBe("# Gezamenlijk\n\nVan de tweede persoon\n");
    expect(read?.version).toBe(2);
  });

  it("laat een sectie van de agent toe zonder de versie op te geven", async () => {
    const task = await createTaak("org-concurrentie");
    const saved = await saveWorkDocument({
      taskId: task.id,
      orgId: "org-concurrentie",
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    const document = await addWorkDocumentSection({
      taskId: task.id,
      orgId: "org-concurrentie",
      title: "Datamigratie",
      body: "In drie stappen.",
      actorType: "agent",
      actorId: "ollama",
    });

    expect(document?.markdown).toBe("# Eisen\n\n## Datamigratie\n\nIn drie stappen.\n");
    expect(document?.version).toBeGreaterThan(saved.version);
  });

  it("meldt het conflict via de action met een Nederlandse melding", async () => {
    const task = await createTaak("org-concurrentie");
    const start = await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Gezamenlijk\n" },
      {
        caller: "frontend",
        userEmail: "beheerder@example.com",
        orgId: "org-concurrentie",
      } as any,
    );

    await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Van de tweede persoon\n", expectedVersion: start.version },
      {
        caller: "frontend",
        userEmail: "tweede@example.com",
        orgId: "org-concurrentie",
      } as any,
    );

    await expect(
      updateWorkDocumentAction.run(
        { taskId: task.id, markdown: "# Van de eerste persoon\n", expectedVersion: start.version },
        {
          caller: "frontend",
          userEmail: "beheerder@example.com",
          orgId: "org-concurrentie",
        } as any,
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "conflict",
      statusCode: 409,
    });
  });
});
