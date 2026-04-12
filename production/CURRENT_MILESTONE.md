# Current Milestone

Name: `Vertical Slice To Online Alpha`  
Date opened: 2026-04-06  
Status: active

## Objective

Ship one believable slice of `Gravity Well` that proves:

- the game fantasy is readable
- the core mechanics are tunable
- the art/content pipeline can produce non-placeholder output
- online play can complete a real ranked match loop

## Player-Facing Outcome

A player should be able to:

1. boot into a stable menu flow
2. play local/training against distinct characters on a signature wormhole stage
3. understand the visual/audio identity of the game
4. queue online in a controlled environment and complete a live match
5. receive a clear result and progression outcome

## Milestone Exit Criteria

### Gameplay / systems
- at least `2` characters have distinct kit identities beyond placeholders
- frame data and special behavior contracts are explicit and validated
- replay/determinism checks remain stable after tuning changes
- training and AI support calibration rather than only ad hoc playtests

### Design / assets
- wormhole stage has a locked art direction and approved asset pass
- first character content package is shippable through the documented pipeline
- VFX and audio are readable and tied to game events
- HUD/menu presentation feels intentional and remains readable over gameplay

### Online / services
- controlled online runtime works end to end
- reconnect and invalid-session failure cases are handled
- ranked result submission is wired to actual match completion
- the feature can be enabled intentionally without misleading players

## Out Of Scope For This Milestone

- full launch roster
- full narrative/cutscene system
- complete social feature polish
- final release marketing assets
- console release work

## Stream Priorities

### Priority A
- online runtime completion
- first real character kit pass
- wormhole stage and presentation lock

### Priority B
- training and replay regression tightening
- audio/VFX cohesion
- ranked/leaderboard UX cleanup

### Priority C
- arcade depth
- expanded content pack
- release media

## Risks

- online work can keep expanding if the live match loop is not scoped tightly
- content work can drift if character identity is not locked early
- gameplay tuning can stall if regression and telemetry loops are not treated as first-class tools

## Milestone Rule

Do not start broad new feature families until this milestone proves one complete vertical slice.
