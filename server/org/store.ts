import { eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { organizationSettings } from "../db/schema.js";

/**
 * App-eigen metadata van een organisatie. De ledenlijst en de organisatierij
 * zelf zijn van het framework; hier staat alleen hoe de app de organisatie
 * presenteert: als persoonlijke werkruimte (isPersonal = 1) of als team.
 *
 * Zonder rij geldt: persoonlijke werkruimte. Een organisatie die het framework
 * zelf aanmaakt (bij de eerste aanmelding) heeft immers precies één lid en
 * geen team-opzet gekozen.
 */
export interface OrgSoort {
  organizationId: string;
  isPersonal: boolean;
}

export async function getOrgKind(orgId: string): Promise<OrgSoort> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: organizationSettings.organizationId, isPersonal: organizationSettings.isPersonal })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  return { organizationId: orgId, isPersonal: rows[0] ? rows[0].isPersonal === 1 : true };
}

/** Zet de soort van de organisatie; een nieuwe rij krijgt direct de juiste vlag. */
export async function setOrgKind(
  orgId: string,
  isPersonal: boolean,
): Promise<OrgSoort> {
  const db = getDb();
  const now = Date.now();
  const existing = await db
    .select({ id: organizationSettings.id })
    .from(organizationSettings)
    .where(eq(organizationSettings.organizationId, orgId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(organizationSettings)
      .set({ isPersonal: isPersonal ? 1 : 0, updatedAt: now })
      .where(eq(organizationSettings.organizationId, orgId));
  } else {
    await db.insert(organizationSettings).values({
      id: randomUUID(),
      organizationId: orgId,
      isPersonal: isPersonal ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { organizationId: orgId, isPersonal };
}

export class AlreadyATeamError extends Error {
  constructor() {
    super("Deze organisatie is al een team.");
    this.name = "AlreadyATeamError";
  }
}

/**
 * Zet een persoonlijke werkruimte om naar een team. Dat is een vlagverandering:
 * taken, projecten, klanten, agents en skills blijven precies staan. Een team
 * kan niet terug naar persoonlijk — tegenovergestelde richting is hier niet
 * gebouwd, want een team heeft leden en die worden geen "gebruik van één".
 */
export async function convertPersonalToTeam(orgId: string): Promise<OrgSoort> {
  const huidig = await getOrgKind(orgId);
  if (!huidig.isPersonal) {
    throw new AlreadyATeamError();
  }
  return setOrgKind(orgId, false);
}
