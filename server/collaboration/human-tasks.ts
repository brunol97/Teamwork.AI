import { and, desc, eq, isNull } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { humanTasks, tasks } from "../db/schema.js";
import { getTask, setTaskStatus } from "../tasks/store.js";
import { isOrgMemberOf } from "./membership.js";

/**
 * Status van een human task: open (wacht op antwoord), answered of cancelled.
 * `cancelled` is de uitweg voor een vraag die niemand kan beantwoorden, bij
 *voorbeeld omdat het adres een typefout was.
 */
export type HumanTaskStatus = "open" | "answered" | "cancelled";

/**
 * Task status terwijl er een openstaande vraag is. De wachtstatus staat op de
 * taak zelf, niet in een vluchtig proces, zodat hij een serverherstart overleeft.
 */
export const TASK_STATUS_WAITING = "wacht op iemand";

export interface HumanTask {
  id: string;
  taskId: string;
  organizationId: string;
  askedUserId: string;
  question: string;
  reason: string;
  options: string[];
  status: HumanTaskStatus;
  answer: string | null;
  answeredAt: number | null;
  /**
   * Wanneer de agent het antwoord heeft opgepakt. null betekent: het antwoord is
   * bewaard maar de agent pakte het niet op, dus er is een hervat nodig.
   */
  resumedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateHumanTaskInput {
  taskId: string;
  orgId: string;
  askedUserId: string;
  /** Wat de agent wil. */
  question: string;
  /** Waarom de agent dit antwoord nodig heeft. */
  reason: string;
  /** De opties waaruit de persoon kiest. */
  options: string[];
}

/** Wordt gegooid wanneer een vraag een van de drie verplichte velden mist. */
export class InvalidHumanTaskError extends Error {
  readonly invalidHumanTask = true;

  constructor(message: string) {
    super(message);
    this.name = "InvalidHumanTaskError";
  }
}

/**
 * Wordt gegooid wanneer er al een open vraag op de taak staat. Twee open
 * vragen zouden de taak twee keer laten wachten, en de agent zou pas na de
 * tweede reactie verdergaan.
 */
export class OpenHumanTaskExistsError extends Error {
  readonly openQuestionExists = true;

  constructor(message: string) {
    super(message);
    this.name = "OpenHumanTaskExistsError";
  }
}

/**
 * Wordt gegooid wanneer de vraag aan iemand is gericht die geen lid is van de
 * organisatie van de aanroeper. Zo'n vraag is niet te beantwoorden: de persoon
 * ziet de organisatie niet. Zonder deze controle zet één typefout de taak vast.
 */
export class NotAnOrgMemberError extends Error {
  readonly notAMember = true;

  constructor(message: string) {
    super(message);
    this.name = "NotAnOrgMemberError";
  }
}

/** Controleert of iemand de vraag kan beantwoorden: lid van deze organisatie. */
async function assertOrgMember(orgId: string, email: string): Promise<void> {
  if (await isOrgMemberOf(orgId, email)) {
    return;
  }
  throw new NotAnOrgMemberError(
    `${email} is geen lid van deze organisatie. Een vraag kan alleen aan een lid worden gesteld, anders kan niemand antwoorden.`,
  );
}

function parseOptions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toHumanTask(row: typeof humanTasks.$inferSelect): HumanTask {
  return {
    ...row,
    options: parseOptions(row.options),
    status: row.status as HumanTaskStatus,
  };
}

/**
 * Legt een vraag van de agent aan een persoon vast en zet de taak op
 * "wacht op iemand". Alles wat nodig is om later verder te gaan staat in deze
 * rij; er is geen procesgeheugen nodig om de agent te hervatten.
 */
export async function createHumanTask({
  taskId,
  orgId,
  askedUserId,
  question,
  reason,
  options,
}: CreateHumanTaskInput): Promise<HumanTask | undefined> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return undefined;
  }

  const cleanQuestion = question.trim();
  const cleanReason = reason.trim();
  const cleanOptions = options.map((option) => option.trim()).filter(Boolean);
  const cleanAskedUserId = askedUserId.trim();

  // Een vraag aan iemand buiten de organisatie is nooit te beantwoorden, en
  // daarmee een blokkade zonder uitweg. Daarom eerst het lidmaatschap.
  await assertOrgMember(orgId, cleanAskedUserId);

  if (!cleanQuestion) {
    throw new InvalidHumanTaskError("De vraag mist wat de agent wil weten.");
  }
  if (!cleanReason) {
    throw new InvalidHumanTaskError(
      "De vraag mist waarom de agent dit antwoord nodig heeft.",
    );
  }
  if (cleanOptions.length < 2) {
    throw new InvalidHumanTaskError(
      "De vraag mist opties: geef er minstens twee waaruit de persoon kan kiezen.",
    );
  }

  // Eén open vraag per taak: twee open rijen zouden de taak twee keer laten
  // wachten, tot beide beantwoord zijn.
  const bestaand = (await listHumanTasksForTask(taskId, orgId)).find(
    (candidate) => candidate.status === "open",
  );
  if (bestaand) {
    throw new OpenHumanTaskExistsError(
      `Er staat al een open vraag op deze taak: "${bestaand.question}". Wacht op het antwoord daarvan in plaats van opnieuw te vragen.`,
    );
  }

  const db = getDb();
  const now = Date.now();
  const row = {
    id: randomUUID(),
    taskId,
    organizationId: orgId,
    askedUserId: cleanAskedUserId,
    question: cleanQuestion,
    reason: cleanReason,
    options: JSON.stringify(cleanOptions),
    status: "open" as const,
    answer: null,
    answeredAt: null,
    resumedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // De vraag en de wachtstatus horen bij elkaar: zonder de status blijft er een
  // open vraag over die de agent nooit meekrijgt. Eén transactie, dus een
  // mislukte status-schrijfactie maakt de vraag ongedaan.
  await db.transaction(async (tx) => {
    await tx.insert(humanTasks).values(row);
    const gezet = await setTaskStatus(taskId, orgId, TASK_STATUS_WAITING, tx);
    if (!gezet) {
      throw new Error(`Taak ${taskId} bestaat niet binnen organisatie ${orgId}.`);
    }
  });

  return toHumanTask(row);
}

