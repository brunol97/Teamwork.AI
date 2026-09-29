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
  /** Organisatie van de aanroeper; de rij is alleen voor die organisatie leesbaar. */
  organizationId: string;
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
  organizationId,
  userId,
  clientId,
}: PresenceTouch): Promise<void> {
  const db = getDb();
  const now = Date.now();

  await db
    .insert(taskPresence)
    .values({ clientId, taskId, organizationId, userId, lastSeenAt: now, createdAt: now })
    .onConflictDoUpdate({
      target: taskPresence.clientId,
      set: { taskId, organizationId, userId, lastSeenAt: now },
    });
}

/**
 * Wis de aanwezigheid van één client, maar alleen binnen de organisatie van de
 * aanroeper. Een bekend clientId is geen bewijs van eigendom: zonder deze
 * scope kon iedereen de aanwezigheid van een andere organisatie wissen.
 */
export async function clearTaskPresence(
  clientId: string,
  organizationId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(taskPresence)
    .where(
      and(eq(taskPresence.clientId, clientId), eq(taskPresence.organizationId, organizationId)),
    );
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
        eq(taskPresence.organizationId, orgId),
        sql`${taskPresence.lastSeenAt} > ${now - PRESENCE_TTL_MS}`,
      ),
    );

  return rows;
}
