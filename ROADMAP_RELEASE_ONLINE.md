# Release And Online Roadmap (Web + Steam First)

## Objectives
- Ship a stable Web and Steam PC version from one codebase.
- Add competitive online play with rollback netcode.
- Add persistent accounts, progression, and rankings.
- Keep a clear path to consoles later, without forcing a rewrite now.

## Feasibility Summary
- Keeping a browser client is feasible and useful for rapid iteration and broad reach.
- Shipping on Steam is feasible from the same gameplay core.
- Console release is a later track and needs partner approvals, SDK access, and certification.
- Rollback netcode is feasible if the simulation is deterministic and serialisable.

## Target Architecture
### Client stack (in game)
- **Language/runtime now**: TypeScript + Vite + Three.js.
- **Game core**: deterministic sim package (`src/sim`) with no DOM and no renderer types.
- **Platform adapters**:
  - Web adapter: browser input, browser storage, browser networking.
  - Steam adapter: Steam API wrapper for auth, presence, invites, achievements, and stats.
- **Networking abstraction**: one transport interface, multiple providers.
  - Web provider: WebRTC DataChannels (with TURN fallback).
  - Steam provider: either WebRTC for cross-play parity, or Steam networking for Steam-only queues.
- **Persistence client side**: local profile cache and settings in IndexedDB/localStorage.

### Backend stack (server side)
- **API service**: Node.js (Fastify or NestJS) with TypeScript.
- **Primary database**: PostgreSQL.
- **Cache and queue**: Redis.
- **Auth and identity**:
  - Internal account id as source of truth.
  - Platform links: Steam identity plus web identity.
- **Matchmaking service**:
  - Queue management and region selection.
  - Match proposals and session tokens.
- **Ranking service**:
  - Elo-like league points for `Iron` to `Platinum`.
  - MR points for Master-track players.
  - Seasonal resets and rewards.
- **Telemetry**:
  - Structured logs, traces, and metrics with OpenTelemetry.
- **Networking support**:
  - STUN/TURN (coturn) for WebRTC path.
- **Deployment**:
  - Docker images, IaC, CI/CD pipelines, separate dev/staging/prod environments.

### Recommended hosting blueprint (web and Steam first)
- **Phase 1 to early Phase 2 (lean setup)**:
  - PostgreSQL on Neon.
  - Redis on Upstash.
  - Object storage on Cloudflare R2.
  - API and workers on Fly.io, Render, or AWS ECS/Fargate.
- **Late Phase 2 onwards (scale and control)**:
  - PostgreSQL on AWS RDS for PostgreSQL (Multi-AZ).
  - Redis on AWS ElastiCache for Redis.
  - Keep R2 or move to S3 based on egress and operations profile.
  - API and workers on AWS with autoscaling.
- **Why this split**:
  - Faster startup and lower ops burden early.
  - Clear migration path to higher control and predictable operations at scale.

## Three-Phase Plan

## Phase 1: Release Foundation (Web + Steam Offline/Local) (8 to 12 weeks)
### Exit criteria
- Stable Web and Steam PC builds from one branch.
- Determinism harness in place for simulation.
- Platform abstraction boundaries in place.

### Epic 1.1: Platform-ready client architecture
#### Stories
- As a developer, I can run one shared simulation core from Web and Steam adapters.
- As a developer, I can package a Steam build with no CDN/runtime online dependency.
- As a developer, I can switch platform services through a single interface.
#### Deliverables
- `platform/` adapters for web and steam.
- build profiles: `web-dev`, `web-prod`, `steam-dev`, `steam-prod`.
- Steam bootstrap and app id integration.

### Epic 1.2: Determinism and rollback prerequisites
#### Stories
- As a developer, I can serialise and restore full sim state every frame.
- As a developer, I can replay input logs and get identical outcomes.
- As QA, I can detect deterministic divergence with an automated check.
#### Deliverables
- deterministic RNG policy.
- frame checksum generation.
- replay runner CLI and CI test.

