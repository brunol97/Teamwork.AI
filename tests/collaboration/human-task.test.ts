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
import {
  createSamenwerking,
  createTaak,
  ctxVoor,
} from "./samenwerking.js";

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi.fn().mockResolvedValue("Ik ga verder met dat antwoord."),
}));

// Geen enkele test mag een echt adres bereiken; het transport onthoudt alleen wat
// er verzonden zou zijn.
const mail = vi.hoisted(() => ({
  verzonden: [] as { to: string; subject: string; text?: string; html: string }[],
  geconfigureerd: true,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./mail.js")).mockMailTransport(mail),
}));

describe("human task: de drie velden en de wachtstatus", () => {
  it("slaat wat, waarom en opties op en zet de taak op wacht op iemand", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(true);
    const humanTask = result.humanTask!;
    expect(humanTask.question).toBe("Welke database kiezen we?");
    expect(humanTask.reason).toBe(
      "De migratie moet weten waar de data naartoe gaat.",
    );
    expect(humanTask.options).toEqual(["Postgres", "MongoDB"]);
    expect(humanTask.status).toBe("open");
    expect(humanTask.askedUserId).toBe(collega);

    // De wachtstatus staat op de taak, dus hij overleeft een herstart.
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });

  it("weigert een vraag zonder waarom, met invalid_question en 400", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    await expect(
      createHumanTask({
        taskId: task.id,
        orgId,
        askedUserId: collega,
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
          askedUserId: collega,
          question: "Welke database kiezen we?",
          reason: "   ",
          options: ["Postgres", "MongoDB"],
        },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({
      errorCode: "invalid_question",
      statusCode: 400,
    });

    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("weigert een vraag zonder opties", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    await expect(
      createHumanTask({
        taskId: task.id,
        orgId,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres"],
      }),
    ).rejects.toThrow("opties");

    // Ook via de action: het schema eist twee opties, dus de vraag komt er niet
    // in. Er ontstaat geen vraag en de taak gaat niet te wachten. (De 400 die
    // de HTTP-laag van deze parameterfout maakt, staat in de e2e.)
    await expect(
      askHumanTaskAction.run(
        {
          taskId: task.id,
          askedUserId: collega,
          question: "Welke database kiezen we?",
          reason: "De migratie moet het weten.",
          options: ["Postgres"],
        },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toThrow("options");

    expect(await listOpenHumanTasks(orgId, collega)).toEqual([]);
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("laat de taak uit de wachtstatus gaan zodra de vraag is beantwoord", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });
});

describe("de agent zoekt voordat hij vraagt", () => {
  it("stelt geen vraag wanneer het antwoord al in het werkdocument staat", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Databasestratiege\n\nWe kiezen Postgres voor de migratie.\n",
      actorType: "user",
      actorId: lead,
      expectedVersion: 0,
    });

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we voor de migratie?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(false);
    expect(result.humanTask).toBeNull();
    expect(result.knownAnswer?.option).toBe("Postgres");
    expect(result.knownAnswer?.source).toBe("werkdocument");

    // Geen nieuwe vraag en geen wachtstatus: er is niets gevraagd.
    expect(await listOpenHumanTasks(orgId, collega)).toEqual([]);
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("stelt geen vraag wanneer een eerder antwoord in het project dezelfde keuze geeft", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

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

    expect(result.asked).toBe(false);
    expect(result.knownAnswer?.source).toBe("eerder antwoord");
    expect(await listOpenHumanTasks(orgId, collega)).toEqual([]);
  });

  it("kiest de tweede optie wanneen de eerdere vraag alle opties noemde", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    // De eerdere vraag noemt beide opties; de mens kiest de tweede.
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Kiezen we Postgres of MongoDB voor de migratie?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "MongoDB" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we: Postgres of MongoDB?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // De vraagtekst van de eerdere vraag mag niet als antwoord tellen.
    expect(result.asked).toBe(false);
    expect(result.knownAnswer?.option).toBe("MongoDB");
    expect(result.knownAnswer?.source).toBe("eerder antwoord");
  });

  it("vraagt alsnog wanneer het werkdocument de kandidaten noemt zonder te kiezen", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown:
        "# Databasestratiege\n\nWe moeten nog kiezen tussen Postgres en MongoDB.\n",
      actorType: "user",
      actorId: lead,
      expectedVersion: 0,
    });

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

    // De tekst noemt twee kandidaten en kiest geen van beide: dus vragen.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
    expect(result.humanTask?.status).toBe("open");
  });

  it("vraagt alsnog wanneer de eerdere vraag over een ander onderwerp ging", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    // Beantwoord: wie voert de migratie uit. Zelfde opties, ander onderwerp.
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Wie gaat de datamigratie uitvoeren?",
        reason: "De planning moet weten wie het werk doet.",
        options: ["Sanne", "Joris"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Sanne" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Wie houdt het werkdocument bij?",
        reason: "Iemand moet de voortgang vastleggen.",
        options: ["Sanne", "Joris"],
      },
      ctxVoor(orgId, lead),
    );

    // Een antwoord op een ander onderwerp onderdrukt de nieuwe vraag niet.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
  });

  it("vraagt alsnog wanneer de eerdere vraag alleen één woord deelt", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    // Beantwoord: welke databasis voor de migratie.
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Kies de databasis voor de migratie: Postgres of MongoDB?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Voor welke databasis willen we een leesreplica?",
        reason: "De leesreplica moet op dezelfde engine draaien.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // Het enige gedeelde woord is "databasis"; dat is geen bewijs dat het om
    // hetzelfde onderwerp gaat, dus het antwoord over de migratie wordt niet
    // op deze vraag toegepast.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
  });

  it("onderdrukt de vraag alsnog als het onderwerp echt hetzelfde is", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Kies de databasis voor de migratie: Postgres of MongoDB?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      ctxVoor(orgId, collega),
    );

    // Andere woorden, maar wel hetzelfde onderwerp: "databasis" en "migratie".
    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke databasis kiezen we nu voor de migratie?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(false);
    expect(result.knownAnswer?.option).toBe("Postgres");
    expect(result.knownAnswer?.source).toBe("eerder antwoord");
  });

  it("negeert een beantwoorde vraag uit een ander project", async () => {
    const { orgId, lead, collega } = await createSamenwerking();
    const eersteTask = await createTaak(orgId, lead);
    // Met dezelfde projectnaam hoort de taak bij het bestaande project
    // (het overzicht telt per project); een andere naam geeft dus een ander
    // project, en dat is wat deze test nodig heeft.
    const tweedeTask = await createTask({
      orgId,
      leadId: lead,
      projectName: "Ander project",
      taskTitle: "Datamigratie",
    });
    expect(tweedeTask.projectId).not.toBe(eersteTask.projectId);

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: eersteTask.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: tweedeTask.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // De keuze geldt alleen binnen het project waarin hij gemaakt is.
    expect(result.asked).toBe(true);
    expect(result.knownAnswer).toBeNull();
    expect(result.humanTask?.taskId).toBe(tweedeTask.id);
  });

  it("stelt de vraag wél als het antwoord niet in het werkdocument staat", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Eisen\n\nDe migratie moet binnen twee weken klaar zijn.\n",
      actorType: "user",
      actorId: lead,
      expectedVersion: 0,
    });

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(true);
    expect(result.humanTask?.question).toBe("Welke database kiezen we?");
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });
});

