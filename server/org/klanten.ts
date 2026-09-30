import { and, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { customers } from "../db/schema.js";

/**
 * Klant: de opdrachtgever van de organisatie waarvoor projecten worden
 * uitgevoerd. Klanten zijn optioneel: een project staat direct onder de
 * organisatie of onder een klant (projects.customer_id, al sinds P1).
 */
export interface Klant {
  id: string;
  organizationId: string;
  name: string;
  archived: boolean;
  createdAt: number;
}

export async function createKlant(orgId: string, name: string): Promise<Klant> {
  const db = getDb();
  const now = Date.now();
  const id = randomUUID();

  await db.insert(customers).values({
    id,
    organizationId: orgId,
    name,
    archived: 0,
    createdAt: now,
    updatedAt: now,
  });

  return { id, organizationId: orgId, name, archived: false, createdAt: now };
}

export async function listKlanten(orgId: string): Promise<Klant[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.organizationId, orgId));

  return rows
    .map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      archived: row.archived === 1,
      createdAt: row.createdAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt);
}

export async function getKlant(
  klantId: string,
  orgId: string,
): Promise<Klant | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, klantId), eq(customers.organizationId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    archived: row.archived === 1,
    createdAt: row.createdAt,
  };
}

export async function archiveKlant(
  klantId: string,
  orgId: string,
): Promise<Klant | undefined> {
  const db = getDb();
  const klant = await getKlant(klantId, orgId);
  if (!klant) return undefined;

  await db
    .update(customers)
    .set({ archived: 1, updatedAt: Date.now() })
    .where(and(eq(customers.id, klantId), eq(customers.organizationId, orgId)));

  return { ...klant, archived: true };
}

/** De klantnamen van de projecten in het overzicht; null wanneer het project direct onder de organisatie staat. */
export async function klantNamenVoorProjecten(
  orgId: string,
): Promise<Map<string, string>> {
  const rows = await listKlanten(orgId);
  return new Map(
    rows.map((klant) => [klant.id, klant.archived ? `${klant.name} (gearchiveerd)` : klant.name]),
  );
}