### Epic 1.3: Core account and profile baseline
#### Stories
- As a player, my settings and profile persist across sessions.
- As a player, I can sign in with Steam on Steam builds.
- As an operator, I can inspect account links and basic profile data.
#### Deliverables
- account table, profile table, platform identity links.
- web sign-in baseline and Steam sign-in path.
- profile API and minimal admin tooling.

### Epic 1.4: Training mode and frame-data visualiser
#### Stories
- As a player, I can run endless training sessions with fast reset controls.
- As a competitive player, I can inspect move startup, active, and recovery windows from a frame-data registry.
- As a designer, I can rebalance move timings in one central data source.
#### Deliverables
- training mode match variant with no ranked or progression side effects.
- central move frame-data registry consumed by simulation timing logic.
- frame-data visualiser overlay for keyboard and controller flows.

### Epic 1.5: Visual content pipeline and asset strategy
#### Stories
- As a developer, I can load and validate assets through manifests.
- As a designer, I can switch characters between 3D, sprite, or hybrid visual presentation.
- As a technical artist, I can tune action VFX from data and enforce performance budgets.
#### Deliverables
- asset manifest schema and loader abstraction with async preloading.
- character visual profile system decoupled from simulation.
- VFX event binding pipeline for boost, launch, parry, projectile, and dunk.
- asset budget checks and memory diagnostics for development builds.

### Epic 1.6: Audio pipeline and mix direction
#### Stories
- As a developer, I can trigger SFX, music, and voice through one data-driven audio layer.
- As a player, I hear adaptive music and clear action callouts during combat.
- As a player, I can tune mix levels and accessibility options to my listening setup.
#### Deliverables
- audio event bus and routing abstraction with buses for master, music, SFX, and voice.
- adaptive music state system with configurable transitions and fades.
- voice line system with per-character event tables and anti-spam rules.
- audio settings and accessibility controls, including ducking and subtitle toggles.

### Epic 1.7: Enemy AI and single-player arcade mode
#### Stories
- As a player, I can train and play matches against AI opponents with selectable difficulty.
- As a player, I can play a structured arcade ladder with progression and run summaries.
- As a designer, I can tune AI behaviour profiles without rewriting gameplay systems.
#### Deliverables
- deterministic AI decision framework that outputs normal frame inputs.
- data-driven AI difficulty profiles with aggression and defence tuning.
- single-player arcade flow with staged opponents, continues, and completion screen.
- arcade run history and best record tracking per character and difficulty.

## Phase 2: Online Competitive Beta (Rollback + Ranked) (12 to 20 weeks)
### Exit criteria
- Online matches with rollback and reconnect handling.
- Ranked queue and basic anti-abuse controls.
- Beta telemetry and live operations visibility.

### Epic 2.1: Rollback netcode implementation
#### Stories
- As a player, online play feels responsive with prediction and rollback.
- As a player, short packet loss does not end my match.
- As QA, I can inspect rollback events and desync reports.
#### Deliverables
- input delay, prediction, rollback window, resimulation pipeline.
- transport abstraction implementation (WebRTC first).
- desync detector and match diagnostics blob.

### Epic 2.2: Matchmaking and session orchestration
#### Stories
- As a player, I can queue for unranked or ranked matches.
- As a player, I get matched by region and rating constraints.
- As an operator, I can control queue health and region routing.
#### Deliverables
- matchmaking service and queue worker.
- session token issue and validation.
- region-aware queue config.

### Epic 2.3: Ranking, progression, and integrity
#### Stories
- As a player, I receive rank updates after each ranked match.
- As a player, I can view my season rank and history.
- As an operator, I can review suspicious results and disputes.
#### Deliverables
- Elo-like rating model with league tiers `Iron` to `Platinum`.
- Master-track MR points system for top-tier ranked players.
- matchmaking integration that uses league bands and MR proximity.
- post-match result verification pipeline.
- anti-abuse policies: duplicate session checks, anomaly flags.

