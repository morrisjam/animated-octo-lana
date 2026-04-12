# Online And Services Stream Plan

Date: 2026-04-06  
Status: active  
Scope: matchmaking, ranked, reconnect, relay/transport, profiles, rooms/social, backend ops, live-service readiness

## Goal
Turn the current online scaffold into a production-grade online game service stack that can:
- match players reliably
- carry an actual live session end to end
- recover cleanly from disconnects
- submit ranked results safely
- expose enough ops tooling to keep the service stable after launch

This stream owns the server, transport, account, and live-ops layers. It depends on gameplay determinism, character/balance data, and content pipelines owned by other streams.

## Current State
The repo already has the main online building blocks in place:
- Matchmaking queue, session tokens, reconnect grace, and ranked queue logic live in `apps/api/src/matchmaking/queueService.ts`.
- Session frame relay endpoints exist in `apps/api/src/server.ts` and `apps/api/src/matchmaking/liveSessionFrameRelay.ts`.
- Ranked result validation, rating updates, season helpers, league progression, master rating, and anomaly detection are implemented under `apps/api/src/ranked/`.
- Rooms, social, presence, invites, enforcement, replay search, Steam exchange, and SLO endpoints already exist in `apps/api/src/server.ts`.
- Client feature gating and the first online runtime scaffold exist in `apps/game-web/src/config/features.ts`, `apps/game-web/src/main.ts`, and `apps/game-web/src/net/transport.ts`.
- The web client now hides public online entry unless the runtime flag is enabled, which keeps the broken path out of normal player flow.

## What Is Still Missing
The current stack is close on paper, but not complete as a player-facing online game:
- The live match path needs to be hardened into a real end-to-end flow, not just transport scaffolding.
- Reconnect needs to restore in-flight match state cleanly and resume frame exchange without losing authority.
- Ranked result submission needs to be wired to the actual live session lifecycle and verified against replay or state evidence.
- Transport fallback, NAT traversal, and relay behavior need more smoke coverage under real network conditions.
- Public ranking, seasonal progression, and leaderboard presentation still need tighter UX and operational guardrails.
- Anti-abuse policy needs more automation around duplicate sessions, disconnect farming, smurfing, and suspicious rating movement.
- A bot/opponent catalog needs a clean service-side shape so offline, arcade, and fallback opponents can be tracked consistently.

## Ownership Model
Use studio-style roles to keep this stream bounded:
- Producer: decides scope, sequencing, and release gates.
- Backend Lead: owns API, matchmaking, ranking, persistence, and ops endpoints.
- Platform Lead: owns client transport, session bootstrap, and reconnect behavior.
- QA Lead: owns smoke tests, failure cases, and release verification.
- Live Ops Lead: owns SLOs, anomaly review, enforcement, and rollback readiness.

## Milestone Breakdown
### Milestone 1: Real Match Runtime
Goal: queue to live match to reconnect works reliably.
- Finish the bootstrap-to-session handoff.
- Make relay/backoff behavior observable and deterministic.
- Harden reconnect and session timeout handling.
- Add end-to-end smoke coverage for two browsers and two accounts.

### Milestone 2: Ranked Loop
Goal: ranked matches produce trustworthy progression.
- Tie result submission to session validation and match completion.
- Finalize league tiers, MR track, season reset, and leaderboard reads.
- Tighten anomaly detection, review flow, and enforcement handoff.
- Add ranked regression tests around token expiry, reconnect, and duplicate submission.

### Milestone 3: Live-Service Readiness
Goal: service can be operated safely after launch.
- Polish profiles, rooms, friends, presence, and invite flows.
- Add SLO dashboards, backup/restore drills, deploy health gates, and incident checks.
- Define the bot/opponent catalog and how offline/arcade opponents are represented in services.
- Make environment flags and rollout switches explicit for dev, staging, and production.

## Next 2-3 Sprints
### Sprint 1
- Finish the live online loop: queue, bootstrap, relay, reconnect, match conclusion.
- Add a full smoke path that proves two clients can reach the same match and recover from a disconnect.
- Close gaps in ranked result submission and session validation.

### Sprint 2
- Lock ranked progression: rating update, league placement, MR track, season reset, leaderboard.
- Add stronger anti-abuse checks and reviewer tooling for ranked anomalies.
- Sync client UX so ranked state, session state, and failure states are explicit instead of implied.

### Sprint 3
- Harden service operations: SLO reporting, deploy health gates, backup/restore verification, and admin workflows.
- Finish public-service features that support launch readiness: profiles, rooms, presence, invites, and social controls.
- Define the server-facing shape for AI/bot opponents so fallback and arcade paths can share the same service vocabulary.

## Dependencies
This stream cannot finish in isolation. It depends on:
- deterministic simulation, state snapshotting, replay checksums, and rollback support from the gameplay stream
- character packages, AI behavior definitions, and balance tuning from the character/gameplay stream
- content and presentation decisions from the design and assets stream
- infrastructure choices for PostgreSQL, Redis, object storage, and STUN/TURN

Relevant anchors:
- `docs/DETERMINISTIC_RNG_POLICY.md`
- `docs/STATE_SNAPSHOT_SERIALISE_RESTORE.md`
- `docs/REPLAY_CHECKSUM_RUNNER.md`
- `docs/AI_BEHAVIOUR_FRAMEWORK.md`
- `docs/RANKED_ANOMALY_REVIEW_FLOW.md`
- `docs/SLO_ALERTING_POLICY.md`
- `docs/STEAM_SIGNIN_PATH.md`

## QA Gates
Do not treat the online stack as ready until these pass:
- queue join -> match -> bootstrap -> live session -> reconnect -> result submission smoke test
- invalid session token / wrong participant / duplicate submission rejection tests
- relay fallback and timeout behavior under a simulated network failure
- ranked rating and leaderboard consistency after a completed match
- anomaly alert creation and review flow for suspicious results
- SLO summary, backup drill, and deploy health gate checks before broader rollout

## Operational Concerns
- Keep online runtime behind explicit feature flags until the live path is stable.
- Treat admin keys, session tokens, and reconnect IDs as required operational inputs, not optional details.
- Log and correlate by `sessionId`, `ticketId`, `matchId`, `accountId`, and `region`.
- Keep retention, timeout, and region-selection behavior environment-driven.
- Separate dev, staging, and production traffic and rollout switches early so launch changes are reversible.

