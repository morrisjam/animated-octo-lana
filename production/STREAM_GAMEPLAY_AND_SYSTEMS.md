# Gameplay And Systems Stream

Owner lane:
- gameplay balance
- deterministic simulation
- AI opponents
- training and calibration tooling
- replay and determinism validation

This stream is the part of Gravity Well that makes the game tunable, readable, and testable. The design/assets stream can ship characters and effects, and the online stream can ship transport and ranking, but this lane owns the rules that make the game feel fair and stable.

## Current State

The simulation foundation is already in place in `apps/game-web/src/sim`:
- deterministic RNG policy and seed-driven state in `apps/game-web/src/sim/rng.ts` and `docs/DETERMINISTIC_RNG_POLICY.md`
- frame-authored combat timings in `apps/game-web/src/sim/moveData.ts` and `docs/MOVE_FRAME_DATA_REGISTRY.md`
- character definitions and package merging in `apps/game-web/src/sim/characters.ts`
- deterministic AI controller profiles in `apps/game-web/src/sim/ai.ts` and `docs/AI_BEHAVIOUR_FRAMEWORK.md`
- training telemetry capture in `apps/game-web/src/sim/trainingTelemetry.ts` and `docs/TRAINING_TELEMETRY_WORKFLOW.md`
- replay review and frame-event reconstruction in `apps/game-web/src/sim/replayReview.ts` and `docs/REPLAY_ARCHIVE_DESIGN.md`

Character package scaffolding is also present:
- schema and validation in `docs/CHARACTER_PACKAGE_SCHEMA.md`
- author workflow in `docs/CHARACTER_PACKAGE_USER_GUIDE.md`
- package creation and QA commands exposed in `apps/game-web/README.md`

Balance and iteration tooling already exists in a first-pass form:
- balance profiles in `apps/game-web/content/balance/balanceProfiles.ts`
- profile resolution in `apps/game-web/src/sim/balanceProfiles.ts`
- validation in `apps/game-web/scripts/balance-profile-validate.ts`
- patch-note generation in `docs/BALANCE_PATCH_NOTES_WORKFLOW.md`

## Main Gaps

The stream is not done because the game still lacks complete tuneable content and robust calibration loops.

Core gaps:
- the shipped roster is still mostly placeholder characters in `apps/game-web/src/sim/characters.ts`
- special-move behavior is still contract-driven scaffolding, not a full per-character kit system
- the frame-data registry covers the universal combat spine, but not full character-by-character differentiation
- training mode captures telemetry, but it still needs more purpose-built drills and clearer designer workflows
- replay review exists, but we still need stronger compatibility, regression, and searchable validation around major balance changes
- AI exists as one deterministic controller, but it needs better character-specific behavior profiles and matchup-aware tuning

## Stream Goals

1. Make every combat variable tunable without editing core sim flow.
2. Give each character a complete balance identity with explicit kit data, AI behavior, and training targets.
3. Make regression detection cheap enough that balance changes can move quickly without breaking determinism.
4. Close the loop between training telemetry, replay review, and patch-note generation.

## Milestone Plan

### Milestone 1: Calibration Backbone

Lock the tuning surface before expanding content.

Deliverables:
- expand the move registry and character package schema where current placeholder fields are still too coarse
- keep all timings authored in 60Hz frame units
- ensure every character package validates against the same schema and QA harness
- add or tighten regression tests around deterministic seed, checksum stability, and replay playback

Definition of done:
- a designer can change balance data without editing sim logic
- a replay from a fixed seed produces the same checksum sequence across runs
- character packages fail fast when required fields or bounds are invalid

### Milestone 2: Character Identity Pass

Turn placeholder characters into distinct gameplay kits.

Deliverables:
- finish per-character move data, special behavior contracts, and stat tuning
- add data-driven AI profiles that can be matched to character archetypes
- create training presets for each character and common matchup pairings
- ensure the frame-data overlay and training telemetry expose the metrics designers actually need

Definition of done:
- each playable character has a distinct balance identity
- special moves are no longer just placeholder contracts
- training mode can support targeted tuning without ad hoc manual note-taking

### Milestone 3: Replay And Regression Gate

Make balance changes measurable.

Deliverables:
- replay compatibility/versioning policy tied to `rulesetVersion` and `simBuildHash`
- deterministic regression smoke tests for core matchup fixtures
- search/review flow for representative replays after major patches
- patch-note generation that can compare profile changes and report likely gameplay impact

Definition of done:
- a gameplay patch can be tested against replay fixtures before merge
- major tuning changes are visible in reports, not only in subjective playtests

### Milestone 4: AI And Single-Player Depth

Use AI as a development tool and a shipping feature.

Deliverables:
- character-aware AI profiles and difficulty bands
- arcade or ladder-style AI progression using the same deterministic sim contract
- training bot modes for basic punishes, escape drills, and matchup rehearsal
- stable AI behavior tests so bot tuning does not introduce nondeterministic failures

Definition of done:
- AI is useful for both production content and developer calibration
- bot behavior can be tuned per character or archetype without code churn

## Next 2-3 Sprints

### Sprint 1
- finish the calibration surface for core combat values
- close any remaining schema gaps in character packages
- expand deterministic tests around seed, frame checksum, and replay rebuild
- identify the minimum set of training metrics that balance work actually uses

### Sprint 2
- turn placeholder characters into distinct, documented kit passes
- add matchup-specific training presets and bot profiles
- connect frame-data overlay expectations to the move registry and character package data
- verify balance profile changes produce clear patch-note diffs

### Sprint 3
- harden replay compatibility and regression smoke coverage
- improve AI difficulty and archetype tuning for both training and arcade play
- make the balance workflow repeatable enough that a designer can run it without help from engineering

## Validation Gates

This stream is not ready for release unless these are true:
- `npm run balance:validate` passes
- `npm run character:validate` passes
- `npm run character:qa` passes
- replay fixtures still playback deterministically after tuning changes
- frame-data overlay values match the active move registry
- training telemetry still exports useful signal after rule changes
- AI tests remain deterministic across repeated runs

## Dependencies

This stream depends on the rest of the repo, but it should not wait on it:
- the online stream needs stable `rulesetVersion`, `simBuildHash`, and replay compatibility
- the design/assets stream needs final character identities to finish animation and VFX direction
- the gameplay stream can continue using placeholder art while logic and balance are being locked

## Working Rule

If a change affects combat timing, AI behavior, replay playback, or training metrics, it belongs here first. If it only changes presentation, it belongs in the design/assets stream. If it only changes transport or ranking, it belongs in the online stream.