/** Leest één vraag; alleen binnen de organisatie van de aanroeper. */
export async function getHumanTask(
  id: string,
  orgId: string,
): Promise<HumanTask | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(humanTasks)
    .where(and(eq(humanTasks.id, id), eq(humanTasks.organizationId, orgId)))
    .limit(1);

  return rows[0] ? toHumanTask(rows[0]) : undefined;
}

export interface OpenHumanTask extends HumanTask {
  /** De titel van de taak; "Wacht op jou" is namelijk niet per taak alleen. */
  taskTitle: string;
}

/**
 * De openstaande vragen van één persoon; dat is de lijst "Wacht op jou".
 * De taaktitel reist mee, zodat de lijst ook buiten de taakpagina te lezen is.
 */
export async function listOpenHumanTasks(
  orgId: string,
  askedUserId: string,
): Promise<OpenHumanTask[]> {
  const db = getDb();
  const rows = await db
    .select({ humanTask: humanTasks, taskTitle: tasks.title })
    .from(humanTasks)
    .innerJoin(tasks, eq(humanTasks.taskId, tasks.id))
    .where(
      and(
        eq(humanTasks.organizationId, orgId),
        eq(humanTasks.askedUserId, askedUserId),
        eq(humanTasks.status, "open"),
      ),
    )
    .orderBy(desc(humanTasks.createdAt));

  return rows.map((row) => ({
    ...toHumanTask(row.humanTask),
    taskTitle: row.taskTitle,
  }));
}

/** Alle vragen van een taak, nieuwste eerst; alleen binnen de organisatie. */
export async function listHumanTasksForTask(
  taskId: string,
  orgId: string,
): Promise<HumanTask[]> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return [];
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(humanTasks)
    .where(
      and(eq(humanTasks.taskId, taskId), eq(humanTasks.organizationId, orgId)),
    )
    .orderBy(desc(humanTasks.createdAt));

  return rows.map(toHumanTask);
}

/** Beantwoorde vragen binnen een project; de bron voor "eerder antwoord". */
export async function listAnsweredHumanTasksForProject(
  projectId: string,
  orgId: string,
): Promise<HumanTask[]> {
  const db = getDb();
  const rows = await db
    .select({ humanTask: humanTasks })
    .from(humanTasks)
    .innerJoin(tasks, eq(humanTasks.taskId, tasks.id))
    .where(
      and(
        eq(humanTasks.organizationId, orgId),
        eq(humanTasks.status, "answered"),
        eq(tasks.projectId, projectId),
      ),
    )
    .orderBy(desc(humanTasks.createdAt));

  return rows.map((row) => toHumanTask(row.humanTask));
}

/**
 * Slaat het antwoord op en haalt de taak uit de wachtstatus. Geeft undefined
 * terug wanneer de vraag niet bestaat of al beantwoord is.
 *
 * Het antwoord en het verlaten van de wachtstatus zijn één handeling, net als
 * het stellen van de vraag. Twee aparte schrijfacties zouden een toestand
 * achterlaten die niemand kan herstellen: de vraag is beantwoord (dus een
 * tweede poging geeft `already_answered`) terwijl de taak nog steeds op
 * "wacht op iemand" staat. Eén transactie betekent: faalt de status, dan blijft
 * de vraag openstaan en kan de mens nog gewoon antwoorden.
 */
