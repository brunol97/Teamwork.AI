# Deploy flow

This document describes how code reaches users, and how environments stay isolated.

## Overview

- **Vercel Git integration** builds and hosts the app.
- A pull request → **Preview** deployment.
- A merge to `main` → **Production** deployment, aliased to the production domain.
- GitHub Actions (`pr-ci.yml`) gates every PR with typecheck, tests and a build; it also runs on pushes to `main` so the merge commit itself is tested.

## Migrations

- Migration logic lives in `scripts/app-migrations.ts` and is shared by the CLI (`pnpm migrate`) and the deploy guard (`scripts/migrate-on-deploy.ts`).
- `pnpm build` runs `scripts/migrate-on-deploy.ts` first:
  - `VERCEL_ENV=production` → migrations are applied.
  - `VERCEL_ENV=preview` → migrations are **skipped**, with a line in the build log.
  - unset (local/CI) → migrations are applied.
- Rationale: previews must never mutate a database. A preview that runs migrations can touch production data and a branch with a broken migration can damage every other branch.
- `pnpm migrate:production` (`scripts/migrate-production.ts`) applies only framework release migrations and is kept for manual production maintenance.

## Database separation (production vs preview)

Production and preview must use **different Supabase projects**. Check the current state by comparing the `urlHash` logged at boot, or by inspecting `DATABASE_URL` per environment in Vercel.

Required setup (Vercel dashboard → project Settings → Environment Variables, or `vercel env add`):

| Variable | Production | Preview |
| --- | --- | --- |
| `DATABASE_URL` | connection string of the **production** Supabase project | connection string of the **dev/preview** Supabase project |

For Vercel serverless, use the Supabase **transaction pooler** connection string (port `6543`). Do not set `runtime.databasePoolMax` or `AGENT_NATIVE_DB_POOL_MAX`; see DEVELOPING.md.

Until this separation is in place, the migration skip on preview is the only thing preventing preview deploys from mutating shared data — do not treat it as a substitute for separate databases.

## Branch protection

Branch protection / rulesets should require the `ci` and `e2e` checks to pass before merging to `main`. Configure in GitHub → Settings → Rules → Rulesets.

## Production smoke test

After a production deploy, verify:

```bash
curl https://agent-office-woad.vercel.app/_agent-native/health
```

Expected: `{"ok":true,"ready":true,"db":true}`.
