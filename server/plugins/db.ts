import { runDrizzleMigrations } from "@agent-native/core/db/drizzle-migrations";
import { defineNitroPlugin } from "@agent-native/core/server";

export default defineNitroPlugin(async () => {
  await runDrizzleMigrations("./server/db/migrations", {
    table: "agent_office_app_migrations",
  });
});
