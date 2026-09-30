import { and, eq } from "@agent-native/core/db/schema";

import { getDb } from "../db/client.js";
import { humanTasks, projects, tasks } from "../db/schema.js";
import { klantNamenVoorProjecten } from "../org/klanten.js";

/**
 * Het overzicht: per project het aantal taken per status, en per taak of hij
 * wacht op de aanroeper. De statusnamen zijn de bestaande taakstatussen:
 * "bezig", "wacht op iemand" (er staat een open vraag van de agent), "gepauzeerd"
 * (budget- of handpauze) en "klaar".
 */
export const OVERZICHT_STATUSES = [
  "bezig",
  "wacht op iemand",
  "gepauzeerd",
  "klaar",
] as const;

export type OverzichtStatus = (typeof OVERZICHT_STATUSES)[number];

export type Tellingen = Record<OverzichtStatus, number>;

export interface OverzichtProject {
  projectId: string;
  projectName: string;
  /** De klant waar het project onder staat, of null wanneer het direct onder de organisatie staat. */
  klantId: string | null;
  klantNaam: string | null;
  tellingen: Tellingen;
  totaal: number;
}

export interface OverzichtTaak {
  id: string;
  title: string;
  status: string;
  projectId: string;
  projectName: string;
  leadId: string;
  /** Er staat een open vraag van de agent aan de aanroeper open: "wacht op mij". */
  wachtOpMij: boolean;
  /** Er staat een open vraag van de agent aan iemand open: de taak wacht op iemand. */
  wachtOpIemand: boolean;
}

export interface Overzicht {
  organisatieId: string;
  /** Het e-mailadres van de aanroeper; "mijn taken" filtert hierop. */
  aangeroepenDoor: string;
  projecten: OverzichtProject[];
  taken: OverzichtTaak[];
  /** Aantal taken met een open vraag aan de aanroeper: het getal achter "Wacht op mij". */
  wachtOpMijAantal: number;
}

function legeTellingen(): Tellingen {
  return { "bezig": 0, "wacht op iemand": 0, "gepauzeerd": 0, "klaar": 0 };
}

function isBekendeStatus(status: string): status is OverzichtStatus {
  return (OVERZICHT_STATUSES as readonly string[]).includes(status);
}

/**
 * Bouwt het overzicht van één organisatie. Alleen rijen van deze organisatie
 * worden gelezen: de projecten bepalen de scope, en de open vragen worden per
 * taak van die projecten opgezocht.
 */
export async function getOverzicht(
  orgId: string,
  userEmail: string,
): Promise<Overzicht> {
  const db = getDb();

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      customerId: projects.customerId,
      archived: projects.archived,
    })
    .from(projects)
    .where(eq(projects.organizationId, orgId));

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      leadId: tasks.leadId,
      projectId: tasks.projectId,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(projects.organizationId, orgId));

  const openVragen = await db
    .select({
      taskId: humanTasks.taskId,
      askedUserId: humanTasks.askedUserId,
    })
    .from(humanTasks)
    .where(
      and(eq(humanTasks.organizationId, orgId), eq(humanTasks.status, "open")),
    );

  const klantNamen = await klantNamenVoorProjecten(orgId);

  const wachtOpIemandPerTaak = new Map<string, string[]>();
  for (const vraag of openVragen) {
    const lijst = wachtOpIemandPerTaak.get(vraag.taskId) ?? [];
    lijst.push(vraag.askedUserId);
    wachtOpIemandPerTaak.set(vraag.taskId, lijst);
  }

  const taken: OverzichtTaak[] = taskRows.map((task) => {
    const gevraagd = wachtOpIemandPerTaak.get(task.id) ?? [];
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      projectId: task.projectId,
      projectName:
        projectRows.find((p) => p.id === task.projectId)?.name ?? "",
      leadId: task.leadId,
      wachtOpMij: gevraagd.includes(userEmail),
      wachtOpIemand: gevraagd.length > 0,
    };
  });

  const projecten: OverzichtProject[] = projectRows.map((project) => {
    const tellingen = legeTellingen();
    let totaal = 0;
    for (const taak of taken) {
      if (taak.projectId !== project.id) continue;
      totaal += 1;
      if (isBekendeStatus(taak.status)) {
        tellingen[taak.status] += 1;
      }
    }
    return {
      projectId: project.id,
      projectName: project.name,
      klantId: project.customerId,
      klantNaam: project.customerId
        ? klantNamen.get(project.customerId) ?? null
        : null,
      tellingen,
      totaal,
    };
  });

  return {
    organisatieId: orgId,
    aangeroepenDoor: userEmail,
    projecten,
    taken,
    wachtOpMijAantal: taken.filter((t) => t.wachtOpMij).length,
  };
}
