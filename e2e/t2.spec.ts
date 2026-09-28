import { expect, test } from "@playwright/test";

// De dev-server rendert de eerste pagina koud; geef de test daarom extra tijd.
test.setTimeout(120_000);

test("T2: werkdocument met koppen, opsomming, tabel en een agentsectie", async ({
  request,
  page,
}) => {
  // Wait for the dev auto-account to be ready by polling the task list action.
  await expect(async () => {
    const response = await request.get("/_agent-native/actions/list-tasks");
    expect(response.status()).toBe(200);
  }).toPass({ timeout: 15000 });

  const createResponse = await request.post("/_agent-native/actions/create-task", {
    data: { projectName: "E2E Document", taskTitle: "E2E Werkdocument" },
  });
  expect(createResponse.status()).toBe(200);
  const task = await createResponse.json();

  // A new task has an empty werkdocument, retrievable as markdown.
  const emptyResponse = await request.get(
    `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
  );
  expect(emptyResponse.status()).toBe(200);
  const emptyDocument = await emptyResponse.json();
  expect(emptyDocument.markdown).toBe("");

  // The user writes headings, a list and a table in the werkdocument.
  const markdown = "# Eisen\n\n- Snel\n- Duurzaam\n\n| Veld | Waarde |\n| --- | --- |\n| Sprint | 2 |\n";
  const saveResponse = await request.post(
    "/_agent-native/actions/update-work-document",
    {
      data: { taskId: task.id, markdown },
    },
  );
  expect(saveResponse.status()).toBe(200);

  const documentResponse = await request.get(
    `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
  );
  const document = await documentResponse.json();
  expect(document.markdown).toBe(markdown);

  // Asking for a section adds that section to the document and logs it.
  const messageResponse = await request.post(
    "/_agent-native/actions/send-task-message",
    {
      data: { taskId: task.id, message: "Schrijf een sectie over datamigratie" },
    },
  );
  expect(messageResponse.status()).toBe(200);
  const messageResult = await messageResponse.json();
  expect(messageResult.documentSection).toEqual({ title: "Datamigratie" });

  const afterAgentResponse = await request.get(
    `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
  );
  const afterAgent = await afterAgentResponse.json();
  expect(afterAgent.markdown).toBe(
    `${markdown}\n## Datamigratie\n\nDit is een geautomatiseerd testantwoord van de Ollama-agent.\n`,
  );

  const logResponse = await request.get(
    `/_agent-native/actions/get-task?id=${encodeURIComponent(task.id)}`,
  );
  const { events } = await logResponse.json();
  expect(events.map((event: any) => event.type)).toEqual([
    "document_changed",
    "message",
    "message",
    "document_section_added",
  ]);
  expect(events[3].data).toBe("Datamigratie");

  // The user edits the same document in the UI.
  await page.goto(`/tasks/${encodeURIComponent(task.id)}`);
  const editor = page.getByLabel("Werkdocument in markdown");
  await expect(editor).toHaveValue(/## Datamigratie/);
  await page.getByRole("button", { name: "Tabel" }).click();
  await expect(editor).toHaveValue(/\| Kop 1 \| Kop 2 \|/);
  await expect(page.getByText("Niet opgeslagen")).toBeVisible();
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText("Niet opgeslagen")).toBeHidden();

  const uiSaveResponse = await request.get(
    `/_agent-native/actions/get-work-document?taskId=${encodeURIComponent(task.id)}`,
  );
  const uiDocument = await uiSaveResponse.json();
  expect(uiDocument.markdown).toContain("| Kop 1 | Kop 2 |");
  expect(uiDocument.markdown).toContain("## Datamigratie");
});
