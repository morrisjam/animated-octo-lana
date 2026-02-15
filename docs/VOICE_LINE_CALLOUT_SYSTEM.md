# Voice Line And Callout System

## Goal
Provide data-driven character voice lines for key events with cooldown, priority, locale fallback, and anti-spam behavior.

## Source files
- Voice line data and selector:
  - `apps/game-web/src/view/audio/voiceLines.ts`
- Tests:
  - `apps/game-web/src/view/audio/voiceLines.test.ts`
- Runtime wiring:
  - `apps/game-web/src/main.ts`

## Callout events
- `round_start`
- `launch_hit`
- `parry_success`
- `dunk_hit`
- `match_win`

## Data model
- Voice line packs are keyed by `voiceProfileId` and locale.
- Each line defines:
  - `priority`
  - `cooldownSeconds`
  - text payload
  - cue envelope/frequency settings

## Selection rules
- Locale resolution order:
  1. exact locale
  2. same language tag
  3. `en-US`
  4. first available pack locale
- Highest priority eligible line is chosen deterministically.
- Cooldown gates:
  - per-line cooldown
  - per-player-event cooldown
  - global anti-spam minimum gap

## Runtime behavior
- Selected callouts emit typed `voice.callout` audio events through the shared audio bus.
- Main loop triggers callouts from combat VFX events and round/match flow hooks.

