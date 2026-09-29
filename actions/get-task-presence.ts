import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listActivePresence } from "../server/collaboration/presence.js";
import { getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "List who is looking at a task right now (aanwezig), per client. Only returns tasks belonging to the current organization.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
  }),
  http: { method: "GET" },
  run: async ({ taskId }, ctx) => {
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

    const participants = await listActivePresence(taskId, orgId);
    return { taskId, participants };
  },
});
