import { beforeEach, describe, expect, it, vi } from "vitest";

import completeTaskAction from "../../actions/complete-task.js";
import createSkillAction from "../../actions/create-skill.js";
import decideSkillProposalAction from "../../actions/decide-skill-proposal.js";
import listEvaluationsAction from "../../actions/list-evaluations.js";
import listHumanTasksAction from "../../actions/list-human-tasks.js";
import sendTaskMessageAction from "../../actions/send-task-message.js";
import setTaskAgentAction from "../../actions/set-task-agent.js";
import askHumanTaskAction from "../../actions/ask-human-task.js";
import { createAgent } from "../../server/agents/store.js";
import {
  getSkill,
  getActiveSkillsForAgent,
} from "../../server/skills/store.js";
import { listEvaluations } from "../../server/skills/evaluations.js";
import { getTask, listTaskEvents } from "../../server/tasks/store.js";
import { createSamenwerking, ctxVoor } from "../collaboration/samenwerking.js";

const mockGenerate = vi.fn();

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: (...args: unknown[]) => mockGenerate(...args),
  DEFAULT_OLLAMA_MODEL: "gpt-oss:120b",
}));

const V1 = `# Notuleren

Houd notulen bij van elke besluitvorming.
`;
const V2 = `# Notuleren

Houd notulen bij van elke besluitvorming.
Sluit af met een checklist van open punten.
`;

const ANTWOORD_MET_VOORSTEL = `De taak liep goed; de notulen waren op tijd. De skill kan een afsluitchecklist krijgen.

SKILL-VOORSTEL: Notuleren
UITLEG: Een afsluitchecklist voorkomt dat open punten verloren gaan.
INHOUD:
${V2}EINDE VOORSTEL
`;

describe("taak afronden levert altijd een evaluatie op", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue(ANTWOORD_MET_VOORSTEL);
  });

  it("maakt bij het afronden een evaluatie en zet de taak op klaar", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    const result = await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    expect(result.evaluation?.fallback).toBe(false);
    expect(result.evaluation?.content).toContain("De taak liep goed");
    expect(result.taskStatus).toBe("klaar");
    expect((await getTask(task.id, orgId))?.status).toBe("klaar");

    // De evaluatie is een eigen bron van de taak, leesbaar via de lijst.
    const lijst = await listEvaluationsAction.run(
      { taskId: task.id },
      ctxVoor(orgId, lead),
    );
    expect(lijst.evaluations).toHaveLength(1);
    expect(lijst.evaluations[0]?.content).toContain("De taak liep goed");

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("task_completed");
    expect(events.map((event) => event.type)).toContain("evaluation_added");
  });

  it("maakt ook een evaluatie wanneer de agent geen bruikbaar antwoord geeft", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    // De LLM-call mislukt, bijvoorbeeld omdat Ollama niet bereikbaar is.
    mockGenerate.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const result = await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    // De invariant: afronden levert óók dan een evaluatie op.
    expect(result.evaluation?.fallback).toBe(true);
    expect(result.evaluation?.content).toContain("geen evaluatie");
    expect((await listEvaluations(orgId, task.id)).length).toBe(1);
    expect((await getTask(task.id, orgId))?.status).toBe("klaar");

    const events = await listTaskEvents(task.id, orgId);
    expect(events.map((event) => event.type)).toContain("evaluation_added");
  });

  it("maakt een terugval-evaluatie wanneer het antwoord leeg is", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    mockGenerate.mockResolvedValueOnce("   ");

    const result = await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    expect(result.evaluation?.fallback).toBe(true);
    expect((await listEvaluations(orgId, task.id)).length).toBe(1);
  });

  it("weigert een tweede afronding", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    await expect(
      completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead)),
    ).rejects.toMatchObject({ errorCode: "already_completed", statusCode: 409 });
    expect((await listEvaluations(orgId, task.id)).length).toBe(1);
  });

  it("weigert afronden zolang er een open vraag op de taak staat", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: lead,
        question: "Welke database kiezen we?",
        reason: "De migratie moet het weten.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    await expect(
      completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead)),
    ).rejects.toMatchObject({ errorCode: "question_already_open", statusCode: 409 });
    expect((await getTask(task.id, orgId))?.status).toBe("wacht op iemand");
    expect(await listEvaluations(orgId, task.id)).toEqual([]);
  });

  it("houdt de organisatiegrens aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    await expect(
      completeTaskAction.run({ taskId: task.id }, ctxVoor("org-anders", lead)),
    ).rejects.toThrow("Task not found.");
    expect(await listEvaluations("org-anders", task.id)).toEqual([]);
  });
});

