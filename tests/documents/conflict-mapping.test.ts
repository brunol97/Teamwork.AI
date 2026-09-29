import { describe, expect, it, vi } from "vitest";

import addWorkDocumentSectionAction from "../../actions/add-work-document-section.js";
import sendTaskMessageAction from "../../actions/send-task-message.js";
import updateWorkDocumentAction from "../../actions/update-work-document.js";

// De agent-sectie volgt de actuele versie en herhaalt zichzelf, dus een conflict
// is lastig te forceren via de database. We dwingen hem daarom af op de plek
// waar hij ontstaat: de store gooit de conflict-fout, en elke actie moet die
// als 409 melden in plaats van als ongemapte 500.
const conflict = vi.hoisted(() => ({ active: false }));

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: async () => "Dit is een geautomatiseerd testantwoord.",
}));

vi.mock("../../server/documents/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/documents/store.js")>();
  return {
    ...actual,
    addWorkDocumentSection: async (...args: Parameters<typeof actual.addWorkDocumentSection>) => {
      if (conflict.active) {
        throw new actual.WorkDocumentConflictError(7);
      }
      return actual.addWorkDocumentSection(...args);
    },
  };
});

const ORG = "org-conflict-actions";
const BEHEERDER = "beheerder@conflict.test";

const ctx = (userEmail: string) =>
  ({ caller: "frontend", userEmail, orgId: ORG }) as any;

async function createTaak() {
  const { createTask } = await import("../../server/tasks/store.js");
  return createTask({
    orgId: ORG,
    leadId: BEHEERDER,
    projectName: "Project",
    taskTitle: "Conflict",
  });
}

describe("conflict wordt als conflict gemeld, niet als 500", () => {
  it("geeft 409 conflict bij add-work-document-section", async () => {
    const task = await createTaak();
    conflict.active = true;

    await expect(
      addWorkDocumentSectionAction.run(
        { taskId: task.id, title: "Datamigratie", body: "In drie stappen." },
        ctx(BEHEERDER),
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "conflict",
      statusCode: 409,
    });
    conflict.active = false;
  });

  it("geeft 409 conflict bij send-task-message, niet een ongemapte 500", async () => {
    const task = await createTaak();
    conflict.active = true;

    await expect(
      sendTaskMessageAction.run(
        { taskId: task.id, message: "Schrijf een sectie over datamigratie" },
        ctx(BEHEERDER),
      ),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "conflict",
      statusCode: 409,
    });
    conflict.active = false;
  });

  it("geeft 409 conflict bij update-work-document", async () => {
    const task = await createTaak();
    const start = await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Eisen\n" },
      ctx(BEHEERDER),
    );
    await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Ander\n", expectedVersion: start.version },
      ctx(BEHEERDER),
    );

    await expect(
      updateWorkDocumentAction.run(
        { taskId: task.id, markdown: "# Nogmaals\n", expectedVersion: start.version },
        ctx(BEHEERDER),
      ),
    ).rejects.toMatchObject({ errorCode: "conflict", statusCode: 409 });
  });
});
