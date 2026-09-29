import { and, desc, eq, isNull } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { taskNotifications } from "../db/schema.js";
import { listTaskFollowers } from "./following.js";

export interface Melding {
  id: string;
  taskId: string;
  organizationId: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  readAt: number | null;
  createdAt: number;
}

export interface CreateMeldingInput {
  taskId: string;
  orgId: string;
  recipientId: string;
  title: string;
  body: string;
}

/** Een melding is een eenrichtingsbericht van de agent; er is geen antwoord nodig. */
export async function createMelding({
  taskId,
  orgId,
  recipientId,
  title,
  body,
}: CreateMeldingInput): Promise<Melding> {
  const db = getDb();
  const melding: Melding = {
    id: randomUUID(),
    taskId,
    organizationId: orgId,
    recipientId,
    type: "melding",
    title,
    body,
    readAt: null,
    createdAt: Date.now(),
  };

  await db.insert(taskNotifications).values(melding);
  return melding;
}

/** Stuurt dezelfde melding naar alle volgers van de taak. */
export async function notifyTaskFollowers({
  taskId,
  orgId,
  title,
  body,
}: {
  taskId: string;
  orgId: string;
  title: string;
  body: string;
}): Promise<Melding[]> {
  const followers = await listTaskFollowers(taskId, orgId);

  const meldingen: Melding[] = [];
  for (const recipientId of followers) {
    meldingen.push(
      await createMelding({ taskId, orgId, recipientId, title, body }),
    );
  }
  return meldingen;
}

/** Geeft de meldingen van de aanroeper terug, nieuwste eerst. */
export async function listMeldingen(
  orgId: string,
  recipientId: string,
  limit = 20,
): Promise<Melding[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskNotifications)
    .where(
      and(
        eq(taskNotifications.organizationId, orgId),
        eq(taskNotifications.recipientId, recipientId),
      ),
    )
    .orderBy(desc(taskNotifications.createdAt))
    .limit(limit);

  return rows;
}

export async function countUnreadMeldingen(
  orgId: string,
  recipientId: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: taskNotifications.id })
    .from(taskNotifications)
    .where(
      and(
        eq(taskNotifications.organizationId, orgId),
        eq(taskNotifications.recipientId, recipientId),
        isNull(taskNotifications.readAt),
      ),
    );

  return rows.length;
}

/** Markeert de meldingen van de aanroeper als gelezen, optioneor per taak. */
export async function markMeldingenRead({
  orgId,
  recipientId,
  taskId,
}: {
  orgId: string;
  recipientId: string;
  taskId?: string;
}): Promise<number> {
  const db = getDb();
  const now = Date.now();

  const conditions = [
    eq(taskNotifications.organizationId, orgId),
    eq(taskNotifications.recipientId, recipientId),
    isNull(taskNotifications.readAt),
  ];
  if (taskId) {
    conditions.push(eq(taskNotifications.taskId, taskId));
  }

  const rows = await db
    .update(taskNotifications)
    .set({ readAt: now })
    .where(and(...conditions))
    .returning({ id: taskNotifications.id });

  return rows.length;
}
