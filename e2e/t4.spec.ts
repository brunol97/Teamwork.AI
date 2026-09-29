import { expect, test } from "@playwright/test";

/**
 * LET OP — wat deze test wel en niet bewijst.
 *
 * `playwright.config.ts` draait met `AUTH_DISABLED=true`, dus iedere aanroeper is
 * hetzelfde account (`dev@local.test`). Daardoor is de "tweede persoon" hier een
 * tweede rol binnen één sessie, niet een echte tweede gebruiker:
 *
 * - "De vraag verschijnt in Wacht op jou bij de gevraagde persoon, per e-mail"
 *   wordt NIET als twee mensen bewezen. Wat wél bewezen wordt: de vraag verschijnt
 *   in de lijst, zowel vanaf de takenlijst als op de taakpagina, en de velden
 *   zijn zichtbaar. Ook de herinnering per e-mail wordt hier niet bewezen:
 *   `playwright.config.ts` heeft geen `RESEND_API_KEY`, en het transport
 *   onthoudt in de unit-tests alleen wat er verzonden zou zijn. Geen enkele
 *   test stuurt een echte mail, dus niets beweest dat een mens hem ontvangt.
 * - "De vraag is een melding" wordt hier NIET bewezen, want het is het niet:
 *   een melding vraagt geen antwoord (`CONTEXT.md`) en de vraag staat daarom
 *   alleen in "Wacht op jou". Deze test bewijst juist dat er geen melding komt.
 * - "Na een herstart van de server gaat de agent verder" wordt hier NIET bewezen:
 *   de server blijft draaien. Dat pad is bewezen in
 *   `tests/collaboration/human-task-restart.test.ts`, waar de modules opnieuw
 *   geladen worden en alleen de database de vraag nog kent.
 * - "Staat het antwoord al in het document, dan vraagt de agent niet" wordt wel
 *   bewezen, via de action en daarna via de taakpagina.
 * - De tweede test hier bewijst dat een vraag aan een adres dat geen lid is met
 *   403 wordt geweigerd en dat de vraag daarna op te heffen is, ook via de
 *   knop in de taakpagina. De hervat opnieuw starten
 *   (`retry-human-task-resume`) wordt hier niet bewezen: daarvoor moet de
 *   LLM-call mislukken, en dat kan alleen in
 *   `tests/collaboration/human-task-resume.test.ts`.
 */
