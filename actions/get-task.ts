import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listTaskDeelnemers } from "../server/tasks/deelnemers.js";
import { getTask, listTaskEvents } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Get a single task by id, including its activity log and its deelnemers (the lead plus everyone who contributed according to the activity log). Only returns tasks belonging to the current organization.",
  schema: z.object({
    id: z.string().min(1).describe("Task id"),
  }),
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const task = await getTask(id, orgId);
    if (!task) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const events = await listTaskEvents(id, orgId);
    return { task, events, deelnemers: await listTaskDeelnemers(id, orgId) };
  },
});
