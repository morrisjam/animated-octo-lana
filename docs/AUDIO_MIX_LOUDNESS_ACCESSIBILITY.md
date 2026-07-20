# Audio Mix, Loudness, And Accessibility Controls

## Goal
Expose player-facing audio mix controls and accessibility options, while preserving voice-callout clarity during heavy action.

## Implemented controls
- Master volume
- Music volume
- SFX volume
- Voice volume
- Voice ducking toggle
- Dynamic range mode (`wide` / `reduced`)
- Voice subtitles toggle

All controls are available in pause menu tab `Audio`.

## Source files
- Audio settings model/sanitiser:
  - `apps/game-web/src/view/audio/settings.ts`
- Pause menu UI:
  - `apps/game-web/src/view/pauseMenu.ts`
- Runtime application:
  - `apps/game-web/src/main.ts`
- Subtitle HUD rendering:
  - `apps/game-web/src/view/hud.ts`

## Runtime behavior
- Volumes are persisted with player settings and applied to `master`, `music`, `sfx`, and `voice` buses.
- Decoded samples and oscillator fallbacks share the same bus graph, panning, and volume controls.
- Volume changes made before browser audio unlock are retained without starting an `AudioContext`.
- Voice ducking lowers music and SFX bus gain briefly while voice callouts play.
- `reduced` dynamic range mode further compresses mix by reducing music and SFX weighting.
- Subtitle toggle controls in-game display of callout subtitle text.

Sample-file gain is intentionally limited to a per-route multiplier. Source audio
should still be delivered as consistent, unclipped masters; runtime gain is not a
replacement for loudness mastering. Oscillator cues remain available as temporary
fallbacks until commissioned audio has passed licensing, loudness, and
accessibility review.

