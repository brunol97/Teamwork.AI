import { and, desc, eq, inArray, sql } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb, type DbTransaction } from "../db/client.js";
import { projects, tasks, taskEvents } from "../db/schema.js";

export interface CreateTaskInput {
  orgId: string;
  leadId: string;
  projectName: string;
  taskTitle: string;
}

export interface TaskWithProject {
  id: string;
  title: string;
  status: string;
  leadId: string;
  activeAgentId: string | null;
  costLimitCents: number;
  costUsedCents: number;
  createdAt: number;
  updatedAt: number;
  projectId: string;
  projectName: string;
  organizationId: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: string;
  actorType: string;
  actorId: string;
  data: string | null;
  createdAt: number;
}

export async function createTask({
  orgId,
  leadId,
  projectName,
  taskTitle,
}: CreateTaskInput): Promise<TaskWithProject> {
  const db = getDb();
  const now = Date.now();
  const projectId = randomUUID();
  const taskId = randomUUID();

  await db.insert(projects).values({
    id: projectId,
    organizationId: orgId,
    name: projectName,
    archived: 0,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(tasks).values({
    id: taskId,
    projectId,
    title: taskTitle,
    status: "bezig",
    leadId,
    costLimitCents: 1000,
    costUsedCents: 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id: taskId,
    title: taskTitle,
    status: "bezig",
    leadId,
    activeAgentId: null,
    costLimitCents: 1000,
    costUsedCents: 0,
    createdAt: now,
    updatedAt: now,
    projectId,
    projectName,
    organizationId: orgId,
  };
}

export async function listTasks(orgId: string): Promise<TaskWithProject[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      leadId: tasks.leadId,
      activeAgentId: tasks.activeAgentId,
      costLimitCents: tasks.costLimitCents,
      costUsedCents: tasks.costUsedCents,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      projectId: projects.id,
      projectName: projects.name,
      organizationId: projects.organizationId,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(projects.organizationId, orgId))
    .orderBy(desc(tasks.createdAt));

  return rows;
}

export async function getTask(
  taskId: string,
  orgId: string,
): Promise<TaskWithProject | undefined> {
  const db = getDb();
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      leadId: tasks.leadId,
      activeAgentId: tasks.activeAgentId,
      costLimitCents: tasks.costLimitCents,
      costUsedCents: tasks.costUsedCents,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      projectId: projects.id,
      projectName: projects.name,
      organizationId: projects.organizationId,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, taskId), eq(projects.organizationId, orgId)))
    .limit(1);

  return rows[0];
}

/**
 * Zet de status van een taak, bijvoorbeeld "wacht op iemand" zolang er een
 * openstaande vraag is. De status staat in SQL, dus hij overleeft een herstart.
 *
 * De organisatiegrens zit in de `where` van de schrijfactie zelf, niet in een
 * losse leesactie ervoor: zo kan de update nooit een taak van een andere
 * organisatie raken. Geeft false terug wanneer er geen taak in deze
 * organisatie is.
 */
export async function setTaskStatus(
  taskId: string,
  orgId: string,
  status: string,
  db: Pick<DbTransaction, "update" | "select"> = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(tasks)
    .set({ status, updatedAt: Date.now() })
    .where(
      and(
        eq(tasks.id, taskId),
        inArray(
          tasks.projectId,
          db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.organizationId, orgId)),
        ),
      ),
    )
    .returning({ id: tasks.id });

  return rows.length > 0;
}

/**
 * Wisselen: zet de actieve agent van een taak, of null voor de standaardagent.
 * De organisatiegrens zit in de `where` van de schrijfactie zelf. Geeft false
 * terug wanneer er geen taak in deze organisatie is.
 */
export async function setTaskActiveAgent(
  taskId: string,
  orgId: string,
  agentId: string | null,
  db: Pick<DbTransaction, "update" | "select"> = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(tasks)
    .set({ activeAgentId: agentId, updatedAt: Date.now() })
    .where(
      and(
        eq(tasks.id, taskId),
        inArray(
          tasks.projectId,
          db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.organizationId, orgId)),
        ),
      ),
    )
    .returning({ id: tasks.id });

  return rows.length > 0;
}

