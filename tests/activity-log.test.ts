import { describe, expect, it } from "vitest";

import { describeEvent, type ActivityEvent } from "../app/lib/activity-log.js";

let volgnummer = 0;

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: `e${volgnummer++}`,
    type: "human_task_answered",
    actorType: "user",
    data: null,
    ...overrides,
  };
}

describe("de activiteitenlog toont een gebeurtenis als Nederlandse zin", () => {
  it("leest human_task_answered als een zin in plaats van ruwe JSON", () => {
    const beschreven = describeEvent(
      event({
        data: JSON.stringify({
          question: "Welke database kiezen we?",
          answer: "Postgres",
        }),
      }),
    );

    expect(beschreven.text).toBe(
      'Op "Welke database kiezen we?" is geantwoord: Postgres.',
    );
    expect(beschreven.text).not.toContain("{");
    expect(beschreven.actor).toBe("Jij");
  });

  it("leest een mislukte hervat als een zin en noemt de systeemactor", () => {
    const beschreven = describeEvent(
      event({
        type: "human_task_resume_failed",
        actorType: "system",
        data: JSON.stringify({
          question: "Welke database kiezen we?",
          answer: "Postgres",
          reason: "connect ECONNREFUSED",
        }),
      }),
    );

    expect(beschreven.actor).toBe("Systeem");
    expect(beschreven.text).toBe(
      'Het antwoord op "Welke database kiezen we?" is bewaard, maar de agent kon daarna niet verdergaan.',
    );
  });

  it("laat de bestaande documentgebeurtenissen onveranderd", () => {
    const sectie = describeEvent(
      event({ type: "document_section_added", data: "Eisen" }),
    );
    expect(sectie.text).toBe('Sectie "Eisen" toegevoegd aan het werkdocument.');

    const gewijzigd = describeEvent(event({ type: "document_changed" }));
    expect(gewijzigd.text).toBe("Werkdocument bewerkt.");
  });

  it("laat een onbekend type op de ruwe tekst vallen", () => {
    const onbekend = describeEvent(event({ type: "iets Anders", data: "vrij" }));
    expect(onbekend.text).toBe("vrij");
  });
});
