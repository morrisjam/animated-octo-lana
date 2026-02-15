# Balance Patch Notes Workflow (E4.2 / S4.8)

This workflow generates release-note-ready tuning diffs from balance profiles.

## Source of truth
- Profile registry: `apps/game-web/src/sim/balanceProfiles.ts`
- Diff and markdown formatter: `apps/game-web/src/sim/balancePatchNotes.ts`
- Generator script: `apps/game-web/scripts/balance-patch-notes.ts`

## Commands
Run from repo root:

```bash
npm run balance:patch-notes
```

Workspace direct:

```bash
npm run balance:patch-notes -w @gravity-well/game-web
```

## Optional flags
- `--base <profileId>`: base profile for comparisons (default `default`)
- `--profiles <id1,id2,...|all>`: explicit targets (default all non-base profiles)
- `--include-unchanged`: include unchanged tuning fields in each table
- `--out <path>`: markdown output path (default `build-artifacts/balance-patch-notes.md`)
- `--report <path>`: JSON report output path (default `build-artifacts/balance-patch-notes-report.json`)

Example:

```bash
npm run balance:patch-notes -w @gravity-well/game-web -- --base default --profiles mobility_focus_v1
```

## Outputs
- `apps/game-web/build-artifacts/balance-patch-notes.md`
- `apps/game-web/build-artifacts/balance-patch-notes-report.json`

The markdown artifact is intended for patch notes and design review checklists.
