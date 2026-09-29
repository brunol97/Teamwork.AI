import { describe, expect, it, vi } from "vitest";

import { createSamenwerking } from "./samenwerking.js";

/**
 * Het beantwoorden is één handeling: het antwoord én het verlaten van de
 * wachtstatus. Hier faalt de status-schrijfactie. Wat er dan NIET mag gebeuren is
 * een half geschreven toestand: een beantwoorde vraag (dus elke volgende
 * poging geeft `already_answered`) op een taak die nog steeds op "wacht op
 * iemand" staat. Dat is precies de toestand zonder uitweg, dus na een fout moet
 * de vraag gewoon open blijven staan.
 *
 * `setTaskStatus` wordt hiervoor gemokt, omdat een echte constraint-fout op de
 * status niet bestaat. De rest van de store (inclusief de transactie) draait
 * echt op PGlite, dus de rollback is die van de database.
 */
const statusSchrijfactie = vi.hoisted(() => ({ faalt: false }));

vi.mock("../../server/tasks/store.js", async (importOriginal) => {
  const origineel =
    await importOriginal<typeof import("../../server/tasks/store.js")>();
  return {
    ...origineel,
    setTaskStatus: async (
      ...args: Parameters<typeof origineel.setTaskStatus>
    ) => {
      if (statusSchrijfactie.faalt) {
        throw new Error("de database weigert de statusupdate");
      }
      return origineel.setTaskStatus(...args);
    },
  };
});

describe("een mislukte status-schrijfactie bij het beantwoorden", () => {
  it("laat de vraag openstaan in plaats van de taak vast te zetten", async () => {
    const { getTask } = await import("../../server/tasks/store.js");
    const {
      answerHumanTask,
      createHumanTask,
      listOpenHumanTasks,
      TASK_STATUS_WAITING,
    } = await import("../../server/collaboration/human-tasks.js");

    const { orgId, task, collega } = await createSamenwerking();
    const vraag = await createHumanTask({
      taskId: task.id,
      orgId,
      askedUserId: collega,
      question: "Welke database kiezen we?",
      reason: "De migratie moet het weten.",
      options: ["Postgres", "MongoDB"],
    });

    statusSchrijfactie.faalt = true;
    await expect(
      answerHumanTask({ id: vraag!.id, orgId, answer: "Postgres" }),
    ).rejects.toThrow("de database weigert de statusupdate");
    statusSchrijfactie.faalt = false;

    // Het antwoord is niet opgeslagen: de vraag staat nog open en de mens kan
    // nog gewoon antwoorden.
    const open = await listOpenHumanTasks(orgId, collega);
    expect(open.map((item) => item.id)).toEqual([vraag!.id]);
    expect(open[0].answer).toBeNull();

    // En de taak staat nog steeds te wachten, dus de twee statussen horen
    // nog steeds bij elkaar.
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });
});
