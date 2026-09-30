import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { parseSectionRequest } from "../server/documents/markdown.js";
import {
  addWorkDocumentSection,
  getWorkDocument,
  WorkDocumentConflictError,
} from "../server/documents/store.js";
import {
  extractRequirements,
  parsePlannedSlices,
  parseSliceRequest,
  planSlicesFromRequirements,
} from "../server/documents/slices.js";
import { writeTracerSlices } from "../server/documents/slice-store.js";
import { notifyTaskFollowers } from "../server/collaboration/notifications.js";
import { generateOllamaResponse } from "../server/llm/ollama.js";
import {
  createTaskEvent,
  getTask,
  listTaskEvents,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Send a message in a task and let the Ollama agent respond. Both messages are recorded in the activity log, and every volger of the task gets a melding. When the user asks for a section ('schrijf een sectie over X'), the agent's answer is also added to the werkdocument of the task as a new section. When the user asks for tracer-slices ('maak tracer-slices'), the slice planner answers with slices in the fixed template and adds them as a Tracer-slices section to the werkdocument, referencing only requirements that exist in the document.",
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

    const sliceRequest = parseSliceRequest(message);
    const sectionRequest = sliceRequest ? null : parseSectionRequest(message);
    let documentSection: { title: string } | null = null;

    if (sliceRequest) {
      documentSection = await planTracerSlices({
        taskId,
        orgId,
        response,
      }).catch((error) => {
        if (error instanceof WorkDocumentConflictError) {
          fail(error.message, {
            errorCode: "conflict",
            statusCode: 409,
            details: { currentVersion: error.currentVersion },
          });
        }
        throw error;
      });
    } else if (sectionRequest) {
      // De agent schrijft zijn sectie zonder versie mee te geven en probeert
      // het opnieuw bij een conflict. Lukt het na die pogingen niet, dan is dat
      // geen 500 maar een conflict: het antwoord van de agent staat al in de
      // activity log en blijft daar staan.
      try {
        await addWorkDocumentSection({
          taskId,
          orgId,
          title: sectionRequest.title,
          body: response,
          actorType: "agent",
          actorId: "ollama",
        });
        documentSection = { title: sectionRequest.title };
      } catch (error) {
        if (!(error instanceof WorkDocumentConflictError)) {
          throw error;
        }
        fail(error.message, {
          errorCode: "conflict",
          statusCode: 409,
          details: { currentVersion: error.currentVersion },
        });
      }
    }

    return {
      taskId,
      userMessage: message,
      agentMessage: response,
      documentSection,
    };
  },
});

/**
 * De slice-planner: zet het antwoord van de agent om naar tracer-slices in het
 * vaste sjabloon en plaatst ze als Tracer-slices-sectie in het werkdocument.
 * Slices die een veld missen of naar een onbekende requirement verwijzen,
 * vallen af; levert dat geen enkele bruikbare slice op, dan valt de planner
 * terug op één slice per requirement uit het werkdocument, zodat er altijd
 * een bruikbare planning ontstaat uit de eisen die er staan.
 */
async function planTracerSlices({
  taskId,
  orgId,
  response,
}: {
  taskId: string;
  orgId: string;
  response: string;
}): Promise<{ title: string } | null> {
  const document = await getWorkDocument(taskId, orgId);
  if (!document) {
    return null;
  }

  const requirementTitles = extractRequirements(document.markdown).map(
    (requirement) => requirement.title,
  );
  const planned = parsePlannedSlices(response, requirementTitles);
  const slices = planned.length > 0 ? planned : planSlicesFromRequirements(document.markdown);
  if (slices.length === 0) {
    return null;
  }

  await writeTracerSlices({
    taskId,
    orgId,
    slices,
    actorType: "agent",
    actorId: "ollama",
    eventType: "document_section_added",
    eventData: "Tracer-slices",
  });

  return { title: "Tracer-slices" };
}
