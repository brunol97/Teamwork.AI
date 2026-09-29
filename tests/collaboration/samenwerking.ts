import { randomUUID } from "node:crypto";

import {
  acceptPendingInvitationsForEmail,
  createOrganization,
  orgInvitations,
} from "@agent-native/core/org";

import { getDb } from "../../server/db/client.js";
import { createTask, type TaskWithProject } from "../../server/tasks/store.js";

/**
 * Een echte organisatie met echte leden.
 *
 * Vraagt de agent iemand iets, dan moet die persoon lid zijn van de
 * organisatie; anders kan niemand antwoorden en blijft de taak wachten. De
 * tests kunnen dus niet meer met een willekeurige `randomUUID()` als orgId
 * werken: daar bestaan geen leden en elke vraag zou met `not_a_member` worden
 * geweigerd. Deze helpers maken de organisatie via het framework aan, zodat
 * `org_members` gevuld is.
 *
 * Elk adres is uniek per organisatie. Een vast adres zou via
 * `acceptPendingInvitationsForEmail` in alle organisaties van dezelfde testrun
 * terechtkomen, en dan is een test die een niet-lid nodig heeft niet meer te
 * maken.
 */
export interface Samenwerking {
  orgId: string;
  /** De lead van de taak; eigenaar van de organisatie. */
  lead: string;
  /** De tweede persoon; een gewoon lid. */
  collega: string;
  task: TaskWithProject;
}

function uniekAdres(naam: string): string {
  return `${naam}-${randomUUID().slice(0, 8)}@samenwerking.test`;
}

/** Maakt een organisatie met één lead en één extra lid; beide zijn echt lid. */
export async function createOrganisatieMetLeden(): Promise<{
  orgId: string;
  lead: string;
  collega: string;
}> {
  const lead = uniekAdres("lead");
  const collega = uniekAdres("collega");
  const org = await createOrganization(`Samenwerking ${randomUUID()}`, lead);

  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId: org.id,
    email: collega,
    invitedBy: lead,
    createdAt: Date.now(),
    status: "pending",
    role: "member",
    appRolesJson: null,
  });
  await acceptPendingInvitationsForEmail(collega);

  return { orgId: org.id, lead, collega };
}

/** Voegt een tweede (of derde) lid toe aan een bestaande organisatie. */
export async function voegLidToe(
  orgId: string,
  gevraagdDoor: string,
): Promise<string> {
  const adres = uniekAdres("extra");
  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId,
    email: adres,
    invitedBy: gevraagdDoor,
    createdAt: Date.now(),
    status: "pending",
    role: "member",
    appRolesJson: null,
  });
  await acceptPendingInvitationsForEmail(adres);
  return adres;
}

export async function createTaak(
  orgId: string,
  lead: string,
  taskTitle = "Datamigratie",
): Promise<TaskWithProject> {
  return createTask({
    orgId,
    leadId: lead,
    projectName: "Project",
    taskTitle,
  });
}

/** Een organisatie met twee leden en één taak; het uitgangspunt van elke test. */
export async function createSamenwerking(
  taskTitle = "Datamigratie",
): Promise<Samenwerking> {
  const { orgId, lead, collega } = await createOrganisatieMetLeden();
  const task = await createTaak(orgId, lead, taskTitle);
  return { orgId, lead, collega, task };
}

/** De context van een aanroeper, zoals de UI en de agent hem doorgeven. */
export function ctxVoor(
  orgId: string,
  userEmail: string,
): { caller: string; userEmail: string; orgId: string } {
  return { caller: "frontend", userEmail, orgId } as any;
}
