import { loadEnv } from "@agent-native/core/scripts";

loadEnv();

// Previews must never mutate the database: they share infrastructure with
// other branches and (until separate databases per environment are wired up)
// can touch production data. Only production deploys and local runs apply
// migrations.
const vercelEnv = process.env.VERCEL_ENV;

// Warn when a serverless deploy is pointed at a connection shape that caused
// the EMAXCONNSESSION outage of 29 Sep 2026: the Supabase session pooler caps
// clients at 15 in total, so a few warm instances can exhaust them for every
// other instance. See DEVELOPING.md ("Database & Environment Variables").
// This is a loud warning, not a hard failure, so hotfixes are never blocked.
function warnDatabaseUrlShape(databaseUrl: string | undefined): void {
  if (!databaseUrl) return;

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return;
  }

  const host = url.hostname;
  const isPooler = host.includes(".pooler.supabase.");
  const isSupabase = isPooler || host.endsWith(".supabase.co") || host.endsWith(".supabase.com");
  if (!isSupabase) return;

  const banner = "[deploy-guard] ----------------------------------------";
  if (isPooler && url.port !== "6543") {
    console.warn(
      banner,
      "\n[deploy-guard] DATABASE_URL uses a Supabase POOLER host on a port that is not 6543.",
      "\n[deploy-guard] On Vercel serverless this must be the transaction pooler (port 6543).",
      "\n[deploy-guard] The session pooler (5432) allows 15 clients in total; a few warm instances can",
      "\n[deploy-guard] exhaust them and every query then fails with EMAXCONNSESSION.",
      "\n" + banner,
    );
  } else if (!isPooler && (url.port === "5432" || url.port === "")) {
    console.warn(
      banner,
      "\n[deploy-guard] DATABASE_URL uses a direct Supabase database host.",
      "\n[deploy-guard] On Vercel serverless prefer the transaction pooler (port 6543 on the pooler host),",
      "\n[deploy-guard] so instances share a small set of server connections instead of opening their own.",
      "\n" + banner,
    );
  }

  if (process.env.AGENT_NATIVE_DB_POOL_MAX) {
    console.warn(
      banner,
      "\n[deploy-guard] AGENT_NATIVE_DB_POOL_MAX is set. Do not set it: the limit applies per Vercel instance,",
      "\n[deploy-guard] and the framework serverless default of 2 is what keeps the pooler client cap safe.",
      "\n" + banner,
    );
  }
}

if (vercelEnv === "production" || vercelEnv === "preview") {
  warnDatabaseUrlShape(process.env.DATABASE_URL);
}

// The framework's DDL guard turns every unreadable schema probe into
// "could not probe required schema", which hides the real cause (bad
// password, wrong region, rejected startup parameter on the transaction
// pooler). Probe the connection first and report the true error, so a
// failed deploy names its cause instead of masking it.
async function preflightDatabaseConnectivity(): Promise<void> {
  const { getDbExec, closeDbExec, getDatabaseUrl } = await import("@agent-native/core/db");

  // Scrub the password from anything we print.
  let password: string | undefined;
  try {
    password = new URL(getDatabaseUrl()).password;
  } catch {
    // Not a parseable URL — nothing to scrub.
  }
  const scrub = (text: string): string =>
    password && password.length > 0 ? text.split(password).join("<password>") : text;

  const startedAt = Date.now();
  try {
    await getDbExec().execute({ sql: "SELECT 1", args: [] });
    console.log(
      `[deploy-guard] database connectivity ok (${Date.now() - startedAt} ms)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = (error as { cause?: unknown })?.cause;
    const causeMessage =
      cause instanceof Error ? cause.message : typeof cause === "string" ? cause : undefined;
    console.error(
      `[deploy-guard] database connectivity FAILED after ${Date.now() - startedAt} ms:`,
      `\n[deploy-guard]   error: ${scrub(message)}`,
      causeMessage ? `\n[deploy-guard]   cause: ${scrub(causeMessage)}` : "",
      "\n[deploy-guard] Migrations are not started. Check the host (region), port (transaction pooler: 6543), and password.",
    );
    await closeDbExec().catch(() => {});
    process.exit(1);
  }
}

if (vercelEnv === "production") {
  await preflightDatabaseConnectivity();
}

if (vercelEnv === "preview") {
  console.log(
    "[migrate] VERCEL_ENV=preview — skipping database migrations (previews must not mutate the database)",
  );
  process.exit(0);
}

const { runAppMigrations } = await import("../server/db/app-migrations.js");

await runAppMigrations();
