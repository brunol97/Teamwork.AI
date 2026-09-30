import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  ensureOpenNote,
} from "../server/collaboration/overdracht.js";
import {
  createTaskEvent,
  getTask,
  setTaskStatus,
  TASK_STATUS_PAUSED,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Pause a task ('pauzeren') as the lead. The task stops accepting agent messages; everyone in the organization can resume it with resume-task. A draft overdrachtsnotitie (handover note) is drafted automatically from the task data and stays editable until the task is transferred; the note lives in get-overdracht-note and update-overdracht-note. Only the lead may pause, and only while the task is 'bezig'.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
  }),
  run: async ({ taskId }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const task = await getTask(taskId, orgId);
    if (!task) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    if (task.leadId !== userEmail) {
      fail(
        "Alleen de lead kan de taak pauzeren.",
        { errorCode: "not_the_lead", statusCode: 403 },
      );
    }

    if (task.status === TASK_STATUS_PAUSED) {
      fail(
        "De taak is al gepauzeerd. Iedereen in de organisatie kan de taak hervatten.",
        { errorCode: "already_paused", statusCode: 409 },
      );
    }
    if (task.status !== "bezig") {
      fail(
        `Een taak met status "${task.status}" kan niet worden gepauzeerd.`,
        { errorCode: "invalid_status", statusCode: 409 },
      );
    }

    // Er ontstaat een automatisch opgesteld, aanpasbaar concept van de
    // overdrachtsnotitie. Bestond er al een open concept, dan blijft diens
    // (mogelijk aangepaste) inhoud staan.
    const notitie = await ensureOpenNote({
      taskId,
      orgId,
      kind: "pauze",
      createdBy: userEmail,
    });
    if (!notitie) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    const gezet = await setTaskStatus(taskId, orgId, TASK_STATUS_PAUSED);
    if (!gezet) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    await createTaskEvent(
      taskId,
      "user",
      userEmail,
      "task_paused",
      "De taak is gepauzeerd door de lead.",
    );

    return { taskId, status: TASK_STATUS_PAUSED, notitie };
  },
});
