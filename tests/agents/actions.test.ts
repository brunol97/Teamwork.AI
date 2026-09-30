import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Elke testwerker hergebruikt zijn eigen PGlite-directory, dus agentnamen uit
 * een eerdere run staan er nog in; namen zijn uniek per organisatie. Elke run
 * krijgt daarom zijn eigen unieke namen.
 */
const perRun = `${Date.now()}-${randomUUID().slice(0, 8)}-`;
const uniek = (naam: string) => `${perRun}${naam}`;

import createAgentAction from "../../actions/create-agent.js";
import deleteAgentAction from "../../actions/delete-agent.js";
import getAgentAction from "../../actions/get-agent.js";
import listAgentsAction from "../../actions/list-agents.js";
import sendTaskMessageAction from "../../actions/send-task-message.js";
import setTaskAgentAction from "../../actions/set-task-agent.js";
import updateAgentAction from "../../actions/update-agent.js";
import { getTask, listTaskEvents } from "../../server/tasks/store.js";
import { createTask } from "../../server/tasks/store.js";

const mockGenerate = vi.fn();

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: (...args: unknown[]) => mockGenerate(...args),
  DEFAULT_OLLAMA_MODEL: "gpt-oss:120b",
}));

const LEAD = {
  caller: "frontend",
  userEmail: "lead@example.com",
  orgId: "org-actions",
} as any;

const ANDER = {
  caller: "frontend",
  userEmail: "ander@example.com",
  orgId: "org-anders",
} as any;

async function maakAgent(fields: Partial<Parameters<typeof createAgentAction.run>[0]> = {}) {
  const result = await createAgentAction.run(
    {
      name: uniek("Onderzoeker"),
      description: "Verzamelt informatie.",
      tools: [],
      skills: [],
      ...fields,
    } as any,
    LEAD,
  );
  return result.agent;
}

describe("agent actions", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue("Dit is een testantwoord.");
  });

  it("maakt een agent vanuit een sjabloon en leeg", async () => {
    // Zonder eigen tools gelden de tools van het sjabloon.
    const uitSjabloon = await maakAgent({
      name: uniek("Reviewer"),
      template: "reviewer",
    });
    expect(uitSjabloon.tools).toEqual(["werkdocument-lezen"]);
    expect(uitSjabloon.template).toBe("reviewer");

    const leeg = await maakAgent({ name: uniek("Leeg") });
    expect(leeg.tools).toEqual([]);
    expect(leeg.template).toBe("leeg");

    await expect(
      createAgentAction.run({ name: uniek("Reviewer") } as any, LEAD),
    ).rejects.toThrow("Er bestaat al een agent met deze naam");
    await expect(
      createAgentAction.run({ name: uniek("Onbekend"), template: "geen-sjabloon" } as any, LEAD),
    ).rejects.toThrow("Onbekend sjabloon");
  });

  it("lijst en lees houden de organisatiegrens aan", async () => {
    const agent = await maakAgent({ name: uniek("AlleenOns") });

    const lijst = await listAgentsAction.run({}, LEAD);
    expect(lijst.agents.some((a: any) => a.id === agent.id)).toBe(true);

    expect((await getAgentAction.run({ id: agent.id }, LEAD)).agent.id).toBe(
      agent.id,
    );
    await expect(getAgentAction.run({ id: agent.id }, ANDER)).rejects.toThrow(
      "Agent not found.",
    );
    // De lijst van een andere organisatie bevat deze agent niet.
    const andereLijst = await listAgentsAction.run({}, ANDER);
    expect(andereLijst.agents.some((a: any) => a.id === agent.id)).toBe(false);
  });

  it("schakelt een agent uit en verwijdert hem", async () => {
    const agent = await maakAgent({ name: uniek("Tijdelijk") });

    const uit = await updateAgentAction.run(
      { id: agent.id, enabled: false },
      LEAD,
    );
    expect(uit.agent.enabled).toBe(false);

    // Een uitgeschakelde agent kan geen berichten meer ontvangen.
    const task = await createTask({
      orgId: "org-actions",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Uitgeschakelde agent",
    });
    await expect(
      sendTaskMessageAction.run(
        { taskId: task.id, message: "Hoi", agentId: agent.id } as any,
        LEAD,
      ),
    ).rejects.toThrow("uitgeschakeld");

    expect(
      (await deleteAgentAction.run({ id: agent.id }, LEAD)).deleted,
    ).toBe(true);
    await expect(
      deleteAgentAction.run({ id: agent.id }, LEAD),
    ).rejects.toThrow("Agent not found.");
  });

  it("wisselt de actieve agent van een taak en logt dat", async () => {
    const agent = await maakAgent({ name: uniek("Wisselaar") });
    const task = await createTask({
      orgId: "org-actions",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Wisselen",
    });

    const result = await setTaskAgentAction.run(
      { taskId: task.id, agentId: agent.id },
      LEAD,
    );
    expect(result.agentName?.endsWith("Wisselaar")).toBe(true);

    const taak = await getTask(task.id, "org-actions");
    expect(taak?.activeAgentId).toBe(agent.id);

    const events = await listTaskEvents(task.id, "org-actions");
    expect(events.map((event) => event.type)).toContain("agent_changed");
    expect(
      events.find((event) => event.type === "agent_changed")?.data?.endsWith(
        "Wisselaar",
      ),
    ).toBe(true);

    // De actieve agent van een andere organisatie kan niet gewisseld worden.
    await expect(
      setTaskAgentAction.run({ taskId: task.id, agentId: agent.id }, ANDER),
    ).rejects.toThrow("Task not found.");
  });
});

