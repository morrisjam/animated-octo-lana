# Training Telemetry Workflow (E4.2 / S4.7)

Training mode now captures a local telemetry session so balance changes can be compared with objective metrics.

## Where it runs
- Runtime tracker: `apps/game-web/src/sim/trainingTelemetry.ts`
- Main integration: `apps/game-web/src/main.ts`
- Pause menu export action: `apps/game-web/src/view/pauseMenu.ts`

## How to use
1. Start `Training` mode.
2. Play rounds and adjust tuning.
3. Open pause menu -> `Debug Tuning`.
4. Click `Export Training Telemetry`.

The game downloads a JSON file and also stores the latest export in local persistence.

## Storage key
- `gravity_well.training_telemetry.v1`

## Captured metrics (P1 focus)
- rounds started/completed/won
- manual restarts and mode exits
- frame count and round durations
- input usage (launch/special/dunk/parry presses, boost/super-boost active frames)
- outcomes (launch hits, dunk hits, special resolves, derived rates)
- fuel spent and max chain peak
- metadata: ruleset version, balance profile id, selected character matchup
