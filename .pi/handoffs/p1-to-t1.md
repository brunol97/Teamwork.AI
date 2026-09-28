# Handoff: P1 → T1

## P1 afgerond
- PR #12 (`p1-agent-native-foundation`) is gemerged naar `main`.
- Productie-URL: https://agent-office-woad.vercel.app
- Magic-link login werkt.

## Belangrijke beslissingen & fixes
- **Supabase pooler**: `DATABASE_URL` gebruikt de session pooler (`aws-0-eu-west-3.pooler.supabase.com:5432`) omdat directe `db.<ref>.supabase.co` vanuit Vercel niet bereikbaar is zonder IPv4-add-on.
- **Connection pool limit**: `databasePoolMax: 10` in `agent-native.config.ts` vanwege Supabase pooler limiet van 15 sessies.
- **Migraties**: build script draait `tsx scripts/migrate.ts` voor `agent-native build`.
- **Better Auth + Resend**: magic links via `onboarding@resend.dev`.

## T1 scope
Issue #3 — Eén taak met één agent.

### Acceptatiecriteria
1. Nieuw e-mailadres → magic link → persoonlijke werkruimte (organisatie met 1 lid).
2. Project maken → taak maken → gebruiker is lead → status "bezig".
3. Taak openen → bericht sturen → agent (Ollama) antwoordt → beide berichten in activiteitenlog.
4. Gebruiker van andere organisatie kan de taak niet zien.
5. Tests: Vitest unit-tests + minstens 1 Playwright E2E-test.

### Aanbevolen branch
`t1-single-task-single-agent` vanaf `main`.

### Startpunt code
- Domeinschema: `server/db/schema.ts`
- Taak-creatie action: `actions/create-task.ts`
- Auth plugin: `server/plugins/auth.ts`
- Tests: `tests/create-task.test.ts`, `e2e/p1.spec.ts`
