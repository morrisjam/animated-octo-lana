# Sprite Atlas Runtime

Vanguard and Duelist use package-selected sprite animation sets instead of character-specific rendering branches. The checked-in atlases are temporary technical-art silhouettes, not final character art.

## Runtime contract

- Character package field: `visuals.animationSetId`
- Presentation manifests: `apps/game-web/content/characters/<character>/*.character.presentation.json`
- Schema and discovery: `apps/game-web/src/content/characterPresentationSchema.ts` and `characterPresentationLoader.ts`
- Runtime registry: `apps/game-web/src/content/characterPresentationRegistry.ts`
- Public character assets: `apps/game-web/public/assets/characters/<character>/`
- Playback adapter: `apps/game-web/src/view/sprites/atlasDefinitions.ts`
- Local artist preview: `http://127.0.0.1:<vite-port>/asset-workshop.html`

Each `gw.character-presentation.v1` manifest owns the atlas URL and MIME type, decoded dimensions, cell layout, spacing, world scale, foot anchor, clips, action/phase mapping, portrait, readiness, memory estimate, and VFX profile binding. Vanguard and Duelist currently use 4-by-2 temporary PNG atlases, but that layout and file type are content data rather than renderer constants.

The v1 contract has a backward-compatible multi-sheet extension. `animationSet.atlas` remains the required default sheet, so all existing manifests remain valid without edits. An animation set may add `animationSet.additionalSheets`, and any clip may select one by asset id with `sheetId`. A clip that omits `sheetId` uses the default `atlas.id`.

```json
{
  "animationSet": {
    "id": "character_example_animset",
    "atlas": {
      "id": "character_example_movement_sheet",
      "src": "/assets/characters/example/movement.png?v=1",
      "contentType": "image/png",
      "widthPixels": 1024,
      "heightPixels": 512,
      "readiness": "alpha",
      "budget": {
        "estimatedBytes": 500000,
        "estimatedTextureBytes": 2097152
      },
      "columns": 4,
      "rows": 2,
      "frameWidthPixels": 256,
      "frameHeightPixels": 256,
      "marginPixels": 0,
      "spacingPixels": 0,
      "worldWidth": 7.4,
      "worldHeight": 7.4,
      "anchorX": 0.5,
      "anchorY": 0.1
    },
    "additionalSheets": [
      {
        "id": "character_example_combat_sheet",
        "src": "/assets/characters/example/combat.webp?v=1",
        "contentType": "image/webp",
        "widthPixels": 1536,
        "heightPixels": 512,
        "readiness": "alpha",
        "budget": {
          "estimatedBytes": 650000,
          "estimatedTextureBytes": 3145728
        },
        "columns": 6,
        "rows": 2,
        "frameWidthPixels": 256,
        "frameHeightPixels": 256,
        "marginPixels": 0,
        "spacingPixels": 0,
        "worldWidth": 7.8,
        "worldHeight": 7.8,
        "anchorX": 0.5,
        "anchorY": 0.1
      }
    ],
    "clips": {
      "idle": { "frames": [0, 1, 2, 3], "fps": 8, "loop": true },
      "launch_active": {
        "sheetId": "character_example_combat_sheet",
        "frames": [0, 1, 2, 3, 4],
        "fps": 12,
        "loop": false
      }
    }
  }
}
```

Frame numbers are local to the selected sheet. A single clip cannot cross between sheets; split that motion into separate clips if the source layout requires it. Sheet ids must be unique across packaged character assets. Each sheet may define its own grid, cell size, world size, and anchor, and the renderer switches those values together when the clip changes.

Required presentation states are `idle.none`, `boost.sustain`, launch startup/active, parry active, break active, special startup/active, dunk startup/active, `helpless.sustain`, and `recover.recovery`. A clip can be shared by several states, but every state must bind to a declared, in-bounds clip.

The simulation emits a render-only `presentationAction` and `presentationPhase` for each fighter. Atlas playback therefore follows the complete startup and active windows for launch, dunk, special, parry, and break rather than relying on short impact flashes. Facing, world scale, startup telegraph pulse, additive rim light, and ground shadow are applied by `characterVisual.ts`; those effects do not need to be baked into the sprite.

Stage presets also own `cameraPitchDegrees` and `cameraLookAtYOffset`. This lets visual review compare the default shallow view with the stronger wormhole "arena lip" angle without changing simulation coordinates.

## Replacing a temporary atlas

1. Keep the animation-set id stable unless a package migration is intentional.
2. Export a transparent PNG or WebP atlas. Cells may use declared margins and spacing, but must stay inside the declared decoded image dimensions.
3. Keep the fighter's feet/center anchor consistent in every frame.
4. Put the file under the character's public asset directory and update only that character's presentation JSON: URL, MIME type, dimensions, grid, anchor, world size, clips, readiness, and budget.
5. Keep the presentation ids aligned with the character package's `animationSetId`, `hudPortraitId`, and `vfxProfileId`.
6. Run `npm run character:qa`, `npm run asset:budget-check`, the web tests, and the production build.
7. Review idle, boost, launch, helpless, dunk, and mirrored facing in motion at gameplay scale.

For a large character, group related motion into a small number of sheets rather than one file per clip. A practical split is `movement`, `combat`, and `outcomes`. Keeping every cell on a sheet the same size makes export and review predictable, while independent sheet anchors allow unusual victory or helpless silhouettes without forcing oversized movement cells.

No renderer allowlist or TypeScript registry edit is required for a new packaged sprite character. Browser and Node discovery load the same manifest inventory and fail on an empty, divergent, duplicate, invalid, or package-mismatched set.

PNG/WebP is preferred for production. SVG is acceptable for the current placeholders because it keeps the technical silhouettes small and editable.

## Asset Workshop

Run the game-web Vite development server and open `/asset-workshop.html`. The Workshop discovers the same packaged presentation manifests as the game; there is no separate artist allowlist.

It provides:

- packaged character and clip selection
- playback at each clip's authored FPS and loop mode
- play, pause, previous-frame, and next-frame controls
- Space and Left/Right keyboard shortcuts
- current sequence frame and source-sheet cell number
- sheet URL, dimensions, grid, spacing, world size, and manifest source
- an anchor crosshair, with Y measured from the bottom of the sprite cell

Use the Workshop for source timing and alignment review. Final acceptance still requires an in-game pass because camera scale, action VFX, facing, stage contrast, and gameplay timing are intentionally absent from this isolated tool.

## Production acceptance

- Silhouette remains distinct at normal camera distance.
- Every action tell begins on the same simulation event as its gameplay state.
- Startup and active poses remain visible for their authored frame-data windows even when an attack misses.
- No frame shifts scale or anchor unexpectedly.
- Transparent edges do not halo against the wormhole.
- HTTP MIME type and decoded dimensions match the presentation manifest.
- Atlas and portrait texture memory both stay within the asset budget.
- Required assets finish preloading before Local or Online entry becomes available.
- Replacing art does not change simulation checksums or character registry rules.
