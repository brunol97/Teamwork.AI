import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { archiveKlant } from "../server/org/klanten.js";

/** Een gearchiveerde klant verdwijnt nergens uit het verleden; zijn projecten blijven leesbaar. */
export default defineAction({
  description:
    "Archive a klant (client) of the current organization. The klant stays readable and his projects keep working; the overzicht marks him '(gearchiveerd)'.",
  schema: z.object({
    id: z.string().min(1).describe("Id of the klant"),
  }),
  run: async ({ id }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const klant = await archiveKlant(id, orgId);
    if (!klant) {
      fail("Klant not found.", { errorCode: "not_found", statusCode: 404 });
    }
    return klant;
  },
});
