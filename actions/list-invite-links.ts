import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listTaskInvites } from "../server/collaboration/invites.js";
import { canInviteMembers } from "../server/collaboration/membership.js";

export default defineAction({
  description:
    "List the invitation links (uitnodigingslinks) of a task in the current organization, including whether each link is still geldig, verlopen or ingetrokken.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
  }),
  http: { method: "GET" },
  run: async ({ taskId }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    if (!(await canInviteMembers(orgId, userEmail))) {
      fail("Only a beheerder can see the invitation links of a task.", {
        errorCode: "forbidden",
        statusCode: 403,
      });
    }

    return { links: await listTaskInvites(taskId, orgId) };
  },
});
