# Steam Identity Link Policy

Date: 2026-07-15

## Safety rule

Steam sign-in may create an account, sign in to the account that already owns the Steam identity, or explicitly add an unclaimed Steam identity to the currently authenticated account. It never merges two accounts, moves account data, or disables an account.

The historical `account_merge_events` table remains for old audit records. The current Steam exchange flow does not write account merges.

## Sign-in and link flows

Endpoint: `POST /auth/steam/exchange`

Every request requires a fresh `steamTicket` that the API verifies with Steam. `displayName` is optional.

- First Steam sign-in: send no account bearer token and omit `linkToAuthenticatedAccount`. A new internal account is created and linked.
- Returning Steam sign-in: send no account bearer token and omit `linkToAuthenticatedAccount`. The existing Steam-linked account is returned.
- Explicit link: authenticate the account to keep with its bearer token and send `linkToAuthenticatedAccount: true`. The Steam identity is added only if it is currently unclaimed and the target account has no other Steam identity.
- Same-account retry: an explicit link to the account that already owns the Steam identity succeeds without changing data.
- Cross-account conflict: if the Steam identity belongs to another account, the API returns `steam_identity_already_linked`. Neither account is changed. Support must resolve ownership outside this endpoint.

An authenticated request without `linkToAuthenticatedAccount: true` is rejected with `steam_link_confirmation_required`. The legacy `mergeAccountId` field is rejected with `automatic_account_merge_removed`.

## Concurrency and audit

- Linking serializes concurrent requests for the same Steam ID with a PostgreSQL advisory transaction lock.
- Target account and identity rows are locked before mutation.
- Successful links and failed explicit link attempts write `identity_link_events` records.
- Authentication success and failure continue to write `account_auth_events` records.
- Provider conflicts never transfer credentials, profiles, ratings, enforcement state, social state, or allowlist membership.

## Implementation and verification

- Core policy: `apps/api/src/auth/steamLinkService.ts`
- API boundary: `apps/api/src/server.ts`
- Policy tests: `apps/api/src/auth/steamLinkService.test.ts`
- Steam ticket verifier: `apps/api/src/auth/steamAuth.ts`
- Alpha provider gate: `apps/api/src/ops/alphaProviderConfig.ts`
