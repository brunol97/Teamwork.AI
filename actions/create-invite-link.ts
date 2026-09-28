import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canInviteMembers } from "../server/collaboration/membership.js";
import {
  createTaskInvite,
  listTaskInvites,
} from "../server/collaboration/invites.js";

export default defineAction({
  description:
    "Create an invitation link (uitnodigingslink) for a task in the current organization and return the existing links of that task. A beheerder shares the link; the second person becomes a member of the organization without a choice screen. Revoke a link with revoke-invite-link.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    expiresInHours: z
      .number()
      .int()
      .min(0)
      .max(24 * 90)
      .optional()
      .describe("Hours the link stays valid, default 72"),
    invitedEmail: z
      .string()
      .email()
      .optional()
      .describe("Optional email of the invited person, only kept as a note"),
  }),
  run: async ({ taskId, expiresInHours, invitedEmail }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    if (!(await canInviteMembers(orgId, userEmail))) {
      fail("Only a beheerder can create an invitation link.", {
        errorCode: "forbidden",
        statusCode: 403,
      });
    }

    const invite = await createTaskInvite({
      orgId,
      taskId,
      createdBy: userEmail,
      invitedEmail: invitedEmail ?? null,
      expiresInHours,
    });
    if (!invite) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    return { invite, links: await listTaskInvites(taskId, orgId) };
  },
});
