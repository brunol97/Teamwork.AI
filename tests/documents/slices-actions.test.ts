import { describe, expect, it } from "vitest";

import listTracerSlicesAction from "../../actions/list-tracer-slices.js";
import exportTracerSliceAction from "../../actions/export-tracer-slice.js";
import mergeTracerSlicesAction from "../../actions/merge-tracer-slices.js";
import reorderTracerSlicesAction from "../../actions/reorder-tracer-slices.js";
import splitTracerSliceAction from "../../actions/split-tracer-slice.js";
import updateWorkDocumentAction from "../../actions/update-work-document.js";
import { getWorkDocument } from "../../server/documents/store.js";
import { renderSlicesSection, parseSlices } from "../../server/documents/slices.js";
import { createTask, listTaskEvents } from "../../server/tasks/store.js";
import type { TracerSlice } from "../../server/documents/slices.js";

const ctxForOrg = (orgId: string) =>
  ({
    caller: "frontend",
    userEmail: "gebruiker@example.com",
    orgId,
  }) as any;

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: "gebruiker@example.com",
    projectName: "Project",
    taskTitle: "Taak",
  });
}

const SLICE_1: TracerSlice = {
  id: "slice-1",
  order: 1,
  titel: "Inloggen met magic link",
  doel: "Een ingelogde sessie opzetten met een magic link.",
  gedrag: "De gebruiker vult een e-mailadres in en opent de link uit de mail.",
  acceptatiecriteria: [
    "De gebruiker logt in met alleen een e-mailadres.",
    "Een verlopen link wordt geweigerd met een leesbare melding.",
  ],
  requirementRefs: ["Inloggen"],
  buitenDezeSlice: "Het beheer van rollen.",
  afhankelijkheden: [],
  testaanpak: "Unit-tests op de sessie-opbouw en één E2E-test van het inloggen.",
};

const SLICE_2: TracerSlice = {
  id: "slice-2",
  order: 2,
  titel: "Dashboard met taken",
  doel: "Inzicht in de stand van taken.",
  gedrag: "De gebruiker ziet per project het aantal taken per status.",
  acceptatiecriteria: ["Het dashboard toont de stand van taken."],
  requirementRefs: ["Dashboard"],
  buitenDezeSlice: "Filteren op status.",
  afhankelijkheden: ["Inloggen met magic link"],
  testaanpak: "Unit-tests op de status-telling en één E2E-test van het dashboard.",
};

const WERKDOCUMENT = `# Eisen

## Inloggen
De gebruiker logt in met een magic link.

## Dashboard
Het dashboard toont de stand van taken.
`;

async function schrijfWerkdocument(taskId: string, orgId: string, markdown: string) {
  await updateWorkDocumentAction.run({ taskId, markdown }, ctxForOrg(orgId));
}

async function taakMetSlices(orgId: string) {
  const task = await createTaak(orgId);
  await schrijfWerkdocument(
    task.id,
    orgId,
    `${WERKDOCUMENT}\n${renderSlicesSection([SLICE_1, SLICE_2])}`,
  );
  return task;
}

