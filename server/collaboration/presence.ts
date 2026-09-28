import { and, eq, sql } from "@agent-native/core/db/schema";

import { getDb } from "../db/client.js";
import { taskPresence } from "../db/schema.js";
import { getTask } from "../tasks/store.js";

/**
 * Hoe lang een client als aanwezig geldt zonder nieuwe hartslag. De UI stuurt
 * elke paar seconden een hartslag, dus na deze tijd is de pagina waarschijnlijk
 * gesloten en verdwijnt de deelnemer weer uit de lijst.
 */
export const PRESENCE_TTL_MS = 15_000;

export interface PresenceTouch {
  taskId: string;
  userId: string;
  /** Eén id per tab of apparaat, zodat twee vensters van dezelfde persoon meetellen. */
  clientId: string;
}

export interface PresenceParticipant {
  clientId: string;
  userId: string;
  lastSeenAt: number;
}

export async function touchTaskPresence({
  taskId,
  userId,
  clientId,
}: PresenceTouch): Promise<void> {
  const db = getDb();
  const now = Date.now();

  await db
    .insert(taskPresence)
    .values({ clientId, taskId, userId, lastSeenAt: now, createdAt: now })
    .onConflictDoUpdate({
      target: taskPresence.clientId,
      set: { taskId, userId, lastSeenAt: now },
    });
}

export async function clearTaskPresence(clientId: string): Promise<void> {
  const db = getDb();
  await db.delete(taskPresence).where(eq(taskPresence.clientId, clientId));
}

/** Geeft de clients terug die de taak nu open hebben, alleen binnen de organisatie. */
export async function listActivePresence(
  taskId: string,
  orgId: string,
  now: number = Date.now(),
): Promise<PresenceParticipant[]> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select({
      clientId: taskPresence.clientId,
      userId: taskPresence.userId,
      lastSeenAt: taskPresence.lastSeenAt,
    })
    .from(taskPresence)
    .where(
      and(
        eq(taskPresence.taskId, taskId),
        sql`${taskPresence.lastSeenAt} > ${now - PRESENCE_TTL_MS}`,
      ),
    );

  return rows;
}
