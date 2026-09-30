import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  buildHerinnering,
  sendHerinnering,
} from "../server/collaboration/herinnering.js";
import {
  createHumanTask,
  InvalidHumanTaskError,
  NotAnOrgMemberError,
  OpenHumanTaskExistsError,
} from "../server/collaboration/human-tasks.js";
import { findKnownAnswer } from "../server/collaboration/known-answer.js";
import {
  getTask,
  TASK_STATUS_PAUSED,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Ask a specific person a decision question with options and pause the task until they answer ('human task'). The question must state what the agent wants, why it needs the answer, and at least two options. The person must be a member of the organization; an address that is not a member is refused, because nobody could answer it. The agent is expected to call this only after searching the werkdocument and earlier answers in the project; when the answer is already known there, this action reports that instead of asking again. The question appears in the person's 'Wacht op jou' list on the task list and the task page, and they get an email reminder; it is not a melding, because a melding needs no answer while this question pauses the task. If a question turns out to be unanswerable, cancel-human-task lifts it.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    askedUserId: z
      .string()
      .min(1)
      .describe(
        "Email address of the person who must decide; must be a member of the organization, otherwise nobody can answer",
      ),
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
    const userEmail = ctx?.userEmail;
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

    // Een gepauzeerde taak accepteert geen nieuwe vragen: de pauze zou anders
    // stilletjes door de wachtstatus worden vervangen en bij het antwoord
    // verloren gaan. Hervat eerst de taak (resume-task).
    if (task.status === TASK_STATUS_PAUSED) {
      fail(
        "De taak is gepauzeerd; er kan geen vraag worden gesteld zolang de pauze duurt.",
        { errorCode: "task_gepauzeerd", statusCode: 409 },
      );
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
        notified: false,
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

      // De gevraagde persoon woont niet per definitie in de app. Een
      // herinnering is het enige signaal dat buiten "Wacht op jou" komt; de
      // vraag zelf blijft daar staan, ook als de mail niet vertrekt. Wie zelf
      // vraagt zit al in de app en krijgt dus geen mail over zijn eigen vraag.
      let notified = false;
      if (humanTask && askedUserId.trim() !== userEmail) {
        const resultaat = await sendHerinnering(
          buildHerinnering({ humanTask, taskTitle: task.title }),
        );
        notified = resultaat.verzonden;
      }

      return { taskId, asked: true, knownAnswer: null, humanTask, notified };
    } catch (error) {
      if (error instanceof InvalidHumanTaskError) {
        fail(error.message, {
          errorCode: "invalid_question",
          statusCode: 400,
        });
      }
      if (error instanceof NotAnOrgMemberError) {
        fail(error.message, { errorCode: "not_a_member", statusCode: 403 });
      }
      if (error instanceof OpenHumanTaskExistsError) {
        fail(error.message, {
          errorCode: "question_already_open",
          statusCode: 409,
        });
      }
      throw error;
    }
  },
});
