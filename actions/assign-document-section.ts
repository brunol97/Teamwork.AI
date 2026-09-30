import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  assignDocumentSection,
  NotADeelnemerError,
  UnknownSectionError,
} from "../server/documents/assignments.js";

export default defineAction({
  description:
    "Assign a section of the werkdocument to a deelnemer ('toewijzen'). A deelnemer is the lead or anyone who contributed to the task according to the activity log; assigning to anyone else is refused. The section must exist as a level-two heading in the werkdocument. Re-assigning a section replaces the previous assignment. The assignment does not change the document text, so the version check of the werkdocument keeps working.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    title: z
      .string()
      .min(1)
      .describe("Title of the section in the werkdocument, without a # prefix"),
    assigneeId: z
      .string()
      .min(1)
      .describe(
        "The deelnemer to assign to: the email of a human contributor or the name of an agent",
      ),
  }),
  run: async ({ taskId, title, assigneeId }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    try {
      const result = await assignDocumentSection(
        taskId,
        orgId,
        title,
        assigneeId,
        userEmail,
      );
      if (!result) {
        fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
      }
      return result;
    } catch (error) {
      if (error instanceof UnknownSectionError) {
        fail(error.message, {
          errorCode: "unknown_section",
          statusCode: 400,
        });
      }
      if (error instanceof NotADeelnemerError) {
        fail(error.message, {
          errorCode: "not_a_deelnemer",
          statusCode: 400,
        });
      }
      throw error;
    }
  },
});
