import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
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
 * verder gaat. Een vraag kan hier ook opgegeven worden: anders blijft de taak
 * wachten op iemand die niet (meer) antwoordt.
 *
 * Daaronder staat "De agent pakte het antwoord niet op": antwoorden die bewaard
 * zijn maar waarvan de hervat mislukte. Niets in de app probeert dat opnieuw,
 * dus hier staat een knop om het zelf te doen.
 *
 * Met `taskId` toont het paneel alleen de vragen van die taak (de taakpagina).
 * Zonder `taskId` toont het alles wat op deze persoon wacht, met de taaktitel
 * erbij, zodat de vraag ook vanaf de takenlijst bereikbaar is.
 */
export function HumanTaskPanel({ taskId }: { taskId?: string }) {
  const { data } = useActionQuery(
    "list-human-tasks",
    {},
    { refetchInterval: 2000 },
  );
  const { data: mislukt } = useActionQuery(
    "list-human-task-resume-failures",
    taskId ? { taskId } : {},
    { refetchInterval: 2000 },
  );
  const { mutate: answer, isPending } = useActionMutation("answer-human-task");
  const { mutate: opheffen, isPending: heffing } =
    useActionMutation("cancel-human-task");
  const { mutate: hervatten, isPending: hervat } = useActionMutation(
    "retry-human-task-resume",
  );
  const [fout, setFout] = useState<string | null>(null);
  const [notitie, setNotitie] = useState<string | null>(null);

  const humanTasks: HumanTask[] =
    (data as { humanTasks?: HumanTask[] } | undefined)?.humanTasks ?? [];
  // Zonder taskId toont het paneel alles wat op deze persoon wacht; zo is
  // "Wacht op jou" ook vanaf de takenlijst bereikbaar.
  const forTask = taskId
    ? humanTasks.filter((humanTask) => humanTask.taskId === taskId)
    : humanTasks;

  const onopgepakte: HumanTask[] =
    (mislukt as { resumeFailures?: HumanTask[] } | undefined)?.resumeFailures ??
    [];

  if (forTask.length === 0 && onopgepakte.length === 0) {
    return null;
  }

  return (
    <>
      {forTask.length > 0 ? (
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
                <div className="text-xs font-medium">
                  Wat: {humanTask.question}
                </div>
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
                              // agent kon mislukken. Opnieuw antwoorden kan niet,
                              // want de vraag is al beantwoord. Wat wél kan:
                              // hieronder staat "De agent pakte het antwoord niet
                              // op" met een knop om het opnieuw te starten.
                              setNotitie(
                                (
                                  result as
                                    | { resumeFailed?: boolean }
                                    | undefined
                                )?.resumeFailed
                                  ? "Je antwoord is opgeslagen. De agent kon niet meteen verdergaan."
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
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="human-task-opheffen"
                    disabled={heffing}
                    onClick={() => {
                      opheffen(
                        { id: humanTask.id },
                        {
                          onSuccess: () => {
                            setFout(null);
                            setNotitie(
                              "Vraag opgeheven. De taak loopt weer door.",
                            );
                          },
                          onError: (error) =>
                            setFout(
                              userFacingActionError(
                                error,
                                "De vraag kon niet worden opgeheven.",
                              ),
                            ),
                        },
                      );
                    }}
                  >
                    Vraag opgeven
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {onopgepakte.length > 0 ? (
        <section
          data-testid="hervat-mislukt"
          className="rounded-lg border border-destructive p-4"
        >
          <h2 className="mb-2 text-sm font-medium">
            De agent pakte je antwoord niet op
          </h2>
          <ul className="space-y-3">
            {onopgepakte.map((humanTask) => (
              <li key={humanTask.id} className="rounded-md bg-muted p-2">
                {taskId ? null : (
                  <Link
                    to={`/tasks/${encodeURIComponent(humanTask.taskId)}`}
                    data-testid="hervat-mislukt-taak"
                    className="text-xs text-muted-foreground underline"
                  >
                    {humanTask.taskTitle}
                  </Link>
                )}
                <div className="text-xs font-medium">
                  Vraag: {humanTask.question}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  data-testid="hervat-opnieuw"
                  disabled={hervat}
                  onClick={() => {
                    hervatten(
                      { id: humanTask.id },
                      {
                        onSuccess: (result) => {
                          setFout(null);
                          setNotitie(
                            (result as { resumeFailed?: boolean } | undefined)
                              ?.resumeFailed
                              ? "De agent kon het antwoord nog niet oppakken. Probeer het later nog eens."
                              : "De agent gaat verder met je antwoord.",
                          );
                        },
                        onError: (error) =>
                          setFout(
                            userFacingActionError(
                              error,
                              "De agent kon niet opnieuw starten.",
                            ),
                          ),
                      },
                    );
                  }}
                >
                  Agent opnieuw starten
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
    </>
  );
}
