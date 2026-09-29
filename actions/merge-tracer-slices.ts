import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  readTracerSlices,
  writeTracerSlices,
} from "../server/documents/slice-store.js";
import { mergeSliceWithNext } from "../server/documents/slices.js";
import { WorkDocumentConflictError } from "../server/documents/store.js";

export default defineAction({
  description:
    "Merge a tracer-slice of a task with the slice after it: the fields of the fixed template are combined into one slice. Only works for tasks belonging to the current organization.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    sliceId: z
      .string()
      .min(1)
      .describe("Id of the slice to merge with the next one, as listed by list-tracer-slices"),
  }),
  run: async ({ taskId, sliceId }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const read = await readTracerSlices(taskId, orgId);
    if (!read) {
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }
    if (read.slices.length === 0) {
      fail("Deze taak heeft nog geen Tracer-slices. Vraag de agent om tracer-slices te maken.", {
        errorCode: "geen_slices",
        statusCode: 400,
      });
    }

    const merged = mergeSliceWithNext(read.slices, sliceId);
    if (!merged) {
      fail("De laatste slice heeft geen volgende slice om mee samen te voegen.", {
        errorCode: "invalid_merge",
        statusCode: 400,
      });
    }

    try {
      await writeTracerSlices({
        taskId,
        orgId,
        slices: merged,
        actorType: "user",
        actorId: userEmail,
        eventType: "slices_merged",
        eventData: merged.find((slice) => slice.id === sliceId)?.titel ?? null,
      });
    } catch (error) {
      if (error instanceof WorkDocumentConflictError) {
        fail(error.message, {
          errorCode: "conflict",
          statusCode: 409,
          details: { currentVersion: error.currentVersion },
        });
      }
      throw error;
    }

    return { taskId, slices: merged };
  },
});
