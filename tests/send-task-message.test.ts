import { describe, expect, it, vi } from "vitest";

import sendTaskMessageAction from "../actions/send-task-message.js";
import { getWorkDocument } from "../server/documents/store.js";
import { createTask, listTaskEvents } from "../server/tasks/store.js";

vi.mock("../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi.fn().mockResolvedValue("Dit is een testantwoord."),
}));

describe("send-task-message action", () => {
  it("records the user message and the agent response", async () => {
    const task = await createTask({
      orgId: "org-msg",
      leadId: "user@example.com",
      projectName: "Project",
      taskTitle: "Taak",
    });

    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: "Hoi agent" },
      {
        caller: "frontend",
        userEmail: "user@example.com",
        orgId: "org-msg",
      } as any,
    );

    expect(result.taskId).toBe(task.id);
    expect(result.userMessage).toBe("Hoi agent");
    expect(result.agentMessage).toBe("Dit is een testantwoord.");
    expect(result.documentSection).toBeNull();
  });

  it("adds a requested section to the werkdocument and logs it", async () => {
    const task = await createTask({
      orgId: "org-msg",
      leadId: "user@example.com",
      projectName: "Project",
      taskTitle: "Taak",
    });

    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: "Schrijf een sectie over datamigratie" },
      {
        caller: "frontend",
        userEmail: "user@example.com",
        orgId: "org-msg",
      } as any,
    );

    expect(result.documentSection).toEqual({ title: "Datamigratie" });

    const document = await getWorkDocument(task.id, "org-msg");
    expect(document?.markdown).toBe(
      "## Datamigratie\n\nDit is een testantwoord.\n",
    );

    const events = await listTaskEvents(task.id, "org-msg");
    expect(events.map((event) => event.type)).toEqual([
      "message",
      "message",
      "document_section_added",
    ]);
    expect(events[2].actorType).toBe("agent");
    expect(events[2].data).toBe("Datamigratie");
  });

  it("rejects tasks from another organization", async () => {
    const task = await createTask({
      orgId: "org-msg",
      leadId: "user@example.com",
      projectName: "Project",
      taskTitle: "Taak",
    });

    await expect(
      sendTaskMessageAction.run(
        { taskId: task.id, message: "Hoi" },
        {
          caller: "frontend",
          userEmail: "other@example.com",
          orgId: "org-other",
        } as any,
      ),
    ).rejects.toThrow("Task not found.");
  });
});
