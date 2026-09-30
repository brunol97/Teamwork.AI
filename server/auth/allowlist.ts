/**
 * Tijdelijke e-mailallowlist voor de auth.
 *
 * Zolang de app besloten draait, mag alleen een lijst toegestane
 * e-mailadressen zich aanmelden en een sessie houden. De lijst komt uit
 * AUTH_ALLOWED_EMAILS (kommagescheiden); zonder die omgevingsvariabele geldt
 * de standaardlijst hieronder. De eigenaar kan de lijst dus per app wijzigen
 * zonder code-aanpassing.
 *
 * Twee verdedigingslijnen gebruiken dit:
 * - `server/auth/email-allowlist-plugin.ts` weigert aanmelden (sign-in/sign-up)
 *   voor een adres dat niet op de lijst staat, zodat er geen e-mail wordt
 *   verstuurd en er geen account ontstaat.
 * - `server/middleware/auth.ts` haalt een bestaande sessie van een niet
 *   toegestaan adres weg (uitgelogd) en weigert het verzoek, zodat ook een
 *   sessie die op een andere manier ontstond niets kan doen.
 */

const DEFAULT_ALLOWED_EMAILS = ["bruno.lenderink@gmail.com"];

/**
 * Alleen-lokale dev-accountjes van het framework (`dev@local.test`, en het
 * oudere `dev@local`). Ze ontstaan alleen via een loopback-verzoek in dev en
 * zijn voor niemand anders bereikbaar, dus ze mogen altijd door.
 */
const DEV_ONLY_EMAILS = ["dev@local", "dev@local.test"];

/**
 * Spiegelt de niet-geëxporteerde `isAuthDisabled` van het framework: bij
 * AUTH_DISABLED draait alles als dev-account en bestaat aanmelden niet meer,
 * dus dan is de allowlist niet van toepassing.
 */
export function isAuthDisabled(): boolean {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function getAllowedEmails(): string[] {
  const raw = process.env.AUTH_ALLOWED_EMAILS?.trim();
  if (!raw) {
    return [...DEFAULT_ALLOWED_EMAILS];
  }
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_EMAILS];
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (isAuthDisabled()) {
    return true;
  }
  if (!email) {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  if (DEV_ONLY_EMAILS.includes(normalized)) {
    return true;
  }
  return getAllowedEmails().includes(normalized);
}
