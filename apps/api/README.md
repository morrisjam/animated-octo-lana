# API Quickstart

Workspace path: `apps/api`.

## Environment

Set `DATABASE_URL` to a PostgreSQL connection string.
Set `REDIS_URL` for Redis backup and disaster-recovery automation.

Required in production:
- `NODE_ENV=production`.
- `AUTH_SESSION_SECRET` must be a random value with at least 32 characters. API startup fails without it.
- Signed requests are rechecked against the current account row; deleted, disabled, and merged-source accounts cannot keep using an otherwise unexpired bearer token.
- `STEAM_APP_ID`, `STEAM_WEB_API_KEY`, and `STEAM_WEB_API_IDENTITY` are required before enabling Steam sign-in.

Optional:
- `API_PORT` defaults to `8787`.
- `PORT` overrides `API_PORT` when provided by your hosting platform.
- `API_CORS_ORIGINS` is a comma-separated browser origin allowlist (defaults to localhost dev URLs).
- `AUTH_SESSION_TTL_SECONDS` defaults to `43200` (12 hours).
- `AUTH_RATE_LIMIT_SECRET` is the 32+ character HMAC key for pseudonymous durable auth buckets. It falls back to `AUTH_SESSION_SECRET`; use a distinct production secret.
- `API_TRUST_PROXY_HOPS` enables forwarded client-IP handling for source throttles and must match the verified reverse-proxy path. Leave it unset for direct/local traffic.
- `AUTH_IDENTITY_ADMIN_KEY` optionally enables the emergency identity-link and identity-lookup routes. Without it those routes return `404`.
- `AUTH_RATE_LIMIT_<POLICY>_MAX_ATTEMPTS` and `_WINDOW_SECONDS` tune the documented global-source, guest, web signup/signin, and Steam source/ticket defaults from `.env.example`.
- `AUTH_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS` defaults to `900` and is clamped to 60-86400 seconds.
- `ALLOW_INSECURE_ACCOUNT_HEADER=true` permits the legacy `x-account-id` credential for local tools only. Leave it unset in production.
- `STEAM_WEB_API_BASE` defaults to `https://partner.steam-api.com`.
- `STEAM_WEB_API_TIMEOUT_MS` defaults to `5000` and is bounded to 10-30000 ms.
- `STEAM_ALLOW_DEV_TICKETS=true` enables `dev-steam:<id>` locally; it is always disabled when `NODE_ENV=production`.
- `MATCHMAKING_TICKET_TTL_SECONDS` defaults to `90`.
- `MATCHMAKING_SESSION_TTL_SECONDS` defaults to `1800` (30 minutes).
- `MATCHMAKING_SESSION_TOKEN_TTL_SECONDS` defaults to session TTL.
- `MATCHMAKING_RECONNECT_GRACE_SECONDS` defaults to `20`, covering one bounded fresh WebRTC negotiation plus deterministic checkpoint agreement. The controlled-alpha provider audit rejects values below `9` or above `120` seconds.
- `MATCHMAKING_HEARTBEAT_INTERVAL_SECONDS` defaults to `5`; clients pulse during signaling and active play.
- `MATCHMAKING_HEARTBEAT_TIMEOUT_SECONDS` defaults to `30` and is clamped to at least three heartbeat intervals. A missed window enters reconnect grace before any timeout resolution.
- `MATCHMAKING_CLOSED_RETENTION_SECONDS` defaults to `120`.
- `MATCHMAKING_SNAPSHOT_INTERVAL_MS` defaults to `5000` and controls how often queue, session, and reconnect state is checkpointed to PostgreSQL.
- `MATCHMAKING_RANKED_INITIAL_GAP` defaults to `120`.
- `MATCHMAKING_RANKED_GAP_EXPANSION_PER_SECOND` defaults to `8`.
- `MATCHMAKING_RANKED_MAX_GAP` defaults to `700`.
- `MATCHMAKING_MASTER_INITIAL_GAP` defaults to `80`.
- `MATCHMAKING_MASTER_GAP_EXPANSION_PER_SECOND` defaults to `5`.
- `MATCHMAKING_MASTER_MAX_GAP` defaults to `400`.
- `MATCHMAKING_MASTER_STRICT_REGION_SECONDS` defaults to `20`.
- `MATCHMAKING_ACCESS_MODE` is `open`, `closed`, or `allowlist`; it defaults to `closed` in production and `open` elsewhere.
- `MATCHMAKING_ALPHA_ACCOUNT_IDS` and `MATCHMAKING_ALPHA_BUILD_VERSIONS` are required, comma-separated exact allowlists when access mode is `allowlist`.
- `MATCHMAKING_MAX_RESIDENT_TICKETS` defaults to `256` for local development. Controlled-alpha provider audit requires an explicit value from twice the account allowlist (minimum `4`) through `128`; the rollout contract currently requires `64`. The ceiling includes queued, matched, and retained closed tickets. Existing tickets and active-session recovery continue at capacity, while only a new ticket receives retryable `503 matchmaking_at_capacity`.
- `RANKED_SUPPORTED_RULESET_VERSIONS` is the comma-separated ranked verifier allowlist and defaults to `prototype-2026.02`.
- `RANKED_PROOF_RATE_LIMIT_ACCOUNT_SESSION_MAX_ATTEMPTS` and `_WINDOW_SECONDS` default to `4` attempts per authenticated account+session over `600` seconds.
- `RANKED_PROOF_RATE_LIMIT_ACCOUNT_HOUR_MAX_ATTEMPTS` and `_WINDOW_SECONDS` default to `20` attempts per authenticated account over `3600` seconds.
- `MATCHMAKING_STUN_URLS` optional comma-separated STUN URL list.
- `MATCHMAKING_TURN_URLS` optional comma-separated TURN URL list.
- `MATCHMAKING_TURN_SHARED_SECRET` enables authenticated, account-scoped TURN REST credentials and is required for alpha rollout gates.
- `MATCHMAKING_TURN_CREDENTIAL_TTL_SECONDS` defaults to `600` and is bounded to 60 seconds through 24 hours.
- `MATCHMAKING_TURN_USERNAME` and `MATCHMAKING_TURN_CREDENTIAL` remain a local/static compatibility fallback only.
- `MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS` defaults to `8000`.
- `MATCHMAKING_SIGNAL_TTL_SECONDS` defaults to `600` and controls short-lived PostgreSQL offer/answer/ICE retention.
- `MATCHMAKING_SIGNAL_CLEANUP_INTERVAL_SECONDS` defaults to `60` and is clamped to 30-3600 seconds. Startup and bounded periodic cleanup remove expired signaling rows even if a session-resolution callback never runs.
- `MATCHMAKING_SIGNAL_MAX_MESSAGES_PER_SESSION` and `MATCHMAKING_SIGNAL_MAX_BYTES_PER_SESSION` default to `512` and `2097152`; `_PER_SENDER` defaults to `256` and `1048576`. PostgreSQL serializes quota checks per session and returns `429 signal_quota_exceeded` before an offer/answer/ICE mailbox can grow without bound.
- `RANKED_TERMINAL_DECISION_PROCESS_INTERVAL_MS` defaults to `1000` and is clamped to 250-60000 milliseconds. The bounded worker leases durable forfeit/no-contest decisions and safely retries interrupted settlements.
- `MATCHMAKING_TELEMETRY_RETENTION_MS` defaults to `86400000` (24h).
- `ROOM_IDLE_TIMEOUT_SECONDS` defaults to `900`.
- `ROOM_CLOSED_RETENTION_SECONDS` defaults to `1800`.
- `ROOM_MAX_PARTICIPANTS` defaults to `2`.
- `ROOM_MAX_SPECTATORS` defaults to `4`.
- `ROOM_MAX_HISTORY_ENTRIES` defaults to `20`.
- `ROOM_WEB_INVITE_BASE_URL` defaults to `http://localhost:5173`.
- `STEAM_APP_ID` identifies the game for invites and Steam web-ticket verification.
- `PRESENCE_TTL_MS` defaults to `300000` (5 minutes).
- `PRESENCE_RATE_WINDOW_MS` defaults to `30000` (30 seconds).
- `PRESENCE_MAX_UPDATES_PER_WINDOW` defaults to `12`.
- `FRIEND_INVITE_TTL_MS` defaults to `90000` (90 seconds).
- `FRIEND_INVITE_RATE_WINDOW_MS` defaults to `60000` (60 seconds).
- `FRIEND_INVITE_MAX_PER_WINDOW` defaults to `5`.
- `REPLAY_BLOB_PROVIDER` defaults to `local`; use `postgres` for controlled alpha durability without a separate object-storage account.
- `REPLAY_BLOB_DIR` defaults to `./data/replay-blobs`.
- `REPLAY_RETENTION_DAYS_RANKED` defaults to `365`.
- `REPLAY_RETENTION_DAYS_CASUAL` defaults to `90`.
- `REPLAY_INGEST_RATE_LIMIT_SOURCE_*` and `REPLAY_INGEST_RATE_LIMIT_ACCOUNT_*` configure durable shared upload throttles; defaults are 40 and 20 attempts per hour respectively.
- `REPLAY_MAX_ACTIVE_ARCHIVES_PER_ACCOUNT` defaults to `200`, and `REPLAY_MAX_ACTIVE_BYTES_PER_ACCOUNT` defaults to `256 MiB` using a conservative incoming-size estimate.
- `REPLAY_RETENTION_CLEANUP_INTERVAL_SECONDS` defaults to `3600`; expired metadata and payload blobs are deleted in bounded retryable batches.
- `RANKED_SEASON_DURATION_DAYS` defaults to `90`.
- `RANKED_SEASON_RESET_ADMIN_KEY` optional admin key required by `POST /ranked/seasons/reset`.
- `RANKED_CALIBRATION_MATCHES` defaults to `5` (matches before initial league placement).
- `RANKED_MASTER_ENTRY_RATING` defaults to `1900`.
- `RANKED_MASTER_BASE_POINTS` defaults to `1500`.
- `RANKED_MR_WEIGHT_RANKED` defaults to `1`.
- `RANKED_ANOMALY_MIN_MATCH_INTERVAL_SECONDS` defaults to `30`.
- `RANKED_ANOMALY_RATING_JUMP_THRESHOLD` defaults to `60`.
- `RANKED_ANOMALY_MR_JUMP_THRESHOLD` defaults to `80`.
- `RANKED_ANOMALY_ADMIN_KEY` optional admin key required by ranked anomaly alert review endpoints.
- `ENFORCEMENT_ADMIN_KEY` optional admin key required by enforcement action and appeal review endpoints.
- `SLO_ADMIN_KEY` protects the SLO summary and matchmaking deploy-drain endpoints; it is required for safe rollouts.
- `RELEASE_SHA` optionally supplies local/manual release identity; Render deployments use `RENDER_GIT_COMMIT` automatically.
- `DEPLOYMENT_ENVIRONMENT` identifies `canary` or `production` and is verified before matchmaking resumes.
- `DEPLOYMENT_DATABASE_ID` is a stable, non-secret identity for the intended database and is verified before matchmaking resumes.
- `SLO_AVAILABILITY_TARGET_PERCENT` defaults to `99.5`.
- `SLO_ERROR_RATE_TARGET_PERCENT` defaults to `1`.
- `SLO_LATENCY_P95_TARGET_MS` defaults to `350`.
- `SLO_REPORT_WINDOW_DAYS` defaults to `7` (used by weekly SLO report script).
- `SLO_SAMPLE_RETENTION_DAYS` defaults to `14`; samples older than this are pruned.
- `SLO_SAMPLE_MAX_ROWS` defaults to `250000`; only the newest configured sample-id window is retained.
- `SLO_SAMPLE_CLEANUP_INTERVAL_SECONDS` defaults to `300` and accepts `60` through `86400`.
- `API_BASE_URL` required for deploy health-gate script.
- `API_SLO_ADMIN_KEY` and `API_OPS_ADMIN_KEY` are required by hosted safe rollouts.
- `DEPLOY_HEALTHCHECK_WINDOW_HOURS` defaults to `1`.
- `DEPLOY_MAX_CRITICAL_ALERTS` defaults to `0`.
- `DEPLOY_MAX_WARNING_ALERTS` defaults to `1`.
- `DEPLOY_MAX_ACTIVE_SESSIONS` defaults to `0`.
- `DEPLOY_DRAIN_TIMEOUT_SECONDS` defaults to `180`.
- `DEPLOY_REQUIRE_ADMIN_CHECKS=true` makes missing SLO/operations credentials fail closed.
- `DEPLOY_REQUIRE_DURABLE_REPLAY_STORE=true` rejects local filesystem replay storage during rollout.
- `DEPLOY_EXPECT_RELEASE_SHA`, `DEPLOY_EXPECT_MIGRATION_HEAD`, `DEPLOY_EXPECT_MIGRATION_COUNT`, `DEPLOY_EXPECT_MAX_RESIDENT_TICKETS`, `DEPLOY_EXPECT_DATABASE_TARGET`, `DEPLOY_EXPECT_DATABASE_ID`, and `DEPLOY_EXPECT_ENVIRONMENT` bind the gate to one release and deployment target. Readiness also fails unless every applied migration has its recorded SHA-256 checksum.
- `DEPLOY_DRAIN_POLL_INTERVAL_MS` defaults to `2000`.

