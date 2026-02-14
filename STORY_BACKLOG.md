# Story Backlog (Web + Steam Priority)

## How to use this file
- Story points use a simple Fibonacci scale: `1, 2, 3, 5, 8`.
- These are planning estimates, not commitments.
- Scope assumes one shared gameplay core and web plus Steam clients first.

## Status snapshot (2026-02-14)
- Tracker source: `JIRA_STORY_BACKLOG.csv`.
- Stories marked `Done`: `24`.
- Stories marked `Backlog`: `15`.
- Recent status sync marked these as done: `S1.3`, `S1.10`, `S2.21`, `S2.22`, `S2.23`, `S2.24`, `S2.25`, `S2.26`, `S2.29`, `S2.30`, `S2.31`, `S2.32`.

## Next epic slice (recommended)
- Epic: `E2.3 Ranked and progression`.
- Why now:
  - Menu and API scaffolding are live.
  - Player-facing queue/replay/ranked screens now exist.
  - Remaining competitive launch risk is mostly ranked integrity and season progression.
- Execution order:
  - `S2.7` Rating engine service.
  - `S2.9` Match result validation.
  - `S2.8` Season model and leaderboard API.
  - `S2.17` League ladder model.
  - `S2.18` Master rating track.
  - `S2.19` Ranked matchmaking uses league and MR.
  - `S2.20` Ranked progression UX and anti-smurf rules.

## Phase 1 stories

## Epic E1.1 Platform-ready client architecture
### S1.1 Shared platform service interface
- Story: As a developer, I can call auth, storage, and presence through one `PlatformServices` interface.
- Acceptance criteria:
  - Web and Steam adapters compile against the same interface.
  - Game boot selects adapter by build target.
  - No direct Steam API usage outside steam adapter.
- Points: `3`

### S1.2 Steam build profile and packaging
- Story: As a developer, I can produce a Steam-ready build from CI.
- Acceptance criteria:
  - CI outputs signed artefact for Steam upload.
  - Build contains no CDN/runtime network dependency for core gameplay.
  - Smoke test launches the packaged build locally.
- Points: `5`

### S1.3 Runtime feature flags
- Story: As a developer, I can enable or disable online, ranked, and debug features per environment.
- Acceptance criteria:
  - Flags are loaded from environment or config.
  - Dev, staging, and production configs are separate.
  - Disabled features are hidden from UI.
- Points: `2`

## Epic E1.2 Determinism and rollback prerequisites
### S1.4 Deterministic RNG policy
- Story: As a developer, I can guarantee deterministic random behaviour by seed and frame.
- Acceptance criteria:
  - All random calls in sim use one deterministic RNG utility.
  - Seed can be set at match start.
  - Replay with same seed and inputs produces same checksum sequence.
- Points: `3`

### S1.5 Full state serialise and restore
- Story: As a developer, I can save and restore full simulation state at any frame.
- Acceptance criteria:
  - State snapshot includes all fields needed for deterministic replay.
  - Restore rewinds and resumes without crash.
  - Snapshot and restore are covered by tests.
- Points: `5`

### S1.6 Frame checksum and replay runner
- Story: As QA, I can run a replay and detect divergence by checksum.
- Acceptance criteria:
  - CLI takes input log and produces frame checksums.
  - CI fails on checksum mismatch.
  - Report includes first divergent frame.
- Points: `5`

## Epic E1.3 Accounts and profile baseline
### S1.7 Account schema and identity linking
- Story: As an operator, I can link one account to Steam and web identities.
- Acceptance criteria:
  - Tables exist for `accounts` and `identities`.
  - Uniqueness rules prevent duplicate provider identity links.
  - Audit trail records linking events.
- Points: `3`

### S1.8 Profile API
- Story: As a player, I can persist profile settings and preferred input layout.
- Acceptance criteria:
  - Authenticated `GET/PUT /profile` endpoints exist.
  - Server validation enforces schema and bounds.
  - Client caches profile for offline fallback.
- Points: `3`

### S1.9 Steam sign-in path
- Story: As a Steam player, I can sign in and load my profile automatically.
- Acceptance criteria:
  - Steam auth token exchange endpoint exists.
  - Account is created or linked on first sign-in.
  - Failed auth shows a clear recovery message.
