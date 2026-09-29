import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listUnresumedHumanTasks } from "../server/collaboration/human-tasks.js";

export default defineAction({
  description:
    "List the human tasks whose answer was saved but which the agent never picked up, because the resume after the answer failed. Each one can be picked up again with retry-human-task-resume. With taskId only that task is returned; without it every such question in the organization, newest first.",
  schema: z.object({
    taskId: z.string().min(1).optional().describe("Task id"),
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

    return {
      resumeFailures: await listUnresumedHumanTasks(orgId, taskId),
    };
  },
});
