import { loadEnv } from "@agent-native/core/scripts";

import { runAppMigrations } from "../server/db/app-migrations.js";

loadEnv();

await runAppMigrations();
