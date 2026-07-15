# Character Package User Guide

This guide is for creating and validating character packages without editing core simulation code.

## What a character package is
- A `.character.package.json` file under `apps/game-web/content/characters/<your-character>/`.
- It defines one fighter's:
  - identity and display fields
  - gameplay stats and move data
  - visual ids and audio ids
  - special move metadata

## 1. Scaffold a new package
Preferred command (from repo root):

```bash
npm run character:new -- --id striker --display-name "Striker" --author "Your Name"
```

Workspace direct variant:

```bash
npm run character:new -w @gravity-well/game-web -- --id striker --display-name "Striker"
```

What it creates:
- Folder: `apps/game-web/content/characters/striker/`
- File: `apps/game-web/content/characters/striker/striker.character.package.json`

Template reference (commented JSONC, not loaded at runtime):
- `apps/game-web/content/characters/_template/template.character.package.jsonc`

## 2. Edit required fields
- Use schema: `docs/CHARACTER_PACKAGE_SCHEMA.md`
- Keep:
  - `schemaVersion` = `gw.character-package.v1`
  - `id` lowercase with letters, numbers, underscore
- In `moves.special`, set allow-listed `behaviorId` and matching `kind`.
- Tune `moves.dunk.startupPursuitSpeed` and `moves.dunk.startupTracking` for the character's launched-target chase identity. Use `0` for either value to disable startup pursuit.
- Tune `stats.naturalRecoveryResetMultiplier` only when the class should receive more or less of the global natural-recovery spacing reset. Keep `1` for neutral behavior; test changes with the Human recovery agency probe before promotion.
- Tune only `moves.break.recoveryFrames` and `moves.break.velocityRetain` for the current launch-break runtime. Startup and active fields are reserved but do not yet change simulation behavior.
- Keep unused model, VFX, projectile, SFX, voice, or music profile slots as `null`. Do not invent ids to fill optional fields.
- Register every required file in `src/view/assets/defaultManifest.ts` and mark an alpha candidate `readiness: "alpha"` only after review.

## 3. Validate package data
From repo root:

```bash
npm run character:validate -w @gravity-well/game-web
```

What you get:
- pass/fail output per package file
- report JSON:
  - `apps/game-web/build-artifacts/character-package-validation-report.json`

Optional dry run for scaffolder:

```bash
npm run character:new -- --id striker --dry-run
```

## 4. Run package QA harness
From repo root:

```bash
npm run character:qa -w @gravity-well/game-web
```

What you get:
- deterministic checksum smoke replay per package
- frame/balance bounds checks
- required-file and implemented-profile checks
- explicit `alphaAssets=ok|fail` output with no fallback estimates
- report JSON:
  - `apps/game-web/build-artifacts/character-package-qa-report.json`

## 5. Run the game
- `npm run dev -w @gravity-well/game-web`
- Open local setup in menu.
- Your packaged character is loaded into runtime registry and can be selected.

For sprite presentation, set `visuals.presentation` to `sprite`, keep `visuals.modelId` as `null`, register the package's `visuals.animationSetId` and `visuals.hudPortraitId`, and follow `docs/SPRITE_ATLAS_RUNTIME.md`.

## 6. Build and CI checks
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
- `alphaAssets=fail`
  - Inspect `unresolvedManifestRefs`, `belowAlphaReadinessRefs`, and `unresolvedProfileRefs` in the QA report.
  - Add or review the real required file/profile; do not silence the failure with a placeholder id.
