# Sprite Atlas Runtime

Vanguard and Duelist now use package-selected sprite animation sets instead of character-specific rendering branches. The checked-in SVG atlases are temporary technical-art silhouettes, not final character art.

## Runtime contract

- Character package field: `visuals.animationSetId`
- Registry: `apps/game-web/src/view/sprites/atlasDefinitions.ts`
- Temporary atlases: `apps/game-web/src/view/sprites/*-alpha-atlas.svg`
- Current layout: 4 columns by 2 rows, eight equal cells
- Frame order: idle A, idle B/boost A, boost B, launch, parry/break, special, dunk, helpless/recover
- Required clips: `idle`, `boost`, `launch`, `parry`, `break`, `special`, `dunk`, `helpless`, `recover`

The simulation emits a render-only `presentationAction` and `presentationPhase` for each fighter. Atlas playback therefore follows the complete startup and active windows for launch, dunk, special, parry, and break rather than relying on short impact flashes. Facing, world scale, startup telegraph pulse, additive rim light, and ground shadow are applied by `characterVisual.ts`; those effects do not need to be baked into the sprite.

Stage presets also own `cameraPitchDegrees` and `cameraLookAtYOffset`. This lets visual review compare the default shallow view with the stronger wormhole "arena lip" angle without changing simulation coordinates.

## Replacing a temporary atlas

1. Keep the animation-set id stable unless a package migration is intentional.
2. Export a transparent PNG or WebP atlas with equal-size cells and no padding outside the declared grid.
3. Keep the fighter's feet/center anchor consistent in every frame.
4. Update `textureUrl`, grid dimensions, world dimensions, and clip frames in `atlasDefinitions.ts`.
5. Update the preload entry and byte budget in `defaultManifest.ts`.
6. Run `npm run character:qa`, the web tests, and the production build.
7. Review idle, boost, launch, helpless, dunk, and mirrored facing in motion at gameplay scale.

PNG/WebP is preferred for production. SVG is acceptable for the current placeholders because it keeps the technical silhouettes small and editable.

## Production acceptance

- Silhouette remains distinct at normal camera distance.
- Every action tell begins on the same simulation event as its gameplay state.
- Startup and active poses remain visible for their authored frame-data windows even when an attack misses.
- No frame shifts scale or anchor unexpectedly.
- Transparent edges do not halo against the wormhole.
- Atlas and preload manifest stay within the character asset budget.
- Replacing art does not change simulation checksums or character registry rules.
