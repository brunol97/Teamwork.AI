import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userFacingActionError } from "@/lib/action-error";
import { AGENT_TEMPLATES } from "@shared/agents/templates";

export function meta() {
  return [{ title: "Agents - Agent Office" }];
}

type Agent = {
  id: string;
  name: string;
  description: string;
  model: string | null;
  tools: string[];
  skills: string[];
  enabled: boolean;
  template: string | null;
};

/**
 * Agents zijn bronnen van de organisatie: een nieuwe agent is meteen
 * beschikbaar in alle taken. Hier maak je ze vanuit een sjabloon of leeg,
 * kies je model, tools en skills, schakel je ze in en uit, en stuur je een
 * testbericht. Het testbericht loopt via send-task-message, dus via dezelfde
 * agent-chat als in een gewone taak.
 */
export default function AgentsRoute() {
  const { data, isLoading, refetch } = useActionQuery("list-agents", {});
  const agents: Agent[] = (data as { agents?: Agent[] } | undefined)?.agents ?? [];

  const { mutate: createAgent, isPending: isCreating } =
    useActionMutation("create-agent");
  const { mutate: updateAgent } = useActionMutation("update-agent");
  const { mutate: deleteAgent } = useActionMutation("delete-agent");
  const { mutate: sendMessage, isPending: isSending } =
    useActionMutation("send-task-message");

  const [naam, setNaam] = useState("");
  const [omschrijving, setOmschrijving] = useState("");
  const [model, setModel] = useState("");
  const [tools, setTools] = useState("");
  const [skills, setSkills] = useState("");
  const [sjabloon, setSjabloon] = useState("leeg");
  const [fout, setFout] = useState<string | null>(null);

  // Testpaneel: welk agent en op welke taak.
  const [testAgentId, setTestAgentId] = useState<string | null>(null);
  const [testTaak, setTestTaak] = useState("");
  const [testBericht, setTestBericht] = useState("");
  const [testAntwoord, setTestAntwoord] = useState<string | null>(null);
  const { data: takenData } = useActionQuery("list-tasks", {});
  const taken = (takenData as { id: string; title: string }[] | undefined) ?? [];

  const maakAan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!naam.trim()) return;
    setFout(null);
    createAgent(
      {
        name: naam.trim(),
        description: omschrijving.trim(),
        model: model.trim() ? model.trim() : null,
        tools: tools
          .split(",")
          .map((tool) => tool.trim())
          .filter(Boolean),
        skills: skills
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
        template: sjabloon === "leeg" ? null : sjabloon,
      },
      {
        onSuccess: () => {
          setNaam("");
          setOmschrijving("");
          setModel("");
          setTools("");
          setSkills("");
          setSjabloon("leeg");
          refetch();
        },
        onError: (error) =>
          setFout(userFacingActionError(error, "Aanmaken mislukt. Probeer het opnieuw.")),
      },
    );
  };

  const schakelOm = (agent: Agent) => {
    setFout(null);
    updateAgent(
      { id: agent.id, enabled: !agent.enabled },
      { onError: (error) => setFout(userFacingActionError(error, "Wijzigen mislukt.")) },
    );
  };

  const verwijder = (agent: Agent) => {
    setFout(null);
    deleteAgent(
      { id: agent.id },
      {
        onSuccess: () => {
          if (testAgentId === agent.id) setTestAgentId(null);
          refetch();
        },
        onError: (error) => setFout(userFacingActionError(error, "Verwijderen mislukt.")),
      },
    );
  };

  const verstuurTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testAgentId || !testTaak || !testBericht.trim()) return;
    setFout(null);
    setTestAntwoord(null);
    sendMessage(
      { taskId: testTaak, message: testBericht.trim(), agentId: testAgentId },
      {
        onSuccess: (result) => {
          const antwoord = (result as { agentMessage?: string }).agentMessage;
          setTestAntwoord(antwoord ?? null);
          setTestBericht("");
        },
        onError: (error) =>
          setFout(userFacingActionError(error, "Het testbericht mislukt.")),
      },
    );
  };

  const gekozenAgent = agents.find((agent) => agent.id === testAgentId);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">Agents</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Elke agent is beschikbaar in alle taken van de organisatie en is met
        @naam aan te roepen. Een agent krijgt nooit tools die hij zelf niet
        heeft, en bij het uitbesteden geldt: delegatiediepte maximaal 2.
      </p>

      {fout ? (
        <div role="alert" data-testid="agents-fout" className="mb-4 rounded-md border p-2 text-sm">
          {fout}
        </div>
      ) : null}

      <form onSubmit={maakAan} className="mb-8 space-y-4 rounded-lg border p-4">
        <h2 className="font-medium">Nieuwe agent</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="agent-naam">Naam</Label>
            <Input
              id="agent-naam"
              data-testid="agent-naam"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="Bijv. Onderzoeker (zonder spaties)"
              required
            />
          </div>
          <div>
            <Label htmlFor="agent-sjabloon">Sjabloon</Label>
            <select
              id="agent-sjabloon"
              data-testid="agent-sjabloon"
              value={sjabloon}
              onChange={(e) => setSjabloon(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="leeg">Leeg</option>
              {AGENT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.naam}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="agent-omschrijving">Omschrijving</Label>
            <Input
              id="agent-omschrijving"
              value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)}
              placeholder="Waarvoor is deze agent er?"
            />
          </div>
          <div>
            <Label htmlFor="agent-model">Ollama-model</Label>
            <Input
              id="agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Standaardmodel van de omgeving"
            />
          </div>
          <div>
            <Label htmlFor="agent-tools">Tools (komma-gescheiden)</Label>
            <Input
              id="agent-tools"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="Bijv. web-zoeken, werkdocument-lezen"
            />
          </div>
          <div>
            <Label htmlFor="agent-skills">Skills (komma-gescheiden)</Label>
            <Input
              id="agent-skills"
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Bijv. notuleren"
            />
          </div>
        </div>
        <Button type="submit" disabled={isCreating} data-testid="agent-maken">
          {isCreating ? "Bezig..." : "Agent maken"}
        </Button>
      </form>

      {isLoading ? (
        <p>Agents laden...</p>
      ) : agents.length === 0 ? (
        <p className="mb-8 text-muted-foreground">
          Nog geen agents. Maak er hierboven een.
        </p>
      ) : (
        <ul className="mb-8 space-y-2" data-testid="agents-lijst">
          {agents.map((agent) => (
            <li key={agent.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    @{agent.name}
                    {!agent.enabled ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (uitgeschakeld)
                      </span>
                    ) : null}
                  </div>
                  {agent.description ? (
                    <div className="text-sm text-muted-foreground">
                      {agent.description}
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground">
                    model: {agent.model ?? "standaardmodel"} · tools:{" "}
                    {agent.tools.length > 0 ? agent.tools.join(", ") : "geen"} ·
                    skills:{" "}
                    {agent.skills.length > 0 ? agent.skills.join(", ") : "geen"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`agent-schakel-${agent.id}`}
                    onClick={() => schakelOm(agent)}
                  >
                    {agent.enabled ? "Uitschakelen" : "Inschakelen"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setTestAgentId(agent.id)}
                  >
                    Testen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`agent-verwijder-${agent.id}`}
                    onClick={() => verwijder(agent)}
                  >
                    Verwijderen
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 font-medium">Agent testen</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Stuur een testbericht via een bestaande taak; het antwoord van de
          agent verschijnt hier en in het gesprek van die taak.
        </p>
        <form onSubmit={verstuurTest} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="test-agent">Agent</Label>
              <select
                id="test-agent"
                data-testid="test-agent"
                value={testAgentId ?? ""}
                onChange={(e) => setTestAgentId(e.target.value || null)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Kies een agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    @{agent.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="test-taak">Taak</Label>
              <select
                id="test-taak"
                data-testid="test-taak"
                value={testTaak}
                onChange={(e) => setTestTaak(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Kies een taak...</option>
                {taken.map((taak) => (
                  <option key={taak.id} value={taak.id}>
                    {taak.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="test-bericht">Testbericht</Label>
            <Input
              id="test-bericht"
              data-testid="test-bericht"
              value={testBericht}
              onChange={(e) => setTestBericht(e.target.value)}
              placeholder="Bijv. Wat kun je?"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={isSending || !testAgentId || !testTaak}
            data-testid="test-verstuur"
          >
            {isSending ? "Bezig..." : "Verstuur testbericht"}
          </Button>
        </form>
        {testAntwoord !== null ? (
          <div
            data-testid="test-antwoord"
            className="mt-3 whitespace-pre-wrap rounded-md bg-secondary p-3 text-secondary-foreground"
          >
            {testAntwoord}
          </div>
        ) : null}
        {gekozenAgent && !gekozenAgent.enabled ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Deze agent is uitgeschakeld; schakel hem eerst in om te testen.
          </p>
        ) : null}
      </section>
    </div>
  );
}
