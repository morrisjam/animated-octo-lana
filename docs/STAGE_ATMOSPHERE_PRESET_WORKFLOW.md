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
  - presentation-only camera pitch and look-at offset
  - a transparent arena-mouth shear plane
  - arena lip and radial depth-tick treatment
  - gravity well and ring presentation
  - starfield color/size
  - optional background image/model slots
  - optional procedural background effect slots

Camera pitch, arena-lip geometry, and procedural depth travel are render-only. They do not alter fighter coordinates, collision checks, replay inputs, or rollback state.

## Arena presentation controls
- `cameraPitchDegrees`: base shallow camera pitch, clamped to `28` degrees.
- `cameraLaunchPitchBoostDegrees`: extra pitch while a fighter is in launch state, clamped to `10` degrees.
- `cameraLookAtYOffset`: raises or lowers the visual camera target without moving the simulation plane.
- `arenaMouthOpacity`: opacity of the sparse gravity-shear lines defining the combat plane; `0` disables it.
- `arenaRimOpacity`: opacity of the deterministic broken arena-mouth lip. The lip uses three subtly irregular arc contours, wider gaps on the far edge, and short near-edge braces rather than a complete circular ring.
- `arenaDepthTickOpacity`: opacity of the broken polar depth guides and lip marks that make camera pitch readable.

`wormhole_depths_v2` deliberately sets the legacy full boundary/torus opacity to zero. Its broken lip and sparse shear plane carry the arena-mouth read without placing a perfect Saturn-like ring over the shaft.

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
  - `backgroundEffectCoreOpacity`
  - `backgroundEffectFarFade`
  - `backgroundEffectSpeed`
  - `backgroundEffectScale`
  - `backgroundEffectDepthTravel`
- Runtime currently supports:
  - `wormhole_v1`

`backgroundEffectDepthTravel` adds bounded, deterministic ring and particle travel through the wormhole shaft. It is presentation state only and may accelerate during launch without entering the deterministic simulation snapshot.

`backgroundEffectCoreOpacity` controls the distant vanishing-point glow independently so a preset can avoid a solid planet-like disc without weakening the full tunnel.

`backgroundEffectFarFade` controls how strongly the funnel side fades at the distant end, avoiding an opaque cap at the vanishing point.

## Report output
- `apps/game-web/build-artifacts/stage-atmosphere-validation-report.json`