describe("organisatie-scoping van human tasks", () => {
  it("laat een andere organisatie de vraag niet zien", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();
    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // Zelfde e-mailadres, andere organisatie: geen vragen zichtbaar.
    const lijst = await listHumanTasksAction.run(
      {},
      { caller: "frontend", userEmail: collega, orgId: randomUUID() } as any,
    );
    expect(lijst.humanTasks).toEqual([]);

    await expect(
      answerHumanTaskAction.run(
        { id: humanTask!.id, answer: "Postgres" },
        { caller: "frontend", userEmail: collega, orgId: randomUUID() } as any,
      ),
    ).rejects.toThrow("Vraag niet gevonden.");

    // De vraag blijft openstaan voor de eigen organisatie.
    expect((await listOpenHumanTasks(orgId, collega)).length).toBe(1);
  });

  it("laat een andere organisatie de taak niet aan een vraag koppelen", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    await expect(
      askHumanTaskAction.run(
        {
          taskId: task.id,
          askedUserId: collega,
          question: "Welke database kiezen we?",
          reason: "De migratie moet het weten.",
          options: ["Postgres", "MongoDB"],
        },
        ctxVoor(randomUUID(), lead),
      ),
    ).rejects.toThrow("Task not found.");
  });
});

describe("de wachtstatus en het activiteitenlog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logt het antwoord van de mens in het activiteitenlog", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("human_task_answered");
    expect(events.at(-1)?.actorType).toBe("agent");
  });

  it("laat een vraag aan iemand anders onbeantwoord", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    await expect(
      answerHumanTaskAction.run(
        { id: humanTask!.id, answer: "Postgres" },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toThrow("aan iemand anders gesteld");
  });
});

