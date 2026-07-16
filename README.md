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
npm run typecheck
npm run test
npm run verify
npm run character:new -- --id striker --display-name "Striker"
npm run character:qa
npm run balance:validate
npm run theme:validate
npm run theme:contrast-check
npm run stage:validate
npm run balance:patch-notes
npm run matchup:smoke
npm run alpha:visual-smoke
npm run alpha:local-gate
npm run alpha:local-integration
npm run alpha:local-turn-integration
npm run webrtc:browser-soak -- --duration-seconds 1800
```

`alpha:local-gate` runs compile, signing-key rotation and proxy-source security smokes, migration-compatibility, API/web unit, replay, production build, an enforced production-bundle budget, a real-browser production-root visual/replay/pause smoke, rollback soak, and flow-first AI gates entirely on the local machine. It does not start Docker, call the application API, or connect to Neon. The visual step starts an ephemeral loopback preview, blocks external requests, and requires local Chrome, Edge, or Chromium.

`alpha:local-integration` is the guarded localhost proof for transport and persistence changes. `alpha:local-turn-integration` adds an ephemeral coturn container, issues short-lived account-scoped credentials, and requires every initial, recovered, or isolated two-client browser path to use TURN relay. Both commands build the production client, start or reuse local Docker PostgreSQL, apply migrations, run rollback-only ranked season transition, ranked settlement, archived Master-region immutability, authoritative forfeit, WebRTC rollback/reconnect, two-client lifecycle/script-stall recovery, a one-second isolated-client real-time soak, API process replacement, and concurrent-instance smokes. They retain profile-specific summaries as `apps/api/build-artifacts/local-alpha-integration/report-direct.json` and `report-relay.json`; `report.json` remains the latest-run compatibility copy. They reject non-loopback database targets, contact no hosted application service, and clean up only resources they started. Docker and Chrome, Edge, or Chromium are required. Set `LOCAL_ALPHA_SKIP_BUILD=1` only to reuse an attested `local-ranked-root-smoke` bundle built for the same local API URL; ordinary production bundles fail before database setup.

`webrtc:browser-soak` is the retained release-duration transport rehearsal. With local API, PostgreSQL, and web preview already running, it keeps two storage-isolated browser clients exchanging production DataChannel batches for 30 real-time minutes, deliberately applies remote input in late windows, and fails on disconnects, protocol/ACK errors, excessive rollback depth, incomplete confirmation, or checksum divergence. It is not run for 30 minutes on every commit; CI and the local integration commands exercise the same path with a one-second profile.

Steam packaging flow:

```bash
npm run steam:ci
```

`steam:ci` builds and validates the native Windows shell that owns the Steamworks ticket bridge. The older static web-only artifact remains available as `npm run steam:web-artifact:ci` for non-shipping inspection; it cannot perform production Steam sign-in and must not be uploaded as the game client.

API and database:

```bash
npm run db:up
npm run api:migrate
npm run typecheck
npm run api:test
npm run api:dev
```

Or all API local setup at once:

```bash
npm run api:local
```

`api:local` starts Docker services, migrates `LOCAL_DATABASE_URL` (defaulting to loopback PostgreSQL), and runs the API with that same URL. It deliberately ignores a hosted `DATABASE_URL`, so a local smoke or gameplay session cannot silently consume Neon compute. Ranked and WebRTC smoke commands also refuse an API reporting a remote or unknown database target; use `ALLOW_REMOTE_DATABASE_SMOKE=1` only for an intentional isolated staging rehearsal.

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
- Production workspace and current execution plan: `production/README.md`
- Full game production plan: `production/FULL_GAME_PRODUCTION_PLAN.md`
- Current milestone: `production/CURRENT_MILESTONE.md`
- Current sprint: `production/CURRENT_SPRINT.md`
- Game architecture and kits: `docs/CHARACTER_KITS.md`
- Character package schema and validation flow: `docs/CHARACTER_PACKAGE_SCHEMA.md`
- Character package user guide: `docs/CHARACTER_PACKAGE_USER_GUIDE.md`
- Balance profile workflow: `docs/BALANCE_PROFILE_WORKFLOW.md`
- Menu theme workflow: `docs/MENU_THEME_WORKFLOW.md`
- Stage atmosphere preset workflow: `docs/STAGE_ATMOSPHERE_PRESET_WORKFLOW.md`
- Balance patch notes workflow: `docs/BALANCE_PATCH_NOTES_WORKFLOW.md`
- Training telemetry workflow: `docs/TRAINING_TELEMETRY_WORKFLOW.md`
- Balance telemetry and AI regression gate: `docs/BALANCE_TELEMETRY.md`
- Interactive local Balance Lab: `docs/BALANCE_LAB.md`
- Package-driven sprite atlas runtime: `docs/SPRITE_ATLAS_RUNTIME.md`
- Controlled online alpha exit gates: `docs/ONLINE_ALPHA_READINESS.md`
- Deterministic local rollback/network gate: `docs/ROLLBACK_NETWORK_SOAK.md`
- WebRTC signaling, DataChannel protocol, and local browser smoke: `docs/WEBRTC_TRANSPORT.md`
- Matchup regression smoke workflow: `docs/MATCHUP_REGRESSION_SMOKE_WORKFLOW.md`
- Move frame-data registry: `docs/MOVE_FRAME_DATA_REGISTRY.md`
- Training frame-data overlay: `docs/FRAME_DATA_VISUALIZER_OVERLAY.md`
- Asset manifest loader: `docs/ASSET_MANIFEST_LOADER.md`
- Asset production and AI-assisted workflow: `docs/ASSET_PIPELINE.md`
- Character visual profile abstraction: `docs/CHARACTER_VISUAL_PROFILE_ABSTRACTION.md`
- VFX event binding and presets: `docs/VFX_EVENT_BINDING_PRESETS.md`
- Asset budget validation: `docs/ASSET_BUDGET_VALIDATION.md`
- Audio event bus and routing: `docs/AUDIO_EVENT_BUS_ROUTING.md`
- Adaptive music state system: `docs/ADAPTIVE_MUSIC_STATE_SYSTEM.md`
- Voice line and callout system: `docs/VOICE_LINE_CALLOUT_SYSTEM.md`
- Audio mix, loudness, and accessibility controls: `docs/AUDIO_MIX_LOUDNESS_ACCESSIBILITY.md`
- AI behaviour framework: `docs/AI_BEHAVIOUR_FRAMEWORK.md`
- AI difficulty profiles: `docs/AI_DIFFICULTY_PROFILES.md`
- Arcade mode flow: `docs/ARCADE_MODE_FLOW.md`
- Arcade run history and best records: `docs/ARCADE_RUN_HISTORY.md`
- E4 content production epic map: `docs/NEXT_EPIC_E4_CONTENT_PRODUCTION_PLAN.md`
- E4.1 character package first-priority plan: `docs/NEXT_EPIC_E41_CHARACTER_PACKAGE_PLAN.md`
- E4.2 balance and mechanics operations plan: `docs/NEXT_EPIC_E42_BALANCE_MECHANICS_PLAN.md`
- E4.3 visual content and menu theming plan: `docs/NEXT_EPIC_E43_VISUAL_MENU_THEMING_PLAN.md`
- API usage: `apps/api/README.md`
- Neon setup checklist: `docs/NEON_SETUP_ACTION.md`
- Deployment runbook (services, DNS, envs): `docs/DEPLOYMENT_RUNBOOK.md`
- Steam packaging and CI artifact policy: `docs/STEAM_BUILD_PROFILE.md`
- AI tooling and Codex-native studio workflows: `docs/AI_STUDIO_TOOLING_AND_WORKFLOWS.md`
