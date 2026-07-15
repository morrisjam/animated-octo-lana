# Gravity Well Web Client

## Run

From repo root:

```bash
npm run dev
```

Or directly from this workspace:

```bash
npm run dev -w @gravity-well/game-web
```

Generated `build-artifacts/` and `steam-artifact/` trees are excluded from Vite file watching. They can contain gigabytes of deterministic replay evidence and do not participate in HMR; the local flow-review endpoint reads requested reports directly from disk. Restart an older dev-server process after changing this configuration so the exclusion takes effect.

## Build and preview

```bash
npm run build
npm run bundle:budget
npm run preview
```

## Steam profile build and package

From repo root:

```bash
npm run steam:build
npm run steam:package
npm run steam:smoke
```

From this workspace:

```bash
npm run build:steam
npm run package:steam
npm run smoke:steam
```

Notes:
- `build:steam` uses root `.env.steam` profile values via Vite mode `steam`.
- `package:steam` outputs `apps/game-web/steam-artifact` with signed checksums and manifest.
- `smoke:steam` launches the packaged content on a local static server and verifies asset resolution.

## Verify

```bash
npm run typecheck
npm run verify
```

Production and Steam builds run the web typecheck automatically. The root `npm run typecheck` command checks both the web and API workspaces.

## Real-browser online smoke

With local PostgreSQL migrated, the API running on port `8787`, and Vite running on port `5190`, run from the repository root:

```bash
npm run webrtc:browser-smoke
npm run webrtc:browser-soak -- --duration-seconds 1800
```

The smoke uses an installed Chrome, Edge, or Chromium browser and does not use Neon. It verifies signed signaling, acknowledged DataChannel frames, deliberately late 12-frame input batches, rollback corrections, decisive-frame confirmation, and canonical checksum convergence. The soak runs that rollback path through two storage-isolated browser clients for 30 real-time minutes by default and writes `build-artifacts/webrtc-browser-soak-report.json`; use a shorter `--duration-seconds` only while developing the harness. Set `BROWSER_EXECUTABLE_PATH`, `WEBRTC_SMOKE_URL`, or `API_BASE_URL` to override local defaults. See `docs/WEBRTC_TRANSPORT.md` for the protocol assertions and CI behavior.

## Balance profile validation

From repo root:

```bash
npm run balance:validate
```

From this workspace:

```bash
npm run balance:validate
```

Runtime profile override:

```bash
VITE_BALANCE_PROFILE_ID=mobility_focus_v1
```

## Menu theme validation

From repo root:

```bash
npm run theme:validate
npm run theme:contrast-check
```

From this workspace:

```bash
npm run theme:validate
npm run theme:contrast-check
```

Runtime:
- Open `Settings` in the home flow.
- Select `Menu Theme` and cycle options with mouse click, keyboard Left/Right, or controller Left/Right.
- Includes accessibility preset: `high_contrast_v1`.

## Stage atmosphere validation

From repo root:

```bash
npm run stage:validate
```

From this workspace:

```bash
npm run stage:validate
```

Runtime:
- Open `Settings` in the home flow.
- Select `Stage Atmosphere` and cycle options with mouse click, keyboard Left/Right, or controller Left/Right.
- Selection persists in `stageAtmosphereId` and applies scene fog/light/background hooks immediately.
- Presets may also author presentation-only camera pitch, launch pitch boost, a transparent gravity-shear mouth plane, arena-lip opacity, radial depth ticks, vanishing-point/core fade, and procedural depth travel. These values do not affect simulation or rollback state.

## Balance patch notes generator

From repo root:

```bash
npm run balance:patch-notes
```

From this workspace:

```bash
npm run balance:patch-notes
```

Optional:

```bash
npm run balance:patch-notes -- --base default --profiles mobility_focus_v1 --include-unchanged
```

Outputs:
- `build-artifacts/balance-patch-notes.md`
- `build-artifacts/balance-patch-notes-report.json`

## Training telemetry export

