# Sprite Atlas Runtime

Vanguard and Duelist now use package-selected sprite animation sets instead of character-specific rendering branches. The checked-in SVG atlases are temporary technical-art silhouettes, not final character art.

## Runtime contract

- Character package field: `visuals.animationSetId`
- Presentation manifests: `apps/game-web/content/characters/<character>/*.character.presentation.json`
- Schema and discovery: `apps/game-web/src/content/characterPresentationSchema.ts` and `characterPresentationLoader.ts`
- Runtime registry: `apps/game-web/src/content/characterPresentationRegistry.ts`
- Public character assets: `apps/game-web/public/assets/characters/<character>/`
- Playback adapter: `apps/game-web/src/view/sprites/atlasDefinitions.ts`

Each `gw.character-presentation.v1` manifest owns the atlas URL and MIME type, decoded dimensions, cell layout, spacing, world scale, foot anchor, clips, action/phase mapping, portrait, readiness, memory estimate, and VFX profile binding. Vanguard and Duelist currently use 4-by-2 temporary SVG atlases, but that layout and file type are content data rather than renderer constants.

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

No renderer allowlist or TypeScript registry edit is required for a new packaged sprite character. Browser and Node discovery load the same manifest inventory and fail on an empty, divergent, duplicate, invalid, or package-mismatched set.

PNG/WebP is preferred for production. SVG is acceptable for the current placeholders because it keeps the technical silhouettes small and editable.

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
