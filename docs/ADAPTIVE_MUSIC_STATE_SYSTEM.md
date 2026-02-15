# Adaptive Music State System

## Goal
Drive music state changes from gameplay state and transitions with deterministic triggers and configurable fades.

## States
- `menu`
- `neutral`
- `launch`
- `end`

## Source files
- State controller: `apps/game-web/src/view/audio/musicState.ts`
- Controller tests: `apps/game-web/src/view/audio/musicState.test.ts`
- Runtime wiring: `apps/game-web/src/main.ts`

## Runtime behavior
- Main loop resolves target state from app phase and render snapshot:
  - `menu` for home and online-dev surfaces
  - `launch` when either player is in helpless launch state
  - `end` when match-over or winner state is active
  - otherwise `neutral`
- On state change, the controller emits typed music events through the audio event bus.
- Music bus gain is interpolated over `fadeSeconds` to avoid abrupt transitions.

## Determinism notes
- For simulation-driven phases, controller clock uses `snapshot.gameTime`.
- For non-simulation menu phases, controller uses wall-clock time.
- State transitions are derived from phase + snapshot data (no random triggers), keeping replay behavior stable.

