import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(180_000);

/**
 * LET OP — wat deze test wel en niet beweert.
 *
 * De agent draait hier met de gemockte LLM van `playwright.config.ts`, dus de
 * "automatisch opgestelde" overdrachtsnotitie is hier de deterministische
 * opstelling uit taakgegevens (die is ook onder productie geen LLM-werk).
 * De paden met een tweede mens — de melding naar een ándere nieuwe lead,
 * niet_the_lead, not_a_member — zijn in `tests/collaboration/overdracht.test.ts`
 * bewijs met echte organisatieleden; de e2e-omgeving kent maar één gebruiker.
 *
 * Wat hier wél via de echte acties en de echte interface bewezen wordt:
 * pauzeren zet de taak op gepauzeerd en stelt een aanpasbare notitie op,
 * de agent neemt tijdens de pauze geen berichten aan, hervatten is de weg
 * terug naar bezig, documentonderdelen zijn toe te wijzen, en overdragen
 * finaliseert de notitie onveranderlijk in het log mét melding.
 */

test("T8: pauzeren, de overdrachtsnotitie en hervatten", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const taak = await (
    await request.post("/_agent-native/actions/create-task", {
      data: {
        projectName: "E2E Overdracht",
        taskTitle: `E2E Pauzeren ${Date.now()}`,
      },
    })
  ).json();

  // Pauzeren via de interface.
  await page.goto(`/tasks/${taak.id}`);
  await page.getByTestId("taak-pauzeren").click({ timeout: 20_000 });
  await expect(page.getByTestId("taak-gepauzeerd")).toBeVisible({
    timeout: 20_000,
  });

  // Er ontstaat een automatisch opgesteld, aanpasbaar concept.
  const notitieVeld = page.getByTestId("overdracht-notitie");
  await expect(notitieVeld).toBeVisible({ timeout: 20_000 });
  await expect(notitieVeld).toContainText("E2E Pauzeren");
  await expect(page.getByTestId("overdracht-paneel")).toContainText("Concept");

  // De lead past het concept aan: het blijft aanpasbaar.
  await notitieVeld.fill(
    `Pauzenotitie ${Date.now()}: lees eerst de eisen voordat je verdergaat.`,
  );
  await page.getByTestId("notitie-opslaan").click();
  await expect(page.getByRole("status")).toContainText("bijgewerkt", {
    timeout: 20_000,
  });

  const gelezen = await (
    await request.get(
      `/_agent-native/actions/get-overdracht-note?taskId=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  expect(gelezen.note.status).toBe("open");
  expect(gelezen.note.content).toContain("lees eerst de eisen");

  // Tijdens de pauze neemt de agent geen berichten aan.
  const tijdensPauze = await request.post("/_agent-native/actions/send-task-message", {
    data: { taskId: taak.id, message: "Ga verder." },
  });
  expect(tijdensPauze.status()).toBe(409);

  // Hervatten via de interface; de taak staat weer op bezig.
  await page.getByTestId("taak-hervatten").click();
  await expect(page.getByTestId("taak-gepauzeerd")).not.toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("overdracht-paneel")).toContainText(
    "De taak is hervat",
    { timeout: 20_000 },
  );

  const naHervat = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  expect(naHervat.task.status).toBe("bezig");

  // En de agent neemt weer berichten aan.
  const naHervatBericht = await request.post(
    "/_agent-native/actions/send-task-message",
    { data: { taskId: taak.id, message: "Ga verder." } },
  );
  expect(naHervatBericht.status()).toBe(200);
});

test("T8: documentonderdelen toewijzen en de taak overdragen", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const taak = await (
    await request.post("/_agent-native/actions/create-task", {
      data: {
        projectName: "E2E Overdracht",
        taskTitle: `E2E Toewijzen ${Date.now()}`,
      },
    })
  ).json();

  // Een sectie in het werkdocument, via de gewone sectieweg van de agent.
  const sectie = await request.post("/_agent-native/actions/send-task-message", {
    data: {
      taskId: taak.id,
      message: "Schrijf een sectie over datamigratie.",
    },
  });
  expect(sectie.status()).toBe(200);

  const taken = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  const lead: string = taken.task.leadId;
  expect(taken.deelnemers).toContain(lead);

  // Toewijzen via de interface: het onderdeel krijgt de deelnemer.
  await page.goto(`/tasks/${taak.id}`);
  const paneel = page.getByTestId("document-secties");
  await expect(paneel).toBeVisible({ timeout: 20_000 });
  await expect(paneel).toContainText("Datamigratie");
  const rij = paneel.getByTestId("sectie-rij").filter({ hasText: "Datamigratie" });
  await rij.getByTestId("sectie-toewijzing").selectOption({ label: lead });
  await expect(rij.getByTestId("sectie-toegewezen-aan")).toHaveText(lead, {
    timeout: 20_000,
  });

  const toewijzingen = await (
    await request.get(
      `/_agent-native/actions/list-document-sections?taskId=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  const datamigratie = toewijzingen.sections.find(
    (onderdeel: { title: string }) => onderdeel.title === "Datamigratie",
  );
  expect(datamigratie.assigneeId).toBe(lead);

  // Overdragen: de notitie wordt gefinaliseerd in het log en de nieuwe lead
  // krijgt een melding met de notitie. In deze omgeving is de enige lid de
  // lead zelf; de paden met een tweede mens staan in de unit-tests.
  const overdracht = await request.post("/_agent-native/actions/transfer-task", {
    data: { taskId: taak.id, newLeadId: lead },
  });
  expect(overdracht.status()).toBe(200);
  const overgedragen = await overdracht.json();
  expect(overgedragen.notitie.status).toBe("gefinaliseerd");

  const naOverdracht = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  expect(naOverdracht.task.leadId).toBe(lead);
  const notitieEvent = naOverdracht.events.find(
    (event: { type: string }) => event.type === "overdracht_notitie",
  );
  expect(notitieEvent).toBeDefined();

  const meldingen = await (
    await request.get("/_agent-native/actions/list-meldingen")
  ).json();
  const overdrachtsMelding = meldingen.meldingen.find(
    (melding: { title: string; body: string }) =>
      melding.title.includes("overgedragen aan jou"),
  );
  expect(overdrachtsMelding).toBeDefined();
  expect(overdrachtsMelding.body).toContain("Overdrachtsnotitie");
});
