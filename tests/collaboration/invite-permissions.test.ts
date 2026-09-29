import {
  acceptPendingInvitationsForEmail,
  createOrganization,
  orgInvitations,
} from "@agent-native/core/org";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import createInviteLinkAction from "../../actions/create-invite-link.js";
import listInviteLinksAction from "../../actions/list-invite-links.js";
import revokeInviteLinkAction from "../../actions/revoke-invite-link.js";
import { getDb } from "../../server/db/client.js";
import { createTask } from "../../server/tasks/store.js";

const BEHEERDER = "beheerder@poort.test";
const GEWONE = "gewone@poort.test";

const ctxVoor = (orgId: string, userEmail: string) =>
  ({ caller: "frontend", userEmail, orgId }) as any;

/**
 * `createOrganization` maakt de beheerder eigenaar. GEWONE wordt via de
 * frameworkuitnodiging een gewoon lid, want een niets-doe persoon zou ook om
 * andere redenen geweigerd kunnen worden en dekt de poort dus niet.
 */
async function createOrganisatieMetLeden() {
  const org = await createOrganization(`Poort ${Date.now()}`, BEHEERDER);
  await getDb().insert(orgInvitations).values({
    id: randomUUID(),
    orgId: org.id,
    email: GEWONE,
    invitedBy: BEHEERDER,
    createdAt: Date.now(),
    status: "pending",
    role: "member",
    appRolesJson: null,
  });
  await acceptPendingInvitationsForEmail(GEWONE);
  const task = await createTask({
    orgId: org.id,
    leadId: BEHEERDER,
    projectName: "Project",
    taskTitle: "Uitnodigingslinks",
  });
  return { orgId: org.id, taskId: task.id };
}

describe("alleen een beheerder beheert uitnodigingslinks", () => {
  it("weigert create-invite-link voor iemand die geen beheerder is", async () => {
    const { orgId, taskId } = await createOrganisatieMetLeden();

    await expect(
      createInviteLinkAction.run({ taskId }, ctxVoor(orgId, GEWONE)),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "forbidden",
      statusCode: 403,
    });
  });

  it("weigert list-invite-links voor iemand die geen beheerder is", async () => {
    const { orgId, taskId } = await createOrganisatieMetLeden();

    await expect(
      listInviteLinksAction.run({ taskId }, ctxVoor(orgId, GEWONE)),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "forbidden",
      statusCode: 403,
    });
  });

  it("weigert revoke-invite-link voor iemand die geen beheerder is", async () => {
    const { orgId, taskId } = await createOrganisatieMetLeden();
    const { invite } = await createInviteLinkAction.run(
      { taskId },
      ctxVoor(orgId, BEHEERDER),
    );

    await expect(
      revokeInviteLinkAction.run({ inviteId: invite.id }, ctxVoor(orgId, GEWONE)),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "forbidden",
      statusCode: 403,
    });

    // De link is nog steeds geldig: de geweigerde intrekking verandert niets.
    const { links } = await listInviteLinksAction.run(
      { taskId },
      ctxVoor(orgId, BEHEERDER),
    );
    expect(links.map((link: { state: string }) => link.state)).toEqual(["geldig"]);
  });

  it("laat de beheerder alle drie de acties toe", async () => {
    const { orgId, taskId } = await createOrganisatieMetLeden();
    const ctx = ctxVoor(orgId, BEHEERDER);

    const { invite } = await createInviteLinkAction.run({ taskId }, ctx);
    expect(invite.token).toBeTruthy();

    const { links } = await listInviteLinksAction.run({ taskId }, ctx);
    expect(links).toHaveLength(1);

    const revoked = await revokeInviteLinkAction.run({ inviteId: invite.id }, ctx);
    expect(revoked.invite.status).toBe("revoked");
  });
});
