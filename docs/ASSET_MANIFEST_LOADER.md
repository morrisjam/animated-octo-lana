# Asset Manifest And Loader Abstraction

Story: `S1.13` Asset manifest and loader abstraction

## Goal

Define one manifest format for visual/audio references and load it through one async preloader with progress and clear error diagnostics.

## Manifest schema

Path: `apps/game-web/src/view/assets/types.ts`

Supported reference groups:

- `models`: `{ id, src, preload?, contentTypes?, image? }`
- `sprites`: `{ id, src, preload?, contentTypes?, image? }`
- `textures`: `{ id, src, preload?, contentTypes?, image? }`
- `audio`: `{ id, src, preload?, contentTypes? }`
- `shaders`: `{ id, vertexSrc, fragmentSrc, preload? }`

`contentTypes` is an allowlist of normalized HTTP MIME types. `image` declares the expected decoded width and height. Character presentation manifests generate their sprite and portrait entries dynamically, so asset identity, validation, and runtime playback use one content source.

Default placeholder manifest:

- `apps/game-web/src/view/assets/defaultManifest.ts`

## Loader API

Path: `apps/game-web/src/view/assets/loader.ts`

Entry point:

- `preloadAssetManifest(manifest, options?)`

Capabilities:

- async preloading across all manifest groups
- progress callback (`onProgress`) with `loaded`, `total`, `kind`, and `id`
- explicit validation errors for missing ids/sources and duplicate ids
- explicit load errors including asset kind/id/source and HTTP status
- optional MIME allowlist enforcement with case and response parameters normalized
- decoded image-dimension enforcement for declared image assets

## Runtime wiring

- `apps/game-web/src/main.ts` starts preloading via `preloadAssetManifest(DEFAULT_ASSET_MANIFEST, ...)`.
- Local and Online entry remain disabled until required assets pass preload validation and the platform entitlement gate allows access.
- Failures are shown as a refresh-to-retry gameplay gate and logged with `[assets] preload failed` plus technical details.

## Test coverage

- `apps/game-web/src/view/assets/loader.test.ts`
  - progress reporting and successful preload
  - invalid manifest diagnostics
  - missing asset HTTP diagnostics
  - MIME and decoded-dimension mismatch diagnostics
- `apps/game-web/src/content/characterPresentationSchema.test.ts`
- `apps/game-web/src/content/characterPresentationLoader.test.ts`
  - required state and atlas-bound validation
  - package coverage and id-binding validation
  - content-only manifest discovery and generated preload entries
