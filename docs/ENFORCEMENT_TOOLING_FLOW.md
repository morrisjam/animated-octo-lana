# Enforcement Tooling Flow

Date: 2026-02-14  
Status: active

## Scope
- Support applies one of:
  - `warning`
  - `suspension` (temporary, duration-based)
  - `ban` (permanent until revoked)
- Every action stores actor identity for audit.
- Appeals are tracked with explicit status.

## Admin Action APIs
1. Create action:
   - `POST /admin/enforcement/actions`
   - Header: `x-admin-key: <ENFORCEMENT_ADMIN_KEY>`
   - Optional header: `x-admin-actor: support_agent_id`
2. List actions:
   - `GET /admin/enforcement/actions`
   - Filters: `targetAccountId`, `actionType`, `activeOnly`, `limit`, `offset`

## Appeal APIs
1. Player submits:
   - `POST /enforcement/appeals`
   - Body: `actionId`, `note`
2. Player tracks status:
   - `GET /enforcement/me`
3. Admin review:
   - `POST /admin/enforcement/appeals/:appealId/review`
   - Status options: `under_review`, `accepted`, `rejected`
   - `revokeAction=true` can be used on accepted appeals.

## Audit Fields
- Actions: `actor_identity`, `created_at`, `updated_at`, optional `revoked_by`, `revoked_reason`.
- Appeals: `status`, `reviewed_by`, `reviewed_at`, `reviewer_note`, `updated_at`.

## Runtime Enforcement
- Active `suspension` and `ban` actions block:
  - `POST /matchmaking/queue/join`
  - `POST /ranked/results`
- `warning` actions are recorded but do not block online play.
