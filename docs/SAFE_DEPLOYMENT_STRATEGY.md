# Safe Deployment Strategy

Date: 2026-02-15  
Status: active

## Objective
- Reduce production risk during releases by using staged rollout checks and automated rollback.
- Keep schema migrations backward-compatible for rolling deploy windows.

## Release Path
1. Trigger canary rollout:
   - GitHub Actions workflow: `.github/workflows/safe-rollout.yml`
   - Input target: `canary`
2. Health gate verifies:
   - `GET /health`
   - `GET /matchmaking/queue/config`
   - Optional SLO gate (`GET /ops/slo/summary`) when `SLO_ADMIN_KEY` is configured
3. Promote to production:
   - Re-run workflow with target: `production`
4. If health gate fails:
   - Workflow triggers rollback hook automatically.

## Automatic Rollback
- Rollback trigger secret: `RENDER_ROLLBACK_HOOK_URL`
- Rollback condition:
  - Endpoint checks fail, or
  - critical/warning SLO alert counts exceed deploy thresholds.

Default deploy gate thresholds:
- `DEPLOY_MAX_CRITICAL_ALERTS=0`
- `DEPLOY_MAX_WARNING_ALERTS=1`
- `DEPLOY_HEALTHCHECK_WINDOW_HOURS=1`

## Schema Migration Compatibility
- CI gate: `npm run api:migrations:compat`
- Script: `apps/api/scripts/checkMigrationCompatibility.ts`
- Blocks common breaking operations in migrations:
  - `DROP TABLE`
  - `DROP COLUMN`
  - `TRUNCATE TABLE`
  - `ALTER COLUMN ... TYPE`
  - `ALTER COLUMN ... SET NOT NULL`
- For intentional breaking changes, migration file must include:
  - `-- backward-compatible-exception: <reason>`

## Required GitHub Secrets
- `RENDER_CANARY_DEPLOY_HOOK_URL`
- `RENDER_PRODUCTION_DEPLOY_HOOK_URL`
- `RENDER_ROLLBACK_HOOK_URL`
- `API_CANARY_BASE_URL`
- `API_PRODUCTION_BASE_URL`
- `SLO_ADMIN_KEY` (recommended)
