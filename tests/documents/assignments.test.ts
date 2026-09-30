import { describe, expect, it } from "vitest";

import addWorkDocumentSectionAction from "../../actions/add-work-document-section.js";
import assignDocumentSectionAction from "../../actions/assign-document-section.js";
import listDocumentSectionsAction from "../../actions/list-document-sections.js";
import {
  assignDocumentSection,
  NotADeelnemerError,
} from "../../server/documents/assignments.js";
import { parseDocumentSections } from "../../server/documents/markdown.js";
import {
  saveWorkDocument,
  WorkDocumentConflictError,
} from "../../server/documents/store.js";
import {
  createTaskEvent,
  listTaskEvents,
} from "../../server/tasks/store.js";
import { createSamenwerking, ctxVoor } from "../collaboration/samenwerking.js";

describe("documentonderdelen lezen", () => {
  it("leest de secties van het werkdocument zonder toewijzing", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "# Eisen\n\n## Snelheid\n\nDe site moet snel zijn.\n\n## Kosten\n\nBinnen budget.",
      actorType: "user",
      actorId: lead,
    });

    const result = await listDocumentSectionsAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );

    expect(result.sections.map((sectie) => sectie.title)).toEqual([
      "Snelheid",
      "Kosten",
    ]);
    expect(result.sections.every((sectie) => sectie.assigneeId === null)).toBe(
      true,
    );
  });

  it("geeft leeg terug wanneer het werkdocument nog leeg is", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    const result = await listDocumentSectionsAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );
    expect(result.sections).toEqual([]);
  });

  it("houdt de organisatiegrens aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      listDocumentSectionsAction.run({ taskId: task.id }, ctxVoor("org-anders", lead)),
    ).rejects.toThrow("Task not found.");
  });
});

describe("toewijzen aan een deelnemer", () => {
  it("wijst een sectie toe aan de lead en onthoudt de toewijzing", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "## Datamigratie\n\nDe data moet mee.",
      actorType: "user",
      actorId: lead,
    });

    const result = await assignDocumentSectionAction.run(
      { taskId: task.id, title: "Datamigratie", assigneeId: lead },
      ctxVoor(orgId, lead),
    );
    expect(result.assigneeId).toBe(lead);

    const gelezen = await listDocumentSectionsAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );
    expect(gelezen.sections[0]?.assigneeId).toBe(lead);

    // De toewijzing staat in het activiteitenlog.
    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("section_assigned");
  });

  it("wijst opnieuw toe aan een andere deelnemer", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "## Datamigratie\n\nDe data moet mee.",
      actorType: "user",
      actorId: lead,
    });

    await assignDocumentSectionAction.run(
      { taskId: task.id, title: "Datamigratie", assigneeId: lead },
      ctxVoor(orgId, lead),
    );

    // De collega is nog geen deelnemer: hij heeft niets bijgedragen.
    await expect(
      assignDocumentSectionAction.run(
        { taskId: task.id, title: "Datamigratie", assigneeId: collega },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "not_a_deelnemer", statusCode: 400 });

    // De regel zit in de opslaglaag zelf, dus ook direct te zien.
    await expect(
      assignDocumentSection(task.id, orgId, "Datamigratie", collega, lead),
    ).rejects.toBeInstanceOf(NotADeelnemerError);

    // Na een bijdrage in het activiteitenlog is hij wél deelnemer.
    await createTaskEvent(task.id, "user", collega, "message", "Ik kijk ernaar.");
    const result = await assignDocumentSectionAction.run(
      { taskId: task.id, title: "Datamigratie", assigneeId: collega },
      ctxVoor(orgId, lead),
    );
    expect(result.assigneeId).toBe(collega);

    const gelezen = await listDocumentSectionsAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );
    expect(gelezen.sections[0]?.assigneeId).toBe(collega);
  });

  it("weigert een sectie die niet in het werkdocument staat", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      assignDocumentSectionAction.run(
        { taskId: task.id, title: "BestaatNiet", assigneeId: lead },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "unknown_section", statusCode: 400 });
  });

  it("houdt de organisatiegrens aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "## Datamigratie\n\nDe data moet mee.",
      actorType: "user",
      actorId: lead,
    });

    // De opslaglaag vindt de taak niet in de andere organisatie en wijst
    // niets toe.
    await expect(
      assignDocumentSection(task.id, "org-anders", "Datamigratie", lead, lead),
    ).resolves.toBeUndefined();
    expect(
      (
        await listDocumentSectionsAction.run(
          { taskId: task.id },
          ctxVoor(orgId, lead),
        )
      ).sections[0]?.assigneeId,
    ).toBeNull();
  });

  it("raakt de versiebescherming van het werkdocument niet aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    const document = await saveWorkDocument({
      taskId: task.id,
      orgId,
      markdown: "## Datamigratie\n\nDe data moet mee.",
      actorType: "user",
      actorId: lead,
    });
    await assignDocumentSectionAction.run(
      { taskId: task.id, title: "Datamigratie", assigneeId: lead },
      ctxVoor(orgId, lead),
    );

    // Een schrijfactie met een verouderde versie blijft een conflict: de
    // toewijzing heeft de versie van het document niet verplaatst.
    await expect(
      saveWorkDocument({
        taskId: task.id,
        orgId,
        markdown: "## Datamigratie\n\nAnders.",
        actorType: "user",
        actorId: lead,
        expectedVersion: (document?.version ?? 1) - 1,
      }),
    ).rejects.toBeInstanceOf(WorkDocumentConflictError);
  });

  it("vindt secties die de agent later toevoegt", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await addWorkDocumentSectionAction.run(
      { taskId: task.id, title: "Datamigratie", body: "De data moet mee." },
      ctxVoor(orgId, lead),
    );

    const gelezen = await listDocumentSectionsAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );
    expect(gelezen.sections.map((sectie) => sectie.title)).toContain(
      "Datamigratie",
    );
  });
});

describe("secties in markdown lezen", () => {
  it("leest kop-niveau-2-secties met hun tekst", () => {
    const markdown = [
      "# Eisen",
      "",
      "## Snelheid",
      "",
      "De site moet snel zijn.",
      "",
      "### Detail",
      "",
      "Zeker op mobiel.",
      "",
      "## Kosten",
      "",
      "Binnen budget.",
    ].join("\n");

    const secties = parseDocumentSections(markdown);
    expect(secties.map((sectie) => sectie.title)).toEqual([
      "Snelheid",
      "Kosten",
    ]);
    expect(secties[0]?.body).toContain("De site moet snel zijn.");
    // Een kop-niveau-3 hoort bij de tekst van de sectie erboven.
    expect(secties[0]?.body).toContain("Zeker op mobiel.");
  });
});
