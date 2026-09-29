import {
  bigint,
  index,
  integer,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

export const customers = table(
  "customers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    name: text("name").notNull(),
    archived: integer("archived").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("customers_organization_id_idx").on(t.organizationId)],
);

export const projects = table(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    customerId: text("customer_id"),
    name: text("name").notNull(),
    archived: integer("archived").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("projects_organization_id_idx").on(t.organizationId),
    index("projects_customer_id_idx").on(t.customerId),
  ],
);

export const tasks = table(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("bezig"),
    leadId: text("lead_id").notNull(),
    activeAgentId: text("active_agent_id"),
    costLimitCents: integer("cost_limit_cents").notNull().default(1000),
    costUsedCents: integer("cost_used_cents").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("tasks_project_id_idx").on(t.projectId),
    index("tasks_lead_id_idx").on(t.leadId),
    index("tasks_status_idx").on(t.status),
  ],
);

export const workDocuments = table(
  "work_documents",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().unique(),
    markdown: text("markdown").notNull().default(""),
    yjsState: text("yjs_state"),
    /**
     * Versie van het werkdocument. Elke schrijfactie verhoogt hem, zodat een
     * tweede bewerker een conflict herkent in plaats van wijzigingen te
     * overschrijven. `yjsState` blijft ongebruikt: er is geen gedeelde
     * yjs-sessie, wel een optimistic-concurrencycheck.
     */
    version: integer("version").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("work_documents_task_id_idx").on(t.taskId)],
);

/** Uitnodigingslink van een beheerder naar één taak van de organisatie. */
export const taskInvites = table(
  "task_invites",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    taskId: text("task_id").notNull(),
    token: text("token").notNull().unique(),
    invitedEmail: text("invited_email"),
    status: text("status").notNull().default("open"),
    createdBy: text("created_by").notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    acceptedAt: bigint("accepted_at", { mode: "number" }),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("task_invites_task_id_idx").on(t.taskId),
    index("task_invites_organization_id_idx").on(t.organizationId),
  ],
);

/** Hartslag van een openstaande taakpagina, één rij per client (tab of apparaat). */
export const taskPresence = table(
  "task_presence",
  {
    clientId: text("client_id").primaryKey(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("task_presence_task_id_idx").on(t.taskId),
    index("task_presence_organization_id_idx").on(t.organizationId),
  ],
);

/** Iemand die de taak volgt en meldingen over de taak wil ontvangen. */
export const taskFollowers = table(
  "task_followers",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("task_followers_task_id_idx").on(t.taskId),
    uniqueIndex("task_followers_task_id_user_id_unique").on(t.taskId, t.userId),
  ],
);

/** Melding: een eenrichtingsbericht van de agent over een taak, zonder antwoord nodig. */
export const taskNotifications = table(
  "task_notifications",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id").notNull(),
    recipientId: text("recipient_id").notNull(),
    type: text("type").notNull().default("melding"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: bigint("read_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("task_notifications_recipient_id_idx").on(t.recipientId),
    index("task_notifications_task_id_idx").on(t.taskId),
  ],
);

/**
 * Human task: een verzoek van de agent aan een specifieke persoon dat een antwoord
 * vereist, waardoor de taak pauzeert. De drie velden `question` (wat), `reason`
 * (waarom) en `options` zijn alle drie verplicht; een vraag zonder waarom is geen
 * bruikbare vraag. De rij is de duurzame wachtstatus van de agent: na een herstart
 * van de server leest `answer-human-task` deze rij om verder te gaan.
 */
export const humanTasks = table(
  "human_tasks",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id").notNull(),
    /** Aan wie de agent de vraag stelt. */
    askedUserId: text("asked_user_id").notNull(),
    /** Wat de agent wil. */
    question: text("question").notNull(),
    /** Waarom de agent het antwoord nodig heeft. */
    reason: text("reason").notNull(),
    /** De opties waaruit de persoon kiest, als JSON-array van strings. */
    options: text("options").notNull(),
    status: text("status").notNull().default("open"),
    answer: text("answer"),
    answeredAt: bigint("answered_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("human_tasks_task_id_idx").on(t.taskId),
    index("human_tasks_organization_id_idx").on(t.organizationId),
    index("human_tasks_asked_user_id_idx").on(t.askedUserId),
  ],
);

export const taskEvents = table(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    type: text("type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    data: text("data"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("task_events_task_id_idx").on(t.taskId)],
);

export const files = table(
  "files",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    storageKey: text("storage_key").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("files_task_id_idx").on(t.taskId)],
);
