import { defineAction } from "@agent-native/core/action";
import {
  createOrganization,
  resolveOrgIdForEmail,
} from "@agent-native/core/org";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getDb } from "../server/db/client.js";
import { projects, tasks } from "../server/db/schema.js";

export default defineAction({
  description: "Create a new task in an organization, creating a project if needed.",
  schema: z.object({
    projectName: z.string().min(1).describe("Name of the project to create or use"),
    taskTitle: z.string().min(1).describe("Title of the task"),
  }),
  run: async ({ projectName, taskTitle }, ctx) => {
    const userEmail = ctx?.userEmail ?? "dev@local.test";
    let orgId = ctx?.orgId ?? (await resolveOrgIdForEmail(userEmail));
    if (!orgId) {
      const org = await createOrganization("Agent Office", userEmail, "admin");
      orgId = org.id;
    }
    if (!orgId) {
      throw new Error("No organization context available");
    }

    const now = Date.now();
    const db = getDb();

    const projectId = randomUUID();
    try {
      await db.insert(projects).values({
        id: projectId,
        organizationId: orgId,
        name: projectName,
        archived: 0,
        createdAt: now,
        updatedAt: now,
      });

      const taskId = randomUUID();
      await db.insert(tasks).values({
        id: taskId,
        projectId,
        title: taskTitle,
        status: "bezig",
        leadId: ctx?.userEmail ?? "dev@local.test",
        costLimitCents: 1000,
        costUsedCents: 0,
        createdAt: now,
        updatedAt: now,
      });

      return { taskId, projectId, orgId };
    } catch (error) {
      console.error("Failed to create task:", error);
      throw error;
    }
  },
});