describe("tracer-slice actions", () => {
  it("lijst de slices in de volgorde van het werkdocument", async () => {
    const task = await taakMetSlices("org-slices");

    const result = await listTracerSlicesAction.run(
      { taskId: task.id },
      ctxForOrg("org-slices"),
    );
    expect(result.slices.map((slice: TracerSlice) => slice.titel)).toEqual([
      "Inloggen met magic link",
      "Dashboard met taken",
    ]);
    expect(result.slices[0].acceptatiecriteria).toHaveLength(2);
    expect(result.slices[0].requirementRefs).toEqual(["Inloggen"]);
  });

  it("geeft een lege lijst terug zonder Tracer-slices-sectie", async () => {
    const task = await createTaak("org-slices-leeg");
    const result = await listTracerSlicesAction.run(
      { taskId: task.id },
      ctxForOrg("org-slices-leeg"),
    );
    expect(result.slices).toEqual([]);
  });

  it("bewaart een nieuwe volgorde in het werkdocument", async () => {
    const task = await taakMetSlices("org-slices");

    await reorderTracerSlicesAction.run(
      { taskId: task.id, orderedIds: ["slice-2", "slice-1"] },
      ctxForOrg("org-slices"),
    );

    const document = await getWorkDocument(task.id, "org-slices");
    expect(document?.markdown).toContain("## Tracer-slices");
    expect(parseSlices(document?.markdown ?? "").map((s) => s.titel)).toEqual([
      "Dashboard met taken",
      "Inloggen met magic link",
    ]);

    // De nieuwe volgorde blijft bewaard: een volgende lees geeft hem opnieuw.
    const opnieuw = await listTracerSlicesAction.run(
      { taskId: task.id },
      ctxForOrg("org-slices"),
    );
    expect(opnieuw.slices.map((slice: TracerSlice) => slice.titel)).toEqual([
      "Dashboard met taken",
      "Inloggen met magic link",
    ]);
    expect(opnieuw.slices.map((slice: TracerSlice) => slice.id)).toEqual([
      "slice-1",
      "slice-2",
    ]);
  });

  it("logt een herordening in het activiteitenlog", async () => {
    const task = await taakMetSlices("org-slices-log");
    await reorderTracerSlicesAction.run(
      { taskId: task.id, orderedIds: ["slice-2", "slice-1"] },
      ctxForOrg("org-slices-log"),
    );
    const events = await listTaskEvents(task.id, "org-slices-log");
    expect(events.map((event) => event.type)).toContain("slices_reordered");
  });

  it("voegt een slice samen met de volgende en logt dat", async () => {
    const task = await taakMetSlices("org-slices");

    await mergeTracerSlicesAction.run(
      { taskId: task.id, sliceId: "slice-1" },
      ctxForOrg("org-slices"),
    );

    const result = await listTracerSlicesAction.run(
      { taskId: task.id },
      ctxForOrg("org-slices"),
    );
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].titel).toBe("Inloggen met magic link en Dashboard met taken");
    expect(result.slices[0].requirementRefs).toEqual(["Inloggen", "Dashboard"]);

    const events = await listTaskEvents(task.id, "org-slices");
    expect(events.map((event) => event.type)).toContain("slices_merged");
  });

  it("splitst een slice na een acceptatiecriterium en logt dat", async () => {
    const task = await taakMetSlices("org-slices");

    await splitTracerSliceAction.run(
      { taskId: task.id, sliceId: "slice-1", afterCriteria: 1 },
      ctxForOrg("org-slices"),
    );

    const result = await listTracerSlicesAction.run(
      { taskId: task.id },
      ctxForOrg("org-slices"),
    );
    expect(result.slices).toHaveLength(3);
    expect(result.slices[0].acceptatiecriteria).toHaveLength(1);
    expect(result.slices[1].titel).toContain("Inloggen met magic link");
    expect(result.slices[1].requirementRefs).toEqual(["Inloggen"]);

    const events = await listTaskEvents(task.id, "org-slices");
    expect(events.map((event) => event.type)).toContain("slice_split");
  });

  it("weigert een splitsing zonder grens er tussenin", async () => {
    const task = await taakMetSlices("org-slices-grens");
    await expect(
      splitTracerSliceAction.run(
        { taskId: task.id, sliceId: "slice-1", afterCriteria: 0 },
        ctxForOrg("org-slices-grens"),
      ),
    ).rejects.toThrow();
    await expect(
      splitTracerSliceAction.run(
        { taskId: task.id, sliceId: "slice-1", afterCriteria: 2 },
        ctxForOrg("org-slices-grens"),
      ),
    ).rejects.toThrow();
  });

  it("exporteert een slice als zelfstandig markdown-bestand", async () => {
    const task = await taakMetSlices("org-slices");

    const result = await exportTracerSliceAction.run(
      { taskId: task.id, sliceId: "slice-1" },
      ctxForOrg("org-slices"),
    );

    expect(result.fileName).toBe("slice-1-inloggen-met-magic-link.md");
    expect(result.markdown).toContain("# Slice 1: Inloggen met magic link");
    expect(result.markdown).toContain("Taak");
    expect(result.markdown).toContain("Project");
    // Zelfstandig: de verwezen requirement staat volledig in de export.
    expect(result.markdown).toContain("De gebruiker logt in met een magic link.");
    expect(result.markdown).toContain("## Acceptatiecriteria");
    expect(result.markdown).toContain("## Testaanpak");
  });

  it("weigert een export van een onbekende slice", async () => {
    const task = await taakMetSlices("org-slices-export");
    await expect(
      exportTracerSliceAction.run(
        { taskId: task.id, sliceId: "slice-99" },
        ctxForOrg("org-slices-export"),
      ),
    ).rejects.toThrow();
  });

  it("weigert mutaties zonder Tracer-slices-sectie met een Nederlandse melding", async () => {
    const task = await createTaak("org-slices-geen");
    await expect(
      reorderTracerSlicesAction.run(
        { taskId: task.id, orderedIds: ["slice-1"] },
        ctxForOrg("org-slices-geen"),
      ),
    ).rejects.toThrow("Tracer-slices");
  });

  it("laat een andere organisatie de slices van deze taak niet zien of wijzigen", async () => {
    const task = await taakMetSlices("org-slices");

    const vreemdeCtx = ctxForOrg("org-anders");
    await expect(
      listTracerSlicesAction.run({ taskId: task.id }, vreemdeCtx),
    ).rejects.toThrow("Task not found.");
    await expect(
      reorderTracerSlicesAction.run(
        { taskId: task.id, orderedIds: ["slice-2", "slice-1"] },
        vreemdeCtx,
      ),
    ).rejects.toThrow("Task not found.");
    await expect(
      mergeTracerSlicesAction.run({ taskId: task.id, sliceId: "slice-1" }, vreemdeCtx),
    ).rejects.toThrow("Task not found.");
    await expect(
      splitTracerSliceAction.run(
        { taskId: task.id, sliceId: "slice-1", afterCriteria: 1 },
        vreemdeCtx,
      ),
    ).rejects.toThrow("Task not found.");
    await expect(
      exportTracerSliceAction.run({ taskId: task.id, sliceId: "slice-1" }, vreemdeCtx),
    ).rejects.toThrow("Task not found.");

    // Niets is gewijzigd in de eigen organisatie.
    const result = await listTracerSlicesAction.run(
      { taskId: task.id },
      ctxForOrg("org-slices"),
    );
    expect(result.slices).toHaveLength(2);
  });
});
