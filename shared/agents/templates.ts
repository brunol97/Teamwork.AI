/**
 * Sjablonen voor nieuwe agents. Een klein aantal ingebouwde Nederlandse
 * sjablonen is genoeg voor het MVP: de maker kiest een sjabloon of begint
 * leeg, en alle velden zijn daarna gewoon te bewerken. Dit bestand is
 * isomorf: zowel de interface als de server leest het.
 */

export interface AgentTemplate {
  id: string;
  naam: string;
  omschrijving: string;
  tools: string[];
  skills: string[];
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "onderzoeker",
    naam: "Onderzoeker",
    omschrijving:
      "Verzamelt informatie, vergelijkt opties en legt keuzes vast in het werkdocument.",
    tools: ["web-zoeken", "werkdocument-lezen"],
    skills: [],
  },
  {
    id: "schrijver",
    naam: "Schrijver",
    omschrijving:
      "Schrijft en herschrijft teksten in de stijl van de organisatie.",
    tools: ["werkdocument-lezen", "werkdocument-schrijven"],
    skills: [],
  },
  {
    id: "reviewer",
    naam: "Reviewer",
    omschrijving:
      "Leest werk na en geeft concrete verbetervoorstellen, zonder zelf te schrijven.",
    tools: ["werkdocument-lezen"],
    skills: [],
  },
];

/** Het model dat een agent gebruikt als er geen eigen model is gekozen. */
export const DEFAULT_AGENT_MODEL = "gpt-oss:120b";
