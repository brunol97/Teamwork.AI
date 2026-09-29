import { describe, expect, it, vi } from "vitest";

import askHumanTaskAction from "../../actions/ask-human-task.js";
import cancelHumanTaskAction from "../../actions/cancel-human-task.js";
import listHumanTasksAction from "../../actions/list-human-tasks.js";
import { listOpenHumanTasks } from "../../server/collaboration/human-tasks.js";
import { getTask, listTaskEvents } from "../../server/tasks/store.js";
import { createSamenwerking, ctxVoor, voegLidToe } from "./samenwerking.js";

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

const vraag = {
  question: "Welke database kiezen we?",
  reason: "De migratie moet het weten.",
  options: ["Postgres", "MongoDB"],
};

/**
 * Een vraag aan een verkeerd adres mag de taak niet vasthouden. Zonder uitweg
 * wacht de taak tot in het oneindige: alleen de gevraagde persoon mag
 * antwoorden en een tweede vraag wordt geweigerd zolang de eerste open staat.
 */
describe("een open vraag is op te heffen", () => {
  it("de lead annuleert de vraag en de taak loopt weer door", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");

    const resultaat = await cancelHumanTaskAction.run(
      { id: humanTask!.id },
      ctxVoor(orgId, lead),
    );
    expect(resultaat.cancelled).toBe(true);
    expect(resultaat.taskStatus).toBe("bezig");
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");

    // De vraag staat niet meer in "Wacht op jou" en is gelogd.
    expect(await listOpenHumanTasks(orgId, collega)).toEqual([]);
    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("human_task_cancelled");

    // En de agent kan nu opnieuw vragen; de weg is open.
    const opnieuw = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke migratietool gebruiken we?",
        reason: "De planning moet weten waarmee we werken.",
        options: ["Goose", "node-pg-migrate"],
      },
      ctxVoor(orgId, lead),
    );
    expect(opnieuw.asked).toBe(true);
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");
  });

  it("iemand die niets met de vraag te maken heeft mag haar niet opheffen", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const buitenstaander = await voegLidToe(orgId, lead);
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );

    await expect(
      cancelHumanTaskAction.run(
        { id: humanTask!.id },
        ctxVoor(orgId, buitenstaander),
      ),
    ).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });

    // De vraag staat nog open, dus de taak wacht nog: niets is verbroken.
    expect(await listOpenHumanTasks(orgId, collega)).toHaveLength(1);
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");
  });

  it("de gevraagde persoon mag haar eigen vraag opgeven", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );

    // "Ik ga hier niet op antwoorden" moet mogelijk zijn, anders blijft de taak
    // wachten op iemand die niet meer wil.
    const resultaat = await cancelHumanTaskAction.run(
      { id: humanTask!.id },
      ctxVoor(orgId, collega),
    );
    expect(resultaat.cancelled).toBe(true);
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("zet de vraag over op een ander lid, dat hem nu wel kan beantwoorden", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const anderLid = await voegLidToe(orgId, lead);
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );
    const mailVoor = mail.verzonden.length;

    // Een adres dat geen lid is van déze organisatie kan de vraag niet krijgen.
    const { collega: buitenlandse } = await createSamenwerking();
    await expect(
      cancelHumanTaskAction.run(
        { id: humanTask!.id, askedUserId: buitenlandse },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "not_a_member", statusCode: 403 });

    const resultaat = await cancelHumanTaskAction.run(
      { id: humanTask!.id, askedUserId: anderLid },
      ctxVoor(orgId, lead),
    );
    expect(resultaat.cancelled).toBe(false);
    expect(resultaat.askedUserId).toBe(anderLid);

    // De oude persoon ziet de vraag niet meer, de nieuwe wel, en de taak
    // blijft wachten: er staat immers nog een vraag open.
    expect(await listOpenHumanTasks(orgId, collega)).toEqual([]);
    const lijst = await listHumanTasksAction.run({}, ctxVoor(orgId, anderLid));
    expect(lijst.humanTasks.map((item) => item.id)).toEqual([humanTask!.id]);
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain(
      "human_task_reassigned",
    );

    // En die nieuwe persoon hoort van de vraag, want die kende hem nog niet.
    expect(mail.verzonden.length).toBe(mailVoor + 1);
    expect(mail.verzonden.at(-1)?.to).toBe(anderLid);
  });
});
