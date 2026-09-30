import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { updateOpenNote } from "../server/collaboration/overdracht.js";
import { getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Edit the open draft overdrachtsnotitie (handover note) of a task. Only the lead may edit the draft, and only while it is open: once the note is finalized (at transfer or at an agent switch) it is immutable in the activity log.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    content: z
      .string()
      .min(1)
      .describe("The new content of the draft overdrachtsnotitie"),
  }),
  run: async ({ taskId, content }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    const task = await getTask(taskId, orgId);
    if (!task) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    if (task.leadId !== userEmail) {
      fail(
        "Alleen de lead kan de overdrachtsnotitie aanpassen.",
        { errorCode: "not_the_lead", statusCode: 403 },
      );
    }

    const tekst = content.trim();
    if (!tekst) {
      fail(
        "De overdrachtsnotitie mag niet leeg zijn.",
        { errorCode: "empty_note", statusCode: 400 },
      );
    }

    const note = await updateOpenNote({ taskId, orgId, content: tekst });
    if (!note) {
      fail(
        "Er is geen open overdrachtsnotitie op deze taak; een gefinaliseerde notitie is onveranderlijk.",
        { errorCode: "already_finalized", statusCode: 409 },
      );
    }

    return { taskId, note };
  },
});
