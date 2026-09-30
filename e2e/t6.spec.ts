import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(120_000);

/**
 * LET OP — wat deze test wel en niet beweert.
 *
 * `playwright.config.ts` draait met `AGENT_OFFICE_MOCK_LLM_RESPONSE`, dus het
 * antwoord van de agent is altijd dezelfde zin. Uitbesteden kan de gemockte
 * agent daarom nooit zelf vragen; de delegatieregels (rechten stapelen niet,
 * delegatiediepte maximaal 2) zijn bewezen in
 * `tests/agents/runner.test.ts` en `tests/agents/actions.test.ts` met een
 * nagebootst antwoord. Ook de pauze bij €10 is daar bewezen, niet hier: de
 * E2E-server kan zijn kostentelling niet per test worden ingesteld.
 *
 * Wat hier wél via de echte acties en de echte interface bewezen wordt:
 * een nieuwe agent is direct beschikbaar in alle taken van de organisatie,
 * hij is met @naam aan te roepen, de actieve agent kan gewisseld worden, en
 * de agent is te testen vanuit het beheer.
 */

const RUN = `${Date.now()}`;
const agentNaam = (basis: string) => `${RUN}-${basis}`;

test("T6: een nieuwe agent is direct beschikbaar, aan te roepen en te testen", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  // Twee taken: de agent moet in beide beschikbaar zijn zodra hij bestaat.
  const taakA = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Agents", taskTitle: `E2E Agents ${RUN} A` },
    })
  ).json();
  const agent = await (
    await request.post("/_agent-native/actions/create-agent", {
      data: {
        name: agentNaam("onderzoeker"),
        description: "Verzamelt informatie voor de E2E-test.",
        tools: ["web-zoeken"],
        skills: [],
      },
    })
  ).json();
  expect(agent.agent.name).toBe(agentNaam("onderzoeker"));
  expect(agent.agent.enabled).toBe(true);

  // De agent bestaat nog niet lang, maar is al in een tweede taak te kiezen.
  const taakB = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Agents", taskTitle: `E2E Agents ${RUN} B` },
    })
  ).json();
  const wisselB = await request.post("/_agent-native/actions/set-task-agent", {
    data: { taskId: taakB.id, agentId: agent.agent.id },
  });
  expect(wisselB.status()).toBe(200);
  expect((await wisselB.json()).agentName).toBe(agentNaam("onderzoeker"));

  // @naam aanroepen: de agent antwoordt in taak A en staat onder zijn naam in het log.
  const bericht = await request.post("/_agent-native/actions/send-task-message", {
    data: {
      taskId: taakA.id,
      message: `@${agentNaam("onderzoeker")} wat kun je?`,
    },
  });
  expect(bericht.status()).toBe(200);
  const antwoord = await bericht.json();
  expect(antwoord.agentName).toBe(agentNaam("onderzoeker"));
  expect(antwoord.agentMessage).toBe(
    "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
  );

  const gebeurtenissen = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(taakA.id)}`,
    )
  ).json();
  const agentBericht = gebeurtenissen.events.filter(
    (event: { type: string }) => event.type === "message",
  )[1];
  expect(agentBericht.actorId).toBe(agentNaam("onderzoeker"));

  // De interface: de agent staat in de lijst en is te testen.
  await page.goto("/agents");
  const lijst = page.getByTestId("agents-lijst");
  await expect(lijst).toContainText(`@${agentNaam("onderzoeker")}`, {
    timeout: 20_000,
  });

  await page.getByTestId("test-agent").selectOption(agent.agent.id);
  await page
    .getByTestId("test-taak")
    .selectOption({ label: `E2E Agents ${RUN} A` });
  await page
    .getByTestId("test-bericht")
    .fill(`@${agentNaam("onderzoeker")} testbericht`);
  await page.getByTestId("test-verstuur").click();
  await expect(page.getByTestId("test-antwoord")).toContainText(
    "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
    { timeout: 20_000 },
  );
});

test("T6: de actieve agent van een taak kan worden gewisseld", async ({
  request,
  page,
}) => {
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const taak = await (
    await request.post("/_agent-native/actions/create-task", {
      data: { projectName: "E2E Agents", taskTitle: `E2E Wisselen ${RUN}` },
    })
  ).json();
  const agent = await (
    await request.post("/_agent-native/actions/create-agent", {
      data: { name: agentNaam("schrijver") },
    })
  ).json();

  // Wisselen via de taakpagina.
  await page.goto(`/tasks/${taak.id}`);
  const keuze = page.getByTestId("actieve-agent-keuze");
  await expect(keuze).toBeVisible({ timeout: 20_000 });
  await keuze.selectOption(agent.agent.id);

  // De wissel staat in het activiteitenlog en de taak draagt de nieuwe agent.
  await expect(
    page.getByText(`De actieve agent is nu ${agentNaam("schrijver")}.`),
  ).toBeVisible({ timeout: 20_000 });

  const naWissel = await (
    await request.get(
      `/_agent-native/actions/get-task?id=${encodeURIComponent(taak.id)}`,
    )
  ).json();
  expect(naWissel.task.activeAgentId).toBe(agent.agent.id);

  // En de volgende berichten gaan zonder @naam naar de actieve agent.
  const bericht = await request.post("/_agent-native/actions/send-task-message", {
    data: { taskId: taak.id, message: "Schrijf verder." },
  });
  expect(bericht.status()).toBe(200);
  expect((await bericht.json()).agentName).toBe(agentNaam("schrijver"));
});
