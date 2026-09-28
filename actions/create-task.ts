import { defineAction, fail } from "@agent-native/core/action";
import { createOrganization, resolveOrgIdForEmail } from "@agent-native/core/org";
import { z } from "zod";

import { createTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Create a new task in the current organization. Creates the project if it does not exist. Returns the created task.",
  schema: z.object({
    projectName: z.string().min(1).describe("Name of the project to create"),
    taskTitle: z.string().min(1).describe("Title of the task"),
  }),
  run: async ({ projectName, taskTitle }, ctx) => {
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

    const task = await createTask({
      orgId,
      leadId: userEmail,
      projectName,
      taskTitle,
    });

    return task;
  },
});