- In `Training` mode, open pause menu -> `Debug Tuning`.
- Use `Export Training Telemetry` to download session metrics JSON.
- Latest export is also saved in local persistence key:
  - `gravity_well.training_telemetry.v1`

## Character package scaffolding

From repo root:

```bash
npm run character:new -- --id striker --display-name "Striker" --author "Your Name"
```

From this workspace:

```bash
npm run character:new -- --id striker --display-name "Striker"
```

Then validate:

```bash
npm run character:validate
```

Run QA harness:

```bash
npm run character:qa
```

## Rollback scaffold toggle

Optional development flag:

```bash
VITE_FEATURE_ROLLBACK_SCAFFOLD=true
```

When enabled, the game loop runs through the rollback session scaffold (prediction and resimulation primitives) while preserving current local play behaviour.

With debug tools enabled, a rollback diagnostics panel is shown in HUD and match diagnostics are stored in local storage under `gravity_well.rollback_diagnostics.v1`.

## Online transport

- `src/net/transport.ts` contains direct-to-relay fallback primitives for WebRTC session setup.
- `src/net/connectivityApi.ts` contains API helpers for ICE config fetch and direct/relay telemetry posts.
- Set `VITE_MATCHMAKING_API_BASE` to enable API-backed matchmaking, ICE config, signaling, heartbeat, and telemetry.
- `VITE_FEATURE_ONLINE_MATCH_RUNTIME=true` enables the ranked-session handoff into authenticated WebRTC signaling, DataChannel input exchange, rollback, decisive-frame confirmation, and ranked settlement.
- The production-browser gate combines a deep same-page rollback/recovery drill with a two-client exchange in isolated browser contexts, including account, session, side, frame, acknowledgement, and completion-routing checks.
- The session lifecycle pauses heartbeats on browser hiding, deduplicates hidden/pagehide transitions, and requires a nonce-protected reconnect before resuming. Public `Online` remains hidden unless the runtime is explicitly enabled; remote TURN and deployment drills remain release gates.

## Online Dev menu shell

- `VITE_FEATURE_ONLINE_DEV_MENU=true` enables an in-game Online Dev shell menu in web dev/staging builds.
- The shell provides keyboard/controller section navigation for `Matchmaking`, `Rooms`, `Replay`, `Ranked`, and `Social`.
- Matchmaking panel supports queue join/leave and live ticket/session polling with reconnect debug fields.
- Rooms panel supports create/join/refresh/lock/spectator/start/rematch/close flows with invite payload previews and room phase/history inspection.
- Replay panel supports player/opponent/character/matchup/queue/date/patch filters, cursor-paginated search, and direct replay payload launch into replay review.
- Ranked panel supports progression snapshot inspection (rating/league/LP/MR/provisional) with recent pre/post delta rows and profile-settings fallback when ranked APIs are unavailable.
- Social panel supports account sign-in state and linked identities, friend presence list, request history/actions, and queue/room invite send/cancel actions with explicit empty-state guidance.
- `VITE_FEATURE_ONLINE_DIAGNOSTICS=true` enables a live diagnostics overlay with rollback/network/session counters and `Export JSON` capture. New sessions start in the non-blocking header-only view; **Expand**, **Collapse**, and **Hide** persist explicit choices for the browser session. The expanded data surface passes clicks through to game/menu controls while its own header actions remain interactive. `?diagnostics=1` is a development-build convenience only and cannot bypass a disabled staging or production feature flag; `?diagnostics=0` remains an explicit opt-out.
- Input parity: Start menu and Online Dev menu support keyboard, mouse, and controller navigation with explicit back behavior and control focus.

## Web auth flow (prototype)

- Home menu includes an `Account` action in web builds.
- Selecting it opens a prompt-driven flow for `signin`, `signup`, or `signout`.
- `signup` supports guest upgrade when your current session is a guest account and you confirm upgrade.
- API recovery responses (duplicate email, disabled account, invalid credentials) are surfaced in the prompt error message.

## Steam sign-in flow (prototype)

