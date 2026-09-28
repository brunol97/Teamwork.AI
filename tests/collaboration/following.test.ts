import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import sendTaskMessageAction from "../../actions/send-task-message.js";
import {
  followTask,
  isFollowingTask,
  listTaskFollowers,
  unfollowTask,
} from "../../server/collaboration/following.js";
import {
  countUnreadMeldingen,
  listMeldingen,
  markMeldingenRead,
} from "../../server/collaboration/notifications.js";
import { createTask } from "../../server/tasks/store.js";

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: vi.fn().mockResolvedValue("Het is goed, ik kijk ernaar."),
}));

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Volgen",
  });
}

describe("taak volgen en meldingen", () => {
  it("volgt een taak en telt de volger", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    expect(await isFollowingTask(task.id, orgId, "tweede@example.com")).toBe(
      false,
    );
    expect(
      await followTask({
        taskId: task.id,
        orgId,
        userId: "tweede@example.com",
      }),
    ).toBe(true);
    expect(await isFollowingTask(task.id, orgId, "tweede@example.com")).toBe(
      true,
    );
    expect(await listTaskFollowers(task.id, orgId)).toEqual([
      "tweede@example.com",
    ]);
  });

  it("volgt maar eenmaals en stopt weer met volgen", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    await followTask({ taskId: task.id, orgId, userId: "tweede@example.com" });
    await followTask({ taskId: task.id, orgId, userId: "tweede@example.com" });
    expect(await listTaskFollowers(task.id, orgId)).toHaveLength(1);

    await unfollowTask({ taskId: task.id, orgId, userId: "tweede@example.com" });
    expect(await listTaskFollowers(task.id, orgId)).toEqual([]);
  });

  it("kan een taak buiten de organisatie niet volgen", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    expect(
      await followTask({ taskId: task.id, orgId: "org-andere", userId: "tweede@example.com" }),
    ).toBe(false);
    expect(await listTaskFollowers(task.id, "org-andere")).toEqual([]);
  });

  it("geeft een melding aan de volger wanneer de agent antwoordt", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await followTask({ taskId: task.id, orgId, userId: "tweede@example.com" });

    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Hoi agent" },
      {
        caller: "frontend",
        userEmail: "beheerder@example.com",
        orgId,
      } as any,
    );

    const meldingen = await listMeldingen(orgId, "tweede@example.com");
    expect(meldingen).toHaveLength(1);
    expect(meldingen[0].title).toBe("Antwoord van de agent in Volgen");
    expect(meldingen[0].body).toBe("Het is goed, ik kijk ernaar.");
    expect(meldingen[0].readAt).toBeNull();
    expect(await countUnreadMeldingen(orgId, "tweede@example.com")).toBe(1);
  });

  it("geeft geen melding aan iemand die de taak niet volgt", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);

    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Hoi agent" },
      {
        caller: "frontend",
        userEmail: "beheerder@example.com",
        orgId,
      } as any,
    );

    expect(await listMeldingen(orgId, "derde@example.com")).toEqual([]);
  });

  it("markeert de meldingen van de aanroeper als gelezen", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await followTask({ taskId: task.id, orgId, userId: "tweede@example.com" });
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Hoi agent" },
      {
        caller: "frontend",
        userEmail: "beheerder@example.com",
        orgId,
      } as any,
    );

    expect(await markMeldingenRead({ orgId, recipientId: "tweede@example.com" })).toBe(1);
    expect(await countUnreadMeldingen(orgId, "tweede@example.com")).toBe(0);
  });

  it("laat de meldingen van een andere organisatie onzichtbaar", async () => {
    const orgId = randomUUID();
    const task = await createTaak(orgId);
    await followTask({ taskId: task.id, orgId, userId: "tweede@example.com" });
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Hoi agent" },
      {
        caller: "frontend",
        userEmail: "beheerder@example.com",
        orgId,
      } as any,
    );

    expect(await listMeldingen("org-andere", "tweede@example.com")).toEqual([]);
  });
});
