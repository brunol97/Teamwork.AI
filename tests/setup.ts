import { withMigrationRuntime } from "@agent-native/core/db";
import { runDrizzleMigrations } from "@agent-native/core/db/drizzle-migrations";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

process.env.DATABASE_URL = "pglite:./data/pglite-test";

await withMigrationRuntime(async () => {
  await runFrameworkReleaseMigrations(null);
  const migrationPlugin = runDrizzleMigrations("./server/db/migrations", {
    table: "agent_office_migrations",
  });
  await migrationPlugin({} as any);
});
