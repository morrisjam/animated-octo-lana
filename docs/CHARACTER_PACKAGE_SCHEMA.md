# Character Package Schema (S4.1)

Schema version:
- `gw.character-package.v1`

Source:
- Schema parser/validator: `apps/game-web/src/content/characterPackageSchema.ts`
- Scaffolder: `apps/game-web/scripts/character-package-new.ts`
- CLI validator: `apps/game-web/scripts/character-package-validate.ts`
- Shipping source packages:
  - `apps/game-web/content/characters/vanguard/vanguard.character.package.json`
  - `apps/game-web/content/characters/duelist/duelist.character.package.json`
- Commented template: `apps/game-web/content/characters/_template/template.character.package.jsonc`
- Author workflow guide: `docs/CHARACTER_PACKAGE_USER_GUIDE.md`

## Scaffolding command
Run from repo root:

```bash
npm run character:new -- --id striker --display-name "Striker" --author "Your Name"
```

## Validation command
Run from repo root:

```bash
npm run character:validate -w @gravity-well/game-web
```

Optional directory override:

```bash
npm run character:validate -w @gravity-well/game-web -- --dir content/characters
```

## QA harness command (S4.5)
Run from repo root:

```bash
npm run character:qa -w @gravity-well/game-web
```

This runs:
- deterministic checksum smoke replay per package
- frame-data and balance bounds checks
- per-package asset budget checks
- required-file alpha-readiness and runtime-profile checks

Vanguard and Duelist are loaded through explicit JSON imports as well as Vite discovery. Browser, Vitest, and Node/`tsx` balance tools therefore use the same definitions and stable roster order. Runtime telemetry includes a hash of the effective stats and move rules so reports from incompatible packages cannot be combined.

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

## Visual and audio reference contract

Every reference field remains present in the JSON shape, but kit-dependent slots may be `null`. `null` means the character uses shared runtime behavior or does not need that asset; it must not be replaced with a made-up manifest id.

- `visuals.presentation: "sprite"` requires `animationSetId`; `modelId` may be `null`.
- `visuals.presentation: "3d"` requires `modelId`; `animationSetId` may be `null`.
- `visuals.presentation: "hybrid"` requires both `modelId` and `animationSetId`.
- `hudPortraitId` is required for every presentation.
- `vfxProfileId` is nullable. A non-null id must be registered by the runtime VFX profile library.
- `projectileVisualId` is nullable. A projectile kit declares its authoritative texture id at `moves.special.projectile.visualId`.
- `sfxProfileId`, `voiceProfileId`, and `musicThemeId` are nullable. A non-null id must resolve through an implemented runtime profile registry.

Character QA fails closed when a required file id is missing from the asset manifest, is below `alpha` readiness, or names an unimplemented runtime profile. Missing files receive no fallback budget estimate. Vanguard and Duelist currently use alpha SVG atlases and portraits plus implemented procedural voice profiles. Their character packages also select distinct combat VFX profiles: Vanguard's special resolves as a broad defensive halo, while Duelist's resolves as a directional pressure-dash streak.

## Dunk pursuit contract
`moves.dunk` includes the standard startup, active, recovery, and `hitRange` values plus:

- `startupPursuitSpeed`: desired chase speed while the dunk is in startup and the target is launched.
- `startupTracking`: per-frame velocity blend from `0` (no pursuit) to `1` (full tracking).

Pursuit is deterministic and stops as soon as the target leaves helpless state, so launch break and natural launch recovery remain counterplay. Both values are editable in the local Balance Lab and are included in package fingerprints, rollback checksums, and replay identity.

## Natural recovery identity

`stats.naturalRecoveryResetMultiplier` scales only the global natural-recovery defensive reset for this fighter. `1` uses the global value unchanged, `0` opts the class out, and values up to `3` allow stronger package-authored recovery spacing. It does not affect launch-break reset, parry reset, helpless duration, or action availability. Existing v1 packages that omit the field load as `1`, preserving schema compatibility. The effective value is validated, editable in the local Balance Lab, and included in character fingerprints used by telemetry and deterministic comparison gates.

`moves.break.startupFrames` and `moves.break.activeFrames` remain required package fields for forward compatibility, but the current launch-break simulation resolves the spend immediately and uses only `recoveryFrames` and `velocityRetain`. The Balance Lab therefore hides startup and active as tuning controls until those phases are implemented.

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
- QA report path: `apps/game-web/build-artifacts/character-package-qa-report.json`
- Report includes:
  - files scanned
  - valid and invalid counts
  - per-file validation issues with JSON path and message
