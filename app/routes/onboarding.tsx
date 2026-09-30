import { useActionMutation } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userFacingActionError } from "@/lib/action-error";

export function meta() {
  return [{ title: "Welkom - Agent Office" }];
}

/**
 * Onboarding met drie keuzes:
 *  1. een persoonlijke werkruimte starten (een organisatie met jou als enige
 *     lid, later om te zetten naar een team zonder dataverlies);
 *  2. een team starten (een organisatie voor meerdere mensen);
 *  3. deelnemen via een uitnodigingslink die een beheerder deelde.
 *
 * Beide eerste keuzes maken de organisatie via het framework aan (de
 * ledenlijst is van het framework) en maken hem meteen actief.
 */
export default function OnboardingRoute() {
  const navigate = useNavigate();
  const { mutate: maakOrganisatie, isPending } = useActionMutation(
    "create-organisatie",
  );
  const [naam, setNaam] = useState("");
  const [link, setLink] = useState("");
  const [foutmelding, setFoutmelding] = useState<string | null>(null);

  const start = (soort: "persoonlijk" | "team") => {
    setFoutmelding(null);
    maakOrganisatie(
      { soort, naam: naam.trim() || undefined },
      {
        onSuccess: () => navigate("/tasks"),
        onError: (error) =>
          setFoutmelding(
            userFacingActionError(
              error,
              "De organisatie kon niet aangemaakt worden. Probeer het opnieuw.",
            ),
          ),
      },
    );
  };

  return (
    <div className="mx-auto max-w-2xl p-6" data-testid="onboarding">
      <h1 className="mb-2 text-2xl font-semibold">Welkom bij Agent Office</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Waar wil je werken? Alles wat je maakt — taken, projecten, agents en
        skills — staat binnen één organisatie.
      </p>

      {foutmelding ? (
        <p className="mb-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {foutmelding}
        </p>
      ) : null}

      <div className="mb-6 space-y-2">
        <Label htmlFor="organisatie-naam">Naam van de organisatie</Label>
        <Input
          id="organisatie-naam"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
          placeholder="Bijv. Studio Noord"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          data-testid="keuze-persoonlijk"
          disabled={isPending}
          onClick={() => start("persoonlijk")}
          className="rounded-lg border p-4 text-left hover:bg-accent disabled:opacity-50"
        >
          <div className="font-medium">Persoonlijke werkruimte</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Alleen jij en je agents. Later om te zetten naar een team, zonder
            dataverlies.
          </div>
        </button>

        <button
          type="button"
          data-testid="keuze-team"
          disabled={isPending}
          onClick={() => start("team")}
          className="rounded-lg border p-4 text-left hover:bg-accent disabled:opacity-50"
        >
          <div className="font-medium">Team</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Samenwerken met collega's: nodig ze uit via een uitnodigingslink.
          </div>
        </button>
      </div>

      <div className="mt-6 rounded-lg border p-4">
        <div className="font-medium">Deelnemen via uitnodiging</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Heb je een uitnodigingslink van een beheerder gekregen? Plak hem hier
          en je gaat meteen de taak in.
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // De token is het laatste deel van de link: /uitnodiging/<token>.
            const deel = link.trim().split("/").filter(Boolean).pop();
            if (deel) navigate(`/uitnodiging/${encodeURIComponent(deel)}`);
          }}
        >
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Bijv. https://…/uitnodiging/abcd1234"
            data-testid="uitnodiging-link"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={!link.trim()}
            data-testid="uitnodiging-openen"
          >
            Openen
          </Button>
        </form>
      </div>
    </div>
  );
}
