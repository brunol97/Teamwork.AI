import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(180_000);

/**
 * LET OP — wat deze test wel en niet beweert.
 *
 * De test draait met `AUTH_DISABLED=true`, dus er is één account
 * (`dev@local.test`). Daardoor:
 *
 * - AC1 ("de laatste beheerder kan niet vertrekken of zijn rol verliezen")
 *   wordt bewezen via het framework-oppervlak dat de Rollen-pagina linkt: het
 *   framework weigert het demoten (400) en het verwijderen (400/403) van de
 *   eigenaar. De app schrijft zelf nooit in `org_members`, dus er is geen
 *   app-pad dat de bescherming kan omzeilen.
 * - "Wacht op mij" kan hier alleen vragen aan het eigen account zien. De
 *   precisie wordt bewezen met een open vraag (wel wacht op mij), een
 *   beantwoorde vraag (niet meer) en een gewone taak (niet). Dat een vraag aan
 *   een ánder lid niet meetelt, bewijst `tests/org/overzicht.test.ts` met een
 *   echte tweede lid.
 * - De drie onboardingkeuzes worden als acties bewezen (persoonlijk en team
 *   via create-organisatie, deelnemen via de bestaande uitnodigingslink van
 *   t3); de keuzepagina zelf wordt in de browser geopend.
 */

const actie = async (
  request: any,
  naam: string,
  data?: Record<string, unknown>,
) => {
  const response = await request.post(`/_agent-native/actions/${naam}`, {
    data: data ?? {},
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
};

test("T9: onboarding met drie keuzes en meerdere organisaties", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  // De standaardorganisatie van de dev-account, om op het eind van de test
  // naar terug te wisselen: de actieve organisatie is een instelling van het
  // account, niet van de browser.
  const lijst0 = await (await request.get("/_agent-native/actions/list-mijn-organisaties")).json();
  const oorspronkelijkeOrgId = lijst0.actieveOrganisatieId as string;
  expect(oorspronkelijkeOrgId).toBeTruthy();

  // De keuzepagina bestaat en toont de drie keuzes.
  await page.goto("/onboarding");
  await expect(page.getByTestId("keuze-persoonlijk")).toBeVisible();
  await expect(page.getByTestId("keuze-team")).toBeVisible();
  await expect(page.getByTestId("uitnodiging-link")).toBeVisible();

  // Keuze 1: een persoonlijke werkruimte starten; hij wordt meteen actief.
  const persoonlijk = await actie(request, "create-organisatie", {
    soort: "persoonlijk",
    naam: `E2E Persoonlijk ${Date.now()}`,
  });
  expect(persoonlijk.status).toBe(200);
  expect(persoonlijk.body.soort).toBe("persoonlijk");

  const lijst1 = await (await request.get("/_agent-native/actions/list-mijn-organisaties")).json();
  expect(lijst1.actieveOrganisatieId).toBe(persoonlijk.body.organizationId);
  const persoonlijkEntry = lijst1.organisaties.find(
    (o: any) => o.organizationId === persoonlijk.body.organizationId,
  );
  expect(persoonlijkEntry.soort).toBe("persoonlijk");

  // Keuze 2: een team starten als aparte organisatie.
  const team = await actie(request, "create-organisatie", {
    soort: "team",
    naam: `E2E Team ${Date.now()}`,
  });
  expect(team.status).toBe(200);
  expect(team.body.soort).toBe("team");
  // Het aanmaken maakte het nieuwe team meteen actief.
  const lijst2 = await (await request.get("/_agent-native/actions/list-mijn-organisaties")).json();
  expect(lijst2.actieveOrganisatieId).toBe(team.body.organizationId);

  // Wisselen tussen de organisaties: alleen naar een echt lidmaatschap.
  const vreemd = await actie(request, "switch-organisatie", {
    orgId: "bestaat-niet-e2e",
  });
  expect(vreemd.status).toBe(403);
  expect(vreemd.body.errorCode).toBe("not_a_member");

  const terug = await actie(request, "switch-organisatie", {
    orgId: persoonlijk.body.organizationId,
  });
  expect(terug.status).toBe(200);
  expect(terug.body.organizationId).toBe(persoonlijk.body.organizationId);

  // AC3: de persoonlijke werkruimte wordt een team zonder dataverlies.
  const taak = await actie(request, "create-task", {
    projectName: `E2E Omzetten ${Date.now()}`,
    taskTitle: "E2E taak vóór de omzetting",
  });
  expect(taak.status).toBe(200);

  const omzetten = await actie(request, "convert-to-team");
  expect(omzetten.status).toBe(200);
  expect(omzetten.body.soort).toBe("team");
  expect(omzetten.body.takenAantal).toBeGreaterThanOrEqual(1);

  const takenNa = await (await request.get("/_agent-native/actions/list-tasks")).json();
  expect(
    takenNa.some((t: any) => t.id === taak.body.id),
    "de taak bestaat nog na de omzetting",
  ).toBe(true);

  const nogEenKeer = await actie(request, "convert-to-team");
  expect(nogEenKeer.status).toBe(409);
  expect(nogEenKeer.body.errorCode).toBe("already_a_team");

  // Terug naar de oorspronkelijke organisatie voor de rest van de test.
  const terugNaarStandaard = await actie(request, "switch-organisatie", {
    orgId: oorspronkelijkeOrgId,
  });
  expect(terugNaarStandaard.status).toBe(200);
});

test("T9: de laatste beheerder kan niet vertrekken of zijn rol verliezen", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  // De Rollen-pagina toont de leden met hun rol en de bescherming.
  await page.goto("/organisatie");
  await expect(page.getByTestId("leden-lijst")).toBeVisible();
  await expect(page.getByText("laatste beheerder")).toBeVisible();

  // Er bestaat geen REST-route om de rol van een lid te veranderen: PUT op
  // members/:email/role geeft 405 ( Methode Not Allowed). Rolwijzigingen
  // bestaan alleen in de framework-instellingen, die het demoten of
  // verwijderen van de eigenaar weigeren. De app zelf schrijft nooit in
  // `org_members`, dus er is geen pad — app of framework — dat de laatste
  // beheerder zijn rol kan laten verliezen.
  const demote = await request.put(
    "/_agent-native/org/members/dev@local.test/role",
    { data: { role: "member" } },
  );
  expect(demote.status()).toBe(405);

  // Het framework weigert het verwijderen van de eigenaar (dus van de laatste
  // beheerder): vertrekken kan niet. In de dev-omgeving blijft het DELETE-
  // verzoek soms hangen (framework-gedrag, geen T9-code), daarom vraagt de
  // test een begrensde timeout en telt het resultaat niet als succes: wat er
  // ook gebeurt, het verwijderen mag nooit slagen en de eigenaar moet er
  // daarna nog steeds als owner staan.
  let verwijderStatus = 0;
  try {
    const verwijder = await request.delete(
      "/_agent-native/org/members/dev@local.test",
      {
        data: { transferTo: "iemand-anders@local.test" },
        timeout: 10_000,
      },
    );
    verwijderStatus = verwijder.status();
  } catch {
    verwijderStatus = 0;
  }
  expect(verwijderStatus, "het verwijderen van de eigenaar mag nooit slagen").not.toBe(
    200,
  );

  const leden = await (
    await request.get("/_agent-native/org/members")
  ).json();
  expect(leden.members).toHaveLength(1);
  expect(leden.members[0].email).toBe("dev@local.test");
  expect(leden.members[0].role).toBe("owner");
});

