# Character Visual Profile Abstraction

Story: `S1.14` Character visual profile abstraction (3D, sprite, hybrid)

## Goal

Allow character visual presentation mode to be selected by profile data without simulation changes.

## Profile data

Path: `apps/game-web/src/sim/characters.ts`

- `CharacterVisualProfile` now includes:
  - `presentation`: `3d | sprite | hybrid`
  - presentation/kit-dependent nullable ids (`modelId`, `animationSetId`, `vfxProfileId`, `projectileVisualId`)
  - required `hudPortraitId`

Current assignments:

- `vanguard`: `sprite`
- `duelist`: `sprite`
- `ace`: `hybrid`
- `warden`: `3d`

Sprite packages require an animation set but not a model; 3D packages require a model but not an animation set; hybrid packages require both. A null VFX or projectile slot means shared runtime behavior or no kit-specific asset, not an unresolved placeholder.

## Renderer abstraction

Path: `apps/game-web/src/view/characterVisual.ts`

- One interface (`CharacterVisualAdapter`) for:
  - create node
  - update node
- Implementations:
  - `3d` adapter (mech mesh)
  - `sprite` adapter (billboard sprite)
  - `hybrid` adapter (mech + aura sprite)

## Runtime wiring

- `apps/game-web/src/view/scene.ts` creates initial player visual handles from profile data.
- `apps/game-web/src/view/render.ts` swaps visual handles when character id changes and updates through adapter interface.
- Existing placeholder fighters continue to render through this profile path.

## Test coverage

- `apps/game-web/src/view/characterVisual.test.ts`
  - verifies 3D, sprite, and hybrid adapter creation
  - verifies update/dispose behavior across placeholder characters
