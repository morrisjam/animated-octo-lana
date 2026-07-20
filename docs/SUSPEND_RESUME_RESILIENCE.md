# Suspend/Resume Resilience

Original date: 2026-02-15
Updated: 2026-07-20

## Scope
- Add a first-pass lifecycle resilience path for active online test sessions in the in-game Online Dev menu.

## Implemented behavior
- While the Online Dev menu is open:
  - On `visibilitychange` to hidden or `pagehide`, client calls `POST /matchmaking/sessions/disconnect`.
  - On `visibilitychange` back to visible, client calls `POST /matchmaking/sessions/reconnect` with a new `reconnectAttemptId`.
  - Client then re-polls ticket/session state to refresh reconnect deadlines and participant connection status.

## Files
- `apps/game-web/src/view/onlineDevMenu.ts`

## Notes
- This pass targets the Online Dev flow first, to validate lifecycle handling against existing reconnect APIs.
- If there is no active session token, resume reconnect is skipped safely and status text explains why.

## Platform Lifecycle Service (Phase 2)
- `apps/game-web/src/platform/lifecycle.ts` now provides a platform-neutral event service for:
  - suspend
  - resume
  - user change
  - entitlement change
  - controller disconnect
- Browser hooks translate `visibilitychange`, `pagehide`, `pageshow`, and `gamepaddisconnected` into those events.
- Web and Steam platform factories expose both the read-only service and adapter hooks.
- A deterministic fake allows lifecycle sequences to be tested without a browser or platform SDK.
- Duplicate suspend/resume, user, and same-account entitlement transitions are suppressed.

## Remaining Integration
- The lifecycle service is not wired into `main.ts`, save flushing, auth transitions, or match orchestration in this platform-only change.
- The existing Online Dev reconnect behavior remains unchanged.
- Console SDK adapters must call the same hooks and prove suspend during persistence/network activity on target hardware.
