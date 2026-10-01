import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Vangnet voor een uitgevallen sync; zie `HumanTaskPanel` voor de reden van de lengte. */
const FALLBACK_REFETCH_MS = 15_000;

type Melding = {
  id: string;
  taskId: string;
  title: string;
  body: string;
  readAt: number | null;
};

type MeldingResult = { meldingen: Melding[]; ongelezen: number };

/**
 * Meldingen van de aanroeper over deze taak. Een melding is een
 * eenrichtingsbericht van de agent; de volger hoeft niet te antwoorden.
 */
export function MeldingenPanel({ taskId }: { taskId: string }) {
  // De framework-sync stuurt een nieuwe melding meteen door; de interval
  // vangt het geval dat die verbinding een keer uitvalt.
  const { data } = useActionQuery(
    "list-meldingen",
    {},
    { refetchInterval: FALLBACK_REFETCH_MS },
  );
  const { mutate: markRead } = useActionMutation("mark-meldingen-read");

  const meldingen: Melding[] = (data as MeldingResult | undefined)?.meldingen ?? [];
  const forTask = meldingen.filter((melding) => melding.taskId === taskId);

  useEffect(() => {
    const ongelezen = forTask.filter((melding) => !melding.readAt);
    if (ongelezen.length > 0) {
      markRead({ taskId });
    }
    // Alleen opnieuw markeren als er ongelezen meldingen voor deze taak bij zijn.
  }, [forTask.length, taskId]);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 text-sm font-medium">Meldingen</h2>
      {forTask.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Volg de taak om meldingen van de agent te ontvangen.
        </p>
      ) : (
        <ul className="space-y-2">
          {forTask.map((melding) => (
            <li key={melding.id} className="rounded-md bg-muted p-2">
              <div className="text-xs font-medium">{melding.title}</div>
              <div className="whitespace-pre-wrap text-xs">{melding.body}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function FollowTaskButton({ taskId }: { taskId: string }) {
  const { data, refetch } = useActionQuery("get-task-following", { taskId });
  const { mutate: follow } = useActionMutation("follow-task");
  const { mutate: unfollow } = useActionMutation("unfollow-task");

  const following = Boolean((data as { following: boolean } | undefined)?.following);

  return (
    <Button
      type="button"
      variant={following ? "secondary" : "outline"}
      size="sm"
      onClick={() => {
        if (following) {
          unfollow({ taskId }, { onSuccess: () => refetch() });
        } else {
          follow({ taskId }, { onSuccess: () => refetch() });
        }
      }}
    >
      {following ? "Volgen gestopt" : "Taak volgen"}
    </Button>
  );
}
