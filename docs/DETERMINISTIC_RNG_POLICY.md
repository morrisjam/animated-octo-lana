# Deterministic RNG Policy

Date: 2026-02-15  
Story: `S1.4` Deterministic RNG policy

## Policy
- Simulation randomness must be deterministic and seed-driven.
- `src/sim` must not use nondeterministic sources such as `Math.random()`.
- Match start seed must initialize simulation RNG state.

## Implementation
- RNG utility: `apps/game-web/src/sim/rng.ts`
  - `sanitiseSeed(seed)` ensures valid non-zero 32-bit state
  - `nextRngState(state)` advances deterministic xorshift stream
  - `rngStateToUnitFloat(state)` maps stream state to `[0, 1)`
- Simulation entry points:
  - `createInitialState({ seed })` sets `state.seed` and `state.rngState`
  - `nextDeterministicRandom(state)` is the only simulation random step helper

## Verification
- Existing deterministic simulation tests:
  - `apps/game-web/src/sim/sim.test.ts`
- Policy guard tests:
  - `apps/game-web/src/sim/rngPolicy.test.ts`
  - validates no `Math.random()` in non-test sim sources
  - validates same seed + same inputs => same checksum sequence
