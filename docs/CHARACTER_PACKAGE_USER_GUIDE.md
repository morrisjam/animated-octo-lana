# Character Package User Guide

This guide is for creating and validating character packages without editing core simulation code.

## What a character package is
- A `.character.package.json` file under `apps/game-web/content/characters/<your-character>/`.
- It defines one fighter's:
  - identity and display fields
  - gameplay stats and move data
  - visual ids and audio ids
  - special move metadata

## 1. Create a new package folder
- Copy the example package:
  - `apps/game-web/content/characters/vanguard/vanguard.character.package.json`
- Rename the folder and file to your character id.

Example:
- Folder: `apps/game-web/content/characters/striker/`
- File: `apps/game-web/content/characters/striker/striker.character.package.json`

## 2. Edit required fields
- Use schema: `docs/CHARACTER_PACKAGE_SCHEMA.md`
- Keep:
  - `schemaVersion` = `gw.character-package.v1`
  - `id` lowercase with letters, numbers, underscore
- In `moves.special`, set allow-listed `behaviorId` and matching `kind`.

## 3. Validate package data
From repo root:

```bash
npm run character:validate -w @gravity-well/game-web
```

What you get:
- pass/fail output per package file
- report JSON:
  - `apps/game-web/build-artifacts/character-package-validation-report.json`

## 4. Run the game
- `npm run dev -w @gravity-well/game-web`
- Open local setup in menu.
- Your packaged character is loaded into runtime registry and can be selected.

## 5. Build and CI checks
- Package validation is included in:
  - `npm run build -w @gravity-well/game-web`
  - `npm run build:steam -w @gravity-well/game-web`
  - `npm run verify -w @gravity-well/game-web`

## Troubleshooting
- Error: missing required field
  - Check report path + JSON path in error output.
- Error: invalid special move payload
  - Ensure `moves.special.behaviorId` is one of:
    - `special.projectile.v1`
    - `special.command_grab.v1`
    - `special.movement_dash.v1`
    - `special.block_guard.v1`
  - Ensure `moves.special.kind` matches `behaviorId` and the required payload block exists.
- Character does not appear
  - Ensure file name ends with `.character.package.json`.
  - Re-run validator and fix any invalid package warnings.