describe("de vraag staat op één plek: in Wacht op jou", () => {
  it("stuurt geen melding: een melding vraagt geen antwoord, deze vraag wel", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    const { meldingen, ongelezen } = await listMeldingenAction.run(
      {},
      { caller: "frontend", userEmail: collega, orgId } as any,
    );
    expect(meldingen).toEqual([]);
    expect(ongelezen).toBe(0);

    // Op de ene plek die wel hoort te staan: de lijst van de gevraagde persoon.
    const open = await listOpenHumanTasks(orgId, collega);
    expect(open.map((item) => item.question)).toEqual([
      "Welke database kiezen we?",
    ]);
  });
});

describe("een taak heeft hoogstens één open vraag", () => {
  it("weigert een tweede vraag zolang de eerste open staat", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const vraag = {
      taskId: task.id,
      askedUserId: collega,
      question: "Welke database kiezen we?",
      reason: "De migratie moet het weten.",
      options: ["Postgres", "MongoDB"],
    };
    await askHumanTaskAction.run(vraag, ctxVoor(orgId, lead));

    await expect(askHumanTaskAction.run(vraag, ctxVoor(orgId, lead))).rejects.toThrow(
      "al een open vraag",
    );
    await expect(askHumanTaskAction.run(vraag, ctxVoor(orgId, lead))).rejects.toMatchObject(
      { errorCode: "question_already_open", statusCode: 409 },
    );

    // Eén open rij, dus de taak wacht één keer.
    expect(await listOpenHumanTasks(orgId, collega)).toHaveLength(1);
  });

  it("staat een nieuwe vraag toe zodra de eerste is beantwoord", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );
    await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: collega, orgId } as any,
    );

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Wanneer starten we met de migratie?",
        reason: "De planning moet een datum hebben.",
        options: ["Volgende week", "Over twee weken"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(true);
    expect((await getTask(task.id, orgId))?.status).toBe(TASK_STATUS_WAITING);
  });
});

describe("Wacht op jou is bereikbaar zonder de taakpagina", () => {
  it("geeft de vraag van elke taak met de taaktitel terug", async () => {
    const { orgId, task: taakMetVraag, lead, collega } =
      await createSamenwerking();
    const andereTaak = await createTaak(orgId, lead, "Presentatie");

    await askHumanTaskAction.run(
      {
        taskId: taakMetVraag.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // De lijst is niet aan één taak gebonden: de gevraagde persoon ziet de
    // vraag ook zonder de taakpagina te openen, en weet welke taak het is.
    const lijst = await listHumanTasksAction.run(
      {},
      { caller: "frontend", userEmail: collega, orgId } as any,
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
    const { orgId, task, lead, collega } = await createSamenwerking();

    const { humanTask } = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // De LLM-call weigert, bijvoorbeeld omdat Ollama niet bereikbaar is.
    vi.mocked(generateOllamaResponse).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED"),
    );

    const result = await answerHumanTaskAction.run(
      { id: humanTask!.id, answer: "Postgres" },
      { caller: "frontend", userEmail: collega, orgId } as any,
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
    const { orgId, task, lead, collega } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Eisen\n\n- Snel\n",
      actorType: "user",
      actorId: lead,
      expectedVersion: 0,
    });

    await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect((await getWorkDocument(task.id, orgId))?.markdown).toBe(
      "# Eisen\n\n- Snel\n",
    );
  });
});
