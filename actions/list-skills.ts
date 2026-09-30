import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listSkills } from "../server/skills/store.js";

export default defineAction({
  description:
    "List the skills of the organization, each with its active version and content. Agents reference a skill by name; the content shown is the active version, which changes when the owner approves a proposal.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      return { skills: [] };
    }

    return { skills: await listSkills(orgId) };
  },
});
