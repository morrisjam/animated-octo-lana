# State Snapshot Serialise/Restore

Date: 2026-02-15  
Story: `S1.5` Full state serialise and restore

## Goals
- Capture complete deterministic simulation state at any frame.
- Restore snapshots safely for rollback/resume without runtime crashes.
- Keep serialized snapshot format forward-compatible.

## Implementation
- Snapshot clone path:
  - `createStateSnapshot(state)` in `apps/game-web/src/sim/sim.ts`
- Restore path:
  - `restoreStateFromSnapshot(snapshot)` validates snapshot root shape and serializable values.
  - Invalid payloads fail with explicit `Invalid state snapshot` errors.
- Serialized format:
  - Versioned envelope `{ version, state }` with `STATE_SNAPSHOT_VERSION`.
  - Legacy compatibility: direct `GameState` JSON payloads are still accepted by `deserialiseState`.

## Validation Rules
- Snapshot must include required root branches:
  - `loadout`, `players.P1`, `players.P2`, `projectiles`, `tuning`
- Snapshot values must be JSON-serializable:
  - no `undefined`
  - finite numeric values only
  - no unsupported runtime types
- Deserializer rejects:
  - non-JSON payloads
  - unsupported snapshot versions
  - malformed snapshot shapes

## Tests
- `apps/game-web/src/sim/sim.test.ts`
  - restore/resume checksum parity
  - serialise/deserialise checksum parity
  - legacy payload compatibility
  - malformed payload and unsupported version failures