/**
 * Overdragen: zet een nieuwe lead op de taak. De organisatiegrens zit in de
 * `where` van de schrijfactie zelf. Geeft false terug wanneer er geen taak in
 * deze organisatie is.
 */
export async function setTaskLead(
  taskId: string,
  orgId: string,
  leadId: string,
  db: Pick<DbTransaction, "update" | "select"> = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(tasks)
    .set({ leadId, updatedAt: Date.now() })
    .where(
      and(
        eq(tasks.id, taskId),
        inArray(
          tasks.projectId,
          db
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.organizationId, orgId)),
        ),
      ),
    )
    .returning({ id: tasks.id });

  return rows.length > 0;
}

/** De status van een taak waarvan de agent-activiteit het budget heeft bereikt. */
export const TASK_STATUS_PAUSED = "gepauzeerd";

export interface AddTaskCostResult {
  costUsedCents: number;
  costLimitCents: number;
  /** true wanneer de taak door deze bijdrage is gepauzeerd (alleen vanuit "bezig"). */
  gepauzeerd: boolean;
}

/**
 * Telt agentkosten bij een taak op en pauzeert de taak bij het bereiken van de
 * kostengrens (standaard €10). De organisatiegrens zit in de `where` van beide
 * schrijfacties, zodat de kosten en de pauze nooit een taak van een andere
 * organisatie raken. Het pauzeren gebeurt alleen vanuit "bezig", zodat een
 * herhaalde grensgeval geen tweede pauze of melding geeft; de wachtstatus van
 * een human task ("wacht op iemand") blijft staan.
 */
export async function addTaskCost({
  taskId,
  orgId,
  cents,
}: {
  taskId: string;
  orgId: string;
  cents: number;
}): Promise<AddTaskCostResult> {
  const db = getDb();
  const orgScope = inArray(
    tasks.projectId,
    db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.organizationId, orgId)),
  );

  const rows = await db
    .update(tasks)
    .set({
      costUsedCents: sql`${tasks.costUsedCents} + ${cents}`,
      updatedAt: Date.now(),
    })
    .where(and(eq(tasks.id, taskId), orgScope))
    .returning({
      costUsedCents: tasks.costUsedCents,
      costLimitCents: tasks.costLimitCents,
      status: tasks.status,
    });

  const row = rows[0];
  if (!row) {
    throw new Error("Task not found.");
  }

  if (row.costUsedCents < row.costLimitCents || row.status !== "bezig") {
    return {
      costUsedCents: row.costUsedCents,
      costLimitCents: row.costLimitCents,
      gepauzeerd: false,
    };
  }

  const paused = await db
    .update(tasks)
    .set({ status: TASK_STATUS_PAUSED, updatedAt: Date.now() })
    .where(
      and(eq(tasks.id, taskId), eq(tasks.status, "bezig"), orgScope),
    )
    .returning({ id: tasks.id });

  return {
    costUsedCents: row.costUsedCents,
    costLimitCents: row.costLimitCents,
    gepauzeerd: paused.length > 0,
  };
}

export async function createTaskEvent(
  taskId: string,
  actorType: "user" | "agent" | "system",
  actorId: string,
  type: string,
  data: string | null,
  /**
   * Schrijft binnen een bestaande transactie wanneer de event bij een andere
   * schrijfactie hoort, zodat beide writes of allebei slagen.
   */
  db: Pick<DbTransaction, "insert"> = getDb(),
): Promise<TaskEvent> {
  const now = Date.now();
  const id = randomUUID();

  await db.insert(taskEvents).values({
    id,
    taskId,
    type,
    actorType,
    actorId,
    data,
    createdAt: now,
  });

  return {
    id,
    taskId,
    type,
    actorType,
    actorId,
    data,
    createdAt: now,
  };
}

export async function listTaskEvents(
  taskId: string,
  orgId: string,
): Promise<TaskEvent[]> {
  // Verify the task belongs to the org before returning events.
  const task = await getTask(taskId, orgId);
  if (!task) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(taskEvents.createdAt);

  return rows;
}