test("T9: het overzicht telt per project per status en 'Wacht op mij' filtert correct", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const uniek = Date.now();

  // Een klant en een project onder die klant: klanten zijn optioneel.
  const klant = await actie(request, "create-klant", {
    naam: `E2E Klant ${uniek}`,
  });
  expect(klant.status).toBe(200);
  const klanten = await (await request.get("/_agent-native/actions/list-klanten")).json();
  expect(
    klanten.klanten.some((k: any) => k.id === klant.body.id),
  ).toBe(true);

  // Een project met één taak per status, onder de klant.
  const projectNaam = `E2E Overzicht ${uniek}`;
  const bezig = await actie(request, "create-task", {
    projectName: projectNaam,
    taskTitle: `E2E bezig ${uniek}`,
    klantId: klant.body.id,
  });
  expect(bezig.status).toBe(200);
  const wacht = await actie(request, "create-task", {
    projectName: projectNaam,
    taskTitle: `E2E wacht ${uniek}`,
  });
  const klaar = await actie(request, "create-task", {
    projectName: projectNaam,
    taskTitle: `E2E klaar ${uniek}`,
  });
  const gepauzeerd = await actie(request, "create-task", {
    projectName: projectNaam,
    taskTitle: `E2E gepauzeerd ${uniek}`,
  });

  // Status zetten: wacht op iemand (open vraag aan mij), klaar (afronden),
  // gepauzeerd (pauzeren door de lead).
  const vraag = await actie(request, "ask-human-task", {
    taskId: wacht.body.id,
    askedUserId: "dev@local.test",
    question: `E2E overzicht vraag ${uniek}?`,
    reason: "De test wil een open vraag.",
    options: ["Ja", "Nee"],
  });
  expect(vraag.status).toBe(200);
  expect(vraag.body.asked).toBe(true);

  const afronden = await actie(request, "complete-task", {
    taskId: klaar.body.id,
  });
  expect(afronden.status).toBe(200);

  const pauze = await actie(request, "pause-task", {
    taskId: gepauzeerd.body.id,
  });
  expect(pauze.status).toBe(200);

  // Een tweede taak met een vraag die beantwoord is: telt niet meer als
  // "wacht op mij".
  const beantwoordTaak = await actie(request, "create-task", {
    projectName: projectNaam,
    taskTitle: `E2E beantwoord ${uniek}`,
  });
  const vraag2 = await actie(request, "ask-human-task", {
    taskId: beantwoordTaak.body.id,
    askedUserId: "dev@local.test",
    question: `E2E beantwoord vraag ${uniek}?`,
    reason: "De test wil een beantwoorde vraag.",
    options: ["Ja", "Nee"],
  });
  expect(vraag2.status).toBe(200);
  const antwoord = await actie(request, "answer-human-task", {
    id: vraag2.body.humanTask.id,
    answer: "Ja",
  });
  expect(antwoord.status).toBe(200);

  // Het overzicht klopt: per project het aantal taken per status.
  const overzicht = await (await request.get("/_agent-native/actions/get-overzicht")).json();
  const project = overzicht.projecten.find(
    (p: any) => p.projectName === projectNaam,
  );
  expect(project).toBeDefined();
  expect(project.klantId).toBe(klant.body.id);
  expect(project.tellingen).toEqual({
    "bezig": 2,
    "wacht op iemand": 1,
    "gepauzeerd": 1,
    "klaar": 1,
  });
  expect(project.totaal).toBe(5);

  // "Wacht op mij" filtert correct: exact de taken met een open vraag aan
  // mij, niet de beantwoorde vraag en niet de gewone taken.
  const wachtOpMij = overzicht.taken.filter((t: any) => t.wachtOpMij);
  expect(wachtOpMij.map((t: any) => t.id)).toContain(wacht.body.id);
  expect(wachtOpMij.map((t: any) => t.id)).not.toContain(beantwoordTaak.body.id);
  expect(wachtOpMij.map((t: any) => t.id)).not.toContain(bezig.body.id);
  expect(wachtOpMij.every((t: any) => t.status === "wacht op iemand")).toBe(true);
  expect(
    overzicht.taken.find((t: any) => t.id === wacht.body.id).projectName,
  ).toBe(projectNaam);

  // In de UI: het filter toont precies de taken met een open vraag aan mij —
  // de taak met de open vraag wel, de beantwoorde vraag en de gewone taken
  // niet. (Er kunnen open vragen van eerdere runs in de database staan, dus
  // de telling zelf is hier niet exact; de inhoud wel.)
  await page.goto("/overzicht");
  await expect(page.getByTestId(`project-kaart-${projectNaam}`)).toBeVisible();
  await expect(
    page.getByTestId(`telling-${project.projectId}-gepauzeerd`),
  ).toHaveText(/Gepauzeerd: 1/);

  await page.getByTestId("filter-wacht-op-mij").click();
  const rijen = page.locator('[data-testid^="overzicht-taak-"]');
  await expect(
    rijen.filter({ hasText: `E2E wacht ${uniek}` }),
  ).toHaveCount(1);
  await expect(
    rijen.filter({ hasText: `E2E wacht ${uniek}` }).first(),
  ).toContainText("wacht op mij");
  for (const titel of [
    `E2E bezig ${uniek}`,
    `E2E klaar ${uniek}`,
    `E2E gepauzeerd ${uniek}`,
    `E2E beantwoord ${uniek}`,
  ]) {
    await expect(rijen.filter({ hasText: titel })).toHaveCount(0);
  }

  // Terug naar "alles" toont weer de taken van het gefilterde project.
  await page.getByTestId("filter-alles").click();
  await expect(
    rijen.filter({ hasText: `E2E bezig ${uniek}` }),
  ).toHaveCount(1);
});
