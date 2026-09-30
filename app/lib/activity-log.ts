export type ActivityEvent = {
  id: string;
  type: string;
  actorType: string;
  /** De naam van de agent die sprak, of de e-mail van de gebruiker. */
  actorId?: string | null;
  data: string | null;
};

/** Leest het JSON-payload van een gebeurtenis, of null als het er geen is. */
function payload(data: string | null): Record<string, unknown> | null {
  if (!data) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Maakt van een gebeurtenis uit het activiteitenlog een Nederlandse zin. De
 * payload van een gebeurtenis is JSON; zonder tak per type toont de taakpagina
 * dus de ruwe JSON in plaats van de gebeurtenis. Elke type met een JSON-payload
 * krijgt daarom een eigen tak, en een onbekend type valt terug op de ruwe tekst.
 */
export function describeEvent(event: ActivityEvent): {
  actor: string;
  text: string;
} {
  const actor =
    event.actorType === "agent"
      ? event.actorId && event.actorId !== "ollama"
        ? `Agent ${event.actorId}`
        : "Agent"
      : event.actorType === "system"
        ? "Systeem"
        : "Jij";

  if (event.type === "agent_changed") {
    return { actor, text: `De actieve agent is nu ${event.data}.` };
  }
  if (event.type === "agent_delegated") {
    return { actor, text: `Uitbesteed aan ${event.data}.` };
  }
  if (event.type === "delegation_refused") {
    return { actor, text: event.data ?? "Uitbesteden is geweigerd." };
  }
  if (event.type === "budget_gepauzeerd") {
    return { actor, text: event.data ?? "De taak is gepauzeerd." };
  }

  if (event.type === "document_section_added") {
    return {
      actor,
      text: `Sectie "${event.data}" toegevoegd aan het werkdocument.`,
    };
  }
  if (event.type === "document_changed") {
    return { actor, text: "Werkdocument bewerkt." };
  }
  if (event.type === "human_task_answered") {
    const data = payload(event.data);
    const vraag = text(data?.question);
    const antwoord = text(data?.answer);
    return {
      actor,
      text: vraag
        ? `Op "${vraag}" is geantwoord: ${antwoord ?? "onbekend"}.`
        : `Er is geantwoord met: ${antwoord ?? "onbekend"}.`,
    };
  }
  if (event.type === "human_task_resume_failed") {
    const vraag = text(payload(event.data)?.question);
    return {
      actor,
      text: vraag
        ? `Het antwoord op "${vraag}" is bewaard, maar de agent kon daarna niet verdergaan.`
        : "Het antwoord is bewaard, maar de agent kon daarna niet verdergaan.",
    };
  }

  return { actor, text: event.data ?? "" };
}
