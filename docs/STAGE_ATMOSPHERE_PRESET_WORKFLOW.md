# Stage Atmosphere Preset Workflow (E4.3 / S5.3)

Stage atmospheres are data-authored and applied to arena lighting/fog/background backdrops at runtime.

## Source of truth
- Atmosphere preset definitions: `apps/game-web/content/stages/atmospherePresets.ts`
- Runtime registry and resolver: `apps/game-web/src/view/stageAtmosphere.ts`
- Scene application hooks: `apps/game-web/src/view/scene.ts`
- Validator script: `apps/game-web/scripts/stage-atmosphere-validate.ts`

## Commands
Run from repo root:

```bash
npm run stage:validate
```

Workspace direct:

```bash
npm run stage:validate -w @gravity-well/game-web
```

## Build and CI integration
- Included in:
  - `npm run build -w @gravity-well/game-web`
  - `npm run build:steam -w @gravity-well/game-web`
  - `npm run verify -w @gravity-well/game-web`

## Runtime usage
- Open `Settings` in the home flow.
- Select `Stage Atmosphere` and cycle using:
  - mouse click
  - keyboard left/right
  - controller left/right
- Selection persists in settings as `stageAtmosphereId`.
- Atmosphere applies immediately to:
  - scene background and fog
  - ambient/key light color/intensity/position
  - gravity well and ring presentation
  - starfield color/size
  - optional background image/model slots
  - optional procedural background effect slots

## Background asset slots
- Presets may specify:
  - `backgroundImageTextureId`
  - `backgroundModelId`
- IDs must exist in `DEFAULT_ASSET_MANIFEST`:
  - textures list for `backgroundImageTextureId`
  - models list for `backgroundModelId`

## Procedural effect slots
- Presets may specify:
  - `backgroundEffectId`
  - `backgroundEffectTint`
  - `backgroundEffectSecondaryTint`
  - `backgroundEffectOpacity`
  - `backgroundEffectSpeed`
  - `backgroundEffectScale`
- Runtime currently supports:
  - `wormhole_v1`

## Report output
- `apps/game-web/build-artifacts/stage-atmosphere-validation-report.json`
