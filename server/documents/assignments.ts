import { and, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { documentSectionAssignments } from "../db/schema.js";
import { parseDocumentSections } from "./markdown.js";
import { getWorkDocument } from "./store.js";
import { createTaskEvent } from "../tasks/store.js";
import { listTaskDeelnemers } from "../tasks/deelnemers.js";

/**
 * Onderdelen van het werkdocument zijn aan een deelnemer toe te wijzen. De
 * toewijzing is losse staat naast de markdown: het document zelf en zijn
 * versiebescherming blijven onaangeroerd, dus een toewijzing kan nooit een
 * lopende bewerking in de weg zitten.
 */

export interface AssignedSection {
  title: string;
  body: string;
  /** De deelnemer aan wie het onderdeel is toegewezen, of null. */
  assigneeId: string | null;
}

/**
 * Wordt gegooid wanneer de toegewezen persoon geen deelnemer is: alleen
 * iemand die daadwerkelijk heeft bijgedragen (volgens het activiteitenlog) of
 * de lead zelf kan een onderdeel toegewezen krijgen.
 */
export class NotADeelnemerError extends Error {
  readonly notADeelnemer = true;

  constructor(assigneeId: string) {
    super(
      `${assigneeId} is geen deelnemer van deze taak. Alleen de lead en mensen die hebben bijgedragen kunnen een onderdeel toegewezen krijgen.`,
    );
    this.name = "NotADeelnemerError";
  }
}

/**
 * Leest de onderdelen van het werkdocument met hun toewijzing. Geeft
 * undefined terug wanneer de taak niet in deze organisatie zit.
 */
export async function listDocumentSections(
  taskId: string,
  orgId: string,
): Promise<AssignedSection[] | undefined> {
  const document = await getWorkDocument(taskId, orgId);
  if (!document) {
    return undefined;
  }

  const db = getDb();
  const toewijzingen = await db
    .select()
    .from(documentSectionAssignments)
    .where(
      and(
        eq(documentSectionAssignments.taskId, taskId),
        eq(documentSectionAssignments.organizationId, orgId),
      ),
    );

  const perTitel = new Map(
    toewijzingen.map((toewijzing) => [toewijzing.sectionTitle, toewijzing.assigneeId]),
  );

  return parseDocumentSections(document.markdown).map((sectie) => ({
    title: sectie.title,
    body: sectie.body,
    assigneeId: perTitel.get(sectie.title) ?? null,
  }));
}

export interface AssignSectionResult {
  taskId: string;
  sectionTitle: string;
  assigneeId: string;
  assignedBy: string;
}

/**
 * Wijst een onderdeel toe aan een deelnemer, of wijst opnieuw toe. De sectie
 * moet in het werkdocument staan en de toegewezen persoon moet deelnemer zijn
 * (de lead of iemand die heeft bijgedragen). De toewijzing staat in het
 * activiteitenlog als `section_assigned`.
 */
export async function assignDocumentSection(
  taskId: string,
  orgId: string,
  sectionTitle: string,
  assigneeId: string,
  assignedBy: string,
): Promise<AssignSectionResult | undefined> {
  const document = await getWorkDocument(taskId, orgId);
  if (!document) {
    return undefined;
  }

  const titel = sectionTitle.trim();
  const secties = parseDocumentSections(document.markdown);
  if (!secties.some((sectie) => sectie.title === titel)) {
    throw new UnknownSectionError(titel);
  }

  const deelnemers = await listTaskDeelnemers(taskId, orgId);
  const persoon = assigneeId.trim();
  if (!deelnemers.includes(persoon)) {
    throw new NotADeelnemerError(persoon);
  }

  const now = Date.now();
  const db = getDb();
  await db
    .insert(documentSectionAssignments)
    .values({
      id: randomUUID(),
      taskId,
      organizationId: orgId,
      sectionTitle: titel,
      assigneeId: persoon,
      assignedBy,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        documentSectionAssignments.taskId,
        documentSectionAssignments.sectionTitle,
      ],
      set: { assigneeId: persoon, assignedBy, updatedAt: now },
    });

  await createTaskEvent(
    taskId,
    "user",
    assignedBy,
    "section_assigned",
    JSON.stringify({ title: titel, assigneeId: persoon }),
  );

  return { taskId, sectionTitle: titel, assigneeId: persoon, assignedBy };
}

/** Wordt gegooid wanneer de sectie niet in het werkdocument staat. */
export class UnknownSectionError extends Error {
  readonly unknownSection = true;

  constructor(title: string) {
    super(
      `Er is geen onderdeel "${title}" in het werkdocument. Lees het werkdocument opnieuw om de onderdelen te zien.`,
    );
    this.name = "UnknownSectionError";
  }
}
