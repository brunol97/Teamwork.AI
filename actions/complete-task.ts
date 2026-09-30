import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { parseMention, runAgentTurn } from "../server/agents/runner.js";
import { listAgents, type AgentConfig } from "../server/agents/store.js";
import {
  listHumanTasksForTask,
} from "../server/collaboration/human-tasks.js";
import { generateOllamaResponse } from "../server/llm/ollama.js";
import {
  extractEvaluation,
  createSkillProposalsFromReply,
} from "../server/skills/proposals.js";
import {
  recordEvaluation,
  TERUGVAL_EVALUATIE,
} from "../server/skills/evaluations.js";
import { getActiveSkillsForAgent } from "../server/skills/store.js";
import {
  addTaskCost,
  createTaskEvent,
  getTask,
  listTaskEvents,
  setTaskStatus,
} from "../server/tasks/store.js";

/** De status van een afgeronde taak. */
export const TASK_STATUS_KLAAR = "klaar";

/** De opdracht waarmee de agent bij het afronden de evaluatie schrijft. */
export const EVALUATIE_INSTRUCTIE =
  "De taak is afgerond. Schrijf nu de evaluatie van deze taak: wat ging goed, wat kon beter, en welke skills verbeterd kunnen worden.\n\n" +
  "Wil je een skill wijzigen, doe dat dan per skill in dit vaste formaat:\n\n" +
  "SKILL-VOORSTEL: <naam van de skill>\n" +
  "UITLEG: <waarom deze wijziging de skill beter maakt>\n" +
  "INHOUD:\n" +
  "<de volledige nieuwe inhoud van de SKILL.md>\n" +
  "EINDE VOORSTEL\n\n" +
  "De eigenaar van de skill keurt je voorstel goed, past het aan of wijst het af.";

export default defineAction({
  description:
    "Complete a task ('afronden'). Completing always produces an evaluation: the agent of the task writes a retrospective aimed at improving skills, and the evaluation is recorded as a resource of the task even when the agent gives no usable answer (a fallback evaluation is recorded instead). Skill changes proposed by the agent in the fixed SKILL-VOORSTEL format become proposals for the owner of that skill; they appear in the owner's 'Wacht op jou' list, who can goedkeuren, aanpassen or afwijzen them. The task status becomes 'klaar'. Completing is refused while a question ('human task') is still open, and a task can be completed only once.",
  schema: z.object({
    taskId: z.string().min(1).describe("Task id"),
  }),
  run: async ({ taskId }, ctx) => {
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

    if (task.status === TASK_STATUS_KLAAR) {
      fail(
        "Deze taak is al afgerond en heeft al een evaluatie.",
        { errorCode: "already_completed", statusCode: 409 },
      );
    }

    // Een open vraag wacht op een antwoord; afronden zou de vraag stranded
    // laten. Hef de vraag eerst op (cancel-human-task) of beantwoord hem.
    const openVraag = (await listHumanTasksForTask(taskId, orgId)).find(
      (vraag) => vraag.status === "open",
    );
    if (openVraag) {
      fail(
        "De taak wacht nog op een antwoord. Beantwoord de vraag of hef hem op voordat je de taak afrondt.",
        { errorCode: "question_already_open", statusCode: 409 },
      );
    }

    // De status verandert vóór de evaluatie, zodat de afronding niet tweemaal
    // kan lopen; de evaluatie wordt sowieso altijd weggeschreven.
    const gezet = await setTaskStatus(taskId, orgId, TASK_STATUS_KLAAR);
    if (!gezet) {
      fail("Task not found.", { errorCode: "not_found", statusCode: 404 });
    }
    await createTaskEvent(
      taskId,
      "user",
      userEmail,
      "task_completed",
      `Taak afgerond door ${userEmail}`,
    );

    // De evaluatie is agentgedrag: dezelfde agent-chat als een gewoon bericht,
    // met het gesprek van de taak erbij en de evaluatie-opdracht als slot.
    const orgAgents = await listAgents(orgId);
    let agent: AgentConfig | null =
      orgAgents.find(
        (candidate) =>
          task.activeAgentId &&
          candidate.id === task.activeAgentId &&
          candidate.enabled,
      ) ?? null;
    if (!agent) {
      const events = await listTaskEvents(taskId, orgId);
      const laatsteBericht = [...events]
        .reverse()
        .find((event) => event.type === "message");
      const genoemd = laatsteBericht?.data
        ? parseMention(laatsteBericht.data, orgAgents)
        : null;
      agent = genoemd;
    }

    const history = await listTaskEvents(taskId, orgId);
    const messages = [
      ...history
        .filter((event) => event.type === "message" && event.data)
        .map((event) => ({
          role:
            event.actorType === "agent"
              ? ("assistant" as const)
              : ("user" as const),
          content: event.data ?? "",
        })),
      { role: "user" as const, content: EVALUATIE_INSTRUCTIE },
    ];

    // De invariant: afronden levert áltijd een evaluatie op. Mislukt de
    // LLM-aanroep of geeft de agent geen bruikbare tekst, dan staat er een
    // terugval-evaluatie in en slaagt de afronding alsnog.
    let antwoord: string | null = null;
    try {
      const turn = await runAgentTurn({
        taskTitle: task.title,
        agents: orgAgents,
        agent,
        messages,
        generate: generateOllamaResponse,
        resolveSkills: (sprekende) =>
          getActiveSkillsForAgent(orgId, sprekende.skills),
      });
      antwoord = turn.reply;
      await addTaskCost({ taskId, orgId, cents: turn.costCents });
    } catch {
      antwoord = null;
    }

    const bruikbareTekst = antwoord ? extractEvaluation(antwoord) : "";
    const evaluatie = bruikbareTekst
      ? await recordEvaluation({
          taskId,
          orgId,
          agentName: agent?.name ?? "ollama",
          content: bruikbareTekst,
          fallback: false,
        })
      : await recordEvaluation({
          taskId,
          orgId,
          agentName: "systeem",
          content: TERUGVAL_EVALUATIE,
          fallback: true,
        });

    await createTaskEvent(
      taskId,
      "system",
      evaluatie.fallback ? "systeem" : (agent?.name ?? "ollama"),
      "evaluation_added",
      evaluatie.fallback
        ? "Terugval-evaluatie: de agent gaf geen bruikbaar antwoord."
        : "Evaluatie geschreven door de agent.",
    );

    // Voorstellen uit het antwoord gaan naar de eigenaar van elke genoemde
    // skill; de diff tegen de actieve versie wordt nu berekend en bewaard.
    const proposals = antwoord
      ? await createSkillProposalsFromReply({
          orgId,
          reply: antwoord,
          proposedBy: agent?.name ?? "ollama",
        })
      : [];
    for (const proposal of proposals) {
      await createTaskEvent(
        taskId,
        "system",
        agent?.name ?? "ollama",
        "skill_proposal_created",
        `Skill-voorstel voor de skill met id ${proposal.skillId} (voorstel ${proposal.id}).`,
      );
    }

    return {
      taskId,
      taskStatus: TASK_STATUS_KLAAR,
      evaluation: evaluatie,
      proposals,
    };
  },
});
