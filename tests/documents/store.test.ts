import { describe, expect, it } from "vitest";

import {
  addWorkDocumentSection,
  getWorkDocument,
  saveWorkDocument,
} from "../../server/documents/store.js";
import { createTask, listTaskEvents } from "../../server/tasks/store.js";

async function createTaak(orgId: string, taskTitle = "Taak") {
  return createTask({
    orgId,
    leadId: "user@example.com",
    projectName: "Project",
    taskTitle,
  });
}

describe("werkdocument store", () => {
  it("starts empty and stores markdown the user typed", async () => {
    const task = await createTaak("org-doc");

    const empty = await getWorkDocument(task.id, "org-doc");
    expect(empty).toEqual({ taskId: task.id, markdown: "", version: 0, updatedAt: 0 });

    const saved = await saveWorkDocument({
      taskId: task.id,
      orgId: "org-doc",
      markdown: "# Eisen\n\n- Snelheid\n",
      actorType: "user",
      actorId: "user@example.com",
    });

    expect(saved.markdown).toBe("# Eisen\n\n- Snelheid\n");
    const read = await getWorkDocument(task.id, "org-doc");
    expect(read?.markdown).toBe("# Eisen\n\n- Snelheid\n");
  });

  it("logs a change in the activity log", async () => {
    const task = await createTaak("org-doc");

    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-doc",
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "user@example.com",
    });

    const events = await listTaskEvents(task.id, "org-doc");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("document_changed");
    expect(events[0].actorType).toBe("user");
    expect(events[0].actorId).toBe("user@example.com");
  });

  it("appends a section and logs it with the section title", async () => {
    const task = await createTaak("org-doc");
    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-doc",
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "user@example.com",
    });

    const document = await addWorkDocumentSection({
      taskId: task.id,
      orgId: "org-doc",
      title: "Datamigratie",
      body: "Stap 1: back-up maken.",
      actorType: "agent",
      actorId: "ollama",
    });

    expect(document?.markdown).toBe(
      "# Eisen\n\n## Datamigratie\n\nStap 1: back-up maken.\n",
    );

    const events = await listTaskEvents(task.id, "org-doc");
    expect(events.map((event) => event.type)).toEqual([
      "document_changed",
      "document_section_added",
    ]);
    expect(events[1].actorType).toBe("agent");
    expect(events[1].data).toBe("Datamigratie");
  });

  it("does not read a document of another organization", async () => {
    const task = await createTaak("org-doc");
    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-doc",
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "user@example.com",
    });

    expect(await getWorkDocument(task.id, "org-other")).toBeUndefined();
  });

  it("refuses writes to a task of another organization", async () => {
    const task = await createTaak("org-doc");

    const saved = await saveWorkDocument({
      taskId: task.id,
      orgId: "org-other",
      markdown: "# Verkeerd\n",
      actorType: "user",
      actorId: "mallory@example.com",
    });
    expect(saved).toBeUndefined();

    const appended = await addWorkDocumentSection({
      taskId: task.id,
      orgId: "org-other",
      title: "Verkeerd",
      body: "Niet opgeslagen.",
      actorType: "agent",
      actorId: "ollama",
    });
    expect(appended).toBeUndefined();

    expect(await getWorkDocument(task.id, "org-doc")).toEqual({
      taskId: task.id,
      markdown: "",
      version: 0,
      updatedAt: 0,
    });
    expect(await listTaskEvents(task.id, "org-other")).toEqual([]);
  });
});
