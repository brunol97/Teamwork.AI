import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";

import { Button } from "@/components/ui/button";
import { userFacingActionError } from "@/lib/action-error";

type Agent = {
  id: string;
  name: string;
  enabled: boolean;
};

/**
 * De actieve agent van een taak: wie er nu spreekt als niemand iemand
 * aanroept. Wisselen zet een andere agent van de organisatie aan het woord;
 * de standaardagent (Ollama) is de terugval. Elke agent van de organisatie is
 * hier te kiezen, ook degene die net is aangemaakt.
 */
export function ActiveAgentPanel({
  taskId,
  activeAgentId,
  taskStatus,
}: {
  taskId: string;
  activeAgentId: string | null;
  taskStatus: string;
}) {
  const { data } = useActionQuery("list-agents", {});
  const agents: Agent[] = (data as { agents?: Agent[] } | undefined)?.agents ?? [];
  const { mutate: wissel, isPending } = useActionMutation("set-task-agent");
  const actief = agents.find((agent) => agent.id === activeAgentId);

  if (taskStatus === "gepauzeerd") {
    return (
      <div
        role="alert"
        data-testid="taak-gepauzeerd"
        className="rounded-md border p-3 text-sm"
      >
        Deze taak is gepauzeerd. Er gaan geen nieuwe berichten naar de agent;
        iedereen in de organisatie kan de taak hervatten.
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Actieve agent</h2>
        <a href="/agents" className="text-xs text-muted-foreground underline">
          Agents beheren
        </a>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Nu aan het woord: {actief ? `@${actief.name}` : "de standaardagent"}.
        Roep een andere agent aan met @naam in je bericht, of wissel hier.
      </p>
      <div className="flex gap-2">
        <select
          aria-label="Kies de actieve agent"
          data-testid="actieve-agent-keuze"
          defaultValue=""
          onChange={(e) => {
            const waarde = e.target.value;
            wissel(
              { taskId, agentId: waarde || null },
              {
                onError: (error) =>
                  userFacingActionError(error, "Wisselen mislukt."),
              },
            );
            e.target.value = "";
          }}
          className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="">Wissel naar...</option>
          {agents
            .filter((agent) => agent.enabled)
            .map((agent) => (
              <option key={agent.id} value={agent.id}>
                @{agent.name}
              </option>
            ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="actieve-agent-terugzetten"
          disabled={isPending || !actief}
          onClick={() => wissel({ taskId, agentId: null })}
        >
          Standaardagent
        </Button>
      </div>
    </div>
  );
}
