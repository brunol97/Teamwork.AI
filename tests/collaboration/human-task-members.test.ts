import { describe, expect, it, vi } from "vitest";

import askHumanTaskAction from "../../actions/ask-human-task.js";
import listHumanTasksAction from "../../actions/list-human-tasks.js";
import {
  createHumanTask,
  NotAnOrgMemberError,
} from "../../server/collaboration/human-tasks.js";
import { getTask } from "../../server/tasks/store.js";
import { createSamenwerking, ctxVoor } from "./samenwerking.js";

const mail = vi.hoisted(() => ({
  verzonden: [] as {
    to: string;
    subject: string;
    text?: string;
    html: string;
  }[],
  geconfigureerd: true,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./mail.js")).mockMailTransport(mail),
}));

/**
 * Een vraag is alleen bruikbaar als iemand hem kan beantwoorden. Iemand die geen
 * lid is van de organisatie ziet de taak niet en kan dus nooit in "Wacht op
 * jou" antwoorden; zonder controle zet één typefout de taak voor altijd vast.
 */
describe("de gevraagde persoon moet lid zijn van de organisatie", () => {
  it("accepteert een adres dat echt lid is", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(true);
    expect(result.humanTask?.askedUserId).toBe(collega);
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");
  });

  it("weigert een adres dat geen lid is met not_a_member en 403", async () => {
    const { orgId, task, lead } = await createSamenwerking();
    const typefout = "iemand-die-niet-lid-is@samenwerking.test";

    await expect(
      askHumanTaskAction.run(
        {
          taskId: task.id,
          askedUserId: typefout,
          question: "Welke database kiezen we?",
          reason: "De migratie moet het weten.",
          options: ["Postgres", "MongoDB"],
        },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({
      errorCode: "not_a_member",
      statusCode: 403,
    });

    // Er is niets vastgelegd en de taak wacht niet: de agent kan het meteen
    // opnieuw proberen met een adres dat wel werkt.
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
    const lijst = await listHumanTasksAction.run({}, ctxVoor(orgId, typefout));
    expect(lijst.humanTasks).toEqual([]);
  });

  it("weigert ook in de store, zodat een andere aanroeper het niet kan omzeilen", async () => {
    const { orgId, task, collega } = await createSamenwerking();

    // Iemand die in een andere organisatie wél lid is: in deze organisatie niet.
    const ander = await createSamenwerking();
    await expect(
      createHumanTask({
        taskId: task.id,
        orgId,
        askedUserId: ander.collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      }),
    ).rejects.toBeInstanceOf(NotAnOrgMemberError);

    // Met het eigen lid lukt het wel.
    const vraag = await createHumanTask({
      taskId: task.id,
      orgId,
      askedUserId: collega,
      question: "Welke database kiezen we?",
      reason: "De migratie moet het weten.",
      options: ["Postgres", "MongoDB"],
    });
    expect(vraag?.askedUserId).toBe(collega);
  });
});
