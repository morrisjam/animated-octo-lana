# Arcade Mode Flow

`S1.23` adds a single-player arcade ladder flow to local gameplay.

## Ladder structure

- Arcade mode is selectable from the Local setup menu.
- The ladder is staged and data-driven in `apps/game-web/src/sim/arcade.ts`.
- Default run has multiple stages and a final encounter stage.

## Stage progression

- Each stage runs a match-to-win format (`roundsToWin`).
- On stage clear, the run advances to the next stage.
- On final stage clear, the run ends with an arcade completion summary screen.

## Continue and retry rules

- Local setup menu exposes:
  - `Arcade Continues` (0-3)
  - `Arcade Retry` (Enabled/Disabled)
- These settings drive run rules:
  - continue availability after a stage loss
  - retry-stage availability after a stage loss
- Loss prompts are shown in match-over UI with action buttons mapped to available rules.

## Summary screens

- `Arcade Complete` summary includes:
  - final encounter cleared
  - stages cleared
  - continues and retries used
  - run duration
- `Arcade Run Ended` summary is shown when no continue/retry action remains.

## Persistence

- Arcade menu settings are persisted in:
  - local settings (`gravity_well.settings.v1`)
  - profile settings payload (`platform.profile.saveProfile`)
