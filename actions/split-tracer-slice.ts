import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  readTracerSlices,
  writeTracerSlices,
} from "../server/documents/slice-store.js";
import { splitSlice } from "../server/documents/slices.js";
import { WorkDocumentConflictError } from "../server/documents/store.js";

export default defineAction({
  description:
    "Split a tracer-slice of a task in two after the given number of acceptatiecriteria. The first part keeps the titel; the second part becomes a vervolg with the remaining criteria. Only works for tasks belonging to the current organization.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    sliceId: z
      .string()
      .min(1)
      .describe("Id of the slice to split, as listed by list-tracer-slices"),
    afterCriteria: z
      .number()
      .int()
      .min(1)
      .describe("Number of acceptatiecriteria that stay in the first part; must leave at least one criterion for the second part"),
  }),
  run: async ({ taskId, sliceId, afterCriteria }, ctx) => {
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

    const split = splitSlice(read.slices, sliceId, afterCriteria);
    if (!split) {
      fail(
        "Splitsen kan alleen tussen twee acceptatiecriteria: kies een grens die minstens één criterium overlaat voor beide delen.",
        {
          errorCode: "invalid_split",
          statusCode: 400,
        },
      );
    }

    const gesplitsteTitel =
      read.slices.find((slice) => slice.id === sliceId)?.titel ?? null;

    try {
      await writeTracerSlices({
        taskId,
        orgId,
        slices: split,
        actorType: "user",
        actorId: userEmail,
        eventType: "slice_split",
        eventData: gesplitsteTitel,
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

    return { taskId, slices: split };
  },
});
