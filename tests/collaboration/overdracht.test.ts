import { beforeEach, describe, expect, it } from "vitest";

import getOverdrachtNoteAction from "../../actions/get-overdracht-note.js";
import askHumanTaskAction from "../../actions/ask-human-task.js";
import pauseTaskAction from "../../actions/pause-task.js";
import resumeTaskAction from "../../actions/resume-task.js";
import setTaskAgentAction from "../../actions/set-task-agent.js";
import transferTaskAction from "../../actions/transfer-task.js";
import updateOverdrachtNoteAction from "../../actions/update-overdracht-note.js";
import {
  draftOverdrachtNotitie,
  getOverdrachtNote,
} from "../../server/collaboration/overdracht.js";
import { listMeldingen } from "../../server/collaboration/notifications.js";
import { getTask, listTaskEvents } from "../../server/tasks/store.js";
import { createSamenwerking, ctxVoor } from "../collaboration/samenwerking.js";

describe("de overdrachtsnotitie zelf", () => {
  it("wordt deterministisch opgesteld uit de gegevens van de taak", () => {
    const invoer = {
      taskTitle: "Datamigratie",
      projectName: "Website",
      status: "gepauzeerd",
      leadId: "lead@example.com",
      berichtCount: 4,
      laatsteBericht: "De migratie draait morgen.",
      documentKoppen: ["Eisen", "Datamigratie"],
      openVraag: null as { question: string; askedUserId: string } | null,
      wissel: null as { van: string; aan: string } | null,
    };

    const notitie = draftOverdrachtNotitie(invoer);

    // Dezelfde invoer geeft dezelfde notitie: het opstellen is geen LLM-werk.
    expect(draftOverdrachtNotitie(invoer)).toBe(notitie);
    expect(notitie).toContain("Datamigratie");
    expect(notitie).toContain("Website");
    expect(notitie).toContain("gepauzeerd");
    expect(notitie).toContain("lead@example.com");
    expect(notitie).toContain("4 berichten");
    expect(notitie).toContain("De migratie draait morgen.");
    expect(notitie).toContain("Eisen");
    expect(notitie).toContain("geen open vraag");
  });

  it("noemt de open vraag en de agentwissel wanneer die er zijn", () => {
    const notitie = draftOverdrachtNotitie({
      taskTitle: "Datamigratie",
      projectName: "Website",
      status: "bezig",
      leadId: "lead@example.com",
      berichtCount: 1,
      laatsteBericht: null,
      documentKoppen: [],
      openVraag: { question: "Postgres of MongoDB?", askedUserId: "collega@example.com" },
      wissel: { van: "Ollama (standaard)", aan: "Onderzoeker" },
    });

    expect(notitie).toContain("Postgres of MongoDB?");
    expect(notitie).toContain("collega@example.com");
    expect(notitie).toContain("Ollama (standaard)");
    expect(notitie).toContain("Onderzoeker");
    expect(notitie).toContain("het werkdocument is nog leeg");
  });
});

describe("pauzeren", () => {
  it("zet de taak op gepauzeerd en stelt een aanpasbare notitie op", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    const result = await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    expect(result.status).toBe("gepauzeerd");
    expect((await getTask(task.id, orgId))?.status).toBe("gepauzeerd");
    expect(result.notitie.status).toBe("open");
    expect(result.notitie.content).toContain("Datamigratie");

    // De notitie is leesbaar via de leesactie en staat nog open: aanpasbaar.
    const gelezen = await getOverdrachtNoteAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );
    expect(gelezen.note?.status).toBe("open");

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("task_paused");
  });

  it("mag alleen door de lead", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();

    await expect(
      pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, collega)),
    ).rejects.toMatchObject({ errorCode: "not_the_lead", statusCode: 403 });
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
    expect(await getOverdrachtNote(task.id, orgId)).toBeUndefined();
  });

  it("weigert een tweede pauze", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    await expect(
      pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead)),
    ).rejects.toMatchObject({ errorCode: "already_paused", statusCode: 409 });
    // Er blijft precies één open concept bestaan.
    const events = await listTaskEvents(task.id, orgId);
    expect(events.filter((event) => event.type === "task_paused")).toHaveLength(1);
  });

  it("weigert een pauze van een taak die wacht op iemand", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: lead,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    await expect(
      pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead)),
    ).rejects.toMatchObject({ errorCode: "invalid_status", statusCode: 409 });
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");
  });

  it("houdt de organisatiegrens aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      pauseTaskAction.run({ taskId: task.id }, ctxVoor("org-anders", lead)),
    ).rejects.toThrow("Task not found.");
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });
});

