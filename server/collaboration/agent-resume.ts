import { notifyTaskFollowers } from "./notifications.js";
import type { HumanTask } from "./human-tasks.js";
import { generateOllamaResponse } from "../llm/ollama.js";
import { createTaskEvent, getTask } from "../tasks/store.js";

/**
 * De agent hervat vanuit de opgeslagen vraag. Alles komt uit SQL: de vraag, de
 * opties en het antwoord staan in `human_tasks`, dus een herstart van de server
 * verandert niets aan wat de agent hierna doet.
 */
export async function resumeAgentAfterAnswer({
  humanTask,
  orgId,
}: {
  humanTask: HumanTask;
  orgId: string;
}): Promise<string> {
  const task = await getTask(humanTask.taskId, orgId);
  if (!task) {
    return "";
  }

  const systemPrompt = [
    `Je bent een behulpzame agent in Agent Office. Je werkt mee aan de taak "${task.title}".`,
    "Je had een vraag aan een mens gesteld en je hebt zojuist het antwoord gekregen.",
    "Ga daarmee verder: vat kort samen wat je nu doet. Reageer in het Nederlands.",
  ].join(" ");

  const messages = [
    {
      role: "user" as const,
      content: [
        `Vraag: ${humanTask.question}`,
        `Waarom: ${humanTask.reason}`,
        `Opties: ${humanTask.options.join(", ")}`,
        `Antwoord: ${humanTask.answer ?? ""}`,
      ].join("\n"),
    },
  ];

  const response = await generateOllamaResponse(systemPrompt, messages);

  await createTaskEvent(humanTask.taskId, "agent", "ollama", "message", response);
  await notifyTaskFollowers({
    taskId: humanTask.taskId,
    orgId,
    title: `Antwoord op je vraag in ${task.title}`,
    body: response,
  });

  return response;
}
