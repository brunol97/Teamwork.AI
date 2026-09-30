import { beforeEach, describe, expect, it, vi } from "vitest";

import pauseTaskAction from "../../actions/pause-task.js";
import resumeTaskAction from "../../actions/resume-task.js";
import sendTaskMessageAction from "../../actions/send-task-message.js";
import transferTaskAction from "../../actions/transfer-task.js";
import updateOverdrachtNoteAction from "../../actions/update-overdracht-note.js";
import { getTask } from "../../server/tasks/store.js";
import { createSamenwerking, ctxVoor } from "../collaboration/samenwerking.js";

const mockGenerate = vi.fn();

vi.mock("../../server/llm/ollama.js", () => ({
  generateOllamaResponse: (...args: unknown[]) => mockGenerate(...args),
  DEFAULT_OLLAMA_MODEL: "gpt-oss:120b",
}));

describe("na hervatten heeft de agent de volledige context", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue(
      "Dit is een geautomatiseerd testantwoord van de Ollama-agent.",
    );
  });

  it("neemt tijdens de pauze geen berichten aan", async () => {
    const { orgId, lead, task } = await createSamenwerking();
    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));

    await expect(
      sendTaskMessageAction.run(
        { taskId: task.id, message: "Ga verder." },
        ctxVoor(orgId, lead),
      ),
    ).rejects.toMatchObject({ errorCode: "task_gepauzeerd", statusCode: 409 });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("draagt na hervatten het hele gesprek én de overdrachtsnotitie over", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();

    // Een gesprek vóór de pauze; de agent moet dit na het hervatten weer zien.
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Eerste bericht vóór de pauze." },
      ctxVoor(orgId, lead),
    );

    await pauseTaskAction.run({ taskId: task.id }, ctxVoor(orgId, lead));
    await updateOverdrachtNoteAction.run(
      { taskId: task.id, content: "PAS-OP-MARKER: lees de eisen voor je begint." },
      ctxVoor(orgId, lead),
    );

    // Hervatten is geen nieuwe thread: dezelfde taak, zelfde gesprek.
    await resumeTaskAction.run({ taskId: task.id }, ctxVoor(orgId, collega));
    expect((await getTask(task.id, orgId))?.status).toBe("bezig");

    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Tweede bericht na het hervatten." },
      ctxVoor(orgId, collega),
    );

    // De laatste aanroep kreeg de volledige gespreksgeschiedenis mee,
    // inclusief het bericht van vóór de pauze.
    expect(mockGenerate).toHaveBeenCalled();
    const laatsteAanroep = mockGenerate.mock.calls.at(-1)!;
    const messages = laatsteAanroep[1] as { role: string; content: string }[];
    const inhouden = messages.map((message) => message.content);
    expect(inhouden).toContain("Eerste bericht vóór de pauze.");
    expect(inhouden).toContain("Tweede bericht na het hervatten.");

    // En de systeemprompt draagt de overdrachtsnotitie over, zodat de agent
    // weet wat er bij de pauze is afgesproken — inclusief de aanpassing
    // die de lead op het concept schreef.
    const system = laatsteAanroep[0] as string;
    expect(system).toContain("Overdrachtsnotitie");
    expect(system).toContain("PAS-OP-MARKER: lees de eisen voor je begint.");
  });

  it("draagt de gefinaliseerde notitie van een overdracht over aan de nieuwe lead", async () => {
    const { orgId, lead, collega, task } = await createSamenwerking();

    await transferTaskAction.run(
      { taskId: task.id, newLeadId: collega },
      ctxVoor(orgId, lead),
    );

    // De nieuwe lead stuurt het eerste bericht; de agent kent de notitie.
    await sendTaskMessageAction.run(
      { taskId: task.id, message: "Waar stonden we?" },
      ctxVoor(orgId, collega),
    );

    const system = mockGenerate.mock.calls.at(-1)?.[0] as string;
    expect(system).toContain("Overdrachtsnotitie");
    // De notitie noemt de taak en de overdracht zelf.
    expect(system).toContain("Datamigratie");
    expect(system).toContain("geen open vraag");
  });
});
