import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useState } from "react";

import { Label } from "@/components/ui/label";
import { userFacingActionError } from "@/lib/action-error";

type Sectie = {
  title: string;
  assigneeId: string | null;
};

/**
 * De onderdelen van het werkdocument, elk met de deelnemer aan wie het
 * onderdeel is toegewezen. Een deelnemer is de lead of iemand die heeft
 * bijgedragen volgens het activiteitenlog. De toewijzing verandert niets aan
 * de tekst van het document en raakt de versiebescherming niet aan.
 */
export function DocumentSectiesPanel({
  taskId,
  deelnemers,
}: {
  taskId: string;
  deelnemers: string[];
}) {
  const { data } = useActionQuery("list-document-sections", { taskId });
  const { mutate: wijsToe, isPending } = useActionMutation(
    "assign-document-section",
  );

  const secties: Sectie[] =
    (data as { sections?: Sectie[] } | undefined)?.sections ?? [];
  const [fout, setFout] = useState<string | null>(null);

  if (secties.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="document-secties"
      className="mt-2 rounded-md border bg-muted/40 p-3"
    >
      <h3 className="mb-2 text-xs font-medium">Onderdelen van het document</h3>
      <ul className="space-y-2">
        {secties.map((sectie) => (
          <li
            key={sectie.title}
            data-testid="sectie-rij"
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate text-xs">{sectie.title}</span>
            <div className="flex items-center gap-2">
              {sectie.assigneeId ? (
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="sectie-toegewezen-aan"
                >
                  {sectie.assigneeId}
                </span>
              ) : null}
              <div>
                <Label
                  htmlFor={`toewijzing-${sectie.title}`}
                  className="sr-only"
                >
                  Toewijzen aan
                </Label>
                <select
                  id={`toewijzing-${sectie.title}`}
                  aria-label={`Toewijzen aan: ${sectie.title}`}
                  data-testid="sectie-toewijzing"
                  value={sectie.assigneeId ?? ""}
                  disabled={isPending}
                  onChange={(e) => {
                    const waarde = e.target.value;
                    if (!waarde) return;
                    wijsToe(
                      { taskId, title: sectie.title, assigneeId: waarde },
                      {
                        onSuccess: () => setFout(null),
                        onError: (error) =>
                          setFout(
                            userFacingActionError(
                              error,
                              "Toewijzen mislukt. Alleen een deelnemer kan een onderdeel krijgen.",
                            ),
                          ),
                      },
                    );
                  }}
                  className="h-7 rounded-md border border-input bg-transparent px-2 py-0 text-xs"
                >
                  <option value="">Niet toegewezen</option>
                  {deelnemers.map((deelnemer) => (
                    <option key={deelnemer} value={deelnemer}>
                      {deelnemer}
                    </option>
                  ))}
                </select>
              </div>
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
