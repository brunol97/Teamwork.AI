import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { parseMention, runAgentTurn } from "../server/agents/runner.js";
import { listAgents, type AgentConfig } from "../server/agents/store.js";
import { getActiveSkillsForAgent } from "../server/skills/store.js";
import { parseSectionRequest } from "../server/documents/markdown.js";
import {
  addWorkDocumentSection,
  getWorkDocument,
  WorkDocumentConflictError,
} from "../server/documents/store.js";
import {
  extractRequirements,
  parsePlannedSlices,
  parseSliceRequest,
  planSlicesFromRequirements,
} from "../server/documents/slices.js";
import { writeTracerSlices } from "../server/documents/slice-store.js";
import { createMelding, notifyTaskFollowers } from "../server/collaboration/notifications.js";
import { getOverdrachtNote } from "../server/collaboration/overdracht.js";
import { generateOllamaResponse } from "../server/llm/ollama.js";
import {
  addTaskCost,
  createTaskEvent,
  getTask,
  listTaskEvents,
  TASK_STATUS_PAUSED,
} from "../server/tasks/store.js";

export default defineAction({
  description:
    "Send a message in a task and let the actieve agent respond. The agent is chosen in this order: the explicit agentId, an @naam mention in the message, the actieve agent of the task, otherwise the default agent. An agent can uitbesteden to another agent of the organization (delegatiediepte maximaal 2) and only ever runs with its own tools. Both messages are recorded in the activity log, and every volger of the task gets a melding. The agent always gets the full context of the task: the complete conversation plus the overdrachtsnotitie, so after a pauze or overdracht it knows what was agreed. When the user asks for a section ('schrijf een sectie over X'), the agent's answer is also added to the werkdocument of the task as a new section. When the user asks for tracer-slices ('maak tracer-slices'), the slice planner answers with slices in the fixed template and adds them as a Tracer-slices section to the werkdocument, referencing only requirements that exist in the document. Agent costs are added to the task; at €10 the task pauses and the lead gets a melding.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
    message: z.string().min(1).describe("Message to send to the agent"),
    agentId: z
      .string()
      .optional()
      .describe(
        "Agent that answers this message; leave out to use the @naam mention, the actieve agent of the task, or the default agent",
      ),
  }),
  run: async ({ taskId, message, agentId }, ctx) => {
    const userEmail = ctx?.userEmail;
    const orgId = ctx?.orgId;
    if (!userEmail || !orgId) {
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

    if (task.status === TASK_STATUS_PAUSED) {
      fail(
        "De taak is gepauzeerd omdat het agentbudget van €10 is bereikt. De lead heeft een melding gekregen.",
        {
          errorCode: "task_gepauzeerd",
          statusCode: 409,
        },
      );
    }

    await createTaskEvent(taskId, "user", userEmail, "message", message);

    // Bepaal wie er spreekt: de expliciet gevraagde agent, de @naam-aanroep in
    // het bericht, de actieve agent van de taak, of de standaardagent.
    const orgAgents = await listAgents(orgId);
    let agent: AgentConfig | null = null;

    if (agentId) {
      const gevraagd = orgAgents.find((candidate) => candidate.id === agentId);
      if (!gevraagd) {
        fail("Agent not found.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      }
      if (!gevraagd.enabled) {
        fail(
          `De agent "${gevraagd.name}" is uitgeschakeld en kan geen berichten ontvangen.`,
          {
            errorCode: "agent_disabled",
            statusCode: 409,
          },
        );
      }
      agent = gevraagd;
    }
    if (!agent) {
      agent = parseMention(message, orgAgents);
    }
    if (!agent && task.activeAgentId) {
      const actief = orgAgents.find(
        (candidate) => candidate.id === task.activeAgentId && candidate.enabled,
      );
      if (actief) {
        agent = actief;
      }
    }

    const history = await listTaskEvents(taskId, orgId);
    const messages = history
      .filter((event) => event.type === "message" && event.data)
      .map((event) => ({
        role:
          event.actorType === "agent" ? ("assistant" as const) : ("user" as const),
        content: event.data ?? "",
      }));

    // De overdrachtsnotitie hoort bij de context van de agent: na een pauze
    // of overdracht weet de agent zo wat er is afgesproken, zonder dat iemand
    // het opnieuw hoeft te typen. Bestaat er geen notitie, dan verandert er
    // niets aan de prompt.
    const notitie = await getOverdrachtNote(taskId, orgId);

    const turn = await runAgentTurn({
      taskTitle: task.title,
      agents: orgAgents,
      agent,
      messages,
      overdrachtNotitie: notitie?.content ?? null,
      generate: generateOllamaResponse,
      // De actieve versie van elke skill wordt nu gelezen, zodat een agent
      // na een goedgekeurd voorstel meteen de nieuwe versie gebruikt.
      resolveSkills: (sprekende) =>
        getActiveSkillsForAgent(orgId, sprekende.skills),
    });

    // Een geweigerde uitbesteding hoort bij het antwoord in het gesprek, zodat
    // de aanroeper de duidelijke melding ook zonder het activiteitenlog ziet.
    const reply = turn.refusal ? `${turn.reply}\n\n${turn.refusal}` : turn.reply;

    await createTaskEvent(taskId, "agent", agent?.name ?? "ollama", "message", reply);

    if (turn.delegation?.ok) {
      await createTaskEvent(
        taskId,
        "system",
        agent?.name ?? "ollama",
        "agent_delegated",
        `@${turn.delegation.name}`,
      );
    }
    if (turn.refusal) {
      await createTaskEvent(
        taskId,
        "system",
        agent?.name ?? "ollama",
        "delegation_refused",
        turn.refusal,
      );
    }

    // Volgers van de taak krijgen een melding; die vraagt geen antwoord.
    await notifyTaskFollowers({
      taskId,
      orgId,
      title: `Antwoord van de agent in ${task.title}`,
      body: reply,
    });

    // De agentkosten komen op de taak; bij de grens van €10 pauzeert de taak
    // en krijgt de lead een melding.
    const kosten = await addTaskCost({ taskId, orgId, cents: turn.costCents });
    let gepauzeerd = false;
    if (kosten.gepauzeerd) {
      gepauzeerd = true;
      const melding = `De taak "${task.title}" is gepauzeerd omdat het agentbudget van €10 is bereikt.`;
      await createMelding({
        taskId,
        orgId,
        recipientId: task.leadId,
        title: `Taak "${task.title}" is gepauzeerd`,
        body: melding,
      });
      await createTaskEvent(taskId, "system", "agent", "budget_gepauzeerd", melding);
    }

    const sliceRequest = parseSliceRequest(message);
    const sectionRequest = sliceRequest ? null : parseSectionRequest(message);
    let documentSection: { title: string } | null = null;

    if (sliceRequest) {
      documentSection = await planTracerSlices({
        taskId,
        orgId,
        response: reply,
      }).catch((error) => {
        if (error instanceof WorkDocumentConflictError) {
          fail(error.message, {
            errorCode: "conflict",
            statusCode: 409,
            details: { currentVersion: error.currentVersion },
          });
        }
        throw error;
      });
    } else if (sectionRequest) {
      // De agent schrijft zijn sectie zonder versie mee te geven en probeert
      // het opnieuw bij een conflict. Lukt het na die pogingen niet, dan is dat
      // geen 500 maar een conflict: het antwoord van de agent staat al in de
      // activity log en blijft daar staan.
      try {
        await addWorkDocumentSection({
          taskId,
          orgId,
          title: sectionRequest.title,
          body: reply,
          actorType: "agent",
          actorId: agent?.name ?? "ollama",
        });
        documentSection = { title: sectionRequest.title };
      } catch (error) {
        if (!(error instanceof WorkDocumentConflictError)) {
          throw error;
        }
        fail(error.message, {
          errorCode: "conflict",
          statusCode: 409,
          details: { currentVersion: error.currentVersion },
        });
      }
    }

    return {
      taskId,
      userMessage: message,
      agentMessage: reply,
      agentName: agent?.name ?? null,
      documentSection,
      gepauzeerd,
    };
  },
});

/**
 * De slice-planner: zet het antwoord van de agent om naar tracer-slices in het
 * vaste sjabloon en plaatst ze als Tracer-slices-sectie in het werkdocument.
 * Slices die een veld missen of naar een onbekende requirement verwijzen,
 * vallen af; levert dat geen enkele bruikbare slice op, dan valt de planner
 * terug op één slice per requirement uit het werkdocument, zodat er altijd
 * een bruikbare planning ontstaat uit de eisen die er staan.
 */
async function planTracerSlices({
  taskId,
  orgId,
  response,
}: {
  taskId: string;
  orgId: string;
  response: string;
}): Promise<{ title: string } | null> {
  const document = await getWorkDocument(taskId, orgId);
  if (!document) {
    return null;
  }

  const requirementTitles = extractRequirements(document.markdown).map(
    (requirement) => requirement.title,
  );
  const planned = parsePlannedSlices(response, requirementTitles);
  const slices = planned.length > 0 ? planned : planSlicesFromRequirements(document.markdown);
  if (slices.length === 0) {
    return null;
  }

  await writeTracerSlices({
    taskId,
    orgId,
    slices,
    actorType: "agent",
    actorId: "ollama",
    eventType: "document_section_added",
    eventData: "Tracer-slices",
  });

  return { title: "Tracer-slices" };
}