describe("send-task-message met eigen agents", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue("Dit is een testantwoord.");
  });

  it("laat de genoemde agent antwoorden via @naam", async () => {
    const agent = await maakAgent({ name: uniek("Onderzoeker"), tools: ["web-zoeken"] });
    const task = await createTask({
      orgId: "org-actions",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Aanroepen",
    });

    // De aanroep gebeurt met de volledige naam van de agent.
    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: `@${agent.name} wat weet je?` } as any,
      LEAD,
    );

    expect(result.agentName?.endsWith("Onderzoeker")).toBe(true);
    const system = mockGenerate.mock.calls[0][0] as string;
    expect(system).toContain("Onderzoeker");
    expect(system).toContain("web-zoeken");

    const events = await listTaskEvents(task.id, "org-actions");
    const antwoord = events.filter((event) => event.type === "message")[1];
    expect(antwoord.actorId?.endsWith("Onderzoeker")).toBe(true);
  });

  it("gebruikt de actieve agent van de taak zonder @naam", async () => {
    const agent = await maakAgent({ name: uniek("Schrijver") });
    const task = await createTask({
      orgId: "org-actions",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Actieve agent",
    });
    await setTaskAgentAction.run({ taskId: task.id, agentId: agent.id }, LEAD);

    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: "Schrijf verder." } as any,
      LEAD,
    );
    expect(result.agentName?.endsWith("Schrijver")).toBe(true);
  });

  it("weigert een derde delegatieniveau en meldt dat duidelijk", async () => {
    await maakAgent({ name: uniek("tweede") });
    await maakAgent({ name: uniek("derde") });
    const task = await createTask({
      orgId: "org-actions",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Diepte",
    });

    const eerste = await maakAgent({ name: uniek("eerste") });
    mockGenerate
      .mockResolvedValueOnce(`UITBESTEED AAN @${uniek("tweede")}: doe de deeltaak`)
      .mockResolvedValueOnce(`UITBESTEED AAN @${uniek("derde")}: nog dieper`);

    const result = await sendTaskMessageAction.run(
      { taskId: task.id, message: `@${eerste.name} ga aan het werk` } as any,
      LEAD,
    );

    expect(result.agentMessage).toContain(
      "delegatiediepte is maximaal 2",
    );
    const events = await listTaskEvents(task.id, "org-actions");
    expect(events.map((event) => event.type)).toContain("delegation_refused");
    expect(events.map((event) => event.type)).toContain("agent_delegated");
  });

  it("telt de agentkosten op de taak en pauzeert bij €10", async () => {
    const { addTaskCost } = await import("../../server/tasks/store.js");
    const task = await createTask({
      orgId: "org-actions",
      leadId: "lead@example.com",
      projectName: "Project",
      taskTitle: "Budget in het gesprek",
    });

    // Elke beurt telt zijn geschatte kosten op de taak op.
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "bericht 1" } as any,
      LEAD,
    );
    const naEenBeurt = await getTask(task.id, "org-actions");
    expect(naEenBeurt?.costUsedCents).toBeGreaterThan(0);
    expect(naEenBeurt?.status).toBe("bezig");

    // Zet de telling vlak onder de grens; de volgende beurt steekt er overheen.
    await addTaskCost({
      taskId: task.id,
      orgId: "org-actions",
      cents: 999 - naEenBeurt!.costUsedCents,
    });

    const laatste = await sendTaskMessageAction.run(
      { taskId: task.id, message: "de laatste beurt" } as any,
      LEAD,
    );
    expect(laatste.gepauzeerd).toBe(true);

    const taak = await getTask(task.id, "org-actions");
    expect(taak?.status).toBe("gepauzeerd");
    expect(taak?.costUsedCents).toBeGreaterThanOrEqual(1000);

    // De lead heeft een melding gekregen en de taak is gelogd.
    const events = await listTaskEvents(task.id, "org-actions");
    expect(events.map((event) => event.type)).toContain("budget_gepauzeerd");

    // Een gepauzeerde taak neemt geen nieuwe berichten aan.
    await expect(
      sendTaskMessageAction.run(
        { taskId: task.id, message: "hoi" } as any,
        LEAD,
      ),
    ).rejects.toThrow("gepauzeerd");
  });
});
