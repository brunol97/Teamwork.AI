import { describe, expect, it, vi } from "vitest";

import sendTaskMessageAction from "../actions/send-task-message.js";
import { createTask } from "../server/tasks/store.js";

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
