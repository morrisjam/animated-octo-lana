# Nebula Well: Blender Stage Study

Status: opt-in visual prototype. The default/online-alpha stage and all character sprites are unchanged.

## Try It

With the local game server running, open `/nebula-workshop.html`. Compare Nebula Well against the previous Gravity Well, vary tilt and distance, and pause the flow. The two colored markers represent fighter scale, not proposed character designs.

To use the model in a match: Home > Settings > Stage Atmosphere > Nebula Well (Blender), then start a Local match. The atmosphere button cycles choices; keyboard/controller Left/Right also works when that row is selected through menu navigation. The choice is saved in the active local profile.

## Direction

- One continuous, gently distorted throat instead of disconnected mechanical ribbons.
- A fixed circular 72-unit mouth matching the simulation arena, with all authored geometry behind the gameplay plane at Z=-2 through Z=-182.
- A bent, narrowing throat, with cool smoky bands and restrained pearl/amber highlights.
- Seamless procedural cloud detail flowing inward. The mesh does not spin or deform, and animation uses simulation time so pause and replay seeking remain consistent.
- Soft entrance fade, no decorative inner rings or solid central black disk. The actual gameplay boundary remains visible.

This is real Blender-authored geometry plus a custom Three.js material, not a photoreal volumetric simulation. It has no baked texture maps and no external asset dependencies. The editable Blender file displays the base inspection material; the final animated look is supplied by `nebulaStageMaterial.ts` in the game. A screenshot of that runtime appearance is `wormhole_nebula_v5.png` beside this document.

## Source And Budget

- Editable source: `art/source/blender/wormhole_nebula_v5.blend`.
- Reproducible builder: `art/source/blender/wormhole_nebula_v5.py`, using shared repository helpers and Blender 5.2.0.
- Runtime: `apps/game-web/public/assets/stages/wormhole/wormhole-nebula-v5.glb`.
- 1 mesh, 1 material, 5,248 vertices, 10,240 triangles, 188,832 bytes. Source metrics and checksum are in `wormhole_nebula_v5.metrics.json`.
- Geometry and material were authored locally for this project. No purchased or downloaded textures/models, paid generation, or hosted compute were used.

From the repository root:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python art/source/blender/wormhole_nebula_v5.py
npm run stage:model-validate --workspace @gravity-well/game-web
npm run stage:nebula-smoke --workspace @gravity-well/game-web
```

The smoke test expects the local server at port 4174. `NEBULA_SMOKE_ORIGIN` can select another loopback origin. The viewer is excluded from normal production entry points; `build:asset-workshop` includes it for an explicit workshop build.

## Verification And Remaining Work

The 1,057-test client suite, type checking, authored-model validation, asset budgets, and online-enabled production build passed. The model and GLB parser load in separate chunks, keeping the initial bundle under existing limits.

The local browser smoke test checks animation/pause, switching stages, tilt views at 0/18/34/60 degrees, and controls at 390x700. It reported no browser errors or external requests. A short 180-interval desktop sample averaged 16.67 ms with a 16.8 ms p95; this is report-only, not a cross-device performance guarantee. Evidence is under `apps/game-web/build-artifacts/nebula-stage-smoke/`.

Visual acceptance, low-end GPU testing, and sustained match play remain to be done. The cloud material is still stylized and surface-based. Character sprites have not been replaced with 3D models: consistent silhouettes, animation, and art direction should be evaluated as a separate two-character pilot, rather than mixing in another placeholder set.
