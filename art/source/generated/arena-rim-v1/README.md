# Gravity Well Arena Rim V1

This is a local-first pilot of the `img2threejs` Codex skill on a static
structure intended to surround the wormhole arena.

## Status

- Form pass: accepted.
- Production budget: accepted at 10,428 triangles, 4 materials, and 4 render calls.
- Live game integration: intentionally deferred.
- Final art approval: not granted. Panel density, wear, and richer material
  response remain surface-art work.

The generated model is suitable as an editable stage-structure prototype. It
must be reviewed in the actual stage composition before it replaces or augments
the current arena boundary.

## Source Of Truth

- `arena-rim-concept-v1.png`: generated isolated concept reference.
- `build-spec.mjs`: reproducible authored specification.
- `object-sculpt-spec.json`: generated validated sculpt specification and review history.
- `reviews/`: pass-specific feature scoring.
- `apps/game-web/src/assetWorkshop/generated/createGravityWellArenaRimV1Model.ts`:
  generated Three.js factory.
- `apps/game-web/src/assetWorkshop/createOptimizedArenaRim.ts`: game-side
  adapter that merges the static model to one mesh per visible material.

Do not manually edit the generated factory. Change `build-spec.mjs`, regenerate
the spec, validate it, and regenerate the factory.

## Local Review

With the game web development server running, open:

`http://127.0.0.1:4174/arena-rim-workshop.html`

The workshop provides reference, front, and orbit views; studio, neutral, and
grazing lights; wireframe inspection; live geometry metrics; and frame export.

## Rebuild

From the repository root:

```powershell
node art/source/generated/arena-rim-v1/build-spec.mjs
python $HOME/.codex/skills/img2threejs/forge/stage2_spec/validate_sculpt_spec.py art/source/generated/arena-rim-v1/object-sculpt-spec.json --strict-quality --json
python $HOME/.codex/skills/img2threejs/forge/stage3_build/generate_threejs_factory.py art/source/generated/arena-rim-v1/object-sculpt-spec.json --pass-id form-refinement --out apps/game-web/src/assetWorkshop/generated/createGravityWellArenaRimV1Model.ts --force
```

## Promotion Gate

Before connecting this prop to gameplay:

1. Place it around the real wormhole with the intended arena tilt and camera.
2. Verify fighters, action VFX, and arena bounds remain readable at match zoom.
3. Complete or replace the material/surface pass.
4. Keep the optimized four-call adapter or export a budget-equivalent static GLB.
5. Re-run visual smoke tests and the normal production build.
