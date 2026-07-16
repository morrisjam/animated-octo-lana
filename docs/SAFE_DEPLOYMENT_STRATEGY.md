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
   - Inputs: exact release SHA and a different known-good rollback SHA
   - Both SHAs must be reachable from `master` and have successful CI for each exact SHA.
   - The exact checked-out release must pass `npm run ai:alpha-readiness` after dependency installation and before any provider health, drain, or deploy action. Normal CI's archived advisory alpha report cannot satisfy this release gate.
   - Before any drain or deploy call, the API and public web attestation must prove that `rollback_sha` is the currently deployed, healthy baseline. This also proves that the rollback release supports the current readiness contract.
2. Pre-deploy drain gate:
   - Authenticates with `SLO_ADMIN_KEY`.
   - Pauses queue joins and closes waiting tickets.
   - Waits until `GET /ops/matchmaking/runtime` reports zero active sessions.
   - Resumes matchmaking automatically if the Render deploy hook fails.
3. Health gate verifies:
   - `GET /health`
   - `GET /readyz` database connectivity, exact release SHA, migration head, target environment, and stable database identity
   - `GET /matchmaking/queue/config`
   - `GET /matchmaking/access/status`
   - `GET /matchmaking/network/status`
   - The target's HTTPS web release attestation returns the same exact SHA as `/readyz` and the workflow input.
   - Alpha account and exact-build allowlists are non-empty.
   - Matchmaking reports the exact rollout-approved resident-ticket ceiling.
   - TURN is configured with short-lived credentials.
   - Replay payload storage is durable across API process replacement.
   - `GET /ops/matchmaking/runtime` reports joins resumed and active sessions within threshold
   - Required SLO gate (`GET /ops/slo/summary`) using `SLO_ADMIN_KEY`
   - The replacement process restores the persisted drain flag and remains paused until these checks pass.
   - The workflow resumes queue joins, then runs a final health check.
4. Promote to production:
   - Re-run with target `production`, the same release SHA, and the successful canary workflow run ID.
   - Production downloads the canary evidence artifact and rejects an API SHA, web SHA, web-attestation schema, or migration mismatch.
5. If health gate fails:
   - The workflow attempts to re-drain matchmaking, but an unavailable or unhealthy replacement cannot prevent the rollback hook from firing.
   - The initial pre-deploy drain remains mandatory and the replacement must preserve that durable drain state.
   - It verifies the rolled-back API and exact web SHA while matchmaking remains paused.
   - Matchmaking resumes only after the rollback health gate passes; a failed rollback or rollback gate leaves public joins closed for operator review.

## Automatic Rollback
- Rollback commit: required exact `rollback_sha` workflow input
- The target-specific deploy hook is called with `ref=<rollback_sha>` after a best-effort replacement re-drain. Re-drain failure is reported but does not suppress rollback.
- Rollback condition:
  - Identity or endpoint checks fail, or
  - critical/warning SLO alert counts exceed deploy thresholds.

Default deploy gate thresholds:
- `DEPLOY_MAX_CRITICAL_ALERTS=0`
- `DEPLOY_MAX_WARNING_ALERTS=1`
- `DEPLOY_HEALTHCHECK_WINDOW_HOURS=1`
- `DEPLOY_MAX_ACTIVE_SESSIONS=0`
- `DEPLOY_DRAIN_TIMEOUT_SECONDS=180`
- `DEPLOY_FETCH_TIMEOUT_MS=5000` (accepted script range: 100-30000ms)
- `DEPLOY_READINESS_TIMEOUT_SECONDS=300`
- Workflow job timeout: 30 minutes
- `DEPLOY_REQUIRE_ALPHA_ALLOWLIST=true` (mandatory in the hosted workflow)
- `DEPLOY_REQUIRE_TURN=true` (mandatory in the hosted workflow)
- `DEPLOY_REQUIRE_ADMIN_CHECKS=true` (mandatory in the hosted workflow)
- `DEPLOY_REQUIRE_DURABLE_REPLAY_STORE=true` (mandatory in the hosted workflow)
- `DEPLOY_REQUIRE_WEB_RELEASE_ATTESTATION=true` (mandatory in the hosted workflow)

