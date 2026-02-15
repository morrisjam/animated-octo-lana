# Character Package Schema (S4.1)

Schema version:
- `gw.character-package.v1`

Source:
- Schema parser/validator: `apps/game-web/src/content/characterPackageSchema.ts`
- CLI validator: `apps/game-web/scripts/character-package-validate.ts`
- Example package: `apps/game-web/content/characters/vanguard/vanguard.character.package.json`

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

## Report output
- Validation report path: `apps/game-web/build-artifacts/character-package-validation-report.json`
- Report includes:
  - files scanned
  - valid and invalid counts
  - per-file validation issues with JSON path and message
