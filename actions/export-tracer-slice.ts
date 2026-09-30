import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { readTracerSlices } from "../server/documents/slice-store.js";
import { renderSliceExport, sliceFileName } from "../server/documents/slices.js";
import { getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Export one tracer-slice of a task as a self-contained markdown file. The export names the task and project, carries every field of the fixed template and includes the full text of the referenced requirements, so a coding agent can pick it up without the app. Only works for tasks belonging to the current organization.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    sliceId: z.string().min(1).describe("Id of the slice, as listed by list-tracer-slices"),
  }),
  http: { method: "GET" },
  run: async ({ taskId, sliceId }, ctx) => {
    const orgId = ctx?.orgId;
    if (!orgId) {
      fail("No organization context available.", {
        errorCode: "missing_org",
        statusCode: 400,
      });
    }

    const [read, task] = await Promise.all([
      readTracerSlices(taskId, orgId),
      getTask(taskId, orgId),
    ]);
    if (!read || !task) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    const slice = read.slices.find((candidate) => candidate.id === sliceId);
    if (!slice) {
      fail("Slice niet gevonden.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    return {
      taskId,
      sliceId,
      fileName: sliceFileName(slice),
      markdown: renderSliceExport(slice, {
        taskTitle: task.title,
        projectName: task.projectName,
        requirements: read.requirements,
      }),
    };
  },
});
