import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWorkDocument,
  saveWorkDocument,
} from "../../server/documents/store.js";
import { createTask, listTaskEvents } from "../../server/tasks/store.js";

// De activity-log insert is de tweede helft van dezelfde schrijfactie. Als die
// mislukt, mag het werkdocument niet zijn veranderd.
const taskEventsFailure = vi.hoisted(() => ({ active: false }));

vi.mock("../../server/tasks/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/tasks/store.js")>();
  return {
    ...actual,
    createTaskEvent: async (...args: Parameters<typeof actual.createTaskEvent>) => {
      if (taskEventsFailure.active) {
        throw new Error("task_events insert failed");
      }
      return actual.createTaskEvent(...args);
    },
  };
});

const ORG = "org-transactie";

async function createTaak() {
  return createTask({
    orgId: ORG,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Transactie",
  });
}

describe("werkdocument en activity log in één transactie", () => {
  beforeEach(() => {
    taskEventsFailure.active = false;
  });

  it("logt de wijziging als de event insert slaagt", async () => {
    const task = await createTaak();

    await saveWorkDocument({
      taskId: task.id,
      orgId: ORG,
      markdown: "# Eisen\n",
      actorType: "user",
      actorId: "beheerder@example.com",
    });

    expect((await getWorkDocument(task.id, ORG))?.markdown).toBe("# Eisen\n");
    expect((await listTaskEvents(task.id, ORG)).map((event) => event.type)).toEqual([
      "document_changed",
    ]);
  });

  it("laat het werkdocument onveranderd wanneer de event insert mislukt", async () => {
    const task = await createTaak();
    taskEventsFailure.active = true;

    await expect(
      saveWorkDocument({
        taskId: task.id,
        orgId: ORG,
        markdown: "# Eisen\n",
        actorType: "user",
        actorId: "beheerder@example.com",
      }),
    ).rejects.toThrow("task_events insert failed");

    expect(await getWorkDocument(task.id, ORG)).toEqual({
      taskId: task.id,
      markdown: "",
      version: 0,
      updatedAt: 0,
    });
    expect(await listTaskEvents(task.id, ORG)).toEqual([]);
  });
});
