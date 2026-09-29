import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  clearTaskPresence,
  listActivePresence,
  PRESENCE_TTL_MS,
  touchTaskPresence,
} from "../../server/collaboration/presence.js";
import { createTask } from "../../server/tasks/store.js";

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Aanwezigheid",
  });
}

describe("aanwezigheid in een taak", () => {
  it("toont beide personen zodra ze een hartslag sturen", async () => {
    const task = await createTaak("org-aanwezigheid");
    const now = Date.now();
    const clientId = randomUUID();
    const clientId2 = randomUUID();

    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });
    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "tweede@example.com",
      clientId: clientId2,
    });

    const participants = await listActivePresence(task.id, "org-aanwezigheid", now);
    expect(participants.map((p) => p.userId).sort()).toEqual([
      "beheerder@example.com",
      "tweede@example.com",
    ]);
  });

  it("telt twee tabbladen van dezelfde persoon als twee deelnemers", async () => {
    const task = await createTaak("org-aanwezigheid");
    const now = Date.now();
    const clientId = randomUUID();
    const clientId2 = randomUUID();

    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });
    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId: clientId2,
    });

    const participants = await listActivePresence(task.id, "org-aanwezigheid", now);
    expect(participants).toHaveLength(2);
  });

  it("vervangt de hartslag van dezelfde client in plaats van te stapelen", async () => {
    const task = await createTaak("org-aanwezigheid");
    const clientId = randomUUID();

    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });
    const later = Date.now() + 1000;
    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });

    const participants = await listActivePresence(task.id, "org-aanwezigheid", later);
    expect(participants).toHaveLength(1);
  });

  it("laat een client verdwijnen zodra de hartslag te oud is", async () => {
    const task = await createTaak("org-aanwezigheid");
    const clientId = randomUUID();
    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });

    const later = Date.now() + PRESENCE_TTL_MS + 1;
    expect(await listActivePresence(task.id, "org-aanwezigheid", later)).toEqual([]);
  });

  it("verdwijnt als de taakpagina sluit", async () => {
    const task = await createTaak("org-aanwezigheid");
    const clientId = randomUUID();
    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });

    await clearTaskPresence(clientId, "org-aanwezigheid");

    expect(await listActivePresence(task.id, "org-aanwezigheid")).toEqual([]);
  });

  it("laat niets zien voor een taak buiten de organisatie", async () => {
    const task = await createTaak("org-aanwezigheid");
    const clientId = randomUUID();
    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });

    expect(await listActivePresence(task.id, "org-andere")).toEqual([]);
  });

  it("laat een client uit een andere organisatie staan", async () => {
    const task = await createTaak("org-aanwezigheid");
    const otherTask = await createTaak("org-andere");
    const clientId = randomUUID();

    await touchTaskPresence({
      taskId: task.id,
      organizationId: "org-aanwezigheid",
      userId: "beheerder@example.com",
      clientId,
    });

    // Een gebruiker uit een andere organisatie mag dezelfde clientId niet
    // kunnen wissen: het clientId alleen is geen bewijs van eigendom.
    await clearTaskPresence(clientId, "org-andere");

    expect((await listActivePresence(task.id, "org-aanwezigheid")).map((p) => p.userId)).toEqual([
      "beheerder@example.com",
    ]);
  });
});
