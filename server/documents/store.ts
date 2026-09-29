import { and, eq, sql } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb, type DbTransaction } from "../db/client.js";
import { workDocuments } from "../db/schema.js";
import { createTaskEvent, getTask } from "../tasks/store.js";
import { appendSection } from "./markdown.js";

export interface WorkDocument {
  taskId: string;
  markdown: string;
  /**
   * Versie van het werkdocument. Elke schrijfactie verhoogt hem, zodat een
   * tweede bewerker een conflict herkent in plaats van wijzigingen te
   * overschrijven.
   */
  version: number;
  updatedAt: number;
}

/** Wordt gegooid wanneer een schrijfactie een verouderde versie probeert te overschrijven. */
export class WorkDocumentConflictError extends Error {
  readonly workDocumentConflict = true;
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super(
      "Iemand anders heeft het werkdocument gewijzigd. Herlaad het werkdocument om de wijziging te zien.",
    );
    this.name = "WorkDocumentConflictError";
    this.currentVersion = currentVersion;
  }
}

export type ActorType = "user" | "agent" | "system";

export interface SaveWorkDocumentInput {
  taskId: string;
  orgId: string;
  markdown: string;
  actorType: ActorType;
  actorId: string;
  /**
   * Versie die de aanroeper heeft gelezen. Ontbreekt deze, dan schrijft de
   * aanroeper blind (bijvoorbeeld de agent die een sectie toevoegt).
   */
  expectedVersion?: number;
}

export interface AddSectionInput {
  taskId: string;
  orgId: string;
  title: string;
  body: string;
  actorType: ActorType;
  actorId: string;
}

/**
 * Leest het werkdocument van een taak. Geeft undefined terug wanneer de taak
 * niet in de organisatie van de aanroeper zit, zodat er niets lekt.
 */
export async function getWorkDocument(
  taskId: string,
  orgId: string,
): Promise<WorkDocument | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(workDocuments)
    .where(eq(workDocuments.taskId, taskId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { taskId, markdown: "", version: 0, updatedAt: 0 };
  }

  return {
    taskId: row.taskId,
    markdown: row.markdown,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

/** Slaat de volledige markdown van het werkdocument op en logt de wijziging. */
export async function saveWorkDocument({
  taskId,
  orgId,
  markdown,
  actorType,
  actorId,
  expectedVersion,
}: SaveWorkDocumentInput): Promise<WorkDocument | undefined> {
  return writeWorkDocument({
    taskId,
    orgId,
    markdown,
    actorType,
    actorId,
    eventType: "document_changed",
    eventData: null,
    expectedVersion,
  });
}

/** Voegt een sectie onderaan het werkdocument toe en logt de wijziging. */
export async function addWorkDocumentSection({
  taskId,
  orgId,
  title,
  body,
  actorType,
  actorId,
}: AddSectionInput): Promise<WorkDocument | undefined> {
  const current = await getWorkDocument(taskId, orgId);
  if (!current) {
    return undefined;
  }

  return writeWorkDocument({
    taskId,
    orgId,
    markdown: appendSection(current.markdown, title, body),
    actorType,
    actorId,
    eventType: "document_section_added",
    eventData: title,
  });
}

async function writeWorkDocument({
  taskId,
  orgId,
  markdown,
  actorType,
  actorId,
  eventType,
  eventData,
  expectedVersion,
}: {
  taskId: string;
  orgId: string;
  markdown: string;
  actorType: ActorType;
  actorId: string;
  eventType: string;
  eventData: string | null;
  expectedVersion?: number;
}): Promise<WorkDocument | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const now = Date.now();

  // Het werkdocument en de activity-log entry horen bij elkaar: zonder de entry
  // is de wijziging niet gelogd en dus onvindbaar. Eén transactie, dus een
  // mislukte event insert maakt de markdown-schrijfactie ongedaan.
  const version = await getDb().transaction(async (tx) => {
    const written = await writeContentWithVersionCheck({
      db: tx,
      taskId,
      markdown,
      now,
      expectedVersion,
    });
    await createTaskEvent(taskId, actorType, actorId, eventType, eventData, tx);
    return written;
  });

  return { taskId, markdown, version, updatedAt: now };
}

/**
 * Schrijft de markdown weg met een check-and-set op de versie. Zonder
 * `expectedVersion` wordt de actuele versie opgehaald en het schrijven een
 * paar keer herhaald, zodat twee gelijktijdige aanpassingen elkaar niet
 * overschrijven.
 */
async function writeContentWithVersionCheck({
  db,
  taskId,
  markdown,
  now,
  expectedVersion,
}: {
  db: DbTransaction;
  taskId: string;
  markdown: string;
  now: number;
  expectedVersion?: number;
}): Promise<number> {
  const attempts = expectedVersion === undefined ? 5 : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const targetVersion =
      expectedVersion === undefined ? ((await readVersion(db, taskId)) ?? 0) : expectedVersion;

    // Maak het werkdocument aan als de taak nog geen werkdocument heeft.
    const inserted = await db
      .insert(workDocuments)
      .values({
        id: randomUUID(),
        taskId,
        markdown,
        version: targetVersion + 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: workDocuments.taskId })
      .returning({ version: workDocuments.version });

    if (inserted.length > 0) {
      return inserted[0].version;
    }

    const updated = await db
      .update(workDocuments)
      .set({
        markdown,
        updatedAt: now,
        version: sql`${workDocuments.version} + 1`,
      })
      .where(and(eq(workDocuments.taskId, taskId), eq(workDocuments.version, targetVersion)))
      .returning({ version: workDocuments.version });

    if (updated.length > 0) {
      return updated[0].version;
    }
  }

  const currentVersion = (await readVersion(db, taskId)) ?? 0;
  throw new WorkDocumentConflictError(currentVersion);
}

async function readVersion(db: DbTransaction, taskId: string): Promise<number | undefined> {
  const rows = await db
    .select({ version: workDocuments.version })
    .from(workDocuments)
    .where(eq(workDocuments.taskId, taskId))
    .limit(1);

  return rows[0]?.version;
}
