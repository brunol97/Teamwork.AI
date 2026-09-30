import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getAgent } from "../server/agents/store.js";
import {
  buildDraftForTask,
  ensureOpenNote,
  finalizeOverdrachtNote,
} from "../server/collaboration/overdracht.js";
import {
  createTaskEvent,
  getTask,
  setTaskActiveAgent,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Wisselen: replace the actieve agent of a task with another agent of the organization. Without agentId the task falls back to the default agent. The change is logged in the activity log, and the wissel produces an overdrachtsnotitie: a handover note from the old agent to the new one, finalized immutably into the activity log.",
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

    const oudeAgent = await agentNaam(task.activeAgentId, orgId);
    const nieuweAgentNaam = agentName;

    await setTaskActiveAgent(taskId, orgId, agentId ?? null);

    await createTaskEvent(taskId, "user", userEmail, "agent_changed", agentName);

    // Wisselen is een overdrachtsmoment: de notitie van de wissel wordt
    // onveranderlijk in het activiteitenlog opgenomen. Een nog open concept
    // (van een eerdere pauze) wordt vervangen door de notitie van deze wissel.
    const wisselInhoud = await buildDraftForTask({
      taskId,
      orgId,
      wissel: { van: oudeAgent, aan: nieuweAgentNaam },
    });
    await finalizeOverdrachtNote({
      taskId,
      orgId,
      kind: "wisselen",
      createdBy: userEmail,
      van: oudeAgent,
      aan: nieuweAgentNaam,
      content: wisselInhoud ?? undefined,
    });

    return { taskId, agentId: agentId ?? null, agentName };
  },
});

async function agentNaam(
  agentId: string | null,
  orgId: string,
): Promise<string> {
  if (!agentId) {
    return "Ollama (standaard)";
  }
  const agent = await getAgent(agentId, orgId);
  return agent?.name ?? "Ollama (standaard)";
}
