import { and, desc, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { humanTasks, tasks } from "../db/schema.js";
import { getTask, setTaskStatus } from "../tasks/store.js";

/** Status van een human task: open (wacht op antwoord) of answered. */
export type HumanTaskStatus = "open" | "answered";

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
    askedUserId,
    question: cleanQuestion,
    reason: cleanReason,
    options: JSON.stringify(cleanOptions),
    status: "open" as const,
    answer: null,
    answeredAt: null,
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

  const rows = await db
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
    return undefined;
  }

  const humanTask = toHumanTask(row);
  const remaining = await listHumanTasksForTask(humanTask.taskId, orgId);
  const stillOpen = remaining.some(
    (candidate) => candidate.id !== humanTask.id && candidate.status === "open",
  );
  if (!stillOpen) {
    await setTaskStatus(humanTask.taskId, orgId, "bezig");
  }

  return humanTask;
}
