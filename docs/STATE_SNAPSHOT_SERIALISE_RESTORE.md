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
  - Versioned envelope `{ version, state }` with `STATE_SNAPSHOT_VERSION` (`v5` currently).
  - Versions `v1` through `v3` and direct legacy `GameState` JSON payloads remain readable.
  - Missing zero-default flow fields, including the combat-boost lock timer, restore to neutral values.

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
  - `v1` through `v3` legacy payload compatibility and zero-default field migration
  - malformed payload and unsupported version failures
