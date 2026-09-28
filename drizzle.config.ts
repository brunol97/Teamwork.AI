import { createDrizzleConfig } from "@agent-native/core/db/drizzle-config";

export default createDrizzleConfig({
  schema: "./server/db/schema.ts",
  out: "./server/db/migrations",
});
