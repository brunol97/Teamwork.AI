import { defineAction, fail } from "@agent-native/core/action";
import {
  acceptPendingInvitationsForEmail,
  autoJoinDomainMatchingOrgs,
  isOrgMember,
  setActiveOrgId,
} from "@agent-native/core/org";
import { z } from "zod";

import {
  getInviteLinkPreview,
  markInviteAccepted,
} from "../server/collaboration/invites.js";

export default defineAction({
  description:
    "Accept an invitation link (uitnodigingslink). The person becomes a member of the organization and is taken straight into the task, without a choice screen. A verlopen or ingetrokken link returns the Dutch message that the link is no longer valid.",
  schema: z.object({
    token: z.string().min(1).describe("Token from the invitation link"),
  }),
  run: async ({ token }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) {
      fail("You must be signed in to use an invitation link.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const preview = await getInviteLinkPreview(token);
    if (preview.state !== "geldig" || !preview.organizationId) {
      fail(preview.melding, {
        errorCode: preview.state,
        statusCode: 410,
      });
    }

    // Lidschap gaat via het framework zelf: een openstaande uitnodiging op
    // e-mailadres of automatische lidmaatschap op basis van het e-maildomein.
    // De app schrijft nooit zelf rijen in de frameworktabellen.
    await acceptPendingInvitationsForEmail(userEmail);
    await autoJoinDomainMatchingOrgs(userEmail, { activateJoinedOrg: "never" });

    if (!(await isOrgMember(preview.organizationId, userEmail))) {
      fail(
        "Je bent nog geen lid van deze organisatie. Vraag de beheerder om je e-mailadres toe te voegen.",
        { errorCode: "not_a_member", statusCode: 403 },
      );
    }

    // Zonder keuzescherm: de organisatie van de uitnodiging wordt meteen actief.
    await setActiveOrgId(userEmail, preview.organizationId, "uitnodigingslink");
    await markInviteAccepted(token);

    return {
      organizationId: preview.organizationId,
      taskId: preview.taskId,
      redirect: preview.taskId ? `/tasks/${preview.taskId}` : "/tasks",
    };
  },
});
