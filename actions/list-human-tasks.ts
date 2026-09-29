import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listOpenHumanTasks } from "../server/collaboration/human-tasks.js";

export default defineAction({
  description:
    "List the open human tasks ('Wacht op jou') asked to the current person in the current organization, newest first. Each question shows what the agent wants, why, and the options.",
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

    return { humanTasks: await listOpenHumanTasks(orgId, userEmail) };
  },
});