### Epic 2.4: Custom rooms and private lobbies
#### Stories
- As a player, I can create a private room with an invite code.
- As a player, I can join friends directly without entering ranked queue.
- As a host, I can run rematches and room settings without rebuilding the session.
#### Deliverables
- room service with room codes, host controls, and lifecycle timeouts.
- invite and join UX for web and Steam.
- room rematch pipeline with character select ready checks.

### Epic 2.5: Replay archive and review
#### Stories
- As a player, I can watch past matches for self-review.
- As a coach or analyst, I can inspect input timelines and frame windows by timestamp.
- As an operator, I can keep replay storage lean while preserving fast search by player.
#### Deliverables
- deterministic replay payload format based on input logs plus match seed and ruleset version.
- replay ingest pipeline with metadata in PostgreSQL and compressed payload blobs in object storage.
- replay search API and in-game replay viewer with input plus frame-data overlays.

### Epic 2.6: Beta operations and support
#### Stories
- As a developer, I can trace a failed match end to end.
- As support, I can retrieve a match timeline by match id.
- As product, I can monitor latency, rollback rate, and quit rate.
#### Deliverables
- OpenTelemetry instrumentation and dashboards.
- incident runbooks.
- beta feedback capture flow in game.

### Epic 2.7: Online Dev UI and test harness
#### Stories
- As a developer, I can test matchmaking, room, replay, and ranked API flows from one in-game menu.
- As QA, I can gather online diagnostics without external tooling.
- As a designer, I can trigger replay review from searched replay records in client UI.
#### Deliverables
- Feature-flagged Online Dev menu in client builds for dev and staging.
- Matchmaking and room test panels with clear state/error feedback and controller support.
- Replay search list and playback launch integration.
- Ranked progression debug panel and diagnostics export tooling.

### Epic 2.8: Account and social platform services
#### Stories
- As a player, I can create or link my account across web and Steam without losing progression.
- As a player, I can add friends, manage requests, and send invites into private rooms.
- As an operator, I can enforce privacy, block controls, and social moderation policies.
#### Deliverables
- Account lifecycle implementation with web sign-up/sign-in and Steam linking flow.
- Identity merge policy and audit trail for link/unlink/merge events.
- Friends graph API, presence service, and invite routing with platform-aware links.
- In-game account and friends UI with keyboard/controller support.
- Privacy and moderation controls for block list and invite visibility rules.

## Phase 3: Launch Hardening + Console Readiness (Far Future) (16+ weeks)
### Exit criteria
- Live-ready service reliability and content cadence.
- Cross-platform abstractions tested against console constraints.
- Certification risk reduced before any console commitment.

### Epic 3.1: Production hardening
#### Stories
- As a player, I experience stable uptime and predictable matchmaking.
- As an operator, I can fail over services without data loss.
- As a developer, I can deploy safely with rollback support.
#### Deliverables
- SLOs, autoscaling, backups, disaster recovery drills.
- blue/green or canary deployments.
- schema migration safety controls.

### Epic 3.2: Anti-cheat and trust upgrades
#### Stories
- As a player, ranked integrity is protected.
- As support, I can audit important match events.
- As product, I can tune trust thresholds by region and queue.
#### Deliverables
- signed match results and server-side validation upgrades.
- behavioural anomaly detection.
- enforcement tooling and appeals workflow.

### Epic 3.3: Console readiness track
#### Stories
- As a developer, I can compile the shared core for console targets.
- As a producer, I can estimate certification gaps before porting.
- As QA, I can run platform-compliant save, network, and suspend tests.
#### Deliverables
- console-safe platform abstraction checklist.
- save data and account-linking compliance matrix.
- first pass certification test plan.

## Prioritised Backlog (Top 15 Stories)
1. Deterministic serialise/restore for full game state.
2. Replay runner with checksum validation in CI.
3. Platform service interface and web implementation.
4. Steam adapter for auth, stats, and achievements.
5. Steam build packaging pipeline.
6. Account/profile schema and migration baseline.
7. Training mode sandbox with reset controls.
8. Frame data capture and visualiser overlay.
9. Matchmaking queue service with region buckets.
10. Custom room service with invite codes.
11. Replay payload schema and ingest pipeline.
12. Replay search API and replay viewer overlays.
13. Elo league ladder (`Iron` to `Platinum`) plus MR track rules.
14. WebRTC transport with TURN fallback.
15. Enemy AI framework and arcade mode vertical slice.

