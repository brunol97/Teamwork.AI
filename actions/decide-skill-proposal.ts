import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  NotSkillOwnerError,
  decideSkillProposal,
  type Besluit,
} from "../server/skills/proposals.js";

export default defineAction({
  description:
    "Decide a skill proposal: only the owner of the skill can. 'goedkeuren' makes the proposed content the new active version (the old version stays preserved); pass 'content' to approve an edited version ('aanpassen'). 'afwijzen' leaves the active version as it is. The proposal disappears from 'Wacht op jou' either way.",
  schema: z.object({
    id: z.string().min(1).describe("Skill proposal id"),
    besluit: z
      .enum(["goedkeuren", "afwijzen"])
      .describe("The decision: 'goedkeuren' or 'afwijzen'"),
    content: z
      .string()
      .optional()
      .describe(
        "Edited content to approve instead of the proposed content ('aanpassen'); only used with 'goedkeuren'",
      ),
  }),
  run: async ({ id, besluit, content }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    try {
      const beslissing = await decideSkillProposal({
        id,
        orgId,
        decidedBy: userEmail,
        besluit: besluit as Besluit,
        content,
      });
      if (!beslissing) {
        fail("Voorstel niet gevonden.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      return beslissing;
    } catch (error) {
      if (error instanceof NotSkillOwnerError) {
        fail(error.message, {
          errorCode: "not_the_owner",
          statusCode: 403,
        });
      }
      throw error;
    }
  },
});