- Points: `5`

## Epic E1.4 Training mode and frame-data tooling
### S1.10 Training mode sandbox loop
- Story: As a player, I can launch a no-win training session for drills and matchup practice.
- Acceptance criteria:
  - Training mode can be started from home menu without affecting match records.
  - Round timer and win conditions are disabled in training mode.
  - Training restart is available without returning to home menu.
- Points: `3`

### S1.11 Move frame-data registry
- Story: As a combat designer, I can maintain startup, active, and recovery frame data per move in one data registry.
- Acceptance criteria:
  - Each combat move has explicit frame data values (startup, active, recovery, and whiff recovery where relevant).
  - Simulation consumes frame data from the registry rather than scattered hardcoded timings.
  - Frame data uses 60Hz frame units and is easy to rebalance.
- Points: `5`

### S1.12 Frame data visualiser overlay
- Story: As a player, I can view frame data overlays in training mode.
- Acceptance criteria:
  - Overlay shows move frame data values from the registry for both players.
  - Overlay can be shown or hidden with keyboard and controller.
  - Overlay has negligible impact on frame pacing on baseline hardware.
- Points: `5`

## Epic E1.5 Visual content pipeline and asset strategy
### S1.13 Asset manifest and loader abstraction
- Story: As a developer, I can register and load visual assets from manifests rather than hardcoded file paths.
- Acceptance criteria:
  - Manifest format supports models, sprites, textures, audio, and shader config references.
  - Loader supports async preloading with progress and error reporting.
  - Missing or invalid assets fail with clear diagnostics.
- Points: `3`

### S1.14 Character visual profile abstraction (3D, sprite, hybrid)
- Story: As a designer, I can assign a character to 3D, sprite, or hybrid visual presentation without changing sim code.
- Acceptance criteria:
  - Character visual profile maps gameplay ids to renderer assets and animation sets.
  - Renderer supports at least one 3D profile and one sprite profile behind one interface.
  - Existing placeholder fighters continue working through the profile system.
- Points: `5`

### S1.15 VFX event binding and tuning presets
- Story: As a VFX designer, I can configure boost, launch, parry, projectile, and dunk effects from data.
- Acceptance criteria:
  - View layer binds sim combat events to VFX presets.
  - VFX presets support particles, trails, flashes, and sound cues.
  - Preset values are editable from data files without gameplay code edits.
- Points: `3`

### S1.16 Asset budgets and validation checks
- Story: As a technical artist, I can enforce asset budgets so memory and performance stay stable.
- Acceptance criteria:
  - Budget targets exist for texture memory, mesh complexity, and VFX counts.
  - Build-time validation reports assets that exceed budgets.
  - Runtime debug panel shows key memory counters in dev builds.
- Points: `5`

## Epic E1.6 Audio pipeline (SFX, music, voice lines)
### S1.17 Audio event bus and routing
- Story: As a developer, I can drive SFX, music, and voice lines from gameplay events through one audio interface.
- Acceptance criteria:
  - Sim or view events map to typed audio events without hardcoded clip paths in gameplay logic.
  - Audio routing supports buses for master, music, SFX, and voice.
  - Missing audio events fail with clear diagnostics in dev builds.
- Points: `3`

### S1.18 Adaptive music state system
- Story: As a player, music transitions reflect match state and intensity.
- Acceptance criteria:
  - Music supports layered or state-based playback for menu, neutral, launch, and end states.
  - Transitions use configurable fades and do not click or pop.
  - Music system supports deterministic triggers for replay consistency where required.
- Points: `5`

### S1.19 Voice line and callout system
- Story: As a designer, I can configure character voice lines for key actions and outcomes.
- Acceptance criteria:
  - Voice line tables are data-driven per character and event.
  - Trigger rules support cooldowns, priorities, and anti-spam limits.
  - System supports locale-specific voice packs and safe fallback when files are missing.
- Points: `3`

