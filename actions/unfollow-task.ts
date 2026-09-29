import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  isFollowingTask,
  unfollowTask,
} from "../server/collaboration/following.js";

export default defineAction({
  description:
    "Stop following a task, so the person no longer receives meldingen about it.",
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

    const unfollowed = await unfollowTask({ taskId, orgId, userId: userEmail });
    if (!unfollowed) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    return {
      taskId,
      following: await isFollowingTask(taskId, orgId, userEmail),
    };
  },
});
