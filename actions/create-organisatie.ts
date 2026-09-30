import { defineAction, fail } from "@agent-native/core/action";
import { createOrganization } from "@agent-native/core/org";
import { z } from "zod";

import { setOrgKind } from "../server/org/store.js";

/**
 * Onboarding: een nieuwe gebruiker kiest tussen een persoonlijke werkruimte en
 * een team. Beide zijn een Organisatie — het verschil is alleen de soort die
 * de app vastlegt in `organization_settings` — en worden via het framework
 * aangemaakt, zodat de ledenlijst (`org_members`) van het framework blijft.
 * Derde keuze van de onboarding is deelnemen via een uitnodigingslink; die
 * loopt via get-invite-link en accept-invite-link.
 */
export default defineAction({
  description:
    "Create a new organization from the onboarding choice screen: 'persoonlijk' (personal workspace, one member) or 'team'. The organization and the membership are created by the framework itself (the app never writes org_members); the new organization becomes the active one. Returns the organization id and its soort.",
  schema: z.object({
    soort: z
      .enum(["persoonlijk", "team"])
      .describe("Soort organisatie: 'persoonlijk' or 'team'"),
    naam: z
      .string()
      .min(1)
      .optional()
      .describe("Name of the organization; defaults to 'Mijn organisatie'"),
  }),
  run: async ({ soort, naam }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) {
      fail("You must be signed in to create an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    // Het framework maakt de organisatie en het lidmaatschap aan en maakt de
    // nieuwe organisatie meteen actief.
    const org = await createOrganization(
      naam?.trim() || "Mijn organisatie",
      userEmail,
      "owner",
    );

    await setOrgKind(org.id, soort === "persoonlijk");

    return {
      organizationId: org.id,
      naam: org.name,
      soort,
    };
  },
});
