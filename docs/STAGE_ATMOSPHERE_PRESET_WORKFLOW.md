# Stage Atmosphere Preset Workflow (E4.3 / S5.3)

Stage atmospheres are data-authored and applied to arena lighting/fog/background backdrops at runtime.

## Source of truth
- Atmosphere preset definitions: `apps/game-web/content/stages/atmospherePresets.ts`
- Runtime registry and resolver: `apps/game-web/src/view/stageAtmosphere.ts`
- Scene application hooks: `apps/game-web/src/view/scene.ts`
- Validator script: `apps/game-web/scripts/stage-atmosphere-validate.ts`
- Authored Blender source: `art/source/blender/wormhole_arena_lip_v1.py`
- Static GLB runtime: `apps/game-web/src/view/assets/staticGlbRuntime.ts`
- Stage-model validator: `apps/game-web/scripts/stage-model-validate.ts`

## Commands
Run from repo root:

```bash
npm run stage:validate
npm run stage:model-validate
```

Workspace direct:

```bash
npm run stage:validate -w @gravity-well/game-web
npm run stage:model-validate -w @gravity-well/game-web
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

Authored stage models use embedded GLB 2.0 files. The runtime intentionally supports only static triangle geometry, positions, optional normals, embedded indices, PBR colour/emission, and node transforms. External buffers, textures, animation, skins, sparse accessors, morph targets, cameras, and non-triangle primitives fail closed. Legacy non-wormhole stage placeholders remain isolated from the authored-model path.

## Wormhole Authored V4

`wormhole_authored_v4` is the current online-alpha presentation candidate. It combines the shader-driven shaft with a Blender-authored foreground near lip instead of drawing a complete circular prop around the arena.

- Source is pinned to Blender `2.92.0` and regenerated headlessly from `art/source/blender/wormhole_arena_lip_v1.py`.
- V1, V2, and V3 remain selectable rollback references.
- Runtime model id: `wormhole_arena_lip_v1`.
- Runtime output: `apps/game-web/public/assets/stages/wormhole/wormhole-arena-lip-v1.glb`.
- Current output: `52,088` bytes, `1,528` runtime vertices, `1,752` triangles, six meshes, and two materials.
- `stage:model-validate` checks the GLB structure, embedded-resource policy, source metrics, SHA-256, and manifest ceilings.
- `gw.visual-alpha-smoke.v11` requires the V4 preset and model to be selected, parsed, and visible at every production navigation checkpoint.

The model remains `prototype` readiness until direct human play confirms fighter silhouettes, boundary readability, and launch zoom behaviour on target alpha hardware.

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
- `apps/game-web/build-artifacts/stage-model-validation-report.json`
