import { registerErrorCaptureProvider } from "@agent-native/core/server";

/** Een foutketen is nooit diep; de grens beschermt alleen tegen een kringverwijzing. */
const MAX_CAUSE_DEPTH = 5;

interface DriverCause {
  name: string;
  code?: string;
  message: string;
}

/**
 * De diepste `cause` van een fout. Drizzle verpakt elke databasefout als
 * "Failed query: ..." en zet de fout van de driver (postgres-js, of de
 * time-out van het framework) in `cause`; die draagt de echte code en melding.
 */
export function driverCause(error: unknown): DriverCause | undefined {
  let cause = (error as { cause?: unknown } | null)?.cause;
  if (cause == null) return undefined;
  for (let depth = 1; depth < MAX_CAUSE_DEPTH; depth++) {
    const next = (cause as { cause?: unknown } | null)?.cause;
    if (next == null) break;
    cause = next;
  }

  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return {
      name: cause.name,
      ...(code != null ? { code: String(code) } : {}),
      message: cause.message,
    };
  }
  return { name: typeof cause, message: String(cause) };
}

/**
 * De framework-provider die excepties naar PostHog stuurt, bewaart alleen naam,
 * melding en stack, dus de `cause` gaat verloren. Alle providers krijgen
 * hetzelfde context-object, in de volgorde van registratie. Deze provider moet
 * daarom vóór de framework-provider staan: registreer hem bij het laden van een
 * module, want het framework registreert de zijne pas in de body van zijn plugin.
 */
export function registerDriverCauseCapture(): () => void {
  return registerErrorCaptureProvider("driver-cause", (error, context) => {
    const cause = driverCause(error);
    if (!cause) return;
    // Het framework stuurt `extra` mee als `exceptionExtra`.
    context.extra = {
      ...context.extra,
      cause_name: cause.name,
      ...(cause.code ? { cause_code: cause.code } : {}),
      cause_message: cause.message,
    };
  });
}