### S1.20 Mix, loudness, and accessibility controls
- Story: As a player, I can control audio mix and keep speech understandable during intense action.
- Acceptance criteria:
  - Expose volume sliders for master, music, SFX, and voice in settings.
  - Implement ducking rules so voice or important cues remain audible during heavy effects.
  - Add accessibility options for dynamic range mode and persistent subtitle toggles for voice lines.
- Points: `5`

## Epic E1.7 Enemy AI and arcade mode
### S1.21 Enemy AI behaviour framework
- Story: As a developer, I can run deterministic enemy decision logic from the simulation layer.
- Acceptance criteria:
  - AI policy runs in `src/sim` without renderer or DOM dependencies.
  - AI input output uses the same `FrameInput` structure as human players.
  - AI ticks are deterministic under fixed seed and fixed timestep replay.
- Points: `5`

### S1.22 AI difficulty profiles
- Story: As a player, I can choose AI difficulty that changes aggression, defence, and error rate.
- Acceptance criteria:
  - At least four difficulty profiles exist and are data-driven.
  - Difficulty profiles control reaction delays, action weighting, and risk appetite.
  - Difficulty selection is available from menu and persists in profile settings.
- Points: `3`

### S1.23 Single-player arcade mode flow
- Story: As a player, I can play an arcade ladder against multiple AI opponents.
- Acceptance criteria:
  - Arcade mode includes staged opponent progression and a final encounter.
  - Continue and retry rules are configurable.
  - Arcade completion summary screen is implemented.
- Points: `5`

### S1.24 Arcade rewards and run history
- Story: As a player, I can see recent arcade runs and best completion records.
- Acceptance criteria:
  - Run summaries store character, difficulty, result, and completion time.
  - Best records are shown per character and difficulty.
  - History storage works offline and syncs when account services are available.
- Points: `3`

## Phase 2 stories

## Epic E2.1 Rollback netcode
### S2.1 Input timeline buffer
- Story: As a developer, I can buffer local and remote inputs by frame id.
- Acceptance criteria:
  - Input buffer supports lookup by frame for both players.
  - Late input replacement path is implemented.
  - Unit tests cover missing and out-of-order packets.
- Points: `3`

### S2.2 Prediction and rollback resimulation
- Story: As a player, gameplay remains responsive while waiting for remote input.
- Acceptance criteria:
  - Local prediction uses last known remote input.
  - Rollback occurs when authoritative remote input differs.
  - Resimulation completes within target frame budget on baseline hardware.
- Points: `8`

### S2.3 Match synchronisation diagnostics
- Story: As QA, I can inspect rollback count, max rollback depth, and desync events.
- Acceptance criteria:
  - Per-match diagnostics are emitted and stored.
  - In-game debug overlay shows rollback metrics in dev builds.
  - Desync event includes frame id and checksums.
- Points: `3`

## Epic E2.2 Matchmaking and sessions
### S2.4 Queue service with region buckets
- Story: As a player, I am matched by queue and region.
- Acceptance criteria:
  - Queues exist for unranked and ranked.
  - Region preferences are applied.
  - Match start payload contains session token and peer metadata.
- Points: `5`

### S2.5 Session and reconnect flow
- Story: As a player, I can reconnect during short disconnects.
- Acceptance criteria:
  - Session tokens have expiry and replay protection.
  - Reconnect grace window is configurable.
  - Match resolves if reconnect fails after timeout.
- Points: `5`

### S2.6 NAT traversal support
- Story: As a player, I can connect in restrictive home network conditions.
- Acceptance criteria:
  - STUN and TURN are configured.
  - Connection fallback to relay is automatic.
  - Telemetry tracks direct vs relay usage by region.
- Points: `3`

## Epic E2.4 Custom rooms and private lobbies
### S2.10 Private room lifecycle
- Story: As a player, I can create a private room and invite another player directly.
- Acceptance criteria:
  - Room codes are generated server-side and expire after configurable idle timeout.
  - Host can start and close room sessions.
  - Invite path works for both web and Steam friend flows.
- Points: `5`

### S2.11 Room join and spectator permissions
- Story: As a player, I can join by room code and follow room access rules.
- Acceptance criteria:
  - Join by code validates region and version compatibility.
  - Host can lock room and control spectator allowance.
  - Join failures return clear recovery messages.
