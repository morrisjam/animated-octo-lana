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

## Build and preview

```bash
npm run build
npm run preview
```

## Verify

```bash
npm run verify
```

## Rollback scaffold toggle

Optional development flag:

```bash
VITE_FEATURE_ROLLBACK_SCAFFOLD=true
```

When enabled, the game loop runs through the rollback session scaffold (prediction and resimulation primitives) while preserving current local play behaviour.

With debug tools enabled, a rollback diagnostics panel is shown in HUD and match diagnostics are stored in local storage under `gravity_well.rollback_diagnostics.v1`.

## Online transport scaffolding

- `src/net/transport.ts` contains direct-to-relay fallback primitives for WebRTC session setup.
- `src/net/connectivityApi.ts` contains API helpers for ICE config fetch and direct/relay telemetry posts.
- Set `VITE_MATCHMAKING_API_BASE` to enable API-backed ICE config and telemetry in future online integration.

## Online Dev menu shell

- `VITE_FEATURE_ONLINE_DEV_MENU=true` enables an in-game Online Dev shell menu in web dev/staging builds.
- The shell provides keyboard/controller section navigation for `Matchmaking`, `Rooms`, `Replay`, `Ranked`, and `Social`.
- Matchmaking panel supports queue join/leave and live ticket/session polling with reconnect debug fields.
- Rooms panel supports create/join/refresh/lock/spectator/start/rematch/close flows with invite payload previews and room phase/history inspection.
- Replay panel supports player/opponent/character/matchup/queue/date/patch filters, cursor-paginated search, and direct replay payload launch into replay review.
- Ranked panel supports progression snapshot inspection (rating/league/LP/MR/provisional) with recent pre/post delta rows and profile-settings fallback when ranked APIs are unavailable.
- Social panel supports account sign-in state and linked identities, friend presence list, request history/actions, and queue/room invite send/cancel actions with explicit empty-state guidance.
- `VITE_FEATURE_ONLINE_DIAGNOSTICS=true` enables a live diagnostics overlay with rollback/network/session counters and `Export JSON` capture.
- Input parity: Start menu and Online Dev menu support keyboard, mouse, and controller navigation with explicit back behavior and control focus.

## Web auth flow (prototype)

- Home menu includes an `Account` action in web builds.
- Selecting it opens a prompt-driven flow for `signin`, `signup`, or `signout`.
- `signup` supports guest upgrade when your current session is a guest account and you confirm upgrade.
- API recovery responses (duplicate email, disabled account, invalid credentials) are surfaced in the prompt error message.

## Client architecture

- `src/sim`: deterministic simulation and rules.
- `src/view`: Three.js rendering and HUD.
- `src/input`: keyboard/gamepad input mapping.
- `src/platform`: platform adapters.

## Replay scripts

From repo root:

```bash
npm run replay:run -- --input replays/smoke.replay.json --output replays/smoke.expected.json
npm run replay:check
npm run replay:size-check
```

## Replay review viewer

- Open `Replay Review (Smoke Fixture)` from the home menu.
- Playback controls:
  - `Space` pause/resume
  - `,` and `.` frame-step backward/forward
  - `[` and `]` playback speed
  - `1-9` jump to round markers
  - `Esc` exit replay review to home
- The viewer shows:
  - Both players' input timeline rows.
  - Frame-data overlay (startup, active, recovery states).
  - Recent move outcomes with hit/block/whiff markers and frame-advantage markers.

From this workspace:

```bash
npm run replay:run -- --input replays/smoke.replay.json --output replays/smoke.expected.json
npm run replay:check
npm run replay:size-check
```
