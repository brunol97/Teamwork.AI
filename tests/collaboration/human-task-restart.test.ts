import { and, eq } from "@agent-native/core/db/schema";
import { describe, expect, it, vi } from "vitest";

import { createSamenwerking, ctxVoor } from "./samenwerking.js";

/**
 * De herstart-eis: de agent hervat vanuit SQL.
 *
 * Deze test gebruikt geen enkel moduleobject uit een eerdere aanroep. Na
 * `vi.resetModules()` wordt elke module opnieuw geladen en opnieuw geïmporteerd,
 * dus er is geen object in het geheugen dat de vraag nog kan dragen. Wat
 * overblijft is de database. De LLM wordt niet gemokt maar via de bestaande
 * `AGENT_OFFICE_MOCK_LLM_RESPONSE`-schakelaar omgezeild, zodat er geen netwerk
 * nodig is en de test niets over de mocklaag van dit bestand hoeft te weten.
 */
describe("de agent hervat na een herstart van de server", () => {
  it("beantwoordt een vraag die alleen in de database bestaat", async () => {
    process.env.AGENT_OFFICE_MOCK_LLM_RESPONSE =
      "Ik ga verder met Postgres voor de migratie.";

    const { getTask } = await import("../../server/tasks/store.js");
    const { orgId, task, lead, collega } = await createSamenwerking();

    // Fase 1: de vraag stellen met de eerste set modules.
    const askAction = (await import("../../actions/ask-human-task.js")).default;
    const { humanTask } = await askAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    expect(humanTask?.status).toBe("open");
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");

    // De wachtstatus en de vraag liggen echt in SQL, niet in een procesobject.
    const { getDb } = await import("../../server/db/client.js");
    const { humanTasks } = await import("../../server/db/schema.js");
    const rows = await getDb()
      .select()
      .from(humanTasks)
      .where(and(eq(humanTasks.id, humanTask!.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("open");
    expect(JSON.parse(rows[0].options)).toEqual(["Postgres", "MongoDB"]);

    // Fase 2: de herstart. Alle modules opnieuw laden; er is geen enkele
    // objectreferentie over die de vraag kan dragen.
    vi.resetModules();
    const answerAction = (await import("../../actions/answer-human-task.js"))
      .default;
    const store = await import("../../server/collaboration/human-tasks.js");
    const tasksStore = await import("../../server/tasks/store.js");

    // De verse store ziet de openstaande vraag uitsluitend via de database.
    const open = await store.listOpenHumanTasks(orgId, collega);
    expect(open.map((item) => item.id)).toEqual([humanTask!.id]);
    expect(open[0].question).toBe("Welke database kiezen we?");
    expect(open[0].options).toEqual(["Postgres", "MongoDB"]);

    const result = await answerAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );

    expect(result.answer).toBe("Postgres");
    expect(result.agentMessage).toBe(
      "Ik ga verder met Postgres voor de migratie.",
    );
    expect(result.taskStatus).toBe("bezig");

    // Na de herstart is de vraag beantwoord en staat de taak niet meer te wachten.
    expect((await tasksStore.getTask(task.id, orgId))?.status).toBe("bezig");
    const naHerstart = await store.getHumanTask(humanTask!.id, orgId);
    expect(naHerstart?.status).toBe("answered");
    expect(naHerstart?.answer).toBe("Postgres");
    expect(naHerstart?.options).toEqual(["Postgres", "MongoDB"]);

    delete process.env.AGENT_OFFICE_MOCK_LLM_RESPONSE;
  });
});
