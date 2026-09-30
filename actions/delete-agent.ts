import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { deleteAgent } from "../server/agents/store.js";

export default defineAction({
  description:
    "Delete an agent of the current organization. Tasks that had it as their actieve agent fall back to the default agent.",
  schema: z.object({
    id: z.string().min(1).describe("Agent id"),
  }),
  run: async ({ id }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const deleted = await deleteAgent(id, orgId);
    if (!deleted) {
      fail("Agent not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return { deleted: true };
  },
});
