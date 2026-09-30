import { and, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { agents } from "../db/schema.js";

/** Hoe een agent er voor de agent-loop uitziet: alleen wat de loop nodig heeft. */
export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  skills: string[];
  enabled: boolean;
}

export interface Agent extends AgentConfig {
  organizationId: string;
  template: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAgentInput {
  orgId: string;
  name: string;
  description?: string;
  model?: string | null;
  tools?: string[];
  skills?: string[];
  template?: string | null;
  createdBy: string;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  model?: string | null;
  tools?: string[];
  skills?: string[];
  enabled?: boolean;
}

function toAgent(row: {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  model: string | null;
  tools: string;
  skills: string;
  enabled: number;
  template: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}): Agent {
  return {
    ...row,
    tools: JSON.parse(row.tools) as string[],
    skills: JSON.parse(row.skills) as string[],
    enabled: row.enabled === 1,
  };
}

/**
 * Een nieuwe agent is een bron van de organisatie en dus direct beschikbaar in
 * alle taken van die organisatie: er staat geen taakverwijzing op de rij.
 */
export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const db = getDb();
  const now = Date.now();
  const row = {
    id: randomUUID(),
    organizationId: input.orgId,
    name: input.name,
    description: input.description ?? "",
    model: input.model ?? null,
    tools: JSON.stringify(input.tools ?? []),
    skills: JSON.stringify(input.skills ?? []),
    enabled: 1,
    template: input.template ?? null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(agents).values(row);
  return toAgent(row);
}

/** Alle agents van de organisatie, oudste eerst. */
export async function listAgents(orgId: string): Promise<Agent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.organizationId, orgId));

  // Oudste eerst, zoals de meldingenlijst en de takenlijst ook rekenen.
  return rows.map(toAgent).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getAgent(
  id: string,
  orgId: string,
): Promise<Agent | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.organizationId, orgId)))
    .limit(1);

  return rows[0] ? toAgent(rows[0]) : undefined;
}

/**
 * Vindt een agent op naam, zoals hij met @naam aangeroepen wordt. De vergelijking
 * is niet hoofdlettergevoelig. Geeft ook uitgeschakelde agents terug; de aanroeper
 * beslist wat daarmee gebeurt.
 */
export async function getAgentByName(
  name: string,
  orgId: string,
): Promise<Agent | undefined> {
  const all = await listAgents(orgId);
  const needle = name.toLowerCase();
  return all.find((agent) => agent.name.toLowerCase() === needle);
}

/**
 * Werkt de velden van een agent bij. De organisatiegrens zit in de `where` van de
 * schrijfactie zelf, zodat de update nooit een agent van een andere organisatie
 * raakt. Geeft de bijgewerkte agent terug, of undefined wanneer er geen agent met
 * dat id in deze organisatie is.
 */
export async function updateAgent(
  id: string,
  orgId: string,
  patch: UpdateAgentInput,
): Promise<Agent | undefined> {
  const db = getDb();
  const values: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.model !== undefined) values.model = patch.model;
  if (patch.tools !== undefined) values.tools = JSON.stringify(patch.tools);
  if (patch.skills !== undefined) values.skills = JSON.stringify(patch.skills);
  if (patch.enabled !== undefined) values.enabled = patch.enabled ? 1 : 0;

  const rows = await db
    .update(agents)
    .set(values)
    .where(and(eq(agents.id, id), eq(agents.organizationId, orgId)))
    .returning();

  return rows[0] ? toAgent(rows[0]) : undefined;
}

/**
 * Verwijdert een agent uit de organisatie. Taken die hem als actieve agent
 * hadden vallen daarna terug op de standaardagent; de aanroeper van de
 * agent-loop lost dat op door alleen binnen de organisatie te zoeken.
 */
export async function deleteAgent(
  id: string,
  orgId: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(agents)
    .where(and(eq(agents.id, id), eq(agents.organizationId, orgId)))
    .returning({ id: agents.id });

  return rows.length > 0;
}
