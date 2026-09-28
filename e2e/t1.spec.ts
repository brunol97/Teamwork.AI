import { expect, test } from "@playwright/test";

test("T1: create a task and chat with the Ollama agent", async ({ request, page }) => {
  // Wait for the dev auto-account to be ready by polling the task list action.
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  // Create a project and task.
  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Project", taskTitle: "E2E Taak" },
  });
  expect(createResponse.status()).toBe(200);
  const task = await createResponse.json();
  expect(task.title).toBe("E2E Taak");
  expect(task.status).toBe("bezig");
  expect(task.projectName).toBe("E2E Project");

  // Fetch the task and verify it belongs to the caller's organization.
  const getResponse = await request.get(
    `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
  );
  expect(getResponse.status()).toBe(200);
  const { task: fetchedTask, events: initialEvents } = await getResponse.json();
  expect(fetchedTask.id).toBe(task.id);
  expect(initialEvents).toHaveLength(0);

  // Send a message to the Ollama agent.
  const messageResponse = await request.post("/_agent-native/actions/send-task-message", {
    data: { taskId: task.id, message: "Hoi agent" },
  });
  expect(messageResponse.status()).toBe(200);
  const messageResult = await messageResponse.json();
  expect(messageResult.userMessage).toBe("Hoi agent");
  expect(messageResult.agentMessage).toBe(
    "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
  );

  // Verify both messages are in the activity log.
  const logResponse = await request.get(
    `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
  );
  expect(logResponse.status()).toBe(200);
  const { events } = await logResponse.json();
  expect(events).toHaveLength(2);
  expect(events[0].actorType).toBe("user");
  expect(events[0].data).toBe("Hoi agent");
  expect(events[1].actorType).toBe("agent");
  expect(events[1].data).toBe(
    "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
  );

  // The task list and task detail pages should render successfully.
  const tasksPage = await page.goto("/tasks");
  expect(tasksPage?.status()).toBe(200);
  const taskPage = await page.goto(`/tasks/${encodeURIComponent(task.id)}`);
  expect(taskPage?.status()).toBe(200);
});
