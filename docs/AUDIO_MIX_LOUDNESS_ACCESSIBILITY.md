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
- Voice ducking lowers music and SFX bus gain briefly while voice callouts play.
- `reduced` dynamic range mode further compresses mix by reducing music and SFX weighting.
- Subtitle toggle controls in-game display of callout subtitle text.

