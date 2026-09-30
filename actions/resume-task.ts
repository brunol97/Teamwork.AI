import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  createTaskEvent,
  getTask,
  setTaskStatus,
  TASK_STATUS_PAUSED,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Resume a paused task ('hervatten'). Every member of the organization may resume; the task goes back to 'bezig' and accepts agent messages again. The next agent turn carries the full context: the complete conversation plus the overdrachtsnotitie, so the agent knows what was agreed at the pause. Refused when the task is not paused.",
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

    if (task.status !== TASK_STATUS_PAUSED) {
      fail(
        `De taak is niet gepauzeerd (status: "${task.status}"), dus er is niets te hervatten.`,
        { errorCode: "not_paused", statusCode: 409 },
      );
    }

    // Hervatten is de enige weg terug uit de pauze: de status gaat naar
    // "bezig", waarmee de pauze en haar reden uit de actuele toestand verdwijnen
    // (de reden blijft wel leesbaar in het activiteitenlog).
    const gezet = await setTaskStatus(taskId, orgId, "bezig");
    if (!gezet) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    await createTaskEvent(
      taskId,
      "user",
      userEmail,
      "task_hervat",
      `De taak is hervat door ${userEmail}; iedereen in de organisatie mag dat.`,
    );

    return { taskId, status: "bezig", hervatDoor: userEmail };
  },
});