API scripts auto-load `.env` from repo root. Create it once:

```bash
cp .env.example .env
```

## Local Postgres via Docker

From repo root:

```bash
npm run db:up
```

Requires Docker Desktop (or Docker Engine + Compose) installed and running.

This starts:
- `postgres:16-alpine` with:
- database: `gravity_well`
- user: `postgres`
- password: `postgres`
- port: `5432`
- `redis:7-alpine` with:
- port: `6379`
- append-only and RDB snapshots enabled in container config

Stop it with:

```bash
npm run db:down
```

## Run migrations

```bash
npm run api:migrate
```

## Start API

```bash
npm run api:dev
```

Or run local DB, migrations, and API together:

```bash
npm run api:local
```

Matchmaking queue tickets, session control state, reconnect deadlines, used reconnect attempts, and short-lived WebRTC signaling are durable in PostgreSQL. Gameplay frames use a reliable ordered WebRTC DataChannel and therefore do not create per-frame PostgreSQL/Neon writes. The legacy HTTP frame relay remains process-local for compatibility smoke only; alpha deployments must not use it as the gameplay transport.

## Run API tests

```bash
npm run typecheck
npm run api:test
```

The API typecheck applies strict null analysis to production source and operational scripts. Runtime test fixtures are validated by the Node test runner.

