import { and, desc, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { evaluations } from "../db/schema.js";

/**
 * Evaluaties: de terugblik die een agent maakt bij het afronden van een taak,
 * gericht op verbetering van skills. Elke afronding levert er precies één op —
 * geeft de agent geen bruikbaar antwoord, dan staat er een terugval-evaluatie
 * in, zodat de afronding nooit zonder evaluatie eindigt.
 */

export interface Evaluation {
  id: string;
  taskId: string;
  organizationId: string;
  /** De agent die de evaluatie schreef, of "systeem" bij de terugval. */
  agentName: string;
  content: string;
  /** true wanneer de agent geen bruikbare evaluatie gaf en dit de terugval is. */
  fallback: boolean;
  createdAt: number;
}

/** De terugval-evaluatie wanneer het antwoord van de agent onbruikbaar is. */
export const TERUGVAL_EVALUATIE =
  "De agent kon geen evaluatie maken voor deze taak. Lees het gesprek erop na en bespreek de verbeterpunten handmatig.";

export async function recordEvaluation({
  taskId,
  orgId,
  agentName,
  content,
  fallback,
}: {
  taskId: string;
  orgId: string;
  agentName: string;
  content: string;
  fallback: boolean;
}): Promise<Evaluation> {
  const db = getDb();
  const row = {
    id: randomUUID(),
    taskId,
    organizationId: orgId,
    agentName,
    content,
    fallback: fallback ? 1 : 0,
    createdAt: Date.now(),
  };

  await db.insert(evaluations).values(row);
  return { ...row, fallback };
}

/** De evaluaties van een organisatie, eventueel van één taak; nieuwste eerst. */
export async function listEvaluations(
  orgId: string,
  taskId?: string,
): Promise<Evaluation[]> {
  const db = getDb();
  const conditions = [eq(evaluations.organizationId, orgId)];
  if (taskId) {
    conditions.push(eq(evaluations.taskId, taskId));
  }

  const rows = await db
    .select()
    .from(evaluations)
    .where(and(...conditions))
    .orderBy(desc(evaluations.createdAt));

  return rows.map((row) => ({ ...row, fallback: row.fallback === 1 }));
}
