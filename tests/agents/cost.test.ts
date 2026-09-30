import { describe, expect, it } from "vitest";

import { addTaskCost, createTask, getTask } from "../../server/tasks/store.js";
import { createMelding, listMeldingen } from "../../server/collaboration/notifications.js";

describe("addTaskCost", () => {
  it("telt de kosten op bij de taak", async () => {
    const task = await createTask({
      orgId: "org-kost",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Kostentelling",
    });

    const eerste = await addTaskCost({ taskId: task.id, orgId: "org-kost", cents: 400 });
    expect(eerste.costUsedCents).toBe(400);
    expect(eerste.gepauzeerd).toBe(false);

    const tweede = await addTaskCost({ taskId: task.id, orgId: "org-kost", cents: 300 });
    expect(tweede.costUsedCents).toBe(700);
    expect(tweede.gepauzeerd).toBe(false);

    const taak = await getTask(task.id, "org-kost");
    expect(taak?.costUsedCents).toBe(700);
    expect(taak?.status).toBe("bezig");
  });

  it("pauzeert de taak bij €10 en geeft die melding aan de lead", async () => {
    const task = await createTask({
      orgId: "org-budget",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Budgetgrens",
    });

    const result = await addTaskCost({
      taskId: task.id,
      orgId: "org-budget",
      cents: 1000,
    });
    expect(result.gepauzeerd).toBe(true);
    expect(result.costUsedCents).toBe(1000);
    expect(result.costLimitCents).toBe(1000);

    const taak = await getTask(task.id, "org-budget");
    expect(taak?.status).toBe("gepauzeerd");
  });

  it("pauzeert maar één keer, ook bij een volgende grensgeval", async () => {
    const task = await createTask({
      orgId: "org-twee",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Twee keer over de grens",
    });

    await addTaskCost({ taskId: task.id, orgId: "org-twee", cents: 1000 });
    const nogEenKeer = await addTaskCost({
      taskId: task.id,
      orgId: "org-twee",
      cents: 500,
    });
    expect(nogEenKeer.gepauzeerd).toBe(false);

    const taak = await getTask(task.id, "org-twee");
    expect(taak?.status).toBe("gepauzeerd");
    expect(taak?.costUsedCents).toBe(1500);
  });

  it("houdt de organisatiegrens aan", async () => {
    const task = await createTask({
      orgId: "org-grens",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Grens",
    });

    await expect(
      addTaskCost({ taskId: task.id, orgId: "org-anders", cents: 100 }),
    ).rejects.toThrow("Task not found.");

    // Er is dus niets opgeteld.
    const taak = await getTask(task.id, "org-grens");
    expect(taak?.costUsedCents).toBe(0);
  });
});

describe("melding aan de lead bij pauze", () => {
  it("is een melding voor de lead, geen antwoord nodig", async () => {
    const task = await createTask({
      orgId: "org-melding",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Melding bij pauze",
    });

    await createMelding({
      taskId: task.id,
      orgId: "org-melding",
      recipientId: task.leadId,
      title: `Taak "${task.title}" is gepauzeerd`,
      body: "Het agentbudget van €10 is bereikt.",
    });

    const meldingen = await listMeldingen("org-melding", "lead@example.com");
    expect(meldingen[0]?.title).toBe(`Taak "${task.title}" is gepauzeerd`);
    expect(meldingen[0]?.body).toContain("€10");
  });
});
