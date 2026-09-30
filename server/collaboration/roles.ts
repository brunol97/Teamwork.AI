import { orgMembers, type OrgRole } from "@agent-native/core/org";

/**
 * Rollen binnen een organisatie, in de taal van de gebruiker. De ledenlijst is
 * van het framework; deze app leest hem (`org_members`) en schrijft hem nooit.
 *
 * De bescherming van de laatste beheerder zit in het framework zelf: een
 * organisatie heeft precies één eigenaar, en de framework-handlers weigeren het
 * demoten of verwijderen van die eigenaar (`changeMemberRoleHandler` geeft 400
 * "Cannot change the organization owner's role", `removeMemberHandler` geeft
 * 403 "Cannot remove the organization owner"). De app heeft geen eigen
 * rol-mutatie of verlaat-oppervlak, dus de bescherming geldt op elk pad dat de
 * app biedt. De helper hieronder maakt die invariant zichtbaar in de UI en
 * testbaar in de unit-tests, voor het moment dat er een eigen oppervlak bijkomt.
 */

export type RolInNederlands = "eigenaar" | "beheerder" | "lid";

export function rolInNederlands(role: string): RolInNederlands {
  if (role === "owner") return "eigenaar";
  if (role === "admin") return "beheerder";
  return "lid";
}

/** Een eigenaar of beheerder mag uitnodigen en beheren; een lid niet. */
export function isBeheerderRol(role: string): boolean {
  return role === "owner" || role === "admin";
}

export interface LidMetRol {
  email: string;
  role: string;
}

/**
 * Is deze persoon de laatste beheerder die niet mag vertrekken of zijn rol
 * verliezen? Dat is de eigenaar: er is er altijd precies één, en het framework
 * laat zijn rol nooit afnemen of zijn lidmaatschap nooit verwijderen. Een
 * beheerder (admin) kan door de eigenaar gedemoteerd worden, zolang de
 * eigenaar overblijft; de organisatie houdt daarmee altijd minstens één
 * beheerder over.
 */
export function isLaatsteBeheerder(
  members: LidMetRol[],
  email: string,
): boolean {
  const normaal = email.trim().toLowerCase();
  return members.some(
    (m) => m.email.trim().toLowerCase() === normaal && m.role === "owner",
  );
}

/**
 * De bescherming in één zin, voor de Rollen-pagina: de laatste beheerder kan
 * niet vertrekken of zijn rol verliezen, dus er is altijd minstens één
 * beheerder.
 */
export function laatsteBeheerderMelding(): string {
  return "De laatste beheerder kan niet vertrekken of zijn rol verliezen. Er is altijd minstens één beheerder.";
}

/** Type uit het framework opnieuw geëxporteerd, zodat aanroepers hem niet zelf hoeven te importeren. */
export type { OrgRole };