- Points: `3`

### S2.12 Room rematch and character select flow
- Story: As a room participant, I can rematch without re-creating the room.
- Acceptance criteria:
  - Character select and ready checks run per rematch.
  - Rematch keeps room membership while resetting match state.
  - Room history stores match ids and outcomes for audit.
- Points: `5`

## Epic E2.5 Replay archive and review
### S2.13 Compact replay payload format
- Story: As a platform engineer, I can store replays in a low-weight format that stays deterministic.
- Acceptance criteria:
  - Replay payload stores seed, ruleset version, and frame input timeline rather than full-frame world snapshots.
  - Payload schema has explicit versioning so old replays fail gracefully instead of crashing.
  - Median replay payload size target is defined and measured in CI fixtures.
- Points: `5`

### S2.14 Replay ingest and persistence
- Story: As an operator, I can persist completed matches as searchable replay records.
- Acceptance criteria:
  - Match metadata is stored in PostgreSQL and replay payload blobs are stored in object storage.
  - Metadata includes both players, characters, match type, patch version, outcome, and duration.
  - Replay retention policy and deletion flow are documented.
- Points: `5`

### S2.15 Replay search API with player filters
- Story: As a player, I can search replay history by player and matchup criteria.
- Acceptance criteria:
  - API supports filters for player id, opponent id, character, matchup, queue type, date range, and patch version.
  - Search is paginated and index-backed.
  - API returns replay summaries plus a stable replay id for playback.
- Points: `3`

### S2.16 Replay review viewer with inputs and frame data
- Story: As a competitive player, I can review replays with both input history and frame-data overlays.
- Acceptance criteria:
  - Replay viewer shows both players' inputs on the timeline.
  - Frame-data overlay shows startup, active, recovery, hit or block outcomes, and advantage markers from replay events.
  - Playback supports pause, frame-step, speed controls, and jump-to-round.
- Points: `5`

## Epic E2.7 Online Dev UI and test harness
### S2.21 Online dev menu shell and feature gating
- Story: As a developer, I can open one in-game Online Dev menu to test backend flows quickly.
- Acceptance criteria:
  - Online Dev menu is available in web dev builds behind feature flag.
  - Menu supports keyboard and controller navigation.
  - Menu sections are split by matchmaking, rooms, replay, and ranked.
- Points: `3`

### S2.22 Matchmaking queue test panel
- Story: As a developer, I can test queue join/leave and session polling from the client UI.
- Acceptance criteria:
  - Panel supports region and queue selection and join/leave actions.
  - Ticket and session state updates are shown live with clear error messages.
  - Reconnect token and grace state are visible for debugging.
- Points: `5`

### S2.23 Private room and lobby test panel
- Story: As a developer, I can create and manage private rooms and rematches without API tooling.
- Acceptance criteria:
  - Panel supports create room, join by code, lock toggle, spectator toggle, start, rematch, and close.
  - Invite payload preview is available for web and Steam formats.
  - Room history and active phase are visible.
- Points: `5`

### S2.24 Replay search and playback integration UI
- Story: As a player, I can search my replay archive and launch replay review from in-game UI.
- Acceptance criteria:
  - Replay search form supports player, opponent, character, matchup, queue, date, and patch filters.
  - Results list is cursor-paginated with clear loading and error states.
  - Selecting a result loads replay payload and opens replay review viewer.
- Points: `5`

### S2.25 Ranked progression dev panel
- Story: As a developer, I can inspect rating, league, and season fields in one UI while testing ranked flow.
- Acceptance criteria:
  - Panel shows current rating, league tier, league points, MR points, and provisional state.
  - Recent match result deltas are shown with pre and post values.
  - Panel gracefully handles missing ranked data while APIs are incomplete.
- Points: `3`

### S2.26 Online diagnostics overlay and export
- Story: As QA, I can capture an online test report without opening browser dev tools.
- Acceptance criteria:
  - Overlay shows rollback counters, RTT, packet loss, relay/direct path, queue wait time, and session ids.
  - Export button copies diagnostics JSON including build, ruleset, and account ids.
  - Diagnostics collection can be toggled per environment flag.
