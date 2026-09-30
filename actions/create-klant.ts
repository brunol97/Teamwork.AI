import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { createKlant } from "../server/org/klanten.js";

/** Klanten zijn optioneel: een project staat direct onder de organisatie of onder een klant. */
export default defineAction({
  description:
    "Create a klant (client) in the current organization. Klanten are optional: a project can live directly under the organization or under a klant. Returns the created klant.",
  schema: z.object({
    naam: z.string().min(1).describe("Name of the klant"),
  }),
  run: async ({ naam }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    return createKlant(orgId, naam.trim());
  },
});
