# Neon Setup Action

## Purpose
Switch the API from local Postgres to Neon without changing game code.

## Action checklist
1. Create a Neon project and copy the connection string.
2. Set `DATABASE_URL` in your local `.env` to the Neon URL.
3. Run migrations against Neon:
   ```bash
   npm run api:migrate
   ```
4. Start API and verify it boots cleanly:
   ```bash
   npm run api:dev
   ```
5. Create one test account and profile through the API, then read it back.
6. Add `DATABASE_URL` as a secret in your deployment platform and CI.
7. Keep local Docker Postgres for offline development fallback.

## Definition of done
- `api:migrate` succeeds on Neon.
- `GET /profile` and `PUT /profile` work against Neon.
- No code changes are required when swapping `DATABASE_URL`.

## Notes
- Prefer Neon pooled connection strings for serverless runtimes.
- Keep branch environments separate (`dev`, `staging`, `prod`) to avoid data mixing.
