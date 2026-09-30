import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listEvaluations } from "../server/skills/evaluations.js";

export default defineAction({
  description:
    "List evaluations ('Evaluatie') recorded by the agent when tasks were completed, newest first. Without a taskId, lists the evaluations of the whole organization; with a taskId, only those of that task. Every completion has exactly one evaluation, even when the agent gave no usable answer (that one is marked as fallback).",
  schema: z.object({
    taskId: z
      .string()
      .optional()
      .describe("Limit the list to the evaluations of one task"),
  }),
  http: { method: "GET" },
  run: async ({ taskId }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      return { evaluations: [] };
    }

    return { evaluations: await listEvaluations(orgId, taskId) };
  },
});
