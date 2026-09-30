import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { createAgent, getAgentByName } from "../server/agents/store.js";
import { AGENT_TEMPLATES } from "../shared/agents/templates.js";

/**
 * Een naam zonder spaties of @-teken, zodat de agent met @naam aangeroepen kan
 * worden en de aanroep niet uit elkaar valt.
 */
const NAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export default defineAction({
  description:
    "Create a new agent for the current organization, from a template or empty. The agent has a name (used for @naam mentions), an Ollama model, tools and skills, and is immediately available in every task of the organization.",
  schema: z.object({
    name: z
      .string()
      .min(1)
      .regex(NAME_PATTERN)
      .describe(
        "Name of the agent, without spaces or @; it is used for @naam mentions",
      ),
    description: z
      .string()
      .default("")
      .describe("What the agent is for, shown in the agent list"),
    model: z
      .string()
      .nullish()
      .describe(
        "Ollama model for this agent; leave out for the default configured model",
      ),
    tools: z
      .array(z.string())
      .default([])
      .describe("Tool names the agent may use; rights never stack"),
    skills: z
      .array(z.string())
      .default([])
      .describe("Skill names the agent works with"),
    template: z
      .string()
      .nullish()
      .describe(
        `Start from a template instead of empty; one of: ${AGENT_TEMPLATES.map((t) => t.id).join(", ")}`,
      ),
  }),
  run: async ({ name, description, model, tools, skills, template }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const bestaand = await getAgentByName(name, orgId);
    if (bestaand) {
      fail("Er bestaat al een agent met deze naam in de organisatie.", {
        errorCode: "name_taken",
        statusCode: 409,
      });
    }

    const sjabloon = template
      ? AGENT_TEMPLATES.find((candidate) => candidate.id === template)
      : undefined;
    if (template && !sjabloon) {
      fail(
        `Onbekend sjabloon "${template}". Kies een van: ${AGENT_TEMPLATES.map((t) => t.id).join(", ")}.`,
        { errorCode: "unknown_template", statusCode: 400 },
      );
    }

    const agent = await createAgent({
      orgId,
      name,
      description: description || sjabloon?.omschrijving || "",
      model: model ?? null,
      tools: tools.length > 0 ? tools : (sjabloon?.tools ?? []),
      skills: skills.length > 0 ? skills : (sjabloon?.skills ?? []),
      template: sjabloon ? sjabloon.id : (template ?? "leeg"),
      createdBy: userEmail,
    });

    return { agent };
  },
});
