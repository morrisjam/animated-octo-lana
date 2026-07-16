# Blender Stage Sources

The Blender stage source is deterministic and pinned to Blender `2.92.0` until an explicit source migration is reviewed.

Generate the source scene, runtime GLB, review still, and metrics from the repository root:

```powershell
& "C:\Program Files\Blender Foundation\Blender 2.92\blender.exe" --background --python art/source/blender/wormhole_arena_lip_v1.py
```

The script writes:

- `art/source/blender/wormhole_arena_lip_v1.blend`
- `apps/game-web/public/assets/stages/wormhole/wormhole-arena-lip-v1.glb`
- `art/review/wormhole_arena_lip_v1.png`
- `art/review/wormhole_arena_lip_v1.metrics.json`

The checked-in Python source is authoritative. The `.blend` is retained for visual inspection and manual exploration, while the GLB is the only Blender output loaded by the game.
