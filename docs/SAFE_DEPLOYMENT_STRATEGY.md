# Safe Deployment Strategy

Date: 2026-07-16
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
   - Before any drain or deploy call, the API and public web attestation must prove that `rollback_sha` is the currently deployed, healthy baseline. This also proves that the rollback release supports the current readiness contract, including the private exact-build check.
2. Pre-deploy drain gate:
   - Authenticates with `SLO_ADMIN_KEY`.
   - Pauses queue joins and closes waiting tickets.
   - Waits until `GET /ops/matchmaking/runtime` reports zero active sessions.
   - If the drain operation itself partially fails, the initial pre-deploy step may explicitly attempt a confirmed recovery before the provider is contacted.
   - Once a deploy hook is called, a failed or indeterminate response leaves matchmaking drained until an operator verifies the provider's actual release state. It never assumes that a timed-out request was rejected.
3. Health gate verifies:
   - `GET /health`
   - `GET /readyz` database connectivity, exact release SHA, migration head, target environment, and stable database identity
   - `GET /matchmaking/queue/config`
   - `GET /matchmaking/access/status`
   - Admin-authenticated `POST /ops/matchmaking/access/build-check` confirms that the exact expected SHA, not merely some build, is allowlisted. The SHA is sent in a JSON body and the response contains only a boolean.
   - `GET /matchmaking/network/status`
   - The target's HTTPS web release attestation returns the same exact SHA as `/readyz` and the workflow input.
   - Alpha account and exact-build allowlists are non-empty, and the expected release or rollback SHA is present.
   - Matchmaking reports the exact rollout-approved resident-ticket ceiling.
   - TURN is configured with short-lived credentials.
   - Replay payload storage is durable across API process replacement.
   - The private `gw.runtime-security-posture.v1` endpoint confirms production signed sessions, purpose-distinct throttle and operator keys, verified proxy/CORS boundaries, disabled development tickets, and an official bounded Steam verifier configuration.
   - `GET /ops/matchmaking/runtime` reports joins resumed and active sessions within threshold
   - Required SLO gate (`GET /ops/slo/summary`) using `SLO_ADMIN_KEY`
   - The replacement process restores the persisted drain flag and remains paused until these checks pass.
   - The workflow resumes queue joins, then runs a final health check.
4. Promote to production:
   - Re-run with target `production`, the same release SHA, and the successful canary workflow run ID.
   - Production downloads `gw.safe-rollout.v5` canary evidence and rejects a workflow-run identity, API SHA, rollback SHA, web SHA, web-attestation schema, migration pair, rollback dependency source, exact-build allowlist, or runtime-security mismatch.
5. If health gate fails:
   - The workflow re-drains matchmaking before replacing the failed release. If re-drain cannot be proven, automated rollback does not replace the API and operator intervention is required.
   - The initial pre-deploy drain remains mandatory and the replacement must preserve that durable drain state.
   - It verifies the rolled-back API and exact web SHA while matchmaking remains paused.
   - Matchmaking resumes only after the rollback health gate passes; a failed rollback or rollback gate leaves public joins closed for operator review.

## Automatic Rollback
- Rollback commit: required exact `rollback_sha` workflow input
- The target-specific deploy hook is called with `ref=<rollback_sha>` only after the replacement re-drain succeeds. This avoids replacing an API while joins or live sessions may still be active.
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
- `DEPLOY_REQUIRE_FORWARD_COMPATIBLE_MIGRATIONS=true` (mandatory in the hosted workflow)
- `DEPLOY_REQUIRE_SECURE_AUTH=true` (mandatory in the hosted workflow)
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
- A comment never supplies release evidence by itself. CI installs the rollback release from its own lockfile, starts that rollback API before migration, seeds representative state through real account/profile/ranked paths, applies the candidate chain, reruns the rollback release's migration command, and starts the same rollback API against the upgraded schema.
- `gw.rollback-schema-compatibility.v2` binds the clean candidate SHA, rollback SHA, migration heads/digests, exception list, rollback dependency installation, rollback pre-deploy migration phase, and both probes. Safe rollout repeats the local proof for its operator-selected rollback SHA before contacting a deployment provider, and production canary evidence must retain the same pair.
- Migration `031_ranked_input_commitments.sql` is intentionally expand-only for the rolling window: it adds the commitment table and proof-attestation column, and keeps the new session-side projection nullable so the selected rollback API remains able to read and write the upgraded schema.
- Migration `032_steam_ticket_exchange_replay_guard.sql` is expand-only: it adds a standalone fingerprint table that the rollback API ignores. The nullable account reference uses `ON DELETE SET NULL`, preserving a consumed ticket fingerprint without blocking account deletion.
- The deployed rollback release must already set and report `MIGRATION_ALLOW_FORWARD_COMPATIBLE_SUFFIX=true`. Introduce this contract in a closed-mode bootstrap release whose migration head remains 030, rehearse it as the known-good rollback, and only then deploy the release containing migration 031. An older rollback build that cannot verify a checksummed applied suffix is not an eligible rollback SHA.

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

For Cloudflare Pages the URL is `/release.json`. `vite.config.ts` derives both the
attestation and the game's compiled build ID from the provider-injected
`CF_PAGES_COMMIT_SHA`; it also emits the `_headers` rule that disables caching for this
path. `VITE_APP_BUILD` must be absent from the Pages dashboard or equal that provider SHA.
CI exercises the same build mode using `github.sha` and verifies the JSON, header rule, and
JavaScript bundle before accepting the commit.

The value is never sourced from a workflow input or independently mutable operator value.
The workflow has no Cloudflare deployment credential and therefore does not claim to
trigger or roll back Pages. A missing, stale, or mismatched attestation fails closed; the
provider must publish the release or rollback SHA before the five-minute readiness window
expires.

## Required Provider Settings
- Disable automatic branch deploys for the Render API; exact-SHA deploy-hook calls are its
  only promotion path. Pages currently uses its Git integration because this repository has
  no Cloudflare deployment credential, and the rollout treats its provider-derived SHA as a
  separately verified prerequisite rather than claiming to trigger it.
- Set `DEPLOYMENT_ENVIRONMENT` to `canary` or `production` on each service.
- Set `DEPLOYMENT_DATABASE_ID` to the matching stable GitHub-variable value.
- Point each web release variable at the target's `/release.json`; the checked-in Vite
  plugin publishes it with no-store behavior.
- Ensure the web provider can restore the known-good rollback SHA; this workflow intentionally does not invent an unavailable provider token or deploy hook.
- Keep both the intended release SHA and known-good rollback SHA in `MATCHMAKING_ALPHA_BUILD_VERSIONS` before starting the workflow. The baseline, candidate, and rollback gates each verify the exact SHA they expect.
- Introducing this readiness contract to a provider that runs older code requires one closed-mode bootstrap deployment. Do not open matchmaking until that bootstrap exposes both the private exact-build and runtime-security routes and a subsequent normal canary/rollback rehearsal passes.