## Schema Migration Compatibility
- CI gate: `npm run api:migrations:compat`
- Runtime gate: `npm run api:smoke:rollback-schema-compatibility -- <rollback_sha> [report_path]`
- Script: `apps/api/scripts/checkMigrationCompatibility.ts`
- Runtime script: `apps/api/scripts/rollbackSchemaCompatibilitySmoke.ts`
- Blocks common breaking operations in migrations:
  - `DROP TABLE`
  - `DROP COLUMN`
  - `TRUNCATE TABLE`
  - `ALTER COLUMN ... TYPE`
  - `ALTER COLUMN ... SET NOT NULL`
- For an intentional expand-contract exception, the migration file must include:
  - `-- backward-compatible-exception: <blocked_pattern> <reason>`
- A comment never supplies release evidence by itself. CI starts the rollback API before migration, seeds representative state through real account/profile/ranked paths, applies the candidate chain, and starts the same rollback API against the upgraded schema.
- `gw.rollback-schema-compatibility.v1` binds the clean candidate SHA, rollback SHA, migration heads/digests, exception list, and both probes. Safe rollout repeats the local proof for its operator-selected rollback SHA before contacting a deployment provider, and production canary evidence must retain the same pair.

## Required GitHub Secrets
- `RENDER_CANARY_DEPLOY_HOOK_URL`
- `RENDER_PRODUCTION_DEPLOY_HOOK_URL`
- `API_CANARY_BASE_URL`
- `API_PRODUCTION_BASE_URL`
- `SLO_ADMIN_KEY`

## Required GitHub Variables
- `API_CANARY_EXPECTED_HOSTNAME`
- `API_PRODUCTION_EXPECTED_HOSTNAME`
- `API_CANARY_DATABASE_ID`
- `API_PRODUCTION_DATABASE_ID`
- `WEB_CANARY_RELEASE_ATTESTATION_URL`
- `WEB_PRODUCTION_RELEASE_ATTESTATION_URL`
- `WEB_CANARY_EXPECTED_HOSTNAME`
- `WEB_PRODUCTION_EXPECTED_HOSTNAME`

The expected API hostname is deliberately independent of the secret base URL. Both deployment gates reject non-HTTPS hosted URLs, hostname mismatches, URL credentials, and redirects before sending `SLO_ADMIN_KEY`. Local HTTP rehearsal requires `DEPLOY_ALLOW_INSECURE_LOCALHOST=true` and is limited to loopback hostnames.

## Web Release Verification Contract
Each target must expose a public HTTPS URL that describes the web deployment currently serving users. It must return HTTP 200, `Cache-Control: no-store`, and this JSON shape:

```json
{
  "schemaVersion": "gw.web-release.v1",
  "releaseSha": "<exact 40-character deployed commit SHA>"
}
```

The value must be generated from the immutable provider deployment, not from a workflow input or mutable operator value. The workflow has no Cloudflare deployment credential and therefore does not claim to trigger or roll back Pages. A missing, stale, or mismatched attestation fails closed; the provider must publish the release or rollback SHA before the five-minute readiness window expires.

## Required Provider Settings
- Disable automatic branch deploys; exact-SHA deploy-hook calls are the only promotion path.
- Set `DEPLOYMENT_ENVIRONMENT` to `canary` or `production` on each service.
- Set `DEPLOYMENT_DATABASE_ID` to the matching stable GitHub-variable value.
- Publish the web release verification contract for canary and production with cache bypass/no-store behavior.
- Ensure the web provider can restore the known-good rollback SHA; this workflow intentionally does not invent an unavailable provider token or deploy hook.
