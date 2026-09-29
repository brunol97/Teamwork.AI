import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { isFollowingTask } from "../server/collaboration/following.js";
import { getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Check whether the current person follows a task (volgt), so the UI can show the right button. Only returns tasks belonging to the current organization.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
  }),
  http: { method: "GET" },
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

    return { taskId, following: await isFollowingTask(taskId, orgId, userEmail) };
  },
});