test("T4: agent vraagt een beslissing, taak wacht en de agent hervat", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Agent", taskTitle: "E2E Beslissing" },
  });
  expect(createResponse.status()).toBe(200);
  const task = await createResponse.json();

  // Het werkdocument bevat nog geen antwoord, dus de agent moet de vraag stellen.
  const askResponse = await request.post("/_agent-native/actions/ask-human-task", {
    data: {
      taskId: task.id,
      askedUserId: "dev@local.test",
      question: "Welke database kiezen we?",
      reason: "De migratie moet weten waar de data naartoe gaat.",
      options: ["Postgres", "MongoDB"],
    },
  });
  expect(askResponse.status()).toBe(200);
  const asked = await askResponse.json();
  expect(asked.asked).toBe(true);
  expect(asked.knownAnswer).toBeNull();
  expect(asked.humanTask.question).toBe("Welke database kiezen we?");
  expect(asked.humanTask.reason).toBe(
    "De migratie moet weten waar de data naartoe gaat.",
  );
  expect(asked.humanTask.options).toEqual(["Postgres", "MongoDB"]);

  // Een vraag zonder waarom is geen bruikbare vraag.
  const invalidResponse = await request.post("/_agent-native/actions/ask-human-task", {
    data: {
      taskId: task.id,
      askedUserId: "dev@local.test",
      question: "Welke database kiezen we?",
      reason: "   ",
      options: ["Postgres", "MongoDB"],
    },
  });
  expect(invalidResponse.status()).toBe(400);

  // Twee vragen achter elkaar kan niet: de eerste staat nog open.
  const dubbel = await request.post("/_agent-native/actions/ask-human-task", {
    data: {
      taskId: task.id,
      askedUserId: "dev@local.test",
      question: "Welke migratietool gebruiken we?",
      reason: "De planning moet weten waarmee we werken.",
      options: ["Goose", "node-pg-migrate"],
    },
  });
  expect(dubbel.status()).toBe(409);
  const naDubbeleVraag = await (
    await request.get("/_agent-native/actions/list-human-tasks")
  ).json();
  // De lijst bevat ook vragen uit een eerdere run, dus we tellen per taak.
  const vragenVoorDezeTaak = (lijst: { humanTasks: { taskId: string }[] }) =>
    lijst.humanTasks.filter((item) => item.taskId === task.id);
  expect(vragenVoorDezeTaak(naDubbeleVraag)).toHaveLength(1);

  // De taak staat op "wacht op iemand" zolang er geen antwoord is.
  const waiting = await (
    await request.get(`/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`)
  ).json();
  expect(waiting.task.status).toBe("wacht op iemand");

  // De vraag staat in "Wacht op jou" met alle drie de velden.
  const open = await (await request.get("/_agent-native/actions/list-human-tasks")).json();
  const vraag = open.humanTasks.find((item: any) => item.id === asked.humanTask.id);
  expect(vraag.question).toBe("Welke database kiezen we?");
  expect(vraag.reason).toBe("De migratie moet weten waar de data naartoe gaat.");
  expect(vraag.options).toEqual(["Postgres", "MongoDB"]);

  // "Wacht op jou" is bereikbaar vanaf de takenlijst; de taakpagina is daarvoor
  // niet nodig. De lijst toont alles wat op deze persoon wacht, dus we kijken
  // naar het item van deze vraag.
  await page.goto("/tasks");
  const takenlijstPanel = page.getByTestId("wacht-op-jou");
  const vraagOpTakenlijst = takenlijstPanel
    .locator(
      `li:has(a[data-testid="wacht-op-jou-taak"][href="/tasks/${task.id}"])`,
    )
    .filter({ hasText: "Welke database kiezen we?" });
  await expect(vraagOpTakenlijst).toHaveCount(1, { timeout: 20_000 });
  await expect(vraagOpTakenlijst).toContainText("E2E Beslissing");
  await expect(vraagOpTakenlijst).toContainText(
    "De migratie moet weten waar de data naartoe gaat.",
  );
  await expect(
    vraagOpTakenlijst.getByTestId("human-task-optie"),
  ).toHaveCount(2);

  // En in de taakpagina zichtbaar, met de opties als knoppen.
  await page.goto(`/tasks/${task.id}`);
  const panel = page.getByTestId("wacht-op-jou");
  await expect(panel).toContainText("Welke database kiezen we?", { timeout: 20_000 });
  await expect(panel).toContainText("De migratie moet weten waar de data naartoe gaat.");
  await expect(panel.getByTestId("human-task-optie")).toHaveCount(2);

  // De tweede persoon antwoordt met een van de opties; de agent hervat.
  const answerResponse = await request.post("/_agent-native/actions/answer-human-task", {
    data: { id: asked.humanTask.id, answer: "Postgres" },
  });
  expect(answerResponse.status()).toBe(200);
  const answered = await answerResponse.json();
  expect(answered.answer).toBe("Postgres");
  expect(answered.taskStatus).toBe("bezig");
  expect(answered.agentMessage).toBe(
    "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
  );

  // Na het antwoord is er geen openstaande vraag meer en wacht de taak niet meer.
  const openAfter = await (await request.get("/_agent-native/actions/list-human-tasks")).json();
  expect(vragenVoorDezeTaak(openAfter)).toEqual([]);

  const after = await (
    await request.get(`/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`)
  ).json();
  expect(after.task.status).toBe("bezig");
  expect(after.events.map((event: any) => event.type)).toEqual([
    "human_task_answered",
    "message",
  ]);

  // Staat het antwoord al in het werkdocument, dan vraagt de agent niet.
  await request.post("/_agent-native/actions/update-work-document", {
    data: { taskId: task.id, markdown: "# Databasestratiege\n\nWe kiezen Postgres.\n" },
  });
  const knownResponse = await request.post("/_agent-native/actions/ask-human-task", {
    data: {
      taskId: task.id,
      askedUserId: "dev@local.test",
      question: "Welke database kiezen we?",
      reason: "De migratie moet weten waar de data naartoe gaat.",
      options: ["Postgres", "MongoDB"],
    },
  });
  expect(knownResponse.status()).toBe(200);
  const known = await knownResponse.json();
  expect(known.asked).toBe(false);
  expect(known.humanTask).toBeNull();
  expect(known.knownAnswer.option).toBe("Postgres");
  expect(known.knownAnswer.source).toBe("werkdocument");

  // Er is dus geen tweede vraag ontstaan.
  const finalOpen = await (await request.get("/_agent-native/actions/list-human-tasks")).json();
  expect(vragenVoorDezeTaak(finalOpen)).toEqual([]);

  // De vraag komt niet als melding binnen: een melding vraagt geen antwoord,
  // en deze vraag pauzeert de taak. Ze staat alleen in "Wacht op jou".
  const meldingen = await (await request.get("/_agent-native/actions/list-meldingen")).json();
  const vraagMelding = meldingen.meldingen.find(
    (melding: any) => melding.taskId === task.id && melding.title.includes("beslissing"),
  );
  expect(vraagMelding).toBeUndefined();
});

