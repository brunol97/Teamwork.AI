import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(180_000);

/**
 * LET OP — wat deze test wel en niet beweert.
 *
 * Het antwoord van de agent is gemockt via `AGENT_OFFICE_MOCK_LLM_RESPONSE`.
 * Er zijn twee standen:
 *
 * - **De t7-config** (zie de tijdelijke playwright-config in de werkoverlegging)
 *   start met een schone e2e-database en een mock die naast de standaardzin
 *   ook een evaluatietekst en één SKILL-VOORSTEL-blok voor de skill
 *   "e2e-notuleren" bevat. Dan draait deze test de hele keten: afronden
 *   levert een evaluatie op, het voorstel verschijnt in "Wacht op jou" van de
 *   eigenaar met uitleg en diff, en goedkeuren, aanpassen en afwijzen doen wat
 *   ze beloven.
 * - **De standaardconfig van de repo** mockt alleen de standaardzin. Dan
 *   bewijst deze test de kerninvariant — elke afronding levert precies één
 *   evaluatie op — en ziet hij dat er geen voorstellen ontstaan uit een
 *   antwoord zonder voorstell formaat.
 *
 * De terugval-evaluatie (agent onbereikbaar) is in
 * `tests/skills/complete-task.test.ts` bewezen; een E2E kan de LLM-call niet
 * per test laten mislukken.
 */

const SKILLNAAM = "e2e-notuleren";

const SKILL_V1 = `# Notuleren

Houd notulen bij van elke besluitvorming.
`;

