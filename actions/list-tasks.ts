import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listTasks } from "../server/tasks/store.js";

export default defineAction({
  description: "List all tasks in the current organization.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    return listTasks(orgId);
  },
});
