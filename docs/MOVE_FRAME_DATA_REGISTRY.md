# Move Frame-Data Registry

Story: `S1.11` Move frame-data registry

## Goal

Keep startup, active, and recovery timings for combat moves in one 60Hz registry so designers can rebalance without editing simulation flow code.

## Source of truth

- `apps/game-web/src/sim/moveData.ts`
  - `COMBAT_MOVE_FRAME_REGISTRY`: timing registry authored in frame units.
  - `SIMULATION_FRAME_RATE_HZ`: fixed at `60`.
  - `createMoveFrameData(...)`: builds per-character move data from the shared registry.

## Coverage

Registry values include explicit timing for:

- `launch`: startup, active, recovery on hit, recovery on whiff
- `dunk`: startup, active, recovery on hit, recovery on whiff
- `parry`: startup, active, recovery, counter stun
- `break`: startup, active, recovery
- `special`: startup, active, recovery, cooldown

## Runtime wiring

- `apps/game-web/src/sim/characters.ts` builds each character `moves` from `createMoveFrameData`.
- `apps/game-web/src/sim/sim.ts` reads move timing from character move definitions (no hardcoded startup/active/recovery frame constants).
- `apps/game-web/src/sim/replayReview.ts` uses shared frame conversion helpers from `moveData.ts`.

## Tests

- `apps/game-web/src/sim/moveData.test.ts`
  - validates explicit frame values for combat moves
  - validates character moves are built from the shared registry
  - validates 60Hz conversion helpers
