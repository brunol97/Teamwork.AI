import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { followTask, isFollowingTask } from "../server/collaboration/following.js";

export default defineAction({
  description:
    "Follow a task (volgen) so the person receives meldingen about it. Returns whether the person is following the task afterwards.",
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

    const followed = await followTask({ taskId, orgId, userId: userEmail });
    if (!followed) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    return { taskId, following: await isFollowingTask(taskId, orgId, userEmail) };
  },
});
