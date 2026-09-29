import { actionErrorMessage } from "@agent-native/core/client/hooks";

/**
 * Geeft de Nederlandse, door de auteur bedoelde foutmelding van een action terug
 * en logt de technische fout op de console. `error.message` bevat intern
 * detail (`Action x failed: ...`) en hoort niet in de interface.
 */
export function userFacingActionError(
  error: unknown,
  fallback: string,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("actie mislukt:", error);

  return actionErrorMessage(error) ?? fallback;
}
