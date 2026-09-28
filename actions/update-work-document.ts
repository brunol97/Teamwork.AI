import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { saveWorkDocument } from "../server/documents/store.js";

export default defineAction({
  description:
    "Replace the markdown of the werkdocument of a task and log the change in the activity log. Use this to correct or rewrite the whole document; use add-work-document-section to append a section.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    markdown: z
      .string()
      .describe("The complete new markdown of the werkdocument, headings, lists and tables included"),
  }),
  run: async ({ taskId, markdown }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const document = await saveWorkDocument({
      taskId,
      orgId,
      markdown,
      actorType: "user",
      actorId: userEmail,
    });
    if (!document) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return document;
  },
});
