import { APIError, createAuthMiddleware } from "better-auth/api";

import { isEmailAllowed } from "./allowlist.js";

/**
 * Better-auth-plugin die aanmelden weigert voor e-mailadressen die niet op de
 * allowlist staan (zie ./allowlist.ts). De hook grijpt vóór de endpoint, dus
 * voor een geweigerd adres wordt geen magic-link verstuurd en geen account
 * aangemaakt.
 *
 * Bestaande sessies van niet-toegestane adressen vangt de middleware in
 * `server/middleware/auth.ts` af; de magic-link-verificatielink bevat het
 * adres niet in het verzoek en kan hier niet gelezen worden.
 */

const SIGN_IN_PATH_PREFIXES = ["/sign-in", "/sign-up"];

export function matchesSignInSection(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  return SIGN_IN_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function emailFromSignInSection(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

export const emailAllowlistPlugin = {
  id: "email-allowlist",
  hooks: {
    before: [
      {
        matcher: (context: { path?: string }) =>
          matchesSignInSection(context?.path),
        handler: createAuthMiddleware(async (context: { body?: unknown }) => {
          const email = emailFromSignInSection(context?.body);
          if (email !== undefined && !isEmailAllowed(email)) {
            throw new APIError("FORBIDDEN", {
              message:
                "Aanmelden is voorlopig beperkt tot toegestane accounts.",
            });
          }
        }),
      },
    ],
  },
};
