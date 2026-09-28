import { and, desc, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
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

export async function createTaskEvent(
  taskId: string,
  actorType: "user" | "agent" | "system",
  actorId: string,
  type: string,
  data: string,
): Promise<TaskEvent> {
  const db = getDb();
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
