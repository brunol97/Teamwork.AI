/**
 * Migraties draaien niet meer in elke preview-build.
 *
 * Waarom: `pnpm build` draaide `tsx scripts/migrate.ts`, dus ELKE preview-deploy
 * muteerde de database van die omgeving. Omdat productie en preview nu nog één
 * database delen, betekende dat dat een preview de productiedata aanraakte.
 *
 *   - lokaal ontwikkelen → migraties draaien, zoals voorheen
 *   - productie-deploy   → migraties draaien, zodat het schema bij de code hoort
 *   - preview-deploy     → migraties worden OVERGESLAGEN
 *
 * De definitieve oplossing is een migratiestap buiten de build, in een release
 * job, plus een aparte database per omgeving. Zie docs/deploy-flow.md.
 */
import { loadEnv } from "@agent-native/core/scripts";

import { closeMigrationConnection, runAppMigrations } from "./app-migrations";

const environment = process.env.VERCEL_ENV;
const isProduction = environment === "production";
const isLocal = !environment;

if (!isProduction && !isLocal) {
  console.log(
    `[migrate] VERCEL_ENV=${environment}: migraties overgeslagen — een preview mag ` +
      "de database niet muteren.",
  );
  process.exit(0);
}

console.log(`[migrate] VERCEL_ENV=${environment ?? "lokaal"}: migraties worden toegepast.`);

loadEnv();

try {
  await runAppMigrations();
} finally {
  await closeMigrationConnection();
}
