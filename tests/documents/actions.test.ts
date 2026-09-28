import { describe, expect, it } from "vitest";

import addWorkDocumentSectionAction from "../../actions/add-work-document-section.js";
import getWorkDocumentAction from "../../actions/get-work-document.js";
import updateWorkDocumentAction from "../../actions/update-work-document.js";
import { createTask } from "../../server/tasks/store.js";

const ctxForOrg = (orgId: string) =>
  ({
    caller: "frontend",
    userEmail: "gebruiker@example.com",
    orgId,
  }) as any;

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: "gebruiker@example.com",
    projectName: "Project",
    taskTitle: "Taak",
  });
}

describe("werkdocument actions", () => {
  it("returns the document as markdown", async () => {
    const task = await createTaak("org-actions");

    const empty = await getWorkDocumentAction.run(
      { taskId: task.id },
      ctxForOrg("org-actions"),
    );
    expect(empty).toEqual({ taskId: task.id, markdown: "", version: 0, updatedAt: 0 });

    await updateWorkDocumentAction.run(
      { taskId: task.id, markdown: "# Eisen\n\n- Snelheid\n" },
      ctxForOrg("org-actions"),
    );

    const document = await getWorkDocumentAction.run(
      { taskId: task.id },
      ctxForOrg("org-actions"),
    );
    expect(document.markdown).toBe("# Eisen\n\n- Snelheid\n");
  });

  it("adds a section through the agent action", async () => {
    const task = await createTaak("org-actions");

    const result = await addWorkDocumentSectionAction.run(
      { taskId: task.id, title: "Datamigratie", body: "Stap 1: back-up maken." },
      ctxForOrg("org-actions"),
    );

    expect(result.markdown).toBe(
      "## Datamigratie\n\nStap 1: back-up maken.\n",
    );
  });

  it("fails with not found for a task of another organization", async () => {
    const task = await createTaak("org-actions");
    const foreignCtx = ctxForOrg("org-other");

    await expect(
      getWorkDocumentAction.run({ taskId: task.id }, foreignCtx),
    ).rejects.toThrow("Task not found.");
    await expect(
      updateWorkDocumentAction.run(
        { taskId: task.id, markdown: "# Verkeerd\n" },
        foreignCtx,
      ),
    ).rejects.toThrow("Task not found.");
    await expect(
      addWorkDocumentSectionAction.run(
        { taskId: task.id, title: "Verkeerd", body: "Niet opgeslagen." },
        foreignCtx,
      ),
    ).rejects.toThrow("Task not found.");

    const document = await getWorkDocumentAction.run(
      { taskId: task.id },
      ctxForOrg("org-actions"),
    );
    expect(document.markdown).toBe("");
  });
});
