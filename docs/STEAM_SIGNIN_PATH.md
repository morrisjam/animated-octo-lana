# Steam Sign-In Path

Date: 2026-02-15  
Updated: 2026-07-15
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
  - Requests a one-use ticket from the versioned `window.gravityWellSteam` preload bridge using `VITE_STEAM_WEB_API_IDENTITY`.
  - Validates bridge schema, ticket handle, hexadecimal ticket bytes, and exact service identity before transmission.
  - In a normal browser or explicit development-ticket test, sends `{ steamTicket }` with the browser fetch implementation.
  - In the packaged shell, the preload intercepts only `POST /auth/steam/exchange` before the web bundle captures `fetch` and routes it through the native IPC exchange. No cross-origin authentication request leaves the `file://` renderer.
  - Cancels the native Steam ticket handle after either success or rejection; the API-issued signed session is independent of it.
  - Returns authenticated session when valid account id is returned.

## Native host

- Package: `apps/steam-shell`
- `steamworks.js` runs only in Electron's main process and calls `getAuthTicketForWebApi(identity)`, which resolves after Steam's ticket callback.
- The renderer is sandboxed with Node integration disabled and context isolation enabled.
- The preload exposes narrow ticket request/cancel methods plus the internal packaged auth exchange method; raw Electron IPC and Node APIs are not exposed.
- IPC verifies the sender document and BrowserWindow before touching Steamworks.
- The exchange IPC maps the validated renderer ticket back to its main-process lease handle. The main process claims that handle once, sends the actual ticket to the exact packaged HTTPS API endpoint without following redirects, and returns only status, selected headers, and at most 64 KiB of streamed response body.
- Endpoint substitution, query injection, malformed/expired/reused leases, oversized responses, and production HTTP targets fail closed. Unpackaged development may use an explicit loopback HTTP override.
- Static web artifacts no longer count as a functioning Steam sign-in build. `npm run steam:native:ci` creates and inspects the Windows shell artifact locally.
- The release job uses `.env.steam-alpha`, not the offline `.env.steam` profile. It enables Online, Ranked, and the live match runtime while retaining production diagnostics and developer-tool restrictions.
- `gw.steam-alpha-release.v1` binds the exact checked-out SHA, clean/dirty source state, API origin, Steam Web API identity, ruleset, balance profile, entitlement mode, and feature posture. The same SHA must be compiled into JavaScript, and the native smoke cross-checks the manifest against the packaged shell configuration before CI uploads the artifact.

## API verification and abuse boundaries

- The API sends the hexadecimal ticket only from the server to Steam's official `ISteamUserAuth/AuthenticateUserTicket` endpoint. The publisher key is never exposed to the client. See Steamworks' [AuthenticateUserTicket documentation](https://partner.steamgames.com/doc/webapi/isteamuserauth) and [GetAuthTicketForWebApi documentation](https://partner.steamgames.com/doc/api/isteamuser).
- The verifier accepts only the exact official `https://partner.steam-api.com` publisher base or a loopback mock endpoint. The controlled-alpha provider audit independently requires the official base, so a hosted configuration cannot opt into the local exception.
- `STEAM_WEB_API_TIMEOUT_MS` defaults to five seconds. Timeout, upstream HTTP failure, and verifier misconfiguration return `503`; malformed requests return `400`; a ticket explicitly rejected by Steam returns `401`.
- After Steam accepts a non-development ticket, the API computes a SHA-256 fingerprint from its case-normalized hexadecimal bytes and atomically claims that fingerprint in `steam_ticket_exchanges` inside the account-link transaction. The raw ticket is never persisted, and deleting an account retains the fingerprint claim so deletion cannot make an exchanged ticket reusable.
- An existing fingerprint returns `401 steam_ticket_already_exchanged`; the client must acquire a fresh Steam ticket. The database primary key makes concurrent exchanges across API instances single-winner rather than relying on process memory.
- Source and HMAC-pseudonymized ticket buckets are consumed atomically in PostgreSQL before verification. Hexadecimal ticket identity is case-canonicalized, so letter-case variants share one bucket. Repeating one ticket reaches `429` with `Retry-After` after the configured boundary, even across API instances.
- Expired bucket rows are removed in bounded, lock-skipping batches at API startup and every `AUTH_RATE_LIMIT_CLEANUP_INTERVAL_SECONDS` (default 900), preventing unique-ticket traffic from creating unbounded retained state.
- Explicit development tickets do not create durable exchange claims. They remain available only under the non-production development-ticket flag, which the controlled-alpha provider audit requires to be disabled.
- `npm run api:smoke:auth-rate-limit` proves sequential and concurrent database boundaries. `npm run api:smoke:auth-security` proves route ownership and one-time exchange behavior against a running local API. Local integration deliberately has a loopback verifier accept the same case-varied ticket twice, then requires Gravity Well to issue one session, reject the replay, and retain exactly one fingerprint row. This proves the application boundary without contacting or impersonating Steam.
- A real account ticket, the production App ID/publisher key, expiration behavior, and key rotation still require a staging Steam rehearsal before alpha entry opens.

## Identity ownership

- First-time and returning Steam sign-in send no existing-account bearer token and omit `linkToAuthenticatedAccount`.
- Adding an unclaimed Steam identity to an existing account requires that account's valid bearer token and `linkToAuthenticatedAccount: true`.
- An authenticated exchange without explicit link confirmation is rejected before Steam verification.
- A Steam identity already owned by another account returns a conflict without moving credentials, profile, ratings, social state, enforcement state, or alpha access, and without disabling either account.
- The retired `mergeAccountId` request field is rejected before Steam verification. See `docs/STEAM_IDENTITY_LINK_MERGE_POLICY.md`.

## Failure Recovery Messaging
- Failures return unauthenticated session with explicit recovery text in `displayName`.
- Home account summary surfaces that message when session is unauthenticated.
- Examples:
  - Missing API base -> configure `VITE_PROFILE_API_BASE`
  - Missing native bridge -> launch the packaged client through Steam
  - Development-only ticket -> explicitly allow and set `VITE_STEAM_DEV_TICKET`
  - API rejection -> includes server recovery message

## Tests
- `apps/game-web/src/platform/steamAuth.test.ts`
  - native ticket acquisition, identity binding, cancellation, exchange, and session cache
  - rejected and malformed ticket paths
  - fail-closed missing bridge path
  - explicitly allowed development-ticket path
  - missing API base error path
- `apps/steam-shell/test/ticketBroker.test.cjs`
  - callback-complete byte acquisition and hex encoding
  - one-use native handle lifetime and cancellation
  - identity substitution rejection
  - malformed ticket cleanup and byte bounds
- `apps/steam-shell/test/authTransport.test.cjs`
  - exact HTTPS endpoint allowlist and loopback-only development exception
  - main-process request shape, error propagation, timeout signal, and response-size bound
- `apps/steam-shell/test/preloadTransport.test.cjs`
  - packaged auth requests use IPC without invoking renderer fetch
  - non-auth requests preserve browser fetch behavior
  - missing/cancelled leases fail closed and ticket bytes do not cross exchange IPC
