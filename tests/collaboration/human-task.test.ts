import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import answerHumanTaskAction from "../../actions/answer-human-task.js";
import askHumanTaskAction from "../../actions/ask-human-task.js";
import listHumanTasksAction from "../../actions/list-human-tasks.js";
import listMeldingenAction from "../../actions/list-meldingen.js";
import {
  createHumanTask,
  listOpenHumanTasks,
  TASK_STATUS_WAITING,
} from "../../server/collaboration/human-tasks.js";
import {
  getWorkDocument,
  saveWorkDocument,
} from "../../server/documents/store.js";
import { generateOllamaResponse } from "../../server/llm/ollama.js";
import { createTask, getTask, listTaskEvents } from "../../server/tasks/store.js";

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi.fn().mockResolvedValue("Ik ga verder met dat antwoord."),
}));

const LEAD = "beheerder@example.com";
const COLLEGA = "tweede@example.com";

async function createTaak(orgId: string, taskTitle = "Datamigratie") {
  return createTask({
    orgId,
    leadId: LEAD,
    projectName: "Project",
    taskTitle,
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

  it("weigert een vraag zonder waarom, met invalid_question en 400", async () => {
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

    // Via de action is een lege "waarom" een bruikbare fout voor de agent.
    await expect(
      askHumanTaskAction.run(
        {
          taskId: task.id,
          askedUserId: COLLEGA,
          question: "Welke database kiezen we?",
          reason: "   ",
          options: ["Postgres", "MongoDB"],
        },
        asker(orgId),
      ),
    ).rejects.toMatchObject({
      errorCode: "invalid_question",
      statusCode: 400,
    });

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

    // Ook via de action: de schema eist twee opties, dus de vraag komt er
    // niet in. Er ontstaat geen vraag en de taak gaat niet te wachten.
    await expect(
      askHumanTaskAction.run(
        {
          taskId: task.id,
          askedUserId: COLLEGA,
          question: "Welke database kiezen we?",
          reason: "De migratie moet het weten.",
          options: ["Postgres"],
        },
        asker(orgId),
      ),
    ).rejects.toBeDefined();

    expect(await listOpenHumanTasks(orgId, COLLEGA)).toEqual([]);
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
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

  it("kiest de tweede optie wanneen de eerdere vraag alle opties noemde", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    // De eerdere vraag noemt beide opties; de mens kiest de tweede.
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Kiezen we Postgres of MongoDB voor de migratie?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "MongoDB" },
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we: Postgres of MongoDB?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    // De vraagtekst van de eerdere vraag mag niet als antwoord tellen.
    expect(result.asked).toBe(false);
    expect(result.knownAnswer?.option).toBe("MongoDB");
    expect(result.knownAnswer?.source).toBe("eerder antwoord");
  });

  it("vraagt alsnog wanneer het werkdocument de kandidaten noemt zonder te kiezen", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown:
        "# Databasestratiege\n\nWe moeten nog kiezen tussen Postgres en MongoDB.\n",
      actorType: "user",
      actorId: LEAD,
      expectedVersion: 0,
    });

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

    // De tekst noemt twee kandidaten en kiest geen van beide: dus vragen.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
    expect(result.humanTask?.status).toBe("open");
  });

  it("vraagt alsnog wanneer de eerdere vraag over een ander onderwerp ging", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    // Beantwoord: wie voert de migratie uit. Zelfde opties, ander onderwerp.
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Wie gaat de datamigratie uitvoeren?",
        reason: "De planning moet weten wie het werk doet.",
        options: ["Sanne", "Joris"],
      },
      asker(orgId),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Sanne" },
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: COLLEGA,
        question: "Wie houdt het werkdocument bij?",
        reason: "Iemand moet de voortgang vastleggen.",
        options: ["Sanne", "Joris"],
      },
      asker(orgId),
    );

    // Een antwoord op een ander onderwerp onderdrukt de nieuwe vraag niet.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
  });

  it("negeert een beantwoorde vraag uit een ander project", async () => {
    const orgId = randomUUID();
    const eersteTask = await createTaak(orgId);
    const tweedeTask = await createTaak(orgId);
    expect(tweedeTask.projectId).not.toBe(eersteTask.projectId);

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: eersteTask.id,
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
        taskId: tweedeTask.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    // De keuze geldt alleen binnen het project waarin hij gemaakt is.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
    expect(result.humanTask?.taskId).toBe(tweedeTask.id);
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

  it("logt het antwoord van de mens in het activiteitenlog", async () => {
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

describe("de vraag staat op één plek: in Wacht op jou", () => {
  it("stuurt geen melding: een melding vraagt geen antwoord, deze vraag wel", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

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

    const { meldingen, ongelezen } = await listMeldingenAction.run(
      {},
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );
    expect(meldingen).toEqual([]);
    expect(ongelezen).toBe(0);

    // Op de ene plek die wel hoort te staan: de lijst van de gevraagde persoon.
    const open = await listOpenHumanTasks(orgId, COLLEGA);
    expect(open.map((item) => item.question)).toEqual([
      "Welke database kiezen we?",
    ]);
  });
});

describe("een taak heeft hoogstens één open vraag", () => {
  it("weigert een tweede vraag zolang de eerste open staat", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    const vraag = {
      taskId: task.id,
      askedUserId: COLLEGA,
      question: "Welke database kiezen we?",
      reason: "De migratie moet het weten.",
      options: ["Postgres", "MongoDB"],
    };
    await askHumanTaskAction.run(vraag, asker(orgId));

    await expect(askHumanTaskAction.run(vraag, asker(orgId))).rejects.toThrow(
      "al een open vraag",
    );
    await expect(askHumanTaskAction.run(vraag, asker(orgId))).rejects.toMatchObject(
      { errorCode: "question_already_open", statusCode: 409 },
    );

    // Eén open rij, dus de taak wacht één keer.
    expect(await listOpenHumanTasks(orgId, COLLEGA)).toHaveLength(1);
  });

  it("staat een nieuwe vraag toe zodra de eerste is beantwoord", async () => {
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
        question: "Wanneer starten we met de migratie?",
        reason: "De planning moet een datum hebben.",
        options: ["Volgende week", "Over twee weken"],
      },
      asker(orgId),
    );

    expect(result.asked).toBe(true);
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });
});

