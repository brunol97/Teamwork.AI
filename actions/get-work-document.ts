import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getWorkDocument } from "../server/documents/store.js";

export default defineAction({
  description:
    "Read the werkdocument of a task as markdown. Returns the markdown of the task, empty when the task has no werkdocument yet. Only returns tasks belonging to the current organization.",
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

    const document = await getWorkDocument(taskId, orgId);
    if (!document) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return document;
  },
});
