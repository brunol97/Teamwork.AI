import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  saveWorkDocument,
  WorkDocumentConflictError,
} from "../server/documents/store.js";

export default defineAction({
  description:
    "Replace the markdown of the werkdocument of a task and log the change in the activity log. Use this to correct or rewrite the whole document; use add-work-document-section to append a section. Pass expectedVersion (the version you read) so a concurrent edit by someone else is reported as a conflict instead of being overwritten.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    markdown: z
      .string()
      .describe("The complete new markdown of the werkdocument, headings, lists and tables included"),
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Version the caller read; a mismatch fails with a conflict"),
  }),
  run: async ({ taskId, markdown, expectedVersion }, ctx) => {
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
      expectedVersion,
    }).catch((error) => {
      if (error instanceof WorkDocumentConflictError) {
        fail(error.message, {
          errorCode: "conflict",
          statusCode: 409,
          details: { currentVersion: error.currentVersion },
        });
      }
      throw error;
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
