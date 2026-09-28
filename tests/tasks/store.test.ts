import { describe, expect, it } from "vitest";

import { getDb } from "../../server/db/client.js";
import { projects, taskEvents, tasks } from "../../server/db/schema.js";
import {
  createTask,
  createTaskEvent,
  getTask,
  listTaskEvents,
  listTasks,
} from "../../server/tasks/store.js";

describe("tasks store", () => {
  it("creates a project and task with status bezig", async () => {
    const task = await createTask({
      orgId: "org-a",
      leadId: "user@example.com",
      projectName: "Website",
      taskTitle: "Ontwerp homepage",
    });

    expect(task.title).toBe("Ontwerp homepage");
    expect(task.status).toBe("bezig");
    expect(task.leadId).toBe("user@example.com");
    expect(task.projectName).toBe("Website");
    expect(task.organizationId).toBe("org-a");
    expect(task.projectId).toBeDefined();
  });

  it("lists only tasks for the requested organization", async () => {
    await createTask({
      orgId: "org-a",
      leadId: "user-a@example.com",
      projectName: "Project A",
      taskTitle: "Taak A",
    });
    await createTask({
      orgId: "org-b",
      leadId: "user-b@example.com",
      projectName: "Project B",
      taskTitle: "Taak B",
    });

    const orgATasks = await listTasks("org-a");
    expect(orgATasks.length).toBeGreaterThanOrEqual(1);
    expect(orgATasks.every((t) => t.organizationId === "org-a")).toBe(true);
    expect(orgATasks.find((t) => t.title === "Taak B")).toBeUndefined();
  });

  it("returns undefined when getting a task from another organization", async () => {
    const task = await createTask({
      orgId: "org-a",
      leadId: "user@example.com",
      projectName: "Project",
      taskTitle: "Taak",
    });

    const fromOtherOrg = await getTask(task.id, "org-b");
    expect(fromOtherOrg).toBeUndefined();

    const fromSameOrg = await getTask(task.id, "org-a");
    expect(fromSameOrg).toBeDefined();
  });

  it("records user and agent messages in the activity log", async () => {
    const task = await createTask({
      orgId: "org-a",
      leadId: "user@example.com",
      projectName: "Project",
      taskTitle: "Taak",
    });

    await createTaskEvent(task.id, "user", "user@example.com", "message", "Hoi");
    await createTaskEvent(task.id, "agent", "ollama", "message", "Hallo!");

    const events = await listTaskEvents(task.id, "org-a");
    expect(events).toHaveLength(2);
    expect(events[0].actorType).toBe("user");
    expect(events[0].data).toBe("Hoi");
    expect(events[1].actorType).toBe("agent");
    expect(events[1].data).toBe("Hallo!");
  });

  it("does not leak events when task belongs to another organization", async () => {
    const task = await createTask({
      orgId: "org-a",
      leadId: "user@example.com",
      projectName: "Project",
      taskTitle: "Taak",
    });
    await createTaskEvent(task.id, "user", "user@example.com", "message", "Hoi");

    const events = await listTaskEvents(task.id, "org-b");
    expect(events).toHaveLength(0);
  });
});
