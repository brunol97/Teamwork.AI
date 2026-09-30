import { and, desc, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { skillProposals, skillVersions, skills } from "../db/schema.js";
import { lineDiff } from "./diff.js";
import {
  createSkillVersion,
  findSkillByName,
  type Skill,
} from "./store.js";

/**
 * Skill-voorstellen: een door de agent voorgestelde wijziging aan een skill,
 * die de eigenaar goedkeurt, aanpast of afwijst. Voorstellen ontstaan uit het
 * antwoord van de agent in de taak (het vaste SKILL-VOORSTEL-formaat) en
 * verschijnen in "Wacht op jou" van de eigenaar van de skill.
 */

export type SkillProposalStatus = "open" | "goedgekeurd" | "afgewezen";

export interface SkillProposal {
  id: string;
  skillId: string;
  organizationId: string;
  baseVersion: number;
  uitleg: string;
  proposedContent: string;
  diff: string;
  status: SkillProposalStatus;
  proposedBy: string;
  decidedContent: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SkillProposalWithSkill extends SkillProposal {
  skillName: string;
}

/** Eén voorstel zoals de agent het in zijn antwoord zette, vóór validatie. */
export interface RawSkillProposal {
  name: string;
  uitleg: string;
  content: string;
}

/** Wordt gegooid wanneer iemand anders dan de eigenaar over een voorstel beslist. */
export class NotSkillOwnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotSkillOwnerError";
  }
}

function toProposal(row: typeof skillProposals.$inferSelect): SkillProposal {
  return { ...row, status: row.status as SkillProposalStatus };
}

/**
 * Leest de SKILL-VOORSTEL-blokken uit het antwoord van de agent. Elke voor
 * validatie ongeschikte blok (zonder uitleg of zonder inhoud) valt af; de
 * aanroeper controleert daarna of de genoemde skill bestaat.
 */
export function parseSkillProposals(reply: string): RawSkillProposal[] {
  const voorstellen: RawSkillProposal[] = [];
  const blokPattern =
    /^SKILL-VOORSTEL:\s*(.+)\n(?:.*\n)*?UITLEG:\s*(.*)\n(?:.*\n)*?INHOUD:\n([\s\S]*?)\n?EINDE VOORSTEL/gm;

  for (const match of reply.matchAll(blokPattern)) {
    const name = (match[1] ?? "").trim();
    const uitleg = (match[2] ?? "").trim();
    const content = (match[3] ?? "").trim();
    if (!name || !uitleg || !content) {
      continue;
    }
    voorstellen.push({ name, uitleg, content });
  }
  return voorstellen;
}

/**
 * De evaluatie is het antwoord van de agent zonder de SKILL-VOORSTEL-blokken.
 * Blijft er niets over, dan is het antwoord geen bruikbare evaluatie en maakt
 * de afronding een terugval-evaluatie.
 */
export function extractEvaluation(reply: string): string {
  return reply
    .replace(
      /^SKILL-VOORSTEL:\s*(.+)\n(?:.*\n)*?INHOUD:\n[\s\S]*?\n?EINDE VOORSTEL/gm,
      "",
    )
    .trim();
}

/**
 * Zet de voorstellen uit het antwoord van de agent om naar rijen. Een voorstel
 * voor een skill die niet in deze organisatie bestaat valt af; de diff tegen de
 * actieve versie wordt nu berekend en bewaard.
 */
export async function createSkillProposalsFromReply({
  orgId,
  reply,
  proposedBy,
}: {
  orgId: string;
  reply: string;
  proposedBy: string;
}): Promise<SkillProposal[]> {
  const raw = parseSkillProposals(reply);
  if (raw.length === 0) {
    return [];
  }

  const gemaakt: SkillProposal[] = [];
  for (const voorstel of raw) {
    const skill = await findSkillByName(orgId, voorstel.name);
    if (!skill) {
      continue;
    }

    const gemaakt_voorstel = await createSkillProposal({
      orgId,
      skillId: skill.id,
      uitleg: voorstel.uitleg,
      proposedContent: voorstel.content,
      proposedBy,
    });
    if (gemaakt_voorstel) {
      gemaakt.push(gemaakt_voorstel);
    }
  }
  return gemaakt;
}

/** Legt één voorstel vast, met de diff tegen de actieve versie erbij. */
export async function createSkillProposal({
  orgId,
  skillId,
  uitleg,
  proposedContent,
  proposedBy,
}: {
  orgId: string;
  skillId: string;
  uitleg: string;
  proposedContent: string;
  proposedBy: string;
}): Promise<SkillProposal | undefined> {
  const db = getDb();
  const skillRows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.organizationId, orgId)))
    .limit(1);
  const skill = skillRows[0];
  if (!skill) {
    return undefined;
  }

  // De diff is tegen de versie waar het voorstel op gebaseerd is; die blijft
  // bewaard zodat het voorstel ook later nog uitlegt wat er toen anders was.
  const actieveRows = await db
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.skillId, skillId),
        eq(skillVersions.version, skill.currentVersion),
      ),
    )
    .limit(1);
  const actief = actieveRows[0];
  const baseVersion = skill.currentVersion;
  const diff = lineDiff(actief?.content ?? "", proposedContent.trim());

  const now = Date.now();
  const row = {
    id: randomUUID(),
    skillId,
    organizationId: orgId,
    baseVersion,
    uitleg: uitleg.trim(),
    proposedContent: proposedContent.trim(),
    diff,
    status: "open" as const,
    proposedBy: proposedBy.trim(),
    decidedContent: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(skillProposals).values(row);
  return toProposal(row);
}

