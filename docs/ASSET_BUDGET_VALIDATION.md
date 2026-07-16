# Asset Budget Validation

## Goal
Enforce stable visual performance budgets with build-time checks and runtime debug counters.

## Budget dimensions
- Texture memory budget (`textureBytes`), including sprite atlases and standalone textures
- Mesh complexity budget (`meshTriangles`)
- VFX emitter budget (`vfxEmitters`)

## Source files
- Budget model/report:
  - `apps/game-web/src/view/assets/budget.ts`
- Manifest budget hints:
  - `apps/game-web/src/view/assets/types.ts`
  - `apps/game-web/src/view/assets/defaultManifest.ts`
  - package-adjacent `*.character.presentation.json` files for character atlases and portraits
- Build-time check script:
  - `apps/game-web/scripts/asset-budget-check.ts`

## Build-time enforcement
- `npm run build` and `npm run build:steam` run `npm run asset:budget-check` before Vite.
- The checker writes `apps/game-web/build-artifacts/asset-budget-report.json`.
- If usage exceeds any configured limit, build exits non-zero with violation details.

## Runtime debug counters
- HUD debug diagnostics now include:
  - preloaded asset bytes
  - budgeted texture bytes
  - budgeted mesh triangles
  - budgeted VFX emitters
  - active runtime VFX count
  - active projectile count
- Counters are visible when debug tools are enabled.