describe("skill-voorstellen uit de evaluatie", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue(ANTWOORD_MET_VOORSTEL);
  });

  it("zet een voorstel in het antwoord om naar een rij voor de eigenaar", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();
    const { skill } = await createSkillAction.run(
      { name: "Notuleren", content: V1 },
      ctxVoor(orgId, lead),
    );

    const result = await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    expect(result.proposals).toHaveLength(1);
    const voorstel = result.proposals[0]!;
    expect(voorstel.skillId).toBe(skill.id);
    expect(voorstel.baseVersion).toBe(1);
    expect(voorstel.uitleg).toContain("afsluitchecklist");
    expect(voorstel.diff).toContain("+ Sluit af met een checklist van open punten.");
    expect(voorstel.status).toBe("open");

    // Het voorstel verschijnt in "Wacht op jou" van de eigenaar.
    const wacht = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    expect(wacht.skillProposals).toHaveLength(1);
    expect(wacht.skillProposals[0]?.skillName).toBe("Notuleren");
    expect(wacht.skillProposals[0]?.uitleg).toContain("afsluitchecklist");

    // Een ander lid ziet het voorstel niet in zijn eigen lijst.
    const ander = await listHumanTasksAction.run({}, ctxVoor(orgId, collega));
    expect(ander.skillProposals).toEqual([]);
  });

  it("laat een voorstel voor een onbekende skill vallen", async () => {
    const { orgId, lead, task } = await createSamenwerking();

    mockGenerate.mockResolvedValueOnce(`SKILL-VOORSTEL: BestaatNiet
UITLEG: Deze skill bestaat niet.
INHOUD:
# BestaatNiet
EINDE VOORSTEL
`);

    const result = await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    expect(result.proposals).toEqual([]);
  });

  it("gebruikt na goedkeuring de nieuwe versie en bewaart de oude", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    const { skill } = await createSkillAction.run(
      { name: "Notuleren", content: V1 },
      ctxVoor(orgId, lead),
    );
    const agent = await createAgent({
      orgId,
      name: "Notuleerder",
      skills: ["Notuleren"],
      createdBy: lead,
    });
    await setTaskAgentAction.run({ taskId: task.id, agentId: agent.id }, ctxVoor(orgId, lead));

    // Vóór goedkeuring gebruikt de agent de actieve versie 1.
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Maak notulen." },
      ctxVoor(orgId, lead),
    );
    let system = mockGenerate.mock.calls.at(-1)?.[0] as string;
    expect(system).toContain("Houd notulen bij van elke besluitvorming.");
    expect(system).not.toContain("checklist van open punten");

    await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    const wacht = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    const voorstel = wacht.skillProposals[0]!;

    const beslist = await decideSkillProposalAction.run(
      { id: voorstel.id, besluit: "goedkeuren" },
      ctxVoor(orgId, lead),
    );
    expect(beslist.proposal.status).toBe("goedgekeurd");
    expect(beslist.skill.currentVersion).toBe(2);

    // De oude versie blijft bewaard en leesbaar.
    const gelezen = await getSkill(skill.id, orgId);
    expect(gelezen?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(gelezen?.versions[0]?.content).toBe(V1);

    // En de agent gebruikt voortaan de nieuwe versie.
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Maak notulen." },
      ctxVoor(orgId, lead),
    );
    system = mockGenerate.mock.calls.at(-1)?.[0] as string;
    expect(system).toContain("checklist van open punten");

    const actief = await getActiveSkillsForAgent(orgId, ["Notuleren"]);
    expect(actief[0]?.version).toBe(2);
  });

  it("laat de eigenaar het voorstel eerst aanpassen en keurt de aanpassing goed", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await createSkillAction.run({ name: "Notuleren", content: V1 }, ctxVoor(orgId, lead));

    await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    const wacht = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    const voorstel = wacht.skillProposals[0]!;

    const GEWIJZIGD = `${V2}Vink na afloop de opslag van de notulen na.
`;
    const beslist = await decideSkillProposalAction.run(
      { id: voorstel.id, besluit: "goedkeuren", content: GEWIJZIGD },
      ctxVoor(orgId, lead),
    );

    expect(beslist.proposal.status).toBe("goedgekeurd");
    expect(beslist.proposal.decidedContent).toBe(GEWIJZIGD);
    const actief = await getActiveSkillsForAgent(orgId, ["Notuleren"]);
    expect(actief[0]?.version).toBe(2);
    expect(actief[0]?.content).toContain("Vink na afloop de opslag");
  });

  it("laat een afwijzing de actieve versie staan", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await createSkillAction.run({ name: "Notuleren", content: V1 }, ctxVoor(orgId, lead));

    await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    const wacht = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    const voorstel = wacht.skillProposals[0]!;

    const beslist = await decideSkillProposalAction.run(
      { id: voorstel.id, besluit: "afwijzen" },
      ctxVoor(orgId, lead),
    );
    expect(beslist.proposal.status).toBe("afgewezen");
    expect(beslist.skill.currentVersion).toBe(1);
    expect((await getActiveSkillsForAgent(orgId, ["Notuleren"]))[0]?.content).toBe(V1);

    // Een afgewezen voorstel verdwijnt uit "Wacht op jou".
    const daarna = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    expect(daarna.skillProposals).toEqual([]);
  });

  it("laat alleen de eigenaar beslissen", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();
    await createSkillAction.run({ name: "Notuleren", content: V1 }, ctxVoor(orgId, lead));

    await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    const wacht = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    const voorstel = wacht.skillProposals[0]!;

    await expect(
      decideSkillProposalAction.run(
        { id: voorstel.id, besluit: "goedkeuren" },
        ctxVoor(orgId, collega),
      ),
    ).rejects.toMatchObject({ errorCode: "not_the_owner", statusCode: 403 });

    // Ook een lid van een andere organisatie kan niets beslissen.
    await expect(
      decideSkillProposalAction.run(
        { id: voorstel.id, besluit: "goedkeuren" },
        ctxVoor("org-anders", collega),
      ),
    ).rejects.toThrow("Voorstel niet gevonden.");
  });

  it("weigert een onzinbesluit", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await createSkillAction.run({ name: "Notuleren", content: V1 }, ctxVoor(orgId, lead));

    await completeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    const wacht = await listHumanTasksAction.run({}, ctxVoor(orgId, lead));
    const voorstel = wacht.skillProposals[0]!;

    // Het schema weigert elk ander besluit dan goedkeuren of afwijzen.
    await expect(
      decideSkillProposalAction.run(
        { id: voorstel.id, besluit: "misschien" },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toThrow("Invalid action parameters");
  });
});
