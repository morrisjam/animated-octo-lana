# Replay Archive And Review Design (CFN-style)

## Goal
Store and review past matches with low storage weight, fast player search, and deterministic playback with both input and frame-data overlays.

## CFN-inspired baseline
- CFN replay UX patterns we should mirror:
  - Replay list plus search flow from the CFN menu.
  - Saving selected matches into a personal replay list.
  - Replay controls for pause, frame-step, and round navigation.
- Modern SF6 replay flow also surfaces recent match replay directly from result screens.
- We should explicitly version replay payloads and warn on incompatible versions after major balance patches.

## Product scope
- Match replays are available from match history and player profile views.
- Replay review shows:
  - Both players' per-frame inputs.
  - Frame-data timeline events (startup, active, recovery, hit or block outcomes, advantage markers).
  - Playback controls: pause, step, speed, and round jump.
- Replay search supports CFN-like lookup by player and matchup filters.

## Storage strategy (low-weight)
- Store replays as deterministic input logs, not full world snapshots.
- Replay payload structure:
  - header: `seed`, `payloadVersion`, `rulesetVersion`, `simBuildHash`, and deterministic step config.
  - round descriptors and frame counts.
  - frame input stream for each side with delta or run-length encoding.
  - optional sparse checkpoint snapshots every N frames for fast seek.
  - optional frame-event stream for precomputed overlay data.
- Compress payload with Zstandard before object storage upload.
- Keep searchable metadata in PostgreSQL.

## Data model (minimum)
- `replays`
  - `replay_id` UUID PK
  - `match_id` UUID UNIQUE
  - `queue_type`, `region`, `started_at`, `ended_at`
  - `ruleset_version`, `sim_build_hash`, `payload_version`
  - `storage_key`, `compressed_bytes`, `sha256`
- `replay_participants`
  - `replay_id` FK
  - `account_id` FK
  - `side` SMALLINT
  - `character_id`
  - `result`
- `replay_tags` (optional)
  - `replay_id` FK
  - `tag`

Recommended indexes:
- `replay_participants (account_id, replay_id desc)`
- `replay_participants (account_id, character_id, replay_id desc)`
- `replays (started_at desc)`
- `replays (started_at desc, replay_id desc) where deleted_at is null`
- `replays (queue_type, started_at desc)`
- `replays (queue_type, patch_version, started_at desc, replay_id desc) where deleted_at is null`
- `replays (ruleset_version, started_at desc)`

## Ingest pipeline
1. Match end finalises deterministic input timeline.
2. Server validates payload header and checksum.
3. Server compresses payload and writes blob to object storage.
4. Server writes metadata rows and participant rows to PostgreSQL.
5. API emits replay id to both players' history feeds.

Current API implementation:
- `POST /replays/ingest` stores replay metadata in PostgreSQL and compressed payload blobs via object storage adapter.
- Development storage provider is local filesystem blobs (`REPLAY_BLOB_PROVIDER=local`).
- Metadata captures: queue type, match type, region, patch version, ruleset version, sim build hash, outcome, duration, and participant character selections.

## Playback pipeline
1. Client requests replay metadata and blob URL.
2. Client downloads and decompresses payload.
3. Client creates sim state from replay header seed and ruleset version.
4. Client replays frame inputs through deterministic `step`.
5. Viewer reads input stream and frame-event stream to draw overlays.

Current client implementation:
- Web client includes a replay review panel reachable from the home menu (currently wired to smoke fixture for development flow).
- Replay panel shows:
  - both player input timelines
  - per-player startup/active/recovery states for launch, dunk, and special
  - recent move resolution events with hit/block/whiff labels and frame-advantage markers
- Playback controls support pause, frame-step, speed control, slider seek, and round jumps.

## Search API shape
- `GET /replays/search?playerId=...&opponentId=...&character=...&matchup=...&queueType=...&from=...&to=...&patchVersion=...&limit=...&cursor=...`
- Return:
  - replay summary list (players, characters, date, duration, queue, outcome).
  - `nextCursor` for pagination.
- Default sort: newest first.

Current API implementation:
- Replay search is keyset-paginated by `(started_at, replay_id)` descending.
- Search scope is the authenticated account's replay history (`x-account-id`) with optional opponent and matchup filters.
- Response includes replay summary rows plus stable `replayId` values for playback fetch.

## Compatibility policy
- Replay metadata includes `rulesetVersion` and `simBuildHash`.
- If playback client does not support replay version, viewer shows `incompatible replay version`.
- Keep at least one migration path for minor schema updates.
- Expect some older replays to be non-playable after major gameplay patches.

## Current payload baseline (S2.13)
- Payload format is explicitly versioned at `payloadVersion = 1`.
- Required payload fields:
  - `header.payloadVersion`
  - `header.rulesetVersion`
  - `header.simBuildHash`
  - `inputTimeline` frame input stream
- Unsupported payload versions fail validation with explicit error codes and messages.

## Size budget check
- CI budget target: median replay payload size must be `<= 4096` bytes for fixture set.
- Measurement is run with `npm run replay:size-check` in `apps/game-web`.
- Fixture source folder: `apps/game-web/replays/*.replay.json`.

## External references
- SF6 replay list, search filters, and replay tools (community guide): https://gamerant.com/sf6-street-fighter-6-how-view-replays/
- SF6 replay quality-of-life updates from match result screen (community coverage of official announcement): https://www.eventhubs.com/news/2025/jan/29/sf6-match-replays-immediate-update/
- SF6 patch note coverage describing replay version incompatibility after updates: https://www.eventhubs.com/news/2025/feb/04/mai-patch-note/
- Official SF6 frame data reference format: https://www.streetfighter.com/6/en-uk/character/luke/frame
- PostgreSQL indexes: https://www.postgresql.org/docs/current/indexes.html
- Protocol Buffers encoding: https://protobuf.dev/programming-guides/encoding/
- Zstandard compression format: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md

## Privacy and retention
- Players can delete locally saved favourites.
- Server retention defaults:
  - ranked and tournament: long retention.
  - casual and private rooms: shorter retention.
- Include account-level replay visibility settings.

Current retention and deletion policy:
- Ranked replay retention default: 365 days.
- Casual replay retention default: 90 days.
- Retention values are configurable via environment.
- Replay deletion flow:
  1. Participant requests `DELETE /replays/:replayId`.
  2. API verifies participant access.
  3. Replay row is soft-deleted and deletion event is recorded.
  4. Blob payload is removed from object storage.

## Milestones
1. `S2.13`: compact payload format with fixtures and size budget checks.
2. `S2.14`: ingest pipeline and database plus object storage persistence.
3. `S2.15`: replay search API with player-centric filters.
4. `S2.16`: replay viewer with input and frame-data overlays.
