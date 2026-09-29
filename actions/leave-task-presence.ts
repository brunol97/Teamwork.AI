import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { clearTaskPresence } from "../server/collaboration/presence.js";

export default defineAction({
  description:
    "Stop reporting presence for this client when the task page is closed, so the person disappears from the aanwezig list of the task.",
  schema: z.object({
    clientId: z
      .string()
      .min(1)
      .describe("Id of this tab or device, the same one used for set-task-presence"),
  }),
  run: async ({ clientId }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId || !ctx?.userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    // Alleen binnen de eigen organisatie: een clientId van een andere
    // organisatie is niet van deze aanroeper om te wissen.
    await clearTaskPresence(clientId, orgId);
    return { clientId };
  },
});
