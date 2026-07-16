# Deployment Runbook

Last updated: 2026-07-13

## Live stack inventory

| Area | Provider | Service/Project | Live endpoint |
| --- | --- | --- | --- |
| Web client | Cloudflare Pages | `animated-octo-lana` | `https://play.gravitywell.space` |
| Web fallback | Cloudflare Pages | `animated-octo-lana` | `https://animated-octo-lana.pages.dev` |
| API | Render | Web service `gravity-well` | `https://api.gravitywell.space` |
| API fallback | Render | Web service `gravity-well` | `https://gravity-well.onrender.com` |
| Primary DB | Neon (AWS region) | Postgres | via `DATABASE_URL` secret |
| DNS + TLS | Cloudflare | Zone `gravitywell.space` | manages DNS records and certs |
| Domain registrar | GoDaddy | `gravitywell.space` | registrar only |
| Source control | GitHub | `morrisjam/animated-octo-lana` | `master` production branch |

## DNS records currently in use

Managed in Cloudflare DNS for `gravitywell.space`:

- `CNAME play -> animated-octo-lana.pages.dev`
- `CNAME api -> gravity-well.onrender.com`

Notes:

- Keep `api` as `DNS only` during Render verification/certificate setup.
- Do not edit DNS in GoDaddy while Cloudflare nameservers are authoritative.

## Cloudflare Pages config

Project: `animated-octo-lana`

- Root directory: blank (repo root)
- Build command: `npm run build`
- Build output directory: `apps/game-web/dist`
- Production branch: `master`
- Node: `22`

### Pages production variables

```env
NODE_VERSION=22
VITE_APP_ENV=production
VITE_PLATFORM=web
VITE_PROFILE_API_BASE=https://api.gravitywell.space
VITE_MATCHMAKING_API_BASE=https://api.gravitywell.space
VITE_APP_BUILD=<exact_release_build_id>
VITE_RULESET_VERSION=prototype-2026.02
VITE_BALANCE_PROFILE_ID=default
VITE_FEATURE_ONLINE=true
VITE_FEATURE_RANKED=true
VITE_FEATURE_ONLINE_MATCH_RUNTIME=true
VITE_FEATURE_DEBUG_TOOLS=false
VITE_FEATURE_ONLINE_DIAGNOSTICS=false
VITE_FEATURE_TRAINING_MODE=true
VITE_FEATURE_ARCADE_MODE=false
```

### Pages release attestation

The safe rollout does not have a Cloudflare API token or Pages deploy hook. Each canary/production web target must instead expose a public HTTPS attestation for the deployment currently serving users:

```json
{
  "schemaVersion": "gw.web-release.v1",
  "releaseSha": "<exact 40-character deployed commit SHA>"
}
```

The endpoint must return HTTP 200 with `Cache-Control: no-store`, must not redirect, and must derive `releaseSha` from the immutable Pages deployment rather than a workflow input or manually mutable value. Configure its URL and independently expected hostname in the `WEB_*_RELEASE_ATTESTATION_URL` and `WEB_*_EXPECTED_HOSTNAME` GitHub variables. A missing or mismatched endpoint blocks the rollout. Because this repository has no web-provider deployment credential, an API rollback remains paused until Pages also serves and attests the rollback SHA.

## Render API config

Service: `gravity-well` (Web Service)

- Branch: `master`
- Build command: `npm ci`
- Pre-deploy command: `npm run api:migrate`
- Start command: `npm run api:dev`
- Health check path: `/readyz`
- Auto-deploy: `Off`; releases are exact-SHA deploy-hook promotions only
- Suggested plan: `Starter`

### Render environment variables

