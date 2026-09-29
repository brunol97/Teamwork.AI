import { describe, expect, it, vi } from "vitest";

import answerHumanTaskAction from "../../actions/answer-human-task.js";
import askHumanTaskAction from "../../actions/ask-human-task.js";
import listResumeFailuresAction from "../../actions/list-human-task-resume-failures.js";
import retryHumanTaskResumeAction from "../../actions/retry-human-task-resume.js";
import { generateOllamaResponse } from "../../server/llm/ollama.js";
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

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi
    .fn()
    .mockResolvedValue("Ik ga verder met dat antwoord."),
}));

const vraag = {
  question: "Welke database kiezen we?",
  reason: "De migratie moet het weten.",
  options: ["Postgres", "MongoDB"],
};

/**
 * Niets in de app probeert de hervat opnieuw: er is geen worker en geen cron.
 * Zonder uitweg blijft een beantwoorde vraag dus onopgepakt liggen. Deze test
 * bewijst dat de tweede poging gebeurt én werkt.
 */
describe("een mislukte hervat is opnieuw te starten", () => {
  it("pakt een eerder mislukte hervat alsnog op", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );

    // De eerste hervat faalt, bijvoorbeeld omdat de LLM even niet bereikbaar is.
    vi.mocked(generateOllamaResponse).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );
    const beantwoord = await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );
    expect(beantwoord.resumeFailed).toBe(true);
    expect(beantwoord.taskStatus).toBe("bezig");

    // Zo'n vraag blijft zichtbaar: anders weet niemand dat de agent wacht.
    const lijst = await listResumeFailuresAction.run({}, ctxVoor(orgId, lead));
    expect(lijst.resumeFailures.map((item) => item.id)).toEqual([
      humanTask!.id,
    ]);

    // De tweede poging werkt.
    const opnieuw = await retryHumanTaskResumeAction.run(
      { id: humanTask!.id },
      ctxVoor(orgId, lead),
    );
    expect(opnieuw.resumeFailed).toBe(false);
    expect(opnieuw.agentMessage).toBe("Ik ga verder met dat antwoord.");

    const naHerhaling = await listResumeFailuresAction.run(
      {},
      ctxVoor(orgId, lead),
    );
    expect(naHerhaling.resumeFailures).toEqual([]);
    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain(
      "human_task_resume_retried",
    );
  });

  it("laat een vraag waarvan de agent het antwoord wel oppakte met rust", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );

    const lijst = await listResumeFailuresAction.run({}, ctxVoor(orgId, lead));
    expect(lijst.resumeFailures).toEqual([]);

    // Opnieuw starten zonder dat er iets te doen valt, is een duidelijke fout.
    await expect(
      retryHumanTaskResumeAction.run(
        { id: humanTask!.id },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "already_resumed", statusCode: 409 });
  });

  it("weigert een hervat door iemand die niets met de taak te maken heeft", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const buitenstaander = await voegLidToe(orgId, lead);
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );
    vi.mocked(generateOllamaResponse).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );

    await expect(
      retryHumanTaskResumeAction.run(
        { id: humanTask!.id },
        ctxVoor(orgId, buitenstaander),
      ),
    ).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
  });

  it("staat de antwoordende persoon zelf toe de hervat opnieuw te starten", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const { humanTask } = await askHumanTaskAction.run(
      { taskId: task.id, askedUserId: collega, ...vraag },
      ctxVoor(orgId, lead),
    );
    vi.mocked(generateOllamaResponse).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );

    const opnieuw = await retryHumanTaskResumeAction.run(
      { id: humanTask!.id },
      ctxVoor(orgId, collega),
    );
    expect(opnieuw.resumeFailed).toBe(false);
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });
});
