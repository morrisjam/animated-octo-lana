# Neon Setup Action

## Purpose
Switch the API from local Postgres to Neon without changing game code.

## Action checklist
1. Create a Neon project and copy the connection string.
2. Keep local development on `LOCAL_DATABASE_URL`; place the Neon URL only in the intended hosted provider secret or a short-lived uncommitted release environment file.
3. Run migrations against Neon only for an intentional release rehearsal:
   ```bash
   npm run api:migrate
   ```
4. Start the hosted/canary API and verify `/health` first, then call `/readyz` once for database readiness:
   ```bash
   npm run api:dev
   ```
5. Create one test account and profile through the API, then read it back.
6. Add `DATABASE_URL` as a secret in the deployment platform. Do not expose it to routine local or pull-request test jobs.
7. Keep local Docker Postgres for offline development fallback.
8. Configure the hosting-provider health check path as `/health`, never `/readyz`; continuous database readiness probes prevent Neon from suspending.

## Definition of done
- `api:migrate` succeeds on Neon.
- `GET /profile` and `PUT /profile` work against Neon.
- No code changes are required when swapping `DATABASE_URL`.

## Notes
- Prefer Neon pooled connection strings for serverless runtimes.
- Keep branch environments separate (`dev`, `staging`, `prod`) to avoid data mixing.
- Run `npm run alpha:config-audit -- <uncommitted-provider-env>` locally before deployment; `RENDER_HEALTH_CHECK_PATH=/health` is mandatory audit metadata and must match the actual Render setting.
