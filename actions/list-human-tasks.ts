import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listOpenHumanTasks } from "../server/collaboration/human-tasks.js";
import { listOpenProposalsForOwner } from "../server/skills/proposals.js";

export default defineAction({
  description:
    "List what waits on the current person in the current organization ('Wacht op jou'), newest first: the open human tasks the agent asked them (each with what, why and the options), and the open skill proposals for the skills they own (each with the explanation and the diff). A skill proposal is not a human task: it does not pause a task, but the owner must decide it here — goedkeuren, aanpassen or afwijzen via decide-skill-proposal.",
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

    return {
      humanTasks: await listOpenHumanTasks(orgId, userEmail),
      skillProposals: await listOpenProposalsForOwner(orgId, userEmail),
    };
  },
});
