# Replay Checksum Runner

Date: 2026-02-15  
Story: `S1.6` Frame checksum and replay runner

## Purpose
- Run replay input timelines through simulation and emit per-frame checksums.
- Detect divergence against expected checksums with explicit first divergent frame reporting.
- Fail CI checks when divergence is detected.

## CLI
- Script: `apps/game-web/scripts/replay-runner.ts`
- Common commands:
  - `npm run replay:run --workspace @gravity-well/game-web -- --input replays/smoke.replay.json`
  - `npm run replay:check --workspace @gravity-well/game-web`
- Options:
  - `--input <replay.json>`
  - `--expected <checksums.json>`
  - `--expect-inline` (uses `expectedChecksums` from replay file)
  - `--output <checksums.json>` (writes produced checksums)
  - `--report <report.json>` (writes structured run report)

## Divergence Report
- On mismatch, runner prints:
  - first divergent frame index
  - expected checksum at that frame
  - actual checksum at that frame
  - expected vs actual frame counts
- Structured report payload includes:
  - `ok`
  - `frameCount`
  - `finalChecksum`
  - `expectedFrameCount`
  - `firstDivergentFrame`
  - `expectedChecksumAtDivergence`
  - `actualChecksumAtDivergence`

## CI Behavior
- `replay:check` exits non-zero when mismatch occurs.
- `verify` script includes `replay:check`, so divergence fails the build.

## Implementation
- Core compare logic: `apps/game-web/src/sim/replayRunner.ts`
- Script entrypoint: `apps/game-web/scripts/replay-runner.ts`
- Tests: `apps/game-web/src/sim/replayRunner.test.ts`
