# Blender Sources

## Stage sources

The V1 and V2 stage sources remain deterministic and pinned to Blender `2.92.0`. The separate V3 funnel candidate is pinned to Blender `5.2.0 LTS`; it does not migrate or overwrite either rollback source.

Generate either source scene, runtime GLB, review still, and metrics from the repository root:

```powershell
& "C:\Program Files\Blender Foundation\Blender 2.92\blender.exe" --background --python art/source/blender/wormhole_arena_lip_v1.py
& "C:\Program Files\Blender Foundation\Blender 2.92\blender.exe" --background --python art/source/blender/wormhole_arena_depth_v2.py
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python art/source/blender/wormhole_arena_funnel_v3.py
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python art/source/blender/wormhole_arena_rift_v4.py
```

The V1 source writes:

- `art/source/blender/wormhole_arena_lip_v1.blend`
- `apps/game-web/public/assets/stages/wormhole/wormhole-arena-lip-v1.glb`
- `art/review/wormhole_arena_lip_v1.png`
- `art/review/wormhole_arena_lip_v1.metrics.json`

The V2 depth source writes:

- `art/source/blender/wormhole_arena_depth_v2.blend`
- `apps/game-web/public/assets/stages/wormhole/wormhole-arena-depth-v2.glb`
- `art/review/wormhole_arena_depth_v2.png`
- `art/review/wormhole_arena_depth_v2.metrics.json`

The V3 funnel source writes:

- `art/source/blender/wormhole_arena_funnel_v3.blend`
- `apps/game-web/public/assets/stages/wormhole/wormhole-arena-funnel-v3.glb`
- `art/review/wormhole_arena_funnel_v3.png`
- `art/review/wormhole_arena_funnel_v3.metrics.json`

The V4 rift source writes:

- `art/source/blender/wormhole_arena_rift_v4.blend`
- `apps/game-web/public/assets/stages/wormhole/wormhole-arena-rift-v4.glb`
- `art/review/wormhole_arena_rift_v4.png`
- `art/review/wormhole_arena_rift_v4.metrics.json`

The checked-in Python sources are authoritative. The `.blend` files are retained for visual inspection and manual exploration, while the GLBs are the only Blender outputs loaded by the game. V2 imports the pinned V1 geometry helpers without modifying V1 output, so both presets remain independently reproducible. V3 is an isolated, low-poly open funnel with no centre cap. V4 preserves that rollback candidate and replaces its depth bands with converging longitudinal ribs, a three-part asymmetric combat shelf, and sparse flow shards. Both remain selectable prototypes until direct play and target-hardware review approve one.

## Character sprite sources

The Vanguard and Duelist sprite candidates use a separate Blender `5.2.0 LTS` lane. Each turns one controllable proxy into the existing eight-frame `4 x 2` runtime contract instead of asking an image model to redraw each pose independently. Vanguard uses deterministic Eevee supersampling; Duelist uses deterministic Workbench studio rendering because its thin diagonal lance exposed Eevee edge jitter on repeated headless runs.

Generate the source scene, transparent review frames, exact-size PNG candidates, and metrics from the repository root:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python art/source/blender/vanguard_sprite_v1.py
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python art/source/blender/duelist_sprite_v1.py
npm run character:sprite-source-validate
```

The final command is the CI-safe verification path. It does not launch Blender; it checks the recorded source and helper hashes, concept provenance, review frames, runtime PNG hashes and dimensions, presentation links, and byte budgets.

The source writes:

- `art/source/blender/vanguard_sprite_v1.blend`
- `art/review/vanguard_sprite_v1_frames/*.png`
- `art/review/vanguard_sprite_v1_atlas.png`
- `art/review/vanguard_sprite_v1_portrait.png`
- `art/review/vanguard_sprite_v1.metrics.json`
- `apps/game-web/public/assets/characters/vanguard/vanguard-alpha-atlas-v2.png`
- `apps/game-web/public/assets/characters/vanguard/vanguard-alpha-portrait-v2.png`

The generated concept image is a visual reference, not runtime content. The Python source remains the authoritative model, pose, camera, palette, and export definition. The original Vanguard SVGs remain available for content-only rollback.

The Duelist source writes the corresponding files under `duelist_sprite_v1*` and `apps/game-web/public/assets/characters/duelist/duelist-alpha-*-v2.png`. It imports the checked-in deterministic render/export helpers from the Vanguard source but owns separate geometry, materials, posing, camera framing, and metrics. The original Duelist SVGs remain available for content-only rollback.
