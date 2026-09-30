import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  listDocumentSections,
} from "../server/documents/assignments.js";

export default defineAction({
  description:
    "Read the sections (level-two headings) of the werkdocument of a task, each with the deelnemer it is assigned to (or null). Sections are assigned with assign-document-section; a deelnemer is the lead or anyone who contributed to the task according to the activity log.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
  }),
  http: { method: "GET" },
  run: async ({ taskId }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const sections = await listDocumentSections(taskId, orgId);
    if (!sections) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    return { taskId, sections };
  },
});
