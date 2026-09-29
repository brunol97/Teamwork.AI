import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { readTracerSlices } from "../server/documents/slice-store.js";

export default defineAction({
  description:
    "List the tracer-slices of a task, in the order of the werkdocument. Each slice carries every field of the fixed template: titel, doel, gedrag, acceptatiecriteria, requirements-verwijzingen, buiten deze slice, afhankelijkheden and testaanpak. Only returns tasks belonging to the current organization.",
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

    const read = await readTracerSlices(taskId, orgId);
    if (!read) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return { taskId, slices: read.slices };
  },
});
