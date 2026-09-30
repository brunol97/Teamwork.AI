import { and, desc, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb, type DbTransaction } from "../db/client.js";
import { overdrachtNotes } from "../db/schema.js";
import { listHumanTasksForTask } from "./human-tasks.js";
import { getWorkDocument } from "../documents/store.js";
import { extractHeadings } from "../documents/markdown.js";
import {
  createTaskEvent,
  getTask,
  listTaskEvents,
  type TaskEvent,
  type TaskWithProject,
} from "../tasks/store.js";

/**
 * De overdrachtsnotitie: een concept dat automatisch wordt opgesteld bij
 * pauzeren of wisselen, en pas bij finalisatie onveranderlijk in het
 * activiteitenlog wordt opgenomen. Het concept is aanpasbaar en staat in
 * `overdracht_notities`; de gefinaliseerde tekst staat in een
 * `overdracht_notitie`-gebeurtenis in `task_events` en wordt daarna nooit
 * meer gewijzigd.
 *
 * Het opstellen is bewust geen LLM-werk: de notitie is een samenvatting van
 * feiten die de taak al draagt (status, gesprek, werkdocument, open vraag),
 * deterministisch opgebouwd. Zo blijft de actie voorspelbaar en zijn er geen
 * LLM-aanroepen buiten de agent-chat.
 */

/** Waarop het concept ontstond: een pauze van de lead, een agentwissel of de overdracht zelf. */
export type OverdrachtNoteKind = "pauze" | "wisselen" | "overdracht";

export type OverdrachtNoteStatus = "open" | "gefinaliseerd";

export interface OverdrachtNote {
  id: string;
  taskId: string;
  organizationId: string;
  kind: OverdrachtNoteKind;
  content: string;
  status: OverdrachtNoteStatus;
  finalizedEventId: string | null;
  finalizedAt: number | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** De feiten waaruit het concept wordt opgebouwd; allemaal van de taak zelf. */
export interface DraftInput {
  taskTitle: string;
  projectName: string;
  status: string;
  leadId: string;
  berichtCount: number;
  laatsteBericht: string | null;
  documentKoppen: string[];
  openVraag: { question: string; askedUserId: string } | null;
  /** Alleen bij een agentwissel: van welke agent naar welke. */
  wissel: { van: string; aan: string } | null;
}

/**
 * Stelt het concept op uit de gegevens van de taak. Zuiver en deterministisch:
 * dezelfde invoer geeft dezelfde notitie.
 */
export function draftOverdrachtNotitie(input: DraftInput): string {
  const laatste = input.laatsteBericht
    ? `"${input.laatsteBericht.slice(0, 160)}${input.laatsteBericht.length > 160 ? "…" : ""}"`
    : "er is nog niet gesproken";

  const regels = [
    `Overdrachtsnotitie — "${input.taskTitle}" (project ${input.projectName})`,
    "",
    `Status bij het opstellen: ${input.status}`,
    `Lead: ${input.leadId}`,
    "",
    "Stand van het werk:",
    `- Het gesprek telt ${input.berichtCount} berichten; ${laatste}.`,
    `- Werkdocument: ${
      input.documentKoppen.length > 0
        ? `${input.documentKoppen.length} onderdelen (${input.documentKoppen.join(", ")})`
        : "het werkdocument is nog leeg"
    }.`,
    `- Open vraag: ${
      input.openVraag
        ? `"${input.openVraag.question}" (wacht op ${input.openVraag.askedUserId})`
        : "geen open vraag"
    }.`,
  ];

  if (input.wissel) {
    regels.push(
      `Actieve agent: van ${input.wissel.van} naar ${input.wissel.aan}.`,
    );
  }

  return regels.join("\n");
}

function toNote(row: typeof overdrachtNotes.$inferSelect): OverdrachtNote {
  return {
    ...row,
    kind: row.kind as OverdrachtNoteKind,
    status: row.status as OverdrachtNoteStatus,
  };
}

/** Verzamelt de feiten van de taak en bouwt het concept eruit op. */
export async function buildDraftForTask({
  taskId,
  orgId,
  wissel = null,
}: {
  taskId: string;
  orgId: string;
  wissel?: { van: string; aan: string } | null;
}): Promise<string | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const [events, document, openVragen] = await Promise.all([
    listTaskEvents(taskId, orgId),
    getWorkDocument(taskId, orgId),
    listHumanTasksForTask(taskId, orgId),
  ]);

  const berichten = events.filter(
    (event) => event.type === "message" && event.data,
  );
  const laatste = berichten[berichten.length - 1]?.data ?? null;
  const openVraagRow = openVragen.find((vraag) => vraag.status === "open");

  return draftOverdrachtNotitie({
    taskTitle: task.title,
    projectName: task.projectName,
    status: task.status,
    leadId: task.leadId,
    berichtCount: berichten.length,
    laatsteBericht: laatste,
    documentKoppen: extractHeadings(document?.markdown ?? "", 2),
    openVraag: openVraagRow
      ? { question: openVraagRow.question, askedUserId: openVraagRow.askedUserId }
      : null,
    wissel,
  });
}

/**
 * Zorgt dat er één open concept op de taak staat. Bestaat er al één, dan
 * blijft de inhoud staan (de lead kan hem hebben aangepast); alleen het soort
 * moment en — wanneer een nieuwe inhoud wordt aangeboden — de tekst worden
 * bijgewerkt. Bestaat er geen, dan wordt een nieuw concept opgesteld.
 */
