# Character Kit Architecture

## Goal
Each character can own custom:
- model and animation set
- visual presentation mode (`3d`, `sprite`, `hybrid`)
- VFX profile
- SFX and voice profile
- frame data
- projectile behaviour and visuals
- special move slots

without changing core simulation flow.

## Primary data source
- `apps/game-web/src/sim/characters.ts`
- Shared timing registry: `apps/game-web/src/sim/moveData.ts` (`COMBAT_MOVE_FRAME_REGISTRY`)

Each `CharacterDefinition` now includes:
- `stats`: gameplay multipliers (including fuel capacity and fuel multipliers)
- `visuals`: model and VFX identifiers
  - `presentation`: `3d`, `sprite`, or `hybrid`
- `audio`: SFX, voice, and theme identifiers
- `moves`:
  - `launch`: startup, active, hit and whiff recovery frames
  - `dunk`: startup, active, range, hit and whiff recovery frames
  - `parry`: startup, active window, recovery, counter stun
  - `break`: startup, active window, recovery, and post-break velocity retention
  - `movement`: per-second fuel drain while moving
  - `special`: per-character unique move definition:
    - `kind`: `projectile`, `command_grab`, `movement`, or `block`
    - `timing`: startup, active duration, recovery, and cooldown
    - `size`: range, radius, width, and length
    - type-specific payload (for example projectile stats or movement dash speed)
  - `boost`: hold speed multiplier and per-second fuel drain
  - `superBoost`: speed/steer/blend multipliers, start fuel cost, travel fuel rate, non-commit penalty
- `specials`: reserved slots for custom moves

## Runtime usage
- Simulation reads per-character move data directly:
  - launch timing from character `moves.launch`
  - dunk timing and range from character `moves.dunk`
  - parry window/recovery/counter-stun from character `moves.parry`
  - break stun and velocity retention from character `moves.break`
  - movement fuel drain from character `moves.movement`
  - special behaviour, timing, and size from character `moves.special`
  - boost and super boost movement/fuel values from character `moves.boost` and `moves.superBoost`
- Default special is a single projectile placeholder, so current gameplay still works while allowing future non-projectile specials.
- HUD training frame panel reads launch/dunk/parry/break/special frame data per selected character and supports keyboard/controller toggle in training mode.
- Renderer reads visual presentation profile through adapter interface so 3D, sprite, and hybrid fighters can coexist.
- Renderer reads special projectile `visualId` from snapshot so projectile art can differ by character.
- Renderer binds combat events (`boost`, `launch`, `parry`, `projectile`, `dunk`) to data-driven VFX presets (`src/view/vfx`), with per-profile overrides.
- Asset manifests include budget hints for texture bytes, mesh triangles, and VFX emitters; build-time checks enforce project limits.
- Audio playback routes through typed audio events and bus routing (`src/view/audio`) instead of hardcoded clip paths in gameplay logic.
- Music uses state-based transitions (`menu`, `neutral`, `launch`, `end`) with configurable fades.
- Voice callouts use per-character voice profiles with locale fallback, priority ordering, cooldowns, and anti-spam gating.

## Extension points
1. Model and animation loading:
   - use `character.visuals.modelId` and `character.visuals.animationSetId` with manifest references from `src/view/assets`.
2. Character SFX and voice:
   - route action events to `character.audio.sfxProfileId` and `character.audio.voiceProfileId`.
3. Special moves:
   - replace placeholder `moves.special` payload per character with concrete command-grab, movement, or block implementations.
4. Balance updates:
   - tune startup/active/recovery frame data in one shared registry (`moveData.ts`).
   - tune per-character size and type-specific special values in `characters.ts`.
5. VFX tuning:
   - tune event bindings and preset values in `src/view/vfx/presets.ts`.
   - adjust particles, trails, flashes, and sound cues without changing sim combat logic.
