import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { userFacingActionError } from "@/lib/action-error";

type HumanTask = {
  id: string;
  taskId: string;
  taskTitle: string;
  question: string;
  reason: string;
  options: string[];
};

/**
 * "Wacht op jou": de openstaande vragen van de agent aan deze persoon. Elke
 * vraag toont de drie velden — wat, waarom en de opties — en elke optie is een
 * knop; het antwoord komt in `answer-human-task` terecht, waarna de agent
 * verder gaat.
 *
 * Met `taskId` toont het paneel alleen de vragen van die taak (de taakpagina).
 * Zonder `taskId` toont het alles wat op deze persoon wacht, met de taaktitel
 * erbij, zodat de vraag ook vanaf de takenlijst bereikbaar is.
 */
export function HumanTaskPanel({ taskId }: { taskId?: string }) {
  const { data } = useActionQuery("list-human-tasks", {}, { refetchInterval: 2000 });
  const { mutate: answer, isPending } = useActionMutation("answer-human-task");
  const [fout, setFout] = useState<string | null>(null);
  const [notitie, setNotitie] = useState<string | null>(null);

  const humanTasks: HumanTask[] = (data as { humanTasks?: HumanTask[] } | undefined)
    ?.humanTasks ?? [];
  // Zonder taskId toont het paneel alles wat op deze persoon wacht; zo is
  // "Wacht op jou" ook vanaf de takenlijst bereikbaar.
  const forTask = taskId
    ? humanTasks.filter((humanTask) => humanTask.taskId === taskId)
    : humanTasks;

  if (forTask.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="wacht-op-jou"
      className="rounded-lg border border-primary p-4"
    >
      <h2 className="mb-2 text-sm font-medium">Wacht op jou</h2>
      <ul className="space-y-3">
        {forTask.map((humanTask) => (
          <li key={humanTask.id} className="rounded-md bg-muted p-2">
            {taskId ? null : (
              <Link
                to={`/tasks/${encodeURIComponent(humanTask.taskId)}`}
                data-testid="wacht-op-jou-taak"
                className="text-xs text-muted-foreground underline"
              >
                {humanTask.taskTitle}
              </Link>
            )}
            <div className="text-xs font-medium">Wat: {humanTask.question}</div>
            <div className="text-xs text-muted-foreground">
              Waarom: {humanTask.reason}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {humanTask.options.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="human-task-optie"
                  disabled={isPending}
                  onClick={() => {
                    answer(
                      { id: humanTask.id, answer: option },
                      {
                        onSuccess: (result) => {
                          setFout(null);
                          // Het antwoord is bewaard; alleen de hervat van de
                          // agent kon mislukken. Dat is geen reden om opnieuw te
                          // antwoorden — de vraag is al beantwoord.
                          setNotitie(
                            (result as { resumeFailed?: boolean } | undefined)
                              ?.resumeFailed
                              ? "Je antwoord is opgeslagen. De agent kon niet meteen verdergaan; hij pakt het antwoord op bij de volgende stap."
                              : null,
                          );
                        },
                        onError: (error) =>
                          setFout(
                            userFacingActionError(
                              error,
                              "Antwoorden mislukt. Controleer of de vraag nog openstaat.",
                            ),
                          ),
                      },
                    );
                  }}
                >
                  {option}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {notitie ? (
        <p role="status" className="mt-2 text-xs">
          {notitie}
        </p>
      ) : null}
      {fout ? (
        <p role="alert" className="mt-2 text-xs">
          {fout}
        </p>
      ) : null}
    </section>
  );
}
