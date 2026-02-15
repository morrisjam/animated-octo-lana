# AI Difficulty Profiles

`S1.22` adds data-driven AI difficulty profiles for local single-player flows.

## Profiles

Defined in `apps/game-web/src/sim/ai.ts`:

- `rookie`
- `cadet`
- `veteran`
- `ace`

Each profile controls:

- `reactionDelayFrames`
- `actionWeights` (`launch`, `special`, `dunk`, `parry`)
- `riskAppetite`
- `errorRate`
- `approachDistance`

## Runtime integration

- Local gameplay uses AI for `P2` in `endless` and `best_of_3`.
- Training mode keeps AI disabled.
- Main loop integration lives in `apps/game-web/src/main.ts` with:
  - `createAiController(...)`
  - `tickAiController(...)`
  - `buildFrameInputWithAi(...)`

## Menu and persistence

- Local setup menu now includes `AI Difficulty` in `apps/game-web/src/view/startMenu.ts`.
- Selection supports keyboard, mouse, and controller navigation.
- Difficulty is persisted to:
  - local settings key: `gravity_well.settings.v1`
  - profile settings payload via `platform.profile.saveProfile(...)`
- Bootstrap reads profile settings and applies local setup when available.
