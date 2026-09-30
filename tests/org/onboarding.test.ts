import { createOrganization } from "@agent-native/core/org";
import { describe, expect, it } from "vitest";

import createInviteLinkAction from "../../actions/create-invite-link.js";
import createOrganisatieAction from "../../actions/create-organisatie.js";
import convertToTeamAction from "../../actions/convert-to-team.js";
import listAlleInviteLinksAction from "../../actions/list-alle-invite-links.js";
import listMijnOrganisatiesAction from "../../actions/list-mijn-organisaties.js";
import switchOrganisatieAction from "../../actions/switch-organisatie.js";
import { createTask } from "../../server/tasks/store.js";

/**
 * AC-gerichte tests voor onboarding, meerdere organisaties en beheer. De
 * organisaties en lidmaatschappen ontstaan via het framework zelf
 * (`createOrganization`, uitnodigingslinks); de app schrijft nooit in
 * `org_members`.
 */
const BEHEERDER = "beheerder@onboarding.test";

const ctxVoor = (orgId: string | undefined, userEmail: string) =>
  ({ caller: "frontend", userEmail, orgId }) as any;

describe("onboarding: drie keuzes", () => {
  it("maakt een persoonlijke werkruimte aan en maakt hem actief", async () => {
    const resultaat = await createOrganisatieAction.run(
      { soort: "persoonlijk" },
      ctxVoor(undefined, BEHEERDER),
    );

    expect(resultaat.soort).toBe("persoonlijk");
    expect(resultaat.organizationId).toBeTruthy();

    // De nieuwe organisatie is meteen de actieve.
    const lijst = await listMijnOrganisatiesAction.run(
      {},
      ctxVoor(resultaat.organizationId, BEHEERDER),
    );
    const nieuwe = lijst.organisaties.find(
      (o: any) => o.organizationId === resultaat.organizationId,
    );
    expect(nieuwe?.soort).toBe("persoonlijk");
    expect(lijst.actieveOrganisatieId).toBe(resultaat.organizationId);
  });

  it("maakt een team aan als aparte keuze", async () => {
    const resultaat = await createOrganisatieAction.run(
      { soort: "team", naam: "Ons team" },
      ctxVoor(undefined, BEHEERDER),
    );

    expect(resultaat.soort).toBe("team");
    expect(resultaat.naam).toBe("Ons team");
  });

  it("weigert een organisatie aan te maken zonder aanmelding", async () => {
    await expect(
      createOrganisatieAction.run({ soort: "team" }, ctxVoor(undefined, "")),
    ).rejects.toMatchObject({ errorCode: "unauthenticated" });
  });
});

describe("lid zijn van meerdere organisaties", () => {
  it("toont alle lidmaatschappen met hun soort", async () => {
    const persoonlijk = await createOrganisatieAction.run(
      { soort: "persoonlijk" },
      ctxVoor(undefined, BEHEERDER),
    );
    const team = await createOrganisatieAction.run(
      { soort: "team", naam: "Tweede team" },
      ctxVoor(persoonlijk.organizationId, BEHEERDER),
    );

    const lijst = await listMijnOrganisatiesAction.run(
      {},
      ctxVoor(team.organizationId, BEHEERDER),
    );
    const soorten = Object.fromEntries(
      lijst.organisaties.map((o: any) => [o.organizationId, o.soort]),
    );
    expect(soorten[persoonlijk.organizationId]).toBe("persoonlijk");
    expect(soorten[team.organizationId]).toBe("team");
    expect(lijst.organisaties.every((o: any) => o.rol === "owner")).toBe(true);
  });

  it("wisselt alleen naar een organisatie waar de aanroeper lid van is", async () => {
    const eigen = await createOrganisatieAction.run(
      { soort: "persoonlijk" },
      ctxVoor(undefined, BEHEERDER),
    );
    // Een organisatie waar de aanroeper geen lid van is.
    const vreemd = await createOrganization(
      `Vreemd ${Date.now()}`,
      "iemand-anders@vreemd.test",
    );

    await expect(
      switchOrganisatieAction.run(
        { orgId: vreemd.id },
        ctxVoor(eigen.organizationId, BEHEERDER),
      ),
    ).rejects.toMatchObject({ errorCode: "not_a_member" });

    // Wisselen naar de eigen organisatie lukt en maakt hem actief.
    const gewisseld = await switchOrganisatieAction.run(
      { orgId: eigen.organizationId },
      ctxVoor(vreemd.id, BEHEERDER),
    );
    expect(gewisseld.organizationId).toBe(eigen.organizationId);
    expect(gewisseld.soort).toBe("persoonlijk");
  });
});

describe("persoonlijke werkruimte omzetten naar een team", () => {
  it("behoudt alle taken en weigert een tweede omzetting", async () => {
    const org = await createOrganisatieAction.run(
      { soort: "persoonlijk" },
      ctxVoor(undefined, BEHEERDER),
    );
    const orgId = org.organizationId;

    const omgezet = await convertToTeamAction.run({}, ctxVoor(orgId, BEHEERDER));
    expect(omgezet.soort).toBe("team");
    expect(omgezet.takenAantal).toBe(0);

    await expect(
      convertToTeamAction.run({}, ctxVoor(orgId, BEHEERDER)),
    ).rejects.toMatchObject({ errorCode: "already_a_team" });
  });
});

describe("beheer van uitnodigingslinks", () => {
  it("somt de links van de hele organisatie op en markeert de toestand", async () => {
    const org = await createOrganisatieAction.run(
      { soort: "team", naam: "Linken team" },
      ctxVoor(undefined, BEHEERDER),
    );
    const orgId = org.organizationId;

    // Twee taken, elk met een eigen link; de eerste is verlopen.
    const taakEen = await createTask({
      orgId,
      leadId: BEHEERDER,
      projectName: "Project",
      taskTitle: "Eerste",
    });
    const taakTwee = await createTask({
      orgId,
      leadId: BEHEERDER,
      projectName: "Project",
      taskTitle: "Tweede",
    });
    const linkEen = await createInviteLinkAction.run(
      { taskId: taakEen.id, expiresInHours: 0 },
      ctxVoor(orgId, BEHEERDER),
    );
    await createInviteLinkAction.run(
      { taskId: taakTwee.id },
      ctxVoor(orgId, BEHEERDER),
    );

    const { links } = await listAlleInviteLinksAction.run(
      {},
      ctxVoor(orgId, BEHEERDER),
    );
    expect(links).toHaveLength(2);
    const toestanden = Object.fromEntries(
      links.map((l: any) => [l.taskId, l.state]),
    );
    expect(toestanden[taakEen.id]).toBe("verlopen");
    expect(toestanden[taakTwee.id]).toBe("geldig");
    expect(links.every((l: any) => l.taskTitle)).toBe(true);
  });

  it("toont de links alleen aan een beheerder", async () => {
    const org = await createOrganisatieAction.run(
      { soort: "team", naam: "Alleen beheerder" },
      ctxVoor(undefined, BEHEERDER),
    );
    await expect(
      listAlleInviteLinksAction.run(
        {},
        ctxVoor(org.organizationId, "gewoon-lid@onboarding.test"),
      ),
    ).rejects.toMatchObject({ errorCode: "forbidden" });
  });
});
