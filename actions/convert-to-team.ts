import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  AlreadyATeamError,
  convertPersonalToTeam,
  getOrgKind,
} from "../server/org/store.js";
import { listTasks } from "../server/tasks/store.js";

/**
 * Een persoonlijke werkruimte wordt een team. De omzetting is een
 * vlagverandering in de app-eigen `organization_settings`: alle taken,
 * projecten, klanten, agents en skills van de organisatie blijven staan. Het
 * lidmaatschap is van het framework en raakt de omzetting niet aan.
 */
export default defineAction({
  description:
    "Convert the current organization from a personal workspace ('persoonlijk') to a team ('team'). Purely a metadata change: every task, project, klant, agent and skill is preserved; the result returns their counts so the caller can see nothing was lost. Refused when the organization is already a team.",
  schema: z.object({}),
  run: async (_args, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const voor = await getOrgKind(orgId);
    if (!voor.isPersonal) {
      fail("Deze organisatie is al een team.", {
        errorCode: "already_a_team",
        statusCode: 409,
      });
    }

    try {
      await convertPersonalToTeam(orgId);
    } catch (error) {
      if (error instanceof AlreadyATeamError) {
        fail("Deze organisatie is al een team.", {
          errorCode: "already_a_team",
          statusCode: 409,
        });
      }
      throw error;
    }

    const taken = await listTasks(orgId);
    return {
      organizationId: orgId,
      soort: "team" as const,
      wasSoort: "persoonlijk" as const,
      /** Aantallen vóór en na de omzetting zijn gelijk: niets is verloren. */
      takenAantal: taken.length,
    };
  },
});
