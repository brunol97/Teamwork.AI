import { createOrganization } from "@agent-native/core/org";
import { describe, expect, it } from "vitest";

import {
  AlreadyATeamError,
  convertPersonalToTeam,
  getOrgKind,
  setOrgKind,
} from "../../server/org/store.js";

const BEHEERDER = "beheerder@orgsoort.test";

describe("soort van de organisatie", () => {
  it("geeft zonder rij een persoonlijke werkruimte terug", async () => {
    const org = await createOrganization(`Soort ${Date.now()}`, BEHEERDER);
    expect(await getOrgKind(org.id)).toEqual({
      organizationId: org.id,
      isPersonal: true,
    });
  });

  it("zet de soort en leest hem terug", async () => {
    const org = await createOrganization(`Soort team ${Date.now()}`, BEHEERDER);
    await setOrgKind(org.id, false);
    expect((await getOrgKind(org.id)).isPersonal).toBe(false);
    await setOrgKind(org.id, true);
    expect((await getOrgKind(org.id)).isPersonal).toBe(true);
  });

  it("zet een persoonlijke werkruimte om naar een team", async () => {
    const org = await createOrganization(`Omzetten ${Date.now()}`, BEHEERDER);
    expect((await getOrgKind(org.id)).isPersonal).toBe(true);

    const omgezet = await convertPersonalToTeam(org.id);
    expect(omgezet.isPersonal).toBe(false);
    expect((await getOrgKind(org.id)).isPersonal).toBe(false);
  });

  it("weigert een tweede omzetting", async () => {
    const org = await createOrganization(`Tweede keer ${Date.now()}`, BEHEERDER);
    await convertPersonalToTeam(org.id);

    await expect(convertPersonalToTeam(org.id)).rejects.toBeInstanceOf(
      AlreadyATeamError,
    );
  });
});
