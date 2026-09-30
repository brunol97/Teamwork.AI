/**
 * Kosten van agentwerk per taak. De taak telt bij elkaar op wat de agent-activiteit
 * kost en pauzeert bij de grens van €10 (1000 cent). Er is nog geen exacte
 * tokenrekening van de LLM-route, dus de kosten worden geschat op basis van het
 * aantal tekens dat heen en weer gaat; de schatting is deterministisch, zodat
 * tests en herhalingen hetzelfde uitkomen.
 */

/** Aantal tekens per geschat token; grofweg vier tekens per woorddeel. */
const CHARS_PER_TOKEN = 4;

/** Prijs per 1000 tokens, in eurocenten. */
const CENTS_PER_1000_TOKENS = 1;

export function estimateCostCents(
  promptChars: number,
  responseChars: number,
): number {
  const tokens = Math.ceil((promptChars + responseChars) / CHARS_PER_TOKEN);
  return Math.ceil((tokens / 1000) * CENTS_PER_1000_TOKENS);
}
