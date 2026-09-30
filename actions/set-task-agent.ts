import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getAgent } from "../server/agents/store.js";
import {
  createTaskEvent,
  getTask,
  setTaskActiveAgent,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Wisselen: replace the actieve agent of a task with another agent of the organization. Without agentId the task falls back to the default agent. The change is logged in the activity log.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    agentId: z
      .string()
      .nullish()
      .describe("Agent id of the new actieve agent; leave out for the default agent"),
  }),
  run: async ({ taskId, agentId }, ctx) => {
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
      fail("Task not found.", {
        errorCode: "not_found",
        statusCode: 404,
      });
    }

    let agentName = "Ollama (standaard)";
    if (agentId) {
      const agent = await getAgent(agentId, orgId);
      if (!agent) {
        fail("Agent not found.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      agentName = agent.name;
    }

    await setTaskActiveAgent(taskId, orgId, agentId ?? null);

    await createTaskEvent(taskId, "user", userEmail, "agent_changed", agentName);

    return { taskId, agentId: agentId ?? null, agentName };
  },
});
