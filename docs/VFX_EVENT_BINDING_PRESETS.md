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
- `launch`
- `parry`
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
- Audio cues use a lightweight WebAudio oscillator fallback path and no-op on unsupported contexts.

