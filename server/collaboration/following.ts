import { and, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { taskFollowers } from "../db/schema.js";
import { getTask } from "../tasks/store.js";

/** Volgen: iemand ontvangt meldingen over de taak zonder er actief aan te werken. */
export async function followTask({
  taskId,
  orgId,
  userId,
}: {
  taskId: string;
  orgId: string;
  userId: string;
}): Promise<boolean> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return false;
  }

  const db = getDb();
  await db
    .insert(taskFollowers)
    .values({
      id: randomUUID(),
      taskId,
      organizationId: orgId,
      userId,
      createdAt: Date.now(),
    })
    .onConflictDoNothing();

  return true;
}

export async function unfollowTask({
  taskId,
  orgId,
  userId,
}: {
  taskId: string;
  orgId: string;
  userId: string;
}): Promise<boolean> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return false;
  }

  const db = getDb();
  await db
    .delete(taskFollowers)
    .where(and(eq(taskFollowers.taskId, taskId), eq(taskFollowers.userId, userId)));

  return true;
}

export async function isFollowingTask(
  taskId: string,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return false;
  }

  const db = getDb();
  const rows = await db
    .select({ id: taskFollowers.id })
    .from(taskFollowers)
    .where(and(eq(taskFollowers.taskId, taskId), eq(taskFollowers.userId, userId)))
    .limit(1);

  return rows.length > 0;
}

/** Geeft de volgers van een taak terug; alleen binnen de organisatie. */
export async function listTaskFollowers(
  taskId: string,
  orgId: string,
): Promise<string[]> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({ userId: taskFollowers.userId })
    .from(taskFollowers)
    .where(eq(taskFollowers.taskId, taskId));

  return rows.map((row) => row.userId);
}
