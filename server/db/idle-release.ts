/**
 * postgres-js sluit een ongebruikte verbinding na `idle_timeout`. Het framework
 * zet die op 20s op serverless, en de app kan hem niet wijzigen.
 */
const POOL_IDLE_TIMEOUT_MS = 20_000;
/** Ruimte voor de timer van postgres-js en het sluiten van de socket. */
const RELEASE_MARGIN_MS = 2_000;
export const IDLE_RELEASE_MS = POOL_IDLE_TIMEOUT_MS + RELEASE_MARGIN_MS;

type WaitUntil = (promise: Promise<unknown>) => void;

let pending:
  | { timer: ReturnType<typeof setTimeout>; release: () => void }
  | undefined;

/**
 * Houdt de Vercel-instantie wakker tot postgres-js zijn ongebruikte verbindingen
 * heeft gesloten.
 *
 * Vercel bevriest een instantie na het antwoord. Tijdens het bevriezen loopt de
 * `idle_timeout`-timer niet, maar de pooler laat de verbinding wel vallen. Het
 * volgende verzoek kreeg dan die dode verbinding: de eerste query hing tot de
 * time-out van 8s van het framework, en pas de herhaling op een nieuwe pool
 * slaagde. Een open tabblad pollt elke minuut, dus bijna elke poll duurde 10s.
 *
 * Elk antwoord vervangt de vorige wachttijd, zoals `attachDatabasePool` van
 * `@vercel/functions` doet. Die functie kent de pool van postgres-js niet.
 */
export function holdUntilPoolIdle(
  waitUntil: WaitUntil | undefined,
  ms = IDLE_RELEASE_MS,
): boolean {
  if (typeof waitUntil !== "function") {
    return false;
  }
  if (pending) {
    clearTimeout(pending.timer);
    pending.release();
  }
  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pending = undefined;
      resolve();
    }, ms);
    pending = { timer, release: resolve };
  });
  waitUntil(promise);
  return true;
}

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

/**
 * `waitUntil` van het verzoek. Het web-entrypoint van Nitro zet hem op
 * `event.req`; anders komt hij uit de request-context van Vercel, net als bij
 * `@vercel/functions`.
 */
export function requestWaitUntil(event: {
  req?: unknown;
}): WaitUntil | undefined {
  const fromRequest = (event.req as { waitUntil?: unknown } | undefined)
    ?.waitUntil;
  if (typeof fromRequest === "function") {
    return fromRequest.bind(event.req) as WaitUntil;
  }
  const store = (
    globalThis as Record<
      symbol,
      { get?: () => { waitUntil?: unknown } } | undefined
    >
  )[VERCEL_REQUEST_CONTEXT];
  const fromContext = store?.get?.()?.waitUntil;
  return typeof fromContext === "function"
    ? (fromContext as WaitUntil)
    : undefined;
}
