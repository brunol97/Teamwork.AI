import { eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { workDocuments } from "../db/schema.js";
import { createTaskEvent, getTask } from "../tasks/store.js";
import { appendSection } from "./markdown.js";

export interface WorkDocument {
  taskId: string;
  markdown: string;
  updatedAt: number;
}

export type ActorType = "user" | "agent" | "system";

export interface SaveWorkDocumentInput {
  taskId: string;
  orgId: string;
  markdown: string;
  actorType: ActorType;
  actorId: string;
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
    return { taskId, markdown: "", updatedAt: 0 };
  }

  return { taskId: row.taskId, markdown: row.markdown, updatedAt: row.updatedAt };
}

/** Slaat de volledige markdown van het werkdocument op en logt de wijziging. */
export async function saveWorkDocument({
  taskId,
  orgId,
  markdown,
  actorType,
  actorId,
}: SaveWorkDocumentInput): Promise<WorkDocument | undefined> {
  return writeWorkDocument({
    taskId,
    orgId,
    markdown,
    actorType,
    actorId,
    eventType: "document_changed",
    eventData: null,
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
}: {
  taskId: string;
  orgId: string;
  markdown: string;
  actorType: ActorType;
  actorId: string;
  eventType: string;
  eventData: string | null;
}): Promise<WorkDocument | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const db = getDb();
  const now = Date.now();

  await db
    .insert(workDocuments)
    .values({
      id: randomUUID(),
      taskId,
      markdown,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: workDocuments.taskId,
      set: { markdown, updatedAt: now },
    });

  await createTaskEvent(taskId, actorType, actorId, eventType, eventData);

  return { taskId, markdown, updatedAt: now };
}