```env
NODE_ENV=production
DEPLOYMENT_ENVIRONMENT=<canary_or_production>
DEPLOYMENT_DATABASE_ID=<stable_non_secret_database_identity>
DATABASE_URL=<neon_connection_string>
API_CORS_ORIGINS=https://play.gravitywell.space
AUTH_SESSION_SECRET=<32+ character random secret>
AUTH_SESSION_TTL_SECONDS=43200
AUTH_RATE_LIMIT_SECRET=<distinct 32+ character random HMAC secret>
API_TRUST_PROXY_HOPS=<verified reverse-proxy hop count>
AUTH_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS=900
# Optional; omit to keep emergency identity routes disabled:
AUTH_IDENTITY_ADMIN_KEY=<distinct 32+ character support key>
ALLOW_INSECURE_ACCOUNT_HEADER=false
MATCHMAKING_ACCESS_MODE=allowlist
MATCHMAKING_ALPHA_ACCOUNT_IDS=<comma_separated_alpha_account_uuids>
MATCHMAKING_ALPHA_BUILD_VERSIONS=<exact_release_build_id>
MATCHMAKING_MAX_RESIDENT_TICKETS=64
RANKED_SUPPORTED_RULESET_VERSIONS=prototype-2026.02
MATCHMAKING_SNAPSHOT_INTERVAL_MS=5000
MATCHMAKING_RUNTIME_NAMESPACE=<canary_or_production_matching_deployment_environment>
MATCHMAKING_RUNTIME_LOCK_TIMEOUT_MS=5000
SLO_ADMIN_KEY=<strong_ops_key_matching_github_secret>
ROOM_WEB_INVITE_BASE_URL=https://play.gravitywell.space
REPLAY_BLOB_PROVIDER=postgres
STEAM_APP_ID=<steam_app_id>
STEAM_WEB_API_KEY=<publisher_web_api_key>
STEAM_WEB_API_IDENTITY=gravity-well-api
STEAM_WEB_API_TIMEOUT_MS=5000
MATCHMAKING_TURN_URLS=<turn_and_turns_urls>
MATCHMAKING_TURN_SHARED_SECRET=<coturn_rest_api_shared_secret>
MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS=600
```

Render supplies `RENDER_GIT_COMMIT`; the API reports it as `releaseSha` from `/health` and `/readyz`. The safe rollout gate also checks `DEPLOYMENT_ENVIRONMENT`, `DEPLOYMENT_DATABASE_ID`, database connectivity, migration head, PostgreSQL matchmaking coordination, and a runtime namespace equal to the rollout target before it resumes matchmaking. Configure GitHub repository variables `API_CANARY_DATABASE_ID` and `API_PRODUCTION_DATABASE_ID` to match the corresponding Render values. Configure `API_CANARY_EXPECTED_HOSTNAME` and `API_PRODUCTION_EXPECTED_HOSTNAME` independently of the secret API base URLs; the gate rejects non-HTTPS hosted URLs, hostname mismatches, URL credentials, and redirects before sending the operations key.

The web release must use matching `VITE_APP_BUILD`, `VITE_RULESET_VERSION`, and `VITE_BALANCE_PROFILE_ID` values. Ranked queue entry fails closed when these do not match the durable session/verifier contract.

Before creating provider deployments, place the intended Render and Cloudflare values in one uncommitted local env file and run:

```powershell
npm run alpha:config-audit -- C:\path\to\gravity-well-alpha.env apps\api\build-artifacts\alpha-provider-config.json
```

The audit is offline: it does not contact Neon, Render, Cloudflare, Steam, or TURN. It reports only named pass/fail checks and never emits secret values. It binds the API release, Cloudflare build, build allowlist, ruleset, signed auth, distinct throttle HMAC secret, verified proxy hop count, CORS, TURN mode, bounded HTTPS Steam verifier, durable replay provider, resident matchmaking capacity, admin keys, and real online match runtime before hosted spend begins.

Do not use quotes around values unless needed by provider UI.

## Secrets policy

- Never commit `.env` with live secrets.
- `.env` is ignored in git (`.gitignore`).
- Keep production secrets only in provider secret managers (Render/Cloudflare).
- Never expose `AUTH_SESSION_SECRET`, `AUTH_RATE_LIMIT_SECRET`, `AUTH_IDENTITY_ADMIN_KEY`, or `STEAM_WEB_API_KEY` to Cloudflare Pages or any `VITE_*` variable.
- Never enable `ALLOW_INSECURE_ACCOUNT_HEADER` or `STEAM_ALLOW_DEV_TICKETS` in production.
- Do not deploy permanent `MATCHMAKING_TURN_USERNAME` and `MATCHMAKING_TURN_CREDENTIAL` values for player clients; the alpha gate requires short-lived credentials derived from `MATCHMAKING_TURN_SHARED_SECRET`.
- If a secret is accidentally exposed, rotate it immediately.

## Deployment flow

