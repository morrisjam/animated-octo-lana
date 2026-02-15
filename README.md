# Gravity Well Monorepo

This repository is now split into workspace apps so game and server code stay isolated.

## Repository layout

- `apps/game-web`: browser game client (Vite + Three.js).
- `apps/api`: backend API (Fastify + PostgreSQL).
- `docs`: architecture, backlog, and operating docs.
- `docker-compose.yml`: local PostgreSQL service for API development.

## Root commands

Run these from repo root:

```bash
npm install
npm run dev
npm run build
npm run preview
npm run test
npm run verify
```

Steam packaging flow:

```bash
npm run steam:ci
```

API and database:

```bash
npm run db:up
npm run api:migrate
npm run api:test
npm run api:dev
```

Or all API local setup at once:

```bash
npm run api:local
```

## Workspace direct commands

```bash
npm run dev -w @gravity-well/game-web
npm run verify -w @gravity-well/game-web
npm run dev -w @gravity-well/api
npm run migrate -w @gravity-well/api
```

## Environment files

- Create root `.env` from `.env.example` before running API scripts.
- Root `.env` is used for API database configuration.
- Root `.env.development`, `.env.staging`, and `.env.production` are used by the web app via Vite `envDir`.
- Root `.env.steam` defines the Steam build profile defaults.

## Project docs

- Structure guardrails: `docs/REPO_STRUCTURE.md`
- Game architecture and kits: `docs/CHARACTER_KITS.md`
- Move frame-data registry: `docs/MOVE_FRAME_DATA_REGISTRY.md`
- Training frame-data overlay: `docs/FRAME_DATA_VISUALIZER_OVERLAY.md`
- Asset manifest loader: `docs/ASSET_MANIFEST_LOADER.md`
- Character visual profile abstraction: `docs/CHARACTER_VISUAL_PROFILE_ABSTRACTION.md`
- VFX event binding and presets: `docs/VFX_EVENT_BINDING_PRESETS.md`
- Asset budget validation: `docs/ASSET_BUDGET_VALIDATION.md`
- Audio event bus and routing: `docs/AUDIO_EVENT_BUS_ROUTING.md`
- Adaptive music state system: `docs/ADAPTIVE_MUSIC_STATE_SYSTEM.md`
- Voice line and callout system: `docs/VOICE_LINE_CALLOUT_SYSTEM.md`
- Audio mix, loudness, and accessibility controls: `docs/AUDIO_MIX_LOUDNESS_ACCESSIBILITY.md`
- API usage: `apps/api/README.md`
- Neon setup checklist: `docs/NEON_SETUP_ACTION.md`
- Deployment runbook (services, DNS, envs): `docs/DEPLOYMENT_RUNBOOK.md`
- Steam packaging and CI artifact policy: `docs/STEAM_BUILD_PROFILE.md`
