import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import answerHumanTaskAction from "../../actions/answer-human-task.js";
import askHumanTaskAction from "../../actions/ask-human-task.js";
import listHumanTasksAction from "../../actions/list-human-tasks.js";
import {
  createHumanTask,
  listOpenHumanTasks,
  TASK_STATUS_WAITING,
} from "../../server/collaboration/human-tasks.js";
import {
  getWorkDocument,
  saveWorkDocument,
} from "../../server/documents/store.js";
import { createTask, getTask, listTaskEvents } from "../../server/tasks/store.js";

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi.fn().mockResolvedValue("Ik ga verder met dat antwoord."),
}));

const LEAD = "beheerder@example.com";
const COLLEGA = "tweede@example.com";

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: LEAD,
    projectName: "Project",
    taskTitle: "Datamigratie",
  });
}

function asker(orgId: string, overrides?: Partial<{ orgId: string }>) {
  return {
    caller: "frontend",
    userEmail: LEAD,
    orgId: overrides?.orgId ?? orgId,
  } as any;
}

describe("human task: de drie velden en de wachtstatus", () => {
  it("slaat wat, waarom en opties op en zet de taak op wacht op iemand", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    expect(result.asked).toBe(true);
    const humanTask = result.humanTask!;
    expect(humanTask.question).toBe("Welke database kiezen we?");
    expect(humanTask.reason).toBe(
      "De migratie moet weten waar de data naartoe gaat.",
    );
    expect(humanTask.options).toEqual(["Postgres", "MongoDB"]);
    expect(humanTask.status).toBe("open");
    expect(humanTask.askedUserId).toBe(COLLEGA);

    // De wachtstatus staat op de taak, dus hij overleeft een herstart.
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });

  it("weigert een vraag zonder waarom", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    await expect(
      createHumanTask({
        taskId: task.id,
        orgId,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "   ",
        options: ["Postgres", "MongoDB"],
      }),
    ).rejects.toThrow("waarom");

    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("weigert een vraag zonder opties", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    await expect(
      createHumanTask({
        taskId: task.id,
        orgId,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres"],
      }),
    ).rejects.toThrow("opties");
  });

  it("laat de taak uit de wachtstatus gaan zodra de vraag is beantwoord", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );

    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });
});

describe("de agent zoekt voordat hij vraagt", () => {
  it("stelt geen vraag wanneer het antwoord al in het werkdocument staat", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Databasestratiege\n\nWe kiezen Postgres voor de migratie.\n",
      actorType: "user",
      actorId: LEAD,
      expectedVersion: 0,
    });

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we voor de migratie?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    expect(result.asked).toBe(false);
    expect(result.humanTask).toBeNull();
    expect(result.knownAnswer?.option).toBe("Postgres");
    expect(result.knownAnswer?.source).toBe("werkdocument");

    // Geen nieuwe vraag en geen wachtstatus: er is niets gevraagd.
    expect(await listOpenHumanTasks(orgId, COLLEGA)).toEqual([]);
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("stelt geen vraag wanneer een eerder antwoord in het project dezelfde keuze geeft", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    expect(result.asked).toBe(false);
    expect(result.knownAnswer?.source).toBe("eerder antwoord");
    expect(await listOpenHumanTasks(orgId, COLLEGA)).toEqual([]);
  });

  it("stelt de vraag wél als het antwoord niet in het werkdocument staat", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Eisen\n\nDe migratie moet binnen twee weken klaar zijn.\n",
      actorType: "user",
      actorId: LEAD,
      expectedVersion: 0,
    });

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    expect(result.asked).toBe(true);
    expect(result.humanTask?.question).toBe("Welke database kiezen we?");
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });
});

describe("organisatie-scoping van human tasks", () => {
  it("laat een andere organisatie de vraag niet zien", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    // Zelfde e-mailadres, andere organisatie: geen vragen zichtbaar.
    const lijst = await listHumanTasksAction.run(
      {},
      { caller: "frontend", userEmail: COLLEGA, orgId: randomUUID() } as any,
    );
    expect(lijst.humanTasks).toEqual([]);

    await expect(
      answerHumanTaskAction.run(
        { id: humanTask!.id, answer: "Postgres" },
        { caller: "frontend", userEmail: COLLEGA, orgId: randomUUID() } as any,
      ),
    ).rejects.toThrow("Vraag niet gevonden.");

    // De vraag blijft openstaan voor de eigen organisatie.
    expect((await listOpenHumanTasks(orgId, COLLEGA)).length).toBe(1);
  });

  it("laat een andere organisatie de taak niet aan een vraag koppelen", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    await expect(
      askHumanTaskAction.run(
        {
          taskId: task.id,
          askedUserId: COLLEGA,
          question: "Welke database kiezen we?",
          reason: "De migratie moet het weten.",
          options: ["Postgres", "MongoDB"],
        },
        asker(orgId, { orgId: randomUUID() }),
      ),
    ).rejects.toThrow("Task not found.");
  });
});

describe("de wachtstatus en het activiteitenlog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logt de vraag en het antwoord in het activiteitenlog", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("human_task_answered");
    expect(events.at(-1)?.actorType).toBe("agent");
  });

  it("laat een vraag aan iemand anders onbeantwoord", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    await expect(
      answerHumanTaskAction.run(
        { id: humanTask!.id, answer: "Postgres" },
        asker(orgId),
      ),
    ).rejects.toThrow("aan iemand anders gesteld");
  });
});

describe("het werkdocument als bron blijft leesbaar", () => {
  it("laat het werkdocument van de taak ongewijzigd door de vraag", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Eisen\n\n- Snel\n",
      actorType: "user",
      actorId: LEAD,
      expectedVersion: 0,
    });

    await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    expect((await getWorkDocument(task.id, orgId))?.markdown).toBe(
      "# Eisen\n\n- Snel\n",
    );
  });
});
