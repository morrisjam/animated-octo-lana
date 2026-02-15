# Console Compliance Gap Audit

Date: 2026-02-15  
Story: `S3.6` Platform compliance gap audit  
Scope: pre-onboarding readiness check for console platform requirements.

## Audit Checklist

### Save Rules
- Requirement: save writes must be atomic and recoverable across power loss/suspend.
- Requirement: save data must support platform storage quotas and corruption recovery.
- Requirement: user/account switch handling must prevent cross-profile save leakage.
- Current state:
  - Web/Steam persistence patterns exist, but no console-specific save adapter contract.
  - No quota/failure simulation suite for console save APIs.
- Gap status: **open**

### Entitlement Checks
- Requirement: startup and session entry must verify ownership/entitlements per platform account.
- Requirement: offline/expired entitlement behavior must fail safely with user-facing guidance.
- Current state:
  - No entitlement validation service in API/game-web startup flow.
  - No platform token verification adapter for console providers.
- Gap status: **open**

### Suspend/Resume
- Requirement: game state, network sessions, and persistence operations must tolerate suspend/resume.
- Requirement: reconnect and match/session validity must recover or fail with deterministic cleanup.
- Current state:
  - Reconnect logic exists for web/online session tokens.
  - No suspend/resume lifecycle integration tests or platform hooks.
- Gap status: **open**

### Privacy
- Requirement: presence/invite/social surfaces must honor platform privacy and parental controls.
- Requirement: data export and telemetry paths must align to console privacy policy boundaries.
- Current state:
  - Privacy controls exist (`presenceVisibility`, invite permissions, moderation controls).
  - No console policy mapping matrix or age-gate/parental override integration.
- Gap status: **partial**

## Prioritised Gap Report (Risk vs Effort)

| Priority | Area | Gap | Risk | Effort | Rationale | Proposed next story |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Save Rules | Platform-safe persistence abstraction and failure-safe save contract | High | Medium | Certification blocker; data loss risk without explicit adapter contract | `S3.7` |
| P0 | Entitlement | Entitlement verification and fail-safe startup behavior | High | Medium | Certification and commerce blocker; access-control failure risk | New story: Console entitlement gateway |
| P1 | Suspend/Resume | Suspend/resume lifecycle hooks and reconnect handling tests | High | High | Gameplay/session integrity risk under platform lifecycle events | New story: Suspend/resume resilience suite |
| P1 | Privacy | Console privacy mapping matrix + parental-control enforcement | Medium | Medium | Policy non-compliance risk for social features | New story: Console privacy policy mapping |
| P2 | Save Rules | Save quota/corruption simulation harness | Medium | Medium | Improves recovery confidence and QA repeatability | New story: Save-failure simulation harness |
| P2 | Operations | Console readiness evidence package for certification | Medium | Low | Needed for release readiness audits | New story: Certification evidence automation |

## Summary By Risk
- High risk items: save adapter, entitlement checks, suspend/resume lifecycle behavior.
- Medium risk items: privacy mapping and save-failure simulation.
- No low-risk-only blockers identified for initial console onboarding.

## Review Record
- Review date: 2026-02-15
- Review format: engineering + production document walkthrough.
- Engineering review focus:
  - API/session implications (`apps/api/src/server.ts`, matchmaking/reconnect, moderation/privacy).
  - Persistence architecture readiness and migration strategy.
- Production review focus:
  - Certification-risk ordering.
  - Delivery sequencing and dependency alignment.
- Outcome:
  - Priority ordering accepted (`P0` save + entitlement, then `P1` suspend/resume + privacy).
  - `S3.7` confirmed as immediate follow-on for save rules.
