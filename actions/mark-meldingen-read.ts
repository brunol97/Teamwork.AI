import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { markMeldingenRead } from "../server/collaboration/notifications.js";

export default defineAction({
  description:
    "Mark meldingen of the current person as read, either all of them or only those of one task.",
  schema: z.object({
    taskId: z
      .string()
      .min(1)
      .optional()
      .describe("Only mark the meldingen of this task as read"),
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

    return { gelezen: await markMeldingenRead({ orgId, recipientId: userEmail, taskId }) };
  },
});
