import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resumeAgentAfterAnswer } from "../server/collaboration/agent-resume.js";
import {
  answerHumanTask,
  getHumanTask,
} from "../server/collaboration/human-tasks.js";
import { createTaskEvent, getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Answer an open human task of the current person with one of the options (or free text). The task leaves the waiting status and the agent resumes from the stored question and answer, also after a restart of the server.",
  schema: z.object({
    id: z.string().min(1).describe("Human task id"),
    answer: z
      .string()
      .min(1)
      .describe("The chosen option, or a free-text answer"),
  }),
  run: async ({ id, answer }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    // Bestaat de vraag niet binnen deze organisatie, dan lekt er niets.
    const humanTask = await getHumanTask(id, orgId);
    if (!humanTask) {
      fail("Vraag niet gevonden.", { errorCode: "not_found", statusCode: 404 });
    }
    if (humanTask.status !== "open") {
      fail("Deze vraag is al beantwoord.", {
        errorCode: "already_answered",
        statusCode: 409,
      });
    }
    if (humanTask.askedUserId !== userEmail) {
      fail("Deze vraag is aan iemand anders gesteld.", {
        errorCode: "not_asked_person",
        statusCode: 403,
      });
    }

    const answered = await answerHumanTask({ id, orgId, answer });
    if (!answered) {
      fail("Deze vraag is al beantwoord.", {
        errorCode: "already_answered",
        statusCode: 409,
      });
    }

    const task = await getTask(answered.taskId, orgId);
    await createTaskEvent(
      answered.taskId,
      "user",
      userEmail,
      "human_task_answered",
      JSON.stringify({ question: answered.question, answer }),
    );

    const agentMessage = await resumeAgentAfterAnswer({
      humanTask: answered,
      orgId,
    });

    return {
      id: answered.id,
      taskId: answered.taskId,
      answer: answered.answer,
      taskStatus: task?.status ?? null,
      agentMessage,
    };
  },
});
