import { beforeEach, describe, expect, it, vi } from "vitest";

import sendTaskMessageAction from "../../actions/send-task-message.js";
import { getWorkDocument, saveWorkDocument } from "../../server/documents/store.js";
import { parseSlices, renderSlicesSection } from "../../server/documents/slices.js";
import {
  createTask,
  listTaskEvents,
} from "../../server/tasks/store.js";
import { generateOllamaResponse } from "../../server/llm/ollama.js";

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi.fn().mockResolvedValue("Dit is een testantwoord."),
}));

const ctx = {
  caller: "frontend",
  userEmail: "gebruiker@example.com",
  orgId: "org-planner",
} as any;

const WERKDOCUMENT = `# Eisen

## Inloggen
De gebruiker logt in met een magic link.

- De gebruiker logt in met alleen een e-mailadres.
- Een verlopen link wordt geweigerd.

## Dashboard
Het dashboard toont de stand van taken.
`;

async function createTaak() {
  const task = await createTask({
    orgId: "org-planner",
    leadId: "gebruiker@example.com",
    projectName: "Project",
    taskTitle: "Taak",
  });
  return task;
}

describe("slice-planner via send-task-message", () => {
  beforeEach(() => {
    vi.mocked(generateOllamaResponse).mockResolvedValue("Dit is een testantwoord.");
  });

  it("plaatst de Tracer-slices-sectie in het werkdocument wanneer de agent bruikbare slices levert", async () => {
    const task = await createTaak();
    // Het werkdocument wordt door de lead geschreven; hier rechtstreeks gezet
    // via de store om de planner zelf te testen.
    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-planner",
      markdown: WERKDOCUMENT,
      actorType: "user",
      actorId: "gebruiker@example.com",
    });

    const goedeSlices = renderSlicesSection([
      {
        id: "slice-1",
        order: 1,
        titel: "Inloggen met magic link",
        doel: "Een ingelogde sessie opzetten met een magic link.",
        gedrag: "De gebruiker vult een e-mailadres in en opent de link uit de mail.",
        acceptatiecriteria: ["De gebruiker logt in met alleen een e-mailadres."],
        requirementRefs: ["Inloggen"],
        buitenDezeSlice: "Het beheer van rollen.",
        afhankelijkheden: [],
        testaanpak: "Unit-tests op de sessie-opbouw en één E2E-test van het inloggen.",
      },
    ]);
    vi.mocked(generateOllamaResponse).mockResolvedValue(goedeSlices);

    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: "Maak tracer-slices voor dit werkdocument" },
      ctx,
    );

    expect(result.documentSection).toEqual({ title: "Tracer-slices" });

    const document = await getWorkDocument(task.id, "org-planner");
    const slices = parseSlices(document?.markdown ?? "");
    expect(slices).toHaveLength(1);
    expect(slices[0].titel).toBe("Inloggen met magic link");
    expect(slices[0].doel).not.toBe("");
    expect(slices[0].acceptatiecriteria).toHaveLength(1);
    expect(slices[0].requirementRefs).toEqual(["Inloggen"]);

    const events = await listTaskEvents(task.id, "org-planner");
    const sectieEvent = events.find(
      (event) => event.type === "document_section_added" && event.data === "Tracer-slices",
    );
    expect(sectieEvent).toBeDefined();
  });

  it("valt terug op slices uit de requirements wanneer het antwoord van de agent onbruikbaar is", async () => {
    const task = await createTaak();
    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-planner",
      markdown: WERKDOCUMENT,
      actorType: "user",
      actorId: "gebruiker@example.com",
    });

    // Het mock-antwoord bevat geen sjabloon; de planner valt terug op de eisen.
    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: "verdeel het werk in tracer-slices" },
      ctx,
    );

    expect(result.documentSection).toEqual({ title: "Tracer-slices" });

    const document = await getWorkDocument(task.id, "org-planner");
    const slices = parseSlices(document?.markdown ?? "");
    expect(slices.map((slice) => slice.titel)).toEqual(["Inloggen", "Dashboard"]);
    for (const slice of slices) {
      expect(slice.doel).not.toBe("");
      expect(slice.gedrag).not.toBe("");
      expect(slice.acceptatiecriteria.length).toBeGreaterThan(0);
      expect(slice.requirementRefs).toEqual([slice.titel]);
      expect(slice.buitenDezeSlice).not.toBe("");
      expect(slice.afhankelijkheden).toBeDefined();
      expect(slice.testaanpak).not.toBe("");
    }
  });

  it("maakt geen sectie zonder slice-verzoek", async () => {
    const task = await createTaak();
    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: "Hoi agent" },
      ctx,
    );
    expect(result.documentSection).toBeNull();
    const document = await getWorkDocument(task.id, "org-planner");
    expect(document?.markdown).toBe("");
  });

  it("vervangt de bestaande Tracer-slices-sectie bij een nieuw verzoek", async () => {
    const task = await createTaak();
    await saveWorkDocument({
      taskId: task.id,
      orgId: "org-planner",
      markdown: WERKDOCUMENT,
      actorType: "user",
      actorId: "gebruiker@example.com",
    });

    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Maak tracer-slices" },
      ctx,
    );
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Maak tracer-slices opnieuw" },
      ctx,
    );

    const document = await getWorkDocument(task.id, "org-planner");
    expect(document?.markdown.match(/## Tracer-slices/g)).toHaveLength(1);
    const slices = parseSlices(document?.markdown ?? "");
    expect(slices.map((slice) => slice.titel)).toEqual(["Inloggen", "Dashboard"]);
  });
});