describe("hervatten", () => {
  it("kan door iedereen in de organisatie en zet de taak terug op bezig", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    // Niet de lead, maar de collega hervat: dat is de regel uit de eis.
    const result = await resumeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, collega));

    expect(result.status).toBe("bezig");
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("task_hervat");
  });

  it("laat de notitie als open concept staan na een pauze zonder overdracht", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    await updateOverdrachtNoteAction.run(
      { taskId: task.id, content: "Mijn eigen overdrachtsnotitie." },
      ctxVoor(orgId, lead),
    );

    await resumeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    // Het concept blijft bestaan: bij een latere overdracht is hij er nog.
    const notitie = await getOverdrachtNote(task.id, orgId);
    expect(notitie?.status).toBe("open");
    expect(notitie?.content).toBe("Mijn eigen overdrachtsnotitie.");
  });

  it("weigert hervatten wanneer de taak niet gepauzeerd is", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      resumeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead)),
    ).rejects.toMatchObject({ errorCode: "not_paused", statusCode: 409 });
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");
  });

  it("houdt de organisatiegrens aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    await expect(
      resumeTaskAction.run({ taskId: task.id }, ctxVoor("org-anders", lead)),
    ).rejects.toThrow("Task not found.");
    expect((await getTask(task.id, orgId))?.status).toBe("gepauzeerd");
  });
});

describe("overdragen", () => {
  it("maakt de collega lead, finaliseert de notitie en meldt de nieuwe lead", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    await updateOverdrachtNoteAction.run(
      { taskId: task.id, content: "Draaideegsel: lees eerst de eisen." },
      ctxVoor(orgId, lead),
    );

    const result = await transferTaskAction.run(
      { taskId: task.id, newLeadId: collega },
      ctxVoor(orgId, lead),
    );

    expect(result.newLeadId).toBe(collega);
    expect((await getTask(task.id, orgId))?.leadId).toBe(collega);

    // De nieuwe lead krijgt een melding mét de overdrachtsnotitie.
    const meldingen = await listMeldingen(orgId, collega);
    const overdracht = meldingen.find((melding) =>
      melding.title.includes("overgedragen"),
    );
    expect(overdracht).toBeDefined();
    expect(overdracht?.body).toContain("Draaideegsel: lees eerst de eisen.");

    // De notitie is onveranderlijk in het activiteitenlog terechtgekomen.
    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("overdracht_notitie");
    expect(events.map((event) => event.type)).toContain("task_overgedragen");
    const notitieEvent = events.find(
      (event) => event.type === "overdracht_notitie",
    );
    expect(notitieEvent?.data).toContain("Draaideegsel: lees eerst de eisen.");

    const gelezen = await getOverdrachtNote(task.id, orgId);
    expect(gelezen?.status).toBe("gefinaliseerd");
    expect(gelezen?.finalizedEventId).toBe(notitieEvent?.id);
  });

  it("stelt zelf een notitie op wanneer er nog geen concept was", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();

    const result = await transferTaskAction.run(
      { taskId: task.id, newLeadId: collega },
      ctxVoor(orgId, lead),
    );

    // Overdragen is zelf een overdrachtsmoment: er ontstaat een notitie.
    expect(result.notitie.content).toContain("Datamigratie");
    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("overdracht_notitie");
    const meldingen = await listMeldingen(orgId, collega);
    expect(meldingen.some((melding) => melding.body.includes("Datamigratie"))).toBe(
      true,
    );
  });

  it("mag alleen door de lead", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();

    await expect(
      transferTaskAction.run(
        { taskId: task.id, newLeadId: collega },
        ctxVoor(orgId, collega),
      ),
    ).rejects.toMatchObject({ errorCode: "not_the_lead", statusCode: 403 });
    expect((await getTask(task.id, orgId))?.leadId).toBe(lead);
  });

  it("weigert een collega die geen lid is van de organisatie", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      transferTaskAction.run(
        { taskId: task.id, newLeadId: "buitenstaander@example.com" },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "not_a_member", statusCode: 403 });
    expect((await getTask(task.id, orgId))?.leadId).toBe(lead);
    expect(await getOverdrachtNote(task.id, orgId)).toBeUndefined();
  });

  it("houdt de organisatiegrens aan", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();

    await expect(
      transferTaskAction.run(
        { taskId: task.id, newLeadId: collega },
        ctxVoor("org-anders", lead),
      ),
    ).rejects.toThrow("Task not found.");
    expect((await getTask(task.id, orgId))?.leadId).toBe(lead);
  });
});

