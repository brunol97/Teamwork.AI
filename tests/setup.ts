import { withMigrationRuntime } from "@agent-native/core/db";
import { runDrizzleMigrations } from "@agent-native/core/db/drizzle-migrations";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

// Every test file runs this setup, and Vitest runs files in parallel. Sharing one
// PGlite directory between them made concurrent setups race: the framework's
// DDL guard probes `pg_indexes` for an existing object, and a probe against a
// directory another process is already migrating throws instead of returning
// false. The guard fails closed on that and aborts with
//   ensureSchemaObject: could not probe required schema "table ..."; refusing to issue DDL
// which failed the whole suite on a fresh CI checkout. Give each worker its own
// database directory so no two processes open the same embedded database.
const worker = process.env.VITEST_WORKER_ID ?? "1";
process.env.DATABASE_URL = `pglite:./data/pglite-test-${worker}`;

await withMigrationRuntime(async () => {
  await runFrameworkReleaseMigrations(null);
  const migrationPlugin = runDrizzleMigrations("./server/db/migrations", {
    table: "agent_office_app_migrations",
  });
  await migrationPlugin({} as any);
});
