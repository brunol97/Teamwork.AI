import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { listKlanten } from "../server/org/klanten.js";

export default defineAction({
  description:
    "List the klanten (clients) of the current organization, including archived ones (each entry carries 'archived'). Klanten are optional: a project can live directly under the organization or under a klant.",
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

    return { klanten: await listKlanten(orgId) };
  },
});
