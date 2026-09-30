import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";
import { orgMembers } from "@agent-native/core/org";
import { eq } from "@agent-native/core/db/schema";

import { getDb } from "../server/db/client.js";

export default defineAction({
  description:
    "List the members of the current organization, read from the framework's own org_members table (the app never writes memberships). Used to pick a colleague to transfer a task to.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const rows = await getDb()
      .select({ email: orgMembers.email, role: orgMembers.role })
      .from(orgMembers)
      .where(eq(orgMembers.orgId, orgId));

    return {
      members: rows.sort((a, b) => a.email.localeCompare(b.email)),
    };
  },
});
