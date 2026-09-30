import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useOrgInvitations } from "@agent-native/core/client/org";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userFacingActionError } from "@/lib/action-error";

export function meta() {
  return [{ title: "Organisatie - Agent Office" }];
}

type MijnOrganisaties = {
  actieveOrganisatieId: string | null;
  organisaties: {
    organizationId: string;
    naam: string;
    rol: string;
    soort: "persoonlijk" | "team";
  }[];
};

type InviteLink = {
  id: string;
  taskId: string;
  token: string;
  invitedEmail: string | null;
  state: "geldig" | "verlopen" | "ingetrokken";
  taskTitle: string | null;
  createdAt: number;
};

const ROL_LABELS: Record<string, string> = {
  owner: "eigenaar",
  admin: "beheerder",
  member: "lid",
};

const LAATSTE_BEHEERDER_MELDING =
  "De laatste beheerder kan niet vertrekken of zijn rol verliezen. Er is altijd minstens één beheerder.";

/**
 * Beheer van de organisatie: de soort (persoonlijke werkruimte of team, met de
 * omzetting), leden en rollen, openstaande uitnodigingen en de
 * uitnodigingslinks van elke taak.
 *
 * Grens met het framework: de ledenlijst en de uitnodigingen zijn van het
 * framework — de app leest ze (list-org-members en de framework-hook
 * useOrgInvitations) en schrijft ze nooit zelf. Rollen wijzigen kan via de
 * framework-instellingen (/settings, tab Team); het framework weigert daar
 * zelf het demoten of verwijderen van de eigenaar, zodat de laatste beheerder
 * altijd overblijft.
 */