CI runs the production bundle budget and production-root `npm run alpha:visual-smoke`, durable auth-rate and route-ownership smokes, plus `npm run api:smoke:ranked-online`, `npm run api:smoke:ranked-authoritative-forfeit`, `npm run api:smoke:database-interruption`, `npm run api:smoke:matchmaking-restart`, and `npm run api:smoke:matchmaking-multi-instance` against disposable local services before release evidence is accepted. The bundle gate measures the emitted initial graph and requires optional tools to remain lazy. The visual gate blocks external requests, requires bundled replay JSON and WebGL rendering, exercises Replay Review and pause/resume first-load behavior, and archives action-marker screenshots. The service gates prove atomic auth boundaries, account privacy, valid proof replay, tamper rejection, durable authenticated heartbeat handling, pool reconnection, checkpoint/restore, reconnect replay protection, signaling recovery, pending proof-backed settlement across sequential API processes, and shared queue/session/transport/drain state across two simultaneously live API processes. The multi-instance gate terminates only its explicitly named API backends while a ranked session is active, requires replacement backend PIDs, and proves both API PIDs and cross-instance control-plane operations survive. The API health response reports only the database target class (`local`, `remote`, or `unknown`), never connection details; smoke commands refuse anything except `local` by default. Set `ALLOW_REMOTE_DATABASE_SMOKE=1` only while intentionally running the same commands against an isolated staging database during release rehearsal. This is not permission to target production or skip the production drain because only the current simulator verifier is loaded and the legacy HTTP frame relay remains process-local.

For controlled alpha, matchmaking mutations are serialized with a bounded PostgreSQL advisory lock. Every successful acquisition increments a namespaced PostgreSQL fence token. Coordinated requests refresh and persist through the lock-owning connection, and snapshot writes must prove that token is still current before the same transaction updates access projections or queues ranked terminal decisions. An aborted, disconnected, or superseded process therefore cannot overwrite newer state. Heartbeats persist the coordinated snapshot on every accepted pulse so liveness survives process handoff. Signaling publish/poll is deliberately outside this global lease: an indexed hashed access projection validates participant, transport generation, session/reconnect deadline, and bounded per-sender/per-session mailbox quotas.

Run both lifecycle smokes against the local Docker database without consuming hosted compute:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well'
npm run api:smoke:matchmaking-restart
npm run api:smoke:matchmaking-multi-instance
```

Each smoke uses and removes a unique runtime namespace. The multi-instance v2 report must show cross-instance matching, complete PostgreSQL backend replacement, both API processes surviving, recovered active-session/heartbeat/signaling state, generation-safe transport replacement, shared drain state, survivor-retained session state, and `staleSnapshotWriterFenced: true`.

### Offline rollout rehearsal

Rehearse the health, drain, and resume gates against Docker before spending hosted database compute. Start the local services with `npm run db:up`, then launch the API from a separate PowerShell session:

```powershell
$env:PORT = '8787'
$env:NODE_ENV = 'development'
$env:AUTH_SESSION_SECRET = 'local-alpha-auth-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz'
$env:SLO_ADMIN_KEY = 'local-alpha-ops-key-0123456789'
$env:MATCHMAKING_ACCESS_MODE = 'allowlist'
$env:MATCHMAKING_ALPHA_ACCOUNT_IDS = '11111111-1111-4111-8111-111111111111'
$env:MATCHMAKING_ALPHA_BUILD_VERSIONS = 'alpha-local'
$env:MATCHMAKING_MAX_RESIDENT_TICKETS = '64'
$env:MATCHMAKING_RUNTIME_NAMESPACE = 'development'
npm run local --workspace @gravity-well/api
```

In the original session, set the gate environment once and run the state sequence:

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:8787'
$env:DEPLOY_EXPECT_API_HOSTNAME = '127.0.0.1'
$env:DEPLOY_ALLOW_INSECURE_LOCALHOST = 'true'
$env:API_SLO_ADMIN_KEY = 'local-alpha-ops-key-0123456789'
$env:API_OPS_ADMIN_KEY = 'local-alpha-ops-key-0123456789'
$env:DEPLOY_REQUIRE_ALPHA_ALLOWLIST = 'true'
$env:DEPLOY_REQUIRE_TURN = 'false'
$env:DEPLOY_MAX_ACTIVE_SESSIONS = '0'
$env:DEPLOY_EXPECT_MAX_RESIDENT_TICKETS = '64'
$env:DEPLOY_EXPECT_MATCHMAKING_RUNTIME_NAMESPACE = 'development'

$env:DEPLOY_EXPECT_MATCHMAKING_DRAINING = 'false'
npm run api:deploy:health-gate

$env:DEPLOY_DRAIN_ACTION = 'drain'
$env:DEPLOY_DRAIN_TIMEOUT_SECONDS = '10'
$env:DEPLOY_DRAIN_POLL_INTERVAL_MS = '100'
npm run api:deploy:drain-gate

$env:DEPLOY_EXPECT_MATCHMAKING_DRAINING = 'true'
npm run api:deploy:health-gate

$env:DEPLOY_DRAIN_ACTION = 'resume'
npm run api:deploy:drain-gate

$env:DEPLOY_EXPECT_MATCHMAKING_DRAINING = 'false'
npm run api:deploy:health-gate
```

