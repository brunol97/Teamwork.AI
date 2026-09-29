import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef } from "react";

import { TAB_ID } from "@/lib/tab-id";

/** Hoe vaak de taakpagina zijn aanwezigheid herhaalt. */
const HEARTBEAT_MS = 5000;

/**
 * Aanwezigheid is vluchtig en het framework stuurt geen wijziging voor elke
 * hartslag van een andere tab naar buiten, dus de lijst wordt elke seconde
 * opnieuw gelezen. Zo ziet de tweede persoon elkaar binnen ongeveer een seconde.
 */
const PRESENCE_REFETCH_MS = 1000;

type Participant = { clientId: string; userId: string; lastSeenAt: number };

/**
 * Rapporteert dat dit tabblad de taak open heeft en toont wie er nog meer
 * meekijkt. Twee tabbladen van dezelfde persoon tellen als twee deelnemers,
 * omdat ze elk een eigen clientId hebben.
 */
export function PresenceBar({ taskId }: { taskId: string }) {
  const { data } = useActionQuery(
    "get-task-presence",
    { taskId },
    { enabled: Boolean(taskId), refetchInterval: PRESENCE_REFETCH_MS },
  );
  const { mutate: heartbeat } = useActionMutation("set-task-presence");
  const { mutate: leave } = useActionMutation("leave-task-presence");
  const beatRef = useRef(heartbeat);
  const leaveRef = useRef(leave);
  beatRef.current = heartbeat;
  leaveRef.current = leave;

  useEffect(() => {
    if (!taskId) return;

    beatRef.current({ taskId, clientId: TAB_ID });
    const timer = setInterval(
      () => beatRef.current({ taskId, clientId: TAB_ID }),
      HEARTBEAT_MS,
    );

    return () => {
      clearInterval(timer);
      leaveRef.current({ clientId: TAB_ID });
    };
  }, [taskId]);

  const participants: Participant[] = data?.participants ?? [];
  const others = participants.filter((p) => p.clientId !== TAB_ID);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span data-testid="aanwezig-aantal">
        {participants.length} {participants.length === 1 ? "persoon" : "personen"}{" "}
        aanwezig
      </span>
      {others.map((participant) => (
        <span
          key={participant.clientId}
          data-testid="aanwezig-chip"
          className="rounded-full border px-2 py-0.5"
        >
          {participant.userId}
        </span>
      ))}
    </div>
  );
}
