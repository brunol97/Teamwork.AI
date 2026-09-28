import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { clearTaskPresence, touchTaskPresence } from "../server/collaboration/presence.js";
import { getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Report that this client (tab or device) is looking at a task right now, so other people in the task see the presence. Call it on opening a task and again every few seconds. Use leave-task-presence when the task page is closed.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    clientId: z
      .string()
      .min(1)
      .describe("Id of this tab or device, stable while the page is open"),
  }),
  run: async ({ taskId, clientId }, ctx) => {
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

    await touchTaskPresence({ taskId, userId: userEmail, clientId });
    return { taskId, clientId, lastSeenAt: Date.now() };
  },
});
