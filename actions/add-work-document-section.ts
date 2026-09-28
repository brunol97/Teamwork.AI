import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { addWorkDocumentSection } from "../server/documents/store.js";

export default defineAction({
  description:
    "Add a section to the werkdocument of a task and log it in the activity log. The section is appended as a level two heading with the body underneath.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    title: z.string().min(1).describe("Title of the new section, without a # prefix"),
    body: z
      .string()
      .min(1)
      .describe("Markdown body of the new section: text, lists or a table"),
  }),
  run: async ({ taskId, title, body }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const document = await addWorkDocumentSection({
      taskId,
      orgId,
      title,
      body,
      actorType: "agent",
      actorId: "agent",
    });
    if (!document) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return { taskId, sectionTitle: title, markdown: document.markdown };
  },
});
