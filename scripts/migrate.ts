import { closeDbExec, withMigrationRuntime } from "@agent-native/core/db";
import { runDrizzleMigrations } from "@agent-native/core/db/drizzle-migrations";
import { loadEnv } from "@agent-native/core/scripts";
import { runFrameworkReleaseMigrations } from "@agent-native/core/server";

loadEnv();

async function main(): Promise<void> {
  await withMigrationRuntime(async () => {
    await runFrameworkReleaseMigrations(null);
    const migrationPlugin = runDrizzleMigrations("./server/db/migrations", {
      table: "agent_office_migrations",
    });
    await migrationPlugin({} as any);
  });
}

try {
  await main();
} finally {
  await closeDbExec();
}
