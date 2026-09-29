import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { revokeTaskInvite } from "../server/collaboration/invites.js";
import { canInviteMembers } from "../server/collaboration/membership.js";

export default defineAction({
  description:
    "Revoke an invitation link (uitnodigingslink) of a task in the current organization. After revoking, the link gives a clear message instead of access.",
  schema: z.object({
    inviteId: z.string().min(1).describe("Id of the invitation link"),
  }),
  run: async ({ inviteId }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    if (!(await canInviteMembers(orgId, userEmail))) {
      fail("Only a beheerder can revoke an invitation link.", {
        errorCode: "forbidden",
        statusCode: 403,
      });
    }

    const invite = await revokeTaskInvite(inviteId, orgId);
    if (!invite) {
      fail("Invitation link not found in this organization.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return { invite };
  },
});