## Prove rollback schema compatibility locally

From the repository root, provide the exact known-good commit that would be used for rollback:

```bash
npm run api:smoke:rollback-schema-compatibility -- <rollback_sha> [report_path]
```

The runner creates a disposable local database, applies the rollback commit's migrations, starts that commit's API and writes representative account, profile, ranked-season, queue, and session state, applies the candidate migrations, then restarts the same rollback API and repeats the probe. Evidence schema `gw.rollback-schema-compatibility.v1` records both exact SHAs, both migration-chain digests, candidate dirty state, every documented compatibility exception, and all four phases. It refuses remote databases and contacts no hosted service. CI and safe rollout require a clean candidate and bind the report to the exact release/rollback pair; a local dirty-tree pass is diagnostic evidence only.

## Run the complete local alpha integration proof

From the repository root:

```bash
npm run alpha:local-integration
npm run alpha:local-turn-integration
```

This local-only runner builds the production client, starts or reuses local Docker PostgreSQL, applies migrations, starts an isolated API and web preview, and runs rollback-only ranked season transition, ranked proof consensus, archived Master-region immutability, server-authoritative forfeit, real-browser WebRTC rollback/reconnect, two-client lifecycle/script-stall recovery, a one-second isolated-client rollback soak, and a complete two-browser ranked match through the production root. The production-root match replaces the live WebRTC channel while each peer retains a speculative unacknowledged input tail, then requires same-round checkpoint agreement, exactly one transport-generation advance, tail drain, proof consensus, replay persistence, database interruption recovery, process replacement, and concurrent-instance durability. The TURN variant additionally owns an ephemeral `coturn/coturn:4.6.3` container and fails unless initial, replacement, isolated two-client, and production-root connections all report relay paths with short-lived credentials. It refuses a non-loopback `LOCAL_DATABASE_URL`, does not contact Neon or another hosted application provider, cleans up only services it started, and writes redacted `gw.local-alpha-integration.v3` summaries as `report-direct.json` or `report-relay.json` plus a latest-run `report.json` compatibility copy under `apps/api/build-artifacts/local-alpha-integration`. API, preview, browser, and coturn evidence is retained in the same directory. Docker and Chrome, Edge, or Chromium are required.

`LOCAL_ALPHA_SKIP_BUILD=1` skips only the production build for fast repetition after that build has already passed. Ports default to `8787`, `5191`, and `8791-8793`; override them with `LOCAL_ALPHA_API_PORT`, `LOCAL_ALPHA_WEB_PORT`, `LOCAL_ALPHA_RESTART_PORT`, `LOCAL_ALPHA_MULTI_PORT_A`, and `LOCAL_ALPHA_MULTI_PORT_B`. Set `LOCAL_ALPHA_MANAGE_POSTGRES=0` to require an already-running local database instead of allowing Docker startup.