describe("Wacht op jou is bereikbaar zonder de taakpagina", () => {
  it("geeft de vraag van elke taak met de taaktitel terug", async () => {
    const orgId = randomUUID();
    const taakMetVraag = await createTaak(orgId);
    const andereTaak = await createTaak(orgId, "Presentatie");

    await askHumanTaskAction.run(
      {
        taskId: taakMetVraag.id,
        askedUserId: COLLEGA,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      asker(orgId),
    );

    // De lijst is niet aan één taak gebonden: de gevraagde persoon ziet de
    // vraag ook zonder de taakpagina te openen, en weet welke taak het is.
    const lijst = await listHumanTasksAction.run(
      {},
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );
    expect(lijst.humanTasks).toHaveLength(1);
    expect(lijst.humanTasks[0].taskId).toBe(taakMetVraag.id);
    expect(lijst.humanTasks[0].taskTitle).toBe("Datamigratie");
    expect(lijst.humanTasks[0].question).toBe("Welke database kiezen we?");

    // De andere taak heeft geen vraag en komt dus niet in de lijst.
    expect(
      lijst.humanTasks.filter((item) => item.taskId === andereTaak.id),
    ).toEqual([]);
  });
});

describe("een mislukte hervat na het antwoord", () => {
  it("laat het bewaarde antwoord staan en logt dat alleen de hervat mislukte", async () => {
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

    // De LLM-call weigert, bijvoorbeeld omdat Ollama niet bereikbaar is.
    vi.mocked(generateOllamaResponse).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );

    const result = await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: COLLEGA, orgId } as any,
    );

    // De actie slaagt: het antwoord is duurzaam bewaard en de taak loopt door.
    expect(result.answer).toBe("Postgres");
    expect(result.resumeFailed).toBe(true);
    expect(result.agentMessage).toBe("");
    expect(result.taskStatus).toBe("bezig");
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");

    const events = await listTaskEvents(task.id, orgId);
    const mislukt = events.find(
      (event) => event.type === "human_task_resume_failed",
    );
    expect(mislukt?.actorType).toBe("system");
    expect(mislukt?.data).toContain("Postgres");
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
