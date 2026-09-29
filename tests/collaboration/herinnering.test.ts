import { beforeEach, describe, expect, it, vi } from "vitest";

import askHumanTaskAction from "../../actions/ask-human-task.js";
import {
  buildHerinnering,
  sendHerinnering,
} from "../../server/collaboration/herinnering.js";
import { createSamenwerking, ctxVoor } from "./samenwerking.js";

const mail = vi.hoisted(() => ({
  verzonden: [] as {
    to: string;
    subject: string;
    text?: string;
    html: string;
  }[],
  geconfigureerd: true,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import("./mail.js")).mockMailTransport(mail),
}));

const humanTask = {
  id: "vraag-1",
  taskId: "taak-1",
  organizationId: "org-1",
  askedUserId: "collega@samenwerking.test",
  question: "Welke database kiezen we?",
  reason: "De migratie moet weten waar de data naartoe gaat.",
  options: ["Postgres", "MongoDB"],
  status: "open",
  answer: null,
  answeredAt: null,
  resumedAt: null,
  createdAt: 0,
  updatedAt: 0,
} as const;

/**
 * Iemand die nooit de takenlijst opent leert een vraag anders nooit. De
 * herinnering is de enige plek waar de vraag de app uit komt, dus de inhoud is
 * wat telt: wat de agent wil, waarom, en de opties.
 */
describe("de herinnering stuurt vraag, waarom en opties", () => {
  beforeEach(() => {
    mail.verzonden = [];
    mail.geconfigureerd = true;
    mail.fout = undefined;
  });

  it("bevat wat de agent wil, waarom hij het nodig heeft en de opties", async () => {
    const herinnering = buildHerinnering({
      humanTask: humanTask as never,
      taskTitle: "Datamigratie",
    });

    expect(herinnering.to).toBe(humanTask.askedUserId);
    expect(herinnering.subject).toContain("Datamigratie");
    expect(herinnering.text).toContain("Welke database kiezen we?");
    expect(herinnering.text).toContain(
      "De migratie moet weten waar de data naartoe gaat.",
    );
    expect(herinnering.text).toContain("- Postgres");
    expect(herinnering.text).toContain("- MongoDB");
    expect(herinnering.html).toContain("Welke database kiezen we?");
    expect(herinnering.html).toContain("<li>Postgres</li>");
    expect(herinnering.html).toContain("<li>MongoDB</li>");

    const resultaat = await sendHerinnering(herinnering);
    expect(resultaat.verzonden).toBe(true);
    expect(mail.verzonden).toEqual([herinnering]);
  });

  it("blokkeert de vraag niet als er geen mailtransport is", async () => {
    mail.geconfigureerd = false;

    const resultaat = await sendHerinnering(
      buildHerinnering({
        humanTask: humanTask as never,
        taskTitle: "Datamigratie",
      }),
    );

    expect(resultaat.verzonden).toBe(false);
    expect(mail.verzonden).toEqual([]);
  });

  it("blokkeert de vraag niet als het transport een fout geeft", async () => {
    mail.fout = new Error("resend weigert");

    const resultaat = await sendHerinnering(
      buildHerinnering({
        humanTask: humanTask as never,
        taskTitle: "Datamigratie",
      }),
    );

    expect(resultaat.verzonden).toBe(false);
    expect(resultaat.reden).toContain("resend weigert");
  });
});

describe("de agent herinnert de gevraagde persoon aan de vraag", () => {
  beforeEach(() => {
    mail.verzonden = [];
    mail.geconfigureerd = true;
    mail.fout = undefined;
  });

  it("stuurt de herinnering naar de gevraagde persoon", async () => {
    const { orgId, task, lead, collega } = await createSamenwerking();

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(true);
    expect(result.notified).toBe(true);
    expect(mail.verzonden).toHaveLength(1);
    expect(mail.verzonden[0].to).toBe(collega);
    expect(mail.verzonden[0].text).toContain("Welke database kiezen we?");
    expect(mail.verzonden[0].text).toContain("- MongoDB");
  });

  it("stuurt geen mail naar iemand die zelf in de app staat", async () => {
    const { orgId, task, lead } = await createSamenwerking();

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: lead,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    expect(result.asked).toBe(true);
    expect(result.notified).toBe(false);
    expect(mail.verzonden).toEqual([]);
  });

  it("houdt de vraag en de taak overeens als de mail niet vertrekt", async () => {
    mail.fout = new Error("resend weigert");
    const { orgId, task, lead, collega } = await createSamenwerking();

    const result = await askHumanTaskAction.run(
      {
        taskId: task.id,
        askedUserId: collega,
        question: "Welke database kiezen we?",
        reason: "De migratie moet weten waar de data naartoe gaat.",
        options: ["Postgres", "MongoDB"],
      },
      ctxVoor(orgId, lead),
    );

    // De mail is een extra weg, geen voorwaarde: de vraag staat gewoon in
    // "Wacht op jou" en de taak wacht.
    expect(result.asked).toBe(true);
    expect(result.notified).toBe(false);
    expect(result.humanTask?.status).toBe("open");
  });
});
