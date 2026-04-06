# Full Game Production Plan

Date: 2026-04-06  
Status: active

This is the high-level plan for turning `Gravity Well` from a promising prototype with strong subsystem scaffolding into a fully functioning game with shippable content, stable online play, calibration workflows, and release readiness.

It uses the `Claude-Code-Game-Studios` operating model as a rough template:

- Director layer: creative direction, technical direction, production scope
- Lead layer: gameplay, online, art, audio, UI, QA, release
- Specialist layer: focused implementation, integration, validation, and playtest work

## Definition Of "Fully Functioning"

For this repo, "fully functioning" means:

1. the game has a stable core ruleset with distinct characters and a repeatable balance workflow
2. the game has a coherent visual/audio identity with a real asset pipeline rather than placeholders
3. online matches work end to end with reconnect, ranked updates, and operational visibility
4. training, replay, AI, and diagnostics make tuning and QA practical
5. Web and Steam builds can be verified and shipped from the same codebase

## Current Starting Point

The repo already has unusually strong foundations for a prototype:

- deterministic simulation, frame data, AI, and replay primitives
- character package, asset manifest, VFX, and audio abstractions
- menu/theme/stage presentation systems
- accounts, ranked, rooms, social, enforcement, replay, and SLO API scaffolding
- a first online runtime/bootstrap path and frame relay groundwork

The repo does not yet have:

- a finished roster with clear gameplay identities
- a ship-ready art/audio set
- a fully hardened live online match flow
- a single integrated production plan across design, gameplay, and services

## Production Structure

Run the project as three parallel streams with one shared milestone:

### Stream A: Design And Assets
- characters, stage art, VFX, audio, menu polish, promo assets
- source of truth: `production/STREAM_DESIGN_AND_ASSETS.md`

### Stream B: Gameplay And Systems
- combat tuning, character identity, AI, training, replay, deterministic QA
- source of truth: `production/STREAM_GAMEPLAY_AND_SYSTEMS.md`

### Stream C: Online And Services
- matchmaking, transport, reconnect, ranked, profiles, rooms, live ops
- source of truth: `production/STREAM_ONLINE_AND_SERVICES.md`

## Phase Plan

### Phase 1: Vertical Slice Foundation

Goal:
- one polished playable slice proves the game fantasy, core mechanics, and content pipeline

Required outcomes:
- 2 to 3 distinct playable characters
- one signature stage with coherent visual treatment
- stable training and local versus loop
- first-pass AI and arcade/training utility
- clear content acceptance rules

Exit criteria:
- a new character can be added through the package/content pipeline
- a balance change can be validated through existing tools
- the game no longer reads as placeholder-heavy in the primary loop

### Phase 2: Online Alpha

Goal:
- real player-vs-player online loop works reliably in dev/staging

Required outcomes:
- queue to session to live match to match end
- reconnect behavior
- ranked result submission
- relay/fallback and token validation coverage
- explicit failure UX for online states

Exit criteria:
- two clients can complete a live match and receive ranked updates
- disconnect/reconnect and duplicate-result cases are covered
- online entry can be exposed intentionally instead of hidden by default

### Phase 3: Content And Competitive Beta

Goal:
- the game has enough roster, tuning, content, and service resilience for external testing

Required outcomes:
- first roster pass with distinct identities
- stable balance workflow with replay/regression gates
- refined HUD/menu presentation and audio identity
- leaderboard and season presentation
- operations playbooks, backup/restore confidence, and anomaly review

Exit criteria:
- balance/content updates are repeatable rather than ad hoc
- service health and abuse handling are operationally manageable
- the game is coherent enough for broader player feedback

### Phase 4: Release Readiness

Goal:
- Web and Steam builds are fit for a controlled launch

Required outcomes:
- ship candidate build verification
- release checklist, rollback plan, and support runbook
- store/promo/trailer assets
- final accessibility, performance, and stability passes

Exit criteria:
- build, verify, package, and release steps are documented and repeatable
- major release blockers are tracked through clear go/no-go criteria

## Cross-Stream Dependencies

The project should be sequenced around these truths:

- gameplay must define stable character and move contracts before content can finish production
- gameplay determinism and state handling must be trustworthy before online can be hardened
- online can proceed in parallel with placeholder content, but not with unstable simulation contracts
- design/assets can move ahead of final netcode, but should not outrun final character identity

## Current Milestone Recommendation

The next milestone should be:

`Vertical Slice To Online Alpha`

Why:

- it converts the current prototype into one coherent slice instead of many partial systems
- it keeps the three streams aligned around one player-facing outcome
- it avoids the trap of building more scaffolding without shipping one believable experience

See:
- `production/CURRENT_MILESTONE.md`
- `production/CURRENT_SPRINT.md`

## Agent Model For Codex

Use sub-agents by stream ownership rather than vague roleplay:

- Agent 1: design/assets
- Agent 2: online/services
- Agent 3: gameplay/systems
- Main agent: producer/integrator

Rules:

- each agent owns a disjoint write set
- each agent reports risks, dependencies, and validation needs
- the integrator updates milestone and sprint artifacts after merging results

## High-Leverage Next Moves

1. Finish the first real online match loop and ranked result handoff.
2. Lock the first ship-ready roster slice and wormhole stage direction.
3. Replace placeholder characters with documented kit passes and validation fixtures.
4. Turn the current milestone and sprint docs into the source of truth for future delegation.
