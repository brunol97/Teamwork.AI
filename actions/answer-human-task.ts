import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { resumeAgentAfterAnswer } from "../server/collaboration/agent-resume.js";
import {
  answerHumanTask,
  getHumanTask,
  markHumanTaskResumed,
} from "../server/collaboration/human-tasks.js";
import { createTaskEvent, getTask } from "../server/tasks/store.js";

export default defineAction({
  description:
    "Answer an open human task of the current person with one of the options (or free text). The task leaves the waiting status and the agent resumes from the stored question and answer, also after a restart of the server. If only the resume fails, the answer is still saved and the action succeeds with resumeFailed: true; retry-human-task-resume then starts the agent again.",
  schema: z.object({
    id: z.string().min(1).describe("Human task id"),
    answer: z
      .string()
      .min(1)
      .describe("The chosen option, or a free-text answer"),
  }),
  run: async ({ id, answer }, ctx) => {
    const orgId = ctx?.orgId;
    const userEmail = ctx?.userEmail;
    if (!orgId || !userEmail) {
      fail("You must be signed in and belong to an organization.", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }

    // Bestaat de vraag niet binnen deze organisatie, dan lekt er niets.
    const humanTask = await getHumanTask(id, orgId);
    if (!humanTask) {
      fail("Vraag niet gevonden.", { errorCode: "not_found", statusCode: 404 });
    }
    if (humanTask.status !== "open") {
      fail("Deze vraag is al beantwoord.", {
        errorCode: "already_answered",
        statusCode: 409,
      });
    }
    if (humanTask.askedUserId !== userEmail) {
      fail("Deze vraag is aan iemand anders gesteld.", {
        errorCode: "not_asked_person",
        statusCode: 403,
      });
    }

    const answered = await answerHumanTask({ id, orgId, answer });
    if (!answered) {
      fail("Deze vraag is al beantwoord.", {
        errorCode: "already_answered",
        statusCode: 409,
      });
    }

    const task = await getTask(answered.taskId, orgId);
    await createTaskEvent(
      answered.taskId,
      "user",
      userEmail,
      "human_task_answered",
      JSON.stringify({
        humanTaskId: answered.id,
        question: answered.question,
        answer,
      }),
    );

    // Vanaf hier staat het antwoord duurzaam in de database. Een mislukte hervat
    // is dus geen fout voor de mens die antwoordde: het antwoord is bewaard, de
    // taak staat weer op "bezig" en een retry zou alleen `already_answered`
    // opleveren. We loggen de mislukte hervat en geven alsnog succes terug.
    // `resumedAt` blijft dan leeg, waardoor de vraag zichtbaar blijft in
    // list-human-task-resume-failures en opnieuw gestart kan worden.
    let agentMessage = "";
    let resumeFailed = false;
    try {
      agentMessage = await resumeAgentAfterAnswer({
        humanTask: answered,
        orgId,
      });
      await markHumanTaskResumed({ id: answered.id, orgId });
    } catch (error) {
      resumeFailed = true;
      const reden = error instanceof Error ? error.message : String(error);
      console.error("hervat van de agent na een antwoord mislukt:", reden);
      await createTaskEvent(
        answered.taskId,
        "system",
        "agent",
        "human_task_resume_failed",
        JSON.stringify({
          humanTaskId: answered.id,
          question: answered.question,
          answer: answered.answer,
          reason: reden,
        }),
      );
    }

    return {
      id: answered.id,
      taskId: answered.taskId,
      answer: answered.answer,
      taskStatus: task?.status ?? null,
      agentMessage,
      resumeFailed,
    };
  },
});
