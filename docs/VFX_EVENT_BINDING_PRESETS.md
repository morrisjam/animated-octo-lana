# VFX Event Binding And Presets

## Goal
Bind combat events from simulation snapshots to VFX presets that can be tuned from data files without gameplay code edits.

## Source files
- Event extraction: `apps/game-web/src/view/vfx/events.ts`
- Preset library and bindings: `apps/game-web/src/view/vfx/presets.ts`
- Runtime playback: `apps/game-web/src/view/vfx/runtime.ts`
- Preset schema: `apps/game-web/src/view/vfx/types.ts`

## Bound combat events
- `boost`
- `super_boost`
- `launch`
- `clash`
- `parry`
- `special`
- `break`
- `projectile`
- `dunk`

`extractCombatVfxEvents(previous, current)` compares consecutive `RenderSnapshot` values and emits typed events for renderer playback.

## Preset structure
Each preset can define:
- `particles`: burst color, scale, opacity, drift, and lifetime
- `trail`: color, width, length, opacity curve, and lifetime
- `flash`: ring color, radius, thickness, scale, opacity curve, and lifetime
- `sound`: waveform, frequency, gain, and duration

## Data-driven binding
- `COMBAT_VFX_EVENT_BINDINGS` maps event type to preset id.
- `CHARACTER_VFX_EVENT_OVERRIDES` enables per-character-profile overrides (for example `ace` launch override).
- Designers can tune visual and cue values in `presets.ts` with no simulation/gameplay logic edits.

## Runtime notes
- Render loop emits VFX events each frame and updates transient effect lifetimes.
- Timeline rewinds (round reset, replay seek) clear active transient VFX safely.
- Audio cue data is emitted as typed combat audio events and routed by the shared audio event bus (`src/view/audio`).

## Action readability overlay
Accepted fighter actions also drive persistent, player-centred action halos in `apps/game-web/src/view/actionReadability.ts`.
The colour and silhouette are action-specific rather than player-specific, and the Analysis HUD displays the same key plus each fighter's live accepted action and phase. A launched fighter is labelled `Launched`; the launch halo remains reserved for the fighter performing Launch.