## Run ranked online smoke

This validates:

- ranked queue match creation
- authenticated, idempotent WebRTC signaling with peer isolation
- WebRTC signaling and session-token isolation; the process-local legacy HTTP frame-relay routes are disabled by default and cannot be enabled in production
- disconnect and reconnect flow
- replayed reconnect rejection
- server-replayed ranked proof settlement plus matching peer proof digest
- durable participant-session and account-wide proof replay limits, including peer-isolated `429` behavior
- explicit no-contest draw rejection without a rating or placement write
- checksum-tampered proof rejection
- duplicate submission rejection
- progression update after result processing

`MATCHMAKING_ENABLE_LEGACY_HTTP_FRAME_RELAY=true` exposes the old process-local frame endpoints only in a non-production local debugging process. They are not generation-safe or multi-instance transport and must never be used as an online fallback.

```bash
API_BASE_URL=http://127.0.0.1:3000 SMOKE_EXPECT_API_HOSTNAME=127.0.0.1 SMOKE_EXPECT_DATABASE_ID=local SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT=development ONLINE_SMOKE_WAIT_SECONDS=33 npm run api:smoke:ranked-online
```

Notes:
- `ONLINE_SMOKE_WAIT_SECONDS=33` exercises a non-trivial session age before ranked settlement; the session/token default is now 30 minutes.
- Reduce the wait for a faster happy-path smoke when needed.
- The smoke script now covers both live-session lifecycle behavior and the post-match ranked lifecycle.
- Proof-confirmed wins and server-attributed forfeits share one settlement transaction for rating, league, Master Rating, anomaly, audit, and leaderboard updates. Player-declared draws are no-contest during the controlled alpha.

## Run archived Master leaderboard smoke

This local-only check creates a temporary archived Master standing, changes the player's current profile region, and verifies through the real leaderboard endpoint that the historical standing remains in its captured region. It also proves the display name can remain current without changing the historical regional cohort, then removes its temporary account and season.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/gravity_well API_BASE_URL=http://127.0.0.1:3000 SMOKE_EXPECT_API_HOSTNAME=127.0.0.1 SMOKE_EXPECT_DATABASE_ID=local SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT=development npm run api:smoke:archived-master-leaderboard
```

The script refuses both a non-local database and a non-loopback API. Its `gw.archived-master-leaderboard-smoke.v1` report is written under `apps/api/build-artifacts/archived-master-leaderboard-smoke/` by default.

## Run ranked season transition smoke

This local-only check drives the real reset service through an expired season, Rating and Master snapshot capture, next-season creation, and a post-capture profile-region change. The complete scenario runs inside one table-locked transaction that is intentionally rolled back; a second connection then proves no temporary account, season, snapshot, or reset-run row survived and that every pre-existing season remained unchanged.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/gravity_well npm run api:smoke:ranked-season-transition
```

The script refuses a non-local database and emits `gw.ranked-season-transition-smoke.v1` under `apps/api/build-artifacts/ranked-season-transition-smoke/` by default.

## Run API process-replacement smoke

This starts two API processes sequentially against the same migrated PostgreSQL database. It creates a ranked session and verified proof submission on the first process, forces a runtime checkpoint, replaces the process, then verifies that the second process restores the disconnected participant, WebRTC offer, used reconnect id, and pending ranked result before completing reconnect and proof-backed settlement.

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/gravity_well npm run api:smoke:matchmaking-restart
```

`MATCHMAKING_RESTART_SMOKE_PORT` defaults to `8791`. The smoke is self-contained and does not call Neon or any hosted service. It proves single-service process replacement over durable PostgreSQL state; it does not replace the required multi-instance staging, PostgreSQL interruption, or remote-browser reconnect rehearsals.

## Run database interruption smokes

The focused smoke targets only PostgreSQL connections owned by an explicitly named API process. Start a local API with `PGAPPNAME=gravity-well-db-smoke-local`, then run:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/gravity_well API_BASE_URL=http://127.0.0.1:8787 SMOKE_EXPECT_API_HOSTNAME=127.0.0.1 SMOKE_EXPECT_DATABASE_ID=local SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT=development DATABASE_INTERRUPTION_TARGET_APP_NAME=gravity-well-db-smoke-local npm run api:smoke:database-interruption
```