- Points: `3`

## Epic E2.8 Account and social platform services
### S2.27 Account lifecycle and sign-up flow (web-first, Steam-ready)
- Story: As a player, I can create an account and persist identity across sessions.
- Acceptance criteria:
  - Web sign-up and sign-in flows exist with guest-to-account upgrade path.
  - Account model supports linked platform identities without duplicate ownership.
  - Recovery and error flows are documented for invalid, duplicate, and disabled accounts.
- Points: `5`

### S2.28 Steam identity link and account merge policy
- Story: As a player, I can link Steam to an existing account or create one on first Steam sign-in.
- Acceptance criteria:
  - Steam token exchange path links provider identity to internal account id.
  - Merge policy exists for guest/web account linking into Steam-linked account.
  - Audit events capture link, unlink, and merge operations.
- Points: `5`

### S2.29 Friends graph schema and API
- Story: As a player, I can add, accept, remove, and list friends.
- Acceptance criteria:
  - Friend request and friendship tables support pending, accepted, declined, cancelled, and blocked states.
  - API supports send, accept, decline, remove, block, and list operations.
  - Queries are index-backed for large friend lists.
- Points: `5`

### S2.30 Presence and friend invite service
- Story: As a player, I can see friend status and send invites into rooms or queues.
- Acceptance criteria:
  - Presence service exposes online status and current activity privacy-safe fields.
  - Invite payload supports room code and platform-aware deep links for web and Steam.
  - Presence and invite events are rate-limited and audited.
- Points: `3`

### S2.31 Client friends and account UI
- Story: As a player, I can manage account identity and friends in-game.
- Acceptance criteria:
  - UI supports sign-in state, linked identities, friend list, friend requests, and invite actions.
  - UI is usable with keyboard and controller.
  - Errors and empty states are explicit and actionable.
- Points: `5`

### S2.32 Privacy, moderation, and parental-safe social controls
- Story: As an operator, I can enforce safe social interactions across platforms.
- Acceptance criteria:
  - Block list and muted-player controls apply to friend requests and invites.
  - Privacy settings support presence visibility and invite permissions.
  - Moderation events are auditable with actor, reason, and timestamp.
- Points: `3`

## Epic E2.3 Ranked and progression
### S2.7 Rating engine service
- Story: As a player, I receive consistent rating updates after ranked matches.
- Acceptance criteria:
  - Rating service applies an Elo-like model consistently.
  - Pre and post ratings are stored with each match result.
  - Draw and forfeit cases are covered by tests.
- Points: `5`

### S2.8 Season model and leaderboard API
- Story: As a player, I can view season rank and leaderboard position.
- Acceptance criteria:
  - Seasons have start and end windows.
  - Leaderboard API supports pagination and region filters.
  - Season reset job archives previous season standings.
- Points: `3`

### S2.9 Match result validation
- Story: As an operator, I can trust ranked results against basic tampering.
- Acceptance criteria:
  - Result submission requires valid session token.
  - Server verifies expected participants and match id.
  - Suspicious submissions are flagged for review.
- Points: `5`

### S2.17 League ladder model (Iron to Platinum)
- Story: As a ranked player, I can progress through leagues from Iron to Platinum with transparent promotion rules.
- Acceptance criteria:
  - League tiers include `Iron`, `Bronze`, `Silver`, `Gold`, and `Platinum`.
  - Elo-like league points define promotion and demotion thresholds.
  - Placement flow assigns initial league after calibration matches.
- Points: `5`

### S2.18 Master rating (MR) track
- Story: As a top ranked player, I can enter a Master rating track with MR-style points.
- Acceptance criteria:
  - Players reaching configured threshold can enter Master track.
  - MR points update each match with queue-appropriate weighting.
  - Master leaderboard API and season reset rules are defined.
- Points: `5`

### S2.19 Ranked matchmaking uses league and MR
- Story: As a player, I get ranked opponents based on league and rating proximity.
- Acceptance criteria:
  - Matchmaking search uses league bands plus rating window expansion over time.
  - Master-track matchmaking uses MR bands with region latency constraints.
  - Queue diagnostics capture expected rating gap and final matched gap.
