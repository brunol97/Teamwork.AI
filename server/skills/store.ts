import { and, eq, inArray } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";

import { getDb } from "../db/client.js";
import { skillVersions, skills } from "../db/schema.js";

/**
 * Skills: een herbruikbaar recept in SKILL.md-formaat, met een menselijke
 * eigenaar en een versiegeschiedenis. De actieve versie staat op de rij van de
 * skill; oudere versies blijven in `skill_versions` bewaard en leesbaar.
 */

export interface Skill {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  ownerId: string;
  currentVersion: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  organizationId: string;
  version: number;
  content: string;
  createdBy: string;
  createdAt: number;
}

/** Wat de promptbouwer van een skill nodig heeft: naam, versie en inhoud. */
export interface SkillContent {
  id: string;
  name: string;
  version: number;
  content: string;
}

export interface SkillWithContent extends Skill {
  currentContent: string;
}

export interface SkillWithVersions {
  skill: Skill;
  /** Alle versies, oudste eerst; oude versies blijven bewaard en leesbaar. */
  versions: SkillVersion[];
}

export class DuplicateSkillNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateSkillNameError";
  }
}

export class EmptySkillContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptySkillContentError";
  }
}

function toSkill(row: typeof skills.$inferSelect): Skill {
  return row;
}

function toVersion(row: typeof skillVersions.$inferSelect): SkillVersion {
  return row;
}

/**
 * Maakt een skill aan als versie 1. De eigenaar is de mens die hem aanmaakt;
 * alleen hij keurt later voorstellen goed, past ze aan of wijst ze af.
 */
export async function createSkill({
  orgId,
  name,
  description = "",
  content,
  ownerId,
}: {
  orgId: string;
  name: string;
  description?: string;
  content: string;
  ownerId: string;
}): Promise<Skill> {
  const schoneNaam = name.trim();
  if (!schoneNaam) {
    throw new EmptySkillContentError("Een skill heeft een naam nodig.");
  }
  // De inhoud blijft precies zoals de auteur hem schreef; alleen leegte wordt
  // geweigerd. Zo blijft een vergeleken versie exact de tekst die erin ging.
  if (!content.trim()) {
    throw new EmptySkillContentError("Een skill heeft inhoud nodig.");
  }

  const bestaand = await findSkillByName(orgId, schoneNaam);
  if (bestaand) {
    throw new DuplicateSkillNameError(
      `Er bestaat al een skill met deze naam in deze organisatie: "${bestaand.name}".`,
    );
  }

  const db = getDb();
  const now = Date.now();
  const skillId = randomUUID();
  const versionId = randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(skills).values({
      id: skillId,
      organizationId: orgId,
      name: schoneNaam,
      description: description.trim(),
      ownerId: ownerId.trim(),
      currentVersion: 1,
      createdBy: ownerId.trim(),
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(skillVersions).values({
      id: versionId,
      skillId,
      organizationId: orgId,
      version: 1,
      content,
      createdBy: ownerId.trim(),
      createdAt: now,
    });
  });

  return {
    id: skillId,
    organizationId: orgId,
    name: schoneNaam,
    description: description.trim(),
    ownerId: ownerId.trim(),
    currentVersion: 1,
    createdBy: ownerId.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Voegt een nieuwe versie toe en maakt hem actief; de oude versie blijft staan. */
export async function createSkillVersion({
  orgId,
  skillId,
  content,
  createdBy,
}: {
  orgId: string;
  skillId: string;
  content: string;
  createdBy: string;
}): Promise<SkillVersion | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.organizationId, orgId)))
    .limit(1);
  const skill = rows[0];
  if (!skill) {
    return undefined;
  }

  const hoogste = (
    await db
      .select({ version: skillVersions.version })
      .from(skillVersions)
      .where(eq(skillVersions.skillId, skillId))
  ).reduce((hoogste, row) => Math.max(hoogste, row.version), 0);
  const version = hoogste + 1;
  const now = Date.now();
  const versionId = randomUUID();

  // De nieuwe versie en de actieve verwijzing horen bij elkaar: zonder de
  // verwijzing zou de skill op een oudere versie blijven hangen.
  await db.transaction(async (tx) => {
    await tx.insert(skillVersions).values({
      id: versionId,
      skillId,
      organizationId: orgId,
      version,
      content,
      createdBy: createdBy.trim(),
      createdAt: now,
    });
    await tx
      .update(skills)
      .set({ currentVersion: version, updatedAt: now })
      .where(and(eq(skills.id, skillId), eq(skills.organizationId, orgId)));
  });

  return {
    id: versionId,
    skillId,
    organizationId: orgId,
    version,
    content,
    createdBy: createdBy.trim(),
    createdAt: now,
  };
}

/** Alle skills van de organisatie, met de actieve inhoud erbij. */
export async function listSkills(orgId: string): Promise<SkillWithContent[]> {
  const db = getDb();
  const skillRows = await db
    .select()
    .from(skills)
    .where(eq(skills.organizationId, orgId));
  if (skillRows.length === 0) {
    return [];
  }

  const versionRows = await db
    .select()
    .from(skillVersions)
    .where(
      inArray(
        skillVersions.skillId,
        skillRows.map((skill) => skill.id),
      ),
    );

  return skillRows.map((skill) => {
    const actief = versionRows.find(
      (version) =>
        version.skillId === skill.id && version.version === skill.currentVersion,
    );
    return {
      ...toSkill(skill),
      currentContent: actief?.content ?? "",
    };
  });
}

/** Leest één skill met zijn volledige versiegeschiedenis, oudste eerst. */
export async function getSkill(
  id: string,
  orgId: string,
): Promise<SkillWithVersions | undefined> {
  const db = getDb();
  const skillRows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, id), eq(skills.organizationId, orgId)))
    .limit(1);
  const skill = skillRows[0];
  if (!skill) {
    return undefined;
  }

  const versions = await db
    .select()
    .from(skillVersions)
    .where(eq(skillVersions.skillId, skill.id));
  versions.sort((a, b) => a.version - b.version);

  return { skill: toSkill(skill), versions: versions.map(toVersion) };
}

/** Zoekt een skill op naam, zonder hoofdlettergevoeligheid. */
export async function findSkillByName(
  orgId: string,
  name: string,
): Promise<Skill | undefined> {
  const alle = await listSkills(orgId);
  const needle = name.trim().toLowerCase();
  return alle.find((skill) => skill.name.toLowerCase() === needle);
}

/**
 * Zet de skillnamen van een agent om naar de actieve inhoud, op het moment van
 * aanroepen. Een naam die in deze organisatie geen skill is, valt weg: de
 * prompt noemt hem dan alleen als naam.
 */
export async function getActiveSkillsForAgent(
  orgId: string,
  names: string[],
): Promise<SkillContent[]> {
  if (names.length === 0) {
    return [];
  }

  const inhoud = new Map<string, SkillContent>();
  for (const skill of await listSkills(orgId)) {
    inhoud.set(skill.name.toLowerCase(), {
      id: skill.id,
      name: skill.name,
      version: skill.currentVersion,
      content: skill.currentContent,
    });
  }

  const gevonden: SkillContent[] = [];
  for (const name of names) {
    const skill = inhoud.get(name.trim().toLowerCase());
    if (skill) {
      gevonden.push(skill);
    }
  }
  return gevonden;
}
