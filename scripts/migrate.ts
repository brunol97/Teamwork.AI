import { loadEnv } from "@agent-native/core/scripts";

import { runAppMigrations } from "./app-migrations";

loadEnv();

await runAppMigrations();
