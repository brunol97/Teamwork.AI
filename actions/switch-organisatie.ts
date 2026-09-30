import { defineAction, fail } from "@agent-native/core/action";
import { isOrgMember, setActiveOrgId } from "@agent-native/core/org";
import { z } from "zod";

import { getOrgKind } from "../server/org/store.js";

/**
 * Wisselen van organisatie. Alleen naar een organisatie waar de aanroeper echt
 * lid van is: het lidmaatschap wordt bij het framework gecontroleerd
 * (`isOrgMember`), en het actief zetten gaat via de frameworkfunctie
 * `setActiveOrgId` — de enige weg naar de actieve-organisatieinstelling.
 */
export default defineAction({
  description:
    "Switch the active organization. Refused unless the caller is a member of the target organization, checked against the framework's own membership list; the app never grants membership. Returns the new active organization with its soort ('persoonlijk' or 'team').",
  schema: z.object({
    orgId: z.string().min(1).describe("Id of the organization to switch to"),
  }),
  run: async ({ orgId }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) {
      fail("You must be signed in to switch organizations.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    if (!(await isOrgMember(orgId, userEmail))) {
      fail(
        "Je bent geen lid van die organisatie, dus je kunt er niet naar wisselen.",
        { errorCode: "not_a_member", statusCode: 403 },
      );
    }

    await setActiveOrgId(userEmail, orgId, "wissel-organisatie");

    const soort = await getOrgKind(orgId);
    return {
      organizationId: orgId,
      soort: soort.isPersonal ? "persoonlijk" : "team",
    };
  },
});
