import { defineAction, fail } from "@agent-native/core/action";
import { createOrganization, resolveOrgIdForEmail } from "@agent-native/core/org";
import { z } from "zod";

import { getKlant } from "../server/org/klanten.js";
import { createTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Create a new task in the current organization. Creates the project if it does not exist. With klantId the new project is placed under that klant (klanten are optional: without one the project lives directly under the organization). Returns the created task.",
  schema: z.object({
    projectName: z.string().min(1).describe("Name of the project to create"),
    taskTitle: z.string().min(1).describe("Title of the task"),
    klantId: z
      .string()
      .min(1)
      .optional()
      .describe("Id of the klant the project belongs to; optional"),
  }),
  run: async ({ projectName, taskTitle, klantId }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) {
      fail("You must be signed in to create a task.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    let orgId = ctx?.orgId;
    if (!orgId) {
      orgId = await resolveOrgIdForEmail(userEmail);
    }
    if (!orgId) {
      const org = await createOrganization("Mijn organisatie", userEmail, "owner");
      orgId = org.id;
    }

    let customerId: string | null = null;
    if (klantId) {
      // Een klant van een andere organisatie bestaat hier niet; klanten zijn
      // optioneel, dus zonder klantId staat het project direct onder de
      // organisatie.
      const klant = await getKlant(klantId, orgId);
      if (!klant) {
        fail("Klant not found.", { errorCode: "not_found", statusCode: 404 });
      }
      customerId = klant.id;
    }

    const task = await createTask({
      orgId,
      leadId: userEmail,
      projectName,
      taskTitle,
      customerId,
    });

    return task;
  },
});