It refuses a remote database by default, terminates only exact application-name matches, requires replacement backend PIDs, and verifies readiness plus API identity after recovery. Every API-targeting smoke requires an independently configured expected hostname, database ID, and deployment environment; rejects hosted HTTP, URL credentials, and redirects; and bounds identity requests with `SMOKE_TARGET_REQUEST_TIMEOUT_MS` (default 5000ms, range 100-30000ms). A remote rehearsal additionally requires `ALLOW_REMOTE_DATABASE_SMOKE=1`, an HTTPS staging/canary URL, and matching staging/canary expectations. Production is always refused. The multi-instance smoke performs a stronger version with an active ranked session:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/gravity_well npm run api:smoke:matchmaking-multi-instance
```

Its v2 report must confirm both API PIDs survived and active session, heartbeat, signaling, transport generation, reconnect replay protection, and drain state still work after backend replacement. It also replays a superseded snapshot writer generation and requires `staleSnapshotWriterFenced: true`, proving the database rejects the write without changing current state. These local socket-failure gates do not satisfy the separate staging database outage/failover rehearsal.

## Run authoritative ranked forfeit smoke

Start the API with a short local reconnect window, then run:

```bash
API_BASE_URL=http://127.0.0.1:8787 SMOKE_EXPECT_API_HOSTNAME=127.0.0.1 SMOKE_EXPECT_DATABASE_ID=local SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT=development npm run api:smoke:ranked-authoritative-forfeit
```

The default smoke creates a ranked match, verifies authenticated heartbeat acceptance and token rejection, reports one participant disconnected twice, proves the second report cannot extend the original deadline, waits for timeout, and confirms a single `server_authoritative` forfeit settlement. It then lets both peers time out together and requires a durable unrated `no_contest`. Participant result reads must work without the expired match-session token, outsiders must receive `403`, and, when `DATABASE_URL` is supplied, the smoke verifies the immutable terminal rows, exactly one rated forfeit match, zero no-contest matches, and zero heartbeat SLO writes. `AUTHORITATIVE_FORFEIT_SMOKE_TIMEOUT_MS` is a minimum per-scenario budget; the runner automatically extends it to cover the heartbeat timeout plus reconnect grace published by the matched session, with a bounded scheduler cushion.

For a local silent-client rehearsal, start the API with short heartbeat and reconnect windows, then set `AUTHORITATIVE_FORFEIT_TRIGGER=heartbeat_timeout`. The live participant keeps pulsing while the silent participant is suspended and timed out; a stale pulse must return `participant_disconnected` until nonce-protected reconnect. Double disconnects and unattributed session expiry are intentionally not rated.

## Run ranked season reset job

```bash
npm run api:season-reset
```

Season rollover and ranked settlement use the same transaction-scoped advisory lock. Every expired active season is snapshotted before it is archived, including rollover triggered by normal API traffic; delayed authoritative results are assigned to the season active when settlement is processed rather than recreating a historical window. If another transition owns the lock, the CLI exits unsuccessfully so its scheduler can retry, and `POST /ranked/seasons/reset` returns `503` with `Retry-After: 5` and `code=ranked_season_reset_locked`.

## Generate weekly SLO report

```bash
npm run api:slo-report
```

## Check migration compatibility

```bash
npm run api:migrations:compat
```

## Run deploy health gate

```bash
npm run api:deploy:health-gate
```

Before replacing an API process, pause queue joins and wait for active relay sessions to finish:

```bash
API_BASE_URL=https://api.gravitywell.space DEPLOY_EXPECT_API_HOSTNAME=api.gravitywell.space API_OPS_ADMIN_KEY=<key> npm run api:deploy:drain-gate
```

Both deployment gates require an independently configured expected API hostname, reject hosted HTTP and redirects, and bound each request with `DEPLOY_FETCH_TIMEOUT_MS` (default 5000ms, maximum 30000ms). Use `DEPLOY_DRAIN_ACTION=resume` to reopen matchmaking if the deploy trigger fails. Local HTTP rehearsal additionally requires `DEPLOY_ALLOW_INSECURE_LOCALHOST=true` and only accepts loopback hostnames. The hosted workflow does not permit either the insecure-localhost exception or the legacy no-drain bypass.

## Backup and restore automation

- Scheduled backup workflow: `.github/workflows/ops-backups.yml`
- Scheduled restore drill workflow: `.github/workflows/ops-restore-drill.yml`
- Backup workflow expects repository secrets:
- `DATABASE_URL`
- `REDIS_URL`
- Restore drill generates markdown artifact report with observed RPO/RTO and verification checks.

## Authentication safety

Migration `023_auth_rate_limit_buckets.sql` stores fixed-window counters by scope and HMAC-pseudonymized subject. Each auth request consumes all applicable source and principal buckets in one atomic PostgreSQL operation, so concurrent API instances share the same boundary. Raw IP addresses, emails, and Steam tickets are not stored in the bucket table. Hexadecimal ticket subjects are case-canonicalized, and expired rows are pruned in bounded `SKIP LOCKED` batches at startup and on the cleanup interval. A successful web sign-in clears only that principal's failure bucket; its source bucket remains intact.

Run the database and route checks locally without hosted compute:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/gravity_well'
npm run api:migrate
npm run api:smoke:auth-rate-limit
```

With the local API running, set `API_BASE_URL=http://127.0.0.1:8787`, `SMOKE_EXPECT_API_HOSTNAME=127.0.0.1`, `SMOKE_EXPECT_DATABASE_ID=local`, and `SMOKE_EXPECT_DEPLOYMENT_ENVIRONMENT=development`, then run `npm run api:smoke:auth-security`. The complete `npm run alpha:local-integration` runner supplies these local expectations automatically and refuses a non-local database by default.

## Ranked proof replay safety

Ranked proof verification reuses the durable PostgreSQL buckets from migration `023_auth_rate_limit_buckets.sql`. After bearer and match-session participant validation, duplicate-submission checks, and other inexpensive request validation, the API atomically consumes an HMAC-pseudonymized account+session bucket and account-hour bucket immediately before synchronous proof replay. The account+session subject includes the submitting account, so invalid attempts by one peer do not consume the other peer's valid settlement path. A denied request returns retryable `429 ranked_proof_rate_limited` with `Retry-After` and `retryAfterSeconds`; limiter storage failures return `503` and do not run the verifier.

## Endpoints

