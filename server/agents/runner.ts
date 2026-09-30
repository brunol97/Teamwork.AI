import type { OllamaMessage } from "../llm/ollama.js";
import { estimateCostCents } from "./cost.js";
import type { AgentConfig } from "./store.js";
import type { SkillContent } from "../skills/store.js";

/**
 * De regels van een agentbeurt: de systeemprompt van een agent, het aanroepen
 * met @naam, en het uitbesteden aan een andere agent. De agent-chat
 * (`send-task-message`) is de enige weg naar de LLM; deze module beslist alleen
 * wíé er spreekt en met welke rechten.
 *
 * Twee vaste regels uit de MVP-specificatie:
 * - **Rechten stapelen niet.** Een agent krijgt alleen de tools die hij zelf
 *   heeft. Besteedt hij uit aan een andere agent, dan draait die andere agent
 *   met alleen zijn eigen tools, nooit met de vereniging van beide.
 * - **Delegatiediepte is maximaal 2.** De actieve agent mag uitbesteden, de
 *   uitbesteede agent mag nog één keer uitbesteden, en een derde niveau wordt
 *   geweigerd met een duidelijke melding.
 */

/** Hoeveel niveaus er maximaal mogen zijn: de actieve agent (1) en één uitbesteede agent (2). */
export const MAX_DELEGATION_DEPTH = 2;

/** Het begin van de regel waarmee een agent een deeltaak uitbesteedt. */
export const DELEGATION_PREFIX = "UITBESTEED AAN";

/** Functie die het antwoord van de LLM levert; in product `generateOllamaResponse`. */
export type AgentGenerate = (
  system: string,
  messages: OllamaMessage[],
  options?: { model?: string },
) => Promise<string>;

export interface AgentTurnResult {
  /** Het antwoord van de agent, met het resultaat van een uitbesteding eronder. */
  reply: string;
  /** De uitbesteding die de agent in zijn antwoord vroeg, als die er was. */
  delegation: {
    name: string;
    opdracht: string;
    /** true wanneer de uitbesteede agent daadwerkelijk geantwoord heeft. */
    ok: boolean;
  } | null;
  /** Waarom een uitbesteding geweigerd is, in het Nederlands; null als er niets geweigerd is. */
  refusal: string | null;
  /** Geschatte kosten van alle LLM-aanroepen in deze beurt, in eurocenten. */
  costCents: number;
}

export function defaultSystemPrompt(taskTitle: string): string {
  return `Je bent een behulpzame agent in Agent Office. Je werkt mee aan de taak "${taskTitle}". Reageer in het Nederlands tenzij de gebruiker anders vraagt. Houd antwoorden kort en bondig.`;
}

/**
 * De systeemprompt van een eigen agent. De tools en skills in de prompt zijn
 * precies die van deze agent: zo krijgt een ingeschakelde agent nooit tools
 * die hij zelf niet heeft, ook niet wanneer hij via een uitbesteding wordt
 * aangeroepen.
 */
export function buildAgentSystemPrompt(
  agent: AgentConfig,
  taskTitle: string,
  skills?: SkillContent[],
): string {
  const lines = [
    `Je bent de agent "${agent.name}" in Agent Office en werkt mee aan de taak "${taskTitle}".`,
  ];
  if (agent.description.trim()) {
    lines.push(`Omschrijving: ${agent.description.trim()}`);
  }
  lines.push(
    `Je beschikt alleen over de volgende tools: ${
      agent.tools.length > 0 ? agent.tools.join(", ") : "geen"
    }.`,
  );
  lines.push(
    `Je beschikt alleen over de volgende skills: ${
      agent.skills.length > 0 ? agent.skills.join(", ") : "geen"
    }.`,
  );
  // Skills uit de bibliotheek van de organisatie gaan met hun volledige
  // SKILL.md-inhoud mee, in de versie die op het moment van aanroepen actief
  // is. Zo gebruikt een agent na een goedgekeurd voorstel meteen de nieuwe
  // versie, zonder dat iemand hem hoeft bij te werken.
  if (skills && skills.length > 0) {
    lines.push("De volledige inhoud van je skills (actieve versie):");
    for (const skill of skills) {
      lines.push(`--- Skill: ${skill.name} (versie ${skill.version}) ---`);
      lines.push(skill.content);
    }
  }
  lines.push(
    `Je kunt een deeltaak uitbesteden aan een andere agent: begin dan een regel met "${DELEGATION_PREFIX} @naam:" gevolgd door de opdracht.`,
  );
  lines.push(
    "Reageer in het Nederlands tenzij de gebruiker anders vraagt. Houd antwoorden kort en bondig.",
  );
  return lines.join("\n");
}

