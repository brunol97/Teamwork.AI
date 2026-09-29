import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(120_000);

/**
 * Bovengrens voor live updates in deze test. In een opgewarmde run blijft de
 * aanwezigheid rond de 850ms en het werkdocument en de melding ruim onder een
 * seconde, dus een echte regressie (bijvoorbeeld een poll die pas na vier
 * seconden herhaalt) valt hier op. De grens van 2,5 seconden geeft nog ruimte
 * voor een trage CI-run; de gemeten tijd staat in de uitvoer en in de
 * foutmelding.
 */
const LIVE_BUDGET_MS = 2500;

/** Opwarmen van een koude dev-server, geen onderdeel van het gedrag. */
const WARMUP_MS = 20_000;

/** De PresenceBar stuurt elke 5s een hartslag; dit is dat interval uit `PresenceBar`. */
const HEARTBEAT_MS = 5000;

/** De PresenceBar leest elke seconde opnieuw; dit is dat interval uit `PresenceBar`. */
const PRESENCE_POLL_MS = 1000;

/** Meet een live update en geef bij een overschrijding de gemeten tijd mee. */
function expectWithinLiveBudget(label: string, startedAt: number) {
  const elapsed = Date.now() - startedAt;
  expect(elapsed, `${label} duurde ${elapsed}ms, bovengrens is ${LIVE_BUDGET_MS}ms`).toBeLessThan(
    LIVE_BUDGET_MS,
  );
  return elapsed;
}

