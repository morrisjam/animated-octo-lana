# Audio Event Bus And Routing

## Goal
Route gameplay/view audio through typed events and named buses, without clip-path logic in gameplay code.

## Source files
- Audio event types: `apps/game-web/src/view/audio/types.ts`
- Event bus: `apps/game-web/src/view/audio/eventBus.ts`
- Router/system: `apps/game-web/src/view/audio/system.ts`
- Unit tests: `apps/game-web/src/view/audio/system.test.ts`

## Typed events currently routed
- Combat:
  - `combat.boost`
  - `combat.launch`
  - `combat.parry`
  - `combat.projectile`
  - `combat.dunk`
- Music:
  - `music.menu`
  - `music.neutral`
  - `music.launch`
  - `music.end`
- Voice:
  - `voice.round_start`
  - `voice.callout`

Combat events are emitted from VFX runtime callback wiring in `src/main.ts` when render combat events fire.

## Bus routing
- Supported buses:
  - `master`
  - `music`
  - `sfx`
  - `voice`
- WebAudio sink creates gain nodes per bus and routes event cues through the mapped bus.
- Bus volumes are clamped and adjustable via `setBusVolume`.

## Adaptive music state
- Music state controller lives in `apps/game-web/src/view/audio/musicState.ts`.
- States: `menu`, `neutral`, `launch`, `end`.
- Main loop resolves state from app phase and render snapshot, then applies deterministic state-change triggers.
- Music bus gain transitions use configurable fade duration to avoid abrupt transitions.

## Missing route diagnostics
- Router tracks emitted/routed/missing counts.
- Missing route or missing cue handling policy:
  - `warn` (default): log diagnostic warning.
  - `throw`: fail immediately with explicit error for dev strictness.
- Main web runtime uses strict `throw` behavior when debug tools are enabled.
