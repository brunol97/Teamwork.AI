import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { userFacingActionError } from "@/lib/action-error";

type Notitie = {
  id: string;
  kind: string;
  content: string;
  status: string;
};

/**
 * Overdragen en pauzeren. De lead pauzeert de taak of draagt hem over aan een
 * collega; bij beide ontstaat er een automatisch opgestelde overdrachtsnotitie
 * die hier aanpasbaar is zolang hij open staat. Een gepauzeerde taak is door
 * iedereen in de organisatie te hervatten. Een gefinaliseerde notitie is
 * onveranderlijk en staat in het activiteitenlog.
 */
export function OverdrachtPanel({
  taskId,
  taskStatus,
  leadId,
}: {
  taskId: string;
  taskStatus: string;
  leadId: string;
}) {
  const { data } = useActionQuery("get-overdracht-note", { taskId });
  const { data: leden } = useActionQuery("list-org-members", {});
  const notitie: Notitie | null | undefined =
    (data as { note?: Notitie | null } | undefined)?.note ?? null;

  const { mutate: pauzeer, isPending: pauzeert } =
    useActionMutation("pause-task");
  const { mutate: hervat, isPending: hervatBezig } =
    useActionMutation("resume-task");
  const { mutate: draagOver, isPending: draagtOver } =
    useActionMutation("transfer-task");
  const { mutate: bewaarNotitie, isPending: bewaart } = useActionMutation(
    "update-overdracht-note",
  );

  const [tekst, setTekst] = useState("");
  const [aangepast, setAangepast] = useState(false);
  const [nieuweLead, setNieuweLead] = useState("");
  const [melding, setMelding] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  // Volg de notitie van de server zolang de lead niets heeft aangepast.
  useEffect(() => {
    if (notitie && !aangepast) {
      setTekst(notitie.content);
    }
  }, [notitie, aangepast]);

  const ledenLijst: { email: string; role: string }[] =
    (leden as { members?: { email: string; role: string }[] } | undefined)
      ?.members ?? [];
  // De lead zelf is geen zinvolle keuze bij overdragen.
  const kandidaten = ledenLijst.filter((lid) => lid.email !== leadId);
  const gefinaliseerd = notitie?.status === "gefinaliseerd";

  if (taskStatus === "klaar") {
    return null;
  }

  return (
    <section data-testid="overdracht-paneel" className="rounded-lg border p-4">
      <h2 className="mb-2 text-sm font-medium">Overdragen en pauzeren</h2>

      {taskStatus === "gepauzeerd" ? (
        <div className="mb-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Deze taak is gepauzeerd door de lead. Iedereen in de organisatie kan
            de taak hervatten; de agent krijgt daarna de volledige context
            terug, inclusief de overdrachtsnotitie.
          </p>
          <Button
            type="button"
            size="sm"
            data-testid="taak-hervatten"
            disabled={hervatBezig}
            onClick={() =>
              hervat(
                { taskId },
                {
                  onSuccess: () => {
                    setFout(null);
                    setMelding("De taak is hervat en staat weer op bezig.");
                  },
                  onError: (error) =>
                    setFout(
                      userFacingActionError(
                        error,
                        "Hervatten mislukt. Probeer het opnieuw.",
                      ),
                    ),
                },
              )
            }
          >
            {hervatBezig ? "Bezig..." : "Hervatten"}
          </Button>
        </div>
      ) : (
        <div className="mb-3 space-y-2">
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="taak-pauzeren"
              disabled={pauzeert}
              onClick={() =>
                pauzeer(
                  { taskId },
                  {
                    onSuccess: () => {
                      setFout(null);
                      setMelding(
                        "De taak is gepauzeerd; er is een overdrachtsnotitie opgesteld.",
                      );
                    },
                    onError: (error) =>
                      setFout(
                        userFacingActionError(
                          error,
                          "Pauzeren mislukt. Alleen de lead kan pauzeren.",
                        ),
                      ),
                  },
                )
              }
            >
              {pauzeert ? "Bezig..." : "Pauzeren"}
            </Button>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="nieuwe-lead" className="sr-only">
                Nieuwe lead
              </Label>
              <select
                id="nieuwe-lead"
                aria-label="Kies de nieuwe lead"
                data-testid="nieuwe-lead-keuze"
                value={nieuweLead}
                onChange={(e) => setNieuweLead(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Draag over aan...</option>
                {kandidaten.map((lid) => (
                  <option key={lid.email} value={lid.email}>
                    {lid.email}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              data-testid="taak-overdragen"
              disabled={draagtOver || !nieuweLead}
              onClick={() =>
                draagOver(
                  { taskId, newLeadId: nieuweLead },
                  {
                    onSuccess: () => {
                      setFout(null);
                      setMelding(
                        "De taak is overgedragen; de nieuwe lead heeft een melding met de overdrachtsnotitie gekregen.",
                      );
                      setNieuweLead("");
                    },
                    onError: (error) =>
                      setFout(
                        userFacingActionError(
                          error,
                          "Overdragen mislukt. De nieuwe lead moet lid zijn van de organisatie.",
                        ),
                      ),
                  },
                )
              }
            >
              {draagtOver ? "Bezig..." : "Overdragen"}
            </Button>
          </div>
        </div>
      )}

      {notitie ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-xs font-medium">Overdrachtsnotitie</h3>
            <span className="text-xs text-muted-foreground">
              {gefinaliseerd
                ? "Gefinaliseerd in het activiteitenlog"
                : "Concept — aanpasbaar"}
            </span>
          </div>
          <Label htmlFor="overdracht-notitie" className="sr-only">
            Overdrachtsnotitie
          </Label>
          <textarea
            id="overdracht-notitie"
            data-testid="overdracht-notitie"
            value={tekst}
            onChange={(e) => {
              setTekst(e.target.value);
              setAangepast(true);
            }}
            disabled={gefinaliseerd}
            rows={8}
            className="w-full rounded-md border bg-transparent p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          />
          {!gefinaliseerd ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1"
              data-testid="notitie-opslaan"
              disabled={bewaart || !aangepast}
              onClick={() =>
                bewaarNotitie(
                  { taskId, content: tekst },
                  {
                    onSuccess: () => {
                      setFout(null);
                      setAangepast(false);
                      setMelding("De overdrachtsnotitie is bijgewerkt.");
                    },
                    onError: (error) =>
                      setFout(
                        userFacingActionError(
                          error,
                          "Opslaan mislukt. Alleen de lead kan het concept aanpassen.",
                        ),
                      ),
                  },
                )
              }
            >
              {bewaart ? "Bezig..." : "Notitie opslaan"}
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Bij pauzeren of overdragen wordt automatisch een overdrachtsnotitie
          opgesteld.
        </p>
      )}

      {melding ? (
        <p role="status" className="mt-2 text-xs">
          {melding}
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
