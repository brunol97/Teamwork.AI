import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getAgent } from "../server/agents/store.js";

export default defineAction({
  description:
    "Read one agent of the current organization, including its name, description, Ollama model, tools and skills.",
  schema: z.object({
    id: z.string().min(1).describe("Agent id"),
  }),
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const agent = await getAgent(id, orgId);
    if (!agent) {
      fail("Agent not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return { agent };
  },
});