test("T7: afronden levert een evaluatie op; het skill-voorstel is te beslissen", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  // Welke mock draait er? Een probebericht leert of het antwoord een
  // SKILL-VOORSTEL voor "e2e-notuleren" bevat.
  const probe = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Skills", taskTitle: `E2E Skills probe ${Date.now()}` },
    })
  ).json();
  const proefBericht = await request.post("/_agent-native/actions/send-task-message", {
    data: { taskId: probe.id, message: "hoe gaat het?" },
  });
  expect(proefBericht.status()).toBe(200);
  const metVoorstel = ((await proefBericht.json()).agentMessage as string).includes(
    `SKILL-VOORSTEL: ${SKILLNAAM}`,
  );

  // Onder de t7-mock heet de skill exact zoals in de mock (de database is dan
  // schoon gestart). Onder de standaardmock krijgt hij een unieke naam, want
  // die database blijft tussen runs bestaan.
  const skillnaam = metVoorstel ? SKILLNAAM : `${SKILLNAAM}-${Date.now()}`;

  // De eigenaar maakt de skill aan: versie 1, hijzelf is eigenaar.
  const skillRespons = await request.post("/_agent-native/actions/create-skill", {
    data: { name: skillnaam, content: SKILL_V1 },
  });
  expect(skillRespons.status()).toBe(200);
  const skill = (await skillRespons.json()).skill;
  expect(skill.currentVersion).toBe(1);

  const taak = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Skills", taskTitle: "E2E Skills en evaluatie" },
    })
  ).json();

  // Afronden via de interface: de knop zet de taak op klaar en de evaluatie
  // verschijnt in het paneel van de taak.
  await page.goto(`/tasks/${taak.id}`);
  await page.getByTestId("taak-afronden").click({ timeout: 20_000 });
  await expect(page.getByTestId("taak-klaar")).toBeVisible({ timeout: 20_000 });
  const evaluatiePaneel = page.getByTestId("evaluaties");
  await expect(evaluatiePaneel).toBeVisible({ timeout: 20_000 });
  // De standaardzin van de mock hoort altijd in de evaluatie te zitten.
  await expect(evaluatiePaneel).toContainText(
    "geautomatiseerd testantwoord",
    { timeout: 20_000 },
  );
  if (metVoorstel) {
    await expect(evaluatiePaneel).toContainText("De taak liep goed", {
      timeout: 20_000,
    });
  }

  // De evaluatie is ook via de actie te lezen: precies één per afronding.
  const evaluaties = await (
    await request.get(
      `/_agent-native/actions/list-evaluations?taskId=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  expect(evaluaties.evaluations).toHaveLength(1);
  expect(evaluaties.evaluations[0].fallback).toBe(false);

  if (!metVoorstel) {
    // Onder de standaardmock bevat het antwoord geen voorstelformaat, dus
    // er staat geen voorstel in "Wacht op jou".
    await page.goto("/tasks");
    await expect(page.getByTestId("skill-voorstellen")).toHaveCount(0, {
      timeout: 20_000,
    });
    return;
  }

  // Het voorstel uit het antwoord van de agent staat in "Wacht op jou" van de
  // eigenaar, met uitleg en diff, bereikbaar vanaf de takenlijst.
  await page.goto("/tasks");
  const voorstellen = page.getByTestId("skill-voorstellen");
  await expect(voorstellen).toBeVisible({ timeout: 20_000 });
  await expect(voorstellen).toContainText(`Skill: ${skillnaam} (versie 1)`);
  await expect(voorstellen).toContainText("afsluitchecklist");
  await expect(voorstellen.getByTestId("voorstel-diff")).toContainText(
    "+ Sluit af met een checklist van open punten.",
  );

  // Goedkeuren: de nieuwe versie wordt actief en de oude blijft bewaard.
  await voorstellen.getByTestId("voorstel-goedkeuren").click();
  await expect(page.getByRole("status")).toContainText("Goedgekeurd", {
    timeout: 20_000,
  });

  const naGoedkeuring = await (
    await request.get(
      `/_agent-native/actions/get-skill?id=${encodeURIComponent(skill.id)}`,
    )
  ).json();
  expect(naGoedkeuring.skill.currentVersion).toBe(2);
  expect(naGoedkeuring.versions).toHaveLength(2);
  expect(naGoedkeuring.versions[0].content).toBe(SKILL_V1);
  expect(naGoedkeuring.versions[1].content).toContain(
    "checklist van open punten",
  );

  // Het voorstel verdwijnt uit "Wacht op jou"; de skill staat op versie 2.
  await expect(voorstellen).not.toBeVisible({ timeout: 20_000 });
  await page.goto("/agents");
  await expect(page.getByTestId("skills-lijst")).toContainText(skillnaam, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("skills-lijst")).toContainText("versie 2");

  // Aanpassen: een tweede afronding levert een nieuw voorstel; de eigenaar
  // past de inhoud aan voordat hij goedkeurt.
  const tweedeTaak = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Skills", taskTitle: "E2E Aanpassen" },
    })
  ).json();
  const afronden = await request.post("/_agent-native/actions/complete-task", {
    data: { taskId: tweedeTaak.id },
  });
  expect(afronden.status()).toBe(200);

  await page.goto("/tasks");
  const paneel2 = page.getByTestId("skill-voorstellen");
  await expect(paneel2.getByTestId("voorstel-aanpassen")).toBeVisible({
    timeout: 20_000,
  });
  await paneel2.getByTestId("voorstel-aanpassen").click();
  const veld = paneel2.getByTestId("voorstel-inhoud");
  await expect(veld).toBeVisible();
  await veld.fill(
    "# Notuleren (aangepast door de eigenaar)\n\nHoud notulen bij.",
  );
  await paneel2.getByTestId("voorstel-goedkeuren-aangepast").click();
  await expect(page.getByRole("status")).toContainText(
    "aangepaste versie is de nieuwe actieve versie",
    { timeout: 20_000 },
  );

  const naAanpassing = await (
    await request.get(
      `/_agent-native/actions/get-skill?id=${encodeURIComponent(skill.id)}`,
    )
  ).json();
  expect(naAanpassing.skill.currentVersion).toBe(3);
  expect(naAanpassing.versions).toHaveLength(3);
  expect(naAanpassing.versions[2].content).toContain(
    "aangepast door de eigenaar",
  );

  // Afwijzen: een derde voorstel laat de actieve versie staan.
  const derdeTaak = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Skills", taskTitle: "E2E Afwijzen" },
    })
  ).json();
  await request.post("/_agent-native/actions/complete-task", {
    data: { taskId: derdeTaak.id },
  });

  await page.goto("/tasks");
  const paneel3 = page.getByTestId("skill-voorstellen");
  await expect(paneel3.getByTestId("voorstel-afwijzen")).toBeVisible({
    timeout: 20_000,
  });
  await paneel3.getByTestId("voorstel-afwijzen").click();
  await expect(page.getByRole("status")).toContainText("Afgewezen", {
    timeout: 20_000,
  });
  await expect(paneel3).not.toBeVisible({ timeout: 20_000 });

  const naAfwijzing = await (
    await request.get(
      `/_agent-native/actions/get-skill?id=${encodeURIComponent(skill.id)}`,
    )
  ).json();
  expect(naAfwijzing.skill.currentVersion).toBe(3);
  expect(naAfwijzing.versions).toHaveLength(3);
});
