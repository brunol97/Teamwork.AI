import { useActionQuery } from "@agent-native/core/client/hooks";

type Evaluatie = {
  id: string;
  agentName: string;
  content: string;
  fallback: boolean;
  createdAt: number;
};

/**
 * De evaluaties van een taak: de terugblik die de agent maakt bij het
 * afronden, gericht op verbetering van skills. Elke afronding levert er
 * precies één op; de terugval-evaluatie staat er ook bij, zodat het duidelijk
 * is wanneer de agent zelf geen bruikbare evaluatie gaf.
 */
export function EvaluatiesPanel({ taskId }: { taskId: string }) {
  const { data } = useActionQuery("list-evaluations", { taskId });
  const evaluaties: Evaluatie[] =
    (data as { evaluations?: Evaluatie[] } | undefined)?.evaluations ?? [];

  if (evaluaties.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="evaluaties"
      className="rounded-lg border p-4"
    >
      <h2 className="mb-2 text-sm font-medium">Evaluatie</h2>
      <ul className="space-y-3">
        {evaluaties.map((evaluatie) => (
          <li key={evaluatie.id} className="rounded-md bg-muted p-2">
            <div className="mb-1 text-xs text-muted-foreground">
              {evaluatie.agentName}
              {evaluatie.fallback ? " · terugval: de agent gaf geen bruikbare evaluatie" : ""}
            </div>
            <div className="whitespace-pre-wrap text-sm">{evaluatie.content}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
