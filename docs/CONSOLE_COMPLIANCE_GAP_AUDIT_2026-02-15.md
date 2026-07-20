# Console Compliance Gap Audit

Original audit: 2026-02-15
Last verified: 2026-07-20
Story: `S3.6` Platform compliance gap audit
Scope: pre-onboarding readiness check for console platform requirements.

## Audit Checklist

### Save Rules
- Requirement: save writes must be atomic and recoverable across power loss/suspend.
- Requirement: save data must support platform storage quotas and corruption recovery.
- Requirement: user/account switch handling must prevent cross-profile save leakage.
- Current state:
  - An asynchronous, user-scoped persistence contract now provides revision conflicts, quota metadata, structured failures, and recoverable replace intents.
  - Web and Steam factories expose the contract and retain deprecated synchronous methods for rollout compatibility.
  - Settings and profile cache migration paths exist for both adapters.
  - Quota, user-isolation, conflict, migration, and interrupted-intent tests exist.
  - Browser storage provides recoverable intent semantics, not console-certified atomicity.
  - Steam still uses an in-memory fallback in the web client; no native durable Steam or console SDK adapter exists.
- Gap status: **partial**

### Entitlement Checks
- Requirement: startup and session entry must verify ownership/entitlements per platform account.
- Requirement: offline/expired entitlement behavior must fail safely with user-facing guidance.
- Current state:
  - `PlatformEntitlementService` exists with web and Steam policy adapters, safe denial/unavailable states, startup/session checks, and tests.
  - Main-menu gameplay gating and recovery messaging are implemented.
  - Lifecycle hooks can now publish account-specific entitlement changes.
  - No console-provider token/ownership adapter exists.
  - Steam's production ownership verification still depends on native runtime and partner configuration.
- Gap status: **partial**

### Suspend/Resume And Device Lifecycle
- Requirement: game state, network sessions, and persistence operations must tolerate suspend/resume.
- Requirement: reconnect and match/session validity must recover or fail with deterministic cleanup.
- Requirement: account, entitlement, and controller changes must be observable without browser-specific gameplay code.
- Current state:
  - Online Dev has an existing browser visibility reconnect path.
  - A platform lifecycle service now models suspend, resume, user change, entitlement change, and controller disconnect.
  - Browser visibility, page lifecycle, and gamepad-disconnect hooks plus deterministic test fakes are implemented.
  - The new service is exposed by web and Steam factories but is intentionally not integrated into `main.ts` or match orchestration yet.
  - No console SDK lifecycle adapter or end-to-end suspend-during-save/match evidence exists.
- Gap status: **partial**

### Privacy
- Requirement: presence/invite/social surfaces must honor platform privacy and parental controls.
- Requirement: data export and telemetry paths must align to console privacy policy boundaries.
- Current state:
  - Privacy controls exist (`presenceVisibility`, invite permissions, moderation controls).
  - No console policy mapping matrix or age-gate/parental override integration exists.
- Gap status: **partial**

## Prioritised Remaining Gaps

| Priority | Area | Remaining gap | Risk | Effort | Next evidence |
| --- | --- | --- | --- | --- | --- |
| P0 | Save Rules | Native durable Steam/console adapter with SDK-atomic commits and real quota reporting | High | High | Power-loss, quota-full, corruption, and user-switch suite on target hardware |
| P0 | Entitlement | Provider-backed ownership adapter and offline/expired-license policy | High | Medium | Platform account matrix on target hardware |
| P1 | Lifecycle | Integrate the lifecycle service with save flushing, auth, entitlement, controller ownership, and match cleanup | High | High | Suspend/resume and controller/user-change end-to-end suite |
| P1 | Privacy | Console privacy mapping and parental-control enforcement | Medium | Medium | Provider compliance matrix and account-age tests |
| P2 | Cloud Save | Cloud scope adapter and explicit local/cloud conflict UX | Medium | High | Cross-device conflict and rollback tests |
| P2 | Operations | Automated console certification evidence package | Medium | Low | Reproducible report from release candidate builds |

## Summary By Risk
- The shared boundaries needed for platform work now exist; save, entitlement, and lifecycle are no longer completely absent.
- Console release remains blocked on provider SDK adapters, durable target storage, parent integration, and hardware evidence.
- Browser/Steam-web tests validate contract behavior but do not constitute console certification evidence.