test("T3: tweede persoon komt binnen via een uitnodigingslink en werkt mee", async ({
  request,
  page,
}) => {
  // Wait for the dev auto-account to be ready by polling the task list action.
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Samenwerking", taskTitle: "E2E Uitnodiging" },
  });
  expect(createResponse.status()).toBe(200);
  const task = await createResponse.json();

  // The beheerder makes an invitation link for the task.
  const inviteResponse = await request.post("/_agent-native/actions/create-invite-link", {
    data: { taskId: task.id },
  });
  expect(inviteResponse.status()).toBe(200);
  const { invite } = await inviteResponse.json();

  // The second person opens the link: a valid link takes them straight into
  // the task, without a choice screen.
  const previewResponse = await request.get(
    `/_agent-native/actions/get-invite-link?token=${encodeURIComponent(invite.token)}`,
  );
  expect(previewResponse.status()).toBe(200);
  const preview = await previewResponse.json();
  expect(preview.state).toBe("geldig");
  expect(preview.melding).toBe("");

  const acceptResponse = await request.post("/_agent-native/actions/accept-invite-link", {
    data: { token: invite.token },
  });
  expect(acceptResponse.status()).toBe(200);
  const accepted = await acceptResponse.json();
  expect(accepted.taskId).toBe(task.id);
  expect(accepted.redirect).toBe(`/tasks/${task.id}`);

  // A revoked link gives a clear message instead of access.
  const secondInviteResponse = await request.post("/_agent-native/actions/create-invite-link", {
    data: { taskId: task.id },
  });
  const { invite: secondInvite } = await secondInviteResponse.json();
  const revokeResponse = await request.post("/_agent-native/actions/revoke-invite-link", {
    data: { inviteId: secondInvite.id },
  });
  expect(revokeResponse.status()).toBe(200);

  const revokedPreview = await (
    await request.get(
      `/_agent-native/actions/get-invite-link?token=${encodeURIComponent(secondInvite.token)}`,
    )
  ).json();
  expect(revokedPreview.state).toBe("ingetrokken");
  expect(revokedPreview.melding).toContain("ingetrokken");

  const revokedAccept = await request.post("/_agent-native/actions/accept-invite-link", {
    data: { token: secondInvite.token },
  });
  expect(revokedAccept.status()).toBe(410);

  // An expired link gives a clear message too.
  const expiredResponse = await request.post("/_agent-native/actions/create-invite-link", {
    data: { taskId: task.id, expiresInHours: 0 },
  });
  const { invite: expiredInvite } = await expiredResponse.json();
  const expiredPreview = await (
    await request.get(
      `/_agent-native/actions/get-invite-link?token=${encodeURIComponent(expiredInvite.token)}`,
    )
  ).json();
  expect(expiredPreview.state).toBe("verlopen");
  expect(expiredPreview.melding).toContain("verlopen");

  // The revoked link shows that message in the UI as well.
  await page.goto(`/uitnodiging/${encodeURIComponent(secondInvite.token)}`);
  await expect(page.getByTestId("uitnodiging-melding")).toContainText("ingetrokken");

  // The second person follows the task and gets meldingen.
  const followResponse = await request.post("/_agent-native/actions/follow-task", {
    data: { taskId: task.id },
  });
  expect(followResponse.status()).toBe(200);
  expect((await followResponse.json()).following).toBe(true);

  // A valid link brings the visitor into the task without a choice screen.
  await page.goto(`/uitnodiging/${encodeURIComponent(invite.token)}`);
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`), { timeout: WARMUP_MS });
  await expect(page.getByRole("heading", { name: "E2E Uitnodiging" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volgen gestopt" })).toBeVisible({
    timeout: WARMUP_MS,
  });

  // Warm up the page: the first load of a route and the first query are slow on
  // a cold dev server, and we want to measure the live updates themselves.
  await expect(page.getByTestId("aanwezig-aantal")).toHaveText("1 persoon aanwezig", {
    timeout: WARMUP_MS,
  });
  // De aanwezigheidspoll loopt elke seconde, maar de eigen hartslag elke vijf
  // seconden. Bij het binnenstappen ruimt het vorige tabblad zijn rij nog op en
  // die kan na de eerste poll binnenkomen; de rij komt dan pas bij de volgende
  // hartslag terug. Wacht daarom een hele hartslag-periode plus een poll, zodat
  // de telling stabiel staat voor de meting. Dit is opwarmen, geen gedrag.
  await page.waitForTimeout(HEARTBEAT_MS + PRESENCE_POLL_MS);
  await expect(page.getByTestId("aanwezig-aantal")).toHaveText("1 persoon aanwezig", {
    timeout: WARMUP_MS,
  });

  // The second person opens the same task. The first person sees that presence
  // within about a second.
  const sindsAanwezig = Date.now();
  await request.post("/_agent-native/actions/set-task-presence", {
    data: { taskId: task.id, clientId: "tweede-persoon" },
  });
  await expect(page.getByTestId("aanwezig-aantal")).toHaveText("2 personen aanwezig", {
    timeout: LIVE_BUDGET_MS,
  });
  const aanwezigMs = expectWithinLiveBudget("aanwezigheid", sindsAanwezig);
  await expect(page.getByTestId("aanwezig-chip")).toHaveText("dev@local.test");

  // The second person changes the werkdocument; the first person sees it live,
  // so both work in the same document.
  const sindsDocument = Date.now();
  await request.post("/_agent-native/actions/update-work-document", {
    data: { taskId: task.id, markdown: "# Eisen\n\n- Snel\n" },
  });
  await expect(page.getByLabel("Werkdocument in markdown")).toHaveValue(/# Eisen/, {
    timeout: LIVE_BUDGET_MS,
  });
  const documentMs = expectWithinLiveBudget("werkdocument", sindsDocument);

  // The first person keeps typing while the second person saves again. The save
  // of the first person is refused, so no work is lost silently.
  await page.getByLabel("Werkdocument in markdown").fill("# Eisen\n\n- Snel\n- Duurzaam\n");
  await request.post("/_agent-native/actions/update-work-document", {
    data: { taskId: task.id, markdown: "# Eisen\n\n- Snel\n- Goedkoop\n" },
  });
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByTestId("conflict-melding")).toContainText(
    "Iemand anders heeft het werkdocument gewijzigd",
  );
  await expect(page.getByLabel("Werkdocument in markdown")).toHaveValue(/- Duurzaam/);

  const documentAfterConflict = await (
    await request.get(
      `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(documentAfterConflict.markdown).toContain("- Goedkoop");
  expect(documentAfterConflict.markdown).not.toContain("- Duurzaam");

  // The first person reloads the werkdocument and continues with the other
  // version, so both contributions end up in the document.
  await page.getByRole("button", { name: "Herladen" }).click();
  await expect(page.getByLabel("Werkdocument in markdown")).toHaveValue(/- Goedkoop/);
  await page
    .getByLabel("Werkdocument in markdown")
    .fill("# Eisen\n\n- Snel\n- Goedkoop\n- Duurzaam\n");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText("Opgeslagen", { exact: true })).toBeVisible();

  const documentAfterMerge = await (
    await request.get(
      `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
    )
  ).json();
  expect(documentAfterMerge.markdown).toContain("- Goedkoop");
  expect(documentAfterMerge.markdown).toContain("- Duurzaam");

  // The second person messages the agent; the message and the melding arrive
  // at the first person within about a second.
  const sindsMelding = Date.now();
  await request.post("/_agent-native/actions/send-task-message", {
    data: { taskId: task.id, message: "Kun je de eisen bekijken?" },
  });
  await expect(page.getByText("Kun je de eisen bekijken?")).toBeVisible({
    timeout: LIVE_BUDGET_MS,
  });
  await expect(page.getByText("Antwoord van de agent in E2E Uitnodiging")).toBeVisible({
    timeout: LIVE_BUDGET_MS,
  });
  const meldingMs = expectWithinLiveBudget("bericht en melding", sindsMelding);
  console.log(
    `live updates: aanwezig ${aanwezigMs}ms, werkdocument ${documentMs}ms, bericht en melding ${meldingMs}ms`,
  );

  // The activity log holds the document changes and both messages.
  const logResponse = await request.get(
    `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
  );
  const { events } = await logResponse.json();
  expect(events.map((event: any) => event.type)).toEqual([
    "document_changed",
    "document_changed",
    "document_changed",
    "message",
    "message",
  ]);

  // The volger got a melding for the answer of the agent.
  const meldingen = await (await request.get("/_agent-native/actions/list-meldingen")).json();
  const voorTaak = meldingen.meldingen.filter(
    (melding: any) => melding.taskId === task.id,
  );
  expect(voorTaak).toHaveLength(1);
  expect(voorTaak[0].body).toBe("Dit is een geautomatiseerd testantwoord van de Ollama-agent.");
  expect(meldingen.ongelezen).toBe(0);
});