- Steam platform builds attempt sign-in automatically via `POST /auth/steam/exchange` at startup.
- Dev/testing ticket options:
  - `VITE_STEAM_DEV_TICKET=dev-steam:<steamUserId>`
  - native runtime bridge: `window.gravityWellSteam` from `apps/steam-shell/preload.cjs`
  - service identity: `VITE_STEAM_WEB_API_IDENTITY` (must match the API)
  - `VITE_STEAM_DEV_TICKET` is development-only and is not a production Steam ticket source
- `VITE_PROFILE_API_BASE` must be configured for exchange.
- Failed Steam auth returns explicit recovery guidance in account summary text.

## Client architecture

- `src/sim`: deterministic simulation and rules.
  - combat timing registry: `src/sim/moveData.ts` (`COMBAT_MOVE_FRAME_REGISTRY`, 60Hz units)
  - deterministic AI behaviour policy: `src/sim/ai.ts`
  - data-driven AI difficulty profiles (`rookie`, `cadet`, `veteran`, `ace`) with reaction delay, action weights, risk, and error tuning
  - arcade ladder flow and stage/rule state machine: `src/sim/arcade.ts`
- `src/view`: Three.js rendering and HUD.
- `src/input`: keyboard/gamepad input mapping.
- `src/platform`: platform adapters.

## Training frame-data overlay

- Available only during training mode gameplay.
- Toggle with `F1` on keyboard or `View/Back` on controller.
- Overlay rows show startup/active/recovery timing for launch, dunk, parry, break, and special for both players.

## Asset manifest loader

- Manifest schema and default manifest:
  - `src/view/assets/types.ts`
  - `src/view/assets/defaultManifest.ts`
- Async preloader:
  - `src/view/assets/loader.ts`
- Budget checker and report:
  - `src/view/assets/budget.ts`
  - `scripts/asset-budget-check.ts`
- Startup preload call:
  - `src/main.ts` preloads `DEFAULT_ASSET_MANIFEST` and reports progress in debug logs.
- Build commands run asset budget validation before compiling and emit `build-artifacts/asset-budget-report.json`.

## Character visual presentation adapters

- Character profile data includes a presentation mode: `3d`, `sprite`, or `hybrid`.
- Adapter interface and implementations live in `src/view/characterVisual.ts`.
- Scene/render pipeline (`src/view/scene.ts`, `src/view/render.ts`) uses adapter handles so character visuals can swap without simulation code changes.

## Combat VFX event binding and presets

- Event extraction from render snapshot deltas lives in `src/view/vfx/events.ts`.
- Preset bindings and values live in `src/view/vfx/presets.ts`.
- Runtime playback for particles, trails, flashes, and sound cues lives in `src/view/vfx/runtime.ts`.
- Supported bound events are `boost`, `launch`, `parry`, `projectile`, and `dunk`.
- Tuning preset values in `presets.ts` does not require simulation gameplay code edits.

## Runtime debug memory counters

- With debug tools enabled, HUD debug diagnostics include budgeted texture bytes, mesh triangles, VFX emitter counts, active VFX count, projectile count, and preloaded asset bytes.

## Audio event bus and routing

- Typed audio events and buses live under `src/view/audio`.
- Router supports `master`, `music`, `sfx`, and `voice` buses with WebAudio gain-node routing.
- VFX combat events in `src/view/vfx/runtime.ts` emit typed combat audio events through `src/main.ts` wiring, not clip-path logic in sim.
- Missing route diagnostics are explicit; debug mode uses strict fail behavior.
- Adaptive music state controller (`src/view/audio/musicState.ts`) switches `menu`, `neutral`, `launch`, and `end` states with configurable fades.
- Voice callout system (`src/view/audio/voiceLines.ts`) provides locale fallback, priority, cooldown, and anti-spam line selection per character voice profile.
- Pause menu audio tab exposes persistent master/music/SFX/voice sliders, voice ducking toggle, dynamic range mode, and subtitle toggle.
- Local menu includes persistent `AI Difficulty` selection, saved in local settings and profile settings payload.
- Local menu includes `Arcade Continues` and `Arcade Retry` options used by arcade loss-flow prompts and run summaries.
- Arcade run history and best completion records are shown in Local menu and persisted offline, then synced to profile settings when account services are available.

