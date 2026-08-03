# Current Sprint

Sprint window: `Sprint 1`  
Date opened: 2026-04-06  
Goal: move the project from subsystem scaffolding to one integrated playable slice

## Sprint Theme

`Make one believable version of the game work end to end.`

## Stream Commitments

### Design / assets
- write the visual bible for the first playable slice
- lock the wormhole stage direction and approval checklist
- define the first ship-ready character asset checklist
- define asset review and budget signoff rules

Artifacts:
- `production/VISUAL_BIBLE_V1.md`
- `production/ASSET_BRIEFS_V1.md`
- `production/ASSET_WORKFLOW_V1.md`

Definition of done:
- art direction is explicit enough that asset generation is constrained
- the first character and stage have a concrete acceptance bar

### Gameplay / systems
- identify and close the minimum remaining schema gaps for real character kits
- define the first `2` character kit passes with tuning targets
- tighten deterministic/regression checks that protect balance iteration
- define the minimum training telemetry and replay fixtures needed for tuning

Artifacts:
- `production/FIRST_CHARACTER_KIT_TARGETS.md`
- `apps/game-web/build-artifacts/character-kit-report.md`

Definition of done:
- character differentiation is documented as system work, not left implicit
- balance iteration has a stable validation loop

### Online / services
- finish queue -> bootstrap -> live session -> result flow
- wire ranked result submission to the actual live session lifecycle
- define reconnect and duplicate-result smoke cases
- keep public online entry behind explicit enablement until the smoke path passes

Artifacts:
- `production/ONLINE_MATCH_SMOKE_CASES.md`

Definition of done:
- there is one real online loop to test instead of a partial scaffold
- the user-facing state is explicit when online succeeds or fails

## Completed Batches

### Batch A: First production direction

- visual bible completed
- first asset briefs and workflow notes completed
- wormhole, Vanguard, and Duelist now have production-facing review briefs

### Batch B: Online session loop hardening

- ranked online smoke script covers relay, reconnect, delayed result submission, duplicate rejection, and progression update
- public online entry remains gated behind explicit feature enablement until runtime maturity improves

### Batch C: First concrete kit pass

- Vanguard now resolves to a guard special instead of a placeholder projectile
- Duelist now resolves to a movement dash special instead of a placeholder projectile
- sim tests and matchup smoke now protect those kit identities
- character calibration now emits a generated kit report from runtime data

### Batch D: Tuning and API abuse gates

- added a reusable AI matchup batch runner for offline balance sweeps
- the batch runner emits markdown and json artifacts from the deterministic sim
- ranked online smoke now checks invalid session-token rejection for frame relay and ranked submission
- ranked online smoke now checks outsider ranked-result submission rejection

### Batch E: Well hazard experiment (gameplay, default off)

- the well is now an optional gameplay object: core capture of helpless fighters (resolving through the dunk finish), corona fuel drain, helpless-only pull, and missing-fuel launch scaling
- five zero-default `GameTuning` knobs registered in the zero-default fingerprint/replay compatibility lists; default sim verified bit-identical (`replay:check` and existing matchup baselines unchanged)
- shipped as balance profile `well_hazard_v1` (not ranked-allowlisted), live-tunable via Debug Tuning → "Well hazard (experimental)"
- validation: `wellHazard.test.ts` (13 tests), full unit suite, `replay:check`, `matchup:smoke` (additive rows only), `balance:validate`, `balance:patch-notes`, `rollback:soak` (converged, depth within budget), `ai:balance-gate` (pass)
- targets the documented "launches do not become finishes" / "zero-fuel stall" loop debt; design + promotion path in `docs/WELL_HAZARD_EXPERIMENT.md`

## Producer Checklist

- keep all work mapped to one of the three stream docs
- prefer bounded sub-agent tasks with disjoint write sets
- require validation notes when touching gameplay or online flows
- update this file after each completed batch instead of letting work live only in chat

## Suggested Next Delegation Batch

1. Gameplay agent:
   define the first two character kit targets and any schema/tooling gaps that block them
2. Design/assets agent:
   write the visual bible and first character/stage content checklist
3. Online agent:
   complete the live match end-state and ranked result handoff

## Stop Conditions

Pause new work and reassess if:

- online cannot complete one match loop reliably
- character identity is still too vague to drive art/audio work
- validation tooling is too weak to support safe iteration