- Points: `3`

### S2.20 Ranked progression UX and anti-smurf rules
- Story: As a player, I can understand progression and protections against obvious smurfing.
- Acceptance criteria:
  - Ranked UI shows current league, points to next promotion, and recent trend.
  - Placement and provisional periods are clearly labelled.
  - Anti-smurf heuristics and escalation policy are documented for operations.
- Points: `3`

## Phase 3 stories

## Epic E3.1 Production hardening
### S3.1 SLOs and alerting
- Story: As an operator, I can monitor reliability against defined service goals.
- Acceptance criteria:
  - Availability, latency, and error SLOs are defined.
  - Alerts are configured with escalation policy.
  - Weekly SLO report is generated automatically.
- Points: `3`

### S3.2 Backup and disaster recovery drills
- Story: As an operator, I can recover critical data within target windows.
- Acceptance criteria:
  - Automated backups for Postgres and Redis are configured.
  - Restore drill is run and documented.
  - RPO and RTO targets are validated.
- Points: `5`

### S3.3 Safe deployment strategy
- Story: As a developer, I can roll out releases with low player risk.
- Acceptance criteria:
  - Canary or blue/green release path exists.
  - Automatic rollback on key error thresholds.
  - Schema migration workflow supports backward compatibility.
- Points: `5`

## Epic E3.2 Integrity and trust upgrades
### S3.4 Ranked anomaly detection
- Story: As an operator, I can detect suspicious ranked behaviour automatically.
- Acceptance criteria:
  - Anomaly rules exist for impossible match cadence and rating jumps.
  - Alerts include account and match references.
  - False positive review flow is documented.
- Points: `3`

### S3.5 Enforcement tooling
- Story: As support, I can apply temporary and permanent sanctions.
- Acceptance criteria:
  - Admin panel supports warning, suspension, and ban actions.
  - All actions are auditable with actor identity.
  - Appeal status can be tracked.
- Points: `3`

## Epic E3.3 Console readiness (far future)
### S3.6 Platform compliance gap audit
- Story: As a producer, I can identify major gaps before console onboarding.
- Acceptance criteria:
  - Checklist covers save rules, entitlement checks, suspend/resume, and privacy.
  - Gap report is prioritised by risk and effort.
  - Report is reviewed with engineering and production.
- Points: `2`

### S3.7 Console-safe persistence abstraction
- Story: As a developer, I can swap persistence implementation per platform without gameplay code changes.
- Acceptance criteria:
  - Persistence adapter interface is platform agnostic.
  - Web and Steam implementations pass shared test suite.
  - Unsupported operations fail safely.
- Points: `3`

## Suggested first 2 sprints
- Sprint 1:
  - `S1.1`, `S1.4`, `S1.7`, `S1.8`
- Sprint 2:
  - `S1.2`, `S1.5`, `S1.6`, `S1.9`

## Suggested sprint 3
- `S1.10`, `S1.11`, `S1.12`, `S2.10`

## Suggested sprint 4
- `S2.13`, `S2.14`, `S2.15`, `S2.16`

## Suggested sprint 5
- `S1.13`, `S1.14`, `S1.15`, `S1.16`

## Suggested sprint 6
- `S1.17`, `S1.18`, `S1.19`, `S1.20`

## Suggested sprint 7
- `S1.21`, `S1.22`, `S1.23`, `S1.24`

## Suggested sprint 8
- `S2.17`, `S2.18`, `S2.19`, `S2.20`

## Suggested sprint 9
- `S2.21`, `S2.22`, `S2.23`, `S2.24`

## Suggested sprint 10
- `S2.25`, `S2.26`, `S2.7`, `S2.8`

## Suggested sprint 11
- `S2.27`, `S2.28`, `S2.29`, `S2.30`

## Suggested sprint 12
- `S2.31`, `S2.32`, `S2.9`, `S2.17`

## Immediate operator action
- Action `A-NEON-1`: initialise a Neon `dev` database and switch `DATABASE_URL` in CI and deploy envs.
  - Checklist is in `docs/NEON_SETUP_ACTION.md`.