- `POST /accounts` create a guest account and issue a signed bearer session.
- `GET /accounts/:accountId` fetch account and linked identities for that account's bearer session or the identity administrator.
- `POST /accounts/:accountId/identities` perform an emergency administrative provider link; disabled unless `AUTH_IDENTITY_ADMIN_KEY` is configured.
- `DELETE /accounts/:accountId/identities/:provider` unlink provider identity (`web` or `steam`) for authenticated account owner.
- `GET /identities/:provider/:providerUserId` perform an administrative identity lookup; disabled unless `AUTH_IDENTITY_ADMIN_KEY` is configured.
- `POST /auth/web/signup` create web credential identity, optionally upgrade a bearer-authenticated guest, and issue a signed session.
- `POST /auth/web/signin` authenticate a web credential account and issue a signed session.
- `POST /auth/steam/exchange` verify a `GetAuthTicketForWebApi` ticket with Steam, link/create the account, and issue a signed session.
- `GET /profile` read profile (requires `Authorization: Bearer <token>`).
- `PUT /profile` update profile (requires `Authorization: Bearer <token>`).
- `GET /matchmaking/queue/config` read queue types, regions, and TTL config.
- `GET /matchmaking/access/status` read public access mode/readiness counts without exposing allowlist entries.
- `GET /matchmaking/network/status` read public relay readiness and credential mode without receiving ICE credentials.
- `GET /health` read process liveness, database target class, and deployed release SHA without querying the database.
- `GET /readyz` verify database connectivity and report release SHA, migration head, deployment environment, and stable database identity.
- `POST /matchmaking/network/ice-config` issue account-scoped ICE configuration only for a bearer-authenticated participant with a valid active matchmaking session token.
- `GET /ops/matchmaking/runtime` read protected queue/session drain counters (`x-admin-key: SLO_ADMIN_KEY`).
- `POST /ops/matchmaking/drain` pause or resume queue joins and close queued tickets before process replacement (`x-admin-key: SLO_ADMIN_KEY`).
- `POST /matchmaking/queue/join` join `ranked` or `unranked`; ranked requires exact build, ruleset, balance profile, and supported character compatibility (requires bearer auth).
- `GET /matchmaking/queue/tickets/:ticketId` poll queue ticket state (requires bearer auth).
- `POST /matchmaking/queue/leave` leave queue ticket (requires bearer auth).
- `GET /matchmaking/sessions/:sessionId` read session state for an active or resolved match session.
- `POST /matchmaking/sessions/disconnect` mark local session participant as disconnected and start reconnect grace window.
- `POST /matchmaking/sessions/complete` attest local match completion; the session resolves as completed only after both participants attest.
- `POST /matchmaking/sessions/heartbeat` refresh bearer- and session-token-authenticated participant liveness and durably checkpoints the coordinated runtime snapshot before returning.
- `POST /matchmaking/sessions/reconnect` reconnect with session token and one-time reconnect attempt id.
- `POST /matchmaking/sessions/:sessionId/signals` publish a quota-bounded idempotent offer, answer, or ICE message addressed to the authenticated peer. Hashed participant credentials and current transport generation are checked through an indexed durable projection without taking the global matchmaking lease.
- `GET /matchmaking/sessions/:sessionId/signals` poll unexpired peer signaling with a monotonic signal cursor. The lock-free access projection fails closed at session or reconnect expiry. Send the opaque participant credential in `x-match-session-token`, never in the URL.
- `POST /matchmaking/sessions/:sessionId/transport-attempts` lets P1 atomically advance the server-owned connection generation. Signal publish/poll requires that exact attempt id and rejects superseded mailboxes.
- `POST /ranked/results` submit a complete deterministic match proof; the API derives the result and ratings settle only after the peer submits the same verified proof digest.
- `GET /ranked/results/:sessionId` polls proof consensus, `authoritative_pending`, accepted forfeit, or durable `no_contest` status. Active sessions require `x-match-session-token`; after a terminal decision or match is durable, either recorded participant can read it with bearer authentication alone and outsiders receive `403`.
- `GET /ranked/progression` read ranked progression snapshot for the current or requested started season; scheduled seasons return `ranked_season_not_started`.
- `GET /ranked/leaderboard` read a snapshot-consistent ranked leaderboard page with pagination (`limit`, `offset`), optional `region` filter, and optional `track=master`; scheduled seasons return `ranked_season_not_started`.
- `GET /ops/slo/summary` read live SLO rollup, alerts, and top route breakdown (`x-admin-key` required).
- `POST /admin/enforcement/actions` create warning, suspension, or ban action (`x-admin-key` required).
- `GET /admin/enforcement/actions` list enforcement actions and latest appeal status (`x-admin-key` required).
- `GET /enforcement/me` list authenticated account sanctions and appeal statuses.
- `POST /enforcement/appeals` submit an appeal for a sanction on authenticated account.
- `POST /admin/enforcement/appeals/:appealId/review` move appeal to `under_review`, `accepted`, or `rejected` and optionally revoke action (`x-admin-key` required).
- `GET /ranked/anomalies/alerts` list ranked anomaly alerts for operations (`x-admin-key` required).
- `POST /ranked/anomalies/alerts/:alertId/review` mark alert as `false_positive` or `confirmed` (`x-admin-key` required).
- `POST /ranked/seasons/reset` archive expired active season standings and roll to next season (`x-admin-key` required).
- `POST /matchmaking/network/connection-telemetry` store direct or relay path telemetry by region.
- `GET /matchmaking/network/connection-telemetry/summary` read telemetry summary with optional `region` and `queueType` filters.
- `GET /rooms/config` read private room lifecycle configuration.
- `POST /rooms` create private room (server-generated code, host auto-joined).
- `GET /rooms/:roomCode` read room state for participants.
- `POST /rooms/:roomCode/join` join private room as player or spectator with region and build compatibility checks.
- `POST /rooms/:roomCode/settings` host updates room settings such as lock state and spectator allowance.
- `POST /rooms/:roomCode/character-select` submit character selection for current room session.
- `POST /rooms/:roomCode/ready` submit ready check state for current room session.
- `POST /rooms/:roomCode/outcome` host records match outcome for current room session.
- `POST /rooms/:roomCode/rematch` host starts rematch while keeping room membership.
- `POST /rooms/:roomCode/start` host starts room session.
- `POST /rooms/:roomCode/close` host closes room.
- `GET /rooms/:roomCode/invite?platform=web|steam` generate invite payload for web or Steam friend flow.
- `POST /replays/ingest` persist replay metadata and compressed payload blob.
- `GET /replays/search` search replay summaries with player-centric filters and cursor pagination.
- `GET /replays/:replayId` read replay metadata for participants.
- `GET /replays/:replayId/payload` read replay payload blob for participants.
- `DELETE /replays/:replayId` delete replay and record deletion event.
- `POST /friends/requests/send` send a friend request (`pending`).
- `POST /friends/requests/:requestId/accept` accept incoming request (`accepted`) and create friendship edge.
- `POST /friends/requests/:requestId/decline` decline incoming request (`declined`).
- `POST /friends/requests/:requestId/cancel` cancel outgoing request (`cancelled`).
- `POST /friends/remove` remove existing friendship.
- `POST /friends/block` block account (`blocked`) and cancel pending requests.
- `GET /friends/list` list accepted friend edges for authenticated account.
- `GET /friends/requests` list friend request history with optional `status` filter.
- `POST /presence` update authenticated account presence status and activity.
- `GET /friends/presence` list friend presence with privacy-safe activity fields.
- `POST /friends/invites/send` send friend invite for room or queue context.
- `GET /friends/invites` list active incoming friend invites.
- `POST /friends/invites/:inviteId/cancel` cancel invite as sender or target.
- `GET /social/privacy` read social privacy settings for authenticated account.
- `PUT /social/privacy` update social privacy (`presenceVisibility`, `invitePermissions`).
- `GET /social/moderation/controls` list muted/blocked controls owned by authenticated account.
- `POST /social/moderation/mute` mute target account for social actions.
- `POST /social/moderation/unmute` unmute target account.
- `POST /social/moderation/unblock` unblock target account while preserving mute state.

