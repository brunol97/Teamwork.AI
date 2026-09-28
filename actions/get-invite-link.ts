import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getInviteLinkPreview } from "../server/collaboration/invites.js";

export default defineAction({
  description:
    "Look up an invitation link (uitnodigingslink) by token and report whether it is geldig, verlopen or ingetrokken, together with the Dutch message the visitor should see. Needs no membership: the token is the only access proof.",
  schema: z.object({
    token: z.string().min(1).describe("Token from the invitation link"),
  }),
  http: { method: "GET" },
  run: async ({ token }) => getInviteLinkPreview(token),
});
