import { describe, expect, it } from "vitest";

import {
  createTaskInvite,
  getInviteLinkPreview,
  getTaskInviteByToken,
  listTaskInvites,
  markInviteAccepted,
  resolveInviteLinkState,
  revokeTaskInvite,
} from "../../server/collaboration/invites.js";
import { createTask } from "../../server/tasks/store.js";

async function createTaak(orgId: string) {
  return createTask({
    orgId,
    leadId: "beheerder@example.com",
    projectName: "Project",
    taskTitle: "Samenwerken",
  });
}

describe("uitnodigingslink", () => {
  it("maakt een link die geldig is en naar de taak van de organisatie verwijst", async () => {
    const task = await createTaak("org-uitnodiging");
    const invite = await createTaskInvite({
      orgId: "org-uitnodiging",
      taskId: task.id,
      createdBy: "beheerder@example.com",
    });

    expect(invite).toBeDefined();
    expect(invite?.status).toBe("open");
    expect(invite?.expiresAt).toBeGreaterThan(Date.now());

    const preview = await getInviteLinkPreview(invite!.token);
    expect(preview.state).toBe("geldig");
    expect(preview.melding).toBe("");
    expect(preview.taskId).toBe(task.id);
    expect(preview.taskTitle).toBe("Samenwerken");
  });

  it("geeft een duidelijke melding bij een verlopen link", async () => {
    const task = await createTaak("org-uitnodiging");
    const invite = await createTaskInvite({
      orgId: "org-uitnodiging",
      taskId: task.id,
      createdBy: "beheerder@example.com",
      expiresInHours: 0,
    });

    const preview = await getInviteLinkPreview(invite!.token);
    expect(preview.state).toBe("verlopen");
    expect(preview.melding).toBe(
      "Deze uitnodigingslink is verlopen. Vraag de beheerder om een nieuwe link.",
    );
  });

  it("geeft een duidelijke melding bij een ingetrokken link", async () => {
    const task = await createTaak("org-uitnodiging");
    const invite = await createTaskInvite({
      orgId: "org-uitnodiging",
      taskId: task.id,
      createdBy: "beheerder@example.com",
    });

    const revoked = await revokeTaskInvite(invite!.id, "org-uitnodiging");
    expect(revoked?.status).toBe("revoked");

    const preview = await getInviteLinkPreview(invite!.token);
    expect(preview.state).toBe("ingetrokken");
    expect(preview.melding).toBe(
      "Deze uitnodigingslink is ingetrokken. Vraag de beheerder om een nieuwe link.",
    );
  });

  it("geeft een duidelijke melding bij een onbekende link", async () => {
    const preview = await getInviteLinkPreview("bestaat-niet");
    expect(preview.state).toBe("ingetrokken");
    expect(preview.melding).toBe(
      "Deze uitnodigingslink bestaat niet meer of is ingetrokken.",
    );
  });

  it("kan een link alleen binnen de eigen organisatie intrekken", async () => {
    const task = await createTaak("org-uitnodiging");
    const invite = await createTaskInvite({
      orgId: "org-uitnodiging",
      taskId: task.id,
      createdBy: "beheerder@example.com",
    });

    const revoked = await revokeTaskInvite(invite!.id, "org-andere");
    expect(revoked).toBeUndefined();
    const read = await getTaskInviteByToken(invite!.token);
    expect(read?.status).toBe("open");
  });

  it("blijft geldig na gebruik en noteert wanneer hij is gebruikt", async () => {
    const task = await createTaak("org-uitnodiging");
    const invite = await createTaskInvite({
      orgId: "org-uitnodiging",
      taskId: task.id,
      createdBy: "beheerder@example.com",
    });

    await markInviteAccepted(invite!.token);

    const read = await getTaskInviteByToken(invite!.token);
    expect(read?.acceptedAt).toBeGreaterThan(0);
    expect(await getInviteLinkPreview(invite!.token)).toMatchObject({
      state: "geldig",
    });
  });

  it("verbergt de links van een taak buiten de organisatie", async () => {
    const task = await createTaak("org-uitnodiging");
    await createTaskInvite({
      orgId: "org-uitnodiging",
      taskId: task.id,
      createdBy: "beheerder@example.com",
    });

    expect(await listTaskInvites(task.id, "org-andere")).toEqual([]);
    expect(await listTaskInvites(task.id, "org-uitnodiging")).toHaveLength(1);
  });

  it("maakt geen link voor een taak buiten de organisatie", async () => {
    const task = await createTaak("org-uitnodiging");
    const invite = await createTaskInvite({
      orgId: "org-andere",
      taskId: task.id,
      createdBy: "beheerder@example.com",
    });
    expect(invite).toBeUndefined();
  });

  it("berekent de toestand uit status en vervaldatum", () => {
    const now = 1_000_000;
    expect(resolveInviteLinkState({ status: "open", expiresAt: now + 1 }, now)).toBe(
      "geldig",
    );
    expect(resolveInviteLinkState({ status: "open", expiresAt: now }, now)).toBe(
      "verlopen",
    );
    expect(
      resolveInviteLinkState({ status: "revoked", expiresAt: now + 1 }, now),
    ).toBe("ingetrokken");
  });
});
