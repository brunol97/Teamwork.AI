import { loadEnv } from "@agent-native/core/scripts";

import { closeMigrationConnection, runAppMigrations } from "./app-migrations";

loadEnv();

try {
  await runAppMigrations();
} finally {
  await closeMigrationConnection();
}
