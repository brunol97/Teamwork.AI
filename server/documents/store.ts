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
    // De beheerder vervangt het hele document, dus de gewenste tekst staat vast.
    change: () => markdown,
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
  return applyWorkDocumentChange({
    taskId,
    orgId,
    actorType,
    actorId,
    eventType: "document_section_added",
    eventData: title,
    // Een mutatie, geen vooraf berekende string: bij een botsing wordt de
    // append opnieuw toegepast op de markdown van dat moment, zodat een
    // menselijke save ertussen niet verdwijnt.
    change: (current) => appendSection(current, title, body),
  });
}

/**
 * Past `change` toe op de huidige markdown van het werkdocument en logt de
 * wijziging. `change` is een functie zodat een mislukte poging opnieuw kan
 * worden toegepast op de markdown die er dan staat.
 */
export async function applyWorkDocumentChange({
  taskId,
  orgId,
  actorType,
  actorId,
  eventType,
  eventData,
  change,
}: {
  taskId: string;
  orgId: string;
  actorType: ActorType;
  actorId: string;
  eventType: string;
  eventData: string | null;
  change: (current: string) => string | Promise<string>;
}): Promise<WorkDocument | undefined> {
  return writeWorkDocument({
    taskId,
    orgId,
    change,
    actorType,
    actorId,
    eventType,
    eventData,
  });
}

async function writeWorkDocument({
  taskId,
  orgId,
  change,
  actorType,
  actorId,
  eventType,
  eventData,
  expectedVersion,
}: {
  taskId: string;
  orgId: string;
  change: (current: string) => string | Promise<string>;
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
  const written = await getDb().transaction(async (tx) => {
    const written = await writeContentWithVersionCheck({
      db: tx,
      taskId,
      change,
      now,
      expectedVersion,
    });
    await createTaskEvent(taskId, actorType, actorId, eventType, eventData, tx);
    return written;
  });

  const writtenMarkdown = written.markdown;
  return { taskId, markdown: writtenMarkdown, version: written.version, updatedAt: now };
}

/**
 * Schrijft de markdown weg met een check-and-set op de versie. Zonder
 * `expectedVersion` wordt de actuele versie opgehaald en het schrijven een
 * paar keer herhaald, zodat twee gelijktijdige aanpassingen elkaar niet
 * overschrijven. Elke poging leest de markdown opnieuw en past `change` daar
 * opnieuw op toe: een append die met een menselijke save botst herhaalt zich
 * dus tegen de tekst van die save, niet tegen de tekst van vóór de save.
 */
async function writeContentWithVersionCheck({
  db,
  taskId,
  change,
  now,
  expectedVersion,
}: {
  db: DbTransaction;
  taskId: string;
  change: (current: string) => string | Promise<string>;
  now: number;
  expectedVersion?: number;
}): Promise<{ markdown: string; version: number }> {
  const attempts = expectedVersion === undefined ? 5 : 1;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await readDocument(db, taskId);
    const targetVersion = expectedVersion ?? current?.version ?? 0;
    const markdown = await change(current?.markdown ?? "");

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
      return { markdown, version: inserted[0].version };
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
      return { markdown, version: updated[0].version };
    }
  }

  const currentVersion = (await readDocument(db, taskId))?.version ?? 0;
  throw new WorkDocumentConflictError(currentVersion);
}

async function readDocument(
  db: DbTransaction,
  taskId: string,
): Promise<{ markdown: string; version: number } | undefined> {
  const rows = await db
    .select({ markdown: workDocuments.markdown, version: workDocuments.version })
    .from(workDocuments)
    .where(eq(workDocuments.taskId, taskId))
    .limit(1);

  return rows[0];
}