/** Leest één voorstel; alleen binnen de organisatie van de aanroeper. */
export async function getSkillProposal(
  id: string,
  orgId: string,
): Promise<SkillProposal | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(skillProposals)
    .where(
      and(eq(skillProposals.id, id), eq(skillProposals.organizationId, orgId)),
    )
    .limit(1);
  return rows[0] ? toProposal(rows[0]) : undefined;
}

/**
 * De open voorstellen waar deze persoon over mag beslissen: de skills waarvan
 * hij eigenaar is. Dit is de kant van "Wacht op jou" voor skill-voorstellen.
 */
export async function listOpenProposalsForOwner(
  orgId: string,
  ownerEmail: string,
): Promise<SkillProposalWithSkill[]> {
  const db = getDb();
  const rows = await db
    .select({ proposal: skillProposals, skillName: skills.name })
    .from(skillProposals)
    .innerJoin(skills, eq(skillProposals.skillId, skills.id))
    .where(
      and(
        eq(skillProposals.organizationId, orgId),
        eq(skills.ownerId, ownerEmail),
        eq(skillProposals.status, "open"),
      ),
    )
    .orderBy(desc(skillProposals.createdAt));

  return rows.map((row) => ({
    ...toProposal(row.proposal),
    skillName: row.skillName,
  }));
}

export type Besluit = "goedkeuren" | "afwijzen";

export interface Beslissing {
  proposal: SkillProposal;
  skill: Skill;
}

/**
 * De eigenaar beslist: goedkeuren (eventueel met aangepaste inhoud — "past
 * aan"), of afwijzen. Goedkeuren maakt een nieuwe versie actief; de oude
 * versie blijft bewaard. Afwijzen laat de actieve versie staan.
 */
export async function decideSkillProposal({
  id,
  orgId,
  decidedBy,
  besluit,
  content,
}: {
  id: string;
  orgId: string;
  decidedBy: string;
  besluit: Besluit;
  /** De inhoud zoals de eigenaar hem heeft aangepast; alleen bij goedkeuren. */
  content?: string;
}): Promise<Beslissing | undefined> {
  const db = getDb();
  const rows = await db
    .select({ proposal: skillProposals, skill: skills })
    .from(skillProposals)
    .innerJoin(skills, eq(skillProposals.skillId, skills.id))
    .where(
      and(eq(skillProposals.id, id), eq(skillProposals.organizationId, orgId)),
    )
    .limit(1);
  const gevonden = rows[0];
  if (!gevonden) {
    return undefined;
  }
  const { proposal, skill } = gevonden;

  // Alleen de menselijke eigenaar beslist; een ander lid kan het voorstel
  // hooguit bij hem aankaarten.
  if (skill.ownerId !== decidedBy.trim()) {
    throw new NotSkillOwnerError(
      `Alleen de eigenaar van de skill "${skill.name}" kan over dit voorstel beslissen.`,
    );
  }

  if (besluit === "goedkeuren") {
    // "Aanpassen": de eigenaar keurt een door hemzelf aangepaste inhoud goed.
    // De inhoud blijft precies zoals hij is aangeleverd; alleen leegte wordt
    // geweigerd, want een lege versie is geen skill.
    const inhoud = content !== undefined ? content : proposal.proposedContent;
    if (!inhoud.trim()) {
      return undefined;
    }
    const version = await createSkillVersion({
      orgId,
      skillId: skill.id,
      content: inhoud,
      createdBy: decidedBy.trim(),
    });
    if (!version) {
      return undefined;
    }

    const updated = await db
      .update(skillProposals)
      .set({
        status: "goedgekeurd",
        decidedContent: inhoud,
        decidedBy: decidedBy.trim(),
        decidedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(skillProposals.id, id),
          eq(skillProposals.organizationId, orgId),
          eq(skillProposals.status, "open"),
        ),
      )
      .returning();

    return updated[0]
      ? {
          proposal: toProposal(updated[0]),
          skill: { ...skill, currentVersion: version.version },
        }
      : undefined;
  }

  const updated = await db
    .update(skillProposals)
    .set({
      status: "afgewezen",
      decidedBy: decidedBy.trim(),
      decidedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(skillProposals.id, id),
        eq(skillProposals.organizationId, orgId),
        eq(skillProposals.status, "open"),
      ),
    )
    .returning();

  return updated[0]
    ? { proposal: toProposal(updated[0]), skill }
    : undefined;
}

/** Alle voorstellen van één skill, nieuwste eerst; alleen binnen de organisatie. */
export async function listProposalsForSkill(
  skillId: string,
  orgId: string,
): Promise<SkillProposal[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(skillProposals)
    .where(
      and(
        eq(skillProposals.skillId, skillId),
        eq(skillProposals.organizationId, orgId),
      ),
    )
    .orderBy(desc(skillProposals.createdAt));
  return rows.map(toProposal);
}
