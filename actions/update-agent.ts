import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getAgent, getAgentByName, updateAgent } from "../server/agents/store.js";

const NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export default defineAction({
  description:
    "Update an agent of the current organization: name, description, Ollama model, tools, skills, or whether it is ingeschakeld (enabled). A disabled agent gets no turns and is never called. Only pass the fields you want to change.",
  schema: z.object({
    id: z.string().min(1).describe("Agent id"),
    name: z
      .string()
      .regex(NAME_PATTERN)
      .nullish()
      .describe("New name without spaces or @, used for @naam mentions"),
    description: z.string().nullish().describe("New description"),
    model: z
      .string()
      .nullish()
      .describe("New Ollama model; empty for the default configured model"),
    tools: z
      .array(z.string())
      .nullish()
      .describe("New tool list; an agent only ever gets its own tools"),
    skills: z.array(z.string()).nullish().describe("New skill list"),
    enabled: z
      .boolean()
      .nullish()
      .describe("Whether the agent is ingeschakeld and may take turns"),
  }),
  run: async ({ id, name, description, model, tools, skills, enabled }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    if (name !== undefined && name !== null) {
      const bestaand = await getAgentByName(name, orgId);
      if (bestaand && bestaand.id !== id) {
        fail("Er bestaat al een agent met deze naam in de organisatie.", {
          errorCode: "name_taken",
          statusCode: 409,
        });
      }
    }

    const agent = await updateAgent(id, orgId, {
      name: name ?? undefined,
      description: description ?? undefined,
      model: model ?? undefined,
      tools: tools ?? undefined,
      skills: skills ?? undefined,
      enabled: enabled ?? undefined,
    });
    if (!agent) {
      fail("Agent not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return { agent };
  },
});
