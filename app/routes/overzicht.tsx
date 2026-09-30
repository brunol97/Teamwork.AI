import { useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function meta() {
  return [{ title: "Overzicht - Agent Office" }];
}

type Overzicht = {
  aangeroepenDoor: string;
  projecten: {
    projectId: string;
    projectName: string;
    klantId: string | null;
    klantNaam: string | null;
    tellingen: Record<string, number>;
    totaal: number;
  }[];
  taken: {
    id: string;
    title: string;
    status: string;
    projectId: string;
    projectName: string;
    leadId: string;
    wachtOpMij: boolean;
    wachtOpIemand: boolean;
  }[];
  wachtOpMijAantal: number;
};

type Filter = "alles" | "wacht-op-mij" | "mijn-taken";

const STATUS_LABELS: Record<string, string> = {
  "bezig": "Bezig",
  "wacht op iemand": "Wacht op iemand",
  "gepauzeerd": "Gepauzeerd",
  "klaar": "Klaar",
};

const STATUS_VOLGORDE = ["bezig", "wacht op iemand", "gepauzeerd", "klaar"];

/**
 * Het overzicht (AC2): per project het aantal taken per status, met de filters
 * "alles", "wacht op mij" (alleen taken met een open vraag van de agent aan
 * jou), "mijn taken" (taken waar jij de lead bent) en een filter op klant of
 * project. De tellingen komen van get-overzicht; het filteren gebeurt hierop,
 * zodat "wacht op mij" exact de taken toont die get-overzicht als zodanig
 * markeert.
 */
export default function OverzichtRoute() {
  const { data, isLoading } = useActionQuery("get-overzicht", {});
  const [filter, setFilter] = useState<Filter>("alles");
  const [klantFilter, setKlantFilter] = useState("alles");
  const [projectFilter, setProjectFilter] = useState("alles");
  const [zoek, setZoek] = useState("");

  const overzicht = data as Overzicht | undefined;

  const klanten = new Map<string, string>();
  for (const project of overzicht?.projecten ?? []) {
    if (project.klantId && project.klantNaam) {
      klanten.set(project.klantId, project.klantNaam);
    }
  }

  const gefilterdeProjecten = (overzicht?.projecten ?? []).filter(
    (project) =>
      (klantFilter === "alles" || project.klantId === klantFilter) &&
      (projectFilter === "alles" || project.projectId === projectFilter),
  );

  const projectIds = new Set(gefilterdeProjecten.map((p) => p.projectId));
  const ikEmail = overzicht?.aangeroepenDoor ?? "";
  const gefilterdeTaken = (overzicht?.taken ?? []).filter((taak) => {
    if (!projectIds.has(taak.projectId)) return false;
    if (filter === "wacht-op-mij" && !taak.wachtOpMij) return false;
    if (filter === "mijn-taken" && taak.leadId !== ikEmail) {
      return false;
    }
    if (zoek.trim() && !taak.title.toLowerCase().includes(zoek.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Overzicht</h1>
        <span className="text-sm text-muted-foreground">
          <Link to="/tasks" className="underline" data-testid="naar-taken">
            Taken
          </Link>{" "}
          ·{" "}
          <Link to="/organisatie" className="underline" data-testid="naar-organisatie">
            Organisatie
          </Link>{" "}
          ·{" "}
          <Link to="/onboarding" className="underline" data-testid="naar-onboarding">
            Onboarding
          </Link>
        </span>
      </div>

      {isLoading ? (
        <p>Overzicht laden...</p>
      ) : !overzicht ? (
        <p className="text-muted-foreground">Geen overzicht beschikbaar.</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={filter === "alles" ? "default" : "outline"}
              onClick={() => setFilter("alles")}
              data-testid="filter-alles"
            >
              Alles
            </Button>
            <Button
              size="sm"
              variant={filter === "wacht-op-mij" ? "default" : "outline"}
              onClick={() => setFilter("wacht-op-mij")}
              data-testid="filter-wacht-op-mij"
            >
              Wacht op mij ({overzicht.wachtOpMijAantal})
            </Button>
            <Button
              size="sm"
              variant={filter === "mijn-taken" ? "default" : "outline"}
              onClick={() => setFilter("mijn-taken")}
              data-testid="filter-mijn-taken"
            >
              Mijn taken
            </Button>

            <select
              className="ml-auto h-9 rounded-md border bg-background px-3 text-sm"
              value={klantFilter}
              onChange={(e) => setKlantFilter(e.target.value)}
              data-testid="filter-klant"
              aria-label="Filter op klant"
            >
              <option value="alles">Alle klanten</option>
              {[...klanten.entries()].map(([id, naam]) => (
                <option key={id} value={id}>
                  {naam}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              data-testid="filter-project"
              aria-label="Filter op project"
            >
              <option value="alles">Alle projecten</option>
              {overzicht.projecten.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectName}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-2">
            {gefilterdeProjecten.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Geen projecten binnen dit filter.
              </p>
            ) : (
              gefilterdeProjecten.map((project) => (
                <div
                  key={project.projectId}
                  className="rounded-lg border p-4"
                  data-testid={`project-kaart-${project.projectName}`}
                >
                  <div className="font-medium">{project.projectName}</div>
                  {project.klantNaam ? (
                    <div className="text-sm text-muted-foreground">
                      Klant: {project.klantNaam}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {STATUS_VOLGORDE.map((status) => (
                      <span
                        key={status}
                        className="rounded-full border px-2 py-0.5"
                        data-testid={`telling-${project.projectId}-${status}`}
                      >
                        {STATUS_LABELS[status]}: {project.tellingen[status] ?? 0}
                      </span>
                    ))}
                    <span className="rounded-full border px-2 py-0.5 font-medium">
                      Totaal: {project.totaal}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <h2 className="mb-3 text-lg font-semibold">Taken</h2>
          <div className="mb-4">
            <Input
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
              placeholder="Zoek in taken..."
              data-testid="taak-zoek"
            />
          </div>
          {gefilterdeTaken.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Geen taken binnen dit filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {gefilterdeTaken.map((taak) => (
                <li key={taak.id}>
                  <Link
                    to={`/tasks/${encodeURIComponent(taak.id)}`}
                    className="block rounded-md border p-4 hover:bg-accent"
                    data-testid={`overzicht-taak-${taak.id}`}
                  >
                    <div className="font-medium">{taak.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {taak.projectName} · {STATUS_LABELS[taak.status] ?? taak.status}
                      {taak.wachtOpMij ? " · wacht op mij" : ""}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
