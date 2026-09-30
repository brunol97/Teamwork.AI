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
 * Agent: een AI-rol met naam, omschrijving, model, tools en skills, beschikbaar in
 * alle taken van de organisatie. Een agent is dus een bron van de organisatie, niet
 * van één taak; de actieve agent van een taak staat op de taak zelf
 * (`tasks.active_agent_id`).
 *
 * Rechten stapelen niet: een agent krijgt bij zijn beurten alleen de tools die hij
 * zelf heeft. Besteedt hij werk uit aan een andere agent, dan draait die andere
 * agent met alleen zijn eigen tools, nooit met de vereniging van beide.
 */
export const agents = table(
  "agents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    /** De naam waarmee de agent met @naam aangeroepen wordt; uniek binnen de organisatie. */
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Het Ollama-model van deze agent; null betekent het standaardmodel van de omgeving. */
    model: text("model"),
    /** De tools van deze agent, als JSON-array van namen. */
    tools: text("tools").notNull().default("[]"),
    /** De skills van deze agent, als JSON-array van namen. */
    skills: text("skills").notNull().default("[]"),
    /** Een uitgeschakelde agent krijgt geen beurten en wordt niet aangeroepen. */
    enabled: integer("enabled").notNull().default(1),
    /** Het sjabloon waaruit de agent is gemaakt, of "leeg". */
    template: text("template"),
    createdBy: text("created_by").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("agents_organization_id_idx").on(t.organizationId),
    uniqueIndex("agents_organization_id_name_unique").on(t.organizationId, t.name),
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
    /**
     * Wanneer de agent het antwoord heeft opgepakt. null betekent dat het
     * antwoord wel bewaard is maar dat de hervat mislukte; die vraag staat dan
     * in de lijst waarop de hervat opnieuw gestart kan worden.
     */
    resumedAt: bigint("resumed_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("human_tasks_task_id_idx").on(t.taskId),
    index("human_tasks_organization_id_idx").on(t.organizationId),
    index("human_tasks_asked_user_id_idx").on(t.askedUserId),
  ],
);

/**
 * Skill: een herbruikbaar recept voor een soort taak in SKILL.md-formaat, met
 * een menselijke eigenaar. De inhoud staat in `skill_versions`; de rij hier
 * draagt welke versie actief is. Agents verwijzen naar een skill via zijn naam
 * (`agents.skills`), de promptbouwer leest de actieve versie op aanroeptijd.
 */
export const skills = table(
  "skills",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    /** De naam waarmee een agent de skill in zijn lijst noemt; uniek per organisatie. */
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** De menselijke eigenaar: alleen hij keurt voorstellen goed, past ze aan of wijst ze af. */
    ownerId: text("owner_id").notNull(),
    /** De versie die de agents gebruiken; oude versies blijven in `skill_versions` bewaard. */
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("skills_organization_id_idx").on(t.organizationId),
    uniqueIndex("skills_organization_id_name_unique").on(t.organizationId, t.name),
  ],
);

/**
 * Eén versie van een skill. Versies worden nooit gewijzigd of verwijderd: een
 * goedgekeurd voorstel voegt een nieuwe versie toe en zet `skills.current_version`
 * op die versie, zodat de oude inhoud bewaard en leesbaar blijft.
 */
export const skillVersions = table(
  "skill_versions",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id").notNull(),
    organizationId: text("organization_id").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("skill_versions_skill_id_idx").on(t.skillId),
    uniqueIndex("skill_versions_skill_id_version_unique").on(t.skillId, t.version),
  ],
);

/**
 * Skill-voorstel: een door de agent voorgestelde wijziging aan een skill, die
 * de eigenaar goedkeurt, aanpast of afwijst. De diff tegen de actieve versie
 * wordt bij het voorstellen berekend en bewaard, zodat het voorstel later
 * precies zo getoond wordt als de agent hem voorstelde.
 */
export const skillProposals = table(
  "skill_proposals",
  {
    id: text("id").primaryKey(),
    skillId: text("skill_id").notNull(),
    organizationId: text("organization_id").notNull(),
    /** De versie waar het voorstel op gebaseerd is op het moment van voorstellen. */
    baseVersion: integer("base_version").notNull(),
    /** Waarom deze wijziging de skill beter maakt. */
    uitleg: text("uitleg").notNull(),
    proposedContent: text("proposed_content").notNull(),
    diff: text("diff").notNull(),
    /** open, goedgekeurd of afgewezen. */
    status: text("status").notNull().default("open"),
    /** De agent die het voorstel deed. */
    proposedBy: text("proposed_by").notNull(),
    /** De inhoud zoals de eigenaar hem heeft aangepast; null bij een ongewijzigde goedkeuring. */
    decidedContent: text("decided_content"),
    decidedBy: text("decided_by"),
    decidedAt: bigint("decided_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("skill_proposals_skill_id_idx").on(t.skillId),
    index("skill_proposals_organization_id_idx").on(t.organizationId),
  ],
);

/**
 * Evaluatie: de terugblik die een agent maakt bij het afronden van een taak,
 * gericht op verbetering van skills. Elke afronding levert er precies één op;
 * geeft de agent geen bruikbaar antwoord, dan staat er een terugval-evaluatie
 * in (`fallback = 1`), zodat de afronding nooit zonder evaluatie eindigt.
 */
export const evaluations = table(
  "evaluations",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    organizationId: text("organization_id").notNull(),
    /** De agent die de evaluatie schreef, of "systeem" bij de terugval. */
    agentName: text("agent_name").notNull(),
    content: text("content").notNull(),
    fallback: integer("fallback").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("evaluations_task_id_idx").on(t.taskId),
    index("evaluations_organization_id_idx").on(t.organizationId),
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
