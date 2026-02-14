# Repository Structure Rules

This document defines where code goes. Use it as the default for new work.

## Top-level split

- `apps/game-web`: game client and gameplay simulation.
- `apps/api`: server-side API and database migrations.
- `docs`: product and engineering documentation.

## Game code rules

All gameplay and rendering work belongs in `apps/game-web`.

- Simulation rules only: `apps/game-web/src/sim`
- Rendering and HUD only: `apps/game-web/src/view`
- Input mapping only: `apps/game-web/src/input`
- Platform integration only: `apps/game-web/src/platform`

Do not add API handlers, DB access, or server auth logic under `apps/game-web/src`.

## Server code rules

All backend and persistence work belongs in `apps/api`.

- HTTP server: `apps/api/src`
- DB access and queries: `apps/api/src`
- Migrations: `apps/api/migrations`
- Migration runner scripts: `apps/api/scripts`

Do not place Three.js, DOM code, or client rendering logic under `apps/api`.

## Shared code policy

If both apps need shared types or utilities, create a workspace package under `packages/*` and import it from both apps.

Until a shared package exists, avoid copying logic between apps. Raise a task to extract shared code first.

## Command policy

Run from repo root by default:

- `npm run dev` for web client.
- `npm run api:dev` for API.
- `npm run verify` for game verification.

Use workspace commands when needed:

- `npm run <script> -w @gravity-well/game-web`
- `npm run <script> -w @gravity-well/api`

## Documentation policy

When adding new systems:

1. Update `README.md` if root commands or layout change.
2. Update the app-local README (`apps/game-web/README.md` or `apps/api/README.md`).
3. Add or update a focused design doc in `docs/`.
