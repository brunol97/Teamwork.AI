import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { organizations, orgMembers } from "@agent-native/core/org";
import { z } from "zod";

import { getDb } from "../server/db/client.js";
import { getOrgKind } from "../server/org/store.js";

/**
 * De organisaties waar de aanroeper lid van is, alleen lezend uit de
 * ledenlijst van het framework (`org_members`); de app schrijft daar nooit in
 * — dezelfde aanpak als list-org-members. Met de soort uit de app-eigen
 * metadata kan de wisselaar een persoonlijke werkruimte van een team
 * onderscheiden.
 */
export default defineAction({
  description:
    "List the organizations the current user is a member of, read from the framework's own membership list (the app never writes memberships). Each entry carries the organization id, name, the caller's role and the app's soort ('persoonlijk' or 'team'). Used by the organization switcher and the onboarding flow.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) {
      fail("You must be signed in to list your organizations.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const rows = await getDb()
      .select({
        organizationId: orgMembers.orgId,
        naam: organizations.name,
        rol: orgMembers.role,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(eq(orgMembers.email, userEmail));

    const organisaties = await Promise.all(
      rows.map(async (row) => {
        const soort = await getOrgKind(row.organizationId);
        return {
          organizationId: row.organizationId,
          naam: row.naam,
          rol: row.rol,
          soort: soort.isPersonal ? ("persoonlijk" as const) : ("team" as const),
        };
      }),
    );
    organisaties.sort((a, b) => a.naam.localeCompare(b.naam));

    return {
      /** De actieve organisatie, zoals het framework hem bepaalt. */
      actieveOrganisatieId: ctx?.orgId ?? null,
      organisaties,
    };
  },
});
