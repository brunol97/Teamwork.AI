import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { userFacingActionError } from "@/lib/action-error";

type HumanTask = {
  id: string;
  taskId: string;
  question: string;
  reason: string;
  options: string[];
};

/**
 * "Wacht op jou": de openstaande vragen van de agent aan deze persoon. Elke
 * vraag toont de drie velden — wat, waarom en de opties — en elke optie is een
 * knop; het antwoord komt in `answer-human-task` terecht, waarna de agent
 * verder gaat.
 */
export function HumanTaskPanel({ taskId }: { taskId: string }) {
  const { data } = useActionQuery("list-human-tasks", {}, { refetchInterval: 2000 });
  const { mutate: answer, isPending } = useActionMutation("answer-human-task");
  const [fout, setFout] = useState<string | null>(null);

  const humanTasks: HumanTask[] = (data as { humanTasks?: HumanTask[] } | undefined)
    ?.humanTasks ?? [];
  const forTask = humanTasks.filter((humanTask) => humanTask.taskId === taskId);

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
                        onSuccess: () => setFout(null),
                        onError: (error) =>
                          setFout(
                            userFacingActionError(
                              error,
                              "Antwoorden mislukt. Probeer het opnieuw.",
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
      {fout ? (
        <p role="alert" className="mt-2 text-xs">
          {fout}
        </p>
      ) : null}
    </section>
  );
}
