import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getSkill } from "../server/skills/store.js";
import { listProposalsForSkill } from "../server/skills/proposals.js";

export default defineAction({
  description:
    "Read one skill with its full version history: every version stays preserved and readable, including the ones that are no longer active. The active version is the one agents use. Also lists the proposals made for this skill, newest first.",
  schema: z.object({
    id: z.string().min(1).describe("Skill id"),
  }),
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const gevonden = await getSkill(id, orgId);
    if (!gevonden) {
      fail("Skill not found.", { errorCode: "not_found", statusCode: 404 });
    }

    return {
      skill: gevonden.skill,
      versions: gevonden.versions,
      proposals: await listProposalsForSkill(id, orgId),
    };
  },
});
