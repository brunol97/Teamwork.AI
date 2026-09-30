import fs from "node:fs";
import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(120_000);

/**
 * LET OP — wat deze test wel en niet bewijst.
 *
 * `playwright.config.ts` draait met `AGENT_OFFICE_MOCK_LLM_RESPONSE`, dus het
 * antwoord van de agent is altijd dezelfde zin. Het antwoord van de
 * slice-planner-agent is daardoor nooit zelf als slices te lezen; de planner
 * valt dan terug op één slice per requirement uit het werkdocument. De
 * gegenereerde slices in de eerste test komen dus uit die terugvalplanner, niet
 * uit een echt model. Het parsen van een wél bruikbaar modelantwoord is in
 * `tests/documents/slice-planner.test.ts` en `tests/documents/slices.test.ts`
 * bewezen met een nagebootst antwoord.
 */

const EISEN = `# Eisen

## Inloggen
De gebruiker logt in met een magic link.

- De gebruiker logt in met alleen een e-mailadres.
- Een verlopen link wordt geweigerd.

## Dashboard
Het dashboard toont de stand van taken.
`;

test("T5: de slice-planner maakt tracer-slices en elke slice is los te exporteren", async ({
  request,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Planning", taskTitle: "E2E Tracer-slices" },
  });
  expect(createResponse.status()).toBe(200);
  const task = await createResponse.json();

  // De lead schrijft de requirements in het werkdocument.
  const schrijfResponse = await request.post(
    "/_agent-native/actions/update-work-document",
    { data: { taskId: task.id, markdown: EISEN } },
  );
  expect(schrijfResponse.status()).toBe(200);

  // Zonder verzoek ontstaat er geen sectie.
  const vooraf = await request.get(
    `/_agent-native/actions/list-tracer-slices?taskId=${encodeURIComponent(task.id)}`,
  );
  expect((await vooraf.json()).slices).toEqual([]);

  // De gebruiker vraagt in het gesprek om tracer-slices; de agent plaatst de
  // Tracer-slices-sectie in het werkdocument.
  const berichtResponse = await request.post("/_agent-native/actions/send-task-message", {
    data: { taskId: task.id, message: "Maak tracer-slices voor dit werkdocument" },
  });
  expect(berichtResponse.status()).toBe(200);
  const bericht = await berichtResponse.json();
  expect(bericht.documentSection).toEqual({ title: "Tracer-slices" });

  const documentResponse = await request.get(
    `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
  );
  const document = await documentResponse.json();
  expect(document.markdown).toContain("## Tracer-slices");

  // Elke slice bevat alle velden van het sjabloon en verwijst naar bestaande
  // requirements (hier: Inloggen en Dashboard uit het werkdocument).
  const lijstResponse = await request.get(
    `/_agent-native/actions/list-tracer-slices?taskId=${encodeURIComponent(task.id)}`,
  );
  expect(lijstResponse.status()).toBe(200);
  const { slices } = await lijstResponse.json();
  expect(slices.map((slice: any) => slice.titel)).toEqual(["Inloggen", "Dashboard"]);
  for (const slice of slices) {
    expect(slice.doel.trim()).not.toBe("");
    expect(slice.gedrag.trim()).not.toBe("");
    expect(slice.acceptatiecriteria.length).toBeGreaterThan(0);
    expect(slice.requirementRefs).toEqual([slice.titel]);
    expect(slice.buitenDezeSlice.trim()).not.toBe("");
    expect(slice.testaanpak.trim()).not.toBe("");
  }

  // De export van één slice is zelfstandig te lezen: taak, project, alle
  // velden en de volledige tekst van de verwezen requirement.
  const exportResponse = await request.get(
    `/_agent-native/actions/export-tracer-slice?taskId=${encodeURIComponent(task.id)}&sliceId=${encodeURIComponent(slices[0].id)}`,
  );
  expect(exportResponse.status()).toBe(200);
  const exportSlice = await exportResponse.json();
  expect(exportSlice.fileName).toBe("slice-1-inloggen.md");
  expect(exportSlice.markdown).toContain("# Slice 1: Inloggen");
  expect(exportSlice.markdown).toContain("E2E Tracer-slices");
  expect(exportSlice.markdown).toContain("E2E Planning");
  expect(exportSlice.markdown).toContain("De gebruiker logt in met een magic link.");
  expect(exportSlice.markdown).toContain("## Testaanpak");

  // Ordenen: de nieuwe volgorde blijft bewaard, ook in het werkdocument.
  const herordenResponse = await request.post(
    "/_agent-native/actions/reorder-tracer-slices",
    {
      data: {
        taskId: task.id,
        orderedIds: [slices[1].id, slices[0].id],
      },
    },
  );
  expect(herordenResponse.status()).toBe(200);

  const naHerordenen = await (
    await request.get(
      `/_agent-native/actions/list-tracer-slices?taskId=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(naHerordenen.slices.map((slice: any) => slice.titel)).toEqual([
    "Dashboard",
    "Inloggen",
  ]);

  const documentNaHerordenen = await (
    await request.get(
      `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
    )
  ).json();
  const dashboardPositie = documentNaHerordenen.markdown.indexOf("### Slice 1: Dashboard");
  const inloggenPositie = documentNaHerordenen.markdown.indexOf("### Slice 2: Inloggen");
  expect(dashboardPositie).toBeGreaterThan(-1);
  expect(inloggenPositie).toBeGreaterThan(dashboardPositie);

  // Samenvoegen en splitsen werken op dezelfde sectie.
  const samenvoegResponse = await request.post(
    "/_agent-native/actions/merge-tracer-slices",
    { data: { taskId: task.id, sliceId: naHerordenen.slices[0].id } },
  );
  expect(samenvoegResponse.status()).toBe(200);
  const naSamenvoegen = await (
    await request.get(
      `/_agent-native/actions/list-tracer-slices?taskId=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(naSamenvoegen.slices).toHaveLength(1);
  expect(naSamenvoegen.slices[0].requirementRefs).toEqual(["Dashboard", "Inloggen"]);

  const splitsResponse = await request.post(
    "/_agent-native/actions/split-tracer-slice",
    {
      data: {
        taskId: task.id,
        sliceId: naSamenvoegen.slices[0].id,
        afterCriteria: 1,
      },
    },
  );
  expect(splitsResponse.status()).toBe(200);
  const naSplitsen = await (
    await request.get(
      `/_agent-native/actions/list-tracer-slices?taskId=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(naSplitsen.slices).toHaveLength(2);

  // Alles staat in het activiteitenlog.
  const logResponse = await request.get(
    `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
  );
  const { events } = await logResponse.json();
  const types = events.map((event: any) => event.type);
  expect(types).toContain("document_section_added");
  expect(types).toContain("slices_reordered");
  expect(types).toContain("slices_merged");
  expect(types).toContain("slice_split");
});

test("T5: ordenen, samenvoegen, splitsen en exporteren op de taakpagina", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Planning", taskTitle: "E2E Slicespaneel" },
  });
  const task = await createResponse.json();

  // De Tracer-slices-sectie staat in het werkdocument; het paneel leest hem.
  const documentMetSlices = `${EISEN}
## Tracer-slices

### Slice 1: Inloggen met magic link

- **Doel:** Een ingelogde sessie opzetten met een magic link.
- **Gedrag:** De gebruiker vult een e-mailadres in en opent de link uit de mail.
- **Acceptatiecriteria:**
  - De gebruiker logt in met alleen een e-mailadres.
  - Een verlopen link wordt geweigerd met een leesbare melding.
- **Requirements-verwijzingen:** Inloggen
- **Buiten deze slice:** Het beheer van rollen.
- **Afhankelijkheden:** Geen
- **Testaanpak:** Unit-tests op de sessie-opbouw en één E2E-test van het inloggen.

### Slice 2: Dashboard met taken

- **Doel:** Inzicht in de stand van taken.
- **Gedrag:** De gebruiker ziet per project het aantal taken per status.
- **Acceptatiecriteria:**
  - Het dashboard toont de stand van taken.
  - Het aantal taken per status klopt met het activiteitenlog.
- **Requirements-verwijzingen:** Dashboard
- **Buiten deze slice:** Filteren op status.
- **Afhankelijkheden:** Inloggen met magic link
- **Testaanpak:** Unit-tests op de status-telling en één E2E-test van het dashboard.
`;
  const schrijfResponse = await request.post(
    "/_agent-native/actions/update-work-document",
    { data: { taskId: task.id, markdown: documentMetSlices } },
  );
  expect(schrijfResponse.status()).toBe(200);

  await page.goto(`/tasks/${encodeURIComponent(task.id)}`);
  const paneel = page.getByTestId("tracer-slices-panel");
  await expect(paneel).toBeVisible({ timeout: 20_000 });
  const slices = paneel.getByTestId("tracer-slice");
  await expect(slices).toHaveCount(2);
  await expect(slices.nth(0).getByTestId("slice-titel")).toContainText(
    "Inloggen met magic link",
  );
  await expect(slices.nth(1).getByTestId("slice-titel")).toContainText(
    "Dashboard met taken",
  );

  // Ordenen: de tweede slice gaat omhoog; de volgorde blijft bewaard na
  // herladen van de pagina.
  await slices.nth(1).getByTestId("slice-omhoog").click();
  await expect(slices.nth(0).getByTestId("slice-titel")).toContainText(
    "Dashboard met taken",
    { timeout: 20_000 },
  );
  await page.reload();
  const paneelNaHerladen = page.getByTestId("tracer-slices-panel");
  await expect(
    paneelNaHerladen.getByTestId("tracer-slice").nth(0).getByTestId("slice-titel"),
  ).toContainText("Dashboard met taken", { timeout: 20_000 });

  // Samenvoegen: de eerste slice valt samen met de volgende.
  await paneelNaHerladen.getByTestId("tracer-slice").nth(0).getByTestId("slice-samenvoegen").click();
  await expect(paneelNaHerladen.getByTestId("tracer-slice")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(paneelNaHerladen.getByTestId("slice-titel")).toContainText(
    "Dashboard met taken en Inloggen met magic link",
  );

  // Splitsen: na het eerste criterium ontstaan er weer twee slices.
  await paneelNaHerladen.getByTestId("slice-splitsen").first().click();
  await expect(paneelNaHerladen.getByTestId("tracer-slice")).toHaveCount(2, {
    timeout: 20_000,
  });

  // Exporteren: de download is een markdown-bestand dat zonder de app te
  // lezen is.
  const downloadWachter = page.waitForEvent("download");
  await paneelNaHerladen.getByTestId("slice-exporteren").first().click();
  const download = await downloadWachter;
  expect(download.suggestedFilename()).toMatch(/^slice-\d+-.*\.md$/);
  const pad = await download.path();
  const inhoud = fs.readFileSync(pad!, "utf8");
  expect(inhoud).toContain("# Slice 1:");
  expect(inhoud).toContain("E2E Slicespaneel");
  expect(inhoud).toContain("Het dashboard toont de stand van taken.");
  expect(inhoud).toContain("## Testaanpak");
});
