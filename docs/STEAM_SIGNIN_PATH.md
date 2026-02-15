# Steam Sign-In Path

Date: 2026-02-15  
Story: `S1.9` Steam sign-in path

## Flow
- Platform: `steam`
- On startup, `platform.auth.getSession()` attempts Steam ticket exchange automatically.
- Exchange endpoint:
  - `POST /auth/steam/exchange`
- On success:
  - session is authenticated
  - account id is cached for repeated `getSession()` calls
  - profile bootstrap fetches account profile

## Adapter Implementation
- File: `apps/game-web/src/platform/steam.ts`
- Behavior:
  - Reads API base from `VITE_PROFILE_API_BASE` (or injected test option).
  - Reads ticket from runtime hook (`window.__GW_STEAM_TICKET__`) or `VITE_STEAM_DEV_TICKET`.
  - Sends `{ steamTicket }` exchange payload.
  - Returns authenticated session when valid account id is returned.

## Failure Recovery Messaging
- Failures return unauthenticated session with explicit recovery text in `displayName`.
- Home account summary surfaces that message when session is unauthenticated.
- Examples:
  - Missing API base -> configure `VITE_PROFILE_API_BASE`
  - Missing ticket -> set `VITE_STEAM_DEV_TICKET` for dev
  - API rejection -> includes server recovery message

## Tests
- `apps/game-web/src/platform/steamAuth.test.ts`
  - success exchange + session cache
  - rejected ticket includes recovery message
  - missing ticket error path
  - missing API base error path
