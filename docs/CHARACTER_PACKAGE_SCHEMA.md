# Character Package Schema (S4.1)

Schema version:
- `gw.character-package.v1`

Source:
- Schema parser/validator: `apps/game-web/src/content/characterPackageSchema.ts`
- CLI validator: `apps/game-web/scripts/character-package-validate.ts`
- Example package: `apps/game-web/content/characters/vanguard/vanguard.character.package.json`
- Author workflow guide: `docs/CHARACTER_PACKAGE_USER_GUIDE.md`

## Validation command
Run from repo root:

```bash
npm run character:validate -w @gravity-well/game-web
```

Optional directory override:

```bash
npm run character:validate -w @gravity-well/game-web -- --dir content/characters
```

## Required top-level fields
- `schemaVersion`
- `id`
- `displayName`
- `blurb`
- `mechanicsTag`
- `metadata`
- `stats`
- `visuals`
- `audio`
- `moves`
- `specials`

## Special move behavior contract (S4.3)
`moves.special` must include:
- `id`
- `label`
- `behaviorId`
- `kind`
- `fuelCost`
- `timing`
- `size`

Allow-listed `moves.special.behaviorId` values:
- `special.projectile.v1`
- `special.command_grab.v1`
- `special.movement_dash.v1`
- `special.block_guard.v1`

`kind` must match `behaviorId`:
- `special.projectile.v1` -> `projectile`
- `special.command_grab.v1` -> `command_grab`
- `special.movement_dash.v1` -> `movement`
- `special.block_guard.v1` -> `block`

Required payload block per `behaviorId`:
- `special.projectile.v1` -> `moves.special.projectile`
- `special.command_grab.v1` -> `moves.special.commandGrab`
- `special.movement_dash.v1` -> `moves.special.movement`
- `special.block_guard.v1` -> `moves.special.block`

## Report output
- Validation report path: `apps/game-web/build-artifacts/character-package-validation-report.json`
- Report includes:
  - files scanned
  - valid and invalid counts
  - per-file validation issues with JSON path and message
