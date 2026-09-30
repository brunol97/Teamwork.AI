import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getOverzicht } from "../server/tasks/overzicht.js";

/**
 * Het overzicht van de organisatie: per project het aantal taken per status
 * (bezig, wacht op iemand, gepauzeerd, klaar) en per taak of hij wacht op de
 * aanroeper. "Wacht op mij" in de UI filtert op `wachtOpMij`, "mijn taken" op
 * `leadId`, en het klantfilter op `klantId` van het project.
 */
export default defineAction({
  description:
    "Overview of the current organization: per project the number of tasks per status ('bezig', 'wacht op iemand', 'gepauzeerd', 'klaar') plus every task with the flags 'wachtOpMij' (an open question from the agent waits on the caller) and 'wachtOpIemand'. Scoped to the caller's organization.",
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

    return getOverzicht(orgId, userEmail);
  },
});
