import { and, desc, eq } from "@agent-native/core/db/schema";
import { invalidateMemberOrgCaches, orgInvitations } from "@agent-native/core/org";
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
  /** De openstaande framework-uitnodiging die bij `invitedEmail` hoort. */
  orgInvitation: OrgInvitationResult;
}

export interface CreateTaskInviteInput {
  orgId: string;
  taskId: string;
  createdBy: string;
  invitedEmail?: string | null;
  expiresInHours?: number;
}

export interface OrgInvitationResult {
  /** `aangemaakt`, `reeds_open` of null: geen e-mailadres meegegeven. */
  status: "aangemaakt" | "reeds_open" | null;
  email: string | null;
  invitationId: string | null;
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

/**
 * Maakt de openstaande uitnodiging van het framework zelf aan, zodat
 * `acceptPendingInvitationsForEmail` de bezoeker echt lid maakt. De app
 * schrijft hiermee alleen een uitnodiging, geen lidmaatschap: de ledenlijst
 * blijft van het framework. Bij een reeds openstaande uitnodiging wordt die
 * hergebruikt, zodat een tweede link voor hetzelfde adres geen 409 geeft.
 */
export async function createPendingOrgInvitation({
  orgId,
  email,
  invitedBy,
}: {
  orgId: string;
  email: string;
  invitedBy: string;
}): Promise<OrgInvitationResult> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();
  const now = Date.now();

  const existing = await db
    .select({ id: orgInvitations.id })
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.status, "pending"),
        eq(orgInvitations.email, normalized),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return { status: "reeds_open", email: normalized, invitationId: existing[0].id };
  }

  const id = randomUUID();
  await db.insert(orgInvitations).values({
    id,
    orgId,
    email: normalized,
    invitedBy,
    createdAt: now,
    status: "pending",
    role: "member",
    appRolesJson: null,
  });
  // Het framework cachet de leden per e-mailadres; een nieuwe uitnodiging moet
  // die cache niet laten hangen op de vorige stand.
  invalidateMemberOrgCaches();

  return { status: "aangemaakt", email: normalized, invitationId: id };
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
  const orgInvitation = invitedEmail
    ? await createPendingOrgInvitation({ orgId, email: invitedEmail, invitedBy: createdBy })
    : { status: null, email: null, invitationId: null };
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
    orgInvitation,
  };

  await db.insert(taskInvites).values({
    id: invite.id,
    organizationId: invite.organizationId,
    taskId: invite.taskId,
    token: invite.token,
    invitedEmail: invite.invitedEmail,
    status: invite.status,
    createdBy: invite.createdBy,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
  });
  return invite;
}

/** Drizzle leest de status als string; de store houdt de twee waarden vast. */
function toTaskInvite(row: InviteRow): TaskInvite {
  return {
    ...row,
    status: row.status as InviteLinkStatus,
    orgInvitation: { status: null, email: null, invitationId: null },
  };
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

  const invite = rows[0] ? toTaskInvite(rows[0]) : undefined;
  if (invite) {
    await revokePendingOrgInvitation(invite);
  }
  return invite;
}

/**
 * Haalt de bijbehorende openstaande framework-uitnodiging weg. Een ingetrokken
 * link mag geen toegang geven, en een uitnodiging die blijft staan zou de
 * bezoeker alsnog lid maken via het framework.
 */
async function revokePendingOrgInvitation(invite: TaskInvite): Promise<void> {
  const email = invite.orgInvitation.email ?? invite.invitedEmail;
  if (!email) {
    return;
  }

  await getDb()
    .update(orgInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(orgInvitations.orgId, invite.organizationId),
        eq(orgInvitations.status, "pending"),
        eq(orgInvitations.email, email.trim().toLowerCase()),
      ),
    );
  invalidateMemberOrgCaches();
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
