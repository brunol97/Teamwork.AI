import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  readTracerSlices,
  writeTracerSlices,
} from "../server/documents/slice-store.js";
import { reorderSlices } from "../server/documents/slices.js";
import { WorkDocumentConflictError } from "../server/documents/store.js";

export default defineAction({
  description:
    "Reorder the tracer-slices of a task. Pass the slice ids in the wanted order; the Tracer-slices section of the werkdocument is rewritten in that order, so the new order is persisted and survives a restart. Only works for tasks belonging to the current organization.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    orderedIds: z
      .array(z.string().min(1))
      .min(1)
      .describe("The slice ids in the wanted order, exactly the ids from list-tracer-slices"),
  }),
  run: async ({ taskId, orderedIds }, ctx) => {
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

    const currentIds = read.slices.map((slice) => slice.id).sort();
    const wantedIds = [...orderedIds].sort();
    if (
      currentIds.length !== wantedIds.length ||
      currentIds.some((id, index) => id !== wantedIds[index])
    ) {
      fail("De opgegeven volgorde past niet bij de huidige slices. Haal eerst een nieuwe lijst op.", {
        errorCode: "invalid_order",
        statusCode: 400,
      });
    }

    const reordered = reorderSlices(read.slices, orderedIds);
    try {
      await writeTracerSlices({
        taskId,
        orgId,
        slices: reordered,
        actorType: "user",
        actorId: userEmail,
        eventType: "slices_reordered",
        eventData: reordered.map((slice) => slice.titel).join(" → "),
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

    return { taskId, slices: reordered };
  },
});