## Recommended Data Model (minimum)
- `accounts`: internal id, created_at, status.
- `identities`: account_id, provider (`steam`, `web`), provider_user_id.
- `profiles`: account_id, display_name, settings blob.
- `seasons`: season_id, start_at, end_at, ruleset_version.
- `ratings`: account_id, queue_type, rating_mu, rating_sigma, updated_at.
- `rank_states`: account_id, queue_type, league_tier, league_points, mr_points, provisional_state.
- `matches`: match_id, queue_type, region, start_at, end_at, outcome.
- `match_players`: match_id, account_id, team, pre_rating, post_rating.
- `match_events`: match_id, frame, event_type, payload.
- `replays`: replay_id, match_id, payload_version, ruleset_version, blob_url, compressed_bytes.
- `replay_participants`: replay_id, account_id, character_id, side.

## Risks And Mitigations
- **Risk**: non-deterministic sim causes rollback desync.
  - **Mitigation**: deterministic tests, checksum gates, replay CI.
- **Risk**: WebRTC connectivity issues in some networks.
  - **Mitigation**: TURN deployment in multiple regions, connection diagnostics.
- **Risk**: cross-play complexity between Steam and web transports.
  - **Mitigation**: choose a single transport for cross-play queues, isolate Steam-only features.
- **Risk**: ranking abuse and smurfing.
  - **Mitigation**: server-authoritative results, anomaly detection, account linking policies.

## Decision Gates
- **Gate A (end Phase 1)**: decide packaging/runtime path for Steam production build.
- **Gate B (mid Phase 2)**: decide whether ranked is cross-play or split by platform.
- **Gate C (start Phase 3)**: decide whether to begin formal console partner onboarding.

## References
- GGPO SDK repository (reference architecture for rollback): https://github.com/pond3r/ggpo
- GGPO overview: https://www.ggpo.net/
- Steamworks documentation root: https://partner.steamgames.com/documentation
- Steam leaderboards: https://partner.steamgames.com/doc/features/leaderboards
- Steam user authentication and ownership: https://partner.steamgames.com/doc/features/auth
- Steam matchmaking and lobbies: https://partner.steamgames.com/doc/features/multiplayer/matchmaking
- Steam networking sockets API: https://partner.steamgames.com/doc/api/ISteamNetworkingSockets
- Steam Datagram Relay: https://partner.steamgames.com/doc/features/multiplayer/steamdatagramrelay
- WebRTC specification (W3C): https://www.w3.org/TR/webrtc/
- WebRTC API usage (MDN): https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- Tauri documentation: https://tauri.app/start/
- Electron documentation: https://www.electronjs.org/docs/latest
- Agones documentation: https://agones.dev/site/docs/
- Nakama documentation: https://heroiclabs.com/docs/nakama/
- Neon docs (branching): https://neon.com/docs/conceptual-guides/branching/
- AWS RDS for PostgreSQL docs: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html
- AWS ElastiCache for Redis docs: https://aws.amazon.com/documentation-overview/redis/
- Upstash docs: https://upstash.com/docs
- Cloudflare R2 docs: https://developers.cloudflare.com/r2/
- PostgreSQL indexing docs: https://www.postgresql.org/docs/current/indexes.html
- Protocol Buffers encoding guide: https://protobuf.dev/programming-guides/encoding/
- Zstandard framing format: https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
- SF6 replay list and search flow (community guide): https://gamerant.com/sf6-street-fighter-6-how-view-replays/
- SF6 replay quality-of-life update coverage: https://www.eventhubs.com/news/2025/jan/29/sf6-match-replays-immediate-update/
- SF6 replay compatibility warning coverage: https://www.eventhubs.com/news/2025/feb/04/mai-patch-note/