export default function OrganisatieRoute() {
  const { data: organisaties } = useActionQuery("list-mijn-organisaties", {});
  const { data: leden } = useActionQuery("list-org-members", {});
  const { data: uitnodigingen } = useOrgInvitations();
  const { data: links } = useActionQuery("list-alle-invite-links", {});
  const { data: klanten } = useActionQuery("list-klanten", {});
  const { mutate: omzetten, isPending: omzettenBezig } =
    useActionMutation("convert-to-team");
  const { mutate: revoke } = useActionMutation("revoke-invite-link");
  const { mutate: maakKlant, isPending: klantBezig } =
    useActionMutation("create-klant");
  const { mutate: archiveerKlant } = useActionMutation("archive-klant");

  const [melding, setMelding] = useState<string | null>(null);
  const [foutmelding, setFoutmelding] = useState<string | null>(null);
  const [nieuweKlant, setNieuweKlant] = useState("");

  const lijst = organisaties as MijnOrganisaties | undefined;
  const actief = lijst?.organisaties.find(
    (o) => o.organizationId === lijst.actieveOrganisatieId,
  );
  const soort = actief?.soort ?? "team";
  const isPersoonlijk = soort === "persoonlijk";

  const linkLijst = (links as { links: InviteLink[] } | undefined)?.links ?? [];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Organisatie</h1>
        <span className="text-sm text-muted-foreground">
          <Link to="/tasks" className="underline">
            Taken
          </Link>{" "}
          ·{" "}
          <Link to="/overzicht" className="underline">
            Overzicht
          </Link>
        </span>
      </div>

      {foutmelding ? (
        <p className="mb-4 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {foutmelding}
        </p>
      ) : null}
      {melding ? (
        <p className="mb-4 rounded-md border p-3 text-sm" data-testid="organisatie-melding">
          {melding}
        </p>
      ) : null}

      {/* Soort organisatie */}
      <section className="mb-8 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Soort</h2>
        <p className="text-sm" data-testid="organisatie-soort">
          {isPersoonlijk
            ? "Dit is een persoonlijke werkruimte."
            : "Dit is een team."}
        </p>
        {isPersoonlijk ? (
          <div className="mt-3">
            <Button
              size="sm"
              onClick={() =>
                omzetten({}, {
                  onSuccess: (resultaat: any) =>
                    setMelding(
                      `Omgezet naar een team. Alle ${resultaat.takenAantal} taken zijn bewaard.`,
                    ),
                  onError: (error) =>
                    setFoutmelding(
                      userFacingActionError(
                        error,
                        "De omzetting is niet gelukt.",
                      ),
                    ),
                })
              }
              disabled={omzettenBezig}
              data-testid="omzetten-naar-team"
            >
              {omzettenBezig ? "Bezig..." : "Omzetten naar team"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Zonder dataverlies: taken, projecten, klanten, agents en skills
              blijven staan.
            </p>
          </div>
        ) : null}
      </section>

      {/* Leden en rollen */}
      <section className="mb-8 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Rollen</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {LAATSTE_BEHEERDER_MELDING}
        </p>
        <ul className="space-y-1" data-testid="leden-lijst">
          {((leden as { members: { email: string; role: string }[] } | undefined)
            ?.members ?? []
          ).map((lid) => (
            <li key={lid.email} className="flex items-center gap-2 text-sm">
              <span>{lid.email}</span>
              <span
                className="rounded-full border px-2 py-0.5 text-xs"
                data-testid={`rol-${lid.email}`}
              >
                {ROL_LABELS[lid.role] ?? lid.role}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Rollen wijzig je in de{" "}
          <Link to="/settings/organization" className="underline">
            instellingen
          </Link>
          . Het framework weigert het demoten of verwijderen van de eigenaar,
          zodat er altijd minstens één beheerder overblijft.
        </p>
      </section>

      {/* Uitnodigingen */}
      <section className="mb-8 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Uitnodigingen</h2>
        <h3 className="text-sm font-medium">Openstaande uitnodigingen</h3>
        <ul className="mb-3 space-y-1 text-sm" data-testid="openstaande-uitnodigingen">
          {(uitnodigingen?.invitations ?? []).length === 0 ? (
            <li className="text-muted-foreground">Geen openstaande uitnodigingen.</li>
          ) : (
            (uitnodigingen?.invitations ?? []).map((uitnodiging: any) => (
              <li key={uitnodiging.id}>
                {uitnodiging.email} · {ROL_LABELS[uitnodiging.role] ?? uitnodiging.role}
              </li>
            ))
          )}
        </ul>
        <h3 className="text-sm font-medium">Uitnodigingslinks</h3>
        {linkLijst.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nog geen links. Maak er een op een taakpagina.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {linkLijst.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-center gap-2"
                data-testid={`uitnodigingslink-${link.state}`}
              >
                <span>{link.taskTitle ?? "Taak"}</span>
                {link.invitedEmail ? (
                  <span className="text-muted-foreground">
                    voor {link.invitedEmail}
                  </span>
                ) : null}
                <span className="rounded-full border px-2 py-0.5 text-xs">
                  {link.state}
                </span>
                {link.state === "geldig" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      revoke(
                        { inviteId: link.id },
                        {
                          onError: (error) =>
                            setFoutmelding(
                              userFacingActionError(
                                error,
                                "De link kon niet ingetrokken worden.",
                              ),
                            ),
                        },
                      )
                    }
                  >
                    Intrekken
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Klanten */}
      <section className="mb-8 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Klanten</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Optioneel: een project staat direct onder de organisatie of onder een
          klant.
        </p>
        <form
          className="mb-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!nieuweKlant.trim()) return;
            maakKlant(
              { naam: nieuweKlant.trim() },
              {
                onSuccess: () => setNieuweKlant(""),
                onError: (error) =>
                  setFoutmelding(
                    userFacingActionError(error, "De klant kon niet aangemaakt worden."),
                  ),
              },
            );
          }}
        >
          <div>
            <Label htmlFor="nieuwe-klant">Nieuwe klant</Label>
            <Input
              id="nieuwe-klant"
              value={nieuweKlant}
              onChange={(e) => setNieuweKlant(e.target.value)}
              placeholder="Bijv. Acme BV"
              data-testid="nieuwe-klant"
            />
          </div>
          <Button type="submit" disabled={klantBezig} data-testid="klant-toevoegen">
            Toevoegen
          </Button>
        </form>
        <ul className="space-y-1 text-sm" data-testid="klanten-lijst">
          {((klanten as { klanten: { id: string; name: string; archived: boolean }[] } | undefined)
            ?.klanten ?? []
          ).map((klant) => (
            <li key={klant.id} className="flex items-center gap-2">
              <span data-testid={`klant-${klant.name}`}>
                {klant.name}
                {klant.archived ? " (gearchiveerd)" : ""}
              </span>
              {!klant.archived ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => archiveerKlant({ id: klant.id })}
                >
                  Archiveren
                </Button>
              ) : null}
            </li>
          ))}
          {((klanten as any)?.klanten ?? []).length === 0 ? (
            <li className="text-muted-foreground">Nog geen klanten.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
