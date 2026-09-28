import { and, desc, eq } from "@agent-native/core/db/schema";
import { randomBytes, randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { taskInvites } from "../db/schema.js";
import { getTask } from "../tasks/store.js";

/** Status van een uitnodigingslink zoals de beheerder hem kan intrekken. */
export type InviteLinkStatus = "open" | "revoked";

/**
 * Toestand van een uitnodigingslink, in de taal van de gebruiker:
 * `geldig` (kan binnengaan), `verlopen` of `ingetrokken`.
 */
export type InviteLinkState = "geldig" | "verlopen" | "ingetrokken";

export interface TaskInvite {
  id: string;
  organizationId: string;
  taskId: string;
  token: string;
  invitedEmail: string | null;
  status: InviteLinkStatus;
  createdBy: string;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface CreateTaskInviteInput {
  orgId: string;
  taskId: string;
  createdBy: string;
  invitedEmail?: string | null;
  expiresInHours?: number;
}

export interface InviteLinkPreview {
  token: string;
  state: InviteLinkState;
  /** Nederlandse melding die de UI toont; leeg bij een geldige link. */
  melding: string;
  taskId: string | null;
  taskTitle: string | null;
  organizationId: string | null;
  expiresAt: number | null;
}

const DEFAULT_EXPIRY_HOURS = 72;

type InviteRow = typeof taskInvites.$inferSelect;

/** Bepaalt de toestand van een link op basis van de status en de vervaldatum. */
export function resolveInviteLinkState(
  invite: Pick<TaskInvite, "status" | "expiresAt">,
  now: number = Date.now(),
): InviteLinkState {
  if (invite.status === "revoked") {
    return "ingetrokken";
  }
  if (invite.expiresAt <= now) {
    return "verlopen";
  }
  return "geldig";
}

function meldingVoorState(state: InviteLinkState): string {
  if (state === "verlopen") {
    return "Deze uitnodigingslink is verlopen. Vraag de beheerder om een nieuwe link.";
  }
  if (state === "ingetrokken") {
    return "Deze uitnodigingslink is ingetrokken. Vraag de beheerder om een nieuwe link.";
  }
  return "";
}

/** Maakt een uitnodigingslink voor één taak aan. */
export async function createTaskInvite({
  orgId,
  taskId,
  createdBy,
  invitedEmail = null,
  expiresInHours = DEFAULT_EXPIRY_HOURS,
}: CreateTaskInviteInput): Promise<TaskInvite | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const db = getDb();
  const now = Date.now();
  const invite: TaskInvite = {
    id: randomUUID(),
    organizationId: orgId,
    taskId,
    token: randomBytes(18).toString("hex"),
    invitedEmail,
    status: "open",
    createdBy,
    expiresAt: now + expiresInHours * 60 * 60 * 1000,
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
  };

  await db.insert(taskInvites).values(invite);
  return invite;
}

/** Drizzle leest de status als string; de store houdt de twee waarden vast. */
function toTaskInvite(row: InviteRow): TaskInvite {
  return { ...row, status: row.status as InviteLinkStatus };
}

/**
 * Zoekt een link op token. De token is het enige toegangsbewijs: de gebruiker
 * is op dat moment nog geen lid en heeft dus geen organisatiecontext.
 */
export async function getTaskInviteByToken(
  token: string,
): Promise<TaskInvite | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskInvites)
    .where(eq(taskInvites.token, token))
    .limit(1);
  return rows[0] ? toTaskInvite(rows[0]) : undefined;
}

/** Geeft de link terug inclusief toestand en Nederlandse melding voor de UI. */
export async function getInviteLinkPreview(
  token: string,
  now: number = Date.now(),
): Promise<InviteLinkPreview> {
  const invite = await getTaskInviteByToken(token);
  if (!invite) {
    return {
      token,
      state: "ingetrokken",
      melding: "Deze uitnodigingslink bestaat niet meer of is ingetrokken.",
      taskId: null,
      taskTitle: null,
      organizationId: null,
      expiresAt: null,
    };
  }

  const state = resolveInviteLinkState(invite, now);
  const task = await getTask(invite.taskId, invite.organizationId);

  return {
    token,
    state,
    melding: meldingVoorState(state),
    taskId: invite.taskId,
    taskTitle: task?.title ?? null,
    organizationId: invite.organizationId,
    expiresAt: invite.expiresAt,
  };
}

/** Trekt een link in; alleen binnen de organisatie van de beheerder. */
export async function revokeTaskInvite(
  inviteId: string,
  orgId: string,
): Promise<TaskInvite | undefined> {
  const db = getDb();
  const rows = await db
    .update(taskInvites)
    .set({ status: "revoked", revokedAt: Date.now() })
    .where(and(eq(taskInvites.id, inviteId), eq(taskInvites.organizationId, orgId)))
    .returning();

  return rows[0] ? toTaskInvite(rows[0]) : undefined;
}

/** Geeft alle links van een taak terug, nieuwste eerst. */
export async function listTaskInvites(
  taskId: string,
  orgId: string,
  now: number = Date.now(),
): Promise<(TaskInvite & { state: InviteLinkState })[]> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(taskInvites)
    .where(and(eq(taskInvites.taskId, taskId), eq(taskInvites.organizationId, orgId)))
    .orderBy(desc(taskInvites.createdAt));

  return rows.map((row) => {
    const invite = toTaskInvite(row);
    return { ...invite, state: resolveInviteLinkState(invite, now) };
  });
}

/** Registreert dat iemand de link heeft gebruikt; de link zelf blijft geldig. */
export async function markInviteAccepted(token: string): Promise<void> {
  const db = getDb();
  await db
    .update(taskInvites)
    .set({ acceptedAt: Date.now() })
    .where(eq(taskInvites.token, token));
}
