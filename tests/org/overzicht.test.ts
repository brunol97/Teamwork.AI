import { beforeEach, describe, expect, it, vi } from "vitest";

import completeTaskAction from "../../actions/complete-task.js";
import {
  answerHumanTask,
  createHumanTask,
  listOpenHumanTasks,
} from "../../server/collaboration/human-tasks.js";
import { archiveKlant, createKlant } from "../../server/org/klanten.js";
import {
  createTaak,
  createSamenwerking,
  ctxVoor,
  type Samenwerking,
} from "../collaboration/samenwerking.js";
import { getOverzicht } from "../../server/tasks/overzicht.js";
import { createTask, setTaskStatus } from "../../server/tasks/store.js";

const mockGenerate = vi.fn();

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: (...args: unknown[]) => mockGenerate(...args),
  DEFAULT_OLLAMA_MODEL: "gpt-oss:120b",
}));

/**
 * AC2: het overzicht toont per project het aantal taken per status, en "Wacht
 * op mij" filtert correct. De tellingen lopen over de vier bestaande
 * statussen; "wacht op mij" betekent: er staat een open vraag van de agent aan
 * déze persoon open — een beantwoorde vraag of een vraag aan een ander telt
 * niet mee.
 */
describe("het overzicht", () => {
  let samenwerking: Samenwerking;

  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue("Dit is een testantwoord.");
  });

  async function seed() {
    samenwerking = await createSamenwerking();
    const { orgId, lead, collega, task } = samenwerking;

    // Taken in hetzelfde project met de vier statussen, plus een klant.
    await createTaak(orgId, lead, "Tweede taak");
    const klaar = await createTaak(orgId, lead, "Klaar taak");
    const gepauzeerd = await createTaak(orgId, lead, "Gepauzeerde taak");
    const klant = await createKlant(orgId, "Acme BV");
    // Een project onder de klant: klanten zijn optioneel, dit project staat
    // er wél onder.
    const klantTaak = await createTask({
      orgId,
      leadId: lead,
      projectName: "Klantwerk",
      taskTitle: "Eerste levering",
      customerId: klant.id,
    });

    const leadCtx = ctxVoor(orgId, lead);
    await completeTaskAction.run({ taskId: klaar.id }, leadCtx);
    await setTaskStatus(gepauzeerd.id, orgId, "gepauzeerd");

    const vraag = await createHumanTask({
      taskId: task.id,
      orgId,
      askedUserId: lead,
      question: "Welke database?",
      reason: "Het datamodel hangt ervan af.",
      options: ["Postgres", "SQLite"],
    });
    expect(vraag).toBeDefined();

    // Een vraag aan een collega op een andere taak telt niet mee voor "wacht
    // op mij" van de lead.
    const andere = await createTaak(orgId, lead, "Vraag aan collega");
    const vraagAanCollega = await createHumanTask({
      taskId: andere.id,
      orgId,
      askedUserId: collega,
      question: "Welke kleur?",
      reason: "De huisstijl hangt ervan af.",
      options: ["Blauw", "Groen"],
    });
    expect(vraagAanCollega).toBeDefined();

    return { orgId, lead, collega, klant, klantTaak, taakWachtOpLead: task };
  }

  it("telt per project het aantal taken per status", async () => {
    const { orgId } = await seed();
    const overzicht = await getOverzicht(orgId, "niemand@x.test");

    const projecten = overzicht.projecten.filter(
      (p) => p.projectName === "Project",
    );
    expect(projecten).toHaveLength(1);
    const project = projecten[0];

    // Vijf taken in "Project": de taak van createSamenwerking (wacht op de
    // lead), de tweede (bezig), de klaar, de gepauzeerde en de vraag aan de
    // collega (wacht op iemand, maar niet op de lead).
    expect(project.tellingen).toEqual({
      "bezig": 1,
      "wacht op iemand": 2,
      "gepauzeerd": 1,
      "klaar": 1,
    });
    expect(project.totaal).toBe(5);
  });

  it("markeert alleen taken met een open vraag aan de aanroeper als wacht op mij", async () => {
    const { orgId, lead, taakWachtOpLead } = await seed();
    const overzicht = await getOverzicht(orgId, lead);

    const metVraag = overzicht.taken.filter((t) => t.wachtOpMij);
    expect(metVraag).toHaveLength(1);
    expect(metVraag[0].id).toBe(taakWachtOpLead.id);
    expect(metVraag[0].wachtOpIemand).toBe(true);
    expect(overzicht.wachtOpMijAantal).toBe(1);

    // Iemand anders ziet geen enkele taak als "wacht op mij": de vragen zijn
    // aan de lead en de collega gesteld, niet aan een willekeurig ander adres.
    const voorAnder = await getOverzicht(
      orgId,
      "iemand-anders@anderdomein.test",
    );
    expect(voorAnder.taken.filter((t) => t.wachtOpMij)).toHaveLength(0);
  });

  it("stopt met wacht op mij zodra de vraag beantwoord is", async () => {
    const { orgId, lead, taakWachtOpLead } = await seed();
    const openVraag = (await listOpenHumanTasks(orgId, lead)).find(
      (t) => t.taskId === taakWachtOpLead.id,
    );
    expect(openVraag).toBeDefined();
    await answerHumanTask({
      id: openVraag!.id,
      orgId,
      answer: "Postgres",
    });

    const overzicht = await getOverzicht(orgId, lead);
    const taak = overzicht.taken.find((t) => t.id === taakWachtOpLead.id);
    expect(taak?.wachtOpMij).toBe(false);
    // De taak is niet meer "wacht op iemand": het antwoord maakte hem bezig.
    expect(taak?.status).toBe("bezig");
  });

  it("toont per project de klant waar het project onder staat", async () => {
    const { orgId, klant, klantTaak } = await seed();
    const overzicht = await getOverzicht(orgId, "niemand@x.test");

    const direct = overzicht.projecten.filter((p) => p.klantId === null);
    expect(direct.length).toBeGreaterThan(0);
    const klantProject = overzicht.projecten.find(
      (p) => p.projectName === "Klantwerk",
    );
    expect(klantProject).toBeDefined();
    expect(klantProject!.klantId).toBe(klant.id);
    expect(klantProject!.klantNaam).toBe("Acme BV");
    expect(
      overzicht.taken.some((t) => t.id === klantTaak.id),
    ).toBe(true);
  });

  it("archiveren van een klant raakt het overzicht van zijn projecten niet aan", async () => {
    const { orgId, klant } = await seed();
    await archiveKlant(klant.id, orgId);
    const overzicht = await getOverzicht(orgId, "niemand@x.test");
    const klantProject = overzicht.projecten.find(
      (p) => p.projectName === "Klantwerk",
    );
    expect(klantProject).toBeDefined();
    expect(klantProject!.klantNaam).toContain("gearchiveerd");
  });
});
