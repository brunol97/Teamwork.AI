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
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("work_documents_task_id_idx").on(t.taskId)],
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