export async function ensureOpenNote({
  taskId,
  orgId,
  kind,
  createdBy,
  content,
  wissel = null,
}: {
  taskId: string;
  orgId: string;
  kind: OverdrachtNoteKind;
  createdBy: string;
  /** Nieuwe concepttekst; zonder deze blijft een bestaand concept onaangeroerd. */
  content?: string;
  /** Alleen bij het opstellen van een wisselnotitie: van welke agent naar welke. */
  wissel?: { van: string; aan: string } | null;
}): Promise<OverdrachtNote | undefined> {
  const bestaand = await getOpenNote(taskId, orgId);

  const now = Date.now();

  if (bestaand) {
    const rows = await getDb()
      .update(overdrachtNotes)
      .set({
        kind,
        ...(content !== undefined ? { content } : {}),
        updatedAt: now,
      })
      .where(eq(overdrachtNotes.id, bestaand.id))
      .returning();
    return rows[0] ? toNote(rows[0]) : undefined;
  }

  const tekst = content ?? (await buildDraftForTask({ taskId, orgId, wissel }));
  if (!tekst) {
    return undefined;
  }

  const row = {
    id: randomUUID(),
    taskId,
    organizationId: orgId,
    kind,
    content: tekst,
    status: "open" as const,
    finalizedEventId: null,
    finalizedAt: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(overdrachtNotes).values(row);
  return toNote(row);
}

/** Het open concept van een taak, of undefined wanneer er niets open staat. */
async function getOpenNote(
  taskId: string,
  orgId: string,
): Promise<OverdrachtNote | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(overdrachtNotes)
    .where(
      and(
        eq(overdrachtNotes.taskId, taskId),
        eq(overdrachtNotes.organizationId, orgId),
        eq(overdrachtNotes.status, "open"),
      ),
    )
    .orderBy(desc(overdrachtNotes.createdAt))
    .limit(1);

  return rows[0] ? toNote(rows[0]) : undefined;
}

/**
 * De notitie die op deze taak hoort: het open concept als er één is, anders de
 * meest recent gefinaliseerde. Geeft undefined terug wanneer de taak niets
 * heeft — of niet in deze organisatie zit.
 */
export async function getOverdrachtNote(
  taskId: string,
  orgId: string,
): Promise<OverdrachtNote | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const open = await getOpenNote(taskId, orgId);
  if (open) {
    return open;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(overdrachtNotes)
    .where(
      and(
        eq(overdrachtNotes.taskId, taskId),
        eq(overdrachtNotes.organizationId, orgId),
        eq(overdrachtNotes.status, "gefinaliseerd"),
      ),
    )
    .orderBy(desc(overdrachtNotes.finalizedAt))
    .limit(1);

  return rows[0] ? toNote(rows[0]) : undefined;
}

/**
 * Werkt het open concept bij. Een gefinaliseerde notitie is onveranderlijk en
 * heeft hier dus geen pad meer; deze functie geeft undefined terug wanneer er
 * geen open concept is.
 */
export async function updateOpenNote({
  taskId,
  orgId,
  content,
}: {
  taskId: string;
  orgId: string;
  content: string;
}): Promise<OverdrachtNote | undefined> {
  const open = await getOpenNote(taskId, orgId);
  if (!open) {
    return undefined;
  }

  const rows = await getDb()
    .update(overdrachtNotes)
    .set({ content, updatedAt: Date.now() })
    .where(and(eq(overdrachtNotes.id, open.id), eq(overdrachtNotes.status, "open")))
    .returning();

  return rows[0] ? toNote(rows[0]) : undefined;
}

export interface FinaliseerResultaat {
  note: OverdrachtNote;
  event: TaskEvent;
}

/**
 * Finaliseert de overdrachtsnotitie: de tekst wordt onveranderlijk in het
 * activiteitenlog opgenomen als een `overdracht_notitie`-gebeurtenis en het
 * concept sluit. De gebeurtenis en het dichtzetten van het concept zijn één
 * transactie, zodat de notitie nooit in het log staat zonder dat het concept
 * sluit — en andersom.
 */
export async function finalizeOverdrachtNote({
  taskId,
  orgId,
  kind,
  createdBy,
  van,
  aan,
  content,
}: {
  taskId: string;
  orgId: string;
  kind: OverdrachtNoteKind;
  createdBy: string;
  /** Wie het werk overdroeg (lead of agent). */
  van: string;
  /** Wie het werk kreeg (nieuwe lead of nieuwe agent). */
  aan: string;
  /** Concepttekst om te gebruiken wanneer er nog geen open concept is. */
  content?: string;
}): Promise<FinaliseerResultaat | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const draft = await ensureOpenNote({ taskId, orgId, kind, createdBy, content });
  if (!draft) {
    return undefined;
  }

  const now = Date.now();
  const resultaat = await getDb().transaction(async (tx: DbTransaction) => {
    const event = await createTaskEvent(
      taskId,
      "user",
      createdBy,
      "overdracht_notitie",
      JSON.stringify({ kind, van, aan, notitie: draft.content }),
      tx,
    );

    const rows = await tx
      .update(overdrachtNotes)
      .set({
        status: "gefinaliseerd",
        finalizedEventId: event.id,
        finalizedAt: now,
        updatedAt: now,
      })
      .where(and(eq(overdrachtNotes.id, draft.id), eq(overdrachtNotes.status, "open")))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error(`Concept ${draft.id} is al gefinaliseerd.`);
    }
    return { note: toNote(row), event };
  });

  return resultaat;
}
