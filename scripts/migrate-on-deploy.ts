import { loadEnv } from "@agent-native/core/scripts";

loadEnv();

// Previews must never mutate the database: they share infrastructure with
// other branches and (until separate databases per environment are wired up)
// can touch production data. Only production deploys and local runs apply
// migrations.
const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv === "preview") {
  console.log(
    "[migrate] VERCEL_ENV=preview — skipping database migrations (previews must not mutate the database)",
  );
  process.exit(0);
}

const { runAppMigrations } = await import("../server/db/app-migrations.js");

await runAppMigrations();
