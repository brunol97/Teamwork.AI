import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { generateOllamaResponse } from "../server/llm/ollama.js";
import {
  createTaskEvent,
  getTask,
  listTaskEvents,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Send a message in a task and let the Ollama agent respond. Both messages are recorded in the activity log.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    message: z.string().min(1).describe("Message to send to the agent"),
  }),
  run: async ({ taskId, message }, ctx) => {
    const userEmail = ctx?.userEmail;
    const orgId = ctx?.orgId;
    if (!userEmail || !orgId) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const task = await getTask(taskId, orgId);
    if (!task) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    await createTaskEvent(taskId, "user", userEmail, "message", message);

    const history = await listTaskEvents(taskId, orgId);
    const messages = history
      .filter((event) => event.type === "message" && event.data)
      .map((event) => ({
        role:
          event.actorType === "agent" ? ("assistant" as const) : ("user" as const),
        content: event.data ?? "",
      }));

    const systemPrompt = `Je bent een behulpzame agent in Agent Office. Je werkt mee aan de taak "${task.title}". Reageer in het Nederlands tenzij de gebruiker anders vraagt. Houd antwoorden kort en bondig.`;

    const response = await generateOllamaResponse(systemPrompt, messages);

    await createTaskEvent(taskId, "agent", "ollama", "message", response);

    return {
      taskId,
      userMessage: message,
      agentMessage: response,
    };
  },
});
