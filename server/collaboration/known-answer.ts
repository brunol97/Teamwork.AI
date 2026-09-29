import { getWorkDocument } from "../documents/store.js";
import { getTask } from "../tasks/store.js";
import { listAnsweredHumanTasksForProject, type HumanTask } from "./human-tasks.js";

/**
 * De agent zoekt vóór hij vraagt. Staat het antwoord al in het werkdocument van
 * de taak, of is er binnen het project al een eerdere vraag met hetzelfde
 * antwoord beantwoord, dan stelt de agent de vraag niet opnieuw.
 */

export type KnownAnswerSource = "werkdocument" | "eerder antwoord";

export interface KnownAnswer {
  /** De optie waarvan het antwoord al bekend is. */
  option: string;
  source: KnownAnswerSource;
  /** Waar het antwoord staat, zodat de agent dit kan aanhalen. */
  snippet: string;
}

/** Haalt tekens weg die bij het vergelijken niet betekenis hebben. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .trim();
}

function snippetAround(source: string, option: string): string {
  const haystack = normalizeText(source);
  const needle = normalizeText(option);
  const at = haystack.indexOf(needle);
  if (at === -1) {
    return source.trim().slice(0, 200);
  }
  const start = Math.max(0, at - 60);
  return source.trim().slice(start, at + needle.length + 60);
}

/**
 * Zoekt welke optie in de bronnen staat. De regel is niet "de eerste optie uit
 * de lijst die voorkomt", maar "de optie die de tekst draagt":
 *
 * - Staat er geen enkele optie in de tekst, dan is er geen bekend antwoord.
 * - Staat er precies één optie, dan is dát het bekende antwoord — ook als die
 *   niet de eerste in de lijst staat.
 * - Staan er meerdere, dan kiest de tekst niets: "we moeten kiezen tussen
 *   Postgres en MongoDB" is geen keuze. Dan blijft het antwoord onbekend en
 *   mag de agent alsnog vragen. Liever een vraag te veel dan een antwoord dat
 *   de mens nooit gaf.
 */
function findOptionInText(
  sources: { source: KnownAnswerSource; text: string }[],
  options: string[],
): KnownAnswer | null {
  const matches: {
    option: string;
    source: KnownAnswerSource;
    text: string;
  }[] = [];

  for (const option of options) {
    const needle = normalizeText(option);
    // Een optie van één of twee letters ("Ja") levert te veel toevallige
    // treffers; daarvoor geldt de regel niet.
    if (needle.length < 4) {
      continue;
    }
    for (const candidate of sources) {
      if (normalizeText(candidate.text).includes(needle)) {
        matches.push({
          option,
          source: candidate.source,
          text: candidate.text,
        });
      }
    }
  }

  const distinct = new Set(matches.map((match) => match.option));
  if (distinct.size !== 1) {
    return null;
  }

  const match = matches[0];
  return {
    option: match.option,
    source: match.source,
    snippet: snippetAround(match.text, match.option),
  };
}

/** Woorden van minimaal vier letters; korte woorden geven te veel toeval. */
function significantWords(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((word) => word.length >= 4),
  );
}

/** Een eerdere vraag telt alleen mee als hij over hetzelfde onderwerp ging. */
function sameSubject(previousQuestion: string, question: string): boolean {
  const previous = significantWords(previousQuestion);
  const current = significantWords(question);
  for (const word of current) {
    if (previous.has(word)) {
      return true;
    }
  }
  return false;
}

export interface FindKnownAnswerInput {
  taskId: string;
  orgId: string;
  question: string;
  options: string[];
}

/**
 * Zoekt het antwoord op de vraag in het werkdocument van de taak en in de
 * eerder gegeven antwoorden binnen hetzelfde project. Geeft null terug wanneer
 * het antwoord nergens staat; dan is het legitiem om de vraag te stellen.
 */
export async function findKnownAnswer({
  taskId,
  orgId,
  question,
  options,
}: FindKnownAnswerInput): Promise<KnownAnswer | null> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return null;
  }

  const sources: { source: KnownAnswerSource; text: string }[] = [];

  const document = await getWorkDocument(taskId, orgId);
  if (document?.markdown) {
    sources.push({ source: "werkdocument", text: document.markdown });
  }

  const answered: HumanTask[] = await listAnsweredHumanTasksForProject(
    task.projectId,
    orgId,
  );
  for (const previous of answered) {
    // Alleen het antwoord zelf is een bron. De vraagtekst noemt per definitie
    // alle opties, dus meenemen zou elke optie als "bekend" doen lijken.
    if (previous.answer && sameSubject(previous.question, question)) {
      sources.push({ source: "eerder antwoord", text: previous.answer });
    }
  }

  if (sources.length === 0) {
    return null;
  }

  return findOptionInText(sources, options);
}
