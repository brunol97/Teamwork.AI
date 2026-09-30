import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { isOrgMemberOf } from "../server/collaboration/membership.js";
import {
  finalizeOverdrachtNote,
} from "../server/collaboration/overdracht.js";
import { createMelding } from "../server/collaboration/notifications.js";
import {
  createTaskEvent,
  getTask,
  setTaskLead,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Transfer a task to a colleague ('overdragen'): the colleague becomes the new lead. The overdrachtsnotitie (handover note) is finalized immutably into the activity log at this moment, and the new lead gets a melding containing the note. The new lead must be a member of the organization — a task cannot be handed to someone who cannot see it. Only the current lead may transfer the task.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    newLeadId: z
      .string()
      .min(1)
      .describe(
        "Email address of the colleague who becomes the new lead; must be a member of the organization",
      ),
  }),
  run: async ({ taskId, newLeadId }, ctx) => {
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
        "Alleen de lead kan de taak overdragen.",
        { errorCode: "not_the_lead", statusCode: 403 },
      );
    }

    // De nieuwe lead moet lid zijn: iemand buiten de organisatie ziet de taak
    // niet en kan er dus niet mee verder.
    const nieuweLead = newLeadId.trim();
    if (!(await isOrgMemberOf(orgId, nieuweLead))) {
      fail(
        `${nieuweLead} is geen lid van deze organisatie. Overdragen kan alleen aan een lid.`,
        { errorCode: "not_a_member", statusCode: 403 },
      );
    }

    // Bij de overdracht wordt de notitie finalisatie: onveranderlijk in het
    // activiteitenlog. Was er nog geen open concept (de taak was niet
    // gepauzeerd), dan wordt er nu automatisch één opgesteld — overdragen is
    // zelf een overdrachtsmoment.
    const gefinaliseerd = await finalizeOverdrachtNote({
      taskId,
      orgId,
      kind: "overdracht",
      createdBy: userEmail,
      van: userEmail,
      aan: nieuweLead,
    });
    if (!gefinaliseerd) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    const gezet = await setTaskLead(taskId, orgId, nieuweLead);
    if (!gezet) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }

    await createTaskEvent(
      taskId,
      "user",
      userEmail,
      "task_overgedragen",
      `De taak is overgedragen van ${userEmail} aan ${nieuweLead}.`,
    );

    // De nieuwe lead krijgt een melding met de overdrachtsnotitie erin.
    await createMelding({
      taskId,
      orgId,
      recipientId: nieuweLead,
      title: `Taak "${task.title}" is overgedragen aan jou`,
      body: `Je bent de nieuwe lead van "${task.title}".\n\n${gefinaliseerd.note.content}`,
    });

    return {
      taskId,
      previousLeadId: userEmail,
      newLeadId: nieuweLead,
      notitie: gefinaliseerd.note,
    };
  },
});