export async function answerHumanTask({
  id,
  orgId,
  answer,
}: {
  id: string;
  orgId: string;
  answer: string;
}): Promise<HumanTask | undefined> {
  const db = getDb();
  const now = Date.now();
  let humanTask: HumanTask | undefined;

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(humanTasks)
      .set({ status: "answered", answer, answeredAt: now, updatedAt: now })
      .where(
        and(
          eq(humanTasks.id, id),
          eq(humanTasks.organizationId, orgId),
          eq(humanTasks.status, "open"),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) {
      return;
    }

    humanTask = toHumanTask(row);

    // Er staat hoogstens één vraag open per taak, dus meestal is er niets meer
    // dat de taak laat wachten. De controle blijft staan, zodat een toekomstige
    // regel die verandert de taak niet per ongeluk vrijgeeft.
    const overigeOpen = (
      await tx
        .select({ id: humanTasks.id })
        .from(humanTasks)
        .where(
          and(
            eq(humanTasks.taskId, row.taskId),
            eq(humanTasks.organizationId, orgId),
            eq(humanTasks.status, "open"),
          ),
        )
    ).filter((candidate) => candidate.id !== row.id);

    if (overigeOpen.length === 0) {
      const gezet = await setTaskStatus(row.taskId, orgId, "bezig", tx);
      if (!gezet) {
        throw new Error(
          `Taak ${row.taskId} bestaat niet binnen organisatie ${orgId}.`,
        );
      }
    }
  });

  return humanTask;
}

/**
 * Haalt een open vraag op heffing, zodat een vraag die niemand kan
 * beantwoorden (een verkeerd adres, of een vraag die niet meer nodig is) de taak
 * niet langer vastzet. De vraag blijft in het log bestaan met status
 * `cancelled`; de taak gaat terug naar "bezig". Geeft undefined terug wanneer de
 * vraag niet bestaat of niet meer openstaat.
 *
 * Net als bij het beantwoorden is het annuleren en het vrijgeven van de taak één
 * transactie: anders kan de taak op "wacht op iemand" blijven staan zonder
 * vraag, en dan is er niemand die er nog op antwoordt.
 */
export async function cancelHumanTask({
  id,
  orgId,
}: {
  id: string;
  orgId: string;
}): Promise<HumanTask | undefined> {
  const db = getDb();
  const now = Date.now();
  let humanTask: HumanTask | undefined;

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(humanTasks)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(humanTasks.id, id),
          eq(humanTasks.organizationId, orgId),
          eq(humanTasks.status, "open"),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) {
      return;
    }
    humanTask = toHumanTask(row);

    const overigeOpen = (
      await tx
        .select({ id: humanTasks.id })
        .from(humanTasks)
        .where(
          and(
            eq(humanTasks.taskId, row.taskId),
            eq(humanTasks.organizationId, orgId),
            eq(humanTasks.status, "open"),
          ),
        )
    ).filter((candidate) => candidate.id !== row.id);

    if (overigeOpen.length === 0) {
      const gezet = await setTaskStatus(row.taskId, orgId, "bezig", tx);
      if (!gezet) {
        throw new Error(
          `Taak ${row.taskId} bestaat niet binnen organisatie ${orgId}.`,
        );
      }
    }
  });

  return humanTask;
}

/**
 * Zet een open vraag over op een ander lid: dezelfde vraag, maar nu aan iemand
 * die hem wél kan beantwoorden. De taak blijft wachten, want er staat nog een
 * vraag open. Geeft undefined terug wanneer de vraag niet bestaat of niet open
 * staat; een adres dat geen lid is geeft `NotAnOrgMemberError`.
 */
export async function reassignHumanTask({
  id,
  orgId,
  askedUserId,
}: {
  id: string;
  orgId: string;
  askedUserId: string;
}): Promise<HumanTask | undefined> {
  const schoon = askedUserId.trim();
  await assertOrgMember(orgId, schoon);

  const db = getDb();
  const rows = await db
    .update(humanTasks)
    .set({ askedUserId: schoon, updatedAt: Date.now() })
    .where(
      and(
        eq(humanTasks.id, id),
        eq(humanTasks.organizationId, orgId),
        eq(humanTasks.status, "open"),
      ),
    )
    .returning();

  return rows[0] ? toHumanTask(rows[0]) : undefined;
}

/**
 * Beantwoorde vragen waarvan de agent het antwoord nog niet heeft opgepakt.
 * Dat is het geval wanneer de hervat na het antwoord mislukte: het antwoord staat
 * in de database, maar er is niemand die de agent opnieuw laat starten. Zonder
 * deze lijst blijft zo'n taak stilletjes liggen.
 */
export async function listUnresumedHumanTasks(
  orgId: string,
  taskId?: string,
): Promise<OpenHumanTask[]> {
  const db = getDb();
  const conditions = [
    eq(humanTasks.organizationId, orgId),
    eq(humanTasks.status, "answered"),
    isNull(humanTasks.resumedAt),
  ];
  if (taskId) {
    conditions.push(eq(humanTasks.taskId, taskId));
  }

  const rows = await db
    .select({ humanTask: humanTasks, taskTitle: tasks.title })
    .from(humanTasks)
    .innerJoin(tasks, eq(humanTasks.taskId, tasks.id))
    .where(and(...conditions))
    .orderBy(desc(humanTasks.answeredAt));

  return rows.map((row) => ({
    ...toHumanTask(row.humanTask),
    taskTitle: row.taskTitle,
  }));
}

/** Zet het moment waarop de agent het antwoord heeft opgepakt. */
export async function markHumanTaskResumed({
  id,
  orgId,
}: {
  id: string;
  orgId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(humanTasks)
    .set({ resumedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(humanTasks.id, id), eq(humanTasks.organizationId, orgId)));
}
