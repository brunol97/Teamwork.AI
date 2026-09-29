import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resumeAgentAfterAnswer } from "../server/collaboration/agent-resume.js";
import {
  getHumanTask,
  markHumanTaskResumed,
} from "../server/collaboration/human-tasks.js";
import { canInviteMembers } from "../server/collaboration/membership.js";
import { createTaskEvent, getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Start the agent's resume again for a human task whose answer was saved but whose resume failed. The answer is already durable; without this action the agent would never pick it up, because nothing in the app retries on its own. The lead, a beheerder, or the person who answered may do this. Returns resumeFailed: true when the attempt fails again.",
  schema: z.object({
    id: z.string().min(1).describe("Human task id"),
  }),
  run: async ({ id }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const humanTask = await getHumanTask(id, orgId);
    if (!humanTask) {
      fail("Vraag niet gevonden.", { errorCode: "not_found", statusCode: 404 });
    }
    if (humanTask.status !== "answered") {
      fail("Deze vraag heeft nog geen antwoord.", {
        errorCode: "not_answered",
        statusCode: 409,
      });
    }
    if (humanTask.resumedAt) {
      fail("De agent heeft dit antwoord al opgepakt.", {
        errorCode: "already_resumed",
        statusCode: 409,
      });
    }

    const task = await getTask(humanTask.taskId, orgId);
    const magHervatten =
      task?.leadId === userEmail ||
      humanTask.askedUserId === userEmail ||
      (await canInviteMembers(orgId, userEmail));
    if (!magHervatten) {
      fail(
        "Alleen de lead, een beheerder of de antwoordende persoon kan dit.",
        {
          errorCode: "forbidden",
          statusCode: 403,
        },
      );
    }

    try {
      const agentMessage = await resumeAgentAfterAnswer({ humanTask, orgId });
      await markHumanTaskResumed({ id: humanTask.id, orgId });
      await createTaskEvent(
        humanTask.taskId,
        "system",
        "agent",
        "human_task_resume_retried",
        JSON.stringify({
          humanTaskId: humanTask.id,
          question: humanTask.question,
          answer: humanTask.answer,
        }),
      );
      return {
        id: humanTask.id,
        taskId: humanTask.taskId,
        agentMessage,
        resumeFailed: false,
      };
    } catch (error) {
      // Het antwoord staat al in de database; alleen de hervat faalt opnieuw. We
      // loggen dat en geven alsnog terug wat er gebeurde, zodat de mens het
      // opnieuw kan proberen in plaats van op een fout te blijven hangen.
      const reden = error instanceof Error ? error.message : String(error);
      console.error("hervat van de agent opnieuw mislukt:", reden);
      await createTaskEvent(
        humanTask.taskId,
        "system",
        "agent",
        "human_task_resume_failed",
        JSON.stringify({
          humanTaskId: humanTask.id,
          question: humanTask.question,
          answer: humanTask.answer,
          reason: reden,
          opnieuw: true,
        }),
      );
      return {
        id: humanTask.id,
        taskId: humanTask.taskId,
        agentMessage: "",
        resumeFailed: true,
      };
    }
  },
});