test("T4: een vraag die niemand kan beantwoorden blokkeert de taak niet", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Agent", taskTitle: "E2E Opheffen" },
  });
  const task = await createResponse.json();

  // Iemand die geen lid is, kan de vraag niet beantwoorden: geen vraag, geen
  // wachtstatus. De agent kan meteen opnieuw vragen.
  const nietLid = await request.post("/_agent-native/actions/ask-human-task", {
    data: {
      taskId: task.id,
      askedUserId: "niemand-die-geen-lid-is@e2e.test",
      question: "Welke migratietool gebruiken we?",
      reason: "De planning moet weten waarmee we werken.",
      options: ["Goose", "node-pg-migrate"],
    },
  });
  expect(nietLid.status()).toBe(403);
  expect((await nietLid.json()).errorCode).toBe("not_a_member");

  const naWeigering = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(naWeigering.task.status).toBe("bezig");

  // Aan een echt lid lukt het wel, en in de taakpagina staat de uitweg zichtbaar.
  const gevraagd = await (
    await request.post("/_agent-native/actions/ask-human-task", {
      data: {
        taskId: task.id,
        askedUserId: "dev@local.test",
        question: "Welke migratietool gebruiken we?",
        reason: "De planning moet weten waarmee we werken.",
        options: ["Goose", "node-pg-migrate"],
      },
    })
  ).json();
  expect(gevraagd.asked).toBe(true);

  await page.goto(`/tasks/${task.id}`);
  const opheffen = page.getByTestId("human-task-opheffen");
  await expect(opheffen).toHaveCount(1, { timeout: 20_000 });

  const geannuleerd = await request.post("/_agent-native/actions/cancel-human-task", {
    data: { id: gevraagd.humanTask.id },
  });
  expect(geannuleerd.status()).toBe(200);
  expect((await geannuleerd.json()).cancelled).toBe(true);

  const naAnnuleren = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(naAnnuleren.task.status).toBe("bezig");
  expect(naAnnuleren.events.map((event: any) => event.type)).toContain(
    "human_task_cancelled",
  );

  const open = await (await request.get("/_agent-native/actions/list-human-tasks")).json();
  expect(
    open.humanTasks.filter((item: any) => item.taskId === task.id),
  ).toEqual([]);

  // En opnieuw vragen kan: de taak zit niet meer vast.
  const opnieuw = await request.post("/_agent-native/actions/ask-human-task", {
    data: {
      taskId: task.id,
      askedUserId: "dev@local.test",
      question: "Wanneer starten we met de migratie?",
      reason: "De planning moet een datum hebben.",
      options: ["Volgende week", "Over twee weken"],
    },
  });
  expect(opnieuw.status()).toBe(200);
});