## Matchmaking queue request example

```json
{
  "queueType": "ranked",
  "regionPreferences": ["us-east", "us-west"],
  "buildVersion": "alpha-release-sha",
  "rulesetVersion": "prototype-2026.02",
  "balanceProfileId": "default",
  "platform": "web",
  "characterId": "vanguard"
}
```

## Web auth request examples

Sign up:

```json
{
  "email": "player@example.com",
  "password": "replace_with_secure_password",
  "displayName": "Player One"
}
```

Guest upgrade sign up:

```json
{
  "email": "player@example.com",
  "password": "replace_with_secure_password",
  "upgradeAccountId": "11111111-1111-4111-8111-111111111111"
}
```

Sign in:

```json
{
  "email": "player@example.com",
  "password": "replace_with_secure_password"
}
```

Steam exchange:

```json
{
  "steamTicket": "replace_with_fresh_hexadecimal_steam_web_api_ticket",
  "linkToAuthenticatedAccount": true,
  "displayName": "Steam Player"
}
```

Use the account bearer token with `linkToAuthenticatedAccount: true` only when explicitly adding an unclaimed Steam identity to that account. For first-time or returning Steam sign-in, omit both the bearer token and `linkToAuthenticatedAccount`.

Friend request send:

```json
{
  "targetAccountId": "22222222-2222-4222-8222-222222222222"
}
```

Presence update:

```json
{
  "status": "online",
  "activityType": "queue",
  "queueType": "ranked"
}
```

Friend invite send (room):

```json
{
  "targetAccountId": "22222222-2222-4222-8222-222222222222",
  "contextType": "room",
  "roomCode": "ABCD42"
}
```

Social privacy update:

```json
{
  "presenceVisibility": "friends",
  "invitePermissions": "friends"
}
```

Social mute target:

```json
{
  "targetAccountId": "22222222-2222-4222-8222-222222222222",
  "reason": "spam_invites"
}
```

Ranked result submission:

```json
{
  "sessionId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "sessionToken": "replace_with_match_session_token",
  "matchId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "participantAccountIds": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ],
  "winnerAccountId": "11111111-1111-4111-8111-111111111111",
  "outcome": "p1_win",
  "proof": {
    "schemaVersion": 1,
    "simulatorVersion": "gw.ranked-sim.v1",
    "sessionId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "matchId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "buildVersion": "alpha-release-sha",
    "rulesetVersion": "prototype-2026.02",
    "balanceProfileId": "default",
    "tuningFingerprint": "fnv1a32:...",
    "characterRegistryFingerprint": "gw.character-registry.v1:...",
    "seed": 123,
    "fixedDt": 0.016666666666666666,
    "loadout": { "P1": "vanguard", "P2": "duelist" },
    "rounds": [
      { "epoch": 0, "winner": "P1", "finalChecksum": 123, "inputs": [[0, 0, 0, 0, 0, 0]] }
    ],
    "claimedOutcome": "p1_win"
  }
}
```

The abbreviated example is structural only; a valid best-of-three proof contains two or three complete, server-replayable rounds. See `docs/RANKED_RESULT_VERIFICATION.md`.

## Notes

