# AI Behaviour Framework

## Goal
Provide deterministic enemy decision logic in simulation layer using the same input contract as human players.

## Source files
- AI policy:
  - `apps/game-web/src/sim/ai.ts`
- Tests:
  - `apps/game-web/src/sim/ai.test.ts`

## Design
- AI logic runs in `src/sim` and has no renderer/DOM dependencies.
- `tickAiController(...)` outputs `PlayerFrameInput` directly.
- `buildFrameInputWithAi(...)` combines local human input with AI input using standard `FrameInput` shape.

## Determinism
- AI controller keeps explicit RNG state.
- RNG progression uses shared deterministic RNG utilities from `src/sim/rng.ts`.
- Fixed-seed fixed-step simulation test verifies repeated runs produce identical action timelines and end state values.

