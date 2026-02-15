# Asset Manifest And Loader Abstraction

Story: `S1.13` Asset manifest and loader abstraction

## Goal

Define one manifest format for visual/audio references and load it through one async preloader with progress and clear error diagnostics.

## Manifest schema

Path: `apps/game-web/src/view/assets/types.ts`

Supported reference groups:

- `models`: `{ id, src, preload? }`
- `sprites`: `{ id, src, preload? }`
- `textures`: `{ id, src, preload? }`
- `audio`: `{ id, src, preload? }`
- `shaders`: `{ id, vertexSrc, fragmentSrc, preload? }`

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

## Runtime wiring

- `apps/game-web/src/main.ts` starts preloading via `preloadAssetManifest(DEFAULT_ASSET_MANIFEST, ...)`.
- failures are logged with `[assets] preload failed` and include error details.

## Test coverage

- `apps/game-web/src/view/assets/loader.test.ts`
  - progress reporting and successful preload
  - invalid manifest diagnostics
  - missing asset HTTP diagnostics