- Valid providers are `steam` and `web`.
- Identity linking writes to `identity_link_events` for audit trace.
- Web sign-up supports `upgradeAccountId` for guest-to-account upgrade when `x-account-id` matches.
- Web auth recovery/error flows include explicit responses for invalid credentials, duplicate email, and disabled accounts.
- Web auth events are tracked in `account_auth_events` for signup/signin success and failures.
- Authentication entry points use shared PostgreSQL source/principal limits and return `429` with `Retry-After`; limiter failures return `503` rather than bypassing protection.
- Steam exchange requires a valid Steam ticket and explicit `linkToAuthenticatedAccount: true` confirmation when an authenticated account is present.
- Steam identities are never merged across accounts. A cross-account conflict returns an error without moving data or disabling either account; legacy `mergeAccountId` requests are rejected.
- Audit coverage: `identity_link_events` capture successful and failed explicit links. Historical `account_merge_events` remain read-only evidence of the retired merge flow.
- Friend graph schema uses `friend_requests` (states: pending, accepted, declined, cancelled, blocked) and `friendships` (accepted edges).
- Friend workflows supported by API: send, accept, decline, cancel, remove, block, and list.
- Friend request and friendship queries are index-backed for requester, target, status, and pair lookups.
- Presence endpoint exposes privacy-safe activity fields (`queueType` or in-room boolean, not room code) for friend presence views.
- Friend invite payload includes context plus web and Steam deep links for queue and room invites.
- Presence and invite flows are rate-limited and audited in `presence_invite_events`.
- Social privacy settings support `presenceVisibility` (`friends` or `private`) and `invitePermissions` (`friends` or `none`).
- Block and mute controls are enforced for friend requests and invites in both sender and target directions.
- Moderation actions and policy rejections are audited in `social_moderation_events` with actor, target, reason, metadata, and timestamp.
- Supported queue regions are `us-east`, `us-west`, `eu-west`, and `ap-southeast`.
- Queue match payload includes session token and peer metadata for handshake bootstrapping.
- Ranked queue match payload includes diagnostics (`skillTrack`, `expectedGap`, `matchedGap`, `waitSeconds`, `regionConstraintRelaxed`) for matchmaking review.
- Session tokens expire and reconnect attempts use one-time ids for replay protection.
- Ranked result submissions require a valid session token and independently replayable proof. Invalid/tampered proofs return `422`; mismatched valid peer proof digests are flagged with `review_status = pending`.
- Verified proof payloads are stored once in `ranked_match_proofs`; both participant submissions reference the canonical SHA-256 digest.
- Client-declared draws and forfeits cannot change ratings. A uniquely attributed reconnect timeout or matched-ticket leave is first committed to `ranked_terminal_decisions` in the same transaction as the matchmaking snapshot, then settles through `ranked_authoritative_resolutions` as a server-owned forfeit. Double disconnects and generic expiry are durably recorded as no-contests and remain unrated.
- Accepted ranked results persist per-player pre/post rating deltas in `ranked_match_rating_deltas`.
- Ranked seasons have explicit start/end windows (`ranked_seasons`) and archived snapshots (`ranked_season_standings`).
- Season reset job archives standings, stamps historical matches by season, and creates the next active season window.
- League ladder progression tracks `Iron`, `Bronze`, `Silver`, `Gold`, `Platinum` with league-point promotion and demotion.
- Placement flow assigns the initial league tier after configurable calibration matches.
- Master track entry is threshold-based (`RANKED_MASTER_ENTRY_RATING`) and MR points update per ranked match with configurable weighting (`RANKED_MR_WEIGHT_RANKED`).
- Season reset snapshots both base standings (`ranked_season_standings`) and master standings (`ranked_master_season_standings`); new seasons start with no master entries until players re-qualify.
- Ranked anomaly detection writes `ranked_anomaly_alerts` for impossible cadence, rating jump, and MR jump heuristics.
- False-positive/confirmation handling is documented in `docs/RANKED_ANOMALY_REVIEW_FLOW.md`.
- Enforcement actions are stored in `enforcement_actions` (warning, suspension, ban) with actor identity and optional anomaly source alert linkage.
- Appeal lifecycle is tracked in `enforcement_appeals` (`submitted`, `under_review`, `accepted`, `rejected`) with reviewer audit metadata.
- Active suspension/ban actions block online queue join and ranked result submission.
- API records per-request samples in `service_slo_request_samples` for availability/error/latency SLO calculations. Storage retains whichever is smaller: the configured age window or newest-row cap. Cleanup runs at startup, periodically, and every 100 database-wide inserts; each pass is batch-limited and guarded by a PostgreSQL transaction advisory lock so multiple API instances cannot prune concurrently. At higher traffic, the row cap can shorten a requested report window.
- Weekly SLO markdown reports are generated by `npm run api:slo-report` into `docs/reports/`.
- SLO targets, alert rules, and escalation policy are defined in `docs/SLO_ALERTING_POLICY.md`.
- Backup and disaster-recovery policy and targets are defined in `docs/DISASTER_RECOVERY_RUNBOOK.md`.
- Safe rollout, rollback policy, and migration compatibility rules are defined in `docs/SAFE_DEPLOYMENT_STRATEGY.md`.
- Reconnect grace window is configurable in queue service configuration.
- NAT config uses STUN and TURN servers from environment values. Staging/production web clients refuse online bootstrap when `relayAvailable` is false.
- Telemetry endpoint tracks direct vs relay connection outcomes by region.
- Room codes are generated server-side and room lifecycle closes on idle timeout.
- Room join errors include clear recovery guidance for lock, region mismatch, version mismatch, spectator controls, and capacity.
- Host can lock rooms and toggle spectator allowance through room settings endpoint.
- Room sessions run character select and ready phases per match, and rematch resets only session state.
- Room history stores match ids, rematch index, outcome, winner, and character selections for audit review.
- Invite payload supports web link and Steam friend flow formats.
- Replay ingest stores metadata in PostgreSQL and compressed payload blobs in object storage abstraction (local blob directory for development).
- Replay metadata includes both players, characters, match type, patch version, outcome, and duration.
- Replay search filter support: `playerId`, `opponentId`, `character`, `matchup`, `queueType`, `from`, `to`, `patchVersion`, `limit`, and `cursor`.
- Replay search uses newest-first keyset pagination and returns stable `replayId` values for playback fetch.
- Retention defaults: ranked 365 days, casual 90 days. Override with `REPLAY_RETENTION_DAYS_RANKED` and `REPLAY_RETENTION_DAYS_CASUAL`.
- Deletion flow: participant calls `DELETE /replays/:replayId`, API marks replay deleted, logs `replay_deletion_events`, and removes blob payload.
- Neon migration checklist lives in `docs/NEON_SETUP_ACTION.md`.
