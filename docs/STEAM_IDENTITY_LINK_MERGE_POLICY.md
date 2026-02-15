# Steam Identity Link And Merge Policy

Date: 2026-02-15  
Story: `S2.28` Steam identity link and account merge policy

## Scope
- Steam ticket exchange links `steam` provider identity to an internal account.
- Existing Steam-linked account is reused when found.
- Authenticated guest or web account can be merged into Steam-linked account when identities differ.

## Link Flow
- Endpoint: `POST /auth/steam/exchange`
- Input:
  - `steamTicket` (required)
  - `mergeAccountId` (optional, must match authenticated `x-account-id` when provided)
  - `displayName` (optional)
- Behavior:
  - If Steam identity is new:
    - link to authenticated/merge account when provided, else create account.
  - If Steam identity already exists:
    - sign in to linked account.
    - if authenticated account differs, merge source account into Steam-linked target.

## Merge Policy
- Source and target accounts are locked and must both be active.
- Source `web` identity:
  - transferred to target when target has no `web` identity.
  - otherwise discarded from source and audited as unlink.
- Source non-web identities:
  - discarded from source and audited as unlink.
- Web credentials:
  - transferred to target when safe.
  - discarded from source when target already has credentials.
- Profile:
  - merged into target profile when both exist.
  - transferred when target profile does not exist.
- Source account:
  - set to `disabled` after merge.
- Merge audit:
  - `account_merge_events` row with transfer flags metadata.

## Audit Coverage
- `identity_link_events`:
  - linked and unlinked events for transfer/discard branches.
- `account_merge_events`:
  - merge actor, source, target, reason, and metadata flags.

## Implementation
- Core logic: `apps/api/src/auth/steamLinkService.ts`
- API usage: `apps/api/src/server.ts`

## Verification
- Tests: `apps/api/src/auth/steamLinkService.test.ts`
  - linked identity audit write
  - safe transfer branch (identity/credential/profile)
  - duplicate identity discard branch with unlink audit events
  - missing/disabled source failure behavior
  - no-op self-merge guard
