import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  DuplicateSkillNameError,
  EmptySkillContentError,
  createSkill,
} from "../server/skills/store.js";

export default defineAction({
  description:
    "Create a skill ('Skill'): a reusable recipe in SKILL.md format, owned by the creator (a member of the organization). The content is the full SKILL.md and becomes version 1; later versions only appear when the owner approves a proposal. Agents reference a skill by name in their skills list and use the active version at call time.",
  schema: z.object({
    name: z.string().min(1).describe("Name of the skill, as agents reference it"),
    content: z
      .string()
      .min(1)
      .describe("The full SKILL.md content; becomes version 1"),
    description: z
      .string()
      .optional()
      .describe("Short description of what the skill is for"),
  }),
  run: async ({ name, content, description }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    try {
      const skill = await createSkill({
        orgId,
        name,
        description,
        content,
        ownerId: userEmail,
      });
      return { skill };
    } catch (error) {
      if (error instanceof DuplicateSkillNameError) {
        fail(error.message, {
          errorCode: "duplicate_name",
          statusCode: 409,
        });
      }
      if (error instanceof EmptySkillContentError) {
        fail(error.message, {
          errorCode: "invalid_skill",
          statusCode: 400,
        });
      }
      throw error;
    }
  },
});
