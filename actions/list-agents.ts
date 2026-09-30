import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listAgents } from "../server/agents/store.js";

export default defineAction({
  description:
    "List the agents of the current organization. Every agent is available in every task of the organization and can be called with @naam.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    return { agents: await listAgents(orgId) };
  },
});
