import { getSession, logout, runAuthGuard } from "@agent-native/core/server";
import {
  defineEventHandler,
  getHeader,
  sendRedirect,
  setResponseStatus,
} from "h3";

import { isAuthDisabled, isEmailAllowed } from "../auth/allowlist.js";

/**
 * Sessiecookienamen van het framework: de legacy `an_session*`-cookies en de
 * better-auth-cookies met het `an`-namespace (eventueel met appslug). Alleen
 * als zo'n cookie meekomt kan er een sessie zijn, dus pas dan loont een
 * `getSession`-aanroep. Een false positive kost hooguit één extra
 * sessie-opzoeking; een false negative zou de backstop omzeilen.
 */
const SESSION_COOKIE_NAME =
  /^(__Secure-)?an[_a-z0-9-]*\.(session_token|session_data|dont_remember)$|^an_session/;

function hasSessionCookie(event: Parameters<typeof getHeader>[0]): boolean {
  const header = getHeader(event, "cookie") ?? "";
  if (!header) {
    return false;
  }
  return header.split(";").some((part) => {
    const name = (part.split("=")[0] ?? "").trim();
    return SESSION_COOKIE_NAME.test(name);
  });
}

/**
 * Auth-middleware met een allowlist-backstop (zie ./auth/allowlist.ts).
 *
 * Eerst draait de auth-guard van het framework. Daarna: heeft het verzoek
 * wél sessiecookies maar het adres staat niet op de allowlist, dan wordt de
 * sessie ingetrokken (cookies gewist en serverzijde ingetrokken via logout)
 * en het verzoek geweigerd. Dit vangt elke sessie die de sign-in-hook in
 * `server/auth/email-allowlist-plugin.ts` ontwijkt, zoals een
 * magic-link-verificatie voor een niet-toegestaan adres.
 *
 * Verzoeken zonder sessiecookies betalen geen extra DB-roundtrip: de check
 * begint pas bij aanwezige sessiecookies.
 */
export default defineEventHandler(async (event) => {
  const guard = await runAuthGuard(event);
  if (guard) {
    return guard;
  }

  if (isAuthDisabled()) {
    return;
  }

  if (!hasSessionCookie(event)) {
    return;
  }

  const session = await getSession(event);
  if (!session) {
    return;
  }
  if (isEmailAllowed(session.email)) {
    return;
  }

  await logout(event);
  const path = event.path ?? "/";
  if (path.startsWith("/api/") || path.startsWith("/_agent-native/")) {
    setResponseStatus(event, 401);
    return { error: "Niet toegestaan." };
  }
  if (getHeader(event, "accept")?.includes("text/html")) {
    return sendRedirect(event, "/", 302);
  }
  setResponseStatus(event, 401);
  return { error: "Niet toegestaan." };
});