describe("de notitie aanpassen", () => {
  it("werkt alleen op het open concept", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    const result = await updateOverdrachtNoteAction.run(
      { taskId: task.id, content: "Aangepaste tekst van de lead." },
      ctxVoor(orgId, lead),
    );
    expect(result.note.content).toBe("Aangepaste tekst van de lead.");
    expect((await getOverdrachtNote(task.id, orgId))?.content).toBe(
      "Aangepaste tekst van de lead.",
    );

    // Na finalisatie is er niets meer aan te passen.
    await transferTaskAction.run(
      { taskId: task.id, newLeadId: lead },
      ctxVoor(orgId, lead),
    );
    await expect(
      updateOverdrachtNoteAction.run(
        { taskId: task.id, content: "Nog een keer." },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "already_finalized", statusCode: 409 });
  });

  it("weigert een lege notitie en een bewerking zonder open concept", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      updateOverdrachtNoteAction.run(
        { taskId: task.id, content: "   " },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "empty_note", statusCode: 400 });

    // Er is nooit gepauzeerd of gewisseld, dus er is geen open concept om
    // aan te passen.
    await expect(
      updateOverdrachtNoteAction.run(
        { taskId: task.id, content: "Er was geen pauze." },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "already_finalized", statusCode: 409 });
  });

  it("mag alleen door de lead", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    await expect(
      updateOverdrachtNoteAction.run(
        { taskId: task.id, content: "Ik was het niet." },
        ctxVoor(orgId, collega),
      ),
    ).rejects.toMatchObject({ errorCode: "not_the_lead", statusCode: 403 });
  });
});

describe("wisselen stelt een overdrachtsnotitie op", () => {
  it("finaliseert de notitie van de agentwissel in het log", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    const result = await setTaskAgentAction.run(
      { taskId: task.id, agentId: null },
      ctxVoor(orgId, lead),
    );
    expect(result.agentName).toBe("Ollama (standaard)");

    const notitie = await getOverdrachtNote(task.id, orgId);
    expect(notitie?.status).toBe("gefinaliseerd");
    expect(notitie?.kind).toBe("wisselen");

    const events = await listTaskEvents(task.id, orgId);
    // De oude agent_changed-melding blijft bestaan naast de notitie.
    expect(events.map((event) => event.type)).toContain("agent_changed");
    expect(events.map((event) => event.type)).toContain("overdracht_notitie");
    const notitieEvent = events.find(
      (event) => event.type === "overdracht_notitie",
    );
    expect(notitieEvent?.data).toContain("Ollama (standaard)");
  });

  it("vervangt een nog open concept door de notitie van de wissel", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    await setTaskAgentAction.run({ taskId: task.id, agentId: null }, ctxVoor(orgId, lead));

    // Er staat hoogstens één open concept per taak; na de wissel is het
    // concept gefinaliseerd en is er niets open meer.
    const notitie = await getOverdrachtNote(task.id, orgId);
    expect(notitie?.status).toBe("gefinaliseerd");
    const events = await listTaskEvents(task.id, orgId);
    expect(
      events.filter((event) => event.type === "overdracht_notitie"),
    ).toHaveLength(1);
  });
});