/**
 * Leest de @naam-aanroep uit het bericht van de gebruiker en geeft de eerste
 * genoemde ingeschakelde agent terug, of null wanneer er geen passende agent
 * is. Een naam wordt op één woord na het @-teken gematcht, zonder
 * hoofdlettergevoeligheid.
 */
export function parseMention(
  message: string,
  agents: AgentConfig[],
): AgentConfig | null {
  const pattern = /@([\p{L}\p{N}_-]+)/gu;
  for (const match of message.matchAll(pattern)) {
    const needle = (match[1] ?? "").toLowerCase();
    const agent = agents.find(
      (candidate) =>
        candidate.enabled && candidate.name.toLowerCase() === needle,
    );
    if (agent) {
      return agent;
    }
  }
  return null;
}

export interface DelegationRequest {
  name: string;
  opdracht: string;
}

/**
 * Leest de uitbestedingsregel uit het antwoord van een agent: een regel die
 * begint met "UITBESTEED AAN @naam:" en daarachter de opdracht draagt. Zonder
 * zo'n regel is er geen uitbesteding.
 */
export function parseDelegation(reply: string): DelegationRequest | null {
  const pattern = new RegExp(
    `^${DELEGATION_PREFIX}\\s+@([\\p{L}\\p{N}_-]+):\\s*(.+)$`,
    "imu",
  );
  const match = reply.match(pattern);
  if (!match) {
    return null;
  }
  return { name: match[1] ?? "", opdracht: (match[2] ?? "").trim() };
}

function promptChars(system: string, messages: OllamaMessage[]): number {
  return system.length + messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Laat één agent aan het woord. De agent antwoordt op de berichten; vraagt hij
 * in zijn antwoord om een uitbesteding, dan draait de gevraagde agent (met
 * alleen zijn eigen tools) één niveau dieper. Een derde niveau wordt geweigerd.
 */
export async function runAgentTurn({
  taskTitle,
  agents,
  agent,
  messages,
  depth = 1,
  generate,
  resolveSkills,
}: {
  taskTitle: string;
  /** Alle agents van de organisatie, zodat de uitbesteding binnen de organisatie blijft. */
  agents: AgentConfig[];
  /** De agent die nu spreekt, of null voor de standaardagent. */
  agent: AgentConfig | null;
  messages: OllamaMessage[];
  depth?: number;
  generate: AgentGenerate;
  /**
   * Zet de skillnamen van de sprekende agent om naar de actieve inhoud, op
   * het moment van aanroepen. Zo gebruikt de agent altijd de nieuwste
   * goedgekeurde versie van elke skill.
   */
  resolveSkills?: (agent: AgentConfig) => Promise<SkillContent[]>;
}): Promise<AgentTurnResult> {
  const skills = agent && resolveSkills ? await resolveSkills(agent) : undefined;
  const system = agent
    ? buildAgentSystemPrompt(agent, taskTitle, skills)
    : defaultSystemPrompt(taskTitle);
  const reply = await generate(
    system,
    messages,
    agent?.model ? { model: agent.model } : undefined,
  );
  const costCents = estimateCostCents(
    promptChars(system, messages),
    reply.length,
  );

  const delegation = parseDelegation(reply);
  if (!delegation) {
    return { reply, delegation: null, refusal: null, costCents };
  }

  // Een derde delegatieniveau wordt geweigerd met een duidelijke melding: de
  // actieve agent (niveau 1) en één uitbesteede agent (niveau 2) mogen, meer niet.
  if (depth >= MAX_DELEGATION_DEPTH) {
    return {
      reply,
      delegation: { ...delegation, ok: false },
      refusal: `Uitbesteden aan @${delegation.name} is geweigerd: de delegatiediepte is maximaal ${MAX_DELEGATION_DEPTH} en een derde niveau is niet toegestaan.`,
      costCents,
    };
  }

  const target = agents.find(
    (candidate) =>
      candidate.name.toLowerCase() === delegation.name.toLowerCase() &&
      candidate.enabled,
  );
  if (!target) {
    return {
      reply,
      delegation: { ...delegation, ok: false },
      refusal: `Uitbesteden aan @${delegation.name} is niet gelukt: die agent bestaat niet in deze organisatie of is uitgeschakeld.`,
      costCents,
    };
  }

  const subTurn = await runAgentTurn({
    taskTitle,
    agents,
    agent: target,
    // Een eigen thread: de uitbesteede agent krijgt alleen zijn eigen deeltaak,
    // niet het gesprek van de actieve agent.
    messages: [{ role: "user", content: delegation.opdracht }],
    depth: depth + 1,
    generate,
    resolveSkills,
  });

  return {
    reply: `${reply}\n\n(uitbesteed aan @${target.name})\n\n${subTurn.reply}`,
    delegation: { ...delegation, ok: true },
    refusal: subTurn.refusal,
    costCents: costCents + subTurn.costCents,
  };
}
