# Stage Atmosphere Preset Workflow (E4.3 / S5.3)

Stage atmospheres are data-authored and applied to arena lighting/fog/background backdrops at runtime.

## Source of truth
- Atmosphere preset definitions: `apps/game-web/content/stages/atmospherePresets.ts`
- Runtime registry and resolver: `apps/game-web/src/view/stageAtmosphere.ts`
- Scene application hooks: `apps/game-web/src/view/scene.ts`
- Validator script: `apps/game-web/scripts/stage-atmosphere-validate.ts`
- Authored Blender sources: `art/source/blender/wormhole_arena_lip_v1.py`, `art/source/blender/wormhole_arena_depth_v2.py`, `art/source/blender/wormhole_arena_funnel_v3.py`, and `art/source/blender/wormhole_arena_rift_v4.py`
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
npm run smoke:visual-alpha -w @gravity-well/game-web
```

The visual smoke defaults to the online-alpha V5 preset. To validate another registered authored-model preset without changing that default, build first and set the stage override for the smoke process. The model id is derived from the preset and unknown or model-less stages fail closed. Override runs write to a stage-specific artifact directory instead of replacing the default report.

```powershell
$env:VISUAL_ALPHA_SMOKE_STAGE_ID = "wormhole_rift_v7_candidate"
npm run smoke:visual-alpha -w @gravity-well/game-web
Remove-Item Env:VISUAL_ALPHA_SMOKE_STAGE_ID
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
- `cameraPitchDegrees`: base shallow camera pitch, clamped to `34` degrees. The online-alpha V5 preset remains at `28`; only the opt-in funnel candidate currently uses the higher review bound.
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

## Wormhole Authored V5

`wormhole_authored_v5` is the current online-alpha presentation candidate. It combines the shader-driven moving shaft with a Blender-authored broken foreground lip, five discontinuous depth bands, and four static helical rails, so the well retains slow motion without reading as a single flat rotating prop.

- Source is pinned to Blender `2.92.0` and regenerated headlessly from `art/source/blender/wormhole_arena_depth_v2.py`.
- Wormhole Authored V4 and V1-V3 remain selectable rollback references.
- Runtime model id: `wormhole_arena_depth_v2`.
- Runtime output: `apps/game-web/public/assets/stages/wormhole/wormhole-arena-depth-v2.glb`.
- Current output: `106,412` bytes, `3,140` runtime vertices, `6,140` triangles, 11 meshes, and four materials.
- `stage:model-validate` runs the exact constrained production parser, then checks the GLB structure, embedded-resource policy, source metrics, SHA-256, and manifest ceilings.
- `gw.visual-alpha-smoke.v11` requires the V5 preset and model to be selected, parsed, and visible at every production navigation checkpoint.

The model remains `prototype` readiness. A local 1280x720 AI-vs-AI review confirmed that V4 and V5 both load, V5 remains visibly active with HUD overlays removed, and fighter silhouettes and the arena boundary remain readable. The current complete V5 visual smoke loaded `450,682` bytes of staged assets, selected the V2 model at all three checkpoints, held `60.000` average FPS with `16.8ms` p95 and `16.9ms` maximum frame time, and reported no page errors, failed local requests, or external traffic. Direct human play, launch-zoom review, and target-alpha-hardware approval are still required.

## Wormhole Funnel V6 Candidate

`wormhole_funnel_v6_candidate` is an opt-in visual experiment; `wormhole_authored_v5` remains the online-alpha default. Its Blender `5.2.0 LTS` source builds a cap-free, foreshortened funnel from sparse translucent wall panels, two tapered spiral seams, broken depth marks, wall shards, and a dark sloped near shelf with a thin discontinuous highlight. The throat drifts slightly off-centre with depth so it does not resolve into a stack of perfect circles. V1, V2, and the V5 preset remain unchanged rollback paths.

- Runtime model id: `wormhole_arena_funnel_v3`.
- Runtime output: `apps/game-web/public/assets/stages/wormhole/wormhole-arena-funnel-v3.glb`.
- Current output: `42,520` bytes, `1,206` runtime vertices, `1,080` triangles, six meshes, and six materials.
- The candidate uses the render-only `34` degree review bound while V5 remains at `28`; simulation coordinates, collision, rollback state, and replay inputs are unchanged.
- A local 1280x720 AI-vs-AI check selected the candidate through Settings and confirmed that the exact V3 model was parsed and visible. The final interactive check reported no browser warnings or errors, and the full local production build, exact runtime parser, atmosphere validator, and asset budget all passed.
- The candidate-specific `gw.visual-alpha-smoke.v11` retained the candidate and exact V3 model at all three lifecycle checkpoints, exercised every deterministic action frame including launch, dunk, boost, and both specials, held `60.000` average FPS with `16.7ms` p95 and `16.8ms` maximum frame time, and reported no page errors, failed local requests, external traffic, or hosted-service contact.
- Promotion still requires direct human play/readability review and target-alpha-hardware approval.

## Wormhole Rift V7 Candidate

`wormhole_rift_v7_candidate` is a second opt-in Blender `5.2.0 LTS` experiment. It preserves V5 and V6, removes V6's authored depth bands, and delegates circular twist to the realtime shaft. The static model contributes four broken longitudinal ribs, narrow emissive rib edges, a three-part asymmetric near shelf, and sparse flow shards. Its calmer `24` degree camera is intended to keep both fighters in a readable zone while the aperture still reads as a pit.

- Runtime model id: `wormhole_arena_rift_v4`.
- Runtime output: `apps/game-web/public/assets/stages/wormhole/wormhole-arena-rift-v4.glb`.
- Current output: `43,628` bytes, `1,284` runtime vertices, `1,160` triangles, five meshes, and five materials.
- Two complete headless generations produced byte-identical GLB and metrics files plus identical decoded review PNG pixels. Blender rewrote PNG container metadata, which is not loaded by the game.
- The constrained production parser, generated SHA-256, source metrics, MIME policy, manifest ceilings, focused atmosphere tests, full game production build, asset budget, and bundle budget pass locally.
- Candidate-specific `gw.visual-alpha-smoke.v11` loaded all four authored stage models and both character atlases, retained V7 and the exact V4 model at all three lifecycle checkpoints, exercised launch, dunk, boost, Super Boost, parry, and both specials, and held `60.000` average FPS with `16.8ms` p95/max and zero intervals over `20ms`. It recorded no page errors, failed same-origin requests, external traffic, or hosted-service contact.
- The candidate remains `prototype` and does not change the online-alpha default. Direct human play, launch framing, and target-alpha-hardware approval remain mandatory before promotion.

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
