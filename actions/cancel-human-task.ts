import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  buildHerinnering,
  sendHerinnering,
} from "../server/collaboration/herinnering.js";
import {
  cancelHumanTask,
  getHumanTask,
  NotAnOrgMemberError,
  reassignHumanTask,
} from "../server/collaboration/human-tasks.js";
import { canInviteMembers } from "../server/collaboration/membership.js";
import { createTaskEvent, getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Lift an open human task that can no longer be answered: either cancel it (the task goes back to 'bezig' and the question leaves 'Wacht op jou') or hand it to another member with askedUserId (the task keeps waiting, but now for someone who can answer). The lead of the task, a beheerder of the organization, or the person the question was asked to may do this. Use it when an askedUserId turns out to be wrong or unreachable; without it a question with a wrong address blocks the task forever.",
  schema: z.object({
    id: z.string().min(1).describe("Human task id"),
    askedUserId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Hand the question to this other member instead of cancelling it; must be a member of the organization",
      ),
  }),
  run: async ({ id, askedUserId }, ctx) => {
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
    if (humanTask.status !== "open") {
      fail("Deze vraag staat niet meer open.", {
        errorCode: "question_not_open",
        statusCode: 409,
      });
    }

    // Alleen iemand die de taak kan besturen: de lead, een beheerder van de
    // organisatie, of de persoon aan wie de vraag gesteld is — die laat met
    // "opgeven" een vraag vallen die toch al onbeantwoordbaar is. Een
    // willekeurige deelnemer mag een vraag van een ander niet opzij zetten.
    const task = await getTask(humanTask.taskId, orgId);
    const isLead = task?.leadId === userEmail;
    const magOpenheffen =
      isLead ||
      humanTask.askedUserId === userEmail ||
      (await canInviteMembers(orgId, userEmail));
    if (!magOpenheffen) {
      fail(
        "Alleen de lead, een beheerder of de gevraagde persoon kan een open vraag opheffen.",
        { errorCode: "forbidden", statusCode: 403 },
      );
    }

    try {
      if (askedUserId) {
        const overgedragen = await reassignHumanTask({
          id,
          orgId,
          askedUserId,
        });
        if (!overgedragen) {
          fail("Deze vraag staat niet meer open.", {
            errorCode: "question_not_open",
            statusCode: 409,
          });
        }

        await createTaskEvent(
          humanTask.taskId,
          "user",
          userEmail,
          "human_task_reassigned",
          JSON.stringify({
            humanTaskId: humanTask.id,
            question: humanTask.question,
            van: humanTask.askedUserId,
            naar: overgedragen.askedUserId,
          }),
        );

        // De nieuwe gevraagde persoon kent de vraag niet; die hoort dezelfde
        // herinnering als iedereen die tot nu toe werd gevraagd.
        let notified = false;
        if (overgedragen.askedUserId !== userEmail) {
          const resultaat = await sendHerinnering(
            buildHerinnering({
              humanTask: overgedragen,
              taskTitle: task?.title ?? "",
            }),
          );
          notified = resultaat.verzonden;
        }

        return {
          id: overgedragen.id,
          taskId: overgedragen.taskId,
          cancelled: false,
          askedUserId: overgedragen.askedUserId,
          taskStatus: task?.status ?? null,
          notified,
        };
      }

      const geannuleerd = await cancelHumanTask({ id, orgId });
      if (!geannuleerd) {
        fail("Deze vraag staat niet meer open.", {
          errorCode: "question_not_open",
          statusCode: 409,
        });
      }

      await createTaskEvent(
        humanTask.taskId,
        "user",
        userEmail,
        "human_task_cancelled",
        JSON.stringify({
          humanTaskId: humanTask.id,
          question: humanTask.question,
          askedUserId: humanTask.askedUserId,
        }),
      );

      const naAnnuleren = await getTask(humanTask.taskId, orgId);
      return {
        id: geannuleerd.id,
        taskId: geannuleerd.taskId,
        cancelled: true,
        askedUserId: null,
        taskStatus: naAnnuleren?.status ?? null,
        notified: false,
      };
    } catch (error) {
      if (error instanceof NotAnOrgMemberError) {
        fail(error.message, { errorCode: "not_a_member", statusCode: 403 });
      }
      throw error;
    }
  },
});
