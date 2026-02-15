# Balance Profile Workflow (E4.2 / S4.6)

This workflow defines how to ship gameplay tuning changes without direct simulation code edits.

## Source of truth
- Profile definitions: `apps/game-web/content/balance/balanceProfiles.ts`
- Runtime resolver: `apps/game-web/src/sim/balanceProfiles.ts`
- Validator: `apps/game-web/scripts/balance-profile-validate.ts`

## Commands
Run from repo root:

```bash
npm run balance:validate
```

Workspace direct:

```bash
npm run balance:validate -w @gravity-well/game-web
```

## Build and CI integration
- Included in:
  - `npm run build -w @gravity-well/game-web`
  - `npm run build:steam -w @gravity-well/game-web`
  - `npm run verify -w @gravity-well/game-web`

## Runtime profile selection
Set a profile id in environment:

```bash
VITE_BALANCE_PROFILE_ID=mobility_focus_v1
```

Notes:
- Missing or unknown ids safely fall back to `default`.
- Online diagnostics `rulesetVersion` appends the profile id for non-default profiles.

## Report output
- `apps/game-web/build-artifacts/balance-profile-validation-report.json`
