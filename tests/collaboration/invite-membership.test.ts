import { createOrganization, isOrgMember } from "@agent-native/core/org";
import { beforeEach, describe, expect, it } from "vitest";

import acceptInviteLinkAction from "../../actions/accept-invite-link.js";
import createInviteLinkAction from "../../actions/create-invite-link.js";
import revokeInviteLinkAction from "../../actions/revoke-invite-link.js";
import { createTask } from "../../server/tasks/store.js";

const BEHEERDER = "beheerder@uitnodiging.test";
const TWEEDE = "tweede@uitnodiging.test";

const ctxVoor = (orgId: string, userEmail: string) =>
  ({ caller: "frontend", userEmail, orgId }) as any;

let orgId: string;
let taskId: string;

async function createTaakEnOrg() {
  const org = await createOrganization(`Samenwerking ${Date.now()}`, BEHEERDER);
  const task = await createTask({
    orgId: org.id,
    leadId: BEHEERDER,
    projectName: "Project",
    taskTitle: "Samenwerken",
  });
  return { orgId: org.id, taskId: task.id };
}

describe("uitnodigingslink geeft echt lidmaatschap", () => {
  beforeEach(async () => {
    const setup = await createTaakEnOrg();
    orgId = setup.orgId;
    taskId = setup.taskId;
  });

  it("maakt van een onbekende bezoeker een lid van de organisatie", async () => {
    expect(await isOrgMember(orgId, TWEEDE)).toBe(false);

    const { invite } = await createInviteLinkAction.run(
      { taskId, invitedEmail: TWEEDE },
      ctxVoor(orgId, BEHEERDER),
    );

    const accepted = await acceptInviteLinkAction.run(
      { token: invite.token },
      ctxVoor("org-van-een-ander", TWEEDE),
    );

    expect(accepted.organizationId).toBe(orgId);
    expect(accepted.taskId).toBe(taskId);
    expect(accepted.redirect).toBe(`/tasks/${taskId}`);
    expect(await isOrgMember(orgId, TWEEDE)).toBe(true);
  });

  it("geeft 403 not_a_member zonder uitgenodigd e-mailadres", async () => {
    const { invite } = await createInviteLinkAction.run(
      { taskId },
      ctxVoor(orgId, BEHEERDER),
    );

    await expect(
      acceptInviteLinkAction.run({ token: invite.token }, ctxVoor("org-van-een-ander", TWEEDE)),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "not_a_member",
      statusCode: 403,
    });
    expect(await isOrgMember(orgId, TWEEDE)).toBe(false);
  });

  it("geeft geen lidmaatschap voor een ingetrokken link", async () => {
    const { invite } = await createInviteLinkAction.run(
      { taskId, invitedEmail: TWEEDE },
      ctxVoor(orgId, BEHEERDER),
    );
    await revokeInviteLinkAction.run(
      { inviteId: invite.id },
      ctxVoor(orgId, BEHEERDER),
    );

    await expect(
      acceptInviteLinkAction.run({ token: invite.token }, ctxVoor("org-van-een-ander", TWEEDE)),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "ingetrokken",
      statusCode: 410,
    });
    expect(await isOrgMember(orgId, TWEEDE)).toBe(false);
  });

  it("geeft geen lidmaatschap voor een verlopen link", async () => {
    const { invite } = await createInviteLinkAction.run(
      { taskId, invitedEmail: TWEEDE, expiresInHours: 0 },
      ctxVoor(orgId, BEHEERDER),
    );

    await expect(
      acceptInviteLinkAction.run({ token: invite.token }, ctxVoor("org-van-een-ander", TWEEDE)),
    ).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "verlopen",
      statusCode: 410,
    });
    expect(await isOrgMember(orgId, TWEEDE)).toBe(false);
  });
});
