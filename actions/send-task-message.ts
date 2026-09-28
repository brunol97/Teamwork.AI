import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { parseSectionRequest } from "../server/documents/markdown.js";
import { addWorkDocumentSection } from "../server/documents/store.js";
import { notifyTaskFollowers } from "../server/collaboration/notifications.js";
import { generateOllamaResponse } from "../server/llm/ollama.js";
import {
  createTaskEvent,
  getTask,
  listTaskEvents,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Send a message in a task and let the Ollama agent respond. Both messages are recorded in the activity log, and every volger of the task gets a melding. When the user asks for a section ('schrijf een sectie over X'), the agent's answer is also added to the werkdocument of the task as a new section.",
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

    // Volgers van de taak krijgen een melding; die vraagt geen antwoord.
    await notifyTaskFollowers({
      taskId,
      orgId,
      title: `Antwoord van de agent in ${task.title}`,
      body: response,
    });

    const sectionRequest = parseSectionRequest(message);
    let documentSection: { title: string } | null = null;
    if (sectionRequest) {
      await addWorkDocumentSection({
        taskId,
        orgId,
        title: sectionRequest.title,
        body: response,
        actorType: "agent",
        actorId: "ollama",
      });
      documentSection = { title: sectionRequest.title };
    }

    return {
      taskId,
      userMessage: message,
      agentMessage: response,
      documentSection,
    };
  },
});
