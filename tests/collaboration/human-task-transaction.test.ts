import { and, eq } from "@agent-native/core/db/schema";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/**
 * De vraag en de wachtstatus zijn één handeling. Hier faalt de tweede
 * schrijfactie — het zetten van de taakstatus — en daarna moet er niets van de
 * eerste zijn overgebleven: geen vraag zonder wachtstatus, want die zou de agent
 * laten wachten op een antwoord dat niemand kan geven.
 *
 * `setTaskStatus` wordt hiervoor gemokt, omdat een echte constraint-fout op de
 * status niet bestaat. De rest van de store (inclusief de transactie) draait
 * echt op PGlite.
 */
const statusSchrijfactie = vi.hoisted(() => ({ faalt: false }));

vi.mock("../../server/tasks/store.js", async (importOriginal) => {
  const origineel = await importOriginal<
    typeof import("../../server/tasks/store.js")
  >();
  return {
    ...origineel,
    setTaskStatus: async (...args: Parameters<typeof origineel.setTaskStatus>) => {
      if (statusSchrijfactie.faalt) {
        throw new Error("de database weigert de statusupdate");
      }
      return origineel.setTaskStatus(...args);
    },
  };
});

const LEAD = "beheerder@example.com";
const COLLEGA = "tweede@example.com";

describe("een mislukte status-schrijfactie laat geen halve vraag achter", () => {
  it("schrijft de vraag en de wachtstatus in één transactie", async () => {
    const { createTask, getTask } = await import("../../server/tasks/store.js");
    const { getDb } = await import("../../server/db/client.js");
    const { humanTasks } = await import("../../server/db/schema.js");
    const { createHumanTask } = await import(
      "../../server/collaboration/human-tasks.js"
    );

    const orgId = randomUUID();
    const task = await createTask({
      orgId,
      leadId: LEAD,
      projectName: "Project",
      taskTitle: "Datamigratie",
    });

    statusSchrijfactie.faalt = true;
    await expect(
      createHumanTask({
        taskId: task.id,
        orgId,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      }),
    ).rejects.toThrow("de database weigert de statusupdate");
    statusSchrijfactie.faalt = false;

    // Geen vraag over, want de wachtstatus is niet gelukt.
    const rows = await getDb()
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.taskId, task.id)));
    expect(rows).toEqual([]);

    // En de taak staat nog niet te wachten.
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });
});
