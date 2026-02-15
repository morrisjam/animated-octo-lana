# Suspend/Resume Resilience (Phase 1)

Date: 2026-02-15

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
