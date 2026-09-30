import { getTask, listTaskEvents } from "./store.js";

/**
 * Een deelnemer is iemand die daadwerkelijk heeft bijgedragen aan de taak,
 * afgeleid uit het activiteitenlog: de lead en iedereen die er een bericht of
 * documentwijziging op zijn naam heeft staan — mensen op hun e-mailadres,
 * agents op hun naam. Gebeurtenissen van het systeem zelf tellen niet mee.
 */
export async function listTaskDeelnemers(
  taskId: string,
  orgId: string,
): Promise<string[]> {
  const task = await getTask(taskId, orgId);
  if (!task) {
    return [];
  }

  const events = await listTaskEvents(taskId, orgId);
  const deelnemers = new Set<string>([task.leadId]);
  for (const event of events) {
    if (
      (event.actorType === "user" || event.actorType === "agent") &&
      event.actorId
    ) {
      deelnemers.add(event.actorId);
    }
  }

  return [...deelnemers].sort((a, b) => a.localeCompare(b));
}
