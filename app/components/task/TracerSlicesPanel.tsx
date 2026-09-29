import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { userFacingActionError } from "@/lib/action-error";

type TracerSlice = {
  id: string;
  order: number;
  titel: string;
  doel: string;
  gedrag: string;
  acceptatiecriteria: string[];
  requirementRefs: string[];
  buitenDezeSlice: string;
  afhankelijkheden: string[];
  testaanpak: string;
};

/**
 * Tracer-slices: de sectie van het werkdocument met dunne, verticale
 * implementatie-opdrachten. De agent stelt de slices op als de gebruiker erom
 * vraagt in het gesprek ("Maak tracer-slices"); hier ordent, voegt samen,
 * splitst en exporteert de gebruiker ze. Elke handeling herschrijft de sectie
 * in het werkdocument, dus de nieuwe volgorde blijft bewaard.
 */
export function TracerSlicesPanel({ taskId }: { taskId: string }) {
  const { data, isLoading } = useActionQuery("list-tracer-slices", { taskId });
  const { mutate: herorden } = useActionMutation("reorder-tracer-slices");
  const { mutate: samenvoegen } = useActionMutation("merge-tracer-slices");
  const { mutate: splitsen } = useActionMutation("split-tracer-slice");
  const [fout, setFout] = useState<string | null>(null);

  const slices: TracerSlice[] =
    (data as { slices?: TracerSlice[] } | undefined)?.slices ?? [];

  const metFoutafvanging = (error: unknown) => {
    setFout(userFacingActionError(error, "De handeling mislukt. Probeer het opnieuw."));
  };

  const verplaats = (index: number, richting: -1 | 1) => {
    const doel = index + richting;
    if (doel < 0 || doel >= slices.length) return;
    const orderedIds = slices.map((slice) => slice.id);
    [orderedIds[index], orderedIds[doel]] = [orderedIds[doel], orderedIds[index]];
    setFout(null);
    herorden({ taskId, orderedIds }, { onError: metFoutafvanging });
  };

  const voegSamen = (sliceId: string) => {
    setFout(null);
    samenvoegen({ taskId, sliceId }, { onError: metFoutafvanging });
  };

  const splits = (sliceId: string, afterCriteria: number) => {
    setFout(null);
    splitsen({ taskId, sliceId, afterCriteria }, { onError: metFoutafvanging });
  };

  const exporteer = async (sliceId: string) => {
    setFout(null);
    try {
      const response = await fetch(
        `/_agent-native/actions/export-tracer-slice?taskId=${encodeURIComponent(taskId)}&sliceId=${encodeURIComponent(sliceId)}`,
      );
      if (!response.ok) {
        throw new Error("export mislukt");
      }
      const result = (await response.json()) as { fileName: string; markdown: string };
      const blob = new Blob([result.markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setFout("De export mislukt. Probeer het opnieuw.");
    }
  };

  return (
    <section
      data-testid="tracer-slices-panel"
      className="rounded-lg border p-4"
      aria-label="Tracer-slices"
    >
      <h2 className="mb-2 text-sm font-medium">Tracer-slices</h2>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Slices laden...</p>
      ) : slices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Vraag de agent om tracer-slices, bijvoorbeeld: &quot;Maak tracer-slices&quot;.
        </p>
      ) : (
        <ul className="space-y-3">
          {slices.map((slice, index) => (
            <li key={slice.id} data-testid="tracer-slice" className="rounded-md border p-3">
              <h3 className="text-sm font-medium" data-testid="slice-titel">
                Slice {slice.order}: {slice.titel}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Doel: {slice.doel}
              </p>
              <ul className="mt-2 space-y-1">
                {slice.acceptatiecriteria.map((criterium, criteriumIndex) => (
                  <li
                    key={criteriumIndex}
                    data-testid="slice-criterium"
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <span>{criterium}</span>
                    {criteriumIndex < slice.acceptatiecriteria.length - 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="slice-splitsen"
                        onClick={() => splits(slice.id, criteriumIndex + 1)}
                      >
                        Splitsen vanaf hier
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="slice-omhoog"
                  disabled={index === 0}
                  onClick={() => verplaats(index, -1)}
                >
                  Omhoog
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="slice-omlaag"
                  disabled={index === slices.length - 1}
                  onClick={() => verplaats(index, 1)}
                >
                  Omlaag
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="slice-samenvoegen"
                  disabled={index === slices.length - 1}
                  onClick={() => voegSamen(slice.id)}
                >
                  Samenvoegen
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="slice-exporteren"
                  onClick={() => exporteer(slice.id)}
                >
                  Exporteren
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {fout ? (
        <p role="alert" data-testid="slices-fout" className="mt-2 text-xs text-destructive">
          {fout}
        </p>
      ) : null}
    </section>
  );
}
