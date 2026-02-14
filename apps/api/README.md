# API Quickstart

Workspace path: `apps/api`.

## Environment

Set `DATABASE_URL` to a PostgreSQL connection string.

Optional:
- `API_PORT` defaults to `8787`.
- `PORT` overrides `API_PORT` when provided by your hosting platform.
- `API_CORS_ORIGINS` is a comma-separated browser origin allowlist (defaults to localhost dev URLs).
- `MATCHMAKING_TICKET_TTL_SECONDS` defaults to `90`.
- `MATCHMAKING_SESSION_TTL_SECONDS` defaults to `30`.
- `MATCHMAKING_SESSION_TOKEN_TTL_SECONDS` defaults to session TTL.
- `MATCHMAKING_RECONNECT_GRACE_SECONDS` defaults to `10`.
- `MATCHMAKING_CLOSED_RETENTION_SECONDS` defaults to `120`.
- `MATCHMAKING_STUN_URLS` optional comma-separated STUN URL list.
- `MATCHMAKING_TURN_URLS` optional comma-separated TURN URL list.
- `MATCHMAKING_TURN_USERNAME` and `MATCHMAKING_TURN_CREDENTIAL` for TURN relay auth.
- `MATCHMAKING_DIRECT_CONNECT_TIMEOUT_MS` defaults to `1800`.
- `MATCHMAKING_TELEMETRY_RETENTION_MS` defaults to `86400000` (24h).
- `ROOM_IDLE_TIMEOUT_SECONDS` defaults to `900`.
- `ROOM_CLOSED_RETENTION_SECONDS` defaults to `1800`.
- `ROOM_MAX_PARTICIPANTS` defaults to `2`.
- `ROOM_MAX_SPECTATORS` defaults to `4`.
- `ROOM_MAX_HISTORY_ENTRIES` defaults to `20`.
- `ROOM_WEB_INVITE_BASE_URL` defaults to `http://localhost:5173`.
- `STEAM_APP_ID` defaults to `0` for steam invite payload generation.
- `PRESENCE_TTL_MS` defaults to `300000` (5 minutes).
- `PRESENCE_RATE_WINDOW_MS` defaults to `30000` (30 seconds).
- `PRESENCE_MAX_UPDATES_PER_WINDOW` defaults to `12`.
- `FRIEND_INVITE_TTL_MS` defaults to `90000` (90 seconds).
- `FRIEND_INVITE_RATE_WINDOW_MS` defaults to `60000` (60 seconds).
- `FRIEND_INVITE_MAX_PER_WINDOW` defaults to `5`.
- `REPLAY_BLOB_PROVIDER` defaults to `local`.
- `REPLAY_BLOB_DIR` defaults to `./data/replay-blobs`.
- `REPLAY_RETENTION_DAYS_RANKED` defaults to `365`.
- `REPLAY_RETENTION_DAYS_CASUAL` defaults to `90`.

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

This starts `postgres:16-alpine` with:
- database: `gravity_well`
- user: `postgres`
- password: `postgres`
- port: `5432`

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

## Run API tests

```bash
npm run api:test
```

## Endpoints

- `POST /accounts` create account.
- `GET /accounts/:accountId` fetch account and linked identities.
- `POST /accounts/:accountId/identities` link provider identity.
- `DELETE /accounts/:accountId/identities/:provider` unlink provider identity (`web` or `steam`) for authenticated account owner.
- `GET /identities/:provider/:providerUserId` resolve linked account.
- `POST /auth/web/signup` create web credential identity, with optional guest account upgrade.
- `POST /auth/web/signin` authenticate a web credential account.
- `POST /auth/steam/exchange` exchange Steam ticket and link to existing account or create one on first Steam sign-in.
- `GET /profile` read profile (requires `x-account-id` header).
- `PUT /profile` update profile (requires `x-account-id` header).
- `GET /matchmaking/queue/config` read queue types, regions, and TTL config.
- `GET /matchmaking/network/ice-config` read ICE servers, transport policy, and relay fallback timeout.
- `POST /matchmaking/queue/join` join `ranked` or `unranked` queue with region preferences (requires `x-account-id` header).
- `GET /matchmaking/queue/tickets/:ticketId` poll queue ticket state (requires `x-account-id` header).
- `POST /matchmaking/queue/leave` leave queue ticket (requires `x-account-id` header).
- `GET /matchmaking/sessions/:sessionId` read session state for an active or resolved match session.
- `POST /matchmaking/sessions/disconnect` mark local session participant as disconnected and start reconnect grace window.
- `POST /matchmaking/sessions/reconnect` reconnect with session token and one-time reconnect attempt id.
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
  "queueType": "unranked",
  "regionPreferences": ["us-east", "us-west"],
  "buildVersion": "0.1.0-dev",
  "platform": "web"
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
  "steamTicket": "dev-steam:76561198012345678",
  "mergeAccountId": "11111111-1111-4111-8111-111111111111",
  "displayName": "Steam Player"
}
```

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

## Notes

- Valid providers are `steam` and `web`.
- Identity linking writes to `identity_link_events` for audit trace.
- Web sign-up supports `upgradeAccountId` for guest-to-account upgrade when `x-account-id` matches.
- Web auth recovery/error flows include explicit responses for invalid credentials, duplicate email, and disabled accounts.
- Web auth events are tracked in `account_auth_events` for signup/signin success and failures.
- Steam exchange supports `mergeAccountId` when `x-account-id` matches authenticated account.
- Merge policy: when Steam identity already belongs to a different account, provided guest/web account is merged into Steam-linked account, source account is disabled, and transferable web credentials/profile data are preserved when safe.
- Audit coverage: `identity_link_events` capture link/unlink actions, and `account_merge_events` capture account merge operations.
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
- Session tokens expire and reconnect attempts use one-time ids for replay protection.
- Reconnect grace window is configurable in queue service configuration.
- NAT config uses STUN and optional TURN relay servers from environment values.
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
