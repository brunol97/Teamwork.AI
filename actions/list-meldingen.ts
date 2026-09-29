import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  countUnreadMeldingen,
  listMeldingen,
} from "../server/collaboration/notifications.js";

export default defineAction({
  description:
    "List the meldingen of the current person in the current organization, newest first, together with the number of unread meldingen.",
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
      meldingen: await listMeldingen(orgId, userEmail),
      ongelezen: await countUnreadMeldingen(orgId, userEmail),
    };
  },
});