The local rehearsal intentionally leaves TURN and web release attestation optional because it proves API lifecycle behavior, not remote relay availability or hosted web identity. The insecure URL exception accepts only explicit loopback hostnames and is never set by the hosted workflow. Confirm `/health` reports `"databaseTarget": "local"` before running it. Stop the API, then run `npm run db:down`; Docker volumes are retained for subsequent local rehearsals.

The normal CI and local integration paths terminate only explicitly named API backends and verify replacement connections automatically. For a full local database-outage drill, call a database-backed endpoint first, run `docker restart gravity-well-postgres`, then repeat `npm run api:deploy:health-gate`. The API must remain on the same PID, log redacted idle-pool connection errors, and pass the post-restart runtime and SLO queries. Backend termination catches process and pool handling defects without stopping a shared developer database; the container restart catches a longer local outage. Neither replaces the staging database failover/interruption gate.

1. Push release commit to `master`.
2. Trigger the safe rollout workflow with target `canary`, the exact 40-character release SHA, and a different known-good rollback SHA that is currently deployed on the target. It requires both SHAs to be reachable from `master` with successful exact-SHA CI, installs that exact release, requires its strict `ai:alpha-readiness` gameplay gate to pass locally, runs `gw.rollback-schema-compatibility.v1` to prove that exact rollback API still serves account/profile/ranked writes after the release migrations, then proves the deployed rollback API and web attestation satisfy the current readiness contract before any drain or deploy call. It pauses new queue joins, closes waiting tickets, and waits for active online sessions to finish before calling Render with `ref=<release_sha>`:
   - `.github/workflows/safe-rollout.yml` with target `canary`.
   - TURN with short-lived credentials, alpha allowlists, the `64` resident-ticket ceiling, readiness identity, SLO checks, and operations checks are mandatory rather than operator-selectable inputs.
3. Record the successful canary workflow run ID printed in its summary.
4. Trigger the workflow again with target `production`, the same release SHA, the same rollback SHA, and the successful canary run ID. Production refuses promotion if the downloaded canary artifact does not attest the same API SHA, rollback SHA, web SHA, web contract schema, migration head, and successful rollback-schema proof.
5. Confirm the drain gate reports zero queued tickets and zero active sessions. Queue/session/reconnect state, heartbeat timestamps, and low-volume WebRTC signaling are durable in PostgreSQL; accepted heartbeat pulses persist the coordinated runtime snapshot, while gameplay frames travel peer-to-peer or through TURN rather than through the API process. The legacy HTTP frame relay is process-local and is not an alpha transport.
6. Render runs `npm run api:migrate` before starting the new API process.
7. Cloudflare Pages publishes the same exact commit and its `gw.web-release.v1` attestation. The workflow waits up to five minutes for exact API/web identity before resuming matchmaking.
8. Validate:
   - `https://api.gravitywell.space/health` returns `{ "ok": true, "databaseTarget": "remote", "releaseSha": "<release_sha>" }`
   - `https://api.gravitywell.space/readyz` reports the exact release SHA, expected database identity/environment, matching runtime namespace, `postgres_advisory_lock_fenced_v2` coordination, all 30 checksum-verified migrations through `030_matchmaking_runtime_fences.sql`, and `replayBlobDurable: true`
   - `https://api.gravitywell.space/matchmaking/network/status` reports `"relayAvailable": true` and `"turnCredentialMode": "time_limited"`
   - `/matchmaking/access/status` reports `"mode": "allowlist"` and `"ready": true`
   - `/matchmaking/queue/config` reports `"maxResidentTickets": 64`
   - a matched alpha participant can `POST /matchmaking/network/ice-config` with its session token; an anonymous or unmatched request is rejected
   - `https://play.gravitywell.space` loads and can create profile/session.

See `docs/SAFE_DEPLOYMENT_STRATEGY.md` for canary/rollback and migration compatibility policy.

## Quick troubleshooting

- `root directory not found` in Pages:
  - Root directory was set to a non-existent path. Set it blank.
- `Missing entry-point to Worker script` in Cloudflare build:
  - Worker deploy command was used for Pages. Remove `wrangler deploy` from deploy command.
- API returns `ENOTFOUND base`:
  - `DATABASE_URL` was malformed (copied with `psql` wrapper). Use raw URL only.
- Browser CORS preflight fails for `PUT /profile`:
  - Ensure API includes CORS methods including `PUT` (fixed in `master`).
- Render domain verify/cert pending:
  - Ensure `api` CNAME exists and uses `DNS only` in Cloudflare while verifying.
