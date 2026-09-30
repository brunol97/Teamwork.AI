import { describe, expect, it } from "vitest";

import {
  isBeheerderRol,
  isLaatsteBeheerder,
  laatsteBeheerderMelding,
  rolInNederlands,
} from "../../server/collaboration/roles.js";

/**
 * AC1: de laatste beheerder kan niet vertrekken of zijn rol verliezen.
 *
 * De bescherming zit in het framework zelf: een organisatie heeft precies één
 * eigenaar en de framework-handlers weigeren demoteren en verwijderen van die
 * eigenaar. De app heeft geen eigen rol-mutatie en schrijft nooit in
 * `org_members`. Deze tests leggen de invariant vast op de plek waar de app
 * hem gebruikt: de Rollen-weergave en de melding erover.
 */
describe("de bescherming van de laatste beheerder", () => {
  const leden = [
    { email: "eigenaar@org.test", role: "owner" },
    { email: "collega@org.test", role: "member" },
  ];

  it("ziet de eigenaar als de beschermd laatste beheerder", () => {
    expect(isLaatsteBeheerder(leden, "eigenaar@org.test")).toBe(true);
    expect(isLaatsteBeheerder(leden, "EIGENAAR@org.test")).toBe(true);
    expect(isLaatsteBeheerder(leden, "collega@org.test")).toBe(false);
    expect(isLaatsteBeheerder(leden, "onbekend@org.test")).toBe(false);
  });

  it("blijft de eigenaar beschermen als er ook een beheerder is", () => {
    const metBeheerder = [...leden, { email: "admin@org.test", role: "admin" }];
    // Ook met een extra beheerder geldt: de eigenaar kan zijn rol nooit
    // verliezen, dus de organisatie houdt altijd minstens één beheerder.
    expect(isLaatsteBeheerder(metBeheerder, "eigenaar@org.test")).toBe(true);
    expect(isLaatsteBeheerder(metBeheerder, "admin@org.test")).toBe(false);
  });

  it("geeft de rollen in het Nederlands weer", () => {
    expect(rolInNederlands("owner")).toBe("eigenaar");
    expect(rolInNederlands("admin")).toBe("beheerder");
    expect(rolInNederlands("member")).toBe("lid");
  });

  it("herkent beheerrollen voor het uitnodigen", () => {
    expect(isBeheerderRol("owner")).toBe(true);
    expect(isBeheerderRol("admin")).toBe(true);
    expect(isBeheerderRol("member")).toBe(false);
  });

  it("formuleert de bescherming in één zin", () => {
    expect(laatsteBeheerderMelding()).toContain("laatste beheerder");
    expect(laatsteBeheerderMelding()).toContain("minstens één beheerder");
  });
});