## Replay scripts

From repo root:

```bash
npm run replay:run -- --input replays/smoke.replay.json --output replays/smoke.expected.json
npm run replay:check
npm run replay:size-check
npm run smoke:visual-alpha
```

## Matchup regression smoke suite

From repo root:

```bash
npm run matchup:smoke
```

From this workspace:

```bash
npm run matchup:smoke
```

Optional baseline refresh:

```bash
npm run matchup:smoke -- --write-expected
```

## Replay review viewer

- Open `Replay Review (Smoke Fixture)` from the home menu.
- In local AI-vs-AI, ordinary human-vs-AI sparring, or `Balance Sparring (Local)`, pause and choose `Review Latest Local Round` to inspect the exact live input/checksum sequence and any recorded AI decision trace; exiting returns to that paused match.
- Playback controls:
  - `Space` pause/resume
  - `,` and `.` frame-step backward/forward
  - `[` and `]` playback speed
  - `1-9` jump to round markers
  - `Esc` exit replay review to its source (the paused AI match for a live capture, otherwise home)
- The viewer shows:
  - Both players' input timeline rows.
  - A frame-synchronized AI decision, requested input, simulator-accepted start, and outcome chain when a versioned AI trace is present. Human and legacy payloads explicitly report that no AI decision trace is available.
  - A deterministic plain-language Fight story before the detailed loop chain. Any suggested controlled check is read-only and cannot stage or change a rule from Replay Review.
  - Frame-data overlay (startup, active, recovery states).
  - Recent move outcomes with hit/block/whiff markers and frame-advantage markers.

`npm run bundle:budget` inspects the emitted production HTML and JavaScript. It gates the entry chunk, largest chunk, aggregate initial raw/gzip bytes, external initial scripts, and proof that Pause/Balance Lab, Replay Review, and online developer tools remain first-use chunks. The report is written to `build-artifacts/production-bundle-budget.json`; normal production and Steam builds run this automatically.

`npm run smoke:visual-alpha` requires a current production build. It starts only a loopback Vite preview, blocks external requests, verifies WebGL and bundled replay JSON, opens the real menu/replay flow, seeks deterministic action markers, verifies that each brief exit exposes a causal re-entry control and lands on its exact frame, and exercises the lazy Pause menu. Schema `gw.visual-alpha-smoke.v8` also opens the current ordinary human-vs-AI sparring round, requires its P2 decision trace and Fight story, proves the paused story node remains stable across animation frames, captures the scrolled Replay Review panel, exits to the same paused match, and verifies resume/reopen behavior. It requires the Balance Lab to remain hidden there, then selects `Balance Sparring (Local)` and the named **Human recovery agency** probe through the production menu. It verifies P1 has no AI-role control while P2 remains tunable, captures and freezes baseline ratings, deliberately mutates the disabled controls to prove the export retains the captured evidence, stages only `naturalRecoveryResetMultiplier=0.75`, applies a same-seed restart, and confirms the active value changed with no pending edits. It downloads `gw.balance-lab-experiment.v6`, verifies named probe/scenario/human provenance and distinct baseline/candidate evidence, and opens the checksum-verified round replay with the same probe label and P2 decision trace. It writes its report plus normal UI, scorecard, local-round review, Balance Sparring, re-entry review, and overlay-free stage screenshots to `build-artifacts/visual-alpha-smoke/`. Before browser launch it re-simulates the fixture and requires accepted Vanguard and Duelist special starts at their captured frames; a raw button press rejected by cooldown or commitment cannot satisfy the gate. It also records a report-only 180-interval local-match frame-timing sample; this is hardware evidence for human review, not a noisy CI score.

From this workspace:

```bash
npm run replay:run -- --input replays/smoke.replay.json --output replays/smoke.expected.json
npm run replay:check
npm run replay:size-check
npm run smoke:visual-alpha
```
