import { and, eq } from "@agent-native/core/db/schema";
import { canInviteOrgMembers, orgMembers } from "@agent-native/core/org";

import { getDb } from "../db/client.js";

/** Rol van een persoon binnen één organisatie, of null als diegene geen lid is. */
export type OrgRole = Parameters<typeof canInviteOrgMembers>[0];

/**
 * Leest alleen de rol van de aanroeper uit de frameworktabel `org_members`;
 * deze app schrijft daar nooit in. Zo bepaalt de app wie een beheerder is,
 * zonder de ledenlijst van het framework te dupliceren.
 */
export async function getOrgRole(
  orgId: string,
  email: string,
): Promise<OrgRole> {
  const db = getDb();
  const rows = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.email, email)))
    .limit(1);

  return (rows[0]?.role as OrgRole) ?? null;
}

/** Alleen een beheerder (admin of eigenaar) mag anderen uitnodigen. */
export async function canInviteMembers(
  orgId: string,
  email: string,
): Promise<boolean> {
  return canInviteOrgMembers(await getOrgRole(orgId, email));
}

/**
 * Of iemand lid is van de organisatie. Nodig voor alles wat een persoon iets
 * vraagt: iemand die geen lid is, ziet de organisatie niet en kan dus nooit
 * antwoorden. Dezelfde lookup als `getOrgRole`, want de rol is hier niet nodig.
 */
export async function isOrgMemberOf(
  orgId: string,
  email: string,
): Promise<boolean> {
  return (await getOrgRole(orgId, email)) !== null;
}
