# Matchup Regression Smoke Workflow (E4.2 / S4.9)

This workflow validates deterministic core interaction behavior across balance profiles.

## Source of truth
- Fixture runner: `apps/game-web/src/sim/matchupRegression.ts`
- Script entrypoint: `apps/game-web/scripts/matchup-regression-smoke.ts`
- Checked-in baseline: `apps/game-web/smoke/matchup-regression.expected.json`

## Covered interactions
- `launch_connect`
- `launch_vs_parry`
- `dunk_connect`
- `special_projectile_spawn`

Each fixture records:
- semantic pass/fail checks
- deterministic final checksum
- final state snapshot summary

## Commands
Run from repo root:

```bash
npm run matchup:smoke
```

Workspace direct:

```bash
npm run matchup:smoke -w @gravity-well/game-web
```

## Optional flags
- `--profiles <id1,id2,...|all>`: run subset/all profiles
- `--expected <path>`: baseline file path (default `smoke/matchup-regression.expected.json`)
- `--report <path>`: report path (default `build-artifacts/matchup-regression-smoke-report.json`)
- `--write-expected`: regenerate baseline checksums from current behavior

Example baseline refresh:

```bash
npm run matchup:smoke -w @gravity-well/game-web -- --write-expected
```

## CI integration
- Included in:
  - `npm run build -w @gravity-well/game-web`
  - `npm run build:steam -w @gravity-well/game-web`
  - `npm run verify -w @gravity-well/game-web`

## Output artifact
- `apps/game-web/build-artifacts/matchup-regression-smoke-report.json`
