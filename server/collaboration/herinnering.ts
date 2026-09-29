import { isEmailConfigured, sendEmail } from "@agent-native/core/server";

import type { HumanTask } from "./human-tasks.js";

/**
 * Een herinnering is het bericht waarmee de agent een persoon eraan herinnert
 * dat er een human task op hem of haar wacht. Dat is bewust iets anders dan een
 * melding: een melding vraagt geen antwoord en pauzeert de taak niet
 * (`CONTEXT.md`), en een herinnering doet allebei. Zonder herinnering leert
 * iemand de vraag alleen als diegene toevallig de takenlijst of de taakpagina
 * opent.
 *
 * De herinnering wordt over de bestaande mailroute van het framework gestuurd
 * (Resend in productie). Is er geen mailtransport ingericht, dan blijft de
 * vraag gewoon in "Wacht op jou" staan: een mislukte mail mag de vraag of de
 * taak nooit blokkeren.
 */
export interface Herinnering {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface BuildHerinneringInput {
  humanTask: HumanTask;
  taskTitle: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildHerinnering({
  humanTask,
  taskTitle,
}: BuildHerinneringInput): Herinnering {
  const subject = `De agent wacht op jouw antwoord: ${taskTitle}`;
  const opties = humanTask.options.map((optie) => `- ${optie}`).join("\n");
  const optiesHtml = humanTask.options
    .map((optie) => `<li>${escapeHtml(optie)}</li>`)
    .join("");

  const text = [
    `De agent werkt aan "${taskTitle}" en heeft een vraag aan jou.`,
    "",
    "Wat wil de agent weten?",
    humanTask.question,
    "",
    "Waarom heeft de agent dit antwoord nodig?",
    humanTask.reason,
    "",
    "Waaruit kun je kiezen?",
    opties,
    "",
    "De taak wacht op je antwoord. Beantwoord de vraag in Agent Office in 'Wacht op jou', op de takenlijst of op de taakpagina.",
  ].join("\n");

  const html = [
    "<p>" +
      escapeHtml(
        `De agent werkt aan "${taskTitle}" en heeft een vraag aan jou. De taak wacht op je antwoord.`,
      ) +
      "</p>",
    "<h2>Wat wil de agent weten?</h2>",
    `<p>${escapeHtml(humanTask.question)}</p>`,
    "<h2>Waarom heeft de agent dit antwoord nodig?</h2>",
    `<p>${escapeHtml(humanTask.reason)}</p>`,
    "<h2>Waaruit kun je kiezen?</h2>",
    `<ul>${optiesHtml}</ul>`,
    "<p>Beantwoord de vraag in Agent Office in 'Wacht op jou', op de takenlijst of op de taakpagina.</p>",
  ].join("");

  return { to: humanTask.askedUserId, subject, text, html };
}

export interface SendHerinneringResult {
  /** Of de mail daadwerkelijk het transport heeft verlaten. */
  verzonden: boolean;
  /** Nederlandse reden waarom niet; leeg bij een verzonden herinnering. */
  reden: string | null;
}

/**
 * Verstuurt de herinnering. Geeft nooit een exception terug: een vraag die in
 * "Wacht op jou" staat is al een werkend pad, en een mailprobleem mag die
 * waarde niet onbruikbaar maken.
 */
export async function sendHerinnering(
  herinnering: Herinnering,
): Promise<SendHerinneringResult> {
  try {
    if (!(await isEmailConfigured())) {
      return { verzonden: false, reden: "Er is geen mailtransport ingericht." };
    }
    await sendEmail({
      to: herinnering.to,
      subject: herinnering.subject,
      text: herinnering.text,
      html: herinnering.html,
    });
    return { verzonden: true, reden: null };
  } catch (error) {
    const reden = error instanceof Error ? error.message : String(error);
    console.error("verzenden van de herinnering mislukt:", reden);
    return { verzonden: false, reden };
  }
}
