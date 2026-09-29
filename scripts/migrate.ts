import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runDrizzleMigrations } from "@agent-native/core/db/drizzle-migrations";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    // The journal table name must not collide with a framework-owned
    // "<name>_migrations" table. The production database already had
    // `agent_office_migrations` with a single `version bigint` column and one
    // row (`1`), written by the framework. Drizzle read that row as "migration
    // 1 is applied", skipped `0000_cold_kylun.sql` — which is what creates
    // `work_documents` — and then `0001_gray_the_fury.sql` failed with
    // `relation "work_documents" does not exist`. So the app never had its own
    // schema in production at all. Keep this name distinct.
    const migrationPlugin = runDrizzleMigrations("./server/db/migrations", {
      table: "agent_office_app_migrations",
    });
    await migrationPlugin({} as any);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
