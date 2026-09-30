import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canInviteMembers } from "../server/collaboration/membership.js";
import { listAllTaskInvites } from "../server/collaboration/invites.js";

/**
 * Beheer van uitnodigingen: alle uitnodigingslinks van de organisatie, met de
 * toestand (geldig, verlopen, ingetrokken) en de taak waar ze naar verwijzen.
 * Alleen een beheerder ziet dit: het is het overzicht dat de per-taak-links
 * van create-invite-link samenneemt.
 */
export default defineAction({
  description:
    "List every invitation link of the current organization (newest first), each with its state ('geldig', 'verlopen' or 'ingetrokken'), the invited email and the task it leads to. Beheerder-only; revoke a link with revoke-invite-link.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    if (!(await canInviteMembers(orgId, userEmail))) {
      fail("Alleen een beheerder ziet de uitnodigingslinks.", {
        errorCode: "forbidden",
        statusCode: 403,
      });
    }

    return { links: await listAllTaskInvites(orgId) };
  },
});
