import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { createMelding } from "../server/collaboration/notifications.js";
import {
  createHumanTask,
  InvalidHumanTaskError,
} from "../server/collaboration/human-tasks.js";
import { findKnownAnswer } from "../server/collaboration/known-answer.js";
import { getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Ask a specific person a decision question with options and pause the task until they answer ('human task'). The question must state what the agent wants, why it needs the answer, and at least two options. The agent is expected to call this only after searching the werkdocument and earlier answers in the project; when the answer is already known there, this action reports that instead of asking again. The question appears in the person's 'Wacht op jou' list and as a melding.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    askedUserId: z
      .string()
      .min(1)
      .describe("Email address of the person who must decide"),
    question: z
      .string()
      .min(1)
      .describe("What the agent wants to know (wat)"),
    reason: z
      .string()
      .min(1)
      .describe("Why the agent needs this answer (waarom); required"),
    options: z
      .array(z.string().min(1))
      .min(2)
      .describe("At least two options the person can choose from"),
  }),
  run: async ({ taskId, askedUserId, question, reason, options }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const task = await getTask(taskId, orgId);
    if (!task) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    // Eerst zoeken, dan pas vragen: staat het antwoord al in het werkdocument of
    // in een eerder antwoord binnen het project, dan vraagt de agent niet.
    const known = await findKnownAnswer({ taskId, orgId, question, options });
    if (known) {
      return {
        taskId,
        asked: false,
        knownAnswer: known,
        humanTask: null,
      };
    }

    try {
      const humanTask = await createHumanTask({
        taskId,
        orgId,
        askedUserId,
        question,
        reason,
        options,
      });

      // Dezelfde aanpak als T3: de vraag gaat als melding naar de persoon, met
      // alle drie de velden in de tekst.
      await createMelding({
        taskId,
        orgId,
        recipientId: askedUserId,
        title: `De agent vraagt een beslissing in ${task.title}`,
        body: [
          `Wat: ${humanTask?.question ?? question}`,
          `Waarom: ${humanTask?.reason ?? reason}`,
          `Opties: ${(humanTask?.options ?? options).join(", ")}`,
        ].join("\n"),
      });

      return { taskId, asked: true, knownAnswer: null, humanTask };
    } catch (error) {
      if (error instanceof InvalidHumanTaskError) {
        fail(error.message, {
          errorCode: "invalid_question",
          statusCode: 400,
        });
      }
      throw error;
    }
  },
});
