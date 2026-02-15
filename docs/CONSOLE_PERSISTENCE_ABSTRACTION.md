# Console-Safe Persistence Abstraction

Date: 2026-02-15  
Story: `S3.7` Console-safe persistence abstraction

## Goal
- Allow gameplay code to use one platform-agnostic persistence contract.
- Keep persistence scope-switching in platform adapters, not gameplay logic.
- Ensure unsupported persistence operations fail safely without crashes.

## Interface
- `PlatformPersistenceService` is exposed on `PlatformServices` in `apps/game-web/src/platform/types.ts`.
- Contract methods:
  - `isScopeSupported(scope)`
  - `readJson(key, { scope })`
  - `writeJson(key, value, { scope })`
  - `remove(key, { scope })`
- Scopes:
  - `local` (currently supported)
  - `cloud` (currently unsupported in web and steam adapters)

## Implementations
- Shared storage-backed adapter: `apps/game-web/src/platform/persistence.ts`
- Web adapter wiring: `apps/game-web/src/platform/web.ts`
- Steam adapter wiring: `apps/game-web/src/platform/steam.ts`

## Gameplay Integration
- `apps/game-web/src/main.ts` now uses `platform.persistence` for:
  - local settings load/save (`gravity_well.settings.v1`)
  - rollback diagnostics load/save (`gravity_well.rollback_diagnostics.v1`)
- Gameplay code no longer calls `platform.storage` directly for save-like operations.

## Safe Failure Behavior
- Missing data returns `{ ok: false, status: "not_found" }`.
- Corrupt JSON returns `{ ok: false, status: "invalid_data" }`.
- Unsupported scope returns `{ ok: false, status: "unsupported" }`.
- No persistence operation throws into gameplay call sites for expected unsupported/missing/corrupt cases.

## Verification
- Shared test suite: `apps/game-web/src/platform/persistence.shared.test.ts`
- Coverage in same suite for both web and steam:
  - local JSON round-trip
  - remove + not found behavior
  - invalid JSON handling
  - unsupported `cloud` scope returns safe failure
