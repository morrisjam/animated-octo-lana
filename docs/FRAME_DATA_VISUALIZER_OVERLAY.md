# Training Frame Data Visualizer Overlay

Story: `S1.12` Frame data visualiser overlay

## Scope

Expose a training-only overlay that shows startup, active, and recovery values from the shared move frame-data registry for both players.

## Runtime behavior

- Overlay is available only while in `training` mode and `playing` phase.
- Toggle inputs:
  - Keyboard: `F1`
  - Controller: `View/Back` button (gamepad button index `8`)
- Restart training shortcut remains `N`.

## Data source

- Overlay content is generated from character move definitions derived from:
  - `apps/game-web/src/sim/moveData.ts`
  - `apps/game-web/src/sim/characters.ts`
- Render model builder:
  - `apps/game-web/src/view/trainingFrameData.ts`

## Performance note

- HUD now caches the overlay content by character matchup signature (`P1|P2`).
- Overlay markup is rebuilt only when character selection changes, not every frame.

## Test coverage

- `apps/game-web/src/view/trainingFrameData.test.ts`
  - verifies rows for launch/dunk/parry/break/special are present
  - verifies values come from character move data
