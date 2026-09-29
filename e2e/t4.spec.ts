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
 *   in de lijst, in de taakpagina en in de meldingen, en de velden zijn zichtbaar.
 *   De mailtransport zelf (Resend) wordt niet getest; `playwright.config.ts` heeft
 *   geen `RESEND_API_KEY`.
 * - "Na een herstart van de server gaat de agent verder" wordt hier NIET bewezen:
 *   de server blijft draaien. Dat pad is bewezen in
 *   `tests/collaboration/human-task-restart.test.ts`, waar de modules opnieuw
 *   geladen worden en alleen de database de vraag nog kent.
 * - "Staat het antwoord al in het document, dan vraagt de agent niet" wordt wel
 *   bewezen, via de action en daarna via de taakpagina.
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
  expect(openAfter.humanTasks).toEqual([]);

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
  expect(finalOpen.humanTasks).toEqual([]);

  // De vraag komt ook binnen als melding, met de drie velden erin.
  const meldingen = await (await request.get("/_agent-native/actions/list-meldingen")).json();
  const vraagMelding = meldingen.meldingen.find(
    (melding: any) => melding.taskId === task.id && melding.title.includes("beslissing"),
  );
  expect(vraagMelding.body).toContain("Welke database kiezen we?");
  expect(vraagMelding.body).toContain("De migratie moet weten waar de data naartoe gaat.");
  expect(vraagMelding.body).toContain("Postgres, MongoDB");
});
