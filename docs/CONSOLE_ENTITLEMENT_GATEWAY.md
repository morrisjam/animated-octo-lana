# Console Entitlement Gateway

Original date: 2026-02-15
Updated: 2026-07-20
Story: `S3.8` Console entitlement gateway

## Goal
- Enforce entitlement checks through one platform adapter before gameplay access.
- Apply checks at startup and after auth session transitions.
- Fail safely with explicit user-facing recovery guidance.

## Interface
- `PlatformEntitlementService` is exposed on `PlatformServices` in `apps/game-web/src/platform/types.ts`.
- Check method:
  - `checkAccess({ stage, accountId })`
  - `stage` values: `startup`, `session`

## Adapter Behavior
- Shared configurable implementation: `apps/game-web/src/platform/entitlement.ts`
  - Modes:
    - `open`
    - `require_auth`
    - `force_denied`
    - `unavailable`
- Web adapter wiring:
  - `apps/game-web/src/platform/web.ts`
  - env controls:
    - `VITE_ENTITLEMENT_MODE` (`open` default)
    - `VITE_ENTITLEMENT_DENY_MESSAGE` (optional)
- Steam adapter wiring:
  - `apps/game-web/src/platform/steam.ts`
  - defaults to safe `unavailable` unless bypassed
  - env controls:
    - `VITE_STEAM_ENTITLEMENT_MODE`
    - `VITE_STEAM_ENTITLEMENT_BYPASS=true` (local smoke use only)
    - `VITE_STEAM_ENTITLEMENT_DENY_MESSAGE` (optional)

## UI Integration
- Main menu gameplay entry points (`Online`, `Local`) are disabled when access is blocked.
- Status message is shown in the main menu with recovery text and entitlement code.
- Startup/session checks are invoked in `apps/game-web/src/main.ts`:
  - during initial profile bootstrap
  - after sign-in/sign-up/sign-out transitions

## Verification
- Entitlement policy tests:
  - `apps/game-web/src/platform/entitlement.test.ts`
- Web/Steam adapter behavior tests:
  - `apps/game-web/src/platform/entitlement.adapters.test.ts`

## Portability Status
- The shared entitlement service and web/Steam policy adapters are implemented and wired into current startup/session UI gating.
- `PlatformLifecycleService` now exposes an `entitlement_change` event with account identity plus previous/current access metadata. Parent integration can use `lifecycleHooks.entitlementChanged(...)`; it is intentionally not wired by this platform-only change.
- Console ownership-token verification is not implemented. Each console still requires an SDK-backed `PlatformEntitlementService` adapter and certification-specific offline/expired-license behavior.
- Steam's configurable policy is not a substitute for a production ownership check until it is backed by the native Steam runtime/partner configuration.
