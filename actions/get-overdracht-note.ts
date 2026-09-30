import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getOverdrachtNote } from "../server/collaboration/overdracht.js";

export default defineAction({
  description:
    "Read the overdrachtsnotitie (handover note) of a task: the open draft while there is one, otherwise the most recently finalized note. A draft is editable with update-overdracht-note; a finalized note is immutable and lives in the activity log.",
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

    const note = await getOverdrachtNote(taskId, orgId);
    return { taskId, note: note ?? null };
  },
});
